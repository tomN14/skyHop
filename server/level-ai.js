/**
 * Experimental level-editor assistant.
 * Account opt-in, permanent per-level mark, and a staff-only prompt log.
 * Requests are read by a small network trained inside SkyHop, then turned into editor objects and SPL.
 */
import { effectiveRole } from './moderation.js';
import { censorProfanity } from './profanity-filter.js';
import { scoreRequest } from './level-ai-net.js';
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
      const row = {
        op,
        x: num(item.x, -500, 9000, 0),
        y: num(item.y, -500, 5000, 0),
        w: num(item.w, 8, 2000, 80),
        h: num(item.h, 8, 800, 22),
      };
      if (op === 'platform' && (item.shape === 'circle' || item.shape === 'triangle')) row.shape = item.shape;
      ops.push(row);
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
    } else if (op === 'portal') {
      ops.push({
        op,
        x: num(item.x, -500, 9000, 200),
        y: num(item.y, -500, 5000, 400),
        w: num(item.w, 16, 200, 48),
        h: num(item.h, 16, 200, 48),
        destOx: num(item.destOx, -400, 400, 24),
        destOy: num(item.destOy, -800, 800, -72),
      });
    } else if (op === 'switch') {
      ops.push({
        op,
        x: num(item.x, -500, 9000, 200),
        y: num(item.y, -500, 5000, 400),
        w: num(item.w, 12, 200, 40),
        h: num(item.h, 8, 80, 16),
        moveX: num(item.moveX, -400, 400, 48),
        moveY: num(item.moveY, -400, 400, 0),
      });
    } else if (op === 'spring') {
      const row = {
        op,
        x: num(item.x, -500, 9000, 200),
        y: num(item.y, -500, 5000, 400),
        w: num(item.w, 8, 400, 48),
        h: num(item.h, 8, 200, 24),
      };
      if (item.vy != null && Number.isFinite(Number(item.vy))) row.vy = num(item.vy, -4000, -200, -1080);
      ops.push(row);
    } else if (op === 'mover' || op === 'lifter') {
      ops.push({
        op,
        x: num(item.x, -500, 9000, 200),
        y: num(item.y, -500, 5000, 400),
        w: num(item.w, 16, 800, 80),
        h: num(item.h, 8, 200, 20),
        axis: op === 'lifter' || item.axis === 'y' ? 'y' : 'x',
        amp: num(item.amp, 8, 400, 80),
      });
    } else if (op === 'gravity') {
      ops.push({
        op,
        x: num(item.x, -500, 9000, 200),
        y: num(item.y, -500, 5000, 400),
        w: num(item.w, 16, 200, 40),
        h: num(item.h, 16, 200, 64),
        targetDir: Number(item.targetDir) < 0 ? -1 : 1,
      });
    } else if (op === 'fireball') {
      const from = item.from === 'right' || item.from === 'top' || item.from === 'bottom' ? item.from : 'left';
      ops.push({ op, from, pos: num(item.pos, 0, 8000, 300) });
    } else if (op === 'blackout') {
      ops.push({
        op,
        x: num(item.x, -500, 9000, 200),
        y: num(item.y, -500, 5000, 400),
        w: num(item.w, 16, 400, 40),
        h: num(item.h, 16, 400, 40),
        blackSec: num(item.blackSec, 0.2, 30, 3),
        afterSec: num(item.afterSec, 0, 30, 2),
        onTouch: item.onTouch !== false,
      });
    } else if (op === 'sign') {
      ops.push({
        op,
        x: num(item.x, -500, 9000, 200),
        y: num(item.y, -500, 5000, 300),
        w: num(item.w, 40, 800, 160),
        h: num(item.h, 16, 400, 48),
        text: censorProfanity(String(item.text || 'Text').slice(0, 40)).text || 'Text',
        size: num(item.size, 10, 72, 22),
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

function countNear(prompt, words, fallback, max) {
  const text = String(prompt || '').toLowerCase();
  const noun = words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp('\\b(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|some)\\b(?:\\s+(?!hp\\b|health\\b|damage\\b|dmg\\b|seconds?\\b|secs?\\b)\\w+){0,2}\\s+(?:' + noun + ')\\b');
  const match = text.match(re);
  if (!match) return fallback;
  const named = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, couple: 2, few: 3, some: 3 };
  const value = named[match[1]] != null ? named[match[1]] : Number(match[1]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.round(value)));
}

function signText(slots) {
  const raw = slots.sign ? String(slots.sign).slice(0, 40) : 'Text';
  return censorProfanity(raw).text || 'Text';
}

let layoutSerial = 1;

function layoutRng(prompt) {
  layoutSerial = (layoutSerial + 1) >>> 0;
  let s = (Date.now() ^ Math.imul(layoutSerial, 0x9e3779b9)) >>> 0;
  const text = String(prompt || '');
  for (let i = 0; i < text.length; i += 1) s = Math.imul(s ^ text.charCodeAt(i), 16777619) >>> 0;
  if (!s) s = 1;
  return function next() {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function layoutInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function layoutPath(rng, worldW, floorY, style) {
  const vertical = style.climb || (!style.wide && rng() < 0.5);
  const steps = style.easy ? layoutInt(rng, 4, 5) : style.hard ? layoutInt(rng, 6, 8) : layoutInt(rng, 4, 7);
  const ops = [];
  const spots = [];
  for (let i = 0; i < steps; i += 1) {
    const rise = style.hard ? layoutInt(rng, 100, 140) : style.easy ? layoutInt(rng, 60, 85) : layoutInt(rng, 70, 120);
    let x;
    let y;
    let w;
    if (vertical) {
      w = layoutInt(rng, 100, 180);
      x = 120 + (i % 2) * layoutInt(rng, 200, 380);
      y = floorY - 80 - i * rise;
    } else {
      w = layoutInt(rng, 120, 220);
      const span = Math.max(180, worldW - 300);
      x = 70 + (span * i) / Math.max(1, steps - 1) + layoutInt(rng, -24, 36);
      y = floorY - layoutInt(rng, style.easy ? 70 : 90, style.hard ? 280 : 220);
    }
    x = Math.max(40, Math.min(worldW - w - 40, Math.round(x)));
    y = Math.max(70, Math.round(y));
    ops.push({ op: 'platform', x, y, w, h: 22 });
    spots.push({ x: x + Math.round(w / 2), y });
  }
  return { ops, spots, vertical };
}

function layoutArena(rng, worldW, floorY, small) {
  const left = small ? layoutInt(rng, 200, 340) : layoutInt(rng, 70, 160);
  const right = small ? worldW - layoutInt(rng, 260, 400) : worldW - layoutInt(rng, 110, 200);
  const top = floorY - (small ? layoutInt(rng, 150, 240) : layoutInt(rng, 220, 340));
  const ops = [
    { op: 'platform', x: left, y: top, w: 22, h: Math.max(80, floorY - top) },
    { op: 'platform', x: Math.max(left + 80, right), y: top, w: 22, h: Math.max(80, floorY - top) },
  ];
  const shelves = layoutInt(rng, 3, small ? 4 : 5);
  const spots = [];
  const span = Math.max(80, right - left - 80);
  for (let i = 0; i < shelves; i += 1) {
    const w = layoutInt(rng, 100, 170);
    const x = left + 36 + Math.round(rng() * Math.max(16, span - w));
    const y = Math.max(70, floorY - 70 - i * layoutInt(rng, 48, 96));
    ops.push({ op: 'platform', x, y, w, h: 22 });
    spots.push({ x: x + Math.round(w / 2), y });
  }
  return { ops, spots };
}

function layoutScatter(rng, worldW, floorY, count) {
  const spots = [];
  for (let i = 0; i < count; i += 1) {
    spots.push({
      x: layoutInt(rng, 80, Math.max(160, worldW - 140)),
      y: floorY - layoutInt(rng, 36, 240),
    });
  }
  return spots;
}

const LEVEL_KIT = ['spike', 'lava', 'coin', 'spring', 'portal', 'switch', 'monster', 'mover', 'lifter', 'gravity', 'fireball', 'blackout', 'sign', 'circle', 'triangle'];
const SIGN_LINES = ['Watch your step', 'This way', 'Keep going', 'Nice jump', 'Almost there'];

function layoutKit(rng, style) {
  const n = style.hard ? layoutInt(rng, 4, 6) : style.easy ? layoutInt(rng, 2, 3) : layoutInt(rng, 3, 5);
  const bag = LEVEL_KIT.slice();
  const picked = [];
  while (picked.length < n && bag.length) picked.push(bag.splice(Math.floor(rng() * bag.length), 1)[0]);
  if (style.hard && !picked.includes('spike')) picked.push('spike');
  if (style.easy && !picked.includes('coin')) picked.push('coin');
  if (style.easy && !picked.includes('spring')) picked.push('spring');
  if (rng() < (style.hard ? 0.7 : style.easy ? 0.15 : 0.35)) picked.push('boss');
  return picked;
}

export function planLevelRequest(prompt, data) {
  const summary = levelSummary(data);
  const scored = scoreRequest(prompt);
  const slots = scored.slots;
  const on = (label) => scored.scores[label] >= scored.threshold;
  const worldW = num(summary.worldW, 400, 8000, 1400);
  const floorY = floorYOf(summary);
  const action = [
    'arena', 'platform', 'spike', 'lava', 'coin', 'spawn', 'goal', 'monster', 'boss', 'shoot', 'laser',
    'portal', 'switch', 'spring', 'mover', 'lifter', 'gravity', 'fireball', 'blackout', 'sign', 'circle', 'triangle',
    'chase', 'jump', 'whole', 'hard', 'easy', 'climb', 'wide', 'replace',
  ];
  if (on('explain') && !action.some((label) => label !== 'explain' && label !== 'replace' && on(label))) {
    return { explanation: describeScript(summary.spl), spl: null, ops: [] };
  }

  const rng = layoutRng(prompt);
  const full = on('whole') || on('hard') || on('easy') || on('climb') || on('wide');
  const arena = on('arena');
  const style = { hard: on('hard'), easy: on('easy'), climb: on('climb'), wide: on('wide') };
  const seconds = Math.max(0.2, Math.min(120, slots.seconds == null ? 3 : slots.seconds));
  const damage = slots.damage == null ? null : Math.max(1, Math.min(100, Math.round(slots.damage)));
  const bossAttack = (on('shoot') || on('laser')) && !(on('fireball') && !on('boss') && !on('laser'));
  const asked = ['spike', 'lava', 'coin', 'spring', 'portal', 'switch', 'monster', 'chase', 'mover', 'lifter', 'gravity', 'fireball', 'blackout', 'sign', 'circle', 'triangle', 'boss', 'shoot', 'laser', 'spawn', 'goal', 'platform', 'jump'];
  const openBrief = full && !arena && !asked.some(on);
  const kit = openBrief ? layoutKit(rng, style) : [];
  const want = (label) => on(label) || kit.includes(label);
  const explicitBoss = on('boss') || bossAttack;
  const placeBoss = (on('boss') && !bossAttack) || (bossAttack && !summary.hasBoss) || (on('boss') && !summary.hasBoss) || (kit.includes('boss') && !summary.hasBoss);
  const randomBoss = kit.includes('boss') && !explicitBoss;
  let shotGap = seconds;
  let randomShots = false;
  if (randomBoss && rng() < 0.5) {
    randomShots = true;
    shotGap = layoutInt(rng, 2, 5);
  }
  const hp = slots.hp == null ? (placeBoss ? 8 : 1) : Math.max(1, Math.min(100000, Math.round(slots.hp)));
  const notes = [];
  const ops = [];
  let spots = [];

  const specificPlatform = on('circle') || on('triangle') || on('mover') || on('lifter');
  if (arena) {
    const laid = layoutArena(rng, worldW, floorY, !full);
    laid.ops.forEach((op) => ops.push(op));
    spots = laid.spots;
    notes.push('Added an arena with platforms at different heights.');
  } else if (full || (on('platform') && !specificPlatform)) {
    if (full) {
      const laid = layoutPath(rng, worldW, floorY, style);
      laid.ops.forEach((op) => ops.push(op));
      spots = laid.spots;
      notes.push(laid.vertical ? 'Built a climb.' : 'Built a path across the stage.');
    } else {
      const count = countNear(prompt, ['platform', 'platforms', 'ledge', 'ledges', 'shelf', 'shelves', 'foothold', 'footholds'], 3, 6);
      spots = layoutScatter(rng, worldW, floorY, count);
      for (let i = 0; i < count; i += 1) {
        const w = layoutInt(rng, 120, 200);
        ops.push({ op: 'platform', x: Math.max(40, spots[i].x - Math.round(w / 2)), y: spots[i].y, w, h: 22 });
      }
      notes.push('Added ' + count + ' platforms at different heights.');
    }
  } else {
    spots = layoutScatter(rng, worldW, floorY, 6);
  }
  let cursor = 0;
  function nextSpot() {
    const spot = spots[cursor % spots.length];
    cursor += 1;
    return {
      x: Math.max(36, Math.round(spot.x + (rng() - 0.5) * 70)),
      y: Math.max(48, Math.round(spot.y + (rng() - 0.5) * 30)),
    };
  }
  if (want('circle')) {
    const spot = nextSpot();
    ops.push({ op: 'platform', x: spot.x, y: spot.y, w: 48, h: 48, shape: 'circle' });
    notes.push('Added a round platform.');
  }
  if (want('triangle')) {
    const spot = nextSpot();
    ops.push({ op: 'platform', x: spot.x, y: spot.y, w: 48, h: 48, shape: 'triangle' });
    notes.push('Added a triangle.');
  }
  if (want('spike')) {
    const count = on('spike') ? countNear(prompt, ['spike', 'spikes', 'thorn', 'thorns', 'trap', 'traps', 'nail', 'nails', 'hazard', 'hazards'], 1, 6) : layoutInt(rng, style.hard ? 2 : 1, 4);
    for (let i = 0; i < count; i += 1) {
      const spot = nextSpot();
      ops.push({ op: 'spike', x: spot.x, y: spot.y - 28, w: layoutInt(rng, 56, 96), h: 28 });
    }
    notes.push('Added spikes.');
  }
  if (want('lava')) {
    const spot = nextSpot();
    ops.push({ op: 'lava', x: spot.x, y: spot.y - 24, w: layoutInt(rng, 100, 180), h: 24 });
    notes.push('Added lava.');
  }
  if (want('coin')) {
    const count = on('coin') ? countNear(prompt, ['coin', 'coins', 'gem', 'gems', 'pickup', 'pickups'], 4, 8) : layoutInt(rng, 3, 6);
    for (let i = 0; i < count; i += 1) {
      const spot = nextSpot();
      ops.push({ op: 'coin', x: spot.x, y: spot.y - layoutInt(rng, 40, 90) });
    }
    notes.push('Added ' + count + ' coins.');
  }
  if (on('spawn') || full) {
    const start = spots[0];
    ops.push({ op: 'spawn', x: Math.max(40, start.x - 36), y: start.y - 70 });
    notes.push('Moved the spawn.');
  }
  if (on('goal') || full) {
    const end = spots[spots.length - 1];
    ops.push({ op: 'goal', x: end.x, y: end.y - 110 });
    notes.push('Moved the goal.');
  }
  if (want('monster') || want('chase')) {
    const count = on('monster') || on('chase') ? countNear(prompt, ['monster', 'monsters', 'enemy', 'enemies', 'creature', 'creatures', 'guy', 'guys', 'baddie', 'baddies'], 1, 6) : layoutInt(rng, 1, style.hard ? 3 : 2);
    for (let i = 0; i < count; i += 1) {
      const spot = nextSpot();
      ops.push({
        op: 'monster',
        x: spot.x,
        y: spot.y - 48,
        w: 28,
        h: 28,
        hp: hp > 1 && !placeBoss ? hp : 1,
        chase: on('chase') || (kit.includes('monster') && rng() < 0.5),
        pattern: 'patrol',
      });
    }
    notes.push('Added ' + count + ' monster' + (count === 1 ? '' : 's') + '.');
  }
  if (placeBoss) {
    const spot = spots[spots.length - 1];
    ops.push({
      op: 'boss',
      x: spot.x,
      y: spot.y - 96,
      w: randomBoss ? layoutInt(rng, 56, 84) : 64,
      h: randomBoss ? layoutInt(rng, 56, 84) : 64,
      hp: randomBoss && slots.hp == null ? layoutInt(rng, 6, 18) : hp,
      touch: true,
      projectile: randomBoss ? randomShots : bossAttack || !on('laser'),
      laser: on('laser'),
      win: 'boss',
    });
    notes.push('Added a boss.');
  }
  if (want('portal')) {
    const count = on('portal') ? countNear(prompt, ['portal', 'portals', 'doorway', 'doorways', 'teleporter', 'teleporters', 'door', 'doors'], 1, 4) : 1;
    for (let i = 0; i < count; i += 1) {
      const spot = nextSpot();
      ops.push({ op: 'portal', x: spot.x, y: spot.y - 48, w: 48, h: 48, destOx: 24, destOy: -layoutInt(rng, 48, 120) });
    }
    notes.push('Added a portal.');
  }
  if (want('switch')) {
    const spot = nextSpot();
    ops.push({ op: 'switch', x: spot.x, y: spot.y - 16, w: 40, h: 16, moveX: layoutInt(rng, 32, 96), moveY: 0 });
    notes.push('Added a switch.');
  }
  if (want('spring')) {
    const count = on('spring') ? countNear(prompt, ['spring', 'springs', 'trampoline', 'trampolines', 'pad', 'pads', 'bouncer', 'bouncers'], 1, 6) : layoutInt(rng, 1, 3);
    for (let i = 0; i < count; i += 1) {
      const spot = nextSpot();
      ops.push({ op: 'spring', x: spot.x, y: spot.y - 24, w: 48, h: 24, vy: -layoutInt(rng, 800, 1500) });
    }
    notes.push(count === 1 ? 'Added a spring.' : 'Added ' + count + ' springs.');
  }
  if (want('mover')) {
    const spot = nextSpot();
    ops.push({ op: 'mover', x: spot.x, y: spot.y, w: layoutInt(rng, 72, 140), h: 20, axis: 'x', amp: layoutInt(rng, 48, 140) });
    notes.push('Added a moving platform.');
  }
  if (want('lifter')) {
    const spot = nextSpot();
    ops.push({ op: 'lifter', x: spot.x, y: spot.y, w: 80, h: 20, axis: 'y', amp: layoutInt(rng, 48, 140) });
    notes.push('Added an elevator.');
  }
  if (want('gravity')) {
    const spot = nextSpot();
    const down = on('gravity') ? !!slots.down : rng() < 0.5;
    ops.push({ op: 'gravity', x: spot.x, y: spot.y - 64, w: 40, h: 64, targetDir: down ? 1 : -1 });
    notes.push(down ? 'Added a gravity arrow pointing down.' : 'Added a gravity arrow pointing up.');
  }
  if (want('fireball')) {
    const sides = ['left', 'right', 'top', 'bottom'];
    ops.push({ op: 'fireball', from: sides[layoutInt(rng, 0, sides.length - 1)], pos: Math.max(64, floorY - layoutInt(rng, 80, 220)) });
    notes.push('Added a fireball shooter.');
  }
  if (want('blackout')) {
    const spot = nextSpot();
    const blackSec = on('shoot') || on('laser') || slots.seconds == null ? layoutInt(rng, 2, 5) : Math.max(0.2, Math.min(30, slots.seconds));
    ops.push({ op: 'blackout', x: spot.x, y: spot.y - 40, w: 40, h: 40, blackSec, afterSec: 2, onTouch: true });
    notes.push('Added a blackout.');
  }
  if (want('sign')) {
    const spot = nextSpot();
    const text = slots.sign ? signText(slots) : SIGN_LINES[layoutInt(rng, 0, SIGN_LINES.length - 1)];
    ops.push({ op: 'sign', x: spot.x, y: spot.y - 80, w: 160, h: 48, text, size: 22 });
    notes.push('Added a sign.');
  }

  const lines = [];
  const shotOn = (bossAttack && !on('laser')) || (placeBoss && explicitBoss && !on('laser')) || randomShots;
  if (shotOn) lines.push.apply(lines, attackLines('projectile', randomShots && !bossAttack ? shotGap : seconds, damage));
  if (on('laser')) lines.push.apply(lines, attackLines('laser', seconds, damage));
  if (on('jump')) {
    const jumps = Math.max(1, Math.min(20, Math.round(slots.jumps == null ? 3 : slots.jumps)));
    lines.push('jump_cap <- skyhop.get("jump_limit");', 'jump_cap <- ' + jumps + ';');
    notes.push('Set the jump limit to ' + jumps + '.');
  }
  let spl = null;
  if (lines.length) {
    spl = on('replace') ? 'use skyhop;\n' + lines.join('\n') : mergeScript(summary.spl, lines);
    if (shotOn) notes.push('Boss shots are on, with ' + (randomShots && !bossAttack ? shotGap : seconds) + ' seconds between them.');
    if (on('laser')) notes.push('The boss laser is on, with ' + seconds + ' seconds between shots.');
  }
  if (!ops.length && !spl) {
    return {
      explanation: 'Describe the platforms, enemies, portals, switches, or other objects you want in the level.',
      spl: null,
      ops: [],
    };
  }
  return { explanation: notes.join(' '), spl, ops };
}
function floorYOf(summary) {
  const worldH = num(summary.worldH, 300, 4000, 720);
  let floorY = worldH - 100;
  for (const platform of summary.platforms || []) {
    if (Number(platform.w) > num(summary.worldW, 400, 8000, 1400) * 0.5) floorY = Number(platform.y);
  }
  return floorY;
}

function attackLines(kind, seconds, damage) {
  const enable = kind === 'laser' ? 'boss_laser_attack' : 'boss_projectile_attack';
  const cool = kind === 'laser' ? 'boss_laser_cooldown' : 'boss_projectile_attack_cooldown';
  const dmgKey = kind === 'laser' ? 'boss_laser_attack_dmg' : 'boss_projectile_attack_dmg';
  const prefix = kind === 'laser' ? 'laser' : 'shot';
  const lines = [
    prefix + '_on <- skyhop.get("' + enable + '");',
    prefix + '_on <- 1;',
    prefix + '_gap <- skyhop.get("' + cool + '");',
    prefix + '_gap <- ' + seconds + ';',
  ];
  if (damage != null) {
    lines.push(prefix + '_dmg <- skyhop.get("' + dmgKey + '");');
    lines.push(prefix + '_dmg <- ' + damage + ';');
  }
  return lines;
}

function mergeScript(existing, lines) {
  const fresh = lines.filter((line) => {
    const key = line.match(/skyhop\.get\("([^"]+)"\)/);
    return !key || !String(existing || '').includes(key[1]);
  });
  if (!fresh.length) return String(existing || '').trim() || null;
  let base = String(existing || '').trim();
  if (!base) return 'use skyhop;\n' + fresh.join('\n');
  if (!/^use\s+skyhop\s*;/i.test(base)) base = 'use skyhop;\n' + base;
  const breakAt = base.indexOf('\n');
  if (breakAt === -1) return base + '\n' + fresh.join('\n');
  return base.slice(0, breakAt) + '\n' + fresh.join('\n') + base.slice(breakAt);
}

function describeScript(spl) {
  const text = String(spl || '').trim();
  if (!text) return 'This level has no SPL script yet.';
  const bits = [];
  if (/boss_projectile_attack/.test(text)) bits.push('it turns boss shots on');
  if (/boss_laser_attack/.test(text)) bits.push('it turns the boss laser on');
  const gap = text.match(/_gap <- (\d+(?:\.\d+)?)/);
  if (gap) bits.push('the attack wait is ' + gap[1] + ' seconds');
  if (/test\.while\(1\)/.test(text)) bits.push('a loop runs once per frame');
  if (/skyhop\.wait\(/.test(text)) bits.push('skyhop.wait pauses inside that loop');
  if (/skyhop\.kill\(/.test(text)) bits.push('it can kill the player');
  if (/jump_limit/.test(text)) bits.push('it changes the jump limit');
  if (!bits.length) return 'The script starts with use skyhop; and uses the commands already in the level. I can add boss shots, a boss laser, or a jump limit.';
  return 'The current script ' + bits.join(', ') + '.';
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
    const parsed = planLevelRequest(text, data);
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
