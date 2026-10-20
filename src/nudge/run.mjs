// The nudge runner — plan, then re-decide, then claim, then queue.
//
// COMPLIANCE REVIEW REQUIRED (CLAUDE.md §7). Client-facing messaging on a
// consumer-finance file.
//
// THIS FILE DOES NOT SEND. It writes a `messages` row with status='queued' via
// sendTemplated (src/workflows/messaging.mjs) and stops there. The dispatcher
// (src/messaging/dispatch.mjs, swept every five minutes) is the only thing that
// hands a row to a provider, and outbound transmission itself is permitted only
// inside src/messaging/providers/ — CLAUDE.md §12. There is no fetch in this
// module, no provider import, and no path around either.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// FOUR PHASES, AND WHY THE ORDER IS THE WHOLE DESIGN
//
//   1. PLAN     find overdue, client-owned waypoints whose next rung is due.
//   2. RE-DECIDE run every exit condition again, against the live row.
//   3. CLAIM    write the waypoint_nudges row FIRST, before anything is queued.
//   4. QUEUE    only now call sendTemplated, and record what came back.
//
// Phase 2 exists because of the exact wording of exit condition 1: check
// completion AT SEND TIME, not only at schedule time. A waypoint the client
// finishes in the seconds between the plan and the send must produce nothing.
// Splitting plan from deliver is what makes that provable rather than asserted
// — the test drives planNudges(), completes the waypoint, then drives
// deliverNudge() on the stale plan and watches zero rows appear.
//
// Phase 3 is before phase 4 for the reason the 2026-09-03 incident exists. That
// loop decided, then sent, then recorded — so sixteen duplicate webhooks each
// decided before any of them had recorded, and sixteen texts went out. Here the
// record IS the decision: whoever wins the insert owns the step and everyone
// else gets zero rows back from ON CONFLICT DO NOTHING and stops. There is no
// window between deciding and recording, because they are one statement.
//
// The cost of that ordering is honest and worth stating: if this process dies
// between the claim and the queue, the row sits at outcome='claimed' and that
// rung is spent without a message going out. It is NOT retried. A missed nudge
// is a stalled checklist item the client can see on their own page and a staff
// task at step 4; a retried nudge is the 51 texts. The trade only goes one way.
//
//
// ═══════════════════════════════════════════════════════════════════════════
// THE THREE CAPS, AND WHO ENFORCES THEM
//
// None of them is enforced here. All three are unique constraints in the
// database, and this file only reads the result:
//
//   FOUR MESSAGES PER WAYPOINT, EVER — UNIQUE (waypoint_id, step) with
//   CHECK (step BETWEEN 1 AND 4), db/migrations/365. A fifth row is unwritable.
//
//   ONE CLIENT-FACING MESSAGE PER CLIENT PER DAY, ACROSS EVERY WAYPOINT —
//   the partial UNIQUE (client_id, client_local_date), 365. Three overdue items
//   produce one text because the second and third inserts conflict, not
//   because a counter in JavaScript said so. A SELECT-then-INSERT here would
//   be the same check-then-write race `transactions` already has.
//
//   ONE CLIENT-FACING MESSAGE PER DESTINATION PER DAY —
//   the partial UNIQUE (org_id, destination_key, client_local_date),
//   db/migrations/369. The cap above counts RECORDS, and a person with two
//   client rows on the same phone is two records, so they got two texts in a
//   day. This one counts the phone number the text actually reaches. Both are
//   in force; the effective rule is the stricter of the two.
//
// ON CONFLICT DO NOTHING absorbs whichever one bites, which is why the caller
// has to ask afterwards which it was (whyClaimFailed).

import { db as defaultDb } from "../db.mjs";
import { emit } from "../events/bus.mjs";
import { createTask } from "../lib/create-task.mjs";
import { sendBlueprintCoachNudge as defaultSend, blueprintCoachNudgeEligibility } from "../blueprint/coach-nudge.mjs";
import { STEPS, FINAL_STEP, dueStep, stepFor } from "./ladder.mjs";
import { blockersFor, contactFor, BOUGHT_STATUSES, PENDING_PAYMENT_STATUSES, CHASEABLE_STATES } from "./exits.mjs";
import { CHECKOUT_LINK_TTL_DAYS } from "../paid-services/link-ttl.mjs";
import { destinationKey } from "./destination.mjs";
import { zoneForClient, isDaytime, localDate } from "./clock.mjs";

export const SOURCE_WORKFLOW = "waypoint-nudge";

/** Who picks up the step-4 task. The customer success manager owns the client
    after the sale — the mid check-in, the results interview and the human end
    of the AR ladder (290_csm_role.sql) — so a client who has stalled on their
    own checklist is exactly their work. */
export const STAFF_TASK_ROLE = "csm";

