import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  EVENTS_SQL,
  FAILED_JUDGE_AFTER_MS,
  NOT_LIVE_WORKFLOWS,
  OPEN_LIMIT_MS,
  RECEIPTS_GRACE_MS,
  RECORDER_FUNCTION_ID,
  RUNS_SQL,
  SLEEPERS,
  SLEEPER_SLACK_MS,
  START_GRACE_MS,
  WORKFLOW_SINCE_DAYS,
  checkWorkflowRuns,
  workflowSince,
  workflowTriggers
} from "./workflow-runs.mjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const NOW = new Date("2026-10-12T17:00:00Z");
/* Receipts began three days before NOW: the grace hour is over, and the "receipts are a day old" floor too. */
const BEGAN = new Date(NOW.getTime() - 3 * DAY);
const ago = (ms) => new Date(NOW.getTime() - ms);

const ev = (id, ...events) => ({ opts: { id, triggers: events.map((event) => ({ event })) } });
const cron = (id, expr = "*/5 * * * *") => ({ opts: { id, triggers: [{ cron: expr }] } });
const dark = (id) => ({ opts: { id, triggers: [] } });
const off = (id, event) => ({ opts: { id, enabled: false, triggers: [{ event }] } });

/* A raw row of the runs read, the way Postgres hands it back. */
function runRow(fn, over = {}) {
  const started = over.started || ago(2 * HOUR);
  const finishedAt = "finished" in over ? over.finished : new Date(started.getTime() + 30 * 1000);
  return {
    kind: "run",
    function_id: fn,
    run_id: over.runId || `run-${Math.random().toString(36).slice(2)}`,
    event_name: over.event || "round.started",
    bus_event_id: over.bus || null,
    attempt: over.attempt ?? 0,
    max_attempts: over.max ?? 4,
    at: started,
    finished_at: finishedAt,
    outcome: finishedAt ? (over.outcome || "ok") : null,
    final: over.final ?? Boolean(finishedAt),
    skipped: over.skipped ?? false,
    note: over.note ?? null,
    error: over.error ?? null,
    n: null
  };
}

const missRow = (fn, name, n, first, last = first) => ({
  kind: "miss", function_id: fn, event_name: name, at: first, finished_at: last, n
});

/* A fake database. It answers the events read and the runs read, tells them apart by their SQL, and records every call. */
function fakeDb({
  events = {},
  runs = [],
  miss = [],
  began = BEGAN,
  canWrite = true,
  eventsError = null,
  runsError = null
} = {}) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      if (sql === EVENTS_SQL) {
        if (eventsError) throw eventsError;
        return {
          rows: params[0]
            .filter((name) => events[name])
            .map((name) => ({
              name,
              n: events[name].n,
              first_at: events[name].first || new Date("2026-10-11T08:00:00Z"),
              last_at: events[name].last || events[name].first || new Date("2026-10-11T09:00:00Z")
            }))
        };
      }
      if (sql === RUNS_SQL) {
        if (runsError) throw runsError;
        const meta = { kind: "meta", at: began, n: canWrite ? 1 : 0 };
        return { rows: [...runs, ...miss, meta] };
      }
      throw new Error(`unexpected query: ${String(sql).slice(0, 40)}`);
    }
  };
}

const find = (rows, id) => rows.find((r) => r.id === `wf:${id}`);
const one = async (fn, data, now = NOW) => (await checkWorkflowRuns({ db: fakeDb(data), now, functions: [fn] }))[0];

/* ═════ g. nobody handed it work ═════ */

test("g: no event and no run: nothing to judge, with a no-demand code the audit re-checks", async () => {
  const db = fakeDb();
  const rows = await checkWorkflowRuns({ db, now: NOW, functions: [ev("f-01", "round.started")] });
  assert.equal(rows.length, 1);
  const r = rows[0];
  assert.equal(r.id, "wf:f-01");
  assert.equal(r.kind, "coverage");
  assert.equal(r.group, "jobs");
  assert.equal(r.status, "na");
  assert.deepEqual(r.na, { code: "no-demand", args: { names: ["round.started"], since: "2026-10-09T17:00:00.000Z" } });
  assert.equal(r.detail, "No round.started event came since 2026-10-09. Judged the day one comes.");
});

test("g (its twin): the same workflow with an event is NOT nothing to judge", async () => {
  const r = await one(ev("f-01", "round.started"), { events: { "round.started": { n: 2 } }, began: null });
  assert.notEqual(r.status, "na");
  assert.equal(r.na, undefined);
});

