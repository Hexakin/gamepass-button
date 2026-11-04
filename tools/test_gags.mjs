// Checks the gag library without a browser:
//   node tools/test_gags.mjs
// - every gag builds when forced into a spin, and every pose it uses has a file
// - every bubble line fits (<= 90 characters) and no line asks viewers to do anything
// - spin lengths stay sensible over 400 random spins; prints how often each gag is drawn
// - two spins sharing opener + mishaps + reaction is rare
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadData } from "../site/js/data.js";
import { buildSpin } from "../site/js/spin.js";
import { CATALOGUE, GAGS_SINCE } from "../site/js/gags.js";
import { POSES } from "../site/js/puppet.js";
import { ALPHABET } from "../site/js/rng.js";
import { fsJson } from "./spin.mjs";

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
const enc = (n, len) => { let s = ""; for (let i = 0; i < len; i++) { s = ALPHABET[n & 31] + s; n = Math.floor(n / 32); } return s; };
const days = Math.round((Date.parse(GAGS_SINCE + "T00:00:00Z") - Date.UTC(2026, 0, 1)) / 86400000);
const code = (k) => `${enc(days, 3)}-${enc((k * 2654435761) >>> 7, 5)}`;
const data = await loadData(code(0), fsJson);
const fail = [];
const poseFile = (p) => path.join(SITE, POSES.includes(p) ? `avatar/chibi/${p}.webp` : `avatar/lib/${p}.webp`);
const ASKS = /\b(like|subscribe|comment|follow|share)\b.*\b(video|channel|below|me)\b/i;

function check(s, label) {
  for (const k of s.track) if (!existsSync(poseFile(k.pose))) fail.push(`${label}: no file for pose ${k.pose}`);
  for (const b of s.bubbles) {
    if (b.text.length > 90) fail.push(`${label}: line too long (${b.text.length}): ${b.text}`);
    if (ASKS.test(b.text)) fail.push(`${label}: line asks viewers to do something: ${b.text}`);
    if (/\{n\}/.test(b.text)) fail.push(`${label}: unfilled {n}: ${b.text}`);
  }
  if (s.duration > 42) fail.push(`${label}: ${s.duration.toFixed(1)} s long`);
  if (s.result.id !== buildSpin(s.code, data).result.id) fail.push(`${label}: forcing a gag changed the game`);
}

let forced = 0;
for (const [slot, list] of Object.entries(CATALOGUE)) {
  for (const g of list) {
    const f = slot === "genre" ? { reaction: g.id } : { [slot]: g.id };
    try {
      const s = buildSpin(code(1), data, { force: f });
      const got = slot === "bit" || slot === "mishap" ? s.gags[`${slot}s`].includes(g.id) : s.gags[slot === "genre" ? "reaction" : slot] === g.id;
      if (!got) fail.push(`${slot}:${g.id} was forced but not drawn`);
      check(s, `${slot}:${g.id}`);
      forced++;
    } catch (e) { fail.push(`${slot}:${g.id} threw ${e.message}`); }
  }
}

const N = 400, counts = {}, durs = [], sigs = new Map();
for (let k = 0; k < N; k++) {
  const s = buildSpin(code(k), data);
  check(s, s.code);
  durs.push(s.duration);
  const g = s.gags;
  for (const id of [g.opener, g.slowdown, g.reaction, g.outro, ...g.bits, ...g.mishaps]) counts[id] = (counts[id] || 0) + 1;
  const sig = [g.opener, ...[...g.mishaps].sort(), g.reaction].join("|");
  sigs.set(sig, (sigs.get(sig) || 0) + 1);
}
durs.sort((a, b) => a - b);
const pairs = [...sigs.values()].reduce((a, c) => a + c * (c - 1) / 2, 0);
console.log(`${forced} gags forced ok; ${N} random spins: ${durs[0].toFixed(1)}-${durs[N - 1].toFixed(1)} s (median ${durs[N >> 1].toFixed(1)} s)`);
console.log(`same opener+mishaps+reaction: ${(pairs / (N * (N - 1) / 2) * 100).toFixed(3)}% of spin pairs (1 in ${Math.round((N * (N - 1) / 2) / Math.max(1, pairs))})`);
const never = Object.values(CATALOGUE).flat().filter((g) => g.slot !== "genre" && !counts[g.id]).map((g) => g.id);
if (never.length) console.log(`never drawn in ${N} spins: ${never.join(", ")}`);
if (fail.length) { console.log(`FAIL (${fail.length}):\n  ${[...new Set(fail)].slice(0, 40).join("\n  ")}`); process.exit(1); }
console.log("ok");
