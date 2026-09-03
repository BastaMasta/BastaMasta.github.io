/* The workshop — a 640x180 side-on room the player walks around.
   Every object here maps to a real thing Sameed built or owns. Each returns a
   hotspot the camera and interaction code use; the art is drawn procedurally
   so it can be tuned without shipping a sprite atlas. */

import { C, T, LIGHT_MAP, Framebuffer, buildShadeMask, applyMask } from './gfx.js';

export const ROOM_W = 744;
export const ROOM_H = 180;
export const FLOOR_Y = 148;

/* Interactive objects, in world order.
     `x`    where the player walks to when you tap the object — kept clear of
            anything that reaches the floor, so he does not stand inside it.
     `lx`   where the floating label points, i.e. the object itself.
     `ly`   optional label height, for objects tall enough that the default
            would land on top of them.
     Every `x` must sit at least a few pixels inside its own `span`: the walk
     stops within +/-2px of the target, so a stand spot on the span boundary
     can leave the player just outside the station.

     `span` the world range over which the station is actually active. This is
            deliberately separate from `x`: reusing the standing spot as the
            activation range made the rack openable only from a narrow strip on
            its right-hand side, when standing in front of it should obviously
            work too. */
export const HOTSPOTS = [
  { id: 'whoami',  x: 62,  lx: 46,  span: [8, 100],   label: 'TERMINAL',    panel: 'about' },
  { id: 'homelab', x: 160, lx: 126, span: [100, 166], label: 'SERVER RACK', panel: 'homelab' },
  { id: 'bench',   x: 205, lx: 205, span: [166, 250], label: 'WORKBENCH',   panel: 'hardware' },
  { id: 'shelf',   x: 307, lx: 307, span: [256, 362], label: 'CARTRIDGES',  panel: 'projects', ly: 64 },
  { id: 'cat',     x: 379, lx: 395, span: [372, 412], label: 'OREO',        panel: 'cat' },
  { id: 'arcade',  x: 434, lx: 460, span: [430, 490], label: 'ARCADE',      action: 'game', ly: 40 },
  { id: 'printer', x: 522, lx: 523, span: [492, 552], label: 'PRINTER',     panel: 'resume' },
  { id: 'mail',    x: 562, lx: 581, span: [556, 606], label: 'MAIL SLOT',   panel: 'contact' },
  { id: 'studio',  x: 660, lx: 653, span: [610, 744], label: 'STUDIO',      panel: 'studio', ly: 58 },
];

/* ---------- helpers ---------- */

const flick = (t, speed, seed) =>
  (Math.sin(t * speed + seed) * 0.5 + 0.5);

/* An LED that blinks on its own schedule. */
function led(fb, x, y, on, colOn, colOff = C.VOID) {
  fb.set(x, y, on ? colOn : colOff);
}

/* ---------- the shell: walls, floor, window ---------- */

function drawWalls(fb) {
  fb.rect(0, 0, ROOM_W, FLOOR_Y, C.DEEP);

  // Wall panelling: faint vertical seams every 40px.
  for (let x = 0; x < ROOM_W; x += 40) fb.vline(x, 0, FLOOR_Y - 4, C.INDIGO);

  // Gradient toward the ceiling so the room feels lit from below.
  for (let i = 0; i < 46; i++) {
    fb.ditherRect(0, i, ROOM_W, 1, C.DEEP, C.VOID, 0.62 * Math.pow(1 - i / 46, 1.4));
  }

  // Skirting.
  fb.rect(0, FLOOR_Y - 5, ROOM_W, 5, C.INDIGO);
  fb.hline(0, FLOOR_Y - 5, ROOM_W, C.VIOLET);

  // Floor.
  fb.rect(0, FLOOR_Y, ROOM_W, fb.h - FLOOR_Y, C.INDIGO);
  fb.hline(0, FLOOR_Y, ROOM_W, C.VIOLET);
  fb.ditherRect(0, FLOOR_Y + 1, ROOM_W, 10, C.INDIGO, C.VIOLET, 0.18);
  // Floorboard seams receding.
  for (let x = -20; x < ROOM_W; x += 46) {
    fb.line(x, FLOOR_Y + 1, x - 10, fb.h, C.VIOLET);
  }

  drawWindow(fb, WINDOW_X, WINDOW_Y);
  drawCables(fb);
}

/* Dropped from y16: up there the frame ran into the cable run above it and the
   top of it fell outside the camera's crop on most screens, so it read as a
   window jammed into the ceiling. The shelf below came down with it. */
const WINDOW_X = 236, WINDOW_Y = 28;
const STARS = [[7,6],[15,12],[24,5],[33,18],[44,9],[50,24],[12,28],[38,31],[20,20],[46,35]];

/* Redrawn every frame — ten pixels, so it stays cheap. */
function drawStars(fb, t) {
  for (const [sx, sy] of STARS) {
    const tw = flick(t, 2.1, sx * 0.7 + sy);
    fb.set(WINDOW_X + sx, WINDOW_Y + sy, tw > 0.55 ? C.WHITE : C.LILAC);
  }
}

