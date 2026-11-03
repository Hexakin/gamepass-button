"""Avatar v3 checks on the skinned mesh (Blender side): body parts passing through each other.

Every vertex belongs to the part its biggest weight says (head, torso, upper arms, forearms,
hands, legs). For a moving part (hands, forearms) against a solid one (head, torso, the other
arm, the legs), each vertex looks up the nearest vertex of the solid (KD-tree) and is inside
when it sits behind that vertex's surface normal; the deepest such vertex is the part's
penetration. ``clips`` returns, per frame checked, {pair: depth in metres}.
"""
import numpy as np
from mathutils import Vector
from mathutils.kdtree import KDTree

import bpy

PARTS = {
    "head": ("Head", "head_end", "headfront"),
    "torso": ("Hips", "Spine02", "Spine01", "Spine", "neck", "LeftShoulder", "RightShoulder"),
    "L_upper": ("LeftArm",), "R_upper": ("RightArm",),
    "L_fore": ("LeftForeArm",), "R_fore": ("RightForeArm",),
    "L_hand": ("LeftHand",), "R_hand": ("RightHand",),
    "L_leg": ("LeftUpLeg", "LeftLeg", "LeftFoot", "LeftToeBase"),
    "R_leg": ("RightUpLeg", "RightLeg", "RightFoot", "RightToeBase"),
}
PAIRS = (("L_hand", "head"), ("R_hand", "head"), ("L_fore", "head"), ("R_fore", "head"),
         ("L_hand", "torso"), ("R_hand", "torso"), ("L_wrist", "torso"), ("R_wrist", "torso"),
         ("L_hand", "R_hand"), ("L_hand", "R_fore"), ("R_hand", "L_fore"), ("L_fore", "R_fore"),
         ("L_hand", "L_leg"), ("R_hand", "R_leg"), ("L_hand", "R_leg"), ("R_hand", "L_leg"),
         ("L_leg", "R_leg"))


def part_index(body) -> dict:
    """Vertex indices per part (by the biggest weight; finger bones count as the hand)."""
    ob = body
    names = [g.name for g in ob.vertex_groups]
    part_of = {}
    for part, bones in PARTS.items():
        for b in bones:
            part_of[b] = part
    for g in names:
        if "HandThumb" in g or "HandIndex" in g or "HandMiddle" in g or "HandRing" in g \
                or "HandPinky" in g:
            part_of[g] = ("L_hand" if g.startswith("Left") else "R_hand")
    best = np.full(len(ob.data.vertices), -1)
    bw = np.zeros(len(ob.data.vertices))
    for v in ob.data.vertices:
        for g in v.groups:
            if g.weight > bw[v.index]:
                bw[v.index], best[v.index] = g.weight, g.group
    out = {p: [] for p in PARTS}
    for i, gi in enumerate(best):
        if gi >= 0:
            p = part_of.get(names[gi])
            if p:
                out[p].append(i)
    out = {p: np.array(v, dtype=int) for p, v in out.items()}
    # the far half of each forearm (the wrist end; bind pose, arms out along x): the elbow
    # end rubbing the coat's side is sleeve on coat, the wrist end is what reads as clipping
    co = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get("co", co)
    m = np.array(ob.matrix_world)
    x = np.abs((co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3])[:, 0])
    for s in ("L", "R"):
        fore = out[f"{s}_fore"]
        out[f"{s}_wrist"] = fore[x[fore] > 0.49]
    return out


def evaluated(body):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body.evaluated_get(dg)
    me = ev.to_mesh()
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    nr = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("normal", nr)
    m = np.array(ev.matrix_world)
    co = co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]
    nr = nr.reshape(-1, 3) @ m[:3, :3].T
    nr /= np.maximum(np.linalg.norm(nr, axis=1, keepdims=True), 1e-9)
    ev.to_mesh_clear()
    return co, nr


def penetration(co, nr, mover, solid, step=2, k=6):
    """Deepest point of ``mover`` inside ``solid`` (metres; 0 if none) and the push that
    gets it out (world vector), with the mover's vertices thinned by ``step``."""
    if len(mover) == 0 or len(solid) == 0:
        return 0.0, np.zeros(3)
    sv = co[solid]
    mv = co[mover[::step]]
    lo, hi = sv.min(0) - 0.05, sv.max(0) + 0.05
    inside_box = np.all((mv > lo) & (mv < hi), axis=1)
    if not inside_box.any():
        return 0.0, np.zeros(3)
    tree = KDTree(len(sv))
    for i, p in enumerate(sv):
        tree.insert(Vector(p), i)
    tree.balance()
    best, push = 0.0, np.zeros(3)
    global LAST_POINT
    LAST_POINT = None
    for p in mv[inside_box]:
        hits = tree.find_n(Vector(p), k)
        if not hits or hits[0][2] > 0.06:
            continue
        # behind the surface by all the nearest normals' agreement
        depths = []
        nsum = np.zeros(3)
        for _, idx, dist in hits:
            n = nr[solid[idx]]
            depths.append(float(np.dot(sv[idx] - p, n)))
            nsum += n
        d = float(np.median(depths))
        if d > best and min(depths) > -0.004:
            best = d
            nn = nsum / max(np.linalg.norm(nsum), 1e-9)
            push = nn * d
            LAST_POINT = p.copy()
    return best, push


LAST_POINT = None     # where the deepest point of the last ``penetration`` call was


def clips(scene, body, frames, parts=None, pairs=PAIRS, threshold=0.012):
    """{frame: {pair: depth}} for the pairs deeper than ``threshold`` metres."""
    parts = parts or part_index(body)
    out = {}
    for f in frames:
        scene.frame_set(f)
        co, nr = evaluated(body)
        hits = {}
        for a, b in pairs:
            d, _ = penetration(co, nr, parts[a], parts[b])
            if d > threshold:
                hits[f"{a}>{b}"] = round(d, 3)
        if hits:
            out[f] = hits
    return out
