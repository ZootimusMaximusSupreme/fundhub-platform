// Customer and staff SMS that never goes out. Read only. Report only.
//
// Already watched, so this file does not check them again:
//   pipeline:outbound (src/pulse/pipeline-motion.mjs) — queued outbound,
//     SMS included, older than 30 minutes.
//   The instant pulse reads that same stuck count and already texts.
//   job:message-dispatch-sweeper and job:staff-message-sweeper
//     (src/pulse/heartbeats.mjs) — the clocks ran, not whether a text left.
// Slice 12 lists the dispatch, nudge, and commas sweepers for a machine
// row. It does not read message rows. Do not add a second copy of that list.
//
// Not a finding: the company outbound switch. This file does not read it
// and does not say to change it. Quiet hours, dry run, and a gate block
// are the sender's own holds (src/messaging/dispatch.mjs). A test-record
// refuse is not a phone-company failure.
//
// One tripwire stays Recon. This file does not send a text.
//
// Tier 1 (2026-10-09) adds five message-queue checks, text AND email, ids gap:msg-*:
//   sent with no receipt, a ready template with placeholder copy, a message our own gate
//   blocked, a customer reply that got lost or has no person on it, and a message that
//   failed because there was nowhere to send it. They are read only like the rest. Test traffic is left out
//   of the message reads: a demo flag, a synthetic client, or a test address (TEST_ADDRESS_RE).
//   gapChecks returns the three gap:sms-* rows first, then the five gap:msg-* rows.

export const SENDING_STUCK_MINUTES = 15;
export const FAILED_LOOKBACK_DAYS = 7;
export const JOURNEY_GRACE_MINUTES = 15;
export const JOURNEY_LOOKBACK_DAYS = 7;

export const ALREADY_WATCHED = Object.freeze([
  Object.freeze({
    id: "pipeline:outbound",
    where: "src/pulse/pipeline-motion.mjs",
    covers: "sms queued and due for more than 30 minutes"
  }),
  Object.freeze({
    id: "pipeline:outbound",
    where: "src/pulse/instant-watch.mjs (line 81, same id, sent as an instant text)",
    covers: "the same queued-stuck count. It already texts. Do not text again."
  }),
  Object.freeze({
    id: "job:message-dispatch-sweeper",
    where: "src/pulse/heartbeats.mjs",
    covers: "the customer dispatch clock ran"
  }),
  Object.freeze({
    id: "job:staff-message-sweeper",
    where: "src/pulse/heartbeats.mjs",
    covers: "the staff dispatch clock ran"
  })
]);

/** Slice 12 already names these. Do not check them again here. */
export const NOT_DUPLICATED = Object.freeze([
  "message-dispatch-sweeper",
  "waypoint-nudge-sweeper",
  "commas-inbox-drain"
]);

/**
 * Immediate customer texts. A row is missing only when the step would
 * have written one: approved template, not a draft, client not opted out.
 * oncePerClient matches a one-shot lock (welcome, doc request).
 * needsAmount / needsRound match the step's own early return.
 * Booking confirm uses provider_ref suffix :confirm.
 * Reminders and conditional cadences are not in this list.
 */
export const SMS_JOURNEY_STEPS = Object.freeze([
  step("entry.captured", "SMS-S00-WELCOME", "", { oncePerClient: true }),
  step("booking.created", "SMS-S04-01-CONFIRM", ":confirm"),
  step("booking.rescheduled", "SMS-S04-01-CONFIRM", ":confirm"),
  step("round.started", "SMS-ROUND-STARTED-NOTIFY", ""),
  step("round.approved", "SMS-F04-ROUND-APPROVALS", "", { needsAmount: true }),
  step("round.submitted", "SMS-F03-ROUND-SUBMITTED", "", { needsRound: true }),
  step("deposit.paid", "SMS-DOC-01-REQUEST", "", { oncePerClient: true })
]);

export const BREAKS = Object.freeze([
  Object.freeze({ id: "sms-queued-stuck", newCheck: false }),
  Object.freeze({ id: "sms-sending-stuck", newCheck: true }),
  Object.freeze({ id: "sms-provider-failed", newCheck: true }),
  Object.freeze({ id: "sms-journey-zero", newCheck: true })
]);

const TAIL =
  "Do not send a text from this check. Do not change the outbound switch. Recon stays the one tripwire.";

const FIX = Object.freeze({
  sending: `A text was picked up and never finished. Read the messages row still on sending. ${TAIL}`,
  failed: `The phone company said no. Read last_error on the text row. ${TAIL}`,
  journey: `A step that should text wrote no text row. Read the event and the template. ${TAIL}`
});

