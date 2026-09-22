/**
 * Input logs — key/touch events during gameplay, uploaded to the signed-in account.
 */
(function () {
  let logging = false;
  let gameplayActive = false;
  let sessionMeta = { title: 'Run', source: 'campaign', anticheatOn: true };
  var LOG_AC_OFF_MSG =
    'You can record the input log for this, but you would not be able to submit this run. Runs without anti-cheat are not eligible for leaderboards.';
  let startedAt = 0;
  let events = [];

  const btn = () => document.getElementById('btnRecordInputLog');

  function authToken() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN');
    } catch {
      return null;
    }
  }

  function apiBase() {
    if (typeof window.SkyHopApiOrigin === 'function') return window.SkyHopApiOrigin();
    return window.location.origin;
  }

  function notifyRecordState() {
    window.dispatchEvent(new CustomEvent('skyhop-record-state-changed'));
  }

  function syncButton() {
    var el = btn();
    if (!el) return;
    var show = gameplayActive && !!authToken();
    el.classList.toggle('hidden', !show);
    notifyRecordState();
    if (!show) return;
    if (logging) {
      el.textContent = 'End log';
      el.setAttribute('aria-label', 'End input log');
      el.classList.remove('bg-sky-600', 'hover:bg-sky-500');
      el.classList.add('bg-sky-800', 'hover:bg-sky-700', 'ring-2', 'ring-sky-400/80');
    } else {
      el.textContent = 'Record Input Log';
      el.setAttribute('aria-label', 'Start input log');
      el.classList.add('bg-sky-600', 'hover:bg-sky-500');
      el.classList.remove('bg-sky-800', 'hover:bg-sky-700', 'ring-2', 'ring-sky-400/80');
    }
  }

  function relTime() {
    return startedAt ? Math.max(0, Math.round(performance.now() - startedAt)) : 0;
  }

  function noteKeyEvent(e, phase) {
    if (!logging) return;
    if (!e || !e.code) return;
    events.push({ t: relTime(), phase: phase === 'up' ? 'up' : 'down', code: e.code, key: e.key || '' });
    if (events.length > 120000) logging = false;
  }

  async function uploadLog(payload) {
    const tok = authToken();
    if (!tok) throw new Error('Sign in to save input logs to your account.');
    const body = JSON.stringify(payload);
    const res = await fetch(apiBase() + '/api/input-logs/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok,
        'Content-Type': 'application/json',
        'X-Input-Log-Title': encodeURIComponent(String(payload.title || 'Run').slice(0, 120)),
        'X-Input-Log-Source': encodeURIComponent(String(payload.source || 'campaign').slice(0, 40)),
        'X-Anticheat-On': payload.anticheatOn === false ? '0' : '1',
      },
      body: body,
    });
    const text = await res.text();
    let data = null;
    try {
      if (text) data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) {
      throw new Error((data && data.error) || text || 'Upload failed');
    }
    return data && data.log ? data.log : data;
  }

  async function listLogs() {
    if (typeof window.SkyHopApiRequest !== 'function') {
      throw new Error('Sign in and reload the page to view input logs.');
    }
    const data = await window.SkyHopApiRequest('/api/input-logs/mine', {});
    return (data && data.logs) || [];
  }

  async function deleteLog(id) {
    if (typeof window.SkyHopApiRequest !== 'function') throw new Error('Not signed in');
    await window.SkyHopApiRequest('/api/input-logs/delete', {
      method: 'POST',
      body: JSON.stringify({ id: id }),
    });
  }

  async function fetchLogJson(logId) {
    const tok = authToken();
    if (!tok) throw new Error('Not signed in');
    const res = await fetch(apiBase() + '/api/input-logs/' + encodeURIComponent(logId) + '/data', {
      headers: { Authorization: 'Bearer ' + tok },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'Could not load log');
    }
    return res.json();
  }

  function startLogging(opts) {
    opts = opts || {};
    if (logging || !gameplayActive) return false;
    if (!authToken()) {
      window.alert('Sign in to record input logs — they save to your account.');
      return false;
    }
    if (window.SkyHopRunAnticheat && !window.SkyHopRunAnticheat.isRunOn() && !opts.skipAcAlert) {
      window.alert(LOG_AC_OFF_MSG);
    }
    if (opts.title) {
      sessionMeta.title = String(opts.title).trim().slice(0, 120) || sessionMeta.title;
    }
    events = [];
    startedAt = performance.now();
    logging = true;
    syncButton();
    return true;
  }

  async function stopLogging() {
    if (!logging) return null;
    logging = false;
    syncButton();
    const meta = Object.assign({}, sessionMeta);
    const payload = {
      v: 1,
      title: meta.title,
      source: meta.source,
      anticheatOn: meta.anticheatOn !== false,
      recordedAt: Date.now(),
      events: events.slice(),
    };
    events = [];
    startedAt = 0;
    if (!payload.events.length) return null;
    try {
      const saved = await uploadLog(payload);
      window.dispatchEvent(new CustomEvent('skyhop-input-log-saved', { detail: { id: saved && saved.id } }));
      return saved;
    } catch (e) {
      window.alert(String(e.message || e));
      return null;
    }
  }

  function setGameplayActive(active, meta) {
    gameplayActive = !!active;
    if (meta) {
      sessionMeta = {
        title: meta.title || sessionMeta.title,
        source: meta.source || sessionMeta.source,
        anticheatOn:
          meta.anticheatOn != null
            ? meta.anticheatOn !== false
            : !window.SkyHopRunAnticheat || window.SkyHopRunAnticheat.isRunOn(),
      };
    }
    if (!gameplayActive && logging) {
      void stopLogging();
    }
    syncButton();
  }

  function bindButton() {
    var el = btn();
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', function () {
      if (logging) void stopLogging();
      else startLogging();
    });
  }

  window.addEventListener('skyhop-auth-changed', syncButton);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButton);
  } else {
    bindButton();
  }

  window.SkyHopInputLog = {
    setGameplayActive: setGameplayActive,
    noteKeyEvent: noteKeyEvent,
    startLogging: startLogging,
    stopLogging: stopLogging,
    listLogs: listLogs,
    deleteLog: deleteLog,
    fetchLogJson: fetchLogJson,
    isLogging: function () {
      return logging;
    },
    isGameplayActive: function () {
      return gameplayActive;
    },
    getSessionTitle: function () {
      return sessionMeta.title || 'Run';
    },
  };

  function combinedBtn() {
    return document.getElementById('btnRecordRunAndInputLog');
  }

  function bothActive() {
    var rec = window.SkyHopRecording;
    return !!(rec && rec.isRecording() && logging);
  }

  function syncCombinedButton() {
    var el = combinedBtn();
    if (!el) return;
    var rec = window.SkyHopRecording;
    var recReady = rec && typeof rec.isGameplayActive === 'function' ? rec.isGameplayActive() : gameplayActive;
    var show = recReady && gameplayActive && !!authToken() && typeof MediaRecorder !== 'undefined';
    el.classList.toggle('hidden', !show);
    if (!show) return;
    if (bothActive()) {
      el.textContent = 'End both';
      el.setAttribute('aria-label', 'End recording and input log');
      el.classList.remove('bg-violet-700', 'hover:bg-violet-600');
      el.classList.add('bg-violet-900', 'hover:bg-violet-800', 'ring-2', 'ring-violet-400/80');
    } else {
      el.textContent = 'Record Run and Input Log';
      el.setAttribute('aria-label', 'Start recording and input log');
      el.classList.add('bg-violet-700', 'hover:bg-violet-600');
      el.classList.remove('bg-violet-900', 'hover:bg-violet-800', 'ring-2', 'ring-violet-400/80');
    }
  }

  async function toggleCombinedRecord() {
    var rec = window.SkyHopRecording;
    if (!rec || typeof rec.startRecording !== 'function') {
      window.alert('Recording is not available. Reload the page.');
      return;
    }
    if (bothActive()) {
      var stops = [];
      if (rec.isRecording()) stops.push(rec.stopRecording());
      if (logging) stops.push(stopLogging());
      await Promise.all(stops);
      syncCombinedButton();
      return;
    }
    if (!authToken()) {
      window.alert('Sign in to record runs and input logs — they save to your account.');
      return;
    }
    if (window.SkyHopRunAnticheat && !window.SkyHopRunAnticheat.isRunOn()) {
      window.alert(LOG_AC_OFF_MSG);
    }
    var defName = rec.getSessionTitle ? rec.getSessionTitle() : sessionMeta.title || 'Run';
    var title = defName;
    if (!rec.isRecording()) {
      var typed = window.prompt('Name this run', defName);
      if (typed == null) return;
      title = String(typed).trim().slice(0, 120) || defName;
    }
    var startedRec = rec.isRecording()
      ? true
      : await rec.startRecording({ skipPrompt: true, skipAcAlert: true, title: title });
    var startedLog = logging ? true : startLogging({ skipAcAlert: true, title: title });
    if (!startedRec && !startedLog) {
      window.alert('Could not start recording and input log.');
    }
    syncCombinedButton();
  }

  function bindCombinedButton() {
    var el = combinedBtn();
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', function () {
      void toggleCombinedRecord();
    });
  }

  window.addEventListener('skyhop-record-state-changed', syncCombinedButton);
  window.addEventListener('skyhop-auth-changed', syncCombinedButton);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      bindCombinedButton();
      syncCombinedButton();
    });
  } else {
    bindCombinedButton();
    syncCombinedButton();
  }
})();
