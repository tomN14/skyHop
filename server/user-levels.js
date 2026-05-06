import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LEVELS_PATH = path.join(__dirname, 'data', 'user_levels.json');
const PAGE_SIZE = 12;
const MAX_DATA_BYTES = 120000;

function useSupabase() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

let _sb = null;
function sbClient() {
  if (!_sb && useSupabase()) {
    _sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { transport: WebSocket },
    });
  }
  return _sb;
}

function validateLevelData(data) {
  if (!data || typeof data !== 'object') throw new Error('Invalid level data');
  const w = Number(data.worldW);
  const h = Number(data.worldH);
  if (!Number.isFinite(w) || w < 400 || w > 8000) throw new Error('worldW out of range');
  if (!Number.isFinite(h) || h < 300 || h > 4000) throw new Error('worldH out of range');
  if (!data.spawn || !data.goal) throw new Error('spawn and goal required');
  const raw = JSON.stringify(data);
  if (raw.length > MAX_DATA_BYTES) throw new Error('Level too large');
  return JSON.parse(raw);
}

/* ---------- file backend ---------- */

function fileLoad() {
  const dir = path.dirname(LEVELS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LEVELS_PATH)) {
    const empty = { levels: [] };
    fs.writeFileSync(LEVELS_PATH, JSON.stringify(empty), 'utf8');
    return empty;
  }
  try {
    const j = JSON.parse(fs.readFileSync(LEVELS_PATH, 'utf8'));
    if (!Array.isArray(j.levels)) j.levels = [];
    return j;
  } catch {
    return { levels: [] };
  }
}

function fileSave(db) {
  fs.writeFileSync(LEVELS_PATH, JSON.stringify(db), 'utf8');
}

function userIsModerator(u) {
  return !!(u && u.role === 'moderator');
}

/** Adds author_username and author_is_moderator for rows with author_id. */
async function enrichAuthorMeta(items) {
  if (!items || !items.length) return items;
  const { store } = await import('./store.js');
  const ids = [...new Set(items.map((i) => i.author_id).filter((x) => x != null))];
  const nameMap = new Map();
  const modMap = new Map();
  for (const id of ids) {
    const u = await store.findUserById(id);
    if (u) {
      if (u.username) nameMap.set(id, u.username);
      modMap.set(id, userIsModerator(u));
    }
  }
  return items.map((i) => {
    if (i.author_id == null) return i;
    const out = { ...i };
    if (out.author_username == null && nameMap.has(i.author_id)) out.author_username = nameMap.get(i.author_id);
    out.author_is_moderator = !!modMap.get(i.author_id);
    return out;
  });
}

/* ---------- exports ---------- */

export async function levelsCreate(userId, title, data) {
  const clean = validateLevelData(data);
  const t = String(title || '').trim().slice(0, 80);
  if (t.length < 1) throw new Error('Title required');
  const now = Date.now();

  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error } = await sb
      .from('skyhop_user_levels')
      .insert({
        author_id: userId,
        title: t,
        title_lower: t.toLowerCase(),
        data: clean,
        play_count: 0,
        beaten_verified: false,
        published: false,
        created_at: now,
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  }

  const db = fileLoad();
  const id = crypto.randomUUID();
  db.levels.push({
    id,
    author_id: userId,
    title: t,
    title_lower: t.toLowerCase(),
    data: clean,
    play_count: 0,
    beaten_verified: false,
    published: false,
    created_at: now,
  });
  fileSave(db);
  return { id };
}

