// S5 route proofs: hiring reads, and the partner creative and campaign reads.
// Real handler, real gate, real row-scope wrapper, stand-in database. The proof
// is the exact list the screen gets, the exact values bound to the SQL, and who
// the partner scope was opened for.

import assert from "node:assert/strict";
import test from "node:test";

import applicationHandler from "../../../../api/hiring/application.mjs";
import candidatesHandler from "../../../../api/hiring/candidates.mjs";
import funnelHandler from "../../../../api/hiring/funnel.mjs";
import postingsHandler from "../../../../api/hiring/postings.mjs";
import actionLogHandler from "../../../../api/campaigns/action-log.mjs";
import connectionsHandler from "../../../../api/campaigns/connections.mjs";
import spendHandler from "../../../../api/campaigns/spend.mjs";
import approvalsHandler from "../../../../api/creative/approvals.mjs";
import brandKitsHandler from "../../../../api/creative/brand-kits.mjs";
import jobsHandler from "../../../../api/creative/jobs.mjs";
import libraryHandler from "../../../../api/creative/library.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { ORG_ID, assertRoleGate, exerciseLog, hit, sqlCalls } from "./s5-route-kit.mjs";

const THIS_FILE = "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs";
const log = exerciseLog(THIS_FILE);
const PARTNER = "9a000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "9b000000-0000-4000-8000-000000000002";
const APP_ID = "ab000000-0000-4000-8000-000000000001";

// The list shape every read door answers with.
const listOf = (items, limit = 50) => ({ ok: true, count: items.length, limit, offset: 0, hasMore: false, items });

/* ── hiring: the default company, owner and admin only ──────────────────── */

const HIRING = [
  { name: "hiring-postings-a", route: "hiring/postings", handler: postingsHandler, query: { state: "failed", channel: "linkedin" },
    sql: /FROM hiring_job_postings p/, params: [51, 0, "failed", "linkedin"], predicates: [/p\.status = \$3/, /p\.channel = \$4/, /org_id = \(SELECT id FROM orgs WHERE is_default LIMIT 1\)/],
    rows: [{ id: "post-1", channel: "linkedin", title: "Closer", status: "failed", last_error: "LinkedIn said no", applications: 4, applications_7d: 1 }] },
  { name: "hiring-funnel", route: "hiring/funnel", handler: funnelHandler, query: { days: "30", role: "closer" },
    sql: /WITH scoped AS/, params: [51, 0, 30, "closer"], predicates: [/r\.key = \$4/, /org_id = \(SELECT id FROM orgs WHERE is_default LIMIT 1\)/],
    rows: [{ source: "referral", role_key: "closer", applications: 10, reached_group_interview: 6, reached_one_on_one: 3, reached_offer: 2, hired: 1, rejected: 4, hire_rate_pct: "10.0" }] },
  { name: "hiring-candidates", route: "hiring/candidates", handler: candidatesHandler, query: { state: "offer", role: "setter" },
    sql: /FROM candidate_applications a/, params: [51, 0, "offer", "setter"], predicates: [/s\.key = \$3/, /r\.key = \$4/, /org_id = \(SELECT id FROM orgs WHERE is_default LIMIT 1\)/],
    rows: [{ application_id: APP_ID, status: "open", stage_key: "offer", role_key: "setter", full_name: "Riley Applicant", average: "4.2", recommendation_status: "advisory — a human decides" }] },
];

for (const c of HIRING) {
  test(`${c.route} answers the exact rows for its filters and refuses everyone but owner and admin`, async () => {
    assert.equal(ROUTES[c.route], c.handler);
    const done = await hit(c.handler, { query: c.query, role: "admin", rules: [[c.sql, c.rows]] });
    assert.equal(done.status, 200);
    assert.deepEqual(done.body, listOf(c.rows));
    const [call] = sqlCalls(done, c.sql);
    assert.deepEqual(call.params, c.params);
    for (const predicate of c.predicates) assert.match(call.sql, predicate);

    const closer = await hit(c.handler, { query: c.query, role: "closer", rules: [[c.sql, c.rows]] });
    assert.equal(closer.status, 403, "a closer never reads applicant data");
    assert.equal(sqlCalls(closer, c.sql).length, 0);
    const signedOut = await hit(c.handler, { anonymous: true });
    assert.equal(signedOut.status, 401);
    log.mark(c.name);
  });
}

