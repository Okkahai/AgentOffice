// World layout in native pixels (LimeZu 16 px art, see docs/art-bible.md). Pure data + helpers, shared by the game and the tests.
// Sprite rects ([x, y, w, h]) point into ui/assets/limezu/office/Modern_Office_16x16.png.
export const CELL = 8;
export const WORLD = { w: 448, h: 264, wallH: 50 };
export const ENTRANCE = { x: 40, y: 252 };

const DESK = { w: 41, h: 23, base: 119 };
const DESK_SPRITES = [[66, 489, 41, 23], [114, 489, 41, 23]];
const WORKSTATION = [[164, 481, 37, 23], [164, 513, 37, 23]];   // desk-top PC kit, drawn 2 px right / 3 px up on the desk
export const DESKS = [40, 120, 200, 280].map((x, i) => ({
  id: i, x, y: DESK.base - DESK.h, w: DESK.w, h: DESK.h, base: DESK.base,
  desk: DESK_SPRITES[i % 2], kit: WORKSTATION[i % 2],
  seat: { x: x + 20, y: DESK.base + 14 },                                    // feet position of whoever works here
  monitor: { x: x + 18, y: DESK.base - DESK.h + 6, w: 9, h: 5 },             // laptop screen inside the kit sprite
  footprint: { x: x + 1, y: DESK.base - 15, w: DESK.w - 2, h: 15 },
}));
export const DECOR = {
  board: { s: [145, 199, 30, 23], x: 150, y: 16 },
  poster: { s: [4, 199, 24, 20], x: 60, y: 18 },
  pin: { s: [241, 40, 14, 17], x: 232, y: 20 },
  photo: { s: [241, 8, 14, 17], x: 276, y: 20 },
  shelf: { s: [113, 200, 30, 30], x: 326, y: 20 },
  rack: { s: [5, 373, 23, 34], x: 396, y: 16, w: 23, h: 34, base: 52 },
  cooler: { s: [193, 248, 14, 30], x: 372, y: 148, w: 14, h: 30, base: 178, footprint: { x: 372, y: 168, w: 14, h: 10 } },
  plant: { s: [96, 122, 16, 28], x: 16, y: 150, w: 16, h: 28, base: 178, footprint: { x: 18, y: 170, w: 12, h: 8 } },
  plant2: { s: [96, 122, 16, 28], x: 412, y: 206, w: 16, h: 28, base: 234, footprint: { x: 414, y: 226, w: 12, h: 8 } },
  sofa: { s: [1, 276, 31, 24], x: 330, y: 214, w: 31, h: 24, base: 238, footprint: { x: 330, y: 224, w: 31, h: 14 } },
};
export const WANDER = { x0: 60, y0: 150, x1: 320, y1: 246 };               // open floor where idle agents may stroll

export function obstacles() {
  const o = [{ x: 0, y: 0, w: WORLD.w, h: WORLD.wallH + 4 }];                // wall band
  for (const d of DESKS) o.push(d.footprint);
  for (const k of ['plant', 'plant2', 'cooler', 'sofa']) o.push(DECOR[k].footprint);
  o.push({ x: DECOR.rack.x, y: 40, w: DECOR.rack.w, h: 20 });
  return o;
}
