#!/usr/bin/env node
/**
 * Motion Director — MCP server (stdio).
 * Gives any MCP client (Claude Desktop · Claude Code · Codex · others) the whole workflow:
 * re-prompt a plain request into a treatment, scaffold, lint, score, look at frames, render, review the delivered file.
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
  playbooks: ['references/playbooks.md', '영상 종류별 작업 흐름 — 홍보 쇼츠·제품/사이트 소개·설명(내레이션)·데이터·음악 동기·행사·로고·오버레이·루프·레퍼런스 따라 하기'],
  director: ['references/director.md', '요청을 연출로 바꾸는 법 — 의도→기법 표, 비트 시트, 합격 기준, 예시'],
  look: ['references/look.md', '테마·색·타이포·구도·빛, 아마추어 티와 대안'],
  motion: ['references/motion.md', '이징·스프링·타이밍·카메라 어휘와 코드'],
  sound: ['references/sound.md', '음악·효과음·목소리: 어디에 무슨 소리를, 박자 맞추기, 음량'],
  captions: ['references/captions.md', '내레이션과 단어 자막: 대본 → 시간, 녹음 정렬, 자막 스타일'],
  engine: ['references/engine.md', '런타임 API와 부품 마크업(선언형 속성 포함)'],
  recipes: ['references/recipes.md', '장면 유형별 뼈대 코드'],
  quality: ['references/quality.md', '검수 기준, 점검·점수 코드별 처방'],
  'chat-mode': ['references/chat-mode.md', '도구 없는 대화창에서 단일 HTML로 내는 법']
};
const doc = (k) => fs.readFileSync(path.join(ROOT, DOCS[k][0]), 'utf8');
const text = (s) => ({ content: [{ type: 'text', text: s }] });
const fail = (e) => ({ isError: true, content: [{ type: 'text', text: '✖ ' + (e && e.message || String(e)) }] });

/** Relative paths live in the workspace (~/Motion by default); absolute paths are used as given. */
function resolveFile(file, ext = '.html') {
  const p = path.isAbsolute(file) ? file : path.join(WORKSPACE, file);
  return path.resolve(ext && !path.extname(p) ? p + ext : p);
}
const resolveAny = (file) => resolveFile(file, '');
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
const image = async (file, edge) => ({ type: 'image', data: await toJpeg(file, edge), mimeType: 'image/jpeg' });

const server = new McpServer({ name: 'motion-director', version: VERSION }, {
  instructions: [
    '말로 설명한 장면을 감독 수준의 모션그래픽 영상으로 만든다. 사용자가 기법 이름을 말하지 않아도 연출은 직접 정한다.',
    '순서: ① motion_brief(요청) ② motion_guide("skill") — 영상 종류가 분명하면 "playbooks"도 ③ 트리트먼트(화면 규격·샷 목록·합격 기준) 확정 ④ motion_new(템플릿) → 작성(motion_write 또는 파일 도구)',
    '⑤ motion_check 오류 0 → motion_score 85점 이상 ⑥ motion_sheet 이미지를 직접 보고 고친다(최소 1회, 박자 영상은 beats="music") ⑦ motion_render — 결과 프레임 띠까지 확인. 보지 않고 납품하지 않는다.',
    '참고 영상이 있으면 motion_analyze, 브랜드 사이트가 있으면 motion_brand, 음악이 있으면 motion_audio, 내레이션이 있으면 motion_captions를 먼저.'
  ].join('\n')
});

// ── knowledge ──
server.registerTool('motion_brief', {
  title: '연출 초안(리프롬프트)',
  description: '평범한 말로 된 영상 요청을 받아 화면 비율·길이·룩·카메라·글자·전환 선택과 타임코드 비트 시트 틀을 제안한다. 모션그래픽 작업의 첫 호출. 결과를 바탕으로 트리트먼트를 확정한 뒤 제작한다.',
  inputSchema: {
    request: z.string().describe('사용자의 요청 원문'),
    format: z.enum(Object.keys(FORMATS)).optional().describe('화면: shorts | wide | square | portrait | insert | cinema'),
    duration: z.number().positive().optional().describe('길이(초)'),
    tone: z.enum(['tech', 'edu', 'event', 'data', 'warm', 'life', 'brand']).optional().describe('룩을 직접 고를 때')
  }
}, async ({ request, format, duration, tone }) => text(brief(request, { format, duration, tone }).text));

