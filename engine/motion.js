/*! Motion Director runtime v2.0.0 — MIT
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
  var Motion = { version: '2.0.0', render: RENDER };
  var BASE = ((doc.currentScript && doc.currentScript.src) || '').replace(/[^/]*$/, '') || '_motion/';   // the _motion/ folder (adapters and assets load from here)
  function esc(v) { return String(v).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

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
  // GSAP's plugins ship in the same vendor file (all free since 3.13) — register whichever loaded
  ['CustomEase', 'CustomWiggle', 'CustomBounce', 'MorphSVGPlugin', 'DrawSVGPlugin', 'MotionPathPlugin', 'Physics2DPlugin', 'PhysicsPropsPlugin', 'ScrambleTextPlugin', 'TextPlugin', 'SplitText', 'Flip'].forEach(function (k) {
    if (global[k]) { try { gsap.registerPlugin(global[k]); } catch (e) { /* already registered */ } }
  });
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
    // wait for pictures without taking over their own onload/onerror; an <img data-optional> that fails is simply hidden
    toArray('img', stage).forEach(function (img) {
      if (img.hasAttribute('data-optional')) { var hide = function () { img.style.display = 'none'; }; if (!img.getAttribute('src') || (img.complete && !img.naturalWidth)) hide(); else img.addEventListener('error', hide); }
      if (!img.complete) jobs.push(new Promise(function (r) { img.addEventListener('load', r, { once: true }); img.addEventListener('error', r, { once: true }); }));
      else if (img.decode && img.naturalWidth) jobs.push(img.decode().catch(function () {}));
    });
    toArray('video', stage).forEach(function (v) { v.muted = true; v.pause(); v.preload = 'auto'; if (v.readyState < 2) jobs.push(new Promise(function (r) { v.addEventListener('loadeddata', r, { once: true }); v.addEventListener('error', r, { once: true }); })); });
    return Promise.all(jobs);
  }

  var errors = [];
  function fail(msg) { errors.push(String(msg)); console.error('[motion] ' + msg); if (!RENDER) { var w = doc.getElementById('mo-warn') || h('div', '', doc.body); w.id = 'mo-warn'; w.textContent = errors.join('\n'); } }
  global.addEventListener('error', function (e) { fail((e.message || e) + (e.filename ? '  @' + String(e.filename).split('/').pop() + ':' + e.lineno : '')); });
  global.addEventListener('unhandledrejection', function (e) { fail('unhandled: ' + (e.reason && e.reason.message || e.reason)); });

  /**
   * Things the first frame needs that live in files: audio analyses and caption files the CLI indexed in _motion/assets.json,
   * and the optional adapters (three.js, Lottie) — loaded only when the composition mentions them.
   */
  function preload() {
    var html = doc.documentElement.outerHTML, jobs = [], assets = Motion._assets = { audio: {}, text: {} };
    jobs.push(fetch(BASE + 'assets.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (ix) {
      if (!ix) return null;
      return Promise.all(Object.keys(ix.audio || {}).map(function (k) { return fetch(BASE + ix.audio[k]).then(function (r) { return r.json(); }).then(function (j) { assets.audio[k] = j; }).catch(function () {}); })
        .concat(Object.keys(ix.text || {}).map(function (k) { return fetch(ix.text[k]).then(function (r) { return r.text(); }).then(function (t) { assets.text[k] = t; }).catch(function () {}); })));
    }));
    if (/M\.three\s*\(|data-three/.test(html) && !Motion.THREE) jobs.push(import(BASE + 'three.module.js').then(function (m) { Motion.THREE = m; }).catch(function (e) { console.warn('[motion] three.js not available: ' + e.message); }));
    if (/M\.lottie\s*\(|data-lottie/.test(html) && !global.lottie) jobs.push(new Promise(function (res) { var sc = doc.createElement('script'); sc.src = BASE + 'lottie.min.js'; sc.onload = sc.onerror = res; doc.head.appendChild(sc); }));
    return Promise.all(jobs);
  }

  Motion.compose = function (fn) {
    function start() {
      var stage = doc.getElementById('stage');
      if (!stage) return fail('No <div id="stage"> found.');
      var cfg = setupStage(stage);
      Promise.all([fontsReady(), mediaReady(stage), preload()]).then(function () {
        var M = createContext(stage, cfg);
        Motion.current = M;
        M.declare();
        return Promise.resolve().then(function () { return fn(M); }).then(function () { return Promise.all(M._ready); }).then(function () { finalize(M); });
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

  // a text variable's default as one line, with <br> written as the two characters \n (the same form --vars accepts)
  function textWithBreaks(el) {
    var c = el.cloneNode(true);
    Array.prototype.slice.call(c.querySelectorAll('br')).forEach(function (b) { b.parentNode.replaceChild(doc.createTextNode('\u2028'), b); });
    return c.textContent.split('\u2028').map(function (s) { return s.replace(/\s+/g, ' ').trim(); }).join('\\n').replace(/^(\\n)+|(\\n)+$/g, '');
  }

  function setupStage(stage) {
    var W = +stage.dataset.width || 1080, H = +stage.dataset.height || 1920;
    var cfg = { W: W, H: H, fps: +stage.dataset.fps || 30, D: +stage.dataset.duration || 8, title: stage.dataset.title || doc.title || 'motion' };
    // template variables: <h1 data-var="title">기본 문구</h1> · <img data-var="photo" src="a.jpg"> · built-ins accent and theme (--vars "title=…&accent=mint")
    var defs = Motion._varDefs = {};
    if (QS.get('accent')) stage.dataset.accent = QS.get('accent');
    if (QS.get('theme')) stage.dataset.theme = QS.get('theme');
    defs.accent = { name: 'accent', type: 'color', default: stage.dataset.accent || 'blue', label: '', builtin: true };
    toArray('[data-var]', stage).forEach(function (el) {
      var name = el.dataset.var, media = /^(IMG|VIDEO|AUDIO|SOURCE)$/.test(el.tagName);
      if (!defs[name]) defs[name] = { name: name, type: media ? 'file' : 'text', default: media ? el.getAttribute('src') : textWithBreaks(el), label: el.dataset.label || '' };
      var v = QS.get(name); if (v == null) return;                       // --vars "note=" blanks a line on purpose (batch skips empty cells)
      if (media) el.setAttribute('src', v); else el.innerHTML = esc(v).replace(/\\n|\n/g, '<br>');
    });
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
    M.vars = {}; QS.forEach(function (v, k) { if (!/^(render|t|autoplay|nocam|guides)$/.test(k)) M.vars[k] = v; });
    /** var(name, fallback, { label, type: 'text' | 'number' | 'color' | 'select', options, min, max }) — a template value with a schema (preview panel, motion vars, batch). */
    M.var = function (name, fallback, meta) {
      var defs = M.varDefs || (M.varDefs = Motion._varDefs || {});
      meta = meta || {};
      if (!defs[name]) defs[name] = { name: name, type: meta.type || (typeof fallback === 'number' ? 'number' : (/^#[0-9a-f]{3,8}$/i.test(String(fallback)) ? 'color' : 'text')), default: fallback, label: meta.label || '', options: meta.options || null, min: meta.min, max: meta.max };
      return M.vars[name] == null || M.vars[name] === '' ? fallback : (typeof fallback === 'number' ? +M.vars[name] : M.vars[name]);
    };
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
      if (bpm && typeof bpm === 'object' && bpm.beat) { var tv = bpm, g = function (n) { return tv.beat(n + (+offset || 0)); }; g.len = 60 / (tv.bpm || 120); g.bpm = tv.bpm; return g; }
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
      var d = o.duration == null ? ({ cut: 0, push: 0.85, wipe: 0.9, iris: 0.9, zoom: 0.9, flip: 0.9, whip: 0.5, fade: 0.6, slide: 0.85, blur: 0.7, flash: 0.5, leak: 1.0, clock: 0.9, blinds: 0.9, warp: 0.9, glitch: 0.45 }[type] || 0.8) : o.duration;
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
        case 'slide':
          win(at + d, at);
          if (a) sub.fromTo(a, { xPercent: 0, yPercent: 0, filter: 'brightness(1)' }, { xPercent: sx * 30, yPercent: sy * 30, filter: 'brightness(0.55)', duration: d, ease: o.ease || 'mo.inOut' }, 0);
          if (b) sub.fromTo(b, { xPercent: -sx * 100, yPercent: -sy * 100, boxShadow: '0 0 0 rgba(0,0,0,0)' }, { xPercent: 0, yPercent: 0, boxShadow: '0 0 ' + (U * 9) + 'px rgba(0,0,0,0.38)', duration: d, ease: o.ease || 'mo.inOut' }, 0);
          if (a) sub.set(a, { filter: 'none' }, d);
          break;
        case 'blur':
          win(at + d * 0.75, at + d * 0.25);
          if (a) sub.fromTo(a, { filter: 'blur(0px)', autoAlpha: 1, scale: 1 }, { filter: 'blur(' + (U * 3) + 'px)', autoAlpha: 0, scale: 1.04, duration: d * 0.75, ease: 'power2.in' }, 0);
          if (b) { sub.fromTo(b, { filter: 'blur(' + (U * 3) + 'px)', autoAlpha: 0, scale: 0.97 }, { filter: 'blur(0px)', autoAlpha: 1, scale: 1, duration: d * 0.75, ease: 'mo.out' }, d * 0.25); sub.set(b, { filter: 'none' }, d); }
          break;
        case 'flash': {
          win(mid, mid);
          var fl = h('div', 'mo-flash', stage); fl.setAttribute('data-mo-ignore', ''); fl.style.background = o.color ? (ACCENTS[o.color] || o.color) : '#FFFFFF';
          sceneRec(fl).w = [[at, snap(at + d)]];
          sub.fromTo(fl, { opacity: 0 }, { opacity: 1, duration: d * 0.45, ease: 'power2.in', immediateRender: false }, 0).to(fl, { opacity: 0, duration: d * 0.55, ease: 'power2.out' }, d * 0.45);
          if (a) sub.to(a, { scale: 1.06, duration: d * 0.5, ease: 'power2.in' }, 0);
          if (b) sub.fromTo(b, { scale: 1.07 }, { scale: 1, duration: d * 0.9, ease: 'mo.out' }, d * 0.45);
          break;
        }
        case 'leak':
          win(at + d * 0.7, at + d * 0.3);
          if (a) sub.to(a, { autoAlpha: 0, duration: d * 0.5, ease: 'power1.inOut' }, d * 0.2);
          if (b) sub.fromTo(b, { autoAlpha: 0 }, { autoAlpha: 1, duration: d * 0.5, ease: 'power1.inOut' }, d * 0.3);
          M.leak({ duration: d * 1.2, intensity: o.intensity, color: o.color }, Math.max(0, at - d * 0.08));
          break;
        case 'clock':
          win(at + d, at);
          if (b) {
            var mk = 'conic-gradient(from 0deg at ' + (o.x || '50%') + ' ' + (o.y || '50%') + ', #000 calc(var(--clk) - 0.6deg), transparent var(--clk))';
            sub.set(b, { '--clk': '0deg', webkitMaskImage: mk, maskImage: mk }, 0).fromTo(b, { '--clk': '0deg' }, { '--clk': '361deg', duration: d, ease: o.ease || 'mo.inOut', immediateRender: false }, 0).set(b, { webkitMaskImage: 'none', maskImage: 'none' }, d);
          }
          if (a) sub.to(a, { scale: 1.03, duration: d, ease: 'power1.in' }, 0);
          break;
        case 'blinds':
          win(at + d, at);
          if (b) {
            var per = 100 / (o.count || 7), mkb = 'repeating-linear-gradient(' + (o.angle == null ? 90 : o.angle) + 'deg, #000 0 calc(var(--bl) * ' + per.toFixed(3) + '%), transparent calc(var(--bl) * ' + per.toFixed(3) + '%) ' + per.toFixed(3) + '%)';
            sub.set(b, { '--bl': 0, webkitMaskImage: mkb, maskImage: mkb }, 0).fromTo(b, { '--bl': 0 }, { '--bl': 1.002, duration: d, ease: o.ease || 'mo.inOut', immediateRender: false }, 0).set(b, { webkitMaskImage: 'none', maskImage: 'none' }, d);
          }
          if (a) sub.to(a, { scale: 1.03, duration: d, ease: 'power1.in' }, 0);
          break;
        case 'warp': {
          win(at + d * 0.62, at + d * 0.38);
          var wid = 'mo-warp-' + (++filterSeq), turb = '<feTurbulence type="fractalNoise" baseFrequency="' + (o.freq || 0.008) + ' ' + (o.freq2 || 0.016) + '" numOctaves="2" seed="' + (o.seed || 7) + '"/>', amt = o.amount || U * 24;
          var fa = filterEl(wid + 'a', turb + '<feDisplacementMap in="SourceGraphic" scale="0" xChannelSelector="R" yChannelSelector="G"/>'), fb = filterEl(wid + 'b', turb + '<feDisplacementMap in="SourceGraphic" scale="' + amt + '" xChannelSelector="R" yChannelSelector="G"/>');
          if (a) sub.set(a, { filter: 'url(#' + wid + 'a)' }, 0).to(fa.lastChild, { attr: { scale: amt }, duration: d * 0.62, ease: 'power2.in' }, 0).to(a, { autoAlpha: 0, duration: d * 0.3, ease: 'power1.in' }, d * 0.32);
          if (b) sub.set(b, { filter: 'url(#' + wid + 'b)' }, d * 0.38).fromTo(b, { autoAlpha: 0 }, { autoAlpha: 1, duration: d * 0.3, ease: 'power1.out', immediateRender: false }, d * 0.38).fromTo(fb.lastChild, { attr: { scale: amt } }, { attr: { scale: 0 }, duration: d * 0.62, ease: 'mo.out', immediateRender: false }, d * 0.38).set(b, { filter: 'none' }, d);
          break;
        }
        case 'glitch': {
          win(mid, mid);
          var gid = 'mo-glitch-' + (++filterSeq), gf = filterEl(gid, '<feTurbulence type="turbulence" baseFrequency="0.00001 ' + (o.freq || 0.08) + '" numOctaves="1" seed="1" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="B" result="d"/><feColorMatrix in="d" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/><feOffset in="r" dx="0" dy="0" result="ro"/><feColorMatrix in="d" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb"/><feBlend in="ro" in2="gb" mode="screen"/>');
          var gT = gf.querySelector('feTurbulence'), gD = gf.querySelector('feDisplacementMap'), gO = gf.querySelector('feOffset'), g0 = at, g1 = at + d, amp = o.amount || U * 9;
          appliers.push(function (t, f) {
            var on = t >= g0 - 1e-6 && t < g1 - 1e-6, env = on ? Math.sin(Math.PI * clamp((t - g0) / d, 0, 1)) : 0;
            [a, b].forEach(function (el) { if (!el) return; var want = on ? 'url(#' + gid + ')' : ''; if (el._moGl !== want) { el.style.filter = want; el._moGl = want; } });
            if (!on) return;
            gT.setAttribute('seed', String(1 + (f % 97)));
            gD.setAttribute('scale', (env * amp * (0.35 + hash2(f, 5))).toFixed(1));
            gO.setAttribute('dx', ((hash2(f, 9) - 0.5) * env * U * 2.4).toFixed(1));
          });
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
    // exits move from wherever the element already is (an element parked at y −400 fades up 2u, not 378 px)
    function rel(v) { v = +v || 0; return v < 0 ? '-=' + (-v) : '+=' + v; }
    var EXITS = {
      rise: function (els, o) { var s = split(els, { by: 'lines' }); return gsap.to(s.lines, { yPercent: -118, duration: o.duration || 0.55, ease: o.ease || 'mo.in', stagger: o.stagger == null ? 0.05 : o.stagger }); },
      words: function (els, o) { var s = split(els, { by: 'words' }); return gsap.to(s.words, { yPercent: -118, duration: o.duration || 0.5, ease: o.ease || 'mo.in', stagger: o.stagger == null ? 0.03 : o.stagger }); },
      chars: function (els, o) { var s = split(els, { by: 'chars' }); return gsap.to(s.chars, { yPercent: -122, duration: o.duration || 0.45, ease: o.ease || 'mo.in', stagger: o.stagger == null ? 0.014 : o.stagger }); },
      fade: function (els, o) { return gsap.to(els, { autoAlpha: 0, y: rel(o.y == null ? -U * 2 : o.y), duration: o.duration || 0.4, ease: o.ease || 'mo.in', stagger: o.stagger == null ? 0.04 : o.stagger }); },
      blur: function (els, o) { return gsap.to(els, { autoAlpha: 0, filter: 'blur(' + (o.blur || U * 1.6) + 'px)', scale: o.scale || 0.98, duration: o.duration || 0.5, ease: o.ease || 'mo.in', stagger: o.stagger || 0.04 }); },
      pop: function (els, o) { return gsap.to(els, { autoAlpha: 0, scale: o.scale || 0.8, duration: o.duration || 0.3, ease: o.ease || 'mo.in', stagger: o.stagger || 0.03 }); },
      wipe: function (els, o) { return gsap.to(els, { clipPath: (o.dir || 'right') === 'right' ? 'inset(-10% -2% -10% 100%)' : 'inset(-10% 100% -10% -2%)', duration: o.duration || 0.55, ease: o.ease || 'mo.inOut', stagger: o.stagger || 0.04 }); },
      drop: function (els, o) { return gsap.to(els, { autoAlpha: 0, y: rel(o.y == null ? U * 5 : o.y), duration: o.duration || 0.4, ease: o.ease || 'mo.in', stagger: o.stagger || 0.04 }); }
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
      if (o.sfx) {
        var kname = o.sfx === true ? 'key' : String(o.sfx), t0k = tw.startTime(), kr = rng(hashStr(text) + 3);
        for (i = 1; i <= n; i++) M.sfx(kname, { volume: (o.sfxVolume || 0.7) * (0.75 + kr() * 0.35), pitch: 0.9 + kr() * 0.2 }, t0k + w[i] * total);
      }
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
      if (o.sfx) {
        var tname = o.sfx === true ? 'tick' : String(o.sfx), t0c = tw.startTime(), lastS = show(from), lastT = -1, ticks = 0;
        for (var q = 1; q <= 240 && ticks < 30; q++) { var tq = t0c + dur * q / 240, sq = show(from + (o.to - from) * easeFn(q / 240)); if (sq !== lastS && tq - lastT >= 1 / 14) { M.sfx(tname, { volume: (o.sfxVolume || 0.5) }, tq); lastT = tq; ticks++; } lastS = sq; }
      }
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
      var dur = o.scramble === true ? 0.4 : (o.scramble || 0), set = o.chars || SCRAMBLE, soft = o.blur ? (o.blur === true ? 0.16 : +o.blur) : 0;
      toArray(target, stage).forEach(function (el) {
        var orig = el.textContent, seed = hashStr(orig + list.length);
        appliers.push(function (t, f) {
          var cur = null; for (var i = 0; i < list.length; i++) if (t >= list[i][0] - 1e-6) cur = list[i];
          var s = cur ? cur[1] : orig;
          if (cur && dur > 0 && t < cur[0] + dur) { var g = graphemes(s), edge = ((t - cur[0]) / dur) * (g.length + 2), out = ''; for (var k = 0; k < g.length; k++) out += (g[k] === ' ' || k < edge - 1) ? g[k] : set[Math.floor(hash2(k * 131 + Math.floor(f / 2), seed) * set.length)]; s = out; }
          if (el._s !== s) { el.textContent = s; el._s = s; }
          if (soft) { var dt = cur ? t - cur[0] : 9, bl = dt >= 0 && dt < soft ? (1 - dt / soft) : 0; el.style.filter = bl > 0.02 ? 'blur(' + (bl * U * 0.9).toFixed(2) + 'px)' : ''; el.style.opacity = bl > 0.02 ? (1 - bl * 0.5).toFixed(3) : ''; }
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
      if (cam._float) {
        // in a data-loop piece the float repeats a whole number of times per loop (period D/k, whole multiples) so the seam is invisible
        var fl = cam._float, loopy = stage.hasAttribute('data-loop'), per = loopy ? D / Math.max(1, Math.round(D / fl.per)) : fl.per, mm = loopy ? [1, 1, 1, 1] : [0.9, 1, 0.8, 0.65], ph = (t / per) * TAU;
        rx += Math.sin(ph * mm[0] + 0.7) * fl.rot * 0.6; ry += Math.sin(ph * mm[1] + 2.1) * fl.rot; x += Math.sin(ph * mm[2]) * fl.pos; y += Math.cos(ph * mm[3] + 1) * fl.pos;
      }
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
      // several follows on one element play in order: the one that started last owns the element (before the first, the first's start)
      var rec = { tw: tw, pr: pr, path: path, len: len, k: k, ox: ox, oy: oy, rotate: !!o.rotate };
      if (!el._moFollow) {
        el._moFollow = [];
        appliers.push(function (t) {
          var list = el._moFollow, f = list[0];
          for (var i = 0; i < list.length; i++) if (t >= list[i].tw.startTime() - 1e-6) f = list[i];
          var d = clamp(f.pr.p, 0, 1) * f.len, pt = f.path.getPointAtLength(d), tr = 'translate3d(' + (f.ox + pt.x * f.k).toFixed(2) + 'px,' + (f.oy + pt.y * f.k).toFixed(2) + 'px,0)';
          if (f.rotate) { var q = f.path.getPointAtLength(Math.min(f.len, d + 1)), q0 = f.path.getPointAtLength(Math.max(0, d - 1)); tr += ' rotate(' + (Math.atan2(q.y - q0.y, q.x - q0.x) * 180 / Math.PI).toFixed(2) + 'deg)'; }
          el.style.translate = 'none'; el.style.transform = tr;
        });
      }
      el._moFollow.push(rec);
      el._moFollow.sort(function (a, b) { return a.tw.startTime() - b.tw.startTime(); });
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

    // ═══════════════════════════════ v2 — sound · captions · declarative markup · springs · shapes · effects · charts · adapters ═══════════════════════════════
    var A = Motion._assets || { audio: {}, text: {} };
    var LIGHT = getComputedStyle(stage).colorScheme === 'light';
    M._ready = [];
    /** wait(promise) — hold the first frame until something asynchronous (a 3D scene, an animation file) is ready. */
    M.wait = function (p) { var q = Promise.resolve(p).catch(function (e) { fail('wait: ' + (e && e.message || e)); }); M._ready.push(q); return q; };

    // ── time tokens: 1.2 · '1.2s' · 'b8' (beat 8 of the music, or of data-bpm on the stage) · a timeline label ──
    function tok(v) {
      if (v == null || v === '') return null;
      if (typeof v === 'number') return v;
      var s = String(v).trim(), m = /^b(-?\d+(?:\.\d+)?)$/i.exec(s);
      if (m) return M.grid()(+m[1]);
      if (/^-?\d+(?:\.\d+)?s?$/.test(s)) return parseFloat(s);
      if (tl.labels[s] != null) return tl.labels[s];
      var n = parseFloat(s); return isFinite(n) ? n : null;
    }
    M.tok = tok;

    // ── sound: the page plans music, voice and effects; the renderer mixes them (lib/audio.mjs) ──
    var tracks = [], effects = [];
    function audioKey(src) { return String(src).split(/[?#]/)[0].replace(/^\.?\//, '').replace(/[^A-Za-z0-9._-]+/g, '_'); }
    Motion.audioKey = audioKey;
    function env(arr, rate, ft) {
      if (!arr || !arr.length || !(ft >= 0)) return 0;
      var x = ft * rate, i = Math.floor(x), f = x - i;
      if (i >= arr.length - 1) return i === arr.length - 1 ? arr[i] / 255 : 0;
      return (arr[i] + (arr[i + 1] - arr[i]) * f) / 255;
    }
    function trackView(tr) {
      var a = A.audio[audioKey(tr.src)] || null, per = a && tr.loop ? Math.max(0.5, a.duration - tr.from) : Infinity;
      function live(t) { return t >= tr.at - 1e-6 && (tr.end == null || t <= tr.end + 1e-6) && (!a || tr.loop || tr.from + (t - tr.at) <= a.duration); }
      function ft(t) { var x = t - tr.at; if (per < Infinity) x = ((x % per) + per) % per; return tr.from + x; }
      function times(list) {
        var out = []; if (!a || !list) return out;
        for (var rep = 0; rep < 256; rep++) {
          var base = tr.at + rep * (per < Infinity ? per : 0);
          for (var i = 0; i < list.length; i++) {
            var x = list[i] - tr.from; if (x < -1e-6 || (per < Infinity && x >= per)) continue;
            var t = base + x; if (t > D + 1e-6 || (tr.end != null && t > tr.end + 1e-6)) break;
            out.push(snap(t));
          }
          if (per === Infinity || base + per > D) break;
        }
        return out;
      }
      var beats = times(a && a.beats), downs = times(a && a.downbeats), onsets = times(a && a.onsets);
      var bpm = a && a.bpm ? a.bpm : (tr.bpm || 0), period = bpm ? 60 / bpm : 0.5;
      return {
        src: tr.src, at: tr.at, analysed: !!a, duration: a ? a.duration : null, bpm: bpm,
        beats: beats, downbeats: downs, onsets: onsets, track: tr,
        /** loudness 0–1 at composition time t (measured from the file) */
        level: function (t) { return live(t) ? env(a && a.level, a ? a.rate : 100, ft(t)) : 0; },
        /** bass 0–1 (kick drums, sub) */
        low: function (t) { return live(t) ? env(a && a.low, a ? a.rate : 100, ft(t)) : 0; },
        /** treble 0–1 (hats, sparkle) */
        high: function (t) { return live(t) ? env(a && a.high, a ? a.rate : 100, ft(t)) : 0; },
        /** beat(n): time of beat n (0-based). Fractional n interpolates; past the analysed beats the tempo carries on. */
        beat: function (n) {
          if (!beats.length) return snap(tr.at + n * period);
          var i = Math.floor(n), f = n - i;
          if (i < 0) return snap(beats[0] + n * period);
          if (i >= beats.length - 1) return snap(beats[beats.length - 1] + (n - (beats.length - 1)) * period);
          return snap(beats[i] + (beats[i + 1] - beats[i]) * f);
        },
        /** pulse(t, decay): 1 exactly on a beat, falling to 0 before the next — beat-locked flashes, bumps, glows. */
        pulse: function (t, decay) { var p = null; for (var i = 0; i < beats.length && beats[i] <= t + 1e-6; i++) p = beats[i]; return p == null ? 0 : Math.exp(-(t - p) / (decay || 0.12)); }
      };
    }
    /**
     * audio(src, { at, from, end, volume, fadeIn, fadeOut, role: 'music' | 'voice' | 'sfx', duck, loop }) → track view
     * The view reads the file's own analysis: level(t) · low(t) · high(t) · beats · downbeats · onsets · bpm · beat(n) · pulse(t).
     * audio('#bgm') returns the view of an <audio> element declared in the markup.
     */
    M.audio = function (src, o) {
      if (src && (src.nodeType || /^#/.test(String(src)))) {
        var el = one(src, stage) || one(src, doc);
        if (el && el._moTrack) return el._moTrack.view;
        fail('audio: ' + src + ' is not a declared <audio> track'); return trackView({ src: '', at: 0, from: 0 });
      }
      if (!o) { for (var q = 0; q < tracks.length; q++) if (tracks[q].src === String(src)) return tracks[q].view; }   // the same file declared in the markup
      o = o || {};
      var role = o.role || 'music';
      var tr = { src: String(src), at: snap(tok(o.at) || 0), from: +o.from || 0, end: o.end == null ? null : snap(tok(o.end)), volume: o.volume == null ? 1 : +o.volume,
        fadeIn: o.fadeIn == null ? 0 : +o.fadeIn, fadeOut: o.fadeOut == null ? (role === 'music' ? 0.8 : 0) : +o.fadeOut, role: role,
        duck: o.duck == null ? (role === 'music' ? 0.55 : 0) : +o.duck, loop: !!o.loop, bpm: +o.bpm || 0 };
      tracks.push(tr); tr.view = trackView(tr);
      return tr.view;
    };
    /** music() — the first music track (or null). */
    M.music = function () { for (var i = 0; i < tracks.length; i++) if (tracks[i].role === 'music') return tracks[i].view; return null; };
    /** grid() — the beat grid everything can lock to: the music's detected beats, else data-bpm on the stage (default 120). */
    M.grid = function () {
      var m = M.music();
      if (m && m.beats.length > 1) { var g = function (n) { return m.beat(n); }; g.len = 60 / (m.bpm || 120); g.bpm = m.bpm; return g; }
      return M.beats(+stage.dataset.bpm || 120, +stage.dataset.beatOffset || 0);
    };
    var SFX_DEFAULT = {
      reveal: { pop: 'pop', slam: 'impact', drop: 'thud', lift: 'swish', wipe: 'swipe', grow: 'swipe', draw: 'swish', rise: 'swish', words: 'swish', chars: 'swish', fade: 'swish', blur: 'swish' },
      exit: 'swish', press: 'click', click: 'click', tap: 'tap', type: 'key', count: 'tick', highlight: 'swipe', pulse: 'thud',
      transition: { push: 'whoosh', slide: 'whoosh', whip: 'whip', wipe: 'swipe', zoom: 'whoosh', iris: 'swish', flip: 'swish', fade: null, cut: null, flash: 'impact', leak: 'swell', clock: 'swipe', blinds: 'swipe', warp: 'whoosh', glitch: 'glitch', blur: 'swish', split: 'whoosh' }
    };
    function sfxFor(o, kind, sub) {
      if (!o || !o.sfx) return null;
      if (o.sfx !== true) return String(o.sfx);
      var d = SFX_DEFAULT[kind]; return d && typeof d === 'object' ? (d[sub] || null) : (d || null);
    }
    M._sfxFor = sfxFor;
    /**
     * sfx(name, { volume, pitch, pan }, at) — one sound effect. Built-in library (synthesised, no files needed):
     * click tap tick key pop swish whoosh whip swipe riser swell impact thud drop ding success error shutter glitch sparkle.
     * A file name ('boom.wav') next to the composition works too.
     */
    M.sfx = function (name, a1, a2) {
      var fx = flex(a1, a2), o = fx.o, t = tok(fx.at);
      if (!name || t == null) return M;
      effects.push({ name: String(name), at: snap(t), volume: o.volume == null ? 1 : +o.volume, pitch: +o.pitch || 1, pan: +o.pan || 0 });
      return M;
    };
    M._plan = function () {
      return {
        tracks: tracks.map(function (t) { return { src: t.src, at: t.at, from: t.from, end: t.end, volume: t.volume, fadeIn: t.fadeIn, fadeOut: t.fadeOut, role: t.role, duck: t.duck, loop: t.loop }; }),
        sfx: effects.slice().sort(function (a, b) { return a.at - b.at; }), duration: D, fps: fps
      };
    };

    // ── captions: word-timed subtitles from SRT / VTT / JSON (`motion captions align | plan` writes them) ──
    function ts(x) { x = String(x).trim().split(/\s+/)[0].replace(',', '.'); var p = x.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : +p[0]; }
    function parseCues(src) {
      if (Array.isArray(src)) return src;
      if (src && typeof src === 'object') return src.cues || [];
      var s = String(src || '').replace(/\r/g, '').replace(/^﻿/, '').trim();
      if (/^[\[{]/.test(s)) { var j = JSON.parse(s); return Array.isArray(j) ? j : (j.cues || []); }
      var out = [];
      s.split(/\n\s*\n/).forEach(function (block) {
        var lines = block.split('\n').filter(function (l) { return l.trim() && !/^WEBVTT/.test(l) && !/^NOTE\b/.test(l); });
        var i = -1; for (var k = 0; k < lines.length; k++) if (/-->/.test(lines[k])) { i = k; break; }
        if (i < 0) return;
        var p = lines[i].split('-->'), text = lines.slice(i + 1).join('\n').replace(/<[^>]+>/g, '').trim();
        if (text) out.push({ start: ts(p[0]), end: ts(p[1]), text: text });
      });
      return out;
    }
    function syllables(w) { var n = 0; for (var i = 0; i < w.length; i++) { var c = w.charCodeAt(i); if (c >= 0xAC00 && c <= 0xD7A3) n += 1; else if (/[A-Za-z]/.test(w[i])) n += 0.34; else if (/[0-9]/.test(w[i])) n += 0.8; } return Math.max(0.6, n); }
    Motion.syllables = syllables;
    function timeWords(c, off) {
      if (c.words && c.words.length) return c.words.map(function (w) { return { w: String(w.w || w.word || w.text), t: (+(w.t != null ? w.t : w.start)) + off, e: (+(w.e != null ? w.e : w.end)) + off }; });
      var ws = String(c.text).split(/\s+/).filter(Boolean), wt = ws.map(function (w) { return syllables(w) + (/[,.!?…]$/.test(w) ? 0.8 : 0); });
      var tot = wt.reduce(function (s, v) { return s + v; }, 0) || 1, t = c.start, dur = c.end - c.start;
      return ws.map(function (w, i) { var a = t; t += dur * wt[i] / tot; return { w: w, t: a, e: t }; });
    }
    /**
     * captions(target, source, { style: 'karaoke' | 'pop' | 'box' | 'line', offset, linger }) — subtitles that follow the voice word by word.
     * source: SRT/VTT/JSON text, a file next to the composition ('voice.srt'), or [{ start, end, text, words? }].
     */
    M.captions = function (target, source, o) {
      o = o || {};
      var box = one(target, stage); if (!box) { fail('captions: no element ' + target); return M; }
      if (typeof source === 'string' && /\.(srt|vtt|json)$/i.test(source.trim())) {
        var txt = A.text[audioKey(source.trim())];
        if (txt == null) { fail('captions: ' + source + ' was not loaded — keep the file next to the composition and run it through the motion CLI'); return M; }
        source = txt;
      }
      var off = +o.offset || 0, linger = o.linger == null ? 0.3 : +o.linger, style = o.style || 'karaoke';
      var cues = parseCues(source).map(function (c) { return { start: +c.start + off, end: +c.end + off, text: String(c.text), words: c.words }; }).sort(function (a, b) { return a.start - b.start; });
      box.classList.add('mo-captions', 'mo-cap-' + style);
      var built = cues.map(function (c, ci) {
        var line = h('div', 'mo-cap-line', box); line.style.visibility = 'hidden';
        var ws = timeWords(c, c.words ? off : 0).map(function (w, wi) {
          if (wi) line.appendChild(doc.createTextNode(' '));
          var s = h('span', 'mo-cap-w', line); s.textContent = w.w; return { el: s, t: w.t, e: w.e };
        });
        var next = cues[ci + 1], end = next && next.start - c.end < linger + 0.2 ? next.start : c.end + linger;
        return { line: line, words: ws, start: snap(c.start), end: snap(end) };
      });
      appliers.push(function (t) {
        var act = null, i;
        for (i = 0; i < built.length; i++) if (t >= built[i].start - 1e-6 && t < built[i].end - 1e-6) act = built[i];
        for (i = 0; i < built.length; i++) { var b = built[i], on = b === act; if (b._on !== on) { b.line.style.visibility = on ? 'inherit' : 'hidden'; b._on = on; } }
        if (!act) return;
        var k = clamp((t - act.start) / 0.18, 0, 1), e = 1 - Math.pow(1 - k, 3);
        act.line.style.opacity = e.toFixed(3); act.line.style.translate = '0 ' + ((1 - e) * 0.3).toFixed(3) + 'em';
        act.words.forEach(function (w) {
          var st = t < w.t - 1e-6 ? 0 : t < w.e - 1e-6 ? 1 : 2;
          if (w._st !== st) { w.el.className = 'mo-cap-w' + (st === 1 ? ' now' : st === 2 ? ' done' : ''); w._st = st; }
          if (style === 'pop') {
            var p = clamp((t - w.t) / 0.3, 0, 1), s = p <= 0 ? 0 : 1 - Math.exp(-6.5 * p) * Math.cos(10 * p);
            w.el.style.opacity = p > 0 ? '1' : '0'; w.el.style.scale = p > 0 ? (0.55 + 0.45 * s).toFixed(4) : '0.55';
          }
        });
      });
      M._captions = (M._captions || []).concat(built.map(function (b) { return { start: b.start, end: b.end, words: b.words.map(function (w) { return [+(+w.t).toFixed(3), +(+w.e).toFixed(3)]; }) }; }));
      return M;
    };

    // ── springs: closed-form, a pure function of time ──
    var SPRINGS = { gentle: { stiffness: 120, damping: 20 }, smooth: { stiffness: 170, damping: 26 }, snappy: { stiffness: 380, damping: 32 }, bouncy: { stiffness: 260, damping: 15 }, heavy: { stiffness: 90, damping: 19, mass: 2 }, stiff: { stiffness: 600, damping: 48 } };
    var springCache = {};
    /** Unit step response x(t) of a damped spring (0 → 1). */
    function springFn(cfg) {
      cfg = typeof cfg === 'string' ? (SPRINGS[cfg] || SPRINGS.smooth) : (cfg || SPRINGS.smooth);
      var k = cfg.stiffness || 170, c = cfg.damping == null ? 26 : cfg.damping, m = cfg.mass || 1, v0 = cfg.velocity || 0;
      var key = [k, c, m, v0].join('_'); if (springCache[key]) return springCache[key];
      var w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m)), f;
      if (z < 0.9999) { var wd = w0 * Math.sqrt(1 - z * z); f = function (t) { return t <= 0 ? 0 : 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0 - v0) / wd) * Math.sin(wd * t)); }; }
      else if (z <= 1.0001) f = function (t) { return t <= 0 ? 0 : 1 - Math.exp(-w0 * t) * (1 + (w0 - v0) * t); };
      else { var r1 = -w0 * (z - Math.sqrt(z * z - 1)), r2 = -w0 * (z + Math.sqrt(z * z - 1)), Ac = (v0 + r2) / (r1 - r2), Bc = -1 - Ac; f = function (t) { return t <= 0 ? 0 : 1 + Ac * Math.exp(r1 * t) + Bc * Math.exp(r2 * t); }; }
      var T = 0; for (var t = 0; t < 12; t += 1 / 240) if (Math.abs(f(t) - 1) > 0.002) T = t;
      var out = { f: f, duration: Math.min(12, T + 1 / 240), key: key };
      springCache[key] = out; return out;
    }
    /**
     * spring('snappy' | { stiffness, damping, mass, velocity }) → { ease, duration } — physical motion for any tween:
     * tl.to('#card', { y: 0, ...M.spring('bouncy') }, 1.2). Presets: gentle smooth snappy bouncy heavy stiff.
     */
    M.spring = function (cfg) {
      var s = springFn(cfg), name = 'mo.sp_' + s.key.replace(/\./g, 'p');
      if (!s.registered) { gsap.registerEase(name, function (p) { return p >= 1 ? 1 : s.f(p * s.duration); }); s.registered = true; }
      return { ease: name, duration: +s.duration.toFixed(3) };
    };
    /**
     * springValue([[t0, v0], [t1, v1], …], cfg) → v(t). Each change of target starts a new spring from wherever the value is,
     * summed (superposition) — retargeting mid-flight stays smooth. Times may be beat tokens ('b4').
     */
    // keys: [[t, value], [t, value, 'bouncy'], …] — a third item sets the spring for the move into that key
    M.springValue = function (keys, cfg) {
      var s = springFn(cfg), ks = keys.map(function (k) { return [tok(k[0]) || 0, +k[1], k[2] != null ? springFn(k[2]) : s]; }).sort(function (a, b) { return a[0] - b[0]; });
      return function (t) { if (!ks.length) return 0; var v = ks[0][1]; for (var i = 1; i < ks.length; i++) { if (t < ks[i][0]) break; v += (ks[i][1] - ks[i - 1][1]) * ks[i][2].f(t - ks[i][0]); } return v; };
    };
    /** springs(target, { x: [[0, 0], [1.2, 320]], scale: [[0, 1], [2, 1.1]] }, cfg) — drive properties with spring tracks. */
    M.springs = function (target, props, cfg) {
      var els = toArray(target, stage), fns = {};
      Object.keys(props).forEach(function (p) { fns[p] = M.springValue(props[p], cfg); });
      appliers.push(function (t) { var v = {}; for (var p in fns) v[p] = fns[p](t); gsap.set(els, v); });
      return M;
    };

    // ── shapes & morphing (MorphSVG) ──
    function pts2d(list, closed) { return 'M' + list.map(function (p) { return p[0].toFixed(2) + ' ' + p[1].toFixed(2); }).join(' L') + (closed ? ' Z' : ''); }
    function smoothClosed(p) {
      var n = p.length, d = 'M' + p[0][0].toFixed(2) + ' ' + p[0][1].toFixed(2);
      for (var i = 0; i < n; i++) {
        var p0 = p[(i - 1 + n) % n], p1 = p[i], p2 = p[(i + 1) % n], p3 = p[(i + 2) % n];
        d += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(2) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(2) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(2) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(2) + ' ' + p2[0].toFixed(2) + ' ' + p2[1].toFixed(2);
      }
      return d + ' Z';
    }
    /**
     * shape(kind, { w, h, r, n, inner, seed, wobble }) → SVG path data in a w×h box (default 100×100).
     * kinds: circle · rect (rounded with r) · squircle · polygon (n) · star (n, inner) · heart · blob (seed, wobble, n) · drop · arrow · plus · check
     */
    // shape({ x, y }) moves the outline; shape({ box: 100 }) centres a w×h shape in a 100×100 (or [w, h]) box — a circle morphing into a pill stays put
    M.shape = function (kind, o) {
      o = o || {};
      var d = shapeRaw(kind, o), w = o.w || o.size || 100, hh = o.h || o.size || 100;
      var bx = o.box == null ? null : Array.isArray(o.box) ? o.box : [o.box, o.box];
      var tx = (o.x || 0) + (bx ? (bx[0] - w) / 2 : 0), ty = (o.y || 0) + (bx ? (bx[1] - hh) / 2 : 0);
      var P = global.MorphSVGPlugin || global.MotionPathPlugin;
      if (!(tx || ty) || !P || !P.stringToRawPath) return d;
      var raw = P.stringToRawPath(d);
      raw.forEach(function (seg) { for (var k = 0; k < seg.length - 1; k += 2) { seg[k] += tx; seg[k + 1] += ty; } });
      return P.rawPathToString(raw);
    };
    function shapeRaw(kind, o) {
      var w = o.w || o.size || 100, hh = o.h || o.size || 100, cx = w / 2, cy = hh / 2, R = Math.min(w, hh) / 2, i, list = [];
      function poly(n, rf, rot) { var out = []; for (var k = 0; k < n; k++) { var a = (rot || -Math.PI / 2) + k * TAU / n, r = rf(k); out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return out; }
      switch (kind) {
        case 'circle': return 'M' + (cx + R) + ' ' + cy + ' A' + R + ' ' + R + ' 0 1 1 ' + (cx - R) + ' ' + cy + ' A' + R + ' ' + R + ' 0 1 1 ' + (cx + R) + ' ' + cy + ' Z';
        case 'rect': {
          var r = Math.min(o.r == null ? 0 : o.r, w / 2, hh / 2);
          return 'M' + r + ' 0 H' + (w - r) + (r ? ' A' + r + ' ' + r + ' 0 0 1 ' + w + ' ' + r : '') + ' V' + (hh - r) + (r ? ' A' + r + ' ' + r + ' 0 0 1 ' + (w - r) + ' ' + hh : '') + ' H' + r + (r ? ' A' + r + ' ' + r + ' 0 0 1 0 ' + (hh - r) : '') + ' V' + r + (r ? ' A' + r + ' ' + r + ' 0 0 1 ' + r + ' 0' : '') + ' Z';
        }
        case 'squircle': { var N = 64; for (i = 0; i < N; i++) { var a = i / N * TAU, c = Math.cos(a), s = Math.sin(a); list.push([cx + Math.sign(c) * Math.pow(Math.abs(c), 0.5) * w / 2, cy + Math.sign(s) * Math.pow(Math.abs(s), 0.5) * hh / 2]); } return smoothClosed(list); }
        case 'polygon': return pts2d(poly(o.n || 6, function () { return R; }), true);
        case 'star': { var inner = o.inner || 0.46; return pts2d(poly((o.n || 5) * 2, function (k) { return k % 2 ? R * inner : R; }), true); }
        case 'heart': return 'M' + cx + ' ' + (hh * 0.92) + ' C' + (w * 0.18) + ' ' + (hh * 0.68) + ' ' + (w * -0.02) + ' ' + (hh * 0.42) + ' ' + (w * 0.08) + ' ' + (hh * 0.22) + ' C' + (w * 0.2) + ' ' + (hh * 0.02) + ' ' + (w * 0.44) + ' ' + (hh * 0.06) + ' ' + cx + ' ' + (hh * 0.26) + ' C' + (w * 0.56) + ' ' + (hh * 0.06) + ' ' + (w * 0.8) + ' ' + (hh * 0.02) + ' ' + (w * 0.92) + ' ' + (hh * 0.22) + ' C' + (w * 1.02) + ' ' + (hh * 0.42) + ' ' + (w * 0.82) + ' ' + (hh * 0.68) + ' ' + cx + ' ' + (hh * 0.92) + ' Z';
        case 'blob': { var rr = rng(o.seed || 3), n = o.n || 7, wob = o.wobble == null ? 0.22 : o.wobble, rad = []; for (i = 0; i < n; i++) rad.push(R * (1 - wob + rr() * wob * 1.6) * 0.92); return smoothClosed(poly(n, function (k) { return rad[k]; })); }
        case 'drop': return 'M' + cx + ' ' + (hh * 0.02) + ' C' + (w * 0.62) + ' ' + (hh * 0.22) + ' ' + (w * 0.88) + ' ' + (hh * 0.46) + ' ' + (w * 0.88) + ' ' + (hh * 0.64) + ' A' + (w * 0.38) + ' ' + (w * 0.38) + ' 0 1 1 ' + (w * 0.12) + ' ' + (hh * 0.64) + ' C' + (w * 0.12) + ' ' + (hh * 0.46) + ' ' + (w * 0.38) + ' ' + (hh * 0.22) + ' ' + cx + ' ' + (hh * 0.02) + ' Z';
        case 'arrow': return 'M' + (w * 0.1) + ' ' + cy + ' H' + (w * 0.88) + ' M' + (w * 0.6) + ' ' + (hh * 0.24) + ' L' + (w * 0.9) + ' ' + cy + ' L' + (w * 0.6) + ' ' + (hh * 0.76);
        case 'plus': return 'M' + cx + ' ' + (hh * 0.12) + ' V' + (hh * 0.88) + ' M' + (w * 0.12) + ' ' + cy + ' H' + (w * 0.88);
        case 'check': return 'M' + (w * 0.16) + ' ' + (hh * 0.54) + ' L' + (w * 0.4) + ' ' + (hh * 0.76) + ' L' + (w * 0.86) + ' ' + (hh * 0.26);
        default: fail('shape: unknown kind "' + kind + '"'); return shapeRaw('circle', o);
      }
    }
    /**
     * morphPath(path, shapes, { duration, hold, ease, type }, at) — the same outline becomes another shape (or several, one after another).
     * shapes: path data, a shape() result, a selector of another <path>, or an array of them.
     */
    M.morphPath = function (target, shapes, o, at) {
      if (typeof o !== 'object' || o === null) { at = o; o = {}; }
      if (!global.MorphSVGPlugin) { fail('morphPath needs MorphSVGPlugin (run npm install in the skill folder)'); return null; }
      var el = one(target, stage), list = Array.isArray(shapes) ? shapes : [shapes], t0 = tok(at) || 0, d = o.duration || 0.9, hold = o.hold == null ? 0.5 : o.hold, sub = gsap.timeline();
      if (el && el.tagName.toLowerCase() !== 'path') { var conv = global.MorphSVGPlugin.convertToPath(el); el = conv && conv[0]; }
      if (!el) { fail('morphPath: no path ' + target); return null; }
      // default: closed outlines are resampled to the same number of points, turned the same way and lined up at the start that
      // travels least, then blended — no crumpled or lopsided in-betweens. type 'linear' / 'rotational' uses MorphSVG as is.
      var dataOf = function (s) { var e = typeof s === 'string' && /^[#.\[]/.test(s) ? one(s, stage) : s; return typeof e === 'string' ? e : e && e.getAttribute && e.tagName.toLowerCase() === 'path' ? e.getAttribute('d') : null; };
      var ds = [el.getAttribute('d')].concat(list.map(dataOf));
      var outlines = !o.type || o.type === 'points' ? ds.map(outlinePoints) : null;
      if (outlines && outlines.every(Boolean)) {
        var segs = [];
        for (var k = 1; k < outlines.length; k++) segs.push({ a: k === 1 ? outlines[0] : segs[k - 2].b, b: alignOutline(k === 1 ? outlines[0] : segs[k - 2].b, outlines[k]), from: ds[k - 1], to: ds[k], st: { p: 0 }, at: (k - 1) * (d + hold) });
        segs.forEach(function (sg) { sub.fromTo(sg.st, { p: 0 }, { p: 1, duration: d, ease: o.ease || 'mo.inOut', immediateRender: false }, sg.at); });
        var T0 = t0;
        appliers.push(function (t) {
          var cur = null; for (var i = 0; i < segs.length; i++) if (t >= T0 + segs[i].at - 1e-6) cur = segs[i];
          if (!cur) return;
          var p = cur.st.p, s;
          if (p <= 0) s = cur.from; else if (p >= 1) s = cur.to;
          else { var A = cur.a, B = cur.b, pts = new Array(A.length); for (var j = 0; j < A.length; j++) pts[j] = [A[j][0] + (B[j][0] - A[j][0]) * p, A[j][1] + (B[j][1] - A[j][1]) * p]; s = pts2d(pts, true); }
          if (el._moD !== s) { el.setAttribute('d', s); el._moD = s; }
        });
        return tlAt(sub, t0);
      }
      list.forEach(function (s, i) {
        var shape = typeof s === 'string' && /^[#.\[]/.test(s) ? one(s, stage) : s;
        sub.to(el, { morphSVG: { shape: shape, type: o.type === 'rotational' ? 'rotational' : 'linear', map: o.map || 'size' }, duration: d, ease: o.ease || 'mo.inOut' }, i * (d + hold));
      });
      return tlAt(sub, t0);
    };
    // a closed single outline → 180 points evenly spaced along it, clockwise (null for open or multi-part paths)
    var outlineHost = null;
    function outlinePoints(dstr) {
      if (!dstr || (String(dstr).match(/[Mm]/g) || []).length !== 1 || !/[Zz]\s*$/.test(String(dstr).trim())) return null;
      if (!outlineHost) { outlineHost = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); outlineHost.setAttribute('data-mo-ignore', ''); outlineHost.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;visibility:hidden'; stage.appendChild(outlineHost); }
      var p = doc.createElementNS(outlineHost.namespaceURI, 'path'); p.setAttribute('d', dstr); outlineHost.appendChild(p);
      var N = 180, L = p.getTotalLength(), pts = [];
      if (!(L > 0)) { outlineHost.removeChild(p); return null; }
      for (var i = 0; i < N; i++) { var q = p.getPointAtLength(L * i / N); pts.push([q.x, q.y]); }
      outlineHost.removeChild(p);
      var area = 0; for (i = 0; i < N; i++) { var a = pts[i], b = pts[(i + 1) % N]; area += a[0] * b[1] - b[0] * a[1]; }
      return area < 0 ? pts.reverse() : pts;
    }
    // rotate B's starting point so the blend from A travels the least
    function alignOutline(A, B) {
      var N = A.length, best = 0, bestCost = Infinity;
      for (var k = 0; k < N; k += 2) { var c = 0; for (var i = 0; i < N; i += 3) { var b = B[(i + k) % N], dx = b[0] - A[i][0], dy = b[1] - A[i][1]; c += dx * dx + dy * dy; } if (c < bestCost) { bestCost = c; best = k; } }
      var out = new Array(N); for (var j = 0; j < N; j++) out[j] = B[(j + best) % N]; return out;
    }

    // ── effects ──
    /** leak({ color, color2, duration, intensity, from }, at) — a warm light leak washing across the frame (accent moments, film feel). */
    M.leak = function (a1, a2) {
      var fx = flex(a1, a2), o = fx.o, at = tok(fx.at) || 0, d = o.duration || 1.3;
      var el = h('div', 'mo-leak', stage); el.setAttribute('data-mo-ignore', '');
      var c1 = o.color || (LIGHT ? '#FFB36B' : '#FF7A2E'), c2 = o.color2 || (LIGHT ? '#FFD9A8' : '#FFC46B'), c3 = o.color3 || (LIGHT ? '#FF9AA8' : '#FF3D6E');
      el.style.background = 'radial-gradient(42% 62% at 28% 42%, ' + c1 + ' 0%, transparent 70%), radial-gradient(36% 52% at 66% 58%, ' + c2 + ' 0%, transparent 72%), radial-gradient(26% 40% at 48% 26%, ' + c3 + ' 0%, transparent 70%)';
      el.style.mixBlendMode = LIGHT ? 'multiply' : 'screen';
      sceneRec(el).w = [[snap(at), snap(at + d)]];
      var dir = o.from === 'right' ? -1 : 1, peak = o.intensity == null ? (LIGHT ? 0.55 : 0.9) : o.intensity, sub = gsap.timeline();
      sub.fromTo(el, { xPercent: -38 * dir, scale: 1.05, opacity: 0 }, { xPercent: 38 * dir, scale: 1.22, duration: d, ease: 'sine.inOut' }, 0)
        .to(el, { opacity: peak, duration: d * 0.38, ease: 'sine.out' }, 0).to(el, { opacity: 0, duration: d * 0.62, ease: 'sine.in' }, d * 0.38);
      var r = tlAt(sub, at); if (o.sfx) M.sfx(o.sfx === true ? 'swell' : o.sfx, at); return r;
    };
    /** flash({ color, duration, peak }, at) — a flash frame (beat cuts, impacts). */
    M.flash = function (a1, a2) {
      var fx = flex(a1, a2), o = fx.o, at = tok(fx.at) || 0, d = o.duration || 0.4;
      var el = h('div', 'mo-flash', stage); el.setAttribute('data-mo-ignore', '');
      el.style.background = o.color ? (ACCENTS[o.color] || o.color) : (LIGHT ? '#FFFFFF' : '#FFFFFF');
      sceneRec(el).w = [[snap(at), snap(at + d)]];
      var sub = gsap.timeline();
      sub.fromTo(el, { opacity: 0 }, { opacity: o.peak || 0.9, duration: Math.min(0.06, d * 0.2), ease: 'power2.out', immediateRender: false }, 0).to(el, { opacity: 0, duration: d * 0.8, ease: 'power2.out' }, Math.min(0.06, d * 0.2));
      var r = tlAt(sub, at); if (o.sfx) M.sfx(o.sfx === true ? 'impact' : o.sfx, at); return r;
    };
    /** rays({ parent, count, color, alpha, period, x, y }) — slowly turning starburst rays behind a reveal or a celebration. */
    M.rays = function (o) {
      o = o || {};
      var parent = one(o.parent, stage) || one('.mo-bg', stage) || stage, el = h('div', 'mo-rays', parent), n = o.count || 18, step = 360 / n;
      var x = o.x == null ? '50%' : o.x, y = o.y == null ? '50%' : o.y, col = o.color ? (ACCENTS[o.color] || o.color) : 'rgba(var(--tint), ' + (o.alpha == null ? 0.07 : o.alpha) + ')';
      el.style.background = 'repeating-conic-gradient(from 0deg at ' + x + ' ' + y + ', ' + col + ' 0deg ' + (step * 0.42).toFixed(2) + 'deg, transparent ' + (step * 0.42).toFixed(2) + 'deg ' + step.toFixed(2) + 'deg)';
      el.style.webkitMaskImage = el.style.maskImage = 'radial-gradient(circle at ' + x + ' ' + y + ', #000 0%, rgba(0,0,0,.6) 32%, transparent 68%)';
      el.style.transformOrigin = x + ' ' + y;
      appliers.push(function (t) { el.style.rotate = ((t / (o.period || 40)) * 360 % 360).toFixed(3) + 'deg'; });
      return el;
    };

    // ── charts ──
    function numFmt(v, dec, sep) { var s = (+v).toFixed(dec || 0); if (sep === false) return s; var p = s.split('.'); p[0] = p[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); return p.join('.'); }
    /**
     * chart(target, { type: 'column' | 'bar' | 'line' | 'area' | 'donut', data, labels, highlight, max, unit, decimals, duration, stagger, values }, at)
     * Draws a clean, animated chart into an empty sized box. The highlighted item (default: the largest) takes the accent; the rest stay neutral.
     */
    M.chart = function (target, s, at) {
      var box = one(target, stage); if (!box) { fail('chart: no element ' + target); return gsap.timeline(); }
      s = s || {};
      var type = s.type || 'column', data = (s.data || []).map(Number), n = data.length, labels = s.labels || [], dec = s.decimals || 0, unit = s.unit || '';
      var maxV = s.max || Math.max.apply(null, data.concat([0])) * 1.08 || 1, hi = s.highlight == null ? data.indexOf(Math.max.apply(null, data)) : s.highlight;
      var d = s.duration || 1.1, stg = s.stagger == null ? Math.min(0.09, 0.6 / Math.max(1, n)) : s.stagger, sub = gsap.timeline(), showVals = s.values !== false;
      box.classList.add('mo-chart', 'mo-chart-' + type); box.innerHTML = '';
      var r = M.rect(box), bw = r.w, bh = r.h;
      function counter(el, v, t, u2, d2) { var st = { v: 0 }, uu = u2 == null ? null : u2, dd = d2 == null ? null : d2; sub.to(st, { v: v, duration: d, ease: 'power3.out' }, t); appliers.push(function () { var x = numFmt(st.v, dd == null ? dec : dd) + (uu == null ? unit : uu); if (el._s !== x) { el.textContent = x; el._s = x; } }); el.textContent = numFmt(0, dd == null ? dec : dd) + (uu == null ? unit : uu); }
      if (type === 'column' || type === 'bar') {
        var horiz = type === 'bar';
        data.forEach(function (v, i) {
          var item = h('div', 'mo-chart-item' + (i === hi ? ' hi' : ''), box);
          var val = showVals ? h('div', 'mo-chart-val', item) : null, track = h('div', 'mo-chart-track', item), bar = h('div', 'mo-chart-fill', track), lab = h('div', 'mo-chart-lab', item);
          lab.textContent = labels[i] == null ? '' : labels[i];
          if (horiz) { bar.style.width = (v / maxV * 100).toFixed(2) + '%'; } else bar.style.height = (v / maxV * 100).toFixed(2) + '%';
          sub.fromTo(bar, horiz ? { scaleX: 0 } : { scaleY: 0 }, horiz ? { scaleX: 1, duration: d, ease: 'mo.out' } : { scaleY: 1, duration: d, ease: 'mo.out' }, i * stg);
          if (val) { counter(val, v, i * stg); sub.from(val, { autoAlpha: 0, y: horiz ? 0 : U * 1.2, x: horiz ? -U : 0, duration: 0.5, ease: 'mo.out' }, i * stg + d * 0.25); }
          sub.from(lab, { autoAlpha: 0, duration: 0.5, ease: 'mo.soft' }, i * stg * 0.6);
        });
        if (!horiz && n) {                                                   // baseline exactly under the bars, drawn in from the left
          var tr0 = M.rect(box.querySelector('.mo-chart-track')), br0 = M.rect(box), base = h('div', 'mo-chart-base', box);
          base.style.top = (tr0.y + tr0.h - br0.y).toFixed(2) + 'px';
          sub.fromTo(base, { scaleX: 0 }, { scaleX: 1, duration: d * 0.7, ease: 'mo.out' }, 0);
        }
      } else if (type === 'line' || type === 'area') {
        var pad = { l: bw * 0.02, r: bw * 0.06, t: bh * 0.16, b: bh * 0.16 }, gw = bw - pad.l - pad.r, gh = bh - pad.t - pad.b;
        var svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 ' + bw + ' ' + bh); svg.setAttribute('class', 'mo-chart-svg'); box.appendChild(svg);
        var P = data.map(function (v, i) { return [pad.l + (n > 1 ? i / (n - 1) : 0.5) * gw, pad.t + gh - v / maxV * gh]; });
        for (var g = 0; g <= 3; g++) { var gl = doc.createElementNS(svg.namespaceURI, 'line'); gl.setAttribute('x1', pad.l); gl.setAttribute('x2', pad.l + gw); gl.setAttribute('y1', pad.t + gh * g / 3); gl.setAttribute('y2', pad.t + gh * g / 3); gl.setAttribute('class', 'mo-chart-grid'); svg.appendChild(gl); }
        var dPath = 'M' + P.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' L');
        if (n > 2) { dPath = 'M' + P[0][0].toFixed(1) + ' ' + P[0][1].toFixed(1); for (var q = 0; q < n - 1; q++) { var p0 = P[Math.max(0, q - 1)], p1 = P[q], p2 = P[q + 1], p3 = P[Math.min(n - 1, q + 2)]; dPath += ' C' + (p1[0] + (p2[0] - p0[0]) / 6).toFixed(1) + ' ' + (p1[1] + (p2[1] - p0[1]) / 6).toFixed(1) + ' ' + (p2[0] - (p3[0] - p1[0]) / 6).toFixed(1) + ' ' + (p2[1] - (p3[1] - p1[1]) / 6).toFixed(1) + ' ' + p2[0].toFixed(1) + ' ' + p2[1].toFixed(1); } }
        if (type === 'area') {
          var gid = 'mo-ag' + Math.floor(rng(dPath)() * 1e9), defs = doc.createElementNS(svg.namespaceURI, 'defs');
          defs.innerHTML = '<linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--accent)" stop-opacity=".32"/><stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient>';
          svg.appendChild(defs);
          var area = doc.createElementNS(svg.namespaceURI, 'path'); area.setAttribute('d', dPath + ' L' + P[n - 1][0].toFixed(1) + ' ' + (pad.t + gh) + ' L' + P[0][0].toFixed(1) + ' ' + (pad.t + gh) + ' Z'); area.setAttribute('fill', 'url(#' + gid + ')'); area.setAttribute('class', 'mo-chart-area'); svg.appendChild(area);
          sub.fromTo(area, { opacity: 0 }, { opacity: 1, duration: d * 0.8, ease: 'mo.soft' }, d * 0.5);
        }
        var line = doc.createElementNS(svg.namespaceURI, 'path'); line.setAttribute('d', dPath); line.setAttribute('class', 'mo-chart-line'); line.setAttribute('pathLength', '1'); svg.appendChild(line);
        sub.fromTo(line, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: d * 1.3, ease: 'mo.inOut' }, 0);
        P.forEach(function (p, i) {
          var c = doc.createElementNS(svg.namespaceURI, 'circle'); c.setAttribute('cx', p[0]); c.setAttribute('cy', p[1]); c.setAttribute('r', i === hi ? U * 0.9 : U * 0.5); c.setAttribute('class', 'mo-chart-dot' + (i === hi ? ' hi' : '')); svg.appendChild(c);
          sub.from(c, { scale: 0, transformOrigin: '50% 50%', duration: 0.5, ease: 'mo.pop' }, d * 1.3 * (n > 1 ? i / (n - 1) : 1) * 0.92);
          var lab = h('div', 'mo-chart-xlab', box); lab.textContent = labels[i] == null ? '' : labels[i]; lab.style.left = (p[0] / bw * 100).toFixed(2) + '%';
          sub.from(lab, { autoAlpha: 0, duration: 0.4 }, i * stg * 0.6);
        });
        if (showVals && hi >= 0 && hi < n) { var tag = h('div', 'mo-chart-tag', box); tag.style.left = (P[hi][0] / bw * 100).toFixed(2) + '%'; tag.style.top = (P[hi][1] / bh * 100).toFixed(2) + '%'; counter(tag, data[hi], d * 0.6); sub.from(tag, { autoAlpha: 0, y: U, duration: 0.5, ease: 'mo.out' }, d * 1.15); }
      } else if (type === 'donut' || type === 'pie') {
        var total = data.reduce(function (a, b) { return a + b; }, 0) || 1, size = Math.min(bw, bh), rad = size * 0.4, sw = type === 'pie' ? rad : size * 0.085, R2 = type === 'pie' ? rad / 2 : rad, gap = n > 1 ? 0.006 : 0;
        var svg2 = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg2.setAttribute('viewBox', (-size / 2) + ' ' + (-size / 2) + ' ' + size + ' ' + size); svg2.setAttribute('class', 'mo-chart-svg'); box.appendChild(svg2);
        var track2 = doc.createElementNS(svg2.namespaceURI, 'circle'); track2.setAttribute('r', R2); track2.setAttribute('class', 'mo-chart-ring'); track2.setAttribute('stroke-width', sw); svg2.appendChild(track2);
        var acc = 0;
        data.forEach(function (v, i) {
          var frac = v / total, seg = doc.createElementNS(svg2.namespaceURI, 'circle');
          seg.setAttribute('r', R2); seg.setAttribute('pathLength', '1'); seg.setAttribute('stroke-width', sw); seg.setAttribute('class', 'mo-chart-seg' + (i === hi ? ' hi' : ''));
          seg.style.strokeDasharray = Math.max(0, frac - gap).toFixed(4) + ' 1'; seg.style.rotate = (-90 + acc * 360).toFixed(3) + 'deg'; seg.style.opacity = (i === hi ? 1 : Math.max(0.16, 0.5 - i * 0.07)).toFixed(2);
          svg2.appendChild(seg);
          sub.fromTo(seg, { strokeDashoffset: Math.max(0, frac - gap) }, { strokeDashoffset: 0, duration: d * Math.max(0.35, frac * 1.6), ease: 'mo.inOut' }, d * acc * 0.9);
          acc += frac;
        });
        // centre: the highlighted share in % (default) · 'value' · 'total' · a number (with unit) · false = none
        if (s.center !== false) {
          var mid = h('div', 'mo-chart-center', box), big = h('div', 'mo-chart-big', mid), cap = h('div', 'mo-chart-cap', mid), share = s.center == null || s.center === 'share';
          var cv = share ? (hi >= 0 ? data[hi] / total * 100 : 100) : s.center === 'value' ? (hi >= 0 ? data[hi] : total) : s.center === 'total' ? total : +s.center;
          counter(big, cv, d * 0.3, share ? '%' : unit, share ? 0 : dec);
          cap.textContent = s.caption || (labels[hi] == null ? '' : labels[hi]);
          sub.from(mid, { autoAlpha: 0, scale: 0.92, duration: 0.7, ease: 'mo.out' }, d * 0.25);
        }
      } else fail('chart: unknown type "' + type + '"');
      // sound: { sfx: true } = a swish as it builds and a pop when the highlighted value lands
      if (s.sfx) {
        var T0 = tok(at) || 0;
        M.sfx(typeof s.sfx === 'string' ? s.sfx : 'swish', { volume: 0.7 }, T0);
        if (hi >= 0 && hi < n) M.sfx('pop', { volume: 0.8 }, T0 + (type === 'column' || type === 'bar' ? hi * stg + d * 0.55 : d * 0.9));
      }
      return tlAt(sub, tok(at) || 0);
    };

    // ── ready-made blocks ──
    /**
     * callout(target, { text, side: 'right' | 'left' | 'top' | 'bottom', length, out, sfx }, at) — annotation:
     * a dot on the element, a hairline drawn out, and a label. Lives in the element's parent so it moves with it.
     */
    M.callout = function (target, o, at) {
      if (typeof o === 'string') o = { text: o };
      o = o || {};
      var el = one(target, stage); if (!el) return gsap.timeline();
      // parent: where the label lives — pick an ancestor that does not clip (a device screen clips its content)
      var parent = (o.parent && one(o.parent, stage)) || el.offsetParent || stage, r = M.rect(el), pr = parent === stage ? { x: 0, y: 0 } : M.rect(parent), side = o.side || 'right', len = o.length || U * 9;
      var g = h('div', 'mo-callout ' + side, parent), dot = h('i', 'mo-callout-dot', g), ln = h('i', 'mo-callout-line', g), lab = h('div', 'mo-callout-label', g);
      lab.innerHTML = o.text || '';
      var ax = side === 'right' ? r.x + r.w : side === 'left' ? r.x : r.cx, ay = side === 'top' ? r.y : side === 'bottom' ? r.y + r.h : r.cy;
      g.style.left = (ax - pr.x) + 'px'; g.style.top = (ay - pr.y) + 'px'; g.style.setProperty('--len', len + 'px');
      var t0 = tok(at) || 0, sub = gsap.timeline(), horiz = side === 'right' || side === 'left';
      sub.from(dot, { scale: 0, duration: 0.45, ease: 'mo.pop' }, 0)
        .from(ln, Object.assign(horiz ? { scaleX: 0 } : { scaleY: 0 }, { duration: 0.55, ease: 'mo.out' }), 0.12)
        .from(lab, { autoAlpha: 0, x: horiz ? (side === 'right' ? -U : U) : 0, y: horiz ? 0 : (side === 'bottom' ? -U : U), duration: 0.6, ease: 'mo.out' }, 0.38);
      if (o.out != null) sub.to(g, { autoAlpha: 0, duration: 0.35, ease: 'mo.in' }, (tok(o.out) || 0) - t0);
      if (o.sfx) M.sfx(o.sfx === true ? 'tick' : o.sfx, t0);
      return tlAt(sub, t0);
    };
    /** lowerThird({ name, title, side, out, parent, sfx }, at) — a name strap for a speaker, a place or a source (HUD layer). */
    M.lowerThird = function (o, at) {
      o = o || {};
      var parent = one(o.parent, stage) || one('.mo-hud', stage) || stage, g = h('div', 'mo-lt ' + (o.side || 'left'), parent);
      var bar = h('i', 'mo-lt-bar', g), body = h('div', 'mo-lt-body', g), nmBox = h('div', 'mo-lt-name', body), nm = h('span', '', nmBox), ti = h('div', 'mo-lt-title', body);
      nm.textContent = o.name || ''; nm.style.display = 'inline-block'; ti.textContent = o.title || '';
      var t0 = tok(at) || 0, sub = gsap.timeline();
      sceneRec(g).w = [[snap(t0), o.out == null ? Infinity : snap((tok(o.out) || 0) + 0.6)]];
      sub.from(bar, { scaleY: 0, duration: 0.5, ease: 'mo.out' }, 0)
        .from(nm, { yPercent: 110, duration: 0.7, ease: 'mo.out' }, 0.12)
        .from(ti, { autoAlpha: 0, y: U * 1.2, duration: 0.6, ease: 'mo.out' }, 0.3);
      if (o.out != null) { var t1 = (tok(o.out) || 0) - t0; sub.to(body, { autoAlpha: 0, x: -U * 2, duration: 0.35, ease: 'mo.in' }, t1).to(bar, { scaleY: 0, duration: 0.35, ease: 'mo.in' }, t1 + 0.1); }
      if (o.sfx) M.sfx(o.sfx === true ? 'swipe' : o.sfx, t0);
      return tlAt(sub, t0);
    };

    // ── adapters: drive any other animation runtime from the master clock ──
    /** adapter({ ready, seek(t, frame) }) — plug in another runtime; seek must draw the exact frame for time t. */
    M.adapter = function (a) { if (a.ready) M.wait(a.ready); if (a.seek) appliers.push(function (t, f) { a.seek(t, f); }); return M; };
    /** lottie(target, { src, speed, loop, from, to }, at) — a Lottie animation (JSON from After Effects / LottieFiles), frame-accurate. */
    M.lottie = function (target, o, at) {
      if (typeof o === 'string') o = { src: o };
      o = o || {};
      var el = one(target, stage), L = global.lottie || global.bodymovin;
      if (!L) { fail('lottie: the Lottie player did not load (run npm install in the skill folder)'); return M; }
      if (!el) { fail('lottie: no element ' + target); return M; }
      var anim = L.loadAnimation({ container: el, renderer: 'svg', loop: false, autoplay: false, path: o.src, rendererSettings: { preserveAspectRatio: o.fit || 'xMidYMid meet', progressiveLoad: false } });
      var t0 = tok(at) || 0, speed = o.speed || 1;
      M.wait(new Promise(function (res) { anim.addEventListener('DOMLoaded', res); anim.addEventListener('data_failed', function () { fail('lottie: could not load ' + o.src); res(); }); setTimeout(res, 15000); }));
      appliers.push(function (t) {
        var total = anim.totalFrames || 0; if (!total) return;
        var a = o.from || 0, b = o.to == null ? total - 1 : o.to, span = Math.max(1, b - a), f = (t - t0) * speed * (anim.frameRate || 30);
        f = o.loop ? a + ((f % span) + span) % span : a + clamp(f, 0, span);
        if (anim._moF !== f) { anim.goToAndStop(f, true); anim._moF = f; }
      });
      el._moLottie = anim;
      return M;
    };
    /**
     * three(target, (THREE, ctx) => (t, frame) => {…}) — a real 3D scene on a canvas.
     * ctx = { scene, camera, renderer, width, height, THREE }. Return a function that poses the scene for time t; it is rendered after every call.
     */
    M.three = function (target, setup) {
      var THREE = Motion.THREE;
      if (!THREE) { fail('three: the 3D runtime did not load (run npm install in the skill folder; mention M.three in the composition)'); return M; }
      var el = one(target, stage); if (!el) { fail('three: no element ' + target); return M; }
      var canvas = el.tagName === 'CANVAS' ? el : h('canvas', 'mo-three', el), r = M.rect(el), w = Math.max(2, Math.round(r.w)), hh = Math.max(2, Math.round(r.h));
      if (canvas !== el) { canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block'; }
      var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      renderer.setSize(w, hh, false);
      if (THREE.SRGBColorSpace) renderer.outputColorSpace = THREE.SRGBColorSpace;
      var scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, w / hh, 0.1, 2000); camera.position.set(0, 0, 10);
      var ctx = { scene: scene, camera: camera, renderer: renderer, width: w, height: hh, THREE: THREE, M: M };
      var pose = null;
      M.wait(Promise.resolve().then(function () { return setup(THREE, ctx); }).then(function (fn) { pose = typeof fn === 'function' ? fn : null; }));
      var ratio = 0;
      (M._three = M._three || []).push({ canvas: canvas, scene: scene, ctx: ctx });
      appliers.push(function (t, f) {
        // a hidden canvas costs nothing: the scene is posed and drawn only while it can be seen (pose is a pure function of t)
        if (canvas.checkVisibility && !canvas.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return;
        var z = parseFloat(doc.documentElement.style.zoom) || 1, pr = (global.devicePixelRatio || 1) * z;
        if (pr !== ratio) { renderer.setPixelRatio(pr); renderer.setSize(w, hh, false); ratio = pr; }
        if (pose) pose(t, f);
        renderer.render(scene, ctx.camera);
      });
      return M;
    };
    // screen positions (client px) of the bounding-box corners of everything drawn in a 3D scene — how far the 3D moved between two times
    function threeCorners(rec) {
      var THREE = Motion.THREE, out = [], cam = rec.ctx.camera, cr = rec.canvas.getBoundingClientRect(), v = new THREE.Vector3();
      rec.scene.updateMatrixWorld(); cam.updateMatrixWorld();
      rec.scene.traverse(function (o) {
        if (!o.visible || !o.geometry || out.length > 4000) return;
        var g = o.geometry; if (!g.boundingBox) g.computeBoundingBox(); var b = g.boundingBox; if (!b || !isFinite(b.min.x)) return;
        for (var c = 0; c < 8; c++) {
          v.set(c & 1 ? b.max.x : b.min.x, c & 2 ? b.max.y : b.min.y, c & 4 ? b.max.z : b.min.z).applyMatrix4(o.matrixWorld).project(cam);
          out.push(v.z > 1 || v.z < -1 ? null : [cr.left + (v.x + 1) / 2 * cr.width, cr.top + (1 - v.y) / 2 * cr.height]);
        }
      });
      return out;
    }
    M._threeMotion = function (before) {
      var vis = { opacityProperty: true, visibilityProperty: true }, live = (M._three || []).filter(function (r) { return !r.canvas.checkVisibility || r.canvas.checkVisibility(vis); });
      if (!before) return live.map(function (r) { return { rec: r, pts: threeCorners(r) }; });
      var max = 0;
      before.forEach(function (s) {
        var pts = threeCorners(s.rec), cr = s.rec.canvas.getBoundingClientRect(), cap = Math.max(cr.width, cr.height) * 0.5;
        for (var i = 0; i < Math.min(pts.length, s.pts.length); i++) {
          var p = s.pts[i], q = pts[i]; if (!p || !q) continue;
          var inside = function (x) { return x[0] > cr.left && x[0] < cr.right && x[1] > cr.top && x[1] < cr.bottom; };
          if (!inside(p) && !inside(q)) continue;
          max = Math.max(max, Math.min(cap, Math.max(Math.abs(q[0] - p[0]), Math.abs(q[1] - p[1]))));
        }
      });
      return max;
    };

    // ── declarative markup: simple timing straight from data-* attributes (JS stays for the choreography) ──
    function words(v) { return String(v == null ? '' : v).trim().split(/\s+/).filter(Boolean); }
    function optsOf(list) {
      var o = {};
      list.forEach(function (t) {
        var i = t.indexOf('='); if (i < 0) { o[t] = true; return; }
        var k = t.slice(0, i), v = t.slice(i + 1); k = { dur: 'duration', d: 'duration', vol: 'volume' }[k] || k;
        if (/^-?\d+(?:\.\d+)?$/.test(v)) v = +v; else if (/^-?\d+(?:\.\d+)?u$/.test(v)) v = parseFloat(v) * U; else if (v === 'true') v = true; else if (v === 'false') v = false;
        o[k] = v;
      });
      return o;
    }
    function isTime(w) { return /^(?:-?\d+(?:\.\d+)?s?|b-?\d+(?:\.\d+)?)$/i.test(w); }
    /** "type time key=val flag" → { name, at, o } */
    function spec(v, names) {
      var name = null, at = null, rest = [];
      words(v).forEach(function (w) { if (at == null && isTime(w)) at = tok(w); else if (name == null && names && names.indexOf(w) >= 0) name = w; else rest.push(w); });
      return { name: name, at: at, o: optsOf(rest) };
    }
    /**
     * declare(root) — runs once before Motion.compose's callback. Attributes:
     *   data-show="0.4-3.2, 5-8"   data-reveal="rise 0.3 dur=0.9 sfx"   data-exit="fade 4.2"   data-count="62>96 1.0 dur=2.4 pulse"
     *   data-type="3.8 dur=1.3 sfx"   data-highlight="1.4"   data-pulse="2.5"   data-press="3.1"   data-draw="0.5"
     *   data-float="y=0.8u period=5"   data-spin="period=8"   data-sfx="whoosh 1.2 vol=0.6, impact b8"
     *   data-captions="voice.srt karaoke"   data-lottie="anim.json 1.0 loop"   <audio src="bgm.mp3" data-start="0" data-volume="0.8">
     * Times accept seconds or beats (b8).
     */
    M.declare = function (root) {
      root = root || stage;
      toArray('audio[src]', doc).forEach(function (el) {
        if (el._moTrack) return;
        var d = el.dataset;
        M.audio(el.getAttribute('src'), { at: d.start, from: d.from, end: d.end, volume: d.volume, fadeIn: d.fadeIn, fadeOut: d.fadeOut, role: d.role, duck: d.duck, loop: el.hasAttribute('loop') || d.loop != null, bpm: d.bpm });
        el._moTrack = tracks[tracks.length - 1]; el.muted = true; el.preload = 'auto';
      });
      var R = Object.keys(REVEALS), X = Object.keys(EXITS);
      toArray('[data-show]', root).forEach(function (el) {
        M.scene(el, el.dataset.show.split(',').map(function (part) { var m = /^\s*([^~–]+?)\s*(?:[-~–]\s*(.*?))?\s*$/.exec(part) || []; return [tok(m[1]) || 0, m[2] ? tok(m[2]) : null]; }));
      });
      toArray('[data-reveal]', root).forEach(function (el) { var s = spec(el.dataset.reveal, R); s.o.type = s.name || 'fade'; M.reveal(el, s.o, s.at == null ? 0 : s.at); });
      toArray('[data-exit]', root).forEach(function (el) { var s = spec(el.dataset.exit, X); s.o.type = s.name || 'fade'; M.exit(el, s.o, s.at == null ? 0 : s.at); });
      toArray('[data-count]', root).forEach(function (el) {
        var ws = words(el.dataset.count), v = ws.shift() || '0', m = /^(-?[\d.,]+)\s*(?:>|→|->)\s*(-?[\d.,]+)$/.exec(v), s = spec(ws.join(' '));
        var from = m ? parseFloat(m[1].replace(/,/g, '')) : 0, to = parseFloat((m ? m[2] : v).replace(/,/g, '')), dec = ((m ? m[2] : v).split('.')[1] || '').length;
        var o = s.o; o.from = from; o.to = to; if (o.decimals == null) o.decimals = dec;
        M.count(el, o, s.at == null ? 0 : s.at);
      });
      toArray('[data-type]', root).forEach(function (el) { var s = spec(el.dataset.type); M.type(el, el.textContent.trim(), s.o, s.at == null ? 0 : s.at); });
      toArray('[data-highlight]', root).forEach(function (el) { var s = spec(el.dataset.highlight); M.highlight(el, s.o, s.at == null ? 0 : s.at); });
      toArray('[data-pulse]', root).forEach(function (el) { var s = spec(el.dataset.pulse); M.pulse(el, s.o, s.at == null ? 0 : s.at); });
      toArray('[data-press]', root).forEach(function (el) { var s = spec(el.dataset.press); M.press(el, s.o, s.at == null ? 0 : s.at); });
      toArray('[data-draw]', root).forEach(function (el) { var s = spec(el.dataset.draw); s.o.type = 'draw'; M.reveal(el, s.o, s.at == null ? 0 : s.at); });
      toArray('[data-float]', root).forEach(function (el) { M.float(el, optsOf(words(el.dataset.float))); });
      toArray('[data-spin]', root).forEach(function (el) { M.spin(el, optsOf(words(el.dataset.spin))); });
      toArray('[data-sfx]', root).forEach(function (el) {
        el.dataset.sfx.split(',').forEach(function (part) { var ws = words(part), name = ws.shift(); if (!name) return; var s = spec(ws.join(' ')); M.sfx(name, s.o, s.at == null ? 0 : s.at); });
      });
      toArray('[data-captions]', root).forEach(function (el) { var ws = words(el.dataset.captions), src = ws.shift(), s = spec(ws.join(' '), ['karaoke', 'pop', 'box', 'line']); if (s.name) s.o.style = s.name; if (s.at != null) s.o.offset = s.at; M.captions(el, src, s.o); });
      toArray('[data-lottie]', root).forEach(function (el) { var ws = words(el.dataset.lottie), src = ws.shift(), s = spec(ws.join(' ')); s.o.src = src; M.lottie(el, s.o, s.at == null ? 0 : s.at); });
      return M;
    };

    // ── template variables (props) ──
    M.varDefs = Motion._varDefs || {};
    M._events = function () {
      return {
        scenes: scenes.map(function (s) { return { id: s.el.id || '', cls: String(s.el.className && s.el.className.baseVal != null ? s.el.className.baseVal : s.el.className || '').split(' ')[0], w: s.w.map(function (w) { return [w[0], w[1] === Infinity ? null : w[1]]; }) }; }).filter(function (s) { return !/^mo-(leak|flash)$/.test(s.cls); }),
        labels: tl.labels, sfx: effects.map(function (e) { return { name: e.name, at: e.at }; }),
        beats: (function () { var m = M.music(); if (m && m.beats.length) return m.beats; if (stage.dataset.bpm) { var g = M.grid(), out = []; for (var i = 0; g(i) <= D && i < 2000; i++) out.push(g(i)); return out; } return []; })(),
        captions: M._captions || []
      };
    };

    // SVG filters used by warp / glitch transitions live in one hidden <svg> on the stage
    var filterSeq = 0, filterHost = null;
    function filterEl(id, inner) {
      if (!filterHost) { filterHost = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); filterHost.setAttribute('class', 'mo-filters'); filterHost.setAttribute('width', '0'); filterHost.setAttribute('height', '0'); filterHost.setAttribute('data-mo-ignore', ''); filterHost.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'; stage.appendChild(filterHost); }
      var f = doc.createElementNS(filterHost.namespaceURI, 'filter');
      f.setAttribute('id', id); f.setAttribute('x', '-10%'); f.setAttribute('y', '-10%'); f.setAttribute('width', '120%'); f.setAttribute('height', '120%'); f.setAttribute('color-interpolation-filters', 'sRGB');
      f.innerHTML = inner; filterHost.appendChild(f); return f;
    }

    // sound hooks on the existing helpers: { sfx: true } picks a fitting effect, { sfx: 'name' } a specific one
    (function () {
      function st(r) { return r && r.startTime ? r.startTime() : null; }
      function opt(o) { return (o && typeof o === 'object') ? o : {}; }
      var rv = M.reveal; M.reveal = function (target, o, at) { var r = rv(target, o, at), oo = opt(o), n = sfxFor(oo, 'reveal', oo.type || 'fade'); if (n && st(r) != null) M.sfx(n, { volume: oo.sfxVolume }, st(r) + (oo.sfxAt || 0)); return r; };
      var ex = M.exit; M.exit = function (target, o, at) { var r = ex(target, o, at), oo = opt(o), n = sfxFor(oo, 'exit'); if (n && st(r) != null) M.sfx(n, { volume: oo.sfxVolume == null ? 0.6 : oo.sfxVolume }, st(r)); return r; };
      ['press', 'pulse', 'tap'].forEach(function (k) { var fn0 = M[k]; M[k] = function (target, a, b) { var f = flex(a, b), r = fn0(target, f.o, f.at), n = sfxFor(f.o, k); if (n && st(r) != null) M.sfx(n, { volume: f.o.sfxVolume }, st(r)); return r; }; });
      var hl = M.highlight; M.highlight = function (target, o, at) { if (typeof o !== 'object' || o === null) { at = o; o = {}; } var r = hl(target, o, at), n = sfxFor(o, 'highlight'); if (n && st(r) != null) M.sfx(n, { volume: o.sfxVolume == null ? 0.7 : o.sfxVolume }, st(r)); return r; };
      var cu = M.cursor; M.cursor = function (co) {
        var api = cu(co), ck = api.click;
        api.click = function (a1, a2) { var fx = flex(a1, a2), r = ck(fx.o, fx.at), n = sfxFor(fx.o, 'click'); if (n && st(r) != null) M.sfx(n, { volume: fx.o.sfxVolume }, st(r)); return r; };
        /** drag(target, { duration, ease }, at) — press, travel on a flat arc while held, release. */
        api.drag = function (target, opt2, at) {
          if (typeof opt2 !== 'object' || opt2 === null) { at = opt2; opt2 = {}; }
          var t0 = tok(at) || 0;
          tw_to(api.state, { s: 0.86, duration: 0.08, ease: 'power2.out' }, t0);
          var mv = api.moveTo(target, Object.assign({ bend: 0.04, ease: opt2.ease || 'mo.inOut' }, opt2), t0 + 0.1);
          tw_to(api.state, { s: 1, duration: 0.35, ease: 'mo.spring' }, mv.endTime());
          if (opt2.sfx) { M.sfx(opt2.sfx === true ? 'click' : opt2.sfx, { volume: 0.7 }, t0); M.sfx(opt2.sfx === true ? 'tap' : opt2.sfx, { volume: 0.5 }, mv.endTime()); }
          return mv;
        };
        return api;
      };
      var tr = M.transition; M.transition = function (type, from, to, o) {
        o = o || {};
        var end = tr(type, from, to, o), n = sfxFor(o, 'transition', type);
        if (n) { var a0 = snap(M.time(o.at)), dd = end - a0; M.sfx(n, { volume: o.sfxVolume }, /^(flash|glitch)$/.test(type) ? a0 + dd * 0.42 : type === 'whip' ? a0 + dd * 0.2 : a0); }
        return end;
      };
    })();
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
      /** sound the renderer mixes: tracks (music, voice) and effects, in composition time */
      audioPlan: function () { return M._plan(); },
      /** template variables with their schema and current values */
      vars: function () { var out = [], defs = M.varDefs || {}; for (var k in defs) { var d = defs[k]; out.push({ name: d.name, type: d.type, default: d.default, value: M.vars[k] != null ? M.vars[k] : null, label: d.label || '', options: d.options || null, builtin: !!d.builtin }); } return out; },
      loop: stage.hasAttribute('data-loop'),
      /** scene windows, labels, effects, beats and caption cues (preview timeline, score) */
      events: function () { return M._events(); },
      cam: function () { var c = M.cam.s; return { used: !!M.cam._used, x: c.x, y: c.y, zoom: c.zoom, rx: c.rx, ry: c.ry, rz: c.rz }; },
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
        var three0 = M._three && M._three.length ? M._threeMotion() : null;
        seek(t1);
        if (three0) max = Math.max(max, M._threeMotion(three0));
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
    var ev = M._events();
    ev.beats.forEach(function (bt) { var k = h('u', '', track); k.style.left = (bt / D * 100) + '%'; });
    ev.sfx.forEach(function (e) { var k = h('s', '', track); k.style.left = (e.at / D * 100) + '%'; k.title = e.name; });
    // sound: tracks follow the playhead, effects fire as it passes them
    var plan = M._plan(), soundOn = true, snd = { ctx: null, bufs: {}, els: [] }, hasSound = plan.tracks.length + plan.sfx.length > 0;
    if (hasSound) { bar.insertBefore(h('button', 'on', null, '♪'), bar.querySelector('.bar')).dataset.a = 'sound'; plan.tracks.forEach(function (trk) { var au = new Audio(trk.src); au.preload = 'auto'; snd.els.push({ tr: trk, a: au }); }); }
    function sfxUrl(name) { return /\.[a-z0-9]{2,4}$/i.test(name) ? name : BASE + 'sfx/' + name + '.wav'; }
    function playSfx(e) {
      if (!snd.ctx) { var AC = global.AudioContext || global.webkitAudioContext; if (!AC) return; snd.ctx = new AC(); }
      var c = snd.ctx, url = sfxUrl(e.name);
      (snd.bufs[url] || (snd.bufs[url] = fetch(url).then(function (r) { return r.arrayBuffer(); }).then(function (b) { return c.decodeAudioData(b); }).catch(function () { return null; }))).then(function (buf) {
        if (!buf) return; var src = c.createBufferSource(), g = c.createGain(); src.buffer = buf; src.playbackRate.value = (e.pitch || 1) * rate; g.gain.value = e.volume == null ? 1 : e.volume; src.connect(g); g.connect(c.destination); src.start();
      });
    }
    function syncSound(prev, now, jumped) {
      if (!hasSound) return;
      snd.els.forEach(function (x) {
        var tr = x.tr, local = now - tr.at + tr.from, inside = soundOn && playing && now >= tr.at && (tr.end == null || now < tr.end);
        if (!inside) { if (!x.a.paused) x.a.pause(); return; }
        x.a.playbackRate = rate; x.a.volume = clamp(tr.volume, 0, 1);
        if (jumped || x.a.paused || Math.abs(x.a.currentTime - local) > 0.25) { try { x.a.currentTime = Math.max(0, local); } catch (e) { /* not loaded yet */ } }
        if (x.a.paused) x.a.play().catch(function () {});
      });
      if (soundOn && playing && !jumped && now > prev) plan.sfx.forEach(function (e) { if (e.at > prev && e.at <= now) playSfx(e); });
    }
    // template variables: edit and reload (the playhead stays where it was)
    var vdefs = Object.keys(M.varDefs || {}).map(function (k) { return M.varDefs[k]; });
    if (vdefs.length > 1 || (vdefs.length === 1 && !vdefs[0].builtin)) {
      bar.insertBefore(h('button', '', null, 'vars'), bar.querySelector('.bar')).dataset.a = 'vars';
      var panel = h('form', '', doc.body); panel.id = 'mo-vars';
      vdefs.forEach(function (d) {
        var row = h('label', '', panel), cur = M.vars[d.name] != null ? M.vars[d.name] : d.default;
        h('span', '', row).textContent = d.label || d.name;
        var inp = d.options ? h('select', '', row, d.options.map(function (x) { return '<option' + (String(x) === String(cur) ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('')) : h(d.type === 'text' && String(cur).length > 28 ? 'textarea' : 'input', '', row);
        inp.name = d.name; if (!d.options) { inp.value = cur == null ? '' : cur; if (d.type === 'number') inp.type = 'number'; }
      });
      h('button', '', panel, '적용').type = 'submit';
      panel.addEventListener('submit', function (e) {
        e.preventDefault();
        var q = new URLSearchParams(location.search);
        toArray('[name]', panel).forEach(function (inp) { var d = M.varDefs[inp.name]; if (d && String(inp.value) !== String(d.default)) q.set(inp.name, inp.value); else q.delete(inp.name); });
        q.set('t', t.toFixed(3)); q.set('autoplay', '0'); location.search = q.toString();
      });
    }
    function fit() {
      var aw = innerWidth - 32, ah = innerHeight - 56 - 32, s = Math.min(aw / W, ah / H);
      stage.style.transform = 'translate(' + ((innerWidth - W * s) / 2).toFixed(1) + 'px,' + ((innerHeight - 56 - H * s) / 2).toFixed(1) + 'px) scale(' + s.toFixed(5) + ')';
    }
    addEventListener('resize', fit); fit();
    var playing = false, loop = true, rate = 1, t = +(QS.get('t') || 0), last = 0, rates = [1, 0.5, 0.25, 2];
    function ui() { fill.style.width = (t / D * 100).toFixed(3) + '%'; time.textContent = t.toFixed(2) + ' / ' + D.toFixed(2) + 's · f' + Math.round(t * fps); bar.querySelector('[data-a=play]').textContent = playing ? '❚❚' : '▶'; }
    function go(nt, jumped) { var prev = t; t = clamp(nt, 0, D); seek(t); ui(); syncSound(prev, t, jumped !== false); }
    function tick(now) { if (!playing) return; var dt = (now - last) / 1000; last = now; var nt = t + dt * rate, wrap = false; if (nt >= D) { if (loop) { nt = 0; wrap = true; } else { nt = D; playing = false; } } go(nt, wrap); requestAnimationFrame(tick); }
    function toggle() { playing = !playing; if (playing) { if (t >= D) t = 0; last = performance.now(); requestAnimationFrame(tick); } ui(); syncSound(t, t, true); }
    bar.addEventListener('click', function (e) {
      var a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'play') toggle();
      if (a === 'loop') { loop = !loop; e.target.classList.toggle('on', loop); }
      if (a === 'rate') { rate = rates[(rates.indexOf(rate) + 1) % rates.length]; e.target.textContent = rate + '×'; }
      if (a === 'guides') { guides.classList.toggle('on'); e.target.classList.toggle('on'); }
      if (a === 'sound') { soundOn = !soundOn; e.target.classList.toggle('on', soundOn); syncSound(t, t, true); }
      if (a === 'vars') { var pn = doc.getElementById('mo-vars'); if (pn) pn.classList.toggle('on'); e.target.classList.toggle('on'); }
    });
    var drag = false;
    function scrub(e) { var r = track.getBoundingClientRect(); go(clamp((e.clientX - r.left) / r.width, 0, 1) * D); }
    track.addEventListener('pointerdown', function (e) { drag = true; playing = false; track.setPointerCapture(e.pointerId); scrub(e); });
    track.addEventListener('pointermove', function (e) { if (drag) scrub(e); });
    track.addEventListener('pointerup', function () { drag = false; });
    addEventListener('keydown', function (e) {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.code === 'ArrowRight') { playing = false; go(t + (e.shiftKey ? 0.5 : 1 / fps)); }
      else if (e.code === 'ArrowLeft') { playing = false; go(t - (e.shiftKey ? 0.5 : 1 / fps)); }
      else if (e.code === 'Home') go(0); else if (e.code === 'End') go(D);
      else if (e.code === 'KeyL') bar.querySelector('[data-a=loop]').click();
      else if (e.code === 'KeyG') bar.querySelector('[data-a=guides]').click();
      else if (e.code === 'KeyS' && bar.querySelector('[data-a=sound]')) bar.querySelector('[data-a=sound]').click();
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
  // text inside one component (a card, a chart, a phone) reads as one unit
  var GROUP_SEL = '.mo-card,.mo-glass,.mo-window,.mo-list,.mo-chat,.mo-phone,.mo-laptop,.mo-chart,.mo-input,.mo-terminal,.mo-code,.mo-lt,.mo-callout,.mo-captions,.mo-hud,[data-group]';
  function groupOf(el) { var c = el.closest(GROUP_SEL); if (!c) return 0; if (!c._moId) c._moId = ++blockSeq; return c._moId; }
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
          deco: !!key.closest('[data-deco]'), device: !!key.closest('.mo-phone .mo-screen, .mo-laptop .mo-screen'), accent: isAccent(col), grp: groupOf(key) };
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
          font: Math.round(i.font), contrast: i.outline ? null : +contrast(fgc, i.bg).toFixed(2), blur: +i.blur.toFixed(1), family: i.family, mono: i.mono, deco: i.deco, device: i.device, grp: i.grp };
      }),
      nested: nested, accents: groups.length,
      fonts: doc.fonts ? Array.from(doc.fonts).filter(function (f) { return f.status === 'loaded'; }).map(function (f) { return f.family.replace(/["']/g, ''); }).filter(function (v, k, a) { return a.indexOf(v) === k; }) : []
    };
  }

  Motion.utils = { clamp: clamp, lerp: lerp, map: mapRange, smooth: smooth, noise: noise, rng: rng, hash: hashStr, bezier: cubicBezier, parseColor: parseColor, contrast: contrast, over: over };
  global.Motion = Motion;
})(window);
