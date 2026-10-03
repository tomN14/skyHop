/**
 * Sky Hop companies, stock market, national bank, weekly tax, and bank heists.
 * State lives in site content so both the file store and Supabase share it.
 */
import crypto from 'crypto';
import { durationKeyToBanUntil, effectiveRole } from './moderation.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const REGISTER_COST = 1000;
const OVERHEAD = 100;
const TAX_RATE = 0.08;
const NATIONAL_LOAN = 0.1432;
const NATIONAL_SAVE = 0.012;
const BANKRUPT_AT = -500;
const SHARE_COUNT = 1000;
const HEIST_PRIVATE = 0.0004;
const HEIST_NATIONAL = 0.00016;
const HEIST_DRAIN = 0.25;
const FDIC = 0.75;
const KEY = 'economy';

let chain = Promise.resolve();

function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

function emptyState() {
  return {
    weekId: null,
    priceDay: null,
    indexChange: 0,
    national: { taxPool: 0, vault: 0, deposits: {}, weekIn: 0, weekOut: 0 },
    companies: [],
    loans: [],
    marks: {},
    credit: {},
  };
}

function uid(id) {
  return String(id);
}

function coinsOf(user) {
  return Math.max(0, Math.floor(Number(user && user.coins) || 0));
}

function isOwnerUser(user) {
  return effectiveRole(user) === 'owner';
}

async function holders(store) {
  if (typeof store.listCoinHolders !== 'function') return [];
  return store.listCoinHolders();
}

function nameOf(list, id) {
  const row = list.find((u) => uid(u.id) === uid(id));
  return row ? row.username : 'player';
}

async function loadState(store) {
  if (typeof store.getSiteContentPayload !== 'function') return emptyState();
  const row = await store.getSiteContentPayload(KEY);
  if (!row || typeof row !== 'object') return emptyState();
  const state = emptyState();
  state.weekId = row.weekId == null ? null : Number(row.weekId);
  state.priceDay = row.priceDay == null ? null : Number(row.priceDay);
  state.indexChange = Number(row.indexChange) || 0;
  state.national = {
    taxPool: Math.max(0, Math.floor(Number(row.national && row.national.taxPool) || 0)),
    vault: Math.max(0, Math.floor(Number(row.national && row.national.vault) || 0)),
    deposits: (row.national && row.national.deposits) || {},
    weekIn: Math.max(0, Math.floor(Number(row.national && row.national.weekIn) || 0)),
    weekOut: Math.max(0, Math.floor(Number(row.national && row.national.weekOut) || 0)),
  };
  state.companies = Array.isArray(row.companies) ? row.companies : [];
  state.loans = Array.isArray(row.loans) ? row.loans : [];
  state.marks = row.marks && typeof row.marks === 'object' ? row.marks : {};
  state.credit = row.credit && typeof row.credit === 'object' ? row.credit : {};
  return state;
}

async function saveState(store, state) {
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('Economy storage is not configured.');
  await store.setSiteContentPayload(KEY, state);
}

async function chargeWallet(store, user, amount) {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0) return;
  if (isOwnerUser(user)) return;
  const prev = coinsOf(user);
  if (prev < n) throw new Error('Not enough coins.');
  await store.incrementUserCoins(user.id, -n);
  user.coins = prev - n;
}

async function payWallet(store, userId, amount) {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0) return;
  const user = await store.findUserById(userId);
  if (!user || isOwnerUser(user)) return;
  await store.incrementUserCoins(userId, n);
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PRICE_MS = 6 * 60 * 60 * 1000;
let indexCache = { at: 0, map: {} };

