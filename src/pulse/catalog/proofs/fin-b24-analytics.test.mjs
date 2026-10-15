// Batch 24 (finish the 853), the staff analytics connect and sync doors:
// ClickFunnels and YouTube.
//
// The real api/ handlers, the real encryption, the real adapters, a stand-in
// database that keeps its own connection and stats rows, and a stand-in for the
// vendor's web address (handed in through the handler's own seam). Nothing
// leaves the building and no real key is used. This is a PRACTICE TEST with fake
// data. It is not a live check.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before } from "node:test";

import clickfunnelsConnect from "../../../../api/analytics/clickfunnels-connect.mjs";
import clickfunnelsSync from "../../../../api/analytics/clickfunnels-sync.mjs";
import youtubeConnect from "../../../../api/analytics/youtube-connect.mjs";
import youtubeSync from "../../../../api/analytics/youtube-sync.mjs";
import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { decryptToken, encryptToken } from "../../../adplatforms/tokens.mjs";
import { ORG_ID, OTHER_ORG_ID, assertRoleGate, hit, sqlCalls } from "./s5-route-kit.mjs";
import { returned } from "./fin-b24-repair-kit.mjs";

const keyName = "AD_TOKEN_ENC_KEY";
let savedKey;
before(() => {
  savedKey = process.env[keyName];
  process.env[keyName] = crypto.randomBytes(32).toString("base64");
});
after(() => {
  if (savedKey === undefined) delete process.env[keyName]; else process.env[keyName] = savedKey;
});

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const GOOD_KEY = ["cf", "fake", "key"].join("-");

/* ── ClickFunnels ────────────────────────────────────────────────────────── */

function fakeClickFunnels({ stats = null, statsStatus = 200, fail = null } = {}) {
  const seen = [];
  const fn = async (url, init = {}) => {
    const u = new URL(String(url));
    seen.push({ path: u.pathname, search: u.search, auth: init.headers?.authorization });
    if (init.headers?.authorization !== `Bearer ${GOOD_KEY}`) return json(401, { error: "API key missing or invalid" });
    if (fail && u.pathname.endsWith(fail.path)) return json(fail.status, { error: fail.message });
    if (u.pathname.endsWith("/teams")) return json(200, [{ id: 1, name: "Team" }]);
    if (u.pathname.endsWith("/workspaces")) return json(200, [{ id: 10, subdomain: "goodshop" }]);
    if (u.pathname.endsWith("/funnels")) return json(200, [{ id: 5, name: "Main Funnel" }, { id: 6, name: "Second Funnel" }]);
    if (u.pathname.endsWith("/pages")) {
      const funnel = u.searchParams.get("filter[funnel_ids]");
      return json(200, funnel === "5" ? [{ id: 100, name: "Order Page" }, { id: 101, name: "Thank You" }] : [{ id: 200, name: "Upsell" }]);
    }
    if (u.pathname.endsWith("/stats")) {
      const page = u.pathname.split("/").at(-2);
      if (stats && stats[page] === "gone") return json(404, { error: "stats not available" });
      if (stats && stats[page] === "no-step") return json(200, { funnel: null, step: null });
      const step = stats?.[page] || { views_all: 42, optins: 7 };
      return json(statsStatus, { step });
    }
    throw new Error(`unexpected address ${u}`);
  };
  fn.seen = seen;
  return fn;
}

