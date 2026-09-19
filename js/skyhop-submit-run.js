/**
 * Submit Run wizard: pick recording → pick input log → submit for moderator review.
 */
(function () {
  var step = 1;
  var pickedRecordingId = '';
  var pickedLogId = '';

  function api(path, opts) {
    if (typeof window.SkyHopApiRequest !== 'function') {
      return Promise.reject(new Error('Sign in first'));
    }
    return window.SkyHopApiRequest(path, opts || {});
  }

  function screen() {
    return document.getElementById('screenSubmitRun');
  }

  function setErr(t) {
    var el = document.getElementById('submitRunErr');
    if (!el) return;
    el.textContent = t || '';
    el.classList.toggle('hidden', !t);
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
    if (on) {
      step = 1;
      pickedRecordingId = '';
      pickedLogId = '';
      setErr('');
      syncSteps();
      void loadStep1();
    }
  }

  function syncSteps() {
    var s1 = document.getElementById('submitRunStep1');
    var s2 = document.getElementById('submitRunStep2');
    var s3 = document.getElementById('submitRunStep3');
    if (s1) s1.classList.toggle('hidden', step !== 1);
    if (s2) s2.classList.toggle('hidden', step !== 2);
    if (s3) s3.classList.toggle('hidden', step !== 3);
    var next1 = document.getElementById('submitRunNext1');
    if (next1) next1.disabled = !pickedRecordingId;
    var submitBtn = document.getElementById('submitRunSubmit');
    if (submitBtn) submitBtn.disabled = step === 3 ? false : !pickedLogId;
    var next2 = document.getElementById('submitRunNext2');
    if (next2) next2.disabled = !pickedLogId;
  }

  function renderPickList(ul, items, kind, selectedId) {
    if (!ul) return;
    ul.innerHTML = '';
    if (!items.length) {
      ul.innerHTML =
        '<li class="rounded-xl border border-white/10 bg-slate-900/60 p-4 text-center text-sm text-slate-400">Nothing here yet — record during a campaign run while signed in.</li>';
      return;
    }
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var id = it.id;
      var li = document.createElement('li');
      var sel = id === selectedId;
      li.className =
        'cursor-pointer rounded-xl border px-3 py-3 text-sm ' +
        (sel ? 'border-violet-400 bg-violet-950/50' : 'border-white/10 bg-slate-900/60 hover:bg-slate-800/80');
      var title = it.title || (kind === 'recording' ? 'Recording' : 'Input log');
      var when = it.created_at ? new Date(it.created_at).toLocaleString() : '';
      li.innerHTML =
        '<p class="font-semibold text-white">' +
        title.replace(/</g, '&lt;') +
        '</p><p class="mt-1 text-xs text-slate-400">' +
        (it.source || '') +
        (when ? ' · ' + when : '') +
        '</p>';
      li.addEventListener('click', function (itemId, k) {
        return function () {
          if (k === 'recording') {
            pickedRecordingId = itemId;
            step = 1;
          } else {
            pickedLogId = itemId;
          }
          syncSteps();
          if (k === 'recording') void loadStep1();
          else void loadStep2();
        };
      }(id, kind));
      ul.appendChild(li);
    }
  }

  async function loadStep1() {
    var ul = document.getElementById('submitRunRecordingsList');
    if (!window.SkyHopRecording || typeof window.SkyHopRecording.listClips !== 'function') {
      if (ul) ul.innerHTML = '<li class="text-sm text-rose-300">Recordings unavailable.</li>';
      return;
    }
    try {
      var recs = await window.SkyHopRecording.listClips();
      renderPickList(ul, recs, 'recording', pickedRecordingId);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  async function loadStep2() {
    var ul = document.getElementById('submitRunLogsList');
    if (!window.SkyHopInputLog || typeof window.SkyHopInputLog.listLogs !== 'function') {
      if (ul) ul.innerHTML = '<li class="text-sm text-rose-300">Input logs unavailable.</li>';
      return;
    }
    try {
      var logs = await window.SkyHopInputLog.listLogs();
      renderPickList(ul, logs, 'log', pickedLogId);
    } catch (e) {
      setErr(String(e.message || e));
    }
  }

  function bind() {
    var back = document.getElementById('btnSubmitRunBack');
    if (back) {
      back.addEventListener('click', function () {
        show(false);
      });
    }
    var nav = document.getElementById('btnNavSubmitRun');
    if (nav) {
      nav.addEventListener('click', function () {
        try {
          if (!localStorage.getItem('SKYHOP_AUTH_TOKEN')) {
            window.alert('Sign in to submit a run for leaderboard review.');
            return;
          }
        } catch {
          window.alert('Sign in to submit a run.');
          return;
        }
        show(true);
      });
    }
    var next1 = document.getElementById('submitRunNext1');
    if (next1) {
      next1.addEventListener('click', function () {
        if (!pickedRecordingId) return;
        step = 2;
        setErr('');
        syncSteps();
        void loadStep2();
      });
    }
    var back2 = document.getElementById('submitRunBack2');
    if (back2) {
      back2.addEventListener('click', function () {
        step = 1;
        syncSteps();
      });
    }
    var next2 = document.getElementById('submitRunNext2');
    if (next2) {
      next2.disabled = true;
      next2.addEventListener('click', function () {
        if (!pickedLogId) return;
        step = 3;
        setErr('');
        syncSteps();
        var diffEl = document.getElementById('submitRunDifficulty');
        var timeEl = document.getElementById('submitRunTimeMs');
        var deathsEl = document.getElementById('submitRunDeaths');
        if (timeEl && !timeEl.value) timeEl.placeholder = 'e.g. 123456 (milliseconds)';
        if (deathsEl && !deathsEl.value) deathsEl.value = '0';
        if (diffEl && !diffEl.value) diffEl.value = 'normal';
      });
    }
    var back3 = document.getElementById('submitRunBack3');
    if (back3) {
      back3.addEventListener('click', function () {
        step = 2;
        syncSteps();
      });
    }
    var submitBtn = document.getElementById('submitRunSubmit');
    if (submitBtn) {
      submitBtn.addEventListener('click', async function () {
        setErr('');
        var diff = (document.getElementById('submitRunDifficulty') || {}).value || 'normal';
        var timeMs = Number((document.getElementById('submitRunTimeMs') || {}).value);
        var deaths = Number((document.getElementById('submitRunDeaths') || {}).value);
        var note = String((document.getElementById('submitRunNote') || {}).value || '').trim();
        if (!pickedRecordingId || !pickedLogId) {
          setErr('Pick a recording and input log.');
          return;
        }
        submitBtn.disabled = true;
        try {
          await api('/api/submitted-runs/submit', {
            method: 'POST',
            body: JSON.stringify({
              recordingId: pickedRecordingId,
              inputLogId: pickedLogId,
              difficulty: diff,
              timeMs: timeMs,
              deaths: deaths,
              playerNote: note,
            }),
          });
          window.alert('Run submitted! Moderators will review it under Submitted Runs.');
          show(false);
        } catch (e) {
          setErr(String(e.message || e));
        } finally {
          submitBtn.disabled = false;
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.SkyHopSubmitRun = { open: show, close: function () { show(false); } };
})();
