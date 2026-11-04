"""Import stickers from Ares's chibi library into the button (read-only source).

    uv run --with numpy --with pillow --with scipy python3 tools/avatar/import_library.py [--sheet]
    (--sheet also writes contact sheets for review; scipy only makes it fast)

Source: ~/Videos/quick-takes/audit-2026-11/pack/avatar2d/library/<id>/cutout.png (198 stickers,
Meshy nano-banana-pro, 4 Nov 2026; see its README.md / index.json). Never edited there.

For each pick:
  1. copy the cutout to assets/avatar/lib/<id>.png (provenance);
  2. find the two red X eyes and scale the sticker so their width matches the idle pose's;
  3. place it on a 1600x1600 canvas (the core poses' 1200 canvas plus 200 px each side and 400
     above, so wide props and jumps fit without shrinking him): the eyes' midpoint at x 800, the
     lowest opaque pixel on the floor line y 1540 (= the core poses' (600, 1140)), unless PICKS
     gives an anchor;
  4. write site/avatar/lib/<id>.webp (1200 px: the same 0.75 as site/avatar/chibi/) and
     site/avatar/lib.json: {id: {eyes: [x, y], box: [x0, y0, x1, y1], scale, cat}} in CORE
     canvas px (so puppet.toStage() works unchanged; values can be negative).
"""
import json
import shutil
import sys
from collections import deque
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC = Path.home() / "Videos/quick-takes/audit-2026-11/pack/avatar2d/library"
CORE = ROOT / "assets/avatar/chibi/webp-v3"
COPY = ROOT / "assets/avatar/lib"
OUT = ROOT / "site/avatar/lib"
CANVAS, FLOOR, MID, OUT_PX = 1600, 1540, 800, 1200
TO_CORE = (-200, -400)   # lib canvas px -> core canvas px

# id -> overrides: s (extra scale factor), floor (lib canvas y of the lowest pixel), dx (px)
PICKS = {
    # bits
    "sit_notifications": {}, "react_bored-sigh": {}, "react_bored-cheek-fist": {}, "react_yawn-stretch": {},
    "react_yawn-cover": {}, "react_sleep-standing": {}, "react_shocked-jolt": {}, "react_suspicious-binoculars": {},
    "react_suspicious-squint": {}, "prop_clipboard": {}, "react_thinking-bubble": {}, "react_evil-lightbulb": {},
    "sit_money-moths": {}, "prop_stopwatch-race": {}, "prop_stopwatch-1hour": {}, "react_confused-shrug-qs": {},
    "react_eyeroll-blah": {}, "react_wave-hello": {}, "gaming_controller-gripping": {}, "gaming_controller-hold": {},
    "gaming_sofa-snacks": {}, "sit_peek-right": {}, "sit_peek-top": {}, "sit_peek-bottom": {},
    "react_smug-hands-behind-head": {}, "sit_climb-cases": {}, "sit_tiny-vs-case": {}, "sit_point-up": {},
    "prop_magnifier": {}, "sign_blank-board": {}, "sign_blank-hold-high": {}, "sign_blank-protest": {},
    "sign_blank-yellow": {}, "sign_blank-two-hands-low": {}, "sign_blank-sandwich": {},
    "sign_blank-wall-pointing": {}, "sign_blank-easel": {}, "sign_blank-lean": {},
    # mishaps / injuries
    "sit_anvil-flat": {}, "sit_banana-slip": {}, "sit_banana-slip-b": {}, "sit_cables-tangled": {},
    "sit_cliff-wile": {}, "scene_goals-ball-face": {}, "react_dizzy": {}, "react_shocked-frozen": {},
    "react_mindblown-explosion": {}, "sit_balloon-float": {}, "sit_run-away": {}, "sit_run-away-front": {},
    "react_rage-tantrum": {}, "react_horrified-trembling": {},
    # slowdown
    "react_nervous-sweat": {}, "react_horrified-peek-fingers": {}, "react_evil-lean-in": {}, "villain_steepled": {},
    "villain_crystal-ball": {}, "villain_sinister-point": {}, "prop_stopwatch-hug": {}, "prop_hourglass": {},
    # reactions: win
    "react_triumph-fist-pump": {}, "react_triumph-flex": {}, "react_triumph-mic-drop": {},
    "react_triumph-sunburst": {}, "react_hype-jump": {}, "react_clapping-hype": {}, "react_thumbs-up": {},
    "prop_crown": {}, "prop_crown-hold": {}, "gaming_controller-triumph": {}, "react_smug-finger-guns": {},
    "react_salute-gg": {}, "scene_goals-knee-slide": {}, "react_ok-sign": {}, "gaming_giant-controller": {},
    # reactions: lose
    "react_facepalm": {}, "react_facepalm-double": {}, "react_facepalm-headshake": {},
    "react_sobbing-fountains": {}, "react_sobbing-puddle": {}, "react_sobbing-hug-disc": {},
    "react_sobbing-tissue": {}, "react_nope": {}, "react_disgusted-nose": {}, "react_disgusted-gag": {},
    "react_disgusted-recoil": {}, "react_cringe": {}, "react_eyeroll": {}, "react_bored-lying-ceiling": {},
    "react_rage-scream": {}, "react_rage-table-flip": {}, "prop_grave-rip": {},
    # reactions: shock / laughing
    "react_shocked-cheeks": {}, "react_shocked-jump-back": {}, "react_horrified-munch-scream": {},
    "react_mindblown-hands-head": {}, "react_mindblown-spiral": {}, "react_laugh-crying": {},
    "react_laugh-rolling": {}, "react_laugh-pointing": {}, "react_laugh-bent-back": {},
    # smug / villain outros
    "react_smug-arms-crossed": {}, "react_smug-finger-wag": {}, "villain_evil-laugh": {}, "villain_coat-spin": {},
    # genre costumes
    "genre_basketball": {}, "genre_blaster": {}, "genre_boxer": {}, "genre_cook": {}, "genre_farmer": {},
    "genre_fishing": {}, "genre_footballer": {}, "genre_horror-flashlight": {}, "genre_horror-ghost": {},
    "genre_jetpack": {}, "genre_knight": {}, "genre_ninja": {}, "genre_racing-kart": {}, "genre_skate": {},
    "genre_space-suit": {}, "genre_zombie-bat": {},
}

