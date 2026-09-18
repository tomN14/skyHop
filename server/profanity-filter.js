/**
 * Profanity censor (no auto-ban). Uses word-boundary matching + normalization
 * to reduce false positives (e.g. "class", "assistant"). Optional ML hook via env.
 */

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

/** Whole-word only — extend on server; keep lowercase. */
const BLOCK_WORDS = new Set([
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
  out = collapseRepeats(out);
  return out;
}

/** Detect spaced/obfuscated letters: "f u c k" → fuck */
function squashSpacedLetters(text) {
  return String(text || '').replace(/\b((?:[a-zA-Z0-9]\s+){2,}[a-zA-Z0-9])\b/g, (m) => m.replace(/\s+/g, ''));
}

function stripObfuscation(text) {
  return squashSpacedLetters(String(text || '')).replace(/[*._\-~]/g, '');
}

function prepareForScan(raw) {
  return normalizeToken(stripObfuscation(raw).replace(/\s+/g, ''));
}

function isBlockedWord(normalized) {
  if (!normalized || normalized.length < 3) return false;
  if (BLOCK_WORDS.has(normalized)) return true;
  for (const w of BLOCK_WORDS) {
    if (normalized.length >= w.length + 2 && normalized.includes(w)) {
      const re = new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`);
      if (re.test(` ${normalized} `)) return true;
    }
  }
  return false;
}

/** @param {string} chunk */
export function textContainsProfanity(chunk) {
  const raw = String(chunk || '').trim();
  if (!raw) return false;
  if (isBlockedWord(prepareForScan(raw))) return true;
  const parts = stripObfuscation(raw)
    .split(/[^a-zA-Z0-9@#']+/i)
    .filter(Boolean);
  for (const p of parts) {
    if (isBlockedWord(prepareForScan(p))) return true;
  }
  return false;
}

/**
 * @param {string} text
 * @returns {{ text: string, flagged: boolean }}
 */
export function censorProfanity(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { text: raw, flagged: false };

  if (!textContainsProfanity(raw)) return { text: raw, flagged: false };

  let flagged = false;
  const replaced = raw.replace(/\S+/g, (word) => {
    if (textContainsProfanity(word)) {
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
