// The ctx a beat gets. This is everything a beat can touch.
//
// Pulse v1 (ops/workflows/pulse-layer-2026-10-09-v1.md, deltas 1-4).
//
//   ctx.read(sql, params)        reads inside a READ ONLY transaction (src/pulse/beats/readbox.mjs)
//   ctx.http.get / ctx.http.head GET and HEAD, only to hosts the beat declared in `reads`
//   ctx.live                     true on Netlify / Lambda, false on a laptop
//   ctx.skipStep(name, why)      records a step as ok-but-skipped; NEVER red
//   ctx.dbSettings()             one plain query outside the box (is the pool stuck read-only?)
//   ctx.step(name, fn)           names a step; the name must be in beat.steps
//   ctx.fail(step, detail, ev)   returns a BeatFail; the beat does `throw ctx.fail(...)`
//   ctx.done(detail, ev)         returns a BeatDone; the beat does `return ctx.done(...)`
//   ctx.env                      a frozen COPY of the environment (read names, never print values)
//   ctx.runId, beatId, now, siteUrl, signal, state
//
// There is NO ctx.db, no ctx.door, no identity, no sender. A beat cannot save a
// record, send a text or call a vendor with a write, because nothing here can.
//
// makeBeatCtx takes the read function, the probe and dbSettings as arguments, so
// this file imports no database code and no network code.

import {
  BeatFail, BeatDone, HARNESS, isMasked
} from "./contract.mjs";
import { PulseRefused, normalizeQuery } from "./readbox.mjs";

export { isMasked };

const nowMs = () => Number(process.hrtime.bigint() / 1_000_000n);
const clip = (s, n = 80) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

const hostOf = (value) => {
  try { return new URL(String(value)).hostname.toLowerCase(); } catch { return null; }
};

/* A beat may call ctx.read() or ctx.http.get() and never await it. If that call is then
   refused or fails, the rejected promise would have no handler and Node 22 would end the
   process. So every promise the ctx hands out gets a do-nothing catch attached first. The
   caller who DOES await still sees the rejection; a refusal is already recorded and turns
   the run red at "no-refusals" either way (pulse v1 critic issue 2). */
function quiet(promise) {
  promise.catch(() => {});
  return promise;
}

/** The failed-probe shape, for a call that never went out. */
function noCall(host, error, klass = "refused") {
  return { ok: false, status: 0, ms: 0, finalHost: host ?? null, bodySnippet: "", body: "", headers: {}, error, class: klass };
}

/**
 * Build the ctx for one beat.
 *
 * @param {object} a
 * @param {object} a.beat        the beat module (steps, reads, id)
 * @param {string} a.runId
 * @param {object} a.env         copied and frozen
 * @param {Date}   [a.now]
 * @param {string} [a.siteUrl]   the site the beat may call as "SITE"
 * @param {any}    [a.state]     what the runner loaded for beat.needs
 * @param {AbortSignal} [a.signal]  the run's signal; the beat's own signal also aborts at its deadline
 * @param {(text: string, params?: any[]) => Promise<{rows: any[], rowCount?: number}>} [a.read]
 * @param {{get: Function, head: Function}} [a.probe]
 * @param {() => Promise<object>} [a.dbSettings]
 */
