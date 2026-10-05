import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { ROOT } from './util.mjs';

let cached;
/** ffmpeg on PATH, MOTION_FFMPEG, or the optional ffmpeg-static package. */
export function findFfmpeg() {
  if (cached !== undefined) return cached;
  const c = [process.env.MOTION_FFMPEG, 'ffmpeg'];
  const st = path.join(ROOT, 'node_modules', 'ffmpeg-static', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(st)) c.push(st);
  for (const bin of c.filter(Boolean)) {
    try { const r = spawnSync(bin, ['-version'], { encoding: 'utf8' }); if (r.status === 0) return (cached = bin); } catch { /* try next */ }
  }
  return (cached = null);
}

export function requireFfmpeg() {
  const f = findFfmpeg();
  if (!f) throw new Error('ffmpeg를 찾지 못했습니다. 설치 후 PATH에 추가하거나(Windows: `winget install Gyan.FFmpeg`, macOS: `brew install ffmpeg`), `npm i ffmpeg-static`을 실행하세요.');
  return f;
}

/** Spawn ffmpeg; resolves when it exits 0. `stdin` is exposed for piping frames. */
export function ffmpeg(args, { pipe = false, out = false } = {}) {
  const bin = requireFfmpeg();
  const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [pipe ? 'pipe' : 'ignore', out ? 'pipe' : 'ignore', 'pipe'], windowsHide: true });
  let err = '';
  p.stderr.on('data', (d) => { err += d; if (err.length > 20000) err = err.slice(-20000); });
  const done = new Promise((resolve, reject) => {
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg 실패 (code ' + code + ')\n' + err.trim()))));
  });
  if (pipe) p.stdin.on('error', () => { /* surfaced through exit code */ });
  return { proc: p, stdin: p.stdin, done };
}
