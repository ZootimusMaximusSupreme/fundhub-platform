// Live desk pages for the 7:00 a.m. pulse. Report only. Never auto-fix.
// A GET desk is red when its morning ping is missing from PULSE_REGISTRY.
// Scoped to routed employee/client desks: pipeline, funding, portal,
// contracts, hiring, and FinanceOS money tabs.
//
// No repo files are read at run time (CLAUDE.md section 12). The desk lists
// below are a copy of what public/app/shell.js says, made at build time. The
// test slice-23-pages.test.mjs reads shell.js and the folder and fails the
// moment either list drifts, so the copy cannot go stale unseen.

import { coverageKey, PULSE_REGISTRY } from "../registry.mjs";

export const SLICE_ID = "23-pages";

const SCHEDULE = "daily";

/** `var ALL = [...]` in public/app/shell.js: every desk the shell guards. */
export const SHELL_ALL = Object.freeze([
  "closer-dashboard.html", "my-numbers.html", "sales-floor.html", "pipeline.html",
  "client-control-panel.html", "messaging.html", "calendar.html", "documents.html",
  "company-brain.html", "ops-admin.html", "galaxy.html", "agent-editor.html",
  "automations.html", "products-commissions.html", "staff-teams.html", "csm-queue.html",
  "inquiry-remover.html", "affiliate.html", "client-portal.html", "partner-galaxy.html",
  "brand-studio.html", "partner-training.html", "campaign-manager.html", "social-studio.html",
  "creative-factory.html", "hiring.html", "marketing-command-center.html", "finance-os.html",
  "journeys.html", "contracts.html", "lenders.html", "content-admin.html", "consent-capture.html"
]);

/** `var STAFF_MONEY = [...]` in public/app/shell.js: the FinanceOS money tabs. */
export const SHELL_STAFF_MONEY = Object.freeze([
  "financeos.html", "money.html", "money-accounts.html", "money-credit.html",
  "money-connections.html", "money-payments.html", "money-setup.html", "money-plan.html",
  "money-banks.html", "money-strategy.html", "money-fundability.html", "money-next.html",
  "money-helper.html", "money-transfers.html", "money-declines.html", "money-alerts.html",
  "money-vault.html"
]);

/** The desks listed under each `data-fh-section` group of the shell sidebar. */
export const SIDEBAR_SECTION_DESKS = Object.freeze({
  sales: Object.freeze([
    "pipeline.html", "closer-dashboard.html", "my-numbers.html", "sales-floor.html", "calendar.html"
  ]),
  funding: Object.freeze(["lenders.html", "client-control-panel.html", "finance-os.html"]),
  portals: Object.freeze(["client-portal.html", "affiliate.html"])
});

const ALL = new Set(SHELL_ALL);
const STAFF_MONEY = [...SHELL_STAFF_MONEY];

/** Shell-guarded desks only — not orphan HTML on disk. */
export function isRoutedDesk(file) {
  return ALL.has(file) || STAFF_MONEY.includes(file);
}

/** Routed desks in the six pulse page lanes (deduped, sorted). */
export function scopedRoutedDesks() {
  const files = new Set([
    ...SIDEBAR_SECTION_DESKS.sales,
    ...SIDEBAR_SECTION_DESKS.funding,
    ...SIDEBAR_SECTION_DESKS.portals,
    "contracts.html",
    "hiring.html",
    ...STAFF_MONEY
  ]);
  return [...files].filter(isRoutedDesk).sort();
}

function defaultListed() {
  return new Set(PULSE_REGISTRY.map((row) => coverageKey(row)));
}

function deskRow(file, listed) {
  const alreadyInRegistry = listed.has(file);
  const slug = file.replace(/\.html$/, "");
  return {
    id: slug,
    file,
    schedule: SCHEDULE,
    redAfter: `3x ${SCHEDULE}`,
    alreadyInRegistry,
    proof: alreadyInRegistry
      ? "PASS"
      : `Add ${file} to DESK_FILES in src/pulse/registry.mjs (same change as the screen). Do not auto-fix from this pulse.`
  };
}

/** Missing routed category desks only — never edits the registry. */
export function buildChecks(listed = defaultListed()) {
  return scopedRoutedDesks()
    .filter((file) => !listed.has(file))
    .map((file) => deskRow(file, listed));
}

export const CHECKS = buildChecks();

/** Same as CHECKS; lets callers pass a custom list in tests. */
export function gaps(checks = CHECKS) {
  return checks;
}
