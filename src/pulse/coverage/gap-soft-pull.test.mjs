import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  APPROVE_PAGE_PATH,
  APPROVE_READ_PATH,
  CHECK_IDS,
  CLIENT_PICK_SQL,
  FETCH_TIMEOUT_MS,
  PAGE_MARKER,
  READ_KIND,
  approveReadShape,
  checkApproveSignedRead,
  gapChecks,
  signedReadShape
} from "./gap-soft-pull.mjs";
import approveHandler from "../../../api/soft-pull-approve.mjs";
import { verifySoftPullApproveToken } from "../../consent/approve-token.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORG = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
// A made-up secret with the real shape (32 or more characters). Never a real one.
const ENV = { DOCUMENT_URL_SECRET: "test-only-secret-".padEnd(48, "x") };

const PAGE_HTML = `<!DOCTYPE html><title>Fundhub · Soft-pull approval</title>
<script>fetch("${PAGE_MARKER}?org=&client=&exp=&sig=")</script>`;

const UNSIGNED = JSON.stringify({
  ok: false,
  error: "bad_token",
  message: "This link is missing required fields."
});

const READ_OK = JSON.stringify({
  ok: true,
  kind: READ_KIND,
  disclosure: { version: "v1", text: "It is a soft inquiry" },
  pricing: { base_cents: 3200, base_display: "$32" },
  consent: { valid: false, reason: null },
  contact: { first_name: null, last_name: null }
});

function byId(rows) {
  const map = Object.fromEntries(rows.map((row) => [row.id, row]));
  for (const id of CHECK_IDS) assert.ok(map[id], id);
  return map;
}

function assertShape(rows) {
  assert.equal(rows.length, CHECK_IDS.length);
  assert.deepEqual(rows.map((row) => row.id), [...CHECK_IDS]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["detail", "id", "status", "suggestedFix"]);
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Recon \(AG-07\)/);
      assert.match(row.suggestedFix, /one tripwire/);
      assert.match(row.suggestedFix, /Do not pull credit/);
      assert.match(row.suggestedFix, /Do not send bureau mail/);
      assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
    } else {
      assert.equal(row.suggestedFix, null);
    }
  }
}

function fakeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    assert.equal(opts.method, "GET");
    assert.equal(opts.credentials, "omit");
    assert.equal(opts.headers.authorization, undefined);
    assert.equal(opts.body, undefined);
    const hit = routes.find((row) => url === row.url || url.startsWith(row.url));
    if (!hit) throw new Error(`unexpected url ${url}`);
    if (hit.throw) throw new Error(hit.throw);
    return {
      status: hit.status,
      async text() {
        return hit.body ?? "";
      }
    };
  };
  return { fetchImpl, calls };
}

test("gap checks skip when there is no fetch", async () => {
  const rows = await gapChecks({});
  assertShape(rows);
  assert.ok(rows.every((row) => row.status === "skip"));
});

test("a loaded screen and an unsigned read both pass", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 400, body: UNSIGNED }
  ]);
  const rows = await gapChecks({ fetchImpl, baseUrl: "https://fundhub.ai/" });
  assertShape(rows);
  assert.equal(byId(rows)["soft-pull:approve-page"].status, "PASS");
  assert.equal(byId(rows)["soft-pull:approve-read"].status, "PASS");
  // No database in this run: the signed read says so. It does not pass.
  assert.equal(byId(rows)["soft-pull:approve-signed-read"].status, "skip");
  assert.match(byId(rows)["soft-pull:approve-read"].detail, /unsigned link shape/);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `https://fundhub.ai${APPROVE_PAGE_PATH}`);
  assert.equal(calls[0].opts.headers.accept, "text/html");
  assert.equal(calls[1].url, `https://fundhub.ai${APPROVE_READ_PATH}`);
  assert.equal(calls[1].url.includes("?"), false);
  assert.equal(calls[1].opts.headers.accept, "application/json");
});

test("approve screen 404 and 500 fail", async () => {
  for (const status of [404, 500]) {
    const { fetchImpl } = fakeFetch([
      { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status, body: "missing" },
      { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 400, body: UNSIGNED }
    ]);
    const rows = await gapChecks({ fetchImpl });
    const page = byId(rows)["soft-pull:approve-page"];
    assert.equal(page.status, "FAIL");
    assert.match(page.detail, new RegExp(`answered ${status}`));
    assert.equal(byId(rows)["soft-pull:approve-read"].status, "PASS");
  }
});

