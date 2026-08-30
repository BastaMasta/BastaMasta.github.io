/* A CHIP-8 virtual machine, and a small assembler to feed it.

   Sameed wrote a CHIP-8 interpreter in Rust; this is the same machine
   re-expressed in JavaScript so it can run on the ZAP-8's screen. The ROM it
   runs is not borrowed from anywhere — it is assembled at load time from the
   source in rom.js, so the whole cartridge is honest work. */

const FONT = [
  0xF0, 0x90, 0x90, 0x90, 0xF0, // 0
  0x20, 0x60, 0x20, 0x20, 0x70, // 1
  0xF0, 0x10, 0xF0, 0x80, 0xF0, // 2
  0xF0, 0x10, 0xF0, 0x10, 0xF0, // 3
  0x90, 0x90, 0xF0, 0x10, 0x10, // 4
  0xF0, 0x80, 0xF0, 0x10, 0xF0, // 5
  0xF0, 0x80, 0xF0, 0x90, 0xF0, // 6
  0xF0, 0x10, 0x20, 0x40, 0x40, // 7
  0xF0, 0x90, 0xF0, 0x90, 0xF0, // 8
  0xF0, 0x90, 0xF0, 0x10, 0xF0, // 9
  0xF0, 0x90, 0xF0, 0x90, 0x90, // A
  0xE0, 0x90, 0xE0, 0x90, 0xE0, // B
  0xF0, 0x80, 0x80, 0x80, 0xF0, // C
  0xE0, 0x90, 0x90, 0x90, 0xE0, // D
  0xF0, 0x80, 0xF0, 0x80, 0xF0, // E
  0xF0, 0x80, 0xF0, 0x80, 0x80, // F
];

export const DISPLAY_W = 64;
export const DISPLAY_H = 32;
export const PROG_START = 0x200;

export class Chip8 {
  constructor() {
    this.mem = new Uint8Array(4096);
    this.V = new Uint8Array(16);
    this.display = new Uint8Array(DISPLAY_W * DISPLAY_H);
    this.keys = new Uint8Array(16);
    this.stack = new Uint16Array(16);
    this.reset();
  }

  reset() {
    this.mem.fill(0);
    this.mem.set(FONT, 0);
    this.V.fill(0);
    this.display.fill(0);
    this.keys.fill(0);
    this.I = 0;
    this.pc = PROG_START;
    this.sp = 0;
    this.dt = 0;
    this.st = 0;
    this.halted = false;
    this.waitingKey = -1;
    this.drawFlag = true;
  }

  load(rom) {
    this.reset();
    this.mem.set(rom, PROG_START);
  }

  /* 60Hz timer tick, called independently of instruction rate. */
  tickTimers() {
    if (this.dt > 0) this.dt--;
    if (this.st > 0) this.st--;
  }

  get beeping() { return this.st > 0; }