/** How many candidates one pass will consider. Bounded for the same reason
    message-dispatch-sweeper.mjs bounds its batch: an unbounded pass holds a
    function open for as long as the backlog is long.

    THE OLD JUSTIFICATION HERE WAS FALSE AND IT COST THE WHOLE FEATURE. It read
    "nothing is lost by stopping early — an unchased waypoint is still overdue
    on the next pass". That is true of a row that can still be chased. It is not
    true of a row that can NEVER be chased again: that row stays overdue for
    ever, it sorts FIRST because it is oldest, and it holds a slot on every pass
    from now on. The sweeper calls this with orgId=null, so those 200 slots are
    ONE BUDGET FOR THE WHOLE PLATFORM — one client's dead rows starve every
    other company on it.

    Three things fix it and all three are below.

      1. PERMANENT_STOPS_SQL — every permanent refusal is applied INSIDE the
         query, before the LIMIT. That is the actual fix and it is the one round
         two missed: round two only anti-joined the currently-due rung against
         waypoint_nudges, which catches a waypoint that has already been written
         to and misses every waypoint that never writes a row at all. A client
         who is opted out, escalated, cancelled, complete or has already replied
         is refused by blockersFor AFTER the LIMIT and deliverNudge writes
         nothing, so there is no row to anti-join against. Opt-out is the most
         common permanent stop in any messaging product; measured on a scratch
         Postgres on 2026-09-06, 200 opted-out clients starved a live one to
         zero messages on every pass.
      2. The rung anti-join from round two, kept.
      3. runNudges reports `budget_exhausted` and `not_reached`, so a full queue
         can never again read as a quiet day. Kept — it is how this was found. */
export const DEFAULT_LIMIT = 200;

/** idempotencyKeyFor — the stable name for one rung of one waypoint's ladder.

    Stable across replays, retries, duplicate webhooks and two schedulers,
    because it is built only from facts that do not move: the waypoint's id and
    the step number. No timestamp, no run id, no attempt counter — any of those
    would make a retry look like a new send, which is precisely how sixteen
    duplicate triggers became sixteen texts. */
export function idempotencyKeyFor(waypointId, step) {
  return `waypoint-nudge:${waypointId}:${step}`;
}

/* dueStepSql — the ladder's own thresholds, as a SQL CASE, DERIVED FROM STEPS.

   Written from ./ladder.mjs rather than typed out, so moving a rung's
   daysOverdue moves both the JavaScript and the SQL at once. Two hand-kept
   copies of a cadence is precisely the drift that produces a message nobody
   intended.

   `interval '<n> hours'` and not `interval '<n> days'`: an hour interval on a
   timestamptz is an exact duration, a day interval is calendar arithmetic that
   moves across a daylight-saving boundary. dueStep() in ladder.mjs compares
   milliseconds, so hours is the one that agrees with it.

   Highest reached rung wins, which is why the cases are emitted longest-overdue
   first — the same order dueStep() resolves in. */
const DUE_STEP_SQL = (() => {
  const cases = [...STEPS]
    .sort((a, b) => b.daysOverdue - a.daysOverdue)
    .map((s) => `WHEN w.due_at <= $1::timestamptz - interval '${s.daysOverdue * 24} hours' THEN ${s.step}`)
    .join("\n             ");
  return `CASE ${cases}\n             ELSE NULL END`;
})();

/* A SQL list literal from a JavaScript Set, so neither list is typed twice.
   Only ever called on the frozen constant Sets in ./exits.mjs — every member is
   a bare lowercase identifier from a CHECK constraint — but the quotes are
   doubled anyway so this cannot become an injection point if that changes. */
const sqlList = (set) => [...set].map((s) => `'${String(s).replace(/'/g, "''")}'`).join(", ");

