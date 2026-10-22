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
    tieColor: C.RED,
    tieShadow: C.CRIMSON,
    pantsColor: C.MIDNIGHT,
    pantsShadow: C.BLACK,
    shoesColor: C.BLACK,
    hasBeard: true,
    beardColor: C.COOL_GRAY,
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
    pantsColor: C.DEEP_SLATE,
    pantsShadow: C.BLACK,
    shoesColor: C.WHITE,
    shoesAccent: C.SILVER,
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
function drawShadow(grid, cx = 16, cy = 29, rx = 6) {
  for (let x = cx - rx; x <= cx + rx; x++) {
    grid.set(x, cy, C.BLACK);
  }
  for (let x = cx - rx + 2; x <= cx + rx - 2; x++) {
    grid.set(x, cy + 1, C.BLACK);
  }
}

/**
 * Draw front-facing head
 */
function drawHeadFront(
  grid,
  char,
  { yOffset = 0, eyeState = 'open', looking = 'front' } = {},
) {
  const y = 6 + yOffset;
  const cx = 16;

  // Hair base (top and sides)
  grid.fillRect(cx - 5, y - 2, 11, 4, char.hairColor);
  grid.fillRect(cx - 6, y, 2, 5, char.hairColor);
  grid.fillRect(cx + 5, y, 2, 5, char.hairColor);

  // Hair highlights
  grid.drawHLine(cx - 4, y - 2, 8, char.hairHighlight);
  grid.set(cx - 5, y - 1, char.hairHighlight);
  grid.set(cx + 4, y - 1, char.hairShadow);

  // Face flesh
  grid.fillRect(cx - 4, y + 1, 9, 7, char.skinMid);
  grid.fillRect(cx - 3, y + 2, 7, 5, char.skinLight);
  // Chin shadow
  grid.drawHLine(cx - 2, y + 7, 5, char.skinShadow);

  // Claude specific sideburns / salt-pepper hair
  if (char.id === 'claude') {
    grid.set(cx - 4, y + 2, char.hairHighlight);
    grid.set(cx + 4, y + 2, char.hairHighlight);
    grid.set(cx - 5, y + 3, char.hairColor);
    grid.set(cx + 4, y + 3, char.hairColor);
  }

  // agy messy hair bangs
  if (char.id === 'agy') {
    grid.set(cx - 3, y + 1, char.hairColor);
    grid.set(cx - 1, y + 1, char.hairColor);
    grid.set(cx + 2, y + 1, char.hairColor);
    grid.set(cx - 2, y + 2, char.hairColor);
  }

  // Eyes
  const eyeY = y + 3;
  if (eyeState === 'blink' || eyeState === 'sleep') {
    // Closed eye slits
    grid.drawHLine(cx - 3, eyeY, 2, C.BLACK);
    grid.drawHLine(cx + 2, eyeY, 2, C.BLACK);
  } else {
    // Open eyes
    grid.set(cx - 3, eyeY, C.WHITE);
    grid.set(cx - 2, eyeY, C.BLACK);
    grid.set(cx + 2, eyeY, C.BLACK);
    grid.set(cx + 3, eyeY, C.WHITE);

    // Eyebrows
    grid.drawHLine(cx - 3, eyeY - 1, 2, char.hairShadow);
    grid.drawHLine(cx + 2, eyeY - 1, 2, char.hairShadow);
  }

  // Glasses for codex
  if (char.hasGlasses) {
    grid.drawHLine(cx - 4, eyeY - 1, 4, char.glassesColor);
    grid.drawHLine(cx + 1, eyeY - 1, 4, char.glassesColor);
    grid.set(cx, eyeY - 1, char.glassesColor); // bridge
    grid.set(cx - 4, eyeY, char.glassesColor);
    grid.set(cx - 1, eyeY, char.glassesColor);
    grid.set(cx + 1, eyeY, char.glassesColor);
    grid.set(cx + 4, eyeY, char.glassesColor);
    grid.drawHLine(cx - 3, eyeY + 1, 2, char.glassesColor);
    grid.drawHLine(cx + 2, eyeY + 1, 2, char.glassesColor);
    // Glare
    if (eyeState === 'open') {
      grid.set(cx - 3, eyeY, char.glassesGlare);
      grid.set(cx + 2, eyeY, char.glassesGlare);
    }
  }

  // Beard for Claude
  if (char.hasBeard) {
    grid.drawHLine(cx - 2, y + 6, 5, char.beardColor);
    grid.drawHLine(cx - 1, y + 7, 3, char.beardColor);
    grid.set(cx - 2, y + 5, char.beardColor);
    grid.set(cx + 2, y + 5, char.beardColor);
  } else {
    // Mouth
    grid.drawHLine(cx - 1, y + 5, 2, char.skinShadow);
  }
}

