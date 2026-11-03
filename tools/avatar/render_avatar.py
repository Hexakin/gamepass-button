"""Render one animated clip of the full-body Hexakin avatar (Blender, headless).

    blender -b -P render_avatar.py -- measure GLB CLIP OUT.json [OPTS.json]
    blender -b -P render_avatar.py -- render GLB CLIP OUT_DIR FRAMING.json [WIDTHxHEIGHT]
    blender -b -P render_avatar.py -- idle GLB CLIP FRAME OUT.json

Every clip is first *staged*: the Meshy clip is resampled and cleaned up in Blender before
anything is measured or rendered (``OPTS``; for ``render`` they ride in FRAMING.json as
``opts``):

- ``trim``: [start, end] seconds of the source clip to keep; ``retime``: [[start, end,
  stretch]] plays a stretch of it slower (> 1) or faster (< 1).
- ``face``: turn the whole clip towards the camera (``1`` = remove its average turn; ``follow``
  between 0 and 1 also removes that fraction of any turn *during* the clip).
- ``centre``: slide the clip so the hips stay over the feet's spot on average (the anchor).
- ``hands``: push the hands out of the hood and mask wherever the skinned mesh says they sink
  in (the upper arm swings out by just enough, smoothed over time).
- ``ease``: frames to blend in from and out to the shared neutral idle (``idle.json``), so
  every move starts and ends in the same pose and cues can cut between them.
- ``loop``: crossfade the tail into the head instead (seamless loop; no idle at the ends).
- ``mic``: {hand, release}: a microphone prop in that hand, dropped at ``release`` s.
- ``still``: seconds of the shared idle alone (breathing): the neutral ``idle`` move.
- ``breathe``: a slight breathing sway on the spine (an integer number of breaths per clip, so
  loops stay seamless).
- the floor: every frame, the body is lifted by however far any vertex would go below the
  idle stance's sole line, so feet and knees never sink, and a clip whose lowest frame stays
  above that line is brought down to it (no hovering); the soles stand on z = 0.

``measure`` samples the staged clip and writes JSON: its length, the world bounding box of the
skinned mesh over every frame, a coarse point cloud of everywhere the body goes, the time of
the most extreme pose, and how far the last frame is from the first (small = loopable).

``render`` writes OUT_DIR/frame_0000.png... (transparent RGBA, 30 fps) and OUT_DIR/meta.json
(where the feet stand in the frame); with POSE_ONLY=1, just OUT_DIR/pose.png (the frame at
``pose_time``). FRAMING.json holds the union of every clip's point cloud, so the camera is
identical for all of them: the character never jumps between clips.

Look (v2): the Meshy texture as it is (black, gunmetal, red) under a dim key and a cool fill,
cool-white rims from behind both sides so the black coat separates from dark navy video
backgrounds, a soft red kicker, AgX (Medium High Contrast). The red of the texture is keyed
out (hue/saturation) and made emissive: a soft glow on the trim, a strong one on the X eyes
and the chest X, plus a little bloom. The mask is darkened and made metallic (gunmetal), the
rest matte.
"""
import json
import math
import os
import sys

import bpy
import mathutils
import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import rig_v3  # noqa: E402  (finger bones, kinematics)
import rig_v3_passes as P  # noqa: E402  (the v3 clean-up passes)

FPS = 30
AZIMUTH = 22.0      # degrees round from straight-on (towards the character's left side)
ELEVATION = -6.0    # camera this many degrees below the target, looking up: heroic
LENS = 70.0
VOXEL = 0.04        # metres: grid the measured point cloud is snapped to
MARGIN = 0.02       # fraction of the frame kept clear round the union point cloud
HERE = os.path.dirname(os.path.abspath(__file__))
IDLE = os.path.join(HERE, "idle.json")


# ---------------------------------------------------------------------------- loading

def load(glb: str, clip: str):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = FPS              # the glTF importer turns seconds into frames at this rate
    bpy.ops.import_scene.gltf(filepath=glb)
    arm = next(o for o in scene.objects if o.type == "ARMATURE")
    body = [o for o in scene.objects if o.type == "MESH"
            and any(m.type == "ARMATURE" for m in o.modifiers)]
    for o in scene.objects:             # Meshy ships an icosphere bone shape: never render it
        if o.type == "MESH" and o not in body:
            o.hide_render = o.hide_viewport = True
    action = bpy.data.actions.get(clip)
    if action is None and len(bpy.data.actions) == 1:     # a v3 GLB: its one action
        action = bpy.data.actions[0]
    if action is None:
        names = ", ".join(a.name for a in bpy.data.actions)
        raise SystemExit(f"{glb} has no clip {clip!r} (it has: {names})")
    assign(arm, action)
    start, end = (int(round(x)) for x in action.frame_range)
    scene.frame_start, scene.frame_end = start, max(end, start + 1)
    return scene, arm, body


def assign(arm, action):
    arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and arm.animation_data.action_slot is None:
        slots = getattr(action, "slots", [])
        if slots:
            arm.animation_data.action_slot = slots[0]


def vertices(body) -> np.ndarray:
    dg = bpy.context.evaluated_depsgraph_get()
    out = []
    for o in body:
        ev = o.evaluated_get(dg)
        mesh = ev.to_mesh()
        co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        m = np.array(ev.matrix_world)
        out.append(co @ m[:3, :3].T + m[:3, 3])
        ev.to_mesh_clear()
    return np.concatenate(out)


def normals(body) -> np.ndarray:
    dg = bpy.context.evaluated_depsgraph_get()
    ev = body[0].evaluated_get(dg)
    mesh = ev.to_mesh()
    n = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("normal", n)
    ev.to_mesh_clear()
    m = np.array(ev.matrix_world)[:3, :3]
    n = n.reshape(-1, 3) @ m.T
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)


# ---------------------------------------------------------------------------- poses

FEET = ("LeftFoot", "RightFoot", "LeftToeBase", "RightToeBase")


def feet_z(arm) -> float:
    """World height of the lowest foot or toe joint (the evaluated pose)."""
    return min((arm.matrix_world @ arm.pose.bones[b].head).z for b in FEET
               if b in arm.pose.bones)


def sample(arm, scene, frames, feet=None):
    """Every bone's local loc/rot/scale at each frame: {bone: [(loc, quat, scale), ...]}
    (and, into ``feet`` if given, the lowest foot joint's height per frame)."""
    out = {pb.name: [] for pb in arm.pose.bones}
    for f in frames:
        scene.frame_set(int(math.floor(f)), subframe=float(f - math.floor(f)))
        if feet is not None:
            feet.append(feet_z(arm))
        for pb in arm.pose.bones:
            q = (pb.rotation_quaternion.copy() if pb.rotation_mode == "QUATERNION"
                 else pb.rotation_euler.to_quaternion())
            out[pb.name].append((pb.location.copy(), q, pb.scale.copy()))
    return out


def blend(a, b, w):
    """Pose a -> pose b by w (per bone: lerp loc and scale, slerp rotation)."""
    out = {}
    for name in b:
        la, qa, sa = a.get(name, b[name])
        lb, qb, sb = b[name]
        if qa.dot(qb) < 0:
            qb = -qb
        out[name] = (la.lerp(lb, w), qa.slerp(qb, w), sa.lerp(sb, w))
    return out


