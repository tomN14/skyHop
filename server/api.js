import { ACHIEVEMENT_COIN_REWARD, ACHIEVEMENT_DEFS, aggregateRuns, computeNewUnlocks } from './achievements.js';
import { banStatusForUser, effectiveRole, parseBanDuration } from './moderation.js';
import { store } from './store.js';
import * as UserLevels from './user-levels.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirnameApi = path.dirname(fileURLToPath(import.meta.url));

/** @returns {Promise<Set<string>>} */
async function listTextureFilenames() {
  const dir = path.join(__dirnameApi, '..', 'textures');
  const set = new Set();
  try {
    if (!fs.existsSync(dir)) return set;
    for (const f of fs.readdirSync(dir)) {
      if (/\.(png|webp|gif|jpg|jpeg)$/i.test(f)) set.add(f);
    }
  } catch {
    /* */
  }
  return set;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 2_000_000) {
        req.destroy();
        reject(new Error('too large'));
      }
    });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

async function getActiveSessionUser(req) {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) return null;
  const tok = m[1].trim();
  const uid = await store.sessionUserId(tok);
  if (!uid) return null;
  if (typeof store.clearExpiredBanIfAny === 'function') await store.clearExpiredBanIfAny(uid);
  const user = await store.findUserById(uid);
  if (!user) return null;
  const bs = banStatusForUser(user);
  if (bs.banned) {
    if (typeof store.revokeSession === 'function') await store.revokeSession(tok);
    return null;
  }
  return { userId: uid, user, token: tok };
}

async function bearerUserId(req) {
  const s = await getActiveSessionUser(req);
  return s ? s.userId : null;
}

async function enrichReports(rows) {
  const out = [];
  for (const r of rows) {
    const rep = await store.findUserById(r.reporterId);
    const tgt = await store.findUserById(r.reportedUserId);
    out.push({
      id: r.id,
      reporterId: r.reporterId,
      reportedUserId: r.reportedUserId,
      reporterUsername: rep?.username ?? 'unknown',
      reportedUsername: tgt?.username ?? 'unknown',
      reason: r.reason,
      status: r.status,
      moderatorNote: r.moderatorNote ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt ?? null,
    });
  }
  return out;
}

async function buildMePayload(userId) {
  if (typeof store.clearExpiredBanIfAny === 'function') await store.clearExpiredBanIfAny(userId);
  const user = await store.findUserById(userId);
  if (!user) return null;
  if (banStatusForUser(user).banned) return null;
  const runs = await store.getRunsForUser(userId);
  const achRows = await store.getAchievementsForUser(userId);
  const agg = aggregateRuns(runs);
  const uaMap = new Map(achRows.map((a) => [a.achievementId, a.unlockedAt]));
  const achievements = ACHIEVEMENT_DEFS.map((def) => ({
    id: def.id,
    title: def.title,
    desc: def.desc,
    unlocked: uaMap.has(def.id),
    unlockedAt: uaMap.get(def.id) ?? null,
  }));
  const role = effectiveRole(user);
  let modInboxCount = 0;
  let ownerInboxCount = 0;
  if (typeof store.countReportsByStatus === 'function') {
    try {
      if (role === 'moderator') modInboxCount = await store.countReportsByStatus('pending');
      if (role === 'owner') ownerInboxCount = await store.countReportsByStatus('escalated');
    } catch {
      /* */
    }
  }
  return {
    username: user.username,
    role,
    coins: user.coins != null ? Number(user.coins) : 0,
    skinTexture: user.skinTexture ?? user.skin_texture ?? null,
    modInboxCount,
    ownerInboxCount,
    stats: {
      runCount: agg.runCount,
      totalDeaths: agg.totalDeaths,
      minDeaths: agg.minDeaths,
      maxDeaths: agg.maxDeaths,
      bestTimeMs: agg.bestTimeMs,
      avgTimeMs: agg.avgTimeMs,
      avgDeaths: agg.avgDeaths,
    },
    achievements,
  };
}

function loginBanJson(bs) {
  const msg = bs.permanent
    ? 'This account is permanently suspended.'
    : 'This account is suspended until the ban expires.';
  return {
    error: msg,
    banned: true,
    permanent: !!bs.permanent,
    untilMs: bs.untilMs,
    reason: bs.reason,
  };
}

