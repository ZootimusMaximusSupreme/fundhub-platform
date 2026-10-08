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
    id: "instant-watch:pipeline:outbound",
    where: "src/pulse/instant-watch.mjs",
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
   AND (rc.id IS NOT NULL OR btrim(COALESCE(e.payload->>'email', '')) <> '')
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

const FAILED_SQL = `
SELECT count(*) FILTER (WHERE sender_staff_id IS NULL)::int AS customer_n,
       count(*) FILTER (WHERE sender_staff_id IS NOT NULL)::int AS staff_n
  FROM messages
 WHERE org_id = $1::uuid
   AND direction = 'outbound'
   AND channel = 'sms'
   AND status = 'failed'
   AND COALESCE(last_attempt_at, updated_at, created_at) >= $2::timestamptz
   AND COALESCE(last_error, '') NOT ILIKE '%test record from a journey run%'`.trim();

function namesOf(value) {
  if (Array.isArray(value)) return value.map((x) => String(x)).filter(Boolean);
  if (value == null || value === "") return [];
  return [String(value)];
}

/**
 * gapChecks — missing SMS breaks only.
 * ctx: { db, orgId, now }. SELECT only. Never sends.
 * Returns { id, status, detail, suggestedFix } with status PASS, FAIL, or skip.
 */
export async function gapChecks(ctx = {}) {
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
