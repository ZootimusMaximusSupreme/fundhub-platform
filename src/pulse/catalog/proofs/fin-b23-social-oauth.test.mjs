// Practice test (fake data, real handler): the OAuth return on the social
// studio. The provider sends the person back to GET /api/social/oauth?action=
// callback; the handler checks the signed state, trades the code for tokens,
// and saves each account with its token encrypted and tied to the partner.
// The database is the stand-in from src/testing/handler-harness.mjs, which also
// takes the transaction the handler opens, so nothing live is written. The
// provider is a stand-in fetch. The test decrypts what would be saved to prove
// the stored value is the encrypted token and not the plain one.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import handler from "../../../../api/social/oauth.mjs";
import { decryptToken } from "../../../adplatforms/tokens.mjs";
import { signState } from "../../../social/oauth.mjs";
import {
  fakeDb, makeRes, ORG_ID, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";

const PARTNER = "11111111-2222-4333-8444-555555555555";
const OTHER_PARTNER = "99999999-2222-4333-8444-555555555555";
const rand = () => crypto.randomBytes(12).toString("hex");

function makeEnv() {
  return {
    AD_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64"),
    META_APP_ID: `app-${rand()}`,
    META_APP_SECRET: `sec-${rand()}`,
    LINKEDIN_CLIENT_ID: `li-${rand()}`,
    LINKEDIN_CLIENT_SECRET: `lis-${rand()}`,
    APP_BASE_URL: "https://app.example.test",
  };
}

function stateFor(env, over = {}) {
  return signState({ partnerId: PARTNER, channel: "facebook", orgId: ORG_ID, external_account_id: null, exp: Date.now() + 60_000, ...over }, env);
}

function jsonFetch(log, answers) {
  return async (url, init) => {
    log.push({ url: String(url), method: (init && init.method) || "GET", body: init && init.body ? String(init.body) : null });
    const found = answers.find((a) => String(url).includes(a.match));
    const body = found ? found.body : {};
    return { ok: true, status: 200, json: async () => body };
  };
}

async function callback({ env, query, answers = [], failInsert = false, signedIn = true }) {
  const fetchLog = [];
  const fake = fakeDb([
    ...(signedIn ? [staffSession()] : []),
    [/INSERT INTO social_channels/, () => (failInsert ? new Error("insert refused") : { rows: [], rowCount: 1 })],
  ]);
  const response = makeRes();
  await runWithSharedDb(fake, () => handler(
    req("GET", { query }),
    response,
    { db: fake, env, fetchImpl: jsonFetch(fetchLog, answers) },
  ));
  return { fake, response, fetchLog, inserts: fake.find(/INSERT INTO social_channels/) };
}

test("Facebook return: each page is saved with its token encrypted for this partner", async () => {
  const env = makeEnv();
  const userToken = `user-${rand()}`;
  const pageOne = `page-${rand()}`;
  const pageTwo = `page-${rand()}`;
  const answers = [
    { match: "/oauth/access_token", body: { access_token: userToken, expires_in: 5184000 } },
    { match: "/me/accounts", body: { data: [
      { id: "1001", name: "Acme Page", access_token: pageOne, instagram_business_account: { id: "9001" } },
      { id: "1002", name: "Beta Page", access_token: pageTwo },
    ] } },
  ];
  const out = await callback({ env, query: { action: "callback", channel: "facebook", code: "code-abc", state: stateFor(env) }, answers });

  assert.equal(out.response.statusCode, 200);
  assert.deepEqual(out.response.body, { ok: true, channels: [
    { channel: "facebook", external_account_id: "1001" },
    { channel: "facebook", external_account_id: "1002" },
  ] });
  // the code went to the provider with this app and this return address
  const exchange = new URL(out.fetchLog[0].url);
  assert.equal(exchange.pathname.endsWith("/oauth/access_token"), true);
  assert.equal(exchange.searchParams.get("code"), "code-abc");
  assert.equal(exchange.searchParams.get("client_id"), env.META_APP_ID);
  assert.equal(exchange.searchParams.get("redirect_uri"), "https://app.example.test/api/social/oauth?action=callback&channel=facebook");

  // two accounts, each saved once, for the partner the signed state names
  assert.equal(out.inserts.length, 2);
  const [first, second] = out.inserts.map((c) => c.params);
  assert.deepEqual([first[0], first[1], first[2], first[3]], [ORG_ID, PARTNER, "1001", "Acme Page"]);
  assert.deepEqual([second[0], second[1], second[2], second[3]], [ORG_ID, PARTNER, "1002", "Beta Page"]);
  // what is stored is the encrypted token: never the plain one, and it opens only for this partner
  assert.notEqual(first[4], pageOne);
  assert.equal(String(first[4]).includes(pageOne), false);
  assert.equal(decryptToken(first[4], { partnerId: PARTNER, env }), pageOne);
  assert.equal(decryptToken(second[4], { partnerId: PARTNER, env }), pageTwo);
  assert.throws(() => decryptToken(first[4], { partnerId: OTHER_PARTNER, env }), (error) => error.code === "TOKEN_AUTH_FAILED");
  // the save is one transaction that was told who is acting, and it committed
  assert.equal(out.fake.find(/set_config\('fundhub\.actor'/)[0].params[0], "staff");
  assert.equal(out.fake.count("BEGIN"), 1);
  assert.equal(out.fake.count("COMMIT"), 1);
  assert.equal(out.fake.count("ROLLBACK"), 0);
  // one account is one row: a repeat return updates it instead of adding a second
  assert.match(out.inserts[0].sql, /ON CONFLICT \(partner_id, channel, external_account_id\) DO UPDATE SET/);
  assert.match(out.inserts[0].sql, /encrypted_access_token = EXCLUDED\.encrypted_access_token/);
});

test("Instagram return saves only the pages that have an Instagram business account", async () => {
  const env = makeEnv();
  const pageOne = `page-${rand()}`;
  const answers = [
    { match: "/oauth/access_token", body: { access_token: `user-${rand()}` } },
    { match: "/me/accounts", body: { data: [
      { id: "1001", name: "Acme Page", access_token: pageOne, instagram_business_account: { id: "9001" } },
      { id: "1002", name: "Beta Page", access_token: `page-${rand()}` },
    ] } },
  ];
  const out = await callback({ env, query: { action: "callback", channel: "instagram", code: "c", state: stateFor(env, { channel: "instagram" }) }, answers });
  assert.equal(out.response.statusCode, 200);
  assert.deepEqual(out.response.body.channels, [{ channel: "instagram", external_account_id: "9001" }]);
  assert.equal(out.inserts.length, 1);
  assert.equal(out.inserts[0].params[2], "9001");
  assert.equal(decryptToken(out.inserts[0].params[4], { partnerId: PARTNER, env }), pageOne);
});

test("LinkedIn return saves the organization with its access and refresh tokens encrypted", async () => {
  const env = makeEnv();
  const access = `li-access-${rand()}`;
  const refresh = `li-refresh-${rand()}`;
  const answers = [{ match: "linkedin.com/oauth/v2/accessToken", body: { access_token: access, expires_in: 5184000, refresh_token: refresh } }];
  const out = await callback({
    env,
    query: { action: "callback", channel: "linkedin", code: "li-code", state: stateFor(env, { channel: "linkedin", external_account_id: "urn:li:organization:777" }) },
    answers,
  });
  assert.equal(out.response.statusCode, 200);
  assert.deepEqual(out.response.body, { ok: true, channel: "linkedin", external_account_id: "777" });
  assert.equal(out.fetchLog.length, 1);
  assert.equal(out.fetchLog[0].method, "POST");
  assert.match(out.fetchLog[0].body, /code=li-code/);
  assert.equal(out.inserts.length, 1);
  const [orgId, partnerId, external, encAccess, encRefresh, expiresIn] = out.inserts[0].params;
  assert.deepEqual([orgId, partnerId, external, expiresIn], [ORG_ID, PARTNER, "777", 5184000]);
  assert.notEqual(encAccess, access);
  assert.notEqual(encRefresh, refresh);
  assert.equal(decryptToken(encAccess, { partnerId: PARTNER, env }), access);
  assert.equal(decryptToken(encRefresh, { partnerId: PARTNER, env }), refresh);
});

test("a bad return saves nothing: forged, expired or missing state, no code, refused exchange, no pages", async () => {
  const env = makeEnv();
  const noInsert = (out, status, error) => {
    assert.equal(out.response.statusCode, status);
    assert.equal(out.response.body.error, error);
    assert.equal(out.inserts.length, 0, `${error}: nothing saved`);
    assert.equal(out.fake.count("BEGIN"), 0, `${error}: no transaction opened`);
  };
  const good = { access_token: `user-${rand()}` };

  // signed with another key
  const forged = await callback({ env, query: { action: "callback", channel: "facebook", code: "c", state: stateFor(makeEnv()) } });
  noInsert(forged, 400, "invalid_state");
  assert.equal(forged.fetchLog.length, 0, "the provider is not called for a forged state");
  // expired
  noInsert(await callback({ env, query: { action: "callback", channel: "facebook", code: "c", state: stateFor(env, { exp: Date.now() - 1000 }) } }), 400, "invalid_state");
  // no state at all
  noInsert(await callback({ env, query: { action: "callback", channel: "facebook", code: "c" } }), 400, "invalid_state");
  // good state, no code
  const noCode = await callback({ env, query: { action: "callback", channel: "facebook", state: stateFor(env) } });
  noInsert(noCode, 400, "missing_code");
  assert.equal(noCode.fetchLog.length, 0);
  // provider refuses the code
  const refused = await callback({ env, query: { action: "callback", channel: "facebook", code: "bad", state: stateFor(env) }, answers: [{ match: "/oauth/access_token", body: { error: { message: "code expired" } } }] });
  assert.equal(refused.response.statusCode, 400);
  assert.equal(refused.response.body.reason, "token_exchange_failed");
  assert.equal(refused.inserts.length, 0);
  // the person has no pages
  noInsert(await callback({ env, query: { action: "callback", channel: "facebook", code: "c", state: stateFor(env) }, answers: [
    { match: "/oauth/access_token", body: good }, { match: "/me/accounts", body: { data: [] } },
  ] }), 400, "no_pages");
  // not signed in
  const signedOut = await callback({ env, signedIn: false, query: { action: "callback", channel: "facebook", code: "c", state: stateFor(env) }, answers: [{ match: "/oauth/access_token", body: good }] });
  assert.equal(signedOut.response.statusCode, 401);
  assert.equal(signedOut.fetchLog.length, 0);
  assert.equal(signedOut.inserts.length, 0);
});

test("when the save fails the whole return is rolled back and reported, never half saved", async () => {
  const env = makeEnv();
  const out = await callback({
    env,
    failInsert: true,
    query: { action: "callback", channel: "facebook", code: "c", state: stateFor(env) },
    answers: [
      { match: "/oauth/access_token", body: { access_token: `user-${rand()}` } },
      { match: "/me/accounts", body: { data: [{ id: "1001", name: "Acme Page", access_token: `page-${rand()}` }] } },
    ],
  });
  assert.equal(out.response.statusCode, 500);
  assert.equal(out.response.body.error, "oauth_failed");
  assert.equal(out.fake.count("ROLLBACK"), 1);
  assert.equal(out.fake.count("COMMIT"), 0);
});
