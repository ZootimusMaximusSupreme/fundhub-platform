import test from "node:test";
import assert from "node:assert/strict";
import { Readable, PassThrough } from "node:stream";
import { Inngest } from "inngest";
import { serve as serveEdge } from "inngest/edge";
import { serve as serveNode } from "inngest/node";
import { createInngestBoundary, INNGEST_MAX_BYTES, INNGEST_MAX_EVENTS, INNGEST_MAX_STEPS } from "../../api/inngest.mjs";

const REQUEST_URL = "https://fundhub.ai/api/inngest?probe=trust";
const KEY = "signkey-test-" + "a".repeat(64); // Synthetic local signing fixture only.
const PROD = { CONTEXT: "production", INNGEST_SIGNING_KEY: KEY };
const bytes = value => Buffer.from(typeof value === "string" ? value : JSON.stringify(value));
const request = (body, headers = {}, method = "POST") => new Request(REQUEST_URL, { method, headers: { host: "fundhub.ai", ...headers },
  ...(["POST", "PUT"].includes(method) ? { body, duplex: "half" } : {}) });
const envelope = () => ({ event: { name: "test/local", data: {} }, events: [], steps: {}, ctx: null });
function capture() {
  const seen = [];
  const boundary = createInngestBoundary({ env: PROD,
    web: async req => { seen.push({ body: Buffer.from(await req.arrayBuffer()), headers: req.headers, url: req.url }); return new Response(null, { status: 204 }); },
    node: async req => { const chunks = []; for await (const chunk of req) chunks.push(chunk);
      seen.push({ body: Buffer.concat(chunks), headers: req.headers, url: req.url }); }
  });
  return { ...boundary, seen };
}
function nodeRequest(body, headers = {}, method = "POST") {
  const req = Readable.from(Array.isArray(body) ? body : [body], { objectMode: false });
  Object.assign(req, { method, headers, url: "/api/inngest?probe=trust", socket: { encrypted: true } });
  return req;
}
function nodeResponse() {
  return { code: 0, headers: {}, body: "", writeHead(code, headers) { this.code = code; this.headers = headers; },
    end(body, callback) { this.body = body; if (callback) callback(); } };
}

test("byte cap accepts exactly 4 MiB and rejects larger actual streams despite absent or false Content-Length", async () => {
  const base = '{"event":{"data":{"text":""}}}';
  const exact = bytes('{"event":{"data":{"text":"' + "x".repeat(INNGEST_MAX_BYTES - Buffer.byteLength(base)) + '"}}}');
  assert.equal(exact.length, INNGEST_MAX_BYTES);
  const ok = capture(); assert.equal((await ok.web(request(exact))).status, 204);
  assert.deepEqual(ok.seen[0].body, exact);
  for (const headers of [{}, { "content-length": "1" }]) {
    const f = capture();
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(exact); controller.enqueue(Uint8Array.of(32)); controller.close();
    } });
    assert.equal((await f.web(request(stream, headers))).status, 413);
    assert.equal(f.seen.length, 0);
  }
  const f = capture();
  assert.equal((await f.web(request("{}", { "content-length": String(INNGEST_MAX_BYTES + 1) }))).status, 413);
  const unicode = JSON.stringify({ event: { data: "é".repeat(INNGEST_MAX_BYTES / 2) } });
  assert.ok(unicode.length < INNGEST_MAX_BYTES);
  assert.equal((await f.web(request(unicode))).status, 413, "count bytes, not JavaScript characters");
});

test("array and step boundaries reject issue-amplifying collections without truncating legitimate nested step data", async () => {
  const valid = envelope();
  valid.events = Array.from({ length: INNGEST_MAX_EVENTS }, () => ({ name: "test/local", data: {} }));
  valid.steps = Object.fromEntries(Array.from({ length: INNGEST_MAX_STEPS }, (_, n) => [String(n), { data: n }]));
  valid.steps[0] = { data: { rows: Array(6000).fill(1) } };
  valid.ctx = { stack: { stack: Array(INNGEST_MAX_STEPS).fill("step"), current: 0 } };
  const f = capture(); assert.equal((await f.web(request(bytes(valid)))).status, 204);
  assert.deepEqual(JSON.parse(f.seen[0].body), valid);
  for (const invalid of [
    { ...envelope(), events: Array(INNGEST_MAX_EVENTS + 1).fill({}) },
    { ...envelope(), events: Array(INNGEST_MAX_EVENTS).fill(null) },
    { ...envelope(), ctx: { stack: { stack: Array(INNGEST_MAX_STEPS + 1).fill("step") } } },
    { ...envelope(), ctx: { stack: { stack: Array(INNGEST_MAX_STEPS).fill({}) } } },
    { ...envelope(), steps: Object.fromEntries(Array.from({ length: INNGEST_MAX_STEPS + 1 }, (_, n) => [n, {}])) }
  ]) {
    const refused = capture(); assert.equal((await refused.web(request(bytes(invalid)))).status, 400);
    assert.equal(refused.seen.length, 0);
  }
});

