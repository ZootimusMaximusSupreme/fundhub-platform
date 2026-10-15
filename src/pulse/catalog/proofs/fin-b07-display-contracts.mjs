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
// built from the real column names. This file imports nothing: it is read at build time by
// scripts/pulse/compile-catalog.mjs, and the live bundle reads the compiled copy in generated.json.

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

const W60 = "now() - interval '60 days'";
const W30 = "now() - interval '30 days'";

// ── Specialist desk: inquiry removal cases ───────────────────────────────────────────────────

const CASE_CLOSE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.closed_at IS NULL
         OR cl.id IS NULL
         OR (c.completed_at IS NULL AND EXISTS (
              SELECT 1 FROM events e
               WHERE e.org_id = c.org_id AND e.name = 'inquiry.removed'
                 AND (e.payload->>'inquiryRemovalCaseId' = c.id::text OR e.payload->>'caseId' = c.id::text))))::int AS bad_count
  FROM inquiry_removal_cases c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
 WHERE c.org_id = $1::uuid AND c.case_status::text = 'Canceled'
   AND COALESCE(c.is_demo, false) = false
   AND c.updated_at >= ${W60}`;

const CASE_CLEARED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.completed_at IS NULL
         OR cl.id IS NULL
         OR NOT EXISTS (
              SELECT 1 FROM events e
               WHERE e.org_id = c.org_id AND e.name = 'inquiry.removed'
                 AND e.client_id = c.client_id
                 AND e.created_at >= COALESCE(c.requested_at, c.created_at)))::int AS bad_count
  FROM inquiry_removal_cases c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
 WHERE c.org_id = $1::uuid AND c.case_status::text = 'Completed'
   AND COALESCE(c.is_demo, false) = false
   AND c.updated_at >= ${W60}`;

const CASE_GENERATE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.id IS NULL
         OR l.client_id IS DISTINCT FROM c.client_id
         OR l.org_id IS DISTINCT FROM c.org_id
         OR (upper(COALESCE(l.bureau, '')) IN ('EX', 'EQ', 'TU') AND NOT (
               upper(COALESCE(c.selected_bureaus_raw, '')) LIKE '%' || upper(l.bureau) || '%'
               OR (upper(l.bureau) = 'TU' AND upper(COALESCE(c.selected_bureaus_raw, '')) LIKE '%TRANS%'))))::int AS bad_count
  FROM inquiry_log l
  LEFT JOIN inquiry_removal_cases c ON c.id = l.case_id
 WHERE l.org_id = $1::uuid AND l.case_id IS NOT NULL
   AND COALESCE(l.is_demo, false) = false
   AND l.updated_at >= ${W60}`;

const CASE_SEND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR c.case_status::text = 'Queued'
         OR (c.letter_provider_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM inquiry_attempts a
                 JOIN inquiry_log l ON l.id = a.inquiry_id
                WHERE a.org_id = c.org_id AND l.client_id = c.client_id
                  AND a.kind = 'letter' AND a.outcome = 'sent'))
         OR (c.portal_confirmation IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM inquiry_attempts a
                 JOIN inquiry_log l ON l.id = a.inquiry_id
                WHERE a.org_id = c.org_id AND l.client_id = c.client_id
                  AND a.kind = 'portal' AND a.note = 'experian_ref:' || c.portal_confirmation)))::int AS bad_count
  FROM inquiry_removal_cases c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
 WHERE c.org_id = $1::uuid
   AND (c.letter_provider_id IS NOT NULL OR c.portal_confirmation IS NOT NULL)
   AND COALESCE(c.is_demo, false) = false
   AND c.updated_at >= ${W60}`;

