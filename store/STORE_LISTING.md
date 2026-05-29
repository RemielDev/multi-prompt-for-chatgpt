# Chrome Web Store: Listing Kit

Everything you need to publish **Multi-Prompt for ChatGPT**. Copy/paste each
field into the Developer Dashboard. All assets are in `store/out/`.

---

## 1. Basics

| Field | Value |
|---|---|
| **Item name** (max 75 chars) | `Multi-Prompt for ChatGPT` |
| **Summary** (max 132 chars) | `Send one prompt to several new ChatGPT chats at once — each with its own angle — and compare the answers side by side.` |
| **Category** | `Productivity` |
| **Language** | `English (United States)` |
| **Default locale** | `en` |

---

## 2. Detailed description (paste into "Description")

```
Explore a question from several directions at once.

Multi-Prompt for ChatGPT adds a button right inside ChatGPT. Type a prompt,
pick how many variations you want, and it opens that prompt in several new
chats at once — optionally giving each its own angle — so you can compare the
answers side by side.

★ WORKS INSIDE CHATGPT
• A grid button next to the Send button fans out whatever you're typing
  (including attached images) to multiple new chats.
• A button in each past message's hover toolbar re-sends that prompt to
  multiple new chats.

★ ONE PROMPT, MANY ANGLES
Choose how the variations differ:
• Identical — the exact same prompt to every chat.
• Nudge for variety — appends a "give a different approach" line.
• Distinct angles — each chat gets its own angle (concise, detailed, critical,
  creative, step-by-step, or your own editable list).

★ KEEPS YOUR WORKSPACE TIDY
• 1–10 variations per click.
• Groups the new tabs into one labelled group.
• "Close all variation tabs" in one click, plus keyboard shortcuts.
• Re-attaches images to every new chat.

★ PRIVATE BY DEFAULT
No account, no sign-in, no tracking, no remote code. Your prompts are used only
to open and fill the new tabs and are never stored on disk or sent to any server
other than ChatGPT itself. The extension runs only on ChatGPT.

Not affiliated with, endorsed by, or sponsored by OpenAI. "ChatGPT" is a
trademark of OpenAI and is used only to describe compatibility.
```

---

## 3. Single-purpose description (paste into "Single purpose")

```
The single purpose of this extension is to take one prompt the user provides on
chatgpt.com and submit it to several new ChatGPT chats at once so the user can
compare the responses.
```

---

## 4. Permission justifications (paste each into its field)

**`storage`**
```
Stores the user's own settings (number of variations, variation style, custom
angle list, and toggles) so they persist between sessions, and briefly holds the
prompt and any attached files in in-memory session storage so the newly opened
tabs can pick them up. No prompt content is ever stored persistently.
```

**`tabGroups`**
```
Used to group the new chat tabs the extension opens into a single labelled tab
group ("ChatGPT Variations") so the user's window stays organized, and to close
them together on request.
```

**Host permission: `https://chatgpt.com/*`, `https://chat.openai.com/*`**
```
The extension only works on ChatGPT. Host access is required to add the in-page
buttons to ChatGPT's interface and to fill in and submit the prompt in the new
chats it opens. The extension does not run on any other site.
```

**Remote code**
```
No. All code is contained in the extension package. No remote or externally
hosted code is loaded or executed.
```

---

## 5. Privacy practices (Data usage form)

- **Does this item collect or use user data?** Answer: **No data is collected.**
- *"I do not sell or transfer user data to third parties, outside of the approved use cases."* — **True**
- *"I do not use or transfer user data for purposes unrelated to my item's single purpose."* — **True**
- *"I do not use or transfer user data to determine creditworthiness or for lending."* — **True**
- **Privacy policy URL:** `https://remieldev.github.io/multi-prompt-for-chatgpt/privacy.html`

---

## 6. Assets checklist (all in `store/out/`)

| Asset | Spec | File |
|---|---|---|
| Store icon | 128x128 PNG | `store-icon-128.png` (also `icons/icon128.png`) |
| Screenshot 1 (hero) | 1280x800 PNG | `screenshot-1-hero.png` |
| Screenshot 2 (angles) | 1280x800 PNG | `screenshot-2-angles.png` |
| Screenshot 3 (in ChatGPT) | 1280x800 PNG | `screenshot-3-inline.png` |
| Screenshot 4 (settings) | 1280x800 PNG | `screenshot-4-settings.png` |
| Small promo tile | 440x280 PNG | `promo-small-440x280.png` |
| Marquee promo tile | 1400x560 PNG | `promo-marquee-1400x560.png` |

**Screenshot captions (optional, but boosts conversion):**
1. One prompt, sent to several ChatGPT chats at once.
2. Give each chat its own angle and compare.
3. Works right inside ChatGPT — next to Send.
4. Simple settings: count, style, grouping.

---

## 7. Search keywords (woven into the description already)

`chatgpt`, `multiple chats`, `compare responses`, `prompt variations`,
`prompt fan out`, `parallel prompts`, `ai productivity`, `prompt engineering`.

---

## 8. Submission checklist

- [ ] Bump `version` in `manifest.json` for each new upload.
- [ ] Run `npm run pack` (see README) to build `dist/multi-prompt-for-chatgpt.zip`.
- [ ] Create item in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) ($5 one-time dev fee).
- [ ] Upload `dist/multi-prompt-for-chatgpt.zip`.
- [ ] Paste fields from sections 1 to 5 above.
- [ ] Upload icon + screenshots + promo tiles from `store/out/`.
- [ ] Add the privacy policy URL.
- [ ] Set visibility (Public) and submit for review.
