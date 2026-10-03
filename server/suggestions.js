/** Player suggestions and the Account language choice. Stored as site content, so no new SQL. */

const SUGGEST_KEY = 'suggestions';
const LOCALE_KEY = 'locales';
const LOCALES = new Set(['en', 'es', 'fr', 'de', 'pt', 'zh', 'ja', 'ko']);
const MAX_PENDING = 3;

let chain = Promise.resolve();

function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

async function readBag(store, key, fallback) {
  if (typeof store.getSiteContentPayload !== 'function') return fallback;
  const row = await store.getSiteContentPayload(key);
  return row && typeof row === 'object' ? row : fallback;
}

async function writeBag(store, key, payload) {
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('Storage is not configured.');
  await store.setSiteContentPayload(key, payload);
}

export function normalizeLocale(code) {
  const c = String(code || '').trim().toLowerCase();
  return LOCALES.has(c) ? c : null;
}

export async function getLocale(store, userId) {
  const bag = await readBag(store, LOCALE_KEY, { users: {} });
  const users = bag.users && typeof bag.users === 'object' ? bag.users : {};
  return normalizeLocale(users[String(userId)]) || null;
}

export async function setLocale(store, userId, code) {
  const locale = normalizeLocale(code);
  if (!locale) throw new Error('Pick a language from the list.');
  return locked(async () => {
    const bag = await readBag(store, LOCALE_KEY, { users: {} });
    const users = bag.users && typeof bag.users === 'object' ? { ...bag.users } : {};
    users[String(userId)] = locale;
    await writeBag(store, LOCALE_KEY, { users });
    return { locale };
  });
}

function itemsOf(bag) {
  return Array.isArray(bag.items) ? bag.items : [];
}

function trimItems(items) {
  if (items.length <= 400) return items;
  const pending = items.filter((s) => s.status === 'pending');
  const rest = items.filter((s) => s.status !== 'pending').sort((a, b) => (b.actedAt || b.createdAt) - (a.actedAt || a.createdAt));
  return pending.concat(rest.slice(0, Math.max(0, 400 - pending.length)));
}

export function canModerateSuggestions(role) {
  return role === 'moderator' || role === 'admin' || role === 'mod_admin';
}

export async function submitSuggestion(store, user, text) {
  const body = String(text || '').trim();
  if (body.length < 3) throw new Error('Write at least 3 characters.');
  if (body.length > 2000) throw new Error('That suggestion is too long.');
  return locked(async () => {
    const bag = await readBag(store, SUGGEST_KEY, { items: [] });
    const items = itemsOf(bag);
    const mine = items.filter((s) => s.status === 'pending' && String(s.userId) === String(user.id));
    if (mine.length >= MAX_PENDING) throw new Error('You already have 3 suggestions waiting for a moderator.');
    const row = {
      id: crypto.randomUUID(),
      userId: String(user.id),
      username: String(user.username || ''),
      text: body,
      status: 'pending',
      createdAt: Date.now(),
      modId: null,
      modName: null,
      actedAt: null,
    };
    items.push(row);
    await writeBag(store, SUGGEST_KEY, { items: trimItems(items) });
    return { id: row.id };
  });
}

export async function listPendingSuggestions(store) {
  const bag = await readBag(store, SUGGEST_KEY, { items: [] });
  return itemsOf(bag)
    .filter((s) => s.status === 'pending')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 100)
    .map(publicPending);
}

export async function countPendingSuggestions(store) {
  const bag = await readBag(store, SUGGEST_KEY, { items: [] });
  return itemsOf(bag).filter((s) => s.status === 'pending').length;
}

function publicPending(s) {
  return {
    id: s.id,
    username: s.username,
    text: s.text,
    createdAt: s.createdAt,
  };
}

export async function actOnSuggestion(store, mod, id, action) {
  if (action !== 'dismiss' && action !== 'send') throw new Error('Dismiss it or send it to the owner.');
  return locked(async () => {
    const bag = await readBag(store, SUGGEST_KEY, { items: [] });
    const items = itemsOf(bag);
    const row = items.find((s) => s.id === id);
    if (!row || row.status !== 'pending') throw new Error('That suggestion is no longer waiting.');
    row.status = action === 'send' ? 'sent' : 'dismissed';
    row.modId = String(mod.id);
    row.modName = String(mod.username || '');
    row.actedAt = Date.now();
    await writeBag(store, SUGGEST_KEY, { items });
    return { ok: true };
  });
}

export async function listSentSuggestions(store) {
  const bag = await readBag(store, SUGGEST_KEY, { items: [] });
  return itemsOf(bag)
    .filter((s) => s.status === 'sent')
    .sort((a, b) => (b.actedAt || 0) - (a.actedAt || 0))
    .slice(0, 100)
    .map((s) => ({
      id: s.id,
      username: s.username,
      text: s.text,
      createdAt: s.createdAt,
      modName: s.modName || '',
      sentAt: s.actedAt,
    }));
}
