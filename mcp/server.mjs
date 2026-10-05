#!/usr/bin/env node
/**
 * Motion Director — MCP server (stdio).
 * Gives any MCP client (Claude Desktop · Claude Code · Codex · others) the whole workflow:
 * re-prompt a plain request into a treatment, scaffold, lint, look at frames, render.
 * stdout is the protocol channel — never print to it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { ROOT, VERSION, FORMATS, ensureDir } from '../lib/util.mjs';
import { brief } from '../lib/brief.mjs';

const WORKSPACE = path.resolve(process.env.MOTION_WORKSPACE || path.join(os.homedir(), 'Motion'));
const DOCS = {
  skill: ['SKILL.md', '작업 순서·규칙·빠른 참조(가장 먼저 읽는다)'],
  director: ['references/director.md', '요청을 연출로 바꾸는 법 — 의도→기법 표, 비트 시트, 예시'],
  look: ['references/look.md', '테마·색·타이포·구도·빛, 아마추어 티와 대안'],
  motion: ['references/motion.md', '이징·타이밍·카메라 어휘와 코드'],
  engine: ['references/engine.md', '런타임 API와 부품 마크업'],
  recipes: ['references/recipes.md', '장면 유형별 뼈대 코드'],
  quality: ['references/quality.md', '검수 기준, 점검 코드별 처방'],
  'chat-mode': ['references/chat-mode.md', '도구 없는 대화창에서 단일 HTML로 내는 법']
};
const doc = (k) => fs.readFileSync(path.join(ROOT, DOCS[k][0]), 'utf8');
const text = (s) => ({ content: [{ type: 'text', text: s }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: '✖ ' + (e && e.message || String(e)) }] });

/** Relative paths live in the workspace (~/Motion by default); absolute paths are used as given. */
function resolveFile(file) {
  const p = path.isAbsolute(file) ? file : path.join(WORKSPACE, file);
  return path.resolve(p.endsWith('.html') ? p : p + '.html');
}
/** Review switches travel to the page as URL parameters, next to the composition's own vars. */
const reviewVars = ({ vars, noCamera, guides } = {}) => [vars, noCamera ? 'nocam=1' : '', guides ? 'guides=1' : ''].filter(Boolean).join('&') || undefined;
function insideWorkspace(p) { const rel = path.relative(WORKSPACE, p); return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel); }

async function toJpeg(pngFile, maxEdge = 1568) {
  const { ffmpeg } = await import('../lib/ffmpeg.mjs');
  const run = ffmpeg(['-i', pngFile, '-vf', `scale='if(gt(iw,ih),min(${maxEdge},iw),-2)':'if(gt(iw,ih),-2,min(${maxEdge},ih))'`, '-q:v', '4', '-f', 'mjpeg', 'pipe:1'], { out: true });
  const chunks = []; run.proc.stdout.on('data', (d) => chunks.push(d));
  await run.done;
  return Buffer.concat(chunks).toString('base64');
}

const server = new McpServer({ name: 'motion-director', version: VERSION }, {
  instructions: [
    '말로 설명한 장면을 감독 수준의 모션그래픽 영상으로 만든다. 사용자가 기법 이름을 말하지 않아도 연출은 직접 정한다.',
    '순서: ① motion_brief(요청) — 연출 초안 ② motion_guide("skill"), 필요하면 "director"·"engine"·"recipes" ③ 트리트먼트 확정 ④ motion_new → 컴포지션 작성(motion_write 또는 파일 도구)',
    '⑤ motion_check 오류 0 ⑥ motion_sheet 이미지를 직접 보고 고친다(최소 1회) ⑦ motion_render. 보지 않고 납품하지 않는다.'
  ].join('\n')
});

// ── knowledge ──
server.registerTool('motion_brief', {
  title: '연출 초안(리프롬프트)',
  description: '평범한 말로 된 영상 요청을 받아 화면 비율·길이·룩·카메라·글자·전환 선택과 타임코드 비트 시트 틀을 제안한다. 모션그래픽 작업의 첫 호출. 결과를 바탕으로 트리트먼트를 확정한 뒤 제작한다.',
  inputSchema: {
    request: z.string().describe('사용자의 요청 원문'),
    format: z.enum(Object.keys(FORMATS)).optional().describe('화면: shorts | wide | square | portrait | insert'),
    duration: z.number().positive().optional().describe('길이(초)'),
    tone: z.enum(['tech', 'edu', 'event', 'data', 'warm', 'life', 'brand']).optional().describe('룩을 직접 고를 때')
  }
}, async ({ request, format, duration, tone }) => text(brief(request, { format, duration, tone }).text));

