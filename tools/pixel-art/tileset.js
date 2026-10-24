const { C } = require('./palette');
const { PixelGrid } = require('./grid');

/**
 * Generate 64 tiles (8x8 grid) of 128x128 pixels each
 * Returns an array of 64 PixelGrid objects
 */
function generateOfficeTiles() {
  const tiles = [];

  // Helper to create a 128x128 tile
  const t = () => new PixelGrid(128, 128);

  // ==========================================
  // ROW 0: FLOORS (BÖDEN)
  // ==========================================

  // 0: floor_parquet_light (Light oak parquet with planks, bevels and wood grain)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.PEACH);
    // 4 horizontal plank rows of 32px height each
    for (let py = 0; py < 128; py += 32) {
      // Horizontal groove separating planks
      g.drawHLine(0, py, 128, C.CHESTNUT);
      g.drawHLine(0, py + 1, 128, C.DARK_BROWN);
      g.drawHLine(0, py + 2, 128, C.CREAM); // top bevel highlight

      // Staggered vertical joints
      const offset = (py / 32) % 2 === 0 ? 0 : 64;
      for (let px = offset; px < 128; px += 64) {
        g.drawVLine(px, py + 2, 30, C.CHESTNUT);
        g.drawVLine(px + 1, py + 2, 30, C.DARK_BROWN);
        g.drawVLine(px + 2, py + 2, 30, C.CREAM); // bevel highlight
      }

      // Rich wood grain streaks inside each plank
      for (let i = 0; i < 4; i++) {
        const gy = py + 6 + i * 6;
        g.drawHLine(4, gy, 56, C.CREAM);
        g.drawHLine(68, gy + 2, 56, C.COPPER);
        g.drawHLine(12, gy + 4, 40, C.WARM_PEACH);
      }
      // Knot accents
      const kx = (offset + 28) % 128;
      g.fillEllipse(kx, py + 16, 4, 3, C.COPPER);
      g.fillEllipse(kx, py + 16, 2, 1, C.CHESTNUT);
    }
    tiles.push(g);
  }

  // 1: floor_parquet_dark (CEO walnut parquet)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.RUSSET);
    for (let py = 0; py < 128; py += 32) {
      g.drawHLine(0, py, 128, C.DARK_BROWN);
      g.drawHLine(0, py + 1, 128, C.BLACK);
      g.drawHLine(0, py + 2, 128, C.CHESTNUT);

      const offset = (py / 32) % 2 === 0 ? 0 : 64;
      for (let px = offset; px < 128; px += 64) {
        g.drawVLine(px, py + 2, 30, C.DARK_BROWN);
        g.drawVLine(px + 1, py + 2, 30, C.BLACK);
        g.drawVLine(px + 2, py + 2, 30, C.CHESTNUT);
      }

      for (let i = 0; i < 4; i++) {
        const gy = py + 6 + i * 6;
        g.drawHLine(6, gy, 52, C.CHESTNUT);
        g.drawHLine(70, gy + 3, 52, C.DARK_BROWN);
      }
    }
    tiles.push(g);
  }

  // 2: floor_carpet_dev (Tech dev carpet with woven fabric micro-pattern)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.MIDNIGHT);
    // Subtle cross-hatch carpet weave
    for (let y = 0; y < 128; y += 4) {
      for (let x = 0; x < 128; x += 4) {
        if ((x + y) % 8 === 0) {
          g.set(x, y, C.DEEP_SLATE);
          g.set(x + 1, y, C.DEEP_SLATE);
        } else if ((x - y + 128) % 8 === 0) {
          g.set(x, y, C.STEEL);
        }
      }
    }
    // Tile seams (128x128 carpet squares)
    g.drawHLine(0, 0, 128, C.BLACK);
    g.drawVLine(0, 0, 128, C.BLACK);
    tiles.push(g);
  }

  // 3: floor_carpet_hall (Hallway carpet with royal blue base, gold trim, cyan diamond inlays)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.ROYAL_BLUE);
    // Darker borders
    g.fillRect(0, 0, 128, 12, C.MIDNIGHT);
    g.fillRect(0, 116, 128, 12, C.MIDNIGHT);
    // Gold ornamental trims
    g.drawHLine(0, 12, 128, C.GOLD);
    g.drawHLine(0, 13, 128, C.YELLOW);
    g.drawHLine(0, 14, 128, C.GOLD);

    g.drawHLine(0, 113, 128, C.GOLD);
    g.drawHLine(0, 114, 128, C.YELLOW);
    g.drawHLine(0, 115, 128, C.GOLD);

    // Center decorative runner pattern with cyan diamonds
    for (let cx = 16; cx < 128; cx += 32) {
      const cy = 64;
      g.fillCircle(cx, cy, 10, C.MIDNIGHT);
      // Diamond
      for (let d = 0; d <= 8; d++) {
        g.drawHLine(cx - d, cy - 8 + d, d * 2 + 1, C.CYAN);
        g.drawHLine(cx - d, cy + 8 - d, d * 2 + 1, C.CYAN);
      }
      g.fillCircle(cx, cy, 3, C.WHITE);
    }
    tiles.push(g);
  }

  // 4: floor_tile_lounge (Lounge terracotta ceramic tiles with grout and bevels)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.COPPER);
    // 2x2 large 64x64 tiles
    for (let py = 0; py < 128; py += 64) {
      g.fillRect(0, py, 128, 4, C.CREAM); // horizontal grout
      for (let px = 0; px < 128; px += 64) {
        g.fillRect(px, py, 4, 64, C.CREAM); // vertical grout

        // Top/left bevel highlight
        g.drawHLine(px + 4, py + 4, 56, C.WARM_PEACH);
        g.drawVLine(px + 4, py + 4, 56, C.WARM_PEACH);

        // Bottom/right bevel shadow
        g.drawHLine(px + 4, py + 60, 56, C.RUST);
        g.drawVLine(px + 60, py + 4, 56, C.RUST);

        // Ceramic surface variation
        g.fillRect(px + 12, py + 12, 40, 40, C.COPPER);
        g.drawHLine(px + 16, py + 20, 24, C.PEACH);
        g.drawHLine(px + 20, py + 36, 20, C.RUST);
      }
    }
    tiles.push(g);
  }

  // 5: floor_tech_raised (Server room raised floor tiles with vent grilles and screws)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.DEEP_SLATE);
    // 2x2 64x64 metal access panels
    for (let py = 0; py < 128; py += 64) {
      g.fillRect(0, py, 128, 3, C.BLACK);
      for (let px = 0; px < 128; px += 64) {
        g.fillRect(px, py, 3, 64, C.BLACK);
        // Panel face
        g.fillRect(px + 3, py + 3, 58, 58, C.STEEL);
        g.drawHLine(px + 4, py + 4, 56, C.SILVER);
        g.drawVLine(px + 4, py + 4, 56, C.SILVER);
        g.drawHLine(px + 4, py + 60, 56, C.MIDNIGHT);
        g.drawVLine(px + 60, py + 4, 56, C.MIDNIGHT);

        // Perforated ventilation grille
        for (let gy = py + 16; gy <= py + 48; gy += 6) {
          for (let gx = px + 16; gx <= px + 48; gx += 6) {
            g.fillRect(gx, gy, 3, 3, C.BLACK);
            g.set(gx + 1, gy + 1, C.MIDNIGHT);
          }
        }

        // Corner hex bolts
        const corners = [
          [px + 8, py + 8],
          [px + 53, py + 8],
          [px + 8, py + 53],
          [px + 53, py + 53],
        ];
        for (const [bx, by] of corners) {
          g.fillCircle(bx, by, 3, C.COOL_GRAY);
          g.set(bx, by, C.WHITE);
        }
      }
    }
    tiles.push(g);
  }

  // 6: floor_trim_wood (Transition strip between flooring types)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.PEACH);
    // Metal / hardwood transition ramp in center
    g.fillRect(0, 48, 128, 32, C.COPPER);
    g.drawHLine(0, 48, 128, C.CHESTNUT);
    g.drawHLine(0, 49, 128, C.DARK_BROWN);
    g.drawHLine(0, 50, 128, C.CREAM); // bevel highlight
    g.drawHLine(0, 78, 128, C.CHESTNUT);
    g.drawHLine(0, 79, 128, C.BLACK);

    // Fastener screws along the strip
    for (let x = 16; x < 128; x += 32) {
      g.fillCircle(x, 64, 4, C.STEEL);
      g.drawHLine(x - 2, 64, 5, C.WHITE); // screw slot
    }
    tiles.push(g);
  }

  // 7: floor_mat_welcome (Heavy-duty ribbed welcome mat)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.ROYAL_BLUE); // surrounding floor
    // Black rubber mat perimeter
    g.fillRoundedRect(12, 12, 104, 104, 6, C.BLACK);
    // Ribbed charcoal coir interior
    g.fillRect(18, 18, 92, 92, C.DEEP_SLATE);
    for (let y = 22; y <= 104; y += 6) {
      g.drawHLine(20, y, 88, C.STEEL);
      g.drawHLine(20, y + 1, 88, C.MIDNIGHT);
    }
    tiles.push(g);
  }

  // ==========================================
  // ROW 1: WALLS (WÄNDE)
  // ==========================================

  // 8: wall_top_molding (Crown ceiling molding)
  {
    const g = t();
    // Lower painted drywall
    g.fillRect(0, 0, 128, 128, C.SILVER);
    // Ceiling molding steps
    g.fillRect(0, 0, 128, 8, C.WHITE);
    g.fillRect(0, 8, 128, 6, C.COOL_GRAY);
    g.drawHLine(0, 13, 128, C.STEEL);
    g.fillRect(0, 14, 128, 12, C.WHITE);
    g.drawHLine(0, 25, 128, C.COOL_GRAY);
    g.drawHLine(0, 26, 128, C.STEEL);
    // Cast shadow on wall below
    g.fillRect(0, 27, 128, 6, C.COOL_GRAY);
    tiles.push(g);
  }

  // 9: wall_drywall_mid (Clean painted drywall)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.SILVER);
    // Very subtle wall texture / vertical seams
    for (let y = 0; y < 128; y += 8) {
      g.drawHLine(0, y, 128, C.WHITE);
    }
    tiles.push(g);
  }

  // 10: wall_baseboard (Drywall top with rich baseboard plinth at bottom)
  {
    const g = t();
    // Upper wall
    g.fillRect(0, 0, 128, 84, C.SILVER);
    // Baseboard upper molding
    g.fillRect(0, 84, 128, 6, C.WHITE);
    g.drawHLine(0, 89, 128, C.COOL_GRAY);
    // Main baseboard face
    g.fillRect(0, 90, 128, 32, C.CHESTNUT);
    g.drawHLine(0, 90, 128, C.CREAM); // top bevel
    g.drawHLine(0, 104, 128, C.COPPER); // grain
    // Shoe molding & floor drop shadow
    g.fillRect(0, 122, 128, 4, C.DARK_BROWN);
    g.drawHLine(0, 126, 128, C.BLACK);
    g.drawHLine(0, 127, 128, C.BLACK);
    tiles.push(g);
  }

  // 11: wall_brick_accent (Exposed brick accent wall)
  {
    const g = t();
    // Mortar base
    g.fillRect(0, 0, 128, 128, C.CREAM);
    // Bricks in running bond (layers of 20px height)
    const brickH = 18;
    const mortar = 3;
    for (let py = 0; py < 128; py += brickH + mortar) {
      const isShifted = Math.floor(py / (brickH + mortar)) % 2 === 1;
      const offset = isShifted ? -20 : 0;
      for (let px = offset; px < 128 + 40; px += 44) {
        const brickW = 40;
        const color =
          (px + py) % 3 === 0
            ? C.RUST
            : (px + py) % 3 === 1
              ? C.CRIMSON
              : C.CHESTNUT;
        g.fillRect(
          Math.max(0, px),
          py,
          Math.min(brickW, 128 - px),
          brickH,
          color,
        );
        // Brick top highlight
        g.drawHLine(Math.max(0, px), py, Math.min(brickW, 128 - px), C.COPPER);
        // Brick bottom shadow
        g.drawHLine(
          Math.max(0, px),
          py + brickH - 1,
          Math.min(brickW, 128 - px),
          C.DARK_BROWN,
        );
      }
    }
    tiles.push(g);
  }

  // 12: wall_glass_top (Modern glass partition top)
  {
    const g = t();
    // Aluminum ceiling channel
    g.fillRect(0, 0, 128, 14, C.STEEL);
    g.fillRect(0, 2, 128, 10, C.SILVER);
    g.drawHLine(0, 13, 128, C.BLACK);

    // Glass panel with diagonal glare reflection streaks
    g.fillRect(0, 14, 128, 114, C.DARK_TEAL);
    for (let d = 20; d < 128; d += 40) {
      g.drawLine(d, 14, d + 40, 128, C.CYAN);
      g.drawLine(d + 1, 14, d + 41, 128, C.WHITE);
      g.drawLine(d + 2, 14, d + 42, 128, C.CYAN);
    }
    tiles.push(g);
  }

  // 13: wall_glass_bottom (Glass partition bottom with floor clamps and frost lines)
  {
    const g = t();
    g.fillRect(0, 0, 128, 114, C.DARK_TEAL);
    // Frosted privacy stripes
    for (let y = 20; y <= 80; y += 12) {
      g.fillRect(0, y, 128, 6, C.SKY_BLUE);
      g.drawHLine(0, y + 1, 128, C.CYAN);
    }
    // Stainless steel floor clamps
    for (let x = 24; x < 128; x += 48) {
      g.fillRect(x, 98, 16, 20, C.SILVER);
      g.strokeRect(x, 98, 16, 20, C.STEEL);
      g.set(x + 8, 108, C.BLACK); // screw
    }
    // Bottom floor track
    g.fillRect(0, 118, 128, 10, C.STEEL);
    g.drawHLine(0, 118, 128, C.SILVER);
    tiles.push(g);
  }

  // 14: wall_corner_left (Left wall corner)
  {
    const g = t();
    // Left side facing right (shadowed)
    g.fillRect(0, 0, 48, 128, C.COOL_GRAY);
    // Right side facing forward
    g.fillRect(48, 0, 80, 128, C.SILVER);
    // Vertical corner seam
    g.drawVLine(47, 0, 128, C.STEEL);
    g.drawVLine(48, 0, 128, C.WHITE);
    tiles.push(g);
  }

  // 15: wall_corner_right (Right wall corner)
  {
    const g = t();
    g.fillRect(0, 0, 80, 128, C.SILVER);
    g.fillRect(80, 0, 48, 128, C.COOL_GRAY);
    g.drawVLine(79, 0, 128, C.WHITE);
    g.drawVLine(80, 0, 128, C.STEEL);
    tiles.push(g);
  }

  // ==========================================
  // ROW 2: DESKS & WORKSTATIONS
  // ==========================================

  // 16: desk_wood_left (Left desk section with drawers)
  {
    const g = t();
    // Desk top surface
    g.fillRect(16, 32, 112, 28, C.CHESTNUT);
    g.drawHLine(16, 32, 112, C.WARM_PEACH); // top highlight
    g.fillRect(16, 56, 112, 6, C.DARK_BROWN); // front bevel edge

    // Left drawer pedestal
    g.fillRect(16, 62, 54, 60, C.CHESTNUT);
    g.strokeRect(16, 62, 54, 60, C.DARK_BROWN);
    // 3 stacked drawers
    for (let dy = 66; dy <= 106; dy += 18) {
      g.fillRect(20, dy, 46, 14, C.COPPER);
      g.strokeRect(20, dy, 46, 14, C.DARK_BROWN);
      // Silver bar handle
      g.fillRect(36, dy + 5, 14, 3, C.SILVER);
      g.set(37, dy + 6, C.WHITE);
    }
    tiles.push(g);
  }

  // 17: desk_wood_center (Center desk section)
  {
    const g = t();
    // Desktop surface
    g.fillRect(0, 32, 128, 28, C.CHESTNUT);
    g.drawHLine(0, 32, 128, C.WARM_PEACH);
    g.fillRect(0, 56, 128, 6, C.DARK_BROWN);

    // Cable grommet in top right
    g.fillCircle(104, 44, 6, C.DEEP_SLATE);
    g.strokeCircle(104, 44, 6, C.SILVER);
    g.fillCircle(104, 44, 3, C.BLACK);

    // Modesty panel in back
    g.fillRect(16, 62, 96, 40, C.RUSSET);
    g.drawHLine(16, 62, 96, C.DARK_BROWN);
    tiles.push(g);
  }

  // 18: desk_wood_right (Right desk section)
  {
    const g = t();
    g.fillRect(0, 32, 112, 28, C.CHESTNUT);
    g.drawHLine(0, 32, 112, C.WARM_PEACH);
    g.fillRect(0, 56, 112, 6, C.DARK_BROWN);

    // Right leg / drawer panel
    g.fillRect(58, 62, 54, 60, C.CHESTNUT);
    g.strokeRect(58, 62, 54, 60, C.DARK_BROWN);
    for (let dy = 66; dy <= 106; dy += 18) {
      g.fillRect(62, dy, 46, 14, C.COPPER);
      g.strokeRect(62, dy, 46, 14, C.DARK_BROWN);
      g.fillRect(78, dy + 5, 14, 3, C.SILVER);
    }
    tiles.push(g);
  }

  // 19: desk_tech_monitors (Dual monitors on desk with syntax code)
  {
    const g = t();
    // Desktop
    g.fillRect(0, 72, 128, 24, C.DEEP_SLATE);
    g.drawHLine(0, 72, 128, C.STEEL);
    g.fillRect(0, 96, 128, 6, C.BLACK);

    // Left Monitor
    g.fillRect(10, 14, 52, 48, C.BLACK);
    g.strokeRect(10, 14, 52, 48, C.STEEL);
    g.fillRect(13, 17, 46, 42, C.MIDNIGHT);
    // Syntax code lines
    g.drawHLine(16, 22, 24, C.LIME);
    g.drawHLine(16, 28, 36, C.CYAN);
    g.drawHLine(20, 34, 28, C.YELLOW);
    g.drawHLine(20, 40, 34, C.CORAL);
    g.drawHLine(16, 46, 18, C.LIME);

    // Right Monitor
    g.fillRect(66, 14, 52, 48, C.BLACK);
    g.strokeRect(66, 14, 52, 48, C.STEEL);
    g.fillRect(69, 17, 46, 42, C.MIDNIGHT);
    g.drawHLine(72, 22, 38, C.CYAN);
    g.drawHLine(72, 28, 26, C.WHITE);
    g.drawHLine(76, 34, 32, C.LIME);
    g.drawHLine(72, 40, 20, C.YELLOW);

    // Monitor articulated desk stand
    g.fillRect(60, 60, 8, 14, C.STEEL);
    g.fillRect(52, 72, 24, 4, C.DEEP_SLATE);
    tiles.push(g);
  }

  // 20: desk_laptop_coffee (Desk with open laptop and steaming coffee)
  {
    const g = t();
    g.fillRect(0, 64, 128, 28, C.CHESTNUT);
    g.drawHLine(0, 64, 128, C.WARM_PEACH);
    g.fillRect(0, 92, 128, 6, C.DARK_BROWN);

    // Aluminum laptop display (angled open)
    g.fillRect(24, 18, 56, 42, C.STEEL);
    g.strokeRect(24, 18, 56, 42, C.SILVER);
    g.fillRect(27, 21, 50, 36, C.SKY_BLUE);
    // Terminal window on laptop
    g.fillRect(30, 24, 44, 30, C.BLACK);
    g.drawHLine(33, 28, 24, C.LIME);
    g.drawHLine(33, 34, 36, C.CYAN);
    g.drawHLine(33, 40, 20, C.WHITE);
    // Keyboard base
    g.fillRect(20, 60, 64, 8, C.SILVER);
    g.fillRect(26, 61, 52, 5, C.DEEP_SLATE);

    // Ceramic coffee mug with steam
    g.fillRect(94, 56, 16, 18, C.WHITE);
    g.strokeRect(94, 56, 16, 18, C.SILVER);
    // Handle
    g.strokeRect(109, 60, 6, 10, C.SILVER);
    // Coffee liquid inside
    g.fillRect(96, 57, 12, 4, C.DARK_BROWN);
    // Swirling steam lines
    g.drawLine(98, 52, 100, 46, C.WHITE);
    g.drawLine(104, 50, 102, 44, C.WHITE);
    tiles.push(g);
  }

  // 21: chair_ergonomic_front (Mesh office chair front view)
  {
    const g = t();
    // Headrest
    g.fillRoundedRect(48, 12, 32, 12, 4, C.DEEP_SLATE);
    // Mesh curved backrest
    g.fillRoundedRect(40, 26, 48, 44, 8, C.STEEL);
    g.strokeRoundedRect
      ? g.strokeRoundedRect(40, 26, 48, 44, 8, C.BLACK)
      : g.strokeRect(40, 26, 48, 44, C.BLACK);
    // Backrest mesh texture
    for (let y = 30; y <= 66; y += 4) {
      g.drawHLine(44, y, 40, C.DEEP_SLATE);
    }
    // Armrests
    g.fillRect(28, 50, 10, 4, C.BLACK);
    g.fillRect(32, 54, 4, 18, C.STEEL);
    g.fillRect(90, 50, 10, 4, C.BLACK);
    g.fillRect(92, 54, 4, 18, C.STEEL);

    // Padded seat cushion
    g.fillRoundedRect(34, 70, 60, 16, 4, C.DEEP_SLATE);
    g.drawHLine(36, 71, 56, C.STEEL);

    // Cylinder & 5-wheel star base
    g.fillRect(61, 86, 6, 18, C.SILVER);
    // Base legs and wheels
    g.drawLine(64, 104, 36, 116, C.BLACK);
    g.drawLine(64, 104, 92, 116, C.BLACK);
    g.drawLine(64, 104, 64, 118, C.BLACK);
    g.fillCircle(36, 116, 3, C.DEEP_SLATE);
    g.fillCircle(92, 116, 3, C.DEEP_SLATE);
    g.fillCircle(64, 118, 3, C.DEEP_SLATE);
    tiles.push(g);
  }

  // 22: chair_ergonomic_back (Mesh office chair back view)
  {
    const g = t();
    g.fillRoundedRect(48, 12, 32, 12, 4, C.BLACK);
    // Back structure with spine exoskeleton
    g.fillRoundedRect(40, 26, 48, 44, 8, C.DEEP_SLATE);
    g.strokeRect(40, 26, 48, 44, C.BLACK);
    // Spine support
    g.fillRect(60, 24, 8, 48, C.SILVER);
    g.strokeRect(60, 24, 8, 48, C.STEEL);
    // Lumbar dial
    g.fillCircle(64, 52, 6, C.BLACK);
    g.fillCircle(64, 52, 3, C.STEEL);

    // Seat underside
    g.fillRoundedRect(34, 70, 60, 16, 4, C.BLACK);
    // Base
    g.fillRect(61, 86, 6, 18, C.SILVER);
    g.drawLine(64, 104, 36, 116, C.BLACK);
    g.drawLine(64, 104, 92, 116, C.BLACK);
    g.fillCircle(36, 116, 3, C.DEEP_SLATE);
    g.fillCircle(92, 116, 3, C.DEEP_SLATE);
    tiles.push(g);
  }

  // 23: workstation_pc_tower (Gaming/Workstation tower with glowing RGB fans)
  {
    const g = t();
    // Tower case body
    g.fillRoundedRect(32, 16, 64, 96, 4, C.BLACK);
    g.strokeRect(32, 16, 64, 96, C.STEEL);

    // Tempered glass side panel
    g.fillRect(38, 22, 52, 84, C.MIDNIGHT);
    g.strokeRect(38, 22, 52, 84, C.DEEP_SLATE);

    // Dual front glowing RGB fans (Cyan/Pink rings)
    g.strokeCircle(54, 46, 14, C.CYAN);
    g.strokeCircle(54, 46, 8, C.HOT_PINK);
    g.fillCircle(54, 46, 3, C.WHITE);

    g.strokeCircle(54, 82, 14, C.CYAN);
    g.strokeCircle(54, 82, 8, C.HOT_PINK);
    g.fillCircle(54, 82, 3, C.WHITE);

    // GPU backplate & cable comb
    g.fillRect(68, 54, 20, 8, C.SILVER);
    g.drawHLine(68, 56, 18, C.LIME); // GPU led strip
    tiles.push(g);
  }

  // ==========================================
  // ROW 3: WHITEBOARDS & BOOKSHELVES
  // ==========================================

  // 24: whiteboard_top_left (Whiteboard TL)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.WHITE);
    // Aluminum frame top and left
    g.fillRect(0, 0, 128, 12, C.SILVER);
    g.drawHLine(0, 11, 128, C.STEEL);
    g.fillRect(0, 0, 12, 128, C.SILVER);
    g.drawVLine(11, 0, 128, C.STEEL);

    // Architectural diagram boxes and arrows
    g.strokeRect(26, 28, 44, 28, C.ROYAL_BLUE);
    g.drawHLine(30, 38, 36, C.ROYAL_BLUE);
    g.drawHLine(30, 46, 28, C.ROYAL_BLUE);

    g.strokeRect(84, 56, 40, 32, C.CRIMSON);
    g.drawHLine(88, 68, 32, C.CRIMSON);

    // Connecting arrow line
    g.drawLine(70, 42, 84, 72, C.BLACK);
    tiles.push(g);
  }

  // 25: whiteboard_top_right (Whiteboard TR with post-it notes)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.WHITE);
    g.fillRect(0, 0, 128, 12, C.SILVER);
    g.drawHLine(0, 11, 128, C.STEEL);
    g.fillRect(116, 0, 12, 128, C.SILVER);
    g.drawVLine(116, 0, 128, C.STEEL);

    // Architecture diagram database cylinder
    g.fillEllipse(36, 32, 18, 6, C.ROYAL_BLUE);
    g.fillRect(18, 32, 36, 30, C.ROYAL_BLUE);
    g.fillEllipse(36, 62, 18, 6, C.ROYAL_BLUE);
    g.drawHLine(22, 44, 28, C.CYAN);

    // Colorful sticky notes (yellow, coral, lime)
    g.fillRoundedRect(72, 24, 20, 20, 2, C.YELLOW);
    g.drawHLine(74, 30, 16, C.BLACK);
    g.drawHLine(74, 36, 12, C.BLACK);

    g.fillRoundedRect(90, 48, 20, 20, 2, C.CORAL);
    g.drawHLine(92, 54, 16, C.BLACK);

    g.fillRoundedRect(68, 70, 20, 20, 2, C.LIME);
    g.drawHLine(70, 76, 16, C.BLACK);
    tiles.push(g);
  }

  // 26: whiteboard_bottom_left (Whiteboard BL with marker tray)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.WHITE);
    // Left frame
    g.fillRect(0, 0, 12, 128, C.SILVER);
    g.drawVLine(11, 0, 128, C.STEEL);
    // Bottom frame
    g.fillRect(0, 116, 128, 12, C.SILVER);
    g.drawHLine(0, 116, 128, C.STEEL);

    // Flowchart decision diamond
    g.drawLine(54, 24, 76, 46, C.ROYAL_BLUE);
    g.drawLine(76, 46, 54, 68, C.ROYAL_BLUE);
    g.drawLine(54, 68, 32, 46, C.ROYAL_BLUE);
    g.drawLine(32, 46, 54, 24, C.ROYAL_BLUE);

    // Marker pen tray attached to bottom frame
    g.fillRect(20, 108, 92, 10, C.STEEL);
    g.drawHLine(20, 108, 92, C.SILVER);
    // Markers (red, blue, green, black)
    g.fillRect(26, 104, 14, 4, C.RED);
    g.fillRect(44, 104, 14, 4, C.ROYAL_BLUE);
    g.fillRect(62, 104, 14, 4, C.LIME);
    g.fillRect(80, 104, 14, 4, C.BLACK);
    tiles.push(g);
  }

  // 27: whiteboard_bottom_right (Whiteboard BR with eraser sponge)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.WHITE);
    g.fillRect(116, 0, 12, 128, C.SILVER);
    g.drawVLine(116, 0, 128, C.STEEL);
    g.fillRect(0, 116, 128, 12, C.SILVER);
    g.drawHLine(0, 116, 128, C.STEEL);

    // Checklist on board
    for (let y = 24; y <= 72; y += 16) {
      g.strokeRect(18, y, 10, 10, C.BLACK);
      g.drawLine(20, y + 5, 23, y + 8, C.LIME);
      g.drawLine(23, y + 8, 27, y + 2, C.LIME);
      g.drawHLine(34, y + 5, 48, C.BLACK);
    }

    // Tray continued & magnetic eraser sponge
    g.fillRect(0, 108, 70, 10, C.STEEL);
    g.fillRoundedRect(16, 98, 28, 10, 3, C.DARK_TEAL);
    g.fillRect(16, 105, 28, 3, C.COOL_GRAY); // felt bottom
    tiles.push(g);
  }

  // 28: bookshelf_top (Bookshelf top with books)
  {
    const g = t();
    // Bookshelf mahogany carcass
    g.fillRect(12, 8, 104, 120, C.RUSSET);
    g.strokeRect(12, 8, 104, 120, C.DARK_BROWN);
    g.fillRect(16, 14, 96, 50, C.DARK_BROWN); // top shelf cavity
    g.fillRect(16, 74, 96, 50, C.DARK_BROWN); // bottom shelf cavity

    // Top shelf books
    let bx = 20;
    const bookColors = [
      C.CRIMSON,
      C.ROYAL_BLUE,
      C.PINE,
      C.GOLD,
      C.AUBERGINE,
      C.ORANGE,
      C.TEAL,
    ];
    for (let i = 0; i < 7; i++) {
      const bw = 10 + (i % 3) * 2;
      const bh = 38 - (i % 4) * 3;
      g.fillRect(bx, 64 - bh, bw, bh, bookColors[i % bookColors.length]);
      g.drawHLine(bx + 2, 64 - bh + 4, bw - 4, C.GOLD); // spine title
      bx += bw + 1;
    }
    tiles.push(g);
  }

  // 29: bookshelf_bottom (Bookshelf bottom with binders and plinth)
  {
    const g = t();
    g.fillRect(12, 0, 104, 114, C.RUSSET);
    g.strokeRect(12, 0, 104, 114, C.DARK_BROWN);
    g.fillRect(16, 6, 96, 96, C.DARK_BROWN);

    // Heavy project binders
    let bx = 20;
    const binderColors = [
      C.DEEP_SLATE,
      C.WHITE,
      C.ROYAL_BLUE,
      C.CRIMSON,
      C.DEEP_SLATE,
      C.WHITE,
    ];
    for (let i = 0; i < 6; i++) {
      g.fillRect(bx, 32, 14, 68, binderColors[i]);
      g.strokeRect(bx, 32, 14, 68, C.BLACK);
      g.fillCircle(bx + 7, 50, 2, C.SILVER); // finger pull ring
      g.fillRect(bx + 3, 62, 8, 14, C.CREAM); // spine label
      bx += 15;
    }
    // Plinth at bottom
    g.fillRect(8, 114, 112, 14, C.DARK_BROWN);
    tiles.push(g);
  }

  // 30: filing_cabinet (Steel 4-drawer filing cabinet)
  {
    const g = t();
    g.fillRoundedRect(24, 12, 80, 108, 4, C.COOL_GRAY);
    g.strokeRect(24, 12, 80, 108, C.STEEL);

    // 4 drawers
    for (let dy = 16; dy <= 94; dy += 26) {
      g.fillRect(28, dy, 72, 22, C.SILVER);
      g.strokeRect(28, dy, 72, 22, C.STEEL);
      // Index card label
      g.fillRect(40, dy + 6, 16, 8, C.WHITE);
      g.strokeRect(40, dy + 6, 16, 8, C.STEEL);
      // Pull handle
      g.fillRect(66, dy + 8, 22, 5, C.DEEP_SLATE);
      g.drawHLine(68, dy + 9, 18, C.SILVER);
    }
    tiles.push(g);
  }

  // 31: office_wastebin (Mesh wastebin with crumpled paper)
  {
    const g = t();
    // Cylindrical wire mesh basket
    g.fillEllipse(64, 40, 28, 8, C.STEEL);
    g.fillEllipse(64, 108, 24, 6, C.BLACK);
    g.fillRect(36, 40, 56, 68, C.STEEL);
    // Wire mesh criss-cross
    for (let y = 44; y <= 104; y += 8) {
      g.drawHLine(36, y, 56, C.DEEP_SLATE);
    }
    // Crumpled white paper balls and yellow sticky notes inside
    g.fillCircle(54, 46, 8, C.WHITE);
    g.strokeCircle(54, 46, 8, C.COOL_GRAY);
    g.fillCircle(72, 48, 7, C.YELLOW);
    g.fillCircle(64, 38, 6, C.WHITE);
    tiles.push(g);
  }

  // ==========================================
  // ROW 4: LOUNGE & BREAKROOM
  // ==========================================

  // 32: couch_left (Modular lounge sofa left)
  {
    const g = t();
    // Armrest
    g.fillRoundedRect(12, 34, 28, 78, 8, C.PINE);
    g.drawHLine(14, 36, 24, C.GREEN);
    // Seat and backrest section
    g.fillRect(40, 38, 88, 38, C.PINE); // backrest
    g.drawHLine(40, 40, 88, C.GREEN);
    g.fillRect(40, 76, 88, 36, C.DARK_TEAL); // seat cushion
    g.drawHLine(40, 78, 88, C.PINE);
    // Couch base and legs
    g.fillRect(16, 112, 112, 8, C.BLACK);
    g.fillRect(20, 118, 8, 8, C.DARK_BROWN);
    tiles.push(g);
  }

  // 33: couch_center (Modular lounge sofa center with throw pillow)
  {
    const g = t();
    g.fillRect(0, 38, 128, 38, C.PINE);
    g.drawHLine(0, 40, 128, C.GREEN);
    g.fillRect(0, 76, 128, 36, C.DARK_TEAL);
    g.drawHLine(0, 78, 128, C.PINE);
    // Tufting buttons
    g.fillCircle(32, 54, 3, C.BLACK);
    g.fillCircle(64, 54, 3, C.BLACK);
    g.fillCircle(96, 54, 3, C.BLACK);

    // Cozy coral throw pillow
    g.fillRoundedRect(44, 56, 36, 32, 6, C.CORAL);
    g.drawHLine(48, 58, 28, C.WARM_PEACH);
    g.fillRect(0, 112, 128, 8, C.BLACK);
    tiles.push(g);
  }

  // 34: couch_right (Modular lounge sofa right)
  {
    const g = t();
    g.fillRect(0, 38, 88, 38, C.PINE);
    g.drawHLine(0, 40, 88, C.GREEN);
    g.fillRect(0, 76, 88, 36, C.DARK_TEAL);
    g.drawHLine(0, 78, 88, C.PINE);

    // Right armrest
    g.fillRoundedRect(88, 34, 28, 78, 8, C.PINE);
    g.drawHLine(90, 36, 24, C.GREEN);
    g.fillRect(0, 112, 112, 8, C.BLACK);
    g.fillRect(100, 118, 8, 8, C.DARK_BROWN);
    tiles.push(g);
  }

  // 35: coffee_table (Glass & wood coffee table)
  {
    const g = t();
    // Glass top with blue tint reflection
    g.fillRoundedRect(16, 44, 96, 48, 6, C.DARK_TEAL);
    g.strokeRect(16, 44, 96, 48, C.CYAN);
    g.drawLine(24, 48, 64, 88, C.WHITE); // reflection shine

    // Wooden magazine / tech gadget on table
    g.fillRect(68, 54, 28, 20, C.GOLD);
    g.drawHLine(72, 60, 20, C.BLACK);

    // Table wooden legs
    g.fillRect(20, 92, 8, 24, C.CHESTNUT);
    g.fillRect(100, 92, 8, 24, C.CHESTNUT);
    tiles.push(g);
  }

  // 36: coffee_counter_machine (Espresso machine on counter)
  {
    const g = t();
    // Stainless steel espresso machine
    g.fillRoundedRect(28, 14, 72, 80, 4, C.SILVER);
    g.strokeRect(28, 14, 72, 80, C.STEEL);
    // Top warming rack with espresso cups
    g.fillRect(36, 18, 12, 12, C.WHITE);
    g.fillRect(56, 18, 12, 12, C.WHITE);
    g.fillRect(76, 18, 12, 12, C.WHITE);

    // Pressure gauges & buttons
    g.fillCircle(44, 42, 6, C.WHITE);
    g.set(44, 42, C.CRIMSON); // needle
    g.fillCircle(84, 42, 6, C.WHITE);
    g.set(84, 42, C.CRIMSON);

    // Dual portafilters
    g.fillRect(46, 56, 12, 8, C.BLACK);
    g.fillRect(48, 64, 8, 16, C.DEEP_SLATE);
    g.fillRect(70, 56, 12, 8, C.BLACK);
    g.fillRect(72, 64, 8, 16, C.DEEP_SLATE);

    // Drip tray
    g.fillRect(32, 86, 64, 8, C.DEEP_SLATE);

    // Counter top
    g.fillRect(0, 96, 128, 32, C.MIDNIGHT);
    g.drawHLine(0, 96, 128, C.STEEL);
    tiles.push(g);
  }

  // 37: coffee_counter_base (Lower kitchen cabinets)
  {
    const g = t();
    // Cabinet doors
    g.fillRect(0, 0, 128, 114, C.SILVER);
    g.strokeRect(0, 0, 128, 114, C.STEEL);
    // Two doors
    g.strokeRect(8, 8, 52, 98, C.STEEL);
    g.strokeRect(68, 8, 52, 98, C.STEEL);
    // Handles
    g.fillRect(52, 48, 4, 24, C.DEEP_SLATE);
    g.fillRect(72, 48, 4, 24, C.DEEP_SLATE);
    // Kickplate
    g.fillRect(0, 114, 128, 14, C.DEEP_SLATE);
    tiles.push(g);
  }

  // 38: water_cooler (Office water dispenser with 5-gallon jug)
  {
    const g = t();
    // Inverted 5-gallon blue water jug
    g.fillRoundedRect(44, 12, 40, 46, 10, C.SKY_BLUE);
    g.strokeRect(44, 12, 40, 46, C.ROYAL_BLUE);
    g.drawLine(50, 18, 56, 48, C.WHITE); // shine
    // Air bubble
    g.fillCircle(64, 32, 5, C.CYAN);

    // Cooler machine body
    g.fillRoundedRect(40, 58, 48, 64, 4, C.WHITE);
    g.strokeRect(40, 58, 48, 64, C.COOL_GRAY);

    // Spigot recess
    g.fillRect(50, 72, 28, 22, C.DEEP_SLATE);
    // Blue & Red taps
    g.fillRect(54, 76, 6, 8, C.SKY_BLUE);
    g.fillRect(68, 76, 6, 8, C.RED);
    // Drip grate
    g.fillRect(50, 92, 28, 4, C.STEEL);
    tiles.push(g);
  }

  // 39: potted_plant_monstera (Lush Monstera in terracotta pot)
  {
    const g = t();
    // Terracotta pot
    g.fillRoundedRect(40, 84, 48, 38, 4, C.RUST);
    g.fillRect(36, 80, 56, 8, C.COPPER); // rim
    g.fillRect(42, 88, 44, 6, C.DARK_BROWN); // soil

    // Large split Monstera leaves
    g.fillCircle(64, 48, 26, C.GREEN);
    g.fillCircle(42, 40, 20, C.PINE);
    g.fillCircle(86, 42, 22, C.GREEN);
    g.fillCircle(64, 24, 18, C.LIME);

    // Leaf veins and fenestrations (cuts)
    g.drawLine(64, 48, 64, 80, C.PINE); // stems
    g.drawLine(42, 40, 58, 80, C.PINE);
    g.drawLine(86, 42, 70, 80, C.PINE);
    tiles.push(g);
  }

  // ==========================================
  // ROW 5: INFRASTRUCTURE & QA
  // ==========================================

  // 40: server_rack_top (42U Server rack top with patch panel & blinking LEDs)
  {
    const g = t();
    // Rack steel enclosure
    g.fillRect(16, 0, 96, 128, C.BLACK);
    g.strokeRect(16, 0, 96, 128, C.STEEL);

    // Top rack fan exhausts
    g.fillCircle(40, 16, 10, C.DEEP_SLATE);
    g.fillCircle(88, 16, 10, C.DEEP_SLATE);

    // Patch panel with colorful patch cables
    g.fillRect(22, 34, 84, 20, C.DEEP_SLATE);
    for (let x = 26; x <= 98; x += 8) {
      g.fillRect(x, 38, 5, 5, C.BLACK);
      const cableCol =
        x % 3 === 0 ? C.LIME : x % 3 === 1 ? C.YELLOW : C.SKY_BLUE;
      g.drawLine(x + 2, 44, x + 6, 52, cableCol);
    }

    // Network switches with blinking link LEDs
    g.fillRect(22, 60, 84, 18, C.MIDNIGHT);
    for (let x = 26; x <= 98; x += 6) {
      g.set(x, 66, x % 4 === 0 ? C.LIME : C.GREEN);
      g.set(x, 70, x % 3 === 0 ? C.YELLOW : C.LIME);
    }

    // Blade server unit 1
    g.fillRect(22, 84, 84, 20, C.DEEP_SLATE);
    g.drawHLine(24, 86, 80, C.STEEL);
    for (let x = 26; x <= 94; x += 12) {
      g.fillRect(x, 90, 8, 10, C.BLACK); // drive caddy
      g.set(x + 2, 92, C.LIME); // activity led
    }
    tiles.push(g);
  }

  // 41: server_rack_bottom (42U Server rack bottom with blade servers & UPS)
  {
    const g = t();
    g.fillRect(16, 0, 96, 128, C.BLACK);
    g.strokeRect(16, 0, 96, 128, C.STEEL);

    // Blade server units 2, 3, 4
    for (let y = 8; y <= 64; y += 28) {
      g.fillRect(22, y, 84, 24, C.DEEP_SLATE);
      g.strokeRect(22, y, 84, 24, C.STEEL);
      for (let x = 26; x <= 94; x += 12) {
        g.fillRect(x, y + 4, 8, 14, C.BLACK);
        g.set(x + 2, y + 6, x % 2 === 0 ? C.LIME : C.SKY_BLUE);
      }
    }

    // Heavy-duty UPS battery backup at base
    g.fillRect(22, 92, 84, 28, C.MIDNIGHT);
    g.strokeRect(22, 92, 84, 28, C.STEEL);
    g.fillRect(30, 98, 24, 12, C.BLACK);
    g.drawHLine(32, 102, 16, C.LIME); // digital battery bar
    g.fillCircle(88, 104, 4, C.LIME); // power status LED
    tiles.push(g);
  }

  // 42: qa_dashboard_wall_top (Wall QA screen: 100% PASS Gauge)
  {
    const g = t();
    // Screen bezel
    g.fillRect(8, 12, 112, 116, C.BLACK);
    g.strokeRect(8, 12, 112, 116, C.STEEL);
    // Display screen
    g.fillRect(14, 18, 100, 110, C.MIDNIGHT);

    // Header bar
    g.fillRect(14, 18, 100, 16, C.ROYAL_BLUE);
    g.drawHLine(20, 26, 44, C.WHITE); // "QA MONITOR"

    // 100% PASS Green circular gauge
    g.strokeCircle(64, 76, 26, C.LIME);
    g.strokeCircle(64, 76, 25, C.LIME);
    g.fillCircle(64, 76, 18, C.DEEP_SLATE);
    // "100%"
    g.drawHLine(54, 74, 20, C.WHITE);
    g.drawHLine(56, 80, 16, C.LIME);
    tiles.push(g);
  }

  // 43: qa_dashboard_wall_bottom (QA test suites table with green checkmarks)
  {
    const g = t();
    g.fillRect(8, 0, 112, 100, C.BLACK);
    g.strokeRect(8, 0, 112, 100, C.STEEL);
    g.fillRect(14, 0, 100, 94, C.MIDNIGHT);

    // Test suite status rows
    for (let y = 10; y <= 74; y += 18) {
      // Green checkmark
      g.drawLine(20, y + 6, 24, y + 10, C.LIME);
      g.drawLine(24, y + 10, 30, y + 2, C.LIME);
      // Suite name and status bar
      g.drawHLine(36, y + 6, 48, C.WHITE);
      g.fillRect(90, y + 4, 18, 6, C.LIME);
    }

    // Heavy wall mounting bracket
    g.fillRect(56, 100, 16, 20, C.STEEL);
    g.fillRect(50, 116, 28, 8, C.BLACK);
    tiles.push(g);
  }

  // 44: potted_plant_succulent (Desk geometric succulent)
  {
    const g = t();
    // Geometric faceted white pot
    g.fillRoundedRect(44, 74, 40, 40, 4, C.WHITE);
    g.strokeRect(44, 74, 40, 40, C.SILVER);
    g.drawLine(44, 74, 64, 114, C.COOL_GRAY); // facet
    g.drawLine(84, 74, 64, 114, C.COOL_GRAY);

    // Fleshy rosette succulent leaves
    g.fillCircle(64, 66, 18, C.PINE);
    g.fillCircle(64, 64, 14, C.GREEN);
    g.fillCircle(64, 62, 8, C.LIME);
    g.set(64, 60, C.WHITE); // center bud
    tiles.push(g);
  }

  // 45: wall_clock (Round station wall clock)
  {
    const g = t();
    // Bezel ring
    g.fillCircle(64, 64, 48, C.STEEL);
    g.strokeCircle(64, 64, 48, C.DARK_BROWN);
    // White clock dial
    g.fillCircle(64, 64, 42, C.WHITE);
    // Hour marks
    for (let a = 0; a < 12; a++) {
      const rad = (a * Math.PI) / 6;
      const x = Math.round(64 + Math.sin(rad) * 34);
      const y = Math.round(64 - Math.cos(rad) * 34);
      g.fillCircle(x, y, 2, C.BLACK);
    }
    // Hands at 10:10
    g.drawLine(64, 64, 48, 48, C.BLACK); // hour hand
    g.drawLine(64, 64, 84, 46, C.BLACK); // minute hand
    // Red second hand
    g.drawLine(64, 64, 64, 30, C.RED);
    g.fillCircle(64, 64, 3, C.CRIMSON);
    tiles.push(g);
  }

  // 46: framed_architecture (Framed system blueprint behind glass)
  {
    const g = t();
    // Dark mahogany frame
    g.fillRoundedRect(16, 16, 96, 96, 4, C.DARK_BROWN);
    g.strokeRect(16, 16, 96, 96, C.CHESTNUT);
    // Blueprint canvas
    g.fillRect(24, 24, 80, 80, C.ROYAL_BLUE);
    // Architectural grid lines
    for (let x = 32; x <= 96; x += 16) g.drawVLine(x, 24, 80, C.SKY_BLUE);
    for (let y = 32; y <= 96; y += 16) g.drawHLine(24, y, 80, C.SKY_BLUE);
    // System blocks in blueprint
    g.strokeRect(36, 36, 24, 20, C.WHITE);
    g.strokeRect(68, 60, 24, 24, C.WHITE);
    g.drawLine(48, 56, 68, 72, C.CYAN);
    tiles.push(g);
  }

  // 47: drink_fridge (Glass-door beverage refrigerator with Mate & soda)
  {
    const g = t();
    // Fridge body
    g.fillRoundedRect(24, 8, 80, 114, 6, C.DEEP_SLATE);
    g.strokeRect(24, 8, 80, 114, C.STEEL);
    // Glass door window
    g.fillRect(32, 16, 64, 98, C.MIDNIGHT);
    g.strokeRect(32, 16, 64, 98, C.CYAN);

    // 3 shelves of colorful drinks
    for (let y = 20; y <= 80; y += 30) {
      // Wire shelf
      g.drawHLine(34, y + 26, 60, C.SILVER);
      // Cans / bottles
      g.fillRect(38, y + 6, 8, 20, C.GOLD); // Mate
      g.fillRect(50, y + 6, 8, 20, C.ORANGE); // Soda
      g.fillRect(62, y + 6, 8, 20, C.LIME); // Energy
      g.fillRect(74, y + 6, 8, 20, C.CYAN); // Water
      g.fillRect(84, y + 6, 8, 20, C.CRIMSON); // Cola
    }
    // Handle on right
    g.fillRect(90, 48, 4, 32, C.SILVER);
    tiles.push(g);
  }

  // ==========================================
  // ROW 6: MEETING & HALLWAY
  // ==========================================

  // 48: door_frame_top (Glass door header & hydraulic closer)
  {
    const g = t();
    // Wall and frame header
    g.fillRect(0, 0, 128, 40, C.SILVER);
    g.fillRect(16, 24, 96, 16, C.STEEL);
    g.strokeRect(16, 24, 96, 16, C.DARK_BROWN);

    // Hydraulic door closer cylinder and arm
    g.fillRoundedRect(36, 28, 40, 10, 3, C.SILVER);
    g.drawLine(56, 38, 74, 56, C.DEEP_SLATE); // closer arm

    // Upper glass pane
    g.fillRect(20, 40, 88, 88, C.DARK_TEAL);
    g.drawLine(30, 44, 46, 110, C.WHITE); // shine
    tiles.push(g);
  }

  // 49: door_frame_bottom (Door threshold & bottom glass door edge)
  {
    const g = t();
    // Glass door panel bottom
    g.fillRect(20, 0, 88, 96, C.DARK_TEAL);
    // Stainless door kickplate
    g.fillRect(20, 76, 88, 20, C.SILVER);
    g.strokeRect(20, 76, 88, 20, C.STEEL);

    // Aluminum threshold on floor
    g.fillRect(0, 96, 128, 32, C.STEEL);
    g.drawHLine(0, 96, 128, C.SILVER);
    g.drawHLine(0, 126, 128, C.BLACK);
    tiles.push(g);
  }

  // 50: floor_cable_bridge (Rubber floor cable conduit)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.ROYAL_BLUE); // hallway carpet
    // Heavy rubber ramp running vertically
    g.fillRect(44, 0, 40, 128, C.BLACK);
    g.fillRect(50, 0, 28, 128, C.DEEP_SLATE);
    g.drawVLine(46, 0, 128, C.YELLOW); // hazard stripe
    g.drawVLine(81, 0, 128, C.YELLOW);
    tiles.push(g);
  }

  // 51: hallway_sign (Hanging office directional signpost)
  {
    const g = t();
    // Ceiling mount chains
    g.drawVLine(36, 0, 24, C.STEEL);
    g.drawVLine(92, 0, 24, C.STEEL);

    // Signboard
    g.fillRoundedRect(16, 24, 96, 52, 4, C.MIDNIGHT);
    g.strokeRect(16, 24, 96, 52, C.CYAN);

    // Directional arrows & text lines
    g.drawHLine(24, 38, 54, C.WHITE); // "DEV LAB"
    g.fillRect(84, 36, 16, 6, C.CYAN); // arrow

    g.drawHLine(24, 58, 44, C.WHITE); // "LOUNGE"
    g.fillRect(84, 56, 16, 6, C.CYAN);
    tiles.push(g);
  }

  // 52: meeting_table_tl (Round conference table Top-Left)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.ROYAL_BLUE); // carpet
    // Quarter circle quadrant
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const dx = 127 - x;
        const dy = 127 - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 116) {
          g.set(x, y, C.RUSSET);
          if (dist >= 112)
            g.set(x, y, C.DARK_BROWN); // bevel edge
          else if (dist >= 108) g.set(x, y, C.WARM_PEACH); // highlight
        }
      }
    }
    tiles.push(g);
  }

  // 53: meeting_table_tr (Round conference table Top-Right with power hub)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.ROYAL_BLUE);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const dx = x;
        const dy = 127 - y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 116) {
          g.set(x, y, C.RUSSET);
          if (dist >= 112) g.set(x, y, C.DARK_BROWN);
          else if (dist >= 108) g.set(x, y, C.WARM_PEACH);
        }
      }
    }
    // Center power hub quarter
    g.fillCircle(0, 127, 24, C.DEEP_SLATE);
    g.strokeCircle(0, 127, 24, C.SILVER);
    tiles.push(g);
  }

  // 54: meeting_table_bl (Round conference table Bottom-Left)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.ROYAL_BLUE);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const dx = 127 - x;
        const dy = y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 116) {
          g.set(x, y, C.RUSSET);
          if (dist >= 112) g.set(x, y, C.DARK_BROWN);
          else if (dist >= 108) g.set(x, y, C.WARM_PEACH);
        }
      }
    }
    tiles.push(g);
  }

  // 55: meeting_table_br (Round conference table Bottom-Right)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.ROYAL_BLUE);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const dx = x;
        const dy = y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist <= 116) {
          g.set(x, y, C.RUSSET);
          if (dist >= 112) g.set(x, y, C.DARK_BROWN);
          else if (dist >= 108) g.set(x, y, C.WARM_PEACH);
        }
      }
    }
    tiles.push(g);
  }

  // ==========================================
  // ROW 7: PROPS, WINDOWS & EXIT
  // ==========================================

  // 56: pizza_box_open (Open pizza box with pizza slices)
  {
    const g = t();
    // Cardboard box
    g.fillRect(16, 20, 96, 88, C.CREAM);
    g.strokeRect(16, 20, 96, 88, C.COPPER);
    g.drawHLine(18, 22, 92, C.WARM_PEACH);

    // Pizza crust circle
    g.fillCircle(64, 64, 36, C.COPPER);
    g.fillCircle(64, 64, 30, C.YELLOW); // melted mozzarella

    // Tomato sauce & pepperoni slices
    g.fillCircle(54, 52, 6, C.CRIMSON);
    g.fillCircle(74, 56, 6, C.CRIMSON);
    g.fillCircle(60, 74, 6, C.CRIMSON);
    g.fillCircle(76, 76, 6, C.CRIMSON);

    // Oregano specks
    g.set(62, 58, C.PINE);
    g.set(68, 64, C.PINE);
    tiles.push(g);
  }

  // 57: donut_box (Pink bakery box with glazed & sprinkle donuts)
  {
    const g = t();
    // Pink bakery box
    g.fillRoundedRect(16, 24, 96, 80, 4, C.CORAL);
    g.strokeRect(16, 24, 96, 80, C.CRIMSON);
    g.fillRect(20, 28, 88, 72, C.WHITE); // wax paper

    // 4 donuts
    const dLocs = [
      [40, 48, C.CHESTNUT, C.WHITE], // chocolate with glaze
      [84, 48, C.HOT_PINK, C.YELLOW], // strawberry sprinkles
      [40, 78, C.WARM_PEACH, C.WHITE], // glazed ring
      [84, 78, C.DARK_BROWN, C.CORAL], // dark choc
    ];
    for (const [dx, dy, icing, sprinkle] of dLocs) {
      g.fillCircle(dx, dy, 14, C.COPPER); // dough
      g.fillCircle(dx, dy, 12, icing); // icing
      g.fillCircle(dx, dy, 4, C.WHITE); // hole
      // sprinkles
      g.set(dx - 6, dy - 5, sprinkle);
      g.set(dx + 5, dy - 6, sprinkle);
      g.set(dx + 6, dy + 5, sprinkle);
    }
    tiles.push(g);
  }

  // 58: retro_crt_terminal (Vintage CRT monitor with green phosphor terminal)
  {
    const g = t();
    // Beige plastic curved housing
    g.fillRoundedRect(20, 16, 88, 76, 8, C.CREAM);
    g.strokeRect(20, 16, 88, 76, C.WARM_PEACH);

    // Dark screen bezel
    g.fillRect(28, 24, 72, 60, C.BLACK);
    // Curved screen
    g.fillRoundedRect(32, 28, 64, 52, 6, C.MIDNIGHT);

    // Glowing green text lines
    g.drawHLine(38, 36, 44, C.LIME);
    g.drawHLine(38, 44, 52, C.LIME);
    g.drawHLine(38, 52, 32, C.LIME);
    // Cursor prompt
    g.fillRect(38, 60, 6, 8, C.LIME);

    // Pedestal stand
    g.fillRect(52, 92, 24, 16, C.CREAM);
    g.fillRect(40, 108, 48, 8, C.CREAM);
    tiles.push(g);
  }

  // 59: trophy_shelf (Glass trophy case with gold awards)
  {
    const g = t();
    // Glass shelf
    g.fillRect(12, 76, 104, 10, C.CYAN);
    g.drawHLine(12, 76, 104, C.WHITE);
    // Wall brackets
    g.fillRect(24, 86, 10, 16, C.SILVER);
    g.fillRect(94, 86, 10, 16, C.SILVER);

    // Gold trophy cup in center
    g.fillRect(58, 24, 12, 24, C.GOLD);
    g.fillCircle(64, 30, 14, C.YELLOW);
    g.fillCircle(64, 30, 10, C.GOLD);
    g.fillRect(60, 48, 8, 16, C.GOLD); // stem
    g.fillRect(52, 64, 24, 12, C.CHESTNUT); // base plinth
    // Handles
    g.strokeCircle(50, 30, 6, C.YELLOW);
    g.strokeCircle(78, 30, 6, C.YELLOW);
    tiles.push(g);
  }

  // 60: window_skyline_day (Daytime window with skyscrapers and blue sky)
  {
    const g = t();
    // Sky
    g.fillRect(0, 0, 128, 128, C.SKY_BLUE);

    // Fluffy clouds
    g.fillCircle(36, 32, 14, C.WHITE);
    g.fillCircle(52, 28, 18, C.WHITE);
    g.fillCircle(68, 32, 14, C.WHITE);

    // Distant city skyscrapers
    g.fillRect(16, 56, 28, 72, C.COOL_GRAY);
    g.fillRect(52, 44, 32, 84, C.STEEL);
    g.fillRect(90, 64, 26, 64, C.COOL_GRAY);

    // Skyscraper windows
    for (let y = 60; y < 120; y += 10) {
      g.fillRect(22, y, 4, 6, C.YELLOW);
      g.fillRect(32, y, 4, 6, C.YELLOW);
      g.fillRect(60, y, 5, 6, C.WHITE);
      g.fillRect(72, y, 5, 6, C.WHITE);
    }

    // Window frame cross
    g.strokeRect(0, 0, 128, 128, C.WHITE);
    g.fillRect(0, 0, 128, 8, C.WHITE);
    g.fillRect(0, 120, 128, 8, C.WHITE);
    g.fillRect(0, 0, 8, 128, C.WHITE);
    g.fillRect(120, 0, 8, 128, C.WHITE);
    g.fillRect(60, 0, 8, 128, C.WHITE); // vertical mullion
    g.fillRect(0, 60, 128, 8, C.WHITE); // horizontal mullion
    tiles.push(g);
  }

  // 61: window_skyline_night (Nighttime window with illuminated skyline and stars)
  {
    const g = t();
    // Midnight sky
    g.fillRect(0, 0, 128, 128, C.MIDNIGHT);

    // Stars
    const stars = [
      [24, 20],
      [74, 16],
      [108, 28],
      [44, 40],
      [92, 48],
    ];
    for (const [sx, sy] of stars) {
      g.set(sx, sy, C.WHITE);
      g.set(sx + 1, sy, C.YELLOW);
    }
    // Crescent moon
    g.fillCircle(88, 24, 10, C.YELLOW);
    g.fillCircle(84, 22, 9, C.MIDNIGHT);

    // Dark silhouettes of skyscrapers
    g.fillRect(14, 52, 30, 76, C.BLACK);
    g.fillRect(50, 40, 36, 88, C.BLACK);
    g.fillRect(92, 58, 28, 70, C.BLACK);

    // Glowing yellow office windows in the night
    for (let y = 56; y < 120; y += 10) {
      if ((y / 10) % 2 === 0) g.fillRect(20, y, 4, 6, C.YELLOW);
      if ((y / 10) % 3 === 0) g.fillRect(32, y, 4, 6, C.GOLD);
      g.fillRect(58, y, 6, 6, C.YELLOW);
      if ((y / 10) % 2 === 1) g.fillRect(72, y, 6, 6, C.GOLD);
    }

    // Window frame cross
    g.strokeRect(0, 0, 128, 128, C.COOL_GRAY);
    g.fillRect(0, 0, 128, 8, C.COOL_GRAY);
    g.fillRect(0, 120, 128, 8, C.COOL_GRAY);
    g.fillRect(0, 0, 8, 128, C.COOL_GRAY);
    g.fillRect(120, 0, 8, 128, C.COOL_GRAY);
    g.fillRect(60, 0, 8, 128, C.COOL_GRAY);
    g.fillRect(0, 60, 128, 8, C.COOL_GRAY);
    tiles.push(g);
  }

  // 62: exit_sign (Illuminated green emergency exit sign)
  {
    const g = t();
    // Green illuminated sign box
    g.fillRoundedRect(20, 34, 88, 60, 6, C.PINE);
    g.strokeRect(20, 34, 88, 60, C.LIME);
    g.fillRect(24, 38, 80, 52, C.GREEN);

    // White running silhouette and exit door symbol
    // Door
    g.strokeRect(36, 48, 18, 32, C.WHITE);
    // Running person icon
    g.fillCircle(72, 52, 5, C.WHITE); // head
    g.drawLine(72, 56, 68, 68, C.WHITE); // torso
    g.drawLine(68, 68, 60, 78, C.WHITE); // leg 1
    g.drawLine(68, 68, 76, 76, C.WHITE); // leg 2
    // Arrow pointing to door
    g.drawLine(86, 64, 76, 64, C.WHITE);
    g.drawLine(76, 64, 80, 60, C.WHITE);
    g.drawLine(76, 64, 80, 68, C.WHITE);
    tiles.push(g);
  }

  // 63: ambient_occlusion_shadow (Soft corner shadow tile)
  {
    const g = t();
    g.fillRect(0, 0, 128, 128, C.PEACH); // base floor
    // Smooth diagonal shadow gradient
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const d = 128 - x + (128 - y);
        if (d > 160) {
          g.set(x, y, C.DARK_BROWN);
        } else if (d > 120) {
          g.set(x, y, C.CHESTNUT);
        } else if (d > 80) {
          g.set(x, y, C.COPPER);
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
