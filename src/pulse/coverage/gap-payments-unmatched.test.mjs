import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  CSM_TASK_DAYS_LATE,
  CSM_TASK_RUNG,
  LATE_NO_FLAG_DAYS,
  LATE_NO_FLAG_SQL,
  RECEIPT_WAITING_SQL,
  SAMPLE_REF_PREFIX,
  UNMATCHED_WAIT_MS,
  gapChecks
} from "./gap-payments-unmatched.mjs";
import { LADDER, FINAL_RUNG } from "../../finance/money-agent.mjs";
import { TEST_CLIENT_EMAIL_RE, addDaysIso } from "./money-reads.mjs";
import {
  CLIENT_COLS, HAS_DB, ORG, OTHER_ORG, client_, closeShadowDb, runShadowSql, shadow, tagDb, withShadows
} from "./money-test-kit.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-payments-unmatched.mjs"), "utf8");
const NOW = new Date("2026-10-10T18:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms) => new Date(NOW.getTime() - ms).toISOString();
const byId = (rows, id) => rows.find((r) => r.id === id);

function shape(r) {
  assert.ok(CHECK_IDS.includes(r.id), r.id);
  assert.ok(["PASS", "FAIL", "skip"].includes(r.status));
  assert.ok(r.detail.length > 0);
  if (r.status === "FAIL") assert.match(r.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
  else assert.equal(r.suggestedFix, null);
}

test("gap payments-unmatched: the source is read only and sends nothing", () => {
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE)\b\s+(INTO|FROM|TABLE|SET)?/);
  assert.doesNotMatch(SRC, /\bfetch/i);
  assert.doesNotMatch(SRC, /sendTemplated|logMoneyAction|recordClarityPayment|createTask/);
});

test("gap payments-unmatched: the CSM rung is the rung the money helper's own ladder has", () => {
  const rung = LADDER.find((r) => r.action === "csm_task");
  assert.equal(rung.rung, CSM_TASK_RUNG);
  assert.equal(rung.from, CSM_TASK_DAYS_LATE);
  assert.equal(rung.rung, FINAL_RUNG);
  assert.equal(rung.texts, false, "rung 3 does not text, so no opt-out holds it back");
  assert.equal(LATE_NO_FLAG_DAYS, CSM_TASK_DAYS_LATE + 1);
  assert.equal(UNMATCHED_WAIT_MS, DAY);
  assert.equal(SAMPLE_REF_PREFIX, "sample:");
});

test("gap payments-unmatched: the key the helper writes is the key this lane looks for", async () => {
  const { keyFor } = await import("../../finance/money-agent.mjs");
  const task = keyFor("clarity_installment:abc", CSM_TASK_RUNG);
  const held = keyFor("clarity_installment:abc", CSM_TASK_RUNG, "opted_out");
  assert.equal(task, "money-agent:clarity_installment:abc:3");
  assert.equal(held, "money-agent:clarity_installment:abc:3:held:opted_out");
  assert.match(LATE_NO_FLAG_SQL, /'money-agent:clarity_installment:' \|\| i\.id::text \|\| ':3%'/);
});

