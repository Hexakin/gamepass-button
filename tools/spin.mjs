// Resolve a spin code to its game (same code as the site), from the local site/ data.
//   node tools/spin.mjs B2C-K7QXM [--json]
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { normaliseCode, newCode } from "../site/js/rng.js";
import { buildSpin } from "../site/js/spin.js";
import { loadData } from "../site/js/data.js";

const SITE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site");
export const fsJson = async (p) => JSON.parse(await readFile(path.join(SITE, p), "utf8"));

export async function resolve(code) {
  const c = normaliseCode(code);
  if (!c) throw new Error(`not a spin code: ${code}`);
  const data = await loadData(c, fsJson);
  return buildSpin(c, data);
}

// --find: spin codes (dated --date, default tomorrow-or-later gag dates) whose gags match, e.g.
//   node tools/spin.mjs --find mishap=anvil,opener=poke [--date 2026-11-05] [--n 3]
//   keys: opener, bit, mishap, slowdown, reaction, outro, genre (a store genre of the game),
//   mood (win|lose|shock), title (substring). Codes are deterministic candidates, so the same
//   query gives the same codes.
async function find(query, date, want) {
  const { ALPHABET } = await import("../site/js/rng.js");
  const enc = (n, len) => { let s = ""; for (let i = 0; i < len; i++) { s = ALPHABET[n & 31] + s; n = Math.floor(n / 32); } return s; };
  const days = Math.round((Date.parse(date + "T00:00:00Z") - Date.UTC(2026, 0, 1)) / 86400000);
  const conds = query.split(",").filter(Boolean).map((q) => q.split("="));
  const data = await loadData(`${enc(days, 3)}-00000`, fsJson);
  const out = [];
  for (let k = 0; k < 20000 && out.length < want; k++) {
    const code = `${enc(days, 3)}-${enc((k * 2654435761) >>> 7, 5)}`;
    const s = buildSpin(code, data);
    if (!s.gags) throw new Error(`${date} is before the gag library (see GAGS_SINCE)`);
    const g = s.gags, gen = (data.genres || {})[s.result.id] || [];
    const ok = conds.every(([k2, v]) => (k2 === "bit" || k2 === "mishap") ? g[`${k2}s`].includes(v)
      : k2 === "genre" ? gen.includes(v) : k2 === "mood" ? s.reaction.mood === v
      : k2 === "title" ? s.result.title.toLowerCase().includes(v.toLowerCase()) : g[k2] === v);
    if (ok) out.push({ code, title: s.result.title, gags: g, duration: +s.duration.toFixed(1) });
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes("--find")) {
  const a = process.argv.slice(2), at = (f, d) => (a.includes(f) ? a[a.indexOf(f) + 1] : d);
  const res = await find(at("--find", ""), at("--date", "2026-11-05"), +at("--n", 5));
  for (const r of res) console.log(r.code, r.duration + "s", "|", r.title, "|", JSON.stringify(r.gags));
  if (!res.length) console.log("no match in 20000 candidates");
  process.exit(0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--")) || newCode();
  const s = await resolve(arg);
  const out = { code: s.code, date: s.date, catalogDate: s.catalogDate, eligible: s.eligibleCount,
    result: { title: s.result.title, productId: s.result.id, storeUrl: s.result.store, boxart: s.result.boxart },
    duration: +s.duration.toFixed(2), tStop: +s.tStop.toFixed(2), reaction: s.reaction.pose,
    fakeouts: s.fx.filter((f) => ["fakeland", "glitch"].includes(f.type)).map((f) => f.type), gags: s.gags };
  console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
}