/**
 * Draw front-facing torso & clothes
 */
function drawTorsoFront(grid, char, { yOffset = 0, pose = 'stand' } = {}) {
  const y = 14 + yOffset;
  const cx = 16;

  if (char.type === 'suit') {
    // Claude Suit
    // Shoulders & coat base
    grid.fillRect(cx - 5, y, 11, 8, char.suitColor);
    grid.drawHLine(cx - 5, y, 11, char.suitHighlight);
    grid.drawVLine(cx - 6, y + 1, 6, char.suitColor);
    grid.drawVLine(cx + 5, y + 1, 6, char.suitColor);

    // White shirt V-neck & collar
    grid.set(cx, y, char.shirtColor);
    grid.set(cx - 1, y + 1, char.shirtColor);
    grid.set(cx + 1, y + 1, char.shirtColor);
    grid.fillRect(cx - 1, y + 2, 3, 2, char.shirtColor);

    // Red tie
    grid.set(cx, y + 1, char.tieColor);
    grid.drawVLine(cx, y + 2, 4, char.tieColor);
    grid.set(cx, y + 3, char.tieShadow);

    // Suit lapels & outline
    grid.drawVLine(cx - 2, y + 2, 5, char.suitHighlight);
    grid.drawVLine(cx + 2, y + 2, 5, char.suitShadow);
    grid.drawHLine(cx - 5, y + 7, 11, char.suitShadow);
  } else if (char.type === 'hoodie') {
    // agy Hoodie
    grid.fillRect(cx - 5, y, 11, 8, char.hoodieColor);
    grid.drawHLine(cx - 5, y, 11, char.hoodieHighlight);
    grid.drawVLine(cx - 6, y + 1, 6, char.hoodieColor);
    grid.drawVLine(cx + 5, y + 1, 6, char.hoodieColor);

    // Hood collar rim
    grid.drawHLine(cx - 2, y, 5, char.hoodieHighlight);
    grid.set(cx - 3, y + 1, char.hoodieHighlight);
    grid.set(cx + 3, y + 1, char.hoodieHighlight);

    // White drawstrings
    grid.drawVLine(cx - 1, y + 2, 3, char.stringsColor);
    grid.drawVLine(cx + 1, y + 2, 3, char.stringsColor);

    // Front kangaroo pouch pocket
    grid.fillRect(cx - 3, y + 4, 7, 3, char.hoodieHighlight);
    grid.drawHLine(cx - 2, y + 4, 5, char.hoodieShadow);
    grid.drawHLine(cx - 5, y + 7, 11, char.hoodieShadow);
  } else if (char.type === 'tech') {
    // codex Techwear Coat
    grid.fillRect(cx - 5, y, 11, 8, char.coatColor);
    grid.drawHLine(cx - 5, y, 11, char.coatHighlight);
    grid.drawVLine(cx - 6, y + 1, 6, char.coatColor);
    grid.drawVLine(cx + 5, y + 1, 6, char.coatColor);

    // High turtleneck collar
    grid.drawHLine(cx - 2, y, 5, C.BLACK);
    grid.drawHLine(cx - 1, y + 1, 3, C.DEEP_SLATE);

    // Cyber green accent line / zipper down middle
    grid.drawVLine(cx, y + 2, 5, char.terminalGlow);

    // Tech panel seams
    grid.drawVLine(cx - 3, y + 2, 4, char.coatHighlight);
    grid.drawVLine(cx + 3, y + 2, 4, char.coatShadow);
    grid.drawHLine(cx - 5, y + 7, 11, char.coatShadow);
  }

  // Arms and hands
  if (pose === 'stand' || pose === 'walk_pass') {
    // Arms at sides
    grid.fillRect(
      cx - 6,
      y + 1,
      2,
      6,
      char.suitColor || char.hoodieColor || char.coatColor,
    );
    grid.fillRect(
      cx + 5,
      y + 1,
      2,
      6,
      char.suitColor || char.hoodieColor || char.coatColor,
    );
    // Hands
    grid.fillRect(cx - 6, y + 6, 2, 2, char.skinMid);
    grid.fillRect(cx + 5, y + 6, 2, 2, char.skinMid);
  } else if (pose === 'walk_swing_left') {
    // Left arm forward (lower/raised), right arm back
    grid.fillRect(
      cx - 7,
      y + 1,
      2,
      5,
      char.suitColor || char.hoodieColor || char.coatColor,
    );
    grid.fillRect(cx - 7, y + 5, 2, 2, char.skinMid);
    grid.fillRect(
      cx + 5,
      y + 2,
      2,
      4,
      char.suitColor || char.hoodieColor || char.coatColor,
    );
    grid.fillRect(cx + 5, y + 5, 2, 2, char.skinMid);
  } else if (pose === 'walk_swing_right') {
    // Right arm forward, left arm back
    grid.fillRect(
      cx - 6,
      y + 2,
      2,
      4,
      char.suitColor || char.hoodieColor || char.coatColor,
    );
    grid.fillRect(cx - 6, y + 5, 2, 2, char.skinMid);
    grid.fillRect(
      cx + 6,
      y + 1,
      2,
      5,
      char.suitColor || char.hoodieColor || char.coatColor,
    );
    grid.fillRect(cx + 6, y + 5, 2, 2, char.skinMid);
  }
}

