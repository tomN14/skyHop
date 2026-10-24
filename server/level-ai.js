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

function objectCount(slots, fallback, max) {
  const reserved = [slots.seconds, slots.hp, slots.damage, slots.jumps].filter((n) => n != null);
  const free = (slots.numbers || []).filter((n) => !reserved.includes(n));
  if (!free.length) return fallback;
  return Math.max(1, Math.min(max, Math.round(free[0])));
}

function signText(slots) {
  const raw = slots.sign ? String(slots.sign).slice(0, 40) : 'Text';
  return censorProfanity(raw).text || 'Text';
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
    'chase', 'jump', 'whole', 'replace',
  ];
  if (on('explain') && !action.some((label) => label !== 'explain' && label !== 'replace' && on(label))) {
    return { explanation: describeScript(summary.spl), spl: null, ops: [] };
  }

  const whole = on('whole');
  const arena = whole || on('arena');
  const seconds = Math.max(0.2, Math.min(120, slots.seconds == null ? 3 : slots.seconds));
  const damage = slots.damage == null ? null : Math.max(1, Math.min(100, Math.round(slots.damage)));
  const bossAttack = (on('shoot') || on('laser')) && !(on('fireball') && !on('boss') && !on('laser'));
  const placeBoss = whole || (on('boss') && !bossAttack) || (bossAttack && !summary.hasBoss) || (on('boss') && !summary.hasBoss);
  const hp = slots.hp == null ? (placeBoss ? 8 : 1) : Math.max(1, Math.min(100000, Math.round(slots.hp)));
  const notes = [];
  const ops = [];

  const specificPlatform = on('circle') || on('triangle') || on('mover') || on('lifter');
  if (arena || (on('platform') && !specificPlatform)) {
    if (arena) {
      const small = !whole;
      const left = small ? 280 : 120;
      const right = small ? worldW - 320 : worldW - 140;
      const top = floorY - (small ? 200 : 280);
      ops.push(
        { op: 'platform', x: left, y: top, w: 22, h: Math.max(80, floorY - top) },
        { op: 'platform', x: right, y: top, w: 22, h: Math.max(80, floorY - top) },
        { op: 'platform', x: left + 70, y: floorY - 130, w: 150, h: 22 },
        { op: 'platform', x: Math.round((left + right) / 2 - 70), y: floorY - 220, w: 140, h: 22 },
        { op: 'platform', x: right - 190, y: floorY - 160, w: 150, h: 22 }
      );
      notes.push('Added an arena with platforms at different heights.');
    } else {
      const count = objectCount(slots, 3, 6);
      for (let i = 0; i < count; i += 1) {
        const x = Math.round(140 + ((worldW - 420) * i) / Math.max(1, count - 1));
        ops.push({ op: 'platform', x, y: floorY - 120 - (i % 3) * 90, w: 160, h: 22 });
      }
      notes.push('Added ' + count + ' platforms at different heights.');
    }
  }
  if (on('circle')) {
    ops.push({ op: 'platform', x: 420, y: floorY - 160, w: 48, h: 48, shape: 'circle' });
    notes.push('Added a round platform.');
  }
  if (on('triangle')) {
    ops.push({ op: 'platform', x: 560, y: floorY - 160, w: 48, h: 48, shape: 'triangle' });
    notes.push('Added a triangle.');
  }
  if (on('spike') || whole) {
    const count = objectCount(slots, 1, 6);
    for (let i = 0; i < count; i += 1) ops.push({ op: 'spike', x: 460 + i * 90, y: floorY - 28, w: 80, h: 28 });
    notes.push('Added spikes.');
  }
  if (on('lava')) {
    ops.push({ op: 'lava', x: 700, y: floorY - 24, w: 140, h: 24 });
    notes.push('Added lava.');
  }
  if (on('coin') || whole) {
    const count = objectCount(slots, 4, 8);
    for (let i = 0; i < count; i += 1) ops.push({ op: 'coin', x: 240 + i * 90, y: floorY - 90 });
    notes.push('Added ' + count + ' coins.');
  }
  if (on('spawn')) {
    ops.push({ op: 'spawn', x: 80, y: floorY - 80 });
    notes.push('Moved the spawn.');
  }
  if (on('goal') || whole) {
    ops.push({ op: 'goal', x: worldW - 220, y: floorY - 160 });
    notes.push('Moved the goal.');
  }
  if (on('monster') || on('chase') || whole) {
    const count = objectCount(slots, whole ? 2 : 1, 6);
    for (let i = 0; i < count; i += 1) {
      ops.push({
        op: 'monster',
        x: 360 + i * 140,
        y: floorY - 48,
        w: 28,
        h: 28,
        hp: hp > 1 && !placeBoss ? hp : 1,
        chase: on('chase'),
        pattern: 'patrol',
      });
    }
    notes.push('Added ' + count + ' monster' + (count === 1 ? '' : 's') + '.');
  }
  if (placeBoss) {
    ops.push({
      op: 'boss',
      x: Math.round(worldW * 0.62),
      y: floorY - 96,
      w: 64,
      h: 64,
      hp,
      touch: true,
      projectile: bossAttack || !on('laser'),
      laser: on('laser'),
      win: 'boss',
    });
    notes.push('Added a boss.');
  }
  if (on('portal')) {
    const count = objectCount(slots, 1, 4);
    for (let i = 0; i < count; i += 1) {
      ops.push({ op: 'portal', x: 240 + i * 180, y: floorY - 120, w: 48, h: 48, destOx: 24, destOy: -72 });
    }
    notes.push('Added a portal.');
  }
  if (on('switch')) {
    ops.push({ op: 'switch', x: 320, y: floorY - 40, w: 40, h: 16, moveX: 48, moveY: 0 });
    notes.push('Added a switch.');
  }
  if (on('spring')) {
    const count = objectCount(slots, 1, 6);
    for (let i = 0; i < count; i += 1) {
      ops.push({ op: 'spring', x: 300 + i * 120, y: floorY - 24, w: 48, h: 24 });
    }
    notes.push(count === 1 ? 'Added a spring.' : 'Added ' + count + ' springs.');
  }
  if (on('mover')) {
    ops.push({ op: 'mover', x: 480, y: floorY - 140, w: 80, h: 20, axis: 'x', amp: 80 });
    notes.push('Added a moving platform.');
  }
  if (on('lifter')) {
    ops.push({ op: 'lifter', x: 640, y: floorY - 180, w: 80, h: 20, axis: 'y', amp: 80 });
    notes.push('Added an elevator.');
  }
  if (on('gravity')) {
    ops.push({ op: 'gravity', x: 760, y: floorY - 160, w: 40, h: 64, targetDir: slots.down ? 1 : -1 });
    notes.push(slots.down ? 'Added a gravity arrow pointing down.' : 'Added a gravity arrow pointing up.');
  }
  if (on('fireball')) {
    ops.push({ op: 'fireball', from: 'left', pos: Math.max(64, floorY - 120) });
    notes.push('Added a fireball shooter.');
  }
  if (on('blackout')) {
    const blackSec = on('shoot') || on('laser') || slots.seconds == null ? 3 : Math.max(0.2, Math.min(30, slots.seconds));
    ops.push({ op: 'blackout', x: 860, y: floorY - 80, w: 40, h: 40, blackSec, afterSec: 2, onTouch: true });
    notes.push('Added a blackout.');
  }
  if (on('sign')) {
    ops.push({ op: 'sign', x: 200, y: floorY - 200, w: 160, h: 48, text: signText(slots), size: 22 });
    notes.push('Added a sign.');
  }

  const lines = [];
  if ((bossAttack && !on('laser')) || (placeBoss && !on('laser'))) lines.push.apply(lines, attackLines('projectile', seconds, damage));
  if (on('laser')) lines.push.apply(lines, attackLines('laser', seconds, damage));
  if (on('jump')) {
    const jumps = Math.max(1, Math.min(20, Math.round(slots.jumps == null ? 3 : slots.jumps)));
    lines.push('jump_cap <- skyhop.get("jump_limit");', 'jump_cap <- ' + jumps + ';');
    notes.push('Set the jump limit to ' + jumps + '.');
  }
  let spl = null;
  if (lines.length) {
    spl = on('replace') ? 'use skyhop;\n' + lines.join('\n') : mergeScript(summary.spl, lines);
    if ((bossAttack && !on('laser')) || (placeBoss && !on('laser'))) notes.push('Boss shots are on, with ' + seconds + ' seconds between them.');
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