/** @returns {Promise<boolean>} true if handled */
export async function handleApi(req, res) {
  const u = new URL(req.url || '/', 'http://localhost');
  const path = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '86400' });
    res.end();
    return true;
  }

  if (path === '/api/register' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    try {
      const user = await store.createUser(body.username, body.password);
      const { token } = await store.createSession(user.id);
      json(res, 201, { token, username: user.username });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/login' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const user = await store.verifyUser(body.username, body.password);
    if (!user) {
      json(res, 401, { error: 'Invalid username or password' });
      return true;
    }
    if (typeof store.clearExpiredBanIfAny === 'function') await store.clearExpiredBanIfAny(user.id);
    const fresh = await store.findUserById(user.id);
    const bs = banStatusForUser(fresh);
    if (bs.banned) {
      json(res, 403, loginBanJson(bs));
      return true;
    }
    const { token } = await store.createSession(user.id);
    json(res, 200, { token, username: user.username });
    return true;
  }

  if (path === '/api/logout' && req.method === 'POST') {
    const h = req.headers.authorization;
    if (h && /^Bearer\s+/i.test(h)) {
      const tok = h.replace(/^Bearer\s+/i, '').trim();
      await store.revokeSession(tok);
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/me' && req.method === 'GET') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    const me = await buildMePayload(uid);
    if (!me) {
      json(res, 401, { error: 'Invalid session' });
      return true;
    }
    json(res, 200, me);
    return true;
  }

  if (path === '/api/me/skin' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const raw = body.skinTexture != null ? String(body.skinTexture).trim() : '';
    const fname = raw === '' || raw === 'default' ? null : path.basename(raw);
    if (fname && !/\.(png|webp|gif|jpg|jpeg)$/i.test(fname)) {
      json(res, 400, { error: 'Skin must be an image filename (e.g. myskin.png)' });
      return true;
    }
    if (fname && typeof store.setUserSkinTexture !== 'function') {
      json(res, 501, { error: 'Skin storage not available' });
      return true;
    }
    try {
      if (fname) {
        const allowed = await listTextureFilenames();
        if (!allowed.has(fname)) {
          json(res, 400, { error: 'Unknown texture. Add the file under textures/ on the server.' });
          return true;
        }
      }
      await store.setUserSkinTexture(uid, fname);
      const me = await buildMePayload(uid);
      json(res, 200, { ok: true, skinTexture: me.skinTexture, coins: me.coins });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/runs' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    try {
      const timeMs = Math.max(0, Math.min(Number(body.timeMs) || 0, 48 * 60 * 60 * 1000));
      const deaths = Math.max(0, Math.min(Math.floor(Number(body.deaths) || 0), 1_000_000));
      const source = body.source === 'race' ? 'race' : 'campaign';

      const runsBefore = await store.getRunsForUser(uid);
      const campaignBefore = runsBefore.filter((r) => r.source === 'campaign');
      const prevCampaignBest =
        campaignBefore.length > 0 ? Math.min(...campaignBefore.map((r) => r.timeMs)) : null;

      await store.addRun(uid, timeMs, deaths, source);

      const runs = await store.getRunsForUser(uid);
      const achRows = await store.getAchievementsForUser(uid);
      const unlockedIds = achRows.map((a) => a.achievementId);
      const newAch = computeNewUnlocks(
        runs.map((r) => ({ deaths: r.deaths, timeMs: r.timeMs })),
        unlockedIds
      );
      if (newAch.length) await store.insertUserAchievements(uid, newAch);

      let coinDelta = newAch.length * ACHIEVEMENT_COIN_REWARD;

      if (source === 'campaign' && body.campaignCoinMeta && typeof body.campaignCoinMeta === 'object') {
        const m = body.campaignCoinMeta;
        const sec = Math.floor(timeMs / 1000);
        if (m.completedFullRun) {
          const ceilPart = Math.ceil((1800 - sec) / 10);
          coinDelta += Math.max(0, ceilPart) + 5;
        }
        const pickups = Math.max(0, Math.min(5000, Math.floor(Number(m.stageCoinsCollected) || 0)));
        coinDelta += pickups;
        const isNewPB = prevCampaignBest == null || timeMs < prevCampaignBest;
        const improvement = prevCampaignBest != null ? prevCampaignBest - timeMs : 0;
        if (m.pbBonusEligible && isNewPB && prevCampaignBest != null && improvement >= 5000) {
          coinDelta += 75;
        }
      }

      if (coinDelta > 0 && typeof store.incrementUserCoins === 'function') {
        await store.incrementUserCoins(uid, coinDelta);
      }

      const me = await buildMePayload(uid);
      json(res, 200, {
        ok: true,
        newAchievements: newAch.map((a) => ({ id: a.id, title: a.title, desc: a.desc })),
        stats: me.stats,
        coins: me.coins,
        coinsEarnedThisSubmit: coinDelta,
      });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/achievement-defs' && req.method === 'GET') {
    json(
      res,
      200,
      ACHIEVEMENT_DEFS.map((d) => ({ id: d.id, title: d.title, desc: d.desc }))
    );
    return true;
  }

  if (path === '/api/textures' && req.method === 'GET') {
    try {
      const set = await listTextureFilenames();
      json(res, 200, { textures: [...set].sort() });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/builtin-stages' && req.method === 'GET') {
    try {
      if (typeof store.getBuiltinCampaignStages !== 'function') {
        json(res, 200, { stages: null });
        return true;
      }
      const stages = await store.getBuiltinCampaignStages();
      json(res, 200, { stages: stages && stages.length ? stages : null });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/owner/builtin-stages' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only' });
      return true;
    }
    if (typeof store.setBuiltinCampaignStages !== 'function') {
      json(res, 501, { error: 'Not configured' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const stages = body.stages;
    if (!Array.isArray(stages) || stages.length < 1) {
      json(res, 400, { error: 'stages array required' });
      return true;
    }
    const raw = JSON.stringify(stages);
    if (raw.length > 4_000_000) {
      json(res, 400, { error: 'Campaign data too large' });
      return true;
    }
    try {
      await store.setBuiltinCampaignStages(stages);
      json(res, 200, { ok: true, count: stages.length });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/reports' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const reportedUsername = String(body.reportedUsername || '').trim();
    const reason = String(body.reason || '').trim();
   
    if (reason.length < 3) {
      json(res, 400, { error: 'Please enter a reason (at least 3 characters).' });
      return true;
    }
    if (reason.length > 4000) {
      json(res, 400, { error: 'Reason is too long.' });
      return true;
    }
    try {
      const target = await store.findUserByUsername(reportedUsername);
      if (!target) {
        json(res, 400, { error: 'User not found.' });
        return true;
      }
      if (target.id === sess.userId) {
        json(res, 400, { error: 'You cannot report yourself.' });
        return true;
      }
      if (typeof store.createReport !== 'function') {
        json(res, 501, { error: 'Reports are not configured on this server (upgrade server + run DB migration).' });
        return true;
      }
      const id = await store.createReport(sess.userId, target.id, reason);
      json(res, 201, { ok: true, id });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/mod/reports' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    const role = effectiveRole(sess.user);
    if (role !== 'moderator' && role !== 'owner') {
      json(res, 403, { error: 'Not allowed' });
      return true;
    }
    if (typeof store.listReportsByStatus !== 'function') {
      json(res, 501, { error: 'Reports not configured.' });
      return true;
    }
    try {
      if (role === 'moderator') {
        const rows = await store.listReportsByStatus('pending');
        json(res, 200, { scope: 'pending', reports: await enrichReports(rows) });
      } else {
        const rows = await store.listReportsByStatus('escalated');
        json(res, 200, { scope: 'escalated', reports: await enrichReports(rows) });
      }
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/mod\/reports\/([^/]+)\/reject$/.exec(path);
    if (m && req.method === 'POST') {
      const reportId = m[1];
      const sess = await getActiveSessionUser(req);
      if (!sess) {
        json(res, 401, { error: 'Not logged in' });
        return true;
      }
      if (effectiveRole(sess.user) !== 'moderator') {
        json(res, 403, { error: 'Only moderators can reject from the main queue.' });
        return true;
      }
      let body = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw);
      } catch {
        body = {};
      }
      try {
        const r = await store.getReportById(reportId);
        if (!r || r.status !== 'pending') {
          json(res, 400, { error: 'Report not pending.' });
          return true;
        }
        const ok = await store.updateReportStatus(reportId, 'rejected', body.note || null);
        if (!ok) {
          json(res, 404, { error: 'Report not found.' });
          return true;
        }
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 500, { error: String(e.message || e) });
      }
      return true;
    }
  }

  {
    const m = /^\/api\/mod\/reports\/([^/]+)\/escalate$/.exec(path);
    if (m && req.method === 'POST') {
      const reportId = m[1];
      const sess = await getActiveSessionUser(req);
      if (!sess) {
        json(res, 401, { error: 'Not logged in' });
        return true;
      }
      if (effectiveRole(sess.user) !== 'moderator') {
        json(res, 403, { error: 'Only moderators can escalate.' });
        return true;
      }
      let body = {};
      try {
        const raw = await readBody(req);
        if (raw) body = JSON.parse(raw);
      } catch {
        body = {};
      }
      try {
        const r = await store.getReportById(reportId);
        if (!r || r.status !== 'pending') {
          json(res, 400, { error: 'Report not pending.' });
          return true;
        }
        const ok = await store.updateReportStatus(reportId, 'escalated', body.note || null);
        if (!ok) {
          json(res, 404, { error: 'Report not found.' });
          return true;
        }
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 500, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (path === '/api/owner/ban' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    let userVictimId = Math.floor(Number(body.userId));
    if (!userVictimId || userVictimId < 1) {
      const un = String(body.username || '').trim();
      if (un) {
        const u = await store.findUserByUsername(un);
        userVictimId = u?.id;
      }
    }
    const until = parseBanDuration(body);
    if (!userVictimId || userVictimId < 1) {
      json(res, 400, { error: 'Invalid userId or username' });
      return true;
    }
    if (until == null) {
      json(res, 400, {
        error: 'Invalid duration: use 1w, 2w, 1m, perm, customDuration{weeks,days,hours,minutes,seconds}, or banUntilMs.',
      });
      return true;
    }
    try {
      const victim = await store.findUserById(userVictimId);
      if (!victim) {
        json(res, 400, { error: 'User not found' });
        return true;
      }
      const own = effectiveRole(victim);
      if (own === 'owner') {
        json(res, 400, { error: 'Cannot ban the site owner account.' });
        return true;
      }
      const reason = body.reason != null ? String(body.reason).slice(0, 500) : null;
      await store.applyBan(userVictimId, until, reason || 'Moderation action');
      const reportId = body.reportId ? String(body.reportId) : null;
      if (reportId && store.getReportById && store.updateReportStatus) {
        const rep = await store.getReportById(reportId);
        if (rep && rep.status === 'escalated') await store.updateReportStatus(reportId, 'resolved', body.note || null);
      }
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/owner/dismiss-report' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const reportId = String(body.reportId || '');
    if (!reportId) {
      json(res, 400, { error: 'reportId required' });
      return true;
    }
    try {
      const r = await store.getReportById(reportId);
      if (!r || r.status !== 'escalated') {
        json(res, 400, { error: 'Report not in escalated queue.' });
        return true;
      }
      await store.updateReportStatus(reportId, 'resolved', body.note || 'Dismissed');
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/owner/moderators' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only' });
      return true;
    }
    try {
      if (typeof store.listModerators !== 'function') {
        json(res, 501, { error: 'Not configured' });
        return true;
      }
      const moderators = await store.listModerators();
      json(res, 200, { moderators });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/owner/set-moderator' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const un = String(body.username || '').trim();
    const promote = !!body.promote;
    if (!un) {
      json(res, 400, { error: 'username required' });
      return true;
    }
    try {
      const u = await store.findUserByUsername(un);
      if (!u) {
        json(res, 400, { error: 'User not found' });
        return true;
      }
      await store.setModeratorRole(u.id, promote);
      json(res, 200, { ok: true, username: u.username, moderator: promote });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  {
    const m = /^\/api\/levels\/([^/]+)\/coin-state$/.exec(path);
    if (m && req.method === 'GET') {
      const uid = await bearerUserId(req);
      if (!uid) {
        json(res, 401, { error: 'Not logged in' });
        return true;
      }
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      if (typeof store.listOnlineCoinClaimIndices !== 'function') {
        json(res, 200, { collected: [] });
        return true;
      }
      try {
        const s = await store.listOnlineCoinClaimIndices(uid, m[1]);
        json(res, 200, { collected: [...s].sort((a, b) => a - b) });
      } catch (e) {
        json(res, 500, { error: String(e.message || e) });
      }
      return true;
    }
  }

  {
    const m = /^\/api\/levels\/([^/]+)\/collect-coin$/.exec(path);
    if (m && req.method === 'POST') {
      const uid = await bearerUserId(req);
      if (!uid) {
        json(res, 401, { error: 'Not logged in' });
        return true;
      }
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        body = {};
      }
      const idx = Math.floor(Number(body.coinIndex));
      if (idx < 0 || idx > 4096) {
        json(res, 400, { error: 'coinIndex required' });
        return true;
      }
      if (typeof store.claimOnlineCoin !== 'function' || typeof store.incrementUserCoins !== 'function') {
        json(res, 501, { error: 'Not configured' });
        return true;
      }
      try {
        const ok = await store.claimOnlineCoin(uid, m[1], idx);
        if (!ok) {
          json(res, 200, { ok: false, already: true });
          return true;
        }
        await store.incrementUserCoins(uid, 5);
        const me = await buildMePayload(uid);
        json(res, 200, { ok: true, coins: me.coins });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (path === '/api/levels/mine' && req.method === 'GET') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      const list = await UserLevels.levelsMine(uid);
      json(res, 200, { levels: list });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/levels/save' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    try {
      if (body.id && uuidRe.test(String(body.id))) {
        await UserLevels.levelsUpdateDraft(uid, String(body.id), body.title, body.data);
        json(res, 200, { id: String(body.id) });
      } else {
        const out = await UserLevels.levelsCreate(uid, body.title, body.data);
        json(res, 201, out);
      }
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/levels\/([^/]+)\/beat$/.exec(path);
    if (m && req.method === 'POST') {
      const uid = await bearerUserId(req);
      if (!uid) {
        json(res, 401, { error: 'Not logged in' });
        return true;
      }
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      try {
        await UserLevels.levelsMarkBeaten(uid, m[1]);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  {
    const m = /^\/api\/levels\/([^/]+)\/publish$/.exec(path);
    if (m && req.method === 'POST') {
      const uid = await bearerUserId(req);
      if (!uid) {
        json(res, 401, { error: 'Not logged in' });
        return true;
      }
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      try {
        await UserLevels.levelsPublish(uid, m[1]);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  {
    const m = /^\/api\/levels\/([^/]+)\/play$/.exec(path);
    if (m && req.method === 'POST') {
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      try {
        await UserLevels.levelsRecordPlay(m[1]);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 500, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (path === '/api/levels/search' && req.method === 'GET') {
    const q = u.searchParams.get('q') || '';
    const page = Number(u.searchParams.get('page') || '1') || 1;
    try {
      const out = await UserLevels.levelsSearchName(q, page);
      json(res, 200, out);
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/levels/lookup' && req.method === 'GET') {
    const id = (u.searchParams.get('id') || '').trim();
    try {
      const item = await UserLevels.levelsPublishedMetaById(id);
      json(res, 200, { item });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/levels\/([^/]+)$/.exec(path);
    if (m && req.method === 'GET') {
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      const uid = (await bearerUserId(req)) || null;
      const row = await UserLevels.levelsGetById(m[1], uid);
      if (!row) {
        json(res, 404, { error: 'Not found' });
        return true;
      }
      json(res, 200, row);
      return true;
    }
  }

  if (path.startsWith('/api/levels/user/') && req.method === 'GET') {
    const rest = path.slice('/api/levels/user/'.length);
    const username = decodeURIComponent((rest.split('?')[0] || '').trim().toLowerCase());
    const page = Number(u.searchParams.get('page') || '1') || 1;
    if (!username) {
      json(res, 400, { error: 'Username required' });
      return true;
    }
    try {
      const out = await UserLevels.levelsListByUsername(username, page);
      json(res, 200, out);
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  return false;
}
