/** Campaign PB bonus anti-farm — server-authoritative checkpoint stream validation. */

export const PB_NET_DISP_MIN = 200;
export const PB_NET_PATH_RATIO_MIN = 0.8;
export const PB_IMPROVEMENT_MS = 5000;

export const CHECKPOINT_ACTIVE_INTERVAL_MS = 2000;
export const MAX_ACTIVE_GAP_MS = 5000;
export const WALL_SLACK_MS = 500;
export const MAX_SPEED_PX_S = 2400;
export const VEL_THRESHOLD = 12;

const MAX_COORD = 500000;
const MAX_SAMPLES = 12000;

function coordOk(v) {
  return Number.isFinite(v) && v >= -MAX_COORD && v <= MAX_COORD;
}

/**
 * @param {unknown} body
 */
export function validateSingleCheckpoint(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Invalid checkpoint' };
  const seq = Math.floor(Number(body.seq));
  const activeMs = Math.round(Number(body.activeMs));
  const x = Number(body.x);
  const y = Number(body.y);
  const vx = Number(body.vx);
  const vy = Number(body.vy);

  if (!Number.isFinite(seq) || seq < 1 || seq > MAX_SAMPLES) {
    return { ok: false, error: 'Invalid sequence' };
  }
  if (!Number.isFinite(activeMs) || activeMs < 0 || activeMs > 48 * 60 * 60 * 1000) {
    return { ok: false, error: 'Invalid activeMs' };
  }
  if (!coordOk(x) || !coordOk(y)) return { ok: false, error: 'Invalid position' };
  if (!Number.isFinite(vx) || !Number.isFinite(vy) || Math.abs(vx) > 5000 || Math.abs(vy) > 5000) {
    return { ok: false, error: 'Invalid velocity' };
  }

  return { ok: true, sample: { seq, activeMs, x, y, vx, vy } };
}

/**
 * @param {{ activeMs: number, x: number, y: number, receivedAt?: number } | null} prev
 * @param {{ activeMs: number, x: number, y: number, vx: number, vy: number }} sample
 * @param {number} now
 */
export function validateCheckpointPair(prev, sample, now) {
  if (!prev) return { ok: true };

  if (sample.activeMs <= prev.activeMs) {
    return { ok: false, error: 'activeMs must increase' };
  }

  const deltaActive = sample.activeMs - prev.activeMs;
  if (deltaActive > MAX_ACTIVE_GAP_MS) {
    return { ok: false, error: 'Checkpoint gap too large' };
  }

  const prevAt = prev.receivedAt != null ? prev.receivedAt : now;
  const deltaWall = now - prevAt;
  const minWall = Math.max(0, deltaActive - WALL_SLACK_MS);
  if (deltaWall < minWall) {
    return { ok: false, error: 'Checkpoint timing invalid' };
  }

  const dtSec = deltaActive / 1000;
  const dist = Math.hypot(sample.x - prev.x, sample.y - prev.y);
  const maxDist = MAX_SPEED_PX_S * dtSec * 1.15;
  if (dist > maxDist) {
    return { ok: false, error: 'Impossible movement' };
  }

  return { ok: true };
}

function samplesSorted(samples) {
  for (let i = 1; i < samples.length; i++) {
    if (samples[i].activeMs < samples[i - 1].activeMs) return false;
  }
  return true;
}

function samplesInRange(samples, wStart, wEndExclusive) {
  return samples.filter((s) => s.activeMs >= wStart && s.activeMs < wEndExclusive);
}

function windowHasMovement(samples, wStart, wEndExclusive) {
  const inW = samplesInRange(samples, wStart, wEndExclusive);
  if (!inW.length) return false;
  if (inW.some((s) => Math.abs(s.vx) > VEL_THRESHOLD || Math.abs(s.vy) > VEL_THRESHOLD)) {
    return true;
  }
  if (inW.length >= 2) {
    const first = inW[0];
    const last = inW[inW.length - 1];
    if (Math.hypot(last.x - first.x, last.y - first.y) >= 50) return true;
  }
  return false;
}

