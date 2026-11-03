// Client erasure — unit tests over a stubbed database.
//
// No DATABASE_URL and no Postgres. The stub has no connect(), so
// src/db/with-transaction.mjs runs the callback inline and these tests exercise
// the real ordering of statements. The parts that genuinely need a database —
// that the CHECK constraints in migration 102 reject a bad audit row, that the
// cascade really fires — are in erasure.pg.test.mjs, which skips unless
// DATABASE_URL is set.
//
// WHAT IS BEING PROVEN, in order of what it would cost to get wrong:
//   1. NOTHING is removed until the audit row is written.
//   2. The person's transactions are found by the ANCHOR, not only by client_id.
//   3. CRS, tradelines and the soft-pull ledger are NOT TOUCHED.
//   4. The client row is de-identified, never deleted.
//   5. Org scope comes from the caller and fails closed.

import { test, describe } from "node:test";
import assert from "node:assert";

import { eraseClient, listErasureRequests, ErasureError, KEPT_WITH_REASON } from "./erasure.mjs";

const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OTHER_ORG = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const CLIENT = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const STAFF = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";

const REQUESTED_BY = { staffId: STAFF, label: "Dana Owner <" + STAFF + ">" };
const REASON = "data subject emailed on 2026-07-30 asking to be erased";

function stubDb({ client = { id: CLIENT, org_id: ORG }, counts = {}, items = [{ id: "item-1" }] } = {}) {
  const n = {
    pii_identity: 1, bank_accounts: 2, bank_transactions: 412,
    crs_results: 3, tradelines: 40, soft_pull_requests: 2,
    pii_access_log: 9, transactions: 5, invoices: 4,
    commission_ledger: 6, erasure_requests: 0, ...counts
  };
  const log = [];
  return {
    log,
    async query(sql, params) {
      log.push({ sql: sql.replace(/\s+/g, " ").trim(), params });

      if (/FROM clients WHERE id/i.test(sql)) {
        const [id, org] = params;
        return { rows: client && client.id === id && client.org_id === org ? [client] : [] };
      }
      if (/SELECT id FROM plaid_items/i.test(sql)) return { rows: items };
      if (/INSERT INTO erasure_requests/i.test(sql)) {
        return { rows: [{ id: "audit-1", created_at: "2026-07-31T00:00:00Z" }] };
      }
      const count = /count\(\*\)[\s\S]*?FROM\s+(\w+)/i.exec(sql);
      if (count) return { rows: [{ n: String(n[count[1]] ?? 0) }] };
      if (/^\s*(DELETE|UPDATE)/i.test(sql)) return { rowCount: 1, rows: [] };
      throw new Error("unexpected sql: " + sql);
    }
  };
}

const find = (log, re) => log.findIndex((c) => re.test(c.sql));
const all = (log, re) => log.filter((c) => re.test(c.sql));

describe("erasure: nothing is removed until the audit row exists", () => {

  test("*** the audit row is written BEFORE every removal ***", async () => {
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    const audit = find(db.log, /INSERT INTO erasure_requests/i);
    assert.ok(audit >= 0, "no audit row was written");

    // Every destructive statement must come after it.
    db.log.forEach((call, i) => {
      if (/^\s*(DELETE|UPDATE)/i.test(call.sql)) {
        assert.ok(i > audit,
          `a ${call.sql.slice(0, 30)}... ran before the audit row was written. ` +
          `If the audit insert then failed, data would be gone with no record that ` +
          `anybody asked for it.`);
      }
    });
  });

  test("a refused request removes nothing at all", async () => {
    for (const bad of [
      { reason: "short" }, { reason: "" }, { requestedBy: { label: "" } }, { requestedBy: undefined }
    ]) {
      const db = stubDb();
      await assert.rejects(() => eraseClient(db, {
        orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON, ...bad
      }));
      assert.equal(db.log.length, 0, "a refused erasure must not reach the database");
    }
  });

  test("the audit row records the kind, the subject, who asked and why", async () => {
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    const insert = db.log.find((c) => /INSERT INTO erasure_requests/i.test(c.sql));
    assert.match(insert.sql, /'client_erasure'/);
    const [org, subject, staffId, label, why] = insert.params;
    assert.deepEqual([org, subject, staffId, label, why], [ORG, CLIENT, STAFF, REQUESTED_BY.label, REASON]);
  });

  test("a client_erasure names no item id — migration 102's CHECK requires that", async () => {
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });
    const insert = db.log.find((c) => /INSERT INTO erasure_requests/i.test(c.sql));
    assert.match(insert.sql, /'client_erasure', \$2, NULL/i,
      "a stray subject_item_id would read as 'we only erased this one login's worth'");
  });

  test("the client row is locked before anything is decided about it", async () => {
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });
    assert.match(db.log[0].sql, /FOR UPDATE/i);
  });
});