function step(eventName, templateKey, refSuffix, flags = {}) {
  return Object.freeze({
    eventName,
    templateKey,
    refSuffix,
    oncePerClient: flags.oncePerClient === true,
    needsAmount: flags.needsAmount === true,
    needsRound: flags.needsRound === true
  });
}

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix };
}

/** A count the database did not hand back is not zero. Zero must be read, never assumed. */
function countOf(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n <= 0 ? 0 : Math.floor(n);
}

function textWord(n) {
  return n === 1 ? "text" : "texts";
}

function side(n, who) {
  return `${n} ${who} ${textWord(n)}`;
}

function assertToken(value, re, label) {
  if (typeof value !== "string" || !re.test(value)) {
    throw new Error(`bad SMS journey ${label}`);
  }
}

function assertStep(s) {
  assertToken(s.eventName, /^[a-z0-9.]+$/, "event");
  assertToken(s.templateKey, /^SMS-[A-Z0-9-]+$/, "template");
  assertToken(s.refSuffix, /^$|^:[a-z0-9-]+$/, "suffix");
}

/**
 * SELECT only. Template keys are code constants, checked before they are inlined.
 * Booking and round events carry only payload.email and a NULL client_id
 * (measured 2026-10-08: every booking.created, deposit.paid and round.* row).
 * The workflow finds the person by that email (resolveClient), so this does
 * too. Without the email lookup five of the six steps were never looked at.
 * Demo events and demo clients are journey runs and seeds. They never get a
 * text row, so they are left out (measured 2026-10-08: 135 of 135 flagged
 * events on 2026-09-21 were is_demo). Same filter as gap-nurture.mjs.
 */
export function buildJourneyZeroSql(steps = SMS_JOURNEY_STEPS) {
  const values = steps.map((s) => {
    assertStep(s);
    return (
      `('${s.eventName}'::text, '${s.templateKey}'::text, '${s.refSuffix}'::text, ` +
      `${s.oncePerClient ? "true" : "false"}, ${s.needsAmount ? "true" : "false"}, ` +
      `${s.needsRound ? "true" : "false"})`
    );
  });
  return `
SELECT count(*)::int AS n,
       COALESCE(array_agg(DISTINCT e.name), ARRAY[]::text[]) AS names
  FROM events e
  JOIN (
    VALUES
      ${values.join(",\n      ")}
  ) AS s(event_name, template_key, ref_suffix, once_per_client, needs_amount, needs_round)
    ON s.event_name = e.name
  JOIN message_templates t
    ON t.org_id = e.org_id
   AND t.template_key = s.template_key
   AND t.channel = 'sms'
   AND t.compliance_passed = true
   AND COALESCE(t.body, '') NOT ILIKE '%[DRAFT%'
   AND COALESCE(t.subject, '') NOT ILIKE '%[DRAFT%'
  CROSS JOIN LATERAL (
    SELECT COALESCE(
      e.client_id,
      (SELECT c.id FROM clients c
        WHERE c.org_id = e.org_id
          AND lower(c.email) = lower(btrim(COALESCE(e.payload->>'email', '')))
        LIMIT 1)
    ) AS id
  ) rc
 WHERE e.org_id = $1::uuid
   AND COALESCE(e.is_demo, false) = false
   AND (rc.id IS NOT NULL OR btrim(COALESCE(e.payload->>'email', '')) <> '')
   AND NOT EXISTS (
     SELECT 1 FROM clients d WHERE d.id = rc.id AND COALESCE(d.is_demo, false) = true
   )
   AND e.created_at < $2::timestamptz
   AND e.created_at >= $3::timestamptz
   AND NOT EXISTS (
     SELECT 1 FROM opt_outs o
      WHERE o.client_id = rc.id
        AND o.channel = 'sms'
        AND o.opted_in_at IS NULL
   )
   AND NOT EXISTS (
     SELECT 1 FROM messages m
      WHERE m.org_id = e.org_id
        AND m.channel = 'sms'
        AND m.direction = 'outbound'
        AND m.provider_ref = 'workflow:' || s.template_key || ':' || e.id::text || s.ref_suffix
   )
   AND (
     s.once_per_client = false
     OR NOT EXISTS (
       SELECT 1 FROM messages p
        WHERE p.org_id = e.org_id
          AND p.client_id = rc.id
          AND p.channel = 'sms'
          AND p.direction = 'outbound'
          AND p.template_key = s.template_key
     )
   )
   AND (
     s.needs_amount = false
     OR (
       e.payload ? 'approvedAmount'
       AND COALESCE(e.payload->>'approvedAmount', '') ~ '^[0-9]+(\\.[0-9]+)?$'
       AND (e.payload->>'approvedAmount')::numeric > 0
     )
   )
   AND (
     s.needs_round = false
     OR COALESCE(e.payload->>'roundNumber', e.payload->>'round_number') IS NOT NULL
   )`.trim();
}

