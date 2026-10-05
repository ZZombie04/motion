import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

/** Locate an installed Chromium-family browser. Override with MOTION_CHROME. */
export function findChrome() {
  const env = process.env.MOTION_CHROME || process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH;
  if (env && fs.existsSync(env)) return env;
  const c = [];
  if (process.platform === 'win32') {
    const pf = [process.env['PROGRAMFILES'], process.env['PROGRAMFILES(X86)'], process.env['LOCALAPPDATA']].filter(Boolean);
    for (const b of pf) c.push(path.join(b, 'Google', 'Chrome', 'Application', 'chrome.exe'));
    for (const b of pf) c.push(path.join(b, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    for (const b of pf) c.push(path.join(b, 'Chromium', 'Application', 'chrome.exe'));
  } else if (process.platform === 'darwin') {
    c.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium',
      path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'));
  } else {
    for (const b of ['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'microsoft-edge']) {
      try { const p = execFileSync('which', [b], { encoding: 'utf8' }).trim(); if (p) c.push(p); } catch { /* not installed */ }
    }
  }
  // browsers downloaded by Playwright / Puppeteer also work
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, path.join(process.env.LOCALAPPDATA || '', 'ms-playwright'), path.join(os.homedir(), '.cache', 'ms-playwright'), path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright')].filter(Boolean);
  for (const dir of caches) {
    if (!fs.existsSync(dir)) continue;
    const builds = fs.readdirSync(dir).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse();
    for (const b of builds) c.push(path.join(dir, b, 'chrome-win', 'chrome.exe'), path.join(dir, b, 'chrome-win64', 'chrome.exe'), path.join(dir, b, 'chrome-linux', 'chrome'), path.join(dir, b, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'));
  }
  return c.find((p) => p && fs.existsSync(p)) || null;
}

export async function launch({ gpu = false } = {}) {
  const executablePath = findChrome();
  if (!executablePath) throw new Error('Chrome/Edge를 찾지 못했습니다. Chrome을 설치하거나 MOTION_CHROME 환경변수에 실행 파일 경로를 지정하세요.');
  const args = [
    '--force-color-profile=srgb', '--disable-lcd-text', '--font-render-hinting=none', '--hide-scrollbars', '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    '--disable-features=Translate,BackForwardCache,PaintHolding,CalculateNativeWinOcclusion', '--disable-extensions', '--no-first-run', '--no-default-browser-check',
    '--run-all-compositor-stages-before-draw', '--disable-new-content-rendering-timeout', '--disable-ipc-flooding-protection',
    // Chrome gives a tab 512 MB of tile memory and silently leaves out what does not fit. A tall stack of 3D layers
    // (a device with real thickness) captured at 2–3× layout needs more — without this, parts of the picture go missing.
    '--force-gpu-mem-available-mb=' + (process.env.MOTION_TILE_MB || 6144)
  ];
  if (gpu) args.push('--enable-gpu', '--ignore-gpu-blocklist');
  if (process.platform === 'linux') args.push('--no-sandbox');
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-chrome-'));
  const browser = await puppeteer.launch({ executablePath, headless: true, args, userDataDir, defaultViewport: null, protocolTimeout: 240000 });
  browser._motionDir = userDataDir;
  return browser;
}

/**
 * Fast teardown. A graceful browser.close() blocks 4–17s on Windows while Chrome releases its profile,
 * so the process is killed and the throwaway profile is removed by a detached helper.
 */
export function destroy(browsers) {
  const dirs = [];
  for (const b of [].concat(browsers)) {
    if (!b) continue;
    try { const p = b.process(); b.disconnect(); if (p) p.kill(); } catch { /* already gone */ }
    if (b._motionDir) dirs.push(b._motionDir);
  }
  if (!dirs.length) return;
  const code = `const fs=require('fs');const d=${JSON.stringify(dirs)};let n=0;(function go(){const left=d.filter(p=>{try{fs.rmSync(p,{recursive:true,force:true});return fs.existsSync(p)}catch(e){return true}});if(left.length&&n++<80)setTimeout(go,400)})()`;
  try { spawn(process.execPath, ['-e', code], { detached: true, stdio: 'ignore', windowsHide: true }).unref(); } catch { /* best effort */ }
}
