import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALLOWED_UNMONITORED, PULSE_REGISTRY } from "../registry.mjs";
import {
  AGENT_CODE,
  CHECKS,
  CRON,
  LATEST_RUN_SQL,
  RED_AFTER_MORNINGS,
  SLICE_ID,
  TRIGGER_EVENT,
  missedMornings,
  readLatestAgentRun,
  runIsRed
} from "./slice-02-daily-pulse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SLICE_SRC = readFileSync(path.join(HERE, "slice-02-daily-pulse.mjs"), "utf8");
const SCRIPT_SRC = readFileSync(path.join(HERE, "../../../scripts/daily-pulse.mjs"), "utf8");
const PULSE_SRC = readFileSync(path.join(HERE, "../daily-pulse.mjs"), "utf8");

test("slice id and cron match the live 6:00 a.m. Arizona pulse", () => {
  assert.equal(SLICE_ID, "02-daily-pulse");
  assert.equal(CRON, "TZ=America/Phoenix 0 6 * * *");
  assert.equal(RED_AFTER_MORNINGS, 3);
  assert.equal(AGENT_CODE, "AG-07");
  assert.equal(TRIGGER_EVENT, "cron.daily-pulse");
});

test("CHECKS ids are non-empty and unique", () => {
  assert.ok(CHECKS.length > 0);
  const ids = CHECKS.map((c) => c.id);
  for (const id of ids) {
    assert.equal(typeof id, "string");
    assert.ok(id.trim().length > 0);
  }
  assert.equal(new Set(ids).size, ids.length);
});

test("every check has id, schedule, redAfter, alreadyInRegistry, and proof", () => {
  for (const c of CHECKS) {
    assert.equal(typeof c.id, "string");
    assert.equal(typeof c.schedule, "string");
    assert.equal(typeof c.redAfter, "string");
    assert.equal(typeof c.alreadyInRegistry, "boolean");
    assert.equal(typeof c.proof, "string");
    assert.ok(c.schedule.trim().length > 0);
    assert.ok(c.redAfter.trim().length > 0);
    assert.ok(c.proof.trim().length > 0);
    assert.equal(c.alreadyInRegistry, false);
  }
  const run = CHECKS.find((c) => c.id === "ag-07-cron-daily-pulse");
  assert.ok(run);
  assert.equal(run.schedule, "TZ=America/Phoenix 0 6 * * *");
  assert.match(run.redAfter, /3 mornings/);
  assert.match(run.proof, /BEGIN READ ONLY/);
  assert.match(run.proof, /ROLLBACK/);
  assert.match(run.proof, /AG-07/);
  assert.match(run.proof, /cron\.daily-pulse/);
});

test("the daily pulse cron is not a registry ping", () => {
  const covered = PULSE_REGISTRY.map((row) => `${row.id} ${row.path || ""}`).join("\n");
  assert.doesNotMatch(covered, /daily-pulse/);
  assert.doesNotMatch(covered, /cron\.daily-pulse/);
  assert.doesNotMatch(covered, /AG-07/);
  assert.match(ALLOWED_UNMONITORED.inngest, /daily-pulse/);
});

test("script dry-run is the default and the pulse never fixes", () => {
  assert.match(SCRIPT_SRC, /dryRun:\s*!argv\.includes\("--live"\)/);
  assert.match(SCRIPT_SRC, /BEGIN READ ONLY/);
  assert.match(SCRIPT_SRC, /ROLLBACK/);
  assert.match(PULSE_SRC, /autoFix:\s*false/);
  const dry = CHECKS.find((c) => c.id === "script-dry-run-default");
  const fix = CHECKS.find((c) => c.id === "pulse-never-fixes");
  assert.ok(dry);
  assert.ok(fix);
  assert.match(dry.proof, /dry-run/);
  assert.match(fix.proof, /autoFix false/);
});

test("this slice does not send a text or print a secret", () => {
  assert.doesNotMatch(SLICE_SRC, /from ["'][^"']*(notify|twilio)/);
  assert.doesNotMatch(SLICE_SRC, /\b(textChris|ticketDarwin|sendSms|sendWhatsApp)\s*\(/);
  assert.doesNotMatch(SLICE_SRC, /console\.(log|info|debug|error|warn)/);
  assert.doesNotMatch(SLICE_SRC, /process\.env/);
  assert.doesNotMatch(SLICE_SRC, /query\(\s*["']COMMIT/);
  const quiet = CHECKS.find((c) => c.id === "proof-does-not-text");
  assert.ok(quiet);
  assert.match(quiet.proof, /Do not send a text/);
  assert.match(quiet.proof, /Do not print secrets/);
});

test("SELECT runs only inside BEGIN READ ONLY then ROLLBACK", async () => {
  const sql = [];
  const row = {
    created_at: new Date("2026-10-07T13:01:00Z"),
    outcome: "pass",
    mode: "live",
    trigger_event: "cron.daily-pulse"
  };
  const client = {
    query: async (text, params) => {
      sql.push(text);
      if (text === LATEST_RUN_SQL) {
        assert.deepEqual(params, ["AG-07", "cron.daily-pulse"]);
        return { rows: [row] };
      }
      return { rows: [] };
    }
  };
  const got = await readLatestAgentRun(client);
  assert.equal(got, row);
  assert.deepEqual(sql, ["BEGIN READ ONLY", LATEST_RUN_SQL, "ROLLBACK"]);
  assert.match(LATEST_RUN_SQL, /^SELECT\b/);
  assert.doesNotMatch(LATEST_RUN_SQL, /detail|token|secret|password/i);
});

test("a failed SELECT still rolls back", async () => {
  const sql = [];
  const client = {
    query: async (text) => {
      sql.push(text);
      if (text === LATEST_RUN_SQL) throw new Error("read failed");
      return { rows: [] };
    }
  };
  await assert.rejects(() => readLatestAgentRun(client), /read failed/);
  assert.deepEqual(sql, ["BEGIN READ ONLY", LATEST_RUN_SQL, "ROLLBACK"]);
});

test("red when the AG-07 run is missing for 3 Arizona mornings", () => {
  const sunday = new Date("2026-11-01T13:00:00Z");
  const wednesdayMorning = new Date("2026-11-04T13:05:00Z");
  const wednesdayBefore = new Date("2026-11-04T12:30:00Z");
  assert.equal(missedMornings(sunday, wednesdayMorning), 3);
  assert.equal(runIsRed(sunday, wednesdayMorning), true);
  assert.equal(missedMornings(sunday, wednesdayBefore), 2);
  assert.equal(runIsRed(sunday, wednesdayBefore), false);

  const sameMorning = new Date("2026-10-05T13:02:00Z");
  const laterThatDay = new Date("2026-10-05T18:00:00Z");
  assert.equal(missedMornings(sameMorning, laterThatDay), 0);
  assert.equal(runIsRed(sameMorning, laterThatDay), false);

  const monday = new Date("2026-11-02T14:00:00Z");
  assert.equal(missedMornings(monday, wednesdayMorning), 2);
  assert.equal(runIsRed(monday, wednesdayMorning), false);

  assert.equal(missedMornings(null, wednesdayMorning), null);
  assert.equal(runIsRed(null, wednesdayMorning), true);
});
