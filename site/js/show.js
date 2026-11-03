// Draws the show at any time t (seconds) on a 1080x1920 stage. Everything on screen is a pure
// function of (spin, t), so the capture script can step frame by frame and get the exact show.
import { reelAt } from "./spin.js";
import { Puppet, POSES, noise } from "./puppet.js";

const PITCH = 540;            // px between card centres on the reel
const SLOTS = 5;
const FEET_AT = [425, 1490];  // where Hexakin stands (stage px); everything inside x60-960, y150-1500
const PUPPET_SCALE = 0.71;    // stage px per chibi canvas px (idle stands ~650 px tall, head below the reel)
// the button he grabs: the drawn one in slam-windup sits at canvas (300, 1050)
const DRAWN_BUTTON = [FEET_AT[0] + (300 - 600) * PUPPET_SCALE, FEET_AT[1] + (1050 - 1140) * PUPPET_SCALE];
const IDLE_TRACK = [{ t: 0, pose: "idle", breathe: true }];

const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOutBack = (u) => { const c = 1.9; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };

export function boxart(url, hi) {
  if (!url) return "";
  return url + (hi ? "?w=1040&h=1560&q=85" : "?w=520&h=780&q=80");
}

export class Show {
  constructor(stage, { hi = false } = {}) {
    this.stage = stage;
    this.hi = hi;
    this.spin = null;
    this.reelCards = [...stage.querySelectorAll(".card")];
    this.el = {
      shake: $("#shake", stage), reel: $("#reel", stage), strip: $("#strip", stage),
      ticker: $("#ticker", stage), tonight: $("#tonight", stage), tonightTitle: $("#tonight .t", stage),
      avatar: $("#avatar", stage), bubble: $("#bubble", stage),
      bubbleText: $("#bubble .txt", stage), button: $("#bigbutton", stage), stamp: $("#stamp", stage),
      pending: $("#pending", stage), flash: $("#flash", stage), glitch: $("#glitch", stage),
      reboot: $("#reboot", stage), crack: $("#crack", stage), ripple: $("#ripple", stage),
      stickers: $("#stickers", stage), impactbg: $("#impactbg", stage), fx: $("#fxsvg", stage),
      fxback: $("#fxback", stage),
      code: $("#codetag", stage), boom: $("#boom", stage), count: $("#count", stage),
    };
    this.stickerEls = [];
    this.puppet = new Puppet(this.el.avatar, { scale: PUPPET_SCALE, feetAt: FEET_AT });
    this.pending = []; // images whose src changed in the last draw (render mode waits for them)
  }

  setSpin(spin) {
    this.spin = spin;
    this.el.code.textContent = `SPIN ${spin.code}`;
    this.el.count.textContent = `${spin.eligibleCount} GAMES IN THE DRUM · CATALOGUE ${spin.catalogDate}`;
    this.el.tonightTitle.textContent = spin.result.title.replace(/[®™©]/g, "");
    const len = spin.result.title.length;
    this.el.tonightTitle.style.fontSize = `${len > 40 ? 54 : len > 28 ? 64 : len > 18 ? 78 : 96}px`;
    this.el.stickers.innerHTML = "";
    this.stickerEls = spin.stickers.map((s) => {
      const img = document.createElement("img");
      img.src = `stickers/${s.src}.webp`;
      img.className = "sticker";
      this.el.stickers.appendChild(img);
      return img;
    });
  }

  // every image this spin will show, for preloading
  assets() {
    const s = this.spin, urls = new Set();
    for (const g of s.reel.entries) urls.add(boxart(g.boxart, this.hi));
    for (const st of s.stickers) urls.add(`stickers/${st.src}.webp`);
    return [...urls].filter(Boolean);
  }

  // every chibi pose, decoded, each in its own layer (call before the show can start)
  loadPoses() { return this.puppet.load(POSES); }

