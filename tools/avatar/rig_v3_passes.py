"""Avatar v3 clean-up passes on sampled poses (lists of ``{bone: (loc, quat, scale)}``, one per
frame, 30 fps). Each pass returns new poses; nothing here touches the scene. Order (see
``render_avatar.stage``): edits -> exaggerate -> limits -> pops -> [ease/loop, breathe] ->
feet -> fingers.

- ``edits``: hand-keyed additive rotations per bone (local, degrees), pose-to-pose with eased
  in-betweens: how poses are pushed further by hand, or whole moves animated from the idle.
- ``reach``: hand-keyed hand positions (world offsets in metres, or targets relative to a
  bone), solved with two-bone IK on the arm, so a hand can be put exactly on the mask.
- ``exaggerate``: scale every bone's departure from the idle (``amp``, per body region) and
  run the cartoon filter (anticipation and overshoot) over the rotations.
- ``limits``: elbows and knees are hinges: no bending backwards, little sideways, bounded
  twist; wrists bounded.
- ``pops``: a bone that jumps further in one frame than its neighbours agree on is replaced
  by the in-between (single-frame flips and pops).
- ``feet``: planted feet (low and slow) are turned flat on the floor, keep their heading,
  stop sliding (each plant holds one spot), and the leg is re-solved with IK to reach it,
  knees towards the toes.
- ``fingers``: hand shapes over time.
"""
import math
import os

import numpy as np
from mathutils import Matrix, Quaternion, Vector

import rig_v3
from rig_v3 import Kin, exp_q, log_q, swing_twist, two_bone_ik

FPS = 30
IDENT = (Vector((0, 0, 0)), Quaternion(), Vector((1, 1, 1)))


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def ease_io(x):
    """Slow in and slow out, a bit snappier than smoothstep (quintic)."""
    x = min(1.0, max(0.0, x))
    return x * x * x * (x * (x * 6 - 15) + 10)


def _curve(keys, t, interp="ease"):
    """Value of a keyed curve [[t, value(s)], ...] at t: eased between keys, held outside."""
    if not keys:
        return None
    keys = sorted(keys, key=lambda k: k[0])
    if t <= keys[0][0]:
        return np.asarray(keys[0][1], float)
    if t >= keys[-1][0]:
        return np.asarray(keys[-1][1], float)
    for (t0, v0), (t1, v1) in zip(keys, keys[1:]):
        if t0 <= t <= t1:
            w = (t - t0) / max(t1 - t0, 1e-9)
            w = ease_io(w) if interp == "ease" else (smoothstep(w) if interp == "smooth" else w)
            return np.asarray(v0, float) * (1 - w) + np.asarray(v1, float) * w
    return np.asarray(keys[-1][1], float)


def _euler_q(deg):
    x, y, z = (math.radians(float(a)) for a in deg)
    return (Quaternion((0, 0, 1), z) @ Quaternion((0, 1, 0), y) @ Quaternion((1, 0, 0), x))


# ---------------------------------------------------------------------------- edits

def edits(poses, spec, kin: Kin = None, fps=FPS):
    """Hand-keyed additive rotations, pose to pose with eased in-betweens.

    ``spec``: {bone: [[t, [x, y, z]], ...]}: degrees about the *world* axes at the bone's
    joint (the character faces -y: +x bends forward, +y leans to his left, +z turns him to
    his left), or {bone: {"keys": ..., "interp": "linear"|"smooth"|"ease", "local": true}}
    for the bone's own axes. ``Hips.loc`` takes [dx, dy, dz] in metres (world)."""
    if not spec:
        return poses
    out = [dict(p) for p in poses]
    order = kin.order if kin else list(spec)
    items = sorted(spec.items(), key=lambda kv: order.index(kv[0].replace(".loc", ""))
                   if kv[0].replace(".loc", "") in order else 0)
    for bone, keys in items:
        interp, local = "ease", kin is None
        if isinstance(keys, dict):
            interp = keys.get("interp", "ease")
            local = keys.get("local", local)
            keys = keys["keys"]
        for f, p in enumerate(out):
            v = _curve(keys, f / fps, interp)
            if bone.endswith(".loc"):
                name = bone[:-4]
                loc, q, s = p[name]
                # the hips' parent space is the armature's (cm, z up, -y forward)
                p[name] = (loc + _hips_space(v * 100.0), q, s)
                continue
            if bone not in p or not np.any(v):
                continue
            loc, q, s = p[bone]
            if local:
                p[bone] = (loc, (q @ _euler_q(v)).normalized(), s)
            else:
                mats = kin.world(p, [bone])
                world = mats[bone].to_quaternion()
                new = (_euler_q(v) @ world).normalized()
                p[bone] = (loc, kin.local_from_world(p, mats, bone, new), s)
    return out


