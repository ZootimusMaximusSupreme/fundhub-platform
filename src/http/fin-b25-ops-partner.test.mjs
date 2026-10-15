// Finish-the-853 batch 25, practice tests for three staff and partner doors: the weekly ops brief
// (filed into Company Brain, owner tier), the partner's add-on read (catalog, plan, history, orders)
// and the partner page copy history (list the versions, restore one). Each test runs the REAL api/
// handler (real sign-in and role gate, real library under it) over a stand-in database that answers
// by the SQL text the code sends. Fake data only. The model call and the embedding call are never
// made: the keys are cleared for the run and fetch is a stand-in that refuses anything unexpected.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import weeklyBriefHandler from "../../api/ops/weekly-brief.mjs";
import partnerAddonsHandler from "../../api/partner-addons.mjs";
import copyHistoryHandler from "../../api/partner-marketing/copy-history.mjs";
import { rowsWhere } from "../testing/s3-scoped-rows.mjs";
import { listSectionHistory } from "../brand/copy-generate.mjs";
import {
  ORG_ID, OTHER_ORG_ID, assertRoleGate, assertSent, assertSqlHas, call, dataCalls, sentStatement, sqlCalls,
} from "../testing/fin-b25-kit.mjs";

const PARTNER_ID = "b0000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "b0000000-0000-4000-8000-0000000000aa";
const PAGE_ID = "d0000000-0000-4000-8000-000000000001";
const VERSION_ID = "d0000000-0000-4000-8000-0000000000e1";
const OTHER_PAGE = "d0000000-0000-4000-8000-0000000000bb";
const STAFF_ROLES = ["owner", "admin", "funding_advisor", "closer", "inquiry_specialist", "setter", "sales_manager", "csm"];
const sha256 = (text) => createHash("sha256").update(text, "utf8").digest("hex");
const noWrites = (result) => assert.equal(dataCalls(result).every((c) => !/^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql)), true, "a read writes nothing");

/* ── ops/weekly-brief ──────────────────────────────────────────────────────────────────────────────── */

const KEY_NAMES = ["OPENAI_API_KEY", "COMPANY_BRAIN_OPENAI_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_MODEL"];

