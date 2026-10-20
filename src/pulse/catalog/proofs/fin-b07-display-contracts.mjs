// Finish-853 batch 07: live saved-result checks (and the list of practice-tested rows) for the
// Specialist desk (inquiry-remover.html), the lenders Apply proxy, the money vault and Plaid door,
// soft-pull business fields, staff employment agreements and the social Connect buttons.
//
// Repair cycle 1 (2026-10-15): an independent checker broke each of these on purpose. Every row whose check
// stayed green on a break was strengthened (the SQL, or a practice test attached beside it), or, where the
// row's own claim is false of the product, taken OFF so it is NOT_PROVED again (see FIN_B07_NOT_ATTACHABLE).
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
export const FIN_B07_WORK_SCENARIOS = "src/pulse/catalog/proofs/fin-b07-live-cases-work.test.mjs";
export const FIN_B07_REPAIR_SCENARIOS = "src/pulse/catalog/proofs/fin-b07-live-cases-repair.test.mjs";
export const FIN_B07_MISC_SCENARIOS = "src/pulse/catalog/proofs/fin-b07-live-cases-misc.test.mjs";
export const FIN_B07_GATES_TEST = "src/pulse/catalog/proofs/fin-b07-page-gates.test.mjs";
const FIN_B13_SPECIALIST_TEST = "src/pulse/catalog/proofs/fin-b13-specialist-desk.test.mjs";
export const FIN_B07_LINK_TOKEN_TEST = "src/pulse/catalog/proofs/fin-b07-link-token.test.mjs";
export const FIN_B07_SEARCH_TEST = "src/pulse/catalog/proofs/fin-b07-search.test.mjs";
export const FIN_B07_LEADS_TEST = "src/pulse/coverage/fin-b07-leads-page.test.mjs";
export const FIN_B07_DESK_PAGE_TEST = "src/pulse/catalog/proofs/fin-b07-desk-page.test.mjs";
export const FIN_B07_DESK_BUTTONS_TEST = "src/pulse/catalog/proofs/fin-b07-desk-buttons.test.mjs";
export const FIN_B07_CASE_QUEUE_READ_TEST = "src/pulse/catalog/proofs/fin-b07-case-queue-read.test.mjs";
export const FIN_B07_REPAIR_READ_TEST = "src/pulse/catalog/proofs/fin-b07-repair-read.test.mjs";
export const FIN_B07_CLEAN_TEST = "src/pulse/catalog/proofs/fin-b07-clean-personal.test.mjs";
export const FIN_B07_BUSINESS_SAVE_TEST = "src/pulse/catalog/proofs/fin-b07-business-save.test.mjs";
export const FIN_B07_APPLY_TEST = "src/pulse/catalog/proofs/fin-b07-apply-dialog.test.mjs";
export const FIN_B07_LINK_EXCHANGE_TEST = "src/pulse/catalog/proofs/fin-b07-link-exchange.test.mjs";
export const FIN_B07_VAULT_TEST = "src/pulse/catalog/proofs/fin-b07-vault-upload.test.mjs";
export const FIN_B07_SHELL_SEARCH_TEST = "src/pulse/catalog/proofs/fin-b07-shell-search.test.mjs";
const STAFF_UI_TEST = "src/pulse/catalog/proofs/display-batch-staff-ui.test.mjs";

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
  contract("markCleared", "Every Completed case must carry a completed stamp, a real client, and an inquiry.removed receipt for THAT case (its own case id), for that client, dated after the case was requested.", "fin-b07-case-cleared", CASE_CLEARED_SQL),
  contract("generate", "Every inquiry attached to a case must belong to the same client and company as the case and to a bureau the case names.", "fin-b07-case-generate", CASE_GENERATE_SQL),
  contract("send", "A case that holds a mail provider id or an Experian portal reference must have the matching sent letter or portal attempt for ITS OWN bureau after it was requested, a real client, and never read Queued; and a case that reads In Progress after a mail that failed must have a sent letter too.", "fin-b07-case-send", CASE_SEND_SQL),
  contract("upload", "Every file sent as an FTC or police report (filed as additional_fraud_docs, or labeled that when the upload was sent) must be filed as additional_fraud_docs, as one document with a current version that holds a storage key, a size, a checksum and a sniffed pdf, png or jpeg type.", "fin-b07-case-upload", CASE_UPLOAD_SQL),
  contract("caseQueue", "Every open case on the queue must name a client in this company, a bureau, an Items count that is not lower than the open inquiries attached to the case, and, when it names a funding round, a round of the same client.", "fin-b07-case-queue", CASE_QUEUE_SQL),
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
  contract("repairQueue", "Every card on the optimization board must name a client in this company and a stage that belongs to that board, and every active repair program must have a card on that board, a program word the desk knows and at least one round.", "fin-b07-repair-queue", REPAIR_QUEUE_SQL),
  contract("repairRow", "Every open dispute case touched in the last 60 days must hold only letters of its own client and its own round, a client in this company, and no timeline entry that points at another client's case.", "fin-b07-repair-row", REPAIR_ROW_SQL),
  contract("stIntake", "Every file in intake must be within three business days of entering it (judged at five calendar days).", "fin-b07-stage-intake", STAGE_INTAKE_SQL),
  contract("stAwaitDocs", "Every file waiting on papers must be within fourteen days of entering the stage.", "fin-b07-stage-await-docs", STAGE_AWAIT_DOCS_SQL),
  contract("stAnalysis", "Every file in analysis must be within one hour of entering the stage.", "fin-b07-stage-analysis", STAGE_ANALYSIS_SQL),
  contract("stLettersGen", "Every file in letters made must be within thirty minutes of entering the stage and must hold at least one dispute letter.", "fin-b07-stage-letters-generated", STAGE_LETTERS_GEN_SQL),
  contract("stReady", "Every file in ready to send must be within four hours of entering the stage and must hold a letter that is generated or ready.", "fin-b07-stage-ready", STAGE_READY_SQL),
  contract("stTransit", "Every file in the mail must be within ten days of entering the stage and must hold a letter that was sent or delivered.", "fin-b07-stage-transit", STAGE_TRANSIT_SQL),
  contract("stAwaitResp", "Every file waiting on a bureau must hold an open case of its CURRENT round with a response due time, and no open case of that round may be more than five days past due (an older round's overdue case does not count).", "fin-b07-stage-await-response", STAGE_AWAIT_RESP_SQL),
  contract("stRespRecv", "Every file with an answer in must be within twenty-four hours of entering the stage and must hold a saved bureau response.", "fin-b07-stage-response-received", STAGE_RESP_RECV_SQL),
  contract("stRoundComplete", "Every file shown as round done must hold a saved bureau response or a round complete or response parsed receipt.", "fin-b07-stage-round-complete", STAGE_ROUND_DONE_SQL),
  contract("stStalled", "Every stuck file must hold a recorded stall decision or a dispute case marked stalled, so the human queue says why.", "fin-b07-stage-stalled", STAGE_STALLED_SQL),
  contract("stProgramComplete", "Every file shown as done must belong to a client whose repair program is complete or upsell pending, or hold the program complete receipt.", "fin-b07-stage-program-complete", STAGE_PROGRAM_DONE_SQL),
  contract("stCancelled", "A file shown as cancelled must never belong to a client whose repair program is still active.", "fin-b07-stage-cancelled", STAGE_CANCELLED_SQL),
  contract("rowSend", "Every mailed letter must carry both mailing stamps and a case whose bureau clock started, and no letter may sit claimed and not mailed for more than a day.", "fin-b07-row-send", ROW_SEND_SQL),
  contract("letterSendOne", "Every mailed letter must have a bureau and, for a furnisher, an address; no other letter of the same case, bureau, round and target may also be out (mailed stamp, or sending, sent or delivered); and no provider letter id may be recorded on two letters.", "fin-b07-letter-send-one", LETTER_ONE_SQL),
  contract("rowStage", "Every staged letter must belong to a case of the same client, hold its words, carry a furnisher address when it goes to a furnisher, and be unmailed.", "fin-b07-row-stage", ROW_STAGE_SQL),
  contract("clean", "Every completed client erasure must leave no identity, bank login or bank account from before it finished, no merchant name or provider payload on the client's bank transactions, and a client row with both names erased and no email, phone, CRM contact id, CRM field bag or tags.", "fin-b07-clean-personal", CLEAN_PERSONAL_SQL),
  // Money vault, Plaid, lenders, soft pull, staff teams, social
  contract("vaultUpload", "Every client or staff upload must be one document holding exactly one version (that is a storage key, a size, a checksum and a sniffed pdf, png or jpeg type), must not share its stored file with another document, and must be filed under a business of the same client that was not archived before the paper arrived.", "fin-b07-vault-upload", VAULT_UPLOAD_SQL),
  contract("linkExchange", "Every active bank link must hold a sealed token (key id, iv, tag and ciphertext, never a bare access token), a consent stamp and a non-empty consent scope, at least one saved account of the same client, and a Plaid item id.", "fin-b07-link-exchange", LINK_EXCHANGE_SQL),
  contract("lenderApply", "Every proxy session must name a real client, an application address that is its lender's (or its application's) own, a lender or application of the same client, an exit in the requested city or state when active, and must not sit verifying for more than fifteen minutes.", "fin-b07-lender-apply", LENDER_APPLY_SQL),
  contract("applyDialog", "Every ended, failed or mismatched proxy session must carry an end time that is not before its start, and the staff member who launched it. That End session really ends an active session is held by the attached practice test.", "fin-b07-apply-dialog", APPLY_DIALOG_SQL),
  contract("bizFields", "Every business saved by the approval form must hold a name, street, city, a two-capital-letter state, a five-digit (or ZIP+4) ZIP, an EIN of the form NN-NNNNNNN made of digits, an incorporated month from 01 to 12, and an age in months within one month of the months between that month and the day it was saved.", "fin-b07-business-fields", BUSINESS_FIELDS_SQL),
  contract("agreements", "Every staff employment agreement must name a real staff member, a file once sent, and for a signed one a signed time, signer name and a signed copy that exists.", "fin-b07-agreements", AGREEMENTS_SQL),
  contract("social", "Every connected social channel must belong to a partner of the same company, name a known channel and account, and hold a token when active.", "fin-b07-social-connect", SOCIAL_CONNECT_SQL),
]);

