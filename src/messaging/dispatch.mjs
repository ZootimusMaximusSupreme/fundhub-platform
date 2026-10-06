// W4 — the outbound dispatcher.
//
// Takes queued messages that are due, puts each one through the compliance gate,
// and hands the survivors to the provider its org has routed that channel to.
//
// THE ORDER IS THE POINT. gate → route → send, always, with no path that
// reaches a provider without a gate result of exactly "allowed". Every early
// return below happens BEFORE the provider is resolved, which is not a style
// choice: it means a bug in the routing code cannot produce a send, because the
// provider module has not been loaded yet at the moment any block is decided.
//
// SOMETHING IS SCHEDULED NOW. This header used to say nothing was, and that
// stopped being true when netlify/functions/staff-message-sweeper.mjs shipped:
// it calls dispatchDue({ senderStaffOnly: true }) every five minutes against
// production. Staff-typed replies are therefore a live send path. The legacy
// workflow backlog is still not drained by anything — see senderStaffOnly in
// claimDue below — but "nothing dispatches" is no longer a true sentence and
// reading it here talked at least one person out of checking.
//
// MESSAGING_DRY_RUN is what actually holds the door now. See step 2c.
//
// WHAT PROTECTS AGAINST DOUBLE SENDS. Three things, in order of reliability:
//   1. messages (org_id, provider_ref) unique index, migration 004 — the real
//      guarantee, applied when the row is created.
//   2. claimDue()'s UPDATE ... RETURNING, which flips status to 'sending' in the
//      same statement that selects the row. Two dispatchers racing cannot both
//      claim it; the second sees no row.
//   3. attempts / MAX_ATTEMPTS, which stops an infinite retry rather than a
//      duplicate.
// A plain SELECT-then-UPDATE would satisfy none of them.

import {
  gateAndRecord, inQuietHours, recipientSkipsQuietHours,
  QUIET_HOURS_CHANNELS, QUIET_END_HOUR, QUIET_HOURS_TZ
} from "./gate.mjs";
import { resolve, addressFieldFor } from "./providers/index.mjs";
import { isSynthetic } from "./live-fence.mjs";
import { isDraftTemplateCopy, isDraftTemplateRow } from "./draft-guard.mjs";
import { fenceVerdict, MESSAGING_DRY_RUN } from "../lib/dry-run.mjs";
import { signUnsubscribeUrl, withUnsubscribeFooter } from "./unsubscribe.mjs";
import { destinationAddress } from "../auth/authorized-rep.mjs";

/* If the document-check agent is retired, leftover queued SMS-DOC-02 must not
   transmit. The code below treats "no row" as retired, so this literal MUST
   track the agents row's `code`. Migration 310 renamed it GHL-DOC -> DOC-CHECK;
   a stale literal here silently blocks every request-a-better-photo text and the
   client is told nothing at all. */
const RETIRED_DOC_CHECK_SMS = "SMS-DOC-02-REQUEST-MORE";

async function isRetiredDocCheckSms(db, message) {
  if (message.template_key !== RETIRED_DOC_CHECK_SMS) return false;
  const { rows } = await db.query(
    `SELECT status FROM agents WHERE org_id = $1 AND code = 'DOC-CHECK' LIMIT 1`,
    [message.org_id]
  );
  return !rows[0] || String(rows[0].status || "") === "retired";
}

/* Unedited sample copy, recognised by the opening of the standard lorem-ipsum
   passage rather than by any single Latin word. "dolor", "sit" and "amet" all
   occur in real Spanish and Portuguese sentences, and a guard that blocks a
   genuine message is worse than the gap it closes. Exported so a test can hold
   the rule still. */
const PLACEHOLDER_RE = /lorem\s+ipsum/i;

export function isPlaceholderCopy(text) {
  return PLACEHOLDER_RE.test(String(text ?? ""));
}

/* The public origin an emailed link has to point at. Same expression the rest
   of the messaging path already uses to build portal links
   (src/workflows/messaging.mjs), rather than a fourth base-URL convention:
   APP_BASE_URL, then Netlify's own URL, then the live site. */
function publicBaseUrl(env = process.env) {
  return String(env.APP_BASE_URL || env.URL || "https://fundhub.ai").replace(/\/+$/, "");
}

/* A clock value, resolved to whatever a `::timestamptz` bind param accepts.
   `now` arrives here as null, a Date, an ISO string, or — from a virtual
   clock like the journey runner's — a function returning epoch milliseconds.
   Binding that number straight to a $n::timestamptz parameter sent Postgres a
   string like "1767399600000", and it rejected it as an out-of-range
   date/time field: a bare numeric string is not a timestamp literal. Every
   shape here converts to an ISO string (or null) before it reaches a query. */
