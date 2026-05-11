'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let currentTabId  = null;
let currentUrl    = '';
let allHighlights = {};
let searchQuery   = '';

// Library infinite scroll
const LIBRARY_PAGE  = 10;
let libDomains      = [];
let libGroups       = {};
let libRendered     = 0;
let libObserver     = null;

// Pending delete (undo support)
let pendingDelete      = null;
let pendingDeleteTimer = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const searchInput   = document.getElementById('searchInput');
const searchClear   = document.getElementById('searchClear');
const pageFavicon   = document.getElementById('pageFavicon');
const pageDomain    = document.getElementById('pageDomain');
const pageCountPill = document.getElementById('pageCountPill');
const thisPageList  = document.getElementById('thisPageList');
const thisPageCount = document.getElementById('thisPageCount');
const libraryList   = document.getElementById('libraryList');
const libraryCount  = document.getElementById('libraryCount');
const emptyState    = document.getElementById('emptyState');
const panelContent  = document.getElementById('panelContent');
const toast         = document.getElementById('toast');
const notionSettings = document.getElementById('notionModalBackdrop');
const exportMenu    = document.getElementById('exportMenu');
const hlTooltip     = document.getElementById('hlTooltip');
const hlTooltipText = document.getElementById('hlTooltipText');
const hlTooltipNote = document.getElementById('hlTooltipNote');
const hlTooltipMeta = document.getElementById('hlTooltipMeta');

// ── Storage change watcher — stays in sync without message passing ────────────
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local') {
    // Surgically update only the changed URL slice — no full-blob replacement
    let dirty = false;
    for (const [key, change] of Object.entries(changes)) {
      if (!key.startsWith('hl:') || key === 'hl:index') continue;
      const url = key.slice(3);
      if (change.newValue && Array.isArray(change.newValue) && change.newValue.length) {
        allHighlights[url] = change.newValue;
      } else {
        delete allHighlights[url];
      }
      dirty = true;
    }
    if (dirty) render();
  }
  // Apply theme from another device syncing in
  if (area === 'sync' && changes.markTheme) {
    const theme = changes.markTheme.newValue ?? 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('mark-theme', theme);
    updateThemeBtn(theme === 'dark');
  }
});

// ── Message listener ──────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TAB_CHANGED') {
    loadHighlights()
      .then(() => chrome.tabs.query({ active: true, currentWindow: true }))
      .then(([tab]) => { if (tab) setCurrentTab(tab); render(); })
      .catch(console.error);
  }
  if (msg.type === 'HIGHLIGHT_CLICKED') {
    const row = document.querySelector(`.hl-row[data-id="${msg.id}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      row.style.background = 'var(--primary-glow)';
      setTimeout(() => { row.style.background = ''; }, 800);
    }
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  loadTheme();
  try { await migrateStorage(); } catch (e) { console.error('[Mark] Migration error:', e); }
  try { await loadHighlights(); } catch (e) { console.error('[Mark] Storage error:', e); }
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) setCurrentTab(tab);
  } catch (e) { console.error('[Mark] Tab query error:', e); }
  try { render(); } catch (e) { console.error('[Mark] Render error:', e); }
  wireEvents();
  loadNotionConfig();
}

async function migrateStorage() {
  // One-time migration: move old {highlights: {[url]: []}} blob → per-URL keys
  const { highlights, 'hl:index': idx } = await chrome.storage.local.get(['highlights', 'hl:index']);
  if (!highlights || typeof highlights !== 'object' || Array.isArray(highlights)) return;
  if (idx) return; // already migrated
  const newIndex = {};
  const toSet = {};
  for (const [url, hls] of Object.entries(highlights)) {
    if (!Array.isArray(hls) || !hls.length) continue;
    toSet['hl:' + url] = hls;
    const latest = hls.reduce((a, b) => a.createdAt > b.createdAt ? a : b);
    newIndex[url] = { count: hls.length, title: latest.title || '', lastAt: latest.createdAt };
  }
  toSet['hl:index'] = newIndex;
  await chrome.storage.local.set(toSet);
  await chrome.storage.local.remove('highlights');
}

async function loadHighlights() {
  // Load index (lightweight: url → {count, title, lastAt})
  const { 'hl:index': idx = {} } = await chrome.storage.local.get('hl:index');
  const urls = Object.keys(idx);
  if (!urls.length) {
    // Fallback: check old single-blob schema (pre-migration)
    const { highlights } = await chrome.storage.local.get('highlights');
    allHighlights = (highlights && typeof highlights === 'object' && !Array.isArray(highlights))
      ? highlights : {};
    return;
  }
  // Batch-load all per-URL keys
  const keys = urls.map(u => 'hl:' + u);
  const result = await chrome.storage.local.get(keys);
  allHighlights = {};
  for (const [k, hls] of Object.entries(result)) {
    if (k.startsWith('hl:') && Array.isArray(hls) && hls.length) {
      allHighlights[k.slice(3)] = hls;
    }
  }
}

function setCurrentTab(tab) {
  currentTabId = tab.id;
  currentUrl   = normalizeUrl(tab.url || '');
  try {
    const url = new URL(tab.url || '');
    pageDomain.textContent = cleanDomain(url.hostname);
    pageFavicon.src = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=16`;
    pageFavicon.onerror = () => { pageFavicon.style.display = 'none'; };
  } catch {
    pageDomain.textContent = currentUrl;
    pageFavicon.style.display = 'none';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function cleanDomain(host) {
  const h = host.replace(/^www\./, '');
  const parts = h.split('.');
  return parts.length > 4 ? parts.slice(-3).join('.') : h;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url);
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content',
     'fbclid','gclid','ref','source','mc_cid','mc_eid'].forEach(p => u.searchParams.delete(p));
    u.hash = '';
    return u.toString().replace(/\/$/, '') || url;
  } catch { return url; }
}

function inaccessibleUrl(url) {
  return !url || /^(chrome|chrome-extension|edge|about|data|blob|devtools):/.test(url);
}

