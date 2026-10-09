/**
 * Sound-effect library, synthesised in code — no sample files, no licences, identical on every machine.
 * Each recipe returns mono float samples at 48 kHz; ensureSfx() writes them as 16-bit WAVs into _motion/sfx/.
 * The level each effect sits at in a mix is its GAIN (renderer) times the volume asked for in the composition.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE, ensureDir } from './util.mjs';

export const SR = 48000;
const VERSION = 'sfx-5';

// ── tiny DSP kit ──
function seeded(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const buf = (sec) => new Float32Array(Math.max(1, Math.round(sec * SR)));
const TAU = Math.PI * 2;
function white(n, seed) { const r = seeded(seed), x = new Float32Array(n); for (let i = 0; i < n; i++) x[i] = r() * 2 - 1; return x; }
function pink(n, seed) {
  const r = seeded(seed), x = new Float32Array(n); let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
  }
  return x;
}
function coeffs(type, f, q, sr) {
  const w = TAU * Math.min(Math.max(f, 10), sr * 0.45) / sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q);
  let b0, b1, b2; const a0 = 1 + al, a1 = -2 * cs, a2 = 1 - al;
  if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = (1 - cs) / 2; }
  else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = (1 + cs) / 2; }
  else { b0 = al; b1 = 0; b2 = -al; }                     // band-pass, 0 dB peak
  return [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
}
/** Biquad filter; f may be a number or a function of time (seconds) for sweeps. */
export function filt(x, type, f, q = 0.707, sr = SR) {
  const y = new Float32Array(x.length); let x1 = 0, x2 = 0, y1 = 0, y2 = 0, c = null;
  const dyn = typeof f === 'function';
  for (let i = 0; i < x.length; i++) {
    if (!c || (dyn && i % 32 === 0)) c = coeffs(type, dyn ? f(i / sr) : f, q, sr);
    const v = c[0] * x[i] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function each(x, fn) { for (let i = 0; i < x.length; i++) x[i] = fn(i / SR, x[i], i); return x; }
function add(dst, src, at = 0, gain = 1) { const o = Math.round(at * SR); for (let i = 0; i < src.length && o + i < dst.length; i++) if (o + i >= 0) dst[o + i] += src[i] * gain; return dst; }
function tone(sec, freqFn, ampFn, shape = 'sine') {
  const x = buf(sec); let ph = 0;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR, f = typeof freqFn === 'function' ? freqFn(t) : freqFn; ph += TAU * f / SR;
    let v = Math.sin(ph);
    if (shape === 'tri') v = Math.sin(ph) + Math.sin(3 * ph) / 9 - Math.sin(5 * ph) / 25;
    if (shape === 'square') v = Math.sign(Math.sin(ph)) * 0.6;
    if (shape === 'saw3') v = Math.sin(ph) + Math.sin(2 * ph) / 2 + Math.sin(3 * ph) / 3;
    x[i] = v * ampFn(t);
  }
  const fl = Math.min(x.length, Math.round(0.03 * SR)); for (let i = 0; i < fl; i++) x[x.length - 1 - i] *= Math.pow(i / fl, 2);   // never end on a click
  return x;
}
const dec = (tau) => (t) => Math.exp(-t / tau);
const att = (a, tau) => (t) => Math.min(1, t / a) * Math.exp(-Math.max(0, t - a) / tau);
function sat(x, drive) { const k = Math.tanh(drive); return each(x, (t, v) => Math.tanh(v * drive) / k); }
/** Small Schroeder reverb (4 combs + 2 all-passes) for tails. */
function reverb(x, { mix = 0.2, t60 = 1.2, tail = 1 } = {}) {
  const n = x.length + Math.round(tail * SR), y = new Float32Array(n), wet = new Float32Array(n);
  for (const ms of [29.7, 37.1, 41.1, 43.7]) {
    const d = Math.round(ms * SR / 1000), g = Math.pow(10, (-3 * ms / 1000) / t60), line = new Float32Array(d); let p = 0;
    for (let i = 0; i < n; i++) { const out = line[p]; line[p] = (i < x.length ? x[i] : 0) + out * g; p = (p + 1) % d; wet[i] += out * 0.25; }
  }
  for (const [ms, g] of [[5, 0.7], [1.7, 0.7]]) {
    const d = Math.round(ms * SR / 1000), line = new Float32Array(d); let p = 0;
    for (let i = 0; i < n; i++) { const bv = line[p], v = wet[i] + bv * -g; line[p] = v; p = (p + 1) % d; wet[i] = bv + v * g; }
  }
  for (let i = 0; i < n; i++) y[i] = (i < x.length ? x[i] : 0) * (1 - mix) + wet[i] * mix;
  return y;
}
function finish(x, { peak = 0.89, fade = 0.006, hp = 30 } = {}) {
  let y = hp ? filt(x, 'hp', hp) : x;
  const fl = Math.round(fade * SR); for (let i = 0; i < fl && i < y.length; i++) y[y.length - 1 - i] *= i / fl;
  let m = 0; for (const v of y) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < y.length; i++) y[i] *= peak / m;
  let end = y.length; while (end > SR * 0.02 && Math.abs(y[end - 1]) < 1e-4) end--;      // trim silent tail
  return y.subarray(0, end);
}

