// ChatGPT Multi-Prompt - background service worker (MV3)
//
// Responsibilities:
//   1. openVariations  - expand one prompt into N per-tab prompts (optionally
//      with distinct "angles"), open N background tabs, and remember which
//      tabs we opened so we can group / close them later.
//   2. getPayload      - hand each newly opened tab its prompt + media. Keyed
//      by the requesting tab's own id (sender.tab.id), so there is no fragile
//      URL hash to parse and nothing leaks into the page URL.
//   3. closeVariations - close every tab we opened in recent fan-outs.
//
// Why tab-id keying: ChatGPT rewrites the page URL on load (it strips unknown
// query params and can drop the hash), so we cannot smuggle an id through the
// URL reliably. Instead the service worker stores each tab's payload under the
// real tab id it got back from chrome.tabs.create, and the content script asks
// "what is my payload?" — the worker answers using sender.tab.id.
//
// Privacy: everything lives in chrome.storage.session (RAM-backed, wiped when
// Chrome closes). Nothing is written to disk, nothing leaves the browser.

"use strict";

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const TAB_PAYLOAD_PREFIX = "cmptab_"; // cmptab_<tabId>  -> per-tab prompt
const FILES_PREFIX = "cmpfiles_"; // cmpfiles_<groupId> -> shared media
const OPEN_TABS_KEY = "cmp_open_tabs"; // [{ id, ts }] for close-all
const PAYLOAD_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TAB_STAGGER_MS = 220; // delay between tab creates
const MAX_TABS = 10;
const GROUP_TITLE = "ChatGPT Variations";

// chrome.storage.session has a ~10MB quota. base64 inflates bytes ~1.33x, so
// keep the encoded media well under that with headroom for everything else.
const MAX_TOTAL_MEDIA_BYTES = 7 * 1024 * 1024;

// ----------------------------------------------------------------------------
// Message routing
// ----------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.action !== "string") return false;

  switch (msg.action) {
    case "openVariations":
      handleOpenVariations(msg, sender)
        .then(sendResponse)
        .catch((err) =>
          sendResponse({ ok: false, error: errText(err) }),
        );
      return true; // async

    case "getPayload":
      getPayloadForTab(sender?.tab?.id)
        .then(sendResponse)
        .catch(() => sendResponse({ payload: null }));
      return true;

    case "closeVariations":
      closeVariations()
        .then(sendResponse)
        .catch((err) => sendResponse({ ok: false, error: errText(err) }));
      return true;

    default:
      return false;
  }
});

// Keyboard command: Ctrl/Cmd+Shift+0 closes all variation tabs.
if (chrome.commands && chrome.commands.onCommand) {
  chrome.commands.onCommand.addListener((command) => {
    if (command === "close-variations") closeVariations().catch(() => {});
  });
}

// Keep the open-tabs list tidy when the user closes tabs manually.
chrome.tabs.onRemoved.addListener((tabId) => {
  forgetOpenTab(tabId).catch(() => {});
  chrome.storage.session.remove(TAB_PAYLOAD_PREFIX + tabId).catch(() => {});
});

// ----------------------------------------------------------------------------
// openVariations
// ----------------------------------------------------------------------------

