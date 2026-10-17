// Finish-853 batch 22: live checks for message and journey flow rows (Flow lane).
//
// A flow row that names a customer-facing result is judged here by ONE read-only query over the saved
// rows the flow leaves behind, the same way the display lane judges a control:
//
//   sample_count   how many saved results the flow has left in the window
//   bad_count      how many of those are wrong
//
// With no saved result yet, a check that carries emptyAs "quiet" is green ("none are wrong") and goes red on
// the first wrong one. A check with no emptyAs treats a missing result as red.
//
// RULES (heartbeat law). SELECT only. No text, no email, no write. A failed read is a skip with the reason,
// never a PASS. This file imports no provider and no database module: it is handed a db handle. It reads no
// repo file at run time: the SQL-only template list is the saved JSON beside it
// (fin-b22-sql-template-keys.json, kept fresh by fin-b22-flow-live.test.mjs).
//
// The tests that make each check go red live in fin-b22-flow-live.test.mjs. They run this exact SQL text over
// stand-in rows and break each condition on purpose.

import { createHash } from "node:crypto";

import { TEST_ADDRESS_RE, RECEIPT_AFTER_HOURS } from "../../coverage/gap-sms.mjs";
import { TEMPLATE_KEYS as WAYPOINT_TEMPLATE_KEYS } from "../../../nudge/ladder.mjs";
import { PROMOTIONAL_KEY } from "../../../push/message-policy.mjs";
import snapshot from "./fin-b22-sql-template-keys.json" with { type: "json" };

export const FIN_B22_LIVE_LANE = "src/pulse/coverage/gap-catalog-flow.mjs";
export const FIN_B22_LIVE_TEST = "src/pulse/catalog/proofs/fin-b22-flow-live.test.mjs";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** The same two the older lanes use. A message that sat this long is stuck, not slow. */
export const STUCK_MINUTES = 30;
/** The SMS duplicate guard's own default window (src/messaging/sms-dedup.mjs). */
export const DUPLICATE_WINDOW_MINUTES = 30;
export const DUPLICATE_LOOKBACK_DAYS = 14;
export const STAFF_LOOKBACK_DAYS = 7;
export const OWNER_QUEUE_LOOKBACK_DAYS = 90;
export const OWNER_QUEUE_GRACE_HOURS = 1;
export const RECEIPT_LOOKBACK_DAYS = 14;
export const TEMPLATE_PATH_LOOKBACK_DAYS = 14;
/** A template needs this many aged rows to be judged: one bounce to one bad address is not a dead path. */
export const TEMPLATE_PATH_MIN_ROWS = 2;
export const NUDGE_LOOKBACK_DAYS = 14;
export const NUDGE_CLAIM_GRACE_MINUTES = 15;
export const SOFT_PULL_BUSINESS_SOURCE = "soft_pull_approve";
/** A device a client turned on is waiting if this many days passed and no push was ever tried for it. */
export const PUSH_WAITING_DAYS = 7;
const PUSH_PROMO_KEY_RE = PROMOTIONAL_KEY.source;
/** The push service failed this many times in a row and the device is still on file (only a 404 or 410 retires one). */
export const PUSH_FAILURE_LIMIT = 3;
/** What the nudge runner writes (src/nudge/run.mjs SOURCE_WORKFLOW and STAFF_TASK_ROLE). A test pins both. */
export const NUDGE_SOURCE_WORKFLOW = "waypoint-nudge";
export const NUDGE_STAFF_TASK_ROLE = "csm";
/** A chaseable waypoint left with nobody chasing it past this many days is a client the sweeper never reached.
    The ladder's own first two rungs land by day 2 (src/nudge/ladder.mjs); one more day is the grace. */
export const NUDGE_WAITING_DAYS = 3;
/** What the planner calls a chaseable state and a bought service (src/nudge/exits.mjs). A test pins both. */
export const NUDGE_CHASEABLE_STATES = Object.freeze(["not_started", "in_progress"]);
export const NUDGE_BOUGHT_STATUSES = Object.freeze(["paid", "staged", "fulfilled"]);
/** A live payment link holds a waypoint for this long (src/paid-services/link-ttl.mjs). A test pins it. */
export const NUDGE_CHECKOUT_LINK_DAYS = 7;

