const { C } = require('./palette');
const { PixelGrid } = require('./grid');

const CHARACTERS = {
  claude: {
    id: 'claude',
    name: 'Claude',
    role: 'CEO / Lead Architect',
    skinLight: C.CREAM,
    skinMid: C.PEACH,
    skinShadow: C.CHESTNUT,
    hairColor: C.COOL_GRAY,
    hairHighlight: C.SILVER,
    hairShadow: C.STEEL,
    suitColor: C.MIDNIGHT,
    suitHighlight: C.ROYAL_BLUE,
    suitShadow: C.BLACK,
    shirtColor: C.WHITE,
    shirtShadow: C.SILVER,
    tieColor: C.RED,
    tieShadow: C.CRIMSON,
    pantsColor: C.MIDNIGHT,
    pantsCrease: C.ROYAL_BLUE,
    pantsShadow: C.BLACK,
    shoesColor: C.BLACK,
    shoesHighlight: C.DEEP_SLATE,
    hasBeard: true,
    beardColor: C.COOL_GRAY,
    beardHighlight: C.SILVER,
    beardShadow: C.STEEL,
    hasGlasses: false,
    nightcapColor: C.ROYAL_BLUE,
    nightcapAccent: C.WHITE,
    type: 'suit',
  },
  agy: {
    id: 'agy',
    name: 'agy',
    role: 'Core Developer',
    skinLight: C.WARM_PEACH,
    skinMid: C.PEACH,
    skinShadow: C.CHESTNUT,
    hairColor: C.BLACK,
    hairHighlight: C.DARK_BROWN,
    hairShadow: C.BLACK,
    hoodieColor: C.PURPLE,
    hoodieHighlight: C.CORAL,
    hoodieShadow: C.AUBERGINE,
    stringsColor: C.WHITE,
    stringsShadow: C.SILVER,
    pantsColor: C.DEEP_SLATE,
    pantsCrease: C.STEEL,
    pantsShadow: C.BLACK,
    shoesColor: C.WHITE,
    shoesAccent: C.SILVER,
    shoesSole: C.BLACK,
    hasBeard: false,
    hasGlasses: false,
    nightcapColor: C.PURPLE,
    nightcapAccent: C.WHITE,
    type: 'hoodie',
  },
  codex: {
    id: 'codex',
    name: 'codex',
    role: 'Algorithm Specialist / Reviewer',
    skinLight: C.CREAM,
    skinMid: C.PEACH,
    skinShadow: C.CHESTNUT,
    hairColor: C.BLACK,
    hairHighlight: C.DEEP_SLATE,
    hairShadow: C.BLACK,
    coatColor: C.DEEP_SLATE,
    coatHighlight: C.STEEL,
    coatShadow: C.BLACK,
    shirtColor: C.BLACK,
    pantsColor: C.BLACK,
    pantsCrease: C.DEEP_SLATE,
    pantsShadow: C.BLACK,
    shoesColor: C.DARK_TEAL,
    shoesAccent: C.CYAN,
    hasBeard: false,
    hasGlasses: true,
    glassesColor: C.CYAN,
    glassesGlare: C.WHITE,
    terminalGlow: C.LIME,
    nightcapColor: C.DARK_TEAL,
    nightcapAccent: C.CYAN,
    type: 'tech',
  },
};

/**
 * Draw base ground shadow
 */
function drawShadow(grid, cx = 64, cy = 116, rx = 28, ry = 7) {
  grid.fillEllipse(cx, cy, rx, ry, C.BLACK);
  // Outer soft dither
  for (let dy = -ry - 1; dy <= ry + 1; dy++) {
    const w = Math.round(
      (rx + 3) * Math.sqrt(Math.max(0, 1 - (dy * dy) / ((ry + 2) * (ry + 2)))),
    );
    for (let dx = -w; dx <= w; dx++) {
      if ((dx + dy) % 2 === 0 && grid.get(cx + dx, cy + dy) === C.TRANSPARENT) {
        grid.set(cx + dx, cy + dy, C.MIDNIGHT);
      }
    }
  }
}

/**
 * Draw front-facing head in 128x128
 */
