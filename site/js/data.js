// Loads the catalogue for a spin's date (browser and Node: pass a fetchJson).
import { codeDate } from "./rng.js";
import { catalogueDateFor } from "./spin.js";

export async function loadData(code, fetchJson) {
  const date = codeDate(code);
  const [dates, index, played] = await Promise.all([
    fetchJson("data/archive/dates.json"),
    fetchJson("data/index.json"),
    fetchJson("data/played.json").catch(() => []),
  ]);
  const catalogDate = catalogueDateFor(date, dates);
  const ids = await fetchJson(`data/archive/${catalogDate}.json`);
  const catalogue = ids.filter((id) => index[id]).map((id) => {
    const [title, boxart, hero] = index[id];
    return { id, title, boxart, hero, store: `https://www.xbox.com/en-GB/games/store/p/${id}` };
  });
  // store genres per game id (site/data/genres.json); kept apart from the catalogue objects so
  // older spins' timelines stay byte-identical
  const genres = await fetchJson("data/genres.json").catch(() => ({}));
  // pose metadata (head positions, boxes, sign text areas) for the gag builder
  const lib = await fetchJson("avatar/lib.json").catch(() => ({}));
  return { date, catalogDate, catalogue, played: played.games || played, dates, genres, lib };
}

export const browserFetchJson = (path) => fetch(path, { cache: "no-cache" }).then((r) => {
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
});
