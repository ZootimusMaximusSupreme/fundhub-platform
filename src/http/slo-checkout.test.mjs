// GET/POST /api/public/slo-checkout — $297 SLO till.
// PURE UNIT TEST, NO DATABASE. npm test's glob is src/** only.

import { test } from "node:test";
import assert from "node:assert/strict";
import handler, {
  parseSloCheckoutBody,
  parseAffiliateTrackingId,
  parseSloPhone,
  runSloCheckout,
  sloMetaMatch,
  sloPageConfig
} from "../../api/public/slo-checkout.mjs";
import { resolveSloBuyer } from "../slo/buyer.mjs";
import {
  SLO_KEEP_TITLE,
  SLO_PRICE_CENTS,
  SLO_PULL_PATH,
  SLO_SOURCE,
  sloPullSuccessUrl
} from "../slo/offer.mjs";

const LIVE_ENV = { FANBASIS_CHECKOUT_API_KEY: "test-key", PUBLIC_BASE_URL: "https://fundhub.ai" };
const DEAD_ENV = {};

function fakeRes() {
  const res = {
    statusCode: null, body: null, headers: {},
    setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; }
  };
  return res;
}

test("GET states $297 and the pull path, and no earnings figure", () => {
  const page = sloPageConfig(LIVE_ENV);
  assert.equal(page.priceCents, SLO_PRICE_CENTS);
  assert.equal(page.priceCents, 14700);
  assert.equal(page.next, SLO_PULL_PATH);
  assert.equal(page.checkout.ready, true);
  const blob = JSON.stringify(page);
  assert.equal(blob.includes("earn"), false);
  assert.equal(blob.includes("income"), false);
});

test("parseSloCheckoutBody needs a real email", () => {
  assert.equal(parseSloCheckoutBody(null).error, "invalid_json");
  assert.equal(parseSloCheckoutBody({}).error, "email_required");
  assert.equal(parseSloCheckoutBody({ email: "not-an-email" }).error, "email_required");
  const ok = parseSloCheckoutBody({ email: "Pat@Example.com", first_name: "Pat", last_name: "Lee" });
  assert.equal(ok.ok, true);
  assert.equal(ok.email, "pat@example.com");
  assert.equal(ok.name, "Pat Lee");
  assert.equal(ok.attribution, null);
});

test("parseAffiliateTrackingId keeps AFF codes and drops checkout refs", () => {
  assert.equal(parseAffiliateTrackingId({ a1: "aff-000121" }), "AFF-000121");
  assert.equal(parseAffiliateTrackingId({ ref: "AFF-000121" }), "AFF-000121");
  assert.equal(parseAffiliateTrackingId({ ref: "slo_abc123" }), null);
  assert.equal(parseAffiliateTrackingId({ email: "a@b.co" }), null);
});

