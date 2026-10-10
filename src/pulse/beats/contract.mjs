// The beat contract: what a beat is, how it is checked, and how it is run.
//
// Pulse v1 (ops/workflows/pulse-layer-2026-10-09-v1.md) cuts the contract
// (pulse-layer-2026-10-09-contract.md sections 2.1-2.7). Tonight a beat is
// READ ONLY: no door, no box, no identity, no stubs, no signing.
//
// A beat is one file, src/pulse/beats/beat-<id>.mjs, that exports:
//
//   id, title, kind ("probe" | "send" | "infra"), covers, box (must be false),
//   reads, steps, deadlineMs, damp (optional), needs (optional), fixGuide,
//   run(ctx), selfTest = { pass(), fail() }
//
// and talks to the world ONLY through ctx (src/pulse/beats/ctx.mjs):
//   ctx.read(sql, params)      reads, inside a READ ONLY transaction
//   ctx.http.get / ctx.http.head   GET and HEAD of hosts named in `reads`
//   ctx.step(name, fn), ctx.skipStep(name, why), ctx.fail(step, detail), ctx.done(detail)
//
// A beat file may import only ./contract.mjs, ./lib/*.mjs, node:crypto, and a
// module named in PURE_IMPORTS with a written reason. pinBeatSource() below is
// the static pin that beats.test.mjs runs over every beat file.
//
// CONVENTION THE SELF TEST CHECKS: selfTest.pass() must make every declared
// step run or be skipped (ctx.skipStep). A declared step that never runs is a
// step that cannot go red.
//
// WHAT runBeat DOES NOT DO: it never throws, it never sends, it never writes.

import { redact } from "../../lib/outbound-fetch.mjs";
import { PulseRefused } from "./readbox.mjs";

export const BEAT_ID_RE = /^[a-z0-9][a-z0-9-]{0,43}$/;
export const BEAT_KINDS = Object.freeze(["probe", "send", "infra"]);
export const MAX_DEADLINE_MS = 12000;
export const MAX_TITLE_CHARS = 60;
export const MAX_DETAIL_CHARS = 300;
export const FIX_LINE_MAX = 120;
export const FIX_GUIDE_MIN = 300;
/** What the runner can hand a beat as ctx.state (v1 delta 13). */
export const KNOWN_NEEDS = Object.freeze(["bankLinks"]);
/** Step names the harness uses itself. A beat may not declare these. */
export const RESERVED_STEPS = Object.freeze(["done", "deadline", "start", "no-refusals", "no-verdict"]);

/** The hidden handle the harness reads from a ctx. Not part of what a beat sees. */
export const HARNESS = Symbol.for("fundhub.pulse.beat-harness");

/** Thrown (and returned) by ctx.fail(). The beat went red at `step`. */
export class BeatFail extends Error {
  constructor(step, detail, evidence) {
    super(String(detail ?? ""));
    this.name = "BeatFail";
    this.step = String(step ?? "");
    this.detail = String(detail ?? "");
    this.evidence = evidence ?? null;
  }
}

/** Returned by ctx.done(). The beat finished green. */
export class BeatDone {
  constructor(detail, evidence) {
    this.detail = String(detail ?? "ok");
    this.evidence = evidence ?? null;
  }
}

/** undefined, empty, starts with "*", or 4+ asterisks: the laptop's stand-in for a secret. */
export function isMasked(value) {
  if (value === undefined || value === null) return true;
  const s = String(value).trim();
  return s === "" || s.startsWith("*") || /\*{4,}/.test(s);
}

/* ------------------------------------------------------------------ */
/* validateBeat                                                        */
/* ------------------------------------------------------------------ */

const STEP_RE = /^[a-z0-9][a-z0-9-]*$/;
const HOST_RE = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/;
const COVERS_RE = /^(?:(?:route|desk|page|job|send):\S+|webhook:[a-z0-9-]+)$/;
const SECRETISH = /\b(?:Bearer\s+\S+|ghp_\w+|sk_(?:live|test)_\w+|whsec_\w+|AKIA[0-9A-Z]{8,}|re_[A-Za-z0-9]{8,})|\*{4,}/;
const PATH_RE = /(?<![\w/.-])((?:src|api|netlify|scripts|db|docs|public|ops|marketing|\.github)\/[\w./[\]@-]+)/g;
const isAscii = (s) => /^[\x20-\x7e]*$/.test(String(s));