function isPdfUrl(url) {
  return /\.pdf(\?.*)?$/i.test(url) || url.includes('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai');
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  const q = searchQuery.toLowerCase();

  // Search filter indicator
  const filterBar = document.getElementById('searchFilterBar');
  filterBar.style.display = searchQuery ? '' : 'none';
  if (searchQuery) document.getElementById('searchFilterQuery').textContent = `"${searchQuery}"`;

  const pageHls = (
    allHighlights[currentUrl] ||
    allHighlights[Object.keys(allHighlights).find(k => normalizeUrl(k) === currentUrl) || ''] ||
    []
  ).filter(h => !q || h.text.toLowerCase().includes(q) || (h.note||'').toLowerCase().includes(q));

  const totalAll = Object.values(allHighlights).reduce((s, a) => s + a.length, 0);

  pageCountPill.textContent = pageHls.length ? `${pageHls.length} mark${pageHls.length !== 1 ? 's' : ''}` : '';
  pageCountPill.style.display = pageHls.length ? '' : 'none';

  const hasAny = totalAll > 0;
  emptyState.classList.toggle('visible', !hasAny && !q);
  panelContent.style.display = hasAny || q ? '' : 'none';

  renderThisPage(pageHls);
  renderLibrary(q);
  renderActivityStrip();
}

function renderActivityStrip() {
  const strip = document.getElementById('activityStrip');
  if (!strip) return;

  // Count highlights per day for the last 7 days (today = index 6)
  const now = Date.now();
  const DAY = 86400000;
  const counts = Array(7).fill(0);
  const dayLabels = ['S','M','T','W','T','F','S'];

  Object.values(allHighlights).flat().forEach(h => {
    const age = Math.floor((now - h.createdAt) / DAY);
    if (age >= 0 && age < 7) counts[6 - age]++;
  });

  const maxCount = Math.max(1, ...counts);
  strip.innerHTML = '';

  // Day-of-week labels aligned with actual days
  const todayDow = new Date().getDay(); // 0=Sun

  counts.forEach((count, i) => {
    const dayOffset = i - 6; // -6 = 6 days ago, 0 = today
    const dow = ((todayDow + dayOffset) % 7 + 7) % 7;
    const cell = document.createElement('div');
    cell.className = 'activity-cell';
    cell.title = count ? `${count} highlight${count !== 1 ? 's' : ''} on this day` : 'No highlights';
    const intensity = count === 0 ? 0 : Math.ceil((count / maxCount) * 3);
    cell.dataset.level = intensity; // 0-3
    const label = document.createElement('span');
    label.className = 'activity-label';
    label.textContent = dayLabels[dow];
    cell.appendChild(label);
    strip.appendChild(cell);
  });
}

function renderThisPage(hls) {
  thisPageCount.textContent = hls.length ? `(${hls.length})` : '';
  document.getElementById('pageExportWrap').style.display = hls.length ? '' : 'none';
  document.getElementById('summaryBtn').style.display     = hls.length ? '' : 'none';
  thisPageList.innerHTML = '';
  if (!hls.length) {
    thisPageList.innerHTML = `<div class="no-results">${searchQuery ? 'No matches on this page' : 'No highlights on this page yet'}</div>`;
  } else {
    hls.slice().reverse().forEach(hl => thisPageList.appendChild(buildHlRow(hl, false)));
  }
  refreshSectionHeight('thisPageList');
}

function renderLibrary(q) {
  libraryList.innerHTML = '';
  libDomains  = [];
  libGroups   = {};
  libRendered = 0;

  if (libObserver) { libObserver.disconnect(); libObserver = null; }

  const groups = {};
  Object.entries(allHighlights).forEach(([url, hls]) => {
    const filtered = q
      ? hls.filter(h => h.text.toLowerCase().includes(q) || (h.note||'').toLowerCase().includes(q))
      : hls;
    if (!filtered.length) return;
    try {
      const domain = cleanDomain(new URL(url).hostname);
      if (!groups[domain]) groups[domain] = [];
      filtered.forEach(h => groups[domain].push({ ...h, pageUrl: url }));
    } catch {}
  });

  const domainList = Object.keys(groups).sort((a, b) => {
    const latestA = Math.max(...groups[a].map(h => h.createdAt));
    const latestB = Math.max(...groups[b].map(h => h.createdAt));
    return latestB - latestA;
  });

  const total = Object.values(groups).reduce((s, a) => s + a.length, 0);
  libraryCount.textContent = total ? `(${total})` : '';

  if (!domainList.length) {
    libraryList.innerHTML = `<div class="no-results">${q ? 'No matches found' : 'Your highlights will appear here'}</div>`;
    return;
  }

  libDomains = domainList;
  libGroups  = groups;

  const sentinel = document.createElement('div');
  sentinel.className = 'lib-sentinel';
  libraryList.appendChild(sentinel);

  libObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) renderLibraryChunk();
  }, { rootMargin: '120px' });
  libObserver.observe(sentinel);

  renderLibraryChunk();
}

function renderLibraryChunk() {
  const sentinel = libraryList.querySelector('.lib-sentinel');
  if (!sentinel) return;

  const end = Math.min(libRendered + LIBRARY_PAGE, libDomains.length);
  for (let i = libRendered; i < end; i++) {
    const domain = libDomains[i];
    const hls    = libGroups[domain];

    const group  = document.createElement('div');
    group.className = 'domain-group';

    const header = document.createElement('div');
    header.className = 'domain-header';
    header.innerHTML = `
      <img class="domain-favicon" src="https://www.google.com/s2/favicons?domain=${escH(domain)}&sz=16" onerror="this.style.display='none'">
      <span class="domain-name">${escH(domain)}</span>
      <span class="domain-count">${hls.length} mark${hls.length !== 1 ? 's' : ''}</span>
    `;

    const rows = document.createElement('div');
    rows.className = 'domain-rows';
    hls.slice().reverse().forEach(hl => rows.appendChild(buildHlRow(hl, false)));

    header.addEventListener('click', () => {
      rows.style.display = rows.style.display === 'none' ? '' : 'none';
    });

    group.appendChild(header);
    group.appendChild(rows);
    libraryList.insertBefore(group, sentinel);
  }
  libRendered = end;

  // Update or remove the "more sites" indicator
  const existing = libraryList.querySelector('.lib-more');
  if (existing) existing.remove();
  if (libRendered < libDomains.length) {
    const more = document.createElement('div');
    more.className = 'lib-more';
    more.textContent = `↓ ${libDomains.length - libRendered} more site${libDomains.length - libRendered !== 1 ? 's' : ''} — scroll to load`;
    libraryList.insertBefore(more, sentinel);
  }

  if (libRendered >= libDomains.length) {
    libObserver.disconnect();
    libObserver = null;
    sentinel.remove();
  }
  refreshSectionHeight('libraryList');
}

