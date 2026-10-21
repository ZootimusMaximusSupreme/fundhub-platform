// Messages truth — did the customer get the right message? Read only. Report only.
//
// W4 of the 2026-10-10 coverage batch (ops/workflows/coverage-every-surface-2026-10-10.md).
// The older lanes ask "did a message leave" (gap-sms.mjs: queue, receipts, blocks; gap-email.mjs: sending
// stuck, provider fails, magic links; gap-opt-out.mjs: STOP). This lane asks what the customer actually
// READ and whether the whole path worked, template by template. Nine yes-or-no questions:
//
//   msg:sent-body-blanks         Did any message that left (or is about to) carry an empty merge spot?
//   msg:staff-template-to-client Did a message written for staff go to someone who is not staff?
//   msg:links-in-body            Does every link in a sent message point at us, and does it open?
//   msg:per-template-path        Does each template reach an inbox, and does each event make its email?
//   msg:brakes                   Did a send go out past the pause switch, the daily cap, or twice?
//   msg:dead-senders             Did anything queue a template that nothing is supposed to send?
//   msg:owner-alerts-unsent      Is an owner alert text still queued with nobody to send it?
//   msg:hiring-outreach-blocked  Is candidate outreach stuck at the gate?
//   msg:help-reply               Did a person who texted HELP get an answer?
//
// RULES (heartbeat law, .claude/rules/heartbeat-on-every-build.md):
//   * SELECT only. Web calls are HEAD (and GET only for a page that refuses HEAD), never anything else.
//   * No text, no email, no AI call. This file imports no provider and holds no send.
//   * A failed read is a skip with the reason. A skip is never a PASS.
//   * A claim of "nothing to judge" carries a code the audit re-reads every morning (naVerify below).
//   * No repo file is read at run time. The dead-template list is data in msg-dead-templates.mjs.
//   * Test traffic is not a customer: demo flag, synthetic client, test address (same filter as gap-sms.mjs),
//     and the App Store review login (ROLE_TEST_CLIENT_KEY).
//   * Under 20 seconds. The reads run side by side; the link opens are capped in number and in time.
//
// Not duplicated here (already read by the gap-sms, gap-email and gap-opt-out lanes, and by pipeline:outbound):
// queued past 30 minutes, stuck on sending, sent with no delivery receipt, failed at the provider, blocked by our
// own gate, a customer reply that got lost, approved copy with lorem or [DRAFT], a STOP that did not stick, and the
// seven text journeys.
//
// ONE JUDGE, TWO CLOCKS (2026-10-20). The first five checks (blanks, staff template, links, per-template path,
// brakes) live in src/pulse/beats/lib/msg-truth.mjs, so this morning lane and the hourly beat message-health run
// the same SQL and the same verdicts. This file imports them back and keeps the other four, the "nothing to
// judge" proof (naVerify) and the run's fetch (fetchOf), which a beat may not name.

import { DEAD_TEMPLATE_KEYS } from "./msg-dead-templates.mjs";
import {
  CHECK_IDS, DAY, DEAD_LOOKBACK_DAYS, HELP_ANSWER_HOURS, HELP_GRACE_MINUTES, HELP_LOOKBACK_DAYS, HOUR,
  LEFT_OR_GOING_SQL, MINUTE, OWNER_ALERT_GRACE_HOURS, TAIL, agoIso, canQuery, clip, guarded, judgeLinkRows, naRow,
  nowOf, num, plural, readRows, real, row, runMsgTruthChecks, tally
} from "../beats/lib/msg-truth.mjs";
import { TEST_ADDRESS_RE } from "../beats/lib/sms-truth.mjs";

export * from "../beats/lib/msg-truth.mjs";

/** The run's page opener: the fetch the morning pulse hands in, or none. */
function fetchOf(ctx) {
  if (ctx && typeof ctx.fetchImpl === "function") return ctx.fetchImpl;
  if (ctx && typeof ctx.fetch === "function") return ctx.fetch;
  return null;
}

