// Exact saved-result contracts for display controls. A PASS contract must tie
// the named control to a durable receipt or to the exact saved rows it changes.
// If that link does not exist, the contract stays deliberately red.

export const DISPLAY_RESULT_LANE = "src/pulse/coverage/gap-catalog-display.mjs";

import { FIN_B21_DISPLAY_CONTRACTS } from "./fin-b21-display-contracts.mjs";

const TRACKED_CONTROL_KINDS = new Set([
  "api-action", "asset", "board-column", "bulk-action", "bulk-select", "button",
  "canvas", "card-action", "chart", "checkbox", "details", "disclosure", "display",
  "drag", "drag-drop", "feed", "file-input", "file-upload", "filter", "form",
  "form-submit", "gate", "gesture", "input", "kanban-column", "keyboard", "link",
  "menu-item", "modal", "nav", "nav-link", "page", "page-load", "page-state",
  "pager", "panel", "prompt", "redirect", "row-expand", "select", "sort-control",
  "stage-button", "stage-column", "stat-tile", "state", "tab", "table", "table-row",
  "toggle",
]);

function query(control, requirement, key, body) {
  return Object.freeze({ control, mode: "query", requirement, sql: `/* display-result:${key} */\n${body.trim()}` });
}

function gap(control, requirement) {
  return Object.freeze({ control, mode: "always-red", requirement, sql: null });
}

const ROUND_SUBMITTED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE client_id IS NULL OR payload->>'stage' IS DISTINCT FROM 'round_submitted'
         OR payload->>'source' IS DISTINCT FROM 'card_stacking'
         OR COALESCE(payload->>'roundNumber', '') !~ '^[1-9][0-9]*$')::int AS bad_count
  FROM events
 WHERE org_id = $1::uuid AND name = 'round.submitted'
   AND payload->>'source' = 'card_stacking'`;

const ROUND_FUNDED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE fr.id IS NULL OR e.client_id IS DISTINCT FROM fr.client_id
         OR COALESCE(CASE WHEN COALESCE(e.payload->>'fundedAmount', '') ~ '^[0-9]+([.][0-9]+)?$'
              THEN (e.payload->>'fundedAmount')::numeric END, 0) <= 0
         OR fr.funded_amount IS DISTINCT FROM CASE
              WHEN COALESCE(e.payload->>'fundedAmount', '') ~ '^[0-9]+([.][0-9]+)?$'
              THEN (e.payload->>'fundedAmount')::numeric END)::int AS bad_count
  FROM events e
  LEFT JOIN funding_rounds fr ON fr.org_id = e.org_id AND fr.id::text = e.payload->>'fundingRoundId'
 WHERE e.org_id = $1::uuid AND e.name = 'round.funded'
   AND e.payload->>'source' = 'card_stacking'`;

const ROUND_CLOSED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE client_id IS NULL OR payload->>'stage' IS DISTINCT FROM 'closed'
         OR payload->>'source' IS DISTINCT FROM 'card_stacking'
         OR payload->>'engagementComplete' IS DISTINCT FROM 'true')::int AS bad_count
  FROM events
 WHERE org_id = $1::uuid AND name = 'round.closeout'
   AND payload->>'source' = 'card_stacking'`;

const APPROVED_AMOUNT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE a.id IS NULL OR COALESCE(a.approved_amount, 0) <= 0)::int AS bad_count
  FROM application_decisions d
  LEFT JOIN applications a ON a.org_id = d.org_id AND a.id = d.application_id
 WHERE d.org_id = $1::uuid AND d.event_type = 'bank_decision' AND d.status = 'Approved'`;