const SENDING_SQL = `
SELECT count(*) FILTER (WHERE sender_staff_id IS NULL)::int AS customer_n,
       count(*) FILTER (WHERE sender_staff_id IS NOT NULL)::int AS staff_n
  FROM messages
 WHERE org_id = $1::uuid
   AND direction = 'outbound'
   AND channel = 'sms'
   AND status = 'sending'
   AND COALESCE(last_attempt_at, updated_at, created_at) < $2::timestamptz`.trim();

// The dispatcher writes "the client has no phone to send to" when a person gave no number
// (src/messaging/dispatch.mjs, no_address). That is a hole in the client record, not the phone
// company saying no, so it is left out. gap-email.mjs drops the same class.
const FAILED_SQL = `
SELECT count(*) FILTER (WHERE sender_staff_id IS NULL)::int AS customer_n,
       count(*) FILTER (WHERE sender_staff_id IS NOT NULL)::int AS staff_n
  FROM messages
 WHERE org_id = $1::uuid
   AND direction = 'outbound'
   AND channel = 'sms'
   AND status = 'failed'
   AND COALESCE(last_attempt_at, updated_at, created_at) >= $2::timestamptz
   AND COALESCE(last_error, '') NOT ILIKE '%test record from a journey run%'
   AND COALESCE(last_error, '') NOT ILIKE '%to send to%'`.trim();

