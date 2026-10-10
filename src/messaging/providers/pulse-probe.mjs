// pulse-probe — the hourly pulse's GET and HEAD of the web. Nothing else.
//
// CLAUDE.md §12: outbound transmission lives in src/messaging/providers/* and
// nowhere else. This provider is how a pulse beat reads a web page, a vendor
// status door or a bank Apply link (ctx.http in src/pulse/beats/ctx.mjs).
// Pulse v1, delta 4 (ops/workflows/pulse-layer-2026-10-09-v1.md).
//
// WHAT IT CAN DO: GET and HEAD. The method is not a parameter, so a caller
// cannot ask for another one. There is no body, no POST, no PUT, no DELETE.
//
// WHAT IT REFUSES, before anything leaves, on the first request AND on every
// redirect hop:
//   - an address that is not https (except the SITE host in tests, see below)
//   - a literal IP address (v4 or v6), "localhost", and names that only mean
//     something inside a network: .localhost .local .internal .localdomain .lan
//     .intranet .corp .home.arpa, and any one-word host name
//   - a user:password@ in the address, and any port other than the default
// It reads at most 64 KB of the answer (the rest is cancelled, not pulled),
// follows at most 5 redirects BY HAND, takes at most 8 seconds in all, sends the
// honest user agent below, and NEVER THROWS.
//
// THE FENCE. Every request goes through transmit() behind the ADAPTERS fence
// (src/lib/outbound-fetch.mjs). With ADAPTERS_DRY_RUN not set to an off value,
// the answer is class "blocked" and nothing leaves. Production has it off.
//
// NOT DONE HERE: a host name that resolves to a private address (DNS rebinding)
// is not caught. The pulse only reads addresses the owner put in the database or
// in a beat file, and it sends nothing that could be harmed by a read.
//
// The result's `error` never holds the page body, and the address's query
// string (bank campaign codes) is never put in a log line: `what` is the host.

import { transmit, ADAPTERS } from "../../lib/outbound-fetch.mjs";

export const PROVIDER = "pulse-probe";
export const TRANSMITS = true;

export const USER_AGENT = "FundhubPulse/1.0 (+https://fundhub.ai)";
export const MAX_BODY_BYTES = 64 * 1024;
export const SNIPPET_CHARS = 2048;
export const MAX_REDIRECTS = 5;
export const DEFAULT_TIMEOUT_MS = 8000;
export const MAX_URL_CHARS = 2048;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const NO_BODY_STATUSES = new Set([101, 204, 205, 304]);
const PRIVATE_SUFFIXES = [".localhost", ".local", ".internal", ".localdomain", ".lan", ".intranet", ".corp", ".home.arpa"];
const SECRET_HEADERS = new Set(["authorization", "cookie", "proxy-authorization", "x-api-key"]);
const DROPPED_HEADERS = new Set(["host", "content-length", "user-agent", "connection", "transfer-encoding"]);

/**
 * May this address be requested? Pure. Returns { ok: true, url } or { ok: false, reason }.
 * `siteHost` + `allowHttpSite` let a TEST call the site over http; production never sets them.
 */
export function checkProbeTarget(address, { siteHost = null, allowHttpSite = false } = {}) {
  if (typeof address !== "string" || !address.trim()) return { ok: false, reason: "no address" };
  if (address.length > MAX_URL_CHARS) return { ok: false, reason: "address is too long" };
  let url;
  try { url = new URL(address); } catch { return { ok: false, reason: "not a web address" }; }
  // A trailing dot is the same host (localhost. is localhost); strip it before any check.
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  const isSite = Boolean(siteHost) && host === String(siteHost).toLowerCase();

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isSite && allowHttpSite)) {
    return { ok: false, reason: `only https is allowed (got ${url.protocol.replace(":", "")})` };
  }
  if (url.username || url.password) return { ok: false, reason: "a user name or password in the address" };
  if (url.port && !(isSite && allowHttpSite)) return { ok: false, reason: "a port other than the default" };
  if (host.startsWith("[") || /^\d+(?:\.\d+){3}$/.test(host)) return { ok: false, reason: "a literal IP address" };
  if (host === "localhost" || PRIVATE_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: "a private host name" };
  if (!host.includes(".")) return { ok: false, reason: "a one-word host name" };
  return { ok: true, url };
}

const cleanHeaders = (headers, { crossHost = false } = {}) => {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const name = String(k).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(name) || DROPPED_HEADERS.has(name)) continue;
    if (crossHost && SECRET_HEADERS.has(name)) continue;
    if (typeof v === "string" || typeof v === "number") out[name] = String(v);
  }
  return out;
};

/* limitedFetch — wraps the real fetch so a page is read only up to the cap.
   transmit() reads a whole body; a page that answers 200 MB must not fill the
   heap. This reads chunk by chunk and cancels the stream at the cap. */
