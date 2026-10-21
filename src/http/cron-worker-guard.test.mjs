// netlify/functions/cron-worker-background.mjs is an open URL: it must run a job only for a start
// the clock signed, for a fresh slot, and only for a job on the scheduled list.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { makeHandler } from "../../netlify/functions/cron-worker-background.mjs";
import { AUTH_HEADER, sign } from "../cron/clock.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SECRET = "test-secret-not-real";
const NOW = new Date("2026-10-21T04:16:00Z");
const SLOT = "2026-10-21T04:15:00.000Z";
const JOB = { opts: { id: "demo-job", triggers: [{ cron: "*/5 * * * *" }] }, fn: async () => ({}) };

function harness() {
  const calls = { run: [], register: 0 };
  const handler = makeHandler({
    database: { query: async () => ({ rows: [] }) },
    env: { CRON_WORKER_SECRET: SECRET },
    jobs: [JOB],
    run: async (args) => { calls.run.push(args); return { job: args.fn.opts.id, ok: true }; },
    register: () => { calls.register += 1; },
    now: () => NOW
  });
  return { handler, calls };
}

const start = ({ job = "demo-job", slot = SLOT, signature = sign(SECRET, job, slot) } = {}) =>
  new Request("https://fundhub.example/.netlify/functions/cron-worker-background", {
    method: "POST",
    headers: signature == null ? {} : { [AUTH_HEADER]: signature },
    body: JSON.stringify({ job, slot })
  });

test("PASS: a start the clock signed runs that one job, after the bus handlers are registered", async () => {
  const { handler, calls } = harness();
  const res = await handler(start());
  assert.equal(res.status, 202);
  assert.equal(calls.register, 1);
  assert.equal(calls.run.length, 1);
  assert.equal(calls.run[0].fn, JOB);
  assert.equal(calls.run[0].slot, SLOT);
});

test("FAIL: no signature, a wrong one, a stale slot or an unknown job runs nothing", async () => {
  for (const [req, status] of [
    [start({ signature: null }), 401],
    [start({ signature: sign("guessed", "demo-job", SLOT) }), 401],
    [start({ slot: "2026-10-21T03:00:00.000Z" }), 401],
    [start({ job: "not-a-job" }), 404]
  ]) {
    const { handler, calls } = harness();
    const res = await handler(req);
    assert.equal(res.status, status);
    assert.equal(calls.run.length, 0);
    assert.equal(calls.register, 0);
  }
  const { handler, calls } = harness();
  const garbage = new Request("https://fundhub.example/x", { method: "POST", body: "not json" });
  assert.equal((await handler(garbage)).status, 401);
  assert.equal(calls.run.length, 0);
});

test("the worker is a background function with no schedule, a default export, and fontkit in its zip", () => {
  const src = fs.readFileSync(path.join(ROOT, "netlify/functions/cron-worker-background.mjs"), "utf8");
  assert.match(src, /^import "@pdf-lib\/fontkit";$/m);
  assert.match(src, /^export default makeHandler\(\);$/m);
  assert.ok(!/export\s+(async\s+)?function\s+handler|export\s+const\s+handler/.test(src), "no named handler (the 4 KB env trap)");
  const toml = fs.readFileSync(path.join(ROOT, "netlify.toml"), "utf8");
  assert.ok(!/\[functions\."cron-worker-background"\]\s*\n\s*schedule/.test(toml), "a background function cannot be on a clock");
});
