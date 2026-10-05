// Dev-time only: builds engine/icons.js from lucide-static (ISC).
//   npm i -D lucide-static && node scripts/build-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'lucide-static', 'icons');

// Candidate names (old and new lucide names both listed; whichever exists is used).
const want = `
search check circle-check check-circle x plus minus arrow-right arrow-left arrow-up arrow-down arrow-up-right
chevron-right chevron-down chevron-left chevron-up menu ellipsis settings sliders-horizontal funnel filter house home
user users bell mail send paperclip link external-link download upload share-2 copy trash-2 pencil pen-line eye lock
key shield-check globe map-pin calendar clock timer alarm-clock bookmark heart star thumbs-up message-circle
message-square mic volume-2 music play pause skip-forward image camera video film monitor smartphone laptop tablet tv
keyboard mouse-pointer-2 mouse-pointer-click pointer folder folder-open file file-text files clipboard-list
clipboard-check list list-checks layout-grid layout-dashboard table square-kanban layers box package database server
cloud cpu zap sparkles sparkle wand-sparkles bot brain lightbulb rocket target flag trophy medal award crown gift
party-popper flame sun moon cloud-rain leaf tree-pine mountain waves droplets wind book book-open graduation-cap
school pencil-ruler calculator microscope flask-conical atom dna palette brush scissors ruler shapes type quote hash
at-sign code code-xml terminal git-branch bug workflow network refresh-cw rotate-cw repeat shuffle maximize-2
minimize-2 move crop zoom-in zoom-out scan qr-code credit-card wallet shopping-cart shopping-bag store tag percent
dollar-sign banknote piggy-bank trending-up trending-down chart-column chart-line chart-pie chart-no-axes-column
activity gauge footprints bike dumbbell heart-pulse stethoscope pill utensils coffee car bus train-front plane ship
building building-2 landmark hospital tent compass map navigation wifi bluetooth battery-full plug power info
circle-help triangle-alert circle-alert circle square triangle hexagon loader-circle smile hand-heart handshake
megaphone newspaper rss radio podcast languages accessibility baby person-standing volleyball goal presentation
notebook-pen sticky-note inbox archive history undo-2 redo-2 save printer scan-line fingerprint badge-check
circle-play circle-plus circle-x square-check command option corner-down-left grip-vertical panel-left app-window
picture-in-picture-2 mouse wand pen-tool spline component frame blend contrast aperture focus glasses headphones
gamepad-2 puzzle dices ticket calendar-check calendar-days hourglass milestone route signpost flag-triangle-right
`.split(/\s+/).filter(Boolean);

const out = {};
const missing = [];
for (const name of want) {
  const f = path.join(src, name + '.svg');
  if (!fs.existsSync(f)) { missing.push(name); continue; }
  const svg = fs.readFileSync(f, 'utf8');
  const inner = svg
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<svg[\s\S]*?>/, '')
    .replace(/<\/svg>/, '')
    .replace(/\s*\n\s*/g, '')
    .replace(/\s+\/>/g, '/>')
    .trim();
  out[name] = inner;
}

const names = Object.keys(out).sort();
const body = names.map((n) => `  ${JSON.stringify(n)}: ${JSON.stringify(out[n])}`).join(',\n');
const js = `/*! Icon paths from Lucide (https://lucide.dev) — ISC License. Copyright (c) Lucide Icons and Contributors. See engine/licenses/LUCIDE-ISC.txt */
(function (g) {
  g.MotionIcons = {
${body}
  };
})(window);
`;
fs.writeFileSync(path.join(root, 'engine', 'icons.js'), js);
console.log(`icons: ${names.length} written, missing: ${missing.join(', ') || '(none)'}`);