/** Repo paths a fix guide names. Pure. */
export function fixGuidePaths(fixGuide) {
  const out = [];
  for (const m of String(fixGuide ?? "").matchAll(PATH_RE)) {
    out.push(m[1].replace(/[.,;:)\]]+$/, ""));
  }
  return [...new Set(out)];
}

/** Problems with a fix guide's SHAPE (contract 2.4). Pure; no disk access. */
export function fixGuideProblems(fixGuide) {
  const p = [];
  if (typeof fixGuide !== "string") return ["fixGuide must be a string"];
  const lines = fixGuide.split("\n");
  const line1 = lines[0] ?? "";
  if (!line1.trim()) p.push("fixGuide line 1 is empty (it goes in the text)");
  if (line1.length > FIX_LINE_MAX) p.push(`fixGuide line 1 is ${line1.length} chars (max ${FIX_LINE_MAX})`);
  if (!isAscii(line1)) p.push("fixGuide line 1 must be plain ASCII (it goes in a text message)");
  if (fixGuide.length < FIX_GUIDE_MIN) p.push(`fixGuide is ${fixGuide.length} chars (min ${FIX_GUIDE_MIN})`);
  const at = (label) => fixGuide.indexOf(label);
  const cIdx = at("Likely causes:");
  const sIdx = at("Steps:");
  const fIdx = at("Files:");
  if (cIdx < 0) p.push('fixGuide needs a "Likely causes:" section');
  if (sIdx < 0) p.push('fixGuide needs a "Steps:" section');
  if (fIdx < 0) p.push('fixGuide needs a "Files:" section');
  if (cIdx >= 0 && sIdx >= 0 && fIdx >= 0 && !(cIdx < sIdx && sIdx < fIdx)) {
    p.push('fixGuide sections must come in the order "Likely causes:", "Steps:", "Files:"');
  } else {
    const bullets = (from, to) => (fixGuide.slice(from, to).match(/^\s*-\s+\S/gm) || []).length;
    if (cIdx >= 0 && sIdx > cIdx && bullets(cIdx, sIdx) < 2) p.push('"Likely causes:" needs 2 or more "- " bullets');
    if (sIdx >= 0 && fIdx > sIdx && bullets(sIdx, fIdx) < 2) p.push('"Steps:" needs 2 or more "- " bullets');
  }
  if (SECRETISH.test(fixGuide)) p.push("fixGuide looks like it holds a secret or a mask; the fix guide is shown to people");
  if (fIdx >= 0 && fixGuidePaths(fixGuide.slice(fIdx)).length === 0) p.push('"Files:" must name at least one repo path such as src/adapters/commas.mjs');
  return p;
}

/** Repo paths the fix guide names that are NOT on disk. exists(path) is injected so this file reads no disk. */
export function missingFixGuidePaths(fixGuide, exists) {
  const paths = fixGuidePaths(fixGuide);
  return { paths, missing: paths.filter((p) => !exists(p)), anyExists: paths.some((p) => exists(p)) };
}

function readsProblems(beat) {
  const p = [];
  if (!Array.isArray(beat.reads)) return ["reads must be an array of { host, methods }"];
  for (const [i, r] of beat.reads.entries()) {
    const where = `reads[${i}]`;
    if (!r || typeof r !== "object") { p.push(`${where} must be an object`); continue; }
    const host = r.host;
    if (host === "*") {
      if (beat.kind !== "probe") p.push(`${where}: "*" is allowed only for kind "probe"`);
    } else if (host !== "SITE" && !(typeof host === "string" && HOST_RE.test(host))) {
      p.push(`${where}.host must be "SITE", "*" or a lower-case host name (got ${JSON.stringify(host)})`);
    }
    if (!Array.isArray(r.methods) || r.methods.length === 0 || r.methods.some((m) => m !== "GET" && m !== "HEAD")) {
      p.push(`${where}.methods must be a non-empty list of "GET" and/or "HEAD"`);
    }
  }
  return p;
}

