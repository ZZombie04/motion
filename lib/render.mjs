import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openComposition } from './capture.mjs';
import { ffmpeg } from './ffmpeg.mjs';
import { ensureDir, fmtBytes, progressBar } from './util.mjs';

const even = (n) => Math.max(2, Math.round(n / 2) * 2);

/** blur = maximum motion-blur sub-frames per frame (adaptive: still frames take 1, whip pans take all). */
export const QUALITY = {
  draft: { blur: 1, crf: 26, preset: 'veryfast', scale: 0.5, capture: 'jpeg' },
  standard: { blur: 16, crf: 20, preset: 'medium', scale: 1, capture: 'png' },
  final: { blur: 32, crf: 17, preset: 'slow', scale: 1, capture: 'png' }
};

/**
 * Layout zoom a frame is captured at, from the largest magnification of tilted content (see __motion.sharp).
 * A little enlargement is left alone; beyond that the page is laid out 2× or 3× and scaled back down.
 */
const zoomFor = (m, fine) => (m <= (fine ? 0.9 : 1.12) ? 1 : m <= (fine ? 1.8 : 2.2) ? 2 : 3);
const magnified = (page, t) => page.evaluate((x) => (window.__motion.sharp ? window.__motion.sharp(x) : 0), t);
/**
 * Layout zoom per chunk of frames, decided for the whole timeline at once: a stretch of tilted content that is enlarged
 * anywhere is captured large from end to end (for as long as it stays life-size), so sharpness never pops in or out
 * in the middle of a held shot. It only changes where the ordinary capture is already sharp enough.
 */
function sharpPlan(mags, fine) {
  const plan = mags.map((m) => zoomFor(m, fine));
  for (let i = 1; i < plan.length; i++) if (plan[i] === 1 && plan[i - 1] > 1 && mags[i] > 0.98) plan[i] = 2;
  for (let i = plan.length - 2; i >= 0; i--) if (plan[i] === 1 && plan[i + 1] > 1 && mags[i] > 0.98) plan[i] = 2;
  return plan;
}

/**
 * Do two captures of the same instant show the same picture? Both are reduced to 64×64 grey and compared.
 * A large layout can exhaust Chrome's tile memory (parts of the frame silently go missing) or, rarely, wrap a line
 * differently — either way the oversized capture must not be trusted. Honest pairs score above 35 dB, broken ones below 15.
 */
async function samePicture(a, b) {
  const run = ffmpeg(['-f', 'image2pipe', '-c:v', 'mjpeg', '-i', 'pipe:0', '-vf', 'scale=64:64:flags=area,format=gray', '-f', 'rawvideo', 'pipe:1'], { pipe: true, out: true });
  const chunks = []; run.proc.stdout.on('data', (d) => chunks.push(d));
  run.stdin.write(a); run.stdin.end(b);
  try { await run.done; } catch { return false; }
  const px = Buffer.concat(chunks);
  if (px.length !== 8192) return false;
  let sum = 0; for (let i = 0; i < 4096; i++) { const d = px[i] - px[i + 4096]; sum += d * d; }
  return 10 * Math.log10((255 * 255) / Math.max(1e-9, sum / 4096)) >= 28;
}
/** Switch the page to `zoom` and confirm it still draws what the base layout draws at time t; falls back to `base` if not. */
async function trustedZoom(comp, page, t, zoom, base) {
  if (zoom <= base) return base;
  const q = { type: 'jpeg', quality: 80 };
  await comp.view(page, { zoom: base }); await comp.seek(page, t); const ref = await comp.shot(page, q);
  await comp.view(page, { zoom }); await comp.seek(page, t); const big = await comp.shot(page, q);
  return (await samePicture(ref, big)) ? zoom : base;
}