/**
 * Draw front-facing legs & shoes
 */
function drawLegsFront(grid, char, { yOffset = 0, walkFrame = 0 } = {}) {
  const y = 22 + yOffset;
  const cx = 16;

  if (walkFrame === 0 || walkFrame === 2) {
    // Walking stride
    const leftForward = walkFrame === 0;
    // Left leg
    const ly = leftForward ? y : y - 1;
    grid.fillRect(cx - 4, ly, 3, 5, char.pantsColor);
    grid.drawVLine(cx - 5, ly + 1, 4, char.pantsShadow);
    // Right leg
    const ry = leftForward ? y - 1 : y;
    grid.fillRect(cx + 2, ry, 3, 5, char.pantsColor);
    grid.drawVLine(cx + 4, ry + 1, 4, char.pantsShadow);

    // Shoes
    grid.fillRect(cx - 5, ly + 5, 4, 2, char.shoesColor);
    grid.fillRect(cx + 2, ry + 5, 4, 2, char.shoesColor);
    if (char.shoesAccent) {
      grid.drawHLine(cx - 5, ly + 6, 4, char.shoesAccent);
      grid.drawHLine(cx + 2, ry + 6, 4, char.shoesAccent);
    }
  } else {
    // Standing or passing position
    grid.fillRect(cx - 4, y, 3, 5, char.pantsColor);
    grid.fillRect(cx + 2, y, 3, 5, char.pantsColor);
    grid.drawVLine(cx - 5, y, 5, char.pantsShadow);
    grid.drawVLine(cx + 4, y, 5, char.pantsShadow);

    // Shoes
    grid.fillRect(cx - 5, y + 5, 4, 2, char.shoesColor);
    grid.fillRect(cx + 2, y + 5, 4, 2, char.shoesColor);
    if (char.shoesAccent) {
      grid.drawHLine(cx - 5, y + 6, 4, char.shoesAccent);
      grid.drawHLine(cx + 2, y + 6, 4, char.shoesAccent);
    }
  }
}

/**
 * Draw profile head facing left
 */
