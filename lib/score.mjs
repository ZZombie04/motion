/**
 * Director's score: a 100-point rubric measured from the frames, so "is it good enough?" has a number and a list of fixes.
 *   hook 15 · readability 20 · rhythm 20 · motion 15 · composition 15 · ending 10 · sound 5
 * plus a slideshow risk (long stretches where nothing new happens).
 * Calibrated on 48×48 greyscale frames 0.1 s apart: drift/grain ≈ 0.5–2, reveals 2–15, cuts 20+.
 */
import { check, decodeThumbs, grayDiff } from './check.mjs';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export async function score(file, { step = 0.1, platform, vars } = {}) {
  const r = await check(file, { step, platform, thumbs: true, vars });
  const S = r._samples, X = r._extra, D = r.meta.duration, W = r.meta.width, H = r.meta.height, portrait = H > W;
  const g = await decodeThumbs(X.thumbs), diff = [0];
  for (let i = 1; i < g.length; i++) diff.push(grayDiff(g[i], g[i - 1]));
  const textKey = (s) => s.items.filter((i) => i.op >= 0.6 && !i.deco && i.vis > 0.5).map((i) => i.id + ':' + i.text).sort().join('|');
  const keys = S.map(textKey), seen = new Set(), appear = S.map(() => false);
  S.forEach((s, k) => s.items.forEach((i) => { if (i.op >= 0.85 && !i.deco && !seen.has(i.id)) { seen.add(i.id); appear[k] = true; } }));
  const moving = S.map((s, k) => k > 0 && (diff[k] >= 0.4 || keys[k] !== keys[k - 1]));            // anything changes (drift counts)
  const active = S.map((s, k) => k > 0 && (diff[k] >= 2.5 || keys[k] !== keys[k - 1]));            // something new is shown
  // a word being spoken and lit in word-by-word captions is new information, but too small for the 48 px frames: read it from the engine
  const capWords = []; ((X.events && X.events.captions) || []).forEach((c) => (c.words || []).forEach((w) => capWords.push(Array.isArray(w) ? w : [w, w + 0.3])));
  if (capWords.length) S.forEach((s, k) => { if (k && capWords.some(([a, b]) => s.t >= a - 1e-6 && s.t < b)) { active[k] = true; moving[k] = true; } });
  // visual events: big frame changes (merged within 0.3 s) and new text blocks
  // a long continuous move (a camera tour) is one event when it starts and then one a second, not one every few frames
  const events = []; const push = (t) => { if (!events.length || t - events[events.length - 1] > 0.3) events.push(t); };
  let runFrom = -1;
  S.forEach((s, k) => {
    if (!k) return;
    const big = diff[k] >= 6;
    if (big && runFrom < 0) { runFrom = s.t; push(s.t); } else if (big && s.t - events[events.length - 1] >= 1.0) push(s.t);
    if (!big) runFrom = -1;
    if (appear[k]) push(s.t);
  });
  const iss = r.issues, has = (code) => iss.filter((i) => i.code === code);
  const parts = [], fixes = [];
  function part(key, label, max, got, notes) { got = clamp(Math.round(got * 10) / 10, 0, max); parts.push({ key, label, max, got, notes }); return got; }

  // 1 hook
  {
    let p = 0; const n = [];
    const visible0 = S[0].items.some((i) => i.op >= 0.5 && !i.deco && i.vis > 0.3) || diff.slice(1, 4).some((d) => d >= 4);
    const early = diff.slice(1, Math.round(0.6 / step) + 1).reduce((a, b) => a + b, 0);
    if (visible0 || (D < 6 && early >= 2)) p += 6; else n.push('0초 프레임이 비어 있음 — 첫 프레임부터 무언가 보여야 쇼츠에서 멈춘다');
    if (early >= 6) p += 5; else if (early >= 2) { p += 2.5; n.push('첫 0.5초의 움직임이 약함 — 훅은 이미 움직이는 중이어야 한다(pre: 0.4)'); } else n.push('첫 0.5초에 움직임이 없음');
    const firstRead = S.find((s) => s.items.some((i) => i.op >= 0.85 && !i.deco && i.vis > 0.9 && i.len >= 2));
    if (firstRead && firstRead.t <= 1.0) p += 4; else if (firstRead && firstRead.t <= 2.0) { p += 2; n.push(`첫 문구가 ${firstRead.t.toFixed(1)}초에야 읽힘 — 1초 안에`); } else n.push('2초 안에 읽을 문구가 없음');
    part('hook', '훅', 15, p, n);
  }
  // 2 readability
  {
    let p = 20; const n = [];
    const w = { overlap: 8, clipped: 8, tiny: 3, contrast: 3, 'short-read': 3, masked: 2, 'safe-area': 3, soft: 2, page: 6, audio: 4 };
    for (const i of iss) if (w[i.code]) { p -= w[i.code]; n.push(`[${i.code}] ${i.msg}`); }
    part('read', '가독성', 20, p, n);
  }
  // 3 rhythm
  {
    let p = 0; const n = [], hold = Math.min(1.5, D * 0.15), body = events.filter((t) => t < D - hold);
    const gaps = []; let prev = 0; for (const t of body) { gaps.push(t - prev); prev = t; } gaps.push(D - hold - prev);
    const longest = Math.max(...gaps), limit = portrait ? 3 : 4;
    if (longest <= limit) p += 10; else { p += clamp(10 - (longest - limit) * 3, 0, 10); n.push(`새 일이 ${longest.toFixed(1)}초 동안 없음 — ${limit}초 안에 다음 비트를`); }
    // a piece cut to a beat grid may change on every beat: the ceiling follows the grid (120 BPM = 20 a 10 s)
    const beatsPer10 = X.events && X.events.beats && X.events.beats.length > 4 ? X.events.beats.length / D * 10 : 0;
    const per10 = body.length / Math.max(1, D - hold) * 10, lo = portrait ? 3 : 2, hi = Math.max(portrait ? 16 : 12, beatsPer10 * 1.05);
    if (per10 >= lo && per10 <= hi) p += 5; else if (per10 < lo) { p += clamp(5 * per10 / lo, 0, 5); n.push(`변화가 10초에 ${per10.toFixed(1)}번 — 너무 느림`); } else { p += 2; n.push(`변화가 10초에 ${per10.toFixed(1)}번 — 숨 돌릴 홀드가 없음`); }
    const iv = gaps.filter((x) => x > 0.15), m = iv.reduce((a, b) => a + b, 0) / Math.max(1, iv.length), cv = m ? Math.sqrt(iv.reduce((a, b) => a + (b - m) * (b - m), 0) / Math.max(1, iv.length)) / m : 0;
    const gridded = X.events && X.events.beats && X.events.beats.length > 4;
    if (cv >= 0.25 || gridded || iv.length < 4) p += 5; else { p += 2; n.push('모든 변화가 같은 간격 — 빠름과 느림의 대비를'); }
    part('rhythm', '리듬', 20, p, n);
  }
  // 4 motion
  {
    let p = 15; const n = [];
    for (const f of has('frozen')) { p -= 5; n.push(f.msg); }
    const share = moving.filter(Boolean).length / Math.max(1, moving.length - 1);
    if (share < 0.85) { p -= 4; n.push(`움직이는 시간 ${Math.round(share * 100)}% — 느린 드리프트·떠 있기로 숨을 넣는다`); }
    const camUsed = S.some((s) => s.cam && s.cam.used);
    if (!camUsed) { p -= 3; n.push('카메라를 쓰지 않음 — 최소한 cam.drift()'); }
    const cuts = S.filter((s, k) => k && diff[k] >= 30).length, changes = Math.max(1, events.length);
    if (cuts >= 4 && cuts / changes > 0.6 && !(X.events && X.events.beats && X.events.beats.length)) { p -= 3; n.push(`하드컷 ${cuts}번 — 박자 영상이 아니면 같은 물체를 이어 붙이는 전환을`); }
    part('motion', '움직임', 15, p, n);
  }
  // 5 composition
  {
    let p = 15; const n = [];
    if (has('accent').length) { p -= 4; n.push('포인트 색이 한 화면에 3곳 이상'); }
    const blocks = S.map((s) => { const g = new Set(); s.items.forEach((i) => { if (i.op >= 0.6 && !i.deco && i.vis > 0.5 && !i.device && !i.mono) g.add(i.grp ? 'g' + i.grp : 'b' + i.id); }); return g.size; });
    let run = 0, worst = 0; blocks.forEach((b) => { run = b > (portrait ? 5 : 6) ? run + step : 0; worst = Math.max(worst, run); });
    if (worst >= 1.5) { p -= 4; n.push(`글자 덩어리가 한 화면에 ${Math.max(...blocks)}개 — 한 비트에 셋까지`); }
    const chars = S.map((s) => s.items.filter((i) => i.op >= 0.6 && !i.deco && !i.device).reduce((a, i) => a + i.len, 0));
    const heavy = chars.filter((c) => c > (portrait ? 60 : 90)).length * step;
    if (heavy >= 1.5) { p -= 4; n.push(`글자가 많은 화면이 ${heavy.toFixed(1)}초 — 말을 화면용으로 더 줄인다`); }
    part('comp', '구성', 15, p, n);
  }
  // 6 ending
  {
    let p = 0; const n = [], tail = Math.round(1.0 / step), last = diff.slice(-tail);
    const calm = last.length && last.every((d) => d < 6);
    if (calm) p += 6; else n.push('마지막 1초가 정지된 엔드 상태가 아님 — 끝 1초는 새 요소 없이');
    if (!has('late-entry').length) p += 4; else n.push('끝나기 직전에 새 요소가 나옴');
    part('end', '엔딩', 10, p, n);
  }
  // 7 sound
  {
    const plan = X.plan || { tracks: [], sfx: [] }, music = plan.tracks.some((t) => t.role !== 'sfx'), fx = plan.sfx.length;
    part('sound', '사운드', 5, music && fx ? 5 : music || fx >= 3 ? 4 : fx ? 2 : 0, music || fx ? [] : ['소리가 없음 — 음악(<audio>)이나 핵심 움직임 4–8곳의 효과음(sfx)을 넣으면 체감 완성도가 크게 오른다']);
  }
  // slideshow risk
  const hold = clamp(D * 0.2, 1.0, 2.5); let still = 0, longestStill = 0, run = 0;
  S.forEach((s, k) => { if (s.t > D - hold) return; if (!active[k]) { run += step; still += step; longestStill = Math.max(longestStill, run); } else run = 0; });
  const frac = still / Math.max(0.1, D - hold);
  // a slideshow is long holds between changes; cut-hold-cut on every beat (holds under a second) is rhythm, not a slideshow
  const risk = D < 6 ? '해당 없음' : (frac > 0.45 && longestStill > 1.2) || longestStill > 3.5 ? '높음' : (frac > 0.3 && longestStill > 1.0) || longestStill > 2.5 ? '보통' : '낮음';
  // an overlay (<div id="stage" data-overlay>: name tags, captions bars for an editor) starts empty, holds still and stays
  // silent on purpose — hook, rhythm, camera and sound do not apply; legibility, layout and the ending still do
  let riskOut = risk;
  if (X.overlay) { for (const p of parts) if (['hook', 'rhythm', 'motion', 'sound'].includes(p.key)) { p.na = true; p.notes = []; } riskOut = '해당 없음'; }
  const scored = parts.filter((p) => !p.na), total = Math.round(scored.reduce((a, p) => a + p.got, 0) / Math.max(1, scored.reduce((a, p) => a + p.max, 0)) * 100);
  const grade = total >= 92 ? 'S' : total >= 85 ? 'A' : total >= 75 ? 'B' : total >= 60 ? 'C' : 'D';
  for (const p of parts.slice().sort((a, b) => (b.max - b.got) - (a.max - a.got))) for (const n of p.notes) fixes.push({ part: p.label, lost: +(p.max - p.got).toFixed(1), note: n });
  return { file: r.file, meta: r.meta, total, grade, parts, slideshow: { risk: riskOut, stillShare: +frac.toFixed(2), longestStill: +longestStill.toFixed(1) }, overlay: !!X.overlay, events: events.map((t) => +t.toFixed(2)), fixes, check: { summary: r.summary, issues: r.issues } };
}

export function formatScore(s) {
  const bar = (p) => '█'.repeat(Math.round(p.got / p.max * 10)).padEnd(10, '·');
  const lines = [`${s.file.split(/[\\/]/).pop()} — 감독 점수 ${s.total}/100 (${s.grade})${s.overlay ? ' · 오버레이(훅·리듬·움직임·사운드 제외, 나머지로 환산)' : ''} · 슬라이드쇼 위험 ${s.slideshow.risk}(정지 ${Math.round(s.slideshow.stillShare * 100)}%, 최장 ${s.slideshow.longestStill}초)`, ''];
  for (const p of s.parts) lines.push(p.na ? `  ${p.label.padEnd(4, ' ')} 해당 없음` : `  ${p.label.padEnd(4, ' ')} ${bar(p)} ${String(p.got).padStart(4)}/${p.max}`);
  if (s.fixes.length) { lines.push('', '고칠 것(점수를 많이 잃은 순):'); for (const f of s.fixes.slice(0, 8)) lines.push(`  · [${f.part}] ${f.note}`); }
  else lines.push('', '✓ 감점 없음. 시트를 보고 디테일을 다듬으세요.');
  return lines.join('\n');
}
