# Privacy Policy — Mark: Web Highlighter

**Last Updated: May 11, 2026**

---

## Overview

Mark ("the Extension") is committed to protecting your privacy. This policy explains what data the Extension touches, where it lives, and what never happens to it.

The short version: **everything stays on your device. Nothing is ever sent to a server we operate.**

---

## Data Collection

We do not collect any personal data.

Mark does not:

- Collect personal information
- Track user behavior
- Send highlight data to external servers
- Use analytics or tracking services
- Store data in the cloud
- Share data with third parties

---

## Local Storage Only

All highlight data is stored locally in your browser using Chrome's `chrome.storage.local` API.

**What we store locally:**

| Data | Description |
|---|---|
| Highlights | Text selections, color labels, page URL, page title, timestamp |
| Notes | Private notes attached to individual highlights |
| Image clips | Images you right-click and clip to your collection |
| YouTube highlights | Highlighted transcript lines with video timestamps |
| User preferences | Theme, export settings, UI state |

**Important:**

- This data **never** leaves your device
- No network transmission occurs for any of the above
- You can export all data to Markdown, Obsidian, or HTML at any time
- You can delete individual highlights, pages, or all data via the side panel
- Uninstalling the extension removes all stored data

---

## Outbound Network Requests

Mark makes exactly **two** outbound requests, both optional and user-initiated:

### 1. Google Favicon API
- **URL:** `https://www.google.com/s2/favicons`
- **When:** Automatically, to display page icons in the side panel
- **What's sent:** Only the domain name of pages you've highlighted (e.g., `example.com`)
- **What's not sent:** Your highlights, notes, or any personal data
- **Controlled by:** Google's own privacy policy — [policies.google.com/privacy](https://policies.google.com/privacy)

### 2. Notion API
- **URL:** `https://api.notion.com`
- **When:** Only when you explicitly click "Export to Notion"
- **What's sent:** The highlight text and notes you choose to export, plus your Notion integration token
- **Your token:** Stored locally in `chrome.storage.local` only — never transmitted to or stored by us
- **Controlled by:** You. If you never use Notion export, this request never fires.

---

## Permissions Explained

| Permission | Why it's needed |
|---|---|
| `storage` | Save highlights to `chrome.storage.local` and preferences to `chrome.storage.sync` |
| `unlimitedStorage` | Users may accumulate thousands of highlights over time; the standard 10 MB quota is insufficient |
| `activeTab` | Read the current tab's URL and title when saving a highlight |
| `scripting` | Inject the highlight restoration script when you revisit a page |
| `sidePanel` | Display the highlight library and controls in Chrome's native side panel |
| `tabs` | Detect tab navigation to restore highlights on the correct page |
| `contextMenus` | Add "Clip image with Mark" to the right-click menu on images |
| `host_permissions: <all_urls>` | Restore highlights on any page the user has previously highlighted |
| `host_permissions: api.notion.com` | Send highlights to Notion when you explicitly trigger a Notion export |

No permission is used for tracking, profiling, or analytics.

---

## Third-Party Services

We do not use any third-party services for analytics, advertising, or telemetry:

- No Google Analytics
- No tracking pixels or beacons
- No advertising networks
- No data brokers
- No cloud storage services
- No crash reporting (e.g., Sentry, Bugsnag)
- No A/B testing services

---

## Data Security

**Local storage security:**

- Uses Chrome's `chrome.storage.local` API
- Protected by Chrome's process sandboxing
- Only accessible by this extension — no other extension or website can read it

**No network transmission:**

- Zero highlight data leaves your device
- No external servers of ours are ever contacted
- All highlighting, searching, and filtering happens entirely on-device

---

## User Control

You have complete control over your data at all times:

- ✅ Export all highlights as Markdown (`.md`)
- ✅ Export to Obsidian-formatted callout blocks
- ✅ Push to Notion via your own integration token
- ✅ Export as a standalone HTML notebook
- ✅ Export per-page via the ↓ button next to any page
- ✅ Delete individual highlights
- ✅ Delete all highlights for a page
- ✅ Clear all data via Chrome's extension settings
- ✅ Uninstall the extension to remove everything
- ✅ No account creation required — ever

---

## Children's Privacy

Mark is a general-purpose reading and research tool intended for adults. We do not knowingly collect information from children under 13. Because no data is collected or transmitted, there is no personal data of any user — child or adult — on our servers.

---

## Changes to This Policy

If we make changes to this privacy policy:

- We will update the "Last Updated" date at the top
- Significant changes will be noted in the Chrome Web Store update description
- Continued use of the extension after changes constitutes acceptance

---

## Compliance

This extension is designed to comply with:

- Chrome Web Store Developer Program Policies
- General Data Protection Regulation (GDPR) — no data is collected or transferred outside the EU, because no data is collected at all
- California Consumer Privacy Act (CCPA) — no personal information is sold or shared

No data collection means no compliance complexity.

---

## Your Rights

Because we collect no data:

| Right | Status |
|---|---|
| Right to access | Nothing to access on our end — your data is already on your device |
| Right to deletion | Delete at any time via the side panel or Chrome settings |
| Right to export | Export anytime via Markdown, Obsidian, Notion, or HTML |
| Right to correction | Edit or delete any highlight directly |
| Right to portability | Full JSON-level access via the export features |

---

## Legal Disclaimer

Mark is an independent productivity tool. It is not affiliated with, endorsed by, or officially connected to any website or service it operates on.

---

## Contact & Support

Questions about this privacy policy?

- **Chrome Web Store:** [Mark — Web Highlighter](https://chrome.google.com/webstore/search/Mark%20Web%20Highlighter)
- **GitHub:** [github.com/sidbhat/mark-extension](https://github.com/sidbhat/mark-extension)

To report a security vulnerability, please open an issue on GitHub or contact via the Chrome Web Store support page.

---

## Summary

In plain English:

- We don't collect anything
- Everything stays on your computer
- You can export or delete everything at any time
- The only two outbound requests are: Google favicons (domain name only) and Notion (only if you choose to use it)
- No tracking, no analytics, no servers of ours

That's it.

---

*This privacy policy is effective as of May 11, 2026 and applies to version 1.1.0 and later.*
