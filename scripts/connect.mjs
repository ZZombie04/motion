#!/usr/bin/env node
// 이 저장소를 Claude Code · Codex의 스킬로 연결하고, 원하면 MCP 서버로도 등록한다.
//   node scripts/connect.mjs            스킬 연결(있는 도구만) + MCP 등록 방법 안내
//   node scripts/connect.mjs --mcp      MCP 서버까지 등록(Claude Code · Codex · Claude Desktop 설정을 수정)
//   node scripts/connect.mjs --remove   연결 해제
//   --dry-run  무엇을 할지 보여 주기만
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = new Set(process.argv.slice(2));
const DRY = argv.has('--dry-run'), REMOVE = argv.has('--remove'), MCP = argv.has('--mcp');
const home = os.homedir();
const serverJs = path.join(root, 'mcp', 'server.mjs');
const say = (s) => console.log(s);
const done = [], todo = [];

function linkSkill(label, skillsDir) {
  const base = path.dirname(skillsDir);
  if (!fs.existsSync(base)) { say(`· ${label}: 설치돼 있지 않아 건너뜁니다 (${base})`); return; }
  const dest = path.join(skillsDir, 'motion');
  const exists = fs.existsSync(dest) || (() => { try { fs.lstatSync(dest); return true; } catch { return false; } })();
  if (REMOVE) {
    if (!exists) return;
    const st = fs.lstatSync(dest);
    if (!st.isSymbolicLink() && fs.existsSync(path.join(dest, '.git'))) { say(`· ${label}: ${dest} 는 직접 복제한 폴더라 지우지 않았습니다.`); return; }
    if (!DRY) fs.rmSync(dest, { recursive: !st.isSymbolicLink(), force: true });
    done.push(`${label} 스킬 연결 해제: ${dest}`); return;
  }
  if (exists) {
    let same = false; try { same = fs.realpathSync(dest) === fs.realpathSync(root); } catch { /* broken link */ }
    if (same) { say(`· ${label}: 이미 연결돼 있습니다 (${dest})`); return; }
    say(`· ${label}: ${dest} 가 이미 있어 그대로 두었습니다(다른 내용). 직접 확인하세요.`); return;
  }
  if (!DRY) { fs.mkdirSync(skillsDir, { recursive: true }); fs.symlinkSync(root, dest, process.platform === 'win32' ? 'junction' : 'dir'); }
  done.push(`${label} 스킬 연결: ${dest} → ${root}`);
}

function claudeCodeMcp() {
  const has = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['claude'], { encoding: 'utf8' }).status === 0;
  const cmd = `claude mcp add motion --scope user -- node "${serverJs}"`;
  if (!has) { todo.push(`Claude Code MCP: \`${cmd}\``); return; }
  if (REMOVE) { if (!DRY) spawnSync('claude', ['mcp', 'remove', 'motion', '--scope', 'user'], { stdio: 'ignore', shell: true }); done.push('Claude Code MCP 해제'); return; }
  if (!MCP) { todo.push(`Claude Code MCP: \`${cmd}\``); return; }
  if (!DRY) { const r = spawnSync('claude', ['mcp', 'add', 'motion', '--scope', 'user', '--', 'node', serverJs], { encoding: 'utf8', shell: true }); if (r.status !== 0) { todo.push(`Claude Code MCP(자동 등록 실패): \`${cmd}\``); return; } }
  done.push('Claude Code MCP 등록: motion');
}

function codexMcp() {
  const cfg = path.join(home, '.codex', 'config.toml');
  if (!fs.existsSync(path.dirname(cfg))) return;
  const block = `\n[mcp_servers.motion]\ncommand = "node"\nargs = [${JSON.stringify(serverJs)}]\n`;
  const cur = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : '';
  const present = /^\[mcp_servers\.motion\]/m.test(cur);
  if (REMOVE) {
    if (!present) return;
    if (!DRY) { fs.copyFileSync(cfg, cfg + '.bak-motion'); fs.writeFileSync(cfg, cur.replace(/\n?\[mcp_servers\.motion\][^\[]*/m, '\n')); }
    done.push(`Codex MCP 해제: ${cfg}`); return;
  }
  if (present) { say('· Codex MCP: 이미 등록돼 있습니다'); return; }
  if (!MCP) { todo.push(`Codex MCP: ${cfg} 끝에 추가 →${block.replace(/\n/g, '\n    ')}`); return; }
  if (!DRY) { if (cur) fs.copyFileSync(cfg, cfg + '.bak-motion'); fs.writeFileSync(cfg, cur.replace(/\s*$/, '\n') + block); }
  done.push(`Codex MCP 등록: ${cfg} (백업: config.toml.bak-motion)`);
}

function desktopMcp() {
  const file = process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'Claude', 'claude_desktop_config.json')
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') : path.join(home, '.config', 'Claude', 'claude_desktop_config.json');
  if (!fs.existsSync(path.dirname(file))) return;
  let json = {}; try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* new file */ }
  json.mcpServers = json.mcpServers || {};
  const present = !!json.mcpServers.motion;
  const snippet = JSON.stringify({ mcpServers: { motion: { command: 'node', args: [serverJs] } } }, null, 2);
  if (REMOVE) { if (!present) return; delete json.mcpServers.motion; if (!DRY) { fs.copyFileSync(file, file + '.bak-motion'); fs.writeFileSync(file, JSON.stringify(json, null, 2)); } done.push(`Claude Desktop MCP 해제: ${file}`); return; }
  if (present) { say('· Claude Desktop MCP: 이미 등록돼 있습니다'); return; }
  if (!MCP) { todo.push(`Claude Desktop MCP: ${file} 에 병합 →\n    ${snippet.replace(/\n/g, '\n    ')}`); return; }
  json.mcpServers.motion = { command: 'node', args: [serverJs] };
  if (!DRY) { if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak-motion'); fs.writeFileSync(file, JSON.stringify(json, null, 2)); }
  done.push(`Claude Desktop MCP 등록: ${file} (앱을 다시 시작하세요)`);
}

say(`Motion Director — ${REMOVE ? '연결 해제' : '연결'}${DRY ? ' (dry-run)' : ''}\n저장소: ${root}\n`);
if (!REMOVE && !fs.existsSync(path.join(root, 'node_modules', 'puppeteer-core'))) say('! 먼저 이 폴더에서 `npm install` 을 실행하세요.\n');
linkSkill('Claude Code', path.join(home, '.claude', 'skills'));
linkSkill('Codex', path.join(home, '.codex', 'skills'));
claudeCodeMcp(); codexMcp(); desktopMcp();

if (done.length) say('\n완료\n' + done.map((s) => '  ✓ ' + s).join('\n'));
if (todo.length) say('\nMCP 서버로도 쓰려면 (`--mcp`를 붙여 다시 실행하면 자동 등록)\n' + todo.map((s) => '  · ' + s).join('\n'));
if (!REMOVE) say('\n새 세션에서 "…영상 만들어줘"라고 말하면 스킬이 동작합니다. 환경 확인: node bin/motion.mjs doctor');