test("hiring/postings (careers sync screen) reads every channel by default, newest first, last error verbatim", async () => {
  const rows = [
    { id: "post-2", channel: "facebook", title: "Setter", status: "posted", last_error: null, is_published: true, applications: 2, applications_7d: 2 },
    { id: "post-1", channel: "linkedin", title: "Closer", status: "failed", last_error: "401 from LinkedIn: token expired", is_published: false, applications: 0, applications_7d: 0 },
  ];
  const done = await hit(postingsHandler, { rules: [[/FROM hiring_job_postings p/, rows]] });
  assert.deepEqual(done.body.items.map((p) => [p.id, p.last_error]), [["post-2", null], ["post-1", "401 from LinkedIn: token expired"]]);
  const [call] = sqlCalls(done, /FROM hiring_job_postings p/);
  assert.deepEqual(call.params, [51, 0], "no filter bound when none was asked for");
  assert.match(call.sql, /ORDER BY p\.created_at DESC/);
  assert.match(call.sql, /org_id = \(SELECT id FROM orgs WHERE is_default LIMIT 1\)/, "the careers sync reads the default company's postings, as its control says");
  const typo = await hit(postingsHandler, { query: { state: "bogus", channel: "tiktok" }, rules: [[/FROM hiring_job_postings p/, rows]] });
  assert.deepEqual(sqlCalls(typo, /FROM hiring_job_postings p/)[0].params, [51, 0], "an unknown filter is dropped, never bound");
  log.mark("hiring-postings-b");
});

