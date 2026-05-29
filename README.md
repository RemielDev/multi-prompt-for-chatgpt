# Multi-Prompt for ChatGPT

> Independent project — not affiliated with, endorsed by, or sponsored by OpenAI.

A Chrome extension (Manifest V3) that fans **one** prompt out to **several new
ChatGPT chats at once** — each in its own tab, optionally with its own angle —
so you can compare different answers side by side.

It adds two buttons inside ChatGPT itself:

1. **Composer button** — a grid icon next to ChatGPT's Send button. Sends what
   you're currently typing (plus any attached files) to N new chats.
2. **Per-message button** — a grid icon docked into the hover toolbar of every
   past user message, next to Copy/Edit. Re-sends that prompt (and its images)
   to N new chats.

All behaviour is configured once in the toolbar popup; the in-page buttons just
read those settings.

## How it works

> **Verified live:** today's ChatGPT only *pre-fills* the composer from the
> `?prompt=` URL parameter — it no longer auto-submits, and `&model=` is
> ignored. So every opened tab must click **Send** itself.

The flow:

1. **Source tab** (where you click) gathers the prompt + any attached media,
   then asks the background service worker to open N tabs.
2. **Background worker** expands the prompt into one string per tab (applying
   your chosen angle strategy), opens each tab at `https://chatgpt.com/?prompt=…`
   (native instant pre-fill), and stores each tab's payload **keyed by that
   tab's real id**. Media is stored **once** for the whole fan-out, not copied
   per tab.
3. **Each new tab** asks the worker "what's my payload?" (answered via the
   tab's own id — nothing is smuggled through the URL). It then:
   - attaches the media and waits for the upload chips to confirm,
   - reconciles the prompt text (only retypes if the pre-fill doesn't match),
   - waits for uploads to finish (Send stays disabled until they do),
   - clicks **Send**, with an Enter-key fallback if the click doesn't take.

Keying payloads by tab id (instead of a URL hash) is deliberate: ChatGPT
rewrites the page URL on load — it strips unknown query params and can drop the
hash — so the URL is not a reliable carrier.

## File structure

```
chatgpt-multi-prompt/
├── manifest.json     # MV3 manifest, icons, commands, permissions
├── background.js     # Service worker: expand prompt, open/group/close tabs, relay payloads
├── content.js        # Inject buttons (source) + auto-fill/attach/send (receiver)
├── content.css       # In-page button + toast styling (light/dark, reduced-motion)
├── popup.html        # Settings UI
├── popup.css         # Popup styling
├── popup.js          # Persist settings, "close all" action
├── icons/            # icon16/32/48/128.png
└── README.md
```

## Permissions

| Permission                      | Why                                                            |
| ------------------------------- | -------------------------------------------------------------- |
| `storage`                       | Save settings (sync) + briefly hold each tab's payload (session). |
| `tabGroups`                     | Collect the new tabs into a "ChatGPT Variations" group.        |
| `host_permissions: chatgpt.com` | Inject the content script that adds the buttons and automates Send. |

No `tabs`, no `scripting`, no `clipboard`, no analytics, no remote servers.

## Install (load unpacked)

1. Open `chrome://extensions/`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder
   (`C:\Users\remie\Development\chatgpt-multi-prompt`).
4. Pin the extension. Make sure you're signed in to ChatGPT.
5. Open `https://chatgpt.com/` — the grid buttons appear in the composer and on
   each past message's hover toolbar.

> **Updating:** after editing any file, return to `chrome://extensions/` and
> click the **reload** (↻) icon on the extension's card.

## Settings (popup)

- **Variations per click** — 1 to 10.
- **Variation style:**
  - **Identical** — same prompt to every chat.
  - **Nudge for variety** — appends a "give a different approach" line.
  - **Distinct angles** — each chat gets its own angle from your editable list
    (one per line; cycles if there are more tabs than angles). Defaults cover
    concise / detailed / creative / critical / step-by-step.
- **Group the new tabs together** — into a labelled tab group.
- **Jump to the first new tab** — focus it after opening (off by default, so
  you can keep working in the source tab).
- **Close all variation tabs** — one click closes every tab opened by recent
  fan-outs.

### Keyboard shortcuts

- `Ctrl/Cmd + Shift + 1` — open the settings popup.
- `Ctrl/Cmd + Shift + 0` — close all variation tabs.

## Privacy

- Prompts and files live only in the active browser session
  (`chrome.storage.session`, RAM-backed, wiped on Chrome close) and are cleared
  as soon as each tab claims them (5-minute TTL as a backstop).
- Settings live in `chrome.storage.sync`. No prompt content is ever stored
  there.
- Nothing is sent anywhere except ChatGPT itself. No analytics, no telemetry.

## Reliability & media guarantees

The contract: **if media was visibly attached to the prompt, every fanned-out
tab either contains all of it, or doesn't submit at all.** No silent
half-sends.

- **Source side** refuses to fan out if the visible attachment chip count
  doesn't match the files it could read, or if an upload is still in progress.
- **Past messages** force lazy-loaded images to load before capture; if any
  image can't be captured, the whole fan-out aborts with a clear message.
  Non-image attachments (PDF/DOCX) can't be recovered from the DOM, so the
  fan-out aborts rather than sending a text-only version.
- **Receiver side** waits for the upload chips to appear (retrying via
  drag-drop if the file-input path didn't register), waits for uploads to
  finish, and only then submits — otherwise it refuses and tells you.
- Buttons show a busy spinner and ignore double-clicks while a fan-out runs.

## Limitations

- **Model is not preserved.** ChatGPT ignores the `&model=` URL param, so new
  chats open in your account's default model. (Documented honestly — the
  previous URL approach never actually worked.)
- **Media uses DOM automation.** The text path and the media path both now
  rely on driving ChatGPT's composer, because auto-submit is gone. If ChatGPT
  changes its composer markup substantially, the fallbacks may need updating.
- **Image-only re-attach for past messages.** Document attachments are not
  re-uploadable (their bytes aren't in the rendered DOM).
- **~7 MB total media per fan-out**, to stay within session-storage limits.
  Larger sets are rejected up front with a clear message.
- **Up to 10 tabs** per click, hard-capped.
- **Independent chats.** The variations can't see each other; angles/nudges are
  requests for variety, not guarantees.

## Ideas for later

- Best-effort model selection by driving the model dropdown in each new tab.
- A side-by-side compare view that tiles the variation tabs.
- Per-click count override (e.g. hold Shift to double it).
- Saved prompt presets.
- Re-uploading document attachments via ChatGPT's file API rather than the DOM.

## License

MIT — see [LICENSE](LICENSE).