const CASE_QUEUE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR c.requested_at IS NULL
         OR NULLIF(BTRIM(COALESCE(c.selected_bureaus_raw, '')), '') IS NULL
         OR COALESCE(c.open_inquiry_count, 0) < 0
         OR (c.funding_round_id IS NOT NULL AND fr.id IS NULL))::int AS bad_count
  FROM inquiry_removal_cases c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
  LEFT JOIN funding_rounds fr ON fr.org_id = c.org_id AND fr.id = c.funding_round_id
 WHERE c.org_id = $1::uuid
   AND c.case_status::text IN ('Queued', 'Scheduled', 'In Progress', 'Escalated', 'Blocked')
   AND COALESCE(c.is_demo, false) = false
   AND c.updated_at >= ${W60}`;

const CASE_STATUS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE (c.case_status::text = 'Completed' AND c.completed_at IS NULL)
         OR (c.case_status::text = 'Canceled' AND c.closed_at IS NULL)
         OR (c.case_status::text NOT IN ('Queued', 'Scheduled', 'In Progress', 'Escalated', 'Blocked', 'Completed', 'Canceled')))::int AS bad_count
  FROM inquiry_removal_cases c
 WHERE c.org_id = $1::uuid
   AND COALESCE(c.is_demo, false) = false
   AND c.updated_at >= ${W60}`;

const CASE_UPLOAD_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR v.id IS NULL
         OR NULLIF(BTRIM(COALESCE(v.storage_key, '')), '') IS NULL
         OR COALESCE(v.byte_size, 0) <= 0
         OR NULLIF(BTRIM(COALESCE(v.checksum, '')), '') IS NULL
         OR COALESCE(v.mime_type, '') NOT IN ('application/pdf', 'image/png', 'image/jpeg'))::int AS bad_count
  FROM documents d
  LEFT JOIN clients cl ON cl.org_id = d.org_id AND cl.id = d.client_id
  LEFT JOIN document_versions v ON v.org_id = d.org_id AND v.id = d.current_version_id
 WHERE d.org_id = $1::uuid AND d.subtype = 'additional_fraud_docs'
   AND COALESCE(d.is_demo, false) = false
   AND d.created_at >= ${W60}`;

// ── Specialist desk: the work queue (inquiry_log) ────────────────────────────────────────────

const WORK_QUEUE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(l.bureau, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(l.inquiry_name, l.inquiry, '')), '') IS NULL
         OR COALESCE(l.call_attempts, 0) < 0)::int AS bad_count
  FROM inquiry_log l
  LEFT JOIN clients cl ON cl.org_id = l.org_id AND cl.id = l.client_id
 WHERE l.org_id = $1::uuid AND COALESCE(l.is_open, true) = true
   AND COALESCE(l.is_demo, false) = false
   AND l.updated_at >= ${W60}`;

const WORK_ROW_SQL = `
SELECT ((SELECT count(*) FROM inquiry_attempts a
          JOIN inquiry_log l ON l.id = a.inquiry_id
         WHERE a.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false AND a.created_at >= ${W60})
      + (SELECT count(*) FROM pii_identity p
          JOIN clients c ON c.org_id = p.org_id AND c.id = p.client_id
         WHERE p.org_id = $1::uuid AND p.ssn_enc IS NOT NULL AND COALESCE(c.is_demo, false) = false
           AND p.updated_at >= ${W60}))::int AS sample_count,
       ((SELECT count(*) FROM inquiry_attempts a
          JOIN inquiry_log l ON l.id = a.inquiry_id
          LEFT JOIN staff s ON s.id = a.staff_id
         WHERE a.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false AND a.created_at >= ${W60}
           AND (l.org_id IS DISTINCT FROM a.org_id OR s.id IS NULL OR s.org_id IS DISTINCT FROM a.org_id
                OR NULLIF(BTRIM(COALESCE(s.name, '')), '') IS NULL))
      + (SELECT count(*) FROM pii_identity p
          JOIN clients c ON c.org_id = p.org_id AND c.id = p.client_id
         WHERE p.org_id = $1::uuid AND p.ssn_enc IS NOT NULL AND COALESCE(c.is_demo, false) = false
           AND p.updated_at >= ${W60} AND length(p.ssn_enc) < 30))::int AS bad_count`;

