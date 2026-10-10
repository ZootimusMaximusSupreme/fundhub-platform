// Hand-offs that never happened. Read only. Report only.
//
// Systemic hole: an event is saved (a lead signs up, a lead leaves a number, a
// call is booked, a call ends) and the workflow that should answer it never
// writes a message. Those workflows run only on Inngest, leave no row of their
// own, and their slice rows say "not checked". So this lane reads the EFFECT:
// the message (or task) that should exist, minus the people it should skip.
//
// Five tripwires, one per place a customer would feel it:
//   handoff:lead-first-touches-missing   welcome email, finish-application nudge, never-booked chase
//   handoff:contact-no-followup          the 15-minute note and the $197 offer after /roadmap contact
//   handoff:booking-no-confirm           the booking confirm email (it carries portal access)
//   handoff:reminder-missing             the 24-hour and 2-hour reminder texts
//   handoff:call-outcome-no-followup     no-show recovery, the offer email, the declined-call task
//
// What each one copies from the workflow (read the file when you change a gate):
//   src/workflows/s-00-welcome.mjs, s-02-incomplete-survey-nudge.mjs, s-nobook-chase.mjs,
//   slo-genuine-followup.mjs, slo-no-reply-197.mjs, s-04b-booking-reminders.mjs,
//   s-05a-no-show-recovery.mjs, s-offer-bucket.mjs, s-08-post-call-funding-declined.mjs.
// A test reads those files and fails if a template key here drifts from them.
// Nothing here reads a repo file at run time: the live bundle does not carry them.
//
// Not a finding here (other lanes own them): a message that was queued and then
// failed, bounced or was blocked (gap-email, gap-sms), a stuck queue
// (pipeline:outbound), the company outbound switch. This lane asks only whether
// the row was ever written.
//
// Never sends. Never writes. Never flips the outbound switch. One tripwire stays
// Recon (AG-07); this file does not add another watcher.

export const CHECK_IDS = Object.freeze([
  "handoff:lead-first-touches-missing",
  "handoff:contact-no-followup",
  "handoff:booking-no-confirm",
  "handoff:reminder-missing",
  "handoff:call-outcome-no-followup"
]);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** A miss is read for this long after the event. Seven days keeps a red on screen for a week. */
export const LOOKBACK_DAYS = 7;

/** Welcome email goes at once. 30 minutes is the owner's grace. */
export const WELCOME_GRACE_MIN = 30;
/** S-02 waits 20 minutes, then nudges. 25 minutes is the grace. */
export const NUDGE_GRACE_MIN = 25;
/** A survey that lands this long after the sign-up still counts as "finished" (S-02 checks at 20). */
export const NUDGE_SURVEY_SLACK_MIN = 25;
/** S-NOBOOK waits 2 hours. Another 30 minutes of grace so a run in flight is not a miss. */
export const NOBOOK_GRACE_MIN = 150;
/** A booking made up to 2 hours 10 minutes after the survey stops the chase before message 1. */
export const NOBOOK_BOOKED_SLACK_MIN = 130;
/** The first /roadmap follow-up waits 15 minutes. 30 minutes is the grace. */
export const CONTACT_M1_GRACE_MIN = 30;
/** Paid within this long of the contact: the first follow-up correctly does not go. */
export const CONTACT_PAID_SLACK_MIN = 20;
/** The $197 offer waits 24 hours. 25 hours is the grace. */
export const CONTACT_197_GRACE_HOURS = 25;
/** Paid within this long of the contact: the $197 offer correctly does not go. */
export const CONTACT_197_PAID_SLACK_HOURS = 25;
/** The confirm goes at once. 20 minutes is the grace. */
export const CONFIRM_GRACE_MIN = 20;
/** The 24-hour reminder was due 24 hours before the call. Read it once the call is under 22 hours away. */
export const REMIND_24H_WITHIN_HOURS = 22;
/** Booked this far ahead or more: the 24-hour reminder really was due (5 minute skew plus margin). */
export const REMIND_24H_BOOKED_AHEAD_HOURS = 25;
/** The 2-hour reminder was due 2 hours before the call. Read it once the call is under 110 minutes away. */
export const REMIND_2H_WITHIN_MIN = 110;
/** Booked this far ahead or more: the 2-hour reminder really was due. */
export const REMIND_2H_BOOKED_AHEAD_MIN = 130;
/** A call that already started is read for this long, so a daily run still sees it. */
export const REMIND_PAST_HOURS = 72;
/** A booking may be made this far before the call and still be read. */
export const REMIND_BOOKED_LOOKBACK_DAYS = 30;
/** No-show recovery touch 1 goes at once. */
export const NOSHOW_GRACE_MIN = 20;
/** The offer email goes at once. */
export const OFFER_GRACE_MIN = 30;

export const TEMPLATES = Object.freeze({
  welcome: "EMAIL-S00-WELCOME",
  nudge: "EMAIL-S02-FINISH-APPLICATION",
  nobook: "EMAIL-NOBOOK-01",
  confirmEmail: "EMAIL-S04-01-CONFIRM",
  confirmSms: "SMS-S04-01-CONFIRM",
  remind24h: "SMS-S04-02-REMIND-24H",
  remind2h: "SMS-S04-03-REMIND-2H",
  noshow: "EMAIL-S05A-NOSHOW-RECOVERY",
  offerPrefix: "EMAIL-OFFER-"
});

