// Practice test (fake data, real handler): the OAuth return on the social
// studio. The provider sends the person back to GET /api/social/oauth?action=
// callback; the handler checks the signed state, trades the code for tokens,
// and saves each account with its token encrypted and tied to the partner.
// The database is the stand-in from src/testing/handler-harness.mjs, which also
// takes the transaction the handler opens, so nothing live is written. The
// provider is a stand-in fetch that is strict like the real one: it hands out a
// token only when the request carries this app's id, its secret, the code and
// the return address.
//
// The stand-in database does not run SQL, so the test reads each saved
// statement itself: it lists the columns, evaluates every value the way
// Postgres would (bound value, quoted literal, NOW(), the expiry CASE),
// checks the row against the real table definition in db/migrations/049_social.sql
// (allowed channels and states, required columns, the "active needs a token"
// rule, the unique key), and then plays the reconnect: an expired channel with
// an old token must come out active, error cleared, token and expiry replaced.
// The test also decrypts what would be saved to prove the stored value is the
// encrypted token and not the plain one.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import handler from "../../../../api/social/oauth.mjs";
import { decryptToken } from "../../../adplatforms/tokens.mjs";
import { linkedinAuthUrl, metaAuthUrl, signState } from "../../../social/oauth.mjs";
import {
  fakeDb, makeRes, ORG_ID, req, runWithSharedDb, staffSession,
} from "../../../testing/handler-harness.mjs";

const PARTNER = "11111111-2222-4333-8444-555555555555";
const OTHER_PARTNER = "99999999-2222-4333-8444-555555555555";
// The company the signed state names. It is NOT the staff member's company (ORG_ID),
// so a save that took its company from the session instead of the state is a different row.
const STATE_ORG = "0c000000-0000-4000-8000-0000000000c3";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
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
  return signState({ partnerId: PARTNER, channel: "facebook", orgId: STATE_ORG, external_account_id: null, exp: Date.now() + 60_000, ...over }, env);
}

function jsonFetch(log, answers) {
  return async (url, init) => {
    log.push({ url: String(url), method: (init && init.method) || "GET", body: init && init.body ? String(init.body) : null });
    const found = answers.find((a) => String(url).includes(a.match));
    const body = found ? found.body : {};
    return { ok: true, status: 200, json: async () => body };
  };
}

/**
 * A provider that behaves like the real one: it answers with a token only when
 * the request is the right one. `expect` = { code, redirectUri, userToken, accessToken,
 * refreshToken, expiresIn, pages }. Every request is logged in `log`.
 */
function strictProvider(log, env, expect) {
  const refuse = (why) => ({ error: { message: `provider refused: ${why}` } });
  return async (url, init) => {
    const text = String(url);
    log.push({ url: text, method: (init && init.method) || "GET", body: init && init.body ? String(init.body) : null });
    let body;
    if (text.includes("graph.facebook.com") && text.includes("/oauth/access_token")) {
      const q = new URL(text).searchParams;
      const wrong = ["client_id", "client_secret", "redirect_uri", "code"].find((k) => q.get(k) !== {
        client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: expect.redirectUri, code: expect.code,
      }[k]);
      body = wrong ? refuse(`${wrong} did not match`) : { access_token: expect.userToken, expires_in: expect.expiresIn ?? 5184000 };
    } else if (text.includes("graph.facebook.com") && text.includes("/me/accounts")) {
      const q = new URL(text).searchParams;
      body = q.get("access_token") === expect.userToken ? { data: expect.pages } : refuse("user token not presented");
    } else if (text.includes("linkedin.com/oauth/v2/accessToken")) {
      const form = new URLSearchParams(String((init && init.body) || ""));
      const want = {
        grant_type: "authorization_code", code: expect.code, redirect_uri: expect.redirectUri,
        client_id: env.LINKEDIN_CLIENT_ID, client_secret: env.LINKEDIN_CLIENT_SECRET,
      };
      const wrong = Object.keys(want).find((k) => form.get(k) !== want[k]);
      body = wrong
        ? { error: "invalid_request", error_description: `${wrong} did not match` }
        : { access_token: expect.accessToken, expires_in: expect.expiresIn ?? 5184000, ...(expect.refreshToken ? { refresh_token: expect.refreshToken } : {}) };
    } else {
      body = refuse("unknown address");
    }
    return { ok: true, status: 200, json: async () => body };
  };
}

