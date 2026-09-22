/**
 * Shop catalog merge: bundled items + owner-added items (no redeploy).
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { SHOP_ITEMS, SHOP_PAGES, SHOP_SLOTS_PER_PAGE } from './shop-catalog.js';
import { extFromContentType, sniffImageExt } from './profile-storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = path.join(__dirname, 'data', 'shop_items.json');
const FILES_DIR = path.join(__dirname, 'data', 'shop_files');

export const SHOP_BUCKET = 'skyhop-shop';
export const MAX_SHOP_IMAGE_BYTES = 1536 * 1024;
export const MIN_SHOP_PRICE = 50;
export const MAX_SHOP_PRICE = 1_000_000;

export function shopTierFromPrice(price) {
  const p = Math.floor(Number(price) || 0);
  if (p >= 500000) return { id: 'mythic', label: 'Mythic' };
  if (p >= 100000) return { id: 'legendary', label: 'Legendary' };
  if (p >= 10000) return { id: 'epic', label: 'Epic' };
  if (p >= 4500) return { id: 'rare', label: 'Rare' };
  if (p >= 2000) return { id: 'insane', label: 'Insane' };
  if (p >= 1000) return { id: 'uncommon', label: 'Uncommon' };
  return { id: 'common', label: 'Common' };
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

function fileLoad() {
  const dir = path.dirname(INDEX_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(FILES_DIR)) fs.mkdirSync(FILES_DIR, { recursive: true });
  if (!fs.existsSync(INDEX_PATH)) {
    const empty = { items: [] };
    fs.writeFileSync(INDEX_PATH, JSON.stringify(empty), 'utf8');
    return empty;
  }
  try {
    const j = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (!Array.isArray(j.items)) j.items = [];
    return j;
  } catch {
    return { items: [] };
  }
}

function fileSave(db) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(db), 'utf8');
}

function mapOwnerRow(r) {
  const id = r.id;
  const texture = r.texture || r.texture_filename;
  const price = Math.floor(Number(r.price) || 0);
  const sellPrice = Math.floor(Number(r.sell_price != null ? r.sell_price : r.sellPrice) || 0);
  const tier = shopTierFromPrice(price);
  return {
    id,
    texture,
    label: r.label || texture,
    price,
    sellPrice,
    page: Number(r.page) || 1,
    slot: Number(r.slot) || 0,
    imageUrl: '/api/shop/skins/' + encodeURIComponent(texture),
    tier: tier.id,
    tierLabel: tier.label,
    source: 'owner',
    mimeType: r.mime_type || r.mimeType || 'image/png',
    storagePath: r.storage_path || r.storagePath || null,
  };
}

function publicShopItem(it) {
  return {
    id: it.id,
    texture: it.texture,
    label: it.label,
    price: it.price,
    sellPrice: it.sellPrice,
    page: it.page,
    slot: it.slot,
    imageUrl: it.imageUrl,
    tier: it.tier,
    tierLabel: it.tierLabel,
    source: it.source,
  };
}

function mapBundled(x) {
  const price = Math.floor(Number(x.price) || 0);
  const tier = shopTierFromPrice(price);
  return {
    id: x.id,
    texture: x.texture,
    label: x.label || x.texture,
    price,
    sellPrice: x.sellPrice != null ? Math.floor(Number(x.sellPrice) || 0) : 0,
    page: x.page != null ? Number(x.page) : 1,
    slot: x.slot != null ? Number(x.slot) : 0,
    imageUrl: 'textures/' + encodeURIComponent(x.texture),
    tier: tier.id,
    tierLabel: tier.label,
    source: 'bundled',
  };
}

async function listOwnerItems() {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb.from('skyhop_shop_items').select('*').order('created_at', { ascending: true });
    if (error) {
      if (/skyhop_shop_items|relation|column/i.test(String(error.message || ''))) return [];
      throw new Error(error.message);
    }
    return (data || []).map(mapOwnerRow);
  }
  return fileLoad().items.map(mapOwnerRow);
}

function applyOverride(item, ov) {
  if (!ov || typeof ov !== 'object') return { ...item, hidden: false };
  const price = ov.price != null ? Math.floor(Number(ov.price)) : item.price;
  const sellPrice = ov.sellPrice != null ? Math.floor(Number(ov.sellPrice)) : item.sellPrice;
  const label = ov.label != null && String(ov.label).trim() ? String(ov.label).trim().slice(0, 80) : item.label;
  const tier = shopTierFromPrice(price);
  const page = ov.page != null ? Number(ov.page) : item.page;
  const slot = ov.slot != null ? Number(ov.slot) : item.slot;
  return {
    ...item,
    label,
    price,
    sellPrice,
    page,
    slot,
    tier: tier.id,
    tierLabel: tier.label,
    hidden: !!ov.hidden,
  };
}

async function loadOverrides() {
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb.from('skyhop_site_content').select('payload').eq('key', 'shop_overrides').maybeSingle();
    if (error) {
      if (/skyhop_site_content|relation|column/i.test(String(error.message || ''))) return {};
      throw new Error(error.message);
    }
    const items = data && data.payload && data.payload.items;
    return items && typeof items === 'object' ? items : {};
  }
  const ov = fileLoad().overrides;
  return ov && typeof ov === 'object' ? ov : {};
}

async function saveOverrides(map) {
  if (useSupabase()) {
    const sb = sbClient();
    const { error } = await sb.from('skyhop_site_content').upsert(
      { key: 'shop_overrides', payload: { items: map }, updated_at: Date.now() },
      { onConflict: 'key' }
    );
    if (error) throw new Error(error.message);
    return;
  }
  const db = fileLoad();
  db.overrides = map;
  fileSave(db);
}

async function allShopItems(diskTextureSet) {
  const bundled = SHOP_ITEMS.filter((x) => !diskTextureSet || diskTextureSet.has(x.texture)).map(mapBundled);
  const owner = await listOwnerItems();
  const byId = new Map();
  for (const it of bundled) byId.set(it.id, it);
  for (const it of owner) byId.set(it.id, it);
  const overrides = await loadOverrides();
  return [...byId.values()]
    .map((it) => applyOverride(it, overrides[it.id]))
    .sort((a, b) => a.page - b.page || a.slot - b.slot || String(a.id).localeCompare(String(b.id)));
}

function catalogPayload(items) {
  let maxPage = SHOP_PAGES;
  for (const it of items) {
    if (it.page > maxPage) maxPage = it.page;
  }
  return { items: items.map((it) => publicShopItem(it)), pages: maxPage, slotsPerPage: SHOP_SLOTS_PER_PAGE };
}

export async function listShopItems(diskTextureSet) {
  const items = (await allShopItems(diskTextureSet)).filter((it) => !it.hidden);
  return catalogPayload(items);
}

export async function listShopItemsForOwner(diskTextureSet) {
  const items = await allShopItems(diskTextureSet);
  return {
    ...catalogPayload(items.filter((it) => !it.hidden)),
    hiddenItems: items.filter((it) => it.hidden).map((it) => publicShopItem(it)),
  };
}

export async function getShopItemById(id) {
  const want = String(id || '').trim();
  if (!want) return null;
  const items = await allShopItems(null);
  return items.find((x) => x.id === want) || null;
}

export async function updateShopListing(id, { label, price, sellPrice }) {
  const item = await getShopItemById(id);
  if (!item) throw new Error('Unknown shop item.');
  const prices = validatePrices(price, sellPrice);
  const name = String(label || '').trim().slice(0, 80) || item.label || 'Shop item';
  const overrides = await loadOverrides();
  const prev = overrides[item.id] && typeof overrides[item.id] === 'object' ? overrides[item.id] : {};
  overrides[item.id] = {
    ...prev,
    label: name,
    price: prices.price,
    sellPrice: prices.sellPrice,
  };
  await saveOverrides(overrides);
  return publicShopItem(applyOverride(item, overrides[item.id]));
}

export async function setShopItemListed(id, listed) {
  const item = await getShopItemById(id);
  if (!item) throw new Error('Unknown shop item.');
  const overrides = await loadOverrides();
  const prev = overrides[item.id] && typeof overrides[item.id] === 'object' ? overrides[item.id] : {};
  const next = { ...prev, hidden: !listed };
  if (listed) {
    const visible = (await allShopItems(null)).filter((it) => !it.hidden && it.id !== item.id);
    const taken = visible.some((it) => it.page === item.page && it.slot === item.slot);
    if (taken) {
      const pos = nextFreeSlot(visible);
      next.page = pos.page;
      next.slot = pos.slot;
    }
  }
  overrides[item.id] = next;
  await saveOverrides(overrides);
  return publicShopItem(applyOverride(item, next));
}

export async function findShopItemByTexture(filename) {
  const fn = path.basename(String(filename || ''));
  if (!fn) return null;
  const bundled = SHOP_ITEMS.find((x) => x.texture === fn);
  if (bundled) return mapBundled(bundled);
  const owner = await listOwnerItems();
  return owner.find((x) => x.texture === fn) || null;
}

export async function listShopTextureFilenames() {
  const owner = await listOwnerItems();
  return owner.map((x) => x.texture).filter(Boolean);
}

function nextFreeSlot(items) {
  const used = new Set(items.map((i) => String(i.page) + ':' + String(i.slot)));
  for (let page = 1; page <= 200; page++) {
    for (let slot = 0; slot < SHOP_SLOTS_PER_PAGE; slot++) {
      if (!used.has(page + ':' + slot)) return { page, slot };
    }
  }
  throw new Error('Shop is full');
}

function validatePrices(price, sellPrice) {
  const p = Math.floor(Number(price));
  const s = Math.floor(Number(sellPrice));
  if (!Number.isFinite(p) || p < MIN_SHOP_PRICE || p > MAX_SHOP_PRICE) {
    throw new Error('Buy price must be ' + MIN_SHOP_PRICE + '–' + MAX_SHOP_PRICE + ' coins.');
  }
  if (!Number.isFinite(s) || s < 0 || s > MAX_SHOP_PRICE) {
    throw new Error('Sell price must be 0–' + MAX_SHOP_PRICE + ' coins.');
  }
  return { price: p, sellPrice: s };
}

async function ensureShopBucket() {
  if (!useSupabase()) return;
  const sb = sbClient();
  try {
    await sb.storage.createBucket(SHOP_BUCKET, {
      public: false,
      fileSizeLimit: MAX_SHOP_IMAGE_BYTES,
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    });
  } catch {
    /* exists */
  }
  try {
    await sb.storage.updateBucket(SHOP_BUCKET, {
      public: false,
      fileSizeLimit: String(MAX_SHOP_IMAGE_BYTES),
      allowedMimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    });
  } catch {
    /* ignore */
  }
}

