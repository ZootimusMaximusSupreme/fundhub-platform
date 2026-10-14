/* /api/finance/liabilities, driven end to end against a stubbed database.
 *
 * WHY IT LIVES HERE AND NOT NEXT TO THE HANDLER. package.json's test glob walks
 * src/ and scripts/ ONLY (CLAUDE.md, traps). A test placed under api/ is never
 * run by anything and reports nothing, forever. So the test sits in src/http/
 * and imports the api/ handler, which is the convention the rest of this
 * directory follows.
 *
 * WHY IT RUNS WITHOUT POSTGRES. src/db.mjs exports `db` as a plain object with
 * one `query` method, so both the session lookup and the endpoint's own reads
 * can be stubbed and the handler runs exactly as it does in production. Same
 * approach as src/http/finance-os-endpoints.test.mjs, and for the same reason:
 * THE TENANCY BUG THIS GUARDS IS INVISIBLE ON A ONE-ORG DATABASE, and every
 * database this repo has is a one-org database.
 *
 * WHAT IS DELIBERATELY NOT COVERED HERE: the `upsert` write path's happy case.
 * recordLiability() reaches past the shared handle for the real pool
 * (src/liabilities/store.mjs:134) so its three writes land in one transaction,
 * which means a stubbed `db.query` cannot observe it — by design, and the design
 * is right. That path is proved against real Postgres in
 * finance-liabilities.pg.test.mjs. Everything BEFORE the store call — the role
 * gate, both tenancy checks and every field parser — is proved here, because
 * every one of those refusals happens before a single write is attempted.
 *
 * THE THREE THINGS THIS FILE EXISTS TO STOP:
 *   1. A cross-tenant read. src/liabilities/store.mjs's readers take an id and
 *      filter on NOTHING else; the checks in the handler are the only org
 *      filter, so the tests assert on the SQL PARAMETERS actually bound.
 *   2. An unknown becoming a zero. A blank limit is unknown, not $0.
 *   3. An APR off by a hundred (audit m4). "24.99" must reach the column as
 *      0.2499, and the genuinely ambiguous "0.5" must be refused, not guessed.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";

import { db } from "../db.mjs";
import handler from "../../api/finance/liabilities.mjs";
import { ROLE_SETS } from "./read-api.mjs";
import { assertBind, assertSqlHas } from "../testing/s3-scoped-rows.mjs";

/* Two orgs, deliberately. The caller belongs to ORG_A; ORG_B's ids are what a
   malicious or mistaken caller pastes in. On a single-org database these are the
   same value and the bug is unobservable, which is exactly why it survives. */
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "99999999-9999-4999-8999-999999999999";
const CLIENT = "f3263bdb-45da-4056-8d6c-7c999d944fee";
const OTHER_CLIENT = "22222222-2222-4222-8222-222222222222";
const CARD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_CARD = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const TRADELINE = {
  id: CARD, org_id: ORG_A, client_id: CLIENT, lender: "Chase Ink", kind: "revolving",
  last4: "4417", credit_limit_cents: "1000000", balance_cents: "250000", apr: "0.18990",
  opened_on: "2019-04-02", closed_at: null, as_of: "2026-07-01", source: "manual"
};

const POSITION = {
  id: "pppppppp-pppp-4ppp-8ppp-pppppppppppp", tradeline_id: CARD, client_id: CLIENT, org_id: ORG_A,
  as_of: "2026-07-15", current_balance_cents: "300000", statement_balance_cents: "295000",
  minimum_payment_cents: "9000", past_due_cents: "0", last_payment_cents: null,
  last_payment_date: null, statement_date: "2026-07-10", payment_due_date: "2026-08-04",
  apr: null, payment_status: "current", source: "manual", raw: {}
};

let savedQuery = null;
beforeEach(() => { savedQuery = db.query; });
afterEach(() => { db.query = savedQuery; });

const makeRes = () => ({
  statusCode: 0,
  body: null,
  headers: {},
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
  status(code) { this.statusCode = code; return this; },
  json(payload) { this.body = payload; return this; }
});

/**
 * call(opts) — run the real handler against a stubbed database.
 *
 * Every query the handler issues is recorded with its SQL and its bound
 * parameters, because "which rows was this allowed to reach" is a question only
 * the parameters can answer. The session lookup is the fallback branch, exactly
 * as in finance-os-endpoints.test.mjs.
 */