test("clickfunnels-connect proves the key against ClickFunnels first, then saves it encrypted for this company's connection and returns only the id, the workspace and the state", async () => {
  assert.equal(ROUTES["analytics/clickfunnels-connect"], clickfunnelsConnect);
  const cf = fakeClickFunnels();
  // The stand-in answers only the columns the statement's own RETURNING list names (repair cycle 1): it used
  // to hand back the ciphertext too, which let a leak of it through RETURNING * pass.
  const insert = [/INSERT INTO analytics_connections/, (sql, p) => returned(sql, { id: "cn-1", org_id: p[0], external_account_id: p[1], connection_state: "active", encrypted_credentials: p[2], last_error: null })];
  const done = await hit(clickfunnelsConnect, { method: "POST", role: "closer", body: { api_key: ` ${GOOD_KEY} `, subdomain: " GoodShop " }, deps: { fetch: cf }, rules: [insert] });
  assert.equal(done.status, 200);
  assert.deepEqual(Object.keys(done.body.connection).sort(), ["connection_state", "external_account_id", "id"], "only what the handler's RETURNING list names, never the ciphertext");
  assert.equal(done.body.connection.external_account_id, "goodshop", "the workspace name is lowercased");
  const [call] = sqlCalls(done, /INSERT INTO analytics_connections/);
  assert.equal(call.params[0], ORG_ID, "one connection for the signed-in company");
  assert.equal(call.params[1], "goodshop");
  assert.deepEqual(JSON.parse(decryptToken(call.params[2], { partnerId: ORG_ID })), { api_key: GOOD_KEY, subdomain: "goodshop" });
  assert.throws(() => decryptToken(call.params[2], { partnerId: OTHER_ORG_ID }), undefined, "another company cannot read it");
  assert.match(call.sql, /VALUES \(\$1, 'clickfunnels', \$2, \$3, 'active', NULL\)/, "a proven key is saved as active, with no old error");
  assert.match(call.sql, /ON CONFLICT \(org_id, platform\) DO UPDATE SET/);
  assert.match(call.sql, /connection_state\s+= 'active',\s+last_error\s+= NULL/);
  assert.ok(cf.seen.length >= 3, "ClickFunnels was asked before anything was saved");
  assert.ok(cf.seen.every((s) => s.auth === `Bearer ${GOOD_KEY}`));
  assert.equal(done.db.calls.findIndex((c) => /INSERT INTO analytics_connections/.test(c.sql)) > done.db.calls.findIndex((c) => /FROM live JOIN staff/.test(c.sql)), true);
});

test("clickfunnels-connect saves nothing and says ClickFunnels' own words when the key is refused, and refuses a missing key or a subdomain that is not a name", async () => {
  const cf = fakeClickFunnels();
  const wrong = await hit(clickfunnelsConnect, { method: "POST", body: { api_key: "wrong-key", subdomain: "goodshop" }, deps: { fetch: cf }, rules: [] });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error, "clickfunnels_rejected");
  assert.equal(wrong.body.message, "API key missing or invalid");
  assert.equal(sqlCalls(wrong, /INSERT INTO analytics_connections/).length, 0);

  for (const [body, error] of [
    [{ subdomain: "goodshop" }, "api_key_required"],
    [{ api_key: GOOD_KEY, subdomain: "" }, "subdomain_invalid"],
    [{ api_key: GOOD_KEY, subdomain: "evil.example/x" }, "subdomain_invalid"],
    [{ api_key: GOOD_KEY, subdomain: "-".repeat(64) }, "subdomain_invalid"],
  ]) {
    const net = fakeClickFunnels();
    const out = await hit(clickfunnelsConnect, { method: "POST", body, deps: { fetch: net }, rules: [] });
    assert.equal(out.status, 400, error);
    assert.equal(out.body.error, error);
    assert.equal(net.seen.length, 0, "nothing is asked of ClickFunnels for a body that is not a request");
    assert.equal(sqlCalls(out, /INSERT INTO analytics_connections/).length, 0);
  }
  const get = await hit(clickfunnelsConnect, { method: "GET", rules: [] });
  assert.equal(get.status, 405);
});

test("clickfunnels-connect is for staff only and refuses a partner or client login before anything is asked or saved", async () => {
  const cf = fakeClickFunnels();
  await assertRoleGate(clickfunnelsConnect, ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"], {
    method: "POST", body: { api_key: GOOD_KEY, subdomain: "goodshop" }, deps: { fetch: cf },
    rules: [[/INSERT INTO analytics_connections/, [{ id: "cn-1", external_account_id: "goodshop", connection_state: "active" }]]],
  });
  const signedOut = await hit(clickfunnelsConnect, { anonymous: true, method: "POST", body: { api_key: GOOD_KEY, subdomain: "goodshop" }, deps: { fetch: cf }, rules: [] });
  assert.equal(signedOut.status, 401);
});

