// Slice 1 (money routes): the closer cockpit mints a pay link or the $32
// soft-pull approve link and sends it. The real api/closer-deck.mjs runs on a
// stand-in database. Sends stop at the queue (no provider is ever asked), and
// any outbound fetch fails the test.
import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import handler from "../../../../api/closer-deck.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import {
  ORG_ID, OTHER_ORG_ID, STAFF_ID, fakeDb, makeRes, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";
import { clause, rolesLetIn, shelf } from "./s1-proof-kit.mjs";

const CLIENT_ID = "c1000000-0000-4000-8000-000000000001";
const FOREIGN_CLIENT = "c2000000-0000-4000-8000-000000000002";
const LINK_ID = "11000000-0000-4000-8000-000000000001";
const CHECKOUT_BASE = "https://pay.example.test/c/onboarding";
const touched = ["COMMAS_CHECKOUT_BASE_URL", "FANBASIS_CHECKOUT_API_KEY", "DOCUMENT_URL_SECRET", "SLO_POST_PURCHASE_ENABLED"];
const saved = new Map();
const realFetch = globalThis.fetch;

before(() => {
  for (const key of touched) saved.set(key, process.env[key]);
  process.env.COMMAS_CHECKOUT_BASE_URL = CHECKOUT_BASE;
  delete process.env.FANBASIS_CHECKOUT_API_KEY;
  delete process.env.SLO_POST_PURCHASE_ENABLED;
  process.env.DOCUMENT_URL_SECRET = ["fake", "signing", "value", "for", "tests", "only", "0123456789"].join("-");
  globalThis.fetch = async (url) => { throw new Error(`a live request was attempted: ${url}`); };
});
after(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function deckRules() {
  return [
    staffSession({ role: "closer" }),
    // Two clients, one in each company: kept only while the SQL names both the id and the company.
    [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, shelf(
      [{ id: CLIENT_ID, org_id: ORG_ID }, { id: FOREIGN_CLIENT, org_id: OTHER_ORG_ID }],
      [
        clause(/WHERE id = \$1/, (row, [id]) => row.id === id),
        clause(/AND org_id = \$2/, (row, [, org]) => row.org_id === org),
      ],
    )],
    [/FROM crs_results/, []],
    [/FROM products\s+WHERE org_id/, (sql, p) => [{ id: "ab000000-0000-4000-8000-000000000001", code: p[2] }]],
    [/INSERT INTO payment_links/, (sql, p) => [{
      id: LINK_ID, org_id: p[0], client_id: p[1], purpose: p[2], description: p[3], amount_cents: String(p[4]),
      currency: p[5], link_ref: p[6], checkout_url: p[7], status: "created",
    }]],
    [/UPDATE payment_links\s+SET status = 'sent'/, (sql, p) => [{
      id: LINK_ID, org_id: p[1], status: "sent", sent_at: p[2], amount_cents: "100000",
      checkout_url: `${CHECKOUT_BASE}?ref=sent`, purpose: "repair", description: "x",
    }]],
    [/SELECT first_name(, email)? FROM clients/, [{ first_name: "Ana", email: "ana@example.test" }]],
    [/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2 LIMIT 1/, [{ id: CLIENT_ID }]],
    [/INSERT INTO conversations/, [{ id: "c0c00000-0000-4000-8000-000000000001" }]],
    [/SELECT (email|phone) AS address FROM clients/, (sql) => [{ address: /email/.test(sql) ? "ana@example.test" : "+15555550100" }]],
    [/INSERT INTO messages/, [{ id: "3e000000-0000-4000-8000-000000000001", status: "queued" }]],
  ];
}

async function post(body, rules = deckRules()) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(req("POST", { body }), res));
  return { res, fake };
}

function sentBodies(fake) {
  return fake.find(/INSERT INTO messages/).map((c) => ({ channel: c.params[3], body: String(c.params[4]) }));
}

