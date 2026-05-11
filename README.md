<p align="center">
  <img src="icons/icon-128.png" width="96" alt="Mark — Web Highlighter" />
</p>

<h1 align="center">Mark</h1>

<p align="center">
  <strong>Highlight anything on the web. No account. No setup. Highlights stay when you come back.</strong><br/>
  A Chrome side panel highlighter for websites and YouTube transcripts — offline-first and completely private.
</p>

<p align="center">
  <a href="https://chromewebstore.google.com/detail/mark-web-highlighter">
    <img src="https://img.shields.io/badge/Chrome-Install%20Free-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Install on Chrome" />
  </a>
  &nbsp;
  <a href="https://sidbhat.github.io/mark-extension/marketplace.html">
    <img src="https://img.shields.io/badge/Landing-View%20Features-3B9EFF?style=for-the-badge" alt="Feature Page" />
  </a>
  &nbsp;
  <img src="https://img.shields.io/badge/Privacy-No%20Account%20%7C%20No%20Server-22C55E?style=for-the-badge" alt="Privacy first" />
</p>

<br/>

---

## What is Mark?

Mark lives in Chrome's side panel. Select any text on any webpage — a toolbar appears instantly, you pick a color, and the highlight is saved permanently. No account. No cloud. No friction.

Come back tomorrow, next week, or next year — your highlights are exactly where you left them.

---

## Features

| | |
|---|---|
| ✏️ **One-click highlighting** | Select text → pick a color. Works on every website, article, and blog post |
| 🎬 **YouTube transcripts** | Searchable transcript panel injected into any YouTube video. Highlights store the exact timestamp |
| 📓 **Obsidian export** | Export highlights as `> [!quote]` callout blocks — ready to paste into Obsidian |
| 🔗 **Notion export** | Push highlights directly to a Notion page via integration token |
| 📋 **Markdown export** | Clean markdown with color labels, timestamps, and notes |
| 🌐 **Notebook export** | Beautiful standalone HTML with key highlights summary and table of contents |
| 🖼️ **Image clipping** | Right-click any image → save it to your highlight collection with alt text |
| 🔍 **Search & filter** | Search all highlights across every saved page |
| 🌙 **Dark mode** | Synced across devices via `chrome.storage.sync` |
| ⌨️ **Keyboard shortcuts** | Alt+1–4 to highlight, Escape to dismiss — hands on the keyboard |
| 🔒 **Privacy-first** | Everything in `chrome.storage.local` — no account, no server, no tracking |

---

## Screenshots

<p align="center">
  <img src="screenshots/panel-overview.png" alt="Mark side panel with highlights" width="100%" />
  <em>Side panel · This page · Library · 7-day activity strip</em>
</p>

<br/>

<p align="center">
  <img src="screenshots/youtube-transcript.png" alt="YouTube transcript panel with timestamps" width="100%" />
  <em>YouTube transcript panel — searchable, with timestamp-linked highlights</em>
</p>

<br/>

<p align="center">
  <img src="screenshots/obsidian-export.png" alt="Obsidian callout export" width="100%" />
  <em>Obsidian export — callout blocks with page title, domain, and timestamp</em>
</p>

---

## Install

### Chrome Web Store (recommended)

<a href="https://chromewebstore.google.com/detail/mark-web-highlighter">
  <img src="https://img.shields.io/badge/Add%20to%20Chrome-Free-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Add to Chrome" />
</a>

1. Click **Add to Chrome** → **Add extension**
2. Visit any webpage and select some text
3. Pick a highlight color — that's it

### Sideload (developer)

1. Clone this repo or download the latest zip from [Releases](../../releases)
2. Open `chrome://extensions/` → enable **Developer mode** → **Load unpacked**
3. Select the `mark-extension` folder

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt + 1` | Highlight yellow |
| `Alt + 2` | Highlight green |
| `Alt + 3` | Highlight blue |
| `Alt + 4` | Highlight red |
| `Escape` | Dismiss toolbar |

---

## Export Formats

| Format | How to use |
|---|---|
| **Markdown** | Menu → Markdown — exports all highlights as a `.md` file |
| **Obsidian** | Menu → Obsidian — `> [!quote]` callout blocks per page |
| **Notion** | Menu → Notion — enter your integration token once, push anytime |
| **HTML Notebook** | Menu → View all — standalone HTML with summary and TOC |
| **Per-page export** | Click `↓` next to any page section to export just that page |

---

## YouTube Transcripts

Mark injects a **Transcript** button into YouTube's action bar on every video with captions. Click it to open a searchable transcript panel above the sidebar:

- Switch between available languages
- Search within the transcript
- Select any line and highlight it — the exact video timestamp is stored with the highlight
- Jump back to that moment from your panel

---

## Privacy

Mark stores everything locally in `chrome.storage.local`. No data ever leaves your browser. No account required. No analytics. No tracking.

The only network requests Mark makes are:
- Loading favicons for the panel display (via Google's public favicon API)
- Notion API calls — only when you explicitly trigger an export

---

## Contributing

- **Bug reports** → [Open an issue](../../issues/new?labels=bug&template=bug_report.yml)
- **Feature requests** → [Open an issue](../../issues/new?labels=enhancement&title=Feature+Request%3A+)

---

<p align="center">
  <a href="https://chromewebstore.google.com/detail/mark-web-highlighter">
    <img src="https://img.shields.io/badge/Get%20Mark-Chrome%20Web%20Store-4285F4?style=for-the-badge&logo=googlechrome&logoColor=white" />
  </a>
</p>
