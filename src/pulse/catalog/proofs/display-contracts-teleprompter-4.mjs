const TEST_FILE = "src/pulse/catalog/proofs/display-contracts-teleprompter-4.test.mjs";
const SURFACE = "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)";

function proof(rowId, control, assertion) {
  return Object.freeze({
    rowId,
    key: `desks-f.json\0${SURFACE}\0${control}`,
    sourceFile: "desks-f.json",
    surface: SURFACE,
    control,
    depth: "deep",
    evidence: TEST_FILE,
    tests: Object.freeze([TEST_FILE]),
    proof: Object.freeze({
      runner: "rendered Chromium with controlled fake API routes and browser clock",
      assertion,
    }),
  });
}

export const DISPLAY_CONTRACTS_TELEPROMPTER_4 = Object.freeze([
  proof(
    "70fff6ddeb259b3ea788",
    "Every 5 seconds while paused: re-reads the shoot and flushes waiting marks and edits",
    "After the real page stays paused for five seconds, it GETs the shoot and retries the saved mark and script edit with the same request IDs; both fake successes clear their local-storage queues.",
  ),
  proof(
    "f0ea683d28259841db43",
    "Full screen on first tap (requestFullscreen)",
    "After the browser rejects the page-load full-screen attempt, clicking the real speed-up button makes its first pointer action call requestFullscreen again on the document element.",
  ),
]);

export const DISPLAY_CONTRACTS_TELEPROMPTER_4_KEYS = Object.freeze(
  DISPLAY_CONTRACTS_TELEPROMPTER_4.map((entry) => entry.key),
);

export const DISPLAY_CONTRACTS_TELEPROMPTER_4_METADATA = Object.freeze({
  sourceFiles: Object.freeze(["desks-f.json"]),
  testFile: TEST_FILE,
  provedCount: DISPLAY_CONTRACTS_TELEPROMPTER_4.length,
});
