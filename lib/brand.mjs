/**
 * Brand from a website: open the page, read what it actually paints — background, text and button colours, heading and body fonts,
 * the logo and the page's own words — and write a brand file the composition can follow (accent, theme, logo, name, tagline).
 * The logo is saved next to the brief so a composition can use it from the same folder; nothing else is copied.
 */
import fs from 'node:fs';
import path from 'node:path';
import { launch, destroy } from './browser.mjs';
import { ensureDir } from './util.mjs';

const ACCENTS = { blue: '#3D7BFF', cyan: '#2FD4FF', mint: '#2EF0B0', lime: '#C9F53F', yellow: '#FFD60A', amber: '#FFB224', orange: '#FF6B2C', red: '#FF453A', pink: '#FF4F9A', violet: '#8E6BFF' };
function rgb(s) { const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(s || ''); return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] } : null; }
const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
function hsl(c) { const r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2; let h = 0, s = 0; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return { h, s, l }; }
const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
function nearest(c) { const h = hsl(c).h; let best = 'blue', bd = 1e9; for (const [k, v] of Object.entries(ACCENTS)) { const hv = hsl(rgb('rgb(' + [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)).join(',') + ')')).h, d = Math.min(Math.abs(h - hv), 360 - Math.abs(h - hv)); if (d < bd) { bd = d; best = k; } } return best; }

