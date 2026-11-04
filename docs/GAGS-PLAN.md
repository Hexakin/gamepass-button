# Plan: a big random gag library for the Game Pass Button

Status (4 Nov 2026): **phase 1 (free) is built and live for spins dated 5 Nov 2026 onwards**: 121
library stickers imported, 143 gags (4 openers, 42 bits, 13 mishaps, 11 slowdowns, 45 reactions,
20 genre reactions, 9 outros), injury statuses, signs with text, genre reactions, anti-repeat,
gallery (`site/gags.html`), `spin.mjs --find`, tests. **Phases 2–3 (Meshy art) wait until the
user's credits reset on 13 Nov 2026** (his call: "leave it, but save all the ideas").

## What we already have (free)

- **Ares's chibi library** (`~/Videos/quick-takes/audit-2026-11/pack/avatar2d/library/`, read-only): **198 on-model stickers** made on 4 Nov with Meshy nano-banana-pro, using the same master sheet as the button's 18 poses, and checked by vision. It cost about 2,600 credits, which is why the balance is now 346. It covers reactions (72), props (31), situations (25), genre costumes (16), gaming (15), villain (15), scenes (14) and blank signs (10). Several are already injuries: anvil-flat, banana-slip (2), cables-tangled, cliff (Wile E.), ball-to-the-face, dizzy, shocked-jolt, shocked-frozen, mind-blown explosion, run-away, sobbing puddle.
- **Genres for every game**: the Microsoft catalogue API the fetcher already calls returns `Categories`. All 621 games have at least one: Action & adventure 368, Shooter 133, Role playing 131, Simulation 95, Family & kids 63, Platformer 60, Strategy 53, Sports 45, Racing & flying 44, Fighting 25, Puzzle & trivia 28, Card & board 17 and so on. The reaction can therefore match the game: a knight costume for an RPG, the kart for a racer.
- **The engine**: the cut-out animator (`puppet.js`), its move vocabulary (lunge, rub, pop, jump, drop, glass, shove, zap), FX (bolts, smoke, crack, confetti, stickers) and seeded, deterministic timelines.

**Conclusion:** about 100 of Ares's stickers can go in without spending a credit. Meshy credits only need to pay for what the library lacks: **button-specific** art (new ways to press it, the button or reel hurting him, recovery poses).

## How the randomness works (the design)

### 1. Each spin is a set of slots, and each slot draws from a pool

| Slot | Per spin | Pool today | Pool after phase 1 (free) | After Meshy art |
|---|---|---|---|---|
| Opener: how he presses the button | 1 | 1 (slam) | 2–3 | 6–9 |
| Bits: talky gags during the spin | 2–4 | 11 | ~30 | ~40 |
| Mishaps: fake-outs and injuries | 0–2 | 2 (nap, electrocuted) | ~12 | ~22 |
| Slowdown | 1 | 4 | ~12 | ~15 |
| Reaction (by mood or by genre) | 1 | 7 | ~45 + 16 genre | ~55 + 20 genre |
| Outro line | 1 | 3 | ~15 | ~15 |

Each gag carries 3–6 dialogue variants, chosen at random as well. That works out to over a billion distinct spins. The number that matters is how often two spins **feel** the same, meaning the same opener, mishap and reaction. With the full library that comes to roughly 1 in 2,000.

### 2. Each gag is a data entry, not hand-written code
`site/js/gags.js` holds a catalogue entry for each gag:
`{ id, slot, weight, rarity, since, poses, lines[], fx, sfx, mood?, genres?, needs?, leaves? }`.
`spin.js` assembles a spin by drawing from these pools with the theatrics random stream. The pick stream stays separate, so **the game chosen never changes**.