test("g: two triggers: the names are all listed, and any one with an event ends the claim", async () => {
  const fn = ev("f-06", "mail.response", "docs.received");
  const quiet = await one(fn, {});
  assert.equal(quiet.status, "na");
  assert.deepEqual(quiet.na.args.names, ["mail.response", "docs.received"]);
  assert.match(quiet.detail, /^No mail\.response or docs\.received event came since/);
  const busy = await one(fn, { events: { "docs.received": { n: 2 } }, began: null });
  assert.notEqual(busy.status, "na");
});

test("g: an event for a different workflow does not touch this one", async () => {
  const rows = await checkWorkflowRuns({
    db: fakeDb({ events: { "round.funded": { n: 5 } }, began: null }),
    now: NOW,
    functions: [ev("f-01", "round.started"), ev("f-07", "round.funded")]
  });
  assert.equal(find(rows, "f-01").status, "na");
  assert.notEqual(find(rows, "f-07").status, "na");
});

/* ═════ a. nothing wakes it ═════ */

test("a: no trigger, or switched off: na no-trigger, and it needs no database", async () => {
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

test("a: a switched-off workflow is not given a no-demand claim even if its event came, and its events are not read", async () => {
  const db = fakeDb({ events: { "round.funded": { n: 4 } } });
  const [r] = await checkWorkflowRuns({ db, now: NOW, functions: [off("n-03-hot-nurture", "round.funded")] });
  assert.equal(r.status, "na");
  assert.equal(r.na.code, "no-trigger");
  assert.equal(db.calls.length, 0, "a dark workflow's events and runs are not even read");
});

test("crons are the job: rows, so no wf: row is made for them", async () => {
  const rows = await checkWorkflowRuns({
    db: fakeDb(),
    now: NOW,
    functions: [cron("daily-pulse"), ev("f-01", "round.started"), cron("blake-lead-watch")]
  });
  assert.deepEqual(rows.map((r) => r.id), ["wf:f-01"]);
});

/* ═════ f. it ran ═════ */

test("f: a run finished ok: PASS with the times", async () => {
  const r = await one(ev("f-01", "round.started"), {
    runs: [runRow("f-01", { started: new Date("2026-10-12T10:00:00Z"), finished: new Date("2026-10-12T10:00:42Z") })]
  });
  assert.equal(r.status, "PASS");
  assert.equal(r.na, undefined);
  assert.equal(r.detail, "Last run started 2026-10-12 10:00 UTC and finished ok 2026-10-12 10:00 UTC.");
  assert.equal(r.schedule, "round.started");
});

test("f: a run that skipped on purpose still PASSes, and says why", async () => {
  const r = await one(ev("f-01", "round.started"), {
    runs: [runRow("f-01", { skipped: true, note: "switched_off" })]
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /It skipped: switched_off\.$/);
});

test("f: a run is judged PASS only with a run behind it: a row with no run is never PASS (unless an event is brand new)", async () => {
  const functions = [ev("a", "round.started"), ev("b", "round.funded"), dark("c"), off("d", "x.y")];
  for (const events of [{}, { "round.started": { n: 1 } }, { "round.started": { n: 9 }, "round.funded": { n: 9 } }]) {
    for (const began of [null, BEGAN, ago(2 * HOUR)]) {
      const rows = await checkWorkflowRuns({ db: fakeDb({ events, began }), now: NOW, functions });
      for (const r of rows) assert.notEqual(r.status, "PASS", `${r.id}: ${r.detail}`);
    }
  }
});

/* ═════ b. the last run failed for good ═════ */

test("b: its newest run failed for good over 15 minutes ago: FAIL, with the redacted error and a fix", async () => {
  const r = await one(ev("s-00-welcome", "entry.captured"), {
    runs: [runRow("s-00-welcome", {
      started: new Date("2026-10-12T14:00:00Z"), finished: new Date("2026-10-12T14:00:09Z"),
      outcome: "error", final: true, error: "vendor said no"
    })]
  });
  assert.equal(r.status, "FAIL");
  assert.equal(r.detail, "Its last run failed 2026-10-12 14:00 UTC: vendor said no. No retry is coming.");
  assert.match(r.suggestedFix, /^Open s-00-welcome in Inngest and read that run\. Do not re-run it from this pulse\.$/);
  assert.match(r.customerSees, /s-00-welcome/);
});

test("b (its twin): the same failure followed by a later ok run is PASS", async () => {
  const r = await one(ev("s-00-welcome", "entry.captured"), {
    runs: [
      runRow("s-00-welcome", { started: ago(5 * HOUR), outcome: "error", final: true, error: "vendor said no" }),
      runRow("s-00-welcome", { started: ago(1 * HOUR) })
    ]
  });
  assert.equal(r.status, "PASS");
});

test("b: a failure with a retry still coming is PASS-pending 'retrying', never red", async () => {
  const r = await one(ev("s-00-welcome", "entry.captured"), {
    runs: [runRow("s-00-welcome", { started: ago(40 * MIN), outcome: "error", final: false, attempt: 1, max: 4, error: "timeout" })]
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /^Retrying: attempt 2 of 4 failed 2026-10-12 \d\d:\d\d UTC: timeout\./);
});

test("b: a failure for good that is under 15 minutes old waits (skip), it is not guessed", async () => {
  const r = await one(ev("s-00-welcome", "entry.captured"), {
    runs: [runRow("s-00-welcome", { started: ago(8 * MIN), outcome: "error", final: true, error: "boom" })]
  });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /^Its last run failed 8 minutes ago: boom\. It is judged once it is 15 minutes old\.$/);
  assert.equal(FAILED_JUDGE_AFTER_MS, 15 * MIN);
});

test("b: a failed run with no saved reason still says so", async () => {
  const r = await one(ev("x", "round.started"), { runs: [runRow("x", { outcome: "error", final: true, error: null })] });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /no reason was saved/);
});

/* ═════ c. the event came and the workflow never started ═════ */

test("c: an event came, over 15 minutes ago, after receipts began, and no run carries it: FAIL, with the count and the first time", async () => {
  const r = await one(ev("slo-paid-form-nudge", "payment.received"), {
    miss: [missRow("slo-paid-form-nudge", "payment.received", 3, new Date("2026-10-11T14:02:00Z"), new Date("2026-10-12T09:00:00Z"))]
  });
  assert.equal(r.status, "FAIL");
  assert.equal(r.detail, "3 payment.received events came and this workflow never started (first 2026-10-11 14:02 UTC). The engine did not run it.");
  assert.match(r.suggestedFix, /look for the payment\.received event/);
  assert.match(r.suggestedFix, /Do not re-run it from this pulse/);
});

test("c: one event says event, two names are both listed", async () => {
  const r = await one(ev("f-06", "mail.response", "docs.received"), {
    miss: [missRow("f-06", "mail.response", 1, ago(3 * HOUR)), missRow("f-06", "docs.received", 2, ago(2 * HOUR))]
  });
  assert.match(r.detail, /^1 mail\.response and 2 docs\.received events came and this workflow never started/);
  const single = await one(ev("f-01", "round.started"), { miss: [missRow("f-01", "round.started", 1, ago(3 * HOUR))] });
  assert.match(single.detail, /^1 round\.started event came and this workflow never started/);
});

test("c (its twin): the event came and a run of this workflow carries it: no 'never started' (the read returns no miss)", async () => {
  const r = await one(ev("slo-paid-form-nudge", "payment.received"), {
    events: { "payment.received": { n: 3 } },
    runs: [runRow("slo-paid-form-nudge", { bus: "evt-1", event: "payment.received" })]
  });
  assert.equal(r.status, "PASS");
});

test("c: a miss for ANOTHER workflow does not turn this one red", async () => {
  const rows = await checkWorkflowRuns({
    db: fakeDb({ miss: [missRow("f-07", "round.funded", 2, ago(3 * HOUR))] }),
    now: NOW,
    functions: [ev("f-01", "round.started"), ev("f-07", "round.funded")]
  });
  assert.equal(find(rows, "f-01").status, "na");
  assert.equal(find(rows, "f-07").status, "FAIL");
});

test("c: when the app can no longer write receipts, a miss is 'receipts are off', never 'never started'", async () => {
  const r = await one(ev("f-01", "round.started"), {
    canWrite: false,
    miss: [missRow("f-01", "round.started", 2, ago(3 * HOUR))]
  });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /run receipts are switched off \(the app cannot write them\)/);
  assert.match(r.suggestedFix, /GRANT INSERT, UPDATE/);
});

test("c: a miss beats a good old run: the newest event still has nothing behind it", async () => {
  const r = await one(ev("f-01", "round.started"), {
    runs: [runRow("f-01", { started: ago(2 * DAY) })],
    miss: [missRow("f-01", "round.started", 1, ago(3 * HOUR))]
  });
  assert.equal(r.status, "FAIL");
});

/* ═════ d. a run that started and never finished ═════ */

test("d: a workflow that does not sleep, with a run open over 30 minutes: FAIL 'started, never finished'", async () => {
  const r = await one(ev("s-00-welcome", "entry.captured"), {
    runs: [runRow("s-00-welcome", { started: ago(45 * MIN), finished: null })]
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^1 run started and never finished\. The oldest began 2026-10-12 16:15 UTC\. This workflow should finish in 30 minutes\.$/);
  assert.match(r.customerSees, /stopped part of the way/);
  assert.equal(OPEN_LIMIT_MS, 30 * MIN);
});

test("d (its twin): the same run open for 10 minutes is still running: PASS", async () => {
  const r = await one(ev("s-00-welcome", "entry.captured"), {
    runs: [runRow("s-00-welcome", { started: ago(10 * MIN), finished: null })]
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /1 run is still running/);
});

test("d: a sleeper inside its wait is PASS 'asleep, waits by design'", async () => {
  const r = await one(ev("ar-collections", "payment.received"), {
    runs: [runRow("ar-collections", { started: ago(6 * DAY), finished: null })]
  });
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /1 run is asleep \(the oldest began 2026-10-06 17:00 UTC\)\. It waits by design, up to 14 days\.$/);
});

test("d: a sleeper past its longest wait plus one day is FAIL; one day short of that is still PASS", async () => {
  const wait = SLEEPERS["ar-collections"];
  assert.equal(wait, 14 * DAY);
  const lost = await one(ev("ar-collections", "payment.received"), {
    runs: [runRow("ar-collections", { started: ago(wait + SLEEPER_SLACK_MS + HOUR), finished: null })]
  });
  assert.equal(lost.status, "FAIL");
  assert.match(lost.detail, /^1 run has been asleep too long\. The oldest began .* The longest wait for this workflow is 14 days\.$/);
  const fine = await one(ev("ar-collections", "payment.received"), {
    runs: [runRow("ar-collections", { started: ago(wait + SLEEPER_SLACK_MS - HOUR), finished: null })]
  });
  assert.equal(fine.status, "PASS");
});

test("d: a sleeper is NOT failed at 30 minutes (that rule is for workflows that do not sleep)", async () => {
  const r = await one(ev("s-02-incomplete-survey-nudge", "entry.captured"), {
    runs: [runRow("s-02-incomplete-survey-nudge", { started: ago(45 * MIN), finished: null })]
  });
  assert.equal(r.status, "PASS");
  assert.equal(SLEEPERS["s-02-incomplete-survey-nudge"], 1 * HOUR);
  const lost = await one(ev("s-02-incomplete-survey-nudge", "entry.captured"), {
    runs: [runRow("s-02-incomplete-survey-nudge", { started: ago(1 * HOUR + SLEEPER_SLACK_MS + MIN), finished: null })]
  });
  assert.equal(lost.status, "FAIL");
});

test("d: a run that has a finish row is not open, even if its first attempt has no finish", async () => {
  // The read hands back one row per run (the newest finished attempt wins), so a run that ended is finished.
  const r = await one(ev("s-00-welcome", "entry.captured"), {
    runs: [runRow("s-00-welcome", { started: ago(5 * HOUR), attempt: 2 })]
  });
  assert.equal(r.status, "PASS");
});

test("d: a lost run is red even when another run finished ok after it", async () => {
  const r = await one(ev("s-00-welcome", "entry.captured"), {
    runs: [
      runRow("s-00-welcome", { started: ago(5 * HOUR), finished: null }),
      runRow("s-00-welcome", { started: ago(1 * HOUR) })
    ]
  });
  assert.equal(r.status, "FAIL");
});

/* ═════ e. every run skipped ═════ */

test("e: the last 3 runs all skipped: FAIL 'every run skipped', with the reason", async () => {
  const r = await one(ev("document-vault-chase-x", "docs.received"), {
    runs: [1, 2, 3].map((i) => runRow("document-vault-chase-x", { started: ago(i * HOUR), skipped: true, note: "switched_off" }))
  });
  assert.equal(r.status, "FAIL");
  assert.equal(r.detail, "Every run skipped: switched_off. Its last 3 runs all ran and did nothing.");
  assert.match(r.customerSees, /running and doing nothing/);
});

test("e (its twin): 3 runs where one did the work is PASS; only 2 skipped runs is PASS", async () => {
  const mixed = await one(ev("x", "round.started"), {
    runs: [
      runRow("x", { started: ago(1 * HOUR), skipped: true, note: "n" }),
      runRow("x", { started: ago(2 * HOUR) }),
      runRow("x", { started: ago(3 * HOUR), skipped: true, note: "n" })
    ]
  });
  assert.equal(mixed.status, "PASS");
  const two = await one(ev("x", "round.started"), {
    runs: [runRow("x", { started: ago(1 * HOUR), skipped: true }), runRow("x", { started: ago(2 * HOUR), skipped: true })]
  });
  assert.equal(two.status, "PASS");
});

test("e: skipped runs with no saved reason say so", async () => {
  const r = await one(ev("x", "round.started"), {
    runs: [1, 2, 3].map((i) => runRow("x", { started: ago(i * HOUR), skipped: true }))
  });
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /^Every run skipped \(no reason was saved\)\./);
});

/* ═════ h. an event came and the receipts cannot judge it ═════ */

test("h: the receipts table cannot be read (42P01): events came, so the row is skip with the reason; no events is still na", async () => {
  const missing = Object.assign(new Error('relation "workflow_runs" does not exist'), { code: "42P01" });
  const rows = await checkWorkflowRuns({
    db: fakeDb({ events: { "round.started": { n: 3, first: new Date("2026-10-11T08:00:00Z") } }, runsError: missing }),
    now: NOW,
    functions: [ev("f-01", "round.started"), ev("f-07", "round.funded")]
  });
  const r = find(rows, "f-01");
  assert.equal(r.status, "skip");
  assert.equal(r.na, undefined);
  assert.equal(
    r.detail,
    "3 round.started events came since 2026-10-09 (first 2026-10-11 08:00 UTC), but run receipts could not be read: the workflow_runs table does not exist yet (42P01). This workflow was not judged."
  );
  assert.equal(find(rows, "f-07").status, "na", "no event came: still nothing to judge");
});

test("h: receipts have no start marker: skip, not a guess", async () => {
  const r = await one(ev("f-01", "round.started"), { events: { "round.started": { n: 1 } }, began: null });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /^1 round\.started event came since 2026-10-09 \(first .*\), but run receipts have no start marker/);
});