server.registerTool('motion_guide', {
  title: '제작 문서 읽기',
  description: '제작 규칙과 참조 문서를 돌려준다. skill(작업 순서·하드 룰) → playbooks(영상 종류별 흐름) → director(연출법) → engine(API) → recipes(뼈대 코드) → look · motion · sound · captions · quality · chat-mode.',
  inputSchema: { topic: z.enum(Object.keys(DOCS)).describe(Object.entries(DOCS).map(([k, v]) => `${k}: ${v[1]}`).join(' / ')) }
}, async ({ topic }) => text(doc(topic)));

server.registerTool('motion_templates', {
  title: '시작 템플릿 목록', description: '장르별로 검수를 통과한 시작 템플릿(이름·화면·길이·설명)을 돌려준다. motion_new의 template에 이름을 넣는다. 샘플 경로(samples/02-sports-day.html)도 템플릿으로 쓸 수 있다.',
  inputSchema: {}
}, async () => { const { listTemplates } = await import('../lib/project.mjs'); return text(listTemplates(true).map((t) => `${t.name} · ${t.format} · ${t.duration}s — ${t.about}`).join('\n') + `\n\n샘플: ${fs.readdirSync(path.join(ROOT, 'samples')).filter((f) => f.endsWith('.html')).map((f) => 'samples/' + f).join(', ')}`); });

// ── authoring ──
server.registerTool('motion_new', {
  title: '컴포지션 뼈대 만들기',
  description: `새 컴포지션 HTML과 런타임(_motion/)을 만든다. 상대 경로는 작업 폴더(${WORKSPACE}) 기준. template: motion_templates의 이름 또는 .html 경로(샘플에서 시작). brand: motion_brand가 만든 brand.json.`,
  inputSchema: {
    file: z.string().describe('예: intro.html 또는 절대 경로'),
    format: z.enum(Object.keys(FORMATS)).optional(),
    duration: z.number().positive().optional(), theme: z.enum(['ink', 'night', 'paper', 'white', 'pop']).optional(),
    accent: z.string().optional().describe('blue cyan mint lime yellow amber orange red pink violet white 또는 #hex'),
    title: z.string().optional(), force: z.boolean().optional(),
    template: z.string().optional().describe('템플릿 이름(blank·hook·ui·beat·captions·data·lowerthird·loop·launch …) 또는 .html 경로'),
    brand: z.string().optional().describe('brand.json 경로')
  }
}, async (a) => {
  try {
    const { scaffold } = await import('../lib/project.mjs');
    const tpl = a.template && /\.html?$/i.test(a.template) ? (path.isAbsolute(a.template) ? a.template : fs.existsSync(path.join(ROOT, a.template)) ? path.join(ROOT, a.template) : resolveAny(a.template)) : a.template;
    const f = scaffold({ ...a, template: tpl, brand: a.brand ? resolveAny(a.brand) : undefined, file: resolveFile(a.file) });
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
    if (!/\.(html|css|js|json|svg|md|txt|srt|vtt)$/i.test(p)) throw new Error('html · css · js · json · svg · md · txt · srt · vtt 파일만 저장할 수 있습니다.');
    if (/[\\/](_motion|node_modules)[\\/]/.test(p)) throw new Error('_motion 런타임 폴더는 직접 고치지 않습니다.');
    ensureDir(path.dirname(p)); fs.writeFileSync(p, content);
    if (/\.(html|srt|vtt|json)$/i.test(p)) { const { syncRuntime } = await import('../lib/project.mjs'); syncRuntime(path.dirname(p)); }
    return text(`저장했습니다: ${p} (${content.length.toLocaleString()}자)`);
  } catch (e) { return fail(e); }
});

