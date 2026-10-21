// Cortana payment feed — every paid step, weighted, into Cortana.
//
// Owner ask 2026-10-20: the soft pull is a light step, not a purchase; then the
// first purchase; then every later payment (funding fee per round, repair for
// the next round, the $1,000 auto-checkout, the end-of-Blueprint deposit and
// fee, any repair + funding mix) is lifetime value. Commas and Whop both write
// paid rows to `transactions`, so this clock reads that one table:
//
//   soft_pull       the $32 soft-pull assessment            -> "Soft Pull"
//   first_purchase  the client's first paid non-soft-pull   -> "New Deals Closed"
//   all_payments    every paid payment, soft pull included  -> "All Payments (LTV)"
//
// Why a clock and not a bus handler: Cortana's webhook has no event id, so a
// payment must reach each bucket exactly once, retried until it lands. The
// cortana_feed_sends row (db/migrations/499) is claimed before the POST and is
// the only dedupe there is. all_payments is sent last, so "all_payments sent"
// means every other bucket for that payment was at least attempted.
//
// Skipped on purpose: demo rows, refunds and failed charges, payments before
// FEED_START (none were real; Cortana had no feed then), and company or test
// emails (src/slo/visitor.mjs).
import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { toCents } from "../commissions/money.mjs";
import { offerKeyForPayment } from "../handlers/meta-purchase.mjs";
import { classifyVisitor } from "../slo/visitor.mjs";
import { clientMetaClickIds } from "../ads/meta-match.mjs";
import { sendCortanaPayment, cortanaFeedEnabled } from "../messaging/providers/cortana-webhook.mjs";
import { FEED_START } from "../pulse/beats/lib/cortana-feed-truth.mjs";

export const SOURCE_WORKFLOW = "cortana-payment-feed";
export const FEED_CRON = "*/5 * * * *";
export const MAX_PAYMENTS_PER_SWEEP = 25;
/* Midnight 2026-10-20 in Arizona, shared with the pulse check. The three paid
   rows before it are test charges from September and early October; nothing
   earlier is sent. */
export { FEED_START };
/* A claim older than this was a sweep that died mid-POST; it is retried. */
export const STALE_CLAIM_MINUTES = 10;
export const PROVIDERS = Object.freeze(["commas", "whop"]);

/** True when this paid row is the $32 soft-pull assessment. */
export function isSoftPull(rawPayload) {
  const p = rawPayload && typeof rawPayload === "object" ? rawPayload : {};
  if (String(p.product || "").trim().toLowerCase() === "crs") return true;
  return offerKeyForPayment(p) === "SOFT_PULL";
}

/**
 * The Cortana buckets one paid row belongs to, in send order (all_payments last).
 * `earlierPurchase` is true when the client already paid for something that is
 * not the soft pull, at any time, before this row.
 */
export function bucketsFor({ rawPayload, earlierPurchase }) {
  if (isSoftPull(rawPayload)) return ["soft_pull", "all_payments"];
  if (!earlierPurchase) return ["first_purchase", "all_payments"];
  return ["all_payments"];
}

/** fbclid out of a stored _fbc cookie value ("fb.1.<ms>.<fbclid>"). */
export function fbclidFromFbc(fbc) {
  const parts = String(fbc || "").split(".");
  return parts.length >= 4 && parts[0] === "fb" ? parts.slice(3).join(".") || null : null;
}

const CANDIDATES_SQL = `
  SELECT t.id, t.org_id, t.client_id, t.amount_paid, t.provider, t.provider_ref,
         t.created_at, t.raw_payload,
         c.first_name, c.last_name, c.email, c.phone, c.custom_fields,
         a.utm_source, a.utm_medium, a.utm_campaign, a.utm_content, a.ad_id
    FROM transactions t
    JOIN clients c ON c.id = t.client_id AND c.org_id = t.org_id
    LEFT JOIN client_ad_attribution a ON a.client_id = t.client_id
   WHERE t.status = 'succeeded'
     AND t.provider = ANY($1::text[])
     AND t.is_demo = false
     AND COALESCE(c.is_demo, false) = false
     AND t.amount_paid > 0
     AND t.created_at >= $2::timestamptz
     AND (
       NOT EXISTS (SELECT 1 FROM cortana_feed_sends s
                    WHERE s.transaction_id = t.id AND s.bucket = 'all_payments'
                      AND s.status IN ('sent', 'skipped'))
       OR EXISTS (SELECT 1 FROM cortana_feed_sends s
                   WHERE s.transaction_id = t.id AND s.status IN ('sending', 'failed'))
     )
   ORDER BY t.created_at ASC, t.id ASC
   LIMIT $3`;

const EARLIER_SQL = `
  SELECT raw_payload
    FROM transactions
   WHERE org_id = $1 AND client_id = $2 AND status = 'succeeded'
     AND is_demo = false AND amount_paid > 0
     AND (created_at, id) < ($3::timestamptz, $4::uuid)`;

