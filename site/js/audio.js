// All the show's sound, synthesised in WebAudio (so every effect is our own: no licences),
// plus an optional music bed from Hexakin's own instrumental. The same code schedules a live
// AudioContext or renders an OfflineAudioContext to a WAV for the capture script.

let noiseBuf = null;
function noise(ctx) {
  if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  let s = 12345;
  for (let i = 0; i < d.length; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; d[i] = (s / 0x3fffffff) - 1; }
  return (noiseBuf = b);
}

function env(ctx, g, t, a, peak, d, end = 0.0001) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + a);
  g.gain.exponentialRampToValueAtTime(end, t + a + d);
}

function osc(ctx, out, type, f0, f1, t, a, peak, d) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + a + d);
  env(ctx, g, t, a, peak, d);
  o.connect(g).connect(out); o.start(t); o.stop(t + a + d + 0.05);
}

function burst(ctx, out, t, dur, peak, type = "bandpass", f = 2000, q = 1, f1 = null) {
  const s = ctx.createBufferSource(); s.buffer = noise(ctx);
  const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f1) fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain(); env(ctx, g, t, 0.003, peak, dur);
  s.connect(fl).connect(g).connect(out);
  s.start(t, (t * 0.37) % 0.5); // deterministic offset: a replay sounds identical
  s.stop(t + dur + 0.05);
}

const SFX = {
  tick(ctx, out, t) { osc(ctx, out, "square", 1800, 1200, t, 0.001, 0.07, 0.025); burst(ctx, out, t, 0.02, 0.08, "highpass", 4000); },
  pop(ctx, out, t) { osc(ctx, out, "sine", 500, 900, t, 0.005, 0.18, 0.08); },
  whoosh(ctx, out, t) { burst(ctx, out, t, 0.5, 0.35, "bandpass", 400, 1.5, 3000); },
  shove(ctx, out, t) { burst(ctx, out, t, 0.45, 0.5, "bandpass", 3000, 1.2, 300); osc(ctx, out, "sine", 140, 60, t, 0.005, 0.5, 0.25); },
  boom(ctx, out, t) {
    osc(ctx, out, "sine", 120, 35, t, 0.004, 1.0, 0.9);
    burst(ctx, out, t, 0.6, 0.6, "lowpass", 900, 0.7, 120);
    osc(ctx, out, "triangle", 70, 40, t, 0.004, 0.6, 0.7);
  },
  thud(ctx, out, t) { osc(ctx, out, "sine", 90, 50, t, 0.003, 0.7, 0.35); burst(ctx, out, t, 0.15, 0.3, "lowpass", 600); },
  slam(ctx, out, t) {
    osc(ctx, out, "sine", 160, 38, t, 0.002, 1.0, 1.1);
    burst(ctx, out, t, 0.9, 0.7, "lowpass", 1800, 0.7, 150);
    burst(ctx, out, t, 0.08, 0.5, "highpass", 3000);
  },
  stamp(ctx, out, t) { osc(ctx, out, "square", 220, 80, t, 0.002, 0.35, 0.12); burst(ctx, out, t, 0.12, 0.6, "bandpass", 1200, 0.8); },
  tap(ctx, out, t) { osc(ctx, out, "sine", 2400, 2200, t, 0.001, 0.25, 0.06); burst(ctx, out, t, 0.04, 0.3, "highpass", 5000); },
  slap(ctx, out, t) { burst(ctx, out, t, 0.12, 0.6, "bandpass", 1500, 0.6); osc(ctx, out, "sine", 300, 120, t, 0.002, 0.3, 0.1); },
  crash(ctx, out, t) { burst(ctx, out, t, 2.2, 0.45, "highpass", 5000, 0.5); burst(ctx, out, t, 1.2, 0.3, "bandpass", 8000, 0.8); },
  glitch(ctx, out, t, ev) {
    const dur = ev.dur || 2;
    for (let k = 0; k < dur * 14; k++) {
      const tt = t + k / 14 + ((k * 7919) % 13) / 200;
      osc(ctx, out, "sawtooth", 80 + ((k * 3571) % 900), 60 + ((k * 1931) % 400), tt, 0.002, 0.12, 0.05);
      if (k % 3 === 0) burst(ctx, out, tt, 0.06, 0.25, "bandpass", 2500 + ((k * 433) % 3000), 3);
    }
    osc(ctx, out, "sine", 900, 60, t + dur - 0.4, 0.01, 0.3, 0.4); // power-down
  },
  drumroll(ctx, out, t, ev) {
    const dur = ev.dur || 3;
    for (let k = 0; k < dur * 22; k++) {
      const tt = t + k / 22;
      const amp = 0.06 + 0.22 * (k / (dur * 22));
      burst(ctx, out, tt, 0.05, amp, "bandpass", 900 + (k % 2) * 200, 0.9);
    }
  },
  fanfare(ctx, out, t) {
    const notes = [[523.25, 0], [659.25, 0.12], [783.99, 0.24], [1046.5, 0.42]];
    for (const [f, d] of notes) {
      osc(ctx, out, "sawtooth", f, f, t + d, 0.01, 0.13, d === 0.42 ? 0.9 : 0.16);
      osc(ctx, out, "square", f / 2, f / 2, t + d, 0.01, 0.06, d === 0.42 ? 0.9 : 0.16);
    }
    SFX.crash(ctx, out, t + 0.42);
  },
  trombone(ctx, out, t) {
    const notes = [[311, 0, 0.32], [293.7, 0.36, 0.32], [277.2, 0.72, 0.32], [261.6, 1.08, 1.0]];
    for (const [f, d, len] of notes) {
      const o = ctx.createOscillator(), g = ctx.createGain(), fl = ctx.createBiquadFilter();
      o.type = "sawtooth"; fl.type = "lowpass"; fl.frequency.value = 1100;
      o.frequency.setValueAtTime(f, t + d);
      if (len > 0.5) { // the wah-wah wobble on the last note
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = 6; lg.gain.value = 8; lfo.connect(lg).connect(o.frequency);
        lfo.start(t + d); lfo.stop(t + d + len + 0.1);
        o.frequency.linearRampToValueAtTime(f * 0.94, t + d + len);
      }
      env(ctx, g, t + d, 0.03, 0.22, len);
      o.connect(fl).connect(g).connect(out); o.start(t + d); o.stop(t + d + len + 0.1);
    }
  },
};

