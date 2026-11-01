// Capital Blueprint / FinanceOS acceptance: current *policy observation*.
//
// These tests deliberately document that GET overview/banks presently grant
// every authenticated client access to their OWN data without checking for a
// paid FinanceOS subscription or active Blueprint entitlement. They do NOT
// decide whether those reads should be free previews or paid-only features.
// An approved policy change must update these assertions and cover both buyers
// and expired/non-buyer clients. All data is synthetic; no provider or DB IO.
import { test } from "node:test";
import assert from "node:assert/strict";
import overview from "../../api/money/overview.mjs";
import banks from "../../api/money/banks.mjs";

const ORG = "org-synthetic";
const MINE = "11111111-2222-4333-8444-555555555555";
const OTHER = "99999999-8888-4777-8666-555555555555";

function response() {
  return {
    statusCode: null, body: null, headers: {},
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

const principal = {
  kind: "client", accountId: "account-synthetic",
  orgId: ORG, clientId: MINE
};
const session = async () => principal;
const noDatabase = {
  async query() {
    throw new Error("Unplanned database access: a paid-entitlement query was not expected by the baseline");
  }
};

test("KNOWN BP-07 policy: client GET overview returns their own file without a paid-entitlement check", async () => {
  const res = response();
  let requested = null;
  await overview(
    { method: "GET", query: { client_id: OTHER } }, res,
    {
      db: noDatabase, requirePrincipal: session,
      moneyOverview: async (_db, args) => {
        requested = args;
        return { ok: true, clientId: args.clientId, preview: "synthetic" };
      },
      now: () => new Date("2026-10-29T00:00:00Z"), env: {}
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(requested.orgId, ORG);
  assert.equal(requested.clientId, MINE, "URL client_id must not override the session");
  assert.equal(res.body.clientId, MINE);
});

test("KNOWN BP-07 policy: client GET bank plan returns their own file without a paid-entitlement check", async () => {
  const res = response();
  let requested = null;
  await banks(
    { method: "GET", query: { client_id: OTHER } }, res,
    {
      db: noDatabase, requirePrincipal: session,
      bankStrategy: async (_db, args) => {
        requested = args;
        return { ok: true, clientId: args.clientId, recommended_banks: [], next_sequence: { suggestion: null } };
      },
      now: () => new Date("2026-10-29T00:00:00Z")
    }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(requested.orgId, ORG);
  assert.equal(requested.clientId, MINE);
  assert.equal(res.body.clientId, MINE);
});