function drawWindow(fb, x, y) {
  const w = 58, h = 42;
  fb.rect(x, y, w, h, C.VOID);
  // Distant hills.
  for (let i = 0; i < w; i++) {
    const hy = h - 8 + Math.round(Math.sin(i * 0.22) * 2 + Math.sin(i * 0.07) * 2);
    fb.rect(x + i, y + hy, 1, h - hy, C.VIOLET);
  }
  // Moon.
  fb.discE(x + 42, y + 11, 4, C.LILAC_LT);
  fb.discE(x + 40, y + 9, 3, C.VOID);
  // Frame + mullions.
  fb.frame(x - 2, y - 2, w + 4, h + 4, C.VIOLET_LT);
  fb.vline(x + (w >> 1), y, h, C.VIOLET_LT);
  fb.hline(x, y + (h >> 1), w, C.VIOLET_LT);
  // Sill.
  fb.rect(x - 4, y + h + 2, w + 8, 3, C.VIOLET);
}

/* Cable run along the top of the wall — the homelab's veins. */
function drawCables(fb) {
  for (let x = 108; x < 470; x++) {
    const sag = Math.round(Math.sin((x - 108) * 0.03) * 2);
    fb.set(x, 12 + sag, C.VOID);
    fb.set(x, 13 + sag, C.INDIGO);
  }
}

/* ---------- 1. desk + CRT (about) ---------- */

function drawDesk(fb, t) {
  const x = 14, topY = 104;
  // Desk.
  fb.rect(x, topY, 74, 4, C.BROWN);
  fb.hline(x, topY, 74, C.ORANGE);
  fb.rect(x + 4, topY + 4, 4, FLOOR_Y - topY - 4, C.BROWN_DK);
  fb.rect(x + 66, topY + 4, 4, FLOOR_Y - topY - 4, C.BROWN_DK);
  // Drawer unit.
  fb.rect(x + 44, topY + 4, 30, 26, C.BROWN_DK);
  fb.hline(x + 47, topY + 12, 24, C.BROWN);
  fb.hline(x + 47, topY + 22, 24, C.BROWN);

  // CRT monitor.
  const mx = x + 12, my = 70, mw = 40, mh = 34;
  fb.rect(mx - 2, my + mh - 4, mw + 4, 4, C.VIOLET);          // stand base
  fb.rect(mx + 4, my, mw - 8, mh - 4, C.LILAC);               // case
  fb.rect(mx + 2, my + 2, mw - 4, mh - 8, C.LILAC);
  fb.frame(mx + 2, my + 2, mw - 4, mh - 8, C.VIOLET_LT);
  // Screen.
  const sx = mx + 5, sy = my + 5, sw = mw - 10, sh = mh - 14;
  fb.rect(sx, sy, sw, sh, C.VOID);
  // Scrolling code lines.
  for (let i = 0; i < 5; i++) {
    const ly = sy + 2 + i * 3;
    const seed = (i * 7 + Math.floor(t * 1.4)) % 5;
    const lw = 4 + seed * 4;
    fb.rect(sx + 2, ly, Math.min(lw, sw - 4), 1, i === 4 ? C.AMBER : C.GREEN);
  }
  // Cursor.
  if (flick(t, 5, 0) > 0.5) fb.rect(sx + 2, sy + 2 + 5 * 3, 3, 1, C.GREEN);
  // Glow spill.
  fb.ditherRect(sx - 3, sy + sh, sw + 6, 4, T, C.GREEN, 0.12);

  // Keyboard.
  fb.rect(x + 10, topY - 3, 26, 3, C.VIOLET_LT);
  fb.hline(x + 10, topY - 3, 26, C.LILAC_LT);
  // Mug.
  fb.rect(x + 40, topY - 5, 6, 5, C.RED);
  fb.set(x + 46, topY - 4, C.RED);

  // Light pool on the floor.
  fb.ditherRect(x + 6, FLOOR_Y, 50, 8, T, C.VIOLET, 0.4);
}

/* ---------- 2. server rack (homelab) ---------- */

function drawRack(fb, t) {
  const x = 106, y = 58, w = 40, h = FLOOR_Y - y;
  fb.rect(x, y, w, h, C.VOID);
  fb.frame(x, y, w, h, C.VIOLET_LT);
  fb.frame(x + 1, y + 1, w - 2, h - 2, C.VIOLET);

  // Seven 1U units, each a service.
  const units = 7;
  const uh = Math.floor((h - 10) / units);
  for (let i = 0; i < units; i++) {
    const uy = y + 5 + i * uh;
    fb.rect(x + 3, uy, w - 6, uh - 2, C.INDIGO);
    fb.hline(x + 3, uy, w - 6, C.VIOLET);
    // Vent slots.
    for (let v = 0; v < 5; v++) fb.vline(x + 7 + v * 3, uy + 2, uh - 5, C.DEEP);
    // Activity LEDs — each unit blinks on its own rhythm.
    const a = flick(t, 3 + i * 1.7, i * 2.3) > 0.45;
    const b = flick(t, 7 + i * 2.1, i * 1.1) > 0.6;
    led(fb, x + w - 7, uy + 2, true, C.GREEN);
    led(fb, x + w - 5, uy + 2, a, C.AMBER, C.DEEP);
    led(fb, x + w - 5, uy + 4, b, C.CYAN, C.DEEP);
  }
  // Rack feet + fan glow underneath.
  fb.ditherRect(x - 4, FLOOR_Y, w + 8, 7, T, C.GREEN, 0.22);
}