test("a 200 page that is not the approve screen fails", async () => {
  const { fetchImpl } = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: "<html>login</html>" },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 401, body: JSON.stringify({ ok: false, error: "invalid_or_expired" }) }
  ]);
  const rows = await gapChecks({ fetchImpl });
  assert.equal(byId(rows)["soft-pull:approve-page"].status, "FAIL");
  assert.match(byId(rows)["soft-pull:approve-page"].detail, /without its read route/);
  assert.equal(byId(rows)["soft-pull:approve-read"].status, "PASS");
  assert.match(byId(rows)["soft-pull:approve-read"].detail, /answered 401/);
});

test("read API 404 and 500 fail and a thrown fetch fails", async () => {
  const dead = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 500, body: "engine blew up" }
  ]);
  const boom = await gapChecks({ fetchImpl: dead.fetchImpl });
  const fail = byId(boom)["soft-pull:approve-read"];
  assert.equal(fail.status, "FAIL");
  assert.match(fail.detail, /answered 500/);
  assert.match(fail.detail, /engine blew up/);
  assert.equal(byId(boom)["soft-pull:approve-page"].status, "PASS");

  const missing = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 404, body: "" }
  ]);
  const gone = await gapChecks({ fetchImpl: missing.fetchImpl });
  assert.equal(byId(gone)["soft-pull:approve-read"].status, "FAIL");
  assert.match(byId(gone)["soft-pull:approve-read"].detail, /answered 404/);

  const dropped = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, throw: "socket hang up" },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, throw: "socket hang up" }
  ]);
  const rows = await gapChecks({ fetchImpl: dropped.fetchImpl });
  assert.equal(byId(rows)["soft-pull:approve-page"].status, "FAIL");
  assert.match(byId(rows)["soft-pull:approve-page"].detail, /unreachable/);
  assert.match(byId(rows)["soft-pull:approve-read"].detail, /socket hang up/);
});

test("a bad read body fails and the approval shape passes", async () => {
  assert.equal(approveReadShape(400, { ok: false, error: "bad_token" }), true);
  assert.equal(approveReadShape(200, JSON.parse(READ_OK)), true);
  assert.equal(approveReadShape(200, { ok: true, kind: READ_KIND }), false);

  const bad = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 400, body: "<html>nope</html>" }
  ]);
  const rows = await gapChecks({ fetchImpl: bad.fetchImpl });
  assert.equal(byId(rows)["soft-pull:approve-read"].status, "FAIL");
  assert.match(byId(rows)["soft-pull:approve-read"].detail, /not the approval read shape/);

  const ok = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 200, body: READ_OK }
  ]);
  const passed = await gapChecks({ fetchImpl: ok.fetchImpl });
  assert.equal(byId(passed)["soft-pull:approve-read"].status, "PASS");
  assert.match(byId(passed)["soft-pull:approve-read"].detail, /approval read shape/);
});

test("the file only reads the approve door", () => {
  const text = fs.readFileSync(path.join(HERE, "gap-soft-pull.mjs"), "utf8");
  assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|DROP)\b/);
  assert.doesNotMatch(text, /method:\s*["']POST["']/);
  assert.doesNotMatch(text, /requestSoftPull|finance\/soft-pull|postgrid|PostGrid/i);
  assert.match(text, /one tripwire/);
  assert.match(text, /Do not invent a second watchdog/);
});

test("the fetch alias still works, and each GET carries a timeout", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 400, body: UNSIGNED }
  ]);
  const rows = await gapChecks({ fetch: fetchImpl });
  assert.equal(byId(rows)["soft-pull:approve-page"].status, "PASS");
  assert.equal(calls.length, 2);
  for (const call of calls) assert.ok(call.opts.signal, "a hung door must not hold up the lane");
  assert.ok(FETCH_TIMEOUT_MS * 2 < 26000, "both GETs together must fit inside Netlify's 26 seconds");
});

// ---- the signed read. The REAL handler runs; only the database is made up. ----

