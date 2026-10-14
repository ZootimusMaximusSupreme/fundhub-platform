// S5 route proofs: staff read doors that list rows for a screen. Each case runs
// the REAL api/ handler against a stand-in database and judges the exact list
// the screen gets, the exact values bound to the SQL (the company always comes
// from the session), who is refused, and what never leaves the server.

import assert from "node:assert/strict";
import test from "node:test";

import aiBureauHandler from "../../../../api/read/ai-bureau-config.mjs";
import callOutcomesHandler from "../../../../api/read/call-outcomes.mjs";
import commissionsHandler from "../../../../api/read/commissions.mjs";
import documentsHandler from "../../../../api/read/documents.mjs";
import eeoHandler from "../../../../api/read/eeo-aggregate.mjs";
import failedEventsHandler from "../../../../api/read/failed-events.mjs";
import funnelPagesHandler from "../../../../api/read/funnel-pages.mjs";
import shadowLogHandler from "../../../../api/read/agent-shadow-log.mjs";
import sloConnectionsHandler from "../../../../api/read/slo-connections.mjs";
import videoStatsHandler from "../../../../api/read/video-stats.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { STAFF_ID } from "../../../testing/handler-harness.mjs";
import { ORG_ID, assertRoleGate, exerciseLog, hit, sqlCalls } from "./s5-route-kit.mjs";

const THIS_FILE = "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs";
const log = exerciseLog(THIS_FILE);
const CLIENT = "c1000000-0000-4000-8000-0000000000c1";
const OTHER_STAFF = "5b000000-0000-4000-8000-0000000000b2";

const listOf = (items, limit = 50) => ({ ok: true, count: items.length, limit, offset: 0, hasMore: false, items });

/* ── paged list doors: same shape, different gate and filters ─────────────── */

