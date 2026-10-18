// The one batch 09 display row that cannot honestly be attached today, and exactly why.
// Each is a finding, not a failure. fin-b09-rows.test.mjs holds each reason to the repo: the moment the
// reason stops being true, that test goes red and says the row can now be attached.
// (The third row, the private lead list's "Reset my edits" button, is no longer here: it is attached as a live
// check, the lane reads the page the server hands out. See src/pulse/coverage/fin-b09-leads-reset.mjs.)

export const FIN_B09_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    id: "catalog-display:public-pages.json:button:climate/index.html#Click a state: shows its sco:Click a state: shows its score and a plain sentence (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)",
    sourceFile: "public-pages.json",
    surface: "button:climate/index.html#Click a state: shows its sco",
    control: "Click a state: shows its score and a plain sentence (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)",
    why: "The shipped /climate/ page is the bundled Lending Climate dashboard. Clicking a state opens a panel with the score, "
      + "band and trend, but no plain sentence about the wider picture; the lead-magnet page the journey describes "
      + "(headline, state card with that sentence, four questions) is not what ships. Generation 2 re-ran it in Chromium "
      + "(fin-b09-g2-findings.test.mjs): the panel has the score, the band word and four numbers, and no line of words.",
  }),
]);