test("h: the app cannot write receipts and an event came: skip 'switched off'", async () => {
  const r = await one(ev("f-01", "round.started"), { events: { "round.started": { n: 1 } }, canWrite: false });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /run receipts are switched off/);
});

test("h: the event came BEFORE receipts began and receipts are under a day old: skip, honest about why", async () => {
  const r = await one(ev("ar-collections", "payment.received"), {
    events: { "payment.received": { n: 6, first: new Date("2026-10-12T07:05:00Z"), last: new Date("2026-10-12T07:07:00Z") } },
    began: new Date("2026-10-12T14:00:00Z")
  });
  assert.equal(r.status, "skip");
  assert.equal(r.na, undefined);
  assert.equal(
    r.detail,
    "6 payment.received events came since 2026-10-09 (first 2026-10-12 07:05 UTC), before run receipts began (2026-10-12 14:00 UTC). Nothing says whether it ran. It is judged from the next event, or once receipts are a day old."
  );
});

test("h: the event came before receipts began and receipts are over a day old: na no-demand, claimed from the day receipts began", async () => {
  const began = new Date("2026-10-10T20:00:00Z");
  const floor = new Date(began.getTime() + RECEIPTS_GRACE_MS);
  const r = await one(ev("ar-collections", "payment.received"), {
    events: { "payment.received": { n: 6, first: new Date("2026-10-10T07:05:00Z"), last: new Date("2026-10-10T07:07:00Z") } },
    began
  });
  assert.equal(r.status, "na");
  assert.deepEqual(r.na, { code: "no-demand", args: { names: ["payment.received"], since: floor.toISOString() } });
  assert.equal(r.detail, "No payment.received event came since 2026-10-10, when run receipts began. Judged the day one comes.");
  // The window is at least a day long, which is the audit's own floor.
  assert.ok(NOW.getTime() - floor.getTime() >= DAY);
});

