// Slice S3 proofs: staff reads and saves on one client file. Each test runs the
// real api/ handler against a stand-in database and judges the exact result:
// what comes back, and which company and client every statement is bound to.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import notesHandler from "../../api/client-notes.mjs";
import insightsHandler from "../../api/customer-insights.mjs";
import readInsightsHandler from "../../api/read/customer-insights.mjs";
import bookingsHandler from "../../api/bookings.mjs";
import entitlementsHandler from "../../api/read/entitlements.mjs";
import bankInboxHandler from "../../api/read/bank-inbox.mjs";
import conversationsHandler from "../../api/read/conversations.mjs";
import attributionHandler from "../../api/read/ad-attribution.mjs";
import inboxHandler from "../../api/read/inbox.mjs";
import { callShared } from "../testing/s3-handler-call.mjs";
import { tableRules, clientsRule, assertSqlHas } from "../testing/s3-scoped-rows.mjs";
import { req, staffSession, accountSession, ORG_ID, OTHER_ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "c2000000-0000-4000-8000-000000000002";
const FAR_CLIENT = "c3000000-0000-4000-8000-000000000003";
const inOrg = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, [{ "?column?": 1 }]];
const notInOrg = [/SELECT 1 FROM clients WHERE id = \$1 AND org_id = \$2/, []];

describe("POST /api/client-notes", () => {
  const saved = [/UPDATE clients\s+SET custom_fields/, (sql, p) => [{ id: p[0], staff_notes: p[2], updated_at: "2026-10-13T12:00:00.000Z" }]];

  test("saves the notes on this client in this company and answers with what was saved", async () => {
    const { res, fake } = await callShared(notesHandler, req("POST", { body: { client_id: CLIENT, notes: "Called twice. Wants $40k." } }), [staffSession(), inOrg, saved]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, client: { id: CLIENT, staff_notes: "Called twice. Wants $40k.", updated_at: "2026-10-13T12:00:00.000Z" } });
    const [write] = fake.find(/UPDATE clients\s+SET custom_fields/);
    assert.deepEqual(write.params, [CLIENT, ORG_ID, "Called twice. Wants $40k."]);
    assert.match(write.sql, /WHERE id = \$1::uuid\s+AND org_id = \$2::uuid/);
  });

  test("20,001 characters is refused and nothing is written; 20,000 is accepted", async () => {
    const tooLong = await callShared(notesHandler, req("POST", { body: { client_id: CLIENT, notes: "x".repeat(20001) } }), [staffSession(), inOrg, saved]);
    assert.equal(tooLong.res.statusCode, 400);
    assert.equal(tooLong.res.body.error, "notes_too_long");
    assert.equal(tooLong.fake.find(/UPDATE clients/).length, 0);
    const edge = await callShared(notesHandler, req("POST", { body: { client_id: CLIENT, notes: "x".repeat(20000) } }), [staffSession(), inOrg, saved]);
    assert.equal(edge.res.statusCode, 200);
  });

  test("a client from another company is a 404 and no note is written", async () => {
    const { res, fake } = await callShared(notesHandler, req("POST", { body: { client_id: CLIENT, notes: "hi" } }), [staffSession(), notInOrg, saved]);
    assert.equal(res.statusCode, 404);
    assert.equal(fake.find(/UPDATE clients/).length, 0);
  });

  test("a partner login cannot save staff notes", async () => {
    const { res, fake } = await callShared(notesHandler, req("POST", { body: { client_id: CLIENT, notes: "hi" } }), [staffSession({ role: "affiliate" }), inOrg, saved]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/UPDATE clients/).length, 0);
  });
});