function namesOf(value) {
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

/**
 * smsChecks — missing SMS breaks only (the three gap:sms-* rows).
 * ctx: { db, orgId, now }. SELECT only. Never sends.
 * Returns { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
async function smsChecks(ctx = {}) {
  const db = ctx.db;
  const orgId = ctx.orgId;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  if (!db || typeof db.query !== "function") {
    return [
      row("gap:sms-sending-stuck", "skip", "No database in this run. SMS gap not read."),
      row("gap:sms-provider-failed", "skip", "No database in this run. SMS gap not read."),
      row("gap:sms-journey-zero", "skip", "No database in this run. SMS gap not read.")
    ];
  }
  if (!orgId) {
    return [
      row("gap:sms-sending-stuck", "skip", "No company in this run. SMS gap not read."),
      row("gap:sms-provider-failed", "skip", "No company in this run. SMS gap not read."),
      row("gap:sms-journey-zero", "skip", "No company in this run. SMS gap not read.")
    ];
  }

  const sendingBefore = new Date(now.getTime() - SENDING_STUCK_MINUTES * 60 * 1000);
  const failedSince = new Date(now.getTime() - FAILED_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const journeyBefore = new Date(now.getTime() - JOURNEY_GRACE_MINUTES * 60 * 1000);
  const journeySince = new Date(now.getTime() - JOURNEY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  // One failed read skips that one check, with the reason. It never turns into a PASS,
  // and it does not take the other two checks down with it.
  const read = async (id, sql, params) => {
    try {
      const got = await db.query(sql, params);
      return { row: got && got.rows ? got.rows[0] : undefined };
    } catch (err) {
      return { error: row(id, "skip", `SMS read failed: ${String((err && err.message) || err).slice(0, 160)}`) };
    }
  };
  const [sending, failed, journey] = await Promise.all([
    read("gap:sms-sending-stuck", SENDING_SQL, [orgId, sendingBefore.toISOString()]),
    read("gap:sms-provider-failed", FAILED_SQL, [orgId, failedSince.toISOString()]),
    read("gap:sms-journey-zero", buildJourneyZeroSql(), [orgId, journeyBefore.toISOString(), journeySince.toISOString()])
  ]);

  return [
    sending.error || sendingRow(sending.row),
    failed.error || failedRow(failed.row),
    journey.error || journeyRow(journey.row)
  ];
}

function sendingRow(got) {
  if (!got) return row("gap:sms-sending-stuck", "skip", "SMS sending count did not come back.");
  const customer = countOf(got.customer_n);
  const staff = countOf(got.staff_n);
  if (customer === null || staff === null) {
    return row("gap:sms-sending-stuck", "skip", "SMS sending count came back unreadable.");
  }
  if (customer + staff === 0) {
    return row(
      "gap:sms-sending-stuck",
      "PASS",
      `No customer or staff text is stuck on sending past ${SENDING_STUCK_MINUTES} minutes.`
    );
  }
  return row(
    "gap:sms-sending-stuck",
    "FAIL",
    `${side(customer, "customer")} and ${side(staff, "staff")} are stuck on sending past ${SENDING_STUCK_MINUTES} minutes.`,
    FIX.sending
  );
}

function failedRow(got) {
  if (!got) return row("gap:sms-provider-failed", "skip", "SMS failure count did not come back.");
  const customer = countOf(got.customer_n);
  const staff = countOf(got.staff_n);
  if (customer === null || staff === null) {
    return row("gap:sms-provider-failed", "skip", "SMS failure count came back unreadable.");
  }
  if (customer + staff === 0) {
    return row(
      "gap:sms-provider-failed",
      "PASS",
      `No customer or staff text failed at the phone company in the last ${FAILED_LOOKBACK_DAYS} days.`
    );
  }
  return row(
    "gap:sms-provider-failed",
    "FAIL",
    `${side(customer, "customer")} and ${side(staff, "staff")} failed at the phone company in the last ${FAILED_LOOKBACK_DAYS} days.`,
    FIX.failed
  );
}

function journeyRow(got) {
  if (!got) return row("gap:sms-journey-zero", "skip", "SMS journey count did not come back.");
  const n = countOf(got.n);
  if (n === null) return row("gap:sms-journey-zero", "skip", "SMS journey count came back unreadable.");
  if (n === 0) {
    return row(
      "gap:sms-journey-zero",
      "PASS",
      `No watched step in the last ${JOURNEY_LOOKBACK_DAYS} days is missing its text row.`
    );
  }
  const names = namesOf(got.names);
  const shown = names.slice(0, 5).join(", ");
  const tail = shown ? ` (${shown})` : "";
  const word = n === 1 ? "step" : "steps";
  return row(
    "gap:sms-journey-zero",
    "FAIL",
    `${n} ${word} that should text ${n === 1 ? "has" : "have"} no text row${tail}.`,
    FIX.journey
  );
}

// ---------------------------------------------------------------------------
// Tier 1 — the message queue, text and email. Claude, 2026-10-09.
// Five yes-or-no questions a customer would feel. All reads. No send. No write.
// ---------------------------------------------------------------------------

export const RECEIPT_AFTER_HOURS = 24;
export const RECEIPT_LOOKBACK_DAYS = 30;
export const BLOCKED_LOOKBACK_DAYS = 14;
export const REPLY_LOOKBACK_DAYS = 7;
export const REPLY_GRACE_MINUTES = 15;
export const REPLY_MIN_SAVED = 3;
export const NO_ADDRESS_LOOKBACK_DAYS = 7;

export const MSG_CHECK_IDS = Object.freeze([
  "gap:msg-sent-no-receipt",
  "gap:msg-approved-template-bad-copy",
  "gap:msg-blocked-by-sender",
  "gap:msg-inbound-unmatched",
  "gap:msg-failed-no-address"
]);

const MSG_TAIL = "Do not send from this check.";

const MSG_FIX = Object.freeze({
  receipt:
    "Read the message rows still on sent. Check the delivery receipt door for that channel is switched on, " +
    `signed and reachable (email events, text status callbacks). Do not resend. ${MSG_TAIL}`,
  copy:
    "Write the real copy, or set the template back to not approved. The sender holds placeholder and draft " +
    `copy, so no customer ever gets it. ${MSG_TAIL}`,
  blocked:
    "Read blocked_reason on each row. recipient_unknown means no client was attached. A rule code means the " +
    "copy broke a wording rule. draft_template or placeholder_copy means the copy is not finished. " +
    MSG_TAIL,
  reply:
    "Read the message.inbound event and the saved message that share its sid. Lost means the reply handler " +
    "did not run. Unlinked from a saved number means the phone match failed, and a STOP may not have stuck. " +
    MSG_TAIL,
  address:
    "Read last_error and the client record. Add the missing phone or email, or stop the step that messages a " +
    `client we cannot reach. ${MSG_TAIL}`
});

/* A test address is one nobody is selling to. The first three parts are the pattern gap-consent.mjs and
   gap-portal.mjs use for a test client (a drift test holds this to gap-consent.mjs). The last part adds
   the e2e+, demo+ and test+ addresses the test runners mint on a real domain: the shared pattern alone
   lets them through. Measured 2026-10-09 on production: 55 of 61 clients have a test-style address and 52 of those
   are not flagged is_demo, so the demo flag alone is not enough. Same shape as gap-payments.mjs. */
export const TEST_ADDRESS_RE =
  String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$|^(e2e|demo|test)\+`;

/* Test traffic is not a customer. Every message read leaves out a message that is flagged demo, a message
   whose client is flagged demo or synthetic or has a test address, and a message sent to a test address
   itself (a message can go to a different address than the client's saved one). `param` is the number of
   the query parameter that holds TEST_ADDRESS_RE. Same idea as the journey read above. */
function realMessageSql(param) {
  return `COALESCE(m.is_demo, false) = false
   AND NOT EXISTS (
     SELECT 1 FROM clients d
      WHERE d.id = m.client_id
        AND (COALESCE(d.is_demo, false) = true
          OR COALESCE(d.custom_fields ->> 'synthetic', '') = 'true'
          OR COALESCE(d.email, '') ~* ${param}::text)
   )
   AND COALESCE(m.to_address, '') !~* ${param}::text`;
}

// These two patterns are the sender's own copy guard, written for Postgres:
//   /lorem\s+ipsum/i in src/messaging/dispatch.mjs, and /\[DRAFT\b/i in src/messaging/draft-guard.mjs.
// Postgres spells a word edge \y, not \b. A test holds both files to these exact patterns.
const LOREM_PATTERN = "lorem\\s+ipsum";
const DRAFT_PATTERN = "\\[DRAFT\\y";

/* 1. A message was handed to the provider and never got a receipt back. status sent stays put until
   a delivered, bounced or failed receipt moves it (src/adapters/resend-events.mjs for email, and the
   text status callback adapter beside it). Text and email only: a voice call never gets one. The clock is the
   hand-off time. A 30 day floor keeps ancient history from holding the check red forever. */
export const SENT_NO_RECEIPT_SQL = `
SELECT m.channel,
       count(*)::int AS n,
       min(COALESCE(m.last_attempt_at, m.created_at)) AS oldest
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.status = 'sent'
   AND m.channel IN ('sms', 'email')
   AND COALESCE(m.last_attempt_at, m.created_at) < $2::timestamptz
   AND COALESCE(m.last_attempt_at, m.created_at) >= $3::timestamptz
   AND ${realMessageSql("$4")}
 GROUP BY m.channel
 ORDER BY m.channel`.trim();

/* 2. A template marked ready (compliance_passed) still holds copy the sender will refuse. */
export const BAD_COPY_SQL = `
SELECT t.channel,
       t.template_key,
       (COALESCE(t.body, '') ~* '${LOREM_PATTERN}' OR COALESCE(t.subject, '') ~* '${LOREM_PATTERN}') AS lorem,
       (COALESCE(t.body, '') ~* '${DRAFT_PATTERN}' OR COALESCE(t.subject, '') ~* '${DRAFT_PATTERN}') AS draft
  FROM message_templates t
 WHERE t.org_id = $1::uuid
   AND t.compliance_passed = true
   AND (
        COALESCE(t.body, '') ~* '${LOREM_PATTERN}' OR COALESCE(t.subject, '') ~* '${LOREM_PATTERN}'
     OR COALESCE(t.body, '') ~* '${DRAFT_PATTERN}' OR COALESCE(t.subject, '') ~* '${DRAFT_PATTERN}'
   )
 ORDER BY t.template_key
 LIMIT 100`.trim();

/* 3. Our own gate or copy guard stopped a customer message. The reason sits in blocked_reason for a
   gate block, and in last_error for the copy guards (dispatch.mjs writes draft_template and
   placeholder_copy there). Two blocks are the system working, so they stay out: a person who said STOP
   (opted_out), and a reserved test address like example.com (the sender writes "test address:..."). */
export const BLOCKED_SQL = `
SELECT COALESCE(NULLIF(btrim(m.blocked_reason), ''), NULLIF(btrim(m.last_error), ''), 'no reason saved') AS reason,
       COALESCE(m.template_key, '(no template)') AS template_key,
       count(*)::int AS n
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.status = 'blocked'
   AND m.created_at >= $2::timestamptz
   AND COALESCE(m.blocked_reason, '') <> 'opted_out'
   AND COALESCE(m.last_error, '') NOT ILIKE 'test address:%'
   AND ${realMessageSql("$3")}
 GROUP BY 1, 2
 ORDER BY n DESC, 1, 2
 LIMIT 50`.trim();

/* 4. Customer replies. Starts from the door (the message.inbound event, which carries the sender's
   number) and looks for what the handler saved (the inbound message row with the same sid).
   Our own lines are left out. A number that has ever been the "to" of a message.inbound event is one of
   ours: measured 2026-10-09, 280 of the 283 inbound events were our sending number texting our test
   line, and our own copy came back through our own door. They are not customers.
   lost_n      a real reply older than the grace time and no message row was saved.
   matchable_n a saved reply with no client, where the sender's number is a saved client phone
               (last 10 digits), and that client existed before the text came in. A sure break.
   unlinked_n  a saved reply with no client at all. */
export const REPLY_SQL = `
SELECT count(*) FILTER (WHERE r.own)::int AS own_n,
       count(*) FILTER (WHERE NOT r.own)::int AS real_n,
       count(*) FILTER (WHERE NOT r.own AND r.msg_id IS NOT NULL)::int AS saved_n,
       count(*) FILTER (WHERE NOT r.own AND r.sid IS NOT NULL AND r.msg_id IS NULL
                          AND r.created_at < $3::timestamptz)::int AS lost_n,
       count(*) FILTER (WHERE NOT r.own AND r.msg_id IS NOT NULL AND r.client_id IS NULL)::int AS unlinked_n,
       count(*) FILTER (WHERE NOT r.own AND r.msg_id IS NOT NULL AND r.client_id IS NULL
                          AND length(r.from10) = 10
                          AND EXISTS (
                            SELECT 1 FROM clients c
                             WHERE c.org_id = $1::uuid
                               AND right(regexp_replace(COALESCE(c.phone, ''), '[^0-9]', '', 'g'), 10) = r.from10
                               AND c.created_at <= r.created_at
                          ))::int AS matchable_n
  FROM (
    SELECT d.sid, d.from10, d.created_at, m.id AS msg_id, m.client_id,
           (d.from10 <> '' AND d.from10 IN (
              SELECT right(regexp_replace(ev.payload->>'to', '[^0-9]', '', 'g'), 10)
                FROM events ev
               WHERE ev.org_id = $1::uuid
                 AND ev.name = 'message.inbound'
                 AND COALESCE(ev.payload->>'to', '') <> ''
           )) AS own
      FROM (
        SELECT e.created_at,
               e.payload->>'sid' AS sid,
               right(regexp_replace(COALESCE(e.payload->>'from', ''), '[^0-9]', '', 'g'), 10) AS from10
          FROM events e
         WHERE e.org_id = $1::uuid
           AND e.name = 'message.inbound'
           AND e.created_at >= $2::timestamptz
           AND COALESCE(e.is_demo, false) = false
           AND COALESCE(e.payload->>'channel', 'sms') = 'sms'
      ) d
      LEFT JOIN LATERAL (
        SELECT mm.id, mm.client_id
          FROM messages mm
         WHERE mm.org_id = $1::uuid
           AND mm.direction = 'inbound'
           AND d.sid IS NOT NULL
           AND mm.provider_ref = d.sid
         LIMIT 1
      ) m ON true
  ) r`.trim();

/* 5. A message failed because there was nowhere to send it. The dispatcher writes
   "the client has no <phone or email> to send to" (src/messaging/dispatch.mjs, no_address). The two
   failure checks (gap:sms-provider-failed, email:provider-fail) leave exactly that line out on purpose,
   with the same %to send to% pattern. This is the other half of the same split. */
export const NO_ADDRESS_SQL = `
SELECT m.channel,
       COALESCE(m.template_key, '(no template)') AS template_key,
       count(*)::int AS n
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND m.status = 'failed'
   AND COALESCE(m.last_attempt_at, m.updated_at, m.created_at) >= $2::timestamptz
   AND COALESCE(m.last_error, '') ILIKE '%to send to%'
   AND ${realMessageSql("$3")}
 GROUP BY 1, 2
 ORDER BY n DESC, 1, 2
 LIMIT 50`.trim();

function plural(n, one, many) {
  return n === 1 ? one : many;
}

function clipText(value, max) {
  const s = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function channelWord(channel, n) {
  return String(channel) === "sms" ? plural(n, "text", "texts") : plural(n, "email", "emails");
}

function ageWord(from, now) {
  const t = from instanceof Date ? from.getTime() : Date.parse(from);
  if (!Number.isFinite(t)) return null;
  const ms = Math.max(0, now.getTime() - t);
  const days = Math.floor(ms / 86400000);
  if (days >= 2) return `${days} days`;
  const hours = Math.floor(ms / 3600000);
  return `${hours} ${plural(hours, "hour", "hours")}`;
}

function msgSkips(detail) {
  return MSG_CHECK_IDS.map((id) => row(id, "skip", detail));
}

/** SELECT only. Returns every row, or one skip row with the reason when the read throws. */
async function readRows(db, id, sql, params) {
  try {
    const got = await db.query(sql, params);
    return { rows: got && Array.isArray(got.rows) ? got.rows : null };
  } catch (err) {
    return { error: row(id, "skip", `Message read failed: ${String((err && err.message) || err).slice(0, 160)}`) };
  }
}

/** A list of "x n" pieces, biggest first, at most `max` shown. A row with a zero count is not a piece. */
function tally(rows, key, max) {
  const by = new Map();
  for (const r of rows) {
    const n = countOf(r.n) || 0;
    if (n === 0) continue;
    const k = clipText(r[key], 60) || "(blank)";
    by.set(k, (by.get(k) || 0) + n);
  }
  const list = [...by.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const shown = list.slice(0, max).map(([k, n]) => `${k} x${n}`);
  if (list.length > max) shown.push(`${list.length - max} more`);
  return shown.join(", ");
}

function receiptRow(got, now) {
  const id = "gap:msg-sent-no-receipt";
  if (!got) return row(id, "skip", "The sent-message count did not come back.");
  let total = 0;
  const parts = [];
  let oldest = null;
  for (const r of got) {
    const n = countOf(r && r.n);
    if (n === null) return row(id, "skip", "The sent-message count came back unreadable.");
    if (n === 0) continue;
    total += n;
    parts.push(`${n} ${channelWord(r.channel, n)}`);
    const t = r.oldest instanceof Date ? r.oldest.getTime() : Date.parse(r.oldest);
    if (Number.isFinite(t) && (oldest === null || t < oldest)) oldest = t;
  }
  if (total === 0) {
    return row(
      id,
      "PASS",
      `No text or email has sat on sent for over ${RECEIPT_AFTER_HOURS} hours with no delivery receipt (last ${RECEIPT_LOOKBACK_DAYS} days, test traffic left out).`
    );
  }
  const age = oldest === null ? null : ageWord(new Date(oldest), now);
  const tail = age ? ` The oldest left us ${age} ago.` : "";
  return row(
    id,
    "FAIL",
    `${total} ${plural(total, "message", "messages")} (${parts.join(", ")}) went out and got no delivery receipt for over ${RECEIPT_AFTER_HOURS} hours.${tail}`,
    MSG_FIX.receipt
  );
}

function badCopyRow(got) {
  const id = "gap:msg-approved-template-bad-copy";
  if (!got) return row(id, "skip", "The template list did not come back.");
  if (got.length === 0) {
    return row(id, "PASS", "No template marked ready holds placeholder words or a draft mark.");
  }
  // The read only returns flagged rows. A row that flags nothing is not a finding: it is a read
  // that came back in a shape we do not know, so it skips and never reads as a break or a PASS.
  const flagged = got.filter((r) => r && (r.lorem === true || r.draft === true));
  if (flagged.length === 0) return row(id, "skip", "The template list came back unreadable.");
  const lorem = flagged.filter((r) => r.lorem === true).length;
  const draft = flagged.filter((r) => r.draft === true).length;
  const names = flagged.slice(0, 5).map((r) => clipText(r.template_key, 60)).filter(Boolean);
  const more = flagged.length > names.length ? ` and ${flagged.length - names.length} more` : "";
  const kinds = [];
  if (lorem) kinds.push(`${lorem} lorem ipsum`);
  if (draft) kinds.push(`${draft} ${plural(draft, "draft mark", "draft marks")}`);
  return row(
    id,
    "FAIL",
    `${flagged.length} ${plural(flagged.length, "template is", "templates are")} marked ready but still ${plural(flagged.length, "holds", "hold")} placeholder words (${kinds.join(", ")}). The sender holds these, so the customer gets nothing. First: ${names.join(", ")}${more}.`,
    MSG_FIX.copy
  );
}

function blockedRow(got) {
  const id = "gap:msg-blocked-by-sender";
  if (!got) return row(id, "skip", "The blocked-message list did not come back.");
  let total = 0;
  for (const r of got) {
    const n = countOf(r && r.n);
    if (n === null) return row(id, "skip", "The blocked-message count came back unreadable.");
    total += n;
  }
  if (total === 0) {
    return row(
      id,
      "PASS",
      `Our own gate stopped no customer message in the last ${BLOCKED_LOOKBACK_DAYS} days (opt-outs, test addresses and test clients left out).`
    );
  }
  return row(
    id,
    "FAIL",
    `${total} customer ${plural(total, "message was", "messages were")} stopped by our own gate in the last ${BLOCKED_LOOKBACK_DAYS} days. Why: ${tally(got, "reason", 4)}. Which: ${tally(got, "template_key", 4)}.`,
    MSG_FIX.blocked
  );
}

function replyRow(got) {
  const id = "gap:msg-inbound-unmatched";
  if (!got) return row(id, "skip", "The customer reply count did not come back.");
  const own = countOf(got.own_n);
  const real = countOf(got.real_n);
  const saved = countOf(got.saved_n);
  const lost = countOf(got.lost_n);
  const unlinked = countOf(got.unlinked_n);
  const matchable = countOf(got.matchable_n);
  if ([own, real, saved, lost, unlinked, matchable].some((x) => x === null)) {
    return row(id, "skip", "The customer reply count came back unreadable.");
  }
  const ownTail = own > 0 ? ` ${own} ${plural(own, "text", "texts")} from our own lines left out.` : "";
  const problems = [];
  if (lost > 0) {
    problems.push(
      `${lost} customer ${plural(lost, "text", "texts")} reached our door and no message was saved (older than ${REPLY_GRACE_MINUTES} minutes)`
    );
  }
  if (matchable > 0) {
    problems.push(
      `${matchable} ${plural(matchable, "text came", "texts came")} from a saved client's phone number but ${plural(matchable, "was", "were")} saved with no client attached`
    );
  }
  if (saved >= REPLY_MIN_SAVED && unlinked * 2 > saved) {
    problems.push(`${unlinked} of ${saved} saved customer replies have no person attached`);
  }
  if (problems.length > 0) {
    return row(
      id,
      "FAIL",
      `In the last ${REPLY_LOOKBACK_DAYS} days: ${problems.join("; ")}.${ownTail}`,
      MSG_FIX.reply
    );
  }
  const judge = saved < REPLY_MIN_SAVED
    ? ` Too few to judge the share with no person attached (needs ${REPLY_MIN_SAVED}).`
    : "";
  return row(
    id,
    "PASS",
    `${real} customer reply ${plural(real, "text", "texts")} in the last ${REPLY_LOOKBACK_DAYS} days. None lost. None came from a saved client's number and landed with no person.${judge}${ownTail}`
  );
}

