// finish-853 batch 26: GET /api/social/channels. The real handler (partnerReadHandler, the real sign-in
// and scope gates, the real redaction) runs over a stand-in social_channels table. The stand-in plays
// the row-level policy: the transaction stamps who is acting and which partner, and rows answer to that
// stamp. Practice test, fake data, no network, no database.
// The row's words: Social Studio, a partner's connected social channels (tokens redacted, can_post flag).
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/social/channels.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, inSql, sqlOf, wrote, pinned,
  ORG_ID, PARTNER, OTHER_PARTNER, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";

// Built at run time so no literal in this file looks like a stored secret.
const CIPHER_A = ["v1", "AAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB==", "ciphertext-of-the-page-token"].join(":");
const CIPHER_R = ["v1", "CCCCCCCCCCCCCCCC", "DDDDDDDDDDDDDDDDDDDDDD==", "ciphertext-of-the-refresh-token"].join(":");
const PAST = "2026-01-01T00:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";

const channel = (id, partner, over = {}) => ({
  id, partner_id: partner, channel: "facebook", external_account_id: `ext-${id}`, handle: `@${id}`,
  connection_state: "active", last_error: null, token_expires_at: FUTURE, scopes: ["pages_manage_posts"],
  best_times: { mon: ["09:00"] }, timezone: "America/Phoenix", created_at: "2026-09-01T00:00:00.000Z",
  updated_at: "2026-09-02T00:00:00.000Z", encrypted_access_token: CIPHER_A, encrypted_refresh_token: null, ...over,
});

function world() {
  return [
    channel("fb-main", PARTNER),
    channel("ig-main", PARTNER, { channel: "instagram", created_at: "2026-09-03T00:00:00.000Z", token_expires_at: PAST }),
    channel("li-old", PARTNER, { channel: "linkedin", connection_state: "expired", token_expires_at: PAST,
      encrypted_access_token: null, encrypted_refresh_token: CIPHER_R, last_error: "token expired" }),
    channel("fb-pending", PARTNER, { connection_state: "pending", encrypted_access_token: null, token_expires_at: null,
      created_at: "2026-09-04T00:00:00.000Z" }),
    channel("fb-other", OTHER_PARTNER, { handle: "@someone_elses" }),
  ];
}

function rulesFor(rows) {
  const scope = { actor: null, partner: null };
  return [
    [/set_config\('fundhub\.actor'/i, (sql, p) => { scope.actor = p[0]; return []; }],
    [/set_config\('fundhub\.partner_id'/i, (sql, p) => { scope.partner = p[0]; return []; }],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, []],
    [/FROM social_channels c/i, (sql, p) => {
      // The row-level policy: a partner actor sees only its own partner's rows.
      let visible = scope.actor === "partner" ? rows.filter((r) => r.partner_id === scope.partner) : rows.slice();
      visible = inSql(visible, sql, p);
      const hasCol = (re) => re.test(sql);
      // A column comes back only if the statement selects it: the ciphertext columns are present
      // here only when the SQL says SELECT c.* (the future mistake the redaction pass guards).
      const star = /SELECT\s+c\.\*/.test(sql);
      return visible
        .sort((a, b) => a.channel.localeCompare(b.channel) || String(a.created_at).localeCompare(String(b.created_at)))
        .slice(p[1], p[1] + p[0])
        .map((r) => {
          const { encrypted_access_token, encrypted_refresh_token, ...plain } = r;
          return {
            ...plain,
            ...(star ? { encrypted_access_token, encrypted_refresh_token } : {}),
            has_access_token: hasCol(/\(c\.encrypted_access_token\s+IS NOT NULL\) AS has_access_token/) ? r.encrypted_access_token !== null : undefined,
            has_refresh_token: hasCol(/\(c\.encrypted_refresh_token IS NOT NULL\) AS has_refresh_token/) ? r.encrypted_refresh_token !== null : undefined,
            token_expired: hasCol(/token_expires_at < now\(\)\) AS token_expired/) ? (r.token_expires_at !== null && r.token_expires_at < "2026-10-14") : undefined,
            can_post: hasCol(/\(c\.connection_state = 'active'\) AS can_post/) ? r.connection_state === "active" : undefined,
          };
        });
    }],
  ];
}

const get = (query, who, rows = world()) => run(handler, req("GET", { query }), [...who, ...rulesFor(rows)]);
const SAFE = (item) => Object.keys(item).filter((k) => /encrypted|token_hash|password/i.test(k));

