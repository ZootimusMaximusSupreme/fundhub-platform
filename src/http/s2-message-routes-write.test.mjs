// The copy and wiring doors that decide what customers are told, run through the
// REAL handlers with a stand-in database and no network:
//
//   route:message-templates               save switches a message OFF until approved
//   route:journeys                        GET reads and PUT saves the automation step trees
//   route:marketing/funnels/push-live     two-tap confirm puts a built funnel live as new pages
//
// Each test judges the exact result the catalog row names.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import templates from "../../api/message-templates.mjs";
import journeys from "../../api/journeys.mjs";
import pushLive from "../../api/marketing/funnels/push-live.mjs";
import approvePartner from "../../api/partners/approve.mjs";
import { queueDb } from "../pulse/catalog/proofs/s2-queue-db.mjs";
import { recorded, reset } from "../messaging/providers/memory.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, ORG_ID, STAFF_ID,
} from "../testing/handler-harness.mjs";

const realFetch = globalThis.fetch;
before(() => { globalThis.fetch = async () => { throw new Error("network refused in this test"); }; });
after(() => { globalThis.fetch = realFetch; });

async function call(handler, request, rules, deps) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => (deps ? handler(request, res, deps) : handler(request, res)));
  return { res, fake };
}

describe("POST /api/message-templates", () => {
  const ID = "d1000000-0000-4000-8000-000000000001";
  const stored = (over = {}) => ({
    id: ID, template_key: "SMS-WELCOME", channel: "sms", subject: null,
    body: "Hi {{contact.first_name}}, welcome to Fundhub.", compliance_passed: true,
    approved_by: STAFF_ID, approved_at: "2026-10-01T00:00:00Z", approved_body_sha: "abc", ...over,
  });
  const load = (row) => [/FROM message_templates\s+WHERE id = \$1::uuid AND org_id = \$2::uuid/, row ? [row] : []];
  const update = [/UPDATE message_templates\s+SET subject/, (_s, p) => [{
    id: p[0], template_key: "SMS-WELCOME", channel: "sms", subject: p[2], body: p[3], compliance_passed: p[4], updated_at: "now",
  }]];
  const approveUpdate = [/UPDATE message_templates\s+SET compliance_passed = true/, (_s, p) => [{
    id: p[0], template_key: "SMS-WELCOME", channel: "sms", subject: null, body: p[4], compliance_passed: true,
    approved_by: p[2], approved_body_sha: p[3],
  }]];

  test("saving new words changes the copy and sends the OFF flag; the message is no longer approved", async () => {
    const { res, fake } = await call(templates, req("POST", {
      body: { action: "save", id: ID, body: "Hi {{contact.first_name}}, your file is ready." },
    }), [staffSession({ role: "closer" }), load(stored()), update]);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "save");
    assert.equal(res.body.approval_cleared, true);
    assert.match(res.body.message, /switched off until an owner or admin approves/);
    const [write] = fake.find(/UPDATE message_templates/);
    assert.match(write.sql, /CASE WHEN \$5::boolean THEN compliance_passed ELSE false END/);
    // [id, org, subject, body, unchanged]: the words changed, so unchanged is false.
    assert.deepEqual(write.params, [ID, ORG_ID, null, "Hi {{contact.first_name}}, your file is ready.", false]);
  });

  test("saving the same words keeps the approval; an unknown placeholder or empty copy is refused", async () => {
    const same = await call(templates, req("POST", {
      body: { action: "save", id: ID, body: "Hi {{contact.first_name}}, welcome to Fundhub." },
    }), [staffSession(), load(stored()), update]);
    assert.equal(same.res.statusCode, 200);
    assert.equal(same.res.body.approval_cleared, false);
    assert.equal(same.fake.find(/UPDATE message_templates/)[0].params[4], true);

    const badTag = await call(templates, req("POST", {
      body: { action: "save", id: ID, body: "Hi {{totally_unknown_tag}}" },
    }), [staffSession(), load(stored()), update]);
    assert.equal(badTag.res.statusCode, 400);
    assert.equal(badTag.res.body.error, "unknown_merge_tags");
    assert.equal(badTag.fake.find(/UPDATE message_templates/).length, 0);

    const empty = await call(templates, req("POST", { body: { action: "save", id: ID, body: "   " } }), [staffSession(), load(stored())]);
    assert.equal(empty.res.statusCode, 400);
    assert.equal(empty.res.body.error, "body_required");
  });

  test("approve turns it ON only for the exact copy that was read, only for an owner or admin", async () => {
    const draft = stored({ compliance_passed: false, approved_by: null });
    const ok = await call(templates, req("POST", {
      body: { action: "approve", id: ID, body: draft.body, subject: null },
    }), [staffSession({ role: "admin" }), load(draft), approveUpdate]);
    assert.equal(ok.res.statusCode, 200);
    assert.equal(ok.res.body.template.compliance_passed, true);
    assert.match(ok.res.body.message, /Approved\. This message can go out again\./);
    const [write] = ok.fake.find(/UPDATE message_templates/);
    assert.equal(write.params[2], STAFF_ID);
    assert.match(write.params[3], /^[0-9a-f]{64}$/);

    const stale = await call(templates, req("POST", {
      body: { action: "approve", id: ID, body: "Older words", subject: null },
    }), [staffSession({ role: "owner" }), load(draft), approveUpdate]);
    assert.equal(stale.res.statusCode, 409);
    assert.equal(stale.res.body.error, "copy_changed");
    assert.equal(stale.fake.find(/UPDATE message_templates/).length, 0);

    const closer = await call(templates, req("POST", {
      body: { action: "approve", id: ID, body: draft.body, subject: null },
    }), [staffSession({ role: "closer" }), load(draft), approveUpdate]);
    assert.equal(closer.res.statusCode, 403);
    assert.equal(closer.fake.find(/UPDATE message_templates/).length, 0);
  });

  test("rename and delete are refused, always, and nothing is written", async () => {
    for (const action of ["rename", "delete"]) {
      const { res, fake } = await call(templates, req("POST", { body: { action, id: ID, new_key: "OTHER" } }), [
        staffSession({ role: "owner" }), load(stored()),
      ]);
      assert.equal(res.statusCode, 409, action);
      assert.equal(res.body.error, `${action}_refused`, action);
      assert.equal(res.body.template_key, "SMS-WELCOME");
      assert.equal(fake.find(/UPDATE message_templates|DELETE FROM message_templates/).length, 0, action);
    }
    const missing = await call(templates, req("POST", { body: { action: "save", id: ID, body: "x" } }), [staffSession(), load(null)]);
    assert.equal(missing.res.statusCode, 404);
  });
});

