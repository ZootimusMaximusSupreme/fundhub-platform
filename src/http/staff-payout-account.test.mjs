import { test } from "node:test";
import assert from "node:assert/strict";
import write from "../../api/staff/payout-account.mjs";
import read from "../../api/read/staff-payout-account.mjs";

const ORG = "00000000-0000-4000-8000-000000000001";
const SELF = "00000000-0000-4000-8000-000000000002";
const OTHER = "00000000-0000-4000-8000-000000000003";
const auth = (role) => async (req) => {
  req.session = { mfaVerifiedAt: new Date() };
  return { id: SELF, org_id: ORG, role };
};
function response() { return { statusCode: 200, body: null, headers: {},
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  setHeader(key, value) { this.headers[key] = value; }
}; }
const noDb = { query() { throw new Error("database should not be read"); } };

test("staff bank write is self-only for closer and sales manager", async () => {
  for (const role of ["owner", "admin", "setter"]) {
    const res = response();
    await write({ method: "POST", body: { action: "link_token" } }, res,
      { db: noDb, requireAuth: auth(role) });
    assert.equal(res.statusCode, 403);
  }
  for (const role of ["closer", "sales_manager"]) {
    const res = response();
    await write({ method: "POST", body: { action: "link_token", staff_id: OTHER } }, res,
      { db: noDb, requireAuth: auth(role), startLink: async ({ staffId }) => {
        assert.equal(staffId, SELF); return { ok: true, linkToken: "link", environment: "production" };
      } });
    assert.equal(res.statusCode, 200);
  }
  const secondary = response();
  await write({ method: "POST", body: { action: "link_token" } }, secondary,
    { db: noDb, requireAuth: async (req) => { req.session = { mfaVerifiedAt: new Date() };
      return { id: SELF, org_id: ORG, role: "setter", roles: ["setter", "closer"] }; },
      startLink: async () => ({ ok: true, linkToken: "link", environment: "production" }) });
  assert.equal(secondary.statusCode, 200);
});

test("bank exchange takes employee identity from session, never request", async () => {
  const res = response();
  await write({ method: "POST", body: { action: "exchange", staff_id: OTHER,
    public_token: "public", account_id: "acct" } }, res,
  { db: noDb, requireAuth: auth("closer"), completeLink: async (database, args) => {
    assert.equal(args.staffId, SELF);
    assert.equal(args.orgId, ORG);
    assert.equal(args.accountId, "acct");
    return { ok: true, account: { mask: "1234" } };
  } });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.account, { mask: "1234" });
});

test("MFA rollout gates both payout Link creation and bank exchange", async () => {
  for (const action of ["link_token", "exchange"]) {
    const res = response();
    await write({ method: "POST", body: { action, public_token: "public" } }, res,
      { db: noDb, env: { MFA_REQUIRED: "1" }, requireAuth: async () =>
        ({ id: SELF, org_id: ORG, role: "closer" }),
        startLink: async () => { throw new Error("must not start Link"); },
        completeLink: async () => { throw new Error("must not exchange token"); } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "mfa_required");
  }
});

test("an old MFA session cannot change a payout bank", async () => {
  const res = response();
  await write({ method: "POST", body: { action: "link_token" } }, res,
    { db: noDb, requireAuth: async (req) => {
      req.session = { mfaVerifiedAt: new Date(Date.now() - 16 * 60 * 1000) };
      return { id: SELF, org_id: ORG, role: "closer" };
    }, startLink: async () => { throw new Error("must not start Link"); } });
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, "mfa_required");
});

test("owner masked read is same-org; employees cannot read another staff id", async () => {
  let res = response();
  await read({ method: "GET", query: { staff_id: OTHER } }, res,
    { db: noDb, requireAuth: auth("closer") });
  assert.equal(res.statusCode, 403);

  const db = { async query(sql, params) {
    assert.match(String(sql), /org_id=\$2/);
    assert.deepEqual(params, [OTHER, ORG]);
    return { rows: [{ id: OTHER }] };
  } };
  res = response();
  await read({ method: "GET", query: { staff_id: OTHER } }, res,
    { db, requireAuth: auth("owner"), currentAccount: async (database, args) => {
      assert.deepEqual(args, { orgId: ORG, staffId: OTHER });
      return { institution: "Bank", mask: "1234", status: "active" };
    } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.account.mask, "1234");

  res = response();
  await read({ method: "GET", query: { staff_id: OTHER } }, res,
    { db: { query: async () => ({ rows: [] }) }, requireAuth: auth("owner") });
  assert.equal(res.statusCode, 404);
});
