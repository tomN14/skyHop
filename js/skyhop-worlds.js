/**
 * Multi-world campaign: World 1 (50 stages), World 2 (harder), unlock + progress.
 */
(function () {
  const LS_UNLOCK = 'SKYHOP_WORLD2_UNLOCKED';
  const LS_PROGRESS_PREFIX = 'SKYHOP_RUN_PROGRESS_W';

  function world1Stages() {
    return window.SKYHOP_STAGES || [];
  }

  function world2Stages() {
    return window.SKYHOP_WORLD2_STAGES || [];
  }

  function bothStages() {
    return world1Stages().concat(world2Stages());
  }

  function isWorld2Unlocked() {
    try {
      return localStorage.getItem(LS_UNLOCK) === '1';
    } catch {
      return false;
    }
  }

  function markWorld1Complete() {
    try {
      localStorage.setItem(LS_UNLOCK, '1');
    } catch {
      /* */
    }
    syncMenuWorldArrow();
  }

  function progressKeyForWorld(worldId) {
    return LS_PROGRESS_PREFIX + String(worldId || 1);
  }

  function stagesForWorld(worldId) {
    const w = Number(worldId) || 1;
    if (w === 2) return world2Stages().slice();
    if (w === 'both' || w === 0) return bothStages();
    return world1Stages().slice();
  }

  function stageCount(worldId) {
    return stagesForWorld(worldId).length;
  }

  let activeWorldId = 1;
  let collabScope = null;

  function setActiveWorld(id) {
    activeWorldId = id === 2 ? 2 : id === 'both' ? 'both' : 1;
    collabScope = null;
  }

  function setCollabScope(scope) {
    collabScope = scope === 'w2' ? 'w2' : scope === 'both' ? 'both' : 'w1';
    activeWorldId = 1;
  }

  function clearCollabScope() {
    collabScope = null;
  }

  function getPlayStages() {
    if (collabScope === 'w2') return stagesForWorld(2);
    if (collabScope === 'both') return bothStages();
    if (collabScope === 'w1') return stagesForWorld(1);
    return stagesForWorld(activeWorldId);
  }

  function getActiveWorldLabel() {
    if (collabScope === 'both') return 'Collab — Both worlds';
    if (collabScope === 'w2') return 'Collab — World 2';
    if (collabScope === 'w1') return 'Collab — World 1';
    if (activeWorldId === 2) return 'World 2';
    return 'World 1';
  }

  function syncMenuWorldArrow() {
    var btn = document.getElementById('btnMenuWorldNext');
    if (!btn) return;
    var show = isWorld2Unlocked();
    btn.classList.toggle('hidden', !show);
    btn.classList.toggle('inline-flex', show);
  }

  function bindMenuWorldNav() {
    var next = document.getElementById('btnMenuWorldNext');
    var back = document.getElementById('btnMenuWorldBack');
    var main = document.getElementById('screenMenuMain');
    var w2 = document.getElementById('screenMenuWorld2');
    var playW2 = document.getElementById('btnPlayWorld2');
    if (next && main && w2) {
      next.addEventListener('click', function () {
        if (!isWorld2Unlocked()) return;
        main.classList.add('hidden');
        w2.classList.remove('hidden');
        w2.classList.add('flex');
      });
    }
    if (back && main && w2) {
      back.addEventListener('click', function () {
        w2.classList.add('hidden');
        w2.classList.remove('flex');
        main.classList.remove('hidden');
      });
    }
    if (playW2) {
      playW2.addEventListener('click', function () {
        setActiveWorld(2);
        if (typeof window.SkyHopStartCampaignPlay === 'function') {
          window.SkyHopStartCampaignPlay();
        }
      });
    }
    syncMenuWorldArrow();
    window.addEventListener('skyhop-world2-unlocked', syncMenuWorldArrow);
  }

  window.SkyHopWorlds = {
    world1Stages: world1Stages,
    world2Stages: world2Stages,
    bothStages: bothStages,
    stagesForWorld: stagesForWorld,
    stageCount: stageCount,
    isWorld2Unlocked: isWorld2Unlocked,
    markWorld1Complete: markWorld1Complete,
    progressKeyForWorld: progressKeyForWorld,
    setActiveWorld: setActiveWorld,
    setCollabScope: setCollabScope,
    clearCollabScope: clearCollabScope,
    getPlayStages: getPlayStages,
    getActiveWorldLabel: getActiveWorldLabel,
    getActiveWorldId: function () {
      return activeWorldId;
    },
    getCollabScope: function () {
      return collabScope;
    },
    syncMenuWorldArrow: syncMenuWorldArrow,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindMenuWorldNav);
  } else {
    bindMenuWorldNav();
  }
})();