const APPROVED_DECISION_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE a.id IS NULL OR d.application_id IS NULL OR d.decided_at IS NULL
         OR NULLIF(BTRIM(COALESCE(d.created_by, '')), '') IS NULL)::int AS bad_count
  FROM application_decisions d
  LEFT JOIN applications a ON a.org_id = d.org_id AND a.id = d.application_id
 WHERE d.org_id = $1::uuid AND d.event_type = 'bank_decision' AND d.status = 'Approved'`;

const DENIED_DECISION_SQL = APPROVED_DECISION_SQL.replace("'Approved'", "'Denied'");

const EXCLUSION_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE a.id IS NULL OR d.decided_at IS NULL
         OR NULLIF(BTRIM(COALESCE(d.created_by, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(d.notes, '')), '') IS NULL)::int AS bad_count
  FROM application_decisions d
  LEFT JOIN applications a ON a.org_id = d.org_id AND a.id = d.application_id
 WHERE d.org_id = $1::uuid AND d.event_type IN ('approval_excluded', 'approval_reinstated')`;

const HELPER_TURN_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(BTRIM(input), '') IS NULL OR reply IS NULL
         OR answered_at IS NULL OR brain NOT IN ('ai', 'rules'))::int AS bad_count
  FROM money_helper_turns
 WHERE org_id = $1::uuid AND kind = 'message' AND status IN ('answered', 'halted')`;

const HELPER_SUGGESTION_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE reply IS NULL OR answered_at IS NULL OR brain NOT IN ('ai', 'rules'))::int AS bad_count
  FROM money_helper_turns
 WHERE org_id = $1::uuid AND kind = 'message'
   AND input IN ('What is due this week?', 'Which card should I pay first?', 'Got declined? Paste the letter here')
   AND status IN ('answered', 'halted')`;

const DO_TASK_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE t.id IS NULL OR l.client_id IS DISTINCT FROM t.client_id
         OR l.item_id IS DISTINCT FROM t.id
         OR l.idempotency_key IS DISTINCT FROM 'money-task:' || t.id::text || ':assigned'
         OR l.detail->>'task_key' IS NULL OR l.detail->>'assignee' IS NULL)::int AS bad_count
  FROM money_agent_log l
  LEFT JOIN money_agent_tasks t ON t.org_id = l.org_id AND t.id = l.item_id
 WHERE l.org_id = $1::uuid AND l.action = 'task_assigned'`;

const READY_TO_FUND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE t.id IS NULL OR l.client_id IS DISTINCT FROM t.client_id
         OR l.task_id IS DISTINCT FROM t.id
         OR l.idempotency_key IS DISTINCT FROM 'ready-to-fund:' || l.client_id::text || ':r' || (l.detail->>'round')
         OR l.detail->>'process' IS DISTINCT FROM 'blueprint-csm-prep'
         OR l.detail->>'via' IS DISTINCT FROM 'financeos')::int AS bad_count
  FROM money_agent_log l
  LEFT JOIN tasks t ON t.org_id = l.org_id AND t.id = l.task_id
 WHERE l.org_id = $1::uuid AND l.action = 'ready_to_fund'`;

const CONTENT_VIDEO_MAP_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE v.id IS NULL OR v.org_id IS DISTINCT FROM m.org_id
         OR NULLIF(BTRIM(COALESCE(v.title, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(v.storage_key, '')), '') IS NULL)::int AS bad_count
  FROM content_tier_map m
  LEFT JOIN content_videos v ON v.org_id = m.org_id AND v.id = m.video_id
 WHERE m.org_id = $1::uuid`;

const CONTRACT_LIBRARY_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(BTRIM(template_key), '') IS NULL OR NULLIF(BTRIM(name), '') IS NULL
         OR source_kind NOT IN ('text', 'pdf')
         OR (source_kind = 'text' AND NULLIF(BTRIM(COALESCE(body, '')), '') IS NULL)
         OR (source_kind = 'pdf' AND (document_id IS NULL OR page_count IS NULL)))::int AS bad_count
  FROM contract_templates
 WHERE org_id = $1::uuid AND active = true AND COALESCE(is_demo, false) = false`;

