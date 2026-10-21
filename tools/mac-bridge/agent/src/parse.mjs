// Turns one JSONL line from a Claude Code, Codex or Cursor session file into zero or
// more protocol Events (without seq; the scanner adds seq in file order).
// A parser keeps a tiny amount of state (tool calls waiting for their result),
// which can be snapshotted so a scan can resume from a byte offset.
import { basename } from 'node:path';

export const MAX_TEXT = 8000;

export function cut(value, max = MAX_TEXT) {
  const s = value == null ? '' : String(value);
  if (s.length <= max) return s;
  let end = max - 1;
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end -= 1; // do not split a surrogate pair
  return s.slice(0, end) + '…';
}

function oneLine(s, max) {
  return cut(String(s ?? '').replace(/\s+/g, ' ').trim(), max);
}

export function projectName(cwd) {
  if (!cwd || typeof cwd !== 'string') return '';
  let p = cwd.replace(/\/+$/, '');
  const i = p.indexOf('/.claude/worktrees/');
  if (i > 0) p = p.slice(0, i);
  return basename(p) || p;
}

const PREFERRED_KEYS = [
  'file_path', 'path', 'command', 'cmd', 'pattern', 'query', 'url',
  'description', 'skill', 'title', 'task_name', 'target', 'name', 'prompt', 'subject', 'message',
];

function shortInput(input) {
  if (input == null) return '';
  if (typeof input === 'string') return oneLine(input, 200);
  if (typeof input !== 'object') return oneLine(input, 200);
  for (const k of PREFERRED_KEYS) {
    const v = input[k];
    if (typeof v === 'string' && v && !v.startsWith('gAAAA')) return oneLine(v, 200);
  }
  try {
    return oneLine(JSON.stringify(input), 200);
  } catch {
    return '';
  }
}

function flattenText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : p && typeof p.text === 'string' ? p.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  if (typeof content.text === 'string') return content.text;
  return '';
}

function ev(ts, kind, text, extra) {
  return { ts, kind, text: cut(text), ...extra };
}

// ---------------------------------------------------------------- Claude