# hand-checked absolute scales (eye detection fooled by seams, hidden eyes or odd eye sizes):
# value = sticker scale that puts his head at idle's size, read off the review contact sheets
ABS = {
    "react_shocked-jolt": 1.02, "react_suspicious-binoculars": 1.15, "prop_clipboard": 1.12, "react_evil-lightbulb": 1.18,
    "sit_money-moths": 1.05, "prop_stopwatch-race": 1.128, "react_confused-shrug-qs": 1.1, "react_eyeroll-blah": 0.93,
    "react_wave-hello": 1.04, "gaming_controller-gripping": 1.15, "sit_peek-right": 1.0, "sit_peek-top": 1.074,
    "sit_peek-bottom": 0.606, "react_smug-hands-behind-head": 1.2, "sign_blank-yellow": 1.126, "sign_blank-two-hands-low": 1.15,
    "sit_banana-slip-b": 0.9, "react_shocked-frozen": 1.039, "react_rage-tantrum": 1.25, "react_nervous-sweat": 0.92,
    "react_horrified-peek-fingers": 0.941, "villain_sinister-point": 0.97, "prop_crown-hold": 0.86, "react_smug-finger-guns": 0.98,
    "scene_goals-knee-slide": 0.94, "gaming_giant-controller": 1.076, "react_facepalm": 1.3, "react_facepalm-double": 1.33,
    "react_disgusted-recoil": 1.25, "react_cringe": 1.18, "react_bored-lying-ceiling": 1.22, "react_rage-scream": 1.117,
    "react_rage-table-flip": 1.34, "react_shocked-jump-back": 1.131, "react_horrified-munch-scream": 1.089, "react_mindblown-hands-head": 1.047,
    "react_mindblown-spiral": 1.145, "react_laugh-rolling": 1.027, "react_laugh-bent-back": 1.12, "villain_coat-spin": 1.25,
    "genre_basketball": 1.24, "genre_cook": 0.87,
}


