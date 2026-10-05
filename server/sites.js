/**
 * Static sites for a company or organization.
 * File bytes live in Supabase Storage when that is configured, otherwise on local disk.
 * Pages are served with a sandbox so their scripts cannot read a SkyHop login.
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import * as Economy from './economy.js';
import { store as appStore } from './store.js';

const KEY = 'sites';
const BUCKET = 'skyhop-sites';
const MAX_BYTES = 300 * 1024;
const MAX_SITES = 3;
const MAX_FILES = 40;
const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'sites');

const RESERVED = new Set([
  'api',
  'health',
  'js',
  'css',
  'assets',
  'textures',
  'server',
  'scripts',
  'index.html',
  'favicon.ico',
  'stages.js',
  'stages-extra.js',
  'stages-36-50.js',
  'stages-world2.js',
  'package.json',
  'dockerfile',
]);

const EXT_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const SITE_HEADERS = {
  'Content-Security-Policy': [
    'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox',
    "default-src 'none'",
    "script-src 'unsafe-inline' 'unsafe-eval' https:",
    "style-src 'unsafe-inline' https:",
    "img-src https: data: blob:",
    "font-src https: data:",
    "media-src https:",
    "connect-src https:",
    "frame-src https:",
    "base-uri 'none'",
    "form-action https:",
  ].join('; '),
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
};

let chain = Promise.resolve();
let cache = { at: 0, bag: null };
let sbClient = null;
let bucketReady = false;

function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

function supabase() {
  const url = String(process.env.SUPABASE_URL || '').trim();
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!url || !key) return null;
  if (!sbClient) {
    sbClient = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return sbClient;
}

async function ensureBucket(client) {
  if (bucketReady) return;
  const existing = await client.storage.getBucket(BUCKET);
  if (!existing.data) {
    const created = await client.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES });
    if (created.error && !/already exists|duplicate/i.test(String(created.error.message || ''))) {
      throw new Error(created.error.message);
    }
  }
  bucketReady = true;
}

function emptyBag() {
  return { sites: [] };
}

async function readBag(store) {
  if (cache.bag && Date.now() - cache.at < 1000) return cache.bag;
  let bag = emptyBag();
  if (typeof store.getSiteContentPayload === 'function') {
    const row = await store.getSiteContentPayload(KEY);
    if (row && Array.isArray(row.sites)) bag = { sites: row.sites };
  }
  cache = { at: Date.now(), bag };
  return bag;
}

async function writeBag(store, bag) {
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('Site storage is not configured.');
  await store.setSiteContentPayload(KEY, bag);
  cache = { at: Date.now(), bag };
}

function cleanName(raw) {
  const name = String(raw || '').trim().toLowerCase();
  if (name.length < 2 || name.length > 64) throw new Error('Website name must be 2–64 characters.');
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name) || name.includes('..')) {
    throw new Error('Use letters, numbers, dots, and hyphens.');
  }
  if (RESERVED.has(name)) throw new Error('That website name is reserved.');
  return name;
}

function cleanFile(file) {
  const rel = String(file && file.path ? file.path : '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!rel || rel.includes('\0') || rel.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('File path is not allowed.');
  }
  const ext = path.posix.extname(rel).toLowerCase();
  if (!EXT_MIME[ext]) throw new Error('Use HTML, CSS, or JavaScript files. Pictures stay as links.');
  if (typeof file.content !== 'string') throw new Error('File content must be text.');
  if (file.content.includes('\0')) throw new Error('File content must be text.');
  return { path: rel, content: file.content };
}

function prepareFiles(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('Add at least index.html.');
  if (list.length > MAX_FILES) throw new Error('Too many files.');
  const files = [];
  const seen = new Set();
  let bytes = 0;
  for (const item of list) {
    const file = cleanFile(item);
    if (seen.has(file.path)) throw new Error('Two files use the same path.');
    seen.add(file.path);
    bytes += Buffer.byteLength(file.content, 'utf8');
    files.push(file);
  }
  if (bytes > MAX_BYTES) throw new Error('A site can be at most 300 KB.');
  if (!seen.has('index.html')) throw new Error('Add an index.html file.');
  return files;
}

function objectKey(name, filePath) {
  return `${name}/${filePath}`;
}

async function writeFiles(name, files, previousPaths) {
  const client = supabase();
  if (client) {
    await ensureBucket(client);
    const stale = (previousPaths || []).filter((filePath) => !files.some((file) => file.path === filePath));
    if (stale.length) {
      const { error } = await client.storage.from(BUCKET).remove(stale.map((filePath) => objectKey(name, filePath)));
      if (error) throw new Error(error.message);
    }
    for (const file of files) {
      const { error } = await client.storage.from(BUCKET).upload(objectKey(name, file.path), Buffer.from(file.content, 'utf8'), {
        contentType: EXT_MIME[path.posix.extname(file.path).toLowerCase()] || 'text/plain; charset=utf-8',
        upsert: true,
      });
      if (error) throw new Error(error.message);
    }
    return;
  }
  const dir = path.join(DATA_DIR, name);
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(path.resolve(DATA_DIR) + path.sep)) throw new Error('File path is not allowed.');
  await fs.rm(dir, { recursive: true, force: true });
  for (const file of files) {
    const abs = path.resolve(dir, file.path);
    if (!abs.startsWith(resolved + path.sep)) throw new Error('File path is not allowed.');
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, file.content, 'utf8');
  }
}

async function removeFiles(name, paths) {
  const client = supabase();
  if (client) {
    await ensureBucket(client);
    if (paths && paths.length) {
      const { error } = await client.storage.from(BUCKET).remove(paths.map((filePath) => objectKey(name, filePath)));
      if (error) throw new Error(error.message);
    }
    return;
  }
  await fs.rm(path.join(DATA_DIR, name), { recursive: true, force: true });
}

async function readStored(name, filePath) {
  const client = supabase();
  if (client) {
    await ensureBucket(client);
    const { data, error } = await client.storage.from(BUCKET).download(objectKey(name, filePath));
    if (error || !data) return null;
    if (Buffer.isBuffer(data)) return data;
    if (typeof data.arrayBuffer === 'function') return Buffer.from(await data.arrayBuffer());
    return null;
  }
  try {
    return await fs.readFile(path.join(DATA_DIR, name, filePath));
  } catch {
    return null;
  }
}

function publicSite(site, withFiles) {
  const row = {
    name: site.name,
    hostType: site.hostType,
    hostId: site.hostId,
    hostName: site.hostName || '',
    updatedAt: site.updatedAt || 0,
    files: (site.files || []).map((file) => ({ path: file.path })),
  };
  if (withFiles) {
    row.files = (site.files || []).map((file) => ({ path: file.path, content: file.content || '' }));
  }
  return row;
}

export async function publicSiteIndex(store) {
  const bag = await readBag(store);
  return {
    sites: (bag.sites || []).map((site) => ({
      name: site.name,
      hostType: site.hostType,
      hostId: site.hostId,
    })),
  };
}

export async function listSites(store, user, hostType, hostId) {
  const host = await Economy.describeSiteHost(store, user, hostType, hostId);
  const bag = await readBag(store);
  const sites = bag.sites.filter((site) => site.hostType === host.hostType && site.hostId === host.hostId);
  const full = [];
  for (const site of sites) {
    const files = [];
    for (const file of site.files || []) {
      const body = await readStored(site.name, file.path);
      files.push({ path: file.path, content: body ? body.toString('utf8') : '' });
    }
    full.push(publicSite({ ...site, files }, true));
  }
  return { sites: full, maxSites: MAX_SITES, maxBytes: MAX_BYTES };
}

export async function deploySite(store, user, { name, hostType, hostId, files }) {
  const clean = cleanName(name);
  const nextFiles = prepareFiles(files);
  const host = await Economy.describeSiteHost(store, user, hostType, hostId);
  return locked(async () => {
    const bag = await readBag(store);
    const existing = bag.sites.find((site) => site.name === clean);
    if (existing && (existing.hostType !== host.hostType || existing.hostId !== host.hostId)) {
      throw new Error('That website name is taken.');
    }
    const owned = bag.sites.filter((site) => site.hostType === host.hostType && site.hostId === host.hostId);
    if (!existing && owned.length >= MAX_SITES) throw new Error('That company or organization already has 3 sites.');
    await writeFiles(clean, nextFiles, existing ? (existing.files || []).map((file) => file.path) : []);
    const row = {
      name: clean,
      hostType: host.hostType,
      hostId: host.hostId,
      hostName: host.hostName,
      updatedAt: Date.now(),
      updatedBy: String(user.id),
      files: nextFiles.map((file) => ({ path: file.path })),
    };
    bag.sites = bag.sites.filter((site) => site.name !== clean);
    bag.sites.push(row);
    await writeBag(store, bag);
    return { site: publicSite({ ...row, files: nextFiles }, true), maxSites: MAX_SITES, maxBytes: MAX_BYTES };
  });
}

export async function deleteSite(store, user, { name, hostType, hostId }) {
  const clean = cleanName(name);
  const host = await Economy.describeSiteHost(store, user, hostType, hostId);
  return locked(async () => {
    const bag = await readBag(store);
    const existing = bag.sites.find((site) => site.name === clean);
    if (!existing || existing.hostType !== host.hostType || existing.hostId !== host.hostId) {
      throw new Error('That website is not yours.');
    }
    await removeFiles(clean, (existing.files || []).map((file) => file.path));
    bag.sites = bag.sites.filter((site) => site.name !== clean);
    await writeBag(store, bag);
    return { ok: true };
  });
}

export async function servePublishedSite(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;
  let rel = urlPath;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return false;
  }
  if (rel.includes('\0')) return false;
  const segments = rel.split('/').filter(Boolean);
  if (!segments.length || segments.some((part) => part === '..' || part === '.')) return false;
  const name = segments[0].toLowerCase();
  if (RESERVED.has(name) || !/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(name)) return false;
  const bag = await readBag(appStore);
  const site = bag.sites.find((row) => row.name === name);
  if (!site) return false;
  let filePath = segments.slice(1).join('/');
  if (!filePath) filePath = 'index.html';
  const known = (site.files || []).some((file) => file.path === filePath);
  if (!known) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SITE_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : 'Not found');
    return true;
  }
  const body = await readStored(name, filePath);
  if (!body) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SITE_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : 'Not found');
    return true;
  }
  const ext = path.posix.extname(filePath).toLowerCase();
  res.writeHead(200, { 'Content-Type': EXT_MIME[ext] || 'text/plain; charset=utf-8', ...SITE_HEADERS });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