function tagBody(s, tag) {
  const m = s.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

function claudeUserTextEvents(ts, raw) {
  const out = [];
  let s = String(raw);
  const bashIn = tagBody(s, 'bash-input');
  if (bashIn !== null) {
    out.push(ev(ts, 'command', bashIn.trim(), { command: cut(bashIn.trim()) }));
  }
  const so = tagBody(s, 'bash-stdout');
  const se = tagBody(s, 'bash-stderr');
  if (so !== null || se !== null) {
    const text = [so, se].filter((x) => x && x.trim()).join('\n');
    out.push(ev(ts, 'output', text, {}));
  }
  if (bashIn !== null || so !== null || se !== null) return out;

  const cmdName = tagBody(s, 'command-name');
  if (cmdName !== null) {
    const args = tagBody(s, 'command-args');
    return [ev(ts, 'system', `Ran ${cmdName.trim()}${args && args.trim() ? ' ' + args.trim() : ''}`)];
  }
  const lco = tagBody(s, 'local-command-stdout');
  if (lco !== null) return lco.trim() ? [ev(ts, 'system', lco.trim())] : [];
  if (/^\s*<local-command-caveat>/.test(s)) return [];
  if (/^\s*<task-notification>/.test(s)) {
    const summary = tagBody(s, 'summary');
    return [ev(ts, 'system', summary ? summary.trim() : 'Background task update')];
  }
  s = s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
  if (!s) return [];
  if (/^\[Request interrupted/.test(s)) return [ev(ts, 'system', s)];
  return [ev(ts, 'user', s)];
}

class ClaudeParser {
  constructor(snapshot) {
    this.state = { pending: {}, lastTs: null, ...(snapshot || {}) };
    this.state.pending = { ...(this.state.pending || {}) };
    this.meta = { cwd: '', title: '' };
  }

  snapshot() {
    return { pending: { ...this.state.pending }, lastTs: this.state.lastTs };
  }

  feed(o) {
    if (!o || typeof o !== 'object') return [];
    if (typeof o.cwd === 'string' && o.cwd && !this.meta.cwd) this.meta.cwd = o.cwd;
    const ts = typeof o.timestamp === 'string' ? o.timestamp : this.state.lastTs;
    if (typeof o.timestamp === 'string') this.state.lastTs = o.timestamp;
    if (o.isSidechain === true || o.isMeta === true) return [];

    if (o.type === 'system') {
      if (o.subtype === 'compact_boundary') return [ev(ts, 'system', 'Conversation compacted')];
      return [];
    }
    if (o.type !== 'user' && o.type !== 'assistant') return [];
    const content = o.message && o.message.content;
    const out = [];

    if (o.type === 'user') {
      if (typeof content === 'string') return claudeUserTextEvents(ts, content);
      if (!Array.isArray(content)) return [];
      for (const b of content) {
        if (!b || typeof b !== 'object') continue;
        if (b.type === 'text' && typeof b.text === 'string') {
          out.push(...claudeUserTextEvents(ts, b.text));
        } else if (b.type === 'tool_result') {
          const kind = this.state.pending[b.tool_use_id];
          if (kind !== 'bash') {
            delete this.state.pending[b.tool_use_id];
            continue; // only shell output is shown; other tool results are noise
          }
          delete this.state.pending[b.tool_use_id];
          let text = flattenText(b.content);
          let exitCode = b.is_error ? 1 : 0;
          const m = text.match(/^Exit code (-?\d+)\n?/);
          if (m) {
            exitCode = Number(m[1]);
            text = text.slice(m[0].length);
          }
          out.push(ev(ts, 'output', text, { exitCode }));
        }
      }
      return out;
    }

    // assistant
    if (typeof content === 'string') return content.trim() ? [ev(ts, 'assistant', content)] : [];
    if (!Array.isArray(content)) return [];
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) {
        out.push(ev(ts, 'assistant', b.text));
      } else if (b.type === 'tool_use') {
        if (b.name === 'Bash' && b.input && typeof b.input.command === 'string') {
          if (b.id) this.state.pending[b.id] = 'bash';
          out.push(ev(ts, 'command', b.input.command, { command: cut(b.input.command) }));
        } else {
          const detail = shortInput(b.input);
          out.push(ev(ts, 'tool', `${b.name || 'tool'}${detail ? ' ' + detail : ''}`));
        }
      }
    }
    return out;
  }
}

// ----------------------------------------------------------------- Codex

const CODEX_INJECTED = [
  /^\s*# AGENTS\.md instructions/,
  /^\s*<environment_context>/,
  /^\s*<user_instructions>/,
  /^\s*<turn_aborted>/,
  /^\s*<subagent_notification>/,
  /^\s*<codex_delegation>/,
  /^\s*<external_codex_apps_/,
  /^\s*The following is the Codex agent history/,
];

const CODEX_SKIP_CALLS = new Set([
  'write_stdin', 'wait', 'wait_agent', 'sleep', 'curr_time', 'list_agents', 'tool_search_tool',
  'load_workspace_dependencies',
]);

function codexCommandFromArgs(args) {
  if (!args || typeof args !== 'object') return null;
  let c = args.cmd ?? args.command;
  if (Array.isArray(c)) {
    // ["bash","-lc","the command"] -> the command
    c = c.length >= 3 && /^(ba|z)?sh$|bash$|zsh$/.test(String(c[0])) && /^-\w*c$/.test(String(c[1]))
      ? c[2]
      : c.join(' ');
  }
  return typeof c === 'string' && c.trim() ? c : null;
}

