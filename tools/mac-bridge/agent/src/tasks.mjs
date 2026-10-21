// Task runner: starts Claude Code, Codex or Cursor in the repo folder from a phone request.
// Contract: docs/specs/mac-bridge-protocol-v2-tasks.md
//
// - Always child_process.spawn with an args array, never a shell string, so a
//   prompt can never be run as a shell command.
// - Never passes --dangerously-skip-permissions or any flag that loosens a tool's
//   guard (Cursor: no --force/--yolo/--trust/--approve-mcps/--sandbox). The repo's
//   .claude/settings.json, Codex's default sandbox and Cursor's own settings decide.
// - Runs in MAC_BRIDGE_REPO (default /Users/chrisstanbridge/Developer/fundhub-platform).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { pick as routerPick } from './router.mjs';

export const DEFAULT_REPO = '/Users/chrisstanbridge/Developer/fundhub-platform';
export const MAX_RUNNING = 3;
export const MAX_PROMPT = 20000;
export const KEEP_TASKS = 50;
export const STOP_GRACE_MS = 5000;
const SESSION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
export const TOOLS = ['claude', 'codex', 'cursor'];
const TOOL_NAME = { claude: 'Claude', codex: 'Codex', cursor: 'Cursor' };

function isExecutable(file) {
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return false;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(name, envPath = '') {
  for (const dir of String(envPath).split(path.delimiter)) {
    if (!dir) continue;
    const f = path.join(dir, name);
    if (isExecutable(f)) return f;
  }
  return null;
}

/**
 * Find the Codex CLI: MAC_BRIDGE_CODEX_BIN, then PATH, then inside an app bundle in
 * /Applications (the Codex or ChatGPT desktop app ships it at
 * Contents/Resources/codex-cli/bin/codex). Returns a path or null.
 */
export function findCodex({ env = process.env, appRoots = ['/Applications', path.join(os.homedir(), 'Applications')] } = {}) {
  if (env.MAC_BRIDGE_CODEX_BIN) return isExecutable(env.MAC_BRIDGE_CODEX_BIN) ? env.MAC_BRIDGE_CODEX_BIN : null;
  const p = onPath('codex', env.PATH);
  if (p) return p;
  for (const root of appRoots) {
    let apps = [];
    try {
      apps = fs.readdirSync(root).filter((n) => n.endsWith('.app'));
    } catch {
      continue;
    }
    // Codex.app first, then ChatGPT.app, then anything else.
    const rank = (n) => (/^codex/i.test(n) ? 0 : /^chatgpt/i.test(n) ? 1 : 2);
    apps.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
    for (const app of apps) {
      for (const rel of ['Contents/Resources/codex-cli/bin/codex', 'Contents/Resources/codex', 'Contents/Resources/bin/codex']) {
        const f = path.join(root, app, rel);
        if (isExecutable(f)) return f;
      }
    }
  }
  return null;
}

/** Find the Claude Code CLI: MAC_BRIDGE_CLAUDE_BIN, then PATH, then common install spots. */
export function findClaude({ env = process.env } = {}) {
  if (env.MAC_BRIDGE_CLAUDE_BIN) return isExecutable(env.MAC_BRIDGE_CLAUDE_BIN) ? env.MAC_BRIDGE_CLAUDE_BIN : null;
  const p = onPath('claude', env.PATH);
  if (p) return p;
  const home = os.homedir();
  for (const f of [
    path.join(path.dirname(process.execPath), 'claude'), // same nvm/node install as the helper
    path.join(home, '.claude', 'local', 'claude'),
    path.join(home, '.local', 'bin', 'claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
  ]) {
    if (isExecutable(f)) return f;
  }
  return null;
}

/**
 * Find the Cursor CLI: MAC_BRIDGE_CURSOR_BIN, then `cursor-agent` on PATH or in
 * ~/.local/bin, then `agent` there too (only when it really is Cursor's program,
 * because "agent" is a common name). Returns a path or null.
 */
export function findCursor({ env = process.env, home = os.homedir() } = {}) {
  if (env.MAC_BRIDGE_CURSOR_BIN) return isExecutable(env.MAC_BRIDGE_CURSOR_BIN) ? env.MAC_BRIDGE_CURSOR_BIN : null;
  const local = path.join(home, '.local', 'bin');
  const isCursor = (f) => {
    try {
      return /(?:^|\/)cursor-agent(?:\/|$)/.test(fs.realpathSync(f)); // Cursor installs to .../cursor-agent/versions/<v>/cursor-agent
    } catch {
      return false;
    }
  };
  for (const name of ['cursor-agent', 'agent']) {
    for (const f of [onPath(name, env.PATH), isExecutable(path.join(local, name)) ? path.join(local, name) : null]) {
      if (f && (name === 'cursor-agent' || isCursor(f))) return f;
    }
  }
  return null;
}

/** The argv for one run. Exported so tests can check no loosening flag is ever added. */
export function buildArgs(tool, prompt, resumeSessionId) {
  if (tool === 'claude') {
    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    args.push('--', prompt); // "--" so a prompt that starts with "-" is never read as a flag
    return args;
  }
  if (tool === 'cursor') {
    // headless print mode, same stream-json shape as Claude; Cursor's own guard decides
    const args = ['-p', '--output-format', 'stream-json'];
    if (resumeSessionId) args.push('--resume', resumeSessionId);
    args.push('--', prompt);
    return args;
  }
  // codex: `codex exec --json [resume <id>] -- <prompt>`, default sandbox
  const args = ['exec', '--json'];
  if (resumeSessionId) args.push('resume', '--', resumeSessionId, prompt);
  else args.push('--', prompt);
  return args;
}

/** Pull a session id out of one stdout/stderr line (JSON or plain text). */
export function sessionIdFrom(tool, line) {
  const t = line.trim();
  if (!t) return null;
  if (t.startsWith('{')) {
    let o;
    try {
      o = JSON.parse(t);
    } catch {
      o = null;
    }
    if (o && typeof o === 'object') {
      if (tool === 'claude') return typeof o.session_id === 'string' && o.session_id ? o.session_id : null;
      if (tool === 'cursor') {
        for (const k of ['session_id', 'chatId', 'chat_id']) if (typeof o[k] === 'string' && o[k]) return o[k];
        return null;
      }
      for (const k of ['thread_id', 'session_id', 'conversation_id']) {
        if (typeof o[k] === 'string' && o[k]) return o[k];
      }
      const m = o.msg || o.payload;
      if (m && typeof m === 'object') {
        for (const k of ['thread_id', 'session_id', 'conversation_id']) {
          if (typeof m[k] === 'string' && m[k]) return m[k];
        }
      }
      return null;
    }
  }
  if (tool === 'codex') {
    const m = t.match(/\bsession id:\s*(\S+)/i);
    if (m && UUID_RE.test(m[1])) return m[1];
  }
  return null;
}

/** The tool's own failure text from one stdout JSON line, or null. */
export function errorFrom(tool, line) {
  const s = line.trim();
  if (!s.startsWith('{') || !s.includes('"type"')) return null;
  let o;
  try {
    o = JSON.parse(s);
  } catch {
    return null;
  }
  let msg = null;
  if (tool !== 'codex' && o.type === 'result' && o.is_error) msg = o.result;
  if (tool === 'codex' && o.type === 'error') msg = o.message;
  if (tool === 'codex' && o.type === 'turn.failed') msg = o.error && o.error.message;
  return typeof msg === 'string' && msg.trim() ? msg.replace(/\s+/g, ' ').trim() : null;
}

function publicTask(t) {
  return {
    id: t.id,
    tool: t.tool,
    pickedBy: t.pickedBy,
    pickReason: t.pickReason,
    prompt: t.prompt,
    status: t.status,
    sessionId: t.sessionId,
    startedAt: t.startedAt,
    endedAt: t.endedAt,
    exitCode: t.exitCode,
    error: t.error,
  };
}

/**
 * The env a run gets. When the helper itself was started from inside a Claude Code
 * session, that session's own wiring (CLAUDECODE, CLAUDE_CODE_*, its login relay
 * ANTHROPIC_BASE_URL, ...) would make the new run act as a child of that desk
 * session. A phone task is its own session, so those are left out. Nothing is added.
 */
export function childEnv(env) {
  const out = {};
  const hostSession = !!(env.CLAUDECODE || env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CODE_SESSION_ID);
  for (const [k, v] of Object.entries(env)) {
    if (/^(?:CLAUDECODE|CLAUDE_CODE_\w+|CLAUDE_AGENT_SDK_\w+|CLAUDE_PID|CLAUDE_EFFORT|CLAUDE_PREVIEW_\w+)$/.test(k)) continue;
    if (hostSession && k === 'ANTHROPIC_BASE_URL') continue;
    out[k] = v;
  }
  return out;
}

const bad = (error, extra = {}) => ({ status: 400, body: { error, ...extra } });

/**
 * Emits 'task' (public Task) on every status change.
 * opts: repo, env, claudeBin, codexBin, findBin({tool}) override, maxRunning,
 *       stopGraceMs, keep, findSessionTool(id) -> 'claude' | 'codex' | null
 */
export class TaskRunner extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.env = opts.env || process.env;
    this.repo = opts.repo || this.env.MAC_BRIDGE_REPO || DEFAULT_REPO;
    this.bins = { claude: opts.claudeBin, codex: opts.codexBin, cursor: opts.cursorBin };
    this.binSearch = opts.binSearch || {};
    this.maxRunning = opts.maxRunning ?? MAX_RUNNING;
    this.stopGraceMs = opts.stopGraceMs ?? STOP_GRACE_MS;
    this.keep = opts.keep ?? KEEP_TASKS;
    this.findSessionTool = opts.findSessionTool || (() => null);
    this.tasks = []; // newest first
  }

  running() {
    return this.tasks.filter((t) => t.status === 'starting' || t.status === 'running');
  }

  list() {
    return this.tasks.slice(0, this.keep).map(publicTask);
  }

  get(id) {
    return this.tasks.find((t) => t.id === id) || null;
  }

  #bin(tool) {
    if (this.bins[tool]) return this.bins[tool];
    const env = { ...this.env, ...(this.binSearch.env || {}) };
    if (tool === 'codex') return findCodex({ env, ...(this.binSearch.appRoots ? { appRoots: this.binSearch.appRoots } : {}) });
    if (tool === 'cursor') return findCursor({ env, ...(this.binSearch.home ? { home: this.binSearch.home } : {}) });
    return findClaude({ env });
  }

  #emit(t) {
    this.emit('task', publicTask(t));
  }

  #trim() {
    while (this.tasks.length > this.keep) {
      // drop the oldest finished task; running ones are never dropped (max 3 run at once)
      let i = this.tasks.length - 1;
      while (i >= 0 && (this.tasks[i].status === 'starting' || this.tasks[i].status === 'running')) i--;
      if (i < 0) break;
      this.tasks.splice(i, 1);
    }
  }

  /** Validate, route and start. Returns { status, body } for the HTTP answer. */
  async create(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return bad('bad_request');
    const { tool, prompt, resumeSessionId } = input;
    if (!TOOLS.includes(tool) && tool !== 'auto') return bad('bad_tool');
    if (typeof prompt !== 'string' || !prompt.trim()) return bad('empty_prompt');
    if (prompt.length > MAX_PROMPT) return bad('prompt_too_long', { max: MAX_PROMPT });
    if (resumeSessionId !== undefined && resumeSessionId !== null) {
      if (typeof resumeSessionId !== 'string' || !SESSION_ID_RE.test(resumeSessionId)) return bad('bad_session_id');
    }
    const resume = resumeSessionId || null;

    let picked;
    if (tool !== 'auto') {
      picked = { tool, pickedBy: 'you', pickReason: `You picked ${TOOL_NAME[tool]}.` };
    } else if (resume) {
      const owner = this.findSessionTool(resume);
      if (!owner) return bad('unknown_session', { reason: 'Pick Claude or Codex to continue this chat.' });
      picked = { tool: owner, pickedBy: 'rules', pickReason: `This chat is a ${TOOL_NAME[owner]} chat, so it stays in ${TOOL_NAME[owner]}.` };
    } else {
      picked = await routerPick(prompt, { repo: this.repo, env: this.env });
    }

    if (this.running().length >= this.maxRunning) return { status: 429, body: { error: 'busy' } };

    const t = {
      id: randomUUID(),
      tool: picked.tool,
      pickedBy: picked.pickedBy,
      pickReason: picked.pickReason,
      prompt: prompt.slice(0, 200),
      status: 'starting',
      sessionId: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
      exitCode: null,
      error: null,
      child: null,
      stopRequested: false,
      stderrTail: [],
    };
    if (resume) t.sessionId = resume;
    this.tasks.unshift(t);
    this.#trim();
    this.#emit(t);
    this.#start(t, prompt, resume);
    return { status: 202, body: { task: publicTask(t) } };
  }

  #finish(t, status, { exitCode = null, error = null } = {}) {
    if (t.status !== 'starting' && t.status !== 'running') return;
    t.status = status;
    t.exitCode = exitCode;
    t.error = error;
    t.endedAt = new Date().toISOString();
    clearTimeout(t.killTimer);
    t.child = null;
    this.#emit(t);
  }

  #start(t, prompt, resume) {
    const bin = this.#bin(t.tool);
    if (!bin) return this.#finish(t, 'failed', { error: `${t.tool}_not_found` });
    try {
      if (!fs.statSync(this.repo).isDirectory()) throw new Error();
    } catch {
      return this.#finish(t, 'failed', { error: 'repo_not_found' });
    }
    let child;
    try {
      child = spawn(bin, buildArgs(t.tool, prompt, resume), {
        cwd: this.repo,
        env: childEnv(this.env),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (e) {
      return this.#finish(t, 'failed', { error: `spawn_failed: ${e.code || e.message}` });
    }
    t.child = child;

    child.on('spawn', () => {
      if (t.status !== 'starting') return;
      t.status = 'running';
      this.#emit(t);
    });
    child.on('error', (e) => {
      const code = e && e.code === 'ENOENT' ? `${t.tool}_not_found` : `spawn_failed: ${e.code || e.message}`;
      this.#finish(t, 'failed', { error: code });
    });

    const watch = (stream, isErr) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (d) => {
        buf += d;
        if (buf.length > 4 * 1024 * 1024) buf = buf.slice(-1024 * 1024); // a runaway line never fills memory
        let nl;
        while ((nl = buf.indexOf('\n')) !== -1) {
          this.#line(t, buf.slice(0, nl), isErr);
          buf = buf.slice(nl + 1);
        }
      });
      stream.on('end', () => {
        if (buf) this.#line(t, buf, isErr);
        buf = '';
      });
    };
    watch(child.stdout, false);
    watch(child.stderr, true);

    child.on('close', (code, signal) => {
      if (t.stopRequested) return this.#finish(t, 'stopped', { exitCode: code });
      if (code === 0) return this.#finish(t, 'done', { exitCode: 0 });
      const tail = (t.resultError || t.stderrTail.filter(Boolean).slice(-3).join(' | ')).slice(0, 300);
      const why = code === null ? `ended by signal ${signal}` : `exited with code ${code}`;
      this.#finish(t, 'failed', { exitCode: code, error: tail ? `${why}: ${tail}` : why });
    });
  }

  #line(t, line, isErr) {
    if (isErr) {
      const s = line.trim();
      if (s) {
        t.stderrTail.push(s.slice(0, 300));
        if (t.stderrTail.length > 20) t.stderrTail.shift();
      }
    }
    // The tool's own JSON says why a run failed (a login error, a usage limit).
    if (!isErr) {
      const why = errorFrom(t.tool, line);
      if (why) t.resultError = why;
    }
    // A resumed run can get a new session id; always take what the run says.
    const id = sessionIdFrom(t.tool, line);
    if (id && id !== t.sessionId && SESSION_ID_RE.test(id)) {
      t.sessionId = id;
      if (t.status === 'starting' || t.status === 'running') this.#emit(t);
    }
  }

  /** SIGINT now, SIGTERM after the grace time if it is still going. */
  stop(id) {
    const t = this.get(id);
    if (!t) return null;
    if ((t.status === 'starting' || t.status === 'running') && t.child && !t.stopRequested) {
      t.stopRequested = true;
      const child = t.child;
      try {
        child.kill('SIGINT');
      } catch {}
      t.killTimer = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill('SIGTERM');
          } catch {}
        }
      }, this.stopGraceMs);
      t.killTimer.unref?.();
    }
    return publicTask(t);
  }

  /** Helper is shutting down: ask every run to stop. */
  shutdown() {
    for (const t of this.running()) this.stop(t.id);
  }
}
