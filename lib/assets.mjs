/**
 * Files a composition reads at runtime, prepared by the CLI before the page opens:
 *   _motion/assets.json        index the runtime loads first
 *   _motion/audio/<key>.json   analysis of every audio file the compositions mention (tempo, beats, envelopes)
 *   _motion/sfx/*.wav          the synthesised effect library
 * Caption files (.srt / .vtt / .captions.json) are listed so M.captions('voice.srt') can read them synchronously.
 */
import fs from 'node:fs';
import path from 'node:path';
import { audioKey, ensureAnalysis } from './audio.mjs';
import { ensureSfx } from './sfx.mjs';
import { findFfmpeg } from './ffmpeg.mjs';
import { log } from './util.mjs';

const AUDIO = /\.(mp3|wav|m4a|aac|ogg|oga|flac|opus)$/i, TEXT = /\.(srt|vtt)$|\.captions\.json$/i;

/** Every local audio / caption path mentioned in an HTML file (attributes, scripts, data-* specs). */
export function scanRefs(html) {
  const out = { audio: new Set(), text: new Set() };
  // commented-out lines are not references: <!-- … -->, /* … */ and // … (not the // of a URL or inside quotes)
  html = String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"`\\/])\/\/[^\n]*/g, '$1');
  const re = /(?:^|[\s"'`(=,])((?:\.\/)?[^\s"'`()<>,=]+?\.(?:mp3|wav|m4a|aac|ogg|oga|flac|opus|srt|vtt|captions\.json))(?=[\s"'`),>]|$)/gim;
  let m;
  while ((m = re.exec(html))) {
    const ref = m[1]; if (/^[a-z]+:\/\//i.test(ref) || ref.startsWith('_motion/')) continue;
    if (AUDIO.test(ref)) out.audio.add(ref); else if (TEXT.test(ref)) out.text.add(ref);
  }
  return out;
}

/** Build the asset index for every composition in `dir`. Never throws: missing tools just mean fewer assets. */
export function prepareAssets(dir, { quiet = false } = {}) {
  const motionDir = path.join(dir, '_motion'), index = { audio: {}, text: {} };
  let html = '';
  try { for (const f of fs.readdirSync(dir)) if (f.toLowerCase().endsWith('.html')) html += fs.readFileSync(path.join(dir, f), 'utf8') + '\n'; } catch { /* unreadable dir */ }
  const refs = scanRefs(html), notes = [];
  if (refs.audio.size && findFfmpeg()) {
    for (const ref of refs.audio) {
      const abs = path.resolve(dir, ref.replace(/^\.\//, ''));
      if (!fs.existsSync(abs)) { notes.push('오디오 파일이 없습니다: ' + ref); continue; }
      const key = audioKey(ref);
      try { ensureAnalysis(abs, path.join(motionDir, 'audio'), key); index.audio[key] = 'audio/' + key + '.json'; }
      catch (e) { notes.push('오디오 분석 실패(' + ref + '): ' + e.message.split('\n')[0]); }
    }
  } else if (refs.audio.size) notes.push('ffmpeg가 없어 음악 분석(박자·세기)을 건너뜁니다.');
  for (const ref of refs.text) { const rel = ref.replace(/^\.\//, ''); if (fs.existsSync(path.resolve(dir, rel))) index.text[audioKey(ref)] = rel; }
  try { ensureSfx(path.join(motionDir, 'sfx')); } catch (e) { notes.push('효과음 라이브러리를 만들지 못했습니다: ' + e.message); }
  fs.mkdirSync(motionDir, { recursive: true });
  const file = path.join(motionDir, 'assets.json'), body = JSON.stringify(index);
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== body) fs.writeFileSync(file, body);
  if (!quiet) for (const n of notes) log('· ' + n);
  return { index, notes };
}