// ── recipes ──
const R = {
  click() { const x = buf(0.05), n = white(x.length, 11); each(x, (t, v, i) => n[i] * Math.exp(-t / 0.0007) * 0.9 + Math.sin(TAU * 3200 * t) * Math.exp(-t / 0.004) * 0.5 + Math.sin(TAU * 1150 * t) * Math.exp(-t / 0.01) * 0.25); return filt(x, 'hp', 400); },
  tap() { const x = tone(0.14, (t) => 360 + 210 * Math.exp(-t / 0.012), att(0.0015, 0.022)); add(x, filt(each(white(Math.round(0.03 * SR), 7), (t, v) => v * Math.exp(-t / 0.004)), 'lp', 2600), 0, 0.35); return x; },
  tick() { const x = buf(0.035), n = white(x.length, 3); each(x, (t, v, i) => Math.sin(TAU * 4600 * t) * Math.exp(-t / 0.0025) + Math.sin(TAU * 9200 * t) * Math.exp(-t / 0.001) * 0.4 + n[i] * Math.exp(-t / 0.0004) * 0.3); return filt(x, 'hp', 1500); },
  key() {
    const x = buf(0.12);
    add(x, filt(each(white(Math.round(0.03 * SR), 21), (t, v) => v * Math.exp(-t / 0.006)), 'bp', 2800, 1.2), 0, 1);
    add(x, tone(0.06, 190, dec(0.012)), 0, 0.45);
    add(x, filt(each(white(Math.round(0.02 * SR), 22), (t, v) => v * Math.exp(-t / 0.004)), 'bp', 3800, 1.4), 0.045, 0.35);
    return x;
  },
  pop() { const x = tone(0.22, (t) => 420 * (1 + 1.6 * (1 - Math.exp(-t / 0.01))), att(0.002, 0.034)); add(x, tone(0.16, (t) => 840 * (1 + 1.6 * (1 - Math.exp(-t / 0.01))), att(0.002, 0.02)), 0, 0.15); return x; },
  swish() { const d = 0.26, x = pink(Math.round(d * SR), 5); return filt(each(x, (t, v) => { const p = t / d; return v * Math.pow(Math.sin(Math.PI * Math.pow(p, 0.8)), 2); }), 'bp', (t) => 1400 + 3800 * Math.sin(Math.PI * Math.min(1, t / d)), 0.9); },
  whoosh() {
    const d = 0.62, x = pink(Math.round(d * SR), 9);
    const shaped = each(x, (t, v) => { const p = t / d, a = p < 0.55 ? Math.pow(p / 0.55, 2) : Math.pow(1 - (p - 0.55) / 0.45, 1.6); return v * a; });
    return filt(filt(shaped, 'lp', (t) => { const p = t / d; return p < 0.55 ? 280 + 3300 * Math.pow(p / 0.55, 1.5) : 3580 - 2700 * ((p - 0.55) / 0.45); }, 0.8), 'hp', 120);
  },
  whip() {
    const d = 0.32, x = white(Math.round(d * SR), 13);
    each(x, (t, v) => { const p = t / d; return v * (p < 0.72 ? Math.pow(p / 0.72, 3) : Math.exp(-(p - 0.72) * d / 0.025)); });
    const y = filt(x, 'bp', (t) => 2500 * Math.pow(9000 / 2500, Math.min(1, t / (d * 0.72))), 1.1);
    add(y, filt(each(white(Math.round(0.02 * SR), 14), (t, v) => v * Math.exp(-t / 0.003)), 'hp', 3000), d * 0.7, 0.6);
    return y;
  },
  swipe() { const d = 0.2, x = pink(Math.round(d * SR), 17); return filt(each(x, (t, v) => v * Math.pow(Math.sin(Math.PI * t / d), 2)), 'bp', (t) => 1600 + 1600 * (t / d), 1.5); },
  riser() {
    const d = 1.7, x = pink(Math.round(d * SR), 23);
    const nz = filt(each(x, (t, v) => v * Math.pow(t / d, 2.2)), 'lp', (t) => 300 * Math.pow(20, t / d), 0.9);
    const tn = tone(d, (t) => 180 * Math.pow(5, t / d), (t) => Math.pow(t / d, 2.4) * (0.85 + 0.15 * Math.sin(TAU * (6 + 10 * t / d) * t)), 'saw3');
    return add(nz, filt(tn, 'lp', 2400), 0, 0.35);
  },
  swell() { const d = 1.2, x = white(Math.round(d * SR), 29); return filt(filt(each(x, (t, v) => v * Math.pow(t / d, 2.6)), 'hp', 3000), 'lp', (t) => 6000 + 8000 * (t / d)); },
  impact() {
    const x = buf(1.6);
    add(x, tone(1.6, (t) => 38 + 22 * Math.exp(-t / 0.08), att(0.002, 0.36)), 0, 1);
    add(x, tone(0.4, 110, dec(0.09)), 0, 0.5);
    add(x, filt(each(white(Math.round(0.08 * SR), 31), (t, v) => v * Math.exp(-t / 0.012)), 'lp', 2500), 0, 0.8);
    return reverb(sat(x, 1.6), { mix: 0.12, t60: 1.0, tail: 0.6 });
  },
  thud() { const x = tone(0.4, (t) => 85 + 65 * Math.exp(-t / 0.03), att(0.0015, 0.06)); add(x, filt(each(white(Math.round(0.05 * SR), 37), (t, v) => v * Math.exp(-t / 0.012)), 'lp', 1200), 0, 0.4); return x; },
  drop() { return sat(tone(1.0, (t) => 32 + 108 * Math.exp(-t / 0.22), (t) => Math.min(1, t / 0.005) * Math.exp(-t / 0.45)), 1.3); },
  ding() {
    const f0 = 1318.5, x = buf(2.2);
    [[1, 1, 0.9], [2, 0.25, 0.5], [2.76, 0.35, 0.35], [4.07, 0.12, 0.18]].forEach(([r, a, tau]) => add(x, tone(Math.min(2.2, tau * 6), f0 * r, att(0.002, tau)), 0, a));
    return reverb(x, { mix: 0.15, t60: 1.2, tail: 1 });
  },
  success() {
    const x = buf(1.6), note = (f) => { const n = tone(1.4, f, att(0.002, 0.32)); add(n, tone(1.0, f * 2, att(0.002, 0.18)), 0, 0.2); add(n, tone(0.6, f * 3, att(0.002, 0.1)), 0, 0.08); return n; };
    add(x, note(1046.5), 0, 0.9); add(x, note(1568), 0.11, 1);
    return reverb(x, { mix: 0.14, t60: 1.1, tail: 0.8 });
  },
  error() { const x = buf(1.0); add(x, tone(0.8, 440, att(0.003, 0.16), 'tri'), 0, 1); add(x, tone(0.86, 349.2, att(0.003, 0.18), 'tri'), 0.12, 1); return x; },
  shutter() {
    const x = buf(0.18), burst = (seed, f, tau, len) => filt(each(white(Math.round(len * SR), seed), (t, v) => v * Math.exp(-t / tau)), 'bp', f, 2);
    add(x, burst(41, 3000, 0.004, 0.03), 0, 1); add(x, burst(42, 1200, 0.014, 0.06), 0.012, 0.6); add(x, burst(43, 2600, 0.005, 0.03), 0.085, 0.8);
    return x;
  },
  glitch() {
    const r = seeded(51), x = buf(0.34); let t = 0;
    while (t < 0.3) {
      const len = 0.018 + r() * 0.024, kind = Math.floor(r() * 3), f = 200 + r() * 1800, g = 0.4 + r() * 0.45;
      let seg;
      if (kind === 0) seg = tone(len, f, () => 1, 'square');
      else if (kind === 1) { seg = white(Math.round(len * SR), Math.floor(r() * 1e6)); const hold = 6 + Math.floor(r() * 30); for (let i = 0; i < seg.length; i++) seg[i] = seg[i - (i % hold)]; }
      else seg = tone(len, (tt) => f * (1 + tt * 20), () => 1);
      add(x, seg, t, g); t += len + r() * 0.008;
    }
    return filt(x, 'hp', 150);
  },
  sparkle() {
    const r = seeded(61), x = buf(0.9), scale = [1, 1.125, 1.25, 1.5, 1.667, 2];
    for (let k = 0; k < 22; k++) { const f = 2600 * scale[Math.floor(r() * scale.length)] * (r() < 0.5 ? 1 : 2), at = r() * 0.6; add(x, tone(0.12, f, att(0.001, 0.035)), at, 0.2 + r() * 0.3); }
    return reverb(x, { mix: 0.25, t60: 1.3, tail: 0.8 });
  }
};
const ALIAS = { hit: 'impact', boom: 'impact', rise: 'riser', type: 'key', bell: 'ding', notify: 'ding', camera: 'shutter', whooshes: 'whoosh' };

