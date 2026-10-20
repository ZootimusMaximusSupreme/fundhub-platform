// Finds session files, indexes them lazily, and streams new events.
// Read only: this module never writes, moves or deletes anything under the
// Claude or Codex folders.
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createParser, projectName, cut } from './parse.mjs';

const MAX_SESSIONS = 200;
const LIVE_MS = 120 * 1000;
const CHUNK = 1024 * 1024;
const CHECKPOINT_EVERY = 100; // events between resume points
const AUTO_INDEX_BYTES = 4 * 1024 * 1024; // index new/changed files up to this size inline
const PEEK_BYTES = 1024 * 1024;
const yieldLoop = () => new Promise((r) => setImmediate(r));

export function makeTitle(text) {
  return cut(String(text).replace(/\s+/g, ' ').trim(), 80);
}

/**
 * Read a file from `startOffset`, feed each complete line to a parser, and call
 * onEvent(event) for each event produced (seq already assigned).
 * A last line with no newline is only consumed if it is complete JSON.
 * Returns { offset, seq, snapshot, stopped }.
 */
async function scanFile(file, o) {
  const { tool, startOffset = 0, startSeq = 0, snapshot, fallbackTs, onEvent, onLine, maxBytes, shouldStop } = o;
  const parser = createParser(tool, snapshot);
  if (o.meta) Object.assign(parser.meta, o.meta);
  let seq = startSeq;
  const fh = await fsp.open(file, 'r');
  try {
    let pos = startOffset;
    let buf = Buffer.alloc(0);
    let bufStart = startOffset;
    const chunk = Buffer.allocUnsafe(CHUNK);
    let stopped = false;

    const handle = (line, endOffset) => {
      line = line.trim();
      if (!line) return;
      let obj;
      try {
        obj = JSON.parse(line);
      } catch {
        return; // unreadable line: skip, never crash
      }
      let evs;
      try {
        evs = parser.feed(obj);
      } catch {
        return;
      }
      for (const e of evs) {
        seq += 1;
        const full = { seq, ts: e.ts || fallbackTs, kind: e.kind, text: e.text };
        if (e.command !== undefined) full.command = e.command;
        if (e.exitCode !== undefined) full.exitCode = e.exitCode;
        if (e.kind === 'user' && !parser.meta.title) parser.meta.title = makeTitle(e.text);
        if (onEvent && onEvent(full) === false) stopped = true;
      }
      if (onLine) onLine(endOffset, seq, parser);
      if (shouldStop && shouldStop(parser, seq)) stopped = true;
    };

    outer: for (;;) {
      if (maxBytes && pos - startOffset >= maxBytes) break;
      const { bytesRead } = await fh.read(chunk, 0, CHUNK, pos);
      if (!bytesRead) break;
      pos += bytesRead;
      const piece = chunk.subarray(0, bytesRead);
      buf = buf.length ? Buffer.concat([buf, piece]) : Buffer.from(piece);
      let start = 0;
      let nl;
      while ((nl = buf.indexOf(10, start)) !== -1) {
        const line = buf.toString('utf8', start, nl);
        start = nl + 1;
        handle(line, bufStart + start);
        if (stopped) {
          bufStart += start;
          buf = Buffer.alloc(0);
          break outer;
        }
      }
      buf = buf.subarray(start);
      bufStart += start;
      await yieldLoop();
    }
    let offset = bufStart;
    if (!stopped && buf.length) {
      const tail = buf.toString('utf8').trim();
      let ok = false;
      try {
        JSON.parse(tail);
        ok = true;
      } catch {}
      if (ok) {
        handle(tail, bufStart + buf.length);
        offset = bufStart + buf.length;
      }
    }
    return { offset, seq, snapshot: parser.snapshot(), meta: parser.meta, stopped };
  } finally {
    await fh.close();
  }
}

function codexIdFromName(name) {
  const m = name.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i);
  return m ? m[1] : name.replace(/\.jsonl$/, '');
}

