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

const FEATURE_LIST_ROLES_SUPPLEMENT = `
          <p class="mt-3 text-[10px] font-sem uppercase tracking-wider text-violet-300/90">Admins and level coins</p>
          <ul class="mt-1 list-disc space-y-0.5 pl-4">
            <li>Coin pickups inside a user level add to your balance only when that level is awarded. Pickups in other user levels do not count</li>
            <li>Admins: more than one account can be Admin. Moderator powers, plus promote mods and 1-day bans (2 per week)</li>
            <li>Mod Admin: the owner sets hours, or -1 for permanent. Admin powers while active, then they return to their previous role</li>
          </ul>`;

const FEATURE_LIST_GD_SUPPLEMENT = `
          <ul class="mt-1 list-disc space-y-0.5 pl-4">
            <li>Graphic Designer is a separate flag. They add shop items (name, price, sell price, optional credits). Credits show on the shop slot only when filled. Staff roles stay mutually exclusive. Each tier can see its own tier and lower, never a higher one. Graphic Designers see other Graphic Designers</li>
          </ul>`;

const FEATURE_LIST_COPY_SUPPLEMENT = `
          <ul class="mt-1 list-disc space-y-0.5 pl-4">
            <li>Copy a published user level into your drafts. The creator can turn off Allow copies in the editor</li>
          </ul>`;

const FEATURE_LIST_SHOP_SUPPLEMENT = `
          <ul class="mt-1 list-disc space-y-0.5 pl-4">
            <li>Buying a shop skin sends 45% of the price, rounded up, to the creator named on that skin. The rest goes to the Sky Hop National Bank. Each newly unlocked achievement pays 75 coins</li>
          </ul>`;

const FEATURE_LIST_FINANCIAL = `
          <p class="mt-3 text-[10px] font-sem uppercase tracking-wider text-violet-300/90">Financial systems</p>
          <ul class="mt-1 list-disc space-y-0.5 pl-4">
            <li>Registering a company costs 1,000 coins, and you can own more than one. A new company opens at a random price from $0.00 to $1.00. The briefcase registers a company, edits the ones you already own, and can move coins from your balance into that company</li>
            <li>A racing company can host multiple tournaments at once. Each has its own entry fee, prize, description, and start time. Entry closes after the start</li>
            <li>Banks hold deposits and loans. A National Bank account holds at most 10,000,000 coins, and one player can open 5. A private bank sets its own cap from 1,000,000 to 50,000,000 and how many accounts one player can open, from 1 to 15. Insurers cover market losses. Search either list by name or ticker</li>
            <li>A public company has 1,000 shares and a ticker. You can buy, sell, short, and cover. A limit price waits until the market reaches it. Prices move every 6 hours</li>
            <li>A profitable week pays 2% of company cash, split by the shares you own, and always leaves at least 1 coin of that profit in the company. A short owes the same amount per share</li>
            <li>An 8% weekly tax funds the Sky Hop National Bank. The owner sets its deposit and loan rates from Account administration. They start at 1.2% on savings and 14.32% on loans. SHNB is the button above the level script guide. It has 7 billion shares, 2 billion listed, and opened at $135.52</li>
            <li>Sky Hop scores go from 300 to 850 and follow payments, debt, history, recent loans, and saving. The score is on the bank screen, on SHNB, in Account, and on the mod dashboard</li>
            <li>A company under −500 coins of weekly profit is closed. Deleting a company makes its shares worthless. Bank heists are rare, and a failure is a 1-day ban</li>
          </ul>`;

const OLD_FINANCIAL_LI = [
  'Companies cost 1,000 coins',
  'several tournaments',
  'Stocks are searched by name or ticker',
  'You can register more than one company',
  'Sky Hop scores run from 300',
  'Private banks',
  'limit order',
  'Shareholders can sell',
  'pays shareholders 2%',
];

