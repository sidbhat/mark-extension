(() => {
  'use strict';

  function extractTracks() {
    try {
      const resp = window.ytInitialPlayerResponse;
      if (!resp) return null;
      const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      return Array.isArray(tracks) && tracks.length > 0 ? tracks : null;
    } catch { return null; }
  }

  function tryPost() {
    const tracks = extractTracks();
    if (tracks) {
      window.postMessage({ type: 'mark-yt-tracks', tracks }, '*');
      return true;
    }
    return false;
  }

  // Try immediately (page already loaded)
  if (!tryPost()) {
    // Fallback: wait for ytInitialPlayerResponse to appear (script execution race)
    let attempts = 0;
    const interval = setInterval(() => {
      if (tryPost() || ++attempts > 20) clearInterval(interval);
    }, 200);
  }

  // SPA navigation: YouTube fires this on every video change
  document.addEventListener('yt-navigate-finish', () => {
    // Short delay for ytInitialPlayerResponse to update
    setTimeout(() => {
      const tracks = extractTracks();
      if (tracks) window.postMessage({ type: 'mark-yt-tracks', tracks }, '*');
      else window.postMessage({ type: 'mark-yt-tracks', tracks: [] }, '*');
    }, 800);
  });
})();
