// Postgres-backed tests for the five /api/campaigns/* list endpoints, driven
// with the EXACT query strings public/app/campaign-manager.html builds:
//
//   GET /api/campaigns/list?state=all&limit=200
//   GET /api/campaigns/spend?state=all
//   GET /api/campaigns/connections?state=all
//   GET /api/campaigns/fatigue?state=all&days=7
//   GET /api/campaigns/action-log?state=all&limit=200
//
// WHY THESE STRINGS AND NOT TIDIER ONES. All five were reported as 400s in
// production. The cause was not `state=all` — stateFilter has always mapped it to
// TRUE — it was that a STAFF principal must name a ?partner_id= and the screen
// only appends one when the page URL carries it. So each endpoint is exercised
// twice: once as a partner (who needs no partner_id) and once as staff (who does),
// which is the only way a test can tell those two 400s apart.
//
// These live under src/http/ deliberately. npm test's glob is "src/**" and
// "scripts/**" only — a test placed under api/ silently never runs.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";

import listHandler from "../../api/campaigns/list.mjs";
import spendHandler from "../../api/campaigns/spend.mjs";
import connectionsHandler from "../../api/campaigns/connections.mjs";
import fatigueHandler from "../../api/campaigns/fatigue.mjs";
import actionLogHandler from "../../api/campaigns/action-log.mjs";
import detailHandler from "../../api/campaigns/detail.mjs";

const HAS_DB = !!process.env.DATABASE_URL;

// Sentinel strings so cleanup can never delete a row this suite did not create.
const MARK = "cmptest";
const SENTINEL_EMAIL = `partner.${MARK}@example.com`;

// action_log is APPEND-ONLY (046 revokes DELETE), and its partner_id FK is ON
// DELETE RESTRICT — so neither the log row nor the partner can be torn down. This
// suite therefore REUSES one sentinel partner across runs and tags its log row
// with a per-run id, rather than trying to delete what the schema forbids
// deleting. Everything else is created and dropped per run.
const RUN = `${MARK}-${Date.now().toString(36)}`;

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
};

async function call(handler, query, token) {
  const r = res();
  await handler({ method: "GET", query, headers: { authorization: "Bearer " + token } }, r);
  return r;
}

/* Everything this suite creates that the schema actually permits deleting,
   dropped child-first. action_log and the partner itself are excluded on
   purpose — 046 revokes DELETE on the log, and the log RESTRICTs the partner. */
async function dropRunRows(partnerId) {
  if (!partnerId) return;
  await db.query(`DELETE FROM ad_metrics_daily WHERE partner_id = $1`, [partnerId]);
  await db.query(`DELETE FROM ads WHERE partner_id = $1`, [partnerId]);
  await db.query(`DELETE FROM ad_sets WHERE partner_id = $1`, [partnerId]);
  await db.query(`DELETE FROM campaigns WHERE partner_id = $1`, [partnerId]);
  await db.query(`DELETE FROM ad_platform_connections WHERE partner_id = $1`, [partnerId]);
}

