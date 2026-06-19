(function () {
  function builtinCampaign() {
    return window.SKYHOP_STAGES || [];
  }
  const C = window.SKYHOP_C;
  const PHY = window.SKYHOP_PHYSICS;

  if (window.SKYHOP_PREP_STAGES) window.SKYHOP_PREP_STAGES();

  if (!builtinCampaign().length) {
    console.error('Sky Hop: load stages (SKYHOP_STAGES) before skyhop-game.js');
    return;
  }

  function stagesNow() {
    return window.SKYHOP_ACTIVE_STAGES != null ? window.SKYHOP_ACTIVE_STAGES : builtinCampaign();
  }

  /** 0-based index of first stage that introduces grapple in the active stage list. */
  function grappleIntroIndex() {
    const S = stagesNow();
    const i = S.findIndex((s) => s && s.grapple);
    return i >= 0 ? i : S.length;
  }

  function debugStartStageIndex() {
    const raw = window.SKYHOP_DEBUG_START_STAGE;
    if (raw == null || raw === '') return 0;
    const n = Math.floor(Number(raw));
    if (!Number.isFinite(n)) return 0;
    const idx = n - 1;
    return Math.max(0, Math.min(builtinCampaign().length - 1, idx));
  }

  const RUN_PROGRESS_LS = 'SKYHOP_RUN_PROGRESS';
  function isDebugStartStageActive() {
    const r = window.SKYHOP_DEBUG_START_STAGE;
    if (r == null || r === '' || r === 'false' || r === false) return false;
    if (r === 0) return true;
    return String(r).trim() !== '';
  }

  function loadRunProgress() {
    try {
      const j = JSON.parse(localStorage.getItem(RUN_PROGRESS_LS) || 'null');
      if (!j || j.v !== 1) return null;
      const s0 = Math.floor(Number(j.s0));
      if (!Number.isFinite(s0) || s0 < 0 || s0 >= builtinCampaign().length) return null;
      return {
        s0: Math.max(0, Math.min(builtinCampaign().length - 1, s0)),
        deaths: Math.max(0, Math.floor(Number(j.deaths) || 0)),
        sword: !!j.sword,
        shield: !!j.shield,
      };
    } catch {
      return null;
    }
  }

  function clearRunProgress() {
    try {
      localStorage.removeItem(RUN_PROGRESS_LS);
    } catch {
      /* ignore */
    }
  }

  function progressStage0ForStorage() {
    if (window.SKYHOP_EXTERNAL_LEVEL) return stageIndex;
    if (gameState === 'stage_clear' && stageIndex < builtinCampaign().length - 1) {
      return Math.min(stageIndex + 1, builtinCampaign().length - 1);
    }
    return stageIndex;
  }

  function saveRunProgress() {
    if (window.SKYHOP_EXTERNAL_LEVEL) return;
    if (inRace) return;
    if (isDebugStartStageActive()) return;
    if (gameState === 'menu' || gameState === 'win') return;
    const s0 = progressStage0ForStorage();
    const payload = {
      v: 1,
      s0,
      deaths,
      sword: hasWoodenSword,
      shield: hasShield,
    };
    try {
      localStorage.setItem(RUN_PROGRESS_LS, JSON.stringify(payload));
    } catch {
      /* private mode, quota */
    }
  }

  const menuProgressHint = document.getElementById('menuProgressHint');
  function syncMenuProgressUI() {
    if (isDebugStartStageActive()) {
      if (menuProgressHint) {
        menuProgressHint.classList.add('hidden');
        menuProgressHint.textContent = '';
      }
      if (btnPlay) btnPlay.textContent = 'Play (debug start)';
      return;
    }
    const p = loadRunProgress();
    if (p && (p.s0 > 0 || p.deaths > 0 || p.sword || p.shield)) {
      if (menuProgressHint) {
        menuProgressHint.classList.remove('hidden');
        menuProgressHint.textContent = `Resume: stage ${p.s0 + 1} / ${builtinCampaign().length} — ${p.deaths} death${p.deaths === 1 ? '' : 's'}`;
      }
      if (btnPlay) btnPlay.textContent = `Continue — stage ${p.s0 + 1}`;
    } else if (p) {
      if (menuProgressHint) {
        menuProgressHint.classList.remove('hidden');
        menuProgressHint.textContent = `Resume: stage 1 / ${builtinCampaign().length}`;
      }
      if (btnPlay) btnPlay.textContent = 'Continue — stage 1';
    } else {
      if (menuProgressHint) {
        menuProgressHint.classList.add('hidden');
        menuProgressHint.textContent = '';
      }
      if (btnPlay) btnPlay.textContent = 'Play';
    }
  }
  window.syncMenuProgressUIForRace = syncMenuProgressUI;

  function formatTotalRunTime(ms) {
    if (!Number.isFinite(ms) || ms < 0) ms = 0;
    const tSec = Math.floor(ms / 1000);
    const h = Math.floor(tSec / 3600);
    const m = Math.floor((tSec % 3600) / 60);
    const s = tSec % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function getSensitivity() {
    const v = parseFloat(localStorage.getItem('SKYHOP_SENSITIVITY') || '1');
    return Number.isFinite(v) ? Math.max(0.35, Math.min(2.5, v)) : 1;
  }

  const canvas = document.getElementById('gameCanvas');
  const ctx = canvas && canvas.getContext('2d');
  if (!canvas || !ctx) {
    console.error('Sky Hop: #gameCanvas missing');
    return;
  }
  const hud = document.getElementById('hud');
  const hudStage = document.getElementById('hudStage');
  const hudDeaths = document.getElementById('hudDeaths');
  const hudTimer = document.getElementById('hudTimer');
  const hudBossHpWrap = document.getElementById('hudBossHpWrap');
  const hudBossHpFill = document.getElementById('hudBossHpFill');
  const hudBossHpNums = document.getElementById('hudBossHpNums');
  const hudEpicBossWrap = document.getElementById('hudEpicBossWrap');
  const hudEpicBossFill = document.getElementById('hudEpicBossFill');
  const hudEpicBossNums = document.getElementById('hudEpicBossNums');
  const hudWeaponsWrap = document.getElementById('hudWeaponsWrap');
  const hudSwordBlock = document.getElementById('hudSwordBlock');
  const hudSwordFill = document.getElementById('hudSwordFill');
  const hudSwordTime = document.getElementById('hudSwordTime');
  const hudShieldBlock = document.getElementById('hudShieldBlock');
  const hudShieldFill = document.getElementById('hudShieldFill');
  const hudShieldTime = document.getElementById('hudShieldTime');
  const hudShieldActive = document.getElementById('hudShieldActive');
  const hudHealDropBlock = document.getElementById('hudHealDropBlock');
  const hudHealDropFill = document.getElementById('hudHealDropFill');
  const hudHealDropTime = document.getElementById('hudHealDropTime');
  const screenWeapon = document.getElementById('screenWeapon');
  const weaponModalTitle = document.getElementById('weaponModalTitle');
  const weaponModalBody = document.getElementById('weaponModalBody');
  const btnWeaponOk = document.getElementById('btnWeaponOk');
  const screenMenu = document.getElementById('screenMenu');
  const screenRaceMenu = document.getElementById('screenRaceMenu');
  const screenStageClear = document.getElementById('screenStageClear');
  const screenWin = document.getElementById('screenWin');
  const screenPause = document.getElementById('screenPause');
  const stageClearTitle = document.getElementById('stageClearTitle');
  const stageClearSub = document.getElementById('stageClearSub');
  const btnPlay = document.getElementById('btnPlay');
  const btnNextStage = document.getElementById('btnNextStage');
  const btnPlayAgain = document.getElementById('btnPlayAgain');
  const btnResume = document.getElementById('btnResume');
  const btnExitToMenu = document.getElementById('btnExitToMenu');
  const btnPauseHud = document.getElementById('btnPauseHud');
  const btnSkipStage = document.getElementById('btnSkipStage');
  const winDeaths = document.getElementById('winDeaths');
  const winTime = document.getElementById('winTime');
  const sensSlider = document.getElementById('sensSlider');
  const sensValue = document.getElementById('sensValue');
  const optProjDespawn = document.getElementById('optProjDespawn');
  const optProjEnv = document.getElementById('optProjEnv');
  const optProjFrequent = document.getElementById('optProjFrequent');
  const optProjFrequentHint = document.getElementById('optProjFrequentHint');
  const optProjStageCd = document.getElementById('optProjStageCd');
  const optProjStageCdHint = document.getElementById('optProjStageCdHint');
  const optProjFast = document.getElementById('optProjFast');
  const optProjFastHint = document.getElementById('optProjFastHint');
  const optProjDespawnEnvHint = document.getElementById('optProjDespawnEnvHint');
  const hudHint = document.getElementById('hudHint');
  const diffEasy = document.getElementById('diffEasy');
  const diffNormal = document.getElementById('diffNormal');
  const diffHard = document.getElementById('diffHard');
  const diffCustom = document.getElementById('diffCustom');
  const customPanel = document.getElementById('customPanel');
  const custEls = {
    run: document.getElementById('custRunMul'),
    grav: document.getElementById('custGravMul'),
    fric: document.getElementById('custFrictionMul'),
    jump: document.getElementById('custJumpMul'),
    air: document.getElementById('custAirControlMul'),
    bossHits: document.getElementById('custBossHits'),
    mon: document.getElementById('custMonsterSpd'),
    bossMv: document.getElementById('custBossMoveSpd'),
    bossHp: document.getElementById('custBossHp'),
    fireSpd: document.getElementById('custFireSpdMul'),
    projFreq: document.getElementById('custProjFreqMul'),
    stageCd: document.getElementById('custStageCdSec'),
    loopCd: document.getElementById('custLoopCdSec'),
    fbChase: document.getElementById('custFbChase'),
    monChase: document.getElementById('custMonChase'),
    bossAtk: document.getElementById('custBossAtk'),
    skip: document.getElementById('custSkip'),
    noFire: document.getElementById('custNoFire'),
    potionDrops: document.getElementById('custPotionDrops'),
  };
  const custValEls = {
    run: document.getElementById('custRunVal'),
    grav: document.getElementById('custGravVal'),
    fric: document.getElementById('custFricVal'),
    jump: document.getElementById('custJumpVal'),
    air: document.getElementById('custAirVal'),
    bossHits: document.getElementById('custBossHitsVal'),
    mon: document.getElementById('custMonVal'),
    bossMv: document.getElementById('custBossMvVal'),
    bossHp: document.getElementById('custBossHpVal'),
    fireSpd: document.getElementById('custFireSpdVal'),
    projFreq: document.getElementById('custProjFreqVal'),
    stageCd: document.getElementById('custStageCdVal'),
    loopCd: document.getElementById('custLoopCdVal'),
  };

  const K =
    'class="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-indigo-200"';
  const HUD_MOVEMENT = `<span class="text-slate-300"><kbd ${K}>←→</kbd> or <kbd ${K}>A</kbd> <kbd ${K}>D</kbd> move · <kbd ${K}>Space</kbd> / <kbd ${K}>W</kbd> / <kbd ${K}>↑</kbd> jump · <kbd ${K}>Esc</kbd> pause · <kbd ${K}>R</kbd> restart</span>`;
  const HUD_MECHANIC_HINTS = {
    4: 'Fireballs sweep in from the edges of the screen — stay clear of the orange streaks.',
    5: 'Lava is an instant reset. The pink bands at the top are only decoration.',
    6: 'Wall-jump: press jump while sliding on a vertical wall to climb narrow towers.',
    8: 'You have a double jump once per airtime. Platforms with a <span class="text-amber-200">gold outline</span> move — ride them.',
    19: 'Double jump is enabled here — you get <strong>one</strong> extra jump before you touch the ground again.',
    16: 'Pass through a <span class="text-amber-200">gold arrow</span> zone to flip gravity; another arrow flips it back. Ceiling and ledges count as ground.',
    22: 'Bright <span class="text-emerald-300">green walls</span> block you and <strong>do not</strong> allow wall-jumps. Flip gravity, pass through the ceiling crack, flip back, then touch the goal.',
    25: 'One patrols on a ledge — stomp or slip past. A single spike slides on the next platform — time your jump.',
    30:
      'Hold <kbd ' +
      K +
      '>Shift</kbd> to aim a hook at solid ground (facing <kbd ' +
      K +
      '>←</kbd> / <kbd ' +
      K +
      '>→</kbd> or <kbd ' +
      K +
      '>A</kbd> / <kbd ' +
      K +
      '>D</kbd>); <strong>release</strong> to zip toward the hook.',
  };

  function syncHudHint(stageIdx) {
    if (!hudHint) return;
    const n = stageIdx + 1;
    let html = null;
    if (n <= 3) html = HUD_MOVEMENT;
    else if (n === 35) {
      const hits = Math.max(1, runtimeOpts.bossPlayerMaxHp);
      html =
        '<span class="text-slate-300">Boss: you can take <strong class="text-rose-200">' +
        hits +
        '</strong> hit' +
        (hits === 1 ? '' : 's') +
        ' (HP bar) before the run ends. Stomp from above to damage the boss. · <kbd ' +
        K +
        '>Esc</kbd> pause · <kbd ' +
        K +
        '>R</kbd> restart</span>';
    } else if (n === 49) {
      html =
        '<span class="text-slate-300">Pick up the <strong>wooden sword</strong> and <strong>shield</strong> — a popup will explain their controls. Then reach the goal. · <kbd ' +
        K +
        '>Esc</kbd> pause · <kbd ' +
        K +
        '>R</kbd> restart</span>';
    } else if (n === 50) {
      html =
        '<span class="text-slate-300">Final boss: <strong>double jump</strong> on. The boss <strong>floats</strong> and moves <strong>at random</strong> (ignores platforms). Gaps, high route, laser. <kbd ' +
        K +
        '>S</kbd>/<kbd ' +
        K +
        '>B</kbd> weapons, stomp, dodge. · <kbd ' +
        K +
        '>Esc</kbd> pause · <kbd ' +
        K +
        '>R</kbd> restart</span>';
    } else if (HUD_MECHANIC_HINTS[n]) {
      html =
        '<span class="text-slate-300">' +
        HUD_MECHANIC_HINTS[n] +
        ' · <kbd ' +
        K +
        '>Esc</kbd> pause · <kbd ' +
        K +
        '>R</kbd> restart</span>';
    }
    if (!html) {
      hudHint.classList.add('hidden');
      hudHint.innerHTML = '';
    } else {
      hudHint.classList.remove('hidden');
      hudHint.innerHTML = html;
    }
  }

  let gameState = 'menu';
  let inRace = false;
  /** @type {'easy'|'normal'|'hard'|'custom'} */
  let menuDifficulty = 'normal';
  let runtimeOpts = window.SKYHOP_enrichRuntimeWithProjectileOpts(
    window.SKYHOP_buildRuntimeOptions('normal')
  );
  let stageIndex = 0;
  function grappleUnlocked() {
    return stageIndex >= grappleIntroIndex();
  }
  let deaths = 0;
  let cameraX = 0;
  let cameraY = 0;
  let runStartedAt = 0;
  let runFrozenMs = 0;
  let runSegmentStart = 0;
  function resetRunClock() {
    runFrozenMs = 0;
    runSegmentStart = performance.now();
    runStartedAt = runSegmentStart;
    campaignCoinsThisRun = 0;
    pbInit();
    try {
      window.__skyhopRunStartBestMs =
        window.__skyhopLastMe && window.__skyhopLastMe.stats != null
          ? window.__skyhopLastMe.stats.bestTimeMs
          : null;
    } catch {
      window.__skyhopRunStartBestMs = null;
    }
  }
  function getRunElapsedMs() {
    const live =
      gameState === 'playing' || gameState === 'stage_clear' || gameState === 'weapon_modal';
    if (live) return runFrozenMs + (performance.now() - runSegmentStart);
    return runFrozenMs;
  }
  function sealRunClockSegment() {
    runFrozenMs += performance.now() - runSegmentStart;
    runSegmentStart = performance.now();
  }
  let campaignCoinsThisRun = 0;
  let stageCoinStates = [];
  let pbAntiFarm = null;

  function pbInit() {
    pbAntiFarm = {
      activeMs: 0,
      tenVel: [],
      path30: new Map(),
      start30: new Map(),
      closedEnd: new Map(),
      lastPx: player.x,
      lastPy: player.y,
      lastSi30: 0,
    };
    pbResetAttestClient();
    if (!window.SKYHOP_EXTERNAL_LEVEL && !inRace && typeof window.SkyHopCampaignAttestStart === 'function') {
      try {
        void window.SkyHopCampaignAttestStart();
      } catch {
        /* */
      }
    }
  }
  function pbStep(dtSec) {
    if (!pbAntiFarm || window.SKYHOP_EXTERNAL_LEVEL || inRace) return;
    const dtMs = Math.max(0, dtSec * 1000);
    pbAntiFarm.activeMs += dtMs;
    const a = pbAntiFarm;
    const si10 = Math.floor(a.activeMs / 10000);
    while (a.tenVel.length <= si10) a.tenVel.push(false);
    if (Math.abs(player.vx) > 12 || Math.abs(player.vy) > 12) a.tenVel[si10] = true;
    const si30 = Math.floor(a.activeMs / 30000);
    if (si30 > a.lastSi30) {
      for (let k = a.lastSi30; k < si30; k++) {
        a.closedEnd.set(k, { x: player.x, y: player.y });
      }
      a.lastSi30 = si30;
    }
    if (!a.start30.has(si30)) {
      a.start30.set(si30, { x: player.x, y: player.y });
      a.path30.set(si30, 0);
    }
    const dx = player.x - a.lastPx;
    const dy = player.y - a.lastPy;
    a.path30.set(si30, (a.path30.get(si30) || 0) + Math.hypot(dx, dy));
    a.lastPx = player.x;
    a.lastPy = player.y;
    pbMaybeSendCheckpoint();
  }
  function pbResetAttestClient() {
    pbAttestSeq = 0;
    pbLastCheckpointActiveMs = 0;
    try {
      if (typeof window.SkyHopCampaignAttestReset === 'function') {
        window.SkyHopCampaignAttestReset();
      }
    } catch {
      /* */
    }
  }

  function pbMaybeSendCheckpoint() {
    if (!pbAntiFarm || window.SKYHOP_EXTERNAL_LEVEL || inRace) return;
    if (pbAntiFarm.activeMs - pbLastCheckpointActiveMs < PB_CHECKPOINT_EVERY_MS) return;
    pbLastCheckpointActiveMs = pbAntiFarm.activeMs;
    if (typeof window.SkyHopCampaignAttestCheckpoint !== 'function') return;
    try {
      window.SkyHopCampaignAttestCheckpoint({
        seq: ++pbAttestSeq,
        activeMs: Math.round(pbAntiFarm.activeMs),
        x: Math.round(player.x),
        y: Math.round(player.y),
        vx: Math.round(player.vx),
        vy: Math.round(player.vy),
      });
    } catch {
      /* */
    }
  }

  function initStageCoins(stage) {
    stageCoinStates = [];
    const ext = window.SKYHOP_EXTERNAL_LEVEL;
    const claimed = ext && ext.onlineCoinsCollected instanceof Set ? ext.onlineCoinsCollected : null;
    const list = stage.coins;
    if (!list || !list.length) return;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const already = claimed && claimed.has(i);
      stageCoinStates.push({
        i,
        x: Number(c.x),
        y: Number(c.y),
        r: Number.isFinite(Number(c.r)) && Number(c.r) > 0 ? Number(c.r) : 14,
        collected: false,
        dim: !!already,
      });
    }
  }

  function tryCollectStageCoins() {
    if (!stageCoinStates.length) return;
    const ext = window.SKYHOP_EXTERNAL_LEVEL;
    const px = player.x + player.w / 2;
    const py = player.y + player.h / 2;
    const pr = Math.max(player.w, player.h) * 0.35;
    for (const c of stageCoinStates) {
      if (c.collected || c.dim) continue;
      if (Math.hypot(px - c.x, py - c.y) < pr + c.r) {
        c.collected = true;
        campaignCoinsThisRun += 1;
        if (ext && ext.levelUuid && ext.mode === 'play' && typeof ext.onCoinCollected === 'function') {
          ext.onCoinCollected(c.i);
        }
      }
    }
  }

  let stageStartedAt = 0;

  const keys = {};

  function bindTouchControl(id, keyNames) {
    const el = document.getElementById(id);
    if (!el || !keyNames || !keyNames.length) return;
    const setKeys = (down) => {
      for (const k of keyNames) keys[k] = down;
    };
    const onDown = (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      setKeys(true);
    };
    const onUp = (e) => {
      e.preventDefault();
      setKeys(false);
    };
    const peOpts = { passive: false };
    if (window.PointerEvent) {
      el.addEventListener('pointerdown', onDown, peOpts);
      el.addEventListener('pointerup', onUp, peOpts);
      el.addEventListener('pointercancel', onUp, peOpts);
      el.addEventListener('lostpointercapture', () => setKeys(false));
    } else {
      el.addEventListener(
        'touchstart',
        (e) => {
          e.preventDefault();
          setKeys(true);
        },
        { passive: false }
      );
      el.addEventListener(
        'touchend',
        (e) => {
          e.preventDefault();
          setKeys(false);
        },
        { passive: false }
      );
      el.addEventListener('touchcancel', () => setKeys(false), { passive: false });
      el.addEventListener('mousedown', (e) => {
        if (e.button === 0) onDown(e);
      });
      el.addEventListener('mouseup', onUp);
      el.addEventListener('mouseleave', () => setKeys(false));
    }
  }

  async function submitCampaignRunIfNeeded() {
    if (!window.SkyHopSubmitRun) return;
    const ext = window.SKYHOP_EXTERNAL_LEVEL;
    pbMaybeSendCheckpoint();
    if (typeof window.SkyHopCampaignAttestFlush === 'function') {
      try {
        await window.SkyHopCampaignAttestFlush();
      } catch {
        /* */
      }
    }
    const sessionId =
      typeof window.SkyHopCampaignAttestGetSessionId === 'function'
        ? window.SkyHopCampaignAttestGetSessionId()
        : null;
    const meta =
      !ext && !inRace
        ? {
            completedFullRun: true,
            stageCoinsCollected: campaignCoinsThisRun,
            campaignRunSessionId: sessionId || undefined,
          }
        : undefined;
    void window.SkyHopSubmitRun(getRunElapsedMs(), deaths, 'campaign', meta);
  }

  function initTouchControls() {
    bindTouchControl('touchLeft', ['ArrowLeft']);
    bindTouchControl('touchRight', ['ArrowRight']);
    bindTouchControl('touchJump', [' ', 'ArrowUp', 'Space', 'Spacebar']);
  }
  if (document.getElementById('touchLeft')) initTouchControls();
  else document.addEventListener('DOMContentLoaded', initTouchControls, { once: true });

  let lastJumpPress = -9999;
  let activeFireballs = [];
  let fireballNextWaveAt = 0;
  let projectileStageGateUntil = 0;
  /** @type {{ x: number, y: number, t0: number, kind: 'fire'|'boss' }[]} */
  let projectileBurstFx = [];
  const PROJ_MAX_AGE_MS = window.SKYHOP_PROJECTILE_MAX_LIFETIME_MS || 15000;
  const BOSS_BULLET_R = 8;

  let gravityDir = 1;
  let gravityArrowWasInside = [];
  let monsterStates = [];
  let bossState = null;
  let bossBullets = [];
  let grapple = { aimValid: false, hx: 0, hy: 0, _wasDown: false };
  let facing = 1;
  let bossPlayerHp = 0;
  let currentBossPlayerMax = 2;
  let hasWoodenSword = false;
  let hasShield = false;
  const WOODEN_SWORD_CD_MS = 10000;
  const SHIELD_ITEM_CD_MS = 15000;
  const SHIELD_INVULN_MS = 3000;
  const SWORD_SWING_ANIM_MS = 200;
  const SHIELD_RING_ANIM_MS = 450;
  let woodenSwordReadyAt = 0;
  let shieldItemReadyAt = 0;
  let shieldInvincibleUntil = 0;
  /** @type {{ t0: number, hit: boolean, crit: boolean, facing: number } | null} */
  let swordSwingAnim = null;
  /** @type {{ t0: number } | null} */
  let shieldRingAnim = null;
  /** @type {{ x: number, y: number, w: number, h: number, kind: string, collected: boolean, heal?: number }[]} */
  let itemPickups = [];
  const EPIC_LASER_W = 120;
  const STAGE_50_PROJ_DMG = 20;
  const STAGE_50_TOUCH_DMG = 10;
  const STAGE_50_LASER_DMG = 75;
  const EPIC_HEAL_POTION_INTERVAL_MS = 20000;
  const EPIC_HEAL_POTION_AMOUNT = 30;
  /**
   * Heal spawns in the air and falls. X must be left of the 800–1000 high “lid” (y ~300) or the
   * drop lands on that beam instead of the middle bridge (y 420). Bridge spans 700–1100.
   */
  const EPIC_HEAL_SPAWN_X = 748;
  const EPIC_HEAL_SPAWN_Y = 40;
  const EPIC_HEAL_POT_W = 32;
  const EPIC_HEAL_POT_H = 36;
  let epic50StageEnterAt = 0;
  let epicHealPotionNextAt = 0;

  const player = {
    x: 0,
    y: 0,
    w: 28,
    h: 40,
    vx: 0,
    vy: 0,
    onGround: false,
    coyoteUntil: 0,
    springGravityScale: null,
    wallJumpLockUntil: 0,
    airJumpsUsed: 0,
    hazardIFrameUntil: 0,
    grappleZipUntil: 0,
  };

  let skinImg = /** @type {HTMLImageElement|null} */ (null);
  let skinImgSrc = '';
  function syncSkinImg() {
    let tex = '';
    try {
      tex = (window.__skyhopLastMe && window.__skyhopLastMe.skinTexture) || '';
    } catch {
      tex = '';
    }
    const url = tex ? 'textures/' + encodeURIComponent(tex) : '';
    if (url === skinImgSrc) return;
    skinImgSrc = url;
    skinImg = null;
    if (!tex) return;
    const im = new Image();
    im.onload = () => {
      skinImg = im;
    };
    im.src = url;
  }
  try {
    window.addEventListener('skyhop-auth-changed', syncSkinImg);
  } catch {
    /* */
  }

  function syncSensUI() {
    const s = getSensitivity();
    if (sensSlider) sensSlider.value = String(s);
    if (sensValue) sensValue.textContent = s.toFixed(2) + '×';
  }
  syncSensUI();
  if (sensSlider) {
    sensSlider.addEventListener('input', () => {
      localStorage.setItem('SKYHOP_SENSITIVITY', sensSlider.value);
      syncSensUI();
    });
  }

  function syncProjOptsUI() {
    const p = window.SKYHOP_loadProjectileOpts();
    if (optProjDespawn) optProjDespawn.checked = !!p.despawn;
    if (optProjEnv) optProjEnv.checked = !!p.envCollide;
    if (optProjFrequent) optProjFrequent.checked = !!p.frequentProjectiles;
    if (optProjStageCd) optProjStageCd.checked = p.stageCooldownEnabled !== false;
    if (optProjFast) optProjFast.checked = !!p.fastProjectiles;
    updateProjDespawnEnvHint();
  }

  function persistProjOpts() {
    window.SKYHOP_saveProjectileOpts({
      despawn: !!(optProjDespawn && optProjDespawn.checked),
      envCollide: !!(optProjEnv && optProjEnv.checked),
      frequentProjectiles: !!(optProjFrequent && optProjFrequent.checked),
      stageCooldownEnabled: !!(optProjStageCd && optProjStageCd.checked),
      fastProjectiles: !!(optProjFast && optProjFast.checked),
    });
    runtimeOpts = window.SKYHOP_enrichRuntimeWithProjectileOpts(runtimeOpts);
  }

  function updateProjDespawnEnvHint() {
    if (!optProjDespawnEnvHint) return;
    const on = !!(optProjEnv && optProjEnv.checked);
    optProjDespawnEnvHint.classList.toggle('hidden', !on);
  }

  syncProjOptsUI();
  if (optProjDespawn) optProjDespawn.addEventListener('change', persistProjOpts);
  if (optProjEnv) {
    optProjEnv.addEventListener('change', () => {
      persistProjOpts();
      updateProjDespawnEnvHint();
    });
  }
  if (optProjFrequent) optProjFrequent.addEventListener('change', persistProjOpts);
  if (optProjStageCd) optProjStageCd.addEventListener('change', persistProjOpts);
  if (optProjFast) optProjFast.addEventListener('change', persistProjOpts);

  function readCustomForm() {
    const d = window.SKYHOP_DEFAULT_CUSTOM;
    return {
      runMul: custEls.run ? parseFloat(custEls.run.value) : d.runMul,
      gravityMul: custEls.grav ? parseFloat(custEls.grav.value) : d.gravityMul,
      frictionMul: custEls.fric ? parseFloat(custEls.fric.value) : d.frictionMul,
      jumpMul: custEls.jump ? parseFloat(custEls.jump.value) : d.jumpMul,
      airControlMul: custEls.air ? parseFloat(custEls.air.value) : d.airControlMul,
      bossHitsPlayer: custEls.bossHits ? parseInt(custEls.bossHits.value, 10) : d.bossHitsPlayer,
      monsterSpeedMul: custEls.mon ? parseFloat(custEls.mon.value) : d.monsterSpeedMul,
      bossMoveSpeedMul: custEls.bossMv ? parseFloat(custEls.bossMv.value) : d.bossMoveSpeedMul,
      allowSkip: !!(custEls.skip && custEls.skip.checked),
      fireballsOff: !!(custEls.noFire && custEls.noFire.checked),
      bossHp: custEls.bossHp ? parseInt(custEls.bossHp.value, 10) : d.bossHp,
      projectileSpeedMul: custEls.fireSpd ? parseFloat(custEls.fireSpd.value) : d.projectileSpeedMul,
      projectileStageCooldownSec: custEls.stageCd ? parseFloat(custEls.stageCd.value) : d.projectileStageCooldownSec,
      projectileLoopCooldownSec: custEls.loopCd ? parseFloat(custEls.loopCd.value) : d.projectileLoopCooldownSec,
      fireballChasing: !!(custEls.fbChase && custEls.fbChase.checked),
      monsterChasing: !!(custEls.monChase && custEls.monChase.checked),
      bossAttacks: !!(custEls.bossAtk && custEls.bossAtk.checked),
      projectileFreqMul: custEls.projFreq ? parseFloat(custEls.projFreq.value) : d.projectileFreqMul,
      epicHealDrops: !custEls.potionDrops || custEls.potionDrops.checked,
    };
  }

  function applyCustomFormFromStore() {
    const c = window.SKYHOP_loadCustomOptions();
    if (custEls.run) custEls.run.value = String(c.runMul);
    if (custEls.grav) custEls.grav.value = String(c.gravityMul);
    if (custEls.fric) custEls.fric.value = String(c.frictionMul);
    if (custEls.jump) custEls.jump.value = String(c.jumpMul);
    if (custEls.air) custEls.air.value = String(c.airControlMul);
    if (custEls.bossHits) custEls.bossHits.value = String(c.bossHitsPlayer);
    if (custEls.mon) custEls.mon.value = String(c.monsterSpeedMul);
    if (custEls.bossMv) custEls.bossMv.value = String(c.bossMoveSpeedMul);
    if (custEls.bossHp) custEls.bossHp.value = String(c.bossHp);
    if (custEls.skip) custEls.skip.checked = !!c.allowSkip;
    if (custEls.noFire) custEls.noFire.checked = !!c.fireballsOff;
    if (custEls.fireSpd) custEls.fireSpd.value = String(c.projectileSpeedMul ?? c.fireballSpeedMul ?? 1);
    if (custEls.projFreq) custEls.projFreq.value = String(c.projectileFreqMul ?? 1);
    if (custEls.stageCd) custEls.stageCd.value = String(c.projectileStageCooldownSec ?? 2);
    if (custEls.loopCd) custEls.loopCd.value = String(c.projectileLoopCooldownSec ?? 2.2);
    if (custEls.fbChase) custEls.fbChase.checked = !!c.fireballChasing;
    if (custEls.monChase) custEls.monChase.checked = c.monsterChasing !== false;
    if (custEls.bossAtk) custEls.bossAtk.checked = c.bossAttacks !== false;
    if (custEls.potionDrops) custEls.potionDrops.checked = c.epicHealDrops !== false;
    syncCustomValueLabels();
  }

  function syncCustomValueLabels() {
    if (custValEls.run && custEls.run) custValEls.run.textContent = parseFloat(custEls.run.value).toFixed(2) + '×';
    if (custValEls.grav && custEls.grav) custValEls.grav.textContent = parseFloat(custEls.grav.value).toFixed(2) + '×';
    if (custValEls.fric && custEls.fric) custValEls.fric.textContent = parseFloat(custEls.fric.value).toFixed(2) + '×';
    if (custValEls.jump && custEls.jump) custValEls.jump.textContent = parseFloat(custEls.jump.value).toFixed(2) + '×';
    if (custValEls.air && custEls.air) custValEls.air.textContent = parseFloat(custEls.air.value).toFixed(2) + '×';
    if (custValEls.bossHits && custEls.bossHits) custValEls.bossHits.textContent = custEls.bossHits.value;
    if (custValEls.mon && custEls.mon) custValEls.mon.textContent = parseFloat(custEls.mon.value).toFixed(2) + '×';
    if (custValEls.bossMv && custEls.bossMv) custValEls.bossMv.textContent = parseFloat(custEls.bossMv.value).toFixed(2) + '×';
    if (custValEls.bossHp && custEls.bossHp) custValEls.bossHp.textContent = custEls.bossHp.value;
    if (custValEls.fireSpd && custEls.fireSpd)
      custValEls.fireSpd.textContent = parseFloat(custEls.fireSpd.value).toFixed(2) + '×';
    if (custValEls.projFreq && custEls.projFreq)
      custValEls.projFreq.textContent = parseFloat(custEls.projFreq.value).toFixed(2) + '×';
    if (custValEls.stageCd && custEls.stageCd)
      custValEls.stageCd.textContent = parseFloat(custEls.stageCd.value).toFixed(1) + 's';
    if (custValEls.loopCd && custEls.loopCd)
      custValEls.loopCd.textContent = parseFloat(custEls.loopCd.value).toFixed(2) + 's';
  }

  function syncDifficultyMenuUI() {
    const row = 'diff-btn rounded-xl px-3 py-2.5 text-sm font-semibold ';
    const idle = row + 'border border-white/15 bg-slate-800/80 text-slate-200 hover:bg-slate-700';
    const act =
      row + 'border-2 border-indigo-400 bg-indigo-600/40 text-white shadow-inner ring-2 ring-indigo-400/50';
    if (diffEasy) diffEasy.className = menuDifficulty === 'easy' ? act : idle;
    if (diffNormal) diffNormal.className = menuDifficulty === 'normal' ? act : idle;
    if (diffHard) diffHard.className = menuDifficulty === 'hard' ? act : idle;
    if (diffCustom) diffCustom.className = (menuDifficulty === 'custom' ? act : idle) + ' mt-2 w-full';
    if (customPanel) {
      if (menuDifficulty === 'custom') customPanel.classList.remove('hidden');
      else customPanel.classList.add('hidden');
    }
    if (optProjFrequent) optProjFrequent.disabled = menuDifficulty === 'custom';
    if (optProjFrequentHint) {
      optProjFrequentHint.textContent =
        menuDifficulty === 'custom'
          ? 'Use the Custom panel “Projectile frequency” slider.'
          : '2× waves & boss shots on Easy, Normal, and Hard.';
    }
    if (optProjStageCd) optProjStageCd.disabled = menuDifficulty === 'custom';
    if (optProjStageCdHint) {
      optProjStageCdHint.textContent =
        menuDifficulty === 'custom'
          ? 'Use the Custom panel “Projectile–stage cooldown” slider.'
          : 'short delay after entering a stage before hazards fire (Easy / Normal / Hard).';
    }
    if (optProjFast) optProjFast.disabled = menuDifficulty === 'custom';
    if (optProjFastHint) {
      optProjFastHint.textContent =
        menuDifficulty === 'custom'
          ? 'Use the Custom panel “Projectile speed” slider.'
          : '1.5× speed on Easy, Normal, and Hard.';
    }
  }

  function bindCustomInputs() {
    for (const k of Object.keys(custEls)) {
      const el = custEls[k];
      if (!el) continue;
      const ev = el.type === 'checkbox' ? 'change' : 'input';
      el.addEventListener(ev, () => {
        syncCustomValueLabels();
        if (menuDifficulty === 'custom') window.SKYHOP_saveCustomOptions(readCustomForm());
      });
    }
  }
  bindCustomInputs();
  applyCustomFormFromStore();
  syncDifficultyMenuUI();

  function setMenuDifficulty(d) {
    menuDifficulty = d;
    syncDifficultyMenuUI();
  }

  if (diffEasy) diffEasy.addEventListener('click', () => setMenuDifficulty('easy'));
  if (diffNormal) diffNormal.addEventListener('click', () => setMenuDifficulty('normal'));
  if (diffHard) diffHard.addEventListener('click', () => setMenuDifficulty('hard'));
  if (diffCustom)
    diffCustom.addEventListener('click', () => {
      setMenuDifficulty('custom');
      applyCustomFormFromStore();
    });

  function refreshRuntimeOptsFromMenu() {
    const snap = menuDifficulty === 'custom' ? readCustomForm() : null;
    if (menuDifficulty === 'custom') window.SKYHOP_saveCustomOptions(snap);
    runtimeOpts = window.SKYHOP_enrichRuntimeWithProjectileOpts(
      window.SKYHOP_buildRuntimeOptions(menuDifficulty, snap || undefined)
    );
  }

  function updateSkipHud() {
    if (!btnSkipStage) return;
    const show =
      (gameState === 'playing' || gameState === 'paused') &&
      runtimeOpts.allowSkip &&
      !inRace &&
      !window.SKYHOP_EXTERNAL_LEVEL;
    btnSkipStage.classList.toggle('hidden', !show);
  }

  function setTouchHudVisible(show) {
    const el = document.getElementById('touchControls');
    if (!el) return;
    let allow = false;
    try {
      if (window.matchMedia('(pointer: coarse)').matches) allow = true;
      else if (window.matchMedia('(max-width: 1023px)').matches) allow = true;
    } catch {
      allow = true;
    }
    el.classList.toggle('hidden', !show || !allow);
  }

  function syncLevelsTopNav() {
    const nav = document.getElementById('levelsTopNav');
    if (!nav) return;
    const hide =
      gameState === 'playing' ||
      gameState === 'paused' ||
      gameState === 'weapon_modal' ||
      inRace;
    nav.classList.toggle('hidden', hide);
  }

  /** Higher = more frequent (shorter delays). */
  function projectileFreqScale() {
    const f = runtimeOpts.projectileFreqMul;
    return Math.max(0.12, f != null && Number.isFinite(f) ? f : 1);
  }

  function projectileSpeedScale() {
    const s = runtimeOpts.projectileSpeedMul;
    return Math.max(0.1, s != null && Number.isFinite(s) ? s : 1);
  }

  function getFireballWaveDelayMs() {
    const fq = projectileFreqScale();
    if (runtimeOpts.difficulty === 'custom') {
      const sec = Math.max(0.1, runtimeOpts.projectileLoopCooldownSec || 2.2);
      return (sec * 1000 * (0.88 + Math.random() * 0.24)) / fq;
    }
    return (1600 + Math.random() * 4200) / fq;
  }

  function getBossShootPeriodSec() {
    const fq = projectileFreqScale();
    if (runtimeOpts.difficulty === 'custom') {
      return Math.max(0.05, (runtimeOpts.projectileLoopCooldownSec || 2.2) / fq);
    }
    return 2.2 / fq;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spikeLethalRect(sp) {
    const x = sp.x + C.SPIKE_HIT_INSET_X;
    const y = sp.y + C.SPIKE_HIT_INSET_TOP;
    const w = Math.max(C.SPIKE_HIT_MIN_W, sp.w - 2 * C.SPIKE_HIT_INSET_X);
    const h = Math.max(C.SPIKE_HIT_MIN_H, sp.h - C.SPIKE_HIT_INSET_TOP - C.SPIKE_HIT_INSET_BOTTOM);
    return { x, y, w, h };
  }

  function resolveSpikeRect(sp, tSec) {
    return PHY.resolveMovingRect(sp, tSec);
  }

  function spikeHit(stage, tSec) {
    if (performance.now() < player.hazardIFrameUntil) return false;
    const body = { x: player.x, y: player.y, w: player.w, h: player.h };
    for (const sp of stage.spikes || []) {
      if (PHY.rectsOverlap(body, spikeLethalRect(sp))) return true;
    }
    const ms = stage.movingSpikes;
    if (ms) {
      for (const sp of ms) {
        const r = resolveSpikeRect(sp, tSec);
        const adj = {
          x: r.x + C.SPIKE_HIT_INSET_X,
          y: r.y + C.SPIKE_HIT_INSET_TOP,
          w: Math.max(C.SPIKE_HIT_MIN_W, r.w - 2 * C.SPIKE_HIT_INSET_X),
          h: Math.max(C.SPIKE_HIT_MIN_H, r.h - C.SPIKE_HIT_INSET_TOP - C.SPIKE_HIT_INSET_BOTTOM),
        };
        if (PHY.rectsOverlap(body, adj)) return true;
      }
    }
    return false;
  }

  function laserHit(stage) {
    const lasers = stage.lasers;
    if (!lasers || !lasers.length) return false;
    const body = { x: player.x, y: player.y, w: player.w, h: player.h };
    for (const L of lasers) {
      if (PHY.rectsOverlap(body, L)) return true;
    }
    return false;
  }

  function lavaHit(stage) {
    const lava = stage.lava;
    if (!lava || !lava.length) return false;
    const body = { x: player.x, y: player.y, w: player.w, h: player.h };
    for (const Lv of lava) {
      if (PHY.rectsOverlap(body, Lv)) return true;
    }
    return false;
  }

  function emitFireballsUnpredictable(stage) {
    if (!runtimeOpts.fireballsEnabled) return;
    const emitters = stage.fireballEmitters;
    if (!emitters || !emitters.length) return;
    const w = stage.worldW;
    const h = stage.worldH;
    const R = C.FIREBALL_RADIUS;
    for (const e of emitters) {
      if (Math.random() < 0.28) continue;
      const speed =
        e.speed * (0.68 + Math.random() * 0.58) * projectileSpeedScale();
      const jitter = e.jitter != null ? e.jitter : 44;
      let pos = e.pos + (Math.random() - 0.5) * jitter;
      let x;
      let y;
      let vx;
      let vy;
      switch (e.from) {
        case 'left':
          x = -R * 4;
          pos = Math.max(80, Math.min(h - 80, pos));
          y = pos;
          vx = speed;
          vy = 0;
          break;
        case 'right':
          x = w + R * 4;
          pos = Math.max(80, Math.min(h - 80, pos));
          y = pos;
          vx = -speed;
          vy = 0;
          break;
        case 'top':
          y = -R * 4;
          pos = Math.max(80, Math.min(w - 80, pos));
          x = pos;
          vx = 0;
          vy = speed;
          break;
        case 'bottom':
          y = h + R * 4;
          pos = Math.max(80, Math.min(w - 80, pos));
          x = pos;
          vx = 0;
          vy = -speed;
          break;
        default:
          continue;
      }
      activeFireballs.push({ x, y, vx, vy, spawnAt: performance.now() });
    }
  }

  function circleHitsSolids(cx, cy, r, rects) {
    for (const s of rects) {
      if (PHY.circleRectOverlap(cx, cy, r, s.x, s.y, s.w, s.h)) return true;
    }
    return false;
  }

  function addProjectileBurst(x, y, kind) {
    projectileBurstFx.push({ x, y, t0: performance.now(), kind });
  }

  function updateFireballs(stage, dt, solidRects) {
    if (!runtimeOpts.fireballsEnabled) {
      activeFireballs = [];
      fireballNextWaveAt = 0;
      return false;
    }
    const emitters = stage.fireballEmitters;
    const nowMs = performance.now();
    if (emitters && emitters.length) {
      if (nowMs >= fireballNextWaveAt && nowMs >= projectileStageGateUntil) {
        emitFireballsUnpredictable(stage);
        fireballNextWaveAt = nowMs + getFireballWaveDelayMs();
      }
    } else {
      activeFireballs = [];
      fireballNextWaveAt = 0;
    }
    const w = stage.worldW;
    const h = stage.worldH;
    const margin = 80;
    for (let i = activeFireballs.length - 1; i >= 0; i--) {
      const b = activeFireballs[i];
      if (b.spawnAt == null) b.spawnAt = nowMs;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (runtimeOpts.fireballsHoming) {
        const px = player.x + player.w / 2 - b.x;
        const py = player.y + player.h / 2 - b.y;
        const len = Math.hypot(px, py) || 1;
        const pull = 520;
        b.vx += (px / len) * pull * dt;
        b.vy += (py / len) * pull * dt;
        const vm = Math.hypot(b.vx, b.vy);
        const cap = 400;
        if (vm > cap) {
          b.vx = (b.vx / vm) * cap;
          b.vy = (b.vy / vm) * cap;
        }
      }
      if (PHY.circleRectOverlap(b.x, b.y, C.FIREBALL_RADIUS, player.x, player.y, player.w, player.h)) {
        die();
        return true;
      }
      if (
        runtimeOpts.projectileEnvCollide &&
        circleHitsSolids(b.x, b.y, C.FIREBALL_RADIUS, solidRects)
      ) {
        addProjectileBurst(b.x, b.y, 'fire');
        activeFireballs.splice(i, 1);
        continue;
      }
      if (b.x < -margin || b.x > w + margin || b.y < -margin || b.y > h + margin) {
        activeFireballs.splice(i, 1);
        continue;
      }
      if (runtimeOpts.projectileDespawn15s && nowMs - b.spawnAt >= PROJ_MAX_AGE_MS) {
        activeFireballs.splice(i, 1);
        continue;
      }
    }
    return false;
  }

  function rayGrappleHit(ox, oy, rdx, rdy, maxDist, rects) {
    const step = 6;
    let d = 0;
    while (d < maxDist) {
      const x = ox + rdx * d;
      const y = oy + rdy * d;
      const probe = { x: x - 3, y: y - 3, w: 6, h: 6 };
      for (const r of rects) {
        if (PHY.rectsOverlap(probe, r)) return { x, y, dist: d };
      }
      d += step;
    }
    return null;
  }

  function syncBossHpHud() {
    if (!hudBossHpWrap || !hudBossHpFill) return;
    const max = Math.max(1, currentBossPlayerMax);
    const pct = max > 0 ? Math.max(0, Math.min(100, (bossPlayerHp / max) * 100)) : 0;
    hudBossHpFill.style.width = pct + '%';
    if (hudBossHpNums) hudBossHpNums.textContent = `${Math.max(0, bossPlayerHp)}/${max}`;
  }

  function syncEpicBossHud() {
    if (!hudEpicBossWrap || !hudEpicBossFill) return;
    if (!bossState || !bossState.epic) {
      hudEpicBossWrap.classList.add('hidden');
      return;
    }
    const max = 100;
    const hp = Math.max(0, bossState.hp);
    const pct = (hp / max) * 100;
    hudEpicBossFill.style.width = pct + '%';
    if (hudEpicBossNums) hudEpicBossNums.textContent = `${hp}/${max}`;
    hudEpicBossWrap.classList.remove('hidden');
  }

  function syncWeaponHud(now) {
    const t = now != null ? now : performance.now();
    if (!hudWeaponsWrap) return;
    const st = stagesNow()[stageIndex];
    if (!st || !st.epicBoss) {
      hudWeaponsWrap.classList.add('hidden');
      if (hudSwordBlock) hudSwordBlock.classList.add('hidden');
      if (hudShieldBlock) hudShieldBlock.classList.add('hidden');
      if (hudShieldActive) hudShieldActive.classList.add('hidden');
      if (hudHealDropBlock) hudHealDropBlock.classList.add('hidden');
      return;
    }
    hudWeaponsWrap.classList.remove('hidden');
    // 20s bridge heal: bar fills as the next drop approaches (same “charging” read as sword CD).
    if (hudHealDropBlock) {
      if (!runtimeOpts.epicHealPotionDrops) {
        hudHealDropBlock.classList.add('hidden');
      } else {
        hudHealDropBlock.classList.remove('hidden');
        const intv = EPIC_HEAL_POTION_INTERVAL_MS;
        if (hudHealDropTime && hudHealDropFill) {
          if (epicHealPotionNextAt > 0) {
            const rem = Math.max(0, epicHealPotionNextAt - t);
            hudHealDropTime.textContent = rem < 0.15 ? 'Now' : `${(rem / 1000).toFixed(1)}s`;
            const pct = rem < 0.05
              ? 100
              : Math.max(0, Math.min(100, 100 * (1 - rem / intv)));
            hudHealDropFill.style.width = pct + '%';
          } else {
            hudHealDropTime.textContent = '—';
            hudHealDropFill.style.width = '0%';
          }
        }
      }
    }
    if (hudSwordBlock) {
      hudSwordBlock.classList.remove('hidden');
      hudSwordBlock.classList.toggle('opacity-50', !hasWoodenSword);
      if (hasWoodenSword) {
        const rem = woodenSwordReadyAt - t;
        const ready = rem <= 0;
        if (hudSwordTime) hudSwordTime.textContent = ready ? 'Ready' : `${(rem / 1000).toFixed(1)}s`;
        if (hudSwordFill) {
          const pct = ready ? 100 : Math.max(0, Math.min(100, 100 * (1 - rem / WOODEN_SWORD_CD_MS)));
          hudSwordFill.style.width = pct + '%';
        }
      } else {
        if (hudSwordTime) hudSwordTime.textContent = '—';
        if (hudSwordFill) hudSwordFill.style.width = '0%';
      }
    }
    if (hudShieldBlock) {
      hudShieldBlock.classList.remove('hidden');
      hudShieldBlock.classList.toggle('opacity-50', !hasShield);
      if (hasShield) {
        const invRem = shieldInvincibleUntil - t;
        if (invRem > 0) {
          if (hudShieldTime) hudShieldTime.textContent = `Active ${(invRem / 1000).toFixed(1)}s`;
          if (hudShieldFill) {
            const invPct = 100 * (invRem / SHIELD_INVULN_MS);
            hudShieldFill.style.width = invPct + '%';
          }
          if (hudShieldActive) hudShieldActive.classList.remove('hidden');
        } else {
          if (hudShieldActive) hudShieldActive.classList.add('hidden');
          const cdRem = shieldItemReadyAt - t;
          const ready = cdRem <= 0;
          if (hudShieldTime) hudShieldTime.textContent = ready ? 'Ready' : `${(cdRem / 1000).toFixed(1)}s`;
          if (hudShieldFill) {
            const pct = ready
              ? 100
              : Math.max(0, Math.min(100, 100 * (1 - cdRem / SHIELD_ITEM_CD_MS)));
            hudShieldFill.style.width = pct + '%';
          }
        }
      } else {
        if (hudShieldTime) hudShieldTime.textContent = '—';
        if (hudShieldFill) hudShieldFill.style.width = '0%';
        if (hudShieldActive) hudShieldActive.classList.add('hidden');
      }
    }
  }

  /** @returns {boolean} true if the player died (stage reset). */
  function tryBossPlayerDamage(amt) {
    const a = amt == null || amt === undefined ? 1 : Math.max(0, Math.floor(amt));
    if (a <= 0) return false;
    const now = performance.now();
    if (now < player.hazardIFrameUntil) return false;
    if (now < shieldInvincibleUntil) return false;
    bossPlayerHp -= a;
    if (bossPlayerHp <= 0) {
      die();
      return true;
    }
    player.hazardIFrameUntil = now + C.BOSS_PLAYER_HIT_IFRAME_MS;
    syncBossHpHud();
    return false;
  }

  function showWeaponScreen(kind) {
    if (!screenWeapon || !weaponModalTitle || !weaponModalBody) return;
    if (kind === 'sword') {
      weaponModalTitle.textContent = 'Wooden sword';
      weaponModalBody.innerHTML = `
        <p>Damage: <strong>10 HP</strong>, 10% critical hit of <strong>20 HP</strong></p>
        <p>Press <kbd class="rounded bg-slate-800 px-1.5 font-mono text-amber-200">S</kbd> to use.</p>
        <p>10 second cooldown.</p>
      `;
    } else if (kind === 'shield') {
      weaponModalTitle.textContent = 'Shield';
      weaponModalBody.innerHTML = `
        <p>Provides <strong>3 seconds</strong> of invincibility to the player.</p>
        <p>Press <kbd class="rounded bg-slate-800 px-1.5 font-mono text-amber-200">B</kbd> to use.</p>
        <p>15 second cooldown.</p>
      `;
    }
    gameState = 'weapon_modal';
    screenWeapon.classList.remove('hidden');
    screenWeapon.classList.add('flex');
    syncLevelsTopNav();
    setTouchHudVisible(false);
  }

  function closeWeaponScreen() {
    if (!screenWeapon) return;
    screenWeapon.classList.add('hidden');
    screenWeapon.classList.remove('flex');
    if (gameState === 'weapon_modal') gameState = 'playing';
    saveRunProgress();
    syncLevelsTopNav();
    setTouchHudVisible(gameState === 'playing');
  }

  function tryUseWoodenSword() {
    const st = stagesNow()[stageIndex];
    if (!hasWoodenSword || !st.bossStage || !bossState || !bossState.epic) return;
    const now = performance.now();
    if (now < woodenSwordReadyAt) return;
    const hitW = 95;
    const hitH = 50;
    const hx = facing > 0 ? player.x + player.w : player.x - hitW;
    const hy = player.y;
    const hitbox = { x: hx, y: hy, w: hitW, h: hitH };
    const b = bossState;
    const br = { x: b.x, y: b.y, w: b.w, h: b.h };
    let hit = PHY.rectsOverlap(hitbox, br);
    if (!hit) {
      const feet = player.y + player.h;
      const hOverlap = player.x + player.w > b.x && player.x < b.x + b.w;
      if (
        hOverlap &&
        player.y < b.y + 8 &&
        feet >= b.y - 2 &&
        feet <= b.y + 16
      ) {
        hit = true;
      }
    }
    let crit = false;
    if (hit) {
      crit = Math.random() < 0.1;
      const dmg = crit ? 20 : 10;
      bossState.hp -= dmg;
      syncEpicBossHud();
    }
    woodenSwordReadyAt = now + WOODEN_SWORD_CD_MS;
    player.hazardIFrameUntil = now + 80;
    swordSwingAnim = { t0: now, hit, crit, facing };
    syncWeaponHud(now);
  }

  function tryUseShield() {
    if (!hasShield) return;
    const now = performance.now();
    if (now < shieldItemReadyAt) return;
    shieldItemReadyAt = now + SHIELD_ITEM_CD_MS;
    shieldInvincibleUntil = now + SHIELD_INVULN_MS;
    player.hazardIFrameUntil = Math.max(player.hazardIFrameUntil, shieldInvincibleUntil);
    shieldRingAnim = { t0: now };
    syncWeaponHud(now);
  }

  function loadStage(i) {
    const s = stagesNow()[i];
    player.x = s.spawn.x;
    player.y = s.spawn.y - player.h;
    player.vx = 0;
    player.vy = 0;
    player.onGround = false;
    player.coyoteUntil = 0;
    player.springGravityScale = null;
    player.wallJumpLockUntil = 0;
    player.airJumpsUsed = 0;
    player.hazardIFrameUntil = 0;
    player.grappleZipUntil = 0;
    gravityDir = 1;
    gravityArrowWasInside = (s.gravityArrows || []).map(() => false);
    monsterStates = (s.monsters || []).map((m) => ({ ...m, vy: m.vy ?? 0 }));
    bossState = s.boss ? { ...s.boss } : null;
    if (bossState) {
      bossState.vx = (s.boss.vx || 0) * runtimeOpts.bossMoveSpeedMul;
      bossState.shootAcc = 0;
      if (bossState.epic) {
        epic50StageEnterAt = performance.now();
        bossState.baseY = bossState.baseY != null ? bossState.baseY : bossState.y;
        bossState.laserPhase = 0;
        bossState.laserX = 400;
        bossState.laserCdEnd = 0;
        bossState.laserNextTryAt = epic50StageEnterAt + 15000;
        bossState.laserErrT = 0;
        bossState.laserFired = false;
        bossState.wanderT = 0;
        bossState.wanderNextIn = 0.35;
        epicHealPotionNextAt = runtimeOpts.epicHealPotionDrops
          ? performance.now() + EPIC_HEAL_POTION_INTERVAL_MS
          : 0;
      } else {
        if (runtimeOpts.bossHpOverride != null) bossState.hp = runtimeOpts.bossHpOverride;
      }
    }
    itemPickups = (s.itemPickups || []).map((p) => ({ ...p, collected: false }));
    if (!s.epicBoss) {
      epicHealPotionNextAt = 0;
    } else if (!runtimeOpts.epicHealPotionDrops) {
      epicHealPotionNextAt = 0;
      itemPickups = itemPickups.filter((p) => p.kind !== 'healPotion');
    }
    if (s.itemPickups && s.itemPickups.length) {
      hasWoodenSword = false;
      hasShield = false;
      woodenSwordReadyAt = 0;
      shieldItemReadyAt = 0;
      shieldInvincibleUntil = 0;
    }
    bossBullets = [];
    swordSwingAnim = null;
    shieldRingAnim = null;
    grapple = { aimValid: false, hx: 0, hy: 0, _wasDown: false };
    facing = 1;
    activeFireballs = [];
    projectileBurstFx = [];
    const nowGate = performance.now();
    const fq0 = projectileFreqScale();
    if (runtimeOpts.difficulty === 'custom') {
      projectileStageGateUntil = nowGate + (runtimeOpts.projectileStageCooldownSec || 0) * 1000;
    } else {
      projectileStageGateUntil =
        runtimeOpts.projectileStageCooldownEnabled !== false
          ? nowGate + (700 + Math.random() * 2000) / fq0
          : nowGate;
    }
    fireballNextWaveAt = projectileStageGateUntil;
    cameraX = 0;
    cameraY = 0;
    stageStartedAt = performance.now();
    const ext = window.SKYHOP_EXTERNAL_LEVEL;
    if (ext && ext.hudTitle) {
      hudStage.textContent = ext.hudTitle;
    } else {
      hudStage.textContent = `${i + 1} / ${stagesNow().length}`;
    }
    hudDeaths.textContent = String(deaths);
    if (s.bossStage) {
      currentBossPlayerMax = s.bossPlayerMax != null ? s.bossPlayerMax : runtimeOpts.bossPlayerMaxHp;
      bossPlayerHp = s.bossPlayerHp != null ? s.bossPlayerHp : currentBossPlayerMax;
      if (hudBossHpWrap) hudBossHpWrap.classList.remove('hidden');
      syncBossHpHud();
    } else {
      bossPlayerHp = 0;
      currentBossPlayerMax = 2;
      if (hudBossHpWrap) hudBossHpWrap.classList.add('hidden');
    }
    if (hudEpicBossWrap) {
      if (s.epicBoss && bossState) {
        syncEpicBossHud();
      } else {
        hudEpicBossWrap.classList.add('hidden');
      }
    }
    if (pbAntiFarm) {
      pbAntiFarm.lastPx = player.x;
      pbAntiFarm.lastPy = player.y;
    }
    initStageCoins(s);
    syncHudHint(i);
    syncWeaponHud(performance.now());
    saveRunProgress();
    updateSkipHud();
    {
      const showTouch = gameState === 'playing';
      setTouchHudVisible(!!showTouch);
    }
    syncLevelsTopNav();
  }

  function beginRacing(opts) {
    if (opts && opts.type === 'mp') {
      if (opts.difficulty === 'custom' && opts.customOpts && typeof opts.customOpts === 'object') {
        menuDifficulty = 'custom';
        runtimeOpts = window.SKYHOP_enrichRuntimeWithProjectileOpts(
          window.SKYHOP_buildRuntimeOptions('custom', opts.customOpts)
        );
      } else if (opts.difficulty === 'easy' || opts.difficulty === 'normal' || opts.difficulty === 'hard') {
        menuDifficulty = opts.difficulty;
        refreshRuntimeOptsFromMenu();
      } else {
        refreshRuntimeOptsFromMenu();
      }
      syncDifficultyMenuUI();
    } else {
      refreshRuntimeOptsFromMenu();
    }
    inRace = true;
    hasWoodenSword = false;
    hasShield = false;
    woodenSwordReadyAt = 0;
    shieldItemReadyAt = 0;
    shieldInvincibleUntil = 0;
    swordSwingAnim = null;
    shieldRingAnim = null;
    closeWeaponScreen();
    gameState = 'playing';
    stageIndex = 0;
    deaths = 0;
    resetRunClock();
    if (screenMenu) {
      screenMenu.classList.add('hidden');
      screenMenu.classList.remove('flex');
    }
    if (screenRaceMenu) {
      screenRaceMenu.classList.add('hidden');
      screenRaceMenu.classList.remove('flex');
    }
    screenStageClear.classList.add('hidden');
    screenStageClear.classList.remove('flex');
    screenWin.classList.add('hidden');
    screenWin.classList.remove('flex');
    if (hud) hud.classList.remove('hidden');
    loadStage(0);
    syncWeaponHud(performance.now());
    updateSkipHud();
  }

  function die() {
    deaths++;
    hudDeaths.textContent = String(deaths);
    loadStage(stageIndex);
  }

  /** Horizontal clamp only — vertical void uses die() so inverted / pit falls respawn cleanly. */
  function clampPlayerToWorldBounds(stage) {
    const minX = 0;
    const maxX = Math.max(0, stage.worldW - player.w);

    if (player.x < minX) {
      player.x = minX;
      player.vx = Math.max(0, player.vx);
    } else if (player.x > maxX) {
      player.x = maxX;
      player.vx = Math.min(0, player.vx);
    }
  }

  function goalReached(stage) {
    if (stage.bossStage) return false;
    return PHY.rectsOverlap(
      { x: player.x, y: player.y, w: player.w, h: player.h },
      stage.goal
    );
  }

  /** @returns {boolean} true if weapon modal opened (end frame) */
  function tryCollectItemPickups() {
    if (!itemPickups.length) return false;
    const st = stagesNow()[stageIndex];
    const body = { x: player.x, y: player.y, w: player.w, h: player.h };
    for (const p of itemPickups) {
      if (p.collected) continue;
      if (PHY.rectsOverlap(body, p)) {
        p.collected = true;
        if (p.kind === 'healPotion') {
          if (st && st.epicBoss) {
            const add = p.heal != null ? p.heal : EPIC_HEAL_POTION_AMOUNT;
            bossPlayerHp = Math.min(currentBossPlayerMax, bossPlayerHp + add);
            syncBossHpHud();
          }
          return false;
        }
        if (p.kind === 'sword') {
          hasWoodenSword = true;
          showWeaponScreen('sword');
          saveRunProgress();
          return true;
        }
        if (p.kind === 'shield') {
          hasShield = true;
          showWeaponScreen('shield');
          saveRunProgress();
          return true;
        }
      }
    }
    return false;
  }

  function bossDefeated() {
    return bossState && bossState.hp <= 0;
  }

  function updateCamera(stage, dt) {
    const viewW = canvas.clientWidth;
    const viewH = canvas.clientHeight;
    const targetX = player.x + player.w / 2 - viewW * 0.35;
    const targetY = player.y + player.h / 2 - viewH * 0.45;
    const maxCamX = Math.max(0, stage.worldW - viewW);
    const maxCamY = Math.max(0, stage.worldH - viewH);
    const lerp = 1 - Math.pow(0.001, dt / (1 / 60));
    cameraX += (Math.max(0, Math.min(maxCamX, targetX)) - cameraX) * lerp;
    cameraY += (Math.max(0, Math.min(maxCamY, targetY)) - cameraY) * lerp;
  }

  function updateMonsters(dt, solidRects, stage) {
    const body = { x: player.x, y: player.y, w: player.w, h: player.h };
    const sens = getSensitivity();
    const chase =
      runtimeOpts.monsterChaseMatchRun ||
      (runtimeOpts.difficulty === 'custom' && runtimeOpts.monsterChasing);
    const chaseSpd = C.MAX_RUN * sens * (runtimeOpts.monsterChaseMatchRun ? 1 : runtimeOpts.monsterSpeedMul);
    const gravStep = C.GRAVITY * gravityDir * dt * runtimeOpts.gravityMul;
    for (const m of monsterStates) {
      if (m.y > stage.worldH + 200) continue;

      m.vy = (m.vy || 0) + gravStep;
      m.y += m.vy * dt;

      let hitMy = PHY.solidCollide(solidRects, m.x, m.y, m.w, m.h);
      let myi = 0;
      while (hitMy && myi < 24) {
        myi++;
        if (gravityDir > 0) {
          if (m.vy > 0) {
            m.y = hitMy.y - m.h - 0.01;
            m.vy = 0;
          } else if (m.vy < 0) {
            m.y = hitMy.y + hitMy.h + 0.01;
            m.vy = 0;
          } else {
            const penB = m.y + m.h - hitMy.y;
            const penA = hitMy.y + hitMy.h - m.y;
            if (penB <= 0 || penA <= 0) break;
            if (penB <= penA) {
              m.y = hitMy.y - m.h - 0.01;
              m.vy = 0;
            } else {
              m.y = hitMy.y + hitMy.h + 0.01;
              m.vy = 0;
            }
          }
        } else {
          if (m.vy < 0) {
            m.y = hitMy.y + hitMy.h + 0.01;
            m.vy = 0;
          } else if (m.vy > 0) {
            m.y = hitMy.y - m.h - 0.01;
            m.vy = 0;
          } else {
            const penB = m.y + m.h - hitMy.y;
            const penA = hitMy.y + hitMy.h - m.y;
            if (penB <= 0 || penA <= 0) break;
            if (penB <= penA) {
              m.y = hitMy.y - m.h - 0.01;
              m.vy = 0;
            } else {
              m.y = hitMy.y + hitMy.h + 0.01;
              m.vy = 0;
            }
          }
        }
        hitMy = PHY.solidCollide(solidRects, m.x, m.y, m.w, m.h);
      }

      if (chase && !runtimeOpts.monstersFriendly) {
        const px = player.x + player.w / 2;
        const mx = m.x + m.w / 2;
        m.vx = px > mx ? Math.abs(chaseSpd) : -Math.abs(chaseSpd);
        m.x += m.vx * dt;
        if (m.x < m.minX) m.x = m.minX;
        if (m.x + m.w > m.maxX) m.x = m.maxX - m.w;
      } else {
        m.x += m.vx * dt;
        if (m.x < m.minX) {
          m.x = m.minX;
          m.vx = Math.abs(m.vx);
        }
        if (m.x + m.w > m.maxX) {
          m.x = m.maxX - m.w;
          m.vx = -Math.abs(m.vx);
        }
      }

      let hitMx = PHY.solidCollide(solidRects, m.x, m.y, m.w, m.h);
      let mxi = 0;
      while (hitMx && mxi < 20) {
        mxi++;
        if (m.vx > 0) m.x = hitMx.x - m.w - 0.01;
        else if (m.vx < 0) m.x = hitMx.x + hitMx.w + 0.01;
        else {
          const penR = m.x + m.w - hitMx.x;
          const penL = hitMx.x + hitMx.w - m.x;
          if (penR <= 0 || penL <= 0) break;
          m.x = penR < penL ? hitMx.x - m.w - 0.01 : hitMx.x + hitMx.w + 0.01;
        }
        m.vx = 0;
        hitMx = PHY.solidCollide(solidRects, m.x, m.y, m.w, m.h);
      }

      if (m.y > stage.worldH + 30) {
        m.y = Math.min(m.y, stage.worldH - m.h);
        m.vy = 0;
      }

      const mon = { x: m.x, y: m.y, w: m.w, h: m.h };
      if (!PHY.rectsOverlap(body, mon)) continue;
      const stomp = player.vy * gravityDir > 0 && player.y + player.h < m.y + m.h * 0.55;
      if (stomp) {
        m.y += 4000;
        player.vy = -420 * gravityDir * runtimeOpts.jumpMul;
        player.hazardIFrameUntil = performance.now() + C.BOSS_STOMP_IFRAME_MS;
      } else if (!runtimeOpts.monstersFriendly && performance.now() >= player.hazardIFrameUntil) {
        die();
        return true;
      }
    }
    return false;
  }

  /** Epic boss: no gravity / no terrain — drifts on X with random walk, Y bobs on baseY only. */
  function stepEpicBossWander(b, stage, dt, now) {
    b.wanderT = (b.wanderT || 0) + dt;
    b.wanderNextIn = b.wanderNextIn ?? 0.35;
    if (b.wanderT >= b.wanderNextIn) {
      b.wanderT = 0;
      b.wanderNextIn = 0.22 + Math.random() * 0.45;
      b.vx = (Math.random() - 0.5) * 2 * (90 + Math.random() * 280);
      b.vx = Math.max(-380, Math.min(380, b.vx));
    }
    b.x += b.vx * dt;
    b.y = b.baseY + Math.sin(now * 0.0026) * 12;
    if (b.x <= b.minX) {
      b.x = b.minX;
      b.vx = Math.abs(b.vx) * 0.7 + 45 + Math.random() * 60;
    } else if (b.x + b.w >= b.maxX) {
      b.x = b.maxX - b.w;
      b.vx = -Math.abs(b.vx) * 0.7 - 45 - Math.random() * 60;
    }
  }

  function epicPlayerStompsEpicBoss(b) {
    if (!PHY.rectsOverlap(
      { x: player.x, y: player.y, w: player.w, h: player.h },
      { x: b.x, y: b.y, w: b.w, h: b.h }
    ))
      return false;
    return (
      player.vy * gravityDir > 0 &&
      player.y + player.h <= b.y + 20 &&
      player.y + player.h >= b.y - 3
    );
  }

  /** @returns {boolean} true if player died */
  function updateEpicLaser50(stage) {
    const b = bossState;
    if (!b || !b.epic) return false;
    const now = performance.now();
    const tEnter = epic50StageEnterAt;
    if (b.laserPhase === 1 && now >= b.laserWarnEnd) {
      b.laserPhase = 2;
      b.laserActiveEnd = now + 180;
      b.laserFired = false;
    }
    if (b.laserPhase === 2) {
      const bx1 = b.laserX;
      const bx2 = b.laserX + EPIC_LASER_W;
      const px1 = player.x;
      const px2 = player.x + player.w;
      const hit = Math.max(px1, px2) > bx1 + 2 && Math.min(px1, px2) < bx2 - 2;
      if (hit && !b.laserFired) {
        b.laserFired = true;
        if (tryBossPlayerDamage(STAGE_50_LASER_DMG)) return true;
      }
      if (now >= b.laserActiveEnd) {
        b.laserPhase = 0;
        b.laserFired = false;
        b.laserCdEnd = now + 15000;
        b.laserNextTryAt = b.laserCdEnd + 5000;
      }
      return false;
    }
    if (b.laserPhase !== 0) return false;
    if (now < tEnter + 15000) return false;
    if (now < b.laserCdEnd) return false;
    if (now < b.laserNextTryAt) return false;
    b.laserNextTryAt = now + 5000;
    if (Math.random() < 0.3) {
      b.laserX =
        b.minX + 40 + Math.random() * Math.max(10, b.maxX - b.minX - b.w - EPIC_LASER_W - 80);
      b.laserPhase = 1;
      b.laserWarnEnd = now + 3000;
    }
    return false;
  }

  function updateBossProjectilesAndDamage(stage, solidRects, dt) {
    const b = bossState;
    const nowMs = performance.now();
    const epic = b && b.epic;
    for (let i = bossBullets.length - 1; i >= 0; i--) {
      const bul = bossBullets[i];
      if (bul.spawnAt == null) bul.spawnAt = nowMs;
      bul.x += bul.vx * dt;
      bul.y += bul.vy * dt;
      if (runtimeOpts.bossBulletsHoming) {
        const px = player.x + player.w / 2 - bul.x;
        const py = player.y + player.h / 2 - bul.y;
        const len = Math.hypot(px, py) || 1;
        const pull = 480;
        bul.vx += (px / len) * pull * dt;
        bul.vy += (py / len) * pull * dt;
        const vm = Math.hypot(bul.vx, bul.vy);
        const cap = 340;
        if (vm > cap) {
          bul.vx = (bul.vx / vm) * cap;
          bul.vy = (bul.vy / vm) * cap;
        }
      }
      if (PHY.circleRectOverlap(bul.x, bul.y, BOSS_BULLET_R, player.x, player.y, player.w, player.h)) {
        bossBullets.splice(i, 1);
        const d = epic ? STAGE_50_PROJ_DMG : 1;
        if (tryBossPlayerDamage(d)) return true;
        continue;
      }
      if (
        runtimeOpts.projectileEnvCollide &&
        circleHitsSolids(bul.x, bul.y, BOSS_BULLET_R, solidRects)
      ) {
        addProjectileBurst(bul.x, bul.y, 'boss');
        bossBullets.splice(i, 1);
        continue;
      }
      if (
        bul.x < -50 ||
        bul.x > stage.worldW + 50 ||
        bul.y < -50 ||
        bul.y > stage.worldH + 50
      ) {
        bossBullets.splice(i, 1);
        continue;
      }
      if (runtimeOpts.projectileDespawn15s && nowMs - bul.spawnAt >= PROJ_MAX_AGE_MS) {
        bossBullets.splice(i, 1);
        continue;
      }
    }
    return false;
  }

  function updateBoss(stage, dt, tSec, solidRects) {
    if (!bossState) return false;
    const b = bossState;
    const nowT = performance.now();
    if (b.epic) {
      stepEpicBossWander(b, stage, dt, nowT);
    } else {
      b.x += b.vx * dt;
      if (b.x <= b.minX) {
        b.x = b.minX;
        b.vx = Math.abs(b.vx);
      }
      if (b.x + b.w >= b.maxX) {
        b.x = b.maxX - b.w;
        b.vx = -Math.abs(b.vx);
      }
    }
    const shootPeriod = getBossShootPeriodSec();
    const nowBoss = performance.now();
    if (nowBoss >= projectileStageGateUntil) {
      b.shootAcc = (b.shootAcc || 0) + dt;
      if (b.shootAcc >= shootPeriod) {
        b.shootAcc = 0;
        if (runtimeOpts.bossShoots) {
          const spd = 220 * projectileSpeedScale();
          const cx = b.x + b.w / 2;
          const cy = b.y + b.h / 2;
          const px = player.x + player.w / 2;
          const py = player.y + player.h / 2;
          let dx = px - cx;
          let dy = py - cy;
          const len = Math.hypot(dx, dy) || 1;
          dx /= len;
          dy /= len;
          bossBullets.push({
            x: cx,
            y: cy,
            vx: dx * spd,
            vy: dy * spd,
            spawnAt: performance.now(),
          });
        }
      }
    }
    const body = { x: player.x, y: player.y, w: player.w, h: player.h };
    const bossRect = { x: b.x, y: b.y, w: b.w, h: b.h };
    if (PHY.rectsOverlap(body, bossRect)) {
      const stomp = b.epic
        ? epicPlayerStompsEpicBoss(b)
        : player.vy * gravityDir > 0 && player.y + player.h <= b.y + 18;
      if (stomp && nowT >= (b.stompCd || 0)) {
        b.hp--;
        b.stompCd = performance.now() + 500;
        player.vy = -380 * gravityDir * runtimeOpts.jumpMul;
        player.hazardIFrameUntil = performance.now() + C.BOSS_STOMP_IFRAME_MS;
        syncEpicBossHud();
      } else if (performance.now() >= player.hazardIFrameUntil) {
        if (b.epic) {
          if (tryBossPlayerDamage(STAGE_50_TOUCH_DMG)) return true;
        } else {
          return tryBossPlayerDamage(1);
        }
      }
    }
    if (b.epic) {
      if (updateEpicLaser50(stage)) return true;
    }
    if (updateBossProjectilesAndDamage(stage, solidRects, dt)) return true;
    return false;
  }

  /** Planks the boss can use but only those — so the vial can land on the high bridge, not the main floor. */
  function buildEpicPotionDropLandRects(stage, tSec) {
    const out = [];
    for (const p of stage.platforms) {
      if (!p.bossPassThrough) continue;
      out.push(PHY.resolveMovingRect(p, tSec));
    }
    if (stage.movingPlatforms) {
      for (const p of stage.movingPlatforms) {
        if (!p.bossPassThrough) continue;
        out.push(PHY.resolveMovingRect(p, tSec));
      }
    }
    return out;
  }

  /** Heal vials: spawn high and fall until they rest on a pass-through (bridge / beams), not the ground floor. */
  function updateEpicHealDrops(dt, landRects, stage) {
    if (!runtimeOpts.epicHealPotionDrops) return;
    const O = runtimeOpts;
    const g = C.GRAVITY * gravityDir * dt * O.gravityMul;
    for (const p of itemPickups) {
      if (p.collected || p.kind !== 'healPotion' || p.potionLanded) continue;
      p.dropVy = (p.dropVy != null && p.dropVy !== undefined ? p.dropVy : 0) + g;
      p.y += p.dropVy * dt;
      for (let it = 0; it < 8; it++) {
        const hit = PHY.solidCollide(landRects, p.x, p.y, p.w, p.h);
        if (!hit) break;
        if (p.dropVy >= 0) {
          p.y = hit.y - p.h - 0.1;
          p.dropVy = 0;
          p.potionLanded = true;
        } else {
          p.y = hit.y + hit.h + 0.1;
          p.dropVy = 0;
        }
        break;
      }
      if (p.y > stage.worldH + 80) p.collected = true;
    }
  }

  function smoothMpRemotePeers(dt) {
    if (!inRace) return;
    const peers = window.__skyhopMpPeers;
    if (!peers || typeof peers !== 'object') return;
    const alpha = 1 - Math.exp(-Math.min(40, 14 * Math.max(0, dt || 0.001)));
    for (const k of Object.keys(peers)) {
      const p = peers[k];
      if (p.lx == null || p.ly == null) continue;
      if (p.rx == null || p.ry == null) {
        p.rx = p.lx;
        p.ry = p.ly;
        continue;
      }
      p.rx += (p.lx - p.rx) * alpha;
      p.ry += (p.ly - p.ry) * alpha;
    }
  }

  function update(dt) {
    if (gameState !== 'playing') return;
    const stage = stagesNow()[stageIndex];
    const now = performance.now();
    const tSec = now * 0.001;
    const sens = getSensitivity();
    const solidRects = PHY.buildSolidRects(stage, tSec);
    const wallJumpRects = PHY.buildWallJumpRects(stage, tSec);

    projectileBurstFx = projectileBurstFx.filter((f) => now - f.t0 < 420);

    const carry = PHY.movingPlatformCarry(stage, tSec, dt, player.x, player.y, player.w, player.h);
    player.x += carry.dx;
    player.y += carry.dy;

    if (player.onGround) player.springGravityScale = null;

    const left = keys['ArrowLeft'] || keys['a'] || keys['A'];
    const right = keys['ArrowRight'] || keys['d'] || keys['D'];
    if (right && !left) facing = 1;
    if (left && !right) facing = -1;

    const wantJump =
      keys[' '] ||
      keys['Space'] ||
      keys['Spacebar'] ||
      keys['w'] ||
      keys['W'] ||
      keys['ArrowUp'];

    const O = runtimeOpts;
    const moveAccel = C.MOVE_ACCEL * sens * O.runMul;
    const maxRun = C.MAX_RUN * sens * O.runMul;

    const control = player.onGround ? 1 : C.AIR_CONTROL * O.airControlMul;
    if (left && !right) player.vx -= moveAccel * control * dt;
    if (right && !left) player.vx += moveAccel * control * dt;
    if (!left && !right && player.onGround) {
      const mag = Math.abs(player.vx);
      if (mag > 0) {
        const drop = C.GROUND_DECEL * dt * O.frictionMul;
        player.vx = Math.sign(player.vx) * Math.max(0, mag - drop);
        if (Math.abs(player.vx) < C.GROUND_V_STOP) player.vx = 0;
      }
    }
    const vxCap =
      now < player.grappleZipUntil ? Math.max(maxRun, C.GRAPPLE_ZIP_MAX) : maxRun;
    player.vx = Math.max(-vxCap, Math.min(vxCap, player.vx));

    if (wantJump) lastJumpPress = now;
    const canJump = player.onGround || now < player.coyoteUntil;
    if (canJump && now - lastJumpPress < C.JUMP_BUFFER_MS) {
      player.vy = C.JUMP_V * gravityDir * O.jumpMul;
      player.onGround = false;
      player.coyoteUntil = 0;
      lastJumpPress = -9999;
    }

    const doubleJumpStage = !!stage.doubleJump;
    const gravMult = player.springGravityScale != null ? player.springGravityScale : 1;
    player.vy += C.GRAVITY * gravMult * gravityDir * dt * O.gravityMul;
    const wasFalling = player.vy * gravityDir > 0;

    player.x += player.vx * dt;
    let hitX = PHY.solidCollide(solidRects, player.x, player.y, player.w, player.h);
    let xIter = 0;
    while (hitX && xIter < 28) {
      xIter++;
      if (player.vx > 0) {
        player.x = hitX.x - player.w - 0.01;
      } else if (player.vx < 0) {
        player.x = hitX.x + hitX.w + 0.01;
      } else {
        const penR = player.x + player.w - hitX.x;
        const penL = hitX.x + hitX.w - player.x;
        if (penR <= 0 || penL <= 0) break;
        if (penR < penL) player.x = hitX.x - player.w - 0.01;
        else player.x = hitX.x + hitX.w + 0.01;
      }
      player.vx = 0;
      hitX = PHY.solidCollide(solidRects, player.x, player.y, player.w, player.h);
    }

    player.y += player.vy * dt;
    player.onGround = false;
    let hitY = PHY.solidCollide(solidRects, player.x, player.y, player.w, player.h);
    let yIter = 0;
    while (hitY && yIter < 28) {
      yIter++;
      if (gravityDir > 0) {
        if (player.vy > 0) {
          player.y = hitY.y - player.h - 0.01;
          player.onGround = true;
          player.coyoteUntil = now + C.COYOTE_MS;
        } else if (player.vy < 0) {
          player.y = hitY.y + hitY.h + 0.01;
        } else {
          const penB = player.y + player.h - hitY.y;
          const penA = hitY.y + hitY.h - player.y;
          if (penB <= 0 || penA <= 0) break;
          if (penB <= penA) {
            player.y = hitY.y - player.h - 0.01;
            player.onGround = true;
            player.coyoteUntil = now + C.COYOTE_MS;
          } else {
            player.y = hitY.y + hitY.h + 0.01;
          }
        }
      } else {
        if (player.vy < 0) {
          player.y = hitY.y + hitY.h + 0.01;
          player.onGround = true;
          player.coyoteUntil = now + C.COYOTE_MS;
        } else if (player.vy > 0) {
          player.y = hitY.y - player.h - 0.01;
        } else {
          const penB = player.y + player.h - hitY.y;
          const penA = hitY.y + hitY.h - player.y;
          if (penB <= 0 || penA <= 0) break;
          if (penB <= penA) {
            player.y = hitY.y - player.h - 0.01;
          } else {
            player.y = hitY.y + hitY.h + 0.01;
            player.onGround = true;
            player.coyoteUntil = now + C.COYOTE_MS;
          }
        }
      }
      player.vy = 0;
      hitY = PHY.solidCollide(solidRects, player.x, player.y, player.w, player.h);
    }

    if (player.onGround && gravityDir > 0) {
      PHY.snapRiderToYMoverTopIfClose(stage, tSec, player);
    }

    const arrows = stage.gravityArrows;
    if (arrows && arrows.length) {
      const cx = player.x + player.w / 2;
      const cy = player.y + player.h / 2;
      for (let i = 0; i < arrows.length; i++) {
        const a = arrows[i];
        const inside = cx >= a.x && cx <= a.x + a.w && cy >= a.y && cy <= a.y + a.h;
        if (inside && !gravityArrowWasInside[i]) gravityDir = a.targetDir >= 0 ? 1 : -1;
        gravityArrowWasInside[i] = inside;
      }
    }

    const springs = stage.springs;
    if (springs && springs.length && player.onGround && wasFalling) {
      const body = { x: player.x, y: player.y, w: player.w, h: player.h };
      for (const sp of springs) {
        if (PHY.rectsOverlap(body, sp)) {
          const base = sp.vy != null ? sp.vy : C.SPRING_VY;
          player.vy = base * gravityDir * O.jumpMul;
          player.springGravityScale = sp.gravityScale != null ? sp.gravityScale : null;
          player.onGround = false;
          player.coyoteUntil = 0;
          player.hazardIFrameUntil = now + C.SPRING_SPIKE_IFRAME_MS;
          break;
        }
      }
    }

    let handledMidairJump = false;
    if (
      doubleJumpStage &&
      !player.onGround &&
      now >= player.coyoteUntil &&
      player.airJumpsUsed < 1 &&
      now - lastJumpPress < C.JUMP_BUFFER_MS &&
      now >= player.wallJumpLockUntil
    ) {
      player.vy = C.JUMP_V * gravityDir * O.jumpMul;
      player.airJumpsUsed++;
      lastJumpPress = -9999;
      handledMidairJump = true;
    }

    if (
      !handledMidairJump &&
      !player.onGround &&
      wantJump &&
      now - lastJumpPress < C.JUMP_BUFFER_MS &&
      now >= player.wallJumpLockUntil
    ) {
      const wl = PHY.wallTouching(wallJumpRects, -1, player.x, player.y, player.w, player.h);
      const wr = PHY.wallTouching(wallJumpRects, 1, player.x, player.y, player.w, player.h);
      if (wl || wr) {
        player.vy = C.JUMP_V * C.WALL_JUMP_VY_MULT * gravityDir * O.jumpMul;
        player.vx = (wr ? -1 : 1) * C.WALL_KICK;
        player.wallJumpLockUntil = now + 200;
        lastJumpPress = -9999;
      }
    }

    if (player.onGround) player.airJumpsUsed = 0;

    if (grappleUnlocked()) {
      const gk = keys['Shift'] || keys['q'] || keys['Q'];
      const ox = player.x + player.w / 2;
      const oy = player.y + player.h / 2;
      const rdx = facing;
      const rdy = 0;
      if (gk) {
        const hit = rayGrappleHit(ox, oy, rdx, rdy, C.GRAPPLE_RANGE, solidRects);
        if (hit) {
          grapple.hx = hit.x;
          grapple.hy = hit.y;
          grapple.aimValid = true;
        } else {
          grapple.aimValid = false;
        }
      } else {
        if (grapple._wasDown && grapple.aimValid) {
          const tdx = grapple.hx - ox;
          const tdy = grapple.hy - oy;
          const dist = Math.hypot(tdx, tdy) || 1;
          const V = Math.min(
            C.GRAPPLE_ZIP_MAX,
            (C.GRAPPLE_ZIP_BASE + dist * C.GRAPPLE_ZIP_PER_DIST) * sens
          );
          const inv = 1 / dist;
          player.vx += tdx * inv * V;
          player.vy += tdy * inv * V * C.GRAPPLE_ZIP_VY_MULT;
          player.grappleZipUntil = now + C.GRAPPLE_ZIP_MOMENTUM_MS;
        }
        grapple.aimValid = false;
      }
      grapple._wasDown = gk;
    }

    if (updateFireballs(stage, dt, solidRects)) return;
    if (monsterStates.length && updateMonsters(dt, solidRects, stage)) return;
    if (updateBoss(stage, dt, tSec, solidRects)) return;

    if (player.y < -C.VOID_KILL_Y_TOP || player.y > stage.worldH + C.VOID_KILL_Y_BOTTOM) {
      die();
      return;
    }

    clampPlayerToWorldBounds(stage);

    if (
      runtimeOpts.epicHealPotionDrops &&
      stage.epicBoss &&
      bossState &&
      bossState.hp > 0 &&
      now >= epicHealPotionNextAt
    ) {
      epicHealPotionNextAt = now + EPIC_HEAL_POTION_INTERVAL_MS;
      itemPickups = itemPickups.filter((p) => p.collected || p.kind !== 'healPotion');
      itemPickups.push({
        x: EPIC_HEAL_SPAWN_X,
        y: EPIC_HEAL_SPAWN_Y,
        w: EPIC_HEAL_POT_W,
        h: EPIC_HEAL_POT_H,
        kind: 'healPotion',
        heal: EPIC_HEAL_POTION_AMOUNT,
        collected: false,
        potionLanded: false,
        dropVy: 0,
      });
    }

    const potionLandRects = buildEpicPotionDropLandRects(stage, tSec);
    updateEpicHealDrops(dt, potionLandRects, stage);

    pbStep(dt);
    tryCollectStageCoins();

    if (tryCollectItemPickups()) return;

    if (keys.KeyS) tryUseWoodenSword();
    if (keys.KeyB) tryUseShield();

    if (spikeHit(stage, tSec)) die();
    if (lavaHit(stage)) die();
    if (laserHit(stage)) die();

    if (stage.bossStage && bossDefeated()) {
      const extBoss = window.SKYHOP_EXTERNAL_LEVEL;
      if (extBoss) {
        gameState = 'stage_clear';
        stageClearTitle.textContent = 'Level complete';
        stageClearSub.textContent = '';
        screenStageClear.classList.remove('hidden');
        screenStageClear.classList.add('flex');
        setTouchHudVisible(false);
        syncLevelsTopNav();
        if (extBoss.mode === 'test' && typeof extBoss.onTestCleared === 'function') {
          try {
            extBoss.onTestCleared();
          } catch {
            /* */
          }
        }
        return;
      }
      if (stageIndex >= stagesNow().length - 1) {
        if (inRace) {
          const totalMs = getRunElapsedMs();
          if (window.SkyHopRacingNotifyFinish) {
            try {
              window.SkyHopRacingNotifyFinish(totalMs, deaths);
            } catch {
              /* */
            }
          }
          inRace = false;
          if (window.SkyHopOnRaceOver) {
            try {
              window.SkyHopOnRaceOver({ success: true, timeMs: totalMs, deaths });
            } catch {
              /* */
            }
          }
          if (window.SkyHopSubmitRun) {
            try {
              void window.SkyHopSubmitRun(totalMs, deaths, 'race');
            } catch {
              /* */
            }
          }
          gameState = 'menu';
          hud.classList.add('hidden');
          setTouchHudVisible(false);
          syncLevelsTopNav();
          return;
        }
        clearRunProgress();
        sealRunClockSegment();
        gameState = 'win';
        hud.classList.add('hidden');
        screenWin.classList.remove('hidden');
        screenWin.classList.add('flex');
        winDeaths.textContent = String(deaths);
        if (winTime) winTime.textContent = formatTotalRunTime(getRunElapsedMs());
        if (window.SkyHopSubmitRun) {
          try {
            void submitCampaignRunIfNeeded();
          } catch {
            /* */
          }
        }
        setTouchHudVisible(false);
        syncLevelsTopNav();
      } else {
        gameState = 'stage_clear';
        stageClearTitle.textContent = `Boss down!`;
        stageClearSub.textContent = 'Next stage unlocked.';
        screenStageClear.classList.remove('hidden');
        screenStageClear.classList.add('flex');
        saveRunProgress();
        setTouchHudVisible(false);
        syncLevelsTopNav();
      }
      return;
    }

    if (goalReached(stage)) {
      const extGoal = window.SKYHOP_EXTERNAL_LEVEL;
      if (extGoal) {
        gameState = 'stage_clear';
        if (extGoal.mode === 'test') {
          stageClearTitle.textContent = 'Test cleared';
          stageClearSub.textContent = 'You can publish from the editor after saving.';
          if (typeof extGoal.onTestCleared === 'function') {
            try {
              extGoal.onTestCleared();
            } catch {
              /* */
            }
          }
        } else {
          stageClearTitle.textContent = 'Level complete';
          stageClearSub.textContent = extGoal.levelTitle ? `“${extGoal.levelTitle}”` : '';
        }
        screenStageClear.classList.remove('hidden');
        screenStageClear.classList.add('flex');
        setTouchHudVisible(false);
        syncLevelsTopNav();
        return;
      }
      if (stageIndex >= stagesNow().length - 1) {
        if (inRace) {
          const totalMs = getRunElapsedMs();
          if (window.SkyHopRacingNotifyFinish) {
            try {
              window.SkyHopRacingNotifyFinish(totalMs, deaths);
            } catch {
              /* */
            }
          }
          inRace = false;
          if (window.SkyHopOnRaceOver) {
            try {
              window.SkyHopOnRaceOver({ success: true, timeMs: totalMs, deaths });
            } catch {
              /* */
            }
          }
          if (window.SkyHopSubmitRun) {
            try {
              void window.SkyHopSubmitRun(totalMs, deaths, 'race');
            } catch {
              /* */
            }
          }
          gameState = 'menu';
          hud.classList.add('hidden');
          setTouchHudVisible(false);
          syncLevelsTopNav();
          return;
        }
        clearRunProgress();
        sealRunClockSegment();
        gameState = 'win';
        hud.classList.add('hidden');
        screenWin.classList.remove('hidden');
        screenWin.classList.add('flex');
        winDeaths.textContent = String(deaths);
        if (winTime) winTime.textContent = formatTotalRunTime(getRunElapsedMs());
        if (window.SkyHopSubmitRun) {
          try {
            void submitCampaignRunIfNeeded();
          } catch {
            /* */
          }
        }
        setTouchHudVisible(false);
        syncLevelsTopNav();
      } else {
        gameState = 'stage_clear';
        stageClearTitle.textContent = `Stage ${stageIndex + 1} complete`;
        stageClearSub.textContent =
          'Good luck on the next climb.';
        screenStageClear.classList.remove('hidden');
        screenStageClear.classList.add('flex');
        saveRunProgress();
        setTouchHudVisible(false);
        syncLevelsTopNav();
      }
    }

    smoothMpRemotePeers(dt);
    updateCamera(stage, dt);
  }

  function drawStage(stage) {
    ctx.save();
    ctx.translate(-cameraX, -cameraY);
    const tSec = performance.now() * 0.001;

    ctx.strokeStyle = stage.doubleJump
      ? 'rgba(16, 185, 129, 0.12)'
      : 'rgba(99, 102, 241, 0.08)';
    ctx.lineWidth = 1;
    const grid = 40;
    const gx0 = Math.floor(cameraX / grid) * grid;
    const gy0 = Math.floor(cameraY / grid) * grid;
    for (let x = gx0; x < cameraX + canvas.clientWidth + grid; x += grid) {
      ctx.beginPath();
      ctx.moveTo(x, cameraY);
      ctx.lineTo(x, cameraY + canvas.clientHeight);
      ctx.stroke();
    }
    for (let y = gy0; y < cameraY + canvas.clientHeight + grid; y += grid) {
      ctx.beginPath();
      ctx.moveTo(cameraX, y);
      ctx.lineTo(cameraX + canvas.clientWidth, y);
      ctx.stroke();
    }

    const lava = stage.lava;
    if (lava) {
      for (const Lv of lava) {
        const g = ctx.createLinearGradient(Lv.x, Lv.y, Lv.x, Lv.y + Lv.h);
        g.addColorStop(0, '#f97316');
        g.addColorStop(0.35, '#ea580c');
        g.addColorStop(0.7, '#c2410c');
        g.addColorStop(1, '#7f1d1d');
        ctx.fillStyle = g;
        ctx.fillRect(Lv.x, Lv.y, Lv.w, Lv.h);
        ctx.strokeStyle = 'rgba(254, 215, 170, 0.35)';
        ctx.lineWidth = 2;
        ctx.strokeRect(Lv.x + 0.5, Lv.y + 0.5, Lv.w - 1, Lv.h - 1);
        ctx.fillStyle = 'rgba(255, 237, 213, 0.25)';
        for (let i = 0; i < Lv.w; i += 24) {
          const ox = ((performance.now() / 40 + i) % 20) - 10;
          ctx.fillRect(Lv.x + i + ox * 0.15, Lv.y + 8, 8, 6);
        }
      }
    }

    function drawPlatformRect(r, isMoving, noWallJump, warnVertical) {
      const g = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
      if (warnVertical) {
        g.addColorStop(0, '#f87171');
        g.addColorStop(0.5, '#dc2626');
        g.addColorStop(1, '#7f1d1d');
        ctx.fillStyle = g;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        const pulse = 0.4 + 0.6 * Math.sin(performance.now() / 220);
        ctx.strokeStyle = `rgba(254, 202, 202, ${0.5 + 0.45 * pulse})`;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
        ctx.lineWidth = 1;
        return;
      }
      if (noWallJump) {
        g.addColorStop(0, '#059669');
        g.addColorStop(1, '#064e3b');
      } else if (isMoving) {
        g.addColorStop(0, '#6366f1');
        g.addColorStop(1, '#4338ca');
      } else {
        g.addColorStop(0, '#4f46e5');
        g.addColorStop(1, '#312e81');
      }
      ctx.fillStyle = g;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.strokeStyle = noWallJump
        ? 'rgba(52, 211, 153, 0.95)'
        : isMoving
          ? 'rgba(251, 191, 36, 0.75)'
          : 'rgba(165, 180, 252, 0.5)';
      ctx.lineWidth = isMoving || noWallJump ? 2 : 1;
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
    }

    for (const p of stage.platforms) {
      drawPlatformRect(
        PHY.resolveMovingRect(p, tSec),
        !!p.move,
        !!p.noWallJump,
        !!p.warnVertical
      );
    }
    const mp = stage.movingPlatforms;
    if (mp) {
      for (const p of mp) {
        drawPlatformRect(PHY.resolveMovingRect(p, tSec), true, !!p.noWallJump, !!p.warnVertical);
      }
    }
    ctx.lineWidth = 1;

    if (stage.shelter && stage.epicBoss) {
      const sh = stage.shelter;
      const wob = 0.35 + 0.65 * Math.sin(performance.now() / 400);
      ctx.fillStyle = `rgba(99, 102, 241, ${0.07 * wob})`;
      ctx.fillRect(sh.x, sh.y, sh.w, sh.h);
    }

    const springs = stage.springs;
    if (springs) {
      const bob = Math.sin(performance.now() / 280) * 2;
      for (const sp of springs) {
        const sx = sp.x;
        const sy = sp.y + bob;
        const g = ctx.createLinearGradient(sx, sy, sx, sy + sp.h);
        g.addColorStop(0, '#2dd4bf');
        g.addColorStop(1, '#0d9488');
        ctx.fillStyle = g;
        const rr = 6;
        ctx.beginPath();
        ctx.moveTo(sx + rr, sy);
        ctx.arcTo(sx + sp.w, sy, sx + sp.w, sy + sp.h, rr);
        ctx.arcTo(sx + sp.w, sy + sp.h, sx, sy + sp.h, rr);
        ctx.arcTo(sx, sy + sp.h, sx, sy, rr);
        ctx.arcTo(sx, sy, sx + sp.w, sy, rr);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(204, 251, 241, 0.6)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    function drawSpikeShape(s) {
      ctx.fillStyle = '#f43f5e';
      const teeth = 6;
      const tw = s.w / teeth;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y + s.h);
      for (let i = 0; i < teeth; i++) {
        ctx.lineTo(s.x + i * tw + tw / 2, s.y);
        ctx.lineTo(s.x + (i + 1) * tw, s.y + s.h);
      }
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.stroke();
    }

    for (const s of stage.spikes || []) {
      drawSpikeShape(s);
    }
    if (stage.movingSpikes) {
      for (const s of stage.movingSpikes) {
        drawSpikeShape(PHY.resolveMovingRect(s, tSec));
      }
    }

    const lasers = stage.lasers;
    if (lasers) {
      const pulse = 0.65 + 0.35 * Math.sin(performance.now() / 120);
      for (const L of lasers) {
        ctx.fillStyle = `rgba(251, 113, 133, ${0.35 * pulse})`;
        ctx.fillRect(L.x - 2, L.y - 2, L.w + 4, L.h + 4);
        ctx.fillStyle = `rgba(254, 205, 211, ${0.85})`;
        ctx.fillRect(L.x, L.y, L.w, L.h);
      }
    }

    const decor = stage.laserDecor;
    if (decor && decor.length) {
      const w = stage.worldW;
      const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 100);
      for (const band of decor) {
        const h = band.h != null ? band.h : 10;
        ctx.fillStyle = `rgba(251, 113, 133, ${0.22 * pulse})`;
        ctx.fillRect(0, band.y - 1, w, h + 2);
        ctx.fillStyle = `rgba(254, 205, 211, ${0.55 * pulse})`;
        ctx.fillRect(0, band.y, w, h);
      }
    }

    if (stage.gravityArrows) {
      for (const a of stage.gravityArrows) {
        ctx.fillStyle = 'rgba(251, 191, 36, 0.35)';
        ctx.fillRect(a.x, a.y, a.w, a.h);
        ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
        ctx.lineWidth = 2;
        ctx.strokeRect(a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1);
        const cx = a.x + a.w / 2;
        const down = a.targetDir > 0;
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        if (down) {
          ctx.moveTo(cx, a.y + a.h - 8);
          ctx.lineTo(cx - 12, a.y + 12);
          ctx.lineTo(cx + 12, a.y + 12);
        } else {
          ctx.moveTo(cx, a.y + 8);
          ctx.lineTo(cx - 12, a.y + a.h - 12);
          ctx.lineTo(cx + 12, a.y + a.h - 12);
        }
        ctx.closePath();
        ctx.fill();
      }
    }

    for (const b of activeFireballs) {
      const rg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, C.FIREBALL_RADIUS * 2);
      rg.addColorStop(0, '#fef08a');
      rg.addColorStop(0.45, '#f97316');
      rg.addColorStop(1, 'rgba(234, 88, 12, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(b.x, b.y, C.FIREBALL_RADIUS * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const m of monsterStates) {
      if (m.y > stage.worldH + 100) continue;
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(m.x, m.y, m.w, m.h);
      ctx.strokeStyle = '#fecaca';
      ctx.strokeRect(m.x + 0.5, m.y + 0.5, m.w - 1, m.h - 1);
    }

    for (const p of itemPickups) {
      if (p.collected) continue;
      if (p.kind === 'healPotion') {
        const b = p.potionLanded ? 0.45 + 0.55 * Math.sin(performance.now() / 350) : 0.68;
        const g = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
        g.addColorStop(0, `rgba(34, 197, 94, ${0.7 + 0.25 * b})`);
        g.addColorStop(1, `rgba(20, 83, 45, ${0.85 + 0.1 * b})`);
        ctx.fillStyle = g;
        ctx.beginPath();
        const cx = p.x + p.w / 2;
        const r = Math.min(p.w, p.h) * 0.4;
        ctx.arc(cx, p.y + p.h * 0.42, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(187, 247, 208, 0.95)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#f0fdf4';
        ctx.font = 'bold 12px Space Grotesk, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('+' + (p.heal != null ? p.heal : 30), cx, p.y + p.h * 0.6);
        ctx.textAlign = 'left';
        ctx.lineWidth = 1;
      } else if (p.kind === 'sword') {
        const g = ctx.createLinearGradient(p.x, p.y, p.x + p.w, p.y + p.h);
        g.addColorStop(0, '#b45309');
        g.addColorStop(1, '#78350f');
        ctx.fillStyle = g;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
        ctx.fillStyle = '#fef3c7';
        ctx.font = '10px Space Grotesk, sans-serif';
        ctx.fillText('W', p.x + p.w * 0.5 - 4, p.y + 16);
      } else {
        const g2 = ctx.createLinearGradient(p.x, p.y, p.x, p.y + p.h);
        g2.addColorStop(0, '#6366f1');
        g2.addColorStop(1, '#3730a3');
        ctx.fillStyle = g2;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = '#a5b4fc';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
        ctx.fillStyle = '#e0e7ff';
        ctx.font = '10px Space Grotesk, sans-serif';
        ctx.fillText('◯', p.x + p.w * 0.5 - 4, p.y + 16);
      }
    }

    if (bossState && bossState.epic && (bossState.laserPhase === 1 || bossState.laserPhase === 2)) {
      const x0 = bossState.laserX;
      const w0 = EPIC_LASER_W;
      const flash = 0.4 + 0.6 * Math.sin(performance.now() / 90);
      if (bossState.laserPhase === 1) {
        ctx.save();
        ctx.setLineDash([14, 10]);
        ctx.lineDashOffset = -((performance.now() / 40) % 24);
        ctx.lineWidth = 3;
        ctx.strokeStyle = `rgba(220, 38, 38, ${0.5 + 0.45 * flash})`;
        ctx.strokeRect(x0 + 1.5, 0, w0 - 3, stage.worldH);
        ctx.setLineDash([7, 7]);
        ctx.lineDashOffset = (performance.now() / 32) % 14;
        ctx.strokeStyle = `rgba(248, 113, 113, ${0.45 + 0.35 * flash})`;
        ctx.strokeRect(x0 + 5, 0, w0 - 10, stage.worldH);
        ctx.restore();
      } else {
        const pulse = 0.55 + 0.45 * Math.sin(performance.now() / 22);
        const g2 = ctx.createLinearGradient(x0, 0, x0 + w0, 0);
        g2.addColorStop(0, `rgba(185, 28, 28, ${0.25 * pulse})`);
        g2.addColorStop(0.5, `rgba(254, 202, 202, ${0.85 * pulse})`);
        g2.addColorStop(1, `rgba(185, 28, 28, ${0.25 * pulse})`);
        ctx.fillStyle = g2;
        ctx.fillRect(x0, 0, w0, stage.worldH);
        ctx.strokeStyle = `rgba(254, 242, 242, ${0.6 + 0.4 * pulse})`;
        ctx.lineWidth = 2;
        ctx.strokeRect(x0 + 0.5, 0, w0 - 1, stage.worldH);
        ctx.lineWidth = 1;
      }
    }

    if (bossState && bossState.hp > 0) {
      const b = bossState;
      if (b.epic) {
        const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
        g.addColorStop(0, '#0e7490');
        g.addColorStop(0.45, '#0f766e');
        g.addColorStop(1, '#134e4a');
        ctx.fillStyle = g;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = '#5eead4';
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = '#ecfeff';
        ctx.font = 'bold 15px Space Grotesk, sans-serif';
        ctx.fillText('BOSS ' + b.hp, b.x + 6, b.y + 22);
      } else {
        ctx.fillStyle = '#581c87';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = '#e9d5ff';
        ctx.lineWidth = 3;
        ctx.strokeRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Space Grotesk, sans-serif';
        ctx.fillText('HP ' + b.hp, b.x + 8, b.y + 24);
      }
    }

    for (const bul of bossBullets) {
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.arc(bul.x, bul.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    const burstNow = performance.now();
    for (const fx of projectileBurstFx) {
      const age = burstNow - fx.t0;
      if (age > 400) continue;
      const u = age / 400;
      const fade = 1 - u;
      ctx.save();
      ctx.globalAlpha = Math.min(1, fade * 1.15);
      const nSpokes = 10;
      for (let s = 0; s < nSpokes; s++) {
        const ang = (s / nSpokes) * Math.PI * 2 + u * 0.85;
        const spokeLen = (1 - u) * (fx.kind === 'fire' ? 44 : 38);
        ctx.strokeStyle =
          fx.kind === 'fire' ? 'rgba(251, 146, 60, 0.88)' : 'rgba(244, 114, 182, 0.9)';
        ctx.lineWidth = 2 * (1 - u * 0.55);
        ctx.beginPath();
        ctx.moveTo(fx.x, fx.y);
        ctx.lineTo(fx.x + Math.cos(ang) * spokeLen, fx.y + Math.sin(ang) * spokeLen);
        ctx.stroke();
      }
      ctx.strokeStyle = fx.kind === 'fire' ? 'rgba(254, 240, 138, 0.92)' : 'rgba(251, 207, 232, 0.95)';
      ctx.lineWidth = 2 + (1 - u) * 2;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 8 + u * 54, 0, Math.PI * 2);
      ctx.stroke();
      const rg = ctx.createRadialGradient(fx.x, fx.y, 0, fx.x, fx.y, 28 + (1 - u) * 12);
      if (fx.kind === 'fire') {
        rg.addColorStop(0, `rgba(254, 243, 199, ${0.55 * fade})`);
        rg.addColorStop(0.45, `rgba(251, 146, 60, ${0.38 * fade})`);
        rg.addColorStop(1, 'rgba(234, 88, 12, 0)');
      } else {
        rg.addColorStop(0, `rgba(251, 207, 232, ${0.58 * fade})`);
        rg.addColorStop(0.5, `rgba(244, 114, 182, ${0.32 * fade})`);
        rg.addColorStop(1, 'rgba(131, 24, 67, 0)');
      }
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 24 + (1 - u) * 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    for (const c of stageCoinStates) {
      if (c.collected) continue;
      const dim = c.dim;
      ctx.beginPath();
      ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
      ctx.fillStyle = dim ? 'rgba(100,116,139,0.45)' : 'rgba(251, 191, 36, 0.92)';
      ctx.fill();
      ctx.strokeStyle = dim ? 'rgba(148,163,184,0.5)' : 'rgba(245, 158, 11, 0.95)';
      ctx.lineWidth = 2;
      ctx.stroke();
      if (dim) {
        ctx.strokeStyle = 'rgba(148,163,184,0.85)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(c.x - c.r * 0.5, c.y - c.r * 0.5);
        ctx.lineTo(c.x + c.r * 0.5, c.y + c.r * 0.5);
        ctx.stroke();
      }
    }

    if (!stage.bossStage) {
      const g = stage.goal;
      const pulse = 0.6 + 0.4 * Math.sin(performance.now() / 200);
      ctx.fillStyle = `rgba(52, 211, 153, ${0.35 + 0.25 * pulse})`;
      ctx.fillRect(g.x - 6, g.y - 6, g.w + 12, g.h + 12);
      ctx.fillStyle = '#34d399';
      ctx.fillRect(g.x, g.y, g.w, g.h);
      ctx.fillStyle = '#ecfdf5';
      ctx.font = 'bold 14px Space Grotesk, sans-serif';
      ctx.fillText('GOAL', g.x + g.w / 2 - 22, g.y + g.h / 2 + 5);
    }

    if (grappleUnlocked() && grapple.aimValid) {
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(player.x + player.w / 2, player.y + player.h / 2);
      ctx.lineTo(grapple.hx, grapple.hy);
      ctx.stroke();
    }

    const nowDraw = performance.now();
    if (hasShield && nowDraw < shieldInvincibleUntil) {
      const pulse = 0.35 + 0.65 * Math.sin(nowDraw / 95);
      const extra = 5 + 2 * Math.sin(nowDraw / 70);
      ctx.save();
      ctx.strokeStyle = `rgba(34, 211, 238, ${0.4 + 0.45 * pulse})`;
      ctx.lineWidth = 2 + pulse;
      ctx.setLineDash([6, 5]);
      ctx.lineDashOffset = -nowDraw / 30;
      ctx.strokeRect(player.x - extra, player.y - extra, player.w + 2 * extra, player.h + 2 * extra);
      ctx.setLineDash([]);
      const grd = ctx.createRadialGradient(
        player.x + player.w / 2,
        player.y + player.h / 2,
        0,
        player.x + player.w / 2,
        player.y + player.h / 2,
        48
      );
      grd.addColorStop(0, `rgba(34, 211, 238, ${0.12 * pulse})`);
      grd.addColorStop(0.6, `rgba(8, 145, 178, ${0.06 * pulse})`);
      grd.addColorStop(1, 'rgba(8, 145, 178, 0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.ellipse(
        player.x + player.w / 2,
        player.y + player.h / 2,
        44,
        40,
        0,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.restore();
    }

    if (inRace) {
      const peers = window.__skyhopMpPeers;
      const myId = window.__skyhopMyPlayerId;
      if (peers && typeof peers === 'object') {
        const mW = player.w;
        const mH = player.h;
        const rr = 6;
        for (const pid of Object.keys(peers)) {
          if (myId != null && String(pid) === String(myId)) continue;
          const pr = peers[pid];
          if (!pr || pr.finished) continue;
          if (pr.stage != null && pr.stage !== stageIndex) continue;
          const rx = pr.rx != null ? pr.rx : pr.lx;
          const ry = pr.ry != null ? pr.ry : pr.ly;
          if (rx == null || ry == null) continue;
          const hue =
            Math.abs(String(pid).split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)) % 360 || 210;
          ctx.fillStyle = `hsl(${hue}, 68%, 52%)`;
          ctx.strokeStyle = `hsl(${hue}, 78%, 36%)`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(rx + rr, ry);
          ctx.arcTo(rx + mW, ry, rx + mW, ry + mH, rr);
          ctx.arcTo(rx + mW, ry + mH, rx, ry + mH, rr);
          ctx.arcTo(rx, ry + mH, rx, ry, rr);
          ctx.arcTo(rx, ry, rx + mW, ry, rr);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#0f172a';
          ctx.fillRect(rx + 8, ry + 12, 5, 5);
          ctx.fillRect(rx + 17, ry + 12, 5, 5);
          const label = pr.name || 'Rival';
          ctx.font = 'bold 11px Space Grotesk, sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
          ctx.fillText(label, rx + mW / 2, ry - 6);
          ctx.textAlign = 'left';
          ctx.lineWidth = 1;
        }
      }
    }

    const r = 6;
    const px = player.x;
    const py = player.y;
    const pw = player.w;
    const ph = player.h;
    if (skinImg && skinImg.complete && skinImg.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(px + r, py);
      ctx.arcTo(px + pw, py, px + pw, py + ph, r);
      ctx.arcTo(px + pw, py + ph, px, py + ph, r);
      ctx.arcTo(px, py + ph, px, py, r);
      ctx.arcTo(px, py, px + pw, py, r);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(skinImg, px, py, pw, ph);
      ctx.restore();
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + r, py);
      ctx.arcTo(px + pw, py, px + pw, py + ph, r);
      ctx.arcTo(px + pw, py + ph, px, py + ph, r);
      ctx.arcTo(px, py + ph, px, py, r);
      ctx.arcTo(px, py, px + pw, py, r);
      ctx.closePath();
      ctx.stroke();
    } else {
      ctx.fillStyle = '#fbbf24';
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(px + r, py);
      ctx.arcTo(px + pw, py, px + pw, py + ph, r);
      ctx.arcTo(px + pw, py + ph, px, py + ph, r);
      ctx.arcTo(px, py + ph, px, py, r);
      ctx.arcTo(px, py, px + pw, py, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(player.x + 8, player.y + 12, 5, 5);
    ctx.fillRect(player.x + 17, player.y + 12, 5, 5);

    if (swordSwingAnim) {
      const sAge = nowDraw - swordSwingAnim.t0;
      if (sAge >= SWORD_SWING_ANIM_MS) {
        swordSwingAnim = null;
      } else {
        const u = sAge / SWORD_SWING_ANIM_MS;
        const f = swordSwingAnim.facing;
        const scx = player.x + player.w * 0.5;
        const scy = player.y + player.h * 0.4;
        const rad = 48 + 12 * u;
        const a0 = f > 0 ? -0.05 * Math.PI : 0.05 * Math.PI;
        const a1 = a0 + (f > 0 ? 1 : -1) * 1.15 * Math.PI * (0.2 + 0.8 * u);
        ctx.save();
        ctx.beginPath();
        ctx.arc(scx, scy, rad, a0, a1, f < 0);
        ctx.lineCap = 'round';
        const hit = swordSwingAnim.hit;
        const crit = swordSwingAnim.crit;
        const alpha = 0.88 * (1 - u);
        ctx.lineWidth = hit ? 4.5 - u * 1.5 : 2.4;
        if (hit && crit) {
          ctx.strokeStyle = `rgba(250, 204, 21, ${alpha})`;
          ctx.shadowBlur = 20 * (1 - u);
          ctx.shadowColor = 'rgba(250, 204, 21, 0.85)';
        } else if (hit) {
          ctx.strokeStyle = `rgba(255, 250, 240, ${alpha})`;
          ctx.shadowBlur = 10 * (1 - u);
          ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        } else {
          ctx.strokeStyle = `rgba(148, 163, 184, ${alpha * 0.7})`;
          ctx.shadowBlur = 0;
        }
        ctx.stroke();
        if (hit && crit) {
          for (let k = 0; k < 5; k++) {
            const ak = a1 - (f > 0 ? 0.2 : -0.2) * k;
            const sp = 3 + 8 * (1 - u);
            ctx.fillStyle = `rgba(253, 230, 138, ${0.6 * (1 - u)})`;
            ctx.beginPath();
            ctx.arc(
              scx + Math.cos(ak) * (rad + 6 + k * 2),
              scy + Math.sin(ak) * (rad + 6 + k * 2),
              sp * (1 - u * 0.6) * 0.35,
              0,
              Math.PI * 2
            );
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }

    if (shieldRingAnim) {
      const gAge = nowDraw - shieldRingAnim.t0;
      if (gAge >= SHIELD_RING_ANIM_MS) {
        shieldRingAnim = null;
      } else {
        const u = gAge / SHIELD_RING_ANIM_MS;
        const wcx = player.x + player.w / 2;
        const wcy = player.y + player.h / 2;
        const ringR = 28 + 70 * u;
        ctx.save();
        ctx.globalAlpha = 0.45 * (1 - u);
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.95)';
        ctx.lineWidth = 3 * (1 - u * 0.5);
        ctx.beginPath();
        ctx.arc(wcx, wcy, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([4, 8]);
        ctx.lineDashOffset = -gAge * 0.2;
        ctx.beginPath();
        ctx.arc(wcx, wcy, ringR * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(165, 243, 252, 0.5)';
        ctx.beginPath();
        ctx.arc(wcx, wcy, ringR * 0.2 + ringR * 0.1 * Math.sin(gAge * 0.04), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.restore();
      }
    }

    ctx.restore();
  }

  function draw() {
    const stage = stagesNow()[stageIndex];
    ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    if ((gameState === 'playing' || gameState === 'paused' || gameState === 'stage_clear' || gameState === 'weapon_modal') && stage.doubleJump) {
      const bg = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight);
      bg.addColorStop(0, '#064e3b');
      bg.addColorStop(0.45, '#065f46');
      bg.addColorStop(1, '#022c22');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
    }
    if (gameState === 'playing' || gameState === 'paused' || gameState === 'stage_clear' || gameState === 'weapon_modal') {
      drawStage(stage);
    } else if (gameState === 'win') {
      const bc = builtinCampaign();
      drawStage(bc[bc.length - 1]);
    }

    if (hudTimer && (gameState === 'playing' || gameState === 'paused')) {
      const sec = Math.floor(getRunElapsedMs() / 1000);
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      hudTimer.textContent = `${m}:${String(s).padStart(2, '0')}`;
    }
    if (
      hudWeaponsWrap &&
      (gameState === 'playing' || gameState === 'paused' || gameState === 'stage_clear' || gameState === 'weapon_modal')
    ) {
      syncWeaponHud(performance.now());
    }
  }

  let lastT = performance.now();
  function frame(t) {
    const dt = Math.min(0.033, (t - lastT) / 1000);
    lastT = t;
    if (gameState === 'playing') update(dt);
    draw();
    requestAnimationFrame(frame);
  }

  function setPaused(on) {
    if (!screenPause) return;
    if (on) {
      if (gameState === 'playing') {
        runFrozenMs += performance.now() - runSegmentStart;
      }
      gameState = 'paused';
      screenPause.classList.remove('hidden');
      screenPause.classList.add('flex');
    } else {
      runSegmentStart = performance.now();
      gameState = 'playing';
      screenPause.classList.add('hidden');
      screenPause.classList.remove('flex');
    }
    updateSkipHud();
    setTouchHudVisible(gameState === 'playing');
    syncLevelsTopNav();
  }

  function goToMenu() {
    const wasRacing = inRace;
    if (wasRacing) {
      inRace = false;
      if (window.SkyHopRaceReset) window.SkyHopRaceReset();
    } else {
      if (gameState !== 'win' && gameState !== 'menu') {
        saveRunProgress();
      }
    }
    closeWeaponScreen();
    gameState = 'menu';
    window.SKYHOP_ACTIVE_STAGES = null;
    window.SKYHOP_EXTERNAL_LEVEL = null;
    setTouchHudVisible(false);
    syncLevelsTopNav();
    if (screenPause) {
      screenPause.classList.add('hidden');
      screenPause.classList.remove('flex');
    }
    screenStageClear.classList.add('hidden');
    screenStageClear.classList.remove('flex');
    screenWin.classList.add('hidden');
    screenWin.classList.remove('flex');
    hud.classList.add('hidden');
    if (btnSkipStage) btnSkipStage.classList.add('hidden');
    screenMenu.classList.remove('hidden');
    screenMenu.classList.add('flex');
    syncDifficultyMenuUI();
    applyCustomFormFromStore();
    syncProjOptsUI();
    syncMenuProgressUI();
  }

  function skipStageAdvance() {
    if (!runtimeOpts.allowSkip) return;
    if (gameState === 'paused') setPaused(false);
    if (gameState !== 'playing') return;
    if (stageIndex >= stagesNow().length - 1) {
      clearRunProgress();
      sealRunClockSegment();
      gameState = 'win';
      hud.classList.add('hidden');
      if (btnSkipStage) btnSkipStage.classList.add('hidden');
      screenWin.classList.remove('hidden');
      screenWin.classList.add('flex');
      winDeaths.textContent = String(deaths);
      if (winTime) winTime.textContent = formatTotalRunTime(getRunElapsedMs());
      if (window.SkyHopSubmitRun) {
        try {
          void submitCampaignRunIfNeeded();
        } catch {
          /* */
        }
      }
      setTouchHudVisible(false);
      syncLevelsTopNav();
      return;
    }
    stageIndex++;
    loadStage(stageIndex);
  }

  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
    }
    if (gameState === 'weapon_modal' && (e.code === 'KeyS' || e.code === 'KeyB')) {
      e.preventDefault();
    }
    if (gameState === 'weapon_modal' && (e.key === 'Escape' || e.key === 'Enter')) {
      e.preventDefault();
      closeWeaponScreen();
      return;
    }
    keys[e.key] = true;
    if (e.code === 'KeyS') keys.KeyS = true;
    if (e.code === 'KeyB') keys.KeyB = true;
    if (gameState === 'playing' && (e.code === 'KeyS' || e.code === 'KeyB')) {
      e.preventDefault();
    }
    if (e.key === 'Escape') {
      if (gameState === 'playing') setPaused(true);
      else if (gameState === 'paused') setPaused(false);
    }
    if (e.key === 'r' || e.key === 'R') {
      if (gameState === 'playing') loadStage(stageIndex);
    }
    if (e.key === 'n' || e.key === 'N') {
      if (gameState === 'playing' && runtimeOpts.allowSkip) skipStageAdvance();
    }
  });
  window.addEventListener('keyup', (e) => {
    keys[e.key] = false;
    if (e.code === 'KeyS') keys.KeyS = false;
    if (e.code === 'KeyB') keys.KeyB = false;
  });

  btnPlay.addEventListener('click', () => {
    refreshRuntimeOptsFromMenu();
    woodenSwordReadyAt = 0;
    shieldItemReadyAt = 0;
    shieldInvincibleUntil = 0;
    swordSwingAnim = null;
    shieldRingAnim = null;
    closeWeaponScreen();
    gameState = 'playing';
    /** @type {{ s0: number, deaths: number, sword: boolean, shield: boolean } | null} */
    let resume = null;
    if (isDebugStartStageActive()) {
      hasWoodenSword = false;
      hasShield = false;
      stageIndex = debugStartStageIndex();
      deaths = 0;
    } else {
      resume = loadRunProgress();
      if (resume) {
        stageIndex = resume.s0;
        deaths = resume.deaths;
        hasWoodenSword = resume.sword;
        hasShield = resume.shield;
      } else {
        hasWoodenSword = false;
        hasShield = false;
        stageIndex = 0;
        deaths = 0;
      }
    }
    resetRunClock();
    screenMenu.classList.add('hidden');
    screenMenu.classList.remove('flex');
    hud.classList.remove('hidden');
    loadStage(stageIndex);
    if (resume) {
      if (resume.sword) hasWoodenSword = true;
      if (resume.shield) hasShield = true;
    }
    syncWeaponHud(performance.now());
    updateSkipHud();
  });

  function startUserLevel(stagesArr, meta) {
    if (!stagesArr || !stagesArr.length) return;
    refreshRuntimeOptsFromMenu();
    closeWeaponScreen();
    woodenSwordReadyAt = 0;
    shieldItemReadyAt = 0;
    shieldInvincibleUntil = 0;
    swordSwingAnim = null;
    shieldRingAnim = null;
    window.SKYHOP_ACTIVE_STAGES = stagesArr;
    window.SKYHOP_EXTERNAL_LEVEL = meta || { mode: 'play' };
    if (btnNextStage) {
      btnNextStage.textContent =
        window.SKYHOP_EXTERNAL_LEVEL && window.SKYHOP_EXTERNAL_LEVEL.mode === 'test'
          ? 'Back to editor'
          : window.SKYHOP_EXTERNAL_LEVEL && window.SKYHOP_EXTERNAL_LEVEL.mode === 'play'
            ? 'Back'
            : 'Next stage';
    }
    stageIndex = 0;
    deaths = 0;
    hasWoodenSword = false;
    hasShield = false;
    gameState = 'playing';
    if (screenMenu) {
      screenMenu.classList.add('hidden');
      screenMenu.classList.remove('flex');
    }
    screenStageClear.classList.add('hidden');
    screenStageClear.classList.remove('flex');
    screenWin.classList.add('hidden');
    screenWin.classList.remove('flex');
    if (screenPause) {
      screenPause.classList.add('hidden');
      screenPause.classList.remove('flex');
    }
    hud.classList.remove('hidden');
    resetRunClock();
    loadStage(0);
    syncWeaponHud(performance.now());
    updateSkipHud();
  }

  btnNextStage.addEventListener('click', () => {
    const ext = window.SKYHOP_EXTERNAL_LEVEL;
    if (ext && typeof ext.onContinue === 'function') {
      const cb = ext.onContinue;
      window.SKYHOP_ACTIVE_STAGES = null;
      window.SKYHOP_EXTERNAL_LEVEL = null;
      if (btnNextStage) btnNextStage.textContent = 'Next stage';
      screenStageClear.classList.add('hidden');
      screenStageClear.classList.remove('flex');
      gameState = 'menu';
      hud.classList.add('hidden');
      setTouchHudVisible(false);
      try {
        cb();
      } catch {
        /* */
      }
      return;
    }
    stageIndex++;
    screenStageClear.classList.add('hidden');
    screenStageClear.classList.remove('flex');
    gameState = 'playing';
    loadStage(stageIndex);
    updateSkipHud();
  });

  btnPlayAgain.addEventListener('click', () => {
    clearRunProgress();
    screenWin.classList.add('hidden');
    screenWin.classList.remove('flex');
    hud.classList.remove('hidden');
    hasWoodenSword = false;
    hasShield = false;
    woodenSwordReadyAt = 0;
    shieldItemReadyAt = 0;
    shieldInvincibleUntil = 0;
    swordSwingAnim = null;
    shieldRingAnim = null;
    closeWeaponScreen();
    gameState = 'playing';
    stageIndex = 0;
    deaths = 0;
    resetRunClock();
    loadStage(0);
    updateSkipHud();
  });

  if (btnSkipStage) {
    btnSkipStage.addEventListener('click', () => skipStageAdvance());
  }

  if (btnResume) {
    btnResume.addEventListener('click', () => setPaused(false));
  }
  if (btnPauseHud) {
    btnPauseHud.addEventListener('click', () => {
      if (gameState === 'playing') setPaused(true);
    });
  }
  if (btnExitToMenu) {
    btnExitToMenu.addEventListener('click', () => {
      goToMenu();
    });
  }
  if (btnWeaponOk) {
    btnWeaponOk.addEventListener('click', () => closeWeaponScreen());
  }

  window.SKYHOP = {
    beginRacing,
    startUserLevel,
    isRacing: function () {
      return inRace;
    },
    getRaceT0: function () {
      return runStartedAt;
    },
    getRaceStartSettings: function () {
      const snap = menuDifficulty === 'custom' ? readCustomForm() : null;
      return { difficulty: menuDifficulty, customOpts: snap };
    },
    getRacingState: function () {
      if (!inRace) {
        return { stage0: 0, finished: false, tMs: 0, deaths: 0 };
      }
      return {
        stage0: stageIndex,
        finished: false,
        tMs: getRunElapsedMs(),
        deaths: deaths,
        x: player.x,
        y: player.y,
        g: gravityDir,
      };
    },
  };

  window.addEventListener('beforeunload', () => {
    if (window.SKYHOP_EXTERNAL_LEVEL) return;
    if (isDebugStartStageActive()) return;
    if (gameState !== 'menu' && gameState !== 'win') {
      saveRunProgress();
    }
  });

  window.addEventListener('resize', resize);
  try {
    window.addEventListener('skyhop-campaign-loaded', () => {
      syncMenuProgressUI();
    });
  } catch {
    /* */
  }
  resize();
  syncSkinImg();
  syncMenuProgressUI();
  requestAnimationFrame(frame);
})();
