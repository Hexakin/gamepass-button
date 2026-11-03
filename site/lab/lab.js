// 10-second animation test: chibi Hexakin slams the button, then the button electrocutes him.
// Same engine as the show: everything is a pure function of t; ?render=916 for capture.
import { Puppet, noise, POSES } from "../js/puppet.js";
import { schedule, renderWav } from "../js/audio.js";

const params = new URLSearchParams(location.search);
const RENDER = params.get("render");
if (params.get("safe")) document.body.classList.add("safe");
if (RENDER) document.body.classList.add("render");
const $ = (id) => document.getElementById(id);
const stage = $("stage");
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOutBack = (u) => { const c = 1.9; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };

function fit() {
  if (RENDER) { stage.style.transform = "none"; return; }
  const TOP = 8, BOTTOM = 92;
  const w = innerWidth, h = innerHeight;
  const s = Math.min(w / 1080, (h - TOP - BOTTOM) / 1920);
  stage.style.transform = `translate(${(w - 1080 * s) / 2}px, ${TOP}px) scale(${s})`;
}
addEventListener("resize", fit); fit();
$("pedestal").style.display = "none";

// ------------------------------------------------------------------ the test timeline
const SLAM = 2.0, ZAP = 4.9, AFTER = 7.1, JOLTS = [8.55, 8.85];
const track = [
  { t: 0, pose: "idle", breathe: true },
  // anticipation: a quick crouch
  { t: 1.25, pose: "idle", dur: 0.12, ease: "out", sy: 0.88, sx: 1.08 },
  // snap up into the wind-up, a short trembling hold (~0.35 s)
  { t: 1.42, pose: "slam-windup", dur: 0.08, ease: "snap", smear: [0, -170], lines: { at: [600, 420] }, wobble: 0.1, jitter: 3 },
  { t: 1.5, pose: "slam-windup", dur: 0.33, ease: "out", y: -26, sy: 1.06, jitter: 4.5 },
  // the downswing: two stretched smear frames, then contact (clean for 2 frames, then impact frames)
  { t: SLAM - 0.13, pose: "slam-windup", dur: 0.06, ease: "lin", y: 30, sy: 1.34, sx: 0.8, smear: [-40, 280], lines: { at: [380, 640] } },
  { t: SLAM - 0.07, pose: "slam-impact", dur: 0.07, ease: "lin", y: 0, smear: [-60, 260], lines: { at: [420, 900] }, impact: true, impactDelay: 2, wobble: 0.24, jitter: 1.2 },
  // pop back up, proud
  { t: 3.45, pose: "idle", dur: 0.16, ease: "back", smear: [-70, -150], wobble: 0.1, breathe: true },
  // the button bites back
  { t: ZAP, pose: "electrocuted-a", dur: 0, ease: "lin", y: -30, zap: ["electrocuted-a", "electrocuted-b"], impact: true },
  { t: AFTER, pose: "frazzled-aftermath", dur: 0.1, ease: "out", y: 0, smear: [0, 90], wobble: 0.18, jitter: 0.6 },
  // a clear double jolt: two snaps up into the shock pose and back
  ...JOLTS.flatMap((j) => [
    { t: j, pose: "electrocuted-b", dur: 0.03, ease: "lin", y: -22, jitter: 6 },
    { t: j + 0.12, pose: "frazzled-aftermath", dur: 0.06, ease: "out", y: 0, wobble: 0.16, jitter: 0.6 },
  ]),
];
const DURATION = 10.0;
const bubbles = [
  { t0: 0.15, t1: 1.3, text: "Watch closely. THIS is how you press a button." },
  { t0: 3.65, t1: 4.8, text: "See? Textbook.", big: true },
  { t0: 7.35, t1: 8.5, text: "...who wired the button to the mains." },
  { t0: 8.55, t1: 9.95, text: "BZZT. BZZT. Was it you?", big: true },
];
const sfx = [
  { t: 0.15, name: "pop" }, { t: 1.25, name: "whoosh" },
  { t: 1.42, name: "charge", dur: 0.45 }, { t: SLAM - 0.13, name: "whoosh" },
  { t: SLAM, name: "slam" }, { t: SLAM, name: "boom" }, { t: SLAM + 0.05, name: "stamp" },
  { t: 3.45, name: "boing" }, { t: 3.65, name: "pop" },
  { t: ZAP, name: "crash" }, { t: ZAP, name: "zap", dur: AFTER - ZAP },
  { t: AFTER, name: "fizzle" }, { t: 7.35, name: "pop" },
  ...JOLTS.map((j) => ({ t: j, name: "zap", dur: 0.14 })),
];
const spin = { sfx, tStop: DURATION, duration: DURATION };

