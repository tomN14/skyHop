/**
 * Company partnerships, contracts, lawsuits, and law-firm cases.
 * Moderators act as judges. Stored in site content.
 */
import { censorProfanity } from './profanity-filter.js';
import { effectiveRole, isStaffRole } from './moderation.js';
import * as Economy from './economy.js';

const KEY = 'legal';
const PARTNER_CAP = 40;
const CONTRACT_CAP = 80;
const SUIT_CAP = 60;
const DEAL_MSG_CAP = 80;

function empty() {
  return { partnerships: [], contracts: [], suits: [], nextId: 1 };
}

function dayMs(days) {
  return Math.max(1, Math.round(Number(days) || 30)) * 24 * 60 * 60 * 1000;
}

/** Active deals past endsAt become expired. Existing accepted contracts without a lasting schedule get 30 days. */
function normalizeDeal(row) {
  if (!row || typeof row !== 'object') return row;
  if (row.status === 'active') {
    const days = Math.round(Number(row.durationDays));
    if (!Number.isFinite(days) || days < 1) row.durationDays = 30;
    const ends = Number(row.endsAt);
    if (!Number.isFinite(ends) || ends <= 0) {
      const start = Number(row.acceptedAt) || Number(row.at) || Date.now();
      row.endsAt = start + dayMs(row.durationDays);
    }
    if (Date.now() >= Number(row.endsAt)) row.status = 'expired';
  }
  return row;
}

async function load(store) {
  const bag = empty();
  if (typeof store.getSiteContentPayload !== 'function') return bag;
  const row = await store.getSiteContentPayload(KEY);
  if (!row || typeof row !== 'object') return bag;
  bag.partnerships = (Array.isArray(row.partnerships) ? row.partnerships : []).map(normalizeDeal);
  bag.contracts = (Array.isArray(row.contracts) ? row.contracts : []).map(normalizeDeal);
  bag.suits = Array.isArray(row.suits) ? row.suits : [];
  bag.nextId = Number(row.nextId) >= 1 ? Number(row.nextId) : 1;
  return bag;
}

async function save(store, bag) {
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('Legal storage is not configured.');
  await store.setSiteContentPayload(KEY, bag);
}

function idOf(value) {
  return String(value || '');
}

function nextId(bag) {
  const id = 'L' + bag.nextId;
  bag.nextId += 1;
  return id;
}

function cleanText(value, max) {
  return censorProfanity(String(value || '')).text.trim().slice(0, max);
}

async function companyById(store, companyId) {
  const state = await Economy.loadState(store);
  return (state.companies || []).find((c) => idOf(c.id) === idOf(companyId) && c.alive !== false) || null;
}

async function assertControls(store, user, companyId) {
  const state = await Economy.loadState(store);
  const company = (state.companies || []).find((c) => idOf(c.id) === idOf(companyId) && c.alive !== false) || null;
  if (!company) throw new Error('Company not found.');
  if (!Economy.controlsCompany(state, company, user)) throw new Error('You do not run that company.');
  return company;
}

export async function proposePartnership(store, user, body) {
  const from = await assertControls(store, user, body.fromCompanyId);
  const to = await companyById(store, body.toCompanyId);
  if (!to) throw new Error('That company was not found.');
  if (idOf(from.id) === idOf(to.id)) throw new Error('A company cannot partner with itself.');
  const bag = await load(store);
  const row = {
    id: nextId(bag),
    fromCompanyId: from.id,
    fromName: from.name,
    toCompanyId: to.id,
    toName: to.name,
    terms: cleanText(body.terms, 2000),
    exclusivity: !!body.exclusivity,
    durationDays: Math.max(1, Math.min(3650, Math.round(Number(body.durationDays) || 30))),
    status: 'proposed',
    at: Date.now(),
    byUserId: idOf(user.id),
    byUsername: String(user.username || ''),
    messages: [],
  };
  bag.partnerships.push(row);
  if (bag.partnerships.length > PARTNER_CAP) bag.partnerships = bag.partnerships.slice(-PARTNER_CAP);
  await save(store, bag);
  return row;
}