  drawReel(t) {
    const s = this.spin, E = this.el;
    const { p, v } = reelAt(s.reel, t);
    const centre = Math.round(p);
    const blur = clamp(Math.abs(v) * 0.5, 0, 9);
    const shoved = s.reel.shoved;
    for (let k = 0; k < SLOTS; k++) {
      const idx = centre - 2 + k;
      const card = this.reelCards[k];
      const g = s.reel.entries[idx];
      const y = (p - idx) * PITCH;
      let x = 0, rot = 0, hidden = !g || idx < 0;
      const sh = shoved.find((q) => q.idx === idx);
      if (sh && t >= sh.t) {
        const a = t - sh.t;
        x = 1300 * clamp(a / 0.35) ** 1.6; rot = 28 * clamp(a / 0.35);   // shoved off to the right
        if (a > 0.4) hidden = true;
      }
      card.style.visibility = hidden ? "hidden" : "visible";
      if (hidden) continue;
      const img = card.firstElementChild;
      const src = boxart(g.boxart, this.hi);
      if (img.dataset.src !== src) { img.dataset.src = src; img.src = src; this.pending.push(img); }
      card.style.transform = `translate(${x}px, ${y.toFixed(1)}px) rotate(${rot}deg)`;
      card.style.filter = blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : "none";
    }
    const cur = s.reel.entries[centre];
    E.ticker.textContent = cur ? cur.title.replace(/[®™©]/g, "").toUpperCase() : "";

    return { p, v, centre };
  }

  // ---------------------------------------------------------------- idle (before the press)
  drawIdle(wall, line) {
    this.puppet.draw(IDLE_TRACK, wall);
    this.el.reel.classList.add("idle");
    if (this.spin) { this.drawReel(0); this.el.ticker.textContent = "THE DRUM AWAITS. PRESS THE BUTTON."; }
    const b = this.el.bubble;
    b.style.opacity = 1; b.style.transform = "scale(1)";
    this.el.bubbleText.textContent = line;
    this.el.button.style.visibility = "visible";
    this.el.button.style.transform = `scale(${1 + 0.03 * Math.sin(wall * 4)})`;
  }

  // render mode: draw, then wait until every image that changed is decoded and on screen
  async drawExact(t) {
    this.draw(t);
    const imgs = this.pending.splice(0);
    await Promise.all(imgs.map((i) => (i.decode ? i.decode().catch(() => {}) : null)));
  }

