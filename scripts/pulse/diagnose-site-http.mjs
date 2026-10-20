#!/usr/bin/env node
// Read-only runner evidence, not a release verdict. Node 22 built-ins only.
// Run: node scripts/pulse/diagnose-site-http.mjs (matched provider fan-outs)
// Optional original transport matrix: add --baseline
// Fixed public GETs only. Never log bodies, URLs with queries, headers, or env.
import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";
import dns from "node:dns";
import https from "node:https";
import net from "node:net";
import { pathToFileURL } from "node:url";

const SITE = "https://fundhub.ai";
export const REQUEST_MS = 8000;
export const TOTAL_MS = 55000;
export const MATCHED_CONCURRENCIES = Object.freeze([12, 3, 12, 3]);
export const PATHS = Object.freeze([
  "/api/health", "/portal-login.html", "/roadmap", "/roadmap/pay.html",
  "/api/public/slo-checkout", "/api/auth/magic-link", "/api/webhooks/clickfunnels",
  "/api/webhooks/commas", "/api/public/survey-submit", "/api/public/slo-interest",
  "/api/public/funnel-checkout", "/api/public/slo-repair-checkout"
]);
const ms = (start) => Math.round(performance.now() - start);
const print = (record) => console.log(JSON.stringify(record));
const token = (value) => typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : null;

export function diagnosticTarget(path) {
  if (!PATHS.includes(path)) throw new Error("Unknown diagnostic path");
  const target = new URL(path, SITE);
  if (path === "/api/health") target.searchParams.set("strict", "1");
  return target;
}

export function errorFacts(error) {
  const codes = new Set();
  const seen = new Set();
  const visit = (item, depth = 0) => {
    if (!item || depth > 4 || seen.has(item)) return;
    seen.add(item);
    if (token(item.code)) codes.add(item.code);
    visit(item.cause, depth + 1);
    if (Array.isArray(item.errors)) item.errors.slice(0, 8).forEach((entry) => visit(entry, depth + 1));
  };
  visit(error);
  return { error: token(error?.name), codes: [...codes] };
}

export function lastPhase(times) {
  if (times.bodyDone !== undefined) return "body-complete";
  if (times.responseHeaders !== undefined) return "reading-response-body";
  if (times.requestSent !== undefined) return "request-sent-awaiting-headers";
  if (times.headersWrite !== undefined) return "request-write-started-awaiting-headers";
  if (times.tls !== undefined) return "tls-ready-before-request-finish";
  if (times.tcp !== undefined) return "tcp-connected-awaiting-tls";
  if (times.connectAttempt !== undefined) return "connect-attempt-no-tcp";
  if (times.dnsError !== undefined) return "dns-failed";
  if (times.dns !== undefined) return "dns-done-awaiting-connect";
  if (times.requestCreated !== undefined) return "request-created-not-yet-written";
  return "request-started";
}

function socketFacts(socket) {
  return {
    remoteAddress: socket?.remoteAddress || null,
    remoteFamily: socket?.remoteFamily || null,
    tlsAuthorized: socket?.authorized ?? null,
    attempts: Array.isArray(socket?.autoSelectFamilyAttemptedAddresses)
      ? socket.autoSelectFamilyAttemptedAddresses.slice(0, 8) : []
  };
}

