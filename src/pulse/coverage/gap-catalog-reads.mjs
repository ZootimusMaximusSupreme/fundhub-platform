// Exact red checks for catalog read controls that still have no safe runtime
// result probe. These rows are wired on purpose: the pulse names the missing
// proof instead of leaving the surface invisible. The checks read nothing,
// write nothing, and never turn a missing result green.

function gap(id, surface, control, finding) {
  return Object.freeze({ id, surface, control, finding });
}

export const READ_GAPS = Object.freeze([
  gap("catalog-read:affiliate-figures", "affiliate.html", "Page open: affiliate figures (REFERRED, CONVERTED, OWED, PAID tiles, referral funnel, license banner, topbar chips)", "The affiliate totals are not compared with the saved referral and payout ledgers."),
  gap("catalog-read:affiliate-portal", "affiliate.html", "Page open: own portal read (offer links, code, rate, license gate, tax gate, referral rows, payout rows)", "The whole affiliate portal result has no safe non-writing result probe."),
  gap("catalog-read:affiliate-license", "affiliate.html", "License-unsigned banner and topbar chip (display, no button)", "No live writer or checker proves the affiliate license date behind this banner."),
  gap("catalog-read:affiliate-tax", "affiliate.html", "Tax-form-missing banner (display, no button)", "No live writer or checker proves the tax-form date behind this banner."),
  gap("catalog-read:brand-compliance", "brand-studio.html", "Compliance card BS-05 (locked list, no controls)", "The locked compliance card is not checked on a rendered partner page."),
  gap("catalog-read:brand-preview", "brand-studio.html", "Live preview panel (display)", "The live preview result is not compared with the saved brand values."),
  gap("catalog-read:campaign-partners", "campaign-manager.html", "Page open: partner picker list", "The campaign partner picker is not checked against the partner read result."),
  gap("catalog-read:campaign-spend", "campaign-manager.html", "Spend vs ceilings panel (CM-03 rows, headroom, % of ceiling, flags)", "The rendered spend and ceiling result is not compared with the saved ceiling rows."),
  gap("catalog-read:campaign-books", "campaign-manager.html", "Ad performance panel (CM-09: leads, booked calls, booked rate)", "The rendered ad performance result is not compared with attribution and booking rows."),
  gap("catalog-read:campaign-list", "campaign-manager.html", "Campaign list panel (CM-04: approval state, strategy, budget, spend yesterday, ROAS, status)", "The campaign list panel has no safe rendered-result check."),
  gap("catalog-read:campaign-fatigue", "campaign-manager.html", "Creative fatigue panel (CM-06: frequency, CTR, ROAS, recommendation, label)", "The fatigue panel has no safe rendered-result check."),
  gap("catalog-read:campaign-connections", "campaign-manager.html", "Connections panel (CM-07: state, verification, token, can launch, blockers)", "The connections panel is not checked against its launch blockers."),
  gap("catalog-read:campaign-actions", "campaign-manager.html", "Action log panel (CM-08: actor, rule, reason, change, outcome, revertible)", "The action log panel has no safe rendered-result check."),
  gap("catalog-read:campaign-summary", "campaign-manager.html", "Ceiling chip and summary tiles (display)", "The ceiling chip and summary tiles are not compared with both campaign reads."),
  gap("catalog-read:portal-welcome-video", "client-portal.html", "Welcome video player (signed URL, retry once on expiry)", "The signed welcome-video link and one retry are not executed by a read-only check."),
  gap("catalog-read:portal-referral", "client-portal.html", "Refer a friend: link and counts card (display)", "The referral card is not compared with the affiliate portal result."),
  gap("catalog-read:closer-logbar", "closer-dashboard.html", "Logbar footer note (cash comes from the payment record)", "The footer note has no rendered-result check."),
  gap("catalog-read:plaid-link", "public/app/money.html", "Plaid Link script loaded from cdn.plaid.com when Connect is pressed", "No safe checker presses Connect and confirms the Plaid script loads."),
  gap("catalog-read:partner-census", "public/app/partner-galaxy.html", "Partner census line in the header (N partners on file)", "The partner census line is not checked against the partner read count."),
  gap("catalog-read:social-oauth", "social-studio.html", "OAuth return: the provider redirects to the callback, which exchanges the code and stores the encrypted account tokens", "The social callback is not checked through token exchange and saved connection result."),
  gap("catalog-read:climate-map", "read:climate/index.html#Map and national number: GET", "Map and national number: GET /api/climate paints 51 states and the national score (drawn by bundled scripts; listed from docs/journeys/climate-lead-magnet-intended.md)", "No checker counts the 51 rendered states and the national score on the live climate map."),
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
