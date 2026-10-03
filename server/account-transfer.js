/**
 * Owner account-data copy. The source account is left in place.
 * Confirmation uses a short-lived signed link, same window as account deletion.
 */
import crypto from 'crypto';
import { effectiveRole } from './moderation.js';
import { duplicateOwnedLevels } from './user-levels.js';

const TOKEN_TTL_MS = 60_000;
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
  return b64url(crypto.createHmac('sha256', hmacSecret()).update('transfer:' + payloadB64).digest());
}

export function createTransferToken(ownerId, fromUserId, toUserId) {
  const exp = Date.now() + TOKEN_TTL_MS;
  const jti = crypto.randomBytes(12).toString('hex');
  const payload = {
    f: Number(fromUserId),
    t: Number(toUserId),
    o: Number(ownerId),
    e: exp,
    j: jti,
  };
  const payloadB64 = b64url(JSON.stringify(payload));
  return { token: `${payloadB64}.${signPayload(payloadB64)}`, expiresAt: exp };
}

function parseToken(token) {
  const t = String(token || '').trim();
  if (!t) return { ok: false, error: 'Missing token.' };
  const dot = t.lastIndexOf('.');
  if (dot <= 0) return { ok: false, error: 'Invalid or expired token. Return to Sky Hop and start the transfer again.' };
  const payloadB64 = t.slice(0, dot);
  const sig = t.slice(dot + 1);
  if (signPayload(payloadB64) !== sig) {
    return { ok: false, error: 'Invalid or expired token. Return to Sky Hop and start the transfer again.' };
  }
  let payload;
  try {
    payload = JSON.parse(b64urlDecode(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, error: 'Invalid or expired token. Return to Sky Hop and start the transfer again.' };
  }
  const fromUserId = Number(payload.f);
  const toUserId = Number(payload.t);
  const ownerId = Number(payload.o);
  const exp = Number(payload.e);
  const jti = String(payload.j || '');
  if (
    !Number.isFinite(fromUserId) ||
    !Number.isFinite(toUserId) ||
    !Number.isFinite(ownerId) ||
    !Number.isFinite(exp) ||
    !jti
  ) {
    return { ok: false, error: 'Invalid or expired token. Return to Sky Hop and start the transfer again.' };
  }
  return { ok: true, fromUserId, toUserId, ownerId, exp, jti };
}

export function peekTransferToken(token) {
  const parsed = parseToken(token);
  if (!parsed.ok) return parsed;
  if (Date.now() > parsed.exp) {
    return { ok: false, error: 'Token expired (60 seconds). Return to Sky Hop and start the transfer again.' };
  }
  if (usedJti.has(parsed.jti)) return { ok: false, error: 'This confirmation link was already used.' };
  return {
    ok: true,
    fromUserId: parsed.fromUserId,
    toUserId: parsed.toUserId,
    ownerId: parsed.ownerId,
    jti: parsed.jti,
  };
}

export function consumeTransferToken(token) {
  const peek = peekTransferToken(token);
  if (!peek.ok) return peek;
  usedJti.add(peek.jti);
  if (usedJti.size > 5000) {
    for (const x of usedJti) {
      usedJti.delete(x);
      if (usedJti.size <= 4000) break;
    }
  }
  return {
    ok: true,
    fromUserId: peek.fromUserId,
    toUserId: peek.toUserId,
    ownerId: peek.ownerId,
  };
}

/**
 * Copy progress onto `toId`. Does not change the source account, its password, or its role.
 */
export async function copyAccountData(store, fromId, toId) {
  const from = await store.findUserById(fromId);
  const to = await store.findUserById(toId);
  if (!from || !to) throw new Error('User not found');
  if (Number(from.id) === Number(to.id)) throw new Error('Pick two different accounts.');

  const coins = Math.max(0, Math.floor(Number(from.coins) || 0));
  if (coins > 0 && effectiveRole(to) !== 'owner' && typeof store.incrementUserCoins === 'function') {
    await store.incrementUserCoins(to.id, coins);
  }

  let runs = 0;
  if (typeof store.getRunsForUser === 'function' && typeof store.copyRunsOntoUser === 'function') {
    const rows = await store.getRunsForUser(from.id);
    runs = await store.copyRunsOntoUser(to.id, rows);
  }

  let achievements = 0;
  if (typeof store.getAchievementsForUser === 'function' && typeof store.insertUserAchievements === 'function') {
    const src = await store.getAchievementsForUser(from.id);
    const have = new Set((await store.getAchievementsForUser(to.id)).map((a) => a.achievementId));
    const fresh = src.filter((a) => a.achievementId && !have.has(a.achievementId)).map((a) => ({ id: a.achievementId }));
    if (fresh.length) {
      await store.insertUserAchievements(to.id, fresh);
      achievements = fresh.length;
    }
  }

  let skins = 0;
  if (typeof store.listTextureGrantsForUser === 'function' && typeof store.addTextureGrant === 'function') {
    const names = await store.listTextureGrantsForUser(from.id);
    for (const fn of names) {
      try {
        const added = await store.addTextureGrant(to.id, fn);
        if (added !== false) skins += 1;
      } catch {
        /* skip a filename the shop no longer accepts */
      }
    }
  }

  const equipped = from.skinTexture || from.skin_texture || null;
  const destEquipped = to.skinTexture || to.skin_texture || null;
  if (equipped && !destEquipped && typeof store.setUserSkinTexture === 'function') {
    await store.setUserSkinTexture(to.id, equipped);
  }

  const cleared = from.campaignWorld1ClearedAt || from.campaign_world1_cleared_at || null;
  if (cleared && typeof store.setCampaignWorld1ClearedAt === 'function') {
    await store.setCampaignWorld1ClearedAt(to.id, cleared);
  }

  let claims = 0;
  if (typeof store.copyOnlineCoinClaims === 'function') {
    try {
      claims = await store.copyOnlineCoinClaims(from.id, to.id);
    } catch {
      claims = 0;
    }
  }

  const levels = await duplicateOwnedLevels(from.id, to.id);

  return {
    from: from.username,
    to: to.username,
    coins: effectiveRole(to) === 'owner' ? 0 : coins,
    runs,
    achievements,
    skins,
    claims,
    levels,
  };
}
