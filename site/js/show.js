// Draws the show at any time t (seconds) on a 1080x1920 stage. Everything on screen is a pure
// function of (spin, t), so the capture script can step frame by frame and get the exact show.
import { reelAt } from "./spin.js";

const PITCH = 830;            // px between card centres on the reel
const CARD_W = 520, CARD_H = 780;
const AV_W = 750, AV_H = 1000; // avatar box on the stage (matches #avatar in app.css)
const SLOTS = 5;

const $ = (sel, root = document) => root.querySelector(sel);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const easeOutBack = (u) => { const c = 1.9; return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2; };

export function boxart(url, hi) {
  if (!url) return "";
  return url + (hi ? "?w=1040&h=1560&q=85" : "?w=520&h=780&q=80");
}

export class Show {
  constructor(stage, { hi = false, clips = {} } = {}) {
    this.stage = stage;
    this.hi = hi;
    this.clips = clips;
    this.spin = null;
    this.reelCards = [...stage.querySelectorAll(".card")];
    this.el = {
      shake: $("#shake", stage), reel: $("#reel", stage), strip: $("#strip", stage),
      ticker: $("#ticker", stage), tonight: $("#tonight", stage), tonightTitle: $("#tonight .t", stage),
      avatar: $("#avatar", stage), avImg: $("#avatar img", stage), bubble: $("#bubble", stage),
      bubbleText: $("#bubble .txt", stage), button: $("#bigbutton", stage), stamp: $("#stamp", stage),
      pending: $("#pending", stage), flash: $("#flash", stage), glitch: $("#glitch", stage),
      reboot: $("#reboot", stage), crack: $("#crack", stage), ripple: $("#ripple", stage),
      watch: $("#watch", stage), hand: $("#watch .hand", stage), stickers: $("#stickers", stage),
      code: $("#codetag", stage), boom: $("#boom", stage), count: $("#count", stage),
    };
    this.stickerEls = [];
    this._lastAv = "";
  }

  setSpin(spin) {
    this.spin = spin;
    this.el.code.textContent = `SPIN ${spin.code}`;
    this.el.count.textContent = `${spin.eligibleCount} GAMES IN THE DRUM · CATALOGUE ${spin.catalogDate}`;
    this.el.tonightTitle.textContent = spin.result.title.replace(/[®™©]/g, "");
    const len = spin.result.title.length;
    this.el.tonightTitle.style.fontSize = `${len > 40 ? 76 : len > 28 ? 94 : len > 18 ? 112 : 132}px`;
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
    const clips = new Set(["idle", ...s.avatar.map((a) => a.clip)]);
    for (const c of clips) {
      const info = this.clips[c];
      if (!info) continue;
      if (this.hi) for (let i = 0; i < info.hiFrames; i++) urls.add(this.hiFrame(c, i));
      else urls.add(`avatar/lo/${c}.webp`);
    }
    return [...urls].filter(Boolean);
  }

  hiFrame(clip, i) { return `avatar/hi/${clip}/${String(i).padStart(3, "0")}.webp`; }

