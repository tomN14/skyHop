/**
 * Tiny trained network that reads a level-editor request.
 * The weights are learned by server/train-level-ai.mjs. Inference is a forward pass.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LABELS = [
  'arena',
  'platform',
  'spike',
  'lava',
  'coin',
  'spawn',
  'goal',
  'monster',
  'boss',
  'shoot',
  'laser',
  'portal',
  'switch',
  'spring',
  'mover',
  'lifter',
  'gravity',
  'fireball',
  'blackout',
  'sign',
  'circle',
  'triangle',
  'chase',
  'jump',
  'kill',
  'explain',
  'whole',
  'hard',
  'easy',
  'climb',
  'wide',
  'replace',
];

const NUMBER_WORDS = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  couple: 2,
  few: 3,
  some: 3,
};

function wordsOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function slotsOf(text) {
  const raw = String(text || '');
  const lower = raw.toLowerCase();
  const found = [];
  const re = /\b(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|couple|few|some)\b/g;
  let match;
  while ((match = re.exec(lower))) {
    const value = NUMBER_WORDS[match[1]] != null ? NUMBER_WORDS[match[1]] : Number(match[1]);
    if (Number.isFinite(value)) found.push(value);
  }
  const seconds = readUnit(lower, /(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:seconds|second|secs|sec)/);
  const hp = readUnit(lower, /(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:hp|health)/);
  const damage = readUnit(lower, /(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:damage|dmg)/);
  const jumps = readJumps(lower);
  const quoted = raw.match(/["“]([^"”]{1,40})["”]/);
  const says = raw.match(/\b(?:says|reads|saying)\s+([a-z0-9][a-z0-9 '!?.-]{0,40})/i);
  const sign = quoted ? quoted[1].trim() : says ? says[1].trim() : '';
  return {
    numbers: found,
    count: found.length ? found[0] : null,
    seconds,
    hp,
    damage,
    jumps,
    sign,
    down: /\bdown\b/i.test(lower),
  };
}

function readJumps(lower) {
  const n = '(\\d+(?:\\.\\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)';
  const patterns = [
    new RegExp(n + '\\s*jumps?\\b'),
    new RegExp('jumps?\\s+to\\s+' + n),
    new RegExp('jump\\s+limit\\s+(?:to\\s+)?' + n),
    new RegExp('limit\\s+(?:the\\s+)?jumps?\\s+to\\s+' + n),
  ];
  for (const pattern of patterns) {
    const value = readUnit(lower, pattern);
    if (value != null) return value;
  }
  return null;
}

function readUnit(text, pattern) {
  const match = text.match(pattern);
  if (!match) return null;
  if (NUMBER_WORDS[match[1]] != null) return NUMBER_WORDS[match[1]];
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

const STOP = new Set(
  'a an the and or to of in on for with me my you your it its this that these those please can could would should i im want add place put make set lets let have drop stick throw include somewhere stage needs into from at is be do does just also both plus mind up hello hi hey thanks there build create'.split(
    ' '
  )
);

export function charGrams(word) {
  if (word.length < 6) return [];
  const grams = [];
  const padded = '^' + word + '$';
  for (let i = 0; i < padded.length - 2; i += 1) grams.push('#' + padded.slice(i, i + 3));
  return grams;
}

export function tokensOf(text) {
  const words = wordsOf(text).filter((word) => !STOP.has(word));
  const tokens = words.slice();
  for (let i = 0; i < words.length - 1; i += 1) tokens.push(words[i] + ' ' + words[i + 1]);
  words.forEach((word) => {
    charGrams(word).forEach((gram) => tokens.push(gram));
  });
  return tokens;
}

export function forward(tokens, model) {
  const out = model.output;
  const raw = model.b.slice();
  const seen = new Set();
  const used = [];
  for (const token of tokens) {
    const bin = model.index.get(token);
    if (bin == null || seen.has(bin)) continue;
    seen.add(bin);
    used.push(bin);
    for (let k = 0; k < out; k += 1) raw[k] += Math.max(0, model.w[bin * out + k]);
  }
  return {
    scores: raw.map((value) => sigmoid(value)),
    bins: used,
  };
}

function tokensForRequest(text, model) {
  const tokens = tokensOf(text);
  const known = model.words || [];
  if (!known.length) return tokens;
  const words = wordsOf(text).filter((word) => !STOP.has(word));
  words.forEach((word) => {
    if (word.length < 6 || known.includes(word)) return;
    const grams = charGrams(word);
    if (grams.length < 4) return;
    let best = null;
    let bestScore = 0;
    for (const candidate of known) {
      if (Math.abs(candidate.length - word.length) > 2) continue;
      const theirs = charGrams(candidate);
      if (!theirs.length) continue;
      let hit = 0;
      for (const gram of theirs) if (grams.includes(gram)) hit += 1;
      const score = hit / theirs.length;
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    if (best && bestScore >= 0.6) tokens.push(best);
  });
  return tokens;
}

export function scoreRequest(text) {
  const model = loadWeights();
  const result = forward(tokensForRequest(text, model), model);
  const named = {};
  LABELS.forEach((label, index) => {
    named[label] = result.scores[index];
  });
  return { scores: named, slots: slotsOf(text), threshold: model.threshold };
}

function sigmoid(x) {
  if (x > 20) return 1;
  if (x < -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function loadWeights() {
  const file = join(dirname(fileURLToPath(import.meta.url)), 'level-ai-weights.json');
  const model = JSON.parse(readFileSync(file, 'utf8'));
  model.index = new Map(model.vocab.map((token, index) => [token, index]));
  model.words = model.vocab.filter((token) => token.length >= 6 && !token.startsWith('#') && !token.includes(' '));
  return model;
}
