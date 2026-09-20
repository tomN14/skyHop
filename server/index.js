import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import './env.js';
import { handleApi } from './api.js';
import { store } from './store.js';
import { effectiveRole, isAccountDisabled, isStaffRole } from './moderation.js';
import { recordVisit } from './visit-stats.js';
import {
  applyChat,
  applyFinish,
  applyProgress,
  broadcastAll,
  createRoom,
  leaveRoom,
  makePlayerId,
  makeRoomId,
  playerList,
  rooms,
  send,
  serializeRoom,
  socketMeta,
} from './live-sessions.js';

const PORT = Number(process.env.SKYHOP_RACE_PORT || 3001);
/** 0.0.0.0 = LAN + 127.0.0.1. Other PCs in the game must use ws://(host's Wi-Fi IP):port, not 127.0.0.1. */
const HOST = process.env.SKYHOP_RACE_HOST || '0.0.0.0';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Parent folder of `server/` — game static files (index.html, js/, stages*.js) for one-URL deploys */
const STATIC_ROOT = path.resolve(process.env.SKYHOP_STATIC_ROOT || path.join(__dirname, '..'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, urlPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return false;

  let rel = urlPath;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return false;
  }
  if (rel.includes('\0')) return false;

  const segments = rel.split('/').filter(Boolean);
  if (segments.some((p) => p === '..')) return false;

  let fileKey = segments.join('/');
  if (!fileKey) fileKey = 'index.html';

  const absPath = path.join(STATIC_ROOT, fileKey);
  const relFromRoot = path.relative(STATIC_ROOT, absPath);
  if (relFromRoot.startsWith('..') || path.isAbsolute(relFromRoot)) return false;

  try {
    const st = await fs.stat(absPath);
    if (!st.isFile()) return false;
    const ext = path.extname(absPath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    const body = req.method === 'HEAD' ? null : await fs.readFile(absPath);
    res.writeHead(200, { 'Content-Type': type });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

async function wsUserFromToken(authToken) {
  const tok = authToken != null ? String(authToken).trim() : '';
  if (!tok || typeof store.sessionUserId !== 'function') return null;
  try {
    const uid = await store.sessionUserId(tok);
    if (!uid) return null;
    const user = await store.findUserById(uid);
    if (!user) return null;
    return {
      uid,
      username: user.username,
      role: effectiveRole(user),
      disabled: isAccountDisabled(user),
    };
  } catch {
    return null;
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const server = http.createServer((req, res) => {
  const run = async () => {
    try {
      if (await handleApi(req, res)) return;
    } catch (e) {
      console.error('[Sky Hop API]', e);
      const reqPath = (req.url && req.url.split('?')[0]) || '/';
      const detail = String(e?.message || e || 'Server error').slice(0, 500);
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end(
        JSON.stringify({
          error: reqPath.startsWith('/api') ? detail : 'Server error',
        })
      );
      return;
    }
    const reqPath = (req.url && req.url.split('?')[0]) || '/';
    if (reqPath === '/health') {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '600' });
        res.end();
        return;
      }
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
        const ownerSet = !!String(process.env.SKYHOP_OWNER_USERNAME || '').trim();
        const ownerEmailSet = !!String(process.env.SKYHOP_OWNER_EMAIL || '').trim();
        const resendSet = !!String(
          process.env.SKYHOP_RESEND_API_KEY || process.env.RESEND_API_KEY || ''
        ).trim();
        res.end(
          JSON.stringify({
            ok: true,
            service: 'skyhop-race',
            /** True if SKYHOP_OWNER_USERNAME is non-empty (same process that runs /api). */
            ownerEnvConfigured: ownerSet,
            ownerEmailConfigured: ownerEmailSet,
            resendConfigured: resendSet,
          })
        );
        return;
      }
    }
    if (await serveStatic(req, res, reqPath)) {
      if (req.method === 'GET' && (reqPath === '/' || reqPath === '/index.html')) {
        void recordVisit().catch(() => {});
      }
      return;
    }
    res.writeHead(404, CORS);
    res.end();
  };
  void run();
});

const wss = new WebSocketServer({ server });

function kickCheater(ws, room, reason) {
  send(ws, { type: 'cheatKick', reason: reason || 'Removed from this session.' });
  const meta = socketMeta.get(ws);
  if (meta && meta.roomId) leaveRoom(ws, meta.roomId);
  try {
    ws.close();
  } catch {
    /* */
  }
}

function progressPayload(room, playerId, msg, ev) {
  const out = {
    type: 'playerProgress',
    playerId,
    name: room.names[playerId] || '?',
    stage0: ev.stage,
    timeMs: ev.timeMs || 0,
  };
  if (ev.x != null && ev.y != null) {
    out.x = ev.x;
    out.y = ev.y;
    if (msg.g != null) out.g = Number(msg.g) < 0 ? -1 : 1;
  }
  if (msg.vx != null && msg.vy != null) {
    const nvx = Math.max(-4000, Math.min(4000, Number(msg.vx)));
    const nvy = Math.max(-4000, Math.min(4000, Number(msg.vy)));
    if (Number.isFinite(nvx) && Number.isFinite(nvy)) {
      out.vx = nvx;
      out.vy = nvy;
    }
  }
  if (msg.og != null) out.og = !!msg.og;
  return out;
}

wss.on('connection', (ws) => {
  const playerId = makePlayerId();
  socketMeta.set(ws, { playerId, roomId: null });

  send(ws, { type: 'hello', playerId });

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }

    if (msg.type === 'create') {
      void (async () => {
        const user = await wsUserFromToken(msg.authToken);
        if (user && user.disabled) {
          send(ws, { type: 'error', message: 'Account disabled — cannot host races.' });
          return;
        }
        if (rooms.size > 500) {
          send(ws, { type: 'error', message: 'Server busy' });
          return;
        }
        let roomId = makeRoomId();
        while (rooms.has(roomId)) roomId = makeRoomId();
        const name = (msg.name && String(msg.name).slice(0, 20)) || 'Host';
        const isCollab = String(msg.mode || '').toLowerCase() === 'collab';
        const room = createRoom(roomId, ws, playerId, name, isCollab);
        const meta = socketMeta.get(ws);
        meta.roomId = roomId;
        meta.displayName = name;
        if (user && user.username) {
          meta.username = user.username;
          meta.role = user.role;
          room.usernames[playerId] = user.username;
        }
        send(ws, {
          type: 'roomCreated',
          roomId,
          youAreHost: true,
          name,
          playerId,
          players: playerList(room),
          chat: room.chat,
        });
      })();
      return;
    }

    if (msg.type === 'join') {
      void (async () => {
        const user = await wsUserFromToken(msg.authToken);
        if (user && user.disabled) {
          send(ws, { type: 'error', message: 'Account disabled — cannot join races.' });
          return;
        }
        const roomId =
          (msg.roomId && String(msg.roomId).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)) || '';
        if (roomId.length < 4) {
          send(ws, { type: 'error', message: 'Invalid session ID' });
          return;
        }
        const room = rooms.get(roomId);
        if (!room) {
          send(ws, { type: 'error', message: 'Session not found' });
          return;
        }
        if (room.started) {
          send(ws, { type: 'error', message: room.collab ? 'Session already started' : 'Race already started' });
          return;
        }
        if (room.clients.size >= 8) {
          send(ws, { type: 'error', message: 'Session full' });
          return;
        }
        const name = (msg.name && String(msg.name).slice(0, 20)) || 'Racer';
        room.clients.add(ws);
        room.names[playerId] = name;
        room.progress[playerId] = { stage: 0, finished: false, timeMs: 0, suspicion: 0, progressHits: 0, flags: [] };
        const meta = socketMeta.get(ws);
        meta.roomId = roomId;
        meta.displayName = name;
        if (user && user.username) {
          meta.username = user.username;
          meta.role = user.role;
          room.usernames[playerId] = user.username;
        }
        const players = playerList(room);
        send(ws, { type: 'joined', roomId, youAreHost: false, name, playerId, players, chat: room.chat });
        broadcastAll(room, { type: 'playerJoined', playerId, name, players }, ws);
      })();
      return;
    }

    if (msg.type === 'staffWatch') {
      void (async () => {
        const user = await wsUserFromToken(msg.authToken);
        if (!user || !isStaffRole(user.role)) {
          send(ws, { type: 'error', message: 'Moderator, Admin, or Owner access required.' });
          return;
        }
        const roomId =
          (msg.roomId && String(msg.roomId).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)) || '';
        const room = rooms.get(roomId);
        if (!room) {
          send(ws, { type: 'error', message: 'Session not found' });
          return;
        }
        const meta = socketMeta.get(ws);
        if (meta.roomId && meta.roomId !== roomId) leaveRoom(ws, meta.roomId);
        meta.roomId = roomId;
        meta.spectator = true;
        meta.username = user.username;
        meta.role = user.role;
        meta.displayName = user.username;
        if (!room.spectators) room.spectators = new Set();
        room.spectators.add(ws);
        send(ws, {
          type: 'watching',
          room: serializeRoom(room),
          chat: room.chat,
        });
      })();
      return;
    }

    if (msg.type === 'start') {
      const meta = socketMeta.get(ws);
      const room = meta && meta.roomId && rooms.get(meta.roomId);
      if (!room) {
        send(ws, { type: 'error', message: 'No room' });
        return;
      }
      if (room.host !== ws) {
        send(ws, { type: 'error', message: 'Only the host can start' });
        return;
      }
      if (room.started) {
        send(ws, { type: 'error', message: 'Already started' });
        return;
      }
      if (room.clients.size < 1) {
        send(ws, { type: 'error', message: 'Need at least 1 player' });
        return;
      }
      room.started = true;
      const startAt = Date.now();
      room.startAt = startAt;
      const diffRaw = msg.difficulty != null ? String(msg.difficulty).toLowerCase() : 'normal';
      const difficulty = ['easy', 'normal', 'hard', 'custom'].includes(diffRaw) ? diffRaw : 'normal';
      let customOpts = null;
      if (difficulty === 'custom' && msg.customOpts && typeof msg.customOpts === 'object') {
        try {
          const ser = JSON.stringify(msg.customOpts);
          if (ser.length > 32000) {
            send(ws, { type: 'error', message: 'Custom settings payload too large' });
            room.started = false;
            room.startAt = 0;
            return;
          }
          customOpts = msg.customOpts;
        } catch {
          customOpts = null;
        }
      }
      if (room.collab) {
        const scopeRaw = msg.worldScope != null ? String(msg.worldScope).toLowerCase() : 'w1';
        const worldScope = scopeRaw === 'w2' || scopeRaw === 'both' ? scopeRaw : 'w1';
        room.worldScope = worldScope;
        const sc = Number(msg.stageCount);
        const nStages = Number.isFinite(sc) && sc >= 1 ? Math.min(200, Math.floor(sc)) : 50;
        room.maxStage0 = Math.max(0, nStages - 1);
        const pack = { type: 'collabStart', startAt, roomId: room.id, worldScope, difficulty };
        if (customOpts) pack.customOpts = customOpts;
        broadcastAll(room, pack);
        return;
      }
      room.maxStage0 = 49;
      const pack = { type: 'raceStart', startAt, roomId: room.id, difficulty };
      if (customOpts) pack.customOpts = customOpts;
      broadcastAll(room, pack);
      return;
    }

    if (msg.type === 'collabBossInit') {
      const meta = socketMeta.get(ws);
      const room = meta && meta.roomId && rooms.get(meta.roomId);
      if (!room || !room.started || !room.collab || meta.spectator) return;
      const key = String(msg.stage0 != null ? Math.floor(msg.stage0) : 0);
      const maxHp = Math.max(1, Math.min(100, Math.floor(Number(msg.maxHp) || 5)));
      if (room.bossHpByStage[key] == null) room.bossHpByStage[key] = maxHp;
      broadcastAll(room, { type: 'collabBossHp', stage0: Number(key), hp: room.bossHpByStage[key] });
      return;
    }

    if (msg.type === 'collabBossHit') {
      const meta = socketMeta.get(ws);
      const room = meta && meta.roomId && rooms.get(meta.roomId);
      if (!room || !room.started || !room.collab || meta.spectator) return;
      const key = String(msg.stage0 != null ? Math.floor(msg.stage0) : 0);
      const dmg = Math.max(0, Math.min(500, Math.floor(Number(msg.damage) || 0)));
      if (dmg < 1) return;
      const maxHp = Math.max(1, Math.min(100, Math.floor(Number(msg.maxHp) || 5)));
      if (room.bossHpByStage[key] == null) room.bossHpByStage[key] = maxHp;
      room.bossHpByStage[key] = Math.max(0, room.bossHpByStage[key] - dmg);
      broadcastAll(room, { type: 'collabBossHp', stage0: Number(key), hp: room.bossHpByStage[key] });
      return;
    }

    if (msg.type === 'progress') {
      const meta = socketMeta.get(ws);
      const room = meta && meta.roomId && rooms.get(meta.roomId);
      if (!room || !room.started || (meta && meta.spectator)) return;
      const now = Date.now();
      const ev = applyProgress(room, playerId, msg, now);
      if (ev.drop) return;
      if (ev.kick) {
        kickCheater(ws, room, ev.kick);
        return;
      }
      broadcastAll(room, progressPayload(room, playerId, msg, ev), ws);
      return;
    }

    if (msg.type === 'finished') {
      const meta = socketMeta.get(ws);
      const room = meta && meta.roomId && rooms.get(meta.roomId);
      if (!room || !room.started || (meta && meta.spectator)) return;
      const ev = applyFinish(room, playerId, msg, Date.now());
      if (!ev.ok) {
        kickCheater(ws, room, ev.kick);
        return;
      }
      if (room.collab) {
        broadcastAll(room, {
          type: 'collabWin',
          playerId,
          name: room.names[playerId] || '?',
          timeMs: ev.timeMs,
          deaths: ev.deaths,
        });
        return;
      }
      send(ws, { type: 'finishOk', token: ev.token, timeMs: ev.timeMs, deaths: ev.deaths });
      broadcastAll(
        room,
        {
          type: 'playerFinished',
          playerId,
          name: room.names[playerId] || '?',
          timeMs: ev.timeMs,
          deaths: ev.deaths,
        },
        ws
      );
      return;
    }

    if (msg.type === 'chat') {
      const meta = socketMeta.get(ws);
      const room = meta && meta.roomId && rooms.get(meta.roomId);
      if (!room) return;
      const result = applyChat(room, playerId, msg.text, meta);
      if (!result.ok) {
        send(ws, { type: 'error', message: result.error || 'Chat failed' });
        return;
      }
      broadcastAll(room, { type: 'roomChat', ...result.row });
      return;
    }

    if (msg.type === 'leave') {
      const meta = socketMeta.get(ws);
      const roomId = meta && meta.roomId;
      if (roomId) leaveRoom(ws, roomId);
      return;
    }
  });

  ws.on('close', () => {
    const meta = socketMeta.get(ws);
    if (meta && meta.roomId) leaveRoom(ws, meta.roomId);
    socketMeta.delete(ws);
  });
});

function onListen() {
  console.log(`Sky Hop race on ${HOST}:${PORT} — on this machine use ws://127.0.0.1:${PORT} — on another device use ws://LAN-IP:${PORT}`);
  console.log(`  Accounts & stats API: POST /api/register, /api/login, GET /api/me, POST /api/runs (same origin as above).`);
  console.log(`  Static game from ${STATIC_ROOT} — open http://127.0.0.1:${PORT}/ for one-URL play (use TLS proxy in production for https+wss).`);
}

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(
      `[Sky Hop] Port ${PORT} is already in use.\n` +
        `  • From the repo root:  npm run play  (frees this port and starts once)\n` +
        `  • Or close the other terminal where Sky Hop is already running — then you only need the browser.\n` +
        `  • Or:  kill $(lsof -t -i :${PORT})\n` +
        `  • Or another port:  SKYHOP_RACE_PORT=3002 npm start`
    );
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, onListen);