const sqlList = (items) => items.map((s) => `'${String(s).replace(/'/g, "''")}'`).join(", ");

/**
 * A message that is not test traffic: not flagged demo, not to a test address, and its client is not demo,
 * synthetic or on a test address. Same idea as gap-sms.mjs realMessageSql. `m` is the messages alias and
 * `re` the parameter that holds TEST_ADDRESS_RE.
 */
export function realMessage(m, re) {
  return `COALESCE(${m}.is_demo, false) = false
     AND COALESCE(${m}.to_address, '') !~* ${re}::text
     AND NOT EXISTS (
           SELECT 1 FROM clients cl
            WHERE cl.id = ${m}.client_id
              AND (COALESCE(cl.is_demo, false) = true
                OR COALESCE(cl.custom_fields ->> 'synthetic', '') = 'true'
                OR COALESCE(cl.email, '') ~* ${re}::text))`;
}

/**
 * A client that is not demo, synthetic or on a test address. `c` is the expression that holds the client id and
 * `re` the parameter that holds TEST_ADDRESS_RE. Same test as realMessage, for a read that starts at the client.
 */
export function realClient(c, re) {
  return `NOT EXISTS (
           SELECT 1 FROM clients cl
            WHERE cl.id = ${c}
              AND (COALESCE(cl.is_demo, false) = true
                OR COALESCE(cl.custom_fields ->> 'synthetic', '') = 'true'
                OR COALESCE(cl.email, '') ~* ${re}::text))`;
}

// ── the queries ──────────────────────────────────────────────────────────────

/**
 * $1 org, $2 since, $3 test-address pattern. The later send of a pair the duplicate guard would have refused:
 * the same phone, an earlier send inside the guard window, and the same template (or the same words when
 * there is no template). A hash join on the phone, so the read stays small however many texts left.
 *
 * THE PHONE IS ITS LAST TEN DIGITS, not the raw string, so "(602) 555-0101" and "+16025550101" are one phone
 * (the older msg:brakes check in gap-msg.mjs reads a phone the same way).
 *
 * TWO TEXTS AT ONE INSTANT ARE STILL A PAIR. dispatch.mjs claimDue and claimOne stamp last_attempt_at with now()
 * for every row of a batch, so the likeliest duplicate (two identical texts claimed in one pass) carries the SAME
 * time. A strict "earlier" test would never see it. The message id breaks the tie, so a pair at one instant
 * counts one later send and n copies at one instant count n - 1. A row is never its own earlier send.
 */
export const SMS_DUPLICATE_SQL = `
WITH sms AS (
  SELECT m.id, m.template_key, m.rendered_body,
         right(regexp_replace(COALESCE(m.to_address, ''), '[^0-9]', '', 'g'), 10) AS phone,
         COALESCE(m.last_attempt_at, m.created_at) AS sent_at
    FROM messages m
   WHERE m.org_id = $1::uuid
     AND m.direction = 'outbound'
     AND m.channel = 'sms'
     AND m.status IN ('sent', 'delivered')
     AND m.sender_staff_id IS NULL
     AND NULLIF(regexp_replace(COALESCE(m.to_address, ''), '[^0-9]', '', 'g'), '') IS NOT NULL
     AND COALESCE(m.last_attempt_at, m.created_at) >= $2::timestamptz
     AND ${realMessage("m", "$3")}
),
repeats AS (
  SELECT DISTINCT a.id
    FROM sms a
    JOIN sms p ON p.phone = a.phone
   WHERE (p.sent_at < a.sent_at OR (p.sent_at = a.sent_at AND p.id < a.id))
     AND p.sent_at >= a.sent_at - interval '${DUPLICATE_WINDOW_MINUTES} minutes'
     AND ((a.template_key IS NOT NULL AND p.template_key = a.template_key)
       OR (a.template_key IS NULL AND p.template_key IS NULL AND p.rendered_body = a.rendered_body))
)
SELECT (SELECT count(*)::int FROM sms) AS sample_count,
       (SELECT count(*)::int FROM repeats) AS bad_count`.trim();