server.registerTool('motion_read', {
  title: '컴포지션 읽기', description: '컴포지션 파일(또는 분석 결과 .md/.json, 자막 파일)의 현재 내용을 돌려준다.',
  inputSchema: { file: z.string() }
}, async ({ file }) => {
  try { const p = resolveFile(file); if (!/\.(html|css|js|json|svg|md|txt|srt|vtt)$/i.test(p)) throw new Error('텍스트 파일만 읽습니다.'); return text(fs.readFileSync(p, 'utf8')); } catch (e) { return fail(e); }
});

server.registerTool('motion_vars', {
  title: '템플릿 변수 목록', description: '컴포지션이 선언한 템플릿 변수(data-var · M.var · accent)를 이름·형식·기본값과 함께 돌려준다. render·batch의 vars에 쓴다.',
  inputSchema: { file: z.string() }
}, async ({ file }) => { try { const { listVars } = await import('../lib/batch.mjs'); const v = await listVars(resolveFile(file)); return text(v.map((d) => `${d.name} (${d.type}) = ${JSON.stringify(d.default)}${d.label ? ' — ' + d.label : ''}`).join('\n') || '변수 없음'); } catch (e) { return fail(e); } });

// ── review ──
server.registerTool('motion_check', {
  title: '자동 점검',
  description: '시간을 따라가며 실제 화면을 측정한다: 글자 겹침·잘림·작은 글자·낮은 대비·읽을 시간 부족·정지 구간·늦은 시작·안전영역·소리 파일·반복(loop) 이음새. 오류가 0이 될 때까지 고친다.',
  inputSchema: { file: z.string(), step: z.number().positive().optional().describe('측정 간격(초), 기본 0.1'), vars: z.string().optional() }
}, async ({ file, step, vars }) => {
  try { const { check, formatReport } = await import('../lib/check.mjs'); return text(formatReport(await check(resolveFile(file), { step: step || 0.1, vars }))); } catch (e) { return fail(e); }
});

server.registerTool('motion_score', {
  title: '감독 점수',
  description: '100점 채점(훅 15·가독성 20·리듬 20·움직임 15·구성 15·엔딩 10·사운드 5)과 슬라이드쇼 위험도, 점수를 많이 잃은 순서의 고칠 점. 납품 기준은 오류 0 + 85점 이상.',
  inputSchema: { file: z.string(), vars: z.string().optional() }
}, async ({ file, vars }) => { try { const { score, formatScore } = await import('../lib/score.mjs'); return text(formatScore(await score(resolveFile(file), { vars }))); } catch (e) { return fail(e); } });

server.registerTool('motion_sheet', {
  title: '콘택트 시트 보기',
  description: '영상 전체를 여러 장의 스틸로 늘어놓은 이미지를 돌려준다. 흐름·구도·글자를 직접 보고 비평한다(quality 문서의 기준). 전환 구간은 from·to로 좁혀 촘촘히, 박자 영상은 beats(BPM 숫자 또는 "music" — 음악에서 잰 박마다 한 장).',
  inputSchema: {
    file: z.string(), count: z.number().int().min(2).max(40).optional(), at: z.array(z.number()).optional().describe('특정 시각들(초)'), cols: z.number().int().min(1).max(10).optional(),
    from: z.number().min(0).optional().describe('이 시각부터(초)'), to: z.number().positive().optional().describe('이 시각까지(초)'),
    beats: z.union([z.number().positive(), z.literal('music')]).optional().describe('BPM 또는 "music"'),
    guides: z.boolean().optional().describe('플랫폼 안전영역을 겹쳐 본다'), noCamera: z.boolean().optional().describe('카메라를 끄고 쉬는 배치만 본다'), vars: z.string().optional()
  }
}, async ({ file, count, at, cols, from, to, beats, guides, noCamera, vars }) => {
  try {
    const { sheet } = await import('../lib/render.mjs');
    const r = await sheet(resolveFile(file), { count: count || 15, at, cols, from, to, beats, vars: reviewVars({ vars, noCamera, guides }) });
    return { content: [{ type: 'text', text: `${r.file}\n${r.times.length}장 · ${r.meta.width}×${r.meta.height} · ${r.meta.duration}s${r.problems.length ? '\n⚠ ' + r.problems.join('\n⚠ ') : ''}` }, await image(r.file, 1800)] };
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
    for (const f of r.frames) content.push(await image(f.file));
    return { content };
  } catch (e) { return fail(e); }
});