/**
 * Problems with a beat module, as a list of plain strings. Empty list = a good beat.
 *
 * @param {object} mod        the module namespace (or any object with the same exports)
 * @param {object} [opts]
 * @param {string} [opts.file]      the file name, e.g. "beat-apply-links.mjs"; the id must match it
 * @param {Set<string>} [opts.surfaces]  valid surface keys; when given, covers is checked against it
 */
export function validateBeat(mod, { file, surfaces } = {}) {
  const p = [];
  if (!mod || typeof mod !== "object") return ["the beat module is not an object"];

  if (typeof mod.id !== "string" || !BEAT_ID_RE.test(mod.id)) {
    p.push(`id must match ${BEAT_ID_RE} (got ${JSON.stringify(mod.id)})`);
  } else {
    if (/^(?:reg|job):/.test(mod.id)) p.push('id must not start with "reg:" or "job:"');
    if (file !== undefined) {
      const m = /^beat-(.+)\.mjs$/.exec(file);
      if (!m) p.push(`file name must be beat-<id>.mjs (got ${file})`);
      else if (m[1] !== mod.id) p.push(`id "${mod.id}" must equal the file name part "${m[1]}"`);
    }
  }

  if (typeof mod.title !== "string" || !mod.title.trim()) p.push("title is required");
  else {
    if (mod.title.length > MAX_TITLE_CHARS) p.push(`title is ${mod.title.length} chars (max ${MAX_TITLE_CHARS})`);
    if (!isAscii(mod.title)) p.push("title must be plain ASCII (it goes in a text message)");
  }

  if (mod.kind === "door") p.push('kind "door" does not exist in pulse v1 (read-only)');
  else if (!BEAT_KINDS.includes(mod.kind)) p.push(`kind must be one of ${BEAT_KINDS.join(", ")} (got ${JSON.stringify(mod.kind)})`);

  if (!Array.isArray(mod.covers)) p.push("covers must be an array");
  else {
    if (mod.covers.length === 0 && mod.kind === "send") p.push('covers may be [] only for kind "infra" or "probe"');
    for (const key of mod.covers) {
      if (typeof key !== "string" || !COVERS_RE.test(key)) p.push(`covers entry ${JSON.stringify(key)} is not route:/desk:/page:/job:/send:<name> or webhook:<provider>`);
      else if (surfaces && !key.startsWith("webhook:") && !surfaces.has(key)) p.push(`covers entry "${key}" is not a surface key`);
    }
  }

  if (mod.box !== false) p.push("box must be exactly false (the write box is not part of pulse v1)");
  for (const name of ["doors", "stubs"]) {
    if (mod[name] !== undefined && !(Array.isArray(mod[name]) && mod[name].length === 0)) p.push(`${name} is not part of pulse v1 (read-only)`);
  }
  for (const name of ["identity", "loadState", "persist"]) {
    if (mod[name] !== undefined) p.push(`${name} is not part of pulse v1; declare needs = ["bankLinks"] instead of loadState/persist`);
  }

  p.push(...readsProblems(mod));

  if (!Array.isArray(mod.steps) || mod.steps.length === 0) p.push("steps must be a non-empty array");
  else {
    const seen = new Set();
    for (const s of mod.steps) {
      if (typeof s !== "string" || !STEP_RE.test(s)) p.push(`step ${JSON.stringify(s)} must be lower-case words joined by "-"`);
      else if (RESERVED_STEPS.includes(s)) p.push(`step "${s}" is a harness name and may not be declared`);
      else if (seen.has(s)) p.push(`step "${s}" is declared twice`);
      seen.add(s);
    }
  }

  if (!Number.isInteger(mod.deadlineMs) || mod.deadlineMs < 500 || mod.deadlineMs > MAX_DEADLINE_MS) {
    p.push(`deadlineMs must be a whole number from 500 to ${MAX_DEADLINE_MS}`);
  }
  if (mod.damp !== undefined && !(Number.isInteger(mod.damp) && mod.damp >= 1 && mod.damp <= 3)) p.push("damp must be 1, 2 or 3");
  if (mod.needs !== undefined) {
    if (!Array.isArray(mod.needs) || mod.needs.some((n) => !KNOWN_NEEDS.includes(n))) p.push(`needs must be a list drawn from ${KNOWN_NEEDS.join(", ")}`);
  }

  p.push(...fixGuideProblems(mod.fixGuide));

  if (typeof mod.run !== "function") p.push("run(ctx) must be a function");
  if (!mod.selfTest || typeof mod.selfTest.pass !== "function" || typeof mod.selfTest.fail !== "function") {
    p.push("selfTest.pass and selfTest.fail must both be functions");
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* runBeat                                                             */
/* ------------------------------------------------------------------ */

const DEADLINE = Symbol("deadline");
const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);

/** @typedef {{ beatId: string, ok: boolean, step: string, detail: string, ms: number,
 *   steps: Array<{name: string, ms: number, ok: boolean, skipped?: boolean}>, skipped: string[], notRun: string[],
 *   evidence: object|null, box: null }} BeatResult */

/** The first step that failed and was neither skipped (ctx.skipStep) nor run again and passed. null if none. */
function swallowedFailure(steps) {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (s.ok !== false || s.skipped) continue;
    const handled = steps.some((t, j) => j !== i && t.name === s.name && (t.skipped || (j > i && t.ok === true)));
    if (!handled) return s.name;
  }
  return null;
}

