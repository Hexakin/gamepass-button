"""Fetch the UK console Game Pass list (stdlib only; run daily by the GitHub Action).

    python3 tools/fetch_gamepass.py [--date YYYY-MM-DD]

Writes, under site/data/:
  gamepass.json           the current list, readable (title, publisher, box art, store link)
  index.json              every game ever seen: {id: [title, boxart, hero]} (only grows)
  archive/<date>.json     that day's list, as ordered product ids
  archive/dates.json      every archived date, sorted

Spins pick from the archive of the latest date BEFORE the spin's date, so a spin code replays
against exactly the catalogue it was spun on.

These are public but unofficial, undocumented Microsoft endpoints. If a fetch fails or looks
wrong (too few games), nothing is written and the script still exits 0: the site keeps the
last good copy.
"""
import argparse
import json
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

SIGL = ("https://catalog.gamepass.com/sigls/v2?id=f6f1f99f-9b49-4ccd-b3bf-4d9767a77f5e"
        "&language=en-gb&market=GB")
DETAILS = ("https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds={ids}"
           "&market=GB&languages=en-gb")
BATCH = 20
MIN_GAMES = 200          # a sane catalogue has 400-700; fewer means the endpoint changed
UA = {"User-Agent": "gamepass-button/1.0 (+https://github.com/Hexakin/gamepass-button)"}
DATA = Path(__file__).resolve().parents[1] / "site" / "data"


def get(url: str, tries: int = 3):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            if i == tries - 1:
                raise
            print(f"retry {url[:80]}: {e}", file=sys.stderr)
            time.sleep(2 * (i + 1))
    raise RuntimeError("unreachable")


def image(props: dict, *purposes: str):
    imgs = props.get("Images") or []
    for p in purposes:
        cands = [i for i in imgs if i.get("ImagePurpose") == p and i.get("Uri")]
        if cands:
            best = max(cands, key=lambda i: (i.get("Width") or 0) * (i.get("Height") or 0))
            uri = best["Uri"]
            return ("https:" + uri) if uri.startswith("//") else uri
    return None


def fetch() -> list[dict]:
    sigl = get(SIGL) or []
    ids = [x["id"] for x in sigl if "id" in x]
    games = []
    for i in range(0, len(ids), BATCH):
        data = get(DETAILS.format(ids=",".join(ids[i:i + BATCH]))) or {}
        for p in data.get("Products", []):
            loc = (p.get("LocalizedProperties") or [{}])[0]
            title = (loc.get("ProductTitle") or "").strip()
            if not title:
                continue
            pid = p.get("ProductId")
            games.append({
                "id": pid,
                "title": title,
                "publisher": loc.get("PublisherName") or "",
                "boxart": image(loc, "Poster", "BoxArt"),
                "hero": image(loc, "SuperHeroArt", "TitledHeroArt", "BrandedKeyArt"),
                "store": f"https://www.xbox.com/en-GB/games/store/p/{pid}",
            })
        time.sleep(0.3)
    order = {pid: n for n, pid in enumerate(ids)}
    games.sort(key=lambda g: order.get(g["id"], 1e9))
    return games


def write(games: list[dict], date: str) -> None:
    (DATA / "archive").mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds")
    (DATA / "gamepass.json").write_text(json.dumps(
        {"fetched": now, "market": "GB", "list": "All Console Games", "count": len(games),
         "games": games}, ensure_ascii=False, indent=0))
    idx_path = DATA / "index.json"
    idx = json.loads(idx_path.read_text()) if idx_path.exists() else {}
    for g in games:
        idx[g["id"]] = [g["title"], g["boxart"], g["hero"]]
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, separators=(",", ":")))
    (DATA / "archive" / f"{date}.json").write_text(json.dumps([g["id"] for g in games]))
    dates = sorted(p.stem for p in (DATA / "archive").glob("????-??-??.json"))
    (DATA / "archive" / "dates.json").write_text(json.dumps(dates))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", default=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    date = ap.parse_args().date
    if (DATA / "archive" / f"{date}.json").exists():
        print(f"archive for {date} exists already; not overwriting (replays depend on it)")
        return 0
    try:
        games = fetch()
        if len(games) < MIN_GAMES:
            raise RuntimeError(f"only {len(games)} games came back; endpoint may have changed")
    except Exception as e:  # noqa: BLE001
        print(f"WARNING: fetch failed, keeping the last good copy: {e}", file=sys.stderr)
        return 0
    write(games, date)
    print(f"wrote {len(games)} games for {date}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
