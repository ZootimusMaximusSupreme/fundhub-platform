/* The two Finance OS bills / cash-flow endpoints, driven end to end.
 *
 *   api/finance/bills.mjs    — what repeats every month, and the charges behind it
 *   api/finance/cashflow.mjs — whether the account can cover it, and the three
 *                              operator thresholds behind that answer
 *
 * WHY THIS FILE EXISTS AND WHERE IT LIVES. package.json's test glob walks src/
 * and scripts/ ONLY (CLAUDE.md, traps), so a test placed next to the handler
 * under api/ never runs and reports nothing while doing it. It lives here and
 * imports the handlers from api/.
 *
 * WHY IT NEEDS NO DATABASE. src/db.mjs exports `db` as a plain object with one
 * `query` method, so both the session lookup and every module call underneath
 * are stubbed and the handlers run exactly as they do in production. Same
 * approach as src/http/subscriptions-endpoints.test.mjs and
 * src/http/finance-os-endpoints.test.mjs, and for the same reason: the tenancy
 * rules these endpoints turn on are INVISIBLE on a one-org database, and every
 * database this repo has is a one-org database.
 *
 * THE SIX THINGS THIS FILE IS ACTUALLY GUARDING.
 *
 *   1. ORG COMES FROM THE SESSION. Every read and every write must bind
 *      staff.org_id and must never bind an org id from the query string or the
 *      body. A session with no org must match nothing rather than everything.
 *      The evidence read is the sharp one: getBillEvidence() takes no orgId and
 *      filters on none, so the handler's ownership check is the ONLY guard on
 *      that path and this file asserts it runs BEFORE the join.
 *
 *   2. A CANDIDATE IS NOT A BILL. The detector, the store and the seam all keep
 *      low-confidence guesses in a separate list, and an endpoint that merged
 *      them back into one array would undo all three at once. `candidates` must
 *      stay empty unless the caller asked by name — and `candidate_count` must
 *      be honest either way, so a screen can say what it is not showing.
 *
 *   3. THE PROJECTION GETS BILLS IN THE CAMELCASE VOCABULARY. Feeding raw
 *      snake_case rows to the cash-flow seam throws NOTHING and produces a
 *      client with no bills at all, which reads as "you are fine"
 *      (src/banking/recurring.mjs:1169). The test feeds real column names and
 *      asserts the bill reaches the projection.
 *
 *   4. AN UNKNOWN IS NOT ZERO. A NULL balance must refuse the whole projection
 *      rather than being summed as nothing; a NULL threshold must come back as
 *      an ABSENT key rather than a 0; and clearing a threshold must write NULL
 *      rather than COALESCE to zero.
 *
 *   5. A SIGN-OFF BELONGS TO A NUMBER. Changing a value must clear its
 *      signature, and signing off is refused unless the value is in the same
 *      request — otherwise a NULL can be signed off and drops out of
 *      v_cashflow_config_gaps while it is still unset.
 *
 *   6. A REFUSAL IS NOT A CRASH. A missing horizon, a percentage typed into a
 *      fraction field, a card belonging to another client and an unknown
 *      sign_off name are each asserted to be a 400 carrying a sentence, not an
 *      unhandled throw that netlify/functions/api.mjs:334 renders as HTTP 500
 *      "the server broke".
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import bills from "../../api/finance/bills.mjs";
import cashflow from "../../api/finance/cashflow.mjs";
import { assertBind, assertSqlHas } from "../testing/s3-scoped-rows.mjs";

/* Two orgs, deliberately. The caller belongs to ORG_A. ORG_B is the tenant
   whose ids get handed in. On a single-org database these are the same value
   and every scoping assertion below is unobservable. */
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const CID = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const ACC = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const BILL = "cccccccc-1111-4111-8111-cccccccccccc";
const LIA = "bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb";
const OTHER_LIA = "99999999-1111-4111-8111-999999999999";

let savedQuery = null;
let savedConnect = null;
beforeEach(() => { savedQuery = db.query; savedConnect = db.connect; });
afterEach(() => {
  db.query = savedQuery;
  if (savedConnect === undefined) delete db.connect; else db.connect = savedConnect;
});

const makeRes = () => ({
  statusCode: 0,
  body: null,
  headers: {},
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; }
});

/* ── fixtures, in the shapes the COLUMNS actually produce ──────────────────
   bigint arrives from node-postgres as a STRING and `date` arrives as a Date at
   LOCAL midnight. Both are wrong here on purpose: a fixture of tidy numbers and
   ISO strings tests a database this repo does not have, and the two conversions
   are exactly where the expensive mistakes live (a day-before date, an amount
   read a hundredfold out). */
const BILL_ROW = (over = {}) => ({
  id: BILL, org_id: ORG_A, client_id: CID, bank_account_id: ACC,
  merchant_key: "netflix", merchant_display: "NETFLIX.COM", cadence: "monthly",
  typical_amount_cents: "-1599",
  anchor_day_of_month: 12,
  next_expected_on: new Date(2026, 7, 12),      // 12 August 2026, local midnight
  next_expected_unknown_reason: null,
  confidence_pct: 82, confidence_label: "high",
  is_business: false, occurrence_count: 6,
  first_seen_on: new Date(2026, 1, 12),
  last_seen_on: new Date(2026, 6, 12),
  detected_as_of: new Date("2026-07-30T00:00:00.000Z"),
  ...over
});