export async function respondPartnership(store, user, body) {
  const bag = await load(store);
  const row = bag.partnerships.find((item) => item.id === String(body.id || ''));
  if (!row || row.status !== 'proposed') throw new Error('That partnership proposal is gone.');
  await assertControls(store, user, row.toCompanyId);
  const action = String(body.response || body.decision || '').toLowerCase();
  if (action === 'accept') {
    row.status = 'active';
    row.acceptedAt = Date.now();
    row.endsAt = Date.now() + row.durationDays * 24 * 60 * 60 * 1000;
    if (!Array.isArray(row.messages)) row.messages = [];
  } else if (action === 'reject') {
    row.status = 'rejected';
  } else if (action === 'counter') {
    row.terms = cleanText(body.terms, 2000) || row.terms;
    row.durationDays = Math.max(1, Math.min(3650, Math.round(Number(body.durationDays) || row.durationDays)));
    row.exclusivity = body.exclusivity != null ? !!body.exclusivity : row.exclusivity;
    const swapFrom = row.fromCompanyId;
    const swapName = row.fromName;
    row.fromCompanyId = row.toCompanyId;
    row.fromName = row.toName;
    row.toCompanyId = swapFrom;
    row.toName = swapName;
    row.status = 'proposed';
    row.counterAt = Date.now();
  } else {
    throw new Error('Choose accept, reject, or counter.');
  }
  await save(store, bag);
  return row;
}

export async function createContract(store, user, body) {
  const from = await assertControls(store, user, body.fromCompanyId);
  const to = await companyById(store, body.toCompanyId);
  if (!to) throw new Error('That company was not found.');
  const bag = await load(store);
  const row = {
    id: nextId(bag),
    fromCompanyId: from.id,
    fromName: from.name,
    toCompanyId: to.id,
    toName: to.name,
    title: cleanText(body.title, 80) || 'Contract',
    terms: cleanText(body.terms, 4000),
    payment: Math.max(0, Math.round(Number(body.payment) || 0)),
    durationDays: Math.max(1, Math.min(3650, Math.round(Number(body.durationDays) || 30))),
    status: 'proposed',
    at: Date.now(),
    byUserId: idOf(user.id),
    byUsername: String(user.username || ''),
    messages: [],
  };
  bag.contracts.push(row);
  if (bag.contracts.length > CONTRACT_CAP) bag.contracts = bag.contracts.slice(-CONTRACT_CAP);
  await save(store, bag);
  return row;
}

export async function respondContract(store, user, body) {
  const bag = await load(store);
  const row = bag.contracts.find((item) => item.id === String(body.id || ''));
  if (!row || row.status !== 'proposed') throw new Error('That contract is gone.');
  await assertControls(store, user, row.toCompanyId);
  if (String(body.response || body.decision || '').toLowerCase() === 'accept') {
    row.status = 'active';
    row.acceptedAt = Date.now();
    row.endsAt = Date.now() + row.durationDays * 24 * 60 * 60 * 1000;
    if (!Array.isArray(row.messages)) row.messages = [];
  } else {
    row.status = 'rejected';
  }
  await save(store, bag);
  return row;
}

function dealList(bag, kind) {
  return kind === 'contract' ? bag.contracts : bag.partnerships;
}

function publicDealMessage(entry) {
  return {
    at: entry.at,
    kind: entry.kind || 'chat',
    companyId: entry.companyId,
    companyName: entry.companyName || '',
    username: entry.username || '',
    text: entry.text || '',
    amount: entry.amount || 0,
  };
}

function ensureDealMessages(row) {
  if (!Array.isArray(row.messages)) row.messages = [];
  return row.messages;
}

async function assertActiveDealParty(store, user, row, companyId) {
  normalizeDeal(row);
  if (!row || row.status === 'expired') {
    throw new Error('That agreement has expired. Messaging and payments are closed.');
  }
  if (!row || row.status !== 'active') throw new Error('That agreement is not active.');
  const id = idOf(companyId);
  if (id !== idOf(row.fromCompanyId) && id !== idOf(row.toCompanyId)) {
    throw new Error('Only a company on this agreement can do that.');
  }
  return assertControls(store, user, id);
}

export async function sendDealMessage(store, user, body) {
  const kind = String(body.kind || body.dealKind || '').toLowerCase() === 'contract' ? 'contract' : 'partnership';
  const bag = await load(store);
  const row = dealList(bag, kind).find((item) => item.id === String(body.id || body.dealId || ''));
  const company = await assertActiveDealParty(store, user, row, body.companyId);
  if (row.status !== 'active') {
    await save(store, bag);
    throw new Error('That agreement has expired. Messaging and payments are closed.');
  }
  const text = cleanText(body.text || body.message, 1000);
  if (!text) throw new Error('Write a message.');
  const messages = ensureDealMessages(row);
  messages.push({
    at: Date.now(),
    kind: 'chat',
    companyId: company.id,
    companyName: company.name,
    username: String(user.username || ''),
    text,
    amount: 0,
  });
  if (messages.length > DEAL_MSG_CAP) row.messages = messages.slice(-DEAL_MSG_CAP);
  await save(store, bag);
  return { ok: true, kind, id: row.id, messages: (row.messages || []).map(publicDealMessage) };
}

