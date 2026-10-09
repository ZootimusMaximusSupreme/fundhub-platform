// The send path, read only: is the line from "a message is queued" to "a phone or
// inbox has it" alive? Shared by beat-text-path.mjs and beat-email-path.mjs.
//
// Pulse v1 (ops/workflows/pulse-layer-2026-10-09-v1.md). Tonight these beats SEND
// NOTHING and QUEUE NOTHING. They prove the path is alive from the data the path
// leaves behind: the switches, the approved copy, the sweeper's heartbeat, the age
// of the line, the failures, the delivery receipts.
//
// Every read goes through ctx.read (a SELECT inside BEGIN READ ONLY). This file
// imports nothing but the beat contract, so it holds no database handle, no fetch
// and no sender (the static pin in contract.mjs checks that over this file too).
//
// WHERE THE SQL COMES FROM. The shapes are the ones the 6 a.m. lane already runs on
// live data: src/pulse/coverage/gap-sms.mjs (sending stuck, provider failed, the
// sent-no-receipt read, the real-message filter, the template guard patterns),
// gap-email.mjs (provider failures), gap-keys.mjs (the send fence), and
// src/pulse/heartbeats.mjs (the sweeper's clock). They are copied, not imported:
// those files read the disk and the database module, and a beat helper may not.
// beats/lib/send-path.test.mjs holds the copied constants to their sources.
//
// WHAT COUNTS AS "STUCK" (calibrated on the live database, 2026-10-09):
//   - a message with a future scheduled_at is waiting its turn, not stuck
//   - a held message (blocked_reason set) is not stuck
//   - demo messages, demo or synthetic clients, and test addresses are not counted
//   - queued past 15 minutes (the 6 a.m. lane and pipeline:outbound use 30) is stuck
//   - sending past 10 minutes is stuck
//
// WHAT THE SWEEPER'S CLOCK CAN AND CANNOT SHOW (checked on live data, 2026-10-09). sweep() in
// src/workflows/message-dispatch-sweeper.mjs never throws: a failed drain comes back as
// { ok: false, error } and the Inngest hook records outcome "ok" for it (heartbeats.mjs marks
// "error" only when the function itself throws). Live: 476 ok rows, 0 error rows. So the
// dispatcher-alive step catches a sweeper that STOPPED RUNNING. A sweeper that runs but fails
// inside every pass is invisible there; queue-moving catches it, after 15 minutes, and only
// when something is waiting. The "last 2 passes both ended in an error" arm is kept for the day
// the sweeper is allowed to throw. It cannot fire today.
//
// WHAT THE SENDER REFUSES. The gate and the copy guards do not fail a message, they mark it
// status "blocked" (gate.mjs gateAndRecord writes blocked_reason; dispatch.mjs finalise writes
// last_error placeholder_copy or draft_template). A gate bug would block every launch message
// and nothing would be queued, failed or stuck. failures-recent counts blocked rows too, and
// leaves out the holds that are the person's own doing: opted_out, recipient_unknown,
// quiet_hours, a retired document text, and a test address.
//
// NO PERSONAL DATA LEAVES THIS FILE. Results hold counts, template keys, job names
// and a cleaned error sample (phone numbers and emails removed). Never an address,
// a name, a client id or a message body.

import { isMasked } from "../contract.mjs";

/* ------------------------------------------------------------------ */
/* The two paths                                                       */
/* ------------------------------------------------------------------ */

export const SWEEPER_JOB = "message-dispatch-sweeper";

/** The launch path's copy. A client meets these first: welcome, the booking
    confirm, the sign-in link, the contract, the portal document request. */
export const TEXT_PATH = Object.freeze({
  channel: "sms",
  noun: "text",
  nouns: "texts",
  templates: Object.freeze(["SMS-S00-WELCOME", "SMS-S04-01-CONFIRM", "SMS-DOC-01-REQUEST"])
});

export const EMAIL_PATH = Object.freeze({
  channel: "email",
  noun: "email",
  nouns: "emails",
  templates: Object.freeze(["EMAIL-S00-WELCOME", "EMAIL-S04-01-CONFIRM", "EMAIL-PORTAL-MAGIC-LINK", "CONTRACT-SEND-EMAIL"])
});

