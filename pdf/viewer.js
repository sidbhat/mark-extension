import * as pdfjsLib from './pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdf/pdf.worker.mjs');

// ── State ─────────────────────────────────────────────────────────────────────
const params     = new URLSearchParams(location.search);
const pdfUrl     = params.get('url') || '';
const storageKey = normalizeStorageUrl(pdfUrl);

let pdfDoc       = null;
let currentPage  = 1;
let scale        = 1.4;
let activeRange  = null;
let lastColor    = 'yellow';
let selTimer     = null;
let renderedPages = new Set();

const COLORS = {
  yellow: { hex: '#FBBF24', rgba: 'rgba(251,191,36,0.45)' },
  green:  { hex: '#10B981', rgba: 'rgba(16,185,129,0.40)' },
  blue:   { hex: '#3B9EFF', rgba: 'rgba(59,158,255,0.40)' },
  red:    { hex: '#EF4444', rgba: 'rgba(239,68,68,0.38)' },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeStorageUrl(url) {
  try {
    const u = new URL(url);
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content',
     'fbclid','gclid','ref','source'].forEach(p => u.searchParams.delete(p));
    u.hash = '';
    return u.toString().replace(/\/$/, '') || url;
  } catch { return url; }
}

function pdfFilename(url) {
  try {
    const path = new URL(url).pathname;
    const name = path.split('/').pop();
    return decodeURIComponent(name || url);
  } catch { return url; }
}

async function getPageHighlights() {
  const { highlights = {} } = await chrome.storage.local.get('highlights');
  return highlights[storageKey] || highlights[pdfUrl] || [];
}

async function saveHighlight(hl) {
  const { highlights = {} } = await chrome.storage.local.get('highlights');
  if (!highlights[storageKey]) highlights[storageKey] = [];
  highlights[storageKey].push(hl);
  await chrome.storage.local.set({ highlights });
  chrome.runtime.sendMessage({ type: 'HIGHLIGHTS_UPDATED', url: storageKey }).catch(() => {});
}

async function deleteHighlight(id) {
  const { highlights = {} } = await chrome.storage.local.get('highlights');
  if (highlights[storageKey]) {
    highlights[storageKey] = highlights[storageKey].filter(h => h.id !== id);
    if (!highlights[storageKey].length) delete highlights[storageKey];
    await chrome.storage.local.set({ highlights });
  }
  document.querySelectorAll(`.mark-hl[data-id="${id}"]`).forEach(el => unwrap(el));
  chrome.runtime.sendMessage({ type: 'HIGHLIGHTS_UPDATED', url: storageKey }).catch(() => {});
}

function unwrap(el) {
  const p = el.parentNode;
  if (!p) return;
  while (el.firstChild) p.insertBefore(el.firstChild, el);
  p.removeChild(el);
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
const toolbar = document.getElementById('mark-toolbar');

function showToolbar(range) {
  activeRange = range;
  const rect  = range.getBoundingClientRect();
  const cx    = rect.left + rect.width / 2;
  const tw    = 168;
  const left  = Math.max(8, Math.min(cx - tw / 2, window.innerWidth - tw - 8));
  const topRaw = rect.top - 48;
  toolbar.style.left = `${left}px`;
  toolbar.style.top  = `${topRaw < 8 ? rect.bottom + 8 : topRaw}px`;
  toolbar.classList.remove('visible');
  void toolbar.offsetWidth;
  toolbar.classList.add('visible');
}

function hideToolbar() {
  toolbar.classList.remove('visible');
  activeRange = null;
}

toolbar.querySelectorAll('.tb-color-btn').forEach(btn => {
  btn.addEventListener('click', e => {
    e.stopPropagation();
    applyHighlight(btn.dataset.color);
  });
});

toolbar.querySelector('.tb-note-btn').addEventListener('click', e => {
  e.stopPropagation();
  applyHighlight('yellow', true);
});

document.addEventListener('pointerdown', e => {
  if (!e.target.closest('#mark-toolbar')) hideToolbar();
});

// Keyboard shortcuts: Alt+1-4 applies color; Escape hides toolbar
const KEY_COLORS = { '1':'yellow', '2':'green', '3':'blue', '4':'red' };
document.addEventListener('keydown', e => {
  if (e.altKey && KEY_COLORS[e.key] && activeRange) {
    e.preventDefault(); applyHighlight(KEY_COLORS[e.key]); return;
  }
  if (e.key === 'Escape') hideToolbar();
  if (e.key === 'ArrowLeft'  || e.key === 'PageUp')   scrollToPage(currentPage - 1);
  if (e.key === 'ArrowRight' || e.key === 'PageDown')  scrollToPage(currentPage + 1);
});

// ── Selection detection ───────────────────────────────────────────────────────
document.addEventListener('selectionchange', () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 2) {
      hideToolbar(); return;
    }
    try {
      const range = sel.getRangeAt(0).cloneRange();
      // Only show toolbar if selection is inside a text layer
      if (range.startContainer.parentElement?.closest('.pdf-text-layer')) {
        activeRange = range;
        showToolbar(range);
      }
    } catch { hideToolbar(); }
  }, 160);
});