export async function sendDealPayment(store, user, body) {
  const kind = String(body.kind || body.dealKind || '').toLowerCase() === 'contract' ? 'contract' : 'partnership';
  const bag = await load(store);
  const row = dealList(bag, kind).find((item) => item.id === String(body.id || body.dealId || ''));
  const from = await assertActiveDealParty(store, user, row, body.companyId);
  if (row.status !== 'active') {
    await save(store, bag);
    throw new Error('That agreement has expired. Messaging and payments are closed.');
  }
  const amount = Math.floor(Number(body.amount) || 0);
  if (amount < 1) throw new Error('Enter a payment of at least 1 coin.');
  if (amount > 10_000_000) throw new Error('That payment is too large.');
  const toId = idOf(from.id) === idOf(row.fromCompanyId) ? row.toCompanyId : row.fromCompanyId;
  const toName = idOf(toId) === idOf(row.toCompanyId) ? row.toName : row.fromName;
  await Economy.consumeCompanyAuthCode(store, user, from.id, body.authCode);
  await Economy.transferCompanyCash(store, from.id, toId, amount);
  const note = cleanText(body.note || body.text, 300);
  const messages = ensureDealMessages(row);
  messages.push({
    at: Date.now(),
    kind: 'payment',
    companyId: from.id,
    companyName: from.name,
    username: String(user.username || ''),
    text: note || 'Paid ' + amount + ' coins to ' + toName + '.',
    amount,
  });
  if (messages.length > DEAL_MSG_CAP) row.messages = messages.slice(-DEAL_MSG_CAP);
  await save(store, bag);
  return { ok: true, kind, id: row.id, amount, toCompanyId: toId, messages: (row.messages || []).map(publicDealMessage) };
}

export async function fileSuit(store, user, body) {
  const plaintiff = await assertControls(store, user, body.plaintiffCompanyId);
  const defendant = await companyById(store, body.defendantCompanyId);
  if (!defendant) throw new Error('That company was not found.');
  if (idOf(plaintiff.id) === idOf(defendant.id)) throw new Error('A company cannot sue itself.');
  await Economy.consumeCompanyAuthCode(store, user, plaintiff.id, body.authCode);
  const bag = await load(store);
  const row = {
    id: nextId(bag),
    plaintiffCompanyId: plaintiff.id,
    plaintiffName: plaintiff.name,
    defendantCompanyId: defendant.id,
    defendantName: defendant.name,
    reason: cleanText(body.reason, 2000),
    contractId: body.contractId ? String(body.contractId) : null,
    evidence: [],
    arguments: [],
    plaintiffFirmId: null,
    defendantFirmId: null,
    judgeUserId: null,
    judgeUsername: null,
    status: 'filed',
    verdict: null,
    verdictReason: '',
    compensation: 0,
    at: Date.now(),
    byUserId: idOf(user.id),
    byUsername: String(user.username || ''),
    appealOf: null,
  };
  bag.suits.push(row);
  if (bag.suits.length > SUIT_CAP) bag.suits = bag.suits.slice(-SUIT_CAP);
  await save(store, bag);
  return publicSuit(row);
}

function publicSuit(row) {
  return {
    id: row.id,
    plaintiffCompanyId: row.plaintiffCompanyId,
    plaintiffName: row.plaintiffName,
    defendantCompanyId: row.defendantCompanyId,
    defendantName: row.defendantName,
    reason: row.reason,
    contractId: row.contractId,
    evidence: row.evidence || [],
    arguments: row.arguments || [],
    plaintiffFirmId: row.plaintiffFirmId,
    defendantFirmId: row.defendantFirmId,
    judgeUserId: row.judgeUserId,
    judgeUsername: row.judgeUsername,
    status: row.status,
    verdict: row.verdict,
    verdictReason: row.verdictReason || '',
    compensation: row.compensation || 0,
    at: row.at,
    byUsername: row.byUsername,
    appealOf: row.appealOf || null,
  };
}

