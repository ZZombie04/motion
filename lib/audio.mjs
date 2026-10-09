/**
 * Audio: measure a song (loudness envelopes, onsets, tempo, beats, downbeats) so visuals can lock to it,
 * and mix the sound a composition plans (music, voice, effects) into one track for the renderer.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireFfmpeg, findFfmpeg } from './ffmpeg.mjs';
import { filt, readWav, GAIN, resolveSfx, ensureSfx, wavBytes } from './sfx.mjs';

export const audioKey = (src) => String(src).split(/[?#]/)[0].replace(/^\.?\//, '').replace(/[^A-Za-z0-9._-]+/g, '_');
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Decode any audio (or video's audio) to float samples. channels 1 → mono, 2 → interleaved stereo. */
export function decode(file, { rate = 48000, channels = 1, start = 0, duration } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error', '-nostdin'];
  if (start > 0) args.push('-ss', String(start));
  args.push('-i', file);
  if (duration != null) args.push('-t', String(Math.max(0.01, duration)));
  args.push('-vn', '-ac', String(channels), '-ar', String(rate), '-f', 'f32le', 'pipe:1');
  const r = spawnSync(requireFfmpeg(), args, { maxBuffer: 1024 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error('오디오를 읽지 못했습니다: ' + file + '\n' + String(r.stderr || '').trim());
  const b = r.stdout;
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength - (b.byteLength % 4)));
}

export function probeDuration(file) {
  const ffprobe = (findFfmpeg() || 'ffmpeg').replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  const r = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? +r.stdout.trim() || 0 : 0;
}

