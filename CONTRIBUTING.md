# Contributing to Multi-Prompt for ChatGPT

Thanks for your interest in improving Multi-Prompt for ChatGPT. Contributions of
all sizes are welcome, from typo fixes to new variation modes.

## Getting started

1. Fork and clone the repo.
2. Load the extension unpacked:
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - **Load unpacked** and select the repo folder
3. Make your changes, then click the reload icon on the extension card to test
   on `https://chatgpt.com`.

There is no build step for the extension itself. It is plain HTML, CSS, and
JavaScript (Manifest V3) with no runtime dependencies.

## Project layout

| Path | What it is |
|---|---|
| `manifest.json` | MV3 manifest (permissions, action, commands, host permissions) |
| `background.js` | Service worker: opens/groups/closes tabs, relays prompt payloads |
| `content.js` | Injects the buttons and auto-fills/attaches/submits the new chats |
| `content.css` | In-page button + toast styling |
| `popup.html` / `popup.css` / `popup.js` | The settings UI |
| `icons/` | Toolbar icons (16/32/48/128) |
| `store/` | Marketing assets, the asset renderer, and the Web Store listing kit |
| `scripts/pack.js` | Builds `dist/multi-prompt-for-chatgpt.zip` for upload |

## How it works

ChatGPT's `?prompt=` URL parameter only *pre-fills* the composer; it does not
auto-submit. So the extension opens each new tab with the prompt pre-filled,
then a content script reconciles the text, re-attaches any media, waits for
uploads to finish, and clicks **Send**. Each tab's payload is handed over by the
service worker keyed on the tab's own id, so nothing is smuggled through the URL.

## Adding a variation mode

1. Add the mode to the radio group in `popup.html` and persist it in `popup.js`.
2. Handle it in `buildPerTabPrompts()` in `background.js`.
3. Keep prompt content out of `chrome.storage.sync` (settings only).

## Pull requests

- Keep changes focused; one logical change per PR.
- Match the existing code style (no framework, no new runtime dependencies
  without discussion).
- Run `node --check background.js content.js popup.js` before pushing.
- If you change the UI, include a before/after screenshot.

## Reporting bugs

Open an issue with:
- What you clicked and what happened vs. what you expected.
- Whether media was attached.
- Your Chrome version.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
