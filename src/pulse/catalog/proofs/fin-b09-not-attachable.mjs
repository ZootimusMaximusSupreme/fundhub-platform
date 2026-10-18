// The batch 09 display row that cannot honestly be attached today, and exactly why.
// Each is a finding, not a failure. fin-b09-rows.test.mjs holds each reason to the repo: the moment the
// reason stops being true, that test goes red and says the row can now be attached.
// (The third row, the private lead list's "Reset my edits" button, is no longer here: it is attached as a live
// check, the lane reads the page the server hands out. See src/pulse/coverage/fin-b09-leads-reset.mjs.)

export const FIN_B09_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    id: "catalog-display:desks-a.json:agent-editor.html:Agent list row (click to open an agent, confirm discard of unsaved edits)",
    sourceFile: "desks-a.json",
    surface: "agent-editor.html",
    control: "Agent list row (click to open an agent, confirm discard of unsaved edits)",
    why: "The row says the confirm discards unsaved edits. It does not: after Yes the typed words stay on that agent in memory, "
      + "and going back to it shows them again with the unsaved mark gone. The click and the question work "
      + "(fin-b09-agent-editor.test.mjs exercises them); the discard half is a product bug. Generation 2 re-ran it in "
      + "Chromium (fin-b09-g2-findings.test.mjs): type, Yes, go back, the typed words are there with no unsaved mark.",
  }),
]);
