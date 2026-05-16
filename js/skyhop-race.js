/**
 * Sky Hop — racing UI, bot simulation, and WebSocket client for parallel runs.
 * Requires window.SKYHOP from skyhop-game.js (loaded before this file).
 */
(function () {
  const N_STAGES = 50;
  /** Use 127.0.0.1 so the connection always hits IPv4 (localhost can map to ::1 on some systems). */
  const DEFAULT_WS = 'ws://127.0.0.1:3001';
  const LS_URL = 'SKYHOP_RACE_SERVER_URL';
  const BOT_NAMES = ['Vega', 'Orion', 'Kite', 'Flux', 'Nova', 'Iris', 'Halo', 'Jolt'];

  /** When the game is served from the same host as the Node process (e.g. https://myapp.fly.dev), use wss/ws on that host — no manual URL. */
  function sameSiteDefaultWs() {
    try {
      if (typeof window === 'undefined' || !window.location) return null;
      const { protocol, host, hostname } = window.location;
      if (!host) return null;
      if (protocol === 'https:') return 'wss://' + host;
      if (protocol === 'http:') {
        if (/^(127\.0\.0\.1|localhost|\[::1\]|\:\:1)$/i.test(hostname)) return null;
        return 'ws://' + host;
      }
    } catch {
      /* */
    }
    return null;
  }

  /**
   * Empty = same site as this page. Otherwise hostname (my.game) or full ws/wss URL.
   */
  function parseServerInput(raw) {
    const s = (raw || '').trim();
    if (!s) return sameSiteDefaultWs() || DEFAULT_WS;
    if (/^wss?:\/\//i.test(s)) return s;
    const stripped = s.replace(/^https?:\/\//i, '').split('/')[0].trim();
    if (!stripped) return sameSiteDefaultWs() || DEFAULT_WS;
    const proto =
      typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + stripped;
  }

  /** Short display in the server field (hide redundant wss://this-site). */
  function displayFromStoredUrl(fullUrl) {
    const ss = sameSiteDefaultWs();
    if (ss && fullUrl === ss) return '';
    if (!sameSiteDefaultWs() && fullUrl === DEFAULT_WS) return fullUrl;
    try {
      const u = new URL(fullUrl);
      if (u.protocol === 'ws:' || u.protocol === 'wss:') return u.host;
    } catch {
      /* */
    }
    return fullUrl;
  }

  let ws = null;
  let myPlayerId = null;
  let roomId = null;
  let isHost = false;
  let mpPlayers = [];
  const mpProgress = {};
  const otherFinish = [];
  const botSchedules = [];
  let botTick = 0;
  let mpPinger = 0;
  let raceT0 = 0;
  let raceType = 'none';

  const el = {
    menu: null,
    back: null,
    wsUrl: null,
    name: null,
    btnVsBots: null,
    mpPanel: null,
    btnCreate: null,
    btnJoin: null,
    roomInput: null,
    hostPanel: null,
    roomIdText: null,
    btnCopy: null,
    btnStartRace: null,
    mpStatus: null,
    joinPanel: null,
    btnBackSub: null,
    hud: null,
    list: null,
    over: null,
    overTitle: null,
    overTime: null,
    overTimeLabel: null,
    overBody: null,
    btnOverOk: null,
    mainSwitch: null,
  };

  function getWsUrl() {
    try {
      let v = localStorage.getItem(LS_URL);
      if (v === 'ws://localhost:3001') {
        v = 'ws://127.0.0.1:3001';
        try {
          localStorage.setItem(LS_URL, v);
        } catch {
          /* */
        }
      }
      const httpsPage = typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
      const ss = sameSiteDefaultWs();
      if (httpsPage && ss) {
        if (!v || v === DEFAULT_WS || wsUrlIsLoopbackOnly(v)) return ss;
      }
      if (v) return v;
    } catch {
      /* */
    }
    return sameSiteDefaultWs() || DEFAULT_WS;
  }
  function setWsUrl(v) {
    try {
      localStorage.setItem(LS_URL, v);
    } catch {
      /* ignore */
    }
  }

  function currentWsUrlForConnect() {
    return parseServerInput(el.wsUrl && el.wsUrl.value);
  }

  /** True for 127.0.0.1 / localhost / ::1 — only valid on the same machine as the server. */
  function wsUrlIsLoopbackOnly(u) {
    if (!u) return true;
    try {
      const x = new URL(u);
      const h = (x.hostname || '').toLowerCase();
      if (h === '127.0.0.1' || h === 'localhost' || h === '::1') return true;
    } catch {
      /* not a full URL */
    }
    if (/^wss?:\/\/127\.0\.0\.1\b/i.test(u) || /:\/\/localhost[:/ ]/i.test(u)) return true;
    return false;
  }

  function getMixedContentHint() {
    if (typeof window === 'undefined' || !window.location || window.location.protocol !== 'https:') return '';
    try {
      const u = new URL(currentWsUrlForConnect());
      if (u.protocol === 'ws:') {
        return ' This page is HTTPS, so the browser may block insecure WebSocket (ws:). Serve the game over http: or use wss: in the box with TLS on the server.';
      }
    } catch {
      /* */
    }
    return '';
  }

  function getHttpHealthUrlForWsField() {
    try {
      const o = new URL(currentWsUrlForConnect());
      if (o.protocol !== 'ws:' && o.protocol !== 'wss:') return null;
      o.protocol = o.protocol === 'wss:' ? 'https:' : 'http:';
      o.pathname = '/health';
      o.search = '';
      o.hash = '';
      return o.href;
    } catch {
      return null;
    }
  }

  function setWsStatusConnectFailed() {
    if (!el.mpStatus) return;
    el.mpStatus.classList.remove("hidden");
    if (wsUrlIsLoopbackOnly(currentWsUrlForConnect())) {
      el.mpStatus.textContent =
        "WebSocket failed. This device is using 127.0.0.1 / localhost — that is not the host PC. Put the host's Wi‑Fi address in the box instead, e.g. ws://192.168.1.10:3001 (same IP that works in http://…/health).";
      return;
    }
    const httpHealth = getHttpHealthUrlForWsField();
    const wss = currentWsUrlForConnect();
    el.mpStatus.textContent = 'WebSocket could not open — checking the host…';
    if (!httpHealth) {
      el.mpStatus.textContent =
        'WebSocket could not open. Set the box to a full URL, e.g. ws://192.168.1.5:3001 (must match the machine where you run the server).';
      return;
    }
    const portFromUrl = (function () {
      try {
        return new URL(wss).port || '3001';
      } catch {
        return '3001';
      }
    })();
    fetch(httpHealth, { method: 'GET' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('status'))))
      .then((d) => {
        if (!el.mpStatus) return;
        if (!d || d.ok !== true) throw new Error('bad json');
        let msg =
          "The server is up — /health worked, so you do not need to run 'npm' again. Racing only needs a working WebSocket to the same host as that test. ";
        if (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' && /^ws:\/\//i.test(wss)) {
          msg +=
            "This page is loaded over HTTPS; many browsers block insecure WebSocket (ws:) from a secure page. Open the game over plain http (e.g. from the same folder) or use wss: behind TLS. ";
        } else {
          msg +=
            "Confirm the WebSocket field uses the same IP and port as the working /health link (e.g. ws://192.168.1.5:3001). Try another browser or turn off VPN. ";
        }
        el.mpStatus.textContent = msg.trim();
      })
      .catch(() => {
        if (!el.mpStatus) return;
        let msg =
          "WebSocket could not connect. If you have not started the host yet: in a terminal on the server PC, cd to the 'server' folder and run: npm start — leave it open. ";
        msg +=
          "Everyone must use ws://(that PC's Wi‑Fi IP):" +
          portFromUrl +
          " in the game. From this device, open " +
          httpHealth +
          " in the browser (use http, not https). If that fails, fix IP or firewall. ";
        if (typeof window !== 'undefined' && window.location && window.location.protocol === 'https:') {
          msg +=
            "If /health already works in another tab but the game still fails, this https page may be blocking both fetch and WebSocket to your LAN — try opening the game as a local file (index.html) or from http. ";
        }
        el.mpStatus.textContent = msg + getMixedContentHint();
      });
  }

  /** Browsers often call onclose, not onerror, when a TCP / WS connection never opens. */
  function bindWsUntilOpen(socket, onOpen) {
    let connectOk = false;
    let reportFail = false;
    function fail() {
      if (connectOk) return;
      if (reportFail) return;
      reportFail = true;
      setWsStatusConnectFailed();
    }
    socket.onopen = function () {
      connectOk = true;
      onOpen();
    };
    socket.onerror = fail;
    socket.onclose = function () {
      if (!connectOk) fail();
    };
  }

  function makeBot(name) {
    const enter = [0];
    for (let s = 0; s < 49; s++) {
      enter.push(enter[enter.length - 1] + 8000 + Math.random() * 42000);
    }
    const lastDur = 12000 + Math.random() * 80000;
    const finishT = enter[49] + lastDur;
    return { name, enter, finishT };
  }

  function stageAt(tMs, b) {
    if (tMs >= b.finishT) return { stage: N_STAGES, done: true };
    for (let i = 48; i >= 0; i--) {
      if (tMs >= b.enter[i + 1]) return { stage: i + 1, done: false };
    }
    return { stage: 0, done: false };
  }

  function getSnapshot() {
    const S = window.SKYHOP;
    if (!S || !S.getRacingState) return { stage0: 0, tMs: 0, finished: false, deaths: 0 };
    return S.getRacingState();
  }

  function renderBoard() {
    if (!el.list) return;
    const t0 = raceT0 || performance.now();
    const elapsed = performance.now() - t0;
    const local = getSnapshot();
    const rows = [];

    if (raceType === 'bot') {
      for (const b of botSchedules) {
        const st = stageAt(elapsed, b);
        rows.push({ name: b.name, isYou: false, stage: st.done ? N_STAGES : st.stage, done: st.done, timeLabel: st.done ? formatMs(b.finishT) : '—' });
      }
    }
    if (raceType === 'mp' && Object.keys(mpProgress).length) {
      for (const id of Object.keys(mpProgress)) {
        if (id === myPlayerId) continue;
        const p = mpProgress[id];
        rows.push({ name: p.name || id, isYou: false, stage: p.finished ? N_STAGES : p.stage, done: p.finished, timeLabel: p.finished && p.tMs != null ? formatMs(p.tMs) : '—' });
      }
    }

    const youLabel = 'You';
    const youStage = local.finished ? N_STAGES : local.stage0;
    rows.push({ name: youLabel, isYou: true, stage: youStage, done: local.finished, timeLabel: local.finished && local.tMs != null ? formatMs(local.tMs) : '—' });

    rows.sort((a, b) => {
      if (a.done !== b.done) return a.done ? -1 : 1;
      if (a.stage !== b.stage) return b.stage - a.stage;
      return 0;
    });

    const top = rows.slice(0, 5);
    el.list.innerHTML = top
      .map(
        (r, i) =>
          `<li class="flex items-center justify-between gap-2 border-b border-slate-700/50 py-0.5 text-[11px] ${
            r.isYou ? 'font-bold text-amber-200' : 'text-slate-300'
          }"><span class="text-slate-500">#${i + 1}</span><span class="flex-1 truncate">${escapeHtml(
            r.name
          )}</span><span class="font-mono text-indigo-200">${r.done ? 'Done' : 'St ' + Math.min(r.stage + 1, N_STAGES)}</span><span class="w-10 text-right text-slate-500">${r.timeLabel}</span></li>`
      )
      .join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatMs(ms) {
    const sec = Math.floor(ms / 1000);
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function formatRaceEndClock(ms) {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '0:00';
    const tSec = Math.floor(ms / 1000);
    const h = Math.floor(tSec / 3600);
    const m = Math.floor((tSec % 3600) / 60);
    const s = tSec % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    return m + ':' + String(s).padStart(2, '0');
  }

  function startBotTick() {
    if (botTick) clearInterval(botTick);
    botTick = setInterval(() => {
      if (window.SKYHOP && !window.SKYHOP.isRacing()) {
        clearInterval(botTick);
        botTick = 0;
        return;
      }
      renderBoard();
    }, 500);
  }

  function startBots() {
    botSchedules.length = 0;
    for (let i = 0; i < 4; i++) botSchedules.push(makeBot(BOT_NAMES[i % BOT_NAMES.length]));
  }

  function showRaceOver(title, body, timeMs) {
    if (el.over) {
      if (el.overTitle) el.overTitle.textContent = title;
      const showClock = timeMs != null && Number.isFinite(timeMs);
      if (el.overTime) {
        if (showClock) {
          el.overTime.textContent = formatRaceEndClock(timeMs);
          el.overTime.classList.remove('hidden');
        } else {
          el.overTime.classList.add('hidden');
        }
      }
      if (el.overTimeLabel) {
        if (showClock) el.overTimeLabel.classList.remove('hidden');
        else el.overTimeLabel.classList.add('hidden');
      }
      if (el.overBody) el.overBody.textContent = body;
      el.over.classList.remove('hidden');
      el.over.classList.add('flex');
    }
  }
  function hideRaceOver() {
    if (el.over) {
      el.over.classList.add('hidden');
      el.over.classList.remove('flex');
    }
  }

  function disconnectWs() {
    if (mpPinger) {
      clearInterval(mpPinger);
      mpPinger = 0;
    }
    if (ws && ws.readyState === 1) {
      try {
        ws.send(JSON.stringify({ type: 'leave' }));
      } catch {
        /* */
      }
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        /* */
      }
    }
    ws = null;
    myPlayerId = null;
    try {
      window.__skyhopMpPeers = null;
      window.__skyhopMyPlayerId = null;
    } catch {
      /* */
    }
    roomId = null;
    isHost = false;
    mpPlayers = [];
    Object.keys(mpProgress).forEach((k) => delete mpProgress[k]);
  }

  function connectWs() {
    const url = parseServerInput(el.wsUrl && el.wsUrl.value);
    setWsUrl(url);
    if (el.wsUrl) el.wsUrl.value = displayFromStoredUrl(url);
    return new WebSocket(url);
  }

  function onWsMessage(e) {
    let msg;
    try {
      msg = JSON.parse(e.data);
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      myPlayerId = msg.playerId;
      try {
        window.__skyhopMyPlayerId = msg.playerId;
      } catch {
        /* */
      }
      return;
    }
    if (msg.type === 'error') {
      if (el.mpStatus) {
        el.mpStatus.textContent = msg.message || 'Error';
        el.mpStatus.classList.remove('hidden');
      }
      return;
    }
    if (msg.type === 'roomCreated') {
      roomId = msg.roomId;
      isHost = true;
      if (el.roomIdText) el.roomIdText.textContent = roomId;
      if (el.hostPanel) el.hostPanel.classList.remove('hidden');
      if (el.joinPanel) el.joinPanel.classList.add('hidden');
      if (el.mpStatus) {
        el.mpStatus.textContent = 'Share the session ID with friends. When they join, press Start race.';
        el.mpStatus.classList.remove('hidden');
      }
      if (el.btnStartRace) el.btnStartRace.classList.remove('hidden');
      return;
    }
    if (msg.type === 'joined') {
      roomId = msg.roomId;
      isHost = msg.youAreHost;
      if (isHost) {
        if (el.roomIdText) el.roomIdText.textContent = roomId;
        if (el.hostPanel) el.hostPanel.classList.remove('hidden');
        if (el.joinPanel) el.joinPanel.classList.add('hidden');
        if (el.btnStartRace) el.btnStartRace.classList.remove('hidden');
        if (el.mpStatus) {
          el.mpStatus.textContent = "You're the host. Share the session ID, then start when ready.";
          el.mpStatus.classList.remove('hidden');
        }
      } else {
        if (el.hostPanel) el.hostPanel.classList.add('hidden');
        if (el.mpStatus) {
          el.mpStatus.textContent = 'In lobby. Wait for the host to start the race.';
          el.mpStatus.classList.remove('hidden');
        }
        if (el.btnStartRace) el.btnStartRace.classList.add('hidden');
      }
      return;
    }
    if (msg.type === 'playerJoined' && msg.players) {
      if (el.mpStatus) {
        el.mpStatus.textContent = msg.players.length + ' player(s) in session.';
        el.mpStatus.classList.remove('hidden');
      }
      return;
    }
    if (msg.type === 'raceStart') {
      if (!window.SKYHOP || !window.SKYHOP.beginRacing) return;
      if (el.menu) {
        el.menu.classList.add('hidden');
        el.menu.classList.remove('flex');
      }
      if (mpPinger) {
        clearInterval(mpPinger);
        mpPinger = 0;
      }
      raceType = 'mp';
      for (const k of Object.keys(mpProgress)) delete mpProgress[k];
      try {
        window.__skyhopMpPeers = mpProgress;
      } catch {
        /* */
      }
      if (el.hud) el.hud.classList.remove('hidden');
      if (el.mpStatus) el.mpStatus.classList.add('hidden');
      if (el.hostPanel) el.hostPanel.classList.add('hidden');
      if (el.joinPanel) el.joinPanel.classList.add('hidden');
      window.SKYHOP.beginRacing({
        type: 'mp',
        difficulty: msg.difficulty,
        customOpts: msg.customOpts,
      });
      if (window.SkyHopSetRaceT0 && window.SKYHOP.getRaceT0) {
        window.SkyHopSetRaceT0(window.SKYHOP.getRaceT0());
      }
      mpPinger = setInterval(function () {
        if (!window.SKYHOP || !window.SKYHOP.isRacing || !window.SKYHOP.isRacing()) {
          if (mpPinger) {
            clearInterval(mpPinger);
            mpPinger = 0;
          }
          return;
        }
        const st = getSnapshot();
        if (ws && ws.readyState === 1) {
          try {
            const payload = {
              type: 'progress',
              stage0: st.stage0,
              timeMs: performance.now() - raceT0,
            };
            if (st.x != null && st.y != null) {
              payload.x = st.x;
              payload.y = st.y;
            }
            if (st.g != null) payload.g = st.g;
            ws.send(JSON.stringify(payload));
          } catch {
            /* */
          }
        }
      }, 100);
      return;
    }
    if (msg.type === 'playerProgress') {
      if (!mpProgress[msg.playerId]) mpProgress[msg.playerId] = { name: msg.name };
      const pr = mpProgress[msg.playerId];
      const prevStage = pr.stage;
      pr.name = msg.name;
      pr.finished = false;
      if (msg.x != null && msg.y != null) {
        pr.lx = msg.x;
        pr.ly = msg.y;
        pr.g = msg.g != null ? (Number(msg.g) < 0 ? -1 : 1) : 1;
        if (prevStage != null && prevStage !== msg.stage0) {
          pr.rx = msg.x;
          pr.ry = msg.y;
        }
      }
      pr.stage = msg.stage0;
      return;
    }
    if (msg.type === 'playerFinished') {
      if (!mpProgress[msg.playerId]) mpProgress[msg.playerId] = {};
      mpProgress[msg.playerId].name = msg.name;
      mpProgress[msg.playerId].finished = true;
      mpProgress[msg.playerId].tMs = msg.timeMs;
      otherFinish.push({ name: msg.name, time: msg.timeMs != null ? msg.timeMs : 0 });
      return;
    }
  }

  window.SkyHopSetRaceT0 = function (t) {
    raceT0 = t;
  };
  window.SkyHopRacingNotifyFinish = function (timeMs, deaths) {
    if (raceType === 'mp' && ws && ws.readyState === 1) {
      try {
        ws.send(
          JSON.stringify({ type: 'finished', timeMs: timeMs != null ? timeMs : 0, deaths: deaths != null ? deaths : 0 })
        );
      } catch {
        /* */
      }
    }
  };
  window.SkyHopDisconnectRace = disconnectWs;
  window.SkyHopRaceReset = function () {
    if (botTick) {
      clearInterval(botTick);
      botTick = 0;
    }
    if (mpPinger) {
      clearInterval(mpPinger);
      mpPinger = 0;
    }
    otherFinish.length = 0;
    raceType = 'none';
    botSchedules.length = 0;
    if (el.hud) el.hud.classList.add('hidden');
    if (el.list) el.list.innerHTML = '';
    disconnectWs();
  };

  window.SkyHopOnRaceOver = function (d) {
    if (d && d.success) {
      const sm = document.getElementById('screenMenu');
      if (sm) {
        sm.classList.remove('hidden');
        sm.classList.add('flex');
      }
      if (typeof window.syncMenuProgressUIForRace === 'function') {
        try {
          window.syncMenuProgressUIForRace();
        } catch {
          /* */
        }
      }
      let body = '';
      if (d.deaths != null) body += 'Deaths: ' + d.deaths + '.';
      if (otherFinish.length) {
        if (body) body += ' ';
        body += 'Others: ' + otherFinish.map((o) => o.name + ' ' + formatMs(o.time)).join(' · ') + '.';
      }
      if (!body) body = 'All stages cleared in this run.';
      showRaceOver('Race complete', body.trim(), d.timeMs);
    }
    if (d && !d.success) showRaceOver('Race ended', d.message || 'You returned to the menu.', undefined);
    if (d && d.success) otherFinish.length = 0;
    raceType = 'none';
    if (botTick) {
      clearInterval(botTick);
      botTick = 0;
    }
    if (mpPinger) {
      clearInterval(mpPinger);
      mpPinger = 0;
    }
    if (el.hud) el.hud.classList.add('hidden');
    if (el.list) el.list.innerHTML = '';
    if (d && d.success) {
      if (el.menu) {
        el.menu.classList.add('hidden');
        el.menu.classList.remove('flex');
      }
    }
    disconnectWs();
  };

  function bind() {
    el.menu = document.getElementById('screenRaceMenu');
    if (!el.menu) return;
    el.back = document.getElementById('btnRaceBack');
    el.wsUrl = document.getElementById('raceWsUrl');
    el.name = document.getElementById('raceName');
    el.btnVsBots = document.getElementById('btnRaceVsBots');
    el.btnCreate = document.getElementById('btnRaceCreate');
    el.btnJoin = document.getElementById('btnRaceJoin');
    el.roomInput = document.getElementById('raceRoomId');
    el.hostPanel = document.getElementById('raceHostPanel');
    el.roomIdText = document.getElementById('raceSessionIdText');
    el.btnCopy = document.getElementById('btnRaceCopyId');
    el.btnStartRace = document.getElementById('btnRaceStartMp');
    el.mpStatus = document.getElementById('raceMpStatus');
    el.joinPanel = document.getElementById('raceJoinPanel');
    el.hud = document.getElementById('raceLeaderboard');
    el.list = document.getElementById('raceLeaderboardList');
    el.over = document.getElementById('screenRaceOver');
    el.overTitle = document.getElementById('raceOverTitle');
    el.overTime = document.getElementById('raceOverTime');
    el.overTimeLabel = document.getElementById('raceOverTimeLabel');
    el.overBody = document.getElementById('raceOverBody');
    el.btnOverOk = document.getElementById('btnRaceOverOk');
    el.mainSwitch = document.getElementById('btnOpenRaceMenu');

    if (el.wsUrl) el.wsUrl.value = displayFromStoredUrl(getWsUrl());
    if (el.wsUrl) {
      el.wsUrl.addEventListener('change', function () {
        const url = parseServerInput(el.wsUrl.value);
        setWsUrl(url);
        el.wsUrl.value = displayFromStoredUrl(url);
      });
    }
    if (el.name) el.name.value = (localStorage.getItem('SKYHOP_RACE_NAME') || 'Racer').slice(0, 20);
    if (el.mainSwitch) {
      el.mainSwitch.addEventListener('click', () => {
        if (el.menu) {
          el.menu.classList.remove('hidden');
          el.menu.classList.add('flex');
        }
      });
    }
    if (el.back) {
      el.back.addEventListener('click', () => {
        if (el.menu) {
          el.menu.classList.add('hidden');
          el.menu.classList.remove('flex');
        }
        disconnectWs();
        if (el.hostPanel) el.hostPanel.classList.add('hidden');
        if (el.joinPanel) el.joinPanel.classList.add('hidden');
        if (el.mpStatus) {
          el.mpStatus.classList.add('hidden');
          el.mpStatus.textContent = '';
        }
      });
    }
    if (el.btnVsBots) {
      el.btnVsBots.addEventListener('click', () => {
        if (!window.SKYHOP || !window.SKYHOP.beginRacing) return;
        raceType = 'bot';
        startBots();
        if (el.menu) {
          el.menu.classList.add('hidden');
          el.menu.classList.remove('flex');
        }
        if (el.hud) el.hud.classList.remove('hidden');
        window.SKYHOP.beginRacing({ type: 'bot' });
        if (window.SkyHopSetRaceT0 && window.SKYHOP.getRaceT0) window.SkyHopSetRaceT0(window.SKYHOP.getRaceT0());
        startBotTick();
      });
    }
    if (el.btnCreate) {
      el.btnCreate.addEventListener('click', () => {
        disconnectWs();
        try {
          localStorage.setItem('SKYHOP_RACE_NAME', (el.name && el.name.value) || 'Racer');
        } catch {
          /* */
        }
        ws = connectWs();
        ws.onmessage = onWsMessage;
        bindWsUntilOpen(ws, function () {
          ws.send(
            JSON.stringify({ type: 'create', name: (el.name && el.name.value) || 'Host' })
          );
        });
        if (el.joinPanel) el.joinPanel.classList.add('hidden');
        if (el.hostPanel) el.hostPanel.classList.add('hidden');
        if (el.btnStartRace) el.btnStartRace.classList.add('hidden');
        if (el.mpStatus) {
          el.mpStatus.textContent = 'Connecting…';
          el.mpStatus.classList.remove('hidden');
        }
      });
    }
    if (el.btnJoin) {
      el.btnJoin.addEventListener('click', () => {
        if (el.joinPanel) el.joinPanel.classList.remove('hidden');
        if (el.hostPanel) el.hostPanel.classList.add('hidden');
      });
    }
    const joinGo = document.getElementById('btnRaceJoinGo');
    if (joinGo) {
      joinGo.addEventListener('click', () => {
        const code = (el.roomInput && el.roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '')) || '';
        if (code.length < 4) {
          if (el.mpStatus) {
            el.mpStatus.textContent = 'Enter a valid session ID.';
            el.mpStatus.classList.remove('hidden');
          }
          return;
        }
        disconnectWs();
        try {
          localStorage.setItem('SKYHOP_RACE_NAME', (el.name && el.name.value) || 'Racer');
        } catch {
          /* */
        }
        ws = connectWs();
        ws.onmessage = onWsMessage;
        bindWsUntilOpen(ws, function () {
          ws.send(
            JSON.stringify({ type: 'join', roomId: code, name: (el.name && el.name.value) || 'Racer' })
          );
        });
        if (el.mpStatus) {
          el.mpStatus.textContent = 'Connecting…';
          el.mpStatus.classList.remove('hidden');
        }
      });
    }
    if (el.btnCopy && el.roomIdText) {
      el.btnCopy.addEventListener('click', () => {
        const t = el.roomIdText.textContent;
        if (t && navigator.clipboard) {
          navigator.clipboard.writeText(t);
          if (el.mpStatus) {
            el.mpStatus.textContent = 'Copied: ' + t;
            el.mpStatus.classList.remove('hidden');
          }
        }
      });
    }
    if (el.btnStartRace) {
      el.btnStartRace.addEventListener('click', () => {
        if (ws && ws.readyState === 1) {
          try {
            const payload = { type: 'start' };
            try {
              if (window.SKYHOP && typeof window.SKYHOP.getRaceStartSettings === 'function') {
                const s = window.SKYHOP.getRaceStartSettings();
                if (s && s.difficulty) {
                  payload.difficulty = s.difficulty;
                  if (s.difficulty === 'custom' && s.customOpts) payload.customOpts = s.customOpts;
                }
              }
            } catch {
              /* */
            }
            ws.send(JSON.stringify(payload));
          } catch {
            /* */
          }
        }
      });
    }
    if (el.btnOverOk) {
      el.btnOverOk.addEventListener('click', () => {
        hideRaceOver();
      });
    }
  }

  function tryBind() {
    if (!window.SKYHOP || !window.SKYHOP.beginRacing) {
      setTimeout(tryBind, 20);
      return;
    }
    bind();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tryBind);
  else tryBind();
})();
