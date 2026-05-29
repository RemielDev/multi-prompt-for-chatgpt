// Builds dist/multi-prompt-for-chatgpt.zip with only the files the Chrome Web
// Store needs. Uses Windows bsdtar (libarchive) so entries use spec-compliant
// "/" separators. PowerShell's Compress-Archive writes "\" which the Web Store
// can mis-extract.
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const zip = path.join(dist, "multi-prompt-for-chatgpt.zip");

const INCLUDE = [
  "manifest.json",
  "background.js",
  "content.js",
  "content.css",
  "popup.html",
  "popup.css",
  "popup.js",
  "icons",
];

fs.mkdirSync(dist, { recursive: true });
fs.rmSync(zip, { force: true });

const bsdtar = "C:\\Windows\\System32\\tar.exe";
execFileSync(bsdtar, ["--format=zip", "-c", "-f", zip, "-C", root, ...INCLUDE], {
  stdio: "inherit",
});

const kb = (fs.statSync(zip).size / 1024).toFixed(1);
console.log(`\n✓ Built ${path.relative(root, zip)} (${kb} KB)`);
console.log("  Upload this file in the Chrome Web Store Developer Dashboard.");