/**
 * $1 org, $2 since, $3 stuck-before, $4 receipt-before. A staff-typed reply that never reached the customer:
 * still queued past due, stuck on sending, said it left with no provider id, sat on sent a day with no receipt,
 * OR ended failed or bounced (the provider turned it down, the sender gave up after its attempts, or the
 * address bounced). A failed or bounced reply is a final answer and stays red for the whole lookback: the
 * customer never got what the person typed.
 */
export const STAFF_REPLY_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE
            m.status IN ('failed', 'bounced')
         OR (m.status = 'queued' AND COALESCE(m.scheduled_at, m.created_at) < $3::timestamptz)
         OR (m.status = 'sending' AND COALESCE(m.last_attempt_at, m.created_at) < $3::timestamptz)
         OR (m.status IN ('sent', 'delivered') AND NULLIF(BTRIM(COALESCE(m.provider_message_id, '')), '') IS NULL)
         OR (m.status = 'sent' AND m.channel IN ('sms', 'email')
             AND COALESCE(m.last_attempt_at, m.created_at) < $4::timestamptz)
       )::int AS bad_count
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.sender_staff_id IS NOT NULL
   AND COALESCE(m.is_demo, false) = false
   AND m.created_at >= $2::timestamptz`.trim();

/** $1 org, $2 since, $3 queued-before. A finance owner alert waits for a sender nobody built, or failed. */
export const OWNER_QUEUE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE n.status = 'failed'
         OR (n.status = 'queued' AND n.created_at < $3::timestamptz))::int AS bad_count
  FROM owner_notifications n
 WHERE n.org_id = $1::uuid
   AND n.created_at >= $2::timestamptz`.trim();

