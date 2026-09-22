/**
 * Ban durations, role resolution (owner via env), ban status helpers.
 */
export const BAN_PERMANENT_MS = -1;

export function banStatusForUser(u) {
  if (!u) return { banned: false };
  const until = u.banUntilMs != null ? Number(u.banUntilMs) : null;
  const reason = u.banReason || null;
  const appealDeclineReason = u.appealDeclineReason || u.appeal_decline_reason || null;
  if (until == null || Number.isNaN(until)) return { banned: false };
  if (until === BAN_PERMANENT_MS) {
    return { banned: true, permanent: true, untilMs: null, reason, appealDeclineReason };
  }
  const now = Date.now();
  if (until > now) {
    return { banned: true, permanent: false, untilMs: until, reason, appealDeclineReason };
  }
  return { banned: false };
}

/** @param {string} key */
export function durationKeyToBanUntil(key) {
  const now = Date.now();
  switch (String(key || '').toLowerCase()) {
    case '1d':
    case '1day':
      return now + 24 * 60 * 60 * 1000;
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
  if ((user.role || '') === 'admin') return 'admin';
  if ((user.role || '') === 'moderator') return 'moderator';
  if ((user.role || '') === 'report_advisor') return 'report_advisor';
  return 'player';
}

export function isStaffRole(role) {
  return role === 'moderator' || role === 'admin' || role === 'owner';
}

/** Pending player-report queue (not owner-escalated inbox, not ban appeals). */
export function seesModReportQueue(role) {
  return role === 'report_advisor' || role === 'moderator' || role === 'admin';
}

export function canAccessReportInbox(role) {
  return isStaffRole(role) || role === 'report_advisor';
}

export const ROLE_PROMOTION_COINS = {
  report_advisor: 1000,
  moderator: 2000,
  admin: 3000,
};

/** Coins granted when a player is promoted into a staff role. Demotions and no-ops are 0. */
export function promotionCoinBonus(fromRole, toRole) {
  const from = String(fromRole || 'player') || 'player';
  const to = String(toRole || 'player') || 'player';
  if (from === to || roleRank(to) <= roleRank(from)) return 0;
  const n = ROLE_PROMOTION_COINS[to];
  return n != null ? n : 0;
}

export async function creditPromotionCoins(incrementFn, userId, fromRole, toRole) {
  const amt = promotionCoinBonus(fromRole, toRole);
  if (amt > 0 && typeof incrementFn === 'function') await incrementFn(userId, amt);
  return amt;
}

export function roleRank(role) {
  switch (String(role || '')) {
    case 'owner':
      return 4;
    case 'admin':
      return 3;
    case 'moderator':
      return 2;
    case 'report_advisor':
      return 1;
    default:
      return 0;
  }
}

export function roleDisplayName(role) {
  switch (String(role || '')) {
    case 'report_advisor':
      return 'Report Advisor';
    case 'moderator':
      return 'moderator';
    case 'admin':
      return 'Admin';
    case 'owner':
      return 'owner';
    default:
      return 'player';
  }
}

/**
 * Apply a stored role change. Promotions set a one-time notice; demotions are silent
 * and clear any pending congratulations.
 * @returns {{ role: string, promotionFrom?: string|null, promotionTo?: string|null }}
 */
export function roleChangeFields(fromRole, toRole) {
  const from = String(fromRole || 'player') || 'player';
  const to = String(toRole || 'player') || 'player';
  if (from === to) return { role: to };
  if (roleRank(to) > roleRank(from)) {
    return { role: to, promotionFrom: from, promotionTo: to };
  }
  return { role: to, promotionFrom: null, promotionTo: null };
}

export function roleChangeDbPatch(fromRole, toRole) {
  const f = roleChangeFields(fromRole, toRole);
  const patch = { role: f.role };
  if (Object.prototype.hasOwnProperty.call(f, 'promotionFrom')) {
    patch.promotion_from = f.promotionFrom;
    patch.promotion_to = f.promotionTo;
  }
  return patch;
}

export function applyRoleChangeToUser(user, toRole) {
  if (!user) return;
  const f = roleChangeFields(user.role, toRole);
  user.role = f.role;
  if (Object.prototype.hasOwnProperty.call(f, 'promotionFrom')) {
    user.promotionFrom = f.promotionFrom;
    user.promotionTo = f.promotionTo;
  }
}

export function promotionNoticePayload(user) {
  const fromKey = user?.promotionFrom ?? user?.promotion_from ?? null;
  const toKey = user?.promotionTo ?? user?.promotion_to ?? null;
  if (!fromKey || !toKey) return null;
  const from = roleDisplayName(fromKey);
  const to = roleDisplayName(toKey);
  return {
    from,
    to,
    message: (() => {
      const bonus = promotionCoinBonus(fromKey, toKey);
      const base = `Congratulations! You have been promoted from ${from} to ${to}`;
      return bonus > 0 ? `${base}. You received ${bonus} coins.` : base;
    })(),
  };
}

export const ADMIN_ONE_DAY_MS = 24 * 60 * 60 * 1000;
export const ADMIN_BAN_MAX_PER_WEEK = 2;
export const ADMIN_BAN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function ownerUsernameLower() {
  return (process.env.SKYHOP_OWNER_USERNAME || '').trim().toLowerCase() || null;
}

export function isAccountDisabled(u) {
  if (!u) return false;
  if (u.disabledAt != null && Number(u.disabledAt) > 0) return true;
  if (u.disabled === true) return true;
  return false;
}

export function assertAccountActive(user) {
  if (isAccountDisabled(user)) {
    const err = new Error('This account is disabled and cannot perform that action.');
    err.code = 'ACCOUNT_DISABLED';
    throw err;
  }
}
