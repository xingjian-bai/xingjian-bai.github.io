#!/usr/bin/env python3
"""Turn the piggy-duck DALLE image into a full-color favicon / site mark.

Output:
  img/favicon.png            32x32
  img/favicon-192.png       192x192
  img/apple-touch-icon.png  180x180
  img/mark.png               512x512
  favicon.ico                (site root; 16/32/48 — browsers request this by default)
"""
import sys
from pathlib import Path
from PIL import Image, ImageOps

SRC = Path("img/DALL·E 2023-02-03 15.32.36 - an animal called piggy duck, digital art.png")
INK_BLUE = (31, 58, 95)
CREAM    = (250, 250, 247)

def duotone(img: Image.Image, shadow, highlight) -> Image.Image:
    g = ImageOps.grayscale(img)
    palette = []
    for i in range(256):
        t = i / 255.0
        r = int(shadow[0] * (1 - t) + highlight[0] * t)
        gv = int(shadow[1] * (1 - t) + highlight[1] * t)
        b = int(shadow[2] * (1 - t) + highlight[2] * t)
        palette.extend((r, gv, b))
    duo = g.convert("P")
    duo.putpalette(palette)
    return duo.convert("RGB")

def center_square(img: Image.Image) -> Image.Image:
    w, h = img.size
    s = min(w, h)
    left = (w - s) // 2
    top = (h - s) // 2
    return img.crop((left, top, left + s, top + s))

def main():
    if not SRC.exists():
        print(f"source not found: {SRC}", file=sys.stderr)
        sys.exit(1)
    img = Image.open(SRC).convert("RGB")
    sq = center_square(img)
    sq = sq.resize((512, 512), Image.LANCZOS)
    duo = sq  # keep the original full-color art (duotone() kept below but unused)

    out_dir = Path("img")
    duo.resize((32, 32), Image.LANCZOS).save(out_dir / "favicon.png", optimize=True)
    duo.resize((192, 192), Image.LANCZOS).save(out_dir / "favicon-192.png", optimize=True)
    duo.resize((180, 180), Image.LANCZOS).save(out_dir / "apple-touch-icon.png", optimize=True)
    duo.resize((512, 512), Image.LANCZOS).save(out_dir / "mark.png", optimize=True)
    # Root /favicon.ico: browsers request this implicitly for the tab icon
    # regardless of <link rel="icon">. Multi-size so it stays crisp.
    duo.save(Path("favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)])
    print("wrote favicon.png, favicon-192.png, apple-touch-icon.png, mark.png, favicon.ico")

if __name__ == "__main__":
    main()
