// Slice S3 proofs: finance doors whose older tests miss one named action.
// Container rename, and the soft-pull request ledger (consent gate, one open
// request, attribution). Real handlers and real logic, stand-in database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import containersHandler from "../../api/finance/containers.mjs";
import softPullHandler from "../../api/finance/soft-pull.mjs";
import askHandler from "../../api/read/finance-ask.mjs";
import cashflowHandler from "../../api/finance/cashflow.mjs";
import bankAccountsHandler from "../../api/finance/bank-accounts.mjs";
import { makeRes, fakeDb, req, staffSession, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { tableRules, clientsRule } from "../testing/s3-scoped-rows.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const BUSINESS = "e1000000-0000-4000-8000-0000000000e1";

describe("POST /api/finance/containers action=rename", () => {
  const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
  const container = (over = {}) => ({
    id: BUSINESS, org_id: ORG_ID, client_id: CLIENT, kind: "business", name: "Old Name LLC", archived_at: null, created_at: "2026-10-01T00:00:00.000Z", ...over
  });
  // The container table is live: the UPDATE only touches the rows its WHERE names.
  async function rename(body, entities) {
    const database = fakeDb([
      clientsRule([{ id: CLIENT, org_id: ORG_ID }]),
      ...tableRules("entities", entities, { set: (row, params) => { row.name = params[2]; } })
    ]);
    const res = makeRes();
    await containersHandler({ method: "POST", body }, res, {
      db: database, requireAuth: async () => ({ id: STAFF_ID, role: "owner", org_id: ORG_ID }), env: {}
    });
    return { res, database };
  }

  test("renames one container in this company and answers with the new name on that client's list", async () => {
    const entities = [container(), container({ id: "e2000000-0000-4000-8000-0000000000e2", name: "Other LLC" })];
    const { res, database } = await rename({ action: "rename", container_id: BUSINESS, name: "  Fundhub Holdings LLC " }, entities);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "rename");
    assert.equal(res.body.container_id, BUSINESS);
    assert.equal(res.body.client_id, CLIENT);
    assert.deepEqual(res.body.containers.map((c) => c.name).sort(), ["Fundhub Holdings LLC", "Other LLC"]);
    assert.deepEqual(database.find(/UPDATE entities SET name = \$3/)[0].params, [BUSINESS, ORG_ID, "Fundhub Holdings LLC", null]);
    assert.deepEqual(entities.map((e) => e.name), ["Fundhub Holdings LLC", "Other LLC"], "only the named container changed");
  });

  test("a container of another company is a 404 and nothing is renamed; an org_id in the body is refused", async () => {
    const entities = [container({ org_id: OTHER_ORG })];
    const missing = await rename({ action: "rename", container_id: BUSINESS, name: "X Co" }, entities);
    assert.equal(missing.res.statusCode, 404);
    assert.equal(missing.res.body.error, "container_not_found");
    assert.equal(entities[0].name, "Old Name LLC");
    const [update] = missing.database.find(/UPDATE entities SET name = \$3/);
    assert.match(update.sql, /WHERE id = \$1 AND org_id = \$2/, "the statement names the company");
    const sneaky = await rename({ action: "rename", container_id: BUSINESS, name: "X Co", org_id: OTHER_ORG }, [container()]);
    assert.equal(sneaky.res.statusCode, 400);
    assert.equal(sneaky.database.find(/UPDATE entities/).length, 0);
  });
});