  // ---------------------------------------------------------------- avatar
  drawAvatar(clip, local, holdEnd = false) {
    const info = this.clips[clip] || this.clips.idle;
    if (!info) return;
    if (clip === "idle") local = local % info.duration;
    if (this.hi) {
      const i = Math.min(info.hiFrames - 1, Math.max(0, Math.floor(local * info.hiFps)));
      const src = this.hiFrame(clip, i);
      if (src !== this._lastAv) { this.el.avImg.src = src; this._lastAv = src; }
      return;
    }
    const n = info.frames, cols = Math.min(info.cols, n), rows = Math.ceil(n / cols);
    const i = Math.min(n - 1, Math.max(0, Math.floor(local * info.fps)));
    const key = `${clip}:${i}`;
    if (key === this._lastAv) return;
    this._lastAv = key;
    const st = this.el.avatar.style;
    st.backgroundImage = `url(avatar/lo/${clip}.webp)`;
    st.backgroundSize = `${cols * AV_W}px ${rows * AV_H}px`;
    st.backgroundPosition = `${-(i % cols) * AV_W}px ${-Math.floor(i / cols) * AV_H}px`;
  }

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
        x = -1500 * clamp(a / 0.35) ** 1.6; rot = -28 * clamp(a / 0.35);
        if (a > 0.4) hidden = true;
      }
      card.style.visibility = hidden ? "hidden" : "visible";
      if (hidden) continue;
      const img = card.firstElementChild;
      const src = boxart(g.boxart, this.hi);
      if (img.dataset.src !== src) { img.dataset.src = src; img.src = src; }
      card.style.transform = `translate(${x}px, ${y.toFixed(1)}px) rotate(${rot}deg)`;
      card.style.filter = blur > 0.4 ? `blur(${blur.toFixed(1)}px)` : "none";
    }
    const cur = s.reel.entries[centre];
    E.ticker.textContent = cur ? cur.title.replace(/[®™©]/g, "").toUpperCase() : "";

    return { p, v, centre };
  }

  // ---------------------------------------------------------------- idle (before the press)
  drawIdle(wall, line) {
    this.drawAvatar("idle", wall);
    this.el.reel.classList.add("idle");
    if (this.spin) { this.drawReel(0); this.el.ticker.textContent = "THE DRUM AWAITS. PRESS THE BUTTON."; }
    const b = this.el.bubble;
    b.style.opacity = 1; b.style.transform = "scale(1)";
    this.el.bubbleText.textContent = line;
    this.el.button.style.transform = `scale(${1 + 0.03 * Math.sin(wall * 4)})`;
  }

  // ---------------------------------------------------------------- the show at time t
  draw(t) {
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
      ? `rotate(-11deg) scale(${(1 + 1.6 * (1 - clamp(sa / 0.12)) ** 2).toFixed(3)})` : "rotate(-11deg) scale(2.6)";
    const centreCard = this.reelCards[2];
    if (landed) {
      const a = t - tl;
      centreCard.style.transform += ` scale(${(1 + 0.08 * Math.exp(-a * 5) * Math.cos(a * 18) + 0.04).toFixed(3)})`;
    }

    // flash on hits
    let fl = 0;
    for (const f of s.fx) {
      if (!["slam", "land"].includes(f.type)) continue;
      const a = since(f);
      if (a >= 0 && a < 0.22) fl = Math.max(fl, (1 - a / 0.22) * (f.type === "land" ? 0.6 : 0.8));
    }
    E.flash.style.opacity = fl.toFixed(3);

    // the big button: squashed by the slam, then it sinks out of the way
    const slam = fxAt("slam")[0];
    const ba = t - slam.t;
    let bs = 1, by = 0;
    if (ba < 0) bs = 1 - 0.06 * clamp((ba + 0.25) / 0.25);
    else { bs = ba < 0.12 ? 0.55 : 0.55 + 0.45 * clamp((ba - 0.12) / 0.3); by = ba > 1.2 ? 900 * clamp((ba - 1.2) / 0.5) ** 2 : 0; }
    E.button.style.transform = `translateY(${by}px) scale(1, ${bs.toFixed(3)})`;
    E.boom.style.opacity = ba >= 0 && ba < 0.9 ? 1 : 0;
    E.boom.style.transform = `rotate(-8deg) scale(${ba >= 0 ? easeOutBack(clamp(ba / 0.2)).toFixed(3) : 0})`;

    // fake landing: a "PENDING..." stamp that gets knocked off by the shove
    const fk = fxAt("fakeland")[0];
    if (fk) {
      const sh = shoved.find((q) => q.idx === fk.idx);
      const a = t - fk.t, gone = sh ? t - sh.t : -1;
      E.pending.style.opacity = a >= 0 && gone < 0.3 ? 1 : 0;
      E.pending.style.transform = `translate(${gone > 0 ? -1500 * clamp(gone / 0.35) ** 1.6 : 0}px, 0) rotate(${8 + (gone > 0 ? -30 * clamp(gone / 0.35) : 0)}deg) scale(${a >= 0 ? (1 + 0.8 * (1 - clamp(a / 0.12)) ** 2).toFixed(3) : 2})`;
    } else E.pending.style.opacity = 0;

    // glitch + reboot
    const gl = fxAt("glitch").find((f) => t >= f.t && t < f.t + f.dur);
    E.glitch.style.opacity = gl ? 1 : 0;
    if (gl) {
      const a = t - gl.t;
      E.glitch.style.backgroundPosition = `${Math.floor(a * 977) % 300}px ${Math.floor(a * 613) % 300}px`;
      E.reel.style.transform = `translate(${(Math.sin(a * 140) * 18).toFixed(1)}px, 0) skewX(${(Math.sin(a * 53) * 6).toFixed(1)}deg)`;
      E.reel.style.filter = `hue-rotate(${Math.floor(a * 30) * 47 % 360}deg) saturate(2.5)`;
    } else { E.reel.style.transform = ""; E.reel.style.filter = ""; }
    const rb = fxAt("reboot").find((f) => t >= f.t && t < f.t + 0.8);
    E.reboot.style.opacity = rb ? 1 : 0;

    // taps on the glass, and the crack they leave
    const taps = fxAt("tap").filter((f) => t >= f.t && t < f.t + 0.35);
    E.ripple.style.opacity = taps.length ? 1 - (t - taps[0].t) / 0.35 : 0;
    E.ripple.style.transform = taps.length ? `scale(${0.4 + 1.6 * (t - taps[0].t) / 0.35})` : "scale(0)";
    const cr = fxAt("crack").find((f) => t >= f.t && t < f.t + 2.6);
    E.crack.style.opacity = cr ? clamp((f => 1 - clamp((t - f.t - 2.1) / 0.5))(cr)) : 0;

    // the watch he taps at you
    const w = fxAt("watch").find((f) => t >= f.t && t < f.t + f.dur);
    E.watch.style.opacity = w ? 1 : 0;
    if (w) {
      const a = t - w.t;
      E.watch.style.transform = `scale(${easeOutBack(clamp(a / 0.25)).toFixed(3)}) rotate(${(Math.sin(a * 6) * 4).toFixed(1)}deg)`;
      E.hand.style.transform = `rotate(${Math.floor(a * 4) * 30}deg)`;
    }

    // stickers slapped on the screen
    s.stickers.forEach((sk, i) => {
      const el = this.stickerEls[i];
      const a = t - sk.t0;
      if (a < 0 || t > sk.t1 + 0.3) { el.style.opacity = 0; return; }
      const out = clamp((t - sk.t1) / 0.3);
      el.style.opacity = 1 - out;
      el.style.left = `${(sk.x * 1080 - 170).toFixed(0)}px`;
      el.style.top = `${(220 + sk.y * 900).toFixed(0)}px`;
      el.style.transform = `rotate(${sk.rot.toFixed(1)}deg) scale(${(sk.scale * (a < 0.18 ? 1.6 - 0.6 * easeOutBack(a / 0.18) : 1) * (1 - 0.3 * out)).toFixed(3)})`;
    });

    // avatar
    let act = null;
    for (const a of s.avatar) if (t >= a.t0 && t < a.t1) act = a;
    if (act) this.drawAvatar(act.clip, t - act.t0);
    else this.drawAvatar("idle", t);
    // he leans in when talking big
    const lean = landed ? 1 + 0.05 * Math.exp(-(t - tl) * 3) : 1;
    E.avatar.style.transform = `scale(${lean.toFixed(3)})`;

    // speech bubble
    let bub = null;
    for (const b of s.bubbles) if (t >= b.t0 && t < b.t1) bub = b;
    if (bub) {
      const a = t - bub.t0, out = clamp((t - (bub.t1 - 0.15)) / 0.15);
      E.bubble.style.opacity = 1 - out;
      E.bubble.style.transform = `scale(${(easeOutBack(clamp(a / 0.18)) * (1 - 0.2 * out)).toFixed(3)})`;
      const n = Math.floor(a * 38);
      const key = `${bub.t0}:${Math.min(n, bub.text.length)}`;
      if (this._lastBub !== key) {
        this._lastBub = key;
        const esc = (x) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;");
        // the unrevealed text is there but invisible, so the bubble doesn't grow as it types
        E.bubbleText.innerHTML = `${esc(bub.text.slice(0, n))}<span class="ghost">${esc(bub.text.slice(n))}</span>`;
      }
      E.bubble.classList.toggle("big", bub.style === "big");
    } else E.bubble.style.opacity = 0;
  }
}
