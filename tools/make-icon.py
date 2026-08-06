#!/usr/bin/env python3
"""Generate sce_sys/icon0.png - a simple Stremio-style launcher icon.
Usage: python3 tools/make-icon.py   (writes sce_sys/icon0.png)
You can of course drop any 512x512 PNG named icon0.png in sce_sys/ instead."""
import struct, zlib, os

W = H = 512
BG = (123, 22, 255)      # Stremio purple
FG = (255, 255, 255)
A, B, C = (150, 140), (150, 372), (392, 256)   # play triangle

def in_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0]-p3[0])*(p2[1]-p3[1]) - (p2[0]-p3[0])*(p1[1]-p3[1])
    d1, d2, d3 = sign((px,py), a, b), sign((px,py), b, c), sign((px,py), c, a)
    neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (neg and pos)

def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

def png_bytes():
    raw = b""
    for y in range(H):
        raw += b"\x00"                       # filter: none
        for x in range(W):
            c = FG if in_triangle(x, y, A, B, C) else BG
            raw += bytes(c)
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 6, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

def main():
    out = os.path.join(os.path.dirname(__file__), "..", "sce_sys", "icon0.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "wb") as f:
        f.write(png_bytes())
    print("wrote", os.path.abspath(out))

if __name__ == "__main__":
    main()