/**
 * Play uses a valid uploaded World 1 campaign from GET /api/builtin-stages.
 * Empty, short, or broken server JSON is ignored so bundled stages.js stays.
 */
(function () {
  if (typeof window.SkyHopBootServerCampaigns === 'function') {
    window.SkyHopBootServerCampaigns();
  }
})();
