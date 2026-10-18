// Batch 06: screen controls proved by a practice test (fake data, real Chromium) because the click leaves no
// saved receipt that could show what the PAGE did. The tests are fin-b06-display-browser.test.mjs and, from
// repair cycle 2, fin-b06-display-browser-2.test.mjs.
//
// Two kinds of row:
//   * PRACTICE_ONLY: the click leaves nothing to read, so the practice test is the only evidence.
//   * PRACTICE_ALSO_LIVE: a saved row can be judged (a live check owns the row in the pulse lane), and the
//     practice test covers the half no saved row can show: which button was pressed, what the boxes sent, what the
//     page said back. The live check stays each row's result in the lane.
// These are practice tests, not live checks.

const TEST_FILE = "src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs";
const TEST_FILE_2 = "src/pulse/catalog/proofs/fin-b06-display-browser-2.test.mjs";

function proof(sourceFile, surface, control, assertion, files = [TEST_FILE]) {
  return Object.freeze({
    key: `${sourceFile}\0${surface}\0${control}`,
    sourceFile,
    surface,
    control,
    depth: "deep",
    evidence: files.join("; "),
    tests: Object.freeze([...files]),
    proof: Object.freeze({
      runner: "local Chromium on the real page with a fake API",
      assertion,
    }),
  });
}

// Six controls whose exact page action cannot be attributed from a saved row: the practice test is the only evidence.
const PRACTICE_ONLY = Object.freeze([
  proof("desks-a.json", "client-control-panel.html", "Businesses cards: Save month/year button (stamp incorporation)",
    "With a real-shaped business card, Save month/year posts stamp_incorporated with this client, that card's exact business name and the exact month typed; only an accepted save says Saved, then the page re-reads the file and paints the saved month.",
    [TEST_FILE_2]),
  proof("desks-a.json", "client-control-panel.html", "Capital Blueprint: Bank list state buttons",
    "With two banks on the list, Done, Skipped and Put back on the list each post update_bank_todo_state with this client, the id of THEIR OWN row and the chosen state (the other row is left alone), the list is read again and shows the server's state, and a refused change leaves the buttons usable."),
  proof("desks-a.json", "client-control-panel.html", "Identity-on-file state line and client approval link box + Copy link",
    "An identity on file reads \"Identity is on file for this client.\" in the ok colour and offers no link. A missing identity with a valid consent reads the refusal sentence in the blocked colour and the box says the identity sentence; consent missing with identity on file says the consent sentence; both missing says the sentence for both; an identity the server did not answer paints no line, offers no box for a valid consent, and says the consent sentence for a missing one. The box holds exactly the server's link and Copy link puts it on the clipboard; when the clipboard is refused or absent it selects the box and says Press Ctrl+C. The expiry line names the Phoenix clock time, and is hidden with no expiry. With no link the page shows the server's reason and no empty box, and a taken-back consent hides the line and the box.",
    [TEST_FILE, TEST_FILE_2]),
  proof("desks-a.json", "client-portal.html", "Sign to authorize dispute letters: legal name input",
    "An empty name is refused with nothing sent, and a typed name is trimmed and sent as granted_name exactly, then the box is cleared once the signature is saved."),
  proof("desks-a.json", "client-portal.html", "Sign to authorize dispute letters: signature pad (draw)",
    "An empty pad, a single tap and a cleared pad are all refused with nothing sent, and a drawn pad sends one signature grant for this client with the server's wording version."),
  proof("desks-b.json", "content-admin.html", "Locked tile editor: Showing/Hidden switch per tile (keyboard Space/Enter too)",
    "Click, Space and Enter each flip the switch and its Showing or Hidden badge for that tile only, and Save sends each tile's own on flag.")
]);