export function resolveTimestampParam(now) {
  const value = typeof now === "function" ? now() : now;
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") return new Date(value).toISOString();
  return value;
}

/** How many times a message is retried before it is given up on. */
export const MAX_ATTEMPTS = 5;

/** How many messages one dispatch pass claims. Bounded so a backlog is worked
    through in steady batches rather than one pass trying to hold all of it. */
export const DEFAULT_BATCH = 50;

/* Outcome codes returned per message. Named so callers and tests agree on the
   vocabulary, and so a new outcome is a visible addition here rather than a new
   string literal buried in a branch. */
export const OUTCOME = Object.freeze({
  SENT: "sent",
  BLOCKED: "blocked",           // the gate held it
  NO_ROUTE: "no_route",         // no routing row, or the channel is disabled
  UNKNOWN_PROVIDER: "unknown_provider",
  CHANNEL_MISMATCH: "channel_mismatch",
  NO_ADDRESS: "no_address",
  REJECTED: "rejected",         // provider says never retry
  RETRY: "retry",               // provider says try again
  GAVE_UP: "gave_up",           // out of attempts
  DEFERRED: "deferred",         // inside quiet hours; due again when it opens
  SYNTHETIC: "synthetic",       // a test record, and the provider is real
  DRY_RUN: "dry_run",           // the fence is up; held, not failed
  TEST_ADDRESS: "test_address"  // the provider refuses this address on sight
});

/* ── QUIET HOURS ARE A DEFERRAL, NOT A BLOCK ────────────────────────────────
   This is the one place the dispatcher deliberately decides something BEFORE
   the gate, and the reason is a conflict between two of W1's own rules.

   gateAndRecord() persists ANY non-allowed verdict as status='blocked' plus a
   blocked_reason, and 110_messages_outbound.sql states — correctly — that a
   block is an audit record which nothing may clear. Quiet hours are the one
   gate reason that is meant to lapse on its own: the gate marks it
   `retryable: true` and its own message says the text "is being held until the
   window opens".

   Put those together and a text queued at 11pm is blocked permanently and never
   goes out at 11am. The acceptance criterion for this ticket says the opposite,
   and the gate's own wording says the opposite.

   So a text inside the window is never gated at all. It is put back on the queue
   with its due time moved to the next 08:00 Arizona, no verdict is recorded, and
   it is gated fresh when it wakes — which is what the gate's header asks for
   anyway, since opt-out state must be read at the instant of sending and not
   eleven hours earlier.

   This costs nothing in safety. The deferral is strictly narrower than the
   block: it uses W1's own exported window (inQuietHours / QUIET_HOURS_CHANNELS),
   it cannot send, and every other gate reason still runs through gateAndRecord
   unchanged. It is not an override — there is no way to reach a provider from
   here, and no flag makes the window shorter.

   Recorded on the board as a correction to W4, not a silent divergence. */

/* tzOffsetMs — how far the named zone is from UTC at this instant.
   Read out of Intl rather than hardcoded, so daylight saving is the operating
   system's timezone database's problem and not this file's. */
function tzOffsetMs(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asUtc - date.getTime();
}

/* nextQuietHoursEnd — the next instant at which QUIET_END_HOUR strikes in the
   quiet-hours zone.

   Built by reading the wall clock in that zone, choosing today or tomorrow, and
   converting back. The offset is applied twice because the offset at the target
   instant is not always the offset now — on the two daylight-saving nights a
   year they differ by an hour, and a single pass would land at 10:00 or 12:00.

   Exported so the transition dates can be asserted directly. */
export function nextQuietHoursEnd(from, timeZone = QUIET_HOURS_TZ) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit"
  }).formatToParts(from);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const hour = +p.hour % 24;

  // Before the window opens today → today. Otherwise (we are at or past the
  // 20:00 start) → tomorrow. Date.UTC normalises a day past the month's end.
  const dayShift = hour < QUIET_END_HOUR ? 0 : 1;
  const wall = Date.UTC(+p.year, +p.month - 1, +p.day + dayShift, QUIET_END_HOUR, 0, 0);

  let ts = wall;
  for (let i = 0; i < 2; i += 1) ts = wall - tzOffsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/* claimDue — take up to `limit` due messages and mark them 'sending' atomically.

   The UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) shape is what makes
   two dispatchers safe to run at once: SKIP LOCKED means the second one steps
   over rows the first has claimed instead of blocking on them, and the status
   flip is in the same statement as the selection so there is no window between
   deciding to send and recording that we did.

   scheduled_at IS NULL means due immediately — the shape every row queued by
   src/workflows/messaging.mjs is already in. */