async function call({
  role = "owner",
  orgId = ORG_A,
  method = "GET",
  query = {},
  body = undefined,
  authenticated = true,
  owns = true,              // does the named client belong to the caller's org
  cardRow = TRADELINE,      // what loadTradeline() finds, or null for "not ours"
  cards = [TRADELINE],      // what listTradelines() returns
  positions = [POSITION],
  history = [POSITION],
  counts = [{ tradeline_id: CARD, n: 3 }],
  inserted = null,
  updated = null,
  readError = null
} = {}) {
  const reads = [];
  db.query = async (sql, params) => {
    assertBind(sql, params);
    const s = String(sql);
    const record = (kind) => { reads.push({ kind, sql: s, params }); };

    if (/FROM\s+clients\s+WHERE\s+id/i.test(s)) {
      record("ownsClient");
      if (readError) throw readError;
      return { rows: owns ? [{ "?column?": 1 }] : [] };
    }
    if (/FROM\s+tradelines\s+t\s+JOIN\s+clients/i.test(s)) {
      record("loadTradeline");
      if (readError) throw readError;
      return { rows: cardRow ? [cardRow] : [] };
    }
    if (/INSERT\s+INTO\s+tradelines/i.test(s)) {
      record("insertTradeline");
      if (readError) throw readError;
      return { rows: [inserted || { ...TRADELINE }] };
    }
    if (/UPDATE\s+tradelines/i.test(s)) {
      record("updateTradeline");
      if (readError) throw readError;
      return { rows: updated === null ? [{ ...TRADELINE }] : (updated ? [updated] : []) };
    }
    if (/FROM\s+tradelines/i.test(s)) {
      record("listTradelines");
      if (readError) throw readError;
      return { rows: cards };
    }
    if (/FROM\s+card_liability_history/i.test(s)) {
      record(/GROUP\s+BY/i.test(s) ? "observationCounts" : "history");
      if (readError) throw readError;
      return { rows: /GROUP\s+BY/i.test(s) ? counts : history };
    }
    if (/FROM\s+card_liabilities/i.test(s)) {
      record("positions");
      if (readError) throw readError;
      return { rows: positions };
    }
    // verifySession's CTE. One live session for a staff member with this role.
    if (!authenticated) return { rows: [] };
    return {
      rows: [{
        session_id: "sess-1",
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
        staff_id: "staff-1",
        org_id: orgId,
        role,
        email: `${role}@fundhub.ai`,
        name: role,
        status: "active",
        active_flag: "true"
      }]
    };
  };

  const res = makeRes();
  const req = { method, headers: { authorization: "Bearer session-token" }, query, body };
  const thrown = await handler(req, res).then(() => null, (e) => e);
  return { status: res.statusCode, body: res.body, headers: res.headers, reads, thrown };
}

const post = (body, opts = {}) => call({ method: "POST", body, ...opts });

/* ── the gate ──────────────────────────────────────────────────────────────── */

