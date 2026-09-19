import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS_DIR = path.join(__dirname, 'defaults');

export function defaultTosPages() {
  const p = path.join(DEFAULTS_DIR, 'tos-pages.json');
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function defaultFeatureListHtml() {
  const p = path.join(DEFAULTS_DIR, 'feature-list.html');
  return fs.readFileSync(p, 'utf8');
}
