// Slice S3 proofs: finance doors whose older tests miss one named action.
// Container rename, and the soft-pull request ledger (consent gate, one open
// request, attribution). Real handlers and real logic, stand-in database.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import containersHandler from "../../api/finance/containers.mjs";
import softPullHandler from "../../api/finance/soft-pull.mjs";
import { makeRes, fakeDb, req, staffSession, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
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
