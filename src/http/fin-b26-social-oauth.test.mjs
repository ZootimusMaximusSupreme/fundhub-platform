// finish-853 batch 26: GET /api/social/oauth (start and callback). The real handler, the real state
// signing (src/social/oauth.mjs) and the real token encryption (src/adplatforms/tokens.mjs) run over a
// stand-in database. The platform is a stand-in too: a recorded fetch that answers with fake pages and
// fake tokens, so nothing leaves the process. Practice test, fake data.
// The row's words: connects a social channel by OAuth. Start redirects to the platform with a signed
// state; callback exchanges the code and stores the encrypted token on social_channels. Not configured
// until the apps are provisioned. Caller: staff owner, admin, or partner.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import handler from "../../api/social/oauth.mjs";
import { signState, verifyState } from "../social/oauth.mjs";
import { decryptToken } from "../adplatforms/tokens.mjs";
import {
  run, req, asRole, asPartner, asClient, asAffiliate, inSql, sqlOf, wrote, pinned,
  ORG_ID, OTHER_ORG_ID, PARTNER, FOREIGN_PARTNER, ALL_STAFF_ROLES,
} from "../testing/fin-b26-kit.mjs";

// Fake values, built at run time. The key is 32 bytes of 7s, base64, as the encryption demands.
const ENV = Object.freeze({
  AD_TOKEN_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
  META_APP_ID: "fake-meta-app-id",
  META_APP_SECRET: ["fake", "meta", "app", "value"].join("-"),
  LINKEDIN_CLIENT_ID: "fake-linkedin-client-id",
  LINKEDIN_CLIENT_SECRET: ["fake", "linkedin", "value"].join("-"),
  APP_BASE_URL: "https://app.example.test",
});
const PAGE_TOKEN = "page-access-value-for-the-test";

