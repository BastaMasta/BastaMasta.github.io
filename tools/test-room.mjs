/* Checks on the room renderer. Run after touching js/room.js or the culling
 * bounds in it:
 *
 *   node tools/test-room.mjs
 *
 * The important one is CULLING: drawRoom skips objects whose strip falls
 * outside the framebuffer's clip rect, and a bound that is even slightly too
 * tight makes something vanish at the edge of the screen — a bug that only
 * shows at one camera position and is miserable to catch by eye.
 */
import { Framebuffer } from '../js/gfx.js';
import { drawRoom, ROOM_W, ROOM_H, HOTSPOTS } from '../js/room.js';

let checks = 0, failures = 0;
const ok = (label, cond) => {
  checks++;
  if (cond) return;
  failures++;
  console.error(`  FAIL  ${label}`);
};

const STATE = {
  cartCount: 15,
  downloads: 3843,
  catAwake: true,
  board: null,
};

/* ---- culling produces pixel-identical output ---- */
{
  const full = new Framebuffer(ROOM_W, ROOM_H);
  const cut = new Framebuffer(ROOM_W, ROOM_H);

  for (const t of [0, 1.3, 3.2, 7.7, 21.4]) {
    for (const onRack of [false, true]) {
      const state = { ...STATE, catOnRack: onRack };

      // Reference: no clip, so nothing is culled and everything is drawn.
      full.noClip();
      drawRoom(full, t, state);

      // Every camera position a real viewport can produce.
      for (let viewW of [150, 260, 400]) {
        for (let camX = 0; camX <= ROOM_W - viewW; camX += 7) {
          cut.clip(camX - 2, 0, viewW + 4, ROOM_H);
          drawRoom(cut, t, state);

          let bad = -1;
          for (let y = 0; y < ROOM_H && bad < 0; y++) {
            const row = y * ROOM_W;
            for (let x = camX; x < camX + viewW; x++) {
              if (cut.px[row + x] !== full.px[row + x]) { bad = row + x; break; }
            }
          }
          ok(`culled view matches at t=${t} rack=${onRack} w=${viewW} cam=${camX}`
             + (bad < 0 ? '' : ` (first diff ${bad % ROOM_W},${(bad / ROOM_W) | 0})`), bad < 0);
          if (bad >= 0) { camX = ROOM_W; viewW = 9999; }   // one report is enough
        }
      }
    }
  }
}

/* ---- the counter degrades honestly ---- */
{
  const a = new Framebuffer(ROOM_W, ROOM_H);
  const b = new Framebuffer(ROOM_W, ROOM_H);
  a.noClip(); b.noClip();
  drawRoom(a, 3.2, { ...STATE, downloads: null });
  drawRoom(b, 3.2, { ...STATE, downloads: 0 });
  let differs = false;
  for (let i = 0; i < a.px.length; i++) if (a.px[i] !== b.px[i]) { differs = true; break; }
  ok('an unknown download count does not render as zero', differs);
}

/* ---- every station is reachable ----
   git log has one "fixed an unreachable station" in it already, and moving an
   object means moving three numbers that have to stay consistent. */
{
  const sorted = [...HOTSPOTS].sort((a, b) => a.span[0] - b.span[0]);
  for (const h of HOTSPOTS) {
    ok(`${h.id}: standing spot is inside its own span`, h.x >= h.span[0] && h.x <= h.span[1]);
    ok(`${h.id}: label sits over the object`, h.lx >= h.span[0] - 30 && h.lx <= h.span[1] + 30);
    ok(`${h.id}: reachable by the player`, h.x >= 6 && h.x <= ROOM_W - 6);
  }
  for (let i = 1; i < sorted.length; i++) {
    ok(`${sorted[i - 1].id} and ${sorted[i].id} do not overlap`,
       sorted[i].span[0] >= sorted[i - 1].span[1]);
  }
  // Walking the room must reach every station exactly once.
  const hit = new Set();
  for (let x = 6; x <= ROOM_W - 6; x++) {
    let best = null, bestD = Infinity;
    for (const h of HOTSPOTS) {
      if (x < h.span[0] || x > h.span[1]) continue;
      const d = Math.abs(x - h.lx);
      if (d < bestD) { best = h; bestD = d; }
    }
    if (best) hit.add(best.id);
  }
  ok(`all ${HOTSPOTS.length} stations are hit by walking the room (got ${hit.size})`,
     hit.size === HOTSPOTS.length);
}

console.log(`${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
