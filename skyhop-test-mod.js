/**
 * Sky Hop test mod — safe to remove anytime.
 * Shows a badge when active; registers teardown so Delete removes effects immediately.
 */
(function () {
  if (window.__SKYHOP_TEST_MOD__) return;
  window.__SKYHOP_TEST_MOD__ = true;

  var modId = window.__skyhopInjectedModId;
  console.log('[SkyHop mod] skyhop-test-mod loaded', modId || '');

  var badge = document.createElement('div');
  badge.id = 'skyhopTestModBadge';
  badge.setAttribute('data-skyhop-mod-ui', '1');
  badge.textContent = 'Test mod active';
  badge.style.cssText =
    'pointer-events:none;position:fixed;bottom:4.5rem;left:50%;transform:translateX(-50%);' +
    'z-index:9999;padding:6px 12px;border-radius:999px;font:600 11px system-ui,sans-serif;' +
    'background:rgba(168,85,247,0.92);color:#fff;border:1px solid rgba(255,255,255,0.35);' +
    'box-shadow:0 4px 14px rgba(0,0,0,0.35);';
  document.body.appendChild(badge);

  var orig = window.SkyHopStartCampaignPlay;
  if (typeof orig === 'function') {
    window.SkyHopStartCampaignPlay = function () {
      console.log('[SkyHop mod] starting campaign with test mod');
      return orig.apply(this, arguments);
    };
  }

  function teardown() {
    if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
    if (typeof orig === 'function') window.SkyHopStartCampaignPlay = orig;
    delete window.__SKYHOP_TEST_MOD__;
  }

  if (modId && typeof window.SkyHopRegisterModTeardown === 'function') {
    window.SkyHopRegisterModTeardown(modId, teardown);
  }
})();
