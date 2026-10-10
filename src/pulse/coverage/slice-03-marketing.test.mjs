// Marketing heartbeat slice — fakes only. No database, no texts, no auto-fix.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BEATS_SQL,
  CHECKS,
  CLOCK_INTERVAL_MS,
  RED_MULTIPLIER,
  SLICE_ID,
  beatsFromRows,
  checkClock,
  checkMarketing,
  checkOutboxDrain,
  checkPageSeen,
  checkWorker,
  redAfterMs,
  scheduleMs
} from "./slice-03-marketing.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const NOW = new Date("2026-10-06T13:00:00Z");

const NO_WORK = { outbox_waiting: 0, buzzes_due: 0, jobs_due: 0, stale_claims: 0 };
const WITH_WORK = { outbox_waiting: 2, buzzes_due: 0, jobs_due: 1, stale_claims: 0 };

function ctx(overrides = {}) {
  return {
    now: NOW,
    machineOrgs: 1,
    work: NO_WORK,
    beats: {
      clock: new Date("2026-10-06T12:50:00Z"),
      worker: new Date("2026-10-06T12:50:00Z"),
      page_seen: new Date("2026-10-06T12:00:00Z"),
      outbox_drain: new Date("2026-10-06T12:59:30Z")
    },
    ...overrides
  };
}

test("slice 03-marketing: SLICE_ID and CHECKS metadata", () => {
  assert.equal(SLICE_ID, "03-marketing");
  assert.equal(CHECKS.length, 4);
  assert.deepEqual(CHECKS.map((c) => c.id), ["clock", "worker", "page_seen", "outbox_drain"]);
  for (const row of CHECKS) {
    assert.equal(row.redAfter, `3x ${row.schedule}`);
    assert.match(row.redAfter, /^3x \S+$/);
    assert.equal(typeof row.proof, "string");
    assert.ok(row.proof.length > 20);
  }
  const page = CHECKS.find((c) => c.id === "page_seen");
  assert.equal(page.alreadyInRegistry, true);
  assert.equal(CHECKS.find((c) => c.id === "clock").alreadyInRegistry, false);
});

test("schedule helpers: clock 15m → red after 45m", () => {
  assert.equal(scheduleMs("15m"), CLOCK_INTERVAL_MS);
  assert.equal(redAfterMs("15m"), 45 * 60 * 1000);
  assert.equal(redAfterMs("1m"), RED_MULTIPLIER * 60 * 1000);
  assert.equal(redAfterMs("on-read"), null);
});

test("proof paths name the migration, clock and health sources", () => {
  for (const id of ["415", "clock.mjs", "health.mjs"]) {
    assert.ok(CHECKS.some((c) => c.proof.includes(id)), `expected ${id} in a proof line`);
  }
  assert.ok(fs.existsSync(path.join(ROOT, "db/migrations/415_marketing_heartbeats.sql")));
  assert.ok(fs.existsSync(path.join(ROOT, "src/marketing/clock.mjs")));
  assert.ok(fs.existsSync(path.join(ROOT, "api/marketing/health.mjs")));
});

test("BEATS_SQL is read-only", () => {
  assert.match(BEATS_SQL.trim(), /^SELECT\b/i);
  assert.doesNotMatch(BEATS_SQL, /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|SET)\b/i);
});

test("beatsFromRows maps heartbeat names", () => {
  const beats = beatsFromRows([
    { name: "clock", last_at: "2026-10-06T12:00:00Z" },
    { name: "worker", last_at: "2026-10-06T11:00:00Z" }
  ]);
  assert.ok(beats.clock instanceof Date);
  assert.ok(beats.worker instanceof Date);
  assert.equal(beats.page_seen, null);
});

test("clock: fresh tick is PASS", async () => {
  const r = await checkClock(ctx());
  assert.equal(r.status, "PASS");
  assert.match(r.detail, /12:50 UTC/);
});

