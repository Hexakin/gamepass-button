// Hexakin as a cut-out cartoon: hand-posed 3D stills (avatar/key/<pose>.webp) animated in 2D,
// pose to pose: snappy moves with overshoot, squash and stretch, smears and speed lines,
// impact frames, screen shake, trembling holds, electrocution flicker.
//
// A track is a list of keys, each the START of a move into a new pose:
//   {t, pose, dur, ease, x, y, rot, sx, sy, smear:[dx,dy], lines, wobble, jitter, zap}
//   t: when the move starts; dur: how long it takes (the pose swaps halfway, behind the smear)
//   x, y (px), rot (deg), sx, sy: where the move ends (feet-anchored); omitted = unchanged
//   ease: "snap" (fast, overshoots) | "back" | "out" | "lin"; wobble: squash wobble on arrival
//   jitter: px of trembling during the hold that follows; zap: electrocution flicker hold
// Everything is a pure function of t (render mode steps it frame by frame).

export const KEY_W = 900, KEY_H = 1200;   // key pose renders (fixed camera, feet at FEET)
export const FEET = [0.5203, 0.9085];

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const EASE = {
  lin: (u) => u,
  out: (u) => 1 - (1 - u) ** 3,
  back: (u) => { const c = 1.7; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; },
  snap: (u) => { const c = 2.6; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; },
};
// deterministic noise in [-1, 1]
export const noise = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; };

export class Puppet {
  // root: element positioned on the stage; scale: stage px per render px; feetAt: [x, y] stage px
  constructor(root, { scale = 0.8, feetAt = [330, 1490], base = "avatar/key/" } = {}) {
    this.root = root; this.scale = scale; this.feetAt = feetAt; this.base = base;
    this.imgs = {}; this.ghosts = [];
    root.classList.add("puppet");
    const W = KEY_W * scale, H = KEY_H * scale;
    Object.assign(root.style, { width: `${W}px`, height: `${H}px`,
      left: `${feetAt[0] - FEET[0] * W}px`, top: `${feetAt[1] - FEET[1] * H}px`,
      transformOrigin: `${FEET[0] * 100}% ${FEET[1] * 100}%` });
    this.body = document.createElement("div");
    this.body.className = "pbody";
    root.appendChild(this.body);
    for (let i = 0; i < 3; i++) {
      const g = document.createElement("img");
      g.className = "ghost"; g.alt = "";
      root.insertBefore(g, this.body);
      this.ghosts.push(g);
    }
    this.lines = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.lines.setAttribute("viewBox", `0 0 ${KEY_W} ${KEY_H}`);
    this.lines.classList.add("plines");
    root.appendChild(this.lines);
  }

  // load + decode every pose before anything plays (no blank frames on a swap)
  async load(poses) {
    await Promise.all(poses.map((p) => {
      if (this.imgs[p]) return null;
      const img = document.createElement("img");
      img.alt = ""; img.className = "pose"; img.decoding = "sync";
      img.src = `${this.base}${p}.webp`;
      this.body.appendChild(img);
      this.imgs[p] = img;
      return img.decode().catch(() => new Promise((r) => { img.onload = r; img.onerror = r; }));
    }));
  }