describe("gap payments-unmatched: the two rows", () => {
  const db = (over = {}) => tagDb({
    "payments-unmatched-receipt-waiting": { total_n: 0, n: 0, test_n: 0, cents: 0, oldest: null, sample: null, ...(over.receipt || {}) },
    "payments-unmatched-installment-late-no-flag": {
      late_n: 0, n: 0, sample_n: 0, test_n: 0, cents: 0, oldest_due: null, sample: null, ...(over.late || {})
    }
  });
  const run = (over) => gapChecks({ db: db(over), orgId: ORG, now: NOW });

  test("clean books are two PASS rows", async () => {
    const rows = await run();
    rows.forEach(shape);
    assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS"]);
  });

  test("a receipt nobody touched is red, with the dollars, the age and the reason", async () => {
    const rows = await run({ receipt: { total_n: 2, n: 2, cents: 83300, oldest: ago(3 * DAY), sample: "FH-000601 (amount_does_not_match)" } });
    const r = byId(rows, "payments-unmatched:receipt-waiting");
    shape(r);
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /2 Commas payments \(\$833 in all\) came in, fit no plan/);
    assert.match(r.detail, /oldest came in 3 days ago/);
    assert.match(r.detail, /amount_does_not_match/);
  });

  test("a receipt staff already worked is a PASS that says so", async () => {
    const rows = await run({ receipt: { total_n: 1, n: 0 } });
    const r = byId(rows, "payments-unmatched:receipt-waiting");
    assert.equal(r.status, "PASS");
    assert.match(r.detail, /1 unmatched Commas payment on file, and staff have worked each client since/);
  });

  test("a payment a week late with no task is red; sample and test plans are named as left out, not counted", async () => {
    const rows = await run({ late: { late_n: 3, n: 1, sample_n: 1, test_n: 1, cents: 50000, oldest_due: "2026-10-01", sample: "FH-000777 (due 2026-10-01)" } });
    const r = byId(rows, "payments-unmatched:installment-late-no-flag");
    shape(r);
    assert.equal(r.status, "FAIL");
    assert.match(r.detail, /1 plan payment \(\$500 left\) is 8 or more days late and the money helper never opened its CSM task or logged a hold/);
    assert.match(r.detail, /Left out: 1 sample plan, 1 test-client plan/);
    assert.match(r.suggestedFix, /money-agent:clarity_installment:<id>:3/);
  });

  test("no database and no org are skips; a failed read is a skip with the reason, never a PASS", async () => {
    const noDb = await gapChecks({ now: NOW });
    assert.deepEqual(noDb.map((r) => r.status), ["skip", "skip"]);
    const noOrg = await gapChecks({ db: db(), now: NOW });
    assert.match(noOrg[0].detail, /no org id/);
    const bad = tagDb({
      "payments-unmatched-receipt-waiting": new Error("permission denied for table money_agent_log"),
      "payments-unmatched-installment-late-no-flag": new Error("connection terminated")
    });
    const rows = await gapChecks({ db: bad, orgId: ORG, now: NOW });
    assert.deepEqual(rows.map((r) => r.status), ["skip", "skip"]);
    assert.match(rows[0].detail, /permission denied/);
  });

  test("the late read asks for installments due 8 days before today's UTC day", async () => {
    const seen = [];
    const spy = tagDb({
      "payments-unmatched-receipt-waiting": { total_n: 0, n: 0 },
      "payments-unmatched-installment-late-no-flag": { late_n: 0, n: 0 }
    }, seen);
    await gapChecks({ db: spy, orgId: ORG, now: NOW });
    const late = seen.find((s) => s.tag === "payments-unmatched-installment-late-no-flag");
    assert.deepEqual(late.params, [ORG, addDaysIso("2026-10-10", -8), TEST_CLIENT_EMAIL_RE]);
    assert.equal(late.params[1], "2026-10-02");
    const receipt = seen.find((s) => s.tag === "payments-unmatched-receipt-waiting");
    assert.equal(receipt.params[1], ago(UNMATCHED_WAIT_MS));
  });
});

/* ---- the SQL, run for real against made-up tables -------------------------------------------- */

const LOG_COLS = [
  ["org_id", "uuid"], ["client_id", "uuid"], ["action", "text"], ["actor", "text"], ["amount_cents", "bigint"],
  ["reason", "text"], ["created_at", "timestamptz"], ["idempotency_key", "text"]
];
const INST_COLS = [
  ["id", "uuid"], ["clarity_payment_id", "uuid"], ["due_on", "date"], ["amount_cents", "bigint"], ["paid_cents", "bigint"]
];
const PLAN_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["status", "text"], ["invoice_id", "uuid"], ["external_ref", "text"]
];
const C1 = "cccccccc-0000-4000-8000-000000000001";
const C2 = "cccccccc-0000-4000-8000-000000000002";
const C_TEST = "cccccccc-0000-4000-8000-000000000009";
const clients = [client_(C1), client_(C2), client_(C_TEST, { is_demo: true })];
const uid = (n) => `eeeeeeee-0000-4000-8000-${String(n).padStart(12, "0")}`;

