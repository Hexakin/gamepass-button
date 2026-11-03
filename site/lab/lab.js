// 10-second animation test: Hexakin slams the button, then the button electrocutes him.
// Same engine as the show: everything is a pure function of t; ?render=916 for capture.
import { Puppet, noise, KEY_W, KEY_H } from "../js/puppet.js";
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
const SLAM = 2.2, ZAP = 5.0, AFTER = 7.2;
const track = [
  { t: 0, pose: "neutral", breathe: true },
  // anticipation: a quick crouch
  { t: 1.0, pose: "neutral", dur: 0.12, ease: "out", sy: 0.9, sx: 1.07 },
  // snap up into the wind-up, trembling with effort, rising
  { t: 1.22, pose: "slam-windup", dur: 0.1, ease: "snap", smear: [0, -170], lines: { at: [540, 420] }, wobble: 0.1, jitter: 2 },
  { t: 1.7, pose: "slam-windup", dur: 0.38, ease: "out", y: -26, sy: 1.05, jitter: 3.5 },
  // SLAM: a 2-frame smear down to the button, impact frames, squash and wobble
  { t: SLAM - 0.07, pose: "slam-impact", dur: 0.07, ease: "lin", y: 0, smear: [150, 300], lines: { at: [700, 760] }, impact: true, wobble: 0.24, jitter: 1.2 },
  // pop back up, proud
  { t: 3.55, pose: "neutral", dur: 0.16, ease: "back", smear: [-70, -150], wobble: 0.1, breathe: true },
  // the button bites back
  { t: ZAP, pose: "zap-a", dur: 0, ease: "lin", y: -30, zap: ["zap-a", "zap-b"], impact: true },
  { t: AFTER, pose: "zap-after", dur: 0.1, ease: "out", y: 0, smear: [0, 90], wobble: 0.18 },
  // one last twitch
  { t: 8.85, pose: "zap-b", dur: 0.03, ease: "lin", y: -16 },
  { t: 8.95, pose: "zap-after", dur: 0.06, ease: "out", y: 0, wobble: 0.12 },
];
const DURATION = 10.0;
const bubbles = [
  { t0: 0.15, t1: 1.15, text: "Watch closely. THIS is how you press a button." },
  { t0: 3.75, t1: 4.9, text: "See? Textbook.", big: true },
  { t0: 7.45, t1: 9.9, text: "...who wired the button to the mains. Was it you?" },
];
const sfx = [
  { t: 0.15, name: "pop" }, { t: 1.0, name: "whoosh" },
  { t: 1.22, name: "charge", dur: 0.95 }, { t: SLAM - 0.08, name: "whoosh" },
  { t: SLAM, name: "slam" }, { t: SLAM, name: "boom" }, { t: SLAM + 0.05, name: "stamp" },
  { t: 3.55, name: "boing" }, { t: 3.75, name: "pop" },
  { t: ZAP, name: "crash" }, { t: ZAP, name: "zap", dur: AFTER - ZAP },
  { t: AFTER, name: "fizzle" }, { t: 7.45, name: "pop" },
  { t: 8.85, name: "zap", dur: 0.12 },
];
const spin = { sfx, tStop: DURATION, duration: DURATION };

// ------------------------------------------------------------------ puppet + fx
const puppet = new Puppet($("avatar"), { scale: 0.95, feetAt: [330, 1490], base: "../avatar/key/" });
const box = { left: 330 - 0.5203 * KEY_W * 0.95, top: 1490 - 0.9085 * KEY_H * 0.95, s: 0.95 };
const toStage = (fx, fy, st) => [box.left + fx * KEY_W * box.s + (st ? st.x : 0), box.top + fy * KEY_H * box.s + (st ? st.y : 0)];
const FIST = toStage(0.7973, 0.736);          // slam-impact LeftHand
const BUTTON_TOP = [567, 1305];
const ZAP_HANDS = [[0.7506, 0.3645], [0.315, 0.3827]];  // zap-a hands
const HEAD = [0.53, 0.40];

function bolt(x0, y0, x1, y1, seed, segs = 9) {
  let d = `M${x0} ${y0}`;
  for (let i = 1; i < segs; i++) {
    const u = i / segs, nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny) || 1;
    const off = noise(seed * 31 + i * 7) * 46;
    d += `L${(x0 + (x1 - x0) * u + nx / l * off).toFixed(0)} ${(y0 + (y1 - y0) * u + ny / l * off).toFixed(0)}`;
  }
  return d + `L${x1} ${y1}`;
}