export const TEXT_STEPS = Object.freeze([
  "fence-open", "template-ready", "dispatcher-alive", "queue-moving", "failures-recent", "receipts-moving", "opt-out-readable"
]);
export const EMAIL_STEPS = Object.freeze([...TEXT_STEPS, "unsubscribe-secret"]);

/* ------------------------------------------------------------------ */
/* Numbers that decide red                                             */
/* ------------------------------------------------------------------ */

/** The sweeper runs every 5 minutes. 3 times that is the same rule heartbeats.mjs uses. */
export const HEARTBEAT_MAX_MINUTES = 15;
/** Queued and due for longer than this is stuck. */
export const QUEUED_STUCK_MINUTES = 15;
/** Picked up (status sending) and never finished for longer than this is stuck. */
export const SENDING_STUCK_MINUTES = 10;
/** Failures are counted over this window. */
export const FAILURE_WINDOW_MINUTES = 60;
/** Red needs at least this many failed texts or emails in the window ... */
export const FAILED_MIN = 3;
/** ... or this many bounces (a bounce is usually one bad address, so the bar is higher). */
export const BOUNCED_MIN = 5;
/** Receipts are judged over this window ... */
export const RECEIPT_WINDOW_HOURS = 24;
/** ... and a hand-off needs this long to earn a receipt. */
export const RECEIPT_SETTLE_MINUTES = 30;
/** Fewer hand-offs than this and the receipt check says "too few to judge". It never goes red. */
export const RECEIPT_MIN_SAMPLE = 5;
/** The sender refuses to sign unsubscribe links with a secret shorter than this. */
export const UNSUBSCRIBE_SECRET_MIN = 32;

/* Same text as TEST_ADDRESS_RE in src/pulse/coverage/gap-sms.mjs (a test holds the two equal). */
export const TEST_ADDRESS_RE =
  String.raw`\+(walk|sim)-[0-9]+@|@example\.(com|net|org)$|\.(test|example|invalid|localhost|local)$|^(e2e|demo|test)\+`;

/* The sender's own copy guards, as JavaScript. dispatch.mjs holds /lorem\s+ipsum/i and
   draft-guard.mjs holds /\[DRAFT\b/i. A test holds these two to those. */
