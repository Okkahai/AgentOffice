// Automated part of docs/art-bible.md: sizes, alpha, palette membership.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const PAL = new Set(Object.values(JSON.parse(readFileSync(path.join(root, 'tools/art/palette.json'), 'utf8'))) as string[]);

function decode(file: string) {
  const buf = readFileSync(file); let o = 8, w = 0, h = 0, ct = 0; const idat: Buffer[] = [];
  while (o < buf.length) { const len = buf.readUInt32BE(o), type = buf.toString('ascii', o + 4, o + 8), d = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]!; } if (type === 'IDAT') idat.push(d); o += 12 + len; }
  assert.equal(ct, 6, 'RGBA expected'); const raw = inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) { const f = raw[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) { const v = raw[y * (stride + 1) + 1 + x]!, a = x >= bpp ? out[y * stride + x - bpp]! : 0, b = y ? out[(y - 1) * stride + x]! : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      out[y * stride + x] = (v + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255; } }
  return { w, h, px: out };
}
const hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
function check(file: string) {
  const { w, h, px } = decode(file); const seen = new Set<string>();
  for (let i = 0; i < w * h; i++) { const a = px[i * 4 + 3]!; assert.ok(a === 0 || a === 255, `${file}: anti-aliased alpha`); if (a) { const c = hex(px[i * 4]!, px[i * 4 + 1]!, px[i * 4 + 2]!); assert.ok(PAL.has(c), `${path.basename(file)}: ${c} not in palette`); seen.add(c); } }
  return { w, h, colors: seen.size };
}

test('palette has at most 48 colours', () => assert.ok(PAL.size <= 48));

test('character sheets: 32x48 frames, animation rows match meta, palette only', () => {
  const dir = path.join(root, 'ui/assets/chars'), meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  assert.deepEqual([meta.frame.w, meta.frame.h], [32, 48]);
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.png'))) {
    const r = check(path.join(dir, f));
    assert.equal(r.w, meta.cols * 32); assert.equal(r.h, Object.keys(meta.rows).length * 48);
  }
  for (const a of ['idle', 'walk_down', 'walk_up', 'walk_side', 'type', 'think', 'talk', 'success', 'failure']) assert.ok(meta.rows[a], `animation ${a}`);
});

test('world assets match the scale table and palette', () => {
  const dir = path.join(root, 'ui/assets/world'), want: Record<string, [number, number]> = { desk: [38, 32], rack: [27, 48], plant: [18, 25], shelf: [44, 38], floor: [32, 24], wall: [32, 24] };
  for (const [n, [w, h]] of Object.entries(want)) { const r = check(path.join(dir, `${n}.png`)); assert.deepEqual([r.w, r.h], [w, h], n); }
});
