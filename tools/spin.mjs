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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const arg = process.argv.slice(2).find((a) => !a.startsWith("--")) || newCode();
  const s = await resolve(arg);
  const out = { code: s.code, date: s.date, catalogDate: s.catalogDate, eligible: s.eligibleCount,
    result: { title: s.result.title, productId: s.result.id, storeUrl: s.result.store, boxart: s.result.boxart },
    duration: +s.duration.toFixed(2), tStop: +s.tStop.toFixed(2), reaction: s.reaction.clip,
    fakeouts: s.fx.filter((f) => ["fakeland", "glitch"].includes(f.type)).map((f) => f.type) };
  console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
}