// ── render (long jobs continue in the background; the delivered file is reviewed when it lands) ──
const jobs = new Map();
let jobSeq = 0;
function describe(j) {
  if (j.error) return `✖ ${j.kind === 'batch' ? '일괄 렌더' : '렌더'} 실패: ${j.error}`;
  if (j.kind === 'batch' && j.result) return `완료: ${j.result.renders.length}편 → ${j.result.out}${j.result.unknownColumns.length ? `\n⚠ 템플릿 변수가 아닌 열(무시함): ${j.result.unknownColumns.join(', ')}` : ''}`;
  if (j.result) {
    const r = j.result, snd = r.audio ? ` · 소리(${[r.audio.music && '음악', r.audio.voice && '목소리', r.audio.sfx && '효과음'].filter(Boolean).join('+')})` : '';
    return `완료: ${r.file}\n${r.width}×${r.height} · ${r.fps}fps · ${r.duration}s · 모션 블러 ${r.blurred}프레임${r.sharpened ? ` · 선명 보정 ${r.sharpened}프레임` : ''}${r.distrusted ? ` · 보정 생략 ${r.distrusted}프레임` : ''}${snd} · ${r.size} · ${r.seconds}s${r.problems.length ? '\n⚠ ' + r.problems.join('\n⚠ ') : ''}${j.review ? '\n\n' + j.review : ''}`;
  }
  return `${j.kind === 'batch' ? '일괄 렌더' : '렌더'} 중 ${j.pct}% (${j.done}/${j.total}) — job "${j.id}". 잠시 뒤 motion_render_status로 확인하세요.`;
}
async function reply(j) {
  if (j.error) return fail(new Error(j.error));
  const content = [{ type: 'text', text: describe(j) }];
  if (j.strip && fs.existsSync(j.strip)) content.push(await image(j.strip, 1800));
  return { content };
}
server.registerTool('motion_render', {
  title: '영상으로 렌더',
  description: '컴포지션을 영상 파일로 만든다. 컴포지션이 계획한 소리(<audio>·M.audio·M.sfx)는 자동으로 믹스되고 −14 LUFS로 맞춰진다. quality: draft(빠른 확인, 절반 크기) · standard(검토, 모션 블러 최대 16샘플) · final(납품, 32샘플 + 기울어진 장면 고해상 캡처). format: mp4 · webm · mov · gif · webp · png. alpha는 mov/webm/png에서 투명 배경. 끝나면 결과 파일을 검수하고 프레임 띠를 함께 돌려준다. 오래 걸리면 job 번호를 돌려주고 계속 진행한다.',
  inputSchema: {
    file: z.string(), quality: z.enum(['draft', 'standard', 'final']).optional(), format: z.enum(['mp4', 'webm', 'mov', 'gif', 'webp', 'png']).optional(),
    fps: z.number().int().positive().optional(), from: z.number().min(0).optional(), to: z.number().positive().optional(),
    alpha: z.boolean().optional(), audio: z.string().optional().describe('추가 배경 음악 파일 경로'), noAudio: z.boolean().optional().describe('소리 없이'), out: z.string().optional(), vars: z.string().optional().describe('a=1&b=2 형태의 템플릿 변수'),
    blur: z.number().int().min(0).max(32).optional().describe('모션 블러 샘플 수(0 = 끔)'), scale: z.number().positive().max(4).optional().describe('출력 배율(2 = 1080 레이아웃을 4K로)'),
    wait: z.number().min(0).max(240).optional().describe('완료를 기다릴 최대 초(기본 45)')
  }
}, async (a) => {
  try {
    const { render } = await import('../lib/render.mjs');
    const id = 'r' + (++jobSeq);
    const j = { id, kind: 'render', pct: 0, done: 0, total: 0 }; jobs.set(id, j);
    const p = render(resolveFile(a.file), { ...a, audio: a.noAudio ? false : a.audio ? resolveAny(a.audio) : undefined, out: a.out ? path.resolve(path.isAbsolute(a.out) ? a.out : path.join(WORKSPACE, a.out)) : undefined, quiet: false, onProgress: (d, t) => { j.done = d; j.total = t; j.pct = Math.floor((d / t) * 100); } })
      .then(async (r) => {
        if (/\.(mp4|webm|mov)$/i.test(r.file)) { try { const { verify, formatVerify } = await import('../lib/verify.mjs'); const v = await verify(r.file, { expect: { width: r.width, height: r.height, duration: r.duration } }); j.review = formatVerify(v); j.strip = v.strip; } catch (e) { j.review = '검수 생략: ' + e.message; } }
        j.result = r;
      }, (e) => { j.error = e.message || String(e); });
    await Promise.race([p, new Promise((r) => setTimeout(r, (a.wait ?? 45) * 1000))]);
    return reply(j);
  } catch (e) { return fail(e); }
});
server.registerTool('motion_render_status', {
  title: '렌더 진행 확인', description: 'motion_render · motion_batch가 돌려준 job의 진행률이나 결과(검수 결과와 프레임 띠 포함)를 확인한다.',
  inputSchema: { job: z.string(), wait: z.number().min(0).max(240).optional() }
}, async ({ job, wait }) => {
  const j = jobs.get(job); if (!j) return fail(new Error('그런 job이 없습니다: ' + job));
  const until = Date.now() + (wait ?? 30) * 1000;
  while (!j.result && !j.error && Date.now() < until) await new Promise((r) => setTimeout(r, 500));
  return reply(j);
});
server.registerTool('motion_verify', {
  title: '렌더 결과 검수', description: '이미 만든 영상 파일을 검사한다: 크기·길이·fps·색 정보, 검은 화면, 멈춘 구간, 소리 크기(LUFS)·찢어짐. 여섯 프레임을 나란히 놓은 띠 이미지를 함께 돌려준다.',
  inputSchema: { file: z.string().describe('mp4 · webm · mov 경로') }
}, async ({ file }) => {
  try { const { verify, formatVerify } = await import('../lib/verify.mjs'); const v = await verify(resolveAny(file)); const content = [{ type: 'text', text: formatVerify(v) }]; if (v.strip) content.push(await image(v.strip, 1800)); return { content }; } catch (e) { return fail(e); }
});
server.registerTool('motion_batch', {
  title: '데이터로 여러 편 렌더', description: '한 컴포지션을 CSV/JSON의 행마다 다른 템플릿 변수로 렌더한다(학생별·반별·상품별 영상). 열 이름 = 변수 이름(motion_vars로 확인). name은 "{이름}-{반}" 같은 파일 이름 틀. 오래 걸리면 job 번호를 돌려준다.',
  inputSchema: { file: z.string(), data: z.string().describe('rows.csv 또는 rows.json'), name: z.string().optional(), out: z.string().optional(), quality: z.enum(['draft', 'standard', 'final']).optional(), format: z.enum(['mp4', 'webm', 'mov', 'gif', 'webp']).optional(), wait: z.number().min(0).max(240).optional() }
}, async (a) => {
  try {
    const { batch } = await import('../lib/batch.mjs');
    const id = 'b' + (++jobSeq), j = { id, kind: 'batch', pct: 0, done: 0, total: 0 }; jobs.set(id, j);
    const p = batch(resolveFile(a.file), { data: resolveAny(a.data), name: a.name, out: a.out ? resolveAny(a.out) : undefined, quality: a.quality, format: a.format, onRow: (i, n) => { j.done = i; j.total = n; j.pct = Math.floor(i / n * 100); } })
      .then((r) => { j.result = r; }, (e) => { j.error = e.message || String(e); });
    await Promise.race([p, new Promise((r) => setTimeout(r, (a.wait ?? 45) * 1000))]);
    return reply(j);
  } catch (e) { return fail(e); }
});