test("parseSloCheckoutBody keeps an affiliate code off the UTMs", () => {
  const ok = parseSloCheckoutBody({
    email: "buyer@example.com",
    a1: "AFF-000121",
    utm_source: "fb"
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.affiliateTrackingId, "AFF-000121");
  assert.equal(ok.attribution.utm_source, "fb");
});

test("runSloCheckout attributes a buyer when a1 is a live affiliate code", async () => {
  const seen = [];
  const parsed = parseSloCheckoutBody({
    email: "buyer@example.com",
    name: "Pat Lee",
    a1: "AFF-000121"
  });
  const out = await runSloCheckout(parsed, sloDeps({
    attributeAffiliate: async (_db, args) => { seen.push(args); return { attributed: true }; },
    createCheckoutSession: async () => ({ ok: true, paymentLink: "https://pay.example.test/slo", productId: "cs_slo_1" })
  }));
  assert.equal(out.ok, true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].trackingId, "AFF-000121");
  assert.equal(seen[0].clientId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
});

test("parseSloCheckoutBody keeps Creative Factory UTMs and drops junk", () => {
  const ok = parseSloCheckoutBody({
    email: "buyer@example.com",
    utm_source: "fb",
    utm_medium: "paid",
    utm_campaign: "funding600",
    utm_content: "42-ringlights",
    utm_term: "sun",
    landing_path: "/roadmap/",
    referrer_domain: "l.facebook.com",
    // Meta Phase 4 (docs/tracking/meta-events.md): fbclid is kept now; other click ids are still junk.
    fbclid: "IwAR0x_9-AbC",
    gclid: "DROPME"
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.attribution, {
    utm_source: "fb",
    utm_medium: "paid",
    utm_campaign: "funding600",
    utm_content: "42-ringlights",
    utm_term: "sun",
    landing_path: "/roadmap/",
    referrer_domain: "l.facebook.com",
    fbclid: "IwAR0x_9-AbC"
  });
});

function sloDeps(over = {}) {
  const links = [];
  return {
    env: LIVE_ENV,
    orgId: "org-1",
    db: {
      async query(sql) {
        if (/UPDATE clients\s+SET phone = COALESCE/.test(sql)) return { rows: [] };
        throw new Error("slo checkout must not query through the runner");
      }
    },
    resolveBuyer: async () => ({ clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", created: true }),
    ensureAccount: async () => "acct-1",
    resolveProduct: async () => "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    recordLink: async (_db, row) => { links.push(row); return { id: "pl-1" }; },
    emit: async () => ({ id: "evt-1" }),
    checkoutConfig: () => ({ ok: true }),
    links,
    ...over
  };
}

test("runSloCheckout mints Assessment at $297 and sends them to the pull form", async () => {
  const sent = [];
  const events = [];
  const deps = sloDeps({
    ref: "slo_test_ref_1",
    emit(_db, name, payload) {
      events.push({ name, payload });
      return { id: "evt-1" };
    },
    createCheckoutSession: async (opts) => {
      sent.push(opts);
      return { ok: true, paymentLink: "https://pay.example.test/slo", productId: "cs_slo_1" };
    }
  });
  const out = await runSloCheckout({ email: "buyer@example.com", name: "Pat Lee" }, deps);

  assert.equal(out.ok, true);
  assert.equal(out.checkoutUrl, "https://pay.example.test/slo");
  assert.equal(out.ref, "slo_test_ref_1");
  assert.equal(out.next, SLO_PULL_PATH);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].amountCents, 14700);
  assert.equal(sent[0].productTitle, SLO_KEEP_TITLE);
  assert.equal(sent[0].productTitle, "Consulting Services Assessment");
  assert.equal(sent[0].successUrl, "https://fundhub.ai/roadmap/pull.html");
  assert.equal(sent[0].metadata.source, SLO_SOURCE);
  assert.equal(sent[0].metadata.link_ref, "slo_test_ref_1");
  assert.equal(sent[0].metadata.client_id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(events[0].name, "slo.checkout_started");
  assert.equal(events[0].payload.email, "buyer@example.com");
  assert.equal(events[0].payload.actor, "agent");
  assert.equal(events[0].payload.actor_reason, "test_email");
  assert.equal(deps.links[0].ref, "slo_test_ref_1");
  assert.equal(deps.links[0].clientId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(deps.links[0].commasSessionId, "cs_slo_1");
});

test("runSloCheckout writes a diagnostic payment link so the UnderwriteIQ pull fires", async () => {
  const deps = sloDeps({
    ref: "slo_wire_1",
    createCheckoutSession: async () => ({ ok: true, paymentLink: "https://pay.example.test/slo" })
  });
  const out = await runSloCheckout({ email: "buyer@example.com", name: "Pat Lee" }, deps);
  assert.equal(out.ok, true);
  assert.equal(deps.links.length, 1);
  assert.equal(deps.links[0].amountCents, 14700);
  assert.equal(deps.links[0].ref, "slo_wire_1");
});

test("runSloCheckout writes ad tags onto the buyer, first touch, no email guess beyond find-or-create", async () => {
  const attrCalls = [];
  const fieldCalls = [];
  const parsed = parseSloCheckoutBody({
    email: "buyer@example.com",
    utm_content: "42-ringlights",
    utm_source: "fb"
  });
  const out = await runSloCheckout(parsed, sloDeps({
    createCheckoutSession: async () => ({ ok: true, paymentLink: "https://pay.example.test/slo" }),
    upsertAttribution: async (_db, row) => { attrCalls.push(row); return row; },
    mergeFields: async (_db, clientId, patch) => { fieldCalls.push({ clientId, patch }); }
  }));
  assert.equal(out.ok, true);
  assert.equal(attrCalls.length, 1);
  assert.equal(attrCalls[0].clientId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  assert.equal(attrCalls[0].attribution.utm_content, "42-ringlights");
  assert.equal(attrCalls[0].attribution.utm_source, "fb");
  assert.equal(fieldCalls[0].patch.utm_content, "42-ringlights");
});

test("runSloCheckout does not mint a new catalog title", async () => {
  let title = null;
  await runSloCheckout(
    { email: "buyer@example.com", name: null },
    sloDeps({
      createCheckoutSession: async (opts) => {
        title = opts.productTitle;
        return { ok: true, paymentLink: "https://pay.example.test/slo" };
      }
    })
  );
  assert.equal(title, "Consulting Services Assessment");
  assert.equal(/slo|diagnostic pack|funding diagnostic/i.test(title), false);
});

test("runSloCheckout refuses when Commas is off", async () => {
  const out = await runSloCheckout(
    { email: "buyer@example.com", name: null },
    { env: DEAD_ENV, orgId: "org-1", checkoutConfig: () => ({ ok: false }) }
  );
  assert.equal(out.ok, false);
  assert.equal(out.error, "checkout_not_configured");
});

test("POST without email is 400; GET is 200", async () => {
  const bad = fakeRes();
  await handler({ method: "POST", body: {} }, bad);
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.body.error, "email_required");

  const get = fakeRes();
  await handler({ method: "GET" }, get);
  assert.equal(get.statusCode, 200);
  assert.equal(get.body.priceCents, 14700);
});

test("sloPullSuccessUrl never puts SSN or amount on the address", () => {
  const url = sloPullSuccessUrl(LIVE_ENV);
  assert.equal(url, "https://fundhub.ai/roadmap/pull.html");
  assert.equal(url.includes("ssn"), false);
  assert.equal(url.includes("297"), false);
});

/* ── The /roadmap widget (owner-set 2026-09-22) ──────────────────────────── */

const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-09-22T12:00:00Z");

function business(over = {}) {
  return {
    name: "Acme Holdings LLC",
    address: "200 Commerce St",
    city: "Dallas",
    state: "TX",
    zip: "75201",
    ein: "12-3456789",
    started: "03/2021",
    ...over
  };
}

test("DEMO: records the order stamped demo, never calls Commas, answers ref + client_id", async () => {
  let minted = 0;
  const events = [];
  const deps = sloDeps({
    env: { SLO_DEMO_PAY: "1" }, // no Commas key at all: demo must not need one
    ref: "slo_demo_1",
    checkoutConfig: () => ({ ok: false }),
    createCheckoutSession: async () => { minted += 1; return { ok: true, paymentLink: "x" }; },
    emit: async (_db, name, payload) => { events.push({ name, payload }); return { id: "e" }; }
  });
  const out = await runSloCheckout({ email: "buyer@example.com", name: "Pat Lee", businesses: 1 }, deps);

  assert.equal(minted, 0, "Commas is never called in demo");
  assert.deepEqual(
    { ok: out.ok, demo: out.demo, ref: out.ref, client_id: out.client_id, priceCents: out.priceCents },
    { ok: true, demo: true, ref: "slo_demo_1", client_id: CLIENT, priceCents: 14700 }
  );
  assert.equal(out.checkoutUrl, undefined);
  assert.equal(deps.links.length, 1);
  assert.equal(deps.links[0].isDemo, true);
  assert.equal(deps.links[0].amountCents, 14700);
  assert.equal(deps.links[0].ref, "slo_demo_1");
  assert.equal(events[0].name, "slo.checkout_started");
  assert.equal(events[0].payload.demo, true);
  assert.equal(deps.links[0].businessCount, 1, "the business count rides on the order row");
});

test("DEMO off: the real path is unchanged — Assessment title, Commas URL, client_id returned", async () => {
  const sent = [];
  const deps = sloDeps({
    ref: "slo_live_1",
    createCheckoutSession: async (opts) => {
      sent.push(opts);
      return { ok: true, paymentLink: "https://pay.example.test/slo", productId: "cs_1" };
    }
  });
  const out = await runSloCheckout({ email: "buyer@example.com", name: null, businesses: 1 }, deps);
  assert.equal(out.ok, true);
  assert.equal(out.demo, false);
  assert.equal(out.checkoutUrl, "https://pay.example.test/slo");
  assert.equal(out.client_id, CLIENT);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].productTitle, "Consulting Services Assessment");
  assert.equal(deps.links[0].isDemo, undefined);
});

test("SLO_DEMO_PAY only turns on for exactly '1'", async () => {
  for (const value of ["0", "true", "yes", " ", "", undefined]) {
    let minted = 0;
    await runSloCheckout({ email: "buyer@example.com", name: null }, sloDeps({
      env: { ...LIVE_ENV, SLO_DEMO_PAY: value },
      createCheckoutSession: async () => { minted += 1; return { ok: true, paymentLink: "https://p" }; }
    }));
    assert.equal(minted, 1, `SLO_DEMO_PAY=${JSON.stringify(value)} must be the real path`);
  }
});

test("businesses: first free, $15 each extra, from a list or from a count", async () => {
  const fromList = parseSloCheckoutBody({
    email: "buyer@example.com",
    businesses: [business(), business({ name: "Beta Co" }), business({ name: "Gamma Co" })]
  }, { now: NOW });
  assert.equal(fromList.ok, true, JSON.stringify(fromList.errors));
  assert.equal(fromList.businesses, 3);
  assert.equal(fromList.businessRows.length, 3);

  const fromCount = parseSloCheckoutBody({ email: "buyer@example.com", business_count: 2 });
  assert.equal(fromCount.businesses, 2);
  assert.equal(fromCount.businessRows, null);

  const none = parseSloCheckoutBody({ email: "buyer@example.com", businesses: [] });
  assert.equal(none.businesses, 1, "the base price includes the first business");

  let amount = null;
  const stored = [];
  const out = await runSloCheckout(fromList, sloDeps({
    env: { SLO_DEMO_PAY: "1" },
    replaceBusinesses: async (_db, args) => { stored.push(args); }
  }));
  amount = out.priceCents;
  assert.equal(amount, 14700 + 1500 * 2);
  assert.equal(out.priceDisplay, "$177");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].businesses.length, 3);
  assert.equal(stored[0].clientId, CLIENT);
});

