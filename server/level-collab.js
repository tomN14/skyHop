/**
 * Shared level editing. The level author is the host.
 * Viewers can look, suggestors can propose a note, editors can save the draft.
 * Only the host can change roles or enable the AI Assistant.
 */
const KEY = 'level_collab';
const MEMBER_CAP = 12;
const SUGGESTION_CAP = 40;
const ROLES = ['viewer', 'suggestor', 'editor'];

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
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('Collaboration storage is not configured.');
  await store.setSiteContentPayload(KEY, bag);
}

function idOf(value) {
  return String(value || '');
}

export function normalizeRole(role) {
  const name = String(role || '').trim().toLowerCase();
  if (!ROLES.includes(name)) throw new Error('Choose Viewer, Suggestor, or Editor.');
  return name;
}

function session(bag, levelId) {
  return bag.levels[idOf(levelId)] || null;
}

export async function memberRole(store, levelId, userId) {
  const bag = await load(store);
  const row = session(bag, levelId);
  if (!row) return null;
  const member = (row.members || []).find((item) => idOf(item.userId) === idOf(userId));
  return member ? member.role : null;
}

export async function levelsForUser(store, userId) {
  const bag = await load(store);
  const out = [];
  for (const levelId of Object.keys(bag.levels)) {
    const row = bag.levels[levelId];
    const member = (row.members || []).find((item) => idOf(item.userId) === idOf(userId));
    if (member) out.push({ levelId, role: member.role });
  }
  return out;
}

function ensureSession(bag, level, host) {
  const id = idOf(level.id);
  if (!bag.levels[id]) {
    bag.levels[id] = { hostId: idOf(host.id), members: [], suggestions: [] };
  }
  bag.levels[id].hostId = idOf(host.id);
  bag.levels[id].members = Array.isArray(bag.levels[id].members) ? bag.levels[id].members : [];
  bag.levels[id].suggestions = Array.isArray(bag.levels[id].suggestions) ? bag.levels[id].suggestions : [];
  return bag.levels[id];
}

function assertHost(level, host) {
  if (!level || idOf(level.authorId) !== idOf(host && host.id)) {
    throw new Error('Only the host can change collaborator permissions.');
  }
  if (level.published) throw new Error('Published levels cannot be shared for editing.');
}

export async function setMember(store, host, level, person, role) {
  assertHost(level, host);
  if (!person || !person.id) throw new Error('No player with that name.');
  if (idOf(person.id) === idOf(host.id)) throw new Error('You are already the host.');
  const cleanRole = normalizeRole(role);
  const bag = await load(store);
  const row = ensureSession(bag, level, host);
  const existing = row.members.find((item) => idOf(item.userId) === idOf(person.id));
  if (!existing && row.members.length >= MEMBER_CAP) {
    throw new Error('This level already has ' + MEMBER_CAP + ' collaborators.');
  }
  if (existing) {
    existing.role = cleanRole;
    existing.username = person.username || existing.username;
  } else {
    row.members.push({
      userId: idOf(person.id),
      username: String(person.username || ''),
      role: cleanRole,
      addedAt: Date.now(),
    });
  }
  await save(store, bag);
  return view(row, 'host', host.id);
}

export async function removeMember(store, host, level, username) {
  assertHost(level, host);
  const wanted = String(username || '').trim().toLowerCase();
  if (!wanted) throw new Error('Enter the player name.');
  const bag = await load(store);
  const row = session(bag, level.id);
  if (!row) throw new Error('That player is not on this level.');
  const before = row.members.length;
  row.members = row.members.filter((item) => String(item.username || '').toLowerCase() !== wanted);
  if (row.members.length === before) throw new Error('That player is not on this level.');
  await save(store, bag);
  return view(row, 'host', host.id);
}

export async function suggest(store, user, levelId, text) {
  const role = await memberRole(store, levelId, user.id);
  if (role !== 'suggestor') throw new Error('Only a suggestor can propose a change.');
  const note = String(text || '').trim().slice(0, 1000);
  if (!note) throw new Error('Describe the change you want the host to consider.');
  const bag = await load(store);
  const row = session(bag, levelId);
  if (!row) throw new Error('Only a suggestor can propose a change.');
  row.suggestions = Array.isArray(row.suggestions) ? row.suggestions : [];
  row.suggestions.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    userId: idOf(user.id),
    username: String(user.username || ''),
    at: Date.now(),
    text: note,
    status: 'pending',
  });
  if (row.suggestions.length > SUGGESTION_CAP) row.suggestions = row.suggestions.slice(-SUGGESTION_CAP);
  await save(store, bag);
  return view(row, 'suggestor', user.id);
}

export async function reviewSuggestion(store, host, level, suggestionId, accept) {
  assertHost(level, host);
  const bag = await load(store);
  const row = session(bag, level.id);
  if (!row) throw new Error('That suggestion is not on this level.');
  const item = (row.suggestions || []).find((entry) => entry.id === String(suggestionId || ''));
  if (!item) throw new Error('That suggestion is not on this level.');
  item.status = accept ? 'accepted' : 'dismissed';
  await save(store, bag);
  return view(row, 'host', host.id);
}

export function view(row, role, userId) {
  const members = (row && row.members ? row.members : []).map((item) => {
    const member = { username: item.username, role: item.role };
    if (role === 'host') member.userId = item.userId;
    return member;
  });
  const suggestions = (row && row.suggestions ? row.suggestions : [])
    .filter((item) => role === 'host' || (role === 'suggestor' && idOf(item.userId) === idOf(userId)))
    .map((item) => ({
      id: item.id,
      username: item.username,
      at: item.at,
      text: item.text,
      status: item.status || 'pending',
    }));
  return { role, members, suggestions };
}

export async function viewFor(store, levelId, role, userId) {
  const bag = await load(store);
  return view(session(bag, levelId), role, userId);
}

export async function forget(store, levelId) {
  const bag = await load(store);
  if (!bag.levels[idOf(levelId)]) return;
  delete bag.levels[idOf(levelId)];
  await save(store, bag);
}