test("hiring/application returns one application in full: answers, every score with its rubric, interviews, decisions", async () => {
  assert.equal(ROUTES["hiring/application"], applicationHandler);
  const rules = [
    [/FROM candidate_applications a\s+JOIN candidates c/, [{ application_id: APP_ID, status: "open", answers: { why: "I like calls" }, full_name: "Riley Applicant", email: "riley@example.test", stage_key: "group_interview", role_key: "closer", scorecard: {}, comp: {} }]],
    [/FROM application_scores sc/, [
      { id: "sc-1", stage_key: "applied", rubric_version: "v1", average: "3.5", recommendation: "advance", flags: [], is_automated: true, scored_by_name: null },
      { id: "sc-2", stage_key: "screening", rubric_version: "v2", average: "4.1", recommendation: "advance", flags: ["fast"], is_automated: false, scored_by_name: "Ada Admin" },
    ]],
    [/FROM hiring_interview_attendees at/, [{ id: "iv-1", kind: "group", status: "scheduled", attended: null, outcome: null, host_name: "Ada Admin" }]],
    [/FROM hiring_decisions d/, [{ id: "d-1", decision: "advance", from_stage_key: "applied", to_stage_key: "screening", reason: "strong video", human_decided: true, decided_by_name: "Ada Admin" }]],
  ];
  const done = await hit(applicationHandler, { query: { id: APP_ID }, rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.application_id, APP_ID);
  assert.deepEqual(done.body.answers, { why: "I like calls" });
  assert.deepEqual(done.body.scores.map((s) => [s.id, s.rubric_version]), [["sc-1", "v1"], ["sc-2", "v2"]]);
  assert.equal(done.body.interviews.length, 1);
  assert.deepEqual(done.body.decisions.map((d) => [d.decision, d.human_decided]), [["advance", true]]);
  assert.match(done.body.scoring_notice, /named human and a written reason/);
  assert.deepEqual(sqlCalls(done, /FROM candidate_applications a\s+JOIN candidates c/)[0].params, [APP_ID, ORG_ID], "only this company's application");

  const missing = await hit(applicationHandler, { query: { id: APP_ID }, rules: [] });
  assert.equal(missing.status, 404);
  const noId = await hit(applicationHandler, { query: {}, rules });
  assert.equal(noId.status, 400);
  const closer = await hit(applicationHandler, { query: { id: APP_ID }, role: "closer", rules });
  assert.equal(closer.status, 403);
  log.mark("hiring-application");
});

/* ── partner reads: one partner's rows, the scope opened for the right id ─ */

// The three arms of the approval queue. Each one's own condition is judged, so
// a campaign arm that stops asking for "awaiting_approval", or an asset arm
// that starts listing passed and approved assets, turns this red.
const APPROVAL_ARMS = [
  /FROM creative_assets a\s+WHERE \$3 AND a\.archived_at IS NULL\s+AND a\.compliance_state IN \('pending','blocked'\)\s+AND \(\$5::text = 'all' OR a\.compliance_state = \$5\)/,
  /FROM campaigns c\s+WHERE \$4 AND c\.approval_state = 'awaiting_approval'/,
  /FROM partner_brand b\s+WHERE \$6 AND b\.partner_id = \$7 AND b\.approval_status = 'review'/,
  /ORDER BY q\.updated_at DESC\s+LIMIT \$1 OFFSET \$2/,
];

const PARTNER_READS = [
  { name: "creative-brand-kits-a", route: "creative/brand-kits", handler: brandKitsHandler, query: { state: "active" },
    sql: /FROM brand_kits k/, params: [51, 0, ["active"]], predicates: [/k\.status = ANY\(\$3\)/],
    rows: [{ id: "bk-1", name: "Fundhub Blue", status: "active", palette: ["#0a2a66"], asset_count: 3 }] },
  { name: "creative-brand-kits-b", route: "creative/brand-kits", handler: brandKitsHandler, query: {},
    sql: /FROM brand_kits k/, params: [51, 0], predicates: [/WHERE TRUE/],
    rows: [{ id: "bk-1", name: "Fundhub Blue", status: "draft", palette: [], asset_count: 0 }] },
  { name: "creative-library-a", route: "creative/library", handler: libraryHandler, query: { state: "blocked", kind: "video", format: "9x16" },
    hidden: ["has_storage_key"],
    sql: /FROM creative_assets a/, params: [51, 0, ["blocked"], "video", "9x16"], predicates: [/a\.compliance_state = ANY\(\$3\)/, /a\.kind = \$4/, /a\.format = \$5/, /a\.archived_at IS NULL/],
    neverSelects: /\(a\.storage_key IS NOT NULL\) AS has_storage_key/,
    rows: [{ id: "as-1", kind: "video", format: "9x16", compliance_state: "blocked", blocked_reasons: ["claims"], has_storage_key: true, brand_kit_name: "Fundhub Blue" }] },
  { name: "creative-library-b", route: "creative/library", handler: libraryHandler, query: { include_archived: "1", brand_kit_id: "bk-1" },
    hidden: ["has_storage_key"],
    sql: /FROM creative_assets a/, params: [51, 0, "bk-1"], predicates: [/a\.brand_kit_id = \$3/],
    neverSelects: /\(a\.storage_key IS NOT NULL\) AS has_storage_key/,
    rows: [{ id: "as-2", kind: "static", format: "1x1", compliance_state: "passed", has_storage_key: false }] },
  { name: "creative-jobs", route: "creative/jobs", handler: jobsHandler, query: { state: "failed" },
    sql: /FROM generation_jobs j/, params: [51, 0, ["failed"]], predicates: [/j\.status = ANY\(\$3\)/],
    rows: [{ id: "job-1", status: "failed", attempt: 2, error: "provider timeout", asset_kind: "video", asset_count: 0 }] },
  { name: "creative-approvals", route: "creative/approvals", handler: approvalsHandler, query: { state: "blocked" },
    sql: /SELECT 'creative_asset'::text AS item_type/, params: [51, 0, true, false, "blocked", false, PARTNER], predicates: APPROVAL_ARMS,
    rows: [{ item_type: "creative_asset", id: "as-1", state: "blocked", subtype: "video", reasons: ["claims"] }] },
  { name: "campaigns-action-log", route: "campaigns/action-log", handler: actionLogHandler, query: { state: "agent", target_type: "campaign", rule_key: "pause_losers" },
    sql: /FROM action_log l/, params: [51, 0, "campaign", "pause_losers"], predicates: [/l\.actor = 'agent'/, /l\.target_type = \$3/, /l\.rule_key = \$4/],
    rows: [{ id: "al-1", actor: "agent", target_type: "campaign", rule_key: "pause_losers", before: { status: "active" }, after: { status: "paused" }, revertible: true }] },
  { name: "campaigns-spend", route: "campaigns/spend", handler: spendHandler, query: { state: "breached" },
    sql: /FROM v_partner_spend_vs_ceiling v/, params: [51, 0],
    predicates: [/WHERE v\.breached_at IS NOT NULL/, /\(v\.breached_at IS NOT NULL\)\s+AS breached/, /\(v\.headroom_cents = 0\)\s+AS exhausted/, /\(v\.pct_of_ceiling >= 80\)\s+AS approaching_ceiling/],
    rows: [{ ceiling_id: "ce-1", scope: "campaign", spend_today_cents: 5200, daily_limit_cents: 5000, headroom_cents: 0, breached: true, exhausted: true, approaching_ceiling: true }] },
];

for (const c of PARTNER_READS) {
  test(`${c.route} (${c.name}) answers a partner only their own rows and binds its filters`, async () => {
    assert.equal(ROUTES[c.route], c.handler);
    const rules = [[c.sql, c.rows]];
    const own = await hit(c.handler, { account: { kind: "partner", partnerId: PARTNER }, query: { ...c.query, partner_id: OTHER_PARTNER }, rules });
    assert.equal(own.status, 200);
    const shown = c.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !(c.hidden || []).includes(key))));
    assert.deepEqual(own.body, listOf(shown), "the screen gets the rows, minus anything that names a storage key");
    const scope = own.db.calls.find((call) => /set_config\('fundhub\.partner_id'/.test(call.sql));
    assert.deepEqual(scope.params, [PARTNER], "the scope is the partner's own id; the partner_id in the URL is ignored");
    const [call] = sqlCalls(own, c.sql);
    assert.deepEqual(call.params, c.params);
    for (const predicate of c.predicates) assert.match(call.sql, predicate);
    // The file's storage key is a capability. The only thing the query may say
    // about it is "is there one", as has_storage_key.
    if (c.neverSelects) assert.doesNotMatch(call.sql.replace(c.neverSelects, ""), /storage_key/);

    // Only a partner or a staff sign-in is served. A client or affiliate account is not.
    for (const kind of ["client", "affiliate"]) {
      const refused = await hit(c.handler, { account: { kind, clientId: kind === "client" ? APP_ID : null }, query: { ...c.query, partner_id: PARTNER }, rules });
      assert.equal(refused.status, 403, `a ${kind} account is refused`);
      assert.equal(sqlCalls(refused, c.sql).length, 0, `a ${kind} account reads nothing`);
    }

    const staffNoPartner = await hit(c.handler, { query: c.query, rules });
    assert.equal(staffNoPartner.status, 400);
    assert.equal(staffNoPartner.body.error, "partner_id_required");
    assert.equal(sqlCalls(staffNoPartner, c.sql).length, 0);
    const staff = await hit(c.handler, { query: { ...c.query, partner_id: PARTNER }, rules });
    assert.deepEqual(staff.db.calls.find((x) => /set_config\('fundhub\.partner_id'/.test(x.sql)).params, [PARTNER]);
    log.mark(c.name);
  });
}

