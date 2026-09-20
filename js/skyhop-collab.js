/**
 * Collab mode — shared boss HP, no catch-up teleport, everyone wins together.
 */
(function () {
  let ws = null;
  let collabT0 = 0;
  let mpProgress = {};
  let collabPinger = 0;

  function el(id) {
    return document.getElementById(id);
  }

  function authToken() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN') || '';
    } catch {
      return '';
    }
  }

  function wsUrl() {
    var inp = el('collabWsUrl');
    var raw = inp && inp.value ? String(inp.value).trim() : '';
    if (!raw && typeof window.SkyHopRaceWsUrl === 'function') return window.SkyHopRaceWsUrl();
    if (!raw) {
      var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      return proto + '//' + window.location.host;
    }
    if (/^wss?:\/\//i.test(raw)) return raw.replace(/\/$/, '');
    return (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + raw.replace(/\/$/, '');
  }

  function probeFields() {
    try {
      if (window.SkyHopAnticheatProbe && typeof window.SkyHopAnticheatProbe.take === 'function') {
        return window.SkyHopAnticheatProbe.take();
      }
    } catch {
      /* */
    }
    return {};
  }

  function sendChatLine(text) {
    send({ type: 'chat', text: text });
  }

  function attachChat(history) {
    if (window.SkyHopSessionChat) {
      window.SkyHopSessionChat.attach(sendChatLine);
      if (history && history.length) window.SkyHopSessionChat.load(history);
    }
  }

  function disconnect() {
    if (collabPinger) {
      clearInterval(collabPinger);
      collabPinger = 0;
    }
    if (ws) {
      try {
        ws.close();
      } catch {
        /* */
      }
    }
    ws = null;
    if (window.SkyHopSessionChat) window.SkyHopSessionChat.detach();
  }

  function startCollabProgressPinger() {
    if (collabPinger) {
      clearInterval(collabPinger);
      collabPinger = 0;
    }
    collabPinger = setInterval(function () {
      if (!window.__skyhopCollabActive || !window.SKYHOP || !window.SKYHOP.isRacing || !window.SKYHOP.isRacing()) {
        if (collabPinger) {
          clearInterval(collabPinger);
          collabPinger = 0;
        }
        return;
      }
      if (!ws || ws.readyState !== 1 || !window.SkyHopCollabProgressTick) return;
      var st = window.SKYHOP.getRacingState ? window.SKYHOP.getRacingState() : null;
      if (!st) return;
      var payload = {
        stage0: st.stage0,
        timeMs: st.tMs != null ? st.tMs : 0,
        deaths: st.deaths || 0,
      };
      if (st.x != null && st.y != null) {
        payload.x = st.x;
        payload.y = st.y;
      }
      if (st.g != null) payload.g = st.g;
      if (st.vx != null && st.vy != null) {
        payload.vx = st.vx;
        payload.vy = st.vy;
      }
      if (st.og != null) payload.og = st.og;
      Object.assign(payload, probeFields());
      window.SkyHopCollabProgressTick(payload);
    }, 100);
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify(obj));
    } catch {
      /* */
    }
  }

  function handleMsg(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'collabStart') {
      if (!window.SKYHOP || !window.SKYHOP.beginCollab) return;
      collabT0 = msg.startAt || Date.now();
      if (window.SkyHopSetRaceT0) window.SkyHopSetRaceT0(collabT0);
      for (var k of Object.keys(mpProgress)) delete mpProgress[k];
      window.__skyhopMpPeers = mpProgress;
      window.__skyhopMyPlayerId = window.__skyhopCollabPlayerId;
      window.__skyhopCollabActive = true;
      if (window.SkyHopWorlds) {
        window.SkyHopWorlds.setCollabScope(msg.worldScope || 'w1');
      }
      hideScreen();
      var raceHud = el('raceLeaderboard');
      if (raceHud) raceHud.classList.add('hidden');
      window.SKYHOP.beginCollab({
        type: 'mp',
        difficulty: msg.difficulty || 'normal',
        customOpts: msg.customOpts,
        worldScope: msg.worldScope || 'w1',
      });
      startCollabProgressPinger();
      return;
    }
    if (msg.type === 'playerProgress') {
      if (!mpProgress[msg.playerId]) mpProgress[msg.playerId] = { name: msg.name };
      var pr = mpProgress[msg.playerId];
      pr.name = msg.name;
      pr.stage = msg.stage0;
      pr.finished = false;
      if (msg.x != null && msg.y != null) {
        pr.lx = msg.x;
        pr.ly = msg.y;
        pr.rx = msg.x;
        pr.ry = msg.y;
      }
      return;
    }
    if (msg.type === 'collabBossHp') {
      if (typeof window.SkyHopApplyCollabBossHp === 'function') {
        window.SkyHopApplyCollabBossHp(msg.stage0, msg.hp);
      }
      return;
    }
    if (msg.type === 'collabWin') {
      if (typeof window.SkyHopTriggerCollabWin === 'function') {
        window.SkyHopTriggerCollabWin(msg.timeMs, msg.deaths);
      }
      return;
    }
    if (msg.type === 'roomChat') {
      if (window.SkyHopSessionChat) window.SkyHopSessionChat.push(msg);
      return;
    }
    if (msg.type === 'cheatKick') {
      var stKick = el('collabMpStatus');
      if (stKick) stKick.textContent = String(msg.reason || 'Removed from session.');
      if (window.SKYHOP && typeof window.SKYHOP.goToMenu === 'function') {
        try {
          window.SKYHOP.goToMenu();
        } catch {
          /* */
        }
      }
      disconnect();
      window.alert(msg.reason || 'Removed from this collab — automated play is blocked.');
      return;
    }
    if (msg.type === 'error') {
      var st = el('collabMpStatus');
      if (st) st.textContent = String(msg.message || 'Error');
    }
  }

  function connectHandlers() {
    ws.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      handleMsg(msg);
    };
  }

  function hideScreen() {
    var scr = el('screenCollabMenu');
    if (scr) {
      scr.classList.add('hidden');
      scr.classList.remove('flex');
    }
  }

  function showScreen() {
    var scr = el('screenCollabMenu');
    if (scr) {
      scr.classList.remove('hidden');
      scr.classList.add('flex');
    }
  }

  function bind() {
    var open = el('btnOpenCollabMenu');
    if (open) {
      open.addEventListener('click', function () {
        showScreen();
      });
    }
    var close = el('btnCollabClose');
    if (close) close.addEventListener('click', hideScreen);

    var host = el('collabBtnHost');
    if (host) {
      host.addEventListener('click', function () {
        disconnect();
        ws = new WebSocket(wsUrl());
        connectHandlers();
        ws.onopen = function () {
          send({
            type: 'create',
            mode: 'collab',
            name: (el('collabName') && el('collabName').value) || 'Host',
            authToken: authToken(),
          });
        };
        ws.onmessage = function (ev) {
          var msg;
          try {
            msg = JSON.parse(String(ev.data));
          } catch {
            return;
          }
          if (msg.type === 'roomCreated') {
            window.__skyhopCollabPlayerId = msg.playerId;
            attachChat(msg.chat);
            if (el('collabRoomIdText')) el('collabRoomIdText').textContent = msg.roomId || '';
            if (el('collabHostPanel')) el('collabHostPanel').classList.remove('hidden');
            if (el('collabMpStatus')) el('collabMpStatus').textContent = 'Share session ID. Start when ready.';
          } else handleMsg(msg);
        };
      });
    }

    var join = el('collabBtnJoin');
    if (join) {
      join.addEventListener('click', function () {
        var panel = el('collabJoinPanel');
        var rid = el('collabRoomInput') ? String(el('collabRoomInput').value || '').trim() : '';
        if (rid.length < 4) {
          if (panel) panel.classList.remove('hidden');
          if (el('collabMpStatus')) el('collabMpStatus').textContent = 'Enter session ID, then tap Join again.';
          return;
        }
        disconnect();
        ws = new WebSocket(wsUrl());
        connectHandlers();
        ws.onopen = function () {
          send({
            type: 'join',
            roomId: rid,
            name: (el('collabName') && el('collabName').value) || 'Player',
            authToken: authToken(),
          });
        };
        ws.onmessage = function (ev) {
          var msg;
          try {
            msg = JSON.parse(String(ev.data));
          } catch {
            return;
          }
          if (msg.type === 'joined') {
            window.__skyhopCollabPlayerId = msg.playerId;
            attachChat(msg.chat);
            if (el('collabMpStatus')) el('collabMpStatus').textContent = 'Waiting for host to start…';
          } else handleMsg(msg);
        };
      });
    }

    var start = el('collabBtnStart');
    if (start) {
      start.addEventListener('click', function () {
        var scopeEl = el('collabWorldScope');
        var scope = scopeEl ? scopeEl.value : 'w1';
        var stageCount = 50;
        if (window.SkyHopWorlds) {
          if (scope === 'w2') stageCount = window.SkyHopWorlds.stageCount(2);
          else if (scope === 'both') stageCount = window.SkyHopWorlds.bothStages().length;
          else stageCount = window.SkyHopWorlds.stageCount(1);
        }
        send({ type: 'start', worldScope: scope, difficulty: 'hard', stageCount: stageCount });
      });
    }
  }

  window.SkyHopCollabNotifyBossHit = function (stage0, damage, maxHp) {
    send({ type: 'collabBossHit', stage0: stage0, damage: damage, maxHp: maxHp });
  };
  window.SkyHopCollabNotifyBossInit = function (stage0, maxHp) {
    send({ type: 'collabBossInit', stage0: stage0, maxHp: maxHp });
  };
  window.SkyHopCollabNotifyFinish = function (timeMs, deaths) {
    send({ type: 'finished', timeMs: timeMs, deaths: deaths });
  };
  window.SkyHopCollabProgressTick = function (payload) {
    send(Object.assign({ type: 'progress' }, payload));
  };
  window.SkyHopDisconnectCollab = disconnect;
  window.SkyHopCollabReset = function () {
    disconnect();
    window.__skyhopCollabActive = false;
    if (window.SkyHopWorlds) window.SkyHopWorlds.clearCollabScope();
    for (var k of Object.keys(mpProgress)) delete mpProgress[k];
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
