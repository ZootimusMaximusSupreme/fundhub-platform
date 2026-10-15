// Finish-853 batch 07: live saved-result checks (and the list of practice-tested rows) for the
// Specialist desk (inquiry-remover.html), the lenders Apply proxy, the money vault and Plaid door,
// soft-pull business fields, staff employment agreements and the social Connect buttons.
//
// Each live check is ONE read-only SQL text. It takes the company as $1::uuid and returns
// sample_count (how many saved results exist) and bad_count (how many are wrong). Every contract is
// `emptyAs: "quiet"`: a control nobody has used in the window has nothing to judge, so it reads green
// with the words "no saved results yet", and it goes red on the first wrong result.
//
// Windows. A check over a table that holds old imported rows only judges what changed in the last
// 60 days (30 days for letters, which only carry the mailing stamps since 2026-09-05). Demo rows are
// never judged.
//
// The SQL is written in the common subset of Postgres and SQLite on purpose (no regexes, no arrays,
// no DISTINCT ON), so fin-b07-live-contracts.test.mjs can run the exact text against stand-in rows
// built from the real column names. The SQL texts sit in fin-b07-sql-desk.mjs, fin-b07-sql-repair.mjs
// and fin-b07-sql-misc.mjs (this file imports only those). It is read at build time by
// scripts/pulse/compile-catalog.mjs, and the live bundle reads the compiled copy in generated.json.

import {
  CASE_CLOSE_SQL,
  CASE_CLEARED_SQL,
  CASE_GENERATE_SQL,
  CASE_SEND_SQL,
  CASE_QUEUE_SQL,
  CASE_STATUS_SQL,
  CASE_UPLOAD_SQL,
  WORK_QUEUE_SQL,
  WORK_ROW_SQL,
  LOG_ATTEMPT_SQL,
  MARK_CONFIRMED_SQL,
  SET_STATUS_SQL,
  SAVE_EXPECTED_SQL,
  REVEAL_SQL,
  RECENT_LETTERS_SQL,
  CLEAN_PERSONAL_SQL,
} from "./fin-b07-sql-desk.mjs";
import {
  REPAIR_QUEUE_SQL,
  REPAIR_ROW_SQL,
  STAGE_INTAKE_SQL,
  STAGE_AWAIT_DOCS_SQL,
  STAGE_ANALYSIS_SQL,
  STAGE_LETTERS_GEN_SQL,
  STAGE_READY_SQL,
  STAGE_TRANSIT_SQL,
  STAGE_AWAIT_RESP_SQL,
  STAGE_RESP_RECV_SQL,
  STAGE_ROUND_DONE_SQL,
  STAGE_STALLED_SQL,
  STAGE_PROGRAM_DONE_SQL,
  STAGE_CANCELLED_SQL,
  ROW_SEND_SQL,
  LETTER_ONE_SQL,
  ROW_STAGE_SQL,
} from "./fin-b07-sql-repair.mjs";
import {
  VAULT_UPLOAD_SQL,
  LINK_EXCHANGE_SQL,
  LENDER_APPLY_SQL,
  APPLY_DIALOG_SQL,
  BUSINESS_FIELDS_SQL,
  AGREEMENTS_SQL,
  SOCIAL_CONNECT_SQL,
} from "./fin-b07-sql-misc.mjs";

