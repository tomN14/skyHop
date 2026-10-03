import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { displayRole, effectiveRole } from './moderation.js';
import { censorProfanity } from './profanity-filter.js';

function censoredTitle(title) {
  const out = censorProfanity(String(title || '')).text.trim().slice(0, 80);
  if (!out) throw new Error('Title required');
  return out;
}

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
    const empty = { levels: [], awardedClears: [] };
    fs.writeFileSync(LEVELS_PATH, JSON.stringify(empty), 'utf8');
    return empty;
  }
  try {
    const j = JSON.parse(fs.readFileSync(LEVELS_PATH, 'utf8'));
    if (!Array.isArray(j.levels)) j.levels = [];
    if (!Array.isArray(j.awardedClears)) j.awardedClears = [];
    return j;
  } catch {
    return { levels: [] };
  }
}

function fileSave(db) {
  fs.writeFileSync(LEVELS_PATH, JSON.stringify(db), 'utf8');
}

function copyAllowed(row) {
  return !row || row.allow_copy !== false;
}

async function selectLevelRows(sb, baseColumns, selectOpts, configure) {
  const run = async (cols) => {
    let q = sb.from('skyhop_user_levels').select(cols, selectOpts || undefined);
    if (configure) q = configure(q);
    return q;
  };
  let res = await run(baseColumns + ', allow_copy');
  if (res.error && /allow_copy/i.test(String(res.error.message))) {
    res = await run(baseColumns);
  }
  if (res.error) throw new Error(res.error.message);
  return res;
}

function userIsModerator(u) {
  const role = u ? effectiveRole(u) : 'player';
  return role === 'moderator' || role === 'mod_admin';
}

function authorRoleOf(u) {
  return u ? displayRole(effectiveRole(u)) : 'player';
}

/** Adds author_username and author_is_moderator for rows with author_id. */
async function enrichAuthorMeta(items) {
  if (!items || !items.length) return items;
  const { store } = await import('./store.js');
  const ids = [...new Set(items.map((i) => i.author_id).filter((x) => x != null))];
  const nameMap = new Map();
  const modMap = new Map();
  const roleMap = new Map();
  for (const id of ids) {
    const u = await store.findUserById(id);
    if (u) {
      if (u.username) nameMap.set(id, u.username);
      modMap.set(id, userIsModerator(u));
      roleMap.set(id, authorRoleOf(u));
    }
  }
  return items.map((i) => {
    if (i.author_id == null) return i;
    const out = { ...i };
    if (out.author_username == null && nameMap.has(i.author_id)) out.author_username = nameMap.get(i.author_id);
    out.author_is_moderator = !!modMap.get(i.author_id);
    out.author_role = roleMap.get(i.author_id) || 'player';
    return out;
  });
}

/* ---------- exports ---------- */

export async function levelsCreate(userId, title, data, allowCopy) {
  const clean = validateLevelData(data);
  const t = censoredTitle(title);
  const now = Date.now();
  const allow = allowCopy !== false;

  if (useSupabase()) {
    const sb = sbClient();
    const rowBody = {
      author_id: userId,
      title: t,
      title_lower: t.toLowerCase(),
      data: clean,
      play_count: 0,
      beaten_verified: false,
      published: false,
      created_at: now,
      allow_copy: allow,
    };
    let { data: row, error } = await sb.from('skyhop_user_levels').insert(rowBody).select('id').single();
    if (error && /allow_copy/i.test(error.message)) {
      delete rowBody.allow_copy;
      ({ data: row, error } = await sb.from('skyhop_user_levels').insert(rowBody).select('id').single());
    }
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
    allow_copy: allow,
    created_at: now,
  });
  fileSave(db);
  return { id };
}