export async function claimDue(db, { orgId = null, limit = DEFAULT_BATCH, now = null, senderStaffOnly = false } = {}) {
  /* `now` IS A CLOCK FUNCTION EVERYWHERE ELSE IN THIS FEATURE. The gate takes
     one, dispatchOne forwards one, and dispatchDue hands the same options
     object to both — so this has to accept the same shape. It previously took
     only a bare timestamp, which meant dispatchDue could not be driven with a
     fixed clock at all: the function itself went into a timestamptz parameter
     and Postgres rejected it. Neither existing test caught that, because each
     function was only ever driven on its own.

     Calling the function was only half the fix. A virtual clock (the journey
     runner's) returns epoch milliseconds, and THAT bound straight to
     $3::timestamptz fails too — Postgres sees the text "1767399600000" and
     rejects it as an out-of-range date/time field, not as a timestamp. Never
     caught before src/journeys/runner/index.test.mjs's fakeDb() was pointed at
     a real database, because a mock db does not validate a cast. Every shape
     (null, Date, ISO string, epoch ms) is normalized to an ISO string below —
     see resolveTimestampParam. */
  const at = resolveTimestampParam(now);

  /* senderStaffOnly — "only messages a person wrote".

     ═══════════════════════════════════════════════════════════════════════
     THIS EXISTS BECAUSE THE BACKLOG IS NOT ALL THE SAME AGE OR THE SAME KIND.

     `messages` already holds several thousand rows queued by workflows over
     months (110_messages_outbound.sql says so in as many words). None of them
     has ever been dispatched, because nothing has ever called the dispatcher.
     The instant anything sweeps the queue on a schedule, every one of those
     becomes due at once and goes out — months of stale automated messages
     landing on real people in one afternoon.

     That is not a hypothetical and it is not this feature's decision to make.
     So the sweeper that releases held STAFF replies filters to exactly those:
     `sender_staff_id IS NOT NULL` is true only for rows written by
     src/messaging/compose.mjs, i.e. a message a named employee typed and
     pressed Send on, which was then held for the night. Releasing those is
     what the owner asked for. Draining the legacy workflow backlog is a
     separate, deliberate act by a human and is deliberately NOT done here.

     Default false, so every existing caller — dispatchDue() from a test, a
     future full drain — behaves exactly as it did. */
  const { rows } = await db.query(
    `UPDATE messages m
        SET status = 'sending', last_attempt_at = now(), attempts = m.attempts + 1
       FROM (
         SELECT id FROM messages
          WHERE direction = 'outbound'
            AND status = 'queued'
            AND (scheduled_at IS NULL OR scheduled_at <= COALESCE($3::timestamptz, now()))
            AND ($1::uuid IS NULL OR org_id = $1)
            AND attempts < $4
            AND ($5::boolean IS NOT TRUE OR sender_staff_id IS NOT NULL)
          ORDER BY scheduled_at NULLS FIRST, created_at
          LIMIT $2
          FOR UPDATE SKIP LOCKED
       ) due
      WHERE m.id = due.id
  RETURNING m.id, m.org_id, m.client_id, m.channel, m.rendered_body,
            m.template_key, m.provider_ref, m.attempts, m.to_address, m.subject,
            m.attachments`,
    [orgId, limit, at, MAX_ATTEMPTS, senderStaffOnly === true]
  );
  return rows;
}

/* routeFor — which provider carries this channel for this org.

   NO ROW, OR enabled = false, IS A HOLD. There is deliberately no fallback: a
   dispatcher that guesses when routing is missing is the failure
   message_channel_routing exists to prevent. */
async function routeFor(db, orgId, channel) {
  const { rows } = await db.query(
    `SELECT provider, enabled FROM message_channel_routing
      WHERE org_id = $1 AND channel = $2`,
    [orgId, channel]
  );
  return rows[0] || null;
}

/* addressFor — the destination, read off the client record.

   Which column depends on the provider, not the channel: Mailgun wants an email
   address, the CRM relay wants a contact id. Asking the provider (via
   ADDRESS_FIELD) rather than branching on its name here means adding a provider
   does not mean editing this file.

   The column name comes from the provider's own constant and is validated
   against an allow-list before it reaches SQL — a value that decides a column
   name must never be interpolated on trust. */
const ADDRESS_COLUMNS = new Set(["email", "phone", "ghl_contact_id"]);

/* Which client column is the natural destination for a channel. Kept in step
   with ADDRESS_BY_CHANNEL in src/workflows/messaging.mjs, which is what writes
   messages.to_address. */
const NATURAL_COLUMN = { email: "email", sms: "phone", voice: "phone" };

