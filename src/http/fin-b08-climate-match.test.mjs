// finish-853 batch 08: GET/POST /api/public/climate-match. The real handler runs the real matcher
// over the real lender read, and files a lead through the real homepage-survey path and the real
// event bus, over stand-in tables that answer by the company each statement names. The row's
// words: GET how many active lenders the book holds; POST runs the staff matcher over active
// non-demo lenders and returns a count, lane counts and 5 bank names (no odds, no amounts); with a
// name and email it files the lead (a client row and the entry.captured and survey.submitted
// events) and merges states and ad tags onto custom_fields. No auth. Practice test, fake data;
// the outbound fences are held up and the network is refused for the whole file.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/public/climate-match.mjs";
import { setCached } from "../climate/connectors.mjs";
import { fakeDb, makeRes, runWithSharedDb } from "../testing/handler-harness.mjs";
import { rowsWhere, bindProblem } from "../testing/s3-scoped-rows.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const KEYS = ["ADAPTERS_DRY_RUN", "MESSAGING_DRY_RUN", "INNGEST_EVENT_KEY"];
const saved = {};
const realFetch = globalThis.fetch;
const asked = [];
before(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  process.env.ADAPTERS_DRY_RUN = "1";
  process.env.MESSAGING_DRY_RUN = "1";
  delete process.env.INNGEST_EVENT_KEY;
  globalThis.fetch = async (url) => { asked.push(String(url)); throw new Error("network refused in this test"); };
});
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  globalThis.fetch = realFetch;
});
// The lender read keeps a daily cache in this process; each test starts with it expired.
beforeEach(async () => { asked.length = 0; await setCached("connector:crm:lenders", { lenders: [], ttl_expires_at: "2000-01-01T00:00:00.000Z" }); });

const lender = (id, name, over = {}) => ({
  id, org_id: ORG, lender_table: "PersonalCC", name, product_name: "Some Card", eligible_states: "All States", bureaus_pulled: "EX",
  priority_tier: 1, active: true, is_demo: false, logo_path: null, approval_odds: "90%", max_known_loc: "$250,000", ...over,
});

