/**
 * Public race / collab viewer. Anyone can watch a session the host marked public.
 */
(function () {
  var tab = 'race';
  var poll = 0;
  var watchWs = null;
  var watchPlayers = [];

  function api(path) {
    if (typeof window.SkyHopApiRequest !== 'function') {
      return Promise.reject(new Error('API not ready'));
    }
    return window.SkyHopApiRequest(path, { method: 'GET' });
  }

  function wsUrl() {
    if (typeof window.SkyHopRaceWsUrl === 'function') {
      var u = window.SkyHopRaceWsUrl();
      if (u) return u;
    }
    var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return proto + '//' + window.location.host;
  }

  function setErr(t) {
    var el = document.getElementById('publicSessionsErr');
    if (!el) return;
    el.textContent = t || '';
    el.classList.toggle('hidden', !t);
  }

  function paintTabs() {
    var races = document.getElementById('btnPublicRacesTab');
    var collabs = document.getElementById('btnPublicCollabsTab');
    function paint(btn, on, onClass) {
      if (!btn) return;
      btn.className =
        'rounded-xl border px-3 py-2 text-sm font-semibold ' +
        (on ? onClass : 'border-white/15 bg-slate-950/70 text-slate-200');
    }
    paint(races, tab === 'race', 'border-amber-400 bg-amber-950/60 text-amber-100');
    paint(collabs, tab === 'collab', 'border-teal-400 bg-teal-950/60 text-teal-100');
  }

  function stageLabel(p) {
    if (!p) return '—';
    if (p.finished) return 'Done';
    var s = p.stage != null ? p.stage : 0;
    return 'St ' + (s + 1);
  }

  function renderList(sessions) {
    var ul = document.getElementById('publicSessionsList');
    if (!ul) return;
    var rows = (sessions || []).filter(function (s) {
      return tab === 'collab' ? s.mode === 'collab' : s.mode !== 'collab';
    });
    ul.textContent = '';
    if (!rows.length) {
      var empty = document.createElement('li');
      empty.className = 'text-slate-500';
      empty.textContent = tab === 'collab' ? 'No public collabs.' : 'No public races.';
      ul.appendChild(empty);
      return;
    }
    for (var i = 0; i < rows.length; i++) {
      (function (s) {
        var li = document.createElement('li');
        li.className = 'rounded-xl border border-white/10 bg-slate-900/70 p-3';
        var names = (s.players || [])
          .map(function (p) {
            return (p.name || '?') + (p.host ? ' (host)' : '') + ' ' + stageLabel(p);
          })
          .join(' · ');
        var title = document.createElement('p');
        title.className = 'font-semibold text-white';
        var world = '';
        if (s.mode !== 'collab' && (s.world === 1 || s.world === 2)) world = ' · World ' + s.world;
        if (s.mode === 'collab' && s.worldScope) world = ' · ' + String(s.worldScope).toUpperCase();
        title.textContent = (s.mode === 'collab' ? 'Collab ' : 'Race ') + (s.id || '') + world;
        var meta = document.createElement('p');
        meta.className = 'mt-0.5 text-[11px] text-slate-400';
        meta.textContent = (s.started ? 'In progress' : 'Lobby') + ' · ' + String(s.playerCount || 0) + ' player(s)';
        var who = document.createElement('p');
        who.className = 'mt-0.5 text-[11px] text-slate-500';
        who.textContent = names || 'No players yet';
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'mt-2 rounded-lg bg-sky-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-sky-500';
        btn.textContent = 'Watch';
        btn.addEventListener('click', function () {
          watchSession(s.id, s.mode);
        });
        li.appendChild(title);
        li.appendChild(meta);
        li.appendChild(who);
        li.appendChild(btn);
        ul.appendChild(li);
      })(rows[i]);
    }
  }

  async function refresh() {
    try {
      var data = await api('/api/public-sessions');
      setErr('');
      renderList(data.sessions || []);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  function stopPoll() {
    if (poll) {
      clearInterval(poll);
      poll = 0;
    }
  }

  function openList() {
    var screen = document.getElementById('screenPublicSessions');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    paintTabs();
    void refresh();
    stopPoll();
    poll = setInterval(function () {
      if (screen.classList.contains('hidden')) {
        stopPoll();
        return;
      }
      void refresh();
    }, 2500);
  }

  function closeList() {
    var screen = document.getElementById('screenPublicSessions');
    if (screen) {
      screen.classList.add('hidden');
      screen.classList.remove('flex');
    }
    stopPoll();
  }

  function stopWatch() {
    if (watchWs) {
      try {
        watchWs.close();
      } catch {
        /* */
      }
    }
    watchWs = null;
    var ov = document.getElementById('screenPublicWatch');
    if (ov) {
      ov.classList.add('hidden');
      ov.classList.remove('flex');
    }
  }

  function renderPlayers(players) {
    var ul = document.getElementById('publicWatchPlayers');
    if (!ul) return;
    ul.textContent = '';
    if (!players || !players.length) {
      var empty = document.createElement('li');
      empty.className = 'text-slate-500';
      empty.textContent = 'No players.';
      ul.appendChild(empty);
      return;
    }
    for (var i = 0; i < players.length; i++) {
      var p = players[i];
      var li = document.createElement('li');
      li.className = 'rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-slate-200';
      li.textContent = (p.name || '?') + ' · ' + stageLabel(p) + (p.host ? ' · host' : '');
      ul.appendChild(li);
    }
  }

  function pushChat(row) {
    var ul = document.getElementById('publicWatchChat');
    if (!ul || !row) return;
    var li = document.createElement('li');
    if (row.id) li.setAttribute('data-id', String(row.id));
    li.className = row.modAlias || row.staff ? 'text-emerald-200' : 'text-slate-200';
    var name = document.createElement('span');
    name.className = 'font-semibold ' + (row.modAlias ? 'text-emerald-300' : 'text-amber-200/90');
    name.textContent = row.from || 'Player';
    var body = document.createElement('span');
    body.textContent = ': ' + (row.text || '') + (row.edited ? ' (edited)' : '');
    li.appendChild(name);
    li.appendChild(body);
    ul.appendChild(li);
    ul.scrollTop = ul.scrollHeight;
  }

  function updateChat(row) {
    var ul = document.getElementById('publicWatchChat');
    if (!ul || !row || !row.id) return;
    var li = ul.querySelector('li[data-id="' + String(row.id).replace(/"/g, '') + '"]');
    if (!li) {
      pushChat(row);
      return;
    }
    li.textContent = '';
    var name = document.createElement('span');
    name.className = 'font-semibold ' + (row.modAlias ? 'text-emerald-300' : 'text-amber-200/90');
    name.textContent = row.from || 'Player';
    var body = document.createElement('span');
    body.textContent = ': ' + (row.text || '') + (row.edited ? ' (edited)' : '');
    li.appendChild(name);
    li.appendChild(body);
  }

  function removeChat(id) {
    var ul = document.getElementById('publicWatchChat');
    if (!ul || !id) return;
    var li = ul.querySelector('li[data-id="' + String(id).replace(/"/g, '') + '"]');
    if (li) li.remove();
  }

  function watchSession(roomId, mode) {
    stopWatch();
    var ov = document.getElementById('screenPublicWatch');
    if (ov) {
      ov.classList.remove('hidden');
      ov.classList.add('flex');
    }
    var title = document.getElementById('publicWatchTitle');
    if (title) title.textContent = (mode === 'collab' ? 'Collab ' : 'Race ') + roomId;
    var chat = document.getElementById('publicWatchChat');
    if (chat) chat.textContent = '';
    watchPlayers = [];
    renderPlayers(watchPlayers);
    watchWs = new WebSocket(wsUrl());
    watchWs.onopen = function () {
      watchWs.send(JSON.stringify({ type: 'publicWatch', roomId: roomId }));
    };
    watchWs.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'error' || msg.type === 'sessionEnded') {
        setErr(String(msg.message || 'This session is no longer public.'));
        stopWatch();
        void refresh();
        return;
      }
      if (msg.type === 'watching') {
        watchPlayers = msg.room && msg.room.players ? msg.room.players.slice() : [];
        renderPlayers(watchPlayers);
        var meta = document.getElementById('publicWatchMeta');
        if (meta && msg.room) {
          meta.textContent = (msg.room.started ? 'In progress' : 'Lobby') + ' · view only';
        }
        if (msg.chat) {
          for (var i = 0; i < msg.chat.length; i++) pushChat(msg.chat[i]);
        }
        return;
      }
      if (msg.type === 'roomChat') {
        pushChat(msg);
        return;
      }
      if (msg.type === 'roomChatEdit') {
        updateChat(msg);
        return;
      }
      if (msg.type === 'roomChatDelete') {
        removeChat(msg.id);
        return;
      }
      if (msg.type === 'playerJoined' || msg.type === 'playerLeft') {
        if (msg.players) {
          watchPlayers = msg.players.map(function (p) {
            var prev = null;
            for (var i = 0; i < watchPlayers.length; i++) {
              if (watchPlayers[i].id === p.id) prev = watchPlayers[i];
            }
            return {
              id: p.id,
              name: p.name,
              host: !!p.host,
              stage: prev && prev.stage != null ? prev.stage : 0,
              finished: !!(prev && prev.finished),
            };
          });
          renderPlayers(watchPlayers);
        }
        return;
      }
      if (msg.type === 'playerProgress' || msg.type === 'playerFinished') {
        var found = null;
        for (var j = 0; j < watchPlayers.length; j++) {
          if (watchPlayers[j].id === msg.playerId) found = watchPlayers[j];
        }
        if (!found) {
          found = { id: msg.playerId, name: msg.name || '?' };
          watchPlayers.push(found);
        }
        if (msg.name) found.name = msg.name;
        if (msg.stage0 != null) found.stage = msg.stage0;
        if (msg.type === 'playerFinished') found.finished = true;
        renderPlayers(watchPlayers);
      }
    };
    watchWs.onclose = function () {
      watchWs = null;
    };
  }

  function bind() {
    var fab = document.getElementById('btnPublicSessionsFab');
    var close = document.getElementById('btnPublicSessionsClose');
    var watchClose = document.getElementById('btnPublicWatchClose');
    var races = document.getElementById('btnPublicRacesTab');
    var collabs = document.getElementById('btnPublicCollabsTab');
    if (fab) fab.addEventListener('click', openList);
    if (close) {
      close.addEventListener('click', function () {
        stopWatch();
        closeList();
      });
    }
    if (watchClose) watchClose.addEventListener('click', stopWatch);
    if (races) {
      races.addEventListener('click', function () {
        tab = 'race';
        paintTabs();
        void refresh();
      });
    }
    if (collabs) {
      collabs.addEventListener('click', function () {
        tab = 'collab';
        paintTabs();
        void refresh();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