_HIPS_REST = None


def _hips_space(d):
    """A world/armature offset (cm) in the Hips bone's basis space (its rest frame)."""
    if _HIPS_REST is None:
        return Vector(d)
    return _HIPS_REST.to_3x3().inverted() @ Vector(d)


def _hips_space_of(kin: Kin, d: Vector) -> Vector:
    """An armature-space direction in the Hips' basis (location) space."""
    return kin.rest["Hips"].to_3x3().inverted() @ d


def set_hips_rest(kin: Kin):
    global _HIPS_REST
    _HIPS_REST = kin.rest["Hips"]


# ---------------------------------------------------------------------------- reach (IK)

ARM = {s: (f"{s}Arm", f"{s}ForeArm", f"{s}Hand") for s in rig_v3.SIDES}
LEG = {s: (f"{s}UpLeg", f"{s}Leg", f"{s}Foot") for s in rig_v3.SIDES}


def reach(poses, kin: Kin, spec, scale, fps=FPS):
    """``spec``: {side: {"keys": [[t, [dx, dy, dz]], ...], "weight": [[t, w], ...],
    "rel": bone (optional), "pole": [x, y, z] (optional, metres, relative to the shoulder)}}.
    Without ``rel`` the keys are world offsets (m) added to the hand's own path; with ``rel``
    they are targets in that bone's frame (m), blended in by ``weight``. ``scale`` is the
    armature's units per metre (100)."""
    if not spec:
        return poses
    out = list(poses)
    for side, sp in spec.items():
        up, lo, end = ARM[side]
        for f, p in enumerate(out):
            t = f / fps
            w = _curve(sp.get("weight", [[0, 1]]), t, "smooth")
            w = float(w) if w is not None else 1.0
            v = _curve(sp["keys"], t, sp.get("interp", "ease"))
            if w <= 1e-4 or v is None:
                continue
            mats = kin.world(p, [end])
            wrist = mats[end].translation
            if sp.get("rel"):
                # a target carried by that bone: given where it would be in the bind pose
                # (world metres, the character standing in the T-pose facing -y)
                m = kin.world(p, [sp["rel"]])[sp["rel"]]
                goal = m @ kin.rest[sp["rel"]].inverted() @ (Vector(v) * scale)
                target = wrist.lerp(goal, w)
            else:
                target = wrist + Vector(v) * scale * w
            elbow = mats[lo].translation
            sh = mats[up].translation
            if sp.get("pole") and sp.get("rel"):
                m = kin.world(p, [sp["rel"]])[sp["rel"]]
                pole = m @ kin.rest[sp["rel"]].inverted() @ (Vector(sp["pole"]) * scale)
            elif sp.get("pole"):
                pole = sh + Vector(sp["pole"]) * scale
            else:
                # keep the elbow on its side of the shoulder-wrist line
                pole = elbow + (elbow - (sh + wrist) / 2) * 2
            q_end = None
            if sp.get("hand_rot"):
                # hand orientation keyed too (local euler offsets, degrees)
                hr = _curve(sp["hand_rot"], t, "ease")
                q_end = hr
            new = two_bone_ik(kin, p, up, lo, end, target, pole, keep_end_rot=True)
            if os.environ.get("REACH_DEBUG"):
                got = kin.world(new, [end])[end].translation
                print("REACHDBG", side, f, [round(x, 1) for x in target],
                      [round(x, 1) for x in got], [round(x, 1) for x in pole],
                      [round(x, 1) for x in sh])
            if q_end is not None:
                loc, q, s = new[end]
                new[end] = (loc, (q @ _euler_q(q_end * w)).normalized(), s)
            out[f] = new
    return out


