/* ZAP-8 graphics core.
   Everything draws into an indexed framebuffer (one byte = one palette entry),
   exactly like the hardware this is pretending to be. Nothing here touches the
   DOM, so the same code renders in a browser or headless in node for testing. */

import { glyph, GLYPH_W, GLYPH_H, CELL_W, CELL_H } from './font.js';

export const SCREEN_W = 320;
export const SCREEN_H = 180;

/* 16 fixed colours. Warm amber and burnt orange (ZapBurrito) against a cold
   indigo dark, with cyan reserved for anything interactive. */
export const PALETTE = [
  '#0b0a12', // 0  void
  '#16142a', // 1  deep indigo
  '#241f3d', // 2  indigo
  '#3a3160', // 3  muted violet
  '#5a4a86', // 4  violet
  '#8a7ab0', // 5  dusty lilac
  '#c9c2e0', // 6  pale lilac
  '#f4f1ff', // 7  white
  '#2b1a12', // 8  dark brown
  '#5c3218', // 9  brown
  '#a85a1e', // 10 burnt orange
  '#f0a038', // 11 amber
  '#ffd9ae', // 12 pale warm (highlight + fair skin)
  '#2fa87a', // 13 crt green  (status: ok)
  '#ff4d6d', // 14 hot red    (status: alert)
  '#4ad4ff', // 15 cyan       (interactive)
];

export const C = {
  VOID: 0, DEEP: 1, INDIGO: 2, VIOLET: 3, VIOLET_LT: 4,
  LILAC: 5, LILAC_LT: 6, WHITE: 7,
  BROWN_DK: 8, BROWN: 9, ORANGE: 10, AMBER: 11, AMBER_LT: 12,
  GREEN: 13, RED: 14, CYAN: 15,
};

/* TRANSPARENT is not a palette entry; it is a sentinel meaning "skip". */
export const T = 255;

