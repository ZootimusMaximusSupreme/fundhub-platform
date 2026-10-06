// /api/money/setup — endpoint tests. Stubbed principal, db, checkout minter and
// link signer; no network, no Postgres, no charge, no pull.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/money/setup.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { SETUP_COMMAS_TITLE, SETUP_DESCRIPTION, SETUP_PURPOSE } from "../finance/money-setup.mjs";

function makeRes() {
  return {
    statusCode: null, body: null, headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    json(o) { this.body = o; return this; }
  };
}

const MINE = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const ORG = "org-1";
const SECRET = "x".repeat(40);

const clientPrincipal = (clientId = MINE) => ({ kind: "client", accountId: "acc-1", orgId: ORG, clientId });
const staffPrincipal = (role) => ({ kind: "staff", role, orgId: ORG, staff: { id: "s1", role, org_id: ORG } });

const gateAs = (p) => async (_req, res, kinds) => {
  if (!p) { res.status(401).json({ ok: false, error: "unauthorized" }); return null; }
  if (!kinds.includes(p.kind)) { res.status(403).json({ ok: false, error: "forbidden" }); return null; }
  return p;
};

/* Answers clients for ids in `inOrg`; payment_links from `links`; everything else empty. */
function stubDb({ inOrg = [MINE], links = [] } = {}) {
  const seen = [];
  return {
    seen,
    query: async (sql, params) => {
      seen.push({ sql, params });
      if (/FROM clients/.test(sql)) {
        return { rows: inOrg.includes(params[0]) ? [{ id: params[0], first_name: "Ada", last_name: "Lane", "?column?": 1 }] : [] };
      }
      if (/FROM payment_links/.test(sql)) return { rows: links };
      if (/FROM entities/.test(sql)) return { rows: [{ n: 0 }] };
      if (/INSERT|UPDATE|DELETE/i.test(sql)) throw new Error("this endpoint must not write: " + sql);
      return { rows: [] };
    }
  };
}

function spyMint() {
  const calls = [];
  const fn = async (_db, args) => { calls.push(args); return { checkout_url: "https://pay.example/new" }; };
  fn.calls = calls;
  return fn;
}

function spySign() {
  const calls = [];
  const fn = (args) => { calls.push(args); return { path: "/app/soft-pull-approve.html?org=o&client=c&exp=1&sig=s", expiresAtIso: "2026-10-06T18:00:00.000Z" }; };
  fn.calls = calls;
  return fn;
}

const NOW = () => new Date("2026-10-06T12:00:00Z");

test("route is wired", () => {
  assert.equal(ROUTES["money/setup"], handler);
});

describe("GET /api/money/setup", () => {
  test("a client reads their own file; a client_id in the URL is ignored", async () => {
    const db = stubDb({ inOrg: [MINE, OTHER] });
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: OTHER } }, res,
      { db, requirePrincipal: gateAs(clientPrincipal()), now: NOW, env: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client.id, MINE);
    assert.equal(res.body.setup_fee_cents, null);
    assert.equal(res.body.price_per_container_cents, null);
    assert.equal(res.body.paid, false);
    assert.equal(res.body.current_step, "pay");
    assert.ok(db.seen.every((x) => !x.params.includes(OTHER)), "another client's id reached a query");
  });

  test("a login with no client file is refused", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res,
      { db: stubDb(), requirePrincipal: gateAs(clientPrincipal(null)), now: NOW, env: {} });
    assert.equal(res.statusCode, 403);
  });

  test("no session → 401", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: {} }, res, { db: stubDb(), requirePrincipal: gateAs(null), env: {} });
    assert.equal(res.statusCode, 401);
  });

  test("staff FINANCE needs a client_id in their org", async () => {
    let res = makeRes();
    await handler({ method: "GET", query: {} }, res, { db: stubDb(), requirePrincipal: gateAs(staffPrincipal("owner")), env: {} });
    assert.equal(res.statusCode, 400);

    res = makeRes();
    await handler({ method: "GET", query: { client_id: OTHER } }, res,
      { db: stubDb({ inOrg: [MINE] }), requirePrincipal: gateAs(staffPrincipal("owner")), env: {} });
    assert.equal(res.statusCode, 404);

    res = makeRes();
    await handler({ method: "GET", query: { client_id: MINE } }, res,
      { db: stubDb(), requirePrincipal: gateAs(staffPrincipal("sales_manager")), now: NOW, env: {} });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.client.id, MINE);
  });

  test("a staff role outside FINANCE is refused", async () => {
    const res = makeRes();
    await handler({ method: "GET", query: { client_id: MINE } }, res,
      { db: stubDb(), requirePrincipal: gateAs(staffPrincipal("setter")), env: {} });
    assert.equal(res.statusCode, 403);
  });

  test("other methods → 405; unknown action → 400", async () => {
    let res = makeRes();
    await handler({ method: "DELETE" }, res, { db: stubDb(), requirePrincipal: gateAs(clientPrincipal()) });
    assert.equal(res.statusCode, 405);
    res = makeRes();
    await handler({ method: "POST", body: { action: "charge_card" } }, res, { db: stubDb(), requirePrincipal: gateAs(clientPrincipal()) });
    assert.equal(res.statusCode, 400);
  });
});