const ACCOUNT_ROW = (over = {}) => ({
  id: ACC, name: "Everyday Checking", official_name: null, mask: "1234",
  account_type: "depository", account_subtype: "checking", entity_kind: "personal",
  closed_at: null, balance_cents: "250000",
  balance_as_of: "2026-07-30T00:00:00.000Z", currency_code: "USD",
  created_at: "2026-01-01T00:00:00.000Z",
  ...over
});

const CARD_ROW = (over = {}) => ({
  id: LIA, tradeline_id: "dddddddd-1111-4111-8111-dddddddddddd",
  as_of: new Date(2026, 6, 20),
  payment_due_date: new Date(2026, 7, 15),
  statement_date: new Date(2026, 6, 20),
  minimum_payment_cents: "3500", statement_balance_cents: "120000",
  current_balance_cents: "120000", lender: "Amex Blue Business", kind: "revolving",
  ...over
});

const SETTINGS_ROW = (over = {}) => ({
  min_buffer_cents: "0", confidence_floor: "0.550", settlement_lead_days: 3, ...over
});

/**
 * stubDb — a ROUTER, not a single matcher.
 *
 * These handlers issue several different statements per request and the point of
 * most of the tests below is WHICH statements ran and what they were bound to.
 * Every query is recorded — SQL text and parameters — and the recording is what
 * tenancy is proved against. An unmatched statement THROWS rather than returning
 * an empty result: a silent `{rows:[]}` for a query nobody anticipated is how a
 * test passes while asserting nothing.
 */
function stubDb({
  role = "owner",
  orgId = ORG_A,
  authenticated = true,
  ownsClient = true,
  billRows = [BILL_ROW()],
  accountRows = [ACCOUNT_ROW()],
  cardRows = [CARD_ROW()],
  settingsRows = [SETTINGS_ROW()],
  gapRows = [],
  txRows = [],
  txCount = "412",
  evidenceRows = [],
  reminderRows = [],
  insertedReminder = { id: "ffffffff-1111-4111-8111-ffffffffffff", reminder_kind: "payment_due" }
} = {}) {
  const queries = [];
  db.query = async (sql, params) => {
    assertBind(sql, params);
    const text = String(sql).replace(/\s+/g, " ").trim();

    // verifySession's CTE. Recognised by naming `sessions` and nothing of ours.
    if (/sessions/i.test(text) && !/recurring_bill|bank_|clients|card_liabilities|cashflow_/i.test(text)) {
      if (!authenticated) return { rows: [] };
      return {
        rows: [{
          session_id: "sess-1",
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
          staff_id: "staff-1", id: "staff-1",
          org_id: orgId, role,
          email: `${role}@fundhub.ai`, name: "The Owner",
          status: "active", active_flag: "true"
        }]
      };
    }

    queries.push({ sql: text, params });

    if (/FROM clients WHERE id/i.test(text)) return { rows: ownsClient ? [{ "?column?": 1 }] : [] };
    if (/FROM recurring_bill_transactions/i.test(text)) return { rows: evidenceRows };
    if (/FROM recurring_bills/i.test(text)) return { rows: billRows };
    if (/count\(\*\)/i.test(text)) return { rows: [{ n: txCount }] };
    if (/FROM bank_transactions/i.test(text)) return { rows: txRows };
    if (/FROM bank_accounts/i.test(text)) return { rows: accountRows };
    if (/FROM card_liabilities/i.test(text)) return { rows: cardRows };
    if (/FROM cashflow_settings/i.test(text)) return { rows: settingsRows };
    if (/v_cashflow_config_gaps/i.test(text)) return { rows: gapRows };
    if (/INSERT INTO cashflow_settings/i.test(text)) return { rows: [] };
    if (/INSERT INTO cashflow_reminders/i.test(text)) return { rows: [insertedReminder] };
    if (/UPDATE cashflow_reminders/i.test(text)) return { rows: reminderRows };
    if (/FROM cashflow_reminders/i.test(text)) return { rows: reminderRows };

    if (/INSERT INTO recurring_bills/i.test(text)) {
      // RETURNING * — saveDetection reads `.id` off this to hang evidence on.
      return { rows: [{ id: BILL }] };
    }
    if (/(DELETE FROM|INSERT INTO) recurring_bill_transactions/i.test(text)) return { rows: [] };

    throw new Error(`test stub: no route for SQL: ${text.slice(0, 120)}`);
  };

  /* THE WRITE PATH NEEDS A `connect`, AND STUBBING IT IS THE POINT RATHER THAN A
     WORKAROUND. saveDetection() hands the shared handle to withTransaction(),
     which reaches for pool().connect() precisely because `db` is `{ query }`
     with no connect — the fix for the broken probe documented at
     src/finance/soft-pulls.mjs:502, where writes silently ran with autocommit.
     Without DATABASE_URL that reach throws, and the handler cannot be exercised.

     So the seam is stubbed HERE, at the same object the test already replaces
     `query` on, and the client records BEGIN / COMMIT / ROLLBACK. That makes the
     transaction assertable: a detection that half-writes leaves a bill asserting
     a client pays $54.99 a month with nothing behind it, which is worse than not
     writing it at all because it is indistinguishable from a well-evidenced bill
     at every call site that does not join. The COLUMN NAMES the insert uses are
     guarded separately, against real Postgres, by src/banking/recurring.pg.test.mjs
     — that is a 031_invoices-class defect and a fake cannot catch it. */
  const txLog = [];
  db.connect = async () => ({
    query: async (sql, params) => {
      assertBind(sql, params);
      const text = String(sql).replace(/\s+/g, " ").trim();
      if (/^(BEGIN|COMMIT|ROLLBACK)$/i.test(text)) { txLog.push(text.toUpperCase()); return { rows: [] }; }
      return db.query(sql, params);
    },
    release() {}
  });

  queries.tx = txLog;
  return queries;
}

