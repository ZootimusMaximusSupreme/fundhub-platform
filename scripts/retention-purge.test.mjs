// Unit tests for the retention purge runner. No database — these run everywhere,
// including with DATABASE_URL unset, and they are the tests that pin the safety
// properties.
//
// THE ONE THAT MATTERS MOST is "a dry run issues no write statement". It does not
// check a flag and it does not trust the runner's own report. It watches every
// piece of SQL the tool sends and fails if any of it is an UPDATE, DELETE,
// INSERT, TRUNCATE, DROP or ALTER. A dry run that quietly wrote would fail here
// even if every counter it printed said zero.
//
// This file lives under scripts/ because package.json's test glob is
// "src/**/*.test.mjs" and "scripts/**/*.test.mjs". A test outside those two trees
// is never collected and passes forever by never running (CLAUDE.md §12).

import { test, describe } from "node:test";
import assert from "node:assert";

import { parseArgs, plan, countOnlyPlan, apply, resolveActor, validateApplySession } from "./retention-purge.mjs";
import { CLASSES, MOCK_EVENT_KEY_PATTERNS, MOCK_CLIENT_EMAILS } from "../src/retention/classes.mjs";
import { DATA_CLASSES, loadPolicy, RetentionError } from "../src/retention/policy.mjs";

const ORG = "11111111-1111-1111-1111-111111111111";

/* Any statement that can change data. Deliberately broad — the question this
   regex answers is "did the tool write", and a dry run's answer must be no. */
const WRITE = /^\s*(UPDATE|DELETE|INSERT|TRUNCATE|DROP|ALTER|CREATE)\b/i;

/* A fake handle that records every query and answers by matching a fragment of
   the SQL. Insertion order matters: the first matching fragment wins, so the
   narrower patterns are listed first. */
function fakeDb(handlers = {}) {
  const queries = [];
  return {
    queries,
    writes: () => queries.filter((q) => WRITE.test(q.sql)),
    async query(sql, params) {
      queries.push({ sql, params });
      for (const [fragment, rows] of Object.entries(handlers)) {
        if (sql.includes(fragment)) {
          const value = typeof rows === "function" ? rows(sql, params) : rows;
          return Array.isArray(value) ? { rows: value, rowCount: value.length } : value;
        }
      }
      return { rows: [], rowCount: 0 };
    }
  };
}

/* A policy where every class HAS a retention period — the state in which the
   runner is at its most dangerous, and therefore the state a dry-run test has to
   use. A policy of all-NULLs would make "nothing was written" true for a reason
   that has nothing to do with dry run. */
const POLICY_ALL_SET = DATA_CLASSES.map((data_class) => ({
  data_class,
  retain_days: 30,
  action: CLASSES[data_class].action,
  signed_off_at: "2026-11-02T00:00:00Z",
  signed_off_by: null
}));

const COUNTS = {
  // Checked before "FROM crs_results" etc: the demo-client report selects FROM
  // clients and mentions the other three tables in its subqueries.
  "FROM clients c": [],
  "FROM v_retention_policy_gaps": [],
  "FROM retention_policy": POLICY_ALL_SET,
  "FROM crs_results": [{ n: "3" }],
  "FROM pii_access_log": [{ n: "2", clients_touched: "1" }],
  "FROM soft_pull_requests": [{ n: "4", unknown_cost: "4", known_cost_cents: null }],
  "FROM bank_transactions": [{ n: "5" }],
  "FROM events": [{ n: "1" }]
};

