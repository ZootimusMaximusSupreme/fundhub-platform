// Finish-853 batch 21: the screen controls proved by a practice test (real Chromium or the real door, fake
// data), and the ten rows that cannot honestly be attached, each with its exact reason.
//
// A practice test is not a live check: it reads no live data. It is attached only when the control leaves
// no saved result that could be wrong (a key, a swap, a card) or when its answer is the page's own.
// The live checks of this batch are in fin-b21-display-contracts.mjs.

import { FIN_B21_SOURCE_FILE, SOCIAL_SURFACE, TELEPROMPTER_SURFACE } from "./fin-b21-display-contracts.mjs";

const TELEPROMPTER_TEST = "src/pulse/catalog/proofs/fin-b21-teleprompter.test.mjs";
const FILM_KEY_TEST = "src/pulse/catalog/proofs/fin-b21-film-key.test.mjs";
const BROWSER_RUNNER = "real Chromium on the real teleprompter page with a fake API";

function proof(control, assertion, { tests = [TELEPROMPTER_TEST], runner = BROWSER_RUNNER } = {}) {
  return Object.freeze({
    key: `${FIN_B21_SOURCE_FILE}\0${TELEPROMPTER_SURFACE}\0${control}`,
    sourceFile: FIN_B21_SOURCE_FILE,
    surface: TELEPROMPTER_SURFACE,
    control,
    depth: "deep",
    // Every test file the case names must also be in the evidence text (display-proof-cases.test.mjs checks it).
    evidence: tests.join(", "),
    tests: Object.freeze([...tests]),
    proof: Object.freeze({ runner, assertion })
  });
}

export const FIN_B21_DISPLAY_PROOF_CASES = Object.freeze([
  proof("Empty and error states: 'No shoot is planned', 'Plan it on the Shoot tab' link, 'Try again'",
    "No shoot says so and links to the Shoot tab with no Try again; a failed read says it did not load and shows Try again, and pressing it reads the shoot again and paints the script; no connection with nothing saved says so; a closed film link says so and offers no way to plan."),
  proof("Play / Pause button and the 3-2-1 countdown",
    "Play reads Pause the moment the count starts, the count shows 3, 2, 1 in order before the words roll, Pause stops them, Pause during the count cancels it, and the second Play on the script rolls at once with no count."),
  proof("Tiny file-name chip under the words: two taps open 'Still to film'; tap a script to load it",
    "One tap on the chip opens nothing, two taps open Still to film listing only the scripts not marked Got it, a tap on one loads it, and no mark is sent."),
  proof("Top edge of the phone: tap then scroll up or down swaps to the next or previous script still to film; a second tap marks it Got it",
    "A tap on the top edge says to scroll, a scroll up loads the next script still to film and a scroll down the previous one with no mark sent; two quick taps ask first, a no marks nothing, a yes sends one got_it mark for that script and loads the next."),
  proof("'Shoot finished' card: 'Open SLO Ads' (Drive folder 13ZOjA56MNuM-PHSRK5fQK0bovRwR8raZ) and 'Back to the Shoot tab'",
    "Marking the last script Got it shows the card, Open SLO Ads links to the SLO Ads Drive folder in a new tab, and Back to the Shoot tab links to the Shoot tab."),
  proof("Keyboard and remote keys: Space / Enter / Page Down, Page Up, arrow keys, volume keys, learned buttons",
    "Space, Enter and Page Down play and pause; the arrows move the speed by 5; Page Up starts the take over; volume up plays from a pause and volume down slows it by 5; at the end of a script Space, Enter and Page Down send got_it and Page Up sends another_take and moves to take 2; buttons saved on the phone for Play and Got it are honoured."),
  proof("Film key (?k=) rules: a key names one shoot and lasts a week; a forged, expired or swapped key is closed; no sign-in wall ever",
    "At the door a good key reads its own shoot with no sign-in; a key for another shoot, another company, a forged, expired or other-secret key, or no secret is closed with the film-link-closed words and nothing is read; a key cannot write the shoot or mark another shoot; on the page a closed key shows those words and never opens a sign-in page. The key lasts ten years by owner call 2026-10-10, not a week.",
    { tests: [FILM_KEY_TEST, TELEPROMPTER_TEST], runner: "the real api/marketing handlers with a stand-in database, and real Chromium on the page" })
]);

const social = (control, reason) => Object.freeze({ sourceFile: FIN_B21_SOURCE_FILE, surface: SOCIAL_SURFACE, control, reason });
const tele = (control, reason) => Object.freeze({ sourceFile: FIN_B21_SOURCE_FILE, surface: TELEPROMPTER_SURFACE, control, reason });

