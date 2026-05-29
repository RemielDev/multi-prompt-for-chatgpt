// ChatGPT Multi-Prompt - content script
//
// This single script plays two roles on chatgpt.com:
//
//   SOURCE side  - injects a "fan out" button into the composer and into the
//                  hover toolbar of every previous user message. Clicking it
//                  gathers the prompt + any attached media and asks the
//                  background worker to open N new chats.
//
//   RECEIVER side- when a tab was opened by this extension, the background
//                  worker hands it a prompt (+ media) keyed by this tab's id.
//                  The script then fills the composer, attaches the media,
//                  waits for uploads, and clicks Send.
//
// Important behaviour note (verified live): ChatGPT's ?prompt= URL parameter
// only PRE-FILLS the composer; it no longer auto-submits. So every opened tab
// must click Send itself. We use ?prompt= purely as a fast, native pre-fill
// and reconcile/submit from the content script.
//
// Selectors were verified against the live site. Each fragile lookup has
// fallbacks so a small ChatGPT DOM change degrades gracefully instead of
// breaking outright.

(() => {
  "use strict";

  // ===========================================================================
  // Constants
  // ===========================================================================

  const COMPOSER_BTN_ID = "cmp-multi-composer-btn";
  const TURN_FLAG_ATTR = "data-cmp-multi-done";
  const TOAST_ID = "cmp-multi-toast";

  const DEFAULT_SETTINGS = {
    count: 3,
    angleMode: "hint", // "none" | "hint" | "angles"
    angles: [
      "concise and direct — get to the point",
      "thorough and detailed — cover the nuances",
      "creative and unconventional — an unexpected take",
      "critical — challenge the assumptions in the prompt",
      "step-by-step and practical — an actionable plan",
    ],
    groupTabs: true,
    focusFirst: false,
  };

  const MAX_FILE_BYTES = 8 * 1024 * 1024; // per-file guard before encoding

  // ===========================================================================
  // Settings (synced live from the popup via chrome.storage.sync)
  // ===========================================================================

  let settings = { ...DEFAULT_SETTINGS };

  chrome.storage.sync.get(DEFAULT_SETTINGS, (s) => {
    settings = { ...DEFAULT_SETTINGS, ...s };
    refreshButtonLabels();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    let touched = false;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in settings) {
        settings[key] = newValue;
        touched = true;
      }
    }
    if (touched) refreshButtonLabels();
  });

  // ===========================================================================
  // Small utilities
  // ===========================================================================

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** Poll `predicate` until it returns truthy or the timeout elapses. */
  function waitFor(predicate, timeoutMs = 15000, intervalMs = 150) {
    return new Promise((resolve) => {
      const start = Date.now();
      const first = safe(predicate);
      if (first) return resolve(first);
      const timer = setInterval(() => {
        const r = safe(predicate);
        if (r) {
          clearInterval(timer);
          resolve(r);
        } else if (Date.now() - start > timeoutMs) {
          clearInterval(timer);
          resolve(null);
        }
      }, intervalMs);
    });
  }

  function safe(fn) {
    try {
      return fn();
    } catch {
      return null;
    }
  }

  /** Normalise whitespace so prefill (\n -> \n\n) still compares as equal. */
  function normalizeText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  // ===========================================================================
  // Accessible toast
  // ===========================================================================

  function showToast(text, kind /* "info" | "error" | "success" */) {
    let toast = document.getElementById(TOAST_ID);
    if (!toast) {
      toast = document.createElement("div");
      toast.id = TOAST_ID;
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    // Errors are announced assertively; everything else politely.
    toast.setAttribute("aria-live", kind === "error" ? "assertive" : "polite");
    toast.className = "cmp-multi-toast" + (kind ? " " + kind : "");
    toast.textContent = text;
    void toast.offsetWidth; // restart transition on rapid repeats
    toast.classList.add("visible");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toast.classList.remove("visible"), 3200);
  }

  // ===========================================================================
  // Detection helpers
  // ===========================================================================

  function detectBaseUrl() {
    // Keep a custom-GPT context (/g/g-xxxx) so variations stay in that GPT.
    const m = location.pathname.match(/^\/g\/[^/]+/);
    return m ? location.origin + m[0] : location.origin;
  }

  function getEditor() {
    return (
      document.querySelector("#prompt-textarea") ||
      document.querySelector('textarea[data-testid="prompt-textarea"]') ||
      document.querySelector('div[contenteditable="true"].ProseMirror')
    );
  }

  function getComposerText() {
    const el = getEditor();
    if (!el) return "";
    if (el.tagName === "TEXTAREA") return (el.value || "").trim();
    return (el.innerText || el.textContent || "").trim();
  }

  // ===========================================================================
  // Reading attached media (composer + past messages)
  // ===========================================================================

  /**
   * Files currently attached in the composer, plus the number of attachment
   * chips the user can see and whether any upload is still in flight. The
   * caller compares files.length to `expected` to refuse a partial fan-out.
   */
  function getComposerFiles() {
    const ids = ["upload-files", "upload-photos", "upload-camera"];
    const seen = new Set();
    const files = [];
    for (const id of ids) {
      const input = document.getElementById(id);
      if (!input || !input.files) continue;
      for (const f of input.files) {
        const key = `${f.name}:${f.size}:${f.lastModified}`;
        if (seen.has(key)) continue;
        seen.add(key);
        files.push(f);
      }
    }
    const expected = document.querySelectorAll(
      'form button[aria-label^="Remove file"], form button[aria-label^="Remove image"]',
    ).length;
    const uploading = document.querySelectorAll(
      'form [role="progressbar"], form [data-status="uploading"], form [aria-label*="Uploading"]',
    ).length;
    return { files, expected, uploading };
  }

  /**
   * Fetch every image attached to a past user message so it can be re-attached
   * to the new chats. Lazy-loaded images are forced to load (we do NOT skip
   * them). Returns failures + unsupported so the caller can abort loudly.
   */
  async function getMessageMedia(turnEl) {
    const userEl =
      turnEl.querySelector('[data-message-author-role="user"]') || turnEl;

    const imgs = Array.from(userEl.querySelectorAll("img")).filter((img) => {
      const alt = (img.alt || "").trim().toLowerCase();
      if (alt.startsWith("uploaded")) return true; // ChatGPT's marker
      return (
        (img.naturalWidth || 0) >= 64 ||
        (img.getBoundingClientRect().width || 0) >= 64
      );
    });

    // Non-image attachment cards (PDF/DOCX) — bytes aren't in the DOM.
    const unsupported = [];
    userEl
      .querySelectorAll(
        '[class*="file-tile"], [data-testid*="file-attachment"], [data-testid*="attachment"]',
      )
      .forEach((el) => {
        if (el.querySelector("img")) return;
        unsupported.push(
          el.getAttribute("aria-label") ||
            (el.innerText || "").trim().slice(0, 80) ||
            "(attachment)",
        );
      });

    const files = [];
    const failures = [];

    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      if (img.getAttribute("loading") === "lazy")
        img.setAttribute("loading", "eager");

      let src = img.currentSrc || img.src;
      if (!src) {
        safe(() => img.scrollIntoView({ block: "nearest" }));
        for (let t = 0; t < 30 && !src; t++) {
          await sleep(100);
          src = img.currentSrc || img.src;
        }
      }
      if (!src) {
        failures.push(`image #${i + 1}: no source`);
        continue;
      }
      if (src.startsWith("data:")) {
        try {
          files.push(dataUrlToFile(src, `image-${i}.png`, "image/png"));
        } catch {
          failures.push(`image #${i + 1}: bad data URL`);
        }
        continue;
      }
      try {
        const resp = await fetch(src, { credentials: "include" });
        if (!resp.ok) {
          failures.push(`image #${i + 1}: HTTP ${resp.status}`);
          continue;
        }
        const blob = await resp.blob();
        if (blob.size < 1024) {
          failures.push(`image #${i + 1}: too small`);
          continue;
        }
        const ext = (blob.type.split("/")[1] || "png").split("+")[0];
        files.push(
          new File([blob], `image-${Date.now()}-${i}.${ext}`, {
            type: blob.type || "image/png",
          }),
        );
      } catch (err) {
        failures.push(`image #${i + 1}: ${err?.message || err}`);
      }
    }

    return { files, expected: imgs.length, failures, unsupported };
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  function dataUrlToFile(dataUrl, name, fallbackType) {
    const [meta, b64] = dataUrl.split(",");
    const type = (meta.match(/:(.*?);/) || [])[1] || fallbackType || "application/octet-stream";
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new File([u8], name, { type });
  }

  // ===========================================================================
  // SOURCE side: fan out
  // ===========================================================================

  async function triggerMultiSend(rawText, files, sourceLabel) {
    const text = (rawText || "").trim();
    if (!text && (!files || !files.length)) {
      showToast("Nothing to send — type a prompt first.", "error");
      return;
    }

    // Encode media for transport to the new tabs.
    const filePayload = [];
    for (const f of files || []) {
      if (f.size > MAX_FILE_BYTES) {
        showToast(`File too large: ${f.name}.`, "error");
        return;
      }
      try {
        filePayload.push({
          name: f.name,
          type: f.type || "application/octet-stream",
          dataUrl: await fileToDataUrl(f),
        });
      } catch {
        showToast(`Could not read file: ${f.name}.`, "error");
        return;
      }
    }

    const mediaNote = filePayload.length ? " with media" : "";
    showToast(`Opening ${settings.count} tab(s)${mediaNote}…`, "info");

    let resp;
    try {
      resp = await chrome.runtime.sendMessage({
        action: "openVariations",
        basePrompt: text,
        files: filePayload,
        baseUrl: detectBaseUrl(),
        count: settings.count,
        options: {
          angleMode: settings.angleMode,
          angles: settings.angles,
          groupTabs: settings.groupTabs,
          focusFirst: settings.focusFirst,
        },
      });
    } catch (err) {
      showToast("Error: " + (err?.message || err), "error");
      return;
    }

    if (!resp || !resp.ok) {
      showToast(resp?.error || "Could not open tabs.", "error");
      return;
    }
    showToast(
      `Opened ${resp.opened} tab(s) from ${sourceLabel}` +
        (resp.withMedia ? " (with media)." : "."),
      "success",
    );
  }

  // ---- strict guards reused by both buttons --------------------------------

  function composerGuard(c) {
    if (c.uploading > 0) {
      showToast("Wait for uploads to finish first.", "error");
      return false;
    }
    if (c.expected > c.files.length) {
      showToast(
        `Could not capture all ${c.expected} attached file(s). Re-attach and retry.`,
        "error",
      );
      return false;
    }
    return true;
  }

  function messageMediaGuard(m) {
    if (m.failures.length) {
      showToast(
        `Could not capture ${m.failures.length}/${m.expected} image(s). Aborting.`,
        "error",
      );
      console.warn("[cmp-multi] capture failures:", m.failures);
      return false;
    }
    if (m.unsupported.length) {
      showToast(
        `This message has ${m.unsupported.length} non-image attachment(s) that can't be re-uploaded. Aborting.`,
        "error",
      );
      return false;
    }
    return true;
  }

  // ===========================================================================
  // SOURCE side: button factory + injection
  // ===========================================================================

  function gridIcon() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const [x, y] of [[3, 3], [13, 3], [3, 13], [13, 13]]) {
      const r = document.createElementNS(NS, "rect");
      r.setAttribute("x", x);
      r.setAttribute("y", y);
      r.setAttribute("width", 8);
      r.setAttribute("height", 8);
      r.setAttribute("rx", 2);
      r.setAttribute("fill", "none");
      r.setAttribute("stroke", "currentColor");
      r.setAttribute("stroke-width", 2);
      svg.appendChild(r);
    }
    return svg;
  }

  function makeButton({ id, extraClass, label, onClick }) {
    const btn = document.createElement("button");
    btn.type = "button";
    if (id) btn.id = id;
    btn.className = "cmp-multi-btn" + (extraClass ? " " + extraClass : "");
    btn.setAttribute("aria-label", label);
    btn.title = label;
    btn.appendChild(gridIcon());

    const badge = document.createElement("span");
    badge.className = "cmp-multi-count";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = String(settings.count);
    btn.appendChild(badge);

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.busy === "1") return; // prevent double-fire
      btn.dataset.busy = "1";
      btn.classList.add("is-busy");
      try {
        await onClick();
      } finally {
        btn.dataset.busy = "0";
        btn.classList.remove("is-busy");
      }
    });
    return btn;
  }

  function refreshButtonLabels() {
    document.querySelectorAll(".cmp-multi-btn").forEach((btn) => {
      const badge = btn.querySelector(".cmp-multi-count");
      if (badge) badge.textContent = String(settings.count);
      const composer = btn.id === COMPOSER_BTN_ID;
      const label = composer
        ? `Send this prompt to ${settings.count} new ChatGPT chats`
        : `Re-send this prompt to ${settings.count} new ChatGPT chats`;
      btn.title = label;
      btn.setAttribute("aria-label", label);
    });
  }

  // -- composer button -------------------------------------------------------

  function findComposerActions() {
    const trailing = document.querySelector(
      ".composer-submit-button-color, .composer-secondary-button-color, " +
        'button[data-testid="send-button"], button[data-testid="stop-button"]',
    );
    if (trailing?.parentElement)
      return { container: trailing.parentElement, anchor: trailing };

    const dictation = document.querySelector('[aria-label="Start dictation"]');
    if (dictation?.parentElement)
      return { container: dictation.parentElement, anchor: dictation };

    const form = document.querySelector("form");
    const cbtn = form?.querySelector(".composer-btn");
    if (cbtn?.parentElement)
      return {
        container: cbtn.parentElement,
        anchor: cbtn.parentElement.lastElementChild,
      };
    return null;
  }

  function injectComposerButton() {
    if (document.getElementById(COMPOSER_BTN_ID)) return;
    const target = findComposerActions();
    if (!target) return;

    const btn = makeButton({
      id: COMPOSER_BTN_ID,
      extraClass: "cmp-multi-btn--composer",
      label: `Send this prompt to ${settings.count} new ChatGPT chats`,
      onClick: async () => {
        const text = getComposerText();
        const c = getComposerFiles();
        if (!composerGuard(c)) return;
        await triggerMultiSend(text, c.files, "composer");
      },
    });
    target.container.insertBefore(btn, target.anchor);
  }

  // -- per-message button (docked in ChatGPT's hover toolbar) ----------------

  function userTurns() {
    // Prefer real conversation turns that contain a user message.
    const turns = Array.from(
      document.querySelectorAll('[data-testid^="conversation-turn"]'),
    ).filter((t) => t.querySelector('[data-message-author-role="user"]'));
    if (turns.length) return turns;
    // Fallback: the user message elements themselves.
    return Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
  }

  function getTurnText(turnEl) {
    const userEl =
      turnEl.querySelector('[data-message-author-role="user"]') || turnEl;
    const clone = userEl.cloneNode(true);
    // Strip ANY of our injected buttons (and their count badges) so they
    // never leak into the captured prompt text.
    clone.querySelectorAll(".cmp-multi-btn").forEach((n) => n.remove());
    return (clone.innerText || clone.textContent || "").trim();
  }

  function injectMessageButton(turnEl) {
    if (turnEl.getAttribute(TURN_FLAG_ATTR) === "1") {
      // Already processed, but the toolbar may have re-rendered without our
      // button. Re-add only if ours is missing.
      if (turnEl.querySelector(".cmp-multi-btn")) return;
    }
    turnEl.setAttribute(TURN_FLAG_ATTR, "1");

    const onClick = async () => {
      const text = getTurnText(turnEl);
      showToast("Capturing attached media…", "info");
      const media = await getMessageMedia(turnEl);
      if (!messageMediaGuard(media)) return;
      await triggerMultiSend(text, media.files, "saved prompt");
    };

    const label = `Re-send this prompt to ${settings.count} new ChatGPT chats`;

    // Preferred: dock next to the native Copy button in the hover toolbar.
    const copyBtn = turnEl.querySelector(
      'button[data-testid="copy-turn-action-button"]',
    );
    if (copyBtn?.parentElement) {
      const btn = makeButton({ extraClass: "cmp-multi-btn--toolbar", label, onClick });
      copyBtn.parentElement.insertBefore(btn, copyBtn);
      return;
    }

    // Fallback: a floating button anchored to the message bubble.
    const userEl =
      turnEl.querySelector('[data-message-author-role="user"]') || turnEl;
    userEl.classList.add("cmp-multi-msg-host");
    const btn = makeButton({ extraClass: "cmp-multi-btn--floating", label, onClick });
    userEl.appendChild(btn);
  }

  function injectMessageButtons() {
    userTurns().forEach(injectMessageButton);
  }

  // ===========================================================================
  // RECEIVER side: this tab was opened by the extension
  // ===========================================================================

  async function fetchMyPayload() {
    // Race guard: the background worker stores our payload right after creating
    // the tab; the content script may ask a beat too early. Retry briefly.
    for (let attempt = 0; attempt < 20; attempt++) {
      let resp = null;
      try {
        resp = await chrome.runtime.sendMessage({ action: "getPayload" });
      } catch {
        return null; // worker gone; nothing we can do
      }
      if (resp && resp.payload) return resp.payload;
      await sleep(150);
    }
    return null;
  }

  function selectAllInEditor(editor) {
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  async function setComposerText(text) {
    const editor = getEditor();
    if (!editor) return false;

    if (editor.tagName === "TEXTAREA") {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value",
      ).set;
      setter.call(editor, text);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }

    editor.focus();
    selectAllInEditor(editor); // replace any existing prefill cleanly
    if (document.execCommand("insertText", false, text)) return true;

    // Fallback: synthesise a paste event with the text.
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", text);
      editor.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  function attachViaInput(files) {
    for (const id of ["upload-files", "upload-photos"]) {
      const input = document.getElementById(id);
      if (!input) continue;
      try {
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        input.files = dt.files;
        input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        return true;
      } catch (err) {
        console.warn("[cmp-multi] input attach failed:", err);
      }
    }
    return false;
  }

  function attachViaDrop(files) {
    const target = getEditor() || document.querySelector("form") || document.body;
    try {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(
          new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }),
        );
      }
      return true;
    } catch (err) {
      console.warn("[cmp-multi] drop attach failed:", err);
      return false;
    }
  }

  function attachmentChipCount() {
    return document.querySelectorAll(
      'form button[aria-label^="Remove file"], form button[aria-label^="Remove image"]',
    ).length;
  }

  function waitForChips(target, timeoutMs) {
    return waitFor(() => (attachmentChipCount() >= target ? true : null), timeoutMs);
  }

  function waitForUploadsComplete(timeoutMs) {
    return waitFor(() => {
      const inFlight = document.querySelectorAll(
        'form [role="progressbar"], form [data-status="uploading"], form [aria-label*="Uploading"]',
      ).length;
      return inFlight === 0 ? true : null;
    }, timeoutMs);
  }

  function findSendButton() {
    return (
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button[aria-label="Send prompt"]')
    );
  }

  function userMessageCount() {
    return document.querySelectorAll('[data-message-author-role="user"]').length;
  }

  /** Click Send; if nothing submits shortly, fall back to pressing Enter. */
  async function submitComposer() {
    const before = userMessageCount();

    const btn = await waitFor(() => {
      const b = findSendButton();
      return b && !b.disabled ? b : null;
    }, 30000);

    if (btn) btn.click();

    // Confirm submission (user message count rises or composer clears).
    const ok = await waitFor(
      () =>
        userMessageCount() > before || getComposerText() === "" ? true : null,
      4000,
    );
    if (ok) return true;

    // Fallback: press Enter in the editor.
    const editor = getEditor();
    if (editor) {
      editor.focus();
      for (const type of ["keydown", "keyup"]) {
        editor.dispatchEvent(
          new KeyboardEvent(type, {
            key: "Enter",
            code: "Enter",
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true,
          }),
        );
      }
    }
    return !!(await waitFor(
      () => (userMessageCount() > before ? true : null),
      4000,
    ));
  }

  async function runAsReceiver() {
    const payload = await fetchMyPayload();
    if (!payload) return; // ordinary tab, not one of ours

    const { prompt, files } = payload;

    // Wait for the composer to mount (ChatGPT is a SPA).
    const editorReady = await waitFor(() => getEditor(), 25000);
    if (!editorReady) {
      console.warn("[cmp-multi] composer never appeared");
      return;
    }

    // 1) Attach media first so uploads start while we settle the text.
    if (Array.isArray(files) && files.length) {
      let fileObjects;
      try {
        fileObjects = files.map((f) => dataUrlToFile(f.dataUrl, f.name, f.type));
      } catch {
        showToast("Multi-Prompt: could not decode media here.", "error");
        return;
      }

      attachViaInput(fileObjects);
      let attached = await waitForChips(fileObjects.length, 8000);
      if (!attached) {
        attachViaDrop(fileObjects);
        attached = await waitForChips(fileObjects.length, 8000);
      }
      if (!attached) {
        showToast(
          `Multi-Prompt: couldn't attach ${fileObjects.length} file(s) here. Not submitting.`,
          "error",
        );
        return;
      }
    }

    // 2) Reconcile the prompt text. ?prompt= usually pre-filled it already;
    //    only (re)type if what's there doesn't match what we intended.
    if (prompt) {
      const current = getComposerText();
      if (normalizeText(current) !== normalizeText(prompt)) {
        await setComposerText(prompt);
      }
    }

    // 3) Wait for uploads to finish (Send stays disabled until they do).
    const uploadsDone = await waitForUploadsComplete(60000);
    if (!uploadsDone) {
      showToast("Multi-Prompt: uploads didn't finish. Not submitting.", "error");
      return;
    }

    // 4) Submit.
    const sent = await submitComposer();
    if (!sent) {
      showToast("Multi-Prompt: couldn't auto-send — press Enter to submit.", "error");
    }
  }

  // ===========================================================================
  // Bootstrapping
  // ===========================================================================

  let scheduled = false;
  function scheduleInjection() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      try {
        injectComposerButton();
        injectMessageButtons();
      } catch (err) {
        console.warn("[cmp-multi] injection error:", err);
      }
    });
  }

  const observer = new MutationObserver(scheduleInjection);
  observer.observe(document.body, { childList: true, subtree: true });
  scheduleInjection();

  // Receiver runs once per load; source-side injection keeps running.
  runAsReceiver();
})();
