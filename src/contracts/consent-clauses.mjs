// The consent clauses every client agreement carries.
//
// Owner decision 2026-10-20 (ops/workflows/set-a-fix-2026-10-20.md, items 29/30):
// no separate consent step. The signed contract IS the consent. Every client
// agreement says, in its own words, that (a) calls may be recorded, (b) Fundhub
// uses AI, and (c) Fundhub may use the client's words, results and testimonial
// in its marketing.
//
// The words were written into the live wordings by
// db/migrations/492_client_agreement_consent_clauses.sql (and, for a fresh
// database where the seeds create the rows after the migrations ran,
// db/seed/035_client_agreement_consent_clauses.sql). Those two files hold the
// same sentences as this one; src/contracts/consent-clauses.test.mjs fails if
// they drift.
//
// The heartbeat reads a signed contract's frozen copy (contracts.rendered_body)
// for the marker sentences below to decide whether that client agreed
// (src/pulse/catalog/proofs/consent-from-contract.mjs).

/** One sentence per consent. Each is a whole sentence of the clause, unique to it. */
export const CONSENT_MARKERS = Object.freeze({
  callRecording: "Calls between you and Fundhub may be recorded and kept.",
  ai: "Fundhub uses artificial intelligence (AI) in its service.",
  marketing: "Fundhub may use your words, your results and your testimonial in its marketing and advertising."
});

const RECORDING = `Recorded calls. ${CONSENT_MARKERS.callRecording} Fundhub uses the recordings to keep an accurate record of what was said, to deliver and check its service, and to train its team.`;
const AI = `Artificial intelligence. ${CONSENT_MARKERS.ai} AI tools analyze your credit file, your funding file and the documents you give us. AI agents work on your file. AI may call you and text you for Fundhub, within your contact preferences.`;
const MARKETING = `Your words in our marketing. ${CONSENT_MARKERS.marketing} That includes what you say on a recorded call or video, your name, your voice and your picture, on its website, on social media and in paid ads.`;
const AGREE = "By signing, you agree to all three: recorded calls, the use of AI by Fundhub, and the use of your words, results and testimonial in Fundhub marketing.";

/** The clause as a capitals-headed section, for the agreements with a SIGNATURES block. */
export const CONSENT_SECTION_PLAIN = ["CALLS, AI AND YOUR STORY", "", RECORDING, "", AI, "", MARKETING, "", AGREE].join("\n");

/** The clause as numbered section 16, for the executed agreements (sections 1-15, then Acknowledgement). */
export const CONSENT_SECTION_NUMBERED = [
  "16. Calls, AI and your story",
  `16.1 ${RECORDING}`,
  `16.2 ${AI}`,
  `16.3 ${MARKETING}`,
  `16.4 ${AGREE}`
].join("\n");

/** The client agreements that carry the clauses: every wording the closer's deck can
    send. The soft-pull authorization, staff and partner agreements are not client
    service agreements. Kept equal to DECK_CONTRACT_KEYS by the test. */
export const CLIENT_AGREEMENT_KEYS = Object.freeze([
  "CAPITAL-BLUEPRINT-AGREEMENT",
  "CREDIT-REPAIR-AGREEMENT",
  "FUNDING-AGREEMENT",
  "FUNDING-MASTERY-AGREEMENT",
  "REPAIR-AND-FUNDING-AGREEMENT",
  "REPAIR-TRIAL-AGREEMENT"
]);

/** The two executed documents use numbered sections; the rest use capitals headings. */
export const NUMBERED_AGREEMENT_KEYS = Object.freeze(["CAPITAL-BLUEPRINT-AGREEMENT", "FUNDING-MASTERY-AGREEMENT"]);