const LOG_ATTEMPT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE l.id IS NULL
         OR l.org_id IS DISTINCT FROM a.org_id
         OR s.id IS NULL
         OR s.org_id IS DISTINCT FROM a.org_id
         OR COALESCE(l.call_attempts, 0) IS DISTINCT FROM (
              SELECT count(*) FROM inquiry_attempts x
               WHERE x.inquiry_id = a.inquiry_id AND x.kind IN ('call', 'letter', 'portal')))::int AS bad_count
  FROM inquiry_attempts a
  LEFT JOIN inquiry_log l ON l.id = a.inquiry_id
  LEFT JOIN staff s ON s.id = a.staff_id
 WHERE a.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false
   AND a.created_at >= ${W60}`;

const MARK_CONFIRMED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR COALESCE(l.is_open, true) = true
         OR l.cleared_at IS NULL
         OR (c.id IS NOT NULL AND (
               c.client_id IS DISTINCT FROM l.client_id
               OR (c.case_status::text IN ('Queued', 'Scheduled', 'In Progress', 'Escalated', 'Blocked')
                   AND NOT EXISTS (
                     SELECT 1 FROM inquiry_log o
                      WHERE o.case_id = c.id AND COALESCE(o.is_open, true) = true)))))::int AS bad_count
  FROM inquiry_log l
  LEFT JOIN clients cl ON cl.org_id = l.org_id AND cl.id = l.client_id
  LEFT JOIN inquiry_removal_cases c ON c.id = l.case_id
 WHERE l.org_id = $1::uuid AND l.confirmed_at IS NOT NULL
   AND COALESCE(l.is_demo, false) = false
   AND l.updated_at >= ${W60}`;

const SET_STATUS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE l.status <> TRIM(l.status)
         OR NULLIF(TRIM(l.status), '') IS NULL
         OR (l.confirmed_at IS NULL AND (
               lower(l.status) LIKE '%removed%' OR lower(l.status) LIKE '%confirmed%'
               OR lower(l.status) LIKE '%deleted%' OR lower(l.status) LIKE '%cleared%')))::int AS bad_count
  FROM inquiry_log l
 WHERE l.org_id = $1::uuid AND l.status IS NOT NULL
   AND COALESCE(l.is_demo, false) = false
   AND l.updated_at >= ${W60}`;

const SAVE_EXPECTED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(TRIM(l.expected_name), '') IS NULL
         OR l.expected_name <> TRIM(l.expected_name)
         OR length(l.expected_name) > 200)::int AS bad_count
  FROM inquiry_log l
 WHERE l.org_id = $1::uuid AND l.expected_name IS NOT NULL
   AND COALESCE(l.is_demo, false) = false
   AND l.updated_at >= ${W60}`;

const REVEAL_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(a.accessed_by, '')), '') IS NULL
         OR a.field NOT LIKE 'ssn (%)'
         OR (length(a.accessed_by) = 36 AND s.id IS NULL))::int AS bad_count
  FROM pii_access_log a
  LEFT JOIN clients cl ON cl.org_id = a.org_id AND cl.id = a.client_id
  LEFT JOIN staff s ON s.org_id = a.org_id AND s.id::text = a.accessed_by
 WHERE a.org_id = $1::uuid AND a.field LIKE 'ssn%'
   AND COALESCE(cl.is_demo, false) = false
   AND a.created_at >= ${W60}`;

const RECENT_LETTERS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE l.id IS NULL
         OR cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(l.bureau, '')), '') IS NULL
         OR s.id IS NULL
         OR (a.kind = 'letter' AND a.outcome LIKE 'mail_failed%' AND NOT EXISTS (
               SELECT 1 FROM inquiry_attempts b
                WHERE b.inquiry_id = a.inquiry_id AND b.kind = 'letter' AND b.outcome = 'sent'
                  AND b.created_at > a.created_at)))::int AS bad_count
  FROM inquiry_attempts a
  LEFT JOIN inquiry_log l ON l.id = a.inquiry_id AND l.org_id = a.org_id
  LEFT JOIN clients cl ON cl.org_id = a.org_id AND cl.id = l.client_id
  LEFT JOIN staff s ON s.org_id = a.org_id AND s.id = a.staff_id
 WHERE a.org_id = $1::uuid AND a.kind IN ('letter', 'portal')
   AND COALESCE(l.is_demo, false) = false
   AND a.created_at >= ${W60}`;

