const TEST_FILE = "src/pulse/catalog/proofs/display-contracts-shells-1.test.mjs";

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
      file: TEST_FILE,
      assertion,
    }),
  });
}

export const DISPLAY_CONTRACTS_SHELLS_1 = Object.freeze([
  contract(
    "5a63dd35f2b9b8b1c157",
    "desks-f.json",
    "link",
    "sidebar.fragment.html",
    "Logo link (to pipeline.html)",
    "Clicking the rendered sidebar logo opens the Pipeline screen, whose title and board are visible.",
  ),
  contract(
    "6802a9e547d42c92b56a",
    "desks-f.json",
    "button",
    "sidebar.fragment.html",
    "Burger button: collapse and expand the rail",
    "Clicking the rendered burger reduces the rail width and sets the mini state; clicking again restores its measured width.",
  ),
  contract(
    "caf0f13d57789c01708d",
    "desks-b.json",
    "button",
    "shell.js shared chrome (on every desk here except financeos.html)",
    "Global search button and overlay (type, results, open a client)",
    "Typing a controlled search term renders the fake client hit; clicking it opens that client's control panel with its exact id.",
  ),
  contract(
    "cf542f5b11cef42d588f",
    "desks-b.json",
    "form",
    "shell.js shared chrome (on every desk here except financeos.html)",
    "Account chip: hide (x) and 'account' show button",
    "Clicking hide removes the account bar and reveals Account; clicking Account restores the bar.",
  ),
  contract(
    "d07a8ff11c5eb739948c",
    "desks-e.json",
    "link",
    "public/app/shell.js (shared chrome on my-numbers, ops-admin, partner-galaxy, partner-training, pipeline)",
    "Sidebar group 'Sales' header (fold/unfold) and its links: pipeline.html, closer-dashboard.html, my-numbers.html, sales-floor.html, calendar.html",
    "On the rendered phone sidebar, Sales hides and restores its five links; clicking Pipeline opens the Pipeline screen.",
  ),
  contract(
    "d491b3ca48622f3d6073",
    "desks-e.json",
    "button",
    "public/app/shell.js (shared chrome on my-numbers, ops-admin, partner-galaxy, partner-training, pipeline)",
    "Menu button and scrim on a phone (opens and closes the off-canvas sidebar)",
    "At a 390px viewport, tapping Menu opens the sidebar and scrim; tapping the scrim closes both.",
  ),
]);

export const DISPLAY_CONTRACTS_SHELLS_1_ROW_KEYS = Object.freeze(
  DISPLAY_CONTRACTS_SHELLS_1.map((entry) => entry.rowKey),
);

export const DISPLAY_CONTRACTS_SHELLS_1_METADATA = Object.freeze({
  runner: "rendered Chromium with controlled local HTTP routes",
  sourceFiles: Object.freeze(["desks-b.json", "desks-e.json", "desks-f.json"]),
  testFile: TEST_FILE,
  provedCount: DISPLAY_CONTRACTS_SHELLS_1.length,
});