/** The first /roadmap follow-up. Any of these is "somebody followed up". */
export const CONTACT_M1_KEYS = Object.freeze([
  "EMAIL-SLO-GENUINE-01",
  "SMS-SLO-GENUINE-01",
  "EMAIL-SLO-FIRST5-01",
  "SMS-SLO-FIRST5-01",
  "EMAIL-SLO-GIFT-01",
  "SMS-SLO-GIFT-01",
  "EMAIL-SLO-COUPON-01",
  "SMS-SLO-COUPON-01"
]);

/** The $197 offer. */
export const CONTACT_197_KEYS = Object.freeze(["EMAIL-SLO-197", "SMS-SLO-197"]);

/**
 * These go out only after the person REPLIED (slo-genuine-followup reply path).
 * A reply takes them off the $197 path, so any of these means no $197 is due.
 * Read from the messages, not only from the slo_replied_at flag, so a flag that
 * was cleared by a clean-up does not turn a replied person into a miss.
 */
export const CONTACT_REPLIED_KEYS = Object.freeze([
  "EMAIL-SLO-COUPON-01",
  "SMS-SLO-COUPON-01",
  "EMAIL-SLO-FIRST5-REPLY",
  "SMS-SLO-FIRST5-REPLY"
]);

/** offerKey values that s-offer-bucket turns into an EMAIL-OFFER-* template. */
export const OFFER_KEYS = Object.freeze([
  "SOFT_PULL",
  "FUNDING_DFY",
  "REPAIR_DFY",
  "REPAIR_TRIAL",
  "UWIQ_DELIVERABLES",
  "FUNDING_MASTERY",
  "none",
  "not_a_fit"
]);

const SCOPE_FIX =
  "Do not send from this check. Do not change the outbound switch. Recon stays the one tripwire.";

/* ------------------------------------------------------------------ SQL pieces */

/**
 * SQL for "this address is one of ours or a test". Copies classifyVisitor
 * (src/slo/visitor.mjs) and the test-email tag (src/demo/test-identity.mjs):
 * a company domain, an example domain, an e2e / sim / test word in the part
 * before the @, or the +fhtest tag. These people are not customers.
 */
export function testAddressSql(addr) {
  return `(
    split_part(${addr}, '@', 2) IN ('fundhub.ai', 'example.com', 'example.net', 'example.org')
    OR split_part(${addr}, '@', 2) LIKE '%.fundhub.ai'
    OR split_part(${addr}, '@', 1) ~ '(^|[.+_-])(e2e|sim|test)([.+_-]|$)'
    OR split_part(${addr}, '@', 1) ~ '[+]fhtest'
  )`;
}

const EVENT_EMAIL = (alias) => `lower(btrim(COALESCE(${alias}.payload->>'email', '')))`;

const CLIENT_BY_EMAIL = (alias, emailExpr) => `(
    SELECT c0.id FROM clients c0
     WHERE c0.org_id = ${alias}.org_id
       AND ${emailExpr} <> ''
       AND lower(c0.email) = ${emailExpr}
     LIMIT 1
  )`;

/** What a person is called in the detail: the client code, else a masked address. */
const LABEL = `COALESCE(
    NULLIF(l.client_code, ''),
    CASE WHEN l.em <> '' THEN left(l.em, 1) || '***@' || split_part(l.em, '@', 2) END,
    l.cid::text
  )`;

/**
 * The people behind a list of event names. $1 org, $2 event names, $3 window
 * start, $4 cutoff (an event newer than this is still in flight).
 * A person is the client on the event, else the client with the same email
 * (the workflow finds them the same way: resolveClient). Left out: demo events,
 * demo clients, test or company addresses, and anyone who opted out of BOTH channels.
 */
export function leadCte() {
  return `ev AS (
  SELECT e.id, e.org_id, e.name, e.created_at, e.payload,
         ${EVENT_EMAIL("e")} AS em,
         COALESCE(e.client_id, ${CLIENT_BY_EMAIL("e", EVENT_EMAIL("e"))}) AS cid
    FROM events e
   WHERE e.org_id = $1::uuid
     AND e.name = ANY($2::text[])
     AND COALESCE(e.is_demo, false) = false
     AND e.created_at >= $3::timestamptz
     AND e.created_at <  $4::timestamptz
),
lead AS (
  SELECT ev.*, c.client_code, c.phone AS cphone
    FROM ev
    LEFT JOIN clients c ON c.id = ev.cid
   WHERE (ev.cid IS NOT NULL OR ev.em <> '')
     AND COALESCE(c.is_demo, false) = false
     AND NOT (COALESCE(c.dnd_email, false) AND COALESCE(c.dnd_sms, false))
     AND NOT ${testAddressSql("COALESCE(NULLIF(ev.em, ''), lower(btrim(COALESCE(c.email, ''))))")}
)`;
}

/** The tail every branch ends with: how many people, the newest, and who. */
function tail(from = "lead l") {
  return `SELECT count(DISTINCT COALESCE(l.cid::text, l.em))::int AS n,
       max(l.created_at) AS newest,
       (array_agg(${LABEL} ORDER BY l.created_at DESC))[1] AS sample
  FROM ${from}`;
}

/** A message of this key, to this person, written at or after the event. */
function messageAfter(keysSql, alias = "l") {
  return `EXISTS (
       SELECT 1 FROM messages m
        WHERE m.org_id = ${alias}.org_id
          AND m.client_id = ${alias}.cid
          AND m.direction = 'outbound'
          AND m.template_key ${keysSql}
          AND m.created_at >= ${alias}.created_at
     )`;
}

