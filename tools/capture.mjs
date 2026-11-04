// Render a spin to video, frame by frame, exactly as the site plays it.
//
//   node tools/capture.mjs <SPIN-CODE> [--out DIR] [--landing-only] [--cut] [--fps 30]
//   node tools/capture.mjs X --page lab/ --out DIR   a test page (full.mp4 only)
//   node tools/capture.mjs <CODE> --gag mishap:anvil --out DIR   a gag preview (not a real spin)
//   ... --from S --to S                              only that window (full.mp4 of it)
//   node tools/capture.mjs --played     every spin in site/data/played.json (marked from the
//                                       phone) that has no spin folder yet (git pull first)
//
// Writes to ~/Videos/quick-takes/gamepass-button/spins/<YYYY-MM-DD>-<CODE>/ (or --out):
//   full.mp4      the whole theatrical spin, 1080x1920, with the show's own audio
//   landing.mp4   ~1.6 s: the slam stop, box art, Hexakin's reaction, "TONIGHT: <GAME>"
//   landing.png   a still from the landing (thumbnail / hook frame)
//   cut.mp4       (--cut) ~11 s short version: the slam (0 .. 2.7 s), a 2-frame white flash, then
//                 tStop - 5.5 s .. the end of Hexakin's reaction (tStop + 3.0 s)
//   spin.json     {code, date, result {title, productId, storeUrl, boxart}, catalogDate, ...}
//
// Needs: node 18+, `npm install` (playwright + its Chromium: `npx playwright install chromium`),
// ffmpeg on PATH. Serves site/ itself on a free local port; no network needed except box art.
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SITE = path.join(ROOT, "site");
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".m4a": "audio/mp4" };

function args() {
  const a = process.argv.slice(2), o = { fps: 30 };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--out") o.out = a[++i];
    else if (a[i] === "--fps") o.fps = +a[++i];
    else if (a[i] === "--landing-only") o.landingOnly = true;
    else if (a[i] === "--cut") o.cut = true;
    else if (a[i] === "--played") o.played = true;
    else if (a[i] === "--page") o.page = a[++i];
    else if (a[i] === "--gag") o.gag = a[++i];
    else if (a[i] === "--from") o.from = +a[++i];
    else if (a[i] === "--to") o.to = +a[++i];
    else o.code = a[i];
  }
  if (!o.code && !o.played) { console.error("usage: node tools/capture.mjs <SPIN-CODE> [--out DIR] [--landing-only]"); process.exit(2); }
  return o;
}