function hashStr(s) {
  let h = 2166136261;
  const text = String(s || '');
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unitNoise(seed, day) {
  const x = Math.sin(Number(seed) * 12.9898 + Number(day) * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function seededMarket(day) {
  return (unitNoise(9001, day) - 0.5) * 0.04;
}

async function indexReturns() {
  if (indexCache.at && Date.now() - indexCache.at < 15 * 60 * 1000) return indexCache.map;
  try {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=3mo', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error('index');
    const data = await res.json();
    const result = ((data.chart || {}).result || [])[0] || {};
    const ts = result.timestamp || [];
    const closes = ((result.indicators || {}).quote || [])[0]?.close || [];
    const map = {};
    for (let i = 1; i < closes.length; i += 1) {
      const prev = closes[i - 1];
      const last = closes[i];
      if (!(prev > 0) || !(last > 0)) continue;
      const day = Math.floor((Number(ts[i]) * 1000) / DAY_MS);
      map[day] = Math.max(-0.08, Math.min(0.08, (last - prev) / prev));
    }
    indexCache = { at: Date.now(), map };
    return map;
  } catch {
    return indexCache.map || {};
  }
}

const NATIONAL_SHARES = 7_000_000_000;
const NATIONAL_LISTED = 2_000_000_000;
const NATIONAL_OPEN = 135.52;

function addTax(state, n) {
  const x = Math.max(0, Math.floor(Number(n) || 0));
  if (x <= 0) return;
  state.national.taxPool += x;
  state.national.weekIn = Math.max(0, Math.floor(Number(state.national.weekIn) || 0)) + x;
}

function ensureNationalStock(state) {
  let c = state.companies.find((row) => row && row.sovereign);
  if (c) return c;
  c = {
    id: 'national-bank',
    name: 'Sky Hop National Bank',
    ticker: 'SHNB',
    kind: 'bank',
    sovereign: true,
    ownerId: 'national',
    ownerName: 'Sky Hop',
    cash: 0,
    isPublic: true,
    shareExact: NATIONAL_OPEN,
    sharePrice: Math.round(NATIONAL_OPEN),
    listed: NATIONAL_LISTED,
    shareCount: NATIONAL_SHARES,
    shares: { national: NATIONAL_SHARES },
    alive: true,
    weekProfit: 0,
    performance: 0,
    interestRate: NATIONAL_SAVE,
    loanRate: NATIONAL_LOAN,
    premium: 0,
    coverage: 0,
    deposits: {},
    policies: {},
    tournaments: [],
    tournament: null,
    beta: 0,
    noiseSeed: 0,
    history: [],
  };
  ensureMarket(c);
  pushHistory(c, Date.now(), c.shareExact);
  state.companies.push(c);
  return c;
}

function ensureMarket(c) {
  if (!c.noiseSeed) c.noiseSeed = hashStr(c.id || c.name || 'co');
  if (!(Number(c.beta) > 0)) {
    const u = (c.noiseSeed % 10000) / 10000;
    c.beta = Math.round((0.4 + u * 1.3) * 100) / 100;
  }
  if (!Array.isArray(c.history)) c.history = [];
}

function pushHistory(c, t, p) {
  ensureMarket(c);
  const n = Math.max(0, Math.round(Number(p) * 100) / 100);
  c.history.push({ t: Math.floor(Number(t) || Date.now()), p: n });
  if (c.history.length > 3700) c.history.splice(0, c.history.length - 3700);
}

async function settlePrices(store, state) {
  ensureNationalStock(state);
  const target = Math.floor(Date.now() / PRICE_MS);
  if (state.priceDay == null) {
    state.priceDay = target;
    for (const c of state.companies) {
      if (!c.alive) continue;
      ensureMarket(c);
      if (!c.history.length) pushHistory(c, Date.now(), c.sharePrice || 0);
    }
    return;
  }
  if (target - state.priceDay > 400) state.priceDay = target;
  if (state.priceDay >= target) return;
  const returns = await indexReturns();
  let steps = 0;
  while (state.priceDay < target && steps < 32) {
    const slot = state.priceDay + 1;
    const day = Math.floor((slot * PRICE_MS) / DAY_MS);
    const full = returns[day] != null ? returns[day] : seededMarket(day);
    const market = full / 4;
    state.indexChange = Math.round(market * 10000) / 10000;
    for (const c of state.companies) {
      if (!c.alive || !c.isPublic) continue;
      ensureMarket(c);
      const noise = (unitNoise(c.noiseSeed, slot) - 0.5) * 0.01;
      const perf = Math.max(-1, Math.min(1, Number(c.performance) || 0));
      const change = Math.max(-0.04, Math.min(0.04, c.beta * market + noise + perf * 0.003));
      const base = Number.isFinite(Number(c.shareExact)) ? Number(c.shareExact) : Math.max(0, Number(c.sharePrice) || 0);
      c.shareExact = Math.max(0, Math.min(1_000_000, Math.round(base * (1 + change) * 100) / 100));
      c.sharePrice = Math.max(0, Math.min(1_000_000, Math.round(c.shareExact)));
      pushHistory(c, slot * PRICE_MS, c.shareExact);
      await fillResting(store, state, c);
    }
    state.priceDay = slot;
    steps += 1;
  }
}

function tournamentsOf(c) {
  if (!Array.isArray(c.tournaments)) c.tournaments = [];
  if (c.tournament && typeof c.tournament === 'object') {
    c.tournaments.push({
      id: c.tournament.id || crypto.randomUUID(),
      fee: c.tournament.fee,
      prize: c.tournament.prize,
      description: String(c.tournament.description || ''),
      entrants: Array.isArray(c.tournament.entrants) ? c.tournament.entrants : [],
    });
    c.tournament = null;
  }
  return c.tournaments;
}

function publicTournament(t, me, ownerView) {
  const entrants = Array.isArray(t.entrants) ? t.entrants : [];
  return {
    id: t.id,
    fee: Math.max(0, Math.floor(Number(t.fee) || 0)),
    prize: Math.max(0, Math.floor(Number(t.prize) || 0)),
    description: String(t.description || ''),
    entrants: entrants.length,
    youEntered: entrants.some((e) => uid(e.userId) === me),
    names: ownerView ? entrants.map((e) => e.username) : undefined,
    startsAt: t.startsAt || null,
    started: !!(t.startsAt && Date.now() >= Number(t.startsAt)),
  };
}

function findTournament(c, tournamentId) {
  const list = tournamentsOf(c);
  const want = String(tournamentId || '');
  if (want) return list.find((t) => t.id === want) || null;
  return list.length === 1 ? list[0] : null;
}

function companyById(state, id) {
  return state.companies.find((c) => c.id === id && c.alive) || null;
}

function myCompanies(state, userId) {
  return state.companies.filter((c) => c.alive && uid(c.ownerId) === uid(userId));
}

function ownedCompany(state, userId, companyId) {
  const list = myCompanies(state, userId);
  if (companyId) return list.find((c) => c.id === String(companyId)) || null;
  return list.length === 1 ? list[0] : null;
}

function sharesOf(company, userId) {
  return Math.max(0, Math.floor(Number(company.shares[uid(userId)]) || 0));
}

function shortOf(company, userId) {
  return Math.max(0, Math.floor(Number((company.shorts || {})[uid(userId)]) || 0));
}

function portfolio(state, userId) {
  let n = 0;
  for (const c of state.companies) {
    if (!c.alive) continue;
    const px = Number.isFinite(Number(c.shareExact)) ? Number(c.shareExact) : Math.max(0, Number(c.sharePrice) || 0);
    n += sharesOf(c, userId) * px;
    n -= shortOf(c, userId) * px;
  }
  return n;
}

function sumMap(map) {
  let n = 0;
  for (const k of Object.keys(map || {})) n += Math.max(0, Math.floor(Number(map[k]) || 0));
  return n;
}

function touchCredit(state, id) {
  if (!state.credit || typeof state.credit !== 'object') state.credit = {};
  const key = uid(id);
  if (!state.credit[key]) {
    state.credit[key] = { openedWeek: state.weekId, onTime: 0, late: 0, paidOff: 0, opens: [] };
  }
  const file = state.credit[key];
  if (file.openedWeek == null) file.openedWeek = state.weekId;
  if (!Array.isArray(file.opens)) file.opens = [];
  return file;
}

function userAssets(state, user) {
  const me = uid(user.id);
  let assets = coinsOf(user);
  assets += Math.floor(Number((state.national.deposits || {})[me]) || 0);
  for (const c of state.companies) {
    if (!c.alive || c.sovereign || c.kind !== 'bank') continue;
    assets += Math.floor(Number((c.deposits || {})[me]) || 0);
  }
  return assets;
}

function userDebt(state, userId) {
  const me = uid(userId);
  let debt = 0;
  for (const loan of state.loans) {
    if (loan.borrowerType === 'user' && uid(loan.borrowerId) === me) debt += Math.floor(Number(loan.principal) || 0);
    if (loan.borrowerType === 'company') {
      const firm = state.companies.find((c) => c.alive && c.id === loan.borrowerId && uid(c.ownerId) === me);
      if (firm) debt += Math.floor((Number(loan.principal) || 0) * 0.5);
    }
  }
  return debt;
}

function scoreBand(score) {
  if (score == null) return 'Unscored';
  if (score >= 790) return 'Prime';
  if (score >= 720) return 'Strong';
  if (score >= 640) return 'Steady';
  if (score >= 550) return 'Uneven';
  return 'Thin';
}

function skyScore(state, user) {
  const me = uid(user.id);
  const file = state.credit && state.credit[me];
  const assets = userAssets(state, user);
  const debt = userDebt(state, user.id);
  if (!file) return { score: null, band: 'Unscored', assets, debt };
  const events = Math.max(0, Math.floor(file.onTime) || 0) + Math.max(0, Math.floor(file.late) || 0);
  const pay = events === 0 ? 0.62 : (Math.floor(file.onTime) || 0) / events;
  const load = debt <= 0 ? 0.12 : Math.min(1.5, debt / Math.max(80, assets));
  const ageWeeks = Math.max(0, (state.weekId || 0) - (Number(file.openedWeek) || state.weekId || 0));
  const age = Math.min(1, ageWeeks / 20);
  const recent = (file.opens || []).filter((w) => (state.weekId || 0) - Number(w) <= 2).length;
  const recentHit = Math.min(1, recent / 3);
  const saves = assets > coinsOf(user);
  const borrows = debt > 0 || (Math.floor(file.paidOff) || 0) > 0;
  const mix = (saves ? 0.45 : 0) + (borrows ? 0.55 : 0);
  const raw = 280 + pay * 230 + (1 - Math.min(1, load)) * 160 + age * 90 + (1 - recentHit) * 50 + mix * 40;
  const score = Math.max(300, Math.min(850, Math.round(raw)));
  return { score, band: scoreBand(score), assets, debt };
}

function loanSpread(score) {
  if (score == null) return { mult: 1.12, room: 1.5, floor: 250, refuse: false };
  if (score < 500) return { mult: 1, room: 0, floor: 0, refuse: true };
  if (score >= 790) return { mult: 0.88, room: 5, floor: 0, refuse: false };
  if (score >= 720) return { mult: 0.95, room: 3, floor: 0, refuse: false };
  if (score >= 640) return { mult: 1, room: 1.5, floor: 0, refuse: false };
  if (score >= 550) return { mult: 1.28, room: 0.8, floor: 0, refuse: false };
  return { mult: 1.65, room: 0.4, floor: 0, refuse: false };
}

async function applyWeek(store, state) {
  const people = await holders(store);
  const before = {};
  for (const p of people) before[uid(p.id)] = portfolio(state, p.id);

  for (const p of people) {
    if (effectiveRole(p) === 'owner') continue;
    const tax = Math.floor(coinsOf(p) * TAX_RATE);
    if (tax > 0) {
      await store.incrementUserCoins(p.id, -tax);
      addTax(state, tax);
    }
  }

  for (const c of state.companies) {
    if (!c.alive || c.sovereign) continue;
    const scale = Math.max(250, Math.abs(Math.floor(Number(c.cash) || 0)) + OVERHEAD);
    c.performance = Math.max(-1, Math.min(1, Math.round(((Number(c.weekProfit) || 0) / scale) * 1000) / 1000));
    const profit = Math.floor(Number(c.weekProfit) || 0);
    if (c.isPublic && profit > 1) {
      const pot = Math.min(Math.floor(Math.max(0, c.cash) * 0.02), profit - 1);
      if (pot > 0) await payDividend(store, state, c, pot);
    }
    c.weekProfit = 0;
    c.weekProfit -= OVERHEAD;
    c.cash = Math.max(0, Math.floor(Number(c.cash) || 0) - Math.min(OVERHEAD, Math.max(0, Math.floor(Number(c.cash) || 0))));
    const tax = Math.floor(Math.max(0, c.cash) * TAX_RATE);
    if (tax > 0) {
      c.cash -= tax;
      c.weekProfit -= tax;
      addTax(state, tax);
    }
  }

  const nat = ensureNationalStock(state);
  const inn = Math.max(0, Math.floor(Number(state.national.weekIn) || 0));
  const out = Math.max(0, Math.floor(Number(state.national.weekOut) || 0));
  nat.performance = Math.max(-1, Math.min(1, Math.round(((inn - out) / Math.max(5000, state.national.taxPool)) * 1000) / 1000));
  const net = inn - out;
  if (net > 1) {
    const pot = Math.min(Math.floor(state.national.taxPool * 0.01), net - 1);
    if (pot > 0) await payDividend(store, state, nat, pot);
  }
  state.national.weekIn = 0;
  state.national.weekOut = 0;

  const due = {};
  for (const loan of state.loans) {
    const principal = Math.max(0, Math.floor(Number(loan.principal) || 0));
    const rate = Number(loan.rate) || 0;
    const interest = Math.floor(principal * rate);
    loan.principal = principal + interest;
    if (loan.lender === 'national') {
      /* The national bank creates the interest. It does not go bankrupt. */
    } else {
      const bank = companyById(state, loan.lender);
      if (bank) bank.weekProfit += interest;
    }
    if (loan.borrowerType === 'company') {
      const firm = companyById(state, loan.borrowerId);
      if (firm) firm.weekProfit -= interest;
    }
    const who = loan.borrowerType === 'company'
      ? (companyById(state, loan.borrowerId) || {}).ownerId
      : loan.borrowerId;
    if (who && who !== 'national') {
      const key = uid(who);
      if (!due[key]) due[key] = { interest: 0, paid: 0 };
      due[key].interest += interest;
      due[key].paid += Math.max(0, Math.floor(Number(loan.paidWeek) || 0));
    }
    loan.paidWeek = 0;
  }

  for (const c of state.companies) {
    if (!c.alive || c.sovereign || c.kind !== 'bank') continue;
    const rate = Number(c.interestRate) || 0;
    for (const id of Object.keys(c.deposits || {})) {
      const bal = Math.floor(Number(c.deposits[id]) || 0);
      const interest = Math.floor(bal * rate);
      if (interest > 0) {
        c.deposits[id] = bal + interest;
        c.weekProfit -= interest;
      }
    }
  }
  for (const id of Object.keys(state.national.deposits)) {
    const bal = Math.floor(Number(state.national.deposits[id]) || 0);
    const interest = Math.floor(bal * NATIONAL_SAVE);
    if (interest > 0) state.national.deposits[id] = bal + interest;
  }

  for (const key of Object.keys(due)) {
    const row = due[key];
    const file = touchCredit(state, key);
    if (row.paid >= row.interest) file.onTime += 1;
    else file.late += 1;
  }
  const indebted = new Set(Object.keys(due));
  const savers = new Set(Object.keys(state.national.deposits || {}));
  for (const c of state.companies) {
    if (!c.alive || c.sovereign || c.kind !== 'bank') continue;
    for (const id of Object.keys(c.deposits || {})) {
      if (Math.floor(Number(c.deposits[id]) || 0) > 0) savers.add(uid(id));
    }
  }
  for (const id of savers) {
    if (indebted.has(uid(id))) continue;
    if (Math.floor(Number(state.national.deposits[id]) || 0) <= 0) {
      const holds = state.companies.some((c) => c.alive && !c.sovereign && c.kind === 'bank' && Math.floor(Number((c.deposits || {})[id]) || 0) > 0);
      if (!holds) continue;
    }
    touchCredit(state, id).onTime += 1;
  }

  for (const c of state.companies) {
    if (!c.alive || c.kind !== 'insurance') continue;
    const premium = Math.max(0, Math.floor(Number(c.premium) || 0));
    const coverage = Math.max(0, Math.floor(Number(c.coverage) || 0));
    for (const id of Object.keys(c.policies || {})) {
      const holder = await store.findUserById(id);
      if (!holder || isOwnerUser(holder)) continue;
      if (coinsOf(holder) < premium) {
        delete c.policies[id];
        continue;
      }
      await chargeWallet(store, holder, premium);
      c.cash += premium;
      c.weekProfit += premium;
      const old = state.marks[uid(id)] != null ? Number(state.marks[uid(id)]) : before[uid(id)] || 0;
      const loss = Math.max(0, old - portfolio(state, id));
      const payout = Math.min(coverage, loss, c.cash);
      if (payout > 0) {
        c.cash -= payout;
        c.weekProfit -= payout;
        await payWallet(store, id, payout);
      }
    }
  }

  for (const p of people) state.marks[uid(p.id)] = portfolio(state, p.id);

  for (const c of state.companies) {
    if (!c.alive || c.sovereign) continue;
    if (c.weekProfit < BANKRUPT_AT) {
      addTax(state, Math.max(0, Math.floor(Number(c.cash) || 0)));
      c.cash = 0;
      c.shares = {};
      c.listed = 0;
      c.sharePrice = 0;
      c.shorts = {};
      c.shortBill = {};
      c.orders = [];
      c.deposits = {};
      c.policies = {};
      c.tournaments = [];
      c.tournament = null;
      c.alive = false;
      state.loans = state.loans.filter((loan) => loan.lender !== c.id && !(loan.borrowerType === 'company' && loan.borrowerId === c.id));
    }
  }
}

async function settle(store, state) {
  await settlePrices(store, state);
  const target = Math.floor(Date.now() / WEEK_MS);
  if (state.weekId == null) state.weekId = target;
  let steps = 0;
  while (state.weekId < target && steps < 4) {
    await applyWeek(store, state);
    state.weekId += 1;
    steps += 1;
  }
}

async function withState(store, fn) {
  return locked(async () => {
    const state = await loadState(store);
    await settle(store, state);
    const out = await fn(state);
    await saveState(store, state);
    return out;
  });
}

function present(state, user, people) {
  const me = uid(user.id);
  const mine = myCompanies(state, user.id);
  const ownedIds = new Set(mine.map((c) => c.id));
    const book = skyScore(state, user);
    const natStock = ensureNationalStock(state);
    return {
    coins: coinsOf(user),
    coinsInfinite: isOwnerUser(user),
    credit: book,
    rules: {
      registerCost: REGISTER_COST,
      overhead: OVERHEAD,
      taxRate: TAX_RATE,
      nationalLoan: NATIONAL_LOAN,
      nationalSave: NATIONAL_SAVE,
      bankruptAt: BANKRUPT_AT,
      shares: SHARE_COUNT,
      heistPrivate: HEIST_PRIVATE,
      heistNational: HEIST_NATIONAL,
      heistDrain: HEIST_DRAIN,
      fdic: FDIC,
    },
    indexChange: state.indexChange,
    national: {
      taxPool: state.national.taxPool,
      yourDeposit: Math.floor(Number(state.national.deposits[me]) || 0),
      savingsRate: NATIONAL_SAVE,
      loanRate: NATIONAL_LOAN,
      stock: {
        id: natStock.id,
        ticker: natStock.ticker,
        shareExact: natStock.shareExact,
        listed: natStock.listed,
        shareCount: natStock.shareCount,
      },
    },
    yourCompanies: mine.map((c) => detailCompany(c, user, people, true)),
    companies: state.companies.filter((c) => c.alive).map((c) => detailCompany(c, user, people, uid(c.ownerId) === me)),
    loans: state.loans
      .filter((loan) => uid(loan.borrowerId) === me || (loan.borrowerType === 'company' && ownedIds.has(loan.borrowerId)))
      .map((loan) => ({
        id: loan.id,
        lender: loan.lender === 'national' ? 'Sky Hop National Bank' : (companyById(state, loan.lender) || {}).name || 'Closed bank',
        principal: loan.principal,
        rate: loan.rate,
        borrowerType: loan.borrowerType,
      })),
  };
}

function detailCompany(c, user, people, ownerView) {
  const me = uid(user.id);
  const row = {
    id: c.id,
    name: c.name,
    ticker: c.ticker || '',
    kind: c.kind,
    ownerName: c.ownerName,
    isPublic: !!c.isPublic,
    sharePrice: c.sharePrice,
    shareExact: Math.round((Number.isFinite(Number(c.shareExact)) ? Number(c.shareExact) : Math.max(0, Number(c.sharePrice) || 0)) * 100) / 100,
    listed: c.listed,
    shareCount: c.shareCount || SHARE_COUNT,
    sovereign: !!c.sovereign,
    yourShares: sharesOf(c, user.id),
    ownerShares: sharesOf(c, c.ownerId),
    cash: ownerView ? c.cash : undefined,
    weekProfit: ownerView ? c.weekProfit : undefined,
    interestRate: c.kind === 'bank' ? c.interestRate : undefined,
    loanRate: c.kind === 'bank' ? c.loanRate : undefined,
    premium: c.kind === 'insurance' ? c.premium : undefined,
    coverage: c.kind === 'insurance' ? c.coverage : undefined,
    yourDeposit: c.kind === 'bank' ? Math.floor(Number((c.deposits || {})[me]) || 0) : undefined,
    insured: c.kind === 'insurance' ? !!(c.policies || {})[me] : undefined,
    tournaments: c.kind === 'racing' ? tournamentsOf(c).map((t) => publicTournament(t, me, ownerView)) : [],
  };
  if (ownerView && c.kind === 'bank') {
    row.deposits = Object.keys(c.deposits || {}).map((id) => ({
      username: nameOf(people, id),
      amount: Math.floor(Number(c.deposits[id]) || 0),
    }));
  }
  return row;
}

export async function economyView(store, user) {
  return withState(store, async (state) => present(state, user, await holders(store)));
}

export async function creditSnapshot(store, user) {
  if (!user) return { score: null, band: 'Unscored' };
  const state = await loadState(store);
  const nowWeek = Math.floor(Date.now() / WEEK_MS);
  state.weekId = state.weekId == null ? nowWeek : Math.max(Number(state.weekId) || 0, nowWeek);
  const book = skyScore(state, user);
  return { score: book.score, band: book.band };
}

/** Shop and other sinks. Coins already left a wallet. */
export async function receiveBankCoins(store, amount) {
  const n = Math.floor(Number(amount) || 0);
  if (n <= 0) return;
  return withState(store, async (state) => {
    addTax(state, n);
  });
}

export async function registerCompany(store, user, { name, kind }) {
  const clean = String(name || '').trim().slice(0, 24);
  if (clean.length < 2) throw new Error('Company name must be 2–24 characters.');
  if (!['racing', 'bank', 'insurance'].includes(kind)) throw new Error('Pick a racing, bank, or insurance company.');
  return withState(store, async (state) => {
    if (state.companies.some((c) => c.alive && c.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error('That company name is taken.');
    }
    await chargeWallet(store, user, REGISTER_COST);
    if (!isOwnerUser(user)) addTax(state, REGISTER_COST);
    const opened = Math.round(Math.random() * 100) / 100;
    const company = {
      id: crypto.randomUUID(),
      name: clean,
      kind,
      ownerId: uid(user.id),
      ownerName: user.username,
      cash: 0,
      isPublic: false,
      sharePrice: Math.round(opened),
      shareExact: opened,
      listed: 0,
      shares: { [uid(user.id)]: SHARE_COUNT },
      alive: true,
      weekProfit: 0,
      interestRate: NATIONAL_SAVE,
      loanRate: NATIONAL_LOAN,
      premium: 50,
      coverage: 200,
      deposits: {},
      policies: {},
      tournaments: [],
      tournament: null,
      ticker: '',
      beta: 0,
      noiseSeed: 0,
      history: [],
    };
    ensureMarket(company);
    pushHistory(company, Date.now(), company.shareExact);
    state.companies.push(company);
    return present(state, user, await holders(store));
  });
}

const SEED_LEFT = ['North', 'South', 'Silver', 'Gold', 'Iron', 'Cedar', 'Harbor', 'Summit', 'River', 'Crown', 'Bright', 'Swift', 'Grand', 'Amber', 'Coral', 'Frost', 'Dawn', 'Pine', 'Oak', 'Star', 'Moon', 'Wind', 'Stone', 'Copper', 'Maple', 'Quiet', 'High', 'East', 'West', 'Blue'];
const SEED_RIGHT = ['Peak', 'Line', 'Gate', 'Yard', 'Works', 'House', 'Field', 'Trail', 'Dock', 'Bridge', 'Forge', 'Mill', 'Point', 'Ridge', 'Bay', 'Coast', 'Hill', 'Vale', 'Park', 'Lane', 'Court', 'Hall', 'Square', 'Tower', 'Grove', 'Reach', 'Bend', 'Basin', 'Wharf', 'Club'];
const SEED_KINDS = ['racing', 'bank', 'insurance'];
const TICKER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function freshTicker(used) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const len = 3 + Math.floor(Math.random() * 3);
    let ticker = '';
    for (let i = 0; i < len; i += 1) ticker += TICKER_CHARS[Math.floor(Math.random() * TICKER_CHARS.length)];
    if (!used.has(ticker)) return ticker;
  }
  throw new Error('Could not find a free ticker.');
}

function freshName(used) {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const name = pick(SEED_LEFT) + ' ' + pick(SEED_RIGHT);
    if (!used.has(name.toLowerCase())) return name;
  }
  throw new Error('Could not find a free company name.');
}

/** Owner tool. Creates public companies on that account. Does not charge coins. */
export async function seedRandomCompanies(store, user) {
  return withState(store, async (state) => {
    const tickers = new Set();
    const names = new Set();
    for (const c of state.companies) {
      const ticker = String(c.ticker || '').toUpperCase();
      if (ticker) tickers.add(ticker);
      if (c.alive && c.name) names.add(String(c.name).toLowerCase());
    }
    const made = [];
    for (let i = 0; i < 60; i += 1) {
      const name = freshName(names);
      const ticker = freshTicker(tickers);
      const kind = pick(SEED_KINDS);
      names.add(name.toLowerCase());
      tickers.add(ticker);
      const opened = Math.round(Math.random() * 100) / 100;
      const company = {
        id: crypto.randomUUID(),
        name,
        kind,
        ownerId: uid(user.id),
        ownerName: user.username,
        cash: 0,
        isPublic: true,
        sharePrice: Math.round(opened),
        shareExact: opened,
        listed: 0,
        shares: { [uid(user.id)]: SHARE_COUNT },
        alive: true,
        weekProfit: 0,
        interestRate: kind === 'bank' ? Math.round((0.004 + Math.random() * 0.03) * 10000) / 10000 : NATIONAL_SAVE,
        loanRate: kind === 'bank' ? Math.round((0.06 + Math.random() * 0.2) * 10000) / 10000 : NATIONAL_LOAN,
        premium: kind === 'insurance' ? 10 + Math.floor(Math.random() * 191) : 50,
        coverage: kind === 'insurance' ? 50 + Math.floor(Math.random() * 951) : 200,
        deposits: {},
        policies: {},
        tournaments: [],
        tournament: null,
        ticker,
        beta: 0,
        noiseSeed: 0,
        history: [],
      };
      ensureMarket(company);
      pushHistory(company, Date.now(), company.shareExact);
      state.companies.push(company);
      made.push({ name, ticker, kind });
    }
    return { created: made.length, companies: made };
  });
}

export async function fundCompany(store, user, companyId, amount) {
  const n = clampMoney(amount, 1, 1_000_000_000);
  return withState(store, async (state) => {
    const c = ownedCompany(state, user.id, companyId);
    if (!c) throw new Error('You do not own that company.');
    await chargeWallet(store, user, n);
    c.cash += n;
    return present(state, user, await holders(store));
  });
}

export async function updateCompany(store, user, body) {
  return withState(store, async (state) => {
    const c = ownedCompany(state, user.id, body.companyId);
    if (!c) throw new Error('You do not own that company.');
    if (body.isPublic != null) {
      if (body.isPublic) {
        c.isPublic = true;
        ensureMarket(c);
        if (!(Number.isFinite(Number(c.shareExact)))) c.shareExact = c.sharePrice;
        pushHistory(c, Date.now(), c.shareExact);
      } else if (c.listed > 0) throw new Error('Buy the listed shares back before going private.');
      else c.isPublic = false;
    }
    if (body.ticker != null) {
      const ticker = String(body.ticker || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{1,5}$/.test(ticker)) throw new Error('Ticker must be 1–5 letters or numbers.');
      const taken = state.companies.some((o) => o.alive && o.id !== c.id && String(o.ticker || '').toUpperCase() === ticker);
      if (taken) throw new Error('That ticker is taken.');
      c.ticker = ticker;
    }
    if (body.sharePrice != null) {
      const price = Math.round(Number(body.sharePrice) * 100) / 100;
      if (!Number.isFinite(price) || price < 0 || price > 1_000_000) throw new Error('Share price must be 0–1,000,000.');
      c.sharePrice = Math.round(price);
      c.shareExact = price;
      pushHistory(c, Date.now(), price);
    }
    if (body.listed != null) {
      const listed = Math.floor(Number(body.listed));
      const held = sharesOf(c, user.id);
      if (listed < 0 || listed > held) throw new Error('You can only list shares you still hold.');
      c.listed = listed;
    }
    if (c.kind === 'bank') {
      if (body.interestRate != null) c.interestRate = clampRate(body.interestRate);
      if (body.loanRate != null) c.loanRate = clampRate(body.loanRate);
    }
    if (c.kind === 'insurance') {
      if (body.premium != null) c.premium = clampMoney(body.premium, 0, 1_000_000);
      if (body.coverage != null) c.coverage = clampMoney(body.coverage, 0, 1_000_000);
    }
    if (c.kind === 'racing' && body.openTournament) {
      const list = tournamentsOf(c);
      if (list.length >= 20) throw new Error('A racing company can have 20 open tournaments.');
      const fee = clampMoney(body.fee, 0, 1_000_000);
      const prize = clampMoney(body.prize, 0, 1_000_000);
      const description = String(body.description || '').trim().replace(/\s+/g, ' ').slice(0, 200);
      let startsAt = null;
      if (body.startsAt) {
        const ms = Date.parse(body.startsAt);
        if (!Number.isFinite(ms)) throw new Error('Start date is invalid.');
        startsAt = ms;
      }
      list.push({ id: crypto.randomUUID(), fee, prize, description, startsAt, entrants: [] });
    }
    if (c.kind === 'racing' && body.closeTournament) {
      const id = String(body.tournamentId || '');
      const list = tournamentsOf(c);
      if (!list.some((t) => t.id === id)) throw new Error('That tournament is not open.');
      c.tournaments = list.filter((t) => t.id !== id);
    }
    return present(state, user, await holders(store));
  });
}

function clampRate(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x < 0 || x > 1) throw new Error('Rate must be between 0 and 1.');
  return Math.round(x * 10000) / 10000;
}

