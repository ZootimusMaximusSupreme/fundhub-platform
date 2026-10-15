// finish-853 batch 08: POST /api/campaigns/meta-agency. The real handler, the real Meta request
// builders and the real token encryption run over a stand-in partner and ad_platform_connections
// table, with a recording stand-in for the one web call. The row's words: save a partner's Meta
// Business id and send Meta an agency-access request (state stays pending). Practice test, fake
// data; nothing leaves the process, no database, no real token.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import handler from "../../api/campaigns/meta-agency.mjs";
import { decryptToken } from "../adplatforms/tokens.mjs";
import { fakeDb, makeRes, req, runWithSharedDb, staffSession, accountSession, ORG_ID, OTHER_ORG_ID } from "../testing/handler-harness.mjs";
import { bindProblem } from "../testing/s3-scoped-rows.mjs";

const PARTNER = "d1000000-0000-4000-8000-000000000001";
const OTHER_PARTNER = "d2000000-0000-4000-8000-000000000002";
const AGENCY = "1122334455";
const CLIENT_BIZ = "9988776655";
const TOKEN = ["meta", "agency", "token", "for", "tests"].join("-");
const ENV = () => ({ META_BUSINESS_ID: AGENCY, META_ACCESS_TOKEN: TOKEN, AD_TOKEN_ENC_KEY: crypto.randomBytes(32).toString("base64") });

function metaFile({ connections = [] } = {}) {
  const state = { connections, fetches: [] };
  let seq = 0;
  const fake = fakeDb([
    [/^\s*SELECT id, org_id FROM partners WHERE id = \$1/i, (_s, p) => [{ id: PARTNER, org_id: ORG_ID }, { id: OTHER_PARTNER, org_id: OTHER_ORG_ID }].filter((r) => r.id === p[0])],
    [/^\s*INSERT INTO ad_platform_connections/i, (s, p) => {
      const [org_id, partner_id, external_business_id, external_ad_account_id, enc, scopes, last_error] = p;
      const existing = state.connections.find((c) => c.partner_id === partner_id && c.platform === "meta" && c.external_ad_account_id === external_ad_account_id);
      if (existing) {
        existing.external_business_id = external_business_id;
        existing.encrypted_access_token = enc ?? existing.encrypted_access_token;
        // The statement's own CASE: an active connection stays active, anything else stays pending.
        if (/WHEN ad_platform_connections\.connection_state = 'active' THEN 'active'\s+ELSE 'pending'/.test(s)) {
          existing.connection_state = existing.connection_state === "active" ? "active" : "pending";
        } else existing.connection_state = "pending";
        existing.last_error = last_error;
        return [{ ...existing, has_access_token: !!existing.encrypted_access_token }];
      }
      const row = { id: `f${++seq}000000-0000-4000-8000-000000000000`, org_id, partner_id, platform: "meta", external_business_id, external_ad_account_id,
        encrypted_access_token: enc, scopes: JSON.parse(scopes), connection_state: /VALUES \([^)]*'pending'/.test(s) ? "pending" : "active", last_error };
      state.connections.push(row);
      return [{ ...row, has_access_token: !!enc }];
    }],
    [/^\s*(BEGIN|COMMIT|ROLLBACK)\b|set_config/i, []],
  ]);
  const inner = fake.query;
  fake.query = async (sql, params = []) => {
    const text = typeof sql === "string" ? sql : sql.text;
    const args = typeof sql === "string" ? params : sql.values;
    const problem = bindProblem(text, args);
    if (problem) throw Object.assign(new Error(`bind: ${problem}`), { code: "08P01" });
    return inner(sql, params);
  };
  fake.connect = async () => ({ query: fake.query, release() {} });
  fake.state = state;
  return fake;
}

const metaOk = () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ success: true }) });
const metaRefused = (status = 400, message = "Capability not granted") => ({
  ok: false, status, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message, code: 3 } }),
});

async function call(body, fake, { who = [staffSession({ role: "owner" })], env = ENV(), responses = () => metaOk() } = {}) {
  const session = fakeDb(who);
  const res = makeRes();
  const combined = {
    calls: fake.calls,
    query: (sql, params) => (/FROM live JOIN staff|UPDATE account_sessions|FROM accounts WHERE id/.test(typeof sql === "string" ? sql : sql.text) ? session.query(sql, params) : fake.query(sql, params)),
    connect: () => fake.connect(),
  };
  const fetch = async (url, init) => { fake.state.fetches.push({ url: String(url), init, body: init && init.body ? JSON.parse(init.body) : null }); return responses(String(url)); };
  await runWithSharedDb(combined, () => handler(req("POST", { body }), res, { db: combined, env, fetch, pool: () => ({ connect: () => combined.connect() }) }));
  return { res, env };
}