async function handleOpenVariations(msg, sender) {
  const {
    basePrompt = "",
    files = [],
    model = null,
    baseUrl = "https://chatgpt.com",
    count = 3,
    options = {},
  } = msg;

  const n = clampInt(count, 1, MAX_TABS);
  const prompt = String(basePrompt || "").trim();

  if (!prompt && (!Array.isArray(files) || files.length === 0)) {
    return { ok: false, error: "Nothing to send." };
  }

  // Validate total media size up front so we fail fast with a clear message.
  if (Array.isArray(files) && files.length > 0) {
    let total = 0;
    for (const f of files) total += (f.dataUrl || "").length;
    if (total > MAX_TOTAL_MEDIA_BYTES) {
      return {
        ok: false,
        error:
          "Attached media is too large to copy into multiple tabs " +
          `(~${Math.round(total / 1024 / 1024)}MB). Try fewer / smaller files.`,
      };
    }
  }

  // Build the per-tab prompt text (applies the chosen angle strategy).
  const perTabPrompts = buildPerTabPrompts(prompt, n, options);

  // Store shared media once (not once per tab) under a group id.
  let filesRef = null;
  if (Array.isArray(files) && files.length > 0) {
    filesRef = FILES_PREFIX + uid();
    await chrome.storage.session.set({
      [filesRef]: { files, createdAt: now(), refCount: n },
    });
  }

  const openedIds = [];
  let failures = 0;

  for (let i = 0; i < n; i++) {
    const text = perTabPrompts[i];
    const url = buildPrefillUrl(baseUrl, text);
    try {
      const tab = await chrome.tabs.create({ url, active: false });
      if (tab && typeof tab.id === "number") {
        openedIds.push(tab.id);
        // Store this tab's payload keyed by its real tab id.
        await chrome.storage.session.set({
          [TAB_PAYLOAD_PREFIX + tab.id]: {
            prompt: text,
            model,
            filesRef,
            createdAt: now(),
          },
        });
      }
    } catch (err) {
      failures += 1;
      console.warn("[cmp-multi] tabs.create failed:", err);
    }
    if (i < n - 1) await sleep(TAB_STAGGER_MS);
  }

  if (openedIds.length === 0) {
    if (filesRef) await chrome.storage.session.remove(filesRef);
    return { ok: false, error: "Could not open any tabs." };
  }

  // Remember opened tabs for close-all.
  await rememberOpenTabs(openedIds);

  // Group them (best-effort; never fail the flow over grouping).
  if (options.groupTabs && openedIds.length > 1) {
    try {
      const groupId = await chrome.tabs.group({ tabIds: openedIds });
      if (chrome.tabGroups?.update) {
        await chrome.tabGroups.update(groupId, {
          title: `${GROUP_TITLE} (${openedIds.length})`,
          color: "green",
        });
      }
    } catch (err) {
      console.warn("[cmp-multi] grouping failed:", err);
    }
  }

  // Optionally bring the first variation to the front.
  if (options.focusFirst) {
    try {
      await chrome.tabs.update(openedIds[0], { active: true });
    } catch {}
  }

  cleanupExpired().catch(() => {});

  return {
    ok: true,
    opened: openedIds.length,
    failed: failures,
    withMedia: !!filesRef,
  };
}

/**
 * Expand the base prompt into one string per tab according to the chosen
 * angle strategy:
 *   - "none"   : every tab gets the prompt verbatim.
 *   - "hint"   : every tab gets the same "be different" nudge appended.
 *   - "angles" : each tab gets a distinct angle from options.angles, cycling
 *                if there are more tabs than angles.
 */
function buildPerTabPrompts(prompt, n, options) {
  const mode = options.angleMode || "hint";
  const out = [];

  if (mode === "angles" && Array.isArray(options.angles) && options.angles.length) {
    const angles = options.angles.map((a) => String(a).trim()).filter(Boolean);
    for (let i = 0; i < n; i++) {
      const angle = angles[i % angles.length];
      out.push(
        `${prompt}\n\n(Variation ${i + 1} of ${n} — approach this as: ${angle}. ` +
          `This is one of several independent attempts; make yours distinct.)`,
      );
    }
    return out;
  }

  if (mode === "hint") {
    const hint =
      "\n\n(Please give a noticeably different approach, angle, or style " +
      "than other attempts at this same prompt.)";
    for (let i = 0; i < n; i++) out.push(prompt + hint);
    return out;
  }

  // mode === "none"
  for (let i = 0; i < n; i++) out.push(prompt);
  return out;
}

/**
 * Build a ChatGPT URL that natively pre-fills the composer via ?prompt=.
 * If the encoded URL would be too long, omit the param and rely on the
 * content script to type the text instead.
 */
function buildPrefillUrl(baseUrl, text) {
  const origin = baseUrl || "https://chatgpt.com";
  try {
    const u = new URL(origin.endsWith("/") ? origin : origin + "/");
    u.searchParams.set("prompt", text);
    const full = u.toString();
    if (full.length <= 28000) return full;
  } catch {}
  // Fallback: open a clean composer; the content script will type the text.
  return origin.endsWith("/") ? origin : origin + "/";
}