/** The contracts the display lane judges. The row key is internal and is dropped here. */
export const FIN_B07_RESULT_CONTRACTS = Object.freeze(
  CONTRACTS.map(({ rowKey, ...rest }) => Object.freeze(rest)),
);

const UNATTACHED = Object.freeze([]);
export const FIN_B07_UNATTACHED_CONTRACTS = Object.freeze(
  UNATTACHED.map(({ rowKey, ...rest }) => Object.freeze(rest)),
);

/**
 * Generation 2: the private leads list page. No SQL: the page holds names and numbers and is git-excluded,
 * so the lane GETs the live page (the address comes from the registry row that pings it, at run time) and
 * judges five promises of the row. src/pulse/coverage/fin-b07-leads-page.mjs holds the read and the judge.
 */
export const FIN_B07_PAGE_CONTRACTS = Object.freeze([
  Object.freeze({
    control: ROWS.leads[2],
    mode: "live-page",
    page: "leads-list",
    requirement: "The live page must open, tell search engines to keep it out, show the columns Name, Number, Follow up date, Response and Status in that order, hold nothing that can send data out (no network call, no moving or opening from script, no address set from script, no ping, no module import), and keep edits in the browser (its script reads and writes localStorage).",
    sql: null,
  }),
]);

/** The exact map rows [sourceFile, surface, control] each live check is attached to. */
export const FIN_B07_LIVE_ROWS = Object.freeze(CONTRACTS.map((c) => ROWS[c.rowKey]));

