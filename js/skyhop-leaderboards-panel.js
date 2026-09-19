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

  function syncOwnerPanelUi() {
    var me = window.__skyhopLastMe;
    var tools = document.getElementById('lbPanelOwnerTools');
    if (!tools) return;
    var isOwner = !!(me && me.role === 'owner');
    var showTools = isOwner && metric !== 'time';
    tools.classList.toggle('hidden', !showTools);
    if (!showTools) return;
    var runFields = document.getElementById('lbOwnerFieldsRun');
    var coinFields = document.getElementById('lbOwnerFieldsCoins');
    var runsCountFields = document.getElementById('lbOwnerFieldsRunsCount');
    var hint = document.getElementById('lbPanelOwnerHint');
    if (metric === 'coins') {
      if (runFields) runFields.classList.add('hidden');
      if (coinFields) coinFields.classList.remove('hidden');
      if (runsCountFields) runsCountFields.classList.add('hidden');
      if (hint) hint.textContent = 'Sets that player’s coin balance (leaderboard uses wallet total).';
    } else if (metric === 'runs') {
      if (runFields) runFields.classList.add('hidden');
      if (coinFields) coinFields.classList.add('hidden');
      if (runsCountFields) runsCountFields.classList.remove('hidden');
      if (hint) hint.textContent = 'Logs that many campaign runs for the user (uses difficulty above).';
    } else {
      if (runFields) runFields.classList.remove('hidden');
      if (coinFields) coinFields.classList.add('hidden');
      if (runsCountFields) runsCountFields.classList.add('hidden');
      if (hint) hint.textContent = 'Logs one campaign run (time + deaths) for fewest-deaths ranking.';
    }
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
    if (diffWrap) diffWrap.classList.toggle('hidden', metric !== 'time' && metric !== 'deaths' && metric !== 'runs');
    var hint = document.getElementById('lbPanelHint');
    if (hint) {
      if (metric === 'time') hint.textContent = 'Best full campaign time per player (' + lbDiff + ')';
      else if (metric === 'coins') hint.textContent = 'Coin balance (earned in-game, shop, gifts)';
      else if (metric === 'runs') hint.textContent = 'Logged full campaign completions (' + lbDiff + ' difficulty runs count too)';
      else hint.textContent = 'Fewest deaths on a full run (' + lbDiff + ')';
    }
    syncOwnerPanelUi();
  }

  function timeMsFromMinSec(minEl, secEl) {
    var m = minEl ? Math.max(0, Math.floor(Number(minEl.value) || 0)) : 0;
    var s = secEl ? Math.max(0, Math.min(59, Math.floor(Number(secEl.value) || 0))) : 0;
    return (m * 60 + s) * 1000;
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
        if (metric === 'deaths' || metric === 'runs') path += '&difficulty=' + encodeURIComponent(lbDiff);
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
        syncOwnerPanelUi();
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

    var lbOwnerBtnAdd = document.getElementById('lbOwnerBtnAdd');
    if (lbOwnerBtnAdd) {
      lbOwnerBtnAdd.addEventListener('click', async function () {
        var me = window.__skyhopLastMe;
        var apiFn = window.SkyHopApiRequest;
        var msgEl = document.getElementById('lbOwnerAddMsg');
        function setMsg(t, err) {
          if (!msgEl) return;
          msgEl.textContent = t || '';
          msgEl.classList.toggle('hidden', !t);
          msgEl.classList.toggle('text-rose-300', !!err);
          msgEl.classList.toggle('text-emerald-200', !err && !!t);
        }
        if (!me || me.role !== 'owner' || typeof apiFn !== 'function') return;
        var unEl = document.getElementById('lbOwnerAddUser');
        var un = unEl ? String(unEl.value || '').trim() : '';
        if (!un) {
          setMsg('Username required.', true);
          return;
        }
        setMsg('', false);
        try {
          if (metric === 'coins') {
            var coinsEl = document.getElementById('lbOwnerAddCoins');
            var coins = coinsEl ? Math.floor(Number(coinsEl.value)) : NaN;
            if (!Number.isFinite(coins) || coins < 0) {
              setMsg('Enter a valid coin balance.', true);
              return;
            }
            await apiFn('/api/owner/leaderboard/set-coins', {
              method: 'POST',
              body: JSON.stringify({ username: un, coins: coins }),
            });
            setMsg('Set ' + un + ' to ' + String(coins) + ' coins.', false);
          } else if (metric === 'runs') {
            var rcEl = document.getElementById('lbOwnerAddRunCount');
            var runCount = rcEl ? Math.floor(Number(rcEl.value) || 1) : 1;
            if (!Number.isFinite(runCount) || runCount < 1 || runCount > 500) {
              setMsg('Run count must be 1–500.', true);
              return;
            }
            await apiFn('/api/owner/leaderboard/add-campaign-run', {
              method: 'POST',
              body: JSON.stringify({
                username: un,
                difficulty: lbDiff,
                timeMs: 60000,
                deaths: 0,
                runCount: runCount,
              }),
            });
            setMsg('Logged ' + String(runCount) + ' run(s) for ' + un + '.', false);
          } else if (metric === 'deaths') {
            var timeMs = timeMsFromMinSec(
              document.getElementById('lbOwnerAddMin'),
              document.getElementById('lbOwnerAddSec')
            );
            var deathsIn = document.getElementById('lbOwnerAddDeaths');
            var deaths = deathsIn ? Math.max(0, Math.floor(Number(deathsIn.value) || 0)) : 0;
            await apiFn('/api/owner/leaderboard/add-campaign-run', {
              method: 'POST',
              body: JSON.stringify({
                username: un,
                difficulty: lbDiff,
                timeMs: timeMs,
                deaths: deaths,
                runCount: 1,
              }),
            });
            setMsg('Added deaths entry for ' + un + '.', false);
          }
          void loadPanelLeaderboard();
        } catch (ex) {
          setMsg(String(ex.message || ex), true);
        }
      });
    }

    window.addEventListener('skyhop-me-updated', function () {
      syncOwnerPanelUi();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.SkyHopRefreshLeaderboardsPanel = loadPanelLeaderboard;
})();
