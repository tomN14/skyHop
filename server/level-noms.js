/**
 * Level award / campaign-stage nominations.
 * Level mods send nominations. Admins can only forward them to the owner.
 * Only the owner awards or places a stage.
 */
import { censorProfanity } from './profanity-filter.js';
import { effectiveRole, hasAdminPowers } from './moderation.js';
import * as UserLevels from './user-levels.js';
import * as CustomWorlds from './custom-worlds.js';

const KEY = 'level_noms';
const CAP = 80;

function empty() {
  return { items: [] };
}

async function load(store) {
  const bag = empty();
  if (typeof store.getSiteContentPayload !== 'function') return bag;
  const row = await store.getSiteContentPayload(KEY);
  if (!row || typeof row !== 'object') return bag;
  bag.items = Array.isArray(row.items) ? row.items : [];
  return bag;
}

async function save(store, bag) {
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('Nomination storage is not configured.');
  await store.setSiteContentPayload(KEY, bag);
}

function idOf(value) {
  return String(value || '');
}

function publicItem(item) {
  return {
    id: item.id,
    kind: item.kind,
    levelId: item.levelId,
    title: item.title,
    authorUsername: item.authorUsername || '',
    note: item.note || '',
    world: item.world || null,
    stage: item.stage || null,
    status: item.status,
    fromUsername: item.fromUsername,
    fromRole: item.fromRole,
    at: item.at,
    forwardedAt: item.forwardedAt || null,
    forwardedBy: item.forwardedBy || null,
    decidedAt: item.decidedAt || null,
    decidedBy: item.decidedBy || null,
    reason: item.reason || '',
  };
}

export function canNominate(user, flags) {
  return !!(flags && flags.levelMod) || effectiveRole(user) === 'owner';
}

export function canForward(user) {
  const role = effectiveRole(user);
  return role === 'owner' || hasAdminPowers(role);
}

export async function nominate(store, user, flags, body) {
  if (!canNominate(user, flags)) throw new Error('Only a level mod can nominate a level.');
  const levelId = String(body.levelId || body.id || '').trim();
  const level = await UserLevels.levelsGetById(levelId, null);
  if (!level || !level.published) throw new Error('Only a published level can be nominated.');
  const kind = String(body.kind || 'award').trim().toLowerCase() === 'stage' ? 'stage' : 'award';
  let world = null;
  let stage = null;
  if (kind === 'stage') {
    world = Math.round(Number(body.world));
    stage = Math.round(Number(body.stage));
    if (!Number.isFinite(world) || world < 1 || world > 50) throw new Error('Pick a world number from 1 to 50.');
    if (!Number.isFinite(stage) || stage < 1 || stage > 200) throw new Error('Pick a stage number from 1 to 200.');
  }
  const note = censorProfanity(String(body.note || '')).text.trim().slice(0, 500);
  const meta = await UserLevels.levelsPublishedMetaById(levelId);
  const bag = await load(store);
  const item = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    kind,
    levelId,
    title: level.title || (meta && meta.title) || 'Level',
    authorId: level.authorId,
    authorUsername: (meta && meta.author_username) || '',
    note,
    world,
    stage,
    status: 'pending_admin',
    fromUserId: idOf(user.id),
    fromUsername: String(user.username || ''),
    fromRole: flags && flags.levelMod ? 'level_mod' : effectiveRole(user),
    at: Date.now(),
  };
  bag.items.push(item);
  if (bag.items.length > CAP) bag.items = bag.items.slice(-CAP);
  await save(store, bag);
  return publicItem(item);
}

export async function forwardToOwner(store, user, nominationId) {
  if (!canForward(user)) throw new Error('Only an admin can send a nomination to the owner.');
  const bag = await load(store);
  const item = bag.items.find((entry) => entry.id === String(nominationId || ''));
  if (!item) throw new Error('That nomination is not here.');
  if (item.status !== 'pending_admin') throw new Error('That nomination was already handled.');
  item.status = 'pending_owner';
  item.forwardedAt = Date.now();
  item.forwardedBy = String(user.username || '');
  await save(store, bag);
  return publicItem(item);
}