const LISTS = [
  { name: "read-failed-events", route: "read/failed-events", handler: failedEventsHandler, allowed: "admin", refused: "closer",
    query: { status: "dead", event_name: "payment.received" }, sql: /FROM failed_events/, params: [51, 0, "dead", "payment.received", ORG_ID],
    predicates: [/WHERE org_id = \$5::uuid/, /ORDER BY last_seen_at DESC/],
    rows: [{ id: "fe-1", event_name: "payment.received", handler_name: "send-receipt", status: "dead", attempts: 5, max_attempts: 5, error_message: "template missing" }] },
  { name: "read-commissions-a", route: "read/commissions", handler: commissionsHandler, allowed: "sales_manager", refused: "closer",
    query: { client_id: CLIENT, status: "pending" }, sql: /FROM commission_ledger l/, params: [51, 0, CLIENT, "pending", ORG_ID],
    predicates: [/l\.org_id = \$5::uuid/, /COALESCE\(l\.is_demo, false\) = false/],
    rows: [{ id: "cl-1", staff_id: STAFF_ID, staff_name: "Olive Owner", client_id: CLIENT, role: "closer", basis: 300000, amount: 30000, status: "pending", split_percent: "100" }] },
  { name: "read-commissions-b", route: "read/commissions", handler: commissionsHandler, allowed: "owner", refused: "setter",
    query: {}, sql: /FROM commission_ledger l/, params: [51, 0, null, null, ORG_ID],
    predicates: [/LEFT JOIN staff s ON s\.id = l\.staff_id/],
    rows: [{ id: "cl-2", staff_id: STAFF_ID, staff_name: "Olive Owner", amount: 12500, status: "paid", paid_at: "2026-10-10T00:00:00.000Z" }] },
  { name: "read-documents", route: "read/documents", handler: documentsHandler, allowed: "csm", refused: "partner",
    query: { client_id: CLIENT, kind: "contract" }, sql: /FROM documents d/, params: [51, 0, CLIENT, "contract", ORG_ID],
    predicates: [/d\.org_id = \$5::uuid/],
    rows: [{ id: "doc-1", client_id: CLIENT, kind: "contract", title: "Blueprint agreement", client_name: "Dana Whitfield", storage_key: "secret/path/doc-1.pdf", storage_path: "x" }],
    hidden: ["storage_key", "storage_path"] },
  { name: "read-eeo-aggregate", route: "read/eeo-aggregate", handler: eeoHandler, allowed: "admin", refused: "closer",
    query: { role: "closer" }, sql: /FROM v_eeo_aggregate/, params: [ORG_ID, "closer"],
    predicates: [/role_key = \$2/],
    rows: [{ org_id: ORG_ID, role_key: "closer", race_ethnicity: "asian", gender: "female", responses: 6, hired: 1, rejected: 2, selection_rate_pct: "16.7" }] },
  { name: "read-slo-connections", route: "read/slo-connections", handler: sloConnectionsHandler, allowed: "owner", refused: "closer",
    query: {}, sql: /FROM slo_connections c/, params: [ORG_ID],
    predicates: [/c\.org_id = \$1::uuid/, /JOIN products p/],
    rows: [{ id: "slo-1", name: "SLO $297", cf_funnel_id: "f-1", cf_product_id: "p-1", product_id: "prod-1", product_code: "slo_297", product_name: "Roadmap", active: true, created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-02T00:00:00.000Z" }] },
];

for (const c of LISTS) {
  test(`${c.route} (${c.name}) answers this company's exact rows and refuses the wrong role`, async () => {
    assert.equal(ROUTES[c.route], c.handler);
    const rules = [[c.sql, c.rows]];
    const done = await hit(c.handler, { query: c.query, role: c.allowed, rules });
    assert.equal(done.status, 200);
    const shown = c.rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !(c.hidden || []).includes(key))));
    // The eeo door pages by slicing; the others by LIMIT. Same envelope either way.
    assert.deepEqual(done.body.items, shown);
    assert.equal(done.body.ok, true);
    const [call] = sqlCalls(done, c.sql);
    assert.deepEqual(call.params.slice(0, c.params.length), c.params);
    for (const predicate of c.predicates) assert.match(call.sql, predicate);
    for (const key of c.hidden || []) assert.equal(JSON.stringify(done.body).includes(key), false, `${key} never leaves the server`);

    const refused = await hit(c.handler, { query: c.query, role: c.refused, rules });
    assert.equal(refused.status, 403);
    assert.equal(sqlCalls(refused, c.sql).length, 0, "a refused role never reaches the data");
    const signedOut = await hit(c.handler, { query: c.query, anonymous: true, rules });
    assert.equal(signedOut.status, 401);
    log.mark(c.name);
  });
}

test("read/slo-connections lists a map as active unless the row says it is off, and tags the product it unlocks", async () => {
  const rows = [
    { id: "slo-1", name: "SLO $297", cf_funnel_id: "f-1", cf_product_id: "p-1", product_id: "prod-1", product_code: "slo_297", product_name: "Roadmap", active: true },
    { id: "slo-2", name: "Old funnel", cf_funnel_id: "f-2", cf_product_id: "p-2", product_id: "prod-2", product_code: null, product_name: null, active: false },
  ];
  const done = await hit(sloConnectionsHandler, { role: "admin", rules: [[/FROM slo_connections c/, rows]] });
  assert.deepEqual(done.body.items.map((i) => [i.id, i.active, i.product_code]), [["slo-1", true, "slo_297"], ["slo-2", false, null]]);
});

test("read/eeo-aggregate reads only the suppressed view, never the raw self-ID rows", async () => {
  const done = await hit(eeoHandler, { role: "owner", rules: [[/FROM v_eeo_aggregate/, []]] });
  assert.equal(done.status, 200);
  assert.equal(sqlCalls(done, /eeo_responses/).length, 0);
  assert.equal(sqlCalls(done, /FROM v_eeo_aggregate/).length, 1);
  assert.deepEqual(sqlCalls(done, /FROM v_eeo_aggregate/)[0].params, [ORG_ID], "no role filter bound when none was asked for");
});

/* ── doors with their own shape ─────────────────────────────────────────── */