test("h: an event younger than 15 minutes, after receipts began, is pending (PASS), not 'never started'", async () => {
  const r = await one(ev("f-01", "round.started"), {
    events: { "round.started": { n: 1, first: ago(6 * MIN), last: ago(6 * MIN) } }
  });
  assert.equal(r.status, "PASS");
  assert.equal(r.detail, "1 round.started event came 6 minutes ago. The workflow has 15 minutes to start.");
  assert.equal(START_GRACE_MS, 15 * MIN);
});

test("h: an event that came after receipts began, is old, has no miss and no run: skip, never green", async () => {
  const r = await one(ev("f-01", "round.started"), { events: { "round.started": { n: 1, first: ago(3 * HOUR), last: ago(3 * HOUR) } } });
  assert.equal(r.status, "skip");
  assert.match(r.detail, /no receipt could be matched to it/);
});

test("the events read failed: skip with the error, and dark rows stay na", async () => {
  const db = fakeDb({ eventsError: new Error("connection terminated") });
  const rows = await checkWorkflowRuns({ db, now: NOW, functions: [ev("f-01", "round.started"), dark("n-01")] });
  const r = find(rows, "f-01");
  assert.equal(r.status, "skip");
  assert.equal(r.na, undefined);
  assert.match(r.detail, /^Events could not be read: connection terminated\. This workflow was not judged\.$/);
  assert.equal(find(rows, "n-01").status, "na");
});

