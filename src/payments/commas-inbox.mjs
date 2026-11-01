/* The Commas inbox — persistence and draining for the payment queue.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PROPERTY THIS FILE EXISTS FOR.
 *
 * Commas delivers AT MOST ONCE. No retries, ever. A delivery that fails on
 * their side is logged and dropped, and we are never told. So there is exactly
 * one moment where a payment can be lost: between the bytes arriving and
 * something durable recording them. Every line here is about making that
 * moment as short and as boring as possible — one INSERT of the exact bytes,
 * then answer.
 *
 * Everything after that INSERT is retryable, which is the whole point. A
 * handler that throws, a database blip during the money chain, a function
 * killed by its wall-clock limit — none of them lose the payment, because the
 * row is already there and the next sweep picks it up.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS MODULE DOES NOT IMPORT THE ADAPTER.
 *
 * Draining takes the row processor as an argument rather than importing
 * processCommasInboxRow from commas.mjs. commas.mjs imports `enqueue` from
 * here to write the row, so importing back the other way is a cycle. The
 * sweeper is where the two are joined. It also means this file is testable
 * with a two-line fake processor and no event bus at all.
 */

import crypto from "node:crypto";

/* How many times a row is retried before it is left alone.
 *
 * NOT unlimited. A payload that makes a handler throw deterministically will
 * throw on every pass forever, and an inbox that retries it every minute
 * turns one bad payment into a permanent error-log flood that hides the next
 * real failure. Ten passes is roughly twenty minutes of retrying, which
 * covers every transient cause (a database restart, a deploy, a lock).
 *
 * A row that exhausts its attempts stays `failed` WITH ITS BYTES INTACT. It is
 * not deleted and not marked done. Recovering it is a human decision, and
 * `last_error` is there to make that decision possible. */
export const MAX_ATTEMPTS = 10;

/* A row claimed but never finished is a row whose function died mid-pass.
 * After this long it is fair game again. Longer than any realistic pass,
 * short enough that a stranded payment is minutes late rather than lost. */
export const STALE_CLAIM_MINUTES = 15;

/* dedupeKeyFor — what makes a re-delivery a no-op.
 *
 * KEYED ON THE PAYMENT, NOT THE ENVELOPE. Commas documents `data.payment_id`
 * as the idempotency anchor and the envelope `id` as per-DELIVERY. Keying on
 * the envelope would mean two deliveries of one payment carry two different
 * keys, both look new, and the money is counted twice — which is the exact
 * failure the old adapter had.
 *
 * Refunds have their own stable data.refund_id (https://apidocs.fan/,
 * refund.created schema). One payment can have several partial refunds, so
 * payment_id alone must not collapse them. Keep payment keys unchanged.
 *
 * The event type is part of the key because one payment legitimately produces
 * several events over its life: succeeded, then later refund.created, then
 * later dispute.created. Those must not collapse into each other.
 *
 * NO PAYMENT ID: fall back to a hash of the exact bytes. A re-delivery is
 * byte-identical by definition, so it still dedupes. Two genuinely distinct
 * payments would have to be byte-identical to collide, which would mean no id,
 * no timestamp and no reference anywhere in the body — a payload nothing could
 * deduplicate by any means. */
export function isSettledRefund(eventType, status) {
  const type = String(eventType || "").toLowerCase();
  const state = String(status || "").trim().toLowerCase();
  if (!["refund.created", "refund.succeeded", "payment.refunded"].includes(type)) return false;
  // refund.created requires the documented settled status. Preserve terminal
  // legacy event names only when no contradictory status was supplied.
  return ["success", "succeeded"].includes(state) ||
    (!state && ["refund.succeeded", "payment.refunded"].includes(type));
}

export function dedupeKeyFor({ paymentId, refundId, refundStatus, eventType, rawBody }) {
  const type = String(eventType || "unknown");
  if (type.includes("refund")) {
    const settled = isSettledRefund(type, refundStatus);
    if (refundId && settled) return `refund:${refundId}:settled`;
    // A pending/failed delivery must not consume the eventual settlement key.
    const state = String(refundStatus || "unknown").trim().toLowerCase();
    if (refundId) return `refund:${refundId}:${type}:unsettled:${state}`;
    if (paymentId && !settled) return `${paymentId}:${type}:unsettled:${state}`;
  }
  if (paymentId) return `${paymentId}:${type}`;
  const hash = crypto.createHash("sha256").update(rawBody || "").digest("hex");
  return `body:${hash}:${type}`;
}

/* enqueue — the only thing that happens before the 200.
 *
 * Returns { id, deduped }. `deduped: true` means this exact payment+event is
 * already in the queue; the caller still answers 200, because from the
 * provider's point of view the delivery succeeded and telling them otherwise
 * would achieve nothing (they do not retry).
 *
 * ON CONFLICT DO NOTHING against commas_inbox_dedupe_uniq is what makes two
 * simultaneous deliveries safe. The SELECT below it is only for reporting the
 * existing id back. */
