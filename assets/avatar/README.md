# Hexakin: Game Pass Button poses

Eight new poses for the button show, made on Meshy on 3 Nov 2026 and staged with the same Blender pipeline as the social avatar library (`~/social/brand/3d/render_avatar.py`, copied into `tools/avatar/`), so they match the existing moves: same rig clean-up, finger bones, ease in and out of the shared idle, floor lock, look and lighting.

Meshy cost: **29 credits** (rig 5 + 8 animations × 3). Every call is in `meshy-calls.csv`; task ids in `tasks.json`.

| Pose | File stem | Meshy action | Used in the show for | Best moment |
|---|---|---|---|---|
| Button slam | `button-slam` | 127 Charged Ground Slam | "Let me do it PROPERLY": he slams the button | impact at 1.7 s |
| Shove it on | `shove-it-on` | 259 Step Forward and Push | fake-out: the reel "naps" and he shoves it on | push 2.8–4.4 s |
| Scheming | `scheming` | 318 Scheming Hand Rub | "You've rigged this, haven't you" | 0.8–2.0 s |
| Jazz hands | `jazz-hands` | 408 Jazz Hands | "Ta-daaa" reveal | 0.2–2.6 s |
| Electrocuted | `electrocuted` | 172 Electrocution Reaction | the wheel "breaks" | 0.4–4.4 s |
| Collapse | `collapse` | 366 Falling Down | despair at a bad pick (ends on the floor) | falls 0.6–1.0 s |
| Flex | `flex` | 388 Show Both Arm Muscles | over-the-top celebration | 0.6–1.6 s |
| Backflip | `backflip` | 452 Backflip | celebration, way too much | flip 0.8–1.4 s |

## Files

- `glb/<pose>.glb`: the raw Meshy animation (rigged v2 avatar, 24 bones). `glb/hexakin-rigged.glb` is the rig (Meshy task `01a1a198-1685-…`).
- `v3/<pose>.glb`: the cleaned clip (finger bones, eased to the shared idle, facing camera, floor-locked). One action, `v3`. Reuse these.
- `stills/<pose>.png`: transparent pose still, trimmed: drop-in Short stickers.
- `../../site/avatar/hi/<pose>/NNN.webp`: transparent frames, 30 fps, 750×1000, feet at (50%, 96%), standing height 62% of the frame (same stage for every move, existing ones included).
- `../../site/avatar/lo/<pose>.webp`: phone sprite sheet, 12 fps, 360×480 cells, 8 per row (`site/avatar/clips.json` has frame counts).
- Transparent `.mov` (qtrle, 30 fps) of each new pose for the Shorts pipeline: `~/Videos/quick-takes/gamepass-button/avatar/<pose>.mov` (not in git; rebuild with `python3 tools/avatar/export_mov.py`).

## Rebuild

```sh
python3 tools/meshy_rig_and_animate.py fetch      # (free) re-download, if the GLBs are missing
python3 tools/avatar/build.py all --jobs 2        # Blender: fix, measure, render frames
python3 tools/avatar/sprites.py                   # web sprites + stills (also converts the existing library moves)
```

The show also uses 20 existing moves from `~/social/brand/avatar/` (read only), converted to the same stage by `sprites.py`.