function noAddressRow(got) {
  const id = "gap:msg-failed-no-address";
  if (!got) return row(id, "skip", "The no-address failure list did not come back.");
  let total = 0;
  const pieces = [];
  for (const r of got) {
    const n = countOf(r && r.n);
    if (n === null) return row(id, "skip", "The no-address failure count came back unreadable.");
    if (n === 0) continue;
    total += n;
    pieces.push(`${clipText(r.template_key, 60)} (${channelWord(r.channel, 1)}) x${n}`);
  }
  if (total === 0) {
    return row(
      id,
      "PASS",
      `No message failed for a missing phone or email in the last ${NO_ADDRESS_LOOKBACK_DAYS} days (test clients left out).`
    );
  }
  return row(
    id,
    "FAIL",
    `${total} ${plural(total, "message", "messages")} failed in the last ${NO_ADDRESS_LOOKBACK_DAYS} days because the client had no phone or email to send to: ${pieces.slice(0, 4).join(", ")}${pieces.length > 4 ? `, ${pieces.length - 4} more` : ""}.`,
    MSG_FIX.address
  );
}

/**
 * msgChecks — the five gap:msg-* rows. ctx: { db, orgId, now }. SELECT only. Never sends.
 * One failed read is one skip row with the reason. It never turns into a PASS.
 */
