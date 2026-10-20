// The batch 19 display rows that cannot honestly be attached as a practice test or a saved-result check,
// and exactly why. Each is a finding, not a failure. fin-b19-rows.test.mjs holds each reason to the repo:
// the moment the reason stops being true, that test goes red and says the row can now be attached.
//
// The repaired pipeline controls moved to executable browser proofs. Home and Watch were retired when their
// links moved into Insights; Automation remains present but hidden because every link under it is hidden.
// Both claims are re-checked from the shipped shell on every run.

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
  head("Automation", "automation", ["agent-editor.html", "automations.html", "journeys.html"]),
]);

const retiredHead = (label, section, links) => Object.freeze({
  id: `catalog-display:desks-e.json:${SURFACE}:Sidebar group '${label}' header (fold/unfold) and its links: ${links.join(", ")}`,
  sourceFile: "desks-e.json",
  surface: SURFACE,
  control: `Sidebar group '${label}' header (fold/unfold) and its links: ${links.join(", ")}`,
  requirement: `The ${label} sidebar group was retired when the CRM navigation was consolidated. Its links now live in the Insights group, so the old ${section} section must stay absent from the shipped shell.`,
  why: `The CRM redesign removed the ${label} section itself and moved ${links.join(", ")} into the visible Insights section. There is no ${label} header left to fold or unfold, so the old map row is honestly retired while the shipped shell still has Insights and no ${section} section.`,
});

export const FIN_B19_NOT_ATTACHABLE = Object.freeze([
  retiredHead("Home", "home", ["partner-galaxy.html"]),
  retiredHead("Watch", "watch", ["galaxy.html", "ops-admin.html"]),
]);