// ── inputs: references, brands, music, narration ──
server.registerTool('motion_analyze', {
  title: '참고 영상 분석', description: '"이 영상 느낌으로" 요청에 쓴다. 참고 영상의 컷 리듬(샷 길이), 움직임 세기, 밝기·색 팔레트, 음악 BPM과 컷-박자 일치율을 재고, 샷마다 한 장씩 놓은 시트 이미지를 돌려준다. 연출에 옮길 BPM·컷 길이·테마·포인트 색을 제안한다(원본의 문구·로고·이미지는 베끼지 않는다).',
  inputSchema: { file: z.string().describe('영상 파일 경로'), out: z.string().optional() }
}, async ({ file, out }) => {
  try { const { analyzeVideo } = await import('../lib/analyze.mjs'); const r = await analyzeVideo(resolveAny(file), { out: out ? resolveAny(out) : path.join(WORKSPACE, 'out') }); const content = [{ type: 'text', text: r.markdown }]; if (r.sheet) content.push(await image(r.sheet, 1800)); return { content }; } catch (e) { return fail(e); }
});
server.registerTool('motion_brand', {
  title: '사이트에서 브랜드 가져오기', description: '웹사이트를 열어 실제로 칠해진 배경·글자·버튼 색, 제목·본문 글꼴, 로고, 사이트의 문구를 읽어 brand.json(+ logo, 스크린샷)을 만든다. motion_new의 brand에 넣으면 테마·포인트 색·이름·로고가 적용된다.',
  inputSchema: { url: z.string(), out: z.string().optional().describe('저장 폴더(기본: 작업 폴더/brand)') }
}, async ({ url, out }) => {
  try { const { brand } = await import('../lib/brand.mjs'); const r = await brand(url, { out: out ? resolveAny(out) : path.join(WORKSPACE, 'brand') }); return { content: [{ type: 'text', text: r.markdown + '\n\nbrand.json: ' + path.join(r.dir, 'brand.json') }, await image(path.join(r.dir, 'site.png'), 1400)] }; } catch (e) { return fail(e); }
});
server.registerTool('motion_audio', {
  title: '음악 분석', description: '음악 파일의 BPM·박·마디(다운비트)·강한 타격 시각을 잰다. 컴포지션에 <audio src="…">로 넣으면 M.grid()와 data-reveal="… b8" 같은 박 단위 시간이 이 박자를 따른다.',
  inputSchema: { file: z.string() }
}, async ({ file }) => {
  try { const { analyze } = await import('../lib/audio.mjs'); const r = analyze(resolveAny(file)); return text(`${path.basename(file)} · ${r.duration}s · ${r.bpm} BPM · 박 ${r.beats.length}개 · 마디 ${r.downbeats.length}개 · 타격 ${r.onsets.length}개\n박(처음 16): ${r.beats.slice(0, 16).join(', ')}\n마디 시작: ${r.downbeats.slice(0, 8).join(', ')}\n강한 타격: ${r.onsets.slice(0, 16).join(', ')}`); } catch (e) { return fail(e); }
});
server.registerTool('motion_captions', {
  title: '자막 만들기', description: 'mode "plan": 대본을 말 속도(초당 음절, 기본 5)로 시간 계획한다(녹음 전). mode "align": 대본을 녹음 파일의 쉬는 구간에 맞춰 정렬하고 단어별 시간을 붙인다. 결과(.srt · .vtt · .captions.json)를 컴포지션 옆에 저장하고 M.captions / data-captions로 쓴다.',
  inputSchema: { mode: z.enum(['plan', 'align']), script: z.string().describe('대본 텍스트(파일 경로가 아니라 내용)'), audio: z.string().optional().describe('align일 때 녹음 파일 경로'), out: z.string().describe('저장할 파일(예: voice.captions.json)'), rate: z.number().positive().optional(), maxChars: z.number().int().min(8).max(40).optional() }
}, async (a) => {
  try {
    const C = await import('../lib/captions.mjs');
    const cues = a.mode === 'align' ? C.alignCaptions(a.script, resolveAny(a.audio || ''), { maxChars: a.maxChars || 22 }) : C.planCaptions(a.script, { rate: a.rate || 5, maxChars: a.maxChars || 22 });
    const out = resolveAny(a.out); ensureDir(path.dirname(out)); C.writeCaptions(cues, out);
    const { syncRuntime } = await import('../lib/project.mjs'); syncRuntime(path.dirname(out));
    return text(`${out}\n${cues.map((c) => `${c.start.toFixed(2)}–${c.end.toFixed(2)}  ${c.text}`).join('\n')}`);
  } catch (e) { return fail(e); }
});
server.registerTool('motion_sfx', {
  title: '효과음 목록', description: '내장 효과음(코드로 합성, 파일·라이선스 불필요) 이름과 쓰는 법.',
  inputSchema: {}
}, async () => { const { SFX_NAMES } = await import('../lib/sfx.mjs'); return text('효과음: ' + SFX_NAMES.join(' ') + '\n사용: M.sfx("whoosh", 1.2) · data-sfx="impact b8" · 도우미 옵션 { sfx: true }(reveal·transition·click·type·count …)\n원칙: 큰 움직임 하나에 소리 하나, 4–8곳. 자세히는 motion_guide("sound").'); });