/** A message of this key, to this person, at any time (the workflow locks once per client). */
function messageEver(keysSql, alias = "l") {
  return `EXISTS (
       SELECT 1 FROM messages m
        WHERE m.org_id = ${alias}.org_id
          AND m.client_id = ${alias}.cid
          AND m.direction = 'outbound'
          AND m.template_key ${keysSql}
     )`;
}

/**
 * ClickFunnels posts one webhook per survey screen. A repeat of the same event
 * name, address and funnel inside 6 hours is stored but starts no run
 * (src/adapters/clickfunnels.mjs isRepeatFunnelPost). It is not a miss.
 */
const IS_SUPPRESSED_REPEAT = `(
       l.em <> ''
       AND EXISTS (
         SELECT 1 FROM events p
          WHERE p.org_id = l.org_id
            AND p.name = l.name
            AND p.created_at < l.created_at
            AND p.created_at > l.created_at - interval '6 hours'
            AND lower(btrim(COALESCE(p.payload->>'email', ''))) = l.em
            AND COALESCE(p.payload->>'funnel', '') = COALESCE(l.payload->>'funnel', '')
         )
     )`;

const SURVEY_WITHIN = (minutes) => `EXISTS (
       SELECT 1 FROM events s
        WHERE s.org_id = l.org_id
          AND s.name = 'survey.submitted'
          AND s.created_at <= l.created_at + interval '${minutes} minutes'
          AND (
            (l.cid IS NOT NULL AND s.client_id = l.cid)
            OR (l.em <> '' AND lower(btrim(COALESCE(s.payload->>'email', ''))) = l.em)
          )
     )`;

/** Same booking test as s-nobook-chase hasBooked(), limited to bookings that came before message 1. */
const BOOKED_WITHIN = (minutes) => `EXISTS (
       SELECT 1 FROM events b
        WHERE b.org_id = l.org_id
          AND b.name = 'booking.created'
          AND b.created_at <= l.created_at + interval '${minutes} minutes'
          AND (
            (l.cid IS NOT NULL AND b.client_id = l.cid)
            OR (b.client_id IS NULL AND l.em <> ''
                AND lower(COALESCE(b.payload->>'email', '')) = l.em)
            OR (b.client_id IS NULL
                AND length(regexp_replace(COALESCE(l.cphone, ''), '\\D', '', 'g')) >= 10
                AND right(regexp_replace(COALESCE(b.payload->>'phone', ''), '\\D', '', 'g'), 10)
                  = right(regexp_replace(l.cphone, '\\D', '', 'g'), 10))
          )
     )`;

/* ------------------------------------------------------------------ check 1: first touches */

/** $1 org, $2 ['entry.captured'], $3 window start, $4 cutoff. Welcome is once per client, so any welcome counts. */
export const WELCOME_SQL = `
/* gap:handoff-welcome */
WITH ${leadCte()}
${tail()}
 WHERE NOT ${messageEver(`= '${TEMPLATES.welcome}'`)}`.trim();

/** $1 org, $2 ['entry.captured'], $3 window start, $4 cutoff. */
export const NUDGE_SQL = `
/* gap:handoff-nudge */
WITH ${leadCte()}
${tail()}
 WHERE NOT ${IS_SUPPRESSED_REPEAT}
   AND NOT ${SURVEY_WITHIN(NUDGE_SURVEY_SLACK_MIN)}
   AND NOT ${messageAfter(`= '${TEMPLATES.nudge}'`)}`.trim();

/** $1 org, $2 ['survey.submitted'], $3 window start, $4 cutoff. */
export const NOBOOK_SQL = `
/* gap:handoff-nobook */
WITH ${leadCte()}
${tail()}
 WHERE NOT ${IS_SUPPRESSED_REPEAT}
   AND NOT ${BOOKED_WITHIN(NOBOOK_BOOKED_SLACK_MIN)}
   AND NOT ${messageAfter(`= '${TEMPLATES.nobook}'`)}`.trim();

/* ------------------------------------------------------------------ check 2: /roadmap contact */

/**
 * People who left an email on /roadmap. $1 org, $2 window start, $3 cutoff.
 * eligibleForGenuineM1 (slo-genuine-followup.mjs): actor "person", an email, not a test address.
 */
function contactCte() {
  return `ct AS (
  SELECT e.id, e.org_id, e.created_at,
         ${EVENT_EMAIL("e")} AS em,
         ${CLIENT_BY_EMAIL("e", EVENT_EMAIL("e"))} AS cid
    FROM events e
   WHERE e.org_id = $1::uuid
     AND e.name = 'slo.contact_started'
     AND COALESCE(e.is_demo, false) = false
     AND e.payload->>'actor' = 'person'
     AND ${EVENT_EMAIL("e")} <> ''
     AND NOT ${testAddressSql(EVENT_EMAIL("e"))}
     AND e.created_at >= $2::timestamptz
     AND e.created_at <  $3::timestamptz
),
l AS (
  SELECT ct.*, c.client_code, c.custom_fields
    FROM ct
    LEFT JOIN clients c ON c.id = ct.cid
   WHERE COALESCE(c.is_demo, false) = false
)`;
}

/** hasPaidDiagnostic(): a paid diagnostic link, by client or by email, paid soon enough to stop the note. */
const PAID_WITHIN = (interval) => `EXISTS (
       SELECT 1 FROM payment_links pl
         JOIN clients pc ON pc.id = pl.client_id
        WHERE pl.org_id = l.org_id
          AND pl.purpose = 'diagnostic'
          AND COALESCE(pl.is_demo, false) = false
          AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)
          AND COALESCE(pl.paid_at, pl.updated_at) <= l.created_at + interval '${interval}'
          AND ((l.cid IS NOT NULL AND pl.client_id = l.cid) OR lower(pc.email) = l.em)
     )`;

