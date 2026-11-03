// Client erasure — de-identify a person on an explicit request, and leave behind
// a record that can answer "what did you remove, what do you still hold, and why".
//
// ============================================================================
// 1. THIS NEVER RUNS BY ITSELF. NOT EVER.
// ============================================================================
//
// There is no scheduler here, no retention sweep, no TTL, no "clean up clients
// older than N" job, and none may be added. eraseClient() is called from one
// place — an authenticated endpoint, by a named human, with a written reason —
// and it writes an audit row before it touches anything.
//
// The reason this rule is absolute rather than cautious: automatic erasure of a
// consumer-finance record is indistinguishable, after the fact, from data loss.
// Nobody asked, nobody signed it, and the evidence that it was deliberate is the
// same evidence that would be missing if it were a bug.
//
// ============================================================================
// 2. DE-IDENTIFY, DO NOT DELETE. TWO REASONS, BOTH LOAD-BEARING.
// ============================================================================
//
// (a) THE DATABASE WOULD REFUSE ANYWAY. pii_access_log.client_id references
//     clients(id) with NO cascade (001_init). A hard DELETE of a client with any
//     access-log history is rejected by Postgres. Building an erasure around a
//     delete would mean it works in testing, where nobody read the SSN, and
//     fails in production, where somebody did.
//
// (b) A HARD DELETE IS THE ORPHAN BUG. Deleting the clients row nulls
//     bank_transactions.client_id and cascades bank_accounts away, leaving
//     financial history that nothing can find — exactly what migration 101
//     exists to prevent. An erasure implemented as a delete would MANUFACTURE
//     unfindable personal data while reporting success. That is the worst
//     available outcome: not erased, not auditable, and recorded as done.
//
// So: the identifying values are removed, the row and its uuid stay. The uuid
// stops being an identifier and becomes a pseudonym — it no longer resolves to a
// name, an email, a phone number, an SSN or a date of birth, because none of
// those are there any more. That is what de-identification is, and it is the only
// form of erasure that leaves an auditable trail of itself.
//
// ============================================================================
// 3. WHAT IS KEPT, AND WHY IT IS KEPT — THE HARD HALF
// ============================================================================
//
// Recording what was deleted is easy. The question that gets asked later is
// "you say you erased me; what do you still hold?" KEPT_WITH_REASON below is
// that answer, written down, and every entry lands in the audit row.
//
// *** CRS AND THE SOFT-PULL LEDGER ARE NOT TOUCHED BY THIS MODULE. *** Not
// scrubbed, not nulled, not counted as removed. crs_results, tradelines and
// soft_pull_requests are a live, compliant credit path with its own retention
// obligations under FCRA, and taking a de-identification pass through them is a
// change to a working compliance system that needs its own review, its own
// sign-off, and somebody who owns that path. They are declared KEPT with the
// reason stated. Declaring them is the honest move; quietly editing them is not.
//
// ============================================================================
// 4. ORDER OF OPERATIONS, ALL IN ONE TRANSACTION
// ============================================================================
//
//   1. Resolve the client, scoped to the caller's org. Fail closed.
//   2. Count everything, before anything changes.
//   3. Write the audit row with both manifests.
//   4. Remove and scrub.
//
// If any step fails the whole thing rolls back, including the audit row. A
// half-applied erasure is the one outcome that must not be reachable: it looks
// exactly like a completed one and it is not.

import { withTransaction } from "../db/with-transaction.mjs";

export class ErasureError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "ErasureError";
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());

/* KEPT_WITH_REASON — what this product retains after an erasure, and on what
   basis. Section 3.

   *** OWNER-APPROVED 2026-07-31, AS WRITTEN. *** The owner reviewed this list and
   signed it off; it is a settled decision, not a draft awaiting review. CLAUDE.md
   §7 is the governing rule ("flagged changes ship only after explicit human
   approval") and that approval has been given, so this list does not need
   re-flagging on every change that touches it.
   Recorded on the board at ops/workflows/fundhub-beta-buildout.md.

   WHAT WOULD REOPEN IT: adding a table to this list, removing one, or changing
   what a reason claims. The approval covers the list below as it stands — it is
   not a standing waiver on the concept of retention.

   These are written out as constants rather than composed at the call site so
   that every audit row for every client carries the same sentence. Two audit
   rows whose wording differs invite the reader to wonder whether the policy
   differed. Migration 102 requires every reason to be at least 20 characters,
   which is the floor, not the target. */