  // ---------------------------------------------------------------- the show at time t
  draw(t) {
    this.pending.length = 0;
    const s = this.spin, E = this.el;
    E.reel.classList.remove("idle");
    const fxAt = (type) => s.fx.filter((f) => f.type === type);
    const since = (f) => t - f.t;

    // shake: decaying wobble from hits
    let sx = 0, sy = 0;
    for (const f of s.fx) {
      const amp = { slam: 26, land: 34, shove: 14, tap: 5, fakeland: 10 }[f.type];
      if (!amp) continue;
      const a = since(f);
      if (a < 0 || a > 0.6) continue;
      const k = amp * Math.exp(-a * 9);
      sx += k * Math.sin(a * 83 + f.t); sy += k * Math.cos(a * 61 + f.t * 3);
    }
    E.shake.style.transform = `translate(${sx.toFixed(1)}px, ${sy.toFixed(1)}px)`;

    const { p, v, centre } = this.drawReel(t);
    const shoved = s.reel.shoved;

    // landing: title, stamp, card bump, flash
    const tl = s.tStop;
    const landed = t >= tl;
    E.reel.classList.toggle("landed", landed);
    E.ticker.style.opacity = landed ? 0 : 1;
    const ti = fxAt("title")[0];
    const ta = ti ? t - ti.t : -1;
    E.tonight.style.opacity = ta >= 0 ? 1 : 0;
    E.tonight.style.transform = ta >= 0 ? `scale(${easeOutBack(clamp(ta / 0.25)).toFixed(3)})` : "scale(0.2)";
    const st = fxAt("stamp")[0];
    const sa = st ? t - st.t : -1;
    E.stamp.style.opacity = sa >= 0 ? 1 : 0;
    E.stamp.style.transform = sa >= 0
      ? `rotate(-7deg) scale(${(1 + 1.6 * (1 - clamp(sa / 0.12)) ** 2).toFixed(3)})` : "rotate(-7deg) scale(2.6)";
    const centreCard = this.reelCards[2];
    if (landed) {
      const a = t - tl;
      centreCard.style.transform += ` scale(${(1 + 0.08 * Math.exp(-a * 5) * Math.cos(a * 18) + 0.04).toFixed(3)})`;
    }

    // flash on hits
    let fl = 0;
    for (const f of s.fx) {
      if (!["slam", "land"].includes(f.type)) continue;
      const a = since(f) - (f.type === "slam" ? 4 : 6) / 30;   // after the contact + silhouette frames
      if (a >= 0 && a < 0.2) fl = Math.max(fl, (1 - a / 0.2) * (f.type === "land" ? 0.5 : 0.7));
    }
    E.flash.style.opacity = fl.toFixed(3);

    // the big button: he yanks it over to his feet (0.25-0.68 s); from the wind-up on, the
    // drawn button in his slam poses takes over
    const slam = fxAt("slam")[0];
    const ba = t - slam.t;
    const g = clamp((t - 0.45) / 0.45), ge = g * g * (3 - 2 * g);
    const bc = [770, 1385];
    const bx = (DRAWN_BUTTON[0] - bc[0]) * ge, by = (DRAWN_BUTTON[1] - bc[1]) * ge + -90 * Math.sin(Math.PI * g);
    E.button.style.visibility = t < 1.16 ? "visible" : "hidden";
    E.button.style.transform = `translate(${bx.toFixed(1)}px, ${by.toFixed(1)}px) scale(${(1 - 0.36 * ge).toFixed(3)}) rotate(${(-20 * Math.sin(Math.PI * g)).toFixed(1)}deg)`;
    const bt = ba - 4 / 30;   // clean contact (2 frames), silhouette (2 frames), then the text
    E.boom.style.opacity = bt >= 0 && bt < 0.85 ? 1 : 0;
    E.boom.style.transform = `rotate(-8deg) scale(${bt >= 0 ? easeOutBack(clamp(bt / 0.18)).toFixed(3) : 0})`;

    // fake landing: a "PENDING..." stamp that gets knocked off by the shove
    const fk = fxAt("fakeland")[0];
    if (fk) {
      const sh = shoved.find((q) => q.idx === fk.idx);
      const a = t - fk.t, gone = sh ? t - sh.t : -1;
      E.pending.style.opacity = a >= 0 && gone < 0.3 ? 1 : 0;
      E.pending.style.transform = `translate(${gone > 0 ? 1500 * clamp(gone / 0.35) ** 1.6 : 0}px, 0) rotate(${8 + (gone > 0 ? 30 * clamp(gone / 0.35) : 0)}deg) scale(${a >= 0 ? (1 + 0.8 * (1 - clamp(a / 0.12)) ** 2).toFixed(3) : 2})`;
    } else E.pending.style.opacity = 0;

    // glitch + reboot
    const gl = fxAt("glitch").find((f) => t >= f.t && t < f.t + f.dur);
    E.glitch.style.opacity = gl ? 1 : 0;
    if (gl) {
      const a = t - gl.t;
      E.glitch.style.backgroundPosition = `${Math.floor(a * 977) % 300}px ${Math.floor(a * 613) % 300}px`;
      E.reel.style.transform = `translate(${(Math.sin(a * 140) * 18).toFixed(1)}px, 0) skewX(${(Math.sin(a * 53) * 6).toFixed(1)}deg)`;
      E.reel.style.filter = `hue-rotate(${Math.floor(a / 0.4) * 47 % 360}deg) saturate(1.8)`;
    } else { E.reel.style.transform = ""; E.reel.style.filter = ""; }
    const rb = fxAt("reboot").find((f) => t >= f.t && t < f.t + 0.8);
    E.reboot.style.opacity = rb ? 1 : 0;

    // taps on the glass, and the crack they leave
    const taps = fxAt("tap").filter((f) => t >= f.t && t < f.t + 0.35);
    E.ripple.style.opacity = taps.length ? 1 - (t - taps[0].t) / 0.35 : 0;
    E.ripple.style.transform = taps.length ? `scale(${0.4 + 1.6 * (t - taps[0].t) / 0.35})` : "scale(0)";
    const cr = fxAt("crack").find((f) => t >= f.t && t < f.t + 2.6);
    E.crack.style.opacity = cr ? clamp((f => 1 - clamp((t - f.t - 2.1) / 0.5))(cr)) : 0;

    // stickers slapped on the screen
    s.stickers.forEach((sk, i) => {
      const el = this.stickerEls[i];
      const a = t - sk.t0;
      if (a < 0 || t > sk.t1 + 0.3) { el.style.opacity = 0; return; }
      const out = clamp((t - sk.t1) / 0.3);
      el.style.opacity = 1 - out;
      // inside the Shorts safe zone (x 60-960, y 150-1500); stickers are ~300x420
      el.style.left = `${(60 + (sk.x - 0.15) / 0.7 * 560).toFixed(0)}px`;
      el.style.top = `${(230 + (sk.y - 0.15) / 0.4 * 600).toFixed(0)}px`;
      el.style.transform = `rotate(${sk.rot.toFixed(1)}deg) scale(${(sk.scale * (a < 0.18 ? 1.6 - 0.6 * easeOutBack(a / 0.18) : 1) * (1 - 0.3 * out)).toFixed(3)})`;
    });

    // Hexakin (the chibi puppet) + his effects
    const ps = this.puppet.draw(s.track, t);
    E.impactbg.style.opacity = ps.impact ? 1 : 0;
    let fx = "";
    // bolts from the broken reel into him while he's zapped
    const zapping = gl && (ps.pose === "electrocuted-a" || ps.pose === "electrocuted-b");
    if (zapping) {
      const seed = Math.floor(t * 15);
      const from = [[300, 420], [300, 620], [300, 820]];
      const to = [[160, 560], [1040, 560], [600, 380]].map((c) => this.puppet.toStage(c));
      from.forEach(([x0, y0], i) => {
        const [x1, y1] = to[i];
        let d = `M${x0} ${y0}`;
        for (let k = 1; k < 8; k++) {
          const u = k / 8, nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny) || 1, off = noise(seed * 31 + i * 7 + k) * 40;
          d += `L${(x0 + (x1 - x0) * u + nx / l * off).toFixed(0)} ${(y0 + (y1 - y0) * u + ny / l * off).toFixed(0)}`;
        }
        d += `L${x1.toFixed(0)} ${y1.toFixed(0)}`;
        fx += `<path d="${d}" stroke="#7fe8ff" stroke-width="22" stroke-linejoin="round" fill="none" opacity=".45"/><path d="${d}" stroke="#fff" stroke-width="8" stroke-linejoin="round" fill="none"/>`;
      });
    }
    // smoke off his head after a zap
    const sm = fxAt("smoke").find((f) => t >= f.t && t < f.t + f.dur);
    if (sm) {
      const a = t - sm.t, [hx, hy] = this.puppet.toStage([600, 330]);
      for (let i = 0; i < 6; i++) {
        const life = a - i * 0.32;
        if (life < 0 || life > 1.6) continue;
        const x = hx + Math.sin(life * 3 + i) * 26 + (i % 2 ? 18 : -18), y = hy - life * 230;
        fx += `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(20 + life * 42).toFixed(0)}" fill="#3a3a3f" opacity="${(0.75 * (1 - life / 1.6)).toFixed(2)}"/>`;
      }
    }
    // impact star (behind him, after the clean contact frames) + dust where his fist hits
    let back = "";
    if (ba >= 0 && ba < 1.1) {
      const [x, y] = this.puppet.toStage([410, 960]);
      if (bt >= 0 && bt < 0.3) {
        const r = 40 + 150 * easeOutBack(clamp(bt / 0.15));
        let pts = "";
        for (let i = 0; i < 16; i++) {
          const ang = (i / 16) * Math.PI * 2, rr = i % 2 ? r * 0.45 : r * (0.85 + 0.15 * noise(i));
          pts += `${(x + Math.cos(ang) * rr).toFixed(0)},${(y + Math.sin(ang) * rr * 0.75).toFixed(0)} `;
        }
        back = `<polygon points="${pts}" fill="#FFE14D" stroke="#0A0A0B" stroke-width="8" opacity="${(1 - clamp((bt - 0.16) / 0.14)).toFixed(2)}"/>`;
      }
      for (let i = 0; i < 6; i++) {
        const dir = i < 3 ? -1 : 1, k = (i % 3) + 1;
        const dx = Math.max(90, Math.min(930, x + dir * (40 + ba * 140 * k * 0.5))), dy = FEET_AT[1] - 15 - ba * 60 * (1 + (i % 3) * 0.4);
        fx += `<circle cx="${dx.toFixed(0)}" cy="${dy.toFixed(0)}" r="${(16 + ba * 50 + (i % 3) * 6).toFixed(0)}" fill="#cfc6b1" stroke="#0A0A0B" stroke-width="5" opacity="${(1 - ba / 1.1).toFixed(2)}"/>`;
      }
    }
    // confetti on the celebration (seeded by nothing but t: identical every replay)
    const cf = fxAt("confetti").find((f) => t >= f.t && t < f.t + f.dur);
    if (cf) {
      const a = t - cf.t, cols = ["#C8202E", "#FFE14D", "#2BB3FF", "#ECE6D6", "#0A0A0B", "#7CE07C"];
      for (let i = 0; i < 46; i++) {
        const x0 = 90 + ((i * 197) % 840), vy = 260 + ((i * 53) % 260), drift = noise(i * 3) * 90;
        const y = 180 - ((i * 71) % 260) + vy * a + 120 * a * a;
        if (y < 150 || y > 1500) continue;
        const x = x0 + drift * Math.sin(a * 3 + i), rot = (a * 360 * (1 + (i % 3))) + i * 40;
        const fade = 1 - clamp((a - cf.dur + 0.5) / 0.5);
        fx += `<rect x="${(x - 9).toFixed(0)}" y="${(y - 5).toFixed(0)}" width="18" height="10" fill="${cols[i % cols.length]}" stroke="#0A0A0B" stroke-width="2" opacity="${fade.toFixed(2)}" transform="rotate(${rot.toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`;
      }
    }
    if (this._fx !== fx) { E.fx.innerHTML = fx; this._fx = fx; }
    if (this._back !== back) { E.fxback.innerHTML = back; this._back = back; }
    // the glass ripple and crack sit on his face while he's pressed against the screen
    if (ps.pose === "nose-on-glass") {
      const [fx0, fy0] = this.puppet.toStage([600, 720]);
      E.ripple.style.left = `${(fx0 - 90).toFixed(0)}px`; E.ripple.style.top = `${(fy0 - 90).toFixed(0)}px`;
      E.crack.style.left = `${(fx0 - 200).toFixed(0)}px`; E.crack.style.top = `${(fy0 - 200).toFixed(0)}px`;
    }

