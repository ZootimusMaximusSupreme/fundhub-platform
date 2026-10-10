import test, { mock, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_CHECK_IDS,
  APPROVE_PAGE_PATH,
  APPROVE_READ_PATH,
  AUTO_QUEUED_MINUTES,
  CHECK_IDS,
  CLIENT_PICK_SQL,
  FAILED_LOOKBACK_DAYS,
  FETCH_TIMEOUT_MS,
  HUMAN_QUEUED_HOURS,
  LEDGER_ROW_CAP,
  NO_PULL_LOOKBACK_DAYS,
  NO_PULL_MINUTES,
  NO_PULL_SLOP_MINUTES,
  NUDGE_KEYS,
  OPEN_PULL_STATUSES,
  ORDER_ROW_CAP,
  PAGE_MARKER,
  PAID_FORM_HOURS,
  PAID_FORM_LOOKBACK_DAYS,
  PROCESSING_MINUTES,
  PULL_CHECK_IDS,
  PULL_READ_SQL,
  READ_KIND,
  READ_TIMEOUT_MS,
  LEDGER_SQL,
  PAID_DIAGNOSTICS_SQL,
  PAID_FORM_ORDERS_SQL,
  LIVE_CONSENT_SQL,
  NUDGES_SQL,
  PULL_TIMES_SQL,
  HAS_FILE_SQL,
  ageText,
  approveReadShape,
  assertReadOnlySql,
  checkApproveClickNoPull,
  checkApproveSignedRead,
  checkPaidFormNotFilled,
  checkRequestFailedOrStuck,
  gapChecks,
  judgeLedger,
  judgeNoPull,
  judgePaidForm,
  pullAnswersPayment,
  pullLedgerChecks,
  signedReadShape,
  withReader
} from "./gap-soft-pull.mjs";
import { TEST_CLIENT_EMAIL_RE } from "./gap-consent.mjs";
import approveHandler from "../../../api/soft-pull-approve.mjs";
import { verifySoftPullApproveToken } from "../../consent/approve-token.mjs";
import { CONSENT_VALID_SQL } from "../../consent/index.mjs";

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

// 2026-10-09: the lane returns the three approve-door rows first, then the three
// credit-pull ledger rows. Every door assertion below is unchanged; the ledger
// rows get their own fix-text rule (a plain read, no pull, no send, no auto-fix).
function byId(rows) {
  const map = Object.fromEntries(rows.map((row) => [row.id, row]));
  for (const id of ALL_CHECK_IDS) assert.ok(map[id], id);
  return map;
}

function assertShape(rows) {
  assert.equal(rows.length, ALL_CHECK_IDS.length);
  assert.deepEqual(rows.map((row) => row.id), [...ALL_CHECK_IDS]);
  assert.deepEqual([...ALL_CHECK_IDS], [...CHECK_IDS, ...PULL_CHECK_IDS]);
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ["detail", "id", "status", "suggestedFix"]);
    assert.ok(["PASS", "FAIL", "skip"].includes(row.status));
    assert.equal(typeof row.detail, "string");
    assert.ok(row.detail.length > 0);
    if (row.status === "FAIL" && CHECK_IDS.includes(row.id)) {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /Recon \(AG-07\)/);
      assert.match(row.suggestedFix, /one tripwire/);
      assert.match(row.suggestedFix, /Do not pull credit/);
      assert.match(row.suggestedFix, /Do not send bureau mail/);
      assert.doesNotMatch(row.suggestedFix, /second tripwire|new watchdog/i);
    } else if (row.status === "FAIL") {
      assert.equal(typeof row.suggestedFix, "string");
      assert.match(row.suggestedFix, /only reads/);
      assert.match(row.suggestedFix, /Do not auto-fix/);
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

test("all six rows go out together in the lane", async () => {
  const { fetchImpl } = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 400, body: UNSIGNED }
  ]);
  const both = laneDb();
  const rows = await gapChecks({ fetchImpl, db: both, scope: (fn) => fn(both), orgId: ORG, env: ENV, now: NOW });
  assertShape(rows);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "PASS", "PASS", "PASS"]);
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

// ---------------------------------------------------------------------------
// The credit-pull ledger rows (2026-10-09). A made-up database answers each
// read by its tag, and the check turns the rows into PASS, FAIL or skip. The
// thresholds live in JS, so each boundary is walked here. The live proof and
// the what-if SQL runs are on the lane board.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-10-09T13:00:00.000Z");
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const CLIENT_A = "aaaaaaaa-1111-4111-8111-111111111111";
const CLIENT_B = "bbbbbbbb-2222-4222-8222-222222222222";
const CLIENT_C = "cccccccc-3333-4333-8333-333333333333";
const CLIENT_D = "dddddddd-4444-4444-8444-444444444444";

function ago(ms) {
  return new Date(NOW.getTime() - ms).toISOString();
}

const TAGS = {
  ledger: "gap:softpull-ledger",
  formOrders: "gap:softpull-paid-form-orders",
  diagnostics: "gap:softpull-paid-diagnostics",
  live: "gap:softpull-live-consent",
  files: "gap:softpull-has-file",
  nudges: "gap:softpull-nudges",
  times: "gap:softpull-pull-times"
};

/** Answers each ledger read by its tag. Records every statement it is handed. */
function ledgerTx(data = {}, { fail = null, onQuery = null } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (onQuery) await onQuery(text, params);
      if (fail && fail.test(text)) throw new Error("connection terminated");
      for (const [key, tag] of Object.entries(TAGS)) {
        if (text.includes(tag)) return { rows: data[key] || [] };
      }
      throw new Error(`unexpected sql: ${text.slice(0, 80)}`);
    }
  };
}

/** One database that answers the approve-door reads and the ledger reads. */
function laneDb(data = {}) {
  const door = signedDb();
  const pull = ledgerTx(data);
  return {
    calls: [...door.calls, ...pull.calls],
    async query(sql, params) {
      return String(sql).includes("gap:softpull-") ? pull.query(sql, params) : door.query(sql, params);
    }
  };
}

function scoped(tx) {
  return { scope: (fn) => fn(tx), orgId: ORG, now: NOW };
}

const ledgerRow = (over = {}) => ({
  id: "11111111-aaaa-4aaa-8aaa-111111111111",
  client_id: CLIENT_A,
  status: "fulfilled",
  state_reason: null,
  requested_by_kind: "client",
  idempotency_key: "diagnostic-paid:evt-1",
  requested_at: ago(HOUR),
  updated_at: ago(HOUR),
  ...over
});

// ---- ids ------------------------------------------------------------------

test("the three ledger ids are new, unique, and live in this lane only", () => {
  assert.deepEqual([...PULL_CHECK_IDS], [
    "softpull:request-failed-or-stuck",
    "softpull:paid-form-not-filled-2h",
    "softpull:approve-click-no-pull"
  ]);
  assert.equal(new Set(ALL_CHECK_IDS).size, ALL_CHECK_IDS.length);
  const dirs = [HERE, path.join(HERE, "..")];
  for (const dir of dirs) {
    for (const file of fs.readdirSync(dir)) {
      // The tripwire map names which deep check guards which surface, so it names these ids on purpose.
      if (!/\.(mjs|md|json)$/.test(file) || /^gap-soft-pull\./.test(file) || /^tripwires[.-]/.test(file)) continue;
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      for (const id of PULL_CHECK_IDS) assert.ok(!text.includes(id), `${id} is also named in ${file}`);
    }
  }
});

// ---- row 1: did a credit pull fail, or never finish? ----------------------

test("ledger: a healthy ledger passes and says how many rows it read", async () => {
  const tx = ledgerTx({ ledger: [ledgerRow(), ledgerRow({ id: "2", client_id: CLIENT_B })] });
  const row = await checkRequestFailedOrStuck(scoped(tx));
  assert.equal(row.id, "softpull:request-failed-or-stuck");
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /no credit pull failed in the last 3 days or is stuck \(2 pull rows read\)/);
  assert.equal(row.suggestedFix, null);
  assert.equal(tx.calls.length, 1);
  assert.deepEqual(tx.calls[0].params, [ORG, NOW.toISOString(), false, TEST_CLIENT_EMAIL_RE]);
});

test("ledger: a pull that failed in the last 3 days is red, with the reason and a short client id", async () => {
  const tx = ledgerTx({ ledger: [ledgerRow({ status: "failed", state_reason: "not_configured", requested_at: ago(HOUR) })] });
  const row = await checkRequestFailedOrStuck(scoped(tx));
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 credit pull needs a look: 1 failed in the last 3 days \(reason: not_configured\)/);
  assert.match(row.detail, /Clients: aaaaaaaa$/);
  assert.doesNotMatch(row.detail, new RegExp(CLIENT_A), "no full client id in the detail");
  assert.match(row.suggestedFix, /only reads/);
  assert.match(row.suggestedFix, /Do not pull credit or send anything from it/);
  assert.match(row.suggestedFix, /Do not auto-fix/);
});

