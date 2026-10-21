#!/usr/bin/env node
// Mac Bridge MCP server.
//
// Lets Claude Code, Codex and Cursor plug into the Mac Bridge helper: see every
// session, read one, hand a task to another tool, list and stop tasks.
//
// Transport: stdio, JSON-RPC 2.0, one JSON message per line (MCP spec).
// Talks to the helper at http://127.0.0.1:${MAC_BRIDGE_PORT || 7878} with the
// token in ~/.mac-bridge/token (MAC_BRIDGE_TOKEN_FILE overrides).
// Node 22, built-ins only. stdout carries protocol messages ONLY; logs go to stderr.
//
// Contracts: docs/specs/mac-bridge-protocol-v1.md, docs/specs/mac-bridge-protocol-v2-tasks.md
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

// Anything that tries to print to stdout goes to stderr instead.
console.log = console.error;
console.info = console.error;
console.debug = console.error;

export const SERVER_INFO = { name: 'mac-bridge', version: '1.0.0' };
export const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const START_HINT = 'start it with node tools/mac-bridge/agent/bin/mac-bridge.mjs';
const REQUEST_TIMEOUT_MS = Number(process.env.MAC_BRIDGE_MCP_TIMEOUT_MS) || 15000;
const OLD_HELPER = `The running Mac Bridge helper is the older watch-only version, so it cannot take tasks. Stop it and ${START_HINT} from the newest code.`;
const TOOL_NAMES ={ claude: 'Claude', codex: 'Codex', cursor: 'Cursor', auto: 'Auto' };

function helperBase() {
  const port = Number(process.env.MAC_BRIDGE_PORT) || 7878;
  return `http://127.0.0.1:${port}`;
}

function tokenFile() {
  return process.env.MAC_BRIDGE_TOKEN_FILE || path.join(os.homedir(), '.mac-bridge', 'token');
}

/** A tool error with plain words for the person reading it. */
class BridgeError extends Error {}

function readToken() {
  let t;
  try {
    t = fs.readFileSync(tokenFile(), 'utf8').trim();
  } catch {
    throw new BridgeError(`No Mac Bridge token at ${tokenFile()}. The helper makes it on first run — ${START_HINT}`);
  }
  if (!t) throw new BridgeError(`The Mac Bridge token file ${tokenFile()} is empty. Restart the helper — ${START_HINT}`);
  return t;
}

/** Call the helper. Returns parsed JSON. Throws BridgeError with plain words. */
export async function callHelper(method, pathname, body) {
  const token = readToken();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQUEST_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(helperBase() + pathname, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
  } catch (e) {
    if (ac.signal.aborted) {
      throw new BridgeError(`The Mac Bridge helper did not answer in ${Math.round(REQUEST_TIMEOUT_MS / 1000)} seconds. Check it is running — ${START_HINT}`);
    }
    throw new BridgeError(`Mac Bridge helper is not running — ${START_HINT}`);
  } finally {
    clearTimeout(timer);
  }
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (res.ok) return data;
  throw new BridgeError(explainHttpError(res.status, data, { method, pathname, body }));
}

function explainHttpError(status, data, { pathname, body }) {
  const word = data && typeof data.error === 'string' ? data.error : '';
  if (status === 401) return `The Mac Bridge helper said the token is wrong. The token in ${tokenFile()} does not match the running helper. Restart the helper.`;
  if (status === 429 || word === 'busy') return 'The Mac is busy: 3 tasks are already running. Wait for one to finish, or stop one with stop_task.';
  if (status === 404) {
    if (pathname === '/v1/tasks') return OLD_HELPER;
    if (pathname.startsWith('/v1/tasks/')) return 'No task with that id. Use list_tasks to see the task ids.';
    if (pathname.startsWith('/v1/sessions/')) return 'No session with that tool and id. Use list_sessions to see the session ids.';
    return 'The Mac Bridge helper does not know this request. It may be an older version — restart it.';
  }
  if (status === 405 && pathname.startsWith('/v1/tasks')) return OLD_HELPER;
  if (status === 400) {
    if (word === 'bad_tool') {
      const t = body && body.tool;
      if (t === 'cursor') return `The running Mac Bridge helper is an older version that cannot run Cursor tasks. Stop it and ${START_HINT} from the newest code, or use tool claude, codex or auto.`;
      return `The helper does not know tool "${t}". Use claude, codex, cursor or auto.`;
    }
    if (word === 'empty_prompt') return 'The prompt is empty. Write what the task should do.';
    if (word === 'prompt_too_long') return `The prompt is too long. The most is ${data.max || 20000} characters.`;
    if (word === 'bad_session_id') return 'That resumeSessionId does not look like a session id. Use an id from list_sessions.';
    if (word === 'unknown_session') return data.reason || 'The helper does not know that session. Pick claude or codex to continue it.';
    return `The helper said the request is wrong: ${word || 'bad_request'}.`;
  }
  return `The Mac Bridge helper answered with error ${status}${word ? ` (${word})` : ''}.`;
}