server.registerTool('motion_guide', {
  title: '제작 문서 읽기',
  description: '제작 규칙과 참조 문서를 돌려준다. skill(작업 순서·하드 룰) → director(연출법) → engine(API) → recipes(뼈대 코드) → look · motion · quality · chat-mode.',
  inputSchema: { topic: z.enum(Object.keys(DOCS)).describe(Object.entries(DOCS).map(([k, v]) => `${k}: ${v[1]}`).join(' / ')) }
}, async ({ topic }) => text(doc(topic)));

// ── authoring ──
server.registerTool('motion_new', {
  title: '컴포지션 뼈대 만들기',
  description: `새 컴포지션 HTML과 런타임(_motion/)을 만든다. 상대 경로는 작업 폴더(${WORKSPACE}) 기준.`,
  inputSchema: {
    file: z.string().describe('예: intro.html 또는 절대 경로'),
    format: z.enum(Object.keys(FORMATS)).optional(),
    duration: z.number().positive().optional(), theme: z.enum(['ink', 'night', 'paper', 'white', 'pop']).optional(),
    accent: z.string().optional().describe('blue cyan mint lime yellow amber orange red pink violet white 또는 #hex'),
    title: z.string().optional(), force: z.boolean().optional(),
    template: z.enum(['blank', 'hook', 'ui']).optional().describe('blank(기본) · hook(숫자 훅 + 엔드카드) · ui(입력 → 결과 시연)')
  }
}, async (a) => {
  try {
    const { scaffold } = await import('../lib/project.mjs');
    const f = scaffold({ ...a, file: resolveFile(a.file) });
    return text(`만들었습니다: ${f}\n\n${fs.readFileSync(f, 'utf8')}`);
  } catch (e) { return fail(e); }
});

server.registerTool('motion_write', {
  title: '컴포지션 저장',
  description: `컴포지션 파일 내용을 통째로 저장한다(파일 도구가 없는 클라이언트용). 작업 폴더(${WORKSPACE}) 안에만 쓸 수 있다.`,
  inputSchema: { file: z.string(), content: z.string().describe('파일 전체 내용') }
}, async ({ file, content }) => {
  try {
    const p = path.isAbsolute(file) ? path.resolve(file) : path.resolve(WORKSPACE, file);
    if (!insideWorkspace(p)) throw new Error(`작업 폴더 밖에는 쓸 수 없습니다: ${p}\n작업 폴더: ${WORKSPACE} (MOTION_WORKSPACE 환경변수로 변경)`);
    if (!/\.(html|css|js|json|svg|md|txt)$/i.test(p)) throw new Error('html · css · js · json · svg · md · txt 파일만 저장할 수 있습니다.');
    if (/[\\/](_motion|node_modules)[\\/]/.test(p)) throw new Error('_motion 런타임 폴더는 직접 고치지 않습니다.');
    ensureDir(path.dirname(p)); fs.writeFileSync(p, content);
    if (p.endsWith('.html')) { const { syncRuntime } = await import('../lib/project.mjs'); syncRuntime(path.dirname(p)); }
    return text(`저장했습니다: ${p} (${content.length.toLocaleString()}자)`);
  } catch (e) { return fail(e); }
});

server.registerTool('motion_read', {
  title: '컴포지션 읽기', description: '컴포지션 파일의 현재 내용을 돌려준다.',
  inputSchema: { file: z.string() }
}, async ({ file }) => {
  try { const p = resolveFile(file); if (!/\.(html|css|js|json|svg|md|txt)$/i.test(p)) throw new Error('텍스트 파일만 읽습니다.'); return text(fs.readFileSync(p, 'utf8')); } catch (e) { return fail(e); }
});

// ── review ──
server.registerTool('motion_check', {
  title: '자동 점검',
  description: '시간을 따라가며 실제 화면을 측정한다: 글자 겹침·잘림·작은 글자·낮은 대비·읽을 시간 부족·정지 구간·늦은 시작·안전영역. 오류가 0이 될 때까지 고친다.',
  inputSchema: { file: z.string(), step: z.number().positive().optional().describe('측정 간격(초), 기본 0.1') }
}, async ({ file, step }) => {
  try { const { check, formatReport } = await import('../lib/check.mjs'); return text(formatReport(await check(resolveFile(file), { step: step || 0.1 }))); } catch (e) { return fail(e); }
});

