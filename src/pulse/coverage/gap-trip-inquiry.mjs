// The inquiry-removal trip, start to end, for the morning pulse. Report only. Read only.
// Coverage batch 2026-10-10, workflow W8 "Whole trips" (level L4).
//
//   trip:inquiry   Did every customer who went through the inquiry gate in the last 60 days get
//                  every step the company owes, and what is the first step that is missing?
//
// THE LADDER (the brief's order).
//
//    1 gate           system   the inquiry gate ran (a deposit.paid event is followed by a case, a
//                              gate.raised or a gate.clear event: src/handlers/inquiry-gate.mjs)
//    2 cases          system   one case per bureau the gate raised (inquiry_removal_cases)
//    3 letters        system   a draft letter on every gate case that has open inquiries
//    4 calls          person   the bureau call fired (call_fired_at)
//    5 removed        person   every case is Completed (Canceled cases are left out)
//    6 event_fired    system   inquiry.removed was fired on the bus (C-03 listens for it)
//    7 funding_resumes system  funding is ready for the next round (ready_for_next_round, set by C-03)
//
// WHAT IS RED:
//   * a deposit was paid and 15 minutes later the gate left no case and no event;
//   * the gate said it raised a bureau and that bureau has no case;
//   * a gate case with open inquiries has no draft letter (15 minutes after the case);
//   * a case sits past the clocks gap-inquiry.mjs already uses: Escalated or idle for 72 hours, or a
//     call came due and the sweeper (3 runs of its 15 minute clock) did not fire it;
//   * every case is Completed and no inquiry.removed event followed (15 minutes);
//   * inquiry.removed fired, the client bought funding, and funding was not marked ready (15 minutes).
//
// WHAT IS NEVER RED: a case waiting on the bureau, a case waiting for a person to schedule its call,
// a customer with a fraud alert on file (C-03 holds funding on purpose and a person clears it), a
// customer who did not buy funding (C-03 only marks "inquiry done" for them).
//
// READ ONLY. One SELECT. ctx.db is a shared pool: never BEGIN, COMMIT, ROLLBACK or SET here. No web
// call, no text, no email, no call to a bureau, no AI call. A failed read is a skip with the reason.

import {
  CALL_DUE_STATUSES, CALL_GRACE_MS, GATE_SOURCE, LETTER_STATUSES, STUCK_AFTER_MS
} from "./gap-inquiry.mjs";
import { LOOKBACK_MS } from "./gap-money-funding.mjs";
import { SETTLE_GRACE_MS } from "./gap-pipeline-facts.mjs";
import { INTERNAL_CLIENT_EMAIL_RE } from "./gap-portal.mjs";
import {
  clip, intOf, nowOf, readRows, runnerOf, skipWhy
} from "./money-reads.mjs";
import {
  BY, DAY_MS, NO_FIX, defaultOrg, judgeTrip, makeNaVerify, realClientSql, skipRow, whoIs
} from "./trip-kit.mjs";

const ID = "trip:inquiry";
export const CHECK_IDS = Object.freeze([ID]);

export const TRIP_NAME = "inquiry removal";
export const WINDOW_MS = LOOKBACK_MS;
export const ROW_CAP = 200;

export const STEPS = Object.freeze([
  Object.freeze({
    key: "gate", label: "inquiry gate ran", by: BY.SYSTEM,
    from: "deposit_event", fromLabel: "the deposit payment", graceMs: SETTLE_GRACE_MS,
    source: "deposit.paid starts onDepositPaidGate on the bus; wait = SETTLE_GRACE_MS"
  }),
  Object.freeze({
    key: "cases", label: "one case per bureau", by: BY.SYSTEM,
    from: "gate", graceMs: SETTLE_GRACE_MS,
    source: "upsertBureauCase writes every case in the same call as the gate; wait = SETTLE_GRACE_MS"
  }),
  Object.freeze({
    key: "letters", label: "draft letter on each case", by: BY.SYSTEM,
    from: "cases", graceMs: SETTLE_GRACE_MS,
    source: "upsertBureauCase writes letter_draft_html with the case; wait = SETTLE_GRACE_MS"
  }),
  Object.freeze({ key: "calls", label: "bureau call fired", by: BY.PERSON }),
  Object.freeze({ key: "removed", label: "every case completed", by: BY.PERSON }),
  Object.freeze({
    key: "event_fired", label: "inquiry.removed fired", by: BY.SYSTEM,
    from: "removed", graceMs: SETTLE_GRACE_MS,
    source: "the closing handler emits it with the case change (api/inquiry-cases.mjs); wait = SETTLE_GRACE_MS"
  }),
  Object.freeze({
    key: "funding_resumes", label: "funding ready for the next round", by: BY.SYSTEM,
    from: "event_fired", graceMs: SETTLE_GRACE_MS,
    source: "C-03 sets ready_for_next_round on inquiry.removed (src/workflows/c-03-...); wait = SETTLE_GRACE_MS"
  })
]);

