// Postgres-backed tests for the soft-pull ledger.
//
// TWO CLAIMS, AND NEITHER CAN BE PROVEN WITHOUT A REAL DATABASE:
//
//   1. AN UNATTRIBUTED PULL IS REFUSED BY THE TABLE, not only by the module.
//      soft-pulls.test.mjs proves requestSoftPull() refuses before it queries.
//      That is a promise about one function. This file proves the promise holds
//      against a writer that does not go through it — a script, a psql session,
//      a future module that forgot — because the CHECK constraint in 077 is what
//      actually adjudicates it. A rule enforced only by the code that usually
//      writes is a convention, not a control.
//
//   2. A RESULT LANDS THROUGH THE EXISTING INGEST PATH. fulfilSoftPull() calls
//      ingestCrsResult() from src/tradelines/store.mjs, and the assertion is
//      against the `tradelines` rows that appear — not against a return value.
//      A return value is the function's account of what it did; the rows are
//      what it did. The unit test can only check that a matching SQL string was
//      issued; only Postgres can say the cards are actually there, with the
//      limits and APRs the normalizer produced.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs. See the trap in
// CLAUDE.md §12: with DATABASE_URL unset these skip and the suite reports zero
// failures, so a green `npm test` is not evidence any of this ran.

import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { db, pool, close } from "../db.mjs";
import { resolveDefaultOrg } from "../auth/org.mjs";
import { captureConsent } from "../consent/index.mjs";
import {
  requestSoftPull,
  fulfilSoftPull,
  closeSoftPull,
  listSoftPullRequests,
  openRequestFor,
  getSoftPullRequest,
  recordPull,
  coordinateCrsResult,
  claimSoftPull,
  getLatestPull,
  SoftPullError
} from "./soft-pulls.mjs";
import { onAnalysisCompleted } from "../handlers/client-lifecycle.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { runCrsPull } from "./crs-pull.mjs";

const SANDBOX_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../vendor/underwriteiq-full/api/lite/crs/sandbox"
);
const sandboxReport = (file) => JSON.parse(readFileSync(path.join(SANDBOX_DIR, file), "utf8"));

const HAVE_DB = !!process.env.DATABASE_URL;

const CLIENT_EMAIL_LIKE = "softpull.pg.test.%@example.com";
const STAFF_EMAIL_LIKE = "softpull_pg_test_%@example.com";

/* A payload in the shape src/tradelines/index.mjs actually reads: a `tradelines`
   container, dollar amounts, an APR as a percentage number, an account ref. */
const CRS_PAYLOAD = {
  tradelines: [
    { creditor: "Amex Blue Business", credit_limit: 10000, balance: 2500, apr: 18.99, account_number: "AMEX-0001" },
    { creditor: "Chase Ink", credit_limit: 7500, balance: 0, apr: 21.24, account_number: "CHASE-0002" },
    // No APR at all — the normalizer must leave it null, and null must survive
    // all the way into the column.
    { creditor: "Capital One Spark", credit_limit: 3000, balance: 900, account_number: "CAP1-0003" }
  ]
};

