// pulse-probe: GET and HEAD only, with the refusals the pulse needs. No network: every case injects fetchImpl.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import * as probeModule from "./pulse-probe.mjs";
import {
  probeGet, probeHead, makeProbe, checkProbeTarget, USER_AGENT, MAX_BODY_BYTES, SNIPPET_CHARS, MAX_REDIRECTS
} from "./pulse-probe.mjs";
import { createFakeFetch } from "../../pulse/fake-sinks.mjs";

/* ADAPTERS_DRY_RUN=0 says out loud that the fence is down, same as the provider tests do. */
const LIVE = { ADAPTERS_DRY_RUN: "0" };
const page = (over = {}) => ({ status: 200, headers: { "content-type": "text/html" }, body: "<html>hello</html>", ...over });

test("GET: answers the shape the beats read, with the honest user agent and redirect handled by hand", async () => {
  const f = createFakeFetch({ "GET https://fundhub.ai/roadmap": page() });
  const r = await probeGet("https://fundhub.ai/roadmap", { env: LIVE, fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.equal(r.class, "ok");
  assert.equal(r.finalHost, "fundhub.ai");
  assert.equal(r.bodySnippet, "<html>hello</html>");
  assert.equal(r.body, "<html>hello</html>");
  assert.equal(r.error, null);
  assert.equal(r.redirects, 0);
  assert.equal(r.headers["content-type"], "text/html");
  assert.ok(typeof r.ms === "number" && r.ms >= 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, "GET");
  assert.equal(f.calls[0].redirect, "manual");
  assert.equal(f.calls[0].headers["user-agent"], USER_AGENT);
  assert.equal(USER_AGENT, "FundhubPulse/1.0 (+https://fundhub.ai)");
});

test("HEAD: sends HEAD and returns no body", async () => {
  const f = createFakeFetch({ "HEAD https://fundhub.ai/x": page({ body: "ignored" }) });
  const r = await probeHead("https://fundhub.ai/x", { env: LIVE, fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(f.calls[0].method, "HEAD");
  assert.equal(r.body, "");
  assert.equal(r.bodySnippet, "");
});

test("only GET and HEAD exist: another method cannot be asked for, and there is no send()", async () => {
  const f = createFakeFetch({ "GET https://fundhub.ai/x": page() });
  await probeGet("https://fundhub.ai/x", { env: LIVE, fetchImpl: f, method: "POST", body: "x=1" });
  assert.equal(f.calls[0].method, "GET");
  assert.deepEqual(Object.keys(probeModule).filter((k) => /^(send|post|put|patch|delete)/i.test(k)), []);
  const src = fs.readFileSync(new URL("./pulse-probe.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /method:\s*["'`](POST|PUT|PATCH|DELETE)/i);
});

test("the dry-run fence still holds: with ADAPTERS_DRY_RUN unset nothing leaves, and the query string is not logged", async () => {
  const f = createFakeFetch({});
  const logged = [];
  const warn = console.warn;
  console.warn = (...a) => logged.push(a.join(" "));
  try {
    const r = await probeGet("https://bank.example.com/apply?ecid=SECRETCODE", { env: {}, fetchImpl: f });
    assert.equal(r.ok, false);
    assert.equal(r.class, "blocked");
    assert.match(r.error, /ADAPTERS_DRY_RUN/);
    assert.equal(f.calls.length, 0);
  } finally { console.warn = warn; }
  assert.ok(logged.length >= 1, "the fence logs a hold");
  assert.ok(logged.every((l) => !l.includes("SECRETCODE")), "no campaign code in the log");
});

test("refuses, before any request: http, IP addresses, localhost, private names, user:pass, ports, junk", async () => {
  const bad = [
    "http://example.com/", "ftp://example.com/", "https://127.0.0.1/", "https://127.0.0.1./", "https://10.1.2.3/x", "https://169.254.169.254/latest/meta-data",
    "https://[::1]/", "https://[fe80::1]/", "https://2130706433/", "https://0x7f.0.0.1/", "https://localhost/", "https://localhost./x",
    "https://app.localhost/", "https://db.internal/", "https://printer.local/", "https://metadata/", "https://nas.lan/",
    "https://user:pw@example.com/", "https://example.com:8443/", "not a url", "", "   ", "https://" + "a".repeat(2100) + ".com/"
  ];
  for (const url of bad) {
    const f = createFakeFetch({});
    const r = await probeGet(url, { env: LIVE, fetchImpl: f });
    assert.equal(r.ok, false, url);
    assert.equal(r.class, "refused", `${url} -> ${r.class}`);
    assert.match(r.error, /^refused: /);
    assert.equal(f.calls.length, 0, `${url} must not reach fetch`);
  }
  for (const nonString of [null, undefined, 42, {}]) {
    assert.equal((await probeGet(nonString, { env: LIVE, fetchImpl: createFakeFetch({}) })).class, "refused");
  }
});

test("the SITE host may use http only when a test says so, and only that host", async () => {
  const f = createFakeFetch({ "GET http://site.test/x": page(), "GET http://other.test/x": page() });
  assert.equal((await probeGet("http://site.test/x", { env: LIVE, fetchImpl: f, siteHost: "site.test" })).class, "refused");
  assert.equal((await probeGet("http://site.test/x", { env: LIVE, fetchImpl: f, allowHttpSite: true })).class, "refused", "needs siteHost too");
  assert.equal((await probeGet("http://site.test/x", { env: LIVE, fetchImpl: f, siteHost: "site.test", allowHttpSite: true })).ok, true);
  assert.equal((await probeGet("http://other.test/x", { env: LIVE, fetchImpl: f, siteHost: "site.test", allowHttpSite: true })).class, "refused");
  assert.equal(checkProbeTarget("http://localhost/x", { siteHost: "localhost", allowHttpSite: true }).ok, false, "localhost is never allowed");
});

test("redirects are followed by hand, and every hop gets the same refusals", async () => {
  const f = createFakeFetch((method, url) => ({
    "https://a.example.com/": { status: 302, headers: { location: "https://b.example.com/landing" } },
    "https://b.example.com/landing": { status: 301, headers: { location: "/final?x=1" } },
    "https://b.example.com/final?x=1": page({ body: "arrived" })
  }[url]));
  const r = await probeGet("https://a.example.com/", { env: LIVE, fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.body, "arrived");
  assert.equal(r.finalHost, "b.example.com");
  assert.equal(r.redirects, 2);
  assert.deepEqual(f.calls.map((c) => c.url), ["https://a.example.com/", "https://b.example.com/landing", "https://b.example.com/final?x=1"]);
  assert.ok(f.calls.every((c) => c.redirect === "manual"));

  for (const evil of ["http://b.example.com/", "https://127.0.0.1/admin", "https://169.254.169.254/", "https://metadata/", "https://[::1]/", "https://u:p@b.example.com/", "javascript:alert(1)"]) {
    const g = createFakeFetch((m, url) => (url === "https://a.example.com/" ? { status: 302, headers: { location: evil } } : null));
    const out = await probeGet("https://a.example.com/", { env: LIVE, fetchImpl: g });
    assert.equal(out.ok, false, evil);
    assert.equal(out.class, "refused", `${evil} -> ${out.class}`);
    assert.equal(g.calls.length, 1, `${evil} must not be requested`);
  }
});

test("at most 5 redirects are followed: the sixth redirect stops with its own class", async () => {
  let n = 0;
  const f = createFakeFetch(() => ({ status: 302, headers: { location: `https://hop${++n}.example.com/` } }));
  const r = await probeGet("https://start.example.com/", { env: LIVE, fetchImpl: f });
  assert.equal(r.class, "too_many_redirects");
  assert.equal(r.ok, false);
  assert.equal(MAX_REDIRECTS, 5);
  assert.equal(f.calls.length, 6, "the first request plus 5 followed");
  assert.equal(r.redirects, 6);
});

test("a redirect to another host drops the secret headers; the same host keeps them", async () => {
  const f = createFakeFetch((m, url) => ({
    "https://a.example.com/": { status: 302, headers: { location: "https://a.example.com/next" } },
    "https://a.example.com/next": { status: 302, headers: { location: "https://b.example.com/" } },
    "https://b.example.com/": page()
  }[url]));
  const r = await probeGet("https://a.example.com/", { env: LIVE, fetchImpl: f, headers: { Authorization: "Basic abc", "X-Thing": "1", "User-Agent": "evil/9", Host: "evil" } });
  assert.equal(r.ok, true);
  assert.equal(f.calls[0].headers.authorization, "Basic abc");
  assert.equal(f.calls[1].headers.authorization, "Basic abc", "same host keeps it");
  assert.equal(f.calls[2].headers.authorization, undefined, "other host loses it");
  assert.equal(f.calls[2].headers["x-thing"], "1");
  assert.ok(f.calls.every((c) => c.headers["user-agent"] === USER_AGENT && c.headers.host === undefined));
});

test("reads at most 64 KB and cancels the rest instead of pulling it", async () => {
  const f = createFakeFetch({ "GET https://big.example.com/": { status: 200, bytes: 5_000_000 } });
  const r = await probeGet("https://big.example.com/", { env: LIVE, fetchImpl: f });
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.bytes, MAX_BODY_BYTES);
  assert.equal(r.body.length, MAX_BODY_BYTES);
  assert.equal(r.bodySnippet.length, SNIPPET_CHARS);
  assert.ok(f.calls[0].pulled < MAX_BODY_BYTES + 4 * 8192 + 1, `pulled ${f.calls[0].pulled} bytes of 5,000,000`);

  const small = await probeGet("https://big.example.com/", { env: LIVE, fetchImpl: createFakeFetch({ "https://big.example.com/": page({ body: "x".repeat(3000) }) }) });
  assert.equal(small.truncated, false);
  assert.equal(small.body.length, 3000);
  assert.equal(small.bodySnippet.length, 2048);
});

test("a slow or hung answer times out and says so; it never throws", async () => {
  const t0 = Date.now();
  const r = await probeGet("https://slow.example.com/", { env: LIVE, timeoutMs: 500, fetchImpl: createFakeFetch({ "https://slow.example.com/": { hang: true } }) });
  assert.equal(r.ok, false);
  assert.equal(r.class, "timeout");
  assert.ok(Date.now() - t0 < 2000);
  assert.ok(r.ms >= 400);

  const net = await probeGet("https://down.example.com/", { env: LIVE, fetchImpl: createFakeFetch({ "https://down.example.com/": { throws: "getaddrinfo ENOTFOUND" } }) });
  assert.equal(net.class, "network");
  assert.match(net.error, /ENOTFOUND/);

  const broken = await probeGet("https://x.example.com/", { env: LIVE, fetchImpl: async () => { throw new Error("boom"); } });
  assert.equal(broken.class, "network");
  const noFetch = await probeGet("https://x.example.com/", { env: LIVE, fetchImpl: 42 });
  assert.equal(noFetch.ok, false);
});

test("status classes: 4xx, 5xx, a redirect with nowhere to go; the error holds the status, never the body", async () => {
  const run = (status, headers, body = "SECRET-BODY-TEXT") =>
    probeGet("https://s.example.com/", { env: LIVE, fetchImpl: createFakeFetch({ "https://s.example.com/": { status, headers, body } }) });
  const r404 = await run(404);
  assert.deepEqual([r404.ok, r404.class, r404.error, r404.status], [false, "http_4xx", "HTTP 404", 404]);
  assert.equal(r404.body, "SECRET-BODY-TEXT", "the body is there for the beat to classify");
  const r503 = await run(503);
  assert.deepEqual([r503.class, r503.error], ["http_5xx", "HTTP 503"]);
  const r302 = await run(302, {});
  assert.equal(r302.class, "redirect");
  assert.equal(r302.ok, false);
  const r204 = await run(204);
  assert.equal(r204.ok, true);
  for (const r of [r404, r503, r302]) assert.ok(!String(r.error).includes("SECRET"));
  const ck = await run(200, { "set-cookie": "sid=abc; HttpOnly" });
  assert.equal(ck.headers["set-cookie"], undefined, "cookies are not passed up");
});

test("makeProbe binds the defaults", async () => {
  const f = createFakeFetch({ "GET https://fundhub.ai/": page(), "HEAD https://fundhub.ai/": page() });
  const p = makeProbe({ env: LIVE, fetchImpl: f });
  assert.equal((await p.get("https://fundhub.ai/")).ok, true);
  assert.equal((await p.head("https://fundhub.ai/")).ok, true);
  assert.deepEqual(f.calls.map((c) => c.method), ["GET", "HEAD"]);
});