test("read/funnel-pages answers the company's page views and conversions and the ClickFunnels connection state", async () => {
  assert.equal(ROUTES["read/funnel-pages"], funnelPagesHandler);
  const pages = [
    { funnel_name: "SLO", page_name: "Sales page", stat_date: "2026-10-12", views: 400, conversions: 31 },
    { funnel_name: "SLO", page_name: "Thank you", stat_date: "2026-10-12", views: 31, conversions: 31 },
  ];
  const connection = { state: "active", last_synced_at: "2026-10-13T06:00:00.000Z", last_error: null };
  const done = await hit(funnelPagesHandler, {
    role: "csm",
    rules: [[/FROM funnel_page_stats/, pages], [/FROM analytics_connections/, [connection]]],
  });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { ok: true, pages, connection });
  assert.deepEqual(sqlCalls(done, /FROM funnel_page_stats/)[0].params, [ORG_ID]);
  assert.match(sqlCalls(done, /FROM funnel_page_stats/)[0].sql, /WHERE org_id = \$1/, "this company's pages only");
  assert.deepEqual(sqlCalls(done, /FROM analytics_connections/)[0].params, [ORG_ID]);
  assert.match(sqlCalls(done, /FROM analytics_connections/)[0].sql, /platform = 'clickfunnels'/);

  const none = await hit(funnelPagesHandler, { rules: [] });
  assert.deepEqual(none.body, { ok: true, pages: [], connection: null });
  const partner = await hit(funnelPagesHandler, { role: "partner", rules: [] });
  assert.equal(partner.status, 403);
  log.mark("read-funnel-pages");
});

test("read/video-stats answers the watch-time rows and the connection's own health, with a bounded limit", async () => {
  assert.equal(ROUTES["read/video-stats"], videoStatsHandler);
  const videos = [{ video_title: "Funding in 30 days", stat_date: "2026-10-12", views: 90, estimated_minutes_watched: 410, average_view_duration_sec: 273, average_view_percentage: "61.2" }];
  const rules = [
    [/FROM video_watch_stats vws/, videos],
    [/FROM analytics_connections\s+WHERE org_id = \$1 AND platform = 'youtube'/, [{ connection_state: "error", last_synced_at: "2026-10-11T06:00:00.000Z", last_error: "refresh token revoked" }]],
  ];
  const done = await hit(videoStatsHandler, { query: { limit: "5" }, role: "setter", rules });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, {
    ok: true, videos,
    connection: { state: "error", last_synced_at: "2026-10-11T06:00:00.000Z", last_error: "refresh token revoked" },
  });
  assert.deepEqual(sqlCalls(done, /FROM video_watch_stats/)[0].params, [ORG_ID, 5]);
  assert.match(sqlCalls(done, /FROM video_watch_stats/)[0].sql, /WHERE vws\.org_id = \$1 AND c\.platform = 'youtube'/, "this company's YouTube rows only");
  const unbounded = await hit(videoStatsHandler, { query: { limit: "99999" }, rules });
  assert.deepEqual(sqlCalls(unbounded, /FROM video_watch_stats/)[0].params, [ORG_ID, 200], "the limit is capped");
  const noChannel = await hit(videoStatsHandler, { rules: [] });
  assert.deepEqual(noChannel.body, { ok: true, videos: [], connection: null });
  const post = await hit(videoStatsHandler, { method: "POST", rules });
  assert.equal(post.status, 405);
  log.mark("read-video-stats-a");
  log.mark("read-video-stats-b");
});

