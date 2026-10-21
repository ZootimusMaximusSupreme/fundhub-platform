// The client-facing progress timeline, and the one thing it may never say.
//
// ═══════════════════════════════════════════════════════════════════════════
// R4 AND R5 MUST NEVER APPEAR AS FILED
//
// Round 4 is the CFPB complaint and Round 5 is the state attorney general
// complaint. Whoever puts them in the post, the thing that makes them a FILING
// is the client's own hand-signed declaration under penalty of perjury, and
// nothing in this repository ever hears that it happened
// (src/metro2/letters/catalog.mjs:57-65 states this outright). So a line reading
// "CFPB complaint filed" would be this system asserting, on a screen the client
// reads, a fact it does not have and cannot get.
//
// ───────────────────────────────────────────────────────────────────────────
// WHY THIS IS AN ALLOWLIST AND NOT A FILTER
//
// The first version of this file was a DENYLIST: render whatever machine name
// somebody stored, then rewrite the line if it matched a regulator word AND a
// submission verb. It did not hold. The verb list omitted the bare verbs
// "sent", "mailed", "delivered" and "posted", and "mailed" is this repository's
// own live decision vocabulary — so "cfpb complaint mailed" went straight to a
// client's screen untouched. A denylist can never be finished, because the
// thing it has to catch is a string nobody has written yet.
//
// So the shape is inverted. This module does not filter a rendered line; it
// CHOOSES the line. A decision name is looked up in TIMELINE_WORDS below and the
// words that come back are the only words emitted. A decision name that is not
// in the map — including every decision name that will be invented after this
// file is written — renders as NEUTRAL_WORDS and carries no claim at all.
//
// Two layers, because the map itself can also be edited badly:
//
//   1. STRUCTURAL. Only a value from TIMELINE_WORDS is ever rendered. A new
//      decision string cannot leak a phrase by not being on a list, because not
//      being on the list is what makes it neutral.
//   2. THE MAP IS SCRUBBED AT LOAD. Every phrase is put through claimsFiled()
//      when this module is imported and any phrase that asserts a regulator
//      filing is DROPPED, so it renders as neutral too. Adding
//      "cfpb complaint filed" to the map below does not ship it.
//
// timeline.test.mjs fails if either layer stops.
//
// ───────────────────────────────────────────────────────────────────────────
// WHAT THE TIMELINE DOES NOT CARRY
//
// The timeline says nothing about a regulator complaint in either direction —
// not prepared, not sent, not filed. `repair_decision_log` rows do not reliably
// carry which round they belong to, so a timeline line cannot tell an R4
// complaint apart from an R2 bureau letter, and guessing is how a false sentence
// gets on a screen. The three escalation states live in their own field of the
// payload, built from the letter rows themselves — see src/progress/escalations.mjs.
//
// ───────────────────────────────────────────────────────────────────────────
// WHERE THE WORDS COME FROM
//
// repair_decision_log, via TIMELINE_SQL and timelineLine()
// (src/repair/lens.mjs:206) — both already written, both working, both
// staff-only until now. gatherRepairDetailSignals() is the function that pairs
// them and it is called rather than re-implemented.
//
// timelineLine() is still the renderer, and it still puts the date on the front.
// It is handed the APPROVED WORDS in place of the stored decision name, so the
// stored name never reaches it. That is deliberate: the date formatting stays in
// one place and the raw machine name has no path to the screen.
//
// ───────────────────────────────────────────────────────────────────────────
// WHY THIS FILE IS IN THE BEAT LIBRARY (2026-10-20)
//
// It used to be src/progress/timeline.mjs. It moved here whole and unchanged, with
// its reads (./repair-signals.mjs) and renderer (./repair-lens.mjs), so the hourly
// pulse runs the same progress read the client's page runs (a beat may import only
// from src/pulse/beats/lib). src/progress/timeline.mjs re-exports everything here,
// so every caller imports from there as before. Change the timeline here.
// ═══════════════════════════════════════════════════════════════════════════

import { gatherRepairDetailSignals } from "./repair-signals.mjs";
import { timelineLine } from "./repair-lens.mjs";

/* The audit predicate, NOT the guard. Nothing in the render path calls this to
   decide what to print — the allowlist does that. It exists so the map can be
   scrubbed at load and so the test has an oracle. It is deliberately more
   suspicious than the old guard was: the bare verbs "sent", "mailed",
   "delivered" and "posted" are in it, because "mailed" is the word this system
   actually uses and its absence is what let the old denylist through. */