async function call(handler, { method = "GET", query = {}, body = null } = {}) {
  const res = makeRes();
  await handler(
    { method, query, body, headers: { authorization: "Bearer t0ken" } },
    res
  );
  return res;
}

const sqlOf = (queries, re) => queries.find((q) => re.test(q.sql)).sql;

/* Every parameter bound by every statement, flattened. Used to prove that a
   value NEVER reaches the database — the strongest form of "this endpoint
   cannot be talked into reading another company's rows". */
const allParams = (queries) => queries.flatMap((q) => q.params ?? []);

/* ══════════════════════════════════════════════════════════════════════════
 * 1. Org scoping. Every read and every write, both endpoints.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills + cashflow — the org comes from the session and nowhere else", () => {

  test("the bills read binds the session's org, not one from the query string", async () => {
    const q = stubDb({});
    const res = await call(bills, { query: { client_id: CID, org_id: ORG_B } });
    assert.equal(res.statusCode, 200);
    const bound = allParams(q);
    assert.ok(bound.includes(ORG_A), "the session's org was never bound");
    assert.ok(!bound.includes(ORG_B),
      "an org id from the QUERY STRING reached the database — one company can read another's bills");
  });

  test("a POST carrying org_id is refused outright rather than having it ignored", async () => {
    stubDb({});
    for (const field of ["org_id", "orgId"]) {
      const res = await call(bills, {
        method: "POST", body: { action: "redetect", client_id: CID, [field]: ORG_B }
      });
      assert.equal(res.statusCode, 400, `${field} was accepted`);
      assert.match(res.body.error, new RegExp(`${field}_not_accepted`));
    }
  });

  test("a session with no org fails CLOSED — nothing is read at all", async () => {
    const q = stubDb({ orgId: null });
    const res = await call(bills, { query: { client_id: CID } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "org_required");
    assert.equal(q.length, 0, "a session with no company still queried the database");
  });

  test("the cash-flow projection binds the session's org for every read it makes", async () => {
    const q = stubDb({});
    const res = await call(cashflow, { query: { client_id: CID, horizon_days: "45", org_id: ORG_B } });
    assert.equal(res.statusCode, 200);
    const bound = allParams(q);
    assert.ok(!bound.includes(ORG_B), "a query-string org reached the projection's reads");
    for (const table of [/bank_accounts/, /card_liabilities/, /recurring_bills/, /cashflow_settings/]) {
      const stmt = q.find((x) => table.test(x.sql));
      assert.ok(stmt, `no statement matched ${table}`);
      assert.ok((stmt.params ?? []).includes(ORG_A),
        `the read against ${table} did not bind the caller's org: ${stmt.sql.slice(0, 80)}`);
    }
  });

  test("a client belonging to another company is refused before anything is read", async () => {
    const q = stubDb({ ownsClient: false });
    const res = await call(cashflow, { query: { client_id: CID, horizon_days: "30" } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
    assert.ok(!q.some((x) => /bank_accounts|card_liabilities/i.test(x.sql)),
      "the client's accounts were read before the ownership check answered");
  });

  test("only owner and admin get in; a closer is refused with the roles named", async () => {
    stubDb({ role: "closer" });
    const res = await call(bills, { query: { client_id: CID } });
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "forbidden");
    assert.match(res.body.message, /owner/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 2. The evidence read — the one path with no org filter underneath it.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills — the charges behind one bill", () => {

  test("ownership is checked BEFORE the evidence join, which has no org filter of its own", async () => {
    const q = stubDb({
      evidenceRows: [{
        id: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee", bank_account_id: ACC,
        posted_on: new Date(2026, 6, 12), authorized_on: null,
        merchant_name: "NETFLIX.COM", category: "subscriptions", is_pending: false,
        provider_transaction_id: "px-1", amount_cents: "-1599", raw: { huge: "payload" }
      }]
    });
    const res = await call(bills, { query: { bill_id: BILL } });
    assert.equal(res.statusCode, 200);

    const guardAt = q.findIndex((x) => /FROM recurring_bills WHERE id/i.test(x.sql));
    const joinAt = q.findIndex((x) => /recurring_bill_transactions/i.test(x.sql));
    assert.ok(guardAt >= 0, "the ownership guard never ran");
    assert.ok(joinAt > guardAt,
      "getBillEvidence() takes no orgId and filters on none — the guard MUST run first, " +
      "and here it did not");
    assert.ok((q[guardAt].params ?? []).includes(ORG_A), "the guard did not bind the caller's org");
    assertSqlHas(q[guardAt].sql, { "the bill, in this company": "WHERE id = $1 AND org_id = $2" });
    assertSqlHas(q[joinAt].sql, {
      "the charges linked to that one bill": "FROM recurring_bill_transactions l JOIN bank_transactions t ON t.id = l.bank_transaction_id WHERE l.recurring_bill_id = $1",
      "oldest charge first": "ORDER BY t.posted_on ASC, t.provider_transaction_id ASC"
    });
  });

  test("a bill this company does not own is refused and no evidence is read", async () => {
    const q = stubDb({ billRows: [] });   // the guard's SELECT 1 comes back empty
    const res = await call(bills, { query: { bill_id: BILL } });
    assert.equal(res.statusCode, 403);
    assert.ok(!q.some((x) => /recurring_bill_transactions/i.test(x.sql)),
      "another company's evidence was read after a failed ownership check");
  });

  test("the provider's whole raw payload does not cross the wire", async () => {
    stubDb({
      evidenceRows: [{
        id: "e1", bank_account_id: ACC, posted_on: new Date(2026, 6, 12),
        merchant_name: "NETFLIX.COM", amount_cents: "-1599",
        provider_transaction_id: "px-1", is_pending: false,
        raw: { access_token_shaped: "do-not-ship-me" }
      }]
    });
    const res = await call(bills, { query: { bill_id: BILL } });
    assert.equal(res.statusCode, 200);
    assert.ok(!JSON.stringify(res.body).includes("do-not-ship-me"),
      "the unparsed provider record is being shipped to the browser");
    assert.equal(res.body.evidence[0].amount_display, "-15.99",
      "the amount lost its sign or its formatting");
  });

  test("a date column does not become the day before on the way out", async () => {
    stubDb({
      evidenceRows: [{
        id: "e1", bank_account_id: ACC, posted_on: new Date(2026, 6, 12),
        merchant_name: "NETFLIX.COM", amount_cents: "-1599",
        provider_transaction_id: "px-1", is_pending: false
      }]
    });
    const res = await call(bills, { query: { bill_id: BILL } });
    // A `date` decodes to LOCAL midnight; JSON.stringify would render that as
    // "2026-07-12T00:00:00.000Z" — and east of Greenwich as 2026-07-11.
    assert.equal(res.body.evidence[0].posted_on, "2026-07-12");
    assert.equal(res.body.bill.next_expected_on, "2026-08-12");
    assert.equal(res.body.bill.last_seen_on, "2026-07-12");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 3. A candidate is not a bill.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills — a low-confidence guess never arrives as a bill", () => {

  const MIXED = [
    BILL_ROW(),
    BILL_ROW({ id: "c2", merchant_key: "gym", merchant_display: "CITY GYM",
               confidence_label: "low", confidence_pct: 41,
               next_expected_on: null,
               next_expected_unknown_reason: "confidence_too_low_to_predict_a_date" })
  ];

  test("by default the candidate is counted but not sent", async () => {
    stubDb({ billRows: MIXED });
    const res = await call(bills, { query: { client_id: CID } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.bills.length, 1);
    assert.equal(res.body.bills[0].merchant_key, "netflix");
    assert.deepEqual(res.body.candidates, [],
      "a low-confidence guess was handed over without anybody asking for it");
    assert.equal(res.body.candidates_included, false);
    assert.equal(res.body.candidate_count, 1,
      "the count is not honest, so a screen cannot say what it is not showing");
  });

  test("asking by name gets them, still in their own list", async () => {
    stubDb({ billRows: MIXED });
    const res = await call(bills, { query: { client_id: CID, include_candidates: "1" } });
    assert.equal(res.body.bills.length, 1);
    assert.equal(res.body.candidates.length, 1);
    assert.equal(res.body.candidates[0].confidence_label, "low");
    assert.ok(!res.body.bills.some((b) => b.confidence_label === "low"),
      "a candidate leaked into `bills` — the two lists have been merged");
  });

  test("an empty include_candidates does not silently widen what is drawn", async () => {
    stubDb({ billRows: MIXED });
    const res = await call(bills, { query: { client_id: CID, include_candidates: "" } });
    assert.equal(res.body.candidates_included, false);
    assert.deepEqual(res.body.candidates, []);
  });

  test("the reason a bill has no next date survives to the caller", async () => {
    stubDb({ billRows: MIXED });
    const res = await call(bills, { query: { client_id: CID, include_candidates: "1" } });
    const guess = res.body.candidates[0];
    assert.equal(guess.next_expected_on, null, "a date was invented for a guess");
    assert.equal(guess.next_expected_unknown_reason, "confidence_too_low_to_predict_a_date");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 4. Empty is two different findings.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills — 'no history' and 'no pattern' are different answers", () => {

  test("no accounts: redetect refuses and says which, rather than reporting zero bills", async () => {
    stubDb({ accountRows: [] });
    const res = await call(bills, { method: "POST", body: { action: "redetect", client_id: CID } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ran, false);
    assert.equal(res.body.reason, "no_bank_accounts");
    assert.match(res.body.message, /no bank accounts/i);
  });

  test("accounts but no transactions: still a refusal, with its own reason", async () => {
    stubDb({ txRows: [] });
    const res = await call(bills, { method: "POST", body: { action: "redetect", client_id: CID } });
    assert.equal(res.body.ran, false);
    assert.equal(res.body.reason, "no_transactions");
  });

  test("the list read reports how many charges exist, so empty can be explained", async () => {
    stubDb({ billRows: [], txCount: "412" });
    const res = await call(bills, { query: { client_id: CID } });
    assert.deepEqual(res.body.bills, []);
    assert.equal(res.body.transaction_count, 412,
      "without this a screen cannot tell 'nothing entered' from 'nothing repeating'");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 5. Detection actually runs, over rows scoped through the ACCOUNT.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("bills — redetect", () => {

  /* A real monthly subscription, six charges, in the columns 085 defines. */
  const SIX_MONTHS = [0, 1, 2, 3, 4, 5].map((k) => ({
    id: `tx-${k}`,
    bank_account_id: ACC,
    client_id: CID,
    provider_transaction_id: `px-${k}`,
    amount_cents: "-1599",
    posted_on: new Date(2026, 1 + k, 12),
    merchant_name: "NETFLIX.COM",
    is_pending: false
  }));

  test("the transaction read is scoped through bank_accounts.client_id, not the nullable column", async () => {
    const q = stubDb({ txRows: SIX_MONTHS });
    await call(bills, { method: "POST", body: { action: "redetect", client_id: CID } });
    const read = q.find((x) => /FROM bank_transactions/i.test(x.sql));
    assert.ok(read, "no transaction read was issued");
    assert.match(read.sql, /JOIN bank_accounts a ON a\.id = t\.bank_account_id AND a\.org_id = t\.org_id/);
    assert.match(read.sql, /AND a\.client_id = \$2/,
      "the read filters on bank_transactions.client_id, which is NULLABLE — every " +
      "unattributed charge would be dropped and the client would look cheaper than they are");
    assert.match(read.sql, /COALESCE\(t\.client_id, a\.client_id\)/,
      "a bill stored with a NULL client is a bill no client-scoped read ever returns");
  });

  test("it detects the subscription and reports what it stored", async () => {
    const q = stubDb({ txRows: SIX_MONTHS });
    const res = await call(bills, { method: "POST", body: { action: "redetect", client_id: CID } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.ran, true);
    assert.equal(res.body.transactions_read, 6);
    assert.ok(res.body.bills + res.body.candidates >= 1, "nothing was detected from six monthly charges");
    assert.ok(typeof res.body.detected_as_of === "string",
      "`detected_as_of` is the instant the detector was given and has to be reported");
    assert.deepEqual(q.tx, ["BEGIN", "COMMIT"],
      "the bill and its evidence did not land in one transaction — a half-written " +
      "detection asserts a payment with nothing behind it");
    const insert = q.find((x) => /INSERT INTO recurring_bills/i.test(x.sql));
    assert.ok(insert, "nothing was written");
    assert.ok(insert.params.includes(ORG_A),
      "the stored bill did not carry the caller's org — toBillRow takes orgId as a " +
      "parameter and never reads it off a transaction row, so this is the only place " +
      "tenancy can be asserted on the write");
    assert.ok(insert.params.includes(CID),
      "the stored bill has no client — a bill with a NULL client_id is a bill no " +
      "client-scoped read will ever return");
    // The statement texts the claims above rest on: what is read, the newest first cap, and the evidence link.
    assertSqlHas(sqlOf(q, /FROM bank_transactions t/), {
      "only this client's accounts, in this company, one account if asked": "WHERE t.org_id = $1 AND a.client_id = $2 AND ($3::uuid IS NULL OR t.bank_account_id = $3)",
      "newest first": "ORDER BY t.posted_on DESC NULLS LAST, t.id ASC LIMIT $4"
    });
    assertSqlHas(sqlOf(q, /DELETE FROM recurring_bill_transactions/), { "the old evidence of that bill only": "WHERE recurring_bill_id = $1" });
    assertSqlHas(sqlOf(q, /INSERT INTO recurring_bill_transactions/), { "a link that already exists is absorbed": "ON CONFLICT DO NOTHING" });
  });

  test("an account belonging to another client cannot be aimed at", async () => {
    stubDb({});
    const res = await call(bills, {
      method: "POST",
      body: { action: "redetect", client_id: CID, bank_account_id: OTHER_LIA }
    });
    assert.equal(res.statusCode, 403);
  });

  test("an unknown action is a 400, not a silent success", async () => {
    stubDb({});
    const res = await call(bills, { method: "POST", body: { action: "sync", client_id: CID } });
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.error, "invalid_action");
  });

  test("DELETE is a 405 that says what is allowed", async () => {
    stubDb({});
    const res = await call(bills, { method: "DELETE" });
    assert.equal(res.statusCode, 405);
    assert.equal(res.headers.allow, "GET, POST");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 6. The projection.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("cashflow — the projection", () => {

  test("horizon_days is required and the refusal says the range", async () => {
    stubDb({});
    const res = await call(cashflow, { query: { client_id: CID } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /horizon_days is required/);
  });

  test("a horizon past the transport limit is refused rather than truncated", async () => {
    stubDb({});
    const res = await call(cashflow, { query: { client_id: CID, horizon_days: "4000" } });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /between 1 and 365/);
  });

  test("a stored bill reaches the projection — the snake_case / camelCase crossing", async () => {
    /* THIS IS THE SILENT ONE. Handing raw database rows to the seam throws
       nothing: every id renders as `undefined:undefined:monthly`, every
       confidence is NaN, and the client comes back with NO BILLS AT ALL, which
       a screen renders as "you are fine". The bill below is spelled in real
       column names, including `next_expected_on` — the field the mapper
       RENAMES — and it has to arrive in the projection. */
    stubDb({});
    const res = await call(cashflow, { query: { client_id: CID, horizon_days: "60" } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.bills_projected, 1,
      "the stored bill did not survive the crossing into the projector — this is the " +
      "failure that reads as 'this client has no bills'");
    assert.equal(res.body.projection.ok, true);
    const named = JSON.stringify(res.body.projection).includes("NETFLIX.COM");
    assert.ok(named, "the bill is in the projection but carries no label");
  });

  test("a timestamptz balance date does not refuse the projection it was meant to date", async () => {
    /* A REAL DEFECT, FOUND BY src/http/bills-cashflow-endpoints.pg.test.mjs AND
       MISSED HERE. `bank_accounts.balance_as_of` is a timestamptz and
       node-postgres hands it over as a Date OBJECT. The first version of the
       handler did `String(value).slice(0, 10)`, which is the HUMAN-READABLE form
       — "Fri Jul 31" — so project() refused the whole projection with
       "balances[0].asOf is not an ISO date" and a client with a perfectly good
       balance got nothing at all.

       This fixture is the Date the driver actually produces, so the unit test can
       no longer sail past it on a tidy string. */
    stubDb({ accountRows: [ACCOUNT_ROW({ balance_as_of: new Date("2026-07-30T09:15:00.000Z") })] });
    const res = await call(cashflow, { query: { client_id: CID, horizon_days: "30" } });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.equal(res.body.projection.ok, true,
      "a Date in balance_as_of refused the projection: " + JSON.stringify(res.body.projection.reason));
    assert.equal(res.body.accounts_used[0].asOf, "2026-07-30");
  });

  test("an unknown balance refuses the whole projection instead of being read as zero", async () => {
    stubDb({ accountRows: [ACCOUNT_ROW({ balance_cents: null })] });
    const res = await call(cashflow, { query: { client_id: CID, horizon_days: "30" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.projection.ok, false,
      "a NULL balance was summed as nothing — the opening balance is now confidently too low");
    assert.match(JSON.stringify(res.body.projection.reason), /unknown/i);
  });

  test("a credit card is not counted as cash, and the exclusion is reported", async () => {
    stubDb({
      accountRows: [
        ACCOUNT_ROW(),
        ACCOUNT_ROW({ id: "acc-2", name: "Platinum Card", account_type: "credit", balance_cents: "-90000" })
      ]
    });
    const res = await call(cashflow, { query: { client_id: CID, horizon_days: "30" } });
    assert.equal(res.body.accounts_used.length, 1);
    assert.equal(res.body.accounts_excluded.length, 1);
    assert.match(res.body.accounts_excluded[0].reason, /credit account, not cash/);
  });

  test("an account whose type nobody recorded is left out and SAID SO", async () => {
    stubDb({ accountRows: [ACCOUNT_ROW({ account_type: null })] });
    const res = await call(cashflow, { query: { client_id: CID, horizon_days: "30" } });
    assert.equal(res.body.accounts_used.length, 0);
    assert.match(res.body.accounts_excluded[0].reason, /unclassified account is not cash/);
    assert.equal(res.body.projection.ok, false,
      "with no cash accounts the projection has to refuse, not project from nothing");
  });

  test("the projection's holes cross the wire — they are the answer, not diagnostics", async () => {
    stubDb({ cardRows: [CARD_ROW({ minimum_payment_cents: null })] });
    const res = await call(cashflow, { query: { client_id: CID, horizon_days: "60" } });
    const p = res.body.projection;
    assert.ok(Array.isArray(p.blindSpots) && p.blindSpots.length >= 1,
      "a card with a due date and no minimum payment produced no blind spot");
    assert.match(p.blindSpots[0].reason, /unknown amount is not zero/);
    for (const key of ["excluded", "unconfirmed", "thresholdGaps"]) {
      assert.ok(Array.isArray(p[key]), `${key} was dropped from the response`);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 7. The payment window.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("cashflow — the payment window", () => {

  test("the whole projection is handed over, so the card's own minimum is not double-counted", async () => {
    stubDb({});
    const res = await call(cashflow, {
      query: { client_id: CID, horizon_days: "60", card_liability_id: LIA }
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(res.body.window, "no window was produced for a card with a due date and a minimum");
    assert.equal(res.body.card_liability_id, LIA);
    if (res.body.window.ok) {
      assert.equal(res.body.window.floor_display, "0.00",
        "the floor has no formatted string, so a browser would have to divide cents by 100");
      assert.ok(res.body.window.amountCents === 3500,
        "the window tested an amount that is not this card's minimum");
    }
  });

  test("a card belonging to another client is refused, not quietly ignored", async () => {
    stubDb({});
    const res = await call(cashflow, {
      query: { client_id: CID, horizon_days: "60", card_liability_id: OTHER_LIA }
    });
    assert.equal(res.statusCode, 403);
  });

  test("a card with no due date produces a stated refusal, not a guessed date", async () => {
    stubDb({ cardRows: [CARD_ROW({ payment_due_date: null })] });
    const res = await call(cashflow, {
      query: { client_id: CID, horizon_days: "60", card_liability_id: LIA }
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.window.ok, false);
    assert.ok(res.body.window.reason.code === "MISSING_DUE_DATE" ||
              res.body.window.reason.code === "PROJECTION_HAS_BLIND_SPOTS",
      "expected a stated refusal, got " + JSON.stringify(res.body.window.reason));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 8. The thresholds — read, write, clear, sign off.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("cashflow — the three thresholds", () => {

  test("the settings read returns the values AND the gaps", async () => {
    stubDb({
      gapRows: [{ org_id: ORG_A, setting: "cashflow_settings.confidence_floor",
                  value: "0.550", status: "AWAITING SIGN-OFF", consequence: "cannot make a payment date unsafe" }]
    });
    const res = await call(cashflow, { query: { view: "settings" } });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.thresholds.settlementLeadDays, 3);
    assert.equal(res.body.min_buffer_display, "0.00");
    assert.equal(res.body.gaps.length, 1,
      "the values came back without the gaps — three confident figures with nothing " +
      "saying two of them are placeholders a migration picked");
  });

  test("an unset threshold is an ABSENT key, never a zero", async () => {
    stubDb({ settingsRows: [SETTINGS_ROW({ settlement_lead_days: null })] });
    const res = await call(cashflow, { query: { view: "settings" } });
    assert.ok(!("settlementLeadDays" in res.body.thresholds),
      "an unset lead time arrived as a number — the model will now answer confidently " +
      "and possibly wrongly instead of reporting a gap");
    assert.equal(res.body.set.settlement_lead_days, false);
  });

  test("saving a value writes it and CLEARS its signature", async () => {
    const q = stubDb({});
    const res = await call(cashflow, {
      method: "POST", body: { action: "save_settings", min_buffer_cents: 25000 }
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const write = q.find((x) => /INSERT INTO cashflow_settings/i.test(x.sql));
    assert.ok(write, "nothing was written");
    assert.match(write.sql, /ON CONFLICT \(org_id\) DO UPDATE/);
    assert.match(write.sql, /min_buffer_cents = EXCLUDED\.min_buffer_cents/);
    assert.match(write.sql, /min_buffer_signed_off_at = EXCLUDED\.min_buffer_signed_off_at/);
    assert.ok(write.params.includes(25000));
    // The signature columns are the last two pushed for this setting.
    assert.ok(write.params.includes(null),
      "the old signature survived a new value — somebody's approval is now attached " +
      "to a figure they never saw");
    assert.ok(!/settlement_lead_days = EXCLUDED/.test(write.sql),
      "saving the buffer also rewrote the settlement lead, which nobody asked to change");
  });

  test("clearing a value writes NULL, not zero", async () => {
    const q = stubDb({});
    const res = await call(cashflow, {
      method: "POST", body: { action: "save_settings", min_buffer_cents: "" }
    });
    assert.equal(res.statusCode, 200);
    const write = q.find((x) => /INSERT INTO cashflow_settings/i.test(x.sql));
    const idx = write.sql.match(/INSERT INTO cashflow_settings \(([^)]+)\)/)[1]
      .split(",").map((s) => s.trim()).indexOf("min_buffer_cents");
    assert.equal(write.params[idx], null,
      "an emptied threshold was written as a number — 'nobody has decided this' has " +
      "become 'somebody decided zero', permanently");
  });

  test("signing off is refused unless the value is in the same request", async () => {
    stubDb({});
    const res = await call(cashflow, {
      method: "POST", body: { action: "save_settings", confidence_floor: 0.55, sign_off: ["min_buffer_cents"] }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /send the value you are signing off/);
  });

  test("a cleared value cannot be signed off", async () => {
    stubDb({});
    const res = await call(cashflow, {
      method: "POST", body: { action: "save_settings", min_buffer_cents: null, sign_off: ["min_buffer_cents"] }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /cannot be signed off/);
  });

  test("signing off stamps a time and a person", async () => {
    const q = stubDb({});
    const res = await call(cashflow, {
      method: "POST",
      body: { action: "save_settings", settlement_lead_days: 3, sign_off: ["settlement_lead_days"] }
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.signed_off, ["settlement_lead_days"]);
    const write = q.find((x) => /INSERT INTO cashflow_settings/i.test(x.sql));
    assert.match(write.sql, /settlement_lead_signed_off_at = EXCLUDED\.settlement_lead_signed_off_at/,
      "the settlement lead's signature column is settlement_lead_signed_off_at, not " +
      "settlement_lead_days_signed_off_at — the names do not match the value column");
    assert.ok(write.params.includes("The Owner"), "nobody's name was recorded against the sign-off");
  });

  test("a percentage typed into the fraction field is refused with the reading spelled out", async () => {
    stubDb({});
    const res = await call(cashflow, {
      method: "POST", body: { action: "save_settings", confidence_floor: 80 }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /not a percentage/);
  });

  test("a misspelled sign_off name is refused rather than ignored", async () => {
    stubDb({});
    const res = await call(cashflow, {
      method: "POST", body: { action: "save_settings", min_buffer_cents: 0, sign_off: ["min_buffer"] }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /does not exist/);
  });

  test("a save that names nothing is refused, not written as an empty statement", async () => {
    const q = stubDb({});
    const res = await call(cashflow, { method: "POST", body: { action: "save_settings" } });
    assert.equal(res.statusCode, 400);
    assert.ok(!q.some((x) => /INSERT INTO cashflow_settings/i.test(x.sql)));
  });

  test("a fractional cent count is refused — it means somebody stored dollars", async () => {
    stubDb({});
    const res = await call(cashflow, {
      method: "POST", body: { action: "save_settings", min_buffer_cents: "12.34" }
    });
    assert.equal(res.statusCode, 400);
    assert.match(res.body.error, /whole number of cents/);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 9. Reminders — computed on read, written only on request, cleared by a person.
 * ══════════════════════════════════════════════════════════════════════════ */

describe("cashflow — reminders", () => {

  test("reading a client computes reminders and writes NOTHING", async () => {
    const q = stubDb({ cardRows: [CARD_ROW({ minimum_payment_cents: null })] });
    const res = await call(cashflow, { query: { client_id: CID, horizon_days: "60" } });
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.reminder_candidates));
    assert.ok(res.body.reminder_candidates.length >= 1,
      "a card with no minimum payment justifies an input_missing reminder and produced none");
    assert.ok(!q.some((x) => /INSERT INTO cashflow_reminders/i.test(x.sql)),
      "opening a screen wrote reminder rows — a list that grows every time somebody " +
      "looks at a client is a list people stop reading");
  });

  test("saving recomputes rather than trusting rows posted back by the browser", async () => {
    const q = stubDb({ cardRows: [CARD_ROW({ minimum_payment_cents: null })] });
    const res = await call(cashflow, {
      method: "POST",
      body: {
        action: "save_reminders", client_id: CID, horizon_days: 60,
        // A caller trying to write their own wording. It must not appear.
        reminders: [{ body: "YOU OWE US MONEY", subjectLabel: "made up" }]
      }
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const writes = q.filter((x) => /INSERT INTO cashflow_reminders/i.test(x.sql));
    assert.ok(writes.length >= 1, "nothing was written");
    assert.ok(!writes.some((w) => (w.params ?? []).some((p) => String(p).includes("YOU OWE US MONEY"))),
      "a reminder body supplied by the caller was stored under this system's name");
    assert.ok(writes.every((w) => (w.params ?? []).includes(ORG_A)));
  });

  test("acknowledging records who did it, and reading never does", async () => {
    const ACK = {
      id: "ffffffff-1111-4111-8111-ffffffffffff", org_id: ORG_A, client_id: CID,
      subject_kind: "card_liability", subject_id: LIA, subject_label: "Amex Blue Business",
      reminder_kind: "input_missing", body: "…", surface_at: "2026-07-31T00:00:00.000Z",
      acknowledged_at: "2026-07-31T10:00:00.000Z", acknowledged_by_kind: "staff",
      acknowledged_by_id: "staff-1"
    };
    const q = stubDb({ reminderRows: [ACK] });
    const res = await call(cashflow, {
      method: "POST",
      body: { action: "acknowledge_reminder", reminder_id: "ffffffff-1111-4111-8111-ffffffffffff" }
    });
    assert.equal(res.statusCode, 200, JSON.stringify(res.body));
    const update = q.find((x) => /UPDATE cashflow_reminders/i.test(x.sql));
    assert.ok(update, "nothing was acknowledged");
    assert.ok(update.params.includes(ORG_A), "the acknowledge was not org-scoped");
    assert.ok(update.params.includes("staff-1"), "nobody was recorded as having cleared it");
  });

  test("a reminder id that is not a uuid is a 400, not a 500", async () => {
    stubDb({});
    const res = await call(cashflow, {
      method: "POST", body: { action: "acknowledge_reminder", reminder_id: "zzz" }
    });
    assert.equal(res.statusCode, 400);
  });
});

describe("the statements behind the reads say what the rows are about", () => {

  test("cashflow GET: this client's accounts, the card bills inside this company, the due reminders still open", async () => {
    const q = stubDb({});
    await call(cashflow, { query: { client_id: CID, horizon_days: "30" } });
    assertSqlHas(sqlOf(q, /FROM bank_accounts/), { "this client's accounts, oldest first": "WHERE org_id = $1 AND client_id = $2 ORDER BY created_at ASC" });
    assertSqlHas(sqlOf(q, /FROM card_liabilities/), {
      "the card's own tradeline in this company": "JOIN tradelines t ON t.id = l.tradeline_id AND t.org_id = l.org_id",
      "this client, newest statement per card": "WHERE l.org_id = $1 AND l.client_id = $2 ORDER BY l.tradeline_id, l.as_of DESC, l.created_at DESC"
    });
    assertSqlHas(sqlOf(q, /FROM recurring_bills/), {
      "this company, optional account and client filters, confident bills": "WHERE org_id = $1 AND ($2::uuid IS NULL OR bank_account_id = $2) AND ($3::uuid IS NULL OR client_id = $3) AND ($4 = false OR confidence_label IN ('medium', 'high'))",
      "smallest first": "ORDER BY typical_amount_cents ASC, merchant_key ASC"
    });
    assertSqlHas(sqlOf(q, /FROM cashflow_reminders/), {
      "due, not acknowledged, this company and client, soonest first": "WHERE org_id = $1 AND surface_at <= $2 AND acknowledged_at IS NULL AND client_id = $4 ORDER BY surface_at ASC, created_at ASC LIMIT $3"
    });
    assertSqlHas(sqlOf(q, /FROM cashflow_settings/), { "this company's thresholds": "WHERE org_id = $1" });
  });

  test("bills GET: this client's bills and accounts, and the count of the transactions the detector read", async () => {
    const q = stubDb({});
    await call(bills, { query: { client_id: CID } });
    assertSqlHas(sqlOf(q, /FROM bank_accounts/), { "this client's accounts, open ones first": "WHERE org_id = $1 AND client_id = $2 ORDER BY closed_at NULLS FIRST, created_at ASC" });
    assertSqlHas(sqlOf(q, /count\(\*\)::bigint AS n FROM bank_transactions/), {
      "only this client's accounts, in this company": "JOIN bank_accounts a ON a.id = t.bank_account_id AND a.org_id = t.org_id WHERE t.org_id = $1 AND a.client_id = $2"
    });
  });
});
