chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'mark-delete',
    title: 'Remove highlight',
    contexts: ['selection'],
    documentUrlPatterns: ['<all_urls>']
  });
  chrome.contextMenus.create({
    id: 'mark-clip-image',
    title: 'Clip image with Mark',
    contexts: ['image'],
    documentUrlPatterns: ['<all_urls>']
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'mark-delete') {
    chrome.tabs.sendMessage(tab.id, { type: 'DELETE_HOVERED' }).catch(() => {});
  }
  if (info.menuItemId === 'mark-clip-image') {
    chrome.tabs.sendMessage(tab.id, {
      type: 'CLIP_IMAGE',
      src: info.srcUrl,
      pageUrl: info.pageUrl
    }).catch(() => {});
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    chrome.runtime.sendMessage({ type: 'TAB_CHANGED', url: tab.url, tabId }).catch(() => {});
  } catch {}
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    chrome.runtime.sendMessage({ type: 'TAB_CHANGED', url: tab.url, tabId }).catch(() => {});
  }

  // PDF intercept: redirect .pdf navigations to our viewer
  if (changeInfo.url && isPdfUrl(changeInfo.url)) {
    const viewerUrl = chrome.runtime.getURL('pdf/viewer.html') +
                      '?url=' + encodeURIComponent(changeInfo.url);
    chrome.tabs.update(tabId, { url: viewerUrl }).catch(() => {});
  }
});

function isPdfUrl(url) {
  if (!url) return false;
  // Skip if already in our viewer
  if (url.includes(chrome.runtime.id)) return false;
  // Skip Chrome internal URLs
  if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return false;
  try {
    const u = new URL(url);
    const path = u.pathname.toLowerCase();
    // Match .pdf extension, or explicit type param
    return path.endsWith('.pdf') ||
           path.endsWith('.pdf/') ||
           u.searchParams.get('type') === 'application/pdf' ||
           u.searchParams.get('format') === 'pdf';
  } catch { return false; }
}

// Relay HIGHLIGHTS_UPDATED from content scripts to the side panel.
// Content scripts can't always message side panels directly in MV3.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'HIGHLIGHTS_UPDATED' && sender.tab) {
    chrome.runtime.sendMessage(msg).catch(() => {});
  }
});
