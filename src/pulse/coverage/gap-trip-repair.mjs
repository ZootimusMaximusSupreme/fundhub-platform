// The credit-repair trip, start to end, for the morning pulse. Report only. Read only.
// Coverage batch 2026-10-10, workflow W8 "Whole trips" (level L4).
//
//   trip:repair   Did every customer who bought a repair plan in the last 60 days get every step
//                 the company owes in round 1, and what is the first step that is missing?
//
// THE LADDER (the brief's order). Who owes each step, and where its fact is read.
//
//    1 repair_purchase  client   an active sale in a repair product, or a paid repair payment link
//    2 enrolled         system   the repair program row (repair_programs; purchase-routing opens it)
//    3 documents_in     client   the ID was read and accepted (pii_identity.verified_legal_name)
//    4 letters_made     system   a round 1 dispute letter exists (dispute_letters)
//    5 letters_mailed   person   a round 1 letter was mailed (dispute_letters.mailed_at)
//    6 answer_read      client   a bureau answer was read and confirmed (dispute_responses.confirmed)
//    7 round_complete   system   the card reached Round Complete, or a later round has letters
//
// WHAT IS RED:
//   * enrolled is missing 1 hour after the purchase (the same hour the Funding card gets);
//   * letters_made is missing 1 hour after the LAST of the three things the letter engine needs
//     (an ID read, a credit file, a signed repair agreement or a live dispute authorization). That
//     is the engine's own clock, STAGE_SLA.analysis. Before all three exist the customer is waiting
//     on themselves, and nothing is red;
//   * round_complete is missing 15 minutes after the answer was confirmed;
//   * the file sits in a stage past the desk's own clock (src/repair/sla.mjs isBreached), or in
//     Stalled, which is the automation's "a person must move this" stage. The trip says WHICH step
//     the file is stuck at; the pipeline:repair and repair-case-stuck rows say the same thing from
//     the stage's side;
//   * a letter was made with no ID read, after 2026-09-06 (the day the letters were gated on a
//     verified name). Letters must carry the name off an ID, never a typed name.
//
// WHAT IS NEVER RED: a customer who has not sent the documents yet, a file waiting on the person
// who presses Send letters, a file waiting for the bureau's answer inside its clock.
//
// READ ONLY. One SELECT. ctx.db is a shared pool: never BEGIN, COMMIT, ROLLBACK or SET here. No web
// call, no text, no email, no letter mailed, no credit pull, no AI call. A failed read is a skip.

import { CONSENT_VALID_SQL } from "../../consent/index.mjs";
import { STAGE_SLA, isBreached } from "../../repair/sla.mjs";
import { LOOKBACK_MS } from "./gap-money-funding.mjs";
import { PAID_GRACE_MS, SETTLE_GRACE_MS } from "./gap-pipeline-facts.mjs";
import { INTERNAL_CLIENT_EMAIL_RE } from "./gap-portal.mjs";
import {
  clip, intOf, nowOf, readRows, runnerOf, skipWhy
} from "./money-reads.mjs";
import {
  BY, DAY_MS, HOUR_MS, NO_FIX, defaultOrg, judgeTrip, makeNaVerify, realClientSql, skipRow, whoIs,
  registerTripCount, sharedCount
} from "./trip-kit.mjs";

const ID = "trip:repair";
export const CHECK_IDS = Object.freeze([ID]);

export const TRIP_NAME = "repair";
export const WINDOW_MS = LOOKBACK_MS;
export const ROW_CAP = 200;

/** The letter engine's own clock: a file may sit in Analysis this long (src/repair/sla.mjs). */
export const LETTER_ENGINE_MS = STAGE_SLA.analysis.hours * HOUR_MS;
/** The day the repair letters were gated on a verified name (docs/journeys/repair-floor-flow.md, 2026-09-06). */
export const IDENTITY_GATE_FROM = "2026-09-06T00:00:00.000Z";
/** Where a round 1 file has finished its first round. */
export const ROUND_DONE_STAGES = Object.freeze(["round_complete", "program_complete"]);

