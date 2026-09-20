/**
 * Lightweight input sampling for online race / collab anti-cheat.
 * Does not block play; the server decides if a packet looks automated.
 */
(function () {
  var lastKey = 0;
  var lastPtr = 0;
  var lastKeyT = 0;
  var keyN = 0;
  var ptrN = 0;
  var held = 0;
  var intervals = [];
  var ptrMoveAt = 0;

  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function onKeyDown(e) {
    if (!e) return;
    held++;
    var t = now();
    lastKey = t;
    if (e.repeat) return;
    keyN++;
    if (lastKeyT) {
      intervals.push(t - lastKeyT);
      if (intervals.length > 20) intervals.shift();
    }
    lastKeyT = t;
  }

  function onKeyUp() {
    held = Math.max(0, held - 1);
    lastKey = now();
  }

  function onPtr() {
    lastPtr = now();
    ptrN++;
  }

  function onPtrMove() {
    var t = now();
    if (t - ptrMoveAt < 80) return;
    ptrMoveAt = t;
    lastPtr = t;
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('pointerdown', onPtr, true);
  window.addEventListener('pointermove', onPtrMove, true);
  window.addEventListener('touchstart', onPtr, { capture: true, passive: true });

  function jitterOf(arr) {
    if (!arr || arr.length < 4) return null;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    var mean = sum / arr.length;
    var v = 0;
    for (var j = 0; j < arr.length; j++) {
      var d = arr[j] - mean;
      v += d * d;
    }
    return Math.sqrt(v / arr.length);
  }

  function modsActive() {
    var map = window.__skyhopUserModTeardowns;
    if (!map || typeof map !== 'object') return 0;
    return Object.keys(map).length;
  }

  window.SkyHopAnticheatProbe = {
    take: function () {
      var t = now();
      var last = Math.max(lastKey, lastPtr);
      var snap = {
        inputAgeMs: last ? Math.round(t - last) : 99999,
        keyEvents: keyN,
        pointerEvents: ptrN,
        held: held > 0,
        mods: modsActive(),
      };
      var jit = jitterOf(intervals);
      if (jit != null) snap.keyJitter = Math.round(jit * 100) / 100;
      keyN = 0;
      ptrN = 0;
      return snap;
    },
  };
})();