function clampMoney(n, min, max) {
  const x = Math.floor(Number(n));
  if (!Number.isFinite(x) || x < min || x > max) throw new Error('Amount is out of range.');
  return x;
}

function unitPrice(c) {
  const unit = Number.isFinite(Number(c.shareExact)) ? Number(c.shareExact) : Number(c.sharePrice) || 0;
  return Math.max(0, unit);
}

function tradeCost(qty, unit) {
  if (!(unit > 0) || !(qty > 0)) return 0;
  return Math.max(1, Math.round(qty * unit));
}

function buybackCash(state, c) {
  const pool = Math.max(0, Math.floor(Number(state.national.taxPool) || 0));
  if (c.sovereign) return pool;
  return Math.max(0, Math.floor(Number(c.cash) || 0)) + pool;
}

function pullBuyback(state, c, amount) {
  let need = Math.max(0, Math.floor(amount));
  if (!c.sovereign) {
    const take = Math.min(need, Math.max(0, Math.floor(Number(c.cash) || 0)));
    c.cash -= take;
    c.weekProfit = Math.floor(Number(c.weekProfit) || 0) - take;
    need -= take;
  }
  const fromPool = Math.min(need, Math.max(0, Math.floor(Number(state.national.taxPool) || 0)));
  if (fromPool > 0) {
    state.national.taxPool -= fromPool;
    state.national.weekOut = Math.max(0, Math.floor(Number(state.national.weekOut) || 0)) + fromPool;
  }
}