test("a count sends no list, so stored businesses are left alone", async () => {
  let replaced = 0;
  await runSloCheckout(
    parseSloCheckoutBody({ email: "buyer@example.com", business_count: 2 }),
    sloDeps({ env: { SLO_DEMO_PAY: "1" }, replaceBusinesses: async () => { replaced += 1; } })
  );
  assert.equal(replaced, 0);
});

test("field errors come back as errors[{field, code, message}]", async () => {
  const bad = parseSloCheckoutBody({
    email: "nope",
    businesses: [business({ name: "", zip: "1" })]
  }, { now: NOW });
  assert.equal(bad.ok, false);
  const fields = bad.errors.map((e) => e.field).sort();
  assert.deepEqual(fields, ["businesses.0.name", "businesses.0.zip", "email"]);
  for (const e of bad.errors) assert.equal(typeof e.message, "string");

  assert.equal(parseSloCheckoutBody({ email: "a@b.co", business_count: 0 }).errors[0].field, "business_count");
  assert.equal(parseSloCheckoutBody({ email: "a@b.co", business_count: 21 }).error, "businesses_invalid");

  const res = fakeRes();
  await handler({ method: "POST", headers: {}, body: { email: "nope" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.errors[0].field, "email");
});

test("return_url: an allow-listed https page becomes the Commas success page; anything else is ignored", async () => {
  const good = parseSloCheckoutBody({ email: "buyer@example.com", return_url: "https://apply.fundhub.ai/roadmap" });
  assert.equal(good.returnUrl, "https://apply.fundhub.ai/roadmap");
  const evil = parseSloCheckoutBody({ email: "buyer@example.com", return_url: "https://evil.example/x" });
  assert.equal(evil.returnUrl, null);

  const sent = [];
  await runSloCheckout(good, sloDeps({
    createCheckoutSession: async (opts) => { sent.push(opts); return { ok: true, paymentLink: "https://p" }; }
  }));
  assert.equal(sent[0].successUrl, "https://apply.fundhub.ai/roadmap");

  await runSloCheckout(evil, sloDeps({
    createCheckoutSession: async (opts) => { sent.push(opts); return { ok: true, paymentLink: "https://p" }; }
  }));
  assert.equal(sent[1].successUrl, "https://fundhub.ai/roadmap/pull.html");
});

test("GET says whether this is demo pay, and demo checkout counts as ready", async () => {
  const demo = sloPageConfig({ SLO_DEMO_PAY: "1" });
  assert.equal(demo.demo, true);
  assert.equal(demo.checkout.ready, true);
  assert.match(demo.notices.charge, /not charged/);
  const live = sloPageConfig(LIVE_ENV);
  assert.equal(live.demo, false);
  assert.match(live.notices.charge, /\$147/);
  const dead = sloPageConfig(DEAD_ENV);
  assert.equal(dead.checkout.ready, false);
});

test("POST from the widget carries the Allow-Origin header back", async () => {
  const res = fakeRes();
  await handler({ method: "POST", headers: { origin: "https://apply.fundhub.ai" }, body: {} }, res);
  assert.equal(res.headers["access-control-allow-origin"], "https://apply.fundhub.ai");
  assert.equal(res.statusCode, 400);
});

/* ── 2026-09-22 review ─────────────────────────────────────────────────────── */

test("item 2: existing email — first-touch ad tags only; no account, businesses, or slo_ref", async () => {
  for (const env of [{ SLO_DEMO_PAY: "1" }, LIVE_ENV]) {
    const writes = [];
    const attrCalls = [];
    const deps = sloDeps({
      env,
      ref: "slo_existing_1",
      resolveBuyer: async () => ({ clientId: CLIENT, created: false }),
      ensureAccount: async () => { writes.push("account"); return "acct"; },
      upsertAttribution: async (_db, row) => { writes.push("attribution"); attrCalls.push(row); },
      mergeFields: async () => { writes.push("custom_fields"); },
      replaceBusinesses: async () => { writes.push("businesses"); },
      stampSlo: async () => { writes.push("slo_ref"); },
      createCheckoutSession: async () => ({ ok: true, paymentLink: "https://pay.example.test/slo" })
    });
    const parsed = parseSloCheckoutBody({
      email: "someone.else@example.com",
      utm_source: "fb",
      utm_content: "43",
      businesses: [business(), business({ name: "Beta Co" })]
    }, { now: NOW });
    const out = await runSloCheckout(parsed, deps);
    assert.equal(out.ok, true);
    assert.deepEqual(writes, ["attribution"], `${env.SLO_DEMO_PAY ? "demo" : "live"}: ad tags only on an existing email`);
    assert.equal(attrCalls[0].attribution.utm_content, "43");
    assert.equal(deps.links.length, 1);
    assert.equal(deps.links[0].ref, "slo_existing_1");
    assert.equal(deps.links[0].businessCount, 2, "the ref and the business count live on the order row");
  }
});

test("item 2: existing email with no utm_* still writes nothing to the client", async () => {
  const writes = [];
  const deps = sloDeps({
    env: { SLO_DEMO_PAY: "1" },
    ref: "slo_existing_plain",
    resolveBuyer: async () => ({ clientId: CLIENT, created: false }),
    ensureAccount: async () => { writes.push("account"); return "acct"; },
    upsertAttribution: async () => { writes.push("attribution"); },
    mergeFields: async () => { writes.push("custom_fields"); },
    replaceBusinesses: async () => { writes.push("businesses"); }
  });
  const out = await runSloCheckout(
    parseSloCheckoutBody({ email: "plain@example.com", businesses: [business()] }, { now: NOW }),
    deps
  );
  assert.equal(out.ok, true);
  assert.deepEqual(writes, []);
});

test("item 2: a client this checkout CREATED gets its account, ad tags and businesses; slo_ref waits for the pull", async () => {
  const writes = [];
  const out = await runSloCheckout(
    parseSloCheckoutBody({ email: "new.buyer@example.com", utm_source: "fb", businesses: [business()] }, { now: NOW }),
    sloDeps({
      env: { SLO_DEMO_PAY: "1" },
      resolveBuyer: async () => ({ clientId: CLIENT, created: true }),
      ensureAccount: async () => { writes.push("account"); return "acct"; },
      upsertAttribution: async () => { writes.push("attribution"); },
      mergeFields: async () => { writes.push("custom_fields"); },
      replaceBusinesses: async () => { writes.push("businesses"); },
      stampSlo: async () => { writes.push("slo_ref"); }
    })
  );
  assert.equal(out.ok, true);
  assert.deepEqual(writes, ["attribution", "account", "custom_fields", "businesses"]);
});

test("item 2: resolveSloBuyer returns an existing email's id WITHOUT touching the row", async () => {
  const seen = [];
  const db = {
    async query(sql, params) {
      seen.push({ sql, params });
      if (/SELECT id FROM clients/.test(sql)) return { rows: [{ id: CLIENT }] };
      throw new Error(`must not write to an existing client: ${sql}`);
    }
  };
  const out = await resolveSloBuyer(db, { orgId: "org-1", email: "Victim@Example.com", name: "Mallory", phone: "+15555550100" });
  assert.deepEqual(out, { clientId: CLIENT, created: false });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].params, ["org-1", "victim@example.com"]);
});

