#!/usr/bin/env python3
# car_studio.py — EERLIJKE auto-studio. Isoleer hoofdauto (SAM auto-punt), composit op
# studio-achtergrond + grond-schaduw. Auto-pixels worden NOOIT gegenereerd -> schades echt.
import sys, numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage
from rembg import remove, new_session

CANVAS_W, CANVAS_H = 1200, 800
_SAM = None
def sam():
    global _SAM
    if _SAM is None: _SAM = new_session("sam")
    return _SAM

def largest_cc(mask):
    lab, n = ndimage.label(mask)
    if n == 0: return mask
    sizes = ndimage.sum(mask, lab, range(1, n+1))
    return lab == (int(np.argmax(sizes)) + 1)

def auto_point(img):
    a = np.array(remove(img).convert("RGBA"))[:, :, 3] > 128   # coarse rembg
    keep = largest_cc(a); ys, xs = np.where(keep)
    return int(xs.mean()), int(ys.mean())

def _sam_mask(img, px, py):
    out = remove(img, session=sam(), sam_prompt=[{"type":"point","data":[int(px),int(py)],"label":1}])
    return np.array(out.convert("RGBA"))[:, :, 3] > 128

def isolate(src):
    img = Image.open(src).convert("RGB"); W, H = img.size
    # coarse mask -> bbox van de voorgrond (waar de auto's staan)
    coarse = np.array(remove(img).convert("RGBA"))[:, :, 3] > 128
    cc = largest_cc(coarse); ys, xs = np.where(cc)
    x0,x1,y0,y1 = xs.min(), xs.max(), ys.min(), ys.max()
    bw, bh = x1-x0, y1-y0
    # kandidaat-punten laag+centraal op de hoofdauto (geeft hele auto i.p.v. paneel)
    cands = [(x0+bw*fx, y0+bh*fy) for fx,fy in
             [(0.40,0.62),(0.50,0.66),(0.33,0.58),(0.45,0.72),(0.55,0.60)]]
    best = None; bestpt = None
    for (px,py) in cands:
        m = _sam_mask(img, px, py)
        m = largest_cc(ndimage.binary_fill_holes(m))
        area = int(m.sum())
        # negeer maskers die bijna het hele frame vullen (achtergrond-vangst)
        if area > 0.92*W*H: continue
        if best is None or area > best[0]:
            best = (area, m); bestpt = (int(px),int(py))
    m = best[1]
    rgba = np.array(img.convert("RGBA"))
    rgba[:, :, 3] = np.where(m, 255, 0).astype(np.uint8)
    ys, xs = np.where(m)
    return Image.fromarray(rgba).crop((xs.min(), ys.min(), xs.max()+1, ys.max()+1)), bestpt

def studio_bg(w, h):
    ramp = np.zeros((h, 3))
    for y in range(h):
        t = y / h
        if t < 0.56:
            f = t/0.56; ramp[y] = [244+(236-244)*f, 246+(239-246)*f, 249+(243-249)*f]
        else:
            f = (t-0.56)/0.44; ramp[y] = [217+(188-217)*f, 222+(195-222)*f, 228+(204-228)*f]
    return Image.fromarray(np.repeat(ramp[:, None, :], w, 1).astype(np.uint8), "RGB")

def compose(car, out):
    cw, ch = car.size
    s = min(CANVAS_W*0.84/cw, CANVAS_H*0.74/ch)
    nw, nh = int(cw*s), int(ch*s)
    car = car.resize((nw, nh), Image.LANCZOS)
    left = (CANVAS_W-nw)//2
    top = max(0, int(CANVAS_H*0.82)-nh)
    shadow = Image.new("RGBA", (CANVAS_W, CANVAS_H), (0,0,0,0))
    ImageDraw.Draw(shadow).ellipse(
        [left+int(nw*0.04), top+nh-int(nh*0.06), left+nw-int(nw*0.04), top+nh+int(nh*0.06)],
        fill=(0,0,0,95))
    shadow = shadow.filter(ImageFilter.GaussianBlur(24))
    base = Image.alpha_composite(studio_bg(CANVAS_W, CANVAS_H).convert("RGBA"), shadow)
    base.alpha_composite(car, (left, top))
    base.convert("RGB").save(out, quality=92)

if __name__ == "__main__":
    car, pt = isolate(sys.argv[1])
    compose(car, sys.argv[2])
    print(f"OK -> {sys.argv[2]} (auto-punt {pt})")
