import { normalizeBuiltinStages } from './builtin-stage-normalize.js';

/** Reject owner/DB campaign payloads that would render as blank levels in-game. */
export function isValidBuiltinStages(stages) {
  const norm = normalizeBuiltinStages(stages);
  if (!norm || norm.length === 0) return false;
  for (const s of norm) {
    if (!s.platforms || s.platforms.length === 0) return false;
    if (!Number.isFinite(s.spawn.x) || !Number.isFinite(s.spawn.y)) return false;
  }
  return true;
}

export function prepareBuiltinStagesForPlay(stages) {
  const norm = normalizeBuiltinStages(stages);
  if (!norm || !isValidBuiltinStages(norm)) return null;
  return norm;
}
