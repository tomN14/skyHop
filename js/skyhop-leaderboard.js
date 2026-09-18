/**
 * Main menu — top 10 campaign runs per difficulty (Easy / Normal / Hard).
 */
(function () {
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

  function setTabActive() {
    var tabs = [
      ['lbTabEasy', 'easy'],
      ['lbTabNormal', 'normal'],
      ['lbTabHard', 'hard'],
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

  async function loadLeaderboard() {
    var list = document.getElementById('menuLeaderboardList');
    var err = document.getElementById('menuLeaderboardErr');
    if (!list) return;
    if (err) {
      err.textContent = '';
      err.classList.add('hidden');
    }
    list.innerHTML = '<li class="py-2 text-center text-xs text-slate-500">Loading…</li>';
    setTabActive();
    var apiFn = window.SkyHopApiRequest;
    if (typeof apiFn !== 'function') {
      list.innerHTML = '<li class="py-2 text-center text-xs text-slate-500">Sign in to load leaderboard.</li>';
      return;
    }
    try {
      var data = await apiFn('/api/leaderboard/campaign?difficulty=' + encodeURIComponent(lbDiff), {
        method: 'GET',
      });
      var entries = (data && data.entries) || [];
      if (!entries.length) {
        list.innerHTML =
          '<li class="py-3 text-center text-xs text-slate-500">No ranked runs yet for ' +
          esc(lbDiff) +
          '. Finish a full campaign on this difficulty while logged in.</li>';
        return;
      }
      list.innerHTML = entries
        .map(function (e, idx) {
          return (
            '<li class="flex items-center gap-2 border-b border-white/5 py-1.5 text-xs">' +
            '<span class="w-6 font-mono text-slate-500">#' +
            String(idx + 1) +
            '</span>' +
            '<span class="min-w-0 flex-1 truncate font-sem text-slate-200">' +
            esc(e.username) +
            '</span>' +
            '<span class="font-mono text-amber-200">' +
            fmtTime(e.timeMs) +
            '</span>' +
            '<span class="w-8 text-right text-slate-500">' +
            String(e.deaths != null ? e.deaths : 0) +
            'd</span>' +
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
    var easy = document.getElementById('lbTabEasy');
    var normal = document.getElementById('lbTabNormal');
    var hard = document.getElementById('lbTabHard');
    if (easy) {
      easy.addEventListener('click', function () {
        lbDiff = 'easy';
        void loadLeaderboard();
      });
    }
    if (normal) {
      normal.addEventListener('click', function () {
        lbDiff = 'normal';
        void loadLeaderboard();
      });
    }
    if (hard) {
      hard.addEventListener('click', function () {
        lbDiff = 'hard';
        void loadLeaderboard();
      });
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') void loadLeaderboard();
    });
    void loadLeaderboard();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.SkyHopRefreshLeaderboard = loadLeaderboard;
  window.SkyHopLeaderboardSetDiff = function (d) {
    var low = String(d || '').toLowerCase();
    if (low === 'easy' || low === 'normal' || low === 'hard') {
      lbDiff = low;
      void loadLeaderboard();
    }
  };
})();
