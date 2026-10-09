/**
 * Data-driven rendering: one composition, many videos — a row of a spreadsheet becomes the template variables of one render
 * (a certificate per student, an invitation per class, a clip per product).
 */
import fs from 'node:fs';
import path from 'node:path';
import { render } from './render.mjs';
import { openComposition } from './capture.mjs';
import { ensureDir } from './util.mjs';

/** CSV (RFC 4180, BOM-tolerant) or TSV text → array of row objects keyed by the header. */
export function parseTable(text) {
  const s = String(text).replace(/^﻿/, ''), delim = (s.split('\n')[0].match(/\t/g) || []).length > (s.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x !== '')) rows.push(row);
  const head = (rows.shift() || []).map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
export function readRows(file) {
  const t = fs.readFileSync(file, 'utf8');
  if (/\.json$/i.test(file)) { const j = JSON.parse(t); return Array.isArray(j) ? j : j.rows || []; }
  return parseTable(t);
}
const NAME_KEYS = ['_name', 'name', 'file', 'filename', '파일명', '이름'];
const safe = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'video';

/** The template variables a composition declares (data-var, M.var, built-ins). */
export async function listVars(file) {
  const comp = await openComposition(file, { scale: 0.25 });
  try { return await comp.pages[0].evaluate(() => (window.__motion.vars ? window.__motion.vars() : [])); } finally { await comp.close(); }
}

/**
 * batch(file, { data, out, name, quality, format, onRow }) — renders every row. `name` is a pattern like "{이름}-{반}" (default: a name column, else the row number).
 * Columns that are not template variables are reported, not silently ignored.
 */
export async function batch(file, o = {}) {
  const rows = Array.isArray(o.rows) ? o.rows : readRows(o.data);
  if (!rows.length) throw new Error('데이터에 행이 없습니다: ' + o.data);
  const defs = await listVars(file), known = new Set(defs.map((d) => d.name)), cols = Object.keys(rows[0]);
  const unknown = cols.filter((c) => !known.has(c) && !NAME_KEYS.includes(c) && !c.startsWith('_'));
  const dir = ensureDir(o.out || path.join(path.dirname(path.resolve(file)), 'out', path.basename(file, '.html') + '-batch'));
  const ext = (o.format || 'mp4').toLowerCase(), done = [], used = new Set();
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i], vars = new URLSearchParams();
    for (const [k, v] of Object.entries(row)) if (known.has(k) && v !== '') vars.set(k, v);
    let name = o.name ? o.name.replace(/\{([^}]+)\}/g, (m, k) => row[k] ?? '') : (NAME_KEYS.map((k) => row[k]).find(Boolean) || String(i + 1).padStart(3, '0'));
    name = safe(name); while (used.has(name)) name += '_'; used.add(name);
    const outFile = path.join(dir, name + '.' + (ext === 'prores' ? 'mov' : ext));
    const r = await render(file, { ...o, out: outFile, vars: vars.toString(), quiet: true });
    done.push({ row: i + 1, file: r.file, size: r.size, seconds: r.seconds, problems: r.problems });
    if (o.onRow) o.onRow(i + 1, rows.length, r);
  }
  const report = { file: path.resolve(file), rows: rows.length, out: dir, vars: defs.map((d) => d.name), unknownColumns: unknown, renders: done };
  fs.writeFileSync(path.join(dir, 'batch-report.json'), JSON.stringify(report, null, 1));
  return report;
}