export async function levelsUpdateDraft(userId, levelId, title, data, allowCopy) {
  const clean = validateLevelData(data);
  const t = censoredTitle(title);

  if (useSupabase()) {
    const sb = sbClient();
    const { data: rows, error: e1 } = await sb.from('skyhop_user_levels').select('author_id, published').eq('id', levelId).maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!rows || rows.author_id !== userId) throw new Error('Not found');
    if (rows.published) throw new Error('Cannot edit published level');
    const patch = {
      title: t,
      title_lower: t.toLowerCase(),
      data: clean,
      beaten_verified: false,
    };
    if (allowCopy === true || allowCopy === false) patch.allow_copy = allowCopy;
    let { error } = await sb.from('skyhop_user_levels').update(patch).eq('id', levelId);
    if (error && patch.allow_copy != null && /allow_copy/i.test(error.message)) {
      if (patch.allow_copy === false) {
        throw new Error('Run extend_v28_level_copy.sql in Supabase, then try again.');
      }
      delete patch.allow_copy;
      ({ error } = await sb.from('skyhop_user_levels').update(patch).eq('id', levelId));
    }
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
  if (allowCopy === true || allowCopy === false) row.allow_copy = allowCopy;
  fileSave(db);
  return { ok: true };
}

export async function levelsSetAllowCopy(userId, levelId, allow) {
  const on = !!allow;
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: e1 } = await sb
      .from('skyhop_user_levels')
      .select('author_id')
      .eq('id', levelId)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!row || row.author_id !== userId) throw new Error('Not found');
    const { error } = await sb.from('skyhop_user_levels').update({ allow_copy: on }).eq('id', levelId);
    if (error) {
      if (/allow_copy/i.test(error.message)) {
        throw new Error('Run extend_v28_level_copy.sql in Supabase, then try again.');
      }
      throw new Error(error.message);
    }
    return { ok: true, allowCopy: on };
  }
  const db = fileLoad();
  const row = db.levels.find((L) => L.id === levelId);
  if (!row || row.author_id !== userId) throw new Error('Not found');
  row.allow_copy = on;
  fileSave(db);
  return { ok: true, allowCopy: on };
}

/** Copy every level the source authored onto another account. Source rows stay. */
export async function duplicateOwnedLevels(fromUserId, toUserId) {
  let rows = [];
  if (useSupabase()) {
    const sb = sbClient();
    let res = await sb
      .from('skyhop_user_levels')
      .select('title, data, published, beaten_verified, allow_copy')
      .eq('author_id', fromUserId);
    if (res.error && /allow_copy/i.test(String(res.error.message))) {
      res = await sb
        .from('skyhop_user_levels')
        .select('title, data, published, beaten_verified')
        .eq('author_id', fromUserId);
    }
    if (res.error) throw new Error(res.error.message);
    rows = res.data || [];
  } else {
    rows = fileLoad().levels.filter((L) => L.author_id === fromUserId);
  }
  let n = 0;
  for (const row of rows) {
    if (!row || !row.data) continue;
    try {
      const created = await levelsCreate(toUserId, row.title, row.data, copyAllowed(row));
      if (row.beaten_verified) await levelsMarkBeaten(toUserId, created.id);
      if (row.published && row.beaten_verified) await levelsPublish(toUserId, created.id);
      n += 1;
    } catch {
      /* leave a level that no longer validates on the source only */
    }
  }
  return n;
}