describe("POST /api/campaigns/meta-agency", () => {
  test("it saves the partner's Meta Business id as pending with the agency token encrypted, and sends Meta the agency-access request", async () => {
    const fake = metaFile();
    const { res, env } = await call({ partner_id: PARTNER, meta_business_id: ` ${CLIENT_BIZ} ` }, fake);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.connection.connection_state, "pending");
    assert.equal(res.body.connection.partner_id, PARTNER);
    assert.equal(res.body.connection.external_business_id, CLIENT_BIZ);
    assert.match(res.body.connection.external_ad_account_id, new RegExp(`^pending:biz:${CLIENT_BIZ}$`));
    assert.equal(res.body.connection.has_access_token, true);
    assert.equal(res.body.meta_approve_required, true);
    assert.equal(fake.state.connections.length, 1);
    const stored = fake.state.connections[0];
    assert.equal(stored.org_id, ORG_ID);
    assert.notEqual(stored.encrypted_access_token, TOKEN);
    assert.equal(String(stored.encrypted_access_token).includes(TOKEN), false);
    assert.equal(decryptToken(stored.encrypted_access_token, { partnerId: PARTNER, env }), TOKEN, "it decrypts to the agency token, for this partner only");
    assert.deepEqual(stored.scopes, ["ads_management", "ads_read", "business_management"]);
    assert.equal(fake.state.fetches.length, 1);
    assert.match(fake.state.fetches[0].url, new RegExp(`/${AGENCY}/managed_businesses$`));
    assert.deepEqual(fake.state.fetches[0].body, { existing_client_business_id: CLIENT_BIZ });
    assert.equal(fake.state.fetches[0].init.headers.authorization, `Bearer ${TOKEN}`);
    assert.equal(JSON.stringify(res.body).includes(TOKEN), false, "the answer carries no token");
  });

  test("the state stays pending even when Meta accepts the request; a connection a sync already proved active is not knocked back", async () => {
    const fake = metaFile();
    const { res } = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ, ad_account_id: "act_555" }, fake);
    assert.equal(res.body.graph.managed_businesses.ok, true);
    assert.equal(res.body.graph.client_ad_accounts.ok, true);
    assert.equal(res.body.connection.connection_state, "pending", "a request accepted is not an approval");
    assert.equal(res.body.connection.external_ad_account_id, "act_555");
    assert.match(res.body.connection.last_error, /Waiting on Meta approve/);
    assert.equal(fake.state.fetches.length, 2);
    assert.match(fake.state.fetches[1].url, new RegExp(`/${AGENCY}/client_ad_accounts$`));
    assert.deepEqual(fake.state.fetches[1].body, { adaccount_id: "act_555", permitted_tasks: ["ADVERTISE", "ANALYZE"] });

    fake.state.connections[0].connection_state = "active";
    const again = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ, ad_account_id: "555" }, fake);
    assert.equal(again.res.body.connection.connection_state, "active");
    assert.equal(fake.state.connections.length, 1, "the same ad account is the same row");
  });

  test("when Meta refuses, the row is still saved pending and carries Meta's own words", async () => {
    const fake = metaFile();
    const { res } = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ }, fake, { responses: () => metaRefused(400, "Capability not granted") });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.connection.connection_state, "pending");
    assert.equal(res.body.graph.managed_businesses.ok, false);
    assert.match(res.body.connection.last_error, /Capability not granted/);
    assert.match(res.body.connection.last_error, /Waiting on Meta approve/);
    assert.equal(fake.state.connections.length, 1);
  });

  test("a missing business id is 400, and with no agency business id or token on the server it is 503 and nothing is saved or sent", async () => {
    const fake = metaFile();
    const none = await call({ partner_id: PARTNER }, fake);
    assert.equal(none.res.statusCode, 400);
    assert.equal(none.res.body.error, "meta_business_id_required");
    const noAgency = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ }, fake, { env: { ...ENV(), META_BUSINESS_ID: "" } });
    assert.equal(noAgency.res.statusCode, 503);
    assert.equal(noAgency.res.body.error, "agency_business_missing");
    const noToken = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ }, fake, { env: { ...ENV(), META_ACCESS_TOKEN: "" } });
    assert.equal(noToken.res.statusCode, 503);
    assert.equal(noToken.res.body.error, "agency_token_missing");
    assert.equal(fake.state.connections.length, 0);
    assert.equal(fake.state.fetches.length, 0);
  });

  test("a partner login is pinned to their own partner: the partner_id they send is ignored; an unknown partner is 404", async () => {
    const fake = metaFile();
    const mine = await call({ partner_id: OTHER_PARTNER, meta_business_id: CLIENT_BIZ }, fake, { who: accountSession({ kind: "partner", partnerId: PARTNER, orgId: ORG_ID }) });
    assert.equal(mine.res.statusCode, 200);
    assert.equal(fake.state.connections[0].partner_id, PARTNER);
    const unknown = await call({ partner_id: "d9000000-0000-4000-8000-000000000009", meta_business_id: CLIENT_BIZ }, metaFile());
    assert.equal(unknown.res.statusCode, 404);
    assert.equal(unknown.res.body.error, "partner_not_found");
  });

  test("staff must name a partner; a client login and no login are refused; only POST is served", async () => {
    const fake = metaFile();
    const unnamed = await call({ meta_business_id: CLIENT_BIZ }, fake);
    assert.equal(unnamed.res.statusCode, 400);
    assert.equal(unnamed.res.body.error, "partner_id_required");
    const client = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ }, fake, { who: accountSession({ kind: "client", clientId: "c1000000-0000-4000-8000-000000000001" }) });
    assert.equal(client.res.statusCode, 403);
    const none = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ }, fake, { who: [] });
    assert.equal(none.res.statusCode, 401);
    assert.equal(fake.state.connections.length, 0);
    assert.equal(fake.state.fetches.length, 0);
    const get = makeRes();
    await runWithSharedDb(fake, () => handler(req("GET", { query: { partner_id: PARTNER } }), get, { db: fake, env: ENV(), fetch: async () => metaOk() }));
    assert.equal(get.statusCode, 405);
  });
});