test("the events read failed but the receipts say it FAILED: the red is not hidden", async () => {
  const db = fakeDb({
    eventsError: new Error("connection terminated"),
    runs: [runRow("f-01", { started: ago(3 * HOUR), outcome: "error", final: true, error: "boom" })]
  });
  const [r] = await checkWorkflowRuns({ db, now: NOW, functions: [ev("f-01", "round.started")] });
  assert.equal(r.status, "FAIL");
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
  const rows = await checkWorkflowRuns({ db: fakeDb(), now: NOW });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "skip");
});

/* ═════ the reads ═════ */

test("two reads for every function: one events read and one runs read, both plain SELECTs", async () => {
  const db = fakeDb({ events: { "round.started": { n: 1 } } });
  await checkWorkflowRuns({
    db,
    now: NOW,
    functions: [ev("a", "round.started"), ev("b", "round.started", "round.funded"), ev("c", "booking.created"), dark("d")]
  });
  assert.equal(db.calls.length, 2);
  const events = db.calls.find((c) => c.sql === EVENTS_SQL);
  const runs = db.calls.find((c) => c.sql === RUNS_SQL);
  assert.ok(events && runs);
  assert.deepEqual(events.params[0].sort(), ["booking.created", "round.funded", "round.started"]);
  assert.equal(events.params[1], new Date(NOW.getTime() - WORKFLOW_SINCE_DAYS * DAY).toISOString());
  // One (workflow, event name) pair per trigger: a, b+b, c.
  assert.deepEqual(runs.params[0], ["a", "b", "b", "c"]);
  assert.deepEqual(runs.params[1], ["round.started", "round.started", "round.funded", "booking.created"]);
  // The runs read asks about events up to 15 minutes ago, and runs from 30 days ago.
  assert.equal(runs.params[3], new Date(NOW.getTime() - 15 * MIN).toISOString());
  assert.equal(runs.params[4], new Date(NOW.getTime() - 30 * DAY).toISOString());
  assert.equal(runs.params[6], 60, "an hour of grace after the receipts marker");
  for (const sql of [EVENTS_SQL, RUNS_SQL]) {
    assert.match(sql, /^\s*(WITH|SELECT)/i);
    assert.doesNotMatch(sql.replace(/'[^']*'/g, "''"), /\b(insert|update|delete|drop|alter|truncate|begin|commit|set)\b/i);
  }
  assert.match(RUNS_SQL, new RegExp(`function_id <> '${RECORDER_FUNCTION_ID}'`));
});

test("the unfinished-runs window reaches back past the longest sleeper (180 days) when a sleeper is in the list", async () => {
  const db = fakeDb();
  await checkWorkflowRuns({ db, now: NOW, functions: [ev("n-06-renewal-second-wave", "round.funded")] });
  const runs = db.calls.find((c) => c.sql === RUNS_SQL);
  assert.equal(runs.params[5], new Date(NOW.getTime() - (180 * DAY + SLEEPER_SLACK_MS)).toISOString());
  const plain = fakeDb();
  await checkWorkflowRuns({ db: plain, now: NOW, functions: [ev("s-00-welcome", "entry.captured")] });
  assert.equal(plain.calls.find((c) => c.sql === RUNS_SQL).params[5], new Date(NOW.getTime() - 30 * DAY).toISOString());
});

test("the staff scope is used for both reads when the pulse hands one over", async () => {
  const db = { query: async () => { throw new Error("the plain pool must not be used"); } };
  let scoped = 0;
  const inner = fakeDb({ events: { "round.started": { n: 2 } }, began: null });
  const scope = (fn) => {
    scoped += 1;
    return fn(inner);
  };
  const [r] = await checkWorkflowRuns({ db, scope, now: NOW, functions: [ev("f-01", "round.started")] });
  assert.equal(scoped, 2);
  assert.equal(r.status, "skip");
});

/* ═════ shape ═════ */

test("every na row carries a code and plain-JSON args; every other row carries none", async () => {
  const rows = await checkWorkflowRuns({
    db: fakeDb({ events: { "round.funded": { n: 1 } }, began: null }),
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
  assert.equal(workflowSince(NOW).toISOString(), "2026-10-09T17:00:00.000Z");
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

/* ═════ SLEEPERS stay true ═════ */

const WF_DIR = fileURLToPath(new URL("../workflows/", import.meta.url));
const STEP_WAIT = /\bstep\s*\.\s*(sleep|sleepUntil|waitForEvent)\b/;
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* Functions that live in a file that has a sleep, but whose own handler never sleeps. Each one needs a reason. */
const SAME_FILE_NEVER_SLEEPS = Object.freeze({
  "slo-genuine-reply": "Same file as slo-genuine-followup. Only handleM1 (followup) calls step.sleep; handleReply does not.",
  "slo-genuine-checkout-sms": "Same file as slo-genuine-followup. Only handleM1 (followup) calls step.sleep; handleCheckoutM1Sms does not."
});

test("SLEEPERS: every event workflow that calls step.sleep, sleepUntil or waitForEvent is on the map, and nothing else is", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const files = readdirSync(WF_DIR).filter((f) => f.endsWith(".mjs") && !f.endsWith(".test.mjs"));
  const text = Object.fromEntries(files.map((f) => [f, stripComments(readFileSync(WF_DIR + f, "utf8"))]));
  const importsOf = (f) => [...text[f].matchAll(/from\s+["']\.\/([^"']+\.mjs)["']/g)].map((m) => m[1]).filter((x) => text[x]);
  const reaches = (f, seen = new Set()) => {
    if (seen.has(f)) return false;
    seen.add(f);
    return STEP_WAIT.test(text[f]) || importsOf(f).some((g) => reaches(g, seen));
  };
  const eventFns = functions.map(workflowTriggers).filter((t) => t.events.length > 0);
  assert.ok(eventFns.length >= 60, "the bundle has about 62 event workflows");
  const candidates = [];
  for (const t of eventFns) {
    const esc = t.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const owners = files.filter((f) => new RegExp(`\\bid:\\s*["'\`]${esc}["'\`]`).test(text[f]));
    assert.equal(owners.length, 1, `${t.id}: its source file was found once (${owners.join(", ")})`);
    if (reaches(owners[0])) candidates.push(t.id);
  }
  const sleepers = candidates.filter((id) => !Object.prototype.hasOwnProperty.call(SAME_FILE_NEVER_SLEEPS, id)).sort();
  assert.deepEqual(sleepers, Object.keys(SLEEPERS).sort(), "SLEEPERS lists exactly the event workflows that sleep");
  for (const [id, why] of Object.entries(SAME_FILE_NEVER_SLEEPS)) {
    assert.ok(candidates.includes(id), `${id}: still shares a file with a sleeper, or take it off the list`);
    assert.ok(why.length >= 40, id);
  }
  for (const [id, ms] of Object.entries(SLEEPERS)) {
    assert.ok(Number.isFinite(ms) && ms > 0, id);
  }
  assert.ok(Object.isFrozen(SLEEPERS));
});

test("SLEEPERS: a workflow with cancelOn (its run can be cancelled mid-sleep and stay open) is on the map", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const cancellable = functions.filter((fn) => fn.opts.cancelOn).map((fn) => fn.opts.id);
  assert.ok(cancellable.length >= 6, "the bundle has workflows with cancelOn");
  for (const id of cancellable) assert.ok(Object.prototype.hasOwnProperty.call(SLEEPERS, id), `${id} has cancelOn but is not on SLEEPERS`);
});

/* ═════ the real bundle ═════ */

test("today's bundle: 65 wf: rows, ids unique; with no events and no runs, 62 nothing-to-judge and 3 dark", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const rows = await checkWorkflowRuns({ db: fakeDb(), now: NOW, functions });
  assert.equal(rows.length, 65);
  assert.equal(new Set(rows.map((r) => r.id)).size, 65);
  assert.ok(rows.every((r) => r.id.startsWith("wf:")));
  const dim = rows.filter((r) => r.na?.code === "no-trigger").map((r) => r.id).sort();
  assert.deepEqual(dim, ["wf:n-01-cold-nurture", "wf:n-02-warm-nurture", "wf:n-03-hot-nurture"]);
  assert.equal(rows.filter((r) => r.na?.code === "no-demand").length, 62);
  assert.equal(rows.filter((r) => r.status === "skip").length, 0);
});

test("today's bundle, the day after receipts ship: the five workflows that were handed work on 10-07 are skip (before receipts), the rest nothing to judge", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const began = new Date("2026-10-10T19:00:00Z");
  const now = new Date("2026-10-11T13:00:00Z");
  const rows = await checkWorkflowRuns({
    db: fakeDb({
      events: {
        "payment.received": { n: 6, first: new Date("2026-10-09T07:05:57Z"), last: new Date("2026-10-09T07:07:28Z") },
        "message.inbound": { n: 1, first: new Date("2026-10-09T16:50:07Z"), last: new Date("2026-10-09T16:50:07Z") }
      },
      began
    }),
    now,
    functions
  });
  const skipped = rows.filter((r) => r.status === "skip").map((r) => r.id).sort();
  assert.deepEqual(skipped, [
    "wf:ar-collections", "wf:dpc-03-inbound-reply-router", "wf:ds-02-diy-letters", "wf:slo-genuine-reply", "wf:slo-paid-form-nudge"
  ]);
  for (const r of rows.filter((x) => x.status === "skip")) assert.match(r.detail, /before run receipts began/);
  assert.equal(rows.filter((r) => r.status === "na").length, 60);
});

test("today's bundle: once each of those five has a run behind it, every one is PASS", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const five = ["ar-collections", "dpc-03-inbound-reply-router", "ds-02-diy-letters", "slo-genuine-reply", "slo-paid-form-nudge"];
  const rows = await checkWorkflowRuns({
    db: fakeDb({
      events: { "payment.received": { n: 1 }, "message.inbound": { n: 1 } },
      runs: five.map((id) => runRow(id, { started: ago(HOUR) }))
    }),
    now: NOW,
    functions
  });
  for (const id of five) assert.equal(find(rows, id).status, "PASS", id);
});