/* ═════════════════════════════════════════════════════════════════════════
   PERMANENT STOPS, APPLIED BEFORE THE LIMIT — THE ROUND-THREE FIX
   ═════════════════════════════════════════════════════════════════════════

   THE DEFECT. blockersFor() is the gate, and it runs in JavaScript in
   deliverNudge — which is AFTER the LIMIT has already chosen which 200 rows
   this pass will look at. When it refuses, deliverNudge returns "skipped" and
   writes NOTHING. So the waypoint stays not_started, stays overdue, stays the
   oldest, sorts FIRST on the next pass, and holds a slot for ever. The sweeper
   calls runNudges with orgId = null, so those 200 slots are ONE BUDGET FOR THE
   WHOLE PLATFORM.

   Measured on a scratch Postgres 16.14 on 2026-09-06, in this worktree:

     200 clients whose programs are CANCELLED, plus one freshly overdue client
       pass 1: candidates 200, live included? false, queued 0, budget_exhausted
       true, messages to the live client 0 — and the same on the next day.

     200 clients who had texted STOP, plus one freshly overdue client
       identical: 200 candidates, live included? false, 0 messages, for ever.

   Round two added an anti-join on (waypoint_id, step) and a `budget_exhausted`
   warning. Neither touches this: the row never writes a waypoint_nudges row at
   all, so there is nothing to anti-join against, and making a silent failure
   loud is not making it stop.

   THE RULE. A WAYPOINT THAT CAN NO LONGER BE CHASED MUST NOT HOLD A SLOT.

   WHICH STOPS ARE PERMANENT AND WHICH ARE NOT. Every branch of blockersFor()
   is classified below. "Permanent" here means: while it is true, no amount of
   waiting makes this waypoint sendable, so leaving it in the queue can only
   starve somebody else. It does NOT mean irreversible — every clause is
   re-evaluated from scratch on every pass, so a client who opts back in, or a
   'blocked' row a member of staff unblocks, is a candidate again on the very
   next pass. Nothing here is a tombstone.

     PERMANENT — excluded below, before the LIMIT
       waypoint_missing         the row is gone; it cannot be selected at all
       owner_is_fundhub         owner_kind <> 'client'
       waypoint_complete        state done/skipped, or completed_at set
       waypoint_blocked         state outside CHASEABLE_STATES
       ladder_exhausted         a row at the final rung
       paid_alternative_bought  paid_service_requests in BOUGHT_STATUSES.
                                'refunded' LEFT that set on 2026-09-06 (round
                                four): a refund means the money went back, which
                                means we did NOT do it for them, and treating it
                                as a purchase bought their permanent silence
                                with money we had given back.
       client_replied           an inbound message after our first nudge on it
       opted_out                opt_outs, either channel, not opted back in
       escalation               a client_escalations row (368)
       program_complete         repair_programs.status
       program_cancelled        repair_programs.status

     BOUNDED — excluded while it is true, and it stops being true by itself
       payment_in_flight        a checkout link is out AND STILL LIVE. Seven
                                days from the mint, stamped on the row itself
                                (paid_service_requests.checkout_expires_at,
                                db/migrations/370).

                                THIS ONE WAS MISCLASSIFIED AS TEMPORARY AND IT
                                WAS THE ROUND-FOUR BLOCKER. The stated reason
                                was "a checkout link is out. It expires; then we
                                chase again." Nothing in this codebase ever
                                expired one — no expiry column existed, nothing
                                at mint set a deadline, and no file under
                                src/workflows/ so much as named the table. So
                                the hold was permanent while being filed as
                                temporary, and it held a slot for ever.
                                Reproduced here: 200 clients each holding an
                                awaiting_payment request minted 400 days ago,
                                plus one freshly overdue live client — 200
                                candidates, the live one not among them, zero
                                messages to them, that day and a year later.

                                Now it is excluded WHILE THE LINK IS LIVE, which
                                costs nothing (the gate would have refused it a
                                moment later anyway, so the slot was being spent
                                on a guaranteed refusal) and it comes straight
                                back into the queue the moment the stamp passes.
                                An expired one is chased again, exactly as the
                                original sentence promised.

     TEMPORARY — deliberately NOT excluded; these keep their place in the queue
       not_overdue              tomorrow it is due. It is the query's own
                                due_at filter, so it is not a candidate today
                                and holds no slot either way.
       check_failed             a database error. Transient by definition, and
                                excluding on "we could not tell" would turn one
                                bad query into a permanent silence.
       one-per-day / per-destination caps, and quiet hours — all in
                                deliverNudge, all true only for today, all of
                                them must still be reached tomorrow. The daily
                                cap no longer BURNS the budget, though: see
                                ONE WAYPOINT PER CLIENT PER PASS below.

   THIS IS NOT A SUBSTITUTE FOR THE GATE. Every clause below mirrors a branch of
   blockersFor() exactly, so a row it removes is a row the gate would have
   refused. deliverNudge still runs the whole gate against the live row before
   anything is written — see the "stale plan" proof in ./run.pg.test.mjs — and
   the test named "every waypoint the SQL removes is one the gate would have
   refused" in that file fails if these two ever disagree.

   ONE HONEST GAP. `escalation` is excluded by the presence of a
   client_escalations row, and that row is written by the detector the first
   time it runs for that client. A client who has threatened us but has never
   been scanned therefore still holds a slot for exactly one pass — the pass
   that scans them, refuses them, and writes the row. From the next pass on they
   are gone from the queue. Nothing is sent to them on that pass; the gate
   refuses it. */
const PERMANENT_STOPS_SQL = `
        /* ladder_exhausted — the final rung is spent, for good. */
        AND NOT EXISTS (
              SELECT 1 FROM waypoint_nudges nx
               WHERE nx.waypoint_id = d.id AND nx.step = ${FINAL_STEP}
            )
        /* paid_alternative_bought — they paid us to do this one. 'refunded' is
           NOT in BOUGHT_STATUSES: the money went back, so the task is theirs
           again and they must still be chased about it. */
        AND NOT EXISTS (
              SELECT 1 FROM paid_service_requests p
               WHERE p.waypoint_id = d.id
                 AND p.status IN (${sqlList(BOUGHT_STATUSES)})
            )
        /* payment_in_flight — an invitation to pay that is STILL LIVE. Bounded,
           not permanent: the row's own checkout_expires_at (370) ends it, and
           the waypoint is a candidate again on the first pass after that. The
           COALESCE fallback mirrors paymentHoldIsLive() in ./exits.mjs exactly,
           for a row written before 370 backfilled the column — the earliest the
           link could have died, never a later date, because guessing late is
           guessing toward silence. */
        AND NOT EXISTS (
              SELECT 1 FROM paid_service_requests p
               WHERE p.waypoint_id = d.id
                 AND p.status IN (${sqlList(PENDING_PAYMENT_STATUSES)})
                 AND COALESCE(
                       p.checkout_expires_at,
                       p.requested_at + interval '${CHECKOUT_LINK_TTL_DAYS * 24} hours'
                     ) > $1::timestamptz
            )
        /* client_replied — an inbound message after our first nudge ON THIS
           waypoint. min() is NULL when we have never nudged it, and
           "created_at >= NULL" is NULL, so a never-nudged row is never
           excluded here. That is the same scoping blockersFor uses. */
        AND NOT EXISTS (
              SELECT 1 FROM messages m
               WHERE m.client_id = d.client_id
                 AND m.direction = 'inbound'
                 AND m.created_at >= (
                       SELECT min(n2.created_at) FROM waypoint_nudges n2
                        WHERE n2.waypoint_id = d.id)
            )
        /* opted_out — the existing opt_outs table, the same predicate
           isOptedOut() uses. Either channel stops the whole ladder. */
        AND NOT EXISTS (
              SELECT 1 FROM opt_outs o
               WHERE o.client_id = d.client_id
                 AND o.channel IN ('sms', 'email')
                 AND o.opted_in_at IS NULL
            )
        /* escalation — a lawyer, a threat, a complaint about us (368). */
        AND NOT EXISTS (
              SELECT 1 FROM client_escalations e
               WHERE e.client_id = d.client_id
            )
        /* program_complete / program_cancelled. */
        AND NOT EXISTS (
              SELECT 1 FROM repair_programs rp
               WHERE rp.client_id = d.client_id
                 AND rp.status IN ('complete', 'cancelled')
            )`;