export const STEPS = Object.freeze([
  Object.freeze({ key: "repair_purchase", label: "bought a repair plan", by: BY.CLIENT }),
  Object.freeze({
    key: "enrolled", label: "repair program opened", by: BY.SYSTEM,
    from: "repair_purchase", graceMs: PAID_GRACE_MS,
    source: "src/handlers/purchase-routing.mjs calls ensureRepairEnrollment on the payment event; wait = PAID_GRACE_MS"
  }),
  // required: the letters are gated on a name read off an ID (src/repair/analyze.mjs identity_not_verified).
  // A letter after IDENTITY_GATE_FROM with no ID read went around the gate.
  Object.freeze({ key: "documents_in", label: "ID read and accepted", by: BY.CLIENT, required: true }),
  Object.freeze({
    key: "letters_made", label: "round 1 letters made", by: BY.SYSTEM,
    from: "letters_ready", fromLabel: "the last of the ID read, the credit file and the signed agreement",
    graceMs: LETTER_ENGINE_MS,
    source: "the engine runs on repair.docs.complete (src/repair/handlers.mjs); wait = STAGE_SLA.analysis (1 hour)"
  }),
  Object.freeze({ key: "letters_mailed", label: "round 1 letters mailed", by: BY.PERSON }),
  Object.freeze({ key: "answer_read", label: "bureau answer read and confirmed", by: BY.CLIENT }),
  Object.freeze({
    key: "round_complete", label: "round 1 complete", by: BY.SYSTEM,
    from: "answer_read", graceMs: SETTLE_GRACE_MS,
    source: "confirmParse calls onRepairEvent(repair.response.parsed), which moves the card; wait = SETTLE_GRACE_MS"
  })
]);

/* The two facts that start the trip, written once so the full read and the light count read the same
   thing: a repair purchase (an active sale in a repair product, or a paid repair payment link) and the
   repair program row. */
const PU_LATERAL = `
    LEFT JOIN LATERAL (
      SELECT min(q.at) AS at
        FROM (
          SELECT s.sold_at AS at
            FROM sales s
            JOIN products pr ON pr.id = s.product_id
           WHERE s.org_id = $1::uuid AND s.client_id = t.id AND s.status = 'active'
             AND COALESCE(s.is_demo, false) = false AND pr.category = 'repair'
          UNION ALL
          SELECT COALESCE(pl.paid_at, pl.updated_at)
            FROM payment_links pl
           WHERE pl.org_id = $1::uuid AND pl.client_id = t.id AND pl.purpose = 'repair'
             AND (pl.status = 'paid' OR pl.paid_at IS NOT NULL)
             AND COALESCE(pl.is_demo, false) = false
        ) q
    ) pu ON true`;
const RP_LATERAL = `
    LEFT JOIN LATERAL (
      SELECT p.created_at, p.status
        FROM repair_programs p
       WHERE p.org_id = $1::uuid AND p.client_id = t.id
       ORDER BY p.created_at ASC
       LIMIT 1
    ) rp ON true`;

/**
 * One row per customer who started the trip in the window. $1 org, $2 window start, $3 test-client
 * pattern. Every fact is a time, or null.
 */
