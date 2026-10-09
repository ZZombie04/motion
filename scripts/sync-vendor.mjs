// postinstall: place the third-party runtimes next to the engine so compositions load them from ./_motion/
//   gsap.min.js     GSAP core + its plugins (MorphSVG, DrawSVG, MotionPath, CustomEase, Physics2D … — all free since 3.13), one file
//   lottie.min.js   Lottie player (SVG renderer) — only loaded when a composition uses Lottie
//   three.*.js      three.js (ES modules) — only loaded when a composition uses M.three
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = (...p) => path.join(root, 'node_modules', ...p);
const vendor = path.join(root, 'engine', 'vendor');
const PLUGINS = ['CustomEase', 'CustomWiggle', 'CustomBounce', 'EasePack', 'MorphSVGPlugin', 'DrawSVGPlugin', 'MotionPathPlugin', 'Physics2DPlugin', 'PhysicsPropsPlugin', 'ScrambleTextPlugin', 'TextPlugin', 'SplitText', 'Flip'];

fs.mkdirSync(vendor, { recursive: true });
try {
  const parts = [fs.readFileSync(nm('gsap', 'dist', 'gsap.min.js'), 'utf8')];
  for (const p of PLUGINS) { const f = nm('gsap', 'dist', p + '.min.js'); if (fs.existsSync(f)) parts.push(fs.readFileSync(f, 'utf8')); }
  fs.writeFileSync(path.join(vendor, 'gsap.min.js'), parts.join('\n;\n'));
} catch (e) {
  console.warn('[motion] gsap을 준비하지 못했습니다:', e.message);
}
const copies = [
  [nm('lottie-web', 'build', 'player', 'lottie_svg.min.js'), 'lottie.min.js'],
  [nm('three', 'build', 'three.module.js'), 'three.module.js'],
  [nm('three', 'build', 'three.core.js'), 'three.core.js']
];
for (const [src, name] of copies) {
  try { if (fs.existsSync(src)) fs.copyFileSync(src, path.join(vendor, name)); } catch (e) { console.warn('[motion] ' + name + ' 복사 실패:', e.message); }
}
