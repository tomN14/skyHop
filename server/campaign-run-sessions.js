import crypto from 'crypto';
import {
  PB_IMPROVEMENT_MS,
  validateCheckpointSamples,
  validateSingleCheckpoint,
  validateCheckpointPair,
} from './pb-anti-farm.js';

const SESSION_TTL_MS = 4 * 60 * 60 * 1000;
const MAX_SAMPLES_PER_SESSION = 12000;

/** @type {Map<string, { id: string, uid: number, startedAt: number, expiresAt: number, samples: any[], lastSeq: number, finalized: boolean }>} */
const sessions = new Map();

/** @type {Map<number, string>} */
const activeByUser = new Map();

function pruneExpired() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (s.expiresAt <= now || s.finalized) {
      sessions.delete(id);
      if (activeByUser.get(s.uid) === id) activeByUser.delete(s.uid);
    }
  }
}

function makeSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * @param {number} uid
 */
export function startCampaignRunSession(uid) {
  pruneExpired();
  const prev = activeByUser.get(uid);
  if (prev) {
    const old = sessions.get(prev);
    if (old && !old.finalized) old.finalized = true;
    sessions.delete(prev);
  }
  const id = makeSessionId();
  const now = Date.now();
  const session = {
    id,
    uid,
    startedAt: now,
    expiresAt: now + SESSION_TTL_MS,
    samples: [],
    lastSeq: 0,
    finalized: false,
  };
  sessions.set(id, session);
  activeByUser.set(uid, id);
  return { sessionId: id, checkpointEveryMs: 2000 };
}

/**
 * @param {number} uid
 * @param {string} sessionId
 * @param {unknown} body
 */
export function appendCampaignCheckpoint(uid, sessionId, body) {
  pruneExpired();
  const sid = String(sessionId || '').trim();
  const session = sessions.get(sid);
  if (!session || session.uid !== uid || session.finalized) {
    return { ok: false, error: 'Invalid or expired run session' };
  }
  if (Date.now() > session.expiresAt) {
    sessions.delete(sid);
    if (activeByUser.get(uid) === sid) activeByUser.delete(uid);
    return { ok: false, error: 'Run session expired' };
  }
  if (session.samples.length >= MAX_SAMPLES_PER_SESSION) {
    return { ok: false, error: 'Too many checkpoints' };
  }

  const parsed = validateSingleCheckpoint(body);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const sample = parsed.sample;
  if (sample.seq !== session.lastSeq + 1) {
    return { ok: false, error: 'Checkpoint sequence mismatch' };
  }

  const prev = session.samples.length ? session.samples[session.samples.length - 1] : null;
  const now = Date.now();
  const pair = validateCheckpointPair(prev, sample, now);
  if (!pair.ok) return { ok: false, error: pair.error };

  session.samples.push({ ...sample, receivedAt: now });
  session.lastSeq = sample.seq;
  return { ok: true, seq: sample.seq, count: session.samples.length };
}

/**
 * @param {number} uid
 * @param {string} sessionId
 * @param {{ timeMs?: number, prevBestMs?: number|null }} opts
 */
export function finalizeCampaignRunSession(uid, sessionId, opts = {}) {
  pruneExpired();
  const sid = String(sessionId || '').trim();
  const session = sessions.get(sid);
  if (!session || session.uid !== uid) return null;
  session.finalized = true;
  if (activeByUser.get(uid) === sid) activeByUser.delete(uid);

  const timeMs = Number(opts.timeMs);
  const prevBestMs = opts.prevBestMs;
  const samples = session.samples.slice();
  sessions.delete(sid);

  let pbBonusEligible = false;
  if (
    prevBestMs != null &&
    Number.isFinite(prevBestMs) &&
    Number.isFinite(timeMs) &&
    timeMs <= prevBestMs - PB_IMPROVEMENT_MS &&
    validateCheckpointSamples(samples, { timeMs, requireStreamIntegrity: true })
  ) {
    pbBonusEligible = true;
  }

  return { samples, pbBonusEligible };
}

export function abortCampaignRunSession(uid, sessionId) {
  const sid = String(sessionId || '').trim();
  const session = sessions.get(sid);
  if (!session || session.uid !== uid) return false;
  session.finalized = true;
  sessions.delete(sid);
  if (activeByUser.get(uid) === sid) activeByUser.delete(uid);
  return true;
}
