const TEST_FILE = "src/pulse/catalog/proofs/heartbeat-catalog-red-four.test.mjs";

function display(id, surface, control) {
  return Object.freeze({
    id,
    sourceFile: "desks-e.json",
    surface,
    control,
    depth: "deep",
    evidence: TEST_FILE,
    tests: Object.freeze([TEST_FILE]),
  });
}

export const HEARTBEAT_CATALOG_RED_FOUR_DISPLAY_PROOFS = Object.freeze([
  display(
    "09900ba878d3aff9b245",
    "public/app/my-numbers.html",
    "Owed by you: unlogged calls and quiet deposits, each row a link to closer-dashboard.html?client_id=&task_id=",
  ),
  display(
    "13120425dd5806539508",
    "public/app/partner-training.html",
    "No write control exists on purpose (a partner cannot mark their own training)",
  ),
  display(
    "941299e8010b7c318b5d",
    "public/app/payment-success.html",
    "Open the page after checkout (?ref=<payment reference>&client_id=<uuid>; no sign-in needed to load)",
  ),
]);

export const HEARTBEAT_CATALOG_RED_FOUR_FLOW = Object.freeze({
  id: "d00cbba31d2f71b4516c",
  sourceFile: "journeys.json",
  surface: "journey:optimize-intended#2-book-without-form",
  control: "Book a call works with the three fields blank (opens https://apply.fundhub.ai/schedule/phonecall)",
});

export function heartbeatCatalogRedFourFlowProof(sourceFile, row) {
  if (
    String(sourceFile || "").split(/[\\/]/).at(-1) !== HEARTBEAT_CATALOG_RED_FOUR_FLOW.sourceFile
    || row?.surface !== HEARTBEAT_CATALOG_RED_FOUR_FLOW.surface
    || row?.control !== HEARTBEAT_CATALOG_RED_FOUR_FLOW.control
  ) return null;

  return Object.freeze({
    depth: "deep",
    evidence: TEST_FILE,
    runner: "real-rendered-page",
    asserts: row.control,
  });
}

export const HEARTBEAT_CATALOG_RED_FOUR_TEST_FILE = TEST_FILE;
