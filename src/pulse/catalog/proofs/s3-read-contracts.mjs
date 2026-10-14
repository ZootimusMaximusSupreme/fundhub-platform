// Slice S3 (read rows): twelve rows the lane still listed as red although a
// real-browser result test now proves them. Each entry names the focused test
// that opens the real page with controlled returned data and judges the exact
// rendered result. They sit in the proved list of read-proof-cases.mjs; the
// matching red entries were removed from READ_GAPS in gap-catalog-reads.mjs.

function proved(sourceFile, surface, control, test) {
  return Object.freeze({
    sourceFile,
    surface,
    control,
    depth: "deep",
    evidence: test,
    tests: Object.freeze([test]),
  });
}

export const S3_READ_PROVED = Object.freeze([
  proved("desks-a.json", "agent-editor.html", "Page open: staff pickers for Owner and Escalate-to selects",
    "src/pulse/catalog/proofs/flow-read-contracts.test.mjs"),
  proved("desks-a.json", "agent-editor.html", "Promotion gate checklist (display: trigger, prompt 60+ chars, guardrail 20+ chars, escalation)",
    "src/pulse/catalog/proofs/flow-read-contracts.test.mjs"),
  proved("desks-a.json", "affiliate.html", "License-unsigned banner and topbar chip (display, no button)",
    "src/pulse/catalog/proofs/flow-read-contracts.test.mjs"),
  proved("desks-a.json", "affiliate.html", "Tax-form-missing banner (display, no button)",
    "src/pulse/catalog/proofs/display-contracts-ab.test.mjs"),
  proved("desks-a.json", "campaign-manager.html", "Connections panel (CM-07: state, verification, token, can launch, blockers)",
    "src/pulse/catalog/proofs/flow-read-contracts.test.mjs"),
  proved("desks-a.json", "client-portal.html", "Page open: portal contracts read (Agreements tab)",
    "src/pulse/catalog/proofs/flow-read-contracts.test.mjs"),
  proved("desks-e.json", "public/app/my-numbers.html", "Offer stack table: product, units sold, amount sold, cash collected, totals, retired product, reason when unknown",
    "src/pulse/catalog/proofs/flow-read-contracts.test.mjs"),
  proved("desks-e.json", "public/app/my-numbers.html", "Money boxes: Paid out, Pending funding, At risk (always a dash: not computed)",
    "src/pulse/catalog/proofs/flow-read-contracts.test.mjs"),
  proved("desks-e.json", "public/app/my-numbers.html", "Streak strip (always the sentence: daily close streak is not stored yet)",
    "src/pulse/catalog/proofs/flow-read-contracts.test.mjs"),
  proved("desks-e.json", "public/app/payment-success.html", "The bounded check: up to 6 reads, 3 seconds apart, then stops; baseline = what was already open",
    "src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs"),
  proved("desks-e.json", "public/app/payment-success.html", "State shown: Just opened on your account / Nothing new has opened yet / Nothing is open yet / cannot check (signed out) / cannot tell which account / could not reach your account",
    "src/pulse/catalog/proofs/display-contracts-ef-public.test.mjs"),
  proved("desks-e.json", "public/app/partner-galaxy.html", "Partner census line in the header (N partners on file)",
    "src/pulse/catalog/proofs/flow-read-contracts.test.mjs"),
]);
