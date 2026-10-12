// Exact red checks for catalog read controls that still have no safe runtime
// result probe. These rows are wired on purpose: the pulse names the missing
// proof instead of leaving the surface invisible. The checks read nothing,
// write nothing, and never turn a missing result green.

function gap(id, surface, control, finding) {
  return Object.freeze({ id, surface, control, finding });
}

export const READ_GAPS = Object.freeze([
  gap("catalog-read:portal-agreements", "client-portal.html", "Page open: portal contracts read (Agreements tab)", "No real browser check feeds agreement rows through the portal read and asserts the exact pending state and signing link shown on the Agreements tab."),
  gap("catalog-read:money-helper-poll", "public/app/money-helper.html", "Thinking... poll every 3 s (up to 100 polls) and Check again button", "The old check ran an extracted function. No real page or module result proves the 3-second poll, 100-read stop, and Check again result."),
  gap("catalog-read:money-trends", "public/app/money.html", "Trends line-graph slot (mounted from money-trends.js when the page loaded it)", "The old check only proved source wiring. No rendered browser result proves the graph shows the exact returned trend values."),
  gap("catalog-read:my-offer-stack", "public/app/my-numbers.html", "Offer stack table: product, units sold, amount sold, cash collected, totals, retired product, reason when unknown", "The old check ran extracted page code. No real page result proves exact products, totals, retired rows, and unknown reasons."),
  gap("catalog-read:my-money-boxes", "public/app/my-numbers.html", "Money boxes: Paid out, Pending funding, At risk (always a dash: not computed)", "The old check ran extracted page code. No real page result proves the returned payout and pending values while At risk stays an honest dash."),
  gap("catalog-read:my-streak", "public/app/my-numbers.html", "Streak strip (always the sentence: daily close streak is not stored yet)", "The old check ran extracted page code. No real page result proves the streak refusal is what the user sees."),
  gap("catalog-read:ops-ar", "public/app/ops-admin.html", "AR + Collections table: client, invoice INV-xxxx, amount owed, overdue, status (top 25, total line)", "The old check ran extracted page code. No real page result proves exact invoice rows, money, overdue state, top-25 limit, and total."),
  gap("catalog-read:ops-compliance", "public/app/ops-admin.html", "Compliance Gate table: messages it stopped (client, channel, reason, when; top 15)", "The old check ran extracted page code. No real page result proves the exact stopped-message rows and top-15 limit."),
  gap("catalog-read:ops-failed-events", "public/app/ops-admin.html", "Failed events tile (appended to the KPI grid: N failed events awaiting retry)", "The old check ran extracted page code. No real page result proves the returned failed-event count is rendered in the KPI grid."),
  gap("catalog-read:ops-consent", "public/app/ops-admin.html", "Staff Monitoring Consent table (Signed / Not yet signed, before names show on the Galaxy)", "The old check ran extracted page code. No real page result proves exact staff scope and signed versus not-yet-signed rows."),
  gap("catalog-read:payment-bounded", "public/app/payment-success.html", "The bounded check: up to 6 reads, 3 seconds apart, then stops; baseline = what was already open", "The old check ran an extracted loop. No real page or module result proves six reads, three-second spacing, the stop, and the original baseline."),
  gap("catalog-read:payment-states", "public/app/payment-success.html", "State shown: Just opened on your account / Nothing new has opened yet / Nothing is open yet / cannot check (signed out) / cannot tell which account / could not reach your account", "The old check ran extracted page code. No real browser result proves each returned state paints the exact user-facing answer."),
  gap("catalog-read:present-send-lock", "present.html (+ present.js, contract-send.js)", "Double-press guard on every send button ('Sending...', 4 second cooldown, 'Sent at' line, count of sends)", "The old check ran an extracted guard. No real browser result proves every rendered send button locks, cools down, and shows the returned send count."),
  gap("catalog-read:teleprompter-reread", "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)", "Every 5 seconds while paused: re-reads the shoot and flushes waiting marks and edits", "The old check ran extracted timers. No real browser or module result proves the paused page re-reads and flushes exact returned marks and edits every five seconds."),
  gap("catalog-read:teleprompter-fullscreen", "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)", "Full screen on first tap (requestFullscreen)", "The old check searched or extracted the handler. No real browser result proves the first tap requests fullscreen on the rendered teleprompter."),
  gap("catalog-read:portal-welcome-video", "client-portal.html", "Welcome video player (signed URL, retry once on expiry)", "No real browser result proves the rendered player uses the returned signed URL and retries exactly once after expiry."),
  gap("catalog-read:closer-logbar", "closer-dashboard.html", "Logbar footer note (cash comes from the payment record)", "The actual page keeps the logbar hidden until a call is loaded, and no real browser result proves this footer note is shown with the returned call."),
  gap("catalog-read:plaid-link", "public/app/money.html", "Plaid Link script loaded from cdn.plaid.com when Connect is pressed", "No real browser result finds and presses a Connect control on this page and proves the Plaid script loads."),
  gap("catalog-read:partner-census", "public/app/partner-galaxy.html", "Partner census line in the header (N partners on file)", "No stable browser result proves the exact returned partner count remains in the header after the page chrome updates."),
  gap("catalog-read:social-oauth", "social-studio.html", "OAuth return: the provider redirects to the callback, which exchanges the code and stores the encrypted account tokens", "The callback has no fake transaction seam that proves code exchange plus encrypted saved tokens without writing live data."),
  gap("catalog-read:climate-map", "read:climate/index.html#Map and national number: GET", "Map and national number: GET /api/climate paints 51 states and the national score (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)", "No real browser result counts 51 rendered state shapes and compares the national score with the returned climate value."),
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
    status: "FAIL",
    detail: `${item.surface}: ${item.finding}`,
    suggestedFix: `Add a safe result probe for: ${item.control} Do not auto-fix. Chris fixes reds.`,
  }));
}
