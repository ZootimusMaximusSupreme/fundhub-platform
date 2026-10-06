// POST /api/banking/link-token and /api/banking/link-exchange — endpoint tests,
// plus the Plaid→store account mapping. Stubbed db, auth and Plaid; no network.
import { test, describe } from "node:test";
import assert from "node:assert";

import linkToken from "../../api/banking/link-token.mjs";
import linkExchange from "../../api/banking/link-exchange.mjs";
import { toStoreAccount } from "../banking/plaid-link.mjs";
import { createLinkToken, sandboxPublicToken } from "../banking/providers/plaid-http.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const CLIENT_ID = "11111111-2222-3333-4444-555555555555";
const OWNER = { id: "s1", role: "owner", org_id: "org-1" };
const CLOSER = { id: "s2", role: "closer", org_id: "org-1" };
const db = (clientRows = [{ "?column?": 1 }]) => ({
  query: async (sql) => (/FROM clients/.test(sql) ? { rows: clientRows } : { rows: [] })
});
const authAs = (staff) => async () => staff;

describe("POST /api/banking/link-token", () => {
  test("405 on GET", async () => {
    const res = makeRes();
    await linkToken({ method: "GET" }, res, { db: db(), requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 405);
  });

  test("403 for a role outside FINANCE", async () => {
    const res = makeRes();
    await linkToken({ method: "POST", body: { client_id: CLIENT_ID } }, res,
      { db: db(), requireAuth: authAs(CLOSER), startLink: async () => assert.fail("must not start") });
    assert.equal(res.statusCode, 403);
  });

  test("404 for a client outside the org", async () => {
    const res = makeRes();
    await linkToken({ method: "POST", body: { client_id: CLIENT_ID } }, res,
      { db: db([]), requireAuth: authAs(OWNER), startLink: async () => assert.fail("must not start") });
    assert.equal(res.statusCode, 404);
  });

  test("503 names missing keys when Plaid is not configured", async () => {
    const res = makeRes();
    await linkToken({ method: "POST", body: { client_id: CLIENT_ID } }, res,
      { db: db(), requireAuth: authAs(OWNER), env: {} });
    assert.equal(res.statusCode, 503);
    assert.ok(res.body.missing.includes("PLAID_SECRET"));
  });

  test("200 hands back the link token", async () => {
    const res = makeRes();
    await linkToken({ method: "POST", body: { client_id: CLIENT_ID } }, res, {
      db: db(), requireAuth: authAs(OWNER),
      startLink: async ({ clientId }) => {
        assert.equal(clientId, CLIENT_ID);
        return { ok: true, linkToken: "link-sandbox-x", expiration: "2026-10-06T00:00:00Z", environment: "sandbox" };
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.link_token, "link-sandbox-x");
  });
});

describe("POST /api/banking/link-exchange", () => {
  test("400 without a public_token", async () => {
    const res = makeRes();
    await linkExchange({ method: "POST", body: { client_id: CLIENT_ID } }, res,
      { db: db(), requireAuth: authAs(OWNER) });
    assert.equal(res.statusCode, 400);
  });

  test("org comes from the session, never the body", async () => {
    const res = makeRes();
    let seen;
    await linkExchange({ method: "POST", body: { client_id: CLIENT_ID, public_token: "public-x", org_id: "evil" } }, res, {
      db: db(), requireAuth: authAs(OWNER), now: () => new Date("2026-10-06T12:00:00Z"),
      completeLink: async (_db, args) => {
        seen = args;
        return {
          ok: true, itemRowId: "item-1", environment: "sandbox", institutionName: "X (Plaid sandbox — test data)",
          written: 1, accounts: [{ id: "a1", name: "Plaid Credit Card", mask: "3333", account_type: "credit",
            account_subtype: "credit card", entity_kind: "unknown" }]
        };
      }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(seen.orgId, "org-1");
    assert.equal(seen.asOf, "2026-10-06T12:00:00.000Z");
    assert.equal(res.body.accounts[0].type, "credit");
    assert.equal(JSON.stringify(res.body).includes("access"), false, "no token in the response");
  });
});

describe("toStoreAccount", () => {
  test("credit card keeps its limit in cents and null balances stay null", () => {
    const row = toStoreAccount({
      plaidAccountId: "acc1", name: "Business Card", officialName: null, mask: "4444",
      type: "credit", subtype: "credit card", currentBalance: 410.5, availableBalance: null,
      creditLimit: 2000, isoCurrencyCode: "USD", holderCategory: "business"
    }, { asOf: "2026-10-06T12:00:00.000Z" });
    assert.equal(row.accountType, "credit");
    assert.equal(row.currentBalanceCents, 41050);
    assert.equal(row.availableBalanceCents, null);
    assert.equal(row.creditLimitCents, 200000);
    assert.equal(row.raw.holder_category, "business");
  });

  test("an unknown Plaid type lands as 'other', not a constraint error", () => {
    const row = toStoreAccount({ plaidAccountId: "a", type: "brokerage" }, { asOf: "2026-10-06T00:00:00Z" });
    assert.equal(row.accountType, "other");
  });
});

describe("plaid-http additions", () => {
  test("sandboxPublicToken refuses any host but sandbox, before sending", async () => {
    const r = await sandboxPublicToken({ institutionId: "ins_109508" }, {
      environment: "production", fetchImpl: () => assert.fail("must not transmit")
    });
    assert.equal(r.ok, false);
    assert.equal(r.transmitted, false);
  });

  test("createLinkToken asks for transactions so credit cards show", async () => {
    let sent;
    const r = await createLinkToken({ clientUserId: CLIENT_ID }, {
      environment: "sandbox", clientId: "cid", secret: "sec", env: { ADAPTERS_DRY_RUN: "0" },
      fetchImpl: async (url, init) => {
        sent = JSON.parse(init.body);
        return new Response(JSON.stringify({ link_token: "link-sandbox-1", expiration: "e" }),
          { status: 200, headers: { "content-type": "application/json" } });
      }
    });
    assert.equal(r.ok, true);
    assert.equal(r.linkToken, "link-sandbox-1");
    assert.deepEqual(sent.products, ["transactions"]);
    assert.equal(sent.user.client_user_id, CLIENT_ID);
  });
});