function parseExecOutput(out) {
  let s = typeof out === 'string' ? out : flattenText(out);
  let exitCode;
  // old format: a JSON string {"output": "...", "metadata": {"exit_code": 0}}
  if (s.startsWith('{')) {
    try {
      const j = JSON.parse(s);
      if (j && typeof j.output === 'string') {
        const ec = j.metadata && j.metadata.exit_code;
        return { text: j.output, exitCode: typeof ec === 'number' ? ec : undefined };
      }
    } catch {}
  }
  const m = s.match(/Process exited with code (-?\d+)/);
  if (m) exitCode = Number(m[1]);
  const i = s.indexOf('\nOutput:\n');
  if (i >= 0) s = s.slice(i + 9);
  return { text: s, exitCode };
}

function collectOutputs(v, acc, depth = 0) {
  if (depth > 4 || v == null) return;
  if (Array.isArray(v)) return v.forEach((x) => collectOutputs(x, acc, depth + 1));
  if (typeof v === 'object') {
    if (typeof v.output === 'string') acc.texts.push(v.output);
    if (typeof v.exit_code === 'number' && acc.exitCode === undefined) acc.exitCode = v.exit_code;
    for (const k of Object.keys(v)) if (k !== 'output') collectOutputs(v[k], acc, depth + 1);
  }
}

function parseScriptOutput(out) {
  let body = typeof out === 'string' ? out : flattenText(out);
  body = body.replace(/^Script (completed|failed)[^\n]*\n(Wall time[^\n]*\n)?(Output:\n)?/, '');
  const acc = { texts: [], exitCode: undefined };
  try {
    collectOutputs(JSON.parse(body), acc);
  } catch {}
  return { text: acc.texts.length ? acc.texts.join('\n') : body, exitCode: acc.exitCode };
}

