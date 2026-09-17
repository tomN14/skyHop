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

function tokenizeForScan(text) {
  const squashed = squashSpacedLetters(text);
  const parts = squashed.split(/[^a-zA-Z0-9']+/).filter(Boolean);
  return parts;
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

/**
 * @param {string} text
 * @returns {{ text: string, flagged: boolean }}
 */
export function censorProfanity(text) {
  const raw = String(text ?? '');
  if (!raw.trim()) return { text: raw, flagged: false };

  let flagged = false;
  const replaced = raw.replace(/[a-zA-Z0-9@#€$+!|()<']+(?:\s+[a-zA-Z0-9@#€$+!|()<']+)*/g, (segment) => {
    const tokens = tokenizeForScan(segment);
    let hit = false;
    for (const t of tokens) {
      const n = normalizeToken(t);
      if (isBlockedWord(n)) {
        hit = true;
        break;
      }
    }
    if (!hit) {
      const whole = normalizeToken(segment.replace(/\s+/g, ''));
      if (isBlockedWord(whole)) hit = true;
    }
    if (hit) {
      flagged = true;
      return '*'.repeat(Math.min(Math.max(segment.length, 3), 24));
    }
    return segment;
  });

  return { text: replaced, flagged };
}
