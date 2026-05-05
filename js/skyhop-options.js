/**
 * Difficulty + custom tuning. Loaded before skyhop-game.js.
 */
(function () {
  const LS = 'SKYHOP_CUSTOM_OPTIONS';
  const LS_PROJ = 'SKYHOP_PROJECTILE_OPTS';

  window.SKYHOP_PROJECTILE_MAX_LIFETIME_MS = 15000;
  window.SKYHOP_DEFAULT_PROJECTILE_OPTS = {
    despawn: false,
    envCollide: false,
    frequentProjectiles: false,
    stageCooldownEnabled: true,
    fastProjectiles: false,
  };

  function loadProjectileOpts() {
    try {
      const j = JSON.parse(localStorage.getItem(LS_PROJ) || '{}');
      return { ...window.SKYHOP_DEFAULT_PROJECTILE_OPTS, ...j };
    } catch {
      return { ...window.SKYHOP_DEFAULT_PROJECTILE_OPTS };
    }
  }

  function saveProjectileOpts(obj) {
    localStorage.setItem(
      LS_PROJ,
      JSON.stringify({ ...window.SKYHOP_DEFAULT_PROJECTILE_OPTS, ...obj })
    );
  }

  /** Merge global projectile rules (all difficulties). */
  window.SKYHOP_enrichRuntimeWithProjectileOpts = function (runtime) {
    const p = loadProjectileOpts();
    runtime.projectileDespawn15s = !!p.despawn;
    runtime.projectileEnvCollide = !!p.envCollide;
    runtime.projectileStageCooldownEnabled = p.stageCooldownEnabled !== false;
    if (runtime.difficulty === 'custom') {
      if (runtime.projectileFreqMul == null || !Number.isFinite(runtime.projectileFreqMul)) {
        runtime.projectileFreqMul = 1;
      }
      if (runtime.projectileSpeedMul == null || !Number.isFinite(runtime.projectileSpeedMul)) {
        runtime.projectileSpeedMul = 1;
      }
    } else {
      runtime.projectileFreqMul = p.frequentProjectiles ? 2 : 1;
      runtime.projectileSpeedMul = p.fastProjectiles ? 1.5 : 1;
    }
    return runtime;
  };

  window.SKYHOP_loadProjectileOpts = loadProjectileOpts;
  window.SKYHOP_saveProjectileOpts = saveProjectileOpts;

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  window.SKYHOP_DEFAULT_CUSTOM = {
    runMul: 1,
    gravityMul: 1,
    frictionMul: 1,
    jumpMul: 1,
    airControlMul: 1,
    bossHitsPlayer: 2,
    monsterSpeedMul: 1,
    bossMoveSpeedMul: 1,
    allowSkip: false,
    fireballsOff: false,
    /** Final-boss +30 potion airdrops (same default as Normal). */
    epicHealDrops: true,
    bossHp: 5,
    projectileSpeedMul: 1,
    fireballChasing: false,
    monsterChasing: true,
    bossAttacks: true,
    projectileFreqMul: 1,
    projectileStageCooldownSec: 2,
    projectileLoopCooldownSec: 2.2,
  };

  function loadCustom() {
    try {
      const j = JSON.parse(localStorage.getItem(LS) || '{}');
      const m = { ...window.SKYHOP_DEFAULT_CUSTOM, ...j };
      if (m.projectileSpeedMul == null && m.fireballSpeedMul != null) {
        m.projectileSpeedMul = m.fireballSpeedMul;
      }
      return m;
    } catch {
      return { ...window.SKYHOP_DEFAULT_CUSTOM };
    }
  }

  function saveCustom(obj) {
    localStorage.setItem(LS, JSON.stringify({ ...window.SKYHOP_DEFAULT_CUSTOM, ...obj }));
  }

  /**
   * @param {'easy'|'normal'|'hard'|'custom'} diff
   * @param {object} [customSnapshot] optional merged custom (from form); else load from LS
   */
  window.SKYHOP_buildRuntimeOptions = function (diff, customSnapshot) {
    const c = customSnapshot || loadCustom();
    const base = {
      difficulty: diff,
      fireballsEnabled: true,
      fireballsHoming: false,
      bossShoots: true,
      bossBulletsHoming: false,
      bossPlayerMaxHp: 2,
      monstersFriendly: false,
      monsterChaseMatchRun: false,
      monsterSpeedMul: 1,
      bossMoveSpeedMul: 1,
      bossHpOverride: null,
      allowSkip: false,
      runMul: 1,
      gravityMul: 1,
      frictionMul: 1,
      jumpMul: 1,
      airControlMul: 1,
      projectileSpeedMul: 1,
      projectileFreqMul: 1,
      epicHealPotionDrops: true,
    };

    if (diff === 'easy') {
      return {
        ...base,
        difficulty: 'easy',
        fireballsEnabled: false,
        bossShoots: false,
        monstersFriendly: true,
        bossPlayerMaxHp: 2,
      };
    }
    if (diff === 'hard') {
      return {
        ...base,
        difficulty: 'hard',
        bossPlayerMaxHp: 1,
        fireballsHoming: true,
        bossBulletsHoming: true,
        monsterChaseMatchRun: true,
        monsterSpeedMul: 1,
        epicHealPotionDrops: false,
      };
    }
    if (diff === 'normal') {
      return { ...base, difficulty: 'normal' };
    }

    return {
      ...base,
      difficulty: 'custom',
      fireballsEnabled: !c.fireballsOff,
      fireballsHoming: !!c.fireballChasing,
      bossShoots: !!c.bossAttacks,
      bossPlayerMaxHp: clamp(Math.round(Number(c.bossHitsPlayer) || 2), 1, 5),
      monsterSpeedMul: clamp(Number(c.monsterSpeedMul) || 1, 0.5, 2),
      bossMoveSpeedMul: clamp(Number(c.bossMoveSpeedMul) || 1, 0.5, 2),
      bossHpOverride: clamp(Math.round(Number(c.bossHp) || 5), 1, 20),
      allowSkip: !!c.allowSkip,
      runMul: clamp(Number(c.runMul) || 1, 0.35, 2.5),
      gravityMul: clamp(Number(c.gravityMul) || 1, 0.35, 2.5),
      frictionMul: clamp(Number(c.frictionMul) || 1, 0.25, 2.5),
      jumpMul: clamp(Number(c.jumpMul) || 1, 0.4, 1.6),
      airControlMul: clamp(Number(c.airControlMul) || 1, 0.25, 1.5),
      projectileSpeedMul: clamp(
        Number(c.projectileSpeedMul ?? c.fireballSpeedMul) || 1,
        0.5,
        3
      ),
      monsterChasing: !!c.monsterChasing,
      projectileFreqMul: clamp(Number(c.projectileFreqMul) || 1, 0.35, 3),
      projectileStageCooldownSec: clamp(Number(c.projectileStageCooldownSec) || 0, 0, 10),
      projectileLoopCooldownSec: clamp(Number(c.projectileLoopCooldownSec) || 2.2, 0.1, 5),
      epicHealPotionDrops: c.epicHealDrops !== false,
    };
  };

  window.SKYHOP_loadCustomOptions = loadCustom;
  window.SKYHOP_saveCustomOptions = saveCustom;
})();