def frame_pose(track, i):
    return {name: track[name][i] for name in track}


def smoothstep(x):
    x = min(1.0, max(0.0, x))
    return x * x * (3 - 2 * x)


def basis_matrix(loc, q, s):
    return Matrix.LocRotScale(loc, q, s)


def apply_pose(arm, pose):
    for pb in arm.pose.bones:
        if pb.name in pose:
            loc, q, s = pose[pb.name]
            pb.rotation_mode = "QUATERNION"
            pb.location, pb.rotation_quaternion, pb.scale = loc, q, s


def write_action(arm, poses, name, obj_z=None):
    """A fresh action holding ``poses`` (one per frame, from frame 0) and, if given, the
    armature object's height per frame."""
    act = bpy.data.actions.new(name)
    assign(arm, act)
    n = len(poses)
    xs = np.arange(n, dtype=np.float32)

    def curve(path, index, values, group):
        if hasattr(act, "fcurve_ensure_for_datablock"):
            fc = act.fcurve_ensure_for_datablock(arm, path, index=index, group_name=group)
        else:
            fc = act.fcurves.new(path, index=index, action_group=group)
        fc.keyframe_points.add(n)
        co = np.empty(n * 2, dtype=np.float32)
        co[0::2], co[1::2] = xs, np.asarray(values, dtype=np.float32)
        fc.keyframe_points.foreach_set("co", co)
        fc.keyframe_points.foreach_set("interpolation", [1] * n)   # LINEAR: every frame is keyed
        fc.update()

    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        b = f'pose.bones["{pb.name}"]'
        locs = [p[pb.name][0] for p in poses]
        quats = [p[pb.name][1] for p in poses]
        scales = [p[pb.name][2] for p in poses]
        for i in range(3):
            curve(f"{b}.location", i, [v[i] for v in locs], pb.name)
            curve(f"{b}.scale", i, [v[i] for v in scales], pb.name)
        # keep quaternions in one hemisphere frame to frame so the curves don't flip
        fixed = [quats[0]]
        for q in quats[1:]:
            fixed.append(-q if fixed[-1].dot(q) < 0 else q)
        for i in range(4):
            curve(f"{b}.rotation_quaternion", i, [q[i] for q in fixed], pb.name)
    if obj_z is not None:
        curve("location", 2, obj_z, "Object Transforms")
    return act


# ---------------------------------------------------------------------------- staging

def _root_correct(arm, track, n, yaw, shift):
    """Rotate the hips (root) about world Z by yaw[i] round the hips, then move them by
    shift[i] (armature units), per frame."""
    hips = arm.pose.bones["Hips"]
    bml = hips.bone.matrix_local
    inv = bml.inverted()
    for i in range(n):
        loc, q, s = track["Hips"][i]
        m = bml @ basis_matrix(loc, q, s)                 # armature space
        p = m.translation.copy()
        r = Matrix.Rotation(yaw[i], 4, "Z")
        d = Vector((shift[i][0], shift[i][1], shift[i][2] if len(shift[i]) > 2 else 0.0))
        m2 = Matrix.Translation(p + d) @ r @ Matrix.Translation(-p) @ m
        b = inv @ m2
        l2, q2, s2 = b.decompose()
        track["Hips"][i] = (l2, q2, s2)


def _hips_frame(arm, track, i):
    """The hips' armature-space position and facing yaw (from the hip line) at frame i."""
    hips = arm.pose.bones["Hips"]
    m = hips.bone.matrix_local @ basis_matrix(*track["Hips"][i])
    # The hips bone's local X runs across the pelvis (character's left), as in the rest pose.
    rest_x = (hips.bone.matrix_local.to_3x3() @ Vector((1, 0, 0)))
    x = m.to_3x3() @ (hips.bone.matrix_local.to_3x3().inverted() @ rest_x)
    yaw = math.atan2(x.y, x.x) - math.atan2(rest_x.y, rest_x.x)
    return m.translation.copy(), yaw


def _unwrap(a):
    return np.unwrap(np.asarray(a, dtype=float))


def _smooth(x, sigma):
    x = np.asarray(x, dtype=float)
    if sigma <= 0 or len(x) < 3:
        return x
    r = int(math.ceil(sigma * 3))
    k = np.exp(-0.5 * (np.arange(-r, r + 1) / sigma) ** 2)
    k /= k.sum()
    pad = np.pad(x, [(r, r)] + [(0, 0)] * (x.ndim - 1), mode="edge")
    if x.ndim == 1:
        return np.convolve(pad, k, mode="valid")
    return np.stack([np.convolve(pad[:, j], k, mode="valid") for j in range(x.shape[1])], 1)


def _maxfilter(x, r):
    x = np.asarray(x, dtype=float)
    return np.array([x[max(0, i - r): i + r + 1].max(axis=0) for i in range(len(x))])


def _groups(body, names, threshold):
    """Indices of the vertices weighted more than ``threshold`` to any of ``names``."""
    ob = body[0]
    gi = {g.index for g in ob.vertex_groups if g.name in names}
    return np.array([v.index for v in ob.data.vertices
                     if sum(g.weight for g in v.groups if g.group in gi) > threshold], dtype=int)


def _swing(arm, side, delta_world):
    """Swing the upper arm about the shoulder so the wrist moves by ``delta_world`` (m)."""
    up = arm.pose.bones[f"{side}Arm"]
    hand = arm.pose.bones[f"{side}Hand"]
    to_arm = arm.matrix_world.inverted().to_3x3()
    d = to_arm @ Vector(delta_world)
    s, w = up.head.copy(), hand.head.copy()
    a, b = (w - s), (w + d - s)
    if a.length < 1e-6 or b.length < 1e-6:
        return
    r = a.rotation_difference(b).to_matrix().to_4x4()
    m2 = Matrix.Translation(s) @ r @ Matrix.Translation(-s) @ up.matrix
    up.matrix = m2