// ---------- tools ----------

const SESSION_TOOLS = ['claude', 'codex', 'cursor'];

export const TOOLS = [
  {
    name: 'list_sessions',
    title: 'List Mac sessions',
    description:
      'List the Claude Code, Codex and Cursor chat sessions on this Mac, newest first. Each has tool, id, project, title, updatedAt, live (changed in the last 2 minutes) and eventCount. Use read_session to read one.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: SESSION_TOOLS, description: 'Only sessions from this tool.' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Most sessions to return. Default 30.' },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'read_session',
    title: 'Read a session',
    description:
      'Read the events of one session: user and assistant messages, shell commands and their output, other tool calls. Events are numbered by seq. Pass after=<last seq you saw> to read only newer events.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: SESSION_TOOLS, description: 'Which tool owns the session.' },
        id: { type: 'string', description: 'Session id from list_sessions or a task.' },
        after: { type: 'integer', minimum: 0, description: 'Only events with seq greater than this. Default 0.' },
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Most events to return. Default 200.' },
      },
      required: ['tool', 'id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'delegate_task',
    title: 'Hand a task to another AI',
    description:
      'Start a task on this Mac in the Fundhub repo with Claude Code, Codex or Cursor. "auto" lets the helper pick by the repo rules and says why. Pass resumeSessionId to keep talking in an existing session. Returns the task right away; it runs in the background. Use list_tasks to check it and read_session with its sessionId to watch it.',
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string', enum: ['claude', 'codex', 'cursor', 'auto'], description: 'Which AI runs the task.' },
        prompt: { type: 'string', minLength: 1, maxLength: 20000, description: 'What the task should do. Self-contained.' },
        resumeSessionId: { type: 'string', description: 'Optional. Continue this existing session instead of starting a new one.' },
      },
      required: ['tool', 'prompt'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: 'list_tasks',
    title: 'List tasks',
    description: 'List the tasks the Mac Bridge started, newest first, with status (starting, running, done, failed, stopped), tool, sessionId and why that tool was picked.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'stop_task',
    title: 'Stop a task',
    description: 'Stop a running task by its id (from delegate_task or list_tasks).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Task id.' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
];

function need(args, key, type = 'string') {
  const v = args[key];
  if (type === 'string' && (typeof v !== 'string' || !v.trim())) throw new BridgeError(`Missing "${key}".`);
  return v;
}

function intArg(args, key, { min, max, dflt }) {
  const v = args[key];
  if (v === undefined || v === null) return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new BridgeError(`"${key}" must be a whole number from ${min} to ${max}.`);
  return n;
}

function oneOf(args, key, list) {
  const v = need(args, key);
  if (!list.includes(v)) throw new BridgeError(`"${key}" must be one of: ${list.join(', ')}.`);
  return v;
}

export const HANDLERS = {
  async list_sessions(args) {
    const tool = args.tool === undefined ? null : oneOf(args, 'tool', SESSION_TOOLS);
    const limit = intArg(args, 'limit', { min: 1, max: 200, dflt: 30 });
    const data = await callHelper('GET', '/v1/sessions');
    let sessions = Array.isArray(data && data.sessions) ? data.sessions : [];
    const total = sessions.length;
    if (tool) sessions = sessions.filter((s) => s.tool === tool);
    sessions = sessions.slice(0, limit);
    const summary = `${sessions.length} session(s) shown${tool ? ` for ${TOOL_NAMES[tool]}` : ''}, ${total} on the Mac.`;
    return { summary, data: { sessions } };
  },

  async read_session(args) {
    const tool = oneOf(args, 'tool', SESSION_TOOLS);
    const id = need(args, 'id');
    const after = intArg(args, 'after', { min: 0, max: Number.MAX_SAFE_INTEGER, dflt: 0 });
    const limit = intArg(args, 'limit', { min: 1, max: 500, dflt: 200 });
    const q = new URLSearchParams({ after: String(after), limit: String(limit) });
    const data = await callHelper('GET', `/v1/sessions/${encodeURIComponent(tool)}/${encodeURIComponent(id)}/events?${q}`);
    const events = Array.isArray(data && data.events) ? data.events : [];
    const last = events.length ? events[events.length - 1].seq : after;
    const more = events.length === limit ? ` There may be more: call again with after=${last}.` : '';
    return { summary: `${events.length} event(s) after seq ${after}. Last seq: ${last}.${more}`, data: { events, lastSeq: last } };
  },

  async delegate_task(args) {
    const tool = oneOf(args, 'tool', ['claude', 'codex', 'cursor', 'auto']);
    const prompt = need(args, 'prompt');
    const body = { tool, prompt };
    if (args.resumeSessionId !== undefined && args.resumeSessionId !== null && args.resumeSessionId !== '') {
      body.resumeSessionId = need(args, 'resumeSessionId');
    }
    const data = await callHelper('POST', '/v1/tasks', body);
    const task = data && data.task;
    if (!task) throw new BridgeError('The helper took the task but sent no task back.');
    const who = TOOL_NAMES[task.tool] || task.tool;
    const why = task.pickReason ? ` ${task.pickReason}` : '';
    const watch = task.sessionId
      ? ` Watch it: read_session tool=${task.tool} id=${task.sessionId}.`
      : ' Its sessionId shows up in list_tasks once the run starts; then read it with read_session.';
    return { summary: `Task ${task.id} started with ${who} (status ${task.status}).${why}${watch}`, data: { task } };
  },

  async list_tasks() {
    const data = await callHelper('GET', '/v1/tasks');
    const tasks = Array.isArray(data && data.tasks) ? data.tasks : [];
    const running = tasks.filter((t) => t.status === 'starting' || t.status === 'running').length;
    return { summary: `${tasks.length} task(s), ${running} running.`, data: { tasks } };
  },

  async stop_task(args) {
    const id = need(args, 'id');
    const data = await callHelper('POST', `/v1/tasks/${encodeURIComponent(id)}/stop`);
    const task = data && data.task;
    return { summary: `Stop sent to task ${id}${task ? ` (status ${task.status})` : ''}.`, data: { task } };
  },
};