export const LOREM_RE = /lorem\s+ipsum/i;
export const DRAFT_RE = /\[DRAFT\b/i;

/** The values that open the messaging fence. Same set as MEANS_TRANSMIT in src/lib/dry-run.mjs (a test holds them equal). */
const FENCE_OFF_VALUES = Object.freeze(["0", "false", "no", "off"]);
export const MESSAGING_FENCE = "MESSAGING_DRY_RUN";

/* ------------------------------------------------------------------ */
/* The SQL. SELECT or WITH ... SELECT only; the read box checks.        */
/* The first comment on each is a label, so a slow query is easy to find.*/
/* ------------------------------------------------------------------ */

const DEFAULT_ORG = "(SELECT id FROM orgs WHERE is_default LIMIT 1)";

/* Test traffic is not a customer. Same filter as realMessageSql in gap-sms.mjs. `param` is the
   number of the query parameter that holds TEST_ADDRESS_RE. */
function realMessage(param) {
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

/* $1 channel. The company send switch (a missing row means on, as in src/messaging/outbox.mjs)
   and the route for the channel (no row, or enabled = false, is a hold: dispatch.mjs routeFor). */
export const FENCE_SQL = `/* pulse send-path: fence */
SELECT s.org_id IS NOT NULL AS has_settings,
       s.outbound_enabled,
       r.channel IS NOT NULL AS has_route,
       r.enabled AS route_enabled,
       r.provider
  FROM orgs o
  LEFT JOIN messaging_settings s ON s.org_id = o.id
  LEFT JOIN message_channel_routing r ON r.org_id = o.id AND r.channel = $1
 WHERE o.is_default
 LIMIT 1`;

/* $1 channel, $2 template keys. */
export const TEMPLATE_SQL = `/* pulse send-path: templates */
SELECT t.template_key, t.compliance_passed, t.body, t.subject
  FROM message_templates t
 WHERE t.org_id = ${DEFAULT_ORG}
   AND t.channel = $1
   AND t.template_key = ANY($2::text[])`;

/* $1 job. The three newest runs. */
export const HEARTBEAT_SQL = `/* pulse send-path: heartbeat */
SELECT h.finished_at, h.outcome
  FROM job_heartbeats h
 WHERE h.job = $1
 ORDER BY h.finished_at DESC
 LIMIT 3`;

/* $1 channel, $2 queued-before, $3 sending-before, $4 test-address pattern. */
export const QUEUE_SQL = `/* pulse send-path: queue */
WITH line AS (
  SELECT m.status, m.last_error,
         COALESCE(m.scheduled_at, m.created_at) AS due_at,
         COALESCE(m.last_attempt_at, m.updated_at, m.created_at) AS tried_at
    FROM messages m
   WHERE m.org_id = ${DEFAULT_ORG}
     AND m.direction = 'outbound'
     AND m.channel = $1
     AND m.status IN ('queued', 'sending')
     AND m.blocked_reason IS NULL
     AND ${realMessage("$4")}
), stuck AS (
  SELECT l.*, (l.status = 'queued') AS waiting
    FROM line l
   WHERE (l.status = 'queued' AND l.due_at < $2::timestamptz)
      OR (l.status = 'sending' AND l.tried_at < $3::timestamptz)
)
SELECT count(*) FILTER (WHERE waiting)::int AS queued_n,
       min(due_at) FILTER (WHERE waiting) AS oldest_queued,
       count(*) FILTER (WHERE NOT waiting)::int AS sending_n,
       min(tried_at) FILTER (WHERE NOT waiting) AS oldest_sending,
       (array_agg(last_error ORDER BY due_at) FILTER (WHERE last_error IS NOT NULL))[1] AS sample_error
  FROM stuck`;

/* The gate codes that mean "this person asked for it" and not "our sender is broken": no client
   attached, said STOP, text held for the quiet window. The test lists them by name. */
export const PERSONAL_BLOCK_CODES = Object.freeze(["opted_out", "recipient_unknown", "quiet_hours"]);
/* The finalise() reasons in dispatch.mjs that are not a bug either: DOC-CHECK is retired on purpose. */
export const PERSONAL_BLOCK_ERRORS = Object.freeze(["retired_ghl_doc"]);

/* $1 channel, $2 window start, $3 test-address pattern. Provider failures leave out the two
   failures that are not the phone company or the mail host: a client with nowhere to send to,
   and a test record (gap-sms.mjs FAILED_SQL and gap-email.mjs PROVIDER_FAIL_SQL do the same).
   Blocked rows are the sender refusing a message (see the header); the holds that are the
   person's own doing are left out. A gate block has blocked_reason; a copy-guard block has
   only last_error. */
export const FAILURE_SQL = `/* pulse send-path: failures */
SELECT count(*) FILTER (WHERE m.status = 'failed')::int AS failed_n,
       count(*) FILTER (WHERE m.status = 'bounced')::int AS bounced_n,
       count(*) FILTER (WHERE m.status = 'blocked')::int AS blocked_n,
       count(*) FILTER (WHERE m.status IN ('sent', 'delivered'))::int AS ok_n,
       (array_agg(m.last_error ORDER BY m.updated_at DESC)
          FILTER (WHERE m.status = 'failed' AND m.last_error IS NOT NULL))[1] AS sample_error,
       (array_agg(COALESCE(m.blocked_reason, m.last_error) ORDER BY m.updated_at DESC)
          FILTER (WHERE m.status = 'blocked' AND COALESCE(m.blocked_reason, m.last_error) IS NOT NULL))[1] AS sample_block
  FROM messages m
 WHERE m.org_id = ${DEFAULT_ORG}
   AND m.direction = 'outbound'
   AND m.channel = $1
   AND m.status IN ('failed', 'bounced', 'blocked', 'sent', 'delivered')
   AND COALESCE(m.last_attempt_at, m.updated_at, m.created_at) >= $2::timestamptz
   AND (
     m.status <> 'failed'
     OR (
       COALESCE(m.last_error, '') NOT ILIKE '%to send to%'
       AND COALESCE(m.last_error, '') NOT ILIKE '%test record from a journey run%'
       AND COALESCE(m.last_error, '') NOT ILIKE '%test address%'
     )
   )
   AND (
     m.status <> 'blocked'
     OR CASE
          WHEN m.blocked_reason IS NOT NULL
            THEN NOT (string_to_array(m.blocked_reason, ',') <@ ARRAY[${PERSONAL_BLOCK_CODES.map((c) => `'${c}'`).join(", ")}]::text[])
          ELSE COALESCE(m.last_error, '') NOT IN (${PERSONAL_BLOCK_ERRORS.map((c) => `'${c}'`).join(", ")})
           AND COALESCE(m.last_error, '') NOT ILIKE 'test address%'
        END
   )
   AND ${realMessage("$3")}`;

/* $1 channel, $2 window start, $3 settle cutoff (hand-offs newer than this have had no time), $4 pattern. */
export const RECEIPT_SQL = `/* pulse send-path: receipts */
SELECT count(*) FILTER (WHERE m.status IN ('sent', 'delivered', 'bounced'))::int AS handed_n,
       count(*) FILTER (WHERE m.status IN ('delivered', 'bounced'))::int AS receipts_n,
       count(*) FILTER (WHERE m.status = 'sent')::int AS waiting_n
  FROM messages m
 WHERE m.org_id = ${DEFAULT_ORG}
   AND m.direction = 'outbound'
   AND m.channel = $1
   AND m.status IN ('sent', 'delivered', 'bounced')
   AND COALESCE(m.last_attempt_at, m.created_at) >= $2::timestamptz
   AND COALESCE(m.last_attempt_at, m.created_at) < $3::timestamptz
   AND ${realMessage("$4")}`;

/* The sender's opt-out lookup reads this table. If the beat cannot read it, neither can the gate. */
export const OPT_OUT_SQL = `/* pulse send-path: opt-outs */
SELECT count(*)::int AS total,
       count(*) FILTER (WHERE opted_out_at IS NOT NULL AND opted_in_at IS NULL)::int AS active_n
  FROM opt_outs`;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const plural = (n, one, many) => (n === 1 ? one : many);
const MIN = 60 * 1000;

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  const t = Date.parse(String(value ?? ""));
  return Number.isFinite(t) ? t : null;
}

/** "42 min" or "3 h" or "2 days", from a time to now. null when the time cannot be read. */
export function ageText(from, now) {
  const t = toMs(from);
  const n = toMs(now);
  if (t === null || n === null) return null;
  const ms = Math.max(0, n - t);
  if (ms < 60 * MIN) return `${Math.max(1, Math.round(ms / MIN))} min`;
  if (ms < 48 * 60 * MIN) return `${Math.round(ms / (60 * MIN))} h`;
  return `${Math.round(ms / (24 * 60 * MIN))} days`;
}

/** An error sample made safe for a record and a text: no phone numbers, no emails, short. */
export function cleanError(value, max = 70) {
  const s = String(value ?? "")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+/g, "<email>")
    .replace(/\+?\d[\d\s().-]{5,}\d/g, "<number>")
    .replace(/\s+/g, " ")
    .trim();
  return s.length > max ? `${s.slice(0, max - 3)}...` : s;
}

