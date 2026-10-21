import test from "node:test";
import assert from "node:assert/strict";
import { hedgedSiteFetch, HEDGE_MS, MAX_EXTRA_REQUESTS } from "./site-hedge.mjs";

const SITE = "fundhub.ai";
const ok = (text = "ok", status = 200) => new Response(text, { status });

/** A fake fetch: each call takes the next plan entry. "silent" never answers until its signal aborts. */
function fakeFetch(plan) {
  const calls = [];
  const impl = (url, init = {}) => {
    const step = plan[calls.length] ?? plan[plan.length - 1];
    calls.push({ url, init });
    if (step === "silent") {
      return new Promise((_, reject) => {
        const s = init.signal;
        const stop = () => reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" }));
        if (s?.aborted) stop(); else s?.addEventListener("abort", stop, { once: true });
      });
    }
    if (step instanceof Error) return Promise.reject(step);
    return new Promise((resolve) => setTimeout(() => resolve(ok(step.text, step.status)), step.ms || 0));
  };
  return { impl, calls };
}

test("the measured settings: one second apart, at most two more requests", () => {
  assert.equal(HEDGE_MS, 1000);
  assert.equal(MAX_EXTRA_REQUESTS, 2);
});

test("a site door that answers in time is asked once", async () => {
  const { impl, calls } = fakeFetch([{ ms: 5, text: "fast" }]);
  const log = [];
  const res = await hedgedSiteFetch(impl, { siteHost: SITE, hedgeMs: 50, log })("https://fundhub.ai/api/health?strict=1");
  assert.equal(await res.text(), "fast");
  assert.equal(calls.length, 1);
  assert.deepEqual(log, []);
});

test("a silent first connection gets one more request, and the answer comes from the second", async () => {
  const { impl, calls } = fakeFetch(["silent", { ms: 5, text: "second" }]);
  const log = [];
  const outer = new AbortController();
  const t0 = Date.now();
  const res = await hedgedSiteFetch(impl, { siteHost: SITE, hedgeMs: 40, log })("https://fundhub.ai/roadmap/pay.html?c=secret", { signal: outer.signal });
  assert.equal(await res.text(), "second");
  assert.equal(calls.length, 2);
  assert.ok(Date.now() - t0 >= 35, "the second request waits for the hedge time");
  assert.equal(log.length, 1);
  assert.equal(log[0].winner, 2);
  assert.equal(log[0].sent, 2, "the answer came before a third request was needed");
  assert.equal(log[0].path, "/roadmap/pay.html", "the log never holds the query string");
  assert.ok(calls[0].init.signal && calls[1].init.signal && calls[0].init.signal !== calls[1].init.signal);
  outer.abort();
  assert.ok(calls[0].init.signal.aborted, "the caller's abort still reaches the silent first request");
});

test("a slow first answer still wins when it arrives before the second", async () => {
  const { impl, calls } = fakeFetch([{ ms: 60, text: "first" }, { ms: 500, text: "second" }]);
  const log = [];
  const res = await hedgedSiteFetch(impl, { siteHost: SITE, hedgeMs: 40, log })("https://fundhub.ai/api/public/slo-interest");
  assert.equal(await res.text(), "first");
  assert.equal(calls.length, 2, "the first answered before a third request was due");
  assert.equal(log[0].winner, 1);
});

test("two silent connections: the third request, a second later, answers", async () => {
  const { impl, calls } = fakeFetch(["silent", "silent", { ms: 5, text: "third" }]);
  const log = [];
  const t0 = Date.now();
  const res = await hedgedSiteFetch(impl, { siteHost: SITE, hedgeMs: 40, log })("https://fundhub.ai/roadmap");
  assert.equal(await res.text(), "third");
  assert.equal(calls.length, 3);
  assert.ok(Date.now() - t0 >= 75, "the third request waits two hedge times");
  assert.deepEqual([log[0].winner, log[0].sent], [3, 3]);
});

test("a door that answers none of the requests still fails, with the caller's timeout", async () => {
  const { impl, calls } = fakeFetch(["silent", "silent", "silent", "silent"]);
  const log = [];
  const stop = new AbortController();
  setTimeout(() => stop.abort(), 120);
  const outer = stop.signal;
  await assert.rejects(
    hedgedSiteFetch(impl, { siteHost: SITE, hedgeMs: 30, log })("https://fundhub.ai/api/webhooks/commas", { signal: outer }),
    (err) => err.name === "AbortError"
  );
  assert.equal(calls.length, 3, "at most two more requests, never a retry loop");
  assert.equal(log[0].winner, 0);
  assert.equal(log[0].sent, 3);
});

test("a fast error passes straight through and is not retried", async () => {
  const { impl, calls } = fakeFetch([new TypeError("fetch failed")]);
  await assert.rejects(hedgedSiteFetch(impl, { siteHost: SITE, hedgeMs: 50 })("https://fundhub.ai/api/health"), /fetch failed/);
  assert.equal(calls.length, 1);
});

test("a 500 is an answer: it is returned as is, not hedged", async () => {
  const { impl, calls } = fakeFetch([{ ms: 5, text: "down", status: 500 }]);
  const res = await hedgedSiteFetch(impl, { siteHost: SITE, hedgeMs: 50 })("https://fundhub.ai/api/health");
  assert.equal(res.status, 500);
  assert.equal(calls.length, 1);
});

test("other hosts and other methods are passed through untouched, once", async () => {
  for (const [url, init] of [["https://apply.fundhub.ai/roadmap", {}], ["https://www.chase.com/business", {}], ["https://fundhub.ai/api/x", { method: "POST" }]]) {
    const { impl, calls } = fakeFetch(["silent"]);
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 80);
    const outer = stop.signal;
    await assert.rejects(hedgedSiteFetch(impl, { siteHost: SITE, hedgeMs: 10 })(url, { ...init, signal: outer }));
    clearTimeout(timer);
    assert.equal(calls.length, 1, `${init.method || "GET"} ${url} is not hedged`);
    assert.equal(calls[0].init.signal, outer, "the caller's own init is passed as is");
  }
});

test("an already aborted caller gets no second request", async () => {
  const { impl, calls } = fakeFetch(["silent", { ms: 1, text: "x" }]);
  const outer = new AbortController();
  outer.abort();
  await assert.rejects(hedgedSiteFetch(impl, { siteHost: SITE, hedgeMs: 10 })("https://fundhub.ai/api/health", { signal: outer.signal }));
  assert.equal(calls.length, 1);
});
