import { defaultFeatureListHtml, defaultTosPages } from './site-content-defaults.js';

const TOS_PAGE_SEP = '\n<<<SKYHOP_TOS_PAGE>>>\n';

export function joinTosPagesForEditor(pages) {
  return (pages || []).join(TOS_PAGE_SEP);
}

export function splitTosPagesFromEditor(text) {
  const raw = String(text || '');
  if (!raw.trim()) return [];
  return raw.split(TOS_PAGE_SEP).map((s) => s.trim()).filter(Boolean);
}

export function validateTosPages(pages) {
  if (!Array.isArray(pages) || !pages.length) throw new Error('At least one ToS page required.');
  if (pages.length > 24) throw new Error('Too many ToS pages (max 24).');
  for (const p of pages) {
    if (typeof p !== 'string' || !p.trim()) throw new Error('Each ToS page must be non-empty text.');
    if (p.length > 80_000) throw new Error('A ToS page exceeds the size limit.');
  }
}

export function validateFeatureListHtml(html) {
  const s = String(html || '');
  if (!s.trim()) throw new Error('Feature list HTML cannot be empty.');
  if (s.length > 400_000) throw new Error('Feature list is too large.');
}

export async function resolveTosPages(store) {
  if (typeof store.getSiteContentPayload === 'function') {
    const row = await store.getSiteContentPayload('tos');
    if (row && Array.isArray(row.pages) && row.pages.length) return row.pages;
  }
  return defaultTosPages();
}

export async function resolveFeatureListHtml(store) {
  if (typeof store.getSiteContentPayload === 'function') {
    const row = await store.getSiteContentPayload('feature_list');
    if (row && typeof row.html === 'string' && row.html.trim()) return row.html;
  }
  return defaultFeatureListHtml();
}

export const DEFAULT_BRANDING = Object.freeze({
  title: 'Sky Hop',
  version: '3.19',
  updateName: 'The Editor Update',
});

export function defaultBranding() {
  return {
    title: DEFAULT_BRANDING.title,
    version: DEFAULT_BRANDING.version,
    updateName: DEFAULT_BRANDING.updateName,
  };
}

function clipLine(value, max) {
  return String(value ?? '')
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, max);
}

export function validateBranding(raw) {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('branding must be an object');
  }
  const title = clipLine(raw.title, 48);
  const version = clipLine(raw.version, 24);
  const updateName = clipLine(raw.updateName, 80);
  if (!title) throw new Error('title is required');
  if (!version) throw new Error('version is required');
  return { title, version, updateName };
}

export async function resolveBranding(store) {
  try {
    if (typeof store.getSiteContentPayload === 'function') {
      const row = await store.getSiteContentPayload('branding');
      if (row && typeof row === 'object') {
        try {
          return validateBranding(row);
        } catch {
          /* use defaults */
        }
      }
    }
  } catch {
    /* missing table or store */
  }
  return defaultBranding();
}

export { TOS_PAGE_SEP };