  /* Execute one instruction. */
  step() {
    if (this.halted) return;

    if (this.waitingKey >= 0) {
      for (let k = 0; k < 16; k++) {
        if (this.keys[k]) {
          this.V[this.waitingKey] = k;
          this.waitingKey = -1;
          break;
        }
      }
      return; // stall until a key arrives
    }

    const op = (this.mem[this.pc] << 8) | this.mem[this.pc + 1];
    this.pc = (this.pc + 2) & 0xFFF;

    const nnn = op & 0x0FFF;
    const nn = op & 0x00FF;
    const n = op & 0x000F;
    const x = (op & 0x0F00) >> 8;
    const y = (op & 0x00F0) >> 4;
    const V = this.V;

    switch (op & 0xF000) {
      case 0x0000:
        if (op === 0x00E0) { this.display.fill(0); this.drawFlag = true; }
        else if (op === 0x00EE) { this.pc = this.stack[--this.sp & 0xF]; }
        else this.halted = true;          // unknown 0NNN: stop rather than run wild
        break;

      case 0x1000: this.pc = nnn; break;
      case 0x2000: this.stack[this.sp++ & 0xF] = this.pc; this.pc = nnn; break;
      case 0x3000: if (V[x] === nn) this.pc += 2; break;
      case 0x4000: if (V[x] !== nn) this.pc += 2; break;
      case 0x5000: if (V[x] === V[y]) this.pc += 2; break;
      case 0x6000: V[x] = nn; break;
      case 0x7000: V[x] = (V[x] + nn) & 0xFF; break;

      case 0x8000: {
        switch (n) {
          case 0x0: V[x] = V[y]; break;
          case 0x1: V[x] |= V[y]; V[0xF] = 0; break;
          case 0x2: V[x] &= V[y]; V[0xF] = 0; break;
          case 0x3: V[x] ^= V[y]; V[0xF] = 0; break;
          case 0x4: { const s = V[x] + V[y]; V[x] = s & 0xFF; V[0xF] = s > 0xFF ? 1 : 0; break; }
          case 0x5: { const d = V[x] - V[y]; V[x] = d & 0xFF; V[0xF] = d >= 0 ? 1 : 0; break; }
          case 0x6: { const f = V[y] & 1; V[x] = V[y] >> 1; V[0xF] = f; break; }
          case 0x7: { const d = V[y] - V[x]; V[x] = d & 0xFF; V[0xF] = d >= 0 ? 1 : 0; break; }
          case 0xE: { const f = (V[y] >> 7) & 1; V[x] = (V[y] << 1) & 0xFF; V[0xF] = f; break; }
          default: this.halted = true;
        }
        break;
      }

      case 0x9000: if (V[x] !== V[y]) this.pc += 2; break;
      case 0xA000: this.I = nnn; break;
      case 0xB000: this.pc = (nnn + V[0]) & 0xFFF; break;
      case 0xC000: V[x] = (Math.random() * 256 | 0) & nn; break;

      case 0xD000: {
        const px = V[x] % DISPLAY_W, py = V[y] % DISPLAY_H;
        V[0xF] = 0;
        for (let row = 0; row < n; row++) {
          const sy = py + row;
          if (sy >= DISPLAY_H) break;                  // clip, don't wrap
          const bits = this.mem[(this.I + row) & 0xFFF];
          for (let col = 0; col < 8; col++) {
            if (!(bits & (0x80 >> col))) continue;
            const sx = px + col;
            if (sx >= DISPLAY_W) break;
            const idx = sy * DISPLAY_W + sx;
            if (this.display[idx]) V[0xF] = 1;
            this.display[idx] ^= 1;
          }
        }
        this.drawFlag = true;
        break;
      }

      case 0xE000:
        if (nn === 0x9E) { if (this.keys[V[x] & 0xF]) this.pc += 2; }
        else if (nn === 0xA1) { if (!this.keys[V[x] & 0xF]) this.pc += 2; }
        else this.halted = true;
        break;

      case 0xF000:
        switch (nn) {
          case 0x07: V[x] = this.dt; break;
          case 0x0A: this.waitingKey = x; break;
          case 0x15: this.dt = V[x]; break;
          case 0x18: this.st = V[x]; break;
          case 0x1E: this.I = (this.I + V[x]) & 0xFFF; break;
          case 0x29: this.I = (V[x] & 0xF) * 5; break;
          case 0x33: {
            this.mem[this.I] = (V[x] / 100) | 0;
            this.mem[this.I + 1] = ((V[x] / 10) | 0) % 10;
            this.mem[this.I + 2] = V[x] % 10;
            break;
          }
          case 0x55: for (let i = 0; i <= x; i++) this.mem[this.I + i] = V[i]; this.I += x + 1; break;
          case 0x65: for (let i = 0; i <= x; i++) V[i] = this.mem[this.I + i]; this.I += x + 1; break;
          default: this.halted = true;
        }
        break;

      default: this.halted = true;
    }
  }
}

/* ============================================================
   Assembler
   Two passes: collect labels, then emit. Enough of the mnemonic set to write
   a real game, and it throws loudly rather than emitting garbage.
   ============================================================ */

const REG = /^V([0-9A-F])$/i;
const isReg = (t) => REG.test(t);
const regNum = (t) => parseInt(t.match(REG)[1], 16);

function value(tok, labels) {
  if (tok in labels) return labels[tok];
  if (/^0x[0-9a-f]+$/i.test(tok)) return parseInt(tok, 16);
  if (/^-?\d+$/.test(tok)) return parseInt(tok, 10);
  throw new Error(`chip8asm: cannot resolve "${tok}"`);
}

