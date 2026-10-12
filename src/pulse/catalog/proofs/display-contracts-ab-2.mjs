const PROOF_FILE = "src/pulse/catalog/proofs/display-contracts-ab-2.test.mjs";

function contract(rowKey, sourceFile, family, surface, expected, assertion) {
  return Object.freeze({
    rowKey,
    sourceFile,
    family,
    surface,
    expected,
    proof: Object.freeze({
      depth: "deep",
      runner: "rendered-chromium-local-fake-routes",
      file: PROOF_FILE,
      assertion,
    }),
  });
}

export const DISPLAY_CONTRACTS_AB_2 = Object.freeze([
  contract("4d12368cea0a78aa0c1c", "desks-a.json", "screen", "calendar.html", "Day / Week segmented control", "Clicking Day and Week changes the selected control and the exact visible calendar layout."),
  contract("e0c696df527234ed4445", "desks-a.json", "button", "calendar.html", "Previous day / week (‹) button", "Clicking previous changes the visible date label to the prior day."),
  contract("fb3288400b58afe9a2a7", "desks-a.json", "button", "calendar.html", "Next day / week (›) button", "Clicking next changes the visible date label to the next day."),
  contract("afcbad154a518b996956", "desks-a.json", "button", "calendar.html", "Today button", "After moving away, Today restores the exact current date label."),
  contract("9db73c95f6ef74d1056f", "desks-a.json", "button", "calendar.html", "Week strip day picker (7 days, click or Enter)", "Click and Enter each select the named day and update the exact date label."),
  contract("02b958d5557d989d6909", "desks-a.json", "button", "calendar.html", "Then row (click to load into Up Next)", "Clicking a real Then row paints that task's exact client and title into Up Next."),
  contract("eb892327ba6a36cb6095", "desks-a.json", "button", "calendar.html", "Timeline event block (click to select)", "Clicking a real event paints that event's exact client and title into Up Next."),
  contract("c43aad9d556ea0cdf41d", "desks-a.json", "button", "calendar.html", "Join Call button (opens meeting_url in new tab)", "Clicking Join Call opens only the selected task's exact meeting URL in a new tab."),
  contract("16cef6d737cc3240b14e", "desks-a.json", "button", "calendar.html", "Client file button (opens client-control-panel.html?client_id=)", "Clicking Client file navigates to the selected task's exact client id."),
  contract("929e0d15e8773d927beb", "desks-a.json", "button", "calendar.html", "Claim button (timeline rows and No-date rail)", "Clicking Claim sends the exact task id and paints the saved claimed result on that row."),
  contract("51fe3c0c37adc391a629", "desks-a.json", "button", "calendar.html", "Mark done button (timeline rows and No-date rail)", "Clicking Mark done sends the exact task id and paints the saved done result on that row."),

  contract("e35991c7648a732cdf41", "desks-b.json", "screen", "consent-capture.html", "Page itself loads with ?client_id= (and ?kind=)", "The real page reads the selected client and kind, then renders the exact disclosure, status, and history result."),
  contract("4f5d8c3f202e9cd9ac0b", "desks-b.json", "button", "consent-capture.html", "Record consent: soft_pull_consent (the key to a paid credit pull)", "Submitting the real soft-pull form sends the exact typed consent and renders the saved success result."),
  contract("b73d673411ce85020d1f", "desks-b.json", "button", "consent-capture.html", "Record consent: dispute_authorization (signature; lets letters be prepared)", "Drawing and submitting the real signature sends the exact dispute authorization and renders the saved success result."),

  contract("4d92dce676f2ef993d12", "desks-b.json", "screen", "csm-queue.html", "Page itself loads: 'My queue' for the client success role", "The real client-success page renders its My queue heading for a client-success session."),
  contract("003ed51f8fa7b5b11f91", "desks-b.json", "screen", "csm-queue.html", "Queue list: one card per waiting call (client, call title, due time, late chip, balance owed chip, owned products)", "Controlled queue data renders the exact client, call, late state, balance, and owned product on one card."),
  contract("7b7aeae221ad2f85b0b0", "desks-b.json", "screen", "csm-queue.html", "Headline count 'N calls waiting' and 'N calls past due' line", "Controlled queue data renders the exact waiting and past-due totals."),
  contract("2ead117ce3b553db2e51", "desks-b.json", "button", "csm-queue.html", "Start shift / End shift button", "The real shift button sends clock-in and clock-out, then renders the exact saved state each time."),
  contract("adf17b6aacab0676adcf", "desks-b.json", "button", "csm-queue.html", "Claim this call button", "Clicking Claim sends the exact task id and replaces the button with the claimed-by-you result."),
  contract("461d319d0017e27d6de8", "desks-b.json", "button", "csm-queue.html", "Write down their answers button (opens the interview form; 'Hide answers' closes it)", "The real button opens the controlled question bank and the same control closes it."),
  contract("0f2ec7314a4b905f1a1d", "desks-b.json", "link", "csm-queue.html", "Client name link (to Client Control Panel) and the footer / empty-state links", "The rendered client name carries its exact client id and the empty-state link points to Control Panel."),
  contract("3c1d183c7bb4a2d992d2", "desks-b.json", "link", "csm-queue.html", "Booking link button (when the task carries a meeting url)", "The rendered Booking link carries the exact controlled meeting URL and safe new-tab attributes."),

  contract("92b75621fe986f1fcbcf", "desks-b.json", "screen", "content-admin.html", "Page itself loads; reads tiles, welcome videos, tier map and products", "The real page renders the controlled video, product tier, mapping, and locked tile from the content read."),
  contract("8d0c57563986749bfda1", "desks-b.json", "screen", "content-admin.html", "Summary tiles: videos in library, tiers mapped, locked tiles on, last upload", "Controlled content renders the exact video, mapped-tier, live-tile, and upload-date summary values."),
  contract("f9480d08240a1cd71fa2", "desks-b.json", "button", "content-admin.html", "Preview: tier switch buttons and the client-portal preview (not live)", "Clicking real tier switches renders the exact mapped video, fallback note, and locked portal tile for each tier."),
]);

export const DISPLAY_CONTRACT_KEYS_AB_2 = Object.freeze(
  DISPLAY_CONTRACTS_AB_2.map((entry) => entry.rowKey),
);

export const DISPLAY_CONTRACT_PROOF_AB_2 = Object.freeze({
  shard: "Display AB 2",
  sourceFiles: Object.freeze(["desks-a.json", "desks-b.json"]),
  runner: "rendered-chromium-local-fake-routes",
  testFile: PROOF_FILE,
  rowKeys: DISPLAY_CONTRACT_KEYS_AB_2,
  strictProvedCount: DISPLAY_CONTRACT_KEYS_AB_2.length,
});
