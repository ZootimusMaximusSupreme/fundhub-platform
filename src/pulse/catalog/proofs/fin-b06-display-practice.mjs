// Batch 06: five screen controls proved by a practice test (fake data, real Chromium) because the click
// leaves no saved receipt that could be wrong. The test is fin-b06-display-browser.test.mjs.
// The consent screen is a sixth practice test and is different: its WORDS and VERSION are judged on saved rows
// by a live check (consent-wording-matches-server), and its status banner has no saved result, so the banner and
// what the page shows and posts are a practice test as well (PRACTICE_ALSO_LIVE below).
// These are practice tests, not live checks.

const TEST_FILE = "src/pulse/catalog/proofs/fin-b06-display-browser.test.mjs";

function proof(sourceFile, surface, control, assertion) {
  return Object.freeze({
    key: `${sourceFile}\0${surface}\0${control}`,
    sourceFile,
    surface,
    control,
    depth: "deep",
    evidence: TEST_FILE,
    tests: Object.freeze([TEST_FILE]),
    proof: Object.freeze({
      runner: "local Chromium on the real page with a fake API",
      assertion,
    }),
  });
}

// Five controls whose click leaves nothing to read: the practice test is the only evidence.
const PRACTICE_ONLY = Object.freeze([
  proof("desks-a.json", "client-control-panel.html", "Capital Blueprint: Bank list state buttons",
    "With two banks on the list, Done, Skipped and Put back on the list each post update_bank_todo_state with this client, the id of THEIR OWN row and the chosen state (the other row is left alone), the list is read again and shows the server's state, and a refused change leaves the buttons usable."),
  proof("desks-a.json", "client-control-panel.html", "Identity-on-file state line and client approval link box + Copy link",
    "An identity on file reads \"Identity is on file for this client.\" in the ok colour and offers no link; a missing identity reads the plain refusal sentence in the blocked colour, shows the approval link in the box, and Copy link puts exactly that link on the clipboard; with no link the page shows the reason and no empty box; a taken-back consent hides the line and the link."),
  proof("desks-a.json", "client-portal.html", "Sign to authorize dispute letters: legal name input",
    "An empty name is refused with nothing sent, and a typed name is trimmed and sent as granted_name exactly, then the box is cleared once the signature is saved."),
  proof("desks-a.json", "client-portal.html", "Sign to authorize dispute letters: signature pad (draw)",
    "An empty pad, a single tap and a cleared pad are all refused with nothing sent, and a drawn pad sends one signature grant for this client with the server's wording version."),
  proof("desks-b.json", "content-admin.html", "Locked tile editor: Showing/Hidden switch per tile (keyboard Space/Enter too)",
    "Click, Space and Enter each flip the switch and its Showing or Hidden badge for that tile only, and Save sends each tile's own on flag.")
]);

// Controls that have BOTH. The consent screen's words and stored version are judged on saved rows by a live check
// (consent-wording-matches-server); its status banner and what the page shows and posts have no saved result,
// so a practice test covers those. The three upload doors are judged on saved rows by a live check as well, and
// what the page sends (the door's kind and the picked type) is the practice test. The live check stays each
// row's result in the pulse lane.
const DOOR_PROOF = "Each of the three doors posts to /api/documents-upload with this client, its own kind (client_upload, inquiry_doc, bureau_response) and exactly the type picked in its select, and posts no type at all when none was picked. A dropped kind or a dropped choice leaves a saved row that looks like an ordinary file, so only the page can show it.";
const PRACTICE_ALSO_LIVE = Object.freeze([
  proof("desks-a.json", "client-portal.html", "Upload door: bureau response (type select, Upload button, file picker)", DOOR_PROOF),
  proof("desks-a.json", "client-portal.html", "Upload door: ID and personal documents (type select, Upload button, file picker)", DOOR_PROOF),
  proof("desks-a.json", "client-portal.html", "Upload door: Inquiry documents (type select, Upload button, file picker)", DOOR_PROOF),
  proof("desks-b.json", "consent-capture.html",
    "Consent wording, version badge and current status banner (read from the server, never typed in the page)",
    "The words are the server's, drawn as text and never as markup; the version badge names the server's version; each server status (on file, none on file, withdrawn, expired, not started, unknown) paints its own tone and sentence; and recording a consent posts the shown version and never the words.")
]);

export const FIN_B06_DISPLAY_PROOF_CASES = Object.freeze([...PRACTICE_ONLY, ...PRACTICE_ALSO_LIVE]);

/** Controls where the practice test is the only evidence: no saved-result contract may also claim them. */
export const FIN_B06_DISPLAY_PRACTICE_CONTROLS = Object.freeze(PRACTICE_ONLY.map((entry) => entry.control));

/** Controls that also own a live saved-result check; the practice test covers the part no saved row can show. */
export const FIN_B06_DISPLAY_PRACTICE_ALSO_LIVE_CONTROLS = Object.freeze(PRACTICE_ALSO_LIVE.map((entry) => entry.control));