export async function createOwnerShopItem({ label, price, sellPrice, buffer, contentType }) {
  if (!buffer || !buffer.length) throw new Error('Image is required.');
  if (buffer.length > MAX_SHOP_IMAGE_BYTES) throw new Error('Image must be 1.5 MB or smaller.');
  const ext = extFromContentType(contentType) || sniffImageExt(buffer);
  if (!ext) throw new Error('File must be PNG, JPEG, WebP, or GIF.');
  const mime = contentType && String(contentType).startsWith('image/') ? String(contentType).split(';')[0] : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  const name = String(label || '').trim().slice(0, 80) || 'Shop item';
  const prices = validatePrices(price, sellPrice);
  const current = await listShopItems(null);
  const pos = nextFreeSlot(current.items);
  const id = crypto.randomUUID();
  const texture = 'shop-' + id + '.' + (ext === 'jpeg' ? 'jpg' : ext);
  const storagePath = id + '.' + (ext === 'jpeg' ? 'jpg' : ext);
  const createdAt = Date.now();

  if (useSupabase()) {
    await ensureShopBucket();
    const sb = sbClient();
    const { error: upErr } = await sb.storage.from(SHOP_BUCKET).upload(storagePath, buffer, {
      contentType: mime,
      upsert: false,
    });
    if (upErr) throw new Error(upErr.message);
    const row = {
      id,
      label: name,
      texture,
      price: prices.price,
      sell_price: prices.sellPrice,
      page: pos.page,
      slot: pos.slot,
      storage_path: storagePath,
      mime_type: mime,
      created_at: createdAt,
    };
    const { error } = await sb.from('skyhop_shop_items').insert(row);
    if (error) {
      await sb.storage.from(SHOP_BUCKET).remove([storagePath]);
      if (/skyhop_shop_items|relation|column/i.test(String(error.message || ''))) {
        throw new Error('Run server/supabase/extend_v24_shop_items.sql in Supabase, then try again.');
      }
      throw new Error(error.message);
    }
    return publicShopItem(mapOwnerRow(row));
  }

  const db = fileLoad();
  const diskPath = path.join(FILES_DIR, storagePath);
  fs.writeFileSync(diskPath, buffer);
  const rec = {
    id,
    label: name,
    texture,
    price: prices.price,
    sellPrice: prices.sellPrice,
    page: pos.page,
    slot: pos.slot,
    storagePath,
    mimeType: mime,
    createdAt,
  };
  db.items.push(rec);
  fileSave(db);
  return publicShopItem(mapOwnerRow(rec));
}

export async function readShopSkinByTexture(filename) {
  const item = await findShopItemByTexture(filename);
  if (!item || item.source !== 'owner') return null;
  if (useSupabase()) {
    const sb = sbClient();
    const { data, error } = await sb.storage.from(SHOP_BUCKET).download(item.storagePath);
    if (error) throw new Error(error.message);
    const buf = Buffer.from(await data.arrayBuffer());
    return { buffer: buf, mimeType: item.mimeType || 'image/png' };
  }
  const fp = path.join(FILES_DIR, item.storagePath);
  if (!fs.existsSync(fp)) throw new Error('Image missing');
  return { buffer: fs.readFileSync(fp), mimeType: item.mimeType || 'image/png' };
}