function drawHeadFront(
  grid,
  char,
  { yOffset = 0, eyeState = 'open', looking = 'front' } = {},
) {
  const y = 22 + yOffset;
  const cx = 64;

  // Neck
  grid.fillRect(cx - 8, y + 28, 16, 8, char.skinShadow);
  grid.fillRect(cx - 6, y + 29, 12, 7, char.skinMid);

  // Ears
  grid.fillRoundedRect(cx - 22, y + 14, 5, 12, 2, char.skinMid);
  grid.set(cx - 20, y + 18, char.skinShadow);
  grid.set(cx - 20, y + 19, char.skinShadow);
  grid.fillRoundedRect(cx + 18, y + 14, 5, 12, 2, char.skinMid);
  grid.set(cx + 20, y + 18, char.skinShadow);
  grid.set(cx + 20, y + 19, char.skinShadow);

  // Face base flesh
  grid.fillRoundedRect(cx - 18, y + 6, 36, 28, 6, char.skinMid);
  grid.fillRoundedRect(cx - 16, y + 8, 32, 23, 5, char.skinLight);
  // Cheek / jaw contour shadow
  grid.drawLine(cx - 16, y + 28, cx - 8, y + 34, char.skinShadow);
  grid.drawLine(cx + 16, y + 28, cx + 8, y + 34, char.skinShadow);
  grid.drawHLine(cx - 7, y + 34, 15, char.skinShadow);

  // Hair Base (Back & crown)
  grid.fillRoundedRect(cx - 22, y - 6, 44, 22, 8, char.hairColor);
  grid.fillRect(cx - 23, y + 4, 6, 16, char.hairColor);
  grid.fillRect(cx + 18, y + 4, 6, 16, char.hairColor);

  // Hair Highlights & Strands
  grid.drawHLine(cx - 16, y - 5, 32, char.hairHighlight);
  grid.drawHLine(cx - 18, y - 3, 36, char.hairHighlight);
  grid.drawLine(cx - 18, y - 1, cx - 10, y + 4, char.hairHighlight);
  grid.drawLine(cx + 6, y - 2, cx + 16, y + 3, char.hairShadow);

  if (char.id === 'claude') {
    // Distinguished side part, salt & pepper hair volume
    grid.fillRoundedRect(cx - 23, y - 8, 46, 18, 6, char.hairColor);
    grid.drawHLine(cx - 18, y - 7, 34, char.hairHighlight);
    grid.drawHLine(cx - 20, y - 6, 38, char.hairHighlight);
    // Part line
    grid.drawLine(cx - 8, y - 7, cx - 6, y + 2, char.hairShadow);
    // Forehead hair sweep
    grid.fillRoundedRect(cx - 18, y - 1, 14, 8, 3, char.hairColor);
    grid.fillRoundedRect(cx - 4, y - 2, 22, 9, 3, char.hairColor);
    grid.drawHLine(cx - 3, y + 1, 18, char.hairHighlight);
    // Salt-and-pepper flecks
    grid.set(cx - 14, y + 8, char.hairHighlight);
    grid.set(cx + 14, y + 8, char.hairHighlight);
    grid.set(cx - 19, y + 12, char.hairHighlight);
    grid.set(cx + 19, y + 12, char.hairHighlight);
    grid.set(cx - 20, y + 16, char.hairColor);
    grid.set(cx + 20, y + 16, char.hairColor);
  } else if (char.id === 'agy') {
    // Wild spiky developer fringe / bangs
    grid.fillRoundedRect(cx - 24, y - 8, 48, 16, 5, char.hairColor);
    // Bangs dropping over forehead
    grid.fillRect(cx - 16, y + 4, 6, 9, char.hairColor);
    grid.set(cx - 14, y + 13, char.hairColor);
    grid.fillRect(cx - 8, y + 4, 7, 11, char.hairColor);
    grid.set(cx - 6, y + 15, char.hairColor);
    grid.fillRect(cx + 2, y + 4, 7, 10, char.hairColor);
    grid.set(cx + 4, y + 14, char.hairColor);
    grid.fillRect(cx + 11, y + 4, 6, 8, char.hairColor);
    // Warm hair shine highlights
    grid.drawHLine(cx - 16, y - 5, 12, char.hairHighlight);
    grid.drawHLine(cx + 2, y - 5, 14, char.hairHighlight);
    grid.set(cx - 7, y + 8, char.hairHighlight);
    grid.set(cx + 4, y + 8, char.hairHighlight);
  } else if (char.id === 'codex') {
    // Clean-cut tech styling with angled sheen
    grid.fillRoundedRect(cx - 22, y - 7, 44, 16, 5, char.hairColor);
    grid.drawHLine(cx - 16, y - 6, 32, char.hairHighlight);
    grid.drawLine(cx - 18, y - 3, cx + 18, y - 3, char.hairHighlight);
    grid.fillRect(cx - 18, y + 3, 36, 4, char.hairColor);
    grid.fillRect(cx - 6, y + 7, 12, 3, char.hairColor);
  }

  // Eyebrows
  const browY = y + 12;
  grid.fillRect(cx - 15, browY, 9, 2, char.hairShadow);
  grid.fillRect(cx + 6, browY, 9, 2, char.hairShadow);
  if (char.id === 'claude') {
    grid.drawHLine(cx - 14, browY - 1, 8, char.hairColor);
    grid.drawHLine(cx + 7, browY - 1, 8, char.hairColor);
  }

  // Eyes
  const eyeY = y + 16;
  if (eyeState === 'blink' || eyeState === 'sleep') {
    // Eyelid line with lashes
    grid.drawHLine(cx - 15, eyeY + 2, 9, C.BLACK);
    grid.drawHLine(cx + 6, eyeY + 2, 9, C.BLACK);
    grid.drawHLine(cx - 14, eyeY + 3, 7, char.skinShadow);
    grid.drawHLine(cx + 7, eyeY + 3, 7, char.skinShadow);
  } else {
    // Left eye
    grid.fillRect(cx - 15, eyeY, 9, 6, C.WHITE);
    grid.fillRect(cx - 13, eyeY, 5, 6, C.BLACK);
    grid.set(cx - 12, eyeY + 1, C.WHITE); // shine
    grid.set(
      cx - 11,
      eyeY + 3,
      char.id === 'codex'
        ? C.CYAN
        : char.id === 'agy'
          ? C.CHESTNUT
          : C.ROYAL_BLUE,
    );
    grid.drawHLine(cx - 15, eyeY - 1, 9, char.skinShadow); // lid crease

    // Right eye
    grid.fillRect(cx + 6, eyeY, 9, 6, C.WHITE);
    grid.fillRect(cx + 8, eyeY, 5, 6, C.BLACK);
    grid.set(cx + 9, eyeY + 1, C.WHITE); // shine
    grid.set(
      cx + 10,
      eyeY + 3,
      char.id === 'codex'
        ? C.CYAN
        : char.id === 'agy'
          ? C.CHESTNUT
          : C.ROYAL_BLUE,
    );
    grid.drawHLine(cx + 6, eyeY - 1, 9, char.skinShadow); // lid crease
  }

  // Glasses for Codex
  if (char.hasGlasses) {
    const gy = eyeY - 2;
    // Frame stroke
    grid.strokeRect(cx - 17, gy, 13, 10, char.glassesColor);
    grid.strokeRect(cx + 4, gy, 13, 10, char.glassesColor);
    // Bridge & temple arms
    grid.drawHLine(cx - 4, gy + 3, 8, char.glassesColor);
    grid.drawHLine(cx - 22, gy + 3, 6, char.glassesColor);
    grid.drawHLine(cx + 16, gy + 3, 6, char.glassesColor);
    // Glass Glare
    if (eyeState === 'open') {
      grid.drawLine(cx - 15, gy + 2, cx - 11, gy + 7, char.glassesGlare);
      grid.drawLine(cx + 6, gy + 2, cx + 10, gy + 7, char.glassesGlare);
    }
  }

  // Nose
  grid.fillRect(cx - 2, y + 20, 4, 5, char.skinMid);
  grid.set(cx - 1, y + 21, char.skinLight);
  grid.set(cx, y + 24, char.skinShadow);
  grid.set(cx - 2, y + 24, char.skinShadow);
  grid.set(cx + 1, y + 24, char.skinShadow);

  // Beard or Mouth
  if (char.hasBeard) {
    // Claude mustache & sculpted salt-pepper beard
    // Mustache
    grid.fillRoundedRect(cx - 10, y + 25, 20, 5, 2, char.beardColor);
    grid.drawHLine(cx - 8, y + 26, 16, char.beardHighlight);
    grid.drawHLine(cx - 6, y + 29, 12, char.beardShadow);
    // Chin & jaw beard
    grid.fillRect(cx - 14, y + 28, 6, 8, char.beardColor);
    grid.fillRect(cx + 8, y + 28, 6, 8, char.beardColor);
    grid.fillRoundedRect(cx - 10, y + 30, 20, 8, 3, char.beardColor);
    grid.drawHLine(cx - 8, y + 34, 16, char.beardHighlight);
    grid.drawHLine(cx - 6, y + 36, 12, char.beardShadow);
  } else {
    // Youthful / tech mouth line
    grid.fillRect(cx - 5, y + 28, 10, 2, char.skinShadow);
    grid.set(cx - 3, y + 27, char.skinMid);
    grid.set(cx + 2, y + 27, char.skinMid);
    grid.drawHLine(cx - 3, y + 30, 6, char.skinShadow);
  }
}

