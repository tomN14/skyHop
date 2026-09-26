import { defaultFeatureListHtml, defaultScriptGuideHtml, defaultTosPages } from './site-content-defaults.js';

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

export function validateScriptGuideHtml(html) {
  const s = String(html || '');
  if (!s.trim()) throw new Error('Level script guide HTML cannot be empty.');
  if (s.length > 400_000) throw new Error('Level script guide is too large.');
}

export async function resolveTosPages(store) {
  if (typeof store.getSiteContentPayload === 'function') {
    const row = await store.getSiteContentPayload('tos');
    if (row && Array.isArray(row.pages) && row.pages.length) return row.pages;
  }
  return defaultTosPages();
}

const FEATURE_LIST_SUPPLEMENT = `
          <p class="mt-3 text-[10px] font-sem uppercase tracking-wider text-violet-300/90">Awarded levels &amp; scripts</p>
          <ul class="mt-1 list-disc space-y-0.5 pl-4">
            <li>Awarded User Levels on the main menu, under Play and Racing. The owner awards a published level from Online Levels with the red Award button. The creator receives 300 coins once. A signed-in player receives 25 coins the first time they clear it, and nothing if they clear it again. Awarded level names are blue when you search that creator</li>
            <li>Race and Collab any user level from My Levels, Online Levels, or the editor. Each player’s script sees that player</li>
            <li>One script id can be shared by many objects. Rotate, move, color, and toggle apply to every match. Counters, jump-limit changes, double-jump and collision reads, stage time, run time, death count, and player position are available. skyhop.kill can kill you, a named player, or the closest or farthest player</li>
            <li>The level script guide is the script button on the main menu, above custom keybinds. The owner can edit that guide from Account administration</li>
          </ul>`;

export async function resolveFeatureListHtml(store) {
  if (typeof store.getSiteContentPayload === 'function') {
    const row = await store.getSiteContentPayload('feature_list');
    if (row && typeof row.html === 'string' && row.html.trim()) {
      if (row.html.includes('Awarded User Levels')) return row.html;
      return row.html + FEATURE_LIST_SUPPLEMENT;
    }
  }
  return defaultFeatureListHtml();
}

const SCRIPT_GUIDE_SUPPLEMENT = `
          <div>
            <p class="text-[10px] font-sem uppercase tracking-wider text-fuchsia-300/90">Hazard, walls, and wait</p>
            <ul class="mt-1 list-disc space-y-0.5 pl-4">
              <li><span class="font-mono">skyhop.hazard(id)</span> makes every object with that id lethal. Touching that platform or moving platform kills the player. <span class="font-mono">skyhop.safe(id)</span> removes that.</li>
              <li><span class="font-mono">skyhop.disable_wall_jump(id)</span> makes every wall with that id refuse a wall jump.</li>
              <li>In the editor, select an object and use Hazardous or No wall jump. Those stay on the object without a script.</li>
              <li><span class="font-mono">skyhop.wait(n)</span> pauses the script for n seconds, then the next line runs. Put it in <span class="font-mono">test.while</span>.</li>
              <li><span class="font-mono">math.floor(n)</span> and <span class="font-mono">math.ceil(n)</span> return a whole number. No extra use line.</li>
            </ul>
          </div>`;

export async function resolveScriptGuideHtml(store) {
  if (typeof store.getSiteContentPayload === 'function') {
    const row = await store.getSiteContentPayload('script_guide');
    if (row && typeof row.html === 'string' && row.html.trim()) {
      if (row.html.includes('skyhop.hazard')) return row.html;
      return row.html + SCRIPT_GUIDE_SUPPLEMENT;
    }
  }
  return defaultScriptGuideHtml();
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