// ?state= decides which of the three arms the database is asked for. The
// stand-in database answers one row per arm, so the screen's list is the three
// kinds together exactly when the state asks for them.
const APPROVAL_QUEUE = [
  { item_type: "creative_asset", id: "as-1", state: "blocked", subtype: "video", reasons: ["claims"] },
  { item_type: "campaign", id: "cp-1", state: "awaiting_approval", subtype: "lead_gen", reasons: [], budget_cents: 5000 },
  { item_type: "partner_brand", id: "br-1", state: "review", subtype: "brand", reasons: [] },
];
const APPROVAL_STATES = [
  { state: "blocked", bound: [true, false, "blocked", false] },
  { state: "pending", bound: [true, false, "pending", false] },
  { state: "awaiting_approval", bound: [false, true, "all", true] },
  { state: "all", bound: [true, true, "all", true] },
  { state: undefined, bound: [true, true, "all", true] },
];

for (const c of APPROVAL_STATES) {
  test(`creative/approvals ?state=${c.state ?? "(none)"} asks for the right arms and binds this partner only`, async () => {
    const done = await hit(approvalsHandler, {
      account: { kind: "partner", partnerId: PARTNER },
      query: { ...(c.state ? { state: c.state } : {}), partner_id: OTHER_PARTNER },
      rules: [[/SELECT 'creative_asset'::text AS item_type/, APPROVAL_QUEUE]],
    });
    assert.equal(done.status, 200);
    assert.deepEqual(done.body, listOf(APPROVAL_QUEUE), "all three kinds of waiting item reach the screen");
    const [call] = sqlCalls(done, /SELECT 'creative_asset'::text AS item_type/);
    assert.deepEqual(call.params, [51, 0, ...c.bound.slice(0, 3), c.bound[3], PARTNER]);
    for (const arm of APPROVAL_ARMS) assert.match(call.sql, arm);
  });
}

