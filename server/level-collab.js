/**
 * Shared level editing. The level author is the host.
 * Viewers can look, suggestors can send an edit for review, editors can save the draft.
 * The host or an editor can accept a suggestion, which updates the level. Only the host can publish.
 */
import * as LevelVersions from './level-versions.js';

const KEY = 'level_collab';
const MEMBER_CAP = 12;
const SUGGESTION_CAP = 20;
const PENDING_CAP = 8;
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
  if (idOf(row.hostId) === idOf(userId)) return null;
  const member = (row.members || []).find((item) => idOf(item.userId) === idOf(userId));
  if (member) return member.role;
  if (row.everyoneEditor) return 'editor';
  return null;
}

export async function levelsForUser(store, userId) {
  const bag = await load(store);
  const out = [];
  for (const levelId of Object.keys(bag.levels)) {
    const row = bag.levels[levelId];
    if (idOf(row.hostId) === idOf(userId)) continue;
    const member = (row.members || []).find((item) => idOf(item.userId) === idOf(userId));
    if (member) out.push({ levelId, role: member.role });
    else if (row.everyoneEditor) out.push({ levelId, role: 'editor' });
  }
  return out;
}

export async function setEveryoneEditor(store, host, level, on) {
  assertHost(level, host);
  const bag = await load(store);
  const row = ensureSession(bag, level, host);
  row.everyoneEditor = !!on;
  await save(store, bag);
  return view(row, 'host', host.id);
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

function trimSuggestions(row) {
  const pending = (row.suggestions || []).filter((item) => item.status === 'pending');
  const older = (row.suggestions || []).filter((item) => item.status !== 'pending');
  while (pending.length > PENDING_CAP) pending.shift();
  row.suggestions = older.slice(-12).concat(pending).slice(-SUGGESTION_CAP);
}

export async function suggest(store, user, levelId, text, levelData, title, UserLevels) {
  const role = await memberRole(store, levelId, user.id);
  if (role !== 'suggestor') throw new Error('Only a suggestor can propose a change.');
  const note = String(text || '').trim().slice(0, 1000);
  let data = null;
  if (levelData && typeof levelData === 'object') data = UserLevels.validateLevelData(levelData);
  if (!note && !data) throw new Error('Edit the level, then choose Suggest.');
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
    title: String(title || '').slice(0, 80),
    data,
    status: 'pending',
  });
  trimSuggestions(row);
  await save(store, bag);
  return view(row, 'suggestor', user.id);
}

async function assertReviewer(store, user, level) {
  const isHost = !!(level && idOf(level.authorId) === idOf(user && user.id));
  if (!isHost) {
    const role = await memberRole(store, level && level.id, user && user.id);
    if (role !== 'editor') throw new Error('Only the host or an editor can review a suggestion.');
  }
  if (level.published) throw new Error('Published levels cannot be changed.');
  return isHost;
}

export async function reviewSuggestion(store, user, level, suggestionId, accept, UserLevels) {
  const isHost = await assertReviewer(store, user, level);
  const bag = await load(store);
  const row = session(bag, level.id);
  if (!row) throw new Error('That suggestion is not on this level.');
  const item = (row.suggestions || []).find((entry) => entry.id === String(suggestionId || ''));
  if (!item) throw new Error('That suggestion is not on this level.');
  if (item.status !== 'pending') throw new Error('That suggestion was already reviewed.');
  let applied = null;
  if (accept && item.data) {
    const previous = { title: level.title || '', data: JSON.parse(JSON.stringify(level.data)) };
    const title = item.title || level.title;
    await UserLevels.levelsUpdateDraft(user.id, level.id, title, item.data, undefined, { asCollaborator: !isHost });
    await LevelVersions.record(store, level.id, user, title, item.data);
    row.revert = previous;
    applied = { title: String(title || ''), data: item.data };
  }
  item.status = accept ? 'accepted' : 'dismissed';
  delete item.data;
  await save(store, bag);
  const out = view(row, isHost ? 'host' : 'editor', user.id);
  if (applied) out.applied = applied;
  out.changedLevel = !!applied;
  return out;
}

export async function undoAccepted(store, user, level, UserLevels) {
  const isHost = await assertReviewer(store, user, level);
  const bag = await load(store);
  const row = session(bag, level.id);
  if (!row || !row.revert || !row.revert.data) throw new Error('Nothing to undo.');
  const title = row.revert.title || level.title;
  const data = row.revert.data;
  await UserLevels.levelsUpdateDraft(user.id, level.id, title, data, undefined, { asCollaborator: !isHost });
  await LevelVersions.record(store, level.id, user, title, data);
  delete row.revert;
  await save(store, bag);
  const out = view(row, isHost ? 'host' : 'editor', user.id);
  out.applied = { title: String(title || ''), data };
  out.changedLevel = true;
  return out;
}

export async function clearRevert(store, levelId) {
  const bag = await load(store);
  const row = session(bag, levelId);
  if (!row || !row.revert) return;
  delete row.revert;
  await save(store, bag);
}

export function view(row, role, userId) {
  const members = (row && row.members ? row.members : []).map((item) => {
    const member = { username: item.username, role: item.role };
    if (role === 'host') member.userId = item.userId;
    return member;
  });
  const suggestions = (row && row.suggestions ? row.suggestions : [])
    .filter((item) => role === 'host' || role === 'editor' || (role === 'suggestor' && idOf(item.userId) === idOf(userId)))
    .map((item) => ({
      id: item.id,
      username: item.username,
      at: item.at,
      text: item.text,
      status: item.status || 'pending',
      hasEdit: !!item.data,
    }));
  return {
    role,
    members,
    suggestions,
    canUndoAccept: (role === 'host' || role === 'editor') && !!(row && row.revert && row.revert.data),
    everyoneEditor: !!(row && row.everyoneEditor),
  };
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
