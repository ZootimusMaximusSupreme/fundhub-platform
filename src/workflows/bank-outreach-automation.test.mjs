import { test } from "node:test";
import assert from "node:assert/strict";
import { AUTOMATION_CRON, handle } from "./bank-outreach-automation.mjs";

test("three named steps; with no settings it searches nothing and queues nothing", async () => {
  const queries = [];
  const steps = [];
  const result = await handle({
    env: {},
    now: new Date("2026-10-21T16:00:00Z"),
    database: { async query(sql, params) { queries.push({ sql, params }); return { rows: /count\(\*\)::int n\b/.test(sql) ? [{ n: 0 }] : [], rowCount: 0 }; } },
    step: { async run(name, fn) { steps.push(name); return fn(); } }
  });
  assert.equal(AUTOMATION_CRON, "57 * * * *");
  assert.deepEqual(steps, ["find-bankers", "queue-emails", "read-replies"]);
  assert.equal(result.search.reason, "no_search_key");
  assert.equal(result.emails.reason, "not_configured");
  assert.deepEqual(result.replies, { ok: true, processed: 0, results: [] });
  assert.equal(queries.some(({ sql }) => /INSERT INTO messages/i.test(sql)), false);
  assert.equal(queries.some(({ sql }) => /outreach_search_runs\(/i.test(sql)), false);
});

test("a failing part reports its error and never stops the others", async () => {
  const steps = [];
  const result = await handle({
    env: {},
    database: { async query() { throw new Error("database is down"); } },
    step: { async run(name, fn) { steps.push(name); return fn(); } }
  });
  assert.equal(steps.length, 3);
  assert.equal(result.emails.ok, false);
  assert.match(result.emails.error, /database is down/);
  assert.equal(result.replies.ok, false);
});
