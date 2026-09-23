import { ACHIEVEMENT_COIN_REWARD, ACHIEVEMENT_DEFS, aggregateRuns, computeNewUnlocks } from './achievements.js';
import {
  appendCampaignCheckpoint,
  finalizeCampaignRunSession,
  startCampaignRunSession,
} from './campaign-run-sessions.js';
import { banStatusForUser, assertAccountActive, canAccessReportInbox, effectiveRole, isAccountDisabled, isStaffRole, ownerUsernameLower, parseBanDuration, promotionNoticePayload, seesModReportQueue } from './moderation.js';
import { censorProfanity } from './profanity-filter.js';
import {
  createDeleteToken,
  consumeDeleteToken,
  consumeDeleteTokenPublic,
  peekDeleteToken,
} from './owner-delete.js';
import { sendOwnerMail } from './mail.js';
import * as ShopItems from './shop-items.js';
import * as CustomWorlds from './custom-worlds.js';
import { store } from './store.js';
import * as UserLevels from './user-levels.js';
import * as Recordings from './recordings.js';
import * as InputLogs from './input-logs.js';
import * as SubmittedRuns from './submitted-runs.js';
import * as UserMods from './user-mods.js';
import { consumeRaceFinishReceipt, listLiveSessions, listPublicSessions, minUntokenedRaceMs } from './live-sessions.js';
import {
  joinTosPagesForEditor,
  resolveBranding,
  resolveFeatureListHtml,
  resolveTosPages,
  splitTosPagesFromEditor,
  validateBranding,
  validateFeatureListHtml,
  validateTosPages,
  TOS_PAGE_SEP,
} from './site-content.js';
import {
  validateAppealReason,
  enrichAppeals,
  tryResolveAppeal,
  resolveBanAppealDirect,
  banStatusForUser as appealBanStatus,
} from './ban-appeals.js';
import { extFromContentType, publicAvatarUrl, sniffImageExt, MAX_AVATAR_BYTES } from './profile-storage.js';
import {
  adminBanQuota,
  adminBanUntilMs,
  assertAdminCanPunish,
  clipReason,
  enrichStaffRequests,
  validateStaffRequestInput,
} from './staff-admin.js';
import { applyOwnerStrikeDelta, lookupStrikes } from './strikes.js';
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
  const shopItem = await ShopItems.findShopItemByTexture(base);
  if (!allowed.has(base) && !shopItem) return false;
  if (effectiveRole(user) === 'owner') return true;
  if (typeof store.userHasTextureGrant !== 'function') return false;
  return store.userHasTextureGrant(uid, base);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Shop-Label, X-Shop-Price, X-Shop-Sell-Price, X-Recording-Title, X-Recording-Source, X-Anticheat-On, X-Input-Log-Title, X-Input-Log-Source',
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

function readBinaryBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let len = 0;
    req.on('data', (c) => {
      len += c.length;
      if (len > maxBytes) {
        req.destroy();
        reject(new Error('too large'));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function requireStaffSession(req) {
  const sess = await getActiveSessionUser(req);
  if (!sess) return null;
  const role = effectiveRole(sess.user);
  if (!isStaffRole(role)) return null;
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

/** @returns {Promise<{ friendUserIds: Set<number> } | { error: string, status: number }>} */
async function resolveLeaderboardFriends(req, scope) {
  const sc = String(scope || 'global').toLowerCase();
  if (sc !== 'friends') return { friendUserIds: null };
  const uid = await bearerUserId(req);
  if (!uid) {
    return { error: 'Sign in to view the friends leaderboard.', status: 401 };
  }
  if (typeof store.listFriendsBundle !== 'function') {
    return { error: 'Friends leaderboard unavailable.', status: 501 };
  }
  const bundle = await store.listFriendsBundle(uid);
  const friendUserIds = new Set([uid]);
  for (const f of bundle.friends || []) {
    if (f.userId != null) friendUserIds.add(Number(f.userId));
  }
  return { friendUserIds };
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
  const world2Unlocked =
    !!(user.campaignWorld1ClearedAt && user.campaignWorld1ClearedAt > 0) || uaMap.has('first_clear');
  const role = effectiveRole(user);
  let modInboxCount = 0;
  let ownerInboxCount = 0;
  if (typeof store.countReportsByStatus === 'function') {
    try {
      if (seesModReportQueue(role)) modInboxCount = await store.countReportsByStatus('pending');
      if (role === 'owner') ownerInboxCount = await store.countReportsByStatus('escalated');
    } catch {
      /* */
    }
  }
  if (typeof store.countOpenBanAppeals === 'function') {
    try {
      const ac = await store.countOpenBanAppeals();
      if (role === 'moderator' || role === 'admin') modInboxCount += ac;
      if (role === 'owner') ownerInboxCount += ac;
    } catch {
      /* */
    }
  }
  let staffRequestCount = 0;
  if (role === 'owner' && typeof store.countOpenStaffRequests === 'function') {
    try {
      staffRequestCount = await store.countOpenStaffRequests();
    } catch {
      staffRequestCount = 0;
    }
  }
  let adminBanQuotaInfo = null;
  if (role === 'admin') {
    try {
      adminBanQuotaInfo = await adminBanQuota(store, userId);
    } catch {
      adminBanQuotaInfo = { used: 0, max: 2, remaining: 2 };
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
    staffRequestCount,
    adminBanQuota: adminBanQuotaInfo,
    stats: {
      runCount: agg.runCount,
      totalDeaths: agg.totalDeaths,
      minDeaths: agg.minDeaths,
      maxDeaths: agg.maxDeaths,
      bestTimeMs: agg.bestTimeMs,
      avgTimeMs: agg.avgTimeMs,
      avgDeaths: agg.avgDeaths,
    },
    world2Unlocked,
    achievements,
    promotionNotice: promotionNoticePayload(user),
    modsWarningNeeded: !user.modsWarningSeen && !user.mods_warning_seen,
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
    appealDeclineReason: bs.appealDeclineReason || null,
  };
}

/** @returns {Promise<boolean>} true if handled */
export async function handleApi(req, res) {
  const u = new URL(req.url || '/', 'http://localhost');
  const pathname = u.pathname;
  if (!pathname.startsWith('/api')) return false;

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

  if (pathname === '/api/ban-appeal/submit' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    if (typeof store.createBanAppeal !== 'function') {
      json(res, 501, { error: 'Appeals not configured.' });
      return true;
    }
    try {
      const user = await store.verifyUser(body.username, body.password);
      if (!user) {
        json(res, 401, { error: 'Invalid username or password.' });
        return true;
      }
      if (typeof store.clearExpiredBanIfAny === 'function') await store.clearExpiredBanIfAny(user.id);
      const fresh = await store.findUserById(user.id);
      const bs = appealBanStatus(fresh);
      if (!bs.banned) {
        json(res, 400, { error: 'This account is not suspended.' });
        return true;
      }
      const reason = validateAppealReason(body.reason);
      const row = await store.createBanAppeal(user.id, reason);
      json(res, 200, { ok: true, appealId: row.id });
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
      const payload = loginBanJson(bs);
      if (!payload.appealDeclineReason && typeof store.getLatestAppealDeclineReason === 'function') {
        try {
          payload.appealDeclineReason = await store.getLatestAppealDeclineReason(user.id);
        } catch {
          /* column may be missing until extend_v19 */
        }
      }
      json(res, 403, payload);
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

  if (pathname === '/api/me/ack-promotion' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      if (typeof store.clearPromotionNotice === 'function') {
        await store.clearPromotionNotice(uid);
      }
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/me/ack-mods-warning' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      if (typeof store.markModsWarningSeen === 'function') {
        await store.markModsWarningSeen(uid);
      }
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/me/campaign-world1-cleared' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      if (typeof store.setCampaignWorld1ClearedAt === 'function') {
        await store.setCampaignWorld1ClearedAt(uid, Date.now());
      }
      const me = await buildMePayload(uid, req);
      json(res, 200, { ok: true, world2Unlocked: !!(me && me.world2Unlocked) });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
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
        const shopItem = await ShopItems.findShopItemByTexture(fname);
        if (!allowed.has(fname) && !shopItem) {
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

      if (source === 'race') {
        const token = body.raceFinishToken != null ? String(body.raceFinishToken).trim() : '';
        if (token) {
          const rec = consumeRaceFinishReceipt(token, timeMs);
          if (!rec.ok) {
            json(res, 400, { error: 'Race finish could not be verified.' });
            return true;
          }
        } else if (timeMs < minUntokenedRaceMs()) {
          json(res, 400, { error: 'Race time was rejected by anti-cheat.' });
          return true;
        }
      }

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
    const scope = String(u.searchParams.get('scope') || 'global').toLowerCase();
    try {
      const fr = await resolveLeaderboardFriends(req, scope);
      if (fr.error) {
        json(res, fr.status || 400, { error: fr.error });
        return true;
      }
      const rows = await store.listCampaignLeaderboard(diff, 10, fr.friendUserIds);
      json(res, 200, { difficulty: diff, scope: scope === 'friends' ? 'friends' : 'global', entries: rows });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/site/tos' && req.method === 'GET') {
    try {
      const pages = await resolveTosPages(store);
      json(res, 200, { pages });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/site/feature-list' && req.method === 'GET') {
    try {
      const html = await resolveFeatureListHtml(store);
      json(res, 200, { html });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/site/branding' && req.method === 'GET') {
    try {
      json(res, 200, await resolveBranding(store));
    } catch (e) {
      json(res, 200, {
        title: 'Sky Hop',
        version: '3.19',
        updateName: 'The Editor Update',
      });
    }
    return true;
  }

  if (pathname === '/api/owner/appeals' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only.' });
      return true;
    }
    if (typeof store.listOpenBanAppeals !== 'function') {
      json(res, 501, { error: 'Appeals not configured.' });
      return true;
    }
    try {
      const appeals = await enrichAppeals(store, await store.listOpenBanAppeals());
      json(res, 200, { appeals });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/owner\/appeals\/([^/]+)\/resolve$/.exec(pathname);
    if (m && req.method === 'POST') {
      const appealId = m[1];
      const sess = await getActiveSessionUser(req);
      if (!sess || effectiveRole(sess.user) !== 'owner') {
        json(res, 403, { error: 'Owner only.' });
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
        const resolved = await resolveBanAppealDirect(
          store,
          appealId,
          body.decision,
          body.declineReason != null ? body.declineReason : body.reason
        );
        json(res, 200, { ok: true, resolved });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/owner/site-content' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only.' });
      return true;
    }
    try {
      const pages = await resolveTosPages(store);
      const html = await resolveFeatureListHtml(store);
      const branding = await resolveBranding(store);
      const customTos =
        typeof store.getSiteContentPayload === 'function' &&
        !!(await store.getSiteContentPayload('tos'))?.pages?.length;
      const customFeat =
        typeof store.getSiteContentPayload === 'function' &&
        !!(await store.getSiteContentPayload('feature_list'))?.html;
      const customBranding =
        typeof store.getSiteContentPayload === 'function' &&
        !!(await store.getSiteContentPayload('branding'))?.title;
      json(res, 200, {
        tosPages: pages,
        tosEditorText: joinTosPagesForEditor(pages),
        featureListHtml: html,
        branding,
        pageSeparator: TOS_PAGE_SEP,
        customTos: !!customTos,
        customFeatureList: !!customFeat,
        customBranding: !!customBranding,
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/site-content' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only.' });
      return true;
    }
    if (typeof store.setSiteContentPayload !== 'function') {
      json(res, 501, { error: 'Site content not configured on this server.' });
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
      if (body.tosEditorText != null || body.tosPages != null) {
        const pages =
          body.tosPages != null && Array.isArray(body.tosPages)
            ? body.tosPages.map((p) => String(p))
            : splitTosPagesFromEditor(body.tosEditorText);
        validateTosPages(pages);
        await store.setSiteContentPayload('tos', { pages });
      }
      if (body.featureListHtml != null) {
        const html = String(body.featureListHtml);
        validateFeatureListHtml(html);
        await store.setSiteContentPayload('feature_list', { html });
      }
      let brandingSaved = null;
      const brandingInput =
        body.branding != null && typeof body.branding === 'object' && !Array.isArray(body.branding)
          ? body.branding
          : body.title != null || body.version != null || body.updateName != null
            ? {
                title: body.title,
                version: body.version,
                updateName: body.updateName,
              }
            : null;
      if (brandingInput) {
        const current = await resolveBranding(store);
        const next = validateBranding({
          title: brandingInput.title != null ? brandingInput.title : current.title,
          version: brandingInput.version != null ? brandingInput.version : current.version,
          updateName: brandingInput.updateName != null ? brandingInput.updateName : current.updateName,
        });
        next.title = censorProfanity(next.title).text;
        next.version = censorProfanity(next.version).text;
        next.updateName = next.updateName ? censorProfanity(next.updateName).text : '';
        brandingSaved = validateBranding(next);
        await store.setSiteContentPayload('branding', brandingSaved);
      }
      json(res, 200, brandingSaved ? { ok: true, branding: brandingSaved } : { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/leaderboard/metric' && req.method === 'GET') {
    const metric = String(u.searchParams.get('metric') || 'coins').toLowerCase();
    const scope = String(u.searchParams.get('scope') || 'global').toLowerCase();
    const diff = String(u.searchParams.get('difficulty') || 'normal').toLowerCase();
    if (metric !== 'coins' && metric !== 'runs' && metric !== 'deaths') {
      json(res, 400, { error: 'metric must be coins, runs, or deaths' });
      return true;
    }
    if ((metric === 'deaths' || metric === 'runs') && diff !== 'easy' && diff !== 'normal' && diff !== 'hard') {
      json(res, 400, { error: 'difficulty must be easy, normal, or hard' });
      return true;
    }
    try {
      const fr = await resolveLeaderboardFriends(req, scope);
      if (fr.error) {
        json(res, fr.status || 400, { error: fr.error });
        return true;
      }
      let entries = [];
      if (metric === 'coins') {
        if (typeof store.listLeaderboardCoins !== 'function') {
          json(res, 501, { error: 'Leaderboard not configured on this server.' });
          return true;
        }
        entries = await store.listLeaderboardCoins(10, fr.friendUserIds);
      } else if (metric === 'runs') {
        if (typeof store.listLeaderboardRunCount !== 'function') {
          json(res, 501, { error: 'Leaderboard not configured on this server.' });
          return true;
        }
        entries = await store.listLeaderboardRunCount(10, fr.friendUserIds, diff);
      } else {
        if (typeof store.listLeaderboardFewestDeaths !== 'function') {
          json(res, 501, { error: 'Leaderboard not configured on this server.' });
          return true;
        }
        entries = await store.listLeaderboardFewestDeaths(diff, 10, fr.friendUserIds);
      }
      json(res, 200, {
        metric,
        scope: scope === 'friends' ? 'friends' : 'global',
        difficulty: metric === 'deaths' || metric === 'runs' ? diff : null,
        entries,
      });
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
        const extra = await ShopItems.listShopTextureFilenames();
        for (const t of extra) set.add(t);
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
      const out = await ShopItems.listShopItems(disk);
      json(res, 200, out);
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/shop\/skins\/([^/]+)$/.exec(pathname);
    if (m && req.method === 'GET') {
      try {
        const fn = decodeURIComponent(m[1]);
        const hit = await ShopItems.readShopSkinByTexture(fn);
        if (!hit) {
          json(res, 404, { error: 'Not found' });
          return true;
        }
        res.writeHead(200, {
          'Content-Type': hit.mimeType || 'image/png',
          'Content-Length': hit.buffer.length,
          'Cache-Control': 'public, max-age=86400',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(hit.buffer);
      } catch (e) {
        json(res, 404, { error: String(e.message || e) });
      }
      return true;
    }
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
    const item = await ShopItems.getShopItemById(String(body.itemId || ''));
    if (!item) {
      json(res, 400, { error: 'Unknown shop item.' });
      return true;
    }
    try {
      const disk = await listTextureFilenames();
      if (item.source !== 'owner' && !disk.has(item.texture)) {
        json(res, 400, { error: 'That item is not available on this server.' });
        return true;
      }
      if (item.hidden) {
        json(res, 400, { error: 'That item is not in the shop.' });
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
    const item = await ShopItems.getShopItemById(String(body.itemId || ''));
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

  if (pathname === '/api/owner/shop/items' && req.method === 'GET') {
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
      const disk = await listTextureFilenames();
      json(res, 200, await ShopItems.listShopItemsForOwner(disk));
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/shop/items/update' && req.method === 'POST') {
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
    try {
      const label = censorProfanity(String(body.label || '')).text.slice(0, 80);
      const item = await ShopItems.updateShopListing(body.id, {
        label,
        price: body.price,
        sellPrice: body.sellPrice,
      });
      json(res, 200, { ok: true, item });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (
    (pathname === '/api/owner/shop/items/hide' || pathname === '/api/owner/shop/items/restore') &&
    req.method === 'POST'
  ) {
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
    try {
      const item = await ShopItems.setShopItemListed(body.id, pathname.endsWith('/restore'));
      json(res, 200, { ok: true, item });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/shop/items' && req.method === 'POST') {
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
      const buf = await readBinaryBody(req, ShopItems.MAX_SHOP_IMAGE_BYTES + 65536);
      const contentType = String(req.headers['content-type'] || '');
      let label = String(req.headers['x-shop-label'] || 'Shop item');
      try {
        label = decodeURIComponent(label);
      } catch {
        /* keep */
      }
      label = censorProfanity(label).text.slice(0, 80) || 'Shop item';
      const price = Number(req.headers['x-shop-price']);
      const sellPrice = Number(req.headers['x-shop-sell-price']);
      const item = await ShopItems.createOwnerShopItem({
        label,
        price,
        sellPrice,
        buffer: buf,
        contentType,
      });
      json(res, 201, { ok: true, item });
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
      json(res, 200, { stages: null, warning: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/worlds' && req.method === 'GET') {
    try {
      const sess = await getActiveSessionUser(req);
      let world1Cleared = false;
      let isOwner = false;
      let userId = null;
      if (sess && sess.user) {
        userId = sess.userId;
        isOwner = effectiveRole(sess.user) === 'owner';
        const ach = typeof store.getAchievementsForUser === 'function' ? await store.getAchievementsForUser(sess.userId) : [];
        const achIds = new Set((ach || []).map((a) => a.achievementId));
        world1Cleared =
          !!(sess.user.campaignWorld1ClearedAt && sess.user.campaignWorld1ClearedAt > 0) || achIds.has('first_clear');
      }
      json(res, 200, await CustomWorlds.listWorldCatalog({ userId, isOwner, world1Cleared }));
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/worlds\/(\d+)\/stages$/.exec(pathname);
    if (m && req.method === 'GET') {
      try {
        const id = Number(m[1]);
        const sess = await getActiveSessionUser(req);
        let world1Cleared = false;
        let isOwner = false;
        let userId = null;
        if (sess && sess.user) {
          userId = sess.userId;
          isOwner = effectiveRole(sess.user) === 'owner';
          const ach = typeof store.getAchievementsForUser === 'function' ? await store.getAchievementsForUser(sess.userId) : [];
          const achIds = new Set((ach || []).map((a) => a.achievementId));
          world1Cleared =
            !!(sess.user.campaignWorld1ClearedAt && sess.user.campaignWorld1ClearedAt > 0) || achIds.has('first_clear');
        }
        const allowed = await CustomWorlds.customWorldUnlocked(id, { userId, isOwner, world1Cleared });
        if (!allowed) {
          json(res, 403, { error: 'That world is locked.' });
          return true;
        }
        const hit = await CustomWorlds.getCustomWorldStages(id);
        if (!hit) {
          json(res, 404, { error: 'Unknown world.' });
          return true;
        }
        json(res, 200, hit);
      } catch (e) {
        json(res, 500, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/owner/worlds' && req.method === 'POST') {
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
    try {
      const name = censorProfanity(String(body.name || '')).text.slice(0, 40);
      const world = await CustomWorlds.createCustomWorld({ name, requires: body.requires });
      json(res, 201, { ok: true, world });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/owner\/worlds\/(\d+)\/stages$/.exec(pathname);
    if (m && req.method === 'POST') {
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
      const stages = body.stages;
      if (!Array.isArray(stages) || stages.length < 1) {
        json(res, 400, { error: 'stages array required' });
        return true;
      }
      if (JSON.stringify(stages).length > 4_000_000) {
        json(res, 400, { error: 'Campaign data too large' });
        return true;
      }
      try {
        const out = await CustomWorlds.setCustomWorldStages(m[1], stages);
        json(res, 200, { ok: true, count: out.count });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  {
    const m = /^\/api\/worlds\/(\d+)\/clear$/.exec(pathname);
    if (m && req.method === 'POST') {
      const sess = await getActiveSessionUser(req);
      if (!sess) {
        json(res, 401, { error: 'Not logged in' });
        return true;
      }
      try {
        await CustomWorlds.markWorldCleared(sess.userId, m[1]);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/builtin-stages-world2' && req.method === 'GET') {
    try {
      if (typeof store.getBuiltinWorld2Stages !== 'function') {
        json(res, 200, { stages: null });
        return true;
      }
      const stages = await store.getBuiltinWorld2Stages();
      json(res, 200, { stages: stages && stages.length ? stages : null });
    } catch (e) {
      json(res, 200, { stages: null, warning: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/builtin-stages/reset' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only.' });
      return true;
    }
    try {
      if (typeof store.setBuiltinCampaignStages === 'function') await store.setBuiltinCampaignStages([]);
      if (typeof store.setBuiltinWorld2Stages === 'function') await store.setBuiltinWorld2Stages([]);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
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

  {
    const m = /^\/api\/mod\/appeals\/([^/]+)\/vote$/.exec(pathname);
    if (m && req.method === 'POST') {
      const appealId = m[1];
      const sess = await getActiveSessionUser(req);
      if (!sess) {
        json(res, 401, { error: 'Not logged in' });
        return true;
      }
      const role = effectiveRole(sess.user);
      if (!isStaffRole(role)) {
        json(res, 403, { error: 'Not allowed' });
        return true;
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        json(res, 400, { error: 'Invalid JSON' });
        return true;
      }
      const voteRaw = String(body.vote || '').toLowerCase();
      const vote = voteRaw === 'unban' || voteRaw === 'lift' ? 'unban' : 'keep_ban';
      if (typeof store.upsertBanAppealVote !== 'function') {
        json(res, 501, { error: 'Not available' });
        return true;
      }
      try {
        const appeal = await store.getBanAppealById(appealId);
        if (!appeal || appeal.status !== 'open') {
          json(res, 400, { error: 'Appeal not open.' });
          return true;
        }
        if (appeal.userId === sess.userId) {
          json(res, 400, { error: 'You cannot vote on your own appeal.' });
          return true;
        }
        await store.upsertBanAppealVote(appealId, sess.userId, vote);
        const resolved = await tryResolveAppeal(store, appealId);
        json(res, 200, { ok: true, resolved: resolved || null });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/mod/reports' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    const role = effectiveRole(sess.user);
    if (!canAccessReportInbox(role)) {
      json(res, 403, { error: 'Not allowed' });
      return true;
    }
    if (typeof store.listReportsByStatus !== 'function') {
      json(res, 501, { error: 'Reports not configured.' });
      return true;
    }
    try {
      let reports = [];
      let scope = 'pending';
      if (seesModReportQueue(role)) {
        scope = 'pending';
        reports = await enrichReports(await store.listReportsByStatus('pending'));
      } else {
        scope = 'escalated';
        reports = await enrichReports(await store.listReportsByStatus('escalated'));
      }
      let appeals = [];
      if (isStaffRole(role) && typeof store.listOpenBanAppeals === 'function') {
        appeals = await enrichAppeals(store, await store.listOpenBanAppeals());
      }
      json(res, 200, { scope, reports, appeals });
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
      if (!seesModReportQueue(effectiveRole(sess.user))) {
        json(res, 403, { error: 'Only Report Advisors, moderators, and the Admin can dismiss from the main queue.' });
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
      if (!seesModReportQueue(effectiveRole(sess.user))) {
        json(res, 403, { error: 'Only Report Advisors, moderators, and the Admin can escalate.' });
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
      const shopItem = await ShopItems.findShopItemByTexture(fname);
      if (!disk.has(fname) && !shopItem) {
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
    const actorRole = effectiveRole(sess.user);
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      json(res, 403, { error: 'Owner or Admin only' });
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
    if (actorRole === 'admin' && !promote) {
      json(res, 403, { error: 'Admins cannot demote moderators. Send a demotion request to the owner.' });
      return true;
    }
    try {
      const u = await store.findUserByUsername(un);
      if (!u) {
        json(res, 400, { error: 'User not found' });
        return true;
      }
      const targetRole = effectiveRole(u);
      if (targetRole === 'owner') {
        json(res, 400, { error: 'Cannot change the owner account.' });
        return true;
      }
      if (targetRole === 'admin') {
        json(res, 400, { error: 'Cannot change the Admin here. The owner assigns Admin separately.' });
        return true;
      }
      if (targetRole === 'report_advisor' && !promote) {
        json(res, 400, { error: 'That account is a Report Advisor. Remove that role separately.' });
        return true;
      }
      await store.setModeratorRole(u.id, promote);
      json(res, 200, { ok: true, username: u.username, moderator: promote });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/admin' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only' });
      return true;
    }
    try {
      const admins = typeof store.listAdmins === 'function' ? await store.listAdmins() : [];
      json(res, 200, { admin: admins[0] || null, admins });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/set-admin' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
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
      if (effectiveRole(u) === 'owner') {
        json(res, 400, { error: 'Cannot change the owner account.' });
        return true;
      }
      let previous = null;
      if (promote && typeof store.listAdmins === 'function') {
        const cur = await store.listAdmins();
        previous = cur.find((a) => a.id !== u.id) || null;
      }
      await store.setAdminRole(u.id, promote);
      json(res, 200, {
        ok: true,
        username: u.username,
        admin: promote,
        previousAdmin: previous ? previous.username : null,
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/report-advisors' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only' });
      return true;
    }
    try {
      const advisors =
        typeof store.listReportAdvisors === 'function' ? await store.listReportAdvisors() : [];
      json(res, 200, { advisors });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/set-report-advisor' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
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
      const targetRole = effectiveRole(u);
      if (targetRole === 'owner') {
        json(res, 400, { error: 'Cannot change the owner account.' });
        return true;
      }
      if (typeof store.setReportAdvisorRole !== 'function') {
        json(res, 501, { error: 'Not configured' });
        return true;
      }
      await store.setReportAdvisorRole(u.id, promote);
      json(res, 200, { ok: true, username: u.username, reportAdvisor: promote });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/strikes' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    const actorRole = effectiveRole(sess.user);
    if (actorRole !== 'owner' && actorRole !== 'admin') {
      json(res, 403, { error: 'Not allowed' });
      return true;
    }
    try {
      const data = await lookupStrikes(store, actorRole, u.searchParams.get('username'));
      json(res, 200, data);
    } catch (e) {
      const msg = String(e.message || e);
      const status = msg === 'Not allowed' || msg.startsWith('Admins can only') ? 403 : 400;
      json(res, status, { error: msg });
    }
    return true;
  }

  if (pathname === '/api/owner/strikes' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
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
    const action = String(body.action || '').toLowerCase();
    const delta = action === 'add' ? 1 : action === 'remove' ? -1 : 0;
    if (!delta) {
      json(res, 400, { error: 'action must be add or remove' });
      return true;
    }
    try {
      const data = await applyOwnerStrikeDelta(store, body.username, delta);
      json(res, 200, { ok: true, ...data });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/staff-requests' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only' });
      return true;
    }
    try {
      const rows = typeof store.listOpenStaffRequests === 'function' ? await store.listOpenStaffRequests() : [];
      json(res, 200, { requests: await enrichStaffRequests(store, rows) });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/owner\/staff-requests\/([^/]+)\/resolve$/.exec(pathname);
    if (m && req.method === 'POST') {
      const sess = await getActiveSessionUser(req);
      if (!sess || effectiveRole(sess.user) !== 'owner') {
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
      const decision = String(body.decision || '').toLowerCase();
      if (decision !== 'accept' && decision !== 'decline') {
        json(res, 400, { error: 'decision must be accept or decline' });
        return true;
      }
      try {
        const reqRow = await store.getStaffRequestById(m[1]);
        if (!reqRow || reqRow.status !== 'open') {
          json(res, 400, { error: 'Request is not open.' });
          return true;
        }
        const note = body.note != null ? String(body.note).slice(0, 500) : null;
        if (decision === 'accept') {
          const target = await store.findUserById(reqRow.targetUserId);
          if (!target) throw new Error('Target user not found.');
          if (reqRow.type === 'demote_moderator') {
            if (effectiveRole(target) !== 'moderator') {
              throw new Error('That user is not a moderator anymore.');
            }
            await store.setModeratorRole(target.id, false);
          } else if (reqRow.type === 'longer_ban') {
            assertAdminCanPunish(target);
            const until = parseBanDuration(reqRow.payload || {}) ?? reqRow.payload?.banUntilMsResolved;
            if (until == null) throw new Error('This request has an invalid ban duration.');
            const reason = String((reqRow.payload && reqRow.payload.reason) || 'Owner accepted Admin ban request').slice(0, 500);
            await store.applyBan(target.id, until, reason);
          } else {
            throw new Error('Unknown request type.');
          }
          await store.resolveStaffRequest(reqRow.id, 'accepted', note);
        } else {
          await store.resolveStaffRequest(reqRow.id, 'declined', note);
        }
        json(res, 200, { ok: true, decision });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/admin/ban' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (effectiveRole(sess.user) !== 'admin') {
      json(res, 403, { error: 'Admin only' });
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
      const quota = await adminBanQuota(store, sess.userId);
      if (quota.remaining < 1) {
        json(res, 400, { error: 'You already used 2 one-day bans in the last 7 days.' });
        return true;
      }
      const un = String(body.username || '').trim();
      if (!un) throw new Error('username required');
      const target = await store.findUserByUsername(un);
      if (!target) throw new Error('User not found');
      if (target.id === sess.userId) throw new Error('You cannot ban yourself.');
      assertAdminCanPunish(target);
      const already = banStatusForUser(target);
      if (already.banned) throw new Error('That user is already banned.');
      const reason = clipReason(body.reason);
      await store.applyBan(target.id, adminBanUntilMs(), reason);
      await store.insertAdminBanLog(sess.userId, target.id);
      json(res, 200, { ok: true, duration: '1d', quota: await adminBanQuota(store, sess.userId) });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/admin/requests' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (effectiveRole(sess.user) !== 'admin') {
      json(res, 403, { error: 'Admin only' });
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
      const parsed = validateStaffRequestInput(body);
      const target = await store.findUserByUsername(parsed.username);
      if (!target) throw new Error('User not found');
      if (target.id === sess.userId) throw new Error('You cannot file a request about yourself.');
      if (parsed.type === 'demote_moderator') {
        if (effectiveRole(target) !== 'moderator') throw new Error('That user is not a moderator.');
      } else {
        assertAdminCanPunish(target);
      }
      const row = await store.createStaffRequest(parsed.type, sess.userId, target.id, parsed.payload);
      json(res, 201, { ok: true, id: row.id });
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

  if (pathname === '/api/public-sessions' && req.method === 'GET') {
    try {
      json(res, 200, { sessions: listPublicSessions() });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/staff/live-sessions' && req.method === 'GET') {
    const staff = await requireStaffSession(req);
    if (!staff) {
      json(res, 403, { error: 'Moderator or owner access required.' });
      return true;
    }
    try {
      json(res, 200, { sessions: listLiveSessions() });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
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

  if (pathname === '/api/recordings/upload' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      assertAccountActive(await store.findUserById(uid));
    } catch (e) {
      json(res, 403, { error: String(e.message || e) });
      return true;
    }
    try {
      const buf = await readBinaryBody(req, Recordings.MAX_RECORDING_BYTES + 65536);
      const contentType = String(req.headers['content-type'] || 'video/webm');
      const titleRaw = String(req.headers['x-recording-title'] || 'Run');
      const sourceRaw = String(req.headers['x-recording-source'] || 'campaign');
      let title = titleRaw;
      let source = sourceRaw;
      try {
        title = decodeURIComponent(titleRaw);
      } catch {
        title = titleRaw;
      }
      try {
        source = decodeURIComponent(sourceRaw);
      } catch {
        source = sourceRaw;
      }
      title = title.slice(0, 120);
      source = source.slice(0, 40);
      title = censorProfanity(title).text.slice(0, 120) || 'Run';
      const anticheatOn = Recordings.parseAnticheatOn(req.headers['x-anticheat-on']);
      const saved = await Recordings.recordingsCreate(uid, buf, contentType, { title, source, anticheatOn });
      json(res, 201, { ok: true, recording: saved });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/recordings/mine' && req.method === 'GET') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      const list = await Recordings.recordingsListForUser(uid);
      json(res, 200, { recordings: list });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/recordings/delete' && req.method === 'POST') {
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
    const id = String(body.id || '').trim();
    if (!uuidRe.test(id)) {
      json(res, 400, { error: 'Invalid id' });
      return true;
    }
    try {
      await Recordings.recordingsDelete(uid, id);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/recordings/rename' && req.method === 'POST') {
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
    const id = String(body.id || '').trim();
    if (!uuidRe.test(id)) {
      json(res, 400, { error: 'Invalid id' });
      return true;
    }
    const title = censorProfanity(String(body.title || '').trim()).text.slice(0, 120);
    if (!title) {
      json(res, 400, { error: 'Name required' });
      return true;
    }
    try {
      const saved = await Recordings.recordingsRename(uid, id, title);
      json(res, 200, { ok: true, recording: saved });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/recordings\/([^/]+)\/video$/.exec(pathname);
    if (m && req.method === 'GET') {
      if (!req.headers.authorization) {
        const qTok = u.searchParams.get('access_token');
        if (qTok) req.headers.authorization = 'Bearer ' + qTok;
      }
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
        const { buffer, mimeType } = await Recordings.recordingsReadVideo(uid, m[1]);
        res.writeHead(200, {
          'Content-Type': mimeType || 'video/webm',
          'Content-Length': buffer.length,
          'Cache-Control': 'private, max-age=3600',
        });
        res.end(buffer);
      } catch (e) {
        json(res, 404, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/input-logs/upload' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      assertAccountActive(await store.findUserById(uid));
    } catch (e) {
      json(res, 403, { error: String(e.message || e) });
      return true;
    }
    try {
      const buf = await readBinaryBody(req, InputLogs.MAX_INPUT_LOG_BYTES + 65536);
      const titleRaw = String(req.headers['x-input-log-title'] || 'Run');
      const sourceRaw = String(req.headers['x-input-log-source'] || 'campaign');
      let title = titleRaw;
      let source = sourceRaw;
      try {
        title = decodeURIComponent(titleRaw);
      } catch {
        title = titleRaw;
      }
      try {
        source = decodeURIComponent(sourceRaw);
      } catch {
        source = sourceRaw;
      }
      const saved = await InputLogs.inputLogsCreate(uid, buf, {
        title: title.slice(0, 120),
        source: source.slice(0, 40),
        anticheatOn: Recordings.parseAnticheatOn(req.headers['x-anticheat-on']),
      });
      json(res, 201, { ok: true, log: saved });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/input-logs/mine' && req.method === 'GET') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      const list = await InputLogs.inputLogsListForUser(uid);
      json(res, 200, { logs: list });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/input-logs/delete' && req.method === 'POST') {
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
    const id = String(body.id || '').trim();
    if (!uuidRe.test(id)) {
      json(res, 400, { error: 'Invalid id' });
      return true;
    }
    try {
      await InputLogs.inputLogsDelete(uid, id);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/input-logs\/([^/]+)\/data$/.exec(pathname);
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
      try {
        const { buffer, title } = await InputLogs.inputLogsRead(uid, m[1]);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': buffer.length,
          'Cache-Control': 'private, max-age=3600',
          'X-Input-Log-Title': encodeURIComponent(title || 'Run'),
        });
        res.end(buffer);
      } catch (e) {
        json(res, 404, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/submitted-runs/submit' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      assertAccountActive(await store.findUserById(uid));
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
      const out = await SubmittedRuns.submittedRunCreate(uid, body);
      json(res, 201, { ok: true, submission: out });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/builtin-stages-world2' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    if (effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only' });
      return true;
    }
    if (typeof store.setBuiltinWorld2Stages !== 'function') {
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
    if (raw.length > 2_000_000) {
      json(res, 400, { error: 'World 2 data too large' });
      return true;
    }
    try {
      await store.setBuiltinWorld2Stages(stages);
      json(res, 200, { ok: true, count: stages.length });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/user-mods/upload' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      assertAccountActive(await store.findUserById(uid));
    } catch (e) {
      json(res, 403, { error: String(e.message || e) });
      return true;
    }
    try {
      const buf = await readBinaryBody(req, UserMods.MAX_USER_MOD_BYTES + 65536);
      const titleRaw = String(req.headers['x-mod-title'] || 'Mod');
      let title = titleRaw;
      try {
        title = decodeURIComponent(titleRaw);
      } catch {
        title = titleRaw;
      }
      const saved = await UserMods.userModsCreate(uid, buf, { title: title.slice(0, 120) });
      json(res, 201, { ok: true, mod: saved });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/user-mods/mine' && req.method === 'GET') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      const list = await UserMods.userModsListForUser(uid);
      const activeModIds = await UserMods.userModsGetActiveIds(uid);
      json(res, 200, { mods: list, activeModIds });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/user-mods/active' && req.method === 'POST') {
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
    const ids = Array.isArray(body.ids) ? body.ids : [];
    try {
      const activeModIds = await UserMods.userModsSetActiveIds(uid, ids);
      json(res, 200, { ok: true, activeModIds });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/user-mods/delete' && req.method === 'POST') {
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
    const id = String(body.id || '').trim();
    if (!uuidRe.test(id)) {
      json(res, 400, { error: 'Invalid id' });
      return true;
    }
    try {
      await UserMods.userModsDelete(uid, id);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/user-mods\/([^/]+)\/script$/.exec(pathname);
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
      try {
        const buffer = await UserMods.userModsRead(uid, m[1]);
        res.writeHead(200, {
          'Content-Type': 'application/javascript',
          'Content-Length': buffer.length,
          'Cache-Control': 'private, max-age=3600',
        });
        res.end(buffer);
      } catch (e) {
        json(res, 404, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/staff/submitted-runs' && req.method === 'GET') {
    const staff = await requireStaffSession(req);
    if (!staff) {
      json(res, 403, { error: 'Moderator or owner access required.' });
      return true;
    }
    const username = u.searchParams.get('username') || '';
    const status = u.searchParams.get('status') || 'unreviewed';
    if (!String(username || '').trim()) {
      json(res, 400, { error: 'Enter a player username to search.' });
      return true;
    }
    try {
      const rows = await SubmittedRuns.submittedRunsStaffList({ username, status });
      json(res, 200, { submissions: rows });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/staff/submitted-runs/review' && req.method === 'POST') {
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
    const id = String(body.id || '').trim();
    const status = String(body.status || '').trim();
    if (!uuidRe.test(id)) {
      json(res, 400, { error: 'Invalid id' });
      return true;
    }
    const declineReason = body.declineReason != null ? String(body.declineReason) : '';
    try {
      const out = await SubmittedRuns.submittedRunStaffReview(
        staff.userId,
        staff.role,
        id,
        status,
        declineReason
      );
      json(res, 200, out);
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/submitted-runs/mod-approved' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only.' });
      return true;
    }
    try {
      const rows = await SubmittedRuns.submittedRunsOwnerModApprovedList();
      json(res, 200, { submissions: rows });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/submitted-runs/lock' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only.' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const id = String(body.id || '').trim();
    if (!uuidRe.test(id)) {
      json(res, 400, { error: 'Invalid id' });
      return true;
    }
    try {
      const out = await SubmittedRuns.submittedRunOwnerLockStatus(id);
      json(res, 200, out);
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/staff\/recordings\/([^/]+)\/video$/.exec(pathname);
    if (m && req.method === 'GET') {
      if (!req.headers.authorization) {
        const qTok = u.searchParams.get('access_token');
        if (qTok) req.headers.authorization = 'Bearer ' + qTok;
      }
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
        const { buffer, mimeType } = await Recordings.recordingsReadStaff(m[1]);
        res.writeHead(200, {
          'Content-Type': mimeType || 'video/webm',
          'Content-Length': buffer.length,
          'Cache-Control': 'private, max-age=3600',
        });
        res.end(buffer);
      } catch (e) {
        json(res, 404, { error: String(e.message || e) });
      }
      return true;
    }
  }

  {
    const m = /^\/api\/staff\/input-logs\/([^/]+)\/data$/.exec(pathname);
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
        const { buffer, title } = await InputLogs.inputLogsReadStaff(m[1]);
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Length': buffer.length,
          'Cache-Control': 'private, max-age=3600',
          'X-Input-Log-Title': encodeURIComponent(title || 'Run'),
        });
        res.end(buffer);
      } catch (e) {
        json(res, 404, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (pathname === '/api/owner/leaderboard/campaign' && req.method === 'GET') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only.' });
      return true;
    }
    const diff = String(u.searchParams.get('difficulty') || 'normal').toLowerCase();
    if (typeof store.listOwnerCampaignLeaderboardEntries !== 'function') {
      json(res, 501, { error: 'Not available' });
      return true;
    }
    try {
      const entries = await store.listOwnerCampaignLeaderboardEntries(diff, 50);
      json(res, 200, { entries });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/leaderboard/delete' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only.' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    if (typeof store.deleteCampaignRunById !== 'function') {
      json(res, 501, { error: 'Not available' });
      return true;
    }
    try {
      await store.deleteCampaignRunById(body.runId);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/remove-coins' && req.method === 'POST') {
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
    if (typeof store.incrementUserCoins !== 'function') {
      json(res, 501, { error: 'Not available' });
      return true;
    }
    try {
      const target = await store.findUserByUsername(targetName);
      if (!target) {
        json(res, 400, { error: 'User not found.' });
        return true;
      }
      if (effectiveRole(target) === 'owner') {
        json(res, 400, { error: 'Cannot change owner coin balance this way.' });
        return true;
      }
      await store.incrementUserCoins(target.id, -amount);
      const fresh = await store.findUserById(target.id);
      json(res, 200, {
        ok: true,
        coins: fresh && fresh.coins != null ? Number(fresh.coins) : 0,
      });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/leaderboard/add-campaign-run' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only.' });
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
    const diffRaw = String(body.difficulty || 'normal').toLowerCase();
    const difficulty = diffRaw === 'easy' || diffRaw === 'hard' ? diffRaw : 'normal';
    const timeMs = Math.max(0, Math.min(Number(body.timeMs) || 0, 48 * 60 * 60 * 1000));
    const deaths = Math.max(0, Math.min(Math.floor(Number(body.deaths) || 0), 1_000_000));
    const runCount = Math.max(1, Math.min(500, Math.floor(Number(body.runCount) || 1)));
    if (!targetName) {
      json(res, 400, { error: 'username required' });
      return true;
    }
    if (typeof store.addRun !== 'function') {
      json(res, 501, { error: 'Not available' });
      return true;
    }
    try {
      const target = await store.findUserByUsername(targetName);
      if (!target) {
        json(res, 400, { error: 'User not found.' });
        return true;
      }
      for (let i = 0; i < runCount; i++) {
        await store.addRun(target.id, timeMs, deaths, 'campaign', difficulty);
      }
      json(res, 200, { ok: true, runsAdded: runCount });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (pathname === '/api/owner/leaderboard/set-coins' && req.method === 'POST') {
    const sess = await getActiveSessionUser(req);
    if (!sess || effectiveRole(sess.user) !== 'owner') {
      json(res, 403, { error: 'Owner only.' });
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
    const coins = Math.floor(Number(body.coins));
    if (!targetName) {
      json(res, 400, { error: 'username required' });
      return true;
    }
    if (!Number.isFinite(coins) || coins < 0 || coins > 1_000_000_000) {
      json(res, 400, { error: 'coins must be 0–1,000,000,000' });
      return true;
    }
    if (typeof store.setUserCoins !== 'function') {
      json(res, 501, { error: 'Not available' });
      return true;
    }
    try {
      const target = await store.findUserByUsername(targetName);
      if (!target) {
        json(res, 400, { error: 'User not found.' });
        return true;
      }
      if (effectiveRole(target) === 'owner') {
        json(res, 400, { error: 'Owner account uses infinite coins in UI.' });
        return true;
      }
      await store.setUserCoins(target.id, coins);
      json(res, 200, { ok: true, coins });
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

  if (pathname === '/api/levels/delete' && req.method === 'POST') {
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
    const levelId = String(body.id || body.levelId || '').trim();
    if (!uuidRe.test(levelId)) {
      json(res, 400, { error: 'Invalid level id' });
      return true;
    }
    try {
      await UserLevels.levelsDeleteOwned(uid, levelId);
      json(res, 200, { ok: true });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
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
