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
import { CURRENT_SOFT_PULL_VERSION, SOFT_PULL_DISCLOSURES } from "../consent/disclosures.mjs";
import { fakeDb, makeRes, ORG_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const ACCOUNT = "a1000000-0000-4000-8000-000000000001";
const PRODUCT = "pr100000-0000-4000-8000-000000000001";
// The words the server holds for the version it serves. Taken from the product's own list, not typed here, so a
// reworded approved text is a change to that list; what must hold is that the right words go in the record.
const SERVER_WORDS = SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION].text.trim();
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
const ownedBy = (link, org, client) => (link.org_id ?? ORG_ID) === org && (link.client_id ?? CLIENT) === client
  && (link.purpose ?? "diagnostic") === "diagnostic";

function standIn({ openLinks = [], failOn = null } = {}) {
  const minted = [];
  const expired = [];
  const marked = [];
  const rules = [
    ...(failOn ? [[failOn, new Error("the database refused this write")]] : []),
    [/FROM clients WHERE id = \$1 AND org_id = \$2/, [{ id: CLIENT, first_name: "Dana", last_name: "Whitfield", email: "dana@fundhub-client.test.io" }]],
    [/FROM client_consents\s+WHERE org_id = \$1 AND client_id = \$2 AND kind = \$3/, []],
    [/FROM accounts\s+WHERE client_id = \$1/, [{ id: ACCOUNT }]],
    [/INSERT INTO pii_identity/, [{ id: "pii-1" }]],
    [/INSERT INTO client_consents/, (_s, p) => [{ id: "cc-1", org_id: p[0], client_id: p[1], kind: p[2], consent_text: p[3], consent_version: p[4], granted_name: p[9] }]],
    // The read the handler makes honours what the database would: the company, the client, the purpose, and the
    // list of statuses the handler passes ($3). A link in a status that is not on that list is not returned.
    [/FROM payment_links\s+WHERE org_id = \$1 AND client_id = \$2 AND purpose = 'diagnostic'\s+AND status = ANY\(\$3\) AND amount_cents = \$4/,
      (_s, p) => openLinks.filter((l) => ownedBy(l, p[0], p[1]) && p[2].includes(l.status) && l.amount_cents === p[3])],
    [/SELECT id FROM payment_links\s+WHERE org_id = \$1 AND client_id = \$2 AND purpose = 'diagnostic'\s+AND status = ANY\(\$3\) AND amount_cents <> \$4/,
      (_s, p) => openLinks.filter((l) => ownedBy(l, p[0], p[1]) && p[2].includes(l.status) && l.amount_cents !== p[3]).map((l) => ({ id: l.id }))],
    // markExpired is "WHERE id = $1 AND org_id = $2 AND status = ANY($4)": only an open link expires.
    [/UPDATE payment_links\s+SET status = 'expired'/, (_s, p) => {
      const row = openLinks.find((l) => l.id === p[0]);
      if (!row || !p[3].includes(row.status)) return [];
      expired.push(p[0]);
      return [{ id: p[0], status: "expired" }];
    }],
    // The product is found by its CODE ($3), the way the real read does, so a wrong product code finds nothing.
    [/FROM products\s+WHERE org_id = \$1/, (_s, p) => (String(p[2] || "").toLowerCase() === "diagnostic" ? [{ id: PRODUCT, code: "diagnostic" }] : [])],
    [/INSERT INTO payment_links/, (_s, p) => {
      const row = {
        id: `link-${minted.length + 1}`, org_id: p[0], client_id: p[1], status: "created", purpose: p[2], description: p[3],
        amount_cents: p[4], checkout_url: p[7], product_id: p[10],
      };
      minted.push(row);
      return [row];
    }],
    [/UPDATE payment_links\s+SET status = 'sent'/, (_s, p) => {
      const row = [...minted, ...openLinks].find((l) => l.id === p[0]);
      if (!row || row.status !== "created") return [];
      marked.push(p[0]);
      return [{ ...row, status: "sent" }];
    }],
  ];
  const fake = fakeDb(rules);
  return { fake, minted, expired, marked };
}

async function post(body, { db = standIn(), token = link(), deps = {} } = {}) {
  const res = makeRes();
  await handler(
    { method: "POST", body: { ...token, ...body }, query: {}, headers: { "x-forwarded-for": "203.0.113.5", "user-agent": "test-browser" } },
    res,
    { db: db.fake, env: ENV, secret: SECRET, now: NOW, checkoutBaseUrl: CHECKOUT_BASE,
      // A signed link is never a client session; prove the happy path with a
      // separately authenticated client principal. Per-test overrides below
      // still exercise unauthenticated/wrong-buyer refusals.
      resolvePrincipal: async () => ({ kind: "client", orgId: ORG_ID, clientId: CLIENT, accountId: ACCOUNT }),
      ...deps },
  );
  return { res, ...db };
}

