// Entitlements — what a client has bought and may therefore access.
//
// The client portal cannot gate anything without this, and a locked tile is the
// upsell surface, so "what does this client NOT have" is as much a required
// answer as "what do they have". forClient() returns both.
//
// Everything here takes a db and plain values, in the style of src/lib and
// src/http: no HTTP layer, no live Postgres needed to reason about it.
//
// IDEMPOTENCE. grantFromTransaction() is safe to replay: the unique index on
// (org_id, client_id, entitlement_code, source_transaction_id) NULLS NOT DISTINCT
// absorbs a repeat, and the insert is ON CONFLICT DO NOTHING. Re-delivering the
// same payment grants nothing new; a genuine second purchase is a different
// transaction and so a different row.
//
// A grant carrying NO transaction id is held to a stricter rule: if the client
// already actively holds the code there is nothing to add, so nothing is
// written. That is what stops one repair purchase from granting the letter pack
// twice — once from the money and once from the enrolment behind it. See
// grant() for the full account.
//
// NOTHING HARD-DELETES. revoke() stamps revoked_at. A delivered document does not
// stop having been delivered, and "was this ever active" has to stay answerable.

/* forClient and has — the portal's read and the single gate — live in src/pulse/beats/lib/entitlements-read.mjs
   (2026-10-20), unchanged, so the hourly beat client-progress reads entitlements the same way. One copy;
   imported back and re-exported here. */
import { forClient, has } from "../pulse/beats/lib/entitlements-read.mjs";

export { forClient, has };

/* grant — one entitlement, idempotent. Returns
   { granted, id, reason }; granted:false with a reason is a normal outcome. */
