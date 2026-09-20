/**
 * Feature catalog FAB — content loaded from GET /api/site/feature-list (fallback: bundled HTML).
 */
(function () {
  async function applyFeatureListFromServer() {
    var body = document.getElementById('staffFeatureListBody');
    if (!body) return;
    var apiFn = window.SkyHopApiRequest;
    if (typeof apiFn !== 'function') return;
    try {
      var data = await apiFn('/api/site/feature-list', { method: 'GET', noAuth: true });
      if (data && data.html && String(data.html).trim()) {
        body.innerHTML = data.html;
      }
    } catch {
      /* keep bundled HTML in index.html */
    }
  }

  function bind() {
    var screen = document.getElementById('screenStaffFeatureList');
    var fab = document.getElementById('btnStaffFeatureList');
    var close = document.getElementById('btnStaffFeatureListClose');
    if (fab && screen) {
      fab.addEventListener('click', function () {
        screen.classList.remove('hidden');
        screen.classList.add('flex');
        void applyFeatureListFromServer();
        if (typeof window.SkyHopSyncOwnerStrikeTools === 'function') {
          window.SkyHopSyncOwnerStrikeTools();
        }
      });
    }
    if (close && screen) {
      close.addEventListener('click', function () {
        screen.classList.add('hidden');
        screen.classList.remove('flex');
      });
    }
    void applyFeatureListFromServer();
  }

  window.SkyHopRefreshFeatureListContent = applyFeatureListFromServer;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