export async function levelsCopy(userId, levelId) {
  let row = null;
  if (useSupabase()) {
    const sb = sbClient();
    let res = await sb
      .from('skyhop_user_levels')
      .select('id, title, data, published, allow_copy')
      .eq('id', levelId)
      .maybeSingle();
    if (res.error && /allow_copy/i.test(String(res.error.message))) {
      res = await sb.from('skyhop_user_levels').select('id, title, data, published').eq('id', levelId).maybeSingle();
    }
    if (res.error) throw new Error(res.error.message);
    row = res.data;
  } else {
    row = fileLoad().levels.find((L) => L.id === levelId) || null;
  }
  if (!row || !row.published) throw new Error('Only published levels can be copied.');
  if (!copyAllowed(row)) throw new Error('The creator turned off copying for this level.');
  const title = censoredTitle('Copy of ' + row.title);
  const created = await levelsCreate(userId, title, row.data, true);
  return { id: created.id, title };
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

export async function levelsDeleteOwned(userId, levelId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: e1 } = await sb
      .from('skyhop_user_levels')
      .select('author_id')
      .eq('id', levelId)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!row || row.author_id !== userId) throw new Error('Not found');
    const { error } = await sb.from('skyhop_user_levels').delete().eq('id', levelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  const db = fileLoad();
  const idx = db.levels.findIndex((L) => L.id === levelId);
  if (idx < 0 || db.levels[idx].author_id !== userId) throw new Error('Not found');
  db.levels.splice(idx, 1);
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
    const res = await selectLevelRows(
      sb,
      'id, title, published, beaten_verified, play_count, created_at',
      null,
      (q) => q.eq('author_id', userId).order('created_at', { ascending: false })
    );
    return (res.data || []).map((row) => Object.assign({}, row, { allow_copy: copyAllowed(row) }));
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
      allow_copy: copyAllowed(L),
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
    const res = await selectLevelRows(sb, 'id, title, play_count, author_id, published, awarded', null, (q) =>
      q.eq('id', idStr).maybeSingle()
    );
    const row = res.data;
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
      author_role: authorRoleOf(userRow),
      awarded: !!row.awarded,
      allow_copy: copyAllowed(row),
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
    author_role: authorRoleOf(u),
    awarded: !!row.awarded,
    allow_copy: copyAllowed(row),
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
      allowCopy: copyAllowed(row),
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
    allowCopy: copyAllowed(row),
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
    if (!user) return { items: [], total: 0, page: p, author_is_moderator: false, author_role: 'player' };
    const author_is_moderator = userIsModerator(user);
    const author_role = authorRoleOf(user);
    const res = await selectLevelRows(sb, 'id, title, play_count, awarded', { count: 'exact' }, (q) =>
      q.eq('author_id', user.id).eq('published', true).order('created_at', { ascending: false }).range(off, off + PAGE_SIZE - 1)
    );
    const items = (res.data || []).map((row) => Object.assign({}, row, { allow_copy: copyAllowed(row) }));
    return { items, total: res.count || 0, page: p, author_is_moderator, author_role };
  }

  const db = fileLoad();
  const { store } = await import('./store.js');
  const u = await store.findUserByUsername(usernameLower);
  if (!u) return { items: [], total: 0, page: p, author_is_moderator: false, author_role: 'player' };
  const author_is_moderator = userIsModerator(u);
  const author_role = authorRoleOf(u);
  const all = db.levels.filter((L) => L.author_id === u.id && L.published);
  const total = all.length;
  const items = all
    .sort((a, b) => b.created_at - a.created_at)
    .slice(off, off + PAGE_SIZE)
    .map((L) => ({ id: L.id, title: L.title, play_count: L.play_count, awarded: !!L.awarded, allow_copy: copyAllowed(L) }));
  return { items, total, page: p, author_is_moderator, author_role };
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
    const res = await selectLevelRows(sb, 'id, title, play_count, author_id, awarded', null, (q) =>
      q.eq('published', true).ilike('title_lower', like).order('play_count', { ascending: false }).range(off, off + PAGE_SIZE - 1)
    );
    const enriched = await enrichAuthorMeta(
      (res.data || []).map((row) => Object.assign({}, row, { allow_copy: copyAllowed(row) }))
    );
    return { items: enriched, total: count || 0, page: p };
  }

  const db = fileLoad();
  const all = db.levels.filter((L) => L.published && L.title_lower.includes(term));
  all.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  const total = all.length;
  const slice = all
    .slice(off, off + PAGE_SIZE)
    .map((L) => ({ id: L.id, title: L.title, play_count: L.play_count, author_id: L.author_id, awarded: !!L.awarded, allow_copy: copyAllowed(L) }));
  const enriched = await enrichAuthorMeta(slice);
  return { items: enriched, total, page: p };
}