class Record {
  constructor(tool, id, file, st) {
    this.tool = tool;
    this.id = id;
    this.file = file;
    this.size = st.size;
    this.mtimeMs = st.mtimeMs;
    this.project = '';
    this.title = '';
    this.indexed = false;
    this.peeked = false;
    this.offset = 0;
    this.seq = 0;
    this.snapshot = undefined;
    this.checkpoints = [{ seq: 0, offset: 0, snapshot: undefined }];
    this.chain = Promise.resolve();
  }

  lock(fn) {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => {});
    return run;
  }

  reset() {
    this.indexed = false;
    this.offset = 0;
    this.seq = 0;
    this.snapshot = undefined;
    this.checkpoints = [{ seq: 0, offset: 0, snapshot: undefined }];
    this.title = '';
  }
}

export class SessionStore extends EventEmitter {
  constructor({ claudeDir, codexDir, pollMs = 2000, watch = true, now = () => Date.now(), showGuardian = process.env.MAC_BRIDGE_SHOW_GUARDIAN === '1' } = {}) {
    super();
    this.dirs = { claude: claudeDir, codex: codexDir };
    this.pollMs = pollMs;
    this.useWatch = watch;
    this.now = now;
    this.records = new Map(); // "tool:id" -> Record
    this.first = true;
    this.timer = null;
    this.watchers = [];
    this.scanning = null;
    this.stopped = false;
    this.debounce = null;
    this.guardian = new Map(); // file -> true when it is an internal guardian review
    this.showGuardian = !!showGuardian;
  }

  key(tool, id) {
    return `${tool}:${id}`;
  }

  async start() {
    await this.scan();
    this.first = false;
    this.#backgroundIndex();
    this.timer = setInterval(() => this.scan().catch(() => {}), this.pollMs);
    this.timer.unref?.();
    if (this.useWatch) {
      for (const dir of Object.values(this.dirs)) {
        if (!dir) continue;
        try {
          const w = fs.watch(dir, { recursive: true, persistent: false }, () => {
            clearTimeout(this.debounce);
            this.debounce = setTimeout(() => this.scan().catch(() => {}), 150);
          });
          w.on('error', () => {});
          this.watchers.push(w);
        } catch {
          /* poll covers it */
        }
      }
    }
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    clearTimeout(this.debounce);
    for (const w of this.watchers) {
      try {
        w.close();
      } catch {}
    }
    this.watchers = [];
  }

