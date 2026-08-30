/* ZAP-8 — the machine.

   Owns the render loop, the camera, input, and the bridge between the pixel
   world and the real DOM content. The document in #doc is the single source of
   truth: console mode just lifts a section into an overlay panel, so the plain
   version and the console version can never drift apart. */

import { Framebuffer, SCREEN_W, C, paletteU32, blitU32, buildShadeMask, applyMask,
         LIGHT_MAP, DARK_MAP } from './gfx.js';
import { drawRoom, ROOM_W, ROOM_H, FLOOR_Y, HOTSPOTS } from './room.js';
import { Player } from './player.js';
import { ICON } from './font.js';
import { Chip8, assemble, DISPLAY_W, DISPLAY_H } from './toys/chip8.js';
import { BURRITO_DROP } from './toys/rom.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const isCoarse = () => matchMedia('(pointer: coarse)').matches;

/* Bounds for the adaptive framebuffer. Width varies with the viewport; height
   never exceeds the room art's 180px. */
const MIN_FB_W = 150, MAX_FB_W = 400, MIN_FB_H = 140, MAX_SCALE = 4;

/* Boot sequence pacing. Slow enough that the POST lines can actually be read
   before the workshop loads; any key still skips it, and it only plays once
   per session. */
const BOOT_LINE_SECS = 0.25;
const BOOT_HOLD_SECS = 1.8;
/* Below this the view feels claustrophobic, so a big screen trades one step of
   scale for a wider window on the room. Phones can't afford that and fall back
   to MIN_FB_W. */
const COMFY_FB_W = 260;

/* ============================================================
   Mode: console vs plain
   ============================================================ */

const STORE_KEY = 'zap8:mode';

function readMode() {
  const q = new URLSearchParams(location.search);
  if (q.has('plain')) return 'plain';
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved === 'plain' || saved === 'console') return saved;
  } catch { /* private mode; fall through */ }
  return 'console';
}

function writeMode(mode) {
  try { localStorage.setItem(STORE_KEY, mode); } catch { /* ignore */ }
}

/* ============================================================
   Sound — a few square-wave blips, nothing more
   ============================================================ */

const sfx = {
  ctx: null,
  muted: false,
  broken: false,
  ensure() {
    if (this.broken) return null;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) { this.broken = true; return null; }
        this.ctx = new AC();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    } catch {
      this.broken = true;   // audio blocked; carry on silently
      return null;
    }
  },
  blip(freq = 440, dur = 0.06, type = 'square', gain = 0.05) {
    if (this.muted) return;
    const ctx = this.ensure();
    if (!ctx) return;
    try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + dur);
    } catch { /* an audio failure must never stop the render loop */ }
  },
  step() { this.blip(90 + Math.random() * 30, 0.03, 'square', 0.02); },
  open() { this.blip(660, 0.07); this.setTimeoutBlip(880, 0.07, 70); },
  close() { this.blip(400, 0.05); },
  setTimeoutBlip(f, d, ms) { setTimeout(() => this.blip(f, d), ms); },
};

/* ============================================================
   Engine
   ============================================================ */

class Zap8 {
  constructor() {
    this.canvas = $('#screen');
    this.ctx = this.canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    this.fb = null;            // sized in resize(), which runs before the
    this.pal32 = paletteU32(); // packed palette for the blit
    this.camY = 0;
    this.scale = 1;

    this.player = new Player(46);
    this.player.y = FLOOR_Y + 4;
    this.camX = 0;
    this.t = 0;
    this.keys = new Set();
    this.mode = 'boot';        // boot | room | game
    this.active = true;        // false while the document view is showing
    this.openPanel = null;
    this.near = null;
    this.catAwake = false;
    // One roll per visit: nine times out of ten Oreo is on his beanbag, and
    // now and then he has claimed the top of the server rack instead.
    this.catOnRack = Math.random() < 0.1;
    const rackNote = $('[data-oreo="rack"]');
    if (rackNote) rackNote.hidden = !this.catOnRack;
    this.bootLine = 0;
    this.bootT = 0;

    this.chip = null;
    this.chipAcc = 0;
    /* Phosphor decay buffer. CHIP-8 draws by XOR, so a sprite is erased and
       redrawn every frame and a naive renderer strobes badly. A real CRT holds
       the image for a few milliseconds; emulating that decay is both truer to
       the hardware and the thing that makes it comfortable to look at. */
    this.phos = new Float32Array(DISPLAY_W * DISPLAY_H);

    this.hint = $('#hint');
    this.hudKeys = $('#hud-keys');
  }