def stick(poses, before, kin: Kin, spec, fps=FPS):
    """Keep contacts through the edits: ``spec`` {side: {"to": bone, "weight": [[t, w]...]}}
    puts the hand back where it was relative to ``to`` (e.g. the palm on the mask while
    the body slumps), by IK on the arm, and keeps its orientation relative to it too."""
    if not spec:
        return poses
    out = list(poses)
    for side, sp in spec.items():
        up, lo, end = ARM[side]
        to = sp["to"]
        for f, (p, b) in enumerate(zip(out, before)):
            w = _curve(sp.get("weight", [[0, 1]]), f / fps, "smooth")
            w = float(w) if w is not None else 1.0
            if w <= 1e-4:
                continue
            mb = kin.world(b, [end, to])
            rel = mb[to].inverted() @ mb[end]            # hand in the bone's frame, before
            mp = kin.world(p, [end, to])
            goal = mp[to] @ rel
            if sp.get("offset"):
                # move the contact on the bone (metres in its bind frame: e.g. the palm up
                # from the mask's chin to its eyes)
                off = Vector(sp["offset"]) * 100.0
                goal = goal.copy()
                goal.translation = goal.translation + (
                    mp[to].to_3x3() @ kin.rest[to].to_3x3().inverted() @ off)
            target = mp[end].translation.lerp(goal.translation, w)
            elbow, sh = mp[lo].translation, mp[up].translation
            wrist = mp[end].translation
            pole = elbow + (elbow - (sh + wrist) / 2) * 2
            new = two_bone_ik(kin, p, up, lo, end, target, pole, keep_end_rot=False)
            mn = kin.world(new, [end])
            q_goal = mp[end].to_quaternion().slerp(goal.to_quaternion(), w)
            loc, _, s = new[end]
            new[end] = (loc, kin.local_from_world(new, mn, end, q_goal), s)
            out[f] = new
    return out


# ---------------------------------------------------------------------------- exaggerate

REGIONS = {
    "core": ("Hips", "Spine02", "Spine01", "Spine"),
    "head": ("neck", "Head"),
    "arms": ("LeftShoulder", "LeftArm", "LeftForeArm", "RightShoulder", "RightArm",
             "RightForeArm"),
    "wrists": ("LeftHand", "RightHand"),
    "legs": ("LeftUpLeg", "LeftLeg", "RightUpLeg", "RightLeg"),
}


def exaggerate(poses, idle, spec):
    """``spec``: {"amp": {region: k}, "cartoon": {"sigma": frames, "strength": k,
    "regions": [...]}, "hips_amp": k (the hips' travel)}. Departures from the idle are
    scaled by k in rotation-vector space (k = 1.3 pushes every pose 30 % further)."""
    if not spec:
        return poses
    n = len(poses)
    out = [dict(p) for p in poses]
    amp = spec.get("amp", {})
    car = spec.get("cartoon") or {}
    car_regions = set(car.get("regions", ["core", "head", "arms"]))
    for region, bones in REGIONS.items():
        k = float(amp.get(region, 1.0))
        do_car = region in car_regions and car.get("strength", 0)
        if k == 1.0 and not do_car:
            continue
        for b in bones:
            if b not in idle:
                continue
            qi = idle[b][1]
            logs = []
            prev = None
            for p in out:
                q = qi.inverted() @ p[b][1]
                if prev is not None and q.dot(prev) < 0:
                    q = -q
                prev = q
                v = np.array(q.to_axis_angle()[0]) * q.to_axis_angle()[1]
                logs.append(v)
            raw = np.array(logs)
            logs = raw * k
            if do_car:
                logs = rig_v3.cartoon(logs, float(car.get("sigma", 4)), float(car["strength"]))
            # never push a turn past 165 degrees (or past where it already was): beyond 180
            # the rotation would flip the other way round, through the body
            ang = np.linalg.norm(logs, axis=1)
            lim = np.maximum(np.radians(165), np.linalg.norm(raw, axis=1))
            over = ang > lim
            logs[over] *= (lim[over] / ang[over])[:, None]
            for i, p in enumerate(out):
                loc, _, s = p[b]
                p[b] = (loc, (qi @ exp_q(logs[i])).normalized(), s)
    hk = float(spec.get("hips_amp", 1.0))
    hc = float(spec.get("hips_cartoon", 0.0))
    if hk != 1.0 or hc:
        li = np.array(idle["Hips"][0])
        locs = np.array([np.array(p["Hips"][0]) for p in out]) - li
        locs = locs * hk
        if hc:
            locs = rig_v3.cartoon(locs, float(car.get("sigma", 4)), hc)
        for i, p in enumerate(out):
            _, q, s = p["Hips"]
            p["Hips"] = (Vector(locs[i] + li), q, s)
    return out