// ------------------------------------------------------------------ puppet + fx
const SCALE = 0.71, FEET_AT = [425, 1490];
const puppet = new Puppet($("avatar"), { scale: SCALE, feetAt: FEET_AT, base: "../avatar/chibi/" });
const fromCanvas = ([cx, cy]) => [FEET_AT[0] + (cx - 600) * SCALE, FEET_AT[1] + (cy - 1140) * SCALE];
// the drawn button: slam-windup has it at canvas (300, 1050), slam-impact at (410, 1050)
const BTN_BEFORE = fromCanvas([300, 1040]), BTN_AFTER = fromCanvas([410, 1040]);
const BUTTON_TOP = fromCanvas([410, 985]);
const ZAP_TARGETS = [[160, 560], [1040, 560], [600, 380]];   // electrocuted-a: hands, head

function bolt(x0, y0, x1, y1, seed, segs = 9) {
  let d = `M${x0} ${y0}`;
  for (let i = 1; i < segs; i++) {
    const u = i / segs, nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny) || 1;
    const off = noise(seed * 31 + i * 7) * 46;
    d += `L${(x0 + (x1 - x0) * u + nx / l * off).toFixed(0)} ${(y0 + (y1 - y0) * u + ny / l * off).toFixed(0)}`;
  }
  return d + `L${x1} ${y1}`;
}

const zappingAt = (t) => (t >= ZAP && t < AFTER) || JOLTS.some((j) => t >= j && t < j + 0.12);

function draw(t) {
  const st = puppet.draw(track, t);

  // screen shake: big at the slam, constant buzz while zapped
  let sx = 0, sy = 0;
  const a = t - SLAM;
  if (a >= 0 && a < 0.7) { const k = 38 * Math.exp(-a * 8); sx += k * Math.sin(a * 83); sy += k * Math.cos(a * 61); }
  if (zappingAt(t)) { const f = Math.floor(t * 30); sx += noise(f * 11) * 9; sy += noise(f * 13) * 7; }
  const az = t - ZAP;
  if (az >= 0 && az < 0.4) { const k = 26 * Math.exp(-az * 9); sx += k * Math.sin(az * 70); }
  $("shake").style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;

  // impact frames: red field behind the silhouette for 2 frames, then a white flash
  $("impactbg").style.opacity = st.impact ? 1 : 0;
  let fl = 0;
  if (a >= 4 / 30 && a < 0.3) fl = 0.45 * (1 - (a - 4 / 30) / 0.17);
  // (no white flash at the zap: strobe safety, max 3 flashes a second, Hexakin's area only)
  $("flash").style.opacity = Math.max(0, fl).toFixed(3);

  // the button: the slam poses draw their own; otherwise ours stands where theirs is
  const b = $("bigbutton");
  const drawn = st.pose === "slam-windup" || st.pose === "slam-impact";
  b.style.visibility = drawn ? "hidden" : "visible";
  const [bx, by] = a >= 0 ? BTN_AFTER : BTN_BEFORE;
  const bs = a >= 0 && a < 0.45 ? 0.6 + 0.4 * clamp(easeOutBack(clamp(a / 0.45))) : 1;
  const bj = t >= ZAP && t < AFTER ? noise(Math.floor(t * 30) * 3) * 6 : 0;
  b.style.left = `${(bx - 120).toFixed(0)}px`; b.style.top = `${(by - 150).toFixed(0)}px`;
  b.style.transform = `translateX(${bj.toFixed(1)}px) scale(${((2 - bs) ** 0.5 * 0.62).toFixed(3)}, ${(bs * 0.62).toFixed(3)})`;
  const bt = a - 4 / 30;
  $("boom").style.opacity = bt >= 0 && bt < 0.85 ? 1 : 0;
  $("boom").style.transform = `rotate(-8deg) scale(${bt >= 0 ? easeOutBack(clamp(bt / 0.18)).toFixed(3) : 0})`;

  // zap: dark flicker frames behind him, bolts from the button into his hands and head
  const zapping = (t >= ZAP && t < AFTER) || JOLTS.some((j) => t >= j && t < j + 0.12);
  if (zapping) {
    const seed = Math.floor(t * 15);
    const [bx, by] = BUTTON_TOP;
    const targets = ZAP_TARGETS.map((c) => puppet.toStage(c, st));
    const paths = targets.map(([x, y], i) => bolt(bx, by, x.toFixed(0), y.toFixed(0), seed * 3 + i));
    $("bolts").innerHTML = paths.map((d) =>
      `<path d="${d}" stroke="#7fe8ff" stroke-width="22" stroke-linejoin="round" fill="none" opacity=".45"/>` +
      `<path d="${d}" stroke="#fff" stroke-width="8" stroke-linejoin="round" fill="none"/>`).join("");
  } else if ($("bolts").innerHTML) $("bolts").innerHTML = "";

  // fx layer: impact star + dust at the slam, smoke from his head after the zap
  let fx = "", back = "";
  if (bt >= 0 && bt < 0.3) {
    const [x, y] = [BUTTON_TOP[0], BUTTON_TOP[1] + 10], r = 40 + 150 * easeOutBack(clamp(bt / 0.15));
    let pts = "";
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r * (0.85 + 0.15 * noise(i));
      pts += `${(x + Math.cos(ang) * rr).toFixed(0)},${(y + Math.sin(ang) * rr * 0.75).toFixed(0)} `;
    }
    back = `<polygon points="${pts}" fill="#FFE14D" stroke="#0A0A0B" stroke-width="8" opacity="${(1 - clamp((bt - 0.16) / 0.14)).toFixed(2)}"/>`;
  }
  if (a >= 0 && a < 1.1) {
    for (let i = 0; i < 7; i++) {
      const dir = i < 3.5 ? -1 : 1, k = (i % 4) + 1;
      const x = Math.max(90, Math.min(930, BUTTON_TOP[0] + dir * (50 + a * 150 * k * 0.5))), y = 1475 - a * 70 * (1 + (i % 3) * 0.4);
      const r = 18 + a * 60 + (i % 3) * 8;
      fx += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="#cfc6b1" stroke="#0A0A0B" stroke-width="5" opacity="${(1 - a / 1.1).toFixed(2)}"/>`;
    }
  }
  const sm = t - AFTER;
  if (sm >= 0 && sm < 2.9) {
    const [hx, hy] = puppet.toStage([600, 330], st);
    for (let i = 0; i < 6; i++) {
      const life = (sm - i * 0.32);
      if (life < 0 || life > 1.6) continue;
      const x = hx + Math.sin(life * 3 + i) * 26 + (i % 2 ? 18 : -18), y = hy - 40 - life * 230;
      fx += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(22 + life * 46).toFixed(0)}" fill="#3a3a3f" opacity="${(0.75 * (1 - life / 1.6)).toFixed(2)}"/>`;
    }
  }
  $("fxsvg").innerHTML = fx;
  $("fxback").innerHTML = back;

  // speech bubble (whole text pops in: readable on the first frame it shows)
  let bub = null;
  for (const bb of bubbles) if (t >= bb.t0 && t < bb.t1) bub = bb;
  const B = $("bubble");
  if (bub) {
    const u = t - bub.t0, out = clamp((t - (bub.t1 - 0.12)) / 0.12);
    B.style.opacity = 1 - out;
    B.style.transform = `scale(${(easeOutBack(clamp(u / 0.16)) * (1 - 0.2 * out)).toFixed(3)})`;
    if (B.dataset.k !== bub.text) { B.dataset.k = bub.text; B.querySelector(".txt").textContent = bub.text; }
    B.classList.toggle("big", !!bub.big);
  } else B.style.opacity = 0;
}