describe("dry run is the default, and it does not write", () => {
  test("*** A DRY RUN ISSUES NO WRITE STATEMENT AT ALL ***", async () => {
    const db = fakeDb(COUNTS);

    const result = await plan(db, { orgId: ORG });

    // It did real work — this is not passing because nothing ran.
    assert.ok(db.queries.length >= 7, `expected the plan to query, got ${db.queries.length} queries`);
    assert.equal(result.items.length, DATA_CLASSES.length);
    assert.ok(result.items.some((i) => i.expired > 0), "expected the plan to find expired rows");

    // And every single statement it sent was a read.
    assert.deepEqual(
      db.writes().map((q) => q.sql.trim().split("\n")[0]),
      [],
      "a dry run wrote to the database"
    );
  });

  test("counting expired rows never writes, class by class", async () => {
    for (const name of DATA_CLASSES) {
      const db = fakeDb(COUNTS);
      await CLASSES[name].count(db, { orgId: ORG, retainDays: 30 });
      assert.deepEqual(db.writes(), [], `${name}.count() wrote to the database`);
      assert.ok(db.queries.length > 0, `${name}.count() issued no query at all`);
    }
  });

  test("parseArgs defaults apply to false — the flag has to be typed", () => {
    assert.equal(parseArgs([]).apply, false);
    assert.equal(parseArgs(["--staff", "abc"]).apply, false);
    assert.deepEqual(parseArgs(["--session", "sensitive-token"]).unknown, ["--session"]);
    assert.equal(parseArgs(["--apply"]).apply, true);
  });

  test("apply needs a live operator session with recent MFA, never a typed staff id", () => {
    const env = { FUNDHUB_OPERATOR_SESSION: "opaque-test-token" };
    const now = Date.parse("2026-11-02T12:00:00Z");
    const actor = { session: { mfaVerifiedAt: "2026-11-02T11:55:00Z" } };
    assert.match(validateApplySession({ apply: true, staffId: "staff-1" }, actor, { env, now }), /not --staff/);
    assert.match(validateApplySession({ apply: true }, actor, { env: {}, now }), /requires FUNDHUB_OPERATOR_SESSION/);
    assert.match(validateApplySession({ apply: true }, { session: { mfaVerifiedAt: "2026-11-02T11:40:00Z" } }, { env, now }), /within the last 10 minutes/);
    assert.match(validateApplySession({ apply: true }, { session: { mfaVerifiedAt: null } }, { env, now }), /within the last 10 minutes/);
    assert.equal(validateApplySession({ apply: true }, actor, { env, now }), null);
    assert.equal(validateApplySession({ apply: false, staffId: "staff-1" }, null, { env: {}, now }), null);
  });

  test("a typo does not become a dry run that looks like an apply, or vice versa", () => {
    assert.deepEqual(parseArgs(["--Apply"]).unknown, ["--Apply"]);
    assert.equal(parseArgs(["--Apply"]).apply, false);
    assert.deepEqual(parseArgs(["--force"]).unknown, ["--force"]);
  });

  test("apply() is the only function that can write, and it is not called by plan()", async () => {
    const db = fakeDb(COUNTS);
    const result = await plan(db, { orgId: ORG });
    assert.deepEqual(db.writes(), []);

    // The same items, run through apply(), DO write. This is the control: it
    // proves the test above is capable of detecting a write.
    const applyDb = fakeDb({ ...COUNTS,
      "INSERT INTO retention_run_receipts": { rows: [{ id: "receipt-1" }], rowCount: 1 }
    });
    applyDb.connect = async () => ({
      query: async (sql, params) => applyDb.query(sql, params),
      release: () => {}
    });
    const applied = await apply(applyDb, { orgId: ORG, items: result.items, actorId: "staff-1" });
    assert.ok(applyDb.writes().length > 0, "apply() wrote nothing — the dry-run test proves nothing");
    assert.equal(applied.receiptId, "receipt-1");
    const receipt = applyDb.queries.find((q) => q.sql.includes("INSERT INTO retention_run_receipts"));
    assert.ok(receipt, "an applied purge has no durable receipt");
    assert.equal(receipt.params[0], ORG);
    assert.equal(receipt.params[2], "staff-1");
    assert.equal(JSON.parse(receipt.params[3]).length, DATA_CLASSES.length);
    assert.equal(JSON.parse(receipt.params[4]).length, DATA_CLASSES.length);
  });

  test("a missing actor cannot apply customer-data changes", async () => {
    const db = fakeDb(COUNTS);
    const result = await plan(db, { orgId: ORG });
    db.connect = async () => ({ query: async (s, p) => db.query(s, p), release: () => {} });
    await assert.rejects(() => apply(db, { orgId: ORG, items: result.items }), /actorId is required/);
    assert.deepEqual(db.writes(), []);
  });

  test("an unsigned policy cannot apply customer-data changes", async () => {
    const db = fakeDb({ ...COUNTS, "FROM retention_policy": [
      { data_class: "bank_transactions", retain_days: 731, action: "de_identify", signed_off_at: null }
    ] });
    const result = await plan(db, { orgId: ORG });
    db.connect = async () => ({ query: async (s, p) => db.query(s, p), release: () => {} });
    await assert.rejects(() => apply(db, { orgId: ORG, items: result.items, actorId: "staff-1" }), /signed off/);
    assert.deepEqual(db.writes(), []);
  });
});