function stand() {
  const t = {
    partners: [{ id: PARTNER, org_id: ORG_ID }, { id: FOREIGN_PARTNER, org_id: OTHER_ORG_ID }],
    social_channels: [],
  };
  const rules = [
    [/set_config\(/i, []],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\b/i, []],
    [/SELECT org_id FROM partners WHERE id = \$1/i, (sql, p) => inSql(t.partners, sql, p).slice(0, 1).map((r) => ({ org_id: r.org_id }))],
    [/^\s*INSERT INTO social_channels/i, (sql, p) => {
      const channel = /VALUES \(\$1,\$2,'(\w+)'/.exec(sql)[1];
      const linkedin = channel === "linkedin";
      const row = {
        org_id: p[0], partner_id: p[1], channel, external_account_id: p[2],
        handle: linkedin ? null : p[3], encrypted_access_token: linkedin ? p[3] : p[4],
        encrypted_refresh_token: linkedin ? p[4] : null, expires_in: linkedin ? p[5] : null,
        upsert: /ON CONFLICT \(partner_id, channel, external_account_id\) DO UPDATE/.test(sql),
        active: /'active'/.test(sql),
      };
      t.social_channels.push(row);
      return [];
    }],
  ];
  return { t, rules };
}

function platform({ pages, userToken = "user-access-value", tokenFails = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const text = String(url);
    if (/oauth\/access_token/.test(text)) return { json: async () => (tokenFails ? { error: "bad code" } : { access_token: userToken, expires_in: 5000 }) };
    if (/\/me\/accounts/.test(text)) return { json: async () => ({ data: pages ?? [] }) };
    if (/linkedin\.com\/oauth\/v2\/accessToken/.test(text)) {
      return { json: async () => (tokenFails ? { error: "bad code" } : { access_token: "li-access-value", expires_in: 3600, refresh_token: "li-refresh-value" }) };
    }
    throw new Error(`unexpected platform call ${text}`);
  };
  return { calls, fetchImpl };
}

const goodState = (over = {}, env = ENV) => signState({
  partnerId: PARTNER, channel: "facebook", orgId: ORG_ID, external_account_id: null, exp: Date.now() + 600000, ...over,
}, env);

const call = (who, query, { env = ENV, pf = platform(), s = stand() } = {}) =>
  run(handler, req("GET", { query }), [...who, ...s.rules], { env, fetchImpl: pf.fetchImpl })
    .then((out) => ({ ...out, t: s.t, pf }));

const owner = asRole("owner");

describe("GET /api/social/oauth, start", () => {
  test("start answers with the platform's own dialog and a state signed for this partner, this channel and this partner's company", async () => {
    const { res, fake, pf } = await call(owner, { action: "start", channel: "facebook", partner_id: FOREIGN_PARTNER });
    assert.equal(res.statusCode, 200);
    const url = new URL(res.body.url);
    assert.equal(url.hostname, "www.facebook.com");
    assert.match(url.pathname, /\/dialog\/oauth$/);
    assert.equal(url.searchParams.get("client_id"), ENV.META_APP_ID);
    assert.equal(url.searchParams.get("redirect_uri"), "https://app.example.test/api/social/oauth?action=callback&channel=facebook");
    assert.equal(url.searchParams.get("state"), res.body.state);
    assert.match(url.searchParams.get("scope"), /pages_manage_posts/);
    const state = verifyState(res.body.state, ENV);
    assert.equal(state.partnerId, FOREIGN_PARTNER);
    assert.equal(state.channel, "facebook");
    assert.equal(state.orgId, OTHER_ORG_ID, "the partner's own company, not the staff member's");
    assert.ok(state.exp > Date.now() && state.exp <= Date.now() + 16 * 60 * 1000, "a state lives about fifteen minutes");
    assert.equal(wrote(fake), false);
    assert.equal(pf.calls.length, 0, "starting calls no platform");
    assert.deepEqual(sqlOf(fake, /FROM partners/)[0].params, [FOREIGN_PARTNER]);
  });

  test("a state signed with another key does not verify; an expired one does not either", async () => {
    const other = { ...ENV, AD_TOKEN_ENC_KEY: Buffer.alloc(32, 9).toString("base64") };
    assert.equal(verifyState(goodState({}, other), ENV), null);
    assert.equal(verifyState(goodState({ exp: Date.now() - 1000 }), ENV), null);
    assert.deepEqual(verifyState(goodState(), ENV).partnerId, PARTNER);
  });

  test("linkedin needs its organization; with one the state carries it, and the dialog is LinkedIn's", async () => {
    const needs = await call(owner, { action: "start", channel: "linkedin", partner_id: PARTNER });
    assert.equal(needs.res.statusCode, 400);
    assert.equal(needs.res.body.error, "needs_org");
    const ok = await call(owner, { action: "start", channel: "linkedin", partner_id: PARTNER, external_account_id: "urn:li:organization:777" });
    assert.equal(ok.res.statusCode, 200);
    const url = new URL(ok.res.body.url);
    assert.equal(url.hostname, "www.linkedin.com");
    assert.equal(url.searchParams.get("client_id"), ENV.LINKEDIN_CLIENT_ID);
    assert.equal(verifyState(ok.res.body.state, ENV).external_account_id, "urn:li:organization:777");
    const withOrgEnv = { ...ENV, LINKEDIN_ORG_ID: "urn:li:organization:888" };
    const viaEnv = await call(owner, { action: "start", channel: "linkedin", partner_id: PARTNER }, { env: withOrgEnv });
    assert.equal(viaEnv.res.statusCode, 200);
    assert.equal(verifyState(viaEnv.res.body.state, withOrgEnv).external_account_id, "urn:li:organization:888");
  });

  test("until the apps are provisioned, start says what is missing and does not redirect", async () => {
    const noKey = await call(owner, { action: "start", channel: "facebook", partner_id: PARTNER }, { env: { ...ENV, AD_TOKEN_ENC_KEY: undefined } });
    assert.equal(noKey.res.statusCode, 503);
    assert.equal(noKey.res.body.error, "not_configured");
    assert.deepEqual(noKey.res.body.missing, ["AD_TOKEN_ENC_KEY"]);
    const noApp = await call(owner, { action: "start", channel: "instagram", partner_id: PARTNER }, { env: { ...ENV, META_APP_ID: undefined } });
    assert.equal(noApp.res.statusCode, 503);
    assert.deepEqual(noApp.res.body.missing, ["META_APP_ID"]);
    const noLi = await call(owner, { action: "start", channel: "linkedin", partner_id: PARTNER, external_account_id: "x" }, { env: { ...ENV, LINKEDIN_CLIENT_ID: undefined } });
    assert.equal(noLi.res.statusCode, 503);
    assert.deepEqual(noLi.res.body.missing, ["LINKEDIN_CLIENT_ID"]);
    for (const out of [noKey, noApp, noLi]) assert.equal(out.res.body.url, undefined);
  });

  test("bad input is the caller's error: an unknown channel, no partner, an unknown partner, an unknown action", async () => {
    const cases = [
      [{ action: "start", channel: "tiktok", partner_id: PARTNER }, 400, "invalid_channel"],
      [{ action: "start", channel: "facebook" }, 400, "partner_id_required"],
      [{ action: "start", channel: "facebook", partner_id: "a8000000-0000-4000-8000-000000000008" }, 404, "partner_not_found"],
      [{ action: "wipe", channel: "facebook", partner_id: PARTNER }, 400, "invalid_action"],
    ];
    for (const [query, status, error] of cases) {
      const { res, fake } = await call(owner, query);
      assert.equal(res.statusCode, status, JSON.stringify(query));
      assert.equal(res.body.error, error);
      assert.equal(wrote(fake), false);
    }
  });
});

describe("GET /api/social/oauth, callback", () => {
  test("facebook: the code is exchanged and each page is saved active for this partner and company, its token encrypted", async () => {
    const pages = [{ id: "page-9", name: "Acme Page", access_token: PAGE_TOKEN, instagram_business_account: { id: "ig-9" } }];
    // The state names the partner's own company and partner. The staff member and the address differ on purpose:
    // the row must follow the signed state, never the person who happened to click.
    const state = goodState({ partnerId: FOREIGN_PARTNER, orgId: OTHER_ORG_ID });
    const { res, t, pf, fake } = await call(owner, { action: "callback", channel: "facebook", state, code: "the-code", partner_id: PARTNER }, { pf: platform({ pages }) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.channels, [{ channel: "facebook", external_account_id: "page-9" }]);
    assert.equal(t.social_channels.length, 1);
    const row = t.social_channels[0];
    assert.equal(row.channel, "facebook");
    assert.equal(row.org_id, OTHER_ORG_ID);
    assert.equal(row.partner_id, FOREIGN_PARTNER);
    assert.equal(row.handle, "Acme Page");
    assert.equal(row.active, true);
    assert.equal(row.upsert, true, "connecting again refreshes the same account instead of adding a second");
    assert.notEqual(row.encrypted_access_token, PAGE_TOKEN, "stored encrypted, never as sent");
    assert.doesNotMatch(String(row.encrypted_access_token), new RegExp(PAGE_TOKEN));
    assert.equal(decryptToken(row.encrypted_access_token, { partnerId: FOREIGN_PARTNER, env: ENV }), PAGE_TOKEN);
    assert.throws(() => decryptToken(row.encrypted_access_token, { partnerId: PARTNER, env: ENV }), undefined, "bound to the partner it was stored for");
    // The code went to Meta's token endpoint with the same redirect it started with.
    const exchange = pf.calls[0];
    assert.match(exchange.url, /oauth\/access_token\?/);
    assert.equal(new URL(exchange.url).searchParams.get("code"), "the-code");
    assert.equal(new URL(exchange.url).searchParams.get("redirect_uri"), "https://app.example.test/api/social/oauth?action=callback&channel=facebook");
    // The write runs as staff inside its own transaction, and the response carries no token.
    assert.deepEqual(fake.calls.find((c) => /set_config\('fundhub\.actor'/.test(c.sql)).params, ["staff"]);
    assert.doesNotMatch(JSON.stringify(res.body), new RegExp(PAGE_TOKEN));
    pinned(sqlOf(fake, /INSERT INTO social_channels/)[0].sql, "a repeat connect updates the same account",
      "ON CONFLICT (partner_id, channel, external_account_id) DO UPDATE SET encrypted_access_token = EXCLUDED.encrypted_access_token");
  });

  test("instagram saves only the pages that have a linked business account, under that account's id", async () => {
    const pages = [
      { id: "page-1", name: "No IG", access_token: PAGE_TOKEN },
      { id: "page-2", name: "With IG", access_token: PAGE_TOKEN, instagram_business_account: { id: "ig-2" } },
    ];
    const { res, t } = await call(owner, { action: "callback", channel: "instagram", state: goodState({ channel: "instagram" }), code: "c" }, { pf: platform({ pages }) });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.channels, [{ channel: "instagram", external_account_id: "ig-2" }]);
    assert.deepEqual(t.social_channels.map((r) => [r.channel, r.external_account_id]), [["instagram", "ig-2"]]);
    const none = await call(owner, { action: "callback", channel: "instagram", state: goodState({ channel: "instagram" }), code: "c" },
      { pf: platform({ pages: [{ id: "page-1", name: "No IG", access_token: PAGE_TOKEN }] }) });
    assert.equal(none.res.statusCode, 400);
    assert.equal(none.res.body.error, "no_matching_accounts");
    assert.equal(none.t.social_channels.length, 0);
  });

  test("facebook with no pages is a 400 and saves nothing", async () => {
    const { res, t } = await call(owner, { action: "callback", channel: "facebook", state: goodState(), code: "c" }, { pf: platform({ pages: [] }) });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "no_pages");
    assert.equal(t.social_channels.length, 0);
  });

  test("linkedin: the organization number comes from the state, the access and refresh tokens are stored encrypted", async () => {
    const state = goodState({ channel: "linkedin", external_account_id: "urn:li:organization:777" });
    const { res, t, pf } = await call(owner, { action: "callback", channel: "linkedin", state, code: "li-code" });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, channel: "linkedin", external_account_id: "777" });
    const row = t.social_channels[0];
    assert.deepEqual([row.channel, row.org_id, row.partner_id, row.external_account_id], ["linkedin", ORG_ID, PARTNER, "777"]);
    assert.equal(decryptToken(row.encrypted_access_token, { partnerId: PARTNER, env: ENV }), "li-access-value");
    assert.equal(decryptToken(row.encrypted_refresh_token, { partnerId: PARTNER, env: ENV }), "li-refresh-value");
    assert.equal(row.expires_in, 3600);
    assert.equal(pf.calls[0].init.method, "POST");
    assert.equal(new URLSearchParams(pf.calls[0].init.body).get("code"), "li-code");
    const noOrg = await call(owner, { action: "callback", channel: "linkedin", state: goodState({ channel: "linkedin", external_account_id: null }), code: "c" });
    assert.equal(noOrg.res.statusCode, 400);
    assert.equal(noOrg.res.body.error, "needs_org");
    assert.equal(noOrg.t.social_channels.length, 0);
  });

  test("a callback with a tampered, expired or missing state, or no code, saves nothing and asks the platform nothing", async () => {
    const good = goodState();
    const tampered = `${good.split(".")[0]}.${"x".repeat(good.split(".")[1].length)}`;
    const forged = signState({ partnerId: FOREIGN_PARTNER, channel: "facebook", orgId: OTHER_ORG_ID, exp: Date.now() + 1e5 },
      { ...ENV, AD_TOKEN_ENC_KEY: Buffer.alloc(32, 1).toString("base64") });
    for (const [name, state] of [["tampered", tampered], ["expired", goodState({ exp: Date.now() - 1 })], ["missing", undefined], ["signed with another key", forged]]) {
      const { res, t, pf, fake } = await call(owner, { action: "callback", channel: "facebook", state, code: "c" });
      assert.equal(res.statusCode, 400, name);
      assert.equal(res.body.error, "invalid_state", name);
      assert.equal(pf.calls.length, 0, name);
      assert.equal(t.social_channels.length, 0, name);
      assert.equal(wrote(fake), false, name);
    }
    const noCode = await call(owner, { action: "callback", channel: "facebook", state: good });
    assert.equal(noCode.res.statusCode, 400);
    assert.equal(noCode.res.body.error, "missing_code");
    assert.equal(noCode.pf.calls.length, 0);
  });

  test("a refused code, or an app that is not provisioned, saves nothing and says which", async () => {
    const refused = await call(owner, { action: "callback", channel: "facebook", state: goodState(), code: "c" }, { pf: platform({ tokenFails: true }) });
    assert.equal(refused.res.statusCode, 400);
    assert.equal(refused.res.body.reason, "token_exchange_failed");
    assert.equal(refused.t.social_channels.length, 0);
    const noApp = await call(owner, { action: "callback", channel: "facebook", state: goodState(), code: "c" }, { env: { ...ENV, META_APP_SECRET: undefined } });
    assert.equal(noApp.res.statusCode, 503);
    assert.equal(noApp.res.body.reason, "not_configured");
    assert.deepEqual(noApp.res.body.missing, ["META_APP_SECRET"]);
    assert.equal(noApp.t.social_channels.length, 0);
  });
});

describe("GET /api/social/oauth, who may call", () => {
  test("only an owner or an admin of staff; every other staff role, a partner, a client and nobody are refused before anything runs", async () => {
    for (const role of ALL_STAFF_ROLES) {
      const { res, fake } = await call(asRole(role), { action: "start", channel: "facebook", partner_id: PARTNER });
      const allowed = role === "owner" || role === "admin";
      assert.equal(res.statusCode, allowed ? 200 : 403, role);
      if (!allowed) assert.equal(sqlOf(fake, /FROM partners/).length, 0, role);
    }
    for (const who of [asPartner(PARTNER), asClient(), asAffiliate()]) {
      const { res, fake } = await call(who, { action: "start", channel: "facebook", partner_id: PARTNER });
      assert.equal(res.statusCode, 403);
      assert.equal(sqlOf(fake, /FROM partners/).length, 0);
    }
    const s = stand();
    const none = await run(handler, req("GET", { query: { action: "start", channel: "facebook", partner_id: PARTNER } }), s.rules, { env: ENV });
    assert.equal(none.res.statusCode, 401);
    assert.equal((await run(handler, req("POST", { body: {} }), [...owner, ...s.rules], { env: ENV })).res.statusCode, 405);
  });
});
