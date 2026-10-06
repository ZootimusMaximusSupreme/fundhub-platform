/* The ClickFunnels night pull against a real Postgres, as the unprivileged app
 * role — the proof the DB-free test cannot give.
 *
 * WHY A REAL DATABASE. analytics_connections and funnel_page_stats are FORCE ROW
 * LEVEL SECURITY, staff only (302). From 2026-09-22 the night pull listed
 * accounts with a plain connection, the policy hid the row, and nothing was
 * written. Only a real policy, on a role that cannot bypass it, can prove the
 * sweeper now sees the account and that its writes survive the policy.
 *
 * RUNS ONLY WHERE IT CANNOT HURT. Skipped with no DATABASE_URL. The row-security
 * proof is skipped unless APP_DATABASE_URL is a separate, unprivileged role
 * (rlsIsReal) — on an owner or superuser login the policy is bypassed and the
 * test would be a false pass. If the org already has a ClickFunnels connection,
 * the whole file skips rather than touch it: it deletes only the rows it made.
 * Every ClickFunnels call is a fake (deps.fetch); nothing leaves the machine.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { db, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { encryptToken } from "../adplatforms/tokens.mjs";
import { asStaff } from "../partners/rls.mjs";
import { rlsPool, rlsDb, rlsIsReal, closeRlsPool } from "../testing/rls-pool.mjs";
import { sweep, ACTIVE_ORGS_SQL } from "./clickfunnels-analytics-sweeper.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
if (!process.env.AD_TOKEN_ENC_KEY) process.env.AD_TOKEN_ENC_KEY = crypto.randomBytes(32).toString("base64");

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    headers: { get: () => null }
  };
}

/* One workspace, one funnel, one page — the same fake the endpoint test uses. */
const fakeClickFunnels = async (url) => {
  const u = new URL(String(url));
  if (u.pathname.endsWith("/teams")) return jsonResponse(200, [{ id: 1, name: "Team" }]);
  if (u.pathname.endsWith("/workspaces")) return jsonResponse(200, [{ id: 10, subdomain: "nightpull" }]);
  if (u.pathname.endsWith("/funnels")) return jsonResponse(200, [{ id: 5, name: "Night Funnel" }]);
  if (u.pathname.endsWith("/pages")) return jsonResponse(200, [{ id: 100, name: "Night Page" }]);
  if (u.pathname.endsWith("/stats")) {
    return jsonResponse(200, { step: { views_all: 42, views_unique: 40, optins: 7, name: "Night Page" } });
  }
  throw new Error(`fakeClickFunnels: unexpected URL ${u}`);
};

const staffQuery = (sql, params) => asStaff((tx) => tx.query(sql, params));

describe("ClickFunnels night pull, real Postgres", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org = null;
  let connId = null;
  let alreadyThere = false;

  before(async () => {
    org = await resolveDefaultOrg(db);
    const existing = (await staffQuery(
      `SELECT id FROM analytics_connections WHERE org_id = $1 AND platform = 'clickfunnels'`, [org]
    )).rows[0];
    if (existing) { alreadyThere = true; return; }

    const creds = encryptToken(JSON.stringify({ api_key: "night-key", subdomain: "nightpull" }), { partnerId: org });
    connId = (await staffQuery(
      `INSERT INTO analytics_connections (org_id, platform, external_account_id, encrypted_credentials, connection_state)
       VALUES ($1, 'clickfunnels', 'nightpull', $2, 'active') RETURNING id`, [org, creds]
    )).rows[0].id;
  });

  after(async () => {
    if (connId) {
      await staffQuery(`DELETE FROM funnel_page_stats WHERE connection_id = $1`, [connId]);
      await staffQuery(`DELETE FROM analytics_connections WHERE id = $1`, [connId]);
    }
    await closeRlsPool();
    await close();
  });

  test("the plain app connection cannot see the account — the reason the old pull wrote nothing", async (t) => {
    if (alreadyThere) return t.skip("a ClickFunnels connection already exists here; not touching it");
    if (!rlsIsReal()) return t.skip("APP_DATABASE_URL is not a separate unprivileged role; a bypassing login would be a false pass");
    const bare = await rlsDb.query(ACTIVE_ORGS_SQL);
    assert.equal(bare.rows.some((r) => r.org_id === org), false);
  });

  test("the sweeper, as the app role, sees the account, pulls it, and the page numbers are saved", async (t) => {
    if (alreadyThere) return t.skip("a ClickFunnels connection already exists here; not touching it");
    if (!rlsIsReal()) return t.skip("APP_DATABASE_URL is not a separate unprivileged role; a bypassing login would be a false pass");

    const out = await sweep({ pool: rlsPool, fetch: fakeClickFunnels });
    assert.ok(out.orgs >= 1, "the sweeper saw no ClickFunnels account");
    assert.equal(out.errors.filter((e) => e.orgId === org).length, 0, JSON.stringify(out.errors));

    const saved = (await staffQuery(
      `SELECT views, conversions FROM funnel_page_stats WHERE connection_id = $1`, [connId]
    )).rows;
    assert.equal(saved.length, 1);
    assert.equal(saved[0].views, 42);

    const conn = (await staffQuery(
      `SELECT connection_state, last_synced_at FROM analytics_connections WHERE id = $1`, [connId]
    )).rows[0];
    assert.equal(conn.connection_state, "active");
    assert.ok(conn.last_synced_at, "last_synced_at was not stamped");
  });
});
