import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ENGINE = path.join(ROOT, 'engine');
export const TEMPLATES = path.join(ROOT, 'templates');
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

/** Tiny argv parser: --key value | --key=value | --flag | positionals in `_`. */
export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) out[a.slice(2, eq)] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !/^--/.test(argv[i + 1])) out[a.slice(2)] = argv[++i];
      else out[a.slice(2)] = true;
    } else out._.push(a);
  }
  return out;
}

export const num = (v, d) => (v === undefined || v === true || v === '' || Number.isNaN(+v) ? d : +v);
export const log = (...a) => process.stderr.write(a.join(' ') + '\n');

export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

export function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : (n / 1024).toFixed(0) + ' KB'; }

export function progressBar(label) {
  let last = 0;
  const tty = process.stderr.isTTY;
  return (done, total, extra = '') => {
    const now = Date.now();
    if (done < total && now - last < (tty ? 120 : 2500)) return;
    last = now;
    const pct = Math.floor((done / total) * 100);
    const line = `${label} ${String(pct).padStart(3)}%  ${done}/${total} ${extra}`;
    if (tty) process.stderr.write('\r' + line + '   ' + (done >= total ? '\n' : ''));
    else process.stderr.write(line + '\n');
  };
}

/** Formats the user can ask for by name. */
export const FORMATS = {
  shorts: { width: 1080, height: 1920, label: '9:16 쇼츠·릴스·틱톡', platform: 'shorts' },
  vertical: { width: 1080, height: 1920, label: '9:16 세로' },
  wide: { width: 1920, height: 1080, label: '16:9 유튜브·발표' },
  square: { width: 1080, height: 1080, label: '1:1 피드' },
  portrait: { width: 1080, height: 1350, label: '4:5 인스타 피드' },
  insert: { width: 1080, height: 830, label: '쇼츠 본문 인서트(자막 영역 제외)' },
  cinema: { width: 1920, height: 804, label: '2.39:1 시네마(레터박스 없는 와이드)' },
  uhd: { width: 3840, height: 2160, label: '4K 16:9' }
};
