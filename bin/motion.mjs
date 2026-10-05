#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, num, log, FORMATS, VERSION, ROOT } from '../lib/util.mjs';

const HELP = `motion ${VERSION} — 말 한마디를 감독 수준의 모션그래픽으로

  motion brief "요청 문장" [--format ..] [--duration ..]      리프롬프트: 화면·길이·룩·연출 선택과 비트 시트 틀 제안
  motion new <file.html> [--format shorts|wide|square|portrait|insert] [--duration 8] [--theme ink|night|paper|white|pop]
                         [--accent blue|cyan|mint|lime|yellow|amber|orange|red|pink|violet|#hex] [--template blank|hook|ui] [--title ".."]
  motion preview <file.html> [--port 4173] [--no-open]      브라우저에서 스크럽하며 미리보기
  motion check <file.html> [--json] [--step 0.1] [--platform shorts]    겹침·잘림·가독성·정지 구간 자동 점검
  motion sheet <file.html> [--count 12 | --at 0.5,2,3.8 | --beats 128] [--from 2 --to 4] [--cols 6] [--width 2400]
                         [--no-camera] [--guides] [--out sheet.png]                  콘택트 시트(한눈에 검토)
  motion frames <file.html> --at 0.5,2,3.8 [--blur 16] [--scale 1] [--stamp] [--no-camera] [--guides] [--out dir]   원본 크기 스틸
  motion probe <file.html> --at 1.2,3 --js "M.rect('#title')"            그 시각의 페이지 안에서 식을 평가해 JSON으로
  motion render <file.html> [--out a.mp4] [--quality draft|standard|final] [--fps 30|60] [--blur 0|8|16|32] [--shutter 180]
                         [--format mp4|webm|mov|gif|webp|png] [--alpha] [--scale 1] [--ss 2] [--no-sharp] [--crf 17]
                         [--from 0 --to 3] [--audio bgm.mp3] [--poster 2.4] [--workers 4] [--vars "a=1&b=2"]
  motion sync [dir]                                          _motion 런타임 복사/갱신
  motion doctor                                              Chrome · ffmpeg · 런타임 점검

  화면 크기: ${Object.entries(FORMATS).map(([k, v]) => `${k} ${v.width}×${v.height}`).join(' · ')}
`;

