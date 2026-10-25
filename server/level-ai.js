/**
 * Experimental level-editor assistant.
 * Account opt-in, permanent per-level mark, and a staff-only prompt log.
 * Requests are read by a small network trained inside SkyHop, then turned into editor objects and SPL.
 */
import { effectiveRole } from './moderation.js';
import { censorProfanity } from './profanity-filter.js';
import { scoreRequest, tokensOf } from './level-ai-net.js';
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

function publicPrompt(item) {
  return {
    at: item.at,
    prompt: item.prompt,
    explanation: item.explanation || '',
    opCount: item.opCount || 0,
    failed: !!item.failed,
    username: item.username || 'Host',
  };
}

export function mayReadPrompts(user, role) {
  if (staffMayRead(user)) return true;
  return role === 'host' || role === 'editor' || role === 'viewer' || role === 'suggestor';
}

export async function promptsFor(store, user, levelId, role) {
  if (!mayReadPrompts(user, role)) throw new Error('You cannot read prompts for this level.');
  const bag = await load(store);
  const row = bag.levels[uid(levelId)];
  if (!row || !row.enabled) return { aiAssisted: false, prompts: [] };
  return {
    aiAssisted: true,
    enabledAt: row.enabledAt || null,
    prompts: (row.prompts || []).map(publicPrompt),
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
        x: num(item.x, -500, 20000, 0),
        y: num(item.y, -500, 20000, 0),
        w: num(item.w, 8, 2000, 80),
        h: num(item.h, 8, 800, 22),
      };
      if (op === 'platform' && (item.shape === 'circle' || item.shape === 'triangle')) row.shape = item.shape;
      ops.push(row);
    } else if (op === 'coin' || op === 'spawn' || op === 'goal') {
      ops.push({
        op,
        x: num(item.x, -500, 20000, 80),
        y: num(item.y, -500, 20000, 400),
      });
    } else if (op === 'monster') {
      ops.push({
        op,
        x: num(item.x, -500, 20000, 200),
        y: num(item.y, -500, 20000, 400),
        w: num(item.w, 12, 400, 28),
        h: num(item.h, 12, 400, 28),
        hp: num(item.hp, 1, 100, 1),
        chase: !!item.chase,
        pattern: item.pattern === 'still' || item.pattern === 'sine' ? item.pattern : 'patrol',
      });
    } else if (op === 'boss') {
      ops.push({
        op,
        x: num(item.x, -500, 20000, 600),
        y: num(item.y, -500, 20000, 360),
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
        x: num(item.x, -500, 20000, 200),
        y: num(item.y, -500, 20000, 400),
        w: num(item.w, 16, 200, 48),
        h: num(item.h, 16, 200, 48),
        destOx: num(item.destOx, -400, 400, 24),
        destOy: num(item.destOy, -800, 800, -72),
      });
    } else if (op === 'switch') {
      ops.push({
        op,
        x: num(item.x, -500, 20000, 200),
        y: num(item.y, -500, 20000, 400),
        w: num(item.w, 12, 200, 40),
        h: num(item.h, 8, 80, 16),
        moveX: num(item.moveX, -400, 400, 48),
        moveY: num(item.moveY, -400, 400, 0),
      });
    } else if (op === 'spring') {
      const row = {
        op,
        x: num(item.x, -500, 20000, 200),
        y: num(item.y, -500, 20000, 400),
        w: num(item.w, 8, 400, 48),
        h: num(item.h, 8, 200, 24),
      };
      if (item.vy != null && Number.isFinite(Number(item.vy))) row.vy = num(item.vy, -4000, -200, -1080);
      ops.push(row);
    } else if (op === 'mover' || op === 'lifter') {
      ops.push({
        op,
        x: num(item.x, -500, 20000, 200),
        y: num(item.y, -500, 20000, 400),
        w: num(item.w, 16, 800, 80),
        h: num(item.h, 8, 200, 20),
        axis: op === 'lifter' || item.axis === 'y' ? 'y' : 'x',
        amp: num(item.amp, 8, 400, 80),
      });
    } else if (op === 'gravity') {
      ops.push({
        op,
        x: num(item.x, -500, 20000, 200),
        y: num(item.y, -500, 20000, 400),
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
        x: num(item.x, -500, 20000, 200),
        y: num(item.y, -500, 20000, 400),
        w: num(item.w, 16, 400, 40),
        h: num(item.h, 16, 400, 40),
        blackSec: num(item.blackSec, 0.2, 30, 3),
        afterSec: num(item.afterSec, 0, 30, 2),
        onTouch: item.onTouch !== false,
      });
    } else if (op === 'sign') {
      ops.push({
        op,
        x: num(item.x, -500, 20000, 200),
        y: num(item.y, -500, 20000, 300),
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

function stairSpots(rng, worldW, floorY, count, riseBias) {
  const n = Math.max(1, count);
  const w = layoutInt(rng, 130, 160);
  const rise = riseBias == null ? layoutInt(rng, 68, 88) : riseBias;
  const usable = Math.max(220, worldW - 180 - w);
  const gap = Math.max(64, Math.min(140, Math.round(usable / n - w)));
  const spots = [];
  for (let i = 0; i < n; i += 1) {
    const x = Math.min(worldW - w - 40, 110 + i * (w + gap));
    const y = Math.max(80, floorY - 72 - i * rise);
    spots.push({ x: Math.round(x), y, w, h: 22 });
  }
  return spots;
}

function pushSpots(ops, spots) {
  spots.forEach((spot) => ops.push({ op: 'platform', x: spot.x, y: spot.y, w: spot.w, h: spot.h || 22 }));
}

const CHAT_WORDS = new Set('hello hi hey thanks thank ok okay sure hmm wow yes no nope yep lol lmao nice good great bye goodbye'.split(' '));
const SIGN_LINES = ['Watch your step', 'This way', 'Keep going', 'Nice jump', 'Almost there'];
const PLATFORM_WORDS = ['platform', 'platforms', 'ledge', 'ledges', 'shelf', 'shelves', 'foothold', 'footholds'];
const SPIKE_WORDS = ['spike', 'spikes', 'thorn', 'thorns', 'trap', 'traps', 'nail', 'nails', 'hazard', 'hazards'];
const COIN_WORDS = ['coin', 'coins', 'gem', 'gems', 'pickup', 'pickups'];
const SPRING_WORDS = ['spring', 'springs', 'trampoline', 'trampolines', 'pad', 'pads', 'bouncer', 'bouncers'];
const PORTAL_WORDS = ['portal', 'portals', 'doorway', 'doorways', 'teleporter', 'teleporters', 'door', 'doors'];
const MONSTER_WORDS = ['monster', 'monsters', 'enemy', 'enemies', 'creature', 'creatures', 'guy', 'guys', 'baddie', 'baddies'];

function contentWords(prompt) {
  return tokensOf(prompt).filter((token) => !token.startsWith('#') && !token.includes(' '));
}

function isChatter(prompt, recognized) {
  if (recognized) return false;
  const words = contentWords(prompt);
  if (!words.length || words.every((word) => CHAT_WORDS.has(word))) return true;
  return /^(what|who|when|where|why|how)\b/i.test(String(prompt || '').trim());
}

function countOf(prompt, words, fallback, max, pluralFallback) {
  const counted = countNear(prompt, words, fallback, max);
  if (counted !== fallback) return counted;
  const text = String(prompt || '').toLowerCase();
  const plural = words.some((word) => word.endsWith('s') && new RegExp('\\b' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(text));
  if (!plural) return fallback;
  return Math.max(fallback, Math.min(max, pluralFallback == null ? fallback : pluralFallback));
}

function fitX(x, w, worldW) {
  return Math.max(40, Math.min(worldW - w - 40, Math.round(x)));
}

function secondsNear(prompt, words, fallback) {
  const text = String(prompt || '').toLowerCase();
  const n = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)';
  const named = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const noun = words.join('|');
  const patterns = [
    new RegExp('(?:' + noun + ')[\\s\\S]{0,48}?' + n + '\\s*(?:seconds|second|secs|sec)'),
    new RegExp(n + '\\s*(?:seconds|second|secs|sec)[\\s\\S]{0,48}?(?:' + noun + ')'),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const value = named[match[1]] != null ? named[match[1]] : Number(match[1]);
    if (Number.isFinite(value)) return Math.max(0.2, Math.min(120, value));
  }
  return fallback;
}

function pickScene(rng, on, directed) {
  if (on('boss') || on('shoot') || on('laser')) return 'boss';
  if (on('arena')) return 'arena';
  if (on('portal') && !on('spring') && !on('lava')) return 'warp';
  if (on('spring') || on('lava')) return 'gap';
  if (on('chase') || on('monster')) return 'chase';
  if (!directed) return ['gap', 'stairs', 'chase', 'boss', 'warp'][layoutInt(rng, 0, 4)];
  return 'stairs';
}

function scriptBundle(summary, intent) {
  const head = [];
  const tail = [];
  const notes = [];
  if (intent.jumps != null) {
    const jumps = Math.max(1, Math.min(20, Math.round(intent.jumps)));
    head.push('jump_cap <- skyhop.get("jump_limit");', 'jump_cap <- ' + jumps + ';');
    notes.push('The script sets the jump limit to ' + jumps + '.');
  }
  if (intent.shots) {
    head.push.apply(head, attackLines('projectile', intent.shotGap, intent.damage));
    notes.push('The script turns on boss shots every ' + intent.shotGap + ' seconds.');
  }
  if (intent.laser) {
    head.push.apply(head, attackLines('laser', intent.shotGap, intent.damage));
    notes.push('The script turns on the boss laser every ' + intent.shotGap + ' seconds.');
  }
  const existing = String(summary.spl || '');
  if (intent.kill && !/skyhop\.kill\(/.test(existing) && !/test\.while\(1\)/.test(existing)) {
    const wait = Math.max(0.2, Math.min(120, intent.killWait == null ? 8 : intent.killWait));
    tail.push('test.while(1):', '    skyhop.wait(' + wait + ');', '    skyhop.kill();', '    test.break;', 'end;');
    notes.push('The script kills the player after ' + wait + ' seconds.');
  }
  if (!head.length && !tail.length) return { spl: null, notes };
  const spl = intent.replace ? 'use skyhop;\n' + head.concat(tail).join('\n') : mergeScript(existing, head, tail);
  return { spl, notes };
}

function arrangeAsked(ctx) {
  const { rng, worldW, floorY, on, prompt, slots, placeBoss, hp, shift } = ctx;
  const ops = [];
  const notes = [];
  let cursor = 180 + shift;
  function take(w) {
    const x = fitX(cursor, w, worldW);
    cursor = x + w + 32;
    return x;
  }
  const specific = on('circle') || on('triangle') || on('mover') || on('lifter');
  let spots = [];
  if (on('platform') && !specific) {
    const count = countOf(prompt, PLATFORM_WORDS, 4, 6, 4);
    spots = stairSpots(rng, worldW, floorY, count);
    pushSpots(ops, spots);
    notes.push('The platforms step up so each one is a jump from the last.');
  }
  if (on('circle')) {
    const host = spots[0];
    ops.push({ op: 'platform', x: host ? host.x + 16 : take(48), y: host ? host.y : floorY - 140, w: 48, h: 48, shape: 'circle' });
    notes.push('A round platform comes first.');
  }
  if (on('triangle')) {
    const host = spots.length > 1 ? spots[spots.length - 1] : null;
    ops.push({ op: 'platform', x: host ? host.x + 16 : take(48), y: host ? host.y : floorY - 220, w: 48, h: 48, shape: 'triangle' });
    notes.push('A triangle sits one jump higher.');
  }
  if (on('spring')) {
    const count = countOf(prompt, SPRING_WORDS, 1, 6, 3);
    const vy = -layoutInt(rng, 1080, 1400);
    for (let i = 0; i < count; i += 1) ops.push({ op: 'spring', x: take(48), y: floorY - 24, w: 48, h: 24, vy });
    notes.push(count === 1 ? 'A spring sits on the floor.' : count + ' springs sit in a row on the floor.');
  }
  if (on('spike')) {
    const count = countOf(prompt, SPIKE_WORDS, 1, 6, 3);
    for (let i = 0; i < count; i += 1) ops.push({ op: 'spike', x: take(64), y: floorY - 28, w: 64, h: 28 });
    notes.push('Spikes run along the floor.');
  }
  if (on('lava')) {
    const width = layoutInt(rng, 140, 200);
    ops.push({ op: 'lava', x: take(width), y: floorY - 24, w: width, h: 24 });
    notes.push('A lava pool sits on the floor.');
  }
  if (on('coin')) {
    const count = countOf(prompt, COIN_WORDS, 4, 8, 4);
    if (spots.length) {
      for (let i = 0; i < count; i += 1) {
        const host = spots[i % spots.length];
        ops.push({ op: 'coin', x: host.x + 28 + (Math.floor(i / spots.length) * 36), y: host.y - 52 });
      }
    } else {
      for (let i = 0; i < count; i += 1) ops.push({ op: 'coin', x: 200 + shift + i * 56, y: floorY - 96 });
    }
    notes.push('Coins follow the path.');
  }
  if (on('portal')) {
    const count = countOf(prompt, PORTAL_WORDS, 1, 4, 2);
    const destOy = spots.length ? Math.max(-400, spots[spots.length - 1].y - (floorY - 48)) : -72;
    for (let i = 0; i < count; i += 1) {
      ops.push({ op: 'portal', x: take(48), y: floorY - 48, w: 48, h: 48, destOx: Math.min(360, 180 + i * 80), destOy });
    }
    notes.push(count === 1 ? 'A portal on the floor warps ahead.' : count + ' portals sit on the floor and warp ahead.');
  }
  if (on('monster') || on('chase')) {
    const count = countOf(prompt, MONSTER_WORDS, 1, 6, 2);
    for (let i = 0; i < count; i += 1) {
      ops.push({ op: 'monster', x: take(28), y: floorY - 48, w: 28, h: 28, hp: 1, chase: on('chase'), pattern: 'patrol' });
    }
    notes.push(on('chase') ? 'Enemies on the floor chase the player.' : 'Enemies patrol the floor.');
  }
  if (placeBoss) {
    const host = spots.length ? spots[spots.length - 1] : null;
    ops.push({
      op: 'boss',
      x: host ? host.x + 40 : take(64),
      y: host ? host.y - 96 : floorY - 96,
      w: 64,
      h: 64,
      hp,
      touch: true,
      projectile: on('shoot') && !on('laser'),
      laser: on('laser'),
      win: 'boss',
    });
    notes.push('The boss stands at the end of the route.');
  }
  if (on('switch')) {
    const host = spots[0];
    ops.push({ op: 'switch', x: host ? host.x + 24 : take(40), y: floorY - 16, w: 40, h: 16, moveX: host ? 0 : 64, moveY: host ? -76 : 0 });
    notes.push(host ? 'A switch on the floor lifts the first platform.' : 'A switch on the floor slides a platform.');
  }
  if (on('mover')) {
    ops.push({ op: 'mover', x: take(120), y: floorY - 150, w: 120, h: 20, axis: 'x', amp: 100 });
    notes.push('A platform slides across a gap.');
  }
  if (on('lifter')) {
    ops.push({ op: 'lifter', x: take(80), y: floorY - 24, w: 80, h: 20, axis: 'y', amp: 120 });
    notes.push('An elevator rises off the floor.');
  }
  if (on('gravity')) {
    ops.push({ op: 'gravity', x: take(40), y: floorY - 80, w: 40, h: 64, targetDir: slots.down ? 1 : -1 });
    notes.push(slots.down ? 'A gravity arrow points down.' : 'A gravity arrow flips you upward.');
  }
  if (on('fireball')) {
    ops.push({ op: 'fireball', from: 'left', pos: Math.max(64, floorY - 140) });
    notes.push('Flames come in from the left at jump height.');
  }
  if (on('blackout')) {
    ops.push({ op: 'blackout', x: take(40), y: floorY - 56, w: 40, h: 40, blackSec: 3, afterSec: 2, onTouch: true });
    notes.push('A blackout sits on the route.');
  }
  if (on('sign')) {
    const text = slots.sign ? signText(slots) : SIGN_LINES[layoutInt(rng, 0, SIGN_LINES.length - 1)];
    ops.push({ op: 'sign', x: 120 + shift, y: floorY - 140, w: 160, h: 48, text, size: 22 });
    notes.push('A sign marks the start.');
  }
  if (on('spawn')) {
    const host = spots[0];
    ops.push({ op: 'spawn', x: host ? host.x + 16 : 80, y: host ? host.y - 70 : floorY - 80 });
    notes.push('Spawn is at the start of the route.');
  }
  if (on('goal')) {
    const host = spots.length ? spots[spots.length - 1] : null;
    ops.push({ op: 'goal', x: host ? host.x + 40 : fitX(cursor, 40, worldW), y: host ? host.y - 80 : floorY - 120 });
    notes.push('The goal is at the end.');
  }
  return { ops, notes, jumps: null, shots: false, laser: false, shotGap: 3 };
}

function buildCourse(kind, ctx) {
  const { rng, worldW, floorY, on, prompt, slots, placeBoss, hp, directed, open, invent, hard, easy, shift } = ctx;
  const ops = [];
  const notes = [];
  const placed = new Set();
  let jumps = null;
  let shots = false;
  let shotGap = layoutInt(rng, 2, 4);
  const rise = hard ? 92 : easy ? 60 : 76;
  const steps = hard ? 6 : easy ? 4 : 5;
  function markSpawnGoal(spots) {
    if (open || on('spawn')) {
      const host = spots[0];
      ops.push({ op: 'spawn', x: host.x + 12, y: host.y - 72 });
      placed.add('spawn');
    }
    if (open || on('goal')) {
      const host = spots[spots.length - 1];
      ops.push({ op: 'goal', x: host.x + Math.max(16, host.w - 70), y: host.y - 80 });
      placed.add('goal');
    }
  }
  let spots = [];
  if (kind === 'gap') {
    const vy = -layoutInt(rng, 1200, 1460);
    const springN = on('spring') ? countOf(prompt, SPRING_WORDS, 1, 4, 2) : 1;
    for (let i = 0; i < springN; i += 1) ops.push({ op: 'spring', x: fitX(220 + shift + i * 56, 48, worldW), y: floorY - 24, w: 48, h: 24, vy });
    placed.add('spring');
    if (on('lava') || (!on('spike') && !directed && rng() < 0.5) || (directed && on('lava'))) {
      ops.push({ op: 'lava', x: fitX(400 + shift, 180, worldW), y: floorY - 24, w: layoutInt(rng, 150, 210), h: 24 });
      placed.add('lava');
    } else {
      const spikeN = on('spike') ? countOf(prompt, SPIKE_WORDS, 3, 6, 3) : 3;
      for (let i = 0; i < spikeN; i += 1) ops.push({ op: 'spike', x: fitX(410 + shift + i * 68, 64, worldW), y: floorY - 28, w: 64, h: 28 });
      placed.add('spike');
    }
    const landing = { x: fitX(680 + shift, 170, worldW), y: floorY - layoutInt(rng, 130, 168), w: 170, h: 22 };
    const top = { x: fitX(landing.x + layoutInt(rng, 200, 250), 150, worldW), y: Math.max(96, landing.y - rise), w: 150, h: 22 };
    spots = [landing, top];
    pushSpots(ops, spots);
    const coinN = on('coin') ? countOf(prompt, COIN_WORDS, 4, 8, 4) : 4;
    for (let i = 0; i < coinN; i += 1) {
      const host = i % 2 ? top : landing;
      ops.push({ op: 'coin', x: host.x + 24 + (i % 3) * 40, y: host.y - 52 });
    }
    placed.add('coin');
    markSpawnGoal(spots);
    if (invent) jumps = easy ? 3 : 2;
    notes.push(placed.has('lava') ? 'A spring throws you over a lava gap, then coins lead up to the goal.' : 'A spring throws you over the spikes, then coins lead up to the goal.');
  } else if (kind === 'chase') {
    spots = stairSpots(rng, worldW, floorY, steps, hard ? 28 : 16);
    pushSpots(ops, spots);
    const monsterN = on('monster') || on('chase') ? countOf(prompt, MONSTER_WORDS, 2, 4, 2) : 2;
    for (let i = 0; i < monsterN; i += 1) {
      const host = spots[Math.min(spots.length - 1, i + 1)];
      ops.push({ op: 'monster', x: host.x + 20, y: floorY - 48, w: 28, h: 28, hp: 1, chase: true, pattern: 'patrol' });
    }
    placed.add('monster');
    const spikeN = hard ? 3 : 2;
    for (let i = 0; i < spikeN; i += 1) ops.push({ op: 'spike', x: fitX(48 + i * 68, 64, worldW), y: floorY - 28, w: 64, h: 28 });
    placed.add('spike');
    markSpawnGoal(spots);
    notes.push('A low run with spikes behind the start and enemies chasing along the floor.');
  } else if (kind === 'boss' || kind === 'arena') {
    const left = fitX((kind === 'arena' ? 180 : 120) + shift, 22, worldW);
    const right = fitX(worldW - (kind === 'arena' ? 280 : 180) - shift, 22, worldW);
    const top = floorY - (hard ? 320 : 250);
    ops.push({ op: 'platform', x: left, y: top, w: 22, h: Math.max(120, floorY - top) });
    ops.push({ op: 'platform', x: right, y: top, w: 22, h: Math.max(120, floorY - top) });
    const span = Math.max(140, right - left - 80);
    const shelfW = Math.min(160, Math.round(span * 0.46));
    const rows = kind === 'arena' ? 3 : hard ? 4 : 3;
    for (let i = 0; i < rows; i += 1) {
      const x = fitX(left + 46 + (i % 2) * Math.max(40, span - shelfW), shelfW, worldW);
      const y = Math.max(90, floorY - 96 - i * (hard ? 84 : 74));
      spots.push({ x, y, w: shelfW, h: 22 });
    }
    pushSpots(ops, spots);
    if (kind === 'boss' && (placeBoss || invent)) {
      ops.push({
        op: 'boss',
        x: Math.round((left + right) / 2),
        y: floorY - 96,
        w: 72,
        h: 72,
        hp: slots.hp == null ? layoutInt(rng, 8, 16) : hp,
        touch: true,
        projectile: !on('laser') && (on('shoot') || invent),
        laser: on('laser'),
        win: 'boss',
      });
      placed.add('boss');
      if (invent || on('shoot')) shots = !on('laser');
    }
    if (invent || on('coin')) {
      spots.forEach((spot) => ops.push({ op: 'coin', x: spot.x + 28, y: spot.y - 52 }));
      placed.add('coin');
    }
    if (open || kind === 'boss') markSpawnGoal(spots.length ? spots : [{ x: left + 40, y: floorY, w: 80 }]);
    if (invent && kind === 'boss') jumps = 3;
    notes.push(kind === 'boss' ? 'A boss waits on the floor of an arena, with shelves to dodge from.' : 'An arena with shelves at even heights.');
  } else if (kind === 'warp') {
    const left = { x: fitX(140 + shift, 200, worldW), y: floorY - 48, w: 200, h: 22 };
    const right = { x: fitX(left.x + 460, 180, worldW), y: floorY - layoutInt(rng, 120, 170), w: 180, h: 22 };
    spots = [left, right];
    pushSpots(ops, spots);
    ops.push({ op: 'lava', x: fitX(left.x + left.w + 24, 140, worldW), y: floorY - 24, w: Math.max(80, Math.min(180, right.x - left.x - left.w - 48)), h: 24 });
    placed.add('lava');
    const destOx = Math.max(-400, Math.min(400, right.x - left.x - 20));
    const destOy = Math.max(-400, Math.min(400, right.y - left.y));
    const portalN = on('portal') ? countOf(prompt, PORTAL_WORDS, 1, 2, 1) : 1;
    for (let i = 0; i < portalN; i += 1) ops.push({ op: 'portal', x: left.x + 24 + i * 56, y: left.y - 48, w: 48, h: 48, destOx, destOy });
    placed.add('portal');
    markSpawnGoal(spots);
    notes.push('Two islands are split by lava, and a portal on the first one lands on the second.');
  } else {
    spots = stairSpots(rng, worldW, floorY, steps, rise);
    pushSpots(ops, spots);
    ops.push({ op: 'spring', x: fitX(spots[0].x - 70, 48, worldW), y: floorY - 24, w: 48, h: 24, vy: -layoutInt(rng, 1000, 1280) });
    placed.add('spring');
    const coinN = on('coin') ? countOf(prompt, COIN_WORDS, steps, 8, steps) : steps;
    for (let i = 0; i < coinN; i += 1) {
      const host = spots[i % spots.length];
      ops.push({ op: 'coin', x: host.x + 36, y: host.y - 52 });
    }
    placed.add('coin');
    if (hard) {
      for (let i = 0; i < spots.length - 1; i += 1) ops.push({ op: 'spike', x: fitX(spots[i].x + spots[i].w + 8, 56, worldW), y: floorY - 28, w: 56, h: 28 });
      placed.add('spike');
    }
    markSpawnGoal([{ x: Math.max(40, spots[0].x - 90), y: floorY, w: 40 }].concat(spots));
    if (invent) jumps = easy ? 3 : 2;
    notes.push(hard ? 'A steep stair of platforms, with a spring at the bottom and spikes in the gaps.' : 'A stair of platforms with a coin on each step and a spring at the bottom.');
  }
  if (on('portal') && !placed.has('portal') && spots.length) {
    const count = countOf(prompt, PORTAL_WORDS, 1, 3, 1);
    for (let i = 0; i < count; i += 1) ops.push({ op: 'portal', x: spots[0].x + 16, y: spots[0].y - 48, w: 48, h: 48, destOx: 240, destOy: Math.max(-400, spots[spots.length - 1].y - spots[0].y) });
    notes.push('A portal on the first platform warps toward the goal.');
  }
  if ((on('spring') && !placed.has('spring'))) {
    const count = countOf(prompt, SPRING_WORDS, 1, 4, 2);
    const vy = -layoutInt(rng, 1100, 1400);
    for (let i = 0; i < count; i += 1) ops.push({ op: 'spring', x: fitX(200 + shift + i * 56, 48, worldW), y: floorY - 24, w: 48, h: 24, vy });
  }
  if (on('spike') && !placed.has('spike')) {
    const count = countOf(prompt, SPIKE_WORDS, 3, 6, 3);
    for (let i = 0; i < count; i += 1) ops.push({ op: 'spike', x: fitX(360 + i * 68, 64, worldW), y: floorY - 28, w: 64, h: 28 });
  }
  if (on('lava') && !placed.has('lava')) ops.push({ op: 'lava', x: fitX(480, 160, worldW), y: floorY - 24, w: 160, h: 24 });
  if ((on('monster') || on('chase')) && !placed.has('monster')) {
    const count = countOf(prompt, MONSTER_WORDS, 1, 4, 2);
    for (let i = 0; i < count; i += 1) ops.push({ op: 'monster', x: fitX(300 + i * 80, 28, worldW), y: floorY - 48, w: 28, h: 28, hp: 1, chase: on('chase') || kind === 'chase', pattern: 'patrol' });
  }
  if (placeBoss && !placed.has('boss')) {
    const host = spots.length ? spots[spots.length - 1] : { x: 700, y: floorY };
    ops.push({ op: 'boss', x: host.x + 20, y: host.y - 96, w: 64, h: 64, hp, touch: true, projectile: on('shoot') && !on('laser'), laser: on('laser'), win: 'boss' });
  }
  if (on('switch') && spots[0]) ops.push({ op: 'switch', x: spots[0].x + 20, y: floorY - 16, w: 40, h: 16, moveX: 0, moveY: -76 });
  if (on('mover') && spots.length > 1) ops.push({ op: 'mover', x: Math.round((spots[0].x + spots[1].x) / 2), y: spots[1].y, w: 110, h: 20, axis: 'x', amp: 90 });
  if (on('lifter') && spots.length) ops.push({ op: 'lifter', x: spots[0].x, y: floorY - 24, w: 80, h: 20, axis: 'y', amp: Math.max(48, floorY - spots[spots.length - 1].y - 40) });
  if (on('gravity') && spots.length) ops.push({ op: 'gravity', x: spots[0].x + 8, y: spots[0].y - 70, w: 40, h: 64, targetDir: slots.down ? 1 : -1 });
  if (on('fireball')) ops.push({ op: 'fireball', from: 'left', pos: Math.max(64, floorY - 130) });
  if (on('blackout') && spots.length) ops.push({ op: 'blackout', x: spots[0].x + 8, y: spots[0].y - 48, w: 40, h: 40, blackSec: 3, afterSec: 2, onTouch: true });
  if (on('sign')) {
    const text = slots.sign ? signText(slots) : SIGN_LINES[layoutInt(rng, 0, SIGN_LINES.length - 1)];
    ops.push({ op: 'sign', x: fitX(80 + shift, 160, worldW), y: floorY - 150, w: 160, h: 48, text, size: 22 });
  }
  if (on('circle') && spots[0]) ops.push({ op: 'platform', x: spots[0].x + 8, y: spots[0].y - 8, w: 48, h: 48, shape: 'circle' });
  if (on('triangle') && spots.length) {
    const host = spots[spots.length - 1];
    ops.push({ op: 'platform', x: host.x + 8, y: host.y - 8, w: 48, h: 48, shape: 'triangle' });
  }
  return { ops, notes, jumps, shots, laser: false, shotGap };
}

export function planLevelRequest(prompt, data) {
  const summary = levelSummary(data);
  const scored = scoreRequest(prompt);
  const slots = scored.slots;
  const on = (label) => scored.scores[label] >= scored.threshold;
  const worldW = num(summary.worldW, 400, 20000, 1400);
  const floorY = floorYOf(summary);
  const action = [
    'arena', 'platform', 'spike', 'lava', 'coin', 'spawn', 'goal', 'monster', 'boss', 'shoot', 'laser',
    'portal', 'switch', 'spring', 'mover', 'lifter', 'gravity', 'fireball', 'blackout', 'sign', 'circle', 'triangle',
    'chase', 'jump', 'kill', 'whole', 'hard', 'easy', 'climb', 'wide', 'replace',
  ];
  if (on('explain') && !action.some((label) => label !== 'explain' && label !== 'replace' && on(label))) {
    return { explanation: describeScript(summary.spl), spl: null, ops: [] };
  }
  const recognized = action.some((label) => label !== 'explain' && label !== 'replace' && on(label));
  if (isChatter(prompt, recognized)) {
    return { explanation: 'Tell me what to build and I will make it.', spl: null, ops: [] };
  }

  const rng = layoutRng(prompt);
  const full = on('whole') || on('hard') || on('easy') || on('climb') || on('wide');
  const askedObject = ['spike', 'lava', 'coin', 'spring', 'portal', 'switch', 'monster', 'chase', 'mover', 'lifter', 'gravity', 'fireball', 'blackout', 'sign', 'circle', 'triangle', 'boss', 'spawn', 'goal', 'platform', 'arena', 'jump', 'kill', 'shoot', 'laser'].some(on);
  const open = full || !askedObject;
  const directed = open && askedObject;
  const invent = open && !directed;
  const bossAttack = (on('shoot') || on('laser')) && !(on('fireball') && !on('boss') && !on('laser'));
  const placeBoss = (on('boss') && !bossAttack) || ((on('boss') || bossAttack) && !summary.hasBoss);
  const hp = slots.hp == null ? 8 : Math.max(1, Math.min(100000, Math.round(slots.hp)));
  const hard = on('hard');
  const easy = on('easy');
  const shift = layoutInt(rng, 0, 36);
  const ctx = { rng, worldW, floorY, on, prompt, slots, placeBoss, hp, directed, open, invent, hard, easy, shift, summary };
  const built = !open && !on('arena') ? arrangeAsked(ctx) : buildCourse(pickScene(rng, on, directed), ctx);
  const shotGap = on('shoot') || on('laser') ? secondsNear(prompt, ['shoot', 'shot', 'shots', 'fire', 'fires', 'laser', 'beam'], slots.seconds == null ? built.shotGap || 3 : slots.seconds) : built.shotGap || 3;
  const killWait = on('kill') ? secondsNear(prompt, ['kill', 'kills', 'killing', 'die', 'dies'], slots.seconds == null ? 8 : slots.seconds) : null;
  const script = scriptBundle(summary, {
    jumps: on('jump') ? (slots.jumps == null ? 3 : slots.jumps) : built.jumps,
    shots: (bossAttack && !on('laser')) || !!built.shots,
    laser: on('laser') || !!built.laser,
    kill: on('kill'),
    killWait,
    shotGap,
    damage: slots.damage == null ? null : Math.max(1, Math.min(100, Math.round(slots.damage))),
    replace: on('replace'),
  });
  const notes = built.notes.concat(script.notes);
  const ops = built.ops.slice(0, 36);
  if (!ops.length && !script.spl) {
    return { explanation: 'Tell me what to build and I will make it.', spl: null, ops: [] };
  }
  return { explanation: notes.join(' '), spl: script.spl, ops };
}

function floorYOf(summary) {
  const worldH = num(summary.worldH, 300, 20000, 720);
  let floorY = worldH - 100;
  for (const platform of summary.platforms || []) {
    if (Number(platform.w) > num(summary.worldW, 400, 20000, 1400) * 0.5) floorY = Number(platform.y);
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

function mergeScript(existing, head, tail) {
  const fresh = (head || []).filter((line) => {
    const key = line.match(/skyhop\.get\("([^"]+)"\)/);
    return !key || !String(existing || '').includes(key[1]);
  });
  const extra = tail || [];
  if (!fresh.length && !extra.length) return String(existing || '').trim() || null;
  let base = String(existing || '').trim();
  if (!base) return 'use skyhop;\n' + fresh.concat(extra).join('\n');
  if (!/^use\s+skyhop\s*;/i.test(base)) base = 'use skyhop;\n' + base;
  if (fresh.length) {
    const breakAt = base.indexOf('\n');
    base = breakAt === -1 ? base + '\n' + fresh.join('\n') : base.slice(0, breakAt) + '\n' + fresh.join('\n') + base.slice(breakAt);
  }
  if (extra.length) base += '\n' + extra.join('\n');
  return base;
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
    userId: uid(user && user.id),
    username: String((user && user.username) || '').slice(0, 40),
  });
  if (failed) throw new Error(explanation);
  return { explanation, spl, ops };
}
