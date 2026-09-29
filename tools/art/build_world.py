"""Normalize AI-generated furniture (assets/src/furniture.png) to the art bible.
Pipeline: crop -> remove background -> scale to native size -> palette normalize -> alpha cleanup -> write ui/assets/world.
Run: python3 tools/art/build_world.py   (needs Pillow, numpy, scipy; dev-time only)
"""
import json, pathlib
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = pathlib.Path(__file__).resolve().parents[2]
PAL = json.loads((ROOT / 'tools/art/palette.json').read_text())
PAL_RGB = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in PAL.values()])
SRC = Image.open(ROOT / 'assets/src/furniture.png').convert('RGB')
BG = np.array([10, 11, 13])
OUT = ROOT / 'ui/assets/world'; OUT.mkdir(parents=True, exist_ok=True)

# name: (source box, native size (w, h) or None to keep aspect at a target height, has_bg_removal)
ITEMS = {
    'desk':   ((352, 50, 612, 275), (38, 32), True),
    'rack':   ((883, 38, 1020, 278), (27, 48), True),
    'plant':  ((1075, 55, 1228, 272), (18, 25), True),
    'shelf':  ((45, 305, 265, 500), (44, 38), True),
    'frame':  ((430, 528, 588, 672), (20, 18), True),
    'floor':  ((318, 322, 518, 486), (32, 24), False),
    'wall':   ((84, 528, 360, 670), (32, 24), False),
}

def snap(rgb):
    d = ((rgb[:, :, None, :].astype(int) - PAL_RGB[None, None, :, :]) ** 2).sum(-1)
    return PAL_RGB[d.argmin(-1)]

def synth_floor():
    # 32x24 worn stone tile built straight from the palette (AI floor crops were too noisy to match the bible)
    import random
    rnd = random.Random(7); P = {k: [int(v[i:i + 2], 16) for i in (1, 3, 5)] for k, v in PAL.items()}
    a = np.zeros((24, 32, 4), np.uint8); a[:, :, 3] = 255
    for y in range(24):
        for x in range(32):
            c = 'stone1'
            r = rnd.random()
            if r < 0.10: c = 'stone2'
            elif r < 0.14: c = 'stone0'
            if x == 0 or y == 0: c = 'stone0'           # joint
            elif x == 1 or y == 1: c = 'stone2'         # lit edge (light from upper left)
            a[y, x, :3] = P[c]
    Image.fromarray(a, 'RGBA').save(OUT / 'floor.png'); print('floor synth')

synth_floor()
for name, (box, size, cut) in ITEMS.items():
    if name == 'floor': continue
    im = SRC.crop(box); a = np.array(im).astype(int)
    alpha = np.full(a.shape[:2], 255, np.uint8)
    if cut:
        bg = np.abs(a - BG).sum(2) <= 14
        lab, _ = ndi.label(bg)
        border = set(lab[0]) | set(lab[-1]) | set(lab[:, 0]) | set(lab[:, -1]); border.discard(0)
        m = np.isin(lab, list(border)); alpha[m] = 0
        ys, xs = np.where(~m); crop = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        im = im.crop(crop); alpha = alpha[crop[1]:crop[3], crop[0]:crop[2]]
    rgba = im.convert('RGBA'); rgba.putalpha(Image.fromarray(alpha))
    small = rgba.resize(size, Image.BOX)
    arr = np.array(small); arr[:, :, 3] = np.where(arr[:, :, 3] > 127, 255, 0)
    arr[:, :, :3] = snap(arr[:, :, :3]).astype(np.uint8)
    arr[arr[:, :, 3] == 0, :3] = 0
    Image.fromarray(arr, 'RGBA').save(OUT / f'{name}.png'); print(name, size)