describe("/api/journeys", () => {
  const nodes = [
    { id: "n1", type: "sms", title: "Welcome text", cfg: { template: "SMS-WELCOME" } },
    { id: "n2", type: "wait", cfg: { amount: 2, unit: "days" } },
  ];
  const put = (body, role = "owner") => call(journeys, req("PUT", { body }), [staffSession({ role }), [/INSERT INTO journeys/, (_s, p) => [{ key: p[1], updated_at: "2026-10-13T00:00:00Z" }]]]);

  test("GET returns this company's saved journeys keyed by lane", async () => {
    const { res, fake } = await call(journeys, req("GET"), [staffSession(), [/FROM journeys WHERE org_id = \$1/, [
      { key: "client", name: "Client", start_when: "Pays", end_when: "Funded", description: "d", nodes, updated_at: "2026-10-12T00:00:00Z" },
    ]]]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(Object.keys(res.body.journeys), ["client"]);
    assert.deepEqual(res.body.journeys.client.nodes, nodes);
    assert.equal(res.body.journeys.client.start, "Pays");
    assert.deepEqual(fake.find(/FROM journeys/)[0].params, [ORG_ID]);
  });

  test("PUT saves the step tree for that company and lane, by the signed-in person", async () => {
    const { res, fake } = await put({ key: "setter", name: "Setter", start: "Lead arrives", end: "Booked", desc: "texts", nodes });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.key, "setter");
    const [write] = fake.find(/INSERT INTO journeys/);
    assert.equal(write.params[0], ORG_ID);
    assert.equal(write.params[1], "setter");
    assert.equal(write.params[2], "Setter");
    assert.deepEqual(JSON.parse(write.params[6]), nodes);
    assert.equal(write.params[7], STAFF_ID);
  });

  test("a wait with no length, a one-brace tag and an unknown lane are refused and nothing is written", async () => {
    const wait = await put({ key: "client", name: "C", start: "a", end: "b", nodes: [{ id: "x", type: "wait", cfg: { unit: "days" } }] });
    assert.equal(wait.res.statusCode, 400);
    assert.equal(wait.res.body.error, "steps_not_set_up");
    const brace = await put({ key: "client", name: "C", start: "a", end: "b", nodes: [{ id: "x", type: "sms", cfg: { body: "Hi {first_name}" } }] });
    assert.equal(brace.res.statusCode, 400);
    assert.equal(brace.res.body.error, "single_brace_tags");
    const lane = await put({ key: "janitor", name: "C", start: "a", end: "b", nodes });
    assert.equal(lane.res.statusCode, 400);
    assert.equal(lane.res.body.error, "invalid_key");
    for (const r of [wait, brace, lane]) assert.equal(r.fake.find(/INSERT INTO journeys/).length, 0);
  });

  test("a closer cannot read or save journeys", async () => {
    const get = await call(journeys, req("GET"), [staffSession({ role: "closer" })]);
    assert.equal(get.res.statusCode, 403);
    const save = await put({ key: "client", name: "C", start: "a", end: "b", nodes }, "closer");
    assert.equal(save.res.statusCode, 403);
    assert.equal(save.fake.find(/INSERT INTO journeys/).length, 0);
  });
});

