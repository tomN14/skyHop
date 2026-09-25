/**
 * Main-menu guide for the SkyHop SPL API (not the whole language).
 * Body HTML comes from GET /api/site/script-guide. The page keeps a fallback.
 */
(function () {
  async function applyScriptGuideFromServer() {
    var body = document.getElementById('splGuideBody');
    if (!body) return;
    var apiFn = window.SkyHopApiRequest;
    if (typeof apiFn !== 'function') return;
    try {
      var data = await apiFn('/api/site/script-guide', { method: 'GET', noAuth: true });
      if (data && data.html && String(data.html).trim()) {
        body.innerHTML = data.html;
      }
    } catch {
      /* keep the HTML bundled in the page */
    }
  }

  function bind() {
    var fab = document.getElementById('btnSplGuideFab');
    var screen = document.getElementById('screenSplGuide');
    var close = document.getElementById('btnSplGuideClose');
    if (fab && screen) {
      fab.addEventListener('click', function () {
        screen.classList.remove('hidden');
        screen.classList.add('flex');
        void applyScriptGuideFromServer();
      });
    }
    if (close && screen) {
      close.addEventListener('click', function () {
        screen.classList.add('hidden');
        screen.classList.remove('flex');
      });
    }
    void applyScriptGuideFromServer();
  }

  window.SkyHopRefreshScriptGuide = applyScriptGuideFromServer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