// Connection channels are shared: beforeConnect is NOT proof that a particular
// request owns that connection. Only sendHeaders binds request identity to socket.
// https://undici.nodejs.org/api/DiagnosticsChannel
export function observeFetch(emit, started = performance.now()) {
  const context = new AsyncLocalStorage();
  const requests = new WeakMap();
  const sockets = new WeakMap();
  const subscriptions = [];
  let socketCount = 0;
  const socketId = (socket) => {
    if (!sockets.has(socket)) sockets.set(socket, ++socketCount);
    return sockets.get(socket);
  };
  const watch = (name, fn) => {
    const target = channel(`undici:${name}`);
    const listener = (message) => { try { fn(message); } catch { /* instrumentation cannot change the GET */ } };
    target.subscribe(listener);
    subscriptions.push(() => target.unsubscribe(listener));
  };
  const mark = (request, name) => {
    const state = requests.get(request);
    if (state && state.times[name] === undefined) state.times[name] = ms(state.row.started);
    return state;
  };
  watch("request:create", ({ request }) => {
    const row = context.getStore();
    if (!row) return;
    if (row.times.requestCreated !== undefined) {
      row.priorHops ||= [];
      row.priorHops.push({ times: row.times, ...(row.socket ? { socket: row.socket } : {}) });
      row.times = {};
      delete row.socket;
      delete row.transportError;
    }
    requests.set(request, { row, times: row.times });
    mark(request, "requestCreated");
  });
  watch("client:sendHeaders", ({ request, socket }) => {
    const state = mark(request, "headersWrite");
    if (state && socket && state.times === state.row.times) state.row.socket = { id: socketId(socket), ...socketFacts(socket) };
  });
  watch("request:bodySent", ({ request }) => mark(request, "requestSent"));
  watch("request:headers", ({ request }) => mark(request, "responseHeaders"));
  watch("request:error", ({ request, error }) => {
    const state = requests.get(request);
    if (state && state.times === state.row.times) state.row.transportError = errorFacts(error);
  });
  for (const [name, event] of [["beforeConnect", "before-connect"], ["connected", "connected"], ["connectError", "connect-error"]]) {
    watch(`client:${name}`, ({ connectParams, socket, error }) => {
      const host = connectParams?.hostname;
      if (!["fundhub.ai", "apply.fundhub.ai"].includes(host)) return;
      emit({ kind: "connection", event, host, atMs: ms(started),
        ...(socket ? { socketId: socketId(socket), ...socketFacts(socket) } : {}),
        ...(error ? errorFacts(error) : {}) });
    });
  }
  return {
    run: (row, fn) => context.run(row, fn),
    close: () => { subscriptions.forEach((unsubscribe) => unsubscribe()); context.disable(); }
  };
}

// Every stage visits the identical fixed paths. A low-concurrency stage queues
// all twelve instead of silently testing just its first three paths.
export async function runFixedPathStage(concurrency, runTrial, shouldStop = () => false) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > PATHS.length) throw new Error("Invalid diagnostic concurrency");
  let next = 0;
  let active = 0;
  let peakActive = 0;
  let completed = 0;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (!shouldStop() && next < PATHS.length) {
      const path = PATHS[next++];
      peakActive = Math.max(peakActive, ++active);
      try { await runTrial(path); completed++; } finally { active--; }
    }
  }));
  return { requested: PATHS.length, started: next, completed, skipped: PATHS.length - next,
    peakActive, complete: completed === PATHS.length && !shouldStop() };
}

async function dnsInventory() {
  const started = performance.now();
  let timer;
  const lookup = new Promise((resolve) => {
    dns.lookup("fundhub.ai", { all: true }, (error, addresses) => resolve({
      kind: "dns", ms: ms(started), addresses: addresses || [], ...(error ? errorFacts(error) : {})
    }));
  });
  const result = await Promise.race([lookup, new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: "dns", ms: ms(started), error: "DiagnosticDnsDeadline" }), 3000);
  })]);
  clearTimeout(timer);
  print(result);
}

