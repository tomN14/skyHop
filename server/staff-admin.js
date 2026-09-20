import {
  ADMIN_BAN_MAX_PER_WEEK,
  ADMIN_BAN_WINDOW_MS,
  ADMIN_ONE_DAY_MS,
  effectiveRole,
  parseBanDuration,
} from './moderation.js';
import { censorProfanity } from './profanity-filter.js';

export function adminBanUntilMs() {
  return Date.now() + ADMIN_ONE_DAY_MS;
}

export async function adminBanQuota(store, adminUserId) {
  const since = Date.now() - ADMIN_BAN_WINDOW_MS;
  let used = 0;
  if (typeof store.countAdminBansSince === 'function') {
    used = await store.countAdminBansSince(adminUserId, since);
  }
  used = Math.max(0, Math.floor(Number(used) || 0));
  const remaining = Math.max(0, ADMIN_BAN_MAX_PER_WEEK - used);
  return { used, max: ADMIN_BAN_MAX_PER_WEEK, remaining, windowMs: ADMIN_BAN_WINDOW_MS };
}

export function assertAdminCanPunish(target) {
  const role = effectiveRole(target);
  if (role === 'owner') throw new Error('Cannot ban the site owner.');
  if (role === 'admin') throw new Error('Cannot ban the Admin.');
  if (role === 'moderator') throw new Error('Cannot ban a moderator. Request a demotion instead.');
}

export function clipReason(raw) {
  const s = censorProfanity(String(raw || '').trim()).text.trim().slice(0, 500);
  if (!s) throw new Error('Reason required.');
  return s;
}

export function validateStaffRequestInput(body) {
  const type = String(body?.type || '').toLowerCase();
  if (type !== 'demote_moderator' && type !== 'longer_ban') {
    throw new Error('type must be demote_moderator or longer_ban.');
  }
  const username = String(body?.username || '').trim();
  if (!username) throw new Error('username required');
  const reason = clipReason(body?.reason);
  const payload = { reason };
  if (type === 'longer_ban') {
    const until = parseBanDuration(body);
    if (until == null) {
      throw new Error('Invalid duration: use 1w, 2w, 1m, perm, or customDuration.');
    }
    payload.duration = String(body.duration ?? body.durationKey ?? '').toLowerCase() || 'custom';
    if (body.customDuration) payload.customDuration = body.customDuration;
    if (body.banUntilMs) payload.banUntilMs = body.banUntilMs;
    payload.banUntilMsResolved = until;
  }
  return { type, username, payload };
}

export async function enrichStaffRequests(store, rows) {
  const out = [];
  for (const r of rows || []) {
    const from = await store.findUserById(r.fromUserId);
    const target = await store.findUserById(r.targetUserId);
    out.push({
      id: r.id,
      type: r.type,
      fromUserId: r.fromUserId,
      fromUsername: from?.username || 'unknown',
      targetUserId: r.targetUserId,
      targetUsername: target?.username || 'unknown',
      payload: r.payload || {},
      status: r.status,
      ownerNote: r.ownerNote || null,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt || null,
    });
  }
  return out;
}