// ── Build a highlight row ─────────────────────────────────────────────────────
function buildHlRow(hl, showDomain) {
  const row = document.createElement('div');
  row.className = 'hl-row';
  row.dataset.id = hl.id;

  const colorBar = document.createElement('div');
  colorBar.className = 'hl-color-bar';
  colorBar.dataset.color = hl.color;

  const body = document.createElement('div');
  body.className = 'hl-body';

  // ── Image clip row ──────────────────────────────────────────────────────────
  if (hl.type === 'image') {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'hl-image-wrap';
    const thumb = document.createElement('img');
    thumb.className = 'hl-image-thumb';
    thumb.src = hl.src;
    thumb.alt = hl.alt || '';
    thumb.loading = 'lazy';
    thumb.onerror = () => { thumb.style.display = 'none'; };
    imgWrap.appendChild(thumb);
    if (hl.alt) {
      const altEl = document.createElement('span');
      altEl.className = 'hl-image-alt';
      altEl.textContent = hl.alt;
      imgWrap.appendChild(altEl);
    }
    body.appendChild(imgWrap);

    const meta = document.createElement('div');
    meta.className = 'hl-meta';
    const parts = [relativeTime(hl.createdAt)];
    if (showDomain && hl.pageUrl) {
      try { parts.unshift(cleanDomain(new URL(hl.pageUrl).hostname)); } catch {}
    }
    meta.textContent = parts.join(' · ');
    body.appendChild(meta);

    if (hl.note) {
      const note = document.createElement('div');
      note.className = 'hl-note';
      note.textContent = `📝 ${hl.note}`;
      body.appendChild(note);
    }

    const actions = document.createElement('div');
    actions.className = 'hl-actions';
    const noteBtn = document.createElement('button');
    noteBtn.className = 'hl-action-btn';
    noteBtn.title = hl.note ? 'Edit note' : 'Add note';
    noteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11 2l3 3-8 8H3v-3l8-8z"/></svg>';
    noteBtn.addEventListener('click', e => { e.stopPropagation(); showInlineNoteEditor(body, hl); });
    const copyBtn = document.createElement('button');
    copyBtn.className = 'hl-action-btn';
    copyBtn.title = 'Copy image URL';
    copyBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1"/></svg>';
    copyBtn.addEventListener('click', e => { e.stopPropagation(); navigator.clipboard.writeText(hl.src).then(() => showToast('URL copied!')); });
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'hl-action-btn danger';
    deleteBtn.title = 'Delete';
    deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"/></svg>';
    deleteBtn.addEventListener('click', e => { e.stopPropagation(); deleteHighlight(hl.id, hl.pageUrl || currentUrl); });
    actions.appendChild(noteBtn);
    actions.appendChild(copyBtn);
    actions.appendChild(deleteBtn);
    row.appendChild(colorBar);
    row.appendChild(body);
    row.appendChild(actions);
    return row;
  }

  // ── Text highlight row (default) ────────────────────────────────────────────
  const preview = document.createElement('div');
  preview.className = `hl-preview hl-preview--${hl.color}`;
  preview.textContent = hl.text;
  body.appendChild(preview);

  if (hl.note) {
    const note = document.createElement('div');
    note.className = 'hl-note';
    note.textContent = `📝 ${hl.note}`;
    body.appendChild(note);
  }

  const meta = document.createElement('div');
  meta.className = 'hl-meta';
  const parts = [relativeTime(hl.createdAt)];
  if (showDomain && hl.pageUrl) {
    try {
      const label = hl.title
        ? (hl.title.length > 38 ? hl.title.slice(0, 36) + '…' : hl.title)
        : cleanDomain(new URL(hl.pageUrl).hostname);
      parts.unshift(label);
    } catch {}
  }
  meta.textContent = parts.join(' · ');

  // YouTube timestamp link
  if (hl.timestamp != null) {
    const sep = document.createTextNode(' · ');
    const link = document.createElement('a');
    link.href = (() => {
      try {
        const u = new URL(hl.url);
        u.searchParams.set('t', hl.timestamp);
        return u.toString();
      } catch { return '#'; }
    })();
    link.target = '_blank';
    link.rel = 'noopener';
    link.style.cssText = 'color:var(--primary);text-decoration:none;';
    link.textContent = `⏱ ${formatTimestamp(hl.timestamp)}`;
    link.addEventListener('click', e => e.stopPropagation());
    meta.appendChild(sep);
    meta.appendChild(link);
  }

  body.appendChild(meta);

  // ── Actions ──
  const actions = document.createElement('div');
  actions.className = 'hl-actions';

  // Color dots
  const colorDots = document.createElement('div');
  colorDots.className = 'hl-color-dots';
  ['yellow', 'green', 'blue', 'red'].forEach(c => {
    const dot = document.createElement('button');
    dot.className = `hl-color-dot${c === hl.color ? ' active' : ''}`;
    dot.dataset.color = c;
    dot.title = `Change to ${c}`;
    dot.addEventListener('click', async e => {
      e.stopPropagation();
      await changeHighlightColor(hl.id, hl.pageUrl || currentUrl, c);
    });
    colorDots.appendChild(dot);
  });

  const copyBtn = document.createElement('button');
  copyBtn.className = 'hl-action-btn';
  copyBtn.title = 'Copy text';
  copyBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M3 11H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v1"/></svg>';
  copyBtn.addEventListener('click', e => {
    e.stopPropagation();
    navigator.clipboard.writeText(hl.text).then(() => showToast('Copied!'));
  });

  const noteBtn = document.createElement('button');
  noteBtn.className = 'hl-action-btn';
  noteBtn.title = hl.note ? 'Edit note' : 'Add note';
  noteBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M11 2l3 3-8 8H3v-3l8-8z"/></svg>';
  noteBtn.addEventListener('click', e => { e.stopPropagation(); showInlineNoteEditor(body, hl); });

  const jumpBtn = document.createElement('button');
  jumpBtn.className = 'hl-action-btn';
  jumpBtn.title = 'Jump to highlight';
  jumpBtn.innerHTML = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 12L12 4M7 4h5v5"/></svg>';
  jumpBtn.addEventListener('click', e => { e.stopPropagation(); jumpToHighlight(hl.id, hl.pageUrl || currentUrl); });

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'hl-action-btn danger';
  deleteBtn.title = 'Delete';
  deleteBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 4h12M5 4V2h6v2M6 7v5M10 7v5M3 4l1 10h8l1-10"/></svg>';
  deleteBtn.addEventListener('click', e => { e.stopPropagation(); deleteHighlight(hl.id, hl.pageUrl || currentUrl); });

  actions.appendChild(colorDots);
  actions.appendChild(copyBtn);
  actions.appendChild(noteBtn);
  actions.appendChild(jumpBtn);
  actions.appendChild(deleteBtn);

  row.appendChild(colorBar);
  row.appendChild(body);
  row.appendChild(actions);

  row.addEventListener('mouseenter', () => showHlTooltip(row, hl));
  row.addEventListener('mouseleave', hideHlTooltip);
  row.addEventListener('click', () => jumpToHighlight(hl.id, hl.pageUrl || currentUrl));
  return row;
}