export async function addEvidence(store, user, body) {
  const bag = await load(store);
  const row = bag.suits.find((item) => item.id === String(body.suitId || ''));
  if (!row || row.status === 'closed' || row.status === 'dismissed') throw new Error('That case is closed.');
  const side = String(body.side || '').toLowerCase() === 'defendant' ? 'defendant' : 'plaintiff';
  const companyId = side === 'plaintiff' ? row.plaintiffCompanyId : row.defendantCompanyId;
  await assertControls(store, user, companyId);
  row.evidence = Array.isArray(row.evidence) ? row.evidence : [];
  row.evidence.push({
    at: Date.now(),
    side,
    username: String(user.username || ''),
    text: cleanText(body.text, 2000),
  });
  if (row.evidence.length > 40) row.evidence = row.evidence.slice(-40);
  await save(store, bag);
  return publicSuit(row);
}

export async function addArgument(store, user, body) {
  const bag = await load(store);
  const row = bag.suits.find((item) => item.id === String(body.suitId || ''));
  if (!row || row.status === 'closed' || row.status === 'dismissed') throw new Error('That case is closed.');
  const side = String(body.side || '').toLowerCase() === 'defendant' ? 'defendant' : 'plaintiff';
  const companyId = side === 'plaintiff' ? row.plaintiffCompanyId : row.defendantCompanyId;
  await assertControls(store, user, companyId);
  row.arguments = Array.isArray(row.arguments) ? row.arguments : [];
  row.arguments.push({
    at: Date.now(),
    side,
    username: String(user.username || ''),
    text: cleanText(body.text, 2000),
  });
  if (row.arguments.length > 40) row.arguments = row.arguments.slice(-40);
  await save(store, bag);
  return publicSuit(row);
}

export async function hireFirm(store, user, body) {
  const bag = await load(store);
  const row = bag.suits.find((item) => item.id === String(body.suitId || ''));
  if (!row) throw new Error('That case was not found.');
  const side = String(body.side || '').toLowerCase() === 'defendant' ? 'defendant' : 'plaintiff';
  const companyId = side === 'plaintiff' ? row.plaintiffCompanyId : row.defendantCompanyId;
  await assertControls(store, user, companyId);
  const firm = await companyById(store, body.firmCompanyId);
  if (!firm || firm.kind !== 'law') throw new Error('Pick a law firm.');
  if (side === 'plaintiff') row.plaintiffFirmId = firm.id;
  else row.defendantFirmId = firm.id;
  await save(store, bag);
  return publicSuit(row);
}

export async function claimJudge(store, user, suitId) {
  if (!isStaffRole(effectiveRole(user))) throw new Error('Only moderators can judge.');
  const bag = await load(store);
  const row = bag.suits.find((item) => item.id === String(suitId || ''));
  if (!row) throw new Error('That case was not found.');
  if (row.status !== 'filed' && row.status !== 'open') throw new Error('That case is not open.');
  if (row.judgeUserId && idOf(row.judgeUserId) !== idOf(user.id)) throw new Error('Another judge already has this case.');
  const plaintiff = await companyById(store, row.plaintiffCompanyId);
  const defendant = await companyById(store, row.defendantCompanyId);
  const state = await Economy.loadState(store);
  if (Economy.controlsCompany(state, plaintiff, user) || Economy.controlsCompany(state, defendant, user)) {
    throw new Error('You cannot judge a case involving your own company.');
  }
  if (row.appealOf && row.priorJudgeUserId && idOf(row.priorJudgeUserId) === idOf(user.id)) {
    throw new Error('A different moderator must hear the appeal.');
  }
  row.judgeUserId = idOf(user.id);
  row.judgeUsername = String(user.username || '');
  row.status = 'open';
  await save(store, bag);
  return publicSuit(row);
}

export async function issueVerdict(store, user, body) {
  if (!isStaffRole(effectiveRole(user))) throw new Error('Only moderators can issue a verdict.');
  const bag = await load(store);
  const row = bag.suits.find((item) => item.id === String(body.suitId || ''));
  if (!row) throw new Error('That case was not found.');
  if (idOf(row.judgeUserId) !== idOf(user.id) && effectiveRole(user) !== 'owner') {
    throw new Error('Only the assigned judge can issue this verdict.');
  }
  const state = await Economy.loadState(store);
  const plaintiff = (state.companies || []).find((c) => idOf(c.id) === idOf(row.plaintiffCompanyId)) || null;
  const defendant = (state.companies || []).find((c) => idOf(c.id) === idOf(row.defendantCompanyId)) || null;
  if (Economy.controlsCompany(state, plaintiff, user) || Economy.controlsCompany(state, defendant, user)) {
    throw new Error('You cannot judge a case involving your own company.');
  }
  const verdict = String(body.verdict || '').toLowerCase();
  if (verdict !== 'dismiss' && verdict !== 'compensate' && verdict !== 'other') {
    throw new Error('Choose dismiss, compensate, or other.');
  }
  const compensation = Math.max(0, Math.round(Number(body.compensation) || 0));
  if (verdict === 'compensate' && compensation > 0 && plaintiff && defendant) {
    await Economy.transferCompanyCash(store, defendant.id, plaintiff.id, compensation);
  }
  row.verdict = verdict;
  row.verdictReason = cleanText(body.reason, 4000);
  row.compensation = compensation;
  row.status = verdict === 'dismiss' ? 'dismissed' : 'closed';
  row.decidedAt = Date.now();
  await save(store, bag);
  return publicSuit(row);
}

