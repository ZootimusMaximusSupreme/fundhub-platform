// ONE COPY (2026-10-20). This file used to be src/progress/escalations.mjs. It moved here whole, unchanged except its
// import paths, so the hourly beat client-progress runs the same progress read as GET /api/read/client-progress. A beat may import only from src/pulse/beats/lib.
// src/progress/escalations.mjs re-exports everything here, so every caller imports from there as before. Change it here.
//
// Rounds 4 and 5 — the two regulator complaints — in three states.
//
// OWNER-SET 2026-09-05. "A simple ping." Rounds 4 and 5 each carry exactly three
// states and no more:
//
//   prepared   we built the form
//   sent       it left us on this date, which the send path already knows
//   filed      the CLIENT told us they filed it, ideally with a case number
//
// SENT IS NOT FILED, AND THE DIFFERENCE IS THE WHOLE POINT OF THIS FILE.
//
// Round 4 is a CFPB complaint and Round 5 is a state attorney general complaint.
// What makes either one a FILING is the client's own signature on a declaration
// made under penalty of perjury (src/metro2/letters/catalog.mjs:57-65). Putting
// the envelope in the post is a thing this system can know and does record;
// whether the complaint was actually filed is a thing it cannot know unless
// somebody is told. So `sent` is read off the letter row and `filed` is read
// only off a report the client made, and the payload names who said so.
//
// ───────────────────────────────────────────────────────────────────────────
// `filed` IS ALWAYS false IN THE SHIPPED SYSTEM TODAY. NOTHING WRITES IT.
//
// The ping that lets a client say "I filed it" is wave 4 and is not in this
// branch. The field is in the shape now so the front-end lane can build the
// state it will need, and it is wired to a real read so that it starts
// answering the moment something writes the value — but as of this commit
// nothing in this repository writes it, and the endpoint therefore returns
// `filed: false` for every client that exists. That is stated in the branch's
// contractDeviations and it was verified by grep, not assumed.
//
// WHERE `filed` IS READ FROM. `clients.custom_fields.escalation_filings`, which
// is this repository's existing extension point for exactly this kind of field —
// `cf_funding_advisor_user_id` and `referral_affiliate_id` are read the same way
// by api/read/portal-summary.mjs and by src/progress/read.mjs. No migration, no
// new table, and nothing for wave 4 to unpick if it chooses a real column
// instead: it changes one function in this file.
//
//   custom_fields.escalation_filings = {
//     "R4": { "filedAt": "2026-04-01T00:00:00Z", "reportedBy": "client",
//             "caseNumber": "250401-1234567" }
//   }
//
// ───────────────────────────────────────────────────────────────────────────
// A ROUND WITH NO LETTER ROW IS NOT IN THE LIST AT ALL.
//
// Not "prepared: false", not a placeholder. A client who has never reached R4
// has no R4 entry, which is a different thing from a client whose R4 complaint
// was built and not yet posted. The screen can tell those two apart.

import {
  COMPLAINT_ROUND_TARGET, FILED_STATUSES, complaintTargetForRound
} from "./complaint-targets.mjs";

/** The two rungs that carry a regulator complaint. Mirrors COMPLAINT_ROUND_TARGET. */
export const ESCALATION_ROUNDS = Object.freeze(Object.keys(COMPLAINT_ROUND_TARGET));

/** The three states, in the order a round moves through them. */
export const ESCALATION_STATES = Object.freeze(["prepared", "sent", "filed"]);

const SENT_STATUSES = new Set(FILED_STATUSES);

/**
 * Every R4/R5 complaint letter row for one client. Prepared AND sent, because
 * "prepared" is a state this page has to show and loadComplaintFilings() only
 * returns the ones already in the post.
 */
export const ESCALATION_LETTERS_SQL = `
  SELECT round, target, status, mailed_at, created_at
    FROM dispute_letters
   WHERE client_id = $1::uuid AND org_id = $2::uuid
     AND target = ANY($3)
     AND round  = ANY($4)
   ORDER BY created_at ASC`;

/**
 * The client's own report that they filed a complaint, or null.
 *
 * Returns null — not false, not a guess — when nothing has been reported. Null
 * means unknown and it must survive: "we have not heard" is not "they did not
 * file".
 */
export function clientReportedFiling(customFields, round) {
  const bag = customFields && typeof customFields === "object"
    ? customFields.escalation_filings : null;
  if (!bag || typeof bag !== "object") return null;
  const hit = bag[String(round || "").trim().toUpperCase()];
  if (!hit || typeof hit !== "object") return null;
  const filedAt = isoOrNull(hit.filedAt || hit.filed_at);
  if (!filedAt) return null;
  /* WHO SAID SO, on the payload, because the page has to be able to show it.
     Defaults to "client" because that is the only party the ping can come from;
     a value stored by staff on the client's behalf says so instead. */
  const by = String(hit.reportedBy || hit.reported_by || "client").trim() || "client";
  const num = hit.caseNumber == null && hit.case_number == null
    ? null
    : String(hit.caseNumber != null ? hit.caseNumber : hit.case_number).trim() || null;
  return { filedAt, reportedBy: by, caseNumber: num };
}

/**
 * One entry per escalation round that has a letter row, newest rung last.
 *
 * @param {object[]} letterRows rows from ESCALATION_LETTERS_SQL
 * @param {object|null} customFields the client's custom_fields
 */
export function escalationStates(letterRows = [], customFields = null) {
  const out = [];
  for (const round of ESCALATION_ROUNDS) {
    const target = COMPLAINT_ROUND_TARGET[round];
    /* A row whose round and target disagree is a corrupt record. It is dropped
       rather than trusted, the same call loadComplaintFilings() makes. */
    const rows = (Array.isArray(letterRows) ? letterRows : []).filter(
      (r) => String(r?.round || "").trim().toUpperCase() === round
        && complaintTargetForRound(round) === String(r?.target || "").trim().toLowerCase()
    );
    if (!rows.length) continue;

    const preparedAt = earliest(rows.map((r) => r.created_at));

    const sentRows = rows.filter(
      (r) => r.mailed_at != null || SENT_STATUSES.has(String(r.status || "").trim().toLowerCase())
    );
    /* SENT WITH NO DATE IS STILL SENT. recordComplaintFiling() writes
       status 'sent' and does not write mailed_at, so the common case is a row we
       know left us on a day we did not record. The state says sent; the date
       stays null, because null means unknown and a created_at would be a
       different fact wearing the right label. */
    const sentAt = sentRows.length ? earliest(sentRows.map((r) => r.mailed_at)) : null;

    const reported = clientReportedFiling(customFields, round);

    let state = "prepared";
    if (sentRows.length) state = "sent";
    if (reported) state = "filed";

    out.push({
      round: Number(round.slice(1)),
      target,
      state,
      preparedAt,
      sentAt,
      filed: !!reported,
      filedAt: reported ? reported.filedAt : null,
      filedReportedBy: reported ? reported.reportedBy : null,
      caseNumber: reported ? reported.caseNumber : null
    });
  }
  return out;
}

function earliest(values) {
  const times = (values || [])
    .map((v) => (v == null ? null : new Date(v)))
    .filter((d) => d && Number.isFinite(d.getTime()));
  if (!times.length) return null;
  return new Date(Math.min(...times.map((d) => d.getTime()))).toISOString();
}

function isoOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
