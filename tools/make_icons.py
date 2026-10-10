"""Writes the app icons (PNG, stdlib only): icon-192.png, icon-512.png, apple-touch-icon.png.

A white calendar sheet on the accent colour. Run from anywhere: python3 tools/make_icons.py
Colours are the --accent and --accent-text tokens of index.html; change both together.
"""
import struct
import zlib
from pathlib import Path

ACCENT, DEEP, WHITE = (0xC0, 0x26, 0xD3), (0x86, 0x19, 0x8F), (255, 255, 255)
SIZES = {"icon-192.png": 192, "icon-512.png": 512, "apple-touch-icon.png": 180}
AA = 2  # AA x AA samples per pixel: smooth rounded corners, still a second or two


def inside(x, y, x0, y0, x1, y1, r=0.0):
    """Point in the (rounded) rect; everything is in 0..1 canvas units."""
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx, cy = min(max(x, x0 + r), x1 - r), min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def color(x, y):
    """The icon at one point. Glyph spans 0.22..0.78, inside the maskable safe zone."""
    for sx in (0.33, 0.61):  # binding rings, poking above the sheet
        if inside(x, y, sx, 0.20, sx + 0.06, 0.34, 0.03):
            return WHITE
    if not inside(x, y, 0.22, 0.27, 0.78, 0.78, 0.05):
        return ACCENT
    if y < 0.41:
        return DEEP  # header band
    for col in range(3):  # days: 3 x 2 squares
        for row in range(2):
            x0, y0 = 0.29 + col * 0.16, 0.48 + row * 0.15
            if inside(x, y, x0, y0, x0 + 0.10, y0 + 0.10, 0.02):
                return ACCENT
    return WHITE


def png(size):
    rows = []
    for j in range(size):
        row = bytearray([0])  # filter type: none
        for i in range(size):
            px = [color((i + (a + .5) / AA) / size, (j + (b + .5) / AA) / size) for a in range(AA) for b in range(AA)]
            row += bytes(round(sum(c[k] for c in px) / len(px)) for k in range(3))
        rows.append(bytes(row))

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit RGB, opaque
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")


if __name__ == "__main__":
    out = Path(__file__).resolve().parent.parent
    for name, size in SIZES.items():
        (out / name).write_bytes(png(size))
        print(name, size)
