# Art bible

Every sprite and environment asset in the world view must satisfy this document.

## Rendering
| Rule | Value |
|---|---|
| Native pixel density | 16 px tiles (LimeZu Modern Interiors / Modern Office, 16x16 variants). One density everywhere, no resizing in the engine. |
| Characters | 16 x 32 cell (about 22 px of figure), feet anchor at (8, 31). Idle and run strips with 6 frames per direction (right, up, left, down). |
| Reference viewport | 480 x 270 native px, integer scale `k = round(zoom * DPR)`, zoom 1..5. |
| Sprite drawing | `imageSmoothingEnabled = false`, integer world coordinates, no rotation. Canvas has `image-rendering: pixelated`. |
| Camera | Float position, applied as whole device pixels. |
| Perspective | Oblique 3/4 top-down, light from the upper left. Depth sorting by foot y. |
| Walk speed | 40 px/s, A* on an 8 px grid. |

## Look
Dark floor carpet, lavender brick wall, warm wood desks, cool blue screens. Screens and typing glow are the only bright accents, so activity reads at a glance.
New props come from the same two packs. Do not mix in art from other authors: other packs differ in scale and palette.

## What is drawn in code
Only state feedback: the scrolling green lines on a screen while an agent really types, the selection ring, the shadow, the success hop and the failure shiver.

## Source and licence
See `docs/limezu-assets.md`. The pack files are not committed.