function draw(t) {
  const st = puppet.draw(track, t);
  if (track[0].breathe && st.idx >= 0 && track[st.idx].breathe && !st.moving) {
    // breathing on neutral holds
    $("avatar").style.transform += ` scale(1, ${(1 + 0.012 * Math.sin(t * 3.2)).toFixed(4)})`;
  }

  // screen shake: big at the slam, constant buzz while zapped
  let sx = 0, sy = 0;
  const a = t - SLAM;
  if (a >= 0 && a < 0.7) { const k = 38 * Math.exp(-a * 8); sx += k * Math.sin(a * 83); sy += k * Math.cos(a * 61); }
  if (t >= ZAP && t < AFTER) { const f = Math.floor(t * 30); sx += noise(f * 11) * 9; sy += noise(f * 13) * 7; }
  const az = t - ZAP;
  if (az >= 0 && az < 0.4) { const k = 26 * Math.exp(-az * 9); sx += k * Math.sin(az * 70); }
  $("shake").style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;

  // impact frames: red field behind the silhouette for 2 frames, then a white flash
  const impact = (a >= 0 && a < 2 / 30) || (az >= 0 && az < 2 / 30);
  $("impactbg").style.opacity = impact ? 1 : 0;
  let fl = 0;
  if (a >= 2 / 30 && a < 0.25) fl = 0.75 * (1 - (a - 2 / 30) / 0.18);
  if (az >= 2 / 30 && az < 0.2) fl = 0.7 * (1 - az / 0.2);
  $("flash").style.opacity = Math.max(0, fl).toFixed(3);

  // button: squashed by the slam, sparking while it zaps
  const b = $("bigbutton");
  let bs = 1;
  if (a >= -0.05 && a < 0) bs = 0.92;
  else if (a >= 0) bs = a < 0.1 ? 0.5 : 0.5 + 0.5 * clamp(easeOutBack(clamp((a - 0.1) / 0.35)));
  const bj = t >= ZAP && t < AFTER ? noise(Math.floor(t * 30) * 3) * 6 : 0;
  b.style.transform = `translateX(${bj.toFixed(1)}px) scale(${(2 - bs) ** 0.5}, ${bs.toFixed(3)})`;
  $("boom").style.opacity = a >= 0 && a < 0.9 ? 1 : 0;
  $("boom").style.transform = `rotate(-8deg) scale(${a >= 0 ? easeOutBack(clamp(a / 0.18)).toFixed(3) : 0})`;

  // zap: dark flicker frames behind him, bolts from the button into his hands and head
  $("zapbg").style.opacity = st.xray ? 0.92 : 0;
  const zapping = (t >= ZAP && t < AFTER) || (t >= 8.85 && t < 8.95);
  if (zapping) {
    const seed = Math.floor(t * 15);
    const [bx, by] = BUTTON_TOP;
    const targets = [...ZAP_HANDS, HEAD].map(([fx, fy]) => toStage(fx, fy, st));
    const paths = targets.map(([x, y], i) => bolt(bx, by, x.toFixed(0), y.toFixed(0), seed * 3 + i));
    $("bolts").innerHTML = paths.map((d) =>
      `<path d="${d}" stroke="#7fe8ff" stroke-width="22" stroke-linejoin="round" fill="none" opacity=".45"/>` +
      `<path d="${d}" stroke="#fff" stroke-width="8" stroke-linejoin="round" fill="none"/>`).join("");
  } else if ($("bolts").innerHTML) $("bolts").innerHTML = "";

  // fx layer: impact star + dust at the slam, smoke from his head after the zap
  let fx = "";
  if (a >= 0 && a < 0.35) {
    const [x, y] = [BUTTON_TOP[0], BUTTON_TOP[1] + 10], r = 60 + 260 * easeOutBack(clamp(a / 0.15));
    let pts = "";
    for (let i = 0; i < 16; i++) {
      const ang = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r * (0.85 + 0.15 * noise(i));
      pts += `${(x + Math.cos(ang) * rr).toFixed(0)},${(y + Math.sin(ang) * rr * 0.75).toFixed(0)} `;
    }
    fx += `<polygon points="${pts}" fill="#FFE14D" stroke="#0A0A0B" stroke-width="8" opacity="${(1 - clamp((a - 0.2) / 0.15)).toFixed(2)}"/>`;
  }
  if (a >= 0 && a < 1.1) {
    for (let i = 0; i < 7; i++) {
      const dir = i < 3.5 ? -1 : 1, k = (i % 4) + 1;
      const x = BUTTON_TOP[0] + dir * (60 + a * 260 * k * 0.5), y = 1468 - a * 70 * (1 + (i % 3) * 0.4);
      const r = 18 + a * 60 + (i % 3) * 8;
      fx += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r.toFixed(0)}" fill="#cfc6b1" stroke="#0A0A0B" stroke-width="5" opacity="${(1 - a / 1.1).toFixed(2)}"/>`;
    }
  }
  const sm = t - AFTER;
  if (sm >= 0 && sm < 2.7) {
    const [hx, hy] = toStage(0.55, 0.42, st);
    for (let i = 0; i < 6; i++) {
      const life = (sm - i * 0.32);
      if (life < 0 || life > 1.6) continue;
      const x = hx + Math.sin(life * 3 + i) * 26 + (i % 2 ? 18 : -18), y = hy - 40 - life * 230;
      fx += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(22 + life * 46).toFixed(0)}" fill="#3a3a3f" opacity="${(0.75 * (1 - life / 1.6)).toFixed(2)}"/>`;
    }
  }
  $("fxsvg").innerHTML = fx;

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

const POSES = ["neutral", "slam-windup", "slam-impact", "zap-a", "zap-b", "zap-after"];
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
