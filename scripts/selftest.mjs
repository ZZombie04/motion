#!/usr/bin/env node
// 설치 확인: 뼈대 생성 → 자동 점검 → 짧은 렌더까지 한 번에 돌려 본다.  npm test
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findChrome } from '../lib/browser.mjs';
import { findFfmpeg } from '../lib/ffmpeg.mjs';
import { scaffold, listTemplates } from '../lib/project.mjs';
import { check } from '../lib/check.mjs';
import { render, sheet } from '../lib/render.mjs';
import { brief } from '../lib/brief.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-selftest-'));
let failed = 0;
const step = async (name, fn) => {
  const t = Date.now();
  try { const note = await fn(); console.log(`✓ ${name}${note ? ' — ' + note : ''} (${((Date.now() - t) / 1000).toFixed(1)}s)`); }
  catch (e) { failed++; console.log(`✖ ${name}\n  ${String(e && e.message || e).split('\n').join('\n  ')}`); }
};

await step('Chrome/Edge', () => { const c = findChrome(); if (!c) throw new Error('찾지 못했습니다. Chrome을 설치하거나 MOTION_CHROME을 지정하세요.'); return c; });
await step('ffmpeg', () => { const f = findFfmpeg(); if (!f) throw new Error('찾지 못했습니다. ffmpeg를 설치하세요.'); return f; });
await step('리프롬프트(brief)', () => { const b = brief('우리 학교 가을 운동회 홍보 쇼츠 오프닝, 10월 24일'); if (b.format !== 'shorts' || b.purpose !== 'event') throw new Error('추정 결과가 예상과 다릅니다: ' + b.format + '/' + b.purpose); return `${b.format} · ${b.duration}s · ${b.look.theme}`; });

for (const tpl of listTemplates()) {
  const file = path.join(dir, tpl + '.html');
  await step(`템플릿 ${tpl}: 생성·점검`, async () => {
    scaffold({ file, template: tpl, format: tpl === 'ui' ? 'insert' : 'shorts', duration: tpl === 'ui' ? 6.5 : 6 });
    const r = await check(file, { step: 0.25 });
    if (r.summary.errors) throw new Error(r.issues.filter((i) => i.level === 'error').map((i) => `[${i.code}] ${i.msg}`).join('\n'));
    return `오류 0 · 경고 ${r.summary.warnings}`;
  });
}
const first = path.join(dir, listTemplates()[0] + '.html');
await step('콘택트 시트', async () => { const r = await sheet(first, { count: 6 }); if (!fs.existsSync(r.file) || fs.statSync(r.file).size < 5000) throw new Error('시트가 비어 있습니다.'); return path.basename(r.file); });
await step('렌더(모션 블러 포함, 1.5초)', async () => {
  const r = await render(first, { quality: 'standard', to: 1.5, workers: 2, quiet: true });
  if (!fs.existsSync(r.file) || fs.statSync(r.file).size < 2000) throw new Error('영상 파일이 만들어지지 않았습니다.');
  const p = spawnSync(findFfmpeg().replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'), ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=color_transfer:format=duration', '-of', 'csv=p=0', r.file], { encoding: 'utf8' });
  const [trc, dur] = p.status === 0 ? p.stdout.trim().split(/\s+/) : [];
  if (p.status === 0 && trc !== 'bt709') throw new Error('영상에 BT.709 색 정보가 붙지 않았습니다: ' + trc);
  return `${r.width}×${r.height} · ${r.frames}프레임 · ${r.size}${dur ? ' · ' + (+dur).toFixed(2) + 's · bt709' : ''}`;
});
await step('기울인 확대 장면(선명 보정 + 원본 대조)', async () => {
  const file = path.join(dir, 'tilt.html');
  fs.writeFileSync(file, `<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="icon" href="data:,">
<link rel="stylesheet" href="./_motion/motion.css"><script src="./_motion/gsap.min.js"></script><script src="./_motion/icons.js"></script><script src="./_motion/motion.js"></script></head><body>
<div id="stage" data-width="1280" data-height="720" data-fps="30" data-duration="1" data-theme="ink" data-accent="blue">
  <div class="mo-world"><div class="mo-card" id="c" style="position:absolute;left:35%;top:36%;width:30%"><h3 class="mo-h3">기울여도 또렷하게</h3></div></div>
</div>
<script>Motion.compose((M) => { M.cam.set({ zoom: 1.6, ry: 12, rx: 4 }); M.cam.to({ zoom: 1.8, duration: 1 }, 0); });</script></body></html>`);
  const r = await render(file, { quality: 'standard', workers: 1, quiet: true });
  if (!r.sharpened) throw new Error('기울인 확대 프레임을 크게 찍지 않았습니다.');
  if (r.distrusted) throw new Error(`큰 레이아웃이 원본과 달라 ${r.distrusted}프레임을 일반 캡처로 대체했습니다(타일 메모리 부족 가능 — MOTION_TILE_MB).`);
  return `선명 보정 ${r.sharpened}/${r.frames}프레임`;
});

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed}개 실패` : '\n모두 통과 — 사용할 준비가 됐습니다.');
process.exit(failed ? 1 : 0);
