import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, 'data', 'recordings_index.json');
const FILES_DIR = path.join(__dirname, 'data', 'recordings_files');

export const RECORDINGS_BUCKET = 'skyhop-recordings';
/** 25 min at ~1 Mbps capture, with headroom. */
export const MAX_RECORDING_BYTES = 256 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['video/webm', 'video/mp4', 'video/x-matroska', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8']);

function normalizeMime(ct) {
  const t = String(ct || 'video/webm').split(';')[0].trim().toLowerCase();
  if (t === 'video/webm' || t === 'video/mp4' || t === 'video/x-matroska') return t;
  return 'video/webm';
}

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
    const empty = { recordings: [] };
    fs.writeFileSync(INDEX_PATH, JSON.stringify(empty), 'utf8');
    return empty;
  }
  try {
    const j = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (!Array.isArray(j.recordings)) j.recordings = [];
    return j;
  } catch {
    return { recordings: [] };
  }
}

function fileSaveIndex(db) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(db), 'utf8');
}

function storageObjectPath(userId, recordingId, mimeType) {
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  return `${userId}/${recordingId}.${ext}`;
}

export function parseAnticheatOn(v) {
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

function validateUpload(buffer, contentType) {
  if (!buffer || !buffer.length) throw new Error('Empty recording');
  if (buffer.length > MAX_RECORDING_BYTES) throw new Error('Recording too large (max 25 minutes)');
  const mime = normalizeMime(contentType);
  const ok =
    ALLOWED_TYPES.has(mime) ||
    ALLOWED_TYPES.has(String(contentType || '').toLowerCase()) ||
    mime.startsWith('video/');
  if (!ok) throw new Error('Unsupported video type');
  return mime;
}

async function ensureRecordingsBucketLimit() {
  if (!useSupabase()) return;
  try {
    await sbClient().storage.updateBucket(RECORDINGS_BUCKET, {
      public: false,
      fileSizeLimit: String(MAX_RECORDING_BYTES),
      allowedMimeTypes: ['video/webm', 'video/mp4', 'video/x-matroska'],
    });
  } catch {
    /* bucket may already allow this size */
  }
}

export async function recordingsCreate(userId, buffer, contentType, meta) {
  const mime = validateUpload(buffer, contentType);
  await ensureRecordingsBucketLimit();
  const title = String(meta?.title || 'Run').trim().slice(0, 120) || 'Run';
  const source = String(meta?.source || 'campaign').trim().slice(0, 40) || 'campaign';
  const anticheatOn = parseAnticheatOn(meta?.anticheatOn);
  const id = crypto.randomUUID();

  if (useSupabase()) {
    const sb = sbClient();
    const storagePath = storageObjectPath(userId, id, mime);
    const { error: upErr } = await sb.storage.from(RECORDINGS_BUCKET).upload(storagePath, buffer, {
      contentType: mime,
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message);
    const insertRow = {
      id,
      user_id: userId,
      title,
      source,
      storage_path: storagePath,
      mime_type: mime,
      byte_size: buffer.length,
      anticheat_on: anticheatOn,
    };
    let { error: insErr } = await sb.from('skyhop_recordings').insert(insertRow);
    if (insErr && String(insErr.message).includes('anticheat_on')) {
      delete insertRow.anticheat_on;
      ({ error: insErr } = await sb.from('skyhop_recordings').insert(insertRow));
    }
    if (insErr) {
      await sb.storage.from(RECORDINGS_BUCKET).remove([storagePath]);
      throw new Error(insErr.message);
    }
    return {
      id,
      title,
      source,
      mime_type: mime,
      byte_size: buffer.length,
      created_at: new Date().toISOString(),
      anticheatOn,
    };
  }

  const storagePath = storageObjectPath(userId, id, mime);
  const abs = path.join(FILES_DIR, storagePath.replace(/\//g, path.sep));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  const row = {
    id,
    user_id: userId,
    title,
    source,
    storage_path: `file:${storagePath}`,
    mime_type: mime,
    byte_size: buffer.length,
    created_at: new Date().toISOString(),
    anticheat_on: anticheatOn,
  };
  const db = fileLoadIndex();
  db.recordings.push(row);
  fileSaveIndex(db);
  return {
    id: row.id,
    title: row.title,
    source: row.source,
    mime_type: row.mime_type,
    byte_size: row.byte_size,
    created_at: row.created_at,
    anticheatOn,
  };
}

export async function recordingsListForUser(userId) {
  await ensureRecordingsBucketLimit();
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb
      .from('skyhop_recordings')
      .select('id, title, source, mime_type, byte_size, created_at, anticheat_on')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error && String(error.message).includes('anticheat_on')) {
      const retry = await sb
        .from('skyhop_recordings')
        .select('id, title, source, mime_type, byte_size, created_at')
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
  return db.recordings
    .filter((r) => r.user_id === userId)
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 50)
    .map((r) => ({
      id: r.id,
      title: r.title,
      source: r.source,
      mime_type: r.mime_type,
      byte_size: r.byte_size,
      created_at: r.created_at,
      anticheatOn: rowAnticheatOn(r),
    }));
}

async function getOwnedRow(userId, recordingId) {
  if (useSupabase()) {
    const sb = sbClient();
    let { data, error } = await sb
      .from('skyhop_recordings')
      .select('id, user_id, title, source, storage_path, mime_type, byte_size, created_at, anticheat_on')
      .eq('id', recordingId)
      .maybeSingle();
    if (error && String(error.message).includes('anticheat_on')) {
      ({ data, error } = await sb
        .from('skyhop_recordings')
        .select('id, user_id, title, source, storage_path, mime_type, byte_size, created_at')
        .eq('id', recordingId)
        .maybeSingle());
    }
    if (error) throw new Error(error.message);
    if (!data || data.user_id !== userId) return null;
    return data;
  }
  const db = fileLoadIndex();
  const row = db.recordings.find((r) => r.id === recordingId && r.user_id === userId);
  return row || null;
}

export async function recordingsMetaForUser(userId, recordingId) {
  const row = await getOwnedRow(userId, recordingId);
  if (!row) return null;
  return { id: row.id, anticheatOn: rowAnticheatOn(row) };
}

export async function recordingsReadVideo(userId, recordingId) {
  const row = await getOwnedRow(userId, recordingId);
  if (!row) throw new Error('Not found');
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb.storage.from(RECORDINGS_BUCKET).download(row.storage_path);
    if (error) throw new Error(error.message);
    const ab = await data.arrayBuffer();
    return { buffer: Buffer.from(ab), mimeType: row.mime_type || 'video/webm' };
  }
  const rel = String(row.storage_path || '').replace(/^file:/, '');
  const abs = path.join(FILES_DIR, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) throw new Error('Recording file missing');
  return { buffer: fs.readFileSync(abs), mimeType: row.mime_type || 'video/webm' };
}

export async function recordingsReadStaff(recordingId) {
  if (useSupabase()) {
    const sb = sbClient();
    const { data: row, error: e1 } = await sb
      .from('skyhop_recordings')
      .select('id, user_id, title, storage_path, mime_type')
      .eq('id', recordingId)
      .maybeSingle();
    if (e1) throw new Error(e1.message);
    if (!row) throw new Error('Not found');
    const { data, error } = await sb.storage.from(RECORDINGS_BUCKET).download(row.storage_path);
    if (error) throw new Error(error.message);
    const ab = await data.arrayBuffer();
    return {
      buffer: Buffer.from(ab),
      mimeType: row.mime_type || 'video/webm',
      title: row.title,
      userId: row.user_id,
    };
  }
  const db = fileLoadIndex();
  const row = db.recordings.find((r) => r.id === recordingId);
  if (!row) throw new Error('Not found');
  const rel = String(row.storage_path || '').replace(/^file:/, '');
  const abs = path.join(FILES_DIR, rel.replace(/\//g, path.sep));
  if (!fs.existsSync(abs)) throw new Error('Recording file missing');
  return {
    buffer: fs.readFileSync(abs),
    mimeType: row.mime_type || 'video/webm',
    title: row.title,
    userId: row.user_id,
  };
}

export async function recordingsRename(userId, recordingId, title) {
  const row = await getOwnedRow(userId, recordingId);
  if (!row) throw new Error('Not found');
  const next = String(title || '').trim().slice(0, 120) || 'Run';
  if (useSupabase()) {
    const sb = sbClient();
    const { error } = await sb
      .from('skyhop_recordings')
      .update({ title: next })
      .eq('id', recordingId)
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
    return { id: recordingId, title: next };
  }
  const db = fileLoadIndex();
  const r = db.recordings.find((x) => x.id === recordingId && x.user_id === userId);
  if (!r) throw new Error('Not found');
  r.title = next;
  fileSaveIndex(db);
  return { id: recordingId, title: next };
}

export async function recordingsDelete(userId, recordingId) {
  const row = await getOwnedRow(userId, recordingId);
  if (!row) throw new Error('Not found');
  if (useSupabase()) {
    const sb = sbClient();
    await sb.storage.from(RECORDINGS_BUCKET).remove([row.storage_path]);
    const { error } = await sb.from('skyhop_recordings').delete().eq('id', recordingId);
    if (error) throw new Error(error.message);
    return { ok: true };
  }
  const rel = String(row.storage_path || '').replace(/^file:/, '');
  const abs = path.join(FILES_DIR, rel.replace(/\//g, path.sep));
  if (fs.existsSync(abs)) fs.unlinkSync(abs);
  const db = fileLoadIndex();
  const idx = db.recordings.findIndex((r) => r.id === recordingId);
  if (idx >= 0) db.recordings.splice(idx, 1);
  fileSaveIndex(db);
  return { ok: true };
}

export async function recordingsDeleteAllForUser(userId) {
  const list = await recordingsListForUser(userId);
  for (const r of list) {
    try {
      await recordingsDelete(userId, r.id);
    } catch {
      /* continue */
    }
  }
}