/**
 * Judge the link rows (the lane's name for it). Same judge as the hourly beat: judgeLinkRows in msg-truth.mjs,
 * handed the run's fetch as the page opener, with the full link budget.
 */
export async function judgeLinks(rows, { fetchImpl = null, now = Date.now() } = {}) {
  return judgeLinkRows(rows, { openPage: fetchImpl, now });
}

// ── 6. msg:dead-senders ──────────────────────────────────────────────────────

/**
 * $1 org (null reads the default company), $2 since, $3 the dead keys, $4 TEST_ADDRESS_RE.
 * Also the naVerify read: the claim "nothing sends these" is true exactly when this finds no row.
 */
export const DEAD_QUEUED_SQL = `
SELECT m.template_key, m.channel, count(*)::int AS n, max(m.created_at) AS last_at
  FROM messages m
 WHERE m.org_id = COALESCE($1::uuid, (SELECT id FROM orgs WHERE is_default LIMIT 1))
   AND m.direction = 'outbound'
   AND m.template_key = ANY($3::text[])
   AND m.created_at >= $2::timestamptz
   AND ${real("m", "$4")}
 GROUP BY m.template_key, m.channel
 ORDER BY n DESC, m.template_key
 LIMIT 50`.trim();

const DEAD_FIX =
  "A template this list calls dead was queued, so something sends it now. Read the message rows. Either the sender is " +
  "new (build its checks like a live template's, then remove the key from src/pulse/coverage/msg-dead-templates.mjs) " +
  `or it is a test that reached the real queue. A person decides which. ${TAIL}`;

function judgeDead(rows, now) {
  const id = "msg:dead-senders";
  let total = 0;
  const pieces = [];
  for (const r of rows) {
    const n = num(r && r.n);
    if (n === null) return row(id, "skip", "The dead-template count came back unreadable.");
    if (n === 0) continue;
    total += n;
    pieces.push([clip(r.template_key, 60), n]);
  }
  if (total > 0) {
    return row(
      id,
      "FAIL",
      `${total} ${plural(total, "message", "messages")} used a template the list says nothing sends, in the last ${DEAD_LOOKBACK_DAYS} days: ${tally(pieces, 5)}.`,
      DEAD_FIX
    );
  }
  return naRow(
    id,
    "no-sender",
    { count: DEAD_TEMPLATE_KEYS.length, days: DEAD_LOOKBACK_DAYS, since: agoIso(now, DEAD_LOOKBACK_DAYS * DAY) },
    `${DEAD_TEMPLATE_KEYS.length} templates have no sender or are retired. None was queued in the last ${DEAD_LOOKBACK_DAYS} days. Judged the day one is.`
  );
}

async function checkDead(db, orgId, now) {
  const got = await readRows(db, DEAD_QUEUED_SQL, [
    orgId,
    agoIso(now, DEAD_LOOKBACK_DAYS * DAY),
    [...DEAD_TEMPLATE_KEYS],
    TEST_ADDRESS_RE
  ]);
  if (got.error || !got.rows) {
    return row("msg:dead-senders", "skip", `Dead templates not read: ${got.error || "no rows came back"}.`);
  }
  return judgeDead(got.rows, now);
}

/**
 * The audit calls this to prove a "nothing to judge" row again. It reads with the same SQL the lane used and
 * answers true only when the read really finds no queued message from a dead template. A throw is left to throw:
 * the audit counts a throw as false.
 * @param {{ since?: string, days?: number }} args
 * @param {{ db?: any, scope?: Function, now?: Date|string|number }} ctx
 */
