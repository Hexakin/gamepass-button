// The whole show as data: buildSpin(code, data) -> a timeline that is a pure function of the
// spin code and that day's catalogue. No DOM here (Node can import it too).

import { stream, codeDate } from "./rng.js";

// ------------------------------------------------------------------ catalogue + eligibility

export const norm = (s) => String(s || "").toLowerCase().replace(/[®™©]/g, "")
  .replace(/&/g, "and").replace(/[^a-z0-9]/g, "");

// The catalogue a spin on `date` uses: the latest archive strictly before that date (written
// before any spin that day could happen), else the earliest archive there is.
export function catalogueDateFor(date, dates) {
  const sorted = [...dates].sort();
  const before = sorted.filter((d) => d < date);
  return before.length ? before[before.length - 1] : sorted[0];
}

// played.json entries: {title, id?, since}. An entry excludes a game from spins dated AFTER
// `since`, so marking tonight's game as played never changes a replay of the spin that chose it.
export function eligible(catalogue, played, date) {
  const active = played.filter((p) => !p.since || p.since < date);
  const ids = new Set(active.map((p) => p.id).filter(Boolean));
  const titles = new Set(active.map((p) => norm(p.title)));
  return catalogue.filter((g) => !ids.has(g.id) && !titles.has(norm(g.title)));
}

// ------------------------------------------------------------------ the script (his voice)

// Fourth-wall bits during the fast spin: {pose, line, fx}. Poses are the chibi drawings
// (site/js/puppet.js); `move` picks how he gets into the pose.
const BITS = [
  { id: "blink", pose: "pointing-accuse", alt: "scheming", move: "lunge", line: "Don't blink. Blinking is cheating." },
  { id: "rigged", pose: "scheming", alt: "pointing-accuse", move: "rub", line: "You've rigged this. I can tell. You've got a rigging face." },
  { id: "watch", pose: "tap-watch", alt: "shrug", move: "tap", line: "Any time today. Some of us have a download bar to stare at." },
  { id: "glass", pose: "nose-on-glass", move: "glass", line: "*tap tap* Hello? You've got a thumbprint on your screen. Gross.", fx: "tap" },
  { id: "shush", pose: "shush", alt: "pointing-accuse", move: "lunge", line: "Shh. SHH. It's concentrating." },
  { id: "rules", pose: "pointing-accuse", alt: "thumbs-down", move: "lunge", line: "{n} games. One button. No re-rolls. Those are the rules.", span: 3.0 },
  { id: "illegal", pose: "shrug", alt: "scheming", move: "pop", line: "Is it allowed to go this fast? Feels illegal." },
  { id: "sticker", pose: "shrug", alt: "pointing-accuse", move: "pop", line: "Who keeps putting stickers on the screen? Was that you?", fx: "stickers" },
  { id: "editor", pose: "thumbs-down", alt: "shrug", move: "lunge", line: "Editor, if this lands on a golf game, cut it. Actually don't. Honesty." },
  { id: "coward", pose: "pointing-accuse", alt: "jazz-hands", move: "lunge", line: "You pressed it like a coward. One finger? Really?" },
  { id: "lean", pose: "scheming", alt: "pointing-accuse", move: "rub", line: "Look at it go. Look at it. No, not at me. AT IT." },
];

const SLOWDOWN = [
  { pose: "pointing-accuse", line: "Slowing down... slowing down... don't you DARE be a golf game." },
  { pose: "scheming", line: "Here it comes. Here it comes. Nobody breathe." },
  { pose: "idle", line: "Drumroll, please. I said DRUMROLL." },
  { pose: "shush", line: "Shh. Easy... easy... I can see you reaching for the screen." },
];

const REACTIONS = [
  { pose: "celebrate", mood: "win", line: "GET IN. Tonight's sorted.", sfx: "fanfare", w: 3 },
  { pose: "celebrate", mood: "win", line: "YES. Finally, the button has taste.", sfx: "fanfare", w: 2 },
  { pose: "jazz-hands", mood: "win", line: "Ta-daaa. Tonight's entertainment.", sfx: "fanfare", w: 3 },
  { pose: "jazz-hands", mood: "win", line: "Called it. Didn't call it. Still counts.", sfx: "fanfare", w: 2 },
  { pose: "despair-collapse", mood: "lose", line: "Oh no. Oh no no no. Honesty's the brand.", sfx: "trombone", w: 3 },
  { pose: "despair-flat", mood: "lose", line: "Why. WHY. Fine. It's tonight's game.", sfx: "trombone", w: 3 },
  { pose: "thumbs-down", mood: "shock", line: "It actually picked that. Wow. Okay.", sfx: "crash", w: 2 },
  { pose: "shrug", mood: "shock", line: "Well done, button. Truly inspired.", sfx: "crash", w: 2 },
];

