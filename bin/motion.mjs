#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs, num, log, FORMATS, VERSION, ROOT } from '../lib/util.mjs';

const HELP = `motion ${VERSION} — 말 한마디를 감독 수준의 모션그래픽으로

 연출
  motion brief "요청 문장" [--format ..] [--duration ..]      리프롬프트: 화면·길이·룩·연출 선택과 비트 시트 틀 제안
  motion analyze <참고영상.mp4> [--out dir]                   참고 영상의 컷 리듬·움직임·색·BPM을 재고 샷 시트를 만든다
  motion brand <https://사이트> [--out brand]                 사이트의 색·글꼴·로고·문구 → brand.json
  motion templates                                           시작 템플릿 목록

 만들기
  motion new <file.html> [--format shorts|wide|square|portrait|insert|cinema] [--duration 8] [--theme ink|night|paper|white|pop]
                         [--accent blue|…|#hex] [--template 이름|샘플.html] [--brand brand.json] [--title ".."]
  motion preview <file.html> [--port 4173] [--no-open]      브라우저 미리보기(Space · ←/→ · G 안전영역 · S 소리 · vars)
  motion vars <file.html>                                    템플릿 변수(data-var · M.var) 목록

 소리 · 자막
  motion audio <song.mp3> [--json]                           음악 분석: BPM · 박 · 마디 · 세기
  motion sfx [이름 --out a.wav]                               내장 효과음 목록 / 파일로 꺼내기
  motion captions plan <대본.txt> [--rate 5] [--out a.srt]     말 속도로 자막 시간 계획(녹음 전)
  motion captions align <대본.txt> <녹음.wav> [--out a.srt]    녹음의 쉬는 구간에 맞춰 자막 정렬(.srt · .vtt · .json)

 검수
  motion check <file.html> [--json] [--step 0.1] [--platform shorts]    겹침·잘림·가독성·정지·소리 자동 점검
  motion score <file.html> [--json]                          감독 점수 100점(훅·가독성·리듬·움직임·구성·엔딩·사운드) + 슬라이드쇼 위험
  motion sheet <file.html> [--count 12 | --at 0.5,2,3.8 | --beats 128 | --beats music] [--from 2 --to 4] [--cols 6] [--width 2400]
                         [--no-camera] [--guides] [--out sheet.png]                  콘택트 시트(한눈에 검토)
  motion frames <file.html> --at 0.5,2,3.8 [--blur 16] [--scale 1] [--stamp] [--no-camera] [--guides] [--out dir]   원본 크기 스틸
  motion probe <file.html> --at 1.2,3 --js "M.rect('#title')"            그 시각의 페이지 안에서 식을 평가해 JSON으로
  motion verify <video.mp4>                                  렌더 결과 검수(크기·길이·검은 화면·멈춤·소리 크기) + 프레임 띠

 내보내기
  motion render <file.html> [--out a.mp4] [--quality draft|standard|final] [--fps 30|60] [--blur 0|8|16|32] [--shutter 180]
                         [--format mp4|webm|mov|gif|webp|png] [--alpha] [--scale 1] [--ss 2] [--no-sharp] [--crf 17]
                         [--from 0 --to 3] [--audio bgm.mp3] [--no-audio] [--loudness -14|off] [--poster 2.4] [--workers 4]
                         [--vars "a=1&b=2"] [--no-verify]
  motion batch <file.html> --data rows.csv [--name "{이름}-{반}"] [--out dir] [--quality ..] [--format ..]   행마다 한 편씩

  motion sync [dir]                                          _motion 런타임·소리 분석·효과음 갱신
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
      const f = scaffold({ file: needFile(), format: a.format, width: num(a.width), height: num(a.height), duration: num(a.duration), fps: num(a.fps, 30), theme: a.theme, accent: a.accent, title: a.title, template: a.template, brand: a.brand, force: !!a.force });
      console.log(f);
      break;
    }
    case 'templates': {
      const { listTemplates } = await import('../lib/project.mjs');
      for (const t of listTemplates(true)) console.log(`${t.name.padEnd(12)} ${t.format.padEnd(7)} ${String(t.duration).padStart(4)}s  ${t.about}`);
      console.log('\n샘플에서 시작: motion new my.html --template samples/02-sports-day.html');
      break;
    }
    case 'vars': {
      const { listVars } = await import('../lib/batch.mjs');
      const v = await listVars(needFile());
      if (a.json) { console.log(JSON.stringify(v, null, 2)); break; }
      for (const d of v) console.log(`${d.name.padEnd(14)} ${d.type.padEnd(6)} "${d.default}"${d.label ? '  — ' + d.label : ''}`);
      console.log('\n사용: motion render 파일 --vars "' + v.filter((d) => !d.builtin).slice(0, 2).map((d) => d.name + '=…').join('&') + '"  ·  여러 편: motion batch 파일 --data rows.csv');
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
      console.log(url + '\n(Space 재생 · ←/→ 프레임 · G 안전영역 · S 소리 · Ctrl+C 종료)');
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
      const r = await sheet(needFile(), { at: list(a.at), count: num(a.count, 12), cols: num(a.cols), out: a.out, width: num(a.width), from: num(a.from), to: num(a.to), vars, beats: a.beats === 'music' ? 'music' : num(a.beats) });
      console.log(r.file);
      if (r.problems.length) log('⚠ ' + r.problems.join('\n⚠ '));
      break;
    }
    case 'check': {
      const { check, formatReport } = await import('../lib/check.mjs');
      const r = await check(needFile(), { step: num(a.step, 0.1), platform: a.platform, vars: a.vars });
      console.log(a.json ? JSON.stringify(r, null, 2) : formatReport(r));
      process.exitCode = r.summary.errors ? 1 : 0;
      break;
    }
    case 'score': {
      const { score, formatScore } = await import('../lib/score.mjs');
      const s = await score(needFile(), { step: num(a.step, 0.1), platform: a.platform, vars: a.vars });
      console.log(a.json ? JSON.stringify(s, null, 2) : formatScore(s));
      process.exitCode = s.check.summary.errors ? 1 : 0;
      break;
    }
    case 'render': {
      const { render } = await import('../lib/render.mjs');
      const r = await render(needFile(), {
        out: a.out, quality: a.quality, format: a.format, fps: num(a.fps), blur: num(a.blur), shutter: num(a.shutter), scale: num(a.scale), ss: num(a.ss), crf: num(a.crf), preset: a.preset,
        from: num(a.from), to: num(a.to), audio: a['no-audio'] ? false : a.audio, alpha: !!a.alpha, workers: num(a.workers), capture: a.capture, linear: a.linear !== 'off',
        loudness: a.loudness === 'off' ? false : num(a.loudness), poster: a.poster === undefined ? undefined : a.poster === true ? true : +a.poster, width: num(a.width), gifFps: num(a['gif-fps']), vars, sharp: !a['no-sharp']
      });
      const snd = r.audio ? ` · 소리(${[r.audio.music && '음악', r.audio.voice && '목소리', r.audio.sfx && '효과음'].filter(Boolean).join('+')}${r.audio.loudness ? ', ' + r.audio.loudness + ' LUFS' : ''})` : '';
      console.log(`${r.file}\n${r.width}×${r.height} · ${r.fps}fps · ${r.duration}s · ${r.frames}프레임 · 모션 블러 ${r.blurred}프레임(최대 ${r.samples}샘플, 캡처 ${r.captures}회)${r.sharpened ? ` · 선명 보정 ${r.sharpened}프레임` : ''}${r.distrusted ? ` · 보정 생략 ${r.distrusted}프레임(큰 레이아웃이 원본과 달라 일반 캡처로 대체)` : ''}${snd} · ${r.size} · ${r.seconds}s`);
      if (r.problems.length) log('⚠ ' + r.problems.join('\n⚠ '));
      if (!a['no-verify'] && /\.(mp4|webm|mov)$/i.test(r.file)) {
        const { verify, formatVerify } = await import('../lib/verify.mjs');
        try { console.log('\n' + formatVerify(await verify(r.file, { expect: { width: r.width, height: r.height, duration: r.duration } }))); } catch (e) { log('검수 생략: ' + e.message); }
      }
      break;
    }
    case 'verify': {
      const { verify, formatVerify } = await import('../lib/verify.mjs');
      const r = await verify(needFile(), { expect: { width: num(a.width), height: num(a.height), duration: num(a.duration), fps: num(a.fps) } });
      console.log(a.json ? JSON.stringify(r, null, 2) : formatVerify(r));
      process.exitCode = r.ok ? 0 : 1;
      break;
    }
    case 'batch': {
      const { batch } = await import('../lib/batch.mjs');
      if (!a.data) { log('데이터 파일이 필요합니다: motion batch 파일.html --data rows.csv'); process.exit(2); }
      const r = await batch(needFile(), { data: a.data, out: a.out, name: a.name, quality: a.quality, format: a.format, fps: num(a.fps), scale: num(a.scale), onRow: (i, n, x) => log(`· ${i}/${n} ${x.file} (${x.size}, ${x.seconds}s)`) });
      if (r.unknownColumns.length) log('⚠ 템플릿 변수가 아닌 열(무시함): ' + r.unknownColumns.join(', ') + ' — 변수: ' + r.vars.join(', '));
      console.log(`${r.renders.length}편 → ${r.out}`);
      break;
    }
    case 'analyze': {
      const { analyzeVideo } = await import('../lib/analyze.mjs');
      const r = await analyzeVideo(needFile(), { out: a.out, threshold: num(a.threshold) });
      console.log(a.json ? JSON.stringify(r.summary, null, 2) : r.markdown + (r.sheet ? '\n\n샷 시트: ' + r.sheet : ''));
      break;
    }
    case 'brand': {
      const { brand } = await import('../lib/brand.mjs');
      if (!file) { log('사이트 주소가 필요합니다: motion brand https://example.com'); process.exit(2); }
      const r = await brand(file, { out: a.out });
      console.log(r.markdown + '\n\n' + path.join(r.dir, 'brand.json') + '\n새 컴포지션에 적용: motion new my.html --brand ' + path.join(r.dir, 'brand.json'));
      break;
    }
    case 'audio': {
      const { analyze } = await import('../lib/audio.mjs');
      const r = analyze(path.resolve(needFile()));
      if (a.json) { console.log(JSON.stringify({ ...r, level: undefined, low: undefined, high: undefined }, null, 2)); break; }
      console.log(`${path.basename(file)} · ${r.duration}s · ${r.bpm} BPM · 박 ${r.beats.length}개(첫 박 ${r.beats[0] ?? '-'}s) · 마디 ${r.downbeats.length}개 · 강한 타격 ${r.onsets.length}개`);
      console.log('처음 8박: ' + r.beats.slice(0, 8).join(', '));
      console.log(`컴포지션: <audio src="${path.basename(file)}" data-start="0"></audio> 를 넣으면 M.grid()·data-reveal="… b8"이 이 박자를 따른다.`);
      break;
    }
    case 'sfx': {
      const { SFX_NAMES, renderSfx, wavBytes, GAIN } = await import('../lib/sfx.mjs');
      if (!file) { console.log('내장 효과음(합성, 파일 없이 사용): ' + SFX_NAMES.join(' ')); console.log('사용: M.sfx("whoosh", 1.2) · data-sfx="impact b8" · 도우미에 { sfx: true }'); break; }
      const x = renderSfx(file); if (!x) { log('없는 효과음: ' + file + '\n목록: ' + SFX_NAMES.join(' ')); process.exit(2); }
      const out = path.resolve(a.out || file + '.wav'); fs.writeFileSync(out, wavBytes(x)); console.log(out + ` (${(x.length / 48000).toFixed(2)}s, 믹스 레벨 ${GAIN[file] ?? '-'})`);
      break;
    }
    case 'captions': {
      const C = await import('../lib/captions.mjs');
      const [sub, scriptFile, voice] = a._;
      if (!sub || !scriptFile) { log('사용: motion captions plan 대본.txt | motion captions align 대본.txt 녹음.wav'); process.exit(2); }
      const script = fs.readFileSync(scriptFile, 'utf8'), max = num(a.max, 22);
      const cues = sub === 'align' ? C.alignCaptions(script, voice, { maxChars: max }) : C.planCaptions(script, { rate: num(a.rate, 5), start: num(a.start, 0.4), maxChars: max });
      const out = path.resolve(a.out || scriptFile.replace(/\.[^.]+$/, '') + (sub === 'align' ? '.captions.json' : '.srt'));
      C.writeCaptions(cues, out);
      console.log(`${out} · 자막 ${cues.length}개 · ${cues.length ? cues[0].start.toFixed(2) + '–' + cues[cues.length - 1].end.toFixed(2) + 's' : ''}`);
      console.log(`컴포지션: <div data-captions="${path.basename(out)} karaoke"></div> 또는 M.captions('#cap', '${path.basename(out)}', { style: 'karaoke' })`);
      break;
    }
    case 'doctor': {
      const { findChrome } = await import('../lib/browser.mjs');
      const { findFfmpeg } = await import('../lib/ffmpeg.mjs');
      const chrome = findChrome(), ff = findFfmpeg(), v = (f) => fs.existsSync(path.join(ROOT, 'engine', 'vendor', f));
      console.log(`node     ${process.version}`);
      console.log(`chrome   ${chrome || '없음 — Chrome/Edge 설치 또는 MOTION_CHROME 지정'}`);
      console.log(`ffmpeg   ${ff || '없음 — winget install Gyan.FFmpeg / brew install ffmpeg / npm i ffmpeg-static'}`);
      console.log(`gsap     ${v('gsap.min.js') ? 'ok (플러그인 포함)' : '없음 — npm install'}`);
      console.log(`3d       ${v('three.module.js') ? 'ok' : '없음 — npm install (M.three를 쓸 때만 필요)'}`);
      console.log(`lottie   ${v('lottie.min.js') ? 'ok' : '없음 — npm install (M.lottie를 쓸 때만 필요)'}`);
      process.exitCode = chrome && ff && v('gsap.min.js') ? 0 : 1;
      break;
    }
    case undefined: case 'help': case '--help': case '-h': console.log(HELP); break;
    case '--version': case '-v': console.log(VERSION); break;
    default: log(`알 수 없는 명령: ${cmd}\n\n${HELP}`); process.exit(2);
  }
}

main().catch((e) => { log('✖ ' + (e && e.message || e)); process.exit(1); });
