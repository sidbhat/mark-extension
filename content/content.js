(() => {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let toolbar = null;
  let activeRange = null;
  let hoveredHighlightId = null;
  let applyingHighlight = false;
  let selTimer = null;
  let lastUrl = location.href;
  let lastColor = 'yellow';
  let deletingHighlight = false;

  const COLORS = {
    yellow : { hex: '#FBBF24', rgba: 'rgba(251,191,36,0.38)'  },
    green  : { hex: '#10B981', rgba: 'rgba(16,185,129,0.35)'  },
    blue   : { hex: '#3B9EFF', rgba: 'rgba(59,158,255,0.35)'  },
    red    : { hex: '#EF4444', rgba: 'rgba(239,68,68,0.32)'   },
  };

  // ── URL normalization ──────────────────────────────────────────────────────
  function normalizeUrl(url) {
    try {
      const u = new URL(url);
      ['utm_source','utm_medium','utm_campaign','utm_term','utm_content',
       'fbclid','gclid','ref','source','mc_cid','mc_eid'].forEach(p => u.searchParams.delete(p));
      // Strip YouTube timestamp so all highlights for a video share one storage key
      if (u.hostname.includes('youtube.com') || u.hostname === 'youtu.be') {
        u.searchParams.delete('t');
        u.searchParams.delete('pp');
      }
      u.hash = '';
      return u.toString().replace(/\/$/, '') || url;
    } catch { return url; }
  }

  // ── Context capture for duplicate-text disambiguation ─────────────────────
  function getTextContext(range, before, length) {
    try {
      const r = document.createRange();
      r.selectNodeContents(document.body);
      if (before) {
        r.setEnd(range.startContainer, range.startOffset);
        return r.toString().slice(-length);
      } else {
        r.setStart(range.endContainer, range.endOffset);
        return r.toString().slice(0, length);
      }
    } catch { return ''; }
  }

  // ── YouTube timestamp helper ───────────────────────────────────────────────
  function getYouTubeTimestamp(range) {
    if (!location.hostname.includes('youtube.com')) return null;
    let el = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement : range.startContainer;
    while (el && el !== document.body) {
      // Mark transcript panel uses data-start (seconds as float)
      const ds = el.getAttribute?.('data-start');
      if (ds !== null && ds !== undefined) return Math.floor(parseFloat(ds));
      // YouTube native transcript uses start-offset-ms
      const ms = el.getAttribute?.('start-offset-ms');
      if (ms !== null && ms !== undefined) return Math.floor(parseInt(ms, 10) / 1000);
      el = el.parentElement;
    }
    return null;
  }

  // ── Toolbar ────────────────────────────────────────────────────────────────
  function buildToolbar() {
    const t = document.createElement('div');
    t.id = 'mark-toolbar';

    Object.keys(COLORS).forEach(color => {
      const btn = document.createElement('button');
      btn.className = 'mark-color-btn';
      btn.dataset.color = color;
      btn.style.cssText = `background:${COLORS[color].hex} !important; width:20px !important; height:20px !important; border-radius:50% !important; border:2.5px solid transparent !important; cursor:pointer !important; padding:0 !important; flex-shrink:0 !important;`;
      btn.title = `Highlight ${color}`;
      btn.addEventListener('click', e => { e.stopPropagation(); applyHighlight(color); });
      t.appendChild(btn);
    });

    const div = document.createElement('span');
    div.className = 'mark-toolbar-div';
    div.style.cssText = 'width:1px !important; height:16px !important; background:rgba(0,0,0,0.1) !important; margin:0 2px !important; flex-shrink:0 !important; display:block !important;';
    t.appendChild(div);

    const noteBtn = document.createElement('button');
    noteBtn.className = 'mark-note-btn';
    noteBtn.title = 'Add note';
    noteBtn.textContent = '📝';
    noteBtn.style.cssText = 'width:26px !important; height:26px !important; border-radius:6px !important; border:none !important; background:transparent !important; cursor:pointer !important; font-size:13px !important; display:flex !important; align-items:center !important; justify-content:center !important; padding:0 !important;';
    noteBtn.addEventListener('click', e => { e.stopPropagation(); applyHighlight('yellow', true); });
    t.appendChild(noteBtn);

    document.body.appendChild(t);
    return t;
  }

  function showToolbar(range) {
    if (!toolbar) toolbar = buildToolbar();
    const rect = range.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const toolbarW = 168;
    const left = Math.max(8, Math.min(cx - toolbarW / 2, window.innerWidth - toolbarW - 8));
    const topFixed = rect.top - 48;

    toolbar.style.setProperty('left', `${left}px`, 'important');
    toolbar.style.setProperty('top', `${topFixed < 8 ? rect.bottom + 8 : topFixed}px`, 'important');
    toolbar.classList.remove('mark-toolbar--visible');
    void toolbar.offsetWidth;
    toolbar.classList.add('mark-toolbar--visible');
  }

  function hideToolbar() {
    if (!toolbar) return;
    toolbar.classList.remove('mark-toolbar--visible');
    activeRange = null;
  }

  // ── Selection detection (selectionchange = mouse + keyboard + touch) ───────
  document.addEventListener('selectionchange', () => {
    if (applyingHighlight) return;
    clearTimeout(selTimer);
    selTimer = setTimeout(handleSelectionChange, 180);
  });

  function handleSelectionChange() {
    if (applyingHighlight) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.toString().trim().length < 2) {
      hideToolbar();
      return;
    }
    try {
      activeRange = sel.getRangeAt(0).cloneRange();
      showToolbar(activeRange);
    } catch { hideToolbar(); }
  }

  document.addEventListener('pointerdown', e => {
    if (toolbar && !e.target.closest('#mark-toolbar')) hideToolbar();
  });

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────
  // Only fires when the toolbar is visible (selection active) to avoid conflicts
  // Use e.code (physical key) not e.key — on Mac, Option+1 produces '¡' not '1'
  const KEY_COLORS = { 'Digit1': 'yellow', 'Digit2': 'green', 'Digit3': 'blue', 'Digit4': 'red' };
  document.addEventListener('keydown', e => {
    if (e.altKey && KEY_COLORS[e.code] && activeRange) {
      e.preventDefault();
      applyHighlight(KEY_COLORS[e.code]);
      return;
    }
    if (e.key === 'Escape' && toolbar?.classList.contains('mark-toolbar--visible')) {
      hideToolbar();
    }
  });

  // ── Highlight application ──────────────────────────────────────────────────
  function applyHighlight(color, openNote = false) {
    if (!activeRange) return;
    applyingHighlight = true;
    lastColor = color;
    const range = activeRange;
    const text = range.toString().trim();
    if (!text) { applyingHighlight = false; return; }

    const id = `mk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const marks = wrapRange(range, color, id);

    if (marks.length === 0) { hideToolbar(); applyingHighlight = false; return; }

    marks.forEach(m => attachMarkListeners(m, id));

    const url = normalizeUrl(window.location.href);
    const pre  = getTextContext(range, true,  40);
    const post = getTextContext(range, false, 40);
    const hl = { id, text, color, note: '', url, title: document.title, createdAt: Date.now(),
                 context: { pre, post } };
    const ts = getYouTubeTimestamp(range);
    if (ts !== null) hl.timestamp = ts;
    saveHighlight(hl);
    hideToolbar();
    window.getSelection()?.removeAllRanges();

    setTimeout(() => { applyingHighlight = false; }, 50);

    if (openNote) promptNote(id, marks[0]);
  }

  function attachMarkListeners(m, id) {
    m.addEventListener('mouseenter', () => { hoveredHighlightId = id; });
    m.addEventListener('mouseleave', () => { hoveredHighlightId = null; });
    m.addEventListener('click', e => {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: 'HIGHLIGHT_CLICKED', id }).catch(() => {});
    });
  }

  // ── Range wrapping ─────────────────────────────────────────────────────────
  function wrapRange(range, color, id) {
    const marks = [];
    const start = range.startContainer;
    const end = range.endContainer;

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
      mark.dataset.id = id;
      r.surroundContents(mark);
      return mark;
    } catch { return null; }
  }

  function getTextNodesInRange(range) {
    const root = range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node;
    while ((node = walker.nextNode())) {
      if (range.intersectsNode(node)) nodes.push(node);
    }
    return nodes;
  }

  // ── Storage ────────────────────────────────────────────────────────────────
  // Schema v2: per-URL keys  'hl:<normalizedUrl>' → HighlightObject[]
  //            'hl:index'          → { [url]: {count, title, lastAt} }
  async function saveHighlight(hl) {
    try {
      const key = 'hl:' + hl.url;
      const stored = await chrome.storage.local.get([key, 'hl:index']);
      const existing = stored[key] ?? [];
      existing.push(hl);
      const idx = stored['hl:index'] ?? {};
      idx[hl.url] = { count: existing.length, title: hl.title, lastAt: hl.createdAt };
      await chrome.storage.local.set({ [key]: existing, 'hl:index': idx });
      chrome.runtime.sendMessage({ type: 'HIGHLIGHTS_UPDATED', url: hl.url }).catch(() => {});
    } catch (e) {
      if (String(e).includes('Extension context invalidated')) {
        showContextBanner();
      } else {
        console.error('[Mark] saveHighlight failed:', e);
      }
    }
  }

  async function deleteHighlight(id) {
    deletingHighlight = true;
    const url = normalizeUrl(window.location.href);
    const key = 'hl:' + url;
    const stored = await chrome.storage.local.get([key, 'hl:index']);
    const updated = (stored[key] ?? []).filter(h => h.id !== id);
    const idx = stored['hl:index'] ?? {};
    const toSet = { 'hl:index': idx };
    if (updated.length === 0) {
      delete idx[url];
      await chrome.storage.local.remove(key);
    } else {
      if (idx[url]) idx[url].count = updated.length;
      toSet[key] = updated;
    }
    await chrome.storage.local.set(toSet);
    document.querySelectorAll(`.mark-hl[data-id="${id}"]`).forEach(el => {
      const parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      parent.normalize();
    });
    deletingHighlight = false;
    chrome.runtime.sendMessage({ type: 'HIGHLIGHTS_UPDATED', url }).catch(() => {});
  }

  // ── Restore on load ────────────────────────────────────────────────────────
  async function restoreHighlights() {
    const url = normalizeUrl(window.location.href);
    const key = 'hl:' + url;
    const result = await chrome.storage.local.get(key);
    let pageHls = result[key];
    // Fallback: old single-blob schema (pre-migration window)
    if (!pageHls) {
      const old = await chrome.storage.local.get('highlights');
      pageHls = (old.highlights || {})[url] || (old.highlights || {})[window.location.href] || [];
    }
    pageHls.forEach(hl => restoreOne(hl));
  }

  function restoreOne(hl) {
    if (!hl.text || !document.body) return;
    if (document.querySelector(`.mark-hl[data-id="${hl.id}"]`)) return;

    const SKIP  = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','OPTION','SELECT','CANVAS','SVG']);
    const BLOCK = new Set(['P','DIV','LI','TD','TH','H1','H2','H3','H4','H5','H6',
                           'BLOCKQUOTE','PRE','ARTICLE','SECTION','HEADER','FOOTER',
                           'MAIN','NAV','FIGURE','FIGCAPTION','CAPTION','DETAILS','SUMMARY','DL','DT','DD']);
    const ZWS   = new Set('​‌‍﻿­'.split(''));

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (SKIP.has(node.tagName))                        return NodeFilter.FILTER_REJECT;
            if (node.closest('[aria-hidden="true"],.mark-hl')) return NodeFilter.FILTER_REJECT;
            try {
              const cs = window.getComputedStyle(node);
              if (cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;
            } catch {}
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const segs  = [];
    const parts = [];
    let pos = 0, prevBlock = null, n;

    while ((n = walker.nextNode())) {
      if (n.nodeType !== Node.TEXT_NODE) continue;
      let blk = n.parentElement;
      while (blk && blk !== document.body && !BLOCK.has(blk.tagName)) blk = blk.parentElement;
      if (prevBlock && blk !== prevBlock) { parts.push(' '); pos++; }
      prevBlock = blk;
      const text = n.textContent;
      segs.push({ node: n, text, start: pos });
      parts.push(text);
      pos += text.length;
    }

    const fullText = parts.join('');
    if (!fullText) return;

    let matchIdx = -1, matchLen = hl.text.length;

    // Pass 1: exact — with context disambiguation when the same text appears multiple times
    {
      const occurrences = [];
      let fi = 0, idx;
      while ((idx = fullText.indexOf(hl.text, fi)) !== -1) { occurrences.push(idx); fi = idx + 1; }
      if (occurrences.length === 1) {
        matchIdx = occurrences[0];
      } else if (occurrences.length > 1) {
        if (hl.context) {
          const preKey  = (hl.context.pre  || '').slice(-20).toLowerCase();
          const postKey = (hl.context.post || '').slice(0, 20).toLowerCase();
          let best = occurrences[0], bestScore = -1;
          for (const ci of occurrences) {
            const pre  = fullText.slice(Math.max(0, ci - 40), ci).toLowerCase();
            const post = fullText.slice(ci + hl.text.length, ci + hl.text.length + 40).toLowerCase();
            const s = (preKey && pre.endsWith(preKey) ? 2 : 0) +
                      (postKey && post.startsWith(postKey) ? 2 : 0);
            if (s > bestScore) { bestScore = s; best = ci; }
          }
          matchIdx = best;
        } else {
          matchIdx = occurrences[0];
        }
      }
    }

    // Pass 2: 1:1 char normalization (curly quotes, NBSP) so indices stay valid
    if (matchIdx === -1) {
      try {
        const normFull   = fullText.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[   ]/g, ' ');
        const normNeedle = hl.text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[   ]/g, ' ');
        const escaped    = normNeedle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern    = escaped.replace(/\s+/g, '[ \\t\\n\\r\\u00A0\\u202F\\u2009\\u200B-\\u200D\\uFEFF]+');
        const m = new RegExp(pattern, 'u').exec(normFull);
        if (m) { matchIdx = m.index; matchLen = m[0].length; }
      } catch {}
    }

    // Pass 3: strip zero-width chars with explicit position remapping
    if (matchIdx === -1) {
      const origPos = [];
      for (let i = 0; i < fullText.length; i++) {
        if (!ZWS.has(fullText[i])) origPos.push(i);
      }
      const strippedFull   = origPos.map(i => fullText[i]).join('');
      const strippedNeedle = [...hl.text].filter(c => !ZWS.has(c)).join('');
      const si = strippedFull.indexOf(strippedNeedle);
      if (si !== -1) {
        matchIdx = origPos[si];
        let count = 0, end = matchIdx;
        while (end < fullText.length && count < strippedNeedle.length) {
          if (!ZWS.has(fullText[end])) count++;
          end++;
        }
        matchLen = end - matchIdx;
      }
    }

    if (matchIdx === -1) return;
    const matchEnd = matchIdx + matchLen;

    let startNode = null, startOffset = 0, endNode = null, endOffset = 0;
    for (const { node, text, start } of segs) {
      const end = start + text.length;
      if (!startNode && end > matchIdx) {
        startNode   = node;
        startOffset = Math.max(0, matchIdx - start);
      }
      if (!endNode && end >= matchEnd) {
        endNode   = node;
        endOffset = Math.min(text.length, matchEnd - start);
        break;
      }
    }
    if (!startNode || !endNode) return;

    try {
      const range = document.createRange();
      range.setStart(startNode, startOffset);
      range.setEnd(endNode, endOffset);
      const marks = wrapRange(range, hl.color, hl.id);
      marks.forEach(m => { attachMarkListeners(m, hl.id); if (hl.note) m.title = hl.note; });
    } catch {}
  }

  // ── Note prompt ────────────────────────────────────────────────────────────
  function promptNote(id, anchorEl) {
    const existing = document.getElementById('mark-note-prompt');
    if (existing) existing.remove();

    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    const wrap = document.createElement('div');
    wrap.id = 'mark-note-prompt';
    Object.assign(wrap.style, {
      position: 'fixed', zIndex: '2147483647',
      background: dark ? '#1E1E2E' : '#fff',
      borderRadius: '10px',
      boxShadow: dark
        ? '0 8px 32px rgba(0,0,0,0.5)'
        : '0 8px 32px rgba(0,0,0,0.18)',
      border: `1px solid ${dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
      padding: '10px', width: '240px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    });

    const rect = anchorEl.getBoundingClientRect();
    const promptH = 130;
    const promptW = 240;
    let top  = rect.bottom + 6;
    let left = Math.max(8, rect.left);
    if (top + promptH > window.innerHeight) top = Math.max(8, rect.top - promptH - 6);
    if (left + promptW > window.innerWidth) left = Math.max(8, window.innerWidth - promptW - 8);
    wrap.style.top  = `${top}px`;
    wrap.style.left = `${left}px`;

    const textarea = document.createElement('textarea');
    Object.assign(textarea.style, {
      width: '100%', height: '72px',
      border: `1.5px solid ${dark ? 'rgba(255,255,255,0.15)' : '#C2CBDA'}`,
      borderRadius: '6px', padding: '7px', fontSize: '12px',
      fontFamily: 'inherit', resize: 'none', outline: 'none',
      boxSizing: 'border-box',
      background: dark ? '#12121E' : '#fff',
      color: dark ? '#F0F6FC' : '#111827',
    });
    textarea.placeholder = 'Add a note...';

    const saveBtn = document.createElement('button');
    Object.assign(saveBtn.style, {
      marginTop: '6px', width: '100%', height: '30px', background: '#0070F2',
      color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px',
      fontWeight: '600', cursor: 'pointer',
    });
    saveBtn.textContent = 'Save note';
    saveBtn.addEventListener('click', async () => {
      const note = textarea.value.trim();
      const url = normalizeUrl(window.location.href);
      const key = 'hl:' + url;
      const { [key]: pageHls = [] } = await chrome.storage.local.get(key);
      const hlObj = pageHls.find(h => h.id === id);
      if (hlObj) {
        hlObj.note = note;
        await chrome.storage.local.set({ [key]: pageHls });
        document.querySelectorAll(`.mark-hl[data-id="${id}"]`).forEach(el => el.title = note);
        chrome.runtime.sendMessage({ type: 'HIGHLIGHTS_UPDATED', url }).catch(() => {});
      }
      wrap.remove();
    });

    wrap.appendChild(textarea);
    wrap.appendChild(saveBtn);
    document.body.appendChild(wrap);
    textarea.focus();

    setTimeout(() => {
      document.addEventListener('pointerdown', e => {
        if (!wrap.contains(e.target)) wrap.remove();
      }, { once: true });
    }, 50);
  }

  function showContextBanner() {
    if (document.getElementById('mark-reload-banner')) return;
    const banner = document.createElement('div');
    banner.id = 'mark-reload-banner';
    Object.assign(banner.style, {
      position: 'fixed', top: '0', left: '0', right: '0', zIndex: '2147483647',
      background: '#0070F2', color: '#fff', padding: '10px 16px',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '13px', fontWeight: '500', textAlign: 'center',
      boxShadow: '0 2px 8px rgba(0,0,0,0.2)', cursor: 'pointer',
    });
    banner.textContent = 'Mark was updated — reload this page to save highlights';
    banner.addEventListener('click', () => location.reload());
    document.body.appendChild(banner);
  }

  // ── Message handler ────────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'SCROLL_TO_HIGHLIGHT') {
      const doScroll = () => {
        const els = document.querySelectorAll(`.mark-hl[data-id="${msg.id}"]`);
        if (!els.length) return false;
        els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        els.forEach(el => {
          el.classList.remove('mark-hl--pulse');
          void el.offsetWidth;
          el.classList.add('mark-hl--pulse');
          el.addEventListener('animationend', () => el.classList.remove('mark-hl--pulse'), { once: true });
        });
        return true;
      };
      if (doScroll()) {
        sendResponse({ found: true });
      } else {
        restoreHighlights().then(() => {
          sendResponse({ found: doScroll() });
        });
      }
      return true; // async — keep channel open
    }

    if (msg.type === 'DELETE_HIGHLIGHT') {
      deleteHighlight(msg.id);
      sendResponse({ done: true });
      return;
    }

    if (msg.type === 'DELETE_HOVERED') {
      if (hoveredHighlightId) deleteHighlight(hoveredHighlightId);
      sendResponse({ done: true });
      return;
    }

    if (msg.type === 'UPDATE_NOTE') {
      document.querySelectorAll(`.mark-hl[data-id="${msg.id}"]`).forEach(el => {
        el.title = msg.note || '';
      });
      sendResponse({ done: true });
      return;
    }

    if (msg.type === 'CHANGE_COLOR') {
      document.querySelectorAll(`.mark-hl[data-id="${msg.id}"]`).forEach(el => {
        el.dataset.color = msg.color;
      });
      sendResponse({ done: true });
      return;
    }

    if (msg.type === 'RESTORE_HIGHLIGHT') {
      restoreOne(msg.hl);
      sendResponse({ done: true });
      return;
    }

    if (msg.type === 'GET_PAGE_URL') {
      sendResponse({ url: normalizeUrl(window.location.href) });
    }

    if (msg.type === 'CLIP_IMAGE') {
      const imgEl = document.querySelector(`img[src="${CSS.escape ? CSS.escape(msg.src) : msg.src}"]`) ||
                    [...document.images].find(i => i.src === msg.src || i.currentSrc === msg.src);
      const alt   = imgEl?.alt || imgEl?.title || '';
      const id    = `mk-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const url   = normalizeUrl(window.location.href);
      const hl    = { id, type: 'image', src: msg.src, alt, color: 'blue',
                      note: '', url, title: document.title, createdAt: Date.now() };
      saveHighlight(hl);
      // Flash a brief border on the clipped image for feedback
      if (imgEl) {
        imgEl.style.outline = '3px solid #3B9EFF';
        imgEl.style.borderRadius = '4px';
        setTimeout(() => { imgEl.style.outline = ''; imgEl.style.borderRadius = ''; }, 1200);
      }
      sendResponse({ done: true });
    }
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restoreHighlights);
  } else {
    restoreHighlights();
  }

  // SPA support — re-highlight after DOM changes and detect URL changes
  let restoreTimer;
  new MutationObserver(() => {
    if (applyingHighlight || deletingHighlight) return;
    const currentUrl = location.href;
    if (currentUrl !== lastUrl) {
      lastUrl = currentUrl;
      // Small delay for SPA route to finish rendering
      setTimeout(restoreHighlights, 600);
    } else {
      clearTimeout(restoreTimer);
      restoreTimer = setTimeout(restoreHighlights, 800);
    }
  }).observe(document.body, { childList: true, subtree: true });

})();
