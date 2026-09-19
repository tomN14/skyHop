/** Coerce JSON/Supabase campaign stages into shapes the game renderer expects. */
export function normalizeBuiltinStages(stages) {
  if (!Array.isArray(stages)) return null;
  const out = [];
  for (const src of stages) {
    if (!src || typeof src !== 'object') continue;
    const s = JSON.parse(JSON.stringify(src));
    const w = Number(s.worldW);
    const h = Number(s.worldH);
    s.worldW = Number.isFinite(w) && w >= 100 ? w : 1400;
    s.worldH = Number.isFinite(h) && h >= 100 ? h : 720;
    if (!s.spawn || typeof s.spawn !== 'object') s.spawn = { x: 80, y: 520 };
    else {
      s.spawn.x = Number(s.spawn.x);
      s.spawn.y = Number(s.spawn.y);
      if (!Number.isFinite(s.spawn.x)) s.spawn.x = 80;
      if (!Number.isFinite(s.spawn.y)) s.spawn.y = 520;
    }
    if (!Array.isArray(s.platforms)) s.platforms = [];
    s.platforms = s.platforms
      .filter((p) => p && typeof p === 'object')
      .map((p) => ({
        ...p,
        x: Number(p.x),
        y: Number(p.y),
        w: Number(p.w),
        h: Number(p.h),
      }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.w > 0 && p.h > 0);
    out.push(s);
  }
  return out.length ? out : null;
}