const isoAgo = (now, ms) => new Date(toMs(now) - ms).toISOString();

/* ------------------------------------------------------------------ */
/* The judges. Pure: rows in, a verdict out. Each has a PASS and a FAIL */
/* test in send-path.test.mjs.                                          */
/* ------------------------------------------------------------------ */

/** The same grammar as fenceVerdict in src/lib/dry-run.mjs: only an explicit off value opens the fence. */
export function fenceIsOpen(value) {
  if (value === undefined || value === null) return false;
  const v = String(value).trim().toLowerCase();
  return FENCE_OFF_VALUES.includes(v);
}

/**
 * fence-open: the three locks between a queued message and the client.
 *   1. the company send switch (messaging_settings.outbound_enabled; a missing row is on)
 *   2. the route for the channel (no row, or enabled = false, holds everything)
 *   3. MESSAGING_DRY_RUN in the server settings (only on the live server; a laptop copy
 *      says nothing about the live site)
 * Returns { problems: string[], notes: string[], facts: object }.
 */
export function judgeFence({ row, live, env, path }) {
  const problems = [];
  const notes = [];
  if (!row) {
    return { problems: ["No default company was found, so the send switch could not be read."], notes, facts: {} };
  }
  const facts = {
    switch: row.has_settings ? (row.outbound_enabled ? "on" : "off") : "no row (counts as on)",
    route: !row.has_route ? "missing" : row.route_enabled ? `on (${row.provider || "no provider"})` : "off",
    dryRunFence: null
  };
  if (row.has_settings && !row.outbound_enabled) {
    problems.push(`The company send switch is OFF, so every ${path.noun} waits in the line.`);
  }
  if (!row.has_route) {
    problems.push(`No route is saved for ${path.nouns}, so the sender holds every ${path.noun}.`);
  } else if (row.route_enabled !== true) {
    problems.push(`The route for ${path.nouns} is switched off, so the sender holds every ${path.noun}.`);
  }
  if (live) {
    const open = fenceIsOpen(env && env[MESSAGING_FENCE]);
    facts.dryRunFence = open ? "open" : "closed";
    if (!open) {
      problems.push(`${MESSAGING_FENCE} is not set to an off value (0, false, no or off), so every ${path.noun} is held.`);
    }
  } else {
    facts.dryRunFence = "not read (laptop copy)";
    notes.push(`${MESSAGING_FENCE} not read (not the live server)`);
  }
  return { problems, notes, facts };
}