export async function levelsUpdateDraft(userId, levelId, title, data) {
  const clean = validateLevelData(data);
  const t = String(title || '').trim().slice(0, 80);
  if (t.length < 1) throw new Error('Title required');

  if (useSupabase()) {
    const sb = sbClient();
    const { data: rows, error: e1 } = await sb.from('skyhop_user_levels').select('author_id, published').eq('id', levelId).maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!rows || rows.author_id !== userId) throw new Error('Not found');
    if (rows.published) throw new Error('Cannot edit published level');
    const { error } = await sb
      .from('skyhop_user_levels')
      .update({
        title: t,
        title_lower: t.toLowerCase(),
        data: clean,
        beaten_verified: false,
      })
      .eq('id', levelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  const db = fileLoad();
  const row = db.levels.find((L) => L.id === levelId);
  if (!row || row.author_id !== userId) throw new Error('Not found');
  if (row.published) throw new Error('Cannot edit published level');
  row.title = t;
  row.title_lower = t.toLowerCase();
  row.data = clean;
  row.beaten_verified = false;
  fileSave(db);
  return { ok: true };
}

export async function levelsMarkBeaten(userId, levelId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row } = await sb.from('skyhop_user_levels').select('author_id').eq('id', levelId).maybeSingle();
    if (!row || row.author_id !== userId) throw new Error('Not found');
    const { error } = await sb.from('skyhop_user_levels').update({ beaten_verified: true }).eq('id', levelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  const db = fileLoad();
  const row = db.levels.find((L) => L.id === levelId);
  if (!row || row.author_id !== userId) throw new Error('Not found');
  row.beaten_verified = true;
  fileSave(db);
  return { ok: true };
}

export async function levelsPublish(userId, levelId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row } = await sb
      .from('skyhop_user_levels')
      .select('author_id, beaten_verified, published')
      .eq('id', levelId)
      .maybeSingle();
    if (!row || row.author_id !== userId) throw new Error('Not found');
    if (!row.beaten_verified) throw new Error('Beat this level in test play before publishing');
    if (row.published) return { ok: true };
    const { error } = await sb.from('skyhop_user_levels').update({ published: true }).eq('id', levelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  const db = fileLoad();
  const row = db.levels.find((L) => L.id === levelId);
  if (!row || row.author_id !== userId) throw new Error('Not found');
  if (!row.beaten_verified) throw new Error('Beat this level in test play before publishing');
  row.published = true;
  fileSave(db);
  return { ok: true };
}

export async function levelsMine(userId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb
      .from('skyhop_user_levels')
      .select('id, title, published, beaten_verified, play_count, created_at')
      .eq('author_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }
  const db = fileLoad();
  return db.levels
    .filter((L) => L.author_id === userId)
    .sort((a, b) => b.created_at - a.created_at)
    .map((L) => ({
      id: L.id,
      title: L.title,
      published: L.published,
      beaten_verified: L.beaten_verified,
      play_count: L.play_count,
      created_at: L.created_at,
    }));
}

/** Published level metadata for ID search (no full `data` payload). */
export async function levelsPublishedMetaById(id) {
  const idStr = String(id || '').trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idStr)
  ) {
    return null;
  }

  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error } = await sb
      .from('skyhop_user_levels')
      .select('id, title, play_count, author_id, published')
      .eq('id', idStr)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row || !row.published) return null;
    const { data: userRow } = await sb
      .from('skyhop_users')
      .select('username, role')
      .eq('id', row.author_id)
      .maybeSingle();
    return {
      id: row.id,
      title: row.title,
      play_count: row.play_count,
      author_id: row.author_id,
      author_username: userRow?.username || null,
      author_is_moderator: userIsModerator(userRow),
    };
  }

  const db = fileLoad();
  const row = db.levels.find((L) => L.id === idStr);
  if (!row || !row.published) return null;
  const { store } = await import('./store.js');
  const u = await store.findUserById(row.author_id);
  return {
    id: row.id,
    title: row.title,
    play_count: row.play_count,
    author_id: row.author_id,
    author_username: u?.username || null,
    author_is_moderator: userIsModerator(u),
  };
}

