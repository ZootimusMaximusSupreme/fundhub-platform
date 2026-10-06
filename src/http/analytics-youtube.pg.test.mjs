// Endpoint tests for the YouTube analytics connect/sync/read trio, against
// real Postgres (DATABASE_URL). Lives under src/http/, not api/, because
// npm test's glob is "src/**" and "scripts/**" only (CLAUDE.md §12) — a test
// file next to the handler under api/ never runs.
//
// Drives the handlers directly (not through netlify/functions/api.mjs and its
// ROUTES map), the same way src/http/conversations-read.pg.test.mjs's `run`
// path does — these three routes are not wired into ROUTES yet, and this
// lane does not own that file.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { createSession } from "../auth/session.mjs";
import { decryptToken } from "../adplatforms/tokens.mjs";
import { asStaff } from "../partners/rls.mjs";
import connectHandler from "../../api/analytics/youtube-connect.mjs";
import syncHandler from "../../api/analytics/youtube-sync.mjs";
import readHandler from "../../api/read/video-stats.mjs";

const HAS_DB = !!process.env.DATABASE_URL;
const EMAIL_TAG = "yt_analytics_pg_test";

const res = () => {
  const r = { code: null, body: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => r;
  return r;
};

const req = (token, { method = "GET", body = {}, query = {} } = {}) => ({
  method,
  headers: token ? { authorization: "Bearer " + token } : {},
  body,
  query
});

/* mockFetch — same shape as src/analytics/youtube.test.mjs and
   src/company-brain/sync.test.mjs: first matching route wins. */
function mockFetch(routes) {
  return async (url) => {
    const u = String(url);
    const hit = routes.find((r) => r.match(u));
    if (!hit) throw new Error(`unexpected fetch: ${u}`);
    const status = hit.status || 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      async text() { return JSON.stringify(hit.body); }
    };
  };
}

const TOKEN_OK = { match: (u) => u === "https://oauth2.googleapis.com/token", body: { access_token: "ya29.fresh", expires_in: 3600 } };
const TOKEN_INVALID_GRANT = {
  match: (u) => u === "https://oauth2.googleapis.com/token",
  status: 400,
  body: { error: "invalid_grant", error_description: "Token has been expired or revoked." }
};
const CHANNEL_CONTENT_DETAILS = {
  match: (u) => u.includes("/youtube/v3/channels") && u.includes("part=contentDetails"),
  body: { items: [{ id: "UC_test_channel", contentDetails: { relatedPlaylists: { uploads: "UU_test_uploads" } } }] }
};
const CHANNEL_ID_ONLY = {
  match: (u) => u.includes("/youtube/v3/channels") && u.includes("part=id"),
  body: { items: [{ id: "UC_test_channel" }] }
};
const twoVideosPlaylist = {
  match: (u) => u.includes("playlistItems"),
  body: {
    items: [
      { snippet: { resourceId: { videoId: "vid_a" }, title: "Video A", publishedAt: "2026-01-01T00:00:00Z" } },
      { snippet: { resourceId: { videoId: "vid_b" }, title: "Video B", publishedAt: "2026-02-01T00:00:00Z" } }
    ]
  }
};
const statsOnlyVidA = {
  match: (u) => u.startsWith("https://youtubeanalytics.googleapis.com/v2/reports"),
  body: {
    columnHeaders: [{ name: "video" }, { name: "views" }, { name: "estimatedMinutesWatched" }, { name: "averageViewDuration" }, { name: "averageViewPercentage" }],
    // vid_b is absent on purpose — the "no views this window" case.
    rows: [["vid_a", 250, 88.5, 21.2, 47.9]]
  }
};