/**
 * Run one beat. NEVER throws. Always resolves a BeatResult.
 *
 * Order of events: race run(ctx) against the deadline; turn a throw into a red;
 * if it came back green, run the harness's own checks (no-refusals, then a step
 * that failed and was swallowed).
 */
export async function runBeat(beat, ctx, { deadlineMs } = {}) {
  const t0 = nowMs();
  let handle = null;
  try { handle = ctx?.[HARNESS] ?? null; } catch { handle = null; }
  // Every read of the handle is guarded: runBeat NEVER throws, whatever the ctx is.
  const guard = (fn, fallback) => { try { return fn(); } catch { return fallback; } };
  const h = handle && {
    steps: () => guard(() => handle.steps(), []),
    refused: () => guard(() => handle.refused(), []),
    currentStep: () => guard(() => handle.currentStep(), null),
    lastStep: () => guard(() => handle.lastStep(), null),
    failedIn: () => guard(() => handle.failedIn(), null),
    abort: (why) => guard(() => handle.abort(why), undefined)
  };
  const beatId = String(beat?.id ?? "unknown");
  const limit = Math.min(Number.isFinite(deadlineMs) ? deadlineMs : (beat?.deadlineMs ?? MAX_DEADLINE_MS), MAX_DEADLINE_MS);

  const build = (ok, step, detail, evidence = null) => {
    const steps = h ? h.steps() : [];
    const ran = new Set(steps.map((s) => s.name));
    return {
      beatId,
      ok,
      step: ok ? "done" : String(step || "start"),
      detail: redact(String(detail ?? (ok ? "ok" : ""))).slice(0, MAX_DETAIL_CHARS),
      ms: nowMs() - t0,
      steps,
      skipped: steps.filter((s) => s.skipped).map((s) => s.name),
      notRun: Array.isArray(beat?.steps) ? beat.steps.filter((s) => !ran.has(s)) : [],
      evidence,
      box: null
    };
  };
  const where = () => (h ? (h.failedIn() ?? h.currentStep() ?? h.lastStep()) : null);

  try {
    if (!beat || typeof beat.run !== "function") return build(false, "start", "the beat has no run function");

    let timer;
    const deadline = new Promise((resolve) => { timer = setTimeout(() => resolve(DEADLINE), limit); });
    const settled = (async () => beat.run(ctx))().then((value) => ({ value }), (error) => ({ error }));
    const winner = await Promise.race([settled, deadline]);
    clearTimeout(timer);

    if (winner === DEADLINE) {
      const inStep = h ? h.currentStep() : null;
      if (h) h.abort("beat deadline passed");
      return build(false, inStep ?? "deadline",
        inStep ? `deadline ${limit} ms passed in step ${inStep}` : `deadline ${limit} ms passed before any step began`);
    }

    if ("error" in winner) {
      const err = winner.error;
      if (err instanceof BeatFail) return build(false, err.step, err.detail, err.evidence);
      if (err instanceof PulseRefused) return build(false, where(), `refused ${err.kind}: ${err.reason}${err.what ? ` (${err.what})` : ""}`);
      return build(false, where(), `threw: ${redact((err && err.message) || String(err))}`);
    }

    const value = winner.value;
    if (value instanceof BeatFail) return build(false, value.step, value.detail, value.evidence);
    if (!(value instanceof BeatDone)) return build(false, "no-verdict", "run() returned without ctx.done() or a thrown ctx.fail()");

    // Harness check: a refused read or host means the beat tried something it may not do.
    const refused = h ? h.refused() : [];
    if (refused.length) {
      const first = refused[0];
      return build(false, "no-refusals", `refused ${first.kind}: ${first.what}${refused.length > 1 ? ` (+${refused.length - 1} more)` : ""}`);
    }

    // Harness check: a step failed, the beat caught it and carried on, then said "done".
    // That is a false green. A failed step stands unless the beat skipped that step on
    // purpose (ctx.skipStep with a reason) or ran it again and it passed.
    const swallowed = swallowedFailure(h ? h.steps() : []);
    if (swallowed) {
      return build(false, swallowed, `step ${swallowed} failed, but the beat caught it and returned done`);
    }
    return build(true, "done", value.detail, value.evidence);
  } catch (err) {
    return build(false, where(), `harness error: ${redact((err && err.message) || String(err))}`);
  }
}

