const TEST_FILE = "src/pulse/catalog/proofs/display-contracts-money-2.test.mjs";

function proof(rowId, surface, control, assertion) {
  return Object.freeze({
    rowId,
    key: `desks-d.json\0${surface}\0${control}`,
    sourceFile: "desks-d.json",
    surface,
    control,
    depth: "deep",
    evidence: TEST_FILE,
    tests: Object.freeze([TEST_FILE]),
    proof: Object.freeze({
      runner: "local Chromium with controlled fake API routes",
      assertion,
    }),
  });
}

const CONNECTIONS = "public/app/money-connections.html";
const PLAN = "public/app/money-plan.html";

export const DISPLAY_CONTRACTS_MONEY_2_PROOFS = Object.freeze([
  proof("c546a8636bd471dd6858", CONNECTIONS, "'Which business is this for?' select (one per provider)",
    "Choosing the personal business and webhook mode, then connecting Whop, posts those exact values and renders its returned connection."),
  proof("3bf7b97f2f42c2bfd144", CONNECTIONS, "'How should sales come in?' select (API key or webhook; Commas, Whop only)",
    "Choosing webhook mode for Whop sends mode=push in the captured create request and the fake connection appears on the page."),
  proof("fa664be83b590e87902b", CONNECTIONS, "One-time API key reveal box (shown only right after create)",
    "Creating Open API renders the exact fake one-time key; after a reload the key is absent."),
  proof("d79d5d37332e42763743", CONNECTIONS, "Copy key / Copy address buttons (key reveal, webhook address, open API address)",
    "Clicking Copy key writes the exact one-time key to the fake clipboard and changes the button to Copied."),
  proof("c3861b59f0ef9fcab1c5", CONNECTIONS, "Signing-secret password box + Save secret (push mode, Commas/Whop)",
    "Saving the entered webhook secret posts the exact secret to the fake API and rerenders the connection as having a saved secret."),
  proof("675db71c7a998943ff8b", CONNECTIONS, "API-key password box + Save key (pull mode, Commas/Whop)",
    "Saving a pull key posts the exact key, clears the password field, and renders the saved key hint and sync result."),
  proof("563bb412a2e63ec80aee", CONNECTIONS, "Sync now",
    "Clicking Sync now posts the selected connection id and renders the exact number of new items returned by the fake sync."),
  proof("6e4c7ebf97ae151bb41c", CONNECTIONS, "Turn off (confirm dialog)",
    "Accepting the confirmation posts disable for the selected connection and removes that connection from the rendered page."),
  proof("32c5ba0fc2a29391364c", CONNECTIONS, "Error state with Try again",
    "After a failed fake read, clicking Try again makes a second read and replaces the error with the returned connection."),
  proof("5e878cbd820f820fd085", PLAN, "Month bar: Previous month / Today / Next month",
    "Clicking the rendered previous-month button requests month=2026-09 and paints September 2026."),
  proof("c25686f3938ca301aef0", PLAN, "+N more (day with more pins than a cell shows)",
    "Clicking +N more moves focus to that date's heading in the day list."),
  proof("757681c1707df30494c7", PLAN, "Detail panel: Close button and click outside the panel",
    "Opening a pin and clicking the scrim closes its detail panel and returns focus to the pin."),
  proof("87dc5b4510a424eee845", PLAN, "Detail panel: Esc to close and Tab focus trap; focus returns to the pin",
    "Escape closes the panel and restores pin focus; Tab from its last control wraps to Close."),
  proof("b185e4afc2e9e60ba79b", PLAN, "Staff only: Mark missed",
    "Confirming Mark missed posts the exact source, pin id, status, and client id, then renders the returned Missed status."),
  proof("f078023c488518743bd3", PLAN, "'Part of your plan did not load' banner + Try again",
    "Clicking Try again repeats the plan read and removes the partial-load banner when the fake source recovers."),
  proof("4bcc7ba7f95fbf6b9fba", PLAN, "Error state with Try again",
    "Clicking Try again after a failed plan read requests the month again and renders its returned calendar."),
]);

export const DISPLAY_CONTRACTS_MONEY_2_PROOF_KEYS = Object.freeze(
  DISPLAY_CONTRACTS_MONEY_2_PROOFS.map((entry) => entry.key),
);

export const DISPLAY_CONTRACTS_MONEY_2_METADATA = Object.freeze({
  shard: "Money 2",
  sourceFiles: Object.freeze(["desks-d.json"]),
  test: TEST_FILE,
  runner: "rendered Chromium pages on a local static server with controlled fake API routes",
  provedCount: DISPLAY_CONTRACTS_MONEY_2_PROOFS.length,
});