const CONTRACT_PDF_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE d.id IS NULL OR t.page_count <= 0
         OR jsonb_array_length(t.page_sizes) <> t.page_count)::int AS bad_count
  FROM contract_templates t
  LEFT JOIN documents d ON d.org_id = t.org_id AND d.id = t.document_id
 WHERE t.org_id = $1::uuid AND t.active = true AND t.source_kind = 'pdf'
   AND COALESCE(t.is_demo, false) = false`;

const CONTRACT_FIELDS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE jsonb_typeof(fields) <> 'array' OR jsonb_array_length(fields) = 0
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(fields) f
                     WHERE COALESCE(f->>'page', '') !~ '^[0-9]+$' OR COALESCE(f->>'signer', '') !~ '^[0-9]+$'
                        OR f->>'type' NOT IN ('text','date','checkbox','signature','initials')
                        OR NULLIF(BTRIM(COALESCE(f->>'label', '')), '') IS NULL))::int AS bad_count
  FROM contract_templates
 WHERE org_id = $1::uuid AND source_kind = 'pdf' AND jsonb_array_length(fields) > 0
   AND COALESCE(is_demo, false) = false`;

function consentSql(kind) {
  return `SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(BTRIM(consent_text), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(consent_version, '')), '') IS NULL
         OR capture_method NOT IN ('typed','checkbox','signature')
         OR ((granted_by_kind = 'client') <> (granted_by_account_id IS NOT NULL))
         OR ((granted_by_kind = 'staff') <> (granted_by_staff_id IS NOT NULL)))::int AS bad_count
  FROM client_consents WHERE org_id = $1::uuid AND kind = '${kind}'`;
}

const CONSENT_REVOKE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(revoked_reason, '')), '') IS NULL
         OR revoked_by_kind NOT IN ('client','staff')
         OR ((revoked_by_kind = 'client') <> (revoked_by_account_id IS NOT NULL))
         OR ((revoked_by_kind = 'staff') <> (revoked_by_staff_id IS NOT NULL)))::int AS bad_count
  FROM client_consents WHERE org_id = $1::uuid AND revoked_at IS NOT NULL`;

const INSIGHT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE c.id IS NULL OR s.id IS NULL OR jsonb_typeof(i.answers) <> 'object'
         OR i.answers = '{}'::jsonb OR (i.task_id IS NOT NULL AND (t.id IS NULL OR t.client_id IS DISTINCT FROM i.client_id)))::int AS bad_count
  FROM customer_insights i
  LEFT JOIN clients c ON c.org_id = i.org_id AND c.id = i.client_id
  LEFT JOIN staff s ON s.org_id = i.org_id AND s.id = i.recorded_by
  LEFT JOIN tasks t ON t.org_id = i.org_id AND t.id = i.task_id
 WHERE i.org_id = $1::uuid`;

const COMMISSION_LEDGER_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE s.id IS NULL OR l.status NOT IN ('earned','approved','paid','void')
         OR l.amount IS NULL OR l.currency <> 'USD' OR l.earned_at IS NULL
         OR (l.status = 'approved' AND (l.approved_at IS NULL OR NULLIF(BTRIM(COALESCE(l.approved_by, '')), '') IS NULL))
         OR (l.status = 'paid' AND (l.paid_at IS NULL OR NULLIF(BTRIM(COALESCE(l.payout_ref, '')), '') IS NULL)))::int AS bad_count
  FROM commission_ledger l
  LEFT JOIN staff s ON s.org_id = l.org_id AND s.id = l.staff_id
 WHERE l.org_id = $1::uuid AND COALESCE(l.is_demo, false) = false`;

const COMMISSION_RULES_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(BTRIM(r.name), '') IS NULL
         OR r.calc_method NOT IN ('percent','flat','flat_per_unit','tiered')
         OR (r.calc_method = 'percent' AND r.percent IS NULL)
         OR (r.calc_method IN ('flat','flat_per_unit') AND r.flat_amount IS NULL)
         OR (r.calc_method = 'flat_per_unit' AND r.per_unit_amount IS NULL)
         OR (r.calc_method = 'tiered' AND NOT EXISTS (SELECT 1 FROM commission_rule_tiers t WHERE t.rule_id = r.id))
         OR (r.product_id IS NOT NULL AND p.id IS NULL) OR (r.staff_id IS NOT NULL AND s.id IS NULL))::int AS bad_count
  FROM commission_rules r
  LEFT JOIN products p ON p.org_id = r.org_id AND p.id = r.product_id
  LEFT JOIN staff s ON s.org_id = r.org_id AND s.id = r.staff_id
 WHERE r.org_id = $1::uuid`;