test("read/call-outcomes shows a closer only their own calls and lets the finance set read the floor", async () => {
  assert.equal(ROUTES["read/call-outcomes"], callOutcomesHandler);
  const row = {
    id: "co-1", client_id: CLIENT, staff_id: STAFF_ID, outcome: "closed", belief_failed: null,
    cash_collected_cents: "29700", notes: "Paid in full.", logged_at: "2026-10-12T20:00:00.000Z",
  };
  const rules = [[/FROM call_outcomes/, [row]]];
  const own = await hit(callOutcomesHandler, { role: "closer", query: { staff_id: OTHER_STAFF, client_id: CLIENT }, rules });
  assert.equal(own.status, 200);
  assert.equal(own.body.items[0].cash_collected_cents, 29700, "cents arrive as a number");
  assert.equal(own.body.items[0].belief_label, null);
  assert.deepEqual(sqlCalls(own, /FROM call_outcomes/)[0].params, [ORG_ID, STAFF_ID, CLIENT, 51, 0],
    "a closer's own id is bound; a staff_id in the URL changes nothing");
  assert.match(sqlCalls(own, /FROM call_outcomes/)[0].sql, /WHERE org_id = \$1 AND staff_id = \$2 AND client_id = \$3/);

  const floor = await hit(callOutcomesHandler, { role: "sales_manager", query: { staff_id: OTHER_STAFF }, rules });
  assert.deepEqual(sqlCalls(floor, /FROM call_outcomes/)[0].params, [ORG_ID, OTHER_STAFF, 51, 0]);
  const everyone = await hit(callOutcomesHandler, { role: "owner", rules });
  assert.deepEqual(sqlCalls(everyone, /FROM call_outcomes/)[0].params, [ORG_ID, 51, 0]);
  assert.match(sqlCalls(everyone, /FROM call_outcomes/)[0].sql, /WHERE org_id = \$1\s+ORDER BY logged_at DESC/, "the floor is every call of this company");

  // Every staff role that is not in the finance set sees only its own calls.
  for (const role of ["closer", "funding_advisor", "inquiry_specialist", "csm", "setter"]) {
    const mine = await hit(callOutcomesHandler, { role, query: { staff_id: OTHER_STAFF }, rules });
    assert.deepEqual(sqlCalls(mine, /FROM call_outcomes/)[0].params, [ORG_ID, STAFF_ID, 51, 0], `${role} reads only its own calls`);
  }
  for (const role of ["owner", "admin", "sales_manager"]) {
    const floorRead = await hit(callOutcomesHandler, { role, rules });
    assert.deepEqual(sqlCalls(floorRead, /FROM call_outcomes/)[0].params, [ORG_ID, 51, 0], `${role} reads the floor`);
  }
  const partner = await hit(callOutcomesHandler, { role: "partner", rules });
  assert.equal(partner.status, 403);
  log.mark("read-call-outcomes");
});

test("read/agent-shadow-log answers the would-be sends for one agent, shaped for the editor card", async () => {
  assert.equal(ROUTES["read/agent-shadow-log"], shadowLogHandler);
  const rows = [
    { id: "sh-1", agent_code: "AG-01", channel: "sms", inbound_body: "hi", would_send_body: "Hi Dana, this is Fundhub.", reason: "would_send", created_at: "2026-10-12T20:00:00.000Z" },
    { id: "sh-2", agent_code: "AG-01", channel: "sms", inbound_body: "stop", would_send_body: "never send this", reason: "guardrail_block", created_at: "2026-10-12T19:00:00.000Z" },
    { id: "sh-3", agent_code: "AG-01", channel: "email", inbound_body: "?", would_send_body: null, reason: "no_reply", created_at: "2026-10-12T18:00:00.000Z" },
  ];
  const done = await hit(shadowLogHandler, { role: "closer", query: { code: "ag-01", limit: "3" }, rules: [[/FROM agent_shadow_log/, rows]] });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.rows.map((r) => r.id), ["sh-1", "sh-2", "sh-3"]);
  assert.deepEqual(done.body.log.map((r) => r.o), [
    "Hi Dana, this is Fundhub.",
    "BLOCKED · guardrail_block: never send this",
    "(no_reply) no body",
  ]);
  assert.deepEqual(sqlCalls(done, /FROM agent_shadow_log/)[0].params, [ORG_ID, "AG-01", 3]);
  assert.match(sqlCalls(done, /FROM agent_shadow_log/)[0].sql, /WHERE org_id = \$1\s+AND \(\$2::text IS NULL OR agent_code = \$2\)/, "this company's log, narrowed to the agent asked for");
  const wholeOrg = await hit(shadowLogHandler, { query: {}, rules: [[/FROM agent_shadow_log/, rows]] });
  assert.deepEqual(sqlCalls(wholeOrg, /FROM agent_shadow_log/)[0].params, [ORG_ID, null, 50], "no agent named means the whole company's log");
  const noOrg = await hit(shadowLogHandler, { staff: { org_id: null }, rules: [[/FROM agent_shadow_log/, rows]] });
  assert.deepEqual(noOrg.body, { ok: true, rows: [], log: [] });
  assert.equal(sqlCalls(noOrg, /FROM agent_shadow_log/).length, 0, "no company on the session reads nothing");
  const partner = await hit(shadowLogHandler, { role: "partner", rules: [] });
  assert.equal(partner.status, 403);
  log.mark("read-agent-shadow-log");
});