    // speech bubble
    let bub = null;
    for (const b of s.bubbles) if (t >= b.t0 && t < b.t1) bub = b;
    if (bub) {
      const a = t - bub.t0, out = clamp((t - (bub.t1 - 0.15)) / 0.15);
      E.bubble.style.opacity = 1 - out;
      E.bubble.style.transform = `scale(${(easeOutBack(clamp(a / 0.18)) * (1 - 0.2 * out)).toFixed(3)})`;
      const words = bub.text.split(" ");
      const shown = bub.style === "big" ? words.length : Math.min(words.length, 1 + Math.floor(a / 0.4 * words.length));
      const n = words.slice(0, shown).join(" ").length;
      const key = `${bub.t0}:${Math.min(n, bub.text.length)}`;
      if (this._lastBub !== key) {
        this._lastBub = key;
        // (non-breaking hyphens: "re-rolls" never wraps as "re- / rolls")
        const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/-/g, "\u2011");
        // the unrevealed text is there but invisible, so the bubble doesn't grow as it types
        E.bubbleText.innerHTML = `${esc(bub.text.slice(0, n))}<span class="ghost">${esc(bub.text.slice(n))}</span>`;
      }
      E.bubble.classList.toggle("big", bub.style === "big");
      E.bubble.classList.toggle("low", bub.t0 >= s.tStop);
    } else E.bubble.style.opacity = 0;
  }
}
