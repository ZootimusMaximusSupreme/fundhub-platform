// Slice S3 proofs: money-page doors. The real api/money/* handler runs with the
// real logic behind it and a stand-in database; the handler is handed a
// principal the way its own deps seam allows, so no session table is needed.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import readyHandler from "../../api/money/ready-to-fund.mjs";
import alertsHandler from "../../api/money/alerts.mjs";
import paymentsHandler from "../../api/money/payments.mjs";
import { makeRes, fakeDb } from "../testing/handler-harness.mjs";
import { memTasksDb, gateAs, clientPrincipal, staffPrincipal } from "../testing/s3-mem-tasks-db.mjs";
import { CSM_PREP_SOURCE, CSM_PREP_TITLE } from "../blueprint/closer-ready.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const CLIENT = "c1000000-0000-4000-8000-000000000001";
const CARD = "a1000000-0000-4000-8000-0000000000cd";
const NOW = () => new Date("2026-10-13T15:00:00Z");

async function call(handler, request, principal, database, deps = {}) {
  const res = makeRes();
  await handler(request, res, { db: database, requirePrincipal: gateAs(principal), now: NOW, env: {}, ...deps });
  return res;
}

describe("POST /api/money/ready-to-fund", () => {
  test("the press opens one closing-prep call for the CSM, once while it is open, and logs it once", async () => {
    const mem = memTasksDb({ assignedCsm: "c5c50000-0000-4000-8000-000000000001" });
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
    assert.equal(mem.state.log.length, 1);
    assert.equal(mem.state.log[0].action, "ready_to_fund");
    assert.equal(mem.state.log[0].actor, "client");

    const second = await press();
    assert.equal(second.statusCode, 200);
    assert.equal(second.body.created, false);
    assert.equal(mem.state.tasks.length, 1, "a second press while one is open adds no task");
    assert.equal(mem.state.log.length, 1);
  });

  test("after the CSM finishes the call, a new press opens round 2", async () => {
    const mem = memTasksDb();
    const press = () => call(readyHandler, { method: "POST", body: {} }, clientPrincipal(CLIENT, ORG), mem);
    await press();
    mem.state.tasks[0].done = true;
    const again = await press();
    assert.equal(again.body.created, true);
    assert.equal(again.body.round, 2);
    assert.equal(mem.state.tasks.length, 2);
    assert.equal(mem.state.tasks[1].body, "blueprint-csm-prep-call:r2");
  });

  test("staff press for a client in their company is stamped staff; another company's client is a 404 with no task", async () => {
    const mem = memTasksDb();
    const inCompany = fakeDbWithClient(mem, [CLIENT]);
    const ok = await call(readyHandler, { method: "POST", body: { client_id: CLIENT } }, staffPrincipal("owner", ORG), inCompany);
    assert.equal(ok.statusCode, 200);
    assert.equal(mem.state.log[0].actor, "staff");
    const other = memTasksDb({ inOrg: false });
    const refused = await call(readyHandler, { method: "POST", body: { client_id: CLIENT } }, staffPrincipal("owner", ORG), fakeDbWithClient(other, []));
    assert.equal(refused.statusCode, 404);
    assert.equal(other.state.tasks.length, 0);
  });
});

/** Answers the org-boundary check, then hands everything else to the in-memory db. */
function fakeDbWithClient(mem, clientIds) {
  return {
    query: (sql, params) => (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(sql)
      ? { rows: clientIds.includes(params[0]) ? [{ "?column?": 1 }] : [] }
      : mem.query(sql, params))
  };
}

describe("POST /api/money/alerts", () => {
  const card = [/FROM bank_accounts WHERE id = \$1 AND org_id = \$2 AND client_id = \$3/, [{ id: CARD, account_type: "credit", closed_at: null, name: "Chase Ink", mask: "4242" }]];
  const clientDb = (rules = []) => fakeDb([...rules]);
  const post = (body, database) => call(alertsHandler, { method: "POST", body }, clientPrincipal(CLIENT, ORG), database, {
    // the handler's own client check reads `clients`; everything else is the real store
  });
  const withClientCheck = (rules) => {
    const inner = fakeDb([[/FROM clients/, [{ "?column?": 1 }]], ...rules]);
    return inner;
  };

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
    assert.deepEqual(database.find(/INSERT INTO account_statement_cycles/)[0].params, [ORG, CLIENT, CARD, "2026-12-06", 0, "client"]);
    const clear = withClientCheck([card]);
    const cleared = await post({ action: "set_promo", account_id: CARD, ends_on: null }, clear);
    assert.equal(cleared.body.saved.cleared, true);
    assert.deepEqual(clear.find(/SET promo_ends_on = NULL/)[0].params, [CARD, ORG, CLIENT]);
  });

  test("set_statement_close_day stores a day 1 to 31, and 32 is refused with nothing written", async () => {
    const database = withClientCheck([card, [/INSERT INTO account_statement_cycles/, [{ statement_close_day: 15 }]]]);
    const res = await post({ action: "set_statement_close_day", account_id: CARD, day: 15 }, database);
    assert.deepEqual(res.body, { ok: true, action: "set_statement_close_day", saved: { account_id: CARD, statement_close_day: 15 } });
    assert.deepEqual(database.find(/INSERT INTO account_statement_cycles/)[0].params, [ORG, CLIENT, CARD, 15]);
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
    const mem = memTasksDb();
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
});
