/* Catch-detection check for BURRITO DROP.
 *
 *   node tools/test-rom.mjs
 *
 * Drops the burrito at every horizontal offset relative to the paddle and
 * records whether the score went up. The paddle is 8px wide and the burrito
 * sprite is 4px, so a player sees them touching for offsets -3..+7 — anything
 * inside that range that fails to score is a catch the player watched land.
 */
import { assemble, Chip8 } from '../js/toys/chip8.js';
import { BURRITO_DROP } from '../js/toys/rom.js';

const PADDLE_W = 8, ITEM_W = 4, PADDLE_X = 24;
const rom = assemble(BURRITO_DROP);

/* Run one drop with the paddle at PADDLE_X and the burrito at PADDLE_X+offset.
   Returns true if the score went up. */
function drop(offset) {
  const vm = new Chip8();
  vm.load(rom);

  // Let it boot into the main loop and get an item on screen.
  for (let f = 0; f < 20; f++) { for (let i = 0; i < 30; i++) vm.step(); vm.tickTimers(); }

  const itemX = PADDLE_X + offset;
  if (itemX < 0 || itemX > 60) return null;      // off screen, not a real case
  vm.V[0] = PADDLE_X;
  vm.V[1] = itemX;
  vm.V[2] = 0;
  const before = vm.V[3] + vm.V[4] * 10;

  // Fall until it lands and a fresh item spawns at the top.
  let fell = false;
  for (let f = 0; f < 400; f++) {
    for (let i = 0; i < 30; i++) vm.step();
    vm.tickTimers();
    vm.V[0] = PADDLE_X;                          // hold the paddle still
    if (vm.V[2] > 4) fell = true;
    if (fell && vm.V[2] === 0) break;            // respawned: the drop resolved
  }
  return (vm.V[3] + vm.V[4] * 10) !== before;
}

let bad = 0;
const row = [];
for (let off = -6; off <= 10; off++) {
  const scored = drop(off);
  if (scored === null) { row.push(`${off}:--`); continue; }
  // Sprites overlap on screen whenever -(ITEM_W-1) <= offset <= PADDLE_W-1.
  const touching = off >= -(ITEM_W - 1) && off <= PADDLE_W - 1;
  const wrong = scored !== touching;
  if (wrong) bad++;
  row.push(`${String(off).padStart(3)}:${scored ? 'HIT ' : 'miss'}${wrong ? '<<' : '  '}`);
}
console.log('  offset of burrito from paddle left edge, and whether it scored:');
for (let i = 0; i < row.length; i += 6) console.log('   ', row.slice(i, i + 6).join(' '));
console.log(bad
  ? `\n  ${bad} offsets disagree with what is on screen (marked <<)`
  : '\n  every visible overlap scores, and nothing else does');
process.exit(bad ? 1 : 0);
