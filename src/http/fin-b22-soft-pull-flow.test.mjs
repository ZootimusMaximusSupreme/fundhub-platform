// The client's soft-pull page, server half: POST /api/soft-pull-approve through the REAL handler with a
// stand-in database, a signed link, no network and no payment vendor. A practice test.
//
// It judges the two things the draft journey says in order:
//   - "They authorize the soft pull first, then pay": the consent is written BEFORE any payment link is
//     minted, and a refused consent or a refused form mints no link at all.
//   - "After submit the same page shows Pay for that total": the answer carries the checkout for exactly
//     $32 + $10 for each saved company, an old link at another total is expired rather than reused, and the
//     saved companies are the ones the total was worked from.
//
// The page half (the Pay button appears only after the save, on the same page) is in
// src/pulse/catalog/proofs/fin-b22-soft-pull-page.test.mjs.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import handler from "../../api/soft-pull-approve.mjs";
import { signSoftPullApproveUrl } from "../consent/approve-token.mjs";
import { fakeDb, makeRes, ORG_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
// Keys and the link secret are made at run time so nothing secret-shaped sits in the source.
const SECRET = crypto.randomBytes(24).toString("hex");
const ENV = { PII_ENC_KEY: crypto.randomBytes(32).toString("base64"), DOCUMENT_URL_SECRET: SECRET };
const NOW = () => Date.UTC(2026, 9, 14, 12, 0, 0);
const CHECKOUT_BASE = "https://pay.example.test/checkout";

function link(over = {}) {
  const signed = signSoftPullApproveUrl({ orgId: ORG_ID, clientId: CLIENT, secret: SECRET, now: NOW, ...over });
  const params = new URL(signed.path, "https://fundhub.test").searchParams;
  return { org: params.get("org"), client: params.get("client"), exp: params.get("exp"), sig: params.get("sig") };
}

function person(over = {}) {
  return {
    granted_name: "Dana Whitfield", ssn: "123-45-6789", dob: "1985-04-12",
    address_line1: "12 Main St", city: "Phoenix", state: "az", postal_code: "85004", ...over,
  };
}

function company(n, over = {}) {
  return {
    name: `Acme ${n} LLC`, address_line1: "500 Commerce Way", city: "Tempe", state: "az", postal_code: "85281",
    ein: `12-345678${n}`, incorporated_date: "2021-03", extra_owner_name: "", ...over,
  };
}

/**
 * The stand-in database. `openLinks` are payment links already open for this client.
 * `failOn` is a statement pattern that answers with an error.
 */
function standIn({ openLinks = [], failOn = null } = {}) {
  const minted = [];
  const expired = [];
  const rules = [
    ...(failOn ? [[failOn, new Error("the database refused this write")]] : []),
    [/FROM clients WHERE id = \$1 AND org_id = \$2/, [{ id: CLIENT, first_name: "Dana", last_name: "Whitfield", email: "dana@fundhub-client.test.io" }]],
    [/FROM client_consents\s+WHERE org_id = \$1 AND client_id = \$2 AND kind = \$3/, []],
    [/FROM accounts\s+WHERE client_id = \$1/, [{ id: "a1000000-0000-4000-8000-000000000001" }]],
    [/INSERT INTO pii_identity/, [{ id: "pii-1" }]],
    [/INSERT INTO client_consents/, (_s, p) => [{ id: "cc-1", org_id: p[0], client_id: p[1], kind: p[2], consent_text: p[3], consent_version: p[4], granted_name: p[9] }]],
    [/FROM payment_links\s+WHERE org_id = \$1 AND client_id = \$2 AND purpose = 'diagnostic'\s+AND status = ANY\(\$3\) AND amount_cents = \$4/,
      (_s, p) => openLinks.filter((l) => l.amount_cents === p[3])],
    [/SELECT id FROM payment_links\s+WHERE org_id = \$1 AND client_id = \$2 AND purpose = 'diagnostic'\s+AND status = ANY\(\$3\) AND amount_cents <> \$4/,
      (_s, p) => openLinks.filter((l) => l.amount_cents !== p[3]).map((l) => ({ id: l.id }))],
    [/UPDATE payment_links\s+SET status = 'expired'/, (_s, p) => { expired.push(p[0]); return [{ id: p[0], status: "expired" }]; }],
    [/FROM products\s+WHERE org_id = \$1/, [{ id: "pr100000-0000-4000-8000-000000000001", code: "diagnostic" }]],
    [/INSERT INTO payment_links/, (_s, p) => {
      const row = { id: `link-${minted.length + 1}`, status: "created", purpose: p[2], description: p[3], amount_cents: p[4], checkout_url: p[7] };
      minted.push(row);
      return [row];
    }],
    [/UPDATE payment_links\s+SET status = 'sent'/, (_s, p) => {
      const row = [...minted, ...openLinks].find((l) => l.id === p[0]);
      return row ? [{ ...row, status: "sent" }] : [];
    }],
  ];
  const fake = fakeDb(rules);
  return { fake, minted, expired };
}

async function post(body, { db = standIn(), token = link(), deps = {} } = {}) {
  const res = makeRes();
  await handler(
    { method: "POST", body: { ...token, ...body }, query: {}, headers: { "x-forwarded-for": "203.0.113.5", "user-agent": "test-browser" } },
    res,
    { db: db.fake, env: ENV, secret: SECRET, now: NOW, checkoutBaseUrl: CHECKOUT_BASE, ...deps },
  );
  return { res, ...db };
}

const at = (fake, re) => fake.calls.findIndex((c) => re.test(c.sql));
const ran = (fake, re) => fake.calls.filter((c) => re.test(c.sql));
const NO_PAY = /INSERT INTO payment_links/;

describe("authorize first, then pay", () => {
  test("the consent is written before the payment link is minted, and the answer carries both", async () => {
    const { res, fake, minted } = await post({ ...person(), businesses: [] });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.consent.valid, true);
    assert.ok(res.body.consent.version, "the version of the words that were shown is returned");
    const consentAt = at(fake, /INSERT INTO client_consents/);
    const identityAt = at(fake, /INSERT INTO pii_identity/);
    const linkAt = at(fake, NO_PAY);
    assert.ok(consentAt >= 0 && linkAt >= 0, "both were written");
    assert.ok(identityAt >= 0 && identityAt < consentAt, "identity, then consent");
    assert.ok(consentAt < linkAt, "the consent is on file before there is anything to pay");
    assert.equal(minted.length, 1);
  });

  test("the consent record holds the typed name, the kind, the server's own words, and where it was typed from", async () => {
    const { fake } = await post({ ...person(), businesses: [], consent_text: "words the browser invented" });
    const [write] = ran(fake, /INSERT INTO client_consents/);
    assert.equal(write.params[0], ORG_ID);
    assert.equal(write.params[1], CLIENT);
    assert.equal(write.params[2], "soft_pull_consent");
    assert.notEqual(write.params[3], "words the browser invented", "the words come from the server, never the body");
    assert.ok(String(write.params[3]).length > 40);
    assert.equal(write.params[9], "Dana Whitfield");
    assert.equal(write.params[10], "203.0.113.5");
  });

  test("a failed consent write mints no payment link and the client is never told the consent is saved", async () => {
    // a database that cannot be reached: an honest 503, no link
    const down = standIn({ failOn: /INSERT INTO client_consents/ });
    down.fake = fakeDb([[/INSERT INTO client_consents/, Object.assign(new Error("Connection terminated unexpectedly"), { code: "08006" })],
      [/FROM clients WHERE id = \$1 AND org_id = \$2/, [{ id: CLIENT, first_name: "Dana", last_name: "Whitfield", email: "dana@fundhub-client.test.io" }]],
      [/FROM accounts\s+WHERE client_id = \$1/, [{ id: "a1000000-0000-4000-8000-000000000001" }]]]);
    const out = await post({ ...person(), businesses: [] }, { db: down });
    assert.equal(out.res.statusCode, 503);
    assert.equal(out.res.body.db, "down");
    assert.equal(ran(out.fake, NO_PAY).length, 0);

    // any other refusal of the consent write: still no link, and never a 201
    const refused = standIn({ failOn: /INSERT INTO client_consents/ });
    const other = await post({ ...person(), businesses: [] }, { db: refused });
    assert.notEqual(other.res.statusCode, 201);
    assert.notEqual(other.res.body && other.res.body.ok, true);
    assert.equal(refused.minted.length, 0);
    assert.equal(ran(refused.fake, NO_PAY).length, 0);
    assert.ok(at(refused.fake, /INSERT INTO client_consents/) >= 0, "it did try the consent first");
  });

  test("a refused form writes nothing: no identity, no consent, no company, no payment link", async () => {
    const refused = [
      [{ ...person(), granted_name: "" }, 400, "name_required"],
      [{ ...person(), granted_name: "D" }, 400, "name_required"],
      [{ ...person(), ssn: "123-45" }, 400, "ssn_required"],
      [{ ...person(), dob: "04/12/1985" }, 400, "dob_required"],
      [{ ...person(), city: "" }, 400, "address_required"],
      [{ ...person(), state: "Arizona" }, 400, "address_required"],
      [{ ...person(), businesses: [company(1, { ein: "" })] }, 400, "business_ein_required"],
      [{ ...person(), businesses: [company(1, { incorporated_date: "" })] }, 400, "business_incorporated_required"],
      [{ ...person(), businesses: [company(1, { address_line1: "" })] }, 400, "business_address_required"],
      [{ ...person(), businesses: Array.from({ length: 21 }, (_, i) => company(i % 10, { ein: `98-76543${String(i).padStart(2, "0")}` })) }, 400, "businesses_max"],
    ];
    for (const [body, status, error] of refused) {
      const out = await post({ businesses: [], ...body });
      assert.equal(out.res.statusCode, status, error);
      assert.equal(out.res.body.error, error);
      assert.equal(ran(out.fake, /INSERT INTO (?:pii_identity|client_consents|businesses|payment_links)/).length, 0, error);
    }
  });

  test("a link that is unsigned, tampered, expired or missing a part is refused before the database is read", async () => {
    const good = link();
    const cases = [
      [{ ...good, sig: "0".repeat(64) }, 401],
      [{ ...good, client: "c2000000-0000-4000-8000-000000000002" }, 401],
      [link({ now: () => NOW() - 7 * 3600 * 1000 }), 401],
      [{ ...good, exp: "" }, 401],
      [{ ...good, org: "not-a-uuid" }, 400],
    ];
    for (const [token, status] of cases) {
      const out = await post({ ...person(), businesses: [] }, { token });
      assert.equal(out.res.statusCode, status);
      assert.equal(out.fake.calls.length, 0, "the database was not touched");
    }
  });
});

