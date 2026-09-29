// Canvas pixel office. Pure view: draws whatever the reducer state says, nothing else.
// Logical 320x180 units drawn onto a 3x canvas: pixel-art rectangles stay sharp, text stays crisp.
import { drawSprite } from './sprites.js';

const ENTRY = [172, 168];                 // agents come in from the lobby door
const LOBBY = [[146, 110], [166, 122], [186, 108], [154, 138], [176, 142], [196, 126]]; // open floor where free agents stand
const SPEED = 46;                          // px/s; movement happens only after a real state change

const W = 320, H = 180;
const C = {
  floor: '#1c2028', floor2: '#181c23', wall: '#2b313b', ink: '#d9dee7', dim: '#5b6474', amber: '#e8a838',
  green: '#5fd38d', red: '#ef6461', blue: '#6aa9ff', violet: '#b48ead', desk: '#6b4f3a', deskTop: '#8b6a4d',
  screen: '#0e1014', skin: '#e9c9a3', rack: '#252a33',
};
const ROOMS = {
  manager: { x: 6, y: 6, w: 92, h: 78, label: 'MANAGER OFFICE' },
  engineering: { x: 104, y: 6, w: 128, h: 78, label: 'ENGINEERING' },
  qa: { x: 238, y: 6, w: 76, h: 78, label: 'QA LAB' },
  server: { x: 6, y: 92, w: 190, h: 82, label: 'SERVER ROOM' },
  release: { x: 202, y: 92, w: 112, h: 82, label: 'RELEASE' },
};
const IMG = {};
for (const n of ['desk-pc', 'rack', 'plant', 'shelf', 'frame', 'cabinet', 'floor-eng', 'floor-mgr', 'floor-qa', 'floor-srv']) { const i = new Image(); i.src = `/assets/furniture-${n}.png`; IMG[n] = i; }
const FLOOR = { manager: 'floor-mgr', engineering: 'floor-eng', qa: 'floor-qa', server: 'floor-srv', release: 'floor-eng' };
const DESKS = [ [112, 40], [172, 40], [112, 64], [172, 64] ]; // engineering desk slots