// ── Specialist desk: the Repair queue ────────────────────────────────────────────────────────

const REPAIR_QUEUE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR ps.id IS NULL
         OR ps.pipeline_id IS DISTINCT FROM c.pipeline_id
         OR COALESCE(c.entered_at, c.updated_at) IS NULL)::int AS bad_count
  FROM cards c
  JOIN pipelines p ON p.org_id = c.org_id AND p.id = c.pipeline_id AND p.key = 'optimization'
  LEFT JOIN pipeline_stages ps ON ps.org_id = c.org_id AND ps.id = c.stage_id
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
 WHERE c.org_id = $1::uuid AND COALESCE(c.is_demo, false) = false`;

const REPAIR_ROW_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR EXISTS (SELECT 1 FROM dispute_items di WHERE di.case_id = dc.id AND di.client_id IS DISTINCT FROM dc.client_id)
         OR EXISTS (SELECT 1 FROM dispute_letters dl WHERE dl.case_id = dc.id AND dl.client_id IS DISTINCT FROM dc.client_id)
         OR (dc.pipeline_card_id IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM cards k WHERE k.id = dc.pipeline_card_id AND k.client_id = dc.client_id)))::int AS bad_count
  FROM dispute_cases dc
  LEFT JOIN clients cl ON cl.org_id = dc.org_id AND cl.id = dc.client_id
 WHERE dc.org_id = $1::uuid AND dc.status NOT IN ('closed', 'cancelled')
   AND COALESCE(cl.is_demo, false) = false
   AND dc.updated_at >= ${W60}`;

/** The cards sitting in one stage of the optimization board, judged by that stage's own clock or its own paper. */
function stageSql(stageKey, badWhere) {
  return `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${badWhere.trim()})::int AS bad_count
  FROM cards c
  JOIN pipelines p ON p.org_id = c.org_id AND p.id = c.pipeline_id AND p.key = 'optimization'
  JOIN pipeline_stages ps ON ps.org_id = c.org_id AND ps.id = c.stage_id AND ps.key = '${stageKey}'
  JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
 WHERE c.org_id = $1::uuid AND COALESCE(c.is_demo, false) = false AND COALESCE(cl.is_demo, false) = false`;
}

const CLOCK = "COALESCE(c.entered_at, c.updated_at)";
const LETTER_IN = (statuses) => `EXISTS (
         SELECT 1 FROM dispute_letters dl
          WHERE dl.org_id = c.org_id AND dl.client_id = c.client_id
            AND dl.status IN (${statuses.map((s) => `'${s}'`).join(", ")}))`;
const OPEN_DUE = `SELECT 1 FROM dispute_cases dc
          WHERE dc.org_id = c.org_id AND dc.client_id = c.client_id
            AND dc.status NOT IN ('closed', 'cancelled') AND dc.response_due_at IS NOT NULL`;

// Three business days are judged at five calendar days, so a weekend never turns a file red.
const STAGE_INTAKE_SQL = stageSql("intake", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '5 days'`);
const STAGE_AWAIT_DOCS_SQL = stageSql("awaiting_documents", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '14 days'`);
const STAGE_ANALYSIS_SQL = stageSql("analysis", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '1 hour'`);
const STAGE_LETTERS_GEN_SQL = stageSql("letters_generated", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '30 minutes'
         OR NOT EXISTS (
              SELECT 1 FROM dispute_letters dl WHERE dl.org_id = c.org_id AND dl.client_id = c.client_id)`);
const STAGE_READY_SQL = stageSql("ready_to_send", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '4 hours'
         OR NOT ${LETTER_IN(["generated", "ready"])}`);
const STAGE_TRANSIT_SQL = stageSql("in_transit", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '10 days'
         OR NOT ${LETTER_IN(["sending", "sent", "delivered"])}`);
const STAGE_AWAIT_RESP_SQL = stageSql("awaiting_response", `NOT EXISTS (${OPEN_DUE})
         OR (SELECT MIN(dc.response_due_at) FROM dispute_cases dc
              WHERE dc.org_id = c.org_id AND dc.client_id = c.client_id
                AND dc.status NOT IN ('closed', 'cancelled') AND dc.response_due_at IS NOT NULL)
            < now() - interval '5 days'`);
