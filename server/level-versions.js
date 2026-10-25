/**
 * Saved drafts of a level. Each save keeps a copy the host can restore.
 * The copies stay out of the playable level JSON.
 */
import * as UserLevels from './user-levels.js';

const KEY = 'level_versions';
const VERSION_CAP = 30;

function empty() {
  return { levels: {} };
}

async function load(store) {
  const bag = empty();
  if (typeof store.getSiteContentPayload !== 'function') return bag;
  const row = await store.getSiteContentPayload(KEY);
  if (!row || typeof row !== 'object') return bag;
  bag.levels = row.levels && typeof row.levels === 'object' ? row.levels : {};
  return bag;
}

async function save(store, bag) {
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('Version storage is not configured.');
  await store.setSiteContentPayload(KEY, bag);
}

function idOf(value) {
  return String(value || '');
}

function publicVersion(item) {
  return {
    id: item.id,
    n: item.n,
    at: item.at,
    username: item.username || '',
    title: item.title || '',
  };
}

export async function record(store, levelId, user, title, data) {
  const clean = UserLevels.validateLevelData(data);
  const bag = await load(store);
  const id = idOf(levelId);
  if (!bag.levels[id] || typeof bag.levels[id] !== 'object') bag.levels[id] = { versions: [] };
  const versions = Array.isArray(bag.levels[id].versions) ? bag.levels[id].versions : [];
  const last = versions.length ? versions[versions.length - 1] : null;
  versions.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    n: last && last.n ? last.n + 1 : versions.length + 1,
    at: Date.now(),
    userId: idOf(user && user.id),
    username: String((user && user.username) || '').slice(0, 40),
    title: String(title || '').slice(0, 80),
    data: clean,
  });
  bag.levels[id].versions = versions.slice(-VERSION_CAP);
  await save(store, bag);
}

export async function list(store, levelId) {
  const bag = await load(store);
  const row = bag.levels[idOf(levelId)];
  const versions = row && Array.isArray(row.versions) ? row.versions : [];
  return versions.map(publicVersion);
}

export async function revert(store, host, level, versionId) {
  if (!level || idOf(level.authorId) !== idOf(host && host.id)) throw new Error('Only the host can revert this level.');
  if (level.published) throw new Error('Published levels cannot be changed.');
  const bag = await load(store);
  const row = bag.levels[idOf(level.id)];
  const versions = row && Array.isArray(row.versions) ? row.versions : [];
  const item = versions.find((entry) => entry.id === String(versionId || ''));
  if (!item || !item.data) throw new Error('That version is not on this level.');
  const title = item.title || level.title;
  await UserLevels.levelsUpdateDraft(host.id, level.id, title, item.data);
  await record(store, level.id, host, title, item.data);
  const listed = await list(store, level.id);
  return { versions: listed, applied: { title: String(title || ''), data: item.data } };
}

export async function forget(store, levelId) {
  const bag = await load(store);
  if (!bag.levels[idOf(levelId)]) return;
  delete bag.levels[idOf(levelId)];
  await save(store, bag);
}