/**
 * Draw front-facing torso in 128x128
 */
function drawTorsoFront(grid, char, { yOffset = 0, pose = 'stand' } = {}) {
  const y = 56 + yOffset;
  const cx = 64;

  const mainColor = char.suitColor || char.hoodieColor || char.coatColor;
  const highColor =
    char.suitHighlight || char.hoodieHighlight || char.coatHighlight;
  const shadColor = char.suitShadow || char.hoodieShadow || char.coatShadow;

  if (char.type === 'suit') {
    // Claude Midnight Suit
    // Shoulders & Body
    grid.fillRoundedRect(cx - 22, y, 44, 32, 4, char.suitColor);
    grid.drawHLine(cx - 20, y, 40, char.suitHighlight);
    grid.drawHLine(cx - 21, y + 1, 42, char.suitHighlight);

    // White Shirt V-Neck & Collar
    grid.fillRect(cx - 8, y, 16, 6, char.shirtColor);
    grid.fillRoundedRect(cx - 6, y + 4, 12, 14, 2, char.shirtColor);
    // Collar points
    grid.drawLine(cx - 9, y, cx - 4, y + 7, char.shirtShadow);
    grid.drawLine(cx + 9, y, cx + 4, y + 7, char.shirtShadow);

    // Red Silk Necktie
    grid.fillRect(cx - 3, y + 5, 6, 5, char.tieColor); // knot
    grid.fillRoundedRect(cx - 4, y + 9, 8, 18, 2, char.tieColor);
    grid.drawVLine(cx - 2, y + 10, 16, C.BRIGHT_RED || C.RED);
    grid.drawVLine(cx + 2, y + 10, 16, char.tieShadow);
    grid.set(cx, y + 26, char.tieColor);

    // Suit Lapels
    grid.drawLine(cx - 10, y + 4, cx - 14, y + 18, char.suitHighlight);
    grid.drawLine(cx - 14, y + 18, cx - 5, y + 26, char.suitHighlight);
    grid.drawLine(cx + 10, y + 4, cx + 14, y + 18, char.suitShadow);
    grid.drawLine(cx + 14, y + 18, cx + 5, y + 26, char.suitShadow);

    // Breast Pocket & White Square
    grid.drawHLine(cx + 7, y + 12, 8, char.suitShadow);
    grid.fillRect(cx + 9, y + 10, 4, 2, C.WHITE);

    // Jacket Buttons & Center Seam
    grid.drawVLine(cx, y + 25, 7, char.suitShadow);
    grid.set(cx, y + 24, C.DARK_BROWN);
    grid.set(cx, y + 28, C.DARK_BROWN);
    grid.drawHLine(cx - 20, y + 31, 40, char.suitShadow);
  } else if (char.type === 'hoodie') {
    // agy Purple Hoodie
    grid.fillRoundedRect(cx - 24, y, 48, 32, 5, char.hoodieColor);
    grid.drawHLine(cx - 22, y, 44, char.hoodieHighlight);
    grid.drawHLine(cx - 23, y + 1, 46, char.hoodieHighlight);

    // Hood Rim / Neck Collar
    grid.fillRoundedRect(cx - 12, y, 24, 7, 3, char.hoodieHighlight);
    grid.fillRoundedRect(cx - 9, y + 2, 18, 5, 2, char.hoodieShadow);

    // White Hanging Drawstrings
    grid.fillRect(cx - 5, y + 6, 2, 14, char.stringsColor);
    grid.fillRect(cx - 6, y + 19, 3, 3, char.stringsShadow);
    grid.fillRect(cx + 4, y + 6, 2, 14, char.stringsColor);
    grid.fillRect(cx + 4, y + 19, 3, 3, char.stringsShadow);

    // Kangaroo Front Pouch Pocket
    grid.fillRoundedRect(cx - 14, y + 16, 28, 12, 3, char.hoodieColor);
    grid.strokeRect(cx - 14, y + 16, 28, 12, char.hoodieHighlight);
    grid.fillRect(cx - 13, y + 18, 3, 7, char.hoodieShadow); // left opening
    grid.fillRect(cx + 10, y + 18, 3, 7, char.hoodieShadow); // right opening
    grid.drawHLine(cx - 14, y + 16, 28, char.hoodieHighlight);

    // Bottom Ribbed Waistband
    grid.fillRect(cx - 22, y + 28, 44, 4, char.hoodieShadow);
    grid.drawHLine(cx - 22, y + 28, 44, char.hoodieHighlight);
  } else if (char.type === 'tech') {
    // codex Techwear Coat
    grid.fillRoundedRect(cx - 23, y, 46, 32, 4, char.coatColor);
    grid.drawHLine(cx - 21, y, 42, char.coatHighlight);

    // High Turtleneck Collar
    grid.fillRect(cx - 10, y - 2, 20, 6, C.BLACK);
    grid.drawHLine(cx - 9, y - 1, 18, C.DEEP_SLATE);
    grid.drawHLine(cx - 9, y + 1, 18, C.DEEP_SLATE);

    // Cyber Neon Accent Seam & Zipper
    grid.drawVLine(cx + 2, y + 4, 26, char.terminalGlow);
    grid.drawVLine(cx + 3, y + 4, 26, C.WHITE);
    grid.drawHLine(cx - 14, y + 12, 10, char.coatHighlight);
    grid.drawHLine(cx + 6, y + 12, 10, char.coatHighlight);

    // Tactical Panel Seams
    grid.drawVLine(cx - 12, y + 6, 22, char.coatShadow);
    grid.drawVLine(cx + 12, y + 6, 22, char.coatShadow);
    grid.drawHLine(cx - 21, y + 31, 42, char.coatShadow);
  }

  // Arms and Hands
  if (pose === 'stand' || pose === 'walk_pass') {
    // Relaxed arms at sides
    grid.fillRoundedRect(cx - 28, y + 2, 8, 22, 3, mainColor);
    grid.fillRoundedRect(cx + 20, y + 2, 8, 22, 3, mainColor);
    // Sleeve cuffs
    grid.drawHLine(cx - 28, y + 22, 8, highColor);
    grid.drawHLine(cx + 20, y + 22, 8, shadColor);
    // Hands
    grid.fillRoundedRect(cx - 28, y + 24, 8, 7, 2, char.skinMid);
    grid.drawHLine(cx - 27, y + 25, 5, char.skinLight);
    grid.fillRoundedRect(cx + 20, y + 24, 8, 7, 2, char.skinMid);
    grid.drawHLine(cx + 21, y + 25, 5, char.skinLight);
  } else if (pose === 'walk_swing_left') {
    // Left arm forward, right arm back
    grid.fillRoundedRect(cx - 30, y + 1, 8, 20, 3, highColor);
    grid.fillRoundedRect(cx - 30, y + 20, 8, 7, 2, char.skinMid);
    grid.fillRoundedRect(cx + 20, y + 4, 8, 17, 3, shadColor);
    grid.fillRoundedRect(cx + 20, y + 20, 8, 6, 2, char.skinMid);
  } else if (pose === 'walk_swing_right') {
    // Right arm forward, left arm back
    grid.fillRoundedRect(cx - 28, y + 4, 8, 17, 3, shadColor);
    grid.fillRoundedRect(cx - 28, y + 20, 8, 6, 2, char.skinMid);
    grid.fillRoundedRect(cx + 22, y + 1, 8, 20, 3, highColor);
    grid.fillRoundedRect(cx + 22, y + 20, 8, 7, 2, char.skinMid);
  }
}

