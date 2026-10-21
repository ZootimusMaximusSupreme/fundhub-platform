import { test } from "node:test";
import assert from "node:assert/strict";
import { searchWeb, serperKey, ENDPOINT } from "./serper-search.mjs";

const OPEN = { SERPER_API_KEY: "k".repeat(40), ADAPTERS_DRY_RUN: "0" };

test("no key, a masked key or an empty search sends nothing", async () => {
  let called = 0;
  const fetchImpl = async () => { called++; return new Response("{}"); };
  assert.equal((await searchWeb({ query: "x" }, { env: {}, fetchImpl })).error, "SERPER_API_KEY is not set");
  assert.equal(serperKey({ SERPER_API_KEY: "****abcd" }), null);
  assert.equal((await searchWeb({ query: "  " }, { env: OPEN, fetchImpl })).error, "empty search");
  assert.equal(called, 0);
});

test("the dry-run fence holds the search when ADAPTERS_DRY_RUN is not off", async () => {
  let called = 0;
  const res = await searchWeb({ query: "x" }, { env: { SERPER_API_KEY: "k".repeat(40) }, fetchImpl: async () => { called++; return new Response("{}"); } });
  assert.equal(res.blocked, true);
  assert.equal(called, 0);
});

test("one POST with the key header; reads title, link and snippet only", async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return new Response(JSON.stringify({ organic: [{ title: "Jane Doe - VP - Bank | LinkedIn", link: "https://www.linkedin.com/in/jane", snippet: "VP at Bank", position: 1, extra: "x" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  const res = await searchWeb({ query: 'site:linkedin.com/in "Bank"', num: 50 }, { env: OPEN, fetchImpl });
  assert.equal(res.ok, true);
  assert.deepEqual(res.results, [{ title: "Jane Doe - VP - Bank | LinkedIn", link: "https://www.linkedin.com/in/jane", snippet: "VP at Bank" }]);
  assert.equal(seen[0].url, ENDPOINT);
  assert.equal(seen[0].init.method, "POST");
  assert.equal(seen[0].init.headers["X-API-KEY"], OPEN.SERPER_API_KEY);
  assert.equal(JSON.parse(seen[0].init.body).num, 10);
});

test("a refusal or a wrong answer shape is an error, never an empty result", async () => {
  const denied = await searchWeb({ query: "x" }, { env: OPEN, fetchImpl: async () => new Response('{"message":"Unauthorized"}', { status: 403 }) });
  assert.equal(denied.ok, false);
  assert.equal(denied.status, 403);
  const odd = await searchWeb({ query: "x" }, { env: OPEN, fetchImpl: async () => new Response('{"items":[]}', { status: 200 }) });
  assert.equal(odd.ok, false);
  assert.match(odd.error, /organic/);
});