export const naVerify = Object.freeze({
  "no-sender": async (args, ctx = {}) => {
    const run = bind(ctx);
    if (!run) return false;
    const now = ctx.now != null && Number.isFinite(new Date(ctx.now).getTime()) ? new Date(ctx.now) : new Date();
    const since = args && args.since ? new Date(args.since) : null;
    const days = Number(args && args.days);
    // A claim over less than a day proves nothing. The verifier does not trust the producer's window.
    const floor = new Date(now.getTime() - DAY);
    const from = since && Number.isFinite(since.getTime()) && since.getTime() <= floor.getTime()
      ? since
      : Number.isFinite(days) && days >= 1 ? new Date(now.getTime() - days * DAY) : null;
    if (!from) return false;
    const out = await run((tx) => tx.query(DEAD_QUEUED_SQL, [null, from.toISOString(), [...DEAD_TEMPLATE_KEYS], TEST_ADDRESS_RE]));
    const rows = out && Array.isArray(out.rows) ? out.rows : null;
    if (!rows) return false;
    return rows.every((r) => num(r && r.n) === 0);
  }
});

function bind(ctx) {
  if (ctx && typeof ctx.scope === "function") return ctx.scope;
  if (ctx && ctx.db && typeof ctx.db.query === "function") return (fn) => fn(ctx.db);
  return null;
}

// ── 6b. msg:owner-alerts-unsent ──────────────────────────────────────────────

/** $1 org, $2 queued-before. An owner alert is a row that waits for a sender (108_owner_notifications.sql). */
export const OWNER_ALERTS_SQL = `
SELECT status, count(*)::int AS n, min(created_at) AS oldest
  FROM owner_notifications
 WHERE org_id = $1::uuid
   AND (status = 'failed' OR (status = 'queued' AND created_at < $2::timestamptz))
 GROUP BY status
 ORDER BY status`.trim();

const OWNER_FIX =
  "Owner alert texts are written to owner_notifications and nothing sends them (sent_at stays empty until a sender is " +
  "built). Read the rows. A person builds the sender or clears the rows, not this check. " + TAIL;

function judgeOwnerAlerts(rows) {
  const id = "msg:owner-alerts-unsent";
  let queued = 0;
  let failed = 0;
  for (const r of rows) {
    const n = num(r && r.n);
    if (n === null) return row(id, "skip", "The owner-alert count came back unreadable.");
    if (r.status === "failed") failed += n;
    else queued += n;
  }
  if (queued + failed === 0) {
    return row(id, "PASS", `No owner alert text is waiting more than ${OWNER_ALERT_GRACE_HOURS} hour for a sender, and none failed.`);
  }
  const bits = [];
  if (queued) bits.push(`${queued} still queued with no sender`);
  if (failed) bits.push(`${failed} failed`);
  return row(id, "FAIL", `${queued + failed} owner alert ${plural(queued + failed, "text was", "texts were")} never sent: ${bits.join(", ")}.`, OWNER_FIX);
}

async function checkOwnerAlerts(db, orgId, now) {
  const got = await readRows(db, OWNER_ALERTS_SQL, [orgId, agoIso(now, OWNER_ALERT_GRACE_HOURS * HOUR)]);
  if (got.error || !got.rows) {
    return row("msg:owner-alerts-unsent", "skip", `Owner alerts not read: ${got.error || "no rows came back"}.`);
  }
  return judgeOwnerAlerts(got.rows);
}

// ── 6c. msg:hiring-outreach-blocked ──────────────────────────────────────────

/** $1 org, $2 queued-before. Candidate outreach has no client row, so the gate holds it as recipient_unknown. */
export const HIRING_BLOCKED_SQL = `
SELECT m.template_key, m.status, count(*)::int AS n, min(m.created_at) AS oldest
  FROM messages m
 WHERE m.org_id = $1::uuid
   AND m.direction = 'outbound'
   AND (m.template_key LIKE 'EMAIL-CANDIDATE-OUTREACH-%' OR m.template_key LIKE 'SMS-CANDIDATE-OUTREACH-%')
   AND (
        (m.status = 'blocked' AND m.blocked_reason = 'recipient_unknown')
     OR (m.status = 'queued' AND m.created_at < $2::timestamptz)
   )
   AND COALESCE(m.is_demo, false) = false
 GROUP BY m.template_key, m.status
 ORDER BY n DESC, m.template_key
 LIMIT 20`.trim();