/* A provider that carries every channel cannot name one column, so it declares
   ADDRESS_FIELD = "natural" and gets the channel's own column instead. Added at
   the five-branch merge for `internal` and `memory`; every vendor provider still
   names its column outright, because Mailgun wanting an email address and the
   The CRM relay wanting a contact id is exactly the thing ADDRESS_FIELD records. */
const NATURAL = "natural";

/** The client column this provider reads for this channel, or null if there
    isn't one. Exported shape of the "natural" indirection, so the no-address
    error names a real column instead of the word "natural". */
function addressColumnFor(providerName, channel) {
  const declared = addressFieldFor(providerName);
  const field = declared === NATURAL ? NATURAL_COLUMN[channel] : declared;
  return field && ADDRESS_COLUMNS.has(field) ? field : null;
}

async function addressFor(db, message, providerName) {
  const field = addressColumnFor(providerName, message.channel);
  if (!field) return null;

  /* PREFER THE ADDRESS RECORDED WHEN THE MESSAGE WAS QUEUED (111).
     A message that has been waiting should go where it was written to go, not
     wherever the client record points now.

     Only when the provider addresses by the channel's natural column, though.
     The CRM relay addresses a contact id, which is not a destination the queue
     could have recorded in channel terms, so that resolves live. And rows queued
     before 111 have no recorded address at all — they fall through to the same
     lookup the dispatcher did before this column existed. */
  if (message.to_address && field === NATURAL_COLUMN[message.channel]) {
    return message.to_address;
  }

  const { rows } = await db.query(
    `SELECT ${field} AS address FROM clients WHERE id = $1 LIMIT 1`,
    [message.client_id]
  );
  const fallback = rows[0]?.address || null;
  if (field === "email" || field === "phone") {
    const channel = field === "email" ? "email" : message.channel;
    return destinationAddress(db, message.client_id, channel, fallback);
  }
  return fallback;
}

/* subjectFor — the email subject line.

   The messages table carries `rendered_body` but no subject column, so the
   subject lives on message_templates where the copy came from. Looked up only
   for email: SMS has no subject, and a query per text message to fetch a column
   that cannot apply is waste in the dispatcher's hot path.

   A missing subject is not fatal here — the provider decides. Mailgun accepts a
   message without one, and inventing a subject would be putting unreviewed copy
   in front of a client, which is exactly what the gate exists to stop. */
async function subjectFor(db, message) {
  if (message.channel !== "email") return null;

  // Recorded at queue time by 111, already rendered. Preferred over the template
  // lookup because the template's raw text still carries unrendered merge tags —
  // reading it here would put "Hi {{contact.first_name}}" in a subject line.
  if (message.subject) return message.subject;

  if (!message.template_key) return null;
  const { rows } = await db.query(
    `SELECT subject FROM message_templates
      WHERE org_id = $1 AND template_key = $2 LIMIT 1`,
    [message.org_id, message.template_key]
  );
  return rows[0]?.subject || null;
}

/* dispatchOne — gate, route, send, record. One message.

   Returns { id, outcome, detail } and never throws: one poisoned message must
   not stop the batch behind it.

   `message` is a claimed row from claimDue(). */