describe("customer interviews: POST /api/customer-insights and GET /api/read/customer-insights", () => {
  const insertRow = (sql, p) => [{
    id: "ins1", org_id: p[0], client_id: p[1], product_id: p[2], task_id: p[3], stage: p[4], channel: p[5],
    answers: JSON.parse(p[6]), notes: p[7], meeting_url: p[8], recording_url: p[9], recorded_by: p[10],
    occurred_at: "2026-10-12T00:00:00.000Z", created_at: "2026-10-13T00:00:00.000Z"
  }];
  const rules = (extra = []) => [staffSession({ role: "funding_advisor" }), [/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, [{ id: CLIENT }]], [/INSERT INTO customer_insights/, insertRow], ...extra];

  test("a post-funding interview is saved for this company, recorded by the staff member who typed it", async () => {
    const body = { client_id: CLIENT, stage: "post", channel: "google_meet", answers: { felt_funded: "  relieved  ", blank: "" }, notes: "Great call" };
    const { res, fake } = await callShared(insightsHandler, req("POST", { body }), rules());
    assert.equal(res.statusCode, 201);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.insight.stage, "post");
    assert.deepEqual(res.body.insight.answers, { felt_funded: "relieved" });
    assert.equal(res.body.insight.recorded_by, STAFF_ID);
    const [ins] = fake.find(/INSERT INTO customer_insights/);
    assert.equal(ins.params[0], ORG_ID);
    assert.equal(ins.params[1], CLIENT);
    assert.equal(ins.params[10], STAFF_ID);
  });

  test("a mid check-in is accepted, an unknown stage is a 400 and nothing is saved", async () => {
    const mid = await callShared(insightsHandler, req("POST", { body: { client_id: CLIENT, stage: "mid", channel: "call" } }), rules());
    assert.equal(mid.res.statusCode, 201);
    assert.equal(mid.res.body.insight.stage, "mid");
    const bad = await callShared(insightsHandler, req("POST", { body: { client_id: CLIENT, stage: "before", channel: "call" } }), rules());
    assert.equal(bad.res.statusCode, 400);
    assert.equal(bad.fake.find(/INSERT INTO customer_insights/).length, 0);
  });

  test("an interview on a client, a product or a task from another company is a 404 and saves nothing", async () => {
    const PRODUCT = "b1000000-0000-4000-8000-0000000000b1";
    const TASK = "a1000000-0000-4000-8000-0000000000a1";
    const own = { clients: [/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, [{ id: CLIENT }]] };
    const cases = [
      ["client", { client_id: CLIENT }, [[/SELECT id FROM clients WHERE id = \$1 AND org_id = \$2/, []]]],
      ["product", { client_id: CLIENT, product_id: PRODUCT }, [own.clients, [/SELECT id FROM products WHERE id = \$1 AND org_id = \$2/, []]]],
      ["task", { client_id: CLIENT, task_id: TASK }, [own.clients, [/SELECT id FROM tasks WHERE id = \$1 AND org_id = \$2/, []]]]
    ];
    for (const [what, ids, rows] of cases) {
      const { res, fake } = await callShared(insightsHandler, req("POST", { body: { stage: "post", channel: "call", ...ids } }), [
        staffSession({ role: "funding_advisor" }), ...rows, [/INSERT INTO customer_insights/, insertRow]
      ]);
      assert.equal(res.statusCode, 404, what);
      assert.equal(fake.find(/INSERT INTO customer_insights/).length, 0, what);
    }
    const found = await callShared(insightsHandler, req("POST", { body: { stage: "post", channel: "call", client_id: CLIENT, product_id: PRODUCT, task_id: TASK } }), [
      staffSession({ role: "funding_advisor" }), own.clients,
      [/SELECT id FROM products WHERE id = \$1 AND org_id = \$2/, [{ id: PRODUCT }]],
      [/SELECT id FROM tasks WHERE id = \$1 AND org_id = \$2/, [{ id: TASK }]],
      [/INSERT INTO customer_insights/, insertRow]
    ]);
    assert.equal(found.res.statusCode, 201, "the control: all three in this company is saved");
    assert.deepEqual(found.fake.find(/INSERT INTO customer_insights/)[0].params.slice(0, 4), [ORG_ID, CLIENT, PRODUCT, TASK]);
  });

  test("GET lists the saved interviews of this company for the client and stage, with the question banks", async () => {
    const { res, fake } = await callShared(readInsightsHandler, req("GET", { query: { client_id: CLIENT, stage: "POST" } }), [
      staffSession({ role: "funding_advisor" }),
      [/FROM customer_insights/, [{ id: "ins1", org_id: ORG_ID, client_id: CLIENT, stage: "post", channel: "call", answers: { felt_funded: "relieved" }, recorded_by: STAFF_ID, occurred_at: "2026-10-12T00:00:00.000Z", created_at: "2026-10-13T00:00:00.000Z" }]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].answers.felt_funded, "relieved");
    assert.ok(res.body.questions.mid.length > 0 && res.body.questions.post.length > 0);
    const [q] = fake.find(/FROM customer_insights/);
    assert.deepEqual(q.params.slice(0, 3), [ORG_ID, CLIENT, "post"]);
    assertSqlHas(q.sql, { "this company, this client, this stage": "org_id = $1 AND client_id = $2 AND stage = $3", "newest interview first": "ORDER BY occurred_at DESC" });
  });
});