export class Office {
  constructor(canvas) {
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.scale = canvas.width / W;
    this.state = null;
    this.raf = null;
    this.pos = {}; this.lastT = 0;
  }
  setState(s) { this.state = s; }
  start() {
    const loop = (t) => { this.draw(t); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }
  draw(t) {
    const g = this.ctx;
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.fillStyle = '#0e1014'; g.fillRect(0, 0, W, H);
    this.floor();
    if (!this.state) return;
    const s = this.state, now = Date.now(), dt = Math.min(0.1, (t - this.lastT) / 1000 || 0); this.lastT = t;
    this.roamers = [];
    this.decor();
    this.managerRoom(s, t, dt); this.engineering(s, t, now, dt); this.qaRoom(s, t, dt); this.serverRoom(s, t, now); this.release(s);
    // people who are up and walking are drawn last, sorted by depth, so they pass in front of furniture
    this.roamers.sort((a, b) => a.y - b.y).forEach((r) => r.draw());
  }

  floor() {
    const g = this.ctx, tile = IMG['floor-eng'];
    for (let y = 0; y < H; y += 14) for (let x = 0; x < W; x += 17) {
      if (tile?.complete && tile.naturalWidth) g.drawImage(tile, x, y, 17, 14);
      else { g.fillStyle = ((x + y) / 8) % 2 ? C.floor : C.floor2; g.fillRect(x, y, 8, 8); }
    }
    g.fillStyle = 'rgba(8,10,14,0.35)'; g.fillRect(0, 0, W, H);
    // zone rugs on one shared floor (no walls): the office is an open space
    const rug = (x, y, w, h, col) => { g.fillStyle = col; g.fillRect(x, y, w, h); };
    rug(4, 6, 96, 78, 'rgba(122,60,80,0.35)');     // manager
    rug(240, 6, 76, 78, 'rgba(70,120,80,0.30)');   // qa
    rug(6, 92, 136, 82, 'rgba(60,66,80,0.35)');    // servers
    rug(206, 92, 108, 82, 'rgba(50,60,90,0.30)');  // release
    rug(142, 96, 66, 78, 'rgba(232,168,56,0.10)'); // lobby
    for (const [t, x, y] of [['MANAGER', 8, 12], ['ENGINEERING', 112, 12], ['QA', 244, 12], ['SERVERS', 10, 98], ['LOBBY', 152, 102], ['RELEASE', 210, 98]]) this.text(t, x, y, '#6f7a8c', 6);
  }
  room(k, r) {
    const g = this.ctx, tile = IMG[FLOOR[k]];
    g.fillStyle = C.wall; g.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    g.save(); g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
    for (let y = 0; y < r.h; y += 14) for (let x = 0; x < r.w; x += 17) {
      if (tile?.complete && tile.naturalWidth) g.drawImage(tile, r.x + x, r.y + y, 17, 14);
      else { g.fillStyle = ((x + y) / 8) % 2 ? C.floor : C.floor2; g.fillRect(r.x + x, r.y + y, 8, 8); }
    }
    g.fillStyle = 'rgba(8,10,14,0.2)'; g.fillRect(r.x, r.y, r.w, r.h); // keep the room moody so sprites read on top
    g.restore();
    this.text(r.label, r.x + 3, r.y + 8, '#8a94a6', 6);
  }
  text(str, x, y, color = C.ink, size = 7) {
    const g = this.ctx; g.font = `bold ${size}px monospace`; g.fillStyle = color; g.fillText(str, Math.round(x), Math.round(y));
  }
  sprite(name, x, y, w, h) {
    const i = IMG[name]; if (i?.complete && i.naturalWidth) this.ctx.drawImage(i, x, y, w, h);
  }
  desk(x, y, active, t, tint = C.screen) {
    const g = this.ctx, i = IMG['desk-pc'];
    if (!(i?.complete && i.naturalWidth)) { g.fillStyle = C.desk; g.fillRect(x, y + 6, 26, 10); return; }
    g.drawImage(i, x - 5, y - 10, 34, 28);
    // screen glow is event-driven: dark when idle, flickers only while the agent is really working
    g.fillStyle = active ? (Math.floor(t / 250) % 2 ? 'rgba(95,211,141,0)' : 'rgba(95,211,141,0.25)') : (tint === C.screen ? 'rgba(10,12,16,0.85)' : 'rgba(232,168,56,0.45)');
    g.fillRect(x + 4, y - 9, 16, 8);
  }
  person(x, y, color, state, t, role = "ENGINEER", opts = {}) {
    const g = this.ctx;
    const bob = state === 'coding' || state === 'testing' || state === 'reviewing' ? (Math.floor(t / 180) % 2) : 0;
    drawSprite(g, x, y, role, state, state === 'failed' ? color : undefined, opts);
    g.fillStyle = C.skin; g.fillRect(x - 1, y + 8 - bob, 2, 3); g.fillRect(x + 9, y + 8 + bob, 2, 3);
    if (opts.walk == null) { g.fillStyle = '#20242c'; g.fillRect(x + 2, y + 13, 2, 3); g.fillRect(x + 6, y + 13, 2, 3); }
    if (state === 'failed') { g.fillStyle = C.red; g.fillRect(x + 4, y - 9, 2, 5); g.fillRect(x + 4, y - 3, 2, 2); }
  }
  bubble(id, x, y, now) {
    const b = this.state.bubbles[id];
    if (!b || now - Date.parse(b.ts) > 6000) return; // only fresh events speak
    const g = this.ctx, txt = b.text.length > 15 ? b.text.slice(0, 14) + '…' : b.text, w = txt.length * 4 + 8;
    g.fillStyle = C.ink; g.fillRect(x, y, w, 11);
    this.text(txt, x + 3, y + 8, '#14171c', 6);
  }
  label(a, x, y) { this.text(a.id.replace('qa-reviewer', 'qa'), x, y, '#b6bfce', 6); }

  decor() {
    this.sprite('shelf', 10, 16, 34, 29); this.sprite('frame', 52, 12, 18, 16); this.sprite('plant', 76, 56, 16, 24);
    this.sprite('plant', 108, 14, 14, 21); this.sprite('cabinet', 296, 14, 16, 20); this.sprite('plant', 242, 60, 14, 21);
  }
  // Where an agent should be is decided by its (event-driven) state; only the walking between places is animated.
  // Agents at their desk are drawn with the desk; agents in transit or in the lobby are drawn in the depth-sorted pass.
  move(a, seat, slot, t, dt, opts, spawn) {
    const tgt = seat ?? LOBBY[slot % LOBBY.length];
    let p = this.pos[a.id];
    if (!p) p = this.pos[a.id] = { x: (spawn ?? tgt)[0], y: (spawn ?? tgt)[1] };
    const dx = tgt[0] - p.x, dy = tgt[1] - p.y, d = Math.hypot(dx, dy), step = SPEED * dt;
    const moving = d > 0.5;
    if (moving) { const k = Math.min(1, step / d); p.x += dx * k; p.y += dy * k; }
    const atSeat = seat && !moving;
    return { x: Math.round(p.x), y: Math.round(p.y), atSeat, o: { ...opts, walk: moving ? Math.floor(t / 150) % 2 : undefined } };
  }
  actor(a, m, color, t, role, now) {
    const draw = () => { this.person(m.x, m.y, color, a.state, t, role, m.o); this.bubble(a.id, m.x - 8, m.y - 16, now); };
    if (m.atSeat) draw(); else this.roamers.push({ y: m.y, draw });
  }
  managerRoom(s, t, dt) {
    const a = s.agents.manager, now = Date.now();
    const m = this.move(a, a.state === 'planning' ? [37, 14] : null, 0, t, dt, {});
    this.actor(a, m, C.violet, t, 'MANAGER', now);
    this.desk(30, 40, a.state === 'planning', t); this.label(a, 30, 76);
  }
  engineering(s, t, now, dt) {
    const eng = Object.values(s.agents).filter((a) => a.role === 'ENGINEER').sort((x, y) => x.taskId - y.taskId);
    DESKS.forEach(([x, y], i) => {
      const a = eng[i];
      if (a) {
        const fresh = a.assignedAt && now - Date.parse(a.assignedAt) < 3000; // walk in only for a fresh assignment event
        const seat = a.done ? null : [x + 7, y - 26];
        const m = this.move(a, seat, 1 + i, t, dt, { variant: (a.taskId ?? i) - 1 }, fresh ? ENTRY : null);
        this.actor(a, m, a.state === 'failed' ? '#8a4b4b' : C.blue, t, 'ENGINEER', now);
        this.desk(x, y, a.state === 'coding', t);
        this.label({ id: `eng ${a.taskId}` }, x + 30, y + 2);
      } else this.desk(x, y, false, t);
    });
    if (eng.length > DESKS.length) this.text(`+${eng.length - DESKS.length} more`, 176, 82, C.amber);
  }
  qaRoom(s, t, dt) {
    const a = s.agents['qa-reviewer'], now = Date.now();
    const busy = a.state === 'testing' || a.state === 'reviewing';
    const m = this.move(a, busy ? [269, 14] : null, 5, t, dt, {});
    this.actor(a, m, C.green, t, 'QA', now);
    this.desk(262, 40, busy, t, busy ? C.amber : C.screen);
    this.label({ id: `qa ${a.state}` }, 246, 76);
  }
  serverRoom(s, t, now) {
    const g = this.ctx, sv = s.server;
    const racks = [ ['BACKUP', 14], ['MAIN', 62], ['CHECKS', 110] ];
    racks.forEach(([name, x]) => {
      this.sprite('rack', x + 4, 106, 31, 55);
      this.text(name, x + 4, 170, C.dim, 6);
    });
    const led = (x, row, on, col) => { g.fillStyle = on ? col : '#2f3540'; g.fillRect(x + 36, 111 + row * 8, 3, 3); };
    const backupFresh = sv.backupAt && now - Date.parse(sv.backupAt) < 4000;
    led(14, 0, backupFresh || (sv.backupAt != null), backupFresh ? C.green : C.dim);
    led(62, 0, sv.merging, C.amber);
    led(62, 1, sv.result === 'success', C.green);
    led(62, 2, ['verification_failed', 'conflict'].includes(sv.result), C.red);
    led(62, 3, sv.result === 'rolled_back', C.violet);
    led(110, 0, sv.verifying, C.amber);
    if (sv.merging) { // merge bar moves only while a merge is actually in progress
      g.fillStyle = '#12151b'; g.fillRect(66, 150, 32, 5);
      g.fillStyle = C.amber; g.fillRect(66, 150, 4 + (Math.floor(t / 90) % 28), 5);
    }
  }
  release(s) {
    const sv = s.server, g = this.ctx;
    this.text(`merged: ${sv.mergeCount}`, 210, 116, C.ink, 8);
    const map = { success: ['MERGE OK', C.green], verification_failed: ['VERIFY FAILED', C.red], conflict: ['CONFLICT', C.red], rolled_back: ['ROLLED BACK', C.violet] };
    const [txt, col] = map[sv.result] ?? [sv.merging ? 'MERGING…' : 'IDLE', sv.merging ? C.amber : C.dim];
    g.fillStyle = '#0e1014'; g.fillRect(210, 124, 96, 22); g.fillStyle = col; g.fillRect(210, 124, 3, 22);
    this.text(txt, 218, 138, col, 8);
    const active = Object.values(s.tasks).filter((x) => !['COMPLETED', 'FAILED', 'CANCELLED', 'CONFLICT', 'BLOCKED', 'QUEUED'].includes(x.status)).length;
    this.text(`in flight: ${active}`, 210, 160, C.dim, 7);
  }
}