// chibi stickers slapped on the screen (site/stickers/<pose>.webp, trimmed with their border)
const STICKERS = ["shrug", "thumbs-down", "jazz-hands", "despair-collapse", "scheming", "celebrate",
  "pointing-accuse", "shush", "tap-watch", "electrocuted-b"];

// ------------------------------------------------------------------ reel kinematics

// A segment moves the reel from p0 with velocity v0 -> v1 over [t0, t1] (cards / second),
// velocity eased by `ease`: lin (steady change), out (big change early, gentle late).
const EASE = {
  lin: { e: (u) => u, E: (u) => (u * u) / 2 },
  out: { e: (u) => 1 - (1 - u) ** 2, E: (u) => u - (1 - (1 - u) ** 3) / 3 },
  in: { e: (u) => u * u, E: (u) => (u ** 3) / 3 },
};

function segDist(T, v0, v1, ease) { return T * (v0 + (v1 - v0) * EASE[ease].E(1)); }

export function reelAt(reel, t) {
  const segs = reel.segs;
  let s = segs[0];
  if (t <= s.t0) return { p: s.p0, v: 0 };
  for (s of segs) if (t < s.t1) break;
  if (t >= s.t1) return { p: s.p0 + segDist(s.t1 - s.t0, s.v0, s.v1, s.ease), v: 0, hold: true };
  const T = s.t1 - s.t0, u = (t - s.t0) / T, k = EASE[s.ease];
  let p = s.p0 + T * (s.v0 * u + (s.v1 - s.v0) * k.E(u));
  let v = s.v0 + (s.v1 - s.v0) * k.e(u);
  if (s.bounce) { // a slammed stop: a small damped rock about the card
    const a = t - s.t0;
    p += s.bounce * Math.exp(-a * 9) * Math.sin(a * 38);
  }
  if (s.jitter) p += Math.sin(t * 91) * 0.06 + Math.sin(t * 37) * 0.08;
  return { p, v };
}

// ------------------------------------------------------------------ build

export function pickResult(code, pool) {
  const r = stream(code, "pick");
  return pool[r.int(pool.length)];
}