export async function callTool(name, args) {
  const handler = Object.hasOwn(HANDLERS, name) ? HANDLERS[name] : null;
  if (!handler) return { content: [{ type: 'text', text: `Unknown tool "${name}".` }], isError: true };
  try {
    const { summary, data } = await handler(args && typeof args === 'object' ? args : {});
    return {
      content: [{ type: 'text', text: `${summary}\n${JSON.stringify(data, null, 2)}` }],
      structuredContent: data,
      isError: false,
    };
  } catch (e) {
    const msg = e instanceof BridgeError ? e.message : `Mac Bridge tool failed: ${e && e.message ? e.message : String(e)}`;
    if (!(e instanceof BridgeError)) console.error('[mac-bridge-mcp]', e);
    return { content: [{ type: 'text', text: msg }], isError: true };
  }
}

// ---------- JSON-RPC ----------

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });

/** Handle one parsed message. Returns a response object, or null for notifications. */
export async function handleMessage(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0') {
    return rpcError(msg && msg.id !== undefined ? msg.id : null, -32600, 'Invalid Request');
  }
  const isRequest = msg.id !== undefined && msg.id !== null && typeof msg.method === 'string';
  if (typeof msg.method !== 'string') return null; // a response from the client; we never send requests
  if (!isRequest) return null; // notifications (initialized, cancelled, …) need no answer

  const { id, method } = msg;
  const params = msg.params && typeof msg.params === 'object' ? msg.params : {};
  switch (method) {
    case 'initialize': {
      const asked = params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOLS.includes(asked) ? asked : SUPPORTED_PROTOCOLS[0];
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          'Mac Bridge: see and steer the AI sessions on Chris\'s Mac. list_sessions and read_session watch Claude Code, Codex and Cursor chats. delegate_task hands a task to another AI (claude, codex, cursor, or auto = pick by repo rules); it runs in the Fundhub repo under that tool\'s own rules. list_tasks and stop_task manage running tasks.',
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: TOOLS });
    case 'tools/call': {
      if (typeof params.name !== 'string') return rpcError(id, -32602, 'Invalid params: name is required');
      return rpcResult(id, await callTool(params.name, params.arguments || {}));
    }
    case 'resources/list':
      return rpcResult(id, { resources: [] });
    case 'prompts/list':
      return rpcResult(id, { prompts: [] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}

function write(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

export function main() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  const pending = new Set();
  rl.on('line', (line) => {
    if (!line.trim()) return;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      write(rpcError(null, -32700, 'Parse error'));
      return;
    }
    const p = (async () => {
      if (Array.isArray(msg)) {
        const out = (await Promise.all(msg.map(handleMessage))).filter(Boolean);
        if (out.length) write(out);
      } else {
        const out = await handleMessage(msg);
        if (out) write(out);
      }
    })().catch((e) => console.error('[mac-bridge-mcp]', e));
    pending.add(p);
    p.finally(() => pending.delete(p));
  });
  rl.on('close', async () => {
    await Promise.allSettled([...pending]);
    process.exit(0);
  });
}

const isMain = process.argv[1] && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(fileURLToPath(import.meta.url));
if (isMain) main();