const at = (fake, re) => fake.calls.findIndex((c) => re.test(c.sql));
const ran = (fake, re) => fake.calls.filter((c) => re.test(c.sql));
const NO_PAY = /INSERT INTO payment_links/;

describe("signed link is not a client session", () => {
  test("an unsigned-in visitor cannot save consent or create a checkout, even with a valid link", async () => {
    const { res, fake, minted } = await post({ ...person(), businesses: [] }, {
      deps: { resolvePrincipal: async () => null }
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.error, "account_required");
    assert.equal(minted.length, 0);
    assert.equal(ran(fake, /INSERT INTO (?:pii_identity|client_consents|businesses|payment_links)/).length, 0);
  });

  test("a session for a different buyer, company or staff role cannot use this signed link", async () => {
    const wrongPrincipals = [
      { kind: "client", orgId: ORG_ID, clientId: OTHER_CLIENT, accountId: ACCOUNT },
      { kind: "client", orgId: "0b000000-0000-4000-8000-000000000002", clientId: CLIENT, accountId: ACCOUNT },
      { kind: "staff", orgId: ORG_ID, clientId: CLIENT, accountId: ACCOUNT }
    ];
    for (const principal of wrongPrincipals) {
      const { res, fake, minted } = await post({ ...person(), businesses: [] }, {
        deps: { resolvePrincipal: async () => principal }
      });
      assert.equal(res.statusCode, 401, JSON.stringify(principal));
      assert.equal(res.body.error, "account_required");
      assert.equal(minted.length, 0);
      assert.equal(ran(fake, /INSERT INTO (?:pii_identity|client_consents|businesses|payment_links)/).length, 0);
    }
  });
});

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

  test("the consent record holds the typed name, the kind, the server's own words and version, and where it was typed from", async () => {
    const { fake, res } = await post({
      ...person(), businesses: [], consent_text: "words the browser invented", consent_version: "v0-from-the-browser",
      capture_method: "checkbox",
    });
    const [write] = ran(fake, /INSERT INTO client_consents/);
    assert.equal(write.params[0], ORG_ID);
    assert.equal(write.params[1], CLIENT);
    assert.equal(write.params[2], "soft_pull_consent");
    assert.notEqual(write.params[3], "words the browser invented", "the words come from the server, never the body");
    // EXACTLY the words the server holds for the version it serves, and that version's key
    assert.equal(write.params[3], SERVER_WORDS, "the recorded words are the server's own words for the current version");
    assert.equal(write.params[4], CURRENT_SOFT_PULL_VERSION, "the recorded version is the current one, not the browser's");
    assert.equal(res.body.consent.version, CURRENT_SOFT_PULL_VERSION);
    // how it was captured, and by whom: a typed name by the client's own account, from this browser
    assert.equal(write.params[8], "typed", "the method is a typed name, whatever the browser says");
    assert.equal(write.params[5], "client");
    assert.equal(write.params[6], ACCOUNT);
    assert.equal(write.params[9], "Dana Whitfield");
    assert.equal(write.params[10], "203.0.113.5");
    assert.equal(write.params[11], "test-browser");
  });

  test("the words the page is shown (GET) are the words that are recorded (POST), under the same version", async () => {
    const res = makeRes();
    const token = link();
    await handler({ method: "GET", query: token, headers: {} }, res, {
      db: standIn().fake, env: ENV, secret: SECRET, now: NOW,
      resolvePrincipal: async () => ({ kind: "client", orgId: ORG_ID, clientId: CLIENT, accountId: ACCOUNT })
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.disclosure.text, SERVER_WORDS);
    assert.equal(res.body.disclosure.version, CURRENT_SOFT_PULL_VERSION);
    assert.equal(res.body.version, CURRENT_SOFT_PULL_VERSION);
    const { fake } = await post({ ...person(), businesses: [] });
    const [write] = ran(fake, /INSERT INTO client_consents/);
    assert.equal(write.params[3], res.body.disclosure.text);
    assert.equal(write.params[4], res.body.disclosure.version);
  });

  test("a typed name that is blank or one letter stores no consent even when the rest of the form is good", async () => {
    for (const granted_name of ["", " ", "D"]) {
      const out = await post({ ...person(), granted_name, businesses: [] });
      assert.equal(out.res.statusCode, 400, JSON.stringify(granted_name));
      assert.equal(ran(out.fake, /INSERT INTO client_consents/).length, 0);
    }
  });

  test("a failed consent write mints no payment link and the client is never told the consent is saved", async () => {
    // a database that cannot be reached: an honest 503, no link
    const down = standIn({ failOn: /INSERT INTO client_consents/ });
    down.fake = fakeDb([[/INSERT INTO client_consents/, Object.assign(new Error("Connection terminated unexpectedly"), { code: "08006" })],
      [/FROM clients WHERE id = \$1 AND org_id = \$2/, [{ id: CLIENT, first_name: "Dana", last_name: "Whitfield", email: "dana@fundhub-client.test.io" }]],
      [/INSERT INTO pii_identity/, [{ id: "pii-1" }]],
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

describe("staff stamps one saved business incorporation date", () => {
  const STAFF = "5a000000-0000-4000-8000-000000000001";
  const staff = { id: STAFF, role: "funding_advisor", org_id: ORG_ID };

  test("stamp_incorporated updates only the named business on this client's company and returns its measured age", async () => {
    const fake = fakeDb([
      [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]],
      [/UPDATE businesses[\s\S]*WHERE org_id = \$1 AND client_id = \$2 AND name = \$3/, (_sql, p) => [{
        id: "b1000000-0000-4000-8000-000000000001",
        name: p[2],
        age_months: p[3],
        incorporated_date: p[4],
      }]],
    ]);
    const res = makeRes();
    await handler({
      method: "POST",
      body: { action: "stamp_incorporated", client_id: CLIENT, business_name: "Acme 1 LLC", incorporated_date: "2021-03" },
      query: {}, headers: {},
    }, res, { db: fake, requireAuth: async () => staff, now: NOW });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.business, { name: "Acme 1 LLC", incorporated_date: "2021-03", age_months: 67 });
    const [write] = ran(fake, /UPDATE businesses/);
    assert.deepEqual(write.params, [ORG_ID, CLIENT, "Acme 1 LLC", 67, "2021-03"]);
    assert.match(write.sql, /WHERE org_id = \$1 AND client_id = \$2 AND name = \$3/);
  });

  test("stamp_incorporated cannot stamp another company's client or touch a business", async () => {
    const fake = fakeDb([[/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, []]]);
    const res = makeRes();
    await handler({
      method: "POST",
      body: { action: "stamp_incorporated", client_id: OTHER_CLIENT, business_name: "Their LLC", incorporated_date: "2021-03" },
      query: {}, headers: {},
    }, res, { db: fake, requireAuth: async () => staff, now: NOW });
    assert.equal(res.statusCode, 404);
    assert.equal(ran(fake, /UPDATE businesses/).length, 0);
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
      const { res, minted } = await post({ ...person(), businesses: rows });
      assert.equal(res.body.checkout.amount_cents, 3200 + 1000 * n, `${n} companies`);
      assert.equal(res.body.businesses.count, n);
      // the label the page shows and the amount the link charges are one number
      assert.equal(res.body.pricing.total_cents, res.body.checkout.amount_cents, `${n}: the label total is the link's amount`);
      assert.equal(res.body.pricing.total_display, res.body.checkout.amount_display, `${n}: the label text is the link's amount text`);
      assert.equal(minted[0].amount_cents, res.body.checkout.amount_cents, `${n}: the saved link holds that amount`);
      assert.equal(minted[0].product_id, PRODUCT, "the link is for the soft-pull product (code diagnostic)");
    }
  });

  test("previous $32 event never covers a changed $42 assessment", async () => {
    const db = standIn();
    const prior = db.fake.query.bind(db.fake);
    let pulls = 0;
    db.fake.query = (sql, params) => {
      if (/FROM events\s+WHERE org_id = \$1 AND client_id = \$2 AND name = 'diagnostic.paid'/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: "old-event", org_id: ORG_ID, client_id: CLIENT,
          payload: { source: "commas", product: "crs", amount: 32 } }] });
      }
      return prior(sql, params);
    };
    const { res, minted } = await post({ ...person(), businesses: [company(1)] }, {
      db, deps: { runPaidPull: async () => { pulls++; throw Error("unexpected bureau request"); } }
    });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.pricing.total_cents, 4200);
    assert.equal(res.body.paid, true, "the old payment remains recorded");
    assert.equal(res.body.payment_review_required, true);
    assert.equal(res.body.pull, null);
    assert.equal(res.body.checkout, null, "do not charge automatically");
    assert.match(res.body.next, /earlier payment does not cover/);
    assert.equal(pulls, 0);
    assert.equal(minted.length, 0);
  });

  test("previous paid link for a smaller amount never promises a report", async () => {
    const db = standIn();
    const prior = db.fake.query.bind(db.fake);
    db.fake.query = (sql, params) => {
      if (/SELECT \* FROM payment_links/.test(String(sql)) && /status = 'paid'/.test(String(sql))) {
        return Promise.resolve({ rows: [{ id: "settled-link", status: "paid", amount_cents: 3200 }] });
      }
      return prior(sql, params);
    };
    const { res, minted } = await post({ ...person(), businesses: [company(1)] }, { db });
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.pricing.total_cents, 4200);
    assert.equal(res.body.paid, true);
    assert.equal(res.body.payment_review_required, true);
    assert.match(res.body.next, /advisor to review/);
    assert.equal(res.body.checkout, null);
    assert.equal(minted.length, 0, "do not duplicate a settled checkout");
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

  test("a link that is created but not yet sent at the same total is reused and is marked sent", async () => {
    const created = { id: "link-created", status: "created", amount_cents: 3200, checkout_url: "https://pay.example.test/checkout/created" };
    const db = standIn({ openLinks: [created] });
    const { res, minted, marked } = await post({ ...person(), businesses: [] }, { db });
    assert.equal(res.body.checkout.id, "link-created");
    assert.equal(minted.length, 0, "no second link");
    assert.deepEqual(marked, ["link-created"], "the reused link is marked sent");
  });

  test("only open links count: a paid, expired or cancelled link at the same total is not reused, and a new one is minted", async () => {
    for (const status of ["paid", "expired", "cancelled", "failed", "refunded"]) {
      const old = { id: `link-${status}`, status, amount_cents: 3200, checkout_url: `https://pay.example.test/checkout/${status}` };
      const db = standIn({ openLinks: [old] });
      const { res, minted, expired } = await post({ ...person(), businesses: [] }, { db });
      assert.notEqual(res.body.checkout.id, old.id, `${status}: not reused`);
      assert.equal(minted.length, 1, `${status}: a new link was minted`);
      assert.deepEqual(expired, [], `${status}: nothing was expired`);
    }
  });

  test("a paid link at another total is left alone: only open links are expired", async () => {
    const paid = { id: "link-paid", status: "paid", amount_cents: 3200, checkout_url: "https://pay.example.test/checkout/paid" };
    const sent = { id: "link-sent-old", status: "sent", amount_cents: 4200, checkout_url: "https://pay.example.test/checkout/sent" };
    const db = standIn({ openLinks: [paid, sent] });
    const { res, minted, expired } = await post({ ...person(), businesses: [company(1), company(2)] }, { db });
    assert.deepEqual(expired, ["link-sent-old"], "the open one expired, the paid one did not");
    assert.equal(minted.length, 1);
    assert.equal(res.body.checkout.amount_cents, 5200);
  });

  test("another client's open link, and another purpose's open link, are never reused or expired", async () => {
    const theirs = { id: "link-theirs", status: "sent", amount_cents: 3200, client_id: OTHER_CLIENT, checkout_url: "https://pay.example.test/checkout/theirs" };
    const deposit = { id: "link-deposit", status: "sent", amount_cents: 3200, purpose: "deposit", checkout_url: "https://pay.example.test/checkout/deposit" };
    const farAway = { id: "link-theirs-far", status: "sent", amount_cents: 9900, client_id: OTHER_CLIENT, checkout_url: "https://pay.example.test/checkout/far" };
    const db = standIn({ openLinks: [theirs, deposit, farAway] });
    const { res, minted, expired } = await post({ ...person(), businesses: [] }, { db });
    assert.notEqual(res.body.checkout.id, "link-theirs");
    assert.notEqual(res.body.checkout.id, "link-deposit");
    assert.equal(minted.length, 1);
    assert.deepEqual(expired, [], "nobody else's link was touched");
  });

  test("the link is made for the soft-pull product (code diagnostic) and the diagnostic purpose", async () => {
    // the stand-in finds a product only by the code the handler asks for, so another code finds nothing and no
    // link is made at all
    const { res, minted } = await post({ ...person(), businesses: [] });
    assert.equal(minted.length, 1, "a link was made, which it is only when the product code found the product");
    assert.equal(minted[0].product_id, PRODUCT);
    assert.equal(minted[0].purpose, "diagnostic");
    assert.equal(res.body.checkout.amount_cents, 3200);
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