describe("GET /api/campaigns/* — the campaign-manager query strings",
  { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {

  let org, partnerId, accountId, partnerToken, staffToken;
  let campaignId, connectionId, adSetId, adId;

  before(async () => {
    org = await resolveDefaultOrg(db);

    // ---- a staff session, for the ?partner_id= half of each test -----------
    // Minted first because 044_accounts.sql makes a partner account invite-only:
    // invited_by must name a real staff row.
    const { createSession } = await import("../auth/session.mjs");
    /* THE OLDEST ACTIVE STAFF ROW, NOT AN ARBITRARY ONE.

       `LIMIT 1` with no ORDER BY returns whichever row Postgres reaches first, and
       the suite runs test files CONCURRENTLY. src/auth/seed-staff.pg.test.mjs
       inserts `+seedtest@fundhub.ai` staff rows into this same org and deletes them
       again, so an unordered pick can land on a row that is gone by the time the
       session built from it is verified — verifySession JOINs `staff`, finds
       nothing, and answers 401. That is a flake, and it is a flake that reads like
       an auth bug.

       `ORDER BY created_at` pins it to the seeded DEMO roster, which is created at
       migration time and outlives every test file. */
    const s = await db.query(
      `SELECT id, org_id FROM staff WHERE org_id = $1 AND status = 'active'
      ORDER BY created_at LIMIT 1`, [org]);
    if (!s.rows[0]) throw new Error("no active staff — run scripts/seed-staff.mjs");
    const staffId = s.rows[0].id;
    staffToken = (await createSession(db, { staffId, orgId: s.rows[0].org_id })).token;

    // ---- a partner, and a partner ACCOUNT session for it -------------------
    // These endpoints are requirePrincipal(["partner","staff"]). A partner
    // principal is pinned to its own id by resolvePartnerId, so it is the caller
    // that needs no ?partner_id= — which is what makes it the right principal for
    // asserting the endpoints work at all.
    // Find-or-create: action_log pins the partner down permanently (see RUN
    // above), so a second run must adopt the first run's partner instead of
    // failing on the unique slug.
    partnerId = (await db.query(
      `INSERT INTO partners (org_id, name, slug, status, contact_email)
       VALUES ($1, $2, $3, 'active', $4)
       ON CONFLICT (org_id, slug) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [org, `Cmptest Partner`, `cmptest-partner`, SENTINEL_EMAIL])).rows[0].id;

    // Leftovers from any run that crashed before its after() hook. Done here as
    // well as in after() so a poisoned database self-heals instead of wedging
    // every future run on the connection's unique key.
    await dropRunRows(partnerId);

    const { createAccount, createAccountSession } =
      await import("../auth/account-session.mjs");
    const existing = await db.query(`SELECT id FROM accounts WHERE email = $1`, [SENTINEL_EMAIL]);
    accountId = existing.rows[0]
      ? existing.rows[0].id
      // Through the real helper rather than a hand-rolled INSERT: accounts carries
      // an invite-only trigger and an "active needs a password hash" check, and
      // reproducing those here would only pin this test to today's schema.
      : (await createAccount(db, {
          orgId: org, kind: "partner", email: SENTINEL_EMAIL, name: "Cmptest Partner",
          password: `Cmptest-${MARK}-passw0rd!`, partnerId, invitedBy: staffId
        })).id;

    partnerToken = (await createAccountSession(db, { accountId, orgId: org })).token;

    // ---- one row for each endpoint to return -------------------------------
    // An 'active' connection must carry an access token (ad_platform_connections
    // _active_token_ck). Nothing here ever decrypts it — the endpoint only ever
    // reports the column's presence — so a clearly-fake placeholder is correct,
    // and putting a real-looking credential in a fixture would be worse.
    connectionId = (await db.query(
      `INSERT INTO ad_platform_connections
         (org_id, partner_id, platform, connection_state, platform_verification_state,
          external_ad_account_id, encrypted_access_token)
       VALUES ($1, $2, 'meta', 'active', 'approved', 'act_${MARK}', $3) RETURNING id`,
      [org, partnerId, `v1:${MARK}:not-a-real-token:placeholder`])).rows[0].id;

    campaignId = (await db.query(
      `INSERT INTO campaigns
         (org_id, partner_id, connection_id, name, platform, objective, offer_type,
          approval_state, budget_cents)
       VALUES ($1, $2, $3, 'Cmptest Campaign ${MARK}', 'meta', 'leads', 'funding',
               'draft', 50000) RETURNING id`,
      [org, partnerId, connectionId])).rows[0].id;

    adSetId = (await db.query(
      `INSERT INTO ad_sets (org_id, partner_id, connection_id, campaign_id, name, budget_cents)
       VALUES ($1, $2, $3, $4, 'Cmptest AdSet ${MARK}', 25000) RETURNING id`,
      [org, partnerId, connectionId, campaignId])).rows[0].id;

    adId = (await db.query(
      `INSERT INTO ads (org_id, partner_id, connection_id, campaign_id, ad_set_id, name)
       VALUES ($1, $2, $3, $4, $5, 'Cmptest Ad ${MARK}') RETURNING id`,
      [org, partnerId, connectionId, campaignId, adSetId])).rows[0].id;

    // Yesterday, so it lands inside both the ?days=7 fatigue window and the
    // list endpoint's deliberate "yesterday, not today" spend column. The ad
    // account's yesterday (America/Phoenix), as the endpoints count it — a UTC
    // CURRENT_DATE - 1 is the account's TODAY from 5pm to midnight Arizona time.
    await db.query(
      `INSERT INTO ad_metrics_daily
         (org_id, partner_id, ad_id, date, spend_cents, impressions, clicks,
          conversions, frequency, ctr, cpa_cents, roas)
       VALUES ($1, $2, $3, (now() AT TIME ZONE 'America/Phoenix')::date - 1, 12345, 10000, 250, 5, 3.5, 2.5, 2469, 1.8)`,
      [org, partnerId, adId]);

    // action_log_agent_ck: an 'agent' action must carry both a rule_key and an
    // undo_payload. That is exactly the row worth asserting on — it is the one
    // that comes back revertible:true, and whose payload must NOT be published.
    await db.query(
      `INSERT INTO action_log
         (org_id, partner_id, actor, target_type, target_id, rule_key, reason,
          undo_payload, executed_at)
       VALUES ($1, $2, 'agent', 'campaign', $3, 'frequency_bands',
               'Cmptest action ${RUN}', $4::jsonb, now())`,
      [org, partnerId, campaignId, JSON.stringify({ op: "restore_budget", budget_cents: 50000 })]);
  });

  after(async () => {
    await dropRunRows(partnerId);
    if (accountId) await db.query(`DELETE FROM account_sessions WHERE account_id = $1`, [accountId]);
    // The account, the partner and the action_log row deliberately survive — see
    // the RUN comment. They are inert sentinel rows, and the next run adopts them.
    await close();
  });

  /* ── the envelope every list endpoint shares ─────────────────────────── */
  const assertListEnvelope = (r, label) => {
    assert.equal(r.code, 200, `${label} did not answer 200: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, true, `${label} was not ok:true`);
    assert.ok(Array.isArray(r.body.items), `${label} has no items[]`);
    assert.equal(typeof r.body.count, "number", `${label} has no numeric count`);
    assert.equal(typeof r.body.hasMore, "boolean", `${label} has no boolean hasMore`);
  };

  const mine = (items, key, needle) =>
    items.filter((i) => String(i[key] || "").includes(needle));

  /* ── GET /api/campaigns/list?state=all&limit=200 ──────────────────────── */
  test("list?state=all&limit=200 returns the campaign rows the screen renders", async () => {
    const r = await call(listHandler, { state: "all", limit: "200" }, partnerToken);
    assertListEnvelope(r, "list");
    assert.equal(r.body.limit, 200, "limit=200 was not honoured");

    const rows = mine(r.body.items, "name", MARK);
    assert.equal(rows.length, 1, "the seeded campaign was not returned");
    const row = rows[0];
    // The columns campaign-manager.html reads off each card.
    for (const col of ["id", "name", "platform", "offer_type", "approval_state",
                       "budget_cents", "ad_set_count", "ad_count",
                       "spend_yesterday_cents", "has_disclosure_asset"]) {
      assert.ok(col in row, `list row is missing ${col}`);
    }
    assert.equal(row.approval_state, "draft");
    assert.equal(Number(row.ad_count), 1);
    assert.equal(Number(row.ad_set_count), 1);
    // Yesterday's spend, deliberately — not today's.
    assert.equal(Number(row.spend_yesterday_cents), 12345);
  });

  /* ── GET /api/campaigns/spend?state=all ───────────────────────────────── */
  test("spend?state=all returns the ceiling view rows", async () => {
    const r = await call(spendHandler, { state: "all" }, partnerToken);
    assertListEnvelope(r, "spend");
    // v_partner_spend_vs_ceiling only has rows once a ceiling is configured, and
    // this suite configures none — so the shape, not a row count, is the assertion.
    for (const row of r.body.items) {
      for (const col of ["ceiling_id", "scope", "spend_today_cents",
                         "breached", "exhausted", "approaching_ceiling"]) {
        assert.ok(col in row, `spend row is missing ${col}`);
      }
    }
  });

  /* ── GET /api/campaigns/connections?state=all ─────────────────────────── */
  test("connections?state=all returns the connection, with no token material", async () => {
    const r = await call(connectionsHandler, { state: "all" }, partnerToken);
    assertListEnvelope(r, "connections");

    const rows = mine(r.body.items, "external_ad_account_id", MARK);
    assert.equal(rows.length, 1, "the seeded connection was not returned");
    const row = rows[0];
    for (const col of ["id", "platform", "connection_state", "platform_verification_state",
                       "can_launch", "can_launch_credit_offer", "blockers", "campaign_count"]) {
      assert.ok(col in row, `connection row is missing ${col}`);
    }
    assert.equal(row.can_launch, true);
    assert.equal(row.can_launch_credit_offer, true);
    assert.equal(Number(row.campaign_count), 1);
    // The spec is unambiguous: no token is ever returned by any API response.
    assert.ok(!("encrypted_access_token" in row), "ciphertext leaked into the body");
    assert.ok(!("encrypted_refresh_token" in row), "ciphertext leaked into the body");
  });

  /* ── GET /api/campaigns/fatigue?state=all&days=7 ──────────────────────── */
  test("fatigue?state=all&days=7 returns the per-ad metrics with a recommendation", async () => {
    const r = await call(fatigueHandler, { state: "all", days: "7" }, partnerToken);
    assertListEnvelope(r, "fatigue");

    const rows = mine(r.body.items, "ad_name", MARK);
    assert.equal(rows.length, 1, "the seeded ad was not returned inside the 7-day window");
    const row = rows[0];
    for (const col of ["ad_id", "ad_name", "campaign_id", "campaign_name",
                       "frequency", "ctr", "spend_cents", "recommendation"]) {
      assert.ok(col in row, `fatigue row is missing ${col}`);
    }
    // THE RECOMMENDATION COMES FROM optimization_rules, NOT FROM THIS ENDPOINT.
    // The seeded frequency_bands rule is active with refresh_at_or_above = 3, and
    // the fixture's frequency is 3.5 — so "refresh" is the rule table's answer
    // being read correctly, which is the whole point of the join. If this ever
    // flips to "unconfigured" the rule was deactivated; if it flips to "ok" the
    // endpoint stopped reading the thresholds and started inventing its own.
    assert.equal(row.recommendation, "refresh",
      "the recommendation must track optimization_rules, not a restated threshold");
  });

  /* ── GET /api/campaigns/action-log?state=all&limit=200 ────────────────── */
  test("action-log?state=all&limit=200 returns the audit rows without undo_payload", async () => {
    const r = await call(actionLogHandler, { state: "all", limit: "200" }, partnerToken);
    assertListEnvelope(r, "action-log");
    assert.equal(r.body.limit, 200, "limit=200 was not honoured");

    // RUN, not MARK: the log is append-only, so earlier runs' rows are still here.
    const rows = mine(r.body.items, "reason", RUN);
    assert.equal(rows.length, 1, "this run's action was not returned");
    const row = rows[0];
    for (const col of ["id", "actor", "target_type", "target_id", "rule_key",
                       "reason", "executed_at", "revertible"]) {
      assert.ok(col in row, `action-log row is missing ${col}`);
    }
    assert.equal(row.actor, "agent");
    assert.equal(row.revertible, true, "a logged, un-undone agent action is revertible");
    // The payload is an instruction set for the revert endpoint; only the
    // boolean is published, so a caller cannot construct their own.
    assert.ok(!("undo_payload" in row), "undo_payload must never be returned");
  });

  /* ── the staff half: the same five strings PLUS ?partner_id= ──────────── */
  const ENDPOINTS = [
    ["list", listHandler, { state: "all", limit: "200" }],
    ["spend", spendHandler, { state: "all" }],
    ["connections", connectionsHandler, { state: "all" }],
    ["fatigue", fatigueHandler, { state: "all", days: "7" }],
    ["action-log", actionLogHandler, { state: "all", limit: "200" }]
  ];

  test("a staff session reaches all five once it names a partner_id", async () => {
    for (const [name, handler, query] of ENDPOINTS) {
      const r = await call(handler, { ...query, partner_id: partnerId }, staffToken);
      assertListEnvelope(r, `staff ${name}`);
    }
  });

  test("a staff session without partner_id is refused 400, not 500", async () => {
    // This is the production symptom, and it is the CONTRACT rather than a bug:
    // answering with every partner's book would make one endpoint mean two
    // different things depending on who called it.
    for (const [name, handler, query] of ENDPOINTS) {
      const r = await call(handler, query, staffToken);
      assert.equal(r.code, 400, `staff ${name} without partner_id should be 400`);
      assert.equal(r.body.error, "partner_id_required", `staff ${name} gave the wrong error`);
    }
  });

  /* ── the 500-vs-400 regression these endpoints shipped with ───────────── */
  test("an unknown ?state= is 400 bad_state, not 500 query_failed", async () => {
    // Before the fix this threw BAD_STATE out of stateFilter into a bare catch
    // that answered 500 query_failed — which public/app/data.js renders as
    // "the database is unreachable" for what is only a bad query string.
    const r = await call(listHandler, { state: "not_a_state" }, partnerToken);
    assert.equal(r.code, 400, `unknown state should be 400, got ${r.code}`);
    assert.equal(r.body.error, "bad_state");
    // The allowed list is echoed back so a screen filtering on a typo is told why.
    assert.match(r.body.message, /awaiting_approval/);
  });

  test("connections rejects an unknown ?state= the same way", async () => {
    const r = await call(connectionsHandler, { state: "not_a_state" }, partnerToken);
    assert.equal(r.code, 400, `unknown state should be 400, got ${r.code}`);
    assert.equal(r.body.error, "bad_state");
  });

  test("detail without an ?id= is 400 bad_request, not 500", async () => {
    const r = await call(detailHandler, {}, partnerToken);
    assert.equal(r.code, 400, `missing id should be 400, got ${r.code}`);
    assert.equal(r.body.error, "bad_request");
  });

  test("detail with a malformed ?id= is 400 invalid_parameter, not 500", async () => {
    // SQLSTATE 22P02 out of Postgres — the caller's error, not ours.
    const r = await call(detailHandler, { id: "not-a-uuid" }, partnerToken);
    assert.equal(r.code, 400, `bad uuid should be 400, got ${r.code}`);
    assert.equal(r.body.error, "invalid_parameter");
  });

  test("detail?id= returns the campaign with its series and ad sets", async () => {
    const r = await call(detailHandler, { id: campaignId, days: "30" }, partnerToken);
    assert.equal(r.code, 200, `detail did not answer 200: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.id, campaignId);
    assert.ok(Array.isArray(r.body.ad_sets));
    assert.equal(r.body.ad_sets.length, 1);
    assert.ok(Array.isArray(r.body.metrics_daily));
    assert.equal(r.body.metrics_daily.length, 1);
    assert.ok(Array.isArray(r.body.recent_actions));
  });
});
