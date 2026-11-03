"""Hexakin key poses for the cut-out cartoon show: pose the rigged avatar by hand, render stills.

    blender -b --factory-startup -P tools/avatar/keyposes.py -- probe
    blender -b --factory-startup -P tools/avatar/keyposes.py -- render POSES.json OUT_DIR [slug ...]

Starts from the shared idle (frame 0 of a cleaned v3 clip, which has the finger bones), then
applies each pose's spec, in this order:

  "hips":  [dx, dy, dz]           metres, world (the character faces -y; his left is +x)
  "rot":   {bone: [x, y, z]}      degrees about the WORLD axes at the joint, parents first
                                  (+x bends forward, +y leans to his left, +z turns him left)
  "legs":  {Left|Right: {"foot": [x,y,z], "knee": [x,y,z]}}  IK targets, metres world
  "arms":  {Left|Right: {"hand": [x,y,z], "elbow": [x,y,z]}} IK targets, metres world
  "post":  {bone: [x, y, z]}      world rotations after the IK (wrists, head)
  "hands": {Left|Right|both: shape}   rig_v3.SHAPES name (fist, spread, point, flat, claw...)
  "scale": {bone: s}              cartoon scale on a bone (and its children)

Renders OUT_DIR/<slug>.png (transparent, 750x1000) with one fixed camera for every pose
(same scale and floor line), and OUT_DIR/<slug>.json with where the feet, head and hands
land in the frame (fractions from the top-left), for the 2D effects.
"""
import json
import math
import os
import sys

import bpy
from mathutils import Quaternion, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_avatar as RA  # noqa: E402
import rig_v3  # noqa: E402

SRC = os.path.join(HERE, "..", "..", "assets", "avatar", "v3", "flex.glb")
SIZE = (900, 1200)
# one framing box for every pose (metres): room for arms up, kneeling, lying flat, lunges
BOX = ((-1.0, -0.6, 0.0), (1.0, 0.6, 2.42))
RA.AZIMUTH = 12.0
RA.ELEVATION = -4.0


def euler_q(deg):
    x, y, z = (math.radians(float(a)) for a in deg)
    return Quaternion((0, 0, 1), z) @ Quaternion((0, 1, 0), y) @ Quaternion((1, 0, 0), x)


def setup():
    scene, arm, body = RA.load(SRC, "v3")
    scene.frame_set(0)
    pose = {pb.name: (pb.location.copy(),
                      (pb.rotation_quaternion.copy() if pb.rotation_mode == "QUATERNION"
                       else pb.rotation_euler.to_quaternion()), pb.scale.copy())
            for pb in arm.pose.bones}
    arm.animation_data.action = None
    return scene, arm, body, pose


