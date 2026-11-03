# Hexakin chibi sticker pack (2D)

Chibi sticker version of the mascot: big head, small body (~1:1.5), white die-cut outline with a thin dark keyline, flat vector colours, glossy highlights.
Made with Meshy image-to-image (REST `/openapi/v1/image-to-image`), 2026-11-03. Revision 2 (same day) redid 7 weak poses and added 3 new ones; same method and reference images. Nothing published; no other repo/pipeline touched.

## Files

- `hexakin-chibi-sheet.png` — master reference (front, 3/4, side, back; 1376x768). Used as reference image #1 (with `~/social/brand/hexakin-avatar-800.png` as #2) for every pose.
- `poses/<pose>.png` — transparent cutouts, trimmed to the sprite, scaled so head size matches across poses (factor in `poses/manifest.json`). Bottom edge = baseline.
- `poses/canvas/<pose>.png` — same sprites on a fixed 1200x1200 transparent canvas, bottom-centre anchored at (600, 1140), so drop-in layers share one baseline and scale.
- `poses/_old/` and `poses/canvas/_old/` — the first-round versions of the 7 redone poses (+ the old `manifest.json`), kept for reference.
- `contact.png` — all 18 on a checker (`*` = redone/new in revision 2), green line = baseline.
- `_work/` — raw generations (`raw/`), `meshy_log.csv` (every call: task id, model, credits, prompt), scripts (`mz.py`, `poses.py`, `key.py`, `build.py`, `finish.py`).

## Locked details (same in every pose)

Segmented gunmetal hood-helmet with rivets and V-peaked brow; flat black void face with two crimson X eyes; chunky ridged headphones with segmented band; U-jaw with hexagon chin plate; black hooded coat with glowing red seams and red drawstrings; red X on chest; **no belt**; black trousers; chunky black boots with grey soles; **black tactical gloves with a grey hexagon plate on the back of each hand** (no skin anywhere).

## Poses

| File | Use | Model | Source task |
|---|---|---|---|
| idle.png | neutral/default state | nano-banana-pro | 01a1a1fe-ec4b-7308-83f3-a030948a5108 |
| slam-windup.png | anticipation, fist raised over the unpressed button | nano-banana-pro | 01a1a208-dddd-776e-a208-ef3a76ede15f |
| slam-impact.png | giant fist squashing the red arcade button | nano-banana-pro | 01a1a1fe-ec46-779e-9023-90d6fbc40ca4 |
| electrocuted-a.png | rigid T-pose, splayed fingers, skeleton flash | nano-banana-pro | 01a1a218-4c11-7696-ad92-a3b33a6851fe |
| electrocuted-b.png | **rev 2.** jittery hop: knees knocked in, forearms up with trembling fists, hood tip frazzled up, 4 small bolts + shake marks, no skeleton | nano-banana-pro | 01a1a288-07eb-749c-bc42-3521aa8c750d |
| frazzled-aftermath.png | **rev 2.** light scorch: dazed/limp, singed curled hood tip, a few soot smudges, 3 smoke curls; helmet, red seams and chest X stay bright | nano-banana-pro | 01a1a280-fb4a-72b7-a83c-074f5b8f17e2 |
| nose-on-glass.png | **rev 2.** normal (unsquashed) chibi, face and both gloved palms against an invisible pane, outlined fog ring, glass streaks, squish highlights. Squash is for the animation | nano-banana-pro | 01a1a291-39da-72e9-9b10-afd06bf610a2 |
| pointing-accuse.png | **rev 2.** big gloved fist, long index finger thrust diagonally out toward the viewer, grey hex plate + rim highlights, other fist on hip | nano-banana-pro | 01a1a285-00bc-7423-ab26-c432b3c6bd21 |
| tap-watch.png | **rev 2.** one wrist held up and out in white space with a chunky red watch (new: now drawn, so it reads at phone size), other index finger tapping it, foot tap | nano-banana-pro | 01a1a291-39db-7614-a1de-acc68e2f5fdb |
| shush.png | **rev 2.** 3/4 view, near arm out and forward, fist in profile with one big raised index finger in front of the lower face, far arm out to the side | nano-banana-pro | 01a1a293-c695-7139-af56-88b21c508071 |
| scheming.png | **rev 2.** hunched hand-rub; eyes now flat red like every other pose (no glow) | nano-banana-pro | 01a1a280-faca-743b-a00a-f222765ee9ee |
| shove-offscreen.png | two-handed shove to the right (frame right), nothing visible | nano-banana-pro | 01a1a207-52cc-73ac-8c91-4a56efca6dbc |
| despair-collapse.png | slumped on the floor, rain cloud, hand on brow | nano-banana-pro | 01a1a20c-502c-7398-ad79-6e27fc263148 |
| celebrate.png | jumping, arms up, confetti and streamers | nano-banana-pro | 01a1a204-6bae-7042-83f5-ea8556184f9f |
| jazz-hands.png | "ta-daaa" | nano-banana-pro | 01a1a204-6bae-7043-9f52-531473a88850 |
| despair-flat.png | **new.** melodramatic faint, lying flat on its back (head left, feet right), glove over the forehead, one X-eye pair, both headphones, two legs | nano-banana-pro | 01a1a28d-5b36-75db-b342-97b1802cad41 |
| shrug.png | **new.** "what did you expect?": palms up, elbows out, hex plates visible | nano-banana-pro | 01a1a281-6eb8-7506-bad5-d6baa1dba54c |
| thumbs-down.png | **new.** UNINSTALL verdict: huge fist, thumb pointing down, head back, other hand on hip | nano-banana-pro | 01a1a284-ac0f-77a0-be33-f3b9412f9920 |

