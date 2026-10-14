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
import { req, staffSession, accountSession, ORG_ID, STAFF_ID } from "../testing/handler-harness.mjs";

const CLIENT = "c1000000-0000-4000-8000-000000000001";
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

  test("an interview on a client from another company is a 404 and saves nothing", async () => {
    const { res, fake } = await callShared(insightsHandler, req("POST", { body: { client_id: CLIENT, stage: "post", channel: "call" } }), [
      staffSession({ role: "funding_advisor" }), [/SELECT id FROM clients/, []]
    ]);
    assert.equal(res.statusCode, 404);
    assert.equal(fake.find(/INSERT INTO customer_insights/).length, 0);
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
    assert.match(q.sql, /org_id = \$1 AND client_id = \$2 AND stage = \$3/);
  });
});

describe("GET /api/bookings", () => {
  const row = { id: "b1", org_id: ORG_ID, client_id: CLIENT, status: "booked", starts_at: "2026-10-14T16:00:00.000Z", display_name: "Dana Whitfield" };

  test("returns this company's booked calls inside the dates, for the client and status asked", async () => {
    const { res, fake } = await callShared(bookingsHandler, req("GET", { query: { from: "2026-10-14", to: "2026-10-20", client_id: CLIENT, status: "booked" } }), [
      staffSession(), [/FROM bookings b/, [row]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, bookings: [row] });
    const [q] = fake.find(/FROM bookings b/);
    assert.equal(q.params[0], ORG_ID);
    assert.ok(q.params.includes(CLIENT));
    assert.ok(q.params.includes("booked"));
    assert.match(q.sql, /b\.org_id = \$1/);
    assert.match(q.sql, /b\.starts_at >= \$2 AND b\.starts_at <= \$3/);
  });

  test("a POST is refused and nothing is read", async () => {
    const { res, fake } = await callShared(bookingsHandler, req("POST"), [staffSession(), [/FROM bookings b/, [row]]]);
    assert.equal(res.statusCode, 405);
    assert.equal(fake.find(/FROM bookings/).length, 0);
  });
});

describe("GET /api/read/entitlements", () => {
  const held = { client_id: CLIENT, entitlement_code: "finance-os", entitlement_name: "Finance OS", kind: "subscription", sort_order: 1, granted_at: "2026-10-01T00:00:00.000Z", expires_at: null, revoked_at: null, active: true, source_transaction_id: null };

  test("a client sees only their own file: ?client_id= is ignored and no company filter is needed", async () => {
    const other = "c2000000-0000-4000-8000-000000000002";
    const { res, fake } = await callShared(entitlementsHandler, req("GET", { query: { client_id: other } }), [
      ...accountSession({ kind: "client", clientId: CLIENT }), [/FROM v_client_entitlements/, [held]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items, [held]);
    const [q] = fake.find(/FROM v_client_entitlements/);
    assert.equal(q.params[2], CLIENT);
    assert.equal(q.params[3], true);
  });

  test("staff read the company they belong to; a staff session with no company binds NULL", async () => {
    const { res, fake } = await callShared(entitlementsHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession(), [/FROM v_client_entitlements/, [held]]]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(fake.find(/FROM v_client_entitlements/)[0].params, [51, 0, CLIENT, false, ORG_ID]);
    const none = await callShared(entitlementsHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession({ org_id: null }), [/FROM v_client_entitlements/, []]]);
    assert.equal(none.fake.find(/FROM v_client_entitlements/)[0].params[4], null);
  });
});

describe("GET /api/read/bank-inbox", () => {
  const mail = { id: "m1", client_id: CLIENT, classification: "APPROVED", subject: "Your approval", body_preview: "We approved $12,500.00", amount_candidates: ["12500.00"], amount_candidates_found: 1, received_at: "2026-10-12T10:00:00.000Z" };

  test("lists this client's bank emails with the dollar figures the bank stated, as suggestions only", async () => {
    const { res, fake } = await callShared(bankInboxHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession(), inOrg, [/FROM bank_inbox/, [mail]]]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items, [mail]);
    const [q] = fake.find(/FROM bank_inbox/);
    assert.deepEqual(q.params, [ORG_ID, CLIENT, 51, 0]);
    assert.match(q.sql, /WHERE org_id = \$1::uuid\s+AND client_id = \$2::uuid/);
    assert.doesNotMatch(q.sql, /\braw\s*,|SELECT\s+raw\b|\*\s+FROM/);
    assert.equal(fake.find(/INSERT INTO bank_inbox|UPDATE bank_inbox|UPDATE applications/).length, 0);
  });

  test("a client from another company reads nothing", async () => {
    const { res, fake } = await callShared(bankInboxHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession(), notInOrg, [/FROM bank_inbox/, [mail]]]);
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
    assert.match(q.sql, /WHERE org_id = \$4::uuid\s+AND client_id = \$3/);
    assert.match(q.sql, /ORDER BY last_pulse_at DESC NULLS LAST/);
  });

  test("no client_id is a 400 and no thread is read", async () => {
    const { res, fake } = await callShared(conversationsHandler, req("GET", { query: {} }), [staffSession()]);
    assert.equal(res.statusCode, 400);
    assert.equal(fake.find(/FROM conversations/).length, 0);
  });
});

