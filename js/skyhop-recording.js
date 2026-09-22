/**
 * Run recordings — canvas capture, uploaded to the signed-in account (server storage).
 */
(function () {
  var RECORD_AC_OFF_MSG =
    'You can record this, but you would not be able to submit this run. Runs without anti-cheat are not eligible for leaderboards.';

  window.SkyHopRunAnticheat = {
    hostOn: true,
    runOn: true,
    isRunOn: function () {
      return this.runOn !== false;
    },
    setHostOn: function (on) {
      this.hostOn = !!on;
      this.syncToggles();
    },
    beginSession: function (on) {
      this.runOn = on !== false;
    },
    endSession: function () {
      this.runOn = true;
    },
    syncToggles: function () {
      var on = this.hostOn !== false;
      document.querySelectorAll('.skyhop-anticheat-toggle').forEach(function (btn) {
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        var st = btn.querySelector('.anticheat-state');
        if (st) st.textContent = on ? 'On' : 'Off';
        btn.classList.toggle('border-emerald-500/50', on);
        btn.classList.toggle('bg-emerald-950/50', on);
        btn.classList.toggle('text-emerald-100', on);
        btn.classList.toggle('hover:bg-emerald-900/50', on);
        btn.classList.toggle('border-white/20', !on);
        btn.classList.toggle('bg-slate-800/80', !on);
        btn.classList.toggle('text-slate-300', !on);
        btn.classList.toggle('hover:bg-slate-700', !on);
      });
    },
    bindToggles: function () {
      var self = this;
      document.querySelectorAll('.skyhop-anticheat-toggle').forEach(function (btn) {
        if (btn.dataset.acBound) return;
        btn.dataset.acBound = '1';
        btn.addEventListener('click', function () {
          self.setHostOn(!self.hostOn);
        });
      });
      this.syncToggles();
    },
  };
  let mediaRecorder = null;
  let recordChunks = [];
  let captureStream = null;
  let recording = false;
  let gameplayActive = false;
  let sessionMeta = { title: 'Run', source: 'campaign', anticheatOn: true };
  let namedTitle = null;
  var SPLIT_AFTER_MS = 25 * 60 * 1000;
  var CHUNK_MS = 15 * 60 * 1000;
  var SOFT_MAX_BYTES = Math.floor(256 * 1024 * 1024 * 0.92);
  var recordStartedAt = 0;
  var segmentStartedAt = 0;
  var splitTimer = null;
  var rotating = false;
  var pendingBlobs = [];
  var uploadedPartCount = 0;
  var savedRecordings = [];
  var uploadChain = Promise.resolve();
  var recordMimeType = '';
  var stopping = false;

  const btn = () => document.getElementById('btnRecordRun');

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

  function pickMimeType() {
    const types = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    for (var i = 0; i < types.length; i++) {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return '';
  }

  function notifyRecordState() {
    window.dispatchEvent(new CustomEvent('skyhop-record-state-changed'));
  }

  function syncRecordButton() {
    var el = btn();
    if (!el) return;
    var show = gameplayActive && typeof MediaRecorder !== 'undefined' && !!authToken();
    el.classList.toggle('hidden', !show);
    notifyRecordState();
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
    const res = await fetch(apiBase() + '/api/recordings/upload', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + tok,
        'Content-Type': blob.type || meta.mimeType || 'video/webm',
        'X-Recording-Title': encodeURIComponent(String(meta.title || 'Run').slice(0, 120)),
        'X-Recording-Source': encodeURIComponent(String(meta.source || 'campaign').slice(0, 40)),
        'X-Anticheat-On': meta.anticheatOn === false ? '0' : '1',
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

  async function renameClip(id, title) {
    if (typeof window.SkyHopApiRequest !== 'function') {
      throw new Error('Not signed in');
    }
    const data = await window.SkyHopApiRequest('/api/recordings/rename', {
      method: 'POST',
      body: JSON.stringify({ id: id, title: title }),
    });
    return data && data.recording ? data.recording : data;
  }

  function videoPlaybackUrl(recordingId) {
    const tok = authToken();
    if (!tok) return '';
    return (
      apiBase() +
      '/api/recordings/' +
      encodeURIComponent(recordingId) +
      '/video?access_token=' +
      encodeURIComponent(tok)
    );
  }

  async function fetchVideoBlob(recordingId) {
    const tok = authToken();
    if (!tok) throw new Error('Not signed in');
    const res = await fetch(videoPlaybackUrl(recordingId) || apiBase() + '/api/recordings/' + encodeURIComponent(recordingId) + '/video', {
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

  function chunkBytes(chunks) {
    var n = 0;
    for (var i = 0; i < (chunks || []).length; i++) n += chunks[i].size || 0;
    return n;
  }

  function stopRecorderToBlob(mr, chunks, mime) {
    return new Promise(function (resolve, reject) {
      if (!mr || mr.state === 'inactive') {
        resolve(chunks && chunks.length ? new Blob(chunks, { type: mime }) : null);
        return;
      }
      mr.onstop = function () {
        try {
          resolve(chunks && chunks.length ? new Blob(chunks, { type: mime }) : null);
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
  }

  function startRecorderOnStream() {
    recordChunks = [];
    mediaRecorder = new MediaRecorder(captureStream, {
      mimeType: recordMimeType,
      videoBitsPerSecond: 1000000,
    });
    mediaRecorder.ondataavailable = function (e) {
      if (e.data && e.data.size > 0) recordChunks.push(e.data);
    };
    mediaRecorder.start(250);
    segmentStartedAt = performance.now();
  }

  function shouldRotateSegment() {
    if (!recording || !mediaRecorder) return false;
    var now = performance.now();
    var sessionMs = now - recordStartedAt;
    var segmentMs = now - segmentStartedAt;
    if (sessionMs <= SPLIT_AFTER_MS) return false;
    if (chunkBytes(recordChunks) >= SOFT_MAX_BYTES) return true;
    if (uploadedPartCount === 0 && pendingBlobs.length === 0) return sessionMs > SPLIT_AFTER_MS;
    return segmentMs >= CHUNK_MS;
  }

  function clipTitleForPart(partNum, multi) {
    var base = namedTitle || sessionMeta.title || 'Run';
    if (!multi && partNum <= 1) return base;
    return base + ' (' + partNum + ')';
  }

  async function flushPendingUploads(multi) {
    var meta = Object.assign({}, sessionMeta);
    while (pendingBlobs.length) {
      var blob = pendingBlobs.shift();
      if (!blob || !blob.size) continue;
      uploadedPartCount += 1;
      var saved = await uploadClip(blob, {
        title: clipTitleForPart(uploadedPartCount, multi || uploadedPartCount > 1 || pendingBlobs.length > 0),
        source: meta.source,
        mimeType: blob.type || recordMimeType || 'video/webm',
        anticheatOn: meta.anticheatOn !== false,
      });
      if (saved) savedRecordings.push(saved);
    }
  }

  function queuePendingUploads(multi) {
    uploadChain = uploadChain
      .then(function () {
        return flushPendingUploads(multi);
      })
      .catch(function (e) {
        window.alert(String((e && e.message) || e));
      });
    return uploadChain;
  }

  async function rotateSegment() {
    if (rotating || !recording || !mediaRecorder) return;
    rotating = true;
    try {
      var mr = mediaRecorder;
      var chunks = recordChunks;
      var mime = mr.mimeType || recordMimeType || 'video/webm';
      mediaRecorder = null;
      recordChunks = [];
      var blob = await stopRecorderToBlob(mr, chunks, mime);
      if (blob && blob.size) pendingBlobs.push(blob);
      if (recording && captureStream) startRecorderOnStream();
      queuePendingUploads(true);
    } catch (e) {
      window.alert(String(e.message || e));
    } finally {
      rotating = false;
    }
  }

  function tickSplit() {
    if (!recording || rotating) return;
    try {
      if (mediaRecorder && mediaRecorder.state === 'recording' && typeof mediaRecorder.requestData === 'function') {
        mediaRecorder.requestData();
      }
    } catch {
      /* ignore */
    }
    if (shouldRotateSegment()) void rotateSegment();
  }

  function resetSplitState() {
    pendingBlobs = [];
    uploadedPartCount = 0;
    savedRecordings = [];
    uploadChain = Promise.resolve();
    recordStartedAt = 0;
    segmentStartedAt = 0;
    if (splitTimer) {
      clearInterval(splitTimer);
      splitTimer = null;
    }
  }

  async function startRecording(opts) {
    opts = opts || {};
    if (recording || stopping || !gameplayActive) return false;
    if (!authToken()) {
      window.alert('Sign in to record runs — clips save to your account.');
      return false;
    }
    if (window.SkyHopRunAnticheat && !window.SkyHopRunAnticheat.isRunOn() && !opts.skipAcAlert) {
      window.alert(RECORD_AC_OFF_MSG);
    }
    var defName = namedTitle || opts.title || sessionMeta.title || 'Run';
    if (opts.skipPrompt) {
      namedTitle = String(opts.title || defName).trim().slice(0, 120) || defName;
    } else {
      var typed = window.prompt('Name this recording', defName);
      if (typed == null) return false;
      namedTitle = String(typed).trim().slice(0, 120) || defName;
    }
    sessionMeta.title = namedTitle;
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
      resetSplitState();
      captureStream = canvas.captureStream(30);
      recordMimeType = mimeType;
      recordStartedAt = performance.now();
      startRecorderOnStream();
      recording = true;
      splitTimer = setInterval(tickSplit, 1000);
      syncRecordButton();
      return true;
    } catch (e) {
      resetSplitState();
      stopCaptureTracks();
      window.alert(String(e.message || e));
      return false;
    }
  }

  async function stopRecording() {
    if ((!recording && !mediaRecorder) || stopping) return null;
    stopping = true;
    recording = false;
    syncRecordButton();
    if (splitTimer) {
      clearInterval(splitTimer);
      splitTimer = null;
    }
    var wait = 0;
    while (rotating && wait < 80) {
      await new Promise(function (resolve) {
        setTimeout(resolve, 100);
      });
      wait += 1;
    }
    try {
      if (mediaRecorder) {
        var mr = mediaRecorder;
        var chunks = recordChunks;
        var mimeType = mr.mimeType || recordMimeType || pickMimeType() || 'video/webm';
        mediaRecorder = null;
        recordChunks = [];
        var blob = await stopRecorderToBlob(mr, chunks, mimeType);
        if (blob && blob.size) pendingBlobs.push(blob);
      }
      stopCaptureTracks();
      var multi = uploadedPartCount > 0 || pendingBlobs.length > 1;
      await uploadChain;
      await flushPendingUploads(multi);
      var saved = savedRecordings.length ? savedRecordings[savedRecordings.length - 1] : null;
      var ids = savedRecordings.map(function (r) {
        return r && r.id;
      }).filter(Boolean);
      if (savedRecordings.length > 1) {
        window.alert(
          'This recording was over 25 minutes or the size limit, so it was saved as ' +
            savedRecordings.length +
            ' clips. The first clip is up to 25 minutes; the rest are 15-minute chunks. Submit them together in that order.'
        );
      }
      namedTitle = null;
      if (saved || ids.length) {
        window.dispatchEvent(
          new CustomEvent('skyhop-recording-saved', { detail: { id: ids[0] || (saved && saved.id), ids: ids } })
        );
      }
      resetSplitState();
      return saved;
    } catch (e) {
      stopCaptureTracks();
      namedTitle = null;
      resetSplitState();
      window.alert(String(e.message || e));
      return null;
    } finally {
      stopping = false;
    }
  }

  function setGameplayActive(active, meta) {
    gameplayActive = !!active;
    if (meta) {
      sessionMeta = {
        title: namedTitle || meta.title || sessionMeta.title,
        source: meta.source || sessionMeta.source,
        anticheatOn:
          meta.anticheatOn != null
            ? meta.anticheatOn !== false
            : !window.SkyHopRunAnticheat || window.SkyHopRunAnticheat.isRunOn(),
      };
    }
    if (!gameplayActive && recording) {
      void stopRecording();
    } else if (!gameplayActive) {
      namedTitle = null;
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
    document.addEventListener('DOMContentLoaded', function () {
      bindButton();
      window.SkyHopRunAnticheat.bindToggles();
    });
  } else {
    bindButton();
    window.SkyHopRunAnticheat.bindToggles();
  }

  window.SkyHopRecording = {
    setGameplayActive: setGameplayActive,
    startRecording: startRecording,
    stopRecording: stopRecording,
    listClips: listClips,
    deleteClip: deleteClip,
    renameClip: renameClip,
    fetchVideoBlob: fetchVideoBlob,
    videoPlaybackUrl: videoPlaybackUrl,
    isRecording: function () {
      return recording || stopping;
    },
    isGameplayActive: function () {
      return gameplayActive;
    },
    getSessionTitle: function () {
      return namedTitle || sessionMeta.title || 'Run';
    },
  };
})();