/**
 * Draw front-facing legs & shoes in 128x128
 */
function drawLegsFront(grid, char, { yOffset = 0, walkFrame = 0 } = {}) {
  const y = 88 + yOffset;
  const cx = 64;

  const leftForward = walkFrame === 0;
  const rightForward = walkFrame === 2;
  const isWalking = walkFrame === 0 || walkFrame === 2;

  const ly = isWalking ? (leftForward ? y : y - 2) : y;
  const ry = isWalking ? (rightForward ? y : y - 2) : y;

  // Left Leg
  grid.fillRoundedRect(cx - 18, ly, 14, 22, 2, char.pantsColor);
  grid.drawVLine(cx - 18, ly, 22, char.pantsShadow);
  if (char.pantsCrease) {
    grid.drawVLine(cx - 11, ly + 2, 18, char.pantsCrease);
  }

  // Right Leg
  grid.fillRoundedRect(cx + 4, ry, 14, 22, 2, char.pantsColor);
  grid.drawVLine(cx + 17, ry, 22, char.pantsShadow);
  if (char.pantsCrease) {
    grid.drawVLine(cx + 11, ry + 2, 18, char.pantsCrease);
  }

  // Left Shoe
  const lsy = ly + 20;
  grid.fillRoundedRect(cx - 21, lsy, 17, 9, 3, char.shoesColor);
  if (char.shoesAccent) {
    grid.drawHLine(cx - 20, lsy + 4, 15, char.shoesAccent);
  }
  if (char.shoesSole) {
    grid.drawHLine(cx - 21, lsy + 8, 17, char.shoesSole);
  } else if (char.shoesHighlight) {
    grid.drawHLine(cx - 19, lsy + 1, 12, char.shoesHighlight);
  }

  // Right Shoe
  const rsy = ry + 20;
  grid.fillRoundedRect(cx + 4, rsy, 17, 9, 3, char.shoesColor);
  if (char.shoesAccent) {
    grid.drawHLine(cx + 5, rsy + 4, 15, char.shoesAccent);
  }
  if (char.shoesSole) {
    grid.drawHLine(cx + 4, rsy + 8, 17, char.shoesSole);
  } else if (char.shoesHighlight) {
    grid.drawHLine(cx + 6, rsy + 1, 12, char.shoesHighlight);
  }
}

/**
 * Draw profile head facing left in 128x128
 */