function drawHeadSide(grid, char, { yOffset = 0, eyeState = 'open' } = {}) {
  const y = 6 + yOffset;
  const cx = 16;

  // Hair back & top
  grid.fillRect(cx - 3, y - 2, 8, 4, char.hairColor);
  grid.fillRect(cx + 2, y, 4, 5, char.hairColor);
  grid.drawHLine(cx - 2, y - 2, 6, char.hairHighlight);
  grid.drawVLine(cx + 5, y, 6, char.hairShadow);

  // Face flesh (facing left)
  grid.fillRect(cx - 4, y + 1, 7, 7, char.skinMid);
  grid.fillRect(cx - 5, y + 2, 6, 5, char.skinLight);
  // Nose protrusion on left
  grid.set(cx - 6, y + 3, char.skinMid);
  // Chin
  grid.drawHLine(cx - 4, y + 7, 5, char.skinShadow);

  // Eye facing left
  const eyeY = y + 3;
  if (eyeState === 'blink' || eyeState === 'sleep') {
    grid.drawHLine(cx - 4, eyeY, 2, C.BLACK);
  } else {
    grid.set(cx - 4, eyeY, C.BLACK);
    grid.set(cx - 3, eyeY, C.WHITE);
    grid.drawHLine(cx - 4, eyeY - 1, 2, char.hairShadow);
  }

  // Glasses
  if (char.hasGlasses) {
    grid.drawHLine(cx - 5, eyeY - 1, 4, char.glassesColor);
    grid.drawHLine(cx - 5, eyeY + 1, 3, char.glassesColor);
    grid.set(cx - 5, eyeY, char.glassesColor);
    grid.set(cx - 2, eyeY, char.glassesColor);
    grid.drawHLine(cx - 1, eyeY - 1, 4, char.glassesColor); // temple arm
    if (eyeState === 'open') {
      grid.set(cx - 4, eyeY, char.glassesGlare);
    }
  }

  // Beard
  if (char.hasBeard) {
    grid.drawVLine(cx - 5, y + 5, 3, char.beardColor);
    grid.drawHLine(cx - 4, y + 6, 3, char.beardColor);
    grid.drawHLine(cx - 3, y + 7, 3, char.beardColor);
  }
}

/**
 * Draw profile torso facing left
 */
function drawTorsoSide(grid, char, { yOffset = 0, walkFrame = 0 } = {}) {
  const y = 14 + yOffset;
  const cx = 16;
  const mainColor = char.suitColor || char.hoodieColor || char.coatColor;
  const highColor =
    char.suitHighlight || char.hoodieHighlight || char.coatHighlight;
  const shadColor = char.suitShadow || char.hoodieShadow || char.coatShadow;

  // Torso side block
  grid.fillRect(cx - 4, y, 8, 8, mainColor);
  grid.drawHLine(cx - 3, y, 7, highColor);
  grid.drawVLine(cx + 3, y, 8, shadColor);

  // Tie / collar peek
  if (char.type === 'suit') {
    grid.set(cx - 4, y + 1, char.shirtColor);
    grid.set(cx - 3, y + 2, char.tieColor);
  }

  // Arm swing in side walk
  if (walkFrame === 0) {
    // Arm forward
    grid.fillRect(cx - 6, y + 1, 3, 5, highColor);
    grid.fillRect(cx - 6, y + 5, 2, 2, char.skinMid);
  } else if (walkFrame === 2) {
    // Arm back
    grid.fillRect(cx + 2, y + 1, 3, 5, shadColor);
    grid.fillRect(cx + 2, y + 5, 2, 2, char.skinMid);
  } else {
    // Arm neutral
    grid.fillRect(cx - 2, y + 1, 3, 6, highColor);
    grid.fillRect(cx - 2, y + 6, 2, 2, char.skinMid);
  }
}

/**
 * Draw profile legs facing left
 */
function drawLegsSide(grid, char, { yOffset = 0, walkFrame = 0 } = {}) {
  const y = 22 + yOffset;
  const cx = 16;

  if (walkFrame === 0) {
    // Forward leg steps left, back leg steps right
    grid.fillRect(cx - 5, y, 3, 6, char.pantsColor);
    grid.fillRect(cx + 1, y, 3, 5, char.pantsShadow);
    // Shoes
    grid.fillRect(cx - 7, y + 5, 4, 2, char.shoesColor);
    grid.fillRect(cx + 2, y + 4, 3, 2, char.shoesColor);
  } else if (walkFrame === 2) {
    // Other leg forward
    grid.fillRect(cx - 3, y, 3, 5, char.pantsShadow);
    grid.fillRect(cx + 2, y, 3, 6, char.pantsColor);
    // Shoes
    grid.fillRect(cx - 4, y + 4, 3, 2, char.shoesColor);
    grid.fillRect(cx + 1, y + 5, 4, 2, char.shoesColor);
  } else {
    // Passing step
    grid.fillRect(cx - 2, y, 4, 5, char.pantsColor);
    grid.fillRect(cx - 4, y + 5, 5, 2, char.shoesColor);
  }
}