test("item 7: phone is optional, 10 US digits when sent, stored as +1XXXXXXXXXX", () => {
  assert.deepEqual(parseSloPhone(""), { value: null });
  assert.deepEqual(parseSloPhone(null), { value: null });
  assert.deepEqual(parseSloPhone("(555) 555-0100"), { value: "+15555550100" });
  assert.deepEqual(parseSloPhone("5555550100"), { value: "+15555550100" });
  assert.deepEqual(parseSloPhone("+1 555 555 0100"), { value: "+15555550100" });
  assert.equal(parseSloPhone("555-0100").error.field, "phone");
  assert.equal(parseSloPhone("555-0100").error.code, "phone_invalid");
  assert.equal(parseSloPhone("25555550100").error.code, "phone_invalid", "11 digits must start with 1");

  const ok = parseSloCheckoutBody({ email: "buyer@example.com", phone: "555.555.0100" });
  assert.equal(ok.ok, true);
  assert.equal(ok.phone, "+15555550100");
  assert.equal(parseSloCheckoutBody({ email: "buyer@example.com" }).phone, null);
  const bad = parseSloCheckoutBody({ email: "buyer@example.com", phone: "12345" });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.map((e) => e.field), ["phone"]);
});

test("item 7: the phone reaches the new client through the one client door (resolveClient)", async () => {
  const buyers = [];
  await runSloCheckout(
    parseSloCheckoutBody({ email: "buyer@example.com", first_name: "Pat", last_name: "Lee", phone: "(555) 555-0100" }),
    sloDeps({ env: { SLO_DEMO_PAY: "1" }, resolveBuyer: async (_db, args) => { buyers.push(args); return { clientId: CLIENT, created: true }; } })
  );
  assert.equal(buyers[0].phone, "+15555550100");

  const inserts = [];
  const db = {
    async query(sql, params) {
      if (/SELECT id FROM clients/.test(sql)) return { rows: [] };
      if (/INSERT INTO clients/.test(sql)) { inserts.push(params); return { rows: [{ id: CLIENT }] }; }
      return { rows: [] };
    }
  };
  const out = await resolveSloBuyer(db, { orgId: "org-1", email: "buyer@example.com", name: "Pat Lee", phone: "+15555550100" });
  assert.deepEqual(out, { clientId: CLIENT, created: true });
  assert.equal(inserts.length, 1);
  assert.ok(inserts[0].includes("+15555550100"), "clients.phone is written on the new row");
});

