import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { formatProofFetchTrace, makeProofFetchTrace, proofFetch } from "./prove-fetch-trace.mjs";

const own = "https://reader:password@fundhub.ai/api/health?token=secret#private";

test("timing traces only the own hostname and pathname, with separate header and body time", async () => {
  let clock = 100;
  const trace = makeProofFetchTrace({ now: () => clock });
  const init = { method: "GET", signal: { keep: "same object" }, headers: { authorization: "hidden" } };
  let calls = 0;
  const result = await proofFetch(async (url, passed) => {
    calls++;
    assert.equal(url, own);
    assert.equal(passed, init);
    clock += 41;
    return {
      status: 200, url: own,
      headers: new Headers({ "content-type": "application/json" }),
      async text() { clock += 17; return '{"body":"hidden"}'; }
    };
  }, own, init, "GET", trace);

  assert.equal(calls, 1);
  assert.equal(result.status, 200);
  assert.equal(result.body, '{"body":"hidden"}');
  assert.equal(result.url, own);
  assert.deepEqual(result.headers, [["content-type", "application/json"]]);
  const fromMemo = () => new Response(result.body, { status: result.status, headers: result.headers });
  const first = fromMemo();
  assert.equal(await first.clone().text(), result.body);
  assert.equal(await first.text(), result.body);
  assert.equal(await fromMemo().text(), result.body);
  assert.equal(calls, 1, "fresh responses and clones must not refetch the source");
  const [entry] = trace.slowOrFailed(50);
  assert.equal(entry.headerMs, 41);
  assert.equal(entry.bodyMs, 17);
  assert.equal(entry.totalMs, 58);
  assert.equal(entry.status, 200);
  assert.equal(entry.phase, "done");
  assert.equal(formatProofFetchTrace(entry), "GET fundhub.ai/api/health status=200 headers=41ms body=17ms total=58ms");
  assert.doesNotMatch(JSON.stringify(entry), /reader|password|token|secret|private|authorization|hidden/);
  assert.deepEqual(trace.slowOrFailed(1000), []);
});

test("pre-header timeout and body-read failure keep phases and only safe error names/codes", async () => {
  let clock = 0;
  const trace = makeProofFetchTrace({ now: () => clock });
  const headersError = Object.assign(new Error("Bearer TOPSECRET"), {
    name: "TimeoutError", cause: { code: "UND_ERR_CONNECT_TIMEOUT" }
  });
  await assert.rejects(proofFetch(async () => {
    clock += 15000;
    throw headersError;
  }, own, {}, "GET", trace), (error) => error === headersError);

  const bodyError = Object.assign(new Error("customer body secret"), {
    name: "Unsafe Secret Name", cause: { code: "private-code-123" }
  });
  await assert.rejects(proofFetch(async () => {
    clock += 12;
    return {
      status: 200, url: own, headers: new Headers(),
      async text() { clock += 8; throw bodyError; }
    };
  }, own, {}, "GET", trace), (error) => error === bodyError);

  const [preHeader, body] = trace.slowOrFailed();
  assert.deepEqual({ status: preHeader.status, headerMs: preHeader.headerMs, bodyMs: preHeader.bodyMs, totalMs: preHeader.totalMs, phase: preHeader.phase },
    { status: 0, headerMs: null, bodyMs: null, totalMs: 15000, phase: "headers" });
  assert.equal(preHeader.error, "TimeoutError");
  assert.equal(preHeader.code, "UND_ERR_CONNECT_TIMEOUT");
  assert.deepEqual({ status: body.status, headerMs: body.headerMs, bodyMs: body.bodyMs, totalMs: body.totalMs, phase: body.phase },
    { status: 200, headerMs: 12, bodyMs: 8, totalMs: 20, phase: "body" });
  assert.equal(body.error, "Error");
  assert.equal(body.code, "other");
  assert.doesNotMatch(trace.slowOrFailed().map(formatProofFetchTrace).join("\n"), /TOPSECRET|customer|private-code|password|token=|#/);
});

test("HEAD skips body and non-Fundhub requests make no trace", async () => {
  let clock = 0;
  const trace = makeProofFetchTrace({ now: () => clock });
  let bodyReads = 0;
  const fetchImpl = async () => {
    clock += 7;
    return { status: 204, url: "https://apply.fundhub.ai/roadmap?secret=1", headers: new Headers(), text: async () => { bodyReads++; return "hidden"; } };
  };
  const result = await proofFetch(fetchImpl, "https://apply.fundhub.ai/roadmap?secret=1", {}, "HEAD", trace);
  assert.equal(result.body, "");
  assert.equal(bodyReads, 0);
  assert.equal(trace.slowOrFailed(0)[0].target, "apply.fundhub.ai/roadmap");
  await proofFetch(fetchImpl, "https://bank.example/apply?secret=1", {}, "HEAD", trace);
  assert.equal(trace.slowOrFailed(0).length, 1);
});

test("morning proof still memoizes before returning fresh cloneable Responses and prints trace only on failure", () => {
  const source = fs.readFileSync(new URL("./prove.mjs", import.meta.url), "utf8");
  const morning = source.slice(0, source.indexOf("/* =====================================================================================================\n   --beats"));
  assert.match(morning, /const key = `\$\{method\} \$\{url\} \$\{\(init && init\.redirect\) \|\| ""\}`/);
  assert.match(morning, /if \(!memo\.has\(key\)\)/);
  assert.match(morning, /memo\.set\(key, await proofFetch\(realFetch, url,/);
  assert.match(morning, /const res = new Response\(/);
  assert.match(morning, /Object\.defineProperty\(res, "url", \{ value: hit\.url \}\)/);
  assert.match(morning, /if \(problems\.length\) \{\s*for \(const entry of webTrace\.slowOrFailed\(\)\)/);
});