function giveCash(state, c, amount) {
  const n = Math.max(0, Math.floor(amount));
  if (n <= 0) return;
  if (c.sovereign) addTax(state, n);
  else {
    c.cash += n;
    c.weekProfit = Math.floor(Number(c.weekProfit) || 0) + n;
  }
}

function marketable(side, unit, limit) {
  if (limit == null) return true;
  if (side === 'buy' || side === 'cover') return unit <= limit + 0.0001;
  return unit + 0.0001 >= limit;
}

async function payDividend(store, state, c, pot) {
  const payout = Math.max(0, Math.floor(Number(pot) || 0));
  if (payout < 1 || !c.shares) return;
  let outstanding = 0;
  for (const id of Object.keys(c.shares)) {
    if (c.sovereign && id === 'national') continue;
    outstanding += sharesOf(c, id);
  }
  if (outstanding < 1) return;
  const cuts = [];
  let spent = 0;
  for (const id of Object.keys(c.shares)) {
    if (c.sovereign && id === 'national') continue;
    const held = sharesOf(c, id);
    const cut = Math.floor((payout * held) / outstanding);
    if (cut < 1) continue;
    cuts.push({ id, cut });
    spent += cut;
  }
  if (c.sovereign) {
    if (spent > state.national.taxPool) return;
    state.national.taxPool -= spent;
    state.national.weekOut = Math.max(0, Math.floor(Number(state.national.weekOut) || 0)) + spent;
  } else if (spent > c.cash) {
    return;
  } else {
    c.cash -= spent;
  }
  for (const row of cuts) await payWallet(store, row.id, row.cut);
  const per = payout / outstanding;
  for (const id of Object.keys(c.shorts || {})) {
    const due = Math.floor(shortOf(c, id) * per);
    if (due < 1) continue;
    const holder = await store.findUserById(id);
    if (!holder) continue;
    try {
      await chargeWallet(store, holder, due);
      giveCash(state, c, due);
    } catch {
      if (!c.shortBill || typeof c.shortBill !== 'object') c.shortBill = {};
      c.shortBill[id] = Math.floor(Number(c.shortBill[id]) || 0) + due;
    }
  }
}

