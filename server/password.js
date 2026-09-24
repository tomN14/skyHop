import crypto from 'crypto';

const PREFIX = 'p1$';

function pepper() {
  const raw = process.env.SKYHOP_PASSWORD_PEPPER;
  const value = raw != null ? String(raw) : '';
  return value.length ? value : '';
}

/** HMAC so the pepper never sits in the database next to the hash. */
function material(password, usePepper) {
  const text = String(password ?? '');
  if (!usePepper) return text;
  return crypto.createHmac('sha256', pepper()).update(text, 'utf8').digest();
}

function scryptHex(password, saltHex, usePepper) {
  return crypto.scryptSync(material(password, usePepper), Buffer.from(String(saltHex || ''), 'hex'), 64).toString('hex');
}

function safeEqualHex(a, b) {
  try {
    const left = Buffer.from(String(a || ''), 'hex');
    const right = Buffer.from(String(b || ''), 'hex');
    if (!left.length || left.length !== right.length) return false;
    return crypto.timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

export function warnIfPasswordPepperMissing() {
  if (!pepper()) {
    console.warn('[Sky Hop] SKYHOP_PASSWORD_PEPPER is not set. Passwords are salted but not peppered.');
  }
}

/** New accounts. Peppered when SKYHOP_PASSWORD_PEPPER is set. */
export function hashNewPassword(password, saltHex) {
  if (!pepper()) return scryptHex(password, saltHex, false);
  return PREFIX + scryptHex(password, saltHex, true);
}

/**
 * Check a stored hash. Legacy (no prefix) hashes still match.
 * When the pepper is set, a successful legacy login returns an upgraded hash to save.
 * @returns {{ ok: boolean, upgrade: string|null }}
 */
export function checkPassword(password, saltHex, storedHash) {
  const stored = String(storedHash || '');
  if (stored.startsWith(PREFIX)) {
    if (!pepper()) return { ok: false, upgrade: null };
    const ok = safeEqualHex(scryptHex(password, saltHex, true), stored.slice(PREFIX.length));
    return { ok, upgrade: null };
  }
  if (!safeEqualHex(scryptHex(password, saltHex, false), stored)) return { ok: false, upgrade: null };
  if (!pepper()) return { ok: true, upgrade: null };
  return { ok: true, upgrade: PREFIX + scryptHex(password, saltHex, true) };
}
