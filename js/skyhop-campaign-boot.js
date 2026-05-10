/**
 * Optional server override for built-in campaign. Runs after skyhop-stage-prep.js (needs SKYHOP_PREP_STAGE_LIST).
 * Do not call SKYHOP_REBUILD_STAGES after apply — that would restore file-only stages.
 */
(function () {
  function apiOrigin() {
    try {
      const ovr = localStorage.getItem('SKYHOP_API_ORIGIN');
      if (ovr && ovr.trim()) return new URL(ovr.trim().replace(/\/$/, '')).origin;
    } catch {
      /* */
    }
    try {
      if (typeof window !== 'undefined' && window.location && window.location.origin) {
        return window.location.origin;
      }
    } catch {
      /* */
    }
    return 'http://127.0.0.1:3001';
  }

  function applyServerStages(stages) {
    if (!stages || !Array.isArray(stages) || !stages.length) return;
    try {
      const copy = JSON.parse(JSON.stringify(stages));
      if (window.SKYHOP_PREP_STAGE_LIST) window.SKYHOP_PREP_STAGE_LIST(copy);
      window.SKYHOP_STAGES = copy;
      try {
        window.dispatchEvent(new CustomEvent('skyhop-campaign-loaded'));
      } catch {
        /* */
      }
    } catch (e) {
      console.warn('Sky Hop: could not apply server campaign', e);
    }
  }

  fetch(apiOrigin() + '/api/builtin-stages', { credentials: 'omit' })
    .then(function (r) {
      return r.ok ? r.json() : null;
    })
    .then(function (j) {
      if (j && j.stages && j.stages.length) applyServerStages(j.stages);
    })
    .catch(function () {
      /* offline / static */
    });
})();