describe("GET /api/bookings", () => {
  const row = { id: "b1", org_id: ORG_ID, client_id: CLIENT, status: "booked", starts_at: "2026-10-14T16:00:00.000Z", display_name: "Dana Whitfield" };
  // Four bookings: this client's booked and cancelled calls, another client of the company, another company's.
  const held = () => [
    row,
    { ...row, id: "b2", status: "cancelled" },
    { ...row, id: "b3", client_id: OTHER_CLIENT, display_name: "Omar Reyes" },
    { ...row, id: "b4", org_id: OTHER_ORG_ID, client_id: FAR_CLIENT }
  ];
  const asks = [
    ["client and status", { client_id: CLIENT, status: "booked" }, ["b1"]],
    ["client only", { client_id: CLIENT }, ["b1", "b2"]],
    ["status only", { status: "booked" }, ["b1", "b3"]],
    ["neither", {}, ["b1", "b2", "b3"]]
  ];

  for (const [name, query, expected] of asks) {
    test(`${name}: answers exactly this company's rows that match (${expected.join(", ")}), never another company's`, async () => {
      const ask = { from: "2026-10-14", to: "2026-10-20", ...query };
      const { res, fake } = await callShared(bookingsHandler, req("GET", { query: ask }), [staffSession(), ...tableRules("bookings", held())]);
      assert.equal(res.statusCode, 200);
      assert.deepEqual(res.body.bookings.map((b) => b.id), expected);
      const [q] = fake.find(/FROM bookings b/);
      assert.deepEqual(q.params.slice(0, 3), [ORG_ID, "2026-10-14T00:00:00.000Z", "2026-10-20T00:00:00.000Z"]);
      assertSqlHas(q.sql, { company: "b.org_id = $1", dates: "b.starts_at >= $2 AND b.starts_at <= $3" });
    });
  }

  test("a POST is refused and nothing is read", async () => {
    const { res, fake } = await callShared(bookingsHandler, req("POST"), [staffSession(), ...tableRules("bookings", held())]);
    assert.equal(res.statusCode, 405);
    assert.equal(fake.find(/FROM bookings/).length, 0);
  });
});

describe("GET /api/read/entitlements", () => {
  const held = (client_id, org_id, entitlement_code = "finance-os") => ({
    client_id, org_id, entitlement_code, entitlement_name: "Finance OS", kind: "subscription", sort_order: 1,
    granted_at: "2026-10-01T00:00:00.000Z", expires_at: null, revoked_at: null, active: true, source_transaction_id: null
  });
  // Two clients of this company and one client of another company, in the view the handler reads.
  const view = () => [held(CLIENT, ORG_ID), held(OTHER_CLIENT, ORG_ID, "credit-os"), held(FAR_CLIENT, OTHER_ORG_ID)];
  const read = (session, query = {}) => callShared(entitlementsHandler, req("GET", { query }), [...session, ...tableRules("v_client_entitlements", view())]);
  const who = ({ res }) => res.body.items.map((i) => [i.client_id, i.entitlement_code]);

  test("a client sees only their own file: ?client_id= is ignored and no company filter is needed", async () => {
    const out = await read(accountSession({ kind: "client", clientId: CLIENT }), { client_id: OTHER_CLIENT });
    assert.equal(out.res.statusCode, 200);
    assert.deepEqual(who(out), [[CLIENT, "finance-os"]]);
    const [q] = out.fake.find(/FROM v_client_entitlements/);
    assert.deepEqual(q.params.slice(2), [CLIENT, true, null]);
  });

  test("staff read their own company and no other: one client when named, every client of the company when not", async () => {
    const named = await read([staffSession()], { client_id: CLIENT });
    assert.deepEqual(who(named), [[CLIENT, "finance-os"]]);
    assert.deepEqual(named.fake.find(/FROM v_client_entitlements/)[0].params, [51, 0, CLIENT, false, ORG_ID]);
    const whole = await read([staffSession()]);
    assert.deepEqual(who(whole), [[CLIENT, "finance-os"], [OTHER_CLIENT, "credit-os"]], "the other company's client is never in the answer");
    const far = await read([staffSession()], { client_id: FAR_CLIENT });
    assert.deepEqual(who(far), [], "a client id from another company reads nothing");
  });

  test("a staff session with no company binds NULL and reads nothing, with or without a client named", async () => {
    for (const query of [{ client_id: CLIENT }, {}]) {
      const none = await read([staffSession({ org_id: null })], query);
      assert.equal(none.res.statusCode, 200);
      assert.deepEqual(who(none), []);
      assert.equal(none.fake.find(/FROM v_client_entitlements/)[0].params[4], null);
    }
  });
});