/* The facts that decide who is on the trip, written once so the full read and the light count read the
   same thing: the newest deposit event, and the round of the client's newest case. */
const DP_LATERAL = `
    LEFT JOIN LATERAL (
      SELECT max(e.created_at) AS at
        FROM events e
       WHERE e.org_id = $1::uuid AND e.client_id = t.id AND e.name = 'deposit.paid'
         AND COALESCE(e.is_demo, false) = false
    ) dp ON true`;
const LP_LATERAL = `
    LEFT JOIN LATERAL (
      SELECT irc.funding_round_id AS round_id
        FROM inquiry_removal_cases irc
       WHERE irc.org_id = $1::uuid AND irc.client_id = t.id AND COALESCE(irc.is_demo, false) = false
       ORDER BY irc.created_at DESC
       LIMIT 1
    ) lp ON true`;

/**
 * One row per customer who went through the gate in the window (a case, or a deposit event). $1 org,
 * $2 window start, $3 test-client pattern, $4 the gate's request_source, $5 the statuses that owe a
 * letter, $6 the idle cut (now - 72 hours), $7 the statuses a call may be due in, $8 the call cut
 * (now - the sweeper's 3 runs).
 */
export const TRIP_SQL = `
  /* gap:trip-inquiry */
  SELECT t.id::text                    AS client_id,
         t.client_code                 AS client_code,
         dp.at                         AS deposit_event_at,
         gr.at                         AS gate_raised_at,
         gr.bureaus                    AS raised_bureaus,
         gc.at                         AS gate_clear_at,
         pass.started_at               AS started_at,
         pass.cases_n                  AS cases_n,
         pass.completed_n              AS completed_n,
         pass.completed_at             AS completed_at,
         pass.bureaus                  AS case_bureaus,
         pass.letters_owed_n           AS letters_owed_n,
         pass.letters_missing_n        AS letters_missing_n,
         pass.calls_fired_n            AS calls_fired_n,
         pass.stuck_idle_n             AS stuck_idle_n,
         pass.stuck_call_n             AS stuck_call_n,
         rm.at                         AS removed_event_at,
         (t.custom_fields ->> 'product_path')                    AS product_path,
         COALESCE(t.custom_fields ->> 'ready_for_next_round', '') = 'true' AS ready_for_next_round,
         (t.custom_fields ->> 'round_hold_reason')               AS hold_reason,
         ('fraud:alert-present' = ANY(COALESCE(t.tags, '{}'::text[]))) AS fraud_alert
    FROM (
      SELECT c.id, c.client_code, c.tags, c.custom_fields
        FROM clients c
       WHERE c.org_id = $1::uuid
         AND ${realClientSql("c", "$3")}
    ) t
${DP_LATERAL}
    LEFT JOIN LATERAL (
      SELECT e.created_at AS at,
             ARRAY(SELECT jsonb_array_elements_text(
                     CASE WHEN jsonb_typeof(e.payload -> 'bureaus') = 'array'
                          THEN e.payload -> 'bureaus' ELSE '[]'::jsonb END)) AS bureaus
        FROM events e
       WHERE e.org_id = $1::uuid AND e.client_id = t.id AND e.name = 'inquiry.gate.raised'
         AND COALESCE(e.is_demo, false) = false
       ORDER BY e.created_at DESC
       LIMIT 1
    ) gr ON true
    LEFT JOIN LATERAL (
      SELECT max(e.created_at) AS at
        FROM events e
       WHERE e.org_id = $1::uuid AND e.client_id = t.id AND e.name = 'inquiry.gate.clear'
         AND COALESCE(e.is_demo, false) = false
    ) gc ON true
${LP_LATERAL}
    LEFT JOIN LATERAL (
      SELECT min(irc.created_at)                                                         AS started_at,
             count(*) FILTER (WHERE irc.case_status::text <> 'Canceled')::int            AS cases_n,
             count(*) FILTER (WHERE irc.case_status::text = 'Completed')::int            AS completed_n,
             max(COALESCE(irc.completed_at, irc.cleared_at, irc.closed_at, irc.updated_at))
               FILTER (WHERE irc.case_status::text = 'Completed')                        AS completed_at,
             array_agg(DISTINCT irc.selected_bureaus_raw)
               FILTER (WHERE irc.case_status::text <> 'Canceled'
                         AND irc.selected_bureaus_raw IS NOT NULL)                       AS bureaus,
             count(*) FILTER (
               WHERE irc.request_source = $4::text AND irc.open_inquiry_count > 0
                 AND irc.case_status::text = ANY($5::text[]))::int                       AS letters_owed_n,
             count(*) FILTER (
               WHERE irc.request_source = $4::text AND irc.open_inquiry_count > 0
                 AND irc.case_status::text = ANY($5::text[])
                 AND irc.letter_provider_id IS NULL AND irc.draft_letter_document_id IS NULL
                 AND (irc.letter_draft_html IS NULL OR btrim(irc.letter_draft_html) = ''))::int AS letters_missing_n,
             count(*) FILTER (WHERE irc.call_fired_at IS NOT NULL)::int                  AS calls_fired_n,
             count(*) FILTER (
               WHERE irc.closed_at IS NULL
                 AND ((irc.case_status::text = 'Escalated' AND irc.updated_at < $6::timestamptz)
                   OR (irc.case_status::text = ANY($7::text[])
                       AND irc.call_due_at IS NULL AND irc.call_fired_at IS NULL
                       AND irc.updated_at < $6::timestamptz)))::int                      AS stuck_idle_n,
             count(*) FILTER (
               WHERE irc.closed_at IS NULL AND irc.case_status::text = ANY($7::text[])
                 AND irc.call_due_at IS NOT NULL AND irc.call_due_at <= $8::timestamptz
                 AND irc.call_fired_at IS NULL)::int                                     AS stuck_call_n
        FROM inquiry_removal_cases irc
       WHERE irc.org_id = $1::uuid AND irc.client_id = t.id AND COALESCE(irc.is_demo, false) = false
         AND irc.funding_round_id IS NOT DISTINCT FROM lp.round_id
    ) pass ON true
    LEFT JOIN LATERAL (
      SELECT max(e.created_at) AS at
        FROM events e
       WHERE e.org_id = $1::uuid AND e.client_id = t.id AND e.name = 'inquiry.removed'
         AND COALESCE(e.is_demo, false) = false
    ) rm ON true
   WHERE COALESCE(pass.started_at, dp.at) >= $2::timestamptz
     AND (pass.started_at IS NOT NULL OR dp.at IS NOT NULL)
   ORDER BY LEAST(pass.started_at, dp.at) ASC
   LIMIT ${ROW_CAP}
`;