/* ---------- 3. workbench (hardware) ---------- */

function drawBench(fb, t) {
  const x = 170, topY = 110, w = 70;
  fb.rect(x, topY, w, 4, C.BROWN);
  fb.hline(x, topY, w, C.ORANGE);
  fb.rect(x + 3, topY + 4, 4, FLOOR_Y - topY - 4, C.BROWN_DK);
  fb.rect(x + w - 7, topY + 4, 4, FLOOR_Y - topY - 4, C.BROWN_DK);
  // Under-bench parts bins.
  for (let i = 0; i < 3; i++) {
    fb.rect(x + 12 + i * 15, topY + 8, 13, 10, C.INDIGO);
    fb.frame(x + 12 + i * 15, topY + 8, 13, 10, C.VIOLET);
  }

  // PCB in a vise — green board with amber traces (Lumio V2).
  const px = x + 6, py = topY - 12;
  fb.rect(px, py, 24, 12, C.GREEN);
  fb.frame(px, py, 24, 12, C.VOID);
  fb.hline(px + 2, py + 3, 12, C.AMBER);
  fb.hline(px + 6, py + 6, 15, C.AMBER);
  fb.vline(px + 17, py + 3, 6, C.AMBER);
  fb.rect(px + 4, py + 7, 5, 3, C.VOID);      // IC
  fb.set(px + 20, py + 9, C.RED);             // LED

  // BinaryKeeb — the eight bit LEDs, showing the byte currently being entered.
  // (The board itself has only two keys; this row is its readout.)
  const kx = x + 36, ky = topY - 5;
  const byte = Math.floor(t * 2) & 0xff;
  for (let i = 0; i < 8; i++) {
    const on = (byte >> (7 - i)) & 1;
    fb.rect(kx + i * 4, ky, 3, 4, on ? C.CYAN : C.VIOLET_LT);
    fb.set(kx + i * 4, ky, on ? C.WHITE : C.LILAC);
  }

  // Soldering iron in its stand, with a wisp of smoke.
  const ix = x + 62, iy = topY - 14;
  fb.rect(ix, iy + 8, 6, 6, C.VIOLET);
  fb.line(ix + 1, iy + 8, ix + 6, iy + 1, C.LILAC);
  fb.set(ix + 6, iy, C.RED);
  for (let s = 0; s < 5; s++) {
    const sy = iy - 2 - s * 3;
    const sxo = Math.round(Math.sin(t * 1.6 + s * 0.9) * 2);
    if (sy > 60) fb.set(ix + 6 + sxo, sy, s < 3 ? C.VIOLET : C.INDIGO);
  }
}

/* ---------- 4. cartridge shelf (projects) ---------- */

/* One entry per cartridge rather than a repeating cycle, so the mix can be
   arranged by hand: roughly half accents, spread out, with no two of the same
   hue adjacent. Fifteen saturated spines made the shelf out-shout the arcade
   cabinet next to it; all-muted went too far the other way. Beyond fifteen it
   wraps, which is fine — the shelf is decoration, the real list is the panel. */
const CART_COLS = [
  C.AMBER,  C.VIOLET_LT, C.CYAN,      C.LILAC, C.ORANGE,
  C.GREEN,  C.VIOLET,    C.RED,       C.LILAC_LT, C.ORANGE,
  C.CYAN,   C.VIOLET_LT, C.AMBER,     C.LILAC, C.GREEN,
];

const SHELF_X = 266, SHELF_Y = 70, SHELF_W = 84;

function drawShelf(fb, t, cartCount = 15) {
  const x = SHELF_X, y = SHELF_Y, w = SHELF_W;
  // Two shelf boards.
  for (let r = 0; r < 2; r++) {
    const sy = y + r * 30;
    fb.rect(x, sy + 24, w, 3, C.BROWN);
    fb.hline(x, sy + 24, w, C.ORANGE);
    fb.rect(x, sy + 27, 2, 4, C.BROWN_DK);
    fb.rect(x + w - 2, sy + 27, 2, 4, C.BROWN_DK);
  }
  // Cartridges standing on the boards.
  const perRow = 8;
  for (let i = 0; i < cartCount; i++) {
    const r = Math.floor(i / perRow), c = i % perRow;
    const cx = x + 4 + c * 10, cy = y + r * 30 + 6;
    const col = CART_COLS[i % CART_COLS.length];
    fb.rect(cx, cy, 8, 18, col);
    fb.rect(cx + 1, cy + 1, 6, 5, C.VOID);      // label window
    fb.hline(cx + 1, cy + 9, 6, C.VOID);        // grip ridges
    fb.hline(cx + 1, cy + 11, 6, C.VOID);
    fb.vline(cx, cy, 18, C.VOID);
  }
  // Under-shelf LED strip lighting the carts.
  for (let r = 0; r < 2; r++) {
    const sy = y + r * 30 + 27;
    for (let i = 0; i < w - 6; i += 2) fb.set(x + 3 + i, sy, C.CYAN);
    applyMask(fb, cache.shelfGlow[r], LIGHT_MAP);
  }

  // One cart pulled halfway out, catching the light.
  const pull = Math.round(Math.sin(t * 0.9) * 1.5);
  fb.rect(x + 4 + 3 * 10, y + 4 - pull, 8, 18, C.WHITE);
  fb.rect(x + 5 + 3 * 10, y + 5 - pull, 6, 5, C.VOID);
}