export function buildSpin(code, data) {
  const date = codeDate(code);
  const pool = eligible(data.catalogue, data.played || [], date);
  if (!pool.length) throw new Error("No eligible games for this date.");
  const result = pickResult(code, pool);
  const R = stream(code, "show");
  const track = [], bubbles = [], stickers = [], fx = [], sfx = [];
  const segs = [];
  let t = 0, p = 0;
  const seg = (T, v0, v1, ease = "lin", extra = {}) => {
    segs.push({ t0: t, t1: t + T, p0: p, v0, v1, ease, ...extra });
    p += segDist(T, v0, v1, ease); t += T;
  };
  const hold = (T, extra = {}) => seg(T, 0, 0, "lin", extra);
  const say = (t0, text, extra = {}) => {
    const dur = extra.dur || Math.max(2.0, 0.9 + text.length / 16);
    bubbles.push({ t0, t1: t0 + dur, text, ...extra });
    sfx.push({ t: t0, name: "pop" });
  };
  // the puppet: one key = a move into a pose (see puppet.js)
  const key = (t0, pose, o = {}) => track.push({ t: t0, pose, ...o });
  // the house moves: how he snaps into a pose
  const move = (t0, pose, how = "pop", o = {}) => {
    if (how === "lunge") key(t0, pose, { dur: 0.12, ease: "snap", smear: [120, -40], lines: { at: [900, 600] }, wobble: 0.14, jitter: 1.2, ...o });
    else if (how === "rub") key(t0, pose, { dur: 0.12, ease: "snap", smear: [0, 90], wobble: 0.12, jitter: 2.2, ...o });
    else if (how === "tap") key(t0, pose, { dur: 0.1, ease: "snap", smear: [0, -80], wobble: 0.12, jitter: 1, ...o });
    else if (how === "drop") key(t0, pose, { dur: 0.1, ease: "out", smear: [0, 160], wobble: 0.3, impact: true, ...o });
    else if (how === "jump") key(t0, pose, { dur: 0.1, ease: "snap", smear: [0, -170], lines: { at: [600, 500] }, wobble: 0.2, impact: true, y: -24, jitter: 1.4, ...o });
    else key(t0, pose, { dur: 0.1, ease: "back", smear: [0, -70], wobble: 0.16, ...o });
  };
  const V = R.range(13, 17); // cruise speed, cards per second

  // --- 0. the slam: he does it "properly" (anticipation, wind-up with tremble, 2-frame smear
  // down, impact frames, squash, recovery)
  const impact = 1.7;
  key(0, "idle", { breathe: true });
  key(0.95, "idle", { dur: 0.12, ease: "out", sy: 0.88, sx: 1.08 });                     // anticipation
  key(1.12, "slam-windup", { dur: 0.08, ease: "snap", smear: [0, -170], lines: { at: [600, 420] }, wobble: 0.1, jitter: 3 });
  key(1.2, "slam-windup", { dur: 0.33, ease: "out", y: -26, sy: 1.06, jitter: 4.5 });   // trembling hold
  // the downswing: two stretched smear frames of the wind-up, then contact
  key(1.57, "slam-windup", { dur: 0.06, ease: "lin", y: 30, sy: 1.34, sx: 0.8, smear: [-40, 280], lines: { at: [380, 640] } });
  key(impact - 0.07, "slam-impact", { dur: 0.07, ease: "lin", y: 0, sy: 1, sx: 1, smear: [-60, 260], lines: { at: [420, 900] }, impact: true, impactDelay: 2, wobble: 0.24, jitter: 1.2 });
  sfx.push({ t: 0.95, name: "whoosh" }, { t: 1.12, name: "charge", dur: 0.45 }, { t: 1.55, name: "whoosh" });
  say(0.15, R.pick(["Oh, you pressed it? Cute. Let me do it PROPERLY.",
    "No no no. Like THIS.", "Stand back. Professional button presser coming through."]), { dur: 1.6 });
  fx.push({ t: impact, type: "slam" });
  sfx.push({ t: impact, name: "boom" });
  hold(impact + 0.05);
  seg(0.7, 0, V, "lin");
  sfx.push({ t: impact + 0.05, name: "whoosh" });

  // --- 1. bits and fake-outs
  const nFakes = R.pick([0, 1, 1, 1, 1, 2, 2]);
  const fakeTypes = R.shuffle(["nap", "break"]).slice(0, nFakes);
  const bits = R.shuffle(BITS).slice(0, 4);
  let bi = 0;
  const n = pool.length;
  const cruiseBit = () => {
    const b = bits[bi++ % bits.length];
    const span = 3.4 + (b.span || 0);
    const t0 = t + (bi === 1 ? 0.55 : 0.1);   // the first one waits for the slam to settle
    if (b.move === "glass") {
      // presses up against the screen: zoom in, squash flat against the glass on each tap
      key(t0, b.pose, { dur: 0.16, ease: "back", sx: 1.22, sy: 1.22, y: -40, smear: [0, -60], wobble: 0.1 });
      for (const k of [0.35, 0.6, 1.4, 1.65]) {
        key(t + k, b.pose, { dur: 0.04, ease: "lin", sx: 1.36, sy: 1.12, y: -40 });
        key(t + k + 0.05, b.pose, { dur: 0.14, ease: "back", sx: 1.22, sy: 1.22, y: -40, wobble: 0.08 });
      }
      key(t + span - 0.25, "idle", { dur: 0.14, ease: "back", y: 0, smear: [0, 60], wobble: 0.12, breathe: true });
    } else {
      move(t0, b.pose, b.move);
      const bounce = (tb) => {
        key(tb, b.pose === "idle" ? "idle" : track[track.length - 1].pose, { dur: 0.08, ease: "out", sy: 0.9, sx: 1.07, jitter: 1 });
        key(tb + 0.08, track[track.length - 1].pose, { dur: 0.2, ease: "back", sy: 1, sx: 1, wobble: 0.14, jitter: 1 });
      };
      bounce(t0 + 1.0);
      if (b.alt) move(t0 + 1.9, b.alt, "pop", { jitter: 1 });
      bounce(t0 + 2.8);
    }
    say(t + 0.25, b.line.replace("{n}", String(n)), { dur: span - 0.3 });
    if (b.fx === "tap") {
      for (const k of [0.35, 0.6, 1.4, 1.65]) { fx.push({ t: t + k, type: "tap" }); sfx.push({ t: t + k, name: "tap" }); }
      fx.push({ t: t + 1.65, type: "crack" });
    }
    if (b.fx === "stickers") {
      const picks = R.shuffle(STICKERS).slice(0, 3);
      picks.forEach((s, k) => stickers.push({ t0: t - 0.6 + k * 0.45, t1: t + span, src: s,
        x: R.range(0.15, 0.85), y: R.range(0.15, 0.55), rot: R.range(-18, 18), scale: R.range(0.8, 1.1) }));
      picks.forEach((_, k) => sfx.push({ t: t - 0.6 + k * 0.45, name: "slap" }));
    }
    seg(span, V, V, "lin");
  };
  // the first bit starts while the reel is still spinning up
  cruiseBit();

  const entries = []; // filled after the plan, by index
  const fixed = {};    // index -> game
  const shoved = [];   // indices that got pushed out of the slot

  for (const ft of fakeTypes) {
    if (ft === "nap") {
      // the reel "lands"... but it's only having a nap; he shoves it on
      const T1 = 2.4, vEnd = 0;
      const pEnd = Math.ceil(p + segDist(T1, V, vEnd, "out") + 0.6 * V) ;
      const Tc = (pEnd - p - segDist(T1, V, vEnd, "out")) / V;
      seg(Tc, V, V);
      const tDecel = t;
      sfx.push({ t: tDecel, name: "drumroll", dur: T1 });
      seg(T1, V, vEnd, "out");
      const S = Math.round(p); p = S;
      say(tDecel + 0.2, "Ooh. Ooh. Is this it?", { dur: T1 - 0.2 });
      move(tDecel, "scheming", "rub", { jitter: 3 });
      const tLand = t;
      fx.push({ t: tLand, type: "fakeland", idx: S });
      sfx.push({ t: tLand, name: "thud" });
      const fake = R.pick(pool.filter((g) => g.id !== result.id));
      fixed[S] = fake;
      say(tLand + 0.35, R.pick(["Hang on. That's not a stop. That's a nap. GO ON.",
        "Nope. It's not finished. It's just tired. MOVE.", "It didn't land. It wobbled. Wobbles don't count."]), { dur: 2.6 });
      const tPush = tLand + 1.9;
      key(tLand + 0.3, "idle", { dur: 0.1, ease: "back", smear: [0, -60], wobble: 0.14, jitter: 1.5 });
      key(tPush - 0.35, "idle", { dur: 0.2, ease: "out", x: -40, sx: 0.94, sy: 1.04 });      // lean back
      key(tPush - 0.08, "shove-offscreen", { dur: 0.08, ease: "lin", x: 30, smear: [260, 0], lines: { at: [900, 640] }, impact: true, wobble: 0.2 });
      key(tPush + 0.9, "idle", { dur: 0.14, ease: "back", x: 0, smear: [-80, 0], wobble: 0.12, breathe: true });
      hold(tPush - tLand);
      fx.push({ t: tPush, type: "shove", idx: S });
      sfx.push({ t: tPush, name: "shove" });
      shoved.push({ idx: S, t: tPush });
      seg(0.6, 0, V, "lin");
      cruiseBit();
    } else {
      // the wheel "breaks": static, sparks, he gets electrocuted, accuses the viewer
      const tb = t;
      key(tb, "electrocuted-a", { dur: 0, y: -30, zap: ["electrocuted-a", "electrocuted-b"], impact: true });
      key(tb + 2.8, "frazzled-aftermath", { dur: 0.1, ease: "out", y: 0, smear: [0, 90], wobble: 0.18, jitter: 0.6 });
      fx.push({ t: tb + 2.8, type: "smoke", dur: 2.4 });
      sfx.push({ t: tb, name: "zap", dur: 2.8 }, { t: tb + 2.8, name: "fizzle" });
      fx.push({ t: tb, type: "glitch", dur: 2.8 });
      sfx.push({ t: tb, name: "glitch", dur: 2.8 });
      hold(2.8, { jitter: true });
      say(tb + 0.4, R.pick(["Did you do that? You did that. Stop touching things.",
        "WHO UNPLUGGED IT. Was it you? It was you.", "Brilliant. You broke it. Turning it off and on again."]), { dur: 2.6 });
      fx.push({ t: t, type: "reboot" });
      sfx.push({ t: t, name: "whoosh" });
      seg(0.6, 0, V, "lin");
      cruiseBit();
    }
  }
  if (!fakeTypes.length) cruiseBit();

  // --- 2. the real slowdown: decelerate, crawl, SLAM
  const sd = R.pick(SLOWDOWN);
  const T1 = R.range(3.0, 3.6), vc = R.range(1.1, 1.5), Tcr = R.range(1.3, 1.9), vc2 = vc * 0.7;
  const dTail = segDist(T1, V, vc, "out") + segDist(Tcr, vc, vc2, "lin");
  const S = Math.ceil(p + 1.0 * V + dTail);
  seg((S - dTail - p) / V, V, V);
  const tSlow = t;
  move(tSlow, sd.pose, sd.pose === "scheming" ? "rub" : "lunge", { jitter: 2.6 });
  say(tSlow + 0.1, sd.line, { dur: T1 + Tcr - 0.2 });
  sfx.push({ t: tSlow, name: "drumroll", dur: T1 + Tcr });
  seg(T1, V, vc, "out");
  seg(Tcr, vc, vc2, "lin");
  p = S;
  const tStop = t;
  fixed[S] = result;
  hold(9, { bounce: 0.14 });

  // --- 3. the landing (the Short's cold open: tStop - 0.25 .. tStop + 1.35)
  const reaction = weighted(R, REACTIONS);
  fx.push({ t: tStop, type: "land" });
  fx.push({ t: tStop + 0.12, type: "title" });
  fx.push({ t: tStop + 0.3, type: "stamp" });
  sfx.push({ t: tStop, name: "slam" });
  sfx.push({ t: tStop + 0.3, name: "stamp" });
  sfx.push({ t: tStop + 0.05, name: reaction.sfx });
  if (reaction.mood === "win") {
    move(tStop, reaction.pose, "jump");
    fx.push({ t: tStop + 0.05, type: "confetti", dur: 3.2 });
  }
  else if (reaction.mood === "lose") move(tStop, reaction.pose, "drop");
  else move(tStop, reaction.pose, "lunge", { impact: true });
  // shown whole (not typed) from tStop + 0.3, so it's complete inside the 1.6 s landing
  say(tStop + 0.3, reaction.line, { dur: 2.6, style: "big" });
  const tOut = tStop + 3.0;
  // the outro: back on his feet, pointing at you
  move(tOut - 0.05, reaction.mood === "lose" ? "shrug" : "pointing-accuse", reaction.mood === "lose" ? "pop" : "lunge", { y: 0 });
  say(tOut, R.pick(["That's tonight's game. No re-rolls. You saw it.",
    "Right. That's what we're playing. The button has spoken.",
    "No take-backs. Downloading it now. Probably 90 gigs."]), { dur: 3.2 });
  const duration = tOut + 3.6;

  // --- reel entries: a seeded shuffle of the pool, with the fixed cards placed
  // (the fast spin cycles a seeded 40-game subset, so a phone downloads ~45 box arts, not 300)
  const total = S + 4;
  const showPool = R.shuffle(pool).slice(0, Math.min(40, n));
  let bag = [];
  for (let i = 0; i < total; i++) {
    if (fixed[i]) { entries.push(fixed[i]); continue; }
    if (!bag.length) bag = R.shuffle(showPool);
    let g = bag.pop();
    if (Math.abs(i - S) <= 2 && g.id === result.id) g = bag.pop() || pool[(pool.indexOf(g) + 1) % n];
    entries.push(g);
  }

  track.sort((a, b) => a.t - b.t);

  // ticks: one per card that passes the window
  let last = Math.floor(reelAt({ segs }, 0).p);
  for (let k = 1; k <= Math.ceil(tStop * 200); k++) {
    const tt = k / 200, c = Math.floor(reelAt({ segs }, tt).p + 0.5);
    if (c !== last && tt < tStop - 0.02) { sfx.push({ t: tt, name: "tick" }); last = c; }
  }
  sfx.sort((a, b) => a.t - b.t);

  return {
    code, date, catalogDate: data.catalogDate, eligibleCount: n,
    result, reaction: { pose: reaction.pose, mood: reaction.mood },
    duration, tStop, landing: [Math.max(0, tStop - 0.25), tStop + 1.35],
    reel: { segs, entries, shoved, V }, track, bubbles, stickers, fx, sfx,
  };
}

function weighted(R, list) {
  const total = list.reduce((s, x) => s + x.w, 0);
  let k = R.float() * total;
  for (const x of list) { k -= x.w; if (k < 0) return x; }
  return list[list.length - 1];
}
