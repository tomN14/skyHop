/**
 * Owner: mod-approved submitted runs — override status, lock, view decline reasons.
 */
(function () {
  var objectUrls = [];

  function api(path, opts) {
    if (typeof window.SkyHopApiRequest !== 'function') {
      return Promise.reject(new Error('API not ready'));
    }
    return window.SkyHopApiRequest(path, opts || {});
  }

  function apiBase() {
    if (typeof window.SkyHopApiOrigin === 'function') return window.SkyHopApiOrigin();
    return window.location.origin;
  }

  function token() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN') || '';
    } catch {
      return '';
    }
  }

  function screen() {
    return document.getElementById('screenOwnerReviewedRuns');
  }

  function setErr(t) {
    var el = document.getElementById('ownerReviewedRunsErr');
    if (!el) return;
    el.textContent = t || '';
    el.classList.toggle('hidden', !t);
  }

  function revokeUrls() {
    for (var i = 0; i < objectUrls.length; i++) {
      try {
        URL.revokeObjectURL(objectUrls[i]);
      } catch {
        /* ignore */
      }
    }
    objectUrls.length = 0;
  }

  function fmtClock(ms) {
    if (!Number.isFinite(ms)) return '—';
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  function promptDeclineReason() {
    var r = window.prompt('Reason for Denial (required):');
    if (r === null) return null;
    r = String(r).trim();
    if (!r) {
      window.alert('Reason for Denial is required.');
      return null;
    }
    return r.slice(0, 1000);
  }

  function show(on) {
    var el = screen();
    if (!el) return;
    var me = window.__skyhopLastMe;
    if (on && (!me || me.role !== 'owner')) {
      window.alert('Owner access only.');
      return;
    }
    el.classList.toggle('hidden', !on);
    if (on) {
      setErr('');
      void loadList();
    } else {
      revokeUrls();
      var ul = document.getElementById('ownerReviewedRunsList');
      if (ul) ul.innerHTML = '';
    }
  }

  async function fetchStaffVideo(recordingId) {
    var res = await fetch(apiBase() + '/api/staff/recordings/' + encodeURIComponent(recordingId) + '/video', {
      headers: { Authorization: 'Bearer ' + token() },
    });
    if (!res.ok) throw new Error('Could not load recording');
    return res.blob();
  }

  async function fetchStaffLog(inputLogId) {
    var res = await fetch(apiBase() + '/api/staff/input-logs/' + encodeURIComponent(inputLogId) + '/data', {
      headers: { Authorization: 'Bearer ' + token() },
    });
    if (!res.ok) throw new Error('Could not load input log');
    return res.json();
  }

  async function review(id, status, declineReason) {
    await api('/api/staff/submitted-runs/review', {
      method: 'POST',
      body: JSON.stringify({ id: id, status: status, declineReason: declineReason || '' }),
    });
  }

  async function lockRun(id) {
    await api('/api/owner/submitted-runs/lock', {
      method: 'POST',
      body: JSON.stringify({ id: id }),
    });
  }

  async function loadList() {
    revokeUrls();
    var ul = document.getElementById('ownerReviewedRunsList');
    if (ul) ul.innerHTML = '<li class="text-sm text-slate-400">Loading…</li>';
    try {
      var data = await api('/api/owner/submitted-runs/mod-approved', { method: 'GET' });
      var rows = (data && data.submissions) || [];
      if (!ul) return;
      ul.innerHTML = '';
      if (!rows.length) {
        ul.innerHTML =
          '<li class="rounded-xl border border-white/10 bg-slate-900/60 p-4 text-center text-sm text-slate-400">No approved submitted runs yet. A mod (or owner) must approve a submission first.</li>';
        return;
      }
      for (var i = 0; i < rows.length; i++) {
        (function (row) {
          var li = document.createElement('li');
          li.className = 'rounded-2xl border border-amber-500/20 bg-slate-950/70 p-4 text-sm';
          var st = row.status === 'declined' ? 'Declined' : 'Approved';
          li.innerHTML =
            '<p class="font-semibold text-white">' +
            String(row.username || '').replace(/</g, '&lt;') +
            ' · <span class="text-emerald-300">' +
            st +
            '</span>' +
            (row.statusLocked ? ' · <span class="text-amber-300">Locked</span>' : '') +
            '</p>' +
            '<p class="mt-1 text-xs text-slate-400">Reviewed by: ' +
            String(row.reviewedByUsername || '—').replace(/</g, '&lt;') +
            (row.reviewedByRole ? ' (' + String(row.reviewedByRole).replace(/</g, '&lt;') + ')' : '') +
            ' · ' +
            String(row.difficulty || '').toUpperCase() +
            ' · ' +
            fmtClock(row.timeMs) +
            ' · ' +
            String(row.deaths) +
            ' deaths</p>' +
            '<div class="mt-3 flex flex-wrap gap-2">' +
            '<button type="button" data-act="video" class="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5">Watch recording</button>' +
            '<button type="button" data-act="log" class="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5">View input log</button>' +
            '</div>' +
            '<div class="owner-reviewed-media mt-3 hidden"></div>' +
            '<pre class="owner-reviewed-log mt-3 hidden max-h-48 overflow-auto rounded-lg bg-black/50 p-2 text-[10px] text-emerald-200"></pre>' +
            '<div class="owner-decline-reason mt-2 hidden"></div>' +
            '<div class="mt-3 flex flex-wrap gap-2 owner-reviewed-actions"></div>';
          var actions = li.querySelector('.owner-reviewed-actions');
          var declineBox = li.querySelector('.owner-decline-reason');

          if (row.declineReason) {
            declineBox.classList.remove('hidden');
            declineBox.innerHTML =
              '<button type="button" class="view-decline-reason rounded-lg border border-rose-500/40 px-3 py-1.5 text-xs font-semibold text-rose-100 hover:bg-rose-950/40">View Reason for Denial</button>' +
              '<p class="decline-reason-text mt-2 hidden rounded-lg border border-rose-500/30 bg-rose-950/30 p-2 text-xs text-rose-100"></p>';
            var reasonText = declineBox.querySelector('.decline-reason-text');
            reasonText.textContent = row.declineReason;
            declineBox.querySelector('.view-decline-reason').addEventListener('click', function () {
              reasonText.classList.toggle('hidden');
            });
          }

          li.querySelector('[data-act="video"]').addEventListener('click', async function () {
            try {
              var blob = await fetchStaffVideo(row.recordingId);
              var url = URL.createObjectURL(blob);
              objectUrls.push(url);
              var media = li.querySelector('.owner-reviewed-media');
              media.classList.remove('hidden');
              media.innerHTML =
                '<video controls playsinline class="w-full max-h-64 rounded-lg bg-black" src="' + url + '"></video>';
            } catch (e) {
              window.alert(String(e.message || e));
            }
          });
          li.querySelector('[data-act="log"]').addEventListener('click', async function () {
            try {
              var json = await fetchStaffLog(row.inputLogId);
              var pre = li.querySelector('.owner-reviewed-log');
              pre.classList.remove('hidden');
              pre.textContent = JSON.stringify(json, null, 2);
            } catch (e) {
              window.alert(String(e.message || e));
            }
          });

          function addBtn(label, cls, fn) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'rounded-lg px-3 py-1.5 text-xs font-semibold ' + cls;
            b.textContent = label;
            b.addEventListener('click', fn);
            actions.appendChild(b);
          }

          addBtn('Approve', 'bg-emerald-700 text-white hover:bg-emerald-600', async function () {
            try {
              await review(row.id, 'approved', '');
              await loadList();
            } catch (e) {
              window.alert(String(e.message || e));
            }
          });
          addBtn('Decline', 'bg-rose-800 text-white hover:bg-rose-700', async function () {
            var reason = promptDeclineReason();
            if (reason === null) return;
            try {
              await review(row.id, 'declined', reason);
              await loadList();
            } catch (e) {
              window.alert(String(e.message || e));
            }
          });

          if (!row.statusLocked) {
            if (row.status === 'approved') {
              addBtn('Keep as Approve', 'border border-amber-500/50 text-amber-100 hover:bg-amber-950/40', async function () {
                if (!window.confirm('Lock this run as Approved? Moderators will not be able to change its status.')) return;
                try {
                  await lockRun(row.id);
                  await loadList();
                } catch (e) {
                  window.alert(String(e.message || e));
                }
              });
            }
            if (row.status === 'declined') {
              addBtn('Keep as Decline', 'border border-amber-500/50 text-amber-100 hover:bg-amber-950/40', async function () {
                if (!window.confirm('Lock this run as Declined? Moderators will not be able to change its status.')) return;
                try {
                  await lockRun(row.id);
                  await loadList();
                } catch (e) {
                  window.alert(String(e.message || e));
                }
              });
            }
          }

          ul.appendChild(li);
        })(rows[i]);
      }
    } catch (e) {
      setErr(String(e.message || e));
      if (ul) ul.innerHTML = '';
    }
  }

  function bind() {
    var nav = document.getElementById('btnNavReviewedRuns');
    if (nav) {
      nav.addEventListener('click', function () {
        show(true);
      });
    }
    var close = document.getElementById('btnOwnerReviewedRunsClose');
    if (close) close.addEventListener('click', function () { show(false); });
    var refresh = document.getElementById('ownerReviewedRunsRefresh');
    if (refresh) refresh.addEventListener('click', function () { void loadList(); });
  }

  window.SkyHopOwnerReviewedRuns = {
    syncNav: function (me) {
      var btn = document.getElementById('btnNavReviewedRuns');
      if (!btn) return;
      var showBtn = !!(me && me.role === 'owner');
      btn.classList.toggle('hidden', !showBtn);
      btn.classList.toggle('inline-flex', showBtn);
    },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