const STAGE_RESP_RECV_SQL = stageSql("response_received", `${CLOCK} IS NULL OR ${CLOCK} < now() - interval '24 hours'
         OR NOT EXISTS (
              SELECT 1 FROM dispute_responses dr WHERE dr.org_id = c.org_id AND dr.client_id = c.client_id)`);
const STAGE_ROUND_DONE_SQL = stageSql("round_complete", `NOT EXISTS (
              SELECT 1 FROM dispute_responses dr WHERE dr.org_id = c.org_id AND dr.client_id = c.client_id)
         AND NOT EXISTS (
              SELECT 1 FROM events e
               WHERE e.org_id = c.org_id AND e.client_id = c.client_id
                 AND e.name IN ('repair.round.complete', 'repair.response.parsed'))`);
const STAGE_STALLED_SQL = stageSql("stalled", `NOT EXISTS (
              SELECT 1 FROM repair_decision_log rd
               WHERE rd.org_id = c.org_id AND rd.client_id = c.client_id
                 AND rd.decision IN ('repair.stalled', 'repair.analysis.empty'))
         AND NOT EXISTS (
              SELECT 1 FROM dispute_cases dc
               WHERE dc.org_id = c.org_id AND dc.client_id = c.client_id AND dc.status = 'stalled')`);
const STAGE_PROGRAM_DONE_SQL = stageSql("program_complete", `NOT EXISTS (
              SELECT 1 FROM repair_programs rp
               WHERE rp.org_id = c.org_id AND rp.client_id = c.client_id
                 AND rp.status IN ('complete', 'upsell_pending'))
         AND NOT EXISTS (
              SELECT 1 FROM events e
               WHERE e.org_id = c.org_id AND e.client_id = c.client_id AND e.name = 'repair.program.complete')`);
const STAGE_CANCELLED_SQL = stageSql("cancelled", `EXISTS (
              SELECT 1 FROM repair_programs rp
               WHERE rp.org_id = c.org_id AND rp.client_id = c.client_id AND rp.status = 'active')`);

// ── Specialist desk: repair letters (dispute_letters) ────────────────────────────────────────

const ROW_SEND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE dc.id IS NULL
         OR dc.client_id IS DISTINCT FROM dl.client_id
         OR (dl.status IN ('sent', 'delivered') AND (dl.mailed_at IS NULL OR dl.send_claimed_at IS NULL))
         OR (dl.status = 'sending' AND dl.send_claimed_at < now() - interval '1 days')
         OR (dl.mailed_at IS NOT NULL AND dc.response_due_at IS NULL))::int AS bad_count
  FROM dispute_letters dl
  LEFT JOIN dispute_cases dc ON dc.org_id = dl.org_id AND dc.id = dl.case_id
 WHERE dl.org_id = $1::uuid
   AND (dl.status IN ('sending', 'sent', 'delivered') OR dl.mailed_at IS NOT NULL)
   AND dl.created_at >= ${W30}`;

const LETTER_ONE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE (dl.target = 'furnisher' AND dl.furnisher_address_id IS NULL)
         OR NULLIF(BTRIM(COALESCE(dl.bureau, '')), '') IS NULL
         OR EXISTS (
              SELECT 1 FROM dispute_letters o
               WHERE o.org_id = dl.org_id AND o.case_id = dl.case_id AND o.bureau = dl.bureau
                 AND o.round = dl.round AND o.target = dl.target
                 AND o.id <> dl.id AND o.mailed_at IS NOT NULL))::int AS bad_count
  FROM dispute_letters dl
 WHERE dl.org_id = $1::uuid AND dl.mailed_at IS NOT NULL
   AND dl.created_at >= ${W30}`;