// ── analysis ──
const RATE = 24000, HOP = 240;            // 100 envelope frames per second
function rms(x, n) { const out = new Float32Array(n); for (let i = 0; i < n; i++) { let s = 0; const a = i * HOP, b = Math.min(x.length, a + HOP * 2); for (let k = a; k < b; k++) s += x[k] * x[k]; out[i] = Math.sqrt(s / Math.max(1, b - a)); } return out; }
function pct(arr, p) { const s = Array.from(arr).sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))]; }
function to8(env) {
  const db = Array.from(env, (v) => 20 * Math.log10(v + 1e-9)), ref = pct(db, 0.98);
  return db.map((v) => Math.round(255 * clamp((v - (ref - 40)) / 40, 0, 1)));
}
/** Tempo from the autocorrelation of the onset envelope, with a gentle preference for 90–140 BPM. */
function tempo(odf) {
  const n = odf.length, mean = odf.reduce((a, b) => a + b, 0) / Math.max(1, n), x = odf.map((v) => v - mean);
  let best = 0, bestLag = 50; const score = [];
  for (let lag = 30; lag <= 100; lag++) {
    let s = 0; for (let i = lag; i < n; i++) s += x[i] * x[i - lag];
    const bpm = 6000 / lag, w = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 118) / 0.9, 2));
    score[lag] = s; if (s * w > best) { best = s * w; bestLag = lag; }
  }
  let lag = bestLag;
  if (score[bestLag - 1] != null && score[bestLag + 1] != null) { const a = score[bestLag - 1], b = score[bestLag], c = score[bestLag + 1], d = a - 2 * b + c; if (d < 0) lag = bestLag + 0.5 * (a - c) / d; }
  return 6000 / lag;
}
/** Dynamic-programming beat tracker (Ellis 2007): beats that sit on onsets and keep a steady period. */
function trackBeats(odf, period, until) {
  const n = odf.length, score = new Float64Array(n), back = new Int32Array(n).fill(-1), alpha = 100;
  const sd = Math.sqrt(odf.reduce((a, v) => a + v * v, 0) / Math.max(1, n)) || 1, o = odf.map((v) => v / sd);
  for (let i = 0; i < n; i++) {
    let best = -Infinity, arg = -1;
    for (let j = Math.max(0, Math.round(i - 2 * period)); j <= i - Math.round(period / 2); j++) { const c = score[j] - alpha * Math.pow(Math.log((i - j) / period), 2); if (c > best) { best = c; arg = j; } }
    // a chain may also start fresh here: the first real beat must not pay for the beats that never came before it
    if (arg >= 0 && best > 0) { score[i] = o[i] + best; back[i] = arg; } else { score[i] = o[i]; back[i] = -1; }
  }
  // the last beat sits near the last real attack, not in a silent tail
  const last = until == null ? n - 1 : Math.min(n - 1, until);
  let end = last, top = -Infinity;
  for (let i = Math.max(0, Math.round(last - period)); i <= Math.min(n - 1, Math.round(last + period * 0.5)); i++) if (score[i] > top) { top = score[i]; end = i; }
  const beats = []; for (let i = end; i >= 0; i = back[i]) beats.push(i);
  return beats.reverse();
}
/** Analyse a song: envelopes (0–255 at 100 Hz), onsets, tempo, beats and downbeats (seconds). */
export function analyze(file) {
  const x = decode(file, { rate: RATE, channels: 1 }), n = Math.floor(x.length / HOP), duration = x.length / RATE;
  if (n < 10) return { v: 1, duration, rate: 100, level: [], low: [], high: [], bpm: 0, beats: [], downbeats: [], onsets: [] };
  const lo = filt(x, 'lp', 150, 0.707, RATE), hi = filt(x, 'hp', 3000, 0.707, RATE), mid = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) mid[i] = x[i] - lo[i] - hi[i];
  const L = rms(x, n), Lo = rms(lo, n), Hi = rms(hi, n), Mi = rms(mid, n);
  const lg = (e) => Array.from(e, (v) => Math.log(1e-5 + v));
  const a = lg(Lo), b = lg(Mi), c = lg(Hi), odf = new Array(n).fill(0);
  for (let i = 1; i < n; i++) odf[i] = Math.max(0, a[i] - a[i - 1]) + 0.8 * Math.max(0, b[i] - b[i - 1]) + 0.6 * Math.max(0, c[i] - c[i - 1]);
  // remove the slow trend (0.3 s moving average) so only attacks remain
  const W = 15, sm = odf.map((v, i) => { let s = 0, k = 0; for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) { s += odf[j]; k++; } return Math.max(0, v - s / k); });
  // the very first attack out of silence is an outlier (log energy jumps from the floor) — cap it so it cannot dominate
  const pos = sm.filter((v) => v > 0), p95 = pos.length ? pct(pos, 0.95) : 1;
  for (let i = 0; i < n; i++) sm[i] = Math.min(sm[i], p95 * 1.5);
  const bpm = tempo(sm), period = 6000 / bpm;
  // envelope frame i spans [i, i+2) hops, so an attack first shows one frame early: report frame + 1
  let first = -1, lastOn = -1; for (let i = 0; i < n; i++) if (sm[i] > p95 * 0.4) { if (first < 0) first = i; lastOn = i; }
  const beatIdx = trackBeats(sm, period, lastOn < 0 ? null : lastOn).filter((i) => first < 0 || (i >= first - period * 0.5 && i <= lastOn + period));
  const beats = beatIdx.map((i) => +((i + 1) / 100).toFixed(3));
  // downbeats: kick-like beats (a low-band attack without a snare's mid-band attack) are 1 and 3 of a bar;
  // 1 and 3 look alike, so when the song's first beat is nearly as strong it wins (songs start on 1)
  const kick = beatIdx.map((i) => { let dl = 0, dm = 0; for (let j = Math.max(1, i - 2); j <= Math.min(n - 1, i + 3); j++) { dl = Math.max(dl, a[j] - a[j - 1]); dm = Math.max(dm, b[j] - b[j - 1]); } return dl - 0.7 * dm; });
  const ps = [0, 0, 0, 0]; kick.forEach((v, k) => { ps[k % 4] += v; });
  let phase = ps.indexOf(Math.max(...ps));
  if (phase !== 0 && ps[0] >= ps[phase] - Math.abs(ps[phase]) * 0.15) phase = 0;
  const downbeats = beats.filter((_, k) => k % 4 === phase);
  // onsets: local peaks of the attack envelope well above its neighbourhood
  const onsets = []; let last = -100;
  for (let i = 2; i < n - 2; i++) {
    const v = sm[i]; if (v <= 0) continue;
    let mx = true; for (let j = i - 4; j <= i + 4; j++) if (j !== i && j >= 0 && j < n && sm[j] > v) { mx = false; break; }
    if (!mx) continue;
    let s = 0, k = 0; for (let j = Math.max(0, i - 50); j <= Math.min(n - 1, i + 50); j++) { s += sm[j]; k++; }
    if (v > (s / k) * 2.2 && i - last >= 7) { onsets.push(+((i + 1) / 100).toFixed(3)); last = i; }
  }
  let peak = 0; for (const v of x) peak = Math.max(peak, Math.abs(v));
  return { v: 1, duration: +duration.toFixed(3), rate: 100, bpm: +bpm.toFixed(1), beats, downbeats, onsets, level: to8(L), low: to8(Lo), high: to8(Hi), peak: +peak.toFixed(3) };
}

/** Analysis cached next to the composition (_motion/audio/<key>.json), refreshed when the file changes. */
export function ensureAnalysis(file, outDir, key) {
  const st = fs.statSync(file), stamp = 'a2:' + st.size + ':' + Math.floor(st.mtimeMs), out = path.join(outDir, key + '.json');   // a2 = analysis version
  if (fs.existsSync(out)) { try { if (JSON.parse(fs.readFileSync(out, 'utf8')).stamp === stamp) return out; } catch { /* rebuild */ } }
  const a = analyze(file); a.stamp = stamp; a.src = path.basename(file);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(out, JSON.stringify(a));
  return out;
}

