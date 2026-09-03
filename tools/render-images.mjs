/* Regenerates the two images that are drawn from the room itself:
 *
 *   images/workshop.png     the panorama on the plain site's masthead
 *   images/social-card.png  the 1200x630 card used for og:image / twitter:image
 *   images/icon-180.png     the apple-touch-icon
 *
 * Run it after changing anything in js/room.js, js/player.js or the palette,
 * or those images will quietly disagree with the live console.
 *
 *   node tools/render-images.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Framebuffer, C, paletteRGB, blitRGBA, DARK_MAP } from '../js/gfx.js';
import { drawRoom, ROOM_W, ROOM_H, FLOOR_Y } from '../js/room.js';
import { Player } from '../js/player.js';
import { encodePNG, upscale } from './png.mjs';

/* The wall counter reads crates.io live in the browser. The stills can't, so
   the number is baked in at build time — ask crates.io if we can reach it, and
   fall back to dashes rather than inventing a figure. */
const DOWNLOADS = await fetch('https://crates.io/api/v1/crates/boxy-cli', {
  // crates.io turns away requests that don't identify themselves.
  headers: { 'User-Agent': 'bastamasta.dev image build (sameedahmed@bastamasta.dev)' },
})
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => d?.crate?.downloads ?? null)
  .catch(() => null);
console.log(`  crates.io boxy-cli downloads: ${DOWNLOADS ?? 'unavailable'}`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function write(fb, scale, rel) {
  const rgba = new Uint8Array(fb.w * fb.h * 4);
  blitRGBA(fb, rgba, paletteRGB());
  const up = upscale(fb.w, fb.h, rgba, scale);
  const out = path.join(ROOT, rel);
  fs.writeFileSync(out, encodePNG(up.w, up.h, up.data));
  console.log(`  ${rel.padEnd(26)} ${up.w}x${up.h}  ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

/* ---- the masthead panorama: the whole room, cat asleep ---- */
{
  const fb = new Framebuffer(ROOM_W, ROOM_H);
  drawRoom(fb, 3.2, { catAwake: false, catOnRack: false, cartCount: 15, downloads: DOWNLOADS });
  const p = new Player(299);            // standing at the cartridge shelf
  p.y = FLOOR_Y + 4;
  p.draw(fb, 3.2);
  fb.shade(0, 0, ROOM_W, ROOM_H, (x, y) => {
    const edge = Math.min(x, ROOM_W - x) / 90;
    const vert = Math.min(y, ROOM_H - y) / 26;
    return Math.max(0, 1 - Math.min(1, edge)) * 0.85
         + Math.max(0, 1 - Math.min(1, vert)) * 0.35;
  }, DARK_MAP);
  write(fb, 2, 'images/workshop.png');
}

/* ---- social card: 400x210 @3x = 1200x630, the ratio OG/Twitter crop to ---- */
{
  const W = 400, H = 210, BAR = 30;
  const card = new Framebuffer(W, H);
  const world = new Framebuffer(ROOM_W, ROOM_H);
  drawRoom(world, 3.2, { catAwake: true, catOnRack: false, cartCount: 15, downloads: DOWNLOADS });
  const p = new Player(299);
  p.y = FLOOR_Y + 4;
  p.draw(world, 3.2);

  const cam = Math.max(0, Math.min(ROOM_W - W, 299 - W / 2));
  for (let y = 0; y < ROOM_H; y++) {
    card.px.set(world.px.subarray(y * ROOM_W + cam, y * ROOM_W + cam + W), (y + BAR) * W);
  }
  card.shade(0, BAR, W, ROOM_H, (x, y) => {
    const nx = (x - W / 2) / (W / 2), ny = (y - ROOM_H / 2) / (ROOM_H / 2);
    const d = nx * nx * 0.9 + ny * ny;
    return d < 0.7 ? 0 : Math.min(1, (d - 0.7) * 1.4);
  }, DARK_MAP);

  card.rect(0, 0, W, BAR, C.VOID);
  card.hline(0, BAR - 1, W, C.AMBER);
  card.text(10, 6, 'SAMEED AHMED', C.AMBER_LT);
  card.text(10, 16, 'SYSTEMS PROGRAMMER', C.VIOLET_LT);
  card.text(W - 46, 11, 'ZAP-8', C.AMBER);
  write(card, 3, 'images/social-card.png');
}

/* ---- apple-touch-icon: 45x45 @4x = 180x180 ---- */
{
  const ic = new Framebuffer(45, 45);
  ic.clear(C.DEEP);
  ic.rect(3, 3, 39, 39, C.VOID);
  ic.frame(3, 3, 39, 39, C.AMBER);
  for (let y = 6; y < 40; y += 3) ic.hline(5, y, 35, C.INDIGO);
  ic.textCenter(23, 15, 'Z8', C.AMBER_LT);
  ic.hline(14, 28, 18, C.GREEN);
  ic.rect(14, 31, 4, 3, C.CYAN);
  ic.rect(26, 31, 4, 3, C.ORANGE);
  write(ic, 4, 'images/icon-180.png');
}
