import { BAN_PERMANENT_MS, banStatusForUser, effectiveRole } from './moderation.js';

export function validateAppealReason(reason) {
  const s = String(reason || '').trim();
  if (s.length < 10) throw new Error('Appeal reason must be at least 10 characters.');
  if (s.length > 4000) throw new Error('Appeal reason is too long.');
  return s;
}

export async function tryResolveAppeal(store, appealId) {
  if (typeof store.getBanAppealById !== 'function') return null;
  const appeal = await store.getBanAppealById(appealId);
  if (!appeal || appeal.status !== 'open') return null;
  const votes = await store.listBanAppealVotes(appealId);
  const unban = votes.filter((v) => v.vote === 'unban').length;
  const keep = votes.filter((v) => v.vote === 'keep_ban').length;
  const total = unban + keep;
  if (total === 0) return null;
  if (unban > keep && unban > total / 2) {
    if (typeof store.clearUserBan === 'function') await store.clearUserBan(appeal.userId);
    await store.setBanAppealResolved(appealId, 'lifted', 'unban');
    return 'lifted';
  }
  if (keep > unban && keep > total / 2) {
    await store.setBanAppealResolved(appealId, 'upheld', 'keep_ban');
    return 'upheld';
  }
  return null;
}

export async function enrichAppeals(store, rows) {
  const out = [];
  for (const r of rows) {
    const u = await store.findUserById(r.userId);
    const votes = await store.listBanAppealVotes(r.id);
    const unban = votes.filter((v) => v.vote === 'unban').length;
    const keep = votes.filter((v) => v.vote === 'keep_ban').length;
    out.push({
      id: r.id,
      userId: r.userId,
      username: u ? u.username : 'unknown',
      reason: r.reason,
      status: r.status,
      outcome: r.outcome ?? null,
      createdAt: r.createdAt,
      resolvedAt: r.resolvedAt ?? null,
      votes: { unban, keep_ban: keep, total: votes.length },
      voteDetails: votes,
    });
  }
  return out;
}

export { banStatusForUser, BAN_PERMANENT_MS, effectiveRole };