// ── mixing ──
const MSR = 48000;
function loadSfx(name, dir) {
  const k = resolveSfx(name);
  if (k) { const w = readWav(path.join(ensureSfx(), k + '.wav')); return { data: w.data, gain: GAIN[k] || 0.5 }; }
  const f = path.resolve(dir, name);
  if (fs.existsSync(f)) return { data: decode(f, { rate: MSR, channels: 1 }), gain: 1 };
  return null;
}
/** Envelope follower (attack/release in seconds) on |x|, stereo interleaved input → per-sample envelope. */
function follow(x, attack, release) {
  const n = x.length / 2, env = new Float32Array(n), ka = Math.exp(-1 / (attack * MSR)), kr = Math.exp(-1 / (release * MSR)); let e = 0;
  for (let i = 0; i < n; i++) { const v = Math.max(Math.abs(x[2 * i]), Math.abs(x[2 * i + 1])); e = v > e ? ka * e + (1 - ka) * v : kr * e + (1 - kr) * v; env[i] = e; }
  return env;
}
/**
 * Mix a composition's sound plan over [t0, t1] into a 48 kHz stereo WAV. Returns { file, music, voice, sfx, missing } or null when silent.
 * Music ducks under voice; effects sit on their own bus; a look-ahead limiter keeps the peak under -1 dBFS.
 */
export function mixPlan(plan, { dir, t0 = 0, t1, extraMusic } = {}) {
  const tracks = (plan && plan.tracks || []).slice(), effects = (plan && plan.sfx || []).slice();
  if (extraMusic) tracks.push({ src: path.resolve(extraMusic), at: 0, from: 0, end: null, volume: 1, fadeIn: 0.05, fadeOut: 0.7, role: 'music', duck: 0.55, loop: false });
  if (!tracks.length && !effects.length) return null;
  const D = plan && plan.duration || t1, end = Math.min(t1 ?? D, D ?? t1), N = Math.max(1, Math.ceil((end - t0) * MSR));
  const buses = { music: new Float32Array(N * 2), voice: new Float32Array(N * 2), sfx: new Float32Array(N * 2) }, missing = [];
  let duck = 0;
  for (const tr of tracks) {
    const file = path.isAbsolute(tr.src) ? tr.src : path.resolve(dir, tr.src);
    if (!fs.existsSync(file)) { missing.push(tr.src); continue; }
    const fileDur = probeDuration(file), stopFile = tr.loop ? Infinity : tr.at + Math.max(0, fileDur - (tr.from || 0));
    const a = Math.max(tr.at, t0), b = Math.min(end, tr.end ?? Infinity, stopFile); if (b <= a) continue;
    const span = tr.loop ? Math.max(0.05, fileDur - (tr.from || 0)) : b - tr.at;
    const src = decode(file, { rate: MSR, channels: 2, start: tr.from || 0, duration: tr.loop ? span : Math.min(span, fileDur) });
    const bus = buses[tr.role === 'voice' ? 'voice' : tr.role === 'sfx' ? 'sfx' : 'music'], frames = src.length / 2;
    const fin = tr.fadeIn || 0, fout = tr.fadeOut || 0, trackEnd = Math.min(b, tr.end ?? Infinity), vol = tr.volume == null ? 1 : tr.volume;
    if ((tr.role || 'music') === 'music') duck = Math.max(duck, tr.duck == null ? 0.55 : tr.duck);
    for (let i = Math.round((a - t0) * MSR); i < Math.round((b - t0) * MSR) && i < N; i++) {
      const t = t0 + i / MSR, local = t - tr.at; let k = Math.floor(local * MSR); if (tr.loop) k %= frames; if (k < 0 || k >= frames) continue;
      let g = vol; if (fin > 0 && local < fin) g *= local / fin; if (fout > 0 && trackEnd - t < fout) g *= Math.max(0, (trackEnd - t) / fout);
      bus[2 * i] += src[2 * k] * g; bus[2 * i + 1] += src[2 * k + 1] * g;
    }
  }
  const cache = {};
  for (const e of effects) {
    if (e.at < t0 - 3 || e.at >= end) continue;
    const s = cache[e.name] || (cache[e.name] = loadSfx(e.name, dir)); if (!s) { missing.push(e.name); continue; }
    const rate = e.pitch || 1, g = s.gain * (e.volume == null ? 1 : e.volume), pan = clamp(e.pan || 0, -1, 1), gl = Math.cos((pan + 1) * Math.PI / 4) * Math.SQRT2, gr = Math.sin((pan + 1) * Math.PI / 4) * Math.SQRT2;
    const o = Math.round((e.at - t0) * MSR), len = Math.floor(s.data.length / rate);
    for (let i = 0; i < len; i++) {
      const j = o + i; if (j < 0) continue; if (j >= N) break;
      const p = i * rate, k = Math.floor(p), f = p - k, v = (s.data[k] + ((s.data[k + 1] ?? 0) - s.data[k]) * f) * g;
      buses.sfx[2 * j] += v * gl * 0.7071; buses.sfx[2 * j + 1] += v * gr * 0.7071;
    }
  }
  // music ducks under the voice (smooth, like a sidechain compressor)
  const hasVoice = buses.voice.some((v) => v !== 0), hasMusic = buses.music.some((v) => v !== 0), hasSfx = buses.sfx.some((v) => v !== 0);
  if (hasVoice && hasMusic && duck > 0) {
    const env = follow(buses.voice, 0.015, 0.35);
    for (let i = 0; i < N; i++) { const g = 1 - duck * clamp(env[i] / 0.06, 0, 1); buses.music[2 * i] *= g; buses.music[2 * i + 1] *= g; }
  }
  const out = new Float32Array(N * 2);
  for (let i = 0; i < out.length; i++) out[i] = buses.music[i] * 0.9 + buses.voice[i] + buses.sfx[i] * 0.9;
  // look-ahead peak limiter at -1 dBFS
  const ceil = 0.891, look = Math.round(0.005 * MSR), rel = Math.exp(-1 / (0.08 * MSR)), gain = new Float32Array(N); let gcur = 1;
  const need = new Float32Array(N); for (let i = 0; i < N; i++) { const p = Math.max(Math.abs(out[2 * i]), Math.abs(out[2 * i + 1])); need[i] = p > ceil ? ceil / p : 1; }
  const minAhead = new Float32Array(N); { const dq = []; for (let i = N - 1; i >= 0; i--) { while (dq.length && need[dq[dq.length - 1]] >= need[i]) dq.pop(); dq.push(i); while (dq[0] > i + look) dq.shift(); minAhead[i] = need[dq[0]]; } }
  for (let i = 0; i < N; i++) { const tgt = minAhead[i]; gcur = tgt < gcur ? tgt : rel * gcur + (1 - rel) * tgt; gain[i] = gcur; }
  for (let i = 0; i < N; i++) { out[2 * i] *= gain[i]; out[2 * i + 1] *= gain[i]; }
  const file = path.join(os.tmpdir(), `motion-mix-${process.pid}-${Date.now()}.wav`);
  fs.writeFileSync(file, wavBytes(out, 2, MSR));
  return { file, music: hasMusic, voice: hasVoice, sfx: hasSfx, missing, duration: N / MSR };
}

