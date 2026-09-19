import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.join(__dirname, 'world2-default-stages.json');

let cached = null;

/** Bundled default World 2 list (1 stage) when DB / file store has nothing yet. */
export function loadDefaultWorld2Stages() {
  if (cached) return cached;
  try {
    const raw = JSON.parse(fs.readFileSync(DEFAULT_PATH, 'utf8'));
    if (!Array.isArray(raw) || !raw.length) return null;
    cached = raw;
    return cached;
  } catch {
    return null;
  }
}