/**
 * template-ready: each launch-path template exists, is approved (compliance_passed), has a body,
 * and holds no placeholder words. Same two guards the sender runs (dispatch.mjs lorem, draft-guard.mjs).
 * Returns { problems: string[], checked: number }.
 */
export function judgeTemplates({ rows, path }) {
  const byKey = new Map((Array.isArray(rows) ? rows : []).map((r) => [r.template_key, r]));
  const problems = [];
  for (const key of path.templates) {
    const t = byKey.get(key);
    if (!t) { problems.push(`${key} is missing.`); continue; }
    if (t.compliance_passed !== true) { problems.push(`${key} is not approved.`); continue; }
    const body = String(t.body ?? "");
    const subject = String(t.subject ?? "");
    if (!body.trim()) { problems.push(`${key} has no words in it.`); continue; }
    if (LOREM_RE.test(body) || LOREM_RE.test(subject)) { problems.push(`${key} still has lorem ipsum placeholder words.`); continue; }
    if (DRAFT_RE.test(body) || DRAFT_RE.test(subject)) { problems.push(`${key} still has a [DRAFT] mark.`); continue; }
  }
  return { problems, checked: path.templates.length };
}

/**
 * dispatcher-alive: the sweeper wrote a heartbeat in the last 15 minutes, and its last two passes
 * were not both errors. rows are the newest first. Returns { problem: string|null, ageMin, lastAt }.
 * The error arm cannot fire today: the sweeper never throws, so no row says "error" (see the header).
 * What this step catches is a sweeper that stopped running.
 */
export function judgeHeartbeat({ rows, now }) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) {
    return { problem: `${SWEEPER_JOB} has no run on record, so nothing drains the line.`, ageMin: null, lastAt: null };
  }
  const lastAt = list[0].finished_at;
  const t = toMs(lastAt);
  const n = toMs(now);
  const ageMin = t === null || n === null ? null : Math.max(0, Math.round((n - t) / MIN));
  if (ageMin === null) return { problem: `${SWEEPER_JOB} has a run on record with a time that cannot be read.`, ageMin, lastAt };
  if (ageMin > HEARTBEAT_MAX_MINUTES) {
    return {
      problem: `${SWEEPER_JOB} last ran ${ageText(lastAt, now)} ago. It should run every 5 minutes, so nothing is draining the line.`,
      ageMin,
      lastAt
    };
  }
  if (list.length >= 2 && list[0].outcome === "error" && list[1].outcome === "error") {
    return { problem: `${SWEEPER_JOB} ran, but its last 2 passes both ended in an error.`, ageMin, lastAt };
  }
  return { problem: null, ageMin, lastAt };
}

