import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CATCH_UP_CRON } from "../../workflows/next-action-catch-up.mjs";
import { STAGE_SLA } from "../../repair/sla.mjs";
import { cronIntervalMs, STALE_MULTIPLE } from "../heartbeats.mjs";
import {
  APPLY_BLOCKED_SQL,
  APPLY_BLOCKED_STATUSES,
  CHECK_IDS,
  FULFILLMENT_GETS,
  FUNDING_QUEUE_STAGES,
  NEXT_ACTION_SQL,
  NEXT_ACTION_WAIT_MS,
  gapChecks,
  pastDefinedWait
} from "./gap-fulfillment.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-fulfillment.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T15:00:00.000Z");

function fakeDb({ nextRows = [], applyN = 0, throwOn = null } = {}) {
  return {
    async query(sql, params) {
      if (throwOn && sql.includes(throwOn)) throw new Error(`relation ${throwOn} does not exist`);
      if (/gap:fulfillment-next-action/.test(sql)) {
        assert.equal(params[0], ORG);
        assert.deepEqual(params[1], Object.keys(STAGE_SLA));
        assert.deepEqual(params[2], [...FUNDING_QUEUE_STAGES]);
        return { rows: nextRows };
      }
      if (/gap:fulfillment-apply-blocked/.test(sql)) {
        assert.equal(params[0], ORG);
        assert.deepEqual(params[1], [...APPLY_BLOCKED_STATUSES]);
        return { rows: [{ n: applyN }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

function aliveFetch(seen) {
  return async (url, opts) => {
    seen.push({ url, method: opts && opts.method });
    return { status: 401, async text() { return ""; } };
  };
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not apply to a real lender/);
    assert.match(row.suggestedFix, /Do not upload/);
    assert.doesNotMatch(row.suggestedFix, /second watchdog|new watchdog|second tripwire/i);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

function iso(msBefore) {
  return new Date(NOW.getTime() - msBefore).toISOString();
}

test("gap fulfillment: source stays read-only and does not repeat the slice list", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /documents-upload|proxy\/launch|repair\/generate|repair\/send|inquiry-cases|dispute_letters/);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']/);
  assert.equal(NEXT_ACTION_WAIT_MS, STALE_MULTIPLE * cronIntervalMs(CATCH_UP_CRON));
  assert.equal(NEXT_ACTION_WAIT_MS, 15 * 60 * 1000);
  assert.equal(STAGE_SLA.letters_generated.minutes, 30);
  assert.equal(STAGE_SLA.awaiting_response.daysAfterDue, 5);
  assert.match(NEXT_ACTION_SQL, /employee_next_action/);
  assert.match(NEXT_ACTION_SQL, /^\s*\/\* gap:fulfillment-next-action \*\/\s*SELECT/i);
  assert.match(APPLY_BLOCKED_SQL, /condition_text/);
  assert.match(APPLY_BLOCKED_SQL, /error_code/);
  assert.doesNotMatch(NEXT_ACTION_SQL, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.doesNotMatch(APPLY_BLOCKED_SQL, /\b(INSERT|UPDATE|DELETE)\b/i);
  assert.deepEqual([...CHECK_IDS], [
    "fulfillment:next-action",
    "fulfillment:api",
    "fulfillment:apply-blocked"
  ]);
  assert.ok(FULFILLMENT_GETS.every((path) => path.startsWith("/api/")));
  assert.equal(FULFILLMENT_GETS.some((path) => /upload|proxy\/launch|inquiry/.test(path)), false);
});

test("gap fulfillment: no database and no fetch skips all three", async () => {
  const rows = await gapChecks({});
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
});

test("gap fulfillment: a file still inside its wait is PASS", async () => {
  const seen = [];
  const rows = await gapChecks({
    db: fakeDb({
      nextRows: [
        {
          id: "repair-inside",
          pipeline_key: "optimization",
          stage_key: "letters_generated",
          entered_at: iso(29 * 60 * 1000)
        },
        {
          id: "funding-inside",
          pipeline_key: "funding_card_stacking",
          stage_key: "apply_now",
          entered_at: iso(14 * 60 * 1000)
        },
        {
          id: "bureau-inside",
          pipeline_key: "optimization",
          stage_key: "awaiting_response",
          entered_at: iso(20 * 86400000),
          response_due_at: iso(4 * 86400000)
        }
      ]
    }),
    orgId: ORG,
    now: NOW,
    fetchImpl: aliveFetch(seen)
  });
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
  assert.equal(seen.length, FULFILLMENT_GETS.length);
  assert.ok(seen.every((call) => call.method === "GET"));
  assert.equal(pastDefinedWait({
    pipeline_key: "optimization",
    stage_key: "letters_generated",
    entered_at: iso(29 * 60 * 1000)
  }, NOW), false);
});

test("gap fulfillment: each named break is a FAIL and the others stay PASS", async () => {
  const lateRepair = {
    id: "repair-late",
    pipeline_key: "optimization",
    stage_key: "letters_generated",
    entered_at: iso(31 * 60 * 1000)
  };
  const lateFunding = {
    id: "funding-late",
    pipeline_key: "funding_card_stacking",
    stage_key: "apply_now",
    entered_at: iso(16 * 60 * 1000)
  };
  const nextRows = await gapChecks({
    db: fakeDb({ nextRows: [lateRepair, lateFunding] }),
    orgId: ORG,
    now: NOW,
    fetchImpl: aliveFetch([])
  });
  nextRows.forEach(shape);
  const next = nextRows.find((r) => r.id === "fulfillment:next-action");
  assert.equal(next.status, "FAIL");
  assert.match(next.detail, /2 files past the wait with no next step/);
  assert.match(next.detail, /repair-late/);
  assert.match(next.detail, /funding-late/);
  assert.ok(nextRows.filter((r) => r.id !== next.id).every((r) => r.status === "PASS"));

  const seen = [];
  const apiRows = await gapChecks({
    db: fakeDb({}),
    orgId: ORG,
    now: NOW,
    fetchImpl: async (url, opts) => {
      seen.push(url);
      const status = url.endsWith("/api/repair/exceptions") ? 500 : 401;
      assert.equal(opts.method, "GET");
      return { status, async text() { return ""; } };
    }
  });
  apiRows.forEach(shape);
  const api = apiRows.find((r) => r.id === "fulfillment:api");
  assert.equal(api.status, "FAIL");
  assert.match(api.detail, /fulfillment API 500/);
  assert.match(api.detail, /\/api\/repair\/exceptions 500/);
  assert.ok(apiRows.filter((r) => r.id !== api.id).every((r) => r.status === "PASS"));
  assert.equal(seen.some((url) => /proxy\/launch|documents-upload|inquiry/.test(url)), false);

  const applyRows = await gapChecks({
    db: fakeDb({ applyN: 1 }),
    orgId: ORG,
    now: NOW,
    fetchImpl: aliveFetch([])
  });
  applyRows.forEach(shape);
  const apply = applyRows.find((r) => r.id === "fulfillment:apply-blocked");
  assert.equal(apply.status, "FAIL");
  assert.match(apply.detail, /1 apply step blocked with no reason stored/);
  assert.ok(applyRows.filter((r) => r.id !== apply.id).every((r) => r.status === "PASS"));
});

test("gap fulfillment: a bureau file past its due date is the next-step break", () => {
  assert.equal(pastDefinedWait({
    pipeline_key: "optimization",
    stage_key: "awaiting_response",
    entered_at: iso(30 * 86400000),
    response_due_at: iso(6 * 86400000)
  }, NOW), true);
  assert.equal(pastDefinedWait({
    pipeline_key: "optimization",
    stage_key: "intake",
    entered_at: iso(2 * 86400000)
  }, NOW), false);
});

test("gap fulfillment: a read error or a dead API is FAIL, not a throw", async () => {
  const rows = await gapChecks({
    db: fakeDb({ throwOn: "gap:fulfillment" }),
    orgId: ORG,
    now: NOW,
    fetchImpl: async () => {
      throw new Error("socket hang up");
    }
  });
  rows.forEach(shape);
  assert.equal(rows[0].status, "FAIL");
  assert.match(rows[0].detail, /could not read next steps/);
  assert.equal(rows[1].status, "FAIL");
  assert.match(rows[1].detail, /unreachable/);
  assert.equal(rows[2].status, "FAIL");
  assert.match(rows[2].detail, /could not read blocked apply steps/);
});

test("gap fulfillment: a non-500 miss is still a down desk, and 400 is alive", async () => {
  const down = await gapChecks({
    fetchImpl: async () => ({ status: 404, async text() { return ""; } })
  });
  assert.equal(down[0].status, "skip");
  assert.equal(down[2].status, "skip");
  assert.equal(down[1].status, "FAIL");
  assert.match(down[1].detail, /fulfillment API down/);
  down.forEach(shape);

  const alive = await gapChecks({
    fetchImpl: async () => ({ status: 400, async text() { return ""; } })
  });
  assert.equal(alive[1].status, "PASS");
  alive.forEach(shape);
});