  async #discover() {
    const found = [];
    const claudeDir = this.dirs.claude;
    if (claudeDir) {
      let projects = [];
      try {
        projects = await fsp.readdir(claudeDir, { withFileTypes: true });
      } catch {}
      await Promise.all(
        projects
          .filter((d) => d.isDirectory())
          .map(async (d) => {
            let files = [];
            try {
              files = await fsp.readdir(path.join(claudeDir, d.name), { withFileTypes: true });
            } catch {}
            for (const f of files) {
              if (f.isFile() && f.name.endsWith('.jsonl')) {
                found.push({ tool: 'claude', id: f.name.slice(0, -6), file: path.join(claudeDir, d.name, f.name), slug: d.name });
              }
            }
          }),
      );
    }
    const codexDir = this.dirs.codex;
    if (codexDir) {
      let rel = [];
      try {
        rel = await fsp.readdir(codexDir, { recursive: true });
      } catch {}
      for (const r of rel) {
        const name = path.basename(r);
        if (name.startsWith('rollout-') && name.endsWith('.jsonl')) {
          found.push({ tool: 'codex', id: codexIdFromName(name), file: path.join(codexDir, r) });
        }
      }
    }
    const stats = await Promise.all(
      found.map(async (f) => {
        try {
          const st = await fsp.stat(f.file);
          return st.isFile() ? { ...f, st } : null;
        } catch {
          return null;
        }
      }),
    );
    const sorted = stats.filter(Boolean).sort((a, b) => b.st.mtimeMs - a.st.mtimeMs);
    // Codex writes a rollout for every internal "guardian" safety review (hundreds a day).
    // They are not chats, so they are hidden unless MAC_BRIDGE_SHOW_GUARDIAN=1.
    const kept = [];
    for (let i = 0; i < sorted.length && kept.length < MAX_SESSIONS; ) {
      const batch = sorted.slice(i, i + 50);
      i += batch.length;
      const hidden = await Promise.all(batch.map((f) => (f.tool === 'codex' ? this.#isGuardian(f.file) : false)));
      batch.forEach((f, j) => {
        if (!hidden[j] && kept.length < MAX_SESSIONS) kept.push(f);
      });
    }
    return kept;
  }

  async #isGuardian(file) {
    if (this.showGuardian) return false;
    if (this.guardian.has(file)) return this.guardian.get(file);
    let result = false;
    try {
      const fh = await fsp.open(file, 'r');
      try {
        const chunk = Buffer.allocUnsafe(64 * 1024);
        let text = '';
        for (let pos = 0; pos < 1024 * 1024; ) {
          const { bytesRead } = await fh.read(chunk, 0, chunk.length, pos);
          if (!bytesRead) break;
          pos += bytesRead;
          text += chunk.toString('utf8', 0, bytesRead);
          if (text.includes('\n')) break;
        }
        const first = text.split('\n')[0];
        try {
          const o = JSON.parse(first);
          result = !!(o && o.payload && o.payload.thread_source === 'guardian_review');
        } catch {
          result = first.slice(0, 20000).includes('"thread_source":"guardian_review"');
        }
      } finally {
        await fh.close();
      }
    } catch {
      return false; // do not cache a failed read
    }
    this.guardian.set(file, result);
    return result;
  }

  /** Look for new/changed files. Emits 'session' and 'events'. */
  scan() {
    if (this.scanning) return this.scanning;
    this.scanning = this.#scan().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  async #scan() {
    if (this.stopped) return;
    const found = await this.#discover();
    const seen = new Set();
    for (const f of found) {
      const k = this.key(f.tool, f.id);
      seen.add(k);
      let rec = this.records.get(k);
      const isNew = !rec;
      if (isNew) {
        rec = new Record(f.tool, f.id, f.file, f.st);
        if (f.slug) rec.slugProject = f.slug;
        this.records.set(k, rec);
      } else if (rec.size === f.st.size && rec.mtimeMs === f.st.mtimeMs) {
        continue;
      }
      rec.file = f.file;
      rec.size = f.st.size;
      rec.mtimeMs = f.st.mtimeMs;
      if (this.first) continue; // initial scan: no announcements
      try {
        if (rec.indexed) {
          await this.refresh(rec); // announces itself
        } else {
          if (rec.size <= AUTO_INDEX_BYTES) await this.refresh(rec);
          else await this.#peek(rec);
          this.emit('session', this.describe(rec));
        }
      } catch {
        /* a file that vanished mid-scan is fine */
      }
    }
    for (const k of [...this.records.keys()]) if (!seen.has(k)) this.records.delete(k);
  }

  async #backgroundIndex() {
    const todo = [...this.records.values()].filter((r) => !r.indexed).sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const rec of todo) {
      if (this.stopped) return;
      try {
        await this.refresh(rec);
      } catch {}
      await yieldLoop();
    }
  }

  async #peek(rec) {
    if (rec.peeked) return;
    rec.peeked = true;
    try {
      const r = await scanFile(rec.file, {
        tool: rec.tool,
        maxBytes: PEEK_BYTES,
        fallbackTs: new Date(rec.mtimeMs).toISOString(),
        shouldStop: (p) => !!(p.meta.title && p.meta.cwd),
      });
      if (r.meta.title) rec.title = r.meta.title;
      if (r.meta.cwd) rec.project = projectName(r.meta.cwd);
    } catch {}
  }

  /**
   * Bring a record up to date by reading only the bytes appended since last
   * time. If the record was already indexed, the new events and the changed
   * session are announced ('events', 'session') so WebSocket clients get them
   * no matter who triggered the read.
   */
  refresh(rec) {
    return rec.lock(async () => {
      let st;
      try {
        st = await fsp.stat(rec.file);
      } catch {
        return;
      }
      if (st.size < rec.offset) rec.reset(); // file was replaced or truncated
      rec.size = st.size;
      rec.mtimeMs = st.mtimeMs;
      if (rec.indexed && st.size === rec.offset) return;
      const wasIndexed = rec.indexed;
      const out = [];
      let lastCp = rec.checkpoints[rec.checkpoints.length - 1].seq;
      const r = await scanFile(rec.file, {
        tool: rec.tool,
        startOffset: rec.offset,
        startSeq: rec.seq,
        snapshot: rec.snapshot,
        meta: { title: rec.title, cwd: rec.cwdSeen || '' },
        fallbackTs: new Date(st.mtimeMs).toISOString(),
        onEvent: wasIndexed ? (e) => void out.push(e) : undefined,
        onLine: (endOffset, seq, parser) => {
          if (seq - lastCp >= CHECKPOINT_EVERY) {
            lastCp = seq;
            rec.checkpoints.push({ seq, offset: endOffset, snapshot: parser.snapshot() });
          }
        },
      });
      rec.offset = r.offset;
      rec.seq = r.seq;
      rec.snapshot = r.snapshot;
      rec.indexed = true;
      if (r.meta.title) rec.title = r.meta.title;
      if (r.meta.cwd) {
        rec.cwdSeen = r.meta.cwd;
        rec.project = projectName(r.meta.cwd);
      }
      if (wasIndexed) {
        this.emit('session', this.describe(rec));
        if (out.length) this.emit('events', { tool: rec.tool, sessionId: rec.id, events: out });
      }
    });
  }

  describe(rec) {
    let project = rec.project;
    if (!project) project = rec.tool === 'claude' && rec.slugProject ? rec.slugProject : rec.tool;
    return {
      id: rec.id,
      tool: rec.tool,
      project,
      title: rec.title,
      updatedAt: new Date(rec.mtimeMs).toISOString(),
      live: this.now() - rec.mtimeMs < LIVE_MS,
      eventCount: rec.seq,
    };
  }

  get(tool, id) {
    return this.records.get(this.key(tool, id));
  }

  /** Newest first, at most 200. Small unindexed files are indexed so counts are real. */
  async list() {
    const recs = [...this.records.values()].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_SESSIONS);
    await Promise.all(
      recs.map(async (r) => {
        try {
          if (!r.indexed && r.size <= 1024 * 1024) await this.refresh(r);
          else if (!r.indexed) await this.#peek(r);
        } catch {}
      }),
    );
    return recs.map((r) => this.describe(r));
  }

  /** Make sure the record has seen every byte written so far (used before subscribe/read). */
  async ensureCurrent(rec) {
    await this.refresh(rec);
  }

  /** Events with seq > after, up to limit. Resumes from the nearest checkpoint. */
  async events(rec, after = 0, limit = 200) {
    await this.ensureCurrent(rec);
    if (after >= rec.seq) return [];
    let cp = rec.checkpoints[0];
    for (const c of rec.checkpoints) if (c.seq <= after && c.seq >= cp.seq) cp = c;
    const out = [];
    await scanFile(rec.file, {
      tool: rec.tool,
      startOffset: cp.offset,
      startSeq: cp.seq,
      snapshot: cp.snapshot,
      fallbackTs: new Date(rec.mtimeMs).toISOString(),
      onEvent: (e) => {
        if (e.seq > after) out.push(e);
        return out.length < limit;
      },
    });
    return out.slice(0, limit);
  }
}
