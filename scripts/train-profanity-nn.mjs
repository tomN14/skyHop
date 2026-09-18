/**
 * Trains a tiny char-bag MLP for profanity evasions; writes js/profanity-nn-weights.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '../js/profanity-nn-weights.json');

const BLOCK = [
  'ass', 'asshole', 'bastard', 'bitch', 'bullshit', 'cock', 'crap', 'cunt', 'damn', 'dick',
  'fag', 'faggot', 'fuck', 'fucker', 'fucking', 'motherfucker', 'nigger', 'nigga', 'piss', 'pussy',
  'shit', 'slut', 'twat', 'whore',
];

const SAFE = [
  'classic', 'assume', 'assistant', 'assu', 'fire', 'truck', 'coffee', 'pass', 'grass', 'mass',
  'glass', 'brass', 'compass', 'success', 'address', 'level', 'sky', 'hop', 'coin', 'friend',
  'hello', 'world', 'game', 'play', 'jump', 'run', 'stage', 'builtin', 'moderator', 'report',
  'shitake', 'cockatoo', 'scunthorpe', 'title', 'name', 'test', 'draft', 'save', 'upload',
  'firetruck', 'firework', 'finger', 'finish', 'furniture',
];

function mutateBad(w) {
  const out = [w];
  if (w.length >= 4) {
    const tail = w.slice(-3);
    const head2 = w.slice(0, 2);
    out.push(head2 + tail);
    out.push(w[0] + 'i' + tail);
    out.push('c' + w[0] + '*'.repeat(Math.max(1, w.length - 1)));
    out.push(w[0] + '*'.repeat(w.length - 1));
    out.push(w.split('').join('*'));
    out.push(w.replace(/./g, (c, i) => (i === 1 ? '*' : c)));
  }
  return out;
}

function featurize(token) {
  const s = String(token || '').toLowerCase();
  const f = new Float32Array(32);
  let len = 0;
  let stars = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '*') {
      stars += 1;
      continue;
    }
    if (ch >= 'a' && ch <= 'z') {
      f[ch.charCodeAt(0) - 97] += 1;
      len += 1;
    }
  }
  if (len > 0) {
    for (let i = 0; i < 26; i++) f[i] /= len;
  }
  f[26] = Math.min(len, 24) / 24;
  f[27] = stars / Math.max(s.length, 1);
  let bestSub = 0;
  for (const w of BLOCK) {
    let j = 0;
    for (let i = 0; i < s.replace(/\*/g, '').length && j < w.length; i++) {
      const c = s.replace(/\*/g, '')[i];
      if (c === w[j]) j++;
    }
    bestSub = Math.max(bestSub, j / w.length);
  }
  f[28] = bestSub;
  f[29] = len > 0 && s.replace(/\*/g, '')[0] === 'f' ? 1 : 0;
  f[30] = s.includes('*') ? 1 : 0;
  f[31] = len >= 4 && s.replace(/\*/g, '').slice(-3) === 'uck' ? 1 : 0;
  return f;
}

function randn() {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const IN = 32;
const HID = 14;
const samples = [];
for (const w of BLOCK) {
  for (const m of mutateBad(w)) samples.push({ x: featurize(m), y: 1 });
}
for (const w of SAFE) {
  samples.push({ x: featurize(w), y: 0 });
  samples.push({ x: featurize(w + 's'), y: 0 });
}

let W1 = Float32Array.from({ length: IN * HID }, () => randn() * 0.08);
let b1 = new Float32Array(HID);
let W2 = Float32Array.from({ length: HID }, () => randn() * 0.08);
let b2 = 0;

function forward(x) {
  const h = new Float32Array(HID);
  for (let j = 0; j < HID; j++) {
    let sum = b1[j];
    for (let i = 0; i < IN; i++) sum += x[i] * W1[i * HID + j];
    h[j] = sum > 0 ? sum : 0;
  }
  let o = b2;
  for (let j = 0; j < HID; j++) o += h[j] * W2[j];
  const p = 1 / (1 + Math.exp(-o));
  return { h, p, o };
}

const lr = 0.05;
for (let epoch = 0; epoch < 800; epoch++) {
  for (const { x, y } of samples) {
    const { h, p } = forward(x);
    const err = p - y;
    for (let j = 0; j < HID; j++) W2[j] -= lr * err * h[j];
    b2 -= lr * err;
    for (let j = 0; j < HID; j++) {
      const dh = err * W2[j] * (h[j] > 0 ? 1 : 0);
      b1[j] -= lr * dh;
      for (let i = 0; i < IN; i++) W1[i * HID + j] -= lr * dh * x[i];
    }
  }
}

const payload = {
  in: IN,
  hid: HID,
  threshold: 0.72,
  W1: Array.from(W1),
  b1: Array.from(b1),
  W2: Array.from(W2),
  b2,
};

fs.writeFileSync(OUT, JSON.stringify(payload));
console.log('Wrote', OUT, 'samples', samples.length);

for (const t of ['fiuck', 'cf***', 'f*ck', 'assu', 'classic', 'fuck', 'assume']) {
  const { p } = forward(featurize(t));
  console.log(t, p.toFixed(3));
}
