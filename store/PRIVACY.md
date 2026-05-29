# Privacy Policy — Multi-Prompt for ChatGPT

_Last updated: 2026-05-28_

Multi-Prompt for ChatGPT ("the extension") opens your prompt in multiple new
ChatGPT chats so you can compare answers. This policy describes exactly what it
does — and does not do — with your data.

## Summary

The extension does **not** collect, transmit, sell, or share any personal data.
Everything happens locally in your browser. There are no external servers, no
analytics, and no tracking of any kind.

## What the extension handles

- **Your prompt text and any attached files** are read only at the moment you
  click a "fan out" button. They are used solely to open new ChatGPT tabs and
  fill them in, and are held briefly in your browser's in-memory session
  storage (`chrome.storage.session`) only long enough for the newly opened tabs
  to pick them up. They are deleted as soon as the tabs claim them, or after a
  5-minute safety timeout, and are wiped entirely when Chrome closes. The
  extension never writes prompt content or files to disk, and never sends them
  anywhere except `chatgpt.com` — the site you are already using.

- **Your settings** (variation count, variation style, the group/focus toggles,
  and your custom angle list) are stored with `chrome.storage.sync` so they
  persist and roam across your signed-in Chrome browsers. Settings never contain
  prompt content.

## What the extension does NOT do

- No data is sent to the developer or any third party.
- No analytics, telemetry, advertising, or behavioral tracking.
- No external or remote servers are contacted by the extension.
- No remote code is downloaded or executed (all code ships in the package).
- Prompt content is never stored persistently.

## Permissions and why each is needed

| Permission | Purpose |
| --- | --- |
| `storage` | Save your settings, and briefly relay prompts/files to the new tabs in memory. |
| `tabGroups` | Optionally group the tabs it opens into one labelled group. |
| Host access to `chatgpt.com` / `chat.openai.com` | Add the in-page buttons and fill the new chats. The extension runs only on these two sites. |

## Data sharing

None. The only network destination involved in the workflow is ChatGPT itself,
which you interact with directly. Any content you submit to ChatGPT is governed
by OpenAI's own privacy policy.

## Children's privacy

The extension is a general-purpose productivity tool and is not directed at
children. It collects no data from anyone.

## Changes to this policy

Material changes will be reflected by updating the "Last updated" date above.

## Contact

Remiel Shirazi — rembuckbuisness@gmail.com

## Affiliation

This extension is an independent project and is not affiliated with, endorsed
by, or sponsored by OpenAI. "ChatGPT" is a trademark of OpenAI; it is used here
only to describe what the extension works with.
