import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, 'data', 'input_logs_index.json');
const FILES_DIR = path.join(__dirname, 'data', 'input_logs_files');

export const INPUT_LOGS_BUCKET = 'skyhop-input-logs';
export const MAX_INPUT_LOG_BYTES = 4 * 1024 * 1024;

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
    const empty = { logs: [] };
    fs.writeFileSync(INDEX_PATH, JSON.stringify(empty), 'utf8');
    return empty;
  }
  try {
    const j = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (!Array.isArray(j.logs)) j.logs = [];
    return j;
  } catch {
    return { logs: [] };
  }
}

function fileSaveIndex(db) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(db), 'utf8');
}

function storagePath(userId, id) {
  return `${userId}/${id}.json`;
}

function parseAnticheatOn(v) {
  if (v === false || v === 0) return false;
  const s = String(v == null ? '1' : v).trim().toLowerCase();
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false;
  return true;
}

function rowAnticheatOn(row) {
  if (!row) return true;
  if (row.anticheat_on === false || row.anticheatOn === false) return false;
  return true;
}

export async function inputLogsCreate(userId, buffer, meta) {
  if (!buffer || !buffer.length) throw new Error('Empty input log');
  if (buffer.length > MAX_INPUT_LOG_BYTES) throw new Error('Input log too large (max 4 MB)');
  const title = String(meta?.title || 'Run').trim().slice(0, 120) || 'Run';
  const source = String(meta?.source || 'campaign').trim().slice(0, 40) || 'campaign';
  const anticheatOn = parseAnticheatOn(meta?.anticheatOn);
  const id = crypto.randomUUID();

  if (useSupabase()) {
    const sb = sbClient();
    const pathStored = storagePath(userId, id);
    const { error: upErr } = await sb.storage.from(INPUT_LOGS_BUCKET).upload(pathStored, buffer, {
      contentType: 'application/json',
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message);
    const insertRow = {
      id,
      user_id: userId,
      title,
      source,
      storage_path: pathStored,
      byte_size: buffer.length,
      anticheat_on: anticheatOn,
    };
    let { error: insErr } = await sb.from('skyhop_input_logs').insert(insertRow);
    if (insErr && String(insErr.message).includes('anticheat_on')) {
      delete insertRow.anticheat_on;
      ({ error: insErr } = await sb.from('skyhop_input_logs').insert(insertRow));
    }
    if (insErr) {
      await sb.storage.from(INPUT_LOGS_BUCKET).remove([pathStored]);
      throw new Error(insErr.message);
    }
    return { id, title, source, byte_size: buffer.length, created_at: Date.now(), anticheatOn };
  }

  const rel = storagePath(userId, id);
  const abs = path.join(FILES_DIR, rel.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  const row = {
    id,
    user_id: userId,
    title,
    source,
    storage_path: `file:${rel}`,
    byte_size: buffer.length,
    created_at: Date.now(),
    anticheat_on: anticheatOn,
  };
  const db = fileLoadIndex();
  db.logs.push(row);
  fileSaveIndex(db);
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    byte_size: row.byte_size,
    created_at: row.created_at,
    anticheatOn,
  };
}

export async function inputLogsListForUser(userId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb
      .from('skyhop_input_logs')
      .select('id, title, source, byte_size, created_at, anticheat_on')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error && String(error.message).includes('anticheat_on')) {
      const retry = await sb
        .from('skyhop_input_logs')
        .select('id, title, source, byte_size, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (retry.error) throw new Error(retry.error.message);
      return (retry.data || []).map((r) => ({ ...r, anticheatOn: true }));
    }
    if (error) throw new Error(error.message);
    return (data || []).map((r) => ({ ...r, anticheatOn: rowAnticheatOn(r) }));
  }
  const db = fileLoadIndex();
  return db.logs
    .filter((r) => r.user_id === userId)
    .sort((a, b) => (b.created_at || 0) - (a.created_at || 0))
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      title: r.title,
      source: r.source,
      byte_size: r.byte_size,
      created_at: r.created_at,
      anticheatOn: rowAnticheatOn(r),
    }));
}

async function getOwnedRow(userId, logId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb
      .from('skyhop_input_logs')
      .select('id, user_id, title, source, storage_path, byte_size, created_at, anticheat_on')
      .eq('id', logId)
      .maybeSingle();
    if (error && String(error.message).includes('anticheat_on')) {
      const retry = await sb
        .from('skyhop_input_logs')
        .select('id, user_id, title, source, storage_path, byte_size, created_at')
        .eq('id', logId)
        .maybeSingle();
      if (retry.error) throw new Error(retry.error.message);
      if (!retry.data || Number(retry.data.user_id) !== Number(userId)) return null;
      return retry.data;
    }
    if (error) throw new Error(error.message);
    if (!data || Number(data.user_id) !== Number(userId)) return null;
    return data;
  }
  const db = fileLoadIndex();
  const row = db.logs.find((r) => r.id === logId && Number(r.user_id) === Number(userId));
  return row || null;
}

export async function inputLogsMetaForUser(userId, logId) {
  const row = await getOwnedRow(userId, logId);
  if (!row) return null;
  return { id: row.id, anticheatOn: rowAnticheatOn(row) };
}

export async function inputLogsRead(userId, logId) {
  const row = await getOwnedRow(userId, logId);
  if (!row) throw new Error('Not found');
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb.storage.from(INPUT_LOGS_BUCKET).download(row.storage_path);
    if (error) throw new Error(error.message);
    const ab = await data.arrayBuffer();
    return { buffer: Buffer.from(ab), title: row.title };
  }
  const rel = String(row.storage_path || '').replace(/^file:/, '');
  const abs = path.join(FILES_DIR, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) throw new Error('Log file missing');
  return { buffer: fs.readFileSync(abs), title: row.title };
}

export async function inputLogsReadStaff(logId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: e1 } = await sb
      .from('skyhop_input_logs')
      .select('id, user_id, title, storage_path')
      .eq('id', logId)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!row) throw new Error('Not found');
    const { data, error } = await sb.storage.from(INPUT_LOGS_BUCKET).download(row.storage_path);
    if (error) throw new Error(error.message);
    const ab = await data.arrayBuffer();
    return { buffer: Buffer.from(ab), title: row.title, userId: row.user_id };
  }
  const db = fileLoadIndex();
  const row = db.logs.find((r) => r.id === logId);
  if (!row) throw new Error('Not found');
  const rel = String(row.storage_path || '').replace(/^file:/, '');
  const abs = path.join(FILES_DIR, rel.replace(/\//g, path.sep));
  return { buffer: fs.readFileSync(abs), title: row.title, userId: row.user_id };
}

export async function inputLogsDelete(userId, logId) {
  const row = await getOwnedRow(userId, logId);
  if (!row) throw new Error('Not found');
  if (useSupabase()) {
    const sb = sbClient();
    await sb.storage.from(INPUT_LOGS_BUCKET).remove([row.storage_path]);
    const { error } = await sb.from('skyhop_input_logs').delete().eq('id', logId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  const rel = String(row.storage_path || '').replace(/^file:/, '');
  const abs = path.join(FILES_DIR, rel.replace(/\//g, path.sep));
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  const db = fileLoadIndex();
  const idx = db.logs.findIndex((r) => r.id === logId);
  if (idx >= 0) db.logs.splice(idx, 1);
  fileSaveIndex(db);
  return { ok: true };
}