/** Still frames at explicit times → PNG files. Returns [{ t, file }]. */
export async function frames(file, { at, out, scale = 1, stamp = false, vars, blur = 1, shutter = 180, sharp = true } = {}) {
  const comp = await openComposition(file, { scale, vars });
  try {
    const times = (at && at.length ? at : [0]).map((t) => Math.min(Math.max(0, t), comp.meta.duration));
    const dir = ensureDir(out || path.join(path.dirname(path.resolve(file)), 'out', 'frames'));
    const base = path.basename(file, '.html');
    const page = comp.pages[0], res = [];
    const size = [Math.round(comp.meta.width * scale), Math.round(comp.meta.height * scale)];
    if (stamp) await page.evaluate(() => __motion.stamp(true));
    for (const t of times) {
      const f = path.join(dir, `${base}@${t.toFixed(2)}s.png`);
      const zoom = sharp ? await trustedZoom(comp, page, t, zoomFor(await magnified(page, t), true), 1) : 1;
      await comp.view(page, { zoom });
      const n = blur > 1 ? (blur >= 32 ? 32 : blur >= 16 ? 16 : blur >= 8 ? 8 : blur >= 4 ? 4 : 2) : 1, open = (shutter / 360) / comp.meta.fps, group = [];
      for (let k = 0; k < n; k++) { await comp.seek(page, t + (k / n) * open); group.push(await comp.shot(page)); }
      fs.writeFileSync(f, n > 1 || zoom > 1 ? (await blendChunk([group], n, { size: zoom > 1 ? size : null }))[0] : group[0]);
      res.push({ t, file: f, zoom });
    }
    return { meta: comp.meta, frames: res, problems: comp.problems };
  } finally { await comp.close(); }
}

/** Contact sheet: N frames tiled with timecodes, for reviewing rhythm and composition at a glance. */
export async function sheet(file, { at, count = 12, cols, out, width, from, to, vars, beats } = {}) {
  const probe = await openComposition(file, { scale: 1, vars });
  let meta, shots = [], problems;
  try {
    meta = probe.meta; problems = probe.problems;
    const a = from ?? 0, b = to ?? meta.duration;
    let times = at && at.length ? at : Array.from({ length: count }, (_, i) => +(a + ((b - a) * i) / (count - 1 || 1)).toFixed(3));
    if (beats && !(at && at.length)) {            // one tile per beat, two frames after the hit so the beat's picture is on screen
      const len = 60 / beats; times = [];
      for (let n = 0; a + n * len <= b + 1e-6 && times.length < 60; n++) times.push(Math.min(meta.duration, Math.round((a + n * len) * meta.fps) / meta.fps + 2 / meta.fps));
    }
    width = width || (meta.height > meta.width ? 1800 : 2400);
    const portrait = meta.height > meta.width;
    cols = cols || (portrait ? Math.min(times.length, 6) : Math.min(times.length, 4));
    const tileW = Math.floor((width - (cols + 1) * 12) / cols);
    const page = probe.pages[0];
    await probe.view(page, { scale: Math.min(1, (tileW / meta.width) * 1.5) });
    for (const t of times) { await probe.seek(page, Math.min(t, meta.duration)); shots.push({ t, data: (await probe.shot(page, { type: 'jpeg', quality: 90 })).toString('base64') }); }
    const tileH = Math.round((tileW * meta.height) / meta.width);
    const rows = Math.ceil(times.length / cols);
    const W = cols * tileW + (cols + 1) * 12, H = rows * (tileH + 30) + 12 + 34;
    const html = `<!doctype html><meta charset="utf-8"><style>
      body{margin:0;background:#0c0c0e;color:#d9d9e0;font:600 15px/1 ui-monospace,Menlo,Consolas,monospace}
      h1{margin:0;padding:11px 12px 0;font:600 13px/1 ui-monospace,Menlo,Consolas,monospace;color:#8a8a96;letter-spacing:.04em}
      .g{display:grid;grid-template-columns:repeat(${cols},${tileW}px);gap:12px;padding:12px}
      figure{margin:0} img{display:block;width:${tileW}px;height:${tileH}px;background:#000;outline:1px solid #2a2a31}
      figcaption{height:18px;padding-top:6px;color:#f0f0f4} figcaption span{color:#74747f;margin-left:8px}
    </style><h1>${path.basename(file)} · ${meta.width}×${meta.height} · ${meta.duration}s · ${meta.fps}fps</h1><div class="g">${shots.map((s) => `<figure><img src="data:image/jpeg;base64,${s.data}"><figcaption>${s.t.toFixed(2)}s <span>f${Math.round(s.t * meta.fps)}</span></figcaption></figure>`).join('')}</div>`;
    await probe.view(page, { scale: 1, zoom: 1, width: W, height: H });
    await page.setContent(html, { waitUntil: 'load' });
    const f = path.resolve(out || path.join(path.dirname(path.resolve(file)), 'out', path.basename(file, '.html') + '.sheet.png'));
    ensureDir(path.dirname(f));
    fs.writeFileSync(f, await probe.shot(page));
    return { meta, file: f, times, problems };
  } finally { await probe.close(); }
}

