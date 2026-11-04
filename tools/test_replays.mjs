// Replay guard: spins that already exist must never change.
//   node tools/test_replays.mjs           check every code in tests/replays.json
//   node tools/test_replays.mjs --write   (re)write the snapshot (only when you MEAN to)
// For each code it hashes the whole resolved timeline (game, reel, puppet track, bubbles, fx,
// sfx). Codes: every played spin, the test codes, and 40 fixed codes per day from 1 Nov 2026.
// Re-write the snapshot only for days no real spin can have reached yet (content that has not
// shipped); a shipped gag is never edited in place (see site/js/gags.js).
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolve, fsJson } from "./spin.mjs";
import { ALPHABET } from "../site/js/rng.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "tests", "replays.json");
const hash = (s) => createHash("sha256").update(JSON.stringify(s)).digest("hex").slice(0, 16);
const enc = (n, len) => { let s = ""; for (let i = 0; i < len; i++) { s = ALPHABET[n & 31] + s; n = Math.floor(n / 32); } return s; };

async function codes() {
  const played = await fsJson("data/played.json");
  const out = new Set(["09J-654Q4", "09J-WBSQC", "09J-QAH21", "09J-HW1E0", "09J-8ZP37", "09J-AA1JY", "09G-6P4KK"]);
  for (const g of played.games || played) if (g.code) out.add(g.code);
  // 2026-11-01 .. 2026-11-04 (the original builder) and 2026-11-05 .. 07 (the gag library, v2)
  for (let day = 304; day <= 310; day++)
    for (let k = 0; k < 40; k++) out.add(`${enc(day, 3)}-${enc((k * 2654435761) >>> 7, 5)}`);
  return [...out];
}

if (process.argv.includes("--write")) {
  const snap = {};
  for (const c of await codes()) snap[c] = hash(await resolve(c));
  await writeFile(FIX, JSON.stringify(snap, null, 1) + "\n");
  console.log(`wrote ${Object.keys(snap).length} codes to ${FIX}`);
} else {
  const snap = JSON.parse(await readFile(FIX, "utf8"));
  let bad = 0;
  for (const [c, h] of Object.entries(snap)) {
    const now = hash(await resolve(c));
    if (now !== h) { bad++; console.log(`CHANGED ${c}`); }
  }
  console.log(bad ? `FAIL: ${bad} of ${Object.keys(snap).length} replays changed` : `ok: ${Object.keys(snap).length} replays unchanged`);
  process.exit(bad ? 1 : 0);
}