def stage(glb: str, clip: str, opts: dict):
    """Load the clip and replace its action with the cleaned-up one. Returns scene, arm, body."""
    scene, arm, body = load(glb, clip)
    if opts.get("staged"):            # a v3 source: cleaned already (``fix``); just play it
        return scene, arm, body
    rig_v3.add_fingers(arm, body[0])
    kin = rig_v3.Kin(arm)
    P.set_hips_rest(kin)
    units = 1.0 / arm.scale.z         # armature units per metre
    src = range(scene.frame_start, scene.frame_end + 1)
    trim = opts.get("trim")
    frames = list(src)
    if trim:
        a, b = (int(round(t * FPS)) + scene.frame_start for t in trim)
        frames = [f for f in frames if a <= f <= b]
    if opts.get("retime"):
        # [[start, end, stretch], ...] in source seconds: play that stretch slower (> 1)
        # or faster (< 1); e.g. a collapse that snaps can take a few more frames.
        times, f = [], float(frames[0])
        while f <= frames[-1]:
            times.append(f)
            k = 1.0
            for a, b, stretch in opts["retime"]:
                if a * FPS <= f - scene.frame_start < b * FPS:
                    k = float(stretch)
            f += 1.0 / k
        frames = times
    feet = []
    track = sample(arm, scene, frames, feet)
    n = len(frames)
    # Face the camera and stay over the anchor.
    face = opts.get("face")
    if face is not None or opts.get("centre", True):
        info = [_hips_frame(arm, track, i) for i in range(n)]
        yaws = _unwrap([y for _, y in info])
        yaw = np.zeros(n)
        if face is not None:
            mean = math.atan2(np.sin(yaws).mean(), np.cos(yaws).mean())
            follow = float(opts.get("follow", 0.0))
            dev = _unwrap(yaws) - mean
            dev = (dev + math.pi) % (2 * math.pi) - math.pi
            yaw = -(float(face) * mean + follow * _smooth(dev, 4))
        _root_correct(arm, track, n, yaw, [(0, 0)] * n)
        shift = [(0.0, 0.0)] * n
        if opts.get("centre", True) and os.path.exists(IDLE):
            # Stand on the idle's sole line: Meshy clips stand a centimetre or so lower or
            # higher than each other; the typical (median) lowest foot joint is aligned.
            idle_feet = json.load(open(IDLE)).get("feet_z")
            if idle_feet is not None:
                dz = (float(idle_feet) - float(np.median(feet))) / arm.scale.z
                _root_correct(arm, track, n, [0.0] * n, [(0.0, 0.0, dz)] * n)
        if opts.get("centre", True):
            pos = np.array([_hips_frame(arm, track, i)[0][:2] for i in range(n)])
            idle = json.load(open(IDLE)) if os.path.exists(IDLE) else None
            target = np.array(idle["hips_xy"]) if idle else np.zeros(2)
            mode = opts.get("centre", True)
            if mode == "follow":       # keep the hips over the spot all the way through
                off = target - _smooth(pos, 6)
            else:                      # just remove the clip's average offset
                off = np.tile(target - pos.mean(0), (n, 1))
            shift = [tuple(o) for o in off]
            _root_correct(arm, track, n, [0.0] * n, shift)
    poses = [frame_pose(track, i) for i in range(n)]
    if opts.get("still") and os.path.exists(IDLE):
        # Just the idle, breathing: a neutral move to stand in between reactions (or the
        # base a hand-animated move is keyed on).
        poses = [idle_pose() for _ in range(int(round(float(opts["still"]) * FPS)))]
    names = [pb.name for pb in arm.pose.bones]
    poses = [P.fill(p, names) for p in poses]
    report = {}
    # v3: hand-keyed pushes, IK reaches, exaggeration, then joint limits and pop removal.
    if os.path.exists(IDLE):
        poses = P.exaggerate(poses, P.fill(idle_pose(), names), opts.get("push"))
    before = poses
    poses = P.edits(poses, opts.get("edits"), kin)
    poses = P.reach(poses, kin, opts.get("reach"), units)
    poses = P.stick(poses, before, kin, opts.get("stick"))
    poses = P.reach(poses, kin, opts.get("reach_after"), units)
    n = len(poses)
    # Ends: a seamless loop, or ease in from and out to the shared idle.
    if opts.get("loop"):
        k = min(int(opts.get("loop_blend", 12)), n // 3)
        full = poses
        poses = full[:n - k]
        for i in range(k):
            # the tail (frames n-k..n-1) fades into the head, so the last frame flows into
            # the first
            poses[i] = blend(full[n - k + i], full[i], smoothstep((i + 1) / (k + 1)))
    ease = int(opts.get("ease", 0))
    if ease and os.path.exists(IDLE) and not opts.get("loop"):
        idle = idle_pose()
        hold = int(opts.get("hold_in", 0))
        out = [idle] * hold
        for i, p in enumerate(poses):
            w_in = smoothstep(i / ease)
            eo = int(opts.get("ease_out", ease))
            w_out = smoothstep((len(poses) - 1 - i) / eo) if eo else 1.0
            out.append(blend(idle, p, min(w_in, w_out)))
        poses = out + [idle] * int(opts.get("hold_out", 0))
    # Breathing: a slow sway of the spine, an integer number of breaths over the clip.
    if opts.get("breathe", True):
        n2 = len(poses)
        cycles = max(1, round(n2 / FPS / 3.4))
        for i, p in enumerate(poses):
            ph = 2 * math.pi * cycles * i / n2
            for bone, amp in (("Spine01", 1.1), ("Spine", 0.9), ("neck", -0.8)):
                if bone in p:
                    loc, q, s = p[bone]
                    dq = Quaternion((1, 0, 0), math.radians(amp) * math.sin(ph))
                    p = {**p, bone: (loc, q @ dq, s)}
            for bone, amp in (("LeftShoulder", 1.2), ("RightShoulder", 1.2)):
                if bone in p:
                    loc, q, s = p[bone]
                    dq = Quaternion((0, 0, 1), math.radians(amp) * math.sin(ph) *
                                    (1 if bone.startswith("Left") else -1))
                    p = {**p, bone: (loc, q @ dq, s)}
            poses[i] = p
    # v3: joint limits and pops, flat planted feet (after the ease, so the idle is fixed the
    # same way in every move), then the hand shapes.
    if opts.get("limits", True):
        poses = P.limits(poses, kin, report=report)
        poses = P.pops(poses, report=report)
    print("LIMITS", json.dumps(report))
    if opts.get("feet", {}) is not False:
        rep = {}
        fspec = dict(opts.get("feet") or {})
        if "ground" not in fspec and os.path.exists(IDLE):
            # One ground for every move: the idle's. A clip whose feet sink lower than the
            # idle's (Meshy bases stand a few cm apart) would otherwise read the idle frames
            # it eases from as lifted feet and leave them unflattened (toes up).
            idle_w = kin.world(P.fill(idle_pose(), names), ["LeftFoot", "RightFoot"])
            fspec["ground"] = min(idle_w[f"{s}Foot"].translation.z
                                  - kin.rest[f"{s}Foot"].translation.z
                                  for s in ("Left", "Right"))
        fspec.setdefault("ends", bool(ease) and not opts.get("loop"))
        poses = P.feet(poses, kin, units, fspec, loop=bool(opts.get("loop")),
                       report=rep)
        print("FEET", json.dumps(rep))
    poses = P.fingers(poses, opts.get("fingers", "relaxed"))
    act = write_action(arm, poses, f"{clip}_staged")
    scene.frame_start, scene.frame_end = 0, len(poses) - 1
    # Hands and forearms out of the head and the torso (v3: every move, mesh-checked).
    if opts.get("clips", True):
        _fix_clips(scene, arm, body, poses, opts)
        act = write_action(arm, poses, f"{clip}_staged_clips")
    # The floor.
    floor = float(json.load(open(IDLE))["floor"]) if os.path.exists(IDLE) else 0.0
    lows = []
    for f in range(len(poses)):
        scene.frame_set(f)
        lows.append(float(vertices(body)[:, 2].min()))
    raw = np.maximum(0.0, floor - np.array(lows))
    lift = np.maximum(_smooth(_maxfilter(raw, 2), 1.2), raw)
    if ease and not opts.get("loop"):
        # the first and last frames are the idle itself: no lift leaking into them
        env = np.array([min(smoothstep(i / 4), smoothstep((len(lift) - 1 - i) / 4))
                        for i in range(len(lift))])
        lift = np.maximum(lift * env, raw)
    # ...and a clip that never touches the floor (a hop dance, say) comes down until its
    # lowest frame does, so he never hovers above the baseline.
    hover = max(0.0, min(lows) - floor)
    z = lift - floor - hover              # world metres (the armature has no parent)
    act = write_action(arm, poses, f"{clip}_final", obj_z=list(z))
    scene.frame_set(0)
    return scene, arm, body


# Each solid part's axis (two joints): pushes go straight out from it.
AXES = {"head": ("Head", "head_end"), "torso": ("Hips", "neck"),
        "L_leg": ("LeftUpLeg", "LeftLeg"), "R_leg": ("RightUpLeg", "RightLeg"),
        "L_fore": ("LeftForeArm", "LeftHand"), "R_fore": ("RightForeArm", "RightHand")}


def _fix_clips(scene, arm, body, poses, opts):
    """Move the wrist out (two-bone IK) wherever its hand or forearm is inside the head, the
    torso or a leg (mesh check: ``rig_v3_qa.penetration``), by just enough to rest on the
    surface plus a small margin, smoothed over time; repeated until clear (at most
    ``clip_passes``). ``clip_arms: true`` also keeps each hand out of the other arm."""
    import rig_v3_qa as Q
    parts = Q.part_index(body[0])
    kin = rig_v3.Kin(arm)
    margin = float(opts.get("clip_margin", 0.006))
    solids = opts.get("clip_solids", ["head", "torso", "L_leg", "R_leg"])
    n = len(poses)
    total = {s: np.zeros((n, 3)) for s in ("Left", "Right")}
    limit = float(opts.get("clip_max", 0.18))      # metres the wrist may move in all
    for rnd in range(int(opts.get("clip_passes", 10))):
        deltas = {s: np.zeros((n, 3)) for s in ("Left", "Right")}
        for f in range(n):
            scene.frame_set(f)
            co, nr = Q.evaluated(body[0])
            mw = arm.matrix_world
            for s in ("Left", "Right"):
                mover = np.concatenate([parts[f"{s[0]}_hand"], parts[f"{s[0]}_wrist"]])
                best = np.zeros(3)
                sh = np.array(mw @ arm.pose.bones[f"{s}Arm"].head)
                wr = np.array(mw @ arm.pose.bones[f"{s}Hand"].head)
                other = "R" if s == "Left" else "L"
                extra = [f"{other}_fore", f"{other}_hand"] if opts.get("clip_arms") else []
                for solid in [*solids, *extra]:     # wedged between two: both pushes
                    mv = mover
                    if solid == "head" and opts.get("clip_fore_head"):
                        # v3.3: the whole forearm out of the hood, not only its wrist half
                        # (an arm flung over the head crosses it near the elbow)
                        mv = np.concatenate([parts[f"{s[0]}_hand"], parts[f"{s[0]}_fore"]])
                    d, push = Q.penetration(co, nr, mv, parts[solid], step=3)
                    if d > 0.004 and solid in AXES and Q.LAST_POINT is not None:
                        # v3.2: push out radially from the part's bone axis, not along the
                        # mesh normals: the Meshy mesh is a triangle soup whose normals flip
                        # from face to face, and normal pushes drove some hands deeper
                        a, b = (np.array(mw @ arm.pose.bones[n].head) for n in AXES[solid])
                        pt = np.array(Q.LAST_POINT)
                        ab = b - a
                        t = np.clip(np.dot(pt - a, ab) / max(np.dot(ab, ab), 1e-9), 0, 1)
                        r = pt - (a + t * ab)
                        if np.linalg.norm(r) > 1e-4:
                            push = r / np.linalg.norm(r) * d
                    if d > 0.004:
                        # the arm swings about the shoulder: a point nearer the shoulder than
                        # the wrist moves less, so the wrist has to move further
                        lever = np.linalg.norm(wr - sh) / max(
                            np.linalg.norm(Q.LAST_POINT - sh), 0.08)
                        best = best + push / max(d, 1e-9) * (d + margin) * min(lever, 3.0)
                mag = np.linalg.norm(best)
                cap = float(opts.get("clip_step", 0.05))     # per pass: no runaway swings
                deltas[s][f] = best * (cap / mag if mag > cap else 1.0)
        moved = False
        for s in deltas:
            d = deltas[s]
            mag = np.linalg.norm(d, axis=1)
            print(f"CLIP {s} pass {rnd}: max push {mag.max() * 100:.1f} cm, "
                  f"{int((mag > 0.004).sum())} frames")
            if mag.max() < 0.004:
                continue
            moved = True
            d = _smooth(_maxfilter(d, 1), 1.2)
            d = np.where(np.linalg.norm(d, axis=1, keepdims=True) < np.linalg.norm(deltas[s], axis=1, keepdims=True), deltas[s], d)
            # in all, the wrist moves at most ``clip_max`` from where the clip had it
            for f in range(n):
                t = total[s][f] + d[f]
                tl = np.linalg.norm(t)
                if tl > limit:
                    t = t * (limit / tl)
                d[f] = t - total[s][f]
                total[s][f] = t
            to_arm = arm.matrix_world.inverted().to_3x3()
            up, lo, end = f"{s}Arm", f"{s}ForeArm", f"{s}Hand"
            for f in range(n):
                if np.linalg.norm(d[f]) < 1e-4:
                    continue
                # v3.1: move the wrist by IK (shoulder fixed, elbow kept on its side), not a
                # rigid swing of the whole arm: a forearm lying against the coat comes off it
                # instead of the arm pivoting round it (the swing often didn't converge)
                p = poses[f]
                mats = kin.world(p, [end])
                sh, el, wr = (mats[b].translation for b in (up, lo, end))
                target = wr + to_arm @ Vector(d[f])
                pole = el + (el - (sh + wr) / 2) * 2
                poses[f] = rig_v3.two_bone_ik(kin, p, up, lo, end, target, pole,
                                              keep_end_rot=True)
        write_action(arm, poses, f"clips_{rnd}")
        if not moved:
            break


def _fix_hands(scene, arm, body, poses, opts):
    """Swing the upper arms out wherever a hand's vertices are inside the head (hood, mask,
    headphones), by just enough to rest on its surface, smoothed over time.

    ``hands: radial`` pushes straight out from the middle of the head (hands on the sides or
    top of the hood); ``hands: front`` pushes along the way the face points (a palm on the
    mask). For every hand vertex, the head's vertices in a thin tube along that direction
    say how far out the surface is there; the deepest one sets the push."""
    mode = opts.get("hands") if opts.get("hands") in ("radial", "front") else "radial"
    head = _groups(body, {"Head", "head_end", "headfront"}, 0.5)
    hands = {s: _groups(body, {f"{s}Hand"}, 0.3) for s in ("Left", "Right")}
    margin = float(opts.get("hands_margin", 0.012))
    tube = float(opts.get("hands_tube", 0.025))
    for rnd in range(int(opts.get("hands_passes", 3))):
        deltas = {s: [] for s in hands}
        for f in range(len(poses)):
            scene.frame_set(f)
            v = vertices(body)
            kv = v[head]
            hb = arm.pose.bones["Head"]
            mw = arm.matrix_world
            centre = np.array(mw @ ((hb.head + arm.pose.bones["head_end"].head) / 2))   # (Meshy's Head tail is far off)
            front = np.array((mw @ arm.pose.bones["headfront"].head) - (mw @ hb.head))
            front /= max(np.linalg.norm(front), 1e-9)
            for s, idx in hands.items():
                hv = v[idx][::2]
                if np.linalg.norm(hv.mean(0) - centre) > 0.35:
                    deltas[s].append((0.0, 0.0, 0.0))
                    continue
                if mode == "front":
                    u = np.tile(front, (len(hv), 1))
                else:
                    u = hv - centre
                    u /= np.maximum(np.linalg.norm(u, axis=1, keepdims=True), 1e-9)
                best, push = 0.0, np.zeros(3)
                near = kv[np.linalg.norm(kv - hv.mean(0), axis=1) < 0.3]
                if len(near):
                    for h, uu in zip(hv, u):
                        d = near - h
                        along = d @ uu
                        lateral = np.linalg.norm(d - np.outer(along, uu), axis=1)
                        sel = along[(lateral < tube)]
                        if len(sel) and sel.max() > 0 and sel.min() < 0:   # inside: surface on both sides
                            depth = sel.max() + margin
                            if depth > best:
                                best, push = depth, uu * depth
                deltas[s].append(tuple(push))
        moved = False
        for s in hands:
            d = np.array(deltas[s])
            mag = np.linalg.norm(d, axis=1)
            print(f"HANDS {s} pass {rnd}: max push {mag.max() * 100:.1f} cm, "
                  f"{int((mag > 0.004).sum())} frames")
            if mag.max() < 0.004:
                continue
            moved = True
            d = _smooth(_maxfilter(d, 2), 2.0)
            for f in range(len(poses)):
                if np.linalg.norm(d[f]) < 1e-4:
                    continue
                scene.frame_set(f)
                _swing(arm, s, d[f])
                pb = arm.pose.bones[f"{s}Arm"]       # read straight back, before any update
                loc, q, sc = pb.matrix_basis.decompose()
                p = dict(poses[f])
                p[pb.name] = (loc, q, sc)
                poses[f] = p
        write_action(arm, poses, f"hands_{rnd}")
        if not moved:
            break


def idle_pose():
    data = json.load(open(IDLE))
    return {name: (Vector(v[0]), Quaternion(v[1]), Vector(v[2]))
            for name, v in data["bones"].items()}


def make_idle(glb: str, clip: str, frame: int, out: str) -> None:
    """Save one frame of a clip as the shared neutral idle (bones, hips spot, sole line)."""
    scene, arm, body = load(glb, clip)
    scene.frame_set(int(frame))
    bones = {}
    for pb in arm.pose.bones:
        q = (pb.rotation_quaternion if pb.rotation_mode == "QUATERNION"
             else pb.rotation_euler.to_quaternion())
        bones[pb.name] = [list(pb.location), list(q), list(pb.scale)]
    hips = arm.pose.bones["Hips"]
    m = hips.bone.matrix_local @ hips.matrix_basis
    v = vertices(body)
    json.dump({"source": f"{os.path.basename(glb)}#{clip}@{frame}", "bones": bones,
               "hips_xy": [0.0, 0.0], "hips_rest_xy": list(m.translation[:2]),
               "floor": round(float(v[:, 2].min()), 4), "feet_z": round(feet_z(arm), 4)},
              open(out, "w"), indent=1)


# ---------------------------------------------------------------------------- measuring

def measure(glb: str, clip: str, out: str, opts_path: str | None = None) -> None:
    opts = json.load(open(opts_path)) if opts_path else {}
    scene, arm, body = stage(glb, clip, opts)
    frames = list(range(scene.frame_start, scene.frame_end + 1))
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    first = None
    spread = []
    cloud = set()
    lows = []
    for f in frames:
        scene.frame_set(f)
        v = vertices(body)
        lows.append(float(v[:, 2].min()))
        lo, hi = np.minimum(lo, v.min(0)), np.maximum(hi, v.max(0))
        if f % 2 == 0 or f == frames[-1]:
            # A coarse point cloud of everywhere the body goes: fits the camera tighter
            # than the bounding box's corners would.
            cloud.update(map(tuple, np.round(v[::7] / VOXEL).astype(int).tolist()))
        sub = v[::25]
        if first is None:
            first = sub
        spread.append(float(np.linalg.norm(sub - first, axis=1).mean()))
    n = len(frames)
    # The most extreme pose: biggest change from the first frame, ignoring the first and
    # last 15% (wind-up and settle).
    a, b = int(n * 0.15), max(int(n * 0.85), int(n * 0.15) + 1)
    k = a + int(np.argmax(spread[a:b]))
    scene.frame_set(frames[0])
    rest = vertices(body)
    json.dump({"clip": clip, "fps": FPS, "frames": n, "duration": round(n / FPS, 3),
               "bbox_min": lo.round(4).tolist(), "bbox_max": hi.round(4).tolist(),
               "rest_height": round(float(rest[:, 2].max() - rest[:, 2].min()), 4),
               "floor_min": round(min(lows), 4),
               "pose_frame": k + 1, "pose_time": round(k / FPS, 3),
               "loop_error": round(spread[-1], 4), "max_spread": round(max(spread), 4),
               "points": [[round(c * VOXEL, 3) for c in p] for p in sorted(cloud)]},
              open(out, "w"), indent=2)


# ---------------------------------------------------------------------------- props

def add_mic(scene, arm, spec: dict) -> None:
    """A microphone in one hand that's let go at ``release`` (seconds) and falls to the
    floor: the mic-drop doesn't read without one. Keyed per frame; ballistic after release,
    one small bounce, then it lies on the floor."""
    hand = arm.pose.bones[spec.get("hand", "RightHand")]
    release = int(round(float(spec["release"]) * FPS))
    grip = Vector(spec.get("grip", (0.0, 0.07, 0.0)))     # in the hand bone's space (metres)
    body_m = _mic_materials()
    parts = []
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.017, depth=0.15,
                                        location=(0, 0, -0.06))
    parts.append(bpy.context.object)
    parts[-1].data.materials.append(body_m["handle"])
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=0.021, depth=0.014,
                                        location=(0, 0, 0.018))
    parts.append(bpy.context.object)
    parts[-1].data.materials.append(body_m["ring"])
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=12, radius=0.033,
                                         location=(0, 0, 0.05))
    parts.append(bpy.context.object)
    parts[-1].data.materials.append(body_m["grille"])
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    mic = bpy.context.object
    bpy.ops.object.shade_smooth()
    mic.name = "mic"
    k = float(spec.get("scale", 1.4))     # a touch big, so it reads at video size
    mic.scale = (k, k, k)
    mic.rotation_mode = "QUATERNION"
    n = scene.frame_end + 1
    mats = []
    for f in range(min(release, n - 1) + 1):
        scene.frame_set(f)
        m = arm.matrix_world @ hand.matrix
        loc, rot, _ = m.decompose()
        # mic axis along the hand bone (wrist to fingers): upright in a raised hand
        mats.append((loc + rot @ grip, rot @ Quaternion((1, 0, 0), -math.pi / 2)))
    # ballistic flight from the release
    p0, q0 = mats[-1]
    v = (mats[-1][0] - mats[-3][0]) * FPS if len(mats) > 2 else Vector()
    v.z = max(v.z, 0.6)
    v += Vector(spec.get("toss", (0.0, 0.0, 0.0)))   # m/s: tossed a little towards the camera
    spin = Vector(spec.get("spin", (7.0, 0.0, 0.0)))
    g = Vector((0, 0, -9.81))
    p, q = p0.copy(), q0.copy()
    landed = None
    for f in range(release + 1, n):
        dt = 1 / FPS
        if landed is None:
            v += g * dt
            p += v * dt
            q = Quaternion(spin.normalized(), spin.length * dt) @ q if spin.length else q
            if p.z <= 0.035 * k:
                landed = f
                p.z = 0.035 * k
                v = Vector((v.x * 0.3, v.y * 0.3, abs(v.z) * 0.25))
        else:
            v += g * dt
            p += v * dt
            if p.z <= 0.03 * k:
                p.z, v = 0.03 * k, Vector()
            # settle lying down (axis horizontal) over a few frames
            axis = q @ Vector((0, 0, 1))
            flat = Vector((axis.x, axis.y, 0)).normalized() if axis.xy.length > 1e-3 else \
                Vector((1, 0, 0))
            target = axis.rotation_difference(flat) @ q
            q = q.slerp(target, 0.45)
        mats.append((p.copy(), q.copy()))
    for f, (loc, rot) in enumerate(mats):
        mic.location, mic.rotation_quaternion = loc, rot
        mic.keyframe_insert("location", frame=f)
        mic.keyframe_insert("rotation_quaternion", frame=f)