export async function dispatchOne(db, message, options = {}) {
  const { fetchImpl, timeoutMs, signal, env, now } = options;

  try {
    // ---- 0. Quiet hours: defer, do not gate --------------------------------
    // See the long note at the top of this file. This is the only decision made
    // ahead of the gate, it can only ever hold a message back, and it exists so
    // an overnight text is still sendable in the morning instead of being
    // recorded as a permanent block.
    const clock = typeof now === "function" ? now : () => new Date();
    if (QUIET_HOURS_CHANNELS.has(message.channel) && inQuietHours(clock(), QUIET_HOURS_TZ)) {
      const skipQuiet = await recipientSkipsQuietHours(db, message.client_id);
      if (!skipQuiet) {
        const due = nextQuietHoursEnd(clock(), QUIET_HOURS_TZ);
        await db.query(
          // The attempt is given back: an unopened window is not a failed
          // delivery, and charging it would burn the retry budget overnight.
          `UPDATE messages
              SET status = 'queued', scheduled_at = $2, attempts = GREATEST(attempts - 1, 0)
            WHERE id = $1`,
          [message.id, due.toISOString()]
        );
        return { id: message.id, outcome: OUTCOME.DEFERRED, detail: due.toISOString() };
      }
    }

    // ---- 1. THE GATE, FIRST, ALWAYS ---------------------------------------
    // gateAndRecord writes blocked_reason/blocked_at and files the task. Note
    // this runs before any provider is resolved, so no code path here can reach
    // a provider with a non-allowed result.
    const verdict = await gateAndRecord(db, {
      orgId: message.org_id,
      clientId: message.client_id,
      channel: message.channel,
      body: message.rendered_body,
      messageId: message.id,
      templateKey: message.template_key,
      toAddress: message.to_address
    }, now ? { now } : {});

    if (verdict.state !== "allowed") {
      // gateAndRecord already set status='blocked'. Nothing further to write.
      return { id: message.id, outcome: OUTCOME.BLOCKED, detail: verdict.reasons.map((x) => x.code) };
    }

    // ---- 1b. DRAFT TEMPLATE HARD GUARD ------------------------------------
    // Even if compliance_passed was flipped true, placeholder [DRAFT] copy
    // must never transmit. Check the source template and the rendered body.
    if (isDraftTemplateCopy(message.rendered_body) || isDraftTemplateCopy(message.subject)) {
      console.warn(
        `[dispatch] blocked message ${message.id}: rendered body/subject still carries [DRAFT]`
      );
      return await finalise(db, message, "blocked", OUTCOME.BLOCKED,
        "draft_template", null);
    }

    /* ---- 1c. UNFINISHED PLACEHOLDER COPY ---------------------------------

       Same rule as the [DRAFT] guard above, for copy that was never marked.
       32 of the 237 live message templates are unedited sample copy carrying
       lorem ipsum — a whole family of BS-EMAIL-, BS-FUND- and BS-REPAIR- rows
       imported verbatim from the source document and never written (measured
       against production 2026-08-18).

       THEY CANNOT BE SENT TODAY, and that is worth being precise about: all 32
       are compliance_passed = false, and sendTemplated refuses an unapproved
       template. The gap this closes is the one human step between here and a
       client reading Latin — somebody opening the template editor and pressing
       Approve on a row they have not read. The [DRAFT] guard would not catch
       it, because these rows carry no [DRAFT] marker.

       Deliberately narrow. It looks for the two openings of the standard
       lorem-ipsum passage, not for stray Latin words: "dolor" alone appears in
       ordinary Spanish and Portuguese copy, and a guard that blocks real
       messages is worse than the one it replaced. */
    if (isPlaceholderCopy(message.rendered_body) || isPlaceholderCopy(message.subject)) {
      console.warn(
        `[dispatch] blocked message ${message.id}: the copy is still unedited placeholder text`
      );
      return await finalise(db, message, "blocked", OUTCOME.BLOCKED,
        "placeholder_copy", null);
    }
    if (message.template_key) {
      const { rows: tplRows } = await db.query(
        `SELECT body, subject FROM message_templates
          WHERE org_id = $1 AND template_key = $2 LIMIT 1`,
        [message.org_id, message.template_key]
      );
      if (tplRows[0] && isDraftTemplateRow(tplRows[0])) {
        console.warn(
          `[dispatch] blocked message ${message.id}: template ${message.template_key} is DRAFT`
        );
        return await finalise(db, message, "blocked", OUTCOME.BLOCKED,
          "draft_template", null);
      }
    }

    if (await isRetiredDocCheckSms(db, message)) {
      console.warn(
        `[dispatch] blocked message ${message.id}: DOC-CHECK is retired; SMS-DOC-02 not sent`
      );
      return await finalise(db, message, "blocked", OUTCOME.BLOCKED,
        "retired_ghl_doc", null);
    }

    // ---- 2. Routing --------------------------------------------------------
    const route = await routeFor(db, message.org_id, message.channel);
    if (!route || !route.enabled) {
      return await hold(db, message, OUTCOME.NO_ROUTE,
        route ? `${message.channel} is turned off for this org` : `no provider is routed for ${message.channel}`);
    }

    const provider = resolve(route.provider);
    if (!provider) {
      return await hold(db, message, OUTCOME.UNKNOWN_PROVIDER,
        `routing names "${route.provider}", which is not a known provider`);
    }
    if (!provider.CHANNELS.has(message.channel)) {
      return await hold(db, message, OUTCOME.CHANNEL_MISMATCH,
        `${route.provider} does not carry ${message.channel}`);
    }

    /* ---- 2b. A TEST RECORD MUST NEVER MEET A REAL PROVIDER ----------------
       src/messaging/live-fence.mjs stopped being called from here at the
       five-branch merge, for a good reason: it refused every client that was
       not marked synthetic, which is every real client, so leaving it wired in
       would have refused all production mail the day sending switched on. Its
       header says plainly that layer 1 went from structural to positional and
       that "when W5 plugs sending in, somebody has to decide what the
       per-message rule is for a REAL client."

       Sending is plugged in now (119 / src/messaging/outbox.mjs), so that
       question is live and this is the answer: the rule is the INVERSE of the
       old one. Not "only synthetic clients may be sent to" — that refuses
       everybody real. It is "a synthetic client may never be sent to by a
       provider that can transmit."

       WHY IT IS NEEDED AT ALL, given preflight(). preflight() refuses a whole
       journey run when the org's routing can reach the outside world, so a run
       cannot queue synthetic messages against a live route. What it cannot
       cover is the ORDER SWITCHING: a run against the `memory` provider leaves
       synthetic messages queued, somebody later routes email to Mailgun, and
       the next drain mails invented people at whatever address the synthetic
       record happened to carry. The queue outlives the routing that was in
       place when it was written, so the check has to sit next to the send.

       It is checked after the provider is resolved (we need TRANSMITS) and
       before the send, and it is FINAL — a synthetic message is never a real
       message, so retrying it can only ever be wrong. No override, no env var,
       no "just this once", same as the compliance gate. */
    if (provider.TRANSMITS === true) {
      const { rows: cf } = await db.query(
        `SELECT custom_fields FROM clients WHERE id = $1 LIMIT 1`, [message.client_id]);
      if (isSynthetic(cf[0])) {
        return await finalise(db, message, "failed", OUTCOME.SYNTHETIC,
          "this is a test record from a journey run and the provider is real — refused",
          route.provider);
      }
    }

    /* ---- 2c. THE DRY-RUN FENCE -------------------------------------------
       MESSAGING_DRY_RUN stops anything that can reach a real person. Checked
       here because it needs the resolved provider's TRANSMITS flag, and before
       addressFor() so a held message costs no client lookup.

       IT IS A HOLD, NOT A FAILURE, and that distinction is the whole design.
       Dry run is a property of the deployment, not of the message: the message
       is fine, this box is simply not allowed to send today. hold() puts it
       back on 'queued' and refunds the attempt, so switching the flag off
       releases the backlog instead of leaving a day's messages stranded at the
       attempt ceiling with no way back. Recording these as permanent failures
       would quietly destroy the queue every time somebody tested safely.

       IT DOES NOT TOUCH NON-TRANSMITTING PROVIDERS. `internal` and `memory`
       exist to be exercised with the fence up — that is what they are for —
       so gating them would make dry run mean "nothing works" rather than
       "nothing leaves the building", and journey runs would stop dead.

       ORDER MATTERS: this sits after the synthetic check, not before it. A
       synthetic record is permanently refused because the message itself is
       wrong, and that verdict should be recorded once and for good rather than
       deferred behind a flag that will be switched off later.

       THIS IS NOT THE THING THAT MAKES THE FENCE SAFE. src/lib/outbound-fetch.mjs
       is — the provider physically cannot reach the network with the fence up,
       whether or not this check exists. What this adds is the right BOOKKEEPING:
       caught here, a held message is re-queued with its attempt refunded, where
       caught at the wire it would come back as a provider failure and burn the
       retry budget. Belt and braces, with the braces doing the real work. */
    if (provider.TRANSMITS === true) {
      const fence = fenceVerdict(MESSAGING_DRY_RUN, env);
      if (!fence.allowed) {
        return await hold(db, message, OUTCOME.DRY_RUN,
          `${fence.reason} (${message.channel} via ${route.provider})`);
      }
    }

    const address = await addressFor(db, message, route.provider);
    if (!address) {
      // Permanent for this message: no retry produces an address the client
      // record does not have.
      return await finalise(db, message, "failed", OUTCOME.NO_ADDRESS,
        `the client has no ${addressColumnFor(route.provider, message.channel)} to send to`, route.provider);
    }

    /* ---- 2d. AN ADDRESS THE PROVIDER WILL NEVER TAKE ----------------------
       A provider may declare refusedAddress(to): a pure check, no network, for
       destinations it refuses on sight. Resend does, for the reserved test
       domains (example.com and the rest). Asked here, before the send, so a
       test lead from a live walk of the funnel is recorded as 'blocked' with
       the reason, instead of being handed to the vendor and logged as a failed
       email. Measured 2026-10-01: 6 welcome + 5 finish-application emails
       "failed" this way, every one to an @example.com address, none to a
       person. Final, not a hold: no retry turns example.com into an inbox. */
    if (typeof provider.refusedAddress === "function") {
      const refused = provider.refusedAddress(address);
      if (refused) {
        return await finalise(db, message, "blocked", OUTCOME.TEST_ADDRESS, refused, null);
      }
    }

    /* ---- 2b. The way out ---------------------------------------------------

       Every outbound email leaves with a working unsubscribe link, and it is
       built HERE rather than in the provider or in the template.

       Not the provider: the provider contract is that it never mutates the
       message — "no truncation, no appended footer" — and three tests in
       providers.test.mjs hold all three providers to it.

       Not the template: there are 237 of them, 173 of which already promise an
       unsubscribe in words and none of which carried a link (measured against
       production 2026-08-18). Editing 173 rows to paste the same link in is
       173 chances to get it wrong, and the link has to be per-client anyway.

       THE STORED COPY IS NOT REWRITTEN. messages.rendered_body keeps exactly
       what the compliance gate approved; the footer is added to the copy handed
       to the provider and nowhere else. That does mean rendered_body is no
       longer byte-identical to what left the building, and the footer is the
       difference — which is the honest trade, because making rendered_body
       differ from the approved copy would break the one thing that column is
       for.

       EMAIL ONLY. A text message opts out with the word STOP, which the inbound
       handler reads; appending a URL to an SMS would cost a segment and break
       the twilio no-footer test.

       IF THE LINK CANNOT BE SIGNED THE MAIL STILL GOES, LOUDLY. Holding it was
       the first instinct and it is wrong here, because most of what this system
       actually sends is transactional — the portal sign-in link, the contract,
       the invoice. Holding those because a marketing footer could not be signed
       would lock clients out of their own portal to satisfy an obligation that
       does not apply to a sign-in email in the first place.

       The right rule is "footer required on commercial mail, not on
       transactional mail", and THIS REPO HAS NO WAY TO TELL THE TWO APART —
       message_templates carries no such flag. That absence is a finding, not a
       gap to fill with a guess, so it is written down here and reported rather
       than invented. Until it exists: send, and make the failure impossible to
       miss in the log. In production both signing secrets are set, so this
       branch does not fire. */
    let outboundBody = message.rendered_body;
    let unsubscribeUrl = null;
    if (message.channel === "email" && message.client_id) {
      try {
        unsubscribeUrl = signUnsubscribeUrl({
          orgId: message.org_id,
          clientId: message.client_id,
          channel: "email",
          baseUrl: publicBaseUrl(env),
          env
        }).url;
        outboundBody = withUnsubscribeFooter(message.rendered_body, unsubscribeUrl);
      } catch (err) {
        unsubscribeUrl = null;
        console.warn(
          `[dispatch] message ${message.id} is going out WITHOUT an unsubscribe link — ` +
          `${String(err?.message || err)}. Set UNSUBSCRIBE_TOKEN_SECRET.`
        );
      }
    }

    // ---- 3. Send -----------------------------------------------------------
    const result = await provider.send({
      id: message.id,
      orgId: message.org_id,
      clientId: message.client_id,
      channel: message.channel,
      to: address,
      subject: await subjectFor(db, message),
      body: outboundBody,
      providerRef: message.provider_ref,
      // Passed alongside the body, not inside it. The provider turns this into
      // the RFC 8058 List-Unsubscribe headers, which are metadata rather than
      // message content — so setting them does not break the never-mutate rule.
      unsubscribeUrl,
      attachments: message.attachments || null
    }, { fetchImpl, timeoutMs, signal, env });

    // ---- 4. Record ---------------------------------------------------------
    if (result.status === "sent") {
      await db.query(
        `UPDATE messages
            SET status = 'sent', provider = $2, provider_message_id = $3, last_error = NULL
          WHERE id = $1`,
        [message.id, route.provider, result.providerMessageId]
      );
      return { id: message.id, outcome: OUTCOME.SENT, detail: result.providerMessageId };
    }

    if (result.status === "rejected" || !result.retryable) {
      return await finalise(db, message, "failed", OUTCOME.REJECTED, result.error, route.provider);
    }

    // Retryable. Out of attempts is where a retry loop stops being a retry loop.
    if (message.attempts >= MAX_ATTEMPTS) {
      return await finalise(db, message, "failed", OUTCOME.GAVE_UP,
        `gave up after ${message.attempts} attempts: ${result.error || "no reason given"}`, route.provider);
    }

    await db.query(
      `UPDATE messages SET status = 'queued', provider = $2, last_error = $3 WHERE id = $1`,
      [message.id, route.provider, result.error]
    );
    return { id: message.id, outcome: OUTCOME.RETRY, detail: result.error };
  } catch (err) {
    // A message that broke the dispatcher goes back on the queue rather than
    // being lost, and the reason is recorded. It stops on its own once attempts
    // run out — claimDue() will not pick up a row at MAX_ATTEMPTS.
    const detail = String((err && err.message) || err).slice(0, 300);
    try {
      await db.query(
        `UPDATE messages SET status = 'queued', last_error = $2 WHERE id = $1`,
        [message.id, detail]
      );
    } catch { /* the database is the thing that is broken; nothing to add */ }
    return { id: message.id, outcome: OUTCOME.RETRY, detail };
  }
}