export function assemble(source) {
  // Normalise: strip comments, split into {label|op, args} records.
  const lines = [];
  for (const raw of source.split('\n')) {
    const line = raw.replace(/;.*$/, '').trim();
    if (!line) continue;
    if (line.endsWith(':')) { lines.push({ label: line.slice(0, -1) }); continue; }
    const m = line.match(/^(\S+)\s*(.*)$/);
    const args = m[2] ? m[2].split(',').map((s) => s.trim()).filter(Boolean) : [];
    lines.push({ op: m[1].toUpperCase(), args });
  }

  // Pass 1: sizes and label addresses.
  const labels = {};
  let addr = PROG_START;
  for (const l of lines) {
    if (l.label) { labels[l.label] = addr; continue; }
    l.addr = addr;
    addr += l.op === 'DB' ? l.args.length : 2;
  }

  // Pass 2: emit.
  const out = [];
  const w = (word) => { out.push((word >> 8) & 0xFF, word & 0xFF); };

  for (const l of lines) {
    if (l.label) continue;
    const a = l.args;
    switch (l.op) {
      case 'DB':
        for (const t of a) out.push(value(t, labels) & 0xFF);
        break;
      case 'CLS': w(0x00E0); break;
      case 'RET': w(0x00EE); break;
      case 'JP':
        if (a.length === 2 && /^V0$/i.test(a[0])) w(0xB000 | (value(a[1], labels) & 0xFFF));
        else w(0x1000 | (value(a[0], labels) & 0xFFF));
        break;
      case 'CALL': w(0x2000 | (value(a[0], labels) & 0xFFF)); break;
      case 'SE':
        if (isReg(a[1])) w(0x5000 | (regNum(a[0]) << 8) | (regNum(a[1]) << 4));
        else w(0x3000 | (regNum(a[0]) << 8) | (value(a[1], labels) & 0xFF));
        break;
      case 'SNE':
        if (isReg(a[1])) w(0x9000 | (regNum(a[0]) << 8) | (regNum(a[1]) << 4));
        else w(0x4000 | (regNum(a[0]) << 8) | (value(a[1], labels) & 0xFF));
        break;
      case 'ADD':
        if (/^I$/i.test(a[0])) w(0xF01E | (regNum(a[1]) << 8));
        else if (isReg(a[1])) w(0x8004 | (regNum(a[0]) << 8) | (regNum(a[1]) << 4));
        else w(0x7000 | (regNum(a[0]) << 8) | (value(a[1], labels) & 0xFF));
        break;
      case 'OR':   w(0x8001 | (regNum(a[0]) << 8) | (regNum(a[1]) << 4)); break;
      case 'AND':  w(0x8002 | (regNum(a[0]) << 8) | (regNum(a[1]) << 4)); break;
      case 'XOR':  w(0x8003 | (regNum(a[0]) << 8) | (regNum(a[1]) << 4)); break;
      case 'SUB':  w(0x8005 | (regNum(a[0]) << 8) | (regNum(a[1]) << 4)); break;
      case 'SHR':  w(0x8006 | (regNum(a[0]) << 8) | (regNum(a[1] || a[0]) << 4)); break;
      case 'SUBN': w(0x8007 | (regNum(a[0]) << 8) | (regNum(a[1]) << 4)); break;
      case 'SHL':  w(0x800E | (regNum(a[0]) << 8) | (regNum(a[1] || a[0]) << 4)); break;
      case 'RND':  w(0xC000 | (regNum(a[0]) << 8) | (value(a[1], labels) & 0xFF)); break;
      case 'DRW':  w(0xD000 | (regNum(a[0]) << 8) | (regNum(a[1]) << 4) | (value(a[2], labels) & 0xF)); break;
      case 'SKP':  w(0xE09E | (regNum(a[0]) << 8)); break;
      case 'SKNP': w(0xE0A1 | (regNum(a[0]) << 8)); break;
      case 'LD': {
        const [d, s] = a;
        if (/^I$/i.test(d))       w(0xA000 | (value(s, labels) & 0xFFF));
        else if (/^DT$/i.test(d)) w(0xF015 | (regNum(s) << 8));
        else if (/^ST$/i.test(d)) w(0xF018 | (regNum(s) << 8));
        else if (/^F$/i.test(d))  w(0xF029 | (regNum(s) << 8));
        else if (/^B$/i.test(d))  w(0xF033 | (regNum(s) << 8));
        else if (/^\[I\]$/i.test(d)) w(0xF055 | (regNum(s) << 8));
        else if (/^\[I\]$/i.test(s)) w(0xF065 | (regNum(d) << 8));
        else if (/^DT$/i.test(s)) w(0xF007 | (regNum(d) << 8));
        else if (/^K$/i.test(s))  w(0xF00A | (regNum(d) << 8));
        else if (isReg(s))        w(0x8000 | (regNum(d) << 8) | (regNum(s) << 4));
        else                      w(0x6000 | (regNum(d) << 8) | (value(s, labels) & 0xFF));
        break;
      }
      default:
        throw new Error(`chip8asm: unknown mnemonic "${l.op}"`);
    }
  }
  return Uint8Array.from(out);
}
