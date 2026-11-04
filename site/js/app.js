import { newCode, normaliseCode, ukDate, codeDate } from "./rng.js";
import { buildSpin } from "./spin.js";
import { GAGS_SINCE } from "./gags.js";
import { loadData, browserFetchJson } from "./data.js";
import { Show } from "./show.js";
import { schedule, renderWav } from "./audio.js";

const params = new URLSearchParams(location.search);
const RENDER = params.get("render");            // "916": 1080x1920, no UI, driven by __show.seek
const seedParam = normaliseCode(params.get("seed"));
// ?gag=slot:id (from gags.html): preview a spin with that gag forced in (not a real spin)
const gagParam = params.get("gag");
const force = gagParam ? Object.fromEntries([gagParam.split(":")]) : undefined;
const MUSIC_URL = "audio/bed.m4a";
const stage = document.getElementById("stage");
const $ = (id) => document.getElementById(id);

if (RENDER) document.body.classList.add("render", "hi");

function fit() {
  if (RENDER) { stage.style.transform = "none"; return; }
  // room above the stage for the sound toggles, below it for the footer
  const TOP = 38, BOTTOM = 34;
  const w = innerWidth, h = innerHeight;
  const s = Math.min(w / 1080, (h - TOP - BOTTOM) / 1920);
  const x = (w - 1080 * s) / 2, y = TOP + Math.max(0, (h - TOP - BOTTOM - 1920 * s) / 2);
  stage.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
}
addEventListener("resize", fit);
fit();

const settings = {
  sound: localStorage.getItem("gpb.sound") !== "off",
  music: localStorage.getItem("gpb.music") !== "off",
};

function preload(urls, { wait = false } = {}) {
  const loads = urls.map((u) => new Promise((res) => {
    const img = new Image();
    img.onload = () => (img.decode ? img.decode().catch(() => {}) : Promise.resolve()).then(res);
    img.onerror = res;
    img.src = u;
  }));
  return wait ? Promise.all(loads) : Promise.resolve();
}

let show, spin, data, code;
let playing = false;

async function prepare(c) {
  code = c;
  data = await loadData(code, browserFetchJson);
  spin = buildSpin(code, data, { force });
  if (!show) show = new Show(stage, { hi: !!RENDER });
  show.setSpin(spin);
  return spin;
}

// A new spin: generate a few candidate codes and keep the one whose gags overlap least with the
// last few spins on this device (localStorage). Every code is still a real, replayable spin;
// this only chooses which one you get, so presses in a row don't repeat the same gags.
const RECENT = "gpb.recentGags";
const features = (s) => s.gags ? [`o:${s.gags.opener}`, ...s.gags.mishaps.map((m) => `m:${m}`), `r:${s.gags.reaction}`,
  `s:${s.gags.slowdown}`, `u:${s.gags.outro}`, ...s.gags.bits.map((b) => `b:${b}`)] : [];
const WEIGHT = { o: 1, m: 3, r: 2, s: 1, u: 0.5, b: 0.5 };
async function freshCode() {
  const first = newCode();
  if (codeDate(first) < GAGS_SINCE) return first;
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch { /* */ }
  const seen = new Set(recent.flat());
  const d = await loadData(first, browserFetchJson);
  let best = null;
  for (let i = 0; i < 8; i++) {
    const c = i ? newCode() : first;
    const score = features(buildSpin(c, d)).reduce((a, f) => a + (seen.has(f) ? WEIGHT[f[0]] : 0), 0);
    if (!best || score < best.score) best = { c, score };
  }
  return best.c;
}
function remember(s) {
  if (!s.gags || gagParam) return;
  let recent = [];
  try { recent = JSON.parse(localStorage.getItem(RECENT) || "[]"); } catch { /* */ }
  recent.push(features(s));
  localStorage.setItem(RECENT, JSON.stringify(recent.slice(-4)));
}

// ------------------------------------------------------------------ render mode (capture)
if (RENDER) {
  const ready = (async () => {
    if (!seedParam) throw new Error("render mode needs ?seed=CODE");
    await prepare(seedParam);
    await document.fonts.ready;
    await Promise.all([preload(show.assets(), { wait: true }), show.loadPoses()]);
    document.querySelector("#bigbutton span").textContent = "PRESS";
    show.draw(0);
    return true;
  })();
  window.__show = {
    ready,
    info: () => ({ code: spin.code, date: spin.date, catalogDate: spin.catalogDate, duration: spin.duration,
      tStop: spin.tStop, landing: spin.landing, reaction: spin.reaction, eligibleCount: spin.eligibleCount, gags: spin.gags,
      result: { title: spin.result.title, productId: spin.result.id, storeUrl: spin.result.store, boxart: spin.result.boxart } }),
    seek: async (t) => {
      await show.drawExact(t);
      await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    },
    audioWav: async () => {
      const bytes = await renderWav(spin, MUSIC_URL);
      let s = ""; const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      return btoa(s);
    },
  };
} else {
  live();
}

