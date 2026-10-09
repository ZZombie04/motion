/**
 * Captions from a script: plan the timing from speaking speed, or align it to a recorded voice using its pauses.
 * Korean is syllable-timed, so words inside a sentence are spread by syllable count — close enough for word-by-word highlighting.
 * Output: SRT, VTT, or JSON with word timings ({ cues: [{ start, end, text, words: [{ w, t, e }] }] }).
 */
import fs from 'node:fs';
import { decode } from './audio.mjs';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
// spoken length of a token as Korean narration reads it: 한글 = 1 per syllable · acronyms letter by letter (AI = 에이아이 = 4)
// · English words by vowel groups · numbers the Sino-Korean way (120 = 백이십 = 3, 2026 = 이천이십육 = 5, 3.5 = 삼 점 오) · % = 퍼센트
const LETTER = { A: 2, B: 1, C: 1, D: 1, E: 1, F: 2, G: 1, H: 3, I: 2, J: 2, K: 2, L: 1, M: 1, N: 1, O: 1, P: 1, Q: 1, R: 1, S: 2, T: 1, U: 1, V: 2, W: 3, X: 2, Y: 2, Z: 1 };
function latinSyl(s) {
  if (/^[A-Z]{1,5}$/.test(s)) return [...s].reduce((n, ch) => n + LETTER[ch], 0);
  // an English word as Korean says it (Claude = 클로드 3, graphics = 그래픽스 4, chat = 챗 1): vowel groups,
  // plus a 으-syllable for each consonant that cannot close a syllable (clusters, final d/s/f…)
  const w = s.toLowerCase().replace(/x/g, 'ks').replace(/ch|sh|th|ph|ck|ng|qu|wh/g, (m) => ({ ch: 'C', sh: 'S', th: 'T', ph: 'F', ck: 'K', ng: 'N', qu: 'Q', wh: 'W' })[m]).replace(/([^aeiouy])e$/, '$1');
  const runs = w.match(/[aeiouy]+|[^aeiouy]+/g) || [];
  let n = Math.max(1, runs.filter((r) => /^[aeiouy]/.test(r)).length);
  runs.forEach((r, i) => {
    if (/^[aeiouy]/.test(r) || runs.length === 1) return;
    if (i === 0) n += r.length - 1;
    else if (i === runs.length - 1) n += /^[kcptmnlKN]/.test(r) ? r.length - 1 : r.length;
    else n += Math.max(0, r.length - 2);
  });
  return n;
}
function numberSyl(s) {
  const [ip, fp] = s.replace(/,/g, '').split('.');
  let n = 0;
  const digits = ip.replace(/^0+(?=\d)/, '');
  if (/^0+$/.test(digits)) n = 1;
  else {
    const groups = []; for (let i = digits.length; i > 0; i -= 4) groups.unshift(digits.slice(Math.max(0, i - 4), i));
    groups.forEach((g, gi) => {
      let gn = 0;
      for (let k = 0; k < g.length; k++) { const d = +g[k], place = g.length - 1 - k; if (d) gn += (d === 1 && place > 0 ? 0 : 1) + (place > 0 ? 1 : 0); }
      const unit = gi < groups.length - 1;                   // 만 · 억 · 조 (10000 = 만, not 일만)
      if (gn) n += (unit && +g === 1 ? 0 : gn) + (unit ? 1 : 0);
    });
  }
  return n + (fp ? 1 + fp.length : 0);
}
export function syllables(w) {
  let n = 0;
  for (const m of String(w).matchAll(/[가-힣]+|[A-Za-z]+|[0-9][0-9,]*(?:\.[0-9]+)?|%/g)) {
    const s = m[0];
    n += /^[가-힣]/.test(s) ? s.length : /^[A-Za-z]/.test(s) ? latinSyl(s) : s === '%' ? 3 : numberSyl(s);
  }
  return Math.max(0.6, n);
}
// planning (no recording) adds the pause a comma or full stop will take; aligning measures pauses, so it uses syllables alone
const weight = (w) => syllables(w) + (/[,.!?…:;]$/.test(w) ? 0.8 : 0);