function syncWorld({ credsFor = ORG_ID, state = "active", orgOf = ORG_ID, noConnection = false } = {}) {
  const encrypted = encryptToken(JSON.stringify({ api_key: GOOD_KEY, subdomain: "goodshop" }), { partnerId: credsFor });
  const world = { stats: [], updates: [] };
  world.rules = [
    [/SELECT \* FROM analytics_connections WHERE org_id = \$1 AND platform = 'clickfunnels'/, (_sql, p) =>
      (noConnection || p[0] !== orgOf ? [] : [{ id: "cn-1", org_id: orgOf, platform: "clickfunnels", encrypted_credentials: encrypted, connection_state: state }])],
    [/INSERT INTO funnel_page_stats/, (_sql, p) => { world.stats.push({ org: p[0], conn: p[1], funnel: p[2], page: p[3], funnel_name: p[4], page_name: p[5], date: p[6], views: p[7], conversions: p[8] }); return []; }],
    [/UPDATE analytics_connections/, (sql, p) => { world.updates.push({ sql, params: p }); return []; }],
  ];
  return world;
}

test("clickfunnels-sync saves one stats row for every page of every funnel for this company, unknown numbers as NULL and never 0, and marks the connection synced", async () => {
  assert.equal(ROUTES["analytics/clickfunnels-sync"], clickfunnelsSync);
  const cf = fakeClickFunnels({ stats: { 100: { views_all: 42, optins: 7 }, 101: "gone", 200: "no-step" } });
  const world = syncWorld();
  const done = await hit(clickfunnelsSync, { method: "POST", role: "admin", body: { days: 30 }, deps: { fetch: cf }, rules: world.rules });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { ok: true, pages_synced: 3, stats_available: true });
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(world.stats.map((s) => [s.page, s.page_name, s.funnel_name, s.views, s.conversions]), [
    ["100", "Order Page", "Main Funnel", 42, 7],
    ["101", "Thank You", "Main Funnel", null, null],
    ["200", "Upsell", "Second Funnel", null, null],
  ]);
  assert.ok(world.stats.every((s) => s.org === ORG_ID && s.conn === "cn-1" && s.date === today), "this company's connection, stamped with today");
  assert.match(sqlCalls(done, /INSERT INTO funnel_page_stats/)[0].sql, /ON CONFLICT \(connection_id, clickfunnels_page_id, stat_date\) DO UPDATE/);
  const finish = world.updates.at(-1);
  assert.match(finish.sql, /last_synced_at = now\(\), last_error = NULL, connection_state = 'active'/);
  assert.deepEqual(finish.params, ["cn-1"]);
  const statCall = cf.seen.find((s) => s.path.endsWith("/pages/100/stats"));
  const start = new Date(new URL(`https://x${statCall.search}`).searchParams.get("timerange_start"));
  const end = new Date(new URL(`https://x${statCall.search}`).searchParams.get("timerange_end"));
  assert.equal(Math.round((end - start) / 86400000), 30, "the window is the days asked for");
  assert.deepEqual(sqlCalls(done, /SELECT \* FROM analytics_connections/)[0].params, [ORG_ID]);

  // The window is capped at 90 days, and falls back to 7 for nonsense.
  for (const [days, want] of [[500, 90], ["abc", 7], [0, 7], [undefined, 7]]) {
    const net = fakeClickFunnels();
    await hit(clickfunnelsSync, { method: "POST", body: { days }, deps: { fetch: net }, rules: syncWorld().rules });
    const q = net.seen.find((s) => s.path.endsWith("/stats"));
    const params = new URL(`https://x${q.search}`).searchParams;
    assert.equal(Math.round((new Date(params.get("timerange_end")) - new Date(params.get("timerange_start"))) / 86400000), want, String(days));
  }
});