async function authorIsSiteOwner(authorId) {
  const { store } = await import('./store.js');
  const u = await store.findUserById(authorId);
  return effectiveRole(u) === 'owner';
}

export async function levelsStaffListForAuthor(authorId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb
      .from('skyhop_user_levels')
      .select('id, title, published, beaten_verified, play_count, created_at')
      .eq('author_id', authorId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }
  const db = fileLoad();
  return db.levels
    .filter((L) => L.author_id === authorId)
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

export async function levelsStaffGetById(levelId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error } = await sb.from('skyhop_user_levels').select('*').eq('id', levelId).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) return null;
    return {
      id: row.id,
      title: row.title,
      authorId: row.author_id,
      data: row.data,
      playCount: row.play_count,
      published: row.published,
      beatenVerified: !!row.beaten_verified,
      allowCopy: copyAllowed(row),
    };
  }
  const db = fileLoad();
  const row = db.levels.find((L) => L.id === levelId);
  if (!row) return null;
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

export async function levelsStaffUpdate(levelId, title, data) {
  const row = await levelsStaffGetById(levelId);
  if (!row) throw new Error('Level not found');
  if (await authorIsSiteOwner(row.authorId)) throw new Error('Site owner levels cannot be edited.');
  const clean = validateLevelData(data);
  const t = censoredTitle(title);

  if (useSupabase()) {
    const sb = sbClient();
    const { error } = await sb
      .from('skyhop_user_levels')
      .update({ title: t, title_lower: t.toLowerCase(), data: clean })
      .eq('id', levelId);
    if (error) throw new Error(error.message);
    return { ok: true, title: t };
  }
  const db = fileLoad();
  const L = db.levels.find((x) => x.id === levelId);
  if (!L) throw new Error('Level not found');
  L.title = t;
  L.title_lower = t.toLowerCase();
  L.data = clean;
  fileSave(db);
  return { ok: true, title: t };
}

export async function levelsStaffDelete(levelId) {
  const row = await levelsStaffGetById(levelId);
  if (!row) throw new Error('Level not found');
  if (await authorIsSiteOwner(row.authorId)) throw new Error('Site owner levels cannot be deleted.');

  if (useSupabase()) {
    const sb = sbClient();
    const { error } = await sb.from('skyhop_user_levels').delete().eq('id', levelId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  const db = fileLoad();
  const idx = db.levels.findIndex((L) => L.id === levelId);
  if (idx < 0) throw new Error('Level not found');
  db.levels.splice(idx, 1);
  fileSave(db);
  return { ok: true };
}

const CREATOR_AWARD_COINS = 300;
const CLEAR_AWARD_COINS = 25;

export async function levelsAward(levelId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: readErr } = await sb
      .from('skyhop_user_levels')
      .select('id, author_id, published, awarded, award_paid')
      .eq('id', levelId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row || !row.published) throw new Error('Published level not found');
    if (row.awarded) return { already: true, coins: 0 };
    const pay = !row.award_paid;
    const { data: updated, error } = await sb
      .from('skyhop_user_levels')
      .update({ awarded: true, award_paid: true })
      .eq('id', levelId)
      .eq('awarded', false)
      .select('author_id');
    if (error) throw new Error(error.message);
    if (!updated || !updated.length) return { already: true, coins: 0 };
    if (!pay) return { already: false, coins: 0 };
    const { store } = await import('./store.js');
    await store.incrementUserCoins(updated[0].author_id, CREATOR_AWARD_COINS);
    return { already: false, coins: CREATOR_AWARD_COINS };
  }
  const db = fileLoad();
  const row = db.levels.find((L) => L.id === levelId);
  if (!row || !row.published) throw new Error('Published level not found');
  if (row.awarded) return { already: true, coins: 0 };
  const pay = !row.award_paid;
  row.awarded = true;
  row.award_paid = true;
  fileSave(db);
  if (!pay) return { already: false, coins: 0 };
  const { store } = await import('./store.js');
  await store.incrementUserCoins(row.author_id, CREATOR_AWARD_COINS);
  return { already: false, coins: CREATOR_AWARD_COINS };
}

