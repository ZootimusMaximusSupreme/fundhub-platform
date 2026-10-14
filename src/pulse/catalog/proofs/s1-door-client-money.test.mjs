// Slice 1 (money routes): doors a signed-in client or a stranger presses that
// decide who earns commission or mint a payable link. Real api/ handlers, a
// stand-in database, and a recorder in place of the checkout provider.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import affiliatesRefer from "../../../../api/affiliates/refer.mjs";
import paidServices from "../../../../api/paid-services.mjs";
import optimize from "../../../../api/public/optimize.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import {
  ORG_ID, accountSession, fakeDb, makeRes, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "ac000000-0000-4000-8000-000000000001";
const UPLINE_AFFILIATE = "af000000-0000-4000-8000-0000000000aa";
const NEW_AFFILIATE = "af000000-0000-4000-8000-0000000000bb";

const asClient = (body = {}, query = {}) => ({
  method: "POST", body, query, headers: { authorization: "Bearer test-token-not-real" },
});

async function run(handler, request, rules, deps) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res, deps));
  return { res, fake };
}

// ── affiliates/refer: who is the upline ───────────────────────────────────
function referRules({ existingAffiliate = null, upline = null } = {}) {
  return [
    ...accountSession({ kind: "client", clientId: CLIENT_ID }),
    [/FROM accounts\s+WHERE id = \$1 AND org_id = \$2\s+FOR UPDATE/, [{
      id: ACCOUNT_ID, org_id: ORG_ID, kind: "client", client_id: CLIENT_ID, affiliate_id: existingAffiliate,
    }]],
    [/SELECT id, tracking_id FROM affiliates WHERE id = \$1 AND org_id = \$2/, [{ id: existingAffiliate, tracking_id: "mike01" }]],
    [/SELECT first_name, last_name FROM clients/, [{ first_name: "Sarah", last_name: "Lee" }]],
    [/FROM affiliate_referrals\s+WHERE client_id = \$1 AND org_id = \$2\s+AND tier = 'direct'/, upline ? [{ affiliate_id: upline }] : []],
    [/INSERT INTO affiliates/, (sql, p) => [{ id: NEW_AFFILIATE, tracking_id: "sarah01", recruited_by: p[2] }]],
    [/SELECT tier_level, tier2_unlocked_at FROM affiliates/, [{ tier_level: "tier1", tier2_unlocked_at: null }]],
    [/SELECT 1 FROM affiliates WHERE recruited_by/, [{ one: 1 }]],
  ];
}

test("affiliates/refer makes the client an affiliate, points the upline at who referred them, and unlocks the upline's second tier", async () => {
  assert.equal(ROUTES["affiliates/refer"], affiliatesRefer);
  const { res, fake } = await run(affiliatesRefer, asClient(), referRules({ upline: UPLINE_AFFILIATE }), { env: {} });
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.created, true);
  assert.equal(res.body.code, "sarah01");
  assert.equal(res.body.recruitedBy, UPLINE_AFFILIATE);
  assert.equal(res.body.shareUrl, "https://fundhub.ai/start.html?ref=sarah01");

  const [insert] = fake.find(/INSERT INTO affiliates/);
  assert.deepEqual(insert.params, [ORG_ID, "Acct Holder", UPLINE_AFFILIATE], "the upline comes from the structured referral, not the request");
  const [link] = fake.find(/UPDATE accounts SET affiliate_id/);
  assert.deepEqual(link.params, [NEW_AFFILIATE, ACCOUNT_ID, ORG_ID]);
  const [unlock] = fake.find(/UPDATE affiliates\s+SET tier_level/);
  assert.equal(unlock.params[0], UPLINE_AFFILIATE, "gaining a recruit unlocks the recruiter's 5 percent tier");
  assert.equal(fake.count("COMMIT"), 1);
});

test("affiliates/refer is idempotent, writes no upline for a stranger, and refuses staff", async () => {
  const again = await run(affiliatesRefer, asClient(), referRules({ existingAffiliate: NEW_AFFILIATE }), { env: {} });
  assert.equal(again.res.statusCode, 200);
  assert.equal(again.res.body.created, false);
  assert.equal(again.res.body.code, "mike01");
  assert.equal(again.fake.find(/INSERT INTO affiliates/).length, 0, "a second press never mints a second affiliate");

  const noUpline = await run(affiliatesRefer, asClient(), referRules(), { env: {} });
  assert.equal(noUpline.res.statusCode, 201);
  assert.equal(noUpline.res.body.recruitedBy, null);
  assert.equal(noUpline.fake.find(/INSERT INTO affiliates/)[0].params[2], null);
  assert.equal(noUpline.fake.find(/UPDATE affiliates\s+SET tier_level/).length, 0);

  const staff = await run(affiliatesRefer, asClient(), [staffSession({ role: "owner" })], { env: {} });
  assert.equal(staff.res.statusCode, 403, "staff cannot become a light affiliate here");
  assert.equal(staff.fake.find(/INSERT INTO affiliates/).length, 0);
});

