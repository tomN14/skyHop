/**
 * Extra sign-in for the owner account only: a second password, then an emailed code.
 * Stored as site content so both the file store and Supabase work without new SQL.
 */
import crypto from 'crypto';
import { checkPassword, hashNewPassword } from './password.js';
import { sendOwnerMail } from './mail.js';

const KEY = 'owner_login_gate';
const STEP_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;

let chain = Promise.resolve();

function locked(fn) {
  const run = chain.then(fn, fn);
  chain = run.then(
    () => {},
    () => {}
  );
  return run;
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function newSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function emptyBag() {
  return { secondSalt: '', secondHash: '', pending: [] };
}

async function readBag(store) {
  if (typeof store.getSiteContentPayload !== 'function') return emptyBag();
  const row = await store.getSiteContentPayload(KEY);
  if (!row || typeof row !== 'object') return emptyBag();
  return {
    secondSalt: String(row.secondSalt || ''),
    secondHash: String(row.secondHash || ''),
    pending: Array.isArray(row.pending) ? row.pending : [],
  };
}

async function writeBag(store, bag) {
  if (typeof store.setSiteContentPayload !== 'function') throw new Error('Storage is not configured.');
  await store.setSiteContentPayload(KEY, bag);
}

function prune(bag) {
  const now = Date.now();
  bag.pending = (bag.pending || []).filter((row) => row && Number(row.exp) > now).slice(-8);
}

function findPending(bag, challenge) {
  const idHash = sha256(challenge);
  return (bag.pending || []).find((row) => row && row.idHash === idHash) || null;
}

function drop(bag, row) {
  bag.pending = bag.pending.filter((item) => item !== row);
}

export async function beginOwnerGate(store, user) {
  return locked(async () => {
    const bag = await readBag(store);
    prune(bag);
    const challenge = crypto.randomBytes(32).toString('hex');
    bag.pending.push({
      idHash: sha256(challenge),
      userId: user.id,
      exp: Date.now() + STEP_MS,
      stage: 'second',
      tries: 0,
      otpSalt: '',
      otpHash: '',
    });
    await writeBag(store, bag);
    return { challenge, needsSetup: !bag.secondHash };
  });
}

export async function submitSecondPassword(store, challenge, secondPassword, confirm) {
  return locked(async () => {
    const bag = await readBag(store);
    prune(bag);
    const row = findPending(bag, challenge);
    if (!row || row.stage !== 'second') throw new Error('Sign in again. This step expired.');
    const pass = String(secondPassword || '');
    if (pass.length < 8) throw new Error('Second password must be at least 8 characters.');
    let nextSalt = bag.secondSalt;
    let nextHash = bag.secondHash;
    if (!bag.secondHash) {
      if (pass !== String(confirm || '')) throw new Error('The second passwords do not match.');
      nextSalt = newSalt();
      nextHash = hashNewPassword(pass, nextSalt);
    } else {
      const checked = checkPassword(pass, bag.secondSalt, bag.secondHash);
      if (!checked.ok) {
        row.tries += 1;
        if (row.tries >= MAX_TRIES) drop(bag, row);
        await writeBag(store, bag);
        throw new Error('Second password is wrong.');
      }
      if (checked.upgrade) nextHash = checked.upgrade;
    }
    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    const to = String(process.env.SKYHOP_OWNER_EMAIL || '').trim();
    await sendOwnerMail({
      to,
      subject: 'Sky Hop owner login code',
      text:
        'Your Sky Hop owner login code is ' +
        code +
        '. It expires in 10 minutes. If you did not try to sign in, ignore this email.',
      html:
        '<p>Your Sky Hop owner login code is <strong>' +
        code +
        '</strong>.</p><p>It expires in 10 minutes. If you did not try to sign in, ignore this email.</p>',
      allowLog: false,
    });
    bag.secondSalt = nextSalt;
    bag.secondHash = nextHash;
    row.otpSalt = newSalt();
    row.otpHash = hashNewPassword(code, row.otpSalt);
    row.stage = 'otp';
    row.tries = 0;
    row.exp = Date.now() + STEP_MS;
    await writeBag(store, bag);
    return { ok: true };
  });
}

export async function submitOwnerOtp(store, challenge, code) {
  return locked(async () => {
    const bag = await readBag(store);
    prune(bag);
    const row = findPending(bag, challenge);
    if (!row || row.stage !== 'otp') throw new Error('Sign in again. This step expired.');
    const checked = checkPassword(String(code || '').replace(/\s+/g, ''), row.otpSalt, row.otpHash);
    if (!checked.ok) {
      row.tries += 1;
      if (row.tries >= MAX_TRIES) drop(bag, row);
      await writeBag(store, bag);
      throw new Error('That code is wrong.');
    }
    const userId = row.userId;
    drop(bag, row);
    await writeBag(store, bag);
    return { userId };
  });
}

export async function changeSecondPassword(store, current, next) {
  const pass = String(next || '');
  if (pass.length < 8) throw new Error('Second password must be at least 8 characters.');
  return locked(async () => {
    const bag = await readBag(store);
    if (bag.secondHash) {
      const checked = checkPassword(String(current || ''), bag.secondSalt, bag.secondHash);
      if (!checked.ok) throw new Error('Current second password is wrong.');
    }
    bag.secondSalt = newSalt();
    bag.secondHash = hashNewPassword(pass, bag.secondSalt);
    await writeBag(store, bag);
    return { ok: true };
  });
}
