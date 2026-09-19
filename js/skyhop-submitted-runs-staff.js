/**
 * Staff page: search player + filter status, review submitted runs.
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
    return document.getElementById('screenSubmittedRunsStaff');
  }

  function setErr(t) {
    var el = document.getElementById('staffSubmitRunErr');
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

  function show(on) {
    var el = screen();
    if (!el) return;
    el.classList.toggle('hidden', !on);
    if (!on) {
      revokeUrls();
      var list = document.getElementById('staffSubmitRunList');
      if (list) list.innerHTML = '';
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

  async function review(id, status, declineReason) {
    await api('/api/staff/submitted-runs/review', {
      method: 'POST',
      body: JSON.stringify({ id: id, status: status, declineReason: declineReason || '' }),
    });
  }

  function statusLabel(st) {
    if (st === 'approved') return 'Approved';
    if (st === 'declined') return 'Declined';
    return 'Unreviewed';
  }

  async function runSearch() {
    setErr('');
    revokeUrls();
    var ul = document.getElementById('staffSubmitRunList');
    if (ul) ul.innerHTML = '<li class="text-sm text-slate-400">Loading…</li>';
    var username = String((document.getElementById('staffSubmitRunUser') || {}).value || '').trim();
    var status = (document.getElementById('staffSubmitRunStatus') || {}).value || 'unreviewed';
    if (!username) {
      setErr('Enter a player username, then search.');
      if (ul) ul.innerHTML = '';
      return;
    }
    try {
      var data = await api(
        '/api/staff/submitted-runs?username=' + encodeURIComponent(username) + '&status=' + encodeURIComponent(status),
        { method: 'GET' }
      );
      var rows = (data && data.submissions) || [];
      if (!ul) return;
      ul.innerHTML = '';
      if (!rows.length) {
        ul.innerHTML =
          '<li class="rounded-xl border border-white/10 bg-slate-900/60 p-4 text-center text-sm text-slate-400">No runs for this player and filter.</li>';
        return;
      }
      for (var i = 0; i < rows.length; i++) {
        (function (row) {
          var li = document.createElement('li');
          li.className = 'rounded-2xl border border-white/10 bg-slate-950/70 p-4 text-sm';
          li.innerHTML =
            '<p class="font-semibold text-white">' +
            row.username.replace(/</g, '&lt;') +
            ' · <span class="text-violet-300">' +
            statusLabel(row.status) +
            '</span>' +
            (row.statusLocked ? ' · <span class="text-amber-300">Locked</span>' : '') +
            '</p>' +
            '<p class="mt-1 text-xs text-slate-400">' +
            String(row.difficulty || '').toUpperCase() +
            ' · time ' +
            fmtClock(row.timeMs) +
            ' · deaths ' +
            String(row.deaths) +
            '</p>' +
            (row.playerNote
              ? '<p class="mt-2 text-xs text-slate-300">Note: ' + String(row.playerNote).replace(/</g, '&lt;') + '</p>'
              : '') +
            '<div class="mt-3 flex flex-wrap gap-2">' +
            '<button type="button" data-act="video" class="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5">Watch recording</button>' +
            '<button type="button" data-act="log" class="rounded-lg border border-white/15 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/5">View input log</button>' +
            '</div>' +
            '<div class="staff-submit-media mt-3 hidden"></div>' +
            '<pre class="staff-submit-log mt-3 hidden max-h-48 overflow-auto rounded-lg bg-black/50 p-2 text-[10px] text-emerald-200"></pre>' +
            '<div class="mt-3 flex flex-wrap gap-2 staff-submit-actions"></div>';
          var media = li.querySelector('.staff-submit-media');
          var pre = li.querySelector('.staff-submit-log');
          var actions = li.querySelector('.staff-submit-actions');

          li.querySelector('[data-act="video"]').addEventListener('click', async function () {
            try {
              var blob = await fetchStaffVideo(row.recordingId);
              var url = URL.createObjectURL(blob);
              objectUrls.push(url);
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
              pre.classList.remove('hidden');
              pre.textContent = JSON.stringify(json, null, 2);
            } catch (e) {
              window.alert(String(e.message || e));
            }
          });

          function addBtn(label, st) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className =
              'rounded-lg px-3 py-1.5 text-xs font-semibold ' +
              (st === 'approved'
                ? 'bg-emerald-700 text-white hover:bg-emerald-600'
                : st === 'declined'
                  ? 'bg-rose-800 text-white hover:bg-rose-700'
                  : 'border border-white/15 text-slate-200 hover:bg-white/5');
            b.textContent = label;
            b.addEventListener('click', async function () {
              try {
                var reason = '';
                if (st === 'declined') {
                  reason = promptDeclineReason();
                  if (reason === null) return;
                }
                await review(row.id, st, reason);
                await runSearch();
              } catch (e) {
                window.alert(String(e.message || e));
              }
            });
            actions.appendChild(b);
          }

          if (row.statusLocked) {
            var note = document.createElement('p');
            note.className = 'mt-2 text-xs text-amber-200/90';
            note.textContent = 'Status locked by the site owner — moderators cannot change this run.';
            actions.appendChild(note);
          } else if (row.status === 'unreviewed') {
            addBtn('Approve', 'approved');
            addBtn('Decline', 'declined');
          } else if (row.status === 'approved') {
            addBtn('Change to Decline', 'declined');
          } else if (row.status === 'declined') {
            addBtn('Change to Approved', 'approved');
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
    var open = document.getElementById('btnModSubmittedRuns');
    if (open) {
      open.addEventListener('click', function () {
        var dash = document.getElementById('screenModDashboard');
        if (dash) {
          dash.classList.add('hidden');
          dash.classList.remove('flex');
        }
        show(true);
        setErr('Enter a username and status filter, then search.');
      });
    }
    var close = document.getElementById('btnStaffSubmitRunClose');
    if (close) close.addEventListener('click', function () { show(false); });
    var search = document.getElementById('staffSubmitRunSearch');
    if (search) search.addEventListener('click', function () { void runSearch(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.SkyHopSubmittedRunsStaff = { open: function () { show(true); } };
})();
