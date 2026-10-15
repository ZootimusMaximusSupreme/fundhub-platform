// Batch 24, repair cycle 1: the ClickFunnels and YouTube connect and sync doors.
//
// An independent checker found breaks that stayed green on all four:
//   * connect: the stand-in INSERT chose its own returned columns (and even
//     returned the ciphertext), so `RETURNING *`, a secret at the top level, a
//     missing ok:true, and a company taken from the request body were invisible.
//   * ClickFunnels sync: only the "page is not reached through a funnel" path
//     was judged for unknown numbers. A step with views or opt-ins missing was
//     never sent, so a missing number turned into 0 unseen.
//   * YouTube sync: unknown views turning into 0, and a refresh failure that is
//     not "revoked" being marked expired, were never tried. The count the old
//     test pinned also included a row that is never written.
//
// The real api/ handlers, the real encryption and adapters, a stand-in database
// that returns exactly the columns a statement names, and stand-ins for the
// vendors' addresses handed in through the handlers' seam. Nothing leaves the
// building. This is a PRACTICE TEST with fake data. It is not a live check.

import assert from "node:assert/strict";
import crypto from "node:crypto";
import test, { after, before } from "node:test";

import clickfunnelsConnect from "../../../../api/analytics/clickfunnels-connect.mjs";
import clickfunnelsSync from "../../../../api/analytics/clickfunnels-sync.mjs";
import youtubeConnect from "../../../../api/analytics/youtube-connect.mjs";
import youtubeSync from "../../../../api/analytics/youtube-sync.mjs";
import { decryptToken, encryptToken } from "../../../adplatforms/tokens.mjs";
import { ORG_ID, OTHER_ORG_ID, hit, sqlCalls } from "./s5-route-kit.mjs";
import { deepKeys, returned } from "./fin-b24-repair-kit.mjs";

const keyName = "AD_TOKEN_ENC_KEY";
let savedKey;
before(() => {
  savedKey = process.env[keyName];
  process.env[keyName] = crypto.randomBytes(32).toString("base64");
});
after(() => {
  if (savedKey === undefined) delete process.env[keyName]; else process.env[keyName] = savedKey;
});

const json = (status, body) => new Response(JSON.stringify(body), { status });
const CF_KEY = ["cf", "fake", "key"].join("-");
const YT = { clientId: "yt-client-fake", clientSecret: ["yt", "secret", "fake"].join("-"), refresh: ["yt", "refresh", "fake"].join("-") };
// A request that tries to name a company of its own, in the body and in the address.
const HOSTILE_BODY = { org_id: OTHER_ORG_ID };
const HOSTILE_QUERY = { org_id: OTHER_ORG_ID };

/* The columns of a saved connection row, secrets included. The statement's own
   RETURNING list decides which of them the handler ever sees. */
const savedConnection = (platform, p) => ({
  id: `${platform}-1`, org_id: p[0], platform, external_account_id: p[1], encrypted_credentials: p[2],
  connection_state: "active", last_error: null, last_synced_at: null, created_at: "2026-10-14T00:00:00.000Z", updated_at: "2026-10-14T00:00:00.000Z",
});

/* ── ClickFunnels ────────────────────────────────────────────────────────── */

function fakeClickFunnels({ steps = {} } = {}) {
  const seen = [];
  const fn = async (url, init = {}) => {
    const u = new URL(String(url));
    seen.push(u.pathname);
    if (init.headers?.authorization !== `Bearer ${CF_KEY}`) return json(401, { error: "API key missing or invalid" });
    if (u.pathname.endsWith("/teams")) return json(200, [{ id: 1, name: "Team" }]);
    if (u.pathname.endsWith("/workspaces")) return json(200, [{ id: 10, subdomain: "goodshop" }]);
    if (u.pathname.endsWith("/funnels")) return json(200, [{ id: 5, name: "Main Funnel" }, { id: 6, name: "Second Funnel" }]);
    if (u.pathname.endsWith("/pages")) {
      const funnel = u.searchParams.get("filter[funnel_ids]");
      return json(200, funnel === "5" ? [{ id: 100, name: "Order Page" }, { id: 101, name: "Thank You" }] : [{ id: 200, name: "Upsell" }]);
    }
    if (u.pathname.endsWith("/stats")) {
      const page = u.pathname.split("/").at(-2);
      const step = steps[page];
      if (step === "gone") return json(404, { error: "stats not available" });
      if (step === "no-step") return json(200, { funnel: null, step: null });
      return json(200, { step });
    }
    throw new Error(`unexpected address ${u}`);
  };
  fn.seen = seen;
  return fn;
}

