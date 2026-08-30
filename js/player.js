/* The player: Sameed, 12x24, four-frame walk cycle.
   The original design — straight dark hair, glasses, dark tee with pale raglan
   sleeves — with fair skin, no beard, and a little more height. */

import { C, T, DARK_MAP as DARK } from './gfx.js';

export const PLAYER_W = 12;
export const PLAYER_H = 24;

const MAP = {
  '#': C.VOID,       // hair
  's': C.AMBER_LT,   // skin (fair)
  'g': C.LILAC_LT,   // glasses frame, as originally
  // The tee was C.INDIGO, which is the exact colour of the floor — he vanished
  // into it. Same violet family, moved up the ramp so he reads against both
  // the wall (deep) and the floor (indigo).
  'T': C.VIOLET_LT,  // tee
  'l': C.LILAC_LT,   // raglan sleeve
  'p': C.VIOLET,     // trousers
  'h': C.LILAC,      // shoes
  '.': T,
};

/* Rows 0..17 never change; only the legs swap per frame. */
const BODY = [
  '...######...',
  '..########..',
  '.##########.',
  '.##ssssss##.',
  '.#ggssssgg#.',   // the original had transparent gaps here, which punched
  '.#ssssssss#.',   // holes clean through the head against the background
  '.#ssssssss#.',
  '..ssssssss..',   // jaw
  '...ssssss...',   // chin
  '....ssss....',   // neck
  '..llTTTTll..',
  '.lllTTTTlll.',
  '.lllTTTTlll.',
  '.lllTTTTlll.',
  '.lllTTTTlll.',
  '..sTTTTTTs..',   // hands
  '...TTTTTT...',
  '...TTTTTT...',
];

/* Four leg poses: pass, contact, pass, contact (opposite lead). */
const STRIDE_PASS = [
  '...pppppp...', '...pp..pp...', '...pp..pp...',
  '...pp..pp...', '...pp..pp...', '..hh....hh..',
];
const STRIDE_STEP = [
  '...pppppp...', '..pp....pp..', '..pp....pp..',
  '.pp......pp.', '.pp......pp.', '.hh......hh.',
];
const STRIDE_TOGETHER = [
  '...pppppp...', '...pp..pp...', '...pp..pp...',
  '...pp..pp...', '...pp..pp...', '...hh..hh...',
];
const LEGS = [STRIDE_PASS, STRIDE_STEP, STRIDE_TOGETHER, STRIDE_STEP];

export class Player {
  constructor(x) {
    this.x = x;          // world x of the sprite's centre
    this.y = 0;          // set from the floor line
    this.facing = 1;     // 1 = right, -1 = left
    this.vx = 0;
    this.walkPhase = 0;
    this.target = null;  // click-to-walk destination
    this.speed = 62;     // px/sec
  }

  /* `dirInput` is -1/0/1 from the keyboard; a click target overrides it. */
  update(dt, dirInput, bounds) {
    let dir = dirInput;

    if (this.target !== null) {
      const d = this.target - this.x;
      if (Math.abs(d) < 2) { this.target = null; dir = 0; }
      else dir = Math.sign(d);
      if (dirInput !== 0) this.target = null; // keyboard always wins
    }

    this.vx = dir * this.speed;
    this.x += this.vx * dt;
    if (dir !== 0) this.facing = dir;

    const half = PLAYER_W / 2;
    this.x = Math.max(bounds[0] + half, Math.min(bounds[1] - half, this.x));

    if (dir !== 0) this.walkPhase += Math.max(0, dt) * 8.5;
    else this.walkPhase = 0;
  }

  get moving() { return this.vx !== 0; }

  draw(fb, t) {
    const x = Math.round(this.x - PLAYER_W / 2);
    // Idle breathing bob; walking uses the cycle's own vertical lift.
    const bob = this.moving
      ? (Math.floor(this.walkPhase) % 2 === 0 ? 0 : -1)
      : (Math.sin(t * 2) > 0.6 ? -1 : 0);
    const y = Math.round(this.y - PLAYER_H) + bob;

    // Contact shadow, so he stands on the floor rather than hovering.
    fb.shade(x - 3, this.y - 3, PLAYER_W + 6, 5, (xx, yy) => {
      const nx = (xx - (PLAYER_W + 6) / 2) / ((PLAYER_W + 6) / 2);
      const ny = (yy - 2) / 3;
      const d = nx * nx + ny * ny;
      return d > 1 ? 0 : 0.75 * (1 - d);
    }, DARK);

    // (n % m + m) % m — plain % keeps the sign in JS, and a negative index
    // here yielded undefined legs and threw inside the sprite renderer.
    const frame = this.moving ? ((Math.floor(this.walkPhase) % 4) + 4) % 4 : 0;
    const rows = BODY.concat(LEGS[frame] || STRIDE_PASS);
    fb.sprite(x, y, rows, MAP, { flipX: this.facing === -1, outline: C.VOID });
  }
}
