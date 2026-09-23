/**
 * Owner-added campaign worlds. Definitions live in site content / a local file (no redeploy).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE_PATH = path.join(__dirname, 'data', 'custom_worlds.json');
const CONTENT_KEY = 'custom_worlds';
const MAX_WORLDS = 40;
const MAX_NAME = 40;

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

function emptyDb() {
  return { nextId: 3, worlds: [], clears: {} };
}

function fileLoad() {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILE_PATH)) return emptyDb();
  try {
    const j = JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
    if (!Array.isArray(j.worlds)) j.worlds = [];
    if (!j.clears || typeof j.clears !== 'object') j.clears = {};
    if (!Number.isFinite(Number(j.nextId)) || Number(j.nextId) < 3) j.nextId = 3;
    return j;
  } catch {
    return emptyDb();
  }
}

function fileSave(db) {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify(db), 'utf8');
}

async function loadDb() {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb.from('skyhop_site_content').select('payload').eq('key', CONTENT_KEY).maybeSingle();
    if (error) {
      if (/skyhop_site_content|relation|column/i.test(String(error.message || ''))) return emptyDb();
      throw new Error(error.message);
    }
    const p = data && data.payload && typeof data.payload === 'object' ? data.payload : null;
    if (!p) return emptyDb();
    return {
      nextId: Number(p.nextId) >= 3 ? Number(p.nextId) : 3,
      worlds: Array.isArray(p.worlds) ? p.worlds : [],
      clears: p.clears && typeof p.clears === 'object' ? p.clears : {},
    };
  }
  return fileLoad();
}

async function saveDb(db) {
  if (useSupabase()) {
    const sb = sbClient();
    const { error } = await sb.from('skyhop_site_content').upsert(
      { key: CONTENT_KEY, payload: db, updated_at: Date.now() },
      { onConflict: 'key' }
    );
    if (error) throw new Error(error.message);
    return;
  }
  fileSave(db);
}

export const BUILTIN_WORLDS = [
  { id: 1, name: 'World 1', builtin: true },
  { id: 2, name: 'World 2', builtin: true },
];

function knownIds(db) {
  const ids = new Set([1, 2]);
  for (const w of db.worlds) ids.add(Number(w.id));
  return ids;
}

function clearsFor(db, userId) {
  const key = String(userId || '');
  const list = db.clears && Array.isArray(db.clears[key]) ? db.clears[key] : [];
  return new Set(list.map((n) => Number(n)).filter((n) => Number.isFinite(n)));
}

function isUnlocked(world, { isOwner, world1Cleared, cleared }) {
  if (isOwner) return true;
  const reqs = Array.isArray(world.requires) ? world.requires : [];
  for (const raw of reqs) {
    const id = Number(raw);
    if (id === 1) {
      if (!world1Cleared) return false;
    } else if (!cleared.has(id)) return false;
  }
  return true;
}

export async function listWorldCatalog({ userId, isOwner, world1Cleared }) {
  const db = await loadDb();
  const cleared = clearsFor(db, userId);
  const custom = db.worlds
    .map((w) => ({
      id: Number(w.id),
      name: String(w.name || 'World ' + w.id),
      requires: Array.isArray(w.requires) ? w.requires.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [],
      stageCount: Array.isArray(w.stages) ? w.stages.length : 0,
      builtin: false,
    }))
    .sort((a, b) => a.id - b.id);
  const worlds = [...BUILTIN_WORLDS, ...custom].map((w) => ({
    ...w,
    unlocked: w.builtin ? w.id === 1 || (w.id === 2 && (isOwner || world1Cleared)) : isUnlocked(w, { isOwner, world1Cleared, cleared }),
  }));
  return { worlds };
}

export async function createCustomWorld({ name, requires }) {
  const db = await loadDb();
  if (db.worlds.length >= MAX_WORLDS) throw new Error('Too many worlds.');
  const label = String(name || '').trim().slice(0, MAX_NAME);
  if (!label) throw new Error('Name is required.');
  const ids = knownIds(db);
  const req = [];
  const seen = new Set();
  for (const raw of Array.isArray(requires) ? requires : []) {
    const id = Number(raw);
    if (!ids.has(id) || seen.has(id)) continue;
    seen.add(id);
    req.push(id);
  }
  let id = Math.max(3, Number(db.nextId) || 3);
  while (ids.has(id)) id += 1;
  const world = { id, name: label, requires: req, stages: [] };
  db.worlds.push(world);
  db.nextId = id + 1;
  await saveDb(db);
  return {
    id: world.id,
    name: world.name,
    requires: world.requires,
    stageCount: 0,
    builtin: false,
    unlocked: true,
  };
}

export async function getCustomWorldStages(id) {
  const want = Number(id);
  const db = await loadDb();
  const world = db.worlds.find((w) => Number(w.id) === want);
  if (!world) return null;
  return { id: want, name: world.name, stages: Array.isArray(world.stages) ? world.stages : [] };
}

export async function customWorldUnlocked(id, ctx) {
  const want = Number(id);
  if (want === 1) return true;
  if (want === 2) return !!(ctx.isOwner || ctx.world1Cleared);
  const db = await loadDb();
  const world = db.worlds.find((w) => Number(w.id) === want);
  if (!world) return false;
  return isUnlocked(world, { ...ctx, cleared: clearsFor(db, ctx.userId) });
}

export async function setCustomWorldStages(id, stages) {
  const want = Number(id);
  if (!Array.isArray(stages)) throw new Error('stages array required');
  const db = await loadDb();
  const world = db.worlds.find((w) => Number(w.id) === want);
  if (!world) throw new Error('Unknown world.');
  world.stages = stages;
  await saveDb(db);
  return { id: want, count: stages.length };
}

export async function markWorldCleared(userId, worldId) {
  const id = Number(worldId);
  if (!userId || !Number.isFinite(id) || id < 2) return;
  const db = await loadDb();
  if (id >= 3 && !db.worlds.some((w) => Number(w.id) === id)) return;
  const key = String(userId);
  const cur = clearsFor(db, key);
  cur.add(id);
  db.clears[key] = [...cur];
  await saveDb(db);
}
