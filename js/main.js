/* ZAP-8 — the machine.

   Owns the render loop, the camera, input, and the bridge between the pixel
   world and the real DOM content. The document in #doc is the single source of
   truth: console mode just lifts a section into an overlay panel, so the plain
   version and the console version can never drift apart. */

import { Framebuffer, SCREEN_W, C, paletteU32, paletteRGB, blitU32, buildShadeMask, applyMask,
         LIGHT_MAP, DARK_MAP } from './gfx.js';
import { drawRoom, ROOM_W, ROOM_H, FLOOR_Y, HOTSPOTS, CAT, CAT_MAP, drawCatTail } from './room.js';
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
const HELP_SEEN = 'zap8:helpSeen';
const MUTE_KEY = 'zap8:muted';

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
  /* Browsers refuse to start an AudioContext before a real user gesture, and
     every attempt logs a warning. The boot chirps fire on a timer, so the
     console filled up with them on every load. Nothing is constructed until
     arm() runs inside a genuine gesture — one guard here covers every caller. */
  armed: false,
  arm() {
    if (this.armed) return;
    this.armed = true;
    this.ensure();          // build it now, while the gesture is still on the stack
  },
  ensure() {
    if (this.broken || !this.armed) return null;
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
    this.helpOpen = false;
    this.openPanel = null;
    this.restoreFocus = null;
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
      /* With a panel, the help card or the shell up, the canvas sits behind a
         blurred scrim and nothing on it can be read. Ten frames a second is
         plenty to keep it alive, and it hands most of a core back to the
         machine for the states a reader spends the most time in. */
      const covered = this.openPanel || this.helpOpen
        || document.body.classList.contains('shell-open');
      if (covered && now - last < 100) {
        requestAnimationFrame(frame);
        return;
      }
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
      <button type="button" class="tp tp-dir" data-dir="1" aria-label="Walk right">&#9654;</button>
      <button type="button" class="tp tp-help" aria-label="How this works">?</button>`;
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
    $('.tp-help', pad)?.addEventListener('click', (e) => { e.preventDefault(); this.showHelp(); });
  }

  syncTouchPad() {
    if (!this.touchPad) return;
    const show = isCoarse() && !this.openPanel && !this.helpOpen;
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

      // The shell is modal over both presentations; init() handles its keys.
      if (document.body.classList.contains('shell-open')) return;

      // Anything with a modifier belongs to the browser, not to us. Without
      // this, Ctrl/Cmd+P was caught by the plain-version shortcut below and
      // preventDefault() swallowed the print dialog entirely — and the same
      // went for Ctrl+R, Cmd+F, Ctrl+A and the rest.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === 'Escape') {
        if (this.helpOpen) { this.hideHelp(); e.preventDefault(); return; }
        if (this.openPanel) { this.closePanel(); e.preventDefault(); }
        else if (this.mode === 'game') { this.exitGame(); e.preventDefault(); }
        return;
      }

      if (e.key === 'p' || e.key === 'P') {
        if (this.openPanel) this.closePanel(true);
        this.onTogglePlain?.();
        e.preventDefault();
        return;
      }

      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        this.helpOpen ? this.hideHelp() : this.showHelp();
        e.preventDefault();
        return;
      }

      // While the help is up it owns the keyboard, or you'd walk around behind it.
      if (this.helpOpen) {
        if (e.key === 'Enter' || e.key === ' ') { this.hideHelp(); e.preventDefault(); }
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
      // The overlay covers the canvas, so this shouldn't fire — but don't let
      // walking depend on z-order alone.
      if (this.helpOpen) return;
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
    this.maybeShowHelp();
    this.updateHint();
    this.syncTouchPad();
    sfx.blip(880, 0.09);
  }

  /* ---------- first-run help ----------
     A first-time visitor has no way to know this is a room you walk around.
     Shown once, then reachable with ? or the HUD, so it never nags. */
  showHelp() {
    const el = $('#help');
    if (!el || this.helpOpen) return;
    this.helpOpen = true;
    el.hidden = false;
    this.helpReturnFocus = document.activeElement;
    $('#help-go')?.focus({ preventScroll: true });
    this.syncTouchPad();
    try { localStorage.setItem(HELP_SEEN, '1'); } catch { /* ignore */ }
  }

  hideHelp() {
    const el = $('#help');
    if (!el || !this.helpOpen) return;
    this.helpOpen = false;
    el.hidden = true;
    const back = this.helpReturnFocus;
    this.helpReturnFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') {
      back.focus({ preventScroll: true });
    }
    this.syncTouchPad();
  }

  maybeShowHelp() {
    let seen = false;
    try { seen = localStorage.getItem(HELP_SEEN) === '1'; } catch { /* ignore */ }
    const forced = new URLSearchParams(location.search).has('help');
    if (!seen || forced) this.showHelp();
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
    this.restoreFocus = document.activeElement;
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
    // Put focus back where it was, so keyboard users do not lose their place.
    const back = this.restoreFocus;
    this.restoreFocus = null;
    if (back && back.isConnected && typeof back.focus === 'function') {
      back.focus({ preventScroll: true });
    }
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
        `<span><b>1</b>&ndash;<b>${HOTSPOTS.length}</b> jump</span>` +
        '<span><b>~</b> shell</span>' +
        '<span><b>?</b> help</span>' +
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
    /* The room is 704px wide and the window onto it is rarely half that, so
       most of the per-object drawing was landing on pixels nobody would see.
       Every primitive honours the clip rect, so this drops the writes without
       touching a single draw routine. The static base layer is re-copied in
       full each frame, so nothing goes stale as the camera moves. */
    this.roomFb.clip(camX - 2, 0, fb.w + 4, ROOM_H);
    drawRoom(this.roomFb, reduceMotion ? 0 : this.t, {
      catAwake: this.catAwake,
      catOnRack: this.catOnRack,
      cartCount: CART_COUNT,
      downloads: DOWNLOADS.n,
    });
    this.player.draw(this.roomFb, this.t);
    this.drawMarkers(this.roomFb);
    this.roomFb.noClip();

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
      const y = (h.ly ?? FLOOR_Y - 62) + bob;
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

/* boxy-cli's install count, from crates.io (which sends CORS headers, so the
   page can ask it directly). Cached for a day: the number moves slowly, the API
   is someone else's server, and a cached value means the wall counter reads
   correctly the moment the room opens instead of sitting on dashes waiting for
   a round trip. A miss leaves it on dashes — claiming zero installs would be a
   worse lie than admitting we don't know. */
const DL_KEY = 'zap8:downloads';
const DL_TTL = 24 * 60 * 60 * 1000;
const DOWNLOADS = { n: null };

function loadDownloads(onValue) {
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(DL_KEY) || 'null'); } catch { /* ignore */ }
  if (cached && Number.isFinite(cached.n)) {
    DOWNLOADS.n = cached.n;
    onValue(cached.n);
    if (Date.now() - cached.at < DL_TTL) return;
  }
  fetch('https://crates.io/api/v1/crates/boxy-cli', { headers: { Accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
    .then((d) => {
      const n = d?.crate?.downloads;
      if (!Number.isFinite(n)) return;
      DOWNLOADS.n = n;
      onValue(n);
      try { localStorage.setItem(DL_KEY, JSON.stringify({ n, at: Date.now() })); } catch { /* ignore */ }
    })
    .catch(() => { /* dashes, or whatever was cached */ });
}

/* Qatar sits at UTC+3 year round and has no DST, so a fixed offset is exact
   and needs no timezone database. */
function dohaNow() {
  const d = new Date();
  return new Date(d.getTime() + (d.getTimezoneOffset() + 180) * 60000);
}

function dohaHM() {
  const d = dohaNow();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
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

/* The shelf, the boot report and the prose all used to carry their own copy of
   this number, and they drifted. The document is the source of truth. */
const CART_COUNT = $$('#doc .cart').length || 15;

/* [wide, narrow, colour] — phones get the abbreviated column. */
const BOOT_LINES = [
  ['ZAP-8 BOOT ROM  V2.0', 'ZAP-8 BOOT V2.0', C.AMBER],
  ['(C) ZAPBURRITO STUDIOS', '(C) ZAPBURRITO', C.VIOLET_LT],
  ['', '', C.VOID],
  ['CPU ....... OK', 'CPU ....... OK', C.GREEN],
  ['VRAM ADAPTIVE .... OK', 'VRAM ...... OK', C.GREEN],
  ['PALETTE 16 ....... OK', 'PALETTE 16  OK', C.GREEN],
  [`CARTRIDGE SLOT ... ${CART_COUNT}`, `CARTS ..... ${CART_COUNT}`, C.GREEN],
  ['HOME LAB LINK .... UP', 'HOMELAB ... UP', C.GREEN],
  ['SLEEP SCHEDULE ... NOT FOUND', 'SLEEP ..... NONE', C.RED],
  ['', '', C.VOID],
  ['LOADING WORKSHOP...', 'LOADING...', C.AMBER_LT],
  ['PRESS P FOR PLAIN TEXT VERSION', 'P = PLAIN TEXT', C.CYAN],
];

/* ============================================================
   DOM widgets that live in both modes
   ============================================================ */

/* The BinaryKeeb, as it actually is: two keys, 0 and 1, tapped eight times to
   spell one ASCII character. The eight-switch layout is kept as an alternative
   because it is a nicer way to explore a byte, but it is not the hardware. */
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  if (tag === 'button') n.type = 'button';
  return n;
};

function buildBinaryKeeb() {
  const host = $('[data-widget="binarykeeb"]');
  if (!host) return;
  host.innerHTML = '';

  const live = el('div', 'keeb-live');

  // ---- layout switch ----
  const modes = el('div', 'keeb-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Keyboard layout');
  const mode2 = el('button', 'keeb-mode', '2-key');
  const mode8 = el('button', 'keeb-mode', '8-key');
  modes.append(mode2, mode8);

  // ---- 2-key: the real layout ----
  const seq = el('div', 'keeb-pane');
  const screen = el('div', 'keeb-screen');
  const typedEl = el('span', 'keeb-typed', '');
  screen.append(typedEl, el('span', 'keeb-caret'));

  const slots = el('div', 'keeb-slots');
  const slotEls = Array.from({ length: 8 }, () => {
    const d = el('span', 'keeb-slot', '·');
    slots.append(d);
    return d;
  });

  const bigkeys = el('div', 'keeb-bigkeys');
  const key0 = el('button', 'keeb-bigkey', '0');
  const key1 = el('button', 'keeb-bigkey', '1');
  bigkeys.append(key0, key1);

  const aux = el('div', 'keeb-aux');
  const back = el('button', 'keeb-aux-btn', '\u232B');
  back.setAttribute('aria-label', 'Delete the last bit');
  const clear = el('button', 'keeb-aux-btn', 'Clear');
  const hint = el('span', 'keeb-hint');
  aux.append(back, clear, hint);
  seq.append(screen, slots, bigkeys, aux);

  let bits = [];
  let typed = '';
  let last = null;

  function renderSeq() {
    slotEls.forEach((sl, i) => {
      sl.textContent = i < bits.length ? String(bits[i]) : '·';
      sl.classList.toggle('is-set', i < bits.length);
      sl.classList.toggle('is-next', i === bits.length);
    });
    typedEl.textContent = typed;
    if (bits.length) {
      hint.textContent = `${8 - bits.length} more bit${bits.length === 7 ? '' : 's'}`;
    } else if (last) {
      hint.textContent = `${last.binary} = ${last.byte} = 0x${last.hex}`
        + (last.printable ? '' : ' (unprintable)');
    } else {
      hint.textContent = 'eight bits, most significant first';
    }
  }

  function pushBit(b) {
    if (bits.length >= 8) return;
    bits.push(b);
    sfx.blip(b ? 720 : 420, 0.04);
    if (bits.length === 8) {
      const binary = bits.join('');
      const byte = bits.reduce((a, x) => (a << 1) | x, 0);
      const printable = byte >= 32 && byte < 127;
      typed += printable ? String.fromCharCode(byte) : '\u25A1';
      last = { binary, byte, printable, hex: byte.toString(16).toUpperCase().padStart(2, '0') };
      bits = [];
      sfx.blip(980, 0.07);
    } else {
      last = null;
    }
    renderSeq();
  }

  key0.addEventListener('click', () => pushBit(0));
  key1.addEventListener('click', () => pushBit(1));
  back.addEventListener('click', () => {
    if (bits.length) bits.pop();
    else typed = typed.slice(0, -1);
    last = null;
    sfx.blip(300, 0.04);
    renderSeq();
  });
  clear.addEventListener('click', () => {
    bits = []; typed = ''; last = null;
    sfx.blip(240, 0.06);
    renderSeq();
  });
  // Typing 0/1 works too, once focus is inside the widget.
  seq.addEventListener('keydown', (e) => {
    if (e.key === '0' || e.key === '1') { pushBit(Number(e.key)); e.preventDefault(); }
    else if (e.key === 'Backspace') { back.click(); e.preventDefault(); }
  });

  // ---- 8-key: the alternative ----
  const sw = el('div', 'keeb-pane');
  const swKeys = el('div', 'keeb-keys');
  const swOut = el('div', 'keeb-readout');
  const swChar = el('span', 'keeb-char');
  const swNum = el('span', 'keeb-num');
  swOut.append(swChar, swNum);
  const swBits = new Array(8).fill(0);

  function renderSw() {
    const byte = swBits.reduce((acc, b) => (acc << 1) | b, 0);
    const printable = byte >= 32 && byte < 127;
    swChar.textContent = printable ? String.fromCharCode(byte) : '·';
    swChar.style.color = printable ? '' : 'var(--violet-lt)';
    swNum.textContent = `${swBits.join('')}  =  ${byte}  =  0x${byte.toString(16).toUpperCase().padStart(2, '0')}`
      + (printable ? '' : '  (unprintable)');
  }

  swBits.forEach((_, i) => {
    const b = el('button', 'keeb-key', '0');
    b.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-label', `Bit ${7 - i}, value ${1 << (7 - i)}`);
    b.addEventListener('click', () => {
      swBits[i] ^= 1;
      b.textContent = String(swBits[i]);
      b.setAttribute('aria-pressed', String(!!swBits[i]));
      sfx.blip(swBits[i] ? 720 : 360, 0.04);
      renderSw();
    });
    swKeys.append(b);
  });
  sw.append(swKeys, swOut);

  // ---- wire the switch ----
  function setMode(m) {
    const two = m !== '8';
    seq.hidden = !two;
    sw.hidden = two;
    mode2.setAttribute('aria-pressed', String(two));
    mode8.setAttribute('aria-pressed', String(!two));
    try { localStorage.setItem('zap8:keeb', two ? '2' : '8'); } catch { /* ignore */ }
  }
  mode2.addEventListener('click', () => { setMode('2'); sfx.blip(560, 0.04); });
  mode8.addEventListener('click', () => { setMode('8'); sfx.blip(460, 0.04); });

  live.append(modes, seq, sw);
  host.append(live);

  let saved = '2';
  try { saved = localStorage.getItem('zap8:keeb') || '2'; } catch { /* ignore */ }
  setMode(saved);
  renderSeq();
  renderSw();
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
      const action = form.getAttribute('action') || form.action;
      const res = await fetch(action, {
        method: 'POST',
        body: new FormData(form),
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) throw new Error(String(res.status));
      // Report the send before clearing the form. The other order means
      // anything reset() throws is caught below and tells someone their
      // message failed when it actually went — costing them a duplicate
      // send, or the contact entirely.
      status.textContent = 'Sent. I’ll get back to you.';
      status.className = 'form-status ok';
      try { form.reset(); } catch { /* the message is already away */ }
    } catch {
      status.textContent = 'That didn’t send. Email sameedahmed@bastamasta.dev instead?';
      status.className = 'form-status err';
    }
  });
}

/* ---------- the terminal ----------
   The desk hotspot has been called TERMINAL since day one and has only ever
   opened a panel. This is that panel doing what its label promises. Every
   answer is read out of the document at the moment it is asked — the section
   list off the nav, the project list off the shelf, the install count off the
   wall counter — so nothing in here can drift from the page around it.
   Output is built as text nodes, never as markup: `echo <img onerror=...>`
   should print that string, not run it. */
function buildTerminal(getEngine) {
  const host = $('[data-widget="terminal"]');
  if (!host) return;
  host.innerHTML = '';

  const out = el('div', 'term-out');
  out.setAttribute('role', 'log');
  out.setAttribute('aria-live', 'polite');

  const form = document.createElement('form');
  form.className = 'term-line';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'term-in';
  input.autocomplete = 'off';
  input.autocapitalize = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', 'Type a command');
  form.append(el('span', 'term-ps1', PS1), input);
  host.append(out, form);

  const SCROLLBACK = 400;
  const push = (node) => {
    out.append(node);
    while (out.childElementCount > SCROLLBACK) out.firstElementChild.remove();
    out.scrollTop = out.scrollHeight;
  };
  const print = (text = '', cls = '') => {
    const row = el('div', `term-row ${cls}`.trim(), text);
    push(row);
    return row;
  };
  const printBlock = (text) => {
    const pre = document.createElement('pre');
    pre.className = 'term-pre';
    pre.textContent = text;
    push(pre);
  };
  const printLink = (label, href, download) => {
    const row = print();
    const a = document.createElement('a');
    a.href = href;
    a.textContent = label;
    if (download) a.setAttribute('download', '');
    else if (/^https?:/.test(href)) a.rel = 'noopener';
    row.append(a);
  };

  /* Sections come from the nav, so a section added to the page is a section
     this can already reach. Oreo is deliberately not in the nav — `ls -a`. */
  const sections = $$('#toc a[href^="#doc-"]').map((a) => {
    const id = a.getAttribute('href').slice(1);
    return { id, name: id.replace(/^doc-/, ''), label: a.textContent.replace(/^\s*\d+\s*/, '').trim() };
  });
  if ($('#doc-cat')) sections.push({ id: 'doc-cat', name: 'oreo', label: 'Oreo', hidden: true });

  const text = (sel) => ($(sel)?.textContent || '').replace(/\s+/g, ' ').trim();

  function go(name) {
    if (!name) return print('open what? try `ls`', 'term-err');
    const key = name.toLowerCase();
    const sec = sections.find((x) =>
      x.name === key || x.id === key || x.label.toLowerCase().split(' ')[0] === key);
    if (!sec) return print(`no such section: ${name}`, 'term-err');
    const node = document.getElementById(sec.id);
    const engine = getEngine();

    if (document.body.classList.contains('console') && engine) {
      print(`opening ${sec.label}…`, 'term-dim');
      engine.closePanel(true);
      engine.showPanel(node);
      return;
    }
    /* Not every section has a box to scroll to: Oreo is a console easter egg
       and the plain stylesheet hides him. Scrolling to a display:none element
       does nothing at all, so the shell used to announce it was opening
       something and then quietly do nothing. Read it out instead. */
    if (!node.offsetParent && getComputedStyle(node).position !== 'fixed') {
      print(`${sec.label} isn't on the plain page — here it is:`, 'term-dim');
      for (const para of node.querySelectorAll('p')) {
        const line = para.textContent.replace(/\s+/g, ' ').trim();
        if (line && !para.hidden) print(line);
      }
      return;
    }
    print(`opening ${sec.label}…`, 'term-dim');
    node.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  const COMMANDS = {
    help() {
      print('available:', 'term-dim');
      printBlock(
        'help              this\n' +
        'ls [-a]           list the sections\n' +
        'cat resume        same thing\n' +
        'open <section>    go to one (cd works too)\n' +
        'whoami            the short version\n' +
        'projects [status] live | wip | done | dead\n' +
        'crates            boxy-cli install count\n' +
        'resume            the résumé page\n' +
        'contact           how to reach me\n' +
        'neofetch          the obligatory\n' +
        'date              what time it is here\n' +
        'uptime            how the server is holding up\n' +
        'echo <text>       what it says on the tin\n' +
        'clear             wipe the scrollback');
    },
    ls(args) {
      const all = args.includes('-a');
      for (const sec of sections) {
        if (sec.hidden && !all) continue;
        print(`${sec.name.padEnd(10)} ${sec.label}`, sec.hidden ? 'term-dim' : '');
      }
    },
    open: (args) => go(args[0]),
    cd: (args) => go(args[0]),
    cat(args) {
      const f = (args[0] || '').replace(/^\.?\//, '');
      if (/^resume/.test(f)) return COMMANDS.resume();
      if (!f) return oreo();
      print(`cat: ${f}: No such file or directory`, 'term-err');
    },
    whoami() {
      print(text('#doc-about p') || 'Sameed Ahmed. Systems programmer, Doha.');
    },
    projects(args) {
      const want = args[0];
      const valid = ['live', 'wip', 'done', 'dead'];
      if (want && !valid.includes(want)) return print(`status must be one of: ${valid.join(', ')}`, 'term-err');
      const carts = $$('#doc .cart').filter((c) => !want || c.dataset.status === want);
      if (!carts.length) return print('nothing matches', 'term-dim');
      for (const c of carts) {
        print(`[${(c.dataset.status || '?').padEnd(4)}] ${c.querySelector('h3')?.textContent || ''}`);
      }
      print(`${carts.length} of ${CART_COUNT}`, 'term-dim');
    },
    crates() {
      print(Number.isFinite(DOWNLOADS.n)
        ? `boxy-cli: ${DOWNLOADS.n.toLocaleString()} downloads on crates.io`
        : 'boxy-cli: still asking crates.io');
      printLink('crates.io/crates/boxy-cli', 'https://crates.io/crates/boxy-cli');
    },
    resume() {
      printLink('bastamasta.dev/resume', '/resume/');
      printLink('…or the PDF directly', '/docs/Sameed Ahmed - Resume.pdf');
    },
    contact() {
      for (const li of $$('#doc-contact .contact-list li')) {
        const k = li.querySelector('.lbl')?.textContent || '';
        const v = li.querySelector('.val')?.textContent || '';
        if (k) print(`${k.padEnd(10)} ${v.trim()}`);
      }
      print('or `open contact` for the form', 'term-dim');
    },
    date() {
      const d = dohaNow();
      print(`${d.toDateString()} ${dohaHM()} +03 (Doha)`);
    },
    uptime() {
      print(` ${dohaHM()} up 412 days,  1 user,  load average: 0.42, 0.31, 0.09`);
      print('sleep schedule: still not found', 'term-dim');
    },
    neofetch() {
      printBlock(NEOFETCH.replace('%DL%', Number.isFinite(DOWNLOADS.n) ? String(DOWNLOADS.n) : '—'));
    },
    echo: (args) => print(args.join(' ')),
    clear() { out.replaceChildren(); },
    sudo(args) {
      print(args.length ? 'sameed is not in the sudoers file.' : 'usage: sudo <command>', 'term-err');
      print('This incident will be reported.', 'term-dim');
    },
    exit() {
      const engine = getEngine();
      if (document.body.classList.contains('console') && engine) engine.closePanel();
      else print('there is no exit, only P', 'term-dim');
    },
  };

  /* `cat` with no file. A real shell would sit there reading stdin; this one
     returns the cat. He walks in from the left, sits down halfway to consider
     you, and carries on out the other side. */
  function oreo() {
    print('oreo');
    print('ragdoll · goes completely boneless when picked up · one production incident', 'term-dim');
    sfx.blip(520, 0.12, 'sine', 0.05);

    const cv = oreoSprite();
    // The run has to be measured, not guessed: a transform percentage is a
    // percentage of the element, and the element is a very small cat.
    cv.style.setProperty('--oreo-run', `${host.clientWidth + 120}px`);
    if (reduceMotion) cv.classList.add('is-still');
    cv.addEventListener('animationend', () => cv.remove());
    host.append(cv);
  }

  const history = [];
  let hIndex = 0;

  function run(line) {
    print(`${PS1} ${line}`, 'term-echo');
    const [name, ...args] = line.trim().split(/\s+/);
    if (!name) return;
    const cmd = COMMANDS[name.toLowerCase()];
    if (!cmd) return print(`${name}: command not found — try \`help\``, 'term-err');
    try { cmd(args); } catch { print('that broke. sorry.', 'term-err'); }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const line = input.value;
    input.value = '';
    if (line.trim()) { history.push(line); sfx.blip(660, 0.03, 'square', 0.03); }
    hIndex = history.length;
    run(line);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      if (!history.length) return;
      hIndex = Math.max(0, Math.min(history.length, hIndex + (e.key === 'ArrowUp' ? -1 : 1)));
      input.value = history[hIndex] ?? '';
      e.preventDefault();
    } else if (e.key === 'Tab') {
      // Complete the command word only; arguments are few enough to type.
      e.preventDefault();
      const head = input.value.trimStart();
      if (head.includes(' ')) return;
      const hits = Object.keys(COMMANDS).filter((c) => c.startsWith(head.toLowerCase()));
      if (hits.length === 1) input.value = `${hits[0]} `;
      else if (hits.length > 1) print(hits.join('  '), 'term-dim');
    }
  });

  // Clicking anywhere in the scrollback focuses the prompt, the way a real one
  // behaves. Never on load, though — that would yank the page around.
  (host.closest('.shell-panel') || out).addEventListener('click', (e) => {
    if (e.target.closest('a, button')) return;
    if (!getSelection()?.toString()) input.focus({ preventScroll: true });
  });

  print('ZAP-8 shell — type `help`, or `ls` to look around.', 'term-dim');
}

