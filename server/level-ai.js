/**
 * Experimental level-editor assistant.
 * Account opt-in, permanent per-level mark, and a staff-only prompt log.
 * The model call uses SKYHOP_AI_API_KEY. Without that key the assistant refuses to invent a reply.
 */
import { effectiveRole } from './moderation.js';
import { censorProfanity } from './profanity-filter.js';
import * as UserLevels from './user-levels.js';

const KEY = 'level_ai';
const PROMPT_CAP = 60;
const HOUR_MS = 60 * 60 * 1000;
const ASK_LIMIT = 30;
const recentAsks = new Map();

function empty() {
  return { experimental: {}, levels: {} };
}

async function load(store) {
  const bag = empty();
  if (typeof store.getSiteContentPayload !== 'function') return bag;
  const row = await store.getSiteContentPayload(KEY);
  if (!row || typeof row !== 'object') return bag;
  bag.experimental = row.experimental && typeof row.experimental === 'object' ? row.experimental : {};
  bag.levels = row.levels && typeof row.levels === 'object' ? row.levels : {};
  return bag;
}

async function save(store, bag) {
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('AI storage is not configured.');
  await store.setSiteContentPayload(KEY, bag);
}

function uid(id) {
  return String(id || '');
}

export async function experimentalOn(store, userId) {
  const bag = await load(store);
  return !!bag.experimental[uid(userId)];
}

export async function setExperimental(store, userId, on) {
  const bag = await load(store);
  if (on) bag.experimental[uid(userId)] = true;
  else delete bag.experimental[uid(userId)];
  await save(store, bag);
  return { experimentalFeatures: !!on };
}

export async function isEnabled(store, levelId) {
  const bag = await load(store);
  const row = bag.levels[uid(levelId)];
  return !!(row && row.enabled);
}

export async function enabledIdSet(store) {
  const bag = await load(store);
  const ids = new Set();
  for (const id of Object.keys(bag.levels)) {
    if (bag.levels[id] && bag.levels[id].enabled) ids.add(id);
  }
  return ids;
}

export async function annotateRows(store, rows) {
  if (!Array.isArray(rows)) return rows;
  const ids = await enabledIdSet(store);
  return rows.map((row) => {
    if (!row || row.id == null) return row;
    const marked = ids.has(String(row.id)) || !!(row.data && row.data.aiAssisted);
    return Object.assign({}, row, { aiAssisted: marked });
  });
}

export async function enableLevel(store, user, levelId) {
  if (!(await experimentalOn(store, user.id))) {
    throw new Error('Turn on Experimental Features in Account first.');
  }
  const stamped = await UserLevels.levelsStampAi(user.id, levelId);
  const bag = await load(store);
  const id = uid(levelId);
  const prev = bag.levels[id] && typeof bag.levels[id] === 'object' ? bag.levels[id] : {};
  bag.levels[id] = {
    enabled: true,
    enabledAt: prev.enabledAt || Date.now(),
    ownerId: uid(user.id),
    prompts: Array.isArray(prev.prompts) ? prev.prompts : [],
  };
  await save(store, bag);
  return { ok: true, aiAssisted: true, data: stamped.data };
}

export async function copyMark(store, fromId, toId, ownerId) {
  const bag = await load(store);
  const from = bag.levels[uid(fromId)];
  if (!from || !from.enabled) return;
  bag.levels[uid(toId)] = {
    enabled: true,
    enabledAt: Date.now(),
    ownerId: uid(ownerId),
    prompts: (from.prompts || []).slice(-PROMPT_CAP),
  };
  await save(store, bag);
}

function staffMayRead(user) {
  const role = effectiveRole(user);
  return role === 'owner' || role === 'admin' || role === 'mod_admin' || role === 'moderator';
}

