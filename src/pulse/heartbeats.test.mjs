import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cronIntervalMs, checkJobHeartbeats, STALE_MULTIPLE, INNGEST_JOBS, NETLIFY_JOBS } from "./heartbeats.mjs";

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
