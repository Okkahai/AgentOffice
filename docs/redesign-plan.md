# World-first frontend: technical plan

Goal: the pixel office is the interface. Dashboards become contextual drawers opened from objects in the world.
Game state stays a projection of real events; nothing here is authoritative.

## Findings from inspecting the current UI
- Renderer: Canvas 2D on a fixed 320 x 180 logical grid scaled 3x, five boxed rooms, agents drawn from 10 x 16 / 11 x 28 matrices.
- State: `ui/office-state.js` is a pure reducer (events in, scene out), tested in Node. It is reusable as is.
- Transport: `/api/state` (snapshot) and `/api/events` SSE (`event`, `output`). Cancel and rollback need the per-run token.
- Layout: canvas left, permanent tabbed dashboard right. This is the composition being replaced.
- Assets: AI-generated furniture and portraits, palette-normalized only loosely; scale not defined. Fixed by `docs/art-bible.md`.

## Technology decision
Canvas 2D stays for the world. The slice needs sprite animation, world coordinates, y-sorting, a camera and A* on a small grid, all of
which Canvas 2D handles with room to spare (one screen of sprites, under 200 draws per frame). PixiJS is not adopted now: it would add a
dependency and a build step without solving a problem we have. Re-evaluate if we need many hundreds of animated objects, particle
effects or shaders. React is also deferred: the overlay is a handful of drawers, plain DOM is enough, and the game loop must not depend
on a UI framework anyway. The seam is kept clean so either can be added later:
```
Game (canvas, own rAF loop)        Overlay (DOM drawers)
  world.js   coordinates, stations   inspector, terminal, task
  nav.js     A* on 8 px grid
  camera.js  integer-safe pan/zoom
  actors     sprite + path + state
     ^ explicit calls: sync(sceneState), select(id)      overlay -> game: focus(id)
     ^ ui/office-state.js reducer (unchanged)
```

## Vertical slice (this change)
`/slice.html`, separate from the current page so nothing is propagated before review.
One workstation area, one production-quality engineer sprite, A* walking, typing on arrival, camera pan/zoom, agent inspector, real terminal drawer.
The old dashboard page remains untouched.

## After approval
Propagate to manager, QA, release, backup, server zones and the remaining roles, replace `index.html`, move Tasks/Events/Merges/Backups into
drawers opened from the world, add diff and message actions, review the technology decision with real numbers.