function positionAtOrBefore(samples, t) {
  let best = null;
  for (const s of samples) {
    if (s.activeMs <= t) best = s;
    else break;
  }
  return best;
}

function pathInWindow(samples, wStart, wEndInclusive) {
  const inW = samples.filter((s) => s.activeMs >= wStart && s.activeMs <= wEndInclusive);
  if (inW.length < 2) return 0;
  let path = 0;
  for (let i = 1; i < inW.length; i++) {
    path += Math.hypot(inW[i].x - inW[i - 1].x, inW[i].y - inW[i - 1].y);
  }
  return path;
}

/**
 * Validate a full checkpoint stream recorded live on the server.
 * @param {Array<{ activeMs: number, x: number, y: number, vx: number, vy: number, seq?: number, receivedAt?: number }>} samples
 * @param {{ timeMs?: number, requireStreamIntegrity?: boolean }} [opts]
 */
export function validateCheckpointSamples(samples, opts = {}) {
  if (!Array.isArray(samples) || samples.length === 0) return false;
  if (samples.length > MAX_SAMPLES) return false;
  if (!samplesSorted(samples)) return false;

  const timeMs = Number(opts.timeMs);
  const last = samples[samples.length - 1];
  if (!last || !Number.isFinite(last.activeMs)) return false;
  if (Number.isFinite(timeMs) && last.activeMs > timeMs + 3000) return false;

  if (opts.requireStreamIntegrity) {
    for (let i = 1; i < samples.length; i++) {
      const pair = validateCheckpointPair(samples[i - 1], samples[i], samples[i].receivedAt || Date.now());
      if (!pair.ok) return false;
      if (samples[i].seq != null && samples[i - 1].seq != null && samples[i].seq !== samples[i - 1].seq + 1) {
        return false;
      }
      const gap = samples[i].activeMs - samples[i - 1].activeMs;
      if (gap > MAX_ACTIVE_GAP_MS) return false;
    }
  }

  const activeMs = last.activeMs;
  const n10 = Math.floor(activeMs / 10000);
  for (let w = 0; w < n10; w++) {
    if (!windowHasMovement(samples, w * 10000, (w + 1) * 10000)) return false;
  }

  const n30 = Math.floor(activeMs / 30000);
  for (let w = 0; w < n30; w++) {
    const wStart = w * 30000;
    const wEnd = (w + 1) * 30000;
    const inW = samples.filter((s) => s.activeMs >= wStart && s.activeMs <= wEnd);
    if (!inW.length) return false;

    const p0 = positionAtOrBefore(samples, wStart) || inW[0];
    const p1 = inW[inW.length - 1];
    if (!p0 || !p1) return false;
    if (p0.activeMs > wStart + MAX_ACTIVE_GAP_MS && inW[0].activeMs > wStart + MAX_ACTIVE_GAP_MS) {
      return false;
    }
    if (p1.activeMs < wEnd - MAX_ACTIVE_GAP_MS) return false;

    const net = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    if (net < PB_NET_DISP_MIN) return false;
    const pathLen = pathInWindow(samples, wStart, wEnd);
    if (pathLen < 1) return false;
    if (net / pathLen < PB_NET_PATH_RATIO_MIN) return false;
  }

  return true;
}

/**
 * Whether a run qualifies for the +75 PB coin bonus from a server-recorded session.
 */
export function pbBonusEligibleFromSession(samples, { timeMs, prevBestMs }) {
  if (prevBestMs == null || !Number.isFinite(prevBestMs)) return false;
  if (!Number.isFinite(timeMs) || timeMs > prevBestMs - PB_IMPROVEMENT_MS) return false;
  return validateCheckpointSamples(samples, { timeMs, requireStreamIntegrity: true });
}