describe("erasure: the person's transactions are found by the anchor", () => {

  test("*** the ledger is searched by subject_client_id, not only by client_id ***", async () => {
    // The whole point of migration 101. If this person's client row had ever been
    // hard-deleted, client_id would be NULL on every one of these rows and a
    // client_id-only search would find nothing while the data sat there.
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    const counted = db.log.find((c) => /count\(\*\)[\s\S]*bank_transactions/i.test(c.sql));
    assert.ok(counted, "the ledger was never counted");
    assert.match(counted.sql, /subject_client_id = \$2 OR client_id = \$2/,
      "the count must use the durable anchor, or already-orphaned rows stay invisible");

    const scrub = db.log.find((c) => /UPDATE bank_transactions/i.test(c.sql));
    assert.match(scrub.sql, /subject_client_id = \$2 OR client_id = \$2/,
      "the scrub must reach the same rows the count found");
  });

  test("the anchor itself is NOT cleared — that would re-orphan the rows", async () => {
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });
    const scrub = db.log.find((c) => /UPDATE bank_transactions/i.test(c.sql));
    assert.ok(!/subject_client_id\s*=\s*NULL/i.test(scrub.sql),
      "after erasure the anchor is a pseudonym — it resolves to no name, email, phone " +
      "or SSN because none are left. Clearing it destroys the proof the erasure happened.");
  });

  test("the ledger rows survive; only the identifying detail is scrubbed", async () => {
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    assert.equal(all(db.log, /DELETE FROM bank_transactions/i).length, 0,
      "the financial record of money that moved must survive an erasure");

    const scrub = db.log.find((c) => /UPDATE bank_transactions/i.test(c.sql));
    assert.match(scrub.sql, /merchant_name = NULL/i, "where they shop is personal data");
    assert.match(scrub.sql, /raw = '\{\}'::jsonb/i, "the raw provider payload carries the same detail");
    assert.ok(!/amount_cents/i.test(scrub.sql), "amounts are the financial record and must not be touched");
    assert.ok(!/posted_on/i.test(scrub.sql), "dates are the financial record and must not be touched");
  });
});

describe("erasure: CRS and the credit path are not touched", () => {

  test("*** no statement writes to crs_results, tradelines or soft_pull_requests ***", async () => {
    // These are a live, compliant credit path with FCRA retention obligations and
    // a different owner. They are declared KEPT with a written reason; quietly
    // editing them would be a change to a working compliance system.
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    for (const call of db.log) {
      if (!/^\s*(DELETE|UPDATE|INSERT)/i.test(call.sql)) continue;
      for (const table of ["crs_results", "tradelines", "soft_pull_requests"]) {
        assert.ok(!new RegExp(`\\b${table}\\b`, "i").test(call.sql),
          `${table} must never be written by an erasure: ${call.sql}`);
      }
    }
  });

  test("they are declared KEPT, with counts and written reasons", async () => {
    const db = stubDb({ counts: { crs_results: 3, tradelines: 40, soft_pull_requests: 2 } });
    const out = await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    const kept = Object.fromEntries(out.kept.map((k) => [k.table, k]));
    assert.equal(kept.crs_results.rows, 3);
    assert.equal(kept.tradelines.rows, 40);
    assert.equal(kept.soft_pull_requests.rows, 2);
    assert.match(kept.crs_results.reason, /FCRA/);
    assert.match(kept.soft_pull_requests.reason, /permissible/i);
  });

  test("every kept entry carries a reason long enough for migration 102's CHECK", async () => {
    const db = stubDb();
    const out = await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    assert.ok(out.kept.length > 0, "a completed client erasure that kept nothing is an incomplete audit");
    for (const entry of out.kept) {
      assert.ok(entry.table && entry.table.trim(), "every kept entry needs a table");
      assert.ok(
        typeof entry.reason === "string" && entry.reason.trim().length >= 20,
        `kept entry for ${entry.table} has a reason too short to be a reason: ${entry.reason}`
      );
    }
  });

  test("the access log is kept: the identity values go, the record of who read them stays", async () => {
    const db = stubDb();
    const out = await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    assert.equal(all(db.log, /DELETE FROM pii_access_log/i).length, 0);
    const kept = out.kept.find((k) => k.table === "pii_access_log");
    assert.equal(kept.reason, KEPT_WITH_REASON.pii_access_log);
    assert.match(kept.reason, /accountability/i);
  });

  test("the audit record counts itself among what is kept", async () => {
    const db = stubDb({ counts: { erasure_requests: 2 } });
    const out = await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });
    assert.equal(out.kept.find((k) => k.table === "erasure_requests").rows, 3,
      "two earlier requests plus the one just written");
  });
});