test("ledger: a failed pull older than 3 days is old news", async () => {
  const old = ledgerRow({ status: "failed", state_reason: "x", requested_at: ago(FAILED_LOOKBACK_DAYS * DAY + MIN) });
  assert.equal((await checkRequestFailedOrStuck(scoped(ledgerTx({ ledger: [old] })))).status, "PASS");
  const fresh = ledgerRow({ status: "failed", state_reason: "x", requested_at: ago(FAILED_LOOKBACK_DAYS * DAY - MIN) });
  assert.equal((await checkRequestFailedOrStuck(scoped(ledgerTx({ ledger: [fresh] })))).status, "FAIL");
});

test("ledger: a failed pull the client has since redone is forgiven, a second failure is not", async () => {
  const failed = ledgerRow({ id: "f", status: "failed", requested_at: ago(5 * HOUR) });
  for (const status of ["fulfilled", "processing", "queued"]) {
    const retry = ledgerRow({ id: "r", status, requested_at: ago(4 * HOUR), updated_at: ago(MIN) });
    const j = judgeLedger([failed, retry], NOW.getTime());
    assert.equal(j.failed.length, 0, `a newer ${status} pull forgives the failure`);
  }
  const again = ledgerRow({ id: "r2", status: "failed", requested_at: ago(4 * HOUR) });
  const j = judgeLedger([failed, again], NOW.getTime());
  assert.equal(j.failed.length, 2, "a retry that also failed leaves both red");
  const other = ledgerRow({ id: "o", client_id: CLIENT_B, status: "fulfilled", requested_at: ago(HOUR) });
  assert.equal(judgeLedger([failed, other], NOW.getTime()).failed.length, 1, "another client's pull does not forgive it");
  const older = ledgerRow({ id: "e", status: "fulfilled", requested_at: ago(9 * HOUR) });
  assert.equal(judgeLedger([failed, older], NOW.getTime()).failed.length, 1, "an older pull does not forgive it");
});

test("ledger: a pull the job runs itself is red once it has sat queued for over 15 minutes", async () => {
  const mk = (min, over = {}) => ledgerRow({ status: "queued", requested_at: ago(min * MIN), updated_at: ago(min * MIN), ...over });
  assert.equal(AUTO_QUEUED_MINUTES, 15);
  assert.equal(judgeLedger([mk(14)], NOW.getTime()).stuckAuto.length, 0);
  assert.equal(judgeLedger([mk(15)], NOW.getTime()).stuckAuto.length, 0, "exactly 15 is not over");
  assert.equal(judgeLedger([mk(16)], NOW.getTime()).stuckAuto.length, 1);
  const sys = mk(16, { idempotency_key: null, requested_by_kind: "system" });
  assert.equal(judgeLedger([sys], NOW.getTime()).stuckAuto.length, 1, "the Finance OS sweeper runs its own pulls too");
  const row = await checkRequestFailedOrStuck(scoped(ledgerTx({ ledger: [mk(52)] })));
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 still queued after 15 min though the job runs it itself \(oldest 52 min\)/);
  const ok = await checkRequestFailedOrStuck(scoped(ledgerTx({ ledger: [mk(5)] })));
  assert.equal(ok.status, "PASS");
});

test("ledger: a pull that waits on a person gets 48 hours, not 15 minutes", async () => {
  const mk = (h) => ledgerRow({
    status: "queued", idempotency_key: null, requested_by_kind: "staff",
    requested_at: ago(h * HOUR), updated_at: ago(h * HOUR)
  });
  assert.equal(HUMAN_QUEUED_HOURS, 48);
  assert.equal(judgeLedger([mk(0.5)], NOW.getTime()).stuckPerson.length, 0, "a staff tap 30 minutes ago is not stuck");
  assert.equal(judgeLedger([mk(47)], NOW.getTime()).stuckPerson.length, 0);
  assert.equal(judgeLedger([mk(48)], NOW.getTime()).stuckPerson.length, 0, "exactly 48 is not over");
  assert.equal(judgeLedger([mk(49)], NOW.getTime()).stuckPerson.length, 1);
  const paidRound = ledgerRow({
    status: "queued", requested_by_kind: "client", idempotency_key: "paid_round_pull:abc",
    requested_at: ago(60 * HOUR), updated_at: ago(60 * HOUR)
  });
  assert.equal(judgeLedger([paidRound], NOW.getTime()).stuckPerson.length, 1, "the paid dispute round is a person's job too");
  const row = await checkRequestFailedOrStuck(scoped(ledgerTx({ ledger: [mk(72)] })));
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 waiting on staff for over 48 hours \(oldest 3 days\)/);
});

test("ledger: a pull a runner holds for over 15 minutes is stuck, counted from its last touch", async () => {
  const mk = (min, over = {}) => ledgerRow({ status: "processing", requested_at: ago(3 * HOUR), updated_at: ago(min * MIN), ...over });
  assert.equal(PROCESSING_MINUTES, 15);
  assert.equal(judgeLedger([mk(14)], NOW.getTime()).stuckProcessing.length, 0);
  assert.equal(judgeLedger([mk(15)], NOW.getTime()).stuckProcessing.length, 0);
  assert.equal(judgeLedger([mk(16)], NOW.getTime()).stuckProcessing.length, 1);
  assert.equal(
    judgeLedger([mk(1, { requested_at: ago(3 * HOUR) })], NOW.getTime()).stuckProcessing.length, 0,
    "touched a minute ago is alive even though it was asked for hours ago"
  );
  const noTouch = mk(0, { updated_at: null });
  assert.equal(judgeLedger([noTouch], NOW.getTime()).stuckProcessing.length, 1, "no touch time falls back to the request time");
  const row = await checkRequestFailedOrStuck(scoped(ledgerTx({ ledger: [mk(40)] })));
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 stuck mid-run for over 15 min \(oldest 40 min\)/);
});

test("ledger: every way it goes wrong shows in one sentence, and fulfilled or cancelled rows never do", async () => {
  const ledger = [
    ledgerRow({ id: "1", client_id: CLIENT_A, status: "failed", state_reason: "no_identity", requested_at: ago(2 * HOUR) }),
    ledgerRow({ id: "2", client_id: CLIENT_B, status: "queued", requested_at: ago(30 * MIN), updated_at: ago(30 * MIN) }),
    ledgerRow({ id: "3", client_id: CLIENT_C, status: "processing", updated_at: ago(20 * MIN) }),
    ledgerRow({ id: "4", client_id: CLIENT_D, status: "queued", idempotency_key: null, requested_by_kind: "staff", requested_at: ago(50 * HOUR), updated_at: ago(50 * HOUR) }),
    ledgerRow({ id: "5", client_id: CLIENT_A, status: "cancelled", requested_at: ago(2 * HOUR + MIN) }),
    ledgerRow({ id: "6", client_id: "eeeeeeee-5555-4555-8555-555555555555", status: "fulfilled" })
  ];
  const row = await checkRequestFailedOrStuck(scoped(ledgerTx({ ledger })));
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /^4 credit pulls need a look: /);
  assert.match(row.detail, /1 failed/);
  assert.match(row.detail, /1 still queued/);
  assert.match(row.detail, /1 stuck mid-run/);
  assert.match(row.detail, /1 waiting on staff/);
  assert.match(row.detail, /Clients: aaaaaaaa, bbbbbbbb, cccccccc$/, "names at most three clients");
  assert.equal(judgeLedger([ledgerRow({ status: "cancelled", requested_at: ago(HOUR) })], NOW.getTime()).failed.length, 0);
});

test("ledger: a garbled time never throws and is never read as stuck", () => {
  const j = judgeLedger([
    ledgerRow({ status: "queued", requested_at: "not a date" }),
    ledgerRow({ status: "failed", requested_at: null }),
    null === 1 ? null : ledgerRow({ status: "processing", requested_at: "nope", updated_at: "nope" })
  ], NOW.getTime());
  assert.deepEqual(
    [j.failed.length, j.stuckAuto.length, j.stuckProcessing.length, j.stuckPerson.length], [0, 0, 0, 0]
  );
  assert.deepEqual(judgeLedger(null, NOW.getTime()), { failed: [], stuckAuto: [], stuckProcessing: [], stuckPerson: [] });
});

// ---- row 2: paid, form still empty, nobody reminded them -------------------

const formOrder = (over = {}) => ({
  order_id: "o1", client_id: CLIENT_A, email: "pat.buyer@gmail.com", paid_at: ago(3 * HOUR), ...over
});
const nudge = (over = {}) => ({
  client_id: CLIENT_A, template_key: "EMAIL-SLO-PAID-FORM-01", status: "sent", created_at: ago(2 * HOUR + 40 * MIN), ...over
});

