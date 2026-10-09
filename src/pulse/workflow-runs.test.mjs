import { test } from "node:test";
import assert from "node:assert/strict";
import {
  checkWorkflowRuns,
  workflowSince,
  workflowTriggers,
  NOT_LIVE_WORKFLOWS,
  WORKFLOW_SINCE_DAYS
} from "./workflow-runs.mjs";

const NOW = new Date("2026-10-09T17:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const ev = (id, ...events) => ({ opts: { id, triggers: events.map((event) => ({ event })) } });
const cron = (id, expr = "*/5 * * * *") => ({ opts: { id, triggers: [{ cron: expr }] } });
const dark = (id) => ({ opts: { id, triggers: [] } });
const off = (id, event) => ({ opts: { id, enabled: false, triggers: [{ event }] } });

/* A fake events reader. `counts` is { "<event name>": { n, first } }. It records every call. */
function eventsDb(counts = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      const names = params[0];
      const rows = names
        .filter((name) => counts[name])
        .map((name) => ({
          name,
          n: counts[name].n,
          first_at: counts[name].first || "2026-10-07T14:02:00Z",
          last_at: counts[name].last || "2026-10-08T09:00:00Z"
        }));
      return { rows };
    }
  };
}

const find = (rows, id) => rows.find((r) => r.id === `wf:${id}`);

test("no event since the window: nothing to judge, with a no-demand code the audit re-checks", async () => {
  const db = eventsDb();
  const rows = await checkWorkflowRuns({ db, now: NOW, functions: [ev("f-01", "round.started")] });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.id, "wf:f-01");
  assert.equal(r.kind, "coverage");
  assert.equal(r.group, "jobs");
  assert.equal(r.status, "na");
  assert.deepEqual(r.na, { code: "no-demand", args: { names: ["round.started"], since: "2026-10-06T17:00:00.000Z" } });
  assert.equal(r.detail, "No round.started event came since 2026-10-06. Judged the day one comes.");
});

test("an event came: skip, never PASS, never na (we handed it work and cannot prove it ran)", async () => {
  const db = eventsDb({ "round.started": { n: 3, first: "2026-10-07T14:02:00Z" } });
  const [r] = await checkWorkflowRuns({ db, now: NOW, functions: [ev("f-01", "round.started")] });
  assert.equal(r.status, "skip");
  assert.equal(r.na, undefined);
  assert.equal(
    r.detail,
    "3 round.started events came since 2026-10-06 (first 2026-10-07 14:02 UTC). " +
      "Nothing records that this workflow ran. Run receipts are not switched on yet."
  );
  assert.match(r.suggestedFix, /Open f-01 in Inngest/);
  assert.match(r.suggestedFix, /Do not re-run/);
});

test("one event says event, not events", async () => {
  const db = eventsDb({ "round.funded": { n: 1 } });
  const [r] = await checkWorkflowRuns({ db, now: NOW, functions: [ev("f-07", "round.funded")] });
  assert.match(r.detail, /^1 round\.funded event came since/);
});

test("a workflow with two triggers: any one with an event makes it skip, and the names are all listed", async () => {
  const fn = ev("f-06", "mail.response", "docs.received");
  const quiet = await checkWorkflowRuns({ db: eventsDb(), now: NOW, functions: [fn] });
  assert.equal(quiet[0].status, "na");
  assert.deepEqual(quiet[0].na.args.names, ["mail.response", "docs.received"]);
  assert.match(quiet[0].detail, /^No mail\.response or docs\.received event came since/);

  const oneName = await checkWorkflowRuns({ db: eventsDb({ "docs.received": { n: 2 } }), now: NOW, functions: [fn] });
  assert.equal(oneName[0].status, "skip");
  assert.match(oneName[0].detail, /^2 docs\.received events came/);

  const both = await checkWorkflowRuns({
    db: eventsDb({ "mail.response": { n: 1, first: "2026-10-08T01:00:00Z" }, "docs.received": { n: 2, first: "2026-10-07T05:30:00Z" } }),
    now: NOW,
    functions: [fn]
  });
  assert.match(both[0].detail, /^1 mail\.response and 2 docs\.received events came since 2026-10-06 \(first 2026-10-07 05:30 UTC\)/);
});

test("an event for a different workflow does not touch this one", async () => {
  const db = eventsDb({ "round.funded": { n: 5 } });
  const rows = await checkWorkflowRuns({
    db,
    now: NOW,
    functions: [ev("f-01", "round.started"), ev("f-07", "round.funded")]
  });
  assert.equal(find(rows, "f-01").status, "na");
  assert.equal(find(rows, "f-07").status, "skip");
});

