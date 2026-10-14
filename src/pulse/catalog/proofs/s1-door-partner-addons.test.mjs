// Slice 1 (money routes): a partner buys, activates and cancels a paid add-on.
// The real api/partner-addons.mjs handler runs on a stand-in database. The
// checkout provider is never called: only the fallback query-link base is set.
import assert from "node:assert/strict";
import test from "node:test";

import handler from "../../../../api/partner-addons.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import {
  ORG_ID, STAFF_ID, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";

const PARTNER_ID = "9a000000-0000-4000-8000-000000000001";
const LINK_ID = "11000000-0000-4000-8000-000000000001";
const CHECKOUT_BASE = "https://pay.example.test/c/onboarding";
const ENV = Object.freeze({ COMMAS_CHECKOUT_BASE_URL: CHECKOUT_BASE });
const noNetwork = async (url) => { throw new Error(`refused a live request to ${url}`); };

async function run(body, rules, { role = "owner", env = ENV } = {}) {
  const fake = fakeDb([staffSession({ role }), ...rules]);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body }), res, { env, fetchImpl: noNetwork }));
  return { res, fake };
}

const ownsPartner = [/FROM partners WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]];

// The INSERT answers with the row the handler's own parameters describe.
const echoLink = [/INSERT INTO payment_links/, (sql, p) => [{
  id: LINK_ID, org_id: p[0], client_id: p[1], partner_id: p[16], purpose: p[2], description: p[3],
  amount_cents: String(p[4]), currency: p[5], link_ref: p[6], checkout_url: p[7], status: "created",
  paid_amount_cents: null,
}]];

test("partner-addons buy mints one checkout link for the add-on price times units and charges nobody", async () => {
  assert.equal(ROUTES["partner-addons"], handler);
  const { res, fake } = await run({ action: "buy", partner_id: PARTNER_ID, add_on: "lead-flow", units: 3 }, [
    ownsPartner,
    [/FROM products\s+WHERE org_id/, [{ id: "ab000000-0000-4000-8000-000000000001", code: "lead-flow" }]],
    echoLink,
  ]);
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.action, "buy");
  assert.equal(res.body.add_on, "lead-flow");
  assert.equal(res.body.monthly, false);
  assert.equal(res.body.units, 3);
  assert.equal(res.body.amount_cents, 29700, "$99 a booked call times 3");
  assert.match(res.body.note, /Nothing is charged yet/);
  assert.equal(res.body.link.status, "created");
  assert.ok(res.body.link.checkout_url.startsWith(CHECKOUT_BASE), "the link is the hosted checkout, not a card capture");
  const [insert] = fake.find(/INSERT INTO payment_links/);
  assert.equal(insert.params[0], ORG_ID, "filed under the signed-in company");
  assert.equal(insert.params[16], PARTNER_ID, "owned by the partner, not a client");
  assert.equal(insert.params[1], null);
  assert.equal(insert.params[8], STAFF_ID);
  assert.equal(fake.find(/INSERT INTO subscriptions/).length, 0, "no subscription exists until the payment lands");
});

test("partner-addons buy refuses a missing unit count, an unknown add-on, a body org and a closed checkout; nothing is minted", async () => {
  const refused = async (body, want, env = ENV, rules = [ownsPartner]) => {
    const { res, fake } = await run(body, rules, { env });
    assert.equal(res.statusCode, want, JSON.stringify(body));
    assert.equal(fake.find(/INSERT INTO payment_links/).length, 0);
    return res;
  };
  await refused({ action: "buy", partner_id: PARTNER_ID, add_on: "lead-flow" }, 400);
  await refused({ action: "buy", partner_id: PARTNER_ID, add_on: "nope", units: 1 }, 400);
  await refused({ action: "buy", partner_id: PARTNER_ID, add_on: "lead-flow", units: 1, org_id: ORG_ID }, 400);
  const closed = await refused({ action: "buy", partner_id: PARTNER_ID, add_on: "lead-flow", units: 1 }, 503, {});
  assert.equal(closed.body.error, "commas_not_configured");
  await refused({ action: "buy", partner_id: PARTNER_ID, add_on: "lead-flow", units: 1 }, 403, ENV, []);
});

const PAID_LINK = {
  id: LINK_ID, org_id: ORG_ID, partner_id: PARTNER_ID, product_code: "creative-intelligence", status: "paid",
  amount_cents: "29700", currency: "USD", link_ref: "pl_paid1", paid_at: "2026-10-01T00:00:00.000Z",
};