const ROWS = Object.freeze({
  lenderApply: Object.freeze(["desks-c.json", "lenders.html", "Lender row Apply button (only on a client-scoped view ?client_id=; opens the bank page through the proxy)"]),
  applyDialog: Object.freeze(["desks-c.json", "lenders.html", "Apply dialog: Copy proxy string, End session, Close (manual fallback when the Chrome extension is absent)"]),
  banksGate: Object.freeze(["desks-c.json", "money-banks.html", "Page gate: client reads own file; staff (owner, admin, sales_manager, closer) need ?client_id=; only staff see plan controls"]),
  irGate: Object.freeze(["desks-c.json", "inquiry-remover.html", "Page gate: inquiry_specialist, owner, admin, funding_advisor roles; setter/closer-only roles bounced"]),
  caseQueue: Object.freeze(["desks-c.json", "inquiry-remover.html", "Case queue table: one row per inquiry removal case, oldest first (Client, Waiting, Bureau, Items, Status, Docs, Delivery, Call, Round)"]),
  caseStatuses: Object.freeze(["desks-c.json", "inquiry-remover.html", "Case statuses shown in the Status column: Queued, Scheduled, In Progress, Escalated, Blocked, Completed, Canceled"]),
  upload: Object.freeze(["desks-c.json", "inquiry-remover.html", "Case drawer: 'Upload FTC or police report' (file input + button; attaches as additional_fraud_docs)"]),
  generate: Object.freeze(["desks-c.json", "inquiry-remover.html", "Case drawer: 'Generate letters' button (writes inquiry items from the credit file; mails nothing)"]),
  send: Object.freeze(["desks-c.json", "inquiry-remover.html", "Case drawer: 'Send' button (letter to the bureau by PostGrid mail and/or Experian portal; refused while the identity packet is short)"]),
  markCleared: Object.freeze(["desks-c.json", "inquiry-remover.html", "Case drawer: 'Mark cleared' button (case Completed; emits inquiry.removed)"]),
  close: Object.freeze(["desks-c.json", "inquiry-remover.html", "Case drawer: 'Close' button (case Canceled)"]),
  workQueue: Object.freeze(["desks-c.json", "inquiry-remover.html", "Work queue table: one row per disputed inquiry line (Client, Bureau, Actual, Expected, Call state, Hold, Attempts, Status)"]),
  workRow: Object.freeze(["desks-c.json", "inquiry-remover.html", "Work row: click or Enter expands the work strip; loads attempt history and the masked identity line"]),
  logAttempt: Object.freeze(["desks-c.json", "inquiry-remover.html", "Work strip: attempt kind select (call, letter, portal, note) + 'Log an attempt' button"]),
  markConfirmed: Object.freeze(["desks-c.json", "inquiry-remover.html", "Work strip: 'Mark confirmed' button (confirms removal; sets confirmed_at)"]),
  setStatus: Object.freeze(["desks-c.json", "inquiry-remover.html", "Work strip: free-text status input + 'Set status' button"]),
  saveExpected: Object.freeze(["desks-c.json", "inquiry-remover.html", "Work strip: expected-name input + 'Save expected' button"]),
  reveal: Object.freeze(["desks-c.json", "inquiry-remover.html", "Identity line: reason input + 'Reveal SSN' / 'Hide' button (writes name and reason to the access log)"]),
  recentLetters: Object.freeze(["desks-c.json", "inquiry-remover.html", "Recent Letters Issued list + 'All letters' link (documents.html)"]),
  repairQueue: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair queue table: Client, Program, Round, Stage, Needs chip, Due (need-me first, most overdue first)"]),
  stIntake: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: intake (SLA 3 business days -> chase_contract task)"]),
  stAwaitDocs: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: awaiting_documents (SLA 14 days -> owner_contact_client)"]),
  stAnalysis: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: analysis (SLA 1 hour -> engineering_engine_failure)"]),
  stLettersGen: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: letters_generated (SLA 30 minutes -> generation_or_variance)"]),
  stReady: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: ready_to_send (SLA 4 hours -> dispatch_failure; shows as 'Ready')"]),
  stTransit: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: in_transit (SLA 10 days -> check_postgrid_tracking; shows as 'Waiting')"]),
  stAwaitResp: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: awaiting_response (bureau due date + 5 days -> bureau_deadline_breach; shows as 'Waiting')"]),
  stRespRecv: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: response_received (SLA 24 hours -> owner_reviews_parse; shows as 'Answer in')"]),
  stRoundComplete: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: round_complete (no clock; chip 'Round done - next?')"]),
  stStalled: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: stalled (the human queue; shows as 'Stuck')"]),
  stProgramComplete: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: program_complete (shows as 'Done')"]),
  stCancelled: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair stage: cancelled (shows as 'Cancelled')"]),
  repairRow: Object.freeze(["desks-c.json", "inquiry-remover.html", "Repair row: click or Enter expands the file (items, letters this round, what is next, timeline)"]),
  letterSendOne: Object.freeze(["desks-c.json", "inquiry-remover.html", "Letter drawer 'Send this one' button (mails one letter)"]),
  rowSend: Object.freeze(["desks-c.json", "inquiry-remover.html", "Expanded row 'Send' button (mails every sendable letter; fails closed without mail=true)"]),
  rowStage: Object.freeze(["desks-c.json", "inquiry-remover.html", "Expanded row 'Stage' button (generates the round's letters; mails nothing)"]),
  clean: Object.freeze(["desks-c.json", "inquiry-remover.html", "Expanded row 'Clean personal info' button (owner and admin only; asks to confirm; cannot be undone)"]),
  vaultUpload: Object.freeze(["desks-e.json", "public/app/money-vault.html", "documents-upload (server): stores the file, one document per file, sniffs the bytes"]),
  linkToken: Object.freeze(["desks-e.json", "public/app/money.html", "link-token (server): mints a Plaid Link token for the client's own file, or for staff on a client in their org"]),
  linkExchange: Object.freeze(["desks-e.json", "public/app/money.html", "link-exchange (server): trades the public token, stores the encrypted item, saves every account on it"]),
  galaxy: Object.freeze(["desks-e.json", "public/app/partner-galaxy.html", "Open the page (partner home; PRINCIPAL_ONLY and NAV_HIDDEN in shell.js, owner reaches it, admin is bounced by ADMIN_BLOCKED)"]),
  social: Object.freeze(["desks-f.json", "social-studio.html", "Connect Facebook / Connect Instagram / Connect LinkedIn buttons (+ LinkedIn organization ID box)"]),
  bizFields: Object.freeze(["desks-f.json", "soft-pull-approve.html", "Business fields: name, street, city, state, ZIP, EIN, incorporated month, extra owner"]),
  agreements: Object.freeze(["desks-f.json", "staff-teams.html", "Editor 'Employment agreements' list and 'Open signed / Open' (downloads the PDF)"]),
  search: Object.freeze(["desks-f.json", "shell.js chrome (loaded by sales-floor, products-commissions, social-studio, staff-teams)", "Search button and Cmd/Ctrl+K: global CRM search (clients, contracts, documents, conversations, pipeline cards)"]),
  leads: Object.freeze(["public-pages.json", "page:leads/<32-hex>/index.html", "Private leads list page (noindex, secret folder name): a local table with Name, Number, Follow up date, Response, Status. Edits save in the browser only; nothing is sent from the page."]),
});

