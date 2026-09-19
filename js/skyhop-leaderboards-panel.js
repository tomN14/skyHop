/**
 * Full leaderboards panel: fastest run, coins, run count, fewest deaths — global or friends.
 */
(function () {
  var metric = 'time';
  var scope = 'global';
  var lbDiff = 'normal';

  function fmtTime(ms) {
    if (ms == null || !Number.isFinite(ms)) return '—';
    var sec = Math.floor(ms / 1000);
    var h = Math.floor(sec / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    if (h > 0) {
      return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    return m + ':' + String(s).padStart(2, '0');
  }

  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function setMetricTabs() {
    var map = [
      ['lbPanelTabTime', 'time'],
      ['lbPanelTabCoins', 'coins'],
      ['lbPanelTabRuns', 'runs'],
      ['lbPanelTabDeaths', 'deaths'],
    ];
    for (var i = 0; i < map.length; i++) {
      var el = document.getElementById(map[i][0]);
      if (!el) continue;
      var on = map[i][1] === metric;
      el.className = on
        ? 'lb-panel-metric rounded-lg border-2 border-indigo-400 bg-indigo-600/50 px-2 py-1 text-[11px] font-semibold text-white'
        : 'lb-panel-metric rounded-lg border border-white/15 bg-slate-800/80 px-2 py-1 text-[11px] font-semibold text-slate-300 hover:bg-slate-700';
    }
    var diffWrap = document.getElementById('lbPanelDiffWrap');
    if (diffWrap) diffWrap.classList.toggle('hidden', metric !== 'time' && metric !== 'deaths');
    var hint = document.getElementById('lbPanelHint');
    if (hint) {
      if (metric === 'time') hint.textContent = 'Best full campaign time per player (' + lbDiff + ')';
      else if (metric === 'coins') hint.textContent = 'Coin balance (earned in-game, shop, gifts)';
      else if (metric === 'runs') hint.textContent = 'Logged full campaign completions';
      else hint.textContent = 'Fewest deaths on a full run (' + lbDiff + ')';
    }
  }

  function setScopeTabs() {
    var g = document.getElementById('lbPanelScopeGlobal');
    var f = document.getElementById('lbPanelScopeFriends');
    if (g) {
      g.className =
        scope === 'global'
          ? 'rounded-lg border-2 border-amber-400 bg-amber-600/40 px-3 py-1 text-xs font-semibold text-white'
          : 'rounded-lg border border-white/15 bg-slate-800/80 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700';
    }
    if (f) {
      f.className =
        scope === 'friends'
          ? 'rounded-lg border-2 border-amber-400 bg-amber-600/40 px-3 py-1 text-xs font-semibold text-white'
          : 'rounded-lg border border-white/15 bg-slate-800/80 px-3 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700';
    }
  }

  function setDiffTabs() {
    var tabs = [
      ['lbPanelDiffEasy', 'easy'],
      ['lbPanelDiffNormal', 'normal'],
      ['lbPanelDiffHard', 'hard'],
    ];
    for (var i = 0; i < tabs.length; i++) {
      var el = document.getElementById(tabs[i][0]);
      if (!el) continue;
      var on = tabs[i][1] === lbDiff;
      el.className = on
        ? 'rounded-lg border-2 border-indigo-400 bg-indigo-600/50 px-2.5 py-1 text-xs font-semibold text-white'
        : 'rounded-lg border border-white/15 bg-slate-800/80 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:bg-slate-700';
    }
  }

  async function loadPanelLeaderboard() {
    var list = document.getElementById('lbPanelList');
    var err = document.getElementById('lbPanelErr');
    if (!list) return;
    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }
    list.innerHTML = '<li class="py-2 text-center text-xs text-slate-500">Loading…</li>';
    setMetricTabs();
    setScopeTabs();
    setDiffTabs();
    var apiFn = window.SkyHopApiRequest;
    if (typeof apiFn !== 'function') {
      list.innerHTML = '<li class="py-2 text-center text-xs text-slate-500">Server API not ready.</li>';
      return;
    }
    try {
      var path;
      if (metric === 'time') {
        path =
          '/api/leaderboard/campaign?difficulty=' +
          encodeURIComponent(lbDiff) +
          '&scope=' +
          encodeURIComponent(scope);
      } else {
        path =
          '/api/leaderboard/metric?metric=' +
          encodeURIComponent(metric === 'deaths' ? 'deaths' : metric) +
          '&scope=' +
          encodeURIComponent(scope);
        if (metric === 'deaths') path += '&difficulty=' + encodeURIComponent(lbDiff);
      }
      var data = await apiFn(path, { method: 'GET' });
      var entries = (data && data.entries) || [];
      if (!entries.length) {
        var emptyMsg =
          scope === 'friends'
            ? 'No entries yet among you and your friends.'
            : 'No entries yet.';
        list.innerHTML = '<li class="py-3 text-center text-xs text-slate-500">' + esc(emptyMsg) + '</li>';
        return;
      }
      list.innerHTML = entries
        .map(function (e, idx) {
          var value = '';
          if (metric === 'time') {
            value =
              '<span class="font-mono text-amber-200">' +
              fmtTime(e.timeMs) +
              '</span><span class="w-8 text-right text-slate-500">' +
              String(e.deaths != null ? e.deaths : 0) +
              'd</span>';
          } else if (metric === 'coins') {
            value = '<span class="font-mono text-amber-200">' + String(e.coins != null ? e.coins : 0) + '</span>';
          } else if (metric === 'runs') {
            value = '<span class="font-mono text-amber-200">' + String(e.runCount != null ? e.runCount : 0) + '</span>';
          } else {
            value =
              '<span class="font-mono text-amber-200">' +
              String(e.deaths != null ? e.deaths : 0) +
              'd</span><span class="w-14 text-right font-mono text-slate-500">' +
              fmtTime(e.timeMs) +
              '</span>';
          }
          return (
            '<li class="flex items-center gap-2 border-b border-white/5 py-1.5 text-xs">' +
            '<span class="w-6 font-mono text-slate-500">#' +
            String(idx + 1) +
            '</span>' +
            '<span class="min-w-0 flex-1 truncate font-sem text-slate-200">' +
            esc(e.username) +
            '</span>' +
            value +
            '</li>'
          );
        })
        .join('');
    } catch (ex) {
      list.innerHTML = '';
      if (err) {
        err.textContent = String(ex.message || ex);
        err.classList.remove('hidden');
      }
    }
  }

  function bind() {
    var screen = document.getElementById('screenLeaderboards');
    var fab = document.getElementById('btnLeaderboardFab');
    var close = document.getElementById('btnLeaderboardsClose');
    if (fab && screen) {
      fab.addEventListener('click', function () {
        screen.classList.remove('hidden');
        screen.classList.add('flex');
        void loadPanelLeaderboard();
      });
    }
    if (close && screen) {
      close.addEventListener('click', function () {
        screen.classList.add('hidden');
        screen.classList.remove('flex');
      });
    }
    var metricBtns = [
      ['lbPanelTabTime', 'time'],
      ['lbPanelTabCoins', 'coins'],
      ['lbPanelTabRuns', 'runs'],
      ['lbPanelTabDeaths', 'deaths'],
    ];
    metricBtns.forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      el.addEventListener('click', function () {
        metric = pair[1];
        void loadPanelLeaderboard();
      });
    });
    var g = document.getElementById('lbPanelScopeGlobal');
    var f = document.getElementById('lbPanelScopeFriends');
    if (g) {
      g.addEventListener('click', function () {
        scope = 'global';
        void loadPanelLeaderboard();
      });
    }
    if (f) {
      f.addEventListener('click', function () {
        scope = 'friends';
        void loadPanelLeaderboard();
      });
    }
    [['lbPanelDiffEasy', 'easy'], ['lbPanelDiffNormal', 'normal'], ['lbPanelDiffHard', 'hard']].forEach(function (pair) {
      var el = document.getElementById(pair[0]);
      if (!el) return;
      el.addEventListener('click', function () {
        lbDiff = pair[1];
        void loadPanelLeaderboard();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.SkyHopRefreshLeaderboardsPanel = loadPanelLeaderboard;
})();