def _mic_materials() -> dict:
    def mat(name, colour, metallic, rough, emit=0.0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = colour
        b.inputs["Metallic"].default_value = metallic
        b.inputs["Roughness"].default_value = rough
        if emit:
            b.inputs["Emission Color"].default_value = colour
            b.inputs["Emission Strength"].default_value = emit
        return m
    return {"handle": mat("mic_handle", (0.02, 0.02, 0.022, 1), 0.3, 0.45),
            "ring": mat("mic_ring", (1.0, 0.06, 0.03, 1), 0.0, 0.4, 3.0),
            "grille": mat("mic_grille", (0.18, 0.18, 0.2, 1), 0.9, 0.35)}


# ---------------------------------------------------------------------------- the look

def camera(scene, lo, hi, width: int, height: int, points=None):
    """A fixed camera that fits every point the body reaches in any clip (or, without a
    point cloud, the union bounding box) with a small margin."""
    scene.render.resolution_x, scene.render.resolution_y = width, height
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scene.collection.objects.link(cam)
    scene.camera = cam
    cam.data.lens = LENS
    cam.data.sensor_fit = "VERTICAL"
    lo, hi = mathutils.Vector(lo), mathutils.Vector(hi)
    target = (lo + hi) / 2
    az, el = math.radians(AZIMUTH), math.radians(ELEVATION)
    # glTF characters face -Y: the camera sits in front (-Y), turned round by AZIMUTH.
    direction = mathutils.Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el),
                                  math.sin(el)))
    corners = ([mathutils.Vector(p) for p in points] if points else
               [mathutils.Vector((x, y, z)) for x in (lo.x, hi.x) for y in (lo.y, hi.y)
                for z in (lo.z, hi.z)])
    from bpy_extras.object_utils import world_to_camera_view

    def place(d):
        cam.location = target + direction * d
        cam.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
        bpy.context.view_layer.update()
        pts = [world_to_camera_view(scene, cam, c) for c in corners]
        xs, ys = [p.x for p in pts], [p.y for p in pts]
        return min(xs), max(xs), min(ys), max(ys)

    cam.data.shift_x = cam.data.shift_y = 0.0
    far = 60.0
    for _ in range(4):
        near, far = 0.5, 60.0
        for _ in range(40):
            d = (near + far) / 2
            x0, x1, y0, y1 = place(d)
            if x0 >= MARGIN and x1 <= 1 - MARGIN and y0 >= MARGIN and y1 <= 1 - MARGIN:
                far = d
            else:
                near = d
        x0, x1, y0, y1 = place(far)
        # Centre the projected box: shift is in units of the larger frame dimension.
        aspect = width / height
        cam.data.shift_x += ((x0 + x1) / 2 - 0.5) * (aspect if aspect < 1 else 1)
        cam.data.shift_y += ((y0 + y1) / 2 - 0.5) * (1 if aspect < 1 else 1 / aspect)
    x0, x1, y0, y1 = place(far)
    print(f"FRAMING distance={far:.2f} x={x0:.3f}..{x1:.3f} y={y0:.3f}..{y1:.3f}")
    return cam, target