describe("an unset retention period means DO NOTHING, never zero", () => {
  const POLICY_ALL_NULL = DATA_CLASSES.map((data_class) => ({
    data_class,
    retain_days: null,
    action: CLASSES[data_class].action,
    signed_off_at: null,
    signed_off_by: null
  }));

  test("an intentional signed retain policy stays signed and truthful in the count-only receipt without counting or purging", async () => {
    const db = fakeDb({
      "FROM retention_policy": [{ data_class: "broker_upload_rows", retain_days: null,
        action: "retain", signed_off_at: "2026-08-31T21:52:56Z", signed_off_by: "owner" }],
      "FROM v_retention_policy_gaps": []
    });
    const result = await plan(db, { orgId: ORG });
    const item = countOnlyPlan(result.items).find(row => row.dataClass === "broker_upload_rows");
    assert.deepEqual(item, { dataClass: "broker_upload_rows", action: "retain", retainDays: null,
      signedOff: true, expired: null, skipped: "owner-approved retain in full; no scheduled purge" });
    assert.deepEqual(db.writes(), []);
    assert.equal(db.queries.length, 2, "a retained class must not query its data table");
    assert.equal(result.gaps.length, 0);
  });

  test("NULL retain_days leaves the key ABSENT, not zero", async () => {
    const db = fakeDb({ "FROM retention_policy": POLICY_ALL_NULL });
    const policy = await loadPolicy(db, { orgId: ORG });
    for (const name of DATA_CLASSES) {
      const row = policy.get(name);
      assert.ok(row, `${name} should still have a policy row`);
      assert.equal("retainDays" in row, false, `${name} must not carry a retainDays key when unset`);
      assert.notEqual(row.retainDays, 0, `${name} turned an unset period into zero`);
    }
  });

  test("every class is SKIPPED and REPORTED, and none is counted", async () => {
    const db = fakeDb({ "FROM v_retention_policy_gaps": [], "FROM retention_policy": POLICY_ALL_NULL });
    const result = await plan(db, { orgId: ORG });

    assert.equal(result.items.length, DATA_CLASSES.length);
    for (const item of result.items) {
      assert.match(item.skipped ?? "", /no retention period set/);
      assert.equal(item.expired, undefined);
    }
    // Not one count query was issued against a data table.
    for (const q of db.queries) {
      assert.doesNotMatch(q.sql, /FROM (crs_results|pii_access_log|soft_pull_requests|bank_transactions|events)\b/);
    }
  });

  test("with everything unset, --apply still writes nothing", async () => {
    const db = fakeDb({ "FROM v_retention_policy_gaps": [], "FROM retention_policy": POLICY_ALL_NULL });
    db.connect = async () => ({ query: async (s, p) => db.query(s, p), release: () => {} });

    const result = await plan(db, { orgId: ORG });
    const applied = await apply(db, { orgId: ORG, items: result.items });

    assert.deepEqual(applied, [], "apply() acted on a class that has no retention period");
    assert.deepEqual(db.writes(), [], "apply() wrote despite every retention period being unset");
  });

  test("a retention period of 0 is refused at the reader, not rounded", async () => {
    const db = fakeDb({
      "FROM retention_policy": [{ data_class: "pii_access_log", retain_days: 0, action: "delete", signed_off_at: null, signed_off_by: null }]
    });
    await assert.rejects(() => loadPolicy(db, { orgId: ORG }), RetentionError);
  });

  test("a class handler refuses an unset period even if the runner let one through", async () => {
    const db = fakeDb(COUNTS);
    for (const name of DATA_CLASSES) {
      for (const bad of [undefined, null, 0, -1, 1.5, "30"]) {
        await assert.rejects(
          () => CLASSES[name].count(db, { orgId: ORG, retainDays: bad }),
          /whole number of days/,
          `${name} accepted retainDays ${JSON.stringify(bad)}`
        );
      }
    }
  });
});