describe("who may reach this endpoint at all", () => {

  test("no session is a 401 and reads nothing", async () => {
    const r = await call({ authenticated: false, query: { client_id: CLIENT } });
    assert.equal(r.status, 401);
    assert.deepEqual(r.reads, []);
  });

  for (const role of [...ROLE_SETS.STAFF]) {
    test(`a ${role} may read the stack`, async () => {
      const r = await call({ role, query: { client_id: CLIENT } });
      assert.equal(r.status, 200, `${role} is in ROLE_SETS.STAFF and was refused`);
    });
  }

  for (const role of ["partner", "client", "", null]) {
    test(`a session whose role is ${JSON.stringify(role)} is refused and reads nothing`, async () => {
      const r = await call({ role, query: { client_id: CLIENT } });
      assert.equal(r.status, 403, "the gate is deny-by-default");
      assert.deepEqual(r.reads, []);
    });
  }

  test("a session with NO org binds nothing and matches nothing — it fails CLOSED", async () => {
    const r = await call({ orgId: null, query: { client_id: CLIENT } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "org_required");
    assert.deepEqual(r.reads, [], "an org-less session reached the database");
  });

  test("a DELETE is a 405 with an allow header, before any database work", async () => {
    const r = await call({ method: "DELETE" });
    assert.equal(r.status, 405);
    assert.equal(r.headers.allow, "GET, POST");
    assert.deepEqual(r.reads, []);
  });
});

/* ── tenancy: the store will not do this, so the handler must ──────────────── */

describe("org scoping — an id is not an authorisation", () => {

  test("the client check binds the SESSION's org, never the query string's", async () => {
    const r = await call({ query: { client_id: CLIENT, org_id: ORG_B } });
    assert.equal(r.status, 200);
    const check = r.reads.find((x) => x.kind === "ownsClient");
    assert.ok(check.params.includes(ORG_A), "the ownership check did not carry the session's org");
    assert.ok(!check.params.includes(ORG_B), "an org id from the query string reached the database");
  });

  test("a client in another org is a 403 and no balance is read", async () => {
    const r = await call({ query: { client_id: OTHER_CLIENT }, owns: false });
    assert.equal(r.status, 403);
    assert.deepEqual(r.reads.map((x) => x.kind), ["ownsClient"],
      "the ownership check failed and the liabilities were read anyway");
  });

  test("a card in another org is a 403 and its series is not read", async () => {
    const r = await call({ query: { tradeline_id: OTHER_CARD }, cardRow: null });
    assert.equal(r.status, 403);
    assert.deepEqual(r.reads.map((x) => x.kind), ["loadTradeline"]);
  });

  test("the card list is read through the org-scoped store, with the session's org bound", async () => {
    const r = await call({ query: { client_id: CLIENT } });
    const list = r.reads.find((x) => x.kind === "listTradelines");
    assert.ok(list.params.includes(ORG_A), "listTradelines ran without the caller's org");
  });

  test("a position whose card is NOT in the org-scoped list is DROPPED, not rendered", async () => {
    /* getCurrentLiabilities() matches on client_id alone. This is the second
       guard: a row it returns for a card the org-scoped list does not contain
       must not reach the screen. */
    const r = await call({
      query: { client_id: CLIENT },
      cards: [TRADELINE],
      positions: [POSITION, { ...POSITION, id: "x", tradeline_id: OTHER_CARD, current_balance_cents: "99999999" }]
    });
    assert.equal(r.status, 200);
    assert.equal(r.body.cards.length, 1);
    const balances = JSON.stringify(r.body);
    assert.ok(!balances.includes("999999"), "a balance for a card outside the org-scoped list reached the response");
  });

  test("the observation count is scoped by org AND client", async () => {
    const r = await call({ query: { client_id: CLIENT } });
    const counted = r.reads.find((x) => x.kind === "observationCounts");
    assert.deepEqual(counted.params, [ORG_A, CLIENT]);
  });

  test("a POST may not name its own org", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, org_id: ORG_B, lender: "X" });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "org_id_not_accepted");
    assert.deepEqual(r.reads, []);
  });

  test("a POST naming a card that belongs to ANOTHER client of the same org is refused", async () => {
    /* Both ids are attacker-supplied. Checking only that the card is "ours"
       would write one row naming two different consumers. */
    const r = await post({
      action: "upsert", client_id: CLIENT, tradeline_id: CARD, as_of: "2026-07-31", current_balance: "10"
    }, { cardRow: { ...TRADELINE, client_id: OTHER_CLIENT } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, "tradeline_belongs_to_another_client");
  });
});

/* ── GET: the stack ────────────────────────────────────────────────────────── */

