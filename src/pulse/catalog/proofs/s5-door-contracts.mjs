// Route rows from the S5 slice (staff-only and everything else) that a real
// handler test proves. Each row names the exact map line (source file, surface,
// control text) and the test file that runs the real api/ handler with stand-in
// data and judges the result.
//
// A row with "handler" and "titles" is proved by an older test that already
// judged this exact result; s5-door-attached.test.mjs holds it to that test by
// name, so deleting or renaming the proving test turns this row back red.
//
// Generated from the coverage map once, then kept by hand: a changed control text
// stops matching and the row goes back to not proved, which is the honest answer.

export const S5_ROUTE_ROWS = Object.freeze([
  Object.freeze({
    "name": "auth-suspend",
    "sourceFile": "routes-0.json",
    "surface": "route:auth/suspend",
    "control": "Turn off a staff login and revoke its sessions. Cannot suspend yourself.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "auth-staff-role",
    "sourceFile": "routes-1.json",
    "surface": "route:auth/staff-role",
    "control": "POST {staff_id, role} change a staff job (cannot mint or rewrite owner)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "auth-staff-update",
    "sourceFile": "routes-2.json",
    "surface": "route:auth/staff-update",
    "control": "POST /api/auth/staff-update — owner/admin edits a staff profile (name, email, phone, start date, booked-call text switch). Caller: owner, admin.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "auth-invite",
    "sourceFile": "routes-2.json",
    "surface": "route:auth/invite",
    "control": "POST /api/auth/invite — owner/admin creates a staff login (name@fundhub.ai), returns the set-password link, and emails that link through Resend when notify_email is a real address. Caller: owner, admin.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "auth-admin-reset",
    "sourceFile": "routes-2.json",
    "surface": "route:auth/admin-reset",
    "control": "POST /api/auth/admin-reset — owner or admin makes a password-reset token for another staff member and gets the link back in the response (nothing is emailed). Caller: owner, admin.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "auth-authorized-rep",
    "sourceFile": "routes-0.json",
    "surface": "route:auth/authorized-rep",
    "control": "Read who the authorized representative on a client file is (name, email, phone).",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "staff-monitoring-consent",
    "sourceFile": "routes-0.json",
    "surface": "route:staff/monitoring-consent",
    "control": "Owner records or revokes an employee's consent to activity monitoring (form version stamped).",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "staff-telemetry",
    "sourceFile": "routes-1.json",
    "surface": "route:staff/telemetry",
    "control": "GET ?staff_id= (one staff member's tracked activity and hours from shifts, staff events and Hubstaff ingest)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "shifts-read",
    "sourceFile": "routes-1.json",
    "surface": "route:shifts",
    "control": "GET (the caller's open shift) and GET ?roster=1 (everyone clocked in)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "shifts-clock",
    "sourceFile": "routes-1.json",
    "surface": "route:shifts",
    "control": "POST action=clock_in|clock_out (a staff member starts or ends their own shift; the open shift gates writes that affect attribution or pay)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "chat-peers",
    "sourceFile": "routes-1.json",
    "surface": "route:chat/peers",
    "control": "GET staff directory for internal chat (names, emails, roles of active staff)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "demo-mode",
    "sourceFile": "routes-3.json",
    "surface": "route:demo/mode",
    "control": "GET reads whether demo mode is on; POST {enabled} switches it; DELETE {confirm:'WIPE_DEMO_DATA'} wipes the demo rows for the org.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-people.test.mjs"
  }),
  Object.freeze({
    "name": "marketing-scripts",
    "sourceFile": "routes-3.json",
    "surface": "route:marketing/scripts",
    "control": "GET ?status=&batch= the scripts list (inbox, approved, shoot day). Hides imports and unreleased batches.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-marketing-reads.test.mjs"
  }),
  Object.freeze({
    "name": "marketing-script",
    "sourceFile": "routes-1.json",
    "surface": "route:marketing/script",
    "control": "GET ?id= (one script with every version and its check results)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-marketing-reads.test.mjs"
  }),
  Object.freeze({
    "name": "marketing-batches",
    "sourceFile": "routes-3.json",
    "surface": "route:marketing/batches",
    "control": "GET batch history: every weekly drop and Write now, newest first, with counts planned, written and flagged.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-marketing-reads.test.mjs"
  }),
  Object.freeze({
    "name": "marketing-funnel",
    "sourceFile": "routes-1.json",
    "surface": "route:marketing/funnel",
    "control": "GET ?id= (one built funnel: pages with words and HTML, last build and push jobs)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-marketing-reads.test.mjs"
  }),
  Object.freeze({
    "name": "hiring-postings-a",
    "sourceFile": "routes-1.json",
    "surface": "route:hiring/postings",
    "control": "GET ?state=&channel= (job postings and their sync state, last_error verbatim)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "hiring-postings-b",
    "sourceFile": "routes-2.json",
    "surface": "route:hiring/postings",
    "control": "GET /api/hiring/postings — job postings and their sync state (?state, ?channel), last_error verbatim, application counts. Read-only. Caller: owner, admin (ROLE_SETS.HIRING). The SQL scopes to the default org (is_default), not the session org.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "hiring-funnel",
    "sourceFile": "routes-0.json",
    "surface": "route:hiring/funnel",
    "control": "Hiring conversion by stage and by source.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "hiring-candidates",
    "sourceFile": "routes-0.json",
    "surface": "route:hiring/candidates",
    "control": "Hiring pipeline board with scores and flags (applicant PII).",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "hiring-application",
    "sourceFile": "routes-0.json",
    "surface": "route:hiring/application",
    "control": "One job application in full: answers, every score with rubric version, interviews, decision history (applicant PII).",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "creative-brand-kits-a",
    "sourceFile": "routes-1.json",
    "surface": "route:creative/brand-kits",
    "control": "GET ?state= (partner brand kits)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "creative-brand-kits-b",
    "sourceFile": "routes-2.json",
    "surface": "route:creative/brand-kits",
    "control": "GET /api/creative/brand-kits — a partner's brand kits (palette, fonts, voice, asset count), filter ?state=. Read-only. Caller: partner (own rows by row-level security) or staff naming ?partner_id=.",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "creative-library-a",
    "sourceFile": "routes-1.json",
    "surface": "route:creative/library",
    "control": "GET ?state=&kind=&format= (creative asset library with compliance state)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "creative-library-b",
    "sourceFile": "routes-2.json",
    "surface": "route:creative/library",
    "control": "GET /api/creative/library — the partner's creative library, filters state, kind, format, brand_kit_id, include_archived; never selects storage_key. Read-only. Caller: partner or staff with ?partner_id=.",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "creative-jobs",
    "sourceFile": "routes-0.json",
    "surface": "route:creative/jobs",
    "control": "Creative generation job status list (queued, running, succeeded, failed).",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "creative-approvals",
    "sourceFile": "routes-0.json",
    "surface": "route:creative/approvals",
    "control": "Approval queue: blocked or pending creative assets, campaigns awaiting approval, partner brands sent for review.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "campaigns-action-log",
    "sourceFile": "routes-1.json",
    "surface": "route:campaigns/action-log",
    "control": "GET ?state=&target_type=&rule_key= (every automated and human ad action with before/after)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "campaigns-spend",
    "sourceFile": "routes-2.json",
    "surface": "route:campaigns/spend",
    "control": "GET /api/campaigns/spend — today's ad spend against every ceiling from v_partner_spend_vs_ceiling (breached, exhausted, approaching). Caller: partner or staff with ?partner_id=. Reports the mirror's spend, not the kill switch's truth.",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "campaigns-connections",
    "sourceFile": "routes-2.json",
    "surface": "route:campaigns/connections",
    "control": "GET /api/campaigns/connections — a partner's connected ad accounts, verification state and launch blockers; no tokens returned. Caller: partner (own rows via RLS) or staff naming ?partner_id=.",
    "impact": "none",
    "test": "src/pulse/catalog/proofs/s5-door-hiring-creative-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-failed-events",
    "sourceFile": "routes-0.json",
    "surface": "route:read/failed-events",
    "control": "Dead-letter queue: which event handler failed, when, and the payload shape.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-commissions-a",
    "sourceFile": "routes-0.json",
    "surface": "route:read/commissions",
    "control": "Staff commission ledger: who earned what and whether it is settled (demo rows excluded).",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-commissions-b",
    "sourceFile": "routes-2.json",
    "surface": "route:read/commissions",
    "control": "GET /api/read/commissions — the commission ledger: who earned what, basis, amount, status (pending/approved/paid/void), split, product at earning, dates; filters client_id and status; demo rows excluded. Read-only; a client session is refused. Caller: owner, admin, sales_manager (ROLE_SETS.FINANCE), org from the session.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-documents",
    "sourceFile": "routes-0.json",
    "surface": "route:read/documents",
    "control": "Document metadata list (storage key stripped) for a client or the org.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-eeo-aggregate",
    "sourceFile": "routes-1.json",
    "surface": "route:read/eeo-aggregate",
    "control": "GET ?role= bias-audit aggregates from v_eeo_aggregate only (cells under 5 responses suppressed)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-slo-connections",
    "sourceFile": "routes-1.json",
    "surface": "route:read/slo-connections",
    "control": "GET owner list of live ClickFunnels-to-product maps (which paid products unlock)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-funnel-pages",
    "sourceFile": "routes-0.json",
    "surface": "route:read/funnel-pages",
    "control": "ClickFunnels page performance for the org (views, conversions) for the funnels report.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-video-stats-a",
    "sourceFile": "routes-1.json",
    "surface": "route:read/video-stats",
    "control": "GET ?limit= (YouTube watch-time rows for the org's connected channel and the connection's health)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-video-stats-b",
    "sourceFile": "routes-2.json",
    "surface": "route:read/video-stats",
    "control": "GET /api/read/video-stats — YouTube watch-time rows for the org's connected channel plus the connection's own health (state, last synced, last error). Read-only. Caller: ROLE_SETS.STAFF, org from the session.",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-call-outcomes",
    "sourceFile": "routes-1.json",
    "surface": "route:read/call-outcomes",
    "control": "GET (list call dispositions: closers see their own, finance set sees the floor; ?client_id=&staff_id=)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-agent-shadow-log",
    "sourceFile": "routes-1.json",
    "surface": "route:read/agent-shadow-log",
    "control": "GET ?code=&limit= (newest shadow and would-be runs for one agent or the whole org)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-ai-bureau-config",
    "sourceFile": "routes-0.json",
    "surface": "route:read/ai-bureau-config",
    "control": "AI bureau IVR routing table (empty until edited).",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-staff-reads.test.mjs"
  }),
  Object.freeze({
    "name": "read-invoices",
    "sourceFile": "routes-2.json",
    "surface": "route:read/invoices",
    "control": "GET /api/read/invoices — invoices with balance due and days overdue from v_invoice_aging; ?status=open means an unpaid balance; unknown status is 400; demo rows excluded. Read-only. Caller: owner, admin, sales_manager (ROLE_SETS.FINANCE), org from the session.",
    "impact": "staffOnly",
    "test": "src/http/read-invoices-handler.test.mjs",
    "handler": "api/read/invoices.mjs",
    "titles": [
      "?status=open asks for money still owed",
      "a status that does not exist is a 400",
      "a closer is refused"
    ]
  }),
  Object.freeze({
    "name": "ai-bureau-config-save",
    "sourceFile": "routes-2.json",
    "surface": "route:ai-bureau-config",
    "control": "POST /api/ai-bureau-config — upsert or save an IVR routing row (which phone-menu path the AI bureau caller presses). Caller: staff owner, admin, funding_advisor.",
    "impact": "staffOnly",
    "test": "src/http/ai-bureau-config-handler.test.mjs",
    "handler": "api/ai-bureau-config.mjs",
    "titles": [
      "Save on a row: only the editable fields change",
      "upsert a new bureau: the code is upper-cased",
      "a closer cannot change the number the AI dials"
    ]
  }),
  Object.freeze({
    "name": "marketing-flags-a",
    "sourceFile": "routes-1.json",
    "surface": "route:marketing-flags",
    "control": "POST {belief, lead_source, setter_label, outcome_count, period} store an objection pattern for marketing routing",
    "impact": "staffOnly",
    "test": "src/http/marketing-flags-handler.test.mjs",
    "handler": "api/marketing-flags.mjs",
    "titles": [
      "a good flag is stored for this company and this person: 201",
      "a belief that is not on the list is refused",
      "a closer cannot file a flag"
    ]
  }),
  Object.freeze({
    "name": "marketing-flags-b",
    "sourceFile": "routes-2.json",
    "surface": "route:marketing-flags",
    "control": "POST /api/marketing-flags — stores an objection pattern (belief, lead source, setter label, count, period) for marketing routing. Sends nothing. Caller: owner, admin, sales_manager (ROLE_SETS.FINANCE).",
    "impact": "staffOnly",
    "test": "src/http/marketing-flags-handler.test.mjs",
    "handler": "api/marketing-flags.mjs",
    "titles": [
      "a good flag is stored for this company and this person: 201",
      "a belief that is not on the list is refused",
      "a closer cannot file a flag"
    ]
  }),
  Object.freeze({
    "name": "partner-marketing-usage",
    "sourceFile": "routes-1.json",
    "surface": "route:partner-marketing/usage",
    "control": "GET ?partner_id= (tokens used this month vs the hard cap)",
    "impact": "none",
    "test": "src/http/partner-marketing-usage-handler.test.mjs",
    "handler": "api/partner-marketing/usage.mjs",
    "titles": [
      "a partner cannot read another partner's budget",
      "a partner reads their own budget inside their own row scope",
      "past the cap reads 0 left, never below"
    ]
  }),
  Object.freeze({
    "name": "paydown-simulator",
    "sourceFile": "routes-2.json",
    "surface": "route:finance/paydown-simulator",
    "control": "POST /api/finance/paydown-simulator — cash split and projected pre-approval for a client given cash_on_hand; needs an active finance-os entitlement (403 not_entitled otherwise); no credit file answers hasPull:false. Computes only. Caller: ROLE_SETS.STAFF, client in the session org.",
    "impact": "none",
    "test": "src/http/paydown-simulator-handler.test.mjs",
    "handler": "api/finance/paydown-simulator.mjs",
    "titles": [
      "no FinanceOS plan: 403 not_entitled",
      "entitled: the split and the projected pre-approval come back",
      "a client from another company reads as not found"
    ]
  }),
  Object.freeze({
    "name": "finance-alerts-a",
    "sourceFile": "routes-0.json",
    "surface": "route:finance/alerts",
    "control": "evaluate / acknowledge / resolve / dismiss: run the rules for a client and raise alerts (owner notification rows), or change an alert's state.",
    "impact": "staffOnly",
    "test": "src/http/finance-alerts.test.mjs",
    "handler": "api/finance/alerts.mjs",
    "titles": [
      "a condition that is TRUE writes an alert and reports the title and the figures",
      "acknowledging stamps the moment and the person",
      "dismissing without a reason records the absence rather than inventing one",
      "an alert that is not in this org is a 404"
    ]
  }),
  Object.freeze({
    "name": "finance-alerts-b",
    "sourceFile": "routes-0.json",
    "surface": "route:finance/alerts",
    "control": "set_trigger: turns an alert rule on or off and sets its threshold for the whole book.",
    "impact": "staffOnly",
    "test": "src/http/finance-alerts.test.mjs",
    "handler": "api/finance/alerts.mjs",
    "titles": [
      "an empty threshold box is written as NULL, not as zero",
      "a percentage typed by a person becomes basis points exactly once",
      "a rule name that is not one of ours is refused before any write"
    ]
  }),
  Object.freeze({
    "name": "content-tiles",
    "sourceFile": "routes-0.json",
    "surface": "route:content/tiles",
    "control": "Content screen read: locked-tile copy and prices, welcome videos, tier-to-video map, products.",
    "impact": "staffOnly",
    "test": "src/http/content-tiles.test.mjs",
    "handler": "api/content/tiles.mjs",
    "titles": [
      "refuses a closer",
      "GET returns catalog tiles, not invented ones",
      "save updates an existing catalog row"
    ]
  }),
  Object.freeze({
    "name": "content-welcome-video",
    "sourceFile": "routes-2.json",
    "surface": "route:content/welcome-video",
    "control": "GET/HEAD /api/content/welcome-video — the hero video on the client portal. Without ?sig it needs a session (client sees own file, staff name the client) and answers whether a video is mapped, whether its bytes are in the store, and a short-lived signed link; with ?sig it streams the bytes with no session (the signature is the credential).",
    "impact": "none",
    "test": "src/http/content-tiles.test.mjs",
    "handler": "api/content/welcome-video.mjs",
    "titles": [
      "a mapped video comes back with a signed link and no storage key",
      "no video mapped is an honest 200, not a 404",
      "a client cannot widen the read by naming someone else's client_id"
    ]
  }),
  Object.freeze({
    "name": "marketing-offer-generate",
    "sourceFile": "routes-1.json",
    "surface": "route:marketing/offer/generate",
    "control": "POST start the Write offer run (six offers, four judges, one winner; background writer, Anthropic model spend) and GET ?id= read a run back",
    "impact": "staffOnly",
    "test": "src/http/marketing-offer-generate.test.mjs",
    "handler": "api/marketing/offer/generate.mjs",
    "titles": [
      "press Write offer: 202 at once, the writer runs, GET shows the offer",
      "a second press while one is being written returns that run",
      "no session is 401; a closer is 403"
    ]
  }),
  Object.freeze({
    "name": "agents-promote-demote",
    "sourceFile": "routes-1.json",
    "surface": "route:agents",
    "control": "POST action=promote|demote (flip an agent live or back to shadow; gate = prompt 60+ chars and guardrails)",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-writes.test.mjs"
  }),
  Object.freeze({
    "name": "creative-actions",
    "sourceFile": "routes-3.json",
    "surface": "route:creative/actions",
    "control": "POST approve, reject or archive a generated creative asset (clears the review queue).",
    "impact": "staffOnly",
    "test": "src/pulse/catalog/proofs/s5-door-writes.test.mjs"
  }),
]);

const BY_KEY = new Map(S5_ROUTE_ROWS.map((row) => [`${row.sourceFile}\0${row.surface}\0${row.control}`, row]));

// door-proof.mjs asks here for a route row's proof. Exact text or nothing.
export function s5DoorProof(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  const found = BY_KEY.get(`${file}\0${row?.surface}\0${row?.control}`);
  if (!found) return null;
  return { depth: "e2e", evidence: found.test, asserts: String(row.control) };
}
