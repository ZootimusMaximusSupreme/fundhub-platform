// Finish-853 batch 21: the screen controls proved by a practice test (real Chromium or the real door, fake
// data), the two rows that are verified "nothing to judge" (the owner took the control off the phone), and the
// rows that cannot honestly be attached, each with its exact reason.
//
// A practice test is not a live check: it reads no live data. It is attached only when the control leaves
// no saved result that could be wrong (a key, a swap, a card) or when its answer is the page's own.
// The live checks of this batch are in fin-b21-display-contracts.mjs.

import { FIN_B21_SOURCE_FILE, SOCIAL_SURFACE, TELEPROMPTER_SURFACE } from "./fin-b21-display-contracts.mjs";
import { OWNER_REMOVED } from "../../coverage/fin-b21-owner-removed.mjs";

const TELEPROMPTER_TEST = "src/pulse/catalog/proofs/fin-b21-teleprompter.test.mjs";
const FILM_KEY_TEST = "src/pulse/catalog/proofs/fin-b21-film-key.test.mjs";
const WORDS_AREA_TEST = "src/pulse/catalog/proofs/fin-b21-words-area.test.mjs";
const SOCIAL_BROWSER_TEST = "src/pulse/catalog/proofs/display-contracts-teams-social-1.test.mjs";
const SOCIAL_HANDLER_TEST = "src/http/fin-b26-social-posts.test.mjs";
const BROWSER_RUNNER = "real Chromium on the real teleprompter page with a fake API";

function proof(control, assertion, { tests = [TELEPROMPTER_TEST], runner = BROWSER_RUNNER, surface = TELEPROMPTER_SURFACE } = {}) {
  return Object.freeze({
    key: `${FIN_B21_SOURCE_FILE}\0${surface}\0${control}`,
    sourceFile: FIN_B21_SOURCE_FILE,
    surface,
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
    { tests: [FILM_KEY_TEST, TELEPROMPTER_TEST], runner: "the real api/marketing handlers with a stand-in database, and real Chromium on the page" }),
  // Generation 3. Half of this row's words were taken out by owner call 2026-10-13 (docs/journeys/CHANGELOG.md:
  // "we just edit and copy and paste"; docs/journeys/shoot-flow.md 4a). The case proves what the owner chose
  // and a person gets today, and says so in its own words. The map's row text is stale, not the product.
  proof("Words area: one tap plays or pauses; double tap pauses and opens a cursor; hold a line edits that line; drag moves the words",
    "One tap on the words plays them and a second tap pauses them with no mark sent; a drag moves the words by hand (thumb up forward, thumb down back) and does not start them; a double tap, paused or rolling, stops the words and shows Copy script, Paste script and X with no cursor, no keyboard, no edit box and no Save; holding a line changes nothing, not even while the finger is still down. The row's words 'opens a cursor' and 'hold a line edits that line' were removed by owner call 2026-10-13, so this proves today's behaviour and goes red if a cursor or a hold-to-edit box comes back.",
    { tests: [WORDS_AREA_TEST] }),
  proof("Load-time probe: three silent GETs of the connect URL (facebook, instagram, linkedin) to grey out a button whose app is not set up",
    "In a Phoenix Chromium session, the page waits for its partner read, sends exactly one probe for Facebook, Instagram and LinkedIn with that partner id, and disables all three buttons when each app is not configured.",
    { surface: SOCIAL_SURFACE, tests: [SOCIAL_BROWSER_TEST], runner: "real Chromium on Social Studio with controlled APIs" }),
  proof("Writer: 'Send at (optional) - times are UTC' box",
    "In a Phoenix Chromium session, typing 09:15 in the UTC send-time box posts 09:15Z exactly, rather than shifting it seven hours through the browser's local time zone.",
    { surface: SOCIAL_SURFACE, tests: [SOCIAL_BROWSER_TEST], runner: "real Chromium on Social Studio with controlled APIs" }),
  proof("Tab 'Sent' (posted, with the reference on the account)",
    "The handler returns terminal posted rows from social_posts without the stale queue copy, and real Chromium paints the posted caption, time and provider reference in the Sent tab.",
    { surface: SOCIAL_SURFACE, tests: [SOCIAL_HANDLER_TEST, SOCIAL_BROWSER_TEST], runner: "the real posts handler over stand-in tables and real Chromium on Social Studio" }),
  proof("Post row click / Enter (expand details) and 'See the details' (opens the side drawer)",
    "Enter expands a server-shaped queue row, See the details opens its drawer without a screening object or a page error, and the drawer honestly says that the copy has not been checked yet.",
    { surface: SOCIAL_SURFACE, tests: [SOCIAL_BROWSER_TEST], runner: "real Chromium on Social Studio with controlled APIs" }),
  proof("Side drawer: close X, click outside, Escape",
    "After opening the drawer from a server-shaped row, real Chromium closes it through each reachable path: the close button, the outside scrim and the Escape key.",
    { surface: SOCIAL_SURFACE, tests: [SOCIAL_BROWSER_TEST], runner: "real Chromium on Social Studio with controlled APIs" }),
  proof("Settings sheet: speed, text size, line width, reading line, extra time on a gap sliders; mirror, flip, countdown toggles; 4K / 1080p pills; Learn remote (6 slots); Clear learned buttons",
    "The on-screen Settings button opens the real sheet, where all five sliders, three toggles, both camera-quality buttons, all six remote slots and Clear learned buttons are visible.",
    { tests: [TELEPROMPTER_TEST] }),
  proof("'This shoot' script list sheet (tap a script to roll it)",
    "The on-screen This shoot button opens the full ordered script list; tapping a script closes the sheet, loads that script into the teleprompter and sends no completion mark.",
    { tests: [TELEPROMPTER_TEST] })
]);

/**
 * The two rows that are "nothing to judge": the owner took the control off the phone on purpose, and the
 * display lane reads the live files every run (src/pulse/coverage/fin-b21-owner-removed.mjs) and goes red
 * the day it is back. The list lives there; this is the same two rows, named for the wiring test.
 */
export const FIN_B21_OWNER_REMOVED_ROWS = Object.freeze(OWNER_REMOVED.map((entry) => Object.freeze({
  sourceFile: entry.sourceFile, surface: entry.surface, control: entry.control, removed: entry.removed
})));

/** The rows no test or check can honestly be attached to without a product change or a new row text. */
export const FIN_B21_NOT_ATTACHABLE = Object.freeze([
]);

export const FIN_B21_PRACTICE_KEYS = Object.freeze(FIN_B21_DISPLAY_PROOF_CASES.map((entry) => entry.key));