def material(body) -> None:
    """Key the red out of the base colour and make it glow; darken and polish the mask."""
    ob = body[0]
    me = ob.data
    co = np.empty(len(me.vertices) * 3, np.float32)
    me.vertices.foreach_get("co", co)          # the bind pose (T-pose, feet at z = 0)
    m = np.array(ob.matrix_world)
    w = co.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]
    # Regions of the bind pose: the face plate (X eyes) and the chest plate (X emblem).
    eye = (w[:, 2] > 1.52) & (w[:, 2] < 1.75) & (w[:, 1] < -0.06) & (np.abs(w[:, 0]) < 0.12)
    chest = (w[:, 2] > 1.15) & (w[:, 2] < 1.45) & (w[:, 1] < -0.05) & (np.abs(w[:, 0]) < 0.13)
    mask = (w[:, 2] > 1.47) & (w[:, 1] < -0.03) & (np.abs(w[:, 0]) < 0.13)
    zone = np.zeros(len(w), np.float32)
    zone[chest], zone[eye] = 0.55, 1.0
    for name, vals in (("glow_zone", zone), ("mask_zone", mask.astype(np.float32))):
        if name in me.attributes:
            me.attributes.remove(me.attributes[name])
        me.attributes.new(name, "FLOAT", "POINT").data.foreach_set("value", vals)

    for mat in {s.material for s in ob.material_slots if s.material}:
        nt = mat.node_tree
        N, L = nt.nodes, nt.links
        bsdf = next(n for n in N if n.type == "BSDF_PRINCIPLED")
        tex = next(n for n in N if n.type == "TEX_IMAGE")

        def node(t, **kw):
            n = N.new(t)
            for k, v in kw.items():
                setattr(n, k, v)
            return n

        def link_or_set(sock, x):
            if isinstance(x, (int, float)):
                sock.default_value = x
            else:
                L.new(x, sock)

        def math_(op, a, b):
            n = node("ShaderNodeMath", operation=op)
            link_or_set(n.inputs[0], a)
            link_or_set(n.inputs[1], b)
            return n.outputs[0]

        def ramp(sock, a, b):
            n = node("ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
            L.new(sock, n.inputs[0])
            n.inputs[1].default_value, n.inputs[2].default_value = a, b
            return n.outputs[0]

        hsv = node("ShaderNodeSeparateColor", mode="HSV")
        L.new(tex.outputs[0], hsv.inputs[0])
        # Red: hue near 0 (either end of the wheel), saturated (skin is pale: left out), lit.
        hue = math_("MAXIMUM", math_("SUBTRACT", 1.0, ramp(hsv.outputs[0], 0.03, 0.07)),
                    ramp(hsv.outputs[0], 0.93, 0.97))
        red = math_("MULTIPLY", math_("MULTIPLY", hue, ramp(hsv.outputs[1], 0.5, 0.68)),
                    ramp(hsv.outputs[2], 0.25, 0.45))
        zone_n = node("ShaderNodeAttribute", attribute_name="glow_zone")
        mask_n = node("ShaderNodeAttribute", attribute_name="mask_zone")
        strength = math_("MULTIPLY", red, math_("ADD", 0.15,
                                                math_("MULTIPLY", zone_n.outputs["Fac"], 10.0)))
        bsdf.inputs["Emission Color"].default_value = (1.0, 0.06, 0.03, 1.0)
        L.new(strength, bsdf.inputs["Emission Strength"])
        # Darken everything but the red a touch, the mask more (dark gunmetal, not pale).
        k = math_("ADD", 0.8, math_("MULTIPLY", mask_n.outputs["Fac"], -0.6))
        kc = node("ShaderNodeCombineColor")
        for i in range(3):
            L.new(k, kc.inputs[i])
        mix = node("ShaderNodeMix", data_type="RGBA", blend_type="MULTIPLY")
        L.new(math_("SUBTRACT", 1.0, red), mix.inputs[0])
        L.new(tex.outputs[0], mix.inputs[6])
        L.new(kc.outputs[0], mix.inputs[7])
        L.new(mix.outputs[2], bsdf.inputs["Base Color"])
        L.new(math_("MULTIPLY", mask_n.outputs["Fac"], 0.75), bsdf.inputs["Metallic"])
        L.new(math_("ADD", 0.78, math_("MULTIPLY", mask_n.outputs["Fac"], -0.42)),
              bsdf.inputs["Roughness"])
        bsdf.inputs["Specular IOR Level"].default_value = 0.4
        for name in ("Coat Weight", "Sheen Weight"):
            if name in bsdf.inputs:
                bsdf.inputs[name].default_value = 0.0


def lights(scene, target):
    def light(name, loc, energy, colour, size=2.0):
        data = bpy.data.lights.new(name, "AREA")
        data.energy, data.color, data.size = energy, colour, size
        obj = bpy.data.objects.new(name, data)
        obj.location = target + mathutils.Vector(loc)
        obj.rotation_euler = (target - obj.location).to_track_quat("-Z", "Y").to_euler()
        scene.collection.objects.link(obj)

    # Dim neutral key front-left, cool fill front-right: the black stays black.
    # Cool-white rims from behind on both sides: the coat's edges read on dark navy.
    # A soft red kicker low on the right echoes the trim; a top light catches the hood.
    light("key", (-2.2, -3.2, 2.4), 190, (1.0, 0.96, 0.92), 2.5)
    light("fill", (3.0, -2.6, 0.6), 45, (0.7, 0.8, 1.0), 4.0)
    light("rim_l", (-2.2, 2.4, 1.8), 560, (0.75, 0.85, 1.0), 1.2)
    light("rim_r", (2.4, 2.6, 1.4), 400, (0.75, 0.85, 1.0), 1.2)
    light("kick_red", (2.8, 1.8, 0.4), 110, (1.0, 0.12, 0.08), 1.0)
    light("top", (0.3, 0.8, 3.2), 25, (0.9, 0.92, 1.0), 2.0)
    world = bpy.data.worlds.new("w")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.12, 0.13, 0.2, 1)
    bg.inputs[1].default_value = 0.15


