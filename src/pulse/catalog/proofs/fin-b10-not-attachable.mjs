// The two batch 10 display rows that cannot honestly be attached today, and exactly why.
// Each is a finding, not a failure. fin-b10-rows.test.mjs holds each reason to the repo: the moment the
// reason stops being true, that test goes red and says the row can now be attached.

export const FIN_B10_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    sourceFile: "desks-a.json",
    surface: "client-control-panel.html",
    control: "More menu: Open Credit Snapshot link",
    why: "The link carries the right address (present.html?contact=<client id>), but the page's own link gate hides it from every "
      + "role: shell.js decides each link by its ALL list of screens, and present.html is not on that list, so gateLinks() sets "
      + "display:none on the row for owner, admin, sales manager, closer, funding advisor, CSM, setter and inquiry specialist "
      + "(measured in Chromium). No person can press it. The page's own comment names the one-line fix in shell.js.",
  }),
  Object.freeze({
    sourceFile: "desks-a.json",
    surface: "client-control-panel.html",
    control: "Quick launch links: Open Pipeline, Closer Deck, Messaging, Inquiry Remover",
    why: "Three of the four links work and are tested (Pipeline, Messaging, Inquiry Remover). The fourth, Open Closer Deck, is hidden "
      + "from every role by the same link gate (present.html is not on the shell.js ALL list), so the row as written, four links a "
      + "person can use, is not true today. Not attached rather than half attached.",
  }),
]);