test("paid form: a buyer who paid over 2 hours ago, has no form and got no reminder is red", async () => {
  const tx = ledgerTx({ formOrders: [formOrder()] });
  const row = await checkPaidFormNotFilled(scoped(tx));
  assert.equal(row.id, "softpull:paid-form-not-filled-2h");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 paid roadmap buyer has not filled the pull form for over 2 hours and no reminder text or email went out \(oldest paid 3 hours ago\)\. Clients: aaaaaaaa$/);
  assert.doesNotMatch(row.detail, /pat\.buyer|gmail/, "no email in the detail");
  assert.match(row.suggestedFix, /slo-paid-form-nudge/);
  assert.match(row.suggestedFix, /Do not send from it/);
  assert.equal(tx.calls.length, 4, "orders, consent, file, reminders");
  assert.deepEqual(tx.calls[1].params, [ORG, "soft_pull_consent", [CLIENT_A]]);
  assert.deepEqual(tx.calls[3].params, [ORG, [CLIENT_A], [...NUDGE_KEYS]]);
});

test("paid form: under 2 hours is not yet late, over 2 hours is", () => {
  assert.equal(PAID_FORM_HOURS, 2);
  const run = (ms) => judgePaidForm({
    orders: [formOrder({ paid_at: ago(ms) })], live: new Set(), files: new Set(), nudges: [], nowMs: NOW.getTime()
  });
  assert.equal(run(2 * HOUR - MIN).waiting.length, 0);
  assert.equal(run(2 * HOUR).waiting.length, 0, "exactly 2 hours is not over");
  assert.equal(run(2 * HOUR + MIN).waiting.length, 1);
  assert.equal(run(PAID_FORM_LOOKBACK_DAYS * DAY + MIN).waiting.length, 0, "older than 14 days is the consent lane's job");
  assert.equal(run(PAID_FORM_LOOKBACK_DAYS * DAY - MIN).waiting.length, 1);
});

test("paid form: a reminder that went out means the job did its part", async () => {
  const tx = ledgerTx({ formOrders: [formOrder()], nudges: [nudge()] });
  const row = await checkPaidFormNotFilled(scoped(tx));
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /1 paid in the last 14 days; 1 is still waiting but was reminded/);
  for (const status of ["queued", "sending", "sent", "delivered"]) {
    const j = judgePaidForm({ orders: [formOrder()], live: new Set(), files: new Set(), nudges: [nudge({ status })], nowMs: NOW.getTime() });
    assert.equal(j.waiting.length, 0, `a ${status} reminder counts`);
  }
  const sms = nudge({ template_key: "SMS-SLO-PAID-FORM-01" });
  assert.equal(judgePaidForm({ orders: [formOrder()], live: new Set(), files: new Set(), nudges: [sms], nowMs: NOW.getTime() }).waiting.length, 0);
});

test("paid form: a reminder that failed, bounced, was blocked, or is from before the payment does not count", () => {
  for (const status of ["failed", "bounced", "blocked", "cancelled"]) {
    const j = judgePaidForm({ orders: [formOrder()], live: new Set(), files: new Set(), nudges: [nudge({ status })], nowMs: NOW.getTime() });
    assert.equal(j.waiting.length, 1, `a ${status} reminder never reached the buyer`);
  }
  const stale = nudge({ created_at: ago(5 * HOUR) });
  assert.equal(judgePaidForm({ orders: [formOrder()], live: new Set(), files: new Set(), nudges: [stale], nowMs: NOW.getTime() }).waiting.length, 1, "an old reminder from an earlier order is not this one");
  const other = nudge({ client_id: CLIENT_B });
  assert.equal(judgePaidForm({ orders: [formOrder()], live: new Set(), files: new Set(), nudges: [other], nowMs: NOW.getTime() }).waiting.length, 1, "another client's reminder is not theirs");
  const wrongKey = nudge({ template_key: "EMAIL-S00-WELCOME" });
  assert.equal(judgePaidForm({ orders: [formOrder()], live: new Set(), files: new Set(), nudges: [wrongKey], nowMs: NOW.getTime() }).waiting.length, 1, "some other message is not the pull-form reminder");
});

test("paid form: a buyer who has live consent, or already holds a credit file, is not waiting", async () => {
  const withConsent = await checkPaidFormNotFilled(scoped(ledgerTx({
    formOrders: [formOrder()], live: [{ client_id: CLIENT_A, granted_at: ago(HOUR) }]
  })));
  assert.equal(withConsent.status, "PASS");
  assert.match(withConsent.detail, /none are waiting on the form/);
  const withFile = await checkPaidFormNotFilled(scoped(ledgerTx({
    formOrders: [formOrder()], files: [{ client_id: CLIENT_A }]
  })));
  assert.equal(withFile.status, "PASS");
});

test("paid form: company, test and bot addresses never get the reminder, so they are not missed buyers", () => {
  for (const email of ["chris@fundhub.ai", "e2e+slo-walk-1@gmail.com", "sim.user@gmail.com", "", "no-at-sign", null]) {
    const j = judgePaidForm({ orders: [formOrder({ email })], live: new Set(), files: new Set(), nudges: [], nowMs: NOW.getTime() });
    assert.equal(j.waiting.length, 0, `${email} is not a missed buyer`);
  }
});

test("paid form: one buyer with two paid orders is one buyer", () => {
  const j = judgePaidForm({
    orders: [formOrder({ order_id: "a", paid_at: ago(5 * HOUR) }), formOrder({ order_id: "b", paid_at: ago(3 * HOUR) })],
    live: new Set(), files: new Set(), nudges: [], nowMs: NOW.getTime()
  });
  assert.equal(j.waiting.length, 1);
});

test("paid form: with nobody paid there is nothing to read past the first query", async () => {
  const tx = ledgerTx({ formOrders: [] });
  const row = await checkPaidFormNotFilled(scoped(tx));
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /0 paid in the last 14 days; none are waiting on the form/);
  assert.equal(tx.calls.length, 1);
});

// ---- row 3: approved and paid, and nothing ran -----------------------------

const paidOrder = (over = {}) => ({ order_id: "p1", client_id: CLIENT_A, paid_at: ago(3 * HOUR), ...over });
const consents = (entries) => new Map(entries.map(([id, when]) => [id, new Date(when).getTime()]));
/* A pull row as the judge reads it. A bare time is a pull that was asked for and
   closed at that same moment (a row that was done in one go). An object sets the
   parts one by one, in ISO strings. */
const pullRec = (w) => {
  if (typeof w === "string") {
    const t = new Date(w).getTime();
    return { requested: t, status: "fulfilled", resolved: t, updated: t };
  }
  const t = (v) => (v == null ? NaN : new Date(v).getTime());
  return { requested: t(w.requested), status: w.status ?? "", resolved: t(w.resolved), updated: t(w.updated) };
};
const pulls = (entries) => new Map(entries.map(([id, rows]) => [id, rows.map(pullRec)]));

test("no pull: approved, paid, and 15 minutes later no pull row is red", async () => {
  const tx = ledgerTx({
    diagnostics: [paidOrder()],
    live: [{ client_id: CLIENT_A, granted_at: ago(4 * HOUR) }],
    times: []
  });
  const row = await checkApproveClickNoPull(scoped(tx));
  assert.equal(row.id, "softpull:approve-click-no-pull");
  assert.equal(row.status, "FAIL");
  assert.match(row.detail, /1 client approved the pull and paid, and no pull was started 15 or more minutes later \(oldest waiting 3 hours\)\. Clients: aaaaaaaa$/);
  assert.match(row.suggestedFix, /diagnostic\.paid/);
  assert.match(row.suggestedFix, /Do not pull credit from it/);
  assert.equal(tx.calls.length, 3, "orders, consent, pull times");
});

test("no pull: a pull row made after the payment settles it", async () => {
  const tx = ledgerTx({
    diagnostics: [paidOrder()],
    live: [{ client_id: CLIENT_A, granted_at: ago(4 * HOUR) }],
    times: [{ client_id: CLIENT_A, requested_at: ago(2 * HOUR + 50 * MIN) }]
  });
  const row = await checkApproveClickNoPull(scoped(tx));
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /no client who approved and paid in the last 30 days is waiting on a credit pull \(1 checked\)/);
});

test("no pull: a pull from before the payment does not count, one a minute before does (clock slop)", () => {
  const base = { orders: [paidOrder()], consents: consents([[CLIENT_A, ago(4 * HOUR)]]), nowMs: NOW.getTime() };
  const old = judgeNoPull({ ...base, pulls: pulls([[CLIENT_A, [ago(10 * DAY)]]]) });
  assert.equal(old.missing.length, 1, "last month's pull does not answer today's payment");
  const slop = judgeNoPull({ ...base, pulls: pulls([[CLIENT_A, [ago(3 * HOUR + MIN)]]]) });
  assert.equal(slop.missing.length, 0, "a row a minute before the payment stamp is the same pull");
  const tooEarly = judgeNoPull({ ...base, pulls: pulls([[CLIENT_A, [ago(3 * HOUR + 3 * MIN)]]]) });
  assert.equal(tooEarly.missing.length, 1);
  const other = judgeNoPull({ ...base, pulls: pulls([[CLIENT_B, [ago(HOUR)]]]) });
  assert.equal(other.missing.length, 1, "another client's pull does not count");
});

