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


/* The statement's own upsert, read from its text: the columns and values it inserts, the conflict key it
   names, the assignments of its DO UPDATE list and its RETURNING list. Nothing about what a re-save does
   is decided here: change the SQL and the stored rows change. An expression this reader does not know
   throws, so a new clause in the statement cannot be ignored. */
function splitTop(list) {
  const out = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of list) {
    if (ch === "'") quote = !quote;
    if (!quote) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const parseJson = (v) => (typeof v === "string" && /^[[{]/.test(v) ? JSON.parse(v) : v);
function upsert(state, sql, params, newId) {
  const text = String(sql).replace(/--[^\n]*/g, " ").replace(/\s+/g, " ").trim();
  const m = /^INSERT INTO (\w+) \(([^)]+)\) VALUES \((.+?)\) ON CONFLICT \(([^)]+)\) DO UPDATE SET (.+?) RETURNING (.+)$/i.exec(text);
  if (!m) throw new Error(`upsert: the statement has a shape this stand-in does not know: ${text.slice(0, 120)}`);
  const table = m[1];
  const cols = m[2].split(",").map((c) => c.trim());
  const values = splitTop(m[3]);
  const key = m[4].split(",").map((c) => c.trim());
  const insert = {};
  cols.forEach((col, i) => {
    const v = values[i];
    let mm;
    if ((mm = /^\$(\d+)(?:::\w+)?$/.exec(v))) insert[col] = parseJson(params[Number(mm[1]) - 1]);
    else if ((mm = /^'(.*)'$/.exec(v))) insert[col] = mm[1];
    else if (/^now\(\)$/i.test(v)) insert[col] = "now";
    else throw new Error(`upsert: cannot read the value for ${col}: ${v}`);
  });
  if (insert.org_id === null || insert.org_id === undefined) {
    throw Object.assign(new Error('null value in column "org_id" violates not-null constraint'), { code: "23502" });
  }
  const existing = state.connections.find((c) => key.every((k) => c[k] === insert[k]));
  let row;
  if (!existing) {
    row = { id: newId(), ...insert };
    state.connections.push(row);
  } else {
    row = existing;
    for (const part of splitTop(m[5])) {
      const i = part.indexOf("=");
      const col = part.slice(0, i).trim();
      const rhs = part.slice(i + 1).trim();
      let mm;
      if ((mm = /^EXCLUDED\.(\w+)$/i.exec(rhs))) row[col] = insert[mm[1]];
      else if ((mm = /^COALESCE\(\s*EXCLUDED\.(\w+)\s*,\s*\w+\.(\w+)\s*\)$/i.exec(rhs))) row[col] = insert[mm[1]] ?? row[mm[2]];
      else if ((mm = /^CASE WHEN \w+\.(\w+) = '([^']*)' THEN '([^']*)' ELSE '([^']*)' END$/i.exec(rhs))) row[col] = row[mm[1]] === mm[2] ? mm[3] : mm[4];
      else if (/^now\(\)$/i.test(rhs)) row[col] = "now";
      else throw new Error(`upsert: cannot read the assignment for ${col}: ${rhs}`);
    }
  }
  const out = {};
  for (const item of splitTop(m[6])) {
    let mm;
    if ((mm = /^\(\s*(\w+)\s+IS NOT NULL\s*\)\s+AS\s+(\w+)$/i.exec(item))) out[mm[2]] = row[mm[1]] !== null && row[mm[1]] !== undefined;
    else if (/^\w+$/.test(item)) out[item] = row[item];
    else throw new Error(`upsert: cannot read the RETURNING item: ${item}`);
  }
  void table;
  return [out];
}

function metaFile({ connections = [], failInsert = null } = {}) {
  const state = { connections, fetches: [] };
  let seq = 0;
  const fake = fakeDb([
    [/^\s*SELECT id, org_id FROM partners WHERE id = \$1/i, (_s, p) => [{ id: PARTNER, org_id: ORG_ID }, { id: OTHER_PARTNER, org_id: OTHER_ORG_ID }].filter((r) => r.id === p[0])],
    [/^\s*INSERT INTO ad_platform_connections/i, (s, p) => (failInsert ? failInsert : upsert(state, s, p, () => `f${++seq}000000-0000-4000-8000-000000000000`))],
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

  test("saving the same ad account again updates that row in place: the business id, the token, the scopes and the last words all follow the new save", async () => {
    const stale = {
      id: "f9000000-0000-4000-8000-000000000009", org_id: ORG_ID, partner_id: PARTNER, platform: "meta",
      external_business_id: "1111111111", external_ad_account_id: "act_555", encrypted_access_token: "old-ciphertext-not-a-token",
      scopes: ["ads_read"], connection_state: "pending", platform_verification_state: "unverified", last_error: "an old complaint",
    };
    const fake = metaFile({ connections: [stale] });
    const first = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ, ad_account_id: "act_555" }, fake);
    assert.equal(first.res.statusCode, 200);
    assert.equal(fake.state.connections.length, 1, "the same partner, platform and ad account is one row");
    const row = fake.state.connections[0];
    assert.equal(row.id, stale.id);
    assert.equal(row.external_business_id, CLIENT_BIZ, "the business id follows the latest save");
    assert.equal(decryptToken(row.encrypted_access_token, { partnerId: PARTNER, env: first.env }), TOKEN, "the stored token is the one just used");
    assert.deepEqual(row.scopes, ["ads_management", "ads_read", "business_management"]);
    assert.match(row.last_error, /Waiting on Meta approve/);
    assert.doesNotMatch(row.last_error, /an old complaint/);
    assert.equal(first.res.body.connection.id, stale.id);
    assert.equal(first.res.body.connection.external_business_id, CLIENT_BIZ);

    // Meta refuses this time: the row's last words become Meta's reason plus the waiting line.
    const refused = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ, ad_account_id: "act_555" }, fake, { responses: () => metaRefused(400, "Capability not granted") });
    assert.equal(refused.res.statusCode, 200);
    assert.match(fake.state.connections[0].last_error, /^Capability not granted · Waiting on Meta approve/);

    // A different ad account of the same partner is a second row, not an overwrite of the first.
    const second = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ, ad_account_id: "act_777" }, fake);
    assert.equal(second.res.statusCode, 200);
    assert.equal(fake.state.connections.length, 2);
    assert.deepEqual(fake.state.connections.map((c) => c.external_ad_account_id).sort(), ["act_555", "act_777"]);
    // And the same ad account of ANOTHER partner is its own row too.
    const other = await call({ partner_id: OTHER_PARTNER, meta_business_id: CLIENT_BIZ, ad_account_id: "act_555" }, fake);
    assert.equal(other.res.statusCode, 200);
    assert.equal(fake.state.connections.length, 3);
    assert.equal(fake.state.connections.find((c) => c.partner_id === OTHER_PARTNER).org_id, OTHER_ORG_ID);
  });

  test("a new connection says it is unverified, and the company stored is the partner row's own, never the sign-in's", async () => {
    const fake = metaFile();
    // The partner's login sits in a different company than the partner row (a data problem the handler
    // must not paper over by stamping the login's company on the connection).
    const { res } = await call({ meta_business_id: CLIENT_BIZ }, fake, { who: accountSession({ kind: "partner", partnerId: PARTNER, orgId: OTHER_ORG_ID }) });
    assert.equal(res.statusCode, 200);
    const row = fake.state.connections[0];
    assert.equal(row.platform_verification_state, "unverified", "Meta has not verified anything yet");
    assert.equal(row.connection_state, "pending");
    assert.equal(row.org_id, ORG_ID, "the connection belongs to the partner's own company");
  });

  test("the answer never carries the stored ciphertext or any token field", async () => {
    const fake = metaFile();
    const { res } = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ }, fake);
    const stored = fake.state.connections[0].encrypted_access_token;
    assert.ok(stored && stored.length > 10);
    const blob = JSON.stringify(res.body);
    assert.equal(blob.includes(stored), false, "no ciphertext");
    assert.equal(blob.includes(TOKEN), false);
    assert.doesNotMatch(blob, /"encrypted_access_token"|"access_token"|"token"/);
    assert.deepEqual(Object.keys(res.body.connection).sort(), [
      "connection_state", "external_ad_account_id", "external_business_id", "has_access_token", "id", "last_error", "partner_id", "platform",
    ]);
  });

  test("a failed save answers 500 with no stack and no raw database text, and saves nothing", async () => {
    const boom = new Error('duplicate key value violates unique constraint "ad_platform_connections_pkey" host=10.1.2.3 password=hunter2');
    boom.stack = `Error: ${boom.message}\n    at upsertConnection (/srv/app/api/campaigns/meta-agency.mjs:99:9)`;
    const fake = metaFile({ failInsert: boom });
    const { res } = await call({ partner_id: PARTNER, meta_business_id: CLIENT_BIZ }, fake);
    assert.equal(res.statusCode, 500);
    assert.equal(res.body.error, "server_error");
    assert.equal(res.body.stack, undefined);
    const blob = JSON.stringify(res.body);
    assert.doesNotMatch(blob, /hunter2|10\.1\.2\.3|\/srv\/app|upsertConnection|meta-agency\.mjs/);
    assert.equal(fake.state.connections.length, 0);
  });
});
