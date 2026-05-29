// Renders all marketing assets + toolbar icons from assets.html, using your
// installed Chrome via playwright-core (no browser download).
//
//   npm install        # once, installs playwright-core
//   npm run render     # writes store/out/* and ../icons/*
//
// Override Chrome's path with: CHROME_PATH="..." node render.js
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");

const CHROME =
  process.env.CHROME_PATH ||
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const here = (p) => path.resolve(__dirname, p);
const fileUrl = (p) => "file:///" + here(p).replace(/\\/g, "/");

// The toolbar/icon mark: gradient rounded square + 2x2 white grid (matches UI).
const MARK_SVG = (s) => `
<svg width="${s}" height="${s}" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#10a37f"/><stop offset="1" stop-color="#2dd4bf"/>
  </linearGradient></defs>
  <rect x="1" y="1" width="30" height="30" rx="8" fill="url(#lg)"/>
  <rect x="7" y="7" width="8" height="8" rx="2" fill="#fff"/>
  <rect x="17" y="7" width="8" height="8" rx="2" fill="#fff"/>
  <rect x="7" y="17" width="8" height="8" rx="2" fill="#fff"/>
  <rect x="17" y="17" width="8" height="8" rx="2" fill="#fff"/>
</svg>`;

// Stub chrome.* so the REAL popup.html renders for a QA shot.
const POPUP_STUBS = `
window.chrome = {
  runtime: { sendMessage: (m, cb) => cb && cb({ ok: true, closed: 0 }), lastError: null },
  storage: {
    sync: { get: (d, cb) => cb({ count: 3, angleMode: "angles",
      angles: ["concise and direct — get to the point","thorough and detailed — cover the nuances","creative and unconventional — an unexpected take","critical — challenge the assumptions in the prompt","step-by-step and practical — an actionable plan"],
      groupTabs: true, focusFirst: false }), set: (v, cb) => cb && cb() },
    onChanged: { addListener: () => {} },
  },
};
`;

(async () => {
  fs.mkdirSync(here("out"), { recursive: true });
  const browser = await chromium.launch({
    executablePath: CHROME,
    args: ["--force-color-profile=srgb", "--hide-scrollbars", "--font-render-hinting=none"],
  });

  // ---- Marketing frames from assets.html ----
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  await page.goto(fileUrl("assets.html"), { waitUntil: "networkidle" });
  await page.waitForTimeout(300);

  const frames = [
    ["shot1", "out/screenshot-1-hero.png"],
    ["shot2", "out/screenshot-2-angles.png"],
    ["shot3", "out/screenshot-3-inline.png"],
    ["shot4", "out/screenshot-4-settings.png"],
    ["tileSmall", "out/promo-small-440x280.png"],
    ["tileMarquee", "out/promo-marquee-1400x560.png"],
  ];
  for (const [id, outp] of frames) {
    const el = await page.$("#" + id);
    await el.screenshot({ path: here(outp) });
    const box = await el.boundingBox();
    console.log("✓", outp, `${Math.round(box.width)}x${Math.round(box.height)}`);
  }

  // ---- Icons from the logo mark (fresh page per size) ----
  for (const s of [16, 32, 48, 128]) {
    const ip = await browser.newPage({ viewport: { width: s, height: s }, deviceScaleFactor: 1 });
    await ip.setContent(`<body style="margin:0;padding:0;background:transparent">${MARK_SVG(s)}</body>`, { waitUntil: "load" });
    await ip.screenshot({ path: here(`../icons/icon${s}.png`), omitBackground: true, clip: { x: 0, y: 0, width: s, height: s } });
    await ip.close();
    console.log("✓ icon", `${s}x${s}`);
  }
  fs.copyFileSync(here("../icons/icon128.png"), here("out/store-icon-128.png"));

  // ---- QA: render the REAL popup.html ----
  const qa = await browser.newPage({ viewport: { width: 360, height: 760 }, deviceScaleFactor: 2 });
  await qa.addInitScript(POPUP_STUBS);
  await qa.goto(fileUrl("../popup.html"), { waitUntil: "domcontentloaded" });
  await qa.waitForTimeout(700);
  await qa.screenshot({ path: here("out/qa-popup-real.png") });
  console.log("✓ qa-popup-real.png (live popup with stubs)");

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