describe("GET ?client_id — the stack", () => {

  test("a missing client_id is a 400, not a firehose of everybody's balances", async () => {
    const r = await call({ query: {} });
    assert.equal(r.status, 400);
    assert.deepEqual(r.reads, []);
  });

  test("a malformed client_id is a 400 before the query, not a 500 after it", async () => {
    const r = await call({ query: { client_id: "not-a-uuid" } });
    assert.equal(r.status, 400);
    assert.deepEqual(r.reads, [], "a bad uuid must not reach Postgres");
  });

  test("the response names both of its sources", async () => {
    const r = await call({ query: { client_id: CLIENT } });
    assert.equal(r.body.source, "card_liabilities+tradelines");
  });

  test("a client with no cards answers honestly instead of inventing rows", async () => {
    const r = await call({ query: { client_id: CLIENT }, cards: [], positions: [], counts: [] });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.cards, []);
    assert.equal(r.body.totals.find((t) => t.key === "credit_limit").display, null,
      "a client with no cards was given a total of $0.00");
  });

  test("the dated position leads the row and the disagreement is reported", async () => {
    const r = await call({ query: { client_id: CLIENT } });
    const c = r.body.cards[0];
    assert.equal(c.balance, "3000.00");
    assert.equal(c.balance_source, "card_liabilities");
    assert.equal(c.disagreement.tradelines, "2500.00");
    assert.equal(r.body.disagreements, 1);
  });

  test("closed cards are excluded unless asked for, and the flag is echoed", async () => {
    const r = await call({ query: { client_id: CLIENT } });
    const list = r.reads.find((x) => x.kind === "listTradelines");
    assert.equal(list.params[2], false, "closed cards were included in the default read");
    assert.equal(r.body.include_closed, false);

    const r2 = await call({ query: { client_id: CLIENT, include_closed: "1" } });
    assert.equal(r2.reads.find((x) => x.kind === "listTradelines").params[2], true);
    assert.equal(r2.body.include_closed, true);
  });

  test("a bad parameter Postgres rejects comes back as 400, not 500", async () => {
    const e = new Error("invalid input syntax for type uuid");
    e.code = "22P02";
    const r = await call({ query: { client_id: CLIENT }, readError: e });
    assert.equal(r.status, 400);
  });

  test("a real database fault is not disguised as the caller's mistake", async () => {
    const e = new Error('relation "card_liabilities" does not exist');
    e.code = "42P01";
    const r = await call({ query: { client_id: CLIENT }, readError: e });
    assert.ok(r.thrown, "a server fault was swallowed and answered as a 400");
    assert.equal(r.thrown.code, "42P01");
  });
});

/* ── GET: one card's series ────────────────────────────────────────────────── */

describe("GET ?tradeline_id — the series", () => {

  test("the series comes back newest first with the card alongside it", async () => {
    const r = await call({ query: { tradeline_id: CARD } });
    assert.equal(r.status, 200);
    assert.equal(r.body.source, "card_liability_history");
    assert.equal(r.body.card.lender, "Chase Ink");
    assert.equal(r.body.observations[0].current_balance, "3000.00");
  });

  test("a card with NO observations is not a card with a zero balance", async () => {
    const r = await call({ query: { tradeline_id: CARD }, history: [] });
    assert.equal(r.status, 200);
    assert.equal(r.body.count, 0);
    assert.deepEqual(r.body.observations, []);
    assert.equal(r.body.current, null,
      "an empty series produced a current position out of nowhere");
  });

  test("?limit=-1 is clamped instead of reaching Postgres as a negative LIMIT", async () => {
    const r = await call({ query: { tradeline_id: CARD, limit: "-1" } });
    assert.equal(r.status, 200);
    assert.equal(r.body.limit, 1);
    const read = r.reads.find((x) => x.kind === "history");
    assert.ok(read.params.every((p) => Number(p) !== -1 || typeof p === "string"),
      "a negative limit was bound");
  });

  test("hasMore is answered without a second COUNT", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ...POSITION, id: `p${i}`, as_of: "2026-07-15" }));
    const r = await call({ query: { tradeline_id: CARD }, history: many });
    assert.equal(r.body.limit, 24);
    assert.equal(r.body.count, 24);
    assert.equal(r.body.hasMore, true);
    assert.deepEqual(r.reads.filter((x) => x.kind === "history").length, 1);
  });

  test("the unparsed bureau record is not on the wire", async () => {
    const r = await call({ query: { tradeline_id: CARD } });
    assert.equal(r.body.observations[0].raw, undefined);
  });
});

/* ── POST: adding and editing a card ───────────────────────────────────────── */