export const KEPT_WITH_REASON = Object.freeze({
  bank_transactions:
    "Financial record of money that actually moved. Retained as evidence of " +
    "transactions with amounts and dates intact; the merchant name and the raw " +
    "provider payload have been scrubbed from every row because those describe " +
    "where the person shops and what they buy. Linked only by pseudonymous id.",

  crs_results:
    "Consumer credit report data obtained under a permissible purpose. Retained " +
    "under FCRA record-keeping obligations. This module does not modify the CRS " +
    "path; removing this data is a separate decision requiring compliance review " +
    "by the owner of that system.",

  tradelines:
    "Credit file lines derived from a consumer report, subject to the same FCRA " +
    "record-keeping obligations as crs_results. Not modified by this module; " +
    "removal requires compliance review by the owner of the credit path.",

  soft_pull_requests:
    "The credit-pull ledger: the record of who requested a consumer report about " +
    "this person, when, and for what stated purpose. This IS the permissible- " +
    "purpose audit trail; erasing it would destroy the evidence that each pull " +
    "was authorised.",

  pii_access_log:
    "The record of every employee who viewed this person's identity data. " +
    "Deleting it would erase the accountability trail for past access at the " +
    "moment it is most likely to be needed. The identity values themselves are " +
    "removed; the record that they were read is retained.",

  transactions:
    "Payments made to this business and refunds issued. Retained as required " +
    "business financial records for tax and accounting purposes.",

  invoices:
    "Billing records for services provided. Retained as required business " +
    "financial records for tax and accounting purposes.",

  commission_ledger:
    "Internal commission accounting derived from this client's transactions. " +
    "Retained as a business financial record; it describes payments to staff, " +
    "not the client's own identity.",

  erasure_requests:
    "This audit record itself, and any earlier one for the same person. It is " +
    "the proof the erasure was performed, who authorised it and what it covered. " +
    "It must outlive its subject or the erasure cannot be demonstrated."
});

/* The placeholder written over an identifying text field. One value, used
   everywhere, and deliberately not an empty string: a blank field is
   indistinguishable from one that was never filled in, and an auditor reading
   this row should be able to tell "erased" from "we never knew". */
const ERASED = "[erased]";

/**
 * eraseClient(db, { orgId, clientId, requestedBy, reason }) →
 *   { erased, auditId, removed[], kept[] }
 *
 * ORG SCOPING COMES FROM THE SESSION AND FAILS CLOSED. `orgId` is staff.org_id,
 * and it is in the WHERE clause — a client in another org is not found, and the
 * caller learns nothing about whether it exists. A missing orgId throws rather
 * than matching every org.
 */
