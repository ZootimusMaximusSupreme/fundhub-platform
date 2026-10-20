// Per-recipient SMS duplicate guard — same org, same template (or same body when
// there is no template), same destination, already sent successfully within a
// sliding window. Runs in dispatch.mjs immediately before a transmitting provider
// is called; Twilio has no idempotency key (see providers/twilio.mjs).

import crypto from "node:crypto";

function resolveTimestampParam(now) {
  const value = typeof now === "function" ? now() : now;
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return value;
}

/** Default when SMS_DEDUP_WINDOW_MINUTES is unset. */
export const DEFAULT_SMS_DEDUP_WINDOW_MINUTES = 30;

export function smsDedupWindowMinutes(env = process.env) {
  const raw = env?.SMS_DEDUP_WINDOW_MINUTES;
  if (raw === undefined || raw === "") return DEFAULT_SMS_DEDUP_WINDOW_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_SMS_DEDUP_WINDOW_MINUTES;
  return Math.floor(n);
}

export function smsDedupEnabled(env = process.env) {
  return smsDedupWindowMinutes(env) > 0;
}

/** Stable body fingerprint for staff / freeform SMS (no template_key). */
export function smsBodyFingerprint(body) {
  return crypto.createHash("sha256").update(String(body ?? "")).digest("hex").slice(0, 32);
}

/** Match the pulse's recipient rule: formatting and an optional country code
 * cannot turn one US phone into two destinations. */
export function normalizeSmsDestination(value) {
  const text = String(value || "").trim();
  const digits = text.replace(/[^0-9]/g, "");
  return digits ? digits.slice(-10) : text;
}

/**
 * In-memory keys for one dispatchDue() pass — blocks a second identical SMS in
 * the same batch before the first row's UPDATE … status='sent' is visible.
 */
export function smsDedupBatchKey({ orgId, templateKey, bodyFingerprint, toAddress }) {
  const tpl = templateKey ? String(templateKey) : "";
  const body = tpl ? "" : String(bodyFingerprint || "");
  const to = normalizeSmsDestination(toAddress);
  return `${orgId}|sms|${tpl}|${body}|${to}`;
}

/**
 * Returns { duplicate: true, priorId } or { duplicate: false }.
 * `toAddress` must be the resolved E.164 (or final destination) about to be sent.
 */
export async function findRecentDuplicateSms(
  db,
  message,
  toAddress,
  { excludeMessageId = null, batchKeys = null, now = null, env = process.env } = {}
) {
  if (message?.channel !== "sms") return { duplicate: false };
  if (!smsDedupEnabled(env)) return { duplicate: false };

  const to = normalizeSmsDestination(toAddress || message.to_address);
  if (!to) return { duplicate: false };

  const templateKey = message.template_key ? String(message.template_key) : "";
  const freeformBody = templateKey ? null : String(message.rendered_body ?? "");

  const batchKey = smsDedupBatchKey({
    orgId: message.org_id,
    clientId: message.client_id,
    templateKey,
    bodyFingerprint: templateKey ? null : smsBodyFingerprint(freeformBody),
    toAddress: to
  });
  if (batchKeys?.has(batchKey)) {
    return { duplicate: true, reason: "batch", priorId: null };
  }

  const windowMin = smsDedupWindowMinutes(env);
  const at = resolveTimestampParam(typeof now === "function" ? now() : now);
  const sinceSql = at
    ? `$6::timestamptz - ($7::int * interval '1 minute')`
    : `now() - ($6::int * interval '1 minute')`;

  const params = at
    ? [
        message.org_id,
        excludeMessageId ?? message.id,
        to,
        templateKey || null,
        freeformBody,
        at,
        windowMin
      ]
    : [
        message.org_id,
        excludeMessageId ?? message.id,
        to,
        templateKey || null,
        freeformBody,
        windowMin
      ];

  const { rows } = await db.query(
    `SELECT id, to_address FROM messages
      WHERE org_id = $1::uuid
        AND direction = 'outbound'
        AND channel = 'sms'
        AND status IN ('sent', 'delivered')
        AND id <> $2::uuid
        AND right(regexp_replace(COALESCE(to_address, ''), '[^0-9]', '', 'g'), 10) = $3
        AND (
          ($4::text IS NOT NULL AND template_key = $4)
          OR ($4::text IS NULL AND template_key IS NULL AND rendered_body = $5::text)
        )
        AND COALESCE(last_attempt_at, created_at) >= ${sinceSql}
      ORDER BY COALESCE(last_attempt_at, created_at) DESC
      LIMIT 1`,
    params
  );

  const prior = rows[0];
  if (prior?.id) {
    return { duplicate: true, reason: "recent_sent", priorId: prior.id };
  }
  return { duplicate: false, batchKey };
}

/** Call after duplicate checks pass and before provider.send — reserves the slot for this batch. */
export function reserveSmsDedupBatch(batchKeys, batchKey) {
  if (batchKeys && batchKey) batchKeys.add(batchKey);
}