/** queue-moving: nothing queued past 15 minutes, nothing on sending past 10. Returns { problem, queued, sending }. */
export function judgeQueue({ row, now, path }) {
  const queued = num(row && row.queued_n);
  const sending = num(row && row.sending_n);
  if (!queued && !sending) return { problem: null, queued, sending };
  const parts = [];
  if (queued) {
    const age = ageText(row.oldest_queued, now);
    parts.push(`${queued} ${plural(queued, path.noun, path.nouns)} ${plural(queued, "has", "have")} waited in the line for over ${QUEUED_STUCK_MINUTES} minutes${age ? ` (oldest ${age})` : ""}`);
  }
  if (sending) {
    const age = ageText(row.oldest_sending, now);
    parts.push(`${sending} ${plural(sending, path.noun, path.nouns)} ${plural(sending, "was", "were")} picked up and never finished for over ${SENDING_STUCK_MINUTES} minutes${age ? ` (oldest ${age})` : ""}`);
  }
  const err = cleanError(row && row.sample_error);
  return { problem: `${parts.join(". ")}.${err ? ` Last error: ${err}` : ""}`.trim(), queued, sending };
}

/**
 * failures-recent: red when the failures in the last hour look like a pattern, not one bad address.
 *   failed:  3 or more, and at least as many as the ones that worked (sent or delivered)
 *   blocked: 3 or more refused by our own sender, and at least as many as the ones that worked
 *   bounced: 5 or more, and at least as many as the ones that worked
 * Anything less is a note, never a red. Returns { problem, note, failed, bounced, blocked, ok }.
 */
export function judgeFailures({ row, path }) {
  const failed = num(row && row.failed_n);
  const bounced = num(row && row.bounced_n);
  const blocked = num(row && row.blocked_n);
  const ok = num(row && row.ok_n);
  const err = cleanError(row && row.sample_error);
  const why = cleanError(row && row.sample_block, 60);
  const base = { failed, bounced, blocked, ok };
  if (failed >= FAILED_MIN && failed >= ok) {
    return {
      problem: `${failed} ${plural(failed, path.noun, path.nouns)} failed in the last hour and ${ok} went through.${err ? ` Last error: ${err}` : ""}`,
      note: null, ...base
    };
  }
  if (blocked >= FAILED_MIN && blocked >= ok) {
    return {
      problem: `${blocked} ${plural(blocked, path.noun, path.nouns)} ${plural(blocked, "was", "were")} refused by our own sender in the last hour and ${ok} went through.${why ? ` Block code: ${why}` : ""}`,
      note: null, ...base
    };
  }
  if (bounced >= BOUNCED_MIN && bounced >= ok) {
    return { problem: `${bounced} ${plural(bounced, path.noun, path.nouns)} bounced in the last hour and ${ok} went through.`, note: null, ...base };
  }
  const bad = failed + bounced + blocked;
  const note = bad > 0 ? `${bad} failed, bounced or refused in the last hour out of ${bad + ok} (too few to call it broken)` : null;
  return { problem: null, note, ...base };
}

/**
 * receipts-moving: AMBER only. It never returns a problem. Returns { amber: boolean, note: string, ... }.
 * Below RECEIPT_MIN_SAMPLE hand-offs it says "too few to judge". At or above it, no receipt at all is amber.
 */
export function judgeReceipts({ row, path }) {
  const handed = num(row && row.handed_n);
  const receipts = num(row && row.receipts_n);
  const waiting = num(row && row.waiting_n);
  if (handed < RECEIPT_MIN_SAMPLE) {
    return { amber: false, note: `receipts: ${handed} ${plural(handed, path.noun, path.nouns)} handed off in ${RECEIPT_WINDOW_HOURS} h, too few to judge`, handed, receipts, waiting };
  }
  if (receipts === 0) {
    return {
      amber: true,
      note: `AMBER receipts: ${handed} ${plural(handed, path.noun, path.nouns)} handed off in ${RECEIPT_WINDOW_HOURS} h and none has a delivery receipt. Check the receipt door`,
      handed, receipts, waiting
    };
  }
  return { amber: false, note: `receipts: ${receipts} of ${handed} have a delivery receipt`, handed, receipts, waiting };
}

/**
 * unsubscribe-secret: the sender signs the unsubscribe link with UNSUBSCRIBE_TOKEN_SECRET, or
 * DOCUMENT_URL_SECRET when the first is empty (src/messaging/unsubscribe.mjs unsubscribeSecret).
 * No good secret means the email goes out with no way to unsubscribe. Names only, never a value.
 * Returns { problem: string|null, name }.
 */
