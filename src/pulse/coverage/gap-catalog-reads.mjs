// Exact red checks for catalog read controls that still have no safe runtime
// result probe. These rows are wired on purpose: the pulse names the missing
// proof instead of leaving the surface invisible. The checks read nothing,
// write nothing, and never turn a missing result green.

function gap(id, surface, control, finding) {
  return Object.freeze({ id, surface, control, finding });
}

export const READ_GAPS = Object.freeze([
  gap("catalog-read:campaign-fatigue-label", "campaign-manager.html", "Creative fatigue panel (CM-06: frequency, CTR, ROAS, recommendation, label)", "The browser proof checks fatigue values but not the rendered label control. The full named result stays red."),
  gap("catalog-read:money-helper-poll", "public/app/money-helper.html", "Thinking... poll every 3 s (up to 100 polls) and Check again button", "The old check ran an extracted function. No real page or module result proves the 3-second poll, 100-read stop, and Check again result."),
  gap("catalog-read:money-trends", "public/app/money.html", "Trends line-graph slot (mounted from money-trends.js when the page loaded it)", "The old check only proved source wiring. No rendered browser result proves the graph shows the exact returned trend values."),
  gap("catalog-read:ops-ar", "public/app/ops-admin.html", "AR + Collections table: client, invoice INV-xxxx, amount owed, overdue, status (top 25, total line)", "The old check ran extracted page code. No real page result proves exact invoice rows, money, overdue state, top-25 limit, and total."),
  gap("catalog-read:ops-compliance", "public/app/ops-admin.html", "Compliance Gate table: messages it stopped (client, channel, reason, when; top 15)", "The old check ran extracted page code. No real page result proves the exact stopped-message rows and top-15 limit."),
  gap("catalog-read:ops-failed-events", "public/app/ops-admin.html", "Failed events tile (appended to the KPI grid: N failed events awaiting retry)", "The old check ran extracted page code. No real page result proves the returned failed-event count is rendered in the KPI grid."),
  gap("catalog-read:ops-consent", "public/app/ops-admin.html", "Staff Monitoring Consent table (Signed / Not yet signed, before names show on the Galaxy)", "The old check ran extracted page code. No real page result proves exact staff scope and signed versus not-yet-signed rows."),
  gap("catalog-read:present-send-lock", "present.html (+ present.js, contract-send.js)", "Double-press guard on every send button ('Sending...', 4 second cooldown, 'Sent at' line, count of sends)", "The old check ran an extracted guard. No real browser result proves every rendered send button locks, cools down, and shows the returned send count."),
  gap("catalog-read:teleprompter-reread", "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)", "Every 5 seconds while paused: re-reads the shoot and flushes waiting marks and edits", "The old check ran extracted timers. No real browser or module result proves the paused page re-reads and flushes exact returned marks and edits every five seconds."),
  gap("catalog-read:teleprompter-fullscreen", "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)", "Full screen on first tap (requestFullscreen)", "The old check searched or extracted the handler. No real browser result proves the first tap requests fullscreen on the rendered teleprompter."),
  gap("catalog-read:portal-welcome-video", "client-portal.html", "Welcome video player (signed URL, retry once on expiry)", "No real browser result proves the rendered player uses the returned signed URL and retries exactly once after expiry."),
  gap("catalog-read:closer-logbar", "closer-dashboard.html", "Logbar footer note (cash comes from the payment record)", "The actual page keeps the logbar hidden until a call is loaded, and no real browser result proves this footer note is shown with the returned call."),
  gap("catalog-read:plaid-link", "public/app/money.html", "Plaid Link script loaded from cdn.plaid.com when Connect is pressed", "No real browser result finds and presses a Connect control on this page and proves the Plaid script loads."),
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
    status: "NOT_PROVED",
    detail: `${item.surface}: ${item.finding}`,
    suggestedFix: `Add a safe result probe for: ${item.control} Do not auto-fix. Chris fixes reds.`,
  }));
}
