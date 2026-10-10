// GET /api/partner-marketing/usage — the real handler, run with no Postgres.
//
// Brand Studio's "Writing left" tile reads this door. Only the meter maths were
// tested; the partner-or-staff gate and the row-level scope it opens were not.
// This runs the door, including the transaction it opens off the shared pool.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/partner-marketing/usage.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { DEFAULT_TOKEN_CAP } from "../brand/meter.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID
} from "../testing/handler-harness.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";

const settings = (enabled, cap) => [/FROM partner_module_settings/, [{ marketing_suite_enabled: enabled, ai_token_cap_monthly: cap, org_id: ORG_ID }]];
const used = (n) => [/FROM partner_ai_usage/, [{ used: n }]];

async function call(request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

describe("GET /api/partner-marketing/usage", () => {
  test("is routed", () => {
    assert.equal(ROUTES["partner-marketing/usage"], handler);
  });

  test("POST is refused", async () => {
    const { res } = await call(req("POST"), [staffSession()]);
    assert.equal(res.statusCode, 405);
  });

  test("no session: 401", async () => {
    const { res, fake } = await call(req("GET", { query: { partner_id: PARTNER } }), []);
    assert.equal(res.statusCode, 401);
    assert.equal(fake.find(/partner_ai_usage/).length, 0);
  });

  test("no partner id: 400", async () => {
    const { res } = await call(req("GET", { query: {} }), [staffSession()]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "partner_id_required");
  });

  test("a partner cannot read another partner's budget", async () => {
    const { res, fake } = await call(
      req("GET", { query: { partner_id: OTHER_PARTNER } }),
      accountSession({ kind: "partner", partnerId: PARTNER })
    );
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/BEGIN/).length, 0);
  });

  test("a closer cannot read it (owner and admin only on the staff side)", async () => {
    const { res } = await call(req("GET", { query: { partner_id: PARTNER } }), [staffSession({ role: "closer" })]);
    assert.equal(res.statusCode, 403);
  });

  test("a partner reads their own budget inside their own row scope", async () => {
    const { res, fake } = await call(
      req("GET", { query: { partner_id: PARTNER } }),
      [...accountSession({ kind: "partner", partnerId: PARTNER }), settings(true, 100000), used(25000)]
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      { enabled: res.body.enabled, cap: res.body.cap, used: res.body.used, remaining: res.body.remaining },
      { enabled: true, cap: 100000, used: 25000, remaining: 75000 }
    );
    const sql = fake.calls.map((c) => c.sql);
    assert.equal(sql.filter((s) => s === "BEGIN").length, 1);
    assert.equal(sql.filter((s) => s === "COMMIT").length, 1);
    const scope = fake.find(/set_config\('fundhub\.partner_id'/);
    assert.deepEqual(scope[0].params, [PARTNER]);
    assert.deepEqual(fake.find(/set_config\('fundhub\.actor'/)[0].params, ["partner"]);
  });

  test("an owner reads it as staff; past the cap reads 0 left, never below", async () => {
    const { res, fake } = await call(
      req("GET", { query: { partner_id: PARTNER } }),
      [staffSession(), settings(true, null), used(DEFAULT_TOKEN_CAP + 10)]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.cap, DEFAULT_TOKEN_CAP);
    assert.equal(res.body.remaining, 0);
    assert.deepEqual(fake.find(/set_config\('fundhub\.actor'/)[0].params, ["staff"]);
  });

  test("a failed read rolls back and answers 500, not a made-up number", async () => {
    const { res, fake } = await call(
      req("GET", { query: { partner_id: PARTNER } }),
      [staffSession(), [/FROM partner_module_settings/, new Error("relation does not exist")]]
    );
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.ok, false);
    assert.equal(fake.calls.filter((c) => c.sql === "ROLLBACK").length, 1);
  });
});