// ── Inline note editor ────────────────────────────────────────────────────────
function showInlineNoteEditor(body, hl) {
  const existing = body.querySelector('.hl-note-editor');
  if (existing) { existing.remove(); return; }

  const editor = document.createElement('div');
  editor.className = 'hl-note-editor';

  const textarea = document.createElement('textarea');
  textarea.className = 'hl-note-textarea';
  textarea.value = hl.note || '';
  textarea.placeholder = 'Add a note…';

  const btnRow = document.createElement('div');
  btnRow.className = 'hl-note-btn-row';

  const saveBtn   = document.createElement('button');
  saveBtn.className = 'hl-note-save';
  saveBtn.textContent = 'Save';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'hl-note-cancel';
  cancelBtn.textContent = 'Cancel';

  saveBtn.addEventListener('click', async () => {
    const note = textarea.value.trim();
    const url  = normalizeUrl(hl.pageUrl || currentUrl);
    const arr  = allHighlights[url];
    if (arr) {
      const h = arr.find(h => h.id === hl.id);
      if (h) h.note = note;
      await chrome.storage.local.set({ ['hl:' + url]: arr });
    }
    if (currentTabId) chrome.tabs.sendMessage(currentTabId, { type: 'UPDATE_NOTE', id: hl.id, note }).catch(() => {});
  });

  cancelBtn.addEventListener('click', () => editor.remove());

  btnRow.appendChild(saveBtn);
  btnRow.appendChild(cancelBtn);
  editor.appendChild(textarea);
  editor.appendChild(btnRow);
  body.appendChild(editor);
  textarea.focus();
}

// ── Change highlight color ────────────────────────────────────────────────────
async function changeHighlightColor(id, url, newColor) {
  const arr = allHighlights[url];
  if (arr) {
    const h = arr.find(h => h.id === id);
    if (h) h.color = newColor;
    await chrome.storage.local.set({ ['hl:' + url]: arr });
  }
  if (currentTabId) chrome.tabs.sendMessage(currentTabId, { type: 'CHANGE_COLOR', id, color: newColor }).catch(() => {});
}

// ── Jump to highlight ─────────────────────────────────────────────────────────
async function jumpToHighlight(id, url) {
  if (inaccessibleUrl(url)) { showToast("Can't access this page type"); return; }
  if (isPdfUrl(url)) {
    showToast("PDFs aren't supported for highlighting");
    return;
  }

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    const sameUrl = normalizeUrl(tab.url) === normalizeUrl(url);

    if (sameUrl) {
      // Always retry — the highlight may need restoring after a page rebuild
      retryScroll(tab.id, id);
    } else {
      await chrome.tabs.update(tab.id, { url });
      chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId !== tab.id || info.status !== 'complete') return;
        chrome.tabs.onUpdated.removeListener(listener);
        retryScroll(tab.id, id);
      });
    }
  } catch {}
}

async function retryScroll(tabId, id, attempts = 8, delay = 300) {
  for (let i = 0; i < attempts; i++) {
    await new Promise(r => setTimeout(r, delay + i * 200));
    const found = await sendScrollMessage(tabId, id);
    if (found) return;
  }
  showToast('Highlight not visible — try refreshing the page');
}

function sendScrollMessage(tabId, id) {
  return new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, { type: 'SCROLL_TO_HIGHLIGHT', id }, res => {
      if (chrome.runtime.lastError) { resolve(false); return; }
      resolve(res?.found ?? false);
    });
  });
}

// ── Delete highlight (with undo) ──────────────────────────────────────────────
async function deleteHighlight(id, url) {
  const arr = allHighlights[url];
  if (!arr) return;
  const hlCopy = arr.find(h => h.id === id);
  if (!hlCopy) return;

  // Optimistically remove from memory + UI
  allHighlights[url] = arr.filter(h => h.id !== id);
  if (!allHighlights[url].length) delete allHighlights[url];
  render();

  // Remove from page immediately for visual feedback
  if (currentTabId) chrome.tabs.sendMessage(currentTabId, { type: 'DELETE_HIGHLIGHT', id }).catch(() => {});

  // Arm undo window (3 s before committing to storage)
  clearTimeout(pendingDeleteTimer);
  pendingDelete = { id, url, hl: { ...hlCopy } };

  showToast('Highlight removed', 3000, 'Undo', async () => {
    clearTimeout(pendingDeleteTimer);
    if (!pendingDelete || pendingDelete.id !== id) return;
    // Restore in memory and storage
    if (!allHighlights[pendingDelete.url]) allHighlights[pendingDelete.url] = [];
    allHighlights[pendingDelete.url].push(pendingDelete.hl);
    allHighlights[pendingDelete.url].sort((a, b) => a.createdAt - b.createdAt);
    const restoredUrl = pendingDelete.url;
    await chrome.storage.local.set({ ['hl:' + restoredUrl]: allHighlights[restoredUrl] });
    if (currentTabId) chrome.tabs.sendMessage(currentTabId, { type: 'RESTORE_HIGHLIGHT', hl: pendingDelete.hl }).catch(() => {});
    pendingDelete = null;
  });

  pendingDeleteTimer = setTimeout(async () => {
    if (pendingDelete?.id === id) {
      const delUrl = pendingDelete.url;
      const remaining = allHighlights[delUrl];
      if (remaining && remaining.length) {
        await chrome.storage.local.set({ ['hl:' + delUrl]: remaining });
      } else {
        await chrome.storage.local.remove('hl:' + delUrl);
        // Update index
        const { 'hl:index': idx = {} } = await chrome.storage.local.get('hl:index');
        delete idx[delUrl];
        await chrome.storage.local.set({ 'hl:index': idx });
      }
      pendingDelete = null;
    }
  }, 3000);
}

// ── Export: Markdown ──────────────────────────────────────────────────────────
function exportHighlights(urlFilter = null) {
  const entries = urlFilter
    ? Object.entries(allHighlights).filter(([u]) => normalizeUrl(u) === normalizeUrl(urlFilter))
    : Object.entries(allHighlights);
  let md = `# Mark — Highlights Export\n_${new Date().toLocaleDateString()}_\n\n`;
  entries.forEach(([url, hls]) => {
    if (!hls.length) return;
    md += `## ${url}\n\n`;
    hls.forEach(h => {
      md += `- **[${h.color}]** "${h.text}"`;
      if (h.note) md += `\n  > ${h.note}`;
      md += `\n  _${new Date(h.createdAt).toLocaleString()}_\n\n`;
    });
  });
  download(md, `mark-highlights-${Date.now()}.md`, 'text/markdown');
  showToast('Exported as Markdown');
}