/** Two-pass loudness: measure the mix, then return an ffmpeg filter that brings it to `target` LUFS linearly. */
/**
 * Effects-only mixes: one gain toward the target loudness. Sparse hits measured by a loudness meter would make loudnorm pump,
 * so the gain is linear; when the peaks would pass the ceiling, a fast look-ahead limiter takes at most `squeeze` dB off
 * the loudest hits (impacts keep their snap, the quiet ticks become audible). Typical result −16 to −19 LUFS.
 */
export function gainFilter(wav, target = -14, ceiling = -1.5, squeeze = 8) {
  const r = spawnSync(requireFfmpeg(), ['-hide_banner', '-nostdin', '-i', wav, '-af', `loudnorm=I=${target}:TP=-2:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const m = /\{[\s\S]*"input_i"[\s\S]*?\}/.exec(r.stderr || '');
  if (!m) return null;
  const j = JSON.parse(m[0]), I = +j.input_i, TP = +j.input_tp;
  if (!isFinite(I) || I < -60 || !isFinite(TP)) return null;
  const g = Math.min(target - I, ceiling - TP + squeeze);
  if (Math.abs(g) < 0.3) return null;
  const vol = `volume=${g.toFixed(2)}dB`;
  return TP + g > ceiling ? `${vol},alimiter=limit=${Math.pow(10, (ceiling - 0.5) / 20).toFixed(4)}:attack=1.5:release=80:level=0` : vol;
}

export function loudnessFilter(wav, target = -14) {
  const r = spawnSync(requireFfmpeg(), ['-hide_banner', '-nostdin', '-i', wav, '-af', `loudnorm=I=${target}:TP=-2:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  const m = /\{[\s\S]*"input_i"[\s\S]*?\}/.exec(r.stderr || '');
  if (!m) return null;
  const j = JSON.parse(m[0]);
  if (!isFinite(+j.input_i) || +j.input_i < -60) return null;           // (near) silence: leave it alone
  return `loudnorm=I=${target}:TP=-2:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true:print_format=none`;
}