/* ═════════════════════════════════════════════════════════════════════════
   ONE WAYPOINT PER CLIENT PER PASS — THE DAILY CAP STOPS BURNING THE BUDGET
   ═════════════════════════════════════════════════════════════════════════

   THE DEFECT. The database allows ONE client-facing message per client per
   calendar day, across all of their waypoints (365's partial unique index). The
   pass did not know that: it took the 200 oldest due rows, and a client with
   eight overdue items contributed all eight. The first became their message and
   the other seven were refused as `daily_cap` — having each spent a slot. Being
   the oldest rows, they sorted first, so they did it again on the next hourly
   pass, and the one after.

   Measured by a reviewer, reproduced here on a scratch Postgres 16.14 on
   2026-09-06 — 25 clients with 8 overdue rows each, plus one live client:

     day 0: candidates 200, queued 25, 175 refused for daily_cap, the live
            client NOT in the plan, 0 messages to them
     day 1: identical. The live client waited two days.

   Effective throughput was 25 clients a day out of a budget of 200.

   THE FIX. DISTINCT ON (client_id), ordered oldest-first, so each client
   contributes exactly ONE candidate to a pass: their most overdue item. Nothing
   is lost — the other seven could not have produced a message today under the
   cap the database already enforces, and they are still there tomorrow. The
   rows they were displacing belong to clients who CAN be messaged.

   IT IS NOT A SECOND CAP. The cap is still 365's unique index and deliverNudge
   still discovers it the same way; this only stops the pass from spending its
   budget discovering it 175 times. */
const ONE_PER_CLIENT_SQL = `,
     picked AS (
       SELECT DISTINCT ON (e.client_id)
              e.id, e.org_id, e.client_id, e.key, e.title, e.detail, e.due_at, e.state, e.step
         FROM eligible e
        /* id breaks a tie so two rows due at the same instant resolve the same
           way on every pass, rather than by whatever order the plan returns. */
        ORDER BY e.client_id, e.due_at ASC, e.id ASC
     )`;

/* The `due` CTE. owner_kind, state and completed_at are the permanent stops
   that live on the waypoint row itself, so they belong here rather than in the
   outer WHERE — narrowing before the CASE is evaluated. */
const DUE_CTE_WHERE = `w.owner_kind = 'client'
          AND w.state IN (${sqlList(CHASEABLE_STATES)})
          AND w.completed_at IS NULL
          AND w.due_at IS NOT NULL`;

/**
 * planNudges — phase 1. The most overdue chaseable waypoint for each client:
 * its due rung is unspent, no permanent stop applies to it, and no live
 * checkout link is holding it.
 *
 * AT MOST ONE ROW PER CLIENT — see ONE_PER_CLIENT_SQL above. The database
 * already allows a client only one message a day, so a client's other overdue
 * rows could only ever have been refused; before this they were refused AFTER
 * spending a slot each.
 *
 * EVERY PERMANENT REFUSAL IS APPLIED INSIDE THE QUERY, BEFORE THE LIMIT, AND
 * THAT IS THE FIX. Filtering after the LIMIT moves the bug; filtering inside it
 * removes it. See PERMANENT_STOPS_SQL above for the full classification of
 * which of blockersFor()'s reasons are permanent and which are temporary, and
 * why a temporary one must keep its place in the queue.
 *
 * This is still a SUGGESTION and nothing more. Every candidate it returns is
 * put through the full exit gate again by deliverNudge before anything happens,
 * so a stale plan is safe by construction. The exclusions are an optimisation
 * of the queue, never a substitute for the gate.
 */