function activateRules(link, { live = null } = {}) {
  const started = {
    id: "5b000000-0000-4000-8000-000000000001", org_id: ORG_ID, client_id: null, partner_id: PARTNER_ID,
    tier: "creative-intelligence", status: "active", price_cents: 29700, currency: "USD", card_id: null,
    provider: "commas", provider_ref: null, effective_to: null, cancelled_at: null, billing_interval: null,
  };
  return [
    ownsPartner,
    [/FROM payment_links pl\s+LEFT JOIN products p/, [link]],
    [/FROM subscriptions WHERE id = \$1 AND org_id = \$2/, [started]],
    [/UPDATE subscriptions\s+SET next_charge_at/, [{ ...started, billing_interval: "monthly" }]],
    [/INSERT INTO subscriptions/, (sql, p) => [{ ...started, partner_id: p[13], tier: p[2], price_cents: p[4] }]],
    [/FROM subscriptions/, live ? [live] : []],
  ];
}

test("partner-addons activate starts the monthly add-on at the price the partner PAID, and only for a paid link", async () => {
  const { res, fake } = await run({ action: "activate", partner_id: PARTNER_ID, payment_link_id: LINK_ID }, activateRules(PAID_LINK));
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.activated, true);
  assert.equal(res.body.add_on, "creative-intelligence");
  const [insert] = fake.find(/INSERT INTO subscriptions/);
  assert.equal(insert.params[0], ORG_ID);
  assert.equal(insert.params[13], PARTNER_ID);
  assert.equal(insert.params[2], "creative-intelligence");
  assert.equal(insert.params[4], 29700, "the paid amount off the link, not the menu price");

  const unpaid = await run({ action: "activate", partner_id: PARTNER_ID, payment_link_id: LINK_ID },
    activateRules({ ...PAID_LINK, status: "sent" }));
  assert.equal(unpaid.res.statusCode, 409);
  assert.equal(unpaid.res.body.error, "not_paid");
  assert.equal(unpaid.fake.find(/INSERT INTO subscriptions/).length, 0, "a sent link never opens a subscription");

  const again = await run({ action: "activate", partner_id: PARTNER_ID, payment_link_id: LINK_ID },
    activateRules(PAID_LINK, { live: { id: "5b000000-0000-4000-8000-000000000002", tier: "creative-intelligence", cancelled_at: null } }));
  assert.equal(again.res.statusCode, 200);
  assert.equal(again.res.body.activated, false);
  assert.equal(again.res.body.reason, "already_active");
  assert.equal(again.fake.find(/INSERT INTO subscriptions/).length, 0);
});

test("partner-addons cancel ends that one add-on at the named date and says so when there is nothing to cancel", async () => {
  const cancelled = { id: "5b000000-0000-4000-8000-000000000001", tier: "dfy-marketing", status: "cancelled", price_cents: 249700 };
  const { res, fake } = await run(
    { action: "cancel", partner_id: PARTNER_ID, add_on: "dfy-marketing", at: "2026-10-05", ends_at: "2026-10-31" },
    [ownsPartner, [/WITH cancelled AS/, [cancelled]]],
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.action, "cancel");
  assert.equal(res.body.add_on, "dfy-marketing");
  assert.equal(res.body.subscription.status, "cancelled");
  const [update] = fake.find(/WITH cancelled AS/);
  assert.equal(update.params[0], ORG_ID);
  assert.equal(update.params[1], PARTNER_ID);
  assert.equal(update.params[4], "dfy-marketing", "only the named add-on is touched");
  assert.equal(new Date(update.params[2]).toISOString().slice(0, 10), "2026-10-05");
  assert.equal(new Date(update.params[3]).toISOString().slice(0, 10), "2026-10-31");

  const none = await run({ action: "cancel", partner_id: PARTNER_ID, add_on: "dfy-marketing" }, [ownsPartner]);
  assert.equal(none.res.statusCode, 404);
  assert.match(none.res.body.error, /has no .* to cancel/);
});

test("partner-addons is for owners and admins only, and another company's partner is refused", async () => {
  const closer = await run({ action: "cancel", partner_id: PARTNER_ID, add_on: "dfy-marketing" }, [ownsPartner], { role: "sales_manager" });
  assert.equal(closer.res.statusCode, 403);
  assert.equal(closer.fake.find(/subscriptions/).length, 0);
});