function drawHeadSide(grid, char, { yOffset = 0, eyeState = 'open' } = {}) {
  const y = 22 + yOffset;
  const cx = 64;

  // Neck
  grid.fillRect(cx - 4, y + 28, 14, 8, char.skinShadow);

  // Profile Ear
  grid.fillRoundedRect(cx + 4, y + 15, 6, 12, 2, char.skinMid);
  grid.set(cx + 6, y + 19, char.skinShadow);

  // Profile Face Flesh
  grid.fillRoundedRect(cx - 16, y + 6, 26, 27, 5, char.skinMid);
  grid.fillRoundedRect(cx - 18, y + 8, 24, 22, 4, char.skinLight);
  // Nose protrusion on left
  grid.fillRoundedRect(cx - 24, y + 17, 8, 7, 2, char.skinMid);
  grid.drawHLine(cx - 23, y + 18, 6, char.skinLight);
  grid.set(cx - 20, y + 23, char.skinShadow);

  // Hair Back & Crown
  grid.fillRoundedRect(cx - 16, y - 7, 36, 24, 8, char.hairColor);
  grid.fillRoundedRect(cx + 4, y + 6, 16, 18, 4, char.hairColor);
  grid.drawHLine(cx - 12, y - 6, 28, char.hairHighlight);
  grid.drawVLine(cx + 18, y + 4, 18, char.hairShadow);

  if (char.id === 'claude') {
    grid.fillRoundedRect(cx - 18, y - 7, 36, 16, 6, char.hairColor);
    grid.drawHLine(cx - 14, y - 6, 28, char.hairHighlight);
    // Profile sideburn
    grid.fillRect(cx - 2, y + 12, 6, 12, char.hairColor);
    grid.drawVLine(cx + 1, y + 14, 8, char.hairHighlight);
  } else if (char.id === 'agy') {
    // Spiky profile bangs
    grid.fillRoundedRect(cx - 22, y - 7, 38, 16, 5, char.hairColor);
    grid.fillRect(cx - 20, y + 4, 7, 11, char.hairColor);
    grid.drawHLine(cx - 14, y - 5, 20, char.hairHighlight);
  } else if (char.id === 'codex') {
    grid.fillRoundedRect(cx - 18, y - 6, 36, 16, 5, char.hairColor);
    grid.drawHLine(cx - 12, y - 5, 26, char.hairHighlight);
  }

  // Profile Eye
  const eyeY = y + 16;
  if (eyeState === 'blink' || eyeState === 'sleep') {
    grid.drawHLine(cx - 16, eyeY + 2, 7, C.BLACK);
  } else {
    grid.fillRect(cx - 16, eyeY, 7, 6, C.WHITE);
    grid.fillRect(cx - 16, eyeY, 4, 6, C.BLACK);
    grid.set(cx - 15, eyeY + 1, C.WHITE);
    grid.drawHLine(cx - 16, eyeY - 1, 7, char.hairShadow);
  }

  // Profile Glasses
  if (char.hasGlasses) {
    const gy = eyeY - 2;
    grid.strokeRect(cx - 18, gy, 11, 10, char.glassesColor);
    grid.drawHLine(cx - 7, gy + 3, 14, char.glassesColor); // temple arm to ear
    if (eyeState === 'open') {
      grid.drawLine(cx - 16, gy + 2, cx - 13, gy + 7, char.glassesGlare);
    }
  }

  // Beard or Mouth Profile
  if (char.hasBeard) {
    grid.fillRoundedRect(cx - 22, y + 25, 14, 8, 2, char.beardColor);
    grid.fillRoundedRect(cx - 18, y + 29, 22, 8, 3, char.beardColor);
    grid.drawHLine(cx - 16, y + 34, 18, char.beardHighlight);
  } else {
    grid.drawHLine(cx - 18, y + 28, 6, char.skinShadow);
  }
}

/**
 * Draw profile torso facing left in 128x128
 */
function drawTorsoSide(grid, char, { yOffset = 0, walkFrame = 0 } = {}) {
  const y = 56 + yOffset;
  const cx = 64;

  const mainColor = char.suitColor || char.hoodieColor || char.coatColor;
  const highColor =
    char.suitHighlight || char.hoodieHighlight || char.coatHighlight;
  const shadColor = char.suitShadow || char.hoodieShadow || char.coatShadow;

  // Torso Block
  grid.fillRoundedRect(cx - 16, y, 32, 32, 4, mainColor);
  grid.drawHLine(cx - 14, y, 28, highColor);
  grid.drawVLine(cx + 15, y + 1, 30, shadColor);

  // Clothing details
  if (char.type === 'suit') {
    grid.fillRect(cx - 16, y + 4, 5, 8, char.shirtColor);
    grid.fillRect(cx - 13, y + 7, 4, 12, char.tieColor);
  } else if (char.type === 'hoodie') {
    grid.fillRoundedRect(cx + 4, y + 2, 12, 14, 3, char.hoodieHighlight);
    grid.fillRect(cx - 12, y + 10, 2, 10, char.stringsColor);
  } else if (char.type === 'tech') {
    grid.drawVLine(cx - 8, y + 4, 26, char.terminalGlow);
  }

  // Arm Swing
  if (walkFrame === 0) {
    // Arm swung forward
    grid.fillRoundedRect(cx - 24, y + 3, 9, 22, 3, highColor);
    grid.fillRoundedRect(cx - 24, y + 23, 8, 7, 2, char.skinMid);
  } else if (walkFrame === 2) {
    // Arm swung back
    grid.fillRoundedRect(cx + 8, y + 4, 9, 21, 3, shadColor);
    grid.fillRoundedRect(cx + 8, y + 23, 8, 7, 2, char.skinMid);
  } else {
    // Neutral arm
    grid.fillRoundedRect(cx - 8, y + 3, 9, 23, 3, highColor);
    grid.fillRoundedRect(cx - 8, y + 24, 8, 7, 2, char.skinMid);
  }
}

/**
 * Draw profile legs facing left in 128x128
 */
function drawLegsSide(grid, char, { yOffset = 0, walkFrame = 0 } = {}) {
  const y = 88 + yOffset;
  const cx = 64;

  if (walkFrame === 0) {
    // Forward leg steps left, back leg steps right
    grid.fillRoundedRect(cx - 22, y, 14, 22, 2, char.pantsColor);
    grid.fillRoundedRect(cx + 4, y, 13, 20, 2, char.pantsShadow);
    // Shoes
    grid.fillRoundedRect(cx - 28, y + 20, 20, 9, 3, char.shoesColor);
    grid.fillRoundedRect(cx + 5, y + 18, 16, 9, 3, char.shoesColor);
  } else if (walkFrame === 2) {
    // Other leg forward
    grid.fillRoundedRect(cx - 14, y, 13, 20, 2, char.pantsShadow);
    grid.fillRoundedRect(cx + 6, y, 14, 22, 2, char.pantsColor);
    // Shoes
    grid.fillRoundedRect(cx - 18, y + 18, 16, 9, 3, char.shoesColor);
    grid.fillRoundedRect(cx + 4, y + 20, 20, 9, 3, char.shoesColor);
  } else {
    // Passing step
    grid.fillRoundedRect(cx - 10, y, 16, 22, 2, char.pantsColor);
    grid.fillRoundedRect(cx - 16, y + 20, 22, 9, 3, char.shoesColor);
  }
}

/**
 * Draw back-facing head in 128x128
 */
