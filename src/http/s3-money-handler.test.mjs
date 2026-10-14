// Slice S3 proofs: money-page doors. The real api/money/* handler runs with the
// real logic behind it and a stand-in database; the handler is handed a
// principal the way its own deps seam allows, so no session table is needed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import readyHandler from "../../api/money/ready-to-fund.mjs";
import alertsHandler from "../../api/money/alerts.mjs";
import paymentsHandler from "../../api/money/payments.mjs";
import { makeRes } from "../testing/handler-harness.mjs";
import { strictFakeDb as fakeDb } from "../testing/s3-handler-call.mjs";
import {
  memTasksDb, gateAs, clientPrincipal, staffPrincipal, FINANCE_OS_ROLES, NOT_FINANCE_OS_ROLES
} from "../testing/s3-mem-tasks-db.mjs";
import { CSM_PREP_SOURCE, CSM_PREP_TITLE } from "../blueprint/closer-ready.mjs";
import { requestReadyToFund, readyToFundStatus } from "../finance/ready-to-fund.mjs";
import { createBlueprintCsmPrepCallTask } from "../blueprint/closer-ready.mjs";
import { logMoneyAction } from "../finance/clarity-payments.mjs";
import { assertSqlHas } from "../testing/s3-scoped-rows.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const CSM = "c5c50000-0000-4000-8000-000000000001";
/** The one client on file, in company A, with the CSM that holds the file (or none). */
const fileDb = ({ csm = null, org = ORG } = {}) => memTasksDb({ clients: [{ id: CLIENT, org_id: org, assigned_csm_staff_id: csm }] });
const CARD = "a1000000-0000-4000-8000-0000000000cd";
const NOW = () => new Date("2026-10-13T15:00:00Z");

async function call(handler, request, principal, database, deps = {}) {
  const res = makeRes();
  await handler(request, res, { db: database, requirePrincipal: gateAs(principal), now: NOW, env: {}, ...deps });
  return res;
}