export async function appeal(store, user, body) {
  const bag = await load(store);
  const prior = bag.suits.find((item) => item.id === String(body.suitId || ''));
  if (!prior || (prior.status !== 'closed' && prior.status !== 'dismissed')) {
    throw new Error('Only a decided case can be appealed.');
  }
  const companyId = idOf(body.companyId);
  if (companyId !== idOf(prior.plaintiffCompanyId) && companyId !== idOf(prior.defendantCompanyId)) {
    throw new Error('Only a party to the case can appeal.');
  }
  await assertControls(store, user, companyId);
  const row = {
    id: nextId(bag),
    plaintiffCompanyId: prior.plaintiffCompanyId,
    plaintiffName: prior.plaintiffName,
    defendantCompanyId: prior.defendantCompanyId,
    defendantName: prior.defendantName,
    reason: cleanText(body.reason, 2000) || 'Appeal: ' + (prior.reason || ''),
    contractId: prior.contractId,
    evidence: [],
    arguments: [],
    plaintiffFirmId: prior.plaintiffFirmId,
    defendantFirmId: prior.defendantFirmId,
    judgeUserId: null,
    judgeUsername: null,
    status: 'filed',
    verdict: null,
    verdictReason: '',
    compensation: 0,
    at: Date.now(),
    byUserId: idOf(user.id),
    byUsername: String(user.username || ''),
    appealOf: prior.id,
    priorJudgeUserId: prior.judgeUserId,
  };
  bag.suits.push(row);
  if (bag.suits.length > SUIT_CAP) bag.suits = bag.suits.slice(-SUIT_CAP);
  await save(store, bag);
  return publicSuit(row);
}

export async function overview(store, user) {
  const bag = await load(store);
  let dirty = false;
  for (const row of bag.partnerships.concat(bag.contracts)) {
    const before = row.status;
    normalizeDeal(row);
    if (row.status !== before) dirty = true;
  }
  if (dirty) await save(store, bag);
  const role = effectiveRole(user);
  const mine = [];
  const state = await Economy.loadState(store);
  for (const company of state.companies || []) {
    if (company.alive === false) continue;
    if (Economy.controlsCompany(state, company, user)) mine.push(idOf(company.id));
  }
  const mineSet = new Set(mine);
  const partnerships = bag.partnerships.filter(
    (row) => mineSet.has(idOf(row.fromCompanyId)) || mineSet.has(idOf(row.toCompanyId))
  );
  const contracts = bag.contracts.filter(
    (row) => mineSet.has(idOf(row.fromCompanyId)) || mineSet.has(idOf(row.toCompanyId))
  );
  let suits = bag.suits.filter(
    (row) => mineSet.has(idOf(row.plaintiffCompanyId)) || mineSet.has(idOf(row.defendantCompanyId))
  );
  if (isStaffRole(role)) {
    suits = bag.suits.slice();
  }
  const lawFirms = (state.companies || [])
    .filter((c) => c.alive !== false && c.kind === 'law')
    .map((c) => ({ id: c.id, name: c.name, ownerName: c.ownerName }));
  function withDealExtras(row) {
    return Object.assign({}, row, {
      messages: Array.isArray(row.messages) ? row.messages.map(publicDealMessage) : [],
    });
  }
  return {
    partnerships: partnerships.slice(-40).reverse().map(withDealExtras),
    contracts: contracts.slice(-40).reverse().map(withDealExtras),
    suits: suits.slice(-40).reverse().map(publicSuit),
    lawFirms,
    companies: (state.companies || [])
      .filter((c) => c.alive !== false && !c.sovereign)
      .map((c) => ({
        id: c.id,
        name: c.name,
        ticker: c.ticker || '',
        kind: c.kind,
        yours: mineSet.has(idOf(c.id)),
      })),
  };
}