describe("POST /api/marketing/funnels/push-live", () => {
  const FUNNEL = "f1000000-0000-4000-8000-000000000001";
  const REQUEST = "a1000000-0000-4000-8000-000000000001";
  const URL = "https://apply.example.test/slo-funnel";
  const funnel = (over = {}) => ({ id: FUNNEL, org_id: ORG_ID, kind: "slo", status: "built", landing_url: URL, ...over });
  const pages = (n = 3, html = "<html>ok</html>") => Array.from({ length: n }, (_v, i) => ({ id: `p${i}`, position: i, html }));
  const rules = ({ f = funnel(), p = pages(), inflight = false } = {}) => [
    staffSession({ role: "owner" }),
    [/FROM marketing_requests WHERE request_id/, []],
    [/SELECT \* FROM marketing_funnels WHERE id = \$1 AND org_id = \$2/, f ? [f] : []],
    [/FROM marketing_funnel_pages/, p],
    [/FROM marketing_jobs\s+WHERE kind = ANY/, inflight ? [{ id: "j0", status: "running" }] : []],
    [/INSERT INTO marketing_jobs/, (_s, prm) => [{ id: "b1000000-0000-4000-8000-000000000001", kind: "funnel_push", status: "queued", created_at: "2026-10-13T00:00:00Z", payload: prm[2] }]],
  ];
  const wakes = [];
  const wake = async (args) => { wakes.push(args); return { ok: true }; };
  const body = (over = {}) => ({ request_id: REQUEST, id: FUNNEL, confirm_url: URL, ...over });

  test("the second tap names the exact address, one push job is queued, and the worker is woken", async () => {
    wakes.length = 0;
    const { res, fake } = await call(pushLive, req("POST", { body: body() }), rules(), { wake });
    assert.equal(res.statusCode, 202);
    assert.equal(res.body.queued, true);
    assert.equal(res.body.url, URL);
    assert.equal(res.body.job.kind, "funnel_push");
    assert.equal(res.body.worker.started, true);
    const [insert] = fake.find(/INSERT INTO marketing_jobs/);
    assert.equal(insert.params[0], ORG_ID);
    assert.equal(insert.params[1], "funnel_push");
    assert.deepEqual(JSON.parse(insert.params[2]), { funnel_id: FUNNEL, confirm_url: URL });
    assert.equal(wakes.length, 1);
  });

  test("a different address, missing pages, a live funnel or a busy worker each queue nothing", async () => {
    const cases = [
      [body({ confirm_url: "https://other.example.test/x" }), rules(), /confirm_url|confirmed/],
      [body({ confirm_url: "  " }), rules(), /Confirm the address first/],
      [body(), rules({ p: pages(2) }), /Build the pages first/],
      [body(), rules({ p: pages(3, "") }), /Build the pages first/],
      [body(), rules({ f: funnel({ status: "live" }) }), /already live/],
      [body(), rules({ inflight: true }), /already being written or pushed/],
    ];
    for (const [b, r, pattern] of cases) {
      wakes.length = 0;
      const { res, fake } = await call(pushLive, req("POST", { body: b }), r, { wake });
      assert.ok([400, 404, 409, 422].includes(res.statusCode), `${pattern} -> ${res.statusCode}`);
      assert.match(JSON.stringify(res.body), pattern);
      assert.equal(fake.find(/INSERT INTO marketing_jobs/).length, 0, String(pattern));
      assert.equal(wakes.length, 0, String(pattern));
    }
  });

  test("a closer is refused and an unknown funnel is 404", async () => {
    const closer = await call(pushLive, req("POST", { body: body() }), [staffSession({ role: "closer" })], { wake });
    assert.equal(closer.res.statusCode, 403);
    const unknown = await call(pushLive, req("POST", { body: body() }), rules({ f: null }), { wake });
    assert.equal(unknown.res.statusCode, 404);
    assert.equal(unknown.fake.find(/INSERT INTO marketing_jobs/).length, 0);
  });
});