// Controls that have BOTH. The page half is the practice test; the saved half is the live check on the same row.
const DOOR_PROOF = "Each of the three doors posts to /api/documents-upload with this client, its own kind (client_upload, inquiry_doc, bureau_response) and exactly the type picked in its select, and posts no type at all when none was picked. A dropped kind or a dropped choice leaves a saved row that looks like an ordinary file, so only the page can show it. A file-specific 400 says why and asks for a different file instead of retrying one the server already refused; a recoverable server failure says Try again and keeps the picked file so the next press sends it again; only an accepted upload says Sent.";
const BP = "client-control-panel.html";
const PRACTICE_ALSO_LIVE = Object.freeze([
  proof("desks-a.json", "client-portal.html", "Upload door: bureau response (type select, Upload button, file picker)", DOOR_PROOF, [TEST_FILE, TEST_FILE_2]),
  proof("desks-a.json", "client-portal.html", "Upload door: ID and personal documents (type select, Upload button, file picker)", DOOR_PROOF, [TEST_FILE, TEST_FILE_2]),
  proof("desks-a.json", "client-portal.html", "Upload door: Inquiry documents (type select, Upload button, file picker)", DOOR_PROOF, [TEST_FILE, TEST_FILE_2]),
  proof("desks-a.json", "client-portal.html", "What You Own: Download link per file",
    "With documents in a different order from the owned items, each owned item's Download link is its own document's link (matched by type, not by position), an unclaimed deliverable gets its own row and link, a file whose link was withheld says it is on file and cannot be downloaded and offers no link, an owned item with no document says it is not built yet, a client's own upload is never listed, and no two rows share a link.",
    [TEST_FILE_2]),
  proof("desks-b.json", "consent-capture.html",
    "Consent wording, version badge and current status banner (read from the server, never typed in the page)",
    "The words are the server's, drawn as text and never as markup; the version badge names the server's version; each server status (on file, none on file, withdrawn, expired, not started, unknown) paints its own tone and sentence; an expired consent says when it expired and a valid one says when it expires, and neither line is written with no expiry; recording a consent posts the shown version and never the words; and with no wording from the server, or a failed read, Record consent is off and nothing is posted.",
    [TEST_FILE, TEST_FILE_2]),
  proof("desks-a.json", BP, "Capital Blueprint: Save ready date button",
    "Save ready date posts set_next_sequence_date with this client and exactly the day typed in the box (a second, different day goes out as that day), refuses an empty box on the page with nothing posted, says what was saved and shows the saved day, and a refused save says the client has not paid, keeps the old day on screen and leaves the button usable.",
    [TEST_FILE_2]),
  proof("desks-a.json", BP, "Capital Blueprint: Add bank to the list button (Bank, Account, Notes inputs)",
    "Add bank refuses an empty Bank box on the page with nothing posted; otherwise it posts add_bank_todo with the Bank box trimmed as bank_key, the Account choice (business or personal) as account_kind, and the Notes box trimmed as notes (null when empty), then clears the boxes; a refusal because the tracker was never offered puts the Offer button back and takes the form away.",
    [TEST_FILE_2]),
  proof("desks-a.json", BP, "Capital Blueprint: Offer bank tracker button",
    "Offer bank tracker posts offer_bank_tracker with offered true and nothing else, then shows Offered with the bank form and the Take the offer back button; a refusal says the client has not paid and leaves the Offer button on screen.",
    [TEST_FILE_2]),
  proof("desks-a.json", BP, "Capital Blueprint: Take the offer back button",
    "Take the offer back posts offer_bank_tracker with offered false (never true), then shows Not offered with the Offer button back and the bank form gone; it is the button on screen for a client who was already offered.",
    [TEST_FILE_2]),
  proof("desks-c.json", "inquiry-remover.html",
    "'Needs a human read' list: low-confidence bureau answers and stuck clients; 'Mark as checked' button",
    "The list prints the stuck client by email under Stuck in repair, and each answer's Mark as checked posts confirm_parse with THAT row's response id and says Checked only when the server accepted it; a refused one shows the server's reason and not Checked.",
    [TEST_FILE_2]),
  proof("desks-c.json", "inquiry-remover.html",
    "Case drawer: 'Call bureau' button (AI voice call to the bureau, uses DOB/SSN; disabled once fired)",
    "Call bureau is off, with the title Call already started, for a case that is already fired and posts nothing; for an open case it posts the launch door with THAT case's id and nothing else; a refused launch says the server's words and leaves the button usable.",
    [TEST_FILE_2])
]);

export const FIN_B06_DISPLAY_PROOF_CASES = Object.freeze([...PRACTICE_ONLY, ...PRACTICE_ALSO_LIVE]);

/** Controls where the practice test is the only evidence: no saved-result contract may also claim them. */
export const FIN_B06_DISPLAY_PRACTICE_CONTROLS = Object.freeze(PRACTICE_ONLY.map((entry) => entry.control));

/** Controls that also own a live saved-result check; the practice test covers the part no saved row can show. */
export const FIN_B06_DISPLAY_PRACTICE_ALSO_LIVE_CONTROLS = Object.freeze(PRACTICE_ALSO_LIVE.map((entry) => entry.control));
