import fs from 'fs/promises';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';

import './env.js';

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

const rooms = new Map();
const socketMeta = new Map();

function makeRoomId() {
  const c = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function makePlayerId() {
  return 'p' + Math.random().toString(36).slice(2, 12);
}

function send(ws, obj) {
  if (ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function broadcastRoom(room, obj, exceptWs) {
  for (const c of room.clients) {
    if (c !== exceptWs) send(c, obj);
  }
  if (exceptWs) send(exceptWs, obj);
  else for (const c of room.clients) send(c, obj);
}

import { handleApi } from './api.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const server = http.createServer((req, res) => {
  const run = async () => {
    try {
      if (await handleApi(req, res)) return;
    } catch (e) {
      console.error(e);
      res.writeHead(500, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      });
      res.end(JSON.stringify({ error: 'Server error' }));
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
        res.end(
          JSON.stringify({
            ok: true,
            service: 'skyhop-race',
            /** True if SKYHOP_OWNER_USERNAME is non-empty (same process that runs /api). */
            ownerEnvConfigured: ownerSet,
          })
        );
        return;
      }
    }
    if (await serveStatic(req, res, reqPath)) return;
    res.writeHead(404, CORS);
    res.end();
  };
  void run();
});

const wss = new WebSocketServer({ server });

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
      if (rooms.size > 500) {
        send(ws, { type: 'error', message: 'Server busy' });
        return;
      }
      let roomId = makeRoomId();
      while (rooms.has(roomId)) roomId = makeRoomId();
      const name = (msg.name && String(msg.name).slice(0, 20)) || 'Host';
      const room = {
        id: roomId,
        host: ws,
        started: false,
        clients: new Set([ws]),
        names: { [playerId]: name },
        progress: { [playerId]: { stage: 0, finished: false } },
      };
      rooms.set(roomId, room);
      const meta = socketMeta.get(ws);
      meta.roomId = roomId;
      send(ws, { type: 'roomCreated', roomId, youAreHost: true, name, playerId, players: [{ id: playerId, name, host: true }] });
      return;
    }

    if (msg.type === 'join') {
      const roomId = (msg.roomId && String(msg.roomId).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)) || '';
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
        send(ws, { type: 'error', message: 'Race already started' });
        return;
      }
      if (room.clients.size >= 8) {
        send(ws, { type: 'error', message: 'Session full' });
        return;
      }
      const name = (msg.name && String(msg.name).slice(0, 20)) || 'Racer';
      room.clients.add(ws);
      room.names[playerId] = name;
      room.progress[playerId] = { stage: 0, finished: false };
      const meta = socketMeta.get(ws);
      meta.roomId = roomId;

      const players = [];
      for (const c of room.clients) {
        const m = socketMeta.get(c);
        if (!m) continue;
        players.push({
          id: m.playerId,
          name: room.names[m.playerId] || '?',
          host: c === room.host,
        });
      }

      send(ws, { type: 'joined', roomId, youAreHost: false, name, playerId, players });
      for (const c of room.clients) {
        if (c === ws) continue;
        send(c, { type: 'playerJoined', playerId, name, players });
      }
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
      const diffRaw = msg.difficulty != null ? String(msg.difficulty).toLowerCase() : 'normal';
      const difficulty = ['easy', 'normal', 'hard', 'custom'].includes(diffRaw) ? diffRaw : 'normal';
      let customOpts = null;
      if (difficulty === 'custom' && msg.customOpts && typeof msg.customOpts === 'object') {
        try {
          const ser = JSON.stringify(msg.customOpts);
          if (ser.length > 32000) {
            send(ws, { type: 'error', message: 'Custom settings payload too large' });
            room.started = false;
            return;
          }
          customOpts = msg.customOpts;
        } catch {
          customOpts = null;
        }
      }
      const pack = { type: 'raceStart', startAt, roomId: room.id, difficulty };
      if (customOpts) pack.customOpts = customOpts;
      for (const c of room.clients) send(c, pack);
      return;
    }

    if (msg.type === 'progress') {
      const meta = socketMeta.get(ws);
      const room = meta && meta.roomId && rooms.get(meta.roomId);
      if (!room || !room.started) return;
      const st = msg.stage0 != null ? Math.max(0, Math.min(49, Math.floor(msg.stage0))) : 0;
      let nx = null;
      let ny = null;
      let ng = null;
      if (msg.x != null && msg.y != null) {
        nx = Math.max(-5e5, Math.min(5e5, Number(msg.x)));
        ny = Math.max(-5e5, Math.min(5e5, Number(msg.y)));
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
          nx = null;
          ny = null;
        }
      }
      if (msg.g != null) {
        ng = Number(msg.g) < 0 ? -1 : 1;
      }
      if (room.progress[playerId]) {
        room.progress[playerId].stage = st;
        room.progress[playerId].timeMs = msg.timeMs != null ? msg.timeMs : 0;
      }
      for (const c of room.clients) {
        if (c === ws) continue;
        const out = {
          type: 'playerProgress',
          playerId,
          name: room.names[playerId] || '?',
          stage0: st,
          timeMs: msg.timeMs || 0,
        };
        if (nx != null && ny != null) {
          out.x = nx;
          out.y = ny;
          out.g = ng != null ? ng : 1;
        }
        send(c, out);
      }
      return;
    }

    if (msg.type === 'finished') {
      const meta = socketMeta.get(ws);
      const room = meta && meta.roomId && rooms.get(meta.roomId);
      if (!room || !room.started) return;
      if (room.progress[playerId]) {
        room.progress[playerId].finished = true;
        room.progress[playerId].finalTimeMs = msg.timeMs != null ? msg.timeMs : 0;
      }
      for (const c of room.clients) {
        if (c === ws) continue;
        send(c, {
          type: 'playerFinished',
          playerId,
          name: room.names[playerId] || '?',
          timeMs: msg.timeMs != null ? msg.timeMs : 0,
          deaths: msg.deaths != null ? msg.deaths : 0,
        });
      }
      return;
    }

    if (msg.type === 'leave') {
      const meta = socketMeta.get(ws);
      const roomId = meta && meta.roomId;
      if (roomId) leaveRoom(ws, roomId);
      return;
    }
  });

  function leaveRoom(s, roomId) {
    const room = rooms.get(roomId);
    if (!room) return;
    const m = socketMeta.get(s);
    const pid = m && m.playerId;
    room.clients.delete(s);
    if (m) m.roomId = null;
    if (room.host === s && room.clients.size) {
      const n = room.clients.values().next().value;
      room.host = n;
    }
    delete room.names[pid];
    delete room.progress[pid];
    for (const c of room.clients) {
      if (c === s) continue;
      const players = [];
      for (const x of room.clients) {
        const meta2 = socketMeta.get(x);
        if (!meta2) continue;
        players.push({ id: meta2.playerId, name: room.names[meta2.playerId] || '?', host: x === room.host });
      }
      send(c, { type: 'playerLeft', playerId: pid, players });
    }
    if (!room.clients.size) rooms.delete(roomId);
  }

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