test("today's bundle with a missed round.started event: exactly the round.started workflows turn FAIL", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const wake = functions.filter((fn) => workflowTriggers(fn).events.includes("round.started")).map((fn) => workflowTriggers(fn).id).sort();
  assert.ok(wake.length >= 3, "the bundle has several round.started workflows");
  const rows = await checkWorkflowRuns({
    db: fakeDb({ miss: wake.map((id) => missRow(id, "round.started", 1, ago(3 * HOUR))) }),
    now: NOW,
    functions
  });
  const red = rows.filter((r) => r.status === "FAIL").map((r) => r.id.slice(3)).sort();
  assert.deepEqual(red, wake);
  assert.equal(rows.length, 65);
});

test("today's bundle: two reads, under a second against a fake database, 22 trigger names", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const db = fakeDb();
  const t0 = Date.now();
  await checkWorkflowRuns({ db, now: NOW, functions });
  assert.equal(db.calls.length, 2);
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(db.calls.find((c) => c.sql === EVENTS_SQL).params[0].length, 22, "22 distinct trigger names in the bundle today");
});

/* ═════ the audit agrees with every nothing-to-judge row ═════ */

test("every na row this check makes passes the audit's own re-check (verifyNa), on the real bundle", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const { verifyNa } = await import("./na-conditions.mjs");
  // The events table: payment.received 4 days ago (before the 3-day window), nothing since.
  const eventTimes = { "payment.received": [new Date(NOW.getTime() - 4 * DAY)] };
  const eventsDb = {
    async query(sql, params) {
      assert.match(sql, /FROM events/);
      const since = new Date(params[0]);
      const rows = Object.entries(eventTimes)
        .map(([name, times]) => ({ name, n: times.filter((t) => t > since).length }))
        .filter((r) => r.n > 0);
      return { rows };
    }
  };
  const rows = await checkWorkflowRuns({ db: fakeDb({ events: {}, began: new Date(NOW.getTime() - 2 * DAY) }), now: NOW, functions });
  const naRows = rows.filter((r) => r.status === "na");
  assert.equal(naRows.length, 65);
  for (const r of naRows) {
    const res = await verifyNa(r, { db: eventsDb, now: NOW, functions });
    assert.equal(res.ok, true, `${r.id}: ${res.reason}`);
  }
});

