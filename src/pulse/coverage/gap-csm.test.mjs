import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECKS,
  CSM_DOOR_IDS,
  OWNER_APPROVAL_DOOR_IDS,
  OWNER_DASHBOARD_DOOR_IDS,
  SALES_MANAGER_DASHBOARD_DOOR_IDS,
  SHARED_TASK_DOOR_IDS
} from "./slice-30-csm-owner.mjs";
import {
  CHECK_IDS as GAP_IDS,
  MID_SOURCE_WORKFLOW,
  MISSING_STEP_SQL,
  MONEY_IN_EVENTS,
  OVERDUE_UNASSIGNED_SQL,
  QUEUE_PATH,
  QUEUE_PROBE_SQL,
  csmQueueRouteWired,
  gapChecks,
  halfwayStepWired
} from "./gap-csm.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-csm.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T18:00:00Z");

const ALIVE_FILES = {
  "netlify/functions/api.mjs":
    'import readCsmQueue from "../../api/read/csm-queue.mjs";\n"read/csm-queue": readCsmQueue,',
  "api/read/csm-queue.mjs":
    'if (req.method && req.method !== "GET") {}\nexport default async function handler() {}',
  "src/handlers/customer-insights.mjs":
    'on("deposit.paid", onPaidMidCheckin);\non("sale.closed", onPaidMidCheckin);\non("payment.received", onPaidMidCheckin);',
  "src/register-all.mjs": "registerCustomerInsights();"
};

function aliveRead(rel) {
  if (!Object.prototype.hasOwnProperty.call(ALIVE_FILES, rel)) throw new Error(`unexpected read: ${rel}`);
  return ALIVE_FILES[rel];
}

function deadQueueRead(rel) {
  if (rel.endsWith("api.mjs")) return "no csm queue route";
  if (rel.endsWith("csm-queue.mjs")) return "export default async function handler() {}";
  return aliveRead(rel);
}

function deadStepRead(rel) {
  if (rel.endsWith("customer-insights.mjs")) return 'on("deposit.paid", onPaidMidCheckin);';
  if (rel.endsWith("register-all.mjs")) return "registerLifecycle();";
  return aliveRead(rel);
}

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(GAP_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.equal(typeof row.suggestedFix, "string");
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not invent a second watchdog/);
    assert.match(row.suggestedFix, /Do not text clients/);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

function fakeDb({ overdue = 0, missing = 0, queueThrows = false, overdueThrows = false, missingThrows = false } = {}) {
  return {
    async query(sql, params) {
      if (sql === QUEUE_PROBE_SQL) {
        if (queueThrows) throw new Error("relation v_invoice_aging does not exist");
        assert.equal(params[0], ORG);
        return { rows: [] };
      }
      if (sql === OVERDUE_UNASSIGNED_SQL) {
        if (overdueThrows) throw new Error("tasks read failed");
        assert.equal(params[0], ORG);
        assert.equal(params[1], NOW.toISOString());
        return { rows: [{ n: overdue }] };
      }
      if (sql === MISSING_STEP_SQL) {
        if (missingThrows) throw new Error("events read failed");
        assert.equal(params[0], ORG);
        assert.deepEqual(params[1], [...MONEY_IN_EVENTS]);
        assert.equal(params[2], MID_SOURCE_WORKFLOW);
        return { rows: [{ n: missing }] };
      }
      throw new Error(`unexpected sql: ${sql}`);
    }
  };
}

function fetchStatus(status, calls) {
  return async function fetchImpl(url, opts) {
    calls.push({ url, method: opts && opts.method });
    return { status, text: async () => "" };
  };
}

test("gap csm: source stays read-only and does not text", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(SRC, /sendTemplated|textChris|twilio|createMessage/i);
  assert.match(SRC, /Do not text clients/);
  assert.match(SRC, /No second watchdog/);
  assert.deepEqual([...GAP_IDS], [
    "csm:queue-api",
    "csm:overdue-unassigned",
    "csm:missing-step"
  ]);
  assert.deepEqual([...MONEY_IN_EVENTS], ["deposit.paid", "sale.closed", "payment.received"]);
  assert.equal(MID_SOURCE_WORKFLOW, "customer-insights-mid");
  assert.equal(QUEUE_PATH, "/api/read/csm-queue");
});