async function executeTrade(store, state, user, c, side, qty) {
  const n = Math.floor(Number(qty));
  const capQty = c.sovereign ? 2_000_000_000 : SHARE_COUNT;
  if (!Number.isFinite(n) || n < 1 || n > capQty) throw new Error('Amount is out of range.');
  if (!c.isPublic) throw new Error('That company is not on the market.');
  const unit = unitPrice(c);
  if (unit <= 0) throw new Error('That stock is worth $0.00.');
  const me = uid(user.id);
  const cost = tradeCost(n, unit);
  if (side === 'buy') {
    if (!c.sovereign && uid(c.ownerId) === me) throw new Error('You already own those shares.');
    if (n > c.listed || n > sharesOf(c, c.ownerId)) throw new Error('Not that many shares are listed.');
    await chargeWallet(store, user, cost);
    giveCash(state, c, cost);
    c.shares[uid(c.ownerId)] = sharesOf(c, c.ownerId) - n;
    c.shares[me] = sharesOf(c, user.id) + n;
    c.listed -= n;
    const total = c.shareCount || SHARE_COUNT;
    if (!c.sovereign && sharesOf(c, user.id) > total / 2 && sharesOf(c, c.ownerId) <= total / 2) {
      c.ownerId = me;
      c.ownerName = user.username;
    }
    return 'Bought ' + n + ' shares.';
  }
  if (side === 'sell') {
    if (!c.sovereign && uid(c.ownerId) === me) throw new Error('List shares for sale from your company instead.');
    if (n > sharesOf(c, user.id)) throw new Error('You do not own that many shares.');
    if (buybackCash(state, c) < cost) throw new Error('The company cannot pay for those shares yet.');
    pullBuyback(state, c, cost);
    await payWallet(store, user.id, cost);
    c.shares[me] = sharesOf(c, user.id) - n;
    c.shares[uid(c.ownerId)] = sharesOf(c, c.ownerId) + n;
    c.listed += n;
    if (c.sovereign) c.listed = Math.min(c.listed, NATIONAL_LISTED);
    return 'Sold ' + n + ' shares.';
  }
  if (side === 'short') {
    if (!c.sovereign && uid(c.ownerId) === me) throw new Error('You cannot short your own company.');
    if (n > c.listed || n > sharesOf(c, c.ownerId)) throw new Error('Not that many shares are available to borrow.');
    const maxShort = c.sovereign ? 5000 : 200;
    if (shortOf(c, user.id) + n > maxShort) throw new Error('You can be short at most ' + maxShort + ' shares.');
    if (buybackCash(state, c) < cost) throw new Error('The company cannot pay for that short yet.');
    pullBuyback(state, c, cost);
    await payWallet(store, user.id, cost);
    c.shares[uid(c.ownerId)] = sharesOf(c, c.ownerId) - n;
    c.listed -= n;
    if (!c.shorts || typeof c.shorts !== 'object') c.shorts = {};
    c.shorts[me] = shortOf(c, user.id) + n;
    return 'Shorted ' + n + ' shares.';
  }
  if (side === 'cover') {
    const open = shortOf(c, user.id);
    if (n > open) throw new Error('You are not short that many shares.');
    const bill = n === open ? Math.floor(Number((c.shortBill || {})[me]) || 0) : 0;
    await chargeWallet(store, user, cost + bill);
    giveCash(state, c, cost + bill);
    if (!c.shorts) c.shorts = {};
    c.shorts[me] = open - n;
    if (c.shorts[me] <= 0) {
      delete c.shorts[me];
      if (c.shortBill) delete c.shortBill[me];
    }
    c.shares[uid(c.ownerId)] = sharesOf(c, c.ownerId) + n;
    c.listed += n;
    if (c.sovereign) c.listed = Math.min(c.listed, NATIONAL_LISTED);
    return 'Covered ' + n + ' shares.';
  }
  throw new Error('Unknown order.');
}

