// ONE COPY (2026-10-20). This file used to be src/repair/portal.mjs. It moved here whole, unchanged except its
// import paths, so the hourly beat client-progress runs the same progress read as GET /api/read/client-progress. A beat may import only from src/pulse/beats/lib.
// src/repair/portal.mjs re-exports everything here, so every caller imports from there as before. Change it here.
//
// Client-facing repair track labels. Honest dates. No funding story.

export const CLIENT_STAGE_COPY = Object.freeze({
  intake: { title: "Welcome — your file is being set up", detail: null },
  awaiting_documents: { title: "We need a few documents", detail: "Upload your ID and proof of address to continue." },
  analysis: { title: "We're reviewing your report", detail: null },
  letters_generated: { title: "Round 1 is being prepared", detail: null },
  ready_to_send: { title: "Round 1 is being prepared", detail: null },
  in_transit: { title: "Round sent — bureaus have 30 days", detail: "expected" },
  awaiting_response: { title: "Round sent — bureaus have 30 days", detail: "expected" },
  response_received: { title: "Responses arriving", detail: null },
  round_complete: { title: "Round complete", detail: "outcomes" },
  program_complete: { title: "Program complete", detail: "summary" },
  stalled: { title: "We're looking into a delay on your file", detail: "honest" },
  on_hold: { title: "Your file is on hold", detail: null },
  cancelled: { title: "This program was cancelled", detail: null }
});

export function clientRepairView({ stageKey, responseDueAt, isRepairOnly = true }) {
  const copy = CLIENT_STAGE_COPY[stageKey] || { title: "In progress", detail: null };
  const view = {
    stageKey,
    title: copy.title,
    expectedResponseBy: null,
    showFunding: false
  };
  if (copy.detail === "expected" && responseDueAt) {
    view.expectedResponseBy = String(responseDueAt).slice(0, 10);
    view.title = `Round sent — bureaus have 30 days. Expected response by ${view.expectedResponseBy}`;
  }
  // Never show funding story to repair-only clients
  view.showFunding = isRepairOnly ? false : false;
  return view;
}