const COMMISSION_SUPERSEDE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE newer.id IS NULL OR newer.effective_from IS DISTINCT FROM old.effective_to
         OR NULLIF(BTRIM(COALESCE(newer.notes, '')), '') IS NULL)::int AS bad_count
  FROM commission_rules old
  LEFT JOIN commission_rules newer ON newer.org_id = old.org_id AND newer.name = old.name
   AND newer.product_id IS NOT DISTINCT FROM old.product_id AND newer.role IS NOT DISTINCT FROM old.role
   AND newer.staff_id IS NOT DISTINCT FROM old.staff_id AND newer.basis = old.basis
   AND newer.stacking = old.stacking AND newer.effective_from = old.effective_to
 WHERE old.org_id = $1::uuid AND old.effective_to IS NOT NULL`;

const COMMISSION_APPROVED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE l.id IS NULL OR l.status IS NULL OR l.status NOT IN ('approved','paid')
         OR l.approved_at IS NULL OR l.amount IS NULL
         OR NULLIF(BTRIM(COALESCE(l.approved_by, '')), '') IS NULL
         OR e.payload->>'ledger_id' IS DISTINCT FROM l.id::text
         OR CASE WHEN COALESCE(e.payload->>'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
              THEN (e.payload->>'amount')::numeric END IS DISTINCT FROM l.amount)::int AS bad_count
  FROM events e
  LEFT JOIN commission_ledger l ON l.org_id = e.org_id AND l.id::text = e.payload->>'ledger_id'
 WHERE e.org_id = $1::uuid AND e.name = 'commission.approved'`;

const COMMISSION_PAID_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE l.id IS NULL OR l.status IS DISTINCT FROM 'paid' OR l.paid_at IS NULL OR l.amount IS NULL
         OR NULLIF(BTRIM(COALESCE(l.paid_by, '')), '') IS NULL OR NULLIF(BTRIM(COALESCE(l.payout_ref, '')), '') IS NULL
         OR e.payload->>'payout_ref' IS DISTINCT FROM l.payout_ref
         OR CASE WHEN COALESCE(e.payload->>'amount', '') ~ '^-?[0-9]+([.][0-9]+)?$'
              THEN (e.payload->>'amount')::numeric END IS DISTINCT FROM l.amount)::int AS bad_count
  FROM events e
  LEFT JOIN commission_ledger l ON l.org_id = e.org_id AND l.id::text = e.payload->>'ledger_id'
 WHERE e.org_id = $1::uuid AND e.name = 'commission.paid'`;

const REFERRAL_LINK_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE a.id IS NULL OR a.org_id IS DISTINCT FROM ac.org_id OR a.status <> 'active'
         OR NULLIF(BTRIM(COALESCE(a.tracking_id, '')), '') IS NULL)::int AS bad_count
  FROM accounts ac
  LEFT JOIN affiliates a ON a.org_id = ac.org_id AND a.id = ac.affiliate_id
 WHERE ac.org_id = $1::uuid AND ac.kind = 'client' AND ac.affiliate_id IS NOT NULL`;