const ready = (async () => {
  await document.fonts.ready;
  await puppet.load(POSES);
  draw(0);
  return true;
})();

if (RENDER) {
  window.__show = {
    ready,
    info: () => ({ code: "LAB-SLAMZAP", date: new Date().toISOString().slice(0, 10), duration: DURATION,
      tStop: SLAM, landing: [SLAM - 0.4, SLAM + 1.4] }),
    seek: async (t) => { draw(t); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); },
    audioWav: async () => {
      const bytes = await renderWav(spin, null);
      let s = ""; const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return btoa(s);
    },
  };
} else {
  let playing = false;
  ready.then(() => { $("play").disabled = false; $("play").textContent = "PLAY THE TEST"; });
  $("play").addEventListener("click", async () => {
    if (playing) return;
    playing = true; $("play").textContent = "PLAYING…";
    let ctx = null, t0 = performance.now();
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      try {
        if (navigator.audioSession) navigator.audioSession.type = "playback";
        ctx = new AC(); ctx.resume();
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
        if (ctx.state !== "running") throw new Error("audio blocked");
        t0 = ctx.currentTime + 0.05;
        schedule(ctx, spin, t0, null);
      } catch { ctx = null; t0 = performance.now(); }
    }
    const clock = () => (ctx ? ctx.currentTime - t0 : (performance.now() - t0) / 1000);
    const frame = () => {
      const t = clock();
      draw(Math.max(0, t));
      if (t < DURATION) requestAnimationFrame(frame);
      else { playing = false; $("play").textContent = "PLAY AGAIN"; if (ctx) setTimeout(() => ctx.close(), 800); }
    };
    requestAnimationFrame(frame);
  });
}