test("closer-deck send_pay_link mints a checkout link at the offer price, emails and texts it, and marks it sent", async () => {
  assert.equal(ROUTES["closer-deck"], handler);
  const { res, fake } = await post({ action: "send_pay_link", client_id: CLIENT_ID, offer_key: "REPAIR_DFY" });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.action, "send_pay_link");
  assert.equal(res.body.link.status, "sent");
  assert.equal(res.body.link.offer_key, "REPAIR_DFY");

  const [insert] = fake.find(/INSERT INTO payment_links/);
  assert.equal(insert.params[0], ORG_ID);
  assert.equal(insert.params[1], CLIENT_ID);
  assert.equal(insert.params[2], "repair");
  assert.equal(insert.params[4], 100000, "$1,000, the catalogue price of the repair done-for-you offer");
  assert.equal(insert.params[8], STAFF_ID);
  assert.ok(String(insert.params[7]).startsWith(CHECKOUT_BASE), "a hosted checkout URL, not a card capture");

  const sent = sentBodies(fake);
  assert.deepEqual(sent.map((s) => s.channel).sort(), ["email", "sms"]);
  for (const message of sent) {
    assert.ok(message.body.includes(insert.params[7]), `${message.channel} carries the same checkout link`);
  }
  assert.match(sent.find((s) => s.channel === "email").body, /Pay \$1,000 here/);
  assert.equal(fake.find(/UPDATE payment_links\s+SET status = 'sent'/).length, 1);
});

test("closer-deck send_pay_link refuses a deliverables offer with no sale motion, an unknown offer and a missing checkout; nothing is minted", async () => {
  const refused = async (body, want, code) => {
    const { res, fake } = await post(body);
    assert.equal(res.statusCode, want, JSON.stringify(body));
    assert.equal(res.body.error, code);
    assert.equal(fake.find(/INSERT INTO payment_links/).length, 0);
    assert.equal(fake.find(/INSERT INTO messages/).length, 0);
  };
  await refused({ action: "send_pay_link", client_id: CLIENT_ID, offer_key: "UWIQ_DELIVERABLES" }, 400, "sale_motion_required");
  await refused({ action: "send_pay_link", client_id: CLIENT_ID, offer_key: "NOT_AN_OFFER" }, 400, "unknown_offer");
  delete process.env.COMMAS_CHECKOUT_BASE_URL;
  try {
    await refused({ action: "send_pay_link", client_id: CLIENT_ID, offer_key: "REPAIR_DFY" }, 503, "commas_not_configured");
  } finally {
    process.env.COMMAS_CHECKOUT_BASE_URL = CHECKOUT_BASE;
  }
});

test("closer-deck send_soft_pull mints the fixed $32 pay link and sends the signed approval form by email and text", async () => {
  const { res, fake } = await post({ action: "send_soft_pull", client_id: CLIENT_ID });
  assert.equal(res.statusCode, 200, JSON.stringify(res.body));
  assert.equal(res.body.action, "send_soft_pull");
  const [insert] = fake.find(/INSERT INTO payment_links/);
  assert.equal(insert.params[2], "diagnostic");
  assert.equal(insert.params[4], 3200, "the fixed $32 soft-pull price");
  assert.equal(insert.params[1], CLIENT_ID);

  const sent = sentBodies(fake);
  assert.deepEqual(sent.map((s) => s.channel).sort(), ["email", "sms"]);
  for (const message of sent) {
    assert.ok(message.body.includes(insert.params[7]), `${message.channel} carries the $32 checkout link`);
    assert.match(message.body, /soft-pull-approve/, `${message.channel} carries the signed approval-form address`);
  }
  assert.equal(fake.find(/UPDATE payment_links\s+SET status = 'sent'/).length, 1);
});

test("closer-deck sends nothing for another company's client, and only closer, sales manager, owner and admin may fire it", async () => {
  for (const action of ["send_soft_pull", "send_pay_link"]) {
    const other = await post({ action, client_id: FOREIGN_CLIENT, offer_key: "REPAIR_DFY" });
    assert.equal(other.res.statusCode, 404, action);
    assert.equal(other.fake.find(/INSERT INTO (payment_links|messages)/).length, 0, action);
  }

  const letIn = await rolesLetIn(async (role) => {
    const rules = deckRules();
    rules[0] = staffSession({ role });
    const { res, fake } = await post({ action: "send_soft_pull", client_id: CLIENT_ID }, rules);
    if (res.statusCode === 403) assert.equal(fake.find(/INSERT INTO payment_links/).length, 0, `${role} was refused but a link was minted`);
    return res.statusCode;
  });
  assert.deepEqual(letIn, ["admin", "closer", "owner", "sales_manager"]);
});

test("closer-deck refuses send_ebook: the action the catalog row names is not served", async () => {
  const { res, fake } = await post({ action: "send_ebook", client_id: CLIENT_ID, amount_cents: 2700 });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "unknown_action");
  assert.equal(fake.find(/INSERT INTO payment_links/).length, 0, "no ad-hoc priced link is minted");
});