const REGULATOR_RE = /\b(cfpb|consumer financial protection|attorney general|state ag|ag complaint|regulator)\b/i;
const FILED_VERB_RE = /\b(filed|filing|files|submitted|submits|submission|lodged|lodges|reported|sent|mailed|mailing|delivered|posted|dispatched|transmitted|escalated)\b/i;

/** True when a line asserts something happened to a regulator complaint. */
export function claimsFiled(text) {
  const s = String(text == null ? "" : text);
  return REGULATOR_RE.test(s) && FILED_VERB_RE.test(s);
}

/** What an unrecognised decision renders as. Carries no claim of any kind. */
export const NEUTRAL_WORDS = "progress update";

/**
 * THE ALLOWLIST. Decision name → the words a client may read.
 *
 * Every key is a decision string this repository actually writes today:
 *   - the 17 names in REPAIR_EVENTS (src/repair/register.mjs:6-23), logged by
 *     src/repair/handlers.mjs:161 and :188 as `decision: name`
 *   - the three parse.* names in src/metro2/inbound/confirm.mjs:53, :81 and :104
 *   - repair.letter.send_claim_cleared, src/repair/send.mjs:744
 *
 * A name missing from here is not a bug to be fixed by adding it blindly. It
 * renders as "progress update", which is true of anything, and somebody has to
 * decide the words before a client sees them. That is the whole design.
 */
const DRAFT_WORDS = [
  ["repair.enrolled", "joined the funding optimization program"],
  ["repair.docs.needed", "documents requested from you"],
  ["repair.docs.complete", "your documents received"],
  ["repair.analysis.complete", "report analysis finished"],
  ["repair.analysis.empty", "analysis found nothing to challenge"],
  ["repair.letters.ready", "letters prepared"],
  ["repair.letters.sent", "letters mailed"],
  ["repair.letters.delivered", "letters delivered"],
  ["repair.response.received", "a bureau response arrived"],
  ["repair.response.parsed", "bureau response read"],
  ["repair.response.retake", "a clearer copy of the response was requested"],
  ["repair.parse.low_confidence", "bureau response held for a person to read"],
  ["repair.round.complete", "round complete"],
  ["repair.round.escalated", "moved up to the next round"],
  ["repair.program.complete", "program complete"],
  ["repair.stalled", "on hold"],
  ["repair.cancelled", "cancelled"],
  ["parse.confirmed", "bureau response confirmed by our team"],
  ["parse.held_low_confidence", "bureau response held for a person to read"],
  ["parse.held_escalation_needs_human", "next round held for a person to approve"],
  ["repair.letter.send_claim_cleared", "a mailing attempt was released and can be retried"]
];

/**
 * LAYER 2. Build the map, dropping any phrase that asserts a regulator filing.
 *
 * A dropped entry is not an error and does not throw — throwing here would take
 * the whole application down at import over a copy edit. It simply stops
 * existing, so its decision renders as the neutral line. Exported so the test
 * can prove the scrub works by feeding it a bad phrase, rather than only
 * asserting that today's list happens to be clean.
 */
export function allowlistFrom(pairs) {
  return Object.freeze(new Map(
    (pairs || []).filter(([, words]) => !claimsFiled(words))
  ));
}

export const TIMELINE_WORDS = allowlistFrom(DRAFT_WORDS);

/** The decision names this module has words for. Read-only; used by the test. */
export const KNOWN_DECISIONS = Object.freeze(DRAFT_WORDS.map(([k]) => k));

/* ── THE SECOND SOURCE: MILESTONES FROM THE EVENTS TABLE ────────────────────
 *
 * Live look 2026-09-18, hole N13: Sim Twelve-Academy (f01cc0e0) signed its
 * Funding Agreement on 17 Sep, paid twice, and had a funding round started at
 * 15:13 UTC on 18 Sep. This page said "Nothing has happened on your file yet."
 * The timeline read ONLY repair_decision_log, and a funding file never writes a
 * row there — so every funding client was told nothing had happened, whatever
 * had.
 *
 * Those milestones are already recorded, with their real times, as canonical
 * events (src/events/canonical.mjs):
 *   payment.received   src/adapters/commas.mjs — every successful payment
 *   contract.signed    src/contracts/sign.mjs — the client signed
 *   round.*            src/funding/card-stacking-rounds.mjs STAGE_TO_EVENT and
 *                      src/adapters/lendflow.mjs — the funding round's steps
 *
 * SAME ALLOWLIST DESIGN, ONE DIFFERENCE. The events table carries every internal
 * event (message.queued, entry.captured, inquiry.gate.raised and the rest), so a
 * name that is not on this list is not SELECTED at all — it never becomes a
 * neutral "progress update" line. Only the names below can reach the screen, and
 * their words go through the same allowlistFrom() scrub as the list above. No
 * amount, product, lender name or payload field is ever read, let alone printed.
 *
 * deposit.paid is deliberately NOT here: it fires for the same money as
 * payment.received, and listing both would show one payment twice.
 *
 * No phrase below may use a filing word ("submitted" included) — the timeline
 * is held to that by src/http/client-progress.pg.test.mjs.
 */
