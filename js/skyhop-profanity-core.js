/**
 * Shared profanity censor (browser + server). Rule-based + tiny trained neural net.
 */
import nnWeights from './profanity-nn-weights.json' with { type: 'json' };

const LEET = {
  '@': 'a',
  '4': 'a',
  '8': 'b',
  '(': 'c',
  '<': 'c',
  '3': 'e',
  '€': 'e',
  '6': 'g',
  '9': 'g',
  '#': 'h',
  '1': 'i',
  '!': 'i',
  '|': 'l',
  '0': 'o',
  '5': 's',
  '$': 's',
  '7': 't',
  '+': 't',
  '2': 'z',
};

/** Longer innocent words — allow live typing prefixes (e.g. ass → assume). */
const SAFE_TYPING_WORDS = [
  'assume',
  'assumed',
  'assumes',
  'assuming',
  'assu',
  'assistant',
  'assembly',
  'assault',
  'asset',
  'assets',
  'assign',
  'assigned',
  'association',
  'pass',
  'passage',
  'passenger',
  'classic',
  'bass',
  'mass',
  'massive',
  'grass',
  'glass',
  'brass',
  'compass',
  'success',
  'address',
  'passion',
  'passive',
  'gravity',
  'gravitation',
  'gravel',
  'grave',
  'gravy',
  'grape',
  'graph',
  'graphic',
  'grab',
  'grand',
  'grateful',
  'spike',
  'spikes',
];

const BLOCK_WORDS = new Set([
  'ass',
  'asshole',
  'bastard',
  'bitch',
  'bullshit',
  'cock',
  'crap',
  'cunt',
  'damn',
  'dick',
  'fag',
  'faggot',
  'fuck',
  'fucker',
  'fucking',
  'motherfucker',
  'nigger',
  'nigga',
  'piss',
  'pussy',
  'shit',
  'slut',
  'twat',
  'whore',
]);

const NN_THRESHOLD = nnWeights.threshold ?? 0.72;
const NN_W1 = new Float32Array(nnWeights.W1);
const NN_B1 = new Float32Array(nnWeights.b1);
const NN_W2 = new Float32Array(nnWeights.W2);
const NN_B2 = nnWeights.b2;
const NN_IN = nnWeights.in;
const NN_HID = nnWeights.hid;

function collapseRepeats(s) {
  let out = '';
  let prev = '';
  for (const ch of s) {
    if (ch !== prev) out += ch;
    prev = ch;
  }
  return out;
}

