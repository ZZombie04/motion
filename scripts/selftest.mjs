#!/usr/bin/env node
// 설치 확인: 뼈대 생성 → 자동 점검 → 짧은 렌더(소리 포함)까지, 그리고 소리·자막·점수·검수 모듈을 한 번씩 돌려 본다.  npm test
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
import { SFX_NAMES, renderSfx, wavBytes, SR } from '../lib/sfx.mjs';
import { analyze } from '../lib/audio.mjs';
import { alignCaptions, planCaptions } from '../lib/captions.mjs';
import { score } from '../lib/score.mjs';
import { verify } from '../lib/verify.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-selftest-'));
const quick = process.argv.includes('--quick');
let failed = 0;
const step = async (name, fn) => {
  const t = Date.now();
  try { const note = await fn(); console.log(`✓ ${name}${note ? ' — ' + note : ''} (${((Date.now() - t) / 1000).toFixed(1)}s)`); }
  catch (e) { failed++; console.log(`✖ ${name}\n  ${String(e && e.message || e).split('\n').join('\n  ')}`); }
};
const html = (body, script, attrs = 'data-width="1080" data-height="1080" data-fps="30" data-duration="2" data-theme="ink" data-accent="blue"') => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><link rel="icon" href="data:,">
<link rel="stylesheet" href="./_motion/motion.css"><script src="./_motion/gsap.min.js"></script><script src="./_motion/icons.js"></script><script src="./_motion/motion.js"></script></head><body>
<div id="stage" ${attrs}>${body}</div><script>Motion.compose((M) => { ${script} });</script></body></html>`;
const probe = (file, entries) => { const p = spawnSync(findFfmpeg().replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1'), ['-v', 'error', '-show_entries', entries, '-of', 'csv=p=0', file], { encoding: 'utf8' }); return p.status === 0 ? p.stdout.trim() : ''; };

await step('Chrome/Edge', () => { const c = findChrome(); if (!c) throw new Error('찾지 못했습니다. Chrome을 설치하거나 MOTION_CHROME을 지정하세요.'); return c; });
await step('ffmpeg', () => { const f = findFfmpeg(); if (!f) throw new Error('찾지 못했습니다. ffmpeg를 설치하세요.'); return f; });
await step('리프롬프트(brief)', () => { const b = brief('우리 학교 가을 운동회 홍보 쇼츠 오프닝, 10월 24일'); if (b.format !== 'shorts' || b.purpose !== 'event') throw new Error('추정 결과가 예상과 다릅니다: ' + b.format + '/' + b.purpose); return `${b.format} · ${b.duration}s · ${b.look.theme}`; });

// sound & captions modules (no browser needed)
await step('효과음 합성', () => {
  const bad = SFX_NAMES.filter((n) => { const x = renderSfx(n); let pk = 0; for (const v of x) pk = Math.max(pk, Math.abs(v)); return !(x.length > SR * 0.01 && pk > 0.5 && pk <= 0.9); });
  if (bad.length) throw new Error('이상한 효과음: ' + bad.join(', '));
  return SFX_NAMES.length + '종';
});
const beatWav = path.join(dir, 'beat.wav');
await step('음악 분석(120 BPM 테스트 비트)', () => {
  const n = Math.round(9 * SR), x = new Float32Array(n);
  for (let b = 0; b < 16; b++) { const o = Math.round((0.5 + b * 0.5) * SR); for (let i = 0; i < SR * 0.25 && o + i < n; i++) { const t = i / SR; x[o + i] += Math.sin(2 * Math.PI * (50 * t + 3.6 * (1 - Math.exp(-t / 0.04)))) * Math.exp(-t / 0.12) * 0.8; } }
  fs.writeFileSync(beatWav, wavBytes(x));
  const a = analyze(beatWav);
  if (Math.abs(a.bpm - 120) > 2) throw new Error('BPM ' + a.bpm + ' (기대 120)');
  if (Math.abs(a.beats[0] - 0.5) > 0.03) throw new Error('첫 박 ' + a.beats[0] + 's (기대 0.5s)');
  return `${a.bpm} BPM · 박 ${a.beats.length}개 · 첫 박 ${a.beats[0]}s`;
});
await step('자막 계획·정렬', () => {
  const script = '첫 문장입니다. 두 번째 문장은 조금 깁니다. 마지막 문장.';
  const plan = planCaptions(script); if (plan.length !== 3) throw new Error('계획 문장 수 ' + plan.length);
  const n = Math.round(6 * SR), x = new Float32Array(n), segs = [[0.3, 1.2], [1.8, 3.3], [3.9, 4.6]];
  let s = 7; const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 * 2 - 1; };
  for (const [a, b] of segs) for (let i = Math.round(a * SR); i < b * SR; i++) x[i] = rnd() * 0.3 * Math.sin(Math.PI * (i / SR - a) / (b - a));
  const f = path.join(dir, 'voice.wav'); fs.writeFileSync(f, wavBytes(x));
  const cues = alignCaptions(script, f);
  const off = cues.map((c, i) => Math.abs(c.start - segs[i][0])); if (cues.length !== 3 || Math.max(...off) > 0.12) throw new Error('정렬 오차: ' + cues.map((c) => c.start).join(', '));
  return '문장 3개, 최대 오차 ' + Math.max(...off).toFixed(2) + 's';
});

for (const tpl of listTemplates()) {
  const sub = path.join(dir, 'tpl-' + tpl); fs.mkdirSync(sub);
  const file = path.join(sub, tpl + '.html');
  await step(`템플릿 ${tpl}: 생성·점검`, async () => {
    scaffold({ file, template: tpl });
    const r = await check(file, { step: 0.25 });
    if (r.summary.errors) throw new Error(r.issues.filter((i) => i.level === 'error').map((i) => `[${i.code}] ${i.msg}`).join('\n'));
    return `오류 0 · 경고 ${r.summary.warnings}`;
  });
}
const first = path.join(dir, 'tpl-blank', 'blank.html');
await step('콘택트 시트', async () => { const r = await sheet(first, { count: 6 }); if (!fs.existsSync(r.file) || fs.statSync(r.file).size < 5000) throw new Error('시트가 비어 있습니다.'); return path.basename(r.file); });
await step('렌더(모션 블러 포함, 1.5초)', async () => {
  const r = await render(first, { quality: 'standard', to: 1.5, workers: 2, quiet: true });
  if (!fs.existsSync(r.file) || fs.statSync(r.file).size < 2000) throw new Error('영상 파일이 만들어지지 않았습니다.');
  const [trc, dur] = probe(r.file, 'stream=color_transfer:format=duration').split(/\s+/);
  if (trc && trc !== 'bt709') throw new Error('영상에 BT.709 색 정보가 붙지 않았습니다: ' + trc);
  return `${r.width}×${r.height} · ${r.frames}프레임 · ${r.size}${dur ? ' · ' + (+dur).toFixed(2) + 's · bt709' : ''}`;
});
await step('소리: 음악 박 + 효과음 + 선언형 속성 → 믹스·음량', async () => {
  fs.copyFileSync(beatWav, path.join(dir, 'tpl-blank', 'beat.wav'));
  const f = path.join(dir, 'tpl-blank', 'sound.html');
  fs.writeFileSync(f, html('<audio src="beat.wav" data-start="0"></audio><div class="mo-world"><h1 class="mo-h1" id="h" data-reveal="pop b1 sfx" style="position:absolute;left:10%;top:40%">박자</h1></div>',
    "M.grain(); M.cam.drift({ zoom: 1.03 }); const m = M.audio('beat.wav'); if (Math.abs(m.bpm - 120) > 2) throw new Error('bpm ' + m.bpm); M.sfx('whoosh', 0.3);", 'data-width="1080" data-height="1080" data-fps="30" data-duration="3" data-theme="ink" data-accent="blue"'));
  const r = await render(f, { quality: 'draft', workers: 1, quiet: true });
  if (!r.audio || !r.audio.music || !r.audio.sfx) throw new Error('소리가 믹스되지 않았습니다: ' + JSON.stringify(r.audio));
  const v = await verify(r.file, { strip: false });
  if (!v.info.audio || v.info.audio.loudness == null || Math.abs(v.info.audio.loudness + 14) > 2) throw new Error('음량이 −14 LUFS 근처가 아닙니다: ' + (v.info.audio && v.info.audio.loudness));
  return `aac · ${v.info.audio.loudness} LUFS · 효과음 ${r.audio.sfx ? 'ok' : '-'}`;
});
if (!quick) {
  await step('감독 점수', async () => { const s = await score(path.join(dir, 'tpl-hook', 'hook.html'), { step: 0.2 }); return `${s.total}/100 (${s.grade}) · 슬라이드쇼 위험 ${s.slideshow.risk}`; });
  await step('기울인 확대 장면(선명 보정 + 원본 대조)', async () => {
    const file = path.join(dir, 'tilt.html');
    fs.writeFileSync(file, html('<div class="mo-world"><div class="mo-card" id="c" style="position:absolute;left:35%;top:36%;width:30%"><h3 class="mo-h3">기울여도 또렷하게</h3></div></div>', "M.cam.set({ zoom: 1.6, ry: 12, rx: 4 }); M.cam.to({ zoom: 1.8, duration: 1 }, 0);", 'data-width="1280" data-height="720" data-fps="30" data-duration="1" data-theme="ink" data-accent="blue"'));
    const r = await render(file, { quality: 'standard', workers: 1, quiet: true });
    if (!r.sharpened) throw new Error('기울인 확대 프레임을 크게 찍지 않았습니다.');
    if (r.distrusted) throw new Error(`큰 레이아웃이 원본과 달라 ${r.distrusted}프레임을 일반 캡처로 대체했습니다(타일 메모리 부족 가능 — MOTION_TILE_MB).`);
    return `선명 보정 ${r.sharpened}/${r.frames}프레임`;
  });
  await step('3D(WebGL)', async () => {
    const file = path.join(dir, 'three.html');
    fs.writeFileSync(file, html('<canvas id="g" style="position:absolute;inset:0;width:100%;height:100%"></canvas>', "M.three('#g', (THREE, { scene, camera }) => { const m = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshNormalMaterial()); scene.add(m); camera.position.z = 6; return (t) => { m.rotation.y = t; }; });", 'data-width="640" data-height="360" data-fps="30" data-duration="1" data-theme="ink" data-accent="blue"'));
    const r = await check(file, { step: 0.5 });
    if (r.summary.errors) throw new Error(r.issues.map((i) => i.msg).join('\n'));
    return 'ok';
  });
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed}개 실패` : '\n모두 통과 — 사용할 준비가 됐습니다.');
process.exit(failed ? 1 : 0);
