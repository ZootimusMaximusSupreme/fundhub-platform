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