/* ------------------------------------------------------------------ */
/* checkBeatSelfTest                                                   */
/* ------------------------------------------------------------------ */

/**
 * Run a beat's own selfTest through the harness and return a list of problems.
 * A beat that cannot go red is rejected: a blind harness is a false green.
 *
 * makeCtx(beat, overrides) defaults to makeFakeCtx from ./ctx.mjs (loaded here, not at
 * the top, so ctx.mjs may import this file).
 */
export async function checkBeatSelfTest(beat, { makeCtx, limitMs = 2000 } = {}) {
  const problems = [];
  const id = beat?.id ?? "?";
  try {
    const make = makeCtx ?? (await import("./ctx.mjs")).makeFakeCtx;
    const declared = new Set(Array.isArray(beat?.steps) ? beat.steps : []);

    const pass = await runBeat(beat, make(beat, beat.selfTest.pass()), { deadlineMs: limitMs });
    if (!pass.ok) problems.push(`${id}: selfTest.pass went red at "${pass.step}": ${pass.detail}`);
    else if (pass.notRun.length) {
      problems.push(`${id}: selfTest.pass never ran step(s) ${pass.notRun.join(", ")} (run them, or call ctx.skipStep with a reason)`);
    }
    if (pass.ms > limitMs) problems.push(`${id}: selfTest.pass took ${pass.ms} ms (limit ${limitMs})`);

    const fail = await runBeat(beat, make(beat, beat.selfTest.fail()), { deadlineMs: limitMs });
    if (fail.ok) problems.push(`${id}: selfTest.fail stayed GREEN. A beat that cannot go red cannot find a break.`);
    else {
      if (!declared.has(fail.step)) problems.push(`${id}: selfTest.fail went red at "${fail.step}", which is not a declared step (${[...declared].join(", ")})`);
      if (!fail.detail.trim()) problems.push(`${id}: selfTest.fail went red with an empty detail`);
    }
    if (fail.ms > limitMs) problems.push(`${id}: selfTest.fail took ${fail.ms} ms (limit ${limitMs})`);
  } catch (err) {
    problems.push(`${id}: selfTest could not run: ${(err && err.message) || err}`);
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* The static pin                                                      */
/* ------------------------------------------------------------------ */

/** Modules (other than ./contract.mjs, ./lib/* and node:crypto) a beat may import.
    Each entry is specifier -> why it is pure (no I/O, no clock, no network).
    Empty to start. Adding one is a decision someone reads. */
export const PURE_IMPORTS = Object.freeze({});

const BANNED_IMPORTS = [
  [/(^|\/)db\.mjs$/, "the database module"],
  [/(^|\/)messaging\/providers\//, "a messaging provider"],
  [/(^|\/)providers\//, "a provider"],
  [/(^|\/)(notify|alerts|records|runner)\.mjs$/, "a sender or recorder"],
  [/outbound-fetch\.mjs$/, "the outbound chokepoint"],
  [/(^|\/)adapters\//, "an adapter"],
  [/^(?:node:)?(?:pg|net|tls|http|https|http2|dgram|dns|child_process|worker_threads|vm|cluster|fs|fs\/promises|os)$/, "a Node module that does I/O"]
];

/* Same trade the repo's own fence test makes (src/lib/no-unfenced-transmit.test.mjs):
   only whole-line comments and block comments that START a line are dropped. A comment
   that trails code is scanned. A false alarm costs one reworded comment; a miss costs
   the point of the pin. */
function stripForPin(text) {
  return String(text)
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (m) => m.replace(/[^\n]/g, " "))
    .split("\n")
    .map((line) => (line.trim().startsWith("//") ? "" : line))
    .join("\n");
}

const TOKEN_RULES = [
  [/\bfetch\s*\(/, "calls fetch( (use ctx.http)"],
  [/\bfetchImpl\b/, "names fetchImpl (use ctx.http)"],
  [/\bglobalThis\b/, "reaches for globalThis"],
  [/\bglobal\./, "reaches for global."],
  [/\bXMLHttpRequest\b/, "uses XMLHttpRequest"],
  [/\bWebSocket\b/, "uses WebSocket"],
  [/\bEventSource\b/, "uses EventSource"],
  [/\bprocess\.env\b/, "touches process.env (read ctx.env; writes are banned outright)"],
  [/\bprocess\.(?:exit|kill|chdir|binding|dlopen|on|once)\b/, "touches the process"],
  [/\beval\s*\(/, "calls eval("],
  [/\bnew\s+Function\b|\bFunction\s*\(/, "builds code with Function"],
  [/\brequire\s*\(/, "calls require("],
  [/\bsetInterval\s*\(/, "starts a timer that never ends (setInterval)"],
  [/\bctx\.(?:db|door|fetch|pool|identity|boxReport|resetScope)\b/, "uses a ctx field that does not exist in pulse v1"]
];

/* THE CODE VIEW. The source with comments, string bodies and regex bodies blanked to
   spaces. What is left is only names and punctuation, so a rule can ban a NAME (fetch,
   process, eval) without tripping on a word inside a message ("the fetch failed"). The
   code inside a template literal's ${...} stays, because it runs.

   Why names, not only call shapes: the first pin looked for the text `fetch(` and let
   `const f = fetch; f(url, { method: "POST" })`, `fetch.call(...)`, `process["env"]` and
   `(() => {}).constructor("return process")()` through (checker finding, 2026-10-09).
   A beat never needs these names, so the names are banned. */
const REGEX_AFTER = "(,=:[!&|?{};+-*%<>~^";
const REGEX_AFTER_WORDS = new Set(["return", "typeof", "case", "in", "of", "delete", "void", "throw", "new", "else", "do", "yield", "await", "instanceof"]);

export function codeView(text) {
  const src = String(text);
  const n = src.length;
  let i = 0;
  let out = "";
  const blank = (str) => str.replace(/[^\n]/g, " ");

  function template() {
    while (i < n) {
      const c = src[i];
      if (c === "\\") { out += blank(src.slice(i, i + 2)); i += 2; continue; }
      if (c === "`") { out += "`"; i++; return; }
      if (c === "$" && src[i + 1] === "{") { out += "${"; i += 2; code(true); continue; }
      out += c === "\n" ? "\n" : " ";
      i++;
    }
  }

  function code(inTemplate) {
    let depth = 0;
    let prev = ""; // last significant character, "a" for a word
    let word = ""; // the last word, when prev is "a"
    while (i < n) {
      const ch = src[i];
      const next = src[i + 1];
      if (ch === "/" && next === "/") {
        let j = i;
        while (j < n && src[j] !== "\n") j++;
        out += blank(src.slice(i, j));
        i = j;
        continue;
      }
      if (ch === "/" && next === "*") {
        const j = src.indexOf("*/", i + 2);
        const e = j === -1 ? n : j + 2;
        out += blank(src.slice(i, e));
        i = e;
        continue;
      }
      if (ch === "'" || ch === '"') {
        let j = i + 1;
        while (j < n && src[j] !== ch && src[j] !== "\n") j += src[j] === "\\" ? 2 : 1;
        j = Math.min(j, n);
        const closed = src[j] === ch;
        out += ch + blank(src.slice(i + 1, j)) + (closed ? ch : "");
        i = closed ? j + 1 : j;
        prev = ch; word = "";
        continue;
      }
      if (ch === "`") { out += "`"; i++; template(); prev = "`"; word = ""; continue; }
      if (ch === "/" && (prev === "" || REGEX_AFTER.includes(prev) || (prev === "a" && REGEX_AFTER_WORDS.has(word)))) {
        let j = i + 1;
        let inClass = false;
        while (j < n && src[j] !== "\n") {
          const c = src[j];
          if (c === "\\") { j += 2; continue; }
          if (c === "[") inClass = true;
          else if (c === "]") inClass = false;
          else if (c === "/" && !inClass) break;
          j++;
        }
        j = Math.min(j, n);
        const closed = src[j] === "/";
        out += "/" + blank(src.slice(i + 1, j)) + (closed ? "/" : "");
        i = closed ? j + 1 : j;
        prev = "/"; word = "";
        continue;
      }
      if (/[A-Za-z0-9_$]/.test(ch)) {
        let j = i;
        while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
        word = src.slice(i, j);
        out += word;
        i = j;
        prev = "a";
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") {
        if (depth === 0 && inTemplate) { out += "}"; i++; return; }
        if (depth > 0) depth--;
      }
      out += ch;
      i++;
      if (!/\s/.test(ch)) { prev = ch; word = ""; }
    }
  }

  code(false);
  return out;
}

/* Names a beat may never use. Each is a way to reach the network, the process, or code
   built at run time. A property of something else (row.process) is fine; a bare name is not.
   Matched against codeView(), so a word inside a string or a comment does not count. */
const IDENT_RULES = [
  [/(?<![\w$.])fetch\b/, "names fetch (use ctx.http)"],
  [/(?<![\w$.])process\b/, "names process (use ctx.env and ctx.now)"],
  [/(?<![\w$.])(?:global|self|window)\b/, "reaches for the global object"],
  [/\b(?:Reflect|Proxy)\b/, "uses Reflect or Proxy"],
  [/\bRequest\b/, "names Request (a Request is a way to fetch)"],
  [/\bsendBeacon\b|\bnavigator\b/, "uses navigator or sendBeacon"],
  [/\b(?:Worker|SharedWorker|MessageChannel|BroadcastChannel|WebAssembly)\b/, "uses a worker, channel or WebAssembly"],
  [/\beval\b/, "names eval"],
  [/\bFunction\b/, "names Function"],
  [/\bconstructor\b/, "names constructor (a way to build Function)"],
  [/\bimport\s*\.\s*meta\b/, "uses import.meta"],
  [/\bSymbol\s*\.\s*for\b/, "uses Symbol.for (the harness handle is a registered symbol)"],
  [/\\/, "has a backslash outside a string or regex (an escaped name)"]
];

const SQL_WRITE_RULES = [
  [/\binsert\s+into\s+[\w."${}]+\s*(?:\(|values\b|select\b|default\b|overriding\b|with\b|on\b)/i, "INSERT INTO"],
  [/\bupdate\s+[\w."${}]+\s+set\s/i, "UPDATE ... SET"],
  [/\bdelete\s+from\s+[\w."${}]+\s*(?:where\b|using\b|returning\b|;|$)/i, "DELETE FROM"],
  [/\btruncate\s+table\b|\btruncate\s+[\w."${}]+\s*(?:;|$|cascade\b|restart\b)/i, "TRUNCATE"],
  [/\bdrop\s+(?:table|index|schema|view|function|trigger|policy|role|extension|sequence|database|type|materialized)\b/i, "DROP"],
  [/\balter\s+(?:table|index|schema|view|function|role|policy|system|database|sequence|type|extension)\b/i, "ALTER"],
  [/\bcreate\s+(?:or\s+replace\s+)?(?:(?:temp|temporary|unlogged|unique|recursive)\s+)*(?:table|index|view|function|trigger|policy|role|extension|sequence|schema|type|materialized)\b/i, "CREATE"],
  [/\bgrant\s+[\w\s,]+\s+on\b/i, "GRANT"],
  [/\brevoke\s+[\w\s,]+\s+on\b/i, "REVOKE"],
  [/\bfor\s+(?:no\s+key\s+)?(?:update|share)\b|\bfor\s+key\s+share\b/i, "a row lock (FOR UPDATE / FOR SHARE)"],
  [/\bpg_advisory\w*|\bpg_sleep\w*|\bset_config\b|\bdblink\w*|\bnextval\b|\bsetval\b|\blo_(?:import|export|create|unlink|put|from_bytea|open)\b/i, "a function with side effects"],
  [/\bcopy\s+[\w."(]+[^;]*\b(?:to|from)\s+(?:program\b|stdin\b|stdout\b|')/i, "COPY"]
];

/* Every string literal body in the source ('...', "...", `...`), so SQL written as
   a string is found wherever it hides. */
function stringBodies(src) {
  const out = [];
  const re = /'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/**
 * Problems found in a beat (role "beat") or a beat helper under lib/ (role "lib").
 * Pure: takes source text, returns a list of plain strings. Empty list = clean.
 *
 * It is a tripwire for accidents, not a sandbox against a hostile author. The walls
 * that hold either way are the read box (Postgres READ ONLY) and the GET/HEAD-only probe,
 * and they only cover calls made THROUGH ctx. THIS PIN IS THE ONLY WALL against a beat that
 * reaches the network or the process some other way, so it bans the names, not just the
 * call shapes (see codeView). It does not catch SQL assembled at run time ("DEL" + "ETE");
 * that is stopped by the read box when the string reaches ctx.read.
 */
export function pinBeatSource(text, { role = "beat", pureImports = PURE_IMPORTS } = {}) {
  const problems = [];
  const src = stripForPin(text);

  const allowed = (spec) => {
    if (spec === "node:crypto") return true;
    if (Object.prototype.hasOwnProperty.call(pureImports, spec)) return true;
    if (role === "lib") return spec === "../contract.mjs" || /^\.\/[A-Za-z0-9._-]+\.mjs$/.test(spec);
    return spec === "./contract.mjs" || spec === "../beats/contract.mjs" || /^\.\/lib\/[A-Za-z0-9._-]+\.mjs$/.test(spec);
  };
  const specs = [];
  const take = (re) => { let m; while ((m = re.exec(src))) specs.push(m[1]); };
  take(/\bimport\s*(?:[\w*${},\s]+?\s*from\s*)?["']([^"']+)["']/g);
  take(/\bexport\s+(?:\*|\{[^}]*\})\s*(?:as\s+\w+\s*)?from\s*["']([^"']+)["']/g);
  take(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g);
  for (const m of src.matchAll(/\bimport\s*\(\s*(?!["'])/g)) problems.push(`has a dynamic import with a computed name at offset ${m.index}`);

  for (const spec of specs) {
    if (allowed(spec)) continue;
    const named = BANNED_IMPORTS.find(([re]) => re.test(spec));
    problems.push(named ? `imports ${named[1]}: "${spec}"` : `imports "${spec}", which is not on the allow-list (add it to PURE_IMPORTS with a written reason)`);
  }

  for (const [re, why] of TOKEN_RULES) {
    if (re.test(src)) problems.push(why);
  }
  const code = codeView(src);
  for (const [re, why] of IDENT_RULES) {
    if (re.test(code) && !problems.includes(why)) problems.push(why);
  }

  const seen = new Set();
  for (const body of stringBodies(src)) {
    for (const [re, name] of SQL_WRITE_RULES) {
      if (re.test(body) && !seen.has(name)) {
        seen.add(name);
        problems.push(`a string holds SQL that is not a read: ${name}`);
      }
    }
  }
  return problems;
}
