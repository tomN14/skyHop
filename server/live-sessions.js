import crypto from 'crypto';
import { censorProfanity } from './profanity-filter.js';
import { evaluateFinish, evaluateProgress } from './race-anticheat.js';

export const rooms = new Map();
export const socketMeta = new Map();

const CHAT_MAX = 200;
const CHAT_HISTORY = 40;
const CHAT_GAP_MS = 500;
const RECEIPT_TTL_MS = 5 * 60 * 1000;
const MIN_UNTTOKENED_RACE_MS = 20000;

/** @type {Map<string, { timeMs: number, deaths: number, at: number }>} */
const raceFinishReceipts = new Map();

export function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

export function makeRoomId() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

export function makePlayerId() {
  return 'p' + Math.random().toString(36).slice(2, 12);
}

export function createRoom(roomId, hostWs, hostPlayerId, name, isCollab) {
  const room = {
    id: roomId,
    host: hostWs,
    started: false,
    startAt: 0,
    createdAt: Date.now(),
    collab: !!isCollab,
    worldScope: 'w1',
    maxStage0: 49,
    bossHpByStage: {},
    clients: new Set([hostWs]),
    spectators: new Set(),
    names: { [hostPlayerId]: name },
    usernames: {},
    progress: { [hostPlayerId]: emptyProgress() },
    chat: [],
    flags: [],
  };
  rooms.set(roomId, room);
  return room;
}

export function emptyProgress() {
  return { stage: 0, stageAt: 0, deaths: 0, warps: 0, finished: false, timeMs: 0, suspicion: 0, progressHits: 0, flags: [] };
}

export function playerList(room) {
  const players = [];
  for (const c of room.clients) {
    const m = socketMeta.get(c);
    if (!m || m.spectator) continue;
    players.push({
      id: m.playerId,
      name: room.names[m.playerId] || '?',
      username: room.usernames[m.playerId] || null,
      host: c === room.host,
    });
  }
  return players;
}

function spectatorList(room) {
  const out = [];
  for (const s of room.spectators || []) {
    const m = socketMeta.get(s);
    if (!m) continue;
    out.push({ username: m.username || 'staff', role: m.role || 'moderator' });
  }
  return out;
}

export function serializeRoom(room) {
  const players = [];
  for (const c of room.clients) {
    const m = socketMeta.get(c);
    if (!m || m.spectator) continue;
    const pr = room.progress[m.playerId] || {};
    players.push({
      id: m.playerId,
      name: room.names[m.playerId] || '?',
      username: room.usernames[m.playerId] || null,
      host: c === room.host,
      stage: pr.stage != null ? pr.stage : 0,
      finished: !!pr.finished,
      timeMs: pr.finalTimeMs != null ? pr.finalTimeMs : pr.timeMs || 0,
      flags: Array.isArray(pr.flags) ? pr.flags.slice(-6) : [],
    });
  }
  return {
    id: room.id,
    mode: room.collab ? 'collab' : 'race',
    started: !!room.started,
    worldScope: room.collab ? room.worldScope || 'w1' : null,
    createdAt: room.createdAt || 0,
    startedAt: room.startAt || 0,
    playerCount: room.clients.size,
    spectatorCount: room.spectators ? room.spectators.size : 0,
    players,
    spectators: spectatorList(room),
    flags: Array.isArray(room.flags) ? room.flags.slice(-12) : [],
  };
}

export function listLiveSessions() {
  const out = [];
  for (const room of rooms.values()) {
    out.push(serializeRoom(room));
  }
  out.sort((a, b) => (b.startedAt || b.createdAt || 0) - (a.startedAt || a.createdAt || 0));
  return out;
}

export function broadcastPlayers(room, obj, exceptWs) {
  for (const c of room.clients) {
    if (c !== exceptWs) send(c, obj);
  }
}

export function broadcastAll(room, obj, exceptWs) {
  for (const c of room.clients) {
    if (c !== exceptWs) send(c, obj);
  }
  if (room.spectators) {
    for (const s of room.spectators) {
      if (s !== exceptWs) send(s, obj);
    }
  }
}

export function noteRoomFlag(room, playerId, flags) {
  if (!flags || !flags.length) return;
  const name = room.names[playerId] || playerId;
  for (const f of flags) {
    room.flags.push({ at: Date.now(), playerId, name, flag: f });
  }
  if (room.flags.length > 40) room.flags.splice(0, room.flags.length - 40);
}

export function issueRaceFinishReceipt(timeMs, deaths) {
  pruneReceipts();
  const token = crypto.randomBytes(16).toString('hex');
  raceFinishReceipts.set(token, { timeMs, deaths, at: Date.now() });
  return token;
}