// ── paid-services: the "do it for me" dispute round ──────────────────────
function roundRules({ onPath = true, history = null } = {}) {
  return [
    ...accountSession({ kind: "client", clientId: CLIENT_ID }),
    [/SELECT outcome_tier FROM clients/, [{ outcome_tier: "repair" }]],
    [/FROM v_client_entitlements/, onPath ? [{ one: 1 }] : []],
    [/SELECT result\s+FROM crs_results/, history ? [{ result: history }] : []],
    [/SELECT COALESCE\(MAX\(round_no\), 0\) \+ 1 AS next/, [{ next: 1 }]],
    [/INSERT INTO paid_service_requests/, (sql, p) => [{
      id: "ba000000-0000-4000-8000-000000000001", org_id: p[0], client_id: p[1], service_kind: p[3],
      status: p[7], price_components: JSON.parse(p[8]), price_total_cents: String(p[9]), round_no: p[10],
      idempotency_key: p[11], checkout_url: null, currency: "USD",
    }]],
    [/UPDATE paid_service_requests\s+SET status = 'awaiting_payment'/, (sql, p) => [{
      id: p[0], status: "awaiting_payment", checkout_url: p[1], price_total_cents: "0", price_components: [],
    }]],
  ];
}

test("paid-services POST prices the round, records the ask once and returns a hosted checkout link; it charges nothing itself", async () => {
  assert.equal(ROUTES["paid-services"], paidServices);
  const minted = [];
  const mintFn = async (args) => { minted.push(args); return { ok: true, checkoutUrl: "https://pay.example.test/c/round-1" }; };
  const { res, fake } = await run(
    paidServices,
    asClient({ creditor_letter: true, escalation_filings: true }),
    roundRules(),
    { mintFn, env: {} },
  );
  assert.equal(res.statusCode, 201, JSON.stringify(res.body));
  assert.equal(res.body.created, true);
  assert.equal(res.body.checkout_url, "https://pay.example.test/c/round-1");
  assert.equal(res.body.request.status, "awaiting_payment");

  const [insert] = fake.find(/INSERT INTO paid_service_requests/);
  const components = JSON.parse(insert.params[8]);
  assert.ok(components.length === 3, "the base round, the creditor letter and the filings");
  const total = components.reduce((sum, c) => sum + Number(c.amount_cents ?? c.cents ?? c.priceCents ?? 0), 0);
  assert.equal(insert.params[9], total, "the stored total is the sum of the receipt lines");
  assert.ok(total > 0);
  assert.equal(insert.params[4], "client");
  assert.equal(insert.params[5], ACCOUNT_ID);
  assert.equal(insert.params[10], 1);
  assert.equal(insert.params[11], `paid_round:${CLIENT_ID}:r1`, "the replay guard is derived from client and round slot");
  assert.equal(minted.length, 1);
  assert.equal(minted[0].amountCents, total, "the checkout is minted for exactly the stored total");
  assert.equal(minted[0].orgId, ORG_ID);
});

test("paid-services refuses a client off the offer path, one naming another client, and a client with nothing to dispute; nothing is recorded", async () => {
  const mintFn = async () => { throw new Error("no checkout may be minted"); };
  const refused = async (request, rules, status, code) => {
    const { res, fake } = await run(paidServices, request, rules, { mintFn, env: {} });
    assert.equal(res.statusCode, status, JSON.stringify(res.body));
    if (code) assert.equal(res.body.error, code);
    assert.equal(fake.find(/INSERT INTO paid_service_requests/).length, 0);
  };
  await refused(asClient(), roundRules({ onPath: false }), 403, "not_on_offer_path");
  await refused(asClient({ client_id: "c2000000-0000-4000-8000-000000000002" }), roundRules(), 403, "forbidden");
  await refused(asClient(), roundRules({ history: { tradelines: [], publicRecords: [] } }), 409, "nothing_to_dispute");
});

// ── public/optimize POST: the $32 Assessment checkout ────────────────────
const KEY_ENV = "FANBASIS_CHECKOUT_API_KEY";
const hadKey = Object.prototype.hasOwnProperty.call(process.env, KEY_ENV);
const realKey = process.env[KEY_ENV];
const realFetch = globalThis.fetch;
const providerCalls = [];

before(() => {
  process.env[KEY_ENV] = ["fake", "checkout", "key", "for", "tests"].join("_");
  globalThis.fetch = async (url, init = {}) => {
    providerCalls.push({ url: String(url), body: init.body ? JSON.parse(init.body) : null });
    return new Response(JSON.stringify({ data: { payment_link: "https://pay.example.test/c/audit-32", id: "prod_1" } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
});
after(() => {
  globalThis.fetch = realFetch;
  if (hadKey) process.env[KEY_ENV] = realKey; else delete process.env[KEY_ENV];
});

test("public/optimize POST mints the $32 checkout under the keep Assessment title and answers with the link", async () => {
  assert.equal(ROUTES["public/optimize"], optimize);
  providerCalls.length = 0;
  const res = makeRes();
  await optimize({ method: "POST", body: { email: "Ada@Example.test", name: "Ada Lee", phone: "(555) 010-0100" } }, res);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body, { ok: true, checkoutUrl: "https://pay.example.test/c/audit-32" });
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].body.amount_cents, 3200);
  assert.equal(providerCalls[0].body.product.title, "Consulting Services Assessment");
  assert.equal(res.headers["cache-control"], "no-store");
});

test("public/optimize POST refuses a missing email without calling the provider, and says 502 when the provider says no", async () => {
  providerCalls.length = 0;
  const bad = makeRes();
  await optimize({ method: "POST", body: { name: "Ada" } }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, "email_required");
  assert.equal(providerCalls.length, 0);

  const prior = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ message: "declined" }), { status: 400 });
  try {
    const refused = makeRes();
    await optimize({ method: "POST", body: { email: "ada@example.test" } }, refused);
    assert.equal(refused.statusCode, 502);
    assert.equal(refused.body.error, "checkout_failed");
    assert.equal(refused.body.checkoutUrl, undefined, "no half-answer with a link");
  } finally {
    globalThis.fetch = prior;
  }
});