async function fillResting(store, state, c) {
  if (!Array.isArray(c.orders) || !c.orders.length) return;
  const unit = unitPrice(c);
  const keep = [];
  let fills = 0;
  for (const order of c.orders) {
    if (fills >= 4 || !marketable(order.side, unit, Number(order.limit))) {
      keep.push(order);
      continue;
    }
    const holder = await store.findUserById(order.userId);
    if (!holder) continue;
    try {
      await executeTrade(store, state, holder, c, order.side, order.qty);
      fills += 1;
    } catch {
      keep.push(order);
    }
  }
  c.orders = keep.slice(0, 40);
}

export async function buyShares(store, user, companyId, qty) {
  const traded = await tradeShares(store, user, companyId, 'buy', qty, null);
  return traded.view;
}

export async function tradeShares(store, user, companyId, side, qty, limit) {
  const want = String(side || '');
  if (!['buy', 'sell', 'short', 'cover'].includes(want)) throw new Error('Unknown order.');
  let limitPrice = null;
  if (limit != null && limit !== '') {
    limitPrice = Math.round(Number(limit) * 100) / 100;
    if (!Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice > 1_000_000) throw new Error('Limit price must be above 0 and at most 1,000,000.');
  }
  return withState(store, async (state) => {
    ensureNationalStock(state);
    const c = companyById(state, companyId);
    if (!c) throw new Error('That company is not on the market.');
    const n = Math.floor(Number(qty));
    if (!Number.isFinite(n) || n < 1) throw new Error('Amount is out of range.');
    const unit = unitPrice(c);
    if (limitPrice != null && !marketable(want, unit, limitPrice)) {
      if (!Array.isArray(c.orders)) c.orders = [];
      const mine = c.orders.filter((order) => uid(order.userId) === uid(user.id));
      if (mine.length >= 3) throw new Error('You can rest 3 limit orders on this stock.');
      if (c.orders.length >= 40) throw new Error('This stock has too many resting orders.');
      c.orders.push({
        id: crypto.randomUUID(),
        userId: uid(user.id),
        side: want,
        qty: n,
        limit: limitPrice,
      });
      return { view: await present(state, user, await holders(store)), message: 'Limit order is resting until the price reaches it.' };
    }
    const message = await executeTrade(store, state, user, c, want, qty);
    return { view: await present(state, user, await holders(store)), message };
  });
}

export async function cancelOrder(store, user, companyId, orderId) {
  return withState(store, async (state) => {
    const c = companyById(state, companyId);
    if (!c || !Array.isArray(c.orders)) throw new Error('Order not found.');
    const before = c.orders.length;
    c.orders = c.orders.filter((order) => !(order.id === orderId && uid(order.userId) === uid(user.id)));
    if (c.orders.length === before) throw new Error('Order not found.');
    return { view: await present(state, user, await holders(store)), message: 'Limit order cancelled.' };
  });
}