# ---------------------------------------------------------------------------- limits

# Elbow hinge axes in the forearm bones' local frames (from a PCA of every clip's elbow
# rotations: the flexion direction), and knee hinges (local X).
HINGE = {"LeftForeArm": Vector((0.742, 0.0, 0.671)).normalized(),
         "RightForeArm": Vector((0.765, 0.0, -0.644)).normalized(),
         "LeftLeg": Vector((1, 0, 0)), "RightLeg": Vector((1, 0, 0))}
LIMITS = {   # flex min/max, sideways max, twist max (degrees)
    "LeftForeArm": (0.0, 150.0, 14.0, 80.0), "RightForeArm": (0.0, 150.0, 14.0, 80.0),
    "LeftLeg": (1.5, 150.0, 6.0, 12.0), "RightLeg": (1.5, 150.0, 6.0, 12.0),
}
WRIST = 75.0


def limits(poses, kin: Kin, keep_hands=True, report=None):
    """Clamp elbows and knees to hinges; keep the hands' world orientation where the elbow
    changed (then clamp the wrist)."""
    out = []
    stats = {b: 0 for b in LIMITS}
    for p in poses:
        p = dict(p)
        hand_rot = {}
        if keep_hands:
            mats = kin.world(p, ["LeftHand", "RightHand"])
            hand_rot = {s: mats[f"{s}Hand"].to_quaternion() for s in rig_v3.SIDES}
        for b, (fmin, fmax, side_max, tw_max) in LIMITS.items():
            loc, q, s = p[b]
            swing, twist = swing_twist(q)
            tw = rig_v3.twist_angle(twist)
            sv = log_q(swing)
            h = np.array(HINGE[b])
            o = np.cross(h, (0, 1, 0))
            flex, off = float(sv @ h), float(sv @ o)
            f2 = min(max(flex, math.radians(fmin)), math.radians(fmax))
            o2 = min(max(off, -math.radians(side_max)), math.radians(side_max))
            t2 = min(max(tw, -math.radians(tw_max)), math.radians(tw_max))
            if abs(f2 - flex) + abs(o2 - off) + abs(t2 - tw) > 1e-4:
                stats[b] += 1
                q2 = exp_q(h * f2 + o * o2) @ Quaternion((0, 1, 0), t2)
                p[b] = (loc, q2.normalized(), s)
        if keep_hands:
            mats = kin.world(p, ["LeftHand", "RightHand"])
            for side in rig_v3.SIDES:
                hb = f"{side}Hand"
                loc, q, s = p[hb]
                q2 = kin.local_from_world(p, mats, hb, hand_rot[side])
                ang = 2 * math.acos(min(1.0, abs(q2.w)))
                if ang > math.radians(WRIST):
                    q2 = Quaternion().slerp(q2 if q2.w >= 0 else -q2, math.radians(WRIST) / ang)
                p[hb] = (loc, q2, s)
        out.append(p)
    if report is not None:
        report.update(stats)
    return out


def pops(poses, thresh_deg=18.0, report=None):
    """Replace single-frame spikes (a bone jumping away and straight back) by the in-between."""
    out = [dict(p) for p in poses]
    n = len(out)
    fixed = 0
    for b in out[0]:
        for it in range(2):
            for i in range(1, n - 1):
                a, c, d = out[i - 1][b][1], out[i][b][1], out[i + 1][b][1]
                ac = math.degrees(a.rotation_difference(c).angle)
                cd = math.degrees(c.rotation_difference(d).angle)
                ad = math.degrees(a.rotation_difference(d).angle)
                if min(ac, cd) > thresh_deg and ad < 0.6 * (ac + cd):
                    loc, _, s = out[i][b]
                    dd = d if a.dot(d) >= 0 else -d
                    out[i][b] = (loc, a.slerp(dd, 0.5), s)
                    fixed += 1
    if report is not None:
        report["pops"] = fixed
    return out