async function msgChecks(ctx = {}) {
  const db = ctx.db;
  const orgId = ctx.orgId;
  const now = ctx.now instanceof Date ? ctx.now : new Date();
  if (!db || typeof db.query !== "function") {
    return msgSkips("No database in this run. Message queue gap not read.");
  }
  if (!orgId) {
    return msgSkips("No company in this run. Message queue gap not read.");
  }

  const ago = (ms) => new Date(now.getTime() - ms).toISOString();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  const [receipt, copy, blocked, reply, address] = await Promise.all([
    readRows(db, MSG_CHECK_IDS[0], SENT_NO_RECEIPT_SQL, [
      orgId,
      ago(RECEIPT_AFTER_HOURS * HOUR),
      ago(RECEIPT_LOOKBACK_DAYS * DAY),
      TEST_ADDRESS_RE
    ]),
    readRows(db, MSG_CHECK_IDS[1], BAD_COPY_SQL, [orgId]),
    readRows(db, MSG_CHECK_IDS[2], BLOCKED_SQL, [orgId, ago(BLOCKED_LOOKBACK_DAYS * DAY), TEST_ADDRESS_RE]),
    readRows(db, MSG_CHECK_IDS[3], REPLY_SQL, [
      orgId,
      ago(REPLY_LOOKBACK_DAYS * DAY),
      ago(REPLY_GRACE_MINUTES * 60 * 1000)
    ]),
    readRows(db, MSG_CHECK_IDS[4], NO_ADDRESS_SQL, [orgId, ago(NO_ADDRESS_LOOKBACK_DAYS * DAY), TEST_ADDRESS_RE])
  ]);

  return [
    receipt.error || receiptRow(receipt.rows, now),
    copy.error || badCopyRow(copy.rows),
    blocked.error || blockedRow(blocked.rows),
    reply.error || replyRow(reply.rows && reply.rows[0]),
    address.error || noAddressRow(address.rows)
  ];
}

/**
 * gapChecks — the message queue. The three gap:sms-* rows first, then the five gap:msg-* rows.
 * ctx: { db, orgId, now }. SELECT only. Never sends.
 * Returns { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
  const [sms, msg] = await Promise.all([smsChecks(ctx), msgChecks(ctx)]);
  return [...sms, ...msg];
}