const unmatched = (over = {}) => ({
  org_id: ORG, client_id: C1, action: "payment_unmatched", actor: "agent", amount_cents: 50000,
  reason: "amount_does_not_match", created_at: ago(2 * DAY), idempotency_key: "commas-payment:ORD-1", ...over
});
const staff = (over = {}) => ({
  org_id: ORG, client_id: C1, action: "payment_recorded", actor: "staff", amount_cents: 50000, reason: null,
  created_at: ago(DAY), idempotency_key: null, ...over
});

// want: [total_n, n, test_n, cents]
const RECEIPT_CASES = [
  ["no unmatched payment is clean", [], [0, 0, 0, 0]],
  ["an unmatched payment 2 days old that nobody touched", [unmatched()], [1, 1, 0, 50000]],
  ["an unmatched payment 12 hours old is still inside the wait", [unmatched({ created_at: ago(12 * HOUR) })], [0, 0, 0, 0]],
  ["staff recorded a payment on that client afterwards: it was worked", [unmatched(), staff()], [1, 0, 0, 0]],
  ["staff acted on that client BEFORE it came in: not worked", [unmatched(), staff({ created_at: ago(3 * DAY) })], [1, 1, 0, 50000]],
  ["staff acted on another client: not worked", [unmatched(), staff({ client_id: C2 })], [1, 1, 0, 50000]],
  ["the money helper acting afterwards is not a person", [unmatched(), staff({ actor: "agent" })], [1, 1, 0, 50000]],
  ["two unmatched, one worked, the dollars are only the open one", [unmatched(), unmatched({ client_id: C2, amount_cents: 12300, idempotency_key: "commas-payment:ORD-2" }), staff()], [2, 1, 0, 12300]],
  ["a test client's unmatched payment is counted apart", [unmatched({ client_id: C_TEST })], [0, 0, 1, 0]],
  ["another org's unmatched payment is not read", [unmatched({ org_id: OTHER_ORG })], [0, 0, 0, 0]],
  ["other money-helper rows are not unmatched payments", [unmatched({ action: "reminder" })], [0, 0, 0, 0]]
];

describe("gap payments-unmatched: the receipt SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);
  for (const [name, logs, want] of RECEIPT_CASES) {
    test(name, async () => {
      const sql = withShadows(RECEIPT_WAITING_SQL, [shadow("money_agent_log", LOG_COLS, logs), shadow("clients", CLIENT_COLS, clients)]);
      const { rows } = await runShadowSql(sql, [ORG, ago(UNMATCHED_WAIT_MS), TEST_CLIENT_EMAIL_RE]);
      const got = [rows[0].total_n, rows[0].n, rows[0].test_n, rows[0].cents].map(Number);
      assert.deepEqual(got, want, name);
    });
  }
});

const plan = (n, over = {}) => ({ id: uid(n), org_id: ORG, client_id: C1, status: "open", invoice_id: null, external_ref: null, ...over });
const inst = (n, planN, dueDaysAgo, over = {}) => ({
  id: uid(100 + n), clarity_payment_id: uid(planN), due_on: addDaysIso("2026-10-10", -dueDaysAgo),
  amount_cents: 50000, paid_cents: 0, ...over
});
const rung = (instN, r, suffix = "", over = {}) => ({
  org_id: ORG, client_id: C1, action: r === 3 ? "csm_task" : "late_check_in", actor: "agent", amount_cents: 50000, reason: null,
  created_at: ago(DAY), idempotency_key: `money-agent:clarity_installment:${uid(100 + instN)}:${r}${suffix}`, ...over
});

