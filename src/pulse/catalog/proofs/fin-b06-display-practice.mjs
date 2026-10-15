// Batch 06: four screen controls proved by a practice test (fake data, real Chromium) because the click
// leaves no saved receipt that could be wrong. The test is fin-b06-display-browser.test.mjs.
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

export const FIN_B06_DISPLAY_PROOF_CASES = Object.freeze([
  proof("desks-a.json", "client-control-panel.html", "Capital Blueprint: Bank list state buttons",
    "Done, Skipped and Put back on the list each post update_bank_todo_state with this client, the exact todo id and the chosen state, the list is read again and shows the server's state, and a refused change leaves the buttons usable."),
  proof("desks-a.json", "client-portal.html", "Sign to authorize dispute letters: legal name input",
    "An empty name is refused with nothing sent, and a typed name is trimmed and sent as granted_name exactly, then the box is cleared once the signature is saved."),
  proof("desks-a.json", "client-portal.html", "Sign to authorize dispute letters: signature pad (draw)",
    "An empty pad, a single tap and a cleared pad are all refused with nothing sent, and a drawn pad sends one signature grant for this client with the server's wording version."),
  proof("desks-b.json", "content-admin.html", "Locked tile editor: Showing/Hidden switch per tile (keyboard Space/Enter too)",
    "Click, Space and Enter each flip the switch and its Showing or Hidden badge for that tile only, and Save sends each tile's own on flag."),
]);

export const FIN_B06_DISPLAY_PRACTICE_CONTROLS = Object.freeze(FIN_B06_DISPLAY_PROOF_CASES.map((entry) => entry.control));
