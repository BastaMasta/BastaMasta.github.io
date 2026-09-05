/* Assembles the CHIP-8 game and writes roms/burrito-drop.ch8.
 * Run after editing js/toys/rom.js, or the downloadable ROM will be stale.
 *
 *   node tools/build-rom.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble, Chip8 } from '../js/toys/chip8.js';
import { BURRITO_DROP } from '../js/toys/rom.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rom = assemble(BURRITO_DROP);

// Smoke test before writing: it must run without halting.
const vm = new Chip8();
vm.load(rom);
for (let f = 0; f < 600; f++) {
  for (let i = 0; i < 30; i++) vm.step();
  vm.tickTimers();
  if (vm.halted) throw new Error(`ROM halted at pc=0x${vm.pc.toString(16)}`);
}

fs.writeFileSync(path.join(ROOT, 'roms/burrito-drop.ch8'), Buffer.from(rom));
fs.writeFileSync(path.join(ROOT, 'roms/burrito-drop.asm'),
  '; BURRITO DROP -- an original CHIP-8 game by Sameed Ahmed (BastaMasta)\n' +
  '; Assembles to roms/burrito-drop.ch8, load address 0x200.\n' +
  '; Controls: 4 = left, 6 = right.\n' +
  '; Uses no quirk-dependent opcodes (no SHR/SHL; VF is always set immediately\n' +
  '; before it is read), so it behaves the same on COSMAC-VIP and SUPER-CHIP\n' +
  '; style interpreters.\n' + BURRITO_DROP);
/* The download link advertises the size, and it had already drifted by 36 bytes
   before anyone noticed. Deriving it here means it cannot drift again. */
const page = path.join(ROOT, 'index.html');
const before = fs.readFileSync(page, 'utf8');
const after = before.replace(/burrito-drop\.ch8 \(\d+ B\)/, `burrito-drop.ch8 (${rom.length} B)`);
if (after !== before) {
  fs.writeFileSync(page, after);
  console.log('  index.html            download link size updated');
}

console.log(`  roms/burrito-drop.ch8  ${rom.length} bytes, 600 frames without halting`);
