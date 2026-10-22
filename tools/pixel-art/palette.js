/**
 * Endesga 32 (EDG32) Palette
 * Author: Ed Blankenship (ENDESGA)
 * License: CC0 / Public Domain
 * Source: https://lospec.com/palette-list/endesga-32
 */

const ENDESGA_32_HEX = [
  '#be4a2f', // 0: Terracotta / rust red
  '#d77643', // 1: Warm copper / wood mid
  '#ead4aa', // 2: Sand / parchment / light skin / paper
  '#e4a672', // 3: Peach / skin mid
  '#b86f50', // 4: Chestnut brown / wood dark / hair
  '#733e39', // 5: Russet / deep wood shadow
  '#3e2731', // 6: Deep mahogany / hair shadow / warm near-black
  '#a22633', // 7: Crimson red / tie
  '#e43b44', // 8: Bright red / alert / tie highlight
  '#f77622', // 9: Vivid orange / soda can / warning
  '#feae34', // 10: Golden amber / folder / sticky note / blonde
  '#fee761', // 11: Lemon yellow / sticky note / glowing light / Zzz
  '#63c74d', // 12: Bright lime green / terminal code / checkmark / leaf
  '#3e8948', // 13: Grass green / plant mid
  '#265c42', // 14: Pine green / deep foliage
  '#193c3e', // 15: Dark teal / cyber dark
  '#124e89', // 16: Deep royal blue / navy suit / screen bezel
  '#0099db', // 17: Sky blue / blue shirt / water
  '#2ce8f5', // 18: Cyan / terminal glow / glasses glare / monitor
  '#ffffff', // 19: Pure white / shirt collar / paper / highlights
  '#c0cbdc', // 20: Light slate silver / metal / whiteboard / wall
  '#8b9bb4', // 21: Cool gray-blue / metal shadow / shelf
  '#5a6988', // 22: Steel gray / chair mesh / dark metal
  '#3a4466', // 23: Deep slate / computer case / dark trousers
  '#262b44', // 24: Midnight navy / suit coat / shadow
  '#181425', // 25: Night / near black outline / darkest shade
  '#ff0044', // 26: Hot pink / neon red
  '#68386c', // 27: Aubergine / deep purple hoodie shadow
  '#b55088', // 28: Orchid purple / hoodie midtone
  '#f6757a', // 29: Coral pink / post-it / blush
  '#e8b796', // 30: Warm peach skin highlight
  '#c28569', // 31: Golden tan / leather / hair mid
];

/**
 * Convert hex string to RGB object
 * @param {string} hex
 * @returns {{ r: number, g: number, b: number }}
 */
function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return { r, g, b };
}

const PALETTE_RGB = ENDESGA_32_HEX.map(hexToRgb);

// Named color indices for convenience
const C = {
  TRANSPARENT: -1,
  RUST: 0,
  COPPER: 1,
  CREAM: 2,
  PEACH: 3,
  CHESTNUT: 4,
  RUSSET: 5,
  DARK_BROWN: 6,
  CRIMSON: 7,
  RED: 8,
  ORANGE: 9,
  GOLD: 10,
  YELLOW: 11,
  LIME: 12,
  GREEN: 13,
  PINE: 14,
  DARK_TEAL: 15,
  ROYAL_BLUE: 16,
  SKY_BLUE: 17,
  CYAN: 18,
  WHITE: 19,
  SILVER: 20,
  COOL_GRAY: 21,
  STEEL: 22,
  DEEP_SLATE: 23,
  MIDNIGHT: 24,
  BLACK: 25,
  HOT_PINK: 26,
  AUBERGINE: 27,
  PURPLE: 28,
  CORAL: 29,
  WARM_PEACH: 30,
  TAN: 31,
};

module.exports = {
  ENDESGA_32_HEX,
  PALETTE_RGB,
  C,
};