/** Split a script into caption-sized chunks: sentences first, then at commas / word gaps so no chunk is longer than maxChars. */
export function chunk(script, maxChars = 22) {
  const sentences = String(script).replace(/\r/g, '').split(/\n+|(?<=[.!?…])\s+|(?<=다\.)/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const s of sentences) {
    if (s.replace(/\s/g, '').length <= maxChars) { out.push(s); continue; }
    const words = s.split(/\s+/); let cur = '';
    for (const w of words) {
      const next = cur ? cur + ' ' + w : w;
      if (next.replace(/\s/g, '').length > maxChars && cur) { out.push(cur); cur = w; }
      else { cur = next; if (/[,，]$/.test(w) && cur.replace(/\s/g, '').length > maxChars * 0.55) { out.push(cur); cur = ''; } }
    }
    if (cur) out.push(cur);
  }
  return out;
}
function wordsIn(text, start, end, speech, aligned) {
  const ws = text.split(/\s+/).filter(Boolean), wt = ws.map(aligned ? syllables : weight), tot = wt.reduce((a, b) => a + b, 0) || 1;
  // map cumulative weight onto speaking time only: a word that follows a pause starts after it, a word before a pause ends before it
  const segs = (speech || []).map(([a, b]) => [Math.max(a, start), Math.min(b, end)]).filter(([a, b]) => b - a > 0.02);
  const spoken = segs.length ? segs : [[start, end]], clock = speechClock(spoken), T = clock.total, n = ws.length;
  // boundaries in speaking time, by weight; a pause inside the cue pulls the nearest word boundary onto itself
  // (people pause between words), and the words between two anchors share that stretch by weight
  const cw = [0]; for (const x of wt) cw.push(cw[cw.length - 1] + x);
  const pos = cw.map((c) => T * c / tot), anchor = new Map([[0, 0], [n, T]]);
  if (aligned && n > 1) {
    let run = 0; const pauses = [];
    for (let j = 0; j < spoken.length - 1; j++) { run += spoken[j][1] - spoken[j][0]; if (spoken[j + 1][0] - spoken[j][1] >= 0.12) pauses.push(run); }
    const tol = 0.6 * T / n; let last = 0;
    for (const p of pauses) {
      let best = -1; for (let i = last + 1; i < n; i++) if (best < 0 || Math.abs(pos[i] - p) < Math.abs(pos[best] - p)) best = i;
      if (best > 0 && Math.abs(pos[best] - p) <= tol) { anchor.set(best, p); last = best; }
    }
    const keys = [...anchor.keys()].sort((a, b) => a - b);
    for (let k = 0; k < keys.length - 1; k++) {
      const a = keys[k], b = keys[k + 1], A = anchor.get(a), B = anchor.get(b);
      for (let i = a; i <= b; i++) pos[i] = cw[b] > cw[a] ? A + (B - A) * (cw[i] - cw[a]) / (cw[b] - cw[a]) : A;
    }
  }
  return ws.map((w, i) => ({ w, t: +clock.start(pos[i]).toFixed(3), e: +clock.end(pos[i + 1]).toFixed(3) }));
}

/** Timing from speaking speed alone (no recording yet): rate in syllables per second (Korean narration ≈ 5). */
export function planCaptions(script, { rate = 5, start = 0.4, gap = 0.25, maxChars = 22 } = {}) {
  let t = start;
  return chunk(script, maxChars).map((text) => {
    const syl = text.split(/\s+/).reduce((s, w) => s + weight(w), 0), dur = Math.max(0.9, syl / rate);
    const cue = { start: +t.toFixed(3), end: +(t + dur).toFixed(3), text };
    cue.words = wordsIn(text, cue.start, cue.end);
    t += dur + gap + (/[.!?…]$/.test(text) ? 0.15 : 0);
    return cue;
  });
}

/** Speech and pause segments of a recording (10 ms frames, adaptive threshold). */
export function speechSegments(file) {
  const rate = 16000, hop = 160, x = decode(file, { rate, channels: 1 }), n = Math.floor(x.length / hop), db = new Float32Array(n);
  for (let i = 0; i < n; i++) { let s = 0; for (let k = i * hop; k < (i + 1) * hop; k++) s += x[k] * x[k]; db[i] = 10 * Math.log10(s / hop + 1e-10); }
  const sorted = Array.from(db).sort((a, b) => a - b), floor = sorted[Math.floor(n * 0.1)] || -80, peak = sorted[Math.floor(n * 0.98)] || -10;
  const th = Math.max(floor + 0.25 * (peak - floor), floor + 8, -55);
  const on = Array.from(db, (v) => v > th);
  // close gaps shorter than 0.16 s, drop blips shorter than 0.08 s
  const segs = []; let i = 0;
  while (i < n) { if (!on[i]) { i++; continue; } let j = i; while (j < n && on[j]) j++; segs.push([i, j]); i = j; }
  const merged = [];
  for (const s of segs) { const last = merged[merged.length - 1]; if (last && s[0] - last[1] < 16) last[1] = s[1]; else merged.push(s.slice()); }
  return { duration: x.length / rate, speech: merged.filter(([a, b]) => b - a >= 8).map(([a, b]) => [a / 100, b / 100]) };
}