const HIRING_FIX =
  "The gate refuses a message with no client on it unless its template key is on the allow-list in " +
  "src/messaging/gate.mjs (see the note at the bottom of src/hiring/outreach.mjs). A person adds the keys, not this " +
  `check. ${TAIL}`;

function judgeHiring(rows) {
  const id = "msg:hiring-outreach-blocked";
  let total = 0;
  const pieces = [];
  for (const r of rows) {
    const n = num(r && r.n);
    if (n === null) return row(id, "skip", "The candidate-outreach count came back unreadable.");
    if (n === 0) continue;
    total += n;
    pieces.push([`${clip(r.template_key, 50)} (${r.status})`, n]);
  }
  if (total === 0) return row(id, "PASS", "No candidate outreach message is blocked as recipient unknown or stuck in the queue.");
  return row(
    id,
    "FAIL",
    `${total} candidate outreach ${plural(total, "message is", "messages are")} held at the gate or stuck: ${tally(pieces, 4)}. No candidate got them.`,
    HIRING_FIX
  );
}

async function checkHiring(db, orgId, now) {
  const got = await readRows(db, HIRING_BLOCKED_SQL, [orgId, agoIso(now, OWNER_ALERT_GRACE_HOURS * HOUR)]);
  if (got.error || !got.rows) {
    return row("msg:hiring-outreach-blocked", "skip", `Candidate outreach not read: ${got.error || "no rows came back"}.`);
  }
  return judgeHiring(got.rows);
}

// ── 7. msg:help-reply ────────────────────────────────────────────────────────

/**
 * $1 org, $2 since, $3 judged-before (the grace), $4 answer window in hours, $5 left-statuses.
 * Starts from the door (the message.inbound event, which carries the sender's number and the words), because the
 * saved inbound row keeps no phone. A number that has ever been the "to" of an inbound event is one of ours.
 * Answered means: a text of ours went to that number after the HELP, inside the window, and did not fail or get held.
 */
export const HELP_SQL = `
SELECT count(*)::int AS asked,
       count(*) FILTER (WHERE r.answered)::int AS answered,
       count(*) FILTER (WHERE NOT r.answered)::int AS unanswered,
       min(r.created_at) FILTER (WHERE NOT r.answered) AS oldest
  FROM (
    SELECT e.created_at,
           EXISTS (
             SELECT 1 FROM messages o
              WHERE o.org_id = e.org_id
                AND o.direction = 'outbound'
                AND o.channel = 'sms'
                AND o.status IN (${LEFT_OR_GOING_SQL})
                AND o.created_at >= e.created_at
                AND o.created_at < e.created_at + make_interval(hours => $4::int)
                AND length(regexp_replace(COALESCE(e.payload->>'from', ''), '[^0-9]', '', 'g')) >= 10
                AND right(regexp_replace(COALESCE(o.to_address, ''), '[^0-9]', '', 'g'), 10)
                  = right(regexp_replace(COALESCE(e.payload->>'from', ''), '[^0-9]', '', 'g'), 10)
           ) AS answered
      FROM events e
     WHERE e.org_id = $1::uuid
       AND e.name = 'message.inbound'
       AND e.created_at >= $2::timestamptz
       AND e.created_at < $3::timestamptz
       AND COALESCE(e.is_demo, false) = false
       AND COALESCE(e.payload->>'channel', 'sms') = 'sms'
       AND upper(regexp_replace(btrim(COALESCE(e.payload->>'body', '')), '[[:punct:][:space:]]+$', '')) = 'HELP'
       AND NOT (
         length(regexp_replace(COALESCE(e.payload->>'from', ''), '[^0-9]', '', 'g')) >= 10
         AND right(regexp_replace(COALESCE(e.payload->>'from', ''), '[^0-9]', '', 'g'), 10) IN (
           SELECT right(regexp_replace(ev.payload->>'to', '[^0-9]', '', 'g'), 10)
             FROM events ev
            WHERE ev.org_id = $1::uuid
              AND ev.name = 'message.inbound'
              AND COALESCE(ev.payload->>'to', '') <> ''
         )
       )
  ) r`.trim();

