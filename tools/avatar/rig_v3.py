"""Avatar v3 rig work (Blender side): finger bones on the Meshy rig, hand shapes, and the
kinematics the clean-up passes use (forward kinematics on sampled poses, two-bone IK,
hinge limits, the cartoon filter).

The Meshy rig has 24 bones and no fingers, but the mesh has separate fingers. ``add_fingers``
adds a thumb and four three-segment fingers under each hand, at joint positions measured from
the bind-pose mesh (left hand; the right is the mirror), and splits each finger vertex's hand
weight between the hand and its finger segments by where it lies along the finger, blended
across each joint so the knuckles bend instead of tearing.

Poses here are the ``{bone: (loc, quat, scale)}`` dicts that ``render_avatar.sample`` makes:
local (basis) transforms, in the armature's units (cm; the armature object is scaled 0.01).
"""
import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

SIDES = ("Left", "Right")
FINGERS = ("Index", "Middle", "Ring", "Pinky")

# Bind pose, left hand, world metres (T-pose, palm down, fingers along +x, thumb forward -y).
# Measured from the mesh: the finger centre lines at the knuckles (MCP) and the tips.
_MCP_TIP = {
    "Index": ((0.727, -0.045, 1.362), (0.797, -0.040, 1.352)),
    "Middle": ((0.728, -0.025, 1.364), (0.810, -0.021, 1.352)),
    "Ring": ((0.728, -0.006, 1.362), (0.807, -0.005, 1.352)),
    "Pinky": ((0.725, 0.014, 1.358), (0.789, 0.013, 1.352)),
}
_THUMB = ((0.652, -0.033, 1.341), (0.679, -0.057, 1.333), (0.696, -0.073, 1.324),
          (0.709, -0.090, 1.313))
_SPLIT = (0.45, 0.75)          # PIP and DIP as fractions of knuckle-to-tip


def finger_joints(side: str) -> dict[str, list[Vector]]:
    """World joint positions (4 per digit: base, two inner joints, tip) for one hand."""
    sx = 1.0 if side == "Left" else -1.0
    out = {}
    for name, (a, b) in _MCP_TIP.items():
        a, b = Vector(a), Vector(b)
        out[name] = [a, a.lerp(b, _SPLIT[0]), a.lerp(b, _SPLIT[1]), b]
    out["Thumb"] = [Vector(p) for p in _THUMB]
    for name in out:
        out[name] = [Vector((p.x * sx, p.y, p.z)) for p in out[name]]
    return out


def bone_name(side, digit, i):
    return f"{side}Hand{digit}{i}"


def finger_bones(side=None):
    sides = SIDES if side is None else (side,)
    return [bone_name(s, d, i) for s in sides for d in ("Thumb",) + FINGERS for i in (1, 2, 3)]


def _seg_param(p, a, b):
    """Distance from points p (N,3) to segment a-b, and the unclamped distance along it."""
    ab = b - a
    L = np.linalg.norm(ab)
    u = ab / L
    t = (p - a) @ u
    tc = np.clip(t, 0, L)
    d = np.linalg.norm(p - (a + np.outer(tc, u)), axis=1)
    return d, t


def add_fingers(arm, body) -> None:
    """Finger bones and weights (idempotent: does nothing if they're there)."""
    if bone_name("Left", "Index", 1) in arm.data.bones:
        return
    view = bpy.context.view_layer
    for o in view.objects:
        o.select_set(False)
    view.objects.active = arm
    arm.select_set(True)
    inv = arm.matrix_world.inverted()
    joints = {s: finger_joints(s) for s in SIDES}
    bpy.ops.object.mode_set(mode="EDIT")
    eb = arm.data.edit_bones
    for s in SIDES:
        hand = eb[f"{s}Hand"]
        for digit, pts in joints[s].items():
            parent = hand
            for i in range(3):
                b = eb.new(bone_name(s, digit, i + 1))
                b.head, b.tail = inv @ pts[i], inv @ pts[i + 1]
                # Z along the back of the hand (world up in the T-pose): curling is about X.
                b.align_roll(Vector((0, 0, 1)))
                b.parent = parent
                b.use_connect = i > 0
                b.use_deform = True
                parent = b
    bpy.ops.object.mode_set(mode="OBJECT")
    _weights(arm, body, joints)
    _rigid_boots(body)


