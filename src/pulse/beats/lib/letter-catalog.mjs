// ONE COPY (2026-10-20). This file used to be src/metro2/letters/catalog.mjs. It moved here whole, unchanged except its
// import paths, so the hourly beat client-progress runs the same progress read as GET /api/read/client-progress. A beat may import only from src/pulse/beats/lib.
// src/metro2/letters/catalog.mjs re-exports everything here, so every caller imports from there as before. Change it here.
//
// Dispute letter catalog — the eight types the escalation pack emits.
// Owner 2026-08-15: full path after Round 3 is CFPB + state AG, from the same
// engine data. Detection stays in src/metro2/checks/. These strings are labels.

export const LETTER_TYPES = Object.freeze({
  R1_METRO2: "r1_metro2",
  R2_FCRA_MOV: "r2_fcra_mov",
  R3_FINAL_NOTICE: "r3_final_notice",
  FURNISHER_VALIDATION: "furnisher_validation",
  CFPB_COMPLAINT: "cfpb_complaint",
  STATE_AG_COMPLAINT: "state_ag_complaint",
  PERSONAL_INFO: "personal_info",
  INQUIRY_REMOVAL: "inquiry_removal"
});

export const LETTER_TYPE_LIST = Object.freeze(Object.values(LETTER_TYPES));

// ═══════════════════════════════════════════════════════════════════════════════
// THE ROUND LADDER — which document each of the six rounds actually is.
//
// COMPLIANCE REVIEW REQUIRED — dispute logic.
//
// Owner 2026-08-15 (line 2 of this file): the full path after Round 3 is CFPB +
// state AG, from the same engine data.
// Owner 2026-08-28, on the shape of the ladder: "1, 2, 3, escalation,
// escalation, escalation final notice", and on what separates the top three
// rungs from the bottom three: "We just use more aggressive law as we go!"
//
// So each rung stands on a stronger legal footing than the one below it, and
// the authority — not the wording — is what escalates:
//
//   R1  Round 1 Metro 2 dispute      the bureau must reinvestigate
//   R2  Round 2 method of verification   the bureau must show its work
//   R3  Round 3 final notice         delete what you cannot verify
//   R4  CFPB complaint               a federal regulator
//   R5  State attorney general complaint   state consumer-protection law
//   R6  Final notice, reissued       see R6 BELOW — nothing new was invented
//
// WHY THIS IS NOT `promptPoolRound`. `promptPoolRound` in ./prompts.mjs answers a
// different question — "which of the three BUREAU PROSE shapes does a letter for
// this round get written in" — and there are only three of those shapes. It was
// being read as the round ladder as well (src/repair/round-plan.mjs), which is
// how R4, R5 and R6 came to re-emit the Round 2 and Round 3 bureau letters
// forever while CFPB_COMPLAINT and STATE_AG_COMPLAINT, which have existed right
// here in LETTER_TYPES the whole time, were never reached through the ladder.
// The two questions are separate now. This constant is the ladder. That function
// is the prose.
//
// R6 — WHAT IS REUSED, AND WHY, STATED PLAINLY.
//
// There is no eighth letter type called "escalation final notice", and none was
// invented here. R6 reuses R3_FINAL_NOTICE, because a final notice to the bureau
// is exactly what R6 is: the last bureau letter, sent when the two regulator
// complaints have not moved the item either.
//
// R6 DOES NOT SAY, AND MAY NOT SAY, THAT THE COMPLAINTS WERE FILED. Nothing in
// this repository records that a client ever filed one. The pack SHIPS the two
// complaints undated and unsigned inside 06-complaints-CONDITIONAL, behind a
// cover sheet reading DO NOT FILE WITH ROUND 1; the client fills in the date,
// hand-signs the perjury declaration and files them personally. No table, column,
// endpoint or workflow in this repository ever hears whether that happened —
// `dispute_items` records bureau rounds and nothing else. Writing "I have filed a
// CFPB complaint" into R6 would be the identical defect already fixed on main,
// where the Round 3 letter told the bureau a CFPB complaint was being filed and
// no such document had ever been produced. It is not being recreated one rung up.
//
// THAT ABSENCE IS A FINDING, NOT A GAP TO FILL. If R6 is ever to stand on the
// complaints out loud, something has to record the filing first.
// ═══════════════════════════════════════════════════════════════════════════════

/** The six bureau rounds, in order. Mirrors BUREAU_ROUNDS in ../rounds/state.mjs. */
export const LADDER_ROUNDS = Object.freeze(["R1", "R2", "R3", "R4", "R5", "R6"]);

/**
 * Rounds at which the escalation complaints have been earned.
 *
 * An item only reaches R4 because Round 3 was answered and a human confirmed it
 * (../rounds/state.mjs applyItemOutcome). Reaching R4 is therefore the real
 * proof of the sentence both complaints swear to under penalty of perjury —
 * "I disputed inaccurate information with the consumer reporting agencies".
 */
export const ESCALATION_ROUNDS = Object.freeze(["R4", "R5", "R6"]);

const ESCALATION_ROUND_SET = new Set(ESCALATION_ROUNDS);

/** Round → the letter type that round actually produces. */
export const ROUND_LADDER = Object.freeze({
  R1: LETTER_TYPES.R1_METRO2,
  R2: LETTER_TYPES.R2_FCRA_MOV,
  R3: LETTER_TYPES.R3_FINAL_NOTICE,
  R4: LETTER_TYPES.CFPB_COMPLAINT,
  R5: LETTER_TYPES.STATE_AG_COMPLAINT,
  // Reused, not invented. See "R6 — WHAT IS REUSED, AND WHY" above.
  R6: LETTER_TYPES.R3_FINAL_NOTICE
});

