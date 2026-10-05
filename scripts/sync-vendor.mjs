// postinstall: place GSAP next to the engine so compositions can load it from ./_motion/gsap.min.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'gsap', 'dist', 'gsap.min.js');
const dest = path.join(root, 'engine', 'vendor', 'gsap.min.js');
try {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
} catch (e) {
  console.warn('[motion] gsap을 복사하지 못했습니다:', e.message);
}