describe("POST /api/money/ready-to-fund", () => {
  test("the press opens one closing-prep call for the CSM, once while it is open, and logs it once", async () => {
    const mem = fileDb({ csm: CSM });
    const press = () => call(readyHandler, { method: "POST", body: {} }, clientPrincipal(CLIENT, ORG), mem);

    const first = await press();
    assert.equal(first.statusCode, 200);
    assert.equal(first.body.created, true);
    assert.equal(first.body.status, "csm_assigned");
    assert.equal(first.body.round, 1);
    assert.equal(mem.state.tasks.length, 1);
    const [task] = mem.state.tasks;
    assert.equal(task.client_id, CLIENT);
    assert.equal(task.org_id, ORG);
    assert.equal(task.title, CSM_PREP_TITLE);
    assert.equal(task.source_workflow, CSM_PREP_SOURCE);
    assert.equal(task.assignee_role, "csm");
    assert.equal(task.assignee_staff_id, CSM);
    assert.equal(mem.state.log.length, 1);
    assert.equal(mem.state.log[0].action, "ready_to_fund");
    assert.equal(mem.state.log[0].actor, "client");

    const second = await press();
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.created, false);
    assert.equal(mem.state.tasks.length, 1, "a second press while one is open adds no task");
    assert.equal(mem.state.log.length, 1);
  });

  // The stand-in rebuilds the join and the unique keys itself, so the clauses the product relies on are pinned in
  // the text it sent: this company's tasks of this process for this client, the open round, and the claim.
  test("the read joins only this company's prep-call tasks for this file, and the write claims are idempotent in the database", async () => {
    const mem = fileDb({ csm: CSM });
    await call(readyHandler, { method: "POST", body: {} }, clientPrincipal(CLIENT, ORG), mem);
    const sqlOf = (re) => mem.sql.find((s) => re.test(s.sql)).sql;
    assertSqlHas(sqlOf(/FROM clients c\s+LEFT JOIN tasks t/), {
      "the file, in this company": "WHERE c.id = $1 AND c.org_id = $2",
      "tasks of the same company and client": "ON t.client_id = c.id AND t.org_id = c.org_id",
      "only the prep-call process": "AND t.source_workflow = $3",
      "the first round or a later round": "AND (t.body = $4 OR t.body LIKE $5)"
    });
    assertSqlHas(sqlOf(/UPDATE money_agent_log SET task_id/), { "the log row it just wrote": "SET task_id = $2 WHERE id = $1" });
    assertSqlHas(sqlOf(/INSERT INTO tasks/), { "a task that exists is absorbed, not an error": "ON CONFLICT DO NOTHING RETURNING id" });
    assertSqlHas(sqlOf(/INSERT INTO money_agent_log/), { "a log row with this key is absorbed": "ON CONFLICT DO NOTHING RETURNING id" });
  });

  test("two presses that land together make one task and one log row: the second is absorbed by the database", async () => {
    const mem = memTasksDb({ clients: [{ id: CLIENT, org_id: ORG, assigned_csm_staff_id: CSM }], race: true });
    const first = await createBlueprintCsmPrepCallTask(mem, { orgId: ORG, clientId: CLIENT, eventId: "blueprint-csm-prep-call" });
    const second = await createBlueprintCsmPrepCallTask(mem, { orgId: ORG, clientId: CLIENT, eventId: "blueprint-csm-prep-call" });
    assert.equal(first.created, true);
    assert.equal(second.created, false);
    assert.equal(mem.state.tasks.length, 1);
    const entry = { orgId: ORG, clientId: CLIENT, itemKind: "client", decidedOn: "2026-10-13", action: "ready_to_fund", idempotencyKey: `ready:${CLIENT}:r1` };
    const logged = await logMoneyAction(mem, entry);
    const again = await logMoneyAction(mem, entry);
    assert.deepEqual([logged.created, again.created, mem.state.log.length], [true, false, 1]);
  });

  test("after the CSM finishes the call, a new press opens round 2", async () => {
    const mem = fileDb();
    const press = () => call(readyHandler, { method: "POST", body: {} }, clientPrincipal(CLIENT, ORG), mem);
    await press();
    mem.state.tasks[0].done = true;
    const again = await press();
    assert.equal(again.body.created, true);
    assert.equal(again.body.round, 2);
    assert.equal(mem.state.tasks.length, 2);
    assert.equal(mem.state.tasks[1].body, "blueprint-csm-prep-call:r2");
  });

  test("staff press for a client in their company is stamped staff", async () => {
    const mem = fileDb();
    const ok = await call(readyHandler, { method: "POST", body: { client_id: CLIENT } }, staffPrincipal("owner", ORG), mem);
    assert.equal(ok.statusCode, 200);
    assert.equal(mem.state.log.length, 1);
    assert.equal(mem.state.log[0].actor, "staff");
    assert.equal(mem.state.tasks[0].client_id, CLIENT);
  });

  // The client sits in company B. Nothing here says "refuse": the stand-in only
  // answers a `clients` statement with the row its id AND org conditions name, so
  // the 404 and the empty task list come from the product's own two company checks.
  test("staff of another company get a 404 on GET and on the press, and no task or log row is written", async () => {
    const mem = fileDb({ org: OTHER_ORG });
    const press = await call(readyHandler, { method: "POST", body: { client_id: CLIENT } }, staffPrincipal("owner", ORG), mem);
    assert.equal(press.statusCode, 404);
    assert.equal(press.body.error, "not_found");
    assert.deepEqual([mem.state.tasks.length, mem.state.log.length], [0, 0]);
    const read = await call(readyHandler, { method: "GET", query: { client_id: CLIENT } }, staffPrincipal("owner", ORG), mem);
    assert.equal(read.statusCode, 404);
    const own = await call(readyHandler, { method: "GET", query: { client_id: CLIENT } }, staffPrincipal("owner", OTHER_ORG), mem);
    assert.equal(own.statusCode, 200, "the company that owns the client still reads it");
    assert.equal(own.body.status, "none");
  });

  test("each company check holds on its own: the door never reaches the logic, and the logic alone writes nothing", async () => {
    const mem = fileDb({ org: OTHER_ORG });
    const reached = [];
    const spy = async (...args) => { reached.push(args); return { status: "none" }; };
    const door = await call(readyHandler, { method: "POST", body: { client_id: CLIENT } }, staffPrincipal("owner", ORG), mem, {
      requestReadyToFund: spy, readyToFundStatus: spy
    });
    assert.equal(door.statusCode, 404);
    assert.equal(reached.length, 0, "the handler's own check stops it before the logic runs");
    const ask = { orgId: ORG, clientId: CLIENT };
    assert.equal(await requestReadyToFund(mem, { ...ask, actor: "staff", todayIso: "2026-10-13" }), null);
    assert.equal(await readyToFundStatus(mem, ask), null);
    assert.deepEqual([mem.state.tasks.length, mem.state.log.length], [0, 0]);
  });

  test("only owner, admin, sales manager and closer may press for a client; any other staff role is a 403 before any lookup", async () => {
    for (const role of FINANCE_OS_ROLES) {
      const mem = fileDb();
      const out = await call(readyHandler, { method: "POST", body: { client_id: CLIENT } }, staffPrincipal(role, ORG), mem);
      assert.equal(out.statusCode, 200, role);
      assert.equal(mem.state.tasks.length, 1, role);
    }
    for (const role of NOT_FINANCE_OS_ROLES) {
      const mem = fileDb();
      const seen = [];
      const watched = { query: (sql, params) => { seen.push(sql); return mem.query(sql, params); } };
      const out = await call(readyHandler, { method: "POST", body: { client_id: CLIENT } }, staffPrincipal(role, ORG), watched);
      assert.equal(out.statusCode, 403, role);
      assert.equal(out.body.error, "forbidden", role);
      assert.match(out.body.message, /limited to/, role);
      assert.deepEqual([seen.length, mem.state.tasks.length, mem.state.log.length], [0, 0, 0], role);
    }
  });
});