def bloom(scene) -> None:
    """A little bloom on the glowing red (compositor Glare), alpha kept from the render."""
    tree = bpy.data.node_groups.new("bloom", "CompositorNodeTree")
    scene.compositing_node_group = tree
    tree.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    rl = tree.nodes.new("CompositorNodeRLayers")
    out = tree.nodes.new("NodeGroupOutput")
    glare = tree.nodes.new("CompositorNodeGlare")
    settings = {"Type": "Bloom", "Threshold": 1.0, "Strength": 0.5, "Size": 0.4}
    for sock in glare.inputs:
        if sock.name in settings:
            sock.default_value = settings[sock.name]
    tree.links.new(rl.outputs["Image"], glare.inputs["Image"])
    alpha = tree.nodes.new("CompositorNodeSetAlpha")
    tree.links.new(glare.outputs["Image"], alpha.inputs["Image"])
    tree.links.new(rl.outputs["Alpha"], alpha.inputs["Alpha"])
    tree.links.new(alpha.outputs["Image"], out.inputs[0])


def fix(glb: str, clip: str, out_glb: str, opts_path: str | None = None) -> None:
    """Stage a Meshy clip (all the v3 clean-up) and save the result as a GLB: the rig with
    its finger bones and weights, the mesh, and one action, ``v3``, keyed on every frame
    (the floor offset rides on the armature object). ``measure`` and ``render`` play it with
    ``staged: true``."""
    opts = json.load(open(opts_path)) if opts_path else {}
    scene, arm, body = stage(glb, clip, opts)
    act = arm.animation_data.action
    act.name = "v3"
    for a in list(bpy.data.actions):
        if a is not act:
            bpy.data.actions.remove(a)
    view = bpy.context.view_layer
    for o in scene.objects:
        o.select_set(o is arm or o in body)
    view.objects.active = arm
    os.makedirs(os.path.dirname(out_glb), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_glb, use_selection=True, export_format="GLB",
                              export_animations=True, export_animation_mode="ACTIVE_ACTIONS",
                              export_force_sampling=True, export_frame_range=True,
                              export_optimize_animation_size=False, export_skins=True,
                              export_def_bones=False, export_apply=False)
    print("FIXED", out_glb, scene.frame_end + 1)


