#!/usr/bin/env node
// Register the Mac Bridge MCP server ("mac-bridge") in Claude Code, Codex and
// Cursor at the USER level, so all three can see the Mac's sessions and hand
// tasks to each other. Safe to run again: it only changes what is different.
//
//   node tools/mac-bridge/install/register-mcp.mjs                 # server next to this file
//   node tools/mac-bridge/install/register-mcp.mjs --server <path> # point at another server.mjs
//   options: --node <path>  --only claude,codex,cursor  --dry-run
//
// Claude Code: `claude mcp add --scope user` (user config, not the repo .mcp.json).
// Codex:       a [mcp_servers.mac-bridge] table in ~/.codex/config.toml
//              (backup first: ~/.codex/config.toml.bak-macbridge; nothing else is touched).
// Cursor:      "mac-bridge" in ~/.cursor/mcp.json (backup first: ~/.cursor/mcp.json.bak-macbridge;
//              other servers kept), then `agent mcp enable mac-bridge` when the Cursor CLI is installed.
// Node 22, built-ins only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const NAME = 'mac-bridge';
const HERE = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const out = { server: path.resolve(HERE, '..', 'mcp', 'server.mjs'), node: process.execPath, only: ['claude', 'codex', 'cursor'], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--server') out.server = path.resolve(argv[++i]);
    else if (a === '--node') out.node = path.resolve(argv[++i]);
    else if (a === '--only') out.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '-h' || a === '--help') {
      console.log('usage: register-mcp.mjs [--server <server.mjs>] [--node <node>] [--only claude,codex,cursor] [--dry-run]');
      process.exit(0);
    } else throw new Error(`unknown option ${a}`);
  }
  return out;
}

function backupOnce(file) {
  const bak = `${file}.bak-macbridge`;
  if (fs.existsSync(file) && !fs.existsSync(bak)) fs.copyFileSync(file, bak);
  return bak;
}

function which(cmd) {
  const r = spawnSync('/bin/sh', ['-c', `command -v ${cmd}`], { encoding: 'utf8' });
  const p = r.stdout.trim();
  if (p) return p;
  const local = path.join(os.homedir(), '.local', 'bin', cmd);
  return fs.existsSync(local) ? local : null;
}

// ---------- Codex (TOML) ----------

const tomlStr = (s) => JSON.stringify(s); // TOML basic strings use the same escapes as JSON for paths

export function codexBlock(node, server) {
  return [
    `[mcp_servers.${NAME}]`,
    `command = ${tomlStr(node)}`,
    `args = [${tomlStr(server)}]`,
    'startup_timeout_sec = 20',
    '',
  ].join('\n');
}

/**
 * Put our table into config.toml text. Replaces an existing [mcp_servers.mac-bridge]
 * table (and its sub-tables) in place; otherwise appends. Everything else is kept.
 */
export function upsertCodexToml(text, block) {
  const lines = text.split('\n');
  const header = /^\s*\[\s*mcp_servers\s*\.\s*(?:"mac-bridge"|mac-bridge)\s*(?:\.[^\]]*)?\]\s*(?:#.*)?$/;
  const anyHeader = /^\s*\[\[?[^\]]+\]\]?\s*(?:#.*)?$/;
  const out = [];
  let skipping = false;
  let replaced = false;
  for (const line of lines) {
    if (header.test(line)) {
      skipping = true;
      if (!replaced) {
        out.push(...block.trimEnd().split('\n'));
        out.push('');
        replaced = true;
      }
      continue;
    }
    if (skipping && anyHeader.test(line)) skipping = false;
    if (!skipping) out.push(line);
  }
  if (replaced) return out.join('\n').replace(/\n{3,}/g, '\n\n');
  const base = text.endsWith('\n') || text === '' ? text : text + '\n';
  return `${base}${base.trim() ? '\n' : ''}${block}`;
}

