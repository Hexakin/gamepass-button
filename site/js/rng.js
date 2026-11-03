// Spin codes and seeded randomness.
//
// A spin code is DDD-RRRRR (Crockford base32): DDD = the spin's UK date (days since
// 2026-01-01), RRRRR = 25 bits from the browser's crypto RNG. Everything about a spin
// (the catalogue it uses, the reel order, timings, fake-outs and the final game) is derived
// from the code, so ?seed=<code> replays it exactly. The final game is drawn uniformly
// (rejection sampling, no modulo bias) from that day's eligible list.

export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // Crockford: no I, L, O, U
const EPOCH = Date.UTC(2026, 0, 1);
const DAY = 86400000;

export function ukDate(now = new Date()) {
  // YYYY-MM-DD in Europe/London
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric",
    month: "2-digit", day: "2-digit" }).formatToParts(now);
  const g = (t) => p.find((x) => x.type === t).value;
  return `${g("year")}-${g("month")}-${g("day")}`;
}

function enc(n, len) {
  let s = "";
  for (let i = 0; i < len; i++) { s = ALPHABET[n & 31] + s; n = Math.floor(n / 32); }
  return s;
}

function dec(s) {
  let n = 0;
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error(`bad character ${ch}`);
    n = n * 32 + v;
  }
  return n;
}

export function newCode(date = ukDate(), cryptoObj = globalThis.crypto) {
  const days = Math.round((Date.parse(date + "T00:00:00Z") - EPOCH) / DAY);
  const buf = new Uint32Array(1);
  cryptoObj.getRandomValues(buf);
  return `${enc(days, 3)}-${enc(buf[0] >>> 7, 5)}`; // top 25 bits
}

export function normaliseCode(raw) {
  const s = String(raw || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
    .replace(/O/g, "0").replace(/[IL]/g, "1").replace(/U/g, "V");
  if (s.length !== 8) return null;
  for (const ch of s) if (!ALPHABET.includes(ch)) return null;
  return `${s.slice(0, 3)}-${s.slice(3)}`;
}

export function codeDate(code) {
  const days = dec(code.slice(0, 3));
  return new Date(EPOCH + days * DAY).toISOString().slice(0, 10);
}

// cyrb128 string hash -> four 32-bit seeds; sfc32 generator. Small, fast, well-mixed.
function cyrb128(str) {
  let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
  for (let i = 0, k; i < str.length; i++) {
    k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

export function stream(code, purpose) {
  let [a, b, c, d] = cyrb128(`${code}|${purpose}`);
  const u32 = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return t >>> 0;
  };
  for (let i = 0; i < 15; i++) u32();
  const r = {
    u32,
    float: () => u32() / 4294967296,
    // uniform integer in [0, n) without modulo bias
    int(n) {
      const lim = Math.floor(4294967296 / n) * n;
      let x;
      do { x = u32(); } while (x >= lim);
      return x % n;
    },
    range: (lo, hi) => lo + (hi - lo) * r.float(),
    pick: (arr) => arr[r.int(arr.length)],
    chance: (p) => r.float() < p,
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = r.int(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
  };
  return r;
}
