import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { BAN_PERMANENT_MS, banStatusForUser, ownerUsernameLower } from './moderation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');

/** @type {{ users: any[], sessions: any[], runs: any[], userAchievements: any[], reports: any[], nextUserId: number } | null} */
let cache = null;

function defaultStore() {
  return { users: [], sessions: [], runs: [], userAchievements: [], reports: [], nextUserId: 1 };
}

function migrateUsersAndReports(s) {
  if (!Array.isArray(s.reports)) s.reports = [];
  for (const u of s.users) {
    if (u.role == null) u.role = 'player';
    if (!('banUntilMs' in u)) u.banUntilMs = null;
    if (!('banReason' in u)) u.banReason = null;
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
      const low = String(username || '').toLowerCase();
      return s.users.find((u) => u.usernameLower === low) || null;
    },

    async findUserById(id) {
      const s = loadStore();
      return s.users.find((u) => u.id === id) || null;
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

    async addRun(userId, timeMs, deaths, source) {
      const s = loadStore();
      const t = Math.max(0, Math.min(Number(timeMs) || 0, 48 * 60 * 60 * 1000));
      const d = Math.max(0, Math.min(Math.floor(Number(deaths) || 0), 1_000_000));
      const src = source === 'race' ? 'race' : 'campaign';
      s.runs.push({ userId, timeMs: t, deaths: d, source: src, createdAt: Date.now() });
      saveStore();
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
  };
}
