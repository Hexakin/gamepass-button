# The Game Pass Button

Press the big red button. It spins through the UK console Game Pass catalogue with far too much theatre from Hexakin, slows down, and lands on one game. That's tonight's game. No re-rolls.

A static site (HTML/CSS/JS, no server, no AI at runtime), hosted on GitHub Pages, unlisted (`noindex`) until launch.

## How it's honest

- Each spin gets a code, `DDD-RRRRR`: the UK date it was pressed (`DDD`) and 25 bits from the browser's crypto RNG (`RRRRR`).
- The code decides everything: the catalogue (the latest daily snapshot *before* that date), the reel order, the jokes, the fake-outs and the final game. The final game is drawn uniformly from every eligible game (rejection sampling, no modulo bias), on its own random stream.
- Fake-outs (the reel "napping" and getting shoved on, the wheel "breaking") are theatre. The last stop is always the real pick.
- `?seed=<code>` replays the identical spin, with the same result, at any time later: catalogue snapshots are kept per day (`site/data/archive/`), and played games only drop out of spins dated *after* they were marked.

## Use

- Phone: open the site, press the button. At the end: **Get it on Xbox** (store page, remote install), **Copy spin link**, **Replay**.
- Replay a spin: `…/?seed=09J-8ZP37`.
- Mark tonight's game as played: the result panel's "Mark it played" link opens a GitHub issue titled `played: <CODE>`; submitting it (as the repo owner) runs the bot that adds it to `site/data/played.json`. Or locally: `node tools/mark_played.mjs <CODE>`, commit, push.
- Look up a code without a browser: `node tools/spin.mjs <CODE>`.

## Video capture

```sh
npm install && npx playwright install chromium     # once
node tools/capture.mjs <CODE>                       # full.mp4 + landing.mp4 + landing.png + spin.json
node tools/capture.mjs <CODE> --landing-only        # just the ~1.6 s landing
```

Output: `~/Videos/quick-takes/gamepass-button/spins/<YYYY-MM-DD>-<CODE>/`. The page is rendered at 1080×1920 with no UI (`?seed=<code>&render=916`) and stepped frame by frame, so the video is exactly the show; the audio is rendered offline by the page's own sound code. `spin.json` = `{code, date, result {title, productId, storeUrl, boxart}, catalogDate, landing [start, end], …}`.

## Data

`tools/fetch_gamepass.py` (stdlib Python) reads two public but unofficial, undocumented Microsoft endpoints (the "All Console Games" list, GB market, and the display catalogue for titles and box art). The GitHub Action runs it daily at 03:15 UTC and writes:

- `site/data/gamepass.json`: today's list, readable
- `site/data/index.json`: every game ever seen (`id → [title, boxart, hero]`)
- `site/data/archive/<date>.json` + `dates.json`: each day's list as product ids

If a fetch fails or looks wrong (under 200 games), nothing is written and the site keeps the last good copy.

## Sound

Every sound effect is synthesised in WebAudio by `site/js/audio.js` (our own; no licences). The optional music bed is Hexakin's own instrumental "Breach and Clear". No voice, no mic.

## Layout

```
site/            the website (deployed as-is)
  js/rng.js      spin codes, seeded streams
  js/spin.js     the show as data: buildSpin(code, data)
  js/show.js     draws the show at any time t
  js/audio.js    synth SFX + music, live or offline
  js/app.js      page glue (phone mode, render mode)
  avatar/        Hexakin sprites (lo: phone sheets; hi: render frames)
  data/          catalogue, archive, played.json
tools/           fetch, capture, spin lookup, mark played, avatar build, Meshy
assets/avatar/   the new Meshy poses (see its README)
```

Fan-made. Not affiliated with or endorsed by Microsoft or Xbox. Box art belongs to its owners and is shown under the Xbox Game Content Usage Rules: free, no ads, nothing implies it's official.