function climateDb({ lenders }) {
  const state = { clients: [], events: [], lenderReads: 0 };
  const fake = fakeDb([
    [/^\s*SELECT id FROM orgs WHERE is_default/i, [{ id: ORG }]],
    [/^\s*SELECT id FROM orgs WHERE slug = \$1/i, [{ id: ORG }]],
    [/FROM lenders\s+WHERE/i, (s, p) => {
      state.lenderReads += 1;
      let rows = rowsWhere(lenders, s, p);
      if (/COALESCE\(is_demo, false\) = false/.test(s)) rows = rows.filter((r) => !r.is_demo);
      return rows;
    }],
    [/^\s*SELECT id, ghl_contact_id FROM clients WHERE org_id = \$1 AND lower\(email\) = \$2/i, (_s, p) => state.clients.filter((c) => c.org_id === p[0] && c.email === p[1]).map((c) => ({ id: c.id, ghl_contact_id: c.ghl_contact_id || null }))],
    [/^\s*INSERT INTO clients/i, (_s, p) => {
      const c = { id: `c${state.clients.length + 1}0000000-0000-4000-8000-000000000000`, org_id: p[0], email: p[1], first_name: p[2], last_name: p[3], phone: p[4], channel_source: p[5], custom_fields: {} };
      state.clients.push(c);
      return [{ id: c.id }];
    }],
    [/^\s*SELECT id, ghl_contact_id, email, phone, first_name, last_name FROM clients WHERE id = \$1/i, (_s, p) => state.clients.filter((c) => c.id === p[0])],
    [/^\s*INSERT INTO events \(org_id, name, version, idempotency_key, client_id, payload\)/i, (_s, p) => {
      if (p[3] && state.events.some((e) => e.org_id === p[0] && e.idempotency_key === p[3])) return [];
      state.events.push({ id: `e${state.events.length + 1}`, org_id: p[0], name: p[1], idempotency_key: p[3], client_id: p[4], payload: p[5] });
      return [{ id: `e${state.events.length}` }];
    }],
    [/^\s*UPDATE clients SET custom_fields = COALESCE\(custom_fields, '\{\}'::jsonb\) \|\| \$2::jsonb WHERE id = \$1/i, (_s, p) => {
      const c = state.clients.find((x) => x.id === p[0]);
      if (c) Object.assign(c.custom_fields, JSON.parse(p[1]));
      return { rows: [], rowCount: c ? 1 : 0 };
    }],
    [/^\s*UPDATE clients SET custom_fields = custom_fields \|\| \$2::jsonb WHERE id = \$1/i, (_s, p) => {
      const c = state.clients.find((x) => x.id === p[0]);
      if (c) Object.assign(c.custom_fields, JSON.parse(p[1]));
      return { rows: [], rowCount: c ? 1 : 0 };
    }],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const args = typeof sql === "string" ? params : sql.values;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  fake.state = state;
  return fake;
}

async function call(method, body, fake) {
  const res = makeRes();
  await runWithSharedDb(fake, () => handler({ method, body, headers: {}, query: {} }, res));
  return res;
}
const BOOK = () => [
  lender("l1", "National Bank"),
  lender("l2", "Arizona Credit Union", { eligible_states: "AZ", priority_tier: 2 }),
  lender("l3", "Florida Credit Union", { eligible_states: "FL", priority_tier: 2 }),
  lender("l4", "Other Company Bank", { org_id: OTHER_ORG }),
  lender("l5", "Demo Sample Bank", { is_demo: true }),
  lender("l6", "Closed Bank", { active: false }),
];

describe("/api/public/climate-match", () => {
  test("GET counts the active, non-demo lenders of the company's book and nothing else", async () => {
    const res = await call("GET", undefined, climateDb({ lenders: BOOK() }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.book_size, 3);
    assert.equal(res.body.teaser_limit, 5);
    assert.ok(Array.isArray(res.body.score_bands) && res.body.score_bands.length > 0);
    assert.deepEqual(Object.keys(res.body).sort(), ["book_size", "ok", "score_bands", "stale", "teaser_limit"]);
  });

  test("POST runs the matcher: a count, the lane counts and the first bank names, with names, logos and lanes only — no odds, no amounts", async () => {
    const res = await call("POST", { home_state: "AZ", has_business: "no" }, climateDb({ lenders: BOOK() }));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.count, 2, "the national bank and the Arizona one; Florida is out of state");
    assert.deepEqual(res.body.lanes, { national: 1, home: { state: "AZ", count: 1 }, business: { state: null, count: 0 } });
    assert.deepEqual(res.body.teaser.map((t) => t.name), ["National Bank", "Arizona Credit Union"]);
    for (const t of res.body.teaser) assert.deepEqual(Object.keys(t).sort(), ["lane", "logo_path", "name"]);
    const shown = JSON.stringify(res.body);
    assert.doesNotMatch(shown, /approval_odds|90%|250,000|max_known_loc|product_name|Some Card|odds|qualif/i);
    assert.equal(res.body.score_used, false);
    assert.equal(res.body.lead_filed, false, "no name and email, no lead");
  });

  test("the teaser is capped at five names while the count is the whole match", async () => {
    const many = Array.from({ length: 8 }, (_, i) => lender(`m${i}`, `Bank ${String.fromCharCode(65 + i)}`, { priority_tier: 1 }));
    const res = await call("POST", { home_state: "AZ" }, climateDb({ lenders: many }));
    assert.equal(res.body.count, 8);
    assert.equal(res.body.teaser.length, 5);
  });

  test("no business on file holds the business cards back and says so", async () => {
    const book = [lender("b1", "Business Card Bank", { lender_table: "OnlineBizCC" }), lender("p1", "Personal Card Bank")];
    const none = await call("POST", { home_state: "AZ", has_business: "no" }, climateDb({ lenders: book }));
    assert.deepEqual(none.body.teaser.map((t) => t.name), ["Personal Card Bank"]);
    assert.match(none.body.held_for_no_business, /1 business card is held back because there is no business on file/);
    const yes = await call("POST", { home_state: "AZ", has_business: "yes" }, climateDb({ lenders: book }));
    assert.equal(yes.body.count, 2);
    assert.equal(yes.body.held_for_no_business, null);
  });

  test("with a name and email it files the lead: one client, the entry.captured and survey.submitted events on that client, and the states and ad tags on custom_fields", async () => {
    const fake = climateDb({ lenders: BOOK() });
    const res = await call("POST", {
      home_state: "AZ", business_state: "NV", has_business: "yes", score_band: "650-699", name: "Dana Whitfield", email: "  Dana@Example.test ",
      utm_source: "meta", utm_campaign: "climate-oct", sms_consent: true,
    }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.lead_filed, true);
    assert.equal(fake.state.clients.length, 1);
    const client = fake.state.clients[0];
    assert.equal(client.email, "dana@example.test");
    assert.equal(client.org_id, ORG);
    assert.equal(client.first_name, "Dana");
    assert.equal(client.last_name, "Whitfield");
    assert.equal(client.channel_source, "website:climate");
    assert.equal(client.custom_fields.home_state, "AZ");
    assert.equal(client.custom_fields.business_state, "NV");
    assert.equal(client.custom_fields.utm_source, "meta");
    assert.equal(client.custom_fields.utm_campaign, "climate-oct");
    assert.deepEqual(fake.state.events.map((e) => e.name), ["entry.captured", "survey.submitted"]);
    assert.ok(fake.state.events.every((e) => e.client_id === client.id && e.org_id === ORG));
  });

  test("a returning email is the same client, and a name with no valid email files nothing", async () => {
    const fake = climateDb({ lenders: BOOK() });
    await call("POST", { home_state: "AZ", name: "Dana Whitfield", email: "dana@example.test" }, fake);
    await call("POST", { home_state: "NV", name: "Dana Whitfield", email: "dana@example.test" }, fake);
    assert.equal(fake.state.clients.length, 1, "one person, one client row");
    assert.equal(fake.state.clients[0].custom_fields.home_state, "NV");
    const lone = climateDb({ lenders: BOOK() });
    const res = await call("POST", { home_state: "AZ", name: "Dana Whitfield", email: "not-an-email" }, lone);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.lead_filed, false);
    assert.equal(lone.state.clients.length, 0);
    assert.equal(lone.state.events.length, 0);
  });

  test("a missing or junk state is 400 and nothing is read or filed; an unknown method is 405", async () => {
    for (const body of [{}, { home_state: "Arizona" }, { home_state: "A" }]) {
      const fake = climateDb({ lenders: BOOK() });
      const res = await call("POST", body, fake);
      assert.equal(res.statusCode, 400, JSON.stringify(body));
      assert.equal(res.body.error, "home_state_required");
      assert.equal(fake.state.clients.length + fake.state.events.length, 0);
    }
    const res = await call("DELETE", undefined, climateDb({ lenders: BOOK() }));
    assert.equal(res.statusCode, 405);
  });

  test("it never reaches out: no web call, no text, no email, no pull, whatever the visitor types", async () => {
    const fake = climateDb({ lenders: BOOK() });
    await call("POST", { home_state: "AZ", name: "Dana Whitfield", email: "dana@example.test", sms_consent: true, phone: "6025550100" }, fake);
    assert.deepEqual(asked, []);
    for (const c of fake.calls) assert.doesNotMatch(c.sql, /INSERT INTO messages|crs_results|INSERT INTO outbound/i);
  });

  const payloadOf = (event) => (typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload);

  test("the lead's contact, consent, business and answers ride the two events exactly as given, and consent is no unless it was said", async () => {
    const fake = climateDb({ lenders: BOOK() });
    await call("POST", {
      home_state: "AZ", has_business: "yes", score_band: "650-699", name: "Dana Whitfield", email: "dana@example.test",
      phone: "(602) 555-0100", business_name: "Whitfield Supply LLC", sms_consent: true,
    }, fake);
    const [entry, survey] = fake.state.events;
    assert.deepEqual(entry.name, "entry.captured");
    const e = payloadOf(entry);
    assert.equal(e.email, "dana@example.test");
    assert.equal(e.name, "Dana Whitfield");
    assert.equal(e.phone, "+16025550100", "a phone number is saved in one shape");
    assert.equal(e.business, "Whitfield Supply LLC");
    assert.equal(e.source, "website:climate");
    assert.equal(e.sms_consent, true);
    const sv = payloadOf(survey);
    assert.deepEqual(sv.answers, { cf_svy_self_reported_fico: "650-699", cf_svy_has_business: "Yes" });
    assert.equal(sv.business, "Whitfield Supply LLC");
    assert.equal(sv.phone, "+16025550100");
    assert.equal(sv.source, "website:climate");

    // No consent said, no business answer, an unknown score band: the lead carries none of them.
    const quiet = climateDb({ lenders: BOOK() });
    await call("POST", { home_state: "AZ", score_band: "9000+", name: "Pat Counter", email: "pat@example.test", sms_consent: false }, quiet);
    const q = quiet.state.events.map(payloadOf);
    assert.equal(q[0].sms_consent, false, "consent is not assumed");
    assert.deepEqual(q[1].answers, {}, "an unknown band and an unanswered question are left out, not guessed");
    const no = climateDb({ lenders: BOOK() });
    await call("POST", { home_state: "AZ", has_business: "no", name: "Sam Lee", email: "sam@example.test" }, no);
    assert.deepEqual(payloadOf(no.state.events[1]).answers, { cf_svy_has_business: "No" });
  });

  test("every ad tag the visitor arrived with is kept on the client, and nothing the visitor typed outside the five is", async () => {
    const fake = climateDb({ lenders: BOOK() });
    await call("POST", {
      home_state: "AZ", name: "Dana Whitfield", email: "dana@example.test",
      utm_source: "meta", utm_medium: "paid_social", utm_campaign: "climate-oct", utm_content: "43-notes", utm_term: "lenders",
      fbclid: "abc", is_demo: true, custom_fields: { role: "admin" },
    }, fake);
    const cf = fake.state.clients[0].custom_fields;
    for (const [k, v] of Object.entries({ utm_source: "meta", utm_medium: "paid_social", utm_campaign: "climate-oct", utm_content: "43-notes", utm_term: "lenders", home_state: "AZ" })) {
      assert.equal(cf[k], v, k);
    }
    assert.equal(cf.fbclid, undefined);
    assert.equal(cf.is_demo, undefined);
    assert.equal(cf.role, undefined);
    assert.equal(cf.business_state, undefined, "no business state given, none saved");
  });

  test("a business in another state is its own lane, and a business in the home state is not counted twice", async () => {
    const book = [
      lender("l1", "National Bank"),
      lender("l2", "Arizona Credit Union", { eligible_states: "AZ", priority_tier: 2 }),
      lender("l3", "Nevada Business Bank", { eligible_states: "NV", lender_table: "InBranchBizCC", priority_tier: 2 }),
      lender("l4", "Nevada Credit Union", { eligible_states: "NV", priority_tier: 3 }),
    ];
    const biz = await call("POST", { home_state: "AZ", business_state: "NV", has_business: "yes" }, climateDb({ lenders: book }));
    assert.equal(biz.statusCode, 200);
    assert.deepEqual(biz.body.lanes.home, { state: "AZ", count: 1 }, "home is the home state, not the business state");
    assert.equal(biz.body.lanes.business.state, "NV");
    assert.equal(biz.body.lanes.business.count, 2);
    assert.equal(biz.body.lanes.national, 1);
    assert.equal(biz.body.count, 4);
    assert.equal(biz.body.basis, "state and business");
    const same = await call("POST", { home_state: "AZ", business_state: "AZ", has_business: "yes" }, climateDb({ lenders: book }));
    assert.equal(same.body.lanes.business.state, null, "the same state is not a second lane");
    assert.equal(same.body.count, 2);
    const homeOnly = await call("POST", { home_state: "NV", has_business: "yes" }, climateDb({ lenders: book }));
    assert.deepEqual(homeOnly.body.lanes.home, { state: "NV", count: 2 });
    const unknown = await call("POST", { home_state: "AZ" }, climateDb({ lenders: book }));
    assert.equal(unknown.body.basis, "state", "no business answer, no business basis");
  });
});
