/**
 * Local run recordings (canvas capture → IndexedDB). No server upload.
 */
(function () {
  const DB_NAME = 'skyhop-recordings-v1';
  const DB_VER = 1;
  const STORE = 'clips';

  let dbPromise = null;
  let mediaRecorder = null;
  let recordChunks = [];
  let captureStream = null;
  let recording = false;
  let gameplayActive = false;
  let sessionMeta = { title: 'Run', source: 'campaign' };

  const btn = () => document.getElementById('btnRecordRun');

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onerror = function () {
        reject(req.error || new Error('IndexedDB unavailable'));
      };
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () {
        resolve(req.result);
      };
    });
    return dbPromise;
  }

  function pickMimeType() {
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (var i = 0; i < types.length; i++) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  function syncRecordButton() {
    var el = btn();
    if (!el) return;
    var show = gameplayActive && typeof MediaRecorder !== 'undefined';
    el.classList.toggle('hidden', !show);
    if (!show) return;
    if (recording) {
      el.textContent = 'End';
      el.setAttribute('aria-label', 'End recording');
      el.classList.remove('bg-red-600', 'hover:bg-red-500');
      el.classList.add('bg-red-700', 'hover:bg-red-600', 'ring-2', 'ring-red-400/80');
    } else {
      el.textContent = 'Record';
      el.setAttribute('aria-label', 'Start recording');
      el.classList.add('bg-red-600', 'hover:bg-red-500');
      el.classList.remove('bg-red-700', 'hover:bg-red-600', 'ring-2', 'ring-red-400/80');
    }
  }

  function stopCaptureTracks() {
    if (captureStream) {
      captureStream.getTracks().forEach(function (t) {
        t.stop();
      });
    }
    captureStream = null;
  }

  async function saveClip(blob, meta) {
    var db = await openDb();
    var id = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'rec-' + Date.now();
    var entry = {
      id: id,
      title: String(meta.title || 'Run').slice(0, 120),
      source: String(meta.source || 'campaign'),
      createdAt: Date.now(),
      mimeType: blob.type || meta.mimeType || 'video/webm',
      blob: blob,
    };
    await new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(tx.error);
      };
      tx.objectStore(STORE).put(entry);
    });
    return entry;
  }

  async function listClips() {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readonly');
      var req = tx.objectStore(STORE).getAll();
      req.onsuccess = function () {
        var rows = req.result || [];
        rows.sort(function (a, b) {
          return (b.createdAt || 0) - (a.createdAt || 0);
        });
        resolve(rows);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  async function deleteClip(id) {
    var db = await openDb();
    await new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = function () {
        resolve();
      };
      tx.onerror = function () {
        reject(tx.error);
      };
      tx.objectStore(STORE).delete(id);
    });
  }

  async function getClip(id) {
    var db = await openDb();
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(STORE, 'readonly');
      var req = tx.objectStore(STORE).get(id);
      req.onsuccess = function () {
        resolve(req.result || null);
      };
      req.onerror = function () {
        reject(req.error);
      };
    });
  }

  function getCanvas() {
    return document.getElementById('gameCanvas');
  }

  async function startRecording() {
    if (recording || !gameplayActive) return false;
    var canvas = getCanvas();
    if (!canvas || typeof canvas.captureStream !== 'function') {
      window.alert('Recording is not supported in this browser.');
      return false;
    }
    var mimeType = pickMimeType();
    if (!mimeType) {
      window.alert('Video recording is not supported in this browser.');
      return false;
    }
    try {
      captureStream = canvas.captureStream(30);
      recordChunks = [];
      mediaRecorder = new MediaRecorder(captureStream, { mimeType: mimeType, videoBitsPerSecond: 2500000 });
      mediaRecorder.ondataavailable = function (e) {
        if (e.data && e.data.size > 0) recordChunks.push(e.data);
      };
      mediaRecorder.start(250);
      recording = true;
      syncRecordButton();
      return true;
    } catch (e) {
      stopCaptureTracks();
      window.alert(String(e.message || e));
      return false;
    }
  }

  async function stopRecording() {
    if (!recording || !mediaRecorder) return null;
    var mr = mediaRecorder;
    var meta = Object.assign({}, sessionMeta);
    var mimeType = mr.mimeType || pickMimeType() || 'video/webm';
    recording = false;
    syncRecordButton();
    var blob = await new Promise(function (resolve, reject) {
      mr.onstop = function () {
        try {
          resolve(new Blob(recordChunks, { type: mimeType }));
        } catch (err) {
          reject(err);
        }
      };
      mr.onerror = function () {
        reject(mr.error || new Error('Recording failed'));
      };
      try {
        mr.stop();
      } catch (e2) {
        reject(e2);
      }
    });
    mediaRecorder = null;
    recordChunks = [];
    stopCaptureTracks();
    if (!blob.size) return null;
    var saved = await saveClip(blob, { title: meta.title, source: meta.source, mimeType: mimeType });
    window.dispatchEvent(new CustomEvent('skyhop-recording-saved', { detail: { id: saved.id } }));
    return saved;
  }

  function setGameplayActive(active, meta) {
    gameplayActive = !!active;
    if (meta) {
      sessionMeta = {
        title: meta.title || sessionMeta.title,
        source: meta.source || sessionMeta.source,
      };
    }
    if (!gameplayActive && recording) {
      void stopRecording();
    }
    syncRecordButton();
  }

  function bindButton() {
    var el = btn();
    if (!el || el.dataset.bound) return;
    el.dataset.bound = '1';
    el.addEventListener('click', function () {
      if (recording) void stopRecording();
      else void startRecording();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButton);
  } else {
    bindButton();
  }

  window.SkyHopRecording = {
    setGameplayActive: setGameplayActive,
    startRecording: startRecording,
    stopRecording: stopRecording,
    listClips: listClips,
    deleteClip: deleteClip,
    getClip: getClip,
    isRecording: function () {
      return recording;
    },
  };
})();
