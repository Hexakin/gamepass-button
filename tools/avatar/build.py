"""Stage and render the new Hexakin poses (Meshy clips in assets/avatar/glb/) with Blender.

    python3 tools/avatar/build.py [fix|measure|render|all] [--only slug ...] [--jobs 2]

Uses copies of ~/social/brand/3d/render_avatar.py + rig_v3*.py + idle.json (the social repo's
avatar pipeline, so the new poses match the existing library's look). Outputs:
  assets/avatar/v3/<slug>.glb             cleaned clip (fingers, ease from the shared idle, floor lock)
  assets/avatar/frames/<slug>/frame_*.png transparent 30 fps frames (not in git)
  assets/avatar/frames/<slug>/meta.json   where the feet stand / head top, as frame fractions
"""
import argparse
import json
import shutil
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
AV = ROOT / "assets" / "avatar"
SCRIPT = HERE / "render_avatar.py"
SIZE = "720x810"

BIG = {"amp": {"core": 1.45, "head": 1.4, "arms": 1.15}, "cartoon": {"sigma": 4, "strength": 0.8}}
PUSH = {"amp": {"core": 1.3, "head": 1.3, "arms": 1.1}, "cartoon": {"sigma": 4, "strength": 0.6}}
EASE = {"ease": 10}

MOVES = {
    "button-slam": {**EASE, "face": 1, "push": BIG, "fingers": "fist"},
    "shove-it-on": {**EASE, "face": 1, "push": PUSH, "fingers": "flat"},
    "scheming": {**EASE, "face": 1, "push": PUSH},
    "jazz-hands": {**EASE, "face": 1, "push": BIG, "fingers": "spread"},
    "electrocuted": {**EASE, "face": 1, "push": BIG, "fingers": "spread"},
    "collapse": {**EASE, "ease_out": 0, "face": 1},
    "flex": {**EASE, "face": 1, "push": PUSH, "fingers": "fist"},
    "backflip": {**EASE, "face": 1},
}


def blender(*args, env=None):
    import os
    p = subprocess.run([shutil.which("blender"), "-b", "--factory-startup", "-P", str(SCRIPT), "--",
                        *args], capture_output=True, text=True, env={**os.environ, **(env or {})})
    out = p.stdout + p.stderr
    if p.returncode or "Traceback" in out:
        raise RuntimeError(f"blender {args[:2]} failed:\n" + "\n".join(out.splitlines()[-25:]))
    return out


def fix(slug):
    tmp = AV / "tmp"
    tmp.mkdir(exist_ok=True)
    opts = tmp / f"{slug}-fix.json"
    opts.write_text(json.dumps(MOVES[slug]))
    blender("fix", str(AV / "glb" / f"{slug}.glb"), "x", str(AV / "v3" / f"{slug}.glb"), str(opts))
    print("fixed", slug, flush=True)


def measure(slug):
    tmp = AV / "tmp"
    opts = tmp / f"{slug}-staged.json"
    opts.write_text(json.dumps({"staged": True}))
    out = tmp / f"{slug}-measure.json"
    blender("measure", str(AV / "v3" / f"{slug}.glb"), "v3", str(out), str(opts))
    print("measured", slug, flush=True)
    return json.loads(out.read_text())


def render(slug, box, points, env=None):
    tmp = AV / "tmp"
    framing = tmp / f"{slug}-framing.json"
    m = json.loads((tmp / f"{slug}-measure.json").read_text())
    framing.write_text(json.dumps({"bbox_min": box[0], "bbox_max": box[1], "points": points,
                                   "rest_height": 1.8, "opts": {"staged": True},
                                   "pose_time": m.get("pose_time", 0)}))
    out = AV / "frames" / slug
    if out.exists() and not env:
        shutil.rmtree(out)
    blender("render", str(AV / "v3" / f"{slug}.glb"), "v3", str(out), str(framing), SIZE, env=env)
    print("rendered", slug, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["fix", "measure", "render", "all", "pose"])
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--jobs", type=int, default=2)
    a = ap.parse_args()
    slugs = a.only or list(MOVES)
    (AV / "v3").mkdir(exist_ok=True)
    with ThreadPoolExecutor(a.jobs) as pool:
        if a.step in ("fix", "all"):
            list(pool.map(fix, slugs))
        if a.step in ("measure", "all"):
            list(pool.map(measure, slugs))
        if a.step in ("render", "all", "pose"):
            ms = [json.loads((AV / "tmp" / f"{s}-measure.json").read_text()) for s in MOVES
                  if (AV / "tmp" / f"{s}-measure.json").exists()]
            lo = [min(m["bbox_min"][i] for m in ms) for i in range(3)]
            hi = [max(m["bbox_max"][i] for m in ms) for i in range(3)]
            pts = [list(p) for p in sorted({tuple(p) for m in ms for p in m.get("points", [])})]
            env = {"POSE_ONLY": "1"} if a.step == "pose" else None
            list(pool.map(lambda s: render(s, (lo, hi), pts, env), slugs))


if __name__ == "__main__":
    main()