export async function decide(store, user, nominationId, accept, reason, applyStage) {
  if (effectiveRole(user) !== 'owner') throw new Error('Only the owner can approve or decline a nomination.');
  const bag = await load(store);
  const item = bag.items.find((entry) => entry.id === String(nominationId || ''));
  if (!item) throw new Error('That nomination is not here.');
  if (item.status !== 'pending_owner' && item.status !== 'pending_admin') {
    throw new Error('That nomination was already decided.');
  }
  const note = censorProfanity(String(reason || '')).text.trim().slice(0, 500);
  if (accept) {
    if (item.kind === 'award') {
      await UserLevels.levelsAward(item.levelId);
    } else if (item.kind === 'stage') {
      if (typeof applyStage !== 'function') throw new Error('Stage placement is not available.');
      await applyStage(item);
    }
    item.status = 'accepted';
  } else {
    item.status = 'declined';
  }
  item.reason = note;
  item.decidedAt = Date.now();
  item.decidedBy = String(user.username || '');
  await save(store, bag);
  return publicItem(item);
}

export async function listFor(store, user) {
  const role = effectiveRole(user);
  const bag = await load(store);
  let items = bag.items.slice();
  if (role === 'owner') {
    items = items.filter((item) => item.status === 'pending_owner' || item.status === 'pending_admin' || item.status === 'accepted' || item.status === 'declined');
  } else if (hasAdminPowers(role)) {
    items = items.filter((item) => item.status === 'pending_admin' || item.status === 'pending_owner');
  } else {
    items = items.filter((item) => idOf(item.fromUserId) === idOf(user.id));
  }
  return items
    .slice()
    .reverse()
    .slice(0, 60)
    .map(publicItem);
}

function fillStage(stages, stage, stageData) {
  const next = Array.isArray(stages) ? stages.slice() : [];
  while (next.length < stage) {
    next.push({
      worldW: 1400,
      worldH: 720,
      spawn: { x: 80, y: 520 },
      goal: { x: 1180, y: 460, w: 72, h: 96 },
      platforms: [{ x: 0, y: 620, w: 1400, h: 120 }],
    });
  }
  next[stage - 1] = stageData;
  return next;
}

/** Place a published level into a campaign world/stage slot. */
export async function placeAsStage(store, item) {
  const level = await UserLevels.levelsGetById(item.levelId, null);
  if (!level || !level.data) throw new Error('That level is gone.');
  const world = Number(item.world);
  const stage = Number(item.stage);
  const stageData = JSON.parse(JSON.stringify(level.data));
  if (world === 1) {
    if (typeof store.getBuiltinCampaignStages !== 'function' || typeof store.setBuiltinCampaignStages !== 'function') {
      throw new Error('World 1 stages are not configured.');
    }
    const current = (await store.getBuiltinCampaignStages()) || [];
    if (!current.length) throw new Error('Open World 1 in the owner campaign editor and save it once before placing a stage.');
    const next = fillStage(current, stage, stageData);
    await store.setBuiltinCampaignStages(next);
    return { world, stage, count: next.length };
  }
  if (world === 2) {
    if (typeof store.getBuiltinWorld2Stages !== 'function' || typeof store.setBuiltinWorld2Stages !== 'function') {
      throw new Error('World 2 stages are not configured.');
    }
    const current = (await store.getBuiltinWorld2Stages()) || [];
    if (!current.length) throw new Error('Open World 2 in the owner campaign editor and save it once before placing a stage.');
    const next = fillStage(current, stage, stageData);
    await store.setBuiltinWorld2Stages(next);
    return { world, stage, count: next.length };
  }
  const pack = await CustomWorlds.getCustomWorldStages(world);
  if (!pack) throw new Error('Unknown world.');
  const next = fillStage(pack.stages || [], stage, stageData);
  await CustomWorlds.setCustomWorldStages(world, next);
  return { world, stage, count: next.length };
}
