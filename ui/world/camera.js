// Camera: position (world px at the viewport centre) is a float; rendering snaps it to whole device pixels.
export const ZOOMS = [1, 2, 3, 4, 5];
export function fitZoom(vw, vh, world) { return Math.max(1, Math.min(5, Math.floor(Math.min(vw / world.w, vh / world.h)))); }
export function clampCam(cam, world, vw, vh, z) {
  const hx = vw / z / 2, hy = vh / z / 2, m = 64;
  cam.x = Math.min(Math.max(cam.x, Math.min(world.w / 2, hx - m)), Math.max(world.w / 2, world.w - hx + m));
  cam.y = Math.min(Math.max(cam.y, Math.min(world.h / 2, hy - m)), Math.max(world.h / 2, world.h - hy + m));
}
/** Integer device-pixel offset so the world is drawn crisply at scale k. */
export function origin(cam, vwDev, vhDev, k) { return { ox: Math.round(vwDev / 2 - cam.x * k), oy: Math.round(vhDev / 2 - cam.y * k) }; }
export function zoomAt(cam, z, nz, mx, my, vw, vh) {   // keep the world point under the cursor fixed
  const wx = cam.x + (mx - vw / 2) / z, wy = cam.y + (my - vh / 2) / z;
  cam.x = wx - (mx - vw / 2) / nz; cam.y = wy - (my - vh / 2) / nz;
}