export const FIN_B07_SOURCE = "src/pulse/catalog/proofs/fin-b07-display-contracts.mjs";
export const FIN_B07_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
export const FIN_B07_LIVE_TEST = "src/pulse/catalog/proofs/fin-b07-live-contracts.test.mjs";
export const FIN_B07_DESK_SCENARIOS = "src/pulse/catalog/proofs/fin-b07-live-cases-desk.test.mjs";
export const FIN_B07_REPAIR_SCENARIOS = "src/pulse/catalog/proofs/fin-b07-live-cases-repair.test.mjs";
export const FIN_B07_MISC_SCENARIOS = "src/pulse/catalog/proofs/fin-b07-live-cases-misc.test.mjs";
export const FIN_B07_GATES_TEST = "src/pulse/catalog/proofs/fin-b07-page-gates.test.mjs";
export const FIN_B07_LINK_TOKEN_TEST = "src/pulse/catalog/proofs/fin-b07-link-token.test.mjs";
export const FIN_B07_SEARCH_TEST = "src/pulse/catalog/proofs/fin-b07-search.test.mjs";

function contract(rowKey, requirement, key, body) {
  return Object.freeze({
    control: ROWS[rowKey][2],
    mode: "query",
    emptyAs: "quiet",
    requirement,
    sql: `/* display-result:${key} */\n${body.trim()}`,
    rowKey,
  });
}