function pruneReceipts() {
  const now = Date.now();
  for (const [k, v] of raceFinishReceipts) {
    if (!v || now - v.at > RECEIPT_TTL_MS) raceFinishReceipts.delete(k);
  }
}

export function consumeRaceFinishReceipt(token, timeMs) {
  pruneReceipts();
  const tok = String(token || '').trim();
  if (!tok) return { ok: false, missing: true };
  const row = raceFinishReceipts.get(tok);
  if (!row) return { ok: false };
  raceFinishReceipts.delete(tok);
  if (Math.abs(Number(timeMs) - row.timeMs) > 4000) return { ok: false };
  return { ok: true };
}

export function minUntokenedRaceMs() {
  return MIN_UNTTOKENED_RACE_MS;
}

export function applyProgress(room, playerId, msg, now) {
  if (!room.progress[playerId]) room.progress[playerId] = emptyProgress();
  const prev = room.progress[playerId];
  const ev = evaluateProgress(room, prev, msg, now);
  if (ev.drop) return ev;
  if (ev.kick) {
    prev.flags = (prev.flags || []).concat(ev.flags || ['kick']);
    noteRoomFlag(room, playerId, ev.flags || ['kick']);
    return ev;
  }
  prev.stage = ev.stage;
  prev.stageAt = ev.stageAt;
  prev.deaths = ev.deaths;
  prev.warps = ev.warps;
  prev.timeMs = ev.timeMs;
  prev.suspicion = ev.suspicion;
  prev.progressHits = ev.progressHits;
  prev.rateHits = ev.rateHits;
  prev.rateWindowAt = ev.rateWindowAt;
  prev.lastAt = now;
  if (ev.x != null && ev.y != null) {
    prev.x = ev.x;
    prev.y = ev.y;
  }
  if (ev.flags && ev.flags.length) {
    prev.flags = (prev.flags || []).concat(ev.flags).slice(-12);
    noteRoomFlag(room, playerId, ev.flags);
  }
  return ev;
}

export function applyFinish(room, playerId, msg, now) {
  if (!room.progress[playerId]) room.progress[playerId] = emptyProgress();
  const prev = room.progress[playerId];
  const ev = evaluateFinish(room, prev, msg, now);
  if (!ev.ok) {
    prev.flags = (prev.flags || []).concat(['bad_finish']);
    noteRoomFlag(room, playerId, ['bad_finish']);
    return ev;
  }
  prev.finished = true;
  prev.finalTimeMs = ev.timeMs;
  prev.stage = room.maxStage0 != null ? room.maxStage0 : prev.stage;
  const token = room.collab ? null : issueRaceFinishReceipt(ev.timeMs, ev.deaths);
  return { ok: true, timeMs: ev.timeMs, deaths: ev.deaths, token };
}

export function applyChat(room, playerId, rawText, meta) {
  const now = Date.now();
  const last = meta && meta.lastChatAt != null ? meta.lastChatAt : 0;
  if (now - last < CHAT_GAP_MS) return { ok: false, error: 'Slow down a second.' };
  const text = String(rawText || '').trim().slice(0, CHAT_MAX);
  if (!text) return { ok: false, error: 'Empty message.' };
  const censored = censorProfanity(text);
  const from =
    (meta && meta.spectator ? '[Staff] ' : '') +
    ((meta && (meta.displayName || meta.username)) || room.names[playerId] || 'Player');
  const row = {
    at: now,
    from,
    text: censored.text,
    staff: !!(meta && meta.spectator),
    flagged: !!censored.flagged,
  };
  room.chat.push(row);
  if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
  if (meta) meta.lastChatAt = now;
  return { ok: true, row };
}

export function leaveRoom(s, roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const m = socketMeta.get(s);
  const pid = m && m.playerId;
  const wasSpectator = !!(m && m.spectator);

  if (wasSpectator) {
    if (room.spectators) room.spectators.delete(s);
    if (m) m.roomId = null;
    return;
  }

  room.clients.delete(s);
  if (m) m.roomId = null;
  if (room.host === s && room.clients.size) {
    const n = room.clients.values().next().value;
    room.host = n;
  }
  delete room.names[pid];
  delete room.usernames[pid];
  delete room.progress[pid];
  const players = playerList(room);
  broadcastAll(room, { type: 'playerLeft', playerId: pid, players }, s);
  if (!room.clients.size) {
    if (room.spectators) {
      for (const sp of room.spectators) {
        send(sp, { type: 'sessionEnded', message: 'Session ended.' });
      }
    }
    rooms.delete(roomId);
  }
}
