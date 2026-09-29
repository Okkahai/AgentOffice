import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, findPath } from '../ui/world/nav.js';
import { DESKS, ENTRANCE, WANDER, WORLD, obstacles } from '../ui/world/world.js';

const g = buildGrid();
const inside = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

test('every desk seat is reachable from the entrance and the path avoids obstacles', () => {
  for (const d of DESKS) {
    const path = findPath(g, ENTRANCE, d.seat);
    assert.ok(path, `desk ${d.id} reachable`);
    assert.deepEqual(path.at(-1), d.seat);
    for (const p of path.slice(0, -1)) for (const o of obstacles()) assert.ok(!inside(p, o), `waypoint (${p.x},${p.y}) inside obstacle`);
  }
});

test('no path is invented into a blocked cell', () => {
  assert.equal(findPath(g, ENTRANCE, { x: DESKS[0].x + 10, y: DESKS[0].y + 26 }), null);
});

test('the walk to a desk is a real walk, not a teleport', () => {
  const path = findPath(g, ENTRANCE, DESKS[3].seat)!;
  assert.ok(path.length > 5);
  for (let i = 1; i < path.length; i++) assert.ok(Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.y - path[i - 1]!.y) < 14);
});

test('idle wander area and entrance lie inside the world', () => {
  assert.ok(WANDER.x1 < WORLD.w && WANDER.y1 < WORLD.h && ENTRANCE.y < WORLD.h);
});
