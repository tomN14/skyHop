import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, 'data', 'user_mods_index.json');
const FILES_DIR = path.join(__dirname, 'data', 'user_mods_files');

export const USER_MODS_BUCKET = 'skyhop-user-mods';
export const MAX_USER_MOD_BYTES = 5 * 1024 * 1024;

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

function fileLoadIndex() {
  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_PATH)) {
    const empty = { mods: [] };
    fs.writeFileSync(INDEX_PATH, JSON.stringify(empty), 'utf8');
    return empty;
  }
  try {
    const j = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (!Array.isArray(j.mods)) j.mods = [];
    return j;
  } catch {
    return { mods: [] };
  }
}

function fileSaveIndex(db) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(db), 'utf8');
}

function storagePath(userId, id) {
  return `${userId}/${id}.js`;
}

export async function userModsCreate(userId, buffer, meta) {
  if (!buffer || !buffer.length) throw new Error('Empty file');
  if (buffer.length > MAX_USER_MOD_BYTES) throw new Error('Mod file too large (max 5 MB)');
  const title = String(meta?.title || 'Mod').trim().slice(0, 120) || 'Mod';
  const id = crypto.randomUUID();

  if (useSupabase()) {
    const sb = sbClient();
    const pathStored = storagePath(userId, id);
    const { error: upErr } = await sb.storage.from(USER_MODS_BUCKET).upload(pathStored, buffer, {
      contentType: 'application/javascript',
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message);
    const { error: insErr } = await sb.from('skyhop_user_mods').insert({
      id,
      user_id: userId,
      title,
      storage_path: pathStored,
      byte_size: buffer.length,
    });
    if (insErr) {
      await sb.storage.from(USER_MODS_BUCKET).remove([pathStored]);
      throw new Error(insErr.message);
    }
    return { id, title, byte_size: buffer.length, created_at: Date.now() };
  }

  const rel = storagePath(userId, id);
  const abs = path.join(FILES_DIR, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  const row = {
    id,
    user_id: userId,
    title,
    storage_path: `file:${rel}`,
    byte_size: buffer.length,
    created_at: Date.now(),
  };
  const db = fileLoadIndex();
  db.mods.push(row);
  fileSaveIndex(db);
  return { id: row.id, title: row.title, byte_size: row.byte_size, created_at: row.created_at };
}

export async function userModsListForUser(userId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb
      .from('skyhop_user_mods')
      .select('id, title, byte_size, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);
    return data || [];
  }
  const db = fileLoadIndex();
  return db.mods
    .filter((r) => r.user_id === userId)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 30)
    .map((r) => ({
      id: r.id,
      title: r.title,
      byte_size: r.byte_size,
      created_at: r.created_at,
    }));
}

export async function userModsRead(userId, modId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: e1 } = await sb
      .from('skyhop_user_mods')
      .select('id, user_id, storage_path')
      .eq('id', modId)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!row || Number(row.user_id) !== Number(userId)) throw new Error('Not found');
    const { data, error } = await sb.storage.from(USER_MODS_BUCKET).download(row.storage_path);
    if (error) throw new Error(error.message);
    const ab = await data.arrayBuffer();
    return Buffer.from(ab);
  }
  const db = fileLoadIndex();
  const row = db.mods.find((r) => r.id === modId && Number(r.user_id) === Number(userId));
  if (!row) throw new Error('Not found');
  const rel = String(row.storage_path || '').replace(/^file:/, '');
  const abs = path.join(FILES_DIR, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) throw new Error('Mod file missing');
  return fs.readFileSync(abs);
}

export async function userModsDelete(userId, modId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: e1 } = await sb
      .from('skyhop_user_mods')
      .select('id, user_id, storage_path')
      .eq('id', modId)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!row || Number(row.user_id) !== Number(userId)) throw new Error('Not found');
    await sb.storage.from(USER_MODS_BUCKET).remove([row.storage_path]);
    const { error } = await sb.from('skyhop_user_mods').delete().eq('id', modId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  const db = fileLoadIndex();
  const row = db.mods.find((r) => r.id === modId && Number(r.user_id) === Number(userId));
  if (!row) throw new Error('Not found');
  const rel = String(row.storage_path || '').replace(/^file:/, '');
  const abs = path.join(FILES_DIR, rel.replace(/\//g, path.sep));
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  const idx = db.mods.findIndex((r) => r.id === modId);
  if (idx >= 0) db.mods.splice(idx, 1);
  fileSaveIndex(db);
  return { ok: true };
}