/* Drawn with the room's own sprite and the room's own tail routine, so there is
   exactly one Oreo and he can't end up a different cat in two places. The tail
   is not part of CAT — the room draws it procedurally so it can move — which is
   why it has to be redrawn per frame here too rather than baked once.

   Sprite offsets match drawCat(): body at the origin, tail base nine across and
   nine down. Palette index 0 is VOID and nothing in CAT_MAP maps to it, so an
   untouched pixel stays transparent, which is what lets him pad over the
   scrollback instead of dragging a rectangle of background behind him. */
const OREO_W = 18, OREO_H = 22;   // body plus the room the tail swings through

function oreoSprite() {
  const fb = new Framebuffer(OREO_W, OREO_H);
  const rgb = paletteRGB();
  const cv = document.createElement('canvas');
  cv.width = OREO_W;
  cv.height = OREO_H;
  cv.className = 'oreo';
  cv.setAttribute('aria-hidden', 'true');
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(OREO_W, OREO_H);
  const t0 = performance.now();

  const frame = (now) => {
    const elapsed = (now - t0) / 1000;
    // Hard stop rather than relying on animationend alone: closing the shell
    // mid-walk hides the element, and a hidden element never fires it.
    if (elapsed > 7 || !cv.isConnected) { cv.remove(); return; }
    const t = reduceMotion ? 0 : elapsed;

    fb.clear(C.VOID);
    const bob = Math.round(Math.sin(t * 1.1) * 0.5);
    fb.sprite(0, bob, CAT, CAT_MAP);
    drawCatTail(fb, 9, 9 + bob, t);

    for (let i = 0; i < fb.px.length; i++) {
      const c = fb.px[i], o = i * 4;
      if (!c) { img.data[o + 3] = 0; continue; }
      const [r, g, b] = rgb[c];
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return cv;
}

const PS1 = 'sameed@zap-8:~$';

const NEOFETCH =
  '   ▄▄▄▄▄▄▄     sameed@zap-8\n' +
  ' ▄█████████▄   ─────────────────────────────\n' +
  ' ██ ▀███▀ ██   os      Debian, in my house\n' +
  ' ██  ███  ██   lang    Rust · C · some 8086\n' +
  ' ▀█████████▀   board   KiCad → fab → regret\n' +
  '   ▀▀▀▀▀▀▀     shipped %DL% boxy-cli installs\n' +
  '               uptime  no sleep schedule found\n' +
  '               cat     Oreo · 1 prod incident';

/* Copying an address off a phone screen by hand is miserable, and the people
   most likely to be doing it are the ones I want to hear from. Hidden outright
   where the clipboard API isn't available, rather than offering a dead button. */
function buildCopyButtons() {
  if (!navigator.clipboard) return;          // the buttons ship hidden
  for (const btn of $$('.copy[data-copy]')) {
    btn.hidden = false;
    const label = btn.textContent;
    let revert = 0;
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copy);
        btn.textContent = 'Copied';
        btn.classList.add('is-ok');
        sfx.blip(880, 0.05);
      } catch {
        btn.textContent = 'Copy failed';
      }
      clearTimeout(revert);
      revert = setTimeout(() => {
        btn.textContent = label;
        btn.classList.remove('is-ok');
      }, 1400);
    });
  }
}

