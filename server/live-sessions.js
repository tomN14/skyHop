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

export function createRoom(roomId, hostWs, hostPlayerId, name, isCollab, anticheatEnabled) {
  const room = {
    id: roomId,
    host: hostWs,
    started: false,
    startAt: 0,
    createdAt: Date.now(),
    collab: !!isCollab,
    anticheatEnabled: anticheatEnabled !== false,
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
    public: false,
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
    anticheatEnabled: room.anticheatEnabled !== false,
    started: !!room.started,
    worldScope: room.collab ? room.worldScope || 'w1' : null,
    createdAt: room.createdAt || 0,
    startedAt: room.startAt || 0,
    public: !!room.public,
    playerCount: room.clients.size,
    spectatorCount: room.spectators ? room.spectators.size : 0,
    players,
    spectators: spectatorList(room),
    flags: Array.isArray(room.flags) ? room.flags.slice(-12) : [],
  };
}

export function publicSessionSummary(room) {
  const players = [];
  for (const c of room.clients) {
    const m = socketMeta.get(c);
    if (!m || m.spectator) continue;
    const pr = room.progress[m.playerId] || {};
    players.push({
      id: m.playerId,
      name: room.names[m.playerId] || '?',
      host: c === room.host,
      stage: pr.stage != null ? pr.stage : 0,
      finished: !!pr.finished,
    });
  }
  return {
    id: room.id,
    mode: room.collab ? 'collab' : 'race',
    started: !!room.started,
    world: room.raceWorld === 2 ? 2 : room.raceWorld === 1 ? 1 : null,
    worldScope: room.collab ? room.worldScope || 'w1' : null,
    playerCount: room.clients.size,
    players,
  };
}