export function judgeUnsubscribeSecret(env) {
  const e = env || {};
  const first = e.UNSUBSCRIBE_TOKEN_SECRET;
  const name = first ? "UNSUBSCRIBE_TOKEN_SECRET" : e.DOCUMENT_URL_SECRET ? "DOCUMENT_URL_SECRET" : "UNSUBSCRIBE_TOKEN_SECRET";
  const value = first || e.DOCUMENT_URL_SECRET;
  if (!value) {
    return { problem: "UNSUBSCRIBE_TOKEN_SECRET is not set (and neither is DOCUMENT_URL_SECRET), so emails go out with no unsubscribe link.", name };
  }
  if (isMasked(value)) {
    return { problem: `${name} is a row of asterisks, not a real secret, so emails go out with no good unsubscribe link.`, name };
  }
  if (String(value).length < UNSUBSCRIBE_SECRET_MIN) {
    return { problem: `${name} is shorter than ${UNSUBSCRIBE_SECRET_MIN} characters, so the sender refuses to sign unsubscribe links.`, name };
  }
  return { problem: null, name };
}

/* ------------------------------------------------------------------ */
/* Canned answers for the beats' selfTests and for the tests             */
/* ------------------------------------------------------------------ */

/** The instant the fake ctx uses as "now" (FAKE_NOW in src/pulse/beats/ctx.mjs; a test holds the two equal). */
export const FIXTURE_NOW = "2026-10-09T19:07:00.000Z";

/**
 * A read function for makeFakeCtx that answers each send-path query by its label, with a healthy
 * line by default. over.<label> replaces that label's rows, or { error } makes the read throw.
 * A query with no label match throws, so a new query without an answer fails loudly.
 */
export function fakeReads(path, over = {}) {
  const at = (minutesAgo) => new Date(Date.parse(FIXTURE_NOW) - minutesAgo * MIN);
  const healthy = {
    fence: [{ has_settings: true, outbound_enabled: true, has_route: true, route_enabled: true, provider: path.channel === "sms" ? "twilio" : "resend" }],
    templates: path.templates.map((key) => ({ template_key: key, compliance_passed: true, body: `Hi, this is Fundhub (${key}).`, subject: path.channel === "email" ? "Welcome to Fundhub" : null })),
    heartbeat: [{ finished_at: at(2), outcome: "ok" }, { finished_at: at(7), outcome: "ok" }, { finished_at: at(12), outcome: "ok" }],
    queue: [{ queued_n: 0, oldest_queued: null, sending_n: 0, oldest_sending: null, sample_error: null }],
    failures: [{ failed_n: 0, bounced_n: 0, blocked_n: 0, ok_n: 6, sample_error: null, sample_block: null }],
    receipts: [{ handed_n: 10, receipts_n: 9, waiting_n: 1 }],
    "opt-outs": [{ total: 0, active_n: 0 }]
  };
  return async (text) => {
    const label = /^\/\* pulse send-path: ([a-z-]+) \*\//.exec(String(text))?.[1];
    if (!label || !(label in healthy)) throw new Error(`fake read: no canned answer for ${String(text).slice(0, 60)}`);
    const o = over[label];
    if (o && o.error) throw (o.error instanceof Error ? o.error : new Error(String(o.error)));
    const rows = o === undefined ? healthy[label] : Array.isArray(o) ? o : [{ ...healthy[label][0], ...o }];
    return { rows, rowCount: rows.length };
  };
}

/* ------------------------------------------------------------------ */
/* The runner for both beats                                           */
/* ------------------------------------------------------------------ */

/* A read that failed is a red at the step, with the reason. A REFUSED read (the box said no) is
   passed through untouched so the harness names the refusal. */
async function readRows(ctx, step, sql, params, what) {
  try {
    const res = await ctx.read(sql, params);
    return res.rows;
  } catch (err) {
    if (err && err.name === "PulseRefused") throw err;
    throw ctx.fail(step, `could not read ${what}: ${cleanError((err && err.message) || err, 120)}`);
  }
}