def _rigid_boots(body, low=0.085, high=0.135) -> None:
    """Meshy's weights let the shin pull the heel and the boot's sole up when the knee bends
    (a planted foot then rocks onto its toes). Below ``low`` (m, bind pose) the boot follows
    only the foot and toe bones; up to ``high`` the shin's share fades back in."""
    ob = body
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    m = np.array(ob.matrix_world)
    z = (co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3])[:, 2]
    for s in SIDES:
        g_leg = ob.vertex_groups.get(f"{s}Leg")
        g_up = ob.vertex_groups.get(f"{s}UpLeg")
        g_foot = ob.vertex_groups[f"{s}Foot"]
        ids = {g.index for g in (g_leg, g_up) if g}
        for v in me.vertices:
            if z[v.index] >= high:
                continue
            k = 1.0 - _smooth(np.array((z[v.index] - low) / (high - low)))  # 1 = all to foot
            moved = 0.0
            for g in v.groups:
                if g.group in ids and g.weight > 0:
                    take = g.weight * float(k)
                    moved += take
                    ob.vertex_groups[g.group].add([v.index], g.weight - take, "REPLACE")
            if moved > 0:
                cur = next((g.weight for g in v.groups if g.group == g_foot.index), 0.0)
                g_foot.add([v.index], cur + moved, "REPLACE")


def _weights(arm, body, joints) -> None:
    ob = body
    me = ob.data
    n = len(me.vertices)
    co = np.empty(n * 3, np.float32)
    me.vertices.foreach_get("co", co)
    m = np.array(ob.matrix_world)
    w = co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]
    for s in SIDES:
        g_hand = ob.vertex_groups[f"{s}Hand"]
        hw = np.zeros(n, np.float32)
        gi = g_hand.index
        for v in me.vertices:
            for g in v.groups:
                if g.group == gi:
                    hw[v.index] = g.weight
        cand = np.nonzero(hw > 0)[0]
        p = w[cand]
        sx = 1.0 if s == "Left" else -1.0
        # distance to every digit's centre line; nearest wins
        dist, along, segs = {}, {}, {}
        for digit, pts in joints[s].items():
            P = [np.array(q) for q in pts]
            d0, t0 = _seg_param(p, P[0], P[3])
            dist[digit], along[digit] = d0, t0
            segs[digit] = [np.linalg.norm(P[i + 1] - P[i]) for i in range(3)]
        names = list(dist)
        D = np.stack([dist[k] for k in names], 1)
        near = np.argmin(D, 1)
        share = {k: np.zeros((len(cand), 3), np.float32) for k in names}
        for k_i, k in enumerate(names):
            sel = near == k_i
            t = along[k][sel]
            d = dist[k][sel]
            L1, L2, L3 = segs[k]
            # how much of the hand weight moves to the digit: from behind the base (knuckle)
            # outwards, over a wide band so the glove over the knuckles bends smoothly; the
            # thumb's base is deep in the palm, so it fades in later
            if k == "Thumb":
                f = _smooth((t - 0.004) / 0.018) * (d < 0.02)
            else:
                f = _smooth((t + 0.014) / 0.026) * (d < 0.03)
            # which segment: blended across the two inner joints
            b1 = _smooth((t - L1 + 0.005) / 0.010)
            b2 = _smooth((t - L1 - L2 + 0.004) / 0.008)
            w1 = f * (1 - b1)
            w2 = f * (b1 - b2)
            w3 = f * b2
            share[k][sel] = np.stack([w1, w2, w3], 1)
        total = sum(sh.sum(1) for sh in share.values())
        keep = hw[cand] * (1 - total)
        for idx, v_i in enumerate(cand):
            g_hand.add([int(v_i)], float(keep[idx]), "REPLACE")
        for k in names:
            for i in range(3):
                vals = share[k][:, i] * hw[cand]
                nz = np.nonzero(vals > 1e-4)[0]
                g = ob.vertex_groups.new(name=bone_name(s, k, i + 1))
                for j in nz:
                    g.add([int(cand[j])], float(vals[j]), "REPLACE")