describe("erasure: what is removed", () => {

  test("the identity record goes outright — there is no de-identified SSN", async () => {
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });
    assert.equal(all(db.log, /DELETE FROM pii_identity WHERE client_id/i).length, 1);
  });

  test("bank logins and their credentials go, and so do hand-entered accounts", async () => {
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    assert.equal(all(db.log, /DELETE FROM plaid_items/i).length, 1);
    // The separate sweep matters: an account with plaid_item_id NULL was typed in
    // by a human and the cascade from plaid_items never reaches it.
    assert.equal(all(db.log, /DELETE FROM bank_accounts/i).length, 1,
      "hand-entered accounts are not reached by the plaid_items cascade");
  });

  test("client erasure revokes open Plaid grants but preserves consent receipts", async () => {
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });
    const revoke = db.log.find((c) => /UPDATE account_plaid_link_grants/i.test(c.sql));
    assert.ok(revoke, "an open bank connection grant could survive client erasure");
    assert.deepEqual(revoke.params, [ORG, CLIENT]);
    assert.match(revoke.sql, /target_kind = 'client_bank'/);
    assert.equal(all(db.log, /DELETE FROM account_plaid_link_grants/i).length, 0);
  });

  test("*** the client row is DE-IDENTIFIED, never deleted ***", async () => {
    // A hard delete would be refused by Postgres anyway (pii_access_log.client_id
    // references clients(id) with no cascade) AND it would strand the ledger —
    // manufacturing the orphan bug while reporting success.
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    assert.equal(all(db.log, /DELETE FROM clients/i).length, 0,
      "erasure must never DELETE a client row — see src/privacy/erasure.mjs section 2");

    const update = db.log.find((c) => /UPDATE clients/i.test(c.sql));
    assert.ok(update, "the client row was never de-identified");
    for (const field of ["first_name", "last_name", "email", "phone", "ghl_contact_id", "custom_fields", "tags"]) {
      assert.match(update.sql, new RegExp(`${field}\\s*=`), `${field} was left on the record`);
    }
    assert.equal(update.params[2], "[erased]",
      "a blank field cannot be told apart from one that was never filled in");
  });

  test("the removed manifest names every table with a count and a detail", async () => {
    const db = stubDb({ counts: { pii_identity: 1, bank_accounts: 2, bank_transactions: 412 } });
    const out = await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    const removed = Object.fromEntries(out.removed.map((r) => [r.table, r]));
    assert.equal(removed.clients.rows, 1);
    assert.match(removed.clients.detail, /retained as a pseudonym/i);
    assert.equal(removed.pii_identity.rows, 1);
    assert.match(removed.pii_identity.detail, /social security number/i);
    assert.equal(removed.bank_accounts.rows, 2);
    assert.equal(removed.bank_transactions.rows, 412);
    assert.match(removed.bank_transactions.detail, /scrubbed/i);
    for (const entry of out.removed) assert.ok(entry.detail && entry.detail.length > 10);
  });

  test("bank_transactions appears in BOTH manifests, which is the honest description", async () => {
    // The rows are kept; the identifying detail inside them is removed. Reporting
    // only one half would misdescribe what happened in either direction.
    const db = stubDb();
    const out = await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });
    assert.ok(out.removed.some((r) => r.table === "bank_transactions"));
    assert.ok(out.kept.some((k) => k.table === "bank_transactions"));
  });
});