describe("POST /api/money/alerts", () => {
  const card = [/FROM bank_accounts WHERE id = \$1 AND org_id = \$2 AND client_id = \$3/, [{ id: CARD, account_type: "credit", closed_at: null, name: "Chase Ink", mask: "4242" }]];
  const post = (body, database) => call(alertsHandler, { method: "POST", body }, clientPrincipal(CLIENT, ORG), database);
  // The handler's own client check reads `clients`; everything else is the real store.
  const withClientCheck = (rules) => fakeDb([[/FROM clients/, [{ "?column?": 1 }]], ...rules]);

  test("set_alert switches one alert kind for this client and answers with that kind and state", async () => {
    const database = withClientCheck([[/FROM file_protection_settings/, []]]);
    const res = await post({ action: "set_alert", kind: "promo_end", enabled: false }, database);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, action: "set_alert", saved: { kind: "promo_end", enabled: false } });
    const [write] = database.find(/INSERT INTO file_protection_settings/);
    assert.match(write.sql, /\(org_id, client_id, promo_end, updated_by_kind\)/);
    assert.deepEqual(write.params, [ORG, CLIENT, false, "client"]);
  });

  test("set_promo stores the promo end day and rate on the client's own card; null clears it", async () => {
    const database = withClientCheck([card, [/INSERT INTO account_statement_cycles/, [{ ends_on: "2026-12-06", promo_apr: "0", promo_source: "client", promo_set_at: "2026-10-13T15:00:00Z" }]]]);
    const res = await post({ action: "set_promo", account_id: CARD, ends_on: "2026-12-06", apr_pct: 0 }, database);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.saved, { account_id: CARD, cleared: false, promo: { ends_on: "2026-12-06", apr: 0, source: "client", set_at: "2026-10-13T15:00:00Z" } });
    const [promo] = database.find(/INSERT INTO account_statement_cycles/);
    assert.deepEqual(promo.params, [ORG, CLIENT, CARD, "2026-12-06", 0, "client"]);
    assertSqlHas(promo.sql, { "a cycle row that is another client's is never overwritten": "WHERE account_statement_cycles.org_id = EXCLUDED.org_id AND account_statement_cycles.client_id = EXCLUDED.client_id" });
    const clear = withClientCheck([card]);
    const cleared = await post({ action: "set_promo", account_id: CARD, ends_on: null }, clear);
    assert.equal(cleared.body.saved.cleared, true);
    assert.deepEqual(clear.find(/SET promo_ends_on = NULL/)[0].params, [CARD, ORG, CLIENT]);
  });

  test("set_statement_close_day stores a day 1 to 31, and 32 is refused with nothing written", async () => {
    const database = withClientCheck([card, [/INSERT INTO account_statement_cycles/, [{ statement_close_day: 15 }]]]);
    const res = await post({ action: "set_statement_close_day", account_id: CARD, day: 15 }, database);
    assert.deepEqual(res.body, { ok: true, action: "set_statement_close_day", saved: { account_id: CARD, statement_close_day: 15 } });
    const [day] = database.find(/INSERT INTO account_statement_cycles/);
    assert.deepEqual(day.params, [ORG, CLIENT, CARD, 15]);
    assertSqlHas(day.sql, { "a cycle row that is another client's is never overwritten": "WHERE account_statement_cycles.org_id = EXCLUDED.org_id AND account_statement_cycles.client_id = EXCLUDED.client_id" });
    const bad = withClientCheck([card]);
    const refused = await post({ action: "set_statement_close_day", account_id: CARD, day: 32 }, bad);
    assert.equal(refused.statusCode, 400);
    assert.equal(bad.find(/INSERT INTO account_statement_cycles/).length, 0);
  });

  test("a card that is not this client's is a 404 and no cycle row is written", async () => {
    const database = withClientCheck([[/FROM bank_accounts WHERE id/, []]]);
    const res = await post({ action: "set_promo", account_id: CARD, ends_on: "2026-12-06" }, database);
    assert.equal(res.statusCode, 404);
    assert.equal(database.find(/account_statement_cycles/).length, 0);
  });
});

