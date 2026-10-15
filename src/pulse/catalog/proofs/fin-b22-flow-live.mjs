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
export const TEMPLATE_PATH_LOOKBACK_DAYS = 30;
/** A template needs this many aged rows to be judged: one bounce to one bad address is not a dead path. */
export const TEMPLATE_PATH_MIN_ROWS = 2;
export const NUDGE_LOOKBACK_DAYS = 14;
export const NUDGE_CLAIM_GRACE_MINUTES = 15;
export const SOFT_PULL_BUSINESS_SOURCE = "soft_pull_approve";
/** A device a client turned on is waiting if this many days passed and no push was ever tried for it. */
export const PUSH_WAITING_DAYS = 7;
/** The push service failed this many times in a row and the device is still on file (only a 404 or 410 retires one). */
export const PUSH_FAILURE_LIMIT = 3;
/** What the nudge runner writes (src/nudge/run.mjs SOURCE_WORKFLOW and STAFF_TASK_ROLE). A test pins both. */
export const NUDGE_SOURCE_WORKFLOW = "waypoint-nudge";
export const NUDGE_STAFF_TASK_ROLE = "csm";

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

// ── the queries ──────────────────────────────────────────────────────────────

/**
 * $1 org, $2 since, $3 test-address pattern. The later send of a pair the duplicate guard would have refused:
 * the same phone, an earlier send inside the guard window, and the same template (or the same words when
 * there is no template). A hash join on the phone, so the read stays small however many texts left. A row is
 * never its own earlier send, because it cannot be sent before itself.
 */
export const SMS_DUPLICATE_SQL = `
WITH sms AS (
  SELECT m.id, m.template_key, m.rendered_body, m.to_address,
         COALESCE(m.last_attempt_at, m.created_at) AS sent_at
    FROM messages m
   WHERE m.org_id = $1::uuid
     AND m.direction = 'outbound'
     AND m.channel = 'sms'
     AND m.status IN ('sent', 'delivered')
     AND m.sender_staff_id IS NULL
     AND NULLIF(BTRIM(COALESCE(m.to_address, '')), '') IS NOT NULL
     AND COALESCE(m.last_attempt_at, m.created_at) >= $2::timestamptz
     AND ${realMessage("m", "$3")}
),
repeats AS (
  SELECT DISTINCT a.id
    FROM sms a
    JOIN sms p ON p.to_address = a.to_address
   WHERE p.sent_at < a.sent_at
     AND p.sent_at >= a.sent_at - interval '${DUPLICATE_WINDOW_MINUTES} minutes'
     AND ((a.template_key IS NOT NULL AND p.template_key = a.template_key)
       OR (a.template_key IS NULL AND p.template_key IS NULL AND p.rendered_body = a.rendered_body))
)
SELECT (SELECT count(*)::int FROM sms) AS sample_count,
       (SELECT count(*)::int FROM repeats) AS bad_count`.trim();

/** $1 org, $2 since, $3 stuck-before, $4 receipt-before. A staff-typed reply that never reached a provider receipt. */
export const STAFF_REPLY_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE
            (m.status = 'queued' AND COALESCE(m.scheduled_at, m.created_at) < $3::timestamptz)
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

/** $1 org, $2 since, $3 aged-before, $4 test-address pattern. A template that was sent and never once delivered. */
export const TEMPLATE_DELIVERY_SQL = `
WITH per AS (
  SELECT m.template_key, m.channel,
         count(*) FILTER (WHERE m.created_at < $3::timestamptz) AS aged_n,
         count(*) FILTER (WHERE m.status IN ('delivered', 'complained')) AS delivered_n
    FROM messages m
   WHERE m.org_id = $1::uuid
     AND m.direction = 'outbound'
     AND m.channel IN ('sms', 'email')
     AND m.template_key IS NOT NULL
     AND m.status IN ('queued', 'sending', 'sent', 'delivered', 'complained', 'failed', 'bounced')
     AND m.created_at >= $2::timestamptz
     AND ${realMessage("m", "$4")}
   GROUP BY m.template_key, m.channel
)
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE aged_n >= ${TEMPLATE_PATH_MIN_ROWS} AND delivered_n = 0)::int AS bad_count
  FROM per`.trim();