export async function grant(db, {
  orgId, clientId, code,
  sourceTransactionId = null, sourceEventId = null,
  grantedBy = null, reason = null, durationDays = null, now = new Date(),
  // Opt-in: resurrect a grant that was deliberately revoked. Never on a replay.
  reinstate = false
} = {}) {
  if (!orgId || !clientId || !code) {
    throw new Error("grant: orgId, clientId and code are required");
  }
  const norm = String(code).trim().toLowerCase();
  const expiresAt = durationDays
    ? new Date(now.getTime() + durationDays * 86_400_000)
    : null;

  /* A SOURCELESS GRANT ADDS NOTHING TO SOMETHING THEY ALREADY HOLD.
     Measured on production 2026-09-06: one $200 repair purchase produced TWO
     live metro2-letter-pack rows. The payment granted it through
     grantFromTransaction() carrying a real transaction id, and the enrolment
     granted it again through src/repair/enroll.mjs carrying none. Two paths,
     one fact, and because the unique index is NULLS NOT DISTINCT a NULL source
     never collides with a real transaction id, so nothing stopped it.

     A grant with no source_transaction_id is not a purchase — it is somebody
     or something asserting "this client should have this". If the client
     already actively holds the code, that assertion is already true and there
     is nothing to record. A grant that DOES carry a transaction is a distinct
     piece of money and still gets its own row (the ledger rule pinned by
     "a genuine second purchase is a second row").

     Revoked grants are deliberately not active, so this never blocks a
     re-enrolment after a chargeback: that falls through to the reinstate
     branch below, where it always belonged. */
  if (!sourceTransactionId) {
    /* Expiry and revocation are decided by the view and nowhere else, per the
       rule at the top of has(). The view carries no id, so the row is joined
       back through the four columns the unique index makes unique. */
    const live = await db.query(
      `SELECT e.id
         FROM entitlements e
         JOIN v_client_entitlements v
           ON v.org_id = e.org_id
          AND v.client_id = e.client_id
          AND v.entitlement_code = e.entitlement_code
          AND v.source_transaction_id IS NOT DISTINCT FROM e.source_transaction_id
        WHERE e.org_id = $1 AND e.client_id = $2 AND e.entitlement_code = $3
          AND v.active
        LIMIT 1`,
      [orgId, clientId, norm]
    );
    if (live.rows[0]) {
      return { granted: false, id: live.rows[0].id, reason: "already_active" };
    }
  }

  const { rows } = await db.query(
    `INSERT INTO entitlements
       (org_id, client_id, entitlement_code, source_transaction_id, source_event_id,
        granted_by, grant_reason, granted_at, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [orgId, clientId, norm, sourceTransactionId, sourceEventId,
     grantedBy, reason, now, expiresAt]
  );

  if (rows[0]) return { granted: true, id: rows[0].id, reason: null };

  /* The index absorbed it. Distinguish "already held" from "previously
     revoked".

     This used to reinstate a revoked grant unconditionally, justified as
     "a re-purchase after a revocation SHOULD reinstate". That rationale does
     not hold: a genuine re-purchase is a DIFFERENT transaction, so it carries a
     different source_transaction_id, does not conflict, and gets a fresh row —
     it never reaches this branch. The only way here is a conflict on the SAME
     transaction, i.e. a REPLAY. So the branch could not do the thing it was
     written for, and did do something harmful: a redelivered webhook silently
     resurrected access that had been deliberately revoked after a refund or a
     chargeback. It was worse still when sourceTransactionId is null, where
     IS NOT DISTINCT FROM matches every prior null-sourced grant.

     Replaying is now inert. Reinstating is a deliberate act and needs
     `reinstate: true` from a caller that means it. */
  const existing = await db.query(
    `SELECT id, revoked_at FROM entitlements
      WHERE org_id = $1 AND client_id = $2 AND entitlement_code = $3
        AND source_transaction_id IS NOT DISTINCT FROM $4`,
    [orgId, clientId, norm, sourceTransactionId]
  );
  const row = existing.rows[0];
  if (row && row.revoked_at) {
    if (!reinstate) {
      return { granted: false, id: row.id, reason: "revoked" };
    }
    await db.query(
      `UPDATE entitlements
          SET revoked_at = NULL, revoked_by = NULL, revoke_reason = NULL,
              granted_at = $2, expires_at = $3, updated_at = now()
        WHERE id = $1`,
      [row.id, now, expiresAt]
    );
    return { granted: true, id: row.id, reason: "reinstated" };
  }
  return { granted: false, id: row ? row.id : null, reason: "already_granted" };
}

/* grantFromTransaction — the purchase path. Looks the product's entitlements up
   in configuration and grants each one.

   Returns { productCode, granted: [...codes], skipped: [...], unmapped, reason }.
   `unmapped` is the important one: a product with NO configured entitlements is
   not an error here, it is an unanswered offer question
   (032_entitlements.sql shipped product_entitlements empty on purpose;
   180_product_entitlements_seed.sql fills in only the pairs shipped code can
   defend, and deliberately leaves the rest empty). The caller reports it rather
   than guessing a mapping.

   `reason` exists because "unmapped" was TRUE and INVISIBLE. Refusing to guess
   is right; refusing to guess in silence is not — money landed, the portal
   stayed locked, and nobody could see why. The reason string is what a caller
   logs and a test asserts. src/handlers/money-chain.mjs surfaces it on every
   purchase path; unmappedProducts() below is the same gap as a report. */
export async function grantFromTransaction(db, {
  orgId, clientId, transactionId, productCode, sourceEventId = null, now = new Date()
} = {}) {
  if (!orgId || !clientId || !productCode) {
    throw new Error("grantFromTransaction: orgId, clientId and productCode are required");
  }
  const code = String(productCode).trim().toLowerCase();

  const { rows: mapped } = await db.query(
    `SELECT entitlement_code, duration_days
       FROM product_entitlements
      WHERE org_id = $1 AND lower(btrim(product_code)) = $2`,
    [orgId, code]
  );

  if (!mapped.length) {
    return {
      productCode: code, granted: [], skipped: [],
      unmapped: true, reason: "no_mapping"
    };
  }

  const granted = [], skipped = [];
  for (const m of mapped) {
    const r = await grant(db, {
      orgId, clientId, code: m.entitlement_code,
      sourceTransactionId: transactionId, sourceEventId,
      durationDays: m.duration_days, now,
      reason: `purchase:${code}`
    });
    (r.granted ? granted : skipped).push(m.entitlement_code);
  }
  return { productCode: code, granted, skipped, unmapped: false, reason: null };
}

/* THE STATUS A TRANSACTION CARRIES WHEN THE MONEY ARRIVED.
   src/handlers/client-lifecycle.mjs recordTransaction() writes exactly
   'succeeded' or 'failed', src/slo/purchase.mjs writes 'succeeded' literally,
   and nothing anywhere UPDATEs transactions.status afterwards — a refund is a
   separate event that voids the partner accrual and deliberately leaves the
   entitlement standing (src/handlers/money-chain.mjs: "A refunded course is
   still unlocked"). So this one value is the whole set, and it is a constant
   rather than a string typed twice. */
export const PAID_TRANSACTION_STATUS = "succeeded";

/* reconcileFromTransactions — make the ledger agree with the mapping table.
 *
 * WHY THIS HAS TO EXIST AT ALL. product_entitlements is a LOOKUP. It is read
 * once, at the moment a payment is processed, and the answer is written into the
 * entitlements ledger. Adding a row to the lookup afterwards therefore unlocks
 * NOBODY who has already paid — their grant was written from the mapping as it
 * stood that day and is never consulted again.
 *
 * That is not a theory. Measured on production 2026-09-17:
 * 383_blueprint_entitlement.sql mapped 'consulting-package' to
 * 'credit-optimization-roadmap' at 23:13. Sim Eleven-Blueprint's $5,000 payment
 * had been granted at 17:46 the same day. The row was there, the ledger was not,
 * and his Capital Blueprint tile was still locked.
 *
 * WHAT IT DOES. Walks every succeeded transaction, resolves the product the way
 * the money chain resolves it — through products.name and product_aliases, never
 * through the dollar amount (Hard Rule 4) — and re-runs the ordinary purchase
 * grant for it.
 *
 * ADDITIVE, AND NOT NEGOTIABLY SO. It calls grantFromTransaction(), so it is the
 * same code path a live payment takes and it inherits every rule that path
 * already has:
 *   * a grant that already exists conflicts on
 *     (org, client, code, source_transaction_id) and does nothing;
 *   * a grant somebody deliberately REVOKED is NOT resurrected — grant() only
 *     reinstates when a caller passes `reinstate: true`, and this one never
 *     does, so a refund or chargeback that was acted on stays acted on;
 *   * a product with no mapping grants nothing and is reported, never guessed.
 * Nothing is deleted, nothing is revoked, nothing is rewritten. Running it twice
 * changes nothing the first run did not.
 *
 * Scope it to one client with `clientId`, or leave it out for the whole org.
 * Returns { scanned, granted, byClient, unmapped, unresolved } — `unmapped` and
 * `unresolved` being the two honest gaps: a product nobody has mapped, and a
 * product_name that matches no product or alias at all.
 */
export async function reconcileFromTransactions(db, {
  orgId, clientId = null, now = new Date()
} = {}) {
  if (!orgId) throw new Error("reconcileFromTransactions: orgId is required");

  /* resolve_product_id() is the shipped resolver (db/migrations/010_products.sql)
     — current product name first, then any alias. A transaction whose
     product_name matches neither is counted below and left alone: inventing a
     product for it would be guessing what somebody bought. */
  const { rows } = await db.query(
    `SELECT t.id AS transaction_id,
            t.client_id,
            t.product_name,
            p.code AS product_code
       FROM transactions t
       LEFT JOIN products p ON p.id = resolve_product_id(t.org_id, t.product_name)
      WHERE t.org_id = $1
        AND lower(btrim(COALESCE(t.status, ''))) = $3
        AND t.client_id IS NOT NULL
        AND ($2::uuid IS NULL OR t.client_id = $2::uuid)
      ORDER BY t.created_at`,
    [orgId, clientId, PAID_TRANSACTION_STATUS]
  );

  const out = {
    scanned: rows.length,
    granted: [],
    byClient: {},
    unmapped: [],
    unresolved: []
  };

  for (const r of rows) {
    if (!r.product_code) {
      out.unresolved.push({
        transactionId: r.transaction_id,
        clientId: r.client_id,
        productName: r.product_name
      });
      continue;
    }
    const res = await grantFromTransaction(db, {
      orgId,
      clientId: r.client_id,
      transactionId: r.transaction_id,
      productCode: r.product_code,
      now
    });
    if (res.unmapped) {
      if (!out.unmapped.includes(res.productCode)) out.unmapped.push(res.productCode);
      continue;
    }
    for (const code of res.granted) {
      out.granted.push({
        clientId: r.client_id,
        transactionId: r.transaction_id,
        productCode: res.productCode,
        entitlementCode: code
      });
      const key = String(r.client_id);
      (out.byClient[key] ||= []).push(code);
    }
  }
  return out;
}

/* revoke — stamp it, never remove it. */
export async function revoke(db, {
  orgId, clientId, code, by = null, reason = null, now = new Date()
} = {}) {
  const { rows } = await db.query(
    `UPDATE entitlements
        SET revoked_at = $4, revoked_by = $5, revoke_reason = $6, updated_at = now()
      WHERE org_id = $1 AND client_id = $2 AND entitlement_code = $3
        AND revoked_at IS NULL
      RETURNING id`,
    [orgId, clientId, String(code).trim().toLowerCase(), now, by, reason]
  );
  return { revoked: rows.length, ids: rows.map((r) => r.id) };
}

/* catalog — the grantable things, for an admin screen and for the portal's
   locked tiles when a client has no grants at all. */
export async function catalog(db, { orgId, includeInactive = false } = {}) {
  const { rows } = await db.query(
    `SELECT code, name, description, kind, sort_order, active
       FROM entitlement_catalog
      WHERE org_id = $1 ${includeInactive ? "" : "AND active = true"}
      ORDER BY sort_order, code`,
    [orgId]
  );
  return rows;
}

/* unmappedProducts — the reporting surface for the gap 032 leaves open: which
   sellable products grant nothing yet. An ops screen should show this, because
   until it is empty the portal cannot gate on a purchase. */
export async function unmappedProducts(db, { orgId } = {}) {
  const { rows } = await db.query(
    `SELECT p.code, p.name
       FROM products p
      WHERE p.org_id = $1
        AND NOT EXISTS (
          SELECT 1 FROM product_entitlements pe
           WHERE pe.org_id = p.org_id
             AND lower(btrim(pe.product_code)) = lower(btrim(p.code))
        )
      ORDER BY p.sort_order, p.code`,
    [orgId]
  );
  return rows;
}
