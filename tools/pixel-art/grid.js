const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { PALETTE_RGB } = require('./palette');

class PixelGrid {
  /**
   * @param {number} width
   * @param {number} height
   * @param {number} defaultColor
   */
  constructor(width, height, defaultColor = -1) {
    this.width = width;
    this.height = height;
    this.pixels = new Int16Array(width * height).fill(defaultColor);
  }

  /**
   * Clone this grid
   * @returns {PixelGrid}
   */
  clone() {
    const copy = new PixelGrid(this.width, this.height);
    copy.pixels.set(this.pixels);
    return copy;
  }

  /**
   * Set pixel at (x, y)
   * @param {number} x
   * @param {number} y
   * @param {number} colorIndex
   */
  set(x, y, colorIndex) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    this.pixels[y * this.width + x] = colorIndex;
  }

  /**
   * Get pixel at (x, y)
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  get(x, y) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return -1;
    return this.pixels[y * this.width + x];
  }

  /**
   * Fill a rectangle
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   * @param {number} colorIndex
   */
  fillRect(x, y, w, h, colorIndex) {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.set(x + dx, y + dy, colorIndex);
      }
    }
  }

  /**
   * Stroke a rectangle outline
   */
  strokeRect(x, y, w, h, colorIndex) {
    this.drawHLine(x, y, w, colorIndex);
    this.drawHLine(x, y + h - 1, w, colorIndex);
    this.drawVLine(x, y, h, colorIndex);
    this.drawVLine(x + w - 1, y, h, colorIndex);
  }

  /**
   * Draw horizontal line
   */
  drawHLine(x, y, len, colorIndex) {
    for (let dx = 0; dx < len; dx++) {
      this.set(x + dx, y, colorIndex);
    }
  }

  /**
   * Draw vertical line
   */
  drawVLine(x, y, len, colorIndex) {
    for (let dy = 0; dy < len; dy++) {
      this.set(x, y + dy, colorIndex);
    }
  }

  /**
   * Draw line between two points (Bresenham's algorithm)
   */
  drawLine(x0, y0, x1, y1, colorIndex) {
    x0 = Math.round(x0);
    y0 = Math.round(y0);
    x1 = Math.round(x1);
    y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx - dy;

    while (true) {
      this.set(x0, y0, colorIndex);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x0 += sx;
      }
      if (e2 < dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  /**
   * Fill an ellipse centered at (cx, cy)
   */
  fillEllipse(cx, cy, rx, ry, colorIndex) {
    cx = Math.round(cx);
    cy = Math.round(cy);
    rx = Math.round(rx);
    ry = Math.round(ry);
    if (rx <= 0 || ry <= 0) return;
    for (let dy = -ry; dy <= ry; dy++) {
      const halfW = Math.round(
        rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))),
      );
      this.drawHLine(cx - halfW, cy + dy, halfW * 2 + 1, colorIndex);
    }
  }

  /**
   * Stroke an ellipse outline centered at (cx, cy)
   */
  strokeEllipse(cx, cy, rx, ry, colorIndex) {
    cx = Math.round(cx);
    cy = Math.round(cy);
    rx = Math.round(rx);
    ry = Math.round(ry);
    if (rx <= 0 || ry <= 0) return;
    for (let dy = -ry; dy <= ry; dy++) {
      const halfW = Math.round(
        rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry))),
      );
      this.set(cx - halfW, cy + dy, colorIndex);
      this.set(cx + halfW, cy + dy, colorIndex);
    }
    for (let dx = -rx; dx <= rx; dx++) {
      const halfH = Math.round(
        ry * Math.sqrt(Math.max(0, 1 - (dx * dx) / (rx * rx))),
      );
      this.set(cx + dx, cy - halfH, colorIndex);
      this.set(cx + dx, cy + halfH, colorIndex);
    }
  }

  /**
   * Fill a circle centered at (cx, cy)
   */
  fillCircle(cx, cy, r, colorIndex) {
    this.fillEllipse(cx, cy, r, r, colorIndex);
  }

  /**
   * Stroke a circle centered at (cx, cy)
   */
  strokeCircle(cx, cy, r, colorIndex) {
    this.strokeEllipse(cx, cy, r, r, colorIndex);
  }

  /**
   * Fill a rounded rectangle
   */
  fillRoundedRect(x, y, w, h, r, colorIndex) {
    r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
    this.fillRect(x + r, y, w - 2 * r, h, colorIndex);
    this.fillRect(x, y + r, r, h - 2 * r, colorIndex);
    this.fillRect(x + w - r, y + r, r, h - 2 * r, colorIndex);
    this.fillCircle(x + r, y + r, r, colorIndex);
    this.fillCircle(x + w - r - 1, y + r, r, colorIndex);
    this.fillCircle(x + r, y + h - r - 1, r, colorIndex);
    this.fillCircle(x + w - r - 1, y + h - r - 1, r, colorIndex);
  }

  /**
   * Dither a rectangle with a 2-color pattern
   */
  ditherRect(x, y, w, h, color1, color2, mode = 'checker') {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        let useC2 = false;
        if (mode === 'checker') {
          useC2 = (dx + dy) % 2 === 0;
        } else if (mode === 'diag') {
          useC2 = (dx + dy) % 4 === 0;
        } else if (mode === 'dots') {
          useC2 = dx % 2 === 0 && dy % 2 === 0;
        } else if (mode === 'sparse') {
          useC2 = dx % 4 === 0 && dy % 4 === 0;
        }
        this.set(x + dx, y + dy, useC2 ? color2 : color1);
      }
    }
  }

  /**
   * Draw from ASCII pattern with character mapping
   * @param {number} startX
   * @param {number} startY
   * @param {string[]|string} pattern
   * @param {Record<string, number>} charMap
   * @param {boolean} skipEmpty If true, ignores characters mapped to -1/null/undefined
   */
  drawPattern(startX, startY, pattern, charMap, skipEmpty = true) {
    const lines = Array.isArray(pattern)
      ? pattern
      : pattern
          .split('\n')
          .map((l) => l.trimEnd())
          .filter(Boolean);

    for (let dy = 0; dy < lines.length; dy++) {
      const line = lines[dy];
      for (let dx = 0; dx < line.length; dx++) {
        const char = line[dx];
        if (charMap[char] !== undefined) {
          const color = charMap[char];
          if (color === -1 || color === null) {
            if (!skipEmpty) {
              this.set(startX + dx, startY + dy, -1);
            }
          } else {
            this.set(startX + dx, startY + dy, color);
          }
        }
      }
    }
  }

  /**
   * Copy another grid onto this grid
   * @param {PixelGrid} src
   * @param {number} destX
   * @param {number} destY
   * @param {boolean} skipTransparent
   */
  blit(src, destX, destY, skipTransparent = true) {
    for (let sy = 0; sy < src.height; sy++) {
      for (let sx = 0; sx < src.width; sx++) {
        const color = src.get(sx, sy);
        if (skipTransparent && color === -1) continue;
        this.set(destX + sx, destY + sy, color);
      }
    }
  }

  /**
   * Create a horizontally flipped copy
   * @returns {PixelGrid}
   */
  flipHorizontal() {
    const flipped = new PixelGrid(this.width, this.height);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        flipped.set(this.width - 1 - x, y, this.get(x, y));
      }
    }
    return flipped;
  }

  /**
   * Convert grid to PNG object
   * @returns {PNG}
   */
  toPNG() {
    const png = new PNG({ width: this.width, height: this.height });
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const idx = (y * this.width + x) * 4;
        const colorIndex = this.get(x, y);
        if (colorIndex < 0 || colorIndex >= PALETTE_RGB.length) {
          png.data[idx] = 0;
          png.data[idx + 1] = 0;
          png.data[idx + 2] = 0;
          png.data[idx + 3] = 0; // Transparent
        } else {
          const rgb = PALETTE_RGB[colorIndex];
          png.data[idx] = rgb.r;
          png.data[idx + 1] = rgb.g;
          png.data[idx + 2] = rgb.b;
          png.data[idx + 3] = 255;
        }
      }
    }
    return png;
  }

  /**
   * Save PNG to disk synchronously
   * @param {string} filePath
   */
  savePNG(filePath) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const png = this.toPNG();
    const buffer = PNG.sync.write(png);
    fs.writeFileSync(filePath, buffer);
  }
}

/**
 * Stitch an array of frame grids into a sprite sheet
 * @param {PixelGrid[]} frames
 * @param {number} frameWidth
 * @param {number} frameHeight
 * @param {number} columns
 * @param {number} rows
 * @returns {PixelGrid}
 */
function createSheet(frames, frameWidth, frameHeight, columns, rows) {
  const sheet = new PixelGrid(columns * frameWidth, rows * frameHeight);
  for (let i = 0; i < frames.length; i++) {
    const col = i % columns;
    const row = Math.floor(i / columns);
    sheet.blit(frames[i], col * frameWidth, row * frameHeight, false);
  }
  return sheet;
}

module.exports = {
  PixelGrid,
  createSheet,
};