def qa(glb: str, clip: str, out: str, opts_path: str | None = None) -> None:
    """Check a staged clip every 3rd frame: parts passing through each other (depth, cm),
    planted feet (sole height and tilt), and joint angles (elbows and knees bending the
    wrong way). Writes JSON."""
    import rig_v3_qa as Q
    opts = json.load(open(opts_path)) if opts_path else {}
    scene, arm, body = stage(glb, clip, opts)
    frames = list(range(scene.frame_start, scene.frame_end + 1, 3))
    report = {"frames": len(frames), "clips": {}, "feet": {}, "joints": {}}
    parts = Q.part_index(body[0])
    report["clips"] = {str(k): v for k, v in Q.clips(scene, body[0], frames, parts).items()}
    mw = arm.matrix_world
    for f in frames:
        scene.frame_set(f)
        v = vertices(body)
        for side in ("Left", "Right"):
            ft = parts[f"{side[0]}_leg"]
            pts = v[ft]
            sole = pts[pts[:, 2] < pts[:, 2].min() + 0.03]
            # tilt of the sole: heel-to-toe slope of the lowest points along the foot
            fwd = (mw @ arm.pose.bones[f"{side}ToeBase"].head) - (mw @ arm.pose.bones[f"{side}Foot"].head)
            fwd.z = 0
            fwd.normalize()
            lowest = float(pts[:, 2].min())
            # the boot: the leg's vertices near its ankle (bind pose: the lowest 16 cm)
            ankle = np.array(mw @ arm.pose.bones[f"{side}Foot"].head)
            foot = pts[np.linalg.norm(pts - ankle, axis=1) < 0.24]
            foot = foot[foot[:, 2] < foot[:, 2].min() + 0.16] if len(foot) else pts[:0]
            if len(foot) < 20:
                foot = pts[pts[:, 2] < pts[:, 2].min() + 0.16]
            proj = foot[:, :2] @ np.array(fwd[:2])
            heel = foot[proj < np.percentile(proj, 10)][:, 2].min()
            toe = foot[proj > np.percentile(proj, 90)][:, 2].min()
            ank = mw @ arm.pose.bones[f"{side}Foot"].head
            report["feet"].setdefault(side, []).append(
                [f, round(lowest * 100, 1), round(float(toe - heel) * 100, 1),
                 round(ank.x * 100, 1), round(ank.y * 100, 1),
                 round((mw @ arm.pose.bones[f"{side}Leg"].head).z * 100, 1)])
        # (Meshy's bone tails point anywhere: use the joints, head to head)
        for b, child in (("LeftForeArm", "LeftHand"), ("RightForeArm", "RightHand"),
                         ("LeftLeg", "LeftFoot"), ("RightLeg", "RightFoot")):
            pb = arm.pose.bones[b]
            par = pb.parent
            a = (pb.head - par.head).normalized()
            c = (arm.pose.bones[child].head - pb.head).normalized()
            report["joints"].setdefault(b, []).append(round(math.degrees(a.angle(c)), 1))
    json.dump(report, open(out, "w"), indent=1)
    print("QA", json.dumps({"clip_frames": len(report["clips"]),
                            "worst": max([max(h.values()) for h in report["clips"].values()] or [0])}))