test("no trigger, or switched off: na no-trigger, and it needs no database", async () => {
  const rows = await checkWorkflowRuns({
    db: null,
    now: NOW,
    functions: [dark("n-01-cold-nurture"), off("n-03-hot-nurture", "round.funded")]
  });
  assert.equal(rows.length, 2);
  for (const r of rows) {
    assert.equal(r.status, "na", r.id);
    assert.equal(r.na.code, "no-trigger");
    assert.equal(r.detail, "Turned off in code (no trigger). Judged the day a trigger is put back.");
  }
  assert.deepEqual(find(rows, "n-01-cold-nurture").na.args, { id: "n-01-cold-nurture" });
  assert.deepEqual(find(rows, "n-03-hot-nurture").na.args, { id: "n-03-hot-nurture" });
});

test("a switched-off workflow is not given a no-demand claim even if its event came", async () => {
  const db = eventsDb({ "round.funded": { n: 4 } });
  const [r] = await checkWorkflowRuns({ db, now: NOW, functions: [off("n-03-hot-nurture", "round.funded")] });
  assert.equal(r.status, "na");
  assert.equal(r.na.code, "no-trigger");
  assert.equal(db.calls.length, 0, "a dark workflow's events are not even read");
});

test("crons are the job: rows, so no wf: row is made for them", async () => {
  const rows = await checkWorkflowRuns({
    db: eventsDb(),
    now: NOW,
    functions: [cron("daily-pulse"), ev("f-01", "round.started"), cron("blake-lead-watch")]
  });
  assert.deepEqual(rows.map((r) => r.id), ["wf:f-01"]);
});

test("one read for every function, a plain SELECT, with the names and a 3-day start", async () => {
  const db = eventsDb({ "round.started": { n: 1 } });
  await checkWorkflowRuns({
    db,
    now: NOW,
    functions: [ev("a", "round.started"), ev("b", "round.started", "round.funded"), ev("c", "booking.created"), dark("d")]
  });
  assert.equal(db.calls.length, 1);
  const { sql, params } = db.calls[0];
  assert.match(sql, /^\s*SELECT/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate|begin|commit)\b/i);
  assert.match(sql, /FROM events/);
  assert.match(sql, /GROUP BY name/);
  assert.deepEqual(params[0].sort(), ["booking.created", "round.funded", "round.started"]);
  assert.equal(params[1], new Date(NOW.getTime() - WORKFLOW_SINCE_DAYS * DAY).toISOString());
});

test("the staff scope is used for the read when the pulse hands one over", async () => {
  const db = { query: async () => { throw new Error("the plain pool must not be used"); } };
  let scoped = 0;
  const scope = (fn) => {
    scoped += 1;
    return fn(eventsDb({ "round.started": { n: 2 } }));
  };
  const [r] = await checkWorkflowRuns({ db, scope, now: NOW, functions: [ev("f-01", "round.started")] });
  assert.equal(scoped, 1);
  assert.equal(r.status, "skip");
});

test("the read failed: every event row is a skip with the error, and dark rows stay na", async () => {
  const db = { query: async () => { throw new Error("connection terminated"); } };
  const rows = await checkWorkflowRuns({ db, now: NOW, functions: [ev("f-01", "round.started"), dark("n-01")] });
  const r = find(rows, "f-01");
  assert.equal(r.status, "skip");
  assert.equal(r.na, undefined);
  assert.match(r.detail, /^Events could not be read: connection terminated\. This workflow was not judged\.$/);
  assert.equal(find(rows, "n-01").status, "na");
});

test("no database at all: the event rows are skips, not na", async () => {
  const rows = await checkWorkflowRuns({ db: null, now: NOW, functions: [ev("f-01", "round.started")] });
  assert.equal(rows[0].status, "skip");
  assert.match(rows[0].detail, /no database in this run/);
});

test("a read that hangs is cut, and says so", async () => {
  const db = { query: () => new Promise(() => {}) };
  const t0 = Date.now();
  const [r] = await checkWorkflowRuns({ db, now: NOW, functions: [ev("f-01", "round.started")], readTimeoutMs: 30 });
  assert.ok(Date.now() - t0 < 2000);
  assert.equal(r.status, "skip");
  assert.match(r.detail, /the read took too long/);
});

test("a database that throws before it returns (no DATABASE_URL) is a skip, not a crash", async () => {
  const db = { query() { throw new Error("DATABASE_URL is not set"); } };
  const [r] = await checkWorkflowRuns({ db, now: NOW, functions: [ev("f-01", "round.started")] });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /DATABASE_URL is not set/);
});

