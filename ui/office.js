// Canvas pixel lobby. One open hall; agents walk between desks and the open floor.
// Work movement (going to a desk, alarm, screens, forge glow) comes from reducer state only.
// Idle strolling is ambient decoration and never implies work.
import { drawChar, CHAR_H } from './sprites.js';

const ENTRY = [172, 168];                 // agents come in from the lobby door
const LOBBY = [[146, 110], [166, 122], [186, 108], [154, 138], [176, 142], [196, 126]]; // open floor where free agents stand
const SPEED = 46;                          // px/s; movement happens only after a real state change

const W = 320, H = 180;
const C = { ink: '#d9dee7', dim: '#6b6558', amber: '#e8a838', green: '#5fd38d', red: '#ef6461', violet: '#b48ead' };
const IMG = {};
for (const n of ['desk-pc', 'rack', 'plant', 'shelf', 'frame', 'cabinet', 'floor-eng']) { const i = new Image(); i.src = `/assets/furniture-${n}.png`; IMG[n] = i; }
const DESKS = [[48, 62], [92, 62], [136, 62], [180, 62]];   // engineer desks
const MGR_DESK = [6, 62], QA_DESK = [236, 104];
const RACKS = [['BACKUP', 232], ['MAIN', 262], ['CHECKS', 292]];
const DOOR = [8, 105], WORKING = ['coding', 'testing', 'planning', 'reviewing'];
const SPEED = 24; // logical px per second

export class Office {
  constructor(canvas) {
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.scale = canvas.width / W;
    this.state = null; this.actors = {}; this.last = 0;
  }
  setState(s) { this.state = s; }
  start() { const loop = (t) => { this.draw(t); requestAnimationFrame(loop); }; requestAnimationFrame(loop); }

  sprite(name, x, y, w, h) { const i = IMG[name]; if (i?.complete && i.naturalWidth) this.ctx.drawImage(i, x, y, w, h); }
  text(str, x, y, color = C.ink, size = 6) { const g = this.ctx; g.font = `bold ${size}px monospace`; g.fillStyle = color; g.fillText(str, Math.round(x), Math.round(y)); }

  seatFor(a, engIndex) {
    if (a.role === 'MANAGER') return [MGR_DESK[0] + 7, MGR_DESK[1] + 4];
    if (a.role === 'QA') return [QA_DESK[0] + 7, QA_DESK[1] + 4];
    const d = DESKS[engIndex]; return d ? [d[0] + 7, d[1] + 4] : null;
  }
  update(t) {
    const dt = Math.min(0.1, (t - this.last) / 1000 || 0); this.last = t;
    const s = this.state, ids = Object.keys(s.agents);
    for (const id of Object.keys(this.actors)) if (!s.agents[id]) delete this.actors[id];
    const eng = Object.values(s.agents).filter((a) => a.role === 'ENGINEER').sort((x, y) => x.taskId - y.taskId);
    for (const id of ids) {
      const a = s.agents[id];
      const me = (this.actors[id] ??= { x: DOOR[0], y: DOOR[1], tx: DOOR[0], ty: DOOR[1], wait: 0, leg: 0 });
      const seat = this.seatFor(a, eng.indexOf(a));
      if (WORKING.includes(a.state) && seat) { me.tx = seat[0]; me.ty = seat[1]; }
      else if (a.state === 'failed') { me.tx = me.x; me.ty = me.y; }
      else if (me.wait <= 0 && Math.hypot(me.tx - me.x, me.ty - me.y) < 1) {
        me.tx = 20 + Math.random() * 200; me.ty = 92 + Math.random() * 44; me.wait = 1.5 + Math.random() * 5;
      }
      const dx = me.tx - me.x, dy = me.ty - me.y, d = Math.hypot(dx, dy);
      me.moving = d > 0.8;
      if (me.moving) { const k = Math.min(1, SPEED * dt / d); me.x += dx * k; me.y += dy * k; }
      else me.wait -= dt;
      me.seated = !me.moving && WORKING.includes(a.state) && !!seat;
    }
  }
  draw(t) {
    const g = this.ctx;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    if (!this.state) return;
    this.update(t);
    const s = this.state, now = Date.now();
    this.hall(t, s);
    this.furniture(s, t);
    // actors sorted by y so nearer ones overlap farther ones
    const eng = Object.values(s.agents).filter((a) => a.role === 'ENGINEER').sort((x, y) => x.taskId - y.taskId);
    Object.values(s.agents).map((a) => [a, this.actors[a.id]]).filter(([, m]) => m).sort((p, q) => p[1].y - q[1].y).forEach(([a, m]) => {
      const variant = a.role === 'ENGINEER' ? (a.taskId ?? eng.indexOf(a)) - 1 : undefined;
      const leg = m.moving ? 1 + (Math.floor(t / 160) % 2) : 0;
      drawChar(g, Math.round(m.x), Math.round(m.y - CHAR_H + 28), a.role, { variant, leg, typing: m.seated ? Math.floor(t / 140) % 2 : undefined, sit: false });
      if (a.state === 'failed') { g.fillStyle = C.red; g.fillRect(Math.round(m.x) + 5, Math.round(m.y) - 9, 2, 5); g.fillRect(Math.round(m.x) + 5, Math.round(m.y) - 3, 2, 2); }
      this.bubble(a.id, Math.round(m.x) - 6, Math.round(m.y) - 8, now);
      this.text(a.role === 'ENGINEER' ? `eng ${a.taskId}` : a.id === 'qa-reviewer' ? 'qa' : a.id, Math.round(m.x) - 2, Math.round(m.y) + 36, '#b6a98f', 5);
    });
    g.fillStyle = 'rgba(0,0,0,0.0)';
  }