function serve() {
  const srv = createServer(async (req, res) => {
    const u = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const f = path.join(SITE, u.endsWith("/") ? u + "index.html" : u);
    if (!f.startsWith(SITE)) { res.writeHead(403).end(); return; }
    try {
      const body = await readFile(f);
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" }).end(body);
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((r) => srv.listen(0, "127.0.0.1", () => r(srv)));
}

function ffmpeg(argv, stdin = false) {
  const p = spawn("ffmpeg", ["-v", "error", "-y", ...argv], { stdio: [stdin ? "pipe" : "ignore", "inherit", "inherit"] });
  const done = new Promise((res, rej) => p.on("close", (c) => (c ? rej(new Error(`ffmpeg exited ${c}`)) : res())));
  return { p, done };
}

const SPINS = path.join(homedir(), "Videos/quick-takes/gamepass-button/spins");

async function main() {
  const o = args();
  if (o.played) {
    const { existsSync } = await import("node:fs");
    const doc = JSON.parse(await readFile(path.join(SITE, "data/played.json"), "utf8"));
    const todo = (doc.games || doc).filter((g) => g.code && !existsSync(path.join(SPINS, `${g.since}-${g.code}`)));
    if (!todo.length) { console.log("every played spin is captured already"); return; }
    for (const g of todo) await capture({ ...o, code: g.code });
    return;
  }
  await capture(o);
}

async function capture(o) {
  const srv = await serve();
  const port = srv.address().port;
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.error("page error:", e.message));
    await page.goto(`http://127.0.0.1:${port}/${o.page || ""}?seed=${encodeURIComponent(o.code)}&render=916${o.gag ? `&gag=${encodeURIComponent(o.gag)}` : ""}`);
    await page.waitForFunction(() => window.__show, null, { timeout: 30000 });
    await page.evaluate(() => window.__show.ready);
    const info = await page.evaluate(() => window.__show.info());
    if (o.gag && !o.out) throw new Error("--gag previews need --out (they are not real spins)");
    const outDir = o.out || path.join(SPINS, `${info.date}-${info.code}`);
    await mkdir(outDir, { recursive: true });
    console.log(`spin ${info.code} (${info.date}): ${info.result ? info.result.title : "(test page)"}  ->  ${outDir}`);

    // the soundtrack, rendered offline by the page's own audio code
    const wav = Buffer.from(await page.evaluate(() => window.__show.audioWav()), "base64");
    const wavPath = path.join(outDir, "audio.wav");
    await writeFile(wavPath, wav);

    const cdp = await page.context().newCDPSession(page);
    const grab = async (t) => {
      await page.evaluate((x) => window.__show.seek(x), t);
      const { data } = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 93, optimizeForSpeed: true });
      return Buffer.from(data, "base64");
    };
    const encode = async (file, t0, t1) => {
      const n = Math.round((t1 - t0) * o.fps);
      const ff = ffmpeg(["-f", "image2pipe", "-framerate", String(o.fps), "-i", "-",
        "-ss", String(t0), "-t", String(n / o.fps), "-i", wavPath,
        "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
        "-r", String(o.fps), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-shortest", file], true);
      const t = Date.now();
      for (let i = 0; i < n; i++) {
        const buf = await grab(t0 + i / o.fps);
        if (!ff.p.stdin.write(buf)) await new Promise((r) => ff.p.stdin.once("drain", r));
        if (i % 60 === 0) process.stdout.write(`\r  ${path.basename(file)} ${i}/${n} frames`);
      }
      ff.p.stdin.end();
      await ff.done;
      console.log(`\r  ${path.basename(file)} ${n} frames in ${((Date.now() - t) / 1000).toFixed(0)} s`);
    };

    const [l0, l1] = info.landing;
    if (!o.landingOnly) await encode(path.join(outDir, "full.mp4"), o.from || 0, Math.min(o.to || info.duration, info.duration));
    if (!info.result || o.from || o.to) { console.log(`done: ${outDir}`); return; }   // a test page / a window: just the video
    await encode(path.join(outDir, "landing.mp4"), l0, l1);
    await writeFile(path.join(outDir, "landing.png"), await (async () => {
      await page.evaluate((x) => window.__show.seek(x), info.tStop + 1.1);
      return page.screenshot({ type: "png" });
    })());

    // the short version: slam, white flash, the last stretch to the end of the reaction
    const CUT_A = [0, 2.7], CUT_B = [Math.max(CUT_A[1], info.tStop - 5.5), info.tStop + 3.0];
    if (o.cut) {
      const a = path.join(outDir, ".cut-a.mp4"), b = path.join(outDir, ".cut-b.mp4");
      await encode(a, ...CUT_A);
      await encode(b, ...CUT_B);
      const fl = (2 / o.fps).toFixed(4), aEnd = (CUT_A[1] - CUT_A[0] - 0.04).toFixed(3);
      const ff = ffmpeg(["-i", a, "-i", b, "-filter_complex",
        `[1:v]fade=t=in:st=0:d=${fl}:color=white[bv];` +
        `[0:a]afade=t=out:st=${aEnd}:d=0.04[aa];[1:a]afade=t=in:st=0:d=0.04[ba];` +
        `[0:v][aa][bv][ba]concat=n=2:v=1:a=1[v][o]`,
        "-map", "[v]", "-map", "[o]", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p",
        "-r", String(o.fps), "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", path.join(outDir, "cut.mp4")]);
      await ff.done;
      await rm(a); await rm(b);
      console.log(`  cut.mp4 ${(CUT_A[1] - CUT_A[0] + CUT_B[1] - CUT_B[0]).toFixed(1)} s`);
    }

    const spinJson = {
      code: info.code, date: info.date, catalogDate: info.catalogDate,
      result: info.result, eligibleCount: info.eligibleCount, reaction: info.reaction.pose,
      duration: +info.duration.toFixed(3), tStop: +info.tStop.toFixed(3),
      landing: [+l0.toFixed(3), +l1.toFixed(3)],
      cut: o.cut ? [CUT_A.map((x) => +x.toFixed(3)), CUT_B.map((x) => +x.toFixed(3))] : null,
      files: { full: o.landingOnly ? null : "full.mp4", landing: "landing.mp4", still: "landing.png", audio: "audio.wav",
        cut: o.cut ? "cut.mp4" : null },
      replay: `?seed=${info.code}`,
    };
    await writeFile(path.join(outDir, "spin.json"), JSON.stringify(spinJson, null, 1));
    console.log(`done: ${outDir}`);
  } finally {
    await browser.close();
    srv.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