describe("POST add_card — cards are entered by hand, and that is the product", () => {

  test("a card is written with the caller's org, the named client and source=manual", async () => {
    const r = await post({
      action: "add_card", client_id: CLIENT, lender: "Chase Ink", last4: "4417",
      credit_limit: "10000", balance: "2500", apr: "18.99", opened_on: "2019-04-02"
    });
    assert.equal(r.status, 200);
    const w = r.reads.find((x) => x.kind === "insertTradeline");
    assert.equal(w.params[0], ORG_A);
    assert.equal(w.params[1], CLIENT);
    assert.ok(/'manual'/.test(w.sql), "a hand-typed card was not tagged as hand-typed");
  });

  test("dollars are converted to integer cents exactly once", async () => {
    const r = await post({
      action: "add_card", client_id: CLIENT, lender: "X", credit_limit: "$10,000.00", balance: "2500.55"
    });
    const w = r.reads.find((x) => x.kind === "insertTradeline");
    assert.equal(w.params[5], 1000000, "the credit limit did not reach the column as cents");
    assert.equal(w.params[6], 250055);
  });

  test("A PERCENTAGE REACHES THE COLUMN AS A FRACTION (audit m4)", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "X", apr: "24.99" });
    const w = r.reads.find((x) => x.kind === "insertTradeline");
    assert.equal(w.params[7], 0.2499,
      "24.99 was stored as written — every dollar figure derived from it is now 100x too big");
  });

  test('an ambiguous rate is REFUSED, not guessed — "0.5" could be 0.5% or 50%', async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "X", apr: "0.5" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /enter the percentage/);
    assert.ok(!r.reads.some((x) => x.kind === "insertTradeline"), "the ambiguous rate was written anyway");
  });

  test("0% is accepted — an intro rate reads the same way under both meanings", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "X", apr: "0" });
    assert.equal(r.status, 200);
    assert.equal(r.reads.find((x) => x.kind === "insertTradeline").params[7], 0);
  });

  test("a rate above 100% is refused rather than clamped to something plausible", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "X", apr: "250" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /between 0% and 100%/);
  });

  test("A BLANK LIMIT IS UNKNOWN, NOT ZERO", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "X", credit_limit: "" });
    assert.equal(r.status, 200);
    assert.equal(r.reads.find((x) => x.kind === "insertTradeline").params[5], null,
      'an unreported limit was written as 0 — "we do not know" became "it is nothing"');
  });

  test("a typo is REFUSED, not silently stored as unknown", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "X", credit_limit: "ten grand" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /amount in dollars/);
    assert.ok(!r.reads.some((x) => x.kind === "insertTradeline"),
      "the row was written with the typed number thrown away and the field left unknown");
  });

  test("a full card number pasted into the last-4 box is refused outright", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "X", last4: "4111111111111111" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /four digits/);
    assert.ok(!r.reads.some((x) => x.kind === "insertTradeline"),
      "a card number reached a write; it must not be quietly trimmed either");
  });

  test("a card with no lender is refused — a card nobody can name is not a card", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "  " });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /lender is required/);
  });

  test("a kind outside the migration's CHECK is refused with a readable message", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "X", kind: "crypto" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /revolving/);
  });

  test("a date that is not a date is refused before Postgres sees it", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "X", opened_on: "2025-02-30" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /not a real date/);
  });

  test("add_card does not require a tradeline_id — there is no card yet", async () => {
    const r = await post({ action: "add_card", client_id: CLIENT, lender: "X" });
    assert.equal(r.status, 200);
    assert.ok(!r.reads.some((x) => x.kind === "loadTradeline"));
  });
});

describe("POST edit_card — omitted means leave alone, blank means we no longer know", () => {

  test("only the fields sent are written", async () => {
    const r = await post({ action: "edit_card", client_id: CLIENT, tradeline_id: CARD, lender: "Chase Ink Cash" });
    assert.equal(r.status, 200);
    const w = r.reads.find((x) => x.kind === "updateTradeline");
    assert.ok(/lender = \$1/.test(w.sql));
    assert.ok(!/credit_limit_cents/.test(w.sql), "a field nobody sent was overwritten");
  });

  test("A BLANK PUTS A FIELD BACK TO UNKNOWN — it does not put it to zero", async () => {
    const r = await post({ action: "edit_card", client_id: CLIENT, tradeline_id: CARD, credit_limit: "" });
    const w = r.reads.find((x) => x.kind === "updateTradeline");
    assert.ok(/credit_limit_cents = \$1/.test(w.sql));
    assert.equal(w.params[0], null,
      "a limit somebody no longer believes became $0, which is a claim rather than a retraction");
  });

  test("an edit is scoped by id AND org AND client in the WHERE clause", async () => {
    const r = await post({ action: "edit_card", client_id: CLIENT, tradeline_id: CARD, balance: "10" });
    const w = r.reads.find((x) => x.kind === "updateTradeline");
    assert.ok(w.params.includes(ORG_A) && w.params.includes(CLIENT) && w.params.includes(CARD));
  });

  test("an edit re-tags the row as hand-typed", async () => {
    const r = await post({ action: "edit_card", client_id: CLIENT, tradeline_id: CARD, balance: "10" });
    assert.ok(/source = 'manual'/.test(r.reads.find((x) => x.kind === "updateTradeline").sql),
      "a corrected row still claims to be a faithful copy of a bureau file");
  });

  test("an edit that changes nothing is refused instead of writing an empty UPDATE", async () => {
    const r = await post({ action: "edit_card", client_id: CLIENT, tradeline_id: CARD });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "nothing_to_change");
  });

  test("closing a card is an edit, not a delete", async () => {
    const r = await post({ action: "edit_card", client_id: CLIENT, tradeline_id: CARD, closed_on: "2026-07-31" });
    assert.equal(r.status, 200);
    const w = r.reads.find((x) => x.kind === "updateTradeline");
    assert.ok(/closed_at = \$1/.test(w.sql));
    assert.ok(!/DELETE/i.test(w.sql), "a card with observations behind it was deleted");
  });
});