/** Every practice test and scenario file a live row is judged by, beside the shared lane. */
const EXTRA_TESTS = Object.freeze({
  send: ["src/inquiry-ops/send.test.mjs"],
  clean: [FIN_B07_CLEAN_TEST, FIN_B07_DESK_BUTTONS_TEST],
  caseQueue: [FIN_B07_DESK_PAGE_TEST, FIN_B07_CASE_QUEUE_READ_TEST, "src/inquiry-ops/cases.test.mjs"],
  upload: [FIN_B07_DESK_BUTTONS_TEST],
  repairQueue: [FIN_B07_DESK_PAGE_TEST, FIN_B07_REPAIR_READ_TEST, "src/repair/cases.test.mjs", "src/http/repair-cases-read.test.mjs"],
  stAwaitResp: [FIN_B07_DESK_PAGE_TEST],
  lenderApply: [FIN_B07_APPLY_TEST, "src/proxy/launch.test.mjs"],
  applyDialog: [FIN_B07_APPLY_TEST],
  vaultUpload: [FIN_B07_VAULT_TEST],
  linkExchange: [FIN_B07_LINK_EXCHANGE_TEST],
});

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
const WORK_KEYS = new Set(["workQueue", "workRow", "logAttempt", "markConfirmed", "setStatus", "saveExpected", "reveal", "recentLetters", "clean"]);