export const TRIP_SQL = `
  /* gap:trip-repair */
  SELECT t.id::text                 AS client_id,
         t.client_code              AS client_code,
         pu.at                      AS purchase_at,
         rp.created_at              AS enrolled_at,
         rp.status                  AS program_status,
         vi.at                      AS verified_at,
         cf.at                      AS credit_file_at,
         au.at                      AS authorized_at,
         lt.made_at                 AS letters_made_at,
         lt.mailed_at               AS letters_mailed_at,
         lt.later_round_at          AS later_round_at,
         ar.at                      AS answer_read_at,
         cd.stage                   AS card_stage,
         cd.entered_at              AS card_entered_at,
         cd.response_due_at         AS response_due_at
    FROM (
      SELECT c.id, c.client_code
        FROM clients c
       WHERE c.org_id = $1::uuid
         AND ${realClientSql("c", "$3")}
    ) t
${PU_LATERAL}
${RP_LATERAL}
    LEFT JOIN LATERAL (
      SELECT pi.verified_at AS at
        FROM pii_identity pi
       WHERE pi.org_id = $1::uuid AND pi.client_id = t.id
         AND pi.verified_legal_name IS NOT NULL AND btrim(pi.verified_legal_name) <> ''
       LIMIT 1
    ) vi ON true
    LEFT JOIN LATERAL (
      SELECT min(cr.created_at) AS at
        FROM crs_results cr
       WHERE cr.org_id = $1::uuid AND cr.client_id = t.id AND COALESCE(cr.is_demo, false) = false
    ) cf ON true
    LEFT JOIN LATERAL (
      SELECT min(q.at) AS at
        FROM (
          SELECT cc.granted_at AS at
            FROM client_consents cc
           WHERE cc.org_id = $1::uuid AND cc.client_id = t.id AND cc.kind = 'dispute_authorization'
             AND (${CONSENT_VALID_SQL})
          UNION ALL
          SELECT k.signed_at
            FROM contracts k
            LEFT JOIN contract_templates ct
              ON ct.org_id = k.org_id AND ct.template_key = k.template_key
           WHERE k.org_id = $1::uuid AND k.client_id = t.id AND k.status = 'signed'
             AND (ct.subtype = 'credit_repair' OR k.template_key ILIKE '%REPAIR%')
        ) q
    ) au ON true
    LEFT JOIN LATERAL (
      SELECT min(dl.created_at) FILTER (WHERE dl.round = 'R1')          AS made_at,
             min(dl.mailed_at)  FILTER (WHERE dl.round = 'R1')          AS mailed_at,
             min(dl.created_at) FILTER (WHERE dl.round NOT IN ('R1', 'FURNISHER')) AS later_round_at
        FROM dispute_letters dl
       WHERE dl.org_id = $1::uuid AND dl.client_id = t.id
    ) lt ON true
    LEFT JOIN LATERAL (
      SELECT min(q.at) AS at
        FROM (
          SELECT dr.confirmed_at AS at
            FROM dispute_responses dr
            JOIN dispute_cases dc ON dc.id = dr.case_id AND dc.org_id = dr.org_id
           WHERE dr.org_id = $1::uuid AND dr.client_id = t.id AND dr.confirmed = true
             AND dc.round = 'R1'
          UNION ALL
          SELECT l.created_at
            FROM repair_decision_log l
           WHERE l.org_id = $1::uuid AND l.client_id = t.id AND l.decision = 'parse.confirmed'
        ) q
    ) ar ON true
    LEFT JOIN LATERAL (
      SELECT ps.key AS stage, c2.entered_at,
             (SELECT min(dc2.response_due_at)
                FROM dispute_cases dc2
               WHERE dc2.org_id = c2.org_id AND dc2.client_id = c2.client_id
                 AND dc2.status NOT IN ('closed', 'cancelled')
                 AND dc2.response_due_at IS NOT NULL) AS response_due_at
        FROM cards c2
        JOIN pipelines p2 ON p2.id = c2.pipeline_id AND p2.org_id = c2.org_id AND p2.key = 'optimization'
        JOIN pipeline_stages ps ON ps.id = c2.stage_id AND ps.pipeline_id = p2.id
       WHERE c2.org_id = $1::uuid AND c2.client_id = t.id AND COALESCE(c2.is_demo, false) = false
       ORDER BY c2.updated_at DESC
       LIMIT 1
    ) cd ON true
   WHERE LEAST(pu.at, rp.created_at) >= $2::timestamptz
   ORDER BY LEAST(pu.at, rp.created_at) ASC
   LIMIT ${ROW_CAP}
`;

/** The light count behind the nothing-to-judge proof: only the two facts that start a trip. $1 org, $2 window start, $3 test-client pattern. */
export const COUNT_SQL = `
  /* gap:trip-repair-count */
  SELECT count(*)::int AS n
    FROM (
      SELECT c.id
        FROM clients c
       WHERE c.org_id = $1::uuid
         AND ${realClientSql("c", "$3")}
    ) t
${PU_LATERAL}
${RP_LATERAL}
   WHERE LEAST(pu.at, rp.created_at) >= $2::timestamptz
`;

/** "3 business days", "1 hour", "30 minutes", "5 days after the bureau's due date". */
export function clockText(sla) {
  if (!sla) return "its clock";
  if (sla.daysAfterDue != null) return `${sla.daysAfterDue} days after the bureau's due date`;
  if (sla.minutes) return `${sla.minutes} minutes`;
  if (sla.hours) return `${sla.hours} ${sla.hours === 1 ? "hour" : "hours"}`;
  if (sla.days) return `${sla.days} ${sla.businessDays ? "business days" : "days"}`;
  return "its clock";
}

const STAGE_WORDS = Object.freeze({
  intake: "Intake", awaiting_documents: "Awaiting Documents", analysis: "Analysis",
  letters_generated: "Letters Generated", ready_to_send: "Ready to Send", in_transit: "In Transit",
  awaiting_response: "Awaiting Response", response_received: "Response Received", stalled: "Stalled"
});

/** Pure. The file's stage clock, or null. Uses the desk's own isBreached. */
export function stageStall(r, now = new Date()) {
  const stage = r.card_stage == null ? null : String(r.card_stage);
  if (!stage) return null;
  if (stage === "stalled") {
    return { why: 'the file is in "Stalled": the automation failed and a person has not moved it' };
  }
  const sla = STAGE_SLA[stage];
  if (!sla) return null;
  const res = isBreached({
    stageKey: stage,
    enteredAt: r.card_entered_at || null,
    asOf: now,
    responseDueAt: r.response_due_at || null
  });
  if (!res.breached) return null;
  return { why: `the file has been in "${STAGE_WORDS[stage] || stage}" past its clock of ${clockText(sla)}` };
}

