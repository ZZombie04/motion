#!/usr/bin/env node
// 샘플을 다시 렌더한다: samples/media/<이름>.mp4 + docs/media/<이름>.webp(README 미리보기) + 포스터.
//   node scripts/render-samples.mjs            전부
//   node scripts/render-samples.mjs 01 06      이름에 01·06이 들어간 것만
//   --quality standard|final (기본 final)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render, frames } from '../lib/render.mjs';
import { ffmpeg } from '../lib/ffmpeg.mjs';
import { check } from '../lib/check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const qi = args.indexOf('--quality'), quality = qi >= 0 ? args[qi + 1] : 'final';
const only = args.filter((a, i) => !a.startsWith('--') && (qi < 0 || i !== qi + 1));
const dir = path.join(root, 'samples'), media = path.join(dir, 'media'), docs = path.join(root, 'docs', 'media');
fs.mkdirSync(media, { recursive: true }); fs.mkdirSync(docs, { recursive: true });

// poster time (seconds) per sample; default = 60% of duration
const POSTER = { '01-ai-teacher': 8.7, '02-sports-day': 9.0, '03-participation': 6.6, '04-reading-app': 10.9, '05-three-steps': 19.2, '06-logo-sting': 3.4 };

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.html')).filter((f) => !only.length || only.some((o) => f.includes(o))).sort();
for (const f of files) {
  const name = f.replace('.html', ''), src = path.join(dir, f);
  const rep = await check(src);
  console.log(`\n■ ${name} — 점검: 오류 ${rep.summary.errors} · 경고 ${rep.summary.warnings}`);
  if (rep.summary.errors) { console.log(rep.issues.filter((i) => i.level === 'error').map((i) => '  ✖ ' + i.msg).join('\n')); continue; }
  const mp4 = path.join(media, name + '.mp4');
  const r = await render(src, { quality, out: mp4, crf: 21, quiet: true });
  console.log(`  ${r.width}×${r.height} · ${r.duration}s · 모션 블러 ${r.blurred}프레임 · 선명 보정 ${r.sharpened}프레임${r.distrusted ? ` · 보정 생략 ${r.distrusted}프레임` : ''} · ${r.size} · ${r.seconds}s`);
  const portrait = r.height > r.width, w = portrait ? 360 : 560;
  await ffmpeg(['-i', mp4, '-vf', `fps=15,scale=${w}:-2:flags=lanczos`, '-c:v', 'libwebp', '-q:v', '58', '-compression_level', '6', '-loop', '0', '-an', path.join(docs, name + '.webp')]).done;
  const pt = POSTER[name] ?? r.duration * 0.6;
  const shot = await frames(src, { at: [pt], out: path.join(root, 'work', 'out', 'posters') });
  await ffmpeg(['-i', shot.frames[0].file, '-vf', `scale=${portrait ? 720 : 1280}:-2:flags=lanczos`, '-q:v', '3', path.join(docs, name + '.jpg')]).done;
  console.log(`  → ${path.relative(root, mp4)} · docs/media/${name}.webp (${(fs.statSync(path.join(docs, name + '.webp')).size / 1048576).toFixed(1)} MB) · docs/media/${name}.jpg`);
}