/** Run every step of one path, in order. The first red stops the beat at that step. */
export async function runSendPath(ctx, path) {
  const now = ctx.now;
  const notes = [];
  const evidence = { channel: path.channel };
  const fail = (step, problems, extra) => ctx.fail(step, problems.join(" "), { ...evidence, ...(extra || {}) });

  await ctx.step("fence-open", async () => {
    const rows = await readRows(ctx, "fence-open", FENCE_SQL, [path.channel], "the send switch");
    const v = judgeFence({ row: rows[0], live: ctx.live, env: ctx.env, path });
    evidence.fence = v.facts;
    notes.push(...v.notes);
    if (v.problems.length) throw fail("fence-open", v.problems);
  });

  await ctx.step("template-ready", async () => {
    const rows = await readRows(ctx, "template-ready", TEMPLATE_SQL, [path.channel, [...path.templates]], "the message copy");
    const v = judgeTemplates({ rows, path });
    evidence.templatesChecked = v.checked;
    if (v.problems.length) throw fail("template-ready", v.problems);
  });

  await ctx.step("dispatcher-alive", async () => {
    const rows = await readRows(ctx, "dispatcher-alive", HEARTBEAT_SQL, [SWEEPER_JOB], "the sweeper's heartbeat");
    const v = judgeHeartbeat({ rows, now });
    evidence.sweeperAgeMin = v.ageMin;
    if (v.problem) throw fail("dispatcher-alive", [v.problem]);
  });

  await ctx.step("queue-moving", async () => {
    const rows = await readRows(
      ctx, "queue-moving", QUEUE_SQL,
      [path.channel, isoAgo(now, QUEUED_STUCK_MINUTES * MIN), isoAgo(now, SENDING_STUCK_MINUTES * MIN), TEST_ADDRESS_RE],
      "the line"
    );
    const v = judgeQueue({ row: rows[0], now, path });
    evidence.stuckQueued = v.queued;
    evidence.stuckSending = v.sending;
    if (v.problem) throw fail("queue-moving", [v.problem]);
  });

  await ctx.step("failures-recent", async () => {
    const rows = await readRows(
      ctx, "failures-recent", FAILURE_SQL,
      [path.channel, isoAgo(now, FAILURE_WINDOW_MINUTES * MIN), TEST_ADDRESS_RE],
      "recent failures"
    );
    const v = judgeFailures({ row: rows[0], path });
    evidence.failedLastHour = v.failed;
    evidence.bouncedLastHour = v.bounced;
    evidence.blockedLastHour = v.blocked;
    evidence.okLastHour = v.ok;
    if (v.problem) throw fail("failures-recent", [v.problem]);
    if (v.note) notes.push(v.note);
  });

  await ctx.step("receipts-moving", async () => {
    const rows = await readRows(
      ctx, "receipts-moving", RECEIPT_SQL,
      [path.channel, isoAgo(now, RECEIPT_WINDOW_HOURS * 60 * MIN), isoAgo(now, RECEIPT_SETTLE_MINUTES * MIN), TEST_ADDRESS_RE],
      "delivery receipts"
    );
    const v = judgeReceipts({ row: rows[0], path });
    evidence.receipts = { handed: v.handed, withReceipt: v.receipts, waiting: v.waiting, amber: v.amber };
    notes.push(v.note);
  });

  await ctx.step("opt-out-readable", async () => {
    const rows = await readRows(ctx, "opt-out-readable", OPT_OUT_SQL, [], "the opt-out list");
    if (!rows[0]) throw fail("opt-out-readable", ["The opt-out list answered with no row, so the sender cannot check who said STOP."]);
    evidence.optOuts = { total: num(rows[0].total), active: num(rows[0].active_n) };
  });

  if (path.channel === "email") {
    if (!ctx.live) {
      ctx.skipStep("unsubscribe-secret", "needs the live server settings; a laptop copy holds masks");
      notes.push("unsubscribe-secret skipped (not the live server)");
    } else {
      await ctx.step("unsubscribe-secret", async () => {
        const v = judgeUnsubscribeSecret(ctx.env);
        evidence.unsubscribeSecret = v.problem ? "bad" : "good";
        if (v.problem) throw fail("unsubscribe-secret", [v.problem]);
      });
    }
  }

  const lead = `${path.noun} path alive: switch, route, ${path.templates.length} templates, sweeper, line, failures and refusals, opt-outs ok`;
  return ctx.done([lead, ...notes].join("; "), evidence);
}