/* hold — a configuration problem, not a message problem.

   Back to 'queued' and the attempt is given back, so fixing the routing row
   releases the backlog instead of leaving it stuck at the attempt ceiling. A
   missing route is nobody's message being wrong. */
async function hold(db, message, outcome, detail) {
  await db.query(
    `UPDATE messages
        SET status = 'queued', last_error = $2, attempts = GREATEST(attempts - 1, 0)
      WHERE id = $1`,
    [message.id, detail]
  );
  return { id: message.id, outcome, detail };
}

/* finalise — a permanent outcome. The message stops here. */
async function finalise(db, message, status, outcome, detail, provider) {
  await db.query(
    `UPDATE messages SET status = $2, provider = $3, last_error = $4 WHERE id = $1`,
    [message.id, status, provider || null, detail ? String(detail).slice(0, 300) : null]
  );
  return { id: message.id, outcome, detail };
}

/* claimOne — claim ONE named message, atomically, by id.

   Same UPDATE ... RETURNING shape as claimDue and for the same reason: the
   status flip to 'sending' happens in the statement that selects the row, so
   two callers racing on the same id cannot both get it — the second sees no
   row because the first has already moved it off 'queued'.

   THE PREDICATES ARE claimDue's, MINUS THE DUE TIME. direction, status and the
   attempt ceiling all still hold, so this cannot be used to re-send something
   already sent, to send an inbound row, or to push a message past MAX_ATTEMPTS.
   The `scheduled_at <= now()` clause is deliberately absent: a caller naming a
   message by id is asking to work THAT message now, and a staff reply is queued
   with no schedule anyway. Note what that does NOT open — quiet hours are not
   a schedule, they are checked inside dispatchOne against the clock, so a text
   named here at midnight still defers rather than sending.

   Returns the claimed row, or null if there was nothing claimable. */
