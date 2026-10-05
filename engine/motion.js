/*! Motion Director runtime v1.0.0 — MIT
 *  A deterministic stage on top of one paused GSAP timeline.
 *  Every frame is a pure function of time:  window.__motion.seek(t)  → same pixels, always.
 *  No clocks, no Math.random, no network. Preview and render walk the exact same code path.
 */
(function (global) {
  'use strict';
  var doc = document;
  var gsap = global.gsap;
  if (!gsap) { console.error('[motion] gsap.min.js must load before motion.js'); return; }

  var QS = new URLSearchParams(location.search);
  var RENDER = QS.has('render');
  var NOCAM = QS.has('nocam');                 // review the resting layout with every camera move switched off
  var SCRAMBLE = 'ABCDEFGHJKLMNPQRSTUVWXYZ#/+<>';
  var Motion = { version: '1.0.0', render: RENDER };

  // ───────────────────────── math ─────────────────────────
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function mapRange(v, a, b, c, d) { return c + (d - c) * clamp((v - a) / (b - a), 0, 1); }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function hashStr(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) {
    var a = (typeof seed === 'string' ? hashStr(seed) : (seed | 0)) >>> 0 || 1;
    return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function hash2(i, seed) { var h = Math.imul((i | 0) ^ (seed | 0), 0x45d9f3b); h ^= h >>> 16; h = Math.imul(h, 0x45d9f3b); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
  /** Smooth 1D value noise in [-1, 1]; deterministic for (x, seed). */
  function noise(x, seed) { var i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return lerp(hash2(i, seed || 1), hash2(i + 1, seed || 1), u) * 2 - 1; }

  function cubicBezier(x1, y1, x2, y2) {
    var cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    var cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    function sx(t) { return ((ax * t + bx) * t + cx) * t; }
    function sy(t) { return ((ay * t + by) * t + cy) * t; }
    function dx(t) { return (3 * ax * t + 2 * bx) * t + cx; }
    return function (x) {
      if (x <= 0) return 0; if (x >= 1) return 1;
      var t = x, i, e, d;
      for (i = 0; i < 8; i++) { e = sx(t) - x; if (Math.abs(e) < 1e-6) return sy(t); d = dx(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
      var lo = 0, hi = 1; t = x;
      for (i = 0; i < 24; i++) { e = sx(t); if (Math.abs(e - x) < 1e-6) break; if (x > e) lo = t; else hi = t; t = (lo + hi) / 2; }
      return sy(t);
    };
  }
  function springEase(zeta, omega) {
    var wd = omega * Math.sqrt(1 - zeta * zeta), k = (zeta * omega) / wd;
    var end = 1 - Math.exp(-zeta * omega) * (Math.cos(wd) + k * Math.sin(wd));
    return function (t) { if (t <= 0) return 0; if (t >= 1) return 1; return (1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + k * Math.sin(wd * t))) / end; };
  }

  // House easing set. Use these names anywhere GSAP accepts an ease.
  var EASES = {
    'mo.out': cubicBezier(0.16, 1, 0.3, 1),        // entrances: fast in, long settle (expo-like)
    'mo.soft': cubicBezier(0.33, 1, 0.68, 1),      // gentle out for small/slow things
    'mo.inOut': cubicBezier(0.65, 0, 0.35, 1),     // A→B moves of UI and objects
    'mo.cam': cubicBezier(0.6, 0, 0.18, 1),        // camera: unhurried start, very long landing
    'mo.in': cubicBezier(0.55, 0, 0.9, 0.35),      // exits: leave by accelerating
    'mo.snap': cubicBezier(0.2, 0.9, 0.1, 1),      // beat hits, slams
    'mo.swift': cubicBezier(0.4, 0, 0.1, 1),       // whip / fast travel
    'mo.spring': springEase(0.62, 11),             // ~8% overshoot — small UI
    'mo.pop': springEase(0.5, 12),                 // ~16% overshoot — chips, dots, badges only
    'mo.settle': springEase(0.78, 9)               // ~2% overshoot — large objects landing
  };
  Object.keys(EASES).forEach(function (k) { gsap.registerEase(k, EASES[k]); });
  gsap.defaults({ lazy: false, overwrite: false });
  gsap.config({ nullTargetWarn: false });

  // ───────────────────────── dom utils ─────────────────────────
  function toArray(t, root) {
    if (!t) return [];
    if (typeof t === 'string') return Array.prototype.slice.call((root || doc).querySelectorAll(t));
    if (t.nodeType) return [t];
    if (t.length != null) return Array.prototype.slice.call(t);
    return [t];
  }
  function one(t, root) { return toArray(t, root)[0] || null; }
  function h(tag, cls, parent, html) { var e = doc.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; if (parent) parent.appendChild(e); return e; }
  var SEG = (global.Intl && Intl.Segmenter) ? new Intl.Segmenter('ko', { granularity: 'grapheme' }) : null;
  function graphemes(s) { if (SEG) { var out = []; var it = SEG.segment(s)[Symbol.iterator](), n; while (!(n = it.next()).done) out.push(n.value.segment); return out; } return Array.from(s); }

  var colorCache = {}, colorCtx = null;
  /** Any CSS colour → { r, g, b (0–255), a (0–1) } in sRGB. Goes through a canvas so oklab()/color()/color-mix() work. */
  function parseColor(c) {
    c = String(c == null ? '' : c).trim();
    if (colorCache[c]) return colorCache[c];
    var v = c;
    if (/var\(|currentcolor|inherit/i.test(v)) { var d = h('i'); d.style.color = v; (doc.getElementById('stage') || doc.documentElement).appendChild(d); v = getComputedStyle(d).color; d.remove(); }
    if (!colorCtx) { var cv = doc.createElement('canvas'); cv.width = cv.height = 1; colorCtx = cv.getContext('2d', { willReadFrequently: true }); }
    colorCtx.clearRect(0, 0, 1, 1); colorCtx.fillStyle = 'rgba(0,0,0,0)'; colorCtx.fillStyle = v; colorCtx.fillRect(0, 0, 1, 1);
    var px = colorCtx.getImageData(0, 0, 1, 1).data, out = { r: px[0], g: px[1], b: px[2], a: +(px[3] / 255).toFixed(3) };
    if (!/var\(|currentcolor|inherit/i.test(c)) colorCache[c] = out;
    return out;
  }
  function over(fg, bg, alpha) { var a = fg.a * (alpha == null ? 1 : alpha); return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 }; }
  function luminance(c) { function f(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); } return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); }
  function contrast(a, b) { var la = luminance(a), lb = luminance(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); }
  function rgbToHsl(c) { var r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), hh = 0, s = 0, l = (mx + mn) / 2; if (mx !== mn) { var d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; } return { h: hh, s: s * 100, l: l * 100 }; }

  var ACCENTS = { blue: '#3D7BFF', cyan: '#2FD4FF', mint: '#2EF0B0', lime: '#C9F53F', yellow: '#FFD60A', amber: '#FFB224', orange: '#FF6B2C', red: '#FF453A', pink: '#FF4F9A', violet: '#8E6BFF', white: '#FFFFFF', ink: '#0B0B0D' };
  Motion.accents = ACCENTS;

  // ───────────────────────── Hangul IME keystroke frames ─────────────────────────
  var CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ'.split('');
  var JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ'.split('');
  var JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ', 'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
  var VSPLIT = { 9: [8, 0], 10: [8, 1], 11: [8, 20], 14: [13, 4], 15: [13, 5], 16: [13, 20], 19: [18, 20] };            // ㅘ=ㅗ+ㅏ …
  var JSPLIT = { 3: [1, 'ㅅ'], 5: [4, 'ㅈ'], 6: [4, 'ㅎ'], 9: [8, 'ㄱ'], 10: [8, 'ㅁ'], 11: [8, 'ㅂ'], 12: [8, 'ㅅ'], 13: [8, 'ㅌ'], 14: [8, 'ㅍ'], 15: [8, 'ㅎ'], 18: [17, 'ㅅ'] };  // ㄳ=ㄱ+ㅅ …
  function syl(c, v, j) { return String.fromCharCode(0xAC00 + (c * 21 + v) * 28 + (j || 0)); }
  function decomp(ch) { var k = ch.charCodeAt(0) - 0xAC00; if (k < 0 || k > 11171) return null; return { c: Math.floor(k / 588), v: Math.floor((k % 588) / 28), j: k % 28 }; }
  /** Every intermediate string a Korean 2-set IME shows while typing `text` (incl. the jongseong that hops to the next syllable). */
  function typeFrames(text) {
    var chars = Array.from(text), frames = [''], done = '';
    for (var i = 0; i < chars.length; i++) {
      var ch = chars[i], d = decomp(ch);
      if (!d) { done += ch; frames.push(done); continue; }
      var prev = i > 0 ? decomp(chars[i - 1]) : null, hopped = false;
      if (prev) {
        // the initial consonant of this syllable first lands as the previous syllable's final consonant
        var asJong = JONG.indexOf(CHO[d.c]), base = done.slice(0, -1);
        if (prev.j === 0 && asJong > 0) { frames.push(base + syl(prev.c, prev.v, asJong)); hopped = true; }
        else if (prev.j > 0) {
          for (var k in JSPLIT) { if (JSPLIT[k][0] === prev.j && JSPLIT[k][1] === CHO[d.c]) { frames.push(base + syl(prev.c, prev.v, +k)); hopped = true; break; } }
        }
      }
      if (!hopped) frames.push(done + CHO[d.c]);
      if (VSPLIT[d.v]) frames.push(done + syl(d.c, VSPLIT[d.v][0], 0));
      frames.push(done + syl(d.c, d.v, 0));
      if (d.j) {
        if (JSPLIT[d.j]) frames.push(done + syl(d.c, d.v, JSPLIT[d.j][0]));
        frames.push(done + syl(d.c, d.v, d.j));
      }
      done += ch;
    }
    return frames;
  }
  Motion.typeFrames = typeFrames;

  // ───────────────────────── text splitting ─────────────────────────
  function textNodes(el) {
    var out = [], w = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT, null), n;
    while ((n = w.nextNode())) { if (n.nodeValue.trim() && !n.parentNode.closest('.mo-hl-top,[data-mo-ignore]')) out.push(n); }
    return out;
  }
  /**
   * split(target, { by: 'lines' | 'words' | 'chars', mask: true })
   * → { lines, words, chars }  — arrays of the elements you animate (the inner, masked spans).
   */
  function split(target, opts) {
    opts = opts || {};
    var by = opts.by || 'words', mask = opts.mask !== false, tight = opts.tight ? ' tight' : '';
    var res = { lines: [], words: [], chars: [], els: toArray(target) };
    res.els.forEach(function (el) {
      if (el._moSplit) { var p = el._moSplit; res.lines = res.lines.concat(p.lines); res.words = res.words.concat(p.words); res.chars = res.chars.concat(p.chars); return; }
      var own = { lines: [], words: [], chars: [] };
      el.setAttribute('data-mo-split', by);
      textNodes(el).forEach(function (node) {
        var frag = doc.createDocumentFragment();
        node.nodeValue.split(/(\s+)/).forEach(function (part) {
          if (!part) return;
          if (/^\s+$/.test(part)) { frag.appendChild(doc.createTextNode(' ')); return; }
          var w = h('span', 'mo-w');
          if (by === 'chars') {
            graphemes(part).forEach(function (g) { var c = h('span', 'mo-c', w); c.textContent = g; own.chars.push(c); });
            if (mask) w.className = 'mo-w mo-m' + tight;
            own.words.push(w);
          } else if (by === 'words' && mask) {
            w.className = 'mo-w mo-m' + tight; var inner = h('span', 'mo-i', w); inner.textContent = part; own.words.push(inner);
          } else { w.textContent = part; own.words.push(w); }
          frag.appendChild(w);
        });
        node.parentNode.replaceChild(frag, node);
      });
      if (by === 'lines') {
        // group top-level inline units by their rendered row
        var units = Array.prototype.slice.call(el.childNodes), rows = [], cur = null, lastTop = null;
        units.forEach(function (u) {
          if (u.nodeType === 1 && u.tagName === 'BR') { cur = null; lastTop = null; u._br = true; return; }
          if (u.nodeType === 3) { if (cur) cur.push(u); return; }
          if (u.nodeType !== 1) return;
          var top = u.offsetTop;
          if (cur === null || lastTop === null || Math.abs(top - lastTop) > u.offsetHeight * 0.5) { cur = []; rows.push(cur); lastTop = top; }
          cur.push(u);
        });
        units.forEach(function (u) { if (u._br) u.remove(); });
        rows.forEach(function (row) {
          while (row.length && row[row.length - 1].nodeType === 3) row.pop();
          if (!row.length) return;
          var line = h('span', mask ? 'mo-l' + tight : 'mo-l-plain'), inner = h('span', 'mo-i', line);
          if (!mask) line.style.display = 'block';
          el.insertBefore(line, row[0]);
          row.forEach(function (u) { inner.appendChild(u); });
          own.lines.push(inner);
        });
        Array.prototype.slice.call(el.childNodes).forEach(function (n) { if (n.nodeType === 3 && !n.nodeValue.trim()) n.remove(); });
      }
      el._moSplit = own;
      toArray('.mo-hl', el).forEach(syncHighlight);
      res.lines = res.lines.concat(own.lines); res.words = res.words.concat(own.words); res.chars = res.chars.concat(own.chars);
    });
    return res;
  }
  Motion.split = split;
  /** (Re)build the on-accent text layer of a highlight as an exact clone of its base. */
  function syncHighlight(el) {
    var base = el.querySelector(':scope > .mo-hl-base'); if (!base) return;
    var old = el.querySelector(':scope > .mo-hl-top'); if (old) old.remove();
    var top = base.cloneNode(true); top.className = 'mo-hl-top'; top.setAttribute('data-mo-ignore', ''); top.setAttribute('aria-hidden', 'true');
    el.appendChild(top);
    var a = base.querySelectorAll('*'), b = top.querySelectorAll('*'), pairs = [];
    for (var i = 0; i < a.length && i < b.length; i++) pairs.push([a[i], b[i]]);
    el._moPairs = pairs;
    if (highlights.indexOf(el) < 0) highlights.push(el);
  }
  var highlights = [];
  function mirrorHighlights() {
    for (var i = 0; i < highlights.length; i++) {
      var pairs = highlights[i]._moPairs || [];
      for (var k = 0; k < pairs.length; k++) { var css = pairs[k][0].style.cssText; if (pairs[k][1]._css !== css) { pairs[k][1].style.cssText = css; pairs[k][1]._css = css; } }
    }
  }

  // ───────────────────────── compose ─────────────────────────
  var FONT_PROBES = ['600 32px "Pretendard"', '500 32px "Geist"', '500 32px "Geist Mono"', '400 32px "Instrument Serif"', 'italic 400 32px "Instrument Serif"'];
  function fontsReady() {
    if (!doc.fonts) return Promise.resolve();
    return Promise.all(FONT_PROBES.map(function (f) { return doc.fonts.load(f, '가A1').catch(function () {}); })).then(function () { return doc.fonts.ready; });
  }
  function mediaReady(stage) {
    var jobs = [];
    toArray('img', stage).forEach(function (img) { if (!img.complete) jobs.push(new Promise(function (r) { img.onload = img.onerror = r; })); else if (img.decode) jobs.push(img.decode().catch(function () {})); });
    toArray('video', stage).forEach(function (v) { v.muted = true; v.pause(); v.preload = 'auto'; if (v.readyState < 2) jobs.push(new Promise(function (r) { v.addEventListener('loadeddata', r, { once: true }); v.addEventListener('error', r, { once: true }); })); });
    return Promise.all(jobs);
  }

  var errors = [];
  function fail(msg) { errors.push(String(msg)); console.error('[motion] ' + msg); if (!RENDER) { var w = doc.getElementById('mo-warn') || h('div', '', doc.body); w.id = 'mo-warn'; w.textContent = errors.join('\n'); } }
  global.addEventListener('error', function (e) { fail((e.message || e) + (e.filename ? '  @' + String(e.filename).split('/').pop() + ':' + e.lineno : '')); });
  global.addEventListener('unhandledrejection', function (e) { fail('unhandled: ' + (e.reason && e.reason.message || e.reason)); });

  Motion.compose = function (fn) {
    function start() {
      var stage = doc.getElementById('stage');
      if (!stage) return fail('No <div id="stage"> found.');
      var cfg = setupStage(stage);
      Promise.all([fontsReady(), mediaReady(stage)]).then(function () {
        var M = createContext(stage, cfg);
        Motion.current = M;
        return Promise.resolve().then(function () { return fn(M); }).then(function () { finalize(M); });
      }).catch(function (e) { fail(e && e.stack || e); global.__motion = global.__motion || { ready: true, failed: true, errors: errors }; });
    }
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start); else start();
  };

  function setAccent(el, value, value2) {
    var hex = ACCENTS[value] || value;
    if (!hex) return;
    var c = parseColor(hex), black = { r: 11, g: 11, b: 13 }, white = { r: 255, g: 255, b: 255 };
    el.style.setProperty('--accent', hex);
    el.style.setProperty('--on-accent', contrast(c, white) >= 3 ? '#FFFFFF' : '#0B0B0D');
    var hsl = rgbToHsl(c);
    el.style.setProperty('--accent-2', value2 ? (ACCENTS[value2] || value2) : 'hsl(' + ((hsl.h + 42) % 360).toFixed(0) + ' ' + Math.min(100, hsl.s + 4).toFixed(0) + '% ' + clamp(hsl.l + 4, 30, 72).toFixed(0) + '%)');
  }
  Motion.setAccent = setAccent;

  function setupStage(stage) {
    var W = +stage.dataset.width || 1080, H = +stage.dataset.height || 1920;
    var cfg = { W: W, H: H, fps: +stage.dataset.fps || 30, D: +stage.dataset.duration || 8, title: stage.dataset.title || doc.title || 'motion' };
    stage.style.setProperty('--W', W + 'px'); stage.style.setProperty('--H', H + 'px');
    stage.style.setProperty('--u', (Math.min(W, H) / 100) + 'px');
    if (!stage.dataset.theme) stage.dataset.theme = 'ink';
    setAccent(stage, stage.dataset.accent || 'blue', stage.dataset.accent2);
    toArray('[data-accent]', stage).forEach(function (el) { setAccent(el, el.dataset.accent, el.dataset.accent2); });
    doc.documentElement.style.background = RENDER ? getComputedStyle(stage).backgroundColor : '';
    hydrateIcons(stage);
    buildDevices(stage);
    toArray('.mo-brackets', stage).forEach(function (b) { if (!b.children.length) b.innerHTML = '<i></i><i></i><i></i><i></i>'; });
    toArray('.mo-check', stage).forEach(function (c) { if (!c.querySelector('svg')) c.innerHTML = '<svg viewBox="0 0 24 24"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>'; });
    toArray('.mo-dots', stage).forEach(function (d) { if (!d.children.length) d.innerHTML = '<i></i><i></i><i></i>'; });
    toArray('.mo-window-bar', stage).forEach(function (b) { if (!b.querySelector('i')) b.insertAdjacentHTML('afterbegin', '<i></i><i></i><i></i>'); });
    return cfg;
  }

  // ───────────────────────── icons ─────────────────────────
  function iconSvg(name, sw) {
    var body = (global.MotionIcons || {})[name];
    if (!body) { console.warn('[motion] unknown icon: ' + name); body = '<circle cx="12" cy="12" r="9"/>'; }
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (sw || 1.75) + '" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
  }
  function hydrateIcons(root) {
    toArray('[data-icon]', root).forEach(function (el) { if (el._moIcon === el.dataset.icon) return; el._moIcon = el.dataset.icon; el.classList.add('mo-icon'); el.innerHTML = iconSvg(el.dataset.icon, el.dataset.stroke); });
  }
  Motion.icon = iconSvg;

  // ───────────────────────── devices (CSS 3D with real thickness) ─────────────────────────
  function buildDevices(root) {
    // perspective only reaches a device if every ancestor up to the stage keeps the 3D context alive
    toArray('.mo-phone, .mo-laptop, [data-3d]', root).forEach(function (d) {
      var n = d.hasAttribute('data-3d') ? d : d.parentElement;
      while (n && n !== root) { if (getComputedStyle(n).overflow === 'visible') n.style.transformStyle = 'preserve-3d'; n = n.parentElement; }
    });
    toArray('.mo-phone', root).forEach(function (p) {
      if (p._moBuilt) return; p._moBuilt = true;
      var screen = p.querySelector('.mo-screen') || h('div', 'mo-screen');
      var depth = +(p.dataset.depth || 0) || Math.round(p.offsetWidth * 0.042) || 16;
      var face = h('div', 'mo-phone-face');
      face.appendChild(screen);
      if (p.dataset.island !== 'off') h('div', 'mo-island', screen);
      h('div', 'mo-glare', face);
      var slices = clamp(Math.round(depth / 1.5), 6, 28);     // enough to read as solid metal, few enough to stay light
      for (var i = 1; i < slices; i++) { var e = h('div', 'mo-phone-edge', p); e.style.transform = 'translateZ(' + (-(depth * i) / slices).toFixed(2) + 'px)'; }
      var back = h('div', 'mo-phone-back', p); back.style.transform = 'translateZ(' + (-depth) + 'px) rotateY(180deg)';
      p.appendChild(face);
      p._depth = depth;
    });
    toArray('.mo-laptop', root).forEach(function (l) {
      if (l._moBuilt) return; l._moBuilt = true;
      var screen = l.querySelector('.mo-screen') || h('div', 'mo-screen');
      var lid = h('div', 'mo-laptop-lid'), face = h('div', 'mo-laptop-lid-face', lid);
      h('div', 'mo-laptop-lid-back', lid);
      face.appendChild(screen); h('div', 'mo-notch', screen);
      var base = h('div', 'mo-laptop-base');
      var thick = Math.max(6, Math.round(l.offsetWidth * 0.012));
      for (var i = thick; i >= 1; i -= 1.5) { var s = h('div', 'mo-laptop-slab', base); s.style.transform = 'translateZ(' + (-i).toFixed(1) + 'px)'; }
      var deck = h('div', 'mo-laptop-deck', base); h('div', 'mo-laptop-keys', deck); h('div', 'mo-laptop-pad', deck);
      l.appendChild(base); l.appendChild(lid);
    });
  }

  // ───────────────────────── context ─────────────────────────
  function createContext(stage, cfg) {
    var W = cfg.W, H = cfg.H, D = cfg.D, fps = cfg.fps, U = Math.min(W, H) / 100;
    var tl = gsap.timeline({ paused: true, defaults: { duration: 0.8, ease: 'mo.out' } });
    var appliers = [mirrorHighlights];
    var pending = [];
    var M = {
      stage: stage, tl: tl, W: W, H: H, D: D, fps: fps, u: U, t: 0, render: RENDER,
      clamp: clamp, lerp: lerp, map: mapRange, smooth: smooth, noise: noise, rng: rng, TAU: TAU,
      split: split, typeFrames: typeFrames, icon: iconSvg,
      $: function (s, root) { return one(s, root || stage); },
      $$: function (s, root) { return toArray(s, root || stage); },
      el: function (html, parent) { var t = doc.createElement('template'); t.innerHTML = html.trim(); var n = t.content.firstElementChild; (one(parent, stage) || stage).appendChild(n); hydrateIcons(n.parentNode); return n; },
      /** Run fn(t, frameIndex) on every frame — the only place procedural (non-tween) motion may live. */
      onFrame: function (fn) { appliers.push(fn); return fn; },
      _appliers: appliers, _pending: pending
    };
    /** vars: URL parameters (motion render --vars "title=...&n=3") — lets one composition serve as a template. */
    M.vars = {}; QS.forEach(function (v, k) { if (k !== 'render' && k !== 't' && k !== 'autoplay') M.vars[k] = v; });
    M.var = function (name, fallback) { return M.vars[name] == null || M.vars[name] === '' ? fallback : (typeof fallback === 'number' ? +M.vars[name] : M.vars[name]); };
    function pos(at) { return at == null ? '>' : at; }
    function px(v) { return typeof v === 'number' ? v : parseFloat(v) || 0; }
    /** Resolve a position parameter to absolute seconds (numbers, labels; otherwise current end). */
    M.time = function (at) { if (typeof at === 'number') return at; if (typeof at === 'string' && tl.labels[at] != null) return tl.labels[at]; return tl.duration(); };

    /** beats(120) → b(n) = seconds of beat n, snapped to the frame grid. b.len = one beat. */
    /** Times that decide what is on screen (cuts, scene windows, beats) are snapped to whole frames: a cut never lands inside a frame. */
    function snap(t) { return isFinite(t) ? Math.round(t * fps + 1e-6) / fps : t; }
    M.snap = snap;
    M.ease = function (name) { return gsap.parseEase(name); };
    M.beats = function (bpm, offset, opts) {
      if (offset && typeof offset === 'object') { opts = offset; offset = 0; }
      var len = 60 / bpm, snapped = !(opts && opts.snap === false);
      var b = function (n) { var t = (offset || 0) + n * len; return snapped ? snap(t) : t; };
      b.len = len; b.bpm = bpm; return b;
    };

    // ── layout rect in stage pixels (transforms ignored: where the element RESTS) ──
    M.rect = function (target, opts) {
      var el = one(target, stage); if (!el) return { x: 0, y: 0, w: 0, h: 0, cx: 0, cy: 0 };
      var x = 0, y = 0, w, hh;
      if ((opts && opts.live) || el.offsetWidth === undefined || el instanceof SVGElement) {
        var s = stageScale(), r = el.getBoundingClientRect(), sr = stage.getBoundingClientRect();
        x = (r.left - sr.left) / s; y = (r.top - sr.top) / s; w = r.width / s; hh = r.height / s;
      } else {
        var n = el; while (n && n !== stage) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        w = el.offsetWidth; hh = el.offsetHeight;
      }
      return { x: x, y: y, w: w, h: hh, cx: x + w / 2, cy: y + hh / 2 };
    };
    function stageScale() { return stage.getBoundingClientRect().width / W || 1; }
    /** A resting stage-space point in the coordinate space of `parent` (cursor and taps that live inside a device screen). */
    function local(parent, p) {
      if (parent === stage) return p;
      var pr = M.rect(parent);
      return { x: p.x - pr.x - parent.clientLeft, y: p.y - pr.y - parent.clientTop };
    }
    /** Vars that make `el` occupy `slot`'s box (shared-element / match-cut moves). */
    M.fit = function (target, slot, extra) {
      var a = M.rect(target), b = M.rect(slot), out = { x: b.cx - a.cx, y: b.cy - a.cy, scaleX: b.w / a.w, scaleY: b.h / a.h };
      if (extra) for (var k in extra) out[k] = extra[k];
      return out;
    };

    // ── scenes: visibility is a pure function of time ──
    var scenes = [];
    function sceneRec(el) { for (var i = 0; i < scenes.length; i++) if (scenes[i].el === el) return scenes[i]; var r = { el: el, w: [[0, Infinity]] }; scenes.push(r); return r; }
    function sceneEnd(r, t) { r.w[r.w.length - 1][1] = snap(t); }
    function sceneStart(r, t) { var w = r.w[r.w.length - 1]; w[0] = snap(t); if (w[1] <= w[0]) w[1] = Infinity; }
    /**
     * scene(target, start, end) — the element is on screen only inside [start, end).
     * scene(target, [[0, 2], [5, 8]]) — several windows. A child still disappears with its parent scene.
     */
    M.scene = function (target, start, end) {
      var wins = Array.isArray(start) ? start.map(function (w) { return [snap(w[0] || 0), w[1] == null ? Infinity : snap(w[1])]; }) : [[snap(start || 0), end == null ? Infinity : snap(end)]];
      toArray(target, stage).forEach(function (el) { sceneRec(el).w = wins.map(function (w) { return w.slice(); }); });
      return M;
    };
    appliers.push(function (t) {
      for (var i = 0; i < scenes.length; i++) {
        var w = scenes[i].w, on = false;
        for (var k = 0; k < w.length; k++) { if (t >= w[k][0] - 1e-6 && (t < w[k][1] - 1e-6 || w[k][1] >= D)) { on = true; break; } }
        scenes[i].el.style.visibility = on ? 'inherit' : 'hidden';
      }
    });

    /**
     * transition(type, from, to, { at, duration, ... }) — moves between two full-stage scenes and manages their visibility.
     * types: cut · push(dir) · wipe(color, angle) · iris(x, y) · zoom · flip(axis) · whip(dir) · fade
     * Returns the time the incoming scene has fully landed.
     */
    M.transition = function (type, from, to, o) {
      o = o || {};
      var a = one(from, stage), b = one(to, stage), at = snap(M.time(o.at)), sub = gsap.timeline();
      var d = o.duration == null ? ({ cut: 0, push: 0.85, wipe: 0.9, iris: 0.9, zoom: 0.9, flip: 0.9, whip: 0.5, fade: 0.6 }[type] || 0.8) : o.duration;
      var dir = o.dir || 'left', sx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0, sy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
      var mid = at + d / 2, ra = a ? sceneRec(a) : null, rb = b ? sceneRec(b) : null;
      if (b) { b.style.zIndex = String((+(a && a.style.zIndex) || 1) + 1); }
      function win(aEnd, bStart) { if (ra) sceneEnd(ra, aEnd); if (rb) sceneStart(rb, bStart); }
      switch (type) {
        case 'cut': win(at, at); break;
        case 'push':
          win(at + d, at);
          if (a) sub.to(a, { xPercent: sx * 34, yPercent: sy * 34, scale: 0.94, autoAlpha: 0.0, duration: d, ease: o.ease || 'mo.inOut' }, 0);
          if (b) sub.fromTo(b, { xPercent: -sx * 100, yPercent: -sy * 100 }, { xPercent: 0, yPercent: 0, duration: d, ease: o.ease || 'mo.inOut' }, 0);
          break;
        case 'wipe': {
          win(mid, mid);
          var band = h('div', '', stage), ang = o.angle == null ? -14 : o.angle;
          band.setAttribute('data-mo-ignore', '');
          band.style.cssText = 'position:absolute;left:-40%;top:-25%;width:180%;height:150%;z-index:40;background:' + (!o.color || o.color === 'accent' ? 'var(--accent)' : (ACCENTS[o.color] || o.color)) + ';transform-origin:50% 50%;';
          sceneRec(band).w = [[at, snap(at + d)]];
          sub.fromTo(band, { xPercent: -112, skewX: ang }, { xPercent: 112, skewX: ang, duration: d, ease: o.ease || 'mo.inOut' }, 0);
          if (a) sub.to(a, { xPercent: 6, duration: d / 2, ease: 'power2.in' }, 0);
          if (b) sub.fromTo(b, { xPercent: -6 }, { xPercent: 0, duration: d / 2, ease: 'mo.out' }, d / 2);
          break;
        }
        case 'iris': {
          win(at + d, at);
          var cx = o.x == null ? '50%' : (typeof o.x === 'number' ? o.x + 'px' : o.x), cy = o.y == null ? '50%' : (typeof o.y === 'number' ? o.y + 'px' : o.y);
          if (b) sub.fromTo(b, { clipPath: 'circle(0% at ' + cx + ' ' + cy + ')' }, { clipPath: 'circle(150% at ' + cx + ' ' + cy + ')', duration: d, ease: o.ease || 'mo.inOut' }, 0);
          if (a) sub.to(a, { scale: 1.06, duration: d, ease: 'power1.in' }, 0);
          break;
        }
        case 'zoom':
          win(at + d * 0.62, at + d * 0.3);
          if (a) sub.to(a, { scale: o.scale || 3.4, autoAlpha: 0, transformOrigin: o.origin || '50% 50%', duration: d * 0.62, ease: 'power3.in' }, 0);
          if (b) sub.fromTo(b, { scale: 0.56, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: d * 0.7, ease: 'mo.out' }, d * 0.3);
          break;
        case 'flip': {
          win(mid, mid);
          var ax = o.axis === 'x' ? 'rotationX' : 'rotationY', v1 = {}, v2a = {}, v2b = {};
          v1[ax] = -90; v1.duration = d / 2; v1.ease = 'power2.in'; v1.transformPerspective = 1600;
          v2a[ax] = 90; v2a.transformPerspective = 1600; v2b[ax] = 0; v2b.duration = d / 2; v2b.ease = 'mo.out'; v2b.transformPerspective = 1600;
          if (a) sub.to(a, v1, 0);
          if (b) sub.fromTo(b, v2a, v2b, d / 2);
          break;
        }
        case 'whip': {
          var wx = sx || (sy ? 0 : -1);
          win(at + d * 0.56, at + d * 0.4);
          if (a) sub.to(a, { xPercent: wx * 100, yPercent: sy * 100, skewX: -wx * 7, duration: d * 0.56, ease: 'power3.in' }, 0);
          if (b) sub.fromTo(b, { xPercent: -wx * 100, yPercent: -sy * 100, skewX: -wx * 7 }, { xPercent: 0, yPercent: 0, skewX: 0, duration: d * 0.6, ease: 'mo.out' }, d * 0.4);
          break;
        }
        default:
          win(at + d, at);
          if (b) sub.fromTo(b, { autoAlpha: 0 }, { autoAlpha: 1, duration: d, ease: 'power1.inOut' }, 0);
      }
      if (sub.duration() > 0) tl.add(sub, at);
      return at + d;
    };
    /** morph(el, slot, { duration, ease, radius }, at) — the same object travels into another layout box (shared-element / match move). */
    M.morph = function (target, slot, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      var v = M.fit(target, slot); v.duration = o.duration || 0.9; v.ease = o.ease || 'mo.inOut'; v.transformOrigin = '50% 50%';
      if (o.radius != null) v.borderRadius = o.radius;
      return tw_to(one(target, stage), v, at);
    };

    // ── reveals ──
    function tlAt(child, at) { tl.add(child, pos(at)); return child; }
    // NOTE: timeline.to() returns the timeline; these return the tween, so .startTime()/.endTime() are the tween's own.
    function tw_to(target, vars, at) { return tlAt(gsap.to(target, vars), at); }
    function tw_from(target, vars, at) { return tlAt(gsap.from(target, vars), at); }
    function tw_fromTo(target, a, b, at) { return tlAt(gsap.fromTo(target, a, b), at); }
    function pre(o, v) { return v * (1 - clamp(o.pre || 0, 0, 0.95)); }      // pre: 0.4 → the move starts 40% done (a hook already in motion on frame 0)
    var REVEALS = {
      rise: function (els, o) { var s = split(els, { by: 'lines', tight: o.tight }); return gsap.from(s.lines, { yPercent: pre(o, 118), duration: o.duration || 1.05, ease: o.ease || 'mo.out', stagger: o.stagger == null ? 0.1 : o.stagger }); },
      words: function (els, o) { var s = split(els, { by: 'words', tight: o.tight }); return gsap.from(s.words, { yPercent: pre(o, 118), duration: o.duration || 0.85, ease: o.ease || 'mo.out', stagger: o.stagger == null ? 0.055 : o.stagger }); },
      chars: function (els, o) { var s = split(els, { by: 'chars', tight: o.tight }); return gsap.from(s.chars, { yPercent: pre(o, 122), duration: o.duration || 0.75, ease: o.ease || 'mo.out', stagger: o.stagger == null ? 0.024 : o.stagger }); },
      fade: function (els, o) { return gsap.from(els, { autoAlpha: o.pre || 0, y: pre(o, o.y == null ? U * 2.6 : o.y), duration: o.duration || 0.8, ease: o.ease || 'mo.out', stagger: o.stagger == null ? 0.07 : o.stagger }); },
      blur: function (els, o) { return gsap.from(els, { autoAlpha: 0, filter: 'blur(' + (o.blur || U * 1.6) + 'px)', scale: o.scale || 1.04, duration: o.duration || 1.0, ease: o.ease || 'mo.soft', stagger: o.stagger == null ? 0.08 : o.stagger }); },
      pop: function (els, o) { return gsap.from(els, { autoAlpha: 0, scale: o.scale || 0.72, duration: o.duration || 0.6, ease: o.ease || 'mo.pop', stagger: o.stagger == null ? 0.06 : o.stagger }); },
      slam: function (els, o) { gsap.set(els, { autoAlpha: 0 }); var t = gsap.timeline(); t.set(els, { autoAlpha: 1 }, 0).fromTo(els, { scale: o.scale || 1.5 }, { scale: 1, duration: o.duration || 0.42, ease: o.ease || 'mo.snap', stagger: o.stagger || 0, immediateRender: false }, 0); return t; },
      wipe: function (els, o) { var d = o.dir || 'right', f = d === 'right' ? 'inset(-10% 100% -10% -2%)' : d === 'left' ? 'inset(-10% -2% -10% 100%)' : d === 'up' ? 'inset(100% -2% -10% -2%)' : 'inset(-10% -2% 100% -2%)'; return gsap.fromTo(els, { clipPath: f }, { clipPath: 'inset(-10% -2% -10% -2%)', duration: o.duration || 0.8, ease: o.ease || 'mo.inOut', stagger: o.stagger || 0.06 }); },
      grow: function (els, o) { return gsap.from(els, { scaleX: o.axis === 'y' ? 1 : 0, scaleY: o.axis === 'y' ? 0 : 1, transformOrigin: o.origin || (o.axis === 'y' ? '50% 100%' : '0% 50%'), duration: o.duration || 0.9, ease: o.ease || 'mo.out', stagger: o.stagger == null ? 0.06 : o.stagger }); },
      drop: function (els, o) { return gsap.from(els, { autoAlpha: 0, y: -(o.y || U * 6), duration: o.duration || 0.7, ease: o.ease || 'mo.spring', stagger: o.stagger == null ? 0.07 : o.stagger }); },
      lift: function (els, o) { return gsap.from(els, { autoAlpha: o.pre || 0, y: pre(o, o.y || U * 7), rotationX: o.tilt == null ? -18 : o.tilt, transformPerspective: 1400, transformOrigin: '50% 100%', duration: o.duration || 1.0, ease: o.ease || 'mo.out', stagger: o.stagger == null ? 0.08 : o.stagger }); },
      draw: function (els, o) { var shapes = []; toArray(els, stage).forEach(function (e) { if (e.tagName.toLowerCase() === 'svg') shapes = shapes.concat(toArray('path,line,circle,rect,polyline,ellipse', e)); else shapes.push(e); }); shapes.forEach(function (sh) { sh.setAttribute('pathLength', '1'); sh.style.strokeDasharray = '1'; }); return gsap.fromTo(shapes, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: o.duration || 1.1, ease: o.ease || 'mo.inOut', stagger: o.stagger == null ? 0.08 : o.stagger }); }
    };
    /**
     * reveal(target, { type, duration, stagger, ease, pre, tight }, at)
     * types: rise (lines from a mask) · words · chars · fade · blur · pop · slam · wipe · grow · drop · lift · draw
     */
    M.reveal = function (target, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      var els = toArray(target, stage); if (!els.length) { console.warn('[motion] reveal: nothing matches', target); return gsap.timeline(); }
      var type = o.type || 'fade', make = REVEALS[type]; if (!make) { fail('reveal: unknown type "' + type + '"'); make = REVEALS.fade; }
      return tlAt(make(els, o), at);
    };
    var EXITS = {
      rise: function (els, o) { var s = split(els, { by: 'lines' }); return gsap.to(s.lines, { yPercent: -118, duration: o.duration || 0.55, ease: o.ease || 'mo.in', stagger: o.stagger == null ? 0.05 : o.stagger }); },
      words: function (els, o) { var s = split(els, { by: 'words' }); return gsap.to(s.words, { yPercent: -118, duration: o.duration || 0.5, ease: o.ease || 'mo.in', stagger: o.stagger == null ? 0.03 : o.stagger }); },
      chars: function (els, o) { var s = split(els, { by: 'chars' }); return gsap.to(s.chars, { yPercent: -122, duration: o.duration || 0.45, ease: o.ease || 'mo.in', stagger: o.stagger == null ? 0.014 : o.stagger }); },
      fade: function (els, o) { return gsap.to(els, { autoAlpha: 0, y: o.y == null ? -U * 2 : o.y, duration: o.duration || 0.4, ease: o.ease || 'mo.in', stagger: o.stagger == null ? 0.04 : o.stagger }); },
      blur: function (els, o) { return gsap.to(els, { autoAlpha: 0, filter: 'blur(' + (o.blur || U * 1.6) + 'px)', scale: o.scale || 0.98, duration: o.duration || 0.5, ease: o.ease || 'mo.in', stagger: o.stagger || 0.04 }); },
      pop: function (els, o) { return gsap.to(els, { autoAlpha: 0, scale: o.scale || 0.8, duration: o.duration || 0.3, ease: o.ease || 'mo.in', stagger: o.stagger || 0.03 }); },
      wipe: function (els, o) { return gsap.to(els, { clipPath: (o.dir || 'right') === 'right' ? 'inset(-10% -2% -10% 100%)' : 'inset(-10% 100% -10% -2%)', duration: o.duration || 0.55, ease: o.ease || 'mo.inOut', stagger: o.stagger || 0.04 }); },
      drop: function (els, o) { return gsap.to(els, { autoAlpha: 0, y: o.y || U * 5, duration: o.duration || 0.4, ease: o.ease || 'mo.in', stagger: o.stagger || 0.04 }); }
    };
    /** exit(target, { type }, at) — exits are shorter than entrances and accelerate away. */
    M.exit = function (target, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      var els = toArray(target, stage); if (!els.length) return gsap.timeline();
      return tlAt((EXITS[o.type || 'fade'] || EXITS.fade)(els, o), at);
    };

    // ── proxy-driven text mechanics (seek-safe: text is derived from a tweened number every frame) ──
    /** type(target, text, { cps, duration, jitter, caret, hold }, at) — Korean IME-accurate typing. */
    M.type = function (target, text, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      var el = one(target, stage); if (!el) return null;
      var frames = typeFrames(text), n = frames.length - 1, rand = rng(hashStr(text) + 7);
      var total = o.duration || Array.from(text).length / (o.cps || 9), jit = o.jitter == null ? 0.45 : o.jitter;
      var w = [0], sum = 0, i;
      for (i = 1; i <= n; i++) { var wt = 1 + (rand() * 2 - 1) * jit; if (/\s$/.test(frames[i - 1]) && frames[i].length > frames[i - 1].length) wt += 0.9; sum += wt; w.push(sum); }
      for (i = 0; i <= n; i++) w[i] = w[i] / (sum || 1);
      el.textContent = '';
      var typed = h('span', 'mo-typed', el), caret = o.caret === false ? null : h('span', 'mo-caret', el);
      var st = { p: 0 }, tw = tw_to(st, { p: 1, duration: total, ease: 'none' }, at);
      var hold = o.hold == null ? 1.2 : o.hold;
      appliers.push(function (t) {
        var lo = 0, hi = n; while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (w[mid] <= st.p + 1e-9) lo = mid; else hi = mid - 1; }
        var s = frames[lo]; if (typed._s !== s) { typed.textContent = s; typed._s = s; }
        if (caret) {
          var t0 = tw.startTime(), t1 = t0 + total, on;
          if (t < t0 - 0.6 && o.caretBefore === false) on = false;
          else if (t >= t0 && t <= t1 + 0.35) on = true;
          else if (hold >= 0 && t > t1 + hold && o.caretAfter !== true) on = false;
          else on = ((t * 1.9) % 1) < 0.55;
          caret.style.opacity = on ? 1 : 0;
        }
      });
      tw.typed = typed; tw.caret = caret;
      return tw;
    };
    function fmt(v, dec, sep) { var s = v.toFixed(dec); if (!sep) return s; var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return p.join('.'); }
    /**
     * count(target, { from, to, decimals, sep, prefix, suffix, pad, round, duration, ease, align, settle, pulse }, at)
     * Tabular count-up/down in a box that never jitters; when the digit count changes the box eases to the new
     * width (settle) so a centered number stays centered. The returned tween has .land — the time the final
     * digits first appear (digits stop before the eased tween ends); pulse: true punches the number at that moment.
     */
    M.count = function (target, o, at) {
      var el = one(target, stage); if (!el) return null;
      var dec = o.decimals || 0, sep = o.sep !== false, pfx = o.prefix || '', suf = o.suffix || '', from = o.from || 0, dur = o.duration || 1.6, pad = o.pad || 0, mode = o.round || 'round';
      function show(v) {
        var k = Math.pow(10, dec), q = mode === 'floor' ? Math.floor(v * k + 1e-9) / k : mode === 'ceil' ? Math.ceil(v * k - 1e-9) / k : Math.round(v * k) / k, str = fmt(q, dec, sep);
        if (pad) { var parts = str.split('.'); while (parts[0].replace(/\D/g, '').length < pad) parts[0] = '0' + parts[0]; str = parts.join('.'); }
        return pfx + str + suf;
      }
      function width(v) { el.textContent = show(v); return Math.ceil(el.getBoundingClientRect().width / stageScale()) + 1; }
      el.classList.add('mo-count'); el.style.display = 'inline-block'; el.style.textAlign = o.align || 'right'; el.style.whiteSpace = 'nowrap'; el.style.minWidth = '0';
      var wFrom = width(from), wTo = width(o.to), st = { v: from, w: Math.max(wFrom, wTo) }, easeFn = gsap.parseEase(o.ease || 'power3.out');
      var tw = tw_to(st, { v: o.to, duration: dur, ease: easeFn }, at);
      if (o.settle !== false && wFrom !== wTo) {
        var t0 = tw.startTime();
        if (wTo < wFrom) tw_fromTo(st, { w: wFrom }, { w: wTo, duration: dur * 0.42, ease: 'mo.inOut', immediateRender: false }, t0 + dur * 0.58);
        else tw_fromTo(st, { w: wFrom }, { w: wTo, duration: dur * 0.45, ease: 'power2.out' }, t0);
        st.w = wFrom;
      }
      appliers.push(function () { var s = show(st.v); if (el._s !== s) { el.textContent = s; el._s = s; } el.style.minWidth = st.w.toFixed(1) + 'px'; });
      var fin = show(o.to), land = 1;
      for (var i = 0; i <= 600; i++) { if (show(from + (o.to - from) * easeFn(i / 600)) === fin) { land = i / 600; break; } }
      tw.land = snap(tw.startTime() + land * dur);
      tw.widths = { from: wFrom, to: wTo };
      if (o.pulse) { var po = typeof o.pulse === 'object' ? o.pulse : {}; M.pulse(typeof o.pulse === 'string' ? o.pulse : (po.target || el), po, tw.land); }
      return tw;
    };
    /** odometer(target, '1,284', { duration, stagger, spins }, at) — each digit rolls in its own masked column. */
    M.odometer = function (target, value, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      var el = one(target, stage); if (!el) return gsap.timeline();
      el.classList.add('mo-odo'); el.textContent = '';
      var strips = [], chars = String(value).split(''), spins = o.spins == null ? 1 : o.spins, sub = gsap.timeline();
      chars.forEach(function (ch) {
        if (!/\d/.test(ch)) { var s = h('span', 'mo-odo-sep', el); s.textContent = ch; strips.push({ sep: s }); return; }
        var col = h('span', 'mo-odo-col', el), strip = h('span', 'mo-odo-strip', col), seq = [], k;
        for (k = 0; k < spins; k++) for (var d = 0; d < 10; d++) seq.push(d);
        for (k = 0; k <= +ch; k++) seq.push(k);
        if (o.from === 'top') seq.reverse();
        seq.forEach(function (d) { var sp = h('span', '', strip); sp.textContent = d; });
        strips.push({ strip: strip, n: seq.length });
      });
      var idx = 0, total = strips.filter(function (s) { return s.strip; }).length;
      strips.forEach(function (s) {
        if (s.sep) { sub.from(s.sep, { autoAlpha: 0, duration: 0.4 }, 0.1); return; }
        var order = o.fromRight === false ? idx : (total - 1 - idx);
        sub.fromTo(s.strip, { yPercent: 0 }, { yPercent: -100 * (s.n - 1) / s.n, duration: (o.duration || 1.6), ease: o.ease || 'mo.out' }, order * (o.stagger == null ? 0.09 : o.stagger));
        idx++;
      });
      return tlAt(sub, at);
    };
    /** highlight(target, { duration, ease }, at) — marker bar wipes in; glyphs flip to on-accent in the same stroke. */
    M.highlight = function (target, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      var els = toArray(target, stage);
      els.forEach(function (el) {
        if (el._moHl) return; el._moHl = true; el.classList.add('mo-hl');
        var base = h('span', 'mo-hl-base'); while (el.firstChild) base.appendChild(el.firstChild);
        el.appendChild(h('span', 'mo-hl-bar')); el.appendChild(base);
        if (o.color) setAccent(el, o.color);
        syncHighlight(el);
      });
      return tw_fromTo(els, { '--p': 0 }, { '--p': 1, duration: o.duration || 0.6, ease: o.ease || 'mo.inOut', stagger: o.stagger || 0.12 }, at);
    };
    /** stream(target, { wps }, at) — answer text arrives in word chunks like a model streaming tokens. */
    M.stream = function (target, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      var s = split(target, { by: 'words', mask: false });
      return tw_from(s.words, { autoAlpha: 0, y: U * 0.6, duration: 0.28, ease: 'mo.soft', stagger: 1 / (o.wps || 16) }, at);
    };
    /** scramble(target, { duration, chars }, at) — characters decode left to right (use on mono labels only). */
    M.scramble = function (target, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      var els = toArray(target, stage), set = o.chars || SCRAMBLE, st = { p: 0 };
      var data = els.map(function (el) { var txt = el.textContent; el.style.whiteSpace = 'pre'; return { el: el, g: graphemes(txt), seed: hashStr(txt) }; });
      var tw = tw_fromTo(st, { p: 0 }, { p: 1, duration: o.duration || 0.9, ease: 'none' }, at);
      appliers.push(function (t, f) {
        data.forEach(function (d) {
          var n = d.g.length, out = '', edge = st.p * (n + 4) - 2;
          for (var i = 0; i < n; i++) { var ch = d.g[i]; if (ch === ' ' || i < edge - 2) out += ch; else if (st.p <= 0) out += ' '; else if (i > edge + 2) out += ' '; else out += set[Math.floor(hash2(i * 131 + Math.floor(f / 2), d.seed) * set.length)]; }
          if (d.el._s !== out) { d.el.textContent = st.p >= 1 ? d.g.join('') : out; d.el._s = out; }
        });
      });
      return tw;
    };
    /**
     * text(target, [[0, 'RUNNING'], [8.2, 'DONE']], { scramble: 0.4 }) — the element shows the latest entry at or
     * before the current time (state labels, chapter counters). Before the first entry the authored text stays.
     */
    M.text = function (target, states, o) {
      o = o || {};
      var list = states.map(function (e) { return [snap(e[0]), String(e[1])]; }).sort(function (a, b) { return a[0] - b[0]; });
      var dur = o.scramble === true ? 0.4 : (o.scramble || 0), set = o.chars || SCRAMBLE;
      toArray(target, stage).forEach(function (el) {
        var orig = el.textContent, seed = hashStr(orig + list.length);
        appliers.push(function (t, f) {
          var cur = null; for (var i = 0; i < list.length; i++) if (t >= list[i][0] - 1e-6) cur = list[i];
          var s = cur ? cur[1] : orig;
          if (cur && dur > 0 && t < cur[0] + dur) { var g = graphemes(s), edge = ((t - cur[0]) / dur) * (g.length + 2), out = ''; for (var k = 0; k < g.length; k++) out += (g[k] === ' ' || k < edge - 1) ? g[k] : set[Math.floor(hash2(k * 131 + Math.floor(f / 2), seed) * set.length)]; s = out; }
          if (el._s !== s) { el.textContent = s; el._s = s; }
        });
      });
      return M;
    };
    /** Helpers taking (target, options, at) also accept the older (target, at, options). */
    function flex(a, b) { return (a !== null && typeof a === 'object') ? { o: a, at: b } : { o: b || {}, at: a }; }
    /** press(target, { scale }, at) — tactile button press. */
    M.press = function (target, a, b) {
      var f = flex(a, b), o = f.o, sub = gsap.timeline();
      sub.to(target, { scale: o.scale || 0.94, duration: 0.09, ease: 'power2.out' }).to(target, { scale: 1, duration: 0.45, ease: 'mo.spring' });
      return tlAt(sub, f.at);
    };
    /** pulse(target, { scale, duration }, at) — one beat of emphasis (scale punch), for counters and beat hits. */
    M.pulse = function (target, a, b) {
      var f = flex(a, b), o = f.o, sub = gsap.timeline();
      sub.fromTo(target, { scale: 1 }, { scale: o.scale || 1.08, duration: 0.1, ease: 'power2.out', immediateRender: false }).to(target, { scale: 1, duration: o.duration || 0.5, ease: 'mo.out' });
      return tlAt(sub, f.at);
    };
    /** set a CSS variable progress (0→1) on components that expose --p (progress, check, toggle, underline). */
    M.fill = function (target, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      return tw_fromTo(target, { '--p': o.from || 0 }, { '--p': o.to == null ? 1 : o.to, duration: o.duration || 0.9, ease: o.ease || 'mo.out', stagger: o.stagger || 0, immediateRender: !o.from }, at);
    };
    /** float(target, { x, y, rot, period, phase }) — endless idle drift (procedural, never fights tweens). */
    M.float = function (target, o) {
      o = o || {};
      toArray(target, stage).forEach(function (el, i) {
        var ph = (o.phase == null ? hash2(i + 1, hashStr(el.className + i)) : o.phase + i * (o.each || 0.17)) * TAU, per = o.period || 5;
        var ax = o.x || 0, ay = o.y == null ? U * 0.9 : o.y, ar = o.rot || 0;
        appliers.push(function (t) {
          var a = (t / per) * TAU + ph;
          el.style.translate = (Math.sin(a * 0.83 + 1.3) * ax).toFixed(2) + 'px ' + (Math.sin(a) * ay).toFixed(2) + 'px';
          if (ar) el.style.rotate = (Math.sin(a * 0.71 + 0.6) * ar).toFixed(3) + 'deg';
        });
      });
      return M;
    };
    /** spin(target, { period }) — steady rotation (spinners, orbit rings). */
    M.spin = function (target, o) {
      o = o || {};
      toArray(target, stage).forEach(function (el) { appliers.push(function (t) { el.style.rotate = (((t / (o.period || 0.9)) * 360 * (o.dir || 1)) % 360).toFixed(2) + 'deg'; }); });
      return M;
    };
    /** typing-dots bounce for .mo-dots */
    M.dots = function (target) {
      toArray(target, stage).forEach(function (el) {
        var ds = toArray(el.children);
        appliers.push(function (t) { ds.forEach(function (d, i) { var p = ((t * 1.5 - i * 0.16) % 1 + 1) % 1, y = p < 0.4 ? Math.sin((p / 0.4) * Math.PI) : 0; d.style.translate = '0 ' + (-y * 0.42).toFixed(3) + 'em'; d.style.opacity = (0.45 + y * 0.55).toFixed(3); }); });
      });
      return M;
    };
    /** marquee(target, { speed, dir }) — endless ticker; content is duplicated to fill. speed in px/s. */
    M.marquee = function (target, o) {
      o = o || {};
      toArray(target, stage).forEach(function (el, i) {
        el.style.whiteSpace = 'nowrap'; el.style.display = 'flex'; el.style.width = 'max-content';
        var unit = h('span', ''); while (el.firstChild) unit.appendChild(el.firstChild);
        unit.style.flex = 'none'; unit.style.paddingRight = (o.gap == null ? '0.5em' : o.gap);
        el.appendChild(unit);
        var w = unit.getBoundingClientRect().width / stageScale() || 1, need = Math.ceil((Math.max(W, H) * 2.4) / w) + 1;
        for (var k = 0; k < need; k++) { var c = unit.cloneNode(true); c.setAttribute('data-mo-ignore', ''); c.setAttribute('aria-hidden', 'true'); el.appendChild(c); }
        var dir = (o.dir || 1) * (o.alternate && i % 2 ? -1 : 1), sp = o.speed || U * 9;
        appliers.push(function (t) { var x = ((t * sp) % w); el.style.translate = (dir > 0 ? -x : x - w).toFixed(2) + 'px 0'; });
      });
      return M;
    };

    // ── camera ──
    var world = null;
    function ensureWorld() {
      if (world) return world;
      world = one('.mo-world', stage);
      if (!world) {
        world = doc.createElement('div'); world.className = 'mo-world';
        var keep = '.mo-bg,.mo-overlay,.mo-hud,.mo-grain,.mo-vignette,.mo-letterbox,#mo-guides,#mo-stamp';
        toArray(stage.children).forEach(function (c) { if (!c.matches(keep)) world.appendChild(c); });
        var after = one('.mo-bg', stage); if (after && after.nextSibling) stage.insertBefore(world, after.nextSibling); else stage.insertBefore(world, stage.firstChild && stage.firstChild.matches && stage.firstChild.matches('.mo-bg') ? stage.firstChild.nextSibling : stage.firstChild);
      }
      return world;
    }
    var P = parseFloat(getComputedStyle(stage).perspective) || 1800;
    var cam = {
      s: { x: W / 2, y: H / 2, zoom: 1, dolly: 0, rx: 0, ry: 0, rz: 0, focus: 0, aperture: 0 },
      _shakes: [], _punches: [],
      _used: false,
      /** cam.to({ x, y, zoom, dolly, rx, ry, rz, focus, aperture, duration, ease }, at) */
      to: function (vars, at) { cam._used = true; ensureWorld(); var v = {}; for (var k in vars) v[k] = vars[k]; if (v.duration == null) v.duration = 1.6; if (!v.ease) v.ease = 'mo.cam'; return tw_to(cam.s, v, at); },
      set: function (vars, at) { cam._used = true; ensureWorld(); if (at == null) { for (var k in vars) cam.s[k] = vars[k]; return cam; } tl.set(cam.s, vars, at); return cam; },
      /** { x, y, zoom } that frames `target` so it fills `fill` (0–1) of the stage. */
      frame: function (target, o) {
        o = o || {}; var els = toArray(target, stage), x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        els.forEach(function (el) { var r = M.rect(el, o); x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y); x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h); });
        var fill = o.fill || 0.72, z = Math.min((W * fill) / Math.max(1, x1 - x0), (H * fill) / Math.max(1, y1 - y0));
        if (o.maxZoom) z = Math.min(z, o.maxZoom); if (o.zoom) z = o.zoom;
        return { x: (x0 + x1) / 2 + (o.dx || 0), y: (y0 + y1) / 2 + (o.dy || 0), zoom: z };
      },
      /** cam.lookAt(target, { fill | zoom, duration, ease, rx, ry, rz }, at) */
      lookAt: function (target, o, at) {
        if (typeof o !== 'object' || o === null) { at = o; o = {}; }
        var f = cam.frame(target, o), v = { x: f.x, y: f.y, zoom: f.zoom, duration: o.duration || 1.5, ease: o.ease || 'mo.cam' };
        ['rx', 'ry', 'rz', 'dolly', 'focus', 'aperture'].forEach(function (k) { if (o[k] != null) v[k] = o[k]; });
        return cam.to(v, at);
      },
      /** cam.home({ duration }, at) — back to the flat, front-on full frame. */
      home: function (o, at) { if (typeof o !== 'object' || o === null) { at = o; o = {}; } return cam.to({ x: W / 2, y: H / 2, zoom: o.zoom || 1, dolly: 0, rx: 0, ry: 0, rz: 0, duration: o.duration || 1.5, ease: o.ease || 'mo.cam' }, at); },
      /** cam.drift({ zoom: 1.05 }) — the slow push that keeps every frame alive from 0 to D. Composes with other moves. */
      drift: function (o) { o = o || {}; cam._used = true; ensureWorld(); cam._drift = { z0: o.from || 1, z1: o.zoom || o.to || 1.05, x: o.x || 0, y: o.y || 0, rz: o.rz || 0, a: o.start || 0, b: o.end || D }; return cam; },
      /** cam.float({ rot: 0.35, pos: u*0.4, period: 9 }) — barely-there handheld sway; makes long holds feel shot, not rendered. */
      float: function (o) { o = o || {}; cam._used = true; ensureWorld(); cam._float = { rot: o.rot == null ? 0.35 : o.rot, pos: o.pos == null ? U * 0.4 : o.pos, per: o.period || 9 }; return cam; },
      /** cam.shake({ amp, duration }, at) — short decaying jolt for impacts. */
      shake: function (o, at) {
        if (typeof o !== 'object' || o === null) { at = o; o = {}; }
        cam._used = true; ensureWorld();
        var st = { v: 0 }; cam._shakes.push({ st: st, amp: o.amp || U * 0.9, seed: cam._shakes.length * 7 + 11 });
        return tw_fromTo(st, { v: 1 }, { v: 0, duration: o.duration || 0.35, ease: 'power2.out', immediateRender: false }, at);
      },
      /** cam.punch({ scale: 1.05, duration: 0.4 }, at) — a quick zoom kick that settles; put one on every beat cut. */
      punch: function (o, at) {
        if (typeof o !== 'object' || o === null) { at = o; o = {}; }
        cam._used = true; ensureWorld();
        var st = { v: 1 }; cam._punches.push(st);
        return tw_fromTo(st, { v: o.scale || 1.05 }, { v: 1, duration: o.duration || 0.4, ease: o.ease || 'mo.out', immediateRender: false }, at);
      }
    };
    M.cam = cam;
    var layers = null;
    function applyCamera(t) {
      if (!cam._used) return;
      var s = cam.s, zoom = s.zoom, x = s.x, y = s.y, rz = s.rz;
      if (cam._drift) { var d = cam._drift, p = clamp((t - d.a) / Math.max(1e-6, d.b - d.a), 0, 1); zoom *= lerp(d.z0, d.z1, p); x += d.x * p; y += d.y * p; rz += d.rz * p; }
      var rx = s.rx, ry = s.ry;
      if (cam._float) { var fl = cam._float, ph = (t / fl.per) * TAU; rx += Math.sin(ph * 0.9 + 0.7) * fl.rot * 0.6; ry += Math.sin(ph + 2.1) * fl.rot; x += Math.sin(ph * 0.8) * fl.pos; y += Math.cos(ph * 0.65 + 1) * fl.pos; }
      for (var q = 0; q < cam._shakes.length; q++) { var sh = cam._shakes[q], sv = sh.st.v; if (sv > 0.0005) { x += noise(t * 31, sh.seed) * sh.amp * sv; y += noise(t * 29, sh.seed + 12) * sh.amp * sv; rz += noise(t * 23, sh.seed + 26) * sv * 0.25; } }
      for (q = 0; q < cam._punches.length; q++) zoom *= cam._punches[q].v;
      if (NOCAM) { world.style.transform = ''; if (layers === null) layers = placeLayers(); return; }
      world.style.transform = 'translate3d(' + (W / 2) + 'px,' + (H / 2) + 'px,' + s.dolly.toFixed(3) + 'px) scale(' + zoom.toFixed(5) + ') rotateX(' + rx.toFixed(4) + 'deg) rotateY(' + ry.toFixed(4) + 'deg) rotateZ(' + rz.toFixed(4) + 'deg) translate3d(' + (-x).toFixed(3) + 'px,' + (-y).toFixed(3) + 'px,0)';
      if (layers === null) layers = placeLayers();
      if (layers.length && (s.aperture > 0 || cam._hadBlur)) {
        cam._hadBlur = true;
        for (var i = 0; i < layers.length; i++) { var b = Math.abs(layers[i].z - s.focus) * s.aperture / 100; layers[i].el.style.filter = b > 0.15 ? 'blur(' + b.toFixed(2) + 'px)' : ''; }
      }
    }
    appliers.push(applyCamera);
    // depth layers are placed even when the camera is never touched
    appliers.push(function () { if (layers === null && !cam._used) layers = placeLayers(); });
    function placeLayers() {
      var list = toArray('.mo-layer[data-z]', stage).map(function (el) {
        var z = +el.dataset.z || 0;
        el.style.translate = '0 0 ' + z + 'px'; if (el.dataset.fit !== 'off') el.style.scale = String((P - z) / P);
        return { el: el, z: z };
      });
      // A themed scene paints its background on its own plane (z = 0) and would hide layers placed behind it.
      // Move that background onto a backdrop layer behind the deepest layer instead.
      var done = [];
      list.forEach(function (l) {
        if (l.z >= 0) return;
        var sc = l.el.parentElement; while (sc && sc !== stage && !(sc.hasAttribute('data-theme') || sc.classList.contains('mo-scene'))) sc = sc.parentElement;
        if (!sc || sc === stage || done.indexOf(sc) >= 0) return;
        var bg = getComputedStyle(sc).backgroundColor; if (parseColor(bg).a < 0.05) return;
        done.push(sc);
        var minZ = 0; list.forEach(function (m) { if (sc.contains(m.el)) minZ = Math.min(minZ, m.z); });
        var back = doc.createElement('div'), z = minZ - 200;
        back.className = 'mo-layer mo-backdrop'; back.setAttribute('data-z', z);
        back.style.cssText = 'inset:-30%;background:' + bg + ';translate:0 0 ' + z + 'px;scale:' + ((P - z) / P);
        sc.insertBefore(back, sc.firstChild); sc.style.background = 'transparent';
      });
      return list;
    }

    // ── cursor ──
    /**
     * cursor({ x, y, parent, label, style, size }) → { el, moveTo(target|{x,y}, {duration, ease, bend, dx, dy}, at), click(at, {ripple}), show(at), hide(at) }
     * Lives inside the world by default so camera zooms treat it like a real screen recording.
     * Give `parent: '#laptop .mo-screen'` to put it on a device screen: it then tilts with the device and {x,y} are that screen's pixels.
     */
    M.cursor = function (o) {
      o = o || {};
      var parent = one(o.parent, stage) || one('.mo-world', stage) || stage;
      var el = h('div', 'mo-cursor', parent);
      el.innerHTML = o.style === 'hand'
        ? '<svg viewBox="0 0 32 32"><circle cx="9" cy="9" r="8" fill="rgba(255,255,255,.28)" stroke="#fff" stroke-width="1.6"/></svg>'
        : '<svg viewBox="0 0 32 32"><path d="M6 4.6 26.4 13 16.9 16.6 13.2 26.2Z" fill="#0B0B0D" stroke="#fff" stroke-width="2.7" stroke-linejoin="round"/></svg>';
      if (o.label) { var tag = h('div', 'mo-cursor-tag', el); tag.textContent = o.label; }
      var inWorld = parent === stage || parent.classList.contains('mo-world'), pw = inWorld ? W : parent.clientWidth, ph = inWorld ? H : parent.clientHeight, size = o.size || 1;
      var st = { x: o.x == null ? pw * 0.82 : o.x, y: o.y == null ? ph * 0.86 : o.y, s: 1, o: o.hidden ? 0 : 1 };
      var last = { x: st.x, y: st.y }, bendSign = 1, home = { x: st.x, y: st.y };
      function resolve(target, opt) {
        var p;
        if (target && target.x != null && target.nodeType == null) p = { x: target.x, y: target.y };
        else { var r = M.rect(target, opt); p = local(parent, { x: r.x + r.w * (opt.ax == null ? 0.5 : opt.ax), y: r.y + r.h * (opt.ay == null ? 0.56 : opt.ay) }); }
        return { x: p.x + (opt.dx || 0), y: p.y + (opt.dy || 0) };
      }
      var api = {
        el: el, state: st,
        /** Travels on a slight arc (never a ruler-straight line), eased in and out. */
        moveTo: function (target, opt, at) {
          if (typeof opt !== 'object' || opt === null) { at = opt; opt = {}; }
          var a = { x: last.x, y: last.y }, b = resolve(target, opt), dist = Math.hypot(b.x - a.x, b.y - a.y);
          var bend = (opt.bend == null ? 0.16 : opt.bend) * dist * bendSign; bendSign = -bendSign;
          var mx = (a.x + b.x) / 2 - ((b.y - a.y) / (dist || 1)) * bend, my = (a.y + b.y) / 2 + ((b.x - a.x) / (dist || 1)) * bend;
          var pr = { p: 0 }, dur = opt.duration || clamp(0.45 + dist / (U * 190), 0.5, 1.25);
          var tw = tw_to(pr, { p: 1, duration: dur, ease: opt.ease || 'mo.inOut' }, at);
          api._moves.push({ tw: tw, a: a, b: b, mx: mx, my: my, pr: pr, dur: dur });
          last = b;
          return tw;
        },
        _moves: [],
        click: function (a1, a2) {
          var fx = flex(a1, a2), opt = fx.o, at = fx.at;
          var sub = gsap.timeline(), cx = last.x, cy = last.y;
          sub.to(st, { s: 0.84, duration: 0.09, ease: 'power2.out' }).to(st, { s: 1, duration: 0.4, ease: 'mo.spring' });
          if (opt.ripple !== false) { var r = h('div', 'mo-ripple' + (opt.accent ? ' accent' : ''), parent); gsap.set(r, { x: cx, y: cy }); sub.fromTo(r, { scale: 0.25, opacity: 0.7 }, { scale: 1.25, opacity: 0, duration: 0.65, ease: 'mo.out', immediateRender: false }, 0.05); }
          return tlAt(sub, at);
        },
        show: function (a1, a2) { var fx = flex(a1, a2); return tw_to(st, { o: 1, duration: fx.o.duration || 0.3, ease: 'power1.out' }, fx.at); },
        hide: function (a1, a2) { var fx = flex(a1, a2); return tw_to(st, { o: 0, duration: fx.o.duration || 0.3, ease: 'power1.in' }, fx.at); },
        pos: function () { return { x: last.x, y: last.y }; }
      };
      // position is recomputed from the move list each frame, so scrubbing in any direction is exact
      appliers.push(function (t) {
        var cur = null, mv = api._moves;
        for (var i = 0; i < mv.length; i++) { if (t >= mv[i].tw.startTime() - 1e-6 && (!cur || mv[i].tw.startTime() >= cur.tw.startTime())) cur = mv[i]; }
        if (!cur) { st.x = home.x; st.y = home.y; }
        else { var p = clamp(cur.pr.p, 0, 1), q = 1 - p; st.x = q * q * cur.a.x + 2 * q * p * cur.mx + p * p * cur.b.x; st.y = q * q * cur.a.y + 2 * q * p * cur.my + p * p * cur.b.y; }
        el.style.transform = 'translate3d(' + st.x.toFixed(2) + 'px,' + st.y.toFixed(2) + 'px,0) scale(' + (st.s * size).toFixed(4) + ')';
        el.style.opacity = st.o.toFixed(3);
      });
      return api;
    };
    /**
     * tap(target|{x,y}, { parent, size, dx, dy }, at) — touch feedback for phone UIs.
     * A target inside a device screen gets its ripple on that screen (clipped by it, tilting with it, sized to it).
     */
    M.tap = function (target, a1, a2) {
      var fx = flex(a1, a2), o = fx.o, at = fx.at, point = target && target.x != null && target.nodeType == null;
      var el = point ? null : one(target, stage), screen = el && el.closest ? el.closest('.mo-screen') : null;
      var parent = one(o.parent, stage) || screen || one('.mo-world', stage) || stage, p;
      if (point) p = { x: target.x, y: target.y }; else { var r = M.rect(el); p = local(parent, { x: r.cx, y: r.cy }); }
      var dot = h('div', 'mo-tap', parent), size = o.size || (parent.classList.contains('mo-screen') ? parent.clientWidth * 0.2 : 0);
      if (size) { dot.style.width = dot.style.height = size + 'px'; dot.style.margin = (-size / 2) + 'px 0 0 ' + (-size / 2) + 'px'; }
      gsap.set(dot, { x: p.x + (o.dx || 0), y: p.y + (o.dy || 0) });
      var sub = gsap.timeline();
      sub.fromTo(dot, { scale: 0.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.16, ease: 'power2.out', immediateRender: false }).to(dot, { scale: 1.9, opacity: 0, duration: 0.5, ease: 'mo.out' });
      return tlAt(sub, at);
    };

    // ── atmosphere ──
    /** aurora({ colors, parent, alpha, size, speed, seed, blend, spread }) — slow volumetric color light. */
    M.aurora = function (o) {
      o = o || {};
      var parent = one(o.parent, stage) || one('.mo-bg', stage) || h('div', 'mo-bg', null);
      if (!parent.parentNode) stage.insertBefore(parent, stage.firstChild);
      var box = h('div', 'mo-aurora', parent), cols = o.colors || ['var(--accent)', 'var(--accent-2)', 'var(--accent)'], rand = rng(o.seed || 7);
      var light = getComputedStyle(stage).colorScheme === 'light';
      if (o.blend || !light) box.style.mixBlendMode = o.blend || 'screen';
      var size = (o.size || 1.15) * Math.max(W, H), blobs = cols.map(function (c, i) {
        var b = h('i', '', box); b.style.width = b.style.height = (size * (0.8 + rand() * 0.5)).toFixed(0) + 'px';
        b.style.setProperty('--c', c); b.style.setProperty('--a', String((o.alpha == null ? (light ? 0.34 : 0.5) : o.alpha) * (0.8 + rand() * 0.4)));
        var anchors = o.anchors && o.anchors[i];
        return { el: b, bx: anchors ? anchors[0] : 0.15 + rand() * 0.7, by: anchors ? anchors[1] : (o.spread === 'bottom' ? 0.78 + rand() * 0.3 : o.spread === 'top' ? -0.05 + rand() * 0.25 : 0.2 + rand() * 0.6), ax: 0.1 + rand() * 0.12, ay: 0.06 + rand() * 0.1, ph: rand() * TAU, sp: (o.speed || 1) * (0.05 + rand() * 0.035), w: size };
      });
      appliers.push(function (t) {
        blobs.forEach(function (b) {
          var x = (b.bx + Math.sin(t * b.sp * TAU + b.ph) * b.ax) * W, y = (b.by + Math.cos(t * b.sp * TAU * 0.8 + b.ph * 1.7) * b.ay) * H, hw = parseFloat(b.el.style.width) / 2;
          var sc = 1 + Math.sin(t * b.sp * TAU * 0.6 + b.ph * 0.5) * 0.08;
          b.el.style.transform = 'translate3d(' + (x - hw).toFixed(1) + 'px,' + (y - hw).toFixed(1) + 'px,0) scale(' + sc.toFixed(4) + ')';
        });
      });
      return box;
    };
    /**
     * grain({ alpha, size, every }) — soft film grain. It also dithers dark gradients so H.264 does not band.
     * Still by default. every: 2 makes it boil "on twos" (film look, but roughly 10× the bitrate).
     */
    M.grain = function (o) {
      o = o || {};
      var el = one('.mo-grain', stage) || h('div', 'mo-grain', stage), N = o.tile || 160, c = doc.createElement('canvas'); c.width = c.height = N;
      var ctx = c.getContext('2d'), img = ctx.createImageData(N, N), rand = rng(o.seed || 1234), A = (o.alpha == null ? 0.03 : o.alpha) * 255;
      for (var i = 0; i < N * N; i++) { var g = rand() * 2 - 1, v = g > 0 ? 255 : 0; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = Math.abs(g) * A; }
      ctx.putImageData(img, 0, 0);
      var size = (o.size == null ? 1.7 : o.size) * N, every = o.every == null ? 0 : o.every;
      el.style.backgroundImage = 'url(' + c.toDataURL('image/png') + ')'; el.style.backgroundSize = size + 'px ' + size + 'px';
      appliers.push(function (t, f) { var k = every > 0 ? Math.floor(f / every) : 0; el.style.backgroundPosition = Math.floor(hash2(k, 91) * size) + 'px ' + Math.floor(hash2(k, 57) * size) + 'px'; });
      return el;
    };
    /** particles({ count, parent, color, size, speed, seed, depth }) — drifting dust / bokeh on a canvas. */
    M.particles = function (o) {
      o = o || {};
      var parent = one(o.parent, stage) || one('.mo-bg', stage) || stage, cv = h('canvas', 'mo-canvas', parent); cv.width = W; cv.height = H;
      var ctx = cv.getContext('2d'), rand = rng(o.seed || 42), n = o.count || 70, col = parseColor(o.color || getComputedStyle(stage).color);
      var ps = []; for (var i = 0; i < n; i++) ps.push({ x: rand(), y: rand(), z: 0.25 + rand() * 0.75, r: (o.size || U * 0.22) * (0.4 + rand() * 1.4), vx: (rand() - 0.5) * 0.012, vy: -(0.006 + rand() * 0.02), ph: rand() * TAU, a: 0.15 + rand() * 0.6 });
      appliers.push(function (t) {
        ctx.clearRect(0, 0, W, H);
        for (var i = 0; i < n; i++) {
          var p = ps[i], sp = (o.speed || 1) * p.z, x = ((p.x + p.vx * t * sp + Math.sin(t * 0.3 + p.ph) * 0.01) % 1 + 1) % 1, y = ((p.y + p.vy * t * sp) % 1 + 1) % 1;
          var tw = 0.6 + 0.4 * Math.sin(t * 1.3 + p.ph * 3), r = p.r * p.z * (o.bokeh ? 3.2 : 1);
          ctx.beginPath(); ctx.arc(x * W, y * H, r, 0, TAU);
          ctx.fillStyle = 'rgba(' + col.r + ',' + col.g + ',' + col.b + ',' + (p.a * tw * (o.alpha == null ? 0.5 : o.alpha) * (o.bokeh ? 0.35 : 1)).toFixed(3) + ')'; ctx.fill();
        }
      });
      return cv;
    };
    /** video(target, { start, rate, from }) — frame-accurate footage: currentTime follows the master clock. */
    M.video = function (target, o) {
      o = o || {};
      toArray(target, stage).forEach(function (v) {
        v.muted = true; v.pause();
        appliers.push(function (t) {
          var vt = clamp((o.from || 0) + (t - (o.start || 0)) * (o.rate || 1), 0, Math.max(0, (v.duration || 1e6) - 0.04));
          if (Math.abs(v.currentTime - vt) > 0.004) { pending.push(new Promise(function (res) { var done = function () { v.removeEventListener('seeked', done); res(); }; v.addEventListener('seeked', done); setTimeout(done, 1500); v.currentTime = vt; })); }
        });
      });
      return M;
    };
    /** fitText(target, width) — size the type so its text is exactly `width` px wide (giant words that must fill a measure). */
    M.fitText = function (target, width) {
      toArray(target, stage).forEach(function (el) {
        for (var i = 0; i < 3; i++) {
          var r = doc.createRange(); r.selectNodeContents(el);
          var w = r.getBoundingClientRect().width / stageScale(); if (!w) return;
          el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * width / w).toFixed(2) + 'px';
        }
      });
      return M;
    };
    /**
     * follow(target, path, { duration, ease, from, to, rotate }, at) — carry an element along an SVG path.
     * The element should be absolutely positioned at left:0; top:0 in the same parent as the <svg> (centre it with a negative margin).
     */
    M.follow = function (target, pathSel, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      var el = one(target, stage), path = one(pathSel, stage); if (!el || !path) { console.warn('[motion] follow: missing element or path'); return null; }
      var svg = path.ownerSVGElement, len = path.getTotalLength(), pr = { p: o.from || 0 };
      var sr = M.rect(svg), pp = el.offsetParent && el.offsetParent !== stage ? M.rect(el.offsetParent) : { x: 0, y: 0 };
      var vb = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width ? svg.viewBox.baseVal : { x: 0, y: 0, width: sr.w, height: sr.h };
      var k = Math.min(sr.w / vb.width, sr.h / vb.height), ox = sr.x - pp.x + (sr.w - vb.width * k) / 2 - vb.x * k, oy = sr.y - pp.y + (sr.h - vb.height * k) / 2 - vb.y * k;
      var tw = tw_fromTo(pr, { p: o.from || 0 }, { p: o.to == null ? 1 : o.to, duration: o.duration || 1.2, ease: o.ease || 'mo.inOut', immediateRender: false }, at);
      appliers.push(function () {
        var d = clamp(pr.p, 0, 1) * len, pt = path.getPointAtLength(d), tr = 'translate3d(' + (ox + pt.x * k).toFixed(2) + 'px,' + (oy + pt.y * k).toFixed(2) + 'px,0)';
        if (o.rotate) { var q = path.getPointAtLength(Math.min(len, d + 1)), q0 = path.getPointAtLength(Math.max(0, d - 1)); tr += ' rotate(' + (Math.atan2(q.y - q0.y, q.x - q0.x) * 180 / Math.PI).toFixed(2) + 'deg)'; }
        el.style.translate = 'none'; el.style.transform = tr;
      });
      return tw;
    };
    /**
     * iris(target, { x, y, from: 0, to: 1, duration, ease }, at) — a circular mask on any element, opening (0 → 1) or closing (1 → 0)
     * around the point (x, y) inside it (px or '70%'). 1 = fully revealed. Several calls on one element play in order.
     */
    M.iris = function (target, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      var el = one(target, stage); if (!el) return null;
      var r = M.rect(el);
      function coord(v, size) { return v == null ? size / 2 : (typeof v === 'string' && /%$/.test(v) ? parseFloat(v) / 100 * size : parseFloat(v)); }
      var x = coord(o.x, r.w), y = coord(o.y, r.h), R = Math.max(Math.hypot(x, y), Math.hypot(r.w - x, y), Math.hypot(x, r.h - y), Math.hypot(r.w - x, r.h - y)) * 1.02;
      var from = o.from == null ? 0 : o.from, st = { p: from };
      var tw = tw_fromTo(st, { p: from }, { p: o.to == null ? 1 : o.to, duration: o.duration || 0.8, ease: o.ease || 'mo.inOut', immediateRender: false }, at);
      if (!el._moIris) {
        el._moIris = [];
        appliers.push(function (t) {
          var list = el._moIris, cur = list[0];
          for (var i = 0; i < list.length; i++) if (t >= list[i].tw.startTime() - 1e-6) cur = list[i];
          var p = t < cur.tw.startTime() - 1e-6 ? cur.from : cur.st.p;
          el.style.clipPath = p >= 0.999 ? 'none' : 'circle(' + (Math.max(0, p) * cur.R).toFixed(1) + 'px at ' + cur.x.toFixed(1) + 'px ' + cur.y.toFixed(1) + 'px)';
        });
      }
      el._moIris.push({ tw: tw, st: st, from: from, x: x, y: y, R: R });
      return tw;
    };
    return M;
  }

  // ───────────────────────── finalize / seek / player ─────────────────────────
  function finalize(M) {
    var tl = M.tl, D = M.D, stage = M.stage, fps = M.fps, appliers = M._appliers;
    var dur = tl.duration();
    if (dur > 1e5) fail('Timeline is infinite (repeat:-1 inside the master). Use finite repeats or M.onFrame/M.float/M.spin.');
    else if (dur > D + 0.051) fail('Timeline runs to ' + dur.toFixed(2) + 's but data-duration is ' + D + 's — content after ' + D + 's is cut. Extend data-duration or tighten the timeline.');
    if (dur < D) tl.set({}, {}, D);

    function frame(t) { var f = Math.floor(t * fps + 1e-6); for (var i = 0; i < appliers.length; i++) { try { appliers[i](t, f); } catch (e) { fail('onFrame: ' + (e.stack || e)); appliers.splice(i--, 1); } } }
    function seek(t) {
      t = clamp(+t || 0, 0, D); M.t = t; M._pending.length = 0;
      tl.time(t, false); frame(t);
      if (stamp) stamp.textContent = t.toFixed(2) + 's';
      return M._pending.length ? Promise.all(M._pending.slice()).then(function () { return t; }) : Promise.resolve(t);
    }
    // prime: sweep once so every tween records its start values in timeline order
    tl.time(D, false); frame(D); tl.time(0, false); frame(0);

    var stamp = null;
    global.__motion = {
      ready: true, failed: errors.length > 0, errors: errors, version: Motion.version,
      width: M.W, height: M.H, fps: fps, duration: D, title: stage.dataset.title || doc.title || '',
      seek: seek,
      stamp: function (on) { if (!stamp) { stamp = doc.createElement('div'); stamp.id = 'mo-stamp'; stage.appendChild(stamp); } stamp.style.display = on ? 'block' : 'none'; },
      labels: tl.labels,
      inspect: function () { return inspect(M); },
      /**
       * Largest on-screen displacement (stage px) of any visible element between two times.
       * The renderer uses it to decide how many motion-blur sub-frames a frame deserves.
       */
      motion: function (t0, t1) {
        var els = stage.querySelectorAll('*'), n = els.length, a = new Array(n), i, r, max = 0, W = M.W, H = M.H;
        var sr = stage.getBoundingClientRect(), k = sr.width / W || 1, vis = { opacityProperty: true, visibilityProperty: true }, floor = 0;
        seek(t0);
        for (i = 0; i < n; i++) {
          var el = els[i];
          if (el.checkVisibility && !el.checkVisibility(vis)) { a[i] = null; continue; }
          r = el.getBoundingClientRect();
          if (r.width < 0.5 || r.height < 0.5) { a[i] = null; continue; }
          a[i] = [r.left, r.top, r.right, r.bottom];
          if (el.tagName === 'CANVAS' || el.tagName === 'VIDEO') floor = 2.5;
        }
        seek(t1);
        for (i = 0; i < n; i++) {
          var p = a[i]; if (!p) continue;
          r = els[i].getBoundingClientRect();
          var on = (p[2] > sr.left && p[0] < sr.right && p[3] > sr.top && p[1] < sr.bottom) || (r.right > sr.left && r.left < sr.right && r.bottom > sr.top && r.top < sr.bottom);
          if (!on) continue;
          var d = Math.max(Math.abs(r.left - p[0]), Math.abs(r.top - p[1]), Math.abs(r.right - p[2]), Math.abs(r.bottom - p[3]));
          if (d > max) max = d;
        }
        return Math.max(floor, max / k);
      },
      /**
       * Largest magnification of visible text or pictures that sit under a true 3D transform (tilted camera,
       * tilted device, depth layer) at time t — 0 when nothing does.
       * Chrome paints such layers at layout resolution however far they are enlarged, so they turn soft;
       * the renderer lays the page out larger for those frames (see lib/render.mjs).
       */
      sharp: function (t) {
        if (t != null) seek(t);
        var els = stage.querySelectorAll('*'), sr = stage.getBoundingClientRect(), k = sr.width / M.W || 1;
        var vis = { opacityProperty: true, visibilityProperty: true }, seen = new Map(), max = 0;
        function tilted(n) {
          if (!n || n === stage || n.nodeType !== 1) return false;
          var v = seen.get(n);
          if (v === undefined) { v = getComputedStyle(n).transform.indexOf('matrix3d') === 0 || tilted(n.parentNode); seen.set(n, v); }
          return v;
        }
        for (var i = 0; i < els.length; i++) {
          var el = els[i], lw = el.offsetWidth, lh = el.offsetHeight;
          if (!lw || !lh) continue;
          var pic = el.tagName === 'IMG' || el.tagName === 'VIDEO', own = pic;
          for (var c = el.firstChild; c && !own; c = c.nextSibling) if (c.nodeType === 3 && /\S/.test(c.nodeValue)) own = true;
          if (!own || (el.checkVisibility && !el.checkVisibility(vis))) continue;
          var r = el.getBoundingClientRect();
          if (r.right < sr.left || r.left > sr.right || r.bottom < sr.top || r.top > sr.bottom) continue;
          var m = Math.sqrt((r.width * r.height) / (lw * lh)) / k;
          if (m > max && tilted(el)) max = m;
        }
        return +max.toFixed(3);
      }
    };
    seek(0);
    var guides = buildGuides(M);
    if (QS.has('guides')) guides.classList.add('on');
    if (!RENDER) buildPlayer(M, seek, guides);
    doc.documentElement.setAttribute('data-motion-ready', '1');
  }

  function buildGuides(M) {
    var guides = h('div', '', M.stage); guides.id = 'mo-guides';
    if (M.H > M.W) guides.innerHTML = '<i style="left:0;right:0;top:0;height:10.5%"></i><i style="left:0;right:0;bottom:0;height:20%"></i><i style="right:0;top:55%;bottom:20%;width:12%"></i>';
    else guides.innerHTML = '<i style="left:0;right:0;top:0;height:5%"></i><i style="left:0;right:0;bottom:0;height:9%"></i>';
    return guides;
  }
  function buildPlayer(M, seek, guides) {
    var stage = M.stage, W = M.W, H = M.H, D = M.D, fps = M.fps;
    var bar = h('div', '', doc.body); bar.id = 'mo-player';
    bar.innerHTML = '<button data-a="play" title="Space">▶</button><button data-a="loop" class="on" title="L">loop</button><button data-a="rate" title="속도">1×</button><button data-a="guides" title="G: 플랫폼 안전영역">safe</button><div class="bar"><i></i></div><div class="time"></div>';
    var fill = bar.querySelector('.bar > i'), time = bar.querySelector('.time'), track = bar.querySelector('.bar');
    Object.keys(M.tl.labels).forEach(function (k) { var b = h('b', '', track); b.style.left = (M.tl.labels[k] / D * 100) + '%'; b.title = k; });
    function fit() {
      var aw = innerWidth - 32, ah = innerHeight - 56 - 32, s = Math.min(aw / W, ah / H);
      stage.style.transform = 'translate(' + ((innerWidth - W * s) / 2).toFixed(1) + 'px,' + ((innerHeight - 56 - H * s) / 2).toFixed(1) + 'px) scale(' + s.toFixed(5) + ')';
    }
    addEventListener('resize', fit); fit();
    var playing = false, loop = true, rate = 1, t = +(QS.get('t') || 0), last = 0, rates = [1, 0.5, 0.25, 2];
    function ui() { fill.style.width = (t / D * 100).toFixed(3) + '%'; time.textContent = t.toFixed(2) + ' / ' + D.toFixed(2) + 's · f' + Math.round(t * fps); bar.querySelector('[data-a=play]').textContent = playing ? '❚❚' : '▶'; }
    function go(nt) { t = clamp(nt, 0, D); seek(t); ui(); }
    function tick(now) { if (!playing) return; var dt = (now - last) / 1000; last = now; var nt = t + dt * rate; if (nt >= D) { if (loop) nt = 0; else { nt = D; playing = false; } } go(nt); requestAnimationFrame(tick); }
    function toggle() { playing = !playing; if (playing) { if (t >= D) t = 0; last = performance.now(); requestAnimationFrame(tick); } ui(); }
    bar.addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'play') toggle();
      if (a === 'loop') { loop = !loop; e.target.classList.toggle('on', loop); }
      if (a === 'rate') { rate = rates[(rates.indexOf(rate) + 1) % rates.length]; e.target.textContent = rate + '×'; }
      if (a === 'guides') { guides.classList.toggle('on'); e.target.classList.toggle('on'); }
    });
    var drag = false;
    function scrub(e) { var r = track.getBoundingClientRect(); go(clamp((e.clientX - r.left) / r.width, 0, 1) * D); }
    track.addEventListener('pointerdown', function (e) { drag = true; playing = false; track.setPointerCapture(e.pointerId); scrub(e); });
    track.addEventListener('pointermove', function (e) { if (drag) scrub(e); });
    track.addEventListener('pointerup', function () { drag = false; });
    addEventListener('keydown', function (e) {
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.code === 'ArrowRight') { playing = false; go(t + (e.shiftKey ? 0.5 : 1 / fps)); }
      else if (e.code === 'ArrowLeft') { playing = false; go(t - (e.shiftKey ? 0.5 : 1 / fps)); }
      else if (e.code === 'Home') go(0); else if (e.code === 'End') go(D);
      else if (e.code === 'KeyL') bar.querySelector('[data-a=loop]').click();
      else if (e.code === 'KeyG') bar.querySelector('[data-a=guides]').click();
    });
    go(t);
    if (QS.get('autoplay') !== '0' && !QS.has('t')) toggle();
  }

  // ───────────────────────── inspection (used by `motion check`) ─────────────────────────
  var BLOCK_SEL = '[data-mo-split],.mo-hl,.mo-typed,.mo-label,.mo-chip,.mo-pill,.mo-btn,.mo-bubble,.mo-odo,.mo-num,.mo-count,.mo-stat-num,.mo-terminal,.mo-code,.mo-kbd,pre,p,h1,h2,h3,h4,h5,li,button,figcaption,td,th';
  var blockSeq = 0;
  function insetClip(cs, r) {
    // translate a simple clip-path: inset(t r b l) into a clipped client rect
    var m = /^inset\(([^)]+)\)/.exec(cs.clipPath || ''); if (!m) return null;
    var p = m[1].split(/\s+round\s+/)[0].trim().split(/\s+/); if (p.length === 1) p = [p[0], p[0], p[0], p[0]]; else if (p.length === 2) p = [p[0], p[1], p[0], p[1]]; else if (p.length === 3) p = [p[0], p[1], p[2], p[1]];
    function v(s, ref) { return /%$/.test(s) ? (parseFloat(s) / 100) * ref : parseFloat(s) || 0; }
    if (p.some(function (s) { return /calc/.test(s); })) return null;
    return { left: r.left + v(p[3], r.width), top: r.top + v(p[0], r.height), right: r.right - v(p[1], r.width), bottom: r.bottom - v(p[2], r.height) };
  }
  function inspect(M) {
    var stage = M.stage, sr = stage.getBoundingClientRect(), s = sr.width / M.W || 1, blocks = new Map(), list = [];
    var accent = parseColor(getComputedStyle(stage).getPropertyValue('--accent').trim() || '#000');
    var stageBg = parseColor(getComputedStyle(stage).backgroundColor);
    function isAccent(c) { return c.a > 0.6 && Math.abs(c.r - accent.r) + Math.abs(c.g - accent.g) + Math.abs(c.b - accent.b) < 30; }
    var walker = doc.createTreeWalker(stage, NodeFilter.SHOW_TEXT, null), n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue.trim()) continue;
      var el = n.parentElement;
      if (!el || el.closest('[data-mo-ignore],#mo-stamp,#mo-guides,.mo-caret,script,style,svg text')) continue;
      var range = doc.createRange(); range.selectNodeContents(n);
      var r = range.getBoundingClientRect(); if (r.width < 0.5 || r.height < 0.5) continue;
      var cs0 = getComputedStyle(el); if (cs0.visibility === 'hidden') continue;
      var op = 1, bg = null, blur = 0, p = el, hidden = false, clips = [];
      while (p && p !== stage.parentElement) {
        var cs = p === el ? cs0 : getComputedStyle(p);
        if (cs.display === 'none') { hidden = true; break; }
        op *= parseFloat(cs.opacity);
        var clip = null;
        if (p !== stage && cs.overflow !== 'visible' && cs.overflowX !== 'visible') clip = p.getBoundingClientRect();
        if (cs.clipPath && cs.clipPath !== 'none') clip = insetClip(cs, p.getBoundingClientRect()) || clip;
        if (clip) clips.push(clip);
        if (!bg) { var b = parseColor(cs.backgroundColor); if (b.a > 0.55) bg = b; }
        var fm = /blur\(([\d.]+)px\)/.exec(cs.filter || ''); if (fm) blur = Math.max(blur, +fm[1]);
        p = p.parentElement;
      }
      if (hidden || op < 0.03) continue;
      clips.push(sr);
      // ink, not line boxes: glyphs leave roughly the top 18% and bottom 14% of each line box empty
      var rects = range.getClientRects(), ink = 0, vink = 0, x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (var q = 0; q < rects.length; q++) {
        var lr = rects[q]; if (lr.width < 0.5 || lr.height < 0.5) continue;
        var it0 = lr.top + lr.height * 0.18, ib0 = lr.bottom - lr.height * 0.14, a0 = lr.left, a1 = lr.right, t0 = it0, t1 = ib0;
        ink += (a1 - a0) * (ib0 - it0);
        var cx0 = lr.left, cy0 = lr.top, cx1 = lr.right, cy1 = lr.bottom;
        for (var c = 0; c < clips.length; c++) { a0 = Math.max(a0, clips[c].left); a1 = Math.min(a1, clips[c].right); t0 = Math.max(t0, clips[c].top); t1 = Math.min(t1, clips[c].bottom); if (c < clips.length - 1) { cx0 = Math.max(cx0, clips[c].left); cy0 = Math.max(cy0, clips[c].top); cx1 = Math.min(cx1, clips[c].right); cy1 = Math.min(cy1, clips[c].bottom); } }
        if (a1 > a0 && t1 > t0) vink += (a1 - a0) * (t1 - t0);
        if (cx1 > cx0 && cy1 > cy0) { x0 = Math.min(x0, cx0); y0 = Math.min(y0, cy0); x1 = Math.max(x1, cx1); y1 = Math.max(y1, cy1); }
      }
      if (ink <= 0 || x1 <= x0) continue;
      // a "block" = the nearest text container: a known component/paragraph, else the nearest non-inline ancestor
      var key = el.closest(BLOCK_SEL);
      if (key && key.matches('.mo-hl,.mo-typed,.mo-num,.mo-count') && key.parentElement.closest(BLOCK_SEL)) key = key.parentElement.closest(BLOCK_SEL);
      if (!key) { key = el; while (key.parentElement && key !== stage && /^inline/.test(getComputedStyle(key).display)) key = key.parentElement; }
      var it = blocks.get(key);
      if (!it) {
        if (!key._moId) key._moId = ++blockSeq;
        var col = parseColor(cs0.color), stroke = parseFloat(cs0.webkitTextStrokeWidth) > 0;
        var sc = el.offsetHeight ? (el.getBoundingClientRect().height / s) / el.offsetHeight : 1;
        it = { id: key._moId, el: key, text: '', x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, fx0: Infinity, fy0: Infinity, fx1: -Infinity, fy1: -Infinity, ink: 0, vink: 0, op: 0,
          font: parseFloat(cs0.fontSize) * (isFinite(sc) && sc > 0 ? sc : 1), color: col, bg: bg || stageBg, blur: blur, outline: stroke || col.a < 0.08,
          family: cs0.fontFamily.split(',')[0].replace(/["']/g, '').trim(), mono: /mono/i.test(cs0.fontFamily.split(',')[0]),
          deco: !!key.closest('[data-deco]'), device: !!key.closest('.mo-phone .mo-screen, .mo-laptop .mo-screen'), accent: isAccent(col) };
        blocks.set(key, it); list.push(it);
      }
      it.text += (it.text ? ' ' : '') + n.nodeValue.trim();
      it.ink += ink; it.vink += vink; it.op = Math.max(it.op, op); it.blur = Math.max(it.blur, blur);
      it.x0 = Math.min(it.x0, x0); it.y0 = Math.min(it.y0, y0); it.x1 = Math.max(it.x1, x1); it.y1 = Math.max(it.y1, y1);
      it.fx0 = Math.min(it.fx0, r.left); it.fy0 = Math.min(it.fy0, r.top); it.fx1 = Math.max(it.fx1, r.right); it.fy1 = Math.max(it.fy1, r.bottom);
    }
    // containment pairs (a label inside a chip inside a card is not an overlap)
    var nested = [];
    for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) { if (list[i].el.contains(list[j].el) || list[j].el.contains(list[i].el)) nested.push(list[i].id + ':' + list[j].id); }
    // accent-coloured regions: backgrounds, SVG paint and accent text, grouped by container (34 ticks of one gauge = one place)
    var groups = [];
    function addGroup(g) { if (g && groups.indexOf(g) < 0 && !groups.some(function (x) { return x !== g && x.contains(g); })) { groups = groups.filter(function (x) { return !g.contains(x); }); groups.push(g); } }
    toArray('*', stage).forEach(function (el) {
      if (el.closest('[data-mo-ignore],.mo-aurora,.mo-bg,#mo-guides,[data-deco],.mo-cursor,.mo-ripple')) return;
      var cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') return;
      var svg = el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg';
      var hit = svg ? ((cs.stroke !== 'none' && isAccent(parseColor(cs.stroke))) || (cs.fill !== 'none' && isAccent(parseColor(cs.fill)))) : isAccent(parseColor(cs.backgroundColor));
      if (!hit) return;
      var r = el.getBoundingClientRect(); if (r.width < 3 * s || r.height < 3 * s || r.width * r.height < 60 * s * s) return;
      var op = 1, p = el; while (p && p !== stage) { op *= parseFloat(getComputedStyle(p).opacity); p = p.parentElement; }
      if (op < 0.5 || r.right < sr.left || r.left > sr.right || r.bottom < sr.top || r.top > sr.bottom) return;
      if (el.checkVisibility && !el.checkVisibility({ visibilityProperty: true })) return;
      addGroup(svg ? el.ownerSVGElement : (el.parentElement && el.parentElement !== stage && !el.parentElement.classList.contains('mo-world') && !el.parentElement.classList.contains('mo-scene') ? el.parentElement : el));
    });
    list.forEach(function (i) { if (i.accent && i.op > 0.5 && !i.deco && i.vink > i.ink * 0.5) addGroup(i.el); });
    function R(v, o) { return Math.round((v - o) / s); }
    return {
      t: M.t, w: M.W, h: M.H,
      items: list.map(function (i) {
        var fgc = over(i.color, i.bg, i.op);
        return { id: i.id, text: i.text.slice(0, 48), len: i.text.replace(/\s/g, '').length, x0: R(i.x0, sr.left), y0: R(i.y0, sr.top), x1: R(i.x1, sr.left), y1: R(i.y1, sr.top),
          fx0: R(i.fx0, sr.left), fy0: R(i.fy0, sr.top), fx1: R(i.fx1, sr.left), fy1: R(i.fy1, sr.top), vis: +(i.vink / Math.max(1, i.ink)).toFixed(2), op: +i.op.toFixed(2),
          font: Math.round(i.font), contrast: i.outline ? null : +contrast(fgc, i.bg).toFixed(2), blur: +i.blur.toFixed(1), family: i.family, mono: i.mono, deco: i.deco, device: i.device };
      }),
      nested: nested, accents: groups.length,
      fonts: doc.fonts ? Array.from(doc.fonts).filter(function (f) { return f.status === 'loaded'; }).map(function (f) { return f.family.replace(/["']/g, ''); }).filter(function (v, k, a) { return a.indexOf(v) === k; }) : []
    };
  }

  Motion.utils = { clamp: clamp, lerp: lerp, map: mapRange, smooth: smooth, noise: noise, rng: rng, hash: hashStr, bezier: cubicBezier, parseColor: parseColor, contrast: contrast, over: over };
  global.Motion = Motion;
})(window);
