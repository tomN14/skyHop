import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { BAN_PERMANENT_MS, banStatusForUser, ownerUsernameLower } from './moderation.js';
import { extFromContentType, MAX_AVATAR_BYTES, sniffImageExt } from './profile-storage.js';
import { loadDefaultWorld2Stages } from './world2-default-stages.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');

/** @type {{ users: any[], sessions: any[], runs: any[], userAchievements: any[], reports: any[], textureGrants: any[], friendRequests: any[], nextUserId: number } | null} */
let cache = null;

function defaultStore() {
  return {
    users: [],
    sessions: [],
    runs: [],
    userAchievements: [],
    reports: [],
    textureGrants: [],
    friendRequests: [],
    friendChat: [],
    siteContent: {},
    banAppeals: [],
    banAppealVotes: [],
    nextUserId: 1,
    nextRunId: 1,
  };
}

function migrateUsersAndReports(s) {
  if (!Array.isArray(s.reports)) s.reports = [];
  if (!Array.isArray(s.textureGrants)) s.textureGrants = [];
  if (!Array.isArray(s.friendRequests)) s.friendRequests = [];
  if (!Array.isArray(s.friendChat)) s.friendChat = [];
  if (!s.siteContent || typeof s.siteContent !== 'object') s.siteContent = {};
  if (!Array.isArray(s.banAppeals)) s.banAppeals = [];
  if (!Array.isArray(s.banAppealVotes)) s.banAppealVotes = [];
  for (const u of s.users) {
    if (u.role == null) u.role = 'player';
    if (!('banUntilMs' in u)) u.banUntilMs = null;
    if (!('banReason' in u)) u.banReason = null;
    if (u.coins == null || !Number.isFinite(Number(u.coins))) u.coins = 0;
    if (!('skinTexture' in u)) u.skinTexture = null;
    if (!('disabledAt' in u)) u.disabledAt = null;
    if (!('profileBio' in u)) u.profileBio = null;
    if (!('profileAvatarPath' in u)) u.profileAvatarPath = null;
    if (!('campaignWorld1ClearedAt' in u)) u.campaignWorld1ClearedAt = null;
    const st = u.skinTexture;
    if (st && typeof st === 'string') {
      const fn = path.basename(st);
      if (fn && /\.(png|webp|gif|jpg|jpeg)$/i.test(fn) && !s.textureGrants.some((g) => g.userId === u.id && g.filename === fn)) {
        s.textureGrants.push({ userId: u.id, filename: fn, at: Date.now() });
      }
    }
  }
}

function loadStore() {
  if (cache) return cache;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    cache = defaultStore();
    saveStore();
    return cache;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    cache = JSON.parse(raw);
  } catch {
    cache = defaultStore();
  }
  if (!Array.isArray(cache.users)) cache.users = [];
  if (!Array.isArray(cache.sessions)) cache.sessions = [];
  if (!Array.isArray(cache.runs)) cache.runs = [];
  if (!Array.isArray(cache.userAchievements)) cache.userAchievements = [];
  if (typeof cache.nextUserId !== 'number' || cache.nextUserId < 1) cache.nextUserId = 1;
  if (typeof cache.nextRunId !== 'number' || cache.nextRunId < 1) cache.nextRunId = 1;
  for (const r of cache.runs) {
    if (r.id == null || !Number.isFinite(Number(r.id))) {
      r.id = cache.nextRunId++;
    }
  }
  migrateUsersAndReports(cache);
  saveStore();
  return cache;
}

function saveStore() {
  if (!cache) return;
  fs.writeFileSync(DATA_FILE, JSON.stringify(cache), 'utf8');
}

const SESSION_DAYS = 60;

function pruneSessionsSync() {
  const s = loadStore();
  const now = Date.now();
  s.sessions = s.sessions.filter((x) => x.expiresAt > now);
}

function initialRoleForUsername(name) {
  const low = String(name || '').toLowerCase();
  const own = ownerUsernameLower();
  if (own && low === own) return 'owner';
  return 'player';
}

