import crypto from 'crypto';
import path from 'path';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { BAN_PERMANENT_MS, ownerUsernameLower } from './moderation.js';
import {
  createSignedAvatarUpload,
  removeUserProfileStorage,
  uploadProfileAvatar,
} from './profile-storage.js';

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
    coins: row.coins != null ? Number(row.coins) : 0,
    skinTexture: row.skin_texture ?? null,
    disabledAt: row.disabled_at != null ? Number(row.disabled_at) : null,
    profileBio: row.profile_bio ?? null,
    profileAvatarPath: row.profile_avatar_path ?? null,
    createdAt: row.created_at != null ? Number(row.created_at) : null,
    campaignWorld1ClearedAt:
      row.campaign_world1_cleared_at != null ? Number(row.campaign_world1_cleared_at) : null,
  };
}

function mapRun(row) {
  return {
    userId: row.user_id,
    timeMs: row.time_ms,
    deaths: row.deaths,
    source: row.source,
    difficulty: row.difficulty ?? null,
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
      const low = String(username || '').trim().toLowerCase();
      const { data, error } = await sb.from('skyhop_users').select('*').eq('username_lower', low).maybeSingle();
      if (error) throw new Error(error.message);
      return mapUser(data);
    },

    async findUserById(id) {
      const { data, error } = await sb.from('skyhop_users').select('*').eq('id', id).maybeSingle();
      if (error) throw new Error(error.message);
      return mapUser(data);
    },

    async setCampaignWorld1ClearedAt(userId, atMs) {
      const at = Math.floor(Number(atMs) || Date.now());
      const { error } = await sb
        .from('skyhop_users')
        .update({ campaign_world1_cleared_at: at })
        .eq('id', userId)
        .is('campaign_world1_cleared_at', null);
      if (error) throw new Error(error.message);
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
          coins: 0,
          skin_texture: null,
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

    async addRun(userId, timeMs, deaths, source, difficulty) {
      const t = Math.max(0, Math.min(Number(timeMs) || 0, 48 * 60 * 60 * 1000));
      const d = Math.max(0, Math.min(Math.floor(Number(deaths) || 0), 1_000_000));
      const src = source === 'race' ? 'race' : 'campaign';
      let diff = null;
      if (src === 'campaign' && difficulty) {
        const low = String(difficulty).toLowerCase();
        if (low === 'easy' || low === 'normal' || low === 'hard') diff = low;
      }
      const createdAt = Date.now();
      const row = {
        user_id: userId,
        time_ms: t,
        deaths: d,
        source: src,
        created_at: createdAt,
      };
      if (diff) row.difficulty = diff;
      const { error } = await sb.from('skyhop_runs').insert(row);
      if (error) throw new Error(error.message);
    },

    async listCampaignLeaderboard(difficulty, limit = 10) {
      const diff = String(difficulty || '').toLowerCase();
      if (diff !== 'easy' && diff !== 'normal' && diff !== 'hard') {
        throw new Error('difficulty must be easy, normal, or hard');
      }
      const cap = Math.max(1, Math.min(50, Math.floor(Number(limit) || 10)));
      const { data, error } = await sb
        .from('skyhop_runs')
        .select('user_id, time_ms, deaths')
        .eq('source', 'campaign')
        .eq('difficulty', diff)
        .order('time_ms', { ascending: true })
        .limit(8000);
      if (error) throw new Error(error.message);
      const best = new Map();
      for (const r of data || []) {
        const uid = Number(r.user_id);
        const tm = Number(r.time_ms);
        const prev = best.get(uid);
        if (!prev || tm < prev.timeMs) {
          best.set(uid, { userId: uid, timeMs: tm, deaths: Number(r.deaths) });
        }
      }
      const sorted = [...best.values()].sort((a, b) => a.timeMs - b.timeMs).slice(0, cap);
      const out = [];
      for (const row of sorted) {
        const u = await this.findUserById(row.userId);
        out.push({
          username: u ? u.username : 'unknown',
          timeMs: row.timeMs,
          deaths: row.deaths,
        });
      }
      return out;
    },

    async listOwnerCampaignLeaderboardEntries(difficulty, limit = 50) {
      const diff = String(difficulty || '').toLowerCase();
      if (diff !== 'easy' && diff !== 'normal' && diff !== 'hard') {
        throw new Error('difficulty must be easy, normal, or hard');
      }
      const cap = Math.max(1, Math.min(50, Math.floor(Number(limit) || 50)));
      const { data, error } = await sb
        .from('skyhop_runs')
        .select('id, user_id, time_ms, deaths')
        .eq('source', 'campaign')
        .eq('difficulty', diff)
        .order('time_ms', { ascending: true })
        .limit(8000);
      if (error) throw new Error(error.message);
      const best = new Map();
      for (const r of data || []) {
        const uid = Number(r.user_id);
        const tm = Number(r.time_ms);
        const prev = best.get(uid);
        if (!prev || tm < prev.timeMs) {
          best.set(uid, { runId: Number(r.id), userId: uid, timeMs: tm, deaths: Number(r.deaths) });
        }
      }
      const sorted = [...best.values()].sort((a, b) => a.timeMs - b.timeMs).slice(0, cap);
      const out = [];
      for (const row of sorted) {
        const u = await this.findUserById(row.userId);
        out.push({
          runId: row.runId,
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
      const { data, error } = await sb
        .from('skyhop_runs')
        .delete()
        .eq('id', id)
        .eq('source', 'campaign')
        .select('id')
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Run not found');
      return { ok: true };
    },

    async countUsersCreatedSince(sinceMs) {
      const since = Number(sinceMs) || 0;
      const { count, error } = await sb
        .from('skyhop_users')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since);
      if (error) throw new Error(error.message);
      return count || 0;
    },

    async getRunsForUser(userId) {
      const { data, error } = await sb
        .from('skyhop_runs')
        .select('user_id, time_ms, deaths, source, difficulty, created_at')
        .eq('user_id', userId);
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

    async incrementUserCoins(userId, delta) {
      const d = Math.floor(Number(delta) || 0);
      if (!d) return;
      const u = await this.findUserById(userId);
      if (!u) throw new Error('User not found');
      const next = Math.max(0, (u.coins != null ? Number(u.coins) : 0) + d);
      const { error } = await sb.from('skyhop_users').update({ coins: next }).eq('id', userId);
      if (error) throw new Error(error.message);
    },

    async setUserSkinTexture(userId, filenameOrNull) {
      const v = filenameOrNull != null ? String(filenameOrNull).slice(0, 120) : null;
      const { error } = await sb.from('skyhop_users').update({ skin_texture: v }).eq('id', userId);
      if (error) throw new Error(error.message);
    },

    async setUserProfile(userId, { bio, avatarPath }) {
      const patch = {};
      if (bio !== undefined) {
        const b = bio == null ? null : String(bio).trim().slice(0, 500);
        patch.profile_bio = b || null;
      }
      if (avatarPath !== undefined) {
        patch.profile_avatar_path = avatarPath == null ? null : String(avatarPath).slice(0, 240);
      }
      if (!Object.keys(patch).length) return;
      const { error } = await sb.from('skyhop_users').update(patch).eq('id', userId);
      if (error) throw new Error(error.message);
    },

    async uploadUserProfileAvatar(userId, buffer, contentType) {
      const path = await uploadProfileAvatar(sb, userId, buffer, contentType);
      await this.setUserProfile(userId, { avatarPath: path });
      return path;
    },

    async createUserProfileSignedAvatarUpload(userId, ext) {
      return createSignedAvatarUpload(sb, userId, ext);
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

    async getBuiltinCampaignStages() {
      const { data, error } = await sb.from('skyhop_builtin_campaign').select('stages').eq('id', 1).maybeSingle();
      if (error) throw new Error(error.message);
      const raw = data?.stages;
      if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
      return raw;
    },

    async setBuiltinCampaignStages(stagesJson) {
      const now = Date.now();
      const { error } = await sb
        .from('skyhop_builtin_campaign')
        .upsert({ id: 1, stages: stagesJson, updated_at: now }, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    },

    async getBuiltinWorld2Stages() {
      const { data, error } = await sb.from('skyhop_builtin_world2').select('stages').eq('id', 1).maybeSingle();
      if (error) throw new Error(error.message);
      const raw = data?.stages;
      if (!raw || !Array.isArray(raw) || !raw.length) return null;
      return raw;
    },

    async setBuiltinWorld2Stages(stagesJson) {
      const now = Date.now();
      const { error } = await sb
        .from('skyhop_builtin_world2')
        .upsert({ id: 1, stages: stagesJson, updated_at: now }, { onConflict: 'id' });
      if (error) throw new Error(error.message);
    },

    async listOnlineCoinClaimIndices(userId, levelId) {
      const { data, error } = await sb
        .from('skyhop_online_coin_claims')
        .select('coin_index')
        .eq('user_id', userId)
        .eq('level_id', levelId);
      if (error) throw new Error(error.message);
      return new Set((data || []).map((r) => Number(r.coin_index)));
    },

    async claimOnlineCoin(userId, levelId, coinIndex) {
      const idx = Math.floor(Number(coinIndex));
      if (idx < 0 || idx > 4096) throw new Error('Invalid coin');
      const now = Date.now();
      const { error } = await sb.from('skyhop_online_coin_claims').insert({
        user_id: userId,
        level_id: levelId,
        coin_index: idx,
        created_at: now,
      });
      if (error) {
        if (error.code === '23505') return false;
        throw new Error(error.message);
      }
      return true;
    },

    async listTextureGrantsForUser(userId) {
      const { data, error } = await sb
        .from('skyhop_user_texture_grants')
        .select('texture_filename')
        .eq('user_id', userId)
        .order('texture_filename');
      if (error) throw new Error(error.message);
      return (data || []).map((r) => r.texture_filename);
    },

    async userHasTextureGrant(userId, filename) {
      const fn = path.basename(String(filename || ''));
      if (!fn) return false;
      const { data, error } = await sb
        .from('skyhop_user_texture_grants')
        .select('user_id')
        .eq('user_id', userId)
        .eq('texture_filename', fn)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return !!data;
    },

    async addTextureGrant(userId, filename) {
      const fn = path.basename(String(filename || ''));
      if (!fn || !/\.(png|webp|gif|jpg|jpeg)$/i.test(fn)) throw new Error('Invalid texture filename.');
      const now = Date.now();
      const { error } = await sb.from('skyhop_user_texture_grants').insert({
        user_id: userId,
        texture_filename: fn,
        created_at: now,
      });
      if (error) {
        if (error.code === '23505') return false;
        throw new Error(error.message);
      }
      return true;
    },

    async removeTextureGrant(userId, filename) {
      const fn = path.basename(String(filename || ''));
      if (!fn) return false;
      const { error } = await sb
        .from('skyhop_user_texture_grants')
        .delete()
        .eq('user_id', userId)
        .eq('texture_filename', fn);
      if (error) throw new Error(error.message);
      return true;
    },

    async transferCoins(fromUserId, toUserId, amount, opts) {
      const amt = Math.floor(Number(amount));
      if (!Number.isFinite(amt) || amt < 1) throw new Error('Invalid amount.');
      const from = await this.findUserById(fromUserId);
      const to = await this.findUserById(toUserId);
      if (!from || !to) throw new Error('User not found.');
      if (opts && opts.skipSenderDebit) {
        const nextTo = Math.max(0, (to.coins != null ? Number(to.coins) : 0) + amt);
        const { error: e2 } = await sb.from('skyhop_users').update({ coins: nextTo }).eq('id', toUserId);
        if (e2) throw new Error(e2.message);
        return;
      }
      const fromBal = from.coins != null ? Number(from.coins) : 0;
      if (fromBal < amt) throw new Error('Insufficient coins.');
      const nextFrom = fromBal - amt;
      const nextTo = Math.max(0, (to.coins != null ? Number(to.coins) : 0) + amt);
      const { error: e1 } = await sb.from('skyhop_users').update({ coins: nextFrom }).eq('id', fromUserId);
      if (e1) throw new Error(e1.message);
      const { error: e2 } = await sb.from('skyhop_users').update({ coins: nextTo }).eq('id', toUserId);
      if (e2) throw new Error(e2.message);
    },

    async createFriendRequest(fromUserId, toUserId) {
      if (fromUserId === toUserId) throw new Error('Cannot send a friend request to yourself.');
      const now = Date.now();
      const { error } = await sb.from('skyhop_friend_requests').insert({
        from_user_id: fromUserId,
        to_user_id: toUserId,
        status: 'pending',
        created_at: now,
      });
      if (error) {
        if (error.code === '23505') throw new Error('Friend request already sent.');
        if (error.message && /skyhop_friend_one_party|duplicate|unique/i.test(error.message))
          throw new Error('Friend request already sent.');
        throw new Error(error.message);
      }
    },

    async acceptFriendRequest(requestId, userId) {
      const { data: row, error: fErr } = await sb
        .from('skyhop_friend_requests')
        .select('id, status, to_user_id')
        .eq('id', requestId)
        .maybeSingle();
      if (fErr) throw new Error(fErr.message);
      if (!row || row.status !== 'pending' || Number(row.to_user_id) !== Number(userId)) {
        throw new Error('Request not found.');
      }
      const { error } = await sb
        .from('skyhop_friend_requests')
        .update({ status: 'accepted' })
        .eq('id', requestId)
        .eq('to_user_id', userId);
      if (error) throw new Error(error.message);
    },

    async declineFriendRequest(requestId, userId) {
      const { error } = await sb
        .from('skyhop_friend_requests')
        .delete()
        .eq('id', requestId)
        .eq('to_user_id', userId)
        .eq('status', 'pending');
      if (error) throw new Error(error.message);
    },

    async areFriends(userIdA, userIdB) {
      if (userIdA === userIdB) return false;
      const a = Number(userIdA);
      const b = Number(userIdB);
      const { data: d1, error: e1 } = await sb
        .from('skyhop_friend_requests')
        .select('id')
        .eq('status', 'accepted')
        .eq('from_user_id', a)
        .eq('to_user_id', b)
        .limit(1);
      if (e1) throw new Error(e1.message);
      if (d1 && d1.length) return true;
      const { data: d2, error: e2 } = await sb
        .from('skyhop_friend_requests')
        .select('id')
        .eq('status', 'accepted')
        .eq('from_user_id', b)
        .eq('to_user_id', a)
        .limit(1);
      if (e2) throw new Error(e2.message);
      return !!(d2 && d2.length);
    },

    async listFriendsBundle(userId) {
      const uid = Number(userId);
      const { data: rows, error } = await sb
        .from('skyhop_friend_requests')
        .select('id, from_user_id, to_user_id, status, created_at')
        .or(`from_user_id.eq.${uid},to_user_id.eq.${uid}`);
      if (error) throw new Error(error.message);
      const incoming = [];
      const outgoing = [];
      const needIds = new Set();
      for (const r of rows || []) {
        const fromId = Number(r.from_user_id);
        const toId = Number(r.to_user_id);
        if (r.status === 'pending') {
          if (toId === uid) {
            needIds.add(fromId);
            incoming.push({ id: r.id, fromUserId: fromId, fromUsername: '', createdAt: r.created_at });
          } else if (fromId === uid) {
            needIds.add(toId);
            outgoing.push({ id: r.id, toUserId: toId, toUsername: '', createdAt: r.created_at });
          }
        } else if (r.status === 'accepted') {
          needIds.add(fromId === uid ? toId : fromId);
        }
      }
      const ids = [...needIds];
      const nameMap = new Map();
      if (ids.length) {
        const { data: users, error: uErr } = await sb.from('skyhop_users').select('id, username').in('id', ids);
        if (uErr) throw new Error(uErr.message);
        for (const u of users || []) nameMap.set(Number(u.id), u.username);
      }
      const friendsOut = [];
      const seen = new Set();
      for (const r of rows || []) {
        if (r.status !== 'accepted') continue;
        const fromId = Number(r.from_user_id);
        const toId = Number(r.to_user_id);
        const other = fromId === uid ? toId : fromId;
        if (seen.has(other)) continue;
        seen.add(other);
        friendsOut.push({ userId: other, username: nameMap.get(other) || 'unknown' });
      }
      friendsOut.sort((a, b) => a.username.localeCompare(b.username));
      for (const x of incoming) x.fromUsername = nameMap.get(x.fromUserId) || 'unknown';
      for (const x of outgoing) x.toUsername = nameMap.get(x.toUserId) || 'unknown';
      return { friends: friendsOut, incoming, outgoing };
    },

    async countIncomingPendingFriendRequests(userId) {
      const { count, error } = await sb
        .from('skyhop_friend_requests')
        .select('id', { count: 'exact', head: true })
        .eq('to_user_id', userId)
        .eq('status', 'pending');
      if (error) throw new Error(error.message);
      return count != null ? Number(count) : 0;
    },

    async setUserDisabled(userId, disabled) {
      const v = disabled ? Date.now() : null;
      const { error } = await sb.from('skyhop_users').update({ disabled_at: v }).eq('id', userId);
      if (error) throw new Error(error.message);
    },

    async deleteUserPermanently(userId) {
      try {
        await removeUserProfileStorage(sb, userId);
      } catch {
        /* */
      }
      try {
        const { recordingsDeleteAllForUser } = await import('./recordings.js');
        await recordingsDeleteAllForUser(userId);
      } catch {
        /* */
      }
      const { error: lvlErr } = await sb.from('skyhop_user_levels').delete().eq('author_id', userId);
      if (lvlErr) throw new Error(lvlErr.message);
      const { error } = await sb.from('skyhop_users').delete().eq('id', userId);
      if (error) throw new Error(error.message);
    },

    async insertFriendChatMessage(fromUserId, toUserId, body) {
      const id = crypto.randomUUID();
      const now = Date.now();
      const { error } = await sb.from('skyhop_friend_chat').insert({
        id,
        from_user_id: fromUserId,
        to_user_id: toUserId,
        body: String(body || '').slice(0, 2000),
        created_at: now,
      });
      if (error) throw new Error(error.message);
      return { id, fromUserId, toUserId, body: String(body || '').slice(0, 2000), createdAt: now };
    },

    async listFriendChatMessages(userId, friendUserId, sinceMs) {
      const since = Number(sinceMs) || 0;
      const { data, error } = await sb
        .from('skyhop_friend_chat')
        .select('id, from_user_id, to_user_id, body, created_at')
        .gt('created_at', since)
        .or(
          `and(from_user_id.eq.${userId},to_user_id.eq.${friendUserId}),and(from_user_id.eq.${friendUserId},to_user_id.eq.${userId})`
        )
        .order('created_at', { ascending: true })
        .limit(200);
      if (error) throw new Error(error.message);
      return (data || []).map((m) => ({
        id: m.id,
        fromUserId: Number(m.from_user_id),
        toUserId: Number(m.to_user_id),
        body: m.body,
        createdAt: Number(m.created_at),
        mine: Number(m.from_user_id) === userId,
      }));
    },
  };
}