export function makeBeatCtx({ beat, runId, env, now, siteUrl, state = null, signal, read, probe, dbSettings } = {}) {
  if (!beat || !Array.isArray(beat.steps)) throw new TypeError("makeBeatCtx needs a beat with steps");
  const frozenEnv = Object.freeze({ ...(env || {}) });
  const live = Boolean(frozenEnv.AWS_LAMBDA_FUNCTION_NAME || frozenEnv.NETLIFY);
  const site = String(siteUrl ?? frozenEnv.URL ?? "").replace(/\/+$/, "");
  const siteHost = hostOf(site);
  const declared = new Set(beat.steps);
  const reads = Array.isArray(beat.reads) ? beat.reads : [];

  const controller = new AbortController();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  // --- what the harness reads back (runBeat), kept out of the beat's sight ---
  const stepLog = [];
  const refusals = [];
  const readLog = [];
  const httpLog = [];
  let inStep = null;
  let lastStep = null;
  let failedIn = null;

  const refused = (kind, what) => { refusals.push({ kind, what: clip(what, 120) }); };
  const aborted = () => {
    if (controller.signal.aborted) throw new Error("the beat is over (deadline passed or run cut)");
  };

  function step(name, fn) {
    return quiet(stepAsync(name, fn));
  }

  async function stepAsync(name, fn) {
    if (!declared.has(name)) throw new Error(`step "${name}" is not in this beat's steps (${[...declared].join(", ")})`);
    if (typeof fn !== "function") throw new TypeError(`ctx.step("${name}") needs a function`);
    const outer = inStep;
    if (outer === null) failedIn = null; // a new top-level step: an earlier, handled failure is no longer "where we are"
    inStep = name;
    const t0 = nowMs();
    try {
      const value = await fn();
      stepLog.push({ name, ms: nowMs() - t0, ok: true });
      return value;
    } catch (err) {
      stepLog.push({ name, ms: nowMs() - t0, ok: false });
      if (failedIn === null) failedIn = name;
      throw err;
    } finally {
      lastStep = name;
      inStep = outer;
    }
  }

  function skipStep(name, why) {
    if (!declared.has(name)) throw new Error(`step "${name}" is not in this beat's steps (${[...declared].join(", ")})`);
    stepLog.push({ name, ms: 0, ok: true, skipped: true, why: clip(why, 200) });
    lastStep = name;
  }

  async function ctxRead(sql, params) {
    aborted();
    let q;
    try {
      q = normalizeQuery(sql, params);
    } catch (err) {
      if (err instanceof PulseRefused) refused(err.kind, `${err.reason}${err.what ? `: ${err.what}` : ""}`);
      throw err;
    }
    if (typeof read !== "function") throw new Error("ctx.read is not available in this run (no database)");
    readLog.push({ sql: q.text, params: q.values });
    let res;
    try {
      res = await read(q.text, q.values);
    } catch (err) {
      if (err instanceof PulseRefused) refused(err.kind, `${err.reason}${err.what ? `: ${err.what}` : ""}`);
      throw err;
    }
    const rows = Array.isArray(res?.rows) ? res.rows : Array.isArray(res) ? res : [];
    return { rows, rowCount: typeof res?.rowCount === "number" ? res.rowCount : rows.length };
  }

  /* Which declared `reads` entry covers this host and method? Specific hosts first,
     "*" last. Returns { entry, star } or null. */
  function allowedFor(host, method) {
    const fits = (entry) => Array.isArray(entry.methods) && entry.methods.includes(method);
    for (const entry of reads) {
      if (entry.host === "*" || !fits(entry)) continue;
      if (entry.host === "SITE" ? host === siteHost : String(entry.host).toLowerCase() === host) return { entry, star: false };
    }
    const star = reads.find((e) => e.host === "*" && fits(e));
    return star ? { entry: star, star: true } : null;
  }

  async function httpCall(method, url, opts) {
    aborted();
    if (!probe || typeof probe[method.toLowerCase()] !== "function") throw new Error("ctx.http is not available in this run (no probe)");
    const host = hostOf(url);
    if (!host) {
      refused("host", `${method} ${clip(url, 60)} is not a web address`);
      throw new PulseRefused("host", "bad_url", `${method} ${clip(url, 60)}`);
    }
    const hit = allowedFor(host, method);
    if (!hit) {
      refused("host", `${method} ${host} is not in this beat's reads`);
      throw new PulseRefused("host", "host_not_declared", `${method} ${host}`);
    }
    // "*" may reach bank sites, never our own domain (critic issue 15).
    if (hit.star && (host === "fundhub.ai" || host.endsWith(".fundhub.ai") || host === siteHost)) {
      return noCall(host, `refused: ${host} is our own site; "*" reads reach other hosts only`);
    }
    const t0 = nowMs();
    // Only headers pass through. A beat cannot hand the probe its own fetch, env or http switch.
    const res = await probe[method.toLowerCase()](url, { headers: opts && typeof opts === "object" ? opts.headers : undefined, siteHost });
    httpLog.push({ method, host, status: res?.status ?? 0, ms: nowMs() - t0 });
    return res;
  }

  const http = Object.freeze({
    get: (url, opts) => quiet(httpCall("GET", url, opts)),
    head: (url, opts) => quiet(httpCall("HEAD", url, opts))
  });

  const ctx = {
    runId: String(runId ?? ""),
    beatId: beat.id,
    now: now instanceof Date ? new Date(now.getTime()) : new Date(),
    siteUrl: site,
    signal: controller.signal,
    env: frozenEnv,
    live,
    state,
    read: (sql, params) => quiet(ctxRead(sql, params)),
    http,
    dbSettings: () => quiet((async () => {
      aborted();
      if (typeof dbSettings !== "function") throw new Error("ctx.dbSettings is not available in this run (no database)");
      return dbSettings();
    })()),
    step,
    skipStep,
    fail: (stepName, detail, evidence) => new BeatFail(stepName, detail, evidence),
    done: (detail, evidence) => new BeatDone(detail, evidence)
  };

  Object.defineProperty(ctx, HARNESS, {
    enumerable: false,
    value: Object.freeze({
      currentStep: () => inStep,
      lastStep: () => lastStep,
      failedIn: () => failedIn,
      steps: () => stepLog.map((s) => ({ ...s })),
      refused: () => refusals.map((r) => ({ ...r })),
      reads: () => readLog.map((r) => ({ ...r })),
      httpCalls: () => httpLog.map((r) => ({ ...r })),
      abort: () => controller.abort()
    })
  });
  return Object.freeze(ctx);
}