test("clickfunnels-sync keeps the pages already saved, marks the connection as an error with ClickFunnels' words, and answers 502 when the pull fails partway; no connection is a 404", async () => {
  const cf = fakeClickFunnels({ fail: { path: "/pages/101/stats", status: 500, message: "stats are down" } });
  const world = syncWorld();
  const done = await hit(clickfunnelsSync, { method: "POST", body: {}, deps: { fetch: cf }, rules: world.rules });
  assert.equal(done.status, 502);
  assert.equal(done.body.error, "sync_failed");
  assert.match(done.body.message, /stats are down/);
  assert.equal(done.body.pages_synced, 1);
  assert.deepEqual(world.stats.map((s) => s.page), ["100"], "the page before the failure is kept");
  const failure = world.updates.at(-1);
  assert.match(failure.sql, /connection_state = 'error', last_error = \$2/);
  assert.deepEqual(failure.params, ["cn-1", failure.params[1]]);
  assert.match(failure.params[1], /stats are down/);

  const none = syncWorld({ noConnection: true });
  const missing = await hit(clickfunnelsSync, { method: "POST", body: {}, deps: { fetch: fakeClickFunnels() }, rules: none.rules });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "no_connection");
  assert.equal(none.stats.length, 0);

  const theirs = syncWorld({ orgOf: OTHER_ORG_ID, credsFor: OTHER_ORG_ID });
  const other = await hit(clickfunnelsSync, { method: "POST", body: {}, deps: { fetch: fakeClickFunnels() }, rules: theirs.rules });
  assert.equal(other.status, 404, "another company's connection is never used");
  await assertRoleGate(clickfunnelsSync, ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"], {
    method: "POST", body: {}, deps: { fetch: fakeClickFunnels() }, rules: syncWorld().rules,
  });
});

/* ── YouTube ─────────────────────────────────────────────────────────────── */

const YT = { clientId: "yt-client-fake", clientSecret: ["yt", "secret", "fake"].join("-"), refresh: ["yt", "refresh", "fake"].join("-") };

function fakeGoogle({ tokenFail = null, listFail = null, statsFail = null, rows = null, uploads = "UU-uploads" } = {}) {
  const seen = [];
  const fn = async (url, init = {}) => {
    const u = new URL(String(url));
    seen.push({ url: String(url), method: init.method, body: init.body, auth: init.headers?.authorization });
    if (u.hostname === "oauth2.googleapis.com") {
      if (tokenFail) return json(tokenFail.status, { error: tokenFail.error, error_description: tokenFail.description });
      return json(200, { access_token: "ya29.fake-access", expires_in: 3599 });
    }
    if (u.pathname.endsWith("/channels")) {
      if (listFail) return json(listFail.status, { error: { message: listFail.message } });
      if (u.searchParams.get("part") === "id") return json(200, { items: [{ id: "UC-channel-1" }] });
      return json(200, { items: [{ contentDetails: { relatedPlaylists: { uploads } } }] });
    }
    if (u.pathname.endsWith("/playlistItems")) {
      return json(200, { items: [
        { snippet: { title: "Welcome", publishedAt: "2026-09-01T00:00:00Z", resourceId: { videoId: "vid-1" } } },
        { snippet: { title: "Deleted", resourceId: {} } },
        { snippet: { title: "How funding works", publishedAt: "2026-09-10T00:00:00Z", resourceId: { videoId: "vid-2" } } },
      ] });
    }
    if (u.pathname.endsWith("/reports")) {
      if (statsFail) return json(statsFail.status, { error: { message: statsFail.message } });
      return json(200, { rows: rows || [["vid-1", 120, 300.5, 150, 62.5], ["vid-2", 40, null, null, null], [null, 1, 1, 1, 1]] });
    }
    throw new Error(`unexpected address ${u}`);
  };
  fn.seen = seen;
  return fn;
}

test("youtube-connect checks the three Google values by really asking Google, then saves them encrypted for this company with the channel id, and returns no secret", async () => {
  assert.equal(ROUTES["analytics/youtube-connect"], youtubeConnect);
  const g = fakeGoogle();
  const insert = [/INSERT INTO analytics_connections/, (_sql, p) => [{ id: "yt-1", external_account_id: p[1], connection_state: "active" }]];
  const done = await hit(youtubeConnect, { method: "POST", role: "csm", body: { client_id: YT.clientId, client_secret: YT.clientSecret, refresh_token: YT.refresh }, deps: { fetch: g }, rules: [insert] });
  assert.equal(done.status, 200);
  assert.deepEqual(done.body, { ok: true, connection: { id: "yt-1", external_account_id: "UC-channel-1", connection_state: "active" } });
  const [call] = sqlCalls(done, /INSERT INTO analytics_connections/);
  assert.deepEqual([call.params[0], call.params[1]], [ORG_ID, "UC-channel-1"]);
  assert.deepEqual(JSON.parse(decryptToken(call.params[2], { partnerId: ORG_ID })), { client_id: YT.clientId, client_secret: YT.clientSecret, refresh_token: YT.refresh });
  assert.match(call.sql, /VALUES \(\$1, 'youtube', \$2, \$3, 'active', NULL\)/);
  assert.match(call.sql, /ON CONFLICT \(org_id, platform\) DO UPDATE SET/);
  const token = g.seen[0];
  assert.equal(token.method, "POST");
  assert.equal(new URLSearchParams(token.body).get("grant_type"), "refresh_token");
  assert.equal(new URLSearchParams(token.body).get("refresh_token"), YT.refresh);
  const body = JSON.stringify(done.body);
  for (const secret of [YT.clientSecret, YT.refresh, "ya29"]) assert.equal(body.includes(secret), false);
});

