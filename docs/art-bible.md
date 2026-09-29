# Agent Office art bible (v0, vertical slice)

Every sprite and every environment asset must satisfy this document before it enters `ui/assets/world` or `ui/assets/chars`.
The rules are checked by `test/art.test.ts` where they can be automated. Assets that break a rule are normalized or rejected, never
patched at runtime with CSS filters.

## Native resolution and scaling
| Item | Rule |
|---|---|
| Native reference viewport | 480 x 270 native pixels (16:9). The world is larger than the viewport and scrolls. |
| Render scale | Integer only. `k = round(zoom * devicePixelRatio)`, zoom in {1..5}. Canvas backing store equals CSS size times DPR. |
| Sprite drawing | `imageSmoothingEnabled = false`, sprites drawn at integer world coordinates, never fractional scale or rotation. |
| Camera | Position stored as a float, applied as integer device pixels, so pans never blur. |
| CSS | `image-rendering: pixelated` on the canvas. No CSS scaling of sprites. |

## Perspective and light
- Oblique 3/4 top-down (RPG "front + top" view). Furniture shows its front face and top surface. Floors are 32 x 24 tiles (4:3).
- Key light from the upper left, warm. Shadows fall down and right. One lower-contrast cool fill from the right.
- Depth ordering: everything is sorted by its foot / base y.

## Scale
- 1 metre is about 26 native pixels.
- Character frame 32 x 48, figure about 44 px tall (1.7 m), feet anchored at frame (16, 45).
- Desk with monitor: 38 x 32. Server rack: 27 x 48. Plant: 18 x 25. Wall shelf: 44 x 38. Door opening: 32 x 44.
- Walking speed 40 native px/s (about 1.5 m/s).

## Pixel density and outline
- One pixel density everywhere: no sprite may be authored at another scale and resized in the engine.
- 1 px dark warm outline on characters. Furniture keeps its own darker edge pixels; no anti-aliasing, alpha is 0 or 255.
- Three tones per material (shadow, base, light) plus one highlight pixel where it helps.

## Palette
One master palette of at most 48 colors, defined in `tools/art/palette.json` and mirrored in `scripts/gen-sprites.ts`.
Dark, warm, earthy: wood browns, brick reds, cool dark stone for floors, muted blue/green/purple cloth, skin ramp,
amber for fire and light. Accents are rare and semantic: amber = active/merge, green = ok, red = failure.
Generated art is palette-normalized (nearest colour) before import.

## Characters
- Human proportions: head 12 px, torso 15 px, legs 14 px.
- Roles are told apart by clothing, hair and accessories, never by big labels. Engineer: hoodie, messy hair. Manager: blazer, hair bun.
  QA: lab coat, glasses.
- Views: front, back, side (left is the mirrored right). Animations: idle, walk, type, think, talk, success, failure.
- FPS: idle 2, walk 8 (4 frames), type 6, think 2, talk 4, success 4, failure 4.
- Sheet layout is described by `ui/assets/chars/meta.json`.

## Import pipeline
1. GENERATE (ElevenLabs or code). 2. INSPECT. 3. REMOVE BACKGROUND. 4. CROP. 5. SCALE to native size (box filter).
6. PALETTE NORMALIZE. 7. PIXEL CLEANUP (alpha threshold, lone-pixel removal). 8. SLICE. 9. VALIDATE (`npm test`). 10. IMPORT.
Tools: `tools/art/build_world.py` (furniture and floors from `assets/src/furniture.png`), `scripts/gen-sprites.ts` (character sheets).

## Rejected on sight
Mixed pixel densities, anti-aliased edges, sprites with more than 48 colours, characters not 32 x 48, furniture that breaks the
scale table, glow or blur baked in to hide a mismatch.
