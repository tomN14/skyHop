/**
 * Coin shop: each item unlocks one texture filename (file must exist under textures/).
 * Players only see/equip skins they unlocked here or received as a grant (owner gift).
 *
 * Example entry (uncomment after adding the PNG):
 * { id: 'skin_neon', texture: 'neon.png', price: 400, label: 'Neon' },
 */
export const SHOP_ITEMS = [];

/** @param {string} id */
export function getShopItemById(id) {
  return SHOP_ITEMS.find((x) => x.id === id) || null;
}

export function shopTextureSet() {
  return new Set(SHOP_ITEMS.map((x) => x.texture));
}
