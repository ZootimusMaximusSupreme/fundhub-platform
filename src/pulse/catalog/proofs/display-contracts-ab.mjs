const PROOF_FILE = "src/pulse/catalog/proofs/display-contracts-ab.test.mjs";

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

export const DISPLAY_CONTRACTS_AB = Object.freeze([
  contract("c66a9dec0593294d0aa3", "desks-a.json", "read", "affiliate.html", "Page open: affiliate figures (REFERRED, CONVERTED, OWED, PAID tiles, referral funnel, license banner, topbar chips)", "Controlled affiliate totals render as the exact four tiles and funnel values."),
  contract("fa2aa4b2f5e4654d4a53", "desks-a.json", "read", "affiliate.html", "Page open: own portal read (offer links, code, rate, license gate, tax gate, referral rows, payout rows)", "Controlled portal data renders the exact link, code, rate, gates, referral, and payout."),
  contract("1f5d200a940850f07a7a", "desks-a.json", "button", "affiliate.html", "Copy link button (one per live offer)", "Clicking each real Copy link button writes that row's exact URL to the clipboard."),
  contract("ff0c636c4295df6453f8", "desks-a.json", "button", "affiliate.html", "Copy code button", "Clicking Copy code writes the exact displayed affiliate code to the clipboard."),
  contract("a001abe8b2f5e1eeee4d", "desks-a.json", "screen", "affiliate.html", "Tab: Referred leads", "Clicking Referred leads shows its pane and hides the other panes."),
  contract("1fb40e791f5d70030492", "desks-a.json", "screen", "affiliate.html", "Tab: Payouts", "Clicking Payouts shows the exact payout row and hides the lead pane."),
  contract("a0be8585bdb0113143f0", "desks-a.json", "screen", "affiliate.html", "Tab: Terms (rate, attribution, qualifying products, payout schedule, clawback)", "Clicking Terms shows every named term with its real page copy."),
  contract("d8efa1bf6bef5f66368d", "desks-a.json", "form", "affiliate.html", "Status filter select (All, Referred, Converted, Paid, Void)", "Every real status option filters the rendered rows to that exact status and All restores all rows."),
  contract("73e3fea9589839f3a44c", "desks-a.json", "form", "affiliate.html", "Business name filter input", "Typing a business name leaves only the matching rendered referral row."),
  contract("0833ac214214e536b45a", "desks-a.json", "form", "affiliate.html", "Ask approved partner docs: Ask button / form submit", "Submitting the real form sends the exact question and renders the controlled answer."),
  contract("07613e1b9e5c4b51a874", "desks-a.json", "link", "affiliate.html", "Answer source 'Open' links (Drive webViewLink)", "The rendered Open source link carries the exact controlled Drive URL and safe new-tab attributes."),
  contract("b979ec9e4dd2a0375a5c", "desks-a.json", "button", "affiliate.html", "Download Message Blaster button", "Clicking Download fetches the real gift route and creates the exact MessageBlaster.dmg download."),
  contract("278c31c93f484cbbb117", "desks-a.json", "form", "affiliate.html", "'What you can see' details toggle", "Clicking the real details summary opens the disclosure and exposes its exact scope text."),
  contract("367dca0db64096fe33fd", "desks-a.json", "read", "affiliate.html", "License-unsigned banner and topbar chip (display, no button)", "An unsigned controlled license renders both the hold banner and unsigned topbar chip."),
  contract("7c20a9c65b6f848d0093", "desks-a.json", "read", "affiliate.html", "Tax-form-missing banner (display, no button)", "A missing controlled tax form renders the exact missing-form banner."),

  contract("a5cf5cb247838154e290", "desks-a.json", "form", "automations.html", "Rail filter select (All rails + one per category)", "The real rail select contains every controlled category, hides the others, and All restores them."),
  contract("67e44427dd688334e117", "desks-a.json", "form", "automations.html", "Workflow row expand (click or Enter: what would start this job, raw registry)", "Click and Enter both toggle the real row; the open panel shows the exact start path and raw registry."),

  contract("a306439da61f8d874841", "desks-b.json", "screen", "documents.html", "Summary tiles: total, awaiting signature, undelivered; and the 'N past 14 days' stale chip", "Controlled documents render exact total, signature, undelivered, and stale counts."),
  contract("c31881ec935f59eb86e2", "desks-b.json", "button", "documents.html", "Class cards (5: soft-pull authorizations, contracts, invoices, UnderwriteIQ deliverables, uploads): click to filter, click again to clear", "Each of the five real class cards filters to its class and a second click restores all rows."),
  contract("ff6c84f6b25d8ae11f1e", "desks-b.json", "screen", "documents.html", "Class tabs (All plus the 5 classes)", "All six real tabs select the named class and render only matching rows."),
  contract("7ff204cc904bd0ed6a36", "desks-b.json", "form", "documents.html", "'Pending only' toggle button", "The real toggle changes its label, shows only pending rows, and restores all rows."),
  contract("5814c91b4914edd649e1", "desks-b.json", "form", "documents.html", "Filter box (client or document name)", "Typing a client or document name leaves only the exact matching document."),
  contract("9333c8402151aa97ec49", "desks-b.json", "button", "documents.html", "Column header sort (7 sortable columns)", "Every real sortable header changes to its own descending sort and then ascending sort."),
  contract("c439c8e2e1aeeec25347", "desks-b.json", "screen", "documents.html", "Document table rows: generated / delivered / signature badges and age pending", "Controlled rows render the exact generated, delivery, signature, and pending-age badges."),
  contract("607570c414ad961bd536", "desks-b.json", "button", "documents.html", "Download button on a document row (mints a 15-minute signed link, opens a new tab)", "Clicking Download asks for that document, receives the controlled signed link, and opens only that link."),
  contract("136cf9c3bf4ad280959d", "desks-b.json", "screen", "documents.html", "Contract cell: status badge (draft, sent, opened, signed, void)", "Five controlled contracts render the five exact status badges."),
  contract("dff43b6cc64f22d8b6e6", "desks-b.json", "button", "documents.html", "Contract cell: Open PDF button (signed copy when one exists)", "Clicking Open PDF asks for the signed copy when present and creates the controlled PDF download."),
  contract("9422417593e9985f46c7", "desks-b.json", "button", "documents.html", "Contract cell: Remind button (re-sends the signing request to one signer)", "Clicking Remind sends the exact contract id and displays the fake handler's exact saved result."),
  contract("f4462036525dee4be15b", "desks-b.json", "button", "documents.html", "Contract cell: Void button (asks for a reason in a prompt; owner/admin only)", "Void collects the exact reason, sends it with the exact contract id, and displays the fake handler's exact saved result."),
  contract("a0f7a318f0d6c2879e0b", "desks-b.json", "screen", "documents.html", "Role lookup that decides whether Void is drawn", "The real session lookup draws Void for owner and withholds it from closer."),
]);

export const DISPLAY_CONTRACT_KEYS_AB = Object.freeze(
  DISPLAY_CONTRACTS_AB.map((entry) => entry.rowKey),
);

export const DISPLAY_CONTRACT_PROOF_AB = Object.freeze({
  shard: "Display AB",
  sourceFiles: Object.freeze(["desks-a.json", "desks-b.json"]),
  runner: "rendered-chromium-local-fake-routes",
  testFile: PROOF_FILE,
  rowKeys: DISPLAY_CONTRACT_KEYS_AB,
  strictProvedCount: DISPLAY_CONTRACT_KEYS_AB.length,
});
