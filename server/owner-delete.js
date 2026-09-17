import crypto from 'crypto';

const TOKEN_TTL_MS = 60_000;

/** @type {Set<string>} single-use jti (best-effort; survives restarts via signed expiry only) */
const usedJti = new Set();

function hmacSecret() {
  const s =
    process.env.SKYHOP_DELETE_HMAC_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SKYHOP_OWNER_EMAIL ||
    '';
  if (!String(s).trim()) return 'skyhop-dev-delete-insecure';
  return String(s);
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function b64urlDecode(s) {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function signPayload(payloadB64) {
  return b64url(crypto.createHmac('sha256', hmacSecret()).update(payloadB64).digest());
}

/**
 * @returns {{ token: string, expiresAt: number }}
 */
export function createDeleteToken(ownerId, targetUserId) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const jti = crypto.randomBytes(12).toString('hex');
  const payload = {
    t: Number(targetUserId),
    o: Number(ownerId),
    e: exp,
    j: jti,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  const sig = signPayload(payloadB64);
  return { token: `${payloadB64}.${sig}`, expiresAt: exp };
}

/**
 * Verify signature + expiry. Does not consume.
 * @returns {{ ok: true, targetUserId: number, ownerId: number, jti: string } | { ok: false, error: string }}
 */
export function peekDeleteToken(token) {
  const parsed = parseToken(token);
  if (!parsed.ok) return parsed;
  if (Date.now() > parsed.exp) {
    return { ok: false, error: 'Token expired (60 seconds). Return to Sky Hop and restart deletion.' };
  }
  if (usedJti.has(parsed.jti)) {
    return { ok: false, error: 'This confirmation link was already used.' };
  }
  return {
    ok: true,
    targetUserId: parsed.targetUserId,
    ownerId: parsed.ownerId,
    jti: parsed.jti,
  };
}

/**
 * @returns {{ ok: true, targetUserId: number, ownerId: number } | { ok: false, error: string }}
 */
export function consumeDeleteTokenPublic(token) {
  const peek = peekDeleteToken(token);
  if (!peek.ok) return peek;
  usedJti.add(peek.jti);
  if (usedJti.size > 5000) {
    for (const x of usedJti) {
      usedJti.delete(x);
      if (usedJti.size <= 4000) break;
    }
  }
  return { ok: true, targetUserId: peek.targetUserId, ownerId: peek.ownerId };
}

/**
 * @returns {{ ok: true, targetUserId: number } | { ok: false, error: string }}
 */
export function consumeDeleteToken(token, ownerId) {
  const r = consumeDeleteTokenPublic(token);
  if (!r.ok) return r;
  if (r.ownerId !== Number(ownerId)) return { ok: false, error: 'Token owner mismatch.' };
  return { ok: true, targetUserId: r.targetUserId };
}

function parseToken(token) {
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'Missing token.' };
  const dot = t.lastIndexOf('.');
  if (dot <= 0) return { ok: false, error: 'Invalid or expired token. Return to Sky Hop and restart deletion.' };
  const payloadB64 = t.slice(0, dot);
  const sig = t.slice(dot + 1);
  if (signPayload(payloadB64) !== sig) {
    return { ok: false, error: 'Invalid or expired token. Return to Sky Hop and restart deletion.' };
  }
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, error: 'Invalid or expired token. Return to Sky Hop and restart deletion.' };
  }
  const targetUserId = Number(payload.t);
  const ownerId = Number(payload.o);
  const exp = Number(payload.e);
  const jti = String(payload.j || '');
  if (!Number.isFinite(targetUserId) || !Number.isFinite(ownerId) || !Number.isFinite(exp) || !jti) {
    return { ok: false, error: 'Invalid or expired token. Return to Sky Hop and restart deletion.' };
  }
  return { ok: true, targetUserId, ownerId, exp, jti };
}
