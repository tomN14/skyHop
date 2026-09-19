(function () {
  function apiOrigin() {
    try {
      const ovr = localStorage.getItem('SKYHOP_API_ORIGIN');
      if (ovr && ovr.trim()) return new URL(ovr.trim().replace(/\/$/, '')).origin;
    } catch {
      /* */
    }
    return window.location.origin;
  }

  function apply(stages) {
    if (!stages || !stages.length) return;
    var prepared =
      typeof window.SkyHopPrepareBuiltinStagesForPlay === 'function'
        ? window.SkyHopPrepareBuiltinStagesForPlay(stages)
        : null;
    if (!prepared) {
      console.warn('Sky Hop: ignoring invalid server World 2 campaign; using bundled stages-world2.js');
      return;
    }
    try {
      const copy = prepared;
      if (window.SKYHOP_PREP_STAGE_LIST) window.SKYHOP_PREP_STAGE_LIST(copy);
      window.SKYHOP_WORLD2_STAGES = copy;
    } catch (e) {
      console.warn('Sky Hop: world 2 stages apply failed', e);
    }
  }

  fetch(apiOrigin() + '/api/builtin-stages-world2', { credentials: 'omit' })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (j) {
      if (j && j.stages && j.stages.length) apply(j.stages);
    })
    .catch(function () {
      /* use stages-world2.js default */
    });
})();
