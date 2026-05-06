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

export function effectiveRole(user) {
  if (!user) return 'player';
  const low = user.usernameLower || String(user.username || '').toLowerCase();
  const ownerEnv = (process.env.SKYHOP_OWNER_USERNAME || '').trim().toLowerCase();
  if (ownerEnv && low === ownerEnv) return 'owner';
  if ((user.role || '') === 'moderator') return 'moderator';
  return 'player';
}

export function ownerUsernameLower() {
  return (process.env.SKYHOP_OWNER_USERNAME || '').trim().toLowerCase() || null;
}
