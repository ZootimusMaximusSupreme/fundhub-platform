// POST /api/campaigns/write — pause, resume and update_budget, run with no Postgres
// and a stand-in for Meta.
//
// "Pause spending", "Start spending again" and "Change daily budget" on the
// Campaign Manager drawer move real ad money. This runs all three: what is
// logged before Meta is asked, what is
// sent to Meta, that our campaign row changes only after Meta says yes, and
// that the spend ceiling stops an over-limit budget before Meta is asked.
//
// Meta is never reached: globalThis.fetch is replaced for the whole file by a
// recorder that answers like Meta. The ad token key is made fresh at run time.
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import handler from "../../api/campaigns/write.mjs";
import { ROUTES } from "../../netlify/functions/api.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";
import {
  fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID
} from "../testing/handler-harness.mjs";

const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const CAMPAIGN = "ca300000-0000-4000-8000-000000000001";
const CONN = "c0000000-0000-4000-8000-0000000000c1";
const META_CAMPAIGN = "120210000000000001";

let metaCalls = [];
let metaAnswer = () => ({ status: 200, body: { success: true } });
const realFetch = globalThis.fetch;
const hadKey = Object.prototype.hasOwnProperty.call(process.env, "AD_TOKEN_ENC_KEY");
const realKey = process.env.AD_TOKEN_ENC_KEY;
let encrypted;

before(() => {
  process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
  encrypted = encryptToken("meta-test-token", { partnerId: PARTNER });
  globalThis.fetch = async (url, init = {}) => {
    metaCalls.push({ url: String(url), method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization });
    const { status, body } = metaAnswer();
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  };
});
after(() => {
  globalThis.fetch = realFetch;
  if (hadKey) process.env.AD_TOKEN_ENC_KEY = realKey; else delete process.env.AD_TOKEN_ENC_KEY;
});
beforeEach(() => {
  metaCalls = [];
  metaAnswer = () => ({ status: 200, body: { success: true } });
});

const campaignRow = (over = {}) => [/FROM campaigns c\s+JOIN ad_platform_connections conn/, (_s, p) => (
  p[0] === CAMPAIGN && p[1] === PARTNER ? [{
    id: CAMPAIGN, org_id: ORG_ID, partner_id: PARTNER, platform: "meta", external_id: META_CAMPAIGN,
    status: "PAUSED", approval_state: "paused", budget_cents: 5000,
    connection_id: CONN, conn_partner_id: PARTNER, encrypted_access_token: encrypted,
    external_ad_account_id: "act_100200300", ...over
  }] : []
)];
const actionLog = [/INSERT INTO action_log/, [{ id: "a1000000-0000-4000-8000-000000000001" }]];
const ceiling = (limit, pct = 50) => [/FROM spend_ceilings/, [{ id: "ce1", scope: "partner", daily_limit_cents: limit, max_daily_increase_pct: pct, breached_at: null }]];
const spend = (cents) => [/FROM ad_metrics_daily m/, [{ partner: cents, campaign: cents, platform: cents }]];

async function call(request, rules) {
  const fake = fakeDb(rules);
  const res = makeRes();
  await runWithSharedDb(fake, () => handler(request, res));
  return { res, fake };
}

