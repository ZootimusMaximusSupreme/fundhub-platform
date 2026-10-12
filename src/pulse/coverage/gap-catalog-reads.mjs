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
  gap("catalog-read:agent-staff", "agent-editor.html", "Page open: staff pickers for Owner and Escalate-to selects", "The staff picker choices are not checked against the staff read result."),
  gap("catalog-read:agent-promotion", "agent-editor.html", "Promotion gate checklist (display: trigger, prompt 60+ chars, guardrail 20+ chars, escalation)", "The promotion checklist result is not exercised as its own read-only check."),
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
  gap("catalog-read:ccp-waiting", "client-control-panel.html", "Waiting count headline (bank yes with no amount)", "The waiting headline is not checked against bank approvals with no amount."),
  gap("catalog-read:portal-contracts", "client-portal.html", "Page open: portal contracts read (Agreements tab)", "The agreements tab is not checked against the returned contract rows."),
  gap("catalog-read:portal-welcome-video", "client-portal.html", "Welcome video player (signed URL, retry once on expiry)", "The signed welcome-video link and one retry are not executed by a read-only check."),
  gap("catalog-read:portal-referral", "client-portal.html", "Refer a friend: link and counts card (display)", "The referral card is not compared with the affiliate portal result."),
  gap("catalog-read:closer-logbar", "closer-dashboard.html", "Logbar footer note (cash comes from the payment record)", "The footer note has no rendered-result check."),
  gap("catalog-read:helper-poll", "public/app/money-helper.html", "Thinking... poll every 3 s (up to 100 polls) and Check again button", "The 100-poll stop and Check again result are not executed by a checker."),
  gap("catalog-read:helper-bridge", "public/app/money-helper.html", "Helper brain: Mac bridge heartbeat / model runner (AI answers vs rules fallback)", "The helper bridge heartbeat and fallback choice are not checked together."),
  gap("catalog-read:plaid-link", "public/app/money.html", "Plaid Link script loaded from cdn.plaid.com when Connect is pressed", "No safe checker presses Connect and confirms the Plaid script loads."),
  gap("catalog-read:money-trends", "public/app/money.html", "Trends line-graph slot (mounted from money-trends.js when the page loaded it)", "The page does not load the trends module, so the graph slot has no result."),
  gap("catalog-read:offer-stack", "public/app/my-numbers.html", "Offer stack table: product, units sold, amount sold, cash collected, totals, retired product, reason when unknown", "The offer-stack library is tested, but the table paint is not checked with real result rows."),
  gap("catalog-read:my-money", "public/app/my-numbers.html", "Money boxes: Paid out, Pending funding, At risk (always a dash: not computed)", "The three money boxes are not checked against commission ledger results."),
  gap("catalog-read:my-streak", "public/app/my-numbers.html", "Streak strip (always the sentence: daily close streak is not stored yet)", "The streak strip result is not executed by a checker."),
  gap("catalog-read:ops-ar", "public/app/ops-admin.html", "AR + Collections table: client, invoice INV-xxxx, amount owed, overdue, status (top 25, total line)", "The rendered accounts-receivable table is not compared with invoice-aging results."),
  gap("catalog-read:ops-compliance", "public/app/ops-admin.html", "Compliance Gate table: messages it stopped (client, channel, reason, when; top 15)", "The blocked-message table paint is not checked with returned message rows."),
  gap("catalog-read:ops-failed-events", "public/app/ops-admin.html", "Failed events tile (appended to the KPI grid: N failed events awaiting retry)", "The failed-events tile is not checked against pending failed events."),
  gap("catalog-read:ops-consent", "public/app/ops-admin.html", "Staff Monitoring Consent table (Signed / Not yet signed, before names show on the Galaxy)", "The monitoring-consent table paint is not checked against staff results."),
  gap("catalog-read:partner-census", "public/app/partner-galaxy.html", "Partner census line in the header (N partners on file)", "The partner census line is not checked against the partner read count."),
  gap("catalog-read:payment-poll", "public/app/payment-success.html", "The bounded check: up to 6 reads, 3 seconds apart, then stops; baseline = what was already open", "The six-read entitlement poll and baseline comparison have no executable check."),
  gap("catalog-read:payment-state", "public/app/payment-success.html", "State shown: Just opened on your account / Nothing new has opened yet / Nothing is open yet / cannot check (signed out) / cannot tell which account / could not reach your account", "The payment-success states are not executed against fake entitlement results."),
  gap("catalog-read:present-send-lock", "present.html (+ present.js, contract-send.js)", "Double-press guard on every send button ('Sending...', 4 second cooldown, 'Sent at' line, count of sends)", "The present screen's own four-second send lock is not executed by a checker."),
  gap("catalog-read:social-oauth", "social-studio.html", "OAuth return: the provider redirects to the callback, which exchanges the code and stores the encrypted account tokens", "The social callback is not checked through token exchange and saved connection result."),
  gap("catalog-read:teleprompter-poll", "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)", "Every 5 seconds while paused: re-reads the shoot and flushes waiting marks and edits", "The paused five-second refresh and queued edit flush are not timed by a checker."),
  gap("catalog-read:teleprompter-fullscreen", "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)", "Full screen on first tap (requestFullscreen)", "The first-tap full-screen result is not executed by a checker."),
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