test("clickfunnels-connect answers ok and only the id, the workspace and the state: no key, no ciphertext, whatever the statement could return, and the company is the sign-in's", async () => {
  const cf = fakeClickFunnels();
  const insert = [/INSERT INTO analytics_connections/, (sql, p) => returned(sql, savedConnection("clickfunnels", p))];
  const done = await hit(clickfunnelsConnect, {
    method: "POST", role: "closer", query: HOSTILE_QUERY,
    body: { api_key: CF_KEY, subdomain: "GoodShop", ...HOSTILE_BODY }, deps: { fetch: cf }, rules: [insert],
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true, "the screen reads ok:true; without it the connect looks refused");
  assert.deepEqual(Object.keys(done.body).sort(), ["connection", "ok"], "nothing rides beside the connection");
  assert.deepEqual(Object.keys(done.body.connection).sort(), ["connection_state", "external_account_id", "id"]);
  assert.deepEqual(done.body.connection, { id: "clickfunnels-1", external_account_id: "goodshop", connection_state: "active" });

  const [call] = sqlCalls(done, /INSERT INTO analytics_connections/);
  assert.equal(call.params[0], ORG_ID, "the connection is saved for the company on the sign-in, not the one in the request");
  assert.deepEqual(JSON.parse(decryptToken(call.params[2], { partnerId: ORG_ID })), { api_key: CF_KEY, subdomain: "goodshop" });
  assert.throws(() => decryptToken(call.params[2], { partnerId: OTHER_ORG_ID }), undefined, "and only that company can read it");

  const wire = JSON.stringify(done.body);
  assert.equal(wire.includes(CF_KEY), false, "the key never goes back to the browser");
  assert.equal(wire.includes(call.params[2]), false, "neither does its ciphertext");
  for (const secret of ["encrypted_credentials", "api_key", "org_id", "last_error", "platform"]) {
    assert.equal(deepKeys(done.body).has(secret), false, `${secret} is not part of the answer`);
  }
});

test("clickfunnels-sync saves a missing views number or a missing opt-in number as NULL and a real zero as 0, and says whether any page had numbers", async () => {
  const world = (steps) => {
    const w = { stats: [], updates: [] };
    const encrypted = encryptToken(JSON.stringify({ api_key: CF_KEY, subdomain: "goodshop" }), { partnerId: ORG_ID });
    w.rules = [
      [/SELECT \* FROM analytics_connections WHERE org_id = \$1 AND platform = 'clickfunnels'/, (_s, p) => (p[0] === ORG_ID
        ? [{ id: "cn-1", org_id: ORG_ID, platform: "clickfunnels", encrypted_credentials: encrypted, connection_state: "active" }] : [])],
      [/INSERT INTO funnel_page_stats/, (_s, p) => { w.stats.push({ org: p[0], page: p[3], views: p[7], conversions: p[8] }); return []; }],
      [/UPDATE analytics_connections/, (sql, p) => { w.updates.push({ sql, params: p }); return []; }],
    ];
    w.cf = fakeClickFunnels({ steps });
    return w;
  };

  // Three pages: opt-ins missing, views missing, and a page that really had none of either.
  const partial = world({ 100: { views_all: 42 }, 101: { optins: 3 }, 200: { views_all: 0, optins: 0 } });
  const done = await hit(clickfunnelsSync, { method: "POST", query: HOSTILE_QUERY, body: { days: 7, ...HOSTILE_BODY }, deps: { fetch: partial.cf }, rules: partial.rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.deepEqual(partial.stats.map((s) => [s.page, s.views, s.conversions]), [
    ["100", 42, null],
    ["101", null, 3],
    ["200", 0, 0],
  ], "a number ClickFunnels did not send is unknown, never 0; a real 0 stays 0");
  assert.ok(partial.stats.every((s) => s.org === ORG_ID), "this company's rows");
  assert.equal(done.body.pages_synced, 3);
  assert.equal(done.body.stats_available, true, "some page had numbers");
  assert.deepEqual(sqlCalls(done, /SELECT \* FROM analytics_connections/)[0].params, [ORG_ID], "the connection is the sign-in company's, not the request's");

  // Every page unavailable: the pages are listed, no number is invented, and the screen is told so.
  const none = world({ 100: "gone", 101: "no-step", 200: "gone" });
  const empty = await hit(clickfunnelsSync, { method: "POST", body: {}, deps: { fetch: none.cf }, rules: none.rules });
  assert.equal(empty.status, 200);
  assert.deepEqual(none.stats.map((s) => [s.page, s.views, s.conversions]), [["100", null, null], ["101", null, null], ["200", null, null]]);
  assert.equal(empty.body.pages_synced, 3);
  assert.equal(empty.body.stats_available, false, "no page had numbers, so the screen must not say stats are available");
});

/* ── YouTube ─────────────────────────────────────────────────────────────── */

function fakeGoogle({ tokenFail = null, rows = null } = {}) {
  const seen = [];
  const fn = async (url) => {
    const u = new URL(String(url));
    seen.push(String(url));
    if (u.hostname === "oauth2.googleapis.com") {
      if (tokenFail) return json(tokenFail.status, { error: tokenFail.error, error_description: tokenFail.description });
      return json(200, { access_token: "ya29.fake-access", expires_in: 3599 });
    }
    if (u.pathname.endsWith("/channels")) {
      if (u.searchParams.get("part") === "id") return json(200, { items: [{ id: "UC-channel-1" }] });
      return json(200, { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU-uploads" } } }] });
    }
    if (u.pathname.endsWith("/playlistItems")) {
      return json(200, { items: [
        { snippet: { title: "Welcome", publishedAt: "2026-09-01T00:00:00Z", resourceId: { videoId: "vid-1" } } },
        { snippet: { title: "How funding works", publishedAt: "2026-09-10T00:00:00Z", resourceId: { videoId: "vid-2" } } },
      ] });
    }
    if (u.pathname.endsWith("/reports")) return json(200, { rows: rows || [["vid-1", 120, 300.5, 150, 62.5], ["vid-2", 40, 10, 20, 30]] });
    throw new Error(`unexpected address ${u}`);
  };
  fn.seen = seen;
  return fn;
}

function youtubeWorld() {
  const encrypted = encryptToken(JSON.stringify({ client_id: YT.clientId, client_secret: YT.clientSecret, refresh_token: YT.refresh }), { partnerId: ORG_ID });
  const w = { stats: [], updates: [] };
  w.rules = [
    [/SELECT \* FROM analytics_connections WHERE org_id = \$1 AND platform = 'youtube'/, (_s, p) => (p[0] === ORG_ID
      ? [{ id: "yt-1", org_id: ORG_ID, platform: "youtube", encrypted_credentials: encrypted, connection_state: "active" }] : [])],
    [/INSERT INTO video_watch_stats/, (_s, p) => { w.stats.push({ org: p[0], video: p[2], views: p[5], minutes: p[6] }); return []; }],
    [/UPDATE analytics_connections/, (sql, p) => { w.updates.push({ sql, params: p }); return []; }],
  ];
  return w;
}

test("youtube-connect answers ok and only the id, the channel and the state, whatever the statement could return, and the company is the sign-in's", async () => {
  const insert = [/INSERT INTO analytics_connections/, (sql, p) => returned(sql, savedConnection("youtube", p))];
  const done = await hit(youtubeConnect, {
    method: "POST", role: "csm", query: HOSTILE_QUERY,
    body: { client_id: YT.clientId, client_secret: YT.clientSecret, refresh_token: YT.refresh, ...HOSTILE_BODY },
    deps: { fetch: fakeGoogle() }, rules: [insert],
  });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.deepEqual(Object.keys(done.body).sort(), ["connection", "ok"]);
  assert.deepEqual(done.body.connection, { id: "youtube-1", external_account_id: "UC-channel-1", connection_state: "active" });
  const [call] = sqlCalls(done, /INSERT INTO analytics_connections/);
  assert.equal(call.params[0], ORG_ID, "saved for the sign-in's company, not the one in the request");
  assert.deepEqual(JSON.parse(decryptToken(call.params[2], { partnerId: ORG_ID })), { client_id: YT.clientId, client_secret: YT.clientSecret, refresh_token: YT.refresh });
  const wire = JSON.stringify(done.body);
  for (const secret of [YT.clientSecret, YT.refresh, call.params[2], "ya29"]) assert.equal(wire.includes(secret), false, "no secret and no ciphertext goes back");
  for (const key of ["encrypted_credentials", "client_secret", "refresh_token", "org_id"]) assert.equal(deepKeys(done.body).has(key), false, key);
});

test("youtube-sync keeps unknown views NULL and a real zero 0, counts what it writes, and uses the sign-in's company", async () => {
  const world = youtubeWorld();
  const google = fakeGoogle({ rows: [["vid-1", null, 10, 5, 50], ["vid-2", 0, 0, 0, 0]] });
  const done = await hit(youtubeSync, { method: "POST", query: HOSTILE_QUERY, body: { days: 14, ...HOSTILE_BODY }, deps: { fetch: google }, rules: world.rules });
  assert.equal(done.status, 200);
  assert.equal(done.body.ok, true);
  assert.deepEqual(world.stats.map((s) => [s.video, s.views, s.minutes]), [["vid-1", null, 10], ["vid-2", 0, 0]], "views Google did not report is unknown, never 0; a real 0 stays 0");
  assert.equal(done.body.videos_synced, world.stats.length, "the count is the snapshots saved");
  assert.ok(world.stats.every((s) => s.org === ORG_ID));
  assert.deepEqual(sqlCalls(done, /SELECT \* FROM analytics_connections/)[0].params, [ORG_ID], "the connection is the sign-in company's, not the request's");

  // A report row with no video id has nothing to key on and is never written.
  const orphan = youtubeWorld();
  const row = await hit(youtubeSync, { method: "POST", body: {}, deps: { fetch: fakeGoogle({ rows: [["vid-1", 5, 1, 1, 1], [null, 9, 9, 9, 9]] }) }, rules: orphan.rules });
  assert.equal(row.status, 200);
  assert.deepEqual(orphan.stats.map((s) => s.video), ["vid-1"]);
});

test("youtube-sync marks the connection expired only when Google says the grant is revoked; any other refresh failure is an error", async () => {
  for (const [failure, state] of [
    [{ status: 400, error: "invalid_grant", description: "Token has been expired or revoked." }, "expired"],
    [{ status: 503, error: "temporarily_unavailable", description: "Google is not answering right now." }, "error"],
    [{ status: 401, error: "invalid_client", description: "The OAuth client was not found." }, "error"],
  ]) {
    const world = youtubeWorld();
    const out = await hit(youtubeSync, { method: "POST", body: {}, deps: { fetch: fakeGoogle({ tokenFail: failure }) }, rules: world.rules });
    assert.equal(out.status, 502, failure.error);
    assert.equal(out.body.error, "youtube_refresh_failed");
    assert.equal(out.body.connection_state, state, `${failure.error} is ${state}`);
    assert.deepEqual(world.updates.at(-1).params.slice(0, 2), ["yt-1", state], failure.error);
    assert.match(world.updates.at(-1).params[2], new RegExp(failure.description.slice(0, 20)), "Google's own words are kept");
    assert.equal(world.stats.length, 0);
  }
});