  /* ---------- lifecycle ---------- */

  start() {
    this.bindInput();
    this.buildTouchPad();
    this.resize();
    this.syncTouchPad();
    addEventListener('resize', () => { if (this.active) this.resize(); });
    this.setHudKeys();
    let last = performance.now();
    let faults = 0;
    const frame = (now) => {
      const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
      last = now;
      try {
        if (this.active) {
          this.update(dt);
          this.render();
        }
      } catch (err) {
        // Keep the loop alive: a single bad frame used to blank the console
        // permanently, because nothing rescheduled the animation frame.
        if (faults++ === 0) console.error('[zap8] frame error:', err);
        if (faults > 240) { console.error('[zap8] giving up; falling back'); this.onTogglePlain?.(); return; }
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  /* Pick a framebuffer size and an integer scale that together fill the
     viewport. A fixed 320x180 was the wrong shape for phones: on a 390px
     screen the integer scale floors to 1x, which is both tiny and leaves most
     of the height empty. Varying the framebuffer instead keeps pixels big and
     square — the console simply has a different sized screen on a phone. */
  resize() {
    const wrap = $('#console');
    if (!wrap || wrap.hidden) return;

    // Measure the real space instead of hard-coding chrome that has to be kept
    // in sync with the stylesheet by hand — that drifted and made the canvas
    // overflow its bezel on phones. Note clientWidth/Height INCLUDE padding,
    // so both the wrapper's padding and the cabinet's have to come off.
    const n = (v) => parseFloat(v) || 0;
    const cabinet = $('#cabinet');
    const canMeasure = typeof getComputedStyle === 'function';
    let insetX = 60, insetY = 60;                       // sane fallback
    if (canMeasure && cabinet) {
      const wc = getComputedStyle(wrap);
      const cc = getComputedStyle(cabinet);
      insetX = n(wc.paddingLeft) + n(wc.paddingRight)
             + n(cc.paddingLeft) + n(cc.paddingRight)
             + n(cc.borderLeftWidth) + n(cc.borderRightWidth);
      insetY = n(wc.paddingTop) + n(wc.paddingBottom)
             + n(cc.paddingTop) + n(cc.paddingBottom)
             + n(cc.borderTopWidth) + n(cc.borderBottomWidth);
    }
    const boxW = wrap.clientWidth || innerWidth;
    const boxH = wrap.clientHeight || innerHeight;
    const availW = Math.max(MIN_FB_W, boxW - insetX - 2);
    const availH = Math.max(MIN_FB_H, boxH - insetY - 2);

    let scale = 1;
    let w = availW;
    let h = availH;
    const pick = (minW) => {
      for (let s = MAX_SCALE; s >= 2; s--) {
        const cw = Math.floor(availW / s);
        const ch = Math.floor(availH / s);
        if (cw >= minW && ch >= MIN_FB_H) return { s, w: cw, h: ch };
      }
      return null;
    };
    const chosen = pick(COMFY_FB_W) || pick(MIN_FB_W);
    if (chosen) { scale = chosen.s; w = chosen.w; h = chosen.h; }
    w = Math.max(MIN_FB_W, Math.min(w, MAX_FB_W));
    h = Math.max(MIN_FB_H, Math.min(h, ROOM_H));
    w -= w % 2;                                     // even dims keep the
    h -= h % 2;                                     // dither pattern stable

    if (!this.fb || this.fb.w !== w || this.fb.h !== h) {
      this.fb = new Framebuffer(w, h);
      this.canvas.width = w;
      this.canvas.height = h;
      this.ctx.imageSmoothingEnabled = false;
      this.imageData = this.ctx.createImageData(w, h);
      this.rgba = this.imageData.data;
      this.out32 = new Uint32Array(this.rgba.buffer);
      // The vignette never moves for a given screen size, so its dither
      // pattern is fixed and can be reduced to a list of pixels to darken.
      this.vignette = buildShadeMask(w, h, 0, 0, w, h, (x, y) => {
        const nx = (x - w / 2) / (w / 2);
        const ny = (y - h / 2) / (h / 2);
        const d = nx * nx * 0.9 + ny * ny;
        return d < 0.75 ? 0 : Math.min(1, (d - 0.75) * 1.5);
      });
    }

    // Crop mostly off the ceiling, so the floor and the player stay in frame.
    this.camY = Math.round((ROOM_H - h) * 0.78);
    this.scale = scale;
    this.canvas.style.width = `${w * scale}px`;
    this.canvas.style.height = `${h * scale}px`;
    this.setHudKeys();
  }

  /* On-screen arrows. Required on phones and tablets — without a keyboard
     there is otherwise no way to walk, and no way at all to play the game. */
  buildTouchPad() {
    const pad = document.createElement('div');
    pad.id = 'touchpad';
    pad.innerHTML = `
      <button type="button" class="tp tp-dir" data-dir="-1" aria-label="Walk left">&#9664;</button>
      <button type="button" class="tp tp-act" data-act="1" aria-label="Examine">&#9679;</button>
      <button type="button" class="tp tp-dir" data-dir="1" aria-label="Walk right">&#9654;</button>`;
    $('#console').append(pad);
    this.touchPad = pad;
    this.touchDir = 0;

    const hold = (btn, on) => {
      const dir = Number(btn.dataset.dir);
      btn.classList.toggle('is-down', on);
      if (on) this.touchDir = dir;
      else if (this.touchDir === dir) this.touchDir = 0;
    };

    $$('.tp-dir', pad).forEach((btn) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        hold(btn, true);
      });
      for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) {
        btn.addEventListener(ev, () => hold(btn, false));
      }
    });

