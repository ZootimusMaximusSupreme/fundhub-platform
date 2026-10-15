// Batch 13: screen controls proved by a practice test (fake data, real Chromium) because the click leaves
// no saved result that could be wrong: a filter, a fold, a drawer, a tab, a page gate. The tests are
// fin-b13-hiring-page.test.mjs and fin-b13-specialist-desk.test.mjs. These are practice tests, not live
// checks. (The live checks of this batch are in fin-b13-display-contracts.mjs.)
//
// Two kinds of row are listed here:
//   1. Rows with ONLY a practice test (a filter, a fold, a tab, a gate).
//   2. Rows that also have a live check (the board columns, the summary tiles, the postings rails, the bureau
//      chips and the send options). The live check judges the saved rows behind the control; the practice
//      test judges what the page does with them. Both are attached, so a break on either side is red.
//
// Rows left NOT_PROVED on purpose (not attachable, see the manifest): Page load, Decisions log, Funnel (the
// page measures them from a fixed date), Show more (its words are false for the page) and Stat tiles (its
// Worked tile is bumped wrongly after a confirm) and the case row's Enter key (it has none).

import { FIN_B13_CHECKS } from "./fin-b13-display-contracts.mjs";

const HIRING_TEST = "src/pulse/catalog/proofs/fin-b13-hiring-page.test.mjs";
const DESK_TEST = "src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs";

function proof(test, surface, control, assertion) {
  return Object.freeze({
    key: `desks-c.json\0${surface}\0${control}`,
    sourceFile: "desks-c.json",
    surface,
    control,
    depth: "deep",
    evidence: test,
    tests: Object.freeze([test]),
    proof: Object.freeze({
      runner: "local Chromium on the real page with a fake API",
      assertion
    })
  });
}

const hiring = (control, assertion) => proof(HIRING_TEST, "hiring.html", control, assertion);
const controlOf = (key) => {
  const found = FIN_B13_CHECKS.find((spec) => spec.key === key);
  if (!found) throw new Error(`no live check named ${key}`);
  return found.control;
};
const desk = (control, assertion) => proof(DESK_TEST, "inquiry-remover.html", control, assertion);