const CONTRACTS = Object.freeze([
  // Case drawer
  contract("close", "Every Canceled case must carry a closed stamp and a real client, and a case canceled without ever completing must have no inquiry.removed receipt.", "fin-b07-case-close", CASE_CLOSE_SQL),
  contract("markCleared", "Every Completed case must carry a completed stamp, a real client, and the inquiry.removed receipt for that client dated after the case was requested.", "fin-b07-case-cleared", CASE_CLEARED_SQL),
  contract("generate", "Every inquiry attached to a case must belong to the same client and company as the case and to a bureau the case names.", "fin-b07-case-generate", CASE_GENERATE_SQL),
  contract("send", "A case that holds a mail provider id or an Experian portal reference must have the matching letter or portal attempt on the client's inquiries, a real client, and never read Queued.", "fin-b07-case-send", CASE_SEND_SQL),
  contract("upload", "Every file saved as an FTC or police report must be one document with a current version that holds a storage key, a size, a checksum and a sniffed pdf, png or jpeg type.", "fin-b07-case-upload", CASE_UPLOAD_SQL),
  contract("caseQueue", "Every open case on the queue must name a real client in this company, a requested time, a bureau, a non-negative item count, and a funding round that exists when it names one.", "fin-b07-case-queue", CASE_QUEUE_SQL),
  contract("caseStatuses", "A Completed case must carry a completed stamp, a Canceled case a closed stamp, and every case must hold one of the seven statuses the Status column knows.", "fin-b07-case-statuses", CASE_STATUS_SQL),
  // Work queue
  contract("workQueue", "Every open disputed inquiry line must name a real client in this company, a bureau, the name the bureau reported, and a non-negative attempt count.", "fin-b07-work-queue", WORK_QUEUE_SQL),
  contract("workRow", "Every attempt in a row's history must name a real staff member of the same company, and every identity on file must hold only the encrypted social security number, never plain digits.", "fin-b07-work-row", WORK_ROW_SQL),
  contract("logAttempt", "Every logged attempt must name a staff member and an inquiry of the same company, and the inquiry's attempt counter must equal its call, letter and portal attempts.", "fin-b07-log-attempt", LOG_ATTEMPT_SQL),
  contract("markConfirmed", "Every confirmed inquiry must be closed with a cleared stamp, belong to the case's client, and its case must be Completed once no inquiry on it is still open.", "fin-b07-mark-confirmed", MARK_CONFIRMED_SQL),
  contract("setStatus", "Every saved status must be trimmed and not blank, and a status that says removed, confirmed, deleted or cleared must carry the confirmed stamp.", "fin-b07-set-status", SET_STATUS_SQL),
  contract("saveExpected", "Every saved expected creditor name must be trimmed, not blank, and at most 200 characters.", "fin-b07-save-expected", SAVE_EXPECTED_SQL),
  contract("reveal", "Every social security number reveal must name its reason in the log field, a real client, and a staff member of this company when the actor is a staff id.", "fin-b07-reveal", REVEAL_SQL),
  contract("recentLetters", "Every letter or portal upload listed must name a real client, a bureau and a staff member, and a mail that failed must have a later sent letter for the same inquiry.", "fin-b07-recent-letters", RECENT_LETTERS_SQL),
  // Repair queue
  contract("repairQueue", "Every card on the optimization board must name a real client, a stage that belongs to that board, and an entry time the clocks can run from.", "fin-b07-repair-queue", REPAIR_QUEUE_SQL),
  contract("repairRow", "Every open dispute case must hold only items and letters of its own client, a real client, and a board card of the same client when it names one.", "fin-b07-repair-row", REPAIR_ROW_SQL),
  contract("stIntake", "Every file in intake must be within three business days of entering it (judged at five calendar days).", "fin-b07-stage-intake", STAGE_INTAKE_SQL),
  contract("stAwaitDocs", "Every file waiting on papers must be within fourteen days of entering the stage.", "fin-b07-stage-await-docs", STAGE_AWAIT_DOCS_SQL),
  contract("stAnalysis", "Every file in analysis must be within one hour of entering the stage.", "fin-b07-stage-analysis", STAGE_ANALYSIS_SQL),
  contract("stLettersGen", "Every file in letters made must be within thirty minutes of entering the stage and must hold at least one dispute letter.", "fin-b07-stage-letters-generated", STAGE_LETTERS_GEN_SQL),
  contract("stReady", "Every file in ready to send must be within four hours of entering the stage and must hold a letter that is generated or ready.", "fin-b07-stage-ready", STAGE_READY_SQL),
  contract("stTransit", "Every file in the mail must be within ten days of entering the stage and must hold a letter that was sent or delivered.", "fin-b07-stage-transit", STAGE_TRANSIT_SQL),
  contract("stAwaitResp", "Every file waiting on a bureau must hold an open case with a response due time, and that time must not be more than five days past.", "fin-b07-stage-await-response", STAGE_AWAIT_RESP_SQL),
  contract("stRespRecv", "Every file with an answer in must be within twenty-four hours of entering the stage and must hold a saved bureau response.", "fin-b07-stage-response-received", STAGE_RESP_RECV_SQL),
  contract("stRoundComplete", "Every file shown as round done must hold a saved bureau response or a round complete or response parsed receipt.", "fin-b07-stage-round-complete", STAGE_ROUND_DONE_SQL),
  contract("stStalled", "Every stuck file must hold a recorded stall decision or a dispute case marked stalled, so the human queue says why.", "fin-b07-stage-stalled", STAGE_STALLED_SQL),
  contract("stProgramComplete", "Every file shown as done must belong to a client whose repair program is complete or upsell pending, or hold the program complete receipt.", "fin-b07-stage-program-complete", STAGE_PROGRAM_DONE_SQL),
  contract("stCancelled", "A file shown as cancelled must never belong to a client whose repair program is still active.", "fin-b07-stage-cancelled", STAGE_CANCELLED_SQL),
  contract("rowSend", "Every mailed letter must carry both mailing stamps and a case whose bureau clock started, and no letter may sit claimed and not mailed for more than a day.", "fin-b07-row-send", ROW_SEND_SQL),
  contract("letterSendOne", "Every mailed letter must have a bureau or a furnisher address, and no other letter for the same case, bureau, round and target may also carry a mailed stamp.", "fin-b07-letter-send-one", LETTER_ONE_SQL),
  contract("rowStage", "Every staged letter must belong to a case of the same client, hold its words, carry a furnisher address when it goes to a furnisher, and be unmailed.", "fin-b07-row-stage", ROW_STAGE_SQL),
  contract("clean", "Every completed client erasure must leave no identity, bank login or bank account created before it finished, and must leave the client row cleared of name, email and phone.", "fin-b07-clean-personal", CLEAN_PERSONAL_SQL),
  // Money vault, Plaid, lenders, soft pull, staff teams, social
  contract("vaultUpload", "Every client or staff upload must be one document with a current version that holds a storage key, a size, a checksum and a sniffed pdf, png or jpeg type, filed under a business of the same client.", "fin-b07-vault-upload", VAULT_UPLOAD_SQL),
  contract("linkExchange", "Every active bank link must hold an encrypted token, a consent stamp, at least one saved account of the same client, and a Plaid item id.", "fin-b07-link-exchange", LINK_EXCHANGE_SQL),
  contract("lenderApply", "Every proxy session must name a real client, an application address, a lender or application of the same client, and must not sit verifying for more than fifteen minutes.", "fin-b07-lender-apply", LENDER_APPLY_SQL),
  contract("applyDialog", "Every ended, failed or mismatched proxy session must carry an end time that is not before its start, and the staff member who launched it.", "fin-b07-apply-dialog", APPLY_DIALOG_SQL),
  contract("bizFields", "Every business saved by the approval form must hold a name, street, city, state, ZIP, an EIN of the form NN-NNNNNNN, an incorporated month, and an age in months that does not exceed its age today.", "fin-b07-business-fields", BUSINESS_FIELDS_SQL),
  contract("agreements", "Every staff employment agreement must name a real staff member, a file once sent, and for a signed one a signed time, signer name and a signed copy that exists.", "fin-b07-agreements", AGREEMENTS_SQL),
  contract("social", "Every connected social channel must belong to a partner of the same company, name a known channel and account, and hold a token when active.", "fin-b07-social-connect", SOCIAL_CONNECT_SQL),
]);