export async function levelsUnaward(levelId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: readErr } = await sb
      .from('skyhop_user_levels')
      .select('id, awarded')
      .eq('id', levelId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row) throw new Error('Level not found');
    if (!row.awarded) return { removed: false };
    const { data: updated, error } = await sb
      .from('skyhop_user_levels')
      .update({ awarded: false })
      .eq('id', levelId)
      .eq('awarded', true)
      .select('id');
    if (error) throw new Error(error.message);
    return { removed: !!(updated && updated.length) };
  }
  const db = fileLoad();
  const row = db.levels.find((L) => L.id === levelId);
  if (!row) throw new Error('Level not found');
  if (!row.awarded) return { removed: false };
  row.awarded = false;
  fileSave(db);
  return { removed: true };
}

export async function levelsListAwarded(page) {
  const p = Math.max(1, Math.floor(Number(page) || 1));
  const off = (p - 1) * PAGE_SIZE;
  if (useSupabase()) {
    const sb = sbClient();
    const { count } = await sb
      .from('skyhop_user_levels')
      .select('id', { count: 'exact', head: true })
      .eq('published', true)
      .eq('awarded', true);
    const res = await selectLevelRows(sb, 'id, title, play_count, author_id, awarded', null, (q) =>
      q.eq('published', true).eq('awarded', true).order('play_count', { ascending: false }).range(off, off + PAGE_SIZE - 1)
    );
    const enriched = await enrichAuthorMeta(
      (res.data || []).map((row) => Object.assign({}, row, { allow_copy: copyAllowed(row) }))
    );
    return { items: enriched, total: count || 0, page: p };
  }
  const db = fileLoad();
  const all = db.levels.filter((L) => L.published && L.awarded);
  all.sort((a, b) => (b.play_count || 0) - (a.play_count || 0));
  const slice = all.slice(off, off + PAGE_SIZE).map((L) => ({
    id: L.id,
    title: L.title,
    play_count: L.play_count,
    author_id: L.author_id,
    awarded: true,
    allow_copy: copyAllowed(L),
  }));
  const enriched = await enrichAuthorMeta(slice);
  return { items: enriched, total: all.length, page: p };
}

export async function levelsClaimClearReward(userId, levelId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: readErr } = await sb
      .from('skyhop_user_levels')
      .select('id, published, awarded')
      .eq('id', levelId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);
    if (!row || !row.published || !row.awarded) return { coins: 0, already: false };
    const { error } = await sb.from('skyhop_awarded_clears').insert({
      user_id: userId,
      level_id: levelId,
      created_at: Date.now(),
    });
    if (error) {
      if (error.code === '23505') return { coins: 0, already: true };
      throw new Error(error.message);
    }
    const { store } = await import('./store.js');
    await store.incrementUserCoins(userId, CLEAR_AWARD_COINS);
    return { coins: CLEAR_AWARD_COINS, already: false };
  }
  const db = fileLoad();
  const row = db.levels.find((L) => L.id === levelId);
  if (!row || !row.published || !row.awarded) return { coins: 0, already: false };
  if (!Array.isArray(db.awardedClears)) db.awardedClears = [];
  if (db.awardedClears.some((c) => c.user_id === userId && c.level_id === levelId)) {
    return { coins: 0, already: true };
  }
  db.awardedClears.push({ user_id: userId, level_id: levelId, created_at: Date.now() });
  fileSave(db);
  const { store } = await import('./store.js');
  await store.incrementUserCoins(userId, CLEAR_AWARD_COINS);
  return { coins: CLEAR_AWARD_COINS, already: false };
}

export async function levelPickupCoinsCount(levelId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb
      .from('skyhop_user_levels')
      .select('published, awarded')
      .eq('id', levelId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return !!(data && data.published && data.awarded);
  }
  const row = fileLoad().levels.find((L) => L.id === levelId);
  return !!(row && row.published && row.awarded);
}
