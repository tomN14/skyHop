import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { BAN_PERMANENT_MS, ownerUsernameLower } from './moderation.js';

const SESSION_DAYS = 60;

function initialRoleForUsername(name) {
  const low = String(name || '').toLowerCase();
  const own = ownerUsernameLower();
  if (own && low === own) return 'owner';
  return 'player';
}

function mapUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    usernameLower: row.username_lower,
    salt: row.salt,
    hash: row.hash,
    role: row.role ?? 'player',
    banUntilMs: row.ban_until_ms != null ? Number(row.ban_until_ms) : null,
    banReason: row.ban_reason ?? null,
  };
}

function mapRun(row) {
  return {
    userId: row.user_id,
    timeMs: row.time_ms,
    deaths: row.deaths,
    source: row.source,
    createdAt: row.created_at,
  };
}

export function createSupabaseStore() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Supabase store');
  }
  const sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: { transport: WebSocket },
  });

  async function pruneSessions() {
    const now = Date.now();
    await sb.from('skyhop_sessions').delete().lt('expires_at', now);
  }

  return {
    async findUserByUsername(username) {
      const low = String(username || '').toLowerCase();
      const { data, error } = await sb.from('skyhop_users').select('*').eq('username_lower', low).maybeSingle();
      if (error) throw new Error(error.message);
      return mapUser(data);
    },

    async findUserById(id) {
      const { data, error } = await sb.from('skyhop_users').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return mapUser(data);
    },

    async createUser(username, password) {
      const name = String(username || '').trim();
      if (name.length < 2 || name.length > 24) throw new Error('Username must be 2–24 characters.');
      if (!/^[a-zA-Z0-9_]+$/.test(name)) throw new Error('Username: letters, numbers, underscore only.');
      if (String(password || '').length < 6) throw new Error('Password must be at least 6 characters.');

      const existing = await this.findUserByUsername(name);
      if (existing) throw new Error('Username already taken.');

      const salt = crypto.randomBytes(16).toString('hex');
      const hash = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64).toString('hex');
      const createdAt = Date.now();
      const role = initialRoleForUsername(name);

      const { data, error } = await sb
        .from('skyhop_users')
        .insert({
          username: name,
          username_lower: name.toLowerCase(),
          salt,
          hash,
          created_at: createdAt,
          role,
          ban_until_ms: null,
          ban_reason: null,
        })
        .select('*')
        .single();

      if (error) {
        if (error.code === '23505') throw new Error('Username already taken.');
        throw new Error(error.message);
      }
      return mapUser(data);
    },

    async verifyUser(username, password) {
      const u = await this.findUserByUsername(username);
      if (!u) return null;
      const hashTry = crypto.scryptSync(password, Buffer.from(u.salt, 'hex'), 64).toString('hex');
      if (!crypto.timingSafeEqual(Buffer.from(hashTry, 'hex'), Buffer.from(u.hash, 'hex'))) return null;
      return u;
    },

    async clearExpiredBanIfAny(userId) {
      const u = await this.findUserById(userId);
      if (!u || u.banUntilMs == null || u.banUntilMs === BAN_PERMANENT_MS) return;
      const until = Number(u.banUntilMs);
      if (Number.isFinite(until) && until <= Date.now()) {
        await sb.from('skyhop_users').update({ ban_until_ms: null, ban_reason: null }).eq('id', userId);
      }
    },

    async applyBan(userId, banUntilMs, reason) {
      const u = await this.findUserById(userId);
      if (!u) throw new Error('User not found');
      const { error } = await sb
        .from('skyhop_users')
        .update({
          ban_until_ms: banUntilMs,
          ban_reason: reason != null ? String(reason).slice(0, 500) : null,
        })
        .eq('id', userId);
      if (error) throw new Error(error.message);
      await sb.from('skyhop_sessions').delete().eq('user_id', userId);
    },

    async setModeratorRole(userId, isModerator) {
      const u = await this.findUserById(userId);
      if (!u) throw new Error('User not found');
      const own = ownerUsernameLower();
      if (own && u.usernameLower === own) throw new Error('Cannot change owner role.');
      const role = isModerator ? 'moderator' : 'player';
      const { error } = await sb.from('skyhop_users').update({ role }).eq('id', userId);
      if (error) throw new Error(error.message);
    },

    async revokeAllSessionsForUser(userId) {
      await sb.from('skyhop_sessions').delete().eq('user_id', userId);
    },

    async createSession(userId) {
      await pruneSessions();
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
      const { error } = await sb.from('skyhop_sessions').insert({ token, user_id: userId, expires_at: expiresAt });
      if (error) throw new Error(error.message);
      return { token, expiresAt };
    },

    async sessionUserId(token) {
      if (!token) return null;
      await pruneSessions();
      const { data, error } = await sb.from('skyhop_sessions').select('user_id').eq('token', token).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return data.user_id;
    },

    async revokeSession(token) {
      await sb.from('skyhop_sessions').delete().eq('token', token);
    },

    async addRun(userId, timeMs, deaths, source) {
      const t = Math.max(0, Math.min(Number(timeMs) || 0, 48 * 60 * 60 * 1000));
      const d = Math.max(0, Math.min(Math.floor(Number(deaths) || 0), 1_000_000));
      const src = source === 'race' ? 'race' : 'campaign';
      const createdAt = Date.now();
      const { error } = await sb.from('skyhop_runs').insert({
        user_id: userId,
        time_ms: t,
        deaths: d,
        source: src,
        created_at: createdAt,
      });
      if (error) throw new Error(error.message);
    },

    async getRunsForUser(userId) {
      const { data, error } = await sb.from('skyhop_runs').select('user_id, time_ms, deaths, source, created_at').eq('user_id', userId);
      if (error) throw new Error(error.message);
      return (data || []).map(mapRun);
    },

    async getAchievementsForUser(userId) {
      const { data, error } = await sb
        .from('skyhop_user_achievements')
        .select('achievement_id, unlocked_at')
        .eq('user_id', userId);
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({ achievementId: r.achievement_id, unlockedAt: r.unlocked_at }));
    },

    async insertUserAchievements(userId, newDefs) {
      if (!newDefs.length) return;
      const now = Date.now();
      const rows = newDefs.map((d) => ({
        user_id: userId,
        achievement_id: d.id,
        unlocked_at: now,
      }));
      const { error } = await sb.from('skyhop_user_achievements').insert(rows);
      if (error) throw new Error(error.message);
    },

    async createReport(reporterId, reportedUserId, reason) {
      const now = Date.now();
      const { data, error } = await sb
        .from('skyhop_reports')
        .insert({
          reporter_id: reporterId,
          reported_user_id: reportedUserId,
          reason: String(reason || '').slice(0, 4000),
          status: 'pending',
          moderator_note: null,
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      return data.id;
    },

    async countReportsByStatus(status) {
      const { count, error } = await sb
        .from('skyhop_reports')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);
      if (error) throw new Error(error.message);
      return count || 0;
    },

    async listReportsByStatus(status) {
      const { data, error } = await sb.from('skyhop_reports').select('*').eq('status', status).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return (data || []).map((row) => ({
        id: row.id,
        reporterId: row.reporter_id,
        reportedUserId: row.reported_user_id,
        reason: row.reason,
        status: row.status,
        moderatorNote: row.moderator_note,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    },

    async getReportById(reportId) {
      const { data, error } = await sb.from('skyhop_reports').select('*').eq('id', reportId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return {
        id: data.id,
        reporterId: data.reporter_id,
        reportedUserId: data.reported_user_id,
        reason: data.reason,
        status: data.status,
        moderatorNote: data.moderator_note,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      };
    },

    async updateReportStatus(reportId, status, moderatorNote) {
      const now = Date.now();
      const patch = { status, updated_at: now };
      if (moderatorNote != null) patch.moderator_note = String(moderatorNote).slice(0, 2000);
      const { error, data } = await sb.from('skyhop_reports').update(patch).eq('id', reportId).select('id');
      if (error) throw new Error(error.message);
      return !!(data && data.length);
    },

    async listModerators() {
      const { data, error } = await sb
        .from('skyhop_users')
        .select('id, username')
        .eq('role', 'moderator')
        .order('username');
      if (error) throw new Error(error.message);
      return (data || []).map((r) => ({ id: r.id, username: r.username }));
    },
  };
}