// ---- reading a saved statement the way Postgres would ----------------------------------

function splitTop(text) {
  const out = [];
  let depth = 0; let quote = false; let cur = "";
  for (const ch of text) {
    if (ch === "'") quote = !quote;
    if (!quote) { if (ch === "(") depth += 1; if (ch === ")") depth -= 1; }
    if (ch === "," && depth === 0 && !quote) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function evalExpr(expr, { params, now, excluded = {} }) {
  const e = expr.trim();
  let m;
  if ((m = /^\$(\d+)$/.exec(e))) return params[Number(m[1]) - 1];
  if (/^NULL$/i.test(e)) return null;
  if ((m = /^'((?:[^']|'')*)'(::jsonb)?$/.exec(e))) return m[2] ? JSON.parse(m[1]) : m[1].replace(/''/g, "'");
  if (/^now\(\)$/i.test(e)) return now;
  if ((m = /^EXCLUDED\.(\w+)$/.exec(e))) return excluded[m[1]];
  if ((m = /^CASE WHEN \$(\d+)::int IS NULL THEN NULL ELSE now\(\) \+ \(\$\1 \|\| ' seconds'\)::interval END$/.exec(e))) {
    const v = params[Number(m[1]) - 1];
    return v === null || v === undefined ? null : now + Number(v) * 1000;
  }
  throw new Error(`cannot read this value: ${e}`);
}

/** The social_channels table as db/migrations/049_social.sql defines it. */
function tableDefinition() {
  const sql = fs.readFileSync(path.join(ROOT, "db/migrations/049_social.sql"), "utf8");
  const list = (re) => [...(re.exec(sql)?.[1] || "").matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const body = /CREATE TABLE IF NOT EXISTS social_channels \(([\s\S]*?)\n\);/.exec(sql)[1];
  const required = []; const defaults = {}; const columns = [];
  for (const line of body.split("\n")) {
    const col = /^\s{2}(\w+)\s+(uuid|text|jsonb|timestamptz)\b(.*)$/.exec(line);
    if (!col) continue;
    const [, name, , rest] = col;
    columns.push(name);
    const dflt = /DEFAULT\s+('(?:[^']|'')*'(?:::jsonb)?|now\(\)|gen_random_uuid\(\))/.exec(rest);
    if (dflt) defaults[name] = dflt[1];
    if (/NOT NULL/.test(rest) && !dflt) required.push(name);
  }
  return {
    columns,
    required,
    defaults,
    channels: list(/social_channels_channel_ck CHECK \(channel IN\s*\(([^)]*)\)\)/),
    states: list(/social_channels_state_ck\s+CHECK \(connection_state IN \(([^)]*)\)\)/),
    unique: (/CREATE UNIQUE INDEX IF NOT EXISTS social_channels_uniq\s+ON social_channels \(([^)]*)\)/.exec(sql)?.[1] || "").split(",").map((x) => x.trim()),
  };
}
const TABLE = tableDefinition();

/** What one saved statement would put in the table, and what a reconnect would do to an existing row. */
function readSave(call, now) {
  const flat = call.sql.replace(/\s+/g, " ").trim();
  const m = /^INSERT INTO (\w+) \(([^)]*)\) VALUES \((.*)\) ON CONFLICT \(([^)]*)\) DO UPDATE SET (.*)$/.exec(flat);
  if (!m) throw new Error(`cannot read this statement: ${flat.slice(0, 80)}`);
  const [, table, cols, vals, conflict, set] = m;
  const names = cols.split(",").map((c) => c.trim());
  const exprs = splitTop(vals);
  assert.equal(names.length, exprs.length, "one value for every column");
  const row = Object.fromEntries(TABLE.columns.map((name) => [name, null]));
  for (const [name, dflt] of Object.entries(TABLE.defaults)) {
    if (/gen_random_uuid|now\(\)/.test(dflt)) continue;
    row[name] = evalExpr(dflt, { params: [], now });
  }
  names.forEach((name, i) => { row[name] = evalExpr(exprs[i], { params: call.params, now }); });
  const updates = splitTop(set).map((assignment) => {
    const [col, ...rest] = assignment.split("=");
    return [col.trim(), rest.join("=").trim()];
  });
  const reconnect = (existing) => {
    const next = { ...existing };
    for (const [col, expr] of updates) next[col] = evalExpr(expr, { params: call.params, now, excluded: row });
    return next;
  };
  return { table, row, conflict: conflict.split(",").map((c) => c.trim()), reconnect };
}

