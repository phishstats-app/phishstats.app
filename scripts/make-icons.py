#!/usr/bin/env python3
"""Draws the site icon (a red fish with ripples on the site's dark ground) with
Pillow and writes the PNG sizes browsers and iOS ask for. assets/icon.svg is
the same drawing by hand; keep the two in step if the mark changes.

    python scripts/make-icons.py

Outputs into assets/: icon-32.png, icon-192.png, icon-512.png (square, full
bleed, the manifest icons) and apple-touch-icon.png (180, opaque: iOS rounds
the corners itself).
"""
import os
from PIL import Image, ImageDraw

BG, RED, INK, GOLD = '#15121c', '#e4572e', '#f3ecdf', '#f0b640'
S = 1024  # drawing size; everything else is a downscale
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'assets')


def draw(rounded):
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if rounded:
        d.rounded_rectangle((0, 0, S - 1, S - 1), radius=220, fill=BG)
    else:
        d.rectangle((0, 0, S, S), fill=BG)
    # Ripples: three gold arcs in front of the fish, as if it just spoke.
    for r in (70, 125, 180):
        d.arc((200 - r, 512 - r, 200 + r, 512 + r), start=145, end=215, fill=GOLD, width=22)
    # Body and a swept tail.
    d.ellipse((250, 332, 790, 692), fill=RED)
    d.polygon([(730, 512), (940, 335), (895, 512), (940, 689)], fill=RED)
    # Eye.
    d.ellipse((372 - 40, 468 - 40, 372 + 40, 468 + 40), fill=INK)
    d.ellipse((384 - 17, 470 - 17, 384 + 17, 470 + 17), fill=BG)
    return im


def save(im, name, size, opaque):
    out = im.resize((size, size), Image.LANCZOS)
    if opaque:
        flat = Image.new('RGB', out.size, BG)
        flat.paste(out, mask=out.split()[3])
        out = flat
    out.save(os.path.join(OUT, name), optimize=True)
    print(name, size)


square = draw(rounded=False)
save(square, 'icon-512.png', 512, True)
save(square, 'icon-192.png', 192, True)
save(square, 'apple-touch-icon.png', 180, True)
save(draw(rounded=True), 'icon-32.png', 32, False)