function normalizeToken(raw) {
  let s = String(raw || '').toLowerCase();
  let out = '';
  for (const ch of s) {
    out += LEET[ch] != null ? LEET[ch] : ch;
  }
  out = out.replace(/[^a-z0-9']/g, '');
  return out;
}

function squashSpacedLetters(text) {
  return String(text || '').replace(/\b((?:[a-zA-Z0-9]\s+){2,}[a-zA-Z0-9])\b/g, (m) => m.replace(/\s+/g, ''));
}

function stripObfuscation(text) {
  return squashSpacedLetters(String(text || '')).replace(/[*._\-~]/g, '');
}

function prepareForScan(raw) {
  return normalizeToken(stripObfuscation(raw).replace(/\s+/g, ''));
}

function isSubsequence(word, token) {
  let j = 0;
  for (let i = 0; i < token.length && j < word.length; i++) {
    if (token[i] === word[j]) j++;
  }
  return j === word.length;
}

function isBlockedWord(normalized) {
  if (!normalized || normalized.length < 3) return false;
  const variants = [normalized];
  const collapsed = collapseRepeats(normalized);
  if (collapsed !== normalized) variants.push(collapsed);
  for (const n of variants) {
    if (BLOCK_WORDS.has(n)) return true;
  }
  for (const n of variants) {
    for (const w of BLOCK_WORDS) {
      if (n.length >= w.length + 2 && n.includes(w)) {
        const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
        if (re.test(` ${n} `)) return true;
      }
    }
  }
  return false;
}

function obfuscationMaskRegex(compact) {
  let pattern = '^';
  let len = 0;
  for (const ch of String(compact).toLowerCase()) {
    if (/[*._\-~]/.test(ch)) {
      pattern += '.';
      len += 1;
    } else {
      const n = LEET[ch] != null ? LEET[ch] : ch;
      if (!/[a-z0-9]/.test(n)) return null;
      pattern += n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      len += 1;
    }
  }
  return { pattern: `${pattern}$`, len };
}

function maskedAfterPrefixProfane(compact) {
  for (let i = 1; i < compact.length - 1; i++) {
    const rest = compact.slice(i);
    if (!/[*._\-~]/.test(rest)) continue;
    const built = obfuscationMaskRegex(rest);
    if (!built) continue;
    const re = new RegExp(built.pattern, 'i');
    for (const w of BLOCK_WORDS) {
      if (w.length === built.len && re.test(w)) return true;
    }
  }
  return false;
}

/** fi + uck, extra inserted letters, etc. */
function fuzzySubsequenceProfane(lettersOnly) {
  if (!lettersOnly || lettersOnly.length < 4) return false;
  for (const w of BLOCK_WORDS) {
    if (w.length < 4) continue;
    if (lettersOnly.startsWith(w) && lettersOnly.length > w.length) continue;
    if (!isSubsequence(w, lettersOnly)) continue;
    if (lettersOnly.length > w.length + 2) continue;
    if (lettersOnly.length >= w.length) return true;
    const tail3 = w.slice(-3);
    if (lettersOnly.endsWith(tail3) && lettersOnly[0] === w[0]) return true;
  }
  return false;
}

function neuralFeaturize(token) {
  const s = String(token || '').toLowerCase();
  const f = new Float32Array(NN_IN);
  let len = 0;
  let stars = 0;
  const stripped = s.replace(/\*/g, '');
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
  for (const w of BLOCK_WORDS) {
    let j = 0;
    for (let i = 0; i < stripped.length && j < w.length; i++) {
      if (stripped[i] === w[j]) j++;
    }
    bestSub = Math.max(bestSub, j / w.length);
  }
  f[28] = bestSub;
  f[29] = len > 0 && stripped[0] === 'f' ? 1 : 0;
  f[30] = s.includes('*') ? 1 : 0;
  f[31] = len >= 4 && stripped.slice(-3) === 'uck' ? 1 : 0;
  return f;
}

function isInnocentTypingPrefix(lettersOnly) {
  if (!lettersOnly) return true;
  for (const safe of SAFE_TYPING_WORDS) {
    if (safe === lettersOnly) return true;
    if (safe.startsWith(lettersOnly) && lettersOnly.length < safe.length) return true;
  }
  return false;
}

/** Stars, leet digits, or 3+ repeated letters (fuuuck) — not ordinary words like arrow. */
function tokenLooksObfuscated(compact, lettersOnly) {
  if (!compact) return false;
  if (/[*._\-~]/.test(compact)) return true;
  if (lettersOnly) {
    let run = 1;
    for (let i = 1; i < lettersOnly.length; i++) {
      if (lettersOnly[i] === lettersOnly[i - 1]) {
        run += 1;
        if (run >= 3) return true;
      } else run = 1;
    }
  }
  for (const ch of compact) {
    const mapped = LEET[ch];
    if (mapped != null && mapped !== ch.toLowerCase()) return true;
  }
  return false;
}

function isMaskOnlyToken(compact) {
  return /^[*._\-~]+$/.test(compact);
}

function neuralProfaneScore(token) {
  const x = neuralFeaturize(token);
  const h = new Float32Array(NN_HID);
  for (let j = 0; j < NN_HID; j++) {
    let sum = NN_B1[j];
    for (let i = 0; i < NN_IN; i++) sum += x[i] * NN_W1[i * NN_HID + j];
    h[j] = sum > 0 ? sum : 0;
  }
  let o = NN_B2;
  for (let j = 0; j < NN_HID; j++) o += h[j] * NN_W2[j];
  return 1 / (1 + Math.exp(-o));
}

function tokenProfane(token, strict) {
  const compact = String(token || '').trim().replace(/\s/g, '');
  if (!compact) return false;
  if (isMaskOnlyToken(compact)) return false;

  const lettersOnly = normalizeToken(compact.replace(/[*._\-~]/g, ''));
  const hasMask = /[*._\-~]/.test(compact);

  if (!strict) {
    if (lettersOnly.length < 3 && !hasMask) return false;
    if (!hasMask && isInnocentTypingPrefix(lettersOnly)) return false;
  }

  const m = /^([a-zA-Z0-9@#€$+!|]+)([*._\-~]*)$/i.exec(compact);
  if (m) {
    const normLetters = normalizeToken(m[1]);
    const obfSuffix = m[2];

    for (const w of BLOCK_WORDS) {
      if (normLetters === w) {
        if (!strict && isInnocentTypingPrefix(normLetters)) continue;
        return true;
      }
      if (normLetters.length > w.length && normLetters.startsWith(w)) continue;
      if (
        obfSuffix.length > 0 &&
        normLetters.length >= 2 &&
        normLetters.length < w.length &&
        w.startsWith(normLetters)
      ) {
        return true;
      }
    }
  }

  if (hasMask) {
    const built = obfuscationMaskRegex(compact);
    if (built) {
      const re = new RegExp(built.pattern, 'i');
      for (const w of BLOCK_WORDS) {
        if (w.length === built.len && re.test(w)) return true;
      }
    }
    if (maskedAfterPrefixProfane(compact)) return true;
  }

  if (fuzzySubsequenceProfane(lettersOnly)) return true;

  if (
    tokenLooksObfuscated(compact, lettersOnly) &&
    lettersOnly.length >= 4 &&
    neuralProfaneScore(compact) >= NN_THRESHOLD
  ) {
    return true;
  }

  if (!strict) return false;
  if (isBlockedWord(prepareForScan(compact))) return true;
  const parts = stripObfuscation(compact)
    .split(/[^a-zA-Z0-9@#']+/i)
    .filter(Boolean);
  for (const p of parts) {
    if (isBlockedWord(prepareForScan(p))) return true;
  }
  return false;
}

export function textContainsProfanity(chunk, opts) {
  const strict = !opts || opts.strict !== false;
  const raw = String(chunk || '').trim();
  if (!raw) return false;
  for (const word of raw.split(/\s+/).filter(Boolean)) {
    if (tokenProfane(word, strict)) return true;
  }
  if (!strict) return false;
  if (isBlockedWord(prepareForScan(raw))) return true;
  const parts = stripObfuscation(raw)
    .split(/[^a-zA-Z0-9@#']+/i)
    .filter(Boolean);
  for (const p of parts) {
    if (isBlockedWord(prepareForScan(p))) return true;
  }
  return false;
}

export function censorProfanity(text, opts) {
  const strict = !opts || opts.strict !== false;
  const raw = String(text ?? '');
  if (!raw.trim()) return { text: raw, flagged: false };

  if (!textContainsProfanity(raw, opts)) return { text: raw, flagged: false };

  let flagged = false;
  const replaced = raw.replace(/\S+/g, (word) => {
    if (tokenProfane(word, strict)) {
      flagged = true;
      return '*'.repeat(Math.min(Math.max(word.length, 3), 24));
    }
    return word;
  });

  if (!flagged) {
    flagged = true;
    const masked = '*'.repeat(Math.min(Math.max(raw.trim().length, 3), 48));
    return { text: masked, flagged: true };
  }

  return { text: replaced, flagged: true };
}