export function listPublicSessions() {
  const out = [];
  for (const room of rooms.values()) {
    if (!room.public) continue;
    out.push(publicSessionSummary(room));
  }
  out.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
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

function applyProgressTrusted(room, prev, msg, now) {
  const cap =
    room.maxStage0 != null && Number.isFinite(room.maxStage0)
      ? Math.max(0, Math.floor(room.maxStage0))
      : 49;
  const stage = msg.stage0 != null ? Math.max(0, Math.min(cap, Math.floor(msg.stage0))) : 0;
  const timeMs = Number.isFinite(Number(msg.timeMs)) ? Math.max(0, Number(msg.timeMs)) : 0;
  const deaths = Math.max(0, Math.floor(Number(msg.deaths) || 0));
  const warps = Math.max(0, Math.floor(Number(msg.warps) || 0));
  const x = Number.isFinite(Number(msg.x)) ? Number(msg.x) : prev.x;
  const y = Number.isFinite(Number(msg.y)) ? Number(msg.y) : prev.y;
  return {
    ok: true,
    kick: null,
    drop: false,
    flags: [],
    suspicion: 0,
    stage,
    stageAt: now,
    timeMs,
    deaths,
    warps,
    x,
    y,
    rateHits: 0,
    rateWindowAt: now,
    progressHits: (prev.progressHits || 0) + 1,
  };
}

export function applyProgress(room, playerId, msg, now) {
  if (!room.progress[playerId]) room.progress[playerId] = emptyProgress();
  const prev = room.progress[playerId];
  const ev =
    room.anticheatEnabled === false
      ? applyProgressTrusted(room, prev, msg, now)
      : evaluateProgress(room, prev, msg, now);
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
  if (room.anticheatEnabled === false) {
    const timeMs = Number.isFinite(Number(msg.timeMs)) ? Math.max(0, Number(msg.timeMs)) : 0;
    const deaths = Math.max(0, Math.floor(Number(msg.deaths) || 0));
    prev.finished = true;
    prev.finalTimeMs = timeMs;
    prev.deaths = deaths;
    prev.stage = room.maxStage0 != null ? room.maxStage0 : prev.stage;
    const token = room.collab ? null : issueRaceFinishReceipt(timeMs, deaths);
    return { ok: true, timeMs, deaths, token };
  }
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

export function viewChatRow(row, reveal) {
  if (!row) return null;
  const view = {
    id: row.id || null,
    at: row.at,
    from: row.from,
    text: row.text,
    staff: !!row.staff,
    modAlias: !!row.modAlias,
    flagged: !!row.flagged,
    edited: !!row.edited,
  };
  if (reveal && row.modAlias) view.moderatorUsername = row.modUsername || 'Unknown';
  return view;
}

export function chatHistoryFor(room, reveal) {
  return (room.chat || []).map((row) => viewChatRow(row, reveal));
}

function mayRevealMod(role) {
  return role === 'owner' || role === 'admin';
}

export function broadcastChat(room, row) {
  const deliver = (sock) => {
    const meta = socketMeta.get(sock);
    send(sock, { type: 'roomChat', ...viewChatRow(row, mayRevealMod(meta && meta.role)) });
  };
  for (const c of room.clients) deliver(c);
  if (room.spectators) {
    for (const s of room.spectators) deliver(s);
  }
}

export function broadcastChatUpdate(room, kind, row) {
  const deliver = (sock) => {
    const meta = socketMeta.get(sock);
    const reveal = mayRevealMod(meta && meta.role);
    if (kind === 'delete') {
      send(sock, { type: 'roomChatDelete', id: row.id });
      return;
    }
    send(sock, { type: 'roomChatEdit', ...viewChatRow(row, reveal) });
  };
  for (const c of room.clients) deliver(c);
  if (room.spectators) {
    for (const s of room.spectators) deliver(s);
  }
}

function modAliasName() {
  const n = Math.floor(Math.random() * 100000);
  return 'SkyHopMod_' + String(n).padStart(5, '0');
}

export function applyChat(room, playerId, rawText, meta) {
  const now = Date.now();
  const last = meta && meta.lastChatAt != null ? meta.lastChatAt : 0;
  if (now - last < CHAT_GAP_MS) return { ok: false, error: 'Slow down a second.' };
  const text = String(rawText || '').trim().slice(0, CHAT_MAX);
  if (!text) return { ok: false, error: 'Empty message.' };
  const censored = censorProfanity(text);
  const from = (meta && (meta.displayName || meta.username)) || room.names[playerId] || 'Player';
  const row = {
    id: crypto.randomUUID(),
    at: now,
    from,
    text: censored.text,
    staff: false,
    modAlias: false,
    flagged: !!censored.flagged,
  };
  room.chat.push(row);
  if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
  if (meta) meta.lastChatAt = now;
  return { ok: true, row };
}

export function applyModChat(room, rawText, meta) {
  const now = Date.now();
  const last = meta && meta.lastChatAt != null ? meta.lastChatAt : 0;
  if (now - last < CHAT_GAP_MS) return { ok: false, error: 'Slow down a second.' };
  const text = String(rawText || '').trim().slice(0, CHAT_MAX);
  if (!text) return { ok: false, error: 'Empty message.' };
  const censored = censorProfanity(text);
  const row = {
    id: crypto.randomUUID(),
    at: now,
    from: modAliasName(),
    text: censored.text,
    staff: true,
    modAlias: true,
    modUserId: meta && meta.userId != null ? meta.userId : null,
    modUsername: (meta && meta.username) || 'Unknown',
    flagged: !!censored.flagged,
  };
  room.chat.push(row);
  if (room.chat.length > CHAT_HISTORY) room.chat.splice(0, room.chat.length - CHAT_HISTORY);
  if (meta) meta.lastChatAt = now;
  return { ok: true, row };
}

export function editChatMessage(room, id, rawText) {
  const want = String(id || '');
  const row = (room.chat || []).find((r) => r.id === want);
  if (!row) return { ok: false, error: 'Message not found.' };
  const text = String(rawText || '').trim().slice(0, CHAT_MAX);
  if (!text) return { ok: false, error: 'Empty message.' };
  const censored = censorProfanity(text);
  row.text = censored.text;
  row.flagged = !!censored.flagged;
  row.edited = true;
  return { ok: true, row };
}

export function deleteChatMessage(room, id) {
  const want = String(id || '');
  const idx = (room.chat || []).findIndex((r) => r.id === want);
  if (idx < 0) return { ok: false, error: 'Message not found.' };
  const [row] = room.chat.splice(idx, 1);
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