/* ---------- 5. arcade cabinet (ZapBurrito Studios) ---------- */

function drawArcade(fb, t) {
  const x = 438, y = 54, w = 44, h = FLOOR_Y - y;
  fb.rect(x, y, w, h, C.INDIGO);
  fb.frame(x, y, w, h, C.ORANGE);
  // Marquee.
  fb.rect(x + 2, y + 2, w - 4, 9, C.AMBER);
  fb.rect(x + 3, y + 3, w - 6, 7, C.ORANGE);
  fb.text(x + 6, y + 4, 'ZAP', C.AMBER_LT, { shadow: T, spacing: 6 });
  fb.text(x + 24, y + 4, '-8', C.WHITE, { shadow: T, spacing: 6 });
  // Screen with an attract-mode blob bouncing.
  const sx = x + 5, sy = y + 14, sw = w - 10, sh = 26;
  fb.rect(sx, sy, sw, sh, C.VOID);
  fb.frame(sx - 1, sy - 1, sw + 2, sh + 2, C.VIOLET);
  const bx = sx + 3 + Math.round((Math.sin(t * 1.3) * 0.5 + 0.5) * (sw - 9));
  const by = sy + 3 + Math.round((Math.sin(t * 2.1) * 0.5 + 0.5) * (sh - 9));
  fb.rect(bx, by, 4, 4, C.AMBER);
  fb.hline(sx + 2, sy + sh - 3, sw - 4, C.GREEN);
  // Control panel + joystick.
  fb.rect(x + 2, y + 44, w - 4, 8, C.VIOLET);
  const jl = Math.sin(t * 2.6) > 0 ? 1 : -1;
  fb.vline(x + 12 + jl, y + 40, 5, C.LILAC_LT);
  fb.set(x + 12 + jl, y + 39, C.RED);
  fb.set(x + 26, y + 46, C.CYAN);
  fb.set(x + 30, y + 46, C.AMBER);
  // Coin door + cabinet glow.
  fb.rect(x + 14, y + 58, 14, 10, C.VOID);
  fb.ditherRect(x - 6, FLOOR_Y, w + 12, 9, T, C.ORANGE, 0.3);
}

/* ---------- 6. mail slot (contact) ---------- */

function drawMail(fb, t) {
  const x = 565, y = 74, w = 32, h = 26;
  fb.rect(x, y, w, h, C.VIOLET);
  fb.frame(x, y, w, h, C.VIOLET_LT);
  fb.rect(x + 4, y + 6, w - 8, 4, C.VOID);       // the slot
  fb.hline(x + 4, y + 6, w - 8, C.LILAC);
  // Envelope icon.
  fb.rect(x + 11, y + 14, 10, 7, C.LILAC_LT);
  fb.line(x + 11, y + 14, x + 16, y + 18, C.VIOLET);
  fb.line(x + 20, y + 14, x + 16, y + 18, C.VIOLET);
  // "You have mail" lamp.
  const on = flick(t, 2.4, 0) > 0.5;
  fb.set(x + w - 4, y + 3, on ? C.RED : C.VOID);
  if (on) fb.ditherRect(x + w - 7, y, 6, 6, T, C.RED, 0.25);
  // Post below it.
  fb.rect(x + 14, y + h, 4, FLOOR_Y - y - h, C.VIOLET);
}

/* ---------- 7. printer (resume) ---------- */

function drawPrinter(fb, t) {
  const x = 503, topY = 116, w = 40;
  // Side table.
  fb.rect(x - 2, topY, w + 4, 3, C.BROWN);
  fb.rect(x + 2, topY + 3, 3, FLOOR_Y - topY - 3, C.BROWN_DK);
  fb.rect(x + w - 5, topY + 3, 3, FLOOR_Y - topY - 3, C.BROWN_DK);
  // Dot-matrix body.
  const py = topY - 16;
  fb.rect(x, py, w, 16, C.LILAC);
  fb.frame(x, py, w, 16, C.VIOLET_LT);
  fb.rect(x + 4, py + 10, w - 8, 4, C.INDIGO);
  led(fb, x + w - 5, py + 3, flick(t, 1.7, 0) > 0.5, C.GREEN);
  led(fb, x + w - 5, py + 5, true, C.AMBER);
  // Sheet feeding out, creeping upward.
  const feed = Math.round((Math.sin(t * 0.7) * 0.5 + 0.5) * 10);
  const sh = 12 + feed;
  fb.rect(x + 8, py - sh, 22, sh, C.WHITE);
  fb.frame(x + 8, py - sh, 22, sh, C.LILAC);
  for (let i = 0; i < Math.min(5, Math.floor(sh / 3)); i++) {
    fb.hline(x + 11, py - sh + 3 + i * 3, 12 + (i % 2) * 4, C.VIOLET);
  }
}

/* ---------- 8. the cat (easter egg) ---------- */

/* Oreo, a ragdoll: cream coat, dark seal points on the ears, mask and paws,
   and the blue eyes the breed is known for. */
