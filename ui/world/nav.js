// Grid navigation: 8 px cells, 8-connected A*, no corner cutting. Small on purpose; this is not a game engine.
import { CELL, WORLD, obstacles } from './world.js';

export function buildGrid(rects = obstacles()) {
  const cols = Math.ceil(WORLD.w / CELL), rows = Math.ceil(WORLD.h / CELL), blocked = new Uint8Array(cols * rows);
  for (const r of rects) for (let cy = Math.floor(r.y / CELL); cy < Math.ceil((r.y + r.h) / CELL); cy++)
    for (let cx = Math.floor(r.x / CELL); cx < Math.ceil((r.x + r.w) / CELL); cx++) if (cx >= 0 && cy >= 0 && cx < cols && cy < rows) blocked[cy * cols + cx] = 1;
  return { cols, rows, blocked };
}
const cellOf = (g, p) => [Math.min(g.cols - 1, Math.max(0, Math.floor(p.x / CELL))), Math.min(g.rows - 1, Math.max(0, Math.floor(p.y / CELL)))];
const free = (g, x, y) => x >= 0 && y >= 0 && x < g.cols && y < g.rows && !g.blocked[y * g.cols + x];

/** Returns waypoints in world px from `from` to `to` (exact end point kept), or null if unreachable. */
export function findPath(g, from, to) {
  const [sx, sy] = cellOf(g, from), [tx, ty] = cellOf(g, to);
  if (!free(g, tx, ty)) return null;
  const key = (x, y) => y * g.cols + x, open = [[0, sx, sy]], came = new Map(), cost = new Map([[key(sx, sy), 0]]);
  const h = (x, y) => Math.max(Math.abs(x - tx), Math.abs(y - ty)) + 0.41 * Math.min(Math.abs(x - tx), Math.abs(y - ty));
  while (open.length) {
    open.sort((a, b) => a[0] - b[0]);
    const [, x, y] = open.shift();
    if (x === tx && y === ty) {
      const pts = [{ x: to.x, y: to.y }]; let k = key(x, y);
      while (came.has(k)) { const p = came.get(k); const px = p % g.cols, py = Math.floor(p / g.cols); if (!(px === sx && py === sy)) pts.unshift({ x: px * CELL + CELL / 2, y: py * CELL + CELL / 2 }); k = p; }
      return pts;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!free(g, nx, ny) || (dx && dy && (!free(g, x + dx, y) || !free(g, x, y + dy)))) continue;
      const c = cost.get(key(x, y)) + (dx && dy ? 1.41 : 1);
      if (c < (cost.get(key(nx, ny)) ?? Infinity)) { cost.set(key(nx, ny), c); came.set(key(nx, ny), key(x, y)); open.push([c + h(nx, ny), nx, ny]); }
    }
  }
  return null;
}