const previews = new Map();
server.registerTool('motion_preview', {
  title: '브라우저 미리보기 주소', description: '컴포지션을 브라우저에서 스크럽하며 볼 수 있는 로컬 주소를 돌려준다(Space 재생 · ←/→ 프레임 · G 안전영역 · S 소리 · vars 패널).',
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

server.registerTool('motion_doctor', { title: '환경 점검', description: 'Chrome/Edge · ffmpeg · 런타임(GSAP·3D·Lottie)이 준비됐는지 확인한다.', inputSchema: {} }, async () => {
  const { findChrome } = await import('../lib/browser.mjs'); const { findFfmpeg } = await import('../lib/ffmpeg.mjs');
  const v = (f) => fs.existsSync(path.join(ROOT, 'engine', 'vendor', f));
  return text([`motion ${VERSION} · node ${process.version}`, `작업 폴더  ${WORKSPACE}`, `chrome    ${findChrome() || '없음 — Chrome/Edge를 설치하거나 MOTION_CHROME 지정'}`, `ffmpeg    ${findFfmpeg() || '없음 — ffmpeg 설치 또는 npm i ffmpeg-static'}`, `gsap      ${v('gsap.min.js') ? 'ok' : '없음 — 저장소 폴더에서 npm install'}`, `3d        ${v('three.module.js') ? 'ok' : '없음'}`, `lottie    ${v('lottie.min.js') ? 'ok' : '없음'}`].join('\n'));
});

// ── resources & prompt (for clients that surface them) ──
for (const [k, [file, desc]] of Object.entries(DOCS)) {
  server.registerResource(`motion-${k}`, `motion://docs/${k}`, { title: `Motion · ${k}`, description: desc, mimeType: 'text/markdown' }, async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: fs.readFileSync(path.join(ROOT, file), 'utf8') }] }));
}
server.registerPrompt('motion', {
  title: '모션그래픽 만들기', description: '장면을 말하면 감독처럼 연출해 영상으로 만든다.',
  argsSchema: { request: z.string().describe('만들고 싶은 장면(평범한 말로)') }
}, ({ request }) => ({
  messages: [{ role: 'user', content: { type: 'text', text: `${doc('skill').replace(/^---[\s\S]*?---\n/, '')}\n\n---\n\n# 이번 요청\n${request}\n\n위 작업 순서대로 진행하세요. 먼저 motion_brief로 연출 초안을 받고, 트리트먼트를 짧게 보여 준 뒤 바로 제작합니다. 문서가 더 필요하면 motion_guide를 호출하세요.` } }]
}));

await server.connect(new StdioServerTransport());