const ROW_STAGE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE dc.id IS NULL
         OR dc.client_id IS DISTINCT FROM dl.client_id
         OR NULLIF(BTRIM(COALESCE(dl.body_text, '')), '') IS NULL
         OR (dl.target = 'furnisher' AND dl.furnisher_address_id IS NULL)
         OR dl.mailed_at IS NOT NULL)::int AS bad_count
  FROM dispute_letters dl
  LEFT JOIN dispute_cases dc ON dc.org_id = dl.org_id AND dc.id = dl.case_id
 WHERE dl.org_id = $1::uuid AND dl.status IN ('generated', 'ready')
   AND dl.created_at >= ${W30}`;

const CLEAN_PERSONAL_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE EXISTS (
              SELECT 1 FROM pii_identity p
               WHERE p.client_id = e.subject_client_id AND p.updated_at <= e.completed_at)
         OR EXISTS (
              SELECT 1 FROM plaid_items pi
               WHERE pi.client_id = e.subject_client_id AND pi.created_at <= e.completed_at)
         OR EXISTS (
              SELECT 1 FROM bank_accounts b
               WHERE b.client_id = e.subject_client_id AND b.created_at <= e.completed_at)
         OR EXISTS (
              SELECT 1 FROM clients c
               WHERE c.id = e.subject_client_id AND c.updated_at <= e.completed_at
                 AND (c.email IS NOT NULL OR c.phone IS NOT NULL OR c.first_name IS DISTINCT FROM '[erased]')))::int AS bad_count
  FROM erasure_requests e
 WHERE e.org_id = $1::uuid AND e.kind = 'client_erasure' AND e.status = 'completed'
   AND e.completed_at >= now() - interval '400 days'`;

// ── Money vault, Plaid door, lenders Apply, business fields, agreements, social ──────────────

const VAULT_UPLOAD_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE d.client_id IS NULL OR cl.id IS NULL
         OR v.id IS NULL
         OR v.document_id IS DISTINCT FROM d.id
         OR NULLIF(BTRIM(COALESCE(v.storage_key, '')), '') IS NULL
         OR COALESCE(v.byte_size, 0) <= 0
         OR NULLIF(BTRIM(COALESCE(v.checksum, '')), '') IS NULL
         OR COALESCE(v.mime_type, '') NOT IN ('application/pdf', 'image/png', 'image/jpeg')
         OR v.storage_key IS DISTINCT FROM d.storage_key
         OR (d.metadata->>'entity_id' IS NOT NULL AND NOT EXISTS (
               SELECT 1 FROM entities en
                WHERE en.org_id = d.org_id AND en.client_id = d.client_id
                  AND en.id::text = d.metadata->>'entity_id')))::int AS bad_count
  FROM documents d
  LEFT JOIN clients cl ON cl.org_id = d.org_id AND cl.id = d.client_id
  LEFT JOIN document_versions v ON v.org_id = d.org_id AND v.id = d.current_version_id
 WHERE d.org_id = $1::uuid
   AND (d.generated_by LIKE 'client:%' OR d.generated_by LIKE 'staff:%')
   AND COALESCE(d.is_demo, false) = false
   AND d.created_at >= ${W60}`;

const LINK_EXCHANGE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR i.plaid_item_id IS NULL
         OR (i.link_state = 'active' AND (
               NULLIF(BTRIM(COALESCE(i.encrypted_access_token, '')), '') IS NULL
               OR i.consent_granted_at IS NULL
               OR NOT EXISTS (
                    SELECT 1 FROM bank_accounts b
                     WHERE b.org_id = i.org_id AND b.plaid_item_id = i.id)))
         OR (i.link_state = 'error' AND NULLIF(BTRIM(COALESCE(i.last_error_code, '')), '') IS NULL)
         OR EXISTS (
              SELECT 1 FROM bank_accounts b
               WHERE b.plaid_item_id = i.id
                 AND (b.client_id IS DISTINCT FROM i.client_id OR b.org_id IS DISTINCT FROM i.org_id)))::int AS bad_count
  FROM plaid_items i
  LEFT JOIN clients cl ON cl.org_id = i.org_id AND cl.id = i.client_id
 WHERE i.org_id = $1::uuid AND COALESCE(cl.is_demo, false) = false
   AND i.created_at >= ${W60}`;