test("read/ai-bureau-config answers the IVR routing table for this company and says when it is empty", async () => {
  assert.equal(ROUTES["read/ai-bureau-config"], aiBureauHandler);
  const rows = [
    { id: "b-1", bureau_code: "EQ", bureau_name: "Equifax", expected_hold_minutes: "12", retry_limit: "3", retry_delay_minutes: "20", active: true },
    { id: "b-2", bureau_code: "TU", bureau_name: "TransUnion", expected_hold_minutes: null, retry_limit: 2, retry_delay_minutes: 15, active: false },
  ];
  const done = await hit(aiBureauHandler, { role: "inquiry_specialist", rules: [[/FROM ai_bureau_config/, rows]] });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body.configs.map((r) => [r.bureau_code, r.expected_hold_minutes, r.retry_limit, r.active]), [
    ["EQ", 12, 3, true], ["TU", null, 2, false],
  ]);
  assert.deepEqual(done.body.meta, { empty: false });
  assert.deepEqual(sqlCalls(done, /FROM ai_bureau_config/)[0].params, [ORG_ID]);
  assert.match(sqlCalls(done, /FROM ai_bureau_config/)[0].sql, /WHERE org_id = \$1::uuid/, "this company's routing table only");
  const empty = await hit(aiBureauHandler, { rules: [] });
  assert.deepEqual(empty.body, { ok: true, configs: [], meta: { empty: true } });
  const partner = await hit(aiBureauHandler, { role: "partner", rules: [] });
  assert.equal(partner.status, 403);
  log.mark("read-ai-bureau-config");
});

// Who may open each door, written out so a role slipped into a gate turns this red.
const OWNER_ADMIN = ["owner", "admin"];
const WHOLE_FLOOR = ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"];
const GATES = [
  ["read/failed-events", failedEventsHandler, OWNER_ADMIN, {}],
  ["read/commissions", commissionsHandler, ["owner", "admin", "sales_manager"], {}],
  ["read/documents", documentsHandler, WHOLE_FLOOR, {}],
  ["read/eeo-aggregate", eeoHandler, OWNER_ADMIN, {}],
  ["read/slo-connections", sloConnectionsHandler, OWNER_ADMIN, {}],
  ["read/funnel-pages", funnelPagesHandler, WHOLE_FLOOR, {}],
  ["read/video-stats", videoStatsHandler, WHOLE_FLOOR, {}],
  ["read/call-outcomes", callOutcomesHandler, WHOLE_FLOOR, {}],
  ["read/agent-shadow-log", shadowLogHandler, WHOLE_FLOOR, {}],
  ["read/ai-bureau-config", aiBureauHandler, WHOLE_FLOOR, {}],
];

for (const [route, handler, allowed, request] of GATES) {
  test(`${route} lets in exactly ${allowed.join(", ")} and refuses every other role before any data is read`, async () => {
    await assertRoleGate(handler, allowed, request);
  });
}

test("every registry row for this file was exercised", () => {
  assert.deepEqual(log.missing(), []);
});
