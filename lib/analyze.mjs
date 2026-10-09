/**
 * Reference analysis: measure a video the user wants to "make it feel like this" —
 * cut rhythm (shot lengths), motion energy over time, colour palette and brightness, music tempo and whether cuts land on beats —
 * and lay one frame per shot on a sheet the model can look at. The director turns this into BPM, cut lengths and a look.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireFfmpeg, findFfmpeg } from './ffmpeg.mjs';
import { analyze as analyzeAudio } from './audio.mjs';
import { launch, destroy } from './browser.mjs';
import { ensureDir } from './util.mjs';

const ACCENTS = { blue: '#3D7BFF', cyan: '#2FD4FF', mint: '#2EF0B0', lime: '#C9F53F', yellow: '#FFD60A', amber: '#FFB224', orange: '#FF6B2C', red: '#FF453A', pink: '#FF4F9A', violet: '#8E6BFF' };
const ff = (args, opts = {}) => spawnSync(requireFfmpeg(), ['-hide_banner', '-nostdin', ...args], { encoding: opts.binary ? undefined : 'utf8', maxBuffer: 512 * 1024 * 1024, windowsHide: true });
const ffprobePath = () => (findFfmpeg() || 'ffmpeg').replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');

function probe(file) {
  const r = spawnSync(ffprobePath(), ['-v', 'error', '-show_entries', 'stream=codec_type,width,height,avg_frame_rate:format=duration', '-of', 'json', file], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error('영상을 읽지 못했습니다: ' + file);
  const j = JSON.parse(r.stdout), v = (j.streams || []).find((s) => s.codec_type === 'video'), a = (j.streams || []).some((s) => s.codec_type === 'audio');
  const [n, d] = String(v && v.avg_frame_rate || '30/1').split('/').map(Number);
  return { width: v ? v.width : 0, height: v ? v.height : 0, fps: d ? +(n / d).toFixed(2) : 30, duration: +(+j.format.duration).toFixed(3), audio: a };
}
const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
function hsl([r, g, b]) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return { h, s, l }; }
function kmeans(px, k = 6) {
  const n = px.length / 3; if (!n) return [];
  let cs = []; for (let i = 0; i < k; i++) { const j = Math.floor(((i + 0.5) / k) * n) * 3; cs.push([px[j], px[j + 1], px[j + 2]]); }
  const lab = new Int32Array(n);
  for (let it = 0; it < 12; it++) {
    const sum = cs.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < n; i++) { let best = 0, bd = Infinity; for (let c = 0; c < cs.length; c++) { const dr = px[3 * i] - cs[c][0], dg = px[3 * i + 1] - cs[c][1], db = px[3 * i + 2] - cs[c][2], d = dr * dr + dg * dg + db * db; if (d < bd) { bd = d; best = c; } } lab[i] = best; const s = sum[best]; s[0] += px[3 * i]; s[1] += px[3 * i + 1]; s[2] += px[3 * i + 2]; s[3]++; }
    cs = cs.map((c, i) => (sum[i][3] ? [sum[i][0] / sum[i][3], sum[i][1] / sum[i][3], sum[i][2] / sum[i][3]] : c));
  }
  const cnt = cs.map(() => 0); for (let i = 0; i < n; i++) cnt[lab[i]]++;
  return cs.map((c, i) => ({ hex: hex(c), share: +(cnt[i] / n).toFixed(3), ...hsl(c) })).sort((a, b) => b.share - a.share);
}
function nearestAccent(c) {
  let best = 'blue', bd = Infinity;
  for (const [k, v] of Object.entries(ACCENTS)) { const h2 = hsl([parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)]).h, d = Math.min(Math.abs(c.h - h2), 360 - Math.abs(c.h - h2)); if (d < bd) { bd = d; best = k; } }
  return best;
}
const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };

/** Analyse a reference video. Writes <out>/<name>.analysis.json · .analysis.md · .shots.png and returns the summary. */
export async function analyzeVideo(file, { out, threshold = 0.25, maxShots = 24 } = {}) {
  const abs = path.resolve(file); if (!fs.existsSync(abs)) throw new Error('파일이 없습니다: ' + abs);
  const info = probe(abs), D = info.duration, name = path.basename(abs).replace(/\.[^.]+$/, '');
  const dir = ensureDir(out || path.join(path.dirname(abs), 'out'));
  // 1 cuts
  const sc = ff(['-i', abs, '-vf', `scale=320:-2,select='gt(scene,${threshold})',showinfo`, '-an', '-f', 'null', '-']);
  const cuts = []; for (const m of String(sc.stderr || '').matchAll(/Parsed_showinfo[^\n]*pts_time:([\d.]+)/g)) { const t = +m[1]; if (t > 0.08 && t < D - 0.08 && (!cuts.length || t - cuts[cuts.length - 1] > 0.12)) cuts.push(+t.toFixed(3)); }
  const bounds = [0, ...cuts, D], shots = bounds.slice(1).map((b, i) => ({ start: bounds[i], end: b, length: +(b - bounds[i]).toFixed(3) }));
  const lens = shots.map((s) => s.length), mean = lens.reduce((a, b) => a + b, 0) / Math.max(1, lens.length);
  // 2 motion energy (10 fps luma difference) and light (2 fps)
  const mo = ff(['-i', abs, '-vf', 'fps=10,scale=160:-2,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-an', '-f', 'null', '-']);
  const energy = []; let curT = 0; for (const line of String(mo.stdout || '').split('\n')) { const a = /pts_time:([\d.]+)/.exec(line); if (a) curT = +a[1]; const b = /YAVG=([\d.]+)/.exec(line); if (b) energy.push([+curT.toFixed(2), +b[1]]); }
  const perSec = []; for (let s = 0; s < Math.ceil(D); s++) { const v = energy.filter(([t]) => t >= s && t < s + 1).map(([, y]) => y); perSec.push(+(v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0).toFixed(2)); }
  const lt = ff(['-i', abs, '-vf', 'fps=2,scale=160:-2,signalstats,metadata=print:file=-', '-an', '-f', 'null', '-']);
  const Y = [], SAT = []; for (const line of String(lt.stdout || '').split('\n')) { let m = /signalstats\.YAVG=([\d.]+)/.exec(line); if (m) Y.push(+m[1]); m = /signalstats\.SATAVG=([\d.]+)/.exec(line); if (m) SAT.push(+m[1]); }
  // 3 palette (1 fps, 48 px wide)
  const pal = ff(['-i', abs, '-vf', 'fps=1,scale=48:-2', '-an', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { binary: true });
  const palette = kmeans(pal.stdout && pal.stdout.length ? new Uint8Array(pal.stdout) : new Uint8Array(0), 6);
  const vivid = palette.filter((c) => c.s > 0.28 && c.l > 0.2 && c.l < 0.85).sort((a, b) => b.share * b.s - a.share * a.s)[0] || null;
  const avgY = Y.length ? Y.reduce((a, b) => a + b, 0) / Y.length : 0, avgS = SAT.length ? SAT.reduce((a, b) => a + b, 0) / SAT.length : 0;
  // 4 music
  let music = null;
  if (info.audio) { try { const a = analyzeAudio(abs); const onBeat = cuts.filter((c) => a.beats.some((b) => Math.abs(b - c) <= 0.08)).length; music = { bpm: a.bpm, beats: a.beats.length, cutsOnBeat: cuts.length ? +(onBeat / cuts.length).toFixed(2) : null, beatsPerShot: a.bpm ? +(mean / (60 / a.bpm)).toFixed(1) : null }; } catch { music = null; } }
  const pace = mean < 1.2 ? '매우 빠름' : mean < 2.5 ? '빠름' : mean < 4.5 ? '보통' : '느림';
  const eAvg = perSec.length ? perSec.reduce((a, b) => a + b, 0) / perSec.length : 0;
  const theme = avgY < 70 ? (avgS > 35 ? 'night' : 'ink') : avgY > 170 ? 'white' : avgY > 130 ? 'paper' : 'ink';
  const summary = {
    file: abs, ...info,
    shots: { count: shots.length, mean: +mean.toFixed(2), median: +median(lens).toFixed(2), min: +Math.min(...lens).toFixed(2), max: +Math.max(...lens).toFixed(2), per10s: +(cuts.length / Math.max(1, D) * 10).toFixed(1), pace, list: shots },
    motion: { average: +eAvg.toFixed(2), perSecond: perSec, peak: perSec.indexOf(Math.max(...perSec)), calmest: perSec.indexOf(Math.min(...perSec)) },
    light: { brightness: +avgY.toFixed(1), saturation: +avgS.toFixed(1) }, palette,
    music,
    suggest: { theme, accent: vivid ? nearestAccent(vivid) : null, accentHex: vivid ? vivid.hex : null, bpm: music && music.bpm ? music.bpm : null, cut: +mean.toFixed(2) }
  };
  // 5 one frame per shot on a sheet
  const pick = shots.length <= maxShots ? shots : Array.from({ length: maxShots }, (_, i) => shots[Math.floor((i / maxShots) * shots.length)]);
  const imgs = [];
  for (const s of pick) {
    // the settled moment of the shot: calmest 10 fps sample in its 35–95 % window (falls back to the middle)
    const lo = s.start + s.length * 0.35, hi = s.start + s.length * 0.95 - 0.05;
    const calm = energy.filter(([et]) => et >= lo && et <= hi).sort((a, b) => a[1] - b[1] || b[0] - a[0])[0];
    const t = Math.min(D - 0.05, calm ? calm[0] : s.start + s.length / 2), r = ff(['-ss', String(t), '-i', abs, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', '-f', 'mjpeg', 'pipe:1'], { binary: true });
    if (r.status === 0 && r.stdout.length) imgs.push({ t: s.start, len: s.length, data: Buffer.from(r.stdout).toString('base64') });
  }
  const sheet = path.join(dir, name + '.shots.png');
  if (imgs.length) {
    const portrait = info.height > info.width, cols = portrait ? Math.min(8, imgs.length) : Math.min(6, imgs.length), tileW = portrait ? 200 : 300, tileH = Math.round(tileW * (info.height || 9) / (info.width || 16));
    const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0c0c0e;color:#e9e9ee;font:600 13px/1 ui-monospace,Menlo,Consolas,monospace}h1{margin:0;padding:12px;font-size:13px;color:#9a9aa6}.g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:10px;padding:0 12px 12px}img{display:block;width:${tileW}px;height:${tileH}px;object-fit:cover;outline:1px solid #2a2a31}figure{margin:0}figcaption{padding-top:5px}figcaption span{color:#74747f;margin-left:6px}</style><h1>${path.basename(abs)} · ${info.width}×${info.height} · ${D}s · ${shots.length} shots · avg ${mean.toFixed(2)}s${music ? ' · ' + music.bpm + ' BPM' : ''}</h1><div class="g">${imgs.map((m) => `<figure><img src="data:image/jpeg;base64,${m.data}"><figcaption>${m.t.toFixed(2)}s<span>${m.len.toFixed(2)}s</span></figcaption></figure>`).join('')}</div>`;
    const b = await launch();
    try { const p = (await b.pages())[0]; await p.setViewport({ width: cols * (tileW + 10) + 14, height: 400, deviceScaleFactor: 1 }); await p.setContent(html, { waitUntil: 'load' }); await p.screenshot({ path: sheet, fullPage: true }); }
    finally { destroy([b]); }
  }
  const md = [
    `# 참고 영상 분석 — ${path.basename(abs)}`, '',
    `${info.width}×${info.height} · ${D}초 · ${info.fps}fps`, '',
    '## 컷 리듬', `샷 ${shots.length}개 · 평균 ${mean.toFixed(2)}초(중앙값 ${median(lens).toFixed(2)}초, 가장 짧은 샷 ${Math.min(...lens).toFixed(2)}초) · 10초당 ${summary.shots.per10s}컷 → **${pace}**`, '',
    '## 움직임', `초당 움직임 세기(0–255 휘도 차) 평균 ${eAvg.toFixed(1)} · 가장 역동적인 구간 ${summary.motion.peak}–${summary.motion.peak + 1}초 · 가장 잠잠한 구간 ${summary.motion.calmest}–${summary.motion.calmest + 1}초`, '',
    '## 빛과 색', `밝기 ${avgY.toFixed(0)}/255 · 채도 ${avgS.toFixed(0)} · 주요 색 ${palette.slice(0, 5).map((c) => `${c.hex}(${Math.round(c.share * 100)}%)`).join(' ')}`, '',
    '## 음악', music ? `${music.bpm} BPM · 컷의 ${Math.round((music.cutsOnBeat || 0) * 100)}%가 박자 위 · 샷 하나가 평균 ${music.beatsPerShot}박` : '오디오 없음', '',
    '## 연출에 옮길 것',
    `- 테마 \`${theme}\`${summary.suggest.accent ? ` · 포인트 \`${summary.suggest.accent}\`(원본 ${summary.suggest.accentHex})` : ''}`,
    music && music.bpm ? `- 박자: \`data-bpm="${music.bpm}"\`(또는 같은 음악을 <audio>로 넣고 M.grid()) · 컷 길이 약 ${music.beatsPerShot}박` : `- 컷 길이: 평균 ${mean.toFixed(1)}초 — 비트 시트의 장면 길이를 이 근처로`,
    `- 첫 샷 ${shots[0] ? shots[0].length.toFixed(2) : '-'}초 · 마지막 샷 ${shots.length ? shots[shots.length - 1].length.toFixed(2) : '-'}초(엔드 홀드)`,
    '- 시트(.shots.png)를 보고 구도·타이포·전환 방식을 말로 옮긴다. 원본의 문구·로고·이미지를 베끼지 않는다.'
  ].join('\n');
  fs.writeFileSync(path.join(dir, name + '.analysis.json'), JSON.stringify(summary, null, 1));
  fs.writeFileSync(path.join(dir, name + '.analysis.md'), md + '\n');
  return { summary, markdown: md, sheet: imgs.length ? sheet : null, json: path.join(dir, name + '.analysis.json') };
}