def qa_views(scene, arm, f: int, out_dir: str) -> None:
    """Review close-ups of frame f (QA=1 with FRAMES): the feet from the side at floor level
    (toes, heels, the floor line) and each hand from the video camera's direction."""
    main = scene.camera
    res = scene.render.resolution_x, scene.render.resolution_y
    cam = bpy.data.objects.get("qa_cam") or bpy.data.objects.new("qa_cam", bpy.data.cameras.new("qa_cam"))
    if cam.name not in scene.collection.objects:
        scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.resolution_x = scene.render.resolution_y = 400
    mw = arm.matrix_world
    floor = 0.0
    # feet: orthographic from the character's right side, low
    lf, rf = (mw @ arm.pose.bones[b].head for b in ("LeftFoot", "RightFoot"))
    c = (lf + rf) / 2
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 0.75
    cam.location = Vector((c.x - 3.0, c.y, floor + 0.2))
    cam.rotation_euler = Vector((1, 0, 0)).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = f"{out_dir}/qa_{f:04d}_feet.png"
    bpy.ops.render.render(write_still=True)
    # front-ish feet (the video angle, low)
    d = (main.matrix_world.translation - c)
    d.z = 0
    d.normalize()
    cam.location = Vector((c.x, c.y, floor + 0.15)) + d * 3
    cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = f"{out_dir}/qa_{f:04d}_feet2.png"
    bpy.ops.render.render(write_still=True)
    cam.data.type = "PERSP"
    cam.data.lens = 85
    for side in ("Left", "Right"):
        h = mw @ arm.pose.bones[f"{side}HandMiddle1"].head
        d = (main.matrix_world.translation - h).normalized()
        cam.location = h + d * 0.9
        cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
        scene.render.filepath = f"{out_dir}/qa_{f:04d}_{side[0]}hand.png"
        bpy.ops.render.render(write_still=True)
    scene.camera = main
    scene.render.resolution_x, scene.render.resolution_y = res


def render(glb: str, clip: str, out_dir: str, framing: str, size: str = "720x1080") -> None:
    spec = json.load(open(framing))
    os.makedirs(out_dir, exist_ok=True)
    width, height = (int(x) for x in size.lower().split("x"))
    scene, arm, body = stage(glb, clip, spec.get("opts", {}))
    _, target = camera(scene, spec["bbox_min"], spec["bbox_max"], width, height,
                       spec.get("points"))
    lights(scene, mathutils.Vector(target))
    material(body)
    if spec.get("opts", {}).get("mic"):
        add_mic(scene, arm, spec["opts"]["mic"])
    # Where the feet stand (the world origin) in the frame, as fractions from the top-left:
    # compose pins this point so every move stands in the same place.
    from bpy_extras.object_utils import world_to_camera_view
    p = world_to_camera_view(scene, scene.camera, mathutils.Vector((0, 0, 0)))
    top = world_to_camera_view(scene, scene.camera,
                               mathutils.Vector((0, 0, float(spec.get("rest_height", 1.8)))))
    json.dump({"anchor": [round(p.x, 4), round(1 - p.y, 4)], "head": round(1 - top.y, 4)},
              open(f"{out_dir}/meta.json", "w"))
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 32
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    bloom(scene)
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    if os.environ.get("POSE_ONLY"):   # just the pose still (for trying the look quickly)
        pose = scene.frame_start + int(round(float(spec.get("pose_time", 0)) * FPS))
        scene.frame_set(min(pose, scene.frame_end))
        scene.render.filepath = f"{out_dir}/pose.png"
        bpy.ops.render.render(write_still=True)
        return
    if os.environ.get("FRAMES"):      # just these frames (reviewing a fix): "0,15,30" or "every:6"
        spec_f = os.environ["FRAMES"]
        last = scene.frame_end
        picks = (range(0, last + 1, int(spec_f.split(":")[1])) if spec_f.startswith("every:")
                 else [int(x) for x in spec_f.split(",")])
        for f in picks:
            scene.frame_set(min(int(f), last))
            scene.render.filepath = f"{out_dir}/frame_{int(f):04d}.png"
            bpy.ops.render.render(write_still=True)
            if os.environ.get("QA"):
                qa_views(scene, arm, int(f), out_dir)
        return
    scene.render.filepath = f"{out_dir}/frame_"
    bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    if args[0] == "measure":
        measure(*args[1:5])
    elif args[0] == "render":
        render(*args[1:])
    elif args[0] == "idle":
        make_idle(*args[1:5])
    elif args[0] == "qa":
        qa(*args[1:5])
    elif args[0] == "fix":
        fix(*args[1:5])
    else:
        raise SystemExit(__doc__)