async function claimOne(db, messageId) {
  const { rows } = await db.query(
    `UPDATE messages
        SET status = 'sending', last_attempt_at = now(), attempts = attempts + 1
      WHERE id = $1
        AND direction = 'outbound'
        AND status = 'queued'
        AND attempts < $2
  RETURNING id, org_id, client_id, channel, rendered_body,
            template_key, provider_ref, attempts, to_address, subject, attachments`,
    [messageId, MAX_ATTEMPTS]
  );
  return rows[0] || null;
}

/* dispatchMessage — claim one message by id and dispatch it now.

   THE ENTRY POINT FOR A SEND SOMEONE IS WAITING ON. dispatchDue() works a
   backlog on whatever schedule eventually runs it; a staff member who just
   pressed Send needs an answer about THIS message in THIS request, and polling
   a batch dispatcher for it would be both slower and racier.

   IT ADDS NO CAPABILITY. Every check, every block, every deferral is
   dispatchOne's, unchanged — this function resolves an id to a claimed row and
   hands it over. There is no options key it accepts that dispatchOne does not,
   and in particular there is nothing here that can skip the gate. Compare the
   two call sites: dispatchDue passes claimDue's rows to dispatchOne, this passes
   claimOne's row to dispatchOne, and dispatchOne cannot tell them apart.

   Returns dispatchOne's shape, or { id, outcome: "not_claimable" } when the row
   was not there to claim — already sent, already blocked, being dispatched by
   somebody else, or out of attempts. That is a real answer, not an error: it
   means this message is not currently the caller's to send.

   NOTHING SCHEDULES THIS EITHER. The module header's "nothing is scheduled"
   still holds — there is still no cron, no timer and no Inngest registration.
   This runs when a request calls it. */
export const NOT_CLAIMABLE = "not_claimable";

export async function dispatchMessage(db, messageId, options = {}) {
  if (!messageId) throw new Error("dispatchMessage: messageId is required");
  const claimed = await claimOne(db, messageId);
  if (!claimed) return { id: messageId, outcome: NOT_CLAIMABLE, detail: null };
  return await dispatchOne(db, claimed, options);
}

/* dispatchDue — claim a batch and dispatch each one.

   Sequential rather than concurrent on purpose: providers rate-limit, and a
   burst of parallel sends against a shared limit turns into 429s that all
   classify as retryable and come back next pass. Throughput here is not the
   constraint; the batch size is. */
export async function dispatchDue(db, options = {}) {
  const claimed = await claimDue(db, options);
  const results = [];
  for (const message of claimed) {
    results.push(await dispatchOne(db, message, options));
  }
  return {
    claimed: claimed.length,
    results,
    counts: results.reduce((acc, x) => { acc[x.outcome] = (acc[x.outcome] || 0) + 1; return acc; }, {})
  };
}

export default dispatchDue;