test("raw bytes, signature header, base64 strings, optional and nullable protocol fields survive unchanged", async () => {
  for (const raw of [' { "event": {"data":{"base64":"AP+A//8="}}, "steps":null,"ctx":null }\n',
    '{"event":{},"events":[],"ctx":{"stack":{"stack":null,"current":0}}}']) {
    const f = capture(); assert.equal((await f.web(request(raw, { "x-inngest-signature": "unaltered" }))).status, 204);
    assert.equal(f.seen[0].body.toString(), raw);
    assert.equal(f.seen[0].headers.get("x-inngest-signature"), "unaltered");
    assert.equal(f.seen[0].url, REQUEST_URL);
  }
});

test("GET/HEAD introspection, empty out-of-band PUT and in-band PUT retain SDK routing semantics", async () => {
  for (const method of ["GET", "HEAD"]) {
    let observed;
    const boundary = createInngestBoundary({ env: PROD, web: req => { observed = req; return new Response(null, { status: 204 }); } });
    const req = request(undefined, {}, method);
    assert.equal((await boundary.web(req)).status, 204); assert.equal(observed, req);
  }
  for (const body of ["", '{"url":"https://fundhub.ai/api/inngest"}']) {
    const f = capture(); assert.equal((await f.web(request(body, {}, "PUT"))).status, 204);
    assert.equal(f.seen[0].body.toString(), body);
  }
});

test("production fails closed on missing signing key or explicit dev mode before calling the SDK", async () => {
  for (const env of [{ CONTEXT: "production" }, { ...PROD, INNGEST_DEV: "1" }, { ...PROD, INNGEST_DEV: "http://localhost:8288" }]) {
    let called = false;
    const boundary = createInngestBoundary({ env, web: () => { called = true; } });
    assert.equal((await boundary.web(request(undefined, {}, "GET"))).status, 503); assert.equal(called, false);
  }
});

test("Node stream export applies the same byte/envelope limits and preserves raw SDK input", async () => {
  const raw = bytes(' {"event":{"data":{"base64":"AAH/"}},"events":[]}\n');
  const f = capture(); const headers = { "x-inngest-signature": "keep" };
  await f.node(nodeRequest([raw.subarray(0, 8), raw.subarray(8)], headers), nodeResponse());
  assert.deepEqual(f.seen[0].body, raw); assert.equal(f.seen[0].headers, headers);
  for (const body of [Buffer.alloc(INNGEST_MAX_BYTES + 1, 32), bytes({ events: Array(INNGEST_MAX_EVENTS + 1).fill(null) })]) {
    const refused = capture(), res = nodeResponse(); await refused.node(nodeRequest(body), res);
    assert.ok([400, 413].includes(res.code)); assert.equal(refused.seen.length, 0);
  }
});

test("an aborted Node request cannot leave an unhandled follow-up stream error", async () => {
  const f = capture(), req = new PassThrough(), res = nodeResponse();
  Object.assign(req, { method: "POST", headers: {}, url: "/api/inngest" });
  const handled = f.node(req, res);
  req.emit("aborted");
  assert.doesNotThrow(() => req.emit("error", Object.assign(new Error("client disconnected"), { code: "ECONNRESET" })));
  await handled;
  assert.equal(res.code, 400); assert.equal(f.seen.length, 0);
});

test("an already-consumed or disconnected Node request fails closed instead of waiting for past stream events", async () => {
  const consumed = nodeRequest(bytes(envelope()));
  for await (const chunk of consumed) assert.ok(chunk.length);
  assert.equal(consumed.readableEnded, true);
  const disconnected = nodeRequest(bytes(envelope()));
  disconnected.destroy();
  for (const req of [consumed, disconnected]) {
    const f = capture(), res = nodeResponse();
    await f.node(req, res);
    assert.equal(res.code, 400); assert.equal(f.seen.length, 0);
  }
});

test("real SDK still verifies signature, timestamp and fallback key through both guarded exports", async () => {
  const { signDataWithKey } = await import(new URL("./helpers/net.js", import.meta.resolve("inngest")));
  const client = new Inngest({ id: "boundary-local-test", isDev: false });
  const fallback = "signkey-test-" + "b".repeat(64);
  const options = { client, functions: [], signingKey: KEY, signingKeyFallback: fallback, logLevel: "silent" };
  const guarded = createInngestBoundary({ env: PROD, web: serveEdge(options), node: serveNode(options) });
  const body = bytes(envelope());
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signed = async (key, time = timestamp) => `t=${time}&s=${await signDataWithKey(JSON.parse(body), key, time)}`;
  for (const signature of [await signed(KEY), await signed(fallback)]) {
    assert.equal((await guarded.web(request(body, { "x-inngest-signature": signature }))).status, 200);
    const res = nodeResponse(); await guarded.node(nodeRequest(body, { host: "fundhub.ai", "x-inngest-signature": signature }), res);
    assert.equal(res.code, 200);
  }
  for (const signature of ["t=1&s=invalid", await signed(KEY, "1")]) {
    assert.equal((await guarded.web(request(body, { "x-inngest-signature": signature }))).status, 401);
  }
  assert.equal((await guarded.web(request(body))).status, 401);
});