describe("POST start_checkout", () => {
  test("no setup price → 409 price_not_set, nothing minted, nothing written", async () => {
    const mint = spyMint();
    const res = makeRes();
    await handler({ method: "POST", body: { action: "start_checkout" } }, res,
      { db: stubDb(), requirePrincipal: gateAs(clientPrincipal()), env: {}, createPaymentLink: mint });
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.error, "price_not_set");
    assert.match(res.body.message, /not set yet/);
    assert.equal(mint.calls.length, 0);
  });

  test("a price set → mints through createPaymentLink with an existing Commas title", async () => {
    const mint = spyMint();
    const res = makeRes();
    await handler({ method: "POST", body: { action: "start_checkout", client_id: OTHER } }, res,
      { db: stubDb(), requirePrincipal: gateAs(clientPrincipal()), env: { FINANCE_OS_SETUP_FEE_CENTS: "49700" }, createPaymentLink: mint });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.checkout_url, "https://pay.example/new");
    assert.equal(mint.calls.length, 1);
    const a = mint.calls[0];
    assert.equal(a.clientId, MINE, "a client's body client_id must not pick the file");
    assert.equal(a.orgId, ORG);
    assert.equal(a.amountCents, 49700);
    assert.equal(a.purpose, SETUP_PURPOSE);
    assert.equal(a.description, SETUP_DESCRIPTION);
    assert.equal(a.commasProductTitle, SETUP_COMMAS_TITLE);
    assert.equal(a.createdByStaffId, null);
  });

  test("an unpaid setup link at the same price is reused, not minted twice", async () => {
    const mint = spyMint();
    const res = makeRes();
    await handler({ method: "POST", body: { action: "start_checkout" } }, res, {
      db: stubDb({ links: [{ status: "sent", amount_cents: "49700", checkout_url: "https://pay.example/old" }] }),
      requirePrincipal: gateAs(clientPrincipal()), env: { FINANCE_OS_SETUP_FEE_CENTS: "49700" }, createPaymentLink: mint
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.reused, true);
    assert.equal(res.body.checkout_url, "https://pay.example/old");
    assert.equal(mint.calls.length, 0);
  });

  test("already paid → no new checkout", async () => {
    const mint = spyMint();
    const res = makeRes();
    await handler({ method: "POST", body: { action: "start_checkout" } }, res, {
      db: stubDb({ links: [{ status: "paid", amount_cents: 49700 }] }),
      requirePrincipal: gateAs(clientPrincipal()), env: { FINANCE_OS_SETUP_FEE_CENTS: "49700" }, createPaymentLink: mint
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.already_paid, true);
    assert.equal(mint.calls.length, 0);
  });

  test("checkout not configured → 503 in words", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: { action: "start_checkout" } }, res, {
      db: stubDb(), requirePrincipal: gateAs(clientPrincipal()), env: { FINANCE_OS_SETUP_FEE_CENTS: "100" },
      createPaymentLink: async () => { const e = new Error("no"); e.code = "commas_not_configured"; throw e; }
    });
    assert.equal(res.statusCode, 503);
    assert.match(res.body.message, /Nothing was charged/);
  });
});

describe("POST request_soft_pull", () => {
  test("hands back the signed approval form for the session's own file", async () => {
    const sign = spySign();
    const res = makeRes();
    await handler({ method: "POST", body: { action: "request_soft_pull", client_id: OTHER } }, res,
      { db: stubDb(), requirePrincipal: gateAs(clientPrincipal()), env: { DOCUMENT_URL_SECRET: SECRET }, signSoftPullApproveUrl: sign });
    assert.equal(res.statusCode, 200);
    assert.match(res.body.approve_url, /^\/app\/soft-pull-approve\.html\?/);
    assert.equal(sign.calls.length, 1);
    assert.equal(sign.calls[0].clientId, MINE);
    assert.equal(sign.calls[0].orgId, ORG);
  });

  test("the real signer makes a link the approval form accepts", async () => {
    const res = makeRes();
    await handler({ method: "POST", body: { action: "request_soft_pull" } }, res,
      { db: stubDb(), requirePrincipal: gateAs(clientPrincipal()), env: { DOCUMENT_URL_SECRET: SECRET } });
    assert.equal(res.statusCode, 200);
    const u = new URL(res.body.approve_url, "https://fundhub.ai");
    const { verifySoftPullApproveToken } = await import("../consent/approve-token.mjs");
    const ok = verifySoftPullApproveToken({
      orgId: u.searchParams.get("org"), clientId: u.searchParams.get("client"),
      exp: u.searchParams.get("exp"), sig: u.searchParams.get("sig"), secret: SECRET
    });
    assert.equal(ok.clientId, MINE);
  });

  test("no signing secret → 503 in words, no link", async () => {
    const sign = spySign();
    const res = makeRes();
    await handler({ method: "POST", body: { action: "request_soft_pull" } }, res,
      { db: stubDb(), requirePrincipal: gateAs(clientPrincipal()), env: {}, signSoftPullApproveUrl: sign });
    assert.equal(res.statusCode, 503);
    assert.equal(sign.calls.length, 0);
  });
});