test("no pull: no live consent is the consent lane's row, not this one", async () => {
  const j = judgeNoPull({ orders: [paidOrder()], consents: new Map(), pulls: new Map(), nowMs: NOW.getTime() });
  assert.equal(j.missing.length, 0);
  assert.equal(j.checked, 0);
  const row = await checkApproveClickNoPull(scoped(ledgerTx({ diagnostics: [paidOrder()], live: [], times: [] })));
  assert.equal(row.status, "PASS");
  assert.match(row.detail, /nothing to check/);
});

test("no pull: the clock starts at the later of the payment and the approval, and 15 minutes is not yet late", () => {
  assert.equal(NO_PULL_MINUTES, 15);
  const run = (paidMs, grantedMs) => judgeNoPull({
    orders: [paidOrder({ paid_at: ago(paidMs) })],
    consents: consents([[CLIENT_A, ago(grantedMs)]]),
    pulls: new Map(),
    nowMs: NOW.getTime()
  });
  assert.equal(run(10 * MIN, 4 * HOUR).missing.length, 0, "paid 10 minutes ago: the job is still running");
  assert.equal(run(3 * HOUR, 10 * MIN).missing.length, 0, "paid first, approved 10 minutes ago: the form just landed");
  assert.equal(run(3 * HOUR, 15 * MIN).missing.length, 0, "exactly 15 is not over");
  assert.equal(run(3 * HOUR, 16 * MIN).missing.length, 1);
  assert.equal(run(16 * MIN, 4 * HOUR).missing.length, 1);
  const late = run(5 * HOUR, 60 * MIN);
  assert.equal(late.missing.length, 1);
  assert.equal(late.missing[0].ageMs, 60 * MIN, "waiting is counted from the approval, the later event");
});

test("no pull: older than 30 days is out, one client with two payments is one client", () => {
  assert.equal(NO_PULL_LOOKBACK_DAYS, 30);
  const run = (orders) => judgeNoPull({
    orders, consents: consents([[CLIENT_A, ago(40 * DAY)]]), pulls: new Map(), nowMs: NOW.getTime()
  });
  assert.equal(run([paidOrder({ paid_at: ago(31 * DAY) })]).missing.length, 0);
  assert.equal(run([paidOrder({ paid_at: ago(29 * DAY) })]).missing.length, 1);
  assert.equal(run([paidOrder({ order_id: "x", paid_at: ago(5 * DAY) }), paidOrder({ order_id: "y", paid_at: ago(4 * DAY) })]).missing.length, 1);
});

// A pull that was already open when the payment landed gets no new row: C-00
// is handed "already_open" and stops. The old row is the pull for that payment.
// Before 2026-10-09 the judge looked only at when a row was asked for, so a
// staff pull queued a day before the payment and finished an hour ago still
// read "no pull was started" for 30 days.

test("no pull: a pull that was open at the payment and finished after it is the pull for that payment", () => {
  const base = { orders: [paidOrder()], consents: consents([[CLIENT_A, ago(4 * HOUR)]]), nowMs: NOW.getTime() };
  const doneAfter = judgeNoPull({
    ...base,
    pulls: pulls([[CLIENT_A, [{ requested: ago(DAY + 3 * HOUR), status: "fulfilled", resolved: ago(HOUR), updated: ago(HOUR) }]]])
  });
  assert.equal(doneAfter.missing.length, 0, "asked a day before, finished an hour ago, after the payment");
  const failedAfter = judgeNoPull({
    ...base,
    pulls: pulls([[CLIENT_A, [{ requested: ago(DAY + 3 * HOUR), status: "failed", resolved: ago(2 * HOUR), updated: ago(2 * HOUR) }]]])
  });
  assert.equal(failedAfter.missing.length, 0, "a pull that ran and failed after the payment did run (the ledger row owns the failure)");
  for (const status of OPEN_PULL_STATUSES) {
    const open = judgeNoPull({
      ...base,
      pulls: pulls([[CLIENT_A, [{ requested: ago(DAY + 3 * HOUR), status, resolved: null, updated: ago(DAY) }]]])
    });
    assert.equal(open.missing.length, 0, `a ${status} pull is in flight: it answers the payment`);
  }
});

test("no pull: a pull that closed before the payment does not answer it, a closed row's own time is what counts", () => {
  const base = { orders: [paidOrder()], consents: consents([[CLIENT_A, ago(4 * HOUR)]]), nowMs: NOW.getTime() };
  const closedBefore = judgeNoPull({
    ...base,
    pulls: pulls([[CLIENT_A, [{ requested: ago(2 * DAY), status: "fulfilled", resolved: ago(DAY), updated: ago(DAY) }]]])
  });
  assert.equal(closedBefore.missing.length, 1, "done a day before the payment: nothing ran for this payment");
  const cancelledBefore = judgeNoPull({
    ...base,
    pulls: pulls([[CLIENT_A, [{ requested: ago(2 * DAY), status: "cancelled", resolved: ago(DAY), updated: ago(DAY) }]]])
  });
  assert.equal(cancelledBefore.missing.length, 1);
  // A closed row's close stamp is the truth. A later bump of updated_at must not settle it.
  const bumped = judgeNoPull({
    ...base,
    pulls: pulls([[CLIENT_A, [{ requested: ago(2 * DAY), status: "fulfilled", resolved: ago(DAY), updated: ago(HOUR) }]]])
  });
  assert.equal(bumped.missing.length, 1, "an unrelated touch of updated_at does not make an old pull this payment's pull");
  // Only when the close stamp is unreadable does updated_at stand in.
  const noStamp = judgeNoPull({
    ...base,
    pulls: pulls([[CLIENT_A, [{ requested: ago(2 * DAY), status: "fulfilled", resolved: null, updated: ago(HOUR) }]]])
  });
  assert.equal(noStamp.missing.length, 0, "no close stamp: updated_at is the fallback");
  const other = judgeNoPull({
    ...base,
    pulls: pulls([[CLIENT_B, [{ requested: ago(DAY + 3 * HOUR), status: "queued", resolved: null, updated: ago(DAY) }]]])
  });
  assert.equal(other.missing.length, 1, "another client's open pull does not answer this payment");
});

test("no pull: pullAnswersPayment walks the three ways and the slop edge", () => {
  const since = NOW.getTime() - 3 * HOUR - NO_PULL_SLOP_MINUTES * MIN;
  const at = (offset) => new Date(since + offset).getTime();
  const rec = (over) => ({ requested: at(-DAY), status: "fulfilled", resolved: at(-DAY), updated: at(-DAY), ...over });
  assert.equal(pullAnswersPayment(rec({ requested: at(0) }), since), true, "asked exactly at the line");
  assert.equal(pullAnswersPayment(rec({ requested: at(-1) }), since), false, "asked 1 ms before the line, closed long before");
  assert.equal(pullAnswersPayment(rec({ resolved: at(0) }), since), true, "closed exactly at the line");
  assert.equal(pullAnswersPayment(rec({ resolved: at(-1) }), since), false);
  assert.equal(pullAnswersPayment(rec({ status: "queued", resolved: NaN }), since), true);
  assert.equal(pullAnswersPayment(rec({ status: "processing", resolved: NaN }), since), true);
  assert.equal(pullAnswersPayment(rec({ status: "fulfilled" }), since), false);
  assert.equal(pullAnswersPayment(rec({ resolved: NaN, updated: NaN }), since), false, "nothing readable never settles it");
  assert.equal(pullAnswersPayment(null, since), false);
  assert.equal(pullAnswersPayment(undefined, since), false);
  assert.deepEqual([...OPEN_PULL_STATUSES], ["queued", "processing"]);
});

test("no pull: the read hands the judge each pull row's state and close time, and a pull open at the payment settles it", async () => {
  const live = [{ client_id: CLIENT_A, granted_at: ago(4 * HOUR) }];
  const row = (over) => ({ client_id: CLIENT_A, requested_at: ago(DAY + 3 * HOUR), status: "fulfilled", resolved_at: ago(HOUR), updated_at: ago(HOUR), ...over });
  const passes = await checkApproveClickNoPull(scoped(ledgerTx({ diagnostics: [paidOrder()], live, times: [row()] })));
  assert.equal(passes.status, "PASS", "queued a day before the payment, done an hour ago");
  const open = await checkApproveClickNoPull(scoped(ledgerTx({
    diagnostics: [paidOrder()], live, times: [row({ status: "queued", resolved_at: null, updated_at: ago(DAY + 3 * HOUR) })]
  })));
  assert.equal(open.status, "PASS", "still queued: the ledger row watches how long it waits");
  const before = await checkApproveClickNoPull(scoped(ledgerTx({
    diagnostics: [paidOrder()], live, times: [row({ requested_at: ago(3 * DAY), resolved_at: ago(2 * DAY), updated_at: ago(2 * DAY) })]
  })));
  assert.equal(before.status, "FAIL", "done two days before the payment: nothing ran for this payment");
  assert.match(before.detail, /no pull was started 15 or more minutes later/);
});

