(function () {
  function isValidBuiltinStages(stages) {
    if (!Array.isArray(stages) || stages.length === 0) return false;
    for (var i = 0; i < stages.length; i++) {
      var s = stages[i];
      if (!s || typeof s !== 'object') return false;
      var sp = s.spawn;
      if (!sp || typeof sp.x !== 'number' || typeof sp.y !== 'number') return false;
      var plats = s.platforms;
      if (!Array.isArray(plats) || plats.length === 0) return false;
      var okPlat = false;
      for (var j = 0; j < plats.length; j++) {
        var p = plats[j];
        if (p && typeof p.x === 'number' && typeof p.y === 'number' && p.w > 0 && p.h > 0) {
          okPlat = true;
          break;
        }
      }
      if (!okPlat) return false;
      if (typeof s.worldW !== 'number' || typeof s.worldH !== 'number') return false;
    }
    return true;
  }
  window.SkyHopValidateBuiltinStages = isValidBuiltinStages;
})();
