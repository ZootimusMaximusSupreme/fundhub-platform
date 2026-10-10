/* Fundhub teleprompter — change the words on the fly, and every change saved back.
 *
 * Owner needs (Chris, 2026-10-06), docs/specs/teleprompter-requirements-2026-10-06.md:
 * edit a line right in the teleprompter, even mid-shoot, and never lose a word.
 *
 * ONE STORE. Every save goes through the shipped route POST
 * /api/marketing/scripts/edit {request_id, id, version, body, parts?}: a new
 * version in the database (the old one is kept), voice pairs for the machine's
 * lines Chris changed, and the repo file queued through the outbox. Nothing
 * here keeps a second copy of the script anywhere but this phone's waiting list.
 *
 * WHAT IS IN THIS FILE (no document needed, so src/ui/teleprompter-edits.test.mjs
 * proves it in a bare VM):
 *   applyEdit      one paragraph changed → the whole new body (and parts)
 *   rolledText     what the teleprompter rolls for a script (the server's rule)
 *   wordDiff       what changed between two versions, word by word
 *   createSaveQueue  the waiting list: debounced autosave, save now on
 *                  blur / pause / Done, kept in this phone's storage when
 *                  offline or signed out, sent with the SAME request_id when it
 *                  comes back (so a save is never made twice), a 409 turned into
 *                  "two versions — pick one"
 *   statusText     the change pulse: "Saved 12:04 PM", "Saving…",
 *                  "Offline — 2 edits waiting"
 */
