// Canvas pixel office. Pure view: draws whatever the reducer state says, nothing else.
// Logical 320x180 units drawn onto a 3x canvas: pixel-art rectangles stay sharp, text stays crisp.
import { drawSprite } from './sprites.js';

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
const DESKS = [ [112, 40], [172, 40], [112, 64], [172, 64] ]; // engineering desk slots

export class Office {
  constructor(canvas) {
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.scale = canvas.width / W;
    this.state = null;
    this.raf = null;
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
    for (const [k, r] of Object.entries(ROOMS)) this.room(k, r);
    if (!this.state) return;
    const s = this.state, now = Date.now();
    this.managerRoom(s, t); this.engineering(s, t, now); this.qaRoom(s, t); this.serverRoom(s, t, now); this.release(s);
  }

  room(_k, r) {
    const g = this.ctx;
    g.fillStyle = C.wall; g.fillRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
    for (let y = 0; y < r.h; y += 8) for (let x = 0; x < r.w; x += 8) {
      g.fillStyle = ((x + y) / 8) % 2 ? C.floor : C.floor2; g.fillRect(r.x + x, r.y + y, 8, 8);
    }
    this.text(r.label, r.x + 3, r.y + 8, '#8a94a6', 6);
  }
  text(str, x, y, color = C.ink, size = 7) {
    const g = this.ctx; g.font = `bold ${size}px monospace`; g.fillStyle = color; g.fillText(str, Math.round(x), Math.round(y));
  }
  desk(x, y, active, t, tint = C.screen) {
    const g = this.ctx;
    g.fillStyle = C.desk; g.fillRect(x, y + 6, 26, 10); g.fillStyle = C.deskTop; g.fillRect(x, y + 4, 26, 4);
    g.fillStyle = '#3a3f4a'; g.fillRect(x + 8, y - 6, 12, 9);
    g.fillStyle = active ? (Math.floor(t / 250) % 2 ? '#3b7f57' : '#5fd38d') : tint; g.fillRect(x + 9, y - 5, 10, 7);
  }
  person(x, y, color, state, t, role = "ENGINEER") {
    const g = this.ctx;
    const bob = state === 'coding' || state === 'testing' || state === 'reviewing' ? (Math.floor(t / 180) % 2) : 0;
    drawSprite(g, x, y, role, state, state === 'failed' ? color : undefined);
    g.fillStyle = C.skin; g.fillRect(x - 1, y + 8 - bob, 2, 3); g.fillRect(x + 9, y + 8 + bob, 2, 3);
    g.fillStyle = '#20242c'; g.fillRect(x + 2, y + 13, 2, 3); g.fillRect(x + 6, y + 13, 2, 3);
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

  managerRoom(s, t) {
    const a = s.agents.manager;
    this.desk(30, 40, a.state === 'planning', t);
    this.person(37, 24, C.violet, a.state, t, "MANAGER"); this.label(a, 30, 76);
    this.bubble('manager', 12, 14, Date.now());
  }
  engineering(s, t, now) {
    const eng = Object.values(s.agents).filter((a) => a.role === 'ENGINEER').sort((x, y) => x.taskId - y.taskId);
    DESKS.forEach(([x, y], i) => {
      const a = eng[i];
      this.desk(x, y, a?.state === 'coding', t);
      if (a) {
        this.person(x + 7, y - 16, a.state === 'failed' ? '#8a4b4b' : C.blue, a.state, t);
        this.label({ id: `eng ${a.taskId}` }, x + 30, y + 2);
        this.bubble(a.id, x - 2, y - 30, now);
      }
    });
    if (eng.length > DESKS.length) this.text(`+${eng.length - DESKS.length} more`, 176, 82, C.amber);
  }
  qaRoom(s, t) {
    const a = s.agents['qa-reviewer'];
    const busy = a.state === 'testing' || a.state === 'reviewing';
    this.desk(262, 40, busy, t, busy ? C.amber : C.screen);
    this.person(269, 24, C.green, a.state, t, "QA");
    this.label({ id: `qa ${a.state}` }, 246, 76);
    this.bubble('qa-reviewer', 244, 14, Date.now());
  }
  serverRoom(s, t, now) {
    const g = this.ctx, sv = s.server;
    const racks = [ ['BACKUP', 14], ['MAIN', 62], ['CHECKS', 110] ];
    racks.forEach(([name, x]) => {
      g.fillStyle = C.rack; g.fillRect(x, 106, 40, 56);
      for (let i = 0; i < 6; i++) { g.fillStyle = '#12151b'; g.fillRect(x + 3, 109 + i * 8, 34, 6); }
      this.text(name, x + 4, 170, C.dim, 6);
    });
    const led = (x, row, on, col) => { g.fillStyle = on ? col : '#2f3540'; g.fillRect(x + 31, 111 + row * 8, 3, 3); };
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