function stripOldFinancialBullets(html) {
  let out = String(html || '');
  for (const marker of OLD_FINANCIAL_LI) {
    const re = new RegExp('<li>[^<]*' + marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^<]*</li>', 'g');
    out = out.replace(re, '');
  }
  return out.replace(/<ul class="mt-1 list-disc space-y-0\.5 pl-4">\s*<\/ul>/g, '');
}

function withFinancialSection(html) {
  const oldDividend = 'A profitable week pays shareholders 2% of company cash, and never more than that profit. A short position owes the same dividend';
  const nextDividend = 'A profitable week pays 2% of company cash, split by the shares you own, and always leaves at least 1 coin of that profit in the company. A short owes the same amount per share';
  let htmlNext = String(html || '');
  if (htmlNext.includes(oldDividend)) htmlNext = htmlNext.split(oldDividend).join(nextDividend);
  const oldFund = 'The briefcase registers a company and edits the ones you already own';
  const nextFund = 'The briefcase registers a company, edits the ones you already own, and can move coins from your balance into that company';
  if (htmlNext.includes(oldFund)) htmlNext = htmlNext.split(oldFund).join(nextFund);
  const oldRates = 'It lends at 14.32% and pays 1.2% on savings.';
  const nextRates = 'The owner sets its deposit and loan rates from Account administration. They start at 1.2% on savings and 14.32% on loans.';
  if (htmlNext.includes(oldRates)) htmlNext = htmlNext.split(oldRates).join(nextRates);
  const oldBanks = 'Banks hold deposits and loans. Insurers cover market losses.';
  const nextBanks = 'Banks hold deposits and loans. A National Bank account holds at most 10,000,000 coins, and one player can open 5. A private bank sets its own cap from 1,000,000 to 50,000,000 and how many accounts one player can open, from 1 to 15. Insurers cover market losses.';
  if (htmlNext.includes(oldBanks)) htmlNext = htmlNext.split(oldBanks).join(nextBanks);
  if (htmlNext.includes('Financial systems')) return htmlNext;
  const out = stripOldFinancialBullets(htmlNext);
  const heading = 'Economy &amp; cosmetics</p>';
  const at = out.indexOf(heading);
  if (at === -1) return out + FEATURE_LIST_FINANCIAL;
  const start = out.lastIndexOf('<p', at);
  return out.slice(0, start) + FEATURE_LIST_FINANCIAL.trim() + '\n          ' + out.slice(start);
}

export async function resolveFeatureListHtml(store) {
  if (typeof store.getSiteContentPayload === 'function') {
    const row = await store.getSiteContentPayload('feature_list');
    if (row && typeof row.html === 'string' && row.html.trim()) {
      let html = row.html;
      if (!html.includes('Awarded User Levels')) html += FEATURE_LIST_SUPPLEMENT;
      if (!html.includes('Mod Admin')) html += FEATURE_LIST_ROLES_SUPPLEMENT;
      if (!html.includes('Allow copies')) html += FEATURE_LIST_COPY_SUPPLEMENT;
      if (!html.includes('Graphic Designer')) html += FEATURE_LIST_GD_SUPPLEMENT;
      if (!html.includes('45%')) html += FEATURE_LIST_SHOP_SUPPLEMENT;
      return withFinancialSection(html);
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

const COUNTER_DISPLAY_NOTE = `
          <div>
            <p class="text-[10px] font-sem uppercase tracking-wider text-fuchsia-300/90">Counter numbers</p>
            <ul class="mt-1 list-disc space-y-0.5 pl-4">
              <li>A counter can show a negative, a decimal, or a simple fraction such as 1/2 or -3/2.</li>
            </ul>
          </div>`;

export async function resolveScriptGuideHtml(store) {
  if (typeof store.getSiteContentPayload === 'function') {
    const row = await store.getSiteContentPayload('script_guide');
    if (row && typeof row.html === 'string' && row.html.trim()) {
      let html = row.html;
      if (!html.includes('skyhop.hazard')) html += SCRIPT_GUIDE_SUPPLEMENT;
      if (!html.includes('simple fraction')) html += COUNTER_DISPLAY_NOTE;
      return html;
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