function signedDb({ client = [{ id: CLIENT, first_name: "Pat", last_name: "Doe", email: "pat@example.test" }], pick = [{ id: CLIENT }], fail = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (fail && fail.test(text)) throw new Error("connection terminated");
      if (text.includes("gap:soft-pull-client")) return { rows: pick };
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(text)) return { rows: client };
      if (text.includes("FROM client_consents")) return { rows: [] };
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

test("the signed read opens the real handler with a link it signed, and passes", async () => {
  const db = signedDb();
  const row = await checkApproveSignedRead({ db, orgId: ORG, env: ENV });
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /the words, the price and the consent state/);
  assert.equal(row.suggestedFix, null);
  // It read the client and the consent, and nothing else. No write, no transaction.
  assert.deepEqual(db.calls.map((c) => c.sql.includes("gap:soft-pull-client") ? "pick" : /clients/.test(c.sql) ? "client" : "consent"), ["pick", "client", "consent"]);
  assert.deepEqual(db.calls[0].params, [ORG]);
  for (const call of db.calls) {
    assert.match(call.sql.replace(/\/\*[\s\S]*?\*\//g, "").trim(), /^SELECT\b/);
    assert.doesNotMatch(call.sql, /\b(INSERT|UPDATE|DELETE|BEGIN|COMMIT|ROLLBACK)\b/i);
  }
  assert.deepEqual(db.calls[1].params, [CLIENT, ORG]);
});

test("the link it signs is a real one the handler's own check accepts", async () => {
  let seen = null;
  const row = await checkApproveSignedRead({
    db: signedDb(),
    orgId: ORG,
    env: ENV,
    approveHandler: async (req, res, deps) => {
      seen = { req, deps };
      res.status(200).json({
        ok: true, kind: READ_KIND, disclosure: { text: "x" }, pricing: { base_cents: 3200 },
        consent: { valid: false }, contact: {}
      });
    }
  });
  assert.equal(row.status, "PASS");
  assert.equal(seen.req.method, "GET");
  assert.equal(seen.req.body, null);
  const ok = verifySoftPullApproveToken({
    orgId: seen.req.query.org,
    clientId: seen.req.query.client,
    exp: seen.req.query.exp,
    sig: seen.req.query.sig,
    secret: ENV.DOCUMENT_URL_SECRET
  });
  assert.ok(ok, "the handler would accept the link");
  assert.equal(ok.orgId, ORG);
  assert.equal(ok.clientId, CLIENT);
  // The secret goes to the handler as a dependency. It is never in the detail.
  assert.equal(seen.deps.secret, ENV.DOCUMENT_URL_SECRET);
  assert.doesNotMatch(row.detail, new RegExp(ENV.DOCUMENT_URL_SECRET.slice(0, 12)));
});

test("a database that fails inside the handler is a FAIL, not a quiet pass", async () => {
  const row = await checkApproveSignedRead({ db: signedDb({ fail: /FROM client_consents/ }), orgId: ORG, env: ENV });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /signed approve read answered (5\d\d|\d+)/);
  assert.match(row.detail, /not the approval read shape/);
  assert.match(row.suggestedFix, /Recon \(AG-07\)/);
  assert.match(row.suggestedFix, /Do not pull credit/);
});

test("a client the handler cannot find is a FAIL", async () => {
  const row = await checkApproveSignedRead({ db: signedDb({ client: [] }), orgId: ORG, env: ENV });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /answered 404 \(not_found\)/);
});

test("a handler that throws or answers the wrong thing is a FAIL", async () => {
  const threw = await checkApproveSignedRead({
    db: signedDb(), orgId: ORG, env: ENV,
    approveHandler: async () => { throw new Error("cannot read properties of undefined"); }
  });
  assert.equal(threw.status, "FAIL");
  assert.match(threw.detail, /threw: cannot read properties/);
  const thin = await checkApproveSignedRead({
    db: signedDb(), orgId: ORG, env: ENV,
    approveHandler: async (req, res) => { res.status(200).json({ ok: true, kind: READ_KIND }); }
  });
  assert.equal(thin.status, "FAIL");
  assert.match(thin.detail, /answered 200/);
  const none = await checkApproveSignedRead({
    db: signedDb(), orgId: ORG, env: ENV,
    approveHandler: async () => {}
  });
  assert.equal(none.status, "FAIL");
  assert.match(none.detail, /answered nothing/);
});

