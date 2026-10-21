// Where a regulator complaint goes, and which rounds carry one. ONE COPY (2026-10-20).
//
// These constants and the two small rules used to sit at the top of src/metro2/rounds/complaint-filing.mjs.
// They moved here unchanged so the hourly beat client-progress builds the R4/R5 escalation states with the same
// targets as GET /api/read/client-progress (a beat may import only from src/pulse/beats/lib).
// complaint-filing.mjs imports them back and re-exports them, so every caller imports from there as before.
// Pure: no I/O.

import { LETTER_TYPES } from "./letter-catalog.mjs";

/** Where a complaint goes. Neither is a bureau or a furnisher. */
export const COMPLAINT_TARGET = Object.freeze({
  CFPB: "cfpb",
  STATE_AG: "state_ag"
});

/** Round → complaint target. Mirrors ROUND_LADDER in ../letters/catalog.mjs. */
export const COMPLAINT_ROUND_TARGET = Object.freeze({
  R4: COMPLAINT_TARGET.CFPB,
  R5: COMPLAINT_TARGET.STATE_AG
});

/** Complaint target → the letter type it carries. */
export const COMPLAINT_TARGET_TYPE = Object.freeze({
  [COMPLAINT_TARGET.CFPB]: LETTER_TYPES.CFPB_COMPLAINT,
  [COMPLAINT_TARGET.STATE_AG]: LETTER_TYPES.STATE_AG_COMPLAINT
});

/** A mailing only counts once the provider took it. 'generated' is not filed. */
export const FILED_STATUSES = Object.freeze(["sent", "delivered"]);

const TARGET_SET = new Set(Object.values(COMPLAINT_TARGET));

export function isComplaintTarget(target) {
  return TARGET_SET.has(String(target || "").trim().toLowerCase());
}

/** The complaint target a round mails to, or null for a bureau round. */
export function complaintTargetForRound(round) {
  return COMPLAINT_ROUND_TARGET[String(round || "").trim().toUpperCase()] || null;
}