describe("the same page then shows Pay for that total", () => {
  test("no company: $32, one link for exactly $32 on the diagnostic purpose", async () => {
    const { res, minted } = await post({ ...person(), businesses: [] });
    assert.equal(res.body.pricing.total_cents, 3200);
    assert.equal(res.body.pricing.total_display, "$32");
    assert.equal(res.body.checkout.amount_cents, 3200);
    assert.ok(res.body.checkout.checkout_url.startsWith(CHECKOUT_BASE));
    assert.equal(res.body.businesses.count, 0);
    assert.match(res.body.next, /Pay \$32 next/);
    assert.equal(minted.length, 1);
    assert.equal(minted[0].amount_cents, 3200);
    assert.equal(minted[0].purpose, "diagnostic");
  });

  test("two companies: $52, the link is for $52, and both companies are saved before it", async () => {
    const { res, minted, fake } = await post({ ...person(), businesses: [company(1), company(2, { extra_owner_name: "Pat Lee" })] });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.pricing.total_cents, 5200);
    assert.equal(res.body.pricing.total_display, "$52");
    assert.equal(res.body.checkout.amount_cents, 5200);
    assert.equal(res.body.businesses.count, 2);
    assert.equal(minted[0].amount_cents, 5200);
    assert.match(minted[0].description, /\+2 businesses/);
    const saves = ran(fake, /INSERT INTO businesses/);
    assert.equal(saves.length, 2);
    const first = JSON.parse(saves[0].params[4]);
    assert.deepEqual(
      { source: first.source, state: first.state, ein: first.ein, address_line1: first.address_line1 },
      { source: "soft_pull_approve", state: "AZ", ein: "12-3456781", address_line1: "500 Commerce Way" },
    );
    assert.equal(JSON.parse(saves[1].params[4]).extra_owner_name, "Pat Lee");
    assert.ok(at(fake, /INSERT INTO businesses/) < at(fake, NO_PAY), "the companies are saved before the link is minted");
  });

  test("the total is $32 plus $10 for each company, one by one up to 20", async () => {
    for (const n of [1, 3, 6, 20]) {
      const rows = Array.from({ length: n }, (_, i) => company(i % 10, { ein: `55-00000${String(i).padStart(2, "0")}` }));
      const { res } = await post({ ...person(), businesses: rows });
      assert.equal(res.body.checkout.amount_cents, 3200 + 1000 * n, `${n} companies`);
      assert.equal(res.body.businesses.count, n);
    }
  });

  test("an open link at the same total is reused and no second link is minted", async () => {
    const existing = { id: "link-old", status: "sent", amount_cents: 4200, checkout_url: "https://pay.example.test/checkout/old" };
    const db = standIn({ openLinks: [existing] });
    const { res, minted } = await post({ ...person(), businesses: [company(1)] }, { db });
    assert.equal(res.body.checkout.id, "link-old");
    assert.equal(res.body.checkout.checkout_url, existing.checkout_url);
    assert.equal(minted.length, 0);
  });

  test("an open link at another total is expired and a new one at the new total is minted", async () => {
    const stale = { id: "link-stale", status: "sent", amount_cents: 3200, checkout_url: "https://pay.example.test/checkout/stale" };
    const db = standIn({ openLinks: [stale] });
    const { res, minted, expired } = await post({ ...person(), businesses: [company(1), company(2)] }, { db });
    assert.deepEqual(expired, ["link-stale"]);
    assert.equal(minted.length, 1);
    assert.equal(res.body.checkout.amount_cents, 5200);
    assert.notEqual(res.body.checkout.id, "link-stale");
  });

  test("when no checkout can be made the consent still stands and the answer says to ask for the link, with the total", async () => {
    const { res } = await post({ ...person(), businesses: [company(1)] }, { deps: { checkoutBaseUrl: null } });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.consent.valid, true);
    assert.equal(res.body.checkout, null);
    assert.ok(res.body.checkout_error);
    assert.match(res.body.next, /Consent saved\. Ask your advisor for the \$42 pay link\./);
    assert.equal(res.body.pricing.total_display, "$42");
  });
});