# ---------------------------------------------------------------------------- feet

# The back of each boot's sole relative to its ankle in the bind pose (metres, world axes;
# the character faces -y): the pivot of a toe tap.
HEEL = {"Left": (0.0, 0.105, -0.149), "Right": (0.0, 0.105, -0.150)}

def feet(poses, kin: Kin, scale, spec=None, loop=False, report=None):
    """Flat, planted, non-sliding feet. A foot is planted where its ankle is near the
    clip's standing height and slow; planted feet are turned flat (rest pitch and roll, own
    heading), held at one spot per plant and at standing height, and the leg re-solved."""
    spec = spec or {}
    n = len(poses)
    if n < 3:
        return poses
    out = [dict(p) for p in poses]
    rest = kin.rest
    # One ground for both feet: a flat foot's ankle stands at its rest height above it.
    rest_ank = {s: rest[f"{s}Foot"].translation.z for s in rig_v3.SIDES}
    ankles = {s: np.array([np.array(kin.world(p, [f"{s}Foot"])[f"{s}Foot"].translation)
                           for p in out]) for s in rig_v3.SIDES}
    ground = min(float(np.percentile(ankles[s][:, 2], 10)) - rest_ank[s]
                 for s in rig_v3.SIDES)
    ground = float(spec.get("ground", ground))
    plans = {}
    for side in rig_v3.SIDES:
        up, lo, foot = LEG[side]
        toe = f"{side}ToeBase"
        ank = ankles[side]
        z = ank[:, 2]
        stand = ground + rest_ank[side]
        sp = np.r_[0, np.linalg.norm(np.diff(ank[:, :2], axis=0), axis=1)]
        sp = np.convolve(np.pad(sp, 2, mode="edge"), np.ones(5) / 5, mode="valid")
        h_tol = float(spec.get("height", 0.04)) * scale
        v_tol = float(spec.get("speed", 0.04)) * scale
        low = np.clip(1 - (z - stand - h_tol * 0.6) / (h_tol * 0.6), 0, 1)
        slow = np.clip(1 - (sp - v_tol * 0.5) / (v_tol * 0.5), 0, 1)
        w = low * slow
        # no isolated flickers: open/close, then soften the edges over 3 frames
        hard = w > 0.5
        for _ in range(2):
            hard = np.array([hard[max(0, i - 1):i + 2].all() if hard[i] else
                             hard[max(0, i - 1):i + 2].sum() >= 2 for i in range(n)])
        if spec.get("swing") and spec.get("ends"):
            # an eased move starts and ends on the idle: its first and last frames are
            # plants, so a foot stepping back to the idle lands there rather than sliding
            for e in (slice(0, 2), slice(n - 2, n)):
                if low[e].min() > 0.5:
                    hard[e] = True
        soft = np.convolve(np.pad(hard.astype(float), 3, mode="edge"), np.ones(7) / 7,
                           mode="valid")
        w = np.minimum(np.maximum(soft, 0), 1)
        if spec.get("off"):
            for a, b in spec["off"]:      # seconds where this foot is lifted on purpose
                w[int(a * FPS):int(b * FPS) + 1] = 0
        # one spot per plant (where it lands), heights to standing
        lock = ank.copy()
        lock[:, 2] = stand
        segs = []
        i = 0
        while i < n:
            if hard[i]:
                j = i
                while j < n and hard[j]:
                    j += 1
                segs.append((i, j))
                i = j
            else:
                i += 1
        if spec.get("swing"):
            w[hard] = 1.0             # fully held on every planted frame (the ramp is outside)
        wr = w.copy()                 # how flat the foot is turned
        sw = np.zeros(n, bool)        # stepping frames (between two plants)
        for k, (i, j) in enumerate(segs):
            # where the foot lands (its first few planted frames), not the plant's
            # average: blending into an average spot slid the foot as it landed
            spot = ank[i:min(j, i + 2), :2].mean(0)
            swing = bool(spec.get("swing"))
            lo_ = i if (k and swing) else max(0, i - 3)   # edges with no swing: soft blend
            hi_ = j if (k < len(segs) - 1 and swing) else min(n, j + 3)
            lock[lo_:hi_, :2] = spot
        # v3.3: between two plants the foot *steps*: it leaves one spot and lands on the next
        # along the clip's own path (offset-blended so both ends are exact), lifted on an arc
        # so it is never dragged along the floor, and turned flat again before it lands.
        # Blending a planted spot in and out over a few frames is what slid feet at landings.
        if spec.get("swing"):
            for (i0, j0), (i1, j1) in zip(segs, segs[1:]):
                a, b = j0 - 1, i1
                m = b - a
                if m < 2:
                    continue
                A, B = lock[a, :2].copy(), lock[b, :2].copy()
                d = float(np.linalg.norm(B - A))
                t = np.array([smoothstep(x) for x in np.linspace(0, 1, m + 1)])
                if d > 0.02 * scale:
                    prog = np.clip(((ank[a:b + 1, :2] - A) @ (B - A)) / (d * d), 0, 1)
                    prog = np.maximum.accumulate(prog)
                    s = 0.5 * (prog + t)
                else:
                    s = t
                s[0], s[-1] = 0.0, 1.0
                off0, off1 = A - ank[a, :2], B - ank[b, :2]
                bump = np.sin(np.pi * s)
                lift = min(float(spec.get("lift", 0.06)), 0.35 * d / scale + 0.02) * scale
                for q in range(1, m):
                    f = a + q
                    lock[f, :2] = ank[f, :2] + off0 * (1 - s[q]) + off1 * s[q]
                    # clearance: never closer to the floor than to either spot, so the
                    # foot can't move along the floor (lift-off and touch-down included)
                    near = min(np.linalg.norm(lock[f, :2] - A), np.linalg.norm(lock[f, :2] - B))
                    lock[f, 2] = max(ank[f, 2], stand + lift * bump[q],
                                     stand + min(lift, 1.2 * float(near)))
                    w[f] = 1.0
                    wr[f] = 1.0 - bump[q] ** 3
                    sw[f] = True
        if os.environ.get("FEET_DEBUG"):
            print("FEETDBG", side, segs, [round(float(x), 2) for x in low[::3]])
        plans[side] = (w, lock, hard, wr, stand, sw)
    # Where a planted foot can't reach its spot with the leg (nearly) straight, the hips come
    # down just enough (smoothed): no floating foot.
    drop = np.zeros(n)
    for side in rig_v3.SIDES:
        up, lo, foot = LEG[side]
        w, lock = plans[side][:2]
        for f, p in enumerate(out):
            if w[f] < 1e-3:
                continue
            m = kin.world(p, [foot])
            H, K, A = m[up].translation, m[lo].translation, m[foot].translation
            reach_max = ((K - H).length + (A - K).length) * 0.996
            T = Vector(lock[f])
            dh = (T.to_2d() - H.to_2d()).length
            if dh >= reach_max:
                continue
            need = (H.z - T.z) - math.sqrt(reach_max ** 2 - dh ** 2)
            drop[f] = max(drop[f], need * w[f])
    if drop.max() > 1e-3:
        r = 3
        drop = np.array([drop[max(0, i - r): i + r + 1].max() for i in range(n)])
        k = np.exp(-0.5 * (np.arange(-6, 7) / 2.0) ** 2)
        drop = np.maximum(np.convolve(np.pad(drop, 6, mode="edge"), k / k.sum(), "valid"), drop)
        down = _hips_space_of(kin, Vector((0, 0, -1)))
        for f, p in enumerate(out):
            if drop[f] > 1e-4:
                loc, q, s = p["Hips"]
                out[f] = {**p, "Hips": (loc + down * float(drop[f]), q, s)}
    if report is not None:
        report["hips_drop_cm"] = round(float(drop.max()), 2)
    for side in rig_v3.SIDES:
        up, lo, foot = LEG[side]
        toe = f"{side}ToeBase"
        w, lock, hard, wr, stand, sw = plans[side]
        ank = np.array([np.array(kin.world(p, [foot])[foot].translation) for p in out])
        # the rest foot's world rotation, turned to the foot's heading
        r_rest = rest[foot].to_quaternion()
        fwd_rest = rest[foot].to_3x3() @ Vector((0, 1, 0))
        fwd_rest.z = 0
        flat_count = 0
        for f, p in enumerate(out):
            wf = float(w[f])
            if wf < 1e-3:
                continue
            m = kin.world(p, [toe])
            r_now = m[foot].to_quaternion()
            fwd = m[foot].to_3x3() @ Vector((0, 1, 0))
            fwd.z = 0
            yaw = fwd_rest.to_2d().angle_signed(fwd.to_2d(), 0.0) if fwd.length > 1e-6 else 0.0
            r_flat = Quaternion((0, 0, 1), -yaw) @ r_rest
            if r_flat.dot(r_now) < 0:
                r_flat = -r_flat
            r_goal = r_now.slerp(r_flat, float(wr[f]))
            target = Vector(ank[f]).lerp(Vector(lock[f]), wf)
            if sw[f]:
                # a stepping foot that tips (toes down, heel down) is raised by what the tip
                # costs, so the clearance holds for the sole, not just the ankle
                d_rot = r_goal @ r_flat.inverted()
                hz = Quaternion((0, 0, 1), -yaw)
                dip = 0.0
                for pt in (Vector(HEEL[side]), Vector((0.0, -0.17, HEEL[side][2]))):
                    v = hz @ pt * scale
                    dip = max(dip, v.z - (d_rot @ v).z)
                target.z += dip
            tap = (spec.get("toe_tap") or {}).get(side)
            if tap:
                # a toe tap: the planted foot pivots up about its heel (degrees, keyed)
                ang = float(_curve(tap, f / FPS, "smooth"))
                if abs(ang) > 1e-3:
                    side_ax = (r_flat @ Vector((1, 0, 0)))
                    side_ax.z = 0
                    fwd_flat = r_flat @ Vector((0, 1, 0))
                    lat = Vector((0, 0, 1)).cross(Vector((fwd.x, fwd.y, 0)).normalized())
                    # heel (back of the sole) relative to the ankle, at the flat pose
                    heel = Quaternion((0, 0, 1), -yaw) @ Vector(HEEL[side]) * scale
                    pivot = target + heel
                    rot = Quaternion(lat, math.radians(ang))
                    if (rot @ (-heel)).z < (-heel).z:     # toes must go up
                        rot = rot.inverted()
                    target = pivot + rot @ (target - pivot)
                    r_goal = (rot @ r_goal).normalized()
            knee = m[lo].translation
            hip = m[up].translation
            # knees bend towards the toes: pole ahead of the knee along the foot's heading
            pole = knee + (fwd.normalized() if fwd.length > 1e-6 else Vector((0, -1, 0))) * 40
            pole.z = max(pole.z, knee.z)
            p = two_bone_ik(kin, p, up, lo, foot, target, pole, keep_end_rot=False)
            m2 = kin.world(p, [foot])
            loc, _, s = p[foot]
            p[foot] = (loc, kin.local_from_world(p, m2, foot, r_goal), s)
            loc, q, s = p[toe]
            qi = Quaternion()
            if qi.dot(q) < 0:
                qi = -qi
            p[toe] = (loc, q.slerp(qi, float(wr[f])), s)
            out[f] = p
            flat_count += 1
        if report is not None:
            report[side] = {"planted_frames": int(hard.sum()), "flattened": flat_count,
                            "stand_cm": round(stand, 1)}
    return out


# ---------------------------------------------------------------------------- fingers

def fingers(poses, keys, fps=FPS):
    track = rig_v3.hands_track(len(poses), keys, fps)
    return [{**p, **h} for p, h in zip(poses, track)]


def fill(pose, names):
    """Give a pose every bone (missing ones at rest)."""
    if all(n in pose for n in names):
        return pose
    return {n: pose.get(n, IDENT) for n in names}
