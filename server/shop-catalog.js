/**
 * Bundled coin shop skins (file must exist under textures/).
 * Rarity is assigned from buy price. Owner-added items live in shop_items.json / Supabase.
 * page: 1+, slot: 0–5 (row-major in a 2×3 grid, top-left = 0). Extra pages open as slots fill.
 */
export const SHOP_PAGES = 3;
export const SHOP_SLOTS_PER_PAGE = 6;

export const SHOP_ITEMS = [
  {
    id: 'skin_mango',
    texture: 'mango.png',
    label: 'mango.png',
    price: 150,
    sellPrice: 100,
    page: 1,
    slot: 0,
  },
];

/** @param {string} id */
export function getShopItemById(id) {
  return SHOP_ITEMS.find((x) => x.id === id) || null;
}

export function shopTextureSet() {
  return new Set(SHOP_ITEMS.map((x) => x.texture));
}
