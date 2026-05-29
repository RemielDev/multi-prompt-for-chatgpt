// ChatGPT Multi-Prompt — popup (settings) script.
//
// The popup only configures the in-page buttons. Settings live in
// chrome.storage.sync so they roam across signed-in Chromes and are read
// live by the content script. Nothing here sends prompts.

(() => {
  "use strict";

  const DEFAULTS = {
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

  const $ = (id) => document.getElementById(id);
  const countEl = $("count");
  const anglesField = $("angles-field");
  const anglesEl = $("angles");
  const groupTabsEl = $("groupTabs");
  const focusFirstEl = $("focusFirst");
  const closeAllBtn = $("closeAll");
  const statusEl = $("status");

  const clampCount = (n) => {
    let v = parseInt(n, 10);
    if (Number.isNaN(v)) v = DEFAULTS.count;
    return Math.min(10, Math.max(1, v));
  };

  const getMode = () =>
    document.querySelector('input[name="angleMode"]:checked')?.value || "hint";

  function setStatus(text, kind, sticky) {
    statusEl.textContent = text;
    statusEl.classList.remove("error", "success");
    if (kind) statusEl.classList.add(kind);
    clearTimeout(setStatus._t);
    if (!sticky && text) {
      setStatus._t = setTimeout(() => {
        statusEl.textContent = "";
        statusEl.classList.remove("error", "success");
      }, 1600);
    }
  }

  function syncAnglesVisibility() {
    anglesField.hidden = getMode() !== "angles";
  }

  // ---- Load ----------------------------------------------------------------

  chrome.storage.sync.get(DEFAULTS, (s) => {
    const cfg = { ...DEFAULTS, ...s };
    countEl.value = String(clampCount(cfg.count));
    const radio = document.querySelector(
      `input[name="angleMode"][value="${cfg.angleMode}"]`,
    );
    (radio || document.querySelector('input[name="angleMode"][value="hint"]')).checked = true;
    anglesEl.value = (cfg.angles || DEFAULTS.angles).join("\n");
    groupTabsEl.checked = !!cfg.groupTabs;
    focusFirstEl.checked = !!cfg.focusFirst;
    syncAnglesVisibility();
  });

  // ---- Save ----------------------------------------------------------------

  function save() {
    const count = clampCount(countEl.value);
    countEl.value = String(count);

    let angles = anglesEl.value
      .split("\n")
      .map((a) => a.trim())
      .filter(Boolean);
    if (angles.length === 0) angles = DEFAULTS.angles;

    chrome.storage.sync.set(
      {
        count,
        angleMode: getMode(),
        angles,
        groupTabs: !!groupTabsEl.checked,
        focusFirst: !!focusFirstEl.checked,
      },
      () => {
        if (chrome.runtime.lastError) {
          setStatus("Could not save: " + chrome.runtime.lastError.message, "error", true);
        } else {
          setStatus("Saved.", "success");
        }
      },
    );
  }

  // Commit on change / blur (not every keystroke).
  countEl.addEventListener("change", save);
  anglesEl.addEventListener("change", save);
  groupTabsEl.addEventListener("change", save);
  focusFirstEl.addEventListener("change", save);
  document.querySelectorAll('input[name="angleMode"]').forEach((r) =>
    r.addEventListener("change", () => {
      syncAnglesVisibility();
      save();
    }),
  );

  // ---- Close all variation tabs --------------------------------------------

  closeAllBtn.addEventListener("click", () => {
    closeAllBtn.disabled = true;
    chrome.runtime.sendMessage({ action: "closeVariations" }, (resp) => {
      closeAllBtn.disabled = false;
      if (chrome.runtime.lastError) {
        setStatus("Error: " + chrome.runtime.lastError.message, "error", true);
        return;
      }
      if (!resp || !resp.ok) {
        setStatus(resp?.error || "Could not close tabs.", "error", true);
        return;
      }
      setStatus(
        resp.closed > 0
          ? `Closed ${resp.closed} tab(s).`
          : "No variation tabs open.",
        "success",
      );
    });
  });
})();