/* ── POST: recording a position ────────────────────────────────────────────── */

describe("POST upsert — the refusals that happen before any write", () => {

  test("a position with no date is refused, because it cannot be placed in the series", async () => {
    const r = await post({ action: "upsert", client_id: CLIENT, tradeline_id: CARD, current_balance: "100" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /as_of is required/);
  });

  test("an unknown action is refused and nothing is written", async () => {
    const r = await post({ action: "wipe", client_id: CLIENT, tradeline_id: CARD });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, "invalid_action");
  });

  test("a payment status outside the migration's CHECK is refused with the list", async () => {
    const r = await post({
      action: "upsert", client_id: CLIENT, tradeline_id: CARD, as_of: "2026-07-31", payment_status: "fine"
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /charge_off/);
  });

  test("a negative balance is refused rather than raising a constraint violation", async () => {
    const r = await post({
      action: "upsert", client_id: CLIENT, tradeline_id: CARD, as_of: "2026-07-31", current_balance: "-50"
    });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /cannot be negative/);
  });

  test("a missing tradeline_id is a 400 before any lookup", async () => {
    const r = await post({ action: "upsert", client_id: CLIENT, as_of: "2026-07-31" });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /tradeline_id/);
  });
});

describe("the statements behind the reads", () => {
  const sqlOf = (reads, kind) => reads.find((r) => r.kind === kind).sql;

  test("the card stack: the client's company first, then their cards, the positions and the observation counts", async () => {
    const { reads } = await call({ query: { client_id: CLIENT } });
    assertSqlHas(sqlOf(reads, "ownsClient"), { "the client, in the caller's company": "WHERE id = $1 AND org_id = $2" });
    assertSqlHas(sqlOf(reads, "listTradelines"), {
      "this company, this client, open cards unless asked for closed": "WHERE org_id = $1 AND client_id = $2 AND ($3::boolean OR closed_at IS NULL)",
      "lowest rate first": "ORDER BY apr ASC NULLS LAST, lender ASC"
    });
    assertSqlHas(sqlOf(reads, "positions"), { "this client's positions, soonest due first": "WHERE client_id = $1 ORDER BY payment_due_date ASC NULLS LAST, as_of DESC" });
    assertSqlHas(sqlOf(reads, "observationCounts"), {
      "how many observations each card has": "SELECT tradeline_id, count(*)::int AS n FROM card_liability_history",
      "per card, this company and client": "WHERE org_id = $1 AND client_id = $2 GROUP BY tradeline_id"
    });
  });

  test("one card's history: the card is found through its client's company, newest observation first", async () => {
    const { reads } = await call({ query: { client_id: CLIENT, tradeline_id: CARD } });
    assertSqlHas(sqlOf(reads, "loadTradeline"), { "the card, only if its client is in this company": "JOIN clients c ON c.id = t.client_id WHERE t.id = $1 AND c.org_id = $2" });
    assertSqlHas(sqlOf(reads, "history"), { "this card, newest first": "WHERE tradeline_id = $1 ORDER BY as_of DESC, created_at DESC LIMIT $2" });
  });
});
