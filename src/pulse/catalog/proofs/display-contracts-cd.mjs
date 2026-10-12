const TEST_FILE = "src/pulse/catalog/proofs/display-contracts-cd.test.mjs";

function proof(rowId, sourceFile, surface, control, assertion, depth = "e2e") {
  return Object.freeze({
    rowId,
    key: `${sourceFile}\0${surface}\0${control}`,
    sourceFile,
    surface,
    control,
    depth,
    evidence: TEST_FILE,
    tests: Object.freeze([TEST_FILE]),
    proof: Object.freeze({
      runner: "local Chromium with controlled fake API routes",
      assertion,
    }),
  });
}

const STRATEGY = "public/app/money-strategy.html";
const SIGNED_OUT = "Signed-out redirect (read answers 401)";

export const DISPLAY_CONTRACTS_CD_PROOFS = Object.freeze([
  proof(
    "3c8a3638ccb9fed1e730",
    "desks-c.json",
    "index.html",
    "Page entry: forwards each signed-in role to its own home desk (shell.js HOME map); no on-page controls",
    "The real app entry reads each controlled role session and lands on that role's exact rendered home page.",
  ),
  proof(
    "9581343e55d47fd676e6",
    "desks-c.json",
    "shell.js (shared chrome on every staff desk)",
    "Sign out button",
    "A real click posts to logout, clears the saved session values, and lands on the staff sign-in page.",
  ),
  proof(
    "4e4a254a9ab1fc28b599",
    "desks-c.json",
    "shell.js (shared chrome on every staff desk)",
    "Top bar chip: hide button and the small show pill",
    "Real hide and show clicks swap the rendered account bar and restore pill and save the exact local state.",
  ),
  proof(
    "a0c63ee4bf98e4fb8d05",
    "desks-c.json",
    "shell.js (shared chrome on every staff desk)",
    "Brand paint (reads /api/org-brand, colours the chrome)",
    "The real brand read paints the exact ink, paper, spectrum, accent, fonts, wordmark, and entity on rendered chrome.",
  ),
  proof(
    "13b45cf2a27cc1c063bd",
    "desks-d.json",
    STRATEGY,
    "Page shell (loads money-strategy.js/css)",
    "The real page loads its stylesheet and script and renders the strategy controls inside the shell.",
  ),
  proof(
    "5d4a9bf5968279f9f2b9",
    "desks-d.json",
    STRATEGY,
    "Money nav bar (Money, Accounts, Credit, Connections, Payments, Setup, Strategy)",
    "The rendered client and staff navs contain the exact seven destinations and keep Strategy current.",
  ),
  proof(
    "15a968e951b4709d966a",
    "desks-d.json",
    STRATEGY,
    "Back to my portal / Back to Finance OS (staff)",
    "The client page points to the portal and the staff page points back to the exact selected client in Finance OS.",
  ),
  proof(
    "869f8a7966cfafbdc5d2",
    "desks-d.json",
    STRATEGY,
    "Sample data banner (shown when the read says Plaid sandbox)",
    "A sandbox=true strategy read reveals the exact sample-data warning in the rendered page.",
  ),
  proof(
    "bc5533e1b9b49389a6c3",
    "desks-d.json",
    STRATEGY,
    "Strategy read on page load",
    "The real page performs the exact strategy GET and paints the controlled client's name and debt data.",
  ),
  proof(
    "bf16ef3e7ca991a2c3c9",
    "desks-d.json",
    STRATEGY,
    "Slider and amount box: money toward debt each month (recomputes the plan live)",
    "Changing the real amount box updates the range and recomputes the exact rendered plan result.",
  ),
  proof(
    "7b6e890740abd1287782",
    "desks-d.json",
    STRATEGY,
    "How extra money is used: Highest rate first / Card use first / Smallest balance first",
    "Clicking each real method changes pressed state and the first debt in the rendered payoff order.",
  ),
  proof(
    "41dbaa240149eb3e2485",
    "desks-d.json",
    STRATEGY,
    "Goal select (No goal / Debt-free by / Card use under 30% by / under 10% by) and goal date",
    "The real goal controls expose all four choices and paint the exact dated goal result.",
  ),
  proof(
    "35a34f62c9a8edc57c67",
    "desks-d.json",
    STRATEGY,
    "Use $X buttons (goal need, safe cash maximum, minimums, after a refused save)",
    "Real Use buttons for all four named cases put their exact cents into the amount control.",
  ),
  proof(
    "6a59c13d490c9b662788",
    "desks-d.json",
    STRATEGY,
    "Save this plan",
    "A real Save click sends the exact choices to the fake route and paints the saved result returned by it.",
    "deep",
  ),
  proof(
    "733b98d26085426a411b",
    "desks-d.json",
    STRATEGY,
    "Four tiles: Debt-free by / Interest saved vs minimums / Card use / Cash this month",
    "The four rendered tiles contain the exact computed date, missing-interest state, utilization, and cash result.",
  ),
  proof(
    "87aa73d872e6976dfdd9",
    "desks-d.json",
    STRATEGY,
    "Debts table (order the plan pays them, balance, APR, minimum, paid off by, interest) + missing-data warnings",
    "The rendered debt rows and warnings match the controlled balances, rates, minimums, dates, and missing fields.",
  ),
  proof(
    "10ad36c6cab098cd6e7a",
    "desks-d.json",
    STRATEGY,
    "Card use month-by-month chart + legend (30% and 10% lines)",
    "The real chart renders the exact utilization summary plus both named target lines and card legend.",
  ),
  proof(
    "3ee6d8a7f002f963042f",
    "desks-d.json",
    STRATEGY,
    "Month by month expander + Show N more months",
    "Opening and clicking the real month controls grows the rendered rows from 24 to the exact full count.",
  ),
  proof(
    "0bb3c43986f79ff3c43c",
    "desks-d.json",
    STRATEGY,
    "How the cash check works / How this is worked out expanders (staff see sources)",
    "A staff render shows both real explainers, exact controlled cash facts, and the staff-only source list.",
  ),
  proof(
    "981cd985eef64fd7777c",
    "desks-d.json",
    STRATEGY,
    "Empty state (no card or loan with a balance): Add an account link",
    "A real empty read paints the exact empty words and Add an account destination.",
  ),
  proof(
    "fc73468e11daaf980755",
    "desks-d.json",
    STRATEGY,
    "Less-than-minimums / no-amount notice",
    "A controlled below-minimum amount paints the exact minimum refusal and recovery amount.",
  ),
  proof(
    "e3bd83041fbea9dd5554",
    "desks-d.json",
    STRATEGY,
    "Loading and error states with Try again (incl. 'math did not load')",
    "A delayed real read shows loading, a failed read shows the exact error, and Try again paints the recovered plan.",
  ),
  ...[
    ["c1e8faa0d578f35b684d", "public/app/money-connections.html"],
    ["f329c67fb2552ce8a111", "public/app/money-credit.html"],
    ["2a1a96a84877f1db2d65", "public/app/money-declines.html"],
    ["33774d9008eee1e1e9fb", "public/app/money-fundability.html"],
    ["d78a0d07fd422615bc85", "public/app/money-helper.html"],
    ["4dff993f6ec2982049d4", "public/app/money-next.html"],
    ["d29c50e1921da1d4c716", "public/app/money-payments.html"],
    ["5f5b6dd82d731f3d8726", "public/app/money-plan.html"],
    ["121a38baf42f661b8ab2", "public/app/money-setup.html"],
    ["7f5b4361c0e0f4dd3139", STRATEGY],
  ].map(([rowId, surface]) => proof(
    rowId,
    "desks-d.json",
    surface,
    SIGNED_OUT,
    `The real ${surface} data read receives 401 and lands exactly on the client portal sign-in page.`,
  )),
]);

export const DISPLAY_CONTRACTS_CD_PROOF_KEYS = Object.freeze(
  DISPLAY_CONTRACTS_CD_PROOFS.map((entry) => entry.key),
);

export const DISPLAY_CONTRACTS_CD_METADATA = Object.freeze({
  shard: "Display CD",
  sourceFiles: Object.freeze(["desks-c.json", "desks-d.json"]),
  test: TEST_FILE,
  runner: "rendered Chromium pages on a local static server with controlled fake API routes",
  provedCount: DISPLAY_CONTRACTS_CD_PROOFS.length,
  baselineRedCount: 414,
  honestLeftoverCount: 382,
});