/** Split a stream of concatenated PNG files into individual images. */
function pngSplitter(onFrame) {
  let buf = Buffer.alloc(0);
  return (chunk) => {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (buf.length < 8) return;
      let p = 8, end = -1;
      while (p + 8 <= buf.length) {
        const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
        p += 12 + len;
        if (type === 'IEND') { end = p; break; }
      }
      if (end < 0 || end > buf.length) return;
      onFrame(buf.subarray(0, end));
      buf = buf.subarray(end);
    }
  };
}

/** BT.709 tags, set on the frames themselves: current ffmpeg takes a stream's colour description from its frames, not from encoder options. */
const TAG709 = 'setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv';
const LIN = "lutrgb=r='pow(val/maxval,2.2)*maxval':g='pow(val/maxval,2.2)*maxval':b='pow(val/maxval,2.2)*maxval'";
const GAM = "lutrgb=r='pow(val/maxval,1/2.2)*maxval':g='pow(val/maxval,1/2.2)*maxval':b='pow(val/maxval,1/2.2)*maxval'";

/**
 * Average sub-frames into frames (motion blur) and bring oversized captures back to `size`, in linear light like a real sensor.
 * groups: per output frame an array of 1…S PNG buffers → resolves to one PNG per frame.
 */
async function blendChunk(groups, S, { linear = true, alpha = false, size = null, codec = 'png' } = {}) {
  const vf = [];
  if (alpha) vf.push('format=gbrap16le', 'premultiply=inplace=1'); // edges over transparency only average correctly when premultiplied
  else if (linear) vf.push('format=gbrp16le', LIN);
  else vf.push('format=gbrp');
  if (size) vf.push(`scale=${size[0]}:${size[1]}:flags=lanczos`, alpha ? 'format=gbrap16le' : linear ? 'format=gbrp16le' : 'format=gbrp'); // pin the depth: left free, the scaler would hand 8 bits to the gamma step and crush the darks
  if (S > 1) vf.push(`tmix=frames=${S}`, `select='not(mod(n+1,${S}))'`);
  if (alpha) vf.push('unpremultiply=inplace=1');
  else if (linear) vf.push(GAM);
  vf.push(alpha ? 'format=rgba' : 'format=rgb24');
  const mix = ffmpeg(['-f', 'image2pipe', '-c:v', codec, '-i', 'pipe:0', '-vf', vf.join(','), '-fps_mode', 'passthrough', '-f', 'image2pipe', '-c:v', 'png', '-compression_level', '1', '-pred', 'none', 'pipe:1'], { pipe: true, out: true });
  const frames = [];
  mix.proc.stdout.on('data', pngSplitter((f) => frames.push(Buffer.from(f))));
  let failed = null; mix.done.catch((e) => { failed = e; });
  for (const g of groups) {
    const rep = S / g.length;
    for (const b of g) for (let k = 0; k < rep; k++) { if (failed) throw failed; if (!mix.stdin.write(b)) await new Promise((r) => { mix.stdin.once('drain', r); setTimeout(r, 4000); }); }
  }
  mix.stdin.end();
  await mix.done;
  if (frames.length !== groups.length) throw new Error(`모션 블러 합성 실패: ${groups.length}프레임 중 ${frames.length}프레임만 나왔습니다.`);
  return frames;
}

