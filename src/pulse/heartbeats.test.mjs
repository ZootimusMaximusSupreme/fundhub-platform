import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cronIntervalMs, checkJobHeartbeats, STALE_MULTIPLE, INNGEST_JOBS, NETLIFY_JOBS, JOBS } from "./heartbeats.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("a job is red when its newest run is older than 3 times its schedule", async () => {
  assert.equal(STALE_MULTIPLE, 3);
  const now = new Date("2026-10-07T13:00:00Z");
  const hour = cronIntervalMs("0 * * * *");
  assert.equal(hour, 60 * 60 * 1000);
  const late = new Date(now.getTime() - 4 * hour);
  const fresh = new Date(now.getTime() - hour);
  const db = {
    query: async (sql) => {
      if (!String(sql).includes("GROUP BY")) return { rows: [{ first_ever: late.toISOString() }] };
      return {
        rows: [
          { job: "late-one", last_at: late.toISOString(), last_outcome: "ok", last_error: null, first_ever: late.toISOString() },
          { job: "fresh-one", last_at: fresh.toISOString(), last_outcome: "ok", last_error: null, first_ever: late.toISOString() }
        ]
      };
    }
  };
  const jobs = [
    { job: "late-one", cron: "0 * * * *", runner: "inngest" },
    { job: "fresh-one", cron: "0 * * * *", runner: "inngest" }
  ];
  const rows = await checkJobHeartbeats({ db, now, jobs });
  assert.equal(rows.find((r) => r.id === "job:late-one").status, "FAIL");
  assert.equal(rows.find((r) => r.id === "job:fresh-one").status, "PASS");
  assert.match(rows.find((r) => r.id === "job:late-one").suggestedFix, /Do not re-run/);
});

/* A fake job_heartbeats reader: `rows` is the per-job answer, `firstEver` is
   min(finished_at) over the whole table. */
function heartbeatDb({ rows = [], firstEver }) {
  return {
    query: async (sql) => (String(sql).includes("GROUP BY")
      ? { rows }
      : { rows: [{ first_ever: firstEver }] })
  };
}

test("a monthly job whose last due time came before receipts began says nothing to judge, with a code the audit can re-check", async () => {
  // Receipts began 2026-10-07 20:08 UTC. Both monthly jobs were last due on 2026-10-01.
  const now = new Date("2026-10-09T17:00:00Z");
  const db = heartbeatDb({ firstEver: "2026-10-07T20:08:00Z" });
  const jobs = JOBS.filter((j) => j.job === "affiliate-payout-run" || j.job === "partner-production-floor");
  assert.equal(jobs.length, 2);
  const rows = await checkJobHeartbeats({ db, now, jobs });
  for (const r of rows) {
    assert.equal(r.status, "na", r.id);
    assert.deepEqual(r.na, { code: "monthly-not-due", args: { cron: jobs.find((j) => `job:${j.job}` === r.id).cron } });
    assert.match(r.detail, /^Runs once a month\. Its last due time came before receipts began\. First judged after 2026-11-01\.$/);
    assert.equal(r.group, "jobs");
  }
});

test("the na code is only used when its own condition holds: receipts must have begun AFTER the last due time", async () => {
  const cron = "0 3 1 * *";
  const job = [{ job: "affiliate-payout-run", cron, runner: "inngest" }];
  // 10 hours after the due time of 2026-11-01 03:00 UTC, receipts began 2026-10-07. The run is
  // simply not in yet, so the audit's re-check (first receipt later than the due time) would say no.
  const inGrace = await checkJobHeartbeats({
    db: heartbeatDb({ firstEver: "2026-10-07T20:08:00Z" }),
    now: new Date("2026-11-01T13:00:00Z"),
    jobs: job
  });
  assert.equal(inGrace[0].status, "skip");
  assert.equal(inGrace[0].na, undefined);
  // Past the one-day grace with no run, receipts older than the due time: a real red, as before.
  const late = await checkJobHeartbeats({
    db: heartbeatDb({ firstEver: "2026-10-07T20:08:00Z" }),
    now: new Date("2026-11-03T13:00:00Z"),
    jobs: job
  });
  assert.equal(late[0].status, "FAIL");
  assert.equal(late[0].na, undefined);
});

test("a job that ran this month is judged on its run, never na", async () => {
  const now = new Date("2026-10-09T17:00:00Z");
  const db = heartbeatDb({
    firstEver: "2026-10-01T00:00:00Z",
    rows: [{ job: "affiliate-payout-run", last_at: "2026-10-01T03:00:20Z", last_outcome: "ok", last_error: null, first_ever: "2026-10-01T00:00:00Z" }]
  });
  const rows = await checkJobHeartbeats({ db, now, jobs: [{ job: "affiliate-payout-run", cron: "0 3 1 * *", runner: "inngest" }] });
  assert.equal(rows[0].status, "PASS");
  assert.equal(rows[0].na, undefined);
});

test("a job on a frequent clock that is too soon to judge stays a skip, exactly as before", async () => {
  const now = new Date("2026-10-09T17:00:00Z");
  const rows = await checkJobHeartbeats({
    db: heartbeatDb({ firstEver: "2026-10-09T16:30:00Z" }),
    now,
    jobs: [{ job: "hourly-one", cron: "0 * * * *", runner: "inngest" }]
  });
  assert.equal(rows[0].status, "skip");
  assert.equal(rows[0].na, undefined);
  assert.match(rows[0].detail, /too soon to expect one/);
});

test("an Arizona cron still has a one-day gap", () => {
  assert.equal(cronIntervalMs("TZ=America/Phoenix 0 6 * * *"), 24 * 60 * 60 * 1000);
});

test("the heartbeat list matches the scheduled jobs, and it never fixes them", async () => {
  const { functions } = await import("../workflows/index.mjs");
  const live = [];
  for (const fn of functions) {
    const id = fn.id();
    for (const trigger of fn.opts?.triggers || []) {
      if (trigger && trigger.cron) live.push([id, trigger.cron]);
    }
  }
  const listed = new Map(INNGEST_JOBS);
  assert.equal(listed.size, live.length);
  for (const [id, cron] of live) assert.equal(listed.get(id), cron, id);

  const scheduled = netlifySchedules(fs.readFileSync(path.resolve(HERE, "../../netlify.toml"), "utf8"));
  const netlify = new Map(NETLIFY_JOBS);
  assert.deepEqual(
    [...netlify.keys()].sort(),
    scheduled.map(([name]) => name).sort(),
    "NETLIFY_JOBS must name every scheduled function in netlify.toml, and no extra"
  );
  for (const [name, cron] of scheduled) {
    assert.equal(netlify.get(name), cron, name);
    const src = fs.readFileSync(path.resolve(HERE, `../../netlify/functions/${name}.mjs`), "utf8");
    assert.ok(
      src.includes(`noteScheduledRun(db, "${name}"`),
      `${name} is on the Netlify clock but does not write a heartbeat`
    );
  }
});

function netlifySchedules(toml) {
  const jobs = [];
  let name = null;
  for (const line of toml.split("\n")) {
    const header = line.match(/^\[functions\."([^"]+)"\]/);
    if (header) {
      name = header[1];
      continue;
    }
    if (name && line.startsWith("[")) {
      name = null;
      continue;
    }
    if (!name) continue;
    const sched = line.match(/^\s*schedule\s*=\s*"([^"]+)"/);
    if (sched) {
      jobs.push([name, sched[1]]);
      name = null;
    }
  }
  return jobs;
}
