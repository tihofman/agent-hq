const { C } = require('./palette');
const { PixelGrid } = require('./grid');

/**
 * Generate 64 tiles (8x8 grid) of 32x32 pixels each
 * Returns an array of 64 PixelGrid objects
 */
function generateOfficeTiles() {
  const tiles = [];

  // Helper to create a 32x32 tile
  const t = () => new PixelGrid(32, 32);

  // ==========================================
  // ROW 0: FLOORS (BÖDEN)
  // ==========================================

  // 0: floor_parquet_light (Light oak parquet)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.PEACH);
    for (let py = 0; py < 32; py += 8) {
      g.drawHLine(0, py, 32, C.CHESTNUT);
      const offset = (py / 8) % 2 === 0 ? 0 : 16;
      g.drawVLine(offset, py, 8, C.CHESTNUT);
      g.drawVLine((offset + 16) % 32, py, 8, C.CHESTNUT);
      g.drawHLine(offset + 2, py + 2, 12, C.CREAM);
      g.drawHLine(((offset + 16) % 32) + 2, py + 2, 12, C.CREAM);
      g.drawHLine(offset + 4, py + 5, 8, C.COPPER);
      g.drawHLine(((offset + 16) % 32) + 4, py + 5, 8, C.COPPER);
    }
    tiles.push(g);
  }

  // 1: floor_parquet_dark (CEO walnut parquet)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.RUSSET);
    for (let py = 0; py < 32; py += 8) {
      g.drawHLine(0, py, 32, C.DARK_BROWN);
      const offset = (py / 8) % 2 === 0 ? 0 : 16;
      g.drawVLine(offset, py, 8, C.DARK_BROWN);
      g.drawVLine((offset + 16) % 32, py, 8, C.DARK_BROWN);
      g.drawHLine(offset + 2, py + 2, 12, C.CHESTNUT);
      g.drawHLine(((offset + 16) % 32) + 2, py + 2, 12, C.CHESTNUT);
      g.drawHLine(offset + 3, py + 5, 10, C.DARK_BROWN);
    }
    tiles.push(g);
  }

  // 2: floor_carpet_dev (Tech dev carpet in dark slate with subtle weave)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.MIDNIGHT);
    for (let y = 0; y < 32; y += 2) {
      for (let x = 0; x < 32; x += 2) {
        if ((x + y) % 4 === 0) {
          g.set(x, y, C.DEEP_SLATE);
        }
      }
    }
    tiles.push(g);
  }

  // 3: floor_carpet_hall (Hallway carpet with borders)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.ROYAL_BLUE);
    g.drawHLine(0, 0, 32, C.MIDNIGHT);
    g.drawHLine(0, 31, 32, C.MIDNIGHT);
    g.drawHLine(0, 2, 32, C.GOLD);
    g.drawHLine(0, 29, 32, C.GOLD);
    for (let x = 4; x < 32; x += 8) {
      g.set(x, 16, C.CYAN);
      g.set(x - 1, 15, C.CYAN);
      g.set(x + 1, 15, C.CYAN);
      g.set(x, 14, C.CYAN);
    }
    tiles.push(g);
  }

  // 4: floor_tile_lounge (Lounge terracotta ceramic tiles)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.COPPER);
    for (let y = 0; y < 32; y += 16) {
      g.drawHLine(0, y, 32, C.CREAM);
      for (let x = 0; x < 32; x += 16) {
        g.drawVLine(x, y, 16, C.CREAM);
        g.drawHLine(x + 1, y + 1, 14, C.WARM_PEACH);
        g.drawVLine(x + 1, y + 1, 14, C.WARM_PEACH);
        g.drawHLine(x + 1, y + 15, 14, C.RUST);
        g.drawVLine(x + 15, y + 1, 14, C.RUST);
      }
    }
    tiles.push(g);
  }

  // 5: floor_tech_raised (Server room raised floor tiles with vent grilles)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.STEEL);
    g.strokeRect(0, 0, 32, 32, C.BLACK);
    g.drawHLine(1, 1, 30, C.COOL_GRAY);
    g.drawVLine(1, 1, 30, C.COOL_GRAY);
    const bolts = [
      [3, 3],
      [28, 3],
      [3, 28],
      [28, 28],
    ];
    for (const [bx, by] of bolts) {
      g.set(bx, by, C.SILVER);
      g.set(bx + 1, by, C.BLACK);
    }
    for (let vy = 8; vy <= 23; vy += 3) {
      g.drawHLine(7, vy, 18, C.BLACK);
      g.drawHLine(7, vy + 1, 18, C.DEEP_SLATE);
    }
    tiles.push(g);
  }

  // 6: floor_transition_h (Horizontal wood-to-carpet threshold)
  {
    const g = t();
    g.fillRect(0, 0, 32, 14, C.PEACH);
    g.fillRect(0, 18, 32, 14, C.MIDNIGHT);
    g.fillRect(0, 14, 32, 4, C.GOLD);
    g.drawHLine(0, 14, 32, C.YELLOW);
    g.drawHLine(0, 17, 32, C.CHESTNUT);
    for (let rx = 4; rx < 32; rx += 8) {
      g.set(rx, 15, C.DARK_BROWN);
      g.set(rx, 16, C.YELLOW);
    }
    tiles.push(g);
  }

  // 7: floor_welcome_mat (Office doormat)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.PEACH);
    g.fillRect(3, 4, 26, 24, C.CHESTNUT);
    g.strokeRect(3, 4, 26, 24, C.BLACK);
    g.strokeRect(5, 6, 22, 20, C.COPPER);
    for (let y = 8; y < 24; y += 2) {
      for (let x = 7; x < 25; x += 2) {
        g.set(x, y, C.RUSSET);
      }
    }
    tiles.push(g);
  }

  // ==========================================
  // ROW 1: WALLS & WINDOWS (WÄNDE & GLAS)
  // ==========================================

  // 8: wall_top_molding (Crown molding with ceiling shadow)
  {
    const g = t();
    g.fillRect(0, 0, 32, 4, C.SILVER);
    g.drawHLine(0, 4, 32, C.COOL_GRAY);
    g.drawHLine(0, 5, 32, C.STEEL);
    g.fillRect(0, 6, 32, 26, C.SILVER);
    g.drawHLine(0, 6, 32, C.COOL_GRAY);
    tiles.push(g);
  }

  // 9: wall_drywall_mid (Mid wall panel)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.SILVER);
    g.drawVLine(31, 0, 32, C.COOL_GRAY);
    g.drawHLine(0, 0, 31, C.WHITE);
    tiles.push(g);
  }

  // 10: wall_baseboard (Wall base meeting floor)
  {
    const g = t();
    g.fillRect(0, 0, 32, 18, C.SILVER);
    g.drawHLine(0, 18, 32, C.COOL_GRAY);
    g.fillRect(0, 19, 32, 8, C.CHESTNUT);
    g.drawHLine(0, 19, 32, C.COPPER);
    g.drawHLine(0, 26, 32, C.DARK_BROWN);
    g.fillRect(0, 27, 32, 5, C.PEACH);
    g.drawHLine(0, 27, 32, C.BLACK);
    tiles.push(g);
  }

  // 11: wall_brick_accent (CEO brick accent wall)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.RUSSET);
    for (let y = 0; y < 32; y += 8) {
      g.drawHLine(0, y, 32, C.CREAM);
      const offset = (y / 8) % 2 === 0 ? 0 : 16;
      g.drawVLine(offset, y, 8, C.CREAM);
      g.drawVLine((offset + 16) % 32, y, 8, C.CREAM);
      g.drawHLine(offset + 1, y + 1, 14, C.RUST);
      g.drawHLine(((offset + 16) % 32) + 1, y + 1, 14, C.RUST);
      g.drawHLine(offset + 2, y + 6, 12, C.DARK_BROWN);
      g.drawHLine(((offset + 16) % 32) + 2, y + 6, 12, C.DARK_BROWN);
    }
    tiles.push(g);
  }

  // 12: wall_glass_top (Glass partition top)
  {
    const g = t();
    g.fillRect(0, 0, 32, 4, C.COOL_GRAY);
    g.drawHLine(0, 0, 32, C.SILVER);
    g.drawHLine(0, 3, 32, C.STEEL);
    g.fillRect(0, 4, 32, 28, C.CYAN);
    for (let d = 0; d < 20; d++) {
      g.set(5 + d, 5 + d, C.WHITE);
      g.set(6 + d, 5 + d, C.WHITE);
      g.set(18 + d, 4 + d, C.WHITE);
    }
    g.drawVLine(0, 4, 28, C.COOL_GRAY);
    g.drawVLine(31, 4, 28, C.STEEL);
    tiles.push(g);
  }

  // 13: wall_glass_bottom (Glass partition bottom with frosted band)
  {
    const g = t();
    g.fillRect(0, 0, 32, 24, C.CYAN);
    g.fillRect(0, 4, 32, 14, C.WHITE);
    g.drawHLine(0, 4, 32, C.SILVER);
    g.drawHLine(0, 17, 32, C.SILVER);
    g.fillRect(0, 24, 32, 8, C.COOL_GRAY);
    g.drawHLine(0, 24, 32, C.SILVER);
    g.drawHLine(0, 31, 32, C.STEEL);
    g.drawVLine(0, 0, 24, C.COOL_GRAY);
    g.drawVLine(31, 0, 24, C.STEEL);
    tiles.push(g);
  }

  // 14: wall_corner_left (Inner corner wall shadow)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.SILVER);
    g.fillRect(0, 0, 6, 32, C.COOL_GRAY);
    g.drawVLine(6, 0, 32, C.STEEL);
    tiles.push(g);
  }

  // 15: wall_corner_right (Outer corner edge)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.SILVER);
    g.drawVLine(29, 0, 32, C.WHITE);
    g.fillRect(30, 0, 2, 32, C.COOL_GRAY);
    tiles.push(g);
  }

  // ==========================================
  // ROW 2: DESKS & WORKSTATIONS (SCHREIBTISCH & MONITORE)
  // Standardized desk surface: y = 12..21, leg room / modesty panel: y = 22..29
  // ==========================================

  // 16: desk_wood_left (Desk left piece with drawers)
  {
    const g = t();
    // Desktop surface
    g.fillRect(4, 12, 28, 10, C.CHESTNUT);
    g.drawHLine(4, 12, 28, C.COPPER);
    g.drawVLine(4, 12, 10, C.COPPER);
    g.drawHLine(4, 21, 28, C.DARK_BROWN);

    // Left pedestal drawer unit
    g.fillRect(6, 22, 16, 8, C.RUSSET);
    g.drawVLine(5, 22, 8, C.DARK_BROWN);
    // 2 Drawers
    g.drawHLine(7, 22, 14, C.DARK_BROWN);
    g.drawHLine(11, 24, 6, C.SILVER); // handle 1
    g.drawHLine(7, 26, 14, C.DARK_BROWN);
    g.drawHLine(11, 28, 6, C.SILVER); // handle 2
    // Shadow
    g.drawHLine(5, 30, 27, C.BLACK);
    tiles.push(g);
  }

  // 17: desk_wood_center (Desk center modular piece)
  {
    const g = t();
    // Desktop surface
    g.fillRect(0, 12, 32, 10, C.CHESTNUT);
    g.drawHLine(0, 12, 32, C.COPPER);
    g.drawHLine(0, 21, 32, C.DARK_BROWN);
    // Modesty panel / leg space
    g.fillRect(0, 22, 32, 5, C.RUSSET);
    g.drawHLine(0, 26, 32, C.DARK_BROWN);
    g.fillRect(0, 27, 32, 4, C.BLACK); // deep shadow
    tiles.push(g);
  }

  // 18: desk_wood_right (Desk right piece with cable grommet)
  {
    const g = t();
    // Desktop surface
    g.fillRect(0, 12, 28, 10, C.CHESTNUT);
    g.drawHLine(0, 12, 28, C.COPPER);
    g.drawVLine(27, 12, 10, C.DARK_BROWN);
    g.drawHLine(0, 21, 28, C.DARK_BROWN);
    // Cable grommet hole
    g.fillRect(18, 14, 4, 3, C.BLACK);
    g.set(19, 15, C.STEEL);
    // Right legs
    g.fillRect(20, 22, 5, 8, C.STEEL);
    g.drawHLine(19, 30, 7, C.BLACK);
    tiles.push(g);
  }

  // 19: desk_tech_monitors (Dev desk with dual ultra-wide monitors)
  {
    const g = t();
    // Desktop surface aligned with other desks (y=12..21)
    g.fillRect(0, 12, 32, 10, C.CHESTNUT);
    g.drawHLine(0, 12, 32, C.COPPER);
    g.drawHLine(0, 21, 32, C.DARK_BROWN);

    // Left Monitor (y=1..11)
    g.fillRect(2, 1, 13, 10, C.BLACK);
    g.fillRect(3, 2, 11, 8, C.MIDNIGHT);
    g.drawHLine(4, 3, 7, C.LIME);
    g.drawHLine(4, 5, 9, C.CYAN);
    g.drawHLine(6, 7, 6, C.YELLOW);
    g.drawHLine(4, 8, 4, C.CORAL);
    g.drawVLine(8, 11, 2, C.STEEL);
    g.drawHLine(6, 13, 5, C.SILVER);

    // Right Monitor (y=1..11)
    g.fillRect(17, 1, 13, 10, C.BLACK);
    g.fillRect(18, 2, 11, 8, C.MIDNIGHT);
    g.drawHLine(19, 3, 8, C.LIME);
    g.drawHLine(19, 5, 9, C.LIME);
    g.drawHLine(19, 7, 7, C.WHITE);
    g.drawHLine(19, 8, 5, C.CYAN);
    g.drawVLine(23, 11, 2, C.STEEL);
    g.drawHLine(21, 13, 5, C.SILVER);

    // Modesty panel & shadow
    g.fillRect(0, 22, 32, 5, C.RUSSET);
    g.fillRect(0, 27, 32, 4, C.BLACK);
    tiles.push(g);
  }

  // 20: desk_laptop_coffee (Desk with laptop and steaming coffee)
  {
    const g = t();
    // Desktop surface aligned (y=12..21)
    g.fillRect(0, 12, 32, 10, C.CHESTNUT);
    g.drawHLine(0, 12, 32, C.COPPER);
    g.drawHLine(0, 21, 32, C.DARK_BROWN);

    // Open Laptop (y=3..15)
    g.fillRect(7, 3, 14, 9, C.BLACK);
    g.fillRect(8, 4, 12, 7, C.CYAN);
    g.drawHLine(9, 6, 8, C.WHITE);
    g.drawHLine(9, 8, 6, C.LIME);
    // Laptop keyboard base
    g.fillRect(5, 12, 18, 3, C.SILVER);
    g.fillRect(7, 13, 14, 1, C.BLACK);

    // Steaming Coffee Mug
    g.fillRect(25, 14, 5, 5, C.WHITE);
    g.set(24, 15, C.WHITE);
    g.set(24, 17, C.WHITE);
    g.drawHLine(26, 14, 3, C.DARK_BROWN);
    g.set(27, 12, C.CREAM);
    g.set(28, 11, C.CREAM);
    g.set(27, 10, C.CREAM);

    // Modesty panel & shadow
    g.fillRect(0, 22, 32, 5, C.RUSSET);
    g.fillRect(0, 27, 32, 4, C.BLACK);
    tiles.push(g);
  }

  // 21: chair_ergonomic_front (Office mesh chair front view)
  {
    const g = t();
    g.fillRect(8, 4, 16, 12, C.STEEL);
    g.strokeRect(8, 4, 16, 12, C.BLACK);
    for (let y = 6; y < 14; y += 2) {
      g.drawHLine(10, y, 12, C.COOL_GRAY);
    }
    g.fillRect(5, 13, 3, 5, C.BLACK);
    g.fillRect(24, 13, 3, 5, C.BLACK);
    g.fillRect(7, 16, 18, 6, C.MIDNIGHT);
    g.drawHLine(8, 16, 16, C.ROYAL_BLUE);
    g.drawHLine(7, 21, 18, C.BLACK);
    g.fillRect(15, 22, 2, 4, C.SILVER);
    g.drawHLine(9, 26, 14, C.BLACK);
    g.set(8, 27, C.BLACK);
    g.set(13, 27, C.BLACK);
    g.set(18, 27, C.BLACK);
    g.set(23, 27, C.BLACK);
    tiles.push(g);
  }

  // 22: chair_ergonomic_back (Office chair back view)
  {
    const g = t();
    g.fillRect(9, 4, 14, 12, C.BLACK);
    g.drawVLine(15, 4, 12, C.SILVER);
    g.drawHLine(11, 8, 10, C.SILVER);
    g.fillRect(5, 13, 3, 5, C.BLACK);
    g.fillRect(24, 13, 3, 5, C.BLACK);
    g.fillRect(7, 16, 18, 6, C.MIDNIGHT);
    g.drawHLine(7, 21, 18, C.BLACK);
    g.fillRect(15, 22, 2, 4, C.SILVER);
    g.drawHLine(9, 26, 14, C.BLACK);
    g.set(8, 27, C.BLACK);
    g.set(23, 27, C.BLACK);
    tiles.push(g);
  }

  // 23: workstation_pc_tower (Dev PC tower with RGB)
  {
    const g = t();
    g.fillRect(6, 4, 20, 25, C.BLACK);
    g.drawHLine(6, 4, 20, C.DEEP_SLATE);
    g.drawVLine(6, 4, 25, C.DEEP_SLATE);
    g.fillRect(9, 7, 14, 18, C.MIDNIGHT);
    g.fillRect(11, 9, 8, 4, C.CYAN);
    g.drawHLine(11, 15, 10, C.HOT_PINK);
    g.fillRect(13, 17, 6, 2, C.LIME);
    g.set(8, 6, C.CYAN);
    g.set(8, 8, C.SILVER);
    g.fillRect(8, 29, 4, 2, C.BLACK);
    g.fillRect(20, 29, 4, 2, C.BLACK);
    tiles.push(g);
  }

  // ==========================================
  // ROW 3: WHITEBOARD & BOOKSHELF (WHITEBOARD & REGAL)
  // Whiteboard 2x2: (24, 25) top, (26, 27) bottom
  // ==========================================

  // 24: whiteboard_top_left (Whiteboard top-left)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.WHITE);
    g.fillRect(0, 0, 32, 3, C.SILVER);
    g.fillRect(0, 0, 3, 32, C.SILVER);
    g.drawHLine(0, 0, 32, C.COOL_GRAY);
    g.drawVLine(0, 0, 32, C.COOL_GRAY);

    // "CLI" box
    g.strokeRect(6, 6, 10, 8, C.ROYAL_BLUE);
    g.drawHLine(8, 9, 6, C.ROYAL_BLUE);
    // Arrow down
    g.drawVLine(11, 14, 6, C.ROYAL_BLUE);
    g.set(10, 18, C.ROYAL_BLUE);
    g.set(12, 18, C.ROYAL_BLUE);
    // "CORE" box
    g.strokeRect(6, 21, 10, 9, C.ROYAL_BLUE);
    g.drawHLine(8, 24, 6, C.ROYAL_BLUE);

    // Arrow to right tile
    g.drawHLine(16, 10, 16, C.ROYAL_BLUE);
    g.set(29, 9, C.ROYAL_BLUE);
    g.set(29, 11, C.ROYAL_BLUE);
    tiles.push(g);
  }

  // 25: whiteboard_top_right (Whiteboard top-right with sticky notes)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.WHITE);
    g.fillRect(0, 0, 32, 3, C.SILVER);
    g.fillRect(29, 0, 3, 32, C.SILVER);
    g.drawHLine(0, 0, 32, C.COOL_GRAY);
    g.drawVLine(31, 0, 32, C.STEEL);

    // "UI" box
    g.strokeRect(4, 6, 12, 8, C.ROYAL_BLUE);
    g.drawHLine(6, 9, 8, C.ROYAL_BLUE);

    // Kanban sticky notes
    g.fillRect(19, 6, 7, 7, C.YELLOW);
    g.drawHLine(20, 8, 5, C.DARK_BROWN);
    g.drawHLine(20, 10, 4, C.DARK_BROWN);

    g.fillRect(6, 18, 7, 7, C.CORAL);
    g.drawHLine(7, 20, 5, C.CRIMSON);
    g.drawHLine(7, 22, 4, C.CRIMSON);

    g.fillRect(16, 19, 7, 7, C.CYAN);
    g.drawHLine(17, 21, 5, C.ROYAL_BLUE);
    g.drawHLine(17, 23, 4, C.ROYAL_BLUE);
    tiles.push(g);
  }

  // 26: whiteboard_bottom_left (Whiteboard bottom-left with marker tray)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.WHITE);
    g.fillRect(0, 0, 3, 32, C.SILVER);
    g.drawVLine(0, 0, 32, C.COOL_GRAY);
    g.fillRect(0, 26, 32, 6, C.SILVER);
    g.drawHLine(0, 31, 32, C.STEEL);

    // Marker tray
    g.fillRect(4, 24, 28, 4, C.COOL_GRAY);
    g.drawHLine(4, 24, 28, C.SILVER);
    g.fillRect(6, 23, 4, 2, C.BLACK);
    g.fillRect(12, 23, 4, 2, C.ROYAL_BLUE);
    g.fillRect(18, 23, 4, 2, C.RED);
    g.fillRect(24, 23, 4, 2, C.LIME);

    // Diagram box continued
    g.strokeRect(6, 2, 10, 10, C.ROYAL_BLUE);
    g.drawHLine(8, 6, 6, C.ROYAL_BLUE);
    tiles.push(g);
  }

  // 27: whiteboard_bottom_right (Whiteboard bottom-right with eraser)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.WHITE);
    g.fillRect(29, 0, 3, 32, C.SILVER);
    g.drawVLine(31, 0, 32, C.STEEL);
    g.fillRect(0, 26, 32, 6, C.SILVER);
    g.drawHLine(0, 31, 32, C.STEEL);

    // Marker tray continuing
    g.fillRect(0, 24, 26, 4, C.COOL_GRAY);
    g.drawHLine(0, 24, 26, C.SILVER);
    // Felt eraser
    g.fillRect(6, 21, 9, 4, C.MIDNIGHT);
    g.drawHLine(6, 21, 9, C.STEEL);
    g.drawHLine(6, 24, 9, C.COOL_GRAY);

    // Checkmark list
    g.set(5, 5, C.LIME);
    g.set(6, 6, C.LIME);
    g.set(7, 4, C.LIME);
    g.drawHLine(9, 5, 8, C.STEEL);

    g.set(5, 11, C.LIME);
    g.set(6, 12, C.LIME);
    g.set(7, 10, C.LIME);
    g.drawHLine(9, 11, 8, C.STEEL);
    tiles.push(g);
  }

  // 28: bookshelf_top (Bookshelf top unit with books)
  {
    const g = t();
    g.fillRect(3, 0, 26, 32, C.CHESTNUT);
    g.fillRect(5, 2, 22, 28, C.RUSSET);
    g.fillRect(3, 15, 26, 3, C.DARK_BROWN);
    g.drawHLine(3, 15, 26, C.COPPER);

    let bx = 6;
    const colors1 = [
      C.RED,
      C.ROYAL_BLUE,
      C.GOLD,
      C.LIME,
      C.PURPLE,
      C.CYAN,
      C.WHITE,
    ];
    for (const c of colors1) {
      g.fillRect(bx, 4, 2, 11, c);
      g.drawHLine(bx, 6, 2, C.GOLD);
      bx += 3;
    }

    bx = 6;
    const colors2 = [
      C.MIDNIGHT,
      C.STEEL,
      C.AUBERGINE,
      C.COPPER,
      C.PINE,
      C.SKY_BLUE,
    ];
    for (const c of colors2) {
      g.fillRect(bx, 18, 3, 12, c);
      g.set(bx + 1, 22, C.WHITE);
      bx += 3;
    }
    tiles.push(g);
  }

  // 29: bookshelf_bottom (Bookshelf bottom unit with cabinet)
  {
    const g = t();
    g.fillRect(3, 0, 26, 28, C.CHESTNUT);
    g.fillRect(5, 0, 22, 14, C.RUSSET);

    g.fillRect(3, 13, 26, 3, C.DARK_BROWN);
    g.drawHLine(3, 13, 26, C.COPPER);

    let bx = 6;
    for (let i = 0; i < 4; i++) {
      g.fillRect(bx, 2, 4, 11, i % 2 === 0 ? C.MIDNIGHT : C.DEEP_SLATE);
      g.fillRect(bx + 1, 4, 2, 4, C.CREAM);
      bx += 5;
    }

    g.fillRect(5, 16, 22, 12, C.DARK_BROWN);
    g.strokeRect(6, 17, 9, 10, C.CHESTNUT);
    g.strokeRect(17, 17, 9, 10, C.CHESTNUT);
    g.set(13, 22, C.SILVER);
    g.set(18, 22, C.SILVER);

    g.fillRect(3, 28, 26, 4, C.BLACK);
    tiles.push(g);
  }

  // 30: filing_cabinet (Metal office filing cabinet)
  {
    const g = t();
    g.fillRect(5, 2, 22, 28, C.COOL_GRAY);
    g.strokeRect(5, 2, 22, 28, C.STEEL);
    for (let dy = 4; dy <= 22; dy += 8) {
      g.strokeRect(7, dy, 18, 7, C.STEEL);
      g.fillRect(9, dy + 2, 5, 3, C.WHITE);
      g.strokeRect(9, dy + 2, 5, 3, C.BLACK);
      g.drawHLine(17, dy + 3, 5, C.SILVER);
      g.drawHLine(17, dy + 4, 5, C.BLACK);
    }
    g.fillRect(6, 30, 3, 2, C.BLACK);
    g.fillRect(23, 30, 3, 2, C.BLACK);
    tiles.push(g);
  }

  // 31: office_wastebin (Mesh trash can with paper)
  {
    const g = t();
    g.fillRect(8, 10, 16, 18, C.STEEL);
    g.strokeRect(8, 10, 16, 18, C.COOL_GRAY);
    for (let y = 12; y < 27; y += 3) {
      for (let x = 10; x < 23; x += 3) {
        g.set(x, y, C.MIDNIGHT);
      }
    }
    g.fillRect(11, 7, 5, 5, C.WHITE);
    g.fillRect(15, 8, 4, 4, C.CREAM);
    g.fillRect(13, 11, 6, 4, C.WHITE);
    g.fillRect(7, 28, 18, 3, C.BLACK);
    tiles.push(g);
  }

  // ==========================================
  // ROW 4: LOUNGE & BREAKROOM (COUCH, KAFFEEMASCHINE, PFLANZE)
  // Modular Couch 3x1: (32, 33, 34)
  // ==========================================

  // 32: couch_left (Lounge sofa left section)
  {
    const g = t();
    // Armrest
    g.fillRect(4, 8, 8, 17, C.DARK_TEAL);
    g.drawHLine(4, 8, 8, C.CYAN);
    g.drawVLine(4, 8, 17, C.CYAN);
    // Backrest
    g.fillRect(12, 8, 20, 7, C.DARK_TEAL);
    g.drawHLine(12, 8, 20, C.PINE);
    // Cushion
    g.fillRect(12, 15, 20, 10, C.PINE);
    g.drawHLine(12, 15, 20, C.GREEN);
    g.drawHLine(12, 24, 20, C.BLACK);
    // Wooden legs
    g.fillRect(6, 25, 3, 5, C.CHESTNUT);
    g.fillRect(28, 25, 3, 5, C.CHESTNUT);
    tiles.push(g);
  }

  // 33: couch_center (Lounge sofa center section with pillow)
  {
    const g = t();
    // Backrest seamlessly matching
    g.fillRect(0, 8, 32, 7, C.DARK_TEAL);
    g.drawHLine(0, 8, 32, C.PINE);
    // Cushion seamlessly matching
    g.fillRect(0, 15, 32, 10, C.PINE);
    g.drawHLine(0, 15, 32, C.GREEN);
    g.drawHLine(0, 24, 32, C.BLACK);
    // Throw pillow
    g.fillRect(10, 11, 12, 8, C.GOLD);
    g.drawHLine(11, 11, 10, C.YELLOW);
    g.drawHLine(10, 18, 12, C.COPPER);
    // Legs
    g.fillRect(14, 25, 4, 5, C.CHESTNUT);
    tiles.push(g);
  }

  // 34: couch_right (Lounge sofa right section)
  {
    const g = t();
    // Backrest
    g.fillRect(0, 8, 20, 7, C.DARK_TEAL);
    g.drawHLine(0, 8, 20, C.PINE);
    // Cushion
    g.fillRect(0, 15, 20, 10, C.PINE);
    g.drawHLine(0, 15, 20, C.GREEN);
    g.drawHLine(0, 24, 20, C.BLACK);
    // Right armrest
    g.fillRect(20, 8, 8, 17, C.DARK_TEAL);
    g.drawHLine(20, 8, 8, C.CYAN);
    g.drawVLine(27, 8, 17, C.BLACK);
    // Legs
    g.fillRect(1, 25, 3, 5, C.CHESTNUT);
    g.fillRect(23, 25, 3, 5, C.CHESTNUT);
    tiles.push(g);
  }

  // 35: coffee_table (Low wooden lounge coffee table)
  {
    const g = t();
    g.fillRect(4, 12, 24, 7, C.COPPER);
    g.drawHLine(4, 12, 24, C.WARM_PEACH);
    g.drawHLine(4, 18, 24, C.DARK_BROWN);
    g.fillRect(8, 13, 8, 4, C.WHITE);
    g.fillRect(9, 14, 6, 2, C.CRIMSON);
    g.fillRect(6, 19, 2, 8, C.CHESTNUT);
    g.fillRect(24, 19, 2, 8, C.CHESTNUT);
    g.drawHLine(5, 27, 22, C.BLACK);
    tiles.push(g);
  }

  // 36: coffee_counter_machine (Kitchen counter with espresso machine)
  {
    const g = t();
    g.fillRect(0, 18, 32, 5, C.SILVER);
    g.drawHLine(0, 18, 32, C.WHITE);
    g.drawHLine(0, 22, 32, C.COOL_GRAY);

    // Espresso Machine
    g.fillRect(6, 4, 20, 14, C.COOL_GRAY);
    g.strokeRect(6, 4, 20, 14, C.BLACK);
    g.drawHLine(7, 5, 18, C.SILVER);
    g.fillRect(12, 1, 8, 3, C.DARK_BROWN);
    g.fillRect(9, 7, 4, 4, C.WHITE);
    g.set(10, 8, C.RED);
    g.set(16, 7, C.LIME);
    g.set(18, 7, C.YELLOW);
    g.fillRect(13, 12, 6, 3, C.BLACK);
    g.drawHLine(11, 14, 10, C.SILVER);
    g.fillRect(13, 15, 3, 3, C.WHITE);
    g.fillRect(17, 15, 3, 3, C.WHITE);
    g.set(14, 16, C.DARK_BROWN);
    g.set(18, 16, C.DARK_BROWN);

    // Base cabinet top segment
    g.fillRect(0, 23, 32, 9, C.CHESTNUT);
    tiles.push(g);
  }

  // 37: coffee_counter_base (Kitchen cabinet base)
  {
    const g = t();
    g.fillRect(0, 0, 32, 28, C.CHESTNUT);
    g.strokeRect(2, 2, 13, 24, C.RUSSET);
    g.strokeRect(17, 2, 13, 24, C.RUSSET);
    g.drawVLine(13, 8, 12, C.SILVER);
    g.drawVLine(18, 8, 12, C.SILVER);
    g.fillRect(0, 28, 32, 4, C.BLACK);
    tiles.push(g);
  }

  // 38: water_cooler (Office water dispenser)
  {
    const g = t();
    g.fillRect(10, 2, 12, 11, C.SKY_BLUE);
    g.strokeRect(10, 2, 12, 11, C.ROYAL_BLUE);
    g.drawHLine(12, 4, 8, C.CYAN);
    g.drawVLine(11, 3, 9, C.WHITE);

    g.fillRect(8, 13, 16, 17, C.WHITE);
    g.strokeRect(8, 13, 16, 17, C.COOL_GRAY);

    g.fillRect(11, 16, 10, 8, C.STEEL);
    g.set(13, 17, C.CYAN);
    g.set(18, 17, C.RED);
    g.drawHLine(11, 23, 10, C.COOL_GRAY);
    g.fillRect(7, 30, 18, 2, C.BLACK);
    tiles.push(g);
  }

  // 39: potted_plant_monstera (Lush Monstera in terracotta pot)
  {
    const g = t();
    g.fillRect(5, 4, 9, 7, C.GREEN);
    g.fillRect(6, 3, 7, 9, C.LIME);
    g.set(9, 6, C.PINE);
    g.set(11, 7, C.PINE);

    g.fillRect(18, 2, 10, 8, C.GREEN);
    g.fillRect(19, 3, 8, 6, C.LIME);
    g.set(22, 5, C.PINE);

    g.fillRect(11, 8, 11, 8, C.LIME);
    g.drawVLine(16, 8, 8, C.PINE);

    g.drawVLine(10, 11, 8, C.PINE);
    g.drawVLine(16, 15, 5, C.PINE);
    g.drawVLine(22, 10, 10, C.PINE);

    g.fillRect(9, 19, 14, 3, C.COPPER);
    g.drawHLine(9, 19, 14, C.WARM_PEACH);
    g.fillRect(11, 22, 10, 8, C.RUST);
    g.drawVLine(11, 22, 8, C.COPPER);
    g.drawVLine(20, 22, 8, C.DARK_BROWN);
    g.fillRect(9, 30, 14, 2, C.BLACK);
    tiles.push(g);
  }

  // ==========================================
  // ROW 5: TECH INFRASTRUCTURE (SERVER-RACK & QA)
  // Server rack 1x2: 40 (top), 41 (bottom)
  // QA Dashboard 1x2: 42 (top), 43 (bottom)
  // ==========================================

  // 40: server_rack_top (42U Server rack upper unit)
  {
    const g = t();
    g.fillRect(4, 0, 24, 32, C.BLACK);
    g.strokeRect(4, 0, 24, 32, C.STEEL);
    g.drawHLine(4, 0, 24, C.COOL_GRAY);

    for (let sy = 3; sy <= 24; sy += 7) {
      g.fillRect(6, sy, 20, 5, C.DEEP_SLATE);
      g.strokeRect(6, sy, 20, 5, C.MIDNIGHT);
      g.drawHLine(8, sy + 1, 6, C.BLACK);
      g.drawHLine(8, sy + 3, 6, C.BLACK);
      g.set(16, sy + 1, C.LIME);
      g.set(18, sy + 1, C.CYAN);
      g.set(20, sy + 1, sy === 10 ? C.RED : C.LIME);
      g.set(22, sy + 1, C.YELLOW);
      g.drawHLine(16, sy + 3, 8, C.BLACK);
    }
    g.drawVLine(25, 2, 30, C.SKY_BLUE);
    g.drawVLine(26, 4, 28, C.YELLOW);
    tiles.push(g);
  }

  // 41: server_rack_bottom (Server rack lower unit)
  {
    const g = t();
    g.fillRect(4, 0, 24, 28, C.BLACK);
    g.strokeRect(4, 0, 24, 28, C.STEEL);

    // Cable continuation
    g.drawVLine(25, 0, 16, C.SKY_BLUE);
    g.drawVLine(26, 0, 14, C.YELLOW);

    for (let sy = 2; sy <= 16; sy += 7) {
      g.fillRect(6, sy, 18, 5, C.DEEP_SLATE);
      for (let dx = 8; dx <= 20; dx += 3) {
        g.set(dx, sy + 2, C.LIME);
      }
    }

    g.fillRect(6, 21, 20, 5, C.MIDNIGHT);
    for (let fx = 8; fx <= 20; fx += 6) {
      g.strokeRect(fx, 21, 5, 5, C.STEEL);
      g.set(fx + 2, 23, C.SILVER);
    }

    g.fillRect(4, 28, 5, 4, C.BLACK);
    g.fillRect(23, 28, 5, 4, C.BLACK);
    tiles.push(g);
  }

  // 42: qa_dashboard_wall_top (CI/CD Dashboard screen top)
  {
    const g = t();
    g.fillRect(2, 2, 28, 30, C.BLACK);
    g.strokeRect(2, 2, 28, 30, C.STEEL);
    g.fillRect(4, 4, 24, 28, C.MIDNIGHT);

    g.fillRect(4, 4, 24, 4, C.DARK_TEAL);
    g.drawHLine(6, 5, 12, C.WHITE);
    g.fillRect(20, 5, 6, 2, C.LIME);

    // Suite 1: PASS
    g.set(6, 11, C.LIME);
    g.set(7, 12, C.LIME);
    g.set(8, 10, C.LIME);
    g.drawHLine(11, 11, 14, C.WHITE);

    // Suite 2: PASS
    g.set(6, 17, C.LIME);
    g.set(7, 18, C.LIME);
    g.set(8, 16, C.LIME);
    g.drawHLine(11, 17, 12, C.CYAN);

    // Suite 3: PASS
    g.set(6, 23, C.LIME);
    g.set(7, 24, C.LIME);
    g.set(8, 22, C.LIME);
    g.drawHLine(11, 23, 15, C.WHITE);

    g.fillRect(6, 28, 20, 4, C.GREEN);
    g.drawHLine(8, 29, 16, C.WHITE);
    tiles.push(g);
  }

  // 43: qa_dashboard_wall_bottom (CI/CD Dashboard screen bottom)
  {
    const g = t();
    g.fillRect(2, 0, 28, 18, C.BLACK);
    g.strokeRect(2, 0, 28, 18, C.STEEL);
    g.fillRect(4, 0, 24, 16, C.MIDNIGHT);

    g.drawHLine(6, 12, 20, C.STEEL);
    g.drawVLine(6, 4, 9, C.STEEL);
    g.set(8, 10, C.CYAN);
    g.set(11, 8, C.CYAN);
    g.set(14, 9, C.CYAN);
    g.set(17, 6, C.CYAN);
    g.set(20, 5, C.LIME);
    g.set(23, 4, C.LIME);

    g.fillRect(13, 18, 6, 8, C.DEEP_SLATE);
    g.drawVLine(13, 18, 8, C.BLACK);
    g.drawVLine(18, 18, 8, C.COOL_GRAY);
    tiles.push(g);
  }

  // 44: potted_plant_succulent (Small desktop succulent)
  {
    const g = t();
    g.fillRect(13, 10, 6, 6, C.LIME);
    g.fillRect(11, 12, 10, 4, C.GREEN);
    g.set(16, 8, C.LIME);
    g.set(16, 12, C.PINE);

    g.fillRect(11, 16, 10, 8, C.WHITE);
    g.drawHLine(10, 16, 12, C.CREAM);
    g.drawVLine(11, 16, 8, C.CREAM);
    g.drawVLine(20, 16, 8, C.COOL_GRAY);
    g.drawHLine(10, 24, 12, C.BLACK);
    tiles.push(g);
  }

  // 45: wall_clock (Office analog clock)
  {
    const g = t();
    g.fillRect(8, 6, 16, 16, C.BLACK);
    g.fillRect(9, 5, 14, 18, C.BLACK);
    g.fillRect(10, 7, 12, 12, C.WHITE);
    g.set(15, 8, C.BLACK);
    g.set(16, 8, C.BLACK);
    g.set(20, 12, C.BLACK);
    g.set(20, 13, C.BLACK);
    g.set(15, 17, C.BLACK);
    g.set(16, 17, C.BLACK);
    g.set(11, 12, C.BLACK);
    g.set(11, 13, C.BLACK);
    g.set(15, 12, C.BLACK);
    g.set(14, 11, C.BLACK);
    g.set(13, 10, C.BLACK);
    g.set(16, 11, C.RED);
    g.set(17, 10, C.RED);
    tiles.push(g);
  }

  // 46: framed_architecture (Framed blueprint diagram)
  {
    const g = t();
    g.fillRect(5, 5, 22, 20, C.DARK_BROWN);
    g.strokeRect(5, 5, 22, 20, C.COPPER);
    g.fillRect(8, 8, 16, 14, C.ROYAL_BLUE);
    g.strokeRect(10, 10, 6, 5, C.WHITE);
    g.strokeRect(17, 14, 5, 5, C.WHITE);
    g.drawHLine(16, 12, 2, C.WHITE);
    g.drawVLine(18, 12, 2, C.WHITE);
    tiles.push(g);
  }

  // 47: drink_fridge (Glass-door energy drink fridge)
  {
    const g = t();
    g.fillRect(6, 2, 20, 28, C.BLACK);
    g.strokeRect(6, 2, 20, 28, C.COOL_GRAY);
    g.fillRect(8, 4, 16, 23, C.MIDNIGHT);

    g.drawHLine(8, 11, 16, C.SILVER);
    g.fillRect(9, 6, 3, 5, C.LIME);
    g.fillRect(13, 6, 3, 5, C.ORANGE);
    g.fillRect(17, 6, 3, 5, C.CYAN);
    g.fillRect(21, 6, 2, 5, C.RED);

    g.drawHLine(8, 18, 16, C.SILVER);
    g.fillRect(9, 13, 3, 5, C.PURPLE);
    g.fillRect(13, 13, 3, 5, C.CYAN);
    g.fillRect(17, 13, 3, 5, C.LIME);
    g.fillRect(21, 13, 2, 5, C.GOLD);

    g.fillRect(10, 20, 3, 6, C.WHITE);
    g.fillRect(15, 20, 3, 6, C.SKY_BLUE);

    g.set(9, 5, C.WHITE);
    g.set(10, 6, C.WHITE);
    g.set(11, 7, C.WHITE);
    tiles.push(g);
  }

  // ==========================================
  // ROW 6: MEETING & HALLWAY ELEMENTS
  // Round Meeting Table 2x2: (52, 53) top, (54, 55) bottom
  // ==========================================

  // 48: door_frame_top (Office doorway top)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.CHESTNUT);
    g.strokeRect(0, 0, 32, 32, C.DARK_BROWN);
    g.fillRect(4, 4, 24, 12, C.CYAN);
    g.drawHLine(6, 6, 12, C.WHITE);
    g.fillRect(4, 20, 24, 12, C.BLACK);
    tiles.push(g);
  }

  // 49: door_frame_bottom (Doorway open entrance)
  {
    const g = t();
    g.fillRect(0, 0, 4, 32, C.CHESTNUT);
    g.fillRect(28, 0, 4, 32, C.CHESTNUT);
    g.fillRect(4, 0, 24, 28, C.MIDNIGHT);
    g.fillRect(4, 28, 24, 4, C.GOLD);
    tiles.push(g);
  }

  // 50: floor_cable_bridge (Heavy-duty hazard floor ramp)
  {
    const g = t();
    g.fillRect(0, 0, 32, 32, C.MIDNIGHT);
    g.fillRect(0, 10, 32, 12, C.BLACK);
    for (let x = 0; x < 32; x += 8) {
      g.fillRect(x, 11, 4, 10, C.YELLOW);
    }
    g.drawHLine(0, 10, 32, C.STEEL);
    g.drawHLine(0, 21, 32, C.STEEL);
    tiles.push(g);
  }

  // 51: hallway_sign (Direction sign: CEO / DEV / LOUNGE)
  {
    const g = t();
    g.drawVLine(7, 0, 8, C.SILVER);
    g.drawVLine(24, 0, 8, C.SILVER);
    g.fillRect(3, 8, 26, 16, C.MIDNIGHT);
    g.strokeRect(3, 8, 26, 16, C.CYAN);
    g.drawHLine(6, 12, 8, C.WHITE);
    g.set(6, 11, C.WHITE);
    g.set(6, 13, C.WHITE);
    g.drawHLine(18, 18, 8, C.WHITE);
    g.set(25, 17, C.WHITE);
    g.set(25, 19, C.WHITE);
    tiles.push(g);
  }

  // 52: meeting_table_tl (Round conference table top-left)
  {
    const g = t();
    const R = 24;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const dx = 31 - x;
        const dy = 31 - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= R) {
          if (dist >= R - 2) {
            g.set(x, y, C.WARM_PEACH); // Edge highlight
          } else {
            g.set(x, y, C.CHESTNUT); // Wood surface
          }
        }
      }
    }
    tiles.push(g);
  }

  // 53: meeting_table_tr (Round conference table top-right)
  {
    const g = t();
    const R = 24;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const dx = x;
        const dy = 31 - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= R) {
          if (dist >= R - 2) {
            g.set(x, y, C.WARM_PEACH);
          } else {
            g.set(x, y, C.CHESTNUT);
          }
        }
      }
    }
    tiles.push(g);
  }

  // 54: meeting_table_bl (Round conference table bottom-left)
  {
    const g = t();
    const R = 24;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const dx = 31 - x;
        const dy = y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= R) {
          if (dist >= R - 2) {
            g.set(x, y, C.DARK_BROWN); // Bottom edge shadow
          } else {
            g.set(x, y, C.RUSSET); // Surface
          }
        }
      }
    }
    // Pedestal leg center corner
    g.fillRect(28, 0, 4, 10, C.BLACK);
    tiles.push(g);
  }

  // 55: meeting_table_br (Round conference table bottom-right)
  {
    const g = t();
    const R = 24;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const dx = x;
        const dy = y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= R) {
          if (dist >= R - 2) {
            g.set(x, y, C.DARK_BROWN);
          } else {
            g.set(x, y, C.RUSSET);
          }
        }
      }
    }
    // Pedestal leg center corner
    g.fillRect(0, 0, 4, 10, C.BLACK);
    tiles.push(g);
  }

  // ==========================================
  // ROW 7: PROPS, WINDOWS & EMERGENCY EXIT
  // ==========================================

  // 56: pizza_box_open (Open pizza box with pizza)
  {
    const g = t();
    g.fillRect(4, 6, 24, 20, C.CREAM);
    g.strokeRect(4, 6, 24, 20, C.COPPER);

    g.fillRect(8, 8, 16, 16, C.GOLD);
    g.fillRect(10, 6, 12, 20, C.GOLD);
    g.drawHLine(10, 7, 12, C.COPPER);
    g.drawHLine(10, 24, 12, C.COPPER);

    const peps = [
      [11, 10],
      [18, 10],
      [14, 14],
      [10, 18],
      [18, 18],
    ];
    for (const [px, py] of peps) {
      g.fillRect(px, py, 3, 3, C.CRIMSON);
      g.set(px + 1, py + 1, C.RED);
    }
    g.set(13, 11, C.YELLOW);
    g.set(16, 16, C.YELLOW);
    tiles.push(g);
  }

  // 57: donut_box (Bakery box with frosted donuts)
  {
    const g = t();
    g.fillRect(5, 7, 22, 18, C.WHITE);
    g.strokeRect(5, 7, 22, 18, C.CORAL);

    g.fillRect(7, 10, 8, 6, C.HOT_PINK);
    g.set(10, 12, C.CREAM);
    g.set(8, 11, C.YELLOW);
    g.set(12, 14, C.CYAN);

    g.fillRect(17, 10, 8, 6, C.DARK_BROWN);
    g.set(20, 12, C.CREAM);
    g.set(18, 11, C.WHITE);

    g.fillRect(12, 17, 8, 6, C.COPPER);
    g.set(15, 19, C.CREAM);
    g.drawHLine(13, 18, 6, C.CREAM);
    tiles.push(g);
  }

  // 58: retro_crt_terminal (Vintage phosphor green CRT)
  {
    const g = t();
    g.fillRect(5, 4, 22, 20, C.CREAM);
    g.strokeRect(5, 4, 22, 20, C.COPPER);

    g.fillRect(8, 7, 16, 12, C.BLACK);
    g.set(10, 9, C.LIME);
    g.set(11, 10, C.LIME);
    g.set(10, 11, C.LIME);
    g.drawHLine(13, 11, 7, C.LIME);
    g.set(21, 11, C.WHITE);

    g.fillRect(12, 24, 8, 4, C.COPPER);
    g.drawHLine(10, 27, 12, C.DARK_BROWN);
    tiles.push(g);
  }

  // 59: trophy_shelf (Golden trophy award on shelf)
  {
    const g = t();
    g.fillRect(2, 20, 28, 3, C.CYAN);
    g.drawHLine(2, 20, 28, C.WHITE);
    g.drawHLine(2, 22, 28, C.STEEL);

    g.fillRect(12, 6, 8, 6, C.GOLD);
    g.fillRect(13, 7, 6, 5, C.YELLOW);
    g.set(10, 8, C.GOLD);
    g.set(10, 9, C.GOLD);
    g.set(21, 8, C.GOLD);
    g.set(21, 9, C.GOLD);
    g.fillRect(15, 12, 2, 4, C.GOLD);
    g.fillRect(13, 16, 6, 4, C.DARK_BROWN);
    g.set(15, 18, C.GOLD);
    tiles.push(g);
  }

  // 60: window_skyline_day (Office window daylight skyline)
  {
    const g = t();
    g.strokeRect(2, 2, 28, 28, C.COOL_GRAY);
    g.drawHLine(2, 16, 28, C.COOL_GRAY);
    g.drawVLine(16, 2, 28, C.COOL_GRAY);

    g.fillRect(3, 3, 26, 13, C.SKY_BLUE);
    g.fillRect(3, 17, 26, 12, C.SKY_BLUE);
    g.fillRect(5, 5, 4, 4, C.YELLOW);

    g.fillRect(10, 8, 5, 8, C.STEEL);
    g.fillRect(18, 10, 7, 6, C.MIDNIGHT);
    g.fillRect(10, 17, 5, 10, C.STEEL);
    g.fillRect(18, 17, 7, 10, C.MIDNIGHT);
    g.set(11, 19, C.YELLOW);
    g.set(13, 19, C.YELLOW);
    g.set(11, 22, C.YELLOW);
    g.set(20, 19, C.CYAN);
    g.set(23, 19, C.CYAN);
    tiles.push(g);
  }

  // 61: window_skyline_night (Office window night skyline)
  {
    const g = t();
    g.strokeRect(2, 2, 28, 28, C.COOL_GRAY);
    g.drawHLine(2, 16, 28, C.COOL_GRAY);
    g.drawVLine(16, 2, 28, C.COOL_GRAY);

    g.fillRect(3, 3, 26, 13, C.BLACK);
    g.fillRect(3, 17, 26, 12, C.BLACK);
    g.set(6, 5, C.WHITE);
    g.set(22, 6, C.WHITE);
    g.set(8, 11, C.WHITE);
    g.fillRect(24, 4, 3, 3, C.CREAM);

    g.fillRect(9, 7, 6, 9, C.MIDNIGHT);
    g.fillRect(18, 9, 7, 7, C.DEEP_SLATE);
    g.fillRect(9, 17, 6, 12, C.MIDNIGHT);
    g.fillRect(18, 17, 7, 12, C.DEEP_SLATE);
    g.set(11, 10, C.YELLOW);
    g.set(13, 12, C.YELLOW);
    g.set(11, 20, C.YELLOW);
    g.set(13, 23, C.YELLOW);
    g.set(20, 20, C.YELLOW);
    g.set(23, 22, C.YELLOW);
    tiles.push(g);
  }

  // 62: exit_sign (Illuminated green EXIT sign)
  {
    const g = t();
    g.fillRect(4, 9, 24, 14, C.GREEN);
    g.strokeRect(4, 9, 24, 14, C.PINE);
    g.drawHLine(5, 10, 22, C.LIME);

    // E
    g.drawVLine(7, 13, 6, C.WHITE);
    g.drawHLine(7, 13, 3, C.WHITE);
    g.drawHLine(7, 15, 2, C.WHITE);
    g.drawHLine(7, 18, 3, C.WHITE);
    // X
    g.set(12, 13, C.WHITE);
    g.set(14, 13, C.WHITE);
    g.set(13, 15, C.WHITE);
    g.set(12, 17, C.WHITE);
    g.set(14, 17, C.WHITE);
    // I
    g.drawVLine(17, 13, 6, C.WHITE);
    // T
    g.drawHLine(20, 13, 5, C.WHITE);
    g.drawVLine(22, 13, 6, C.WHITE);
    tiles.push(g);
  }

  // 63: ambient_occlusion_shadow (Corner shadow tile)
  {
    const g = t();
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        if (x + y < 8) {
          g.set(x, y, C.BLACK);
        } else if (x + y < 14) {
          if ((x + y) % 2 === 0) g.set(x, y, C.MIDNIGHT);
        }
      }
    }
    tiles.push(g);
  }

  return tiles;
}