/** The scenario file that runs this row's exact SQL over stand-in rows. */
function scenariosFor(rowKey) {
  if (REPAIR_KEYS.has(rowKey)) return FIN_B07_REPAIR_SCENARIOS;
  if (MISC_KEYS.has(rowKey)) return FIN_B07_MISC_SCENARIOS;
  if (WORK_KEYS.has(rowKey)) return FIN_B07_WORK_SCENARIOS;
  return FIN_B07_DESK_SCENARIOS;
}

/**
 * Rows display-batch-staff-ui.mjs already holds as deep cases (a Playwright spec through
 * display-batch-staff-ui.test.mjs). The compiler is handed that case, so the contract alone turns these
 * from not proved to a live check, and they are NOT repeated in FIN_B07_LIVE_CASES (two results on one
 * row would be two entries in the compiled catalog). Where this batch adds practice tests to such a
 * row, FIN_B07_STAFF_EXTENDED below replaces the case in the PROOF chain only, keeping the staff test
 * and adding these. fin-b07-live-contracts.test.mjs keeps this list equal to the staff file.
 */
export const FIN_B07_ALREADY_DEEP = Object.freeze(["workQueue", "workRow", "markConfirmed", "repairRow", "bizFields"]);

/** Tests added beside the staff file's own, per already-deep row. */
const STAFF_EXTENDED_TESTS = Object.freeze({
  workQueue: [FIN_B13_SPECIALIST_TEST],
  workRow: [FIN_B07_DESK_PAGE_TEST],
  repairRow: [FIN_B07_DESK_PAGE_TEST, FIN_B07_REPAIR_READ_TEST, "src/repair/cases.test.mjs", "src/http/repair-cases-read.test.mjs"],
  bizFields: [FIN_B07_BUSINESS_SAVE_TEST, "src/http/soft-pull-approve.test.mjs"],
});

/** Rows judged by the live lane. Also handed to the catalog compiler as deep cases. */
export const FIN_B07_LIVE_CASES = Object.freeze([
  ...CONTRACTS
    .filter((c) => !FIN_B07_ALREADY_DEEP.includes(c.rowKey))
    .map((c) => liveCase(ROWS[c.rowKey], [scenariosFor(c.rowKey), FIN_B07_LIVE_TEST, ...(EXTRA_TESTS[c.rowKey] || [])])),
  // The leads page: a live GET, judged by its own test file.
  liveCase(ROWS.leads, [FIN_B07_LEADS_TEST]),
]);

/**
 * The already-deep rows this batch added tests to. Proof chain only: the compiler already has the staff
 * file's case for each, and its contract (above) is what turns it live. The staff test stays first so the
 * browser spec it runs is still part of the evidence.
 */
export const FIN_B07_STAFF_EXTENDED = Object.freeze(Object.keys(STAFF_EXTENDED_TESTS).map((rowKey) =>
  liveCase(ROWS[rowKey], [STAFF_UI_TEST, scenariosFor(rowKey), FIN_B07_LIVE_TEST, ...STAFF_EXTENDED_TESTS[rowKey]])));

function practiceCase(rowKey, tests) {
  const [sourceFile, surface, control] = ROWS[rowKey];
  return Object.freeze({ sourceFile, surface, control, depth: "deep", evidence: tests.join("; "), tests: Object.freeze([...tests]) });
}

/** Rows proved by a practice test that runs the real page script or handler with fake answers. */
export const FIN_B07_PRACTICE_CASES = Object.freeze([
  practiceCase("banksGate", [FIN_B07_GATES_TEST]),
  practiceCase("irGate", [FIN_B07_GATES_TEST]),
  practiceCase("galaxy", [FIN_B07_GATES_TEST]),
  practiceCase("linkToken", [FIN_B07_LINK_TOKEN_TEST]),
  practiceCase("search", [FIN_B07_SEARCH_TEST, FIN_B07_SHELL_SEARCH_TEST]),
]);

export const FIN_B07_DISPLAY_CASES = Object.freeze([...FIN_B07_LIVE_CASES, ...FIN_B07_STAFF_EXTENDED, ...FIN_B07_PRACTICE_CASES]);

export const FIN_B07_NOT_ATTACHABLE = Object.freeze([]);