describe("org scoping fails closed", () => {
  test("no actor at all is refused, and no query is run", async () => {
    const db = fakeDb();
    const res = await resolveActor(db, {});
    assert.match(res.error, /say who you are/);
    assert.deepEqual(db.queries, [], "it queried the database before knowing who was asking");
  });

  test("an unknown staff id is refused rather than defaulted", async () => {
    const db = fakeDb({ "FROM staff": [] });
    const res = await resolveActor(db, { staffId: "nobody" });
    assert.match(res.error, /no staff member/);
    assert.equal(res.staff, undefined);
  });

  test("a staff member with no org is refused — no fallback to the default org", async () => {
    const db = fakeDb({ "FROM staff": [{ id: "s1", org_id: null, role: "owner", status: "active" }] });
    const res = await resolveActor(db, { staffId: "s1" });
    assert.match(res.error, /no org/);
  });

  test("a suspended staff member is refused", async () => {
    const db = fakeDb({ "FROM staff": [{ id: "s1", org_id: ORG, role: "owner", status: "suspended" }] });
    const res = await resolveActor(db, { staffId: "s1" });
    assert.match(res.error, /not active/);
  });

  test("the wrong role is refused", async () => {
    const db = fakeDb({ "FROM staff": [{ id: "s1", org_id: ORG, role: "closer", status: "active" }] });
    const res = await resolveActor(db, { staffId: "s1" });
    assert.match(res.error, /may not run a retention purge/);
  });

  test("owner and admin are allowed, and the org comes off their own record", async () => {
    for (const role of ["owner", "admin"]) {
      const db = fakeDb({ "FROM staff": [{ id: "s1", org_id: ORG, role, status: "active" }] });
      const res = await resolveActor(db, { staffId: "s1" });
      assert.equal(res.error, undefined, `${role} was refused`);
      assert.equal(res.staff.orgId, ORG);
    }
  });

  test("there is no way to name an org — the flag does not exist", () => {
    assert.deepEqual(parseArgs(["--org", ORG]).unknown, ["--org", ORG]);
  });

  test("every class query is scoped to one org", async () => {
    const db = fakeDb(COUNTS);
    await plan(db, { orgId: ORG });
    const dataQueries = db.queries.filter((q) =>
      /FROM (crs_results|pii_access_log|soft_pull_requests|bank_transactions|events|clients)\b/.test(q.sql)
    );
    assert.ok(dataQueries.length > 0);
    for (const q of dataQueries) {
      assert.match(q.sql, /org_id = \$1/, `unscoped query: ${q.sql.slice(0, 80)}`);
      assert.equal(q.params[0], ORG);
    }
  });

  test("a class handler refuses a missing org outright", async () => {
    const db = fakeDb(COUNTS);
    for (const name of DATA_CLASSES) {
      await assert.rejects(
        () => CLASSES[name].count(db, { orgId: "", retainDays: 30 }),
        /orgId is required/,
        `${name} accepted a blank org`
      );
    }
  });
});