class Poser:
    def __init__(self, arm, idle):
        self.arm = arm
        self.kin = rig_v3.Kin(arm)
        self.idle = idle
        self.mw = arm.matrix_world.copy()
        self.mwi = self.mw.inverted()
        self.r = self.mw.to_quaternion()          # world <- armature rotation

    def to_arm(self, p):
        return self.mwi @ Vector(p)

    def world_of(self, pose, bone):
        return self.mw @ self.kin.world(pose, [bone])[bone].translation

    def rotate(self, pose, bone, deg):
        mats = self.kin.world(pose, [bone])
        # a world-axis rotation, expressed in armature space
        qw = euler_q(deg)
        qa = self.r.inverted() @ qw @ self.r
        new = (qa @ mats[bone].to_quaternion()).normalized()
        loc, _, s = pose[bone]
        pose[bone] = (loc, self.kin.local_from_world(pose, mats, bone, new), s)

    def build(self, spec):
        pose = dict(self.idle)
        if "hips" in spec:
            loc, q, s = pose["Hips"]
            d = self.r.inverted() @ Vector(spec["hips"]) * (1.0 / self.arm.scale.z)
            d = self.kin.rest["Hips"].to_3x3().inverted() @ d
            pose["Hips"] = (loc + d, q, s)
        order = self.kin.order
        for bone, deg in sorted(spec.get("rot", {}).items(), key=lambda kv: order.index(kv[0])):
            self.rotate(pose, bone, deg)
        for side, t in spec.get("legs", {}).items():
            pose = rig_v3.two_bone_ik(self.kin, pose, f"{side}UpLeg", f"{side}Leg", f"{side}Foot",
                                      self.to_arm(t["foot"]), self.to_arm(t["knee"]),
                                      keep_end_rot=True)
        for side, t in spec.get("arms", {}).items():
            pose = rig_v3.two_bone_ik(self.kin, pose, f"{side}Arm", f"{side}ForeArm", f"{side}Hand",
                                      self.to_arm(t["hand"]), self.to_arm(t["elbow"]),
                                      keep_end_rot=t.get("keep_wrist", False))
        for bone, deg in sorted(spec.get("post", {}).items(), key=lambda kv: order.index(kv[0])):
            self.rotate(pose, bone, deg)
        hands = spec.get("hands", {})
        for side in rig_v3.SIDES:
            shape = hands.get(side) or hands.get("both")
            if shape:
                pose.update(rig_v3.shape_pose(side, shape))
        for bone, s in spec.get("scale", {}).items():
            loc, q, _ = pose[bone]
            pose[bone] = (loc, q, Vector((s, s, s)))
        return pose


def probe():
    scene, arm, body, idle = setup()
    P = Poser(arm, idle)
    for b in ("Hips", "Spine02", "neck", "Head", "head_end", "LeftShoulder", "LeftArm", "LeftForeArm",
              "LeftHand", "RightArm", "RightHand", "LeftUpLeg", "LeftLeg", "LeftFoot", "RightFoot",
              "LeftToeBase"):
        if b in arm.pose.bones:
            print("PROBE", b, [round(x, 3) for x in P.world_of(idle, b)])


def render(poses_path, out_dir, only):
    specs = json.load(open(poses_path))
    os.makedirs(out_dir, exist_ok=True)
    scene, arm, body, idle = setup()
    P = Poser(arm, idle)
    _, target = RA.camera(scene, BOX[0], BOX[1], *SIZE)
    RA.lights(scene, Vector(target))
    RA.material(body)
    scene.render.engine = "BLENDER_EEVEE"
    if hasattr(scene, "eevee"):
        scene.eevee.taa_render_samples = 32
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    RA.bloom(scene)
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    from bpy_extras.object_utils import world_to_camera_view as w2c
    for slug, spec in specs.items():
        if slug.startswith("_") or (only and slug not in only):
            continue
        pose = P.build(spec)
        RA.apply_pose(arm, pose)
        bpy.context.view_layer.update()
        # floor: lift so the lowest vertex sits on z=0 unless the pose says it's airborne
        v = RA.vertices(body)
        lift = spec.get("air", 0.0) - float(v[:, 2].min())
        arm.location.z += lift
        bpy.context.view_layer.update()
        pts = {}
        for b in ("Head", "head_end", "LeftHand", "RightHand", "LeftFoot", "RightFoot", "Hips"):
            if b in arm.pose.bones:
                p = w2c(scene, scene.camera, arm.matrix_world @ arm.pose.bones[b].head)
                pts[b] = [round(p.x, 4), round(1 - p.y, 4)]
        p0 = w2c(scene, scene.camera, Vector((0, 0, 0)))
        json.dump({"feet": [round(p0.x, 4), round(1 - p0.y, 4)], "points": pts},
                  open(os.path.join(out_dir, f"{slug}.json"), "w"))
        scene.render.filepath = os.path.join(out_dir, f"{slug}.png")
        bpy.ops.render.render(write_still=True)
        arm.location.z -= lift
        print("POSED", slug)


if __name__ == "__main__":
    args = sys.argv[sys.argv.index("--") + 1:]
    if args[0] == "probe":
        probe()
    else:
        render(args[1], args[2], args[3:])
