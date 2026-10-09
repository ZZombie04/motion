import fs from 'node:fs';
import path from 'node:path';
import { launch, destroy } from './browser.mjs';
import { serve } from './server.mjs';
import { syncRuntime } from './project.mjs';
import { log } from './util.mjs';

/**
 * Opens a composition for frame-accurate capture.
 * → { meta, pages[], seek(page, t), shot(page, opts), close() }
 */
export async function openComposition(file, { pages = 1, scale = 1, zoom = 1, alpha = false, gpu = false, vars = '' } = {}) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error('파일이 없습니다: ' + abs);
  const dir = path.dirname(abs);
  if (syncRuntime(dir)) log(`· 런타임(_motion)을 최신 엔진으로 갱신했습니다: ${path.join(dir, '_motion')}`);
  const server = await serve(dir);
  const extra = typeof vars === 'string' ? vars.replace(/^[?&]/, '') : new URLSearchParams(vars || {}).toString();
  const url = `${server.origin}/${encodeURIComponent(path.basename(abs))}?render=1${extra ? '&' + extra : ''}`;
  const problems = [];
  const browsers = [];
  let meta = null;

  // One browser process per capture page: background tabs of a shared browser stall on screenshots,
  // separate processes capture truly in parallel.
  async function open() {
    const browser = await launch({ gpu });
    browsers.push(browser);
    const page = (await browser.pages())[0] || (await browser.newPage());
    const note = (m) => { if (!/favicon\.ico/.test(m) && !problems.includes(m)) problems.push(m); };
    page.on('pageerror', (e) => note('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) note('console: ' + m.text()); });
    // media elements cancel their own range requests (the page never plays them while capturing) — not a failure
    page.on('requestfailed', (r) => { if (r.resourceType() === 'media' && /ABORTED/i.test((r.failure() && r.failure().errorText) || '')) return; note('request failed: ' + r.url().replace(server.origin, '')); });
    page.on('response', (r) => { if (r.status() >= 400) note(`HTTP ${r.status()}: ${r.url().replace(server.origin, '')}`); });
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    try { await page.waitForFunction('window.__motion && window.__motion.ready', { timeout: 45000, polling: 100 }); }
    catch { throw new Error(['컴포지션이 준비되지 않았습니다 (Motion.compose가 끝나지 않음).', ...problems].join('\n')); }
    // pictures marked data-optional (a logo that may not exist yet) may fail without it being a problem
    const optional = await page.evaluate(() => Array.from(document.querySelectorAll('img[data-optional]')).map((i) => i.src).filter(Boolean)).catch(() => []);
    for (const src of optional) { const p = src.replace(server.origin, ''); for (let i = problems.length - 1; i >= 0; i--) if (problems[i].endsWith(': ' + p)) problems.splice(i, 1); }
    const m = await page.evaluate(() => ({ width: __motion.width, height: __motion.height, fps: __motion.fps, duration: __motion.duration, title: __motion.title, failed: __motion.failed, errors: __motion.errors, labels: __motion.labels }));
    if (m.failed || (m.errors && m.errors.length)) throw new Error(['컴포지션 오류:', ...(m.errors || [])].join('\n  '));
    const cdp = await page.createCDPSession();
    page._cdp = cdp;
    await view(page, { scale, zoom }, m);
    if (alpha) {
      await cdp.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
      await page.evaluate(() => { document.documentElement.style.background = 'transparent'; document.body.style.background = 'transparent'; document.getElementById('stage').style.background = 'transparent'; });
    }
    await page.evaluate(() => __motion.seek(0));
    meta = meta || m;
    return page;
  }
  /**
   * Pixel scale and layout zoom of one capture page.
   *   scale → device pixel ratio: the same layout on more or fewer pixels.
   *   zoom  → the page itself is laid out larger. Chrome paints everything under a perspective transform at layout
   *           resolution whatever the pixel ratio, so only a larger layout keeps magnified, tilted content crisp.
   * Both are set on the capture session — a screenshot only honours the device metrics of the session that takes it.
   */
  async function view(page, v = {}, m = meta) {
    const cur = page._view;
    const next = { scale: v.scale ?? cur?.scale ?? 1, zoom: v.zoom ?? cur?.zoom ?? 1, width: v.width ?? m.width, height: v.height ?? m.height };
    if (cur && cur.scale === next.scale && cur.zoom === next.zoom && cur.width === next.width && cur.height === next.height) return false;
    await page._cdp.send('Emulation.setDeviceMetricsOverride', { width: Math.round(next.width * next.zoom), height: Math.round(next.height * next.zoom), deviceScaleFactor: next.scale, mobile: false });
    if ((cur?.zoom ?? 1) !== next.zoom) await page.evaluate((z) => { document.documentElement.style.zoom = z === 1 ? '' : String(z); }, next.zoom);
    page._view = next;
    return true;
  }
  const closeAll = async () => { destroy(browsers); await server.close(); };

  let list;
  try {
    const first = await open(); // fail fast on a broken composition before spawning the rest
    list = [first, ...(await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, open)))];
  } catch (e) { await closeAll(); throw e; }

  return {
    meta, pages: list, problems, url, view,
    seek: (page, t) => page.evaluate((x) => window.__motion.seek(x), t),
    async shot(page, { type = 'png', quality = 100 } = {}) {
      const r = await page._cdp.send('Page.captureScreenshot', { format: type, quality: type === 'png' ? undefined : quality, fromSurface: true, captureBeyondViewport: false, optimizeForSpeed: type === 'png' });
      return Buffer.from(r.data, 'base64');
    },
    close: closeAll
  };
}