const EVENT_DRAFT_WORDS = [
  ["payment.received", "payment received"],
  ["contract.signed", "agreement signed"],
  ["round.started", "funding round started"],
  ["round.submitted", "funding applications sent to lenders"],
  ["round.approved", "funding approval received"],
  ["round.funded", "funding round funded"],
  ["round.closeout", "funding round closed"]
];

export const EVENT_WORDS = allowlistFrom(EVENT_DRAFT_WORDS);

/** The event names the timeline reads. The SQL selects these and nothing else. */
export const TIMELINE_EVENT_NAMES = Object.freeze(EVENT_DRAFT_WORDS.map(([k]) => k));

const TIMELINE_EVENTS_SQL = `
  SELECT created_at AS ts, name
    FROM events
   WHERE org_id = $1::uuid
     AND client_id = $2::uuid
     AND name = ANY($3::text[])
     AND is_demo IS NOT TRUE
   ORDER BY created_at DESC
   LIMIT 40`;

/** One milestone line from an events row, or null when the name has no approved words. */
export function eventLine(row = {}) {
  const key = String(row.name == null ? "" : row.name).trim().toLowerCase();
  const words = EVENT_WORDS.get(key);
  if (!words) return null;
  return timelineLine({ action: words, ts: row.ts || row.created_at || null });
}

/**
 * The words for one stored decision name. Never the stored name itself.
 *
 * Matching is case-insensitive and trims, and nothing else — no prefix match,
 * no fuzzy match. "repair.letters.sent.v2" is a DIFFERENT decision and gets the
 * neutral line, which is the safe direction.
 */
export function approvedWords(decision) {
  const key = String(decision == null ? "" : decision).trim().toLowerCase();
  if (!key) return NEUTRAL_WORDS;
  return TIMELINE_WORDS.get(key) || NEUTRAL_WORDS;
}

/**
 * One rendered timeline line: the date, then approved words.
 *
 * timelineLine() is handed the approved words in place of the decision name, so
 * the stored machine name has no path to the rendered string.
 */
export function progressLine(row = {}) {
  const decision = row.action || row.decision || "";
  return timelineLine({ action: approvedWords(decision), ts: row.ts || row.created_at || null });
}

/**
 * The timeline for one client, newest first, in the contract's shape.
 *
 * TWO SOURCES: repair_decision_log (the list above) and the milestone events
 * (EVENT_WORDS). Each FAILS SOFT on its own — an unreadable decision log must
 * not hide the funding round, and the other way round. An empty timeline is a
 * screen with one section missing; a throw is a screen with nothing on it.
 */
export async function progressTimeline(db, { orgId, clientId } = {}) {
  if (!db || !orgId || !clientId) return [];
  const [decisionRows, eventRows] = await Promise.all([
    (async () => {
      try {
        const signals = await gatherRepairDetailSignals(db, { orgId, clientId }) || {};
        return Array.isArray(signals.timeline) ? signals.timeline : [];
      } catch (err) {
        console.warn("[progress] timeline read failed:", err && err.message);
        return [];
      }
    })(),
    (async () => {
      try {
        const r = await db.query(TIMELINE_EVENTS_SQL, [orgId, clientId, [...TIMELINE_EVENT_NAMES]]);
        return r && Array.isArray(r.rows) ? r.rows : [];
      } catch (err) {
        console.warn("[progress] milestone events read failed:", err && err.message);
        return [];
      }
    })()
  ]);
  const lines = decisionRows.map((row) => ({
    at: isoOrNull(row.ts),
    text: progressLine(row)
  }));
  for (const row of eventRows) {
    const text = eventLine(row);
    if (text) lines.push({ at: isoOrNull(row.ts), text });
  }
  /* Newest first, the order both sources already use. A stable sort, so rows
     with the same time keep their source order; a row with no usable time sorts
     last rather than being dropped. */
  return lines.sort((a, b) => stamp(b.at) - stamp(a.at));
}

function stamp(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : -Infinity;
}

function isoOrNull(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}