/* Takes the (payment, bucket) row for this sweep, or returns null when it was
   already sent, skipped, or is held by a live claim. */
const CLAIM_SQL = `
  INSERT INTO cortana_feed_sends (org_id, transaction_id, bucket, status, attempts, amount_cents, claimed_at)
  VALUES ($1, $2, $3, 'sending', 1, $4, now())
  ON CONFLICT (transaction_id, bucket) DO UPDATE
     SET status = 'sending', attempts = cortana_feed_sends.attempts + 1,
         claimed_at = now(), updated_at = now()
   WHERE cortana_feed_sends.status = 'failed'
      OR (cortana_feed_sends.status = 'sending'
          AND cortana_feed_sends.claimed_at < now() - make_interval(mins => $5))
  RETURNING id`;

async function finish(conn, id, status, error = null) {
  await conn.query(
    `UPDATE cortana_feed_sends
        SET status = $2, last_error = $3, updated_at = now(),
            sent_at = CASE WHEN $2 = 'sent' THEN now() ELSE sent_at END
      WHERE id = $1`,
    [id, status, error ? String(error).slice(0, 300) : null]
  );
}

export async function sweepCortanaPaymentFeed(conn = db, {
  send = sendCortanaPayment,
  env = process.env,
  fetchImpl,
  limit = MAX_PAYMENTS_PER_SWEEP
} = {}) {
  const out = { enabled: cortanaFeedEnabled(env), scanned: 0, sent: 0, skipped: 0, failed: 0 };
  if (!out.enabled) return out;
  const capped = Math.max(0, Math.min(MAX_PAYMENTS_PER_SWEEP, Math.trunc(Number(limit) || 0)));
  if (!capped) return out;

  const rows = (await conn.query(CANDIDATES_SQL, [PROVIDERS, FEED_START, capped])).rows;
  out.scanned = rows.length;
  for (const row of rows) {
    let amountCents;
    try { amountCents = toCents(row.amount_paid); } catch { amountCents = 0; }
    if (!(amountCents > 0)) continue;

    const earlier = (await conn.query(EARLIER_SQL, [row.org_id, row.client_id, row.created_at, row.id])).rows;
    const buckets = bucketsFor({
      rawPayload: row.raw_payload,
      earlierPurchase: earlier.some((e) => !isSoftPull(e.raw_payload))
    });
    const agent = classifyVisitor({ email: row.email }).actor === "agent";
    const { fbc } = clientMetaClickIds(row.custom_fields);
    const cf = row.custom_fields && typeof row.custom_fields === "object" ? row.custom_fields : {};
    const name = [row.first_name, row.last_name].map((s) => String(s || "").trim()).filter(Boolean).join(" ");

    for (const bucket of buckets) {
      const claim = (await conn.query(CLAIM_SQL, [row.org_id, row.id, bucket, amountCents, STALE_CLAIM_MINUTES])).rows[0];
      if (!claim) continue;
      if (agent) {
        await finish(conn, claim.id, "skipped", "company or test email");
        out.skipped++;
        continue;
      }
      const res = await send({
        bucket,
        eventId: `fh_pay_${row.id}_${bucket}`,
        amountCents,
        paidAt: row.created_at,
        name: name || null,
        email: row.email,
        phone: row.phone,
        utmSource: row.utm_source,
        utmMedium: row.utm_medium,
        utmCampaign: row.utm_campaign,
        utmContent: row.utm_content,
        utmAdId: row.ad_id,
        fbclid: fbclidFromFbc(fbc),
        gclid: cf.gclid || null,
        clientId: row.client_id,
        offer: offerKeyForPayment(row.raw_payload),
        provider: row.provider,
        paymentId: row.provider_ref
      }, { env, fetchImpl });
      if (res?.ok) {
        await finish(conn, claim.id, "sent");
        out.sent++;
      } else if (res?.skipped === "no_contact") {
        await finish(conn, claim.id, "skipped", "no email or phone on the client");
        out.skipped++;
      } else {
        await finish(conn, claim.id, "failed", res?.error || res?.skipped || "send failed");
        out.failed++;
      }
    }
  }
  // A failed send stays 'failed' and the next sweep retries it. Throwing marks
  // this run failed so the heartbeat and the deep check both see it.
  if (out.failed) throw new Error(`${out.failed} Cortana payment sends failed`);
  return out;
}

export async function handle({ db: handleDb = db, step } = {}) {
  const run = () => sweepCortanaPaymentFeed(handleDb);
  return step?.run ? step.run("send-cortana-payments", run) : run();
}

export const cortanaPaymentFeed = inngest.createFunction(
  { id: SOURCE_WORKFLOW, name: "Send paid steps to Cortana", concurrency: { limit: 1 } },
  { cron: FEED_CRON }, handle
);