/* The plain-mode twin of the reading on the marquee board. */
function buildLocalClock() {
  const el = $('#doha-clock');
  if (!el) return;
  const tick = () => { el.textContent = `${dohaHM()} in Doha (UTC+3)`; };
  tick();
  setInterval(tick, 20000);
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

  const strip = $('ol', nav);
  let current = null;
  const mark = (a) => {
    if (current === a) return;
    if (current) current.removeAttribute('aria-current');
    current = a;
    if (!a) return;
    a.setAttribute('aria-current', 'true');
    /* On a phone the strip is a horizontal scroller and only two or three of
       the seven fit. Without this the highlight marking your position is
       usually scrolled off the edge, which is worse than no highlight at all. */
    if (strip && strip.scrollWidth > strip.clientWidth + 4) {
      a.scrollIntoView({ inline: 'center', block: 'nearest',
                         behavior: reduceMotion ? 'auto' : 'smooth' });
    }
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
  // The help card carries both input variants; mark which one applies.
  document.body.classList.toggle('input-coarse', isCoarse());
  document.body.classList.toggle('input-fine', !isCoarse());

  buildBinaryKeeb();
  buildFilters();
  buildContactForm();
  buildCopyButtons();
  buildLocalClock();
  buildSectionNav();

  // Capture phase, so the context exists before any widget's own click handler
  // tries to make a noise with it.
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) {
    addEventListener(ev, () => sfx.arm(), { once: true, capture: true, passive: true });
  }

  const consoleEl = $('#console');
  const corner = $('#corner');
  const ripcord = $('#ripcord');
  const muteBtn = $('#mute');
  let engine = null;

  // Declared above so the terminal's `open` can reach the engine once it exists.
  buildTerminal(() => engine);

  /* The shell drops from the top over whichever view is showing. `~` is the
     conventional key for this and is free in both modes; the >_ button is the
     way in on anything without one. */
  const shell = $('#shell');
  const shellBtn = $('#shell-toggle');
  let shellReturn = null;

  function setShell(on) {
    if (!shell || shell.hidden === !on) return;
    shell.hidden = !on;
    document.body.classList.toggle('shell-open', on);
    shellBtn?.setAttribute('aria-pressed', String(on));
    if (on) {
      shellReturn = document.activeElement;
      $('.term-in', shell)?.focus({ preventScroll: true });
      sfx.blip(520, 0.05);
    } else {
      if (shellReturn?.isConnected) shellReturn.focus({ preventScroll: true });
      shellReturn = null;
      sfx.blip(360, 0.05);
    }
  }

  shellBtn?.addEventListener('click', () => setShell(shell.hidden));
  $('.shell-close', shell)?.addEventListener('click', () => setShell(false));
  // Clicking the backdrop, but not the panel itself.
  shell?.addEventListener('click', (e) => { if (e.target === shell) setShell(false); });

  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || !shell) return;
    // Escape closes it even from inside the prompt, which is where you are.
    if (e.key === 'Escape' && !shell.hidden) { setShell(false); e.preventDefault(); return; }
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (e.key === '~' || e.key === '`') { setShell(shell.hidden); e.preventDefault(); }
  });

  // The wall counter reads DOWNLOADS every frame; the plain view gets a tag.
  loadDownloads((n) => {
    const tag = $('#dl-count');
    if (!tag) return;
    tag.textContent = `${n.toLocaleString()} downloads`;
    tag.hidden = false;
  });
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

  $('#help-go')?.addEventListener('click', () => engine && engine.hideHelp());
  $('#help-plain')?.addEventListener('click', () => {
    if (engine) engine.hideHelp();
    apply('plain');
    scrollTo({ top: 0 });
  });
  $('#help')?.addEventListener('click', (e) => {
    // Clicking the backdrop dismisses it; clicking the card does not.
    if (e.target.id === 'help' && engine) engine.hideHelp();
  });

  ripcord.addEventListener('click', () => {
    apply(mode === 'console' ? 'plain' : 'console');
    if (mode === 'plain') scrollTo({ top: 0 });
  });

  try { sfx.muted = localStorage.getItem(MUTE_KEY) === '1'; } catch { /* ignore */ }
  muteBtn.setAttribute('aria-pressed', String(sfx.muted));
  muteBtn.addEventListener('click', () => {
    sfx.muted = !sfx.muted;
    muteBtn.setAttribute('aria-pressed', String(sfx.muted));
    try { localStorage.setItem(MUTE_KEY, sfx.muted ? '1' : '0'); } catch { /* ignore */ }
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