export async function levelsGetById(id, viewerUserId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error } = await sb.from('skyhop_user_levels').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    const isOwner = viewerUserId != null && row.author_id === viewerUserId;
    if (!row.published && !isOwner) return null;
    return {
      id: row.id,
      title: row.title,
      authorId: row.author_id,
      data: row.data,
      playCount: row.play_count,
      published: row.published,
      beatenVerified: !!row.beaten_verified,
    };
  }
  const db = fileLoad();
  const row = db.levels.find((L) => L.id === id);
  if (!row) return null;
  const isOwner = viewerUserId != null && row.author_id === viewerUserId;
  if (!row.published && !isOwner) return null;
  return {
    id: row.id,
    title: row.title,
    authorId: row.author_id,
    data: row.data,
    playCount: row.play_count,
    published: row.published,
    beatenVerified: !!row.beaten_verified,
  };
}

export async function levelsRecordPlay(id) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row } = await sb.from('skyhop_user_levels').select('play_count, published').eq('id', id).maybeSingle();
    if (!row || !row.published) return;
    await sb.from('skyhop_user_levels').update({ play_count: row.play_count + 1 }).eq('id', id);
    return;
  }
  const db = fileLoad();
  const row = db.levels.find((L) => L.id === id);
  if (!row || !row.published) return;
  row.play_count = (row.play_count || 0) + 1;
  fileSave(db);
}

export async function levelsListByUsername(usernameLower, page) {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const off = (p - 1) * PAGE_SIZE;

  if (useSupabase()) {
    const sb = sbClient();
    const { data: user } = await sb.from('skyhop_users').select('id, role').eq('username_lower', usernameLower).maybeSingle();
    if (!user) return { items: [], total: 0, page: p, author_is_moderator: false };
    const author_is_moderator = userIsModerator(user);
    const q = sb
      .from('skyhop_user_levels')
      .select('id, title, play_count', { count: 'exact' })
      .eq('author_id', user.id)
      .eq('published', true)
      .order('created_at', { ascending: false })
      .range(off, off + PAGE_SIZE - 1);
    const { data, count, error } = await q;
    if (error) throw new Error(error.message);
    return { items: data || [], total: count || 0, page: p, author_is_moderator };
  }

  const db = fileLoad();
  const { store } = await import('./store.js');
  const u = await store.findUserByUsername(usernameLower);
  if (!u) return { items: [], total: 0, page: p, author_is_moderator: false };
  const author_is_moderator = userIsModerator(u);
  const all = db.levels.filter((L) => L.author_id === u.id && L.published);
  const total = all.length;
  const items = all
    .sort((a, b) => b.created_at - a.created_at)
    .slice(off, off + PAGE_SIZE)
    .map((L) => ({ id: L.id, title: L.title, play_count: L.play_count }));
  return { items, total, page: p, author_is_moderator };
}

export async function levelsSearchName(q, page) {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const off = (p - 1) * PAGE_SIZE;
  const term = String(q || '').trim().toLowerCase();
  if (term.length < 1) return { items: [], total: 0, page: p };

  if (useSupabase()) {
    const sb = sbClient();
    const like = `%${term.replace(/%/g, '')}%`;
    const { count } = await sb.from('skyhop_user_levels').select('id', { count: 'exact', head: true }).eq('published', true).ilike('title_lower', like);
    const { data, error } = await sb
      .from('skyhop_user_levels')
      .select('id, title, play_count, author_id')
      .eq('published', true)
      .ilike('title_lower', like)
      .order('play_count', { ascending: false })
      .range(off, off + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const enriched = await enrichAuthorMeta(data || []);
    return { items: enriched, total: count || 0, page: p };
  }

  const db = fileLoad();
  const all = db.levels.filter((L) => L.published && L.title_lower.includes(term));
  all.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  const total = all.length;
  const slice = all
    .slice(off, off + PAGE_SIZE)
    .map((L) => ({ id: L.id, title: L.title, play_count: L.play_count, author_id: L.author_id }));
  const enriched = await enrichAuthorMeta(slice);
  return { items: enriched, total, page: p };
}