export function createFileStore() {
  return {
    async findUserByUsername(username) {
      const s = loadStore();
      const low = String(username || '').trim().toLowerCase();
      return s.users.find((u) => u.usernameLower === low) || null;
    },

    async findUserById(id) {
      const s = loadStore();
      return s.users.find((u) => u.id === id) || null;
    },

    async setCampaignWorld1ClearedAt(userId, atMs) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) return;
      if (u.campaignWorld1ClearedAt != null && u.campaignWorld1ClearedAt > 0) return;
      u.campaignWorld1ClearedAt = Math.floor(Number(atMs) || Date.now());
      saveStore();
    },

    async createUser(username, password) {
      const name = String(username || '').trim();
      if (name.length < 2 || name.length > 24) throw new Error('Username must be 2–24 characters.');
      if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Username: letters, numbers, underscore only.');
      if (String(password || '').length < 6) throw new Error('Password must be at least 6 characters.');
      const s = loadStore();
      if (s.users.some((u) => u.usernameLower === name.toLowerCase())) throw new Error('Username already taken.');
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex');
      const user = {
        id: s.nextUserId++,
        username: name,
        usernameLower: name.toLowerCase(),
        salt,
        hash,
        createdAt: Date.now(),
        role: initialRoleForUsername(name),
        banUntilMs: null,
        banReason: null,
        coins: 0,
        skinTexture: null,
      };
      s.users.push(user);
      saveStore();
      return user;
    },

    async verifyUser(username, password) {
      const u = await this.findUserByUsername(username);
      if (!u) return null;
      const hashTry = crypto.scryptSync(password, Buffer.from(u.salt, 'hex'), 64).toString('hex');
      if (!crypto.timingSafeEqual(Buffer.from(hashTry, 'hex'), Buffer.from(u.hash, 'hex'))) return null;
      return u;
    },

    async clearExpiredBanIfAny(userId) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u || u.banUntilMs == null || u.banUntilMs === BAN_PERMANENT_MS) return;
      const until = Number(u.banUntilMs);
      if (Number.isFinite(until) && until <= Date.now()) {
        u.banUntilMs = null;
        u.banReason = null;
        saveStore();
      }
    },

    async clearUserBan(userId) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) throw new Error('User not found');
      u.banUntilMs = null;
      u.banReason = null;
      saveStore();
    },

    async applyBan(userId, banUntilMs, reason) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) throw new Error('User not found');
      u.banUntilMs = banUntilMs;
      u.banReason = reason != null ? String(reason).slice(0, 500) : null;
      saveStore();
      s.sessions = s.sessions.filter((sess) => sess.userId !== userId);
      saveStore();
    },

    async setModeratorRole(userId, isModerator) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) throw new Error('User not found');
      const own = ownerUsernameLower();
      if (own && u.usernameLower === own) throw new Error('Cannot change owner role.');
      u.role = isModerator ? 'moderator' : 'player';
      saveStore();
    },

    async revokeAllSessionsForUser(userId) {
      const s = loadStore();
      s.sessions = s.sessions.filter((sess) => sess.userId !== userId);
      saveStore();
    },

    async createSession(userId) {
      const s = loadStore();
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
      pruneSessionsSync();
      s.sessions.push({ token, userId, expiresAt });
      saveStore();
      return { token, expiresAt };
    },

    async sessionUserId(token) {
      if (!token) return null;
      pruneSessionsSync();
      const s = loadStore();
      const row = s.sessions.find((x) => x.token === token);
      if (!row || row.expiresAt <= Date.now()) return null;
      return row.userId;
    },

    async revokeSession(token) {
      const s = loadStore();
      const i = s.sessions.findIndex((x) => x.token === token);
      if (i >= 0) s.sessions.splice(i, 1);
      saveStore();
    },

    async addRun(userId, timeMs, deaths, source, difficulty) {
      const s = loadStore();
      const t = Math.max(0, Math.min(Number(timeMs) || 0, 48 * 60 * 60 * 1000));
      const d = Math.max(0, Math.min(Math.floor(Number(deaths) || 0), 1_000_000));
      const src = source === 'race' ? 'race' : 'campaign';
      let diff = null;
      if (src === 'campaign' && difficulty) {
        const low = String(difficulty).toLowerCase();
        if (low === 'easy' || low === 'normal' || low === 'hard') diff = low;
      }
      const id = s.nextRunId++;
      s.runs.push({ id, userId, timeMs: t, deaths: d, source: src, difficulty: diff, createdAt: Date.now() });
      saveStore();
    },

    async listOwnerCampaignLeaderboardEntries(difficulty, limit = 50) {
      const diff = String(difficulty || '').toLowerCase();
      if (diff !== 'easy' && diff !== 'normal' && diff !== 'hard') {
        throw new Error('difficulty must be easy, normal, or hard');
      }
      const cap = Math.max(1, Math.min(50, Math.floor(Number(limit) || 50)));
      const s = loadStore();
      const best = new Map();
      for (const r of s.runs) {
        if (r.source !== 'campaign' || r.difficulty !== diff) continue;
        const uid = r.userId;
        const prev = best.get(uid);
        if (!prev || r.timeMs < prev.timeMs) {
          best.set(uid, r);
        }
      }
      const rows = [...best.values()].sort((a, b) => a.timeMs - b.timeMs).slice(0, cap);
      const out = [];
      for (const row of rows) {
        const u = s.users.find((x) => x.id === row.userId);
        out.push({
          runId: row.id,
          userId: row.userId,
          username: u ? u.username : 'unknown',
          timeMs: row.timeMs,
          deaths: row.deaths,
        });
      }
      return out;
    },

    async deleteCampaignRunById(runId) {
      const id = Number(runId);
      if (!Number.isFinite(id)) throw new Error('Invalid run id');
      const s = loadStore();
      const idx = s.runs.findIndex((r) => Number(r.id) === id && r.source === 'campaign');
      if (idx < 0) throw new Error('Run not found');
      s.runs.splice(idx, 1);
      saveStore();
      return { ok: true };
    },

    async listCampaignLeaderboard(difficulty, limit = 10, friendUserIds = null) {
      const diff = String(difficulty || '').toLowerCase();
      if (diff !== 'easy' && diff !== 'normal' && diff !== 'hard') {
        throw new Error('difficulty must be easy, normal, or hard');
      }
      const cap = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
      const s = loadStore();
      const best = new Map();
      for (const r of s.runs) {
        if (r.source !== 'campaign' || r.difficulty !== diff) continue;
        if (friendUserIds && friendUserIds.size && !friendUserIds.has(r.userId)) continue;
        const prev = best.get(r.userId);
        if (!prev || r.timeMs < prev.timeMs) {
          best.set(r.userId, { userId: r.userId, timeMs: r.timeMs, deaths: r.deaths });
        }
      }
      const rows = [...best.values()].sort((a, b) => a.timeMs - b.timeMs).slice(0, cap);
      const out = [];
      for (const row of rows) {
        const u = s.users.find((x) => x.id === row.userId);
        out.push({
          username: u ? u.username : 'unknown',
          timeMs: row.timeMs,
          deaths: row.deaths,
        });
      }
      return out;
    },

    async listLeaderboardFewestDeaths(difficulty, limit = 10, friendUserIds = null) {
      const diff = String(difficulty || '').toLowerCase();
      if (diff !== 'easy' && diff !== 'normal' && diff !== 'hard') {
        throw new Error('difficulty must be easy, normal, or hard');
      }
      const cap = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
      const s = loadStore();
      const best = new Map();
      for (const r of s.runs) {
        if (r.source !== 'campaign' || r.difficulty !== diff) continue;
        if (friendUserIds && friendUserIds.size && !friendUserIds.has(r.userId)) continue;
        const prev = best.get(r.userId);
        if (!prev || r.deaths < prev.deaths || (r.deaths === prev.deaths && r.timeMs < prev.timeMs)) {
          best.set(r.userId, { userId: r.userId, timeMs: r.timeMs, deaths: r.deaths });
        }
      }
      const rows = [...best.values()].sort((a, b) => a.deaths - b.deaths || a.timeMs - b.timeMs).slice(0, cap);
      const out = [];
      for (const row of rows) {
        const u = s.users.find((x) => x.id === row.userId);
        out.push({
          username: u ? u.username : 'unknown',
          timeMs: row.timeMs,
          deaths: row.deaths,
        });
      }
      return out;
    },

    async listLeaderboardRunCount(limit = 10, friendUserIds = null, difficulty = null) {
      const cap = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
      const diff = difficulty ? String(difficulty).toLowerCase() : '';
      const s = loadStore();
      const counts = new Map();
      for (const r of s.runs) {
        if (r.source !== 'campaign') continue;
        if (diff === 'easy' || diff === 'normal' || diff === 'hard') {
          if (r.difficulty !== diff) continue;
        }
        if (friendUserIds && friendUserIds.size && !friendUserIds.has(r.userId)) continue;
        counts.set(r.userId, (counts.get(r.userId) || 0) + 1);
      }
      const rows = [...counts.entries()]
        .map(([userId, runCount]) => ({ userId, runCount }))
        .sort((a, b) => b.runCount - a.runCount)
        .slice(0, cap);
      const out = [];
      for (const row of rows) {
        const u = s.users.find((x) => x.id === row.userId);
        out.push({
          username: u ? u.username : 'unknown',
          runCount: row.runCount,
        });
      }
      return out;
    },

    async listLeaderboardCoins(limit = 10, friendUserIds = null) {
      const cap = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
      const s = loadStore();
      let users = s.users.slice();
      if (friendUserIds && friendUserIds.size) {
        users = users.filter((u) => friendUserIds.has(u.id));
      }
      users.sort((a, b) => (b.coins || 0) - (a.coins || 0));
      const out = [];
      for (const u of users) {
        const coins = u.coins != null ? Number(u.coins) : 0;
        if (coins <= 0) continue;
        out.push({ username: u.username, coins });
        if (out.length >= cap) break;
      }
      return out;
    },

    async countUsersCreatedSince(sinceMs) {
      const s = loadStore();
      const since = Number(sinceMs) || 0;
      return s.users.filter((u) => (u.createdAt != null ? Number(u.createdAt) : 0) >= since).length;
    },

    async getRunsForUser(userId) {
      const s = loadStore();
      return s.runs.filter((r) => r.userId === userId);
    },

    async getAchievementsForUser(userId) {
      const s = loadStore();
      return s.userAchievements
        .filter((a) => a.userId === userId)
        .map((a) => ({ achievementId: a.achievementId, unlockedAt: a.unlockedAt }));
    },

    async insertUserAchievements(userId, newDefs) {
      if (!newDefs.length) return;
      const s = loadStore();
      const now = Date.now();
      for (const def of newDefs) {
        s.userAchievements.push({ userId, achievementId: def.id, unlockedAt: now });
      }
      saveStore();
    },

    async createReport(reporterId, reportedUserId, reason) {
      const s = loadStore();
      const id = crypto.randomUUID();
      const now = Date.now();
      s.reports.push({
        id,
        reporterId,
        reportedUserId,
        reason: String(reason || '').slice(0, 4000),
        status: 'pending',
        moderatorNote: null,
        createdAt: now,
        updatedAt: now,
      });
      saveStore();
      return id;
    },

    async countReportsByStatus(status) {
      const s = loadStore();
      return s.reports.filter((r) => r.status === status).length;
    },

    async listReportsByStatus(status) {
      const s = loadStore();
      return s.reports.filter((r) => r.status === status).sort((a, b) => b.createdAt - a.createdAt);
    },

    async getReportById(reportId) {
      const s = loadStore();
      return s.reports.find((r) => r.id === reportId) || null;
    },

    async updateReportStatus(reportId, status, moderatorNote) {
      const s = loadStore();
      const r = s.reports.find((x) => x.id === reportId);
      if (!r) return false;
      r.status = status;
      if (moderatorNote != null) r.moderatorNote = String(moderatorNote).slice(0, 2000);
      r.updatedAt = Date.now();
      saveStore();
      return true;
    },

    async listModerators() {
      const s = loadStore();
      return s.users.filter((u) => u.role === 'moderator').map((u) => ({ id: u.id, username: u.username }));
    },

    async incrementUserCoins(userId, delta) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) throw new Error('User not found');
      u.coins = Math.max(0, Math.floor((u.coins || 0) + Number(delta)));
      saveStore();
    },

    async setUserCoins(userId, coins) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) throw new Error('User not found');
      u.coins = Math.max(0, Math.min(1_000_000_000, Math.floor(Number(coins) || 0)));
      saveStore();
    },

    async setUserProfile(userId, { bio, avatarPath }) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) throw new Error('User not found');
      if (bio !== undefined) {
        const b = bio == null ? null : String(bio).trim().slice(0, 500);
        u.profileBio = b || null;
      }
      if (avatarPath !== undefined) {
        u.profileAvatarPath = avatarPath == null ? null : String(avatarPath).slice(0, 240);
      }
      saveStore();
    },

    async uploadUserProfileAvatar(userId, buffer, contentType) {
      if (buffer.length > MAX_AVATAR_BYTES) throw new Error('Avatar must be 512 KB or smaller.');
      const ext = extFromContentType(contentType) || sniffImageExt(buffer);
      if (!ext) throw new Error('File must be PNG, JPEG, WebP, or GIF.');
      const dir = path.join(DATA_DIR, 'profile-avatars');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const rel = `${userId}/avatar.${ext === 'jpg' ? 'jpg' : ext}`;
      const full = path.join(dir, `${userId}.${ext === 'jpg' ? 'jpg' : ext}`);
      fs.writeFileSync(full, buffer);
      await this.setUserProfile(userId, { avatarPath: rel });
      return rel;
    },

    async createUserProfileSignedAvatarUpload() {
      throw new Error('Signed storage upload requires Supabase.');
    },

    async getPublicProfileByUsername(username) {
      const u = await this.findUserByUsername(username);
      if (!u) return null;
      return {
        username: u.username,
        bio: u.profileBio ?? null,
        avatarPath: u.profileAvatarPath ?? null,
        role: u.role ?? 'player',
      };
    },

    async setUserSkinTexture(userId, fn) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) throw new Error('User not found');
      u.skinTexture = fn != null ? String(fn).slice(0, 120) : null;
      saveStore();
    },

    async getBuiltinCampaignStages() {
      const p = path.join(DATA_DIR, 'builtin_campaign.json');
      if (!fs.existsSync(p)) return null;
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!j.stages || !Array.isArray(j.stages) || !j.stages.length) return null;
        return j.stages;
      } catch {
        return null;
      }
    },

    async setBuiltinCampaignStages(stagesJson) {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const p = path.join(DATA_DIR, 'builtin_campaign.json');
      fs.writeFileSync(p, JSON.stringify({ stages: stagesJson, updatedAt: Date.now() }), 'utf8');
    },

    async getBuiltinWorld2Stages() {
      const p = path.join(DATA_DIR, 'builtin_world2.json');
      if (fs.existsSync(p)) {
        try {
          const j = JSON.parse(fs.readFileSync(p, 'utf8'));
          if (j.stages && Array.isArray(j.stages) && j.stages.length) return j.stages;
        } catch {
          /* fall through to bundled default */
        }
      }
      return loadDefaultWorld2Stages();
    },

    async setBuiltinWorld2Stages(stagesJson) {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const p = path.join(DATA_DIR, 'builtin_world2.json');
      fs.writeFileSync(p, JSON.stringify({ stages: stagesJson, updatedAt: Date.now() }), 'utf8');
    },

    async listOnlineCoinClaimIndices(userId, levelId) {
      const p = path.join(DATA_DIR, 'coin_claims.json');
      if (!fs.existsSync(p)) return new Set();
      try {
        const j = JSON.parse(fs.readFileSync(p, 'utf8'));
        const claims = j.claims || [];
        const out = new Set();
        for (const c of claims) {
          if (c.userId === userId && c.levelId === levelId) out.add(Number(c.coinIndex));
        }
        return out;
      } catch {
        return new Set();
      }
    },

    async claimOnlineCoin(userId, levelId, coinIndex) {
      const idx = Math.floor(Number(coinIndex));
      if (idx < 0 || idx > 4096) throw new Error('Invalid coin');
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const p = path.join(DATA_DIR, 'coin_claims.json');
      let j = { claims: [] };
      if (fs.existsSync(p)) {
        try {
          j = JSON.parse(fs.readFileSync(p, 'utf8'));
        } catch {
          j = { claims: [] };
        }
      }
      if (!Array.isArray(j.claims)) j.claims = [];
      for (const c of j.claims) {
        if (c.userId === userId && c.levelId === levelId && Number(c.coinIndex) === idx) return false;
      }
      j.claims.push({ userId, levelId, coinIndex: idx, at: Date.now() });
      fs.writeFileSync(p, JSON.stringify(j), 'utf8');
      return true;
    },

    async listTextureGrantsForUser(userId) {
      const s = loadStore();
      const names = new Set();
      for (const g of s.textureGrants) {
        if (g.userId === userId) names.add(g.filename);
      }
      return [...names].sort();
    },

    async userHasTextureGrant(userId, filename) {
      const fn = path.basename(String(filename || ''));
      if (!fn) return false;
      const s = loadStore();
      return s.textureGrants.some((g) => g.userId === userId && g.filename === fn);
    },

    async addTextureGrant(userId, filename) {
      const fn = path.basename(String(filename || ''));
      if (!fn || !/\.(png|webp|gif|jpg|jpeg)$/i.test(fn)) throw new Error('Invalid texture filename.');
      const s = loadStore();
      if (s.textureGrants.some((g) => g.userId === userId && g.filename === fn)) return false;
      s.textureGrants.push({ userId, filename: fn, at: Date.now() });
      saveStore();
      return true;
    },

    async removeTextureGrant(userId, filename) {
      const fn = path.basename(String(filename || ''));
      const s = loadStore();
      const before = s.textureGrants.length;
      s.textureGrants = s.textureGrants.filter((g) => !(g.userId === userId && g.filename === fn));
      saveStore();
      return s.textureGrants.length < before;
    },

    async transferCoins(fromUserId, toUserId, amount, opts) {
      const amt = Math.floor(Number(amount));
      if (!Number.isFinite(amt) || amt < 1) throw new Error('Invalid amount.');
      const s = loadStore();
      const from = s.users.find((x) => x.id === fromUserId);
      const to = s.users.find((x) => x.id === toUserId);
      if (!from || !to) throw new Error('User not found.');
      if (opts && opts.skipSenderDebit) {
        to.coins = Math.max(0, Math.floor((to.coins || 0) + amt));
        saveStore();
        return;
      }
      const bal = Math.floor(from.coins || 0);
      if (bal < amt) throw new Error('Insufficient coins.');
      from.coins = bal - amt;
      to.coins = Math.max(0, Math.floor((to.coins || 0) + amt));
      saveStore();
    },

    async createFriendRequest(fromUserId, toUserId) {
      if (fromUserId === toUserId) throw new Error('Cannot send a friend request to yourself.');
      const s = loadStore();
      const pendingAB = (a, b) =>
        s.friendRequests.some((r) => r.status === 'pending' && r.fromUserId === a && r.toUserId === b);
      const acceptedPair = (a, b) =>
        s.friendRequests.some(
          (r) =>
            r.status === 'accepted' &&
            ((r.fromUserId === a && r.toUserId === b) || (r.fromUserId === b && r.toUserId === a))
        );
      if (acceptedPair(fromUserId, toUserId)) throw new Error('Already friends.');
      if (pendingAB(fromUserId, toUserId)) throw new Error('Friend request already sent.');
      if (pendingAB(toUserId, fromUserId)) throw new Error('This user already sent you a request — open Friends to accept.');
      const row = {
        id: crypto.randomUUID(),
        fromUserId,
        toUserId,
        status: 'pending',
        createdAt: Date.now(),
      };
      s.friendRequests.push(row);
      saveStore();
      return row.id;
    },

    async acceptFriendRequest(requestId, userId) {
      const s = loadStore();
      const r = s.friendRequests.find((x) => x.id === requestId);
      if (!r || r.status !== 'pending') throw new Error('Request not found.');
      if (r.toUserId !== userId) throw new Error('You cannot accept this request.');
      r.status = 'accepted';
      saveStore();
    },

    async declineFriendRequest(requestId, userId) {
      const s = loadStore();
      const i = s.friendRequests.findIndex(
        (x) => x.id === requestId && x.toUserId === userId && x.status === 'pending'
      );
      if (i < 0) throw new Error('Request not found.');
      s.friendRequests.splice(i, 1);
      saveStore();
    },

    async areFriends(userIdA, userIdB) {
      if (userIdA === userIdB) return false;
      const s = loadStore();
      return s.friendRequests.some(
        (r) =>
          r.status === 'accepted' &&
          ((r.fromUserId === userIdA && r.toUserId === userIdB) ||
            (r.fromUserId === userIdB && r.toUserId === userIdA))
      );
    },

    async listFriendsBundle(userId) {
      const s = loadStore();
      const friends = [];
      const incoming = [];
      const outgoing = [];
      for (const r of s.friendRequests) {
        if (r.status === 'accepted') {
          if (r.fromUserId === userId) {
            const u = s.users.find((x) => x.id === r.toUserId);
            if (u) friends.push({ userId: u.id, username: u.username });
          } else if (r.toUserId === userId) {
            const u = s.users.find((x) => x.id === r.fromUserId);
            if (u) friends.push({ userId: u.id, username: u.username });
          }
        } else if (r.status === 'pending') {
          if (r.toUserId === userId) {
            const u = s.users.find((x) => x.id === r.fromUserId);
            if (u) incoming.push({ id: r.id, fromUserId: u.id, fromUsername: u.username, createdAt: r.createdAt });
          } else if (r.fromUserId === userId) {
            const u = s.users.find((x) => x.id === r.toUserId);
            if (u) outgoing.push({ id: r.id, toUserId: u.id, toUsername: u.username, createdAt: r.createdAt });
          }
        }
      }
      friends.sort((a, b) => a.username.localeCompare(b.username));
      return { friends, incoming, outgoing };
    },

    async countIncomingPendingFriendRequests(userId) {
      const s = loadStore();
      return s.friendRequests.filter((r) => r.status === 'pending' && r.toUserId === userId).length;
    },

    async setUserDisabled(userId, disabled) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) throw new Error('User not found');
      u.disabledAt = disabled ? Date.now() : null;
      saveStore();
    },

    async deleteUserPermanently(userId) {
      const s = loadStore();
      const u = s.users.find((x) => x.id === userId);
      if (!u) throw new Error('User not found');
      s.users = s.users.filter((x) => x.id !== userId);
      s.runs = s.runs.filter((r) => r.userId !== userId);
      s.userAchievements = s.userAchievements.filter((a) => a.userId !== userId);
      s.sessions = s.sessions.filter((x) => x.userId !== userId);
      s.textureGrants = s.textureGrants.filter((g) => g.userId !== userId);
      s.friendRequests = s.friendRequests.filter(
        (r) => r.fromUserId !== userId && r.toUserId !== userId
      );
      s.friendChat = s.friendChat.filter((m) => m.fromUserId !== userId && m.toUserId !== userId);
      s.reports = s.reports.filter((r) => r.reporterId !== userId && r.reportedUserId !== userId);
      saveStore();
      try {
        const { recordingsDeleteAllForUser } = await import('./recordings.js');
        await recordingsDeleteAllForUser(userId);
      } catch {
        /* */
      }
      try {
        const avDir = path.join(DATA_DIR, 'profile-avatars');
        for (const ext of ['png', 'jpg', 'jpeg', 'webp', 'gif']) {
          const fp = path.join(avDir, `${userId}.${ext}`);
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        }
      } catch {
        /* */
      }
      const levelsPath = path.join(DATA_DIR, 'user_levels.json');
      if (fs.existsSync(levelsPath)) {
        try {
          const j = JSON.parse(fs.readFileSync(levelsPath, 'utf8'));
          if (Array.isArray(j.levels)) {
            j.levels = j.levels.filter((lv) => lv.authorId !== userId);
            fs.writeFileSync(levelsPath, JSON.stringify(j), 'utf8');
          }
        } catch {
          /* */
        }
      }
    },

    async insertFriendChatMessage(fromUserId, toUserId, body) {
      const s = loadStore();
      const row = {
        id: crypto.randomUUID(),
        fromUserId,
        toUserId,
        body: String(body || '').slice(0, 2000),
        createdAt: Date.now(),
      };
      s.friendChat.push(row);
      if (s.friendChat.length > 50000) s.friendChat.splice(0, s.friendChat.length - 50000);
      saveStore();
      return row;
    },

    async listFriendChatMessages(userId, friendUserId, sinceMs) {
      const s = loadStore();
      const since = Number(sinceMs) || 0;
      return s.friendChat
        .filter(
          (m) =>
            m.createdAt > since &&
            ((m.fromUserId === userId && m.toUserId === friendUserId) ||
              (m.fromUserId === friendUserId && m.toUserId === userId))
        )
        .sort((x, y) => x.createdAt - y.createdAt)
        .slice(-200)
        .map((m) => ({
          id: m.id,
          fromUserId: m.fromUserId,
          toUserId: m.toUserId,
          body: m.body,
          createdAt: m.createdAt,
          mine: m.fromUserId === userId,
        }));
    },

    async getSiteContentPayload(key) {
      const k = String(key || '').trim();
      if (!k) return null;
      const s = loadStore();
      const row = s.siteContent[k];
      return row && typeof row === 'object' ? row : null;
    },

    async setSiteContentPayload(key, payload) {
      const k = String(key || '').trim();
      if (!k) throw new Error('Invalid content key');
      const s = loadStore();
      s.siteContent[k] = payload;
      saveStore();
    },

    async createBanAppeal(userId, reason) {
      const s = loadStore();
      const open = s.banAppeals.find((a) => a.userId === userId && a.status === 'open');
      if (open) throw new Error('You already have an open appeal.');
      const row = {
        id: crypto.randomUUID(),
        userId,
        reason: String(reason).slice(0, 4000),
        status: 'open',
        outcome: null,
        createdAt: Date.now(),
        resolvedAt: null,
      };
      s.banAppeals.push(row);
      saveStore();
      return row;
    },

    async getBanAppealById(id) {
      const s = loadStore();
      return s.banAppeals.find((a) => a.id === id) || null;
    },

    async listOpenBanAppeals() {
      const s = loadStore();
      return s.banAppeals
        .filter((a) => a.status === 'open')
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async countOpenBanAppeals() {
      const s = loadStore();
      return s.banAppeals.filter((a) => a.status === 'open').length;
    },

    async listBanAppealVotes(appealId) {
      const s = loadStore();
      return s.banAppealVotes
        .filter((v) => v.appealId === appealId)
        .map((v) => ({
          voterUserId: v.voterUserId,
          vote: v.vote,
          createdAt: v.createdAt,
          username: s.users.find((u) => u.id === v.voterUserId)?.username || 'unknown',
        }));
    },

    async upsertBanAppealVote(appealId, voterUserId, vote) {
      const s = loadStore();
      const v = vote === 'unban' ? 'unban' : 'keep_ban';
      const idx = s.banAppealVotes.findIndex((x) => x.appealId === appealId && x.voterUserId === voterUserId);
      const row = { appealId, voterUserId, vote: v, createdAt: Date.now() };
      if (idx >= 0) s.banAppealVotes[idx] = row;
      else s.banAppealVotes.push(row);
      saveStore();
      return row;
    },

    async setBanAppealResolved(appealId, status, outcome) {
      const s = loadStore();
      const a = s.banAppeals.find((x) => x.id === appealId);
      if (!a) throw new Error('Appeal not found');
      a.status = status;
      a.outcome = outcome;
      a.resolvedAt = Date.now();
      saveStore();
    },
  };
}