test("no signing secret means approval links cannot go out: FAIL, with the name and not the value", async () => {
  for (const env of [{}, { DOCUMENT_URL_SECRET: "short" }]) {
    const row = await checkApproveSignedRead({ db: signedDb(), orgId: ORG, env });
    assert.equal(row.status, "FAIL");
    assert.match(row.detail, /DOCUMENT_URL_SECRET is missing or too short/);
    assert.match(row.suggestedFix, /Set DOCUMENT_URL_SECRET/);
    assert.doesNotMatch(`${row.detail} ${row.suggestedFix}`, /short"/);
  }
});

test("the signed read skips, it does not pass, when there is no database, org or client", async () => {
  assert.equal((await checkApproveSignedRead({ orgId: ORG, env: ENV })).status, "skip");
  assert.equal((await checkApproveSignedRead({ db: signedDb(), env: ENV })).status, "skip");
  assert.equal((await checkApproveSignedRead({ db: signedDb(), orgId: "not-a-uuid", env: ENV })).status, "skip");
  const noClient = await checkApproveSignedRead({ db: signedDb({ pick: [] }), orgId: ORG, env: ENV });
  assert.equal(noClient.status, "skip");
  assert.match(noClient.detail, /no real client/);
});

test("a failing client pick is a FAIL, never a pass", async () => {
  const row = await checkApproveSignedRead({ db: signedDb({ fail: /gap:soft-pull-client/ }), orgId: ORG, env: ENV });
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /could not pick a client/);
});

test("the signed shape needs the words, a price, and the consent and contact blocks", () => {
  const good = {
    ok: true, kind: READ_KIND, disclosure: { text: "words" }, pricing: { base_cents: 3200 },
    consent: { valid: false }, contact: { first_name: null }
  };
  assert.equal(signedReadShape(200, good), true);
  assert.equal(signedReadShape(201, good), false);
  assert.equal(signedReadShape(200, { ...good, ok: false }), false);
  assert.equal(signedReadShape(200, { ...good, kind: "other" }), false);
  assert.equal(signedReadShape(200, { ...good, disclosure: { text: "  " } }), false);
  assert.equal(signedReadShape(200, { ...good, disclosure: null }), false);
  assert.equal(signedReadShape(200, { ...good, pricing: { base_cents: 0 } }), false);
  assert.equal(signedReadShape(200, { ...good, pricing: null }), false);
  assert.equal(signedReadShape(200, { ...good, consent: null }), false);
  assert.equal(signedReadShape(200, { ...good, contact: null }), false);
  assert.equal(signedReadShape(200, null), false);
});

test("the real handler still takes (req, res, deps) with the database and the secret", () => {
  assert.equal(typeof approveHandler, "function");
  assert.ok(approveHandler.length >= 2);
  const src = fs.readFileSync(path.join(HERE, "../../../api/soft-pull-approve.mjs"), "utf8");
  assert.match(src, /handler\(req, res, deps = \{\}\)/);
  assert.match(src, /deps\.db \?\? db/);
  assert.match(src, /secret: deps\.secret/);
});

test("the client pick only reads", () => {
  assert.match(CLIENT_PICK_SQL, /^\/\* gap:soft-pull-client \*\/\s*SELECT\b/);
  assert.doesNotMatch(CLIENT_PICK_SQL, /\b(INSERT|UPDATE|DELETE)\b/i);
});

test("all three rows go out together in the lane", async () => {
  const { fetchImpl } = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 400, body: UNSIGNED }
  ]);
  const rows = await gapChecks({ fetchImpl, db: signedDb(), orgId: ORG, env: ENV });
  assertShape(rows);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS"]);
});

test("the unsigned and plain 200 shapes need every part", () => {
  const base = { ok: true, kind: READ_KIND, disclosure: { text: "x" }, pricing: { base_cents: 3200 } };
  assert.equal(approveReadShape(200, base), true);
  assert.equal(approveReadShape(200, { ...base, pricing: undefined }), false, "a 200 with no pricing is not the read");
  assert.equal(approveReadShape(200, { ...base, disclosure: undefined }), false, "a 200 with no words is not the read");
  assert.equal(approveReadShape(200, { ...base, kind: "other" }), false);
  assert.equal(approveReadShape(200, { ...base, ok: false }), false);
  assert.equal(approveReadShape(400, { ok: false, error: "bad_token" }), true);
  assert.equal(approveReadShape(401, { ok: false, error: "invalid_or_expired" }), true);
  assert.equal(approveReadShape(400, { ok: false }), false, "a refusal must say why");
  assert.equal(approveReadShape(400, { ok: true, error: "bad_token" }), false);
  assert.equal(approveReadShape(403, { ok: false, error: "nope" }), false);
  assert.equal(approveReadShape(500, { ok: false, error: "boom" }), false);
  assert.equal(approveReadShape(200, null), false);
});
