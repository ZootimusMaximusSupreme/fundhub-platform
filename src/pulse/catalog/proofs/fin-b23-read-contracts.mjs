// fin-b23 (finish the 853, batch 23, read rows): thirteen page-read rows that the
// catalog read lane listed as not proved. Each one now has a practice test that
// opens the real page (or calls the real handler) with fake data and judges the
// exact rendered result, and that test was broken on purpose and went red.
// The entries sit in the proved list of read-proof-cases.mjs; the matching red
// entries were removed from READ_GAPS in gap-catalog-reads.mjs. The climate row
// is measured separately by workflow H because it needs a shipped-page GET,
// while the repaired Present send lock is now proved by its rendered test.

import { sourceFileForReadSurface } from "../../coverage/gap-catalog-reads.mjs";

function proved(surface, control, testFile) {
  const test = `src/pulse/catalog/proofs/${testFile}`;
  return Object.freeze({
    sourceFile: sourceFileForReadSurface(surface),
    surface,
    control,
    depth: "deep",
    evidence: test,
    tests: Object.freeze([test]),
  });
}

export const FIN_B23_READ_PROVED = Object.freeze([
  proved("present.html (+ present.js, contract-send.js)",
    "Double-press guard on every send button ('Sending...', 4 second cooldown, 'Sent at' line, count of sends)",
    "fin-b23-present-send-lock.test.mjs"),
  proved("campaign-manager.html",
    "Creative fatigue panel (CM-06: frequency, CTR, ROAS, recommendation, label)",
    "fin-b23-campaign-fatigue-label.test.mjs"),
  proved("public/app/money-helper.html",
    "Thinking... poll every 3 s (up to 100 polls) and Check again button",
    "fin-b23-money-helper-poll.test.mjs"),
  proved("public/app/money.html",
    "Trends line-graph slot (mounted from money-trends.js when the page loaded it)",
    "fin-b23-money-page.test.mjs"),
  proved("public/app/ops-admin.html",
    "AR + Collections table: client, invoice INV-xxxx, amount owed, overdue, status (top 25, total line)",
    "fin-b23-ops-admin.test.mjs"),
  proved("public/app/ops-admin.html",
    "Compliance Gate table: messages it stopped (client, channel, reason, when; top 15)",
    "fin-b23-ops-admin.test.mjs"),
  proved("public/app/ops-admin.html",
    "Failed events tile (appended to the KPI grid: N failed events awaiting retry)",
    "fin-b23-ops-admin.test.mjs"),
  proved("public/app/ops-admin.html",
    "Staff Monitoring Consent table (Signed / Not yet signed, before names show on the Galaxy)",
    "fin-b23-ops-admin.test.mjs"),
  proved("teleprompter.html (+ teleprompter.js, teleprompter-edits.js)",
    "Every 5 seconds while paused: re-reads the shoot and flushes waiting marks and edits",
    "fin-b23-teleprompter.test.mjs"),
  proved("teleprompter.html (+ teleprompter.js, teleprompter-edits.js)",
    "Full screen on first tap (requestFullscreen)",
    "fin-b23-teleprompter.test.mjs"),
  proved("client-portal.html",
    "Welcome video player (signed URL, retry once on expiry)",
    "fin-b23-portal-welcome-video.test.mjs"),
  proved("closer-dashboard.html",
    "Logbar footer note (cash comes from the payment record)",
    "fin-b23-closer-logbar.test.mjs"),
  proved("public/app/money.html",
    "Plaid Link script loaded from cdn.plaid.com when Connect is pressed",
    "fin-b23-money-page.test.mjs"),
  proved("social-studio.html",
    "OAuth return: the provider redirects to the callback, which exchanges the code and stores the encrypted account tokens",
    "fin-b23-social-oauth.test.mjs"),
]);