const PUBLISH_SCOPE = { facebook: "pages_manage_posts", instagram: "instagram_content_publish", linkedin: "w_member_social" };

function requestedScopes(channel, env) {
  if (channel === "linkedin") {
    const url = new URL(linkedinAuthUrl({ clientId: env.LINKEDIN_CLIENT_ID, redirectUri: "https://x.test/cb", state: "s" }).url);
    return url.searchParams.get("scope").split(" ");
  }
  const url = new URL(metaAuthUrl({ appId: env.META_APP_ID, redirectUri: "https://x.test/cb", state: "s" }).url);
  return url.searchParams.get("scope").split(",");
}

/** Judge one saved channel: the row is allowed by the table, is the right row, and can post. */
function judgeSaved(call, { channel, external, handle, token, refresh, expiresIn, env, now }) {
  const saved = readSave(call, now);
  const { row } = saved;
  assert.equal(saved.table, "social_channels");
  assert.deepEqual(saved.conflict, TABLE.unique, "one account is one row: the repeat-return key is the table's unique key");
  for (const col of TABLE.required) assert.ok(row[col] !== undefined && row[col] !== null, `required column ${col} is filled`);
  assert.ok(TABLE.channels.includes(row.channel), `channel ${row.channel} is one the table allows`);
  assert.ok(TABLE.states.includes(row.connection_state), `state ${row.connection_state} is one the table allows`);
  if (row.connection_state === "active") assert.ok(row.encrypted_access_token, "an active channel has a token");
  // the right row
  assert.equal(row.channel, channel, "saved under the channel that was connected");
  assert.equal(row.external_account_id, external);
  assert.equal(row.partner_id, PARTNER);
  assert.equal(row.org_id, STATE_ORG);
  if (handle !== undefined) assert.equal(row.handle, handle);
  // a connection that can be used: the scheduler posts only through an active channel
  assert.equal(row.connection_state, "active", "a freshly connected channel is active, not pending");
  assert.equal(row.last_error, null);
  const asked = requestedScopes(channel, env);
  assert.ok(Array.isArray(row.scopes) && row.scopes.length > 0, "scopes are saved");
  assert.ok(row.scopes.includes(PUBLISH_SCOPE[channel]), `the permission to post (${PUBLISH_SCOPE[channel]}) is saved`);
  for (const scope of row.scopes) assert.ok(asked.includes(scope), `${scope} is a permission that was asked for`);
  // the token is the encrypted one and opens only for this partner
  assert.notEqual(row.encrypted_access_token, token);
  assert.equal(decryptToken(row.encrypted_access_token, { partnerId: PARTNER, env }), token);
  if (refresh) {
    assert.notEqual(row.encrypted_refresh_token, refresh);
    assert.equal(decryptToken(row.encrypted_refresh_token, { partnerId: PARTNER, env }), refresh);
  }
  if (expiresIn !== undefined) {
    assert.equal(row.token_expires_at, expiresIn === null ? null : now + expiresIn * 1000, "expiry is now plus what the provider said");
  }
  // a repeat return of an expired, broken channel: back to active, error gone, new tokens
  const before = {
    org_id: STATE_ORG, partner_id: PARTNER, channel, external_account_id: external,
    handle: "Old Name", encrypted_access_token: "old-access-cipher", encrypted_refresh_token: "old-refresh-cipher",
    token_expires_at: now - 86_400_000, scopes: ["old_scope"], connection_state: "expired", last_error: "token expired",
  };
  const after = saved.reconnect(before);
  assert.equal(after.connection_state, "active", "a reconnect brings an expired channel back to active");
  assert.equal(after.last_error, null, "a reconnect clears the old error");
  assert.equal(after.encrypted_access_token, row.encrypted_access_token, "a reconnect replaces the token");
  if (refresh) assert.equal(after.encrypted_refresh_token, row.encrypted_refresh_token, "a reconnect replaces the refresh token");
  if (expiresIn !== undefined) assert.equal(after.token_expires_at, row.token_expires_at, "a reconnect replaces the expiry");
  assert.equal(after.channel, channel);
  assert.equal(after.partner_id, PARTNER);
  return { row, after };
}