/**
 * The light count behind the nothing-to-judge proof: a customer is on the trip when the newest pass of
 * cases started in the window, or a deposit event did. $1 org, $2 window start, $3 test-client pattern.
 */
export const COUNT_SQL = `
  /* gap:trip-inquiry-count */
  SELECT count(*)::int AS n
    FROM (
      SELECT c.id
        FROM clients c
       WHERE c.org_id = $1::uuid
         AND ${realClientSql("c", "$3")}
    ) t
${DP_LATERAL}
${LP_LATERAL}
    LEFT JOIN LATERAL (
      SELECT min(irc.created_at) AS started_at
        FROM inquiry_removal_cases irc
       WHERE irc.org_id = $1::uuid AND irc.client_id = t.id AND COALESCE(irc.is_demo, false) = false
         AND irc.funding_round_id IS NOT DISTINCT FROM lp.round_id
    ) pass ON true
   WHERE COALESCE(pass.started_at, dp.at) >= $2::timestamptz
     AND (pass.started_at IS NOT NULL OR dp.at IS NOT NULL)
`;

function asList(v) {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.startsWith("{") && v.endsWith("}")) {
    return v.slice(1, -1).split(",").map((x) => x.replace(/^"|"$/g, "")).filter(Boolean);
  }
  return [];
}