    const act = $('.tp-act', pad);
    act.addEventListener('click', (e) => {
      e.preventDefault();
      if (this.mode === 'boot') this.skipBoot();
      else if (this.mode === 'game') this.exitGame();
      else this.interact();
    });
    this.touchAct = act;
  }

  syncTouchPad() {
    if (!this.touchPad) return;
    const show = isCoarse() && !this.openPanel;
    this.touchPad.hidden = !show;
    if (!show) this.touchDir = 0;
    if (this.touchAct) {
      const game = this.mode === 'game';
      this.touchAct.innerHTML = game ? '&#10005;' : '&#9679;';
      this.touchAct.setAttribute('aria-label', game ? 'Leave the game' : 'Examine');
      this.touchAct.classList.toggle('is-lit', !game && !!this.near);
    }
  }

  /* ---------- input ---------- */

  bindInput() {
    addEventListener('keydown', (e) => {
      // Never swallow keys while someone is typing in the contact form.
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Anything with a modifier belongs to the browser, not to us. Without
      // this, Ctrl/Cmd+P was caught by the plain-version shortcut below and
      // preventDefault() swallowed the print dialog entirely — and the same
      // went for Ctrl+R, Cmd+F, Ctrl+A and the rest.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (this.openPanel) { this.closePanel(); e.preventDefault(); }
        else if (this.mode === 'game') { this.exitGame(); e.preventDefault(); }
        return;
      }

      if ((e.key === 'p' || e.key === 'P') && !this.openPanel) {
        this.onTogglePlain?.();
        e.preventDefault();
        return;
      }

      // Everything below drives the console. While the document view is up it
      // must keep its hands off the keyboard, or arrows and Space stop
      // scrolling the page.
      if (!this.active) return;

      if (this.mode === 'boot') { this.skipBoot(); e.preventDefault(); return; }
      if (this.openPanel) return;

      this.keys.add(e.key);

      if (this.mode === 'room') {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
          this.interact();
          e.preventDefault();
        }
        // Number keys jump straight to a station.
        const n = parseInt(e.key, 10);
        if (n >= 1 && n <= HOTSPOTS.length) {
          this.player.target = HOTSPOTS[n - 1].x;
          e.preventDefault();
        }
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
    });

    addEventListener('keyup', (e) => this.keys.delete(e.key));
    addEventListener('blur', () => this.keys.clear());

    // Tap or click anywhere on the screen to walk there; on a station, enter it.
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.mode === 'boot') { this.skipBoot(); return; }
      const rect = this.canvas.getBoundingClientRect();
      const sx = (e.clientX - rect.left) / rect.width * this.fb.w;
      const worldX = sx + this.camX;
      if (this.mode === 'game') return;

      // Tapping an object walks to it; tapping the one you're already at opens it.
      const hit = nearestHotspot(worldX)
        || HOTSPOTS.reduce((best, h) => {
             const d = Math.abs(h.lx - worldX);
             return d < 34 && (!best || d < Math.abs(best.lx - worldX)) ? h : best;
           }, null);
      if (hit && this.near === hit) {
        this.enter(hit);
      } else if (hit) {
        this.player.target = hit.x;
      } else {
        this.player.target = worldX;
      }
    });
  }

  get dirInput() {
    let d = this.touchDir || 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('a') || this.keys.has('A')) d -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('d') || this.keys.has('D')) d += 1;
    return Math.sign(d);
  }

  /* ---------- update ---------- */

  update(dt) {
    this.t += dt;

    if (this.mode === 'boot') { this.updateBoot(dt); return; }
    if (this.mode === 'game') { this.updateGame(dt); return; }

    const wasMoving = this.player.moving;
    this.player.update(this.openPanel ? 0 : dt, this.openPanel ? 0 : this.dirInput, [6, ROOM_W - 6]);

    // Footstep ticks.
    if (this.player.moving) {
      this._stepAcc = (this._stepAcc || 0) + dt;
      if (this._stepAcc > 0.24) { this._stepAcc = 0; sfx.step(); }
    }

    // Camera follows with a dead zone, clamped to the room.
    const viewW = this.fb ? this.fb.w : SCREEN_W;
    const targetCam = this.player.x - viewW / 2;
    this.camX += (targetCam - this.camX) * Math.min(1, dt * 6);
    this.camX = Math.max(0, Math.min(ROOM_W - viewW, this.camX));

    // Nearest station.
    const prev = this.near;
    this.near = nearestHotspot(this.player.x);
    if (this.near !== prev) { this.updateHint(); this.syncTouchPad(); }
  }

  updateBoot(dt) {
    this.bootT += dt;
    const line = Math.floor(this.bootT / BOOT_LINE_SECS);
    if (line !== this.bootLine && line < BOOT_LINES.length) {
      this.bootLine = line;
      sfx.blip(1400 + Math.random() * 200, 0.012, 'square', 0.015);
    }
    if (this.bootT > BOOT_LINES.length * BOOT_LINE_SECS + BOOT_HOLD_SECS) {
      this.skipBoot();
    }
  }

  skipBoot() {
    if (this.mode !== 'boot') return;
    this.mode = 'room';
    this.updateHint();
    this.syncTouchPad();
    sfx.blip(880, 0.09);
  }

  /* ---------- interaction ---------- */

  interact() {
    if (this.near) this.enter(this.near);
  }

  enter(hot) {
    if (hot.action === 'game') { this.startGame(); return; }
    if (hot.id === 'cat') { this.catAwake = true; sfx.blip(520, 0.12, 'sine', 0.05); }
    const section = $(`[data-panel="${hot.panel}"]`);
    if (section) this.showPanel(section);
  }

  showPanel(section) {
    if (this.openPanel) this.closePanel(true);
    this.openPanel = section;
    section.classList.add('is-open');
    document.body.classList.add('panel-open');
    section.setAttribute('tabindex', '-1');
    const body = section.querySelector('.panel-body');
    if (body) body.scrollTop = 0;
    section.focus({ preventScroll: true });
    history.replaceState(null, '', `#${section.id}`);
    sfx.open();
    this.updateHint();
    this.syncTouchPad();
  }

  closePanel(quiet) {
    if (!this.openPanel) return;
    this.openPanel.classList.remove('is-open');
    this.openPanel.removeAttribute('tabindex');
    this.openPanel = null;
    document.body.classList.remove('panel-open');
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (!quiet) sfx.close();
    this.canvas.focus?.();
    this.updateHint();
    this.syncTouchPad();
  }

  updateHint() {
    if (!this.hint) return;
    if (this.mode === 'game') { this.hint.textContent = 'Burrito Drop — catch it'; return; }
    if (this.openPanel) { this.hint.textContent = 'Esc to close'; return; }
    this.hint.textContent = this.near ? `${this.near.label} — press Enter` : '';
  }

  setHudKeys() {
    if (!this.hudKeys) return;
    this.hudKeys.innerHTML = isCoarse()
      ? '<span>Tap the screen to walk there</span>'
      : '<span><b>&larr;</b><b>&rarr;</b> walk</span>' +
        '<span><b>Enter</b> examine</span>' +
        '<span><b>1</b>&ndash;<b>8</b> jump</span>' +
        '<span><b>Esc</b> back</span>' +
        '<span><b>P</b> plain version</span>';
  }

  /* ---------- the arcade cabinet ---------- */

  startGame() {
    if (!this.chip) {
      this.chip = new Chip8();
      this.romBytes = assemble(BURRITO_DROP);
    }
    this.chip.load(this.romBytes);
    this.mode = 'game';
    this.chipAcc = 0;
    this.updateHint();
    this.syncTouchPad();
    sfx.blip(300, 0.08);
    sfx.setTimeoutBlip(600, 0.1, 90);
  }

  exitGame() {
    this.mode = 'room';
    if (this.chip) this.chip.keys.fill(0);
    this.updateHint();
    this.syncTouchPad();
    sfx.close();
  }

  updateGame(dt) {
    const vm = this.chip;
    // CHIP-8 keypad: 4 = left, 6 = right. Map arrows and A/D onto them.
    const left = this.touchDir < 0 || this.keys.has('ArrowLeft') || this.keys.has('a') || this.keys.has('A') || this.keys.has('4');
    const right = this.touchDir > 0 || this.keys.has('ArrowRight') || this.keys.has('d') || this.keys.has('D') || this.keys.has('6');
    vm.keys[4] = left ? 1 : 0;
    vm.keys[6] = right ? 1 : 0;

    // 60Hz timers, ~1800 instructions/sec. The ROM paces itself off the delay
    // timer, so a higher instruction rate doesn't speed the game up — it just
    // keeps each XOR erase/redraw pair inside a single tick, which is what
    // stops the sprites flickering.
    this.chipAcc += dt;
    while (this.chipAcc >= 1 / 60) {
      this.chipAcc -= 1 / 60;
      for (let i = 0; i < 30; i++) vm.step();
      const wasBeeping = vm.beeping;
      vm.tickTimers();
      if (wasBeeping && !vm.beeping) sfx.blip(760, 0.05, 'square', 0.04);
    }

    // Charge the phosphor where pixels are lit, let the rest fade.
    const decay = Math.pow(0.02, dt / 0.09);   // ~90ms to near-black
    const d = vm.display, ph = this.phos;
    for (let i = 0; i < ph.length; i++) ph[i] = d[i] ? 1 : ph[i] * decay;
  }

  /* ---------- render ---------- */

  render() {
    const fb = this.fb;
    if (!fb) return;   // resize() hasn't run yet (console still hidden)
    if (this.mode === 'boot') this.renderBoot(fb);
    else if (this.mode === 'game') this.renderGame(fb);
    else this.renderRoom(fb);

    blitU32(fb, this.out32, this.pal32);
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  renderBoot(fb) {
    fb.clear(C.VOID);
    const narrow = fb.w < 200;
    const pad = narrow ? 5 : 10;
    const lead = fb.h < 160 ? 8 : 9;
    const shown = Math.min(BOOT_LINES.length, this.bootLine + 1);
    for (let i = 0; i < shown; i++) {
      const [long, short, col] = BOOT_LINES[i];
      fb.text(pad, 10 + i * lead, narrow ? short : long, col);
    }
    if (Math.floor(this.t * 3) % 2 === 0 && shown >= BOOT_LINES.length) {
      fb.rect(pad, 10 + shown * lead, 5, 7, C.GREEN);
    }
    fb.text(pad, fb.h - 12, narrow ? 'TAP TO START' : 'PRESS ANY KEY', C.VIOLET_LT);
  }

  renderRoom(fb) {
    const camX = Math.round(this.camX);
    const camY = this.camY;

    if (!this.roomFb) this.roomFb = new Framebuffer(ROOM_W, ROOM_H);
    drawRoom(this.roomFb, reduceMotion ? 0 : this.t, {
      catAwake: this.catAwake,
      catOnRack: this.catOnRack,
      cartCount: 15,
    });
    this.player.draw(this.roomFb, this.t);
    this.drawMarkers(this.roomFb);

    // Blit the visible window out of the room.
    for (let y = 0; y < fb.h; y++) {
      const src = (y + camY) * ROOM_W + camX;
      fb.px.set(this.roomFb.px.subarray(src, src + fb.w), y * fb.w);
    }

    // Vignette, so the tube edges fall away.
    applyMask(fb, this.vignette, DARK_MAP);

    this.drawTopBar(fb);
  }

  /* Floating labels over each station, brightest for the one in reach. */
  drawMarkers(fb) {
    for (const h of HOTSPOTS) {
      const active = this.near === h;
      const dist = Math.abs(this.player.x - h.lx);
      if (dist > 150) continue;
      const bob = Math.round(Math.sin(this.t * 2.4 + h.lx) * 1.2);
      const y = FLOOR_Y - 62 + bob;
      if (active) {
        const w = fb.textW(h.label) + 8;
        fb.rect(h.lx - w / 2, y - 3, w, 12, C.VOID);
        fb.frame(h.lx - w / 2, y - 3, w, 12, C.AMBER);
        fb.textCenter(h.lx, y, h.label, C.AMBER_LT);
        fb.textCenter(h.lx, y + 11, ICON.DOWN, C.AMBER);
      } else {
        // A dim pip, fading with distance.
        const fade = 1 - dist / 150;
        if (fade > 0.35) fb.textCenter(h.lx, y + 6, ICON.UP, C.VIOLET_LT);
      }
    }
  }

  drawTopBar(fb) {
    const idx = HOTSPOTS.indexOf(this.near);
    if (fb.w >= 190) fb.text(4, 4, 'ZAP-8', C.VIOLET_LT);
    // Station pips across the top-right, filled up to where you are.
    const n = HOTSPOTS.length;
    for (let i = 0; i < n; i++) {
      fb.rect(fb.w - 6 - (n - i) * 6, 5, 4, 4, i === idx ? C.AMBER : C.VIOLET);
    }
  }

  renderGame(fb) {
    fb.clear(C.VOID);
    fb.frame(0, 0, fb.w, fb.h, C.INDIGO);

    const narrow = fb.w < 230;
    fb.text(5, 4, 'BURRITO DROP', C.AMBER);
    if (!narrow) fb.text(fb.w - 78, 4, 'ESC TO LEAVE', C.VIOLET_LT);

    // Fit the 64x32 display to the space that's actually available.
    const S = Math.max(1, Math.min(
      4,
      Math.floor((fb.w - 10) / DISPLAY_W),
      Math.floor((fb.h - 34) / DISPLAY_H),
    ));
    const dw = DISPLAY_W * S, dh = DISPLAY_H * S;
    const ox = (fb.w - dw) >> 1;
    const oy = 15 + Math.max(0, (fb.h - 29 - dh) >> 1);

    fb.rect(ox - 3, oy - 3, dw + 6, dh + 6, C.DEEP);
    fb.frame(ox - 3, oy - 3, dw + 6, dh + 6, C.VIOLET);

    const ph = this.phos;
    for (let y = 0; y < DISPLAY_H; y++) {
      for (let x = 0; x < DISPLAY_W; x++) {
        const v = ph[y * DISPLAY_W + x];
        if (v < 0.06) continue;
        const col = v > 0.55 ? C.AMBER_LT : v > 0.22 ? C.AMBER : C.ORANGE;
        fb.rect(ox + x * S, oy + y * S, S, S, col);
      }
    }
    fb.shade(ox - 3, oy - 3, dw + 6, dh + 6, () => 0.22, LIGHT_MAP);

    fb.text(5, fb.h - 10,
      narrow ? '\x03 \x04 TO MOVE' : '\x03 \x04 OR A/D TO MOVE', C.VIOLET_LT);
  }
}