test("no pull: the close time and the touch time both reach the judge, and the close time wins", async () => {
  const live = [{ client_id: CLIENT_A, granted_at: ago(4 * HOUR) }];
  const row = (over) => ({ client_id: CLIENT_A, requested_at: ago(2 * DAY), status: "fulfilled", resolved_at: ago(DAY), updated_at: ago(DAY), ...over });
  const bumped = await checkApproveClickNoPull(scoped(ledgerTx({
    diagnostics: [paidOrder()], live, times: [row({ updated_at: ago(HOUR) })]
  })));
  assert.equal(bumped.status, "FAIL", "closed a day before the payment; a later touch of updated_at does not make it this payment's pull");
  const noStamp = await checkApproveClickNoPull(scoped(ledgerTx({
    diagnostics: [paidOrder()], live, times: [row({ resolved_at: null, updated_at: ago(HOUR) })]
  })));
  assert.equal(noStamp.status, "PASS", "no readable close stamp: the touch time stands in");
  const closedAfter = await checkApproveClickNoPull(scoped(ledgerTx({
    diagnostics: [paidOrder()], live, times: [row({ resolved_at: ago(HOUR), updated_at: ago(DAY) })]
  })));
  assert.equal(closedAfter.status, "PASS", "closed after the payment");
});

test("every read goes through the plain-read guard, so a write never reaches the connection", async () => {
  const tx = ledgerTx({});
  await assert.rejects(
    withReader(scoped(tx), "guard", (q) => q.query("UPDATE soft_pull_requests SET status = 'cancelled'", [])),
    /plain read/
  );
  await assert.rejects(withReader(scoped(tx), "guard", (q) => q.query("SELECT 1; DELETE FROM clients", [])), /plain read/);
  assert.equal(tx.calls.length, 0, "the refused statements were never sent");
  const ok = await withReader(scoped(tx), "guard", (q) => q.query(LIVE_CONSENT_SQL, [ORG, "soft_pull_consent", []]));
  assert.deepEqual(ok.rows, []);
  assert.equal(tx.calls.length, 1);
});

// ---- the reads themselves --------------------------------------------------

test("every ledger read is one plain SELECT, and a write is refused before it is sent", async () => {
  assert.equal(PULL_READ_SQL.length, 7);
  for (const sql of PULL_READ_SQL) {
    assert.doesNotThrow(() => assertReadOnlySql(sql));
    assert.match(sql, /^\/\* gap:softpull-[a-z-]+ \*\/\s*SELECT\b/);
    assert.doesNotMatch(sql, /\b(insert|update|delete|drop|alter|truncate|begin|commit|rollback)\b/i);
  }
  for (const bad of ["UPDATE soft_pull_requests SET status = 'failed'", "DELETE FROM clients", "BEGIN", "SET LOCAL x = 1", "INSERT INTO messages VALUES (1)", "SELECT 1; DROP TABLE clients"]) {
    assert.throws(() => assertReadOnlySql(bad), /plain read/);
  }
  const tx = ledgerTx({});
  await pullLedgerChecks(scoped(tx));
  for (const call of tx.calls) {
    assert.match(call.sql.replace(/\/\*[\s\S]*?\*\//g, "").trim(), /^SELECT\b/);
  }
});

test("every read leaves test and demo clients out, unless the pulse says demo is on", async () => {
  for (const sql of [LEDGER_SQL, PAID_FORM_ORDERS_SQL, PAID_DIAGNOSTICS_SQL]) {
    assert.match(sql, /\$3::boolean OR NOT \(COALESCE\(c\.is_demo, false\)/);
    assert.match(sql, /custom_fields ->> 'synthetic'/);
    assert.match(sql, /c\.email, ''\) ~\* \$4/);
  }
  const tx = ledgerTx({});
  await checkRequestFailedOrStuck({ ...scoped(tx), demoOn: true });
  assert.equal(tx.calls[0].params[2], true);
  assert.match(PAID_FORM_ORDERS_SQL, /\$3::boolean OR COALESCE\(pl\.is_demo, false\) = false/);
  assert.match(PAID_DIAGNOSTICS_SQL, /\$3::boolean OR COALESCE\(pl\.is_demo, false\) = false/);
});

test("the queries name the live consent rule, the roadmap order, and the paid diagnostic", () => {
  assert.match(LIVE_CONSENT_SQL, /revoked_at IS NULL/);
  assert.match(LIVE_CONSENT_SQL, /expires_at IS NULL OR expires_at > now\(\)/);
  assert.match(LIVE_CONSENT_SQL, /cc\.kind = \$2/);
  assert.match(PAID_FORM_ORDERS_SQL, /pl\.purpose = 'diagnostic'/);
  assert.match(PAID_FORM_ORDERS_SQL, /LIKE 'slo diagnostic%'/);
  assert.match(PAID_FORM_ORDERS_SQL, /pl\.identity_stored_at IS NULL/);
  assert.match(PAID_DIAGNOSTICS_SQL, /pl\.purpose = 'diagnostic'/);
  assert.doesNotMatch(PAID_DIAGNOSTICS_SQL, /slo diagnostic/, "the $32 approve-link orders count too");
  assert.match(LEDGER_SQL, /r\.status IN \('queued', 'processing'\)/);
  assert.match(LEDGER_SQL, /ORDER BY \(r\.status IN \('queued', 'processing'\)\) DESC/, "open rows sort first so the row cap cannot hide one");
  assert.match(NUDGES_SQL, /m\.template_key = ANY\(\$3::text\[\]\)/);
  assert.match(HAS_FILE_SQL, /crs_results/);
  assert.match(PULL_TIMES_SQL, /soft_pull_requests/);
  assert.deepEqual([...NUDGE_KEYS], ["SMS-SLO-PAID-FORM-01", "EMAIL-SLO-PAID-FORM-01"]);
});

// ---- the SQL, clause by clause ---------------------------------------------
//
// The tests above feed canned rows to the judge, so a changed WHERE clause would
// leave every one of them green. These pin each read's FROM, every AND-ed
// condition, and its ORDER BY / LIMIT, with the spacing taken out. A condition
// dropped (the paid filter, the company filter, the per-client scope), a window
// widened, or a new one slipped in fails here, and the window numbers must equal
// the JS ones. The "SQL, run for real" suite at the bottom of this file runs the
// same statements against Postgres.

function plainSql(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/ \)/g, ")")
    .trim();
}

/** Positions of `needle` in `text` that sit outside every bracket and every quote. */
function topLevelAt(text, needle) {
  const at = [];
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "'") { quoted = !quoted; continue; }
    if (quoted) continue;
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
    else if (depth === 0 && text.startsWith(needle, i)) at.push(i);
  }
  return at;
}

function sqlShape(sql) {
  const text = plainSql(sql);
  const [fromAt] = topLevelAt(text, " FROM ");
  const [whereAt] = topLevelAt(text, " WHERE ");
  assert.ok(fromAt > 0 && whereAt > fromAt, "a read with a FROM and a WHERE");
  const rest = text.slice(whereAt + " WHERE ".length);
  const tails = [" ORDER BY ", " GROUP BY ", " LIMIT "].flatMap((k) => topLevelAt(rest, k));
  const tailAt = tails.length ? Math.min(...tails) : rest.length;
  const whereText = rest.slice(0, tailAt);
  const cuts = topLevelAt(whereText, " AND ");
  const where = [];
  let from = 0;
  for (const cut of cuts) {
    where.push(whereText.slice(from, cut));
    from = cut + " AND ".length;
  }
  where.push(whereText.slice(from));
  return {
    select: text.slice("SELECT ".length, fromAt),
    from: text.slice(fromAt + " FROM ".length, whereAt),
    where,
    tail: rest.slice(tailAt).trim()
  };
}

const NOT_A_TEST_CLIENT =
  "($3::boolean OR NOT (COALESCE(c.is_demo, false) OR COALESCE(c.custom_fields ->> 'synthetic', '') = 'true' OR COALESCE(c.email, '') ~* $4))";
const JOIN_CLIENT = (alias) => `payment_links ${alias} JOIN clients c ON c.id = ${alias}.client_id AND c.org_id = ${alias}.org_id`;
const PAID_ORDER_COLUMNS = "pl.id::text AS order_id, pl.client_id::text AS client_id";