def _smooth(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# ---------------------------------------------------------------------------- hand shapes

# Per finger: (curl at base, middle, tip) in degrees (+ = towards the palm), spread at the base
# (+ = away from the middle finger). Thumb: (lift, across, curl2, curl3): the base turns
# ``across`` the palm about the hand's normal and ``lift``s about its hinge; the two outer
# joints curl. Chosen by eye from close-up renders (a fist wraps the thumb over the fingers).
SHAPES = {
    "relaxed": {"Index": (14, 22, 12, 2), "Middle": (20, 28, 14, 0), "Ring": (26, 32, 16, 2),
                "Pinky": (32, 34, 18, 5), "Thumb": (6, 14, 12, 12)},
    "soft": {"Index": (8, 14, 8, 6), "Middle": (11, 17, 9, 0), "Ring": (14, 20, 10, 5),
             "Pinky": (18, 22, 12, 10), "Thumb": (3, 8, 6, 6)},
    "fist": {"Index": (82, 100, 60, 0), "Middle": (88, 100, 62, 0), "Ring": (92, 100, 62, 0),
             "Pinky": (95, 100, 62, 0), "Thumb": (25, 35, 20, 20)},
    "point": {"Index": (-4, 0, 0, 0), "Middle": (88, 100, 62, 0), "Ring": (92, 100, 62, 0),
              "Pinky": (95, 100, 62, 0), "Thumb": (25, 35, 20, 20)},
    "spread": {"Index": (-4, 4, 2, 12), "Middle": (-4, 4, 2, 0), "Ring": (-2, 4, 2, 12),
               "Pinky": (0, 6, 4, 24), "Thumb": (-12, -28, 0, -5)},
    "open": {"Index": (4, 6, 4, 6), "Middle": (5, 7, 4, 0), "Ring": (7, 8, 5, 6),
             "Pinky": (10, 10, 6, 12), "Thumb": (-4, -8, 4, 4)},
    "flat": {"Index": (2, 2, 2, 0), "Middle": (2, 2, 2, 0), "Ring": (2, 2, 2, 0),
             "Pinky": (2, 2, 2, 2), "Thumb": (0, 8, 0, 0)},
    "claw": {"Index": (30, 45, 35, 10), "Middle": (32, 45, 35, 0), "Ring": (34, 45, 35, 10),
             "Pinky": (36, 45, 35, 18), "Thumb": (10, 18, 25, 25)},
    "grip": {"Index": (62, 80, 48, 0), "Middle": (68, 84, 50, 0), "Ring": (72, 86, 52, 0),
             "Pinky": (76, 88, 52, 0), "Thumb": (22, 32, 22, 22)},
    "cup": {"Index": (22, 30, 18, 0), "Middle": (24, 32, 18, 0), "Ring": (26, 32, 18, 2),
            "Pinky": (28, 34, 18, 4), "Thumb": (4, 24, 14, 10)},
}


def shape_mix(a, b, w):
    """Blend two shapes (dicts or names) by w."""
    a = SHAPES[a] if isinstance(a, str) else a
    b = SHAPES[b] if isinstance(b, str) else b
    return {k: tuple(x + (y - x) * w for x, y in zip(a[k], b[k])) for k in a}


def shape_pose(side: str, shape) -> dict:
    """Local (basis) transforms of one hand's finger bones for a shape."""
    shape = SHAPES[shape] if isinstance(shape, str) else shape
    out = {}
    one = Vector((1, 1, 1))
    flip = 1.0 if side == "Left" else -1.0     # mirrored rig: turns about Z change sign
    lift, across, t2, t3 = shape["Thumb"]
    out[bone_name(side, "Thumb", 1)] = (Vector(), Quaternion((0, 0, 1), math.radians(across) * flip)
                                        @ Quaternion((1, 0, 0), math.radians(lift)), one)
    out[bone_name(side, "Thumb", 2)] = (Vector(), Quaternion((1, 0, 0), math.radians(t2)), one)
    out[bone_name(side, "Thumb", 3)] = (Vector(), Quaternion((1, 0, 0), math.radians(t3)), one)
    for digit in FINGERS:
        c1, c2, c3, spread = shape[digit]
        sgn = -1.0 if digit == "Index" else 1.0      # the index spreads to the thumb side
        for i, c in enumerate((c1, c2, c3)):
            q = Quaternion((1, 0, 0), -math.radians(c))       # curl: tip towards the palm
            if i == 0 and digit != "Middle":
                q = Quaternion((0, 0, 1), math.radians(spread) * sgn * flip) @ q
            out[bone_name(side, digit, i + 1)] = (Vector(), q, one)
    return out


def hands_track(n: int, keys, fps: int = 30, default="relaxed"):
    """Per-frame finger poses from a timeline: ``keys`` is either a shape name for both hands,
    or a dict ``{"Left": [[t, shape], ...], "Right": [...], "both": [...]}`` (seconds; shapes
    held between keys, blended over ``blend`` = 4 frames before each key)."""
    if keys is None:
        keys = default
    if isinstance(keys, str):
        keys = {"both": [[0, keys]]}
    out = [dict() for _ in range(n)]
    for side in SIDES:
        tl = keys.get(side) or keys.get("both") or [[0, default]]
        tl = sorted(([float(t), s] for t, s in tl), key=lambda x: x[0])
        for f in range(n):
            t = f / fps
            shape = tl[0][1]
            for i, (tk, s) in enumerate(tl):
                if t >= tk:
                    shape = s
            # blend into the next key over the 5 frames before it
            nxt = next(((tk, s) for tk, s in tl if tk > t), None)
            if nxt is not None:
                w = 1 - (nxt[0] - t) * fps / 5
                if w > 0:
                    shape = shape_mix(shape, nxt[1], _smooth(w))
            out[f].update(shape_pose(side, shape))
    return out


# ---------------------------------------------------------------------------- kinematics

class Kin:
    """Forward kinematics on pose dicts (armature space, the armature's units)."""

    def __init__(self, arm):
        self.arm = arm
        self.rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
        self.parent = {b.name: (b.parent.name if b.parent else None) for b in arm.data.bones}
        self.length = {b.name: b.length for b in arm.data.bones}
        self.rel = {}
        for b in arm.data.bones:
            if b.parent:
                self.rel[b.name] = b.parent.matrix_local.inverted() @ b.matrix_local
            else:
                self.rel[b.name] = b.matrix_local.copy()
        order, seen = [], set()

        def visit(name):
            if name in seen:
                return
            if self.parent[name]:
                visit(self.parent[name])
            seen.add(name)
            order.append(name)
        for b in arm.data.bones:
            visit(b.name)
        self.order = order

    def world(self, pose, names=None):
        """Armature-space matrices of every bone (or the chain up to ``names``)."""
        out = {}
        want = None
        if names is not None:
            want = set()
            for n in names:
                while n:
                    want.add(n)
                    n = self.parent[n]
        for name in self.order:
            if want is not None and name not in want:
                continue
            loc, q, s = pose[name]
            basis = Matrix.LocRotScale(loc, q, s)
            p = self.parent[name]
            out[name] = (out[p] @ self.rel[name] @ basis) if p else (self.rel[name] @ basis)
        return out

    def local_from_world(self, pose, mats, name, world_rot: Quaternion) -> Quaternion:
        """The basis rotation of ``name`` that gives it ``world_rot`` (armature space), with
        its parent at ``mats[parent]``."""
        p = self.parent[name]
        base = (mats[p] @ self.rel[name]) if p else self.rel[name]
        return (base.to_quaternion().inverted() @ world_rot).normalized()


def two_bone_ik(kin: Kin, pose, upper: str, lower: str, end: str, target: Vector,
                pole: Vector, keep_end_rot=True):
    """Place ``end``'s head at ``target`` (armature space) by rotating ``upper`` and
    ``lower``; the middle joint goes towards ``pole``. Each bone turns by the smallest
    rotation from where it was, so twist is kept. Returns a new pose dict."""
    mats = kin.world(pose, [end])
    S = mats[upper].translation
    E0 = mats[lower].translation
    W0 = mats[end].translation
    end_rot = mats[end].to_quaternion()
    L1 = (E0 - S).length
    L2 = (W0 - E0).length
    d_vec = target - S
    d = max(min(d_vec.length, L1 + L2 - 1e-3), abs(L1 - L2) + 1e-3)
    n = d_vec.normalized()
    u = (pole - S) - n * (pole - S).dot(n)
    if u.length < 1e-6:
        u = (E0 - S) - n * (E0 - S).dot(n)
    u.normalize()
    a = (L1 * L1 - L2 * L2 + d * d) / (2 * d)
    h = math.sqrt(max(L1 * L1 - a * a, 0.0))
    E = S + n * a + u * h
    T = S + n * d
    out = dict(pose)
    # upper
    r_up = mats[upper].to_quaternion()
    dir0 = (E0 - S).normalized()
    new_up = (dir0.rotation_difference((E - S).normalized()) @ r_up).normalized()
    loc, _, sc = pose[upper]
    out[upper] = (loc, kin.local_from_world(pose, mats, upper, new_up), sc)
    mats = kin.world(out, [end])
    r_lo = mats[lower].to_quaternion()
    E1 = mats[lower].translation
    dir1 = (mats[end].translation - E1).normalized()
    new_lo = (dir1.rotation_difference((T - E1).normalized()) @ r_lo).normalized()
    loc, _, sc = out[lower]
    out[lower] = (loc, kin.local_from_world(out, mats, lower, new_lo), sc)
    if keep_end_rot:
        mats = kin.world(out, [end])
        loc, _, sc = out[end]
        out[end] = (loc, kin.local_from_world(out, mats, end, end_rot), sc)
    return out


def swing_twist(q: Quaternion, axis=Vector((0, 1, 0))):
    """q = swing @ twist, twist about ``axis``."""
    p = Vector((q.x, q.y, q.z))
    proj = axis * p.dot(axis)
    twist = Quaternion((q.w, proj.x, proj.y, proj.z))
    if twist.magnitude < 1e-9:
        twist = Quaternion()
    twist.normalize()
    swing = q @ twist.inverted()
    return swing, twist


def twist_angle(twist: Quaternion, axis=Vector((0, 1, 0))):
    ang = 2 * math.atan2(Vector((twist.x, twist.y, twist.z)).dot(axis), twist.w)
    return (ang + math.pi) % (2 * math.pi) - math.pi


def log_q(q: Quaternion) -> np.ndarray:
    if q.w < 0:
        q = -q
    ax, ang = q.to_axis_angle()
    return np.array(ax) * ang


def exp_q(v) -> Quaternion:
    v = Vector(v)
    ang = v.length
    if ang < 1e-9:
        return Quaternion()
    return Quaternion(v.normalized(), ang)


def cartoon(signal: np.ndarray, sigma: float, strength: float) -> np.ndarray:
    """The cartoon animation filter (Wang et al., SIGGRAPH 2006): x - k * LoG(x). Adds
    anticipation before and follow-through after every change of motion, sized by how
    sharp the change is. ``signal`` is (frames, dims); edges are padded."""
    x = np.asarray(signal, dtype=float)
    if strength == 0 or len(x) < 5:
        return x
    r = int(math.ceil(sigma * 4))
    t = np.arange(-r, r + 1, dtype=float)
    g = np.exp(-0.5 * (t / sigma) ** 2)
    log = (t * t / sigma ** 4 - 1 / sigma ** 2) * g
    log -= log.mean()                     # zero DC: flat stretches stay put
    log /= np.sum(log * t * t) / 2        # unit gain on a parabola: ~ the 2nd derivative
    pad = np.pad(x, [(r, r)] + [(0, 0)] * (x.ndim - 1), mode="edge")
    out = np.empty_like(x)
    for j in range(x.shape[1]):
        out[:, j] = np.convolve(pad[:, j], log[::-1], mode="valid")
    # out is ~ the second derivative smoothed (per frame^2); subtract a multiple of it
    return x - strength * sigma * sigma * out