/* Whichever station the player is actually closest to wins, so overlapping
   reach ranges never resolve by array order. */
function nearestHotspot(x) {
  let best = null, bestD = Infinity;
  for (const h of HOTSPOTS) {
    if (x < h.span[0] || x > h.span[1]) continue;
    const d = Math.abs(x - h.lx);          // nearest to the object itself
    if (d < bestD) { best = h; bestD = d; }
  }
  return best;
}

/* [wide, narrow, colour] — phones get the abbreviated column. */
const BOOT_LINES = [
  ['ZAP-8 BOOT ROM  V2.0', 'ZAP-8 BOOT V2.0', C.AMBER],
  ['(C) ZAPBURRITO STUDIOS', '(C) ZAPBURRITO', C.VIOLET_LT],
  ['', '', C.VOID],
  ['CPU ....... OK', 'CPU ....... OK', C.GREEN],
  ['VRAM ADAPTIVE .... OK', 'VRAM ...... OK', C.GREEN],
  ['PALETTE 16 ....... OK', 'PALETTE 16  OK', C.GREEN],
  ['CARTRIDGE SLOT ... 15', 'CARTS ..... 15', C.GREEN],
  ['HOME LAB LINK .... UP', 'HOMELAB ... UP', C.GREEN],
  ['SLEEP SCHEDULE ... NOT FOUND', 'SLEEP ..... NONE', C.RED],
  ['', '', C.VOID],
  ['LOADING WORKSHOP...', 'LOADING...', C.AMBER_LT],
  ['PRESS P FOR PLAIN TEXT VERSION', 'P = PLAIN TEXT', C.CYAN],
];