describe("POST /api/money/payments action=ask_for_person", () => {
  test("a client's ask opens one CSM task for the day and the helper is told to stop texting", async () => {
    const mem = fileDb();
    const ask = () => call(paymentsHandler, { method: "POST", body: { action: "ask_for_person", note: "Call me about the Chase card" } }, clientPrincipal(CLIENT, ORG), mem);
    const first = await ask();
    assert.equal(first.statusCode, 200);
    assert.deepEqual(first.body, { ok: true, action: "ask_for_person", created: true });
    assert.equal(mem.state.tasks.length, 1);
    assert.equal(mem.state.tasks[0].assignee_role, "csm");
    assert.equal(mem.state.tasks[0].source_workflow, "money-agent");
    assert.equal(mem.state.tasks[0].client_id, CLIENT);
    assert.match(mem.state.tasks[0].body, /^money-agent:asked:.+:2026-10-13\nCall me about the Chase card$/);
    assert.equal(mem.state.log[0].action, "asked_for_person");
    assert.equal(mem.state.log[0].actor, "client");
    const again = await ask();
    assert.equal(again.body.created, false);
    assert.equal(mem.state.tasks.length, 1, "asking twice in one day is still one task");
  });

  test("two asks that land together still make one task: the second is absorbed by the database, not an error", async () => {
    const mem = memTasksDb({ clients: [{ id: CLIENT, org_id: ORG, assigned_csm_staff_id: null }], race: true });
    const ask = () => call(paymentsHandler, { method: "POST", body: { action: "ask_for_person", note: "Call me" } }, clientPrincipal(CLIENT, ORG), mem);
    const first = await ask();
    const second = await ask();
    assert.deepEqual([first.statusCode, first.body.created], [200, true]);
    assert.deepEqual([second.statusCode, second.body.created], [200, false]);
    assert.equal(mem.state.tasks.length, 1);
  });
});