export const DISPLAY_RESULT_CONTRACTS = Object.freeze([
  ...FIN_B21_DISPLAY_CONTRACTS,
  query("Mark round submitted button", "A card-stacking round.submitted receipt must carry the client, stage, source, and round number.", "round-submitted", ROUND_SUBMITTED_SQL),
  query("Mark funded… button, amount box, Save funded, Cancel", "The round.funded receipt must link to the same funding round and preserve the exact funded amount.", "round-funded", ROUND_FUNDED_SQL),
  query("Close round button", "A card-stacking round.closeout receipt must name the closed stage and engagement-complete result.", "round-closed", ROUND_CLOSED_SQL),
  query("Lender row: Approved $ amount input", "An Approved bank-decision receipt must link to an application with a positive saved approved amount.", "approved-amount", APPROVED_AMOUNT_SQL),
  query("Lender row: Approved button", "An Approved bank-decision receipt must link to the exact application and named staff actor.", "approved-decision", APPROVED_DECISION_SQL),
  query("Lender row: Declined button", "A Denied bank-decision receipt must link to the exact application and named staff actor.", "denied-decision", DENIED_DECISION_SQL),
  query("Lender row: Doesn't count / Count again button (exclude or reinstate an approval, asks for a reason)", "The exclusion or reinstatement receipt must link the application, actor, time, and saved reason.", "approval-exclusion", EXCLUSION_SQL),
  gap("Deal calculator: Draw amount input", "The calculator has no saved action receipt containing the typed draw and rendered result to compare."),
  query("Send: message box, Send button, Enter key (20,000 character cap)", "A saved helper turn must retain the input and a completed reply, brain, and answer time on the same row.", "helper-send", HELPER_TURN_SQL),
  query("Suggestion buttons (3: due this week, which card first, got declined paste the letter)", "Each exact suggestion input must finish on the same helper-turn row with a reply, brain, and answer time.", "helper-suggestions", HELPER_SUGGESTION_SQL),
  query("'Do task' button on a step the helper or a person can do", "The task-assigned log must link the exact money task, client, task key, assignee, and idempotency key.", "do-task", DO_TASK_SQL),
  query("'I'm ready to get funded' button (opens the Capital Blueprint closing-prep call task)", "The ready-to-fund log must link the exact Blueprint prep task, client, round, process, and FinanceOS source.", "ready-to-fund", READY_TO_FUND_SQL),
  gap("Save changes button (saves tiles and the tier-to-video map)", "No request receipt keeps the submitted tile names, outcomes, prices, visibility, and tier map together for exact comparison."),
  gap("Locked tile editor: Showing/Hidden switch per tile (keyboard Space/Enter too)", "The saved catalog row has no receipt naming the tile and submitted visibility state."),
  gap("Locked tile editor: client-facing name box", "The saved catalog row has no receipt carrying the exact submitted client-facing name."),
  gap("Locked tile editor: outcome copy box (one line shown to the client)", "The saved catalog row has no receipt carrying the exact submitted outcome copy."),
  gap("Locked tile editor: price shown box", "The saved catalog row has no receipt carrying the exact submitted display price in cents."),
  query("Tier assignment: one welcome-video select per product tier and one for Default", "Every saved tier selection must link to a real video in the same company with a title and storage object.", "content-tier-map", CONTENT_VIDEO_MAP_SQL),
  query("Upload welcome video: Upload button (then saves the tier map)", "The saved tier map must link the uploaded video row to its title and storage object in the same company.", "content-video-upload", CONTENT_VIDEO_MAP_SQL),
  query("Page itself loads; lists contract wordings", "Every active wording shown by the library must have the exact text-or-PDF shape the endpoint returns.", "contract-library", CONTRACT_LIBRARY_SQL),
  query("Wording list: click a row to edit it", "Each PDF wording row must link to its document and have one stored page size per page.", "contract-pdf", CONTRACT_PDF_SQL),
  gap("Save (create a new wording)", "The pulse needs the submitted template key, name, kind, body, and actor to compare with the newly created wording row."),
  gap("Save (edit an existing wording)", "The pulse needs the template id and exact submitted wording fields to compare with the updated row."),
  query("PDF editor: Save boxes", "A saved PDF wording must contain real boxes whose page, signer, type, and label are valid.", "contract-fields", CONTRACT_FIELDS_SQL),
  gap("Consent wording, version badge and current status banner (read from the server, never typed in the page)", "The pulse has no client id and requested consent kind, so it cannot compare the banner with that client's exact current status."),
  query("Record consent: call_recording", "The saved consent must be the call_recording kind with frozen words, version, capture method, and one exact granter.", "consent-call-recording", consentSql("call_recording")),
  query("Record consent: marketing_use (permission to use what the client said in ads)", "The saved consent must be the marketing_use kind with frozen words, version, capture method, and one exact granter.", "consent-marketing-use", consentSql("marketing_use")),
  query("History table: 'live / not live' state and Withdraw button (asks for a reason in a prompt)", "Every revoked consent must preserve its reason and exactly one revoking actor.", "consent-revoke", CONSENT_REVOKE_SQL),
  gap("Contract cell: Void button (asks for a reason in a prompt; owner/admin only)", "The pulse needs a void receipt containing the contract id, submitted reason, actor, and saved void state."),
  query("Save these answers button (needs at least one answer)", "A saved insight must link the client, recorder, non-empty answers, and task when one was submitted.", "customer-insight", INSIGHT_SQL),
  gap("Held-for-quiet-hours result: text deferred to the next window and the words stay in the box", "The saved message has a future schedule but no durable field saying quiet hours caused it, so the exact deferred outcome cannot be proved."),
  query("Funded amount prompt (window.prompt, up to 3 tries; blank or cancel abandons the move, never sends zero)", "A valid prompt submission must reach the round.funded receipt and equal the amount saved on that funding round.", "funded-prompt", ROUND_FUNDED_SQL),
  query("Page open: commission ledger (ACCRUED and PAID MTD tiles, payout table)", "Every non-demo ledger row returned to the page must link staff and carry a valid state with its required timestamps and payout reference.", "commission-ledger", COMMISSION_LEDGER_SQL),
  query("Page open: commission rules and versions", "Every rule returned to the page must carry the exact method fields and valid product, staff, or tier links it names.", "commission-rules", COMMISSION_RULES_SQL),
  query("Commission rule 'Close v<N> - open v<N+1>': saves a new effective-dated rate and reason", "Each closed rule must link to its replacement at the exact boundary and keep the submitted reason on the new row.", "commission-supersede", COMMISSION_SUPERSEDE_SQL),
  query("'Approve selected': moves Accrued rows to Approved", "Each commission.approved receipt must link to the same ledger amount and an approved timestamp and actor.", "commission-approved", COMMISSION_APPROVED_SQL),
  query("'Mark paid...': asks for the ACH / check / payroll id, marks Approved rows Paid (records only, moves no money)", "Each commission.paid receipt must link to the same paid ledger amount and exact payout reference.", "commission-paid", COMMISSION_PAID_SQL),
  gap("Ledger table (date, person, client, product, rule version, basis, rate, payout, status)", "The screen hardcodes Client and Rule version as dashes, so no saved-row read can prove this named table displays correct values."),
  gap("Business fields: name, street, city, state, ZIP, EIN, incorporated month, extra owner", "The pulse needs the soft-pull request id and exact submitted business array to compare each field with the saved business rows."),
  query("Refer a friend: Get my link button", "A client account with a referral link must point to one active same-company affiliate with a real tracking code.", "referral-link", REFERRAL_LINK_SQL),
]);

const CONTRACT_BY_CONTROL = new Map(DISPLAY_RESULT_CONTRACTS.map((entry) => [entry.control, entry]));
if (CONTRACT_BY_CONTROL.size !== DISPLAY_RESULT_CONTRACTS.length) throw new Error("Display saved-result controls must be unique.");

export function displaySavedResultContract(row) {
  return CONTRACT_BY_CONTROL.get(String(row?.control || "")) || null;
}

export function needsDeepDisplayResult(row) {
  return ["money", "customerData", "customerMessage"].includes(row?.impact);
}

export function isTrackedDisplayControl(row) {
  const kind = String(row?.kind || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return TRACKED_CONTROL_KINDS.has(kind);
}
