// Deterministic character sprite sheets (see docs/art-bible.md). No dependencies: draws indexed pixels, writes PNG with zlib.
//   node scripts/gen-sprites.ts        -> ui/assets/chars/engineer-<0..2>.png + meta.json
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
export const PALETTE: Record<string, string> = JSON.parse(readFileSync(path.join(root, 'tools/art/palette.json'), 'utf8'));
export const FRAME_W = 32, FRAME_H = 48;

type Name = string;
class Frame {
  px: (Name | null)[] = new Array(FRAME_W * FRAME_H).fill(null);
  set(x: number, y: number, c: Name) { if (x >= 0 && y >= 0 && x < FRAME_W && y < FRAME_H) this.px[y * FRAME_W + x] = c; }
  get(x: number, y: number) { return x < 0 || y < 0 || x >= FRAME_W || y >= FRAME_H ? null : this.px[y * FRAME_W + x]!; }
  rect(x: number, y: number, w: number, h: number, c: Name) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  outline(c: Name) {
    const add: [number, number][] = [];
    for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) if (!this.get(x, y))
      if (this.get(x + 1, y) || this.get(x - 1, y) || this.get(x, y + 1) || this.get(x, y - 1)) add.push([x, y]);
    for (const [x, y] of add) this.set(x, y, c);
  }
  shadow() { for (let j = 0; j < 3; j++) for (let x = 7 - j * 2; x < 25 + j * 2; x++) if (!this.get(x, 45 + j) && (x + j) % 2 === 0) this.set(x, 45 + j, 'ink1'); }
}

interface Look { hair: Name; hairLo: Name; hairHi: Name }
const LOOKS: Look[] = [
  { hair: 'ink3', hairLo: 'ink2', hairHi: 'wood1' },     // dark
  { hair: 'wood1', hairLo: 'wood0', hairHi: 'wood3' },    // brown
  { hair: 'amber0', hairLo: 'wood1', hairHi: 'amber1' },  // auburn
];

interface Pose {
  view?: 'front' | 'back' | 'side';
  bob?: number;                    // body (head, torso, arms) vertical offset
  armL?: 'down' | 'type' | 'up' | 'head'; armR?: 'down' | 'type' | 'think' | 'up' | 'head' | 'gesture';
  swingL?: number; swingR?: number; // arm vertical swing in walk
  legL?: number; legR?: number;     // leg lift in px (0 planted, >0 lifted, <0 extended)
  face?: 'neutral' | 'focus' | 'down' | 'up' | 'talk' | 'smile' | 'alarm';
  dx?: number;
  stride?: number;                  // side view: front leg forward offset
}

