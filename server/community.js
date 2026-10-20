/**
 * Announcements, player warnings, polls, level collections, play time, and stat overrides.
 * Stored in site content so file and Supabase deploys share it.
 */
import crypto from 'crypto';

const KEY = 'community';

function empty() {
  return {
    announcements: [],
    warnings: [],
    seen: {},
    polls: [],
    collections: [],
    playTime: {},
    statOverrides: {},
    collectionClears: {},
  };
}

async function load(store) {
  if (typeof store.getSiteContentPayload !== 'function') return empty();
  const row = await store.getSiteContentPayload(KEY);
  const bag = empty();
  if (!row || typeof row !== 'object') return bag;
  bag.announcements = Array.isArray(row.announcements) ? row.announcements : [];
  bag.warnings = Array.isArray(row.warnings) ? row.warnings : [];
  bag.seen = row.seen && typeof row.seen === 'object' ? row.seen : {};
  bag.polls = Array.isArray(row.polls) ? row.polls : [];
  bag.collections = Array.isArray(row.collections) ? row.collections : [];
  bag.playTime = row.playTime && typeof row.playTime === 'object' ? row.playTime : {};
  bag.statOverrides = row.statOverrides && typeof row.statOverrides === 'object' ? row.statOverrides : {};
  bag.collectionClears = row.collectionClears && typeof row.collectionClears === 'object' ? row.collectionClears : {};
  return bag;
}

async function save(store, bag) {
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('Community storage is not configured.');
  await store.setSiteContentPayload(KEY, bag);
}

function uid(id) {
  return String(id || '');
}

