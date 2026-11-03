"""Export the new poses as transparent .mov (qtrle, 30 fps) for the Shorts pipeline.

    python3 tools/avatar/export_mov.py [--out ~/Videos/quick-takes/gamepass-button/avatar]
"""
import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NEW = ["button-slam", "shove-it-on", "scheming", "jazz-hands", "electrocuted", "collapse", "flex", "backflip"]

ap = argparse.ArgumentParser()
ap.add_argument("--out", default=str(Path.home() / "Videos/quick-takes/gamepass-button/avatar"))
out = Path(ap.parse_args().out)
out.mkdir(parents=True, exist_ok=True)
for slug in NEW:
    src = ROOT / "site" / "avatar" / "hi" / slug / "%03d.webp"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-framerate", "30", "-i", str(src),
                    "-c:v", "qtrle", "-pix_fmt", "argb", str(out / f"{slug}.mov")], check=True)
    print(out / f"{slug}.mov")
