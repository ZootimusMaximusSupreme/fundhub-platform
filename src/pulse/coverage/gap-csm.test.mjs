import test, { describe, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECK_IDS,
  MID_SOURCE_WORKFLOW,
  MISSING_STEP_SQL,
  MONEY_IN_EVENTS,
  OVERDUE_GRACE_MS,
  OVERDUE_UNASSIGNED_SQL,
  QUEUE_PATH,
  STEPS,
  STEP_GRACE_MS,
  STEP_LOOKBACK_MS,
  gapChecks,
  openCsmQueue
} from "./gap-csm.mjs";
import { MID_SOURCE_WORKFLOW as HANDLER_MID, SOURCE_WORKFLOW as HANDLER_POST } from "../../handlers/customer-insights.mjs";
import { db as pgDb, close as closePg } from "../../db.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(HERE, "gap-csm.mjs"), "utf8");
const ORG = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-10-08T20:00:00.000Z");

/* A fake db. The queue handler is the REAL handler, so this answers its real
   query with a row shaped the way its SELECT shapes it. The other reads answer
   by the tag in their first comment, and every call is kept. */
function fakeDb({ queue = [], overdue = 0, missing = [], throws = {} } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (/WITH owed AS/.test(text)) {
        if (throws.queue) throw throws.queue;
        return { rows: queue };
      }
      if (/gap:csm-overdue-unassigned/.test(text)) {
        if (throws.overdue) throw throws.overdue;
        return { rows: [{ n: overdue }] };
      }
      if (/gap:csm-missing-step/.test(text)) {
        if (throws.missing) throw throws.missing;
        return { rows: missing };
      }
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

const queueRow = {
  task_id: "t1",
  title: "Accountability call — halfway check-in",
  due_at: "2027-01-05T07:07:26.290Z",
  source_workflow: "customer-insights-mid",
  meeting_url: null,
  assignee_staff_id: null,
  assigned_csm_staff_id: null,
  assigned_csm_name: null,
  client_id: "c1",
  client_name: "Pat Example",
  client_code: "C-1",
  balance_amount: null,
  open_invoices: null,
  worst_days_overdue: null,
  owned_codes: []
};

function shape(row) {
  assert.equal(typeof row.id, "string");
  assert.ok(CHECK_IDS.includes(row.id));
  assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
  assert.equal(typeof row.detail, "string");
  assert.ok(row.detail.length > 0);
  assert.ok("suggestedFix" in row);
  if (row.status === "FAIL") {
    assert.match(row.suggestedFix, /Recon \(AG-07\) is the one tripwire/);
    assert.match(row.suggestedFix, /Do not text clients/);
    assert.match(row.suggestedFix, /second watchdog/);
    assert.match(row.suggestedFix, /Do not auto-fix/);
  } else {
    assert.equal(row.suggestedFix, null);
  }
}

async function run(db, extra = {}) {
  const rows = await gapChecks({ db, orgId: ORG, now: NOW, ...extra });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  rows.forEach(shape);
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

test("csm gap: three rows, fixed ids; no database skips all three with a reason", async () => {
  const rows = await gapChecks({ orgId: ORG, now: NOW });
  assert.deepEqual(rows.map((r) => r.id), [...CHECK_IDS]);
  assert.deepEqual(rows.map((r) => r.status), ["skip", "skip", "skip"]);
  assert.match(rows[0].detail, /no database/);
  assert.equal((await gapChecks({ db: fakeDb() })).every((r) => r.status === "skip"), true, "no company also skips");
  assert.equal((await gapChecks()).length, 3);
});

test("csm gap: the queue read is the REAL handler running its real query, and a normal answer is PASS", async () => {
  const db = fakeDb({ queue: [queueRow] });
  const by = await run(db);
  assert.equal(by["csm:queue-api"].status, "PASS");
  assert.match(by["csm:queue-api"].detail, /answered 200/);
  const call = db.calls.find((c) => /WITH owed AS/.test(c.sql));
  assert.ok(call, "the handler's own query ran");
  assert.equal(call.params[0], ORG);
  assert.equal(call.params[1], 1, "one row is asked for");
  assert.equal(call.params[2], 0);
  assert.match(call.sql, /v_invoice_aging/);
  assert.match(call.sql, /v_client_entitlements/);
  // An empty queue is not a dead queue.
  const empty = await run(fakeDb({ queue: [] }));
  assert.equal(empty["csm:queue-api"].status, "PASS");
});

test("csm gap: a queue read that throws, or answers an error, is FAIL with the reason", async () => {
  const boom = await run(fakeDb({ throws: { queue: new Error('relation "v_invoice_aging" does not exist') } }));
  assert.equal(boom["csm:queue-api"].status, "FAIL");
  assert.match(boom["csm:queue-api"].detail, /v_invoice_aging/);
  assert.match(boom["csm:queue-api"].suggestedFix, new RegExp(`Restore GET ${QUEUE_PATH}`));

  const forbidden = await gapChecks({ db: fakeDb(), orgId: "not-a-uuid", now: NOW });
  assert.equal(forbidden[0].status, "FAIL");
  assert.match(forbidden[0].detail, /answered 403/);

  const five = await run(fakeDb(), {
    queueHandler: async (_req, res) => res.status(500).json({ ok: false, error: "boom" })
  });
  assert.equal(five["csm:queue-api"].status, "FAIL");
  assert.match(five["csm:queue-api"].detail, /answered 500 \(boom\)/);

  const garbled = await run(fakeDb(), { queueHandler: async (_req, res) => res.status(200).json({ ok: true }) });
  assert.equal(garbled["csm:queue-api"].status, "FAIL");
});

test("csm gap: openCsmQueue is GET only, as an owner-level reader, and writes nothing", async () => {
  let seen;
  const out = await openCsmQueue({
    db: fakeDb(),
    orgId: ORG,
    handler: async (req, res, deps) => {
      seen = { req, staff: await deps.requireAuth(req, res, { db: deps.db }) };
      return res.status(200).json({ ok: true, items: [], count: 0 });
    }
  });
  assert.equal(out.status, 200);
  assert.equal(seen.req.method, "GET");
  assert.equal(seen.staff.org_id, ORG);
  assert.equal(seen.staff.role, "owner");
});

test("csm gap: overdue and unassigned counts a task only after a day, and reports it", async () => {
  const db = fakeDb({ overdue: 2 });
  const by = await run(db);
  assert.equal(by["csm:overdue-unassigned"].status, "FAIL");
  assert.match(by["csm:overdue-unassigned"].detail, /2 client success tasks more than a day overdue and nobody is assigned/);
  assert.match(by["csm:overdue-unassigned"].suggestedFix, /assign the overdue call/);
  const call = db.calls.find((c) => /gap:csm-overdue-unassigned/.test(c.sql));
  assert.equal(call.params[0], ORG);
  assert.equal(call.params[1], new Date(NOW.getTime() - OVERDUE_GRACE_MS).toISOString());
  assert.equal(OVERDUE_GRACE_MS, 24 * 3600e3);

  const one = await run(fakeDb({ overdue: 1 }));
  assert.match(one["csm:overdue-unassigned"].detail, /1 client success task more than a day overdue/);
  const clean = await run(fakeDb({ overdue: 0 }));
  assert.equal(clean["csm:overdue-unassigned"].status, "PASS");
});

test("csm gap: overdue SQL leaves out demo rows, done tasks, and tasks with no due date", () => {
  assert.match(OVERDUE_UNASSIGNED_SQL, /assignee_role = 'csm'/);
  assert.match(OVERDUE_UNASSIGNED_SQL, /t\.done = false/);
  assert.match(OVERDUE_UNASSIGNED_SQL, /COALESCE\(t\.is_demo, false\) = false/);
  assert.match(OVERDUE_UNASSIGNED_SQL, /COALESCE\(c\.is_demo, false\) = false/);
  assert.match(OVERDUE_UNASSIGNED_SQL, /t\.due_at IS NOT NULL/);
  assert.match(OVERDUE_UNASSIGNED_SQL, /t\.assignee_staff_id IS NULL/);
});

test("csm gap: the steps use the handler's own workflow names, not copies", () => {
  assert.equal(MID_SOURCE_WORKFLOW, HANDLER_MID);
  assert.deepEqual(STEPS.map((s) => s.workflow), [HANDLER_MID, HANDLER_POST]);
  assert.deepEqual([...MONEY_IN_EVENTS], ["deposit.paid", "sale.closed", "payment.received"]);
  assert.deepEqual([...STEPS[0].events], [...MONEY_IN_EVENTS]);
  assert.deepEqual([...STEPS[1].events], ["round.funded"]);
  assert.equal(STEP_GRACE_MS, 10 * 60 * 1000);
  assert.equal(STEP_LOOKBACK_MS, 60 * 24 * 3600e3);
});

test("csm gap: a missing accountability call fails and names which step", async () => {
  const db = fakeDb({ missing: [{ workflow: HANDLER_MID, n: 3 }] });
  const by = await run(db);
  assert.equal(by["csm:missing-step"].status, "FAIL");
  assert.match(by["csm:missing-step"].detail, /client success step does not exist: 3 clients have no halfway accountability call/);
  assert.match(by["csm:missing-step"].suggestedFix, /accountability call for the client who paid or was funded/);
  const call = db.calls.find((c) => /gap:csm-missing-step/.test(c.sql));
  assert.equal(call.params[0], ORG);
  // The two arrays line up: event i is answered by workflow i.
  assert.deepEqual(call.params[1], ["deposit.paid", "sale.closed", "payment.received", "round.funded"]);
  assert.deepEqual(call.params[2], [HANDLER_MID, HANDLER_MID, HANDLER_MID, HANDLER_POST]);
  assert.equal(call.params[3], new Date(NOW.getTime() - STEP_LOOKBACK_MS).toISOString());
  assert.equal(call.params[4], new Date(NOW.getTime() - STEP_GRACE_MS).toISOString());

  const post = await run(fakeDb({ missing: [{ workflow: HANDLER_POST, n: 1 }] }));
  assert.match(post["csm:missing-step"].detail, /1 client has no results accountability call/);
  const both = await run(fakeDb({ missing: [{ workflow: HANDLER_MID, n: 1 }, { workflow: HANDLER_POST, n: 2 }] }));
  assert.match(both["csm:missing-step"].detail, /1 client has no halfway accountability call; 2 clients have no results accountability call/);
});

test("csm gap: nothing missing is PASS; zero rows and zero counts are not misses", async () => {
  const none = await run(fakeDb({ missing: [] }));
  assert.equal(none["csm:missing-step"].status, "PASS");
  const zero = await run(fakeDb({ missing: [{ workflow: HANDLER_MID, n: 0 }] }));
  assert.equal(zero["csm:missing-step"].status, "PASS");
  const stranger = await run(fakeDb({ missing: [{ workflow: "something-else", n: 4 }] }));
  assert.equal(stranger["csm:missing-step"].status, "PASS");
});

test("csm gap: a database error on either read is FAIL with the reason, never PASS", async () => {
  const o = await run(fakeDb({ throws: { overdue: new Error("tasks is gone") } }));
  assert.equal(o["csm:overdue-unassigned"].status, "FAIL");
  assert.match(o["csm:overdue-unassigned"].detail, /could not read overdue client success tasks: tasks is gone/);
  const m = await run(fakeDb({ throws: { missing: new Error("events is gone") } }));
  assert.equal(m["csm:missing-step"].status, "FAIL");
  assert.match(m["csm:missing-step"].detail, /could not read the client success steps: events is gone/);
});

test("csm gap: missing-step SQL leaves out demo events and clients, and needs a client", () => {
  assert.match(MISSING_STEP_SQL, /COALESCE\(e\.is_demo, false\) = false/);
  assert.match(MISSING_STEP_SQL, /COALESCE\(c\.is_demo, false\) = false/);
  assert.match(MISSING_STEP_SQL, /e\.client_id IS NOT NULL/);
  assert.match(MISSING_STEP_SQL, /t\.source_workflow = m\.source_workflow/);
  assert.match(MISSING_STEP_SQL, /e\.created_at >= \$4/);
  assert.match(MISSING_STEP_SQL, /e\.created_at <= \$5/);
});

test("csm gap: source reads no repo file, sends nothing, and writes nothing", () => {
  assert.doesNotMatch(SRC, /from ["']node:(fs|path)["']|readFileSync|readText/);
  assert.doesNotMatch(SRC, /\b(INSERT|UPDATE|DELETE)\b/);
  assert.doesNotMatch(SRC, /method:\s*["']POST["']|sendSms|sendText|textChris|fetchImpl|\bfetch\s*\(/);
  assert.doesNotMatch(SRC, /\bBEGIN\b|\bCOMMIT\b|\bROLLBACK\b/);
});

/* ------------------------------------------------------------------------
   The SQL and the real queue handler, run for real. Each table is replaced for
   one query by fixture rows (a CTE with the table's name). SELECT only, nothing
   is stored. Skipped without DATABASE_URL, like every *.pg.test.mjs.
   ------------------------------------------------------------------------ */
const HAVE_DB = !!process.env.DATABASE_URL;
const COLS = {
  tasks: [["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["title", "text"], ["source_workflow", "text"], ["assignee_role", "text"], ["assignee_staff_id", "uuid"], ["done", "boolean"], ["is_demo", "boolean"], ["due_at", "timestamptz"], ["created_at", "timestamptz"], ["meeting_url", "text"]],
  clients: [["id", "uuid"], ["org_id", "uuid"], ["is_demo", "boolean"], ["custom_fields", "jsonb"], ["first_name", "text"], ["last_name", "text"], ["client_code", "text"], ["assigned_csm_staff_id", "uuid"]],
  events: [["id", "uuid"], ["org_id", "uuid"], ["client_id", "uuid"], ["name", "text"], ["is_demo", "boolean"], ["created_at", "timestamptz"]]
};
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${(++seq).toString(16).padStart(12, "0")}`;
const ago = (h) => new Date(NOW.getTime() - h * 3600e3).toISOString();

function fixtureDb(rows = {}) {
  const ctes = Object.entries(COLS).map(([name, cols]) => {
    const json = JSON.stringify(rows[name] || []).replace(/'/g, "''");
    return `${name} AS (SELECT * FROM jsonb_to_recordset('${json}'::jsonb) AS x(${cols.map(([c, t]) => `"${c}" ${t}`).join(", ")}))`;
  });
  return {
    async query(sql, params) {
      const t = String(sql).replace(/^\s*(\/\*[\s\S]*?\*\/\s*)+/, "");
      // The queue's own query starts with WITH. Join the fixture tables onto it.
      const lead = /^\s*WITH\s+/i.exec(t);
      return pgDb.query(lead ? `WITH ${ctes.join(", ")}, ${t.slice(lead[0].length)}` : `WITH ${ctes.join(", ")} ${t}`, params);
    }
  };
}

describe("gap-csm SQL and the queue handler on the Postgres engine, over fixture rows", { skip: HAVE_DB ? false : "no DATABASE_URL" }, () => {
  after(async () => { await closePg(); });
  const org = uid();
  const CL = uid();
  const CL2 = uid();
  const client = (o = {}) => ({ id: CL, org_id: org, is_demo: false, custom_fields: {}, first_name: "A", last_name: "B", client_code: "C-1", assigned_csm_staff_id: null, ...o });
  const task = (o = {}) => ({ id: uid(), org_id: org, client_id: CL, title: "Accountability call — halfway check-in", source_workflow: HANDLER_MID, assignee_role: "csm", assignee_staff_id: null, done: false, is_demo: false, due_at: ago(72), created_at: ago(100), meeting_url: null, ...o });
  const event = (name, o = {}) => ({ id: uid(), org_id: org, client_id: CL, name, is_demo: false, created_at: ago(48), ...o });

  async function statuses(rows, ctx = {}) {
    const out = await gapChecks({ db: fixtureDb(rows), orgId: org, now: NOW, ...ctx });
    return Object.fromEntries(out.map((r) => [r.id, r]));
  }

  test("the real queue handler runs its real SQL: a CSM task, or none, is PASS; a failing handler is FAIL", async () => {
    const Q = "csm:queue-api";
    assert.equal((await statuses({ tasks: [task({ due_at: ago(-100) })], clients: [client()] }))[Q].status, "PASS");
    assert.equal((await statuses({ tasks: [], clients: [client()] }))[Q].status, "PASS");
    const bad = await statuses({}, { queueHandler: async () => { throw new Error("view missing"); } });
    assert.equal(bad[Q].status, "FAIL");
  });

  test("overdue: nobody on a task more than a day late fails; owned, done, demo, recent, other role, no date do not", async () => {
    const O = "csm:overdue-unassigned";
    assert.equal((await statuses({ tasks: [task()], clients: [client()] }))[O].status, "FAIL");
    assert.equal((await statuses({ tasks: [task({ assignee_staff_id: uid() })], clients: [client()] }))[O].status, "PASS");
    assert.equal((await statuses({ tasks: [task({ due_at: ago(2) })], clients: [client()] }))[O].status, "PASS");
    assert.equal((await statuses({ tasks: [task({ done: true })], clients: [client()] }))[O].status, "PASS");
    assert.equal((await statuses({ tasks: [task({ is_demo: true })], clients: [client()] }))[O].status, "PASS");
    assert.equal((await statuses({ tasks: [task()], clients: [client({ is_demo: true })] }))[O].status, "PASS");
    assert.equal((await statuses({ tasks: [task()], clients: [client({ custom_fields: { synthetic: "true" } })] }))[O].status, "PASS");
    assert.equal((await statuses({ tasks: [task({ assignee_role: "closer" })], clients: [client()] }))[O].status, "PASS");
    assert.equal((await statuses({ tasks: [task({ due_at: null })], clients: [client()] }))[O].status, "PASS");
  });

  test("missing step: each money-in event and round.funded needs its own task", async () => {
    const M = "csm:missing-step";
    for (const name of MONEY_IN_EVENTS) {
      const r = (await statuses({ events: [event(name)], clients: [client()] }))[M];
      assert.equal(r.status, "FAIL", name);
      assert.match(r.detail, /no halfway accountability call/);
    }
    assert.equal((await statuses({ events: [event("deposit.paid")], clients: [client()], tasks: [task({ due_at: ago(-2000) })] }))[M].status, "PASS");
    assert.equal((await statuses({ events: [event("deposit.paid")], clients: [client()], tasks: [task({ done: true })] }))[M].status, "PASS");
    const post = (await statuses({ events: [event("round.funded")], clients: [client()] }))[M];
    assert.equal(post.status, "FAIL");
    assert.match(post.detail, /no results accountability call/);
    const withPost = task({ source_workflow: HANDLER_POST, title: "Accountability call — results and what's next" });
    assert.equal((await statuses({ events: [event("round.funded")], clients: [client()], tasks: [withPost] }))[M].status, "PASS");
    // A halfway task does not stand in for the results call.
    assert.equal((await statuses({ events: [event("round.funded")], clients: [client()], tasks: [task()] }))[M].status, "FAIL");
    const both = (await statuses({ events: [event("deposit.paid"), event("round.funded", { client_id: CL2 })], clients: [client(), client({ id: CL2 })] }))[M];
    assert.match(both.detail, /halfway accountability call; 1 client has no results accountability call/);
  });

  test("missing step: young events, old events, demo, and clientless events are not misses", async () => {
    const M = "csm:missing-step";
    assert.equal((await statuses({ events: [event("deposit.paid", { created_at: ago(0.08) })], clients: [client()] }))[M].status, "PASS");
    assert.equal((await statuses({ events: [event("deposit.paid", { created_at: ago(2400) })], clients: [client()] }))[M].status, "PASS");
    assert.equal((await statuses({ events: [event("deposit.paid", { is_demo: true })], clients: [client()] }))[M].status, "PASS");
    assert.equal((await statuses({ events: [event("deposit.paid")], clients: [client({ is_demo: true })] }))[M].status, "PASS");
    assert.equal((await statuses({ events: [event("deposit.paid", { client_id: null })], clients: [client()] }))[M].status, "PASS");
  });
});