const keyList = (keys) => `IN (${keys.map((k) => `'${k}'`).join(", ")})`;

/**
 * $1 org, $2 window start, $3 cutoff.
 * The first note goes ONCE per person (slo-genuine-followup claims the
 * slo_genuine_m1_sent_at lock), but /roadmap saves one slo.contact_started row
 * per email PER DAY. A second-day row correctly gets no note ("already_sent_m1"),
 * so a first note from ANY day counts, the way the welcome does. A note "after
 * this row" would call a returning person a miss.
 */
export const CONTACT_M1_SQL = `
/* gap:handoff-contact-m1 */
WITH ${contactCte()}
${tail("l")}
 WHERE NOT ${PAID_WITHIN(`${CONTACT_PAID_SLACK_MIN} minutes`)}
   AND NOT ${messageEver(keyList(CONTACT_M1_KEYS))}`.trim();

/** $1 org, $2 window start, $3 cutoff. Only people who got the first note: no first note is the branch above. */
export const CONTACT_197_SQL = `
/* gap:handoff-contact-197 */
WITH ${contactCte()}
${tail("l")}
 WHERE NOT ${PAID_WITHIN(`${CONTACT_197_PAID_SLACK_HOURS} hours`)}
   AND COALESCE(l.custom_fields->>'slo_replied_at', '') = ''
   AND ${messageAfter(keyList(CONTACT_M1_KEYS))}
   AND NOT ${messageAfter(keyList(CONTACT_REPLIED_KEYS))}
   AND NOT ${messageAfter(keyList(CONTACT_197_KEYS))}`.trim();

/* ------------------------------------------------------------------ check 3: booking confirm */

/** $1 org, $2 ['booking.created','booking.rescheduled'], $3 window start, $4 cutoff. */
export const CONFIRM_SQL = `
/* gap:handoff-confirm */
WITH ${leadCte()}
SELECT count(DISTINCT COALESCE(l.cid::text, l.em))::int AS n,
       max(l.created_at) AS newest,
       (array_agg(${LABEL} ORDER BY l.created_at DESC))[1] AS sample,
       count(DISTINCT COALESCE(l.cid::text, l.em)) FILTER (
         WHERE NOT ${messageAfter(`= '${TEMPLATES.confirmSms}'`)}
       )::int AS silent_n
  FROM lead l
 WHERE NOT ${messageAfter(`= '${TEMPLATES.confirmEmail}'`)}`.trim();

/* ------------------------------------------------------------------ check 4: reminders */

const VALID_START = `COALESCE(e.payload->>'startTime', e.payload->>'start_time') ~
    '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]'`;

/**
 * Every booking and reschedule with a readable start time. $1 org, $2 booked-since,
 * $3 now, $4 reminder key. A booking cancelled or moved later is not read: the
 * workflow stops on those (cancelOn in s-04b-booking-reminders.mjs), and a move
 * is its own booking.rescheduled event with its own start time.
 */
function reminderSql({ tag, withinInterval, bookedAheadInterval }) {
  return `
/* gap:handoff-${tag} */
WITH bk AS (
  SELECT e.id, e.org_id, e.name, e.created_at, e.payload,
         ${EVENT_EMAIL("e")} AS em,
         COALESCE(e.client_id, ${CLIENT_BY_EMAIL("e", EVENT_EMAIL("e"))}) AS cid,
         CASE WHEN ${VALID_START}
              THEN COALESCE(e.payload->>'startTime', e.payload->>'start_time')::timestamptz
         END AS starts_at
    FROM events e
   WHERE e.org_id = $1::uuid
     AND e.name IN ('booking.created', 'booking.rescheduled')
     AND COALESCE(e.is_demo, false) = false
     AND e.created_at >= $2::timestamptz
     AND e.created_at <  $3::timestamptz
),
l AS (
  SELECT bk.*, c.client_code, c.phone AS cphone
    FROM bk
    LEFT JOIN clients c ON c.id = bk.cid
   WHERE bk.starts_at IS NOT NULL
     AND bk.cid IS NOT NULL
     AND COALESCE(c.is_demo, false) = false
     AND NOT ${testAddressSql("COALESCE(NULLIF(bk.em, ''), lower(btrim(COALESCE(c.email, ''))))")}
     AND bk.starts_at <= $3::timestamptz + interval '${withinInterval}'
     AND bk.starts_at >  $3::timestamptz - interval '${REMIND_PAST_HOURS} hours'
     AND bk.created_at <= bk.starts_at - interval '${bookedAheadInterval}'
)
SELECT count(DISTINCT l.cid)::int AS n,
       max(l.starts_at) AS newest,
       (array_agg(${LABEL} ORDER BY l.starts_at DESC))[1] AS sample
  FROM l
 WHERE NOT EXISTS (
         SELECT 1 FROM events x
          WHERE x.org_id = l.org_id
            AND x.created_at > l.created_at
            AND x.name IN ('booking.cancelled', 'booking.rescheduled')
            AND (
              (l.em <> '' AND lower(btrim(COALESCE(x.payload->>'email', ''))) = l.em)
              OR (COALESCE(l.payload->>'bookingUid', '') <> ''
                  AND x.payload->>'bookingUid' = l.payload->>'bookingUid')
            )
       )
   AND NOT EXISTS (
         SELECT 1 FROM opt_outs o
          WHERE o.client_id = l.cid AND o.channel = 'sms' AND o.opted_in_at IS NULL
       )
   AND NOT EXISTS (
         SELECT 1 FROM messages m
          WHERE m.org_id = l.org_id
            AND m.client_id = l.cid
            AND m.direction = 'outbound'
            AND m.template_key = $4::text
            AND m.created_at >= l.created_at
       )`.trim();
}