function cleanText(raw, max) {
  return String(raw || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

export async function pendingNotices(store, user) {
  const bag = await load(store);
  const seen = new Set(bag.seen[uid(user.id)] || []);
  const announcements = bag.announcements.filter((row) => row && !seen.has(row.id));
  const warnings = bag.warnings.filter((row) => row && uid(row.userId) === uid(user.id) && !seen.has(row.id));
  return { announcements, warnings };
}

export async function ackNotices(store, user, ids) {
  const bag = await load(store);
  const key = uid(user.id);
  const cur = new Set(bag.seen[key] || []);
  for (const id of Array.isArray(ids) ? ids : []) {
    if (id) cur.add(String(id));
  }
  bag.seen[key] = [...cur].slice(-200);
  await save(store, bag);
  return { ok: true };
}

export async function listAnnouncements(store) {
  const bag = await load(store);
  return { announcements: bag.announcements };
}

export async function addAnnouncement(store, text) {
  const body = cleanText(text, 800);
  if (!body) throw new Error('Write an announcement.');
  const bag = await load(store);
  bag.announcements.push({ id: crypto.randomUUID(), text: body, createdAt: Date.now() });
  await save(store, bag);
  return { announcements: bag.announcements };
}

export async function deleteAnnouncement(store, id) {
  const bag = await load(store);
  bag.announcements = bag.announcements.filter((row) => row.id !== id);
  await save(store, bag);
  return { announcements: bag.announcements };
}

export async function addWarning(store, username, text, findUser) {
  const body = cleanText(text, 800);
  if (!body) throw new Error('Write a warning.');
  const user = await findUser(username);
  if (!user) throw new Error('User not found.');
  const bag = await load(store);
  bag.warnings.push({
    id: crypto.randomUUID(),
    userId: uid(user.id),
    username: user.username,
    text: body,
    createdAt: Date.now(),
  });
  await save(store, bag);
  return { warnings: bag.warnings };
}

export async function listWarnings(store) {
  const bag = await load(store);
  return { warnings: bag.warnings };
}

export async function deleteWarning(store, id) {
  const bag = await load(store);
  bag.warnings = bag.warnings.filter((row) => row.id !== id);
  await save(store, bag);
  return { warnings: bag.warnings };
}

function publicPoll(poll, userId) {
  const counts = (poll.options || []).map(() => 0);
  const votes = poll.votes && typeof poll.votes === 'object' ? poll.votes : {};
  for (const key of Object.keys(votes)) {
    const idx = Number(votes[key]);
    if (idx >= 0 && idx < counts.length) counts[idx] += 1;
  }
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options,
    authorName: poll.authorName,
    createdAt: poll.createdAt,
    counts,
    yourVote: votes[uid(userId)] != null ? Number(votes[uid(userId)]) : null,
    authorId: poll.authorId,
  };
}

export async function listPolls(store, userId) {
  const bag = await load(store);
  return { polls: bag.polls.map((poll) => publicPoll(poll, userId)) };
}

export async function createPoll(store, user, question, options) {
  const q = cleanText(question, 160);
  const opts = (Array.isArray(options) ? options : []).map((row) => cleanText(row, 80)).filter(Boolean);
  if (!q) throw new Error('Write a question.');
  if (opts.length < 2 || opts.length > 6) throw new Error('A poll needs 2 to 6 options.');
  const bag = await load(store);
  if (bag.polls.filter((poll) => uid(poll.authorId) === uid(user.id)).length >= 20) {
    throw new Error('You can have 20 polls.');
  }
  bag.polls.unshift({
    id: crypto.randomUUID(),
    authorId: uid(user.id),
    authorName: user.username,
    question: q,
    options: opts,
    votes: {},
    createdAt: Date.now(),
  });
  await save(store, bag);
  return listPolls(store, user.id);
}

export async function votePoll(store, user, pollId, optionIndex) {
  const bag = await load(store);
  const poll = bag.polls.find((row) => row.id === pollId);
  if (!poll) throw new Error('Poll not found.');
  const idx = Math.floor(Number(optionIndex));
  if (!Number.isFinite(idx) || idx < 0 || idx >= poll.options.length) throw new Error('Pick an option.');
  if (!poll.votes || typeof poll.votes !== 'object') poll.votes = {};
  poll.votes[uid(user.id)] = idx;
  await save(store, bag);
  return listPolls(store, user.id);
}

export async function deletePoll(store, user, pollId, isOwner) {
  const bag = await load(store);
  const poll = bag.polls.find((row) => row.id === pollId);
  if (!poll) throw new Error('Poll not found.');
  if (!isOwner && uid(poll.authorId) !== uid(user.id)) throw new Error('That poll is not yours.');
  bag.polls = bag.polls.filter((row) => row.id !== pollId);
  await save(store, bag);
  return listPolls(store, user.id);
}

function publicCollection(row, userId) {
  return {
    id: row.id,
    title: row.title,
    ownerId: row.ownerId,
    ownerName: row.ownerName,
    published: !!row.published,
    stageCount: (row.stages || []).length,
    stages: (row.stages || []).map((stage) => ({
      levelId: stage.levelId,
      title: stage.title || '',
      musicName: stage.musicName || '',
    })),
    sharedScript: uid(row.ownerId) === uid(userId) ? row.sharedScript || '' : undefined,
    yours: uid(row.ownerId) === uid(userId),
  };
}

export async function searchCollections(store, userId, q) {
  const bag = await load(store);
  const query = String(q || '').trim().toLowerCase();
  const rows = bag.collections.filter((row) => {
    if (!row.published && uid(row.ownerId) !== uid(userId)) return false;
    if (!query) return true;
    return String(row.title || '').toLowerCase().includes(query) || String(row.ownerName || '').toLowerCase().includes(query);
  });
  return { collections: rows.slice(0, 40).map((row) => publicCollection(row, userId)) };
}

export async function saveCollection(store, user, body) {
  const title = cleanText(body && body.title, 80);
  if (!title) throw new Error('Name the collection.');
  const stages = (Array.isArray(body.stages) ? body.stages : [])
    .map((stage) => ({
      levelId: String(stage.levelId || '').trim(),
      title: cleanText(stage.title, 80),
      script: String(stage.script || '').slice(0, 20000),
      musicName: cleanText(stage.musicName, 80),
    }))
    .filter((stage) => stage.levelId)
    .slice(0, 30);
  if (!stages.length) throw new Error('Add at least one level.');
  const bag = await load(store);
  const mine = bag.collections.filter((row) => uid(row.ownerId) === uid(user.id));
  let row = body.id ? bag.collections.find((item) => item.id === body.id) : null;
  if (row && uid(row.ownerId) !== uid(user.id)) throw new Error('That collection is not yours.');
  if (!row && mine.length >= 20) throw new Error('You can have 20 collections.');
  if (!row) {
    row = { id: crypto.randomUUID(), ownerId: uid(user.id), ownerName: user.username, createdAt: Date.now() };
    bag.collections.unshift(row);
  }
  row.title = title;
  row.stages = stages;
  row.sharedScript = String(body.sharedScript || '').slice(0, 20000);
  row.ownerName = user.username;
  if (body.publish) {
    const clears = bag.collectionClears[row.id] || {};
    const ready = stages.every((_, index) => clears[String(index)]);
    if (!ready) throw new Error('Beat every stage in this collection before publishing.');
    row.published = true;
  }
  await save(store, bag);
  return publicCollection(row, user.id);
}

export async function markCollectionStage(store, user, collectionId, stageIndex) {
  const bag = await load(store);
  const row = bag.collections.find((item) => item.id === collectionId);
  if (!row || uid(row.ownerId) !== uid(user.id)) throw new Error('That collection is not yours.');
  const idx = Math.floor(Number(stageIndex));
  if (!row.stages[idx]) throw new Error('Unknown stage.');
  if (!bag.collectionClears[row.id]) bag.collectionClears[row.id] = {};
  bag.collectionClears[row.id][String(idx)] = Date.now();
  await save(store, bag);
  return { ok: true, cleared: Object.keys(bag.collectionClears[row.id]).length, stageCount: row.stages.length };
}

export async function getCollection(store, userId, id) {
  const bag = await load(store);
  const row = bag.collections.find((item) => item.id === id);
  if (!row) throw new Error('Collection not found.');
  if (!row.published && uid(row.ownerId) !== uid(userId)) throw new Error('That collection is not published.');
  return {
    ...publicCollection(row, userId),
    stages: row.stages.map((stage) => ({
      levelId: stage.levelId,
      title: stage.title || '',
      script: stage.script || '',
      musicName: stage.musicName || '',
    })),
    sharedScript: row.sharedScript || '',
  };
}

export async function addPlayTime(store, userId, ms) {
  const add = Math.max(0, Math.min(300000, Math.floor(Number(ms) || 0)));
  if (!add) return { playTimeMs: 0 };
  const bag = await load(store);
  const key = uid(userId);
  bag.playTime[key] = Math.max(0, Math.floor(Number(bag.playTime[key]) || 0)) + add;
  await save(store, bag);
  return { playTimeMs: bag.playTime[key] };
}

export async function playTimeOf(store, userId) {
  const bag = await load(store);
  return Math.max(0, Math.floor(Number(bag.playTime[uid(userId)]) || 0));
}

export async function setStatOverride(store, userId, patch) {
  const bag = await load(store);
  const prev = bag.statOverrides[uid(userId)] || {};
  const next = { ...prev };
  if (String(patch.bestTimeMs ?? '').trim() !== '') next.bestTimeMs = Math.max(0, Math.floor(Number(patch.bestTimeMs) || 0));
  if (String(patch.runCount ?? '').trim() !== '') next.runCount = Math.max(0, Math.floor(Number(patch.runCount) || 0));
  if (String(patch.totalDeaths ?? '').trim() !== '') next.totalDeaths = Math.max(0, Math.floor(Number(patch.totalDeaths) || 0));
  bag.statOverrides[uid(userId)] = next;
  await save(store, bag);
  return next;
}

export async function statOverrideOf(store, userId) {
  const bag = await load(store);
  return bag.statOverrides[uid(userId)] || null;
}

export async function payWeeklySalaries(store, state) {
  const monthKey = new Date().toISOString().slice(0, 7);
  if (!state || state.salariesPaidFor === monthKey) return;
  state.salariesPaidFor = monthKey;
  if (typeof store.listCoinHolders !== 'function' || typeof store.incrementUserCoins !== 'function') return;
  const people = await store.listCoinHolders();
  const ownerName = String(process.env.SKYHOP_OWNER_USERNAME || '').trim().toLowerCase();
  const paid = new Map();
  function isOwner(person) {
    return String(person.role || '') === 'owner' || (ownerName && String(person.usernameLower || person.username || '').toLowerCase() === ownerName);
  }
  function add(id, amount) {
    if (!id || amount <= 0) return;
    paid.set(String(id), (paid.get(String(id)) || 0) + amount);
  }
  for (const person of people) {
    const role = String(person.role || 'player');
    if (isOwner(person)) continue;
    if (role === 'report_advisor') add(person.id, 15000);
    if (role === 'moderator' || role === 'mod_admin') add(person.id, 50000);
    if (role === 'admin') add(person.id, 100000);
  }
  if (typeof store.listGraphicDesigners === 'function') {
    const designers = await store.listGraphicDesigners();
    for (const person of designers || []) {
      if (isOwner(person)) continue;
      add(person.id, 25000);
    }
  }
  const ranked = people
    .filter((person) => !isOwner(person))
    .slice()
    .sort((a, b) => (Number(b.coins) || 0) - (Number(a.coins) || 0))
    .slice(0, 10);
  ranked.forEach((person, index) => {
    const n = index + 1;
    add(person.id, Math.max(0, 15000 - 1000 * n));
  });
  for (const [id, amount] of paid) {
    await store.incrementUserCoins(id, amount);
  }
}
