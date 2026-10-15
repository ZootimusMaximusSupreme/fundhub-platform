// The batch 19 display rows that cannot honestly be attached today, and exactly why.
// Each is a finding, not a failure. fin-b19-rows.test.mjs holds each reason to the repo: the moment the
// reason stops being true, that test goes red and says the row can now be attached.

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

export const FIN_B19_NOT_ATTACHABLE = Object.freeze([
  row("Home", "partner-galaxy.html",
    `Its one link, partner-galaxy.html, is on NAV_HIDDEN (and is refused to every role but a partner). ${NEVER}`),
  row("Watch", "galaxy.html, ops-admin.html",
    `Both of its links, galaxy.html and ops-admin.html, are on NAV_HIDDEN. ${NEVER}`),
  row("Automation", "agent-editor.html, automations.html, journeys.html",
    `All three of its links, agent-editor.html, automations.html and journeys.html, are on NAV_HIDDEN. ${NEVER}`),
]);
