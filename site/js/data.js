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
  return { date, catalogDate, catalogue, played: played.games || played, dates };
}

export const browserFetchJson = (path) => fetch(path, { cache: "no-cache" }).then((r) => {
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
});