server.registerTool('motion_sheet', {
  title: '콘택트 시트 보기',
  description: '영상 전체를 여러 장의 스틸로 늘어놓은 이미지를 돌려준다. 흐름·구도·글자를 직접 보고 비평한다(quality 문서의 기준). 전환 구간은 from·to로 좁혀 촘촘히, 박자 영상은 beats(BPM)로 박마다 한 장.',
  inputSchema: {
    file: z.string(), count: z.number().int().min(2).max(40).optional(), at: z.array(z.number()).optional().describe('특정 시각들(초)'), cols: z.number().int().min(1).max(10).optional(),
    from: z.number().min(0).optional().describe('이 시각부터(초)'), to: z.number().positive().optional().describe('이 시각까지(초)'), beats: z.number().positive().optional().describe('BPM — 박마다 한 장'),
    guides: z.boolean().optional().describe('플랫폼 안전영역을 겹쳐 본다'), noCamera: z.boolean().optional().describe('카메라를 끄고 쉬는 배치만 본다'), vars: z.string().optional()
  }
}, async ({ file, count, at, cols, from, to, beats, guides, noCamera, vars }) => {
  try {
    const { sheet } = await import('../lib/render.mjs');
    const r = await sheet(resolveFile(file), { count: count || 15, at, cols, from, to, beats, vars: reviewVars({ vars, noCamera, guides }) });
    return { content: [{ type: 'text', text: `${r.file}\n${r.times.length}장 · ${r.meta.width}×${r.meta.height} · ${r.meta.duration}s${r.problems.length ? '\n⚠ ' + r.problems.join('\n⚠ ') : ''}` }, { type: 'image', data: await toJpeg(r.file, 1800), mimeType: 'image/jpeg' }] };
  } catch (e) { return fail(e); }
});

server.registerTool('motion_frames', {
  title: '원본 크기 스틸 보기',
  description: '지정한 시각의 프레임을 원본 해상도로 캡처해 이미지로 돌려준다(최대 6장). 커서 위치·여백·글자 디테일 확인용. 렌더와 같은 선명도이며, blur를 주면 모션 블러까지 같은 스틸이 된다.',
  inputSchema: {
    file: z.string(), at: z.array(z.number()).min(1).max(6).describe('시각(초)'), blur: z.number().int().min(0).max(32).optional().describe('모션 블러 샘플 수(예: 16)'),
    guides: z.boolean().optional(), noCamera: z.boolean().optional(), vars: z.string().optional()
  }
}, async ({ file, at, blur, guides, noCamera, vars }) => {
  try {
    const { frames } = await import('../lib/render.mjs');
    const r = await frames(resolveFile(file), { at, blur: blur || 1, vars: reviewVars({ vars, noCamera, guides }) });
    const content = [{ type: 'text', text: r.frames.map((f) => `${f.t.toFixed(2)}s → ${f.file}`).join('\n') }];
    for (const f of r.frames) content.push({ type: 'image', data: await toJpeg(f.file), mimeType: 'image/jpeg' });
    return { content };
  } catch (e) { return fail(e); }
});