### 3. Rules that make it feel authored, not random
- **Injuries carry over.** A mishap can set a status (`leaves: "bandaged" | "scorched" | "dizzy"`). For the rest of that spin he wears a plaster cross, soot or circling stars, drawn in SVG over every pose at no cost. Later lines can refer back to it ("Still got glass in my helmet from earlier.").
- **Chains.** Some gags set up others. *evil-lightbulb* ("I could just unplug it...") leads into the electrocution. *banana-slip* can end with an anvil landing on him. A chain plays only when both of its gags are drawn.
- **Rarity.** About 70% of draws are common, 25% uncommon and 5% rare. Rare draws are the long chains and the big set pieces: catapulted off-screen, the anvil, the reel sucking him in. Rare moments are the ones people screenshot. Shorts can be captured on purpose with the capture tool's spin search.
- **Genre reactions.** About 40% of landings use the genre costume when the picked game has a matching genre (Shooter → blaster, Role playing → knight, Racing → kart, Sports → footballer, basketball or boxer, Fighting → boxer, Simulation → farmer, cook or fishing, Platformer → jetpack or skate, Strategy → villain crystal ball). The rest use mood: win, lose or shock.
- **Seasons and dates**, because every spin has a date: a Santa hat in December, fireworks around Bonfire Night, Halloween horror poses. Each needs only a date range on the gag.
- **Not the same twice in a row.** The page already generates the next spin code before you press. It will generate around 8 candidate codes and keep the one whose opener, mishap and reaction differ most from your last few spins, which it remembers in localStorage. Every code still replays exactly; we only choose which code you get. `tools/spin.mjs --find` uses the same method for Shorts ("give me a rare chain with a racing game").

### 4. Replays never change: each gag has a `since` date
A gag can only be drawn for spins dated on or after its `since` date. New gags are added with tomorrow's date. Every existing code therefore replays frame-for-frame, including the codes Ares has already cut Shorts from and played spins awaiting `capture.mjs --played`. Gags are never edited in place: a changed gag gets a new id. A test re-resolves a set of saved codes and fails if any timeline changes.

### 5. Phones only download what the spin uses
With about 150 poses (~10 MB), loading everything would be slow. The timeline is known before the press, so the page preloads and decodes only that spin's poses, around 15–20 (~1.2 MB). The "…" button already waits for this.

## Art import (library → button)

`tools/avatar/import_library.py`:
1. copies the cutouts into `assets/avatar/lib/`;
2. scales each one by **X-eye width** to match idle, which is how Ares normalised the 18 poses;
3. places it on the 1200 canvas with the feet at (600, 1140). Lying, flying and peeking poses get hand anchors;
4. writes `site/avatar/lib/<id>.webp` and `site/avatar/lib.json` with scale, anchor and effect bounds;
5. builds contact sheets for a vision check of every pose before use.