export async function promptsForStaff(store, user, levelId) {
  if (!staffMayRead(user)) throw new Error('Staff only.');
  const bag = await load(store);
  const row = bag.levels[uid(levelId)];
  if (!row || !row.enabled) return { aiAssisted: false, prompts: [] };
  return {
    aiAssisted: true,
    enabledAt: row.enabledAt || null,
    prompts: (row.prompts || []).map((item) => ({
      at: item.at,
      prompt: item.prompt,
      explanation: item.explanation || '',
      opCount: item.opCount || 0,
      failed: !!item.failed,
    })),
  };
}

function noteAsk(userId) {
  const key = uid(userId);
  const now = Date.now();
  const prev = (recentAsks.get(key) || []).filter((t) => now - t < HOUR_MS);
  if (prev.length >= ASK_LIMIT) throw new Error('The assistant is limited to ' + ASK_LIMIT + ' requests an hour.');
  prev.push(now);
  recentAsks.set(key, prev);
}

function num(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeOps(raw) {
  const list = Array.isArray(raw) ? raw.slice(0, 40) : [];
  const ops = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const op = String(item.op || '');
    if (op === 'platform' || op === 'spike' || op === 'lava') {
      ops.push({
        op,
        x: num(item.x, -500, 9000, 0),
        y: num(item.y, -500, 5000, 0),
        w: num(item.w, 8, 2000, 80),
        h: num(item.h, 8, 800, 22),
      });
    } else if (op === 'coin' || op === 'spawn' || op === 'goal') {
      ops.push({
        op,
        x: num(item.x, -500, 9000, 80),
        y: num(item.y, -500, 5000, 400),
      });
    } else if (op === 'monster') {
      ops.push({
        op,
        x: num(item.x, -500, 9000, 200),
        y: num(item.y, -500, 5000, 400),
        w: num(item.w, 12, 400, 28),
        h: num(item.h, 12, 400, 28),
        hp: num(item.hp, 1, 100, 1),
        chase: !!item.chase,
        pattern: item.pattern === 'still' || item.pattern === 'sine' ? item.pattern : 'patrol',
      });
    } else if (op === 'boss') {
      ops.push({
        op,
        x: num(item.x, -500, 9000, 600),
        y: num(item.y, -500, 5000, 360),
        w: num(item.w, 24, 600, 64),
        h: num(item.h, 24, 600, 64),
        hp: num(item.hp, 1, 100000, 8),
        touch: item.touch !== false,
        projectile: !!item.projectile,
        laser: !!item.laser,
        win: item.win === 'goal' || item.win === 'both' ? item.win : 'boss',
      });
    }
  }
  return ops;
}

function sanitizeSpl(raw) {
  if (raw == null || raw === '') return null;
  let text = String(raw).slice(0, 20000).trim();
  if (!text) return null;
  if (!/^use\s+skyhop\s*;/i.test(text)) text = 'use skyhop;\n' + text;
  return text;
}

function levelSummary(data) {
  const d = data && typeof data === 'object' ? data : {};
  const platforms = Array.isArray(d.platforms) ? d.platforms.slice(0, 12) : [];
  return {
    worldW: d.worldW,
    worldH: d.worldH,
    spawn: d.spawn || null,
    goal: d.goal ? { x: d.goal.x, y: d.goal.y, w: d.goal.w, h: d.goal.h } : null,
    platformCount: Array.isArray(d.platforms) ? d.platforms.length : 0,
    platforms: platforms.map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h })),
    spikeCount: Array.isArray(d.spikes) ? d.spikes.length : 0,
    monsterCount: Array.isArray(d.editorMonsters) ? d.editorMonsters.length : 0,
    hasBoss: !!d.editorBoss,
    boss: d.editorBoss
      ? { x: d.editorBoss.x, y: d.editorBoss.y, w: d.editorBoss.w, h: d.editorBoss.h, hp: d.editorBoss.hp, attacks: d.editorBoss.attacks, win: d.editorBoss.win }
      : null,
    spl: String(d.spl || '').slice(0, 4000),
  };
}