/**
 * R6 is the one rung whose label may not be taken from LETTER_META, because the
 * type it reuses is titled "Round 3 final notice" and sent "After Round 2 still
 * verified / no MOV". Printing that against R6 would misstate when it goes out.
 * The reuse is named out loud instead, so a human reading the plan sees it.
 */
const R6_LABEL = Object.freeze({
  title: "Final notice, reissued",
  sendWhen: "After the CFPB and state AG complaints. Reuses the Round 3 final "
    + "notice letter — no separate escalation-final-notice letter exists, and it "
    + "does not claim either complaint was filed, because nothing records that."
});

export function isEscalationRound(round) {
  return ESCALATION_ROUND_SET.has(String(round || "").trim().toUpperCase());
}

/** The letter type a round produces, or null for an unrecognised round. */
export function letterTypeForRound(round) {
  return ROUND_LADDER[String(round || "").trim().toUpperCase()] || null;
}

/**
 * One rung of the ladder, labelled for a human reading a plan.
 *
 * @returns {{round: string, type: string, title: string, sendWhen: string}|null}
 */
export function roundLadderEntry(round) {
  const r = String(round || "").trim().toUpperCase();
  const type = ROUND_LADDER[r];
  if (!type) return null;
  const meta = LETTER_META[type];
  const label = r === "R6" ? R6_LABEL : meta;
  return {
    round: r,
    type,
    title: label.title,
    sendWhen: label.sendWhen
  };
}

/** File-level Metro 2 rules — personal info letters, not tradeline dispute. */
export const PERSONAL_RULE_IDS = Object.freeze([
  "M2-031", "M2-032", "M2-033", "M2-034"
]);

/** File-level Metro 2 rules — inquiry-removal letters. */
export const INQUIRY_RULE_IDS = Object.freeze([
  "M2-035", "M2-036", "M2-037", "M2-038"
]);

export const PERSONAL_RULES = new Set(PERSONAL_RULE_IDS);
export const INQUIRY_RULES = new Set(INQUIRY_RULE_IDS);

export const LETTER_META = Object.freeze({
  [LETTER_TYPES.R1_METRO2]: Object.freeze({
    title: "Round 1 Metro 2 dispute",
    audience: "bureau",
    round: "R1",
    sendWhen: "First mail after engine findings",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  }),
  [LETTER_TYPES.R2_FCRA_MOV]: Object.freeze({
    title: "Round 2 FCRA / method of verification",
    audience: "bureau",
    round: "R2",
    sendWhen: "After Round 1: verified, remains, or no answer past 30 days + mail time",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  }),
  [LETTER_TYPES.R3_FINAL_NOTICE]: Object.freeze({
    title: "Round 3 final notice",
    audience: "bureau",
    round: "R3",
    sendWhen: "After Round 2 still verified / no MOV",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  }),
  [LETTER_TYPES.FURNISHER_VALIDATION]: Object.freeze({
    title: "Debt validation — direct to furnisher",
    audience: "furnisher",
    round: "FURNISHER",
    sendWhen: "Collection / debt-buyer furnishers; cover sheet if 30-day FDCPA window unknown",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  }),
  [LETTER_TYPES.CFPB_COMPLAINT]: Object.freeze({
    title: "CFPB complaint",
    audience: "cfpb",
    round: "COMPLAINT",
    sendWhen: "After Round 3 failed, or DIY pack as SEND ONLY IF Round 3 failed",
    signatureOnPdf: "declaration",
    clientSignRequired: true
  }),
  [LETTER_TYPES.STATE_AG_COMPLAINT]: Object.freeze({
    title: "State attorney general complaint",
    audience: "state_ag",
    round: "COMPLAINT",
    sendWhen: "File with or after CFPB; state from client address",
    signatureOnPdf: "declaration",
    clientSignRequired: true
  }),
  [LETTER_TYPES.PERSONAL_INFO]: Object.freeze({
    title: "Personal information cleanup",
    audience: "bureau",
    round: "R1",
    sendWhen: "Engine personal-info findings (not the current street)",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  }),
  [LETTER_TYPES.INQUIRY_REMOVAL]: Object.freeze({
    title: "Inquiry removal (mail)",
    audience: "bureau",
    round: "R1",
    sendWhen: "Engine inquiry findings. Phone remover is ON HOLD — mail only.",
    signatureOnPdf: "sign_by_hand",
    clientSignRequired: false
  })
});

export function isPersonalRule(ruleId) {
  return PERSONAL_RULES.has(ruleId);
}

export function isInquiryRule(ruleId) {
  return INQUIRY_RULES.has(ruleId);
}

export function isTradelineRule(ruleId) {
  return Boolean(ruleId) && !PERSONAL_RULES.has(ruleId) && !INQUIRY_RULES.has(ruleId);
}

export function requiresDeclarationSignature(type) {
  return LETTER_META[type]?.clientSignRequired === true;
}

export function splitViolations(violations = []) {
  const tradeline = [];
  const personal = [];
  const inquiry = [];
  for (const v of violations) {
    if (!v?.ruleId) continue;
    if (PERSONAL_RULES.has(v.ruleId)) personal.push(v);
    else if (INQUIRY_RULES.has(v.ruleId)) inquiry.push(v);
    else tradeline.push(v);
  }
  return { tradeline, personal, inquiry };
}