Left out on purpose: the KEEP/UNINSTALL verdict props (that is Ares's other show), the Moonlighter shop scenes, and busy scenes with baked-in backgrounds. The blank signs are **in**: the text is drawn into `text_box`, so he can hold up "NO RE-ROLLS", "619 GAMES" or "SHH".

### Curated library picks (~100)
- **Bits:** notifications ("Update required. 47 GB."), bored-sigh, bored-cheek-fist, yawn-stretch, sleep-standing (dozes off, the tick wakes him into shocked-jolt), binoculars, suspicious-squint, clipboard ("taking notes for the complaint"), thinking-bubble, evil-lightbulb (sets up the zap chain), money-moths ("£15 a month and it makes me WAIT"), stopwatch-race, stopwatch-1hour, confused-shrug-qs, eyeroll-blah, wave-hello, controller-gripping, sofa-snacks, peek-right, peek-top, peek-bottom, smug-hands-behind-head, climb-cases, tiny-vs-case, the 10 blank signs.
- **Mishaps and injuries:** anvil-flat, banana-slip a/b, cables-tangled, cliff-wile, ball-face (a sports game flies out of the reel), dizzy, shocked-jolt, shocked-frozen, mindblown-explosion, balloon-float (drifts off-screen and falls back in), run-away, run-away-front, rage-tantrum, plus the existing electrocution and nap.
- **Slowdown:** nervous-sweat, horrified-peek-fingers, horrified-trembling, evil-lean-in, villain-steepled, crystal-ball ("I foresee... a golf game"), sinister-point, the stopwatch-hug, plus the current four.
- **Reactions (win):** fist-pump, flex, mic-drop, sunburst, hype-jump, clapping-hype, thumbs-up, crown, crown-hold, controller-triumph, finger-guns, salute-gg, knee-slide, plus celebrate and jazz-hands.
- **Reactions (lose):** facepalm ×3, sobbing ×4, nope, disgusted ×4, cringe, eyeroll, bored-lying-ceiling, rage-scream, table-flip, grave-rip ("RIP my evening"), plus despair ×2.
- **Reactions (shock):** shocked-cheeks, jump-back, munch-scream, mindblown ×3, laugh-crying, laugh-rolling.
- **Genre:** all 16 genre costumes.

## New art to make with Meshy (what the library lacks)

The method is Ares's: nano-banana-pro image-to-image with the master sheet and avatar as references (9 credits a call), a white-key cutout, a synthesised sticker border and a vision check. The library needed about 1.4 calls per accepted pose, so **about 13 credits per pose**.

**A. New ways to press the button.** Each needs two poses (windup and impact), with the same red arcade button drawn in the slam poses:
1. headbutt (helmet clonk, stars)
2. bum-drop (leaps up, lands sitting on it)
3. belly-flop
4. karate chop
5. scared poke with a long stick from behind a shield
6. drop-kick
7. wrestling elbow-drop
8. tiny sheepish toe-tap

8 openers make 16 poses, about 210 credits.

**B. Button and reel injuries:**
1. the button catapults him: launched and flailing, then head-first in the floor with legs up
2. stubbed toe: hopping, clutching his boot (also used when he kicks the reel)
3. glove stuck to the button, tugging
4. a game case flies out of the reel and clonks him
5. the reel sucks him in: gripping the frame, legs horizontal
6. squashed flat as a pancake, then peeled off the floor
7. the bomb gag: holding a lit bomb, then charred
8. a bandaged idle (plasters, arm sling)
9. crawling back into frame
10. sitting dazed with birds circling
11. separate drop-in props: anvil, piano, safe, flowerpot, banana peel

That is about 15 poses, about 200 credits.

**C. Reel bits:**
1. hugging the reel to stop it (feet skidding)
2. hanging off the box-art frame by his fingertips
3. eating popcorn while watching
4. filming the reel on his phone
5. on the phone ("Mum, it's spinning")
6. warm-up stretches before pressing
7. unrolling a long rules scroll

That is 7 poses, about 90 credits.

**D. Missing genre costumes:** strategy general, card dealer, puzzle (Rubik's helmet), music (guitar), MOBA (wizard staff), horror (title keywords). About 6 poses, 80 credits.

**The full wishlist is about 44 poses, about 580 credits.** The balance is 346 until 13 Nov. Ares's DECISIONS.md says Ultra starts after that, and that Ares plans to "maximise both pools" for daily thumbnails as well, so **the current 346 is shared with Ares**.

Cheaper option, untested: nano-banana-2 (6 credits) or nano-banana-2-1 (4 credits) might hold the style. A 3-pose pilot on each, about 45 credits, would show whether they do. If they hold it, the whole wishlist costs about 250–350 credits.

## Phases

1. **Free (no credits), about a day:**
   - genres in the fetcher
   - library import with the vision check
   - move the existing beats into `gags.js` with `since` dates
   - about 40 new gags on library art, plus SVG status overlays (plasters, soot, stars) and drawn props
   - per-spin preload
   - anti-repeat code choice
   - `spin.mjs --find`
   - a gag gallery page (`lab/gags.html?gag=<id>`) so you can review every gag by eye
   - tests: old codes unchanged, every gag inside the safe zone, at most 3 flashes a second
2. **Meshy pilot:** 3 poses on nano-banana-2 against pro, about 45 credits.
3. **Meshy batch:** A and B first, as far as the agreed budget goes. C and D on the Ultra pool after 13 Nov.

## Not touched
Ares's profile, `~/social` and the Shorts pipeline (all read-only). Library art is copied into this repo, never edited at its source.
