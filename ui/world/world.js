// World layout in native pixels (see docs/art-bible.md). Pure data + helpers, shared by the game and the tests.
export const CELL = 8;
export const WORLD = { w: 448, h: 264, wallH: 72 };
export const ENTRANCE = { x: 40, y: 252 };

const DESK_W = 38, DESK_H = 32, DESK_BASE = 140;
export const DESKS = [96, 156, 216, 276].map((x, i) => ({
  id: i, x, y: DESK_BASE - DESK_H, w: DESK_W, h: DESK_H, base: DESK_BASE,
  seat: { x: x + DESK_W / 2, y: DESK_BASE - 13 },                        // feet position of whoever works here
  monitor: { x: x + 6, y: DESK_BASE - DESK_H + 2, w: 18, h: 9 },
  footprint: { x: x + 1, y: DESK_BASE - 12, w: DESK_W - 2, h: 12 },
}));
export const DECOR = {
  shelf: { x: 28, y: 34, w: 44, h: 38, base: 72 },
  frame: { x: 132, y: 22, w: 20, h: 18 },
  rack: { x: 380, y: 24, w: 27, h: 48, base: 72 },
  plant: { x: 18, y: 176, w: 18, h: 25, base: 201, footprint: { x: 20, y: 194, w: 14, h: 7 } },
  plant2: { x: 404, y: 200, w: 18, h: 25, base: 225, footprint: { x: 406, y: 218, w: 14, h: 7 } },
};
export const WANDER = { x0: 60, y0: 176, x1: 400, y1: 246 };            // open floor where idle agents may stroll

export function obstacles() {
  const o = [{ x: 0, y: 0, w: WORLD.w, h: WORLD.wallH + 8 }];             // wall band
  for (const d of DESKS) o.push(d.footprint);
  o.push(DECOR.plant.footprint, DECOR.plant2.footprint, { x: DECOR.rack.x, y: 60, w: DECOR.rack.w, h: 20 });
  return o;
}