/* ============================================================
   DOM widgets that live in both modes
   ============================================================ */

function buildBinaryKeeb() {
  const host = $('[data-widget="binarykeeb"]');
  if (!host) return;
  host.innerHTML = '';

  const live = document.createElement('div');
  live.className = 'keeb-live';

  const keys = document.createElement('div');
  keys.className = 'keeb-keys';

  const readout = document.createElement('div');
  readout.className = 'keeb-readout';
  const chEl = document.createElement('span');
  chEl.className = 'keeb-char';
  const numEl = document.createElement('span');
  numEl.className = 'keeb-num';
  readout.append(chEl, numEl);

  const bits = new Array(8).fill(0);

  function update() {
    const byte = bits.reduce((acc, b) => (acc << 1) | b, 0);
    const printable = byte >= 32 && byte < 127;
    chEl.textContent = printable ? String.fromCharCode(byte) : '·';
    chEl.style.color = printable ? '' : 'var(--violet-lt)';
    numEl.textContent = `${bits.join('')}  =  ${byte}  =  0x${byte.toString(16).toUpperCase().padStart(2, '0')}`
      + (printable ? '' : '  (unprintable)');
  }

  bits.forEach((_, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'keeb-key';
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', `Bit ${7 - i}, value ${1 << (7 - i)}`);
    b.textContent = '0';
    b.addEventListener('click', () => {
      bits[i] ^= 1;
      b.textContent = String(bits[i]);
      b.setAttribute('aria-pressed', String(!!bits[i]));
      sfx.blip(bits[i] ? 720 : 360, 0.04);
      update();
    });
    keys.append(b);
  });

  live.append(keys, readout);
  host.append(live);
  update();
}