def components(mask):
    try:
        from scipy import ndimage
    except ImportError:
        return components_py(mask)
    lab, n = ndimage.label(mask)
    out = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        size = int((lab[sl] == i + 1).sum())
        out.append((size, sl[1].start, sl[1].stop - 1, sl[0].start, sl[0].stop - 1))
    return out


def components_py(mask):
    h, w = mask.shape
    seen = np.zeros_like(mask)
    out = []
    for y, x in zip(*np.nonzero(mask)):
        if seen[y, x]:
            continue
        q = deque([(y, x)]); seen[y, x] = True; pts = []
        while q:
            cy, cx = q.popleft(); pts.append((cy, cx))
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = cy + dy, cx + dx
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not seen[ny, nx]:
                    seen[ny, nx] = True; q.append((ny, nx))
        p = np.array(pts)
        out.append((len(p), p[:, 1].min(), p[:, 1].max(), p[:, 0].min(), p[:, 0].max()))
    return out


def eyes(im):
    """(width of one X eye, midpoint x, midpoint y) in image px, or None. Two similar,
    square-ish red components side by side, the highest such pair."""
    a = np.asarray(im.convert("RGBA")).astype(int)[::2, ::2]
    r, g, b, al = a[..., 0], a[..., 1], a[..., 2], a[..., 3]
    red = (al > 200) & (r > 130) & (g < 75) & (b < 85) & (r - g > 80)
    cs = [c for c in components(red) if 15 < c[0] < 900]
    cs = [c for c in cs if 0.55 < (c[2] - c[1] + 1) / (c[4] - c[3] + 1) < 1.8 and (c[2] - c[1]) >= 6]
    cs.sort(key=lambda c: c[3])
    for i in range(len(cs)):
        for j in range(i + 1, len(cs)):
            A, B = cs[i], cs[j]
            wa, wb = A[2] - A[1] + 1, B[2] - B[1] + 1
            sep = abs((A[1] + A[2]) - (B[1] + B[2])) / 2
            if abs(A[3] - B[3]) < 20 and 0.6 < wa / wb < 1.6 and 0.9 * max(wa, wb) < sep < 3.2 * max(wa, wb):
                return ((wa + wb) / 2 * 2, (A[1] + A[2] + B[1] + B[2]) / 2, (A[3] + A[4] + B[3] + B[4]) / 2)
    return None