/** Sentences of a script (line breaks and sentence-final punctuation). */
function sentencesOf(script) { return String(script).replace(/\r/g, '').split(/\n+|(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean); }
/** Position along the speaking time (seconds of speech) → clock time; starts skip ahead over pauses, ends stay before them. */
function speechClock(segs) {
  const total = segs.reduce((s, [a, b]) => s + b - a, 0);
  const pos = (need, start) => { for (let i = 0; i < segs.length; i++) { const [a, b] = segs[i], len = b - a; if (need < len - 1e-6 || (!start && need <= len + 1e-6) || i === segs.length - 1) return a + Math.min(need, len); need -= len; } return segs[segs.length - 1][1]; };
  return { total, start: (s) => pos(s, true), end: (s) => pos(s, false) };
}

/**
 * Align a script to a recording. Sentences go to pauses first (dynamic programming: each sentence's speaking time should match
 * its syllable share; longer pauses are better boundaries), then each sentence is cut into caption-sized chunks by weight,
 * and words spread over the speaking time inside each chunk.
 */
export function alignCaptions(script, audioFile, { maxChars = 22, tail = 0.12 } = {}) {
  const { speech, duration } = speechSegments(audioFile);
  if (!speech.length) throw new Error('목소리 구간을 찾지 못했습니다(무음이거나 너무 작습니다): ' + audioFile);
  const sents = sentencesOf(script), K = sents.length, S = speech.length;
  const w = sents.map((c) => c.split(/\s+/).reduce((s, x) => s + syllables(x), 0)), W = w.reduce((a, b) => a + b, 0) || 1;
  const cum = [0]; for (const [a, b] of speech) cum.push(cum[cum.length - 1] + (b - a));
  const total = cum[S], expect = (i) => total * w[i] / W, pause = (k) => (k > 0 && k < S ? speech[k][0] - speech[k - 1][1] : 1);
  let spans;
  if (K <= S) {
    const INF = 1e18, cost = Array.from({ length: K + 1 }, () => new Float64Array(S + 1).fill(INF)), from = Array.from({ length: K + 1 }, () => new Int32Array(S + 1).fill(-1));
    cost[0][0] = 0;
    for (let i = 1; i <= K; i++) for (let k = i; k <= S - (K - i); k++) for (let j = i - 1; j < k; j++) {
      if (cost[i - 1][j] >= INF) continue;
      const e = expect(i - 1), dev = (cum[k] - cum[j] - e) / Math.max(0.6, e);
      const c = cost[i - 1][j] + dev * dev - (i < K ? 0.6 * Math.min(1, pause(k) / 0.5) : 0);
      if (c < cost[i][k]) { cost[i][k] = c; from[i][k] = j; }
    }
    const cut = [S]; for (let i = K, k = S; i > 0; i--) { k = from[i][k]; cut.unshift(k); }
    spans = sents.map((text, i) => ({ text, segs: speech.slice(cut[i], cut[i + 1]) }));
  } else {
    // more sentences than pauses: share the speaking time by weight
    const clock = speechClock(speech); let acc = 0;
    spans = sents.map((text, i) => { const a = clock.start(total * acc / W); acc += w[i]; const b = clock.end(total * acc / W); return { text, segs: speech.map(([x, y]) => [Math.max(x, a), Math.min(y, b)]).filter(([x, y]) => y - x > 0.02) }; });
  }
  const cues = [];
  for (const sp of spans) {
    if (!sp.segs.length) continue;
    const parts = chunk(sp.text, maxChars), pw = parts.map((p) => p.split(/\s+/).reduce((s, x) => s + syllables(x), 0)), PW = pw.reduce((a, b) => a + b, 0) || 1;
    const clock = speechClock(sp.segs); let acc = 0;
    parts.forEach((text, i) => {
      const a = clock.start(clock.total * acc / PW); acc += pw[i]; const b = clock.end(clock.total * acc / PW);
      cues.push({ start: a, end: b + tail, text, segs: sp.segs.map(([x, y]) => [Math.max(x, a), Math.min(y, b)]).filter(([x, y]) => y - x > 0.02) });
    });
  }
  return cues.map((c, i) => {
    const end = Math.min(c.end, i + 1 < cues.length ? cues[i + 1].start - 0.02 : duration);
    return { start: +c.start.toFixed(3), end: +end.toFixed(3), text: c.text, words: wordsIn(c.text, c.start, end, c.segs, true) };
  });
}

const stamp = (t, sep = ',') => { const ms = Math.round(Math.max(0, t) * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60; return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${sep}${String(ms % 1000).padStart(3, '0')}`; };
export const toSrt = (cues) => cues.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}\n`).join('\n');
export const toVtt = (cues) => 'WEBVTT\n\n' + cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n');
export const toJson = (cues) => JSON.stringify({ cues }, null, 1);

export function parseSubtitles(text) {
  const s = String(text).replace(/\r/g, '').replace(/^﻿/, '').trim();
  if (/^[\[{]/.test(s)) { const j = JSON.parse(s); return Array.isArray(j) ? j : j.cues || []; }
  const ts = (x) => { const p = x.trim().split(/\s+/)[0].replace(',', '.').split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : p[0]; };
  return s.split(/\n\s*\n/).map((b) => { const L = b.split('\n').filter((l) => l.trim() && !/^WEBVTT|^NOTE\b/.test(l)); const i = L.findIndex((l) => l.includes('-->')); if (i < 0) return null; const [a, z] = L[i].split('-->'); return { start: ts(a), end: ts(z), text: L.slice(i + 1).join('\n').trim() }; }).filter((c) => c && c.text);
}

export function writeCaptions(cues, out) {
  const body = /\.vtt$/i.test(out) ? toVtt(cues) : /\.json$/i.test(out) ? toJson(cues) : toSrt(cues);
  fs.writeFileSync(out, body);
  return out;
}