/** Pure. One SQL row to one trip row. */
export function toTripRow(r, now = new Date()) {
  const facts = {};
  const notOwed = [];
  const stage = r.card_stage == null ? null : String(r.card_stage);
  const t = (v) => (v ? new Date(v) : null);

  if (r.purchase_at) facts.repair_purchase = r.purchase_at;
  if (r.enrolled_at) facts.enrolled = r.enrolled_at;
  if (r.verified_at) facts.documents_in = r.verified_at;
  if (r.letters_made_at) facts.letters_made = r.letters_made_at;
  if (r.letters_mailed_at) facts.letters_mailed = r.letters_mailed_at;
  if (r.answer_read_at) facts.answer_read = r.answer_read_at;

  // Round 1 is complete when the card says so, or when the client has moved on to a later round.
  if (ROUND_DONE_STAGES.includes(stage) && r.card_entered_at) facts.round_complete = r.card_entered_at;
  else if (r.later_round_at) facts.round_complete = r.later_round_at;
  // A client on a later round has been through round 1: the steps behind them are done.
  if (r.later_round_at) {
    for (const [k, v] of Object.entries({
      letters_made: r.letters_made_at || r.later_round_at, letters_mailed: r.letters_mailed_at || r.later_round_at,
      answer_read: r.answer_read_at || r.later_round_at
    })) {
      if (!(k in facts)) facts[k] = v;
    }
  }

  // The anchor for the letter engine: the last of the three things it needs. All three or none.
  const gates = [r.verified_at, r.credit_file_at, r.authorized_at].map(t);
  if (gates.every(Boolean)) facts.letters_ready = new Date(Math.max(...gates.map((d) => d.getTime())));

  // Letters were gated on a verified name from 2026-09-06. Before that date the step did not exist,
  // so an older letter does not owe it. After it, a letter with no ID read is red (documents_in is required).
  const gate = new Date(IDENTITY_GATE_FROM).getTime();
  const firstLetter = [r.letters_made_at, r.letters_mailed_at, r.later_round_at].map(t).filter(Boolean)
    .reduce((a, d) => (a == null || d.getTime() < a ? d.getTime() : a), null);
  if (firstLetter != null && firstLetter < gate) notOwed.push("documents_in");

  let ended = null;
  if (stage === "cancelled") ended = { why: "the repair card is on Cancelled" };

  let stall = ended ? null : stageStall(r, now);
  // A file parked at the letter engine because the engine is missing something says what is missing.
  if (stall && !facts.letters_made && !facts.letters_ready) {
    const need = [];
    if (!r.verified_at) need.push("an ID read and accepted");
    if (!r.credit_file_at) need.push("a credit file on record");
    if (!r.authorized_at) need.push("a signed repair agreement or a live dispute authorization");
    if (need.length) stall = { ...stall, why: `${stall.why}. The letter engine is waiting on ${need.join(", ")}` };
  }
  return { who: whoIs(r), facts, notOwed: [...new Set(notOwed)], ended, stall };
}

/** Pure. The verdict for the rows the SELECT returned. */
export function judgeRepair({ rows = [], now = new Date(), orgId = null } = {}) {
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
      "Open the client on the Repair desk and read the step named. A missing program, letter or card move means the handler behind it did not run: " +
      "read failed_events and the repair workflow runs for that client. Do not mail from the pulse. " + NO_FIX
  });
}

export function tripParams(orgId, now) {
  return [orgId, new Date(now.getTime() - WINDOW_MS).toISOString(), INTERNAL_CLIENT_EMAIL_RE];
}

registerTripCount(ID, COUNT_SQL, (orgId, now) => tripParams(orgId, now));

async function startedCount(run, orgId, now, ctx = {}) {
  return sharedCount({
    run, key: ctx.scope || ctx.db, id: ID, orgId, now,
    own: async () => {
      const out = await run((tx) => tx.query(COUNT_SQL, tripParams(orgId, now)));
      return intOf(out && out.rows && out.rows[0] && out.rows[0].n);
    }
  });
}

export const naVerify = makeNaVerify({ id: ID, countStarted: startedCount, runnerOf, nowOf, defaultOrg });

/**
 * @param {{ db?: object, scope?: Function, orgId?: string, now?: Date }} [ctx]
 */
export async function gapChecks(ctx = {}) {
  const run = runnerOf(ctx);
  const orgId = ctx.orgId || null;
  const why = skipWhy({ run, orgId }, "the repair trips");
  if (why) return [skipRow(ID, why)];
  const now = nowOf(ctx);
  try {
    const got = await readRows(run, ID, "the repair trips", TRIP_SQL, tripParams(orgId, now));
    if (got.skip) return [got.skip];
    return [judgeRepair({ rows: got.rows, now, orgId })];
  } catch (err) {
    return [skipRow(ID, `could not judge the repair trips: ${clip(err)}`)];
  }
}
