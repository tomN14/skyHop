/**
 * Input logs — key/touch events during gameplay, uploaded to the signed-in account.
 */
(function () {
  let logging = false;
  let gameplayActive = false;
  let sessionMeta = { title: 'Run', source: 'campaign' };
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

  function syncButton() {
    var el = btn();
    if (!el) return;
    var show = gameplayActive && !!authToken();
    el.classList.toggle('hidden', !show);
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

  function startLogging() {
    if (logging || !gameplayActive) return false;
    if (!authToken()) {
      window.alert('Sign in to record input logs — they save to your account.');
      return false;
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
  };
})();