const list = (v) => (v === undefined || v === true ? [] : String(v).split(',').map((s) => +s.trim()).filter((n) => !Number.isNaN(n)));

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const a = parseArgs(rest);
  const file = a._[0];
  const needFile = () => { if (!file) { log('파일 경로가 필요합니다.\n\n' + HELP); process.exit(2); } return file; };
  // review switches travel to the page as URL parameters
  const vars = [a.vars, a['no-camera'] ? 'nocam=1' : '', a.guides ? 'guides=1' : ''].filter(Boolean).join('&') || undefined;

  switch (cmd) {
    case 'brief': {
      const { brief } = await import('../lib/brief.mjs');
      const req = a._.join(' ').trim();
      if (!req) { log('요청 문장을 따옴표로 넣어 주세요: motion brief "가을 운동회 홍보 쇼츠"'); process.exit(2); }
      const b = brief(req, { format: a.format, duration: num(a.duration), tone: a.tone });
      console.log(a.json ? JSON.stringify({ ...b, text: undefined }, null, 2) : b.text);
      break;
    }
    case 'probe': {
      const { openComposition } = await import('../lib/capture.mjs');
      const comp = await openComposition(needFile(), { vars });
      try {
        const out = [];
        for (const t of (list(a.at).length ? list(a.at) : [0])) {
          await comp.seek(comp.pages[0], t);
          out.push({ t, value: await comp.pages[0].evaluate((js) => (0, eval)('(function (M) { return (' + js + '); })')(Motion.current), String(a.js || 'M.t')) });
        }
        console.log(JSON.stringify(out.length === 1 ? out[0] : out, null, 2));
      } finally { await comp.close(); }
      break;
    }
    case 'new': {
      const { scaffold } = await import('../lib/project.mjs');
      const f = scaffold({ file: needFile(), format: a.format, width: num(a.width), height: num(a.height), duration: num(a.duration, 8), fps: num(a.fps, 30), theme: a.theme, accent: a.accent, title: a.title, template: a.template, force: !!a.force });
      console.log(f);
      break;
    }
    case 'sync': {
      const { syncRuntime } = await import('../lib/project.mjs');
      const dir = path.resolve(file || '.');
      console.log((syncRuntime(dir) ? '갱신됨: ' : '최신 상태: ') + path.join(dir, '_motion'));
      break;
    }
    case 'preview': {
      const { syncRuntime } = await import('../lib/project.mjs');
      const { serve } = await import('../lib/server.mjs');
      const abs = path.resolve(needFile());
      syncRuntime(path.dirname(abs));
      const s = await serve(path.dirname(abs), num(a.port, 4173)).catch(() => serve(path.dirname(abs), 0));
      const url = `${s.origin}/${encodeURIComponent(path.basename(abs))}`;
      console.log(url + '\n(Space 재생 · ←/→ 프레임 · G 안전영역 · Ctrl+C 종료)');
      if (!a['no-open']) {
        const opener = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
        try { spawn(opener[0], opener[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* headless box */ }
      }
      break;
    }
    case 'frames': {
      const { frames } = await import('../lib/render.mjs');
      const r = await frames(needFile(), { at: list(a.at), out: a.out, scale: num(a.scale, 1), stamp: !!a.stamp, vars, blur: num(a.blur, 1), shutter: num(a.shutter, 180), sharp: !a['no-sharp'] });
      r.frames.forEach((f) => console.log(f.file));
      if (r.problems.length) log('⚠ ' + r.problems.join('\n⚠ '));
      break;
    }
    case 'sheet': {
      const { sheet } = await import('../lib/render.mjs');
      const r = await sheet(needFile(), { at: list(a.at), count: num(a.count, 12), cols: num(a.cols), out: a.out, width: num(a.width), from: num(a.from), to: num(a.to), vars, beats: num(a.beats) });
      console.log(r.file);
      if (r.problems.length) log('⚠ ' + r.problems.join('\n⚠ '));
      break;
    }
    case 'check': {
      const { check, formatReport } = await import('../lib/check.mjs');
      const r = await check(needFile(), { step: num(a.step, 0.1), platform: a.platform });
      console.log(a.json ? JSON.stringify(r, null, 2) : formatReport(r));
      process.exitCode = r.summary.errors ? 1 : 0;
      break;
    }
    case 'render': {
      const { render } = await import('../lib/render.mjs');
      const r = await render(needFile(), {
        out: a.out, quality: a.quality, format: a.format, fps: num(a.fps), blur: num(a.blur), shutter: num(a.shutter), scale: num(a.scale), ss: num(a.ss), crf: num(a.crf), preset: a.preset,
        from: num(a.from), to: num(a.to), audio: a.audio, alpha: !!a.alpha, workers: num(a.workers), capture: a.capture, linear: a.linear !== 'off',
        poster: a.poster === undefined ? undefined : a.poster === true ? true : +a.poster, width: num(a.width), gifFps: num(a['gif-fps']), vars, sharp: !a['no-sharp']
      });
      console.log(`${r.file}\n${r.width}×${r.height} · ${r.fps}fps · ${r.duration}s · ${r.frames}프레임 · 모션 블러 ${r.blurred}프레임(최대 ${r.samples}샘플, 캡처 ${r.captures}회)${r.sharpened ? ` · 선명 보정 ${r.sharpened}프레임` : ''}${r.distrusted ? ` · 보정 생략 ${r.distrusted}프레임(큰 레이아웃이 원본과 달라 일반 캡처로 대체)` : ''} · ${r.size} · ${r.seconds}s`);
      if (r.problems.length) log('⚠ ' + r.problems.join('\n⚠ '));
      break;
    }
    case 'doctor': {
      const { findChrome } = await import('../lib/browser.mjs');
      const { findFfmpeg } = await import('../lib/ffmpeg.mjs');
      const chrome = findChrome(), ff = findFfmpeg();
      const gsap = fs.existsSync(path.join(ROOT, 'engine', 'vendor', 'gsap.min.js')) || fs.existsSync(path.join(ROOT, 'node_modules', 'gsap', 'dist', 'gsap.min.js'));
      console.log(`node     ${process.version}`);
      console.log(`chrome   ${chrome || '없음 — Chrome/Edge 설치 또는 MOTION_CHROME 지정'}`);
      console.log(`ffmpeg   ${ff || '없음 — winget install Gyan.FFmpeg / brew install ffmpeg / npm i ffmpeg-static'}`);
      console.log(`gsap     ${gsap ? 'ok' : '없음 — npm install'}`);
      process.exitCode = chrome && ff && gsap ? 0 : 1;
      break;
    }
    case undefined: case 'help': case '--help': case '-h': console.log(HELP); break;
    case '--version': case '-v': console.log(VERSION); break;
    default: log(`알 수 없는 명령: ${cmd}\n\n${HELP}`); process.exit(2);
  }
}

main().catch((e) => { log('✖ ' + (e && e.message || e)); process.exit(1); });