test("creative/approvals with a state it does not know asks for no arm, never everything", async () => {
  const odd = await hit(approvalsHandler, {
    account: { kind: "partner", partnerId: PARTNER }, query: { state: "sparkly" },
    rules: [[/SELECT 'creative_asset'::text AS item_type/, []]],
  });
  assert.equal(odd.status, 200);
  const [call] = sqlCalls(odd, /SELECT 'creative_asset'::text AS item_type/);
  assert.deepEqual(call.params, [51, 0, false, false, "all", false, PARTNER]);
});

// The spend screen's ?state=: breached, ok, or everything.
for (const [state, condition] of [
  ["breached", /WHERE v\.breached_at IS NOT NULL\s+ORDER BY/],
  ["ok", /WHERE v\.breached_at IS NULL\s+ORDER BY/],
  ["all", /LEFT JOIN campaigns c ON c\.id = v\.campaign_id\s+ORDER BY v\.scope, v\.pct_of_ceiling DESC NULLS LAST/],
]) {
  test(`campaigns/spend ?state=${state} asks for exactly that slice of the ceilings`, async () => {
    const done = await hit(spendHandler, {
      account: { kind: "partner", partnerId: PARTNER }, query: { state },
      rules: [[/FROM v_partner_spend_vs_ceiling v/, [{ ceiling_id: "ce-9", breached: false }]]],
    });
    assert.equal(done.status, 200);
    assert.match(sqlCalls(done, /FROM v_partner_spend_vs_ceiling v/)[0].sql, condition);
  });
}