export async function deposit(store, user, bankId, amount) {
  const n = clampMoney(amount, 1, 1_000_000_000);
  return withState(store, async (state) => {
    if (bankId === 'national') {
      await chargeWallet(store, user, n);
      state.national.deposits[uid(user.id)] = Math.floor(Number(state.national.deposits[uid(user.id)]) || 0) + n;
      state.national.vault += n;
    } else {
      const c = companyById(state, bankId);
      if (!c || c.sovereign || c.kind !== 'bank') throw new Error('That bank is not open.');
      await chargeWallet(store, user, n);
      c.deposits[uid(user.id)] = Math.floor(Number((c.deposits || {})[uid(user.id)]) || 0) + n;
      c.cash += n;
    }
    return present(state, user, await holders(store));
  });
}

export async function withdraw(store, user, bankId, amount) {
  const n = clampMoney(amount, 1, 1_000_000_000);
  return withState(store, async (state) => {
    if (bankId === 'national') {
      const bal = Math.floor(Number(state.national.deposits[uid(user.id)]) || 0);
      if (bal < n) throw new Error('Not enough in that account.');
      state.national.deposits[uid(user.id)] = bal - n;
      state.national.vault = Math.max(0, (state.national.vault || 0) - n);
    } else {
      const c = companyById(state, bankId);
      if (!c || c.sovereign || c.kind !== 'bank') throw new Error('That bank is not open.');
      const bal = Math.floor(Number((c.deposits || {})[uid(user.id)]) || 0);
      if (bal < n || c.cash < n) throw new Error('That bank cannot cover this withdrawal.');
      c.deposits[uid(user.id)] = bal - n;
      c.cash -= n;
    }
    const prev = coinsOf(user);
    await payWallet(store, user.id, n);
    if (!isOwnerUser(user)) user.coins = prev + n;
    return present(state, user, await holders(store));
  });
}

export async function borrow(store, user, { lender, amount, forCompany, companyId }) {
  const n = clampMoney(amount, 1, 1_000_000_000);
  return withState(store, async (state) => {
    const firm = forCompany ? ownedCompany(state, user.id, companyId) : null;
    if (forCompany && !firm) throw new Error('Pick one of your companies.');
    let rate = NATIONAL_LOAN;
    if (lender === 'national') {
      /* Too big to fail: the loan is created even when the tax pool is empty. */
    } else {
      const bank = companyById(state, lender);
      if (!bank || bank.sovereign || bank.kind !== 'bank') throw new Error('That bank is not open.');
      if (bank.cash < n) throw new Error('That bank does not have the cash.');
      bank.cash -= n;
      rate = Number(bank.loanRate) || NATIONAL_LOAN;
    }
    if (!isOwnerUser(user)) {
      const book = skyScore(state, user);
      const spread = loanSpread(book.score);
      if (spread.refuse) throw new Error('Your Sky Hop score is too low for a new loan.');
      const room = Math.max(spread.floor, Math.floor(book.assets * spread.room) - book.debt);
      if (n > Math.max(0, room)) throw new Error('That loan is too large for your Sky Hop score.');
      rate = Math.min(0.75, Math.round(rate * spread.mult * 10000) / 10000);
    }
    if (firm) {
      firm.cash += n;
      firm.weekProfit += n;
    } else {
      await payWallet(store, user.id, n);
    }
    state.loans.push({
      id: crypto.randomUUID(),
      lender,
      borrowerType: firm ? 'company' : 'user',
      borrowerId: firm ? firm.id : uid(user.id),
      principal: n,
      rate,
      paidWeek: 0,
    });
    const borrower = firm ? firm.ownerId : user.id;
    const file = touchCredit(state, borrower);
    file.opens = file.opens.concat(state.weekId == null ? 0 : state.weekId).slice(-6);
    return present(state, user, await holders(store));
  });
}

export async function repay(store, user, loanId, amount) {
  const n = clampMoney(amount, 1, 1_000_000_000);
  return withState(store, async (state) => {
    const loan = state.loans.find((row) => row.id === loanId);
    if (!loan) throw new Error('Loan not found.');
    const firm = loan.borrowerType === 'company' ? ownedCompany(state, user.id, loan.borrowerId) : null;
    const mine =
      (loan.borrowerType === 'user' && uid(loan.borrowerId) === uid(user.id)) ||
      (loan.borrowerType === 'company' && firm);
    if (!mine) throw new Error('That loan is not yours.');
    const pay = Math.min(n, loan.principal);
    if (loan.borrowerType === 'company') {
      if (firm.cash < pay) throw new Error('The company does not have that cash.');
      firm.cash -= pay;
    } else {
      await chargeWallet(store, user, pay);
    }
    if (loan.lender === 'national') addTax(state, pay);
    else {
      const bank = companyById(state, loan.lender);
      if (bank) {
        bank.cash += pay;
        bank.weekProfit += pay;
      } else state.national.taxPool += pay;
    }
    loan.principal -= pay;
    loan.paidWeek = Math.max(0, Math.floor(Number(loan.paidWeek) || 0)) + pay;
    if (loan.principal <= 0) {
      const who = loan.borrowerType === 'company' ? (firm || {}).ownerId : loan.borrowerId;
      if (who) touchCredit(state, who).paidOff += 1;
      state.loans = state.loans.filter((row) => row.id !== loan.id);
    }
    return present(state, user, await holders(store));
  });
}

export async function buyPolicy(store, user, companyId) {
  return withState(store, async (state) => {
    const c = companyById(state, companyId);
    if (!c || c.kind !== 'insurance') throw new Error('That insurer is not open.');
    if (uid(c.ownerId) === uid(user.id)) throw new Error('You cannot insure yourself at your own company.');
    const premium = Math.max(0, Math.floor(Number(c.premium) || 0));
    await chargeWallet(store, user, premium);
    c.cash += premium;
    c.weekProfit += premium;
    c.policies[uid(user.id)] = true;
    return present(state, user, await holders(store));
  });
}

export async function deleteCompany(store, user, companyId) {
  return withState(store, async (state) => {
    const c = ownedCompany(state, user.id, companyId);
    if (!c) throw new Error('You do not own that company.');
    const owed = sumMap(c.deposits);
    let cash = Math.max(0, Math.floor(Number(c.cash) || 0));
    if (owed > 0 && cash > 0) {
      const pool = Math.min(cash, owed);
      let paid = 0;
      for (const id of Object.keys(c.deposits || {})) {
        const bal = Math.floor(Number(c.deposits[id]) || 0);
        const part = Math.floor(pool * (bal / owed));
        if (part > 0) {
          await payWallet(store, id, part);
          paid += part;
        }
      }
      cash -= paid;
    }
    state.national.taxPool += Math.max(0, cash);
    c.cash = 0;
    c.shares = {};
    c.listed = 0;
    c.sharePrice = 0;
    c.shareExact = 0;
    c.shorts = {};
    c.shortBill = {};
    c.orders = [];
    pushHistory(c, Date.now(), 0);
    c.deposits = {};
    c.policies = {};
    c.tournaments = [];
    c.tournament = null;
    c.alive = false;
    state.loans = state.loans.filter((loan) => loan.lender !== c.id && !(loan.borrowerType === 'company' && loan.borrowerId === c.id));
    return present(state, user, await holders(store));
  });
}

function rangeStart(key, now) {
  if (key === '1d') return now - DAY_MS;
  if (key === '1w') return now - 7 * DAY_MS;
  if (key === '1m') return now - 30 * DAY_MS;
  if (key === '1y') return now - 365 * DAY_MS;
  if (key === '10y') return now - 3650 * DAY_MS;
  return new Date(new Date(now).getFullYear(), 0, 1).getTime();
}

function downsample(points, max) {
  if (points.length <= max) return points;
  const out = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) out.push(points[Math.round(i * step)]);
  return out;
}

