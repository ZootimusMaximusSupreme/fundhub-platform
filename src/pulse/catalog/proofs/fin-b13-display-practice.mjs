// Batch 13: screen controls proved by a practice test (fake data, real Chromium) because the click leaves
// no saved result that could be wrong: a filter, a fold, a drawer, a tab, a page gate. The tests are
// fin-b13-hiring-page.test.mjs and fin-b13-specialist-desk.test.mjs. These are practice tests, not live
// checks. (The live checks of this batch are in fin-b13-display-contracts.mjs.)

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
const desk = (control, assertion) => proof(DESK_TEST, "inquiry-remover.html", control, assertion);

export const FIN_B13_DISPLAY_PROOF_CASES = Object.freeze([
  hiring("Board filter: 'flagged only' toggle",
    "The toggle turns aria-pressed on and keeps only people with a flag or no score, and the next press clears it."),
  hiring("Board filter: role select (all, closer, setter, sales_coordinator)",
    "Choosing setter leaves only the setters on the board with the right count, and choosing all brings everyone back."),
  hiring("Board filter: source select (referral, client_base, audience, social, job_board, ads, linkedin, recruiter, inbound)",
    "Choosing referral leaves only the referrals on the board with the right count, and choosing all brings everyone back."),
  hiring("Stage rail: 'all stages' button + one button per stage (filters the board, 11 buttons)",
    "The rail has twelve buttons with counts, one stage button shows only that column, and all stages shows all eleven."),
  hiring("Reset filters button",
    "After a role, a source, a flag, a stage, a postings rail, a funnel role and a log window were set, Reset puts every one back."),
  hiring("Drawer close: X button, scrim click, Escape key",
    "Each of the three closes the drawer, hides it from the keyboard and removes the dimmed page."),
  hiring("Waiting-on-a-person table: click or Enter on a row opens the candidate drawer",
    "A click and the Enter key each open the drawer for the named candidate, and the count line matches the rows."),
  hiring("Postings table row: expand/collapse detail",
    "A click opens the row's detail with the channel's own failure words, the next click closes it, and Enter and Space toggle it."),
  hiring("Reports disclosure (summary toggle) holding the funnel and decisions tables",
    "The fold starts closed, one press opens it and shows both tables, and another press closes it."),
  hiring("Funnel: role select + days select (30, 90, 180, 365, 730) -> where applications come from",
    "Choosing a role and a window re-reads the funnel with that role and those days and paints exactly what came back."),
  hiring("Decisions log: role select, days select, decision-kind rail (advance, reject, offer, offer_accepted, offer_declined, withdraw, hold)",
    "The kind rail, the role and the window each narrow the log to the right rows, and the four unreachable kinds show zero."),
  hiring("Demo Mode rows: shown with a demo label when demo mode is on, counted nowhere; sample data when localStorage fh_demo=1",
    "A demo row carries its label and is taken out of every tile; with demo mode off it is hidden and counted; a demo session reads no hiring endpoint."),
  hiring("Page gate: only owner and admin open Hiring; no sidebar row exists (NAV_HIDDEN), so it is reached only by typing /app/hiring.html or a link",
    "Owner and admin stay on the page with no sidebar row, and closer, setter, csm, sales manager, funding advisor and specialist are sent to their own home."),
  hiring("Page load: fires demo/mode + candidates + postings + decisions + bench reads, paints tiles, board and tables",
    "The five reads are made, the four tiles and the bench chip add up from the fake data, and the board and three tables are painted."),
  desk("'Retry' button when the queue fails to load",
    "A failed repair read shows Couldn't load and a dash, Retry reads the queue again, and the rows and the number come back."),
  desk("'Show more' button under the case queue (25 rows a time)",
    "Thirty cases show 25 rows, the button says how many are held back, and pressing it shows all thirty and hides the button."),
  desk("Case drawer: 'Open documents' link (documents.html?client_id=)",
    "The link goes to documents.html with this case's own client id."),
  desk("Desk headline number + 'next' button (Ready to send / Need me; opens the next case or file)",
    "The number is the cases ready to send, its sentence names the oldest, and the next button opens that oldest case."),
  desk("Desk tabs: 'Inquiries' and 'Repair' (remembers the last pane in browser storage)",
    "Each tab swaps the pane, the tiles and the headline, stores the last pane, and a reload opens on it."),
  desk("Expanded row 'Soft pull' button (owner, admin, closer, funding_advisor only; opens the PULL modal)",
    "Only those four roles are offered the button, the box needs the word PULL, every close works, and Pull orders the three bureaus for that client."),
  desk("Letter list item in an expanded row: opens the letter drawer (letter text, rules, signature); drawer Close buttons",
    "A letter opens the drawer with its title, rules, words and signature line, and the header Close, footer Close, scrim and Escape each shut it."),
  desk("Repair headline 'Open <client>' next button",
    "The button names the first file that needs her and opens that file's row."),
  desk("Repair tile filters: Need me, Ready to send, Waiting on bureau, Stuck, Trial ending (press again to clear)",
    "Each of the five tiles keeps exactly its own files, pressing again clears it, and the keyboard works."),
  proof(DESK_TEST, "index.html",
    "No session / unknown role: sends person to sign-in (login.html?next= or portal-login)",
    "With no session the page goes to the sign-in page carrying where to come back to; a role that matches no desk is signed out first.")
]);

export const FIN_B13_DISPLAY_PRACTICE_CONTROLS = Object.freeze(FIN_B13_DISPLAY_PROOF_CASES.map((entry) => entry.control));
