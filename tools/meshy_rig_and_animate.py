"""Rig the Hexakin v2 avatar on Meshy and apply library animations (one task per action).

    python3 tools/meshy_rig_and_animate.py rig            # 5 credits
    python3 tools/meshy_rig_and_animate.py animate        # 3 credits per action in NEW_POSES
    python3 tools/meshy_rig_and_animate.py fetch          # download finished GLBs (free)

Every paid call is appended to assets/avatar/meshy-calls.csv. Task ids in assets/avatar/tasks.json.
"""
import base64, csv, json, sys, time, urllib.request
from datetime import datetime, timezone
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from meshy_api import call

ROOT = Path(__file__).resolve().parents[1]
AV = ROOT / "assets" / "avatar"
TASKS = AV / "tasks.json"
LOG = AV / "meshy-calls.csv"
SRC_GLB = Path.home() / "social/brand/3d/hexakin-avatar-v2.glb"   # read-only source

# slug: (library action_id, what it's for in the show)
NEW_POSES = {
    "button-slam": (127, "Charged Ground Slam: slams the big button"),
    "shove-it-on": (259, "Step Forward and Push: shoves a fake-out result off the wheel"),
    "scheming": (318, "Scheming Hand Rub: 'you rigged this, didn't you'"),
    "jazz-hands": (408, "Jazz Hands: ta-da, presenting the pick"),
    "electrocuted": (172, "Electrocution Reaction: the wheel 'breaks'"),
    "collapse": (366, "Falling Down: collapses in despair at a bad pick"),
    "flex": (388, "Show Both Arm Muscles: over-the-top celebration"),
    "backflip": (452, "Backflip: celebration, way too much"),
}

def load():
    return json.loads(TASKS.read_text()) if TASKS.exists() else {}

def save(d):
    TASKS.write_text(json.dumps(d, indent=1))

def log(kind, slug, task, credits):
    new = not LOG.exists()
    with LOG.open("a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["utc", "kind", "slug", "task_id", "credits"])
        w.writerow([datetime.now(timezone.utc).isoformat(timespec="seconds"), kind, slug, task, credits])

def wait(path, tid):
    while True:
        d = call("GET", f"{path}/{tid}")
        if d["status"] in ("SUCCEEDED", "FAILED", "CANCELED", "EXPIRED"):
            return d
        time.sleep(10)

def main(cmd):
    t = load()
    if cmd == "rig":
        if t.get("rig_task"):
            print("already rigged", t["rig_task"]); return
        uri = "data:application/octet-stream;base64," + base64.b64encode(SRC_GLB.read_bytes()).decode()
        r = call("POST", "/openapi/v1/rigging", {"model_url": uri, "height_meters": 1.8})
        t["rig_task"] = r["result"]; save(t); log("rig", "hexakin-avatar-v2", r["result"], 5)
        d = wait("/openapi/v1/rigging", r["result"])
        print(d["status"], d.get("task_error"))
    elif cmd == "animate":
        anims = t.setdefault("animations", {})
        for slug, (aid, _) in NEW_POSES.items():
            if slug in anims:
                continue
            r = call("POST", "/openapi/v1/animations", {"rig_task_id": t["rig_task"], "action_id": aid})
            anims[slug] = {"task": r["result"], "action_id": aid}; save(t); log("animate", slug, r["result"], 3)
            print("submitted", slug, r["result"])
    elif cmd == "fetch":
        out = AV / "glb"; out.mkdir(exist_ok=True)
        if "rig_task" in t:
            d = wait("/openapi/v1/rigging", t["rig_task"])
            u = (d.get("result") or {}).get("rigged_character_glb_url")
            if u and not (out / "hexakin-rigged.glb").exists():
                urllib.request.urlretrieve(u, out / "hexakin-rigged.glb")
        for slug, a in t.get("animations", {}).items():
            d = wait("/openapi/v1/animations", a["task"])
            if d["status"] != "SUCCEEDED":
                print(slug, d["status"], d.get("task_error")); continue
            u = d["result"].get("animation_glb_url")
            if not (out / f"{slug}.glb").exists():
                urllib.request.urlretrieve(u, out / f"{slug}.glb")
            print("fetched", slug)

if __name__ == "__main__":
    main(sys.argv[1])