/** Relative level of each effect in a mix (multiplied by the volume the composition asks for). */
export const GAIN = { click: 0.5, tap: 0.55, tick: 0.32, key: 0.38, pop: 0.5, swish: 0.42, whoosh: 0.55, whip: 0.55, swipe: 0.42, riser: 0.5, swell: 0.45, impact: 0.85, thud: 0.6, drop: 0.6, ding: 0.42, success: 0.48, error: 0.42, shutter: 0.5, glitch: 0.42, sparkle: 0.36 };
export const SFX_NAMES = Object.keys(R);
export const resolveSfx = (name) => (R[name] ? name : ALIAS[name] && R[ALIAS[name]] ? ALIAS[name] : null);

export function renderSfx(name) { const k = resolveSfx(name); if (!k) return null; return finish(R[k]()); }

export function wavBytes(samples, channels = 1, sr = SR) {
  const n = samples.length, out = Buffer.alloc(44 + n * 2);
  out.write('RIFF', 0); out.writeUInt32LE(36 + n * 2, 4); out.write('WAVE', 8); out.write('fmt ', 12);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(channels, 22); out.writeUInt32LE(sr, 24); out.writeUInt32LE(sr * channels * 2, 28); out.writeUInt16LE(channels * 2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) out.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return out;
}
/** 16-bit PCM WAV → { sr, channels, data: Float32Array (interleaved) }. */
export function readWav(file) {
  const b = fs.readFileSync(file); let p = 12, fmt = null;
  while (p + 8 <= b.length) {
    const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { channels: b.readUInt16LE(p + 10), sr: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === 'data' && fmt && fmt.bits === 16) { const n = size / 2, data = new Float32Array(n); for (let i = 0; i < n; i++) data[i] = b.readInt16LE(p + 8 + i * 2) / 32768; return { sr: fmt.sr, channels: fmt.channels, data }; }
    p += 8 + size + (size % 2);
  }
  throw new Error('읽을 수 없는 WAV: ' + file);
}

/** The library as WAV files in engine/sfx (built once), copied into <dir>/_motion/sfx. */
export function ensureSfx(dest) {
  const lib = path.join(ENGINE, 'sfx'), stamp = path.join(lib, 'VERSION');
  if (!fs.existsSync(stamp) || fs.readFileSync(stamp, 'utf8').trim() !== VERSION) {
    ensureDir(lib);
    for (const name of SFX_NAMES) fs.writeFileSync(path.join(lib, name + '.wav'), wavBytes(renderSfx(name)));
    for (const [a, k] of Object.entries(ALIAS)) fs.copyFileSync(path.join(lib, k + '.wav'), path.join(lib, a + '.wav'));
    fs.writeFileSync(stamp, VERSION + '\n');
  }
  if (!dest) return lib;
  const mark = path.join(dest, 'VERSION');
  if (fs.existsSync(mark) && fs.readFileSync(mark, 'utf8').trim() === VERSION) return dest;
  ensureDir(dest);
  for (const f of fs.readdirSync(lib)) fs.copyFileSync(path.join(lib, f), path.join(dest, f));
  return dest;
}
