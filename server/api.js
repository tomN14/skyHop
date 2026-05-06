import { ACHIEVEMENT_DEFS, aggregateRuns, computeNewUnlocks } from './achievements.js';
import { store } from './store.js';
import * as UserLevels from './user-levels.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => {
      b += c;
      if (b.length > 2_000_000) {
        req.destroy();
        reject(new Error('too large'));
      }
    });
    req.on('end', () => resolve(b));
    req.on('error', reject);
  });
}

async function bearerUserId(req) {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  if (!m) return null;
  return store.sessionUserId(m[1].trim());
}

async function buildMePayload(userId) {
  const user = await store.findUserById(userId);
  if (!user) return null;
  const runs = await store.getRunsForUser(userId);
  const achRows = await store.getAchievementsForUser(userId);
  const agg = aggregateRuns(runs);
  const uaMap = new Map(achRows.map((a) => [a.achievementId, a.unlockedAt]));
  const achievements = ACHIEVEMENT_DEFS.map((def) => ({
    id: def.id,
    title: def.title,
    desc: def.desc,
    unlocked: uaMap.has(def.id),
    unlockedAt: uaMap.get(def.id) ?? null,
  }));
  return {
    username: user.username,
    stats: {
      runCount: agg.runCount,
      totalDeaths: agg.totalDeaths,
      minDeaths: agg.minDeaths,
      maxDeaths: agg.maxDeaths,
      bestTimeMs: agg.bestTimeMs,
      avgTimeMs: agg.avgTimeMs,
      avgDeaths: agg.avgDeaths,
    },
    achievements,
  };
}

/** @returns {Promise<boolean>} true if handled */
export async function handleApi(req, res) {
  const u = new URL(req.url || '/', 'http://localhost');
  const path = u.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { ...CORS, 'Access-Control-Max-Age': '86400' });
    res.end();
    return true;
  }

  if (path === '/api/register' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    try {
      const user = await store.createUser(body.username, body.password);
      const { token } = await store.createSession(user.id);
      json(res, 201, { token, username: user.username });
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/login' && req.method === 'POST') {
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    const user = await store.verifyUser(body.username, body.password);
    if (!user) {
      json(res, 401, { error: 'Invalid username or password' });
      return true;
    }
    const { token } = await store.createSession(user.id);
    json(res, 200, { token, username: user.username });
    return true;
  }

  if (path === '/api/logout' && req.method === 'POST') {
    const h = req.headers.authorization;
    if (h && /^Bearer\s+/i.test(h)) {
      const tok = h.replace(/^Bearer\s+/i, '').trim();
      await store.revokeSession(tok);
    }
    json(res, 200, { ok: true });
    return true;
  }

  if (path === '/api/me' && req.method === 'GET') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    const me = await buildMePayload(uid);
    if (!me) {
      json(res, 401, { error: 'Invalid session' });
      return true;
    }
    json(res, 200, me);
    return true;
  }

  if (path === '/api/runs' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    try {
      await store.addRun(uid, body.timeMs, body.deaths, body.source);
      const runs = await store.getRunsForUser(uid);
      const achRows = await store.getAchievementsForUser(uid);
      const unlockedIds = achRows.map((a) => a.achievementId);
      const newAch = computeNewUnlocks(
        runs.map((r) => ({ deaths: r.deaths, timeMs: r.timeMs })),
        unlockedIds
      );
      if (newAch.length) await store.insertUserAchievements(uid, newAch);
      const me = await buildMePayload(uid);
      json(res, 200, {
        ok: true,
        newAchievements: newAch.map((a) => ({ id: a.id, title: a.title, desc: a.desc })),
        stats: me.stats,
      });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/achievement-defs' && req.method === 'GET') {
    json(
      res,
      200,
      ACHIEVEMENT_DEFS.map((d) => ({ id: d.id, title: d.title, desc: d.desc }))
    );
    return true;
  }

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

  if (path === '/api/levels/mine' && req.method === 'GET') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    try {
      const list = await UserLevels.levelsMine(uid);
      json(res, 200, { levels: list });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/levels/save' && req.method === 'POST') {
    const uid = await bearerUserId(req);
    if (!uid) {
      json(res, 401, { error: 'Not logged in' });
      return true;
    }
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return true;
    }
    try {
      if (body.id && uuidRe.test(String(body.id))) {
        await UserLevels.levelsUpdateDraft(uid, String(body.id), body.title, body.data);
        json(res, 200, { id: String(body.id) });
      } else {
        const out = await UserLevels.levelsCreate(uid, body.title, body.data);
        json(res, 201, out);
      }
    } catch (e) {
      json(res, 400, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/levels\/([^/]+)\/beat$/.exec(path);
    if (m && req.method === 'POST') {
      const uid = await bearerUserId(req);
      if (!uid) {
        json(res, 401, { error: 'Not logged in' });
        return true;
      }
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      try {
        await UserLevels.levelsMarkBeaten(uid, m[1]);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  {
    const m = /^\/api\/levels\/([^/]+)\/publish$/.exec(path);
    if (m && req.method === 'POST') {
      const uid = await bearerUserId(req);
      if (!uid) {
        json(res, 401, { error: 'Not logged in' });
        return true;
      }
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      try {
        await UserLevels.levelsPublish(uid, m[1]);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 400, { error: String(e.message || e) });
      }
      return true;
    }
  }

  {
    const m = /^\/api\/levels\/([^/]+)\/play$/.exec(path);
    if (m && req.method === 'POST') {
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      try {
        await UserLevels.levelsRecordPlay(m[1]);
        json(res, 200, { ok: true });
      } catch (e) {
        json(res, 500, { error: String(e.message || e) });
      }
      return true;
    }
  }

  if (path === '/api/levels/search' && req.method === 'GET') {
    const q = u.searchParams.get('q') || '';
    const page = Number(u.searchParams.get('page') || '1') || 1;
    try {
      const out = await UserLevels.levelsSearchName(q, page);
      json(res, 200, out);
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  if (path === '/api/levels/lookup' && req.method === 'GET') {
    const id = (u.searchParams.get('id') || '').trim();
    try {
      const item = await UserLevels.levelsPublishedMetaById(id);
      json(res, 200, { item });
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  {
    const m = /^\/api\/levels\/([^/]+)$/.exec(path);
    if (m && req.method === 'GET') {
      if (!uuidRe.test(m[1])) {
        json(res, 400, { error: 'Invalid id' });
        return true;
      }
      const uid = (await bearerUserId(req)) || null;
      const row = await UserLevels.levelsGetById(m[1], uid);
      if (!row) {
        json(res, 404, { error: 'Not found' });
        return true;
      }
      json(res, 200, row);
      return true;
    }
  }

  if (path.startsWith('/api/levels/user/') && req.method === 'GET') {
    const rest = path.slice('/api/levels/user/'.length);
    const username = decodeURIComponent((rest.split('?')[0] || '').trim().toLowerCase());
    const page = Number(u.searchParams.get('page') || '1') || 1;
    if (!username) {
      json(res, 400, { error: 'Username required' });
      return true;
    }
    try {
      const out = await UserLevels.levelsListByUsername(username, page);
      json(res, 200, out);
    } catch (e) {
      json(res, 500, { error: String(e.message || e) });
    }
    return true;
  }

  return false;
}