function drawFront(f: Frame, look: Look, p: Pose, back = false) {
  const bob = p.bob ?? 0, dx = p.dx ?? 0, X = (x: number) => x + dx;
  // legs
  const leg = (x0: number, lift: number) => {
    const top = 31, bottom = 43 - Math.max(0, lift) + Math.max(0, -lift);
    f.rect(X(x0), top + bob, 6, bottom - top + 1 - bob * 0, 'stone2'); f.rect(X(x0 + 4), top + bob, 2, bottom - top + 1, 'stone1'); f.rect(X(x0), top + 2 + bob, 1, bottom - top - 3, 'stone3');
    f.rect(X(x0 - 1), bottom + 1, 7, 2, 'ink3'); f.rect(X(x0 - 1), bottom + 3, 7, 1, 'steel1'); f.set(X(x0), bottom + 1, 'steel0');
  };
  leg(10, p.legL ?? 0); leg(17, p.legR ?? 0);
  // arms behind torso outline handled by draw order: arms first
  const sleeve = (x0: number, dy: number, right: boolean) => {
    f.rect(X(x0), 18 + dy + bob, 4, 11, 'blue1'); f.rect(X(right ? x0 + 3 : x0), 19 + dy + bob, 1, 10, 'blue0'); f.rect(X(x0), 18 + dy + bob, 4, 1, 'blue2');
    f.rect(X(x0), 28 + dy + bob, 4, 1, 'blue0'); f.rect(X(x0 + 0), 30 + dy + bob, 4, 3, 'skin2'); f.rect(X(x0 + 3 - (right ? 0 : 3)), 30 + dy + bob, 1, 3, 'skin1');
  };
  const armL = p.armL ?? 'down', armR = p.armR ?? 'down';
  const armFn = (kind: string, right: boolean) => {
    const x0 = right ? 23 : 5, sw = (right ? p.swingR : p.swingL) ?? 0;
    if (kind === 'down') sleeve(x0, sw, right);
    else if (kind === 'type') {
      f.rect(X(x0), 18 + bob, 4, 7, 'blue1'); f.rect(X(right ? x0 + 3 : x0), 19 + bob, 1, 6, 'blue0'); f.rect(X(x0), 18 + bob, 4, 1, 'blue2');
      const fx = right ? 17 : 8; f.rect(X(fx), 23 + bob, 7, 4, 'blue1'); f.rect(X(fx), 26 + bob, 7, 1, 'blue0');
      f.rect(X(right ? 16 : 14), 24 + bob + sw, 3, 3, 'skin2'); f.set(X(right ? 16 : 16), 26 + bob + sw, 'skin1');
    } else if (kind === 'up') {
      const ux = right ? 25 : 3; f.rect(X(ux), 9 + bob, 4, 10, 'blue1'); f.rect(X(right ? ux + 3 : ux), 10 + bob, 1, 9, 'blue0'); f.rect(X(ux), 5 + bob, 4, 4, 'skin2'); f.rect(X(right ? ux + 3 : ux), 5 + bob, 1, 4, 'skin1');
    } else if (kind === 'head') {
      const hx = right ? 22 : 7; f.rect(X(right ? 24 : 4), 12 + bob, 4, 8, 'blue1'); f.rect(X(right ? 27 : 4), 13 + bob, 1, 7, 'blue0'); f.rect(X(hx), 6 + bob, 3, 5, 'skin2'); f.rect(X(hx), 10 + bob, 3, 1, 'skin1');
    } else if (kind === 'think') {
      f.rect(X(24), 18 + bob, 4, 4, 'blue1'); f.rect(X(19), 19 + bob, 8, 3, 'blue1'); f.rect(X(19), 21 + bob, 8, 1, 'blue0'); f.rect(X(18), 15 + bob, 3, 5, 'skin2'); f.rect(X(20), 16 + bob, 1, 4, 'skin1');
    } else if (kind === 'gesture') {
      f.rect(X(23), 18 + bob, 4, 5, 'blue1'); f.rect(X(25), 14 + bob, 4, 6, 'blue1'); f.rect(X(26), 11 + bob, 3, 3, 'skin2');
    }
  };
  const late = (k: string) => k === 'type' || k === 'think' || k === 'gesture';
  if (!late(armL)) armFn(armL, false); if (!late(armR)) armFn(armR, true);
  // torso (hoodie)
  f.rect(X(9), 17 + bob, 14, 14, 'blue1'); f.rect(X(19), 18 + bob, 4, 13, 'blue0'); f.rect(X(10), 19 + bob, 1, 10, 'blue2'); f.rect(X(8), 17 + bob, 16, 2, 'blue1'); f.rect(X(8), 17 + bob, 16, 1, 'blue2');
  f.rect(X(9), 30 + bob, 14, 1, 'blue0'); f.rect(X(12), 25 + bob, 8, 1, 'blue0'); f.rect(X(12), 26 + bob, 1, 3, 'blue0'); f.rect(X(19), 26 + bob, 1, 3, 'blue0');
  if (!back) { f.rect(X(13), 16 + bob, 6, 3, 'blue0'); f.rect(X(14), 15 + bob, 4, 2, 'skin1'); f.set(X(14), 19 + bob, 'paper0'); f.set(X(14), 20 + bob, 'paper0'); f.set(X(17), 19 + bob, 'paper0'); f.set(X(17), 20 + bob, 'paper0'); f.set(X(14), 21 + bob, 'paper1'); f.set(X(17), 21 + bob, 'paper1'); }
  else { f.rect(X(10), 15 + bob, 12, 5, 'blue0'); f.rect(X(12), 16 + bob, 8, 3, 'blue1'); }
  if (late(armL)) armFn(armL, false); if (late(armR)) armFn(armR, true);
  // head
  const hy = 3 + bob;
  const rows = [[11, 20], [10, 21], [9, 22], [9, 22], [9, 22], [9, 22], [9, 22], [9, 22], [10, 21], [10, 21], [11, 20], [12, 19], [13, 18]]; // y 3..15
  rows.forEach(([a, b], i) => f.rect(X(a), hy + i, b - a + 1, 1, 'skin2'));
  rows.forEach(([a, b], i) => { if (i > 4) { f.rect(X(b - 2), hy + i, 3, 1, 'skin1'); f.set(X(a), hy + i, 'skin3'); } });
  if (!back) {
    f.rect(X(11), hy + 9, 6, 0, 'skin2');
    const eye = p.face === 'alarm' ? 3 : 2, ey = hy + 6 + (p.face === 'down' ? 1 : p.face === 'up' ? -1 : 0);
    f.rect(X(12), ey, 2, eye, 'ink1'); f.rect(X(18), ey, 2, eye, 'ink1'); f.set(X(12), ey, 'paper1'); f.set(X(18), ey, 'paper1');
    const by = p.face === 'focus' ? ey - 1 : ey - 2;
    if (p.face === 'focus') { f.rect(X(11), by, 3, 1, 'ink3'); f.rect(X(18), by, 3, 1, 'ink3'); f.set(X(13), by + 1, 'ink3'); f.set(X(18), by + 1, 'ink3'); } else { f.rect(X(12), by, 2, 1, 'skin0'); f.rect(X(18), by, 2, 1, 'skin0'); }
    f.rect(X(15), hy + 9, 2, 1, 'skin1');
    const my = hy + 11;
    if (p.face === 'talk') f.rect(X(14), my, 4, 2, 'red0'); else if (p.face === 'alarm') { f.rect(X(15), my, 2, 2, 'red0'); } else if (p.face === 'smile') { f.rect(X(13), my, 6, 1, 'red0'); f.set(X(13), my - 1, 'skin0'); f.set(X(18), my - 1, 'skin0'); } else f.rect(X(14), my, 4, 1, 'skin0');
    // messy hair: cap, fringe, sides
    f.rect(X(11), hy - 1, 10, 1, look.hair); f.rect(X(9), hy, 14, 3, look.hair); f.rect(X(9), hy + 3, 3, 3, look.hair); f.rect(X(20), hy + 3, 3, 3, look.hair);
    f.rect(X(12), hy + 3, 4, 1, look.hair); f.set(X(17), hy + 3, look.hair); f.set(X(9), hy + 6, look.hairLo); f.set(X(22), hy + 6, look.hairLo);
    f.rect(X(10), hy, 5, 1, look.hairHi); f.set(X(13), hy - 2, look.hair); f.set(X(18), hy - 2, look.hairLo); f.set(X(16), hy - 1, look.hairHi);
    f.rect(X(19), hy + 1, 4, 2, look.hairLo);
  } else {
    f.rect(X(11), hy - 1, 10, 1, look.hair); f.rect(X(9), hy, 14, 9, look.hair); f.rect(X(10), hy + 9, 12, 2, look.hair); f.rect(X(12), hy + 11, 8, 1, look.hair);
    f.rect(X(19), hy, 4, 9, look.hairLo); f.rect(X(10), hy, 4, 2, look.hairHi); f.set(X(13), hy - 2, look.hair);
  }
}

