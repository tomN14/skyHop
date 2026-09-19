/** Reject owner/DB campaign payloads that would render as blank levels in-game. */
export function isValidBuiltinStages(stages) {
  if (!Array.isArray(stages) || stages.length === 0) return false;
  for (const s of stages) {
    if (!s || typeof s !== 'object') return false;
    const sp = s.spawn;
    if (!sp || typeof sp.x !== 'number' || typeof sp.y !== 'number') return false;
    const plats = s.platforms;
    if (!Array.isArray(plats) || plats.length === 0) return false;
    let okPlat = false;
    for (const p of plats) {
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
