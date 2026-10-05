import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE, ROOT, TEMPLATES, VERSION, FORMATS, ensureDir } from './util.mjs';

/** Files a composition needs beside it (copied into <project>/_motion/). */
function runtimeFiles() {
  const gsapLocal = path.join(ENGINE, 'vendor', 'gsap.min.js');
  const gsapNpm = path.join(ROOT, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
  const gsap = fs.existsSync(gsapLocal) ? gsapLocal : gsapNpm;
  if (!fs.existsSync(gsap)) throw new Error('gsap을 찾지 못했습니다. 저장소 폴더에서 `npm install`을 먼저 실행하세요.');
  const list = [[path.join(ENGINE, 'motion.js'), 'motion.js'], [path.join(ENGINE, 'motion.css'), 'motion.css'], [path.join(ENGINE, 'icons.js'), 'icons.js'], [gsap, 'gsap.min.js']];
  for (const f of fs.readdirSync(path.join(ENGINE, 'fonts'))) list.push([path.join(ENGINE, 'fonts', f), path.join('fonts', f)]);
  return list;
}

function runtimeHash(files) {
  const h = crypto.createHash('sha1').update(VERSION);
  for (const [src, rel] of files) { const st = fs.statSync(src); h.update(rel + ':' + st.size + ':' + Math.floor(st.mtimeMs)); }
  return h.digest('hex').slice(0, 12);
}

/** Copy (or refresh) the runtime next to a composition. Returns true when files were written. */
export function syncRuntime(dir) {
  const files = runtimeFiles();
  const dest = path.join(dir, '_motion');
  const stamp = VERSION + '+' + runtimeHash(files);
  const marker = path.join(dest, 'VERSION');
  if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === stamp) return false;
  ensureDir(path.join(dest, 'fonts'));
  for (const [src, rel] of files) fs.copyFileSync(src, path.join(dest, rel));
  fs.writeFileSync(marker, stamp + '\n');
  return true;
}

export function scaffold({ file, format = 'shorts', width, height, duration = 8, fps = 30, theme = 'ink', accent = 'blue', title, template = 'blank', force = false }) {
  const f = FORMATS[format] || FORMATS.shorts;
  const abs = path.resolve(file.endsWith('.html') ? file : file + '.html');
  if (fs.existsSync(abs) && !force) throw new Error(`이미 있는 파일입니다: ${abs} (덮어쓰려면 --force)`);
  ensureDir(path.dirname(abs));
  const tplFile = path.join(TEMPLATES, template + '.html');
  if (!fs.existsSync(tplFile)) throw new Error(`템플릿이 없습니다: ${template} (사용 가능: ${fs.readdirSync(TEMPLATES).filter((x) => x.endsWith('.html')).map((x) => x.replace('.html', '')).join(', ')})`);
  const vars = {
    TITLE: title || path.basename(abs, '.html'), WIDTH: width || f.width, HEIGHT: height || f.height, FPS: fps, DURATION: duration, THEME: theme, ACCENT: accent,
    PLATFORM: f.platform && !width ? ` data-platform="${f.platform}"` : ''
  };
  const html = fs.readFileSync(tplFile, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  fs.writeFileSync(abs, html);
  syncRuntime(path.dirname(abs));
  return abs;
}

export function listTemplates() {
  return fs.readdirSync(TEMPLATES).filter((x) => x.endsWith('.html')).map((x) => x.replace('.html', ''));
}