export async function planNudges(db, { orgId = null, now = new Date(), limit = DEFAULT_LIMIT } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const params = [at.toISOString()];
  let orgClause = "";
  if (orgId) {
    params.push(orgId);
    orgClause = ` AND w.org_id = $${params.length}`;
  }
  params.push(limit);

  /* owner_kind = 'client' is in the SQL, not in JavaScript, so a waypoint
     FundHub owes is never even a candidate. Chasing a client about our own work
     is the fastest way to lose them; ours slipping is a staff alert and belongs
     to a different piece of work entirely. */
  const { rows } = await db.query(
    `WITH due AS (
       SELECT w.id, w.org_id, w.client_id, w.key, w.title, w.detail, w.due_at, w.state,
              ${DUE_STEP_SQL} AS step
         FROM client_waypoints w
        WHERE ${DUE_CTE_WHERE}
          AND w.due_at <= $1::timestamptz${orgClause}
     ),
     eligible AS (
       SELECT d.id, d.org_id, d.client_id, d.key, d.title, d.detail, d.due_at, d.state, d.step
         FROM due d
        WHERE d.step IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM waypoint_nudges n
                 WHERE n.waypoint_id = d.id AND n.step = d.step
              )${PERMANENT_STOPS_SQL}
     )${ONE_PER_CLIENT_SQL}
     SELECT * FROM picked
      ORDER BY due_at ASC, id ASC
      LIMIT $${params.length}`,
    params
  );

  const candidates = [];
  for (const w of rows) {
    /* dueStep() is still the authority on which rung this is. The SQL computed
       the same number to do the anti-join; this recomputes it from the same
       ladder and takes the JavaScript answer, so the two can never silently
       disagree about which rung is being delivered. */
    const rung = dueStep(w.due_at, at);
    if (!rung) continue;
    candidates.push({
      waypointId: w.id,
      orgId: w.org_id,
      clientId: w.client_id,
      key: w.key,
      title: w.title,
      detail: w.detail,
      dueAt: w.due_at,
      step: rung.step,
      kind: rung.kind,
      channel: rung.channel,
      templateKey: rung.templateKey
    });
  }
  return candidates;
}

/**
 * countEligible — how many candidates the pass WOULD have had, with no budget.
 *
 * Only called when a pass fills its budget, and only so the tally can say how
 * many rows it could not reach. A silent full queue is what let the starvation
 * run: the tally read "considered 200 / queued 0 / skipped 200" and nothing in
 * it said the queue was full, so the pass looked like a quiet day.
 *
 * Returns null on any error rather than throwing. This is reporting; it must
 * never be the reason a sweep fails.
 */
export async function countEligible(db, { orgId = null, now = new Date() } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const params = [at.toISOString()];
  let orgClause = "";
  if (orgId) {
    params.push(orgId);
    orgClause = ` AND w.org_id = $${params.length}`;
  }
  try {
    const { rows } = await db.query(
      /* count(DISTINCT client_id), because the plan now takes at most one
         waypoint per client per pass. Counting ROWS here against a plan that
         counts CLIENTS would report `not_reached` for waypoints that were never
         going to be reached this pass and did not need to be — an invented
         backlog. */
      `WITH due AS (
         SELECT w.id, w.client_id, w.due_at, ${DUE_STEP_SQL} AS step
           FROM client_waypoints w
          WHERE ${DUE_CTE_WHERE}
            AND w.due_at <= $1::timestamptz${orgClause}
       )
       SELECT count(DISTINCT d.client_id)::int AS n
         FROM due d
        WHERE d.step IS NOT NULL
          AND NOT EXISTS (
                SELECT 1 FROM waypoint_nudges n
                 WHERE n.waypoint_id = d.id AND n.step = d.step
              )${PERMANENT_STOPS_SQL}`,
      params
    );
    return Number(rows[0]?.n ?? 0);
  } catch (err) {
    console.warn(`[nudge/run] eligible count failed: ${String(err?.message || err)}`);
    return null;
  }
}

/* claim — the one statement that is both the decision and the record.

   Returns the new row's id, or null when somebody else already owns this rung
   or the client's one message for the day is already spoken for. ON CONFLICT
   DO NOTHING absorbs BOTH unique constraints, which is why the caller has to
   ask afterwards which one it hit. */
