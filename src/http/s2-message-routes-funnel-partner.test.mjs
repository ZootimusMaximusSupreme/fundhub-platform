// The funnel push and the partner approval, run through the REAL handlers with a
// stand-in database and the in-memory provider. No network, no database, no vendor.
//
//   route:marketing/funnels/push-live   two-tap confirm puts a built funnel live as new pages
//   route:partners/approve              approval makes the login, the brand row and the page, and mails the welcome
//
// The templates and the journeys are in s2-message-routes-write.test.mjs.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import pushLive from "../../api/marketing/funnels/push-live.mjs";
import approvePartner from "../../api/partners/approve.mjs";
import { queueDb } from "../pulse/catalog/proofs/s2-queue-db.mjs";
import { recorded, reset } from "../messaging/providers/memory.mjs";
import {
  makeRes, req, runWithSharedDb, staffSession, ORG_ID, OTHER_ORG_ID, STAFF_ID,
} from "../testing/handler-harness.mjs";
import { call, refuseNetwork, splitRoles } from "../pulse/catalog/proofs/s2-route-kit.mjs";

refuseNetwork({ before, after });

const OWNER_ADMIN = ["owner", "admin"];
const sorted = (list) => [...list].sort();

describe("POST /api/marketing/funnels/push-live", () => {
  const FUNNEL = "f1000000-0000-4000-8000-000000000001";
  const REQUEST = "a1000000-0000-4000-8000-000000000001";
  const URL = "https://apply.example.test/slo-funnel";
  const funnel = (over = {}) => ({ id: FUNNEL, org_id: ORG_ID, kind: "slo", status: "built", landing_url: URL, ...over });
  const pages = (n = 3, html = "<html>ok</html>") => Array.from({ length: n }, (_v, i) => ({ id: `p${i}`, position: i, html }));
  // A funnel is found by its id AND the signed-in person's company ($1, $2).
  const rules = ({ f = funnel(), p = pages(), inflight = false, role = "owner", org_id = ORG_ID } = {}) => [
    staffSession({ role, org_id }),
    [/FROM marketing_requests WHERE request_id/, []],
    [/SELECT \* FROM marketing_funnels WHERE id = \$1 AND org_id = \$2/, (_s, prm) => (
      f && prm[0] === f.id && prm[1] === f.org_id ? [f] : [])],
    [/FROM marketing_funnel_pages/, p],
    [/FROM marketing_jobs\s+WHERE kind = ANY/, inflight ? [{ id: "j0", status: "running" }] : []],
    [/INSERT INTO marketing_jobs/, (_s, prm) => [{ id: "b1000000-0000-4000-8000-000000000001", kind: "funnel_push", status: "queued", created_at: "2026-10-13T00:00:00Z", payload: prm[2] }]],
  ];
  const wakes = [];
  const wake = async (args) => { wakes.push(args); return { ok: true }; };
  const body = (over = {}) => ({ request_id: REQUEST, id: FUNNEL, confirm_url: URL, ...over });
  const push = (b, r) => { wakes.length = 0; return call(pushLive, req("POST", { body: b }), r, { wake }); };
  const queued = (fake) => fake.find(/INSERT INTO marketing_jobs/).length;

  test("the second tap names the exact address, one push job is queued, and the worker is woken", async () => {
    const { res, fake } = await push(body(), rules());
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

  test("a different or near-miss address, missing pages, a live funnel or a busy worker each queue nothing", async () => {
    const cases = [
      [body({ confirm_url: "https://other.example.test/x" }), rules(), /confirm_url|confirmed/],
      [body({ confirm_url: `${URL}/` }), rules(), /confirm_url|confirmed/],
      [body({ confirm_url: URL.toUpperCase() }), rules(), /confirm_url|confirmed/],
      [body({ confirm_url: "  " }), rules(), /Confirm the address first/],
      [body(), rules({ p: pages(2) }), /Build the pages first/],
      [body(), rules({ p: pages(3, "") }), /Build the pages first/],
      [body(), rules({ f: funnel({ status: "live" }) }), /already live/],
      [body(), rules({ inflight: true }), /already being written or pushed/],
    ];
    for (const [b, r, pattern] of cases) {
      const { res, fake } = await push(b, r);
      assert.ok([400, 404, 409, 422].includes(res.statusCode), `${pattern} -> ${res.statusCode}`);
      assert.match(JSON.stringify(res.body), pattern);
      assert.equal(queued(fake), 0, String(pattern));
      assert.equal(wakes.length, 0, String(pattern));
    }
  });

  test("only an owner or an admin may push a funnel live; every other staff role is refused and nothing is queued", async () => {
    const { admitted, refused } = splitRoles(OWNER_ADMIN);
    assert.deepEqual(sorted(admitted), sorted(OWNER_ADMIN));
    for (const role of admitted) {
      const { res } = await push(body(), rules({ role }));
      assert.equal(res.statusCode, 202, role);
    }
    assert.equal(refused.length, 6);
    for (const role of refused) {
      const { res, fake } = await push(body(), rules({ role }));
      assert.equal(res.statusCode, 403, role);
      assert.equal(queued(fake), 0, role);
      assert.equal(wakes.length, 0, role);
    }
  });

  test("an unknown funnel, and a funnel in another company, are 404 and nothing is queued", async () => {
    const unknown = await push(body(), rules({ f: null }));
    assert.equal(unknown.res.statusCode, 404);
    const stranger = await push(body(), rules({ org_id: OTHER_ORG_ID }));
    assert.equal(stranger.res.statusCode, 404);
    assert.deepEqual(stranger.fake.find(/FROM marketing_funnels WHERE id/)[0].params, [FUNNEL, OTHER_ORG_ID]);
    for (const r of [unknown, stranger]) assert.equal(queued(r.fake), 0);
    assert.equal(wakes.length, 0);
  });
});

describe("POST /api/partners/approve", () => {
  const PARTNER = "b1000000-0000-4000-8000-000000000001";
  const WELCOME_EMAIL = { subject: "Welcome to Fundhub, {{partner.first_name}}", body: "Hi {{partner.name}}, sign in at {{partner.login_url}}. Your page: {{partner.site_url}}" };
  const WELCOME_SMS = { body: "Hi {{partner.first_name}}, you are approved. Sign in: {{partner.login_url}}" };
  const note = (consent) => `contact=Pat\nphone=6025550100\naudience=small business owners\nsms_consent=${consent}`;

  // The applicant is found by their id AND the signed-in person's company ($1, $2).
  async function approve({ role = "owner", org_id = ORG_ID, notes = note("false"), partner = {} } = {}) {
    reset();
    const theirs = (_s, p) => (p[0] === PARTNER && p[1] === ORG_ID);
    const fake = queueDb({
      orgId: org_id,
      templates: { "EMAIL-PARTNER-WELCOME": WELCOME_EMAIL, "SMS-PARTNER-WELCOME": WELCOME_SMS },
      extra: [
        staffSession({ role, org_id }),
        [/SELECT notes FROM partners WHERE id = \$1::uuid AND org_id = \$2::uuid/, (s, p) => (theirs(s, p) && notes != null ? [{ notes }] : [])],
        [/FROM partners WHERE id = \$1 AND org_id = \$2 LIMIT 1/, (s, p) => (theirs(s, p) ? [{
          id: PARTNER, name: "Pat Partner", brand_name: "Pat Co", slug: "pat-co", status: "pending", contact_email: "pat@example.test", ...partner,
        }] : [])],
        [/INSERT INTO accounts/, [{ id: "ac000000-0000-4000-8000-0000000000b1" }]],
        [/SELECT self_signup FROM account_signup_policy/, [{ self_signup: false }]],
      ],
    });
    const res = makeRes();
    await runWithSharedDb(fake, () => approvePartner(req("POST", { body: { partner_id: PARTNER } }), res));
    return { res, fake };
  }
  const changedNothing = (fake) => fake.find(/INSERT INTO accounts|INSERT INTO partner_|UPDATE partners/).length === 0
    && fake.state.messages.length === 0 && fake.find(/INSERT INTO events/).length === 0;

  test("approval makes the login, the brand row and the page, marks the partner active, mails the welcome to their own address and announces it", async () => {
    const { res, fake } = await approve();
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.status, "active");
    assert.equal(res.body.site_path, `/sites/${PARTNER}/apply`);
    assert.ok(res.body.password, "a first password is handed back once");

    const [account] = fake.find(/INSERT INTO accounts/);
    assert.deepEqual([account.params[1], account.params[2], account.params[8]], ["partner", "pat@example.test", PARTNER]);
    const [brand] = fake.find(/INSERT INTO partner_brand /);
    assert.deepEqual(brand.params, [ORG_ID, PARTNER, "Pat Co", "pat@example.test"]);
    const [page] = fake.find(/INSERT INTO partner_pages/);
    assert.deepEqual([page.params[0], page.params[1]], [ORG_ID, PARTNER]);
    const [active] = fake.find(/UPDATE partners SET status = 'active'/);
    assert.deepEqual(active.params, [PARTNER, ORG_ID]);
    assert.equal(fake.count("COMMIT"), 1);

    const emails = fake.state.messages.filter((m) => m.channel === "email");
    assert.equal(emails.length, 1);
    assert.equal(emails[0].template_key, "EMAIL-PARTNER-WELCOME");
    assert.equal(emails[0].to_address, "pat@example.test");
    assert.equal(emails[0].provider_ref, `partner:${PARTNER}:welcome:email`);
    assert.match(emails[0].rendered_body, /Hi Pat Partner, sign in at https:\/\/fundhub\.ai\/login\.html\. Your page: https:\/\/fundhub\.ai\/sites\/b1000000-0000-4000-8000-000000000001\/apply/);
    assert.deepEqual(recorded().map((m) => m.to), ["pat@example.test"]);

    // partner.approved is announced once for this partner, with what the approval did.
    const [event] = fake.find(/INSERT INTO events/);
    assert.deepEqual([event.params[0], event.params[1], event.params[3]], [ORG_ID, "partner.approved", `partner.approved:${PARTNER}`]);
    const payload = typeof event.params[5] === "string" ? JSON.parse(event.params[5]) : event.params[5];
    assert.equal(payload.partnerId, PARTNER);
    assert.equal(payload.status, "active");
    assert.equal(payload.loginCreated, true);
    assert.equal(payload.smsConsent, false);
    assert.equal(payload.approvedBy, STAFF_ID);
  });

  test("no text goes out unless the applicant ticked the box; a ticked box queues one to their number", async () => {
    const unticked = await approve({ notes: note("false") });
    assert.equal(unticked.fake.state.messages.filter((m) => m.channel === "sms").length, 0);

    const ticked = await approve({ notes: note("true") });
    const texts = ticked.fake.state.messages.filter((m) => m.channel === "sms");
    assert.equal(texts.length, 1);
    assert.equal(texts[0].template_key, "SMS-PARTNER-WELCOME");
    assert.equal(texts[0].to_address, "+16025550100");
    const [event] = ticked.fake.find(/INSERT INTO events/);
    const payload = typeof event.params[5] === "string" ? JSON.parse(event.params[5]) : event.params[5];
    assert.equal(payload.smsConsent, true);
  });

  test("a number or a tick typed into the applicant's own free text cannot decide who is texted", async () => {
    const forged = `contact=Pat\nphone=6025550100\naudience=hello\nphone=6025559999\nsms_consent=false\nsms_consent=false`;
    const { fake } = await approve({ notes: forged });
    assert.equal(fake.state.messages.filter((m) => m.channel === "sms").length, 0);
    const injected = `contact=Pat\nphone=6025550100\naudience=hello\nphone=6025559999\nsms_consent=true\nsms_consent=false`;
    assert.equal((await approve({ notes: injected })).fake.state.messages.filter((m) => m.channel === "sms").length, 0);
    const realNumber = `contact=Pat\nphone=6025550100\naudience=hello\nphone=6025559999\nsms_consent=true`;
    const sms = (await approve({ notes: realNumber })).fake.state.messages.filter((m) => m.channel === "sms");
    assert.deepEqual(sms.map((m) => m.to_address), ["+16025550100"]);
  });

  test("only an owner or an admin may approve; every other staff role is refused and nothing is made", async () => {
    const { admitted, refused } = splitRoles(OWNER_ADMIN);
    assert.deepEqual(sorted(admitted), sorted(OWNER_ADMIN));
    for (const role of admitted) assert.equal((await approve({ role })).res.statusCode, 200, role);
    assert.equal(refused.length, 6);
    for (const role of refused) {
      const { res, fake } = await approve({ role });
      assert.equal(res.statusCode, 403, role);
      assert.ok(changedNothing(fake), role);
    }
  });

  test("a paused partner is 409, an unknown partner and a partner in another company are 404, with no login made", async () => {
    const paused = await approve({ partner: { status: "paused" } });
    assert.equal(paused.res.statusCode, 409);
    assert.equal(paused.res.body.error, "partner_paused");
    const unknown = await approve({ notes: null });
    assert.equal(unknown.res.statusCode, 404);
    const stranger = await approve({ org_id: OTHER_ORG_ID });
    assert.equal(stranger.res.statusCode, 404);
    assert.deepEqual(stranger.fake.find(/SELECT notes FROM partners/)[0].params, [PARTNER, OTHER_ORG_ID]);
    for (const r of [paused, unknown, stranger]) {
      assert.equal(r.fake.find(/INSERT INTO accounts/).length, 0);
      assert.equal(r.fake.state.messages.length, 0);
      assert.equal(r.fake.find(/INSERT INTO events/).length, 0);
    }
  });
});