test("youtube-connect saves nothing, and says Google's own words, when Google refuses the token, the channel list or the channel; and refuses a missing field", async () => {
  const cases = [
    [{ tokenFail: { status: 400, error: "invalid_grant", description: "Token has been expired or revoked." } }, /Token has been expired or revoked/],
    [{ listFail: { status: 403, message: "The caller does not have permission" } }, /does not have permission/],
    [{ uploads: null }, /no uploads playlist/],
  ];
  for (const [options, message] of cases) {
    const g = fakeGoogle(options);
    const out = await hit(youtubeConnect, { method: "POST", body: { client_id: YT.clientId, client_secret: YT.clientSecret, refresh_token: YT.refresh }, deps: { fetch: g }, rules: [] });
    assert.equal(out.status, 400);
    assert.equal(out.body.error, "youtube_validation_failed");
    assert.match(out.body.message, message);
    assert.equal(sqlCalls(out, /INSERT INTO analytics_connections/).length, 0);
  }
  for (const missing of ["client_id", "client_secret", "refresh_token"]) {
    const g = fakeGoogle();
    const body = { client_id: YT.clientId, client_secret: YT.clientSecret, refresh_token: YT.refresh, [missing]: "  " };
    const out = await hit(youtubeConnect, { method: "POST", body, deps: { fetch: g }, rules: [] });
    assert.equal(out.status, 400, missing);
    assert.equal(out.body.error, "missing_fields");
    assert.equal(g.seen.length, 0, "nothing is asked of Google");
  }
  await assertRoleGate(youtubeConnect, ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"], {
    method: "POST", body: { client_id: YT.clientId, client_secret: YT.clientSecret, refresh_token: YT.refresh }, deps: { fetch: fakeGoogle() },
    rules: [[/INSERT INTO analytics_connections/, [{ id: "yt-1", external_account_id: "UC", connection_state: "active" }]]],
  });
});

function youtubeWorld({ noConnection = false } = {}) {
  const encrypted = encryptToken(JSON.stringify({ client_id: YT.clientId, client_secret: YT.clientSecret, refresh_token: YT.refresh }), { partnerId: ORG_ID });
  const world = { stats: [], updates: [] };
  world.rules = [
    [/SELECT \* FROM analytics_connections WHERE org_id = \$1 AND platform = 'youtube'/, (_sql, p) =>
      (noConnection || p[0] !== ORG_ID ? [] : [{ id: "yt-1", org_id: ORG_ID, platform: "youtube", encrypted_credentials: encrypted, connection_state: "active" }])],
    [/INSERT INTO video_watch_stats/, (_sql, p) => { world.stats.push({ org: p[0], conn: p[1], video: p[2], title: p[3], date: p[4], views: p[5], minutes: p[6], avg: p[7], pct: p[8] }); return []; }],
    [/UPDATE analytics_connections/, (sql, p) => { world.updates.push({ sql, params: p }); return []; }],
  ];
  return world;
}