// ── Export: Obsidian ──────────────────────────────────────────────────────────
function exportObsidian(urlFilter = null) {
  const entries = urlFilter
    ? Object.entries(allHighlights).filter(([u]) => normalizeUrl(u) === normalizeUrl(urlFilter))
    : Object.entries(allHighlights);
  const date = new Date().toISOString().split('T')[0];
  const emoji = { yellow: '🟡', green: '🟢', blue: '🔵', red: '🔴' };
  let md = `---\ntags:\n  - highlights\n  - mark\ncreated: ${date}\n---\n\n# Mark Highlights\n\n`;

  entries.forEach(([url, hls]) => {
    if (!hls.length) return;
    let domain;
    try { domain = cleanDomain(new URL(url).hostname); } catch { domain = url; }
    const pageTitle = hls[0]?.title || domain;
    const safeUrl = url.replace(/\(/g, '%28').replace(/\)/g, '%29');
    md += `## [${pageTitle}](${safeUrl})\n`;
    if (pageTitle !== domain) md += `*${domain}*\n`;
    md += '\n';
    hls.forEach(h => {
      const body = h.text.trim().replace(/\n/g, '\n> ');
      md += `> [!quote] ${emoji[h.color] || '⬜'}\n> ${body}\n`;
      if (h.note) md += `>\n> 📝 ${h.note.replace(/\n/g, '\n> ')}\n`;
      md += `> — *${new Date(h.createdAt).toLocaleString()}*\n\n`;
    });
  });

  download(md, `mark-obsidian-${date}.md`, 'text/markdown');
  showToast('Exported for Obsidian');
}

// ── Export: Notebook HTML (opens in tab) ──────────────────────────────────────
function exportNotebook() {
  const html = buildNotebookHtml();
  const blob = new Blob([html], { type: 'text/html' });
  const url  = URL.createObjectURL(blob);
  chrome.tabs.create({ url }, () => URL.revokeObjectURL(url));
  showToast('Opened in new tab');
}

