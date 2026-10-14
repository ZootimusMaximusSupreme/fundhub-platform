// Screen controls from the S5 slice (staff-only and everything else) that a real
// test now exercises. Each row names the exact map line (source file, surface,
// control text) and the test file that proves it.
//
// A row with "titles" is proved by an older test that already judged this
// control; s5-display-attached.test.mjs holds it to that test by name, so
// deleting or renaming the proving case turns the row back red. A row without
// "titles" is proved by one of this slice's own browser or render tests.
//
// A changed control text stops matching and the row goes back to not proved.

export const S5_DISPLAY_ROWS = Object.freeze([
  Object.freeze({
    "name": "sidebar-pipeline",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Sales > Pipeline (pipeline.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-closer-dashboard",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Sales > Closer Dashboard (closer-dashboard.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-my-numbers",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Sales > My numbers (my-numbers.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-sales-floor",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Sales > Sales floor (sales-floor.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-calendar",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Sales > Calendar (calendar.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-lenders",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Funding > Lenders (lenders.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-client-control-panel",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Funding > Client Control Panel (client-control-panel.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-csm-queue",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Client ops > Client Success (csm-queue.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-messaging",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Client ops > Messaging (messaging.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-documents",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Client ops > Documents (documents.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-inquiry-remover",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Client ops > Specialist (inquiry-remover.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-company-brain",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Client ops > Company Brain (company-brain.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-marketing-command-center",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Marketing > Command Center (marketing-command-center.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-campaign-manager",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Marketing > Campaigns (campaign-manager.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-social-studio",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Marketing > Social Studio (social-studio.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-creative-factory",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Marketing > Creative Factory (creative-factory.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-content-admin",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Marketing > Content (content-admin.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-staff-teams",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Admin > Staff & Teams (staff-teams.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-products-commissions",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Admin > Products & Commissions (products-commissions.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-contracts",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Admin > Contract templates (contracts.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "sidebar-client-portal",
    "sourceFile": "desks-f.json",
    "surface": "sidebar.fragment.html",
    "control": "Nav link: Portals > Client Portal (client-portal.html)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-sidebar.test.mjs"
  }),
  Object.freeze({
    "name": "money-credit-nav",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-credit.html",
    "control": "Money nav bar (Money, Accounts, Credit, Connections, Payments, Setup)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-credit-back",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-credit.html",
    "control": "Back to my portal / Back to Finance OS (staff)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-credit-shell",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-credit.html",
    "control": "Page shell (inline styles, loads money-credit.js)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-credit-read0",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-credit.html",
    "control": "Credit read on page load",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-credit-error",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-credit.html",
    "control": "Error state with Try again",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-declines-nav",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-declines.html",
    "control": "Money nav bar (Money, Accounts, Credit, Applications, Connections, Payments, Setup)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-declines-back",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-declines.html",
    "control": "Back to my portal / Back to Finance OS (staff)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-declines-shell",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-declines.html",
    "control": "Page shell (loads money-declines.js/css)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-declines-read0",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-declines.html",
    "control": "Applications and declines read on page load",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-declines-error",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-declines.html",
    "control": "Error state with Try again",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-fundability-nav",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-fundability.html",
    "control": "Money nav bar (Money, Accounts, Credit, Fundability, Connections, Payments, Setup)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-fundability-back",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-fundability.html",
    "control": "Back to my portal / Back to Finance OS (staff)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-fundability-shell",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-fundability.html",
    "control": "Page shell (loads money-fundability.js/css)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-fundability-read0",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-fundability.html",
    "control": "Fundability read on page load",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-fundability-error",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-fundability.html",
    "control": "Error state with Try again",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-next-nav",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-next.html",
    "control": "Money nav bar (Money, Accounts, Credit, Connections, Payments, Setup; no current-page marker)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-next-back",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-next.html",
    "control": "Back to my portal / Back to Finance OS (staff)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-next-shell",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-next.html",
    "control": "Page shell (loads money-next.js/css)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-next-read0",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-next.html",
    "control": "Next steps read on page load",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-next-read1",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-next.html",
    "control": "Ready-to-fund status read on page load",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-connections-nav",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-connections.html",
    "control": "Money nav bar (Money, Accounts, Credit, Connections, Payments, Setup)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-connections-back",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-connections.html",
    "control": "Back to my portal / Back to Finance OS (staff)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-connections-shell",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-connections.html",
    "control": "Page shell (header, loads money-connections.js/css)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-connections-read0",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-connections.html",
    "control": "Connections read on page load (loading skeleton, then data)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-helper-nav",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-helper.html",
    "control": "Money nav bar (Money, Plan, Helper, Accounts, Credit, Connections, Payments, Setup)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-helper-back",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-helper.html",
    "control": "Back to my portal / Back to Finance OS (staff)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-helper-shell",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-helper.html",
    "control": "Page shell (loads money-helper.js/css)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-helper-read0",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-helper.html",
    "control": "Thread read on page load (turns, answers, what the helper did, which brain)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-helper-error",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-helper.html",
    "control": "Error state with Try again",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-plan-nav",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-plan.html",
    "control": "Money nav bar (Money, Plan, Accounts, Credit, Connections, Payments, Setup)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-plan-back",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-plan.html",
    "control": "Back to my portal / Back to Finance OS (staff)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-plan-shell",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-plan.html",
    "control": "Page shell (loads money-plan.js/css)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-plan-read0",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-plan.html",
    "control": "Plan month read on page load",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-setup-nav",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-setup.html",
    "control": "Money nav bar (Money, Accounts, Credit, Connections, Payments, Setup)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-setup-back",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-setup.html",
    "control": "Back to my portal / Back to Finance OS (staff)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-setup-shell",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-setup.html",
    "control": "Page shell (inline styles, loads money-setup.js)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-setup-read0",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-setup.html",
    "control": "Setup status read on page load",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-payments-nav",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-payments.html",
    "control": "Money nav bar (Money, Accounts, Credit, Connections, Payments, Setup)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-payments-back",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-payments.html",
    "control": "Back to my portal / Back to Finance OS (staff)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-payments-shell",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-payments.html",
    "control": "Page shell (loads money-payments.js/css)",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
  Object.freeze({
    "name": "money-payments-read0",
    "sourceFile": "desks-d.json",
    "surface": "public/app/money-payments.html",
    "control": "Payments read on page load",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-display-money-chrome.test.mjs"
  }),
]);

// Same shape as the other display-contract plugins: display-proof-cases.mjs
// spreads this list, so a matching row stops being listed as not proved.
export const S5_DISPLAY_PROOF_CASES = Object.freeze(S5_DISPLAY_ROWS.map((row) => Object.freeze({
  sourceFile: row.sourceFile,
  surface: row.surface,
  control: row.control,
  proof: Object.freeze({ depth: "e2e", file: row.test }),
})));