describe("GET /api/social/channels", () => {
  test("a partner sees their own connected channels, ordered, with the can-post flag and token presence only", async () => {
    const { res, fake } = await get({}, asPartner(PARTNER));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items.map((i) => i.id), ["fb-main", "fb-pending", "ig-main", "li-old"]);
    const byId = Object.fromEntries(res.body.items.map((i) => [i.id, i]));
    assert.equal(byId["fb-main"].can_post, true);
    assert.equal(byId["ig-main"].can_post, true);
    assert.equal(byId["li-old"].can_post, false, "an expired connection cannot post");
    assert.equal(byId["fb-pending"].can_post, false);
    assert.equal(byId["fb-main"].has_access_token, true);
    assert.equal(byId["fb-main"].has_refresh_token, false);
    assert.equal(byId["li-old"].has_access_token, false);
    assert.equal(byId["li-old"].has_refresh_token, true, "presence comes from the statement, not from a column that was never selected");
    assert.equal(byId["ig-main"].token_expired, true);
    assert.equal(byId["fb-main"].token_expired, false);
    assert.equal(byId["li-old"].last_error, "token expired");
    assert.equal(byId["fb-main"].handle, "@fb-main");
    assert.deepEqual(byId["fb-main"].scopes, ["pages_manage_posts"]);
    // No token, in any spelling, leaves the door.
    for (const item of res.body.items) assert.deepEqual(SAFE(item), []);
    assert.doesNotMatch(JSON.stringify(res.body), /ciphertext-of|v1:AAAA|v1:CCCC/);
    assert.equal(wrote(fake), false);
  });

  test("the statement spells out presence, expiry and can_post, and never selects the ciphertext columns", async () => {
    const { fake } = await get({}, asPartner(PARTNER));
    const sql = sqlOf(fake, /FROM social_channels c/)[0].sql;
    pinned(sql, "access token presence", "(c.encrypted_access_token IS NOT NULL) AS has_access_token");
    pinned(sql, "refresh token presence", "(c.encrypted_refresh_token IS NOT NULL) AS has_refresh_token");
    pinned(sql, "expiry", "(c.token_expires_at IS NOT NULL AND c.token_expires_at < now()) AS token_expired");
    pinned(sql, "can post means the connection is active", "(c.connection_state = 'active') AS can_post");
    pinned(sql, "one order", "ORDER BY c.channel, c.created_at LIMIT $1 OFFSET $2");
    const selectList = sql.slice(0, sql.indexOf("FROM social_channels"));
    assert.doesNotMatch(selectList.replace(/\(c\.encrypted_(access|refresh)_token\s+IS NOT NULL\)/g, ""), /encrypted_/);
  });

  test("a partner is pinned to their own id: a partner_id in the address changes nothing", async () => {
    const { res, fake } = await get({ partner_id: OTHER_PARTNER }, asPartner(PARTNER));
    assert.equal(res.statusCode, 200);
    assert.ok(res.body.items.every((i) => !i.id.endsWith("other")), "another partner's channel is never shown");
    assert.deepEqual(res.body.items.map((i) => i.id), ["fb-main", "fb-pending", "ig-main", "li-old"]);
    const stamp = fake.calls.find((c) => /set_config\('fundhub\.partner_id'/.test(c.sql));
    assert.deepEqual(stamp.params, [PARTNER]);
    assert.deepEqual(fake.calls.find((c) => /set_config\('fundhub\.actor'/.test(c.sql)).params, ["partner"]);
  });

  test("staff must name a partner and then read that partner's channels; every staff role may", async () => {
    const none = await get({}, asRole("owner"));
    assert.equal(none.res.statusCode, 400);
    assert.equal(none.res.body.error, "partner_id_required");
    assert.equal(sqlOf(none.fake, /FROM social_channels/).length, 0);
    for (const role of ALL_STAFF_ROLES) {
      const { res } = await get({ partner_id: OTHER_PARTNER }, asRole(role));
      assert.equal(res.statusCode, 200, role);
      assert.deepEqual(res.body.items.map((i) => i.id), ["fb-other"], role);
    }
  });

  test("the state filter narrows the list, 'all' shows everything, and a typo is a 400 that names the allowed states", async () => {
    const active = await get({ state: "active" }, asPartner(PARTNER));
    assert.deepEqual(active.res.body.items.map((i) => i.id), ["fb-main", "ig-main"]);
    const two = await get({ state: "pending,expired" }, asPartner(PARTNER));
    assert.deepEqual(two.res.body.items.map((i) => i.id), ["fb-pending", "li-old"]);
    const all = await get({ state: "all" }, asPartner(PARTNER));
    assert.equal(all.res.body.items.length, 4);
    const typo = await get({ state: "actve" }, asPartner(PARTNER));
    assert.equal(typo.res.statusCode, 400);
    assert.equal(typo.res.body.error, "bad_state");
    assert.match(typo.res.body.message, /pending, active, expired, revoked/);
  });

  test("a page is bounded: limit and offset page the list and hasMore says there is more", async () => {
    const { res, fake } = await get({ limit: "2", offset: "1" }, asPartner(PARTNER));
    assert.deepEqual(res.body.items.map((i) => i.id), ["fb-pending", "ig-main"]);
    assert.equal(res.body.hasMore, true);
    assert.deepEqual(sqlOf(fake, /FROM social_channels c/)[0].params.slice(0, 2), [3, 1]);
    const last = await get({ limit: "2", offset: "2" }, asPartner(PARTNER));
    assert.deepEqual(last.res.body.items.map((i) => i.id), ["ig-main", "li-old"]);
    assert.equal(last.res.body.hasMore, false);
  });

  test("a client, an affiliate and nobody signed in are refused, and the only verb is GET", async () => {
    for (const who of [asClient(), asAffiliate()]) {
      const { res, fake } = await get({ partner_id: PARTNER }, who);
      assert.equal(res.statusCode, 403);
      assert.equal(sqlOf(fake, /FROM social_channels/).length, 0);
    }
    const none = await run(handler, req("GET", { query: { partner_id: PARTNER } }), rulesFor(world()));
    assert.equal(none.res.statusCode, 401);
    const post = await run(handler, req("POST", { body: {} }), [...asPartner(PARTNER), ...rulesFor(world())]);
    assert.equal(post.res.statusCode, 405);
  });
});