describe("POST /api/finance/soft-pull", () => {
  const owns = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]];
  const consent = (valid) => [/FROM client_consents\s+WHERE org_id = \$1 AND client_id = \$2 AND kind = \$3/, [{
    id: "k1", client_id: CLIENT, org_id: ORG_ID, kind: "soft_pull_consent", granted_at: "2026-09-01T00:00:00.000Z",
    expires_at: null, revoked_at: valid ? null : "2026-10-01T00:00:00.000Z", is_valid: valid
  }]];
  const queued = (p) => ({
    id: "spr1", org_id: p[0], client_id: p[1], requested_by_kind: p[2], requested_by_staff_id: p[3], requested_by_account_id: p[4],
    reason: p[5], cost_cents: p[6], status: "queued", provider: p[9], idempotency_key: p[8]
  });
  const insert = [/INSERT INTO soft_pull_requests/, (_s, p) => [queued(p)]];
  const body = { client_id: CLIENT, reason: "Closer asked on the Present screen", cost_cents: 1500 };

  test("a consented client gets one queued request, stamped with the staff member and the typed cost", async () => {
    const { res, fake } = await callShared(softPullHandler, req("POST", { body }), [staffSession({ role: "closer" }), owns, consent(true), insert]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, true);
    assert.equal(res.body.request.status, "queued");
    const [ins] = fake.find(/INSERT INTO soft_pull_requests/);
    assert.deepEqual(ins.params.slice(0, 7), [ORG_ID, CLIENT, "staff", STAFF_ID, null, "Closer asked on the Present screen", 1500]);
    assert.equal(ins.params[9], "internal");
  });

  test("a client who has revoked consent is a 403 consent_required and nothing is queued", async () => {
    const { res, fake } = await callShared(softPullHandler, req("POST", { body }), [staffSession({ role: "closer" }), owns, consent(false), insert]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/INSERT INTO soft_pull_requests/).length, 0);
  });

  test("a second press while one is open returns the open one and queues nothing new", async () => {
    const open = { id: "spr0", org_id: ORG_ID, client_id: CLIENT, status: "queued", reason: "first press" };
    const { res, fake } = await callShared(softPullHandler, req("POST", { body }), [
      staffSession({ role: "closer" }), owns, consent(true), [/FROM soft_pull_requests\s+WHERE client_id = \$1 AND status IN/, [open]], insert
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.created, false);
    assert.equal(res.body.reason, "already_open");
    assert.equal(res.body.request.id, "spr0");
    assert.equal(fake.find(/INSERT INTO soft_pull_requests/).length, 0);
  });

  test("a client from another company, a role outside the pull roles, and a missing reason queue nothing", async () => {
    const other = await callShared(softPullHandler, req("POST", { body }), [staffSession({ role: "closer" }), [/SELECT 1 FROM clients/, []], consent(true), insert]);
    assert.equal(other.res.statusCode, 403);
    const setter = await callShared(softPullHandler, req("POST", { body }), [staffSession({ role: "setter" }), owns, consent(true), insert]);
    assert.equal(setter.res.statusCode, 403);
    const noReason = await callShared(softPullHandler, req("POST", { body: { client_id: CLIENT } }), [staffSession({ role: "closer" }), owns, consent(true), insert]);
    assert.equal(noReason.res.statusCode, 400);
    for (const out of [other, setter, noReason]) assert.equal(out.fake.find(/INSERT INTO soft_pull_requests/).length, 0);
  });
});

describe("GET /api/finance/soft-pull", () => {
  const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
  const pull = (id, client, over = {}) => ({
    id, org_id: ORG_ID, client_id: client, requested_by_kind: "staff", requested_by_staff_id: STAFF_ID, requested_by_account_id: null,
    reason: "Closer asked", cost_cents: 1500, status: "queued", provider: "internal", idempotency_key: null,
    requested_at: "2026-10-12T10:00:00.000Z", ...over
  });
  const history = (clients) => {
    const rows = [pull("spr1", CLIENT), pull("spr2", OTHER_CLIENT), pull("spr3", CLIENT, { requested_at: "2026-10-13T10:00:00.000Z", status: "done" })];
    return { rows, rules: [staffSession({ role: "closer" }), clientsRule(clients), ...tableRules("soft_pull_requests", rows)] };
  };
  const list = (rules) => callShared(softPullHandler, req("GET", { query: { client_id: CLIENT } }), rules);

  test("lists this client's pull history and no other client's; nothing is written", async () => {
    const { rules } = history([{ id: CLIENT, org_id: ORG_ID }, { id: OTHER_CLIENT, org_id: ORG_ID }]);
    const { res, fake } = await list(rules);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.deepEqual(res.body.requests.map((r) => r.id).sort(), ["spr1", "spr3"]);
    assert.ok(res.body.requests.every((r) => r.client_id === CLIENT));
    const [read] = fake.find(/FROM soft_pull_requests/);
    assert.equal(read.params[0], CLIENT);
    assert.match(read.sql, /WHERE client_id = \$1\s+ORDER BY requested_at DESC/);
    assert.equal(fake.find(/^\s*(INSERT|UPDATE|DELETE)/i).filter((c) => !/sessions/.test(c.sql)).length, 0);
  });

  test("a client of another company is a 403 and the history is not read", async () => {
    const { rules } = history([{ id: CLIENT, org_id: "0b000000-0000-4000-8000-000000000002" }]);
    const { res, fake } = await list(rules);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/FROM soft_pull_requests/).length, 0);
  });

  test("a client id that is not a uuid is a 400", async () => {
    const { rules } = history([]);
    const { res } = await callShared(softPullHandler, req("GET", { query: { client_id: "not-a-uuid" } }), rules);
    assert.equal(res.statusCode, 400);
  });
});