const HELP_FIX =
  "Several of our texts tell people to reply HELP, and nothing in the app answers it (src/handlers/comms.mjs reads " +
  "STOP and START only). Read the message.inbound event. A person builds the HELP answer, not this check. " + TAIL;

function judgeHelp(r) {
  const id = "msg:help-reply";
  if (!r) return row(id, "skip", "The HELP count did not come back.");
  const asked = num(r.asked);
  const unanswered = num(r.unanswered);
  if (asked === null || unanswered === null) return row(id, "skip", "The HELP count came back unreadable.");
  if (unanswered > 0) {
    return row(
      id,
      "FAIL",
      `${unanswered} of ${asked} ${plural(asked, "person", "people")} who texted HELP in the last ${HELP_LOOKBACK_DAYS} days got no text back inside ${HELP_ANSWER_HOURS} hours. Only a text of ours on our own record counts, so a reply the phone company sends by itself is not seen.`,
      HELP_FIX
    );
  }
  if (asked === 0) {
    return row(id, "PASS", `No one texted HELP in the last ${HELP_LOOKBACK_DAYS} days (our own test lines left out), so no HELP went unanswered.`);
  }
  return row(id, "PASS", `${asked} ${plural(asked, "person", "people")} texted HELP in the last ${HELP_LOOKBACK_DAYS} days and each got a text back.`);
}

async function checkHelp(db, orgId, now) {
  const got = await readRows(db, HELP_SQL, [
    orgId,
    agoIso(now, HELP_LOOKBACK_DAYS * DAY),
    agoIso(now, HELP_GRACE_MINUTES * MINUTE),
    HELP_ANSWER_HOURS
  ]);
  if (got.error || !got.rows) {
    return row("msg:help-reply", "skip", `HELP texts not read: ${got.error || "no rows came back"}.`);
  }
  return judgeHelp(got.rows[0]);
}

// ── the lane ─────────────────────────────────────────────────────────────────

function allSkips(detail) {
  return CHECK_IDS.map((id) => row(id, "skip", detail));
}

/**
 * gapChecks — nine read-only rows, in CHECK_IDS order.
 * ctx: { db, orgId, now, fetch | fetchImpl }. SELECT only. HEAD (or GET) only. Never sends.
 */
export async function gapChecks(ctx = {}) {
  const db = ctx.db;
  const orgId = ctx.orgId;
  if (!canQuery(db)) return allSkips("No database in this run. Message truth not read.");
  if (!orgId) return allSkips("No company in this run. Message truth not read.");
  const now = nowOf(ctx);

  // The first five checks live in the beat-safe truth (the settings read is shared inside it); the lane hands it
  // the run's fetch as the page opener. The other four run here, side by side.
  const [[blanks, staff, links, path, brakes], dead, owner, hiring, help] = await Promise.all([
    runMsgTruthChecks({ db, orgId, now }, { openPage: fetchOf(ctx) }),
    guarded(CHECK_IDS[5], () => checkDead(db, orgId, now)),
    guarded(CHECK_IDS[6], () => checkOwnerAlerts(db, orgId, now)),
    guarded(CHECK_IDS[7], () => checkHiring(db, orgId, now)),
    guarded(CHECK_IDS[8], () => checkHelp(db, orgId, now))
  ]);
  return [blanks, staff, links, path, brakes, dead, owner, hiring, help];
}