  // the puppet's state at time t
  state(track, t) {
    let i = 0;
    while (i + 1 < track.length && track[i + 1].t <= t) i++;
    const k = track[i];
    const prev = resolved(track, i - 1);
    const cur = resolved(track, i);
    const u = clamp((t - k.t) / Math.max(1e-3, k.dur || 0));
    const e = (EASE[k.ease || "snap"])(u);
    const lerp = (a, b) => a + (b - a) * e;
    const s = { pose: (k.dur && u < 0.5 && prev) ? prev.pose : k.pose,
      x: lerp(prev ? prev.x : cur.x, cur.x), y: lerp(prev ? prev.y : cur.y, cur.y),
      rot: lerp(prev ? prev.rot : cur.rot, cur.rot), sx: lerp(prev ? prev.sx : cur.sx, cur.sx),
      sy: lerp(prev ? prev.sy : cur.sy, cur.sy), moving: k.dur && u < 1, u, key: k, idx: i };
    // squash and stretch: stretch along the move while it happens, squash on arrival, wobble out
    if (s.moving && k.smear) {
      const st = Math.sin(Math.PI * u) * 0.16;
      const vertical = Math.abs(k.smear[1]) >= Math.abs(k.smear[0]);
      if (vertical) { s.sy *= 1 + st; s.sx *= 1 - st * 0.6; } else { s.sx *= 1 + st; s.sy *= 1 - st * 0.6; }
    }
    const arrive = t - (k.t + (k.dur || 0));
    if (arrive >= 0 && k.wobble) {
      const w = k.wobble * Math.exp(-arrive * 7) * Math.cos(arrive * 34);
      s.sy *= 1 - w; s.sx *= 1 + w * 0.7;
    }
    // trembling hold: constant fine jitter plus a quick shake burst every ~0.7 s
    if (arrive >= 0 && k.jitter) {
      const f = Math.floor(t * 30);
      const burst = (arrive % 0.7) < 0.12 ? 2.4 : 1;
      s.x += noise(f) * k.jitter * burst; s.y += noise(f + 91) * k.jitter * 0.6 * burst;
      s.rot += noise(f + 17) * k.jitter * 0.12 * burst;
    }
    // electrocution: two poses flickering, inverted "x-ray" frames, violent jitter
    if (arrive >= 0 && k.zap) {
      const f = Math.floor(t * 30);
      const step = Math.floor(f / 2);
      s.pose = step % 2 ? k.zap[1] : k.zap[0];
      s.xray = step % 3 === 1;
      s.x += noise(f * 3) * 14; s.y += noise(f * 5) * 8; s.rot += noise(f * 7) * 3;
    }
    return s;
  }

  draw(track, t) {
    const s = this.state(track, t);
    for (const [p, img] of Object.entries(this.imgs)) img.style.opacity = p === s.pose ? 1 : 0;
    this.root.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) rotate(${s.rot.toFixed(2)}deg) scale(${s.sx.toFixed(3)}, ${s.sy.toFixed(3)})`;
    const k = s.key;
    // impact frame: the first two frames after an impact key lands are a flat silhouette
    const arrive = t - (k.t + (k.dur || 0));
    const impact = k.impact && arrive >= 0 && arrive < 2 / 30;
    this.body.style.filter = impact ? "brightness(0)" :
      s.xray ? "invert(1) brightness(1.7) contrast(1.6) grayscale(1)" : "none";
    // smear: ghosts of the new pose trailing back along the move
    const smearOn = s.moving && k.smear && s.u > 0.15;
    this.ghosts.forEach((g, n) => {
      if (!smearOn) { g.style.opacity = 0; return; }
      const src = this.imgs[k.pose].src;
      if (g.src !== src) g.src = src;
      const back = (n + 1) / 3.2 * (1 - s.u * 0.6);
      g.style.opacity = (0.42 - n * 0.12).toFixed(2);
      g.style.transform = `translate(${(-k.smear[0] * back).toFixed(1)}px, ${(-k.smear[1] * back).toFixed(1)}px)`;
    });
    // speed lines along the move (render-px coordinates of the key image)
    const showLines = k.lines && t >= k.t && t < k.t + (k.dur || 0) + 0.14;
    if (showLines) {
      const [cx, cy] = k.lines.at, [dx, dy] = k.smear || [0, 1];
      const len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      let d = "";
      for (let n = 0; n < 9; n++) {
        const off = (n - 4) * 26 + noise(n + Math.floor(t * 30)) * 8;
        const px = cx - uy * off, py = cy + ux * off;
        const l = 140 + noise(n * 13) * 60, back = 40 + n % 3 * 30;
        d += `M${(px - ux * (back + l)).toFixed(0)} ${(py - uy * (back + l)).toFixed(0)}L${(px - ux * back).toFixed(0)} ${(py - uy * back).toFixed(0)}`;
      }
      this.lines.innerHTML = `<path d="${d}" stroke="#0A0A0B" stroke-width="7" stroke-linecap="round" fill="none"/>`;
    } else if (this.lines.innerHTML) this.lines.innerHTML = "";
    return s;
  }
}

// fill each key's unchanged fields from the keys before it
const cache = new WeakMap();
function resolved(track, i) {
  if (i < 0) return null;
  let r = cache.get(track);
  if (!r) {
    r = [];
    let last = { x: 0, y: 0, rot: 0, sx: 1, sy: 1, pose: track[0].pose };
    for (const k of track) {
      last = { pose: k.pose, x: k.x ?? last.x, y: k.y ?? last.y, rot: k.rot ?? last.rot,
        sx: k.sx ?? 1, sy: k.sy ?? 1 };
      r.push(last);
    }
    cache.set(track, r);
  }
  return r[i];
}
