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

// Fourth-wall bits during the fast spin. {clip, line, extra fx}
const BITS = [
  { id: "blink", clip: "point-at-you", line: "Don't blink. Blinking is cheating." },
  { id: "rigged", clip: "scheming", line: "You've rigged this. I can tell. You've got a rigging face." },
  { id: "watch", clip: "arms-crossed-tap", line: "Any time today. Some of us have a download bar to stare at.", fx: "watch" },
  { id: "glass", clip: "finger-wag-no", line: "*tap tap* Hello? You've got a thumbprint on your screen. Gross.", fx: "tap" },
  { id: "shush", clip: "dont-you-dare", line: "Shh. SHH. It's concentrating." },
  { id: "rules", clip: "talk-passionately", line: "{n} games. One button. No re-rolls. Those are the rules.", span: 3.0 },
  { id: "illegal", clip: "sceptical-chin", line: "Is it allowed to go this fast? Feels illegal." },
  { id: "sticker", clip: "shrug", line: "Who keeps putting stickers on the screen? Was that you?", fx: "stickers" },
  { id: "editor", clip: "headache", line: "Editor, if this lands on a golf game, cut it. Actually don't. Honesty." },
  { id: "coward", clip: "laugh", line: "You pressed it like a coward. One finger? Really?" },
  { id: "lean", clip: "point-left", line: "Look at it go. Look at it. No, not at me. AT IT." },
];

const SLOWDOWN = [
  { clip: "frustrated-head-grab", line: "Slowing down... slowing down... don't you DARE be a golf game." },
  { clip: "shocked", line: "Here it comes. Here it comes. Nobody breathe." },
  { clip: "sceptical-chin", line: "Drumroll, please. I said DRUMROLL." },
  { clip: "dont-you-dare", line: "Easy... easy... I can see you reaching for the screen. Don't." },
];

const REACTIONS = [
  { clip: "flex", mood: "win", line: "GET IN. Tonight's sorted.", sfx: "fanfare", w: 3 },
  { clip: "backflip", mood: "win", line: "Didn't even warm up for that.", sfx: "fanfare", w: 3 },
  { clip: "jazz-hands", mood: "win", line: "Ta-daaa. Tonight's entertainment.", sfx: "fanfare", w: 3 },
  { clip: "cheer", mood: "win", line: "YES. Finally, the button has taste.", sfx: "fanfare", w: 2 },
  { clip: "victory-fist-pump", mood: "win", line: "Called it. Didn't call it. Still counts.", sfx: "fanfare", w: 2 },
  { clip: "collapse", mood: "lose", line: "Oh no. Oh no no no. ...Honesty's the brand.", sfx: "trombone", w: 3 },
  { clip: "despair-knees", mood: "lose", line: "Why. WHY. Fine. It's tonight's game.", sfx: "trombone", w: 2 },
  { clip: "facepalm", mood: "lose", line: "Of course it's that. Of course it is.", sfx: "trombone", w: 2 },
  { clip: "shocked", mood: "shock", line: "It actually picked that. Wow. Okay.", sfx: "crash", w: 2 },
  { clip: "slow-clap", mood: "shock", line: "Well done, button. Truly inspired.", sfx: "crash", w: 2 },
];

const STICKERS = ["table-flip", "mind-blown", "rage", "steaming", "eye-roll", "chefs-kiss",
  "sceptical", "shocked", "tantrum", "megaphone", "point-at-you", "sigh"];

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
  const clipDur = (c) => (data.clips && data.clips[c] ? data.clips[c].duration : 3);

  const avatar = [], bubbles = [], stickers = [], fx = [], sfx = [];
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
  const play = (t0, clip, extra = {}) => avatar.push({ t0, clip, ...extra });
  const V = R.range(13, 17); // cruise speed, cards per second

  // --- 0. the slam: he does it "properly"
  play(0, "button-slam");
  say(0.15, R.pick(["Oh, you pressed it? Cute. Let me do it PROPERLY.",
    "No no no. Like THIS.", "Stand back. Professional button presser coming through."]), { dur: 1.6 });
  const impact = 1.7;
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
    play(t + 0.1, b.clip);
    say(t + 0.25, b.line.replace("{n}", String(n)), { dur: span - 0.3 });
    if (b.fx === "tap") {
      for (const k of [0.35, 0.6, 1.4, 1.65]) { fx.push({ t: t + k, type: "tap" }); sfx.push({ t: t + k, name: "tap" }); }
      fx.push({ t: t + 1.65, type: "crack" });
    }
    if (b.fx === "watch") fx.push({ t: t + 0.3, type: "watch", dur: 3 });
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
      play(tDecel, "shocked");
      const tLand = t;
      fx.push({ t: tLand, type: "fakeland", idx: S });
      sfx.push({ t: tLand, name: "thud" });
      const fake = R.pick(pool.filter((g) => g.id !== result.id));
      fixed[S] = fake;
      say(tLand + 0.35, R.pick(["Hang on. That's not a stop. That's a nap. GO ON.",
        "Nope. It's not finished. It's just tired. MOVE.", "It didn't land. It wobbled. Wobbles don't count."]), { dur: 2.6 });
      play(tLand - 1.0, "shove-it-on"); // the push lands ~2.9 s into the clip
      const tPush = tLand - 1.0 + 2.9;
      hold(tPush - tLand);
      fx.push({ t: tPush, type: "shove", idx: S });
      sfx.push({ t: tPush, name: "shove" });
      shoved.push({ idx: S, t: tPush });
      seg(0.6, 0, V, "lin");
      cruiseBit();
    } else {
      // the wheel "breaks": static, sparks, he gets electrocuted, accuses the viewer
      const tb = t;
      play(tb - 0.3, "electrocuted");
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
  play(tSlow, sd.clip);
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
  play(tStop, reaction.clip, { holdEnd: true });
  say(tStop + 0.45, reaction.line, { dur: 2.4, style: "big" });
  const tOut = tStop + 3.0;
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

  // idle fills the gaps; a clip runs to its end unless the next one starts first
  avatar.sort((a, b) => a.t0 - b.t0);
  for (let i = 0; i < avatar.length; i++) {
    const a = avatar[i], next = avatar[i + 1];
    const end = a.t0 + clipDur(a.clip);
    a.t1 = a.holdEnd ? duration + 1 : (next ? Math.min(end, next.t0) : end);
  }

  // ticks: one per card that passes the window
  let last = Math.floor(reelAt({ segs }, 0).p);
  for (let k = 1; k <= Math.ceil(tStop * 200); k++) {
    const tt = k / 200, c = Math.floor(reelAt({ segs }, tt).p + 0.5);
    if (c !== last && tt < tStop - 0.02) { sfx.push({ t: tt, name: "tick" }); last = c; }
  }
  sfx.sort((a, b) => a.t - b.t);

  return {
    code, date, catalogDate: data.catalogDate, eligibleCount: n,
    result, reaction: { clip: reaction.clip, mood: reaction.mood },
    duration, tStop, landing: [Math.max(0, tStop - 0.25), tStop + 1.35],
    reel: { segs, entries, shoved, V }, avatar, bubbles, stickers, fx, sfx,
  };
}

function weighted(R, list) {
  const total = list.reduce((s, x) => s + x.w, 0);
  let k = R.float() * total;
  for (const x of list) { k -= x.w; if (k < 0) return x; }
  return list[list.length - 1];
}