// ----------------------------------------------------------------------------
// getPayload (called by the content script of each opened tab)
// ----------------------------------------------------------------------------

async function getPayloadForTab(tabId) {
  if (typeof tabId !== "number") return { payload: null };

  const key = TAB_PAYLOAD_PREFIX + tabId;
  const got = await chrome.storage.session.get(key);
  const entry = got[key];
  if (!entry) return { payload: null };

  // TTL guard.
  if (now() - (entry.createdAt || 0) > PAYLOAD_TTL_MS) {
    await chrome.storage.session.remove(key);
    return { payload: null };
  }

  // Resolve shared media (stored once for the whole fan-out).
  let files = [];
  if (entry.filesRef) {
    const fr = await chrome.storage.session.get(entry.filesRef);
    const bundle = fr[entry.filesRef];
    if (bundle && Array.isArray(bundle.files)) {
      files = bundle.files;
      // Decrement the ref count; drop the bundle once all tabs have claimed.
      bundle.refCount = (bundle.refCount || 1) - 1;
      if (bundle.refCount <= 0) {
        await chrome.storage.session.remove(entry.filesRef);
      } else {
        await chrome.storage.session.set({ [entry.filesRef]: bundle });
      }
    }
  }

  // This tab has claimed its payload; remove it so a reload cannot re-fire.
  await chrome.storage.session.remove(key);

  return {
    payload: { prompt: entry.prompt || "", model: entry.model || null, files },
  };
}

// ----------------------------------------------------------------------------
// closeVariations
// ----------------------------------------------------------------------------

async function closeVariations() {
  const list = await getOpenTabs();
  if (!list.length) return { ok: true, closed: 0 };

  // Only close tabs that still exist.
  const ids = [];
  for (const item of list) {
    try {
      await chrome.tabs.get(item.id); // throws if gone
      ids.push(item.id);
    } catch {}
  }

  if (ids.length) {
    try {
      await chrome.tabs.remove(ids);
    } catch (err) {
      console.warn("[cmp-multi] tabs.remove failed:", err);
    }
  }
  await chrome.storage.session.remove(OPEN_TABS_KEY);
  return { ok: true, closed: ids.length };
}

// ----------------------------------------------------------------------------
// Open-tab bookkeeping
// ----------------------------------------------------------------------------

async function getOpenTabs() {
  const got = await chrome.storage.session.get(OPEN_TABS_KEY);
  const list = got[OPEN_TABS_KEY];
  return Array.isArray(list) ? list : [];
}

async function rememberOpenTabs(ids) {
  const existing = await getOpenTabs();
  const fresh = ids.map((id) => ({ id, ts: now() }));
  // Keep only recent entries so the list cannot grow without bound.
  const merged = [...existing, ...fresh]
    .filter((e) => now() - e.ts < PAYLOAD_TTL_MS * 4)
    .slice(-50);
  await chrome.storage.session.set({ [OPEN_TABS_KEY]: merged });
}

async function forgetOpenTab(tabId) {
  const existing = await getOpenTabs();
  const next = existing.filter((e) => e.id !== tabId);
  if (next.length !== existing.length) {
    await chrome.storage.session.set({ [OPEN_TABS_KEY]: next });
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function clampInt(v, lo, hi) {
  let n = parseInt(v, 10);
  if (Number.isNaN(n)) n = lo;
  return Math.min(hi, Math.max(lo, n));
}

function now() {
  return Date.now();
}

function uid() {
  return now().toString(36) + "_" + Math.random().toString(36).slice(2, 10);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function errText(err) {
  return err && err.message ? err.message : String(err);
}

async function cleanupExpired() {
  const all = await chrome.storage.session.get();
  const dead = [];
  for (const [k, v] of Object.entries(all)) {
    if (
      (k.startsWith(TAB_PAYLOAD_PREFIX) || k.startsWith(FILES_PREFIX)) &&
      v &&
      now() - (v.createdAt || 0) > PAYLOAD_TTL_MS
    ) {
      dead.push(k);
    }
  }
  if (dead.length) await chrome.storage.session.remove(dead);
}