// The action log's ?state= decides which actions the screen sees.
for (const [state, condition] of [
  ["agent", /WHERE l\.actor = 'agent'\s+ORDER BY/],
  ["human", /WHERE l\.actor = 'human'\s+ORDER BY/],
  ["revertible", /WHERE l\.undo_payload IS NOT NULL AND l\.undone_at IS NULL\s+ORDER BY/],
  ["failed", /WHERE \(l\.execute_error IS NOT NULL OR l\.executed_at IS NULL\)\s+ORDER BY/],
  ["all", /FROM action_log l[\s\S]*?LEFT JOIN accounts acct ON acct\.id = l\.user_id\s+ORDER BY l\.created_at DESC/],
]) {
  test(`campaigns/action-log ?state=${state} asks for exactly that slice of the log`, async () => {
    const done = await hit(actionLogHandler, {
      account: { kind: "partner", partnerId: PARTNER }, query: { state },
      rules: [[/FROM action_log l/, [{ id: "al-9", actor: "human" }]]],
    });
    assert.equal(done.status, 200);
    const [call] = sqlCalls(done, /FROM action_log l/);
    assert.match(call.sql, condition);
    assert.deepEqual(call.params, [51, 0]);
  });
}

test("creative/brand-kits and campaigns/spend refuse a state they do not know instead of showing everything", async () => {
  const bad = await hit(brandKitsHandler, { account: { kind: "partner", partnerId: PARTNER }, query: { state: "sparkly" }, rules: [[/FROM brand_kits k/, [{ id: "x" }]]] });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "bad_state");
  assert.equal(sqlCalls(bad, /FROM brand_kits k/).length, 0);
});

test("campaigns/connections never lets a token out and tells the screen what blocks a launch", async () => {
  assert.equal(ROUTES["campaigns/connections"], connectionsHandler);
  const row = {
    id: "con-1", platform: "meta", connection_state: "active", platform_verification_state: "approved",
    encrypted_access_token: "v1:aaaa:bbbb:cccc", encrypted_refresh_token: null, token_expires_at: "2026-12-01T00:00:00.000Z",
    can_launch: true, can_launch_credit_offer: true, blockers: [{ task_key: "verify", title: "Verify the business", severity: "warn" }], campaign_count: 2,
  };
  const done = await hit(connectionsHandler, {
    account: { kind: "partner", partnerId: PARTNER }, query: { state: "active" },
    rules: [[/FROM ad_platform_connections c/, [row]]],
  });
  assert.equal(done.status, 200);
  const [shown] = done.body.items;
  assert.equal(shown.id, "con-1");
  assert.equal(shown.has_access_token, true);
  assert.equal(shown.can_launch_credit_offer, true);
  assert.deepEqual(shown.blockers.map((b) => b.task_key), ["verify"]);
  assert.equal(JSON.stringify(done.body).includes("v1:aaaa"), false, "the stored token text never leaves the server");
  assert.equal("encrypted_access_token" in shown, false);
  assert.deepEqual(sqlCalls(done, /FROM ad_platform_connections c/)[0].params, [51, 0, ["active"]]);
  for (const kind of ["client", "affiliate"]) {
    const refused = await hit(connectionsHandler, { account: { kind, clientId: kind === "client" ? APP_ID : null }, rules: [[/FROM ad_platform_connections c/, [row]]] });
    assert.equal(refused.status, 403, `a ${kind} account never sees a connection`);
    assert.equal(sqlCalls(refused, /FROM ad_platform_connections c/).length, 0);
  }
  log.mark("campaigns-connections");
});

// Applicant data: owner and admin only. Written out so a role slipped into the
// gate turns this red.
for (const [route, handler, query] of [
  ["hiring/postings", postingsHandler, {}],
  ["hiring/funnel", funnelHandler, {}],
  ["hiring/candidates", candidatesHandler, {}],
  ["hiring/application", applicationHandler, { id: APP_ID }],
]) {
  test(`${route} lets in exactly owner and admin and refuses every other role before any data is read`, async () => {
    await assertRoleGate(handler, ["owner", "admin"], { query });
  });
}

test("every registry row for this file was exercised", () => {
  assert.deepEqual(log.missing(), []);
});