/** Runs fn with the model keys cleared (or one fake key set) and fetch replaced by a stand-in. */
async function withModelEnv({ anthropicKey = null, fetchAnswer = null } = {}, fn) {
  const saved = Object.fromEntries(KEY_NAMES.map((name) => [name, process.env[name]]));
  const realFetch = globalThis.fetch;
  const fetched = [];
  for (const name of KEY_NAMES) delete process.env[name];
  if (anthropicKey) process.env.ANTHROPIC_API_KEY = anthropicKey;
  globalThis.fetch = async (url, init) => {
    fetched.push({ url: String(url), init });
    if (fetchAnswer && String(url).startsWith("https://api.anthropic.com/")) return fetchAnswer;
    throw new Error(`the test refuses a real network call to ${url}`);
  };
  try {
    return await fn({ fetched });
  } finally {
    globalThis.fetch = realFetch;
    for (const name of KEY_NAMES) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
}

function briefWorld({ connections = [], pages = [], videos = [], brainFiles = [] } = {}) {
  const attribution = [
    { org_id: ORG_ID, lane: "funding600", ad_id: "16", variant: "sun", leads: 10, books: 4, first_lead_at: null, last_lead_at: null, first_book_at: null, last_book_at: null, payments: 0, paid_cents: null, payments_amount_unknown: 0 },
    { org_id: ORG_ID, lane: "uwiq", ad_id: "26", variant: "sun", leads: 5, books: 1, first_lead_at: null, last_lead_at: null, first_book_at: null, last_book_at: null, payments: 0, paid_cents: null, payments_amount_unknown: 0 },
    { org_id: OTHER_ORG_ID, lane: "wl", ad_id: "99", variant: null, leads: 700, books: 700, first_lead_at: null, last_lead_at: null, first_book_at: null, last_book_at: null, payments: 0, paid_cents: null, payments_amount_unknown: 0 },
  ];
  const world = { rollups: [], inserts: [], updates: [], brainFiles, pageReads: [], videoReads: [] };
  world.rules = [
    [/FROM client_ad_attribution a/, (sql, params) => {
      world.rollups.push({ sql, params });
      return attribution.filter((r) => r.org_id === params[0]).map(({ org_id: _o, ...rest }) => rest);
    }],
    [/FROM analytics_connections\s+WHERE org_id = \$1 AND platform = 'clickfunnels'/, (sql, params) =>
      connections.filter((c) => c.org_id === params[0] && c.platform === "clickfunnels")],
    [/FROM analytics_connections\s+WHERE org_id = \$1 AND platform = 'youtube'/, (sql, params) =>
      connections.filter((c) => c.org_id === params[0] && c.platform === "youtube")],
    [/DISTINCT ON \(clickfunnels_page_id\)/, (sql, params) => { world.pageReads.push({ sql, params }); return pages.filter((p) => p.org_id === params[0]); }],
    [/DISTINCT ON \(youtube_video_id\)/, (sql, params) => { world.videoReads.push({ sql, params }); return videos.filter((v) => v.org_id === params[0]); }],
    [/^\s*SELECT id, content_sha256 FROM brain_files WHERE org_id = \$1 AND drive_file_id = \$2/, (sql, params) =>
      brainFiles.filter((f) => f.org_id === params[0] && f.drive_file_id === params[1])],
    [/^\s*INSERT INTO brain_files/, (sql, params) => {
      const row = { id: "bf-1", org_id: params[0], drive_file_id: params[1], name: params[2], access_tier: params[3], content_sha256: params[4] };
      world.inserts.push({ sql, params, row });
      brainFiles.push(row);
      return [{ id: row.id }];
    }],
    [/^\s*UPDATE brain_files SET\s+name = \$2/, (sql, params) => { world.updates.push({ sql, params }); return []; }],
  ];
  return world;
}

const TO = "2026-10-11T12:00:00.000Z";

test("POST ops/weekly-brief builds the numbers for this company's last 7 days, never invents a source that is not connected, and files the brief into the brain as an owner-tier page", async () => {
  const world = briefWorld({
    connections: [
      { org_id: ORG_ID, platform: "clickfunnels", connection_state: "active", last_synced_at: "2026-10-10T09:00:00.000Z", last_error: null },
      { org_id: ORG_ID, platform: "youtube", connection_state: "error", last_synced_at: null, last_error: "token expired" },
    ],
    pages: [
      { org_id: ORG_ID, funnel_name: "Funding", page_name: "Watch", stat_date: "2026-10-09", views: 120, conversions: 9 },
      { org_id: ORG_ID, funnel_name: "Funding", page_name: "Apply", stat_date: "2026-10-09", views: null, conversions: null },
      { org_id: OTHER_ORG_ID, funnel_name: "Not ours", page_name: "Secret", stat_date: "2026-10-09", views: 5000, conversions: 500 },
    ],
  });
  const result = await withModelEnv({}, () => call(weeklyBriefHandler, { method: "POST", body: { to: TO }, rules: world.rules }));
  assert.equal(result.status, 200);
  const b = result.body;
  assert.equal(b.ok, true);
  assert.equal(b.sourceKey, "2026-w41");
  assert.equal(b.modelUsed, false);
  assert.equal(b.chunkCount, 0, "no embedding key on this run: nothing is chunked, and the answer says 0");
  assert.match(b.brief, /^# Weekly ops brief — 2026-10-04 to 2026-10-11/);
  assert.match(b.brief, /15 leads, 5 booked calls, across 2 lane\(s\)\./, "this company's numbers only");
  assert.match(b.brief, /- funding600: 10 leads, 4 booked \(40\.0%\)/);
  assert.match(b.brief, /- Funding \/ Watch: 120 views, 9 conversions \(pulled 2026-10-09\)/);
  assert.match(b.brief, /- Funding \/ Apply: unknown views, unknown conversions/, "a number nobody pulled is unknown, never 0");
  assert.doesNotMatch(b.brief, /Not ours|Secret|700/);
  assert.match(b.brief, /## VSL watch time \(YouTube\)\nNot available: YouTube connection state: error\./);
  assert.match(b.brief, /## Features shipped\nNot available: no PR data source wired in\./);
  assert.match(b.brief, /No model was available to write this section, so only the numbers above are shown\./);

  assert.deepEqual(world.rollups[0].params, [ORG_ID, "2026-10-04T12:00:00.000Z", TO], "the 7 days ending at the date asked for, for this company");
  assert.deepEqual(world.pageReads[0].params, [ORG_ID, "2026-10-04", "2026-10-11"]);
  assertSqlHas(world.pageReads[0].sql, { latestPerPage: "ORDER BY clickfunnels_page_id, stat_date DESC", company: "WHERE org_id = $1" });
  assert.equal(world.videoReads.length, 0, "a source in an error state is not read");

  assert.equal(world.inserts.length, 1);
  assert.deepEqual(world.inserts[0].params, [
    ORG_ID, "generated:weekly-ops-brief:2026-w41", "Weekly ops brief — 2026-w41", "owner", sha256(b.brief),
  ], "filed under this company, as an owner-tier page, holding exactly the brief that was returned");
  assertSqlHas(world.inserts[0].sql, { generated: "'generated'" });
  assert.deepEqual(sqlCalls(result, /FROM analytics_connections/).map((c) => c.params), [[ORG_ID], [ORG_ID]]);
  // The numbers come back as canned rows, so the statements are pinned as sent: this company's leads in the
  // window (cancelled bookings not counted, demo payments out), the connection of each source, the latest
  // row per page in the window (the window's end day not included), most views first, ten at most; and the
  // document is looked up and filed under this company.
  assertSent(result, "ads.rollup", "brief.cf_connection", "brief.yt_connection", "brief.pages", "brain.file_find", "brain.file_insert");
  assert.match(b.brief, /\n- uwiq: 5 leads, 1 booked \(20\.0%\)/, "every lane is listed, in the order of the folded groups");
});

test("POST ops/weekly-brief files a CHANGED brief for the same week over the old document, as an owner-tier page, and does not make a second one", async () => {
  const filed = { id: "bf-9", org_id: ORG_ID, drive_file_id: "generated:weekly-ops-brief:2026-w41", content_sha256: sha256("an older brief") };
  const world = briefWorld({ brainFiles: [filed] });
  const result = await withModelEnv({}, () => call(weeklyBriefHandler, { method: "POST", body: { to: TO }, rules: world.rules }));
  assert.equal(result.status, 200);
  assert.equal(world.inserts.length, 0, "the week already has its document, so none is made");
  assert.equal(world.updates.length, 1, "the changed words are saved over it");
  assert.deepEqual(world.updates[0].params, ["bf-9", "Weekly ops brief — 2026-w41", "owner", sha256(result.body.brief)],
    "the same file, still owner-tier, holding exactly the brief that was returned");
  assertSent(result, "brain.file_find", "brain.file_update");
  assert.deepEqual(sentStatement(result, "brain.file_find").params, [ORG_ID, "generated:weekly-ops-brief:2026-w41"]);
});

test("POST ops/weekly-brief says a source is not available for every state but active, and never reads a page or video row from it", async () => {
  for (const state of ["error", "paused", "pending", "disconnected", "needs_reauth"]) {
    const world = briefWorld({
      connections: [
        { org_id: ORG_ID, platform: "clickfunnels", connection_state: state, last_synced_at: null },
        { org_id: ORG_ID, platform: "youtube", connection_state: state, last_synced_at: null },
      ],
      pages: [{ org_id: ORG_ID, funnel_name: "Funding", page_name: "Watch", stat_date: "2026-10-09", views: 120, conversions: 9 }],
      videos: [{ org_id: ORG_ID, video_title: "The VSL", stat_date: "2026-10-09", views: 77, minutes_watched: 12.4 }],
    });
    const result = await withModelEnv({}, () => call(weeklyBriefHandler, { method: "POST", body: { to: TO }, rules: world.rules }));
    assert.equal(result.status, 200);
    assert.match(result.body.brief, new RegExp(`## Funnel pages \\(ClickFunnels\\)\\nNot available: ClickFunnels connection state: ${state}\\.`), state);
    assert.match(result.body.brief, new RegExp(`## VSL watch time \\(YouTube\\)\\nNot available: YouTube connection state: ${state}\\.`), state);
    assert.doesNotMatch(result.body.brief, /Watch: 120 views|The VSL/, "a source that is not active is never read");
    assert.equal(world.pageReads.length + world.videoReads.length, 0);
  }
  const none = briefWorld();
  const unconnected = await withModelEnv({}, () => call(weeklyBriefHandler, { method: "POST", body: { to: TO }, rules: none.rules }));
  assert.match(unconnected.body.brief, /Not available: ClickFunnels is not connected yet\./);
  assert.match(unconnected.body.brief, /Not available: YouTube is not connected yet\./);
});

test("POST ops/weekly-brief reads YouTube watch time as the latest row per video in the window when it is connected, most views first, unknown minutes stay unknown", async () => {
  const world = briefWorld({
    connections: [{ org_id: ORG_ID, platform: "youtube", connection_state: "active", last_synced_at: "2026-10-10T09:00:00.000Z" }],
    videos: [
      { org_id: ORG_ID, video_title: "The VSL", stat_date: "2026-10-09", views: 77, minutes_watched: "412.6" },
      { org_id: ORG_ID, video_title: "Short one", stat_date: "2026-10-08", views: null, minutes_watched: null },
      { org_id: OTHER_ORG_ID, video_title: "Not ours", stat_date: "2026-10-09", views: 9999, minutes_watched: 9999 },
    ],
  });
  const result = await withModelEnv({}, () => call(weeklyBriefHandler, { method: "POST", body: { to: TO }, rules: world.rules }));
  assert.equal(result.status, 200);
  assert.match(result.body.brief, /- The VSL: 77 views, 413 minutes watched \(pulled 2026-10-09\)/);
  assert.match(result.body.brief, /- Short one: unknown views, unknown watched \(pulled 2026-10-08\)/);
  assert.doesNotMatch(result.body.brief, /Not ours/);
  assert.deepEqual(world.videoReads[0].params, [ORG_ID, "2026-10-04", "2026-10-11"]);
  assertSent(result, "brief.yt_connection", "brief.videos");
});

test("POST ops/weekly-brief adds the model's short write-up under What to do when a model answers, from the numbers only, and a re-run of the same week files one document", async () => {
  const world = briefWorld({
    connections: [{ org_id: ORG_ID, platform: "clickfunnels", connection_state: "active", last_synced_at: "2026-10-10T09:00:00.000Z" }],
  });
  const answer = {
    ok: true, status: 200,
    json: async () => ({ content: [{ type: "text", text: "Working: funding600 books 40% of leads. Next: look at the uwiq hook." }], usage: { input_tokens: 400, output_tokens: 40 } }),
  };
  const first = await withModelEnv({ anthropicKey: "fake-model-key-not-real", fetchAnswer: answer }, async ({ fetched }) => {
    const out = await call(weeklyBriefHandler, { method: "POST", body: { to: TO }, rules: world.rules });
    assert.equal(fetched.length, 1, "one model call for the whole brief");
    const sent = JSON.parse(fetched[0].init.body);
    assert.match(sent.messages[0].content[0]?.text ?? sent.messages[0].content, /## Ad performance/, "the model is handed the numbers section");
    assert.match(sent.system, /never invent a number/);
    return out;
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.modelUsed, true);
  assert.match(first.body.brief, /## What to do\n\nWorking: funding600 books 40% of leads\. Next: look at the uwiq hook\.$/);
  assert.equal(world.inserts[0].params[4], sha256(first.body.brief));

  // the same week again with the same words: one document, nothing filed twice
  const second = await withModelEnv({ anthropicKey: "fake-model-key-not-real", fetchAnswer: answer }, () =>
    call(weeklyBriefHandler, { method: "POST", body: { to: TO }, rules: world.rules }));
  assert.equal(second.status, 200);
  assert.equal(world.inserts.length, 1, "the same week is the same document");
  assert.equal(world.updates.length, 0, "and unchanged words are not saved again");
  assert.equal(second.body.sourceKey, first.body.sourceKey);

  // a different company's file with the same key is not this company's
  const foreign = briefWorld({ brainFiles: [{ id: "bf-x", org_id: OTHER_ORG_ID, drive_file_id: "generated:weekly-ops-brief:2026-w41", content_sha256: sha256(first.body.brief) }] });
  const third = await withModelEnv({ anthropicKey: "fake-model-key-not-real", fetchAnswer: answer }, () =>
    call(weeklyBriefHandler, { method: "POST", body: { to: TO }, rules: foreign.rules }));
  assert.equal(third.status, 200);
  assert.equal(foreign.inserts.length, 1, "another company's document does not stand in for this company's");
});

test("POST ops/weekly-brief refuses a bad date, a session with no company, a GET, a database failure (the address is scrubbed out of the answer), and any role that is not staff", async () => {
  const world = briefWorld();
  await withModelEnv({}, async () => {
    const badDate = await call(weeklyBriefHandler, { method: "POST", body: { to: "last tuesday" }, rules: world.rules });
    assert.equal(badDate.status, 400);
    assert.deepEqual(badDate.body, { ok: false, error: "to must be an ISO date" });
    assert.equal(world.rollups.length, 0, "nothing is read for a refused date");

    const noCompany = await call(weeklyBriefHandler, { method: "POST", body: {}, staff: { org_id: null }, rules: world.rules });
    assert.equal(noCompany.status, 403);

    const get = await call(weeklyBriefHandler, { method: "GET", rules: world.rules });
    assert.equal(get.status, 405);
    assert.equal(world.inserts.length, 0);

    const broken = await call(weeklyBriefHandler, {
      method: "POST", body: { to: TO },
      rules: [[/FROM client_ad_attribution/, new Error("password authentication failed for user fundhub at 10.0.0.9")]],
    });
    assert.equal(broken.status, 500);
    assert.equal(broken.body.ok, false);
    assert.doesNotMatch(JSON.stringify(broken.body), /10\.0\.0\.9/, "the database's address never reaches the caller");
    assert.match(broken.body.error, /\[redacted\]/);

    await assertRoleGate(weeklyBriefHandler, STAFF_ROLES, { method: "POST", body: { to: TO }, rules: briefWorld().rules });
  });
});

/* ── partner-addons (GET) ──────────────────────────────────────────────────────────────────────────── */

function addonWorld({ partners, subs = [], links = [] }) {
  const seen = { subs: null, links: null, owns: null };
  const rules = [
    [/^\s*SELECT 1 FROM partners WHERE id = \$1 AND org_id = \$2/, (sql, params) => { seen.owns = { sql, params }; return rowsWhere(partners, sql, params).map(() => ({ "?column?": 1 })); }],
    [/FROM subscriptions\s+WHERE org_id = \$1 AND partner_id = \$2 AND client_id IS NULL/, (sql, params) => { seen.subs = { sql, params }; return rowsWhere(subs, sql, params); }],
    [/^\s*SELECT \* FROM payment_links WHERE org_id = \$1 AND partner_id = \$2/, (sql, params) => { seen.links = { sql, params }; return rowsWhere(links, sql, params); }],
  ];
  return { rules, seen };
}

test("GET partner-addons answers the add-on catalog with each one's status for this partner, its live plan, its history and its orders, with prices as exact strings", async () => {
  const day = (iso) => new Date(iso);
  const subs = [
    { id: "s-live", org_id: ORG_ID, partner_id: PARTNER_ID, client_id: null, tier: "creative-intelligence", status: "active", price_cents: 29700, effective_from: day("2026-09-01T00:00:00.000Z"), effective_to: null, cancelled_at: null, next_charge_at: day("2026-11-01T00:00:00.000Z"), created_at: day("2026-09-01T00:00:00.000Z") },
    { id: "s-old", org_id: ORG_ID, partner_id: PARTNER_ID, client_id: null, tier: "dfy-marketing", status: "cancelled", price_cents: 249700, effective_from: day("2026-06-01T00:00:00.000Z"), effective_to: day("2026-08-01T00:00:00.000Z"), cancelled_at: day("2026-08-01T00:00:00.000Z"), next_charge_at: null, created_at: day("2026-06-01T00:00:00.000Z") },
    { id: "s-other-partner", org_id: ORG_ID, partner_id: OTHER_PARTNER, client_id: null, tier: "lead-flow", status: "active", price_cents: 9900, effective_from: day("2026-09-01T00:00:00.000Z"), effective_to: null, cancelled_at: null, next_charge_at: null, created_at: day("2026-09-01T00:00:00.000Z") },
  ];
  const links = [
    { id: "l-1", org_id: ORG_ID, partner_id: PARTNER_ID, status: "sent", amount_cents: 29700, paid_amount_cents: null, created_at: day("2026-09-30T00:00:00.000Z") },
    { id: "l-2", org_id: ORG_ID, partner_id: PARTNER_ID, status: "paid", amount_cents: 19800, paid_amount_cents: 19800, created_at: day("2026-09-29T00:00:00.000Z") },
    { id: "l-other", org_id: ORG_ID, partner_id: OTHER_PARTNER, status: "paid", amount_cents: 1, paid_amount_cents: 1, created_at: day("2026-09-29T00:00:00.000Z") },
  ];
  const world = addonWorld({ partners: [{ id: PARTNER_ID, org_id: ORG_ID }, { id: OTHER_PARTNER, org_id: OTHER_ORG_ID }], subs, links });
  const result = await call(partnerAddonsHandler, { query: { partner_id: PARTNER_ID }, rules: world.rules });
  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.partner_id, PARTNER_ID);
  const byCode = Object.fromEntries(result.body.catalog.map((a) => [a.code, a]));
  assert.equal(byCode["creative-intelligence"].status, "active");
  assert.equal(byCode["creative-intelligence"].subscription_id, "s-live");
  assert.equal(byCode["creative-intelligence"].price_display, "297.00");
  assert.equal(byCode["dfy-marketing"].status, "cancelled", "a past customer is not shown as never having had it");
  assert.equal(byCode["dfy-marketing"].subscription_id, null);
  assert.equal(byCode["dfy-marketing"].price_display, "2497.00");
  assert.equal(byCode["lead-flow"].status, "available", "another partner's plan does not make it theirs");
  assert.deepEqual(result.body.current.map((s) => [s.id, s.price_display]), [["s-live", "297.00"]]);
  assert.deepEqual(result.body.history.map((s) => s.id), ["s-live", "s-old"], "this partner's whole chain, not another's");
  assert.deepEqual(result.body.orders.map((o) => [o.id, o.amount_display, o.paid_amount_display]), [["l-1", "297.00", null], ["l-2", "198.00", "198.00"]], "an unpaid ask has no paid amount: unknown, never 0.00");

  assert.deepEqual(world.seen.owns.params, [PARTNER_ID, ORG_ID]);
  assertSqlHas(world.seen.owns.sql, { company: "WHERE id = $1 AND org_id = $2" });
  assert.deepEqual(world.seen.subs.params, [ORG_ID, PARTNER_ID]);
  assertSqlHas(world.seen.subs.sql, { company: "WHERE org_id = $1 AND partner_id = $2 AND client_id IS NULL" });
  assert.deepEqual(world.seen.links.params, [ORG_ID, PARTNER_ID]);
  noWrites(result);
  assert.equal(byCode["creative-intelligence"].next_charge_at.toISOString(), "2026-11-01T00:00:00.000Z", "a live plan shows when it is next charged");
  assert.equal(byCode["dfy-marketing"].next_charge_at, null, "a plan that is not live has no next charge");
  assert.equal(byCode["lead-flow"].next_charge_at, null);
  // The three reads: the partner must be this company's, the plan chain is this partner's own (not a
  // client's), newest first; the orders are this partner's asks, newest first.
  assertSent(result, "addons.owns", "addons.subs", "addons.links");
});

test("GET partner-addons shows a plan as the current one only while it is live: not once cancelled mid-term, not before it starts, not after it ends", async () => {
  const day = (iso) => new Date(iso);
  const sub = (id, tier, over) => ({
    id, org_id: ORG_ID, partner_id: PARTNER_ID, client_id: null, tier, status: "active", price_cents: 100,
    effective_from: day("2020-01-01T00:00:00.000Z"), effective_to: null, cancelled_at: null, next_charge_at: day("2099-01-01T00:00:00.000Z"),
    created_at: day("2020-01-01T00:00:00.000Z"), ...over,
  });
  const run = async (subs) => {
    const world = addonWorld({ partners: [{ id: PARTNER_ID, org_id: ORG_ID }], subs, links: [] });
    return call(partnerAddonsHandler, { query: { partner_id: PARTNER_ID }, rules: world.rules });
  };
  const statusOf = (result, code) => result.body.catalog.find((a) => a.code === code);

  const open = await run([sub("s1", "creative-intelligence", {})]);
  assert.deepEqual(open.body.current.map((s) => s.id), ["s1"], "no end date and not cancelled: live");
  assert.equal(statusOf(open, "creative-intelligence").status, "active");

  const later = await run([sub("s2", "creative-intelligence", { effective_to: day("2099-06-01T00:00:00.000Z") })]);
  assert.deepEqual(later.body.current.map((s) => s.id), ["s2"], "an end date still to come: live");

  const cancelled = await run([sub("s3", "creative-intelligence", { cancelled_at: day("2026-01-01T00:00:00.000Z") })]);
  assert.deepEqual(cancelled.body.current, [], "cancelled mid-term (no end date yet): not current");
  assert.equal(statusOf(cancelled, "creative-intelligence").status, "cancelled");
  assert.equal(statusOf(cancelled, "creative-intelligence").subscription_id, null);
  assert.equal(statusOf(cancelled, "creative-intelligence").next_charge_at, null);

  const notStarted = await run([sub("s4", "creative-intelligence", { effective_from: day("2099-01-01T00:00:00.000Z") })]);
  assert.deepEqual(notStarted.body.current, [], "a plan that has not started is not the current plan");
  assert.equal(statusOf(notStarted, "creative-intelligence").subscription_id, null);
  assert.equal(statusOf(notStarted, "creative-intelligence").next_charge_at, null);

  const ended = await run([sub("s5", "creative-intelligence", { effective_to: day("2021-01-01T00:00:00.000Z") })]);
  assert.deepEqual(ended.body.current, [], "an end date in the past: not current");
  assert.deepEqual(ended.body.history.map((s) => s.id), ["s5"], "but it stays in the history");
  assert.equal(statusOf(ended, "creative-intelligence").status, "cancelled");

  const tierCase = await run([sub("s6", "  Creative-Intelligence ", {})]);
  assert.equal(statusOf(tierCase, "creative-intelligence").status, "active", "the tier is matched ignoring case and spaces");
});

test("GET partner-addons refuses a partner of another company, a bad id and a missing company, and only owner and admin may read it", async () => {
  const world = addonWorld({ partners: [{ id: OTHER_PARTNER, org_id: OTHER_ORG_ID }] });
  const foreign = await call(partnerAddonsHandler, { query: { partner_id: OTHER_PARTNER }, rules: world.rules });
  assert.equal(foreign.status, 403);
  assert.deepEqual(foreign.body, { ok: false, error: "forbidden" });
  assert.equal(world.seen.subs, null, "nothing about the partner is read");
  const bad = await call(partnerAddonsHandler, { query: { partner_id: "nope" }, rules: world.rules });
  assert.equal(bad.status, 400);
  const noCompany = await call(partnerAddonsHandler, { query: { partner_id: PARTNER_ID }, staff: { org_id: null }, rules: world.rules });
  assert.equal(noCompany.status, 403);
  assert.equal(noCompany.body.error, "org_required");
  await assertRoleGate(partnerAddonsHandler, ["owner", "admin"], { query: { partner_id: PARTNER_ID }, rules: addonWorld({ partners: [{ id: PARTNER_ID, org_id: ORG_ID }] }).rules });
});

/* ── partner-marketing/copy-history ────────────────────────────────────────────────────────────────── */

function copyWorld({ pages, versions = [], suite = [{ partner_id: PARTNER_ID, marketing_suite_enabled: true, ai_token_cap_monthly: 250000, org_id: ORG_ID }] }) {
  const seen = { history: null, inserts: [], pageUpdates: [] };
  const rules = [
    [/^\s*SELECT id, partner_id FROM partner_pages WHERE id = \$1/, (sql, params) => rowsWhere(pages, sql, params).map(({ id, partner_id }) => ({ id, partner_id }))],
    [/^\s*SELECT \* FROM partner_pages WHERE id = \$1/, (sql, params) => rowsWhere(pages, sql, params).map((p) => ({ ...p }))],
    [/FROM partner_page_section_versions\s+WHERE page_id = \$1 AND \(\$2::text IS NULL OR section_id = \$2\)/, (sql, params) => {
      seen.history = { sql, params };
      return rowsWhere(versions, sql, params).slice(0, params[2]);
    }],
    [/^\s*SELECT marketing_suite_enabled, ai_token_cap_monthly, org_id\s+FROM partner_module_settings/, (sql, params) => rowsWhere(suite, sql, params)],
    [/^\s*SELECT \* FROM partner_page_section_versions\s+WHERE id = \$1 AND page_id = \$2 AND partner_id = \$3/, (sql, params) => rowsWhere(versions, sql, params)],
    [/^\s*INSERT INTO partner_page_section_versions/, (sql, params) => { seen.inserts.push({ sql, params }); return []; }],
    [/^\s*UPDATE partner_pages SET body_json = \$2::jsonb/, (sql, params) => { seen.pageUpdates.push({ sql, params }); return []; }],
  ];
  return { rules, seen };
}

const HERO_NOW = { id: "hero", type: "hero", headline: "Funding that fits.", locked: false };
const HERO_OLD = { id: "hero", type: "hero", headline: "Capital for your business.", locked: false };
const pageRow = (over = {}) => ({ id: PAGE_ID, org_id: ORG_ID, partner_id: PARTNER_ID, body_json: { sections: [HERO_NOW, { id: "faq", type: "faq" }] }, ...over });
const versionRow = (over = {}) => ({ id: VERSION_ID, org_id: ORG_ID, partner_id: PARTNER_ID, page_id: PAGE_ID, section_id: "hero", section_json: HERO_OLD, created_at: new Date("2026-10-10T10:00:00.000Z"), ...over });

test("GET partner-marketing/copy-history lists a page section's versions newest first for the owning partner or an owner, and refuses another partner and non-owner staff", async () => {
  const world = copyWorld({
    pages: [pageRow(), pageRow({ id: OTHER_PAGE, partner_id: OTHER_PARTNER })],
    versions: [
      versionRow({ created_at: new Date("2026-10-10T10:00:00.000Z") }),
      versionRow({ id: "d0000000-0000-4000-8000-0000000000e2", section_id: "faq", created_at: new Date("2026-10-11T10:00:00.000Z") }),
      versionRow({ id: "d0000000-0000-4000-8000-0000000000e3", page_id: OTHER_PAGE, partner_id: OTHER_PARTNER }),
    ],
  });
  const owner = await call(copyHistoryHandler, { query: { page_id: PAGE_ID }, rules: world.rules });
  assert.equal(owner.status, 200);
  assert.deepEqual(owner.body.items.map((v) => v.id), [VERSION_ID, "d0000000-0000-4000-8000-0000000000e2"], "this page's versions only");
  assert.deepEqual(world.seen.history.params, [PAGE_ID, null, 20]);
  assertSqlHas(world.seen.history.sql, { page: "WHERE page_id = $1", newestFirst: "ORDER BY created_at DESC", cap: "LIMIT $3" });
  const scope = sqlCalls(owner, /set_config\('fundhub\.actor'/)[0];
  assert.deepEqual(scope.params, ["staff"]);

  const oneSection = await call(copyHistoryHandler, { query: { page_id: PAGE_ID, section_id: "hero" }, rules: world.rules });
  assert.deepEqual(oneSection.body.items.map((v) => v.section_id), ["hero"]);
  assert.deepEqual(world.seen.history.params.slice(0, 2), [PAGE_ID, "hero"]);

  const mine = await call(copyHistoryHandler, { query: { page_id: PAGE_ID }, account: { kind: "partner", partnerId: PARTNER_ID }, rules: world.rules });
  assert.equal(mine.status, 200, "the partner who owns the page reads its history");
  assert.deepEqual(sqlCalls(mine, /set_config\('fundhub\.partner_id'/)[0].params, [PARTNER_ID], "the database is told which partner is reading");
  assert.deepEqual(sqlCalls(mine, /set_config\('fundhub\.actor'/)[0].params, ["partner"]);

  const calls = world.seen.history;
  const theirs = await call(copyHistoryHandler, { query: { page_id: OTHER_PAGE }, account: { kind: "partner", partnerId: PARTNER_ID }, rules: world.rules });
  assert.equal(theirs.status, 403);
  assert.deepEqual(theirs.body, { ok: false, error: "forbidden" });
  assert.equal(world.seen.history, calls, "another partner's history is never read");

  assertSent(owner, "copy.page_ref", "copy.history");
  assert.equal(sentStatement(owner, "copy.history").sql.includes("created_at DESC"), true);

  const closer = await call(copyHistoryHandler, { query: { page_id: PAGE_ID }, role: "closer", rules: world.rules });
  assert.equal(closer.status, 403, "staff who are not owner or admin cannot read a partner's copy history");

  const missing = await call(copyHistoryHandler, { query: { page_id: "d0000000-0000-4000-8000-0000000000ff" }, rules: world.rules });
  assert.equal(missing.status, 404);
  const noId = await call(copyHistoryHandler, { query: {}, rules: world.rules });
  assert.equal(noId.status, 400);
  assert.equal(noId.body.error, "page_id_required");
  const put = await call(copyHistoryHandler, { method: "PUT", rules: world.rules });
  assert.equal(put.status, 405);
  const client = await call(copyHistoryHandler, { query: { page_id: PAGE_ID }, account: { kind: "client", clientId: "c1000000-0000-4000-8000-000000000001" }, rules: world.rules });
  assert.equal(client.status, 403, "a client login is refused at the door");
  assert.match(client.body.message, /this endpoint serves staff, partner/, "refused by the door itself, before any page is read");
  assert.equal(sqlCalls(client, /FROM partner_pages/).length, 0);
});

test("POST partner-marketing/copy-history restores an earlier version of a section, keeping the current one as a version first, and refuses a locked block, a suite that is off, a missing version and another partner's page", async () => {
  const world = copyWorld({ pages: [pageRow(), pageRow({ id: OTHER_PAGE, partner_id: OTHER_PARTNER })], versions: [versionRow()] });
  const restored = await call(copyHistoryHandler, { method: "POST", body: { page_id: PAGE_ID, version_id: VERSION_ID }, rules: world.rules });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.ok, true);
  assert.deepEqual(restored.body.section, HERO_OLD);
  assert.deepEqual(restored.body.body.sections, [HERO_OLD, { id: "faq", type: "faq" }], "the old words are back in place, the rest of the page untouched");
  assert.equal(world.seen.inserts.length, 1);
  assert.deepEqual(world.seen.inserts[0].params, [ORG_ID, PARTNER_ID, PAGE_ID, "hero", JSON.stringify(HERO_NOW)], "what was live is kept as a version first, so the restore can be undone");
  assert.equal(world.seen.pageUpdates.length, 1);
  assert.equal(world.seen.pageUpdates[0].params[0], PAGE_ID);
  assert.deepEqual(JSON.parse(world.seen.pageUpdates[0].params[1]).sections[0], HERO_OLD);
  const lookup = sqlCalls(restored, /FROM partner_page_section_versions/)[0];
  assert.deepEqual(lookup.params, [VERSION_ID, PAGE_ID, PARTNER_ID]);
  assertSqlHas(lookup.sql, { partner: "AND partner_id = $3", page: "page_id = $2" });
  // The restore writes ONE page. The stand-in answers the UPDATE whatever its WHERE says, so the statement
  // is pinned as sent: by the page's id, never a bare write that would touch every partner page.
  assertSent(restored, "copy.page_full", "copy.suite", "copy.version", "copy.version_insert", "copy.restore_page");
  assert.equal(world.seen.pageUpdates[0].params.length, 2);

  const off = copyWorld({ pages: [pageRow()], versions: [versionRow()], suite: [{ partner_id: PARTNER_ID, marketing_suite_enabled: false, ai_token_cap_monthly: 1, org_id: ORG_ID }] });
  const suiteOff = await call(copyHistoryHandler, { method: "POST", body: { page_id: PAGE_ID, version_id: VERSION_ID }, rules: off.rules });
  assert.equal(suiteOff.status, 403);
  assert.equal(suiteOff.body.error, "suite_off");
  assert.equal(off.seen.pageUpdates.length, 0);

  const locked = copyWorld({ pages: [pageRow()], versions: [versionRow({ section_json: { ...HERO_OLD, locked: true } })] });
  const lockedAnswer = await call(copyHistoryHandler, { method: "POST", body: { page_id: PAGE_ID, version_id: VERSION_ID }, rules: locked.rules });
  assert.equal(lockedAnswer.status, 400);
  assert.equal(lockedAnswer.body.error, "locked_section");
  assert.equal(locked.seen.pageUpdates.length, 0);

  const noVersion = copyWorld({ pages: [pageRow()], versions: [] });
  const gone = await call(copyHistoryHandler, { method: "POST", body: { page_id: PAGE_ID, version_id: VERSION_ID }, rules: noVersion.rules });
  assert.equal(gone.status, 404);

  const otherPartner = await call(copyHistoryHandler, {
    method: "POST", body: { page_id: OTHER_PAGE, version_id: VERSION_ID }, account: { kind: "partner", partnerId: PARTNER_ID }, rules: world.rules,
  });
  assert.equal(otherPartner.status, 403);
  assert.equal(world.seen.pageUpdates.length, 1, "another partner's page is not changed");

  const closer = await call(copyHistoryHandler, { method: "POST", body: { page_id: PAGE_ID, version_id: VERSION_ID }, role: "closer", rules: world.rules });
  assert.equal(closer.status, 403);
  const badIds = await call(copyHistoryHandler, { method: "POST", body: { page_id: "x", version_id: "y" }, rules: world.rules });
  assert.equal(badIds.status, 400);
  assert.equal(badIds.body.error, "page_id_and_version_id_required");
});

test("POST partner-marketing/copy-history puts a section back when the page no longer has it, with no version kept for a section that was not there", async () => {
  const noHero = pageRow({ body_json: { sections: [{ id: "faq", type: "faq" }] } });
  const world = copyWorld({ pages: [noHero], versions: [versionRow()] });
  const result = await call(copyHistoryHandler, { method: "POST", body: { page_id: PAGE_ID, version_id: VERSION_ID }, rules: world.rules });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.body.sections, [{ id: "faq", type: "faq" }, HERO_OLD], "the old section is added back");
  assert.equal(world.seen.inserts.length, 0, "nothing was on the page to keep as a version");
  assert.equal(world.seen.pageUpdates.length, 1);
  assert.deepEqual(JSON.parse(world.seen.pageUpdates[0].params[1]).sections, [{ id: "faq", type: "faq" }, HERO_OLD]);
});

test("the section history list holds at most 50 versions and at least 1, whatever limit is asked for, and 20 when none is", async () => {
  const asked = [];
  const db = { query: async (_sql, params) => { asked.push(params[2]); return { rows: [] }; } };
  await listSectionHistory(db, { pageId: PAGE_ID });
  await listSectionHistory(db, { pageId: PAGE_ID, limit: 100 });
  await listSectionHistory(db, { pageId: PAGE_ID, limit: 7 });
  await listSectionHistory(db, { pageId: PAGE_ID, limit: -5 });
  await listSectionHistory(db, { pageId: PAGE_ID, limit: "abc" });
  await listSectionHistory(db, { pageId: PAGE_ID, limit: 0 });
  assert.deepEqual(asked, [20, 50, 7, 1, 20, 20]);
});