describe("erasure: org scope fails closed", () => {

  test("a client in another org is not found", async () => {
    const db = stubDb();
    await assert.rejects(
      () => eraseClient(db, { orgId: OTHER_ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON }),
      (e) => { assert.equal(e.status, 404); return true; }
    );
    assert.equal(all(db.log, /^\s*(DELETE|UPDATE)/i).length, 0);
  });

  test("the org is in the WHERE clause of the lookup and of every write", async () => {
    const db = stubDb();
    await eraseClient(db, { orgId: ORG, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON });

    assert.match(db.log[0].sql, /WHERE id = \$1 AND org_id = \$2/i);
    for (const call of all(db.log, /^\s*(DELETE FROM (plaid_items|bank_accounts)|UPDATE (clients|bank_transactions))/i)) {
      assert.match(call.sql, /org_id = \$/i, "an unscoped write could reach another org: " + call.sql);
    }
  });

  test("a missing or malformed org id throws before any query runs", async () => {
    for (const bad of [undefined, null, "", "not-a-uuid"]) {
      const db = stubDb();
      await assert.rejects(
        () => eraseClient(db, { orgId: bad, clientId: CLIENT, requestedBy: REQUESTED_BY, reason: REASON }),
        /orgId must be a uuid/
      );
      assert.equal(db.log.length, 0);
    }
  });

  test("a malformed client id is refused before any query runs", async () => {
    for (const bad of [undefined, null, "", "1 OR 1=1"]) {
      const db = stubDb();
      await assert.rejects(
        () => eraseClient(db, { orgId: ORG, clientId: bad, requestedBy: REQUESTED_BY, reason: REASON }),
        /clientId must be a uuid/
      );
      assert.equal(db.log.length, 0);
    }
  });
});

describe("erasure: reading the record back", () => {

  test("listErasureRequests is org-scoped and fails closed", async () => {
    const db = { async query() { throw new Error("must not be reached"); } };
    await assert.rejects(() => listErasureRequests(db, {}), /orgId must be a uuid/);
    await assert.rejects(() => listErasureRequests(db, { orgId: "nope" }), /orgId must be a uuid/);
    await assert.rejects(() => listErasureRequests(db, { orgId: ORG, clientId: "nope" }), /clientId must be a uuid/);
  });

  test("with a client it filters by the subject; without one it lists the org", async () => {
    let seen = null;
    const db = { async query(sql, params) { seen = { sql, params }; return { rows: [] }; } };

    // Match on the WHERE clause specifically: subject_client_id is also one of
    // the SELECTed columns, so a bare search for the name matches either way and
    // would pass whatever the filter did.
    const whereOf = (sql) => /WHERE([\s\S]*?)ORDER BY/i.exec(sql)[1];

    await listErasureRequests(db, { orgId: ORG, clientId: CLIENT });
    assert.match(whereOf(seen.sql), /subject_client_id = \$2/);
    assert.deepEqual(seen.params.slice(0, 2), [ORG, CLIENT]);

    await listErasureRequests(db, { orgId: ORG });
    assert.ok(!/subject_client_id/.test(whereOf(seen.sql)),
      "with no client named, the read must not filter by subject at all");
    assert.deepEqual(seen.params.slice(0, 1), [ORG]);
  });

  test("the limit is bounded, so a caller cannot ask for the whole table", async () => {
    let seen = null;
    const db = { async query(sql, params) { seen = params; return { rows: [] }; } };
    for (const [asked, expected] of [[10, 10], [99999, 500], [0, 100], ["abc", 100], [-5, 1]]) {
      await listErasureRequests(db, { orgId: ORG, limit: asked });
      assert.equal(seen[seen.length - 1], expected, `limit ${asked}`);
    }
  });
});