describe("soft pull ledger", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let org, client, otherClient, staffId, accountId;

  async function purge() {
    const ids = (await db.query(`SELECT id FROM clients WHERE email LIKE $1`, [CLIENT_EMAIL_LIKE]))
      .rows.map((r) => r.id);
    if (ids.length) {
      // soft_pull_requests and tradelines both cascade from clients; crs_results
      // does too. Deleting the clients is enough, and doing it explicitly first
      // keeps a crashed previous run from colliding on the email index.
      await db.query(`DELETE FROM clients WHERE id = ANY($1)`, [ids]);
    }
    await db.query(`DELETE FROM accounts WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
    await db.query(`DELETE FROM staff WHERE email LIKE $1`, [STAFF_EMAIL_LIKE]);
  }

  const mkClient = async (slug) => (await db.query(
    `INSERT INTO clients (org_id, first_name, last_name, email)
     VALUES ($1,'Softpull',$2,$3) RETURNING id`,
    [org, slug, `softpull.pg.test.${slug}@example.com`]
  )).rows[0].id;

  const mkCrs = async (clientId, payload = CRS_PAYLOAD) => (await db.query(
    `INSERT INTO crs_results (org_id, client_id, result) VALUES ($1,$2,$3) RETURNING id`,
    [org, clientId, JSON.stringify(payload)]
  )).rows[0].id;

  const ledgerRows = async (clientId = client) => (await db.query(
    `SELECT * FROM soft_pull_requests WHERE client_id = $1 ORDER BY requested_at, id`, [clientId]
  )).rows;

  const tradelineRows = async (clientId = client) => (await db.query(
    `SELECT lender, kind, credit_limit_cents, balance_cents, apr, source, source_ref, account_ref
       FROM tradelines WHERE client_id = $1 ORDER BY lender`, [clientId]
  )).rows;

  /* withClients — run n callers at once, each on its own connection that is
     ALREADY open before the work starts. Checking out the connections first is
     what makes a concurrency test a concurrency test: otherwise the second and
     third callers spend the whole race connecting. Every connection is released
     even if a caller throws, so a failure here cannot drain the pool and take
     the rest of the file down with it. */
  const withClients = async (n, run) => {
    const conns = [];
    try {
      for (let i = 0; i < n; i++) conns.push(await pool().connect());
      const outs = await Promise.all(run(conns));
      return { outs, rows: await ledgerRows() };
    } finally {
      for (const c of conns) c.release();
    }
  };

  const wipeLedger = async () => {
    await db.query(`DELETE FROM tradelines WHERE client_id = ANY($1)`, [[client, otherClient]]);
    // The immutability trigger is BEFORE UPDATE only; DELETE is deliberately
    // allowed so a client's erasure takes their pull log with it (see 077).
    await db.query(`DELETE FROM soft_pull_requests WHERE client_id = ANY($1)`, [[client, otherClient]]);
  };

  before(async () => {
    org = await resolveDefaultOrg(db);
    await purge();

    staffId = (await db.query(
      `INSERT INTO staff (org_id, name, role, email, status)
       VALUES ($1,'Softpull Pgtest Closer','closer','softpull_pg_test_closer@example.com','active')
       RETURNING id`, [org])).rows[0].id;

    client = await mkClient("subject");
    otherClient = await mkClient("bystander");

    // 044's accounts_active_needs_hash: an active account must be able to
    // authenticate. Nothing here signs in — the account exists only to be the
    // subject a client-initiated request is attributed to — so it stays
    // 'invited', which is the state that needs no password hash.
    accountId = (await db.query(
      `INSERT INTO accounts (org_id, kind, email, name, status, client_id)
       VALUES ($1,'client','softpull_pg_test_acct@example.com','Softpull Pgtest Client','invited',$2)
       RETURNING id`, [org, client])).rows[0].id;

    /* THE CONSENT PRECONDITION (rule 0, db/migrations/099_client_consents.sql).
     *
     * requestSoftPull() now refuses without a live consent for the client, so
     * every scenario below that expects a request to be RECORDED needs one on
     * file first. This is a real precondition of the product, not test
     * scaffolding: with no consent the correct behaviour is a 403 and no row.
     *
     * Granted here in before() rather than per test because wipeLedger() clears
     * soft_pull_requests and tradelines and deliberately leaves client_consents
     * alone — consent outlives any one request, which is the point of it being
     * a separate record rather than a field on the request.
     *
     * BOTH clients get one: `otherClient` is the bystander in the "two clients
     * may each have an open request" and "a crs row for another client is
     * refused" scenarios, and those must fail for the reason they are testing,
     * not because the bystander never consented.
     *
     * The gate's own behaviour — refusal with none, expired, or revoked — is
     * proven in src/consent/consent.pg.test.mjs against these same tables,
     * rather than duplicated here. */
    for (const c of [client, otherClient]) {
      await captureConsent(db, {
        orgId: org, clientId: c, kind: "soft_pull_consent",
        consentText: "I authorize Fundhub to obtain my consumer credit report through a soft inquiry.",
        consentVersion: "soft-pull-v1",
        grantedBy: { kind: "staff", id: staffId },
        captureMethod: "checkbox"
      });
    }
  });

  after(async () => {
    // client_consents cascades from clients, so purge() takes it. Explicit here
    // only so the next reader does not go looking for a missing cleanup.
    await purge();
    await close();
  });

  // ── 1. an unattributed pull is refused, by the table itself ───────────────

  describe("an unattributed pull is not loggable", () => {
    test("the module refuses, and writes no row", async () => {
      await wipeLedger();
      await assert.rejects(
        () => requestSoftPull(db, { orgId: org, clientId: client, reason: "no attribution" }),
        (e) => e instanceof SoftPullError && e.status === 401
      );
      assert.deepEqual(await ledgerRows(), [],
        "a refused request still wrote to soft_pull_requests");
    });

    test("THE TABLE refuses too — a writer that skips the module cannot log one either", async () => {
      // This is the claim that matters. If only the module enforced it, the rule
      // would hold exactly as long as everybody remembered to use the module.
      await wipeLedger();
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests (org_id, client_id, requested_by_kind, reason)
           VALUES ($1,$2,'staff','pulled by nobody')`, [org, client]
        ),
        (e) => /soft_pull_requests_requester_ck/.test(String(e.message)),
        "Postgres accepted a soft pull with no requester"
      );
      assert.deepEqual(await ledgerRows(), []);
    });

    test("a row cannot claim one kind and carry the other kind's subject", async () => {
      await wipeLedger();
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests
             (org_id, client_id, requested_by_kind, requested_by_account_id, reason)
           VALUES ($1,$2,'staff',$3,'kind and subject disagree')`, [org, client, accountId]
        ),
        (e) => /soft_pull_requests_requester_ck/.test(String(e.message))
      );
      // Nor can it name both — "who asked" has exactly one answer.
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests
             (org_id, client_id, requested_by_kind, requested_by_staff_id, requested_by_account_id, reason)
           VALUES ($1,$2,'staff',$3,$4,'two requesters')`, [org, client, staffId, accountId]
        ),
        (e) => /soft_pull_requests_requester_ck/.test(String(e.message))
      );
      assert.deepEqual(await ledgerRows(), []);
    });

    test("a blank reason is refused by the table, not just by the module", async () => {
      // "   " satisfies NOT NULL and looks populated in an audit export. It is
      // the shape that reads as an answer and is not one.
      await wipeLedger();
      for (const reason of ["", "   ", "\t\n"]) {
        await assert.rejects(
          () => db.query(
            `INSERT INTO soft_pull_requests
               (org_id, client_id, requested_by_kind, requested_by_staff_id, reason)
             VALUES ($1,$2,'staff',$3,$4)`, [org, client, staffId, reason]
          ),
          (e) => /soft_pull_requests_reason_ck/.test(String(e.message)),
          `Postgres accepted the reason ${JSON.stringify(reason)}`
        );
      }
      assert.deepEqual(await ledgerRows(), []);
    });

    test("the attribution cannot be rewritten after the fact", async () => {
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client,
        requestedBy: { kind: "staff", id: staffId },
        reason: "closer refreshing the funding waterfall"
      });

      for (const [col, val] of [
        ["requested_by_staff_id", null],
        ["requested_by_kind", "client"],
        ["reason", "something else entirely"],
        ["client_id", otherClient]
      ]) {
        await assert.rejects(
          () => db.query(`UPDATE soft_pull_requests SET ${col} = $2 WHERE id = $1`, [request.id, val]),
          (e) => /immutable/.test(String(e.message)),
          `${col} was rewritable after insert`
        );
      }

      const [row] = await ledgerRows();
      assert.equal(row.requested_by_staff_id, staffId);
      assert.equal(row.reason, "closer refreshing the funding waterfall");
    });
  });

  // ── 2. a result lands through ingestCrsResult ─────────────────────────────

  describe("a result lands through the existing ingest path", () => {
    test("fulfilling a request writes the client's tradelines and closes the ledger row", async () => {
      await wipeLedger();
      assert.deepEqual(await tradelineRows(), [], "the client had tradelines before the pull");

      const { created, request } = await requestSoftPull(db, {
        orgId: org, clientId: client,
        requestedBy: { kind: "client", id: accountId },
        reason: "client tapped refresh in the portal",
        costCents: 1200
      });
      assert.equal(created, true);
      assert.equal(request.status, "queued", "a new request did not start queued");
      assert.equal(request.crs_result_id, null);
      assert.equal(request.resolved_at, null);

      const crsId = await mkCrs(client);
      const out = await fulfilSoftPull(db, { requestId: request.id, crsResultId: crsId });

      assert.equal(out.ingested, 3, "the pull did not ingest all three lines");
      assert.equal(out.request.status, "fulfilled");
      assert.equal(out.request.crs_result_id, crsId);
      assert.ok(out.request.resolved_at, "a fulfilled request has no resolved_at");

      // THE ACTUAL CLAIM: the cards are in the table the closer's calculator reads.
      const lines = await tradelineRows();
      assert.equal(lines.length, 3, `tradelines has ${lines.length} rows, not 3`);
      assert.deepEqual(lines.map((l) => l.lender),
        ["Amex Blue Business", "Capital One Spark", "Chase Ink"]);

      const amex = lines.find((l) => l.lender === "Amex Blue Business");
      assert.equal(amex.credit_limit_cents, "1000000", "dollars did not become cents");
      assert.equal(amex.balance_cents, "250000");
      assert.equal(Number(amex.apr), 0.18990, "18.99% did not become the fraction 0.1899");
      assert.equal(amex.source, "crs");
      assert.equal(amex.source_ref, crsId,
        "the stored line does not point back at the crs_results row it came from");

      // NULL survives: the third line reported no APR and must not have acquired one.
      const cap1 = lines.find((l) => l.lender === "Capital One Spark");
      assert.equal(cap1.apr, null, "a missing APR was filled in with a guess");
    });

    test("re-pulling the same cards updates them rather than duplicating them", async () => {
      // This is store.mjs's upsert doing its job through the soft-pull path. If
      // this module had written its own INSERT the waterfall would draw the same
      // card twice and double the client's available credit.
      await wipeLedger();
      const first = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "first pull"
      });
      await fulfilSoftPull(db, { requestId: first.request.id, crsResultId: await mkCrs(client) });
      assert.equal((await tradelineRows()).length, 3);

      const second = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "second pull, balances moved"
      });
      const moved = JSON.parse(JSON.stringify(CRS_PAYLOAD));
      moved.tradelines[0].balance = 4100;
      await fulfilSoftPull(db, { requestId: second.request.id, crsResultId: await mkCrs(client, moved) });

      const lines = await tradelineRows();
      assert.equal(lines.length, 3, `a second pull produced ${lines.length} rows — the cards were duplicated`);
      assert.equal(lines.find((l) => l.lender === "Amex Blue Business").balance_cents, "410000",
        "the second pull's balance did not land");
    });

    test("a crs row for another client is refused, and that client's cards are not ingested", async () => {
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "mis-join guard"
      });
      const bystanderCrs = await mkCrs(otherClient);

      await assert.rejects(
        () => fulfilSoftPull(db, { requestId: request.id, crsResultId: bystanderCrs }),
        (e) => e instanceof SoftPullError && e.status === 409
      );

      assert.deepEqual(await tradelineRows(client), [],
        "another person's credit file was ingested as this client's cards");
      assert.deepEqual(await tradelineRows(otherClient), []);
      assert.equal((await ledgerRows())[0].status, "queued",
        "a refused fulfil still closed the request");
    });

    test("the ledger and the tradelines land together or not at all", async () => {
      // fulfilSoftPull runs in one transaction. A crs id that does not exist is
      // rejected after the row is locked and before anything is written; nothing
      // may be left half-applied.
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "atomicity"
      });
      await assert.rejects(
        () => fulfilSoftPull(db, {
          requestId: request.id, crsResultId: "00000000-0000-0000-0000-000000000000"
        }),
        (e) => e instanceof SoftPullError && e.status === 404
      );
      assert.equal((await ledgerRows())[0].status, "queued");
      assert.deepEqual(await tradelineRows(), []);
    });

    test("a request cannot be fulfilled twice", async () => {
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "replay guard"
      });
      const crsId = await mkCrs(client);
      await fulfilSoftPull(db, { requestId: request.id, crsResultId: crsId });

      await assert.rejects(
        () => fulfilSoftPull(db, { requestId: request.id, crsResultId: crsId }),
        (e) => e instanceof SoftPullError && e.status === 409
      );
      assert.equal((await tradelineRows()).length, 3, "a replayed fulfil re-ingested the cards");
    });
  });

  // ── one tap is one pull ──────────────────────────────────────────────────

  describe("one tap is one pull", () => {
    test("a second tap while one is open returns the first request", async () => {
      await wipeLedger();
      const a = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "client", id: accountId },
        reason: "tapped once"
      });
      const b = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "client", id: accountId },
        reason: "tapped again a second later"
      });

      assert.equal(b.created, false);
      assert.equal(b.reason, "already_open");
      assert.equal(b.request.id, a.request.id);
      assert.equal((await ledgerRows()).length, 1,
        "a double tap recorded two consumer-credit events");
    });

    test("a replayed idempotency key returns the same row, even after the first was resolved", async () => {
      await wipeLedger();
      const a = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "network retry", idempotencyKey: "tap-abc"
      });
      await fulfilSoftPull(db, { requestId: a.request.id, crsResultId: await mkCrs(client) });

      // The retry arrives late, after the pull completed. It must still resolve
      // to the original request rather than starting a second pull.
      const b = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "network retry", idempotencyKey: "tap-abc"
      });
      assert.equal(b.created, false);
      assert.equal(b.reason, "replay");
      assert.equal(b.request.id, a.request.id);
      assert.equal((await ledgerRows()).length, 1);
    });

    test("two different clients may each have an open request at the same time", async () => {
      await wipeLedger();
      await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "one"
      });
      const other = await requestSoftPull(db, {
        orgId: org, clientId: otherClient, requestedBy: { kind: "staff", id: staffId }, reason: "two"
      });
      assert.equal(other.created, true,
        "one client's open pull blocked a different client's");
    });

    test("after a request is resolved, a new tap starts a new one", async () => {
      await wipeLedger();
      const a = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "first"
      });
      await closeSoftPull(db, { requestId: a.request.id, status: "failed", reason: "provider unavailable" });

      const b = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "second"
      });
      assert.equal(b.created, true, "a resolved request permanently blocked the client's next pull");
      assert.equal((await ledgerRows()).length, 2);
    });

    /* THE GUARD HAS TO HOLD WHEN THE TAPS ARRIVE TOGETHER, WHICH IS THE ONLY
       WAY A DOUBLE TAP ACTUALLY ARRIVES.

       The sequential test above proves the guard reads the table. It cannot
       prove the guard is atomic: "SELECT, see nothing, INSERT" is two
       statements, and two callers can both finish the SELECT before either
       reaches the INSERT. Both then see an empty table and both write. That is
       one question, two consumer-credit events and two charges.

       EACH CALLER GETS ITS OWN, ALREADY-OPEN CONNECTION (withClients below).
       Handing all three the shared pool handle does NOT reproduce this: the
       first caller has a warm connection and finishes both of its statements
       while the others are still completing a TCP connect and password
       handshake, so they never actually overlap and the test passes on a broken
       guard. A phone retrying a tap against a warm serverless pool has no such
       head start. Asserting on the ROWS, not on the return values: the return
       value is the module's account of what it did, and the row is what an
       auditor and a bill will see. */
    test("three taps at the same instant record ONE pull and bill it once", async () => {
      await wipeLedger();
      const { outs, rows } = await withClients(3, (conns) => conns.map((c) => requestSoftPull(c, {
        orgId: org, clientId: client, requestedBy: { kind: "client", id: accountId },
        reason: "portal button on a slow connection", costCents: 1500
      })));

      assert.equal(rows.length, 1,
        `three simultaneous taps recorded ${rows.length} consumer-credit events`);
      assert.equal(outs.filter((o) => o.created).length, 1,
        "more than one caller was told it had started a pull");
      assert.equal(new Set(outs.map((o) => o.request.id)).size, 1,
        "the three taps were handed different requests");

      const billed = rows.reduce((n, r) => n + Number(r.cost_cents), 0);
      assert.equal(billed, 1500, `one question billed ${billed} cents`);
    });

    test("simultaneous replays of one idempotency key resolve to one row, without erroring", async () => {
      await wipeLedger();
      // Neither caller may see a raw unique-violation: losing the race is a
      // normal outcome of a retry, not a 500 on somebody's screen.
      const { outs, rows } = await withClients(2, (conns) => conns.map((c) => requestSoftPull(c, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "the phone retried the same tap", idempotencyKey: "tap-race-1", costCents: 1500
      })));

      assert.equal(rows.length, 1, `a retried tap wrote ${rows.length} rows`);
      assert.equal(rows[0].idempotency_key, "tap-race-1");
      assert.equal(new Set(outs.map((o) => o.request.id)).size, 1,
        "the two callers were handed different requests");
      assert.equal(outs.filter((o) => o.created).length, 1);
    });

    /* THE RETRY KEY IS THE OTHER HALF OF RULE 2, AND IT IS THE HALF THE
       DATABASE ADJUDICATES ON ITS OWN INDEX.

       uq_soft_pull_requests_idem (077) is keyed (org_id, idempotency_key) —
       the CLIENT is not in it. The test above races two taps that share a key
       AND a client, so Postgres may settle it on either index and the retry
       key's own behaviour is never isolated. These two do isolate it: same org,
       same key, DIFFERENT clients, so uq_soft_pull_requests_idem is the only
       index that can fire.

       What must never happen, in either order:

         * a caller asking about client Y is handed client X's request row.
           That row says who asked for X's credit to be pulled, why, and what it
           cost — another consumer's credit-pull record, returned to somebody who
           asked about a different person.
         * Y's request is silently dropped while the caller is told `ok`. The
           screen then shows a pull in flight that no ledger row records.
         * a raw Postgres unique violation (SQLSTATE 23505) escapes. The route
           (api/finance/soft-pull.mjs) only converts SoftPullError and
           CLIENT_DATA_ERRORS, so anything else reaches netlify/functions/api.mjs
           and becomes a 500 on somebody's phone.

       A refusal is a correct answer here. Handing back the wrong person's row
       is not. */
    const crossKeyOk = (outcome, askedAbout) => {
      if (outcome.status === "rejected") {
        const e = outcome.reason;
        assert.ok(e instanceof SoftPullError,
          `a reused retry key raised a raw database error (${e && e.code}: ${e && e.message})`);
        assert.ok(e.status >= 400 && e.status < 500,
          `a reused retry key answered ${e.status} — a 5xx is a broken screen`);
        return;
      }
      assert.equal(String(outcome.value.request.client_id), String(askedAbout),
        "a caller was handed a soft pull request belonging to a different client");
    };

    test("a retry key reused for a different client is refused, not answered with that client's row", async () => {
      await wipeLedger();
      const first = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "first client, keyed tap", idempotencyKey: "tap-cross-1", costCents: 1500
      });
      assert.equal(first.created, true);

      const second = await Promise.allSettled([requestSoftPull(db, {
        orgId: org, clientId: otherClient, requestedBy: { kind: "staff", id: staffId },
        reason: "second client, same key by accident", idempotencyKey: "tap-cross-1", costCents: 1500
      })]);
      crossKeyOk(second[0], otherClient);
    });

    test("two clients tapping at the same instant under one retry key never cross", async () => {
      await wipeLedger();
      const conns = [];
      let outs;
      try {
        for (let i = 0; i < 2; i++) conns.push(await pool().connect());
        const asked = [client, otherClient];
        outs = await Promise.allSettled(conns.map((c, i) => requestSoftPull(c, {
          orgId: org, clientId: asked[i], requestedBy: { kind: "staff", id: staffId },
          reason: "two files, one retry key", idempotencyKey: "tap-cross-2", costCents: 1500
        })));
        outs.forEach((o, i) => crossKeyOk(o, asked[i]));
      } finally {
        for (const c of conns) c.release();
      }

      // Whoever won wrote exactly one row, and it is theirs.
      const written = (await db.query(
        `SELECT client_id FROM soft_pull_requests WHERE idempotency_key = 'tap-cross-2'`
      )).rows;
      assert.equal(written.length, 1, `one retry key wrote ${written.length} rows`);
    });
  });

  // ── the ledger reads back the way an audit asks the question ─────────────

  describe("the ledger answers 'why was this person's credit pulled'", () => {
    test("the history carries who, why, when, cost and the result, newest first", async () => {
      await wipeLedger();
      const first = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "closer prepping the funding call", costCents: 1200
      });
      await fulfilSoftPull(db, { requestId: first.request.id, crsResultId: await mkCrs(client) });

      await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "client", id: accountId },
        reason: "client checking their own file"
      });

      const history = await listSoftPullRequests(db, { clientId: client });
      assert.equal(history.length, 2);

      const [newest, oldest] = history;
      assert.equal(newest.requested_by_kind, "client");
      assert.equal(newest.requested_by_account_id, accountId);
      assert.equal(newest.reason, "client checking their own file");
      assert.equal(newest.status, "queued");

      assert.equal(oldest.requested_by_kind, "staff");
      assert.equal(oldest.requested_by_staff_id, staffId);
      assert.equal(oldest.reason, "closer prepping the funding call");
      assert.equal(oldest.status, "fulfilled");
      assert.ok(oldest.crs_result_id, "a fulfilled request does not say which pull answered it");
      assert.equal(oldest.cost_cents, "1200");
      assert.equal(oldest.cost_display, "12.00");
    });

    test("an unknown cost stays unknown — it is never rendered as free", async () => {
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "cost not known at request time"
      });
      const stored = await getSoftPullRequest(db, request.id);
      assert.equal(stored.cost_cents, null);
      assert.equal(stored.cost_display, null,
        "an unknown cost rendered as a number — a billing report would read it as $0.00");
    });

    test("subscription_id is carried without a foreign key to a table this build does not own", async () => {
      await wipeLedger();
      const planId = "77777777-7777-7777-7777-777777777777";
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "billed to a plan", subscriptionId: planId
      });
      assert.equal(request.subscription_id, planId,
        "the plan id did not survive — an FK to a table built in parallel would have rejected it");
    });

    test("openRequestFor tells the button whether a pull is already in flight", async () => {
      await wipeLedger();
      assert.equal(await openRequestFor(db, { clientId: client }), null);
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "in flight"
      });
      assert.equal((await openRequestFor(db, { clientId: client })).id, request.id);
      await closeSoftPull(db, { requestId: request.id, status: "cancelled", reason: "client changed their mind" });
      assert.equal(await openRequestFor(db, { clientId: client }), null);
    });

    test("a state the schema cannot hold is refused", async () => {
      // A 'sent' status would be a promise nothing in this repo can keep.
      await wipeLedger();
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests
             (org_id, client_id, requested_by_kind, requested_by_staff_id, reason, status, resolved_at)
           VALUES ($1,$2,'staff',$3,'pretending to transmit','sent', now())`, [org, client, staffId]
        ),
        (e) => /violates check constraint/.test(String(e.message))
      );
    });

    test("a failed request cannot claim a result, and a fulfilled one cannot lack it", async () => {
      await wipeLedger();
      const crsId = await mkCrs(client);
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests
             (org_id, client_id, requested_by_kind, requested_by_staff_id, reason, status, resolved_at, crs_result_id)
           VALUES ($1,$2,'staff',$3,'failed but claims an answer','failed', now(), $4)`,
          [org, client, staffId, crsId]
        ),
        (e) => /soft_pull_requests_result_ck/.test(String(e.message))
      );
      await assert.rejects(
        () => db.query(
          `INSERT INTO soft_pull_requests
             (org_id, client_id, requested_by_kind, requested_by_staff_id, reason, status, resolved_at)
           VALUES ($1,$2,'staff',$3,'fulfilled with no answer','fulfilled', now())`,
          [org, client, staffId]
        ),
        (e) => /soft_pull_requests_result_ck/.test(String(e.message))
      );
    });
  });

  // ── recordPull / getLatestPull, against the real crs_results table ────────

  describe("recording a pull", () => {
    test("a pull with no request is stored and its cards land in tradelines", async () => {
      // The paid path (diagnostic.paid -> C-00) files no ledger request. A pull
      // that happened is a fact; refusing to store it for want of paperwork
      // would lose the only copy.
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);

      const out = await recordPull(db, { orgId: org, clientId: client, result: CRS_PAYLOAD });
      assert.equal(out.request, null);
      assert.equal(out.ingested, 3);
      assert.ok(out.crsResult.id);

      const lines = await tradelineRows();
      assert.equal(lines.length, 3, `tradelines has ${lines.length} rows, not 3`);
      assert.equal(lines.find((l) => l.lender === "Amex Blue Business").credit_limit_cents, "1000000");
      assert.equal(lines.find((l) => l.lender === "Capital One Spark").apr, null,
        "a missing APR was filled in with a guess");
      assert.deepEqual(await ledgerRows(), [], "a pull with no request wrote a ledger row anyway");
    });

    test("a pull with a request closes the ledger row and ingests, atomically", async () => {
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);

      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "closer asked for a refresh"
      });
      const out = await recordPull(db, {
        orgId: org, clientId: client, requestId: request.id, result: CRS_PAYLOAD
      });

      assert.equal(out.request.status, "fulfilled");
      assert.equal(out.request.crs_result_id, out.crsResult.id);
      assert.equal(out.ingested, 3);
      assert.equal((await tradelineRows()).length, 3);
    });

    test("a pull naming an already-resolved request stores NOTHING — both halves roll back", async () => {
      // The transaction is the claim. If the crs_results row survived a failed
      // fulfil, the history would carry a pull the ledger says never completed.
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);

      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "first"
      });
      await recordPull(db, { orgId: org, clientId: client, requestId: request.id, result: CRS_PAYLOAD });
      const crsCountAfterFirst = Number((await db.query(
        `SELECT count(*) n FROM crs_results WHERE client_id = $1`, [client])).rows[0].n);

      await assert.rejects(
        () => recordPull(db, { orgId: org, clientId: client, requestId: request.id, result: CRS_PAYLOAD }),
        (e) => e instanceof SoftPullError && e.status === 409
      );

      const after = Number((await db.query(
        `SELECT count(*) n FROM crs_results WHERE client_id = $1`, [client])).rows[0].n);
      assert.equal(after, crsCountAfterFirst,
        "a refused recordPull left an orphan crs_results row behind");
    });

    test("a request cannot be closed by a pull recorded against another client", async () => {
      await wipeLedger();
      const { request } = await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "mis-join"
      });
      await assert.rejects(
        () => recordPull(db, {
          orgId: org, clientId: otherClient, requestId: request.id, result: CRS_PAYLOAD
        }),
        (e) => e instanceof SoftPullError && e.status === 409
      );
      assert.deepEqual(await tradelineRows(otherClient), [],
        "another client's cards were ingested against this request");
      assert.equal((await ledgerRows())[0].status, "queued");
    });
  });

  describe("getLatestPull", () => {
    test("null for a client who has never been pulled", async () => {
      // A fresh client, deliberately: `otherClient` picked up a crs_results row
      // from the mis-join test above, so asserting against it would prove
      // nothing about the empty case.
      const virgin = await mkClient("neverpulled");
      assert.equal(await getLatestPull(db, { clientId: virgin }), null);
    });

    test("the newest pull wins, and the tiebreak holds inside one transaction", async () => {
      // crs_results.created_at defaults to now(), which is the TRANSACTION
      // timestamp — two rows written in one transaction share it exactly. Order
      // on the timestamp alone and "the latest" is arbitrary between them.
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);

      const first = await recordPull(db, {
        orgId: org, clientId: client, result: { tradelines: [], marker: "first" }
      });
      const second = await recordPull(db, {
        orgId: org, clientId: client, result: { tradelines: [], marker: "second" }
      });

      const latest = await getLatestPull(db, { clientId: client });
      assert.ok(latest, "a client with two pulls returned none");
      assert.ok(latest.id === second.crsResult.id || latest.id === first.crsResult.id);
      assert.equal(latest.result.marker, "second",
        `getLatestPull returned the older pull (${latest.result.marker})`);
    });

    test("it returns the payload as stored and does not normalize it", async () => {
      const latest = await getLatestPull(db, { clientId: client });
      assert.ok("result" in latest, "the payload was dropped");
      assert.equal(latest.client_id, client);
    });
  });

  describe("single-write provider result coordination", () => {
    const providerId = (suffix) => `softpull-pg-${suffix}-${Date.now()}`;

    test("concurrent delivery reuses one result, then a later pull still lands", async () => {
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);
      const firstRequest = (await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "concurrent provider delivery"
      })).request;
      // Production claims before any provider write — the coordinator refuses bare queued.
      await claimSoftPull(db, { requestId: firstRequest.id, orgId: org, clientId: client });
      const firstProviderId = providerId("concurrent");

      const [a, b] = await Promise.all([
        coordinateCrsResult(db, {
          orgId: org, clientId: client, requestId: firstRequest.id,
          providerResultId: firstProviderId, result: CRS_PAYLOAD, outcomeTier: "FULL_FUNDING"
        }),
        coordinateCrsResult(db, {
          orgId: org, clientId: client, requestId: firstRequest.id,
          providerResultId: firstProviderId, result: CRS_PAYLOAD, outcomeTier: "FULL_FUNDING"
        })
      ]);

      assert.equal(a.crsResult.id, b.crsResult.id);
      assert.deepEqual([a.replayed, b.replayed].sort(), [false, true]);
      assert.equal(Number((await db.query(
        `SELECT count(*) n FROM crs_results WHERE provider = 'crs_softview' AND provider_result_id = $1`,
        [firstProviderId]
      )).rows[0].n), 1);
      assert.equal((await ledgerRows())[0].status, "fulfilled");
      assert.equal((await tradelineRows()).length, 3);

      const secondRequest = (await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "later legitimate refresh"
      })).request;
      await claimSoftPull(db, { requestId: secondRequest.id, orgId: org, clientId: client });
      const second = await coordinateCrsResult(db, {
        orgId: org, clientId: client, requestId: secondRequest.id,
        providerResultId: providerId("later"), result: CRS_PAYLOAD, outcomeTier: "FULL_FUNDING"
      });
      assert.notEqual(second.crsResult.id, a.crsResult.id);
      assert.equal((await ledgerRows()).filter((row) => row.status === "fulfilled").length, 2);
    });

    test("the same provider result cannot move to another request, client or org", async () => {
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = ANY($1)`, [[client, otherClient]]);
      const original = (await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "original"
      })).request;
      await claimSoftPull(db, { requestId: original.id, orgId: org, clientId: client });
      const resultId = providerId("ownership");
      await coordinateCrsResult(db, {
        orgId: org, clientId: client, requestId: original.id,
        providerResultId: resultId, result: CRS_PAYLOAD, outcomeTier: "FULL_FUNDING"
      });

      const later = (await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "different request"
      })).request;
      await claimSoftPull(db, { requestId: later.id, orgId: org, clientId: client });
      await assert.rejects(
        () => coordinateCrsResult(db, {
          orgId: org, clientId: client, requestId: later.id,
          providerResultId: resultId, result: CRS_PAYLOAD
        }),
        (error) => error instanceof SoftPullError && error.status === 409
      );

      const otherRequest = (await requestSoftPull(db, {
        orgId: org, clientId: otherClient, requestedBy: { kind: "staff", id: staffId }, reason: "different client"
      })).request;
      await claimSoftPull(db, { requestId: otherRequest.id, orgId: org, clientId: otherClient });
      await assert.rejects(
        () => coordinateCrsResult(db, {
          orgId: org, clientId: otherClient, requestId: otherRequest.id,
          providerResultId: resultId, result: CRS_PAYLOAD
        }),
        (error) => error instanceof SoftPullError && error.status === 409
      );
      await assert.rejects(
        () => coordinateCrsResult(db, {
          orgId: "00000000-0000-4000-8000-000000000099", clientId: client, requestId: later.id,
          providerResultId: resultId, result: CRS_PAYLOAD
        }),
        (error) => error instanceof SoftPullError && error.status === 409
      );
    });

    test("an anchored analysis event reuses the result row", async () => {
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);
      const request = (await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "event anchor"
      })).request;
      await claimSoftPull(db, { requestId: request.id, orgId: org, clientId: client });
      const coordinated = await coordinateCrsResult(db, {
        orgId: org, clientId: client, requestId: request.id,
        providerResultId: providerId("event"), result: CRS_PAYLOAD, outcomeTier: "FULL_FUNDING"
      });
      await onAnalysisCompleted({
        id: "softpull-pg-anchored-event", orgId: org, clientId: client,
        payload: { crsResultId: coordinated.crsResult.id, requestId: request.id, outcomeTier: "FULL_FUNDING" }
      }, db);
      assert.equal(Number((await db.query(
        `SELECT count(*) n FROM crs_results WHERE client_id = $1`, [client]
      )).rows[0].n), 1);
    });

    test("an ingest failure rolls back the result and request fulfillment", async () => {
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);
      const request = (await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId }, reason: "rollback proof"
      })).request;
      await claimSoftPull(db, { requestId: request.id, orgId: org, clientId: client });
      const resultId = providerId("rollback");
      const failingDb = {
        async connect() {
          const clientConn = await pool().connect();
          return {
            query(sql, params) {
              if (/INSERT INTO tradelines/.test(sql)) throw new Error("simulated tradeline failure");
              return clientConn.query(sql, params);
            },
            release() { clientConn.release(); }
          };
        }
      };

      await assert.rejects(
        () => coordinateCrsResult(failingDb, {
          orgId: org, clientId: client, requestId: request.id,
          providerResultId: resultId, result: CRS_PAYLOAD, outcomeTier: "FULL_FUNDING"
        }),
        /simulated tradeline failure/
      );
      assert.equal(Number((await db.query(
        `SELECT count(*) n FROM crs_results WHERE provider_result_id = $1`, [resultId]
      )).rows[0].n), 0);
      // Claimed before the write — a rolled-back fulfil leaves it processing, not queued.
      assert.equal((await ledgerRows())[0].status, "processing");
      assert.deepEqual(await tradelineRows(), []);
    });


    test("two real Postgres workers cannot order the same bureau request twice", async () => {
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);
      const request = (await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "two-worker provider claim collision"
      })).request;

      // Both transactions read QUEUED before either tries the real database CAS.
      // The provider is mocked, and the first fake order waits while the loser
      // has time to prove it cannot reach the provider at all.
      let reads = 0;
      let releaseReads;
      const sameSnapshot = new Promise((resolve) => { releaseReads = resolve; });
      const competingDb = {
        query: async (sql, params) => {
          if (String(sql).includes("FROM soft_pull_requests WHERE id = $1") && reads < 2) {
            const snapshot = await db.query(sql, params);
            if (++reads === 2) releaseReads();
            await sameSnapshot;
            return snapshot;
          }
          return db.query(sql, params);
        }
      };

      let releaseProvider;
      const providerHold = new Promise((resolve) => { releaseProvider = resolve; });
      let signalProviderStarted;
      const providerStarted = new Promise((resolve) => { signalProviderStarted = resolve; });
      const called = [];
      const mockCrs = {
        host: "api-sandbox.stitchcredit.com", config: { missing: [] },
        isConfigured: () => true,
        async orderPrequal({ bureau }) {
          called.push(bureau);
          if (called.length === 1) {
            signalProviderStarted();
            await providerHold;
          }
          return {
            ok: true, requestId: `PG-CLAIM-${request.id}-${bureau}`,
            report: sandboxReport("tu.json")
          };
        }
      };
      const args = {
        orgId: org, clientId: client, requestId: request.id,
        client: mockCrs, bureaus: ["TU"]
      };
      const promises = [runCrsPull(competingDb, args), runCrsPull(competingDb, args)];
      const settled = promises.map((p) => p.then(
        (value) => ({ ok: true, value }),
        (error) => ({ ok: false, error })
      ));
      try {
        await providerStarted;
        const loser = await Promise.race(settled);
        assert.equal(loser.ok, false, "only the database UPDATE winner may cross the provider fence");
        assert.equal(loser.error.status, 409);
      } finally {
        releaseProvider?.();
      }
      const outcomes = await Promise.all(settled);
      assert.equal(reads, 2);
      assert.deepEqual(called, ["TU"]);
      assert.equal(outcomes.filter((out) => out.ok).length, 1);
      assert.equal(outcomes.filter((out) => !out.ok && out.error.status === 409).length, 1);
      assert.equal((await ledgerRows())[0].status, "fulfilled");
      assert.equal(Number((await db.query(
        `SELECT count(*) n FROM crs_results WHERE client_id = $1`, [client]
      )).rows[0].n), 1);
      const stored = outcomes.find((out) => out.ok).value;
      assert.equal(Number((await db.query(
        `SELECT count(*) n FROM events WHERE client_id = $1 AND idempotency_key = $2`,
        [client, `crs-result:${stored.crsResultId}:analysis.completed:v1`]
      )).rows[0].n), 1);
    });

    test("an already processing Postgres request requires reconciliation, never redials", async () => {
      await wipeLedger();
      const request = (await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "preclaimed provider order requires review"
      })).request;
      const claimed = await claimSoftPull(db, { requestId: request.id, orgId: org, clientId: client });
      assert.equal(claimed.claimed, true);
      const calls = [];
      const mockCrs = {
        host: "api-sandbox.stitchcredit.com", config: { missing: [] },
        isConfigured: () => true,
        async orderPrequal(payload) { calls.push(payload); throw new Error("must not reach bureau"); }
      };
      await assert.rejects(
        () => runCrsPull(db, {
          orgId: org, clientId: client, requestId: request.id,
          client: mockCrs, bureaus: ["TU"]
        }),
        (error) => error instanceof SoftPullError && error.status === 409
      );
      assert.deepEqual(calls, []);
      assert.equal((await ledgerRows())[0].status, "processing");
    });

    test("runCrsPull stores one anchored row and replays before ordering again", async () => {
      await wipeLedger();
      await db.query(`DELETE FROM crs_results WHERE client_id = $1`, [client]);
      await db.query(`UPDATE clients SET outcome_tier = NULL WHERE id = $1`, [client]);
      const request = (await requestSoftPull(db, {
        orgId: org, clientId: client, requestedBy: { kind: "staff", id: staffId },
        reason: "real database CRS pull coordinator"
      })).request;
      const calls = [];
      const reports = {
        TU: sandboxReport("tu.json"),
        EX: sandboxReport("exp.json"),
        EQ: sandboxReport("efx.json")
      };
      const crsClient = {
        host: "api-sandbox.stitchcredit.com",
        config: { missing: [] },
        isConfigured: () => true,
        async orderPrequal({ bureau }) {
          calls.push(bureau);
          return {
            ok: true,
            requestId: `PG-${bureau}-${request.id}`,
            report: reports[bureau]
          };
        }
      };

      try {
        const first = await runCrsPull(db, {
          orgId: org, clientId: client, requestId: request.id, client: crsClient,
          bureaus: ["TU", "EX", "EQ"]
        });
        const replay = await runCrsPull(db, {
          orgId: org, clientId: client, requestId: request.id, client: crsClient,
          bureaus: ["TU", "EX", "EQ"]
        });

        assert.equal(first.ok, true);
        assert.ok(first.outcomeTier, "sandbox pull must produce a non-null outcome_tier");
        assert.equal(replay.replayed, true);
        assert.equal(replay.crsResultId, first.crsResultId);
        assert.equal(replay.event.deduped, true);
        assert.equal(replay.events.decision.deduped, true);
        assert.equal(replay.outcomeTier, first.outcomeTier);
        assert.deepEqual(calls, ["TU", "EX", "EQ"]);
        assert.equal(Number((await db.query(
          `SELECT count(*) n FROM crs_results WHERE client_id = $1`, [client]
        )).rows[0].n), 1);
        assert.equal((await ledgerRows())[0].status, "fulfilled");

        const stored = (await db.query(
          `SELECT result, outcome_tier FROM crs_results WHERE id = $1`, [first.crsResultId]
        )).rows[0];
        assert.deepEqual(Object.keys(stored.result.requestIds).sort(), ["EQ", "EX", "TU"]);
        assert.equal(stored.outcome_tier, first.outcomeTier);

        const clientTier = (await db.query(
          `SELECT outcome_tier FROM clients WHERE id = $1`, [client]
        )).rows[0].outcome_tier;
        assert.equal(clientTier, first.outcomeTier);

        const analysis = (await db.query(
          `SELECT name, payload FROM events WHERE client_id = $1 AND idempotency_key = $2`,
          [client, `crs-result:${first.crsResultId}:analysis.completed:v1`]
        )).rows;
        const decision = (await db.query(
          `SELECT name, payload FROM events WHERE client_id = $1 AND idempotency_key = $2`,
          [client, `crs-result:${first.crsResultId}:decision.rendered:v1`]
        )).rows;
        assert.equal(analysis.length, 1);
        assert.equal(decision.length, 1);
        assert.equal(analysis[0].name, "analysis.completed");
        assert.equal(decision[0].name, "decision.rendered");
        assert.equal(analysis[0].payload.outcomeTier, first.outcomeTier);
        assert.equal(decision[0].payload.outcomeTier, first.outcomeTier);
        assert.equal(analysis[0].payload.requestId, request.id);
        assert.equal(analysis[0].payload.crsResultId, first.crsResultId);

        const eventNames = (await db.query(
          `SELECT name FROM events
            WHERE client_id = $1
              AND idempotency_key LIKE $2
            ORDER BY name`,
          [client, `crs-result:${first.crsResultId}:%`]
        )).rows.map((r) => r.name);
        assert.deepEqual(eventNames, ["analysis.completed", "decision.rendered"]);
      } finally {
        await db.query(`DELETE FROM events WHERE client_id = $1`, [client]);
      }
    });
  });
});
