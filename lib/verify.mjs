/**
 * Post-render review of the actual file: what the encoder wrote is what the viewer gets.
 * Checks container facts (size, fps, length, colour tags), black stretches, frozen stretches, audio level (silence, clipping, loudness),
 * and lays six frames side by side so the model can look at the delivered video, not the composition.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { requireFfmpeg, findFfmpeg } from './ffmpeg.mjs';
import { launch, destroy } from './browser.mjs';

const ff = (args, binary) => spawnSync(requireFfmpeg(), ['-hide_banner', '-nostdin', ...args], { encoding: binary ? undefined : 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true });

export async function verify(file, { expect = {}, strip = true, out } = {}) {
  const abs = path.resolve(file); if (!fs.existsSync(abs)) throw new Error('파일이 없습니다: ' + abs);
  const ffprobe = (findFfmpeg() || 'ffmpeg').replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
  const pr = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,color_transfer,sample_rate,channels:stream_tags=alpha_mode:format=duration,size', '-of', 'json', abs], { encoding: 'utf8', windowsHide: true });
  if (pr.status !== 0) throw new Error('영상 정보를 읽지 못했습니다: ' + abs);
  const j = JSON.parse(pr.stdout), v = j.streams.find((s) => s.codec_type === 'video'), a = j.streams.find((s) => s.codec_type === 'audio');
  const [fn, fd] = String(v && v.avg_frame_rate || '0/1').split('/').map(Number), fps = fd ? fn / fd : 0, duration = +j.format.duration;
  const info = { file: abs, size: +j.format.size, duration: +duration.toFixed(3), width: v && v.width, height: v && v.height, fps: +fps.toFixed(3), codec: v && v.codec_name, pix: v && v.pix_fmt, color: v && v.color_transfer, audio: a ? { codec: a.codec_name, rate: +a.sample_rate, channels: a.channels } : null };
  const issues = [];
  // transparent video (ProRes 4444, PNG, VP9 with alpha): judge what is drawn, not the transparent pixels
  const tags = Object.fromEntries(Object.entries((v && v.tags) || {}).map(([k, x]) => [k.toLowerCase(), x]));
  const alpha = !!v && (/^(yuva|rgba|argb|bgra|abgr|gbrap|ya)/.test(v.pix_fmt || '') || String(tags.alpha_mode || '') === '1');
  const dec = alpha && v.codec_name === 'vp9' ? ['-c:v', 'libvpx-vp9'] : [];
  if (alpha) info.alpha = true;
  if (expect.width && (info.width !== expect.width || info.height !== expect.height)) issues.push({ level: 'error', msg: `크기가 다릅니다: ${info.width}×${info.height} (기대 ${expect.width}×${expect.height})` });
  if (expect.duration && Math.abs(duration - expect.duration) > 0.1) issues.push({ level: 'error', msg: `길이가 다릅니다: ${duration.toFixed(2)}초 (기대 ${expect.duration}초)` });
  if (expect.fps && Math.abs(fps - expect.fps) > 0.01) issues.push({ level: 'warn', msg: `fps가 다릅니다: ${fps} (기대 ${expect.fps})` });
  if (v && /yuv/.test(v.pix_fmt || '') && v.color_transfer && v.color_transfer !== 'bt709') issues.push({ level: 'warn', msg: `색 정보가 BT.709가 아닙니다(${v.color_transfer}) — 플레이어마다 색이 달라 보일 수 있습니다` });
  // black (or, with alpha, fully transparent) and frozen stretches
  const spans = (txt) => [...String(txt).matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [+m[1], +m[2]]);
  if (alpha) {
    const empty = spans(ff([...dec, '-i', abs, '-vf', 'alphaextract,blackdetect=d=0.1:pic_th=0.999:pix_th=0.004', '-an', '-f', 'null', '-']).stderr);
    if (empty.reduce((t, [s, e]) => t + e - s, 0) >= duration - 0.1) issues.push({ level: 'error', msg: '처음부터 끝까지 완전히 투명합니다 — 보이는 것이 없습니다' });
    else for (const [s, e] of empty) issues.push({ level: 'info', msg: `완전히 투명 ${s.toFixed(2)}–${e.toFixed(2)}초(오버레이가 나오기 전·사라진 뒤라면 정상)` });
  } else {
    const blacks = spans(ff(['-i', abs, '-vf', 'blackdetect=d=0.25:pic_th=0.985:pix_th=0.06', '-an', '-f', 'null', '-']).stderr);
    for (const [s, e] of blacks) issues.push({ level: 'warn', msg: `검은 화면 ${s.toFixed(2)}–${e.toFixed(2)}초${s < 0.05 ? ' (첫 프레임이 검정 — 썸네일과 훅에 불리)' : ''}` });
  }
  const fz = ff([...dec, '-i', abs, '-vf', 'freezedetect=n=0.0008:d=1.6', '-an', '-f', 'null', '-']);
  const starts = [...String(fz.stderr).matchAll(/freeze_start: ([\d.]+)/g)].map((m) => +m[1]), ends = [...String(fz.stderr).matchAll(/freeze_end: ([\d.]+)/g)].map((m) => +m[1]);
  starts.forEach((s, i) => { const e = ends[i] ?? duration; if (e < duration - 0.05 || e - s > 3.5) issues.push({ level: alpha ? 'info' : 'warn', msg: `화면이 ${(e - s).toFixed(1)}초 동안 멈춰 있습니다(${s.toFixed(1)}–${e.toFixed(1)}초)${alpha ? ' — 오버레이가 머무는 구간이면 정상' : ''}` }); });
  // audio
  if (a) {
    const lr = ff(['-i', abs, '-vn', '-af', 'ebur128=framelog=quiet,volumedetect', '-f', 'null', '-']), t = String(lr.stderr);
    const I = +((/I:\s+(-?[\d.]+) LUFS/.exec(t) || [])[1]), peak = +((/max_volume: (-?[\d.]+) dB/.exec(t) || [])[1]);
    info.audio.loudness = isFinite(I) ? I : null; info.audio.peak = isFinite(peak) ? peak : null;
    if (isFinite(peak) && peak > -0.1) issues.push({ level: 'warn', msg: `소리가 찢어질 수 있습니다(최대 ${peak} dB)` });
    if (isFinite(I) && I < -30) issues.push({ level: 'warn', msg: `소리가 매우 작습니다(${I} LUFS)` });
    if (isFinite(I) && I > -9) issues.push({ level: 'warn', msg: `소리가 너무 큽니다(${I} LUFS, 쇼츠·유튜브 기준 −14 근처)` });
  }
  // six frames of the delivered file
  let stripFile = null;
  if (strip && v) {
    const times = [0.04, 0.22, 0.4, 0.58, 0.76, 0.985].map((p) => Math.max(0, Math.min(duration - 0.04, p * duration)));
    const grab = (tm) => alpha ? ff(['-ss', String(tm), ...dec, '-i', abs, '-frames:v', '1', '-vf', 'scale=420:-2,format=rgba', '-c:v', 'png', '-f', 'image2pipe', 'pipe:1'], true)
      : ff(['-ss', String(tm), '-i', abs, '-frames:v', '1', '-vf', 'scale=420:-2', '-q:v', '4', '-f', 'mjpeg', 'pipe:1'], true);
    const imgs = times.map((tm) => { const r = grab(tm); return r.status === 0 && r.stdout.length ? { t: tm, data: Buffer.from(r.stdout).toString('base64') } : null; }).filter(Boolean);
    if (imgs.length) {
      const portrait = info.height > info.width, tw = portrait ? 220 : 340, th = Math.round(tw * info.height / info.width);
      const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0c0c0e;color:#e9e9ee;font:600 13px/1 ui-monospace,Menlo,Consolas,monospace}.g{display:flex;gap:10px;padding:12px}img{display:block;width:${tw}px;height:${th}px;outline:1px solid #2a2a31;background:repeating-conic-gradient(#3a3a41 0% 25%,#26262b 0% 50%) 50%/18px 18px}figure{margin:0}figcaption{padding-top:6px;color:#9a9aa6}</style><div class="g">${imgs.map((m) => `<figure><img src="data:image/${alpha ? 'png' : 'jpeg'};base64,${m.data}"><figcaption>${m.t.toFixed(2)}s</figcaption></figure>`).join('')}</div>`;
      const b = await launch();
      try { const p = (await b.pages())[0]; await p.setViewport({ width: imgs.length * (tw + 10) + 14, height: th + 50, deviceScaleFactor: 1 }); await p.setContent(html, { waitUntil: 'load' }); stripFile = out || abs.replace(/\.[^.]+$/, '') + '.check.png'; await p.screenshot({ path: stripFile }); }
      finally { destroy([b]); }
    }
  }
  return { ok: !issues.some((i) => i.level === 'error'), info, issues, strip: stripFile };
}

export function formatVerify(r) {
  const i = r.info, mb = (i.size / 1048576).toFixed(1);
  const head = `${path.basename(i.file)} · ${i.width}×${i.height} · ${i.fps}fps · ${i.duration}s · ${i.codec}/${i.pix}${i.color ? '/' + i.color : ''}${i.alpha ? ' · 투명 배경' : ''} · ${mb} MB` + (i.audio ? ` · 소리 ${i.audio.codec} ${i.audio.loudness != null ? i.audio.loudness + ' LUFS' : ''}` : ' · 소리 없음');
  return [head, ...(r.issues.length ? r.issues.map((x) => (x.level === 'error' ? '✖ ' : x.level === 'info' ? '· ' : '▲ ') + x.msg) : ['✓ 렌더 결과 이상 없음']).concat(r.issues.length && !r.issues.some((x) => x.level !== 'info') ? ['✓ 렌더 결과 이상 없음'] : []), r.strip ? '프레임 띠: ' + r.strip : ''].filter(Boolean).join('\n');
}
