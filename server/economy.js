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
    indexChange: 0,
    national: { taxPool: 0, vault: 0, deposits: {} },
    companies: [],
    loans: [],
    marks: {},
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
  state.indexChange = Number(row.indexChange) || 0;
  state.national = {
    taxPool: Math.max(0, Math.floor(Number(row.national && row.national.taxPool) || 0)),
    vault: Math.max(0, Math.floor(Number(row.national && row.national.vault) || 0)),
    deposits: (row.national && row.national.deposits) || {},
  };
  state.companies = Array.isArray(row.companies) ? row.companies : [];
  state.loans = Array.isArray(row.loans) ? row.loans : [];
  state.marks = row.marks && typeof row.marks === 'object' ? row.marks : {};
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

async function indexMove(state) {
  try {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=5d', {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error('index');
    const data = await res.json();
    const closes = (((data.chart || {}).result || [])[0].indicators.quote[0].close || []).filter((n) => n != null);
    const prev = closes[closes.length - 2];
    const last = closes[closes.length - 1];
    if (!(prev > 0) || !(last > 0)) throw new Error('index');
    const change = (last - prev) / prev;
    return Math.max(-0.08, Math.min(0.08, change));
  } catch {
    if (state.indexChange) return state.indexChange;
    const day = Math.floor(Date.now() / 86400000);
    const x = Math.sin(day * 12.9898) * 43758.5453;
    return (x - Math.floor(x) - 0.5) * 0.04;
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

function myCompany(state, userId) {
  return state.companies.find((c) => c.alive && uid(c.ownerId) === uid(userId)) || null;
}

function sharesOf(company, userId) {
  return Math.max(0, Math.floor(Number(company.shares[uid(userId)]) || 0));
}

function portfolio(state, userId) {
  let n = 0;
  for (const c of state.companies) {
    if (!c.alive) continue;
    n += sharesOf(c, userId) * Math.max(1, Math.floor(Number(c.sharePrice) || 1));
  }
  return n;
}

function sumMap(map) {
  let n = 0;
  for (const k of Object.keys(map || {})) n += Math.max(0, Math.floor(Number(map[k]) || 0));
  return n;
}

async function applyWeek(store, state) {
  const move = await indexMove(state);
  const local = (Math.random() - 0.5) * 0.04;
  state.indexChange = Math.round((move + local) * 10000) / 10000;
  const people = await holders(store);
  const before = {};
  for (const p of people) before[uid(p.id)] = portfolio(state, p.id);

  for (const c of state.companies) {
    if (!c.alive || !c.isPublic) continue;
    const next = Math.round(Math.max(1, c.sharePrice) * (1 + state.indexChange));
    c.sharePrice = Math.max(1, Math.min(1_000_000, next));
  }

  for (const p of people) {
    if (effectiveRole(p) === 'owner') continue;
    const tax = Math.floor(coinsOf(p) * TAX_RATE);
    if (tax > 0) {
      await store.incrementUserCoins(p.id, -tax);
      state.national.taxPool += tax;
    }
  }

  for (const c of state.companies) {
    if (!c.alive) continue;
    c.weekProfit = 0;
    c.weekProfit -= OVERHEAD;
    c.cash = Math.max(0, Math.floor(Number(c.cash) || 0) - Math.min(OVERHEAD, Math.max(0, Math.floor(Number(c.cash) || 0))));
    const tax = Math.floor(Math.max(0, c.cash) * TAX_RATE);
    if (tax > 0) {
      c.cash -= tax;
      c.weekProfit -= tax;
      state.national.taxPool += tax;
    }
  }

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
  }

  for (const c of state.companies) {
    if (!c.alive || c.kind !== 'bank') continue;
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
    if (!c.alive) continue;
    if (c.weekProfit < BANKRUPT_AT) {
      state.national.taxPool += Math.max(0, Math.floor(Number(c.cash) || 0));
      c.cash = 0;
      c.shares = {};
      c.listed = 0;
      c.sharePrice = 0;
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
  const mine = myCompany(state, user.id);
  return {
    coins: coinsOf(user),
    coinsInfinite: isOwnerUser(user),
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
    },
    yourCompany: mine ? detailCompany(mine, user, people, true) : null,
    companies: state.companies.filter((c) => c.alive).map((c) => detailCompany(c, user, people, uid(c.ownerId) === me)),
    loans: state.loans
      .filter((loan) => uid(loan.borrowerId) === me || (mine && loan.borrowerType === 'company' && loan.borrowerId === mine.id))
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
    kind: c.kind,
    ownerName: c.ownerName,
    isPublic: !!c.isPublic,
    sharePrice: c.sharePrice,
    listed: c.listed,
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

export async function registerCompany(store, user, { name, kind }) {
  const clean = String(name || '').trim().slice(0, 24);
  if (clean.length < 2) throw new Error('Company name must be 2–24 characters.');
  if (!['racing', 'bank', 'insurance'].includes(kind)) throw new Error('Pick a racing, bank, or insurance company.');
  return withState(store, async (state) => {
    if (myCompany(state, user.id)) throw new Error('You already own a company.');
    if (state.companies.some((c) => c.alive && c.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error('That company name is taken.');
    }
    await chargeWallet(store, user, REGISTER_COST);
    if (!isOwnerUser(user)) state.national.taxPool += REGISTER_COST;
    const company = {
      id: crypto.randomUUID(),
      name: clean,
      kind,
      ownerId: uid(user.id),
      ownerName: user.username,
      cash: 0,
      isPublic: false,
      sharePrice: 10,
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
    };
    state.companies.push(company);
    return present(state, user, await holders(store));
  });
}

export async function updateCompany(store, user, body) {
  return withState(store, async (state) => {
    const c = myCompany(state, user.id);
    if (!c) throw new Error('You do not own a company.');
    if (body.isPublic != null) {
      if (body.isPublic) c.isPublic = true;
      else if (c.listed > 0) throw new Error('Buy the listed shares back before going private.');
      else c.isPublic = false;
    }
    if (body.sharePrice != null) {
      const price = Math.floor(Number(body.sharePrice));
      if (price < 1 || price > 1_000_000) throw new Error('Share price must be 1–1,000,000.');
      c.sharePrice = price;
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
      list.push({ id: crypto.randomUUID(), fee, prize, description, entrants: [] });
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

export async function buyShares(store, user, companyId, qty) {
  const n = clampMoney(qty, 1, SHARE_COUNT);
  return withState(store, async (state) => {
    const c = companyById(state, companyId);
    if (!c || !c.isPublic) throw new Error('That company is not on the market.');
    if (uid(c.ownerId) === uid(user.id)) throw new Error('You already own those shares.');
    if (n > c.listed || n > sharesOf(c, c.ownerId)) throw new Error('Not that many shares are listed.');
    const cost = n * c.sharePrice;
    await chargeWallet(store, user, cost);
    c.cash += cost;
    c.weekProfit += cost;
    c.shares[uid(c.ownerId)] = sharesOf(c, c.ownerId) - n;
    c.shares[uid(user.id)] = sharesOf(c, user.id) + n;
    c.listed -= n;
    if (sharesOf(c, user.id) > SHARE_COUNT / 2 && sharesOf(c, c.ownerId) <= SHARE_COUNT / 2) {
      c.ownerId = uid(user.id);
      c.ownerName = user.username;
    }
    return present(state, user, await holders(store));
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
      if (!c || c.kind !== 'bank') throw new Error('That bank is not open.');
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
      if (!c || c.kind !== 'bank') throw new Error('That bank is not open.');
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

export async function borrow(store, user, { lender, amount, forCompany }) {
  const n = clampMoney(amount, 1, 1_000_000_000);
  return withState(store, async (state) => {
    const firm = forCompany ? myCompany(state, user.id) : null;
    if (forCompany && !firm) throw new Error('You do not own a company.');
    let rate = NATIONAL_LOAN;
    if (lender === 'national') {
      /* Too big to fail: the loan is created even when the tax pool is empty. */
    } else {
      const bank = companyById(state, lender);
      if (!bank || bank.kind !== 'bank') throw new Error('That bank is not open.');
      if (bank.cash < n) throw new Error('That bank does not have the cash.');
      bank.cash -= n;
      rate = Number(bank.loanRate) || NATIONAL_LOAN;
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
    });
    return present(state, user, await holders(store));
  });
}

export async function repay(store, user, loanId, amount) {
  const n = clampMoney(amount, 1, 1_000_000_000);
  return withState(store, async (state) => {
    const loan = state.loans.find((row) => row.id === loanId);
    if (!loan) throw new Error('Loan not found.');
    const firm = myCompany(state, user.id);
    const mine =
      (loan.borrowerType === 'user' && uid(loan.borrowerId) === uid(user.id)) ||
      (loan.borrowerType === 'company' && firm && loan.borrowerId === firm.id);
    if (!mine) throw new Error('That loan is not yours.');
    const pay = Math.min(n, loan.principal);
    if (loan.borrowerType === 'company') {
      if (firm.cash < pay) throw new Error('The company does not have that cash.');
      firm.cash -= pay;
    } else {
      await chargeWallet(store, user, pay);
    }
    if (loan.lender === 'national') state.national.taxPool += pay;
    else {
      const bank = companyById(state, loan.lender);
      if (bank) {
        bank.cash += pay;
        bank.weekProfit += pay;
      } else state.national.taxPool += pay;
    }
    loan.principal -= pay;
    if (loan.principal <= 0) state.loans = state.loans.filter((row) => row.id !== loan.id);
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

export async function enterTournament(store, user, companyId, tournamentId) {
  return withState(store, async (state) => {
    const c = companyById(state, companyId);
    if (!c || c.kind !== 'racing') throw new Error('No tournament is open.');
    const t = findTournament(c, tournamentId);
    if (!t) throw new Error('That tournament is not open.');
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
    const c = myCompany(state, user.id);
    if (!c || c.id !== companyId || c.kind !== 'racing') throw new Error('No tournament to pay.');
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
    if (!national && (!bank || bank.kind !== 'bank')) throw new Error('That bank is not open.');
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