async function fetchTrial(row, trace, signal, provider) {
  return trace.run(row, async () => {
    try {
      if (provider) {
        // Same provider and native fetch as the failing proof. No fake fetch,
        // enlarged timeout, changed fence, or replacement success verdict.
        const result = await provider(diagnosticTarget(row.path).href, {
          env: { ADAPTERS_DRY_RUN: "0" }, timeoutMs: REQUEST_MS, signal
        });
        row.status = result.status;
        row.providerClass = result.class;
        row.bytes = result.bytes;
        row.redirects = result.redirects;
        row.outcome = result.status ? "response" : "network-error";
        if (result.status) row.times.bodyDone = ms(row.started);
      } else {
        // Exact native control: no custom dispatcher, headers, or body wrapper.
        const response = await fetch(diagnosticTarget(row.path), { signal });
        row.status = response.status;
        row.times.responseHeaders ??= ms(row.started);
        row.bytes = (await response.arrayBuffer()).byteLength;
        row.times.bodyDone = ms(row.started);
        row.outcome = "response";
      }
    } catch (error) {
      Object.assign(row, errorFacts(error), { outcome: "network-error" });
    }
  });
}

async function httpsTrial(row, signal, family) {
  await new Promise((resolve) => {
    // A fresh socket makes DNS, TCP and TLS visible independently. Explicit
    // family controls affect this diagnostic request only, never app settings.
    const request = https.request(diagnosticTarget(row.path), {
      method: "GET", agent: false, family, signal
    }, (response) => {
      row.status = response.statusCode;
      row.times.responseHeaders = ms(row.started);
      row.bytes = 0;
      response.on("data", (chunk) => { row.bytes += chunk.byteLength; });
      response.once("end", () => { row.times.bodyDone = ms(row.started); row.outcome = "response"; resolve(); });
      response.once("error", (error) => { Object.assign(row, errorFacts(error), { outcome: "network-error" }); resolve(); });
    });
    request.on("socket", (socket) => {
      socket.on("lookup", (error, address, addressFamily) => {
        row.times.dns = ms(row.started);
        if (error) row.times.dnsError = row.times.dns;
        row.lookup = { address: address || null, family: addressFamily || null, ...(error ? errorFacts(error) : {}) };
      });
      for (const event of ["connectionAttempt", "connectionAttemptFailed", "connectionAttemptTimeout"]) {
        socket.on(event, (address, port, addressFamily, error) => {
          row.attempts ||= [];
          if (row.attempts.length < 12) row.attempts.push({ event, address, family: addressFamily, ms: ms(row.started), ...(error ? errorFacts(error) : {}) });
          row.times.connectAttempt ??= ms(row.started);
        });
      }
      socket.once("connect", () => { row.times.tcp = ms(row.started); row.socket = socketFacts(socket); });
      socket.once("secureConnect", () => {
        row.times.tls = ms(row.started);
        row.socket = socketFacts(socket);
      });
    });
    request.once("finish", () => { row.times.requestSent = ms(row.started); });
    request.once("error", (error) => { Object.assign(row, errorFacts(error), { outcome: "network-error" }); resolve(); });
    request.end();
  });
}