function drawSide(f: Frame, look: Look, p: Pose) {
  const bob = p.bob ?? 0, s = p.stride ?? 0;
  const leg = (x0: number, dx: number, lift: number, dark: boolean) => {
    const top = 31, bottom = 43 - lift;
    for (let y = top; y <= bottom; y++) { const k = Math.round(((y - top) / (bottom - top)) * dx); f.rect(x0 + k, y + (y > top ? 0 : bob), 6, 1, dark ? 'stone1' : 'stone2'); }
    f.rect(x0 + dx - 1, bottom + 1, 9, 2, 'ink3'); f.rect(x0 + dx - 1, bottom + 3, 9, 1, 'steel1');
  };
  leg(11, -s, 0, true);            // back leg
  f.rect(12, 17 + bob, 10, 14, 'blue1'); f.rect(12, 18 + bob, 2, 12, 'blue2'); f.rect(19, 18 + bob, 3, 12, 'blue0'); f.rect(12, 30 + bob, 10, 1, 'blue0');
  leg(13, s, Math.max(0, -s) / 2, false);
  // arm swings in x
  const ax = 14 + (p.swingR ?? 0) * 2; f.rect(ax, 18 + bob, 4, 11, 'blue1'); f.rect(ax + 3, 19 + bob, 1, 10, 'blue0'); f.rect(ax, 18 + bob, 4, 1, 'blue2'); f.rect(ax, 28 + bob, 4, 1, 'blue0'); f.rect(ax, 30 + bob, 4, 3, 'skin2'); f.rect(ax + 3, 30 + bob, 1, 3, 'skin1');
  f.rect(14, 15 + bob, 4, 3, 'skin1'); f.rect(13, 16 + bob, 6, 2, 'blue0');
  const hy = 3 + bob;
  [[12, 21], [11, 22], [11, 23], [11, 23], [11, 23], [11, 23], [11, 22], [11, 22], [12, 22], [12, 21], [13, 21], [13, 20], [14, 19]].forEach(([a, b], i) => f.rect(a, hy + i, b - a + 1, 1, 'skin2'));
  f.rect(20, hy + 5, 4, 1, 'skin2'); f.rect(23, hy + 7, 1, 2, 'skin2'); f.set(23, hy + 8, 'skin1');   // nose
  f.rect(21, hy + 6, 2, 2, 'ink1'); f.set(21, hy + 6, 'paper1'); f.rect(21, hy + 11, 2, 1, 'skin0');
  f.rect(12, hy - 1, 10, 3, look.hair); f.rect(10, hy, 6, 8, look.hair); f.rect(10, hy + 8, 4, 2, look.hairLo); f.rect(16, hy + 2, 6, 1, look.hair); f.rect(12, hy, 4, 1, look.hairHi); f.set(14, hy - 2, look.hair); f.set(19, hy - 2, look.hairLo);
  f.rect(15, hy + 6, 2, 3, 'skin1');
}

