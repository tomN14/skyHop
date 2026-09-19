/**
 * Run recordings — canvas capture, uploaded to the signed-in account (server storage).
 */
(function () {
  let mediaRecorder = null;
  let recordChunks = [];
  let captureStream = null;
  let recording = false;
  let gameplayActive = false;
  let sessionMeta = { title: 'Run', source: 'campaign' };

  const btn = () => document.getElementById('btnRecordRun');

  function authToken() {
    try {
      return localStorage.getItem('SKYHOP_AUTH_TOKEN');
    } catch {
      return null;
    }
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
    var show = gameplayActive && typeof MediaRecorder !== 'undefined' && !!authToken();
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

  async function uploadClip(blob, meta) {
    const tok = authToken();
    if (!tok) throw new Error('Sign in to save recordings to your account.');
    const res = await fetch('/api/recordings/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok,
        'Content-Type': blob.type || meta.mimeType || 'video/webm',
        'X-Recording-Title': encodeURIComponent(String(meta.title || 'Run').slice(0, 120)),
        'X-Recording-Source': encodeURIComponent(String(meta.source || 'campaign').slice(0, 40)),
      },
      body: blob,
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
    return data && data.recording ? data.recording : data;
  }

  async function listClips() {
    if (typeof window.SkyHopApiRequest !== 'function') {
      throw new Error('Sign in and reload the page to view recordings.');
    }
    const data = await window.SkyHopApiRequest('/api/recordings/mine', {});
    return (data && data.recordings) || [];
  }

  async function deleteClip(id) {
    if (typeof window.SkyHopApiRequest !== 'function') {
      throw new Error('Not signed in');
    }
    await window.SkyHopApiRequest('/api/recordings/delete', {
      method: 'POST',
      body: JSON.stringify({ id: id }),
    });
  }

  async function fetchVideoBlob(recordingId) {
    const tok = authToken();
    if (!tok) throw new Error('Not signed in');
    const res = await fetch('/api/recordings/' + encodeURIComponent(recordingId) + '/video', {
      headers: { Authorization: 'Bearer ' + tok },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'Could not load video');
    }
    return res.blob();
  }

  function getCanvas() {
    return document.getElementById('gameCanvas');
  }

  async function startRecording() {
    if (recording || !gameplayActive) return false;
    if (!authToken()) {
      window.alert('Sign in to record runs — clips save to your account.');
      return false;
    }
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
    try {
      var saved = await uploadClip(blob, { title: meta.title, source: meta.source, mimeType: mimeType });
      window.dispatchEvent(new CustomEvent('skyhop-recording-saved', { detail: { id: saved && saved.id } }));
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

  window.addEventListener('skyhop-auth-changed', syncRecordButton);

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
    fetchVideoBlob: fetchVideoBlob,
    isRecording: function () {
      return recording;
    },
  };
})();
