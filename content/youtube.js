(() => {
  'use strict';

  // ── State ────────────────────────────────────────────────────────────────────
  let currentVideoId = null;
  let panel = null;
  let transcriptSegments = []; // [{ startSec, text }]

  // ── Helpers ──────────────────────────────────────────────────────────────────
  function videoIdFromUrl(url) {
    try {
      return new URL(url).searchParams.get('v') || null;
    } catch { return null; }
  }

  function formatTs(secs) {
    const s = Math.floor(secs);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = s % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    return `${m}:${String(ss).padStart(2,'0')}`;
  }

  // ── Transcript fetch ──────────────────────────────────────────────────────────
  async function fetchTranscript(tracks) {
    // Prefer English auto-generated or English manual; fall back to first track
    const preferred = tracks.find(t => {
      const lang = (t.languageCode || '').toLowerCase();
      return lang === 'en' || lang.startsWith('en-');
    }) || tracks[0];

    if (!preferred) return [];

    const url = preferred.baseUrl + '&fmt=json3';
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Transcript fetch failed: ${res.status}`);
    const data = await res.json();

    const segs = [];
    for (const ev of (data.events || [])) {
      if (!ev.segs) continue;
      const text = ev.segs.map(s => s.utf8 || '').join('').replace(/\n/g, ' ').trim();
      if (!text) continue;
      segs.push({ startSec: (ev.tStartMs || 0) / 1000, text });
    }
    return segs;
  }

  // ── Seek YouTube player to a timestamp ───────────────────────────────────────
  function seekTo(secs) {
    const video = document.querySelector('video.html5-main-video');
    if (video) video.currentTime = secs;
  }

  // ── Build / update panel ──────────────────────────────────────────────────────
  function buildPanel(segs, tracks) {
    if (panel) panel.remove();

    panel = document.createElement('div');
    panel.id = 'mark-yt-panel';
    panel.innerHTML = `
      <div class="mark-yt-header">
        <span class="mark-yt-title">Transcript</span>
        <div class="mark-yt-header-right">
          <select class="mark-yt-lang" id="markYtLang" title="Language">
            ${tracks.map((t, i) => `<option value="${i}">${t.name?.simpleText || t.languageCode || 'Track ' + i}</option>`).join('')}
          </select>
          <button class="mark-yt-close" id="markYtClose" title="Close transcript">✕</button>
        </div>
      </div>
      <div class="mark-yt-search-wrap">
        <input class="mark-yt-search" id="markYtSearch" placeholder="Search transcript…" type="text">
        <button class="mark-yt-search-clear" id="markYtSearchClear" title="Clear">✕</button>
      </div>
      <div class="mark-yt-body" id="markYtBody"></div>
    `;

    renderSegments(panel.querySelector('#markYtBody'), segs, '');

    // Track language switching
    panel.querySelector('#markYtLang').addEventListener('change', async e => {
      const idx = parseInt(e.target.value, 10);
      const body = panel.querySelector('#markYtBody');
      body.innerHTML = '<div class="mark-yt-loading">Loading…</div>';
      try {
        const newSegs = await fetchTranscript([tracks[idx]]);
        transcriptSegments = newSegs;
        renderSegments(body, newSegs, panel.querySelector('#markYtSearch').value);
      } catch {
        body.innerHTML = '<div class="mark-yt-loading">Failed to load transcript.</div>';
      }
    });

    // Close
    panel.querySelector('#markYtClose').addEventListener('click', () => {
      panel.remove();
      panel = null;
    });

    // Search
    const searchInput = panel.querySelector('#markYtSearch');
    const searchClear = panel.querySelector('#markYtSearchClear');
    searchInput.addEventListener('input', () => {
      const q = searchInput.value;
      searchClear.style.display = q ? 'flex' : 'none';
      renderSegments(panel.querySelector('#markYtBody'), transcriptSegments, q);
    });
    searchClear.addEventListener('click', () => {
      searchInput.value = '';
      searchClear.style.display = 'none';
      renderSegments(panel.querySelector('#markYtBody'), transcriptSegments, '');
    });

    return panel;
  }

  function renderSegments(container, segs, query) {
    container.innerHTML = '';
    const q = query.trim().toLowerCase();

    for (const seg of segs) {
      if (q && !seg.text.toLowerCase().includes(q)) continue;

      const row = document.createElement('div');
      row.className = 'mark-yt-seg';
      row.dataset.start = String(seg.startSec);

      // Timestamp button
      const tsBtn = document.createElement('button');
      tsBtn.className = 'mark-yt-ts';
      tsBtn.textContent = formatTs(seg.startSec);
      tsBtn.addEventListener('click', e => {
        e.stopPropagation();
        seekTo(seg.startSec);
      });

      // Text span (with search highlight)
      const textEl = document.createElement('span');
      textEl.className = 'mark-yt-text';
      if (q) {
        const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        textEl.innerHTML = seg.text.replace(regex, '<mark class="mark-yt-match">$1</mark>');
      } else {
        textEl.textContent = seg.text;
      }

      row.appendChild(tsBtn);
      row.appendChild(textEl);
      container.appendChild(row);
    }

    if (container.children.length === 0) {
      container.innerHTML = q
        ? '<div class="mark-yt-loading">No results for "' + query + '"</div>'
        : '<div class="mark-yt-loading">No transcript segments found.</div>';
    }
  }

  // ── Inject panel into page ────────────────────────────────────────────────────
  function injectPanel(segs, tracks) {
    transcriptSegments = segs;

    const p = buildPanel(segs, tracks);

    // Try #secondary (Watch page sidebar), fall back to body
    const secondary = document.querySelector('#secondary, #secondary-inner, ytd-watch-flexy #secondary');
    if (secondary) {
      secondary.insertBefore(p, secondary.firstChild);
    } else {
      document.body.appendChild(p);
    }
  }

  // ── Show loading state ────────────────────────────────────────────────────────
  function showLoadingPanel() {
    if (panel) return; // already visible

    panel = document.createElement('div');
    panel.id = 'mark-yt-panel';
    panel.innerHTML = `
      <div class="mark-yt-header">
        <span class="mark-yt-title">Transcript</span>
        <button class="mark-yt-close" id="markYtClose" title="Close">✕</button>
      </div>
      <div class="mark-yt-body"><div class="mark-yt-loading">Loading transcript…</div></div>
    `;
    panel.querySelector('#markYtClose').addEventListener('click', () => {
      panel.remove();
      panel = null;
    });

    const secondary = document.querySelector('#secondary, #secondary-inner, ytd-watch-flexy #secondary');
    if (secondary) secondary.insertBefore(panel, secondary.firstChild);
    else document.body.appendChild(panel);
  }

  // ── Handle incoming track data from MAIN world ────────────────────────────────
  async function handleTracks(tracks) {
    const vidId = videoIdFromUrl(location.href);

    // If same video + panel already open, skip (unless tracks updated)
    if (vidId === currentVideoId && panel) return;
    currentVideoId = vidId;

    if (!tracks || tracks.length === 0) {
      if (panel) {
        panel.querySelector('#markYtBody').innerHTML =
          '<div class="mark-yt-loading">No transcript available for this video.</div>';
      }
      return;
    }

    // If panel is open from loading state, update it; else inject fresh
    if (!panel) return; // User hasn't opened panel yet

    panel.querySelector('#markYtBody').innerHTML =
      '<div class="mark-yt-loading">Loading transcript…</div>';

    try {
      const segs = await fetchTranscript(tracks);
      transcriptSegments = segs;
      if (panel) {
        panel.remove();
        panel = null;
      }
      injectPanel(segs, tracks);
    } catch (err) {
      if (panel) {
        panel.querySelector('#markYtBody').innerHTML =
          `<div class="mark-yt-loading">Failed to load transcript: ${err.message}</div>`;
      }
    }
  }

  // ── Toggle panel button ───────────────────────────────────────────────────────
  let pendingTracks = null;

  function injectToggleButton() {
    if (document.getElementById('markYtToggleBtn')) return;

    // Wait for the actions bar to be present
    const actions = document.querySelector('#actions-inner, #top-level-buttons-computed, #menu-container');
    if (!actions) return;

    const btn = document.createElement('button');
    btn.id = 'markYtToggleBtn';
    btn.className = 'mark-yt-toggle-btn';
    btn.title = 'Toggle transcript (Mark)';
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8">
        <path d="M2 4h12M2 8h8M2 12h10"/>
      </svg>
      Transcript
    `;

    btn.addEventListener('click', async () => {
      if (panel) {
        panel.remove();
        panel = null;
        return;
      }

      showLoadingPanel();

      if (pendingTracks) {
        await handleTracks(pendingTracks);
      } else {
        // Request tracks from MAIN world
        window.postMessage({ type: 'mark-yt-request-tracks' }, '*');
      }
    });

    actions.appendChild(btn);
  }

  // ── Listen for MAIN world messages ───────────────────────────────────────────
  window.addEventListener('message', async e => {
    if (e.source !== window) return;
    if (e.data?.type === 'mark-yt-tracks') {
      const tracks = e.data.tracks || [];
      pendingTracks = tracks.length > 0 ? tracks : null;

      // If panel is loading, proceed to fill it
      if (panel) {
        await handleTracks(tracks);
      }
    }
  });

  // ── Watch for DOM readiness and SPA navigations ───────────────────────────────
  function onNavigate() {
    // Remove stale panel and button on navigation
    if (panel) { panel.remove(); panel = null; }
    const oldBtn = document.getElementById('markYtToggleBtn');
    if (oldBtn) oldBtn.remove();
    pendingTracks = null;
    currentVideoId = null;

    // Wait for secondary column to appear
    waitForSecondary();
  }

  function waitForSecondary() {
    if (document.querySelector('#secondary, ytd-watch-flexy #secondary')) {
      injectToggleButton();
      return;
    }
    const obs = new MutationObserver(() => {
      if (document.querySelector('#secondary, ytd-watch-flexy #secondary')) {
        obs.disconnect();
        injectToggleButton();
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
    // Timeout fallback
    setTimeout(() => { obs.disconnect(); injectToggleButton(); }, 5000);
  }

  document.addEventListener('yt-navigate-finish', onNavigate);

  // Initial page load
  waitForSecondary();
})();
