(function () {
  function normalizeBuiltinStages(stages) {
    if (!Array.isArray(stages)) return null;
    var out = [];
    for (var i = 0; i < stages.length; i++) {
      var src = stages[i];
      if (!src || typeof src !== 'object') continue;
      var s = JSON.parse(JSON.stringify(src));
      var w = Number(s.worldW);
      var h = Number(s.worldH);
      s.worldW = Number.isFinite(w) && w >= 100 ? w : 1400;
      s.worldH = Number.isFinite(h) && h >= 100 ? h : 720;
      if (!s.spawn || typeof s.spawn !== 'object') s.spawn = { x: 80, y: 520 };
      else {
        s.spawn.x = Number(s.spawn.x);
        s.spawn.y = Number(s.spawn.y);
        if (!Number.isFinite(s.spawn.x)) s.spawn.x = 80;
        if (!Number.isFinite(s.spawn.y)) s.spawn.y = 520;
      }
      if (!Array.isArray(s.platforms)) s.platforms = [];
      s.platforms = s.platforms
        .filter(function (p) {
          return p && typeof p === 'object';
        })
        .map(function (p) {
          return {
            x: Number(p.x),
            y: Number(p.y),
            w: Number(p.w),
            h: Number(p.h),
            move: p.move,
            noWallJump: p.noWallJump,
            warnVertical: p.warnVertical,
            bossPassThrough: p.bossPassThrough,
          };
        })
        .filter(function (p) {
          return Number.isFinite(p.x) && Number.isFinite(p.y) && p.w > 0 && p.h > 0;
        });
      out.push(s);
    }
    return out.length ? out : null;
  }

  function isValidBuiltinStages(stages) {
    var norm = normalizeBuiltinStages(stages);
    if (!norm || !norm.length) return false;
    for (var i = 0; i < norm.length; i++) {
      if (!norm[i].platforms || !norm[i].platforms.length) return false;
    }
    return true;
  }

  function prepareBuiltinStagesForPlay(stages) {
    var norm = normalizeBuiltinStages(stages);
    if (!norm || !isValidBuiltinStages(norm)) return null;
    return norm;
  }

  function snapshotBundledCampaign() {
    if (window.SKYHOP_STAGES && window.SKYHOP_STAGES.length && !window.__SKYHOP_STAGES_FILE_BACKUP) {
      window.__SKYHOP_STAGES_FILE_BACKUP = window.SKYHOP_STAGES;
    }
    if (window.SKYHOP_WORLD2_STAGES && window.SKYHOP_WORLD2_STAGES.length && !window.__SKYHOP_WORLD2_FILE_BACKUP) {
      window.__SKYHOP_WORLD2_FILE_BACKUP = window.SKYHOP_WORLD2_STAGES;
    }
  }

  function restoreBundledCampaignFromFiles() {
    snapshotBundledCampaign();
    if (typeof window.SKYHOP_REBUILD_STAGES === 'function') window.SKYHOP_REBUILD_STAGES();
    if (window.SKYHOP_PREP_STAGES) window.SKYHOP_PREP_STAGES();
    if (window.__SKYHOP_WORLD2_FILE_BACKUP && window.__SKYHOP_WORLD2_FILE_BACKUP.length) {
      window.SKYHOP_WORLD2_STAGES = window.__SKYHOP_WORLD2_FILE_BACKUP;
    }
    if ((!window.SKYHOP_STAGES || !window.SKYHOP_STAGES.length) && window.__SKYHOP_STAGES_FILE_BACKUP) {
      window.SKYHOP_STAGES = window.__SKYHOP_STAGES_FILE_BACKUP;
    }
  }

  snapshotBundledCampaign();

  window.SkyHopValidateBuiltinStages = isValidBuiltinStages;
  window.SkyHopPrepareBuiltinStagesForPlay = prepareBuiltinStagesForPlay;
  window.SkyHopRestoreBundledCampaignFromFiles = restoreBundledCampaignFromFiles;
})();
