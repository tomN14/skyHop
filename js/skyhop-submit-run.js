/**
 * Submit Run wizard: pick recording(s) → pick input log(s) → submit for moderator review.
 * Selection order is first tap to last tap.
 */
(function () {
  var step = 1;
  var pickedRecordingIds = [];
  var pickedLogIds = [];
  var MULTI_ORDER_NOTICE =
    'Double-check that the recordings and input logs you selected are in chronological order (first selected is the start of the run). If they are out of order, staff may decline the run.';

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

  function syncMultiNotice() {
    var el = document.getElementById('submitRunMultiNotice');
    if (!el) return;
    var show = pickedRecordingIds.length > 1;
    el.textContent = MULTI_ORDER_NOTICE;
    el.classList.toggle('hidden', !show);
  }

  function show(on) {
    var el = screen();
    if (!el) return;
    el.classList.toggle('hidden', !on);
    if (on) {
      step = 1;
      pickedRecordingIds = [];
      pickedLogIds = [];
      setErr('');
      syncMultiNotice();
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
    if (next1) next1.disabled = !pickedRecordingIds.length;
    var submitBtn = document.getElementById('submitRunSubmit');
    if (submitBtn) submitBtn.disabled = step === 3 ? false : !pickedLogIds.length;
    var next2 = document.getElementById('submitRunNext2');
    if (next2) next2.disabled = !pickedLogIds.length;
    syncMultiNotice();
  }

  var SUBMIT_AC_OFF_MSG = 'You may not submit this run as anti-cheat was off.';

  function isAnticheatOff(it) {
    return !!(it && (it.anticheatOn === false || it.anticheat_on === false));
  }

  function toggleId(arr, id) {
    var i = arr.indexOf(id);
    if (i >= 0) arr.splice(i, 1);
    else arr.push(id);
    return arr;
  }

  function orderOf(arr, id) {
    return arr.indexOf(id) + 1;
  }

  function renderPickList(ul, items, kind, selectedIds) {
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
      var ord = orderOf(selectedIds, id);
      var sel = ord > 0;
      li.className =
        'cursor-pointer rounded-xl border px-3 py-3 text-sm ' +
        (sel ? 'border-violet-400 bg-violet-950/50' : 'border-white/10 bg-slate-900/60 hover:bg-slate-800/80');
      var title = it.title || (kind === 'recording' ? 'Recording' : 'Input log');
      var when = it.created_at ? new Date(it.created_at).toLocaleString() : '';
      var acOff = isAnticheatOff(it);
      li.innerHTML =
        '<div class="flex items-start gap-2">' +
        (sel
          ? '<span class="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] font-bold text-white">' +
            ord +
            '</span>'
          : '<span class="mt-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-white/15 text-[10px] text-slate-500">+</span>') +
        '<div class="min-w-0 flex-1"><p class="font-semibold text-white">' +
        title.replace(/</g, '&lt;') +
        '</p><p class="mt-1 text-xs text-slate-400">' +
        (it.source || '') +
        (when ? ' · ' + when : '') +
        (acOff ? ' · Anti-cheat off' : '') +
        '</p></div></div>';
      li.addEventListener('click', function (item, k) {
        return function () {
          if (isAnticheatOff(item)) {
            window.alert(SUBMIT_AC_OFF_MSG);
            return;
          }
          if (k === 'recording') {
            toggleId(pickedRecordingIds, item.id);
            step = 1;
            void loadStep1();
          } else {
            toggleId(pickedLogIds, item.id);
            void loadStep2();
          }
          syncSteps();
        };
      }(it, kind));
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
      renderPickList(ul, recs, 'recording', pickedRecordingIds);
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
      renderPickList(ul, logs, 'log', pickedLogIds);
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
        if (!pickedRecordingIds.length) return;
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
        if (!pickedLogIds.length) return;
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
        if (!pickedRecordingIds.length || !pickedLogIds.length) {
          setErr('Pick at least one recording and one input log.');
          return;
        }
        submitBtn.disabled = true;
        try {
          var out = await api('/api/submitted-runs/submit', {
            method: 'POST',
            body: JSON.stringify({
              recordingId: pickedRecordingIds[0],
              inputLogId: pickedLogIds[0],
              recordingIds: pickedRecordingIds.slice(),
              inputLogIds: pickedLogIds.slice(),
              difficulty: diff,
              timeMs: timeMs,
              deaths: deaths,
              playerNote: note,
            }),
          });
          var awarded =
            out && out.submission && out.submission.coinsAwarded != null
              ? Number(out.submission.coinsAwarded)
              : 0;
          if (awarded > 0 && window.__skyhopLastMe && !window.__skyhopLastMe.coinsInfinite) {
            window.__skyhopLastMe.coins = (Number(window.__skyhopLastMe.coins) || 0) + awarded;
            var acc = document.getElementById('accStatCoins');
            if (acc) acc.textContent = String(window.__skyhopLastMe.coins);
            var shop = document.getElementById('shopCoinBalance');
            if (shop) shop.textContent = String(window.__skyhopLastMe.coins);
          }
          var msg = 'Run submitted! Moderators will review it under Submitted Runs.';
          if (awarded > 0) msg = 'Run submitted! +' + awarded + ' coins. Moderators will review it under Submitted Runs.';
          window.alert(msg);
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
