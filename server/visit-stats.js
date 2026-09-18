import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VISITS_PATH = path.join(__dirname, 'data', 'visit_timestamps.json');
/** Keep ~35 days of timestamps for month rollup + buffer. */
const RETENTION_MS = 35 * 24 * 60 * 60 * 1000;

function loadTimestamps() {
  const dir = path.dirname(VISITS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(VISITS_PATH)) return [];
  try {
    const j = JSON.parse(fs.readFileSync(VISITS_PATH, 'utf8'));
    return Array.isArray(j.timestamps) ? j.timestamps.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

function saveTimestamps(list) {
  const dir = path.dirname(VISITS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(VISITS_PATH, JSON.stringify({ timestamps: list }), 'utf8');
}

function prune(list, now) {
  const cutoff = now - RETENTION_MS;
  return list.filter((t) => t >= cutoff);
}

/** Record one site visit (game home page load). */
export async function recordVisit(at = Date.now()) {
  const now = Number(at) || Date.now();
  let list = prune(loadTimestamps(), now);
  list.push(now);
  saveTimestamps(list);
}

/** @param {number} sinceMs */
export async function countVisitsSince(sinceMs) {
  const since = Number(sinceMs) || 0;
  const now = Date.now();
  const list = prune(loadTimestamps(), now);
  saveTimestamps(list);
  return list.filter((t) => t >= since).length;
}