/** The contracts the display lane judges. The row key is internal and is dropped here. */
export const FIN_B07_RESULT_CONTRACTS = Object.freeze(
  CONTRACTS.map(({ rowKey, ...rest }) => Object.freeze(rest)),
);

/** The exact map rows [sourceFile, surface, control] each live check is attached to. */
export const FIN_B07_LIVE_ROWS = Object.freeze(CONTRACTS.map((c) => ROWS[c.rowKey]));

function liveCase([sourceFile, surface, control], tests) {
  return Object.freeze({
    sourceFile,
    surface,
    control,
    depth: "deep",
    evidence: `${tests.join("; ")}; ${FIN_B07_LANE}`,
    tests: Object.freeze([...tests]),
  });
}

const REPAIR_KEYS = new Set(["repairQueue", "repairRow", "stIntake", "stAwaitDocs", "stAnalysis", "stLettersGen", "stReady",
  "stTransit", "stAwaitResp", "stRespRecv", "stRoundComplete", "stStalled", "stProgramComplete", "stCancelled",
  "rowSend", "letterSendOne", "rowStage"]);
const MISC_KEYS = new Set(["vaultUpload", "linkExchange", "lenderApply", "applyDialog", "bizFields", "agreements", "social"]);

/** The scenario file that runs this row's exact SQL over stand-in rows. */
function scenariosFor(rowKey) {
  if (REPAIR_KEYS.has(rowKey)) return FIN_B07_REPAIR_SCENARIOS;
  if (MISC_KEYS.has(rowKey)) return FIN_B07_MISC_SCENARIOS;
  return FIN_B07_DESK_SCENARIOS;
}