export async function brand(url, { out } = {}) {
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const dir = ensureDir(out || path.resolve('brand'));
  const b = await launch();
  try {
    const page = (await b.pages())[0];
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => page.goto(url, { waitUntil: 'load', timeout: 45000 }));
    await new Promise((r) => setTimeout(r, 1200));
    const data = await page.evaluate(() => {
      const vis = (el) => { const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.1 && r.top < innerHeight * 2.5; };
      const area = (el) => { const r = el.getBoundingClientRect(); return Math.min(r.width * r.height, 2e5); };
      const colors = [];
      document.querySelectorAll('body, header, nav, main, section, footer, div, a, button, [class*=btn], [class*=button], h1, h2, h3, span, li').forEach((el) => {
        if (!vis(el)) return; const cs = getComputedStyle(el), w = area(el);
        colors.push({ kind: 'bg', c: cs.backgroundColor, w, tag: el.tagName, btn: /^(A|BUTTON)$/.test(el.tagName) || /btn|button|cta/i.test(el.className || '') });
        if (el.childElementCount === 0 && (el.textContent || '').trim()) colors.push({ kind: 'fg', c: cs.color, w: Math.min(w, 2e4), tag: el.tagName, btn: /^(A|BUTTON)$/.test(el.tagName) });
      });
      const font = (sel) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).fontFamily : ''; };
      const meta = (n) => (document.querySelector(`meta[name="${n}"], meta[property="${n}"]`) || {}).content || '';
      const logos = [];
      document.querySelectorAll('header img, nav img, a[href="/"] img, img[class*=logo i], img[alt*=logo i], img[src*=logo i], [class*=logo i] img, [class*=logo i] svg, header svg').forEach((el) => {
        if (!vis(el)) return; const r = el.getBoundingClientRect();
        logos.push({ src: el.tagName === 'IMG' ? (el.currentSrc || el.src) : null, svg: el.tagName.toLowerCase() === 'svg' ? el.outerHTML : null, x: r.left, y: r.top, w: r.width, h: r.height });
      });
      const h1 = document.querySelector('h1'), heads = [...document.querySelectorAll('h1, h2')].filter(vis).slice(0, 6).map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter(Boolean);
      return { title: document.title, description: meta('description') || meta('og:description'), themeColor: meta('theme-color'), ogImage: meta('og:image'), siteName: meta('og:site_name'),
        bodyBg: getComputedStyle(document.body).backgroundColor, htmlBg: getComputedStyle(document.documentElement).backgroundColor, colors, logos, heads,
        fonts: { heading: font('h1') || font('h2'), body: font('p') || getComputedStyle(document.body).fontFamily }, h1: h1 ? h1.textContent.trim().replace(/\s+/g, ' ') : '' };
    });
    await page.screenshot({ path: path.join(dir, 'site.png') });
    // palette: weighted colours; accent = the most saturated colour that buttons/links or large areas use
    const bins = new Map();
    for (const c of data.colors) { const v = rgb(c.c); if (!v || v.a < 0.6) continue; const key = hex(v), cur = bins.get(key) || { c: v, w: 0, btn: 0 }; cur.w += c.w; if (c.btn) cur.btn += c.w; bins.set(key, cur); }
    const list = [...bins.values()].sort((a, b) => b.w - a.w);
    const bg = rgb(data.bodyBg) && rgb(data.bodyBg).a > 0.5 ? rgb(data.bodyBg) : rgb(data.htmlBg) && rgb(data.htmlBg).a > 0.5 ? rgb(data.htmlBg) : (list[0] && list[0].c) || { r: 255, g: 255, b: 255 };
    const vivid = list.filter((x) => { const h = hsl(x.c); return h.s > 0.35 && h.l > 0.25 && h.l < 0.8; }).sort((a, b) => (b.btn * 3 + b.w) * hsl(b.c).s - (a.btn * 3 + a.w) * hsl(a.c).s);
    const theme = data.themeColor && rgb(data.themeColor) ? rgb(data.themeColor) : null;
    const accentC = vivid[0] ? vivid[0].c : theme;
    const dark = lum(bg) < 0.2;
    const fam = (f) => String(f || '').split(',')[0].replace(/["']/g, '').trim();
    const serif = /serif/i.test(data.fonts.heading) && !/sans/i.test(data.fonts.heading);
    // logo: the largest one near the top-left, saved locally
    let logo = null;
    const cand = data.logos.filter((l) => l.y < 200).sort((a, b) => a.y - b.y || a.x - b.x)[0] || data.logos[0];
    if (cand && cand.svg) { logo = 'logo.svg'; fs.writeFileSync(path.join(dir, logo), cand.svg.replace(/^<svg(?![^>]*xmlns=)/, '<svg xmlns="http://www.w3.org/2000/svg"')); }
    else if (cand && cand.src && /^https?:/i.test(cand.src)) {
      try { const res = await page.goto(cand.src, { timeout: 20000 }); const buf = res && res.ok() ? await res.buffer() : null; const ext = (/\.(png|jpe?g|svg|webp|gif)(\?|$)/i.exec(cand.src) || [, 'png'])[1].toLowerCase().replace('jpeg', 'jpg'); if (buf && buf.length > 100) { logo = 'logo.' + ext; fs.writeFileSync(path.join(dir, logo), buf); } } catch { logo = null; }
    }
    const result = {
      url, name: data.siteName || (data.title || '').split(/[|\-–·:]/)[0].trim(), title: data.title, tagline: data.description || data.h1, headings: data.heads,
      colors: { background: hex(bg), text: list.find((x) => Math.abs(lum(x.c) - lum(bg)) > 0.4) ? hex(list.find((x) => Math.abs(lum(x.c) - lum(bg)) > 0.4).c) : (dark ? '#F5F5F7' : '#0B0B0D'), accent: accentC ? hex(accentC) : null, palette: list.slice(0, 8).map((x) => hex(x.c)) },
      fonts: { heading: fam(data.fonts.heading), body: fam(data.fonts.body), use: serif ? 'Instrument Serif(제목 영문) + Pretendard' : 'Pretendard + Geist(숫자·영문)' },
      motion: { theme: dark ? 'ink' : (lum(bg) > 0.9 ? 'white' : 'paper'), accent: accentC ? hex(accentC) : 'blue', nearestAccent: accentC ? nearest(accentC) : 'blue' },
      logo, screenshot: 'site.png'
    };
    fs.writeFileSync(path.join(dir, 'brand.json'), JSON.stringify(result, null, 1));
    const md = [`# 브랜드 — ${result.name || url}`, '', `출처 ${url}`, '', `- 테마 \`${result.motion.theme}\` · 포인트 \`${result.motion.accent}\`(가까운 이름: ${result.motion.nearestAccent})`, `- 배경 ${result.colors.background} · 글자 ${result.colors.text} · 팔레트 ${result.colors.palette.join(' ')}`, `- 사이트 글꼴: 제목 ${result.fonts.heading || '-'} · 본문 ${result.fonts.body || '-'} → 영상에서는 ${result.fonts.use}`, `- 로고: ${logo || '찾지 못함(이름 워드마크로)'}`, `- 사이트의 말: ${result.tagline || '-'}`, ...(result.headings.length ? ['- 제목들: ' + result.headings.map((h) => `“${h}”`).join(' · ')] : []), '', '이 색과 말만 쓴다. 사이트에 없는 수치·실적·인증을 지어내지 않는다.'].join('\n');
    fs.writeFileSync(path.join(dir, 'brand.md'), md + '\n');
    return { ...result, dir, markdown: md };
  } finally { destroy([b]); }
}