export const FIN_B13_DISPLAY_PROOF_CASES = Object.freeze([
  hiring("Board filter: 'flagged only' toggle",
    "The toggle turns aria-pressed and its pressed look on, keeps only people with a flag or no score, and the next press clears both."),
  hiring("Board filter: role select (all, closer, setter, sales_coordinator)",
    "The select offers exactly the three roles; each one leaves only its own people with the right count, and all brings everyone back."),
  hiring("Board filter: source select (referral, client_base, audience, social, job_board, ads, linkedin, recruiter, inbound)",
    "The select offers exactly the nine sources (the same list as candidates_source_ck); each one leaves only its own people, and all brings everyone back."),
  hiring("Stage rail: 'all stages' button + one button per stage (filters the board, 11 buttons)",
    "The rail has twelve buttons with counts, one stage button shows only that column, and all stages shows all eleven."),
  hiring("Reset filters button",
    "After a role, a source, a flag, a stage, both postings rails, a funnel role and window, and the decision log's role, window and kind were set, Reset puts every one back to its start and the funnel is read again for 90 days."),
  hiring("Drawer close: X button, scrim click, Escape key",
    "Each of the three closes the drawer, hides it from the keyboard and removes the dimmed page."),
  hiring("Waiting-on-a-person table: click or Enter on a row opens the candidate drawer",
    "Each row opens the drawer for its own candidate by a click, by Enter and by Space, so a row that opens the first person for everyone is seen."),
  hiring("Postings table row: expand/collapse detail",
    "A click opens the row's detail with the channel's own failure words, the next click closes it, and Enter and Space toggle it."),
  hiring("Reports disclosure (summary toggle) holding the funnel and decisions tables",
    "The fold starts closed with both the funnel and the decisions tables inside it, one press opens it and shows both, and another press closes it."),
  hiring("Demo Mode rows: shown with a demo label when demo mode is on, counted nowhere; sample data when localStorage fh_demo=1",
    "Six demo rows, each marked a different way, carry their label and are taken out of every tile, the bench table and the waiting count, each saying how many were left out; a real surname that starts DEMO is not one; with demo mode off they are hidden and counted; a demo session reads no hiring endpoint."),
  hiring("Page gate: only owner and admin open Hiring; no sidebar row exists (NAV_HIDDEN), so it is reached only by typing /app/hiring.html or a link",
    "Owner and admin stay on the page and shell.js itself hides and marks the sidebar row; closer, setter, csm, sales manager, funding advisor, specialist, partner, client and affiliate are sent to their own home."),
  desk("'Retry' button when the queue fails to load",
    "A failed repair read shows Couldn't load and a dash, and Retry reads the queue again and brings the rows and the number back, whether the server answered with an error, the connection dropped, or a proxy answered with a page."),
  desk("Case drawer: 'Open documents' link (documents.html?client_id=)",
    "The link goes to documents.html with this case's own client id."),
  desk("Desk headline number + 'next' button (Ready to send / Need me; opens the next case or file)",
    "Among thirteen cases of every kind, the number is the three that can be sent now (not blocked, nothing gone out, with a bureau, Scheduled counted), its sentence names the oldest of them and how many more need a person, and the next button opens that oldest case."),
  desk("Desk tabs: 'Inquiries' and 'Repair' (remembers the last pane in browser storage)",
    "Each tab swaps the pane, the tiles and the headline, stores the last pane, and a reload opens on it."),
  desk("Expanded row 'Soft pull' button (owner, admin, closer, funding_advisor only; opens the PULL modal)",
    "Only those four roles are offered the button, the box needs the word PULL, every close works, and Pull orders the three bureaus for that client."),
  desk("Letter list item in an expanded row: opens the letter drawer (letter text, rules, signature); drawer Close buttons",
    "Of two letters, each opens its own title, rules and words (and not the other's), Send this one mails the letter that is open, and the header Close, footer Close, scrim and Escape each shut the drawer."),
  desk("Repair headline 'Open <client>' next button",
    "The button names the first file that needs her and opens that row, is not given to a waiting file that comes first in the list, and is absent when no file needs her."),
  desk("Repair tile filters: Need me, Ready to send, Waiting on bureau, Stuck, Trial ending (press again to clear)",
    "Each of the five tiles prints the server's own number and keeps exactly its own files, by every reason a file can belong to it, pressing again clears it, and the keyboard works."),
  hiring(controlOf("hiring-column-screening"),
    "Of one person in every stage, the Screening column holds exactly that person, under its own name, with its own count."),
  hiring(controlOf("hiring-column-offer"),
    "Of one person in every stage, the Offer column holds exactly that person, under its own name, with its own count."),
  hiring(controlOf("hiring-column-hired"),
    "Of one person in every stage, the Hired column holds exactly that person, under its own name, with its own count."),
  hiring(controlOf("hiring-column-onboarding"),
    "Of one person in every stage, the Onboarding column holds exactly that person, under its own name, with its own count."),
  hiring(controlOf("hiring-column-ramp"),
    "Of one person in every stage, the Ramp column holds exactly that person, under its own name, with its own count, and two people count as two."),
  hiring(controlOf("hiring-column-performing"),
    "Of one person in every stage, the Performing column holds exactly that person, under its own name, with its own count."),
  hiring(controlOf("hiring-column-rejected"),
    "Of one person in every stage, the Not Moving Forward column holds exactly that person, reads as closed, and has its own count."),
  hiring(controlOf("hiring-column-withdrawn"),
    "Of one person in every stage, the Withdrawn column holds exactly that person; with nobody there it says nothing puts a candidate in this stage yet."),
  hiring(controlOf("hiring-bench-tiles"),
    "The four tiles add up the bench rows the server sent role by role, the waiting tile counts closed people too and says how many are open, the chip follows the short-by number, and demo rows come off every tile."),
  hiring(controlOf("hiring-postings"),
    "The state rail and the channel rail show their counts, each narrows to its own postings, both together narrow to the postings that are both, and a row opens its detail by click, Enter and Space."),
  desk(controlOf("specialist-bureau-chips"),
    "Every spelling of a bureau lands in its own chip, the filter reaches each of them, a finished removal is counted in none, and a bureau no chip knows is in no chip."),
  desk(controlOf("specialist-send-options"),
    "Mail is ticked by default, the four service levels are offered and the chosen one is sent, the Experian portal block is on an Experian case only, a portal upload with no reference is refused on the page, and the request says exactly what was chosen."),
  proof(DESK_TEST, "index.html",
    "No session / unknown role: sends person to sign-in (login.html?next= or portal-login)",
    "With no session the page goes to the sign-in page carrying where to come back to; a role that matches no desk is signed out first.")
]);

export const FIN_B13_DISPLAY_PRACTICE_CONTROLS = Object.freeze(FIN_B13_DISPLAY_PROOF_CASES.map((entry) => entry.control));
