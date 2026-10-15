// The three batch 09 display rows that cannot honestly be attached today, and exactly why.
// Each is a finding, not a failure. fin-b09-rows.test.mjs holds each reason to the repo: the moment the
// reason stops being true, that test goes red and says the row can now be attached.

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
  Object.freeze({
    id: "catalog-display:public-pages.json:button:leads/<32-hex>/index.html#reset:Button 'Reset my edits'",
    sourceFile: "public-pages.json",
    surface: "button:leads/<32-hex>/index.html#reset",
    control: "Button 'Reset my edits'",
    why: "The page is the private lead call list. It holds real names and phone numbers, so it is git-excluded "
      + "(SHIPPED_OUTSIDE_GIT in src/pulse/registry.mjs) and is not in this repo to open. A test would need that private file. "
      + "Generation 2 searched src, scripts, db, docs and public for the page's words and for any builder of it: the page is one "
      + "inline file with its data in it, and nothing in git generates it. A test that skips when the file is absent would be a "
      + "skipped test on every fresh checkout.",
  }),
]);
