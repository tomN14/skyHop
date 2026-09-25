/**
 * User levels: My Levels, online browse, editor, test/upload/play via SKYHOP.startUserLevel.
 */
(function () {
  function api(path, opts) {
    if (!window.SkyHopApiRequest) {
      return Promise.reject(new Error('Open the game from the Node server and ensure Account loads.'));
    }
    const o = opts || {};
    const headers = Object.assign({}, o.headers || {});
    let tok = null;
    try {
      tok = localStorage.getItem('SKYHOP_AUTH_TOKEN');
    } catch {
      /* ignore */
    }
    if (tok && !o.noAuth) headers.Authorization = 'Bearer ' + tok;
    return window.SkyHopApiRequest(path, Object.assign({}, o, { headers }));
  }

  function hasAuth() {
    try {
      return !!localStorage.getItem('SKYHOP_AUTH_TOKEN');
    } catch {
      return false;
    }
  }

  /** @type {{ id: string|null, title: string, data: object, lastMine: any[] }} */
  let editorState = {
    id: null,
    title: '',
    data: null,
    beatenOk: false,
    published: false,
    readOnly: false,
    staffEdit: false,
  };

  /** When non-null, editor is editing built-in campaign slots (owner). */
  let ownerBuiltinArr = null;
  let ownerBuiltinIdx = 0;
  let ownerBuiltinWorld = 1;

  function defaultLevelData() {
    return {
      worldW: 1400,
      worldH: 720,
      underhangDisabled: true,
      spawn: { x: 80, y: 520 },
      goal: { x: 1180, y: 460, w: 72, h: 96 },
      platforms: [
        { x: 0, y: 620, w: 1400, h: 120 },
        { x: 400, y: 480, w: 200, h: 22 },
        { x: 720, y: 380, w: 180, h: 22 },
      ],
      spikes: [],
      lava: [],
      fireballEmitters: [],
      coins: [],
      movingPlatforms: [],
      gravityArrows: [],
      portals: [],
      switches: [],
      blackouts: [],
      stage_time_limit: -1,
      jump_limit: -1,
      spl: '',
    };
  }

  function normalizeStageTime(v) {
    if (v == null || v === '') return -1;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return -1;
    return Math.min(86400, n);
  }

  function normalizeJumpLimit(v) {
    if (v == null || v === '') return -1;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return -1;
    return Math.min(9999, Math.floor(n));
  }

  const RAINBOW_HEX = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#4f46e5', '#a855f7'];
  const FIREBALL_FROM_CYCLE = ['left', 'top', 'right', 'bottom'];

  function normalizeRot(v) {
    const n = Math.round(Number(v) / 90) * 90;
    if (!Number.isFinite(n)) return 0;
    return ((n % 360) + 360) % 360;
  }

  function rainbowHex(nowMs) {
    const t = nowMs != null ? nowMs : (typeof performance !== 'undefined' ? performance.now() : 0);
    return RAINBOW_HEX[Math.floor(t / 220) % RAINBOW_HEX.length];
  }

  function fillSpikeTeeth(ctx, x, y, w, h, rot) {
    const r = normalizeRot(rot);
    ctx.beginPath();
    if (r === 90) {
      ctx.moveTo(x, y);
      const teeth = Math.max(2, Math.round(h / 10));
      const th = h / teeth;
      for (let i = 0; i < teeth; i++) {
        ctx.lineTo(x + w, y + i * th + th / 2);
        ctx.lineTo(x, y + (i + 1) * th);
      }
    } else if (r === 180) {
      ctx.moveTo(x, y);
      const teeth = Math.max(2, Math.round(w / 10));
      const tw = w / teeth;
      for (let i = 0; i < teeth; i++) {
        ctx.lineTo(x + i * tw + tw / 2, y + h);
        ctx.lineTo(x + (i + 1) * tw, y);
      }
    } else if (r === 270) {
      ctx.moveTo(x + w, y);
      const teeth = Math.max(2, Math.round(h / 10));
      const th = h / teeth;
      for (let i = 0; i < teeth; i++) {
        ctx.lineTo(x, y + i * th + th / 2);
        ctx.lineTo(x + w, y + (i + 1) * th);
      }
    } else {
      ctx.moveTo(x, y + h);
      const teeth = Math.max(2, Math.round(w / 10));
      const tw = w / teeth;
      for (let i = 0; i < teeth; i++) {
        ctx.lineTo(x + i * tw + tw / 2, y);
        ctx.lineTo(x + (i + 1) * tw, y + h);
      }
    }
    ctx.closePath();
    ctx.fill();
  }

  const ED_BLOCK_W = 48;
  const ED_BLOCK_H = 24;
  const PORTAL_DEST_DEFAULT_OY = -ED_BLOCK_H * 3;

  function nextEditorId(d) {
    if (!d) return 'e1';
    d._idSeq = (Number(d._idSeq) || 0) + 1;
    return 'e' + d._idSeq;
  }

  function ensureObjId(d, o) {
    if (!o || typeof o !== 'object') return '';
    if (!o.id) o.id = nextEditorId(d);
    return o.id;
  }

  function normalizePortal(d, p) {
    if (!p || typeof p !== 'object') return;
    ensureObjId(d, p);
    let x = Number(p.x);
    let y = Number(p.y);
    let w = Number(p.w);
    let h = Number(p.h);
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 0;
    if (!Number.isFinite(w) || w < 8) w = ED_BLOCK_W;
    if (!Number.isFinite(h) || h < 8) h = ED_BLOCK_W;
    p.x = x;
    p.y = y;
    p.w = Math.min(4000, w);
    p.h = Math.min(4000, h);
    let ox = Number(p.destOx);
    let oy = Number(p.destOy);
    if (!Number.isFinite(ox)) ox = Math.round(p.w / 2);
    if (!Number.isFinite(oy)) oy = PORTAL_DEST_DEFAULT_OY;
    p.destOx = ox;
    p.destOy = oy;
    normalizeLook(p);
  }

  function normalizeSwitch(d, sw) {
    if (!sw || typeof sw !== 'object') return;
    ensureObjId(d, sw);
    let x = Number(sw.x);
    let y = Number(sw.y);
    let w = Number(sw.w);
    let h = Number(sw.h);
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 0;
    if (!Number.isFinite(w) || w < 8) w = 40;
    if (!Number.isFinite(h) || h < 8) h = 16;
    sw.x = x;
    sw.y = y;
    sw.w = Math.min(4000, w);
    sw.h = Math.min(4000, h);
    let mx = Number(sw.moveX);
    let my = Number(sw.moveY);
    if (!Number.isFinite(mx)) mx = ED_BLOCK_W;
    if (!Number.isFinite(my)) my = 0;
    sw.moveX = mx;
    sw.moveY = my;
    if (sw.targetId != null) sw.targetId = String(sw.targetId);
    else delete sw.targetId;
    normalizeLook(sw);
  }

  function clampEditorSec(v, def, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.round(n * 10) / 10));
  }

  function normalizeBlackout(d, b) {
    if (!b || typeof b !== 'object') return;
    ensureObjId(d, b);
    let x = Number(b.x);
    let y = Number(b.y);
    let w = Number(b.w);
    let h = Number(b.h);
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 0;
    if (!Number.isFinite(w) || w < 8) w = 40;
    if (!Number.isFinite(h) || h < 8) h = 40;
    b.x = x;
    b.y = y;
    b.w = Math.min(4000, w);
    b.h = Math.min(4000, h);
    b.blackSec = clampEditorSec(b.blackSec, 3, 0.1, 60);
    b.afterSec = clampEditorSec(b.afterSec, 2, 0, 120);
    b.onTouch = !!b.onTouch;
    normalizeLook(b);
  }

  function portalDest(p) {
    if (!p) return { x: 0, y: 0 };
    return { x: p.x + Number(p.destOx || 0), y: p.y + Number(p.destOy || 0) };
  }

  function linkableLists(d) {
    if (!d) return [];
    return [
      { kind: 'platform', list: d.platforms || [] },
      { kind: 'mover', list: d.movingPlatforms || [] },
      { kind: 'portal', list: d.portals || [] },
      { kind: 'spike', list: d.spikes || [] },
      { kind: 'lava', list: d.lava || [] },
      { kind: 'gravity', list: d.gravityArrows || [] },
      { kind: 'coin', list: d.coins || [] },
    ];
  }

  function objectFromSel(d, sel) {
    if (!d || !sel) return null;
    if (sel.kind === 'platform') return (d.platforms || [])[sel.index] || null;
    if (sel.kind === 'mover') return (d.movingPlatforms || [])[sel.index] || null;
    if (sel.kind === 'portal') return (d.portals || [])[sel.index] || null;
    if (sel.kind === 'switch') return (d.switches || [])[sel.index] || null;
    if (sel.kind === 'spike') return (d.spikes || [])[sel.index] || null;
    if (sel.kind === 'lava') return (d.lava || [])[sel.index] || null;
    if (sel.kind === 'gravity') return (d.gravityArrows || [])[sel.index] || null;
    if (sel.kind === 'coin') return (d.coins || [])[sel.index] || null;
    if (sel.kind === 'blackout') return (d.blackouts || [])[sel.index] || null;
    if (sel.kind === 'fireball') return (d.fireballEmitters || [])[sel.index] || null;
    if (sel.kind === 'goal') return d.goal || null;
    return null;
  }

  function findObjById(d, id) {
    if (!d || !id) return null;
    const lists = linkableLists(d);
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i].list;
      for (let j = 0; j < list.length; j++) {
        if (list[j] && String(list[j].id) === String(id)) return { kind: lists[i].kind, index: j, obj: list[j] };
      }
    }
    return null;
  }

  function stagePayloadFromEditor(d) {
    if (d && d === editorState.data) applyStageFlagsFromUi();
    const raw = JSON.parse(JSON.stringify(d));
    if (!raw.spikes) raw.spikes = [];
    if (!raw.lava) raw.lava = [];
    if (!raw.fireballEmitters) raw.fireballEmitters = [];
    if (!raw.platforms) raw.platforms = [];
    if (!Array.isArray(raw.coins)) raw.coins = [];
    if (!Array.isArray(raw.movingPlatforms)) raw.movingPlatforms = [];
    if (!Array.isArray(raw.spikes)) raw.spikes = [];
    if (!Array.isArray(raw.gravityArrows)) raw.gravityArrows = [];
    if (!Array.isArray(raw.portals)) raw.portals = [];
    if (!Array.isArray(raw.switches)) raw.switches = [];
    if (!Array.isArray(raw.blackouts)) raw.blackouts = [];
    raw.grapple = !!raw.grapple;
    raw.doubleJump = !!raw.doubleJump;
    raw.underhangDisabled = !!raw.underhangDisabled;
    normalizeEditorLevelInPlace(raw);
    return raw;
  }

  /** Coerce API/legacy payloads so the editor canvas can always render. Mutates `d`. */
  function normalizeEditorLevelInPlace(d) {
    if (!d || typeof d !== 'object') return;
    const base = defaultLevelData();
    let w = Number(d.worldW);
    let h = Number(d.worldH);
    if (!Number.isFinite(w) || w < 100) w = base.worldW;
    if (!Number.isFinite(h) || h < 100) h = base.worldH;
    d.worldW = Math.min(20000, Math.max(100, w));
    d.worldH = Math.min(20000, Math.max(100, h));
    if (!d.spawn || typeof d.spawn !== 'object') d.spawn = { x: base.spawn.x, y: base.spawn.y };
    else {
      let sx = Number(d.spawn.x);
      let sy = Number(d.spawn.y);
      if (!Number.isFinite(sx)) sx = base.spawn.x;
      if (!Number.isFinite(sy)) sy = base.spawn.y;
      d.spawn.x = sx;
      d.spawn.y = sy;
    }
    if (!d.goal || typeof d.goal !== 'object') d.goal = { x: base.goal.x, y: base.goal.y, w: base.goal.w, h: base.goal.h };
    else {
      let gx = Number(d.goal.x);
      let gy = Number(d.goal.y);
      let gw = Number(d.goal.w);
      let gh = Number(d.goal.h);
      if (!Number.isFinite(gx)) gx = base.goal.x;
      if (!Number.isFinite(gy)) gy = base.goal.y;
      if (!Number.isFinite(gw) || gw < 8) gw = base.goal.w;
      if (!Number.isFinite(gh) || gh < 8) gh = base.goal.h;
      d.goal.x = gx;
      d.goal.y = gy;
      d.goal.w = gw;
      d.goal.h = gh;
    }
    if (!Array.isArray(d.platforms)) d.platforms = [];
    if (!Array.isArray(d.lava)) d.lava = [];
    if (!Array.isArray(d.spikes)) d.spikes = [];
    if (!Array.isArray(d.fireballEmitters)) d.fireballEmitters = [];
    if (!Array.isArray(d.coins)) d.coins = [];
    if (!Array.isArray(d.movingPlatforms)) d.movingPlatforms = [];
    if (!Array.isArray(d.gravityArrows)) d.gravityArrows = [];
    if (!Array.isArray(d.portals)) d.portals = [];
    if (!Array.isArray(d.switches)) d.switches = [];
    if (!Array.isArray(d.blackouts)) d.blackouts = [];
    for (const p of d.platforms || []) ensureObjId(d, p);
    for (const p of d.movingPlatforms || []) ensureObjId(d, p);
    for (const s of d.spikes || []) ensureObjId(d, s);
    for (const L of d.lava || []) ensureObjId(d, L);
    for (const a of d.gravityArrows) ensureObjId(d, a);
    for (const c of d.coins || []) ensureObjId(d, c);
    for (const p of d.portals) {
      normalizePortal(d, p);
      normalizeToggleFields(p);
    }
    for (const sw of d.switches) {
      normalizeSwitch(d, sw);
      normalizeToggleFields(sw);
    }
    for (const b of d.blackouts) {
      normalizeBlackout(d, b);
      normalizeToggleFields(b);
    }
    for (const e of d.fireballEmitters) normalizeToggleFields(e);
    normalizeToggleFields(d.spawn);
    for (const p of d.movingPlatforms) normalizeMoverMotion(p);
    for (const p of d.platforms) {
      if (p && p.move) normalizeMoverMotion(p);
    }
    for (const p of d.platforms) normalizeLook(p);
    for (const p of d.movingPlatforms) normalizeLook(p);
    for (const L of d.lava) normalizeLook(L);
    for (const s of d.spikes) normalizeLook(s);
    for (const a of d.gravityArrows) normalizeGravityArrow(a);
    for (const c of d.coins) normalizeLook(c);
    normalizeLook(d.goal);
    const bg = validHexColor(d.bgColor);
    if (bg) d.bgColor = bg;
    else delete d.bgColor;
    d.stage_time_limit = normalizeStageTime(d.stage_time_limit);
    d.jump_limit = normalizeJumpLimit(d.jump_limit);
    d.spl = typeof d.spl === 'string' ? d.spl.slice(0, 20000) : '';
  }

  function normalizeMoverMotion(p) {
    if (!p || typeof p !== 'object') return;
    if (!p.move || typeof p.move !== 'object') {
      p.move = { axis: 'x', amp: 80, omega: 1, phase: 0 };
    }
    p.move.axis = p.move.axis === 'y' ? 'y' : 'x';
    let amp = Number(p.move.amp);
    let omega = Number(p.move.omega);
    let phase = Number(p.move.phase);
    if (!Number.isFinite(amp)) amp = 80;
    if (!Number.isFinite(omega) || omega <= 0) omega = 1;
    if (!Number.isFinite(phase)) phase = 0;
    p.move.amp = Math.min(600, Math.max(8, amp));
    p.move.omega = Math.min(4, Math.max(0.15, omega));
    p.move.phase = phase;
  }

  function normalizeGravityArrow(a) {
    if (!a || typeof a !== 'object') return;
    let x = Number(a.x);
    let y = Number(a.y);
    let w = Number(a.w);
    let h = Number(a.h);
    if (!Number.isFinite(x)) x = 0;
    if (!Number.isFinite(y)) y = 0;
    if (!Number.isFinite(w) || w < 8) w = 40;
    if (!Number.isFinite(h) || h < 8) h = 64;
    a.x = x;
    a.y = y;
    a.w = Math.min(4000, w);
    a.h = Math.min(4000, h);
    a.targetDir = Number(a.targetDir) < 0 ? -1 : 1;
    normalizeLook(a);
  }

  let switchLinkMode = false;
  let switchLinkHover = null;

  function selectedPortal() {
    const d = editorState.data;
    if (!d || !editorSelection || editorSelection.kind !== 'portal') return null;
    return (d.portals || [])[editorSelection.index] || null;
  }

  function selectedSwitch() {
    const d = editorState.data;
    if (!d || !editorSelection || editorSelection.kind !== 'switch') return null;
    return (d.switches || [])[editorSelection.index] || null;
  }

  function portalDestHit(wx, wy, p) {
    if (!p) return false;
    const dest = portalDest(p);
    return Math.hypot(wx - dest.x, wy - dest.y) < 16;
  }

  function syncPortalInspector() {
    const wrap = document.getElementById('lvlEdPortalProps');
    const xEl = document.getElementById('lvlEdPortalDestX');
    const yEl = document.getElementById('lvlEdPortalDestY');
    const p = selectedPortal();
    if (!wrap) return;
    wrap.classList.toggle('hidden', !p);
    wrap.classList.toggle('flex', !!p);
    if (!p) return;
    if (xEl && document.activeElement !== xEl) xEl.value = String(Math.round(p.destOx));
    if (yEl && document.activeElement !== yEl) yEl.value = String(Math.round(p.destOy));
  }

  function applyPortalDestFromUi() {
    const p = selectedPortal();
    if (!p) return;
    const xEl = document.getElementById('lvlEdPortalDestX');
    const yEl = document.getElementById('lvlEdPortalDestY');
    let ox = Number(xEl && xEl.value);
    let oy = Number(yEl && yEl.value);
    if (!Number.isFinite(ox)) ox = p.destOx;
    if (!Number.isFinite(oy)) oy = p.destOy;
    p.destOx = ox;
    p.destOy = oy;
    scheduleEditorRedraw();
  }

  function syncSwitchInspector() {
    const wrap = document.getElementById('lvlEdSwitchProps');
    const xEl = document.getElementById('lvlEdSwitchMoveX');
    const yEl = document.getElementById('lvlEdSwitchMoveY');
    const hint = document.getElementById('lvlEdSwitchTargetHint');
    const sw = selectedSwitch();
    if (!wrap) return;
    wrap.classList.toggle('hidden', !sw);
    wrap.classList.toggle('flex', !!sw);
    if (!sw) {
      switchLinkMode = false;
      switchLinkHover = null;
      return;
    }
    if (xEl && document.activeElement !== xEl) xEl.value = String(Math.round(sw.moveX));
    if (yEl && document.activeElement !== yEl) yEl.value = String(Math.round(sw.moveY));
    const btn = document.getElementById('btnLvlEdEditSwitch');
    if (btn) {
      btn.classList.toggle('ring-2', switchLinkMode);
      btn.classList.toggle('ring-lime-300', switchLinkMode);
      btn.classList.toggle('bg-lime-800/70', switchLinkMode);
    }
    if (hint) {
      if (switchLinkMode) {
        hint.textContent = 'Yellow outline = that object. Click it. A faded copy shows the move.';
      } else if (sw.targetId && findObjById(editorState.data, sw.targetId)) {
        const t = findObjById(editorState.data, sw.targetId);
        hint.textContent = 'Linked: ' + t.kind + ' (moves when the switch is pressed).';
      } else {
        hint.textContent = 'No object linked. Click Edit Switch, then click an object.';
      }
    }
  }

  function applySwitchMoveFromUi() {
    const sw = selectedSwitch();
    if (!sw) return;
    const xEl = document.getElementById('lvlEdSwitchMoveX');
    const yEl = document.getElementById('lvlEdSwitchMoveY');
    let mx = Number(xEl && xEl.value);
    let my = Number(yEl && yEl.value);
    if (!Number.isFinite(mx)) mx = sw.moveX;
    if (!Number.isFinite(my)) my = sw.moveY;
    sw.moveX = mx;
    sw.moveY = my;
    scheduleEditorRedraw();
  }

  function selectedBlackout() {
    const d = editorState.data;
    if (!d || !editorSelection || editorSelection.kind !== 'blackout') return null;
    return (d.blackouts || [])[editorSelection.index] || null;
  }

  function syncBlackoutInspector() {
    const wrap = document.getElementById('lvlEdBlackoutProps');
    const blackEl = document.getElementById('lvlEdBlackSec');
    const afterEl = document.getElementById('lvlEdBlackAfter');
    const touchEl = document.getElementById('lvlEdBlackOnTouch');
    const b = selectedBlackout();
    if (!wrap) return;
    wrap.classList.toggle('hidden', !b);
    wrap.classList.toggle('flex', !!b);
    if (!b) return;
    if (blackEl && document.activeElement !== blackEl) blackEl.value = String(b.blackSec);
    if (afterEl && document.activeElement !== afterEl) afterEl.value = String(b.afterSec);
    if (touchEl && document.activeElement !== touchEl) touchEl.checked = !!b.onTouch;
    const afterPrefix = document.getElementById('lvlEdBlackAfterPrefix');
    const afterSuffix = document.getElementById('lvlEdBlackAfterSuffix');
    const secPrefix = document.getElementById('lvlEdBlackSecPrefix');
    const hint = document.getElementById('lvlEdBlackoutHint');
    if (b.onTouch) {
      if (afterPrefix) afterPrefix.textContent = 'Wait';
      if (afterSuffix) afterSuffix.textContent = 'sec after you touch';
      if (secPrefix) secPrefix.textContent = 'then black for';
      if (hint) hint.textContent = 'Walk onto the pad, wait the delay, then the screen goes black.';
    } else {
      if (afterPrefix) afterPrefix.textContent = 'After';
      if (afterSuffix) afterSuffix.textContent = 'sec from stage start';
      if (secPrefix) secPrefix.textContent = 'black for';
      if (hint) hint.textContent = 'Starts by itself. Check Activate when touched to wait until you walk onto the pad.';
    }
  }

  function applyBlackoutFromUi() {
    const b = selectedBlackout();
    if (!b) return;
    const blackEl = document.getElementById('lvlEdBlackSec');
    const afterEl = document.getElementById('lvlEdBlackAfter');
    const touchEl = document.getElementById('lvlEdBlackOnTouch');
    b.blackSec = clampEditorSec(blackEl && blackEl.value, b.blackSec, 0.1, 60);
    b.afterSec = clampEditorSec(afterEl && afterEl.value, b.afterSec, 0, 120);
    b.onTouch = !!(touchEl && touchEl.checked);
    scheduleEditorRedraw();
  }

  function startSwitchLinkMode() {
    if (!selectedSwitch()) return;
    switchLinkMode = true;
    switchLinkHover = null;
    drag = null;
    editorTool = 'select';
    document.querySelectorAll('.lvl-tool').forEach(function (x) {
      x.classList.toggle('lvl-on', x.getAttribute('data-tool') === 'select');
    });
    if (lvlEdStatus) lvlEdStatus.textContent = 'Edit Switch: click the object to move (block, portal, …).';
    scheduleEditorRedraw();
  }

  const ERASER_W = 48;
  const ERASER_H = 24;
  let editorPaintColor = '#4338ca';
  let eraserDrag = false;
  let eraserHover = null;

  function validHexColor(c) {
    return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.trim()) ? c.trim() : null;
  }

  function normalizeLook(obj) {
    if (!obj || typeof obj !== 'object') return;
    const c = validHexColor(obj.color);
    if (c) obj.color = c;
    else delete obj.color;
    if (obj.invisible) obj.invisible = true;
    else delete obj.invisible;
    if (obj.rainbow) obj.rainbow = true;
    else delete obj.rainbow;
    normalizeToggleFields(obj);
    const rot = normalizeRot(obj.rot);
    if (rot) obj.rot = rot;
    else delete obj.rot;
  }

  function normalizeToggleFields(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.affectByToggle) obj.affectByToggle = true;
    else delete obj.affectByToggle;
    if (obj.affectByToggle) obj.defaultToggleState = Number(obj.defaultToggleState) === 0 ? 0 : 1;
    else delete obj.defaultToggleState;
    delete obj.toggleOff;
    delete obj.splAttrSticky;
  }

  function editorFill(obj, fallback) {
    if (obj && obj.rainbow) return rainbowHex();
    return (obj && validHexColor(obj.color)) || fallback;
  }

  function withPaint(obj) {
    const c = validHexColor(editorPaintColor);
    if (c) obj.color = c;
    return obj;
  }

  function subtractRect(src, cut) {
    const ix = Math.max(src.x, cut.x);
    const iy = Math.max(src.y, cut.y);
    const ix2 = Math.min(src.x + src.w, cut.x + cut.w);
    const iy2 = Math.min(src.y + src.h, cut.y + cut.h);
    if (ix >= ix2 || iy >= iy2) return [src];
    const out = [];
    const keep = function (x, y, w, h) {
      if (w < 4 || h < 4) return;
      out.push(Object.assign({}, src, { x: x, y: y, w: w, h: h }));
    };
    if (src.x < ix) keep(src.x, src.y, ix - src.x, src.h);
    if (src.x + src.w > ix2) keep(ix2, src.y, src.x + src.w - ix2, src.h);
    if (src.y < iy) keep(ix, src.y, ix2 - ix, iy - src.y);
    if (src.y + src.h > iy2) keep(ix, iy2, ix2 - ix, src.y + src.h - iy2);
    return out;
  }

  function carveRectList(list, cut) {
    if (!list) return;
    const next = [];
    for (let i = 0; i < list.length; i++) {
      const bits = subtractRect(list[i], cut);
      for (let j = 0; j < bits.length; j++) {
        const piece = bits[j];
        if (j > 0) piece.id = nextEditorId(editorState.data);
        next.push(piece);
      }
    }
    list.length = 0;
    for (let i = 0; i < next.length; i++) list.push(next[i]);
  }

  function removeOverlappingRects(list, cut) {
    if (!list) return;
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (!r) continue;
      if (r.x < cut.x + cut.w && r.x + r.w > cut.x && r.y < cut.y + cut.h && r.y + r.h > cut.y) {
        list.splice(i, 1);
      }
    }
  }

  function eraserStampAt(wx, wy) {
    return {
      x: Math.round((wx - ERASER_W / 2) / 8) * 8,
      y: Math.round((wy - ERASER_H / 2) / 8) * 8,
      w: ERASER_W,
      h: ERASER_H,
    };
  }

  function eraseAt(wx, wy) {
    const d = editorState.data;
    if (!d) return;
    const cut = eraserStampAt(wx, wy);
    carveRectList(d.platforms, cut);
    carveRectList(d.movingPlatforms, cut);
    carveRectList(d.lava, cut);
    carveRectList(d.spikes, cut);
    carveRectList(d.gravityArrows, cut);
    removeOverlappingRects(d.portals, cut);
    removeOverlappingRects(d.switches, cut);
    removeOverlappingRects(d.blackouts, cut);
    if (d.coins && d.coins.length) {
      d.coins = d.coins.filter(function (c) {
        const r = Number(c.r) > 0 ? Number(c.r) : 14;
        return !(c.x + r > cut.x && c.x - r < cut.x + cut.w && c.y + r > cut.y && c.y - r < cut.y + cut.h);
      });
    }
    editorSelection = null;
  }

  function selectedLookTarget() {
    const d = editorState.data;
    if (!d || !editorSelection) return null;
    if (editorSelection.kind === 'platform') return (d.platforms || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'mover') return (d.movingPlatforms || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'lava') return (d.lava || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'spike') return (d.spikes || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'gravity') return (d.gravityArrows || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'portal') return (d.portals || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'switch') return (d.switches || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'blackout') return (d.blackouts || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'coin') return (d.coins || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'goal') return d.goal || null;
    return null;
  }

  function defaultColorForKind(kind) {
    if (kind === 'lava') return '#ea580c';
    if (kind === 'spike') return '#9f1239';
    if (kind === 'goal') return '#34d399';
    if (kind === 'mover') return '#4f46e5';
    if (kind === 'gravity') return '#fbbf24';
    if (kind === 'portal') return '#059669';
    if (kind === 'switch') return '#65a30d';
    if (kind === 'blackout') return '#111827';
    if (kind === 'coin') return '#f59e0b';
    return '#4338ca';
  }

  function syncAppearanceUi() {
    const wrap = document.getElementById('lvlEdAppearProps');
    const col = document.getElementById('lvlEdColorSel');
    const inv = document.getElementById('lvlEdOptInvisible');
    const bg = document.getElementById('lvlEdColorBg');
    const paint = document.getElementById('lvlEdColorPaint');
    const d = editorState.data;
    const t = selectedLookTarget();
    if (bg && d && document.activeElement !== bg) {
      bg.value = validHexColor(d.bgColor) || '#1e1b4b';
    }
    if (paint && document.activeElement !== paint) {
      paint.value = validHexColor(editorPaintColor) || '#4338ca';
    }
    if (!wrap) return;
    wrap.classList.toggle('hidden', !t);
    wrap.classList.toggle('flex', !!t);
    if (!t) return;
    if (col && document.activeElement !== col) {
      col.value =
        validHexColor(t.color) ||
        (editorSelection && defaultColorForKind(editorSelection.kind)) ||
        editorPaintColor ||
        '#4338ca';
    }
    if (inv && document.activeElement !== inv) inv.checked = !!t.invisible;
    const tog = document.getElementById('lvlEdOptToggle');
    const togWrap = document.getElementById('lvlEdToggleDefaultWrap');
    const togDef = document.getElementById('lvlEdToggleDefault');
    if (tog && document.activeElement !== tog) tog.checked = !!t.affectByToggle;
    if (togWrap) togWrap.classList.toggle('hidden', !t.affectByToggle);
    if (togDef && document.activeElement !== togDef) {
      togDef.value = Number(t.defaultToggleState) === 0 ? '0' : '1';
    }
    const rain = document.getElementById('lvlEdOptRainbow');
    if (rain && document.activeElement !== rain) rain.checked = !!t.rainbow;
  }

  function applySelectedColorFromUi() {
    const t = selectedLookTarget();
    const col = document.getElementById('lvlEdColorSel');
    if (col && validHexColor(col.value)) {
      editorPaintColor = col.value;
      if (t) t.color = col.value;
    }
    scheduleEditorRedraw();
  }

  function applySelectedInvisibleFromUi() {
    const t = selectedLookTarget();
    const inv = document.getElementById('lvlEdOptInvisible');
    if (t && inv) t.invisible = !!inv.checked;
    scheduleEditorRedraw();
  }

  function applySelectedToggleFromUi() {
    const t = selectedLookTarget();
    const tog = document.getElementById('lvlEdOptToggle');
    const togDef = document.getElementById('lvlEdToggleDefault');
    const togWrap = document.getElementById('lvlEdToggleDefaultWrap');
    if (!t) return;
    if (tog && tog.checked) {
      t.affectByToggle = true;
      t.defaultToggleState = togDef && togDef.value === '0' ? 0 : 1;
    } else {
      delete t.affectByToggle;
      delete t.defaultToggleState;
    }
    delete t.toggleOff;
    if (togWrap) togWrap.classList.toggle('hidden', !(tog && tog.checked));
    scheduleEditorRedraw();
  }

  function applySelectedRainbowFromUi() {
    const t = selectedLookTarget();
    const rain = document.getElementById('lvlEdOptRainbow');
    if (t && rain) {
      if (rain.checked) t.rainbow = true;
      else delete t.rainbow;
    }
    scheduleEditorRedraw();
  }

  function applyPaintFromUi() {
    const el = document.getElementById('lvlEdColorPaint');
    if (el && validHexColor(el.value)) editorPaintColor = el.value;
  }

  function applyBgFromUi() {
    const d = editorState.data;
    const el = document.getElementById('lvlEdColorBg');
    if (d && el && validHexColor(el.value)) d.bgColor = el.value;
    scheduleEditorRedraw();
  }

  function selectedSizeRect() {
    const d = editorState.data;
    if (!d || !editorSelection) return null;
    if (editorSelection.kind === 'platform') return (d.platforms || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'mover') return (d.movingPlatforms || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'lava') return (d.lava || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'spike') return (d.spikes || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'gravity') return (d.gravityArrows || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'portal') return (d.portals || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'switch') return (d.switches || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'blackout') return (d.blackouts || [])[editorSelection.index] || null;
    if (editorSelection.kind === 'goal') return d.goal || null;
    return null;
  }

  function clampRectSize(p, w, h) {
    if (!p) return;
    let nw = Number(w);
    let nh = Number(h);
    if (!Number.isFinite(nw)) nw = p.w;
    if (!Number.isFinite(nh)) nh = p.h;
    p.w = Math.min(4000, Math.max(8, Math.round(nw)));
    p.h = Math.min(4000, Math.max(8, Math.round(nh)));
  }

  function syncSizeInspector() {
    const wrap = document.getElementById('lvlEdSizeProps');
    const wEl = document.getElementById('lvlEdSizeW');
    const hEl = document.getElementById('lvlEdSizeH');
    const p = selectedSizeRect();
    if (!wrap) return;
    wrap.classList.toggle('hidden', !p);
    wrap.classList.toggle('flex', !!p);
    if (!p) return;
    if (wEl && document.activeElement !== wEl) wEl.value = String(Math.round(p.w));
    if (hEl && document.activeElement !== hEl) hEl.value = String(Math.round(p.h));
  }

  function applySizeFromUi() {
    const p = selectedSizeRect();
    if (!p) return;
    const wEl = document.getElementById('lvlEdSizeW');
    const hEl = document.getElementById('lvlEdSizeH');
    clampRectSize(p, wEl && wEl.value, hEl && hEl.value);
    scheduleEditorRedraw();
  }

  function selectedContainsPoint(wx, wy) {
    const d = editorState.data;
    if (!d || !editorSelection) return false;
    const k = editorSelection.kind;
    const i = editorSelection.index;
    if (k === 'goal') {
      const g = d.goal;
      return !!(g && wx >= g.x && wx <= g.x + g.w && wy >= g.y && wy <= g.y + g.h);
    }
    if (k === 'spawn') {
      const sp = d.spawn;
      return !!(sp && Math.hypot(wx - sp.x, wy - sp.y) < 28);
    }
    if (k === 'coin') {
      const c = (d.coins || [])[i];
      if (!c) return false;
      const r = Number(c.r) > 0 ? Number(c.r) : 14;
      return Math.hypot(wx - c.x, wy - c.y) < r + 10;
    }
    if (k === 'fireball') {
      const e = (d.fireballEmitters || [])[i];
      if (!e) return false;
      let cx;
      let cy;
      if (e.from === 'left') {
        cx = 0;
        cy = e.pos;
      } else if (e.from === 'right') {
        cx = d.worldW;
        cy = e.pos;
      } else if (e.from === 'top') {
        cx = e.pos;
        cy = 0;
      } else {
        cx = e.pos;
        cy = d.worldH;
      }
      return Math.hypot(wx - cx, wy - cy) < 36;
    }
    let r = null;
    if (k === 'platform') r = (d.platforms || [])[i];
    else if (k === 'mover') r = (d.movingPlatforms || [])[i];
    else if (k === 'lava') r = (d.lava || [])[i];
    else if (k === 'spike') r = (d.spikes || [])[i];
    else if (k === 'gravity') r = (d.gravityArrows || [])[i];
    else if (k === 'portal') r = (d.portals || [])[i];
    else if (k === 'switch') r = (d.switches || [])[i];
    else if (k === 'blackout') r = (d.blackouts || [])[i];
    return !!(r && wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h);
  }

  function beginMoveDrag(w) {
    if (!editorSelection || !editorState.data) {
      drag = null;
      return;
    }
    const d = editorState.data;
    drag = { sel: editorSelection, last: w };
    if (drag.sel.kind === 'platform') {
      const p = d.platforms[drag.sel.index];
      drag.startPlatformPos = { x: p.x, y: p.y };
    } else if (drag.sel.kind === 'lava') {
      const L = d.lava[drag.sel.index];
      drag.startLavaPos = { x: L.x, y: L.y };
    } else if (drag.sel.kind === 'goal') drag.startGoal = { x: d.goal.x, y: d.goal.y };
    else if (drag.sel.kind === 'spawn') drag.startSpawn = { x: d.spawn.x, y: d.spawn.y };
    else if (drag.sel.kind === 'fireball') {
      drag.startEmitter = JSON.parse(JSON.stringify(d.fireballEmitters[drag.sel.index]));
    } else if (drag.sel.kind === 'coin') {
      const c = d.coins[drag.sel.index];
      drag.startCoin = { x: c.x, y: c.y };
    } else if (drag.sel.kind === 'mover') {
      const p = d.movingPlatforms[drag.sel.index];
      drag.startMover = { x: p.x, y: p.y };
    } else if (drag.sel.kind === 'spike') {
      const s = d.spikes[drag.sel.index];
      drag.startSpike = { x: s.x, y: s.y };
    } else if (drag.sel.kind === 'gravity') {
      const a = d.gravityArrows[drag.sel.index];
      drag.startGravity = { x: a.x, y: a.y };
    } else if (drag.sel.kind === 'portal') {
      const p = d.portals[drag.sel.index];
      drag.startPortal = { x: p.x, y: p.y };
    } else if (drag.sel.kind === 'portal-dest') {
      const p = d.portals[drag.sel.index];
      drag.startPortalDest = { x: p.destOx, y: p.destOy };
    } else if (drag.sel.kind === 'switch') {
      const sw = d.switches[drag.sel.index];
      drag.startSwitch = { x: sw.x, y: sw.y };
    } else if (drag.sel.kind === 'blackout') {
      const b = d.blackouts[drag.sel.index];
      drag.startBlackout = { x: b.x, y: b.y };
    }
  }

  function snapDraggedObject() {
    if (!drag || !drag.sel || !editorState.data) return;
    const d = editorState.data;
    const snap8 = function (v) {
      return Math.round(v / 8) * 8;
    };
    const snap4 = function (v) {
      return Math.round(v / 4) * 4;
    };
    const k = drag.sel.kind;
    if (k === 'platform') {
      const p = d.platforms[drag.sel.index];
      if (p) {
        p.x = snap8(p.x);
        p.y = snap8(p.y);
      }
    } else if (k === 'mover') {
      const p = d.movingPlatforms[drag.sel.index];
      if (p) {
        p.x = snap8(p.x);
        p.y = snap8(p.y);
      }
    } else if (k === 'lava') {
      const L = d.lava[drag.sel.index];
      if (L) {
        L.x = snap8(L.x);
        L.y = snap8(L.y);
      }
    } else if (k === 'spike') {
      const s = d.spikes[drag.sel.index];
      if (s) {
        s.x = snap8(s.x);
        s.y = snap8(s.y);
      }
    } else if (k === 'gravity') {
      const a = d.gravityArrows[drag.sel.index];
      if (a) {
        a.x = snap8(a.x);
        a.y = snap8(a.y);
      }
    } else if (k === 'portal') {
      const p = d.portals[drag.sel.index];
      if (p) {
        p.x = snap8(p.x);
        p.y = snap8(p.y);
      }
    } else if (k === 'portal-dest') {
      const p = d.portals[drag.sel.index];
      if (p) {
        p.destOx = snap4(p.destOx);
        p.destOy = snap4(p.destOy);
      }
    } else if (k === 'switch') {
      const sw = d.switches[drag.sel.index];
      if (sw) {
        sw.x = snap8(sw.x);
        sw.y = snap8(sw.y);
      }
    } else if (k === 'blackout') {
      const b = d.blackouts[drag.sel.index];
      if (b) {
        b.x = snap8(b.x);
        b.y = snap8(b.y);
      }
    } else if (k === 'goal') {
      d.goal.x = snap4(d.goal.x);
      d.goal.y = snap4(d.goal.y);
    } else if (k === 'spawn') {
      d.spawn.x = snap4(d.spawn.x);
      d.spawn.y = snap4(d.spawn.y);
    } else if (k === 'coin') {
      const c = d.coins[drag.sel.index];
      if (c) {
        c.x = snap4(c.x);
        c.y = snap4(c.y);
      }
    }
  }

  function selectedMoverPlatform() {
    const d = editorState.data;
    if (!d || !editorSelection) return null;
    if (editorSelection.kind === 'mover') {
      const p = (d.movingPlatforms || [])[editorSelection.index];
      return p || null;
    }
    if (editorSelection.kind === 'platform') {
      const p = (d.platforms || [])[editorSelection.index];
      return p && p.move ? p : null;
    }
    return null;
  }

  function editorGrappleChecked() {
    const d = editorState.data;
    if (!d) return false;
    if (d.grapple === true) return true;
    if (d.grapple === false) return false;
    if (ownerBuiltinArr && ownerBuiltinArr.length) {
      const intro = ownerBuiltinArr.findIndex((s) => s && s.grapple);
      return intro >= 0 && ownerBuiltinIdx >= intro;
    }
    return false;
  }

  function syncStageFlagsUi() {
    const d = editorState.data;
    const g = document.getElementById('lvlEdOptGrapple');
    const dj = document.getElementById('lvlEdOptDoubleJump');
    const beams = document.getElementById('lvlEdOptBeams');
    if (!d) return;
    if (g && document.activeElement !== g) g.checked = editorGrappleChecked();
    if (dj && document.activeElement !== dj) dj.checked = !!d.doubleJump;
    if (beams && document.activeElement !== beams) beams.checked = !d.underhangDisabled;
    const timeEl = document.getElementById('lvlEdTimeLimit');
    const jumpEl = document.getElementById('lvlEdJumpLimit');
    const splEl = document.getElementById('lvlEdSplText');
    const splPanel = document.getElementById('lvlEdSplPanel');
    if (timeEl && document.activeElement !== timeEl) timeEl.value = String(normalizeStageTime(d.stage_time_limit));
    if (jumpEl && document.activeElement !== jumpEl) jumpEl.value = String(normalizeJumpLimit(d.jump_limit));
    if (splEl && splPanel && !splPanel.classList.contains('hidden') && document.activeElement !== splEl) {
      splEl.value = typeof d.spl === 'string' ? d.spl : '';
    }
  }

  function applyStageFlagsFromUi() {
    const d = editorState.data;
    if (!d) return;
    const g = document.getElementById('lvlEdOptGrapple');
    const dj = document.getElementById('lvlEdOptDoubleJump');
    const beams = document.getElementById('lvlEdOptBeams');
    if (g) d.grapple = !!g.checked;
    if (dj) d.doubleJump = !!dj.checked;
    if (beams) d.underhangDisabled = !beams.checked;
    const timeEl = document.getElementById('lvlEdTimeLimit');
    const jumpEl = document.getElementById('lvlEdJumpLimit');
    const splEl = document.getElementById('lvlEdSplText');
    const splPanel = document.getElementById('lvlEdSplPanel');
    if (timeEl) d.stage_time_limit = normalizeStageTime(timeEl.value);
    if (jumpEl) d.jump_limit = normalizeJumpLimit(jumpEl.value);
    if (splEl && splPanel && !splPanel.classList.contains('hidden')) {
      d.spl = String(splEl.value || '').slice(0, 20000);
    }
  }

  function syncMoverInspector() {
    const wrap = document.getElementById('lvlEdMoverProps');
    const axisEl = document.getElementById('lvlEdMoverAxis');
    const ampEl = document.getElementById('lvlEdMoverAmp');
    const omegaEl = document.getElementById('lvlEdMoverOmega');
    const p = selectedMoverPlatform();
    if (!wrap) return;
    wrap.classList.toggle('hidden', !p);
    wrap.classList.toggle('flex', !!p);
    if (!p || !p.move) return;
    if (axisEl && document.activeElement !== axisEl) axisEl.value = p.move.axis === 'y' ? 'y' : 'x';
    if (ampEl && document.activeElement !== ampEl) ampEl.value = String(p.move.amp);
    if (omegaEl && document.activeElement !== omegaEl) omegaEl.value = String(p.move.omega);
  }

  function selectedGravityArrow() {
    const d = editorState.data;
    if (!d || !editorSelection || editorSelection.kind !== 'gravity') return null;
    return (d.gravityArrows || [])[editorSelection.index] || null;
  }

  function syncGravityInspector() {
    const wrap = document.getElementById('lvlEdGravProps');
    const dirEl = document.getElementById('lvlEdGravDir');
    const a = selectedGravityArrow();
    if (!wrap) return;
    wrap.classList.toggle('hidden', !a);
    wrap.classList.toggle('flex', !!a);
    if (!a) return;
    if (dirEl && document.activeElement !== dirEl) dirEl.value = a.targetDir < 0 ? '-1' : '1';
  }

  function applyGravityFromUi() {
    const a = selectedGravityArrow();
    const dirEl = document.getElementById('lvlEdGravDir');
    if (!a || !dirEl) return;
    a.targetDir = dirEl.value === '1' ? 1 : -1;
    scheduleEditorRedraw();
  }

  function drawMoverTravel(ctx, p) {
    if (!p || !p.move) return;
    const amp = p.move.amp;
    const axis = p.move.axis === 'y' ? 'y' : 'x';
    const a0 = axis === 'y' ? toScreen(p.x + p.w / 2, p.y - amp) : toScreen(p.x - amp, p.y + p.h / 2);
    const a1 = axis === 'y' ? toScreen(p.x + p.w / 2, p.y + p.h + amp) : toScreen(p.x + p.w + amp, p.y + p.h / 2);
    ctx.save();
    ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
    ctx.setLineDash([5, 4]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(a0.x, a0.y);
    ctx.lineTo(a1.x, a1.y);
    ctx.stroke();
    ctx.setLineDash([]);
    const ghostA = axis === 'y' ? toScreen(p.x, p.y - amp) : toScreen(p.x - amp, p.y);
    const ghostB = axis === 'y' ? toScreen(p.x, p.y + amp) : toScreen(p.x + amp, p.y);
    ctx.fillStyle = 'rgba(34, 211, 238, 0.12)';
    ctx.strokeStyle = 'rgba(165, 243, 252, 0.45)';
    ctx.fillRect(ghostA.x, ghostA.y, p.w * cam.s, p.h * cam.s);
    ctx.strokeRect(ghostA.x + 0.5, ghostA.y + 0.5, p.w * cam.s - 1, p.h * cam.s - 1);
    ctx.fillRect(ghostB.x, ghostB.y, p.w * cam.s, p.h * cam.s);
    ctx.strokeRect(ghostB.x + 0.5, ghostB.y + 0.5, p.w * cam.s - 1, p.h * cam.s - 1);
    ctx.restore();
  }

  /* ---------- Editor canvas ---------- */
  let editorTool = 'select';
  let editorSelection = null;
  let editorHover = null;
  let drag = null;
  let cam = { s: 1, ox: 0, oy: 0 };

  function syncEditorCanvasLayout() {
    const canvas = document.getElementById('lvlEditorCanvas');
    if (!canvas) return;
    const wrap = canvas.parentElement;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 640;
    let cssW = 640;
    let cssH = Math.max(260, Math.floor(vh * 0.42));
    if (wrap) {
      const r = wrap.getBoundingClientRect();
      const w = Math.floor(r.width);
      const h = Math.floor(r.height);
      if (w >= 200) cssW = Math.min(960, w);
      if (h >= 180) cssH = Math.min(620, h);
    }
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    canvas.style.maxWidth = '100%';
    canvas.width = cssW;
    canvas.height = cssH;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  function fitCam(canvas, worldW, worldH) {
    const pad = 0.92;
    const cw = Math.max(1, canvas.width || canvas.clientWidth || 400);
    const ch = Math.max(1, canvas.height || canvas.clientHeight || 240);
    const s = Math.min((cw * pad) / worldW, (ch * pad) / worldH);
    cam.s = s > 0 && Number.isFinite(s) ? s : 0.001;
    cam.ox = (cw - worldW * cam.s) / 2;
    cam.oy = (ch - worldH * cam.s) / 2;
  }

  function toScreen(wx, wy) {
    return { x: cam.ox + wx * cam.s, y: cam.oy + wy * cam.s };
  }

  function toWorld(px, py) {
    return { x: (px - cam.ox) / cam.s, y: (py - cam.oy) / cam.s };
  }

  function hitTest(wx, wy, d) {
    const g = d.goal;
    if (wx >= g.x && wx <= g.x + g.w && wy >= g.y && wy <= g.y + g.h) return { kind: 'goal' };
    const sp = d.spawn;
    if (Math.hypot(wx - sp.x, wy - sp.y) < 28) return { kind: 'spawn' };
    const coins = d.coins || [];
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i];
      const r = Number(c.r) > 0 ? Number(c.r) : 14;
      if (Math.hypot(wx - c.x, wy - c.y) < r + 10) return { kind: 'coin', index: i };
    }
    const grav = d.gravityArrows || [];
    for (let i = grav.length - 1; i >= 0; i--) {
      const a = grav[i];
      if (wx >= a.x && wx <= a.x + a.w && wy >= a.y && wy <= a.y + a.h) return { kind: 'gravity', index: i };
    }
    const portals = d.portals || [];
    for (let i = portals.length - 1; i >= 0; i--) {
      const p = portals[i];
      if (wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h) return { kind: 'portal', index: i };
    }
    const switches = d.switches || [];
    for (let i = switches.length - 1; i >= 0; i--) {
      const sw = switches[i];
      if (wx >= sw.x && wx <= sw.x + sw.w && wy >= sw.y && wy <= sw.y + sw.h) return { kind: 'switch', index: i };
    }
    const blackouts = d.blackouts || [];
    for (let i = blackouts.length - 1; i >= 0; i--) {
      const b = blackouts[i];
      if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + b.h) return { kind: 'blackout', index: i };
    }
    const spikes = d.spikes || [];
    for (let i = spikes.length - 1; i >= 0; i--) {
      const s = spikes[i];
      if (wx >= s.x && wx <= s.x + s.w && wy >= s.y && wy <= s.y + s.h) return { kind: 'spike', index: i };
    }
    const mp = d.movingPlatforms || [];
    for (let i = mp.length - 1; i >= 0; i--) {
      const p = mp[i];
      if (wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h) return { kind: 'mover', index: i };
    }
    for (let i = d.fireballEmitters.length - 1; i >= 0; i--) {
      const e = d.fireballEmitters[i];
      let cx;
      let cy;
      if (e.from === 'left') {
        cx = 0;
        cy = e.pos;
      } else if (e.from === 'right') {
        cx = d.worldW;
        cy = e.pos;
      } else if (e.from === 'top') {
        cx = e.pos;
        cy = 0;
      } else {
        cx = e.pos;
        cy = d.worldH;
      }
      if (Math.hypot(wx - cx, wy - cy) < 36) return { kind: 'fireball', index: i };
    }
    for (let i = d.lava.length - 1; i >= 0; i--) {
      const L = d.lava[i];
      if (wx >= L.x && wx <= L.x + L.w && wy >= L.y && wy <= L.y + L.h) return { kind: 'lava', index: i };
    }
    for (let i = d.platforms.length - 1; i >= 0; i--) {
      const p = d.platforms[i];
      if (wx >= p.x && wx <= p.x + p.w && wy >= p.y && wy <= p.y + p.h) return { kind: 'platform', index: i };
    }
    return null;
  }

  function linkableHitPad() {
    return Math.max(10, 14 / (cam.s || 1));
  }

  function pointHitsLinkable(wx, wy, kind, obj, pad) {
    if (!obj) return false;
    if (kind === 'coin') {
      const r = (Number(obj.r) > 0 ? Number(obj.r) : 14) + pad;
      return Math.hypot(wx - obj.x, wy - obj.y) <= r;
    }
    const w = Number(obj.w);
    const h = Number(obj.h);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return false;
    return wx >= obj.x - pad && wx <= obj.x + w + pad && wy >= obj.y - pad && wy <= obj.y + h + pad;
  }

  function hitTestLinkable(wx, wy, d) {
    let best = null;
    let bestScore = Infinity;
    const pad = linkableHitPad();
    const lists = linkableLists(d);
    for (let i = 0; i < lists.length; i++) {
      const kind = lists[i].kind;
      const list = lists[i].list;
      for (let j = 0; j < list.length; j++) {
        const obj = list[j];
        if (!pointHitsLinkable(wx, wy, kind, obj, pad)) continue;
        const area =
          kind === 'coin'
            ? Math.PI * Math.pow(Number(obj.r) > 0 ? Number(obj.r) : 14, 2)
            : Math.max(1, (obj.w || 1) * (obj.h || 1));
        const dist =
          kind === 'coin'
            ? Math.hypot(wx - obj.x, wy - obj.y)
            : Math.hypot(wx - (obj.x + obj.w / 2), wy - (obj.y + obj.h / 2));
        const score = area + dist * 0.25;
        if (score < bestScore) {
          bestScore = score;
          best = { kind: kind, index: j, obj: obj };
        }
      }
    }
    return best;
  }

  function addFireballEmitter(wx, wy, d) {
    const w = d.worldW;
    const h = d.worldH;
    const dL = wx;
    const dR = w - wx;
    const dT = wy;
    const dB = h - wy;
    const m = Math.min(dL, dR, dT, dB);
    let from = 'left';
    let pos = wy;
    if (m === dR) {
      from = 'right';
      pos = wy;
    } else if (m === dT) {
      from = 'top';
      pos = wx;
    } else if (m === dB) {
      from = 'bottom';
      pos = wx;
    }
    pos = from === 'left' || from === 'right' ? Math.max(64, Math.min(h - 64, pos)) : Math.max(64, Math.min(w - 64, pos));
    d.fireballEmitters.push({ from, pos, speed: 300, jitter: 48 });
  }

  function rotatePlatform90(p) {
    const cx = p.x + p.w / 2;
    const cy = p.y + p.h / 2;
    const nw = p.h;
    const nh = p.w;
    p.w = nw;
    p.h = nh;
    p.x = cx - nw / 2;
    p.y = cy - nh / 2;
  }

  function drawEditor(canvas, ctx) {
    const d = editorState.data;
    if (!d) {
      syncEditorCanvasLayout();
      const cw0 = Math.max(1, canvas.width || 400);
      const ch0 = Math.max(1, canvas.height || 240);
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw0, ch0);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, cw0, ch0);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '14px sans-serif';
      ctx.fillText('No level data', 12, 28);
      return;
    }
    normalizeEditorLevelInPlace(d);

    if (!canvas.width || !canvas.height || canvas.width < 32 || canvas.height < 32) {
      syncEditorCanvasLayout();
    }

    const cw = Math.max(1, canvas.width || canvas.clientWidth || 1);
    const ch = Math.max(1, canvas.height || canvas.clientHeight || 1);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, cw, ch);

    fitCam(canvas, d.worldW, d.worldH);

    const p0 = toScreen(0, 0);
    const p1 = toScreen(d.worldW, d.worldH);
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.lineWidth = 1;
    for (let gx = 0; gx <= d.worldW; gx += 40) {
      const a = toScreen(gx, 0);
      const b = toScreen(gx, d.worldH);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (let gy = 0; gy <= d.worldH; gy += 40) {
      const a = toScreen(0, gy);
      const b = toScreen(d.worldW, gy);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    ctx.fillStyle = validHexColor(d.bgColor) || '#1e1b4b';
    ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);

    function paintEditorRect(obj, x, y, w, h, fallback, stroke) {
      ctx.save();
      if (obj && obj.invisible) ctx.globalAlpha = 0.3;
      ctx.fillStyle = editorFill(obj, fallback);
      ctx.fillRect(x, y, w, h);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      }
      if (obj && obj.invisible) {
        ctx.globalAlpha = 0.95;
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(248,250,252,0.8)';
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.setLineDash([]);
        if (h > 10 && w > 20) {
          ctx.fillStyle = 'rgba(248,250,252,0.92)';
          ctx.font = `${Math.max(8, 9 * cam.s)}px sans-serif`;
          ctx.fillText('inv', x + 3, y + Math.min(12, h - 2));
        }
      }
      ctx.restore();
    }

    function drawEditorEntityAt(kind, obj, wx, wy, alpha) {
      if (!obj) return;
      ctx.save();
      ctx.globalAlpha *= alpha;
      const a = toScreen(wx, wy);
      if (kind === 'coin') {
        const r = (Number(obj.r) > 0 ? Number(obj.r) : 14) * cam.s;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
        ctx.fillStyle = editorFill(obj, 'rgba(251, 191, 36, 0.95)');
        ctx.fill();
        ctx.strokeStyle = editorFill(obj, '#f59e0b');
        ctx.stroke();
      } else if (kind === 'portal') {
        const pw = obj.w * cam.s;
        const ph = obj.h * cam.s;
        ctx.fillStyle = editorFill(obj, '#059669');
        ctx.beginPath();
        ctx.ellipse(a.x + pw / 2, a.y + ph / 2, Math.max(4, pw / 2), Math.max(4, ph / 2), 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#6ee7b7';
        ctx.lineWidth = 2;
        ctx.stroke();
        const da = toScreen(wx + Number(obj.destOx || 0), wy + Number(obj.destOy || 0));
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.arc(da.x, da.y, Math.max(4, 5 * cam.s), 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 'spike') {
        const swid = obj.w * cam.s;
        const sh = obj.h * cam.s;
        ctx.fillStyle = editorFill(obj, '#9f1239');
        fillSpikeTeeth(ctx, a.x, a.y, swid, sh, obj.rot);
      } else if (kind === 'blackout') {
        paintEditorRect(obj, a.x, a.y, obj.w * cam.s, obj.h * cam.s, '#111827', 'rgba(226,232,240,0.7)');
      } else if (kind === 'gravity') {
        const swid = obj.w * cam.s;
        const sh = obj.h * cam.s;
        const fill = editorFill(obj, '#fbbf24');
        ctx.fillStyle = fill;
        ctx.fillRect(a.x, a.y, swid, sh);
        ctx.strokeStyle = fill;
        ctx.strokeRect(a.x + 0.5, a.y + 0.5, swid - 1, sh - 1);
        const cx = a.x + swid / 2;
        const down = obj.targetDir > 0;
        const pad = Math.max(4, Math.min(swid, sh) * 0.16);
        ctx.fillStyle = '#fde68a';
        ctx.beginPath();
        if (down) {
          ctx.moveTo(cx, a.y + sh - pad);
          ctx.lineTo(a.x + pad, a.y + pad);
          ctx.lineTo(a.x + swid - pad, a.y + pad);
        } else {
          ctx.moveTo(cx, a.y + pad);
          ctx.lineTo(a.x + pad, a.y + sh - pad);
          ctx.lineTo(a.x + swid - pad, a.y + sh - pad);
        }
        ctx.closePath();
        ctx.fill();
      } else if (kind === 'lava') {
        paintEditorRect(obj, a.x, a.y, obj.w * cam.s, obj.h * cam.s, '#ea580c', 'rgba(254, 215, 170, 0.45)');
      } else if (kind === 'mover') {
        const fallback = obj.move && obj.move.axis === 'y' ? '#0891b2' : '#4f46e5';
        paintEditorRect(obj, a.x, a.y, obj.w * cam.s, obj.h * cam.s, fallback, 'rgba(251, 191, 36, 0.9)');
      } else {
        paintEditorRect(
          obj,
          a.x,
          a.y,
          (obj.w || 20) * cam.s,
          (obj.h || 20) * cam.s,
          defaultColorForKind(kind),
          'rgba(165,180,252,0.6)'
        );
      }
      ctx.restore();
    }

    for (const L of d.lava) {
      const a = toScreen(L.x, L.y);
      paintEditorRect(L, a.x, a.y, L.w * cam.s, L.h * cam.s, '#ea580c', 'rgba(254, 215, 170, 0.45)');
    }

    for (const s of d.spikes || []) {
      const a = toScreen(s.x, s.y);
      const sw = s.w * cam.s;
      const sh = s.h * cam.s;
      ctx.save();
      if (s.invisible) ctx.globalAlpha = 0.3;
      ctx.fillStyle = editorFill(s, '#9f1239');
      fillSpikeTeeth(ctx, a.x, a.y, sw, sh, s.rot);
      ctx.strokeStyle = s.invisible ? 'rgba(248,250,252,0.8)' : 'rgba(254, 205, 211, 0.45)';
      if (s.invisible) ctx.setLineDash([4, 3]);
      ctx.stroke();
      if (s.invisible && sh > 10 && sw > 20) {
        ctx.globalAlpha = 0.95;
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(248,250,252,0.92)';
        ctx.font = `${Math.max(8, 9 * cam.s)}px sans-serif`;
        ctx.fillText('inv', a.x + 3, a.y + Math.min(12, sh - 2));
      }
      ctx.restore();
    }

    for (const p of d.platforms) {
      const a = toScreen(p.x, p.y);
      paintEditorRect(p, a.x, a.y, p.w * cam.s, p.h * cam.s, '#4338ca', 'rgba(165,180,252,0.6)');
      if (p.move) {
        drawMoverTravel(ctx, p);
        ctx.fillStyle = 'rgba(251,191,36,0.9)';
        ctx.font = `${Math.max(9, 10 * cam.s)}px sans-serif`;
        ctx.fillText(p.move.axis === 'y' ? '↕' : '↔', a.x + 4, a.y + 14 * cam.s);
      }
    }

    for (const p of d.movingPlatforms || []) {
      drawMoverTravel(ctx, p);
      const a = toScreen(p.x, p.y);
      const fallback = p.move && p.move.axis === 'y' ? '#0891b2' : '#4f46e5';
      const stroke = p.move && p.move.axis === 'y' ? 'rgba(34, 211, 238, 0.95)' : 'rgba(251, 191, 36, 0.9)';
      ctx.lineWidth = 2;
      paintEditorRect(p, a.x, a.y, p.w * cam.s, p.h * cam.s, fallback, stroke);
      ctx.lineWidth = 1;
      ctx.fillStyle = '#fde68a';
      ctx.font = `${Math.max(9, 10 * cam.s)}px sans-serif`;
      ctx.fillText(p.move && p.move.axis === 'y' ? '↕' : '↔', a.x + 4, a.y + 14 * cam.s);
    }

    for (const c of d.coins || []) {
      const r = (Number(c.r) > 0 ? Number(c.r) : 14) * cam.s;
      const a = toScreen(c.x, c.y);
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fillStyle = editorFill(c, 'rgba(251, 191, 36, 0.9)');
      ctx.fill();
      ctx.strokeStyle = editorFill(c, '#f59e0b');
      ctx.stroke();
    }

    for (const b of d.blackouts || []) {
      const a = toScreen(b.x, b.y);
      const bw = b.w * cam.s;
      const bh = b.h * cam.s;
      paintEditorRect(b, a.x, a.y, bw, bh, '#111827', 'rgba(226,232,240,0.75)');
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `${Math.max(8, 9 * cam.s)}px sans-serif`;
      ctx.fillText(b.onTouch ? 'BLK tap' : 'BLK', a.x + 3, a.y + Math.min(12, bh - 2));
    }

    for (const garr of d.gravityArrows || []) {
      const a = toScreen(garr.x, garr.y);
      const sw = garr.w * cam.s;
      const sh = garr.h * cam.s;
      ctx.save();
      if (garr.invisible) ctx.globalAlpha = 0.32;
      const fill = editorFill(garr, '#fbbf24');
      ctx.fillStyle = fill;
      ctx.globalAlpha = garr.invisible ? 0.28 : 0.38;
      ctx.fillRect(a.x, a.y, sw, sh);
      ctx.globalAlpha = garr.invisible ? 0.7 : 1;
      ctx.strokeStyle = fill;
      ctx.lineWidth = 2;
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, sw - 1, sh - 1);
      const cx = a.x + sw / 2;
      const down = garr.targetDir > 0;
      const pad = Math.max(4, Math.min(sw, sh) * 0.16);
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      if (down) {
        ctx.moveTo(cx, a.y + sh - pad);
        ctx.lineTo(a.x + pad, a.y + pad);
        ctx.lineTo(a.x + sw - pad, a.y + pad);
      } else {
        ctx.moveTo(cx, a.y + pad);
        ctx.lineTo(a.x + pad, a.y + sh - pad);
        ctx.lineTo(a.x + sw - pad, a.y + sh - pad);
      }
      ctx.closePath();
      ctx.fill();
      if (garr.invisible) {
        ctx.fillStyle = 'rgba(248,250,252,0.92)';
        ctx.font = `${Math.max(8, 9 * cam.s)}px sans-serif`;
        ctx.fillText('inv', a.x + 3, a.y + Math.min(12, sh - 2));
      }
      ctx.restore();
    }

    for (const p of d.portals || []) {
      const a = toScreen(p.x, p.y);
      const pw = p.w * cam.s;
      const ph = p.h * cam.s;
      ctx.save();
      if (p.invisible) ctx.globalAlpha = 0.32;
      ctx.fillStyle = editorFill(p, '#059669');
      ctx.globalAlpha = p.invisible ? 0.28 : 0.55;
      ctx.beginPath();
      ctx.ellipse(a.x + pw / 2, a.y + ph / 2, Math.max(4, pw / 2), Math.max(4, ph / 2), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = p.invisible ? 0.8 : 1;
      ctx.strokeStyle = '#6ee7b7';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = '#ecfdf5';
      ctx.font = `${Math.max(8, 9 * cam.s)}px sans-serif`;
      ctx.fillText('Portal', a.x + 4, a.y + Math.min(14, ph - 2));
      ctx.restore();
    }

    for (const sw of d.switches || []) {
      const a = toScreen(sw.x, sw.y);
      paintEditorRect(sw, a.x, a.y, sw.w * cam.s, sw.h * cam.s, '#65a30d', 'rgba(190, 242, 100, 0.9)');
      ctx.fillStyle = '#ecfccb';
      ctx.font = `${Math.max(8, 9 * cam.s)}px sans-serif`;
      ctx.fillText('Sw', a.x + 3, a.y + Math.min(12, sw.h * cam.s - 2));
    }

    for (const sw of d.switches || []) {
      if (!sw.targetId) continue;
      const linked = findObjById(d, sw.targetId);
      if (!linked || !linked.obj) continue;
      const t = linked.obj;
      const gx = (t.x || 0) + Number(sw.moveX || 0);
      const gy = (t.y || 0) + Number(sw.moveY || 0);
      const selectedSw = editorSelection && editorSelection.kind === 'switch' && d.switches[editorSelection.index] === sw;
      drawEditorEntityAt(linked.kind, t, gx, gy, selectedSw ? 0.5 : 0.38);
      const from = toScreen(t.x, t.y);
      const to = toScreen(gx, gy);
      ctx.save();
      ctx.strokeStyle = selectedSw ? 'rgba(190, 242, 100, 0.9)' : 'rgba(163, 230, 53, 0.55)';
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(from.x + ((t.w || 0) * cam.s) / 2, from.y + ((t.h || 0) * cam.s) / 2);
      ctx.lineTo(to.x + ((t.w || 0) * cam.s) / 2, to.y + ((t.h || 0) * cam.s) / 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    const gg = d.goal;
    const ga = toScreen(gg.x, gg.y);
    paintEditorRect(gg, ga.x, ga.y, gg.w * cam.s, gg.h * cam.s, '#34d399', '#6ee7b7');
    ctx.fillStyle = gg.invisible ? 'rgba(248,250,252,0.85)' : '#a7f3d0';
    ctx.font = `${Math.max(10, 12 * cam.s)}px sans-serif`;
    ctx.fillText(gg.invisible ? 'Goal (inv)' : 'Goal', ga.x + 4, ga.y + 18 * cam.s);

    const sp = d.spawn;
    const sa = toScreen(sp.x, sp.y);
    ctx.beginPath();
    ctx.fillStyle = '#38bdf8';
    ctx.arc(sa.x, sa.y, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e0f2fe';
    ctx.fillText('Spawn', sa.x - 24, sa.y - 16);

    let ei = 0;
    for (const e of d.fireballEmitters) {
      let cx;
      let cy;
      if (e.from === 'left') {
        cx = 0;
        cy = e.pos;
      } else if (e.from === 'right') {
        cx = d.worldW;
        cy = e.pos;
      } else if (e.from === 'top') {
        cx = e.pos;
        cy = 0;
      } else {
        cx = e.pos;
        cy = d.worldH;
      }
      const pt = toScreen(cx, cy);
      ctx.fillStyle = 'rgba(251,146,60,0.9)';
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffedd5';
      ctx.fillText('FB' + ei++, pt.x + 10, pt.y + 4);
    }

    if (editorSelection) {
      ctx.strokeStyle = '#fbbf24';
      ctx.lineWidth = 2;
      if (editorSelection.kind === 'platform') {
        const p = d.platforms[editorSelection.index];
        const a = toScreen(p.x, p.y);
        ctx.strokeRect(a.x - 2, a.y - 2, p.w * cam.s + 4, p.h * cam.s + 4);
      } else if (editorSelection.kind === 'lava') {
        const L = d.lava[editorSelection.index];
        const a = toScreen(L.x, L.y);
        ctx.strokeRect(a.x - 2, a.y - 2, L.w * cam.s + 4, L.h * cam.s + 4);
      } else if (editorSelection.kind === 'coin') {
        const c = d.coins[editorSelection.index];
        const a = toScreen(c.x, c.y);
        const r = (Number(c.r) > 0 ? Number(c.r) : 14) * cam.s;
        ctx.beginPath();
        ctx.arc(a.x, a.y, r + 3, 0, Math.PI * 2);
        ctx.stroke();
      } else if (editorSelection.kind === 'mover') {
        const p = d.movingPlatforms[editorSelection.index];
        const a = toScreen(p.x, p.y);
        ctx.strokeRect(a.x - 2, a.y - 2, p.w * cam.s + 4, p.h * cam.s + 4);
      } else if (editorSelection.kind === 'spike') {
        const s = d.spikes[editorSelection.index];
        const a = toScreen(s.x, s.y);
        ctx.strokeRect(a.x - 2, a.y - 2, s.w * cam.s + 4, s.h * cam.s + 4);
      } else if (editorSelection.kind === 'goal') {
        ctx.strokeRect(ga.x - 2, ga.y - 2, gg.w * cam.s + 4, gg.h * cam.s + 4);
      } else if (editorSelection.kind === 'gravity') {
        const gv = d.gravityArrows[editorSelection.index];
        const a = toScreen(gv.x, gv.y);
        ctx.strokeRect(a.x - 2, a.y - 2, gv.w * cam.s + 4, gv.h * cam.s + 4);
      } else if (editorSelection.kind === 'portal') {
        const p = d.portals[editorSelection.index];
        const a = toScreen(p.x, p.y);
        ctx.strokeRect(a.x - 2, a.y - 2, p.w * cam.s + 4, p.h * cam.s + 4);
        const dest = portalDest(p);
        const da = toScreen(dest.x, dest.y);
        ctx.save();
        ctx.strokeStyle = 'rgba(74, 222, 128, 0.75)';
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(a.x + (p.w * cam.s) / 2, a.y + (p.h * cam.s) / 2);
        ctx.lineTo(da.x, da.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#4ade80';
        ctx.beginPath();
        ctx.arc(da.x, da.y, Math.max(5, 6 * cam.s), 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#bbf7d0';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
      } else if (editorSelection.kind === 'switch') {
        const sw = d.switches[editorSelection.index];
        const a = toScreen(sw.x, sw.y);
        ctx.strokeRect(a.x - 2, a.y - 2, sw.w * cam.s + 4, sw.h * cam.s + 4);
        if (sw.targetId) {
          const linked = findObjById(d, sw.targetId);
          if (linked && linked.obj) {
            const t = linked.obj;
            const ta = toScreen(t.x, t.y);
            ctx.save();
            ctx.strokeStyle = switchLinkMode ? '#fde047' : 'rgba(163, 230, 53, 0.95)';
            ctx.setLineDash([5, 4]);
            ctx.beginPath();
            ctx.moveTo(a.x + (sw.w * cam.s) / 2, a.y + (sw.h * cam.s) / 2);
            ctx.lineTo(ta.x + ((t.w || 20) * cam.s) / 2, ta.y + ((t.h || 20) * cam.s) / 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
          }
        }
      } else if (editorSelection.kind === 'blackout') {
        const b = d.blackouts[editorSelection.index];
        const a = toScreen(b.x, b.y);
        ctx.strokeRect(a.x - 2, a.y - 2, b.w * cam.s + 4, b.h * cam.s + 4);
      }
    }

    if (switchLinkMode && switchLinkHover) {
      const hov = objectFromSel(d, switchLinkHover);
      if (hov) {
        ctx.save();
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 3;
        if (switchLinkHover.kind === 'coin') {
          const r = (Number(hov.r) > 0 ? Number(hov.r) : 14) * cam.s;
          const a = toScreen(hov.x, hov.y);
          ctx.beginPath();
          ctx.arc(a.x, a.y, r + 4, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          const a = toScreen(hov.x, hov.y);
          ctx.strokeRect(a.x - 3, a.y - 3, (hov.w || 20) * cam.s + 6, (hov.h || 20) * cam.s + 6);
        }
        ctx.restore();
      }
    }

    if (editorTool === 'eraser' && eraserHover) {
      const cut = eraserStampAt(eraserHover.x, eraserHover.y);
      const a = toScreen(cut.x, cut.y);
      ctx.save();
      ctx.fillStyle = 'rgba(251,113,133,0.22)';
      ctx.strokeStyle = 'rgba(254,205,211,0.95)';
      ctx.setLineDash([4, 3]);
      ctx.fillRect(a.x, a.y, cut.w * cam.s, cut.h * cam.s);
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, cut.w * cam.s - 1, cut.h * cam.s - 1);
      ctx.restore();
    }

    if (editorHover && editorHover.text) {
      const a = toScreen(editorHover.x, editorHover.y);
      ctx.save();
      ctx.font = '12px ui-monospace, monospace';
      const pad = 6;
      const tw = ctx.measureText(editorHover.text).width;
      const boxW = tw + pad * 2;
      const boxH = 18;
      let lx = a.x + 10;
      let ly = a.y - boxH - 8;
      if (lx + boxW > cw - 4) lx = Math.max(4, cw - boxW - 4);
      if (ly < 4) ly = Math.min(ch - boxH - 4, a.y + 12);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.94)';
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
      ctx.fillRect(lx, ly, boxW, boxH);
      ctx.strokeRect(lx + 0.5, ly + 0.5, boxW - 1, boxH - 1);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillText(editorHover.text, lx + pad, ly + 13);
      ctx.restore();
    }
  }

  function hoverLabelFor(d, hit) {
    if (!d || !hit) return null;
    const obj = hit.kind === 'spawn' ? d.spawn : objectFromSel(d, hit);
    if (!obj) return null;
    const center = window.SkyHopSpl
      ? window.SkyHopSpl.objectCenter(d, hit.kind, obj)
      : { x: obj.x, y: obj.y };
    if (!center) return null;
    const fmt = window.SkyHopSpl ? window.SkyHopSpl.formatCoord : String;
    const id = obj.id != null && obj.id !== '' ? ' ' + obj.id : '';
    const sid = obj.sid != null && obj.sid !== '' ? ' · script id ' + obj.sid : '';
    const togNote = obj.affectByToggle
      ? Number(obj.defaultToggleState) === 0
        ? ' · toggle, starts absent'
        : ' · toggle, starts there'
      : '';
    return {
      x: center.x,
      y: center.y,
      text: hit.kind + id + sid + togNote + ' · Center: (' + fmt(center.x) + ', ' + fmt(center.y) + ')',
    };
  }

  function updateEditorHover(w) {
    const d = editorState.data;
    const next = d && w ? hoverLabelFor(d, hitTest(w.x, w.y, d)) : null;
    const prev = editorHover && editorHover.text;
    const now = next && next.text;
    editorHover = next;
    return prev !== now;
  }

  function editorHasRainbow() {
    const d = editorState.data;
    if (!d) return false;
    const lists = [
      d.platforms,
      d.spikes,
      d.lava,
      d.movingPlatforms,
      d.gravityArrows,
      d.portals,
      d.switches,
      d.blackouts,
      d.coins,
      d.goal ? [d.goal] : [],
    ];
    for (let i = 0; i < lists.length; i++) {
      const list = lists[i];
      if (!list) continue;
      for (let j = 0; j < list.length; j++) {
        if (list[j] && list[j].rainbow) return true;
      }
    }
    return false;
  }

  let editorRedrawScheduled = false;
  function scheduleEditorRedraw() {
    const canvas = document.getElementById('lvlEditorCanvas');
    const ctx = canvas && canvas.getContext('2d');
    if (!canvas || !ctx) return;
    if (editorRedrawScheduled) return;
    editorRedrawScheduled = true;
    requestAnimationFrame(() => {
      try {
        drawEditor(canvas, ctx);
        syncMoverInspector();
        syncGravityInspector();
        syncPortalInspector();
        syncSwitchInspector();
        syncBlackoutInspector();
        syncSizeInspector();
        syncStageFlagsUi();
        syncAppearanceUi();
      } finally {
        editorRedrawScheduled = false;
        if (editorHasRainbow()) scheduleEditorRedraw();
      }
    });
  }

  function bindEditorCanvas() {
    const canvas = document.getElementById('lvlEditorCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    function onResize() {
      syncEditorCanvasLayout();
      scheduleEditorRedraw();
    }
    onResize();
    window.addEventListener('resize', onResize);

    function localXY(ev) {
      const r = canvas.getBoundingClientRect();
      const clientX = ev.clientX ?? ev.touches?.[0]?.clientX;
      const clientY = ev.clientY ?? ev.touches?.[0]?.clientY;
      const sx = canvas.width / Math.max(1, r.width);
      const sy = canvas.height / Math.max(1, r.height);
      return { x: (clientX - r.left) * sx, y: (clientY - r.top) * sy };
    }

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('touchstart', (e) => onDown(e), { passive: false });

    function onDown(e) {
      if (!editorState.data) return;
      normalizeEditorLevelInPlace(editorState.data);
      e.preventDefault();
      fitCam(canvas, editorState.data.worldW, editorState.data.worldH);
      const { x, y } = localXY(e);
      const w = toWorld(x, y);
      const d = editorState.data;
      eraserHover = w;

      if (switchLinkMode && selectedSwitch()) {
        const sw = selectedSwitch();
        const hit = hitTestLinkable(w.x, w.y, d);
        if (hit && hit.obj) {
          sw.targetId = ensureObjId(d, hit.obj);
          switchLinkMode = false;
          switchLinkHover = null;
          if (lvlEdStatus) {
            lvlEdStatus.textContent = 'Switch linked. The faded copy is where it moves. Set Move X / Move Y.';
          }
        } else if (lvlEdStatus) {
          lvlEdStatus.textContent = 'Click a block, mover, or portal (not the switch).';
        }
        scheduleEditorRedraw();
        return;
      }

      const selPortal = selectedPortal();
      if (selPortal && portalDestHit(w.x, w.y, selPortal)) {
        editorSelection = { kind: 'portal', index: editorSelection.index };
        drag = { sel: { kind: 'portal-dest', index: editorSelection.index }, last: w };
        canvas.style.cursor = 'grabbing';
        scheduleEditorRedraw();
        return;
      }

      if (editorTool === 'eraser') {
        eraserDrag = true;
        eraseAt(w.x, w.y);
        scheduleEditorRedraw();
        return;
      }

      if (selectedContainsPoint(w.x, w.y)) {
        beginMoveDrag(w);
        canvas.style.cursor = 'grabbing';
        scheduleEditorRedraw();
        return;
      }

      if (editorTool === 'select') {
        editorSelection = hitTest(w.x, w.y, d);
        if (editorSelection) {
          beginMoveDrag(w);
          canvas.style.cursor = 'grabbing';
        } else {
          drag = null;
        }
        scheduleEditorRedraw();
        return;
      }

      editorSelection = null;
      if (editorTool === 'platform') {
        d.platforms.push(
          withPaint({
            id: nextEditorId(d),
            x: Math.round((w.x - 24) / 8) * 8,
            y: Math.round((w.y - 12) / 8) * 8,
            w: 48,
            h: 24,
          })
        );
        editorSelection = { kind: 'platform', index: d.platforms.length - 1 };
      } else if (editorTool === 'lava') {
        d.lava.push(
          withPaint({
            id: nextEditorId(d),
            x: Math.round((w.x - 80) / 8) * 8,
            y: Math.round((w.y - 20) / 8) * 8,
            w: 160,
            h: 40,
          })
        );
        editorSelection = { kind: 'lava', index: d.lava.length - 1 };
      } else if (editorTool === 'fireball') {
        addFireballEmitter(w.x, w.y, d);
      } else if (editorTool === 'spawn') {
        d.spawn.x = Math.round(w.x / 4) * 4;
        d.spawn.y = Math.round(w.y / 4) * 4;
      } else if (editorTool === 'goal') {
        d.goal.x = Math.round((w.x - d.goal.w / 2) / 4) * 4;
        d.goal.y = Math.round((w.y - d.goal.h / 2) / 4) * 4;
        withPaint(d.goal);
      } else if (editorTool === 'coin') {
        if (!d.coins) d.coins = [];
        d.coins.push({ id: nextEditorId(d), x: Math.round(w.x / 4) * 4, y: Math.round(w.y / 4) * 4, r: 14 });
        editorSelection = { kind: 'coin', index: d.coins.length - 1 };
      } else if (editorTool === 'spike') {
        if (!d.spikes) d.spikes = [];
        d.spikes.push(
          withPaint({
            id: nextEditorId(d),
            x: Math.round((w.x - 20) / 8) * 8,
            y: Math.round((w.y - 16) / 8) * 8,
            w: 40,
            h: 32,
          })
        );
        editorSelection = { kind: 'spike', index: d.spikes.length - 1 };
      } else if (editorTool === 'mover' || editorTool === 'mover-y') {
        if (!d.movingPlatforms) d.movingPlatforms = [];
        d.movingPlatforms.push(
          withPaint({
            id: nextEditorId(d),
            x: Math.round((w.x - 40) / 8) * 8,
            y: Math.round((w.y - 10) / 8) * 8,
            w: 80,
            h: 20,
            move: { axis: editorTool === 'mover-y' ? 'y' : 'x', amp: 80, omega: 1, phase: 0 },
          })
        );
        editorSelection = { kind: 'mover', index: d.movingPlatforms.length - 1 };
      } else if (editorTool === 'gravity') {
        if (!d.gravityArrows) d.gravityArrows = [];
        d.gravityArrows.push(
          withPaint({
            id: nextEditorId(d),
            x: Math.round((w.x - 20) / 8) * 8,
            y: Math.round((w.y - 32) / 8) * 8,
            w: 40,
            h: 64,
            targetDir: -1,
          })
        );
        editorSelection = { kind: 'gravity', index: d.gravityArrows.length - 1 };
      } else if (editorTool === 'portal') {
        if (!d.portals) d.portals = [];
        const pw = ED_BLOCK_W;
        const ph = ED_BLOCK_W;
        d.portals.push(
          withPaint({
            id: nextEditorId(d),
            x: Math.round((w.x - pw / 2) / 8) * 8,
            y: Math.round((w.y - ph / 2) / 8) * 8,
            w: pw,
            h: ph,
            destOx: Math.round(pw / 2),
            destOy: PORTAL_DEST_DEFAULT_OY,
          })
        );
        editorSelection = { kind: 'portal', index: d.portals.length - 1 };
      } else if (editorTool === 'switch') {
        if (!d.switches) d.switches = [];
        d.switches.push(
          withPaint({
            id: nextEditorId(d),
            x: Math.round((w.x - 20) / 8) * 8,
            y: Math.round((w.y - 8) / 8) * 8,
            w: 40,
            h: 16,
            moveX: ED_BLOCK_W,
            moveY: 0,
          })
        );
        editorSelection = { kind: 'switch', index: d.switches.length - 1 };
      } else if (editorTool === 'blackout') {
        if (!d.blackouts) d.blackouts = [];
        d.blackouts.push(
          withPaint({
            id: nextEditorId(d),
            x: Math.round((w.x - 20) / 8) * 8,
            y: Math.round((w.y - 20) / 8) * 8,
            w: 40,
            h: 40,
            blackSec: 3,
            afterSec: 2,
            onTouch: true,
          })
        );
        editorSelection = { kind: 'blackout', index: d.blackouts.length - 1 };
      }
      scheduleEditorRedraw();
    }

    function pointerOnCanvas(e) {
      const r = canvas.getBoundingClientRect();
      const cx = e.clientX ?? e.touches?.[0]?.clientX;
      const cy = e.clientY ?? e.touches?.[0]?.clientY;
      return cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom;
    }

    function editorHoverCursor(w) {
      if (editorTool === 'eraser') return 'crosshair';
      if (switchLinkMode) return 'copy';
      const p = selectedPortal();
      if (p && portalDestHit(w.x, w.y, p)) return 'grab';
      if (selectedContainsPoint(w.x, w.y)) return 'grab';
      return editorTool === 'select' ? 'default' : 'crosshair';
    }

    function onMove(e) {
      const { x, y } = localXY(e);
      const w = toWorld(x, y);
      const onCanvas = pointerOnCanvas(e);
      if (updateEditorHover(onCanvas ? w : null)) scheduleEditorRedraw();
      if (switchLinkMode && editorState.data) {
        if (pointerOnCanvas(e)) {
          const hit = hitTestLinkable(w.x, w.y, editorState.data);
          const key = hit ? hit.kind + ':' + hit.index : '';
          const prev = switchLinkHover ? switchLinkHover.kind + ':' + switchLinkHover.index : '';
          switchLinkHover = hit ? { kind: hit.kind, index: hit.index } : null;
          canvas.style.cursor = hit ? 'pointer' : 'copy';
          if (key !== prev) scheduleEditorRedraw();
        }
        return;
      }
      if (editorTool === 'eraser') {
        if (pointerOnCanvas(e) || eraserDrag) {
          eraserHover = w;
          if (eraserDrag) eraseAt(w.x, w.y);
          scheduleEditorRedraw();
        } else if (eraserHover) {
          eraserHover = null;
          scheduleEditorRedraw();
        }
        canvas.style.cursor = 'crosshair';
        if (!drag) return;
      }
      if (!drag || !editorState.data) {
        if (onCanvas) canvas.style.cursor = editorHoverCursor(w);
        return;
      }
      canvas.style.cursor = 'grabbing';
      const d = editorState.data;
      const dx = w.x - drag.last.x;
      const dy = w.y - drag.last.y;
      drag.last = w;
      if (drag.sel.kind === 'platform') {
        const p = d.platforms[drag.sel.index];
        p.x += dx;
        p.y += dy;
      } else if (drag.sel.kind === 'lava') {
        const L = d.lava[drag.sel.index];
        L.x += dx;
        L.y += dy;
      } else if (drag.sel.kind === 'goal') {
        d.goal.x += dx;
        d.goal.y += dy;
      } else if (drag.sel.kind === 'spawn') {
        d.spawn.x += dx;
        d.spawn.y += dy;
      } else if (drag.sel.kind === 'fireball') {
        const em = d.fireballEmitters[drag.sel.index];
        if (em.from === 'left' || em.from === 'right') em.pos += dy;
        else em.pos += dx;
      } else if (drag.sel.kind === 'coin') {
        const c = d.coins[drag.sel.index];
        c.x += dx;
        c.y += dy;
      } else if (drag.sel.kind === 'mover') {
        const p = d.movingPlatforms[drag.sel.index];
        p.x += dx;
        p.y += dy;
      } else if (drag.sel.kind === 'spike') {
        const s = d.spikes[drag.sel.index];
        s.x += dx;
        s.y += dy;
      } else if (drag.sel.kind === 'gravity') {
        const a = d.gravityArrows[drag.sel.index];
        a.x += dx;
        a.y += dy;
      } else if (drag.sel.kind === 'portal') {
        const p = d.portals[drag.sel.index];
        p.x += dx;
        p.y += dy;
      } else if (drag.sel.kind === 'portal-dest') {
        const p = d.portals[drag.sel.index];
        p.destOx += dx;
        p.destOy += dy;
      } else if (drag.sel.kind === 'switch') {
        const sw = d.switches[drag.sel.index];
        sw.x += dx;
        sw.y += dy;
      } else if (drag.sel.kind === 'blackout') {
        const b = d.blackouts[drag.sel.index];
        b.x += dx;
        b.y += dy;
      }
      updateEditorHover(onCanvas ? w : null);
      scheduleEditorRedraw();
    }

    function onUp() {
      if (drag) snapDraggedObject();
      drag = null;
      eraserDrag = false;
      scheduleEditorRedraw();
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchmove', (e) => onMove(e), { passive: false });
    canvas.addEventListener('touchend', onUp);
    canvas.addEventListener('mouseleave', () => {
      if (eraserDrag) return;
      const hadEraser = !!eraserHover;
      if (eraserHover) eraserHover = null;
      const hoverChanged = updateEditorHover(null);
      if (hadEraser || hoverChanged) scheduleEditorRedraw();
    });
  }

  /* ---------- Screens ---------- */
  const mineEl = document.getElementById('screenLevelsMine');
  const onlineEl = document.getElementById('screenLevelsOnline');
  const awardedEl = document.getElementById('screenAwardedLevels');
  const awardedList = document.getElementById('awardedLevelsList');
  const awardedPager = document.getElementById('awardedLevelsPager');
  let onlineIsOwner = false;
  let awardedPage = 1;
  const editorScreen = document.getElementById('screenLevelEditor');
  const mineList = document.getElementById('levelsMineList');
  const mineErr = document.getElementById('levelsMineErr');
  const minePanelLevels = document.getElementById('levelsMinePanelLevels');
  const minePanelRecordings = document.getElementById('levelsMinePanelRecordings');
  const minePanelLogs = document.getElementById('levelsMinePanelLogs');
  const mineTabLevels = document.getElementById('mineTabLevels');
  const mineTabRecordings = document.getElementById('mineTabRecordings');
  const mineTabLogs = document.getElementById('mineTabLogs');
  const levelsMineSignIn = document.getElementById('levelsMineSignIn');
  const levelsRecordingsList = document.getElementById('levelsRecordingsList');
  const levelsRecordingsErr = document.getElementById('levelsRecordingsErr');
  const levelsInputLogsList = document.getElementById('levelsInputLogsList');
  const levelsInputLogsErr = document.getElementById('levelsInputLogsErr');
  let mineActiveTab = 'levels';
  const recordingObjectUrls = [];
  const onlineList = document.getElementById('lvlOnlineList');
  const onlinePager = document.getElementById('lvlOnlinePager');
  const onlineUserPanel = document.getElementById('lvlOnlineUserPanel');
  const lvlEdStatus = document.getElementById('lvlEdStatus');

  function levelsOverlayOpen() {
    const ids = ['screenLevelEditor', 'screenLevelsMine', 'screenLevelsOnline', 'screenAwardedLevels'];
    for (let i = 0; i < ids.length; i++) {
      const el = document.getElementById(ids[i]);
      if (el && !el.classList.contains('hidden')) return true;
    }
    return false;
  }

  function unhideMainMenu() {
    const menu = document.getElementById('screenMenu');
    if (!menu) return;
    menu.classList.remove('hidden');
    menu.classList.add('flex');
  }

  function revealMainMenuIfIdle() {
    if (levelsOverlayOpen()) {
      unhideMainMenu();
      return;
    }
    if (window.SKYHOP && typeof window.SKYHOP.goToMenu === 'function') {
      window.SKYHOP.goToMenu();
      return;
    }
    unhideMainMenu();
  }

  function showMine(on) {
    if (!mineEl) return;
    mineEl.classList.toggle('hidden', !on);
    if (!on) revokeRecordingUrls();
  }

  function showOnline(on) {
    if (!onlineEl) return;
    onlineEl.classList.toggle('hidden', !on);
    if (on) onlineEl.classList.add('flex');
    else onlineEl.classList.remove('flex');
  }

  function showAwarded(on) {
    if (!awardedEl) return;
    awardedEl.classList.toggle('hidden', !on);
    if (on) awardedEl.classList.add('flex');
    else awardedEl.classList.remove('flex');
  }

  function refreshOnlineOwner() {
    onlineIsOwner = false;
    if (!hasAuth()) return Promise.resolve();
    return api('/api/me')
      .then(function (me) {
        onlineIsOwner = !!(me && me.role === 'owner');
        if (onlineCtx && (onlineCtx.username || onlineCtx.titleQ || onlineCtx.idQ)) fetchOnlineList();
      })
      .catch(function () {
        onlineIsOwner = false;
      });
  }

  function fetchAwardedList() {
    if (!awardedList) return;
    awardedList.innerHTML = '';
    api('/api/levels/awarded?page=' + encodeURIComponent(String(awardedPage)), { noAuth: true })
      .then(function (out) {
        const total = out.total || 0;
        const page = out.page || 1;
        const pages = Math.max(1, Math.ceil(total / 12));
        if (awardedPager) {
          awardedPager.innerHTML = '';
          const prev = document.createElement('button');
          prev.type = 'button';
          prev.className = 'rounded-lg border border-white/15 px-3 py-1 text-xs hover:bg-white/10';
          prev.textContent = 'Prev';
          prev.disabled = page <= 1;
          const next = document.createElement('button');
          next.type = 'button';
          next.className = 'rounded-lg border border-white/15 px-3 py-1 text-xs hover:bg-white/10';
          next.textContent = 'Next';
          next.disabled = page >= pages;
          const lab = document.createElement('span');
          lab.className = 'text-xs text-slate-400';
          lab.textContent = 'Page ' + page + ' / ' + pages;
          prev.addEventListener('click', function () {
            awardedPage = Math.max(1, page - 1);
            fetchAwardedList();
          });
          next.addEventListener('click', function () {
            awardedPage = Math.min(pages, page + 1);
            fetchAwardedList();
          });
          awardedPager.appendChild(prev);
          awardedPager.appendChild(lab);
          awardedPager.appendChild(next);
        }
        const items = out.items || [];
        if (!items.length) {
          const li = document.createElement('li');
          li.className = 'text-sm text-slate-400';
          li.textContent = 'No awarded levels yet.';
          awardedList.appendChild(li);
          return;
        }
        for (let i = 0; i < items.length; i++) {
          awardedList.appendChild(
            rowOnlineItem(items[i].title, items[i].id, items[i].play_count, {
              author: items[i].author_username || '—',
              authorRole: items[i].author_role || 'player',
              awarded: true,
              canAward: false,
              returnTo: 'awarded',
            })
          );
        }
      })
      .catch(function (err) {
        const li = document.createElement('li');
        li.className = 'text-sm text-rose-300';
        li.textContent = String(err.message || err);
        awardedList.appendChild(li);
      });
  }

  function showEditorScreen(on) {
    if (!editorScreen) return;
    editorScreen.classList.toggle('hidden', !on);
    if (on) {
      syncEditorCanvasLayout();
      scheduleEditorRedraw();
      requestAnimationFrame(() => {
        syncEditorCanvasLayout();
        scheduleEditorRedraw();
      });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          syncEditorCanvasLayout();
          scheduleEditorRedraw();
        });
      });
    }
  }

  function revokeRecordingUrls() {
    for (let i = 0; i < recordingObjectUrls.length; i++) {
      try {
        URL.revokeObjectURL(recordingObjectUrls[i]);
      } catch {
        /* ignore */
      }
    }
    recordingObjectUrls.length = 0;
  }

  function setMineTab(tab) {
    mineActiveTab = tab === 'recordings' ? 'recordings' : tab === 'logs' ? 'logs' : 'levels';
    if (minePanelLevels) minePanelLevels.classList.toggle('hidden', mineActiveTab !== 'levels');
    if (minePanelRecordings) minePanelRecordings.classList.toggle('hidden', mineActiveTab !== 'recordings');
    if (minePanelLogs) minePanelLogs.classList.toggle('hidden', mineActiveTab !== 'logs');
    const btnNew = document.getElementById('btnLevelsNew');
    if (btnNew) btnNew.classList.toggle('hidden', mineActiveTab !== 'levels' || !hasAuth());
    if (mineTabLevels) {
      mineTabLevels.classList.toggle('border-violet-400', mineActiveTab === 'levels');
      mineTabLevels.classList.toggle('bg-violet-600/40', mineActiveTab === 'levels');
      mineTabLevels.classList.toggle('text-white', mineActiveTab === 'levels');
      mineTabLevels.classList.toggle('border-white/15', mineActiveTab !== 'levels');
      mineTabLevels.classList.toggle('bg-slate-900/80', mineActiveTab !== 'levels');
      mineTabLevels.classList.toggle('text-slate-300', mineActiveTab !== 'levels');
    }
    if (mineTabRecordings) {
      mineTabRecordings.classList.toggle('border-violet-400', mineActiveTab === 'recordings');
      mineTabRecordings.classList.toggle('bg-violet-600/40', mineActiveTab === 'recordings');
      mineTabRecordings.classList.toggle('text-white', mineActiveTab === 'recordings');
      mineTabRecordings.classList.toggle('border-white/15', mineActiveTab !== 'recordings');
      mineTabRecordings.classList.toggle('bg-slate-900/80', mineActiveTab !== 'recordings');
      mineTabRecordings.classList.toggle('text-slate-300', mineActiveTab !== 'recordings');
    }
    if (mineTabLogs) {
      mineTabLogs.classList.toggle('border-violet-400', mineActiveTab === 'logs');
      mineTabLogs.classList.toggle('bg-violet-600/40', mineActiveTab === 'logs');
      mineTabLogs.classList.toggle('text-white', mineActiveTab === 'logs');
      mineTabLogs.classList.toggle('border-white/15', mineActiveTab !== 'logs');
      mineTabLogs.classList.toggle('bg-slate-900/80', mineActiveTab !== 'logs');
      mineTabLogs.classList.toggle('text-slate-300', mineActiveTab !== 'logs');
    }
    if (mineActiveTab === 'recordings') void refreshRecordingsList();
    else if (mineActiveTab === 'logs') void refreshInputLogsList();
    else if (mineActiveTab === 'levels') void refreshMineList();
  }

  async function refreshRecordingsList() {
    if (!levelsRecordingsList) return;
    revokeRecordingUrls();
    levelsRecordingsList.innerHTML = '';
    if (levelsRecordingsErr) levelsRecordingsErr.classList.add('hidden');
    if (!hasAuth()) {
      const li = document.createElement('li');
      li.className = 'rounded-xl border border-white/10 bg-slate-900/60 p-4 text-center text-sm text-slate-400';
      li.textContent = 'Sign in to view recordings saved to your account.';
      levelsRecordingsList.appendChild(li);
      return;
    }
    if (!window.SkyHopRecording || typeof window.SkyHopRecording.listClips !== 'function') {
      if (levelsRecordingsErr) {
        levelsRecordingsErr.textContent = 'Recordings are not available yet — reload the page.';
        levelsRecordingsErr.classList.remove('hidden');
      }
      return;
    }
    try {
      const clips = await window.SkyHopRecording.listClips();
      if (!clips.length) {
        const li = document.createElement('li');
        li.className = 'rounded-xl border border-white/10 bg-slate-900/60 p-4 text-center text-sm text-slate-400';
        li.textContent = 'No recordings yet. Play a level and tap Record or Record Run and Input Log in the HUD.';
        levelsRecordingsList.appendChild(li);
        return;
      }
      for (const clip of clips) {
        const li = document.createElement('li');
        li.className = 'rounded-xl border border-white/10 bg-slate-900/80 p-3';
        const when = new Date(clip.created_at || clip.createdAt || Date.now()).toLocaleString();
        let srcLabel =
          clip.source === 'user-level'
            ? 'Online level'
            : clip.source === 'user-test'
              ? 'Level test'
              : clip.source === 'custom'
                ? 'Custom'
                : 'Campaign';
        if (clip.anticheatOn === false || clip.anticheat_on === false) srcLabel += ' · Anti-cheat off';
        li.innerHTML =
          '<div class="mb-2 flex flex-wrap items-center justify-between gap-2">' +
          '<span class="font-sem text-white">' +
          escapeHtml(clip.title || 'Run') +
          '</span>' +
          '<span class="text-xs text-slate-500">' +
          escapeHtml(srcLabel) +
          ' · ' +
          escapeHtml(when) +
          '</span></div>' +
          '<video class="rec-video w-full rounded-lg border border-white/10 bg-black" controls playsinline preload="metadata"></video>' +
          '<p class="rec-load mt-1 text-center text-xs text-slate-500">Loading video…</p>' +
          '<div class="mt-2 flex justify-end gap-2">' +
          '<button type="button" class="rec-rename rounded-lg border border-white/15 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-white/5">Rename</button>' +
          '<button type="button" class="rec-del rounded-lg border border-rose-500/45 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-950/50">Delete</button>' +
          '</div>';
        const videoEl = li.querySelector('.rec-video');
        const loadEl = li.querySelector('.rec-load');
        const playUrl =
          window.SkyHopRecording.videoPlaybackUrl && window.SkyHopRecording.videoPlaybackUrl(clip.id);
        function hideLoad() {
          if (loadEl) loadEl.classList.add('hidden');
        }
        function showLoadErr(err) {
          if (loadEl) loadEl.textContent = String((err && err.message) || err || 'Could not load video');
        }
        if (playUrl && videoEl) {
          videoEl.preload = 'metadata';
          videoEl.src = playUrl;
          videoEl.addEventListener('loadeddata', hideLoad);
          videoEl.addEventListener('error', function () {
            showLoadErr('Could not load video');
          });
        } else {
          void window.SkyHopRecording.fetchVideoBlob(clip.id)
            .then(function (blob) {
              const url = URL.createObjectURL(blob);
              recordingObjectUrls.push(url);
              videoEl.src = url;
              hideLoad();
            })
            .catch(showLoadErr);
        }
        li.querySelector('.rec-rename').addEventListener('click', function () {
          var next = window.prompt('Rename recording', clip.title || 'Run');
          if (next == null) return;
          next = String(next).trim();
          if (!next) {
            window.alert('Enter a name.');
            return;
          }
          void window.SkyHopRecording.renameClip(clip.id, next)
            .then(function () {
              void refreshRecordingsList();
            })
            .catch(function (err) {
              window.alert(String(err.message || err));
            });
        });
        li.querySelector('.rec-del').addEventListener('click', function () {
          if (!window.confirm('Delete this recording?')) return;
          void window.SkyHopRecording.deleteClip(clip.id).then(function () {
            void refreshRecordingsList();
          });
        });
        levelsRecordingsList.appendChild(li);
      }
    } catch (e) {
      if (levelsRecordingsErr) {
        levelsRecordingsErr.textContent = String(e.message || e);
        levelsRecordingsErr.classList.remove('hidden');
      }
    }
  }

  async function refreshInputLogsList() {
    if (!levelsInputLogsList) return;
    levelsInputLogsList.innerHTML = '';
    if (levelsInputLogsErr) levelsInputLogsErr.classList.add('hidden');
    if (!hasAuth()) {
      const li = document.createElement('li');
      li.className = 'rounded-xl border border-white/10 bg-slate-900/60 p-4 text-center text-sm text-slate-400';
      li.textContent = 'Sign in to view input logs saved to your account.';
      levelsInputLogsList.appendChild(li);
      return;
    }
    if (!window.SkyHopInputLog || typeof window.SkyHopInputLog.listLogs !== 'function') {
      if (levelsInputLogsErr) {
        levelsInputLogsErr.textContent = 'Input logs are not available yet — reload the page.';
        levelsInputLogsErr.classList.remove('hidden');
      }
      return;
    }
    try {
      const logs = await window.SkyHopInputLog.listLogs();
      if (!logs.length) {
        const li = document.createElement('li');
        li.className = 'rounded-xl border border-white/10 bg-slate-900/60 p-4 text-center text-sm text-slate-400';
        li.textContent = 'No input logs yet. Play and tap Record Input Log or Record Run and Input Log in the HUD.';
        levelsInputLogsList.appendChild(li);
        return;
      }
      for (const log of logs) {
        const li = document.createElement('li');
        li.className = 'rounded-xl border border-white/10 bg-slate-900/80 p-3';
        const when = new Date(log.created_at || Date.now()).toLocaleString();
        const eventsHint = log.byte_size ? Math.round(Number(log.byte_size) / 40) + ' events (approx)' : '';
        li.innerHTML =
          '<div class="mb-2 flex flex-wrap items-center justify-between gap-2">' +
          '<span class="font-sem text-white">' +
          escapeHtml(log.title || 'Run') +
          '</span>' +
          '<span class="text-xs text-slate-500">' +
          escapeHtml(log.source || '') +
          (log.anticheatOn === false || log.anticheat_on === false ? ' · Anti-cheat off' : '') +
          ' · ' +
          escapeHtml(when) +
          '</span></div>' +
          '<p class="log-preview text-xs text-slate-400">Tap View to load JSON.</p>' +
          '<pre class="log-json mt-2 hidden max-h-40 overflow-auto rounded-lg bg-black/50 p-2 text-[10px] text-emerald-200"></pre>' +
          '<div class="mt-2 flex justify-end gap-2">' +
          '<button type="button" class="log-view rounded-lg border border-white/15 px-2 py-1 text-xs font-semibold text-slate-200 hover:bg-white/5">View</button>' +
          '<button type="button" class="log-del rounded-lg border border-rose-500/45 px-2 py-1 text-xs font-semibold text-rose-100 hover:bg-rose-950/50">Delete</button>' +
          '</div>';
        li.querySelector('.log-view').addEventListener('click', function () {
          const pre = li.querySelector('.log-json');
          void window.SkyHopInputLog.fetchLogJson(log.id)
            .then(function (json) {
              pre.classList.remove('hidden');
              pre.textContent = JSON.stringify(json, null, 2);
              const prev = li.querySelector('.log-preview');
              if (prev) prev.classList.add('hidden');
            })
            .catch(function (err) {
              window.alert(String(err.message || err));
            });
        });
        li.querySelector('.log-del').addEventListener('click', function () {
          if (!window.confirm('Delete this input log?')) return;
          void window.SkyHopInputLog.deleteLog(log.id).then(function () {
            void refreshInputLogsList();
          });
        });
        levelsInputLogsList.appendChild(li);
      }
    } catch (e) {
      if (levelsInputLogsErr) {
        levelsInputLogsErr.textContent = String(e.message || e);
        levelsInputLogsErr.classList.remove('hidden');
      }
    }
  }

  async function refreshMineList() {
    mineErr.classList.add('hidden');
    mineList.innerHTML = '';
    if (levelsMineSignIn) {
      levelsMineSignIn.classList.toggle('hidden', hasAuth());
    }
    if (!hasAuth()) return;
    try {
      const { levels } = await api('/api/levels/mine');
      for (const row of levels || []) {
        const li = document.createElement('li');
        li.className = 'rounded-xl border border-white/10 bg-slate-900/80 p-3 text-sm text-slate-200';
        const status = row.published ? 'Published' : row.beaten_verified ? 'Ready to publish' : 'Draft';
        li.innerHTML =
          '<div class="flex flex-wrap items-center justify-between gap-2">' +
          '<span class="font-sem text-white">' +
          escapeHtml(row.title) +
          '</span>' +
          '<span class="text-xs text-slate-400">' +
          status +
          ' · plays ' +
          (row.play_count || 0) +
          '</span></div>' +
          '<div class="mt-2 flex flex-wrap gap-2">' +
          '<button type="button" class="lvl-row-edit rounded-lg border border-violet-500/50 px-2 py-1 text-xs text-violet-100 hover:bg-violet-950/50" data-id="' +
          row.id +
          '">Edit</button>' +
          '<button type="button" class="lvl-row-race rounded-lg border border-amber-500/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-950/50">Race</button>' +
          '<button type="button" class="lvl-row-collab rounded-lg border border-teal-500/50 px-2 py-1 text-xs text-teal-100 hover:bg-teal-950/50">Collab</button>' +
          '<button type="button" class="lvl-row-delete rounded-lg border border-rose-500/50 px-2 py-1 text-xs text-rose-100 hover:bg-rose-950/50">Delete</button>' +
          '</div>';
        li.querySelector('.lvl-row-edit').addEventListener('click', () => openEditorForId(row.id));
        li.querySelector('.lvl-row-race').addEventListener('click', () => void hostSavedLevel(row.id, 'race'));
        li.querySelector('.lvl-row-collab').addEventListener('click', () => void hostSavedLevel(row.id, 'collab'));
        li.querySelector('.lvl-row-delete').addEventListener('click', () => void deleteOwnLevel(row.id, row.title));
        mineList.appendChild(li);
      }
    } catch (e) {
      mineErr.textContent = String(e.message || e);
      mineErr.classList.remove('hidden');
    }
  }

  async function deleteOwnLevel(levelId, titleHint) {
    const name = String(titleHint || 'this level').trim() || 'this level';
    if (
      !window.confirm(
        'Permanently delete "' +
          name +
          '"?\n\nThis cannot be undone. Published levels are removed from browse/search too.'
      )
    ) {
      return;
    }
    try {
      await api('/api/levels/delete', {
        method: 'POST',
        body: JSON.stringify({ id: levelId }),
      });
      if (editorState.id === levelId) {
        editorState.id = null;
        showEditorScreen(false);
        showMine(true);
      }
      await refreshMineList();
    } catch (e) {
      if (mineErr) {
        mineErr.textContent = String(e.message || e);
        mineErr.classList.remove('hidden');
      } else {
        window.alert(String(e.message || e));
      }
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function openStaffLevelEditor(levelId, canEdit) {
    lvlEdStatus.textContent = '';
    ownerBuiltinArr = null;
    try {
      const row = await api('/api/staff/levels/' + encodeURIComponent(levelId));
      editorState.id = row.id;
      editorState.title = row.title;
      editorState.published = !!row.published;
      editorState.beatenOk = true;
      editorState.staffEdit = !!canEdit && !!row.canEdit;
      editorState.readOnly = !canEdit || !row.canEdit;
      editorState.data = Object.assign({}, defaultLevelData(), row.data || {});
      if (editorState.data.underhangDisabled == null) editorState.data.underhangDisabled = true;
      normalizeEditorLevelInPlace(editorState.data);
      document.getElementById('lvlEdTitle').value = editorState.title;
      var dash = document.getElementById('screenModDashboard');
      if (dash) {
        dash.classList.add('hidden');
        dash.classList.remove('flex');
      }
      showMine(false);
      showOnline(false);
      showEditorScreen(true);
      syncEditorUi();
    } catch (e) {
      lvlEdStatus.textContent = String(e.message || e);
    }
  }

  window.SkyHopOpenStaffLevelEditor = openStaffLevelEditor;

  async function openEditorForId(id) {
    lvlEdStatus.textContent = '';
    editorState.staffEdit = false;
    try {
      const row = await api('/api/levels/' + encodeURIComponent(id));
      editorState.id = row.id;
      editorState.title = row.title;
      editorState.published = !!row.published;
      editorState.beatenOk = !!row.beatenVerified;
      editorState.readOnly = !!row.published;
      editorState.data = Object.assign({}, defaultLevelData(), row.data || {});
      if (editorState.data.underhangDisabled == null) editorState.data.underhangDisabled = true;
      normalizeEditorLevelInPlace(editorState.data);
      document.getElementById('lvlEdTitle').value = editorState.title;
      showMine(false);
      showOnline(false);
      showEditorScreen(true);
      scheduleEditorRedraw();
      syncEditorUi();
    } catch (e) {
      lvlEdStatus.textContent = String(e.message || e);
    }
  }

  function newEditor() {
    ownerBuiltinArr = null;
    editorState.id = null;
    editorState.title = 'Untitled level';
    editorState.published = false;
    editorState.beatenOk = false;
    editorState.readOnly = false;
    editorState.data = defaultLevelData();
    document.getElementById('lvlEdTitle').value = editorState.title;
    lvlEdStatus.textContent = '';
    showMine(false);
    showEditorScreen(true);
    scheduleEditorRedraw();
    syncEditorUi();
  }

  function syncEditorUi() {
    syncStageFlagsUi();
    syncAppearanceUi();
    syncBlackoutInspector();
    const up = document.getElementById('btnLvlEdUpload');
    const st = document.getElementById('lvlEdStatus');
    const sv = document.getElementById('btnLvlEdSave');
    const te = document.getElementById('btnLvlEdTest');
    const rt = document.getElementById('btnLvlEdRotate');
    const del = document.getElementById('btnLvlEdDelete');
    const delLvl = document.getElementById('btnLvlEdDeleteLevel');
    const tit = document.getElementById('lvlEdTitle');
    if (delLvl) {
      const showDelLvl = !editorState.staffEdit && !ownerBuiltinArr && !!editorState.id;
      delLvl.classList.toggle('hidden', !showDelLvl);
    }
    if (editorState.staffEdit) {
      if (sv) sv.disabled = !!ro;
      if (te) te.disabled = !!ro;
      if (rt) rt.disabled = !!ro;
      if (del) del.disabled = !!ro;
      if (tit) tit.readOnly = !!ro;
      if (up) {
        up.classList.add('opacity-40');
        up.disabled = true;
      }
      if (st) {
        st.textContent = ro
          ? 'Staff: viewing level (read-only).'
          : 'Staff edit — Save writes to this user’s level. Upload/Test hidden.';
      }
      return;
    }
    const wsel = document.getElementById('ownerBuiltinWorldSelect');
    if (wsel) {
      wsel.classList.toggle('hidden', !ownerBuiltinArr);
      if (ownerBuiltinArr) wsel.value = String(ownerBuiltinWorld);
    }
    if (ownerBuiltinArr) {
      if (sv) sv.disabled = false;
      if (te) te.disabled = false;
      if (rt) rt.disabled = false;
      if (del) del.disabled = false;
      if (tit) tit.readOnly = true;
      if (up) {
        up.classList.add('opacity-40');
        up.disabled = true;
      }
      if (st) {
        st.textContent =
          'Owner: World ' +
          ownerBuiltinWorld +
          ' built-in slot ' +
          (ownerBuiltinIdx + 1) +
          ' / ' +
          ownerBuiltinArr.length +
          ' — Save, then follow prompts.';
      }
      return;
    }
    const ro = editorState.readOnly;
    if (sv) sv.disabled = !!ro;
    if (te) te.disabled = !!ro;
    if (rt) rt.disabled = !!ro;
    if (del) del.disabled = !!ro;
    if (tit) tit.readOnly = !!ro;
    if (ro) {
      up.classList.add('opacity-40');
      up.disabled = true;
      st.textContent = 'Published — viewing only. Create a new level to edit.';
      return;
    }
    if (!editorState.published && editorState.id && editorState.beatenOk) {
      up.classList.remove('opacity-40');
      up.disabled = false;
      st.textContent = 'Test cleared — Upload will publish this level.';
    } else if (!editorState.published) {
      up.classList.add('opacity-40');
      up.disabled = true;
      st.textContent = editorState.id ? 'Beat Test play once to enable Upload.' : 'Save, then use Test play and beat the level to enable Upload.';
    } else {
      up.classList.add('opacity-40');
      up.disabled = true;
      st.textContent = 'Published — create a new level or duplicate by saving a new draft in the future.';
    }
  }

  async function publishOwnerBuiltin() {
    if (!ownerBuiltinArr || !ownerBuiltinArr.length) return;
    try {
      const postPath =
        ownerBuiltinWorld >= 3
          ? '/api/owner/worlds/' + ownerBuiltinWorld + '/stages'
          : ownerBuiltinWorld === 2
            ? '/api/owner/builtin-stages-world2'
            : '/api/owner/builtin-stages';
      await api(postPath, {
        method: 'POST',
        body: JSON.stringify({ stages: ownerBuiltinArr }),
      });
      const uploaded = ownerBuiltinArr;
      const world = ownerBuiltinWorld >= 3 ? ownerBuiltinWorld : ownerBuiltinWorld === 2 ? 2 : 1;
      if (world >= 3) {
        if (window.__skyhopCustomWorldId === world) window.__skyhopCustomWorldStages = uploaded;
        if (typeof window.SkyHopRefreshCustomWorlds === 'function') void window.SkyHopRefreshCustomWorlds();
        lvlEdStatus.textContent = 'Uploaded ' + uploaded.length + ' stages for this world. Play uses them now.';
        ownerBuiltinArr = null;
        showEditorScreen(false);
        showMine(true);
        void refreshMineList();
        syncEditorUi();
        return;
      }
      let applied = false;
      if (typeof window.SkyHopApplyServerCampaign === 'function') {
        applied = !!window.SkyHopApplyServerCampaign(world, uploaded);
      }
      if (applied) {
        try {
          window.dispatchEvent(new CustomEvent('skyhop-campaign-loaded'));
        } catch {
          /* */
        }
      }
      lvlEdStatus.textContent = applied
        ? 'Uploaded ' +
          uploaded.length +
          ' World ' +
          world +
          ' stages. Play uses this campaign now.'
        : 'Uploaded ' +
          uploaded.length +
          ' World ' +
          world +
          ' stages, but Play kept the bundled files (campaign too short or invalid).';
      ownerBuiltinArr = null;
      showEditorScreen(false);
      showMine(true);
      void refreshMineList();
      syncEditorUi();
    } catch (e) {
      lvlEdStatus.textContent = String(e.message || e);
    }
  }

  async function loadOwnerBuiltinStagesForEdit() {
    const pick = document.getElementById('ownerBuiltinWorldPick');
    const edSel = document.getElementById('ownerBuiltinWorldSelect');
    if (pick && edSel && !ownerBuiltinArr) edSel.value = pick.value;
    ownerBuiltinWorld = Number(edSel?.value || pick?.value) || 1;
    if (!Number.isFinite(ownerBuiltinWorld) || ownerBuiltinWorld < 1) ownerBuiltinWorld = 1;
    if (pick) pick.value = String(ownerBuiltinWorld);
    if (ownerBuiltinWorld >= 3) {
      const data = await api('/api/worlds/' + ownerBuiltinWorld + '/stages');
      const stages = data && Array.isArray(data.stages) ? JSON.parse(JSON.stringify(data.stages)) : [];
      return stages;
    }
    const getPath = ownerBuiltinWorld === 2 ? '/api/builtin-stages-world2' : '/api/builtin-stages';
    const data = await api(getPath, { noAuth: true });
    let arr = data.stages && data.stages.length ? data.stages : null;
    const fallback =
      ownerBuiltinWorld === 2 ? window.SKYHOP_WORLD2_STAGES || [] : window.SKYHOP_STAGES || [];
    if (!arr || !arr.length) {
      arr = JSON.parse(JSON.stringify(fallback));
    } else {
      arr = JSON.parse(JSON.stringify(data.stages));
    }
    if (!arr.length) {
      throw new Error('No stages loaded.');
    }
    return arr;
  }

  function openOwnerBuiltinEditorAtIndex(arr, idx) {
    ownerBuiltinArr = arr;
    ownerBuiltinIdx = Math.max(0, Math.min(arr.length - 1, idx));
    editorState.id = null;
    editorState.published = false;
    editorState.readOnly = false;
    editorState.staffEdit = false;
    editorState.beatenOk = true;
    const n = ownerBuiltinIdx + 1;
    editorState.title = 'Builtin ' + n;
    editorState.data = JSON.parse(JSON.stringify(ownerBuiltinArr[ownerBuiltinIdx]));
    normalizeEditorLevelInPlace(editorState.data);
    const titEl = document.getElementById('lvlEdTitle');
    if (titEl) titEl.value = 'Builtin ' + n;
    showMine(false);
    showOnline(false);
    showEditorScreen(true);
    scheduleEditorRedraw();
    syncEditorUi();
    document.getElementById('screenModInbox')?.classList.add('hidden');
    document.getElementById('screenModInbox')?.classList.remove('flex');
  }

  async function startOwnerBuiltinEdit() {
    if (!hasAuth()) {
      window.alert('Log in as the site owner.');
      return;
    }
    try {
      const me = await api('/api/me');
      if (me.role !== 'owner') {
        window.alert('Only the site owner can edit the built-in campaign.');
        return;
      }
      const arr = await loadOwnerBuiltinStagesForEdit();
      if (!arr.length) {
        window.alert('This world has no stages yet. Use Add built-in stage.');
        return;
      }
      openOwnerBuiltinEditorAtIndex(arr, 0);
    } catch (e) {
      window.alert(String(e.message || e));
    }
  }

  async function startOwnerBuiltinAddStage() {
    if (!hasAuth()) {
      window.alert('Log in as the site owner.');
      return;
    }
    try {
      const me = await api('/api/me');
      if (me.role !== 'owner') {
        window.alert('Only the site owner can edit the built-in campaign.');
        return;
      }
      const arr = await loadOwnerBuiltinStagesForEdit();
      arr.push(defaultLevelData());
      const newIdx = arr.length - 1;
      openOwnerBuiltinEditorAtIndex(arr, newIdx);
      const st = document.getElementById('lvlEdStatus');
      if (st) {
        st.textContent =
          'New stage ' +
          arr.length +
          ' appended for World ' +
          ownerBuiltinWorld +
          '. Save, then type ALL when prompted to upload.';
      }
    } catch (e) {
      window.alert(String(e.message || e));
    }
  }

  function applyLevelTitleCensor(showStatus, live) {
    const el = document.getElementById('lvlEdTitle');
    if (!el) return '';
    if (typeof window.SkyHopCensorProfanity === 'function') {
      const cens = window.SkyHopCensorProfanity(el.value || '', { strict: !live });
      if (cens.flagged) {
        el.value = live ? cens.text : cens.text.trim() || '***';
        if (showStatus && lvlEdStatus) {
          lvlEdStatus.textContent = 'Profanity in the title was censored.';
        }
      }
    }
    return String(el.value || '').trim();
  }

  async function saveDraft() {
    if (editorState.readOnly && !editorState.staffEdit) {
      lvlEdStatus.textContent = 'Cannot edit a published level.';
      return;
    }
    if (editorState.staffEdit && editorState.id && !editorState.readOnly) {
      let title = applyLevelTitleCensor(true);
      if (!title) {
        lvlEdStatus.textContent = 'Level name required.';
        return;
      }
      const data = stagePayloadFromEditor(editorState.data);
      try {
        const saved = await api('/api/staff/levels/save', {
          method: 'POST',
          body: JSON.stringify({ levelId: editorState.id, title, data }),
        });
        if (saved && saved.title) {
          title = String(saved.title);
          document.getElementById('lvlEdTitle').value = title;
        }
        editorState.title = title;
        lvlEdStatus.textContent = 'Staff save OK.';
        if (typeof window.SkyHopModDashboardRefreshLevels === 'function') {
          window.SkyHopModDashboardRefreshLevels();
        }
      } catch (e) {
        lvlEdStatus.textContent = String(e.message || e);
      }
      return;
    }
    if (editorState.readOnly) {
      lvlEdStatus.textContent = 'Cannot edit a published level.';
      return;
    }
    if (ownerBuiltinArr != null) {
      normalizeEditorLevelInPlace(editorState.data);
      const data = stagePayloadFromEditor(editorState.data);
      ownerBuiltinArr[ownerBuiltinIdx] = data;
      lvlEdStatus.textContent =
        'Updated built-in slot ' + (ownerBuiltinIdx + 1) + ' / ' + ownerBuiltinArr.length + ' (not on server yet).';
      const next = window.prompt(
        'Next: stage number 1–' +
          ownerBuiltinArr.length +
          ', ADD for a new stage, ALL to upload the full campaign to Play, or Cancel.',
        String(ownerBuiltinIdx + 1)
      );
      if (next == null) {
        syncEditorUi();
        return;
      }
      const u = String(next).trim().toUpperCase();
      if (u === 'ALL') {
        await publishOwnerBuiltin();
        return;
      }
      if (u === 'ADD') {
        ownerBuiltinArr.push(defaultLevelData());
        ownerBuiltinIdx = ownerBuiltinArr.length - 1;
        editorState.data = JSON.parse(JSON.stringify(ownerBuiltinArr[ownerBuiltinIdx]));
        normalizeEditorLevelInPlace(editorState.data);
        const titAdd = document.getElementById('lvlEdTitle');
        if (titAdd) titAdd.value = 'Builtin ' + (ownerBuiltinIdx + 1);
        scheduleEditorRedraw();
        syncEditorUi();
        return;
      }
      const n = parseInt(next, 10);
      if (!Number.isFinite(n) || n < 1 || n > ownerBuiltinArr.length) {
        syncEditorUi();
        return;
      }
      ownerBuiltinIdx = n - 1;
      editorState.data = JSON.parse(JSON.stringify(ownerBuiltinArr[ownerBuiltinIdx]));
      normalizeEditorLevelInPlace(editorState.data);
      const titEl = document.getElementById('lvlEdTitle');
      if (titEl) titEl.value = 'Builtin ' + n;
      scheduleEditorRedraw();
      syncEditorUi();
      return;
    }
    const titleBefore = (document.getElementById('lvlEdTitle').value || '').trim();
    let title = applyLevelTitleCensor(true);
    if (!title) {
      lvlEdStatus.textContent = 'Level name required.';
      return;
    }
    const titleWasCensored = title !== titleBefore || (typeof window.SkyHopTextContainsProfanity === 'function' && window.SkyHopTextContainsProfanity(titleBefore));
    const data = stagePayloadFromEditor(editorState.data);
    try {
      if (editorState.id) {
        const saved = await api('/api/levels/save', {
          method: 'POST',
          body: JSON.stringify({ id: editorState.id, title, data }),
        });
        if (saved && saved.title) {
          title = String(saved.title);
          const titEl2 = document.getElementById('lvlEdTitle');
          if (titEl2) titEl2.value = title;
        }
      } else {
        const out = await api('/api/levels/save', {
          method: 'POST',
          body: JSON.stringify({ title, data }),
        });
        editorState.id = out.id;
        if (out.title) {
          title = String(out.title);
          const titEl3 = document.getElementById('lvlEdTitle');
          if (titEl3) titEl3.value = title;
        }
      }
      editorState.title = title;
      editorState.beatenOk = false;
      editorState.published = false;
      lvlEdStatus.textContent = titleWasCensored ? 'Saved (profanity in title was censored).' : 'Saved.';
      syncEditorUi();
    } catch (e) {
      lvlEdStatus.textContent = String(e.message || e);
    }
  }

  async function publishLevel() {
    if (editorState.readOnly) return;
    if (!editorState.id) {
      lvlEdStatus.textContent = 'Save first.';
      return;
    }
    try {
      await api('/api/levels/' + encodeURIComponent(editorState.id) + '/publish', { method: 'POST', body: '{}' });
      editorState.published = true;
      editorState.readOnly = true;
      lvlEdStatus.textContent = 'Published!';
      syncEditorUi();
      unhideMainMenu();
    } catch (e) {
      lvlEdStatus.textContent = String(e.message || e);
    }
  }

  function hostEditorLevel(kind) {
    applyStageFlagsFromUi();
    const title = (document.getElementById('lvlEdTitle').value || '').trim() || 'Level';
    const stage = JSON.parse(JSON.stringify(stagePayloadFromEditor(editorState.data)));
    if (window.SKYHOP_PREP_STAGE_LIST) window.SKYHOP_PREP_STAGE_LIST([stage]);
    showEditorScreen(false);
    const levelId = editorState.id || '';
    if (kind === 'collab' && typeof window.SkyHopHostLevelCollab === 'function') {
      window.SkyHopHostLevelCollab(stage, title, levelId);
      return;
    }
    if (typeof window.SkyHopHostLevelRace === 'function') window.SkyHopHostLevelRace(stage, title, levelId);
  }

  function runTestPlay() {
    if (editorState.readOnly) {
      lvlEdStatus.textContent = 'Cannot test-edit a published level.';
      return;
    }
    if (!editorState.id && ownerBuiltinArr == null) {
      lvlEdStatus.textContent = 'Save the level before Test play (so we can verify your clear).';
      return;
    }
    const title = (document.getElementById('lvlEdTitle').value || '').trim() || 'Test';
    let stages;
    if (ownerBuiltinArr && ownerBuiltinArr.length) {
      const from = Math.max(0, ownerBuiltinIdx);
      stages = ownerBuiltinArr.slice(from).map(function (d, i) {
        const src = i === 0 ? editorState.data : d;
        return JSON.parse(JSON.stringify(stagePayloadFromEditor(src)));
      });
    } else {
      stages = [JSON.parse(JSON.stringify(stagePayloadFromEditor(editorState.data)))];
    }
    if (window.SKYHOP_PREP_STAGE_LIST) window.SKYHOP_PREP_STAGE_LIST(stages);

    if (window.SKYHOP && window.SKYHOP.startUserLevel) {
      showEditorScreen(false);
      window.SKYHOP.startUserLevel(stages, {
        mode: 'test',
        hudTitle: ownerBuiltinArr
          ? 'Test: World ' + ownerBuiltinWorld + ' from ' + (ownerBuiltinIdx + 1)
          : 'Test: ' + title,
        levelTitle: title,
        onTestCleared: function () {
          if (!editorState.id) {
            editorState.beatenOk = true;
            return;
          }
          api('/api/levels/' + encodeURIComponent(editorState.id) + '/beat', { method: 'POST', body: '{}' })
            .then(function () {
              editorState.beatenOk = true;
            })
            .catch(function (err) {
              console.warn(err);
            });
        },
        onContinue: function () {
          showEditorScreen(true);
          syncEditorUi();
          lvlEdStatus.textContent = ownerBuiltinArr
            ? 'Test complete.'
            : 'Test complete. Upload is available after a successful beat.';
          revealMainMenuIfIdle();
          if (window.SKYHOP && typeof window.SKYHOP.ensureGameShellVisible === 'function') {
            window.SKYHOP.ensureGameShellVisible();
          }
        },
      });
    }
  }

  let onlineCtx = {
    mode: 'user',
    username: '',
    page: 1,
    titleQ: '',
    idQ: '',
  };

  function renderOnlinePager(total, page) {
    onlinePager.innerHTML = '';
    const pageSize = 12;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.className = 'rounded-lg border border-white/15 px-3 py-1 text-xs hover:bg-white/10';
    prev.textContent = 'Prev';
    prev.disabled = page <= 1;
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'rounded-lg border border-white/15 px-3 py-1 text-xs hover:bg-white/10';
    next.textContent = 'Next';
    next.disabled = page >= pages;
    const lab = document.createElement('span');
    lab.className = 'text-xs text-slate-400';
    lab.textContent = 'Page ' + page + ' / ' + pages + ' · ' + total + ' total';
    prev.addEventListener('click', () => {
      onlineCtx.page = Math.max(1, page - 1);
      fetchOnlineList();
    });
    next.addEventListener('click', () => {
      onlineCtx.page = Math.min(pages, page + 1);
      fetchOnlineList();
    });
    onlinePager.appendChild(prev);
    onlinePager.appendChild(lab);
    onlinePager.appendChild(next);
  }

  async function fetchOnlineList() {
    onlineList.innerHTML = '';
    try {
      if (onlineCtx.mode === 'user' && onlineCtx.username) {
        const q =
          '/api/levels/user/' +
          encodeURIComponent(onlineCtx.username.toLowerCase()) +
          '?page=' +
          encodeURIComponent(String(onlineCtx.page));
        const out = await api(q, { noAuth: true });
        const lbl = document.getElementById('lvlOnlineUserLabel');
        if (lbl) {
          lbl.textContent = onlineCtx.username;
          lbl.className =
            typeof window.SkyHopAuthorNameClass === 'function'
              ? 'font-sem ' + window.SkyHopAuthorNameClass(out.author_role || (out.author_is_moderator ? 'moderator' : 'player'))
              : out.author_is_moderator
                ? 'font-sem text-rose-400'
                : 'font-sem text-cyan-200';
        }
        renderOnlinePager(out.total || 0, out.page || 1);
        for (const it of out.items || []) {
          onlineList.appendChild(
            rowOnlineItem(it.title, it.id, it.play_count, {
              author: onlineCtx.username,
              authorIsModerator: !!out.author_is_moderator,
              authorRole: out.author_role || (out.author_is_moderator ? 'moderator' : 'player'),
              awarded: !!it.awarded,
              canAward: onlineIsOwner,
            })
          );
        }
        return;
      }
      if (onlineCtx.mode === 'title' && onlineCtx.titleQ) {
        const q =
          '/api/levels/search?q=' +
          encodeURIComponent(onlineCtx.titleQ) +
          '&page=' +
          encodeURIComponent(String(onlineCtx.page));
        const out = await api(q, { noAuth: true });
        renderOnlinePager(out.total || 0, out.page || 1);
        for (const it of out.items || []) {
          onlineList.appendChild(
            rowOnlineItem(it.title, it.id, it.play_count, {
              author: it.author_username || '—',
              authorIsModerator: !!it.author_is_moderator,
              authorRole: it.author_role || (it.author_is_moderator ? 'moderator' : 'player'),
              awarded: !!it.awarded,
              canAward: onlineIsOwner,
            })
          );
        }
        return;
      }
      if (onlineCtx.mode === 'id' && onlineCtx.idQ) {
        const out = await api('/api/levels/lookup?id=' + encodeURIComponent(onlineCtx.idQ.trim()), { noAuth: true });
        renderOnlinePager(out.item ? 1 : 0, 1);
        if (out.item) {
          onlineList.appendChild(
            rowOnlineItem(out.item.title, out.item.id, out.item.play_count, {
              author: out.item.author_username || '—',
              authorIsModerator: !!out.item.author_is_moderator,
              authorRole: out.item.author_role || (out.item.author_is_moderator ? 'moderator' : 'player'),
              awarded: !!out.item.awarded,
              canAward: onlineIsOwner,
            })
          );
        }
        return;
      }
      renderOnlinePager(0, 1);
    } catch (e) {
      const li = document.createElement('li');
      li.className = 'text-sm text-rose-300';
      li.textContent = String(e.message || e);
      onlineList.appendChild(li);
    }
  }

  function rowOnlineItem(titleLine, id, plays, extra) {
    extra = extra || {};
    const author = extra.author;
    var authorRole = extra.authorRole || (extra.authorIsModerator ? 'moderator' : 'player');
    var titleClass = extra.awarded ? 'font-sem text-blue-400' : 'font-sem text-white';
    var titleHtml;
    if (author != null && author !== '') {
      var ac =
        typeof window.SkyHopAuthorNameClass === 'function'
          ? window.SkyHopAuthorNameClass(authorRole)
          : extra.authorIsModerator
            ? 'text-rose-400 font-semibold'
            : 'text-slate-400';
      titleHtml =
        '<div class="text-sm"><span class="' +
        titleClass +
        '">' +
        escapeHtml(titleLine) +
        '</span> <span class="' +
        ac +
        '">· ' +
        escapeHtml(author) +
        '</span></div>';
    } else {
      titleHtml = '<div class="text-sm ' + titleClass + '">' + escapeHtml(titleLine) + '</div>';
    }
    const li = document.createElement('li');
    li.className = 'rounded-lg border border-white/10 bg-slate-900/70 p-3';
    const awardBtn =
      extra.canAward && !extra.awarded
        ? '<button type="button" class="lvl-award rounded-lg bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-500">Award</button>'
        : '';
    li.innerHTML =
      titleHtml +
      '<div class="mt-1 font-mono text-[10px] text-slate-500">' +
      escapeHtml(id) +
      ' · ' +
      (plays || 0) +
      ' plays</div>' +
      '<div class="mt-2 flex flex-wrap gap-2">' +
      '<button type="button" class="lvl-play rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500">Play</button>' +
      awardBtn +
      '<button type="button" class="lvl-race rounded-lg border border-amber-500/50 px-3 py-1 text-xs font-semibold text-amber-100 hover:bg-amber-950/50">Race</button>' +
      '<button type="button" class="lvl-collab rounded-lg border border-teal-500/50 px-3 py-1 text-xs font-semibold text-teal-100 hover:bg-teal-950/50">Collab</button>' +
      '</div>';
    li.querySelector('.lvl-play').addEventListener('click', () => playPublishedLevel(id, extra.returnTo));
    const award = li.querySelector('.lvl-award');
    if (award) {
      award.addEventListener('click', () => {
        award.disabled = true;
        api('/api/levels/' + encodeURIComponent(id) + '/award', { method: 'POST', body: '{}' })
          .then(function () {
            fetchOnlineList();
          })
          .catch(function (err) {
            award.disabled = false;
            alert(String(err.message || err));
          });
      });
    }
    li.querySelector('.lvl-race').addEventListener('click', () => void hostSavedLevel(id, 'race'));
    li.querySelector('.lvl-collab').addEventListener('click', () => void hostSavedLevel(id, 'collab'));
    return li;
  }

  async function hostSavedLevel(id, kind) {
    try {
      const row = await api('/api/levels/' + encodeURIComponent(id), { noAuth: true });
      const stage = JSON.parse(JSON.stringify(row.data));
      if (window.SKYHOP_PREP_STAGE_LIST) window.SKYHOP_PREP_STAGE_LIST([stage]);
      showMine(false);
      showOnline(false);
      showAwarded(false);
      showEditorScreen(false);
      const title = row.title || 'Level';
      if (kind === 'collab' && typeof window.SkyHopHostLevelCollab === 'function') {
        window.SkyHopHostLevelCollab(stage, title, id);
        return;
      }
      if (typeof window.SkyHopHostLevelRace === 'function') window.SkyHopHostLevelRace(stage, title, id);
    } catch (e) {
      alert(String(e.message || e));
    }
  }

  function claimLevelClearReward(id) {
    if (!hasAuth() || !id) return;
    api('/api/levels/' + encodeURIComponent(id) + '/clear-reward', { method: 'POST', body: '{}' })
      .then(function (out) {
        if (!out || out.coins !== 25) return;
        const sub = document.getElementById('stageClearSub');
        if (sub) sub.textContent = (sub.textContent ? sub.textContent + ' ' : '') + 'You earned 25 coins.';
      })
      .catch(function () {});
  }
  window.SkyHopClaimLevelClear = claimLevelClearReward;

  async function playPublishedLevel(id, returnTo) {
    try {
      const row = await api('/api/levels/' + encodeURIComponent(id), { noAuth: true });
      try {
        await api('/api/levels/' + encodeURIComponent(id) + '/play', { method: 'POST', body: '{}', noAuth: true });
      } catch {
        /* play count best-effort */
      }
      const stage = JSON.parse(JSON.stringify(row.data));
      if (window.SKYHOP_PREP_STAGE_LIST) window.SKYHOP_PREP_STAGE_LIST([stage]);
      showOnline(false);
      showAwarded(false);
      let onlineCoinsCollected = new Set();
      if (hasAuth()) {
        try {
          const cs = await api('/api/levels/' + encodeURIComponent(id) + '/coin-state');
          for (const x of cs.collected || []) onlineCoinsCollected.add(Number(x));
        } catch {
          /* */
        }
      }
      if (window.SKYHOP && window.SKYHOP.startUserLevel) {
        window.SKYHOP.startUserLevel([stage], {
          mode: 'play',
          hudTitle: row.title || 'Custom',
          levelTitle: row.title,
          levelUuid: id,
          onlineCoinsCollected: onlineCoinsCollected,
          onCoinCollected: function (coinIndex) {
            if (!hasAuth()) return;
            api('/api/levels/' + encodeURIComponent(id) + '/collect-coin', {
              method: 'POST',
              body: JSON.stringify({ coinIndex: coinIndex }),
            }).catch(function () {});
          },
          onCleared: function () {
            claimLevelClearReward(id);
          },
          onContinue: function () {
            if (returnTo === 'awarded') {
              showAwarded(true);
            } else {
              showOnline(true);
              if (onlineUserPanel) onlineUserPanel.classList.remove('hidden');
            }
            revealMainMenuIfIdle();
            if (window.SKYHOP && typeof window.SKYHOP.ensureGameShellVisible === 'function') {
              window.SKYHOP.ensureGameShellVisible();
            }
          },
        });
      }
    } catch (e) {
      alert(String(e.message || e));
    }
  }

  function syncMyLevelsNav() {
    const btn = document.getElementById('btnNavMyLevels');
    const modsBtn = document.getElementById('btnNavMyMods');
    const submitBtn = document.getElementById('btnNavSubmitRun');
    const authed = hasAuth();
    if (btn) {
      if (authed) {
        btn.classList.remove('hidden');
        btn.classList.add('inline-flex');
      } else {
        btn.classList.add('hidden');
        btn.classList.remove('inline-flex');
      }
    }
    if (modsBtn) {
      modsBtn.classList.toggle('hidden', !authed);
      modsBtn.classList.toggle('inline-flex', authed);
    }
    if (submitBtn) {
      submitBtn.classList.toggle('hidden', !authed);
      submitBtn.classList.toggle('inline-flex', authed);
    }
    if (typeof window.SkyHopOwnerReviewedRuns === 'object' && window.SkyHopOwnerReviewedRuns.syncNav) {
      window.SkyHopOwnerReviewedRuns.syncNav(window.__skyhopLastMe || null);
    }
  }

  function init() {
    syncMyLevelsNav();

    document.getElementById('btnNavOnlineLevels').addEventListener('click', () => {
      showOnline(true);
      onlineUserPanel.classList.add('hidden');
      void refreshOnlineOwner();
    });
    const awardedBtn = document.getElementById('btnAwardedLevels');
    const awardedBack = document.getElementById('btnAwardedLevelsBack');
    if (awardedBtn) {
      awardedBtn.addEventListener('click', () => {
        showAwarded(true);
        awardedPage = 1;
        void fetchAwardedList();
      });
    }
    if (awardedBack) awardedBack.addEventListener('click', () => showAwarded(false));
    document.getElementById('btnNavMyLevels').addEventListener('click', () => {
      if (!hasAuth()) {
        alert('Create an account and sign in to use My Levels and recordings.');
        return;
      }
      showMine(true);
      setMineTab('levels');
    });
    if (mineTabLevels) mineTabLevels.addEventListener('click', () => setMineTab('levels'));
    if (mineTabRecordings) mineTabRecordings.addEventListener('click', () => setMineTab('recordings'));
    if (mineTabLogs) mineTabLogs.addEventListener('click', () => setMineTab('logs'));
    window.addEventListener('skyhop-recording-saved', function () {
      if (mineActiveTab === 'recordings' && mineEl && !mineEl.classList.contains('hidden')) {
        void refreshRecordingsList();
      }
    });
    window.addEventListener('skyhop-input-log-saved', function () {
      if (mineActiveTab === 'logs' && mineEl && !mineEl.classList.contains('hidden')) {
        void refreshInputLogsList();
      }
    });
    document.getElementById('btnLevelsMineBack').addEventListener('click', () => {
      showMine(false);
      revealMainMenuIfIdle();
    });
    document.getElementById('btnLevelsOnlineBack').addEventListener('click', () => {
      showOnline(false);
      revealMainMenuIfIdle();
    });
    document.getElementById('btnLevelsNew').addEventListener('click', () => newEditor());

    document.getElementById('lvlOnlineUserSearch').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim().toLowerCase();
      if (!v) return;
      onlineCtx.mode = 'user';
      onlineCtx.username = v;
      onlineCtx.page = 1;
      document.getElementById('lvlOnlineUserLabel').textContent = v;
      onlineUserPanel.classList.remove('hidden');
      fetchOnlineList();
    });

    document.getElementById('lvlOnlineTitleSearch').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      onlineCtx.mode = 'title';
      onlineCtx.titleQ = e.target.value.trim();
      onlineCtx.page = 1;
      fetchOnlineList();
    });

    document.getElementById('lvlOnlineIdSearch').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      onlineCtx.mode = 'id';
      onlineCtx.idQ = e.target.value.trim();
      onlineCtx.page = 1;
      fetchOnlineList();
    });

    document.querySelectorAll('.lvl-tool').forEach((b) => {
      b.addEventListener('click', () => {
        document.querySelectorAll('.lvl-tool').forEach((x) => x.classList.remove('lvl-on'));
        b.classList.add('lvl-on');
        editorTool = b.getAttribute('data-tool') || 'select';
        switchLinkMode = false;
        switchLinkHover = null;
        const edCanvas = document.getElementById('lvlEditorCanvas');
        if (edCanvas) edCanvas.style.cursor = editorTool === 'eraser' ? 'crosshair' : '';
        if (editorTool !== 'eraser') eraserHover = null;
        scheduleEditorRedraw();
      });
    });

    document.getElementById('btnLvlEdExit').addEventListener('click', () => {
      ownerBuiltinArr = null;
      showEditorScreen(false);
      showMine(true);
      refreshMineList();
      revealMainMenuIfIdle();
    });
    const btnDelLvl = document.getElementById('btnLvlEdDeleteLevel');
    if (btnDelLvl) {
      btnDelLvl.addEventListener('click', () => {
        if (!editorState.id || editorState.staffEdit || ownerBuiltinArr) return;
        const tit = (document.getElementById('lvlEdTitle').value || editorState.title || '').trim();
        void deleteOwnLevel(editorState.id, tit);
      });
    }
    document.getElementById('btnLvlEdSave').addEventListener('click', () => saveDraft());
    document.getElementById('btnLvlEdTest').addEventListener('click', () => runTestPlay());
    const raceEd = document.getElementById('btnLvlEdRace');
    const collabEd = document.getElementById('btnLvlEdCollab');
    if (raceEd) raceEd.addEventListener('click', () => hostEditorLevel('race'));
    if (collabEd) collabEd.addEventListener('click', () => hostEditorLevel('collab'));
    document.getElementById('btnLvlEdUpload').addEventListener('click', () => publishLevel());
    const btnJson = document.getElementById('btnLvlEdJson');
    const jsonPanel = document.getElementById('lvlEdJsonPanel');
    const jsonText = document.getElementById('lvlEdJsonText');
    if (btnJson && jsonPanel && jsonText) {
      btnJson.addEventListener('click', () => {
        const opening = jsonPanel.classList.contains('hidden');
        jsonPanel.classList.toggle('hidden', !opening);
        if (!opening || !editorState.data) return;
        try {
          jsonText.value = JSON.stringify(stagePayloadFromEditor(editorState.data), null, 2);
        } catch (e) {
          const st = document.getElementById('lvlEdStatus');
          if (st) st.textContent = String(e.message || e);
        }
      });
    }
    const btnJsonCopy = document.getElementById('btnLvlEdJsonCopy');
    if (btnJsonCopy && jsonText) {
      btnJsonCopy.addEventListener('click', () => {
        const st = document.getElementById('lvlEdStatus');
        const text = jsonText.value || '';
        const done = () => {
          if (st) st.textContent = 'Level JSON copied.';
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(done).catch(() => {
            jsonText.focus();
            jsonText.select();
            done();
          });
        } else {
          jsonText.focus();
          jsonText.select();
          done();
        }
      });
    }
    const btnJsonImport = document.getElementById('btnLvlEdJsonImport');
    if (btnJsonImport && jsonText) {
      btnJsonImport.addEventListener('click', () => {
        const st = document.getElementById('lvlEdStatus');
        let parsed;
        try {
          parsed = JSON.parse(jsonText.value || '');
        } catch (e) {
          if (st) st.textContent = 'JSON: ' + String(e.message || e);
          return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          if (st) st.textContent = 'JSON must be a level object.';
          return;
        }
        if (JSON.stringify(parsed).length > 120000) {
          if (st) st.textContent = 'Level JSON is too large.';
          return;
        }
        editorState.data = parsed;
        normalizeEditorLevelInPlace(editorState.data);
        editorSelection = null;
        editorHover = null;
        const timeEl = document.getElementById('lvlEdTimeLimit');
        const jumpEl = document.getElementById('lvlEdJumpLimit');
        const splEl = document.getElementById('lvlEdSplText');
        if (timeEl) timeEl.value = String(editorState.data.stage_time_limit);
        if (jumpEl) jumpEl.value = String(editorState.data.jump_limit);
        if (splEl) splEl.value = editorState.data.spl || '';
        scheduleEditorRedraw();
        if (st) st.textContent = 'Imported level JSON.';
      });
    }
    const btnSpl = document.getElementById('btnLvlEdSpl');
    const splPanel = document.getElementById('lvlEdSplPanel');
    const splText = document.getElementById('lvlEdSplText');
    if (btnSpl && splPanel && splText) {
      btnSpl.addEventListener('click', () => {
        const opening = splPanel.classList.contains('hidden');
        if (opening && editorState.data) splText.value = editorState.data.spl || '';
        else if (editorState.data) editorState.data.spl = String(splText.value || '').slice(0, 20000);
        splPanel.classList.toggle('hidden', !opening);
      });
      splText.addEventListener('input', () => {
        if (!editorState.data) return;
        editorState.data.spl = String(splText.value || '').slice(0, 20000);
      });
    }
    const btnOb = document.getElementById('btnOwnerEditBuiltin');
    if (btnOb) btnOb.addEventListener('click', () => void startOwnerBuiltinEdit());
    const btnObAdd = document.getElementById('btnOwnerAddBuiltin');
    if (btnObAdd) btnObAdd.addEventListener('click', () => void startOwnerBuiltinAddStage());
    const ownerWorldSel = document.getElementById('ownerBuiltinWorldSelect');
    if (ownerWorldSel) {
      ownerWorldSel.addEventListener('change', () => {
        if (!ownerBuiltinArr) return;
        const next = Number(ownerWorldSel.value) || 1;
        if (next === ownerBuiltinWorld) return;
        if (
          !window.confirm(
            'Switch to World ' +
              next +
              '? Reload built-in stages from the server (upload first if you need to save World ' +
              ownerBuiltinWorld +
              ').'
          )
        ) {
          ownerWorldSel.value = String(ownerBuiltinWorld);
          return;
        }
        void startOwnerBuiltinEdit();
      });
    }
    document.getElementById('btnLvlEdRotate').addEventListener('click', () => {
      if (!editorSelection || !editorState.data) return;
      const d = editorState.data;
      const sized = selectedSizeRect();
      if (sized && sized.w != null && sized.h != null) {
        if (editorSelection.kind === 'portal') {
          const dest = portalDest(sized);
          rotatePlatform90(sized);
          sized.destOx = dest.x - sized.x;
          sized.destOy = dest.y - sized.y;
        } else {
          rotatePlatform90(sized);
        }
      }
      const obj = objectFromSel(d, editorSelection);
      if (obj) obj.rot = (normalizeRot(obj.rot) + 90) % 360;
      if (editorSelection.kind === 'platform') {
        const p = d.platforms[editorSelection.index];
        if (p && p.move) p.move.axis = p.move.axis === 'y' ? 'x' : 'y';
      } else if (editorSelection.kind === 'mover') {
        const p = d.movingPlatforms[editorSelection.index];
        if (p && p.move) p.move.axis = p.move.axis === 'y' ? 'x' : 'y';
      } else if (editorSelection.kind === 'gravity') {
        const a = d.gravityArrows[editorSelection.index];
        if (a) a.targetDir = a.targetDir < 0 ? 1 : -1;
      } else if (editorSelection.kind === 'fireball') {
        const e = d.fireballEmitters[editorSelection.index];
        if (e) {
          const i = FIREBALL_FROM_CYCLE.indexOf(e.from);
          const next = FIREBALL_FROM_CYCLE[(i >= 0 ? i + 1 : 0) % FIREBALL_FROM_CYCLE.length];
          if ((e.from === 'left' || e.from === 'right') && (next === 'top' || next === 'bottom')) {
            e.pos = Math.max(64, Math.min(d.worldW - 64, e.pos));
          } else if ((e.from === 'top' || e.from === 'bottom') && (next === 'left' || next === 'right')) {
            e.pos = Math.max(64, Math.min(d.worldH - 64, e.pos));
          }
          e.from = next;
        }
      }
      scheduleEditorRedraw();
    });
    const btnToMoverY = document.getElementById('btnLvlEdToMoverY');
    if (btnToMoverY) {
      btnToMoverY.addEventListener('click', () => {
        if (!editorState.data || !editorSelection || editorSelection.kind !== 'platform') return;
        const d = editorState.data;
        const p = d.platforms.splice(editorSelection.index, 1)[0];
        if (!p) return;
        if (!d.movingPlatforms) d.movingPlatforms = [];
        normalizeMoverMotion(p);
        p.move.axis = 'y';
        d.movingPlatforms.push(p);
        editorSelection = { kind: 'mover', index: d.movingPlatforms.length - 1 };
        scheduleEditorRedraw();
      });
    }
    function applyMoverInspectorFromInputs() {
      const p = selectedMoverPlatform();
      if (!p) return;
      normalizeMoverMotion(p);
      const axisEl = document.getElementById('lvlEdMoverAxis');
      const ampEl = document.getElementById('lvlEdMoverAmp');
      const omegaEl = document.getElementById('lvlEdMoverOmega');
      if (axisEl) p.move.axis = axisEl.value === 'y' ? 'y' : 'x';
      if (ampEl) p.move.amp = Number(ampEl.value);
      if (omegaEl) p.move.omega = Number(omegaEl.value);
      normalizeMoverMotion(p);
      scheduleEditorRedraw();
    }
    ['lvlEdMoverAxis', 'lvlEdMoverAmp', 'lvlEdMoverOmega'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', applyMoverInspectorFromInputs);
      el.addEventListener('input', applyMoverInspectorFromInputs);
    });
    const gravDir = document.getElementById('lvlEdGravDir');
    if (gravDir) gravDir.addEventListener('change', applyGravityFromUi);
    ['lvlEdPortalDestX', 'lvlEdPortalDestY'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', applyPortalDestFromUi);
      el.addEventListener('input', applyPortalDestFromUi);
    });
    ['lvlEdSwitchMoveX', 'lvlEdSwitchMoveY'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', applySwitchMoveFromUi);
      el.addEventListener('input', applySwitchMoveFromUi);
    });
    const btnEditSwitch = document.getElementById('btnLvlEdEditSwitch');
    if (btnEditSwitch) {
      btnEditSwitch.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        e.stopPropagation();
        startSwitchLinkMode();
      });
    }
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      const ed = document.getElementById('screenLevelEditor');
      if (!ed || ed.classList.contains('hidden')) return;
      if (!switchLinkMode) return;
      switchLinkMode = false;
      switchLinkHover = null;
      if (lvlEdStatus) lvlEdStatus.textContent = 'Switch link cancelled.';
      scheduleEditorRedraw();
    });
    ['lvlEdSizeW', 'lvlEdSizeH'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', applySizeFromUi);
      el.addEventListener('input', applySizeFromUi);
    });
    ['lvlEdOptGrapple', 'lvlEdOptDoubleJump', 'lvlEdOptBeams'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', applyStageFlagsFromUi);
    });
    ['lvlEdTimeLimit', 'lvlEdJumpLimit'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', applyStageFlagsFromUi);
      el.addEventListener('input', applyStageFlagsFromUi);
    });
    const colorSel = document.getElementById('lvlEdColorSel');
    if (colorSel) {
      colorSel.addEventListener('input', applySelectedColorFromUi);
      colorSel.addEventListener('change', applySelectedColorFromUi);
    }
    const invEl = document.getElementById('lvlEdOptInvisible');
    if (invEl) invEl.addEventListener('change', applySelectedInvisibleFromUi);
    const togEl = document.getElementById('lvlEdOptToggle');
    if (togEl) togEl.addEventListener('change', applySelectedToggleFromUi);
    const togDefEl = document.getElementById('lvlEdToggleDefault');
    if (togDefEl) togDefEl.addEventListener('change', applySelectedToggleFromUi);
    const rainEl = document.getElementById('lvlEdOptRainbow');
    if (rainEl) rainEl.addEventListener('change', applySelectedRainbowFromUi);
    ['lvlEdBlackSec', 'lvlEdBlackAfter'].forEach(function (id) {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('change', applyBlackoutFromUi);
      el.addEventListener('input', applyBlackoutFromUi);
    });
    const touchEl = document.getElementById('lvlEdBlackOnTouch');
    if (touchEl) touchEl.addEventListener('change', applyBlackoutFromUi);
    const paintEl = document.getElementById('lvlEdColorPaint');
    if (paintEl) {
      paintEl.addEventListener('input', applyPaintFromUi);
      paintEl.addEventListener('change', applyPaintFromUi);
    }
    const bgEl = document.getElementById('lvlEdColorBg');
    if (bgEl) {
      bgEl.addEventListener('input', applyBgFromUi);
      bgEl.addEventListener('change', applyBgFromUi);
    }
    document.getElementById('btnLvlEdDelete').addEventListener('click', () => {
      if (!editorSelection) return;
      const d = editorState.data;
      if (editorSelection.kind === 'platform') d.platforms.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'lava') d.lava.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'fireball') d.fireballEmitters.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'coin') d.coins.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'mover') d.movingPlatforms.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'spike') d.spikes.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'gravity') d.gravityArrows.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'portal') d.portals.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'switch') d.switches.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'blackout' && d.blackouts) d.blackouts.splice(editorSelection.index, 1);
      editorSelection = null;
      scheduleEditorRedraw();
    });

    bindEditorCanvas();
    var lvlEdTitleInput = document.getElementById('lvlEdTitle');
    if (lvlEdTitleInput) {
      lvlEdTitleInput.addEventListener('input', function () {
        applyLevelTitleCensor(false, true);
      });
      lvlEdTitleInput.addEventListener('blur', function () {
        applyLevelTitleCensor(true, false);
      });
    }
    window.addEventListener('skyhop-auth-changed', syncMyLevelsNav);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
