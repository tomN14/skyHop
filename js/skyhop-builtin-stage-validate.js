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
          var row = {
            x: Number(p.x),
            y: Number(p.y),
            w: Number(p.w),
            h: Number(p.h),
            move: p.move,
            noWallJump: p.noWallJump,
            warnVertical: p.warnVertical,
            bossPassThrough: p.bossPassThrough,
            color: p.color,
            invisible: p.invisible,
            rainbow: p.rainbow,
            rot: p.rot,
          };
          if (p.id != null && String(p.id)) row.id = String(p.id);
          return row;
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

  function bundledMinLength(worldId) {
    snapshotBundledCampaign();
    if (worldId === 2) {
      var b2 = window.__SKYHOP_WORLD2_FILE_BACKUP;
      return b2 && b2.length ? b2.length : 1;
    }
    var b1 = window.__SKYHOP_STAGES_FILE_BACKUP;
    return b1 && b1.length ? b1.length : 50;
  }

  function prepAppliedList(worldId, prepared) {
    if (worldId === 2) {
      if (typeof window.SKYHOP_PREP_STAGE_LIST === 'function') window.SKYHOP_PREP_STAGE_LIST(prepared);
      return;
    }
    if (typeof window.SKYHOP_PREP_STAGES === 'function') window.SKYHOP_PREP_STAGES();
  }

  function applyServerCampaign(worldId, stages) {
    snapshotBundledCampaign();
    var prepared = prepareBuiltinStagesForPlay(stages);
    if (!prepared) return false;
    var minLen = bundledMinLength(worldId);
    if (prepared.length < minLen) return false;
    if (worldId === 2) {
      window.SKYHOP_WORLD2_STAGES = prepared;
    } else {
      window.SKYHOP_STAGES = prepared;
    }
    prepAppliedList(worldId, prepared);
    return true;
  }

  function restoreBundledWorld1() {
    snapshotBundledCampaign();
    if (typeof window.SKYHOP_REBUILD_STAGES === 'function') window.SKYHOP_REBUILD_STAGES();
    if (window.SKYHOP_PREP_STAGES) window.SKYHOP_PREP_STAGES();
    if ((!window.SKYHOP_STAGES || !window.SKYHOP_STAGES.length) && window.__SKYHOP_STAGES_FILE_BACKUP) {
      window.SKYHOP_STAGES = window.__SKYHOP_STAGES_FILE_BACKUP;
    }
  }

  function restoreBundledWorld2() {
    snapshotBundledCampaign();
    if (window.__SKYHOP_WORLD2_FILE_BACKUP && window.__SKYHOP_WORLD2_FILE_BACKUP.length) {
      window.SKYHOP_WORLD2_STAGES = window.__SKYHOP_WORLD2_FILE_BACKUP;
    }
  }

  function restoreBundledCampaignFromFiles() {
    restoreBundledWorld1();
    restoreBundledWorld2();
  }

  function campaignNeedsBundledRestore(stages, worldId) {
    if (!stages || !stages.length) return true;
    if (stages.length < bundledMinLength(worldId)) return true;
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i];
      if (!s || !s.spawn) return true;
      if (!s.platforms || !s.platforms.length) return true;
    }
    return false;
  }

  function restoreBundledIfInvalid() {
    if (campaignNeedsBundledRestore(window.SKYHOP_STAGES, 1)) restoreBundledWorld1();
    if (campaignNeedsBundledRestore(window.SKYHOP_WORLD2_STAGES, 2)) restoreBundledWorld2();
  }

  function campaignApiOrigin() {
    try {
      var ovr = localStorage.getItem('SKYHOP_API_ORIGIN');
      if (ovr && ovr.trim()) return new URL(ovr.trim().replace(/\/$/, '')).origin;
    } catch (e) {
      /* invalid override */
    }
    try {
      var race = localStorage.getItem('SKYHOP_RACE_SERVER_URL');
      if (race) {
        var u = new URL(race);
        u.protocol = u.protocol === 'wss:' ? 'https:' : 'http:';
        if (window.location && window.location.protocol === 'https:' && u.protocol === 'http:') {
          return window.location.origin;
        }
        return u.origin;
      }
    } catch (e2) {
      /* */
    }
    try {
      if (window.location && window.location.protocol === 'file:') return 'http://127.0.0.1:3001';
      if (window.location && window.location.origin && window.location.origin !== 'null') {
        return window.location.origin;
      }
    } catch (e3) {
      /* */
    }
    return 'http://127.0.0.1:3001';
  }

  function fetchServerCampaign(worldId) {
    var origin = campaignApiOrigin();
    if (!origin) return Promise.resolve(false);
    var path = worldId === 2 ? '/api/builtin-stages-world2' : '/api/builtin-stages';
    return fetch(origin + path, { credentials: 'omit', cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (data) {
        if (!data || !data.stages) return false;
        return applyServerCampaign(worldId, data.stages);
      })
      .catch(function () {
        return false;
      });
  }

  function bootServerCampaigns() {
    if (window.SKYHOP_CAMPAIGN_BOOT) return window.SKYHOP_CAMPAIGN_BOOT;
    var done = Promise.all([fetchServerCampaign(1), fetchServerCampaign(2)]).then(function (results) {
      if (results[0] || results[1]) {
        try {
          window.dispatchEvent(new CustomEvent('skyhop-campaign-loaded'));
        } catch (e) {
          /* */
        }
      }
    });
    var timeout = new Promise(function (resolve) {
      setTimeout(resolve, 2000);
    });
    window.SKYHOP_CAMPAIGN_BOOT = Promise.race([done, timeout]).then(function () {
      window.__SKYHOP_SERVER_CAMPAIGN_READY = true;
    });
    return window.SKYHOP_CAMPAIGN_BOOT;
  }

  snapshotBundledCampaign();

  window.SkyHopValidateBuiltinStages = isValidBuiltinStages;
  window.SkyHopPrepareBuiltinStagesForPlay = prepareBuiltinStagesForPlay;
  window.SkyHopApplyServerCampaign = applyServerCampaign;
  window.SkyHopRestoreBundledCampaignFromFiles = restoreBundledCampaignFromFiles;
  window.SkyHopRestoreBundledIfInvalid = restoreBundledIfInvalid;
  window.SkyHopBootServerCampaigns = bootServerCampaigns;
})();