// ------------------------------------------------------------------ live mode (the phone)
async function live() {
  const btn = $("bigbutton");
  let idleLine = "Loading the drum…";
  let musicBytes = null;
  fetch(MUSIC_URL).then((r) => r.arrayBuffer()).then((b) => { musicBytes = b; }).catch(() => {});

  const setToggles = () => {
    $("mute").textContent = `SOUND: ${settings.sound ? "ON" : "OFF"}`;
    $("music").textContent = `MUSIC: ${settings.music ? "ON" : "OFF"}`;
  };
  setToggles();
  $("mute").onclick = () => { settings.sound = !settings.sound; localStorage.setItem("gpb.sound", settings.sound ? "on" : "off"); setToggles(); };
  $("music").onclick = () => { settings.music = !settings.music; localStorage.setItem("gpb.music", settings.music ? "on" : "off"); setToggles(); };
  $("howbtn").onclick = () => $("how").showModal();

  const wall0 = performance.now();
  const idle = () => {
    if (playing) return;
    if (show) show.drawIdle((performance.now() - wall0) / 1000, idleLine);
    requestAnimationFrame(idle);
  };

  try {
    await prepare(seedParam || await freshCode());
    requestAnimationFrame(idle);
    idleLine = seedParam
      ? `Replay of spin ${code} (${codeDate(code)}). Same spin, same game. Watch closely.`
      : "Go on. Press it. I dare you. First spin counts.";
    // everything this spin shows is loaded and decoded before the button works ("…" until then)
    const label = btn.querySelector("span"), was = seedParam ? "REPLAY" : "PRESS";
    label.textContent = "…";
    const say = idleLine;
    idleLine = "Hang on. Loading the drum. Don't touch anything.";
    await Promise.all([preload(show.assets(), { wait: true }), show.loadPoses()]);
    label.textContent = was;
    idleLine = say;
  } catch (e) {
    idleLine = "The catalogue won't load. Check your signal and refresh.";
    console.error(e);
    if (!show) requestAnimationFrame(idle);
  }


  const press = async () => {
    if (playing || !spin || btn.querySelector("span").textContent === "…") return;
    playing = true;
    stage.classList.remove("parked");
    // iOS only unlocks audio inside the tap itself: make the context before any await
    let ctx = null, t0 = 0;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (settings.sound && AC) {
      try {
        if (navigator.audioSession) navigator.audioSession.type = "playback"; // iOS: sound even on silent
        ctx = new AC();
        ctx.resume();
      } catch (e) { console.warn(e); ctx = null; }
    }
    // a page left open overnight: the spin belongs to the day it's pressed
    if (!seedParam && codeDate(code) !== ukDate()) await prepare(await freshCode());
    remember(spin);
    $("result").hidden = true;
    const clock = () => (ctx ? ctx.currentTime - t0 : (performance.now() - t0) / 1000);
    if (ctx) {
      try {
        await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 500))]);
        // audio blocked (e.g. a browser policy)? run the show on the wall clock, silently
        if (ctx.state !== "running") throw new Error(`audio ${ctx.state}`);
        let music = null;
        if (settings.music && musicBytes) music = await ctx.decodeAudioData(musicBytes.slice(0)).catch(() => null);
        t0 = ctx.currentTime + 0.08;
        schedule(ctx, spin, t0, music);
      } catch (e) { console.warn(e); try { ctx.close(); } catch { /* */ } ctx = null; }
    }
    if (!ctx) t0 = performance.now();
    history.replaceState(null, "", `?seed=${code}`);
    const frame = () => {
      const t = clock();
      show.draw(Math.max(0, t));
      if (t < spin.duration) requestAnimationFrame(frame);
      else finish(ctx);
    };
    requestAnimationFrame(frame);
  };
  btn.addEventListener("click", press);
  btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") press(); });

  function finish(ctx) {
    playing = false;
    stage.classList.add("parked");   // Hexakin steps up and aside so the result panel doesn't cover him
    if (ctx) setTimeout(() => ctx.close(), 1500);
    const r = spin.result;
    $("store").href = r.store;
    $("store").textContent = "GET IT ON XBOX ↗";   // the title is on the banner above
    $("played").href = `https://github.com/Hexakin/gamepass-button/issues/new?title=${encodeURIComponent(`played: ${code}`)}&body=${encodeURIComponent(`Marks ${r.title} as played (spin ${code}, ${spin.date}). Submit to confirm; a bot updates played.json and closes this.`)}`;
    $("resultnote").textContent = gagParam ? `Gag preview (${gagParam}) on spin ${code}: not a real spin`
      : `Spin ${code} · ${spin.date} · drawn from ${spin.eligibleCount} games`;
    $("played").hidden = !!gagParam;
    $("result").hidden = false;
  }

  $("replay").onclick = () => { $("result").hidden = true; press(); };
  $("again").onclick = () => { location.href = location.pathname; };
  $("copy").onclick = async () => {
    const url = `${location.origin}${location.pathname}?seed=${code}`;
    try {
      if (navigator.share) await navigator.share({ title: "Tonight's Game Pass game", text: `The button picked ${spin.result.title}. Spin ${code}`, url });
      else { await navigator.clipboard.writeText(url); $("copy").textContent = "COPIED"; }
    } catch { /* cancelled */ }
  };
}