// ── Apply highlight ────────────────────────────────────────────────────────────
function applyHighlight(color, openNote = false) {
  if (!activeRange) return;
  lastColor = color;
  const range = activeRange;
  const text  = range.toString().trim();
  if (!text) return;

  // Find which page this selection is on
  const pageEl  = range.startContainer.parentElement?.closest('.pdf-page-wrap');
  const pageNum = pageEl ? parseInt(pageEl.dataset.page, 10) : 0;

  const id    = `mk-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
  const marks = wrapRange(range, color, id);
  if (!marks.length) { hideToolbar(); return; }
  marks.forEach(m => attachListeners(m, id));

  const hl = {
    id, text, color, note: '', url: storageKey, pageNum,
    title: document.title.replace(' — Mark', '').trim() || pdfFilename(pdfUrl),
    createdAt: Date.now()
  };
  saveHighlight(hl);
  hideToolbar();
  window.getSelection()?.removeAllRanges();

  if (openNote) promptNote(id, marks[0]);
}

// ── Range wrapping ─────────────────────────────────────────────────────────────
function wrapRange(range, color, id) {
  const marks = [];
  const start = range.startContainer;
  const end   = range.endContainer;

  if (start === end && start.nodeType === Node.TEXT_NODE) {
    const m = wrapTextNode(start, range.startOffset, range.endOffset, color, id);
    if (m) marks.push(m);
  } else {
    getTextNodesInRange(range).forEach(node => {
      let s = 0, e2 = node.textContent.length;
      if (node === start) s = range.startOffset;
      if (node === end)   e2 = range.endOffset;
      if (s >= e2) return;
      const m = wrapTextNode(node, s, e2, color, id);
      if (m) marks.push(m);
    });
  }
  return marks;
}

function wrapTextNode(textNode, start, end, color, id) {
  try {
    const r = document.createRange();
    r.setStart(textNode, start);
    r.setEnd(textNode, end);
    const mark = document.createElement('mark');
    mark.className = 'mark-hl';
    mark.dataset.color = color;
    mark.dataset.id    = id;
    r.surroundContents(mark);
    return mark;
  } catch { return null; }
}

function getTextNodesInRange(range) {
  const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
    ? range.commonAncestorContainer.parentNode
    : range.commonAncestorContainer;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes  = [];
  let node;
  while ((node = walker.nextNode())) {
    if (range.intersectsNode(node)) nodes.push(node);
  }
  return nodes;
}

function attachListeners(m, id) {
  m.addEventListener('click', e => {
    e.stopPropagation();
    chrome.runtime.sendMessage({ type: 'HIGHLIGHT_CLICKED', id }).catch(() => {});
  });
  m.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (confirm('Remove this highlight?')) deleteHighlight(id);
  });
}

// ── Note prompt ───────────────────────────────────────────────────────────────
function promptNote(id, anchorEl) {
  const existing = document.getElementById('mark-note-prompt');
  if (existing) existing.remove();

  const wrap = document.createElement('div');
  wrap.id = 'mark-note-prompt';
  const rect = anchorEl.getBoundingClientRect();
  Object.assign(wrap.style, {
    position: 'fixed', zIndex: '99999',
    background: '#fff', borderRadius: '10px',
    boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
    border: '1px solid rgba(0,0,0,0.08)',
    padding: '10px', width: '240px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    top:  `${Math.min(rect.bottom + 6, window.innerHeight - 140)}px`,
    left: `${Math.min(Math.max(8, rect.left), window.innerWidth - 256)}px`,
  });

  const ta = document.createElement('textarea');
  Object.assign(ta.style, {
    width:'100%', height:'72px', resize:'none', outline:'none',
    border:'1.5px solid #C2CBDA', borderRadius:'6px',
    padding:'7px', fontSize:'12px', boxSizing:'border-box',
  });
  ta.placeholder = 'Add a note…';

  const btn = document.createElement('button');
  Object.assign(btn.style, {
    marginTop:'6px', width:'100%', height:'30px', background:'#0070F2',
    color:'#fff', border:'none', borderRadius:'6px', fontSize:'12px',
    fontWeight:'600', cursor:'pointer',
  });
  btn.textContent = 'Save note';
  btn.addEventListener('click', async () => {
    const note = ta.value.trim();
    const { highlights = {} } = await chrome.storage.local.get('highlights');
    const list = highlights[storageKey] || [];
    const obj  = list.find(h => h.id === id);
    if (obj) {
      obj.note = note;
      await chrome.storage.local.set({ highlights });
      document.querySelectorAll(`.mark-hl[data-id="${id}"]`).forEach(el => el.title = note);
      chrome.runtime.sendMessage({ type: 'HIGHLIGHTS_UPDATED', url: storageKey }).catch(() => {});
    }
    wrap.remove();
  });

  wrap.appendChild(ta);
  wrap.appendChild(btn);
  document.body.appendChild(wrap);
  ta.focus();

  setTimeout(() => {
    document.addEventListener('pointerdown', e => {
      if (!wrap.contains(e.target)) wrap.remove();
    }, { once: true });
  }, 50);
}

// ── Restore highlights onto rendered page ─────────────────────────────────────
async function restorePageHighlights(pageNum) {
  const hls = (await getPageHighlights()).filter(h => (h.pageNum ?? 0) === pageNum);
  hls.forEach(hl => restoreOne(hl, pageNum));
}

function restoreOne(hl, pageNum) {
  if (!hl.text) return;
  if (document.querySelector(`.mark-hl[data-id="${hl.id}"]`)) return;

  const pageEl = document.querySelector(`.pdf-page-wrap[data-page="${pageNum}"]`);
  if (!pageEl) return;
  const textLayer = pageEl.querySelector('.pdf-text-layer');
  if (!textLayer) return;

  // Collect text nodes inside the text layer
  const walker = document.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT);
  const segs = [];
  const parts = [];
  let pos = 0, n;
  while ((n = walker.nextNode())) {
    segs.push({ node: n, start: pos });
    parts.push(n.textContent);
    pos += n.textContent.length;
  }
  const fullText = parts.join('');

  // Three-pass matching (mirrors content.js restoreOne)
  let matchIdx = fullText.indexOf(hl.text);
  let matchLen = hl.text.length;

  if (matchIdx === -1) {
    try {
      const nFull   = fullText.replace(/[""]/g,'"').replace(/['']/g,"'").replace(/[  ]/g,' ');
      const nNeedle = hl.text.replace(/[""]/g,'"').replace(/['']/g,"'").replace(/[  ]/g,' ');
      const esc     = nNeedle.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      const pat     = esc.replace(/\s+/g,'[ \\t\\n\\r\\u00A0\\u202F]+');
      const m       = new RegExp(pat,'u').exec(nFull);
      if (m) { matchIdx = m.index; matchLen = m[0].length; }
    } catch {}
  }

  if (matchIdx === -1) {
    const stripped = fullText.replace(/[​-‍﻿­]/g,'');
    const sIdx = stripped.indexOf(hl.text.replace(/[​-‍﻿­]/g,''));
    if (sIdx !== -1) matchIdx = sIdx;
  }

  if (matchIdx === -1) return;
  const matchEnd = matchIdx + matchLen;

  let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
  for (const { node, start } of segs) {
    const end = start + node.textContent.length;
    if (!startNode && end > matchIdx) {
      startNode   = node;
      startOffset = Math.max(0, matchIdx - start);
    }
    if (!endNode && end >= matchEnd) {
      endNode   = node;
      endOffset = Math.min(node.textContent.length, matchEnd - start);
      break;
    }
  }
  if (!startNode || !endNode) return;

  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const marks = wrapRange(range, hl.color, hl.id);
    marks.forEach(m => {
      attachListeners(m, hl.id);
      if (hl.note) m.title = hl.note;
    });
  } catch {}
}

// ── PDF rendering ─────────────────────────────────────────────────────────────
async function renderPage(pageNum) {
  if (renderedPages.has(pageNum)) return;
  renderedPages.add(pageNum);

  const page     = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });

  const wrap = document.querySelector(`.pdf-page-wrap[data-page="${pageNum}"]`);
  if (!wrap) return;

  // Canvas
  const canvas  = wrap.querySelector('.pdf-page-canvas');
  const ctx     = canvas.getContext('2d');
  canvas.width  = viewport.width;
  canvas.height = viewport.height;
  canvas.style.width  = `${viewport.width}px`;
  canvas.style.height = `${viewport.height}px`;
  wrap.style.width    = `${viewport.width}px`;
  wrap.style.height   = `${viewport.height}px`;

  await page.render({ canvasContext: ctx, viewport }).promise;

  // Text layer for selection + highlighting
  const textContent = await page.getTextContent();
  const textLayer   = wrap.querySelector('.pdf-text-layer');
  textLayer.style.width  = `${viewport.width}px`;
  textLayer.style.height = `${viewport.height}px`;

  pdfjsLib.renderTextLayer({
    textContentSource: textContent,
    container: textLayer,
    viewport,
    textDivs: [],
  }).promise.then(() => restorePageHighlights(pageNum));
}

// ── IntersectionObserver — render pages as they enter the viewport ─────────────
let pageObserver;

function setupObserver() {
  pageObserver?.disconnect();
  pageObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const pageNum = parseInt(entry.target.dataset.page, 10);
        renderPage(pageNum);
        currentPage = pageNum;
        updatePageInfo();
      }
    });
  }, { root: document.getElementById('viewer-scroll'), rootMargin: '200px' });

  document.querySelectorAll('.pdf-page-wrap').forEach(el => pageObserver.observe(el));
}

// ── Build page placeholders ───────────────────────────────────────────────────
async function buildPagePlaceholders() {
  const container = document.getElementById('viewer-pages');
  container.innerHTML = '';
  renderedPages.clear();

  // Get dimensions from page 1 to set placeholder sizes
  const firstPage = await pdfDoc.getPage(1);
  const vp        = firstPage.getViewport({ scale });

  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page-wrap';
    wrap.dataset.page = i;
    wrap.style.width  = `${vp.width}px`;
    wrap.style.height = `${vp.height}px`;

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-page-canvas';
    wrap.appendChild(canvas);

    const tl = document.createElement('div');
    tl.className = 'pdf-text-layer';
    wrap.appendChild(tl);

    container.appendChild(wrap);
  }
}

// ── Zoom ──────────────────────────────────────────────────────────────────────
async function applyZoom(newScale) {
  scale = Math.max(0.5, Math.min(3.0, newScale));
  document.getElementById('zoom-info').textContent = `${Math.round(scale * 100)}%`;
  renderedPages.clear();
  await buildPagePlaceholders();
  setupObserver();
  scrollToPage(currentPage);
}

// ── Navigation ────────────────────────────────────────────────────────────────
function scrollToPage(n) {
  if (!pdfDoc) return;
  const target = Math.max(1, Math.min(n, pdfDoc.numPages));
  const el = document.querySelector(`.pdf-page-wrap[data-page="${target}"]`);
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updatePageInfo() {
  document.getElementById('page-info').textContent =
    `${currentPage} / ${pdfDoc?.numPages ?? '—'}`;
  document.getElementById('btn-prev').disabled = currentPage <= 1;
  document.getElementById('btn-next').disabled = pdfDoc && currentPage >= pdfDoc.numPages;
}

// ── Scroll to highlight (from panel) ─────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SCROLL_TO_HIGHLIGHT') {
    const el = document.querySelector(`.mark-hl[data-id="${msg.id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.remove('mark-hl--pulse');
      void el.offsetWidth;
      el.classList.add('mark-hl--pulse');
      sendResponse({ found: true });
    } else {
      // Highlight might be on an unrendered page — find it in storage
      getPageHighlights().then(hls => {
        const hl = hls.find(h => h.id === msg.id);
        if (hl?.pageNum) {
          scrollToPage(hl.pageNum);
          setTimeout(() => {
            restoreOne(hl, hl.pageNum);
            const el2 = document.querySelector(`.mark-hl[data-id="${msg.id}"]`);
            if (el2) {
              el2.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el2.classList.add('mark-hl--pulse');
            }
          }, 600);
        }
        sendResponse({ found: !!hl });
      });
    }
    return true;
  }

  if (msg.type === 'DELETE_HIGHLIGHT') {
    deleteHighlight(msg.id);
    sendResponse({ done: true });
  }

  if (msg.type === 'UPDATE_NOTE') {
    document.querySelectorAll(`.mark-hl[data-id="${msg.id}"]`)
      .forEach(el => el.title = msg.note || '');
    sendResponse({ done: true });
  }

  if (msg.type === 'CHANGE_COLOR') {
    document.querySelectorAll(`.mark-hl[data-id="${msg.id}"]`)
      .forEach(el => el.dataset.color = msg.color);
    sendResponse({ done: true });
  }

  if (msg.type === 'GET_PAGE_URL') {
    sendResponse({ url: storageKey });
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function init() {
  const overlay  = document.getElementById('load-overlay');
  const loadText = document.getElementById('load-text');

  if (!pdfUrl) {
    loadText.textContent = 'No PDF URL provided.';
    return;
  }

  document.getElementById('pdf-name').textContent = pdfFilename(pdfUrl);
  document.title = pdfFilename(pdfUrl) + ' — Mark';

  // Toolbar button wiring
  document.getElementById('btn-prev').addEventListener('click', () => scrollToPage(currentPage - 1));
  document.getElementById('btn-next').addEventListener('click', () => scrollToPage(currentPage + 1));
  document.getElementById('btn-zoom-in').addEventListener('click',  () => applyZoom(scale + 0.2));
  document.getElementById('btn-zoom-out').addEventListener('click', () => applyZoom(scale - 0.2));

  try {
    loadText.textContent = 'Loading PDF…';

    const loadingTask = pdfjsLib.getDocument({
      url: pdfUrl,
      withCredentials: true,   // pass browser cookies for auth-gated PDFs
    });

    // Show progress
    loadingTask.onProgress = ({ loaded, total }) => {
      if (total > 0) loadText.textContent = `Loading… ${Math.round(loaded / total * 100)}%`;
    };

    pdfDoc = await loadingTask.promise;
  } catch (err) {
    if (err?.name === 'PasswordException') {
      loadText.textContent = '🔒 This PDF is password-protected.';
    } else if (err?.name === 'InvalidPDFException') {
      loadText.textContent = '⚠️ This file doesn\'t appear to be a valid PDF.';
    } else {
      loadText.textContent = `⚠️ Could not load PDF: ${err?.message || err}`;
    }
    return;
  }

  overlay.classList.add('hidden');

  await buildPagePlaceholders();
  setupObserver();
  updatePageInfo();
  document.getElementById('zoom-info').textContent = `${Math.round(scale * 100)}%`;
}

init();