/** $1 org, $2 since, $3 no-receipt-before, $4 test-address pattern. A text the carrier took and never reported on. */
export const TWILIO_RECEIPT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE m.status = 'sent'
         AND COALESCE(m.last_attempt_at, m.created_at) < $3::timestamptz)::int AS bad_count
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.channel = 'sms'
   AND m.status IN ('sent', 'delivered', 'failed')
   AND NULLIF(BTRIM(COALESCE(m.provider_message_id, '')), '') IS NOT NULL
   AND COALESCE(m.last_attempt_at, m.created_at) >= $2::timestamptz
   AND ${realMessage("m", "$4")}`.trim();

/**
 * $1 org, $2 since, $3 aged-before, $4 test-address pattern. A template that stopped delivering: two or more of
 * its sends are older than the receipt grace and none was delivered AFTER the last delivery it ever had in the
 * window (a template with no delivery in the window counts every aged send). One delivery long ago therefore
 * cannot shield a template that fails every send since. One bounce to one bad address is still not a dead path
 * (the two-row floor).
 */
export const TEMPLATE_DELIVERY_SQL = `
WITH sends AS (
  SELECT m.template_key, m.channel, m.status, m.created_at
    FROM messages m
   WHERE m.org_id = $1::uuid
     AND m.direction = 'outbound'
     AND m.channel IN ('sms', 'email')
     AND m.template_key IS NOT NULL
     AND m.status IN ('queued', 'sending', 'sent', 'delivered', 'complained', 'failed', 'bounced')
     AND m.created_at >= $2::timestamptz
     AND ${realMessage("m", "$4")}
),
last_ok AS (
  SELECT s.template_key, s.channel, max(s.created_at) AS ok_at
    FROM sends s
   WHERE s.status IN ('delivered', 'complained')
   GROUP BY s.template_key, s.channel
),
per AS (
  SELECT s.template_key, s.channel,
         count(*) FILTER (WHERE s.created_at < $3::timestamptz
                            AND (o.ok_at IS NULL OR s.created_at > o.ok_at)) AS dead_n
    FROM sends s
    LEFT JOIN last_ok o ON o.template_key = s.template_key AND o.channel = s.channel
   GROUP BY s.template_key, s.channel
)
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE dead_n >= ${TEMPLATE_PATH_MIN_ROWS})::int AS bad_count
  FROM per`.trim();

/**
 * $1 org, $2 since, $3 claimed-before, $4 stuck-before, $5 test-address pattern, $6 waiting-before,
 * $7 payment-link-since. Two things are judged and their counts are added.
 *
 * RUNGS: one row per rung the waypoint ladder spent for a real client. Wrong when the rung was claimed and died,
 * waited on an unapproved template, was REFUSED for any reason but the client's own opt-out (src/nudge/run.mjs
 * writes "refused" with the reason in detail: draft_template, error:...), ended in a message that is missing,
 * is the wrong one, is stuck, FAILED, BOUNCED or was BLOCKED for anything but an opt-out, or (step 4) in no task.
 * A queued rung whose message is missing (no id, gone, or another company's) reads as direction NULL, which
 * is DISTINCT FROM 'outbound', so the direction test is the one that catches it. The same goes for a step 4
 * rung with no task: its source workflow reads NULL, which is DISTINCT FROM the runner's own name.
 *
 * WAITING: a client-owned, chaseable waypoint that has been overdue past the grace, that the ladder has NEVER
 * touched, for a client the ladder has not written one row for since it came due, and that no permanent stop
 * explains (opt-out, escalation, program complete or cancelled, a bought or live-checkout paid alternative).
 * Each is a client nobody is chasing: a sweeper that runs and spends no rung at all lands here.
 */
export const WAYPOINT_NUDGE_SQL = `
WITH rungs AS (
  SELECT count(*)::int AS sample_count,
         count(*) FILTER (WHERE
              (n.outcome = 'claimed' AND n.created_at < $3::timestamptz)
           OR n.outcome = 'template_pending'
           OR (n.outcome = 'refused' AND COALESCE(n.detail, '') <> 'opted_out')
           OR (n.kind = 'client_message' AND n.outcome = 'queued' AND (
                    n.template_key IS NULL
                 OR n.template_key NOT IN (${sqlList(WAYPOINT_TEMPLATE_KEYS)})
                 OR m.direction IS DISTINCT FROM 'outbound'
                 OR m.template_key IS DISTINCT FROM n.template_key
                 OR m.channel IS DISTINCT FROM n.channel
                 OR m.client_id IS DISTINCT FROM n.client_id
                 OR m.status IN ('failed', 'bounced')
                 OR (m.status = 'blocked' AND COALESCE(m.blocked_reason, '') NOT LIKE '%opted_out%')
                 OR (m.status = 'queued' AND COALESCE(m.scheduled_at, m.created_at) < $4::timestamptz)
                 OR (m.status = 'sending' AND COALESCE(m.last_attempt_at, m.created_at) < $4::timestamptz)))
           OR (n.kind = 'staff_task' AND n.outcome = 'staff_task' AND (
                    t.source_workflow IS DISTINCT FROM '${NUDGE_SOURCE_WORKFLOW}'
                 OR t.client_id IS DISTINCT FROM n.client_id
                 OR t.assignee_role IS DISTINCT FROM '${NUDGE_STAFF_TASK_ROLE}'))
         )::int AS bad_count
    FROM waypoint_nudges n
    LEFT JOIN messages m ON m.id = n.message_id AND m.org_id = n.org_id
    LEFT JOIN tasks t ON t.id = n.task_id AND t.org_id = n.org_id
   WHERE n.org_id = $1::uuid
     AND n.created_at >= $2::timestamptz
     AND ${realClient("n.client_id", "$5")}
),
waiting AS (
  SELECT w.client_id, w.due_at
    FROM client_waypoints w
   WHERE w.org_id = $1::uuid
     AND w.owner_kind = 'client'
     AND w.state IN (${sqlList(NUDGE_CHASEABLE_STATES)})
     AND w.completed_at IS NULL
     AND w.due_at < $6::timestamptz
     AND NOT EXISTS (SELECT 1 FROM waypoint_nudges y WHERE y.waypoint_id = w.id)
     AND NOT EXISTS (SELECT 1 FROM opt_outs o
                      WHERE o.client_id = w.client_id AND o.channel IN ('sms', 'email') AND o.opted_in_at IS NULL)
     AND NOT EXISTS (SELECT 1 FROM client_escalations e WHERE e.client_id = w.client_id)
     AND NOT EXISTS (SELECT 1 FROM repair_programs rp
                      WHERE rp.client_id = w.client_id AND rp.status IN ('complete', 'cancelled'))
     AND NOT EXISTS (SELECT 1 FROM paid_service_requests p
                      WHERE p.waypoint_id = w.id
                        AND (p.status IN (${sqlList(NUDGE_BOUGHT_STATUSES)})
                          OR (p.status = 'awaiting_payment' AND p.requested_at >= $7::timestamptz)))
     AND ${realClient("w.client_id", "$5")}
)
SELECT r.sample_count + (SELECT count(*) FROM waiting)::int AS sample_count,
       r.bad_count + (SELECT count(*) FROM waiting g
                       WHERE NOT EXISTS (SELECT 1 FROM waypoint_nudges x
                                          WHERE x.client_id = g.client_id AND x.created_at >= g.due_at))::int AS bad_count
  FROM rungs r`.trim();

/** $1 org, $2 EIN pattern. A company a client saved on the soft-pull form, as the staff screen needs it. */
export const SOFT_PULL_BUSINESS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE
            c.id IS NULL
         OR NULLIF(BTRIM(COALESCE(b.name, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data ->> 'address_line1', '')), '') IS NULL
         OR LENGTH(BTRIM(COALESCE(b.entity_data ->> 'state', ''))) <> 2
         OR COALESCE(b.entity_data ->> 'ein', '') !~* $2::text
         OR b.age_months IS NULL
       )::int AS bad_count
  FROM businesses b
  LEFT JOIN clients c ON c.id = b.client_id AND c.org_id = b.org_id
 WHERE b.org_id = $1::uuid
   AND b.entity_data ->> 'source' = '${SOFT_PULL_BUSINESS_SOURCE}'`.trim();