export const CAT = [
  '..d.....d..',
  '.ddd...ddd.',
  '.ddddddddd.',
  '.ddbbdbbdd.',   // blue eyes, set closer together
  '.dcccccccd.',
  '..cccnccc..',   // nose
  '..ccccccc..',
  '...ccccc...',   // neck
  '..ccccccc..',
  '.ccccccccc.',
  '.ccccccccc.',
  'ccccccccccc',
  'ccccccccccc',
  '..ddcccdd..',   // front paws
];
const CAT_SLEEP = [
  '.........',
  '..d...d..',
  '.ddddddd.',
  '.dc---cd.',
  '.ccccccc.',
  'ccccccccc',
  'ccccccccc',
  'ccccccccc',
  '.dd...dd.',
];
export const CAT_MAP = {
  'd': C.BROWN,      // seal points
  'c': C.LILAC_LT,   // cream coat
  'b': C.CYAN,       // blue eyes
  'n': C.ORANGE,     // nose, muted warm brown-pink
  '-': C.BROWN,      // closed eyes
  '.': T,
};

/* A ragdoll's tail is the best thing about it: thin where it joins, full and
   plumed toward the tip. Drawn as overlapping discs so it reads as fur rather
   than a drawn line. It drops away from the body and then lies along whatever
   is under it, with the last third twitching. */
export function drawCatTail(fb, bx, by, t, opts = {}) {
  const { reach = 6, drop = 7, flick = 2, speed = 2.2 } = opts;
  const sway = Math.sin(t * speed);
  const at = (p) => {
    const tip = Math.max(0, p - 0.6) / 0.4;      // only the end moves
    return [
      bx + Math.round(p * reach),
      by + Math.round(Math.sqrt(p) * drop - sway * tip * flick),
    ];
  };
  for (let i = 0; i < 8; i++) {
    const p = i / 7;
    const [tx, ty] = at(p);
    fb.discE(tx, ty, i < 1 ? 0 : 1, C.BROWN);
  }
  // A lighter crest along the upper edge gives it volume.
  for (let i = 3; i < 8; i++) {
    const [tx, ty] = at(i / 7);
    fb.set(tx, ty - 1, C.LILAC_LT);
  }
}

/* Loafing on top of the rack — the warm spot. Drawn after the rack so he sits
   on it. */
function drawCatOnRack(fb, t) {
  const x = 121, y = 58 - 14;  // centred on the 106..146 cabinet
  const bob = Math.round(Math.sin(t * 0.9) * 0.5);
  fb.sprite(x, y + bob, CAT, CAT_MAP);
  // Up here it drapes over the front edge of the cabinet instead.
  drawCatTail(fb, x + 9, y + 11 + bob, t, { reach: 2, drop: 5, flick: 1, speed: 1.5 });
  // A little warmth rising off the vents.
  for (let i = 0; i < 3; i++) {
    const sy = y - 3 - i * 3;
    if (sy > 12) fb.set(x + 4 + Math.round(Math.sin(t * 1.7 + i) * 2), sy, C.INDIGO);
  }
}

function drawCat(fb, t, awake, onRack) {
  const x = 384, y = FLOOR_Y - 12;
  // Beanbag — always there, whether or not it is occupied.
  fb.discE(x + 9, FLOOR_Y - 3, 8, C.VIOLET);
  fb.ditherRect(x + 1, FLOOR_Y - 6, 16, 5, C.VIOLET, C.VIOLET_LT, 0.4);
  if (onRack) {
    // A shed tuft, so the empty beanbag still reads as his.
    fb.set(x + 7, FLOOR_Y - 7, C.LILAC_LT);
    fb.set(x + 12, FLOOR_Y - 6, C.LILAC_LT);
    return;
  }
  const bob = Math.round(Math.sin(t * 1.1) * 0.5);
  if (awake) {
    fb.sprite(x + 4, FLOOR_Y - 20 + bob, CAT, CAT_MAP);
    drawCatTail(fb, x + 13, FLOOR_Y - 11 + bob, t);
  } else {
    fb.sprite(x + 5, y + 3 + bob, CAT_SLEEP, CAT_MAP);
    // Zzz.
    const zp = Math.floor(t * 1.2) % 3;
    fb.text(x + 16, y - 4 - zp * 2, 'Z', C.LILAC, { shadow: T, spacing: 5 });
  }
}


/* ---------- lighting & set dressing ---------- */

/* A hanging bulb with a soft dithered cone. Light is the main thing selling
   depth in here, so each fixture also warms the wall behind it. */
function drawLampFixture(fb, t, x, cordLen = 22, col = C.AMBER) {
  const sway = Math.sin(t * 0.6 + x) * 0.6;
  const bx = x + Math.round(sway);
  const by = cordLen;
  fb.vline(x, 0, cordLen, C.VOID);
  fb.rect(bx - 7, by, 15, 2, C.VIOLET_LT);
  fb.rect(bx - 5, by - 3, 11, 3, C.VIOLET);
  fb.rect(bx - 1, by + 2, 3, 2, col);
  fb.set(bx, by + 4, C.AMBER_LT);
}

/* Hanging lamps: [x, cord length]. One table, used to build the cone masks and
   again to draw the fixtures, so the two can't drift apart. */
const LAMPS = [[204, 22], [524, 26], [660, 20]];

/* The cone's shape is fixed, so its dither pattern is too — it is baked into a
   mask once and replayed as a flat index walk. */
