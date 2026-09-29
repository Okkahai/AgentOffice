// World renderer + actors. Own animation loop; the DOM overlay talks to it through explicit calls and callbacks.
// Movement and animation are projections of reducer state (ui/office-state.js); nothing here is authoritative.
import { WORLD, DESKS, DECOR, ENTRANCE, WANDER } from './world.js';
import { buildGrid, findPath } from './nav.js';
import { fitZoom, clampCam, origin, zoomAt } from './camera.js';

const SPEED = 40;                 // native px per second (art bible)
const FRAME = { w: 32, h: 48, ax: 16, ay: 45 };
const load = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error(src)); i.src = src; });

export class Game {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.hooks = hooks;
    this.cam = { x: WORLD.w / 2, y: WORLD.h / 2 }; this.camTarget = null; this.z = 2; this.k = 2; this.vw = 0; this.vh = 0;
    this.scene = null; this.actors = new Map(); this.selected = null; this.hover = null; this.keys = new Set();
    this.grid = buildGrid(); this.last = 0; this.ready = false;
  }
  async load() {
    const [meta, ...imgs] = await Promise.all([
      fetch('/assets/chars/meta.json').then((r) => r.json()),
      ...['desk', 'rack', 'plant', 'shelf', 'frame', 'floor', 'wall'].map((n) => load(`/assets/world/${n}.png`)),
      ...[0, 1, 2].map((v) => load(`/assets/chars/engineer-${v}.png`)),
    ]);
    this.meta = meta;
    this.img = Object.fromEntries(['desk', 'rack', 'plant', 'shelf', 'frame', 'floor', 'wall'].map((n, i) => [n, imgs[i]]));
    this.sheets = imgs.slice(7); this.ready = true;
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
  focus(id) { const a = this.actors.get(id); if (a) { this.camTarget = { x: a.x, y: a.y - 20 }; if (this.z < 3) this.setZoom(3); } }
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
    for (const a of [...this.actors.values()].sort((x, y) => y.y - x.y)) if (inR({ x: a.x - 10, y: a.y - 42, w: 20, h: 44 })) return { kind: 'agent', id: a.id };
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
        m = { id: a.id, x: start.x, y: start.y, path: [], desk: deskIdx, atSeat: !!(stale && seat), wait: 0, facing: 'down', flip: false, anim: 'idle', animT: now, celebrated: !!a.done, until: 0, variant: ((a.taskId ?? i + 1) - 1) % 3 };
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
        const ax = Math.abs(dx), ay = Math.abs(dy);   // hysteresis so diagonal steps do not flicker between views
        if (ax > ay * 1.5 || (m.facing !== 'side' && m.facing !== 'up' && m.facing !== 'down')) { m.facing = 'side'; m.flip = dx < 0; }
        else if (ay > ax * 1.5) m.facing = dy < 0 ? 'up' : 'down';
        else if (m.facing === 'side') m.flip = dx < 0;
      }
      if (!m.path.length && m.dest === 'desk' && seat) { m.x = seat.x; m.y = seat.y; m.atSeat = true; m.facing = 'down'; }
      const anim = a.state === 'failed' ? 'failure' : now < m.until ? 'success' : moving ? `walk_${m.facing}` : m.atSeat && a.state === 'coding' ? 'type' : 'idle';
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
    const I = this.img;
    for (let y = WORLD.wallH; y < WORLD.h; y += 24) for (let x = 0; x < WORLD.w; x += 32) g.drawImage(I.floor, x, y);
    for (let y = 0; y < WORLD.wallH; y += 24) for (let x = 0; x < WORLD.w; x += 32) g.drawImage(I.wall, x, y);
    g.fillStyle = '#16110f'; g.fillRect(0, WORLD.wallH - 2, WORLD.w, 2);
    g.drawImage(I.frame, DECOR.frame.x, DECOR.frame.y); g.drawImage(I.shelf, DECOR.shelf.x, DECOR.shelf.y); g.drawImage(I.rack, DECOR.rack.x, DECOR.rack.y);
    // entrance mat
    g.fillStyle = '#3b2a22'; g.fillRect(ENTRANCE.x - 18, WORLD.h - 12, 36, 8); g.fillStyle = '#55392a'; g.fillRect(ENTRANCE.x - 16, WORLD.h - 11, 32, 1);
    // depth-sorted things
    const items = [];
    const seated = new Map([...this.actors.values()].filter((a) => a.atSeat).map((a) => [a.desk, a]));
    for (const d of DESKS) items.push({ base: d.base, draw: () => this.drawDesk(d, seated.get(d.id), now) });
    items.push({ base: DECOR.plant.base, draw: () => g.drawImage(I.plant, DECOR.plant.x, DECOR.plant.y) }, { base: DECOR.plant2.base, draw: () => g.drawImage(I.plant, DECOR.plant2.x, DECOR.plant2.y) });
    for (const a of this.actors.values()) items.push({ base: a.y, draw: () => this.drawActor(a, now) });
    items.sort((p, q) => p.base - q.base).forEach((it) => it.draw());
    // overlays in device pixels: bubbles + labels
    g.setTransform(1, 0, 0, 1, 0, 0);
    for (const a of this.actors.values()) this.drawBubble(a, now, ox, oy);
  }
  drawDesk(d, who, now) {
    const g = this.ctx; g.drawImage(this.img.desk, d.x, d.y);
    const m = d.monitor, live = who && who.state === 'coding' && who.anim === 'type';
    g.fillStyle = live ? (Math.floor(now / 350) % 2 ? 'rgba(95,154,85,0.28)' : 'rgba(95,154,85,0.08)') : 'rgba(13,11,10,0.6)'; g.fillRect(m.x, m.y, m.w, m.h);
  }
  drawActor(a, now) {
    const g = this.ctx, row = this.meta.rows[a.anim] ?? this.meta.rows.idle, f = Math.floor((now - a.animT) / 1000 * row.fps) % row.frames;
    const sx = f * FRAME.w, sy = row.row * FRAME.h, x = Math.round(a.x) - FRAME.ax, y = Math.round(a.y) - FRAME.ay, sheet = this.sheets[a.variant];
    if (a.id === this.selected) { g.fillStyle = '#f2b451'; const cx = Math.round(a.x), cy = Math.round(a.y); for (let i = -12; i <= 12; i++) { const j = Math.round(Math.sqrt(1 - (i / 12) ** 2) * 4); g.fillRect(cx + i, cy + 1 + j, 1, 1); g.fillRect(cx + i, cy + 1 - j, 1, 1); } }
    if (a.flip) { g.save(); g.translate(Math.round(a.x) * 2, 0); g.scale(-1, 1); g.drawImage(sheet, sx, sy, FRAME.w, FRAME.h, x, y, FRAME.w, FRAME.h); g.restore(); }
    else g.drawImage(sheet, sx, sy, FRAME.w, FRAME.h, x, y, FRAME.w, FRAME.h);
  }
  drawBubble(a, now, ox, oy) {
    const b = this.scene.bubbles[a.id]; if (!b || now - Date.parse(b.ts) > 6000) return;
    const g = this.ctx, k = this.k, txt = b.text.length > 26 ? b.text.slice(0, 25) + '…' : b.text;
    g.font = `bold ${6 * k}px monospace`; const w = g.measureText(txt).width + 6 * k, h = 10 * k;
    const x = Math.round(ox + (a.x - w / k / 2) * k), y = Math.round(oy + (a.y - 58) * k);
    g.fillStyle = '#d9ccb0'; g.fillRect(x, y - h, Math.round(w), h); g.fillStyle = '#d9ccb0'; g.fillRect(x + Math.round(w / 2) - k, y, 2 * k, 2 * k);
    g.fillStyle = '#16110f'; g.fillText(txt, x + 3 * k, y - 3 * k);
  }
}