function drawHeadBack(grid, char, { yOffset = 0 } = {}) {
  const y = 22 + yOffset;
  const cx = 64;

  // Neck peek
  grid.fillRect(cx - 8, y + 28, 16, 8, char.skinShadow);

  // Full Hair coverage
  grid.fillRoundedRect(cx - 22, y - 7, 44, 34, 7, char.hairColor);
  grid.drawHLine(cx - 16, y - 6, 32, char.hairHighlight);
  grid.drawHLine(cx - 18, y - 4, 36, char.hairHighlight);
  grid.drawVLine(cx - 22, y + 4, 22, char.hairShadow);
  grid.drawVLine(cx + 21, y + 4, 22, char.hairShadow);
  grid.drawHLine(cx - 14, y + 26, 28, char.hairShadow);

  if (char.id === 'claude') {
    grid.fillRoundedRect(cx - 23, y - 8, 46, 36, 6, char.hairColor);
    grid.drawHLine(cx - 18, y - 7, 36, char.hairHighlight);
  } else if (char.id === 'agy') {
    grid.fillRoundedRect(cx - 24, y - 8, 48, 36, 5, char.hairColor);
    grid.drawHLine(cx - 16, y - 6, 32, char.hairHighlight);
  }
}

/**
 * Draw back-facing torso in 128x128
 */
function drawTorsoBack(grid, char, { yOffset = 0, pose = 'stand' } = {}) {
  const y = 56 + yOffset;
  const cx = 64;

  const mainColor = char.suitColor || char.hoodieColor || char.coatColor;
  const highColor =
    char.suitHighlight || char.hoodieHighlight || char.coatHighlight;
  const shadColor = char.suitShadow || char.hoodieShadow || char.coatShadow;

  grid.fillRoundedRect(cx - 22, y, 44, 32, 4, mainColor);
  grid.drawHLine(cx - 20, y, 40, highColor);
  grid.drawVLine(cx, y + 2, 28, shadColor); // Center back seam

  if (char.type === 'hoodie') {
    // Draped hood on back
    grid.fillRoundedRect(cx - 14, y + 2, 28, 16, 4, highColor);
    grid.strokeRect(cx - 14, y + 2, 28, 16, shadColor);
  }

  // Arms
  if (pose === 'walk_swing_left') {
    grid.fillRoundedRect(cx - 30, y + 1, 8, 20, 3, highColor);
    grid.fillRoundedRect(cx + 20, y + 4, 8, 17, 3, shadColor);
  } else if (pose === 'walk_swing_right') {
    grid.fillRoundedRect(cx - 28, y + 4, 8, 17, 3, shadColor);
    grid.fillRoundedRect(cx + 22, y + 1, 8, 20, 3, highColor);
  } else {
    grid.fillRoundedRect(cx - 28, y + 2, 8, 22, 3, mainColor);
    grid.fillRoundedRect(cx + 20, y + 2, 8, 22, 3, mainColor);
  }
}

/**
 * Draw Nightcap / Schlafmütze & floating Zzz in 128x128
 */
function drawNightcapAndSleep(grid, char, frame = 0) {
  const cx = 64;
  const y = 18;
  const capColor = char.nightcapColor;
  const pompom = char.nightcapAccent;

  // Cap band around forehead
  grid.fillRoundedRect(cx - 18, y - 2, 36, 8, 3, capColor);
  grid.drawHLine(cx - 16, y - 2, 32, pompom);

  // Drooping cone curving to right
  grid.fillRoundedRect(cx - 10, y - 10, 28, 10, 4, capColor);
  grid.fillRoundedRect(cx + 10, y - 14, 20, 10, 4, pompom);
  grid.fillRoundedRect(cx + 24, y - 8, 14, 12, 4, capColor);
  grid.fillRoundedRect(cx + 30, y + 2, 12, 14, 4, capColor);

  // Big fluffy pom-pom
  grid.fillCircle(cx + 36, y + 18, 7, pompom);
  grid.strokeCircle(cx + 36, y + 18, 7, C.WHITE);

  // Floating Zzz
  const zy = y - 10;
  if (frame === 0) {
    // Single glowing yellow 'z'
    const zx = cx + 22;
    grid.fillRect(zx, zy, 12, 3, C.YELLOW);
    grid.drawLine(zx + 10, zy, zx + 2, zy + 10, C.YELLOW);
    grid.drawLine(zx + 11, zy, zx + 3, zy + 10, C.YELLOW);
    grid.fillRect(zx, zy + 9, 12, 3, C.YELLOW);
  } else {
    // Big 'Z' and small 'z'
    const zx1 = cx + 28;
    grid.fillRect(zx1, zy - 4, 16, 4, C.YELLOW);
    grid.drawLine(zx1 + 14, zy - 4, zx1 + 2, zy + 12, C.YELLOW);
    grid.drawLine(zx1 + 15, zy - 4, zx1 + 3, zy + 12, C.YELLOW);
    grid.fillRect(zx1, zy + 10, 16, 4, C.YELLOW);

    const zx2 = cx + 10;
    const zy2 = zy + 6;
    grid.fillRect(zx2, zy2, 9, 2, C.CYAN);
    grid.drawLine(zx2 + 8, zy2, zx2 + 1, zy2 + 7, C.CYAN);
    grid.fillRect(zx2, zy2 + 6, 9, 2, C.CYAN);
  }
}

/**
 * Draw Ticket Folder (Handover prop) in 128x128
 */
function drawTicketFolder(grid, x, y, extended = false) {
  // Folder cover
  grid.fillRoundedRect(x, y, 28, 22, 3, C.GOLD);
  grid.fillRect(x + 2, y - 2, 12, 4, C.YELLOW); // tab

  // White Document Sheets
  grid.fillRect(x + 3, y + 3, 22, 16, C.WHITE);
  // Text & stamp lines
  grid.drawHLine(x + 6, y + 6, 14, C.ROYAL_BLUE);
  grid.drawHLine(x + 6, y + 10, 16, C.DEEP_SLATE);
  grid.drawHLine(x + 6, y + 14, 12, C.CRIMSON);
}

/**
 * Draw Clipboard (Review prop) in 128x128
 */
