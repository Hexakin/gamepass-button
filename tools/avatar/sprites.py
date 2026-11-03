"""Turn rendered avatar clips into web sprites that share one stage (same feet spot, same size).

    python3 tools/avatar/sprites.py [--only slug ...]

Sources:
  - the 8 new poses: assets/avatar/frames/<slug>/frame_*.png + meta.json (tools/avatar/build.py)
  - existing moves from the social avatar library (read-only): ~/social/brand/avatar/<slug>.mov
    with the shared anchor/head in its library.yaml
Outputs (site/):
  site/avatar/lo/<slug>.webp   phone sprite sheet: CELL_LO cells, LO_FPS, COLS per row
  site/avatar/hi/<slug>/NNN.webp  render-mode frames: CELL_HI, 30 fps
  site/avatar/clips.json       {slug: {frames, fps, cols, cell, hiFrames, duration}}
  assets/avatar/stills/<slug>.png  the pose still (transparent, trimmed) for Short stickers
"""
import argparse
import json
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
AV = ROOT / "assets" / "avatar"
SITE = ROOT / "site" / "avatar"
SOCIAL = Path.home() / "social" / "brand" / "avatar"

CELL_HI = (750, 1000)
CELL_LO = (360, 480)
LO_FPS = 12
COLS = 8
FEET = (0.5, 0.96)   # where the feet stand in a cell (fractions)
REST = 0.62          # standing height (feet to top of head) as a fraction of the cell height

NEW = ["button-slam", "shove-it-on", "scheming", "jazz-hands", "electrocuted", "collapse", "flex",
       "backflip"]
OLD = ["idle", "point-at-you", "arms-crossed-tap", "dont-you-dare", "finger-wag-no",
       "sceptical-chin", "shocked", "despair-knees", "facepalm", "cheer", "laugh", "slow-clap",
       "tantrum", "victory-fist-pump", "shrug", "frustrated-head-grab", "talk-passionately",
       "headache", "angry-stomp", "point-left"]
MAX_DUR = 5.0        # long loops are cut (keeps phone sprite sheets small)
POSE = {"button-slam": 1.9, "shove-it-on": 3.9, "scheming": 1.9, "jazz-hands": 1.2,
        "electrocuted": 1.5, "collapse": 2.2, "flex": 0.9, "backflip": 1.0}


def place(img, anchor, head, cell):
    """Scale and move a source frame so its feet and height match the shared stage."""
    w, h = img.size
    rest_px = (anchor[1] - head) * h
    s = REST * cell[1] / rest_px
    img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.Resampling.LANCZOS)
    ox = round(FEET[0] * cell[0] - anchor[0] * w * s)
    oy = round(FEET[1] * cell[1] - anchor[1] * h * s)
    out = Image.new("RGBA", cell, (0, 0, 0, 0))
    out.paste(img, (ox, oy), img)
    return out


def frames_for(slug, tmp: Path):
    if slug in NEW:
        d = AV / "frames" / slug
        meta = json.loads((d / "meta.json").read_text())
        return sorted(d.glob("frame_*.png")), meta["anchor"], meta["head"]
    lib = (SOCIAL / "library.yaml").read_text()
    import yaml  # noqa: PLC0415
    y = yaml.safe_load(lib)
    out = tmp / slug
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(SOCIAL / f"{slug}.mov"),
                    "-pix_fmt", "rgba", str(out / "frame_%04d.png")], check=True)
    return sorted(out.glob("frame_*.png")), y["anchor"], y["head"]


def build(slug, tmp):
    files, anchor, head = frames_for(slug, tmp)
    files = files[:int(MAX_DUR * 30)]
    n = len(files)
    dur = n / 30
    hi_dir = SITE / "hi" / slug
    hi_dir.mkdir(parents=True, exist_ok=True)
    for old in hi_dir.glob("*.webp"):
        old.unlink()
    for i, f in enumerate(files):
        place(Image.open(f).convert("RGBA"), anchor, head, CELL_HI).save(
            hi_dir / f"{i:03d}.webp", quality=82, method=4)
    lo_n = max(1, int(dur * LO_FPS))
    rows = (lo_n + COLS - 1) // COLS
    sheet = Image.new("RGBA", (CELL_LO[0] * min(COLS, lo_n), CELL_LO[1] * rows), (0, 0, 0, 0))
    for k in range(lo_n):
        src = files[min(n - 1, int(k * 30 / LO_FPS))]
        cell = place(Image.open(src).convert("RGBA"), anchor, head, CELL_LO)
        sheet.paste(cell, ((k % COLS) * CELL_LO[0], (k // COLS) * CELL_LO[1]))
    (SITE / "lo").mkdir(parents=True, exist_ok=True)
    sheet.save(SITE / "lo" / f"{slug}.webp", quality=80, method=6)
    # pose still for stickers
    if slug in NEW:
        k = min(n - 1, int(POSE.get(slug, dur / 2) * 30))
        st = Image.open(files[k]).convert("RGBA")
        bb = st.getchannel("A").point([0] * 9 + [255] * 247).getbbox()
        if bb:
            st = st.crop(bb)
        (AV / "stills").mkdir(exist_ok=True)
        st.save(AV / "stills" / f"{slug}.png", optimize=True)
    print(f"{slug}: {n} frames ({dur:.2f}s), lo {lo_n} @ {LO_FPS}fps", flush=True)
    return slug, {"duration": round(dur, 3), "hiFrames": n, "hiFps": 30, "frames": lo_n,
                  "fps": LO_FPS, "cols": COLS, "cell": list(CELL_LO), "cellHi": list(CELL_HI)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--jobs", type=int, default=4)
    a = ap.parse_args()
    slugs = a.only or (NEW + OLD)
    idx_path = SITE / "clips.json"
    with tempfile.TemporaryDirectory() as t, ThreadPoolExecutor(a.jobs) as pool:
        built = list(pool.map(lambda s: build(s, Path(t)), slugs))
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else {}
    idx.update(dict(built))
    idx_path.write_text(json.dumps(dict(sorted(idx.items())), indent=1))
    meta = {"feet": FEET, "rest": REST}
    (SITE / "stage.json").write_text(json.dumps(meta))


if __name__ == "__main__":
    main()