describe("GET /api/read/ad-attribution", () => {
  test("names the ad that brought the client and what it promised, from the saved first touch", async () => {
    const row = { client_id: CLIENT, org_id: ORG_ID, utm_source: "meta", utm_campaign: "slo", utm_content: "43", lane: "slo", ad_id: "43", variant: "b" };
    const { res, fake } = await callShared(attributionHandler, req("GET", { query: { client_id: CLIENT } }), [
      staffSession(), inOrg, [/FROM client_ad_attribution/, [row]]
    ]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.attribution, row);
    assert.equal(res.body.resolved.variant, "b");
    assert.equal(typeof res.body.resolved.guidance, "string");
    assert.ok(res.body.registry);
    assert.deepEqual(fake.find(/FROM client_ad_attribution/)[0].params, [ORG_ID, CLIENT]);
  });

  test("a client with no tracked ad still answers, with a null attribution", async () => {
    const { res } = await callShared(attributionHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession(), inOrg]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.attribution, null);
    assert.equal(res.body.resolved.variant, null);
  });

  test("a client from another company is a 404", async () => {
    const { res } = await callShared(attributionHandler, req("GET", { query: { client_id: CLIENT } }), [staffSession(), notInOrg]);
    assert.equal(res.statusCode, 404);
  });
});

describe("GET /api/read/inbox", () => {
  const thread = (id, over = {}) => ({
    id, client_id: CLIENT, channel: "sms", summary: "Asked about the card", sentiment: null, first_name: "Dana", last_name: "Whitfield",
    last_message_id: `m-${id}`, last_direction: "inbound", last_body: "Can you call me?", last_status: "received",
    last_at: "2026-10-13T09:00:00.000Z", needs_reply: true, activity_at: "2026-10-13T09:00:00.000Z", ...over
  });

  test("every conversation in this company, newest activity first, with the last message and whether a reply is owed", async () => {
    const rows = [thread("t1"), thread("t2", { last_direction: "outbound", needs_reply: false, last_body: "Sent you the plan" })];
    const { res, fake } = await callShared(inboxHandler, req("GET"), [staffSession({ role: "setter" }), [/WITH page AS/, rows]]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items.map((i) => [i.id, i.needs_reply, i.last_body]), [["t1", true, "Can you call me?"], ["t2", false, "Sent you the plan"]]);
    assert.equal(res.body.hasMore, false);
    const [q] = fake.find(/WITH page AS/);
    assert.deepEqual(q.params, [51, 0, ORG_ID, false]);
    assert.match(q.sql, /WHERE c\.org_id = \$3::uuid/);
  });

  test("?needs_reply=1 asks the database for only the threads the client spoke last in, and one extra row sets hasMore", async () => {
    const rows = [thread("t1"), thread("t2"), thread("t3")];
    const { res, fake } = await callShared(inboxHandler, req("GET", { query: { needs_reply: "1", limit: "2" } }), [staffSession(), [/WITH page AS/, rows]]);
    assert.equal(res.body.items.length, 2);
    assert.equal(res.body.hasMore, true);
    assert.deepEqual(fake.find(/WITH page AS/)[0].params, [3, 0, ORG_ID, true]);
  });

  test("a login that is not staff reads nothing", async () => {
    const { res, fake } = await callShared(inboxHandler, req("GET"), [staffSession({ role: "affiliate" }), [/WITH page AS/, [thread("t1")]]]);
    assert.equal(res.statusCode, 403);
    assert.equal(fake.find(/WITH page AS/).length, 0);
  });
});