async function claim(db, { orgId, clientId, waypointId, step, kind, channel, templateKey,
                           idempotencyKey, localDay, zone, outcome, detail, destination = null }) {
  const { rows } = await db.query(
    `INSERT INTO waypoint_nudges
       (org_id, client_id, waypoint_id, step, kind, channel, template_key,
        outcome, detail, idempotency_key, client_local_date, client_time_zone,
        destination_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::date,$12,$13)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [orgId, clientId, waypointId, step, kind, channel, templateKey,
     outcome, detail, idempotencyKey, localDay, zone, destination]
  );
  return rows[0]?.id || null;
}

/* whyClaimFailed — which of the three caps stopped us. Reporting only; the stop
   has already happened either way.

   `daily_cap_destination` is separate from `daily_cap` on purpose. They are
   different problems: one says this client already had their message today, the
   other says this PHONE already had one — a second client row on the same
   number. Folding them together would hide the duplicate-record case, which is
   the one nobody knows about until somebody gets two texts. */
async function whyClaimFailed(db, { waypointId, step, clientId, localDay, orgId, destination }) {
  const taken = (await db.query(
    `SELECT 1 FROM waypoint_nudges WHERE waypoint_id = $1 AND step = $2 LIMIT 1`,
    [waypointId, step]
  )).rows.length > 0;
  if (taken) return "already_sent";
  if (localDay) {
    const capped = (await db.query(
      `SELECT 1 FROM waypoint_nudges WHERE client_id = $1 AND client_local_date = $2::date LIMIT 1`,
      [clientId, localDay]
    )).rows.length > 0;
    if (capped) return "daily_cap";
    if (destination) {
      const destCapped = (await db.query(
        `SELECT 1 FROM waypoint_nudges
          WHERE org_id = $1 AND destination_key = $2 AND client_local_date = $3::date LIMIT 1`,
        [orgId, destination, localDay]
      )).rows.length > 0;
      if (destCapped) return "daily_cap_destination";
    }
  }
  return "claim_lost";
}

/**
 * deliverNudge — phases 2 to 4 for one candidate.
 *
 * Every return says `action` and, when nothing happened, `reasons`. "skipped"
 * is the normal, healthy outcome and by far the most common one.
 */
export async function deliverNudge(db, candidate, { now = new Date(), send = defaultSend } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const { waypointId } = candidate;
  const step = stepFor(candidate.step);
  if (!step) {
    /* Unreachable through planNudges, which only ever returns a rung from
       STEPS. Kept because the alternative to a guard here is a crash inside a
       sweep, and there is no fifth rung to fall through to. */
    return { waypointId, step: candidate.step, action: "skipped", reasons: ["unknown_step"] };
  }

  /* PHASE 2 — RE-DECIDE. Every exit condition, against the row as it is now.
     A waypoint completed since the plan was made dies here. */
  const blockers = await blockersFor(db, { waypointId, now: at });
  if (blockers.length) {
    return { waypointId, step: step.step, action: "skipped", reasons: blockers };
  }

  const client = (await db.query(
    `SELECT id, org_id, email, phone, dnd_sms, dnd_email, custom_fields
       FROM clients WHERE id = $1 LIMIT 1`,
    [candidate.clientId]
  )).rows[0];
  if (!client) {
    return { waypointId, step: step.step, action: "skipped", reasons: ["client_missing"] };
  }

  const idempotencyKey = idempotencyKeyFor(waypointId, step.step);

  /* ── STEP 4: A HUMAN, AND NO CLIENT MESSAGE ─────────────────────────────
     Not a louder text. The ladder ends with a person, and the row written here
     is what makes `ladder_exhausted` true forever afterwards. */
  if (step.kind === "staff_task") {
    const claimId = await claim(db, {
      orgId: candidate.orgId, clientId: candidate.clientId, waypointId,
      step: step.step, kind: "staff_task", channel: null, templateKey: null,
      idempotencyKey, localDay: null, zone: null, outcome: "claimed", detail: null
    });
    if (!claimId) {
      const why = await whyClaimFailed(db, { waypointId, step: step.step, clientId: candidate.clientId, localDay: null });
      return { waypointId, step: step.step, action: "skipped", reasons: [why] };
    }

    const task = await createTask(db, {
      orgId: candidate.orgId,
      clientId: candidate.clientId,
      title: `Client stalled: ${candidate.title}`,
      sourceWorkflow: SOURCE_WORKFLOW,
      assigneeRole: STAFF_TASK_ROLE,
      /* The dedupe key is the same idempotency key, so a replay finds the task
         it already made instead of making a second one. */
      body: idempotencyKey,
      eventId: idempotencyKey
    });

    await db.query(
      `UPDATE waypoint_nudges SET outcome = 'staff_task', task_id = $2, detail = $3 WHERE id = $1`,
      [claimId, task.id, task.created ? null : `task ${task.reason}`]
    );
    await recordEvent(db, { candidate, step, idempotencyKey, outcome: "staff_task" });
    return { waypointId, step: step.step, action: "staff_task", taskId: task.id };
  }

  // Blueprint eligibility is checked BEFORE claiming the rung. Draft agents
  // and later (not-current) steps must remain eligible for a future real turn.
  const coachEligible = await blueprintCoachNudgeEligibility(db, {
    orgId: candidate.orgId, clientId: candidate.clientId, channel: step.channel,
    templateKey: step.templateKey, context: { waypoint: { key: candidate.key || "" } }
  });
  if (!coachEligible.ok) return { waypointId, step: step.step, action: "skipped", reasons: [coachEligible.reason] };

  /* ── QUIET HOURS, IN THE CLIENT'S OWN ZONE ──────────────────────────────
     Nothing is claimed and nothing is written. The rung stays unspent and the
     next pass inside their daytime picks it up. A message held is a message
     that still goes out; a message queued at 3am is one somebody wakes up to. */
  const { zone, known } = zoneForClient(client);
  if (!isDaytime(at, zone)) {
    return {
      waypointId, step: step.step, action: "skipped",
      reasons: ["quiet_hours"], zone, zoneKnown: known
    };
  }

  /* ── EXIT 8, AS A SKIP RATHER THAN A STOP ───────────────────────────────
     No usable address for this channel. The rung is SPENT — a row is written
     with no local date, so it costs the client nothing from their one-per-day
     allowance and the ladder advances to the next rung on schedule instead of
     retrying an impossible SMS on every pass, forever. */
  const address = contactFor(client, step.channel);
  if (!address) {
    const claimId = await claim(db, {
      orgId: candidate.orgId, clientId: candidate.clientId, waypointId,
      step: step.step, kind: "client_message", channel: step.channel,
      templateKey: step.templateKey, idempotencyKey,
      localDay: null, zone, outcome: "no_contact",
      detail: `no usable ${step.channel} address`
    });
    if (!claimId) {
      const why = await whyClaimFailed(db, { waypointId, step: step.step, clientId: candidate.clientId, localDay: null });
      return { waypointId, step: step.step, action: "skipped", reasons: [why] };
    }
    await recordEvent(db, { candidate, step, idempotencyKey, outcome: "no_contact" });
    return { waypointId, step: step.step, action: "no_contact", channel: step.channel };
  }

  /* ── PHASE 3: CLAIM, WITH THE CLIENT'S OWN CALENDAR DAY ─────────────────
     This is where the two daily caps actually bite: one per client per day
     (365) and one per DESTINATION per day (369). The second exists because the
     first counts records — a person with two client rows on one phone was two
     records and got two texts. `destination` is the normalised address, so
     '+1 (555) 000-4000' and '+15550004000' are one key.

     THE OUTCOME WRITTEN HERE IS 'claimed', NOT 'queued', AND THAT IS THE POINT.
     Nothing has been queued yet — sendTemplated has not been called. The
     previous version wrote 'queued' here, so a pass that died between the claim
     and the send left a row that read exactly like a delivered nudge, and 365's
     own header said the opposite. A 'claimed' row still holds the client's day,
     because we do not know whether that message went out and the conservative
     answer to not knowing is not to send another one. */
  const localDay = localDate(at, zone);
  const destination = destinationKey(step.channel, address);
  if (!destination) {
    /* Unreachable today: destinationKey() and contactFor() apply the same floor
       — ten digits for a phone, the same shape test for an email — so an
       address that passed one passes the other. Kept as a REFUSAL rather than
       deleted, because the alternative if they ever diverge is a message queued
       against a destination the daily cap cannot see, which is the exact defect
       369 exists to close. Nothing is claimed, so the rung is not spent and the
       next pass tries again. */
    return {
      waypointId, step: step.step, action: "skipped",
      reasons: ["destination_unknown"], zone
    };
  }
  const claimId = await claim(db, {
    orgId: candidate.orgId, clientId: candidate.clientId, waypointId,
    step: step.step, kind: "client_message", channel: step.channel,
    templateKey: step.templateKey, idempotencyKey,
    localDay, zone, outcome: "claimed", detail: null, destination
  });
  if (!claimId) {
    const why = await whyClaimFailed(db, {
      waypointId, step: step.step, clientId: candidate.clientId, localDay,
      orgId: candidate.orgId, destination
    });
    return { waypointId, step: step.step, action: "skipped", reasons: [why], localDay, zone };
  }

  await recordEvent(db, { candidate, step, idempotencyKey, outcome: "claimed" });

  /* ── PHASE 4: QUEUE ─────────────────────────────────────────────────────
     sendTemplated writes one `messages` row with status='queued' and returns.
     `eventId` is the idempotency key, so its own provider_ref unique index
     (messages_org_providerref_uniq, migration 004) is a SECOND guard behind
     365's: even if the claim were somehow bypassed, the message row could not
     double. Two independent constraints, same key. */
  let result;
  try {
    result = await send(db, {
      orgId: candidate.orgId,
      clientId: candidate.clientId,
      channel: step.channel,
      templateKey: step.templateKey,
      eventId: idempotencyKey,
      /* So the message can name the actual thing rather than being a generic
         reminder. The title is the client's own checklist wording. */
      context: { waypoint: { title: candidate.title || "", key: candidate.key || "" } }
    });
  } catch (err) {
    result = { sent: false, reason: `error:${String(err?.message || err).slice(0, 120)}` };
  }

  if (result?.sent) {
    /* THE CLAIM RESOLVES HERE, and only here. Until this statement runs the row
       says 'claimed', which means "we do not know". A process that dies before
       this point leaves an honestly unresolved row rather than one that reads
       as a delivered message. It is still never retried — a step is spent
       once. */
    await db.query(
      `UPDATE waypoint_nudges SET outcome = 'queued', message_id = $2 WHERE id = $1`,
      [claimId, result.messageId || null]
    );
    return {
      waypointId, step: step.step, action: "queued",
      channel: step.channel, messageId: result.messageId || null, localDay, zone
    };
  }

  if (result?.retryable === true) {
    // The Blueprint adapter sets this only before any message INSERT/provider
    // call. Release this owner's unresolved claim so approval/step changes can
    // recover. A queued or concurrently resolved claim can never be deleted.
    await db.query(`DELETE FROM waypoint_nudges
      WHERE id = $1 AND outcome = 'claimed' AND message_id IS NULL`, [claimId]);
    return { waypointId, step: step.step, action: "skipped", channel: step.channel,
      reasons: [String(result.reason || "blueprint_not_ready")] };
  }

  /* NOTHING WAS QUEUED, SO THE DAY IS GIVEN BACK. The rung stays spent — a step
     is spent once — but client_local_date is cleared, because the cap exists to
     stop a client receiving three messages in a day and no message was sent.
     Holding their whole day hostage to a missing template would punish them for
     our gap. */
  const outcome = result?.reason === "template_pending" ? "template_pending" : "refused";
  await db.query(
    `UPDATE waypoint_nudges
        SET outcome = $2, client_local_date = NULL, detail = $3
      WHERE id = $1`,
    [claimId, outcome, String(result?.reason || "not_sent").slice(0, 200)]
  );
  return {
    waypointId, step: step.step, action: outcome,
    channel: step.channel, reasons: [String(result?.reason || "not_sent")]
  };
}

/* recordEvent — the audit half of the idempotency story.

   365's unique constraints are what actually stop a second send. This writes
   the same key to events(org_id, idempotency_key) as well, so an incident can
   be read off the event log — the place every other flow in this repo is read
   from — without joining a table nobody remembers exists.

   allowNonCanonical because the name is not in src/events/canonical.mjs and
   that file is not this lane's to edit; skipInngest because there is no
   function listening and a fan-out to nothing is latency for no one.

   Never throws. The claim is already committed by the time this runs, and a
   bus that is unavailable must not turn a queued message into a failed one —
   the same call sendTemplated makes about message.queued. */
async function recordEvent(db, { candidate, step, idempotencyKey, outcome }) {
  try {
    await emit(
      db,
      "waypoint.nudge.stepped",
      {
        waypoint_id: candidate.waypointId,
        step: step.step,
        kind: step.kind,
        channel: step.channel,
        template_key: step.templateKey,
        outcome
      },
      {
        orgId: candidate.orgId,
        clientId: candidate.clientId,
        idempotencyKey,
        allowNonCanonical: true,
        skipInngest: true
      }
    );
  } catch (err) {
    console.warn(`[nudge/run] event not recorded for ${idempotencyKey}: ${String(err?.message || err)}`);
  }
}

/**
 * runNudges — one whole pass. Plan, then deliver each candidate in turn.
 *
 * Never throws. A pass that fails must not take the scheduled function down
 * with it: the next pass is the recovery, and every waypoint it did not reach
 * is still overdue.
 *
 * Sequential on purpose. Two of these candidates may belong to the same client,
 * and the one-per-day cap has to see the first one's row before it decides the
 * second. Running them in parallel would not break the cap — the database
 * decides, not this loop — but it would make the reported reason a coin toss.
 */
export async function runNudges(db = defaultDb, { orgId = null, now = new Date(), limit = DEFAULT_LIMIT, send = defaultSend } = {}) {
  const at = now instanceof Date ? now : new Date(now);
  const tally = {
    at: at.toISOString(),
    considered: 0, queued: 0, staff_tasks: 0, skipped: 0,
    no_contact: 0, template_pending: 0, refused: 0, failed: 0,

    /* ── THE THREE NUMBERS THAT MAKE A BAD PASS UNREADABLE AS A GOOD ONE ──
       A starved queue used to report "considered 200 / queued 0 / skipped 200"
       and nothing in that says the budget was full, so the pass that reached no
       live client at all looked like a quiet day. */
    limit,
    /** true when the pass used every slot it had. */
    budget_exhausted: false,
    /** How many eligible rows the budget could NOT reach. 0 when the budget was
        not filled. NULL means the count itself failed — unknown, never zero
        (CLAUDE.md §12). */
    not_reached: 0,

    /* ── AND THE ONE THAT NAMES THE MISSING COPY ──
       An org created after db/seed/025 ran has none of the three nudge
       templates, so every rung resolves as template_pending. The COUNT was
       always reported; WHICH key is missing was not, so the fix was a hunt.
       Distinct template keys, in the order first seen. */
    template_pending_keys: [],

    results: []
  };

  let candidates;
  try {
    candidates = await planNudges(db, { orgId, now: at, limit });
  } catch (err) {
    tally.failed += 1;
    tally.error = String(err?.message || err).slice(0, 300);
    return tally;
  }
  tally.considered = candidates.length;

  if (candidates.length >= limit) {
    tally.budget_exhausted = true;
    const eligible = await countEligible(db, { orgId, now: at });
    tally.not_reached = eligible == null ? null : Math.max(0, eligible - candidates.length);
    console.warn(
      `[nudge/run] budget full: ${candidates.length} of ${limit} slots used, ` +
      `${tally.not_reached == null ? "an unknown number of" : tally.not_reached} eligible ` +
      `waypoint(s) not reached this pass`
    );
  }

  for (const candidate of candidates) {
    let res;
    try {
      res = await deliverNudge(db, candidate, { now: at, send });
    } catch (err) {
      tally.failed += 1;
      tally.results.push({
        waypointId: candidate.waypointId, step: candidate.step,
        action: "error", reasons: [String(err?.message || err).slice(0, 200)]
      });
      continue;
    }
    if (res.action === "queued") tally.queued += 1;
    else if (res.action === "staff_task") tally.staff_tasks += 1;
    else if (res.action === "no_contact") tally.no_contact += 1;
    else if (res.action === "template_pending") {
      tally.template_pending += 1;
      /* NAME THE MISSING COPY. Without this the tally says "one rung resolved
         as template_pending" and somebody has to go and find out which of the
         three keys the org is short of. */
      const key = candidate.templateKey;
      if (key && !tally.template_pending_keys.includes(key)) {
        tally.template_pending_keys.push(key);
      }
      console.warn(
        `[nudge/run] no approved template for ${key || "an unnamed key"} in org ` +
        `${candidate.orgId} — the rung is spent and nothing was queued`
      );
    } else if (res.action === "refused") tally.refused += 1;
    else tally.skipped += 1;
    tally.results.push(res);
  }
  return tally;
}

export { STEPS };
export default runNudges;