describe("GET /api/read/bank-inbox", () => {
  const mail = (id, client_id, org_id, over = {}) => ({
    id, client_id, org_id, classification: "APPROVED", subject: "Your approval", body_preview: "We approved $12,500.00",
    amount_candidates: ["12500.00"], amount_candidates_found: 1, received_at: "2026-10-12T10:00:00.000Z", ...over
  });
  // This client's two emails, another client of the company, and another company's email.
  const inbox = () => [
    mail("m1", CLIENT, ORG_ID),
    mail("m2", CLIENT, ORG_ID, { classification: "DECLINED", amount_candidates: null, amount_candidates_found: null }),
    mail("m3", OTHER_CLIENT, ORG_ID),
    mail("m4", CLIENT, OTHER_ORG_ID)
  ];

  test("lists this client's bank emails with the dollar figures the bank stated, as suggestions only", async () => {
    const { res, fake } = await callShared(bankInboxHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession(), inOrg, ...tableRules("bank_inbox", inbox())]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items.map((i) => i.id), ["m1", "m2"], "this client's emails only, from this company only");
    assert.deepEqual(res.body.items[0].amount_candidates, ["12500.00"]);
    const [q] = fake.find(/FROM bank_inbox/);
    assert.deepEqual(q.params, [ORG_ID, CLIENT, 51, 0]);
    assertSqlHas(q.sql, {
      company_and_client: "WHERE org_id = $1::uuid AND client_id = $2::uuid",
      "the figures the bank stated": "raw->'amountCandidates' AS amount_candidates",
      "how many figures it stated": "raw->'amountCandidatesFound' AS amount_candidates_found",
      "the received time": "created_at AS received_at",
      "newest first, one page": "ORDER BY created_at DESC LIMIT $3 OFFSET $4"
    });
    assert.doesNotMatch(q.sql, /\braw\s*,|SELECT\s+raw\b|\*\s+FROM/);
    assert.equal(fake.find(/INSERT INTO bank_inbox|UPDATE bank_inbox|UPDATE applications/).length, 0);
  });

  test("a client from another company reads nothing", async () => {
    const { res, fake } = await callShared(bankInboxHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession(), notInOrg, ...tableRules("bank_inbox", inbox())]);
    assert.equal(res.statusCode, 404);
    assert.equal(fake.find(/FROM bank_inbox/).length, 0);
  });
});

describe("GET /api/read/conversations", () => {
  test("one row per thread for this client, bound to the session's company, newest pulse first", async () => {
    const thread = { id: "t1", channel: "sms", summary: "Asked about rates", sentiment: "positive", last_pulse_at: "2026-10-12T10:00:00.000Z", created_at: "2026-10-01T00:00:00.000Z" };
    const { res, fake } = await callShared(conversationsHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession(), [/FROM conversations/, [thread]]]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items, [thread]);
    const [q] = fake.find(/FROM conversations/);
    assert.deepEqual(q.params, [51, 0, CLIENT, ORG_ID]);
    assertSqlHas(q.sql, {
      "this company, this client": "WHERE org_id = $4::uuid AND client_id = $3",
      "newest pulse first, silent threads last": "ORDER BY last_pulse_at DESC NULLS LAST, created_at DESC"
    });
  });

  test("no client_id is a 400 and no thread is read", async () => {
    const { res, fake } = await callShared(conversationsHandler, req("GET", { query: {} }), [staffSession()]);
    assert.equal(res.statusCode, 400);
    assert.equal(fake.find(/FROM conversations/).length, 0);
  });
});

describe("GET /api/read/ad-attribution", () => {
  const first = (client_id, org_id, ad_id, variant) => ({ client_id, org_id, utm_source: "meta", utm_campaign: "slo", utm_content: ad_id, lane: "slo", ad_id, variant });
  // This client's first touch, another client of the company, and another company's client.
  const touches = () => [first(CLIENT, ORG_ID, "43", "b"), first(OTHER_CLIENT, ORG_ID, "7", "a"), first(FAR_CLIENT, OTHER_ORG_ID, "9", "c")];
  const clients = [{ id: CLIENT, org_id: ORG_ID }, { id: OTHER_CLIENT, org_id: ORG_ID }, { id: FAR_CLIENT, org_id: OTHER_ORG_ID }];
  const read = (client_id, rows = touches()) => callShared(attributionHandler, req("GET", { query: { client_id } }), [staffSession(), clientsRule(clients), ...tableRules("client_ad_attribution", rows)]);

  test("names the ad that brought the client and what it promised, from this client's saved first touch only", async () => {
    const { res, fake } = await read(CLIENT);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.attribution, touches()[0]);
    assert.equal(res.body.resolved.variant, "b");
    assert.equal(typeof res.body.resolved.guidance, "string");
    assert.ok(res.body.registry);
    const [q] = fake.find(/FROM client_ad_attribution/);
    assert.deepEqual(q.params, [ORG_ID, CLIENT]);
    assertSqlHas(q.sql, { "this company, this client": "WHERE org_id = $1 AND client_id = $2", "the lane, ad and variant": "lane::text AS lane, ad_id, variant" });
  });

  test("a client with no tracked ad still answers, with a null attribution, and is never given another client's", async () => {
    const { res } = await read(CLIENT, touches().slice(1));
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.attribution, null);
    assert.equal(res.body.resolved.variant, null);
  });

  test("a client from another company is a 404 and no attribution is read", async () => {
    const { res, fake } = await read(FAR_CLIENT);
    assert.equal(res.statusCode, 404);
    assert.equal(fake.find(/FROM client_ad_attribution/).length, 0);
  });
});

