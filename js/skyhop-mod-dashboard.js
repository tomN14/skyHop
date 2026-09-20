/**
 * Moderator / owner dashboard: visits, user stats, level management.
 */
(function () {
  var lastLookupUser = '';
  var lastCanEdit = false;

  function api(path, opts) {
    if (typeof window.SkyHopApiRequest !== 'function') {
      return Promise.reject(new Error('API not ready'));
    }
    return window.SkyHopApiRequest(path, opts || {});
  }

  function getToken() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN') || '';
    } catch {
      return '';
    }
  }

  function fmtClock(ms) {
    if (ms == null || !Number.isFinite(ms)) return '—';
    var tSec = Math.floor(ms / 1000);
    var m = Math.floor(tSec / 60);
    var s = tSec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function setErr(t) {
    var el = document.getElementById('modDashErr');
    if (!el) return;
    el.textContent = t || '';
    el.classList.toggle('hidden', !t);
  }

  function updateFab(me) {
    var fab = document.getElementById('btnModDashboardFab');
    if (!fab) return;
    var show = !!(me && me.username);
    fab.classList.toggle('hidden', !show);
    if (show) fab.style.display = 'flex';
  }

  function showAccessDenied() {
    var screen = document.getElementById('screenModAccessDenied');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
  }

  function closeAccessDenied() {
    var screen = document.getElementById('screenModAccessDenied');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
  }

  window.SkyHopCloseModAccessDenied = closeAccessDenied;

  window.SkyHopUpdateModDashboardFab = updateFab;

  async function refreshVisits() {
    var sel = document.getElementById('modDashVisitPeriod');
    var out = document.getElementById('modDashVisitCount');
    var period = sel ? sel.value : 'week';
    var tok = getToken();
    if (!tok) return;
    try {
      var data = await api('/api/staff/visits?period=' + encodeURIComponent(period), {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + tok },
      });
      if (out) {
        var label = period === 'day' ? '24 hours' : period === 'month' ? '30 days' : '7 days';
        var n = data.visits != null ? data.visits : data.signups != null ? data.signups : 0;
        out.textContent = 'Visits in the past ' + label + ': ' + String(n);
      }
    } catch (e) {
      if (out) out.textContent = 'Visits: ' + String(e.message || e);
    }
  }

  function renderLevelsList(levels, canEdit, isSiteOwner) {
    var ul = document.getElementById('modDashLevelsList');
    if (!ul) return;
    ul.innerHTML = '';
    if (!levels || !levels.length) {
      ul.innerHTML = '<li class="text-slate-500">No levels.</li>';
      return;
    }
    for (var i = 0; i < levels.length; i++) {
      var L = levels[i];
      var li = document.createElement('li');
      li.className = 'rounded-xl border border-white/10 bg-slate-900/70 p-3';
      var status = L.published ? 'Published' : 'Draft';
      if (!L.published && L.beaten_verified) status = 'Draft · beat verified';
      li.innerHTML =
        '<div class="flex flex-wrap items-start justify-between gap-2">' +
        '<div><span class="font-sem text-white">' +
        escapeHtml(L.title || 'Untitled') +
        '</span>' +
        '<p class="mt-0.5 font-mono text-[10px] text-slate-500">' +
        escapeHtml(L.id) +
        '</p>' +
        '<p class="mt-0.5 text-[11px] text-slate-400">' +
        status +
        ' · ' +
        (L.play_count || 0) +
        ' plays</p></div>' +
        '<div class="flex flex-wrap gap-1"></div></div>';
      var actions = li.querySelector('div.flex.flex-wrap.gap-1');
      if (canEdit) {
        var btnEdit = document.createElement('button');
        btnEdit.type = 'button';
        btnEdit.className = 'rounded-lg bg-violet-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-violet-500';
        btnEdit.textContent = 'Edit';
        btnEdit.addEventListener('click', function (id) {
          return function () {
            if (typeof window.SkyHopOpenStaffLevelEditor === 'function') {
              window.SkyHopOpenStaffLevelEditor(id, true);
            }
          };
        }(L.id));
        actions.appendChild(btnEdit);
        var btnDel = document.createElement('button');
        btnDel.type = 'button';
        btnDel.className = 'rounded-lg border border-rose-500/50 px-2 py-1 text-[11px] font-semibold text-rose-200 hover:bg-rose-950/40';
        btnDel.textContent = 'Delete';
        btnDel.addEventListener('click', function (id) {
          return function () {
            if (!window.confirm('Delete this level permanently?')) return;
            var tok2 = getToken();
            api('/api/staff/levels/delete', {
              method: 'POST',
              headers: { Authorization: 'Bearer ' + tok2, 'Content-Type': 'application/json' },
              body: JSON.stringify({ levelId: id }),
            })
              .then(function () {
                return loadUserLevels(lastLookupUser);
              })
              .catch(function (e) {
                setErr(String(e.message || e));
              });
          };
        }(L.id));
        actions.appendChild(btnDel);
      } else {
        var btnView = document.createElement('button');
        btnView.type = 'button';
        btnView.className = 'rounded-lg border border-white/20 px-2 py-1 text-[11px] font-semibold text-slate-200 hover:bg-white/5';
        btnView.textContent = isSiteOwner ? 'View (read-only)' : 'View';
        btnView.addEventListener('click', function (id) {
          return function () {
            if (typeof window.SkyHopOpenStaffLevelEditor === 'function') {
              window.SkyHopOpenStaffLevelEditor(id, false);
            }
          };
        }(L.id));
        actions.appendChild(btnView);
      }
      ul.appendChild(li);
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async function loadUserLevels(username) {
    var tok = getToken();
    if (!tok || !username) return;
    var data = await api('/api/staff/user-levels?username=' + encodeURIComponent(username), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + tok },
    });
    lastCanEdit = !!data.canEditLevels;
    renderLevelsList(data.levels || [], data.canEditLevels, data.isSiteOwner);
  }

  async function lookupUser() {
    setErr('');
    var inp = document.getElementById('modDashUsername');
    var un = inp ? String(inp.value || '').trim() : '';
    if (!un) {
      setErr('Enter a username.');
      return;
    }
    var tok = getToken();
    if (!tok) {
      setErr('Log in as moderator or owner.');
      return;
    }
    try {
      var prof = await api('/api/staff/user-profile?username=' + encodeURIComponent(un), {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + tok },
      });
      lastLookupUser = prof.username || un;
      var box = document.getElementById('modDashProfile');
      if (box) box.classList.remove('hidden');
      var uEl = document.getElementById('modDashProfUser');
      if (uEl) uEl.textContent = prof.username || un;
      var rEl = document.getElementById('modDashProfRole');
      if (rEl) {
        rEl.textContent = prof.role ? '(' + prof.role + ')' : '';
        rEl.className =
          'text-xs font-normal ' +
          (prof.role === 'owner'
            ? 'text-amber-300'
            : prof.role === 'admin'
              ? 'text-emerald-300'
              : prof.role === 'moderator'
                ? 'text-rose-400'
                : prof.role === 'report_advisor'
                  ? 'text-sky-300'
                  : 'text-slate-400');
      }
      var note = document.getElementById('modDashProfOwnerNote');
      if (note) note.classList.toggle('hidden', !prof.isSiteOwner);
      var st = prof.stats || {};
      var set = function (id, t) {
        var el = document.getElementById(id);
        if (el) el.textContent = t;
      };
      set('modDashStatRuns', String(st.runCount != null ? st.runCount : 0));
      set('modDashStatCoins', String(prof.coins != null ? prof.coins : 0));
      set('modDashStatDeaths', String(st.totalDeaths != null ? st.totalDeaths : 0));
      set('modDashStatBest', fmtClock(st.bestTimeMs));
      set('modDashStatLevels', String(prof.levelCount != null ? prof.levelCount : 0));
      set('modDashStatPub', String(prof.publishedLevelCount != null ? prof.publishedLevelCount : 0));
      await loadUserLevels(lastLookupUser);
    } catch (e) {
      var box2 = document.getElementById('modDashProfile');
      if (box2) box2.classList.add('hidden');
      var ul = document.getElementById('modDashLevelsList');
      if (ul) ul.innerHTML = '';
      setErr(String(e.message || e));
    }
  }

  var livePoll = 0;
  var watchWs = null;
  var watchPlayers = [];

  function fmtStage(p) {
    if (!p) return '—';
    if (p.finished) return 'Done';
    var s = p.stage != null ? p.stage : 0;
    return 'St ' + (s + 1);
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
    var ov = document.getElementById('screenModWatch');
    if (ov) {
      ov.classList.add('hidden');
      ov.classList.remove('flex');
    }
  }

  function renderWatchPlayers(players) {
    var ul = document.getElementById('modWatchPlayers');
    if (!ul) return;
    if (!players || !players.length) {
      ul.innerHTML = '<li class="text-slate-500">No players.</li>';
      return;
    }
    ul.innerHTML = players
      .map(function (p) {
        var flags = p.flags && p.flags.length ? ' · ' + p.flags.join(', ') : '';
        var un = p.username ? ' (@' + p.username + ')' : '';
        return (
          '<li class="rounded-lg border border-white/10 bg-slate-950/60 px-2 py-1.5 text-slate-200">' +
          '<span class="font-semibold text-white">' +
          escapeHtml(p.name || '?') +
          '</span>' +
          '<span class="text-slate-500">' +
          escapeHtml(un) +
          '</span>' +
          ' · ' +
          fmtStage(p) +
          (p.host ? ' · host' : '') +
          '<span class="text-amber-200/80">' +
          escapeHtml(flags) +
          '</span></li>'
        );
      })
      .join('');
  }

  function pushWatchChat(row) {
    var ul = document.getElementById('modWatchChat');
    if (!ul || !row) return;
    var li = document.createElement('li');
    li.className = row.staff ? 'text-emerald-200' : 'text-slate-200';
    li.innerHTML =
      '<span class="font-semibold text-amber-200/90">' +
      escapeHtml(row.from || 'Player') +
      ':</span> ' +
      escapeHtml(row.text || '');
    ul.appendChild(li);
    ul.scrollTop = ul.scrollHeight;
  }

  function applyWatchRoom(room) {
    if (!room) return;
    watchPlayers = room.players ? room.players.slice() : [];
    var title = document.getElementById('modWatchTitle');
    var meta = document.getElementById('modWatchMeta');
    if (title) title.textContent = (room.mode === 'collab' ? 'Collab' : 'Race') + ' ' + (room.id || '');
    if (meta) {
      meta.textContent =
        (room.started ? 'In progress' : 'Lobby') +
        ' · ' +
        (room.playerCount || 0) +
        ' player(s)' +
        (room.spectatorCount ? ' · ' + room.spectatorCount + ' watching' : '');
    }
    renderWatchPlayers(watchPlayers);
  }

  function upsertWatchPlayer(msg) {
    if (!msg || !msg.playerId) return;
    var found = null;
    for (var i = 0; i < watchPlayers.length; i++) {
      if (watchPlayers[i].id === msg.playerId) {
        found = watchPlayers[i];
        break;
      }
    }
    if (!found) {
      found = { id: msg.playerId, name: msg.name || '?' };
      watchPlayers.push(found);
    }
    if (msg.name) found.name = msg.name;
    if (msg.stage0 != null) found.stage = msg.stage0;
    if (msg.type === 'playerFinished') found.finished = true;
    if (msg.timeMs != null) found.timeMs = msg.timeMs;
    renderWatchPlayers(watchPlayers);
  }

  function watchSession(roomId) {
    stopWatch();
    var ov = document.getElementById('screenModWatch');
    if (ov) {
      ov.classList.remove('hidden');
      ov.classList.add('flex');
    }
    var chatUl = document.getElementById('modWatchChat');
    if (chatUl) chatUl.innerHTML = '';
    var url = typeof window.SkyHopRaceWsUrl === 'function' ? window.SkyHopRaceWsUrl() : '';
    if (!url) {
      var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      url = proto + '//' + window.location.host;
    }
    watchWs = new WebSocket(url);
    watchWs.onopen = function () {
      var tok = getToken();
      watchWs.send(JSON.stringify({ type: 'staffWatch', roomId: roomId, authToken: tok }));
    };
    watchWs.onmessage = function (ev) {
      var msg;
      try {
        msg = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (msg.type === 'error') {
        setErr(String(msg.message || 'Watch failed'));
        stopWatch();
        return;
      }
      if (msg.type === 'watching') {
        applyWatchRoom(msg.room);
        if (msg.chat && msg.chat.length) {
          for (var i = 0; i < msg.chat.length; i++) pushWatchChat(msg.chat[i]);
        }
        return;
      }
      if (msg.type === 'sessionEnded') {
        setErr(msg.message || 'Session ended.');
        stopWatch();
        return;
      }
      if (msg.type === 'roomChat') {
        pushWatchChat(msg);
        return;
      }
      if (msg.type === 'playerProgress' || msg.type === 'playerFinished') {
        upsertWatchPlayer(msg);
        return;
      }
      if (msg.type === 'playerJoined' || msg.type === 'playerLeft') {
        void refreshLiveSessions();
        return;
      }
    };
    watchWs.onclose = function () {
      watchWs = null;
    };
  }

  async function refreshLiveSessions() {
    var ul = document.getElementById('modDashLiveList');
    var tok = getToken();
    if (!tok || !ul) return;
    try {
      var data = await api('/api/staff/live-sessions', {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + tok },
      });
      var sessions = data.sessions || [];
      if (!sessions.length) {
        ul.innerHTML = '<li class="text-slate-500">No live sessions.</li>';
        return;
      }
      ul.innerHTML = '';
      for (var i = 0; i < sessions.length; i++) {
        (function (s) {
          var li = document.createElement('li');
          li.className = 'rounded-xl border border-white/10 bg-slate-900/70 p-3';
          var names = (s.players || [])
            .map(function (p) {
              return (p.name || '?') + (p.username ? ' (@' + p.username + ')' : '') + ' ' + fmtStage(p);
            })
            .join(' · ');
          var flags = s.flags && s.flags.length ? s.flags[s.flags.length - 1].flag : '';
          li.innerHTML =
            '<div class="flex flex-wrap items-start justify-between gap-2">' +
            '<div><span class="font-semibold text-white">' +
            escapeHtml(s.mode === 'collab' ? 'Collab' : 'Race') +
            ' ' +
            escapeHtml(s.id) +
            '</span>' +
            '<p class="mt-0.5 text-[11px] text-slate-400">' +
            (s.started ? 'In progress' : 'Lobby') +
            ' · ' +
            String(s.playerCount || 0) +
            ' player(s)' +
            (s.spectatorCount ? ' · ' + s.spectatorCount + ' watching' : '') +
            '</p>' +
            '<p class="mt-0.5 text-[11px] text-slate-500">' +
            escapeHtml(names || 'No names') +
            (flags ? ' · flag: ' + escapeHtml(flags) : '') +
            '</p></div></div>';
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.className =
            'mt-2 rounded-lg bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-500';
          btn.textContent = 'Watch';
          btn.addEventListener('click', function () {
            watchSession(s.id);
          });
          li.appendChild(btn);
          ul.appendChild(li);
        })(sessions[i]);
      }
    } catch (e) {
      ul.innerHTML = '<li class="text-rose-300">' + escapeHtml(String(e.message || e)) + '</li>';
    }
  }

  function startLivePoll() {
    if (livePoll) clearInterval(livePoll);
    void refreshLiveSessions();
    livePoll = setInterval(function () {
      var screen = document.getElementById('screenModDashboard');
      if (!screen || screen.classList.contains('hidden')) {
        clearInterval(livePoll);
        livePoll = 0;
        return;
      }
      void refreshLiveSessions();
    }, 2500);
  }

  function openDashboard() {
    var me = window.__skyhopLastMe;
    var role = me && me.role ? me.role : 'player';
    if (role !== 'moderator' && role !== 'admin' && role !== 'owner') {
      showAccessDenied();
      return;
    }
    var screen = document.getElementById('screenModDashboard');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    setErr('');
    void refreshVisits();
    startLivePoll();
  }

  function closeDashboard() {
    var screen = document.getElementById('screenModDashboard');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
    if (livePoll) {
      clearInterval(livePoll);
      livePoll = 0;
    }
    stopWatch();
  }

  function bind() {
    var fab = document.getElementById('btnModDashboardFab');
    var close = document.getElementById('btnModDashboardClose');
    var lookup = document.getElementById('modDashLookup');
    var refresh = document.getElementById('modDashRefreshVisits');
    var period = document.getElementById('modDashVisitPeriod');
    var unInp = document.getElementById('modDashUsername');

    var refreshLive = document.getElementById('modDashRefreshLive');
    var watchClose = document.getElementById('btnModWatchClose');
    var watchForm = document.getElementById('modWatchChatForm');

    if (fab) fab.addEventListener('click', openDashboard);
    if (close) close.addEventListener('click', closeDashboard);
    if (refreshLive) {
      refreshLive.addEventListener('click', function () {
        void refreshLiveSessions();
      });
    }
    if (watchClose) watchClose.addEventListener('click', stopWatch);
    if (watchForm) {
      watchForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var inp = document.getElementById('modWatchChatInput');
        var text = inp && inp.value ? String(inp.value).trim() : '';
        if (!text || !watchWs || watchWs.readyState !== 1) return;
        watchWs.send(JSON.stringify({ type: 'chat', text: text }));
        if (inp) inp.value = '';
      });
    }
    var denyClose = document.getElementById('btnModAccessDeniedClose');
    if (denyClose) denyClose.addEventListener('click', closeAccessDenied);
    if (lookup) lookup.addEventListener('click', function () {
      void lookupUser();
    });
    if (refresh) refresh.addEventListener('click', function () {
      void refreshVisits();
    });
    if (period) {
      period.addEventListener('change', function () {
        void refreshVisits();
      });
    }
    if (unInp) {
      unInp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          void lookupUser();
        }
      });
    }

    updateFab(window.__skyhopLastMe || null);
  }

  window.SkyHopModDashboardRefreshLevels = function () {
    if (lastLookupUser) void loadUserLevels(lastLookupUser);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
})();