describe("POST /api/finance/cashflow action=acknowledge_reminder", () => {
  const REMINDER = "b1000000-0000-4000-8000-0000000000b1";
  const OTHER_REMINDER = "b2000000-0000-4000-8000-0000000000b2";
  const reminder = (id, org) => ({ id, org_id: org, client_id: CLIENT, acknowledged_at: null, acknowledged_by_kind: null, acknowledged_by_id: null });
  const ack = (id, reminders) => callShared(cashflowHandler, req("POST", { body: { action: "acknowledge_reminder", reminder_id: id } }), [
    staffSession({ role: "sales_manager" }),
    ...tableRules("cashflow_reminders", reminders, { set: (row, p) => { row.acknowledged_at = p[0]; row.acknowledged_by_kind = p[1]; row.acknowledged_by_id = p[2]; } })
  ]);

  test("stamps this company's reminder with who cleared it, once; the second press says who got there first", async () => {
    const reminders = [reminder(REMINDER, ORG_ID), reminder(OTHER_REMINDER, "0b000000-0000-4000-8000-000000000002")];
    const first = await ack(REMINDER, reminders);
    assert.equal(first.res.statusCode, 200);
    assert.equal(first.res.body.already, false);
    assert.equal(reminders[0].acknowledged_by_kind, "staff");
    assert.equal(reminders[0].acknowledged_by_id, STAFF_ID);
    assert.equal(reminders[1].acknowledged_at, null, "the other company's reminder is untouched");
    const stamped = reminders[0].acknowledged_at;
    const second = await ack(REMINDER, reminders);
    assert.equal(second.res.statusCode, 200);
    assert.equal(second.res.body.already, true);
    assert.equal(reminders[0].acknowledged_at, stamped, "the first acknowledgement wins");
  });

  test("another company's reminder is a 404 and is not acknowledged", async () => {
    const reminders = [reminder(OTHER_REMINDER, "0b000000-0000-4000-8000-000000000002")];
    const { res } = await ack(OTHER_REMINDER, reminders);
    assert.equal(res.statusCode, 404);
    assert.equal(reminders[0].acknowledged_at, null);
  });
});

describe("POST /api/finance/bank-accounts classify and close", () => {
  const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
  const OWN = "a1000000-0000-4000-8000-0000000000a1";
  const FOREIGN = "a2000000-0000-4000-8000-0000000000a2";
  const account = (id, org) => ({ id, org_id: org, client_id: CLIENT, entity_kind: "unknown", entity_kind_source: null, closed_at: null });
  const act = (body, accounts) => callShared(bankAccountsHandler, req("POST", { body }), [
    staffSession({ role: "owner" }),
    ...tableRules("bank_accounts", accounts, {
      set: (row, p, sql) => { if (/entity_kind\s*=/.test(sql)) row.entity_kind = p[2]; else row.closed_at = p[2]; }
    })
  ]);
  const classify = (id) => ({ action: "classify", account_id: id, entity_kind: "business", entity_kind_source: "staff_reviewed" });

  test("classifies and closes this company's account only", async () => {
    const accounts = [account(OWN, ORG_ID), account(FOREIGN, OTHER_ORG)];
    const classified = await act(classify(OWN), accounts);
    assert.equal(classified.res.statusCode, 200);
    assert.deepEqual(accounts.map((a) => a.entity_kind), ["business", "unknown"]);
    const closed = await act({ action: "close", account_id: OWN }, accounts);
    assert.equal(closed.res.statusCode, 200);
    assert.deepEqual(accounts.map((a) => a.closed_at !== null), [true, false]);
  });

  test("another company's account is refused and neither row changes", async () => {
    const accounts = [account(FOREIGN, OTHER_ORG)];
    const classified = await act(classify(FOREIGN), accounts);
    assert.ok([403, 404].includes(classified.res.statusCode), `got ${classified.res.statusCode}`);
    const closed = await act({ action: "close", account_id: FOREIGN }, accounts);
    assert.ok([403, 404].includes(closed.res.statusCode), `got ${closed.res.statusCode}`);
    assert.deepEqual([accounts[0].entity_kind, accounts[0].closed_at], ["unknown", null]);
    for (const out of [classified, closed]) assert.equal(out.fake.find(/UPDATE bank_accounts/).length, 0, "no write was even tried");
  });
});

