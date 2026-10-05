import crypto from 'node:crypto';
import path from 'node:path';
import { openComposition } from './capture.mjs';

/**
 * Lint a composition by stepping through time and measuring what is actually on screen.
 * Catches the failures that make motion graphics look amateur: overlapping or cut-off text, type too small
 * or too faint to read, text that leaves before it can be read, frozen stretches, a late first frame, accent overuse.
 */
export async function check(file, { step = 0.1, platform } = {}) {
  const comp = await openComposition(file, { scale: 0.5 });
  const issues = [];
  let meta, samples = [];
  try {
    meta = comp.meta;
    const page = comp.pages[0];
    const D = meta.duration, n = Math.round(D / step);
    for (let i = 0; i <= n; i++) {
      const t = Math.min(D, +(i * step).toFixed(4));
      await comp.seek(page, t);
      const info = await page.evaluate(() => ({ ...window.__motion.inspect(), mag: window.__motion.sharp ? window.__motion.sharp() : 0 }));
      const hash = crypto.createHash('md5').update(await comp.shot(page, { type: 'png' })).digest('hex');
      samples.push({ t, hash, ...info });
    }
    platform = platform || (await page.evaluate(() => document.getElementById('stage').dataset.platform || ''));
    for (const p of comp.problems) issues.push({ level: 'error', code: 'page', msg: p, fix: '콘솔 오류·누락 파일을 먼저 해결하세요. 경로는 컴포지션 폴더 기준 상대 경로여야 합니다.' });
  } finally { await comp.close(); }

  const W = meta.width, H = meta.height, D = meta.duration, short = Math.min(W, H);
  const fmtT = (a, b) => (b === undefined || Math.abs(b - a) < 1e-6 ? `${a.toFixed(1)}s` : `${a.toFixed(1)}–${b.toFixed(1)}s`);
  const q = (s) => '“' + s.replace(/\s+/g, ' ').slice(0, 26) + (s.length > 26 ? '…' : '') + '”';
  const same = (a, b, tol = 1.5) => a && b && Math.abs(a.x0 - b.x0) <= tol && Math.abs(a.y0 - b.y0) <= tol && Math.abs(a.x1 - b.x1) <= tol && Math.abs(a.y1 - b.y1) <= tol;

  const ink = (i) => { const h = i.y1 - i.y0, lines = Math.max(1, Math.round(h / Math.max(1, i.font * 1.25))), pad = Math.min(h * 0.3, (h / lines) * 0.17); return { x0: i.x0 + 2, x1: i.x1 - 2, y0: i.y0 + pad, y1: i.y1 - pad }; };

  // per-block tracks
  const tracks = new Map();
  samples.forEach((s, si) => s.items.forEach((it) => {
    if (!tracks.has(it.id)) tracks.set(it.id, []);
    const prev = si > 0 ? samples[si - 1].items.find((x) => x.id === it.id) : null;
    it.still = same(it, prev) && prev.text === it.text;
    if (it.vis < 0.15) it.op = 0; // a sliver peeking under a reveal mask is not on screen yet
    it.si = si; it.t = s.t;
    tracks.get(it.id).push(it);
  }));
  const runs = (arr, pred) => { // consecutive sample runs where pred holds → [{a, b, items}]
    const out = []; let cur = null;
    for (const it of arr) { if (pred(it)) { if (cur && it.si === cur.last + 1) { cur.b = it.t; cur.last = it.si; cur.items.push(it); } else { cur = { a: it.t, b: it.t, last: it.si, items: [it] }; out.push(cur); } } else cur = null; }
    return out;
  };

  // 1 ── overlapping text
  const pairSeen = new Map();
  samples.forEach((s) => {
    const nested = new Set(s.nested);
    const vis = s.items.filter((i) => i.op >= 0.6 && !i.deco && i.vis > 0.5 && i.blur < 3);
    for (let i = 0; i < vis.length; i++) for (let j = i + 1; j < vis.length; j++) {
      const a = vis[i], b = vis[j];
      if (nested.has(a.id + ':' + b.id) || nested.has(b.id + ':' + a.id)) continue;
      // compare ink boxes, not line boxes: glyphs leave ~17% of the box empty above and below
      const A = ink(a), B = ink(b);
      const ix = Math.min(A.x1, B.x1) - Math.max(A.x0, B.x0), iy = Math.min(A.y1, B.y1) - Math.max(A.y0, B.y0);
      if (ix <= 3 || iy <= 3) continue;
      if (ix < 0.1 * Math.min(A.x1 - A.x0, B.x1 - B.x0) || iy < 0.18 * Math.min(A.y1 - A.y0, B.y1 - B.y0)) continue;
      if (!(a.still && b.still)) continue;
      const k = a.id < b.id ? a.id + ':' + b.id : b.id + ':' + a.id;
      const e = pairSeen.get(k);
      if (e) { e.b = s.t; e.n++; } else pairSeen.set(k, { a: s.t, b: s.t, n: 1, ta: a.text, tb: b.text });
    }
  });
  for (const e of pairSeen.values()) if (e.n >= 2) issues.push({ level: 'error', code: 'overlap', at: [e.a, e.b], msg: `글자가 겹칩니다: ${q(e.ta)} ↔ ${q(e.tb)}`, fix: '둘 중 하나의 위치·크기를 조정하거나, 먼저 있던 요소를 M.exit으로 내보낸 뒤 다음 요소를 들이세요.' });

  for (const [, arr] of tracks) {
    const first = arr[0];
    if (first.deco) continue;
    const solid = (i) => i.op >= 0.85 && i.vis >= 0.9 && i.blur < 2;
    // 2 ── cut off by the frame or by its container
    // (every still stretch is examined: an early harmless finding must not hide a later real one)
    let clippedSeen = false, maskedSeen = false;
    for (const r of runs(arr, (i) => i.op >= 0.6 && i.still)) {
      if (r.b - r.a < 0.25) continue;
      const it = r.items[r.items.length - 1], w = it.fx1 - it.fx0, h = it.fy1 - it.fy0;
      const lines = Math.max(1, Math.round(h / Math.max(1, it.font * 1.25))), pad = Math.min(h * 0.3, (h / lines) * 0.16);   // judge the ink, not the line box
      const out = Math.max(0, -it.fx0, it.fx1 - W) / Math.max(1, w) + Math.max(0, -(it.fy0 + pad), it.fy1 - pad - H) / Math.max(1, h);
      if (!clippedSeen && out > 0.03 && it.fx1 > 0 && it.fx0 < W && it.fy1 > 0 && it.fy0 < H) { clippedSeen = true; issues.push({ level: 'error', code: 'clipped', at: [r.a, r.b], msg: `화면 밖으로 잘립니다: ${q(it.text)}`, fix: '글자 크기를 줄이거나 줄바꿈하고, 좌우는 var(--safe-x) 안쪽에 두세요(카메라 줌만큼 여백이 줄어듭니다). 의도한 장식이면 요소에 data-deco를 붙입니다.' }); }
      else if (!maskedSeen && it.vis < 0.75 && out <= 0.03) { maskedSeen = true; issues.push({ level: 'warn', code: 'masked', at: [r.a, r.b], msg: `컨테이너에 가려 일부만 보입니다(${Math.round(it.vis * 100)}%): ${q(it.text)}`, fix: '부모의 overflow/크기를 확인하세요. 마스크 리빌이 끝까지 재생되는지, 등장 전에는 M.scene으로 숨겨 두었는지도 확인합니다.' }); }
    }
    const readable = arr.filter(solid);
    if (!readable.length) continue;
    const best = readable.reduce((a, b) => (b.font > a.font ? b : a));
    const rest = runs(arr, (i) => solid(i) && i.still).sort((a, b) => (b.b - b.a) - (a.b - a.a))[0];
    const ref = rest ? rest.items[rest.items.length - 1] : best;
    // 3 ── too small
    const minPx = (ref.mono ? 0.0148 : 0.0205) * short;
    if (rest && !ref.device && rest.b - rest.a >= 0.3 && ref.font < minPx) issues.push({ level: 'warn', code: 'tiny', at: [rest.a, rest.b], msg: `글자가 작습니다(${ref.font}px, 권장 ≥ ${Math.ceil(minPx)}px): ${q(ref.text)}`, fix: '휴대폰에서 읽히지 않습니다. 본문 3u 이상, 라벨 1.6u 이상으로 키우거나 카메라로 확대하세요.' });
    // 4 ── low contrast
    if (rest && ref.contrast !== null && ref.contrast < (ref.font >= 0.03 * short ? 2.6 : 3.6) && rest.b - rest.a >= 0.4) issues.push({ level: 'warn', code: 'contrast', at: [rest.a, rest.b], msg: `대비가 낮습니다(${ref.contrast}:1): ${q(ref.text)}`, fix: '보조 글자는 --fg-2, 가장 흐린 라벨도 --fg-3까지만. 포인트 색 위 글자는 --on-accent를 쓰세요.' });
    // 5 ── gone before it can be read
    const total = readable.length * step;
    const need = Math.min(3.2, Math.max(0.3, 0.2 + 0.05 * ref.len));       // a beat word of 2–4 characters is readable in 0.3–0.4s
    if (!ref.mono && !ref.device && ref.len >= 2 && total + step * 0.5 < need && !(first.t > D - need)) issues.push({ level: 'warn', code: 'short-read', at: [readable[0].t, readable[readable.length - 1].t], msg: `읽을 시간이 부족합니다(${total.toFixed(1)}s < ${need.toFixed(1)}s): ${q(ref.text)}`, fix: '머무는 시간을 늘리거나 문구를 줄이세요. 핵심 결과는 0.8–1초 이상 정지해 있어야 합니다.' });
    // 9 ── platform safe areas
    if (platform === 'shorts' && rest && rest.b - rest.a >= 0.5) {
      // only what is really in the frame, and only clear intrusions: the guides (.mo-safe, G key) are stricter than this alarm
      const inFrame = ref.x1 > 0 && ref.x0 < W && ref.y1 > 0 && ref.y0 < H;
      const bottom = ref.y1 > H * 0.84, top = ref.y0 < H * 0.07, right = ref.x1 > W * 0.88 && ref.y1 > H * 0.55;
      if (inFrame && (bottom || top || right)) issues.push({ level: 'warn', code: 'safe-area', at: [rest.a, rest.b], msg: `쇼츠 UI에 가려지는 영역입니다(${bottom ? '하단 16%' : top ? '상단 7%' : '우측 버튼'}): ${q(ref.text)}`, fix: '핵심 글자는 .mo-safe 안(상단 10.5%, 하단 20%, 좌우 8% 안쪽)에 두세요. 미리보기에서 G 키, 시트에서 --guides로 영역을 확인합니다.' });
    }
    // 8 ── font fallback
    const loaded = samples[0].fonts;
    if (ref.family && !/^(system-ui|sans-serif|serif|monospace|ui-monospace)$/i.test(ref.family) && loaded.length && !loaded.includes(ref.family)) issues.push({ level: 'warn', code: 'font', msg: `번들에 없는 글꼴입니다(${ref.family}): ${q(ref.text)}`, fix: '기본 제공: Pretendard · Geist · Geist Mono · Instrument Serif. 다른 글꼴은 woff2를 폴더에 넣고 @font-face로 선언하세요.' });
  }

  // 6 ── frozen picture
  let runStart = 0;
  const frozen = [];
  for (let i = 1; i <= samples.length; i++) {
    if (i < samples.length && samples[i].hash === samples[i - 1].hash) continue;
    const a = samples[runStart].t, b = samples[i - 1].t;
    if (b - a >= 0.7) frozen.push([a, b]);
    runStart = i;
  }
  for (const [a, b] of frozen) issues.push({ level: 'warn', code: 'frozen', at: [a, b], msg: `화면이 ${(b - a).toFixed(1)}초 동안 완전히 멈춰 있습니다`, fix: 'cam.drift({ zoom: 1.04 })로 느린 푸시 인을 깔거나 M.float로 미세한 움직임을 주세요. 멈춤은 의도한 홀드일 때만.' });

  // 12 ── enlarged past what the renderer can keep sharp
  const softRuns = runs(samples.map((s, si) => ({ ...s, si })), (s) => s.mag > 3.3).filter((r) => r.b - r.a >= 0.3);
  if (softRuns.length) issues.push({ level: 'warn', code: 'soft', at: [softRuns[0].a, softRuns[0].b], msg: `기울어진 화면을 ${Math.max(...softRuns[0].items.map((s) => s.mag)).toFixed(1)}배까지 확대합니다 — 3배를 넘으면 글자가 흐려집니다`, fix: '가장 가까운 샷에서 보일 크기로 요소를 만들고 넓은 샷은 줌아웃(zoom < 1)으로 잡거나, 확대하는 동안 기울기(rx·ry)를 0으로 두세요.' });

  // 11 ── late first frame
  const firstVisible = samples.find((s) => s.items.some((i) => i.op >= 0.5 && i.vis > 0.5 && !i.deco));
  const changed = samples.findIndex((s, i) => i > 0 && s.hash !== samples[0].hash);
  if (changed < 0) issues.push({ level: 'error', code: 'static', msg: '처음부터 끝까지 화면이 변하지 않습니다', fix: '타임라인에 트윈이 추가됐는지, Motion.compose 콜백이 실행됐는지 확인하세요.' });
  else if (firstVisible && firstVisible.t > 0.7 && samples[changed].t > 0.5) issues.push({ level: 'warn', code: 'late-start', at: [0, firstVisible.t], msg: `첫 ${firstVisible.t.toFixed(1)}초 동안 볼 것이 없습니다`, fix: '쇼츠는 첫 프레임이 훅입니다. 0.0–0.3초 안에 무언가 움직이기 시작해야 합니다.' });

  // 10 ── something appears too late to be read
  const lateOnes = [...tracks.values()].filter((arr) => !arr[0].deco && !arr[0].mono && arr[0].len >= 3 && arr.find((i) => i.op >= 0.85) && arr.find((i) => i.op >= 0.85).t > D - 0.75);
  if (lateOnes.length) issues.push({ level: 'warn', code: 'late-entry', at: [D - 0.75, D], msg: `끝나기 직전에 등장해 읽을 수 없습니다: ${lateOnes.slice(0, 2).map((a) => q(a[0].text)).join(', ')}`, fix: '마지막 요소는 끝나기 최소 1초 전에 자리 잡게 하거나 data-duration을 늘리세요.' });

  // 7 ── accent overuse
  const over = runs(samples.map((s, si) => ({ ...s, si })), (s) => s.accents > 2).filter((r) => r.b - r.a >= 0.5);
  if (over.length) issues.push({ level: 'info', code: 'accent', at: [over[0].a, over[0].b], msg: `포인트 색이 한 화면에 ${Math.max(...over[0].items.map((s) => s.accents))}곳 보입니다`, fix: '포인트 색은 한 프레임에 한 곳(많아야 두 곳). 나머지는 흰색·회색으로 낮추면 그 한 곳이 살아납니다.' });

  const order = { error: 0, warn: 1, info: 2 };
  issues.sort((a, b) => order[a.level] - order[b.level] || (a.at ? a.at[0] : -1) - (b.at ? b.at[0] : -1));
  const dedup = [], seen = new Set();
  for (const i of issues) { const k = i.code + '|' + i.msg; if (!seen.has(k)) { seen.add(k); dedup.push(i); } }
  const motionPct = Math.round((samples.filter((s, i) => i > 0 && s.hash !== samples[i - 1].hash).length / Math.max(1, samples.length - 1)) * 100);
  return {
    file: path.resolve(file), meta: { width: W, height: H, fps: meta.fps, duration: D },
    summary: { errors: dedup.filter((i) => i.level === 'error').length, warnings: dedup.filter((i) => i.level === 'warn').length, infos: dedup.filter((i) => i.level === 'info').length, movingFrames: motionPct + '%', textBlocks: tracks.size },
    issues: dedup.map((i) => ({ ...i, at: i.at ? fmtT(i.at[0], i.at[1]) : undefined }))
  };
}

export function formatReport(r) {
  const icon = { error: '✖', warn: '▲', info: '·' };
  const head = `${path.basename(r.file)} · ${r.meta.width}×${r.meta.height} · ${r.meta.duration}s — 오류 ${r.summary.errors} · 경고 ${r.summary.warnings} · 참고 ${r.summary.infos} · 움직이는 구간 ${r.summary.movingFrames}`;
  if (!r.issues.length) return head + '\n✓ 자동 점검 통과. 이제 콘택트 시트(motion sheet)를 눈으로 확인하세요.';
  return head + '\n' + r.issues.map((i) => `${icon[i.level]} [${i.code}]${i.at ? ' ' + i.at : ''}  ${i.msg}\n    → ${i.fix}`).join('\n');
}