describe("POST /api/campaigns/write — pause, resume and update_budget", () => {
  test("is routed", () => {
    assert.equal(ROUTES["campaigns/write"], handler);
  });

  test("no session: 401, Meta not asked", async () => {
    const { res } = await call(req("POST", { body: { action: "resume", campaign_id: CAMPAIGN, partner_id: PARTNER } }), []);
    assert.equal(res.statusCode, 401);
    assert.equal(metaCalls.length, 0);
  });

  test("staff must name the partner", async () => {
    const { res } = await call(req("POST", { body: { action: "resume", campaign_id: CAMPAIGN } }), [staffSession()]);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "partner_id_required");
  });

  test("an unknown action is refused and names the allowed ones", async () => {
    const { res } = await call(req("POST", { body: { action: "delete", campaign_id: CAMPAIGN, partner_id: PARTNER } }), [staffSession()]);
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body.allowed, ["pause", "resume", "update_budget", "resume_ad"]);
  });

  test("a partner cannot resume another partner's campaign: 404, Meta not asked", async () => {
    const { res } = await call(
      req("POST", { body: { action: "resume", campaign_id: CAMPAIGN, partner_id: PARTNER } }),
      [...accountSession({ kind: "partner", partnerId: OTHER_PARTNER }), campaignRow()]
    );
    assert.equal(res.statusCode, 404);
    assert.equal(metaCalls.length, 0);
  });

  test("Pause spending: logged first, Meta is told PAUSED for that campaign only, then our row says PAUSED", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "pause", campaign_id: CAMPAIGN, partner_id: PARTNER } }),
      [staffSession(), campaignRow({ status: "ACTIVE", approval_state: "live" }), actionLog]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "pause");
    assert.equal(metaCalls.length, 1);
    assert.match(metaCalls[0].url, new RegExp(`^https://graph\\.facebook\\.com/v\\d+\\.\\d+/${META_CAMPAIGN}$`));
    assert.equal(metaCalls[0].method, "POST");
    assert.deepEqual(metaCalls[0].body, { status: "PAUSED" });
    assert.equal(metaCalls[0].auth, "Bearer meta-test-token");
    const logIdx = fake.calls.findIndex((c) => /INSERT INTO action_log/.test(c.sql));
    const rowIdx = fake.calls.findIndex((c) => /UPDATE campaigns SET status = 'PAUSED'/.test(c.sql));
    assert.ok(logIdx >= 0 && rowIdx > logIdx, "the pause is logged before our row changes");
    const after = JSON.parse(fake.calls[logIdx].params[11]);
    assert.deepEqual(after, { status: "PAUSED", budget_cents: 5000, approval_state: "paused" });
    assert.deepEqual(fake.calls[rowIdx].params, [CAMPAIGN]);
  });

  test("Start spending again: logged first, Meta is told ACTIVE for that campaign only, then our row says ACTIVE / live", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "resume", campaign_id: CAMPAIGN, partner_id: PARTNER } }),
      [staffSession(), campaignRow(), actionLog]
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.action, "resume");
    assert.equal(metaCalls.length, 1);
    assert.match(metaCalls[0].url, new RegExp(`^https://graph\\.facebook\\.com/v\\d+\\.\\d+/${META_CAMPAIGN}$`));
    assert.equal(metaCalls[0].method, "POST");
    assert.deepEqual(metaCalls[0].body, { status: "ACTIVE" });
    assert.equal(metaCalls[0].auth, "Bearer meta-test-token");
    const logIdx = fake.calls.findIndex((c) => /INSERT INTO action_log/.test(c.sql));
    const rowIdx = fake.calls.findIndex((c) => /UPDATE campaigns SET status = 'ACTIVE'/.test(c.sql));
    assert.ok(logIdx >= 0 && rowIdx > logIdx, "the action is logged before our row changes");
    const after = JSON.parse(fake.calls[logIdx].params[11]);
    assert.deepEqual(after, { status: "ACTIVE", budget_cents: 5000, approval_state: "live" });
    assert.deepEqual(fake.calls[rowIdx].params, [CAMPAIGN]);
  });

  test("Meta says no: 400 platform_error with Meta's words, our row is NOT set ACTIVE", async () => {
    metaAnswer = () => ({ status: 400, body: { error: { message: "Ad account is disabled", code: 100 } } });
    const { res, fake } = await call(
      req("POST", { body: { action: "resume", campaign_id: CAMPAIGN, partner_id: PARTNER } }),
      [staffSession(), campaignRow(), actionLog]
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "platform_error");
    assert.match(res.body.message, /Ad account is disabled/);
    assert.equal(fake.find(/UPDATE campaigns SET status = 'ACTIVE'/).length, 0);
    const [err] = fake.find(/UPDATE campaigns SET last_error = \$2/);
    assert.deepEqual(err.params, [CAMPAIGN, "Ad account is disabled"]);
  });

  test("a campaign never synced from Meta cannot be resumed: 400, Meta not asked", async () => {
    const { res } = await call(
      req("POST", { body: { action: "resume", campaign_id: CAMPAIGN, partner_id: PARTNER } }),
      [staffSession(), campaignRow({ external_id: null })]
    );
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /sync from Meta first/);
    assert.equal(metaCalls.length, 0);
  });

  test("Change daily budget inside the ceiling (a 30% raise is the most allowed): Meta gets the new daily budget, then our row stores it", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "update_budget", campaign_id: CAMPAIGN, partner_id: PARTNER, budget_cents: 6500 } }),
      [staffSession(), campaignRow(), ceiling(20000), spend(1000), actionLog]
    );
    assert.equal(res.statusCode, 200);
    assert.deepEqual(metaCalls.map((c) => c.body), [{ daily_budget: "6500" }]);
    const [upd] = fake.find(/UPDATE campaigns SET budget_cents = \$2/);
    assert.deepEqual(upd.params, [CAMPAIGN, 6500]);
  });

  test("a budget over the spend ceiling is blocked BEFORE Meta is asked; nothing is logged or changed", async () => {
    const { res, fake } = await call(
      req("POST", { body: { action: "update_budget", campaign_id: CAMPAIGN, partner_id: PARTNER, budget_cents: 6500 } }),
      [staffSession(), campaignRow(), ceiling(6000), spend(5000), actionLog]
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "blocked");
    assert.equal(res.body.state, "over_ceiling");
    assert.equal(metaCalls.length, 0);
    assert.equal(fake.find(/INSERT INTO action_log/).length, 0);
    assert.equal(fake.find(/UPDATE campaigns/).length, 0);
  });

  test("no spend ceiling set up at all: blocked, Meta not asked", async () => {
    const { res } = await call(
      req("POST", { body: { action: "update_budget", campaign_id: CAMPAIGN, partner_id: PARTNER, budget_cents: 5500 } }),
      [staffSession(), campaignRow(), actionLog]
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "blocked");
    assert.equal(res.body.reasons[0].code, "no_ceiling_configured");
    assert.equal(metaCalls.length, 0);
  });

  test("a budget jump bigger than the allowed daily raise is blocked", async () => {
    const { res } = await call(
      req("POST", { body: { action: "update_budget", campaign_id: CAMPAIGN, partner_id: PARTNER, budget_cents: 10000 } }),
      [staffSession(), campaignRow(), ceiling(50000, 20), spend(0), actionLog]
    );
    assert.equal(res.statusCode, 400);
    assert.ok(res.body.reasons.some((r) => r.code === "increase_too_large"));
    assert.equal(metaCalls.length, 0);
  });
});