describe("POST /api/partners/approve", () => {
  const PARTNER = "b1000000-0000-4000-8000-000000000001";
  const WELCOME_EMAIL = { subject: "Welcome to Fundhub, {{partner.first_name}}", body: "Hi {{partner.name}}, sign in at {{partner.login_url}}. Your page: {{partner.site_url}}" };
  const WELCOME_SMS = { body: "Hi {{partner.first_name}}, you are approved. Sign in: {{partner.login_url}}" };
  const note = (consent) => `contact=Pat\nphone=6025550100\naudience=small business owners\nsms_consent=${consent}`;

  async function approve({ role = "owner", notes = note("false"), partner = {} } = {}) {
    reset();
    const fake = queueDb({
      templates: { "EMAIL-PARTNER-WELCOME": WELCOME_EMAIL, "SMS-PARTNER-WELCOME": WELCOME_SMS },
      extra: [
        staffSession({ role }),
        [/SELECT notes FROM partners WHERE id = \$1::uuid AND org_id = \$2::uuid/, notes == null ? [] : [{ notes }]],
        [/FROM partners WHERE id = \$1 AND org_id = \$2 LIMIT 1/, [{
          id: PARTNER, name: "Pat Partner", brand_name: "Pat Co", slug: "pat-co", status: "pending", contact_email: "pat@example.test", ...partner,
        }]],
        [/INSERT INTO accounts/, [{ id: "ac000000-0000-4000-8000-0000000000b1" }]],
        [/SELECT self_signup FROM account_signup_policy/, [{ self_signup: false }]],
      ],
    });
    const res = makeRes();
    await runWithSharedDb(fake, () => approvePartner(req("POST", { body: { partner_id: PARTNER } }), res));
    return { res, fake };
  }

  test("approval makes the login and the page, marks the partner active, and mails the welcome to their own address", async () => {
    const { res, fake } = await approve();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, "active");
    assert.equal(res.body.site_path, `/sites/${PARTNER}/apply`);
    assert.ok(res.body.password, "a first password is handed back once");

    const [account] = fake.find(/INSERT INTO accounts/);
    assert.deepEqual([account.params[1], account.params[2], account.params[8]], ["partner", "pat@example.test", PARTNER]);
    assert.equal(fake.find(/INSERT INTO partner_pages/)[0].params[1], PARTNER);
    assert.equal(fake.find(/UPDATE partners SET status = 'active'/).length, 1);
    assert.equal(fake.count("COMMIT"), 1);

    const emails = fake.state.messages.filter((m) => m.channel === "email");
    assert.equal(emails.length, 1);
    assert.equal(emails[0].template_key, "EMAIL-PARTNER-WELCOME");
    assert.equal(emails[0].to_address, "pat@example.test");
    assert.equal(emails[0].provider_ref, `partner:${PARTNER}:welcome:email`);
    assert.match(emails[0].rendered_body, /Hi Pat Partner, sign in at https:\/\/fundhub\.ai\/login\.html\. Your page: https:\/\/fundhub\.ai\/sites\/b1000000-0000-4000-8000-000000000001\/apply/);
    assert.deepEqual(recorded().map((m) => m.to), ["pat@example.test"]);
  });

  test("no text goes out unless the applicant ticked the box; a ticked box queues one to their number", async () => {
    const unticked = await approve({ notes: note("false") });
    assert.equal(unticked.fake.state.messages.filter((m) => m.channel === "sms").length, 0);

    const ticked = await approve({ notes: note("true") });
    const texts = ticked.fake.state.messages.filter((m) => m.channel === "sms");
    assert.equal(texts.length, 1);
    assert.equal(texts[0].template_key, "SMS-PARTNER-WELCOME");
    assert.equal(texts[0].to_address, "+16025550100");
  });

  test("a closer is refused, a paused partner is 409 and an unknown partner is 404, with no login made", async () => {
    const closer = await approve({ role: "closer" });
    assert.equal(closer.res.statusCode, 403);
    const paused = await approve({ partner: { status: "paused" } });
    assert.equal(paused.res.statusCode, 409);
    assert.equal(paused.res.body.error, "partner_paused");
    const unknown = await approve({ notes: null });
    assert.equal(unknown.res.statusCode, 404);
    for (const r of [closer, paused, unknown]) {
      assert.equal(r.fake.find(/INSERT INTO accounts/).length, 0);
      assert.equal(r.fake.state.messages.length, 0);
    }
  });
});