function lampConeMask(x, cordLen) {
  const top = cordLen + 3;
  const depth = FLOOR_Y + 14 - top;
  const slope = 0.58, base = 6;
  const maxHalf = Math.ceil(base + depth * slope);
  const mask = buildShadeMask(ROOM_W, ROOM_H, x - maxHalf, top, maxHalf * 2, depth, (xx, yy) => {
    const half = base + yy * slope;
    const dx = Math.abs(xx - maxHalf);
    if (dx > half) return 0;
    const edge = 1 - Math.pow(dx / half, 3.2);
    const fall = Math.pow(1 - yy / depth, 0.85);
    return 1.15 * edge * fall;
  });
  // A cone is 170-odd pixels wide and the camera window is rarely more than
  // 260, so knowing where it starts and ends is worth carrying around.
  return { mask, x0: x - maxHalf, x1: x + maxHalf };
}

/* Wall glow behind a light-emitting object, so nothing floats. */
function wallGlowMask(x, y, w, h, amt = 0.5) {
  return buildShadeMask(ROOM_W, ROOM_H, x, y, w, h, (xx, yy) => {
    const nx = (xx - w / 2) / (w / 2), ny = (yy - h / 2) / (h / 2);
    const d = nx * nx + ny * ny;
    return d > 1 ? 0 : amt * (1 - d);
  });
}

const POSTER_CRAB = [
  '..#.....#..',
  '.###...###.',
  '..#######..',
  '.#.#####.#.',
  '##.#o#o#.##',
  '.#.#####.#.',
  '..##.#.##..',
  '..#..#..#..',
];

function drawPosters(fb) {
  // Framed crab print above the desk (Rust, obviously).
  let x = 22, y = 30;
  fb.rect(x, y, 30, 26, C.INDIGO);
  fb.frame(x, y, 30, 26, C.BROWN);
  fb.sprite(x + 9, y + 6, POSTER_CRAB, { '#': C.ORANGE, 'o': C.VOID, '.': T });
  fb.text(x + 5, y + 18, 'RUST', C.ORANGE, { shadow: T, spacing: 5 });

  // Taped-up note by the rack.
  x = 158; y = 40;
  fb.rect(x, y, 26, 20, C.LILAC);
  fb.set(x, y, C.VOID); fb.set(x + 25, y, C.VOID);
  for (let i = 0; i < 4; i++) fb.hline(x + 3, y + 4 + i * 4, 14 + (i % 2) * 5, C.VIOLET);

  // Pinned PCB fab panel over the bench.
  x = 196; y = 34;
  fb.rect(x, y, 22, 16, C.GREEN);
  fb.frame(x, y, 22, 16, C.VOID);
  fb.hline(x + 3, y + 5, 14, C.ORANGE);
  fb.hline(x + 6, y + 10, 12, C.ORANGE);
  fb.set(x + 11, y + 2, C.RED);

  // "There's no place like 127.0.0.1" strip above the mail slot.
  x = 553; y = 50;
  fb.rect(x, y, 52, 12, C.INDIGO);
  fb.frame(x, y, 52, 12, C.VIOLET);
  fb.text(x + 3, y + 3, '127.0.0.1', C.GREEN, { shadow: T, spacing: 5 });
}

/* ---------- the download counter ----------
   boxy-cli is on crates.io and strangers keep installing it. That is the most
   load-bearing fact on this site — people I have never met run my code — so it
   gets a number on the wall that climbs on its own, instead of a sentence in a
   panel nobody opens. Zero-padded like a mechanical counter, which also stops
   the digits jittering as it rolls over a power of ten. */
const CTR_X = 358, CTR_Y = 26, CTR_W = 72, CTR_H = 34;
const CTR_DIGITS = 5, CELL_PITCH = 9, CELL_W_ = 8, CELL_H_ = 12;

function drawCounter(fb, t, n) {
  const midX = CTR_X + CTR_W / 2;

  // Mounting brackets, so it hangs off the wall rather than floating on it.
  fb.rect(CTR_X + 14, CTR_Y - 3, 3, 3, C.VIOLET);
  fb.rect(CTR_X + CTR_W - 17, CTR_Y - 3, 3, 3, C.VIOLET);

  fb.rect(CTR_X, CTR_Y, CTR_W, CTR_H, C.INDIGO);
  fb.frame(CTR_X, CTR_Y, CTR_W, CTR_H, C.VIOLET_LT);
  fb.textCenter(midX, CTR_Y + 3, 'BOXY-CLI', C.LILAC_LT);

  // A number we haven't got yet reads as dashes, never as a zero — claiming
  // nobody has installed it would be a worse lie than admitting we don't know.
  const shown = Number.isFinite(n)
    ? String(Math.min(n, 10 ** CTR_DIGITS - 1)).padStart(CTR_DIGITS, '0')
    : '-'.repeat(CTR_DIGITS);

  const row = CTR_DIGITS * CELL_PITCH - 1;
  const dx = Math.round(midX - row / 2);
  const dy = CTR_Y + 12;
  for (let i = 0; i < CTR_DIGITS; i++) {
    const cx = dx + i * CELL_PITCH;
    fb.rect(cx, dy, CELL_W_, CELL_H_, C.VOID);
    fb.frame(cx, dy, CELL_W_, CELL_H_, C.VIOLET);
    // Leading zeros sit dim, so the eye lands on the digits that mean something.
    const lead = i < CTR_DIGITS - 1 && shown.slice(0, i + 1) === '0'.repeat(i + 1);
    fb.text(cx + 2, dy + 3, shown[i], lead ? C.VIOLET_LT : C.AMBER_LT);
  }

  fb.textCenter(midX, CTR_Y + CTR_H - 9, 'DOWNLOADS', C.VIOLET_LT);

  // Live lamp, breathing rather than blinking.
  fb.set(CTR_X + 2, CTR_Y + 2, flick(t, 1.4, 0) > 0.35 ? C.GREEN : C.VIOLET);
}