export async function eraseClient(db, { orgId, clientId, requestedBy, reason } = {}) {
  if (!isUuid(orgId)) throw new ErasureError("orgId must be a uuid", { status: 400 });
  if (!isUuid(clientId)) throw new ErasureError("clientId must be a uuid", { status: 400 });

  const label = requestedBy && typeof requestedBy.label === "string" ? requestedBy.label.trim() : "";
  if (!label) {
    throw new ErasureError("requestedBy.label is required — an unattributed erasure is not auditable", { status: 400 });
  }
  const why = typeof reason === "string" ? reason.trim() : "";
  if (why.length < 10) {
    throw new ErasureError("reason is required and must say something — at least 10 characters", { status: 400 });
  }

  const org = String(orgId).trim();
  const client = String(clientId).trim();

  return withTransaction(db, async (tx) => {
    // 1. Resolve, org-scoped, and hold the row.
    const row = (await tx.query(
      `SELECT id, org_id FROM clients WHERE id = $1 AND org_id = $2 FOR UPDATE`,
      [client, org]
    )).rows[0];

    if (!row) throw new ErasureError("client not found", { status: 404 });

    // 2. Count everything BEFORE changing it. A manifest built afterwards counts
    //    what survived, which is a different and much less useful number.
    const one = async (sql, params) =>
      Number((await tx.query(sql, params)).rows[0].n);

    const identityCount = await one(
      `SELECT count(*)::bigint AS n FROM pii_identity WHERE client_id = $1`, [client]);

    const itemRows = (await tx.query(
      `SELECT id FROM plaid_items WHERE client_id = $1 AND org_id = $2`, [client, org])).rows;
    const itemIds = itemRows.map((r) => r.id);

    const accountCount = await one(
      `SELECT count(*)::bigint AS n FROM bank_accounts WHERE client_id = $1 AND org_id = $2`, [client, org]);

    // The ledger is found by the DURABLE ANCHOR (migration 101), not by
    // client_id. That is the entire point of 101: if this person's client row
    // had ever been hard-deleted, client_id would be NULL on every one of these
    // rows and this count would be zero while the data sat there. Searching the
    // anchor finds them either way.
    const txnCount = await one(
      `SELECT count(*)::bigint AS n FROM bank_transactions
        WHERE org_id = $1 AND (subject_client_id = $2 OR client_id = $2)`, [org, client]);

    const keptCounts = {
      crs_results: await one(
        `SELECT count(*)::bigint AS n FROM crs_results WHERE client_id = $1`, [client]),
      tradelines: await one(
        `SELECT count(*)::bigint AS n FROM tradelines WHERE client_id = $1`, [client]),
      soft_pull_requests: await one(
        `SELECT count(*)::bigint AS n FROM soft_pull_requests WHERE client_id = $1`, [client]),
      pii_access_log: await one(
        `SELECT count(*)::bigint AS n FROM pii_access_log WHERE client_id = $1`, [client]),
      transactions: await one(
        `SELECT count(*)::bigint AS n FROM transactions WHERE client_id = $1`, [client]),
      invoices: await one(
        `SELECT count(*)::bigint AS n FROM invoices WHERE client_id = $1`, [client]),
      commission_ledger: await one(
        `SELECT count(*)::bigint AS n FROM commission_ledger WHERE client_id = $1`, [client]),
      erasure_requests: await one(
        `SELECT count(*)::bigint AS n FROM erasure_requests WHERE subject_client_id = $1`, [client])
    };

    const removed = [
      { table: "clients", rows: 1,
        detail: "name, email, phone and all custom fields overwritten; the row and its id are retained as a pseudonym" },
      { table: "pii_identity", rows: identityCount,
        detail: "social security number, date of birth and address history deleted outright" },
      { table: "plaid_items", rows: itemIds.length,
        detail: "bank logins and their stored access tokens deleted" },
      { table: "bank_accounts", rows: accountCount,
        detail: "bank accounts, balances and account-number masks, removed by cascade from plaid_items and clients" },
      { table: "bank_transactions", rows: txnCount,
        detail: "merchant names and raw provider payloads scrubbed from every row; the rows themselves are retained — see kept" }
    ];

    const kept = [
      { table: "bank_transactions", rows: txnCount, reason: KEPT_WITH_REASON.bank_transactions },
      { table: "crs_results", rows: keptCounts.crs_results, reason: KEPT_WITH_REASON.crs_results },
      { table: "tradelines", rows: keptCounts.tradelines, reason: KEPT_WITH_REASON.tradelines },
      { table: "soft_pull_requests", rows: keptCounts.soft_pull_requests, reason: KEPT_WITH_REASON.soft_pull_requests },
      { table: "pii_access_log", rows: keptCounts.pii_access_log, reason: KEPT_WITH_REASON.pii_access_log },
      { table: "transactions", rows: keptCounts.transactions, reason: KEPT_WITH_REASON.transactions },
      { table: "invoices", rows: keptCounts.invoices, reason: KEPT_WITH_REASON.invoices },
      { table: "commission_ledger", rows: keptCounts.commission_ledger, reason: KEPT_WITH_REASON.commission_ledger },
      { table: "erasure_requests", rows: keptCounts.erasure_requests + 1, reason: KEPT_WITH_REASON.erasure_requests }
    ];

    // 3. AUDIT FIRST, same transaction. If this insert fails — a reason too short,
    //    a kept entry without a written reason, any CHECK in 102 — nothing below
    //    runs and nothing is removed.
    const audit = (await tx.query(
      `INSERT INTO erasure_requests
         (org_id, kind, subject_client_id, subject_item_id,
          requested_by_staff_id, requested_by_label, reason,
          status, removed, kept, completed_at)
       VALUES ($1, 'client_erasure', $2, NULL, $3, $4, $5, 'completed', $6::jsonb, $7::jsonb, now())
       RETURNING id, created_at`,
      [
        org,
        client,
        isUuid(requestedBy?.staffId) ? String(requestedBy.staffId).trim() : null,
        label,
        why,
        JSON.stringify(removed),
        JSON.stringify(kept)
      ]
    )).rows[0];

    // 4. Now do it.

    // The identity record goes outright. There is no de-identified form of a
    // social security number, so there is nothing to preserve.
    await tx.query(`DELETE FROM pii_identity WHERE client_id = $1`, [client]);

    // Stop any in-flight bank connection. The consent text and timestamp stay
    // as an audit receipt; routine session cleanup must not erase them.
    await tx.query(
      `UPDATE account_plaid_link_grants
          SET consumed_at = COALESCE(consumed_at, now())
        WHERE org_id = $1 AND target_kind = 'client_bank' AND target_id = $2
          AND consumed_at IS NULL`,
      [org, client]
    );

    // Bank logins and their credentials. bank_accounts cascades from here (081).
    await tx.query(`DELETE FROM plaid_items WHERE client_id = $1 AND org_id = $2`, [client, org]);

    // Any hand-entered account not attached to a login — plaid_item_id IS NULL,
    // so the cascade above did not reach it. Missing this would leave account
    // names and balance history behind on exactly the rows a human typed in.
    await tx.query(`DELETE FROM bank_accounts WHERE client_id = $1 AND org_id = $2`, [client, org]);

    // The ledger STAYS, scrubbed of the parts that describe the person rather
    // than the money. Found by the anchor OR client_id — see the count above.
    // subject_client_id is deliberately left in place: it is now a pseudonymous
    // key, it is what made this row findable at all, and clearing it would
    // recreate the orphan this batch exists to fix.
    await tx.query(
      `UPDATE bank_transactions
          SET merchant_name = NULL,
              raw = '{}'::jsonb,
              updated_at = now()
        WHERE org_id = $1 AND (subject_client_id = $2 OR client_id = $2)`,
      [org, client]
    );

    // The client record itself: identifiers out, row and id retained.
    // custom_fields is reset wholesale rather than key-by-key — it is a free-form
    // bag of 252 ported CRM fields and enumerating which of them are identifying
    // is a guess. Emptying it is the only answer that is right without knowing.
    await tx.query(
      `UPDATE clients
          SET first_name    = $3,
              last_name     = $3,
              email         = NULL,
              phone         = NULL,
              ghl_contact_id = NULL,
              custom_fields = '{}'::jsonb,
              tags          = '{}',
              updated_at    = now()
        WHERE id = $1 AND org_id = $2`,
      [client, org, ERASED]
    );

    return { erased: true, auditId: audit.id, clientId: client, removed, kept };
  });
}

/**
 * listErasureRequests(db, { orgId, clientId, limit }) → rows
 *
 * "What has been done about this person." Org-scoped and fails closed. Answers
 * after the subject is erased, which is why 102's subject_client_id is not a
 * foreign key.
 */
export async function listErasureRequests(db, { orgId, clientId = null, limit = 100 } = {}) {
  if (!isUuid(orgId)) throw new ErasureError("orgId must be a uuid", { status: 400 });
  if (clientId !== null && !isUuid(clientId)) {
    throw new ErasureError("clientId must be a uuid", { status: 400 });
  }

  const bounded = Math.max(1, Math.min(Number(limit) || 100, 500));
  const params = [String(orgId).trim()];
  let where = `org_id = $1`;
  if (clientId !== null) {
    params.push(String(clientId).trim());
    where += ` AND subject_client_id = $2`;
  }
  params.push(bounded);

  const res = await db.query(
    `SELECT id, kind, subject_client_id, subject_item_id,
            requested_by_staff_id, requested_by_label, reason,
            status, removed, kept, completed_at, failure_reason, created_at
       FROM erasure_requests
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  );
  return res.rows;
}

export default { eraseClient, listErasureRequests, ErasureError, KEPT_WITH_REASON };
