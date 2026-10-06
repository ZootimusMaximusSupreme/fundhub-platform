// Sample scripts in the ad_scripts.parts shape (spec §7.4):
// [{kind: hook | line2 | body | cue | reveal | cta, text}]. The column does
// not exist live yet, so the aligner's tests are built from this shape.

/* Bullets style: the U01 API contract's example script, word for word
   (docs/specs/marketing-machine-api.md, GET marketing/scripts). */
export const BULLETS_PARTS = Object.freeze([
  { kind: "hook", text: "MOST lenders read TWO files before they say yes." },
  { kind: "line2", text: "If one is a mess, they never open the other." },
  { kind: "cue", text: "the personal file" },
  { kind: "cue", text: "the business file" },
  { kind: "cue", text: "which one they read first" },
  { kind: "reveal", text: "We check both before you apply anywhere." },
  { kind: "cta", text: "Tap below and see what both files say today." }
]);

/* Words style: three short lines, one part each. */
export const THREE_LINES = Object.freeze([
  { kind: "hook", text: "Lenders read two files before they ever say yes to you." },
  { kind: "body", text: "Your score hides the thirteen data points that cap your funding." },
  { kind: "cta", text: "Tap below and grab your roadmap today." }
]);

/* One line, eleven countable words: missing one word is 10 of 11 (91%,
   qualifies); missing two is 9 of 11 (82%, does not). */
export const ONE_LINE = Object.freeze([
  { kind: "hook", text: "Lenders read two files before they ever say yes to you." }
]);