(function (root) {
  "use strict";

  function sameJson(a, b) { return JSON.stringify(a == null ? null : a) === JSON.stringify(b == null ? null : b); }
  function copyParts(parts) {
    return Array.isArray(parts) ? parts.map(function (p) { return p && typeof p === "object" ? { kind: p.kind, text: p.text } : p; }) : null;
  }

  /** Clean what the edit box holds: no \r, no spaces at line ends, no blank lines at either end. */
  function clean(text) {
    return String(text == null ? "" : text).replace(/\r/g, "").split("\n")
      .map(function (l) { return l.replace(/[ \t]+$/, ""); }).join("\n").replace(/^\s+|\s+$/g, "");
  }

  /** Where each rolled paragraph sits in the body, found in order: [{start, end}|null]. */
  function locate(body, texts) {
    var at = 0, out = [];
    for (var i = 0; i < texts.length; i++) {
      var k = body.indexOf(texts[i], at);
      if (k < 0 || !texts[i]) { out.push(null); continue; }
      out.push({ start: k, end: k + texts[i].length });
      at = k + texts[i].length;
    }
    return out;
  }

  /** Take a span out of the body and close the gap: a blank line stays a blank line, a line break a line break. */
  function cut(body, spot) {
    var before = body.slice(0, spot.start), after = body.slice(spot.end);
    var gaps = [(before.match(/\s*$/) || [""])[0], (after.match(/^\s*/) || [""])[0]];
    before = before.replace(/\s+$/, "");
    after = after.replace(/^\s+/, "");
    if (!before || !after) return before + after;
    var blank = gaps.some(function (g) { return /\n[ \t]*\n/.test(g); });
    var br = gaps.some(function (g) { return /\n/.test(g); });
    return before + (blank ? "\n\n" : br ? "\n" : " ") + after;
  }

  /**
   * The parts after one paragraph changed (words mode). The part that holds the
   * old words gets the new ones; a paragraph of several cue lines maps line by
   * line. Parts that never held these words stay as they are. null = the change
   * could not be mapped, so the server clears the part marks and says so.
   */
  function mapParts(parts, old, next) {
    var trimmed = function (s) { return String(s == null ? "" : s).trim(); };
    var whole = -1;
    for (var i = 0; i < parts.length; i++) if (parts[i] && trimmed(parts[i].text) === old) { whole = i; break; }
    if (whole >= 0) {
      if (next) parts[whole].text = next; else parts.splice(whole, 1);
      return parts;
    }
    var touches = parts.some(function (p) {
      var t = trimmed(p && p.text);
      return t && (old.indexOf(t) >= 0 || t.indexOf(old) >= 0);
    });
    if (!touches) return parts;
    var oldLines = old.split("\n").map(trimmed), newLines = next ? next.split("\n").map(trimmed) : [];
    if (oldLines.length > 1 && oldLines.length === newLines.length) {
      var used = {}, ok = true;
      for (var l = 0; l < oldLines.length && ok; l++) {
        if (oldLines[l] === newLines[l]) continue;
        var hit = -1;
        for (var j = 0; j < parts.length; j++) if (!used[j] && parts[j] && trimmed(parts[j].text) === oldLines[l]) { hit = j; break; }
        if (hit < 0) ok = false; else { used[hit] = true; parts[hit].text = newLines[l]; }
      }
      if (ok) return parts;
      return null;
    }
    var holders = parts.filter(function (p) { return p && typeof p.text === "string" && p.text.indexOf(old) >= 0; });
    if (holders.length === 1) {
      holders[0].text = holders[0].text.replace(old, next).trim();
      return parts;
    }
    return null;
  }

  /**
   * One paragraph of the rolled script changed. Returns the whole new script
   * words {body, parts, changed} to send to POST marketing/scripts/edit, or null
   * when there is no paragraph i.
   *   s        the script (body, parts)
   *   paras    what the teleprompter rolls: FundhubTeleprompter.paragraphsFor(s)
   *   i        which paragraph
   *   newText  the words in the edit box
   *   bullets  true when the paragraphs are the parts (bullets mode)
   * parts: the new list, or null when not sent (the server keeps them when the
   * words did not change, and clears them with a warning when they did).
   */
  function applyEdit(s, paras, i, newText, bullets) {
    if (!s || !Array.isArray(paras) || !paras[i]) return null;
    var body = String(s.body || "");
    var old = paras[i].text;
    var next = clean(newText);
    if (next === old) return { body: body, parts: copyParts(s.parts), changed: false };
    var spot = locate(body, paras.map(function (p) { return p.text; }))[i];
    var newBody = body;
    if (spot) newBody = next ? body.slice(0, spot.start) + next + body.slice(spot.end) : cut(body, spot);
    var parts = copyParts(s.parts);
    var outParts = null;
    if (parts && parts.length) {
      if (bullets) {
        var n = -1, k = -1;
        for (var j = 0; j < parts.length; j++) {
          if (parts[j] && typeof parts[j].text === "string" && parts[j].text.trim()) { n++; if (n === i) { k = j; break; } }
        }
        if (k >= 0) { if (next) parts[k].text = next; else parts.splice(k, 1); outParts = parts; }
      } else {
        outParts = mapParts(parts, old, next);
      }
    }
    return { body: newBody, parts: outParts, changed: newBody !== body || (outParts !== null && !sameJson(outParts, s.parts)) };
  }

  /**
   * What the teleprompter rolls, the server's own rule (teleprompterText in
   * src/marketing/shoot-plan.mjs): the body, or the hook only for a
   * first-line-only retake.
   */
  function rolledText(s) {
    var body = s && typeof s.body === "string" ? s.body : "";
    if (!s || !s.first_line_only) return body;
    var parts = Array.isArray(s.parts) ? s.parts : [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] && parts[i].kind === "hook" && typeof parts[i].text === "string" && parts[i].text.trim()) return parts[i].text.trim();
    }
    var first = body.replace(/\r/g, "").split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean)[0];
    return first || body;
  }

  /**
   * What changed between two versions, word by word: [{op:'same'|'del'|'add', text}].
   * Very long scripts fall back to "all of it out, all of it in".
   */
  function wordDiff(a, b) {
    var A = String(a || "").split(/\s+/).filter(Boolean), B = String(b || "").split(/\s+/).filter(Boolean);
    var out = [];
    function push(op, w) {
      var last = out[out.length - 1];
      if (last && last.op === op) last.text += " " + w; else out.push({ op: op, text: w });
    }
    if (A.length * B.length > 250000) {
      if (A.length) out.push({ op: "del", text: A.join(" ") });
      if (B.length) out.push({ op: "add", text: B.join(" ") });
      return out;
    }
    var n = A.length, m = B.length, L = [];
    for (var i = 0; i <= n; i++) { L.push(new Array(m + 1).fill(0)); }
    for (var x = n - 1; x >= 0; x--) {
      for (var y = m - 1; y >= 0; y--) L[x][y] = A[x] === B[y] ? L[x + 1][y + 1] + 1 : Math.max(L[x + 1][y], L[x][y + 1]);
    }
    var p = 0, q = 0;
    while (p < n && q < m) {
      if (A[p] === B[q]) { push("same", A[p]); p++; q++; }
      else if (L[p + 1][q] >= L[p][q + 1]) { push("del", A[p]); p++; }
      else { push("add", B[q]); q++; }
    }
    while (p < n) { push("del", A[p]); p++; }
    while (q < m) { push("add", B[q]); q++; }
    return out;
  }

  /** "3 words out, 2 in" — the history line under a version. */
  function diffWords(d) {
    var del = 0, add = 0;
    (d || []).forEach(function (s) {
      var c = s.text.split(" ").length;
      if (s.op === "del") del += c; else if (s.op === "add") add += c;
    });
    if (!del && !add) return "No words changed.";
    var w = function (n) { return n + (n === 1 ? " word" : " words"); };
    if (del && add) return w(del) + " out, " + w(add) + " in.";
    return del ? w(del) + " out." : w(add) + " in.";
  }

  /** The live version in a GET marketing/script answer: the one not replaced (newest first). */
  function liveOf(versions) {
    if (!Array.isArray(versions) || !versions.length) return null;
    for (var i = 0; i < versions.length; i++) if (versions[i] && versions[i].status !== "superseded") return versions[i];
    return versions[0];
  }

  /* ── the waiting list ─────────────────────────────────────────────────── */

  var RETRY_MS = 15000;

  /**
   * createSaveQueue(o)
   *   o.store     {get(): saved|null, set(saved)} — this phone's storage
   * edit(root, base, body, parts): base = {id, version, body, parts} of the
   * version the words were changed on (body/parts let it skip a save that
   * changes nothing).
   *   o.send      (body) → Promise<{status, data}>  POST marketing/scripts/edit
   *   o.live      (id) → Promise<{status, data}>    GET marketing/script?id=
   *   o.requestId () → a fresh request id
   *   o.now, o.setTimeout, o.clearTimeout   the clock (tests pass their own)
   *   o.debounceMs  quiet time before an autosave (default 1500)
   *   o.onChange  (event, status) on every change: edit, saving, saved,
   *               waiting, conflict, failed, resolved
   *
   * One item per script (root_script_id). An item holds the newest words and
   * the version they were written on. `sent` is the save in flight or waiting
   * to be sent again: it keeps its request_id and its words until the server
   * answers, so a save cut off mid-way is sent again EXACTLY as it was and the
   * server answers it once. Words typed after it go in the next save.
   */
  function createSaveQueue(o) {
    var store = o.store, send = o.send, live = o.live;
    var now = o.now || function () { return Date.now(); };
    var later = o.setTimeout || function (f, ms) { return root.setTimeout(f, ms); };
    var cancel = o.clearTimeout || function (h) { root.clearTimeout(h); };
    var wait = o.debounceMs == null ? 1500 : o.debounceMs;
    var onChange = o.onChange || function () {};
    var newId = o.requestId;

    var saved = (store && store.get && store.get()) || null;
    var items = saved && saved.items && typeof saved.items === "object" ? saved.items : {};
    var savedAt = saved && saved.savedAt ? saved.savedAt : null;
    var net = "ok", inflight = {}, timer = null, retry = null;
    Object.keys(items).forEach(function (r) { var it = items[r]; if (!it || !it.root) delete items[r]; });

    function persist() { try { store.set({ items: items, savedAt: savedAt }); } catch (e) { /* storage full or blocked */ } }
    function emit(type, extra) {
      var ev = { type: type };
      for (var k in extra || {}) if (Object.prototype.hasOwnProperty.call(extra, k)) ev[k] = extra[k];
      try { onChange(ev, status()); } catch (e) { /* the page's own problem */ }
    }

    function edit(rootId, base, body, parts) {
      var it = items[rootId];
      if (!it) {
        it = items[rootId] = { root: rootId, base_id: base.id, base_version: base.version, body: body, parts: parts == null ? null : parts, edits: 0, dirty: false, sent: null, conflict: null, failed: null, at: now() };
        // The words the server already has: typing back to them saves nothing.
        if (typeof base.body === "string") { it.savedBody = base.body; it.savedParts = base.parts == null ? null : base.parts; }
      }
      it.body = body;
      it.parts = parts == null ? null : parts;
      it.at = now();
      it.dirty = true;
      it.failed = null;
      persist();
      schedule();
      emit("edit", { root: rootId });
    }

    function schedule() {
      if (timer) cancel(timer);
      timer = later(function () { timer = null; checkpoint(); persist(); flush(); }, wait);
    }
    /* A checkpoint is one edit on the waiting count: the words as they stood
       when Chris stopped typing, blurred the box or paused. */
    function checkpoint() {
      Object.keys(items).forEach(function (r) { var it = items[r]; if (it.dirty) { it.edits += 1; it.dirty = false; } });
    }
    /** Save now: the box lost focus, Chris pressed Done, or the script paused. */
    function commit() {
      if (timer) { cancel(timer); timer = null; }
      checkpoint();
      persist();
      return flush();
    }

    function flush() {
      var work = [];
      Object.keys(items).forEach(function (r) { var p = sendOne(items[r]); if (p) work.push(p); });
      return Promise.all(work).then(function () { return status(); });
    }

    function scheduleRetry() {
      if (retry) return;
      retry = later(function () { retry = null; flush(); }, RETRY_MS);
    }

    function done(it, snap, script, warnings) {
      net = "ok";
      it.base_id = script.id;
      it.base_version = Number(script.version);
      it.sent = null;
      it.edits = Math.max(0, it.edits - (snap.edits || 1));
      it.savedBody = snap.body;
      it.savedParts = snap.parts;
      savedAt = now();
      var same = it.body === snap.body && sameJson(it.parts, snap.parts);
      if (same && !it.dirty) delete items[it.root];
      else if (same) it.edits = 0;
      else if (!it.edits && !it.dirty) it.edits = 1;
      persist();
      emit("saved", { root: it.root, script: script, warnings: warnings || [] });
      if (items[it.root] && items[it.root].edits > 0) return sendOne(items[it.root]);
      return null;
    }

    function sendOne(it) {
      if (!it || inflight[it.root] || it.conflict || it.failed) return null;
      if (!it.sent) {
        if (!it.edits) return null; // still typing: the debounce sends it
        if (it.body === it.savedBody && sameJson(it.parts, it.savedParts)) { delete items[it.root]; persist(); return null; }
        it.sent = { request_id: newId(), id: it.base_id, version: it.base_version, body: it.body, parts: it.parts, edits: it.edits };
        persist();
      }
      var snap = it.sent;
      var req = { request_id: snap.request_id, id: snap.id, version: snap.version, body: snap.body };
      if (snap.parts != null) req.parts = snap.parts;
      inflight[it.root] = true;
      emit("saving", { root: it.root });
      return Promise.resolve(send(req)).then(null, function () { return { status: 0, data: null }; }).then(function (r) {
        inflight[it.root] = false;
        var cur = items[it.root];
        if (!cur) return null;
        var d = r && r.data;
        if (r.status === 200 && d && d.script) return done(cur, snap, d.script, d.warnings);
        if (r.status === 409) return stale(cur, snap, d);
        if (r.status === 400 || r.status === 403 || r.status === 404) {
          net = "ok";
          cur.sent = null;
          cur.failed = (d && d.message) || "The server would not take this edit.";
          persist();
          emit("failed", { root: cur.root, message: cur.failed });
          return null;
        }
        net = r.status === 401 ? "signedout" : "offline";
        persist();
        emit("waiting", { root: cur.root });
        scheduleRetry();
        return null;
      });
    }

    /* 409: someone saved after these words were started. Read the live version
       (the 409 names its words, not its id). If it IS these words, the earlier
       save landed and only its answer was lost. Otherwise: two versions, and
       Chris picks. */
    function stale(it, snap, d) {
      inflight[it.root] = true;
      return Promise.resolve(live(snap.id)).then(null, function () { return { status: 0, data: null }; }).then(function (r) {
        inflight[it.root] = false;
        var cur = items[it.root];
        if (!cur) return null;
        var v = r && r.status === 200 && r.data ? liveOf(r.data.versions) : null;
        if (!v) {
          net = r && r.status === 401 ? "signedout" : "offline";
          cur.sent = null;
          persist();
          emit("waiting", { root: cur.root });
          scheduleRetry();
          return null;
        }
        if (v.body === snap.body) return done(cur, snap, v, []);
        cur.sent = null;
        cur.conflict = {
          theirs: { id: v.id, version: Number(v.version), body: v.body, parts: v.parts == null ? null : v.parts, source: v.source || null, created_at: v.created_at || null },
          current: d && d.current ? d.current : null
        };
        net = "ok";
        persist();
        emit("conflict", { root: cur.root });
        return null;
      });
    }

    /** Chris picked: 'mine' sends his words on top of the saved ones; 'theirs' drops his. */
    function resolve(rootId, choice) {
      var it = items[rootId];
      if (!it || !it.conflict) return null;
      var th = it.conflict.theirs;
      if (choice === "mine") {
        it.base_id = th.id;
        it.base_version = th.version;
        it.conflict = null;
        it.sent = null;
        it.edits = Math.max(1, it.edits);
        it.dirty = false;
        persist();
        emit("resolved", { root: rootId, choice: "mine" });
        return sendOne(it);
      }
      delete items[rootId];
      persist();
      emit("resolved", { root: rootId, choice: "theirs", script: th });
      return null;
    }

    /** A failed edit: send it again, or throw the words away (Chris confirms first). */
    function retryFailed(rootId) {
      var it = items[rootId];
      if (!it || !it.failed) return null;
      it.failed = null;
      it.edits = Math.max(1, it.edits);
      persist();
      return sendOne(it);
    }
    function drop(rootId) {
      if (!items[rootId]) return;
      delete items[rootId];
      persist();
      emit("resolved", { root: rootId, choice: "dropped" });
    }

    function status() {
      var waiting = 0, conflicts = 0, failed = 0, saving = false;
      Object.keys(items).forEach(function (r) {
        var it = items[r];
        if (inflight[r]) saving = true;
        if (it.conflict) conflicts++;
        else if (it.failed) failed++;
        else waiting += Math.max(it.edits + (it.dirty ? 1 : 0), it.sent ? 1 : 0, 1);
      });
      return { waiting: waiting, conflicts: conflicts, failed: failed, saving: saving, net: net, savedAt: savedAt };
    }

    function item(rootId) { return items[rootId] || null; }
    function list() { return Object.keys(items).map(function (r) { return items[r]; }); }

    return { edit: edit, commit: commit, flush: flush, resolve: resolve, retry: retryFailed, drop: drop, status: status, item: item, list: list };
  }

  /** "12:04 PM", Arizona time like every staff screen (ops/workflows/arizona-time-2026-08-28.md). */
  function clockTime(ms) {
    try { return new Date(ms).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Phoenix" }); } catch (e) { return ""; }
  }

  /**
   * The change pulse, in plain words. st = queue.status(); repoHeld = the
   * health card says the repo copy is held (no GITHUB_REPO_TOKEN yet, or the
   * dry-run fence).
   */
  function statusText(st, repoHeld, fmt) {
    var time = fmt || clockTime;
    var edits = function (n) { return n + (n === 1 ? " edit" : " edits"); };
    if (!st) return "No changes yet";
    if (st.conflicts) return "Two versions. Tap to pick one.";
    if (st.failed) return "Not saved. Tap to see why.";
    if (st.waiting && st.net === "offline") return "Offline — " + edits(st.waiting) + " waiting";
    if (st.waiting && st.net === "signedout") return "Signed out — " + edits(st.waiting) + " waiting";
    if (st.saving || st.waiting) return "Saving…";
    if (st.savedAt) return "Saved " + time(st.savedAt) + (repoHeld ? ". Waiting to copy to the repo." : "");
    return "No changes yet";
  }

  /** Who wrote a version, from its source. */
  function whoWrote(source) {
    return { chris: "Chris", machine: "The machine", agent: "An agent", "import": "Imported" }[source] || "Someone";
  }

  root.FundhubTeleprompterEdits = {
    clean: clean, locate: locate, applyEdit: applyEdit, rolledText: rolledText, wordDiff: wordDiff,
    diffWords: diffWords, liveOf: liveOf, createSaveQueue: createSaveQueue, statusText: statusText,
    clockTime: clockTime, whoWrote: whoWrote, RETRY_MS: RETRY_MS
  };
})(typeof window !== "undefined" ? window : globalThis);