/** The rows no test or check can honestly be attached to without a product change or a new row text. */
export const FIN_B21_NOT_ATTACHABLE = Object.freeze([
  social("Load-time probe: three silent GETs of the connect URL (facebook, instagram, linkedin) to grey out a button whose app is not set up",
    "The probe never sends anything. It runs once while the script loads, before the partner list has come back; probe() reads the chosen partner's id, finds none and returns, and nothing runs it again (the connect block at the end of public/app/social-studio.html). Measured in Chromium on the real page: after load no GET to /api/social/oauth was sent, and Connect Facebook, Instagram and LinkedIn were all enabled although the server answered not_configured. A test of the row's words is red; a test of today's behaviour would pin a dead probe. Needs a product change: run the probe after the partner list loads."),
  social("Writer: 'Send at (optional) - times are UTC' box",
    "The label promises UTC but the writer's Queue post handler sends new Date(value).toISOString() (the cWhen box), which reads the box as the browser's own local time; a Phoenix browser is 7 hours off. The queue table's own time box does read UTC (utcFromBox). The saved scheduled_for is a bare instant with no record of what was typed or in which zone, so no saved result can be compared with the box. A test of the UTC promise is red on the shipped page, and a test of local time would pin the bug. Needs a product change."),
  social("Tab 'Sent' (posted, with the reference on the account)",
    "The tab can never fill. GET /api/social/posts reads marketing_content_queue only, whose status can never be posted (draft, queued, scheduled, awaiting_approval, discarded, blocked), so the Sent pane always prints its own note that it cannot yet see posts that went out. Posted posts live in social_posts, which this page never reads. The saved sent posts and their references are now judged by the live check on 'Post states legend' (a post that says Sent must have a time and a reference), but the tab itself cannot show them. Needs a product change: read social_posts for the Sent pane."),
  social("Post row click / Enter (expand details) and 'See the details' (opens the side drawer)",
    "Half of it is broken. The row expands on a click (measured) and on Enter (the code does), but 'See the details' throws: openDrawer reads p.screening.state and p.screening.codes and no read supplies a screening object (GET /api/social/posts selects id, caption, offer_type, scheduled_for, status, social_post_id, blocked_reasons, created_at, updated_at). Measured in Chromium with rows shaped exactly like that answer: TypeError 'Cannot read properties of undefined (reading state)', and the drawer never opens. Needs a product change."),
  social("Side drawer: close X, click outside, Escape",
    "There is no open drawer to close with real data: openDrawer throws on p.screening before it adds the open class (see 'Post row click / Enter'), measured in Chromium. A test that gives a post a screening object tests a path the server never produces. Needs a product change first."),
  tele("Words area: one tap plays or pauses; double tap pauses and opens a cursor; hold a line edits that line; drag moves the words",
    "Two of the four claims were removed by owner call 2026-10-13. A double tap pauses and shows Copy script and Paste script only, with no cursor, no keyboard and no edit box (act() 'caret' in public/app/teleprompter.js); holding a line does nothing now ('Holding a line does nothing now'). Measured in Chromium: double tap sets copying and no contenteditable; hold changes nothing. One tap plays or pauses and drag moves the words, and those are covered by e2e/teleprompter-touch.spec.mjs, but the row cannot be called proved while it names a cursor and line editing. Needs Chris to restate the row."),
  tele("Edit bar while a cursor is open: 'Put back', 'History', 'Done', plus the X (throws away this edit) and 'Save' (visible only while editing)",
    "The edit bar can never open. beginEdit() in public/app/teleprompter.js has no caller, so editing is never set; a double tap opens Copy script only and a hold does nothing (owner call 2026-10-13), and History was removed the same day. There is no cursor, so there is no bar to press. Needs Chris to retire or restate the row."),
  tele("Settings sheet: speed, text size, line width, reading line, extra time on a gap sliders; mirror, flip, countdown toggles; 4K / 1080p pills; Learn remote (6 slots); Clear learned buttons",
    "No on-screen control opens the sheet. openSheet('set') is called only by the window.__fhtp test hook; teleprompter.html has no Settings button, so a person cannot reach the sliders, toggles, 4K and 1080p pills or Learn remote. Needs a product change: an on-screen way to open it, or retire the row."),
  tele("'This shoot' script list sheet (tap a script to roll it)",
    "No on-screen control opens the sheet. openSheet('lib') is called only by the window.__fhtp test hook; the Still to film chip menu is the path a person has. Needs a product change, or retire the row."),
  tele("Header bar: 'Shoot tab' link, 'Copy name' button, offline banner, camera line",
    "Nothing in the bar can be seen or pressed. teleprompter.css sets #top { display: none !important }, and the Shoot tab link, Copy name button, offline banner, pending-marks banner and camera line are all inside #top. Needs a product change, or retire the row.")
]);

export const FIN_B21_PRACTICE_KEYS = Object.freeze(FIN_B21_DISPLAY_PROOF_CASES.map((entry) => entry.key));
