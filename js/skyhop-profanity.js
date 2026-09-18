/**
 * Client-side profanity censor (matches server/profanity-filter.js). Server still re-censors on save.
 */
(function () {
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
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (ch !== prev) out += ch;
      prev = ch;
    }
    return out;
  }

  function normalizeToken(raw) {
    var s = String(raw || '').toLowerCase();
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      out += LEET[ch] != null ? LEET[ch] : ch;
    }
    out = out.replace(/[^a-z0-9']/g, '');
    return collapseRepeats(out);
  }

  function squashSpacedLetters(text) {
    return String(text || '').replace(/\b((?:[a-zA-Z0-9]\s+){2,}[a-zA-Z0-9])\b/g, function (m) {
      return m.replace(/\s+/g, '');
    });
  }

  function tokenizeForScan(text) {
    return squashSpacedLetters(text)
      .split(/[^a-zA-Z0-9']+/)
      .filter(Boolean);
  }

  function isBlockedWord(normalized) {
    if (!normalized || normalized.length < 3) return false;
    if (BLOCK_WORDS.has(normalized)) return true;
    var words = BLOCK_WORDS;
    for (var w of words) {
      if (normalized.length >= w.length + 2 && normalized.indexOf(w) >= 0) {
        var re = new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z]|$)');
        if (re.test(' ' + normalized + ' ')) return true;
      }
    }
    return false;
  }

  function censorProfanity(text) {
    var raw = String(text != null ? text : '');
    if (!raw.trim()) return { text: raw, flagged: false };

    var flagged = false;
    var replaced = raw.replace(/[a-zA-Z0-9@#€$+!|()<']+(?:\s+[a-zA-Z0-9@#€$+!|()<']+)*/g, function (segment) {
      var tokens = tokenizeForScan(segment);
      var hit = false;
      for (var i = 0; i < tokens.length; i++) {
        if (isBlockedWord(normalizeToken(tokens[i]))) {
          hit = true;
          break;
        }
      }
      if (!hit && isBlockedWord(normalizeToken(segment.replace(/\s+/g, '')))) hit = true;
      if (hit) {
        flagged = true;
        return '*'.repeat(Math.min(Math.max(segment.length, 3), 24));
      }
      return segment;
    });

    return { text: replaced, flagged: flagged };
  }

  window.SkyHopCensorProfanity = censorProfanity;
})();