test("gap csm: does not repeat the owner half of slice 30", () => {
  const ownerIds = [
    ...OWNER_DASHBOARD_DOOR_IDS,
    ...OWNER_APPROVAL_DOOR_IDS,
    ...SALES_MANAGER_DASHBOARD_DOOR_IDS,
    ...SHARED_TASK_DOOR_IDS
  ];
  for (const id of GAP_IDS) {
    assert.equal(ownerIds.includes(id), false);
    assert.equal(CSM_DOOR_IDS.includes(id), false);
  }
  assert.equal(CHECKS.some((row) => row.id === "pipeline.html"), true);
  assert.doesNotMatch(OVERDUE_UNASSIGNED_SQL, /assignee_role = 'owner'/);
  assert.match(OVERDUE_UNASSIGNED_SQL, /assignee_role = 'csm'/);
  assert.match(QUEUE_PROBE_SQL, /assignee_role = 'csm'/);
  for (const sql of [QUEUE_PROBE_SQL, OVERDUE_UNASSIGNED_SQL, MISSING_STEP_SQL]) {
    assert.match(sql, /SELECT/i);
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP)\b/i);
  }
});

test("gap csm: no database and no fetch skips the three reads", async () => {
  const rows = await gapChecks({ readText: aliveRead });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
});

test("gap csm: a quiet queue is three PASS rows", async () => {
  const calls = [];
  const rows = await gapChecks({
    db: fakeDb(),
    orgId: ORG,
    now: NOW,
    fetchImpl: fetchStatus(401, calls),
    baseUrl: "https://fundhub.ai",
    readText: aliveRead
  });
  assert.equal(rows.length, 3);
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "PASS"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].url, `https://fundhub.ai${QUEUE_PATH}`);
});

test("gap csm: each named break is a FAIL and the others stay PASS", async () => {
  const cases = [
    {
      label: "queue",
      ctx: { fetchStatus: 500 },
      id: "csm:queue-api",
      detail: /CSM queue API is dead/
    },
    {
      label: "overdue",
      ctx: { overdue: 2 },
      id: "csm:overdue-unassigned",
      detail: /2 client success tasks overdue/
    },
    {
      label: "step",
      ctx: { missing: 1 },
      id: "csm:missing-step",
      detail: /1 client paid and has no halfway accountability call/
    }
  ];
  for (const c of cases) {
    const calls = [];
    const rows = await gapChecks({
      db: fakeDb(c.ctx),
      orgId: ORG,
      now: NOW,
      fetchImpl: fetchStatus(c.ctx.fetchStatus || 200, calls),
      readText: aliveRead
    });
    rows.forEach(shape);
    const hit = rows.find((r) => r.id === c.id);
    assert.equal(hit.status, "FAIL", c.label);
    assert.match(hit.detail, c.detail);
    assert.ok(rows.filter((r) => r.id !== c.id).every((r) => r.status === "PASS"));
    assert.ok(calls.every((call) => call.method === "GET"));
  }
});

test("gap csm: a missing queue route is FAIL and does not need a database", async () => {
  const rows = await gapChecks({ readText: deadQueueRead });
  rows.forEach(shape);
  const queue = rows.find((r) => r.id === "csm:queue-api");
  assert.equal(queue.status, "FAIL");
  assert.match(queue.detail, /route is not wired/);
  assert.equal(csmQueueRouteWired(deadQueueRead), false);
  assert.equal(csmQueueRouteWired(aliveRead), true);
  assert.deepEqual(
    rows.filter((r) => r.id !== "csm:queue-api").map((r) => r.status),
    ["skip", "skip"]
  );
});

test("gap csm: a missing halfway step is FAIL and does not need a database", async () => {
  const rows = await gapChecks({ readText: deadStepRead, fetchImpl: fetchStatus(401, []) });
  rows.forEach(shape);
  const step = rows.find((r) => r.id === "csm:missing-step");
  assert.equal(step.status, "FAIL");
  assert.match(step.detail, /not wired/);
  assert.equal(halfwayStepWired(deadStepRead), false);
  assert.equal(halfwayStepWired(aliveRead), true);
  assert.equal(rows.find((r) => r.id === "csm:queue-api").status, "PASS");
  assert.equal(rows.find((r) => r.id === "csm:overdue-unassigned").status, "skip");
});

test("gap csm: a read error is FAIL, not a throw", async () => {
  const rows = await gapChecks({
    db: fakeDb({ queueThrows: true, overdueThrows: true, missingThrows: true }),
    orgId: ORG,
    now: NOW,
    fetchImpl: fetchStatus(403, []),
    readText: aliveRead
  });
  rows.forEach(shape);
  assert.ok(rows.every((r) => r.status === "FAIL"));
  assert.match(rows[0].detail, /v_invoice_aging/);
  assert.match(rows[1].detail, /tasks read failed/);
  assert.match(rows[2].detail, /events read failed/);
});

test("gap csm: the live queue route and halfway step are still wired", () => {
  assert.equal(csmQueueRouteWired(), true);
  assert.equal(halfwayStepWired(), true);
});