function buildNotebookHtml() {
  const date = new Date().toISOString().split('T')[0];

  const colorBar = { yellow: '#FBBF24', green: '#10B981', blue: '#3B9EFF', red: '#EF4444' };
  const colorBg  = {
    yellow: 'rgba(251,191,36,0.08)', green: 'rgba(16,185,129,0.07)',
    blue: 'rgba(59,158,255,0.07)',   red: 'rgba(239,68,68,0.07)',
  };

  // Group by domain, sort by most-recent
  const groups = {};
  Object.entries(allHighlights).forEach(([url, hls]) => {
    if (!hls.length) return;
    try {
      const domain = cleanDomain(new URL(url).hostname);
      if (!groups[domain]) groups[domain] = [];
      hls.forEach(h => groups[domain].push({ ...h, pageUrl: url }));
    } catch {}
  });

  const domains = Object.keys(groups).sort((a, b) => {
    const la = Math.max(...groups[a].map(h => h.createdAt));
    const lb = Math.max(...groups[b].map(h => h.createdAt));
    return lb - la;
  });

  const totalCount = Object.values(groups).reduce((s, a) => s + a.length, 0);

  // Summary: notes-bearing first, then longest — top 5
  const allHls = Object.values(groups).flat();
  const topHls = allHls.slice().sort((a, b) => {
    const aN = a.note ? 1 : 0, bN = b.note ? 1 : 0;
    if (bN !== aN) return bN - aN;
    return b.text.length - a.text.length;
  }).slice(0, 5);

  // Stable anchor id from domain string
  function anchorId(domain) {
    return 'src-' + domain.replace(/[^a-z0-9]/gi, '-');
  }

  // Show path after domain to distinguish multiple pages from same site
  function pagePath(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\/$/, '');
      return path.length > 1 ? (cleanDomain(u.hostname) + path) : cleanDomain(u.hostname);
    } catch { return url; }
  }

  const summaryHtml = topHls.length ? `
<section class="nb-summary">
  <div class="nb-summary-title">Key highlights</div>
  <div class="nb-summary-sub">Top ${topHls.length} of ${totalCount} · annotated first, then longest</div>
  <div class="nb-summary-cards">
    ${topHls.map(h => {
      const bar  = colorBar[h.color] || '#C2CBDA';
      const body = escH(h.text.length > 220 ? h.text.slice(0, 217) + '…' : h.text);
      const note = h.note ? `<div class="nb-summary-note">📝 ${escH(h.note)}</div>` : '';
      return `<a class="nb-summary-card" href="#hl-${h.id}">
        <div class="nb-summary-bar" style="background:${bar}"></div>
        <div class="nb-summary-body"><div class="nb-summary-text">${body}</div>${note}</div>
      </a>`;
    }).join('')}
  </div>
</section>` : '';

  // TOC — only rendered when there are multiple domains
  const tocHtml = domains.length > 1 ? `
<nav class="nb-toc">
  <div class="nb-toc-title">Contents</div>
  ${domains.map(d => `<a class="nb-toc-item" href="#${anchorId(d)}">
    <img src="https://www.google.com/s2/favicons?domain=${escH(d)}&sz=16" width="12" height="12" onerror="this.style.display='none'" alt="">
    <span>${escH(d)}</span>
    <span class="nb-toc-count">${groups[d].length}</span>
  </a>`).join('')}
</nav>` : '';

  const sectionsHtml = domains.map(domain => {
    const hls = groups[domain].slice().sort((a, b) => b.createdAt - a.createdAt);

    // Most recent URL → domain header link
    const headerUrl = hls[0]?.pageUrl || '';

    const cardsHtml = hls.map(h => {
      const bar      = colorBar[h.color] || '#C2CBDA';
      const bg       = colorBg[h.color]  || 'transparent';
      const noteHtml = h.note ? `<div class="nb-note">📝 ${escH(h.note)}</div>` : '';
      const srcLabel = escH(pagePath(h.pageUrl || ''));
      const srcHref  = escH(h.pageUrl || '');
      return `<div class="nb-card" id="hl-${h.id}" style="border-left-color:${bar};background:${bg}">
        <blockquote>${escH(h.text)}</blockquote>
        ${noteHtml}
        <div class="nb-meta">
          <a href="${srcHref}" target="_blank" rel="noopener">↗ ${srcLabel}</a>
          &middot; ${relativeTime(h.createdAt)}
        </div>
      </div>`;
    }).join('');

    return `<section class="nb-domain" id="${anchorId(domain)}">
      <div class="nb-domain-header">
        <img src="https://www.google.com/s2/favicons?domain=${escH(domain)}&sz=16" width="14" height="14" onerror="this.style.display='none'" alt="">
        <a class="nb-domain-name" href="${escH(headerUrl)}" target="_blank" rel="noopener">${escH(domain)}</a>
        <span class="nb-domain-count">${hls.length} highlight${hls.length !== 1 ? 's' : ''}</span>
        <a class="nb-domain-top" href="#">↑ top</a>
      </div>
      ${cardsHtml}
    </section>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Mark Highlights — ${date}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#F8FAFC;color:#0F172A;line-height:1.5;min-height:100vh}
a{color:#0070F2;text-decoration:none}a:hover{text-decoration:underline}
.nb-header{background:linear-gradient(135deg,#0070F2 0%,#0054A6 100%);color:#fff;padding:14px 20px}
.nb-header-inner{max-width:760px;margin:0 auto;display:flex;align-items:center;gap:10px}
.nb-hicon{width:28px;height:28px;background:rgba(255,255,255,0.2);border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}
.nb-htext{flex:1;min-width:0}
.nb-title{font-size:18px;font-weight:800;color:#fff;letter-spacing:0.3px;line-height:1.1}
.nb-tagline{font-size:12px;color:rgba(255,255,255,0.88);font-weight:500;margin-top:2px}
.nb-hmeta{font-size:12px;color:rgba(255,255,255,0.7);text-align:right;flex-shrink:0}
.nb-main{max-width:760px;margin:0 auto;padding:32px 20px 80px}
/* Summary */
.nb-summary{background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:18px;margin-bottom:28px}
.nb-summary-title{font-size:15px;font-weight:700;color:#0F172A;margin-bottom:3px}
.nb-summary-sub{font-size:12px;color:#94A3B8;margin-bottom:14px}
.nb-summary-cards{display:flex;flex-direction:column;gap:8px}
.nb-summary-card{display:flex;gap:10px;padding:10px;border-radius:8px;background:#F8FAFC;border:1px solid #F1F5F9;text-decoration:none;transition:background 0.1s}
.nb-summary-card:hover{background:#EFF6FF;text-decoration:none}
.nb-summary-bar{width:3px;border-radius:2px;flex-shrink:0;align-self:stretch;min-height:16px}
.nb-summary-body{flex:1;min-width:0}
.nb-summary-text{font-size:13px;color:#1E293B;line-height:1.5}
.nb-summary-note{font-size:12px;color:#0070F2;margin-top:4px;font-style:italic}
/* TOC */
.nb-toc{background:#fff;border:1px solid #E2E8F0;border-radius:10px;padding:16px 18px;margin-bottom:36px;display:flex;flex-direction:column;gap:2px}
.nb-toc-title{font-size:11px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:8px}
.nb-toc-item{display:flex;align-items:center;gap:7px;padding:5px 6px;border-radius:6px;font-size:13px;color:#334155;transition:background 0.1s}
.nb-toc-item:hover{background:#F1F5F9;text-decoration:none}
.nb-toc-item span:nth-child(2){flex:1}
.nb-toc-count{font-size:11px;color:#94A3B8;font-weight:500}
/* Domain section */
.nb-domain{margin-bottom:40px;scroll-margin-top:20px}
.nb-domain-header{display:flex;align-items:center;gap:8px;padding:0 0 10px;border-bottom:1.5px solid #E2E8F0;margin-bottom:14px}
.nb-domain-header img{border-radius:2px;flex-shrink:0}
.nb-domain-name{font-size:14px;font-weight:700;color:#0F172A;flex:1}
.nb-domain-name:hover{color:#0070F2;text-decoration:underline}
.nb-domain-count{font-size:12px;color:#94A3B8;flex-shrink:0}
.nb-domain-top{font-size:11px;color:#CBD5E1;margin-left:8px;flex-shrink:0;transition:color 0.1s}
.nb-domain-top:hover{color:#0070F2;text-decoration:none}
/* Cards */
.nb-card{border-left:4px solid #C2CBDA;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:10px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,0.06)}
blockquote{font-size:15px;line-height:1.75;color:#1E293B;font-style:italic;quotes:none;white-space:pre-wrap;word-break:break-word}
.nb-note{font-size:13px;color:#0070F2;margin-top:8px;font-style:normal}
.nb-meta{font-size:12px;color:#94A3B8;margin-top:8px}
.nb-meta a{color:#64748B}
.nb-meta a:hover{color:#0070F2}
.nb-empty{text-align:center;padding:64px 24px;font-size:15px;color:#94A3B8}
/* Back to top */
.nb-top{position:fixed;bottom:24px;right:24px;width:36px;height:36px;border-radius:50%;background:#0070F2;color:#fff;font-size:16px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,112,242,0.4);opacity:0;transition:opacity 0.2s;pointer-events:none;text-decoration:none}
.nb-top.visible{opacity:1;pointer-events:all}
</style>
</head>
<body>
<header class="nb-header">
  <div class="nb-header-inner">
    <div class="nb-hicon">✏️</div>
    <div class="nb-htext">
      <div class="nb-title">Mark</div>
      <div class="nb-tagline">Highlight the web</div>
    </div>
    <div class="nb-hmeta">${totalCount} highlight${totalCount !== 1 ? 's' : ''} &middot; ${date}</div>
  </div>
</header>
<main class="nb-main">
${summaryHtml}
${tocHtml}
${sectionsHtml || '<div class="nb-empty">No highlights to export.</div>'}
</main>
<a class="nb-top" id="nbTop" href="#">↑</a>
<script>
const btn = document.getElementById('nbTop');
window.addEventListener('scroll', () => btn.classList.toggle('visible', window.scrollY > 300), { passive: true });
</script>
</body>
</html>`;
}

// ── Export: Notion ────────────────────────────────────────────────────────────
let pendingNotionUrlFilter = null;

async function exportToNotion(urlFilter = null) {
  pendingNotionUrlFilter = urlFilter;
  showNotionSettings(true);
}

async function pushToNotion(token, rawPageId, urlFilter = null) {
  const pageId = parseNotionPageId(rawPageId);
  if (!pageId) { showToast('Invalid Notion page ID — paste the full page URL or 32-char ID', 5000); return; }

  showToast('Exporting to Notion…');
  try {
    const blocks = buildNotionBlocks(urlFilter);
    const CHUNK  = 90;
    const NOTION_HEADERS = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Notion-Version': '2022-06-28',
    };

    const res = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: NOTION_HEADERS,
      body: JSON.stringify({
        parent: { page_id: pageId },
        properties: {
          title: { title: [{ type: 'text', text: { content: `Mark Highlights — ${new Date().toLocaleString()}` } }] },
        },
        children: blocks.slice(0, CHUNK),
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      const detail = err.message || err.code || `HTTP ${res.status}`;
      console.error('[Mark] Notion API error:', res.status, err);
      throw new Error(detail);
    }

    const page = await res.json();

    for (let i = CHUNK; i < blocks.length; i += CHUNK) {
      const chunkRes = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children`, {
        method: 'PATCH',
        headers: NOTION_HEADERS,
        body: JSON.stringify({ children: blocks.slice(i, i + CHUNK) }),
      });
      if (!chunkRes.ok) {
        const err = await chunkRes.json().catch(() => ({}));
        console.error('[Mark] Notion chunk error:', chunkRes.status, err);
      }
    }

    showToast('Exported to Notion ✓');
    chrome.tabs.create({ url: page.url });
  } catch (e) {
    console.error('[Mark] Notion export failed:', e);
    showToast(`Notion error: ${e.message}`, 6000);
  }
}

function notionText(s, max = 1999) {
  if (!s) return '';
  return s.length > max ? s.slice(0, max) + '…' : s;
}

function buildNotionBlocks(urlFilter = null) {
  const entries = urlFilter
    ? Object.entries(allHighlights).filter(([u]) => normalizeUrl(u) === normalizeUrl(urlFilter))
    : Object.entries(allHighlights);
  const blocks = [];
  entries.forEach(([url, hls]) => {
    if (!hls.length) return;
    let domain;
    try { domain = cleanDomain(new URL(url).hostname); } catch { domain = url; }

    blocks.push({ object: 'block', type: 'heading_2',
      heading_2: { rich_text: [{ type: 'text', text: { content: notionText(domain) } }] } });
    blocks.push({ object: 'block', type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: notionText(url, 2000), link: { url: url.slice(0, 2000) } } }] } });

    hls.forEach(h => {
      blocks.push({ object: 'block', type: 'quote',
        quote: { rich_text: [{ type: 'text', text: { content: notionText(h.text) } }], color: notionColor(h.color) } });
      if (h.note) {
        blocks.push({ object: 'block', type: 'callout',
          callout: { rich_text: [{ type: 'text', text: { content: notionText(h.note) } }], icon: { type: 'emoji', emoji: '📝' } } });
      }
    });
    blocks.push({ object: 'block', type: 'divider', divider: {} });
  });
  return blocks;
}

function parseNotionPageId(input) {
  // Strip query params and fragment, then take the last path segment
  const clean = input.split('?')[0].split('#')[0].trim();
  const last  = clean.split('/').pop() || clean;
  // Strip hyphens from that segment and match 32 hex chars anchored at the END
  const stripped = last.replace(/-/g, '');
  const tail = stripped.match(/([0-9a-f]{32})$/i);
  if (tail) return tail[1];
  // Fallback: plain 32-char hex (no path context)
  const raw = clean.replace(/-/g, '').match(/^([0-9a-f]{32})$/i);
  return raw ? raw[1] : null;
}

function notionColor(c) {
  return { yellow: 'yellow_background', green: 'green_background', blue: 'blue_background', red: 'red_background' }[c] || 'default';
}

// ── Download helper ───────────────────────────────────────────────────────────
function download(content, filename, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = filename;
  a.click();
}

// ── Notion settings ───────────────────────────────────────────────────────────
async function loadNotionConfig() {
  const { notionToken = '', notionPageId = '' } = await chrome.storage.sync.get(['notionToken', 'notionPageId']);
  document.getElementById('nsToken').value  = notionToken;
  document.getElementById('nsPageId').value = notionPageId;
}

function showNotionSettings(visible) {
  notionSettings.classList.toggle('hidden', !visible);
}

// ── Menu ──────────────────────────────────────────────────────────────────────
function toggleMenu(e) { e.stopPropagation(); exportMenu.hidden = !exportMenu.hidden; }
function closeMenu()   {
  if (!exportMenu.hidden) exportMenu.hidden = true;
  const pm = document.getElementById('pageExportMenu');
  if (pm && !pm.hidden) pm.hidden = true;
}

// ── Hover tooltip ─────────────────────────────────────────────────────────────
function showHlTooltip(row, hl) {
  hlTooltipText.textContent = hl.text;
  hlTooltipText.dataset.color = hl.color;
  hlTooltipNote.hidden = !hl.note;
  if (hl.note) hlTooltipNote.textContent = `📝 ${hl.note}`;
  try { hlTooltipMeta.textContent = hl.pageUrl ? cleanDomain(new URL(hl.pageUrl).hostname) : ''; } catch { hlTooltipMeta.textContent = ''; }

  hlTooltip.hidden = false;
  const rect = row.getBoundingClientRect();
  const ttH  = hlTooltip.offsetHeight;
  const top  = (window.innerHeight - rect.bottom) > ttH + 8 ? rect.bottom + 4 : rect.top - ttH - 4;
  hlTooltip.style.left  = '4px';
  hlTooltip.style.width = `${document.documentElement.clientWidth - 8}px`;
  hlTooltip.style.top   = `${Math.max(4, top)}px`;
}

function hideHlTooltip() { hlTooltip.hidden = true; }

// ── Section toggles ───────────────────────────────────────────────────────────
function wireToggle(toggleId, contentId, chevronId) {
  document.getElementById(toggleId).addEventListener('click', () => {
    const content = document.getElementById(contentId);
    const chevron = document.getElementById(chevronId);
    const isCollapsed = content.classList.toggle('collapsed');
    chevron.classList.toggle('collapsed', isCollapsed);
    content.style.maxHeight = isCollapsed ? '0' : '4000px';
  });
}

function refreshSectionHeight(contentId) {
  const el = document.getElementById(contentId);
  if (el && !el.classList.contains('collapsed')) {
    el.style.maxHeight = '4000px';
  }
}

// ── Summary overlay ───────────────────────────────────────────────────────────
function showSummary() {
  const url     = currentTabUrl ? normalizeUrl(currentTabUrl) : null;
  const raw     = url ? (allHighlights[url] || allHighlights[currentTabUrl] || []) : [];
  if (!raw.length) return;

  // Selection algorithm:
  //   1. Notes-bearing highlights first (user took time to annotate = most deliberate)
  //   2. Then by text length descending (longer chunk = richer context)
  //   3. Cap at 5
  const picks = raw
    .slice()
    .sort((a, b) => {
      const aN = a.note ? 1 : 0, bN = b.note ? 1 : 0;
      if (bN !== aN) return bN - aN;
      return b.text.length - a.text.length;
    })
    .slice(0, 5);

  const sub  = document.getElementById('summarySub');
  const list = document.getElementById('summaryList');
  sub.textContent  = `Top ${picks.length} of ${raw.length} highlight${raw.length !== 1 ? 's' : ''} · sorted by depth`;
  list.innerHTML   = '';

  picks.forEach(hl => {
    const card = document.createElement('div');
    card.className = 'summary-card';
    card.title     = 'Click to scroll to this highlight';

    const bar = document.createElement('div');
    bar.className   = 'summary-card-bar';
    bar.dataset.color = hl.color;

    const body = document.createElement('div');
    body.style.flex = '1';

    const text = document.createElement('div');
    text.className   = 'summary-card-text';
    text.textContent = hl.text;

    body.appendChild(text);

    if (hl.note) {
      const note = document.createElement('div');
      note.className   = 'summary-card-note';
      note.textContent = `📝 ${hl.note}`;
      body.appendChild(note);
    }

    card.appendChild(bar);
    card.appendChild(body);
    card.addEventListener('click', () => {
      document.getElementById('summaryOverlay').hidden = true;
      scrollToHighlight(hl.id);
    });
    list.appendChild(card);
  });

  document.getElementById('summaryOverlay').hidden = false;
}

// ── Events ────────────────────────────────────────────────────────────────────
function wireEvents() {
  document.getElementById('summaryBtn').addEventListener('click', e => {
    e.stopPropagation();
    showSummary();
  });
  document.getElementById('summaryClose').addEventListener('click', () => {
    document.getElementById('summaryOverlay').hidden = true;
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    searchClear.classList.toggle('visible', searchQuery.length > 0);
    render();
  });
  searchClear.addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.classList.remove('visible');
    render();
  });
  document.getElementById('searchFilterClear').addEventListener('click', () => {
    searchInput.value = '';
    searchQuery = '';
    searchClear.classList.remove('visible');
    render();
  });

  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); searchInput.focus(); searchInput.select(); }
  });

  wireToggle('thisPageToggle', 'thisPageList', 'thisPageChevron');
  wireToggle('libraryToggle',  'libraryList',  'libraryChevron');

  document.getElementById('menuBtn').addEventListener('click', toggleMenu);
  document.addEventListener('click', closeMenu);
  document.getElementById('themeToggleBtn').addEventListener('click', () => { closeMenu(); toggleTheme(); });
  document.getElementById('exportMdBtn').addEventListener('click', () => { closeMenu(); exportHighlights(); });
  document.getElementById('exportObsidianBtn').addEventListener('click', () => { closeMenu(); exportObsidian(); });
  document.getElementById('exportNotebookBtn').addEventListener('click', () => { closeMenu(); exportNotebook(); });
  document.getElementById('exportNotionBtn').addEventListener('click', () => { closeMenu(); exportToNotion(); });

  document.getElementById('nsSaveBtn').addEventListener('click', async () => {
    const token  = document.getElementById('nsToken').value.trim();
    const pageId = document.getElementById('nsPageId').value.trim();
    if (!token || !pageId) { showToast('Enter both token and page ID'); return; }
    await chrome.storage.sync.set({ notionToken: token, notionPageId: pageId });
    showNotionSettings(false);
    const filter = pendingNotionUrlFilter;
    pendingNotionUrlFilter = null;
    await pushToNotion(token, pageId, filter);
  });
  document.getElementById('nsCancelBtn').addEventListener('click', () => { pendingNotionUrlFilter = null; showNotionSettings(false); });
  document.getElementById('notionModalBackdrop').addEventListener('click', e => {
    if (e.target === e.currentTarget) { pendingNotionUrlFilter = null; showNotionSettings(false); }
  });

  // Page-scoped export
  const pageExportBtn  = document.getElementById('pageExportBtn');
  const pageExportMenu = document.getElementById('pageExportMenu');
  pageExportBtn.addEventListener('click', e => {
    e.stopPropagation();
    pageExportMenu.hidden = !pageExportMenu.hidden;
  });
  document.getElementById('pageExportMdBtn').addEventListener('click', e => {
    e.stopPropagation(); pageExportMenu.hidden = true; exportHighlights(currentUrl);
  });
  document.getElementById('pageExportObsidianBtn').addEventListener('click', e => {
    e.stopPropagation(); pageExportMenu.hidden = true; exportObsidian(currentUrl);
  });
  document.getElementById('pageExportNotionBtn').addEventListener('click', e => {
    e.stopPropagation(); pageExportMenu.hidden = true; exportToNotion(currentUrl);
  });
}

// ── Theme ─────────────────────────────────────────────────────────────────────
function loadTheme() {
  // Read from sync first, fall back to localStorage for existing users
  chrome.storage.sync.get('markTheme').then(({ markTheme }) => {
    const theme = markTheme ?? localStorage.getItem('mark-theme') ?? 'dark';
    document.documentElement.dataset.theme = theme;
    updateThemeBtn(theme === 'dark');
  }).catch(() => {
    const saved = localStorage.getItem('mark-theme') ?? 'dark';
    document.documentElement.dataset.theme = saved;
    updateThemeBtn(saved === 'dark');
  });
}
function updateThemeBtn(isDark) {
  const btn = document.getElementById('themeToggleBtn');
  if (btn) btn.textContent = isDark ? '☀️ Light mode' : '🌙 Dark mode';
}
function toggleTheme() {
  const isDark = document.documentElement.dataset.theme === 'dark';
  const next = isDark ? '' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('mark-theme', next);
  chrome.storage.sync.set({ markTheme: next }).catch(() => {});
  updateThemeBtn(!isDark);
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, duration = 2500, undoLabel = null, undoFn = null) {
  clearTimeout(toastTimer);
  document.getElementById('toastMsg').textContent = msg;
  const undoBtn = document.getElementById('toastUndo');
  if (undoLabel && undoFn) {
    undoBtn.textContent = undoLabel;
    undoBtn.hidden = false;
    undoBtn.onclick = () => { toast.classList.remove('show'); undoFn(); };
  } else {
    undoBtn.hidden = true;
  }
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function relativeTime(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000)     return 'just now';
  if (diff < 3600000)   return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000)  return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  return new Date(ts).toLocaleDateString();
}

function formatTimestamp(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function escH(s) {
  return s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') : '';
}

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