/**
 * Draw back-facing head
 */
function drawHeadBack(grid, char, { yOffset = 0 } = {}) {
  const y = 6 + yOffset;
  const cx = 16;

  // Full hair coverage
  grid.fillRect(cx - 5, y - 2, 11, 8, char.hairColor);
  grid.fillRect(cx - 4, y - 2, 9, 3, char.hairHighlight);
  grid.drawVLine(cx - 5, y, 6, char.hairShadow);
  grid.drawVLine(cx + 5, y, 6, char.hairShadow);
  grid.drawHLine(cx - 3, y + 6, 7, char.hairShadow);

  // Neck peek
  grid.drawHLine(cx - 2, y + 7, 5, char.skinShadow);
}

/**
 * Draw back-facing torso
 */
function drawTorsoBack(grid, char, { yOffset = 0, pose = 'stand' } = {}) {
  const y = 14 + yOffset;
  const cx = 16;
  const mainColor = char.suitColor || char.hoodieColor || char.coatColor;
  const highColor =
    char.suitHighlight || char.hoodieHighlight || char.coatHighlight;
  const shadColor = char.suitShadow || char.hoodieShadow || char.coatShadow;

  grid.fillRect(cx - 5, y, 11, 8, mainColor);
  grid.drawHLine(cx - 5, y, 11, highColor);
  grid.drawVLine(cx - 6, y + 1, 6, mainColor);
  grid.drawVLine(cx + 5, y + 1, 6, mainColor);

  // Center seam down back
  grid.drawVLine(cx, y + 1, 7, shadColor);

  // Hoodie hood on back
  if (char.type === 'hoodie') {
    grid.fillRect(cx - 3, y + 1, 7, 4, highColor);
    grid.drawHLine(cx - 2, y + 4, 5, shadColor);
  }

  // Arms
  if (pose === 'walk_swing_left') {
    grid.fillRect(cx - 7, y + 1, 2, 5, mainColor);
    grid.fillRect(cx + 5, y + 2, 2, 4, shadColor);
  } else if (pose === 'walk_swing_right') {
    grid.fillRect(cx - 6, y + 2, 2, 4, shadColor);
    grid.fillRect(cx + 6, y + 1, 2, 5, mainColor);
  } else {
    grid.fillRect(cx - 6, y + 1, 2, 6, mainColor);
    grid.fillRect(cx + 5, y + 1, 2, 6, shadColor);
  }
}

/**
 * Draw Nightcap / Schlafmütze & Zzz
 */
function drawNightcapAndSleep(grid, char, frame = 0) {
  const cx = 16;
  const y = 5;
  const capColor = char.nightcapColor;
  const pompom = char.nightcapAccent;

  // Cap band around forehead
  grid.drawHLine(cx - 4, y, 9, capColor);
  grid.drawHLine(cx - 3, y - 1, 8, pompom); // striped or rim

  // Cone tilting right
  grid.fillRect(cx - 2, y - 3, 7, 2, capColor);
  grid.fillRect(cx + 2, y - 4, 5, 2, pompom);
  grid.fillRect(cx + 5, y - 3, 3, 2, capColor);
  grid.fillRect(cx + 7, y - 1, 2, 3, capColor);
  grid.fillRect(cx + 8, y + 2, 2, 3, capColor);

  // Fluffy round pompom at tip
  grid.fillRect(cx + 8, y + 5, 3, 3, pompom);

  // Floating Zzz
  if (frame === 0) {
    // Single yellow 'z'
    const zx = cx + 5;
    const zy = 2;
    grid.drawHLine(zx, zy, 3, C.YELLOW);
    grid.set(zx + 1, zy + 1, C.YELLOW);
    grid.drawHLine(zx, zy + 2, 3, C.YELLOW);
  } else {
    // Big 'Z' and small 'z'
    const zx = cx + 6;
    const zy = 1;
    // Big Z
    grid.drawHLine(zx, zy, 4, C.YELLOW);
    grid.set(zx + 2, zy + 1, C.YELLOW);
    grid.set(zx + 1, zy + 2, C.YELLOW);
    grid.drawHLine(zx, zy + 3, 4, C.YELLOW);

    // Small z
    grid.drawHLine(zx - 7, zy + 2, 2, C.CYAN);
    grid.set(zx - 6, zy + 3, C.CYAN);
    grid.drawHLine(zx - 7, zy + 4, 2, C.CYAN);
  }
}

