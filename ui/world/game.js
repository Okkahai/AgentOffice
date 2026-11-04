// World renderer + actors. Own animation loop; the DOM overlay talks to it through explicit calls and callbacks.
// Movement and animation are projections of reducer state (ui/office-state.js); nothing here is authoritative.
import { WORLD, DESKS, DECOR, ENTRANCE, WANDER } from './world.js';
import { buildGrid, findPath } from './nav.js';
import { fitZoom, clampCam, origin, zoomAt } from './camera.js';

const SPEED = 40;                 // native px per second (art bible)
const FRAME = { w: 16, h: 32, ax: 8, ay: 31 };                 // LimeZu character cell, feet anchor
const CHARS = ['Alex', 'Adam', 'Amelia', 'Bob'];
const DIR = { right: 0, up: 6, left: 12, down: 18 };            // first of 6 frames per direction in the idle (row 1) and run (row 2) strips
const ART = '/assets/limezu';
const FLOOR = [176, 128, 16, 16], WALL = [1, 86, 16, 25];       // Room_Builder_Office_16x16.png
const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(src)); i.src = src; });

export class Game {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hooks = hooks;
    this.cam = { x: WORLD.w / 2, y: WORLD.h / 2 }; this.camTarget = null; this.z = 2; this.k = 2; this.vw = 0; this.vh = 0;
    this.scene = null; this.actors = new Map(); this.selected = null; this.hover = null; this.keys = new Set();
    this.grid = buildGrid(); this.last = 0; this.ready = false;
  }
  async load() {
    const [office, rooms, ...sheets] = await Promise.all([
      load(`${ART}/office/Modern_Office_16x16.png`), load(`${ART}/office/Room_Builder_Office_16x16.png`),
      ...CHARS.map((n) => load(`${ART}/chars/${n}_16x16.png`)),
    ]);
    this.office = office; this.rooms = rooms; this.sheets = sheets; this.ready = true;
    this.resize(); this.fit();
    addEventListener('resize', () => this.resize());
    this.bindInput();
    const loop = (t) => { this.frame(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop);
  }
  sync(scene) { this.scene = scene; }

  // ---- camera ----
  resize() {
    const dpr = devicePixelRatio || 1, r = this.canvas.getBoundingClientRect();
    this.vw = r.width; this.vh = r.height; this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
  }
  setZoom(z) { this.z = Math.min(5, Math.max(1, z)); this.k = Math.max(1, Math.round(this.z * this.dpr)); }
  fit() { this.setZoom(fitZoom(this.vw, this.vh, WORLD)); this.cam = { x: WORLD.w / 2, y: WORLD.h / 2 }; this.camTarget = null; }
  focus(id) { const a = this.actors.get(id); if (a) { this.camTarget = { x: a.x, y: a.y - 10 }; if (this.z < 3) this.setZoom(3); } }
  select(id) { this.selected = id; }

  // ---- input ----
  bindInput() {
    const c = this.canvas; let drag = null;
    const pos = (e) => { const r = c.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    c.addEventListener('pointerdown', (e) => { c.setPointerCapture(e.pointerId); drag = { ...pos(e), sx: e.clientX, sy: e.clientY, moved: false, button: e.button }; });
    c.addEventListener('pointermove', (e) => {
      const p = pos(e);
      if (drag) {
        const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
        if (drag.moved || Math.hypot(dx, dy) > 4) { drag.moved = true; const s = this.k / this.dpr; this.cam.x -= (p.x - drag.x) / s; this.cam.y -= (p.y - drag.y) / s; this.camTarget = null; drag.x = p.x; drag.y = p.y; c.style.cursor = 'grabbing'; }
      } else { this.hover = this.hit(p); c.style.cursor = this.hover ? 'pointer' : 'grab'; }
    });
    c.addEventListener('pointerup', (e) => {
      const was = drag; drag = null; c.style.cursor = 'grab';
      if (!was || was.moved) return;
      const h = this.hit(pos(e)); this.hooks.onClick?.(h, e.detail >= 2);
    });
    c.addEventListener('wheel', (e) => {
      e.preventDefault(); const p = pos(e), nz = Math.min(5, Math.max(1, this.z + (e.deltaY < 0 ? 1 : -1)));
      if (nz !== this.z) { zoomAt(this.cam, this.z, nz, p.x, p.y, this.vw, this.vh); this.setZoom(nz); this.camTarget = null; }
    }, { passive: false });
    addEventListener('keydown', (e) => {
      if (e.target.closest?.('input,textarea,.xterm')) return;
      const k = e.key.toLowerCase();
      if (k === 'f') this.fit(); else if (k === '+' || k === '=') this.setZoom(this.z + 1); else if (k === '-') this.setZoom(this.z - 1);
      else if ('wasd'.includes(k) || k.startsWith('arrow')) { this.keys.add(k); e.preventDefault(); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
  }
  worldPoint(p) { const s = this.k / this.dpr; return { x: this.cam.x + (p.x - this.vw / 2) / s, y: this.cam.y + (p.y - this.vh / 2) / s }; }
  hit(p) {
    const w = this.worldPoint(p);
    const inR = (r) => w.x >= r.x && w.x < r.x + r.w && w.y >= r.y && w.y < r.y + r.h;
    for (const a of [...this.actors.values()].sort((x, y) => y.y - x.y)) if (inR({ x: a.x - 8, y: a.y - 24, w: 16, h: 26 })) return { kind: 'agent', id: a.id };
    for (const d of DESKS) { if (inR(d)) { const who = [...this.actors.values()].find((a) => a.desk === d.id && a.atSeat); return { kind: inR(d.monitor) ? 'monitor' : 'desk', desk: d.id, id: who?.id ?? null }; } }
    if (inR(DECOR.rack)) return { kind: 'rack' };
    return null;
  }

  // ---- simulation ----
  engineers() { return Object.values(this.scene?.agents ?? {}).filter((a) => a.role === 'ENGINEER').sort((x, y) => (x.taskId ?? 0) - (y.taskId ?? 0)); }
  update(dt, now) {
    if (!this.scene) return;
    const eng = this.engineers(), live = new Set(eng.map((a) => a.id));
    for (const id of this.actors.keys()) if (!live.has(id)) this.actors.delete(id);
    eng.forEach((a, i) => {
      let m = this.actors.get(a.id);
      const deskIdx = i < DESKS.length ? i : null, seat = deskIdx != null ? DESKS[deskIdx].seat : null;
      if (!m) {
        const stale = a.assignedAt && now - Date.parse(a.assignedAt) > 8000;   // replayed history: already at the desk
        const start = stale && seat ? seat : ENTRANCE;
        m = { id: a.id, x: start.x, y: start.y, path: [], desk: deskIdx, atSeat: !!(stale && seat), wait: 0, facing: 'down', anim: 'idle', animT: now, celebrated: !!a.done, until: 0, variant: ((a.taskId ?? i + 1) - 1) % CHARS.length };
        this.actors.set(a.id, m);
      }
      if (m.desk !== deskIdx) { m.desk = deskIdx; m.atSeat = false; m.path = []; m.dest = null; }
      const wantsDesk = seat && a.taskId != null && !a.done && a.state !== 'failed';
      if (a.done && !m.celebrated) { m.celebrated = true; m.until = now + 1800; m.path = []; m.dest = null; m.atSeat = false; }
      if (!a.done && m.celebrated && a.taskId != null) { m.celebrated = false; }
      if (wantsDesk) {
        if (m.dest !== 'desk') { m.dest = 'desk'; m.atSeat = false; m.path = findPath(this.grid, m, seat) ?? [{ ...seat }]; }
      } else if (a.state === 'failed') { m.path = []; m.dest = null; }
      else if (now >= m.until && !m.path.length && now >= m.wait && (m.dest !== 'wander' || true)) {
        // cosmetic idle stroll only; never implies work
        const tx = WANDER.x0 + Math.random() * (WANDER.x1 - WANDER.x0), ty = WANDER.y0 + Math.random() * (WANDER.y1 - WANDER.y0);
        const p = findPath(this.grid, m, { x: tx, y: ty }); m.dest = 'wander'; m.path = p ?? []; m.wait = now + 2500 + Math.random() * 4500; m.atSeat = false;
      }
      // move
      let moving = false;
      if (m.path.length) {
        const t = m.path[0], dx = t.x - m.x, dy = t.y - m.y, d = Math.hypot(dx, dy), step = SPEED * dt;
        if (d <= step) { m.x = t.x; m.y = t.y; m.path.shift(); } else { m.x += dx / d * step; m.y += dy / d * step; }
        moving = true;
        const ax = Math.abs(dx), ay = Math.abs(dy), horiz = m.facing === 'left' || m.facing === 'right';   // hysteresis so diagonal steps do not flicker
        if (ax > ay * 1.5 || (horiz && ax > ay / 1.5)) m.facing = dx < 0 ? 'left' : 'right'; else m.facing = dy < 0 ? 'up' : 'down';
      }
      if (!m.path.length && m.dest === 'desk' && seat) { m.x = seat.x; m.y = seat.y; m.atSeat = true; m.facing = 'up'; }
      const anim = a.state === 'failed' ? 'failure' : now < m.until ? 'success' : moving ? 'walk' : m.atSeat && a.state === 'coding' ? 'type' : 'idle';
      if (anim !== m.anim) { m.anim = anim; m.animT = now; }
      m.state = a.state;
    });
    // camera
    const speed = 220 / this.z;
    if (this.keys.size) {
      const k = this.keys; this.camTarget = null;
      this.cam.x += ((k.has('d') || k.has('arrowright')) - (k.has('a') || k.has('arrowleft'))) * speed * dt;
      this.cam.y += ((k.has('s') || k.has('arrowdown')) - (k.has('w') || k.has('arrowup'))) * speed * dt;
    }
    if (this.camTarget) { const f = Math.min(1, dt * 6); this.cam.x += (this.camTarget.x - this.cam.x) * f; this.cam.y += (this.camTarget.y - this.cam.y) * f; }
    clampCam(this.cam, WORLD, this.vw, this.vh, this.z);
  }

  // ---- drawing ----
  frame(t) {
    if (!this.ready) return;
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0); this.last = t;
    const now = Date.now(); this.update(dt, now); this.draw(now);
  }
  draw(now) {
    const g = this.ctx, k = this.k, { ox, oy } = origin(this.cam, this.canvas.width, this.canvas.height, k);
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = false; g.fillStyle = '#0a0807'; g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    g.setTransform(k, 0, 0, k, ox, oy);
    const spr = (img, r, x, y) => g.drawImage(img, r[0], r[1], r[2], r[3], x, y, r[2], r[3]);
    for (let y = WORLD.wallH; y < WORLD.h; y += 16) for (let x = 0; x < WORLD.w; x += 16) spr(this.rooms, FLOOR, x, y);
    for (let x = 0; x < WORLD.w; x += 16) { spr(this.rooms, WALL, x, WORLD.wallH - 50); spr(this.rooms, WALL, x, WORLD.wallH - 25); }
    for (const k of ['board', 'poster', 'pin', 'photo', 'shelf', 'rack']) spr(this.office, DECOR[k].s, DECOR[k].x, DECOR[k].y);
    // depth-sorted things
    const items = [], seated = new Map([...this.actors.values()].filter((a) => a.atSeat).map((a) => [a.desk, a]));
    for (const d of DESKS) items.push({ base: d.base, draw: () => this.drawDesk(d, seated.get(d.id), now) });
    for (const k of ['plant', 'plant2', 'cooler', 'sofa']) items.push({ base: DECOR[k].base, draw: () => spr(this.office, DECOR[k].s, DECOR[k].x, DECOR[k].y) });
    for (const a of this.actors.values()) items.push({ base: a.y, draw: () => this.drawActor(a, now) });
    items.sort((p, q) => p.base - q.base).forEach((it) => it.draw());
    // overlays in device pixels: bubbles + labels
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (const a of this.actors.values()) this.drawBubble(a, now, ox, oy);
  }
  drawDesk(d, who, now) {
    const g = this.ctx, o = this.office, [dx, dy, dw, dh] = d.desk, [kx, ky, kw, kh] = d.kit;
    g.drawImage(o, dx, dy, dw, dh, d.x, d.y, dw, dh); g.drawImage(o, kx, ky, kw, kh, d.x + 2, d.y - 3, kw, kh);
    if (!(who && who.state === 'coding' && who.anim === 'type')) return;
    const m = d.monitor, step = Math.floor(now / 220);       // scrolling green "code" lines on the screen, only while really typing
    g.fillStyle = '#0d1f10'; g.fillRect(m.x, m.y, m.w, m.h); g.fillStyle = '#7ddc7a';
    for (let r = 0; r < m.h; r += 2) g.fillRect(m.x + 1, m.y + r, 2 + ((step * 7 + r * 5 + d.id) % (m.w - 3)), 1);
  }
  drawActor(a, now) {
    const g = this.ctx, t = (now - a.animT) / 1000, sheet = this.sheets[a.variant], dir = DIR[a.facing] ?? DIR.down;
    const row = a.anim === 'walk' ? 2 : 1, fps = a.anim === 'walk' ? 9 : a.anim === 'type' ? 7 : 4, f = dir + Math.floor(t * fps) % 6;
    let x = Math.round(a.x) - FRAME.ax, y = Math.round(a.y) - FRAME.ay;
    if (a.anim === 'success') y -= Math.round(Math.abs(Math.sin(t * 9)) * 4);                 // hop
    else if (a.anim === 'failure') x += Math.floor(t * 16) % 2 ? 1 : -1;                      // shiver
    const cx = Math.round(a.x), cy = Math.round(a.y);
    g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(cx - 5, cy - 1, 10, 2);
    if (a.id === this.selected) { g.fillStyle = '#f2b451'; for (let i = -9; i <= 9; i++) { const j = Math.round(Math.sqrt(1 - (i / 9) ** 2) * 3); g.fillRect(cx + i, cy + j, 1, 1); g.fillRect(cx + i, cy - j, 1, 1); } }
    g.drawImage(sheet, f * FRAME.w, row * FRAME.h, FRAME.w, FRAME.h, x, y, FRAME.w, FRAME.h);
  }
  drawBubble(a, now, ox, oy) {
    const b = this.scene.bubbles[a.id]; if (!b || now - Date.parse(b.ts) > 6000) return;
    const g = this.ctx, k = this.k, txt = b.text.length > 26 ? b.text.slice(0, 25) + '…' : b.text;
    g.font = `bold ${6 * k}px monospace`; const w = g.measureText(txt).width + 6 * k, h = 10 * k;
    const x = Math.round(ox + (a.x - w / k / 2) * k), y = Math.round(oy + (a.y - 30) * k);
    g.fillStyle = '#d9ccb0'; g.fillRect(x, y - h, Math.round(w), h); g.fillStyle = '#d9ccb0'; g.fillRect(x + Math.round(w / 2) - k, y, 2 * k, 2 * k);
    g.fillStyle = '#16110f'; g.fillText(txt, x + 3 * k, y - 3 * k);
  }
}