/** $1 org, $2 booked-since, $3 now, $4 'SMS-S04-02-REMIND-24H'. */
export const REMIND_24H_SQL = reminderSql({
  tag: "remind-24h",
  withinInterval: `${REMIND_24H_WITHIN_HOURS} hours`,
  bookedAheadInterval: `${REMIND_24H_BOOKED_AHEAD_HOURS} hours`
});

/** $1 org, $2 booked-since, $3 now, $4 'SMS-S04-03-REMIND-2H'. */
export const REMIND_2H_SQL = reminderSql({
  tag: "remind-2h",
  withinInterval: `${REMIND_2H_WITHIN_MIN} minutes`,
  bookedAheadInterval: `${REMIND_2H_BOOKED_AHEAD_MIN} minutes`
});

/* ------------------------------------------------------------------ check 5: after the call */

/** $1 org, $2 ['booking.noshow'], $3 window start, $4 cutoff. */
export const NOSHOW_SQL = `
/* gap:handoff-noshow */
WITH ${leadCte()}
${tail()}
 WHERE NOT ${messageAfter(`= '${TEMPLATES.noshow}'`)}`.trim();

const CLOSER_CLIENT = `COALESCE(
      e.client_id,
      CASE WHEN e.payload->>'clientId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           THEN (e.payload->>'clientId')::uuid END,
      ${CLIENT_BY_EMAIL("e", EVENT_EMAIL("e"))}
    )`;

/**
 * call.completed events. $1 org, $2 window start, $3 cutoff.
 * The offer email reads closer calls only: s-offer-bucket stops on any other
 * disposition. The declined task reads every call: s-08 gates on the outcome
 * alone, and a closer call can never end "declined" (the only outcomes a closer
 * can save are deposit, downsell, callback, no_show and not_a_fit). The one
 * call that ends "declined" is the Bland AI call (disposition "declined").
 */
function callCte({ closerOnly }) {
  return `cc AS (
  SELECT e.id, e.org_id, e.name, e.created_at, e.payload,
         ${EVENT_EMAIL("e")} AS em,
         ${CLOSER_CLIENT} AS cid,
         COALESCE(NULLIF(e.payload->>'offerKey', ''), NULLIF(e.payload->>'offer_key', '')) AS offer_key,
         e.payload->>'outcome' AS outcome
    FROM events e
   WHERE e.org_id = $1::uuid
     AND e.name = 'call.completed'
     AND COALESCE(e.is_demo, false) = false
     ${closerOnly ? "AND e.payload->>'disposition' = 'closer'" : "AND e.payload->>'outcome' = 'declined'"}
     AND e.created_at >= $2::timestamptz
     AND e.created_at <  $3::timestamptz
),
l AS (
  SELECT cc.*, c.client_code, c.email AS cemail
    FROM cc
    JOIN clients c ON c.id = cc.cid
   WHERE COALESCE(c.is_demo, false) = false
     AND NOT ${testAddressSql("COALESCE(NULLIF(cc.em, ''), lower(btrim(COALESCE(c.email, ''))))")}
)`;
}

/** A paid Funding Mastery link: the only case where that offer email is due (s-offer-bucket masteryIsPaid). */
const MASTERY_PAID = `EXISTS (
       SELECT 1 FROM payment_links pl
         LEFT JOIN products p ON p.id = pl.product_id
        WHERE pl.org_id = l.org_id
          AND pl.client_id = l.cid
          AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)
          AND (p.code = 'funding-mastery' OR COALESCE(pl.description, '') ~* 'funding mastery')
     )`;

/** $1 org, $2 window start, $3 cutoff. The offer email goes once per client (a lock), so any offer email counts. */
export const OFFER_SQL = `
/* gap:handoff-offer */
WITH ${callCte({ closerOnly: true })}
SELECT count(DISTINCT l.cid)::int AS n,
       max(l.created_at) AS newest,
       (array_agg(COALESCE(NULLIF(l.client_code, ''), l.cid::text) ORDER BY l.created_at DESC))[1] AS sample
  FROM l
 WHERE (l.offer_key ${keyList(OFFER_KEYS)} OR (l.offer_key IS NULL AND l.outcome = 'not_a_fit'))
   AND (l.offer_key IS DISTINCT FROM 'FUNDING_MASTERY' OR ${MASTERY_PAID})
   AND NOT EXISTS (
         SELECT 1 FROM messages m
          WHERE m.org_id = l.org_id
            AND m.client_id = l.cid
            AND m.direction = 'outbound'
            AND m.template_key LIKE '${TEMPLATES.offerPrefix}%'
       )`.trim();

/**
 * $1 org, $2 window start, $3 cutoff. s-08 makes a closer task for every
 * call.completed whose outcome is "declined", whatever the disposition. Any task
 * made after the call counts.
 */
export const DECLINED_SQL = `
/* gap:handoff-declined */
WITH ${callCte({ closerOnly: false })}
SELECT count(DISTINCT l.cid)::int AS n,
       max(l.created_at) AS newest,
       (array_agg(COALESCE(NULLIF(l.client_code, ''), l.cid::text) ORDER BY l.created_at DESC))[1] AS sample
  FROM l
 WHERE l.outcome = 'declined'
   AND NOT EXISTS (
         SELECT 1 FROM tasks t
          WHERE t.org_id = l.org_id
            AND t.client_id = l.cid
            AND t.created_at >= l.created_at - interval '1 minute'
       )`.trim();