/* Floor clutter — a rug, a parts crate, a pizza box. */
function drawClutter(fb) {
  // Rug in front of the desk.
  fb.ditherShape(16, FLOOR_Y + 7, 76, 15, C.ORANGE, (xx, yy) => {
    const nx = (xx - 38) / 38, ny = (yy - 7.5) / 7.5;
    const d = nx * nx + ny * ny;
    return d > 1 ? 0 : 0.5 * (1 - d * 0.5);
  });

  // Crate of parts beside the bench.
  fb.rect(246, FLOOR_Y - 14, 18, 14, C.BROWN);
  fb.frame(246, FLOOR_Y - 14, 18, 14, C.BROWN_DK);
  fb.hline(248, FLOOR_Y - 9, 14, C.ORANGE);
  fb.rect(249, FLOOR_Y - 18, 4, 4, C.CYAN);
  fb.rect(255, FLOOR_Y - 17, 5, 3, C.RED);

  // Pizza box, obviously.
  fb.rect(362, FLOOR_Y - 5, 16, 5, C.LILAC);
  fb.hline(362, FLOOR_Y - 5, 16, C.LILAC_LT);
  fb.rect(364, FLOOR_Y - 3, 3, 2, C.ORANGE);

  // Coiled cable spool by the rack.
  fb.discE(100, FLOOR_Y - 4, 5, C.VIOLET);
  fb.discE(100, FLOOR_Y - 4, 2, C.INDIGO);
}

/* ---------- 9. the ZapBurrito corner (studio) ---------- */

/* A neon sign, a design desk, and a corkboard of sketches — the studio needed
   somewhere to physically exist in the room, not just a panel. */
const CONCEPT_HERO = [
  '..###..',
  '.#ooo#.',
  '.#ooo#.',
  '..###..',
  '.##v##.',
  '#.#v#.#',
  '..#.#..',
];

function drawStudio(fb, t) {
  // --- neon sign ---
  const sx = 617, sy = 24, sw = 74, sh = 18;
  const buzz = flick(t, 9, 1.7) > 0.08;            // occasional neon stutter
  fb.rect(sx, sy, sw, sh, C.VOID);
  fb.frame(sx, sy, sw, sh, buzz ? C.ORANGE : C.BROWN);
  fb.text(sx + 5, sy + 6, 'ZAPBURRITO', buzz ? C.AMBER_LT : C.BROWN);
  if (buzz) {
    applyMask(fb, cache.neonGlow, LIGHT_MAP);
    fb.hline(sx + 3, sy + sh - 3, sw - 6, C.ORANGE);
  }
  // Mounting brackets.
  fb.vline(sx + 8, sy - 6, 6, C.VIOLET);
  fb.vline(sx + sw - 8, sy - 6, 6, C.VIOLET);

  // --- corkboard of concept sketches ---
  const bx = 699, by = 34, bw = 28, bh = 36;
  fb.rect(bx, by, bw, bh, C.BROWN);
  fb.frame(bx, by, bw, bh, C.BROWN_DK);
  fb.sprite(bx + 4, by + 4, CONCEPT_HERO, { '#': C.AMBER, 'o': C.VOID, 'v': C.RED, '.': T });
  for (let i = 0; i < 4; i++) fb.hline(bx + 4, by + 16 + i * 4, 12 + (i % 2) * 6, C.ORANGE);
  fb.set(bx + 6, by + 2, C.RED);                   // pins
  fb.set(bx + bw - 6, by + 2, C.RED);

  // --- design desk ---
  const dx = 621, topY = 110, dw = 78;
  fb.rect(dx, topY, dw, 4, C.BROWN);
  fb.hline(dx, topY, dw, C.ORANGE);
  fb.rect(dx + 4, topY + 4, 4, FLOOR_Y - topY - 4, C.BROWN_DK);
  fb.rect(dx + dw - 8, topY + 4, 4, FLOOR_Y - topY - 4, C.BROWN_DK);

  // Monitor running the game in an editor.
  const mx = dx + 14, my = topY - 32, mw = 46, mh = 32;
  fb.rect(mx + 20, my + mh - 5, 6, 5, C.VIOLET);   // stand
  fb.rect(mx, my, mw, mh - 6, C.VIOLET_LT);
  fb.frame(mx, my, mw, mh - 6, C.LILAC);
  const gx = mx + 3, gy = my + 3, gw = mw - 6, gh = mh - 12;
  fb.rect(gx, gy, gw, gh, C.VOID);
  // A tiny scene: ground, a hero, and a falling burrito.
  fb.hline(gx + 1, gy + gh - 3, gw - 2, C.GREEN);
  fb.rect(gx + 6, gy + gh - 7, 3, 4, C.AMBER);
  const fall = Math.floor((t * 6) % (gh - 8));
  fb.rect(gx + gw - 9, gy + 2 + fall, 3, 3, C.ORANGE);
  // Timeline strip under the viewport.
  for (let i = 0; i < gw - 4; i += 3) fb.set(gx + 2 + i, my + mh - 9, C.CYAN);

  // Sketchbook and a mug of pens.
  fb.rect(dx + 62, topY - 4, 12, 4, C.LILAC_LT);
  fb.hline(dx + 62, topY - 4, 12, C.WHITE);
  fb.rect(dx + 4, topY - 7, 7, 7, C.INDIGO);
  fb.set(dx + 6, topY - 9, C.RED);
  fb.set(dx + 8, topY - 10, C.CYAN);

}

