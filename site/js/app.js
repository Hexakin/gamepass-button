import { newCode, normaliseCode, ukDate, codeDate } from "./rng.js";
import { buildSpin } from "./spin.js";
import { loadData, browserFetchJson } from "./data.js";
import { Show } from "./show.js";
import { schedule, renderWav } from "./audio.js";

const params = new URLSearchParams(location.search);
const RENDER = params.get("render");            // "916": 1080x1920, no UI, driven by __show.seek
const seedParam = normaliseCode(params.get("seed"));
const MUSIC_URL = "audio/bed.m4a";
const stage = document.getElementById("stage");
const $ = (id) => document.getElementById(id);

if (RENDER) document.body.classList.add("render", "hi");

function fit() {
  if (RENDER) { stage.style.transform = "none"; return; }
  const w = innerWidth, h = innerHeight;
  const s = Math.min(w / 1080, (h - 18) / 1920);
  const x = (w - 1080 * s) / 2, y = Math.max(0, (h - 18 - 1920 * s) / 2);
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
  spin = buildSpin(code, data);
  if (!show) show = new Show(stage, { hi: !!RENDER, clips: data.clips });
  show.setSpin(spin);
  return spin;
}

// ------------------------------------------------------------------ render mode (capture)
if (RENDER) {
  const ready = (async () => {
    if (!seedParam) throw new Error("render mode needs ?seed=CODE");
    await prepare(seedParam);
    await document.fonts.ready;
    await preload(show.assets(), { wait: true });
    show.draw(0);
    return true;
  })();
  window.__show = {
    ready,
    info: () => ({ code: spin.code, date: spin.date, catalogDate: spin.catalogDate, duration: spin.duration,
      tStop: spin.tStop, landing: spin.landing, reaction: spin.reaction, eligibleCount: spin.eligibleCount,
      result: { title: spin.result.title, productId: spin.result.id, storeUrl: spin.result.store, boxart: spin.result.boxart } }),
    seek: (t) => new Promise((res) => { show.draw(t); requestAnimationFrame(() => requestAnimationFrame(res)); }),
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

  try {
    await prepare(seedParam || newCode());
    idleLine = seedParam
      ? `Replay of spin ${code} (${codeDate(code)}). Same spin, same game. Watch closely.`
      : "Go on. Press it. I dare you. First spin counts.";
    if (seedParam) btn.querySelector("span").textContent = "REPLAY";
    preload(show.assets());
  } catch (e) {
    idleLine = "The catalogue won't load. Check your signal and refresh.";
    console.error(e);
  }

  const wall0 = performance.now();
  const idle = () => {
    if (playing) return;
    if (show) show.drawIdle((performance.now() - wall0) / 1000, idleLine);
    requestAnimationFrame(idle);
  };
  requestAnimationFrame(idle);

  const press = async () => {
    if (playing || !spin) return;
    // a page left open overnight: the spin belongs to the day it's pressed
    if (!seedParam && codeDate(code) !== ukDate()) await prepare(newCode());
    playing = true;
    $("result").hidden = true;
    let ctx = null, t0 = 0;
    const clock = () => (ctx ? ctx.currentTime - t0 : (performance.now() - t0) / 1000);
    if (settings.sound && (window.AudioContext || window.webkitAudioContext)) {
      try {
        if (navigator.audioSession) navigator.audioSession.type = "playback"; // iOS: play with the ringer switch on silent
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        await ctx.resume();
        let music = null;
        if (settings.music && musicBytes) music = await ctx.decodeAudioData(musicBytes.slice(0)).catch(() => null);
        t0 = ctx.currentTime + 0.08;
        schedule(ctx, spin, t0, music);
      } catch (e) { console.warn(e); ctx = null; }
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
    if (ctx) setTimeout(() => ctx.close(), 1500);
    const r = spin.result;
    $("store").href = r.store;
    $("store").textContent = `GET ${r.title.replace(/[®™©]/g, "").toUpperCase()} ON XBOX ↗`;
    $("played").href = `https://github.com/Hexakin/gamepass-button/issues/new?title=${encodeURIComponent(`played: ${code}`)}&body=${encodeURIComponent(`Marks ${r.title} as played (spin ${code}, ${spin.date}). Submit to confirm; a bot updates played.json and closes this.`)}`;
    $("resultnote").textContent = `Spin ${code} · ${spin.date} · catalogue ${spin.catalogDate} · ${spin.eligibleCount} eligible games. Replay: ?seed=${code}`;
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
