// The batch 19 display rows that cannot honestly be attached as a practice test or a saved-result check,
// and exactly why. Each is a finding, not a failure. fin-b19-rows.test.mjs holds each reason to the repo:
// the moment the reason stops being true, that test goes red and says the row can now be attached.
//
// The repaired pipeline controls moved to executable browser proofs. The only remaining entries are three
// sidebar heads that no person can see. They are not "not proved": there is nothing to judge, and
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

export const FIN_B19_NOT_ATTACHABLE = Object.freeze([]);