describe("money: NULL means UNKNOWN and survives", () => {
  test("an all-unknown cost stays null and is never reported as zero", async () => {
    const db = fakeDb(COUNTS);
    const counts = await CLASSES.soft_pull_ledger.count(db, { orgId: ORG, retainDays: 30 });
    assert.equal(counts.knownCostCents, null, "an unknown total was coerced into a number");
    assert.equal(counts.unknownCost, 4, "rows with an unknown cost must be counted separately");
  });

  test("a known cost comes back as integer cents", async () => {
    const db = fakeDb({ ...COUNTS, "FROM soft_pull_requests": [{ n: "2", unknown_cost: "1", known_cost_cents: "1750" }] });
    const counts = await CLASSES.soft_pull_ledger.count(db, { orgId: ORG, retainDays: 30 });
    assert.equal(counts.knownCostCents, 1750);
    assert.equal(counts.unknownCost, 1);
  });

  test("no purge statement rewrites an amount", () => {
    // amount_cents and cost_cents must not appear in any SET clause.
    const src = CLASSES.bank_transactions.purge.toString();
    assert.doesNotMatch(src, /amount_cents\s*=/);
  });
});

describe("mock-data markers are narrow on purpose", () => {
  test("the event marker matches demo-journey's keys and nothing broader", () => {
    assert.deepEqual([...MOCK_EVENT_KEY_PATTERNS], ["demo:%"]);
  });

  test("no marker starts with a wildcard", () => {
    // A TRAILING % is a prefix match ("demo:...") and is the safe shape.
    // A LEADING % matches anything that merely ends the right way, which is how
    // a marker meant for demo rows starts sweeping real ones. Refuse those, and
    // demand a decent run of literal characters before any wildcard.
    for (const m of [...MOCK_EVENT_KEY_PATTERNS, ...MOCK_CLIENT_EMAILS]) {
      assert.doesNotMatch(m, /^%/, `marker "${m}" starts with a wildcard`);
      const literalPrefix = m.split("%")[0];
      assert.ok(literalPrefix.length >= 4, `marker "${m}" wildcards after only ${literalPrefix.length} characters`);
    }
  });

  test("no marker sweeps an entire email domain", () => {
    for (const m of MOCK_CLIENT_EMAILS) {
      assert.doesNotMatch(m, /%/, `client-email marker "${m}" contains a wildcard — it must be an exact address`);
      assert.match(m, /^[^@]+@[^@]+$/, `client-email marker "${m}" is not a single exact address`);
    }
  });

  test("the demo client is report-only — there is no purge path that deletes a client", () => {
    for (const name of DATA_CLASSES) {
      const src = CLASSES[name].purge.toString();
      assert.doesNotMatch(src, /DELETE\s+FROM\s+clients/i, `${name} can delete a client row`);
    }
  });

  test("mock_data's purge only touches events", () => {
    const src = CLASSES.mock_data.purge.toString();
    assert.match(src, /DELETE\s+FROM\s+events/i);
    assert.doesNotMatch(src, /pii_identity|crs_results|soft_pull_requests|bank_accounts|plaid_items/);
  });
});

describe("the class list cannot drift", () => {
  test("every data class in policy.mjs has a handler", () => {
    for (const name of DATA_CLASSES) {
      assert.ok(CLASSES[name], `no handler for ${name}`);
      assert.equal(CLASSES[name].dataClass, name);
      // Three actions now. 'retain' arrived with broker_upload_rows: kept in
      // full, on purpose, with no purge scheduled (owner-set 2026-08-31).
      assert.ok(["delete", "de_identify", "retain"].includes(CLASSES[name].action));
      assert.ok(CLASSES[name].why?.length > 20, `${name} does not say why it deletes, de-identifies or retains`);
    }
  });

  test("every handler has a count and a purge, and they are different functions", () => {
    for (const name of DATA_CLASSES) {
      assert.equal(typeof CLASSES[name].count, "function");
      assert.equal(typeof CLASSES[name].purge, "function");
      assert.notEqual(CLASSES[name].count, CLASSES[name].purge);
    }
  });

  test("the six classes are the ones the task named", () => {
    assert.deepEqual([...DATA_CLASSES], [
      "crs_raw_payloads",
      "pii_access_log",
      "soft_pull_ledger",
      "bank_transactions",
      "mock_data",
      // Broker Decline Autopsy uploads. REGISTERED, NEVER PURGED — owner-set
      // 2026-08-31, "retain in full, no purge". It is in this list so it is
      // counted and auditable, not so it is destroyed on a clock. See
      // db/migrations/275_decline_autopsy.sql.
      "broker_upload_rows"
    ]);
  });
});