/**
 * Draw Ticket Folder (Handover prop)
 */
function drawTicketFolder(grid, x, y, open = false) {
  // Manila yellow folder
  grid.fillRect(x, y, 7, 6, C.GOLD);
  grid.drawHLine(x, y, 4, C.YELLOW); // folder tab
  // White document sheets inside
  grid.fillRect(x + 1, y + 1, 5, 4, C.WHITE);
  // Text lines on ticket
  grid.drawHLine(x + 2, y + 2, 3, C.ROYAL_BLUE);
  grid.drawHLine(x + 2, y + 3, 3, C.CRIMSON);
  grid.drawHLine(x + 1, y + 5, 5, C.COPPER);
}

/**
 * Draw Clipboard (Review prop)
 */
function drawClipboard(grid, x, y, hasCheck = false) {
  // Wood board
  grid.fillRect(x, y, 7, 8, C.CHESTNUT);
  grid.strokeRect(x, y, 7, 8, C.DARK_BROWN);
  // Metal clip top
  grid.fillRect(x + 2, y - 1, 3, 2, C.SILVER);
  // White paper
  grid.fillRect(x + 1, y + 1, 5, 6, C.WHITE);
  // Text lines
  grid.drawHLine(x + 2, y + 2, 3, C.STEEL);
  grid.drawHLine(x + 2, y + 4, 3, C.STEEL);

  if (hasCheck) {
    // Bright green checkmark
    grid.set(x + 2, y + 4, C.LIME);
    grid.set(x + 3, y + 5, C.LIME);
    grid.set(x + 4, y + 3, C.LIME);
    grid.set(x + 5, y + 2, C.LIME);
  }
}