describe("GET /api/read/inbox", () => {
  const thread = (id, over = {}) => ({
    id, client_id: CLIENT, channel: "sms", summary: "Asked about the card", sentiment: null, first_name: "Dana", last_name: "Whitfield",
    last_message_id: `m-${id}`, last_direction: "inbound", last_body: "Can you call me?", last_status: "received",
    last_at: "2026-10-13T09:00:00.000Z", needs_reply: true, activity_at: "2026-10-13T09:00:00.000Z", ...over
  });
  // The words of the row, as the statement must spell them. A canned answer cannot show a flipped
  // sort or a flipped "they spoke last", so each clause is pinned in the text the database runs.
  const CLAUSES = {
    "the page: this company only": "WHERE c.org_id = $3::uuid",
    "the page: newest thread activity first": "ORDER BY COALESCE(c.last_pulse_at, c.created_at) DESC, c.id DESC LIMIT $1 OFFSET $2",
    "the rows: newest activity first": "ORDER BY COALESCE(last.created_at, page.last_pulse_at, page.created_at) DESC, page.id DESC",
    "the last message is the newest one": "WHERE m.conversation_id = page.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1",
    "the client is joined inside this company": "JOIN clients cl ON cl.id = page.client_id AND cl.org_id = $3::uuid",
    "a reply is owed when they spoke last": "(last.direction = 'inbound') AS needs_reply",
    "needs reply keeps only threads whose newest message is inbound":
      "AND ($4::boolean IS NOT TRUE OR (SELECT m.direction FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) = 'inbound')"
  };

  test("every conversation in this company, newest activity first, with the last message and whether a reply is owed", async () => {
    const rows = [thread("t1"), thread("t2", { last_direction: "outbound", needs_reply: false, last_body: "Sent you the plan" })];
    const { res, fake } = await callShared(inboxHandler, req("GET"), [staffSession({ role: "setter" }), [/WITH page AS/, rows]]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items.map((i) => [i.id, i.needs_reply, i.last_body]), [["t1", true, "Can you call me?"], ["t2", false, "Sent you the plan"]]);
    assert.equal(res.body.hasMore, false);
    const [q] = fake.find(/WITH page AS/);
    assert.deepEqual(q.params, [51, 0, ORG_ID, false]);
    assertSqlHas(q.sql, CLAUSES);
  });

  test("?needs_reply asks the database for only the threads the client spoke last in; anything but 1 or true asks for all", async () => {
    const asks = [[{ needs_reply: "1" }, true], [{ needs_reply: "true" }, true], [{ needs_reply: "0" }, false], [{ needs_reply: "yes" }, false], [{}, false]];
    for (const [query, expected] of asks) {
      const { fake } = await callShared(inboxHandler, req("GET", { query }), [staffSession(), [/WITH page AS/, []]]);
      assert.equal(fake.find(/WITH page AS/)[0].params[3], expected, JSON.stringify(query));
    }
  });

  test("one extra row sets hasMore and is not shown", async () => {
    const rows = [thread("t1"), thread("t2"), thread("t3")];
    const { res, fake } = await callShared(inboxHandler, req("GET", { query: { needs_reply: "1", limit: "2" } }), [staffSession(), [/WITH page AS/, rows]]);
    assert.deepEqual(res.body.items.map((i) => i.id), ["t1", "t2"]);
    assert.equal(res.body.hasMore, true);
    assert.deepEqual(fake.find(/WITH page AS/)[0].params, [3, 0, ORG_ID, true]);
  });

  test("a login that is not staff reads nothing", async () => {
    const { res, fake } = await callShared(inboxHandler, req("GET"), [staffSession({ role: "affiliate" }), [/WITH page AS/, [thread("t1")]]]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/WITH page AS/).length, 0);
  });
});