function extractExecCommands(code) {
  const cmds = [];
  const re = /["']?\bcmd["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)/g;
  let m;
  while ((m = re.exec(code))) {
    const lit = m[1];
    try {
      if (lit[0] === '"') cmds.push(JSON.parse(lit));
      else if (lit[0] === "'") cmds.push(lit.slice(1, -1).replace(/\\'/g, "'").replace(/\\n/g, '\n').replace(/\\\\/g, '\\'));
      else cmds.push(lit.slice(1, -1));
    } catch {}
  }
  return cmds.filter((c) => c.trim());
}

class CodexParser {
  constructor(snapshot) {
    this.state = { pending: {}, lastTs: null, ...(snapshot || {}) };
    this.state.pending = { ...(this.state.pending || {}) };
    this.meta = { cwd: '', title: '' };
  }

  snapshot() {
    return { pending: { ...this.state.pending }, lastTs: this.state.lastTs };
  }

  feed(o) {
    if (!o || typeof o !== 'object') return [];
    const ts = typeof o.timestamp === 'string' ? o.timestamp : this.state.lastTs;
    if (typeof o.timestamp === 'string') this.state.lastTs = o.timestamp;
    let type = o.type;
    let p = o.payload;
    if (p === undefined && typeof type === 'string' && type !== 'session_meta') {
      p = o; // very old rollouts have the item at the top level
      type = 'response_item';
    }
    if (!p || typeof p !== 'object') return [];

    if (type === 'session_meta') {
      if (typeof p.cwd === 'string' && !this.meta.cwd) this.meta.cwd = p.cwd;
      return [];
    }
    if (type === 'compacted') return [ev(ts, 'system', 'Context compacted')];
    if (type === 'event_msg') {
      if (p.type === 'task_complete' && p.error && typeof p.error.message === 'string') {
        return [ev(ts, 'system', p.error.message)];
      }
      return [];
    }
    if (type !== 'response_item') return [];

    switch (p.type) {
      case 'message': {
        if (p.role !== 'user' && p.role !== 'assistant') return [];
        const parts = Array.isArray(p.content) ? p.content : [];
        const texts = parts
          .filter((c) => c && typeof c.text === 'string' && (c.type === 'input_text' || c.type === 'output_text' || c.type === 'text'))
          .map((c) => c.text)
          .filter((t) => t.trim() && !(p.role === 'user' && CODEX_INJECTED.some((re) => re.test(t))));
        if (!texts.length) return [];
        return [ev(ts, p.role, texts.join('\n\n'))];
      }
      case 'function_call': {
        const name = p.name || 'tool';
        if (CODEX_SKIP_CALLS.has(name)) return [];
        let args = p.arguments;
        if (typeof args === 'string') {
          try {
            args = JSON.parse(args);
          } catch {
            args = { raw: args };
          }
        }
        if (name === 'exec_command' || name === 'shell' || name === 'container.exec' || name === 'local_shell') {
          const cmd = codexCommandFromArgs(args);
          if (cmd) {
            if (p.call_id) this.state.pending[p.call_id] = 'cmd';
            return [ev(ts, 'command', cmd, { command: cut(cmd) })];
          }
        }
        const detail = shortInput(args);
        return [ev(ts, 'tool', `${name}${detail ? ' ' + detail : ''}`)];
      }
      case 'local_shell_call': {
        const cmd = codexCommandFromArgs(p.action);
        if (!cmd) return [];
        if (p.call_id) this.state.pending[p.call_id] = 'cmd';
        return [ev(ts, 'command', cmd, { command: cut(cmd) })];
      }
      case 'function_call_output': {
        if (this.state.pending[p.call_id] !== 'cmd') return [];
        delete this.state.pending[p.call_id];
        const r = parseExecOutput(p.output);
        return [ev(ts, 'output', r.text, r.exitCode === undefined ? {} : { exitCode: r.exitCode })];
      }
      case 'custom_tool_call': {
        const input = typeof p.input === 'string' ? p.input : '';
        if (p.name === 'apply_patch') {
          const files = [...input.matchAll(/^\*\*\* (Update|Add|Delete) File: (.+)$/gm)].map((m) => m[2]);
          return [ev(ts, 'tool', `apply_patch ${files.join(', ')}`.trim())];
        }
        if (p.name === 'exec') {
          const cmds = extractExecCommands(input);
          if (cmds.length) {
            if (p.call_id) this.state.pending[p.call_id] = 'script';
            return cmds.map((c) => ev(ts, 'command', c, { command: cut(c) }));
          }
          return [ev(ts, 'tool', `exec ${oneLine(input, 200)}`.trim())];
        }
        return [ev(ts, 'tool', `${p.name || 'tool'} ${oneLine(input, 200)}`.trim())];
      }
      case 'custom_tool_call_output': {
        if (this.state.pending[p.call_id] !== 'script') return [];
        delete this.state.pending[p.call_id];
        const r = parseScriptOutput(p.output);
        return [ev(ts, 'output', r.text, r.exitCode === undefined ? {} : { exitCode: r.exitCode })];
      }
      default:
        return [];
    }
  }
}

// ---------------------------------------------------------------- Cursor
//
// Cursor agent transcripts: ~/.cursor/projects/<slug>/agent-transcripts/<id>/<id>.jsonl
// Lines: { role, message: { content: [text | tool_use] } } and
// { type: "turn_ended", status, error }. No per-line time, no folder, no tool
// results (so Cursor shell calls show as commands without output).

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "Monday, Oct 12, 2026, 7:46 PM (UTC-7)" -> ISO, or null. */
export function cursorTimestamp(s) {
  const m = String(s).match(/([A-Za-z]{3})[a-z]*\.? (\d{1,2}), (\d{4}),? (\d{1,2}):(\d{2}) ?(AM|PM)? ?\(UTC(?:([+-])(\d{1,2})(?::?(\d{2}))?)?\)/i);
  if (!m) return null;
  const mon = MONTHS[m[1].toLowerCase()];
  if (mon === undefined) return null;
  let h = Number(m[4]); // 24-hour clock when there is no AM/PM
  if (m[6]) h = (h % 12) + (m[6].toUpperCase() === 'PM' ? 12 : 0);
  const offMin = m[7] ? (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9] || 0)) : 0;
  const t = Date.UTC(Number(m[3]), mon, Number(m[2]), h, Number(m[5])) - offMin * 60000;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

const CURSOR_SKIP_TOOLS = new Set(['UpdateCurrentStep', 'GetDynamicTools', 'AwaitShell']);

class CursorParser {
  constructor(snapshot) {
    this.state = { lastTs: null, ...(snapshot || {}) };
    this.meta = { cwd: '', title: '' };
  }

  snapshot() {
    return { lastTs: this.state.lastTs };
  }

  feed(o) {
    if (!o || typeof o !== 'object') return [];
    if (o.type === 'turn_ended') {
      // "new_message_submitted" just means the user typed again; not worth a line
      if (o.status === 'aborted' || (o.status === 'error' && o.error && o.error !== 'new_message_submitted')) {
        return [ev(this.state.lastTs, 'system', typeof o.error === 'string' ? o.error : 'Turn ended')];
      }
      return [];
    }
    if (o.role !== 'user' && o.role !== 'assistant') return [];
    const content = o.message && o.message.content;
    const parts = typeof content === 'string' ? [{ type: 'text', text: content }] : Array.isArray(content) ? content : [];
    const out = [];
    if (o.role === 'user') {
      for (const b of parts) {
        if (!b || b.type !== 'text' || typeof b.text !== 'string') continue;
        const stamp = tagBody(b.text, 'timestamp');
        const ts = stamp ? cursorTimestamp(stamp) : null;
        if (ts) this.state.lastTs = ts;
        const q = tagBody(b.text, 'user_query');
        const text = (q !== null ? q : b.text.replace(/<(\w+)>[\s\S]*?<\/\1>/g, '')).trim();
        if (text) out.push(ev(this.state.lastTs, 'user', text));
      }
      return out;
    }
    const ts = this.state.lastTs;
    for (const b of parts) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'text' && typeof b.text === 'string') {
        const t = b.text.replace(/\[REDACTED\]/g, '').trim(); // hidden thinking
        if (t) out.push(ev(ts, 'assistant', t));
      } else if (b.type === 'tool_use') {
        let name = b.name || 'tool';
        let input = b.input;
        if (name === 'CallDynamicTool' && input && typeof input === 'object') {
          name = input.toolName || 'tool';
          input = input.arguments;
        }
        if (CURSOR_SKIP_TOOLS.has(name)) continue;
        if (name === 'Shell' && input && typeof input.command === 'string') {
          out.push(ev(ts, 'command', input.command, { command: cut(input.command) }));
        } else {
          const detail = shortInput(input);
          out.push(ev(ts, 'tool', `${name}${detail ? ' ' + detail : ''}`));
        }
      }
    }
    return out;
  }
}

/** Cursor folder slug ("Users-me-Developer-my-app") -> a readable project name ("my-app"). */
export function cursorProjectName(slug) {
  let s = String(slug || '');
  s = s.replace(/-claude-worktrees-.*$/, '');
  const parts = s.split('-');
  if (parts[0] === 'Users' && parts.length > 2) {
    parts.splice(0, 2);
    if (parts.length > 1 && /^(Developer|Documents|Desktop|Projects|projects|code|Code|src|repos|git|work)$/.test(parts[0])) parts.shift();
  }
  return parts.join('-') || s;
}

export function createParser(tool, snapshot) {
  if (tool === 'codex') return new CodexParser(snapshot);
  if (tool === 'cursor') return new CursorParser(snapshot);
  return new ClaudeParser(snapshot);
}

/** Parse every complete line of a text blob; handy for tests and small tools. */
export function parseLines(tool, text) {
  const parser = createParser(tool);
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    for (const e of parser.feed(o)) events.push({ seq: events.length + 1, ...e });
  }
  return { events, meta: parser.meta };
}