describe("POST /api/read/finance-ask", () => {
  const CLIENT = "c1000000-0000-4000-8000-000000000001";
  async function ask(question, { accounts = [], cards = [], client = CLIENT, rules = [] } = {}) {
    const database = fakeDb([
      ...rules,
      [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]],
      [/FROM bank_accounts WHERE org_id = \$1/, accounts],
      [/FROM tradelines WHERE org_id = \$1/, cards],
      [/FROM investment_holdings ih/, []]
    ]);
    const res = makeRes();
    await askHandler({ method: "POST", body: { question, client_id: client } }, res, {
      db: database, requireAuth: async () => ({ id: STAFF_ID, role: "closer", org_id: ORG_ID })
    });
    return { res, database };
  }
  const cash = (cents, over = {}) => ({ account_type: "depository", current_balance_cents: cents, closed_at: null, ...over });

  test("can I afford $X is answered against the cash on hand, yes or no with the gap, and the question names this client only", async () => {
    const yes = await ask("Can I afford $1,500?", { accounts: [cash(200000)] });
    assert.equal(yes.res.statusCode, 200);
    assert.equal(yes.res.body.answer.thin_data, false);
    assert.match(yes.res.body.answer.text, /^Yes — known cash on hand is \$2000\.00, which covers \$1500\.00\./);
    assert.deepEqual(yes.res.body.answer.figures, [{ label: "cash_on_hand", value: "$2000.00" }, { label: "asked", value: "$1500.00" }]);
    for (const q of yes.database.find(/FROM (bank_accounts|tradelines) WHERE org_id/)) assert.deepEqual(q.params, [ORG_ID, CLIENT]);
    const no = await ask("can i afford $2,500", { accounts: [cash(200000)] });
    assert.match(no.res.body.answer.text, /^No — known cash on hand is \$2000\.00, short of the \$2500\.00 asked about by \$500\.00\./);
  });

  test("no balance on file is an honest cannot-answer, never a guessed number", async () => {
    const { res } = await ask("can I afford $100", { accounts: [] });
    assert.equal(res.body.answer.thin_data, true);
    assert.match(res.body.answer.text, /Cash on hand is unknown/);
    assert.deepEqual(res.body.answer.figures, []);
  });

  test("which card to pay down names the card with the highest use of its limit", async () => {
    const cards = [
      { client_id: CLIENT, lender: "Chase", credit_limit_cents: 1000000, current_balance_cents: 250000, closed_at: null },
      { client_id: CLIENT, lender: "Amex", credit_limit_cents: 500000, current_balance_cents: 400000, closed_at: null },
      { client_id: CLIENT, lender: "Old Card", credit_limit_cents: 500000, current_balance_cents: 499000, closed_at: "2025-01-01" }
    ];
    const { res } = await ask("Which card should I pay down first?", { cards });
    assert.match(res.body.answer.text, /^Amex — it is at 80\.0% utilization, the highest of the 2 card\(s\) in scope\./);
    assert.deepEqual(res.body.answer.figures, [{ label: "Amex", value: "80.0%" }, { label: "Chase", value: "25.0%" }]);
  });

  test("am I ready for another round is always a stated refusal, and a client of another company is a 404", async () => {
    const ready = await ask("Am I ready for another funding round?", { accounts: [cash(900000)] });
    assert.equal(ready.res.body.answer.thin_data, true);
    assert.match(ready.res.body.answer.text, /no funding-readiness rule yet/);
    const other = await ask("can I afford $5", { rules: [[/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, []]] });
    assert.equal(other.res.statusCode, 404);
    assert.equal(other.database.find(/FROM bank_accounts/).length, 0);
  });
});