function registerCodex({ node, server, dryRun }) {
  const file = path.join(os.homedir(), '.codex', 'config.toml');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const after = upsertCodexToml(before, codexBlock(node, server));
  if (after === before) return `Codex: already set in ${file}`;
  if (dryRun) return `Codex: would update ${file}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bak = backupOnce(file);
  fs.writeFileSync(file, after);
  return `Codex: wrote [mcp_servers.${NAME}] to ${file}${fs.existsSync(bak) ? ` (backup ${bak})` : ''}`;
}

// ---------- Cursor (JSON) ----------

export function upsertCursorJson(text, node, server) {
  let j = {};
  if (text && text.trim()) j = JSON.parse(text);
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error('~/.cursor/mcp.json is not a JSON object');
  j.mcpServers = j.mcpServers && typeof j.mcpServers === 'object' ? j.mcpServers : {};
  j.mcpServers[NAME] = { command: node, args: [server] };
  return JSON.stringify(j, null, 2) + '\n';
}

function registerCursor({ node, server, dryRun }) {
  const file = path.join(os.homedir(), '.cursor', 'mcp.json');
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const after = upsertCursorJson(before, node, server);
  const msgs = [];
  if (after === before) msgs.push(`Cursor: already set in ${file}`);
  else if (dryRun) msgs.push(`Cursor: would update ${file}`);
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bak = before ? backupOnce(file) : null;
    fs.writeFileSync(file, after);
    msgs.push(`Cursor: wrote "${NAME}" to ${file}${bak ? ` (backup ${bak})` : ''}`);
  }
  const agent = which('cursor-agent') || which('agent');
  if (agent && !dryRun) {
    const r = spawnSync(agent, ['mcp', 'enable', NAME], { encoding: 'utf8', cwd: os.homedir(), timeout: 30000 });
    msgs.push(r.status === 0 ? 'Cursor CLI: mac-bridge approved (agent mcp enable)' : `Cursor CLI: could not approve yet (${(r.stderr || r.stdout || '').trim().split('\n')[0] || `exit ${r.status}`})`);
  } else if (!agent) msgs.push('Cursor CLI: not installed, skipped the approve step');
  return msgs.join('\n');
}

// ---------- Claude Code (CLI) ----------

function claudeCurrent() {
  // Read only our own entry from the user config.
  try {
    const j = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude.json'), 'utf8'));
    return (j.mcpServers && j.mcpServers[NAME]) || null;
  } catch {
    return null;
  }
}

function registerClaude({ node, server, dryRun }) {
  const claude = which('claude');
  if (!claude) return 'Claude Code: `claude` command not found, skipped';
  const cur = claudeCurrent();
  if (cur && cur.command === node && JSON.stringify(cur.args || []) === JSON.stringify([server])) {
    return 'Claude Code: already set (user scope)';
  }
  if (dryRun) return 'Claude Code: would run claude mcp add --scope user';
  if (cur) execFileSync(claude, ['mcp', 'remove', '--scope', 'user', NAME], { stdio: ['ignore', 'ignore', 'inherit'] });
  execFileSync(claude, ['mcp', 'add', '--scope', 'user', NAME, '--', node, server], { stdio: ['ignore', 'ignore', 'inherit'] });
  return `Claude Code: added "${NAME}" at user scope (~/.claude.json)`;
}

export function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (!fs.existsSync(opts.server)) throw new Error(`server not found: ${opts.server}`);
  if (!fs.existsSync(opts.node)) throw new Error(`node not found: ${opts.node}`);
  console.log(`mac-bridge MCP → ${opts.node} ${opts.server}`);
  const steps = { claude: registerClaude, codex: registerCodex, cursor: registerCursor };
  let failed = 0;
  for (const tool of opts.only) {
    if (!steps[tool]) throw new Error(`unknown tool ${tool} (use claude, codex, cursor)`);
    try {
      console.log(steps[tool](opts));
    } catch (e) {
      failed++;
      console.error(`${tool}: FAILED — ${e.message}`);
    }
  }
  process.exitCode = failed ? 1 : 0;
}

const isMain = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) main();
