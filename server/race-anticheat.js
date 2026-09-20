/**
 * Server-side checks for online race / collab progress.
 * Catches scripted bots that skip stages, teleport, or finish without playing.
 */

export const MAX_SPEED_PX_S = 3200;
export const MIN_STAGE_ADVANCE_MS = 220;
export const MAX_PROGRESS_PER_SEC = 22;
export const KICK_SUSPICION = 8;
export const HONEYPOT_KEYS = ['autoPlay', 'bot', 'macro', 'botId', 'autoWin', 'instantClear'];

const MAX_COORD = 500000;

function coordOk(v) {
  return Number.isFinite(v) && v >= -MAX_COORD && v <= MAX_COORD;
}

export function looksLikeHoneypot(msg) {
  if (!msg || typeof msg !== 'object') return false;
  for (const k of HONEYPOT_KEYS) {
    if (msg[k] != null && msg[k] !== false && msg[k] !== 0 && msg[k] !== '') return true;
  }
  return false;
}

/**
 * @param {{ startAt: number, maxStage0: number, collab: boolean }} room
 * @param {object} prev progress row
 * @param {object} msg
 * @param {number} now
 */
export function evaluateProgress(room, prev, msg, now) {
  const flags = [];
  let suspicion = 0;
  let kick = null;

  if (looksLikeHoneypot(msg)) {
    return { ok: false, kick: 'Automated play is not allowed in online sessions.', flags: ['honeypot'] };
  }

  const cap =
    room.maxStage0 != null && Number.isFinite(room.maxStage0)
      ? Math.max(0, Math.floor(room.maxStage0))
      : 49;
  const st = msg.stage0 != null ? Math.max(0, Math.min(cap, Math.floor(msg.stage0))) : 0;
  const timeMs = Number.isFinite(Number(msg.timeMs)) ? Math.max(0, Number(msg.timeMs)) : 0;

  const lastAt = prev && prev.lastAt != null ? prev.lastAt : room.startAt || now;
  const dtWall = Math.max(0, now - lastAt);
  const hits = (prev && prev.progressHits) || 0;
  const windowStart = prev && prev.rateWindowAt != null ? prev.rateWindowAt : now;
  let rateHits = prev && prev.rateHits != null ? prev.rateHits : 0;
  let rateWindowAt = windowStart;
  if (now - windowStart >= 1000) {
    rateHits = 0;
    rateWindowAt = now;
  }
  rateHits += 1;
  if (rateHits > MAX_PROGRESS_PER_SEC) {
    return { ok: false, drop: true, flags: ['rate'] };
  }

  const prevStage = prev && Number.isFinite(prev.stage) ? prev.stage : 0;
  if (st < prevStage) {
    flags.push('stage_back');
    suspicion += 2;
  }
  if (st > prevStage) {
    const skipped = st - prevStage;
    const minMs = skipped * MIN_STAGE_ADVANCE_MS;
    if (dtWall < minMs) {
      kick = 'Stage progress was faster than a real player can move.';
      flags.push('stage_skip');
    }
  }

  let nx = null;
  let ny = null;
  if (msg.x != null && msg.y != null) {
    nx = Number(msg.x);
    ny = Number(msg.y);
    if (!coordOk(nx) || !coordOk(ny)) {
      nx = null;
      ny = null;
    }
  }

  if (nx != null && ny != null && prev && prev.x != null && prev.y != null && dtWall > 0) {
    const dist = Math.hypot(nx - prev.x, ny - prev.y);
    const dtSec = Math.max(0.04, dtWall / 1000);
    const maxDist = MAX_SPEED_PX_S * dtSec * 1.35;
    if (dist > maxDist * 2) {
      kick = 'Movement did not look like a real player.';
      flags.push('teleport');
    } else if (dist > maxDist) {
      flags.push('speed');
      suspicion += 3;
    }

    const held = !!msg.held;
    const keyEvents = Math.max(0, Math.floor(Number(msg.keyEvents) || 0));
    const pointerEvents = Math.max(0, Math.floor(Number(msg.pointerEvents) || 0));
    const inputAgeMs = Number.isFinite(Number(msg.inputAgeMs)) ? Number(msg.inputAgeMs) : 99999;
    const dx = prev && prev.x != null ? Math.abs(nx - prev.x) : 0;
    if (dx > 80 && !held && keyEvents < 1 && pointerEvents < 1 && inputAgeMs > 2500 && st === prevStage) {
      flags.push('no_input');
      suspicion += 2;
    }
  }

  const startAt = room.startAt || now;
  const wallRun = now - startAt;
  if (timeMs > wallRun + 4000) {
    flags.push('clock');
    suspicion += 3;
  }

  const mods = Math.max(0, Math.floor(Number(msg.mods) || 0));
  if (mods > 0 && !(prev && prev.flags && prev.flags.includes('mods'))) flags.push('mods');

  const jitter = Number(msg.keyJitter);
  if (Number.isFinite(jitter) && jitter >= 0 && jitter < 0.35 && Number(msg.keyEvents) >= 8) {
    flags.push('robot_timing');
    suspicion += 2;
  }

  const nextSuspicion = Math.max(0, ((prev && prev.suspicion) || 0) + suspicion - (dtWall > 8000 ? 1 : 0));
  if (!kick && nextSuspicion >= KICK_SUSPICION) {
    kick = 'Play pattern looked automated.';
  }

  return {
    ok: !kick,
    kick,
    drop: false,
    flags,
    suspicion: nextSuspicion,
    stage: st,
    timeMs,
    x: nx,
    y: ny,
    rateHits,
    rateWindowAt,
    progressHits: hits + 1,
  };
}

/**
 * @param {{ startAt: number, maxStage0: number }} room
 * @param {object} prev
 * @param {object} msg
 * @param {number} now
 */
export function evaluateFinish(room, prev, msg, now) {
  if (looksLikeHoneypot(msg)) {
    return { ok: false, kick: 'Automated play is not allowed in online sessions.' };
  }
  const cap =
    room.maxStage0 != null && Number.isFinite(room.maxStage0)
      ? Math.max(0, Math.floor(room.maxStage0))
      : 49;
  const nStages = cap + 1;
  const startAt = room.startAt || now;
  const wallRun = now - startAt;
  const minWall = nStages * MIN_STAGE_ADVANCE_MS;
  if (wallRun < minWall) {
    return { ok: false, kick: 'Finish was faster than a real run.' };
  }
  const reached = prev && Number.isFinite(prev.stage) ? prev.stage : 0;
  if (reached < cap) {
    return { ok: false, kick: 'Finish arrived before the last stage.' };
  }
  if (!prev || (prev.progressHits || 0) < Math.min(12, nStages)) {
    return { ok: false, kick: 'Not enough live movement to count this finish.' };
  }
  const timeMs = Number.isFinite(Number(msg.timeMs)) ? Math.max(0, Number(msg.timeMs)) : 0;
  if (timeMs < minWall * 0.55) {
    return { ok: false, kick: 'Reported time did not match the session.' };
  }
  if (timeMs > wallRun + 8000) {
    return { ok: false, kick: 'Reported time did not match the session.' };
  }
  return { ok: true, timeMs, deaths: Math.max(0, Math.floor(Number(msg.deaths) || 0)) };
}
