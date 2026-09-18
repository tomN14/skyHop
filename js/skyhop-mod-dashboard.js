/**
 * Moderator / owner dashboard: signups, user stats, level management.
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
    var role = me && me.role ? me.role : 'player';
    var show = role === 'moderator' || role === 'owner';
    fab.classList.toggle('hidden', !show);
    if (show) fab.style.display = 'flex';
  }

  window.SkyHopUpdateModDashboardFab = updateFab;

  async function refreshSignups() {
    var sel = document.getElementById('modDashSignupPeriod');
    var out = document.getElementById('modDashSignupCount');
    var period = sel ? sel.value : 'week';
    var tok = getToken();
    if (!tok) return;
    try {
      var data = await api('/api/staff/signups?period=' + encodeURIComponent(period), {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + tok },
      });
      if (out) {
        var label = period === 'day' ? '24 hours' : period === 'month' ? '30 days' : '7 days';
        out.textContent = 'Sign-ups in the past ' + label + ': ' + String(data.signups != null ? data.signups : 0);
      }
    } catch (e) {
      if (out) out.textContent = 'Sign-ups: ' + String(e.message || e);
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
          (prof.role === 'owner' ? 'text-amber-300' : prof.role === 'moderator' ? 'text-rose-400' : 'text-slate-400');
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

  function openDashboard() {
    var screen = document.getElementById('screenModDashboard');
    if (!screen) return;
    screen.classList.remove('hidden');
    screen.classList.add('flex');
    setErr('');
    void refreshSignups();
  }

  function closeDashboard() {
    var screen = document.getElementById('screenModDashboard');
    if (!screen) return;
    screen.classList.add('hidden');
    screen.classList.remove('flex');
  }

  function bind() {
    var fab = document.getElementById('btnModDashboardFab');
    var close = document.getElementById('btnModDashboardClose');
    var lookup = document.getElementById('modDashLookup');
    var refresh = document.getElementById('modDashRefreshSignups');
    var period = document.getElementById('modDashSignupPeriod');
    var unInp = document.getElementById('modDashUsername');

    if (fab) fab.addEventListener('click', openDashboard);
    if (close) close.addEventListener('click', closeDashboard);
    if (lookup) lookup.addEventListener('click', function () {
      void lookupUser();
    });
    if (refresh) refresh.addEventListener('click', function () {
      void refreshSignups();
    });
    if (period) {
      period.addEventListener('change', function () {
        void refreshSignups();
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