test("youtube-sync saves one snapshot per video per day with the title, keeps unknown numbers NULL and never 0, skips a row with no video, and marks the connection synced", async () => {
  assert.equal(ROUTES["analytics/youtube-sync"], youtubeSync);
  const world = youtubeWorld();
  const g = fakeGoogle();
  const done = await hit(youtubeSync, { method: "POST", body: { days: 14 }, deps: { fetch: g }, rules: world.rules });
  assert.equal(done.status, 200);
  // The count is NOT pinned here (repair cycle 1). This report carries a row with no video id, which is
  // counted in `videos_synced` and never written: 3 told, 2 saved. That is a product finding, and a test
  // that pinned 3 would turn red the day the count is corrected. The count is judged against the rows
  // written in fin-b24-repair-analytics.test.mjs, on a report with no such row.
  assert.equal(done.body.ok, true);
  const today = new Date().toISOString().slice(0, 10);
  assert.deepEqual(world.stats, [
    { org: ORG_ID, conn: "yt-1", video: "vid-1", title: "Welcome", date: today, views: 120, minutes: 300.5, avg: 150, pct: 62.5 },
    { org: ORG_ID, conn: "yt-1", video: "vid-2", title: "How funding works", date: today, views: 40, minutes: null, avg: null, pct: null },
  ], "a row with no video id is never written");
  assert.match(sqlCalls(done, /INSERT INTO video_watch_stats/)[0].sql, /ON CONFLICT \(connection_id, youtube_video_id, stat_date\) DO UPDATE/);
  const finish = world.updates.at(-1);
  assert.match(finish.sql, /last_synced_at = now\(\), last_error = NULL, connection_state = 'active'/);
  assert.deepEqual(finish.params, ["yt-1"]);
  const report = new URL(g.seen.find((s) => /\/reports/.test(s.url)).url).searchParams;
  assert.equal(report.get("endDate"), today);
  const days = Math.round((new Date(report.get("endDate")) - new Date(report.get("startDate"))) / 86400000);
  assert.equal(days, 14);
  assert.deepEqual(sqlCalls(done, /SELECT \* FROM analytics_connections/)[0].params, [ORG_ID]);
  // The window falls back to 30 days and is capped at a year.
  for (const [asked, want] of [[undefined, 30], ["x", 30], [9999, 365]]) {
    const net = fakeGoogle();
    await hit(youtubeSync, { method: "POST", body: { days: asked }, deps: { fetch: net }, rules: youtubeWorld().rules });
    const q = new URL(net.seen.find((s) => /\/reports/.test(s.url)).url).searchParams;
    assert.equal(Math.round((new Date(q.get("endDate")) - new Date(q.get("startDate"))) / 86400000), want, String(asked));
  }
});

test("youtube-sync marks the connection expired when Google revoked the token and error when anything else fails, with Google's words, and writes no stats on a failure; no connection is a 404", async () => {
  const revoked = youtubeWorld();
  const expired = await hit(youtubeSync, { method: "POST", body: {}, deps: { fetch: fakeGoogle({ tokenFail: { status: 400, error: "invalid_grant", description: "Token has been expired or revoked." } }) }, rules: revoked.rules });
  assert.equal(expired.status, 502);
  assert.equal(expired.body.error, "youtube_refresh_failed");
  assert.equal(expired.body.connection_state, "expired");
  assert.deepEqual(revoked.updates.at(-1).params.slice(0, 2), ["yt-1", "expired"]);
  assert.match(revoked.updates.at(-1).params[2], /Token has been expired or revoked/);
  assert.equal(revoked.stats.length, 0);

  for (const [options, error] of [
    [{ listFail: { status: 500, message: "backend error" } }, "youtube_video_list_failed"],
    [{ statsFail: { status: 500, message: "analytics down" } }, "youtube_stats_failed"],
  ]) {
    const world = youtubeWorld();
    const out = await hit(youtubeSync, { method: "POST", body: {}, deps: { fetch: fakeGoogle(options) }, rules: world.rules });
    assert.equal(out.status, 502);
    assert.equal(out.body.error, error);
    assert.equal(out.body.connection_state, "error");
    assert.deepEqual(world.updates.at(-1).params.slice(0, 2), ["yt-1", "error"]);
    assert.equal(world.stats.length, 0, "no half-written snapshot");
  }

  const none = youtubeWorld({ noConnection: true });
  const missing = await hit(youtubeSync, { method: "POST", body: {}, deps: { fetch: fakeGoogle() }, rules: none.rules });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "not_connected");
  await assertRoleGate(youtubeSync, ["owner", "admin", "sales_manager", "closer", "funding_advisor", "inquiry_specialist", "csm", "setter"], {
    method: "POST", body: {}, deps: { fetch: fakeGoogle() }, rules: youtubeWorld().rules,
  });
  const get = await hit(youtubeSync, { method: "GET", rules: [] });
  assert.equal(get.status, 405);
});
