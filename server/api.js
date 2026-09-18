import { ACHIEVEMENT_COIN_REWARD, ACHIEVEMENT_DEFS, aggregateRuns, computeNewUnlocks } from './achievements.js';
import {
  appendCampaignCheckpoint,
  finalizeCampaignRunSession,
  startCampaignRunSession,
} from './campaign-run-sessions.js';
import { banStatusForUser, assertAccountActive, effectiveRole, isAccountDisabled, ownerUsernameLower, parseBanDuration } from './moderation.js';
import { censorProfanity } from './profanity-filter.js';
import {
  createDeleteToken,
  consumeDeleteToken,
  consumeDeleteTokenPublic,
  peekDeleteToken,
} from './owner-delete.js';
import { sendOwnerMail } from './mail.js';
import { getShopItemById, SHOP_ITEMS, SHOP_PAGES, SHOP_SLOTS_PER_PAGE } from './shop-catalog.js';
import { store } from './store.js';
import * as UserLevels from './user-levels.js';
import { extFromContentType, publicAvatarUrl, sniffImageExt, MAX_AVATAR_BYTES } from './profile-storage.js';
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

const PEER_COIN_GIFT_MAX = 100_000;

async function userMayEquipTexture(uid, user, fname) {
  if (!fname) return true;
  const base = path.basename(fname);
  const allowed = await listTextureFilenames();
  if (!allowed.has(base)) return false;
  if (effectiveRole(user) === 'owner') return true;
  if (typeof store.userHasTextureGrant !== 'function') return false;
  return store.userHasTextureGrant(uid, base);
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

async function requireStaffSession(req) {
  const sess = await getActiveSessionUser(req);
  if (!sess) return null;
  const role = effectiveRole(sess.user);
  if (role !== 'moderator' && role !== 'owner') return null;
  return Object.assign({}, sess, { role });
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

function resolveProfileAvatarUrl(user, req) {
  const p = user?.profileAvatarPath ?? user?.profile_avatar_path ?? null;
  if (!p) return null;
  if (process.env.SUPABASE_URL && !String(p).startsWith('file:')) {
    return publicAvatarUrl(process.env.SUPABASE_URL, p);
  }
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host || 'localhost';
  const proto = req?.headers?.['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  const uid = user?.id;
  if (uid == null) return null;
  return `${proto}://${host}/api/profile/avatar-file/${uid}`;
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

async function buildMePayload(userId, req = null) {
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
  const coinsInfinite = role === 'owner';
  let unlockedTextures = [];
  if (typeof store.listTextureGrantsForUser === 'function') {
    try {
      unlockedTextures = await store.listTextureGrantsForUser(userId);
    } catch {
      unlockedTextures = [];
    }
  }
  let friendIncomingCount = 0;
  if (typeof store.countIncomingPendingFriendRequests === 'function') {
    try {
      friendIncomingCount = await store.countIncomingPendingFriendRequests(userId);
    } catch {
      friendIncomingCount = 0;
    }
  }
  return {
    username: user.username,
    role,
    disabled: isAccountDisabled(user),
    coinsInfinite,
    coins: user.coins != null ? Number(user.coins) : 0,
    skinTexture: user.skinTexture ?? user.skin_texture ?? null,
    profileBio: user.profileBio ?? user.profile_bio ?? null,
    profileAvatarUrl: resolveProfileAvatarUrl(user, req),
    unlockedTextures,
    friendIncomingCount,
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
  const pathname = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '86400' });
    res.end();
    return true;
  }

  if (pathname === '/api/register' && req.method === 'POST') {
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

  if (pathname === '/api/login' && req.method === 'POST') {
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

  if (pathname === '/api/logout' && req.method === 'POST') {
    const h = req.headers.authorization;
    if (h && /^Bearer\s+/i.test(h)) {
      const tok = h.replace(/^Bearer\s+/i, '').trim();
      await store.revokeSession(tok);
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (pathname === '/api/me' && req.method === 'GET') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    const me = await buildMePayload(uid, req);
    if (!me) {
      json(res, 401, { error: 'Invalid session' });
      return true;
    }
    json(res, 200, me);
    return true;
  }

  if (pathname === '/api/me/profile' && req.method === 'PATCH') {
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
    if (typeof store.setUserProfile !== 'function') {
      json(res, 501, { error: 'Profiles not configured' });
      return true;
    }
    try {
      assertAccountActive(await store.findUserById(uid));
      const bioCensored = censorProfanity(body.bio != null ? String(body.bio) : '').text;
      await store.setUserProfile(uid, { bio: bioCensored });
      const me = await buildMePayload(uid, req);
      json(res, 200, { ok: true, profileBio: me.profileBio, profileAvatarUrl: me.profileAvatarUrl });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/me/profile/avatar' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (typeof store.uploadUserProfileAvatar !== 'function') {
      json(res, 501, { error: 'Profile avatars not configured' });
      return true;
    }
    try {
      assertAccountActive(await store.findUserById(uid));
      let contentType = String(req.headers['content-type'] || '').split(';')[0].trim();
      let buf;
      if (contentType.includes('application/json')) {
        const body = JSON.parse(await readBody(req));
        const b64 = String(body.imageBase64 || '').replace(/^data:[^;]+;base64,/, '');
        buf = Buffer.from(b64, 'base64');
        if (body.contentType) contentType = String(body.contentType);
      } else {
        json(res, 400, { error: 'Send JSON { imageBase64, contentType }.' });
        return true;
      }
      if (!buf || !buf.length) {
        json(res, 400, { error: 'Empty image body' });
        return true;
      }
      if (buf.length > MAX_AVATAR_BYTES) {
        json(res, 400, { error: 'Avatar must be 512 KB or smaller.' });
        return true;
      }
      if (!sniffImageExt(buf)) {
        json(res, 400, { error: 'File must be PNG, JPEG, WebP, or GIF.' });
        return true;
      }
      const pathStored = await store.uploadUserProfileAvatar(uid, buf, contentType);
      const user = await store.findUserById(uid);
      json(res, 200, {
        ok: true,
        avatarPath: pathStored,
        profileAvatarUrl: resolveProfileAvatarUrl(user, req),
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/me/profile/avatar-upload-url' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (typeof store.createUserProfileSignedAvatarUpload !== 'function') {
      json(res, 501, { error: 'Signed upload requires Supabase Storage' });
      return true;
    }
    let body = {};
    try {
      const raw = await readBody(req);
      if (raw) body = JSON.parse(raw);
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    try {
      assertAccountActive(await store.findUserById(uid));
      const ext = extFromContentType(body.contentType) || 'webp';
      const signed = await store.createUserProfileSignedAvatarUpload(uid, ext);
      json(res, 200, {
        ok: true,
        bucket: 'skyhop-profiles',
        path: signed.path,
        signedUrl: signed.signedUrl,
        token: signed.token,
        folder: String(uid),
        hint: 'Upload only to your folder via this signed URL, then POST /api/me/profile/avatar/confirm',
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/me/profile/avatar/confirm' && req.method === 'POST') {
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
    const pathStored = String(body.path || '').trim();
    const folder = String(uid);
    if (!pathStored.startsWith(`${folder}/`)) {
      json(res, 403, { error: 'Path must be inside your profile folder.' });
      return true;
    }
    if (typeof store.setUserProfile !== 'function') {
      json(res, 501, { error: 'Profiles not configured' });
      return true;
    }
    try {
      await store.setUserProfile(uid, { avatarPath: pathStored });
      const user = await store.findUserById(uid);
      json(res, 200, { ok: true, profileAvatarUrl: resolveProfileAvatarUrl(user, req) });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/profile\/avatar-file\/(\d+)$/.exec(pathname);
    if (m && req.method === 'GET') {
      const uid = Number(m[1]);
      if (!Number.isFinite(uid)) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      try {
        const user = await store.findUserById(uid);
        if (!user || !user.profileAvatarPath) {
          json(res, 404, { error: 'No avatar' });
          return true;
        }
        const rel = user.profileAvatarPath;
        const ext = rel.split('.').pop() || 'png';
        const full = path.join(__dirnameApi, 'data', 'profile-avatars', `${uid}.${ext}`);
        if (!fs.existsSync(full)) {
          json(res, 404, { error: 'No avatar file' });
          return true;
        }
        const mime =
          ext === 'png'
            ? 'image/png'
            : ext === 'webp'
              ? 'image/webp'
              : ext === 'gif'
                ? 'image/gif'
                : 'image/jpeg';
        res.writeHead(200, { 'Content-Type': mime, ...CORS, 'Cache-Control': 'public, max-age=300' });
        res.end(fs.readFileSync(full));
      } catch (e) {
        json(res, 500, { error: String(e.message || e) });
      }
      return true;
    }
  }

  {
    const m = /^\/api\/profile\/([^/]+)$/.exec(pathname);
    if (m && req.method === 'GET') {
      const un = decodeURIComponent(m[1]).trim();
      if (!un || un.length > 24) {
        json(res, 400, { error: 'Invalid username' });
        return true;
      }
      if (typeof store.getPublicProfileByUsername !== 'function') {
        json(res, 501, { error: 'Profiles not configured' });
        return true;
      }
      try {
        const p = await store.getPublicProfileByUsername(un);
        if (!p) {
          json(res, 404, { error: 'User not found' });
          return true;
        }
        const user = await store.findUserByUsername(un);
        json(res, 200, {
          username: p.username,
          bio: p.bio,
          avatarUrl: user ? resolveProfileAvatarUrl(user, req) : null,
          role: effectiveRole(user || {}),
        });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/me/skin' && req.method === 'POST') {
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
        const u = await store.findUserById(uid);
        if (!u) {
          json(res, 400, { error: 'User not found' });
          return true;
        }
        const may = await userMayEquipTexture(uid, u, fname);
        if (!may) {
          json(res, 400, { error: 'You have not unlocked this skin (coin shop or gift).' });
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

  if (pathname === '/api/campaign-run/start' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      const session = startCampaignRunSession(uid);
      json(res, 200, { ok: true, ...session });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/campaign-run/checkpoint' && req.method === 'POST') {
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
      const result = appendCampaignCheckpoint(uid, body.sessionId, body);
      if (!result.ok) {
        json(res, 400, { error: result.error || 'Checkpoint rejected' });
        return true;
      }
      json(res, 200, result);
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/runs' && req.method === 'POST') {
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

      const diffRaw = body.difficulty != null ? String(body.difficulty).toLowerCase() : '';
      const difficulty =
        diffRaw === 'easy' || diffRaw === 'normal' || diffRaw === 'hard' ? diffRaw : undefined;
      await store.addRun(uid, timeMs, deaths, source, difficulty);

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
        const runSessionId =
          body.campaignRunSessionId != null
            ? String(body.campaignRunSessionId).trim()
            : m.campaignRunSessionId != null
              ? String(m.campaignRunSessionId).trim()
              : '';
        if (isNewPB && runSessionId) {
          const finalized = finalizeCampaignRunSession(uid, runSessionId, {
            timeMs,
            prevBestMs: prevCampaignBest,
          });
          if (finalized && finalized.pbBonusEligible) {
            coinDelta += 75;
          }
        }
      }

      if (coinDelta > 0 && typeof store.incrementUserCoins === 'function') {
        const creditUser = await store.findUserById(uid);
        if (creditUser && effectiveRole(creditUser) !== 'owner') {
          await store.incrementUserCoins(uid, coinDelta);
        }
      }

      const me = await buildMePayload(uid);
      json(res, 200, {
        ok: true,
        newAchievements: newAch.map((a) => ({ id: a.id, title: a.title, desc: a.desc })),
        stats: me.stats,
        coins: me.coins,
        coinsInfinite: !!me.coinsInfinite,
        coinsEarnedThisSubmit: me.coinsInfinite ? 0 : coinDelta,
      });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/leaderboard/campaign' && req.method === 'GET') {
    const diff = String(u.searchParams.get('difficulty') || 'normal').toLowerCase();
    if (diff !== 'easy' && diff !== 'normal' && diff !== 'hard') {
      json(res, 400, { error: 'difficulty must be easy, normal, or hard' });
      return true;
    }
    if (typeof store.listCampaignLeaderboard !== 'function') {
      json(res, 501, { error: 'Leaderboard not configured on this server.' });
      return true;
    }
    try {
      const rows = await store.listCampaignLeaderboard(diff, 10);
      json(res, 200, { difficulty: diff, entries: rows });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/achievement-defs' && req.method === 'GET') {
    json(
      res,
      200,
      ACHIEVEMENT_DEFS.map((d) => ({ id: d.id, title: d.title, desc: d.desc }))
    );
    return true;
  }

  if (pathname === '/api/textures' && req.method === 'GET') {
    try {
      const sess = await getActiveSessionUser(req);
      if (!sess) {
        json(res, 200, { textures: [] });
        return true;
      }
      if (effectiveRole(sess.user) === 'owner') {
        const set = await listTextureFilenames();
        json(res, 200, { textures: [...set].sort() });
        return true;
      }
      if (typeof store.listTextureGrantsForUser !== 'function') {
        json(res, 200, { textures: [] });
        return true;
      }
      const list = await store.listTextureGrantsForUser(sess.userId);
      json(res, 200, { textures: list });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/shop/items' && req.method === 'GET') {
    try {
      const disk = await listTextureFilenames();
      const items = SHOP_ITEMS.filter((x) => disk.has(x.texture)).map((x) => ({
        id: x.id,
        texture: x.texture,
        price: x.price,
        sellPrice: x.sellPrice != null ? x.sellPrice : 0,
        label: x.label || x.texture,
        page: x.page != null ? x.page : 1,
        slot: x.slot != null ? x.slot : 0,
      }));
      json(res, 200, { items, pages: SHOP_PAGES, slotsPerPage: SHOP_SLOTS_PER_PAGE });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/shop/buy' && req.method === 'POST') {
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
    const item = getShopItemById(String(body.itemId || ''));
    if (!item) {
      json(res, 400, { error: 'Unknown shop item.' });
      return true;
    }
    try {
      const disk = await listTextureFilenames();
      if (!disk.has(item.texture)) {
        json(res, 400, { error: 'That item is not available on this server.' });
        return true;
      }
      if (typeof store.userHasTextureGrant !== 'function' || typeof store.addTextureGrant !== 'function') {
        json(res, 501, { error: 'Shop not configured.' });
        return true;
      }
      if (await store.userHasTextureGrant(sess.userId, item.texture)) {
        json(res, 400, { error: 'You already own this skin.' });
        return true;
      }
      const infinite = effectiveRole(sess.user) === 'owner';
      if (!infinite) {
        const u = await store.findUserById(sess.userId);
        if (!u) throw new Error('User not found');
        const bal = u.coins != null ? Number(u.coins) : 0;
        if (bal < item.price) {
          json(res, 400, { error: 'Not enough coins.' });
          return true;
        }
        await store.incrementUserCoins(sess.userId, -item.price);
      }
      await store.addTextureGrant(sess.userId, item.texture);
      const me = await buildMePayload(sess.userId);
      json(res, 200, {
        ok: true,
        unlockedTextures: me.unlockedTextures,
        coins: me.coins,
        coinsInfinite: !!me.coinsInfinite,
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/shop/sell' && req.method === 'POST') {
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
    const item = getShopItemById(String(body.itemId || ''));
    if (!item) {
      json(res, 400, { error: 'Unknown shop item.' });
      return true;
    }
    const sellPrice = Math.max(0, Math.floor(Number(item.sellPrice) || 0));
    if (sellPrice <= 0) {
      json(res, 400, { error: 'This item cannot be sold.' });
      return true;
    }
    try {
      if (typeof store.userHasTextureGrant !== 'function' || typeof store.removeTextureGrant !== 'function') {
        json(res, 501, { error: 'Shop not configured.' });
        return true;
      }
      if (!(await store.userHasTextureGrant(sess.userId, item.texture))) {
        json(res, 400, { error: 'You do not own this skin.' });
        return true;
      }
      const removed = await store.removeTextureGrant(sess.userId, item.texture);
      if (!removed) {
        json(res, 400, { error: 'Could not remove skin.' });
        return true;
      }
      const u = await store.findUserById(sess.userId);
      const equipped = u?.skinTexture ?? u?.skin_texture ?? null;
      if (equipped && path.basename(String(equipped)) === item.texture) {
        if (typeof store.setUserSkinTexture === 'function') {
          await store.setUserSkinTexture(sess.userId, null);
        }
      }
      const infinite = effectiveRole(sess.user) === 'owner';
      if (!infinite) {
        await store.incrementUserCoins(sess.userId, sellPrice);
      }
      const me = await buildMePayload(sess.userId, req);
      json(res, 200, {
        ok: true,
        unlockedTextures: me.unlockedTextures,
        coins: me.coins,
        coinsInfinite: !!me.coinsInfinite,
        sellPrice,
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/friends' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (typeof store.listFriendsBundle !== 'function') {
      json(res, 501, { error: 'Friends not configured.' });
      return true;
    }
    try {
      const bundle = await store.listFriendsBundle(sess.userId);
      json(res, 200, bundle);
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/friends/request' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (typeof store.createFriendRequest !== 'function') {
      json(res, 501, { error: 'Friends not configured.' });
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
    if (!un) {
      json(res, 400, { error: 'username required' });
      return true;
    }
    try {
      const target = await store.findUserByUsername(un);
      if (!target) {
        json(res, 400, { error: 'User not found.' });
        return true;
      }
      await store.createFriendRequest(sess.userId, target.id);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/friends/accept' && req.method === 'POST') {
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
    const requestId = String(body.requestId || '');
    if (!requestId) {
      json(res, 400, { error: 'requestId required' });
      return true;
    }
    try {
      await store.acceptFriendRequest(requestId, sess.userId);
      const bundle = await store.listFriendsBundle(sess.userId);
      json(res, 200, { ok: true, ...bundle });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/friends/decline' && req.method === 'POST') {
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
    const requestId = String(body.requestId || '');
    if (!requestId) {
      json(res, 400, { error: 'requestId required' });
      return true;
    }
    try {
      await store.declineFriendRequest(requestId, sess.userId);
      const bundle = await store.listFriendsBundle(sess.userId);
      json(res, 200, { ok: true, ...bundle });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/friends/gift-coins' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (typeof store.areFriends !== 'function' || typeof store.transferCoins !== 'function') {
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
    const targetName = String(body.username || '').trim();
    const amount = Math.floor(Number(body.amount));
    if (!targetName) {
      json(res, 400, { error: 'username required' });
      return true;
    }
    if (!Number.isFinite(amount) || amount < 1 || amount > PEER_COIN_GIFT_MAX) {
      json(res, 400, { error: `Amount must be 1–${PEER_COIN_GIFT_MAX.toLocaleString()}.` });
      return true;
    }
    try {
      const target = await store.findUserByUsername(targetName);
      if (!target) {
        json(res, 400, { error: 'User not found.' });
        return true;
      }
      if (target.id === sess.userId) {
        json(res, 400, { error: 'Pick a friend to receive the gift.' });
        return true;
      }
      const friends = await store.areFriends(sess.userId, target.id);
      if (!friends) {
        json(res, 400, { error: 'You can only gift coins to accepted friends.' });
        return true;
      }
      const skipDebit = effectiveRole(sess.user) === 'owner';
      await store.transferCoins(sess.userId, target.id, amount, { skipSenderDebit: skipDebit });
      const recipient = await store.findUserById(target.id);
      const me = await buildMePayload(sess.userId);
      json(res, 200, {
        ok: true,
        recipientUsername: recipient.username,
        recipientCoins: recipient.coins != null ? Number(recipient.coins) : 0,
        yourCoins: me.coins,
        coinsInfinite: !!me.coinsInfinite,
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/friends/chat/messages' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      assertAccountActive(sess.user);
    } catch (e) {
      json(res, 403, { error: String(e.message || e) });
      return true;
    }
    if (typeof store.listFriendChatMessages !== 'function') {
      json(res, 501, { error: 'Chat not configured on server.' });
      return true;
    }
    const friendUsername = String(u.searchParams.get('friendUsername') || '').trim();
    const since = Number(u.searchParams.get('since') || 0) || 0;
    if (!friendUsername) {
      json(res, 400, { error: 'friendUsername required' });
      return true;
    }
    try {
      const friend = await store.findUserByUsername(friendUsername);
      if (!friend) {
        json(res, 400, { error: 'Friend not found.' });
        return true;
      }
      const ok = await store.areFriends(sess.userId, friend.id);
      if (!ok) {
        json(res, 403, { error: 'Chat is only available with accepted friends.' });
        return true;
      }
      const messages = await store.listFriendChatMessages(sess.userId, friend.id, since);
      json(res, 200, { messages });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/friends/chat/send' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      assertAccountActive(sess.user);
    } catch (e) {
      json(res, 403, { error: String(e.message || e) });
      return true;
    }
    if (typeof store.insertFriendChatMessage !== 'function') {
      json(res, 501, { error: 'Chat not configured on server.' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const toUsername = String(body.toUsername || '').trim();
    const rawText = String(body.text || '');
    if (!toUsername) {
      json(res, 400, { error: 'toUsername required' });
      return true;
    }
    if (!rawText.trim()) {
      json(res, 400, { error: 'Message cannot be empty.' });
      return true;
    }
    if (rawText.length > 2000) {
      json(res, 400, { error: 'Message too long.' });
      return true;
    }
    try {
      const friend = await store.findUserByUsername(toUsername);
      if (!friend) {
        json(res, 400, { error: 'Friend not found.' });
        return true;
      }
      const ok = await store.areFriends(sess.userId, friend.id);
      if (!ok) {
        json(res, 403, { error: 'You can only chat with accepted friends.' });
        return true;
      }
      const censored = censorProfanity(rawText);
      const row = await store.insertFriendChatMessage(sess.userId, friend.id, censored.text);
      json(res, 201, {
        ok: true,
        message: {
          id: row.id,
          body: row.body,
          createdAt: row.createdAt,
          mine: true,
          censored: censored.flagged,
        },
        hint: censored.flagged
          ? 'Some language was censored. Other players may report uncivil chat; profanity alone does not auto-ban.'
          : undefined,
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/builtin-stages' && req.method === 'GET') {
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

  if (pathname === '/api/owner/builtin-stages' && req.method === 'POST') {
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

  if (pathname === '/api/reports' && req.method === 'POST') {
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
    const reason = censorProfanity(String(body.reason || '').trim()).text;
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

  if (pathname === '/api/mod/reports' && req.method === 'GET') {
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
    const m = /^\/api\/mod\/reports\/([^/]+)\/reject$/.exec(pathname);
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
    const m = /^\/api\/mod\/reports\/([^/]+)\/escalate$/.exec(pathname);
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

  if (pathname === '/api/owner/ban' && req.method === 'POST') {
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

  if (pathname === '/api/owner/dismiss-report' && req.method === 'POST') {
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

  if (pathname === '/api/owner/gift-coins' && req.method === 'POST') {
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
    const targetName = String(body.username || '').trim();
    const amount = Math.floor(Number(body.amount));
    if (!targetName) {
      json(res, 400, { error: 'username required' });
      return true;
    }
    if (!Number.isFinite(amount) || amount < 1 || amount > 1_000_000) {
      json(res, 400, { error: 'Amount must be between 1 and 1,000,000.' });
      return true;
    }
    try {
      const target = await store.findUserByUsername(targetName);
      if (!target) {
        json(res, 400, { error: 'User not found.' });
        return true;
      }
      if (effectiveRole(target) === 'owner') {
        json(res, 400, { error: 'That account is the site owner (infinite coins).' });
        return true;
      }
      if (target.id === sess.userId) {
        json(res, 400, { error: 'You already have unlimited coins as owner.' });
        return true;
      }
      await store.incrementUserCoins(target.id, amount);
      const fresh = await store.findUserById(target.id);
      if (!fresh) {
        json(res, 500, { error: 'Could not read user after update.' });
        return true;
      }
      json(res, 200, {
        ok: true,
        username: fresh.username,
        coins: fresh.coins != null ? Number(fresh.coins) : 0,
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/gift-texture' && req.method === 'POST') {
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
    const targetName = String(body.username || '').trim();
    const rawTex = body.texture != null ? String(body.texture) : body.textureFilename != null ? String(body.textureFilename) : '';
    const fname = rawTex ? path.basename(rawTex.trim()) : '';
    if (!targetName) {
      json(res, 400, { error: 'username required' });
      return true;
    }
    if (!fname || !/\.(png|webp|gif|jpg|jpeg)$/i.test(fname)) {
      json(res, 400, { error: 'texture must be a filename like frog.png' });
      return true;
    }
    if (typeof store.addTextureGrant !== 'function') {
      json(res, 501, { error: 'Not configured' });
      return true;
    }
    try {
      const disk = await listTextureFilenames();
      if (!disk.has(fname)) {
        json(res, 400, { error: 'That file is not on the server (add it under textures/).' });
        return true;
      }
      const target = await store.findUserByUsername(targetName);
      if (!target) {
        json(res, 400, { error: 'User not found.' });
        return true;
      }
      const added = await store.addTextureGrant(target.id, fname);
      json(res, 200, {
        ok: true,
        username: target.username,
        texture: fname,
        wasNew: added,
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/moderators' && req.method === 'GET') {
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

  if (pathname === '/api/owner/set-moderator' && req.method === 'POST') {
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

  if (pathname === '/api/owner/account-disable' && req.method === 'POST') {
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
    const disabled = body.disabled !== false;
    if (!un) {
      json(res, 400, { error: 'username required' });
      return true;
    }
    try {
      const target = await store.findUserByUsername(un);
      if (!target) {
        json(res, 400, { error: 'User not found' });
        return true;
      }
      const own = ownerUsernameLower();
      if (own && target.usernameLower === own) {
        json(res, 400, { error: 'Cannot disable the owner account.' });
        return true;
      }
      if (typeof store.setUserDisabled !== 'function') {
        json(res, 501, { error: 'Not configured' });
        return true;
      }
      await store.setUserDisabled(target.id, disabled);
      json(res, 200, { ok: true, username: target.username, disabled });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/account-delete/request' && req.method === 'POST') {
    try {
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
      if (!un) {
        json(res, 400, { error: 'username required' });
        return true;
      }
      const target = await store.findUserByUsername(un);
      if (!target) {
        json(res, 400, { error: 'User not found' });
        return true;
      }
      const own = ownerUsernameLower();
      if (own && target.usernameLower === own) {
        json(res, 400, { error: 'Cannot delete the owner account.' });
        return true;
      }
      if (typeof store.deleteUserPermanently !== 'function') {
        json(res, 501, { error: 'Not configured' });
        return true;
      }
      const ownerEmail = String(process.env.SKYHOP_OWNER_EMAIL || '').trim();
      if (!ownerEmail) {
        json(res, 400, {
          error: 'Set SKYHOP_OWNER_EMAIL on the server to receive deletion confirmation links.',
        });
        return true;
      }
      const { token } = createDeleteToken(sess.userId, target.id);
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
      const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const confirmUrl = `${proto}://${host}/api/owner/account-delete/confirm?token=${encodeURIComponent(token)}`;
      await sendOwnerMail({
        to: ownerEmail,
        subject: `Sky Hop — PERMANENT delete ${target.username}`,
        text:
          `You requested permanent deletion of Sky Hop account "${target.username}".\n\n` +
          `This removes all stats and user levels. There is no restore.\n\n` +
          `Open this link within 60 seconds, then click the red button on the page:\n${confirmUrl}\n\n` +
          `If this was not you, ignore this email.`,
        html:
          `<p>You requested <strong>permanent deletion</strong> of Sky Hop account <strong>${target.username}</strong>.</p>` +
          `<p>This removes all stats and user levels. There is no restore.</p>` +
          `<p><a href="${confirmUrl}">Open deletion confirmation page</a> — then click <strong>Yes — delete permanently</strong> (expires 60 seconds after you started in Sky Hop).</p>`,
      });
      json(res, 200, {
        ok: true,
        message: 'Confirmation email sent. Open the link within 60 seconds to complete deletion.',
      });
      return true;
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
      return true;
    }
  }

  const deleteConfirmHtml = (title, bodyHtml, status = 200) => {
    const esc = (s) =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...CORS });
    res.end(
      `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(title)}</title></head>` +
        `<body style="font-family:system-ui;background:#0f172a;color:#e2e8f0;padding:2rem;max-width:32rem;margin:0 auto">` +
        `<h1 style="color:#f87171">${esc(title)}</h1>${bodyHtml}</body></html>`
    );
  };

  if (pathname === '/api/owner/account-delete/confirm' && req.method === 'GET') {
    try {
      const token = u.searchParams.get('token');
      const peek = peekDeleteToken(token);
      if (!peek.ok) {
        deleteConfirmHtml(
          'Deletion failed',
          `<p>${String(peek.error).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`,
          400
        );
        return true;
      }
      const target = await store.findUserById(peek.targetUserId);
      const name = target ? target.username : 'user #' + String(peek.targetUserId);
      const escAttr = (s) =>
        String(s || '')
          .replace(/&/g, '&amp;')
          .replace(/"/g, '&quot;')
          .replace(/</g, '&lt;');
      deleteConfirmHtml(
        'Confirm permanent deletion',
        `<p>This permanently removes account <strong>${name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</strong>, all stats, and their levels. There is no restore.</p>` +
          `<p style="color:#94a3b8;font-size:0.9rem">Link expires 60 seconds after you started deletion in Sky Hop.</p>` +
          `<form method="POST" action="/api/owner/account-delete/finalize" style="margin-top:1.5rem">` +
          `<input type="hidden" name="token" value="${escAttr(token)}"/>` +
          `<button type="submit" style="background:#be123c;color:#fff;border:none;padding:0.75rem 1.25rem;border-radius:0.75rem;font-size:1rem;font-weight:600;cursor:pointer">Yes — delete permanently</button>` +
          `</form>`,
        200
      );
    } catch (e) {
      deleteConfirmHtml('Deletion failed', `<p>${String(e.message || e)}</p>`, 500);
    }
    return true;
  }

  if (pathname === '/api/owner/account-delete/finalize' && req.method === 'POST') {
    try {
      const raw = await readBody(req);
      let token = '';
      const ctype = String(req.headers['content-type'] || '');
      if (ctype.includes('application/x-www-form-urlencoded')) {
        token = new URLSearchParams(raw).get('token') || '';
      } else {
        try {
          const j = JSON.parse(raw || '{}');
          token = j.token || '';
        } catch {
          token = '';
        }
      }
      const consumed = consumeDeleteTokenPublic(token);
      if (!consumed.ok) {
        deleteConfirmHtml(
          'Deletion failed',
          `<p>${String(consumed.error).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`,
          400
        );
        return true;
      }
      const target = await store.findUserById(consumed.targetUserId);
      const name = target ? target.username : 'user';
      if (typeof store.deleteUserPermanently !== 'function') throw new Error('Not configured');
      await store.deleteUserPermanently(consumed.targetUserId);
      deleteConfirmHtml(
        'Account deleted',
        `<p>Permanently removed <strong>${name.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</strong> and their levels/stats.</p>`,
        200
      );
    } catch (e) {
      deleteConfirmHtml('Deletion failed', `<p>${String(e.message || e)}</p>`, 500);
    }
    return true;
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  {
    const m = /^\/api\/levels\/([^/]+)\/coin-state$/.exec(pathname);
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
    const m = /^\/api\/levels\/([^/]+)\/collect-coin$/.exec(pathname);
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
        const collector = await store.findUserById(uid);
        if (!collector || effectiveRole(collector) !== 'owner') {
          await store.incrementUserCoins(uid, 5);
        }
        const me = await buildMePayload(uid);
        json(res, 200, { ok: true, coins: me.coins, coinsInfinite: !!me.coinsInfinite });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if ((pathname === '/api/staff/visits' || pathname === '/api/staff/signups') && req.method === 'GET') {
    const staff = await requireStaffSession(req);
    if (!staff) {
      json(res, 403, { error: 'Moderator or owner access required.' });
      return true;
    }
    const period = String(u.searchParams.get('period') || 'week').toLowerCase();
    const ms =
      period === 'day'
        ? 24 * 60 * 60 * 1000
        : period === 'month'
          ? 30 * 24 * 60 * 60 * 1000
          : 7 * 24 * 60 * 60 * 1000;
    const sinceMs = Date.now() - ms;
    try {
      const { countVisitsSince } = await import('./visit-stats.js');
      const count = await countVisitsSince(sinceMs);
      const periodOut = period === 'day' || period === 'month' ? period : 'week';
      json(res, 200, { period: periodOut, sinceMs, visits: count, signups: count });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/staff/user-profile' && req.method === 'GET') {
    const staff = await requireStaffSession(req);
    if (!staff) {
      json(res, 403, { error: 'Moderator or owner access required.' });
      return true;
    }
    const un = String(u.searchParams.get('username') || '').trim();
    if (!un) {
      json(res, 400, { error: 'username required' });
      return true;
    }
    try {
      const target = await store.findUserByUsername(un);
      if (!target) {
        json(res, 404, { error: 'User not found' });
        return true;
      }
      const role = effectiveRole(target);
      const runs = await store.getRunsForUser(target.id);
      const agg = aggregateRuns(runs);
      const levels = await UserLevels.levelsStaffListForAuthor(target.id);
      const publishedCount = levels.filter((L) => L.published).length;
      json(res, 200, {
        username: target.username,
        role,
        disabled: isAccountDisabled(target),
        createdAt: target.createdAt != null ? target.createdAt : null,
        isSiteOwner: role === 'owner',
        canEditLevels: role !== 'owner',
        stats: {
          runCount: agg.runCount,
          totalDeaths: agg.totalDeaths,
          minDeaths: agg.minDeaths,
          maxDeaths: agg.maxDeaths,
          bestTimeMs: agg.bestTimeMs,
          avgTimeMs: agg.avgTimeMs,
          avgDeaths: agg.avgDeaths,
        },
        coins: target.coins != null ? Number(target.coins) : 0,
        levelCount: levels.length,
        publishedLevelCount: publishedCount,
      });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/staff/user-levels' && req.method === 'GET') {
    const staff = await requireStaffSession(req);
    if (!staff) {
      json(res, 403, { error: 'Moderator or owner access required.' });
      return true;
    }
    const un = String(u.searchParams.get('username') || '').trim();
    if (!un) {
      json(res, 400, { error: 'username required' });
      return true;
    }
    try {
      const target = await store.findUserByUsername(un);
      if (!target) {
        json(res, 404, { error: 'User not found' });
        return true;
      }
      const role = effectiveRole(target);
      const levels = await UserLevels.levelsStaffListForAuthor(target.id);
      json(res, 200, {
        username: target.username,
        isSiteOwner: role === 'owner',
        canEditLevels: role !== 'owner',
        levels,
      });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/staff\/levels\/([^/]+)$/.exec(pathname);
    if (m && req.method === 'GET') {
      const staff = await requireStaffSession(req);
      if (!staff) {
        json(res, 403, { error: 'Moderator or owner access required.' });
        return true;
      }
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      try {
        const row = await UserLevels.levelsStaffGetById(m[1]);
        if (!row) {
          json(res, 404, { error: 'Not found' });
          return true;
        }
        const author = await store.findUserById(row.authorId);
        const authorRole = effectiveRole(author);
        json(res, 200, Object.assign({}, row, {
          authorUsername: author?.username || null,
          isSiteOwnerLevel: authorRole === 'owner',
          canEdit: authorRole !== 'owner',
        }));
      } catch (e) {
        json(res, 500, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/staff/levels/save' && req.method === 'POST') {
    const staff = await requireStaffSession(req);
    if (!staff) {
      json(res, 403, { error: 'Moderator or owner access required.' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const levelId = String(body.levelId || body.id || '').trim();
    if (!uuidRe.test(levelId)) {
      json(res, 400, { error: 'Invalid level id' });
      return true;
    }
    try {
      const titleCensored = censorProfanity(String(body.title || '')).text;
      const out = await UserLevels.levelsStaffUpdate(levelId, titleCensored, body.data);
      json(res, 200, out);
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/staff/levels/delete' && req.method === 'POST') {
    const staff = await requireStaffSession(req);
    if (!staff) {
      json(res, 403, { error: 'Moderator or owner access required.' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const levelId = String(body.levelId || body.id || '').trim();
    if (!uuidRe.test(levelId)) {
      json(res, 400, { error: 'Invalid level id' });
      return true;
    }
    try {
      await UserLevels.levelsStaffDelete(levelId);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/levels/mine' && req.method === 'GET') {
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

  if (pathname === '/api/levels/save' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    const author = await store.findUserById(uid);
    try {
      assertAccountActive(author);
    } catch (e) {
      json(res, 403, { error: String(e.message || e) });
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
      const titleCensored = censorProfanity(String(body.title || '')).text;
      if (body.id && uuidRe.test(String(body.id))) {
        await UserLevels.levelsUpdateDraft(uid, String(body.id), titleCensored, body.data);
        json(res, 200, { id: String(body.id), title: titleCensored.trim().slice(0, 80) });
      } else {
        const out = await UserLevels.levelsCreate(uid, titleCensored, body.data);
        json(res, 201, Object.assign({}, out, { title: titleCensored.trim().slice(0, 80) }));
      }
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/levels\/([^/]+)\/beat$/.exec(pathname);
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
    const m = /^\/api\/levels\/([^/]+)\/publish$/.exec(pathname);
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
        const author = await store.findUserById(uid);
        assertAccountActive(author);
        await UserLevels.levelsPublish(uid, m[1]);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  {
    const m = /^\/api\/levels\/([^/]+)\/play$/.exec(pathname);
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

  if (pathname === '/api/levels/search' && req.method === 'GET') {
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

  if (pathname === '/api/levels/lookup' && req.method === 'GET') {
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
    const m = /^\/api\/levels\/([^/]+)$/.exec(pathname);
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

  if (pathname.startsWith('/api/levels/user/') && req.method === 'GET') {
    const rest = pathname.slice('/api/levels/user/'.length);
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