/** Pure. One SQL row to one trip row. */
export function toTripRow(r, now = new Date()) {
  const facts = {};
  const notOwed = [];
  const T = (v) => (v ? new Date(v) : null);
  const casesN = intOf(r.cases_n);
  const completedN = intOf(r.completed_n);
  const started = r.started_at || null;
  const clear = r.gate_clear_at || null;

  if (r.deposit_event_at) facts.deposit_event = r.deposit_event_at;

  // 1. the gate ran: a case exists, or the gate said "raised" or "clear".
  const gateAt = started || r.gate_raised_at || clear;
  if (gateAt) facts.gate = gateAt;

  // The gate found nothing to remove: no cases are owed, and the trip is over for the right reason.
  const clearOnly = !!clear && casesN === 0 && !r.gate_raised_at;
  let ended = null;
  if (clearOnly) ended = { why: "the gate found no inquiries to remove" };

  // 2. one case per bureau the gate raised.
  const raised = asList(r.raised_bureaus);
  const cased = new Set(asList(r.case_bureaus));
  const uncovered = raised.filter((b) => !cased.has(b));
  if (casesN > 0 && uncovered.length === 0) facts.cases = started;
  const casesWhy = uncovered.length && casesN > 0
    ? `the gate raised ${raised.join(", ")} and ${uncovered.join(", ")} has no case`
    : null;

  // 3. a draft letter on each gate case that has open inquiries. A case from the bureau's own
  //    webhook is not a gate case and owes none.
  if (intOf(r.letters_owed_n) === 0) notOwed.push("letters");
  else if (intOf(r.letters_missing_n) === 0 && casesN > 0) facts.letters = started;

  // 4 and 5. the call and the removal.
  if (intOf(r.calls_fired_n) > 0) facts.calls = started;
  if (casesN > 0 && completedN === casesN) facts.removed = r.completed_at || started;

  // 6. inquiry.removed fired after the cases were removed.
  const removedAt = T(r.removed_event_at);
  const startAt = T(started);
  if (removedAt && (!startAt || removedAt.getTime() >= startAt.getTime())) facts.event_fired = r.removed_event_at;

  // 7. funding resumes. Only a customer who bought funding owes it, and a fraud alert holds it on purpose.
  const fundingPath = String(r.product_path || "") === "Funding";
  if (!fundingPath) notOwed.push("funding_resumes");
  if (r.fraud_alert === true) {
    ended = ended || { why: "a fraud alert is on file, so funding is held on purpose until a person clears it" };
  }
  if (r.ready_for_next_round === true && facts.event_fired) facts.funding_resumes = r.removed_event_at;

  // The clocks the code already defines for a case that is stuck (gap-inquiry.mjs STUCK_SQL).
  let stall = null;
  const idle = intOf(r.stuck_idle_n);
  const callLate = intOf(r.stuck_call_n);
  if (callLate > 0) {
    stall = {
      why: `${callLate === 1 ? "a call" : `${callLate} calls`} came due and the call sweeper did not fire ${callLate === 1 ? "it" : "them"} within its 3 runs`
    };
  } else if (idle > 0) {
    stall = {
      why: `${idle === 1 ? "a case has" : `${idle} cases have`} been Escalated or waiting with no call scheduled and no update for 72 hours`
    };
  }
  const detail = {};
  if (casesWhy) detail.cases = casesWhy;
  if (intOf(r.letters_missing_n) > 0) {
    detail.letters = `${intOf(r.letters_missing_n)} of ${intOf(r.letters_owed_n)} gate cases with open inquiries have no draft letter`;
  }

  return { who: whoIs(r), facts, notOwed: [...new Set(notOwed)], ended, stall, detail };
}

/** Pure. The verdict for the rows the SELECT returned. */
export function judgeInquiry({ rows = [], now = new Date(), orgId = null } = {}) {
  return judgeTrip({
    id: ID,
    orgId,
    tripName: TRIP_NAME,
    steps: STEPS,
    rows: rows.map((r) => toTripRow(r, now)),
    now,
    windowDays: Math.round(WINDOW_MS / DAY_MS),
    cap: ROW_CAP,
    fix:
      "Open the client on the Specialist desk and read the step named. A missing case, letter or event means the gate or the closing handler did not finish: " +
      "read failed_events for inquiry.removed and the deposit event. Do not call a bureau from the pulse. " + NO_FIX
  });
}

export function tripParams(orgId, now) {
  return [
    orgId,
    new Date(now.getTime() - WINDOW_MS).toISOString(),
    INTERNAL_CLIENT_EMAIL_RE,
    GATE_SOURCE,
    LETTER_STATUSES,
    new Date(now.getTime() - STUCK_AFTER_MS).toISOString(),
    CALL_DUE_STATUSES,
    new Date(now.getTime() - CALL_GRACE_MS).toISOString()
  ];
}

async function startedCount(run, orgId, now) {
  const p = tripParams(orgId, now);
  const out = await run((tx) => tx.query(COUNT_SQL, [p[0], p[1], p[2]]));
  return intOf(out && out.rows && out.rows[0] && out.rows[0].n);
}

export const naVerify = makeNaVerify({ id: ID, countStarted: startedCount, runnerOf, nowOf, defaultOrg });

/**
 * @param {{ db?: object, scope?: Function, orgId?: string, now?: Date }} [ctx]
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const orgId = ctx.orgId || null;
  const why = skipWhy({ run, orgId }, "the inquiry trips");
  if (why) return [skipRow(ID, why)];
  const now = nowOf(ctx);
  try {
    const got = await readRows(run, ID, "the inquiry trips", TRIP_SQL, tripParams(orgId, now));
    if (got.skip) return [got.skip];
    return [judgeInquiry({ rows: got.rows, now, orgId })];
  } catch (err) {
    return [skipRow(ID, `could not judge the inquiry trips: ${clip(err)}`)];
  }
}
