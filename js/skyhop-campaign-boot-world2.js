/**
 * World 2 Play uses GET /api/builtin-stages-world2 when that list is valid
 * and at least as long as bundled stages-world2.js. Boot is shared with World 1.
 */
(function () {
  if (typeof window.SkyHopBootServerCampaigns === 'function') {
    window.SkyHopBootServerCampaigns();
  }
})();