def main():
    ref = eyes(Image.open(CORE / "idle.webp"))
    assert ref, "no eyes on idle"
    EYE = ref[0]
    print(f"idle eye width {EYE:.1f} canvas px")
    COPY.mkdir(parents=True, exist_ok=True); OUT.mkdir(parents=True, exist_ok=True)
    index = json.loads((SRC / "index.json").read_text())
    cat = {x["id"]: x["category"] for x in index}
    meta, problems = {}, []
    for pid, o in PICKS.items():
        src = SRC / pid / "cutout.png"
        if not src.exists():
            problems.append((pid, "missing")); continue
        shutil.copy2(src, COPY / f"{pid}.png")
        im = Image.open(src).convert("RGBA")
        im = im.crop(im.getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox())
        bx0, by0 = Image.open(src).getchannel("A").point(lambda v: 255 if v > 24 else 0).getbbox()[:2]
        e = eyes(im)
        if e:
            s = EYE / e[0]
        else:   # no clean eye pair (profile, covered eyes...): match the idle sticker's height
            s = 920 / im.height
            problems.append((pid, "no eye pair: scaled by height"))
        s = ABS.get(pid) or min(max(s * o.get("s", 1), 0.45), 1.6)
        w, h = round(im.width * s), round(im.height * s)
        im = im.resize((w, h), Image.Resampling.LANCZOS)
        ex = e[1] * s if e else w / 2
        x0 = round(MID - ex + o.get("dx", 0))
        y0 = round(o.get("floor", FLOOR) - h)
        # keep it on the canvas: slide sideways rather than crop
        x0 = min(max(x0, 0), CANVAS - w) if w <= CANVAS else (CANVAS - w) // 2
        if y0 < 0 or w > CANVAS:
            k = min(CANVAS / w, (o.get("floor", FLOOR)) / h)
            im = im.resize((int(w * k), int(h * k)), Image.Resampling.LANCZOS); s *= k
            w, h = im.size; x0 = min(max(round(MID - (e[1] * s if e else w / 2)), 0), CANVAS - w)
            y0 = o.get("floor", FLOOR) - h
            problems.append((pid, f"too big: shrunk x{k:.2f}"))
        can = Image.new("RGBA", (CANVAS, CANVAS))
        can.alpha_composite(im, (x0, y0))
        can.resize((OUT_PX, OUT_PX), Image.Resampling.LANCZOS).save(OUT / f"{pid}.webp", quality=86, method=6)
        ey = [round(x0 + e[1] * s), round(y0 + e[2] * s)] if e else [x0 + w // 2, y0 + h // 4]
        cx, cy = TO_CORE
        meta[pid] = {"eyes": [ey[0] + cx, ey[1] + cy], "box": [x0 + cx, y0 + cy, x0 + w + cx, y0 + h + cy],
                     "scale": round(s, 3),
                     "cat": cat.get(pid, "?"), **({"noeyes": True} if not e else {})}
        tb = next((x.get("text_box") for x in index if x["id"] == pid), None)
        if tb:   # the blank board he holds: text gets drawn there (core canvas px)
            tx, ty, tw, th = tb
            meta[pid]["text"] = [round(x0 + (tx - bx0) * s + cx), round(y0 + (ty - by0) * s + cy),
                                 round(tw * s), round(th * s)]
    # boards Ares's index has no text_box for (found by their cream colour, core canvas px)
    TEXT_FIX = {"sit_cliff-wile": [780, 356, 185, 115]}
    for pid, tb in TEXT_FIX.items():
        if pid in meta: meta[pid]["text"] = tb
    # the core poses' heads too (eyes midpoint, core canvas px), for status FX that sit on his head
    HEAD_FIX = {"despair-flat": [300, 860], "nose-on-glass": [600, 700], "shush": [610, 600],
                "scheming": [590, 640], "electrocuted-a": [600, 470]}
    core = {}
    for f in sorted(CORE.glob("*.webp")):
        e = eyes(Image.open(f))
        core[f.stem] = {"eyes": HEAD_FIX.get(f.stem) or ([round(e[1]), round(e[2])] if e else [600, 560]), "core": True}
    meta = {**core, **meta}
    (ROOT / "site/avatar/lib.json").write_text(json.dumps(meta, indent=0))
    print(f"{len(meta)} imported"); [print(" ", *p) for p in problems]
    if "--sheet" in sys.argv:
        sheet(meta)


def sheet(meta):
    ids = list(meta); per = 24; cols = 8; cw = 300
    for n in range(0, len(ids), per):
        page = ids[n:n + per]
        rows = (len(page) + cols - 1) // cols
        s = Image.new("RGB", (cols * cw, rows * (cw + 24)), (236, 230, 214)); d = ImageDraw.Draw(s)
        idle = Image.open(CORE / "idle.webp").convert("RGBA").resize((cw, cw))
        for i, pid in enumerate(page):
            x, y = (i % cols) * cw, (i // cols) * (cw + 24)
            ghost = idle.copy(); ghost.putalpha(ghost.getchannel("A").point(lambda v: v * 0.22))
            s.paste(ghost, (x, y + 24), ghost)
            big = Image.open(OUT / f"{pid}.webp").convert("RGBA").resize((cw * 4 // 3, cw * 4 // 3))
            im = big.crop((cw // 6, cw // 3, cw // 6 + cw, cw // 3 + cw))   # the core canvas window
            s.paste(im, (x, y + 24), im)
            d.line([(x, y + 24 + cw * 1140 // 1200), (x + cw, y + 24 + cw * 1140 // 1200)], fill=(0, 160, 0))
            d.text((x + 3, y + 5), pid[:40] + (" *" if meta[pid].get("noeyes") else ""), fill=(200, 32, 46))
        out = Path.home() / f".hermes/cache/scratch/gpb/libsheet-{n // per}.png"
        s.save(out); print("sheet", out)


if __name__ == "__main__":
    main()