const SQL_SHAPES = [
  ["LEDGER_SQL", LEDGER_SQL, {
    select: "r.id::text AS id, r.client_id::text AS client_id, r.status, r.state_reason, r.requested_by_kind, r.idempotency_key, r.requested_at, r.updated_at",
    from: "soft_pull_requests r JOIN clients c ON c.id = r.client_id AND c.org_id = r.org_id",
    where: [
      "r.org_id = $1::uuid",
      NOT_A_TEST_CLIENT,
      `(r.status IN ('queued', 'processing') OR r.requested_at > $2::timestamptz - interval '${FAILED_LOOKBACK_DAYS} days')`
    ],
    tail: `ORDER BY (r.status IN ('queued', 'processing')) DESC, r.requested_at DESC LIMIT ${LEDGER_ROW_CAP}`
  }],
  ["PAID_FORM_ORDERS_SQL", PAID_FORM_ORDERS_SQL, {
    select: `${PAID_ORDER_COLUMNS}, c.email, COALESCE(pl.paid_at, pl.updated_at) AS paid_at`,
    from: JOIN_CLIENT("pl"),
    where: [
      "pl.org_id = $1::uuid",
      "pl.purpose = 'diagnostic'",
      "lower(btrim(COALESCE(pl.description, ''))) LIKE 'slo diagnostic%'",
      "(pl.status = 'paid' OR pl.paid_at IS NOT NULL)",
      "pl.identity_stored_at IS NULL",
      "($3::boolean OR COALESCE(pl.is_demo, false) = false)",
      NOT_A_TEST_CLIENT,
      `COALESCE(pl.paid_at, pl.updated_at) > $2::timestamptz - interval '${PAID_FORM_LOOKBACK_DAYS} days'`
    ],
    tail: `ORDER BY COALESCE(pl.paid_at, pl.updated_at) ASC LIMIT ${ORDER_ROW_CAP}`
  }],
  ["PAID_DIAGNOSTICS_SQL", PAID_DIAGNOSTICS_SQL, {
    select: `${PAID_ORDER_COLUMNS}, COALESCE(pl.paid_at, pl.updated_at) AS paid_at`,
    from: JOIN_CLIENT("pl"),
    where: [
      "pl.org_id = $1::uuid",
      "pl.purpose = 'diagnostic'",
      "(pl.status = 'paid' OR pl.paid_at IS NOT NULL)",
      "($3::boolean OR COALESCE(pl.is_demo, false) = false)",
      NOT_A_TEST_CLIENT,
      `COALESCE(pl.paid_at, pl.updated_at) > $2::timestamptz - interval '${NO_PULL_LOOKBACK_DAYS} days'`
    ],
    tail: `ORDER BY COALESCE(pl.paid_at, pl.updated_at) ASC LIMIT ${ORDER_ROW_CAP}`
  }],
  ["LIVE_CONSENT_SQL", LIVE_CONSENT_SQL, {
    select: "cc.client_id::text AS client_id, max(cc.granted_at) AS granted_at",
    from: "client_consents cc",
    where: [
      "cc.org_id = $1::uuid",
      "cc.kind = $2",
      "cc.client_id = ANY($3::uuid[])",
      `(${plainSql(CONSENT_VALID_SQL)})`
    ],
    tail: "GROUP BY cc.client_id"
  }],
  ["HAS_FILE_SQL", HAS_FILE_SQL, {
    select: "DISTINCT cr.client_id::text AS client_id",
    from: "crs_results cr",
    where: ["cr.org_id = $1::uuid", "cr.client_id = ANY($2::uuid[])", "COALESCE(cr.is_demo, false) = false"],
    tail: ""
  }],
  ["NUDGES_SQL", NUDGES_SQL, {
    select: "m.client_id::text AS client_id, m.template_key, m.status, m.created_at",
    from: "messages m",
    where: ["m.org_id = $1::uuid", "m.client_id = ANY($2::uuid[])", "m.template_key = ANY($3::text[])"],
    tail: ""
  }],
  ["PULL_TIMES_SQL", PULL_TIMES_SQL, {
    select: "r.client_id::text AS client_id, r.requested_at, r.status, r.resolved_at, r.updated_at",
    from: "soft_pull_requests r",
    where: ["r.org_id = $1::uuid", "r.client_id = ANY($2::uuid[])"],
    tail: ""
  }]
];

test("every ledger read keeps its exact FROM, WHERE conditions and cap, with the windows equal to the JS ones", () => {
  assert.equal(SQL_SHAPES.length, PULL_READ_SQL.length, "every read is pinned");
  assert.deepEqual(SQL_SHAPES.map(([, sql]) => sql), [...PULL_READ_SQL]);
  for (const [name, sql, want] of SQL_SHAPES) {
    assert.deepEqual(sqlShape(sql), want, name);
  }
});

test("the clause reader sees each way a read can be broken: a dropped condition, a widened window, a lost scope", () => {
  const wantFor = (sql) => SQL_SHAPES.find(([, original]) => original === sql)[2];
  const mutations = [
    // The kinds of break that unit tests with canned rows cannot see.
    ["the paid filter dropped (an unpaid sent link would read as a paying buyer)", PAID_FORM_ORDERS_SQL, "AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)", ""],
    ["the paid filter dropped from the diagnostic read", PAID_DIAGNOSTICS_SQL, "AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)", ""],
    ["the roadmap-order filter dropped", PAID_FORM_ORDERS_SQL, "AND lower(btrim(COALESCE(pl.description, ''))) LIKE 'slo diagnostic%'", ""],
    ["the form-stored filter dropped", PAID_FORM_ORDERS_SQL, "AND pl.identity_stored_at IS NULL", ""],
    ["the 14 day window widened", PAID_FORM_ORDERS_SQL, `interval '${PAID_FORM_LOOKBACK_DAYS} days'`, "interval '365 days'"],
    ["the 30 day window widened", PAID_DIAGNOSTICS_SQL, `interval '${NO_PULL_LOOKBACK_DAYS} days'`, "interval '365 days'"],
    ["the 3 day window removed from the ledger", LEDGER_SQL, ` OR r.requested_at > $2::timestamptz - interval '${FAILED_LOOKBACK_DAYS} days'`, ""],
    ["the 3 day window widened in the ledger", LEDGER_SQL, `interval '${FAILED_LOOKBACK_DAYS} days'`, "interval '30 days'"],
    ["the per-client scope removed from the pull rows", PULL_TIMES_SQL, "AND r.client_id = ANY($2::uuid[])", ""],
    ["the per-client scope removed from the credit-file read", HAS_FILE_SQL, "AND cr.client_id = ANY($2::uuid[])", ""],
    ["the per-client scope removed from the reminder read", NUDGES_SQL, "AND m.client_id = ANY($2::uuid[])", ""],
    ["the per-client scope removed from the consent read", LIVE_CONSENT_SQL, "AND cc.client_id = ANY($3::uuid[])", ""],
    ["the company filter removed from the paid-form read", PAID_FORM_ORDERS_SQL, "WHERE pl.org_id = $1::uuid\n   AND ", "WHERE "],
    ["the company filter removed from the ledger", LEDGER_SQL, "WHERE r.org_id = $1::uuid\n   AND ", "WHERE "],
    ["the company filter removed from the pull rows", PULL_TIMES_SQL, "WHERE r.org_id = $1::uuid\n   AND ", "WHERE "],
    ["the company filter removed from the join", LEDGER_SQL, " AND c.org_id = r.org_id", ""],
    ["the demo filter removed", PAID_DIAGNOSTICS_SQL, "AND ($3::boolean OR COALESCE(pl.is_demo, false) = false)", ""],
    ["the test-client filter removed", LEDGER_SQL, "AND ($3::boolean OR NOT", "AND (true OR NOT"],
    ["the consent revoked rule dropped", LIVE_CONSENT_SQL, "revoked_at IS NULL", "true"],
    ["open pulls no longer sort first", LEDGER_SQL, "ORDER BY (r.status IN ('queued', 'processing')) DESC, ", "ORDER BY "],
    ["the row cap raised", LEDGER_SQL, `LIMIT ${LEDGER_ROW_CAP}`, "LIMIT 100000"],
    ["the pull state no longer read", PULL_TIMES_SQL, "r.status,\n       r.resolved_at,", "r.resolved_at,"]
  ];
  for (const [name, original, from, to] of mutations) {
    assert.ok(original.includes(from), `the mutation target is in the SQL: ${name}`);
    assert.notDeepEqual(sqlShape(original.replace(from, to)), wantFor(original), `a change goes unseen: ${name}`);
  }
});

test("the ledger rows skip, they never pass, with no database, no company, or a read that fails", async () => {
  for (const make of [checkRequestFailedOrStuck, checkPaidFormNotFilled, checkApproveClickNoPull]) {
    const noDb = await make({ orgId: ORG, now: NOW });
    assert.equal(noDb.status, "skip");
    assert.match(noDb.detail, /no database in this run/);
    const noOrg = await make({ scope: (fn) => fn(ledgerTx({})), now: NOW });
    assert.equal(noOrg.status, "skip");
    assert.match(noOrg.detail, /no company in this run/);
    const badOrg = await make({ scope: (fn) => fn(ledgerTx({})), orgId: "nope", now: NOW });
    assert.equal(badOrg.status, "skip");
    const broken = await make(scoped(ledgerTx({}, { fail: /gap:softpull-/ })));
    assert.equal(broken.status, "skip");
    assert.match(broken.detail, /could not read .*connection terminated/);
    assert.equal(broken.suggestedFix, null);
  }
});