  hall(t, s) {
    const g = this.ctx, sv = s.server;
    g.fillStyle = '#0d0b0a'; g.fillRect(0, 0, W, H);
    // back wall: dark brick
    for (let y = 0; y < 44; y += 6) for (let x = ((y / 6) % 2) * 8; x < W; x += 16) {
      g.fillStyle = ((x * 7 + y * 13) % 5) ? '#2a1d18' : '#33231c'; g.fillRect(x, y, 15, 5);
    }
    g.fillStyle = '#120e0c'; g.fillRect(0, 44, W, 3);
    // floor: worn tiles
    const tile = IMG['floor-eng'];
    for (let y = 47; y < H; y += 14) for (let x = 0; x < W; x += 17) { if (tile?.complete && tile.naturalWidth) g.drawImage(tile, x, y, 17, 14); }
    g.fillStyle = 'rgba(20,10,4,0.55)'; g.fillRect(0, 47, W, H - 47);
    // warm pool of light around the forge; it only flares while a merge is really running
    const hot = sv.merging ? 1 : (sv.result === 'success' ? 0.45 : 0.18), fl = sv.merging ? 0.12 * Math.sin(t / 90) : 0;
    const grd = g.createRadialGradient(160, 120, 4, 160, 120, 90);
    grd.addColorStop(0, `rgba(255,150,40,${0.5 * hot + fl})`); grd.addColorStop(1, 'rgba(255,150,40,0)');
    g.fillStyle = grd; g.fillRect(60, 40, 200, 140);
    // forge (release hub)
    g.fillStyle = '#1a1512'; g.fillRect(146, 122, 28, 12); g.fillStyle = '#2b2420'; g.fillRect(148, 120, 24, 4);
    const flame = sv.merging ? ['#ffb347', '#ff7a1a', '#ffd88a'] : ['#7a3a12', '#4a2410', '#5a2c10'];
    for (let i = 0; i < 5; i++) { const h = (sv.merging ? 6 + ((Math.floor(t / 110) + i * 3) % 6) : 2 + (i % 2)); g.fillStyle = flame[i % 3]; g.fillRect(150 + i * 4, 121 - h, 3, h); }
    // door
    g.fillStyle = '#050403'; g.fillRect(0, 128, 6, 40); g.fillStyle = '#3a2a1c'; g.fillRect(6, 128, 1, 40);
    this.text('EXIT', 1, 126, '#5a4a30', 5);
    // status board on the wall
    const map = { success: ['MERGE OK', C.green], verification_failed: ['VERIFY FAILED', C.red], conflict: ['CONFLICT', C.red], rolled_back: ['ROLLED BACK', C.violet] };
    const [txt, col] = map[sv.result] ?? [sv.merging ? 'MERGING...' : 'IDLE', sv.merging ? C.amber : C.dim];
    g.fillStyle = '#0a0908'; g.fillRect(110, 8, 100, 26); g.fillStyle = col; g.fillRect(110, 8, 2, 26);
    this.text(`merged: ${sv.mergeCount}`, 116, 18, '#b6a98f', 6); this.text(txt, 116, 29, col, 8);
    const active = Object.values(s.tasks).filter((x) => !['COMPLETED', 'FAILED', 'CANCELLED', 'CONFLICT', 'BLOCKED', 'QUEUED'].includes(x.status)).length;
    this.text(`in flight: ${active}`, 172, 18, '#8a7d66', 6);
  }
  furniture(s, t) {
    const g = this.ctx, sv = s.server, now = Date.now();
    this.sprite('shelf', 8, 6, 34, 29); this.sprite('frame', 52, 8, 18, 16); this.sprite('plant', 80, 20, 14, 21); this.sprite('cabinet', 218, 14, 16, 20);
    this.sprite('plant', 300, 118, 14, 21); this.sprite('plant', 100, 140, 14, 21);
    RACKS.forEach(([name, x]) => { this.sprite('rack', x - 6, 6, 26, 46); this.text(name, x - 8, 60, '#6b6558', 5); });
    const led = (x, row, on, col) => { g.fillStyle = on ? col : '#2f2a26'; g.fillRect(x + 21, 10 + row * 6, 2, 2); };
    const fresh = sv.backupAt && now - Date.parse(sv.backupAt) < 4000;
    led(232 - 6, 0, sv.backupAt != null, fresh ? C.green : C.dim);
    led(262 - 6, 0, sv.merging, C.amber); led(262 - 6, 1, sv.result === 'success', C.green);
    led(262 - 6, 2, ['verification_failed', 'conflict'].includes(sv.result), C.red); led(262 - 6, 3, sv.result === 'rolled_back', C.violet);
    led(292 - 6, 0, sv.verifying, C.amber);
    const eng = Object.values(s.agents).filter((a) => a.role === 'ENGINEER').sort((x, y) => x.taskId - y.taskId);
    const desk = (x, y, active, tint) => {
      this.sprite('desk-pc', x - 5, y - 10, 34, 28);
      g.fillStyle = active ? (Math.floor(t / 250) % 2 ? 'rgba(95,211,141,0)' : 'rgba(95,211,141,0.25)') : (tint ?? 'rgba(10,12,16,0.85)');
      g.fillRect(x + 4, y - 9, 16, 8);
    };
    desk(...MGR_DESK, s.agents.manager?.state === 'planning');
    DESKS.forEach(([x, y], i) => desk(x, y, eng[i]?.state === 'coding'));
    const qa = s.agents['qa-reviewer'], busy = qa && (qa.state === 'testing' || qa.state === 'reviewing');
    desk(...QA_DESK, busy, busy ? 'rgba(232,168,56,0.45)' : undefined);
  }
  bubble(id, x, y, now) {
    const b = this.state.bubbles[id];
    if (!b || now - Date.parse(b.ts) > 6000) return;
    const g = this.ctx, txt = b.text.length > 15 ? b.text.slice(0, 14) + '…' : b.text, w = txt.length * 4 + 8;
    g.fillStyle = '#d8ccb0'; g.fillRect(x, y - 12, w, 11);
    this.text(txt, x + 3, y - 4, '#14100c', 6);
  }
}
