// Slice S3 (customer-data routes): rows that a fake-data handler test now
// proves. A row is named by the same 20-hex id the catalog compiler gives it
// (sha256 of sourceFile, surface and control), so a changed control is a new,
// unproved row. Each entry lists the test files that run the real api/ handler
// and judge the exact result. src/pulse/catalog/proofs/s3-door-contracts.test.mjs
// checks every entry against the coverage map and the test files.
import { createHash } from "node:crypto";

export const S3_DOOR_CONTRACTS_EVIDENCE = "src/pulse/catalog/proofs/s3-door-contracts.test.mjs";

const DEFINITIONS = [
  // routes-0 auth/authorized-rep: Remove the authorized representative from a client file (ends their se
  ["9255b5b51885f7ae94c6", ["src/http/s3-auth-handler.test.mjs"]],
  // routes-1 auth/authorized-rep-file: GET list the client files this authorized-rep login may open
  ["efb2cacc839cbf09569d", ["src/http/s3-auth-handler.test.mjs"]],
  // routes-1 auth/authorized-rep-file: POST {client_id} switch the active file for this authorized-rep sessio
  ["5d4523bd5117d449a1e0", ["src/http/s3-auth-handler.test.mjs"]],
  // routes-0 auth/magic-link-verify: Exchange an emailed one-time link token for a portal session; spends t
  ["78930ac74c4774c0cf1a", ["src/http/s3-auth-handler.test.mjs"]],
  // routes-1 auth/reset: POST action=confirm {token, password} (set a new password, revoke all 
  ["3ceea768175eaf731726", ["src/http/s3-auth-handler.test.mjs"]],
  // routes-0 client-notes: Save staff-only notes on one client file (custom_fields.notes, 20,000 
  ["0be61855e2a68c7710c5", ["src/http/s3-client-file-handler.test.mjs"]],
  // routes-0 customer-insights: Staff save a mid check-in or post-funding customer interview (answers 
  ["93ae920eefcd9df34560", ["src/http/s3-client-file-handler.test.mjs"]],
  // routes-1 read/customer-insights: GET ?client_id=&stage= (saved customer interviews and the question ban
  ["160b0f753350d1cf1a00", ["src/http/s3-client-file-handler.test.mjs"]],
  // routes-1 bookings: GET ?from=&to=&client_id=&status= (calendar's read of booked calls, or
  ["e4ac403025e209dcb2d0", ["src/http/s3-client-file-handler.test.mjs"]],
  // routes-3 read/entitlements: GET what a client holds and what is still locked (the portal upsell su
  ["cdf6317140aac95d8037", ["src/http/s3-client-file-handler.test.mjs"]],
  // routes-1 read/bank-inbox: GET ?client_id= (bank emails for one client with the dollar figures th
  ["11720414e55bd13ff36a", ["src/http/s3-client-file-handler.test.mjs"]],
  // routes-3 read/conversations: GET ?client_id= (required) the Closer Dashboard pre-call panel: one ro
  ["d68d0a54f77b12b2a005", ["src/http/s3-client-file-handler.test.mjs"]],
  // routes-1 read/ad-attribution: GET ?client_id= (which ad brought this client and what it promised: UT
  ["978e23b7eedb58c78f7c", ["src/http/s3-client-file-handler.test.mjs"]],
  // routes-2 push/subscribe: GET/POST /api/push/subscribe — web push for the client portal: GET how
  ["3789d0457a0c21703885", ["src/http/s3-client-portal-handler.test.mjs"]],
  // routes-0 push/unsubscribe: Client turns this device's (or every device's) push notifications off;
  ["8f24e03972aeea499787", ["src/http/s3-client-portal-handler.test.mjs"]],
  // routes-2 public/unsubscribe: GET/POST /api/public/unsubscribe — the door behind the unsubscribe lin
  ["00ea96a3482d70f548e3", ["src/http/s3-client-portal-handler.test.mjs"]],
  // routes-2 waypoint-tick: POST /api/waypoint-tick {waypoint_id, done} — a client ticks or untick
  ["82c9a8c34c9838daa634", ["src/http/s3-client-portal-handler.test.mjs"]],
  // routes-1 public/affiliate-click: POST {ref|code|a1, source} record one visit to an affiliate referral l
  ["55aaebdb6267f1c219fb", ["src/http/s3-client-portal-handler.test.mjs"]],
  // routes-0 money/ready-to-fund: POST: press 'Ready to get funded': creates the Capital Blueprint CSM c
  ["ff15724ac7ca5bbe40e3", ["src/http/s3-money-handler.test.mjs"]],
  // routes-0 money/alerts: set_alert / set_promo / set_statement_close_day: change which file-pro
  ["e220719319078ca93637", ["src/http/s3-money-handler.test.mjs"]],
  // routes-1 money/payments: POST action=ask_for_person (client or staff: open a CSM task; the help
  ["c8502edd7faaf133c181", ["src/http/s3-money-handler.test.mjs"]],
  // routes-0 money/vault: accept / reject / waive / unwaive / add_item / retire_item: staff rule
  ["ef4d7e78c8f80f8ea983", ["src/http/s3-money-vault-handler.test.mjs"]],
  // routes-0 blueprint/staff-actions: get_next_sequence_plan (read) and set_next_sequence_date: shows or set
  ["36e4a187a7837c3c3c83", ["src/http/s3-blueprint-bank-handler.test.mjs", "src/http/blueprint-staff-actions-next-sequence.test.mjs"]],
  // routes-0 blueprint/staff-actions: create_credit_partner: creates a second client file linked to a Bluepr
  ["5a3644de2367d87caa59", ["src/http/s3-blueprint-bank-handler.test.mjs"]],
  // routes-0 blueprint/staff-actions: offer_bank_tracker, add_bank_todo, list_bank_todos, update_bank_todo_s
  ["4fc565bbbc58b2ab520b", ["src/http/s3-blueprint-bank-handler.test.mjs"]],
  // routes-1 money/banks: POST action=plan_bank|open_account|record_deposit|set_state|set_next_s
  ["94e9b4b5756805319c53", ["src/http/s3-blueprint-bank-handler.test.mjs"]],
  // routes-3 finance/containers: GET a client's containers (one per person and business) with what each
  ["3e84ef4f0874d1eb7cad", ["src/http/finance-containers.test.mjs", "src/http/s3-finance-handler.test.mjs"]],
  // routes-3 finance/soft-pull: POST {client_id, reason, cost_cents?} records one queued soft-pull req
  ["dd97290ff06c3051b808", ["src/http/s3-finance-handler.test.mjs"]],
  // routes-2 finance/bank-accounts: GET/POST /api/finance/bank-accounts — a client's bank accounts entered
  ["5c35731a27547d8b02fa", ["src/http/bank-accounts-endpoints.test.mjs"]],
  // routes-1 finance/cashflow: GET ?client_id=&horizon_days= (day-by-day cash projection, payment win
  ["e670ae3311986801a714", ["src/http/bills-cashflow-endpoints.test.mjs"]],
  // routes-1 finance/cashflow: POST action=save_settings|save_reminders|acknowledge_reminder (min buf
  ["0a4e0673c53eee9faede", ["src/http/bills-cashflow-endpoints.test.mjs"]],
  // routes-2 finance/cashflow: GET/POST /api/finance/cashflow — GET the day-by-day cash projection, p
  ["574650c9ad97b32a530b", ["src/http/bills-cashflow-endpoints.test.mjs"]],
  // routes-3 finance/bills: GET recurring bills detected from bank transactions (and low-confidenc
  ["913a8ca3f2288206bcb3", ["src/http/bills-cashflow-endpoints.test.mjs"]],
  // routes-3 finance/liabilities: GET a client's card stack and totals or one card's history; POST add_c
  ["6963f86c683f79642699", ["src/http/finance-liabilities.test.mjs"]],
  // routes-0 finance/crs-pull: Staff order a real credit-bureau pull (TU, EX or EQ) for one client: q
  ["aa986a577d3c9da12f0d", ["src/http/finance-crs-pull.test.mjs"]],
  // routes-1 banking/revoke: GET ?client_id= (list a client's connected bank logins)
  ["77b8178194ebe488a652", ["src/http/banking-revoke.test.mjs"]],
  // routes-1 banking/revoke: POST {item_id, reason} disconnect a bank login: deletes the stored cre
  ["c45736df7b335c4a294b", ["src/http/banking-revoke.test.mjs"]],
  // routes-3 dashboard/client-archive: POST {client_id, confirm:'DELETE'} soft archive: removes the client's 
  ["c8edb3e22ae38fbe686b", ["src/http/client-archive.test.mjs"]],
  // routes-2 partner-brand/verify-domain: POST /api/partner-brand/verify-domain — real DNS TXT check that a part
  ["17020c20671b0c807b4c", ["src/http/partner-brand-verify-domain-handler.test.mjs"]],
  // routes-1 inquiry-cases: POST action=create|update (open or edit an inquiry removal case for a 
  ["9cf32efe4c1da606db38", ["src/http/s3-inquiry-cases-handler.test.mjs"]],
  // routes-1 inquiry-cases: POST action=close|mark_cleared|clear_inquiry (finish a case; Completed
  ["4132e9d84908aa3cc202", ["src/http/inquiry-cases-actions-handler.test.mjs", "src/http/s3-inquiry-cases-handler.test.mjs"]],
  // routes-1 inquiry-cases: POST action=generate (build the removal letter draft from the client's
  ["9a7b791ecc849b35655a", ["src/http/s3-inquiry-cases-handler.test.mjs"]],
  // routes-1 inquiry-cases: POST action=send {mail, portal} (mail the bureau letter on the client'
  ["4bf572fddb1ef89eff8c", ["src/http/inquiry-cases-actions-handler.test.mjs"]],
  // routes-1 inquiry-cases: POST action=gate_override (staff overrides the bureau gate on a case)
  ["5ca82f080c6a61360d24", ["src/http/s3-inquiry-cases-handler.test.mjs"]],
  // routes-2 inquiry-cases (clear_inquiry): POST /api/inquiry-cases action clear_inquiry — marks one inquiry clear
  ["72fad5cb5f5f84a3aa0f", ["src/http/s3-inquiry-cases-handler.test.mjs"]],
  // routes-2 inquiry-cases (create, update, close, mark_cleared, generate, gate_override): POST /api/inquiry-cases actions create, update, close, mark_cleared (e
  ["5725e57ed8afcb3c7504", ["src/http/s3-inquiry-cases-handler.test.mjs", "src/http/inquiry-cases-actions-handler.test.mjs"]],
  // routes-2 inquiry-cases (send): POST /api/inquiry-cases action send — sends the inquiry-removal letter
  ["af74d4321e47c5c9eddc", ["src/http/inquiry-cases-actions-handler.test.mjs"]],
  // routes-1 banking/accounts: GET ?client_id= (bank accounts, statement cycles, holdings with server
  ["b822a8a448d596abdbb1", ["src/http/s3-banking-handler.test.mjs"]],
  // routes-1 banking/accounts: POST action=create_account|set_cycle|replace_holdings (hand-enter a pe
  ["84cbea3bc7e928861f71", ["src/http/s3-banking-handler.test.mjs"]],
  // routes-0 banking/sync-liabilities: Pull card bills (due date, minimum, last statement) from Plaid for eve
  ["231389bc27f344fd8a82", ["src/http/s3-banking-handler.test.mjs"]],
  // routes-1 closer-deck: POST action=log_disposition {client_id, offer_key, route, temperature,
  ["cd635e5a76c1f973668e", ["src/http/s3-closer-deck-handler.test.mjs"]],
  // routes-1 documents-download: GET ?id= (mint a fresh signed link for a saved document; client reache
  ["dc798f3e0da8c9474cda", ["src/http/s3-documents-handler.test.mjs"]],
  // routes-1 read/money-map: GET ?client_id=&days=&amount= (one client's cards due, recurring bills
  ["d8d35b20c6cf7376f929", ["src/http/money-map.test.mjs"]],
  // routes-1 read/transactions: GET ?client_id=&entity_id=&days=&limit= (a client's bank transactions 
  ["68ced8462a35c6b99d91", ["src/http/transactions.test.mjs"]],
  // routes-3 read/underwrite: GET ?client_id= the UnderwriteIQ funding read: the engine's assessment
  ["f9a7e355ccc42b4f5515", ["src/http/underwrite-read.test.mjs"]],
  // routes-1 read/finance-os-suggestions: GET ?client_id= (what the latest pull says is costing the client money
  ["0c52029f11762fd9944a", ["src/http/finance-os-suggestions.test.mjs"]],
  // routes-1 read/repair-cases: GET (repair queue for the specialist desk; ?client_id= adds letter bod
  ["573d06e0f1f0640af50f", ["src/http/repair-cases-read.test.mjs"]],
  // routes-2 privacy/erasure: GET/POST /api/privacy/erasure — GET what erasures were done (all, or f
  ["136864d22c0b1dc91cbf", ["src/http/privacy-erasure.test.mjs"]],
  // routes-2 public/climate-match: GET/POST /api/public/climate-match — public lending-climate lead magne
  ["0afa1181d191c2bd75c2", ["src/http/climate-match.test.mjs"]],
  // routes-1 merchant/events: POST {events:[...]} open API: a merchant processor posts sales, refund
  ["b059a64abd651eb2cc93", ["src/http/money-connections.test.mjs"]],
  // routes-2 merchant/events: POST /api/merchant/events — open API: a client's own merchant processo
  ["ec5c29924a3b4d09c4e0", ["src/http/money-connections.test.mjs"]],
  // routes-2 money/connections: GET/POST /api/money/connections — a client's own merchant processors (
  ["b357ef70eda470eb0e6b", ["src/http/money-connections.test.mjs"]],
  // routes-2 money/accounts: GET/POST /api/money/accounts — the client's Accounts page: GET contain
  ["e60a03ab92cb57f7543f", ["src/http/money-accounts.test.mjs"]],
  // routes-1 repair/send: POST {mail:true, client_id, letters[]} human-triggered mailing of repa
  ["18a47181b67209de88a2", ["src/http/repair-send.test.mjs"]],
  // routes-2 public/partner-apply: POST /api/public/partner-apply — the affiliate and white-label applica
  ["22c3733f1a94e65d9c96", ["src/http/partner-apply.test.mjs"]],
];

export function s3DoorRowId(sourceFile, row) {
  const file = String(sourceFile || "").split(/[\\/]/).at(-1);
  return createHash("sha256")
    .update(`${file}\0${row?.surface}\0${row?.control}`)
    .digest("hex")
    .slice(0, 20);
}

export const S3_DOOR_CONTRACTS = Object.freeze(
  DEFINITIONS.map(([id, tests]) => Object.freeze({ id, tests: Object.freeze([...tests]) })),
);

const BY_ID = new Map(S3_DOOR_CONTRACTS.map((entry) => [entry.id, entry]));

export function s3DoorProof(sourceFile, row) {
  const entry = BY_ID.get(s3DoorRowId(sourceFile, row));
  if (!entry) return null;
  return {
    depth: "deep",
    evidence: [S3_DOOR_CONTRACTS_EVIDENCE, ...entry.tests].join(" "),
    asserts: row.control,
  };
}