const LENDER_APPLY_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(ps.application_url, '')), '') IS NULL
         OR (ps.lender_id IS NULL AND ps.application_id IS NULL)
         OR (ps.application_id IS NOT NULL AND (ap.id IS NULL OR ap.client_id IS DISTINCT FROM ps.client_id))
         OR (ps.status = 'active' AND (ps.exit_ip IS NULL OR ps.granted_city IS NULL AND ps.granted_region IS NULL))
         OR (ps.status = 'verifying' AND ps.started_at < now() - interval '15 minutes')
         OR (ps.status IN ('failed', 'mismatch') AND NULLIF(BTRIM(COALESCE(ps.error_code, '')), '') IS NULL))::int AS bad_count
  FROM proxy_sessions ps
  LEFT JOIN clients cl ON cl.org_id = ps.org_id AND cl.id = ps.client_id
  LEFT JOIN applications ap ON ap.org_id = ps.org_id AND ap.id = ps.application_id
 WHERE ps.org_id = $1::uuid AND COALESCE(cl.is_demo, false) = false
   AND ps.started_at >= ${W60}`;

const APPLY_DIALOG_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ps.ended_at IS NULL
         OR ps.ended_at < ps.started_at
         OR ps.staff_id IS NULL)::int AS bad_count
  FROM proxy_sessions ps
 WHERE ps.org_id = $1::uuid AND ps.status IN ('ended', 'failed', 'mismatch')
   AND ps.started_at >= ${W60}`;

const BUSINESS_FIELDS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR NULLIF(BTRIM(COALESCE(b.name, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data->>'address_line1', '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data->>'city', '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data->>'state', '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(b.entity_data->>'postal_code', '')), '') IS NULL
         OR COALESCE(b.entity_data->>'ein', '') NOT LIKE '__-_______'
         OR COALESCE(b.entity_data->>'incorporated_date', '') NOT LIKE '____-__%'
         OR b.age_months IS NULL OR b.age_months < 0
         OR b.age_months > (date_part('year', now()) - CAST(substr(b.entity_data->>'incorporated_date', 1, 4) AS INTEGER)) * 12
                          + (date_part('month', now()) - CAST(substr(b.entity_data->>'incorporated_date', 6, 2) AS INTEGER)))::int AS bad_count
  FROM businesses b
  LEFT JOIN clients cl ON cl.org_id = b.org_id AND cl.id = b.client_id
 WHERE b.org_id = $1::uuid AND b.entity_data->>'source' = 'soft_pull_approve'
   AND COALESCE(cl.is_demo, false) = false
   AND b.created_at >= ${W60}`;

const AGREEMENTS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE s.id IS NULL
         OR (k.status IN ('sent', 'viewed', 'signed') AND k.document_id IS NULL)
         OR (k.status = 'signed' AND (
               k.signed_at IS NULL
               OR NULLIF(BTRIM(COALESCE(k.signer_name, '')), '') IS NULL
               OR k.signed_document_id IS NULL
               OR sd.id IS NULL)))::int AS bad_count
  FROM contracts k
  LEFT JOIN staff s ON s.org_id = k.org_id AND s.id = k.staff_id
  LEFT JOIN documents sd ON sd.org_id = k.org_id AND sd.id = k.signed_document_id
 WHERE k.org_id = $1::uuid AND k.staff_id IS NOT NULL
   AND COALESCE(k.is_demo, false) = false
   AND k.updated_at >= ${W60}`;

const SOCIAL_CONNECT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE p.id IS NULL
         OR p.org_id IS DISTINCT FROM sc.org_id
         OR sc.channel NOT IN ('facebook', 'instagram', 'linkedin')
         OR NULLIF(BTRIM(COALESCE(sc.external_account_id, '')), '') IS NULL
         OR (sc.channel = 'linkedin' AND lower(sc.external_account_id) LIKE 'urn:%')
         OR (sc.connection_state = 'active'
             AND NULLIF(BTRIM(COALESCE(sc.encrypted_access_token, '')), '') IS NULL))::int AS bad_count
  FROM social_channels sc
  LEFT JOIN partners p ON p.id = sc.partner_id
 WHERE sc.org_id = $1::uuid AND COALESCE(p.is_demo, false) = false
   AND sc.created_at >= ${W60}`;


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