test("no workflow list: one skip row, never a throw", async () => {
  const rows = await checkWorkflowRuns({ db: eventsDb(), now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "skip");
});

test("no row is ever PASS, whatever the events say", async () => {
  const functions = [ev("a", "round.started"), ev("b", "round.funded"), dark("c"), off("d", "x.y")];
  for (const counts of [{}, { "round.started": { n: 1 } }, { "round.started": { n: 9 }, "round.funded": { n: 9 } }]) {
    const rows = await checkWorkflowRuns({ db: eventsDb(counts), now: NOW, functions });
    for (const r of rows) assert.notEqual(r.status, "PASS", r.id);
  }
});

test("every na row carries a code and plain-JSON args; every other row carries none", async () => {
  const rows = await checkWorkflowRuns({
    db: eventsDb({ "round.funded": { n: 1 } }),
    now: NOW,
    functions: [ev("a", "round.started"), ev("b", "round.funded"), dark("c")]
  });
  for (const r of rows) {
    if (r.status === "na") {
      assert.ok(["no-demand", "no-trigger"].includes(r.na.code), r.id);
      assert.deepEqual(JSON.parse(JSON.stringify(r.na.args)), r.na.args, r.id);
    } else {
      assert.equal(r.na, undefined, r.id);
    }
  }
});

test("workflowSince is exactly three days before now", () => {
  assert.equal(WORKFLOW_SINCE_DAYS, 3);
  assert.equal(workflowSince(NOW).toISOString(), "2026-10-06T17:00:00.000Z");
});

test("workflowTriggers reads Inngest's opts shape, and falls back to fn.id()", () => {
  assert.deepEqual(workflowTriggers(ev("x", "a.b", "c.d")), { id: "x", events: ["a.b", "c.d"], crons: [], enabled: true, hasTrigger: true });
  assert.equal(workflowTriggers(cron("y")).crons.length, 1);
  assert.equal(workflowTriggers(off("z", "a.b")).enabled, false);
  assert.equal(workflowTriggers({ id: () => "from-id", opts: {} }).id, "from-id");
  assert.equal(workflowTriggers(null).id, null);
});

test("NOT_LIVE_WORKFLOWS: every reason is a real sentence of 40+ characters", () => {
  assert.deepEqual(Object.keys(NOT_LIVE_WORKFLOWS).sort(), ["n-01-cold-nurture", "n-02-warm-nurture", "n-03-hot-nurture"]);
  for (const [id, why] of Object.entries(NOT_LIVE_WORKFLOWS)) {
    assert.ok(why.length >= 40, id);
  }
  assert.ok(Object.isFrozen(NOT_LIVE_WORKFLOWS));
});

/* ---- the real bundle (what the pulse will actually run) ---- */

test("today's bundle: 65 wf: rows, 62 event workflows and 3 dark ones, ids unique", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const rows = await checkWorkflowRuns({ db: eventsDb(), now: NOW, functions });
  assert.equal(rows.length, 65);
  assert.equal(new Set(rows.map((r) => r.id)).size, 65);
  assert.ok(rows.every((r) => r.id.startsWith("wf:")));
  const dim = rows.filter((r) => r.na?.code === "no-trigger").map((r) => r.id).sort();
  assert.deepEqual(dim, ["wf:n-01-cold-nurture", "wf:n-02-warm-nurture", "wf:n-03-hot-nurture"]);
  assert.equal(rows.filter((r) => r.na?.code === "no-demand").length, 62);
  assert.equal(rows.filter((r) => r.status === "skip").length, 0);
});

test("today's bundle with one round.started event: exactly the round.started workflows turn to skip", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const wake = functions.filter((fn) => workflowTriggers(fn).events.includes("round.started")).map((fn) => workflowTriggers(fn).id).sort();
  assert.ok(wake.length >= 3, "the bundle has several round.started workflows");
  const rows = await checkWorkflowRuns({ db: eventsDb({ "round.started": { n: 1 } }), now: NOW, functions });
  const skipped = rows.filter((r) => r.status === "skip").map((r) => r.id.slice(3)).sort();
  assert.deepEqual(skipped, wake);
  assert.equal(rows.length, 65);
});

test("today's bundle: one read, under a second against a fake database", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const db = eventsDb();
  const t0 = Date.now();
  await checkWorkflowRuns({ db, now: NOW, functions });
  assert.equal(db.calls.length, 1);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(db.calls[0].params[0].length, 22, "22 distinct trigger names in the bundle today");
});
