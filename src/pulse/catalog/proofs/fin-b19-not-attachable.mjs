// The batch 19 display rows that cannot honestly be attached as a practice test or a saved-result check,
// and exactly why. Each is a finding, not a failure. fin-b19-rows.test.mjs holds each reason to the repo:
// the moment the reason stops being true, that test goes red and says the row can now be attached.
//
// Two are named by what the page does not do: picking Manual, or the x on the Sort chip, does not give the
// first order back. They stay NOT_PROVED until a person changes the page.
//
// Three are sidebar heads that no person can see. They are not "not proved": there is nothing to judge, and
// the computer re-checks that every morning (src/pulse/coverage/fin-b19-hidden-head.mjs, N/A code
// catalog-display-hidden-section-head). They are listed here as FIN_B19_HIDDEN_HEADS so the contract that
// carries the claim and the guard that holds it to the repo read one list.

const SURFACE = "public/app/shell.js (shared chrome on my-numbers, ops-admin, partner-galaxy, partner-training, pipeline)";

const head = (label, section, links) => Object.freeze({
  id: `catalog-display:desks-e.json:${SURFACE}:Sidebar group '${label}' header (fold/unfold) and its links: ${links.join(", ")}`,
  sourceFile: "desks-e.json",
  surface: SURFACE,
  control: `Sidebar group '${label}' header (fold/unfold) and its links: ${links.join(", ")}`,
  label,
  section,
  links: Object.freeze([...links]),
});

export const FIN_B19_HIDDEN_HEADS = Object.freeze([
  head("Home", "home", ["partner-galaxy.html"]),
  head("Watch", "watch", ["galaxy.html", "ops-admin.html"]),
  head("Automation", "automation", ["agent-editor.html", "automations.html", "journeys.html"]),
]);

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
    requirement: "Choosing Manual must put the cards back in the order they came in. Today picking Manual after another sort leaves the sorted order, because the page returns early on an empty choice (applySort in public/app/pipeline.html), so this control cannot be proved until the page is changed.",
  }),
  Object.freeze({
    id: `catalog-display:desks-e.json:${PIPELINE}:The x on each active filter chip (clears that one filter)`,
    sourceFile: "desks-e.json",
    surface: PIPELINE,
    control: "The x on each active filter chip (clears that one filter)",
    why: `The x on the Waiting on, Owner and Age chips each clear only their own filter (practice test, green). The Sort chip is one of the four chips, and its x does not clear the sort. ${SORT_WHY}`,
    requirement: "The x on an active chip must clear that one filter and give back what it hid. Today the x on the Sort chip clears the choice but leaves the columns sorted, for the same reason as the Sort control (applySort in public/app/pipeline.html), so this control cannot be proved until the page is changed.",
  }),
]);