// ── render (long jobs continue in the background) ──
const jobs = new Map();
let jobSeq = 0;
function describe(j) {
  if (j.error) return `✖ 렌더 실패: ${j.error}`;
  if (j.result) { const r = j.result; return `완료: ${r.file}\n${r.width}×${r.height} · ${r.fps}fps · ${r.duration}s · 모션 블러 ${r.blurred}프레임${r.sharpened ? ` · 선명 보정 ${r.sharpened}프레임` : ''}${r.distrusted ? ` · 보정 생략 ${r.distrusted}프레임` : ''} · ${r.size} · ${r.seconds}s`; }
  return `렌더 중 ${j.pct}% (${j.done}/${j.total}프레임) — job "${j.id}". 잠시 뒤 motion_render_status로 확인하세요.`;
}
server.registerTool('motion_render', {
  title: '영상으로 렌더',
  description: '컴포지션을 영상 파일로 만든다. quality: draft(빠른 확인, 절반 크기) · standard(검토, 모션 블러 최대 16샘플) · final(납품, 32샘플 + 기울어진 장면 고해상 캡처). format: mp4 · webm · mov · gif · webp · png. alpha는 mov/webm/png에서 투명 배경. 오래 걸리면 job 번호를 돌려주고 계속 진행한다.',
  inputSchema: {
    file: z.string(), quality: z.enum(['draft', 'standard', 'final']).optional(), format: z.enum(['mp4', 'webm', 'mov', 'gif', 'webp', 'png']).optional(),
    fps: z.number().int().positive().optional(), from: z.number().min(0).optional(), to: z.number().positive().optional(),
    alpha: z.boolean().optional(), audio: z.string().optional().describe('배경 음악 파일 경로'), out: z.string().optional(), vars: z.string().optional().describe('a=1&b=2 형태의 변수'),
    blur: z.number().int().min(0).max(32).optional().describe('모션 블러 샘플 수(0 = 끔)'), scale: z.number().positive().max(4).optional().describe('출력 배율(2 = 1080 레이아웃을 4K로)'),
    wait: z.number().min(0).max(240).optional().describe('완료를 기다릴 최대 초(기본 45)')
  }
}, async (a) => {
  try {
    const { render } = await import('../lib/render.mjs');
    const id = 'r' + (++jobSeq);
    const j = { id, pct: 0, done: 0, total: 0 }; jobs.set(id, j);
    const p = render(resolveFile(a.file), { ...a, out: a.out ? path.resolve(path.isAbsolute(a.out) ? a.out : path.join(WORKSPACE, a.out)) : undefined, quiet: false, onProgress: (d, t) => { j.done = d; j.total = t; j.pct = Math.floor((d / t) * 100); } })
      .then((r) => { j.result = r; }, (e) => { j.error = e.message || String(e); });
    await Promise.race([p, new Promise((r) => setTimeout(r, (a.wait ?? 45) * 1000))]);
    return j.error ? fail(new Error(j.error)) : text(describe(j));
  } catch (e) { return fail(e); }
});
server.registerTool('motion_render_status', {
  title: '렌더 진행 확인', description: 'motion_render가 돌려준 job의 진행률이나 결과를 확인한다.',
  inputSchema: { job: z.string(), wait: z.number().min(0).max(240).optional() }
}, async ({ job, wait }) => {
  const j = jobs.get(job); if (!j) return fail(new Error('그런 job이 없습니다: ' + job));
  const until = Date.now() + (wait ?? 30) * 1000;
  while (!j.result && !j.error && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  return j.error ? fail(new Error(j.error)) : text(describe(j));
});

const previews = new Map();
server.registerTool('motion_preview', {
  title: '브라우저 미리보기 주소', description: '컴포지션을 브라우저에서 스크럽하며 볼 수 있는 로컬 주소를 돌려준다(Space 재생 · ←/→ 프레임 · G 안전영역).',
  inputSchema: { file: z.string() }
}, async ({ file }) => {
  try {
    const abs = resolveFile(file), dir = path.dirname(abs);
    const { syncRuntime } = await import('../lib/project.mjs'); const { serve } = await import('../lib/server.mjs');
    syncRuntime(dir);
    if (!previews.has(dir)) previews.set(dir, await serve(dir, 0));
    return text(`${previews.get(dir).origin}/${encodeURIComponent(path.basename(abs))}`);
  } catch (e) { return fail(e); }
});

server.registerTool('motion_doctor', { title: '환경 점검', description: 'Chrome/Edge · ffmpeg · 런타임이 준비됐는지 확인한다.', inputSchema: {} }, async () => {
  const { findChrome } = await import('../lib/browser.mjs'); const { findFfmpeg } = await import('../lib/ffmpeg.mjs');
  const gsap = fs.existsSync(path.join(ROOT, 'engine', 'vendor', 'gsap.min.js')) || fs.existsSync(path.join(ROOT, 'node_modules', 'gsap', 'dist', 'gsap.min.js'));
  return text([`motion ${VERSION} · node ${process.version}`, `작업 폴더  ${WORKSPACE}`, `chrome    ${findChrome() || '없음 — Chrome/Edge를 설치하거나 MOTION_CHROME 지정'}`, `ffmpeg    ${findFfmpeg() || '없음 — ffmpeg 설치 또는 npm i ffmpeg-static'}`, `gsap      ${gsap ? 'ok' : '없음 — 저장소 폴더에서 npm install'}`].join('\n'));
});

// ── resources & prompt (for clients that surface them) ──
for (const [k, [file, desc]] of Object.entries(DOCS)) {
  server.registerResource(`motion-${k}`, `motion://docs/${k}`, { title: `Motion · ${k}`, description: desc, mimeType: 'text/markdown' }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: fs.readFileSync(path.join(ROOT, file), 'utf8') }] }));
}
server.registerPrompt('motion', {
  title: '모션그래픽 만들기', description: '장면을 말하면 감독처럼 연출해 영상으로 만든다.',
  argsSchema: { request: z.string().describe('만들고 싶은 장면(평범한 말로)') }
}, ({ request }) => ({
  messages: [{ role: 'user', content: { type: 'text', text: `${doc('skill').replace(/^---[\s\S]*?---\n/, '')}\n\n---\n\n# 이번 요청\n${request}\n\n위 작업 순서대로 진행하세요. 먼저 motion_brief로 연출 초안을 받고, 트리트먼트를 6–12줄로 보여 준 뒤 바로 제작합니다. 문서가 더 필요하면 motion_guide를 호출하세요.` } }]
}));

await server.connect(new StdioServerTransport());
