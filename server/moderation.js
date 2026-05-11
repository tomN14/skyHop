/**
 * Ban durations, role resolution (owner via env), ban status helpers.
 */
export const BAN_PERMANENT_MS = -1;

export function banStatusForUser(u) {
  if (!u) return { banned: false };
  const until = u.banUntilMs != null ? Number(u.banUntilMs) : null;
  const reason = u.banReason || null;
  if (until == null || Number.isNaN(until)) return { banned: false };
  if (until === BAN_PERMANENT_MS) return { banned: true, permanent: true, untilMs: null, reason };
  const now = Date.now();
  if (until > now) return { banned: true, permanent: false, untilMs: until, reason };
  return { banned: false };
}

/** @param {string} key */
export function durationKeyToBanUntil(key) {
  const now = Date.now();
  switch (String(key || '').toLowerCase()) {
    case '1w':
      return now + 7 * 24 * 60 * 60 * 1000;
    case '2w':
      return now + 14 * 24 * 60 * 60 * 1000;
    case '1m':
      return now + 30 * 24 * 60 * 60 * 1000;
    case 'perm':
    case 'permanent':
      return BAN_PERMANENT_MS;
    default:
      return null;
  }
}

/**
 * Owner ban body: { duration / durationKey }, { customDuration: { weeks, days, hours, minutes, seconds } },
 * or { banUntilMs } (absolute epoch ms, must be in the future).
 * @param {any} body
 * @returns {number|null} ban_until_ms value or null if invalid
 */
export function parseBanDuration(body) {
  if (!body || typeof body !== 'object') return null;
  const ab = Number(body.banUntilMs);
  if (Number.isFinite(ab) && ab > Date.now()) return Math.floor(ab);

  const c = body.customDuration;
  if (c && typeof c === 'object') {
    const w = Math.max(0, Math.floor(Number(c.weeks) || 0));
    const d = Math.max(0, Math.floor(Number(c.days) || 0));
    const h = Math.max(0, Math.floor(Number(c.hours) || 0));
    const mi = Math.max(0, Math.floor(Number(c.minutes) || 0));
    const s = Math.max(0, Math.floor(Number(c.seconds) || 0));
    const ms = (((w * 7 + d) * 24 + h) * 60 + mi) * 60 * 1000 + s * 1000;
    if (ms <= 0 || ms > 100 * 365 * 24 * 60 * 60 * 1000) return null;
    return Date.now() + ms;
  }

  const key = String(body.duration ?? body.durationKey ?? '');
  return durationKeyToBanUntil(key);
}

export function effectiveRole(user) {
  if (!user) return 'player';
  const low = String(user.usernameLower || String(user.username || '').toLowerCase()).trim();
  const ownerEnv = (process.env.SKYHOP_OWNER_USERNAME || '').trim().toLowerCase();
  if (ownerEnv && low === ownerEnv) return 'owner';
  if ((user.role || '') === 'owner') return 'owner';
  if ((user.role || '') === 'moderator') return 'moderator';
  return 'player';
}

export function ownerUsernameLower() {
  return (process.env.SKYHOP_OWNER_USERNAME || '').trim().toLowerCase() || null;
}