interface Row { name: string; fps: number; frames: Pose[]; }
const walkLegs = (a: number, b: number) => ({ legL: a, legR: b });
const ROWS: Row[] = [
  { name: 'idle', fps: 2, frames: [{}, { bob: 1, armL: 'down', armR: 'down' }] },
  { name: 'walk_down', fps: 8, frames: [
    { ...walkLegs(0, 0), swingL: 0, swingR: 0 }, { ...walkLegs(2, -1), bob: 1, swingL: -2, swingR: 2 }, { ...walkLegs(0, 0), swingL: 0, swingR: 0 }, { ...walkLegs(-1, 2), bob: 1, swingL: 2, swingR: -2 }] },
  { name: 'walk_up', fps: 8, frames: [
    { view: 'back', ...walkLegs(0, 0) }, { view: 'back', ...walkLegs(2, -1), bob: 1, swingL: 2, swingR: -2 }, { view: 'back', ...walkLegs(0, 0) }, { view: 'back', ...walkLegs(-1, 2), bob: 1, swingL: -2, swingR: 2 }] },
  { name: 'walk_side', fps: 8, frames: [
    { view: 'side', stride: 0, swingR: 0 }, { view: 'side', stride: 4, swingR: -1, bob: 1 }, { view: 'side', stride: 0, swingR: 0 }, { view: 'side', stride: -4, swingR: 1, bob: 1 }] },
  { name: 'type', fps: 6, frames: [{ armL: 'type', armR: 'type', face: 'down', swingL: 1, swingR: 0 }, { armL: 'type', armR: 'type', face: 'down', swingL: 0, swingR: 1 }] },
  { name: 'think', fps: 2, frames: [{ armR: 'think', face: 'up' }, { armR: 'think', face: 'up', bob: 1 }] },
  { name: 'talk', fps: 4, frames: [{ armR: 'gesture', face: 'talk' }, { armR: 'down', face: 'neutral' }] },
  { name: 'success', fps: 4, frames: [{ armL: 'up', armR: 'up', face: 'smile' }, { armL: 'up', armR: 'up', face: 'smile', bob: 1 }] },
  { name: 'failure', fps: 4, frames: [{ armL: 'head', armR: 'head', face: 'alarm', dx: -1 }, { armL: 'head', armR: 'head', face: 'alarm', dx: 1 }] },
];

export function renderSheet(variant: number): { w: number; h: number; px: (Name | null)[] } {
  const cols = 4, w = cols * FRAME_W, h = ROWS.length * FRAME_H, sheet = new Array<Name | null>(w * h).fill(null);
  ROWS.forEach((row, r) => row.frames.forEach((pose, c) => {
    const f = new Frame(); const look = LOOKS[variant % LOOKS.length]!;
    if (pose.view === 'side') drawSide(f, look, pose); else drawFront(f, look, pose, pose.view === 'back');
    f.outline('ink1'); f.shadow();
    for (let y = 0; y < FRAME_H; y++) for (let x = 0; x < FRAME_W; x++) sheet[(r * FRAME_H + y) * w + c * FRAME_W + x] = f.px[y * FRAME_W + x]!;
  }));
  return { w, h, px: sheet };
}

function crc32(buf: Buffer) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(type: string, data: Buffer) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export function encodePng(w: number, h: number, rgba: Uint8Array) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
export function sheetToRgba(s: { w: number; h: number; px: (Name | null)[] }) {
  const out = new Uint8Array(s.w * s.h * 4);
  s.px.forEach((n, i) => { if (!n) return; const hex = PALETTE[n]!; out[i * 4] = parseInt(hex.slice(1, 3), 16); out[i * 4 + 1] = parseInt(hex.slice(3, 5), 16); out[i * 4 + 2] = parseInt(hex.slice(5, 7), 16); out[i * 4 + 3] = 255; });
  return out;
}
export const META = { frame: { w: FRAME_W, h: FRAME_H, anchor: { x: 16, y: 45 } }, cols: 4, rows: Object.fromEntries(ROWS.map((r, i) => [r.name, { row: i, frames: r.frames.length, fps: r.fps }])) };

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const dir = path.join(root, 'ui/assets/chars'); mkdirSync(dir, { recursive: true });
  for (let v = 0; v < LOOKS.length; v++) { const s = renderSheet(v); writeFileSync(path.join(dir, `engineer-${v}.png`), encodePng(s.w, s.h, sheetToRgba(s))); }
  writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(META, null, 2) + '\n');
  console.log('wrote', LOOKS.length, 'sheets');
}
