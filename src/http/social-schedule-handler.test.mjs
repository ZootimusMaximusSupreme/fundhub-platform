// POST /api/social/schedule — the real handler, run with no Postgres.
//
// Social Studio's "Queue it" saves an organic post and screens its words for
// compliance. Only the page was tested; nothing ran the door. This runs it,
// including the partner row scope it opens and the compliance screen: a clean
// caption waits for a person (the default), a clean caption on a partner who
// turned approval off is queued, and a caption that breaks a rule is blocked
// with the reason saved.
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/social/schedule.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { clearRuleCache } from "../compliance/screen.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID
} from "../testing/handler-harness.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const CHANNEL = "ca000000-0000-4000-8000-000000000001";
const POST_ID = "b5000000-0000-4000-8000-000000000001";

beforeEach(() => clearRuleCache());

const partnerOrg = [/SELECT org_id FROM partners WHERE id = \$1/, [{ org_id: ORG_ID }]];
const suite = (enabled, approve = true) => [/FROM partner_module_settings/, (sql) => (
  /approve_before_launch/.test(sql)
    ? [{ approve_before_launch: approve }]
    : [{ marketing_suite_enabled: enabled, ai_token_cap_monthly: 100000, org_id: ORG_ID }]
)];
const channel = [/FROM social_channels WHERE id = \$1/, [{ id: CHANNEL, channel: "facebook", connection_state: "connected", best_times: null, timezone: "America/Phoenix" }]];
const postInsert = [/INSERT INTO social_posts/, (_s, p) => [{ id: POST_ID, partner_id: p[1], channel_id: p[2], caption: p[4], offer_type: p[5], status: "draft" }]];
const postUpdate = [/UPDATE social_posts SET status/, (sql, p) => [{ id: POST_ID, status: /'blocked'/.test(sql) ? "blocked" : p[1] }]];
const noRules = [/FROM compliance_rules/, []];
const guaranteeRule = [/FROM compliance_rules/, [{
  rule_set: "ftc", rule_key: "no-guarantee", offer_types: null, platforms: null,
  match_type: "phrase", pattern: "guaranteed approval", severity: "block",
  message: "Never guarantee approval.", citation: null
}]];

async function call(request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

const BODY = { channel_id: CHANNEL, caption: "Funding reviews this week. Lenders decide.", offer_type: "funding" };

describe("POST /api/social/schedule", () => {
  test("is routed", () => {
    assert.equal(ROUTES["social/schedule"], handler);
  });

  test("GET is refused", async () => {
    const { res } = await call(req("GET"), [staffSession()]);
    assert.equal(res.statusCode, 405);
  });

  test("no session: 401, no post saved", async () => {
    const { res, fake } = await call(req("POST", { body: BODY }), []);
    assert.equal(res.statusCode, 401);
    assert.equal(fake.find(/social_posts/).length, 0);
  });

  test("staff must name the partner: 400", async () => {
    const { res } = await call(req("POST", { body: BODY }), [staffSession()]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "partner_id_required");
  });

  test("no channel or no words: 400, no post saved", async () => {
    const a = await call(req("POST", { body: { ...BODY, channel_id: "" } }), accountSession({ kind: "partner", partnerId: PARTNER }));
    assert.equal(a.res.statusCode, 400);
    assert.equal(a.res.body.error, "channel_id_required");
    const b = await call(req("POST", { body: { ...BODY, caption: "   " } }), accountSession({ kind: "partner", partnerId: PARTNER }));
    assert.equal(b.res.statusCode, 400);
    assert.equal(b.res.body.error, "caption_required");
    assert.equal(b.fake.find(/social_posts/).length, 0);
  });

  test("the suite is off for this partner: 403, no post saved, rolled back", async () => {
    const { res, fake } = await call(
      req("POST", { body: BODY }),
      [...accountSession({ kind: "partner", partnerId: PARTNER }), partnerOrg, suite(false)]
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "suite_off");
    assert.equal(fake.find(/INSERT INTO social_posts/).length, 0);
    assert.equal(fake.calls.filter((c) => c.sql === "ROLLBACK").length, 1);
  });

  test("a partner posts as themself: the partner id in the body is ignored", async () => {
    const { res, fake } = await call(
      req("POST", { body: { ...BODY, partner_id: OTHER_PARTNER } }),
      [...accountSession({ kind: "partner", partnerId: PARTNER }), partnerOrg, suite(true), channel, postInsert, noRules, postUpdate]
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(fake.find(/set_config\('fundhub\.partner_id'/)[0].params, [PARTNER]);
    assert.equal(fake.find(/INSERT INTO social_posts/)[0].params[1], PARTNER);
  });

  test("a clean caption waits for a person by default (awaiting_approval), and the screen is saved", async () => {
    const { res, fake } = await call(
      req("POST", { body: BODY, query: { partner_id: PARTNER } }),
      [staffSession(), partnerOrg, suite(true, true), channel, postInsert, noRules, postUpdate]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.state, "needs_approval");
    assert.equal(res.body.post.status, "awaiting_approval");
    const [audit] = fake.find(/INSERT INTO compliance_screenings/);
    assert.equal(audit.params[4], "needs_approval");
    assert.equal(fake.calls.filter((c) => c.sql === "COMMIT").length, 1);
  });

  test("a clean caption on a partner who turned approval off is queued", async () => {
    const { res } = await call(
      req("POST", { body: BODY, query: { partner_id: PARTNER } }),
      [staffSession(), partnerOrg, suite(true, false), channel, postInsert, noRules, postUpdate]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.state, "passed");
    assert.equal(res.body.post.status, "queued");
  });

  test("a caption that breaks a rule is blocked, with the reason saved on the post", async () => {
    const { res, fake } = await call(
      req("POST", { body: { ...BODY, caption: "Guaranteed approval in 24 hours!" }, query: { partner_id: PARTNER } }),
      [staffSession(), partnerOrg, suite(true, false), channel, postInsert, guaranteeRule, postUpdate]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.state, "blocked");
    assert.equal(res.body.post.status, "blocked");
    assert.equal(res.body.reasons[0].message, "Never guarantee approval.");
    const [blocked] = fake.find(/UPDATE social_posts SET status = 'blocked'/);
    assert.match(blocked.params[1], /no-guarantee|Never guarantee approval/);
  });

  test("a channel that is not there: 404, rolled back", async () => {
    const { res, fake } = await call(
      req("POST", { body: BODY, query: { partner_id: PARTNER } }),
      [staffSession(), partnerOrg, suite(true)]
    );
    assert.equal(res.statusCode, 404);
    assert.equal(fake.find(/INSERT INTO social_posts/).length, 0);
    assert.equal(fake.calls.filter((c) => c.sql === "ROLLBACK").length, 1);
  });
});
