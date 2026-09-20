import { durationKeyToBanUntil, effectiveRole, roleDisplayName } from './moderation.js';

export const STRIKE_PLAYER_BAN_REASON = 'Automatic 1-week ban (3 strikes).';

export function strikeCountOf(user) {
  return Math.max(0, Math.floor(Number(user?.strikes) || 0));
}

export function canAdminViewStrikes(targetRole) {
  return targetRole === 'player' || targetRole === 'report_advisor' || targetRole === 'moderator';
}

/** Auto-penalty only when a threshold is first crossed for the current role. */
export function evaluateStrikePenalty(role, prevCount, newCount) {
  if (role === 'owner') return null;
  if (role === 'admin' && prevCount < 1 && newCount >= 1) {
    return { type: 'demote', toRole: 'moderator' };
  }
  if ((role === 'moderator' || role === 'report_advisor') && prevCount < 2 && newCount >= 2) {
    return { type: 'demote', toRole: 'player' };
  }
  if (role === 'player' && prevCount < 3 && newCount >= 3) {
    return { type: 'ban1w' };
  }
  return null;
}

export async function lookupStrikes(store, actorRole, username) {
  const un = String(username || '').trim();
  if (!un) throw new Error('username required');
  const target = await store.findUserByUsername(un);
  if (!target) throw new Error('User not found');
  const role = effectiveRole(target);
  if (actorRole === 'owner') {
    /* full lookup */
  } else if (actorRole === 'admin') {
    if (!canAdminViewStrikes(role)) {
      throw new Error('Admins can only view strikes for players, Report Advisors, and moderators.');
    }
  } else {
    throw new Error('Not allowed');
  }
  return {
    username: target.username,
    role,
    roleLabel: roleDisplayName(role),
    strikes: strikeCountOf(target),
  };
}

export async function applyOwnerStrikeDelta(store, username, delta) {
  const un = String(username || '').trim();
  if (!un) throw new Error('username required');
  const target = await store.findUserByUsername(un);
  if (!target) throw new Error('User not found');
  const role = effectiveRole(target);
  if (role === 'owner') throw new Error('Cannot give strikes to the site owner.');
  const prev = strikeCountOf(target);
  const step = delta > 0 ? 1 : delta < 0 ? -1 : 0;
  if (!step) throw new Error('Add or remove exactly one strike.');
  if (step < 0 && prev <= 0) throw new Error('That user has no strikes to remove.');
  const next = prev + step;
  if (typeof store.applyStrikeMutation !== 'function' && typeof store.setStrikes !== 'function') {
    throw new Error('Strikes are not configured. Run extend_v17_strikes.sql.');
  }
  let penalty = null;
  let toRole = null;
  let banUntilMs = null;
  let banReason = null;
  if (step > 0) {
    const action = evaluateStrikePenalty(role, prev, next);
    if (action?.type === 'demote') {
      toRole = action.toRole;
      penalty = {
        type: 'demote',
        from: roleDisplayName(role),
        to: roleDisplayName(action.toRole),
      };
    } else if (action?.type === 'ban1w') {
      banUntilMs = durationKeyToBanUntil('1w');
      banReason = STRIKE_PLAYER_BAN_REASON;
      penalty = { type: 'ban', duration: '1w' };
    }
  }
  if (typeof store.applyStrikeMutation === 'function') {
    await store.applyStrikeMutation(target.id, { strikes: next, toRole, banUntilMs, banReason });
  } else {
    await store.setStrikes(target.id, next);
    if (toRole) await store.setStoredRole(target.id, toRole);
    if (banUntilMs != null) await store.applyBan(target.id, banUntilMs, banReason);
  }
  return {
    username: target.username,
    strikes: next,
    previous: prev,
    role: penalty?.type === 'demote' ? penalty.to : roleDisplayName(role),
    penalty,
  };
}