function limitedFetch(base) {
  return async (input, init) => {
    const res = await base(input, init);
    const method = String(init?.method || "GET").toUpperCase();
    let bytes = new Uint8Array(0);
    let truncated = false;

    if (method !== "HEAD" && !NO_BODY_STATUSES.has(res.status)) {
      if (res.body && typeof res.body.getReader === "function") {
        const reader = res.body.getReader();
        const chunks = [];
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
          const room = MAX_BODY_BYTES - total;
          if (chunk.byteLength > room) {
            chunks.push(chunk.subarray(0, room));
            total += room;
            truncated = true;
            try { await reader.cancel(); } catch { /* already gone */ }
            break;
          }
          chunks.push(chunk);
          total += chunk.byteLength;
        }
        bytes = new Uint8Array(total);
        let at = 0;
        for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
      } else if (typeof res.arrayBuffer === "function") {
        const all = new Uint8Array(await res.arrayBuffer());
        truncated = all.byteLength > MAX_BODY_BYTES;
        bytes = truncated ? all.subarray(0, MAX_BODY_BYTES) : all;
      }
    }

    const headers = new Headers(res.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.set("x-pulse-truncated", truncated ? "1" : "0");
    headers.set("x-pulse-bytes", String(bytes.byteLength));
    return new Response(NO_BODY_STATUSES.has(res.status) || method === "HEAD" ? null : bytes, {
      status: res.status, statusText: res.statusText, headers
    });
  };
}

const outHeaders = (all) => {
  const out = {};
  for (const [k, v] of Object.entries(all || {})) {
    if (k === "set-cookie" || k.startsWith("x-pulse-")) continue;
    out[k] = String(v).slice(0, 300);
  }
  return out;
};

const emptyResult = (over) => ({
  ok: false, status: 0, ms: 0, finalHost: null, bodySnippet: "", body: "", truncated: false, bytes: 0,
  headers: {}, redirects: 0, error: null, class: "network", ...over
});

async function probe(method, address, opts = {}) {
  const started = Date.now();
  const timeoutMs = Math.max(500, Math.min(Number(opts.timeoutMs) || DEFAULT_TIMEOUT_MS, 15_000));
  const env = opts.env || process.env;
  const base = opts.fetchImpl || globalThis.fetch;
  const targetOpts = { siteHost: opts.siteHost || null, allowHttpSite: opts.allowHttpSite === true };
  const done = (over) => emptyResult({ ms: Date.now() - started, ...over });

  try {
    if (typeof base !== "function") return done({ error: "no fetch implementation available", class: "network" });
    const doFetch = limitedFetch(base);
    let current = address;
    let headers = cleanHeaders(opts.headers);
    let hops = 0;

    for (;;) {
      const target = checkProbeTarget(current, targetOpts);
      if (!target.ok) {
        return done({ finalHost: safeHost(current), redirects: hops, error: `refused: ${target.reason}`, class: "refused" });
      }
      const left = timeoutMs - (Date.now() - started);
      if (left <= 0) return done({ finalHost: target.url.hostname, redirects: hops, error: `timed out after ${timeoutMs}ms`, class: "timeout" });

      const r = await transmit(target.url.href, {
        method,
        headers: { accept: "text/html,application/json;q=0.9,*/*;q=0.8", ...headers, "user-agent": USER_AGENT },
        redirect: "manual"
      }, {
        fence: ADAPTERS,
        what: `pulse-probe ${method} ${target.url.hostname}`,
        env,
        fetchImpl: doFetch,
        timeoutMs: left,
        signal: opts.signal,
        asText: true
      });

      const finalHost = target.url.hostname;
      if (r.blocked) return done({ finalHost, redirects: hops, error: "the dry-run fence is holding web calls (ADAPTERS_DRY_RUN)", class: "blocked" });
      if (!r.transmitted || r.status === 0) {
        const timedOut = /timed out/i.test(String(r.error));
        return done({ finalHost, redirects: hops, error: String(r.error || "no answer").slice(0, 200), class: timedOut ? "timeout" : "network" });
      }

      const location = r.headers.location;
      if (REDIRECT_STATUSES.has(r.status) && location) {
        hops++;
        if (hops > MAX_REDIRECTS) {
          return done({ status: r.status, finalHost, redirects: hops, error: `more than ${MAX_REDIRECTS} redirects`, class: "too_many_redirects" });
        }
        let next;
        try { next = new URL(location, target.url).href; } catch {
          return done({ status: r.status, finalHost, redirects: hops, error: "a redirect to an address that is not valid", class: "redirect" });
        }
        const crossHost = safeHost(next) !== finalHost;
        if (crossHost) headers = cleanHeaders(headers, { crossHost: true });
        current = next;
        continue;
      }

      const text = method === "HEAD" || typeof r.body !== "string" ? "" : r.body;
      const status = r.status;
      const ok = status >= 200 && status < 300;
      return done({
        ok, status, finalHost, redirects: hops,
        body: text, bodySnippet: text.slice(0, SNIPPET_CHARS),
        truncated: r.headers["x-pulse-truncated"] === "1",
        bytes: Number(r.headers["x-pulse-bytes"]) || Buffer.byteLength(text),
        headers: outHeaders(r.headers),
        error: ok ? null : `HTTP ${status}`,
        class: ok ? "ok" : status >= 500 ? "http_5xx" : status >= 400 ? "http_4xx" : "redirect"
      });
    }
  } catch (err) {
    return done({ error: String((err && err.message) || err).slice(0, 200), class: "network" });
  }
}

function safeHost(address) {
  try { return new URL(address).hostname.toLowerCase(); } catch { return null; }
}

/** GET an address. Never throws. See the header for what it refuses. */
export function probeGet(address, opts) { return probe("GET", address, opts); }

/** HEAD an address. Never throws. */
export function probeHead(address, opts) { return probe("HEAD", address, opts); }

/** { get, head } with defaults (env, fetchImpl, timeoutMs) filled in. What the runner hands to makeBeatCtx. */
export function makeProbe(defaults = {}) {
  return {
    get: (address, opts) => probeGet(address, { ...defaults, ...(opts || {}) }),
    head: (address, opts) => probeHead(address, { ...defaults, ...(opts || {}) })
  };
}
