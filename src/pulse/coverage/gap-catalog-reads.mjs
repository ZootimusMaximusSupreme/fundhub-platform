// Exact red checks for catalog read controls that still have no safe runtime
// result probe. These rows are wired on purpose: the pulse names the missing
// proof instead of leaving the surface invisible. The checks read nothing,
// write nothing, and never turn a missing result green.

function gap(id, surface, control, finding) {
  return Object.freeze({ id, surface, control, finding });
}

export const READ_GAPS = Object.freeze([
  gap("catalog-read:present-send-lock", "present.html (+ present.js, contract-send.js)", "Double-press guard on every send button ('Sending...', 4 second cooldown, 'Sent at' line, count of sends)", "The page has six send controls. Four are proved by a rendered test (fin-b23-present-send-lock.test.mjs): Send agreement + pay link, Invoice this client, Send contract and Send letters now lock while sending, hold for the 4 second cooldown, show Sent at and count repeats. Two do not meet the contract. (1) Generate letters and email now: present.js fire() reads `delivered` and `reason` off the object public/app/data.js write() returns, where the server answer sits under `data`, so a delivered pack is shown as \"Nothing was sent\", gets no Sent at line and no cooldown. (2) Send soft pull: it is drawn with ckBtn, not sendBtn, so it never shows Sending..., Sent at or a count (only the refusal of a repeat press works). Both need a present.js change before this row can be proved."),
  gap("catalog-read:climate-map", "read:climate/index.html#Map and national number: GET", "Map and national number: GET /api/climate paints 51 states and the national score (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)", "The shipped climate page draws only the 5 state shapes in its bundled path list (AZ, CA, NY, TX, FL), not 51. Its States table lists every returned state and its national number equals the returned score (fin-b23-climate-map.test.mjs). The 51 state paths have to be bundled into the page before \"paints 51 states\" can be proved."),
]);

export const CHECK_IDS = Object.freeze(READ_GAPS.map((item) => item.id));

export function sourceFileForReadSurface(surface) {
  if (surface === "read:climate/index.html#Map and national number: GET") return "public-pages.json";
  if (surface.startsWith("public/app/money-helper")) return "desks-d.json";
  if (surface.startsWith("public/app/") || surface === "payment-success.html") return "desks-e.json";
  if (surface.startsWith("present.html") || surface === "social-studio.html" || surface.startsWith("teleprompter.html")) return "desks-f.json";
  return "desks-a.json";
}

export async function gapChecks() {
  return READ_GAPS.map((item) => ({
    id: item.id,
    status: "NOT_PROVED",
    detail: `${item.surface}: ${item.finding}`,
    suggestedFix: `Add a safe result probe for: ${item.control} Do not auto-fix. Chris fixes reds.`,
  }));
}