/**
 * $1 org, $2 waited-before, $3 test-address pattern, $4 promo template pattern. A notification device a client turned on, as the sender
 * left it: src/push/store.mjs markSuccess stamps last_success_at and clears failure_count, markFailure adds one,
 * markExpired (a 404 or 410) retires the row. Two states are wrong. WAITING: the device is older than the grace
 * and nothing was ever tried (no success, no failure) after an eligible email or text was sent to that client.
 * A client who only registered a device but has received no eligible message is not falsely flagged.
 * FAILING: the push service failed it three times or more and it is still on file.
 */
export const PUSH_DEVICE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE
            (s.last_success_at IS NULL AND s.failure_count = 0 AND s.created_at < $2::timestamptz
             AND EXISTS (
               SELECT 1 FROM messages m
                WHERE m.org_id = s.org_id AND m.client_id = s.client_id
                  AND m.direction = 'outbound' AND m.status = 'sent'
                  AND m.channel IN ('email', 'sms') AND m.updated_at >= s.created_at
                  AND (m.template_key IS NULL OR m.template_key !~* $4::text)
             ))
         OR s.failure_count >= ${PUSH_FAILURE_LIMIT}
       )::int AS bad_count
  FROM client_push_subscriptions s
 WHERE s.org_id = $1::uuid
   AND s.expired_at IS NULL
   AND s.revoked_at IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM clients cl
          WHERE cl.id = s.client_id
            AND (COALESCE(cl.is_demo, false) = true
              OR COALESCE(cl.custom_fields ->> 'synthetic', '') = 'true'
              OR COALESCE(cl.email, '') ~* $3::text))`.trim();

/** The EIN shape normalizeSoftPullEin writes: two digits, a dash, seven digits. */
export const EIN_PATTERN = "^[0-9]{2}-[0-9]{7}$";

/** $1 org. Every template the company has: the sign-off record and the SQL-seeded keys are judged from these. */
export const TEMPLATE_ROWS_SQL = `
SELECT t.template_key, t.channel, t.subject, t.body, t.compliance_passed, t.approved_by, t.approved_body_sha
  FROM message_templates t
 WHERE t.org_id = $1::uuid`.trim();

// ── the reducers for the two checks that judge rows in code ─────────────────

/** The hash the template editor stores at approval (api/message-templates.mjs copyHash): subject, NUL, body. */
export function copyHash(subject, body) {
  return createHash("sha256").update(`${subject ?? ""}\0${body ?? ""}`).digest("hex");
}

/** The live copy of an approved template is the copy a person signed off. */
export function reduceSignOff(rows) {
  const signed = rows.filter((row) => truthy(row.compliance_passed) && (row.approved_body_sha || row.approved_by));
  const bad = signed.filter((row) => !row.approved_body_sha || copyHash(row.subject, row.body) !== row.approved_body_sha);
  return {
    sample_count: signed.length,
    bad_count: bad.length,
    names: bad.map((row) => String(row.template_key)),
  };
}

const PLACEHOLDER_COPY = /\[DRAFT|lorem\s+ipsum|NO SOURCE COPY/i;

function truthy(value) {
  return value === true || value === 1 || value === "t" || value === "true";
}

/** Every SQL-only template that something can send is there, in its channel, with real words, approved as seeded. */
export function reduceSqlOnlyKeys(rows, keys = snapshot.keys) {
  const live = new Map(rows.map((row) => [String(row.template_key), row]));
  const judged = keys.filter((entry) => !entry.inactive);
  const names = [];
  for (const entry of judged) {
    const row = live.get(entry.key);
    const wrong = !row
      || (entry.channel && String(row.channel) !== entry.channel)
      || !String(row.body ?? "").trim()
      || PLACEHOLDER_COPY.test(String(row.body ?? ""))
      || PLACEHOLDER_COPY.test(String(row.subject ?? ""))
      || (entry.approvedBySeed && !truthy(row.compliance_passed));
    if (wrong) names.push(entry.key);
  }
  return { sample_count: judged.length, bad_count: names.length, names };
}

// ── the checks ───────────────────────────────────────────────────────────────

const when = (ctx, ms) => new Date(ctx.now.getTime() - ms).toISOString();

export const FIN_B22_LIVE = Object.freeze([
  Object.freeze({
    surface: "dispatch:sms-duplicate-guard-NOT-WIRED",
    family: "message",
    emptyAs: "quiet",
    requirement: `No customer text went to the same phone twice with the same words inside ${DUPLICATE_WINDOW_MINUTES} minutes, even when both were claimed in one dispatch pass at the same instant and even when the phone was typed two ways (the duplicate guard in src/messaging/sms-dedup.mjs is not wired into the sender, so this reads what customers actually got).`,
    sql: SMS_DUPLICATE_SQL,
    params: (ctx) => [ctx.orgId, when(ctx, DUPLICATE_LOOKBACK_DAYS * DAY), TEST_ADDRESS_RE],
  }),
  Object.freeze({
    surface: "job:staff-message-sweeper",
    family: "message",
    emptyAs: "quiet",
    requirement: `Every reply a staff member typed in the last ${STAFF_LOOKBACK_DAYS} days left the queue, carries a provider id, did not end failed or bounced, and is not stuck on sent with no receipt after ${RECEIPT_AFTER_HOURS} hours.`,
    sql: STAFF_REPLY_SQL,
    params: (ctx) => [ctx.orgId, when(ctx, STAFF_LOOKBACK_DAYS * DAY), when(ctx, STUCK_MINUTES * MIN), when(ctx, RECEIPT_AFTER_HOURS * HOUR)],
  }),
  Object.freeze({
    surface: "owner-alert:owner_notifications queue (finance alerts)",
    family: "message",
    emptyAs: "quiet",
    requirement: `No finance owner alert has waited more than ${OWNER_QUEUE_GRACE_HOURS} hour in owner_notifications for a sender, and none failed.`,
    sql: OWNER_QUEUE_SQL,
    params: (ctx) => [ctx.orgId, when(ctx, OWNER_QUEUE_LOOKBACK_DAYS * DAY), when(ctx, OWNER_QUEUE_GRACE_HOURS * HOUR)],
  }),
  Object.freeze({
    surface: "receipt:twilio-status-webhook",
    family: "message",
    emptyAs: "quiet",
    requirement: `Every text the carrier took has a delivered or failed receipt within ${RECEIPT_AFTER_HOURS} hours, so the Twilio status door is moving rows.`,
    sql: TWILIO_RECEIPT_SQL,
    params: (ctx) => [ctx.orgId, when(ctx, RECEIPT_LOOKBACK_DAYS * DAY), when(ctx, RECEIPT_AFTER_HOURS * HOUR), TEST_ADDRESS_RE],
  }),
  Object.freeze({
    surface: "manual-proof:comms-map-2026-09-19 (template delivery proof)",
    family: "message",
    emptyAs: "quiet",
    requirement: `Every client template sent in the last ${TEMPLATE_PATH_LOOKBACK_DAYS} days is still delivering: no template has ${TEMPLATE_PATH_MIN_ROWS} or more sends older than ${RECEIPT_AFTER_HOURS} hours that came after its last delivery (the hand-run delivery proof, read again from the messages the company really sent).`,
    sql: TEMPLATE_DELIVERY_SQL,
    params: (ctx) => [ctx.orgId, when(ctx, TEMPLATE_PATH_LOOKBACK_DAYS * DAY), when(ctx, RECEIPT_AFTER_HOURS * HOUR), TEST_ADDRESS_RE],
  }),
  Object.freeze({
    surface: "workflow:waypoint-nudge-sweeper",
    family: "message",
    emptyAs: "quiet",
    requirement: `Every waypoint rung spent in the last ${NUDGE_LOOKBACK_DAYS} days ended in its own message (one of ${WAYPOINT_TEMPLATE_KEYS.join(", ")}) that left the queue and did not fail, bounce or get blocked, or in the staff task for step 4 (a client who opted out is the one refusal that is right). None is stuck on claimed, refused for another reason, or waiting on an unapproved template. And no client-owned item has sat ${NUDGE_WAITING_DAYS} days overdue with the ladder never having written a row for that client.`,
    sql: WAYPOINT_NUDGE_SQL,
    params: (ctx) => [
      ctx.orgId, when(ctx, NUDGE_LOOKBACK_DAYS * DAY), when(ctx, NUDGE_CLAIM_GRACE_MINUTES * MIN), when(ctx, STUCK_MINUTES * MIN),
      TEST_ADDRESS_RE, when(ctx, NUDGE_WAITING_DAYS * DAY), when(ctx, NUDGE_CHECKOUT_LINK_DAYS * DAY),
    ],
  }),
  Object.freeze({
    surface: "template-copy:seed-vs-live-drift",
    family: "message",
    emptyAs: "quiet",
    requirement: "Every approved template that carries a sign-off record still holds exactly the words that were signed off (subject and body hash to approved_body_sha).",
    sql: TEMPLATE_ROWS_SQL,
    params: (ctx) => [ctx.orgId],
    reduce: reduceSignOff,
  }),
  Object.freeze({
    surface: "template-copy:SQL-seeded-only-keys-not-in-doc-source",
    family: "message",
    requirement: "Every SQL-seeded template that something can send exists for this company, in its own channel, with real words (no [DRAFT, no lorem, no blank) and approved as the seed approved it.",
    sql: TEMPLATE_ROWS_SQL,
    params: (ctx) => [ctx.orgId],
    reduce: (rows) => reduceSqlOnlyKeys(rows),
  }),
  Object.freeze({
    surface: "provider:web-push-and-client-push",
    family: "message",
    emptyAs: "quiet",
    requirement: `Every notification device for a client with a sent service email or text after registration is being reached: none has waited more than ${PUSH_WAITING_DAYS} days with no push ever tried, and none has failed ${PUSH_FAILURE_LIMIT} times or more without being retired. A device with no eligible message is not a failure.`,
    sql: PUSH_DEVICE_SQL,
    params: (ctx) => [ctx.orgId, when(ctx, PUSH_WAITING_DAYS * DAY), TEST_ADDRESS_RE, PUSH_PROMO_KEY_RE],
  }),
  Object.freeze({
    surface: "journey:soft-pull-multi-biz-intended-draft#6-staff-sees-files",
    family: "journey",
    emptyAs: "quiet",
    requirement: "Every company saved on the soft-pull form is a whole file for the staff screen: the client exists, and the name, state (two letters), street, EIN (12-3456789) and age are saved.",
    sql: SOFT_PULL_BUSINESS_SQL,
    params: (ctx) => [ctx.orgId, EIN_PATTERN],
  }),
]);

export const FIN_B22_LIVE_SURFACES = Object.freeze(new Set(FIN_B22_LIVE.map((spec) => spec.surface)));

export function finB22LiveId(spec) {
  return `flow:${spec.family}:${spec.surface}`;
}

function result(spec, status, detail, suggestedFix = null) {
  return { id: finB22LiveId(spec), status, detail, suggestedFix };
}

/** One saved-result verdict, in plain words. Pure. */
export function judgeLive(spec, stats, names = []) {
  const samples = Number(stats?.sample_count || 0);
  const bad = Number(stats?.bad_count || 0);
  const named = names.length ? ` (${names.slice(0, 5).join(", ")}${names.length > 5 ? `, ${names.length - 5} more` : ""})` : "";
  if (samples === 0 && spec.emptyAs === "quiet") {
    return result(spec, "PASS", `${spec.surface}: no saved results yet, so none are wrong. This check goes red on the first wrong result. ${spec.requirement}`);
  }
  if (samples === 0) {
    return result(
      spec,
      "FAIL",
      `${spec.surface}: nothing to judge exists for this company. Required: ${spec.requirement}`,
      "Read the named rows. Do not auto-fix. Chris fixes reds."
    );
  }
  if (bad === 0) {
    return result(spec, "PASS", `${spec.surface}: ${samples} saved result${samples === 1 ? "" : "s"} passed the exact check. ${spec.requirement}`);
  }
  return result(
    spec,
    "FAIL",
    `${spec.surface}: ${bad} of ${samples} saved result${samples === 1 ? "" : "s"} failed the exact check${named}. Required: ${spec.requirement}`,
    "Open the named result rows and fix the broken link or value. Do not auto-fix. Chris fixes reds."
  );
}

function bind(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx?.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

function skipped(spec, error) {
  const message = String(error?.message || error || "unknown read error").replace(/\s+/g, " ").slice(0, 160);
  return result(spec, "skip", `${spec.surface} was not checked: ${message}.`);
}

/**
 * Run every live check for this company. Returns Map(id -> { id, status, detail, suggestedFix }).
 * Two checks that read the same SQL and parameters share one query. Never throws.
 */
export async function runFinB22Live(ctx = {}, specs = FIN_B22_LIVE) {
  const out = new Map();
  const run = bind(ctx);
  if (!run) {
    for (const spec of specs) out.set(finB22LiveId(spec), skipped(spec, "no database in this run"));
    return out;
  }
  if (!ctx.orgId) {
    for (const spec of specs) out.set(finB22LiveId(spec), skipped(spec, "no company in this run"));
    return out;
  }
  const now = ctx.now instanceof Date && Number.isFinite(ctx.now.getTime()) ? ctx.now : new Date(ctx.now || Date.now());
  const at = { orgId: ctx.orgId, now };

  const queries = new Map();
  for (const spec of specs) {
    const params = spec.params(at);
    const key = `${spec.sql}\0${JSON.stringify(params)}`;
    if (!queries.has(key)) {
      queries.set(key, run((db) => db.query(spec.sql, params)).then(
        (answer) => ({ rows: Array.isArray(answer?.rows) ? answer.rows : null }),
        (error) => ({ error }),
      ));
    }
  }
  const answers = new Map();
  for (const [key, pending] of queries) answers.set(key, await pending);

  for (const spec of specs) {
    const got = answers.get(`${spec.sql}\0${JSON.stringify(spec.params(at))}`);
    if (got.error) { out.set(finB22LiveId(spec), skipped(spec, got.error)); continue; }
    if (!got.rows) { out.set(finB22LiveId(spec), skipped(spec, "the read returned no rows")); continue; }
    if (spec.reduce) {
      const reduced = spec.reduce(got.rows);
      out.set(finB22LiveId(spec), judgeLive(spec, reduced, reduced.names || []));
    } else {
      out.set(finB22LiveId(spec), judgeLive(spec, got.rows[0] || { sample_count: 0, bad_count: 0 }));
    }
  }
  return out;
}