test("buy box v2: step 1 sends no phone (it moved to step 3) — the order still opens and no phone is written", async () => {
  /* The exact body the /roadmap widget's step 1 sends now (owner-set 2026-10-02). */
  const parsed = parseSloCheckoutBody({
    email: "buyer@example.com", first_name: "Pat", last_name: "Lee",
    return_url: "https://apply.fundhub.ai/roadmap#fhw", business_count: 1
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.phone, null);
  const buyers = [];
  const sql = [];
  const out = await runSloCheckout(parsed, sloDeps({
    env: { SLO_DEMO_PAY: "1" },
    db: { async query(q) { sql.push(q); return { rows: [] }; } },
    resolveBuyer: async (_db, args) => { buyers.push(args); return { clientId: CLIENT, created: true }; }
  }));
  assert.equal(out.ok, true);
  assert.equal(buyers[0].phone, null, "the new client is created with no phone; step 3 fills it in");
  assert.equal(sql.filter((q) => /SET phone/.test(q)).length, 0, "no phone write at checkout");
});

test("item 10: GET carries mapsBrowserKey from GOOGLE_MAPS_BROWSER_KEY, null when unset, never the server key", () => {
  assert.equal(sloPageConfig({ ...LIVE_ENV, GOOGLE_MAPS_BROWSER_KEY: "browser-key-1" }).mapsBrowserKey, "browser-key-1");
  assert.equal(sloPageConfig(LIVE_ENV).mapsBrowserKey, null);
  assert.equal(sloPageConfig({ ...LIVE_ENV, GOOGLE_MAPS_BROWSER_KEY: "   " }).mapsBrowserKey, null);
  assert.equal(sloPageConfig({ ...LIVE_ENV, GOOGLE_MAPS_API_KEY: "server-secret" }).mapsBrowserKey, null);
});

/* ── The card is typed on /roadmap (owner-set 2026-09-29) ─────────────────── */

test("a real Commas link turns into an embedded session the page can draw a card form from", async () => {
  const embeddedAsks = [];
  const deps = sloDeps({
    ref: "slo_embed_ref",
    createCheckoutSession: async () => ({
      ok: true,
      /* the shape Commas really answers: the handle and the session id are both in the link */
      paymentLink: "https://www.fanbasis.com/agency-checkout/fundhub-1/ol7zk",
      productId: "ol7zk"
    }),
    createEmbeddedCheckoutSession: async (opts) => {
      embeddedAsks.push(opts);
      return {
        ok: true,
        creatorId: opts.creatorId,
        productId: opts.productId,
        sessionSecret: "550e8400-e29b-41d4-a716-446655440000",
        environment: "production"
      };
    }
  });
  const out = await runSloCheckout({ email: "buyer@example.com", name: "Pat Lee" }, deps);

  assert.equal(out.ok, true);
  assert.deepEqual(out.embedded, {
    creatorId: "fundhub-1",
    productId: "ol7zk",
    sessionSecret: "550e8400-e29b-41d4-a716-446655440000",
    environment: "production"
  });
  /* The embedded form charges the session we just minted under the keep title,
     so the amount follows the order. Nothing creates a catalog product. */
  assert.equal(embeddedAsks.length, 1);
  assert.equal(embeddedAsks[0].creatorId, "fundhub-1");
  assert.equal(embeddedAsks[0].productId, "ol7zk");
  assert.equal(embeddedAsks[0].metadata.link_ref, "slo_embed_ref");
  /* The hosted link is still recorded — the payment webhook is matched to it. */
  assert.equal(deps.links[0].checkoutUrl, "https://www.fanbasis.com/agency-checkout/fundhub-1/ol7zk");
});

test("an embedded mint that fails leaves the order good and the card box absent — never a redirect", async () => {
  const deps = sloDeps({
    ref: "slo_embed_fail",
    createCheckoutSession: async () => ({
      ok: true,
      paymentLink: "https://www.fanbasis.com/agency-checkout/fundhub-1/ol7zk",
      productId: "ol7zk"
    }),
    createEmbeddedCheckoutSession: async () => ({ ok: false, reason: "embedded_http_500" })
  });
  const out = await runSloCheckout({ email: "buyer@example.com" }, deps);
  assert.equal(out.ok, true, "the order is recorded either way");
  assert.equal(out.embedded, null, "no secret means the widget shows no card box and says so");
  assert.equal(deps.links.length, 1);
});

test("demo takes no card at all, so it mints no embedded session", async () => {
  let asked = 0;
  const out = await runSloCheckout({ email: "buyer@example.com" }, sloDeps({
    demo: true,
    ref: "slo_demo_embed",
    createCheckoutSession: async () => { throw new Error("demo must not call Commas"); },
    createEmbeddedCheckoutSession: async () => { asked += 1; return { ok: true }; }
  }));
  assert.equal(out.demo, true);
  assert.equal(out.embedded, undefined);
  assert.equal(asked, 0);
});

/* ── Meta match keys (Phase 4, docs/tracking/meta-events.md) ─────────────── */

const META_FBC = "fb.1.1727800000000.IwAR2abcDEF_123-xyz";
const META_FBP = "fb.1.1727800000000.1234567890";
const PHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148 Instagram";

test("Meta: fbc / fbp from the POST, the IP and the user agent are kept on the order's checkout row", async () => {
  const events = [];
  const stored = [];
  const res = fakeRes();
  await handler(
    {
      method: "POST",
      headers: {
        origin: "https://apply.fundhub.ai",
        "user-agent": PHONE_UA,
        "x-nf-client-connection-ip": "203.0.113.9",
        "x-forwarded-for": "198.51.100.1, 10.0.0.1"
      },
      body: { email: "pat.buyer@gmail.com", fbc: META_FBC, fbp: META_FBP }
    },
    res,
    sloDeps({
      ref: "slo_meta_1",
      emit(_db, name, payload) { events.push({ name, payload }); return { id: "evt-1" }; },
      storeClickIds: async (_db, row) => { stored.push(row); return true; },
      createCheckoutSession: async () => ({ ok: true, paymentLink: "https://pay.example.test/slo" })
    })
  );
  assert.equal(res.statusCode, 200);
  assert.deepEqual(events[0].payload.meta_match, {
    fbc: META_FBC,
    fbp: META_FBP,
    client_ip_address: "203.0.113.9",
    client_user_agent: PHONE_UA
  });
  // The client gets fbc / fbp (blanks only, inside storeClientMetaClickIds), never the IP or user agent.
  assert.equal(stored.length, 1);
  assert.deepEqual(stored[0], {
    orgId: "org-1", clientId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", fbc: META_FBC, fbp: META_FBP
  });
});

test("Meta: no x-nf-client-connection-ip → the first x-forwarded-for hop", async () => {
  const events = [];
  const res = fakeRes();
  await handler(
    { method: "POST", headers: { "x-forwarded-for": "198.51.100.1, 10.0.0.1" }, body: { email: "pat.buyer@gmail.com" } },
    res,
    sloDeps({
      emit(_db, name, payload) { events.push({ name, payload }); return { id: "evt-1" }; },
      createCheckoutSession: async () => ({ ok: true, paymentLink: "https://pay.example.test/slo" })
    })
  );
  assert.equal(events[0].payload.meta_match.client_ip_address, "198.51.100.1");
});

test("Meta: no fbc sent but an fbclid → fbc is built; junk fbc / fbp are dropped", () => {
  const built = parseSloCheckoutBody({ email: "pat.buyer@gmail.com", fbclid: "IwAR9zz" });
  assert.match(built.metaClickIds.fbc, /^fb\.1\.\d{13}\.IwAR9zz$/);
  const junk = parseSloCheckoutBody({ email: "pat.buyer@gmail.com", fbc: "<b>x</b>", fbp: "pat@x.com" });
  assert.deepEqual(junk.metaClickIds, { fbc: null, fbp: null });
});

test("Meta: nothing sent → no meta_match and no client write", async () => {
  const events = [];
  let stores = 0;
  await runSloCheckout(parseSloCheckoutBody({ email: "pat.buyer@gmail.com" }), sloDeps({
    emit(_db, name, payload) { events.push({ name, payload }); return { id: "evt-1" }; },
    storeClickIds: async () => { stores += 1; },
    createCheckoutSession: async () => ({ ok: true, paymentLink: "https://pay.example.test/slo" })
  }));
  assert.equal("meta_match" in events[0].payload, false);
  assert.equal(stores, 0);
});

test("Meta: a failed click-id write never stops the checkout", async () => {
  const out = await runSloCheckout(parseSloCheckoutBody({ email: "pat.buyer@gmail.com", fbc: META_FBC }), sloDeps({
    storeClickIds: async () => { throw new Error("db down"); },
    createCheckoutSession: async () => ({ ok: true, paymentLink: "https://pay.example.test/slo" })
  }));
  assert.equal(out.ok, true);
});

test("Meta: the stored match never holds a raw email or phone", () => {
  const parsed = parseSloCheckoutBody({ email: "pat.buyer@gmail.com", phone: "480-555-0100", fbc: META_FBC });
  const m = sloMetaMatch(parsed, { clientIp: "203.0.113.9", userAgent: PHONE_UA });
  const blob = JSON.stringify(m);
  assert.equal(blob.includes("pat.buyer"), false);
  assert.equal(blob.includes("5550100"), false);
  assert.equal(sloMetaMatch(parsed, { clientIp: "not an ip" }).client_ip_address, undefined);
});