/** $1 org, $2 template keys. Why a row is missing: no template, not approved, or still draft copy. */
export const TEMPLATE_STATE_SQL = `
/* gap:handoff-templates */
SELECT k.key AS template_key,
       (t.id IS NULL) AS missing,
       COALESCE(t.compliance_passed, false) AS approved,
       (COALESCE(t.body, '') ~* '\\[DRAFT\\y' OR COALESCE(t.subject, '') ~* '\\[DRAFT\\y') AS draft
  FROM unnest($2::text[]) AS k(key)
  LEFT JOIN message_templates t ON t.org_id = $1::uuid AND t.template_key = k.key`.trim();

/** One read gets at most this long. Netlify cuts a step at 26 seconds; the whole lane keeps under 15. */
export const READ_TIMEOUT_MS = 8000;
/** The whole lane stops reading after this long and the rest skip. */
export const LANE_BUDGET_MS = 15000;

/** Only when the pulse did not hand the company in. */
export const DEFAULT_ORG_SQL = "SELECT id FROM orgs WHERE is_default LIMIT 1";

export const ALL_SQL = Object.freeze({
  WELCOME_SQL,
  NUDGE_SQL,
  NOBOOK_SQL,
  CONTACT_M1_SQL,
  CONTACT_197_SQL,
  CONFIRM_SQL,
  REMIND_24H_SQL,
  REMIND_2H_SQL,
  NOSHOW_SQL,
  OFFER_SQL,
  DECLINED_SQL,
  TEMPLATE_STATE_SQL
});

/* ------------------------------------------------------------------ helpers */

function row(id, status, detail, suggestedFix = null) {
  return { id, status, detail, suggestedFix: status === "FAIL" ? suggestedFix : null };
}

function clip(err, n = 160) {
  return String((err && err.message) || err || "unknown")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, n);
}

function plural(n, one, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

function asDate(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    if (Number.isFinite(d.getTime())) return d;
  }
  return null;
}

function ago(ms) {
  if (!Number.isFinite(ms)) return "a while";
  const m = Math.max(1, Math.round(Math.abs(ms) / MIN));
  if (m < 120) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  // Days round DOWN: 6 days 14 hours must not read as 7, the edge of the window.
  return `${Math.floor(h / 24)} days`;
}

/** A count the database did not hand back is not zero. Zero must be read, never assumed. */
function countOf(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n <= 0 ? 0 : Math.floor(n);
}

export function assertSelect(sql) {
  const s = String(sql || "").trim();
  if (!/^(\/\*[\s\S]*?\*\/\s*)?(select|with)\b/i.test(s) || /\b(insert|update|delete|drop|alter|truncate)\b/i.test(s)) {
    throw new Error("handoff check refused a write");
  }
}

/** Staff scope when the pulse has one (it reads every row), else the plain pool. */
async function readRows(ctx, sql, params, deadline) {
  assertSelect(sql);
  const left = deadline - Date.now();
  if (left <= 500) throw new Error("ran out of time before this read");
  let timer;
  const run = typeof ctx.scope === "function"
    ? ctx.scope((tx) => tx.query(sql, params))
    : ctx.db.query(sql, params);
  // ctx.readTimeoutMs is a test hook. In production every read gets at most 8 seconds.
  const each = Number.isFinite(ctx.readTimeoutMs) && ctx.readTimeoutMs > 0 ? ctx.readTimeoutMs : READ_TIMEOUT_MS;
  try {
    const res = await Promise.race([
      run,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("the read took too long")), Math.min(left, each));
      })
    ]);
    return res && Array.isArray(res.rows) ? res.rows : [];
  } finally {
    clearTimeout(timer);
  }
}

/** One branch: { n, newest, sample, silentN } or throws. */
async function readBranch(ctx, sql, params, deadline) {
  const rows = await readRows(ctx, sql, params, deadline);
  const first = rows[0] || {};
  const n = countOf(first.n);
  if (n === null) throw new Error("the count came back unreadable");
  return {
    n,
    newest: asDate(first.newest),
    sample: first.sample == null ? null : String(first.sample),
    silentN: countOf(first.silent_n)
  };
}

