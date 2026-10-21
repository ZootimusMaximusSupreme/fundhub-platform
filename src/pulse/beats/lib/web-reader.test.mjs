import test from "node:test";
import assert from "node:assert/strict";
import { webFromHttp } from "./web-reader.mjs";

function fakeHttp(answer) {
  const calls = [];
  const one = (method) => async (url, opts) => { calls.push({ method, url, opts }); return answer; };
  return { calls, get: one("GET"), head: one("HEAD") };
}

test("webFromHttp answers like a fetch Response: status, url, headers.get, text, json", async () => {
  const http = fakeHttp({ status: 200, body: "{\"ok\":true}", headers: { "Content-Type": "application/json" }, finalUrl: "https://apply.fundhub.ai/order", truncated: false });
  const res = await webFromHttp(http)("https://apply.fundhub.ai/order?fh_cb=1", { method: "GET", headers: { accept: "application/json" } });
  assert.equal(res.status, 200);
  assert.equal(res.ok, true);
  assert.equal(res.url, "https://apply.fundhub.ai/order");
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("x-missing"), null);
  assert.equal(await res.text(), "{\"ok\":true}");
  assert.deepEqual(await res.json(), { ok: true });
  assert.deepEqual(http.calls, [{ method: "GET", url: "https://apply.fundhub.ai/order?fh_cb=1", opts: { headers: { accept: "application/json" } } }]);
});

test("webFromHttp throws the probe's reason when no answer came back, the way fetch rejects", async () => {
  const http = fakeHttp({ status: 0, body: "", error: "timed out after 8000ms" });
  await assert.rejects(() => webFromHttp(http)("https://fundhub.ai/x"), /timed out after 8000ms/);
});

test("webFromHttp refuses any method but GET and HEAD before asking anything", async () => {
  const http = fakeHttp({ status: 200, body: "" });
  for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
    await assert.rejects(() => webFromHttp(http)("https://fundhub.ai/x", { method }), /only reads with GET or HEAD/);
  }
  assert.equal(http.calls.length, 0);
  const head = await webFromHttp(http)("https://fundhub.ai/x", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(http.calls[0].method, "HEAD");
});
