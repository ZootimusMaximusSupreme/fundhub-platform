// Slice S3 proofs: finance doors whose older tests miss one named action.
// Container rename, and the soft-pull request ledger (consent gate, one open
// request, attribution). Real handlers and real logic, stand-in database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import containersHandler from "../../api/finance/containers.mjs";
import softPullHandler from "../../api/finance/soft-pull.mjs";
import askHandler from "../../api/read/finance-ask.mjs";
import { makeRes, fakeDb, req, staffSession, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const BUSINESS = "e1000000-0000-4000-8000-0000000000e1";

describe("POST /api/finance/containers action=rename", () => {
  async function rename(body, rules) {
    const database = fakeDb([[/FROM clients/, [{ "?column?": 1 }]], ...rules]);
    const res = makeRes();
    await containersHandler({ method: "POST", body }, res, {
      db: database, requireAuth: async () => ({ id: STAFF_ID, role: "owner", org_id: ORG_ID }), env: {}
    });
    return { res, database };
  }

  test("renames one container in this company and answers with the new name on that client's list", async () => {
    const renamed = { id: BUSINESS, client_id: CLIENT, kind: "business", name: "Fundhub Holdings LLC", archived_at: null, created_at: "2026-10-01T00:00:00.000Z" };
    const { res, database } = await rename({ action: "rename", container_id: BUSINESS, name: "  Fundhub Holdings LLC " }, [
      [/UPDATE entities SET name = \$3/, [renamed]],
      [/FROM entities\s+WHERE org_id/, [renamed]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "rename");
    assert.equal(res.body.container_id, BUSINESS);
    assert.equal(res.body.client_id, CLIENT);
    assert.equal(res.body.containers[0].name, "Fundhub Holdings LLC");
    assert.deepEqual(database.find(/UPDATE entities SET name = \$3/)[0].params, [BUSINESS, ORG_ID, "Fundhub Holdings LLC", null]);
  });

  test("a container of another company is a 404 and nothing is renamed; an org_id in the body is refused", async () => {
    const missing = await rename({ action: "rename", container_id: BUSINESS, name: "X Co" }, [[/UPDATE entities SET name/, []]]);
    assert.equal(missing.res.statusCode, 404);
    assert.equal(missing.res.body.error, "container_not_found");
    const sneaky = await rename({ action: "rename", container_id: BUSINESS, name: "X Co", org_id: "0b000000-0000-4000-8000-000000000002" }, []);
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