const SYSTEM = [
  'You are the SkyHop level editor assistant. Reply with one JSON object and no markdown.',
  'Shape: {"explanation":"short plain text","spl":null,"ops":[]}.',
  'spl is the full script, or null when the script should stay as it is. A script starts with use skyhop;',
  'Assignment is name <- expr; . Close every block with end; . test.while(1): runs once per frame.',
  'skyhop.wait(n) pauses the script n seconds. Put waits inside test.while.',
  'skyhop.get("boss_projectile_attack") assign 1 to enable shots. skyhop.get("boss_projectile_attack_cooldown") assign seconds between shots.',
  'skyhop.get("boss_attack_projectile") assign 1 to fire a shot. skyhop.get("boss_laser_attack") and skyhop.get("boss_attack_laser") are the laser versions.',
  'Do not invent commands. A name that is not a real skyhop.get key returns 0.',
  'ops may only use platform, spike, lava, coin, spawn, goal, monster, boss.',
  'Coordinates: x grows right, y grows down. A typical world is 1400 by 720. The floor is often y 620, height 120.',
  'platform, spike, and lava need x, y, w, h. coin, spawn, and goal need x, y.',
  'monster needs x, y, w, h, hp. boss needs x, y, w, h, hp, and projectile true when it should shoot.',
  'At most 40 ops. If the creator only wants an explanation, use an empty ops list and spl null.',
  'If you change the script, return the complete script, including use skyhop; and any existing behavior that should remain.',
].join(' ');

function parseModelJson(text) {
  let raw = String(text || '').trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) raw = fence[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) throw new Error('The assistant did not return a level change.');
  return JSON.parse(raw.slice(start, end + 1));
}

async function callModel(prompt, summary) {
  const key = String(process.env.SKYHOP_AI_API_KEY || '').trim();
  if (!key) throw new Error('The assistant is not configured on this server yet.');
  const base = String(process.env.SKYHOP_AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = String(process.env.SKYHOP_AI_MODEL || 'gpt-4o-mini');
  const res = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: 'Current level:\n' + JSON.stringify(summary) + '\n\nCreator request:\n' + prompt },
      ],
    }),
    signal: AbortSignal.timeout(25000),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body && body.error && body.error.message ? body.error.message : 'The assistant request failed.';
    throw new Error(message);
  }
  const content = body && body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  return parseModelJson(content);
}

async function remember(store, levelId, entry) {
  const bag = await load(store);
  const id = uid(levelId);
  const row = bag.levels[id];
  if (!row) return;
  row.prompts = Array.isArray(row.prompts) ? row.prompts : [];
  row.prompts.push(entry);
  if (row.prompts.length > PROMPT_CAP) row.prompts = row.prompts.slice(-PROMPT_CAP);
  await save(store, bag);
}

export async function ask(store, user, levelId, prompt, data) {
  if (!(await experimentalOn(store, user.id))) throw new Error('Turn on Experimental Features in Account first.');
  if (!(await isEnabled(store, levelId))) throw new Error('Enable the AI Assistant on this level first.');
  const text = String(prompt || '').trim().slice(0, 2000);
  if (!text) throw new Error('Describe what you want the assistant to do.');
  noteAsk(user.id);
  let explanation = '';
  let spl = null;
  let ops = [];
  let failed = false;
  try {
    const parsed = await callModel(text, levelSummary(data));
    explanation = censorProfanity(String(parsed.explanation || '').slice(0, 2000)).text;
    spl = sanitizeSpl(parsed.spl);
    ops = sanitizeOps(parsed.ops);
    if (!explanation) explanation = ops.length || spl ? 'Applied the request.' : 'No level change was needed.';
  } catch (err) {
    failed = true;
    explanation = String(err && err.message ? err.message : err).slice(0, 500);
  }
  await remember(store, levelId, {
    at: Date.now(),
    prompt: text,
    explanation,
    opCount: ops.length,
    failed,
  });
  if (failed) throw new Error(explanation);
  return { explanation, spl, ops };
}