/**
 * Generate 32 sprite frames for a given character
 * @param {string} charId 'claude' | 'agy' | 'codex'
 * @returns {PixelGrid[]} 32 frames (32x32 each)
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
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 0, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 0, eyeState: 'open' });
    frames.push(g);
  }
  // Frame 1: Breath in (torso & head raised 1px)
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: -1, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: -1, eyeState: 'open' });
    frames.push(g);
  }
  // Frame 2: Blink (eyes closed)
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 0, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 0, eyeState: 'blink' });
    frames.push(g);
  }
  // Frame 3: Breath out / slight settle
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 0, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 0, eyeState: 'open' });
    frames.push(g);
  }

  // ==========================================
  // 4..7: WALK DOWN (4 frames)
  // ==========================================
  // Frame 4: Left foot step forward
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 0 });
    drawTorsoFront(g, char, { yOffset: 0, pose: 'walk_swing_left' });
    drawHeadFront(g, char, { yOffset: 0 });
    frames.push(g);
  }
  // Frame 5: Passing step (bob down 1px)
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 1 });
    drawTorsoFront(g, char, { yOffset: 1, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 1 });
    frames.push(g);
  }
  // Frame 6: Right foot step forward
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 2 });
    drawTorsoFront(g, char, { yOffset: 0, pose: 'walk_swing_right' });
    drawHeadFront(g, char, { yOffset: 0 });
    frames.push(g);
  }
  // Frame 7: Passing step (bob down 1px)
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 3 });
    drawTorsoFront(g, char, { yOffset: 1, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 1 });
    frames.push(g);
  }

  // ==========================================
  // 8..11: WALK LEFT (4 frames)
  // ==========================================
  const walkLeftFrames = [];
  // Frame 8: Left foot forward
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsSide(g, char, { walkFrame: 0 });
    drawTorsoSide(g, char, { walkFrame: 0 });
    drawHeadSide(g, char, { yOffset: 0 });
    walkLeftFrames.push(g);
    frames.push(g);
  }
  // Frame 9: Pass
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsSide(g, char, { walkFrame: 1 });
    drawTorsoSide(g, char, { walkFrame: 1 });
    drawHeadSide(g, char, { yOffset: 1 });
    walkLeftFrames.push(g);
    frames.push(g);
  }
  // Frame 10: Right foot forward
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsSide(g, char, { walkFrame: 2 });
    drawTorsoSide(g, char, { walkFrame: 2 });
    drawHeadSide(g, char, { yOffset: 0 });
    walkLeftFrames.push(g);
    frames.push(g);
  }
  // Frame 11: Pass
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsSide(g, char, { walkFrame: 3 });
    drawTorsoSide(g, char, { walkFrame: 3 });
    drawHeadSide(g, char, { yOffset: 1 });
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
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 0 });
    drawTorsoBack(g, char, { yOffset: 0, pose: 'walk_swing_left' });
    drawHeadBack(g, char, { yOffset: 0 });
    frames.push(g);
  }
  // Frame 17: Pass
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 1 });
    drawTorsoBack(g, char, { yOffset: 1, pose: 'stand' });
    drawHeadBack(g, char, { yOffset: 1 });
    frames.push(g);
  }
  // Frame 18: Right foot forward
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 2 });
    drawTorsoBack(g, char, { yOffset: 0, pose: 'walk_swing_right' });
    drawHeadBack(g, char, { yOffset: 0 });
    frames.push(g);
  }
  // Frame 19: Pass
  {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char, { walkFrame: 3 });
    drawTorsoBack(g, char, { yOffset: 1, pose: 'stand' });
    drawHeadBack(g, char, { yOffset: 1 });
    frames.push(g);
  }

  // ==========================================
  // 20..22: TYPING (3 frames)
  // Sitting/standing at workstation desk with keyboard & monitor glow
  // ==========================================
  for (let t = 0; t < 3; t++) {
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 1, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 1 });

    // Desk surface line
    g.drawHLine(9, 21, 14, C.DARK_BROWN);
    g.drawHLine(8, 22, 16, C.CHESTNUT);
    g.drawHLine(8, 23, 16, C.RUSSET);

    // Mechanical keyboard
    g.fillRect(11, 20, 10, 2, C.DEEP_SLATE);
    g.drawHLine(12, 20, 8, C.SILVER);

    // Monitor screen glow on left/side
    const glowColor = char.id === 'codex' ? C.LIME : C.CYAN;
    const flicker = t % 2 === 0 ? glowColor : C.WHITE;
    g.fillRect(23, 15, 6, 7, C.BLACK);
    g.fillRect(24, 16, 4, 5, flicker);

    // Hands typing (moving up/down alternating)
    const leftY = t === 0 ? 19 : 20;
    const rightY = t === 2 ? 19 : 20;
    g.fillRect(12, leftY, 2, 2, char.skinMid);
    g.fillRect(18, rightY, 2, 2, char.skinMid);

    frames.push(g);
  }

  // ==========================================
  // 23..24: HANDOVER (2 frames)
  // Frame 23: Holding yellow ticket folder near chest
  // Frame 24: Stepping forward, extending folder outward
  // ==========================================
  {
    // Frame 23: Hold folder
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { pose: 'stand' });
    drawHeadFront(g, char);
    // Draw folder held at chest
    drawTicketFolder(g, 13, 15);
    // Hands holding sides
    g.fillRect(11, 17, 2, 2, char.skinMid);
    g.fillRect(20, 17, 2, 2, char.skinMid);
    frames.push(g);
  }
  {
    // Frame 24: Extend folder forward
    const g = new PixelGrid(32, 32);
    drawShadow(g, 18, 29, 7);
    // Forward step pose
    drawLegsFront(g, char, { walkFrame: 0 });
    drawTorsoFront(g, char, { pose: 'stand' });
    drawHeadFront(g, char);
    // Extended arms holding folder out towards right
    g.fillRect(
      17,
      16,
      5,
      2,
      char.suitColor || char.hoodieColor || char.coatColor,
    );
    drawTicketFolder(g, 21, 13);
    g.fillRect(20, 15, 2, 2, char.skinMid);
    frames.push(g);
  }

  // ==========================================
  // 25..26: REVIEW (2 frames)
  // Frame 25: Looking down at clipboard, reading criteria
  // Frame 26: Marking green checkmark, looking up approvingly
  // ==========================================
  {
    // Frame 25: Reading clipboard
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { pose: 'stand' });
    // Head looking down slightly
    drawHeadFront(g, char, { yOffset: 1 });
    // Clipboard in left hand
    drawClipboard(g, 9, 14, false);
    g.fillRect(8, 17, 2, 2, char.skinMid);
    // Pen in right hand
    g.fillRect(17, 16, 2, 2, char.skinMid);
    g.set(16, 17, C.YELLOW);
    g.set(15, 18, C.BLACK); // pen tip
    frames.push(g);
  }
  {
    // Frame 26: Green checkmark marked!
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { pose: 'stand' });
    // Head looking up happily
    drawHeadFront(g, char, { yOffset: 0 });
    // Clipboard with bright green checkmark
    drawClipboard(g, 9, 14, true);
    g.fillRect(8, 17, 2, 2, char.skinMid);
    // Right hand raised in check/thumbs up
    g.fillRect(18, 14, 2, 3, char.skinMid);
    g.set(18, 13, char.skinLight);
    frames.push(g);
  }

  // ==========================================
  // 27..28: COOLDOWN (2 frames)
  // Nightcap (Schlafmütze) + peaceful sleep + Zzz
  // ==========================================
  {
    // Frame 27: Sleep frame 1 (small z)
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 0, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 0, eyeState: 'sleep' });
    drawNightcapAndSleep(g, char, 0);
    frames.push(g);
  }
  {
    // Frame 28: Sleep frame 2 (bigger Zzz)
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 1, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 1, eyeState: 'sleep' });
    drawNightcapAndSleep(g, char, 1);
    frames.push(g);
  }

  // ==========================================
  // 29..31: EXTRA STATUS FRAMES (3 frames)
  // 29: Deep cooldown snooze
  // 30: Alert / Error (exclamation mark)
  // 31: Success / Victory (PR merged)
  // ==========================================
  {
    // 29: Deep cooldown
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char, { yOffset: 1, pose: 'stand' });
    drawHeadFront(g, char, { yOffset: 1, eyeState: 'sleep' });
    drawNightcapAndSleep(g, char, 1);
    frames.push(g);
  }
  {
    // 30: Alert / Error
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char);
    drawHeadFront(g, char);
    // Red exclamation bubble overhead
    g.fillRect(14, 1, 4, 5, C.RED);
    g.drawVLine(15, 2, 2, C.WHITE);
    g.drawVLine(16, 2, 2, C.WHITE);
    g.set(15, 5, C.WHITE);
    g.set(16, 5, C.WHITE);
    frames.push(g);
  }
  {
    // 31: Success / Victory
    const g = new PixelGrid(32, 32);
    drawShadow(g);
    drawLegsFront(g, char);
    drawTorsoFront(g, char);
    drawHeadFront(g, char);
    // Both arms raised triumphantly
    g.fillRect(
      8,
      12,
      2,
      5,
      char.suitColor || char.hoodieColor || char.coatColor,
    );
    g.fillRect(8, 10, 2, 2, char.skinMid);
    g.fillRect(
      22,
      12,
      2,
      5,
      char.suitColor || char.hoodieColor || char.coatColor,
    );
    g.fillRect(22, 10, 2, 2, char.skinMid);
    // Golden star sparkle above head
    g.set(16, 1, C.YELLOW);
    g.set(15, 2, C.YELLOW);
    g.set(16, 2, C.WHITE);
    g.set(17, 2, C.YELLOW);
    g.set(16, 3, C.YELLOW);
    frames.push(g);
  }

  return frames;
}

module.exports = {
  CHARACTERS,
  generateCharacterFrames,
};
