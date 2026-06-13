#!/usr/bin/env python3
"""Maakt een mask van een auto foto met rembg. Auto=opaque, achtergrond=transparant."""
import sys
from rembg import remove
from PIL import Image

orig = Image.open(sys.argv[1]).convert("RGBA")
cutout = remove(orig)
alpha = cutout.split()[3]
mask = Image.new("RGBA", orig.size, (0,0,0,0))
px = mask.load()
apx = alpha.load()
for x in range(orig.size[0]):
    for y in range(orig.size[1]):
        if apx[x,y] > 128:
            px[x,y] = (0,0,0,255)
        else:
            px[x,y] = (0,0,0,0)
mask.save(sys.argv[2], "PNG")
print("OK")