/**
 * $1 org, $2 since, $3 claimed-before, $4 stuck-before. One row per rung the waypoint ladder spent.
 * A queued rung whose message is missing (no id, gone, or another company's) reads as direction NULL, which
 * is DISTINCT FROM 'outbound', so the direction test is the one that catches it. The same goes for a step 4
 * rung with no task: its source workflow reads NULL, which is DISTINCT FROM the runner's own name.
 */
export const WAYPOINT_NUDGE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE
            (n.outcome = 'claimed' AND n.created_at < $3::timestamptz)
         OR n.outcome = 'template_pending'
         OR (n.kind = 'client_message' AND n.outcome = 'queued' AND (
                  n.template_key IS NULL
               OR n.template_key NOT IN (${sqlList(WAYPOINT_TEMPLATE_KEYS)})
               OR m.direction IS DISTINCT FROM 'outbound'
               OR m.template_key IS DISTINCT FROM n.template_key
               OR m.channel IS DISTINCT FROM n.channel
               OR m.client_id IS DISTINCT FROM n.client_id
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
   AND n.created_at >= $2::timestamptz`.trim();

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
 * $1 org, $2 waited-before, $3 test-address pattern. A notification device a client turned on, as the sender
 * left it: src/push/store.mjs markSuccess stamps last_success_at and clears failure_count, markFailure adds one,
 * markExpired (a 404 or 410) retires the row. Two states are wrong. WAITING: the device is older than the grace
 * and nothing was ever tried (no success, no failure), which is what a customer lives through while nothing calls
 * sendToClient. FAILING: the push service failed it three times or more and it is still on file.
 */
export const PUSH_DEVICE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE
            (s.last_success_at IS NULL AND s.failure_count = 0 AND s.created_at < $2::timestamptz)
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
    requirement: `No customer text went to the same phone twice with the same words inside ${DUPLICATE_WINDOW_MINUTES} minutes (the duplicate guard in src/messaging/sms-dedup.mjs is not wired into the sender, so this reads what customers actually got).`,
    sql: SMS_DUPLICATE_SQL,
    params: (ctx) => [ctx.orgId, when(ctx, DUPLICATE_LOOKBACK_DAYS * DAY), TEST_ADDRESS_RE],
  }),
  Object.freeze({
    surface: "job:staff-message-sweeper",
    family: "message",
    emptyAs: "quiet",
    requirement: `Every reply a staff member typed in the last ${STAFF_LOOKBACK_DAYS} days left the queue, carries a provider id, and is not stuck on sent with no receipt after ${RECEIPT_AFTER_HOURS} hours.`,
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
    requirement: `Every client template sent in the last ${TEMPLATE_PATH_LOOKBACK_DAYS} days with ${TEMPLATE_PATH_MIN_ROWS} or more old rows was delivered at least once (the hand-run delivery proof, read from the messages the company really sent).`,
    sql: TEMPLATE_DELIVERY_SQL,
    params: (ctx) => [ctx.orgId, when(ctx, TEMPLATE_PATH_LOOKBACK_DAYS * DAY), when(ctx, RECEIPT_AFTER_HOURS * HOUR), TEST_ADDRESS_RE],
  }),
  Object.freeze({
    surface: "workflow:waypoint-nudge-sweeper",
    family: "message",
    emptyAs: "quiet",
    requirement: `Every waypoint rung spent in the last ${NUDGE_LOOKBACK_DAYS} days ended in its own message (one of ${WAYPOINT_TEMPLATE_KEYS.join(", ")}) that left the queue, or in the staff task for step 4. None is stuck on claimed or waiting on an unapproved template.`,
    sql: WAYPOINT_NUDGE_SQL,
    params: (ctx) => [ctx.orgId, when(ctx, NUDGE_LOOKBACK_DAYS * DAY), when(ctx, NUDGE_CLAIM_GRACE_MINUTES * MIN), when(ctx, STUCK_MINUTES * MIN)],
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
    requirement: `Every notification device a client turned on is being reached or is still new: none has waited more than ${PUSH_WAITING_DAYS} days with no push ever tried, and none has failed ${PUSH_FAILURE_LIMIT} times or more without being retired. Nothing in the app calls sendToClient today, so a device waits until someone wires a caller.`,
    sql: PUSH_DEVICE_SQL,
    params: (ctx) => [ctx.orgId, when(ctx, PUSH_WAITING_DAYS * DAY), TEST_ADDRESS_RE],
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
