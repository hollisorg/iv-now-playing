# Turns a generated icon picture into the app's icon files, using IV Switchboard's exact tile shape
# (1024 canvas, tile 37..987, its rounded mask) so every IV app icon lines up.
#   python scripts/make-icon.py <generated.png> <switchboard icon.png>
import sys
from pathlib import Path

import numpy as np
from PIL import Image

root = Path(__file__).resolve().parent.parent
src = Image.open(sys.argv[1]).convert('RGBA')
mask = Image.open(sys.argv[2]).convert('RGBA').getchannel('A')

# Find the generated tile: the area that isn't the plain outside background.
a = np.asarray(src).astype(int)
corner = a[4, 4, :3]
diff = np.abs(a[..., :3] - corner).max(axis=2)
ys, xs = np.where(diff > 40)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
side = max(x1 - x0, y1 - y0) + 1
cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
tile = src.crop((round(cx - side / 2), round(cy - side / 2), round(cx + side / 2), round(cy + side / 2)))

box = mask.getbbox()  # (37, 37, 987, 987) for Switchboard
out = Image.new('RGBA', mask.size, (0, 0, 0, 0))
out.paste(tile.resize((box[2] - box[0], box[3] - box[1]), Image.LANCZOS), box[:2])
out.putalpha(mask)

build = root / 'build'
out.save(build / 'icon-source.png')
out.save(build / 'icon.png')
out.save(build / 'icon.ico', sizes=[(s, s) for s in (16, 20, 24, 32, 40, 48, 64, 128, 256)])
out.resize((32, 32), Image.LANCZOS).save(build / 'tray.png')
qa = root / 'qa' / 'icon-art'
for s in (16, 32, 256):
    out.resize((s, s), Image.LANCZOS).save(qa / f'final-{s}.png')
print('tile', (x0, y0, x1, y1), '->', box)