describe("YouTube analytics connect/sync/read", { skip: !HAS_DB ? "no DATABASE_URL" : false }, () => {
  let org, staffId, tokenStaff, nonStaffId, tokenNonStaff;

  before(async () => {
    if (!process.env.AD_TOKEN_ENC_KEY) {
      process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");
    }
    org = await resolveDefaultOrg(db);
    await purge();

    const staff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'YT Analytics Fixture','owner','active') RETURNING id`,
      [org, `${EMAIL_TAG}.owner@example.com`]
    )).rows[0];
    staffId = staff.id;
    tokenStaff = (await createSession(db, { staffId, orgId: org })).token;

    // 'partner' is a real role (036_partner_role.sql) deliberately NOT in
    // ROLE_SETS.STAFF — the shortest path to a real 403 rather than a 401.
    // This used 'csm' until 2026-10-05, but csm joined STAFF on purpose on
    // 2026-09-05 (2b10dae65), so a csm got past the gate and hit a 400.
    const nonStaff = (await db.query(
      `INSERT INTO staff (org_id, email, name, role, status)
       VALUES ($1,$2,'YT Analytics Non-Staff Fixture','partner','active') RETURNING id`,
      [org, `${EMAIL_TAG}.partner@example.com`]
    )).rows[0];
    nonStaffId = nonStaff.id;
    tokenNonStaff = (await createSession(db, { staffId: nonStaffId, orgId: org })).token;
  });

  // analytics_connections / video_watch_stats carry fundhub_is_staff()-only
  // RLS (302). A bare db.query against them is anonymous to that policy and
  // silently touches zero rows rather than erroring — asStaff() is required
  // for every query here, verification queries included, not just the
  // handlers under test. Caught by this test file itself the first time it
  // ran against fundhub_app instead of a superuser: see
  // src/creative/runner.mjs's header for the same bug, fixed today.
  async function purge() {
    await asStaff((tx) => tx.query(
      `DELETE FROM video_watch_stats WHERE connection_id IN
         (SELECT id FROM analytics_connections WHERE org_id = $1 AND platform = 'youtube')`,
      [org]
    ));
    await asStaff((tx) => tx.query(
      `DELETE FROM analytics_connections WHERE org_id = $1 AND platform = 'youtube'`, [org]
    ));
    await db.query(`DELETE FROM sessions WHERE staff_id IN (SELECT id FROM staff WHERE email LIKE $1)`, [`${EMAIL_TAG}%`]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [`${EMAIL_TAG}%`]);
  }

  after(async () => {
    await purge();
    await close();
  });

  test("connect refuses bad credentials and saves nothing", async () => {
    const r = res();
    const fetch = mockFetch([TOKEN_INVALID_GRANT]);
    await connectHandler(
      req(tokenStaff, { method: "POST", body: { client_id: "cid", client_secret: "bad", refresh_token: "revoked" } }),
      r,
      { db, fetch }
    );
    assert.equal(r.code, 400);
    assert.equal(r.body.ok, false);
    assert.equal(r.body.error, "youtube_validation_failed");
    assert.match(r.body.message, /invalid_grant|expired or revoked/);

    const rows = (await asStaff((tx) => tx.query(
      `SELECT id FROM analytics_connections WHERE org_id = $1 AND platform = 'youtube'`, [org]
    ))).rows;
    assert.equal(rows.length, 0, "a rejected connect attempt left a row behind");
  });

  test("connect succeeds and the stored row decrypts back to the exact credentials sent", async () => {
    const r = res();
    const fetch = mockFetch([TOKEN_OK, CHANNEL_CONTENT_DETAILS, twoVideosPlaylist, CHANNEL_ID_ONLY]);
    const creds = { client_id: "real-client-id", client_secret: "real-client-secret", refresh_token: "real-refresh-token" };
    await connectHandler(req(tokenStaff, { method: "POST", body: creds }), r, { db, fetch });

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.connection.external_account_id, "UC_test_channel");
    assert.equal(r.body.connection.connection_state, "active");
    // Never the credentials themselves in the response.
    assert.equal(JSON.stringify(r.body).includes("real-client-secret"), false);
    assert.equal(JSON.stringify(r.body).includes("real-refresh-token"), false);

    const row = (await asStaff((tx) => tx.query(
      `SELECT encrypted_credentials, org_id FROM analytics_connections WHERE org_id = $1 AND platform = 'youtube'`, [org]
    ))).rows[0];
    assert.ok(row, "no connection row was saved");
    const decrypted = JSON.parse(decryptToken(row.encrypted_credentials, { partnerId: row.org_id }));
    assert.deepEqual(decrypted, creds);
  });

  test("sync upserts rows and never writes a fake 0 for a video absent from the stats response", async () => {
    const r = res();
    const fetch = mockFetch([TOKEN_OK, CHANNEL_CONTENT_DETAILS, twoVideosPlaylist, statsOnlyVidA]);
    await syncHandler(req(tokenStaff, { method: "POST", body: { days: 30 } }), r, { db, fetch });

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.videos_synced, 1);

    const conn = (await asStaff((tx) => tx.query(
      `SELECT id, connection_state, last_synced_at, last_error FROM analytics_connections WHERE org_id = $1 AND platform = 'youtube'`,
      [org]
    ))).rows[0];
    assert.equal(conn.connection_state, "active");
    assert.equal(conn.last_error, null);
    assert.ok(conn.last_synced_at, "last_synced_at was not stamped");

    const stats = (await asStaff((tx) => tx.query(
      `SELECT youtube_video_id, video_title, views, estimated_minutes_watched,
              average_view_duration_sec, average_view_percentage
         FROM video_watch_stats WHERE connection_id = $1`,
      [conn.id]
    ))).rows;
    assert.equal(stats.length, 1, "a fake row was written for the video absent from the stats response");
    assert.equal(stats[0].youtube_video_id, "vid_a");
    assert.equal(stats[0].video_title, "Video A");
    assert.equal(Number(stats[0].views), 250);
    assert.equal(stats.some((s) => s.youtube_video_id === "vid_b"), false, "vid_b (no views this window) got a written row");
  });

  test("read returns the synced rows and the connection's health", async () => {
    const r = res();
    await readHandler(req(tokenStaff, { method: "GET" }), r, { db });

    assert.equal(r.code, 200, JSON.stringify(r.body));
    assert.equal(r.body.ok, true);
    assert.equal(r.body.connection.state, "active");
    assert.ok(r.body.connection.last_synced_at);
    assert.ok(Array.isArray(r.body.videos));
    const row = r.body.videos.find((v) => v.video_title === "Video A");
    assert.ok(row, "the synced video did not come back from the read endpoint");
    assert.equal(Number(row.views), 250);
  });

  test("non-staff gets 403 on all three endpoints", async () => {
    const rConnect = res();
    await connectHandler(req(tokenNonStaff, { method: "POST", body: {} }), rConnect, { db });
    assert.equal(rConnect.code, 403);

    const rSync = res();
    await syncHandler(req(tokenNonStaff, { method: "POST", body: {} }), rSync, { db });
    assert.equal(rSync.code, 403);

    const rRead = res();
    await readHandler(req(tokenNonStaff, { method: "GET" }), rRead, { db });
    assert.equal(rRead.code, 403);
  });
});