/**
 * Rows that display-batch-staff-ui.mjs already holds as deep cases (with their own browser tests).
 * Repeating them here would put two results on one row, so the contract alone is what turns them
 * from not proved to a live check. fin-b07-live-contracts.test.mjs keeps this list equal to the
 * staff file, so it cannot rot.
 */
export const FIN_B07_ALREADY_DEEP = Object.freeze(["workQueue", "workRow", "markConfirmed", "repairRow", "bizFields"]);

/** Rows judged by the live lane. Also handed to the catalog compiler as deep cases. */
export const FIN_B07_LIVE_CASES = Object.freeze(
  CONTRACTS
    .filter((c) => !FIN_B07_ALREADY_DEEP.includes(c.rowKey))
    .map((c) => liveCase(ROWS[c.rowKey], [scenariosFor(c.rowKey), FIN_B07_LIVE_TEST])),
);

function practiceCase(rowKey, test) {
  const [sourceFile, surface, control] = ROWS[rowKey];
  return Object.freeze({ sourceFile, surface, control, depth: "deep", evidence: test, tests: Object.freeze([test]) });
}

/** Rows proved by a practice test that runs the real page script or handler with fake answers. */
export const FIN_B07_PRACTICE_CASES = Object.freeze([
  practiceCase("irGate", FIN_B07_GATES_TEST),
  practiceCase("galaxy", FIN_B07_GATES_TEST),
  practiceCase("linkToken", FIN_B07_LINK_TOKEN_TEST),
  practiceCase("search", FIN_B07_SEARCH_TEST),
]);

export const FIN_B07_DISPLAY_CASES = Object.freeze([...FIN_B07_LIVE_CASES, ...FIN_B07_PRACTICE_CASES]);

/** Rows this batch looked at and cannot attach without a product change. Each reason is exact. */
export const FIN_B07_NOT_ATTACHABLE = Object.freeze([
  Object.freeze({
    rowKey: "banksGate",
    reason: "public/app/money-banks.js draws the staff plan forms when a client_id is in the address (var staff = !!clientId), not when the person's role is staff. A signed-in client who types ?client_id= sees them, so the row's claim 'only staff see plan controls' is not true of the page. Only a product change (gate by role) makes it provable.",
  }),
  Object.freeze({
    rowKey: "leads",
    reason: "The page file public/leads/<32-hex>/index.html is excluded from git (.git/info/exclude). It exists only in the owner's main folder, so no fresh checkout, CI run or deployed bundle can read it, and a test of it would be green on one machine only. It leaves no saved result (edits live in the browser).",
  }),
]);
