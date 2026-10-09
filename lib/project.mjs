import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ENGINE, ROOT, TEMPLATES, VERSION, FORMATS, ensureDir } from './util.mjs';
import { prepareAssets } from './assets.mjs';

/** Files a composition needs beside it (copied into <project>/_motion/). */
function runtimeFiles() {
  const gsapLocal = path.join(ENGINE, 'vendor', 'gsap.min.js');
  const gsapNpm = path.join(ROOT, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
  const gsap = fs.existsSync(gsapLocal) ? gsapLocal : gsapNpm;
  if (!fs.existsSync(gsap)) throw new Error('gsap을 찾지 못했습니다. 저장소 폴더에서 `npm install`을 먼저 실행하세요.');
  const list = [[path.join(ENGINE, 'motion.js'), 'motion.js'], [path.join(ENGINE, 'motion.css'), 'motion.css'], [path.join(ENGINE, 'icons.js'), 'icons.js'], [gsap, 'gsap.min.js']];
  for (const f of fs.readdirSync(path.join(ENGINE, 'fonts'))) list.push([path.join(ENGINE, 'fonts', f), path.join('fonts', f)]);
  // optional runtimes, loaded by the page only when a composition uses them
  for (const f of ['lottie.min.js', 'three.module.js', 'three.core.js']) { const p = path.join(ENGINE, 'vendor', f); if (fs.existsSync(p)) list.push([p, f]); }
  return list;
}

function runtimeHash(files) {
  const h = crypto.createHash('sha1').update(VERSION);
  for (const [src, rel] of files) { const st = fs.statSync(src); h.update(rel + ':' + st.size + ':' + Math.floor(st.mtimeMs)); }
  return h.digest('hex').slice(0, 12);
}

/**
 * Copy (or refresh) the runtime next to a composition and prepare the files it reads at runtime
 * (audio analyses, caption index, effect library). Returns true when runtime files were written.
 */
export function syncRuntime(dir, { assets = true } = {}) {
  const files = runtimeFiles();
  const dest = path.join(dir, '_motion');
  const stamp = VERSION + '+' + runtimeHash(files);
  const marker = path.join(dest, 'VERSION');
  let wrote = false;
  if (!fs.existsSync(marker) || fs.readFileSync(marker, 'utf8').trim() !== stamp) {
    ensureDir(path.join(dest, 'fonts'));
    for (const [src, rel] of files) fs.copyFileSync(src, path.join(dest, rel));
    fs.writeFileSync(marker, stamp + '\n');
    wrote = true;
  }
  if (assets) prepareAssets(dir);
  return wrote;
}

/** Template catalogue: templates/index.json → { name: { about, format, duration, theme, accent, files } }. */
export function templateMeta() {
  try { return JSON.parse(fs.readFileSync(path.join(TEMPLATES, 'index.json'), 'utf8')); } catch { return {}; }
}
/** Defaults a template file can carry itself: <meta name="motion-template" content='{"format":"shorts","duration":16}'> (index.json wins). */
export function inlineTemplateMeta(file) {
  try {
    const m = /<meta\s+name=["']motion-template["']\s+content='([^']*)'/i.exec(fs.readFileSync(file, 'utf8'));
    return m ? JSON.parse(m[1]) : {};
  } catch { return {}; }
}

/**
 * New composition from a template (a name from templates/ or the path of any composition, e.g. a sample),
 * optionally dressed in a brand file from `motion brand` (theme, accent, name, logo).
 */
export function scaffold({ file, format, width, height, duration, fps = 30, theme, accent, title, template = 'blank', brand, force = false }) {
  const tplFile = /\.html?$/i.test(template) ? path.resolve(template) : path.join(TEMPLATES, template + '.html');
  if (!fs.existsSync(tplFile)) throw new Error(`템플릿이 없습니다: ${template} (사용 가능: ${listTemplates().join(', ')} 또는 .html 경로)`);
  const meta = { ...inlineTemplateMeta(tplFile), ...(templateMeta()[template] || {}) };
  const B = brand ? JSON.parse(fs.readFileSync(path.resolve(brand), 'utf8')) : null;
  format = format || meta.format || 'shorts';
  const f = FORMATS[format] || FORMATS.shorts;
  const abs = path.resolve(file.endsWith('.html') ? file : file + '.html');
  if (fs.existsSync(abs) && !force) throw new Error(`이미 있는 파일입니다: ${abs} (덮어쓰려면 --force)`);
  ensureDir(path.dirname(abs));
  const vars = {
    TITLE: title || (B && B.name) || path.basename(abs, '.html'), WIDTH: width || f.width, HEIGHT: height || f.height, FPS: fps, DURATION: duration || meta.duration || 8,
    THEME: theme || (B && B.motion && B.motion.theme) || meta.theme || 'ink', ACCENT: accent || (B && B.motion && B.motion.accent) || meta.accent || 'blue',
    PLATFORM: f.platform && !width ? ` data-platform="${f.platform}"` : ''
  };
  let html = fs.readFileSync(tplFile, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  if (/\.html?$/i.test(template) && B && B.motion) html = html.replace(/(<div id="stage"[^>]*?)data-accent="[^"]*"/, `$1data-accent="${vars.ACCENT}"`);
  if (B) html = brandVars(html, B);
  fs.writeFileSync(abs, html);
  // the brand's logo travels with the composition
  if (B && B.logo) { const src = path.join(path.dirname(path.resolve(brand)), B.logo), dst = path.join(path.dirname(abs), B.logo); if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst); }
  // files a template ships with (music beds, caption files) travel too
  for (const extra of meta.files || []) { const src = path.join(path.dirname(tplFile), extra), dst = path.join(path.dirname(abs), path.basename(extra)); if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst); }
  syncRuntime(path.dirname(abs));
  return abs;
}

/**
 * A brand file fills the template variables that share its words: name, tagline (shortened for the screen), url (as shown), logo.
 * Only the defaults change — --vars still wins.
 */
function brandVars(html, B) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fit = (s, max = 30) => { s = String(s || '').replace(/\s+/g, ' ').trim(); if (s.length <= max) return s; const cut = s.slice(0, max + 1); const i = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(',')); return (i > max * 0.5 ? cut.slice(0, i) : s.slice(0, max)).replace(/[,\s]+$/, ''); };
  // the site's own line, short enough for a frame: its first sentence or a heading of 6–30 characters
  const lines = [String(B.tagline || '').split(/(?<=[^\d\s][.!?。])\s+|\n/)[0], ...(B.headings || [])].map((x) => String(x || '').trim()).filter(Boolean);
  const tagline = lines.find((x) => x.length >= 6 && x.length <= 30) || fit(lines[0] || '');
  const url = B.url ? String(B.url).replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '') : '';
  const text = { name: B.name, tagline, url };
  for (const [k, v] of Object.entries(text)) {
    if (!v) continue;
    html = html.replace(new RegExp(`(<([a-z][a-z0-9]*)\\b[^>]*\\bdata-var="${k}"[^>]*>)([^<]*)(</\\2>)`, 'gi'), (m, open, tag, old, close) => open + esc(v) + close);
  }
  if (B.logo) html = html.replace(/<img\b[^>]*\bdata-var="logo"[^>]*>/gi, (tag) => /\bsrc="[^"]*"/.test(tag) ? tag.replace(/\bsrc="[^"]*"/, `src="${B.logo}"`) : tag.replace(/<img\b/, `<img src="${B.logo}"`));
  return html;
}

export function listTemplates(detailed) {
  const meta = templateMeta(), names = fs.readdirSync(TEMPLATES).filter((x) => x.endsWith('.html')).map((x) => x.replace('.html', ''));
  if (!detailed) return names;
  return names.map((n) => { const m = { ...inlineTemplateMeta(path.join(TEMPLATES, n + '.html')), ...(meta[n] || {}) }; return { name: n, about: m.about || '', format: m.format || 'shorts', duration: m.duration || 8 }; });
}
