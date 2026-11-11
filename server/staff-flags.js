/**
 * Extra staff flags the owner hands out by name.
 * levelMod can nominate levels for awards or campaign stages.
 * skinCurator can edit or remove other people's shop skins (requires graphic designer).
 */
const KEY = 'staff_flags';

function empty() {
  return { levelMods: {}, skinCurators: {} };
}

async function load(store) {
  const bag = empty();
  if (typeof store.getSiteContentPayload !== 'function') return bag;
  const row = await store.getSiteContentPayload(KEY);
  if (!row || typeof row !== 'object') return bag;
  bag.levelMods = row.levelMods && typeof row.levelMods === 'object' ? row.levelMods : {};
  bag.skinCurators = row.skinCurators && typeof row.skinCurators === 'object' ? row.skinCurators : {};
  return bag;
}

async function save(store, bag) {
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('Staff flag storage is not configured.');
  await store.setSiteContentPayload(KEY, bag);
}

function idOf(value) {
  return String(value || '');
}

export async function isLevelMod(store, userId) {
  const bag = await load(store);
  return !!bag.levelMods[idOf(userId)];
}

export async function isSkinCurator(store, userId) {
  const bag = await load(store);
  return !!bag.skinCurators[idOf(userId)];
}

export async function setLevelMod(store, userId, on) {
  const bag = await load(store);
  if (on) bag.levelMods[idOf(userId)] = true;
  else delete bag.levelMods[idOf(userId)];
  await save(store, bag);
  return { levelMod: !!on };
}

export async function setSkinCurator(store, userId, on) {
  const bag = await load(store);
  if (on) bag.skinCurators[idOf(userId)] = true;
  else delete bag.skinCurators[idOf(userId)];
  await save(store, bag);
  return { skinCurator: !!on };
}

export async function listLevelMods(store) {
  const bag = await load(store);
  return Object.keys(bag.levelMods);
}

export async function listSkinCurators(store) {
  const bag = await load(store);
  return Object.keys(bag.skinCurators);
}

export async function flagsFor(store, userId) {
  const bag = await load(store);
  return {
    levelMod: !!bag.levelMods[idOf(userId)],
    skinCurator: !!bag.skinCurators[idOf(userId)],
  };
}