/**
 * Render to video.
 * Motion blur is real and adaptive: for every frame the page reports how far things move while the shutter is open;
 * still frames are captured once, fast frames up to `blur` times, and the sub-frames are averaged in linear light.
 * Sharpness is adaptive too: frames where tilted content is enlarged are captured from a 2× or 3× layout and scaled down.
 */
export async function render(file, o = {}) {
  const q = QUALITY[o.quality || 'standard'] || QUALITY.standard;
  const format = (o.format || (o.out && path.extname(o.out).slice(1)) || 'mp4').toLowerCase();
  const alpha = !!o.alpha && ['webm', 'mov', 'prores', 'png'].includes(format);
  const scale = o.scale ?? q.scale, ss = Math.max(1, Math.min(4, Math.round(o.ss ?? 1)));
  let S = Math.max(1, Math.round(o.blur ?? q.blur));
  S = S >= 32 ? 32 : S >= 16 ? 16 : S >= 8 ? 8 : S >= 4 ? 4 : S >= 2 ? 2 : 1;
  const captureType = alpha || S > 1 ? 'png' : (o.capture || q.capture);
  const workers = Math.max(1, Math.min(o.workers ?? Math.max(2, Math.min(4, Math.floor(os.cpus().length / 2))), 8));
  const sharp = o.sharp !== false && captureType === 'png' && q !== QUALITY.draft, fine = q === QUALITY.final;
  const started = Date.now();

  const comp = await openComposition(file, { pages: workers, scale, zoom: ss, alpha, vars: o.vars });
  const meta = comp.meta;
  const fps = o.fps || meta.fps;
  const t0 = Math.max(0, o.from ?? 0), t1 = Math.min(meta.duration, o.to ?? meta.duration);
  const N = Math.max(1, Math.round((t1 - t0) * fps));
  const shutter = ((o.shutter ?? 180) / 360) / fps; // seconds the virtual shutter stays open
  const outW = even(meta.width * scale), outH = even(meta.height * scale);
  const capW = Math.round(meta.width * scale * ss), capH = Math.round(meta.height * scale * ss); // what the encoder receives
  const base = path.basename(file, '.html');
  const outDir = ensureDir(o.out ? path.dirname(path.resolve(o.out)) : path.join(path.dirname(path.resolve(file)), 'out'));
  const ext = { mp4: 'mp4', webm: 'webm', mov: 'mov', prores: 'mov', gif: 'gif', webp: 'webp', png: '' }[format];
  if (ext === undefined) { await comp.close(); throw new Error('지원하지 않는 형식: ' + format + ' (mp4 | webm | mov | gif | webp | png)'); }
  const outFile = o.out ? path.resolve(o.out) : path.join(outDir, base + (ext ? '.' + ext : '-frames'));
  const twoStep = format === 'gif' || format === 'webp';
  const videoFile = twoStep ? path.join(os.tmpdir(), `motion-${process.pid}-${Date.now()}.mp4`) : outFile;

  // ── encoder: receives exactly one image per output frame ──
  const vf = [];
  const needScale = outW !== capW || outH !== capH;
  const args = ['-f', 'image2pipe', '-framerate', String(fps), '-c:v', captureType === 'png' ? 'png' : 'mjpeg', '-i', 'pipe:0'];
  const hasAudio = o.audio && fs.existsSync(o.audio) && !twoStep && format !== 'png';
  if (hasAudio) args.push('-i', path.resolve(o.audio));

  if (format === 'png') {
    ensureDir(outFile);
    if (needScale) vf.push(`scale=${outW}:${outH}:flags=lanczos`);
    if (vf.length) args.push('-vf', vf.join(','));
    args.push('-r', String(fps), path.join(outFile, base + '-%05d.png'));
  } else if (format === 'webm') {
    vf.push(`scale=${outW}:${outH}:flags=lanczos:out_color_matrix=bt709:out_range=tv`, alpha ? 'format=yuva420p' : 'format=yuv420p', TAG709);
    args.push('-vf', vf.join(','), '-r', String(fps), '-c:v', 'libvpx-vp9', '-crf', String(o.crf ?? 22), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2');
  } else if (format === 'mov' || format === 'prores') {
    vf.push(`scale=${outW}:${outH}:flags=lanczos:out_color_matrix=bt709:out_range=tv`, alpha ? 'format=yuva444p10le' : 'format=yuv422p10le', TAG709);
    args.push('-vf', vf.join(','), '-r', String(fps), '-c:v', 'prores_ks', '-profile:v', alpha ? '4' : '3', '-vendor', 'apl0', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709');
  } else {
    vf.push(`scale=${outW}:${outH}:flags=lanczos+accurate_rnd+full_chroma_int:out_color_matrix=bt709:out_range=tv`, 'format=yuv420p', TAG709);
    args.push('-vf', vf.join(','), '-r', String(fps), '-c:v', 'libx264', '-preset', o.preset || q.preset, '-crf', String(o.crf ?? q.crf), '-profile:v', 'high', '-bf', '2', '-g', String(fps * 2),
      '-x264-params', 'aq-mode=3:aq-strength=0.9:deblock=-1,-1', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', '-movflags', '+faststart');
  }
  if (hasAudio) {
    const d = t1 - t0;
    args.push('-map', '0:v:0', '-map', '1:a:0', '-af', `afade=t=in:st=0:d=0.05,afade=t=out:st=${Math.max(0, d - 0.7).toFixed(2)}:d=0.7`, '-c:a', format === 'webm' ? 'libopus' : 'aac', '-b:a', '192k', '-t', d.toFixed(3));
  }
  if (format !== 'png') args.push(videoFile);

  const enc = ffmpeg(args, { pipe: true });
  let encErr = null; enc.done.catch((e) => { encErr = e; });
  const bar = o.quiet ? () => {} : (o.onProgress || progressBar('render'));

  // ── work in small chunks: capture in parallel, blend only the chunks that move, write in order ──
  const CHUNK = 6, chunks = Math.ceil(N / CHUNK);
  let next = 0, written = 0, captures = 0, blurred = 0, sharpened = 0, distrusted = 0, doneFrames = 0, waiters = [];
  const ready = new Map();
  const wait = () => new Promise((r) => { waiters.push(r); setTimeout(r, 80); });
  const flush = () => {
    while (ready.has(written)) {
      const list = ready.get(written); ready.delete(written);
      for (const b of list) enc.stdin.write(b);
      written++; doneFrames += list.length;
      bar(doneFrames, N, `· 캡처 ${captures} · ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
    const w = waiters; waiters = []; w.forEach((r) => r());
  };
  const opts = { type: captureType, quality: o.jpegQuality ?? 100 };
  let plan = null;
  if (sharp) {
    const mags = [];
    for (let c = 0; c < chunks; c++) {
      const times = []; for (let i = c * CHUNK; i < Math.min(N, (c + 1) * CHUNK); i++) times.push(t0 + i / fps);
      mags.push(await comp.pages[0].evaluate((ts) => (window.__motion.sharp ? Math.max.apply(null, ts.map((t) => window.__motion.sharp(t))) : 0), times));
    }
    plan = sharpPlan(mags, fine);
  }
  const pick = (d) => (d < 1.5 ? 1 : d < 4 ? 2 : d < 10 ? 4 : d < 28 ? 8 : d < 80 ? 16 : 32); // px travelled while the shutter is open → sub-frames
  async function work(page) {
    for (;;) {
      if (encErr) throw encErr;
      const c = next++; if (c >= chunks) return;
      while (c - written > workers * 2 || enc.stdin.writableLength > 128 * 1024 * 1024) await wait();
      const first = c * CHUNK, last = Math.min(N, first + CHUNK);
      const counts = [];
      for (let i = first; i < last; i++) {
        const t = t0 + i / fps;
        counts.push(S > 1 ? Math.min(S, pick(await page.evaluate((a, b) => window.__motion.motion(a, b), t, t + shutter * (1 - 1 / S)))) : 1);
      }
      const calm = Math.min(...counts);                       // motion blur hides softness: a whip needs no extra pixels
      const want = Math.max(ss, !plan || calm >= 16 ? 1 : Math.min(plan[c], calm >= 8 ? 2 : 3));
      const zoom = await trustedZoom(comp, page, t0 + first / fps, want, ss);   // never trust a large layout unseen
      if (zoom !== want) distrusted += counts.length;
      await comp.view(page, { zoom });
      const Sc = Math.max(...counts), size = zoom !== ss ? [capW, capH] : null;
      // oversized captures are scaled down 2–3×: there a high-quality JPEG is indistinguishable from PNG (≈ 51 dB) and a third faster
      const jpeg = !!size && !alpha, shotOpts = jpeg ? { type: 'jpeg', quality: 95 } : opts;
      const groups = [];
      for (let i = first; i < last; i++) {
        const t = t0 + i / fps, n = counts[i - first], g = [];
        for (let k = 0; k < n; k++) { await comp.seek(page, t + (k / n) * shutter); g.push(await comp.shot(page, shotOpts)); captures++; }
        groups.push(g);
      }
      blurred += counts.filter((n) => n > 1).length;
      if (size) sharpened += counts.length;
      ready.set(c, Sc > 1 || size ? await blendChunk(groups, Sc, { linear: o.linear !== false, alpha, size, codec: jpeg ? 'mjpeg' : 'png' }) : groups.map((g) => g[0]));
      flush();
    }
  }
  try {
    await Promise.all(comp.pages.map(work));
    flush(); enc.stdin.end();
    await enc.done;
    if (o.poster !== undefined && o.poster !== false) {
      const pt = o.poster === true ? meta.duration * 0.6 : +o.poster;
      await comp.seek(comp.pages[0], pt);
      fs.writeFileSync(path.join(outDir, base + '.poster.png'), await comp.shot(comp.pages[0]));
    }
  } catch (e) { try { enc.proc.kill(); } catch { /* already gone */ } throw encErr || e; }
  finally { await comp.close(); }

  if (twoStep) {
    const w = o.width || (format === 'gif' ? Math.min(outW, 480) : Math.min(outW, 540)), r = o.gifFps || (format === 'gif' ? 15 : 20);
    if (format === 'gif') await ffmpeg(['-i', videoFile, '-vf', `fps=${r},scale=${w}:-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=160:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, '-loop', '0', outFile]).done;
    else await ffmpeg(['-i', videoFile, '-vf', `fps=${r},scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-q:v', String(o.webpQuality ?? 68), '-compression_level', '5', '-loop', '0', '-an', outFile]).done;
    fs.rmSync(videoFile, { force: true });
  }
  const size = format === 'png' ? 0 : fs.statSync(outFile).size;
  return { file: outFile, width: outW, height: outH, fps, frames: N, samples: S, captures, blurred, sharpened, distrusted, duration: +(N / fps).toFixed(3), seconds: +((Date.now() - started) / 1000).toFixed(1), size: fmtBytes(size), problems: comp.problems };
}