test("the receipts-began nothing-to-judge claim also passes verifyNa, and fails it the moment an event arrives after receipts began", async () => {
  const { verifyNa } = await import("./na-conditions.mjs");
  const fn = ev("ar-collections", "payment.received");
  const began = new Date(NOW.getTime() - 2 * DAY);
  const floor = new Date(began.getTime() + RECEIPTS_GRACE_MS);
  const four = new Date(NOW.getTime() - 4 * DAY);
  const [r] = await checkWorkflowRuns({
    db: fakeDb({ events: { "payment.received": { n: 1, first: four, last: four } }, began }),
    now: NOW,
    functions: [fn]
  });
  assert.equal(r.status, "na");
  assert.equal(r.na.args.since, floor.toISOString());
  const dbWith = (times) => ({
    async query(sql, params) {
      const since = new Date(params[0]);
      const n = times.filter((t) => t > since).length;
      return { rows: n ? [{ name: "payment.received", n }] : [] };
    }
  });
  const quiet = await verifyNa(r, { db: dbWith([four]), now: NOW, functions: [fn] });
  assert.equal(quiet.ok, true, quiet.reason);
  const busy = await verifyNa(r, { db: dbWith([four, new Date(NOW.getTime() - 3 * HOUR)]), now: NOW, functions: [fn] });
  assert.equal(busy.ok, false);
});