// Schedule every sound of a spin on `ctx` starting at ctx time `t0`; `music` an AudioBuffer.
export function schedule(ctx, spin, t0, music = null, opts = {}) {
  const master = ctx.createGain();
  master.gain.value = opts.volume ?? 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14; comp.ratio.value = 4;
  master.connect(comp).connect(ctx.destination);
  const from = opts.from || 0; // seconds into the show (replay seeks)
  for (const ev of spin.sfx) {
    if (ev.t < from - 0.01) continue;
    const fn = SFX[ev.name];
    if (fn) fn(ctx, master, t0 + ev.t - from, ev);
  }
  if (music) {
    const src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = music;
    const stop = spin.tStop - 0.04;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.42, t0 + 0.4);
    g.gain.setValueAtTime(0.42, t0 + stop - from - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + stop - from);
    // the bed comes back softly for the outro
    g.gain.setValueAtTime(0.0001, t0 + spin.tStop + 1.6 - from);
    g.gain.exponentialRampToValueAtTime(0.22, t0 + spin.tStop + 2.4 - from);
    g.gain.setValueAtTime(0.22, t0 + spin.duration - 0.8 - from);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + spin.duration - from);
    src.connect(g).connect(master);
    src.start(t0, (opts.musicOffset || 0) + from);
    src.stop(t0 + spin.duration - from + 0.1);
  }
  return master;
}

export async function loadMusic(ctx, url) {
  const r = await fetch(url);
  return await ctx.decodeAudioData(await r.arrayBuffer());
}

// Offline render -> WAV bytes (Uint8Array), for the capture script.
export async function renderWav(spin, musicUrl) {
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil((spin.duration + 0.5) * rate), rate);
  const music = musicUrl ? await loadMusic(ctx, musicUrl).catch(() => null) : null;
  schedule(ctx, spin, 0, music);
  const buf = await ctx.startRendering();
  return wav(buf);
}

function wav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate;
  const out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); out.setUint32(4, 36 + len * ch * 2, true); str(8, "WAVE"); str(12, "fmt ");
  out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true);
  out.setUint16(34, 16, true); str(36, "data"); out.setUint32(40, len * ch * 2, true);
  const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, data[c][i]));
    out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Uint8Array(out.buffer);
}
