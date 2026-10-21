// Running one scheduled job without Inngest: the handler, the step stand-in, and the receipt.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STEP_ATTEMPTS, makeStep, runScheduledJob, handlerOf, cronOf } from "./run-job.mjs";
import { SCHEDULED_EVENT } from "../pulse/heartbeats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOWS = path.resolve(HERE, "../workflows");
const quiet = { log() {}, error() {} };
const noWait = async () => {};

function receiptDb() {
  const rows = [];
  return {
    rows,
    query: async (sql, params) => {
      assert.match(sql, /INSERT INTO job_heartbeats/);
      const [job, runner, startedAt, finishedAt, outcome, itemCount, error] = params;
      rows.push({ job, runner, startedAt, finishedAt, outcome, itemCount, error });
      return { rows: [] };
    }
  };
}

const fakeFn = (id, handler, cron = "*/5 * * * *") => ({ opts: { id, triggers: [{ cron }] }, fn: handler });

test("PASS: the job's own handler runs with a step, a scheduled event, and the receipt says netlify under the same id", async () => {
  const seen = {};
  const fn = fakeFn("demo-sweeper", async (ctx) => {
    seen.event = ctx.event;
    seen.hasStep = typeof ctx.step.run === "function";
    return ctx.step.run("sweep", async () => ({ claimed: 4, at: new Date("2026-10-21T00:00:00Z") }));
  });
  const db = receiptDb();
  const r = await runScheduledJob({ fn, db, slot: "2026-10-21T04:15:00.000Z", step: makeStep({ wait: noWait, log: quiet }), log: quiet });
  assert.deepEqual(r, { job: "demo-sweeper", ok: true, itemCount: 4, error: null });
  assert.equal(seen.event.name, SCHEDULED_EVENT, "the handler sees the same event name Inngest sent a cron");
  assert.deepEqual(seen.event.data, { cron: "*/5 * * * *", slot: "2026-10-21T04:15:00.000Z" });
  assert.equal(seen.hasStep, true);
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].job, "demo-sweeper");
  assert.equal(db.rows[0].runner, "netlify");
  assert.equal(db.rows[0].outcome, "ok");
  assert.equal(db.rows[0].itemCount, 4);
  assert.ok(db.rows[0].startedAt instanceof Date);
});

test("a step result goes through JSON, as Inngest's memoized result does", async () => {
  const step = makeStep({ wait: noWait, log: quiet });
  const out = await step.run("x", async () => ({ at: new Date("2026-10-21T00:00:00Z"), n: 1, gone: undefined }));
  assert.deepEqual(out, { at: "2026-10-21T00:00:00.000Z", n: 1 });
  assert.equal(await step.run("nothing", async () => undefined), undefined);
});

test("a step that fails is tried again on its own, up to STEP_ATTEMPTS, and earlier steps are not re-run", async () => {
  assert.equal(STEP_ATTEMPTS, 3);
  const step = makeStep({ wait: noWait, log: quiet });
  let first = 0;
  let flaky = 0;
  const fn = fakeFn("retry-demo", async ({ step: s }) => {
    await s.run("first", async () => { first += 1; return 1; });
    return s.run("flaky", async () => {
      flaky += 1;
      if (flaky < 3) throw new Error("blip");
      return { count: 2 };
    });
  });
  const db = receiptDb();
  const r = await runScheduledJob({ fn, db, step, log: quiet });
  assert.equal(r.ok, true);
  assert.equal(first, 1);
  assert.equal(flaky, 3);
  assert.equal(db.rows[0].outcome, "ok");
});

test("FAIL: a step that keeps failing ends the run in an error receipt, and nothing throws", async () => {
  let tries = 0;
  const fn = fakeFn("broken-demo", async ({ step }) => step.run("always", async () => { tries += 1; throw new Error("database is gone"); }));
  const db = receiptDb();
  const r = await runScheduledJob({ fn, db, step: makeStep({ wait: noWait, log: quiet }), log: quiet });
  assert.equal(tries, STEP_ATTEMPTS);
  assert.equal(r.ok, false);
  assert.match(r.error, /database is gone/);
  assert.equal(db.rows[0].outcome, "error");
  assert.match(db.rows[0].error, /database is gone/);
  assert.equal(db.rows[0].runner, "netlify");
});

test("FAIL: a job with no handler is an error receipt, not a crash", async () => {
  const db = receiptDb();
  const r = await runScheduledJob({ fn: { opts: { id: "no-handler", triggers: [{ cron: "0 * * * *" }] } }, db, log: quiet });
  assert.equal(r.ok, false);
  assert.match(r.error, /no handler/);
  assert.equal(db.rows[0].outcome, "error");
});

test("the steps no cron here may use throw instead of pretending", async () => {
  const step = makeStep({ wait: noWait, log: quiet });
  for (const name of ["sleep", "sleepUntil", "waitForEvent", "sendEvent", "invoke"]) {
    await assert.rejects(() => step[name]("x", 1000), /not supported on the Netlify clock/, name);
  }
});

test("no scheduled job sleeps, waits for an event or sends one through step (the stand-in cannot)", () => {
  const src = fs.readFileSync(path.join(WORKFLOWS, "scheduled.mjs"), "utf8");
  const files = [...src.matchAll(/from '\.\/([^']+\.mjs)';/g)].map((m) => m[1]);
  assert.ok(files.length >= 30, "the scheduled job files were read");
  for (const file of files) {
    const code = fs.readFileSync(path.join(WORKFLOWS, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.ok(!/step\??\.(sleep|sleepUntil|waitForEvent|sendEvent|invoke)\s*\(/.test(code), `${file} uses a step the clock cannot run`);
  }
});

test("every real scheduled job has the handler Inngest would have called and exactly one cron", async () => {
  const { scheduled } = await import("../workflows/scheduled.mjs");
  for (const fn of scheduled) {
    assert.equal(typeof handlerOf(fn), "function", fn.opts.id);
    assert.ok(cronOf(fn), fn.opts.id);
  }
});