test("a read that hangs becomes a skip after 8 seconds, so it cannot hold up the lane", async (t) => {
  assert.equal(READ_TIMEOUT_MS, 8000);
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const hang = { scope: () => new Promise(() => {}), orgId: ORG, now: NOW };
  const pending = checkRequestFailedOrStuck(hang);
  t.mock.timers.tick(READ_TIMEOUT_MS + 1);
  const row = await pending;
  assert.equal(row.status, "skip");
  assert.match(row.detail, /took longer than 8 seconds/);
});

test("with no scope the plain pool is used, and the asStaff shape works too", async () => {
  const plain = ledgerTx({ ledger: [ledgerRow({ status: "failed", requested_at: ago(HOUR) })] });
  const viaDb = await checkRequestFailedOrStuck({ db: plain, orgId: ORG, now: NOW });
  assert.equal(viaDb.status, "FAIL");
  const staff = ledgerTx({ ledger: [ledgerRow()] });
  const viaStaff = await checkRequestFailedOrStuck({ scope: { asStaff: (fn) => fn(staff) }, orgId: ORG, now: NOW });
  assert.equal(viaStaff.status, "PASS");
  for (const tx of [plain, staff]) {
    for (const call of tx.calls) assert.doesNotMatch(call.sql, /\b(BEGIN|COMMIT|ROLLBACK|SET)\b/);
  }
});

test("the lane returns the door rows and then the ledger rows, red ones carry a fix", async () => {
  const { fetchImpl } = fakeFetch([
    { url: `https://fundhub.ai${APPROVE_PAGE_PATH}`, status: 200, body: PAGE_HTML },
    { url: `https://fundhub.ai${APPROVE_READ_PATH}`, status: 400, body: UNSIGNED }
  ]);
  const both = laneDb({
    ledger: [ledgerRow({ status: "failed", state_reason: "not_configured", requested_at: ago(HOUR) })],
    // Buyer B paid and never filled the form. Client A approved and paid and got no pull.
    formOrders: [formOrder({ client_id: CLIENT_B })],
    diagnostics: [paidOrder()],
    live: [{ client_id: CLIENT_A, granted_at: ago(4 * HOUR) }]
  });
  const rows = await gapChecks({ fetchImpl, db: both, scope: (fn) => fn(both), orgId: ORG, env: ENV, now: NOW });
  assertShape(rows);
  assert.deepEqual(rows.map((r) => r.status), ["PASS", "PASS", "PASS", "FAIL", "FAIL", "FAIL"]);
  assert.deepEqual(rows.map((r) => r.id), [...ALL_CHECK_IDS]);
});

test("age words are short and plain", () => {
  assert.equal(ageText(52 * MIN), "52 min");
  assert.equal(ageText(MIN / 4), "1 min");
  assert.equal(ageText(5 * HOUR), "5 hours");
  assert.equal(ageText(3 * DAY), "3 days");
  assert.equal(ageText(-5), "1 min");
  assert.equal(ageText("junk"), "1 min");
});

// ---------------------------------------------------------------------------
// The ledger SQL, run for real (2026-10-09).
//
// The tests above feed canned rows to the judge and pin the SQL text. These run
// the real statements, through the real check functions, on Postgres. Every
// table the lane reads is replaced by made-up rows (WITH clients AS (...)
// hides the table for that one statement), so no real row is read or written
// and it is safe on any database, production included. The column types come
// from the real tables, so a renamed column fails here.
// Skipped, and said so, when there is no DATABASE_URL.
// ---------------------------------------------------------------------------

const HAS_DB = Boolean(process.env.DATABASE_URL);
const OTHER_ORG = "22222222-2222-4222-8222-222222222299";
const SHADOWED_TABLES = ["clients", "soft_pull_requests", "payment_links", "client_consents", "crs_results", "messages"];

function shadowWith(rowsByTable) {
  return SHADOWED_TABLES.map((table) => {
    const rows = rowsByTable[table] || [];
    return `${table} AS (SELECT * FROM jsonb_populate_recordset(NULL::${table}, $wi$${JSON.stringify(rows)}$wi$::jsonb))`;
  }).join(", ");
}

const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Made-up rows for one scenario. `ago` counts back from one fixed "now". */
function world(baseMs) {
  const ago = (ms) => new Date(baseMs - ms).toISOString();
  const person = (n, over = {}) => ({
    id: U(n), org_id: ORG, email: `real.person${n}@gmail.com`, is_demo: false, custom_fields: {}, ...over
  });
  const pull = (n, over = {}) => ({
    id: U(900 + n), org_id: ORG, client_id: U(n), requested_by_kind: "client", reason: "x",
    status: "fulfilled", provider: "internal", requested_at: ago(HOUR), updated_at: ago(HOUR),
    resolved_at: ago(HOUR), state_reason: null, idempotency_key: "diagnostic-paid:evt-1", ...over
  });
  const openPull = (n, over = {}) => pull(n, { status: "queued", resolved_at: null, ...over });
  const roadmap = (n, over = {}) => ({
    id: U(800 + n), org_id: ORG, client_id: U(n), purpose: "diagnostic", description: "SLO diagnostic",
    status: "paid", paid_at: ago(3 * HOUR), updated_at: ago(3 * HOUR), is_demo: false, identity_stored_at: null, ...over
  });
  const approve = (n, over = {}) => roadmap(n, { id: U(850 + n), description: "UnderwriteIQ soft-pull assessment", ...over });
  const consent = (n, over = {}) => ({
    id: U(650 + n), org_id: ORG, client_id: U(n), kind: "soft_pull_consent",
    granted_at: ago(4 * HOUR), revoked_at: null, expires_at: null, ...over
  });
  const reminder = (n, over = {}) => ({
    id: U(700 + n), org_id: ORG, client_id: U(n), template_key: "EMAIL-SLO-PAID-FORM-01",
    status: "sent", created_at: ago(2 * HOUR + 40 * MIN), ...over
  });
  return { ago, person, pull, openPull, roadmap, approve, consent, reminder };
}

const LEDGER_CASES = [
  ["only healthy pulls", (w) => ({ clients: [w.person(1)], soft_pull_requests: [w.pull(1)] }), "PASS"],
  ["a pull that failed an hour ago", (w) => ({ clients: [w.person(1)], soft_pull_requests: [w.pull(1, { status: "failed", state_reason: "not_configured" })] }), "FAIL", /1 failed in the last 3 days \(reason: not_configured\)/],
  ["failed, then retried and done: forgiven", (w) => ({ clients: [w.person(1)], soft_pull_requests: [w.pull(1, { status: "failed", requested_at: w.ago(3 * HOUR) }), { ...w.pull(1, { requested_at: w.ago(2 * HOUR) }), id: U(990) }] }), "PASS"],
  ["failed 4 days ago is old news", (w) => ({ clients: [w.person(1)], soft_pull_requests: [w.pull(1, { status: "failed", requested_at: w.ago(4 * DAY), resolved_at: w.ago(4 * DAY) })] }), "PASS"],
  ["a paid-diagnostic pull queued for 30 minutes", (w) => ({ clients: [w.person(1)], soft_pull_requests: [w.openPull(1, { requested_at: w.ago(30 * MIN), updated_at: w.ago(30 * MIN) })] }), "FAIL", /still queued after 15 min/],
  ["the same pull queued for 5 minutes", (w) => ({ clients: [w.person(1)], soft_pull_requests: [w.openPull(1, { requested_at: w.ago(5 * MIN), updated_at: w.ago(5 * MIN) })] }), "PASS"],
  ["a pull held by a runner and untouched for 40 minutes", (w) => ({ clients: [w.person(1)], soft_pull_requests: [w.pull(1, { status: "processing", resolved_at: null, updated_at: w.ago(40 * MIN) })] }), "FAIL", /stuck mid-run/],
  ["a staff tap queued for 60 hours", (w) => ({ clients: [w.person(1)], soft_pull_requests: [w.openPull(1, { requested_by_kind: "staff", idempotency_key: null, requested_at: w.ago(60 * HOUR), updated_at: w.ago(60 * HOUR) })] }), "FAIL", /waiting on staff/],
  ["a staff tap queued for 10 hours", (w) => ({ clients: [w.person(1)], soft_pull_requests: [w.openPull(1, { requested_by_kind: "staff", idempotency_key: null, requested_at: w.ago(10 * HOUR), updated_at: w.ago(10 * HOUR) })] }), "PASS"],
  ["a failed pull of a +sim test client is left out", (w) => ({ clients: [w.person(1, { email: "x+sim-4@gmail.com" })], soft_pull_requests: [w.pull(1, { status: "failed" })] }), "PASS"],
  ["a failed pull of a demo client is left out", (w) => ({ clients: [w.person(1, { is_demo: true })], soft_pull_requests: [w.pull(1, { status: "failed" })] }), "PASS"],
  ["a failed pull of a synthetic client is left out", (w) => ({ clients: [w.person(1, { custom_fields: { synthetic: "true" } })], soft_pull_requests: [w.pull(1, { status: "failed" })] }), "PASS"],
  ["the same test client, with the demo switch on, is read", (w) => ({ clients: [w.person(1, { email: "x+sim-4@gmail.com" })], soft_pull_requests: [w.pull(1, { status: "failed" })] }), "FAIL", /1 failed/, { demoOn: true }],
  ["a failed pull from another company", (w) => ({ clients: [w.person(1, { org_id: OTHER_ORG })], soft_pull_requests: [w.pull(1, { status: "failed", org_id: OTHER_ORG })] }), "PASS"],
  [
    "a stuck pull is still read when 520 newer healthy pulls sit on top of it (open pulls sort first)",
    (w) => ({
      clients: Array.from({ length: 521 }, (_, i) => w.person(i + 1)),
      soft_pull_requests: [
        w.openPull(1, { requested_at: w.ago(2 * DAY), updated_at: w.ago(2 * DAY) }),
        ...Array.from({ length: 520 }, (_, i) => w.pull(i + 2, { requested_at: w.ago(HOUR + i * MIN), resolved_at: w.ago(HOUR + i * MIN), updated_at: w.ago(HOUR + i * MIN) }))
      ]
    }),
    "FAIL",
    /1 still queued after 15 min/
  ]
];