function whoWhen(branch, now, label = "newest") {
  const parts = [];
  if (branch.newest) {
    const d = now.getTime() - branch.newest.getTime();
    parts.push(d >= 0 ? `${label} ${ago(d)} ago` : `${label} in ${ago(d)}`);
  }
  if (branch.sample) parts.push(branch.sample);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

/** Why a row is missing, when the cause is the template: missing, not approved, or draft copy. */
async function templateNote(ctx, orgId, keys, deadline) {
  try {
    const rows = await readRows(ctx, TEMPLATE_STATE_SQL, [orgId, keys], deadline);
    const bad = [];
    for (const r of rows) {
      if (r.missing === true) bad.push(`${r.template_key} does not exist`);
      else if (r.draft === true) bad.push(`${r.template_key} is still draft copy`);
      else if (r.approved === false) bad.push(`${r.template_key} is not approved`);
    }
    return bad.length ? ` Template problem: ${bad.join("; ")}.` : "";
  } catch {
    return "";
  }
}

/** Run every named branch. A branch that cannot be read is listed, never counted as zero. */
async function runBranches(ctx, specs, deadline) {
  const branches = [];
  const errors = [];
  for (const spec of specs) {
    try {
      branches.push({ ...spec, ...(await readBranch(ctx, spec.sql, spec.params, deadline)) });
    } catch (err) {
      errors.push(`${spec.label}: ${clip(err)}`);
    }
  }
  return { branches, errors };
}

/**
 * One red branch makes the row FAIL even when another branch could not be read:
 * a known break is never hidden behind a failed read. With nothing red and a
 * branch unread, the row is skip with the reason. PASS only when every branch was read and is zero.
 */
async function finish({ ctx, id, now, orgId, deadline, specs, passDetail, fixLead }) {
  const { branches, errors } = await runBranches(ctx, specs, deadline);
  const bad = branches.filter((b) => b.n > 0);
  if (bad.length === 0) {
    if (errors.length) return row(id, "skip", `could not read — ${errors.join("; ")}`);
    return row(id, "PASS", passDetail);
  }
  let detail = bad
    .map((b) => `${plural(b.n, b.noun, b.many)} ${b.said}${whoWhen(b, now, b.whenLabel)}${b.extra ? b.extra(b) : ""}`)
    .join(". ") + ".";
  if (errors.length) detail += ` Could not read: ${errors.join("; ")}.`;
  const keys = [...new Set(bad.flatMap((b) => b.keys || []))];
  const note = keys.length ? await templateNote(ctx, orgId, keys, deadline) : "";
  return row(id, "FAIL", detail, `${fixLead}${note} ${SCOPE_FIX}`);
}

/* ------------------------------------------------------------------ the five checks */

function cutoff(now, ms) {
  return new Date(now.getTime() - ms).toISOString();
}

function windowStart(now) {
  return cutoff(now, LOOKBACK_DAYS * DAY);
}

function checkFirstTouches(env) {
  const { now } = env;
  const start = windowStart(now);
  const entry = ["entry.captured"];
  const survey = ["survey.submitted"];
  return finish({
    ...env,
    id: "handoff:lead-first-touches-missing",
    specs: [
      {
        label: "welcome email",
        sql: WELCOME_SQL,
        params: [env.orgId, entry, start, cutoff(now, WELCOME_GRACE_MIN * MIN)],
        noun: "new lead",
        said: `got no welcome email (${TEMPLATES.welcome}) ${WELCOME_GRACE_MIN}+ minutes after signing up`,
        keys: [TEMPLATES.welcome]
      },
      {
        label: "finish-application nudge",
        sql: NUDGE_SQL,
        params: [env.orgId, entry, start, cutoff(now, NUDGE_GRACE_MIN * MIN)],
        noun: "lead",
        said: `had not finished the survey after ${NUDGE_GRACE_MIN} minutes and got no nudge email (${TEMPLATES.nudge})`,
        keys: [TEMPLATES.nudge]
      },
      {
        label: "never-booked chase",
        sql: NOBOOK_SQL,
        params: [env.orgId, survey, start, cutoff(now, NOBOOK_GRACE_MIN * MIN)],
        noun: "lead",
        said: `finished the survey, never booked, and got no chase email (${TEMPLATES.nobook}) after ${NOBOOK_GRACE_MIN / 60} hours`,
        keys: [TEMPLATES.nobook]
      }
    ],
    passDetail:
      "every new lead from the last 7 days got the welcome email, and the finish-application nudge and never-booked chase went to everyone who needed them",
    fixLead:
      "A new lead got nothing after signing up. Read the lead's entry.captured or survey.submitted event, then the s-00-welcome, s-02-incomplete-survey-nudge or s-nobook-chase run in Inngest. A saved event with no run means the hand-off to Inngest broke (INNGEST_EVENT_KEY, or Inngest itself)."
  });
}

function checkContact(env) {
  const { now } = env;
  const start = windowStart(now);
  return finish({
    ...env,
    id: "handoff:contact-no-followup",
    specs: [
      {
        label: "15-minute note",
        sql: CONTACT_M1_SQL,
        params: [env.orgId, start, cutoff(now, CONTACT_M1_GRACE_MIN * MIN)],
        noun: "person",
        many: "people",
        said: `left an email on /roadmap, did not pay, and got no follow-up note after ${CONTACT_M1_GRACE_MIN} minutes`,
        keys: ["EMAIL-SLO-GENUINE-01", "SMS-SLO-GENUINE-01"]
      },
      {
        label: "$197 offer",
        sql: CONTACT_197_SQL,
        params: [env.orgId, start, cutoff(now, CONTACT_197_GRACE_HOURS * HOUR)],
        noun: "person",
        many: "people",
        said: `got the first note, never replied or paid, and got no $197 offer after ${CONTACT_197_GRACE_HOURS} hours`,
        keys: [...CONTACT_197_KEYS]
      }
    ],
    passDetail:
      "everyone who left an email on /roadmap in the last 7 days and did not pay got the 15-minute note, and the $197 offer where it was due",
    fixLead:
      "Someone gave us their email on /roadmap and nobody followed up. Read the slo.contact_started event, then the slo-genuine-followup or slo-no-reply-197 run in Inngest. The $197 step also mints a Commas checkout link, so a Commas refusal stops it."
  });
}

function checkConfirm(env) {
  const { now } = env;
  return finish({
    ...env,
    id: "handoff:booking-no-confirm",
    specs: [
      {
        label: "booking confirm email",
        sql: CONFIRM_SQL,
        params: [
          env.orgId,
          ["booking.created", "booking.rescheduled"],
          windowStart(now),
          cutoff(now, CONFIRM_GRACE_MIN * MIN)
        ],
        noun: "booked customer",
        said: `got no booking confirm email (${TEMPLATES.confirmEmail}, it carries the portal link) ${CONFIRM_GRACE_MIN}+ minutes after booking`,
        keys: [TEMPLATES.confirmEmail, TEMPLATES.confirmSms],
        extra: (b) =>
          b.silentN > 0 ? `, ${b.silentN} of them got no confirm text either` : ""
      }
    ],
    passDetail: "every booking from the last 7 days got its confirm email with the portal link",
    fixLead:
      "A customer booked a call and got no confirm email. Read the booking.created event, then the s-04b-booking-reminders run in Inngest. If the confirm text is missing too, the whole run never started."
  });
}

function reminderSpec(env, { label, sql, key, noun, said }) {
  const { now } = env;
  return {
    label,
    sql,
    params: [env.orgId, cutoff(now, REMIND_BOOKED_LOOKBACK_DAYS * DAY), now.toISOString(), key],
    noun,
    said,
    keys: [key],
    whenLabel: "latest call"
  };
}

function checkReminders(env) {
  return finish({
    ...env,
    id: "handoff:reminder-missing",
    specs: [
      reminderSpec(env, {
        label: "24-hour reminder",
        sql: REMIND_24H_SQL,
        key: TEMPLATES.remind24h,
        noun: "booked customer",
        said: `with a call inside ${REMIND_24H_WITHIN_HOURS} hours (or one that just happened) got no 24-hour reminder text`
      }),
      reminderSpec(env, {
        label: "2-hour reminder",
        sql: REMIND_2H_SQL,
        key: TEMPLATES.remind2h,
        noun: "booked customer",
        said: `with a call inside ${REMIND_2H_WITHIN_MIN} minutes (or one that just happened) got no 2-hour reminder text`
      })
    ],
    passDetail:
      "every call that is close, or just happened, got its 24-hour and 2-hour reminder texts (cancelled, moved, late-booked and opted-out people are left out)",
    fixLead:
      "A booked customer is not getting reminders, so they may miss the call. Read the booking.created event and the s-04b-booking-reminders run in Inngest. That run sleeps until the reminder time, so a stopped run or a lost Inngest sleep both look like this."
  });
}

function checkCallOutcome(env) {
  const { now } = env;
  const start = windowStart(now);
  return finish({
    ...env,
    id: "handoff:call-outcome-no-followup",
    specs: [
      {
        label: "no-show recovery",
        sql: NOSHOW_SQL,
        params: [env.orgId, ["booking.noshow"], start, cutoff(now, NOSHOW_GRACE_MIN * MIN)],
        noun: "no-show",
        said: `got no recovery email (${TEMPLATES.noshow}) ${NOSHOW_GRACE_MIN}+ minutes after missing the call`,
        keys: [TEMPLATES.noshow]
      },
      {
        label: "offer email",
        sql: OFFER_SQL,
        params: [env.orgId, start, cutoff(now, OFFER_GRACE_MIN * MIN)],
        noun: "customer",
        said: `finished a closer call with an offer picked and got no offer email (EMAIL-OFFER-*) after ${OFFER_GRACE_MIN} minutes`,
        keys: []
      },
      {
        label: "declined-call task",
        sql: DECLINED_SQL,
        params: [env.orgId, start, cutoff(now, OFFER_GRACE_MIN * MIN)],
        noun: "customer",
        said: `ended a call as declined (outcome "declined", any kind of call) and no follow-up task was made after ${OFFER_GRACE_MIN} minutes`,
        keys: []
      }
    ],
    passDetail:
      "every no-show got the recovery email, every closer call with an offer got its offer email, and every call that ended declined (any kind of call) got a follow-up task",
    fixLead:
      "A call ended and the customer got nothing next. Read the booking.noshow or call.completed event, then the s-05a-no-show-recovery, s-offer-bucket or s-08-post-call-funding-declined run in Inngest."
  });
}

/* ------------------------------------------------------------------ entry point */

/**
 * Five read-only tripwires. ctx: { db, scope, orgId, now }.
 * Each row is { id, status, detail, suggestedFix } with status PASS, FAIL or skip.
 * No database or no company: all five skip with the reason. A read that fails is a skip.
 */
export async function gapChecks(ctx = {}) {
  const canRead = typeof ctx.scope === "function" || (ctx.db && typeof ctx.db.query === "function");
  if (!canRead) {
    return CHECK_IDS.map((id) => row(id, "skip", "no database in this run — hand-offs not read"));
  }
  const deadline = Date.now() + LANE_BUDGET_MS;
  let orgId = typeof ctx.orgId === "string" && ctx.orgId.trim() ? ctx.orgId.trim() : "";
  if (!orgId) {
    // The pulse hands the company in. If it did not, ask for the default one once.
    try {
      const found = await readRows(ctx, DEFAULT_ORG_SQL, [], deadline);
      orgId = found[0] && found[0].id ? String(found[0].id) : "";
    } catch {
      orgId = "";
    }
  }
  if (!orgId) {
    return CHECK_IDS.map((id) => row(id, "skip", "no company in this run — hand-offs not read"));
  }
  const now = asDate(ctx.now) || new Date();
  const env = { ctx, now, orgId, deadline };

  const checks = [checkFirstTouches, checkContact, checkConfirm, checkReminders, checkCallOutcome];
  const rows = [];
  for (const [i, run] of checks.entries()) {
    try {
      rows.push(await run(env));
    } catch (err) {
      rows.push(row(CHECK_IDS[i], "skip", `could not read — ${clip(err)}`));
    }
  }
  return rows;
}