Master sheet: nano-banana-pro, task 01a1a1fd-23d7-732a-a702-9ab98b070d52 (third refinement round, from the first draft + avatar head).

## Credits

Revision 1: 513 Meshy credits (balance 3,955 -> 3,442), 56 calls (nano-banana-pro 9 each + gpt-image-2 12 each).
Revision 2: 450 credits (balance 3,442 -> 2,992), 50 nano-banana-pro calls at 9: nose-on-glass 5, shush 6, tap-watch 11, pointing-accuse 3, electrocuted-b 5, frazzled-aftermath 2, scheming 2, shrug 2, thumbs-down 4, despair-flat 10 (incl. 6 top-down/rotated dead ends). Total pack spend 963. Per-call detail (task id, prompt) in `_work/meshy_log.csv`, labels `v2_*`; prompts in `_work/poses2.py`.

## Cutouts

Tested three: rembg (bria-rmbg 2.0), Meshy's own `remove_background`, and a white-key. Both model-based mattes ate the white sticker border (rembg left gaps/ragged border; Meshy's left a grey ghost halo). Kept the **white-key**: flood-fill the near-white background from the image edge, stopping at the thin dark keyline, so the white border survives.
Six generations came back with no sticker border at all (slam-windup, slam-impact, frazzled-aftermath, nose-on-glass, scheming, shove-offscreen). For these a matching border (11px white + 2px dark keyline, as on the idle) was synthesised around the cutout, so it also wraps their sweat drops/smoke/dust. In the other poses, effects (confetti, sparkles, speed lines, lightning in places) are cut out without their own border.
Scale: normalised by measured X-eye width (target ~70px, x0.9) and clamped; nose-on-glass is set by hand because its head is intentionally squashed.
Baseline: lowest opaque pixel. For airborne poses (electrocuted-a/b, celebrate, jazz-hands, slam-impact) the feet float above that line; for slam poses the button/floor effect sits on it. Re-anchor by hand if you want feet-level alignment on those.

Revision 2 notes: same white-key; sprites with no generated border (electrocuted-b, frazzled-aftermath, tap-watch, thumbs-down) got the synthesized 11px + 2px keyline. All revision-2 poses were generated with the master sheet + `hexakin-avatar-800.png` as references and an extra "arms out, hex plate, rim-light, no glow" rule block. Scale = X-eye width as before (target ~70px, x0.9, clamp 0.78-1.25), measured on the red connected components of the head; despair-flat uses the two eyes stacked vertically.

## Weak spots / what I'd redo

Fixed in revision 2: nose-on-glass (no longer a UFO helmet, legs back, fog ring + highlights), shush, tap-watch (arms now out in white space), pointing-accuse (diagonal at the viewer, hex plate visible), electrocuted-b (different, uncluttered jitter pose, no skeleton), frazzled-aftermath (bright, light scorch), scheming (eye colour now matches: measured eye RGB ~(171,43,48) vs idle (162,36,42), no halo; the old one was (202,44,45) with a glow).

Still weak (honest list):
- **shush** — the raised finger sits over the black face void; glove has a rim highlight and overlaps the grey jaw plate, but black-on-black is only moderate contrast at 200px. The arm-out silhouette and hush marks carry it. An editor-added white outline on the finger would fix it.
- **tap-watch** — the finger stops just short of the watch (small gap) and the watch is a simple red disc/band, not part of the sheet design (the earlier pose had an undrawn watch). Chest X is slightly overlapped by the crossing forearm.
- **nose-on-glass** — palms sit beside the head rather than literally touching it; fog ring has a pale-blue outline so it shows on white, but is low contrast on very light backgrounds. A translucent glass streak crosses the coat. Chest X partly crossed by it.
- **Head-to-body ratio drift** (X-eye width / sprite height; idle 0.068): nose-on-glass 0.099 (leaning in), scheming 0.091 (hunched), pointing-accuse 0.087, thumbs-down 0.086, shrug 0.083. The head is normalised by eye width so these bodies come out smaller than idle's. The original pack spans 0.058-0.080.
- **despair-flat** — body is horizontal (head left, feet right), face-on helmet drawn like the front sheet view; the glove rests on the upper side of the helmet near the forehead rather than a clean across-the-brow. 1312px-wide source, so it is the widest sprite (920px on the 1200 canvas). It is lying on its back seen from above; no floor shadow (despair-collapse still has one).
- **thumbs-down** — head turned/tilted a bit, far headphone cup mostly hidden; head slightly larger than idle.
- **electrocuted-b** — knees read as bent/hopping more than strictly knocked; hood tip is a small pointed flop.
- **frazzled-aftermath** — near-idle silhouette by design (light scorch); chest X reads a bit dimmer than the seams.
- **electrocuted-a** — stiff but reads a bit like a welcoming T-pose; bolts have soft pale-yellow interiors, low contrast on light backgrounds.
- **V brow** is subtle (a helmet-plate chevron) in almost every pose; it matches the sheet but the avatar's brow is chunkier.
- **despair-collapse** (the sitting version) is still in the pack alongside despair-flat.
- Sheet: the side and back views are the least on-model; poses use the front/3-4 look.
- Minor drift: some glove hex plates sit differently from pose to pose; one headphone cup is mostly hidden in several 3/4 poses; chest X partly covered in shove-offscreen.