const TILE_CATALOG = [
  // Row 0: Floors
  { id: 0, name: 'floor_parquet_light', category: 'floor' },
  { id: 1, name: 'floor_parquet_dark', category: 'floor' },
  { id: 2, name: 'floor_carpet_dev', category: 'floor' },
  { id: 3, name: 'floor_carpet_hall', category: 'floor' },
  { id: 4, name: 'floor_tile_lounge', category: 'floor' },
  { id: 5, name: 'floor_tech_raised', category: 'floor' },
  { id: 6, name: 'floor_transition_h', category: 'floor' },
  { id: 7, name: 'floor_welcome_mat', category: 'floor' },

  // Row 1: Walls
  { id: 8, name: 'wall_top_molding', category: 'wall' },
  { id: 9, name: 'wall_drywall_mid', category: 'wall' },
  { id: 10, name: 'wall_baseboard', category: 'wall' },
  { id: 11, name: 'wall_brick_accent', category: 'wall' },
  { id: 12, name: 'wall_glass_top', category: 'wall' },
  { id: 13, name: 'wall_glass_bottom', category: 'wall' },
  { id: 14, name: 'wall_corner_left', category: 'wall' },
  { id: 15, name: 'wall_corner_right', category: 'wall' },

  // Row 2: Desks & Workstations
  { id: 16, name: 'desk_wood_left', category: 'desk' },
  { id: 17, name: 'desk_wood_center', category: 'desk' },
  { id: 18, name: 'desk_wood_right', category: 'desk' },
  { id: 19, name: 'desk_tech_monitors', category: 'desk' },
  { id: 20, name: 'desk_laptop_coffee', category: 'desk' },
  { id: 21, name: 'chair_ergonomic_front', category: 'furniture' },
  { id: 22, name: 'chair_ergonomic_back', category: 'furniture' },
  { id: 23, name: 'workstation_pc_tower', category: 'tech' },

  // Row 3: Whiteboard & Bookshelves
  { id: 24, name: 'whiteboard_top_left', category: 'whiteboard' },
  { id: 25, name: 'whiteboard_top_right', category: 'whiteboard' },
  { id: 26, name: 'whiteboard_bottom_left', category: 'whiteboard' },
  { id: 27, name: 'whiteboard_bottom_right', category: 'whiteboard' },
  { id: 28, name: 'bookshelf_top', category: 'furniture' },
  { id: 29, name: 'bookshelf_bottom', category: 'furniture' },
  { id: 30, name: 'filing_cabinet', category: 'furniture' },
  { id: 31, name: 'office_wastebin', category: 'props' },

  // Row 4: Lounge & Breakroom
  { id: 32, name: 'couch_left', category: 'couch' },
  { id: 33, name: 'couch_center', category: 'couch' },
  { id: 34, name: 'couch_right', category: 'couch' },
  { id: 35, name: 'coffee_table', category: 'furniture' },
  { id: 36, name: 'coffee_counter_machine', category: 'kitchen' },
  { id: 37, name: 'coffee_counter_base', category: 'kitchen' },
  { id: 38, name: 'water_cooler', category: 'kitchen' },
  { id: 39, name: 'potted_plant_monstera', category: 'plant' },

  // Row 5: Infrastructure & QA
  { id: 40, name: 'server_rack_top', category: 'server' },
  { id: 41, name: 'server_rack_bottom', category: 'server' },
  { id: 42, name: 'qa_dashboard_wall_top', category: 'qa' },
  { id: 43, name: 'qa_dashboard_wall_bottom', category: 'qa' },
  { id: 44, name: 'potted_plant_succulent', category: 'plant' },
  { id: 45, name: 'wall_clock', category: 'props' },
  { id: 46, name: 'framed_architecture', category: 'props' },
  { id: 47, name: 'drink_fridge', category: 'kitchen' },

  // Row 6: Meeting & Hallway
  { id: 48, name: 'door_frame_top', category: 'door' },
  { id: 49, name: 'door_frame_bottom', category: 'door' },
  { id: 50, name: 'floor_cable_bridge', category: 'floor' },
  { id: 51, name: 'hallway_sign', category: 'props' },
  { id: 52, name: 'meeting_table_tl', category: 'furniture' },
  { id: 53, name: 'meeting_table_tr', category: 'furniture' },
  { id: 54, name: 'meeting_table_bl', category: 'furniture' },
  { id: 55, name: 'meeting_table_br', category: 'furniture' },

  // Row 7: Props, Windows & Exit
  { id: 56, name: 'pizza_box_open', category: 'props' },
  { id: 57, name: 'donut_box', category: 'props' },
  { id: 58, name: 'retro_crt_terminal', category: 'tech' },
  { id: 59, name: 'trophy_shelf', category: 'props' },
  { id: 60, name: 'window_skyline_day', category: 'window' },
  { id: 61, name: 'window_skyline_night', category: 'window' },
  { id: 62, name: 'exit_sign', category: 'props' },
  { id: 63, name: 'ambient_occlusion_shadow', category: 'shadow' },
];

module.exports = {
  generateOfficeTiles,
  TILE_CATALOG,
};