function buildFilters() {
  const filters = $$('.filter');
  const carts = $$('.cart');
  if (!filters.length) return;
  filters.forEach((btn) => {
    btn.addEventListener('click', () => {
      const want = btn.dataset.filter;
      filters.forEach((f) => f.classList.toggle('is-on', f === btn));
      carts.forEach((c) => {
        c.hidden = want !== 'all' && c.dataset.status !== want;
      });
      sfx.blip(520, 0.04);
    });
  });
}

function buildContactForm() {
  const form = $('#contact-form');
  if (!form) return;
  const status = $('.form-status', form);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    status.textContent = 'Sending…';
    status.className = 'form-status';
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(String(res.status));
      form.reset();
      status.textContent = 'Sent. I’ll get back to you.';
      status.className = 'form-status ok';
    } catch {
      status.textContent = 'That didn’t send. Email sameedahmed@bastamasta.dev instead?';
      status.className = 'form-status err';
    }
  });
}

/* Highlights the section nav entry for whatever is on screen. Purely additive:
   without JS the nav is still a working list of anchor links. */
function buildSectionNav() {
  const nav = $('#toc');
  if (!nav) return;
  const links = $$('a[href^="#doc-"]', nav);
  const targets = links
    .map((a) => ({ a, el: document.getElementById(a.getAttribute('href').slice(1)) }))
    .filter((t) => t.el);
  if (!targets.length || typeof IntersectionObserver !== 'function') return;

  let current = null;
  const mark = (a) => {
    if (current === a) return;
    if (current) current.removeAttribute('aria-current');
    current = a;
    if (a) a.setAttribute('aria-current', 'true');
  };

  const seen = new Map();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) seen.set(e.target, e);
    // Whichever tracked section is highest on screen while still visible wins.
    let best = null;
    for (const t of targets) {
      const e = seen.get(t.el);
      if (!e || !e.isIntersecting) continue;
      if (!best || e.boundingClientRect.top < best.rect) {
        best = { a: t.a, rect: e.boundingClientRect.top };
      }
    }
    if (best) mark(best.a);
  }, { rootMargin: '-72px 0px -55% 0px', threshold: 0 });

  targets.forEach((t) => io.observe(t.el));
}