function chartSeries(c, key) {
  const now = Date.now();
  const start = rangeStart(key, now);
  const mark = c.alive ? (Number(c.shareExact) > 0 ? Number(c.shareExact) : Math.max(0, Number(c.sharePrice) || 0)) : 0;
  const hist = (Array.isArray(c.history) ? c.history : [])
    .filter((p) => Number.isFinite(Number(p.t)) && Number.isFinite(Number(p.p)))
    .map((p) => ({ t: Number(p.t), p: Math.max(0, Math.round(Number(p.p) * 100) / 100) }))
    .sort((a, b) => a.t - b.t);
  let baseline = null;
  const inside = [];
  for (const p of hist) {
    if (p.t < start) baseline = p;
    else inside.push(p);
  }
  const line = [];
  if (baseline) line.push(baseline);
  line.push(...inside);
  if (!line.length || Math.abs(line[line.length - 1].p - mark) > 0.009) line.push({ t: now, p: Math.round(mark * 100) / 100 });
  const first = line[0].p;
  const pct = first > 0 ? (mark - first) / first : 0;
  return {
    range: key,
    pct: Math.round(pct * 10000) / 10000,
    from: first,
    to: Math.round(mark * 100) / 100,
    sinceListing: !baseline,
    points: downsample(line, 80),
  };
}

function stockCard(c, user) {
  return {
    id: c.id,
    name: c.name,
    ticker: c.ticker || '',
    ownerName: c.ownerName,
    alive: !!c.alive,
    isPublic: !!c.isPublic && !!c.alive,
    sharePrice: c.alive ? c.sharePrice : 0,
    shareExact: c.alive ? Math.round((Number.isFinite(Number(c.shareExact)) ? Number(c.shareExact) : Math.max(0, Number(c.sharePrice) || 0)) * 100) / 100 : 0,
    listed: c.alive ? c.listed : 0,
    shareCount: c.shareCount || SHARE_COUNT,
    sovereign: !!c.sovereign,
    yourShares: c.shares ? sharesOf(c, user.id) : 0,
    yourShort: shortOf(c, user.id),
    viewerIsOwner: uid(c.ownerId) === uid(user.id),
  };
}

export async function stockSearch(store, user, q) {
  const query = String(q || '').trim().toLowerCase();
  if (query.length < 1) throw new Error('Type a company name or ticker.');
  return withState(store, async (state) => {
    const matches = state.companies
      .filter((c) => {
        const name = String(c.name || '').toLowerCase();
        const ticker = String(c.ticker || '').toLowerCase();
        return name.includes(query) || (ticker && ticker.includes(query));
      })
      .slice(0, 20)
      .map((c) => stockCard(c, user));
    return { matches };
  });
}

export async function stockQuote(store, user, companyId, range) {
  const key = String(range || '1d').toLowerCase();
  if (!['1d', '1w', '1m', '1y', '10y', 'ytd'].includes(key)) throw new Error('Unknown range.');
  return withState(store, async (state) => {
    const c = state.companies.find((row) => row.id === companyId);
    if (!c) throw new Error('Company not found.');
    return {
      ...stockCard(c, user),
      ...chartSeries(c, key),
      orders: (Array.isArray(c.orders) ? c.orders : [])
        .filter((order) => uid(order.userId) === uid(user.id))
        .map((order) => ({ id: order.id, side: order.side, qty: order.qty, limit: order.limit })),
    };
  });
}

export async function enterTournament(store, user, companyId, tournamentId) {
  return withState(store, async (state) => {
    const c = companyById(state, companyId);
    if (!c || c.kind !== 'racing') throw new Error('No tournament is open.');
    const t = findTournament(c, tournamentId);
    if (!t) throw new Error('That tournament is not open.');
    if (t.startsAt && Date.now() >= Number(t.startsAt)) throw new Error('This tournament has already started.');
    if ((t.entrants || []).some((e) => uid(e.userId) === uid(user.id))) throw new Error('You already entered.');
    const fee = Math.max(0, Math.floor(Number(t.fee) || 0));
    await chargeWallet(store, user, fee);
    c.cash += fee;
    c.weekProfit += fee;
    t.entrants.push({ userId: uid(user.id), username: user.username });
    return present(state, user, await holders(store));
  });
}

export async function payTournament(store, user, companyId, tournamentId, username) {
  const want = String(username || '').trim().toLowerCase();
  return withState(store, async (state) => {
    const c = ownedCompany(state, user.id, companyId);
    if (!c || c.kind !== 'racing') throw new Error('No tournament to pay.');
    const t = findTournament(c, tournamentId);
    if (!t) throw new Error('That tournament is not open.');
    const winner = (t.entrants || []).find((e) => String(e.username || '').toLowerCase() === want);
    if (!winner) throw new Error('That player did not enter.');
    const prize = Math.max(0, Math.floor(Number(t.prize) || 0));
    if (c.cash < prize) throw new Error('The company cannot cover the prize.');
    c.cash -= prize;
    c.weekProfit -= prize;
    await payWallet(store, winner.userId, prize);
    c.tournaments = tournamentsOf(c).filter((row) => row.id !== t.id);
    return present(state, user, await holders(store));
  });
}

export async function heist(store, user, bankId) {
  return withState(store, async (state) => {
    const national = bankId === 'national';
    const bank = national ? null : companyById(state, bankId);
    if (!national && (!bank || bank.sovereign || bank.kind !== 'bank')) throw new Error('That bank is not open.');
    if (bank && uid(bank.ownerId) === uid(user.id)) throw new Error('You cannot heist your own bank.');
    const chance = national ? HEIST_NATIONAL : HEIST_PRIVATE;
    const success = Math.random() < chance;
    if (!success) {
      if (national && isOwnerUser(user)) {
        return {
          ok: false,
          banned: false,
          message: 'The heist failed.',
          view: present(state, user, await holders(store)),
        };
      }
      const until = durationKeyToBanUntil('1d');
      if (typeof store.applyBan === 'function' && until != null) {
        await store.applyBan(user.id, until, 'Failed a bank heist.');
      }
      return { ok: false, banned: true, message: 'The heist failed. You are banned for 1 day.' };
    }
    const book = national ? state.national.deposits : bank.deposits;
    let stolen = 0;
    const drained = {};
    for (const id of Object.keys(book || {})) {
      const bal = Math.floor(Number(book[id]) || 0);
      const take = Math.floor(bal * HEIST_DRAIN);
      if (take <= 0) continue;
      book[id] = bal - take;
      drained[id] = take;
      stolen += take;
    }
    if (!national) {
      const fromCash = Math.min(bank.cash, stolen);
      bank.cash -= fromCash;
      bank.weekProfit -= stolen;
    }
    await payWallet(store, user.id, stolen);
    let reimbursed = 0;
    if (national && stolen > 0) {
      state.national.vault = Math.max(0, (state.national.vault || 0) - stolen);
      state.national.weekOut = Math.max(0, Math.floor(Number(state.national.weekOut) || 0)) + stolen;
      const want = Math.floor(stolen * FDIC);
      reimbursed = Math.min(want, state.national.taxPool);
      state.national.taxPool -= reimbursed;
      if (reimbursed > 0) {
        state.national.vault += reimbursed;
        for (const id of Object.keys(drained)) {
          const back = Math.floor((drained[id] / stolen) * reimbursed);
          state.national.deposits[id] = Math.floor(Number(state.national.deposits[id]) || 0) + back;
        }
      }
    }
    return {
      ok: true,
      banned: false,
      stolen,
      reimbursed,
      message: national
        ? 'The national bank was hit. Depositors get 75% back from the tax pool when it can pay.'
        : 'The heist landed. 25% of every deposit in that bank was taken.',
      view: present(state, user, await holders(store)),
    };
  });
}