test("clock: 50 min ago is FAIL (red after 45 min)", async () => {
  const r = await checkClock(ctx({ beats: { clock: new Date("2026-10-06T12:10:00Z") } }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /50 min ago/);
  assert.match(r.suggestedFix, /Do not auto-fix/);
});

test("clock: no companies is skip", async () => {
  const r = await checkClock(ctx({ machineOrgs: 0 }));
  assert.equal(r.status, "skip");
});

test("worker: no waiting work is a checkable nothing-to-judge row", async () => {
  const r = await checkWorker(ctx());
  assert.equal(r.status, "na");
  assert.deepEqual(r.na, { code: "no-work-waiting", args: { what: "worker" } });
});

test("worker: waiting work and stale beat is FAIL", async () => {
  const r = await checkWorker(ctx({
    work: WITH_WORK,
    beats: { worker: new Date("2026-10-06T11:00:00Z") }
  }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /work is waiting/);
});

test("worker: waiting work and fresh beat is PASS", async () => {
  const r = await checkWorker(ctx({ work: WITH_WORK }));
  assert.equal(r.status, "PASS");
});

test("page_seen is always skip on a timer", async () => {
  const r = await checkPageSeen();
  assert.equal(r.status, "skip");
  assert.match(r.detail, /marketing\/health/);
});

test("outbox_drain: no waiting saves is a checkable nothing-to-judge row", async () => {
  const r = await checkOutboxDrain(ctx());
  assert.equal(r.status, "na");
  assert.deepEqual(r.na, { code: "no-work-waiting", args: { what: "outbox_drain" } });
});

test("outbox_drain: waiting saves and 50 min stale is FAIL (red after 45 min, 3x the 15-min clock)", async () => {
  const r = await checkOutboxDrain(ctx({
    work: { ...NO_WORK, outbox_waiting: 1 },
    beats: { outbox_drain: new Date("2026-10-06T12:10:00Z") }
  }));
  assert.equal(r.status, "FAIL");
  assert.match(r.detail, /red after 45 min/);
});

test("outbox_drain: 15 min since the last clock-tick drain is PASS, not a false alarm", async () => {
  const r = await checkOutboxDrain(ctx({
    work: { ...NO_WORK, outbox_waiting: 13 },
    beats: { outbox_drain: new Date("2026-10-06T12:44:40Z") }
  }));
  assert.equal(r.status, "PASS");
});

test("outbox_drain: waiting saves and 30 s ago is PASS", async () => {
  const r = await checkOutboxDrain(ctx({
    work: { ...NO_WORK, outbox_waiting: 3 },
    beats: { outbox_drain: new Date("2026-10-06T12:59:30Z") }
  }));
  assert.equal(r.status, "PASS");
});

test("checkMarketing without scope skips every row", async () => {
  const rows = await checkMarketing({ scope: null, now: NOW });
  assert.equal(rows.length, CHECKS.length);
  assert.ok(rows.every((r) => r.status === "skip" && r.kind === "marketing"));
});

test("checkMarketing runs through scope and never sends", async () => {
  const queries = [];
  const scope = async (fn) => fn({
    async query(sql, params) {
      queries.push(String(sql));
      if (/marketing_heartbeats/.test(sql)) {
        return {
          rows: [
            { name: "clock", last_at: new Date("2026-10-06T12:50:00Z") },
            { name: "worker", last_at: new Date("2026-10-06T12:50:00Z") },
            { name: "outbox_drain", last_at: new Date("2026-10-06T12:59:00Z") }
          ]
        };
      }
      if (/marketing_settings/.test(sql) && /count/.test(sql)) {
        return { rows: [{ n: 1 }] };
      }
      if (/repo_outbox|marketing_buzzes|marketing_jobs/.test(sql)) {
        return { rows: [{ outbox_waiting: 0, buzzes_due: 0, jobs_due: 0, stale_claims: 0 }] };
      }
      throw new Error(`unexpected sql: ${String(sql).slice(0, 80)}`);
    }
  });
  const rows = await checkMarketing({ scope, now: NOW });
  assert.deepEqual(rows.map((r) => [r.id, r.status]), [
    ["clock", "PASS"],
    ["worker", "na"],
    ["page_seen", "skip"],
    ["outbox_drain", "na"]
  ]);
  assert.ok(queries.some((q) => /marketing_heartbeats/.test(q)));
});