/* 4x4 Bayer threshold matrix, normalised to 0..15. */
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export class Framebuffer {
  constructor(w = SCREEN_W, h = SCREEN_H) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h);
    /* Clip rect, so panels can draw without spilling. */
    this.cx0 = 0; this.cy0 = 0; this.cx1 = w; this.cy1 = h;
  }

  clip(x, y, w, h) {
    this.cx0 = Math.max(0, x); this.cy0 = Math.max(0, y);
    this.cx1 = Math.min(this.w, x + w); this.cy1 = Math.min(this.h, y + h);
  }
  noClip() { this.cx0 = 0; this.cy0 = 0; this.cx1 = this.w; this.cy1 = this.h; }

  clear(c = 0) { this.px.fill(c); }

  set(x, y, c) {
    if (c === T) return;
    x |= 0; y |= 0;
    if (x < this.cx0 || y < this.cy0 || x >= this.cx1 || y >= this.cy1) return;
    this.px[y * this.w + x] = c;
  }

  get(x, y) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.px[y * this.w + x];
  }

  rect(x, y, w, h, c) {
    if (c === T) return;
    x |= 0; y |= 0; w |= 0; h |= 0;
    const x0 = Math.max(x, this.cx0), x1 = Math.min(x + w, this.cx1);
    const y0 = Math.max(y, this.cy0), y1 = Math.min(y + h, this.cy1);
    for (let yy = y0; yy < y1; yy++) {
      this.px.fill(c, yy * this.w + x0, yy * this.w + x1);
    }
  }

  frame(x, y, w, h, c) {
    this.rect(x, y, w, 1, c);
    this.rect(x, y + h - 1, w, 1, c);
    this.rect(x, y, 1, h, c);
    this.rect(x + w - 1, y, 1, h, c);
  }

  hline(x, y, w, c) { this.rect(x, y, w, 1, c); }
  vline(x, y, h, c) { this.rect(x, y, 1, h, c); }

  line(x0, y0, x1, y1, c) {
    x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  circle(cx, cy, r, c) {
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      this.set(cx + x, cy + y, c); this.set(cx + y, cy + x, c);
      this.set(cx - y, cy + x, c); this.set(cx - x, cy + y, c);
      this.set(cx - x, cy - y, c); this.set(cx - y, cy - x, c);
      this.set(cx + y, cy - x, c); this.set(cx + x, cy - y, c);
      y++;
      if (err < 0) err += 2 * y + 1;
      else { x--; err += 2 * (y - x) + 1; }
    }
  }

  discE(cx, cy, r, c) {
    for (let y = -r; y <= r; y++) {
      const span = Math.floor(Math.sqrt(r * r - y * y));
      this.rect(cx - span, cy + y, span * 2 + 1, 1, c);
    }
  }

  /* Ordered dither between two colours. `amt` 0..1 picks how much of `b`
     bleeds in. 4x4 Bayer gives 17 steps, which is enough to fake a gradient
     inside a 16-colour palette without banding. */
  ditherRect(x, y, w, h, a, b, amt) {
    const t = amt * 16;
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const px = x + xx, py = y + yy;
        this.set(px, py, BAYER4[py & 3][px & 3] < t ? b : a);
      }
    }
  }

  /* Per-pixel dither where intensity is a function of position. Used for
     light cones and pools, which need falloff in two axes at once. */
  ditherShape(x, y, w, h, col, fn) {
    for (let yy = 0; yy < h; yy++) {
      for (let xx = 0; xx < w; xx++) {
        const amt = fn(xx, yy);
        if (amt <= 0) continue;
        const px = x + xx, py = y + yy;
        if (BAYER4[py & 3][px & 3] < amt * 16) this.set(px, py, col);
      }
    }
  }

  /* Apply a light (or shadow) ramp over a region, dithered by intensity.
     `fn(x, y)` returns 0..1; 1 means every pixel is promoted. */
  shade(x, y, w, h, fn, map) {
    for (let yy = 0; yy < h; yy++) {
      const py = y + yy;
      if (py < this.cy0 || py >= this.cy1) continue;
      for (let xx = 0; xx < w; xx++) {
        const px = x + xx;
        if (px < this.cx0 || px >= this.cx1) continue;
        const amt = fn(xx, yy);
        if (amt <= 0) continue;
        if (BAYER4[py & 3][px & 3] >= amt * 16) continue;
        const i = py * this.w + px;
        this.px[i] = map[this.px[i]];
      }
    }
  }

  /* Draw a sprite given as an array of strings plus a char->colour map.
     Any char missing from the map is transparent. */
  sprite(x, y, rows, map, opts = {}) {
    const { flipX = false, tint = null, outline = null } = opts;
    const opaque = (xx, yy) => {
      const row = rows[yy];
      if (!row) return false;
      const c = map[row[xx]];
      return c !== undefined && c !== T;
    };

    // Outline pass: ring the silhouette so the sprite separates from whatever
    // is behind it. Without this a character wearing a mid-tone matching the
    // floor simply disappears into it.
    if (outline !== null) {
      for (let yy = 0; yy < rows.length; yy++) {
        for (let xx = 0; xx < rows[yy].length; xx++) {
          if (opaque(xx, yy)) continue;
          if (!(opaque(xx - 1, yy) || opaque(xx + 1, yy)
             || opaque(xx, yy - 1) || opaque(xx, yy + 1))) continue;
          const sx = flipX ? x + (rows[yy].length - 1 - xx) : x + xx;
          this.set(sx, y + yy, outline);
        }
      }
    }

    for (let yy = 0; yy < rows.length; yy++) {
      const row = rows[yy];
      for (let xx = 0; xx < row.length; xx++) {
        const c = map[row[xx]];
        if (c === undefined || c === T) continue;
        const sx = flipX ? x + (row.length - 1 - xx) : x + xx;
        this.set(sx, y + yy, tint === null ? c : tint);
      }
    }
  }

  /* ---- text ---- */

  text(x, y, str, c, opts = {}) {
    const { shadow = T, spacing = CELL_W } = opts;
    let cx = x;
    for (const ch of String(str)) {
      if (ch === '\n') { cx = x; y += CELL_H; continue; }
      const g = glyph(ch);
      for (let gy = 0; gy < GLYPH_H; gy++) {
        const bits = g[gy];
        if (!bits) continue;
        for (let gx = 0; gx < GLYPH_W; gx++) {
          if (!(bits & (1 << (GLYPH_W - 1 - gx)))) continue;
          if (shadow !== T) this.set(cx + gx, y + gy + 1, shadow);
          this.set(cx + gx, y + gy, c);
        }
      }
      cx += spacing;
    }
    return cx;
  }

  textW(str, spacing = CELL_W) { return String(str).length * spacing; }

  textCenter(cx, y, str, c, opts = {}) {
    const w = this.textW(str, opts.spacing ?? CELL_W);
    return this.text(Math.round(cx - w / 2), y, str, c, opts);
  }
}

/* Lighting ramp: where light falls, each colour is promoted one step up its
   own ladder rather than being tinted. This is how indexed hardware fakes
   illumination, and it keeps everything inside the 16-colour palette. */
export const LIGHT_MAP = new Uint8Array([
  8,  // 0  void      -> warm black
  2,  // 1  deep      -> indigo
  3,  // 2  indigo    -> violet
  4,  // 3  violet    -> violet lt
  5,  // 4  violet lt -> lilac
  6,  // 5  lilac     -> lilac lt
  7,  // 6  lilac lt  -> white
  7,  // 7  white     -> white
  9,  // 8  brown dk  -> brown
  10, // 9  brown     -> orange
  11, // 10 orange    -> amber
  12, // 11 amber     -> amber lt
  12, // 12 amber lt  -> amber lt
  13, // 13 green     stays (emissive)
  14, // 14 red       stays (emissive)
  15, // 15 cyan      stays (emissive)
]);

/* Inverse ramp, for shadow and vignette. */
export const DARK_MAP = new Uint8Array([
  0, 0, 1, 2, 3, 4, 5, 6, 0, 8, 9, 10, 11, 1, 2, 4,
]);

/* Blit an indexed framebuffer into an RGBA byte array using the palette.
   Kept separate so the headless PNG dumper can reuse it verbatim. */
export function paletteRGB(pal = PALETTE) {
  return pal.map((hex) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]);
}

export function blitRGBA(fb, out, rgb) {
  const px = fb.px;
  for (let i = 0, o = 0; i < px.length; i++, o += 4) {
    const c = rgb[px[i]] || rgb[0];
    out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255;
  }
  return out;
}