/* ---------- composite ----------
   The room is mostly static: walls, posters, floor clutter and the wall glows
   never change. Redrawing all of it procedurally every frame was about 70% of
   the render cost, which is what made the console feel heavy on phones. It is
   now painted once into a base layer and copied with a single typed-array set,
   and every fixed light is a precomputed index mask rather than per-pixel
   falloff maths. */

let cache = null;

function buildCache() {
  const base = new Framebuffer(ROOM_W, ROOM_H);
  drawWalls(base);
  drawPosters(base);

  // Warm the wall behind each emitter before the objects land on top.
  for (const [x, y, w, h, amt] of [
    [16, 56, 70, 62, 0.55],    // CRT
    [94, 48, 64, 106, 0.4],    // rack
    [426, 42, 68, 76, 0.6],    // arcade marquee
    [352, 20, 84, 46, 0.45],   // the download counter
  ]) applyMask(base, wallGlowMask(x, y, w, h, amt), LIGHT_MAP);

  drawClutter(base);

  // The studio desk's floor pool sits under everything there, so it bakes in.
  const dx = 621, dw = 78;
  base.ditherShape(dx - 6, FLOOR_Y, dw + 12, 8, C.ORANGE, (xx, yy) => {
    const nx = (xx - (dw + 12) / 2) / ((dw + 12) / 2), ny = yy / 8;
    const d = nx * nx + ny * ny;
    return d > 1 ? 0 : 0.3 * (1 - d);
  });

  const shelfX = SHELF_X, shelfY = SHELF_Y, shelfW = SHELF_W;
  return {
    base,
    lamps: LAMPS.map(([x, cord]) => lampConeMask(x, cord)),
    shelfGlow: [0, 1].map((r) => {
      const sy = shelfY + r * 30 + 28;
      return buildShadeMask(ROOM_W, ROOM_H, shelfX - 4, sy, shelfW + 8, 22, (xx, yy) => {
        const nx = (xx - (shelfW + 8) / 2) / ((shelfW + 8) / 2);
        return Math.max(0, 0.8 * (1 - nx * nx) * (1 - yy / 22));
      });
    }),
    neonGlow: wallGlowMask(607, 16, 94, 38, 0.55),
  };
}

/* Every object is confined to a known strip of wall or floor. Padded by a few
   pixels each side, because a bound that is too tight makes an object vanish at
   the edge of the screen and a bound that is too loose costs nothing.
   tools/test-room.mjs proves the visible output is identical with these on. */
const SPAN = {
  stars:   [228, 302],
  desk:    [  6,  98],
  rack:    [ 94, 158],
  bench:   [160, 250],
  shelf:   [252, 366],
  counter: [348, 440],
  arcade:  [422, 498],
  printer: [491, 553],
  mail:    [555, 607],
  cat:     [374, 414],
  studio:  [597, 737],
};

export function drawRoom(fb, t, state = {}) {
  if (!cache) cache = buildCache();

  fb.px.set(cache.base.px);          // the static layer, in one copy

  /* The caller clips the framebuffer to the camera's window, which stops the
     writes but not the work that produces them — and applyMask walks a flat
     index list that ignores clipping altogether. Skipping whole objects is what
     actually saves the time. */
  const sees = ([x0, x1]) => x1 >= fb.cx0 && x0 < fb.cx1;

  if (sees(SPAN.stars)) drawStars(fb, t);
  if (sees(SPAN.desk)) drawDesk(fb, t);
  if (sees(SPAN.rack)) drawRack(fb, t);
  if (sees(SPAN.bench)) drawBench(fb, t);
  if (sees(SPAN.shelf)) drawShelf(fb, t, state.cartCount ?? 15);
  if (sees(SPAN.arcade)) drawArcade(fb, t);
  if (sees(SPAN.mail)) drawMail(fb, t);
  if (sees(SPAN.printer)) drawPrinter(fb, t);
  if (sees(SPAN.counter)) drawCounter(fb, t, state.downloads);
  if (sees(SPAN.cat)) drawCat(fb, t, state.catAwake ?? false, state.catOnRack ?? false);
  if (state.catOnRack && sees(SPAN.rack)) drawCatOnRack(fb, t);
  if (sees(SPAN.studio)) drawStudio(fb, t);

  // Fixtures hang in front of everything they light.
  for (let i = 0; i < LAMPS.length; i++) {
    const lamp = cache.lamps[i];
    if (!sees([lamp.x0, lamp.x1])) continue;
    drawLampFixture(fb, t, LAMPS[i][0], LAMPS[i][1], C.AMBER);
    applyMask(fb, lamp.mask, LIGHT_MAP);
  }
}