/* ------------------------------------------------------------------ */
/* The fake ctx: no network, no database. For selfTest and unit tests. */
/* ------------------------------------------------------------------ */

export const FAKE_NOW = new Date("2026-10-09T19:07:00.000Z");

const OK_PROBE = { ok: true, status: 200, ms: 5, finalHost: null, bodySnippet: "", body: "", headers: {}, error: null, class: "ok" };

function klassOf(status) {
  if (status >= 200 && status < 300) return "ok";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 400 && status < 500) return "http_4xx";
  if (status >= 500) return "http_5xx";
  return "network";
}

/** Fill in a partial probe answer: { status: 404 } becomes a complete failed result. */
export function fakeProbeResult(partial, url) {
  const status = partial.status ?? 200;
  const body = partial.body ?? partial.bodySnippet ?? "";
  return {
    ...OK_PROBE,
    finalHost: hostOf(url),
    ...partial,
    status,
    ok: partial.ok ?? (status >= 200 && status < 300),
    class: partial.class ?? klassOf(status),
    body,
    bodySnippet: partial.bodySnippet ?? String(body).slice(0, 2048),
    error: partial.error ?? null
  };
}

const matches = (m, text) => (m instanceof RegExp ? m.test(text) : String(text).includes(String(m)));

/* Canned answers. A query or URL with no canned answer FAILS LOUDLY: a fake that
   answers everything proves nothing about the SQL. */
function fakeRead(spec) {
  if (typeof spec === "function") return async (text, params) => spec(text, params);
  const rules = Array.isArray(spec) ? spec : [];
  return async (text, params) => {
    for (const rule of rules) {
      if (!matches(rule.match, text)) continue;
      if (rule.error) throw (rule.error instanceof Error ? rule.error : new Error(String(rule.error)));
      if (typeof rule.fn === "function") return rule.fn(text, params);
      return { rows: rule.rows ?? [], rowCount: rule.rowCount ?? (rule.rows ?? []).length };
    }
    throw new Error(`fake read: no canned answer for: ${clip(text, 90)}`);
  };
}

function fakeProbe(spec) {
  const answer = (method) => async (url, opts) => {
    let partial;
    if (typeof spec === "function") partial = await spec(method, url, opts);
    else if (Array.isArray(spec)) {
      const rule = spec.find((r) => (!r.method || r.method === method) && matches(r.match, url));
      partial = rule ? (typeof rule.result === "function" ? await rule.result(method, url, opts) : rule.result) : undefined;
    } else if (spec && typeof spec === "object") {
      partial = spec[`${method} ${url}`] ?? spec[url];
    }
    if (partial === undefined) return noCall(hostOf(url), `fake http: no canned answer for ${method} ${clip(url, 90)}`, "fake_unmatched");
    if (partial instanceof Error) return noCall(hostOf(url), partial.message, "network");
    return fakeProbeResult(partial, url);
  };
  return { get: answer("GET"), head: answer("HEAD") };
}

/**
 * A ctx with no network and no database.
 *
 * overrides: {
 *   env, now, siteUrl, state, runId,
 *   read:  function(sql, params) | [{ match: RegExp|string, rows|rowCount|error|fn }],
 *   http:  function(method, url, opts) | { "GET https://x/y": partial } | [{ match, method?, result }],
 *   dbSettings: function | object
 * }
 * Reads go through the SAME allow-list as the real box (assertReadOnlySql), and http goes
 * through the SAME declared-host check as the real ctx, so a beat's tests catch a refusal.
 */
export function makeFakeCtx(beat, overrides = {}) {
  const dbs = overrides.dbSettings;
  return makeBeatCtx({
    beat,
    runId: overrides.runId ?? "fake-run",
    env: overrides.env ?? {},
    now: overrides.now ?? FAKE_NOW,
    siteUrl: overrides.siteUrl ?? "https://fundhub.ai",
    state: overrides.state ?? null,
    read: fakeRead(overrides.read),
    probe: fakeProbe(overrides.http),
    dbSettings: typeof dbs === "function" ? dbs
      : async () => ({ ok: true, ms: 3, transaction_read_only: false, default_transaction_read_only: false, in_recovery: false, ...(dbs || {}) })
  });
}

/** What a fake ctx saw: the reads it ran and the http calls it made. For tests. */
export function ctxLog(ctx) {
  const h = ctx?.[HARNESS];
  return h ? { reads: h.reads(), http: h.httpCalls(), steps: h.steps(), refused: h.refused() } : null;
}
