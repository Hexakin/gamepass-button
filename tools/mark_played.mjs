// Add a spin's game to site/data/played.json (it won't be picked by spins dated after the spin).
//   node tools/mark_played.mjs <SPIN-CODE>
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "./spin.mjs";

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "site", "data", "played.json");

const code = process.argv[2];
const s = await resolve(code);
const doc = JSON.parse(await readFile(FILE, "utf8"));
const games = doc.games || doc;
if (games.some((g) => g.id === s.result.id)) {
  console.log(`${s.result.title} is already on the played list.`);
} else {
  games.push({ title: s.result.title, id: s.result.id, since: s.date, code: s.code });
  await writeFile(FILE, JSON.stringify(doc, null, 2) + "\n");
  console.log(`Marked as played: ${s.result.title} (spin ${s.code}, ${s.date}). Spins after ${s.date} won't pick it.`);
}
