import crypto from 'crypto';

const TOKEN_TTL_MS = 60_000;

/** @type {Map<string, { targetUserId: number, ownerId: number, expiresAt: number, used: boolean }>} */
const pending = new Map();

function prune() {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (v.used || v.expiresAt <= now) pending.delete(k);
  }
}

export function createDeleteToken(ownerId, targetUserId) {
  prune();
  const token = crypto.randomBytes(32).toString('hex');
  pending.set(token, {
    targetUserId,
    ownerId,
    expiresAt: Date.now() + TOKEN_TTL_MS,
    used: false,
  });
  return { token, expiresAt: Date.now() + TOKEN_TTL_MS };
}

/**
 * @returns {{ ok: true, targetUserId: number, ownerId: number } | { ok: false, error: string }}
 */
export function consumeDeleteTokenPublic(token) {
  prune();
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'Missing token.' };
  const row = pending.get(t);
  if (!row) return { ok: false, error: 'Invalid or expired token. Return to Sky Hop and restart deletion.' };
  if (row.used) return { ok: false, error: 'This confirmation link was already used.' };
  if (Date.now() > row.expiresAt) {
    pending.delete(t);
    return { ok: false, error: 'Token expired (60 seconds). Return to Sky Hop and restart deletion.' };
  }
  row.used = true;
  pending.delete(t);
  return { ok: true, targetUserId: row.targetUserId, ownerId: row.ownerId };
}

/**
 * @returns {{ ok: true, targetUserId: number } | { ok: false, error: string }}
 */
export function consumeDeleteToken(token, ownerId) {
  const r = consumeDeleteTokenPublic(token);
  if (!r.ok) return r;
  if (r.ownerId !== ownerId) return { ok: false, error: 'Token owner mismatch.' };
  return { ok: true, targetUserId: r.targetUserId };
}
