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
  };

  /** When non-null, editor is editing built-in campaign slots (owner). */
  let ownerBuiltinArr = null;
  let ownerBuiltinIdx = 0;

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
      coins: [],
      movingPlatforms: [],
    };
  }

  function stagePayloadFromEditor(d) {
    const raw = JSON.parse(JSON.stringify(d));
    if (!raw.spikes) raw.spikes = [];
    if (!raw.lava) raw.lava = [];
    if (!raw.fireballEmitters) raw.fireballEmitters = [];
    if (!raw.platforms) raw.platforms = [];
    if (!Array.isArray(raw.coins)) raw.coins = [];
    if (!Array.isArray(raw.movingPlatforms)) raw.movingPlatforms = [];
    raw.underhangDisabled = true;
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
  }

  /* ---------- Editor canvas ---------- */
  let editorTool = 'select';
  let editorSelection = null;
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

    ctx.fillStyle = '#1e1b4b';
    ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);

    for (const L of d.lava) {
      const a = toScreen(L.x, L.y);
      ctx.fillStyle = 'rgba(234,88,12,0.85)';
      ctx.fillRect(a.x, a.y, L.w * cam.s, L.h * cam.s);
    }

    for (const p of d.platforms) {
      const a = toScreen(p.x, p.y);
      ctx.fillStyle = '#4338ca';
      ctx.fillRect(a.x, a.y, p.w * cam.s, p.h * cam.s);
      ctx.strokeStyle = 'rgba(165,180,252,0.6)';
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, p.w * cam.s - 1, p.h * cam.s - 1);
      if (p.move) {
        ctx.fillStyle = 'rgba(251,191,36,0.35)';
        ctx.font = `${Math.max(9, 10 * cam.s)}px sans-serif`;
        ctx.fillText('move', a.x + 4, a.y + 14 * cam.s);
      }
    }

    for (const p of d.movingPlatforms || []) {
      const a = toScreen(p.x, p.y);
      ctx.fillStyle = '#4f46e5';
      ctx.fillRect(a.x, a.y, p.w * cam.s, p.h * cam.s);
      ctx.strokeStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, p.w * cam.s - 1, p.h * cam.s - 1);
      ctx.lineWidth = 1;
      ctx.fillStyle = '#fde68a';
      ctx.font = `${Math.max(9, 10 * cam.s)}px sans-serif`;
      ctx.fillText('M', a.x + 4, a.y + 14 * cam.s);
    }

    for (const c of d.coins || []) {
      const r = (Number(c.r) > 0 ? Number(c.r) : 14) * cam.s;
      const a = toScreen(c.x, c.y);
      ctx.beginPath();
      ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(251, 191, 36, 0.9)';
      ctx.fill();
      ctx.strokeStyle = '#f59e0b';
      ctx.stroke();
    }

    const gg = d.goal;
    const ga = toScreen(gg.x, gg.y);
    ctx.fillStyle = 'rgba(52,211,153,0.5)';
    ctx.fillRect(ga.x, ga.y, gg.w * cam.s, gg.h * cam.s);
    ctx.strokeStyle = '#34d399';
    ctx.strokeRect(ga.x, ga.y, gg.w * cam.s, gg.h * cam.s);
    ctx.fillStyle = '#a7f3d0';
    ctx.font = `${Math.max(10, 12 * cam.s)}px sans-serif`;
    ctx.fillText('Goal', ga.x + 4, ga.y + 18 * cam.s);

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
      }
    }
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
      } finally {
        editorRedrawScheduled = false;
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
      return { x: clientX - r.left, y: clientY - r.top };
    }

    canvas.addEventListener('mousedown', onDown);
    canvas.addEventListener('touchstart', (e) => onDown(e), { passive: false });

    function onDown(e) {
      if (!editorState.data) return;
      normalizeEditorLevelInPlace(editorState.data);
      e.preventDefault();
      const { x, y } = localXY(e);
      const w = toWorld(x, y);
      const d = editorState.data;

      if (editorTool === 'select') {
        editorSelection = hitTest(w.x, w.y, d);
        drag = editorSelection
          ? { sel: editorSelection, last: w, startPlatformPos: null, startLavaPos: null, startGoal: null }
          : null;
        if (drag && drag.sel.kind === 'platform') {
          const p = d.platforms[drag.sel.index];
          drag.startPlatformPos = { x: p.x, y: p.y };
        }
        if (drag && drag.sel.kind === 'lava') {
          const L = d.lava[drag.sel.index];
          drag.startLavaPos = { x: L.x, y: L.y };
        }
        if (drag && drag.sel.kind === 'goal') drag.startGoal = { x: d.goal.x, y: d.goal.y };
        if (drag && drag.sel.kind === 'spawn') drag.startSpawn = { x: d.spawn.x, y: d.spawn.y };
        if (drag && drag.sel.kind === 'fireball') drag.startEmitter = JSON.parse(JSON.stringify(d.fireballEmitters[drag.sel.index]));
        if (drag && drag.sel.kind === 'coin') {
          const c = d.coins[drag.sel.index];
          drag.startCoin = { x: c.x, y: c.y };
        }
        if (drag && drag.sel.kind === 'mover') {
          const p = d.movingPlatforms[drag.sel.index];
          drag.startMover = { x: p.x, y: p.y };
        }
        scheduleEditorRedraw();
        return;
      }

      editorSelection = null;
      if (editorTool === 'platform') {
        d.platforms.push({ x: Math.round((w.x - 24) / 8) * 8, y: Math.round((w.y - 12) / 8) * 8, w: 48, h: 24 });
        editorSelection = { kind: 'platform', index: d.platforms.length - 1 };
      } else if (editorTool === 'lava') {
        d.lava.push({
          x: Math.round((w.x - 80) / 8) * 8,
          y: Math.round((w.y - 20) / 8) * 8,
          w: 160,
          h: 40,
        });
        editorSelection = { kind: 'lava', index: d.lava.length - 1 };
      } else if (editorTool === 'fireball') {
        addFireballEmitter(w.x, w.y, d);
      } else if (editorTool === 'spawn') {
        d.spawn.x = Math.round(w.x / 4) * 4;
        d.spawn.y = Math.round(w.y / 4) * 4;
      } else if (editorTool === 'goal') {
        d.goal.x = Math.round((w.x - d.goal.w / 2) / 4) * 4;
        d.goal.y = Math.round((w.y - d.goal.h / 2) / 4) * 4;
      } else if (editorTool === 'coin') {
        if (!d.coins) d.coins = [];
        d.coins.push({ x: Math.round(w.x / 4) * 4, y: Math.round(w.y / 4) * 4, r: 14 });
        editorSelection = { kind: 'coin', index: d.coins.length - 1 };
      } else if (editorTool === 'mover') {
        if (!d.movingPlatforms) d.movingPlatforms = [];
        d.movingPlatforms.push({
          x: Math.round((w.x - 40) / 8) * 8,
          y: Math.round((w.y - 10) / 8) * 8,
          w: 80,
          h: 20,
          move: { axis: 'x', amp: 80, omega: 1, phase: 0 },
        });
        editorSelection = { kind: 'mover', index: d.movingPlatforms.length - 1 };
      }
      scheduleEditorRedraw();
    }

    function onMove(e) {
      if (!drag || !editorState.data) return;
      const { x, y } = localXY(e);
      const w = toWorld(x, y);
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
      }
      scheduleEditorRedraw();
    }

    function onUp() {
      drag = null;
    }

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    canvas.addEventListener('touchmove', (e) => onMove(e), { passive: false });
    canvas.addEventListener('touchend', onUp);
  }

  /* ---------- Screens ---------- */
  const mineEl = document.getElementById('screenLevelsMine');
  const onlineEl = document.getElementById('screenLevelsOnline');
  const editorScreen = document.getElementById('screenLevelEditor');
  const mineList = document.getElementById('levelsMineList');
  const mineErr = document.getElementById('levelsMineErr');
  const onlineList = document.getElementById('lvlOnlineList');
  const onlinePager = document.getElementById('lvlOnlinePager');
  const onlineUserPanel = document.getElementById('lvlOnlineUserPanel');
  const lvlEdStatus = document.getElementById('lvlEdStatus');

  function showMine(on) {
    if (!mineEl) return;
    mineEl.classList.toggle('hidden', !on);
  }

  function showOnline(on) {
    if (!onlineEl) return;
    onlineEl.classList.toggle('hidden', !on);
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

  async function refreshMineList() {
    mineErr.classList.add('hidden');
    mineList.innerHTML = '';
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
          (row.published ? '' : '') +
          '</div>';
        li.querySelector('.lvl-row-edit').addEventListener('click', () => openEditorForId(row.id));
        mineList.appendChild(li);
      }
    } catch (e) {
      mineErr.textContent = String(e.message || e);
      mineErr.classList.remove('hidden');
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function openEditorForId(id) {
    lvlEdStatus.textContent = '';
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
    const up = document.getElementById('btnLvlEdUpload');
    const st = document.getElementById('lvlEdStatus');
    const sv = document.getElementById('btnLvlEdSave');
    const te = document.getElementById('btnLvlEdTest');
    const rt = document.getElementById('btnLvlEdRotate');
    const del = document.getElementById('btnLvlEdDelete');
    const tit = document.getElementById('lvlEdTitle');
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
      if (st) st.textContent = 'Owner: built-in slot ' + (ownerBuiltinIdx + 1) + ' / ' + ownerBuiltinArr.length + ' — Save, then follow prompts.';
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
      await api('/api/owner/builtin-stages', {
        method: 'POST',
        body: JSON.stringify({ stages: ownerBuiltinArr }),
      });
      lvlEdStatus.textContent = 'Uploaded ' + ownerBuiltinArr.length + ' built-in stages. Reload to play.';
      ownerBuiltinArr = null;
      showEditorScreen(false);
      syncEditorUi();
    } catch (e) {
      lvlEdStatus.textContent = String(e.message || e);
    }
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
      const data = await api('/api/builtin-stages', { noAuth: true });
      let arr = data.stages && data.stages.length ? data.stages : null;
      if (!arr || !arr.length) {
        arr = JSON.parse(JSON.stringify(window.SKYHOP_STAGES || []));
      } else {
        arr = JSON.parse(JSON.stringify(data.stages));
      }
      if (!arr.length) {
        window.alert('No stages loaded.');
        return;
      }
      ownerBuiltinArr = arr;
      ownerBuiltinIdx = 0;
      editorState.id = null;
      editorState.published = false;
      editorState.readOnly = false;
      editorState.beatenOk = true;
      editorState.title = 'Builtin 1';
      editorState.data = JSON.parse(JSON.stringify(ownerBuiltinArr[0]));
      normalizeEditorLevelInPlace(editorState.data);
      document.getElementById('lvlEdTitle').value = 'Builtin 1';
      showMine(false);
      showOnline(false);
      showEditorScreen(true);
      scheduleEditorRedraw();
      syncEditorUi();
      document.getElementById('screenModInbox')?.classList.add('hidden');
      document.getElementById('screenModInbox')?.classList.remove('flex');
    } catch (e) {
      window.alert(String(e.message || e));
    }
  }

  async function saveDraft() {
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
          ' to edit, type ALL to upload full campaign to server, or Cancel.',
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
    const title = (document.getElementById('lvlEdTitle').value || '').trim();
    if (!title) {
      lvlEdStatus.textContent = 'Level name required.';
      return;
    }
    const data = stagePayloadFromEditor(editorState.data);
    try {
      if (editorState.id) {
        await api('/api/levels/save', {
          method: 'POST',
          body: JSON.stringify({ id: editorState.id, title, data }),
        });
      } else {
        const out = await api('/api/levels/save', {
          method: 'POST',
          body: JSON.stringify({ title, data }),
        });
        editorState.id = out.id;
      }
      editorState.title = title;
      editorState.beatenOk = false;
      editorState.published = false;
      lvlEdStatus.textContent = 'Saved.';
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
      lvlEdStatus.textContent = 'Published!';
      syncEditorUi();
    } catch (e) {
      lvlEdStatus.textContent = String(e.message || e);
    }
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
    const data = stagePayloadFromEditor(editorState.data);
    const stage = JSON.parse(JSON.stringify(data));
    if (window.SKYHOP_PREP_STAGE_LIST) window.SKYHOP_PREP_STAGE_LIST([stage]);

    const title = (document.getElementById('lvlEdTitle').value || '').trim() || 'Test';
    if (window.SKYHOP && window.SKYHOP.startUserLevel) {
      showEditorScreen(false);
      window.SKYHOP.startUserLevel([stage], {
        mode: 'test',
        hudTitle: 'Test: ' + title,
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
          lvlEdStatus.textContent = 'Test complete. Upload is available after a successful beat.';
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
          lbl.className = out.author_is_moderator
            ? 'font-sem text-rose-400'
            : 'font-sem text-cyan-200';
        }
        renderOnlinePager(out.total || 0, out.page || 1);
        for (const it of out.items || []) {
          onlineList.appendChild(
            rowOnlineItem(it.title, it.id, it.play_count, {
              author: onlineCtx.username,
              authorIsModerator: !!out.author_is_moderator,
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
    const authorMod = !!extra.authorIsModerator;
    var titleHtml;
    if (author != null && author !== '') {
      var ac = authorMod ? 'text-rose-400 font-semibold' : 'text-slate-400';
      titleHtml =
        '<div class="text-sm"><span class="font-sem text-white">' +
        escapeHtml(titleLine) +
        '</span> <span class="' +
        ac +
        '">· ' +
        escapeHtml(author) +
        '</span></div>';
    } else {
      titleHtml = '<div class="text-sm font-sem text-white">' + escapeHtml(titleLine) + '</div>';
    }
    const li = document.createElement('li');
    li.className = 'rounded-lg border border-white/10 bg-slate-900/70 p-3';
    li.innerHTML =
      titleHtml +
      '<div class="mt-1 font-mono text-[10px] text-slate-500">' +
      escapeHtml(id) +
      ' · ' +
      (plays || 0) +
      ' plays</div>' +
      '<button type="button" class="lvl-play mt-2 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500">Play</button>';
    li.querySelector('.lvl-play').addEventListener('click', () => playPublishedLevel(id));
    return li;
  }

  async function playPublishedLevel(id) {
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
          onContinue: function () {
            showOnline(true);
            onlineUserPanel.classList.remove('hidden');
          },
        });
      }
    } catch (e) {
      alert(String(e.message || e));
    }
  }

  function syncMyLevelsNav() {
    const btn = document.getElementById('btnNavMyLevels');
    if (!btn) return;
    if (hasAuth()) {
      btn.classList.remove('hidden');
      btn.classList.add('inline-flex');
    } else {
      btn.classList.add('hidden');
      btn.classList.remove('inline-flex');
    }
  }

  function init() {
    syncMyLevelsNav();

    document.getElementById('btnNavOnlineLevels').addEventListener('click', () => {
      showOnline(true);
      onlineUserPanel.classList.add('hidden');
    });
    document.getElementById('btnNavMyLevels').addEventListener('click', () => {
      if (!hasAuth()) {
        alert('Create an account and sign in to use My Levels.');
        return;
      }
      showMine(true);
      refreshMineList();
    });
    document.getElementById('btnLevelsMineBack').addEventListener('click', () => showMine(false));
    document.getElementById('btnLevelsOnlineBack').addEventListener('click', () => showOnline(false));
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
      });
    });

    document.getElementById('btnLvlEdExit').addEventListener('click', () => {
      ownerBuiltinArr = null;
      showEditorScreen(false);
      showMine(true);
      refreshMineList();
    });
    document.getElementById('btnLvlEdSave').addEventListener('click', () => saveDraft());
    document.getElementById('btnLvlEdTest').addEventListener('click', () => runTestPlay());
    document.getElementById('btnLvlEdUpload').addEventListener('click', () => publishLevel());
    const btnOb = document.getElementById('btnOwnerEditBuiltin');
    if (btnOb) btnOb.addEventListener('click', () => void startOwnerBuiltinEdit());
    document.getElementById('btnLvlEdRotate').addEventListener('click', () => {
      if (!editorSelection || editorSelection.kind !== 'platform') return;
      const p = editorState.data.platforms[editorSelection.index];
      rotatePlatform90(p);
      scheduleEditorRedraw();
    });
    document.getElementById('btnLvlEdDelete').addEventListener('click', () => {
      if (!editorSelection) return;
      const d = editorState.data;
      if (editorSelection.kind === 'platform') d.platforms.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'lava') d.lava.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'fireball') d.fireballEmitters.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'coin') d.coins.splice(editorSelection.index, 1);
      if (editorSelection.kind === 'mover') d.movingPlatforms.splice(editorSelection.index, 1);
      editorSelection = null;
      scheduleEditorRedraw();
    });

    bindEditorCanvas();
    window.addEventListener('skyhop-auth-changed', syncMyLevelsNav);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