async function callback({ env, query, answers = [], failInsert = false, signedIn = true, fetchImpl = null }) {
  const fetchLog = [];
  const fake = fakeDb([
    ...(signedIn ? [staffSession()] : []),
    [/INSERT INTO social_channels/, () => (failInsert ? new Error("insert refused") : { rows: [], rowCount: 1 })],
  ]);
  const response = makeRes();
  await runWithSharedDb(fake, () => handler(
    req("GET", { query }),
    response,
    { db: fake, env, fetchImpl: fetchImpl ? fetchImpl(fetchLog) : jsonFetch(fetchLog, answers) },
  ));
  return { fake, response, fetchLog, inserts: fake.find(/INSERT INTO social_channels/) };
}

const NOW = 1_800_000_000_000;
const FACEBOOK_RETURN = "https://app.example.test/api/social/oauth?action=callback&channel=facebook";
const INSTAGRAM_RETURN = "https://app.example.test/api/social/oauth?action=callback&channel=instagram";
const LINKEDIN_RETURN = "https://app.example.test/api/social/oauth?action=callback&channel=linkedin";

test("Facebook return: each page is saved, active, with its token encrypted, for the partner and company the signed state names", async () => {
  const env = makeEnv();
  const userToken = `user-${rand()}`;
  const pageOne = `page-${rand()}`;
  const pageTwo = `page-${rand()}`;
  const pages = [
    { id: "1001", name: "Acme Page", access_token: pageOne, instagram_business_account: { id: "9001" } },
    { id: "1002", name: "Beta Page", access_token: pageTwo },
  ];
  // The person's own address bar also carries a partner_id and org_id of somebody else: neither may win over the signed state.
  const out = await callback({
    env,
    query: { action: "callback", channel: "facebook", code: "code-abc", state: stateFor(env), partner_id: OTHER_PARTNER, org_id: ORG_ID },
    fetchImpl: (log) => strictProvider(log, env, { code: "code-abc", redirectUri: FACEBOOK_RETURN, userToken, pages }),
  });

  assert.equal(out.response.statusCode, 200);
  assert.deepEqual(out.response.body, { ok: true, channels: [
    { channel: "facebook", external_account_id: "1001" },
    { channel: "facebook", external_account_id: "1002" },
  ] });
  // the code went to the provider with this app, its secret and this return address (the strict provider refuses otherwise)
  const exchange = new URL(out.fetchLog[0].url);
  assert.equal(exchange.pathname.endsWith("/oauth/access_token"), true);
  assert.equal(exchange.searchParams.get("code"), "code-abc");
  assert.equal(exchange.searchParams.get("client_id"), env.META_APP_ID);
  assert.equal(exchange.searchParams.get("client_secret"), env.META_APP_SECRET);
  assert.equal(exchange.searchParams.get("redirect_uri"), FACEBOOK_RETURN);
  assert.equal(out.fetchLog.length, 2, "one token exchange and one pages read");

  // two accounts, each saved once
  assert.equal(out.inserts.length, 2);
  const first = judgeSaved(out.inserts[0], { channel: "facebook", external: "1001", handle: "Acme Page", token: pageOne, env, now: NOW });
  const second = judgeSaved(out.inserts[1], { channel: "facebook", external: "1002", handle: "Beta Page", token: pageTwo, env, now: NOW });
  assert.equal(first.row.encrypted_refresh_token ?? null, null);
  assert.equal(second.row.partner_id, PARTNER);
  // what is stored opens only for this partner
  assert.throws(() => decryptToken(first.row.encrypted_access_token, { partnerId: OTHER_PARTNER, env }), (error) => error.code === "TOKEN_AUTH_FAILED");
  // the save is one transaction that was told who is acting, and it committed
  assert.equal(out.fake.find(/set_config\('fundhub\.actor'/)[0].params[0], "staff");
  assert.equal(out.fake.count("BEGIN"), 1);
  assert.equal(out.fake.count("COMMIT"), 1);
  assert.equal(out.fake.count("ROLLBACK"), 0);
});

test("Instagram return saves only the pages that have an Instagram business account, as active Instagram channels", async () => {
  const env = makeEnv();
  const pageOne = `page-${rand()}`;
  const userToken = `user-${rand()}`;
  const pages = [
    { id: "1001", name: "Acme Page", access_token: pageOne, instagram_business_account: { id: "9001" } },
    { id: "1002", name: "Beta Page", access_token: `page-${rand()}` },
  ];
  const out = await callback({
    env,
    query: { action: "callback", channel: "instagram", code: "c", state: stateFor(env, { channel: "instagram" }), partner_id: OTHER_PARTNER },
    fetchImpl: (log) => strictProvider(log, env, { code: "c", redirectUri: INSTAGRAM_RETURN, userToken, pages }),
  });
  assert.equal(out.response.statusCode, 200);
  assert.deepEqual(out.response.body.channels, [{ channel: "instagram", external_account_id: "9001" }]);
  assert.equal(out.inserts.length, 1);
  judgeSaved(out.inserts[0], { channel: "instagram", external: "9001", handle: "Acme Page", token: pageOne, env, now: NOW });
});

test("LinkedIn return saves the organization active, with its access and refresh tokens encrypted and a real expiry", async () => {
  const env = makeEnv();
  const access = `li-access-${rand()}`;
  const refresh = `li-refresh-${rand()}`;
  const out = await callback({
    env,
    query: {
      action: "callback", channel: "linkedin", code: "li-code", partner_id: OTHER_PARTNER,
      state: stateFor(env, { channel: "linkedin", external_account_id: "urn:li:organization:777" }),
    },
    fetchImpl: (log) => strictProvider(log, env, { code: "li-code", redirectUri: LINKEDIN_RETURN, accessToken: access, refreshToken: refresh, expiresIn: 5184000 }),
  });
  assert.equal(out.response.statusCode, 200);
  assert.deepEqual(out.response.body, { ok: true, channel: "linkedin", external_account_id: "777" });
  assert.equal(out.fetchLog.length, 1);
  assert.equal(out.fetchLog[0].method, "POST");
  const form = new URLSearchParams(out.fetchLog[0].body);
  assert.equal(form.get("code"), "li-code");
  assert.equal(form.get("client_id"), env.LINKEDIN_CLIENT_ID);
  assert.equal(form.get("client_secret"), env.LINKEDIN_CLIENT_SECRET);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("redirect_uri"), LINKEDIN_RETURN);
  assert.equal(out.inserts.length, 1);
  judgeSaved(out.inserts[0], { channel: "linkedin", external: "777", token: access, refresh, expiresIn: 5184000, env, now: NOW });
});

test("LinkedIn with no expiry given saves no expiry, never a made-up one", async () => {
  const env = makeEnv();
  const access = `li-access-${rand()}`;
  const answers = [{ match: "linkedin.com/oauth/v2/accessToken", body: { access_token: access } }];
  const out = await callback({
    env,
    query: { action: "callback", channel: "linkedin", code: "c", state: stateFor(env, { channel: "linkedin", external_account_id: "urn:li:organization:42" }) },
    answers,
  });
  assert.equal(out.response.statusCode, 200);
  const saved = judgeSaved(out.inserts[0], { channel: "linkedin", external: "42", token: access, expiresIn: null, env, now: NOW });
  assert.equal(saved.row.encrypted_refresh_token, null);
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