// want: [late_n, n, sample_n, test_n]
const LATE_CASES = [
  ["nothing late is clean", { plans: [], insts: [], logs: [] }, [0, 0, 0, 0]],
  ["9 days late and the helper never wrote a thing", { plans: [plan(1)], insts: [inst(1, 1, 9)], logs: [] }, [1, 1, 0, 0]],
  ["9 days late and the CSM task was opened (rung 3)", { plans: [plan(1)], insts: [inst(1, 1, 9)], logs: [rung(1, 3)] }, [1, 0, 0, 0]],
  ["9 days late and the helper logged a hold on rung 3 (opted out, escalated)", { plans: [plan(1)], insts: [inst(1, 1, 9)], logs: [rung(1, 3, ":held:opted_out")] }, [1, 0, 0, 0]],
  ["9 days late with only the three text rungs: no task yet is a break", { plans: [plan(1)], insts: [inst(1, 1, 9)], logs: [rung(1, 0), rung(1, 1), rung(1, 2)] }, [1, 1, 0, 0]],
  ["exactly 8 days late is read", { plans: [plan(1)], insts: [inst(1, 1, 8)], logs: [] }, [1, 1, 0, 0]],
  ["7 days late is still inside the helper's own day", { plans: [plan(1)], insts: [inst(1, 1, 7)], logs: [] }, [0, 0, 0, 0]],
  ["paid in full is not late", { plans: [plan(1)], insts: [inst(1, 1, 9, { paid_cents: 50000 })], logs: [] }, [0, 0, 0, 0]],
  ["part paid is still late, and the dollars left are what is open", { plans: [plan(1)], insts: [inst(1, 1, 9, { paid_cents: 20000 })], logs: [] }, [1, 1, 0, 0]],
  ["a settled plan is not read", { plans: [plan(1, { status: "settled" })], insts: [inst(1, 1, 9)], logs: [] }, [0, 0, 0, 0]],
  ["a plan tied to an invoice belongs to the AR ladder", { plans: [plan(1, { invoice_id: uid(900) })], insts: [inst(1, 1, 9)], logs: [] }, [0, 0, 0, 0]],
  ["a sample plan is counted apart", { plans: [plan(1, { external_ref: "sample:p4-clarity-1500" })], insts: [inst(1, 1, 9)], logs: [] }, [0, 0, 1, 0]],
  ["a test client's plan is counted apart", { plans: [plan(1, { client_id: C_TEST })], insts: [inst(1, 1, 9)], logs: [] }, [0, 0, 0, 1]],
  ["another installment's rung 3 does not flag this one", { plans: [plan(1)], insts: [inst(1, 1, 9), inst(2, 1, 9)], logs: [rung(2, 3)] }, [2, 1, 0, 0]],
  ["another org's plan is not read", { plans: [plan(1, { org_id: OTHER_ORG })], insts: [inst(1, 1, 9)], logs: [] }, [0, 0, 0, 0]]
];

describe("gap payments-unmatched: the late-no-flag SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  after(closeShadowDb);
  for (const [name, scenario, want] of LATE_CASES) {
    test(name, async () => {
      const sql = withShadows(LATE_NO_FLAG_SQL, [
        shadow("clarity_payment_installments", INST_COLS, scenario.insts),
        shadow("clarity_payments", PLAN_COLS, scenario.plans),
        shadow("clients", CLIENT_COLS, clients),
        shadow("money_agent_log", LOG_COLS, scenario.logs)
      ]);
      const { rows } = await runShadowSql(sql, [ORG, addDaysIso("2026-10-10", -LATE_NO_FLAG_DAYS), TEST_CLIENT_EMAIL_RE]);
      const got = [rows[0].late_n, rows[0].n, rows[0].sample_n, rows[0].test_n].map(Number);
      assert.deepEqual(got, want, name);
    });
  }

  test("the dollars left and the sample name the open installment only", async () => {
    const sql = withShadows(LATE_NO_FLAG_SQL, [
      shadow("clarity_payment_installments", INST_COLS, [inst(1, 1, 9, { paid_cents: 20000 }), inst(2, 1, 9)]),
      shadow("clarity_payments", PLAN_COLS, [plan(1)]),
      shadow("clients", CLIENT_COLS, clients),
      shadow("money_agent_log", LOG_COLS, [rung(2, 3)])
    ]);
    const { rows } = await runShadowSql(sql, [ORG, addDaysIso("2026-10-10", -LATE_NO_FLAG_DAYS), TEST_CLIENT_EMAIL_RE]);
    assert.equal(Number(rows[0].cents), 30000);
    assert.match(rows[0].sample, /FH-000001 \(due 2026-10-01\)/);
  });
});