const PAID_FORM_CASES = [
  ["paid 3 hours ago, no form, no reminder", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1)] }), "FAIL", /1 paid roadmap buyer has not filled the pull form/],
  ["the same buyer with a reminder sent", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1)], messages: [w.reminder(1)] }), "PASS"],
  ["the same buyer, reminder bounced", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1)], messages: [w.reminder(1, { status: "bounced" })] }), "FAIL"],
  ["the same buyer, reminder from before the payment", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1)], messages: [w.reminder(1, { created_at: w.ago(5 * HOUR) })] }), "FAIL"],
  ["the same buyer, live consent", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1)], client_consents: [w.consent(1)] }), "PASS"],
  ["the same buyer, consent revoked", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1)], client_consents: [w.consent(1, { revoked_at: w.ago(30 * MIN) })] }), "FAIL"],
  ["the same buyer, consent expired", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1)], client_consents: [w.consent(1, { expires_at: w.ago(MIN) })] }), "FAIL"],
  ["the same buyer already holds a credit file", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1)], crs_results: [{ id: U(500), org_id: ORG, client_id: U(1), is_demo: false }] }), "PASS"],
  ["a demo credit file is not a credit file", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1)], crs_results: [{ id: U(500), org_id: ORG, client_id: U(1), is_demo: true }] }), "FAIL"],
  ["paid only an hour ago", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1, { paid_at: w.ago(HOUR), updated_at: w.ago(HOUR) })] }), "PASS"],
  ["paid 20 days ago is the consent lane's job", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1, { paid_at: w.ago(20 * DAY), updated_at: w.ago(20 * DAY) })] }), "PASS"],
  ["the form is in (identity stored)", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1, { identity_stored_at: w.ago(HOUR) })] }), "PASS"],
  ["a demo order", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1, { is_demo: true })] }), "PASS"],
  ["the $32 approve-link order is not a roadmap order", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1)] }), "PASS"],
  ["a company address", (w) => ({ clients: [w.person(1, { email: "staff@fundhub.ai" })], payment_links: [w.roadmap(1)] }), "PASS"],
  ["a roadmap link that was sent and never paid is not a paying buyer", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1, { status: "sent", paid_at: null })] }), "PASS"],
  ["fifteen sent, unpaid roadmap links (what production holds today)", (w) => ({ clients: Array.from({ length: 15 }, (_, i) => w.person(i + 1)), payment_links: Array.from({ length: 15 }, (_, i) => w.roadmap(i + 1, { status: "sent", paid_at: null })) }), "PASS"],
  ["a paid order from another company", (w) => ({ clients: [w.person(1, { org_id: OTHER_ORG })], payment_links: [w.roadmap(1, { org_id: OTHER_ORG })] }), "PASS"]
];

const NO_PULL_CASES = [
  ["approved, paid 3 hours ago, no pull row", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1)], client_consents: [w.consent(1)] }), "FAIL", /1 client approved the pull and paid, and no pull was started/],
  ["the $297 roadmap order counts the same way", (w) => ({ clients: [w.person(1)], payment_links: [w.roadmap(1)], client_consents: [w.consent(1)] }), "FAIL"],
  ["a pull row made after the payment", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1)], client_consents: [w.consent(1)], soft_pull_requests: [w.pull(1, { requested_at: w.ago(2 * HOUR + 50 * MIN) })] }), "PASS"],
  ["only a pull from 10 days ago", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1)], client_consents: [w.consent(1)], soft_pull_requests: [w.pull(1, { requested_at: w.ago(10 * DAY), resolved_at: w.ago(10 * DAY), updated_at: w.ago(10 * DAY) })] }), "FAIL"],
  ["a staff pull queued a day before the payment, done an hour ago", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1)], client_consents: [w.consent(1)], soft_pull_requests: [w.pull(1, { requested_at: w.ago(DAY + 3 * HOUR), resolved_at: w.ago(HOUR), updated_at: w.ago(HOUR) })] }), "PASS"],
  ["a pull queued a day before the payment, still queued", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1)], client_consents: [w.consent(1)], soft_pull_requests: [w.openPull(1, { requested_at: w.ago(DAY + 3 * HOUR), updated_at: w.ago(DAY + 3 * HOUR) })] }), "PASS"],
  ["a pull a runner is holding", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1)], client_consents: [w.consent(1)], soft_pull_requests: [w.pull(1, { status: "processing", requested_at: w.ago(DAY), resolved_at: null, updated_at: w.ago(MIN) })] }), "PASS"],
  ["a pull that closed two days before the payment", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1)], client_consents: [w.consent(1)], soft_pull_requests: [w.pull(1, { requested_at: w.ago(3 * DAY), resolved_at: w.ago(2 * DAY), updated_at: w.ago(2 * DAY) })] }), "FAIL"],
  ["another client's pull does not answer this payment", (w) => ({ clients: [w.person(1), w.person(2)], payment_links: [w.approve(1)], client_consents: [w.consent(1)], soft_pull_requests: [w.pull(2, { requested_at: w.ago(HOUR) })] }), "FAIL"],
  ["no consent at all", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1)] }), "PASS"],
  ["consent revoked", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1)], client_consents: [w.consent(1, { revoked_at: w.ago(HOUR) })] }), "PASS"],
  ["paid only 5 minutes ago", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1, { paid_at: w.ago(5 * MIN), updated_at: w.ago(5 * MIN) })], client_consents: [w.consent(1)] }), "PASS"],
  ["a demo order", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1, { is_demo: true })], client_consents: [w.consent(1)] }), "PASS"],
  ["a repair payment is not a diagnostic", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1, { purpose: "repair" })], client_consents: [w.consent(1)] }), "PASS"],
  ["a link that was sent and never paid", (w) => ({ clients: [w.person(1)], payment_links: [w.approve(1, { status: "sent", paid_at: null })], client_consents: [w.consent(1)] }), "PASS"],
  ["a paid order from another company", (w) => ({ clients: [w.person(1, { org_id: OTHER_ORG })], payment_links: [w.approve(1, { org_id: OTHER_ORG })], client_consents: [w.consent(1, { org_id: OTHER_ORG })] }), "PASS"]
];

describe("gap soft-pull: the ledger SQL, run for real", { skip: HAS_DB ? false : "no DATABASE_URL" }, () => {
  let pgdb;
  let closeDb;

  before(async () => {
    const mod = await import("../../db.mjs");
    pgdb = mod.db;
    closeDb = mod.close;
  });

  after(async () => {
    if (closeDb) await closeDb();
  });

  const run = (check, build, extra = {}) => {
    const baseMs = Date.now();
    const rows = build(world(baseMs));
    const db = {
      async query(sql, params) {
        return pgdb.query(`WITH ${shadowWith(rows)} ${sql}`, params);
      }
    };
    return check({ db, scope: (fn) => fn(db), orgId: ORG, now: new Date(baseMs), ...extra });
  };

  const suites = [
    ["request-failed-or-stuck", checkRequestFailedOrStuck, LEDGER_CASES],
    ["paid-form-not-filled-2h", checkPaidFormNotFilled, PAID_FORM_CASES],
    ["approve-click-no-pull", checkApproveClickNoPull, NO_PULL_CASES]
  ];
  for (const [label, check, cases] of suites) {
    for (const [name, build, want, detail, extra] of cases) {
      test(`${label}: ${name}`, async () => {
        const row = await run(check, build, extra || {});
        assert.equal(row.status, want, `${want} expected, got ${row.status}: ${row.detail}`);
        if (detail) assert.match(row.detail, detail);
      });
    }
  }

  test("a read that runs on made-up rows touches no real table", async () => {
    const baseMs = Date.now();
    const rows = world(baseMs);
    const text = `WITH ${shadowWith({ clients: [rows.person(1)] })} SELECT (SELECT count(*) FROM clients) AS n`;
    const { rows: got } = await pgdb.query(text);
    assert.equal(Number(got[0].n), 1, "the shadow table answers, not the real one");
  });
});