function drawClipboard(grid, x, y, hasCheck = false) {
  // Wooden board
  grid.fillRoundedRect(x, y, 28, 34, 3, C.CHESTNUT);
  grid.strokeRect(x, y, 28, 34, C.DARK_BROWN);
  // Metal clip top
  grid.fillRect(x + 8, y - 3, 12, 5, C.SILVER);
  grid.strokeRect(x + 8, y - 3, 12, 5, C.COOL_GRAY);

  // White paper
  grid.fillRect(x + 3, y + 3, 22, 28, C.WHITE);
  // Acceptance criteria text lines
  grid.drawHLine(x + 6, y + 8, 14, C.STEEL);
  grid.drawHLine(x + 6, y + 14, 16, C.STEEL);
  grid.drawHLine(x + 6, y + 20, 12, C.STEEL);

  if (hasCheck) {
    // Bright glowing green checkmark
    grid.drawLine(x + 8, y + 16, x + 12, y + 24, C.LIME);
    grid.drawLine(x + 9, y + 16, x + 13, y + 24, C.LIME);
    grid.drawLine(x + 12, y + 24, x + 22, y + 10, C.LIME);
    grid.drawLine(x + 13, y + 24, x + 23, y + 10, C.LIME);
  }
}

/**
 * Generate 32 sprite frames for a given character (128x128 each)
 * @param {string} charId 'claude' | 'agy' | 'codex'
 * @returns {PixelGrid[]} 32 frames (128x128 each)
 */