/* Close buttons + click-outside, shared by every panel. */
function wirePanels(engine) {
  const scrim = document.createElement('div');
  scrim.id = 'scrim';
  document.body.append(scrim);
  scrim.addEventListener('click', () => engine.closePanel());

  $$('#doc .panel').forEach((section) => {
    // Move the content into an inner scroller; the title bar and close button
    // are siblings of it so they stay pinned to the top of the panel.
    const body = document.createElement('div');
    body.className = 'panel-body';
    while (section.firstChild) body.append(section.firstChild);
    section.append(body);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'panel-close';
    btn.setAttribute('aria-label', 'Close');
    btn.textContent = '×';
    btn.addEventListener('click', () => engine.closePanel());
    section.prepend(btn);
  });
}

/* ============================================================
   Boot
   ============================================================ */

function init() {
  buildBinaryKeeb();
  buildFilters();
  buildContactForm();
  buildSectionNav();

  const consoleEl = $('#console');
  const corner = $('#corner');
  const ripcord = $('#ripcord');
  const muteBtn = $('#mute');
  let engine = null;
  let mode = readMode();

  function apply(next) {
    mode = next;
    writeMode(mode);
    const on = mode === 'console';
    document.body.classList.toggle('console', on);
    document.body.classList.toggle('plain', !on);
    consoleEl.hidden = !on;
    ripcord.setAttribute('aria-pressed', String(!on));
    ripcord.innerHTML = on
      ? '<span aria-hidden="true">▤</span> Read&nbsp;plain&nbsp;version <kbd aria-hidden="true">P</kbd>'
      : '<span aria-hidden="true">▶</span> Launch&nbsp;the&nbsp;console';

    if (engine) engine.active = on;

    if (on) {
      if (!engine) {
        engine = new Zap8();
        engine.onTogglePlain = () => apply(mode === 'console' ? 'plain' : 'console');
        engine.start();
        wirePanels(engine);
      }
      engine.resize();
      engine.closePanel(true);
    } else if (engine) {
      engine.closePanel(true);
    }
  }

  // In plain mode these need to float over the document, so they live outside
  // #console (which gets hidden). They share a flex wrapper so the mute button
  // can never land on top of the ripcord as the ripcord's label changes width.
  document.body.append(corner);

  ripcord.addEventListener('click', () => {
    apply(mode === 'console' ? 'plain' : 'console');
    if (mode === 'plain') scrollTo({ top: 0 });
  });

  muteBtn.addEventListener('click', () => {
    sfx.muted = !sfx.muted;
    muteBtn.setAttribute('aria-pressed', String(sfx.muted));
    if (!sfx.muted) sfx.blip(660, 0.06);
  });

  // Deep links: /#doc-projects opens that panel in console mode.
  if (location.hash) {
    // A hash like "#123" is a legal URL fragment but an illegal selector,
    // and querySelector throws on it.
    let target = null;
    try { target = document.querySelector(location.hash); } catch { /* not a selector */ }
    if (target && target.classList.contains('panel') && mode === 'console') {
      apply('console');
      requestAnimationFrame(() => engine && engine.showPanel(target));
      return;
    }
  }

  apply(mode);
}

if (document.readyState === 'loading') addEventListener('DOMContentLoaded', init);
else init();