export async function enqueue(db, {
  orgId,
  rawBody,
  headers = {},
  paymentId = null,
  refundId = null,
  refundStatus = null,
  eventType = null,
  source = "webhook"
} = {}) {
  if (!orgId) throw new Error("commas inbox enqueue: orgId is required");
  if (rawBody == null) throw new Error("commas inbox enqueue: rawBody is required");

  const dedupeKey = dedupeKeyFor({ paymentId, refundId, refundStatus, eventType, rawBody });

  // Before refund_id keys existed, these same callbacks were saved under a
  // payment/body key. Recognize those immutable rows on replay rather than
  // emitting a second refund under the new key. Parse in JS: malformed inbox
  // bytes are deliberately retained and must not break a JSON cast in SQL.
  if (refundId && String(eventType || "").includes("refund")) {
    const legacy = await db.query(
      `SELECT id, raw_body, dedupe_key FROM commas_inbox
        WHERE org_id = $1 AND event_type LIKE '%refund%'
          AND dedupe_key NOT LIKE 'refund:%'`,
      [orgId]
    );
    for (const row of legacy.rows) {
      try {
        const body = JSON.parse(row.raw_body);
        const data = (body?.data && (body.data.object || body.data)) || body;
        if (typeof data?.refund_id === "string" && data.refund_id.trim() === refundId) {
          return { id: row.id, deduped: true, dedupeKey: row.dedupe_key };
        }
      } catch { /* Retain malformed legacy bytes; they cannot prove identity. */ }
    }
  }

  const ins = await db.query(
    `INSERT INTO commas_inbox
       (org_id, dedupe_key, payment_id, event_type, raw_body, headers, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (org_id, dedupe_key) DO NOTHING
     RETURNING id`,
    [orgId, dedupeKey, paymentId, eventType, rawBody, headers, source]
  );

  if (ins.rows[0]) return { id: ins.rows[0].id, deduped: false, dedupeKey };

  const existing = await db.query(
    `SELECT id FROM commas_inbox WHERE org_id = $1 AND dedupe_key = $2 LIMIT 1`,
    [orgId, dedupeKey]
  );
  return { id: existing.rows[0]?.id ?? null, deduped: true, dedupeKey };
}

/* claim — take up to `limit` rows for this pass.
 *
 * FOR UPDATE SKIP LOCKED is what lets two sweeper invocations overlap without
 * either working the other's rows or blocking on them. Netlify can and does
 * start a scheduled function before the previous one has finished.
 *
 * Stale 'processing' rows are swept back in. See STALE_CLAIM_MINUTES. */
export async function claim(db, { limit = 50, maxAttempts = MAX_ATTEMPTS } = {}) {
  const { rows } = await db.query(
    `UPDATE commas_inbox
        SET status = 'processing',
            attempts = attempts + 1,
            claimed_at = now()
      WHERE id IN (
        SELECT id FROM commas_inbox
         WHERE attempts < $1
           AND (
             status IN ('pending', 'failed')
             OR (status = 'processing'
                 AND claimed_at < now() - ($2 || ' minutes')::interval)
           )
         ORDER BY received_at ASC
         LIMIT $3
         FOR UPDATE SKIP LOCKED
      )
      RETURNING *`,
    [maxAttempts, String(STALE_CLAIM_MINUTES), limit]
  );
  return rows;
}

export async function markDone(db, id) {
  await db.query(
    `UPDATE commas_inbox
        SET status = 'done', processed_at = now(), last_error = NULL
      WHERE id = $1`,
    [id]
  );
}

/* 'ignored' is a terminal SUCCESS — a well-formed event of a type we
   deliberately do not act on. Kept distinct from 'done' so the sweeper's
   counts stay honest about what actually moved money. */
export async function markIgnored(db, id, reason = null) {
  await db.query(
    `UPDATE commas_inbox
        SET status = 'ignored', processed_at = now(), last_error = $2
      WHERE id = $1`,
    [id, reason ? String(reason).slice(0, 500) : null]
  );
}

export async function markFailed(db, id, error) {
  await db.query(
    `UPDATE commas_inbox
        SET status = 'failed', last_error = $2
      WHERE id = $1`,
    [id, String(error?.message || error || "unknown").slice(0, 500)]
  );
}

/* seenPaymentIds — which of these payment ids are already in the inbox.
 *
 * The reconciliation poll's filter: it lists recent payments from the Commas
 * API and only enqueues the ones no webhook ever brought us. Returns a Set. */
export async function seenPaymentIds(db, { orgId, paymentIds = [] } = {}) {
  if (!orgId || paymentIds.length === 0) return new Set();
  const { rows } = await db.query(
    `SELECT DISTINCT payment_id FROM commas_inbox
      WHERE org_id = $1 AND payment_id = ANY($2::text[])`,
    [orgId, paymentIds.map(String)]
  );
  return new Set(rows.map((r) => r.payment_id));
}

/* drain — one pass. `process(row, db)` returns { ok, ignored?, reason? }.
 *
 * NEVER THROWS on a single bad row. One payload that breaks a handler must not
 * stop the twenty good payments queued behind it; that would turn one lost
 * payment into twenty. The row is marked failed with its error and the pass
 * continues.
 *
 * A THROW FROM THE DATABASE ITSELF still propagates, because at that point the
 * queue is not working and the caller needs to know rather than be told the
 * pass succeeded with zero rows. */
export async function drain(db, { limit = 50, maxBatches = 5, process } = {}) {
  if (typeof process !== "function") {
    throw new TypeError("commas inbox drain: a process(row, db) function is required");
  }

  const counts = { done: 0, ignored: 0, failed: 0 };
  let claimed = 0;
  let batches = 0;

  while (batches < maxBatches) {
    const rows = await claim(db, { limit });
    batches += 1;
    if (rows.length === 0) break;
    claimed += rows.length;

    for (const row of rows) {
      try {
        const res = await process(row, db);
        if (res && res.ignored) {
          await markIgnored(db, row.id, res.reason);
          counts.ignored += 1;
        } else {
          await markDone(db, row.id);
          counts.done += 1;
        }
      } catch (err) {
        await markFailed(db, row.id, err);
        counts.failed += 1;
        console.error(
          `[commas-inbox] row ${row.id} (payment ${row.payment_id || "?"}, ` +
          `${row.event_type || "?"}) failed on attempt ${row.attempts}: ` +
          `${String(err?.message || err).slice(0, 200)}`
        );
      }
    }
  }

  return { claimed, batches, counts };
}