function generateCharacterFrames(charId) {
  const char = CHARACTERS[charId];
  if (!char) throw new Error(`Unknown character: ${charId}`);

  const frames = [];

  // ==========================================
  // 0..3: IDLE (4 frames)
  // ==========================================
  // Frame 0: Neutral standing
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 0, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 0, eyeState: 'open' });
    frames.push(g);
  }
  // Frame 1: Breath in (torso & head raised 2px)
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: -2, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: -2, eyeState: 'open' });
    frames.push(g);
  }
  // Frame 2: Blink (eyes closed)
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 0, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 0, eyeState: 'blink' });
    frames.push(g);
  }
  // Frame 3: Settle / Breath out
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 0, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 0, eyeState: 'open' });
    frames.push(g);
  }

  // ==========================================
  // 4..7: WALK DOWN (4 frames)
  // ==========================================
  // Frame 4: Left foot forward
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 0 });
    drawTorsoFront(g, char, { yOffset: 0, pose: 'walk_swing_left' });
    drawHeadFront(g, char, { yOffset: 0 });
    frames.push(g);
  }
  // Frame 5: Passing step (bob down 2px)
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 1 });
    drawTorsoFront(g, char, { yOffset: 2, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 2 });
    frames.push(g);
  }
  // Frame 6: Right foot forward
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 2 });
    drawTorsoFront(g, char, { yOffset: 0, pose: 'walk_swing_right' });
    drawHeadFront(g, char, { yOffset: 0 });
    frames.push(g);
  }
  // Frame 7: Passing step (bob down 2px)
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 3 });
    drawTorsoFront(g, char, { yOffset: 2, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 2 });
    frames.push(g);
  }

  // ==========================================
  // 8..11: WALK LEFT (4 frames)
  // ==========================================
  const walkLeftFrames = [];
  // Frame 8: Left foot forward
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsSide(g, char, { walkFrame: 0 });
    drawTorsoSide(g, char, { walkFrame: 0 });
    drawHeadSide(g, char, { yOffset: 0 });
    walkLeftFrames.push(g);
    frames.push(g);
  }
  // Frame 9: Pass
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsSide(g, char, { walkFrame: 1 });
    drawTorsoSide(g, char, { walkFrame: 1 });
    drawHeadSide(g, char, { yOffset: 2 });
    walkLeftFrames.push(g);
    frames.push(g);
  }
  // Frame 10: Right foot forward
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsSide(g, char, { walkFrame: 2 });
    drawTorsoSide(g, char, { walkFrame: 2 });
    drawHeadSide(g, char, { yOffset: 0 });
    walkLeftFrames.push(g);
    frames.push(g);
  }
  // Frame 11: Pass
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsSide(g, char, { walkFrame: 3 });
    drawTorsoSide(g, char, { walkFrame: 3 });
    drawHeadSide(g, char, { yOffset: 2 });
    walkLeftFrames.push(g);
    frames.push(g);
  }

  // ==========================================
  // 12..15: WALK RIGHT (4 frames - flipped Left)
  // ==========================================
  for (let i = 0; i < 4; i++) {
    frames.push(walkLeftFrames[i].flipHorizontal());
  }

  // ==========================================
  // 16..19: WALK UP (4 frames)
  // ==========================================
  // Frame 16: Left foot forward
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 0 });
    drawTorsoBack(g, char, { yOffset: 0, pose: 'walk_swing_left' });
    drawHeadBack(g, char, { yOffset: 0 });
    frames.push(g);
  }
  // Frame 17: Pass
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 1 });
    drawTorsoBack(g, char, { yOffset: 2, pose: 'stand' });
    drawHeadBack(g, char, { yOffset: 2 });
    frames.push(g);
  }
  // Frame 18: Right foot forward
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 2 });
    drawTorsoBack(g, char, { yOffset: 0, pose: 'walk_swing_right' });
    drawHeadBack(g, char, { yOffset: 0 });
    frames.push(g);
  }
  // Frame 19: Pass
  {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 3 });
    drawTorsoBack(g, char, { yOffset: 2, pose: 'stand' });
    drawHeadBack(g, char, { yOffset: 2 });
    frames.push(g);
  }

  // ==========================================
  // 20..22: TYPING (3 frames)
  // Workstation with screen code syntax & mechanical keyboard
  // ==========================================
  for (let t = 0; t < 3; t++) {
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 2, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 2 });

    // Workstation Desk Surface
    g.fillRoundedRect(28, 86, 72, 14, 2, C.CHESTNUT);
    g.drawHLine(28, 86, 72, C.COPPER);
    g.drawHLine(28, 100, 72, C.DARK_BROWN);

    // Mechanical Keyboard
    g.fillRoundedRect(42, 82, 38, 8, 2, C.DEEP_SLATE);
    g.drawHLine(44, 84, 34, C.SILVER);
    g.drawHLine(46, 86, 30, C.COOL_GRAY);

    // Widescreen Monitor on Stand
    g.fillRect(88, 54, 30, 28, C.BLACK);
    g.strokeRect(88, 54, 30, 28, C.STEEL);
    g.fillRect(100, 82, 6, 6, C.COOL_GRAY);
    g.fillRect(96, 88, 14, 3, C.COOL_GRAY);

    // Syntax-highlighted code flicker
    const glow = char.id === 'codex' ? C.LIME : C.CYAN;
    const codeColor1 = t % 2 === 0 ? glow : C.WHITE;
    const codeColor2 = t % 3 === 0 ? C.YELLOW : glow;
    g.fillRect(90, 56, 26, 24, C.MIDNIGHT);
    g.drawHLine(92, 59, 14, codeColor1);
    g.drawHLine(95, 63, 18, codeColor2);
    g.drawHLine(97, 67, 12, C.WHITE);
    g.drawHLine(95, 71, 16, codeColor1);
    g.drawHLine(92, 75, 10, C.LIME);

    // Hands Typing (Alternating)
    const leftY = t === 0 ? 80 : 82;
    const rightY = t === 2 ? 80 : 82;
    g.fillRoundedRect(44, leftY, 8, 7, 2, char.skinMid);
    g.fillRoundedRect(68, rightY, 8, 7, 2, char.skinMid);

    frames.push(g);
  }

  // ==========================================
  // 23..24: HANDOVER (2 frames)
  // ==========================================
  {
    // Frame 23: Hold folder near chest
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { pose: 'stand' });
    drawHeadFront(g, char);

    drawTicketFolder(g, 50, 64);
    // Hands holding sides of folder
    g.fillRoundedRect(44, 70, 8, 8, 2, char.skinMid);
    g.fillRoundedRect(76, 70, 8, 8, 2, char.skinMid);
    frames.push(g);
  }
  {
    // Frame 24: Extend folder forward
    const g = new PixelGrid(128, 128);
    drawShadow(g, 70, 116, 32);
    drawLegsFront(g, char, { walkFrame: 0 });
    drawTorsoFront(g, char, { pose: 'stand' });
    drawHeadFront(g, char);

    // Extended arms presenting folder
    const mainColor = char.suitColor || char.hoodieColor || char.coatColor;
    gridLineArms: {
      g.fillRoundedRect(68, 66, 18, 8, 2, mainColor);
    }
    drawTicketFolder(g, 84, 56, true);
    g.fillRoundedRect(80, 64, 8, 8, 2, char.skinMid);
    frames.push(g);
  }

  // ==========================================
  // 25..26: REVIEW (2 frames)
  // ==========================================
  {
    // Frame 25: Reading clipboard
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 2 }); // Looking down slightly

    drawClipboard(g, 36, 58, false);
    g.fillRoundedRect(32, 70, 8, 8, 2, char.skinMid);
    // Pen in right hand
    g.fillRoundedRect(68, 68, 8, 8, 2, char.skinMid);
    g.drawLine(64, 72, 58, 76, C.YELLOW);
    g.set(57, 77, C.BLACK); // pen tip
    frames.push(g);
  }
  {
    // Frame 26: Green checkmark marked! Thumbs up
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 0 });

    drawClipboard(g, 36, 58, true);
    g.fillRoundedRect(32, 70, 8, 8, 2, char.skinMid);
    // Right hand raised in thumbs up
    g.fillRoundedRect(72, 58, 8, 12, 2, char.skinMid);
    g.drawHLine(73, 56, 4, char.skinLight); // thumb
    frames.push(g);
  }

  // ==========================================
  // 27..28: COOLDOWN (2 frames)
  // Nightcap + peaceful sleep + Zzz
  // ==========================================
  {
    // Frame 27: Sleep frame 1
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 0, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 0, eyeState: 'sleep' });
    drawNightcapAndSleep(g, char, 0);
    frames.push(g);
  }
  {
    // Frame 28: Sleep frame 2
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 2, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 2, eyeState: 'sleep' });
    drawNightcapAndSleep(g, char, 1);
    frames.push(g);
  }

  // ==========================================
  // 29..31: EXTRA STATUS FRAMES (3 frames)
  // 29: Deep cooldown snooze
  // 30: Alert / Error
  // 31: Success / Victory
  // ==========================================
  {
    // 29: Deep cooldown
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 2, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 2, eyeState: 'sleep' });
    drawNightcapAndSleep(g, char, 1);
    frames.push(g);
  }
  {
    // 30: Alert / Error
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char);
    drawHeadFront(g, char);

    // Glowing Red Exclamation Diamond / Badge Overhead
    g.fillRoundedRect(54, 4, 20, 22, 4, C.RED);
    g.strokeRect(54, 4, 20, 22, C.CRIMSON);
    g.fillRect(62, 7, 4, 10, C.WHITE);
    g.fillRect(62, 19, 4, 4, C.WHITE);
    frames.push(g);
  }
  {
    // 31: Success / Victory
    const g = new PixelGrid(128, 128);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char);
    drawHeadFront(g, char);

    // Both Arms Raised Triumphantly
    const mainColor = char.suitColor || char.hoodieColor || char.coatColor;
    g.fillRoundedRect(32, 44, 9, 22, 3, mainColor);
    g.fillRoundedRect(32, 36, 9, 9, 2, char.skinMid);
    g.fillRoundedRect(87, 44, 9, 22, 3, mainColor);
    g.fillRoundedRect(87, 36, 9, 9, 2, char.skinMid);

    // Radiant Golden Star Sparkle Overhead
    const sx = 64;
    const sy = 12;
    g.fillCircle(sx, sy, 4, C.WHITE);
    g.drawLine(sx - 10, sy, sx + 10, sy, C.GOLD);
    g.drawLine(sx, sy - 10, sx, sy + 10, C.GOLD);
    g.drawLine(sx - 6, sy - 6, sx + 6, sy + 6, C.YELLOW);
    g.drawLine(sx - 6, sy + 6, sx + 6, sy - 6, C.YELLOW);
    frames.push(g);
  }

  return frames;
}

module.exports = {
  CHARACTERS,
  generateCharacterFrames,
};
