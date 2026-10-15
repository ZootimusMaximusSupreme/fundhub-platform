// The batch 19 display rows that cannot honestly be attached today, and exactly why.
// Each is a finding, not a failure. fin-b19-rows.test.mjs holds each reason to the repo: the moment the
// reason stops being true, that test goes red and says the row can now be attached.
// The three sidebar heads are not reachable by any person; the Sort row and the chip row name something
// the page does not do (picking Manual, or the x on the Sort chip, does not give the first order back).

const SURFACE = "public/app/shell.js (shared chrome on my-numbers, ops-admin, partner-galaxy, partner-training, pipeline)";

const row = (name, links, why) => Object.freeze({
  id: `catalog-display:desks-e.json:${SURFACE}:Sidebar group '${name}' header (fold/unfold) and its links: ${links}`,
  sourceFile: "desks-e.json",
  surface: SURFACE,
  control: `Sidebar group '${name}' header (fold/unfold) and its links: ${links}`,
  why,
});

const NEVER = "shell.js hides the rows under it by name (NAV_HIDDEN), so for every role it has "
  + "(owner, admin, sales manager, closer, funding advisor, CSM, setter, inquiry specialist, partner) "
  + "gateLinks() hides the whole section and its head is never drawn. No person can click it to fold or unfold it, "
  + "so there is no control to prove. fin-b19-shell-sidebar.test.mjs loads the rail as each of the nine roles "
  + "and shows the head is absent.";

const PIPELINE = "public/app/pipeline.html";
const SORT_WHY = "applySort() in public/app/pipeline.html starts with `if(!mode) return;`, so an empty choice reorders nothing. "
  + "Picking Manual after Name A-Z (or pressing the x on the Sort chip, which sets the choice to empty and calls the same "
  + "function) clears the select and the chip and leaves every column in the sorted order until the page is reloaded. "
  + "fin-b19-pipeline-controls.test.mjs exercises it and pins the behaviour.";

export const FIN_B19_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    id: `catalog-display:desks-e.json:${PIPELINE}:Sort: Manual / Name A-Z / Amount high first / Longest in stage / Amount needed first`,
    sourceFile: "desks-e.json",
    surface: PIPELINE,
    control: "Sort: Manual / Name A-Z / Amount high first / Longest in stage / Amount needed first",
    why: `The four sorts each put the cards in their own order (practice test, green), but the first choice, Manual, does not do what its name says. ${SORT_WHY}`,
  }),
  Object.freeze({
    id: `catalog-display:desks-e.json:${PIPELINE}:The x on each active filter chip (clears that one filter)`,
    sourceFile: "desks-e.json",
    surface: PIPELINE,
    control: "The x on each active filter chip (clears that one filter)",
    why: `The x on the Waiting on, Owner and Age chips each clear only their own filter (practice test, green). The Sort chip is one of the four chips, and its x does not clear the sort. ${SORT_WHY}`,
  }),
  row("Home", "partner-galaxy.html",
    `Its one link, partner-galaxy.html, is on NAV_HIDDEN (and is refused to every role but a partner). ${NEVER}`),
  row("Watch", "galaxy.html, ops-admin.html",
    `Both of its links, galaxy.html and ops-admin.html, are on NAV_HIDDEN. ${NEVER}`),
  row("Automation", "agent-editor.html, automations.html, journeys.html",
    `All three of its links, agent-editor.html, automations.html and journeys.html, are on NAV_HIDDEN. ${NEVER}`),
]);