export async function diagnoseSiteHttp({ baseline = false } = {}) {
  const started = performance.now();
  const results = [];
  const stages = [];
  const mode = baseline ? "baseline" : "matched-provider-concurrency";
  let activeStage = null;
  const trace = observeFetch(print, started);
  const deadline = AbortSignal.timeout(TOTAL_MS - 500);
  // Bound even an unresolved system DNS lookup or an idle pooled socket. This
  // script only observes; a network failure does not overwrite the release gate.
  const hardStop = setTimeout(() => {
    print({ kind: "summary", mode, outcome: "diagnostic-deadline", activeStage,
      stages, completed: results.length, ms: ms(started), incomplete: true, releaseVerdictChanged: false });
    process.exit(0);
  }, TOTAL_MS);
  hardStop.unref();
  print({ kind: "environment", mode, node: process.version, undici: process.versions.undici || null,
    dnsOrder: dns.getDefaultResultOrder(), autoSelectFamily: net.getDefaultAutoSelectFamily(),
    familyAttemptTimeoutMs: net.getDefaultAutoSelectFamilyAttemptTimeout(), requestMs: REQUEST_MS, totalMs: TOTAL_MS });
  let provider;
  try {
    ({ probeGet: provider } = await import("../../src/messaging/providers/pulse-probe.mjs"));
    await dnsInventory();
    let id = 0;
    const trial = async (mode, concurrency, path, family = 0, stage = null) => {
      if (deadline.aborted) return;
      const row = { kind: "request", id: ++id, stage, mode, concurrency, path,
        variant: path === "/api/health" ? "strict-health" : "public-door", family, started: performance.now(), times: {}, status: 0 };
      const signal = AbortSignal.any([deadline, AbortSignal.timeout(REQUEST_MS)]);
      if (mode === "https-fresh") await httpsTrial(row, signal, family);
      else await fetchTrial(row, trace, signal, mode === "pulse-provider" ? provider : null);
      row.ms = ms(row.started);
      row.phase = lastPhase(row.times);
      delete row.started;
      results.push(row);
      print(row);
    };
    if (baseline) {
      await trial("native-fetch", 1, PATHS[0]);
      await trial("native-fetch", 1, PATHS[1]);
      for (const concurrency of [3, 12]) {
        await Promise.all(PATHS.slice(0, concurrency).map((path) => trial("native-fetch", concurrency, path)));
      }
      await Promise.all(PATHS.map((path) => trial("pulse-provider", 12, path)));
      await Promise.all([0, 4, 6].flatMap((family) => PATHS.slice(0, 2).map((path) => trial("https-fresh", 6, path, family))));
    } else {
      // Same process, same twelve paths, exact same provider/UA/8s budget.
      // Alternating high/low twice separates a fan-out effect from one warm run.
      for (const [index, concurrency] of MATCHED_CONCURRENCIES.entries()) {
        if (deadline.aborted) break;
        const stage = `matched-${index + 1}-c${concurrency}`;
        activeStage = stage;
        const stageStarted = performance.now();
        print({ kind: "stage", event: "start", stage, concurrency, requested: PATHS.length });
        const counts = await runFixedPathStage(concurrency,
          (path) => trial("pulse-provider", concurrency, path, 0, stage), () => deadline.aborted);
        const rows = results.filter((row) => row.stage === stage);
        const result = { kind: "stage", event: "complete", stage, concurrency, wallMs: ms(stageStarted), ...counts,
          responses: rows.filter((row) => row.outcome === "response").length,
          failures: rows.filter((row) => row.outcome !== "response").map((row) => ({ id: row.id, path: row.path, phase: row.phase })),
          deadlineReached: deadline.aborted };
        stages.push(result);
        print(result);
        activeStage = null;
      }
    }
    const groups = [...new Set(results.map((row) => `${row.mode}/${row.concurrency}/${row.family}`))].map((group) => {
      const rows = results.filter((row) => `${row.mode}/${row.concurrency}/${row.family}` === group);
      return { group, count: rows.length, responses: rows.filter((row) => row.outcome === "response").length,
        failures: rows.filter((row) => row.outcome !== "response").map((row) => ({ id: row.id, path: row.path, phase: row.phase, codes: row.codes || row.transportError?.codes || [] })) };
    });
    print({ kind: "summary", mode, ms: ms(started), completed: results.length, deadlineReached: deadline.aborted,
      expected: baseline ? 35 : PATHS.length * MATCHED_CONCURRENCIES.length,
      incomplete: baseline ? results.length !== 35 || deadline.aborted : stages.length !== MATCHED_CONCURRENCIES.length || stages.some((stage) => !stage.complete),
      stages, groups, releaseVerdictChanged: false,
      limit: "Client timing locates the stalled phase. It cannot distinguish edge versus function after a request was sent without matching server evidence." });
  } finally {
    trace.close();
    // The unreferenced guard still bounds an unresolved OS DNS lookup, while
    // allowing a normal completed run to leave immediately.
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  diagnoseSiteHttp({ baseline: process.argv.includes("--baseline") }).catch((error) => { print({ kind: "diagnostic-error", ...errorFacts(error) }); process.exitCode = 1; });
}
