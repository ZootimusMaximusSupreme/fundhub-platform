// Saved-result contracts for display controls that already have a real local
// browser action. The browser proves the click. These rules prove the stored
// business result is still readable and complete without making a live write.

export const DISPLAY_RESULT_LANE = "src/pulse/coverage/gap-catalog-display.mjs";

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

export const DISPLAY_RESULT_TABLE_RULES = Object.freeze({
  accounts: { all: ["org_id", "id", "email"] },
  affiliate_referrals: { all: ["org_id", "affiliate_id", "client_id", "tier", "status"] },
  affiliates: { all: ["org_id", "id", "name"] },
  agents: { all: ["org_id", "code", "name", "status"], any: ["prompt", "guardrails", "channel", "runtime"] },
  application_decisions: { all: ["org_id", "application_id", "event_type", "decided_at"] },
  applications: { all: ["org_id", "funding_round_id", "status"], any: ["bank", "approved_amount", "conditions"] },
  businesses: { all: ["org_id", "client_id", "name"] },
  cards: { all: ["org_id", "client_id", "pipeline_id", "stage_id", "entered_at"] },
  client_consents: { all: ["org_id", "client_id", "kind", "consent_text", "capture_method", "granted_at"] },
  clients: { all: ["org_id", "id"], any: ["first_name", "last_name", "email", "phone"] },
  commission_ledger: { all: ["org_id", "staff_id", "basis", "amount", "status", "earned_at"] },
  commission_rules: { all: ["org_id", "name", "basis", "calc_method", "amount_basis"] },
  content_tier_map: { all: ["org_id", "tier_code", "video_id"] },
  content_videos: { all: ["org_id", "title", "storage_key"] },
  contract_signers: { all: ["org_id", "contract_id", "signer_index", "role_label", "name", "status"] },
  contract_templates: { all: ["org_id", "template_key", "title", "kind", "body", "signature_statement"] },
  contracts: { all: ["org_id", "client_id", "template_id", "title", "kind", "status"] },
  conversations: { all: ["org_id", "client_id", "channel"] },
  crs_results: { all: ["org_id", "client_id", "result"] },
  customer_insights: { all: ["org_id", "client_id", "stage", "channel", "answers", "recorded_by"] },
  entitlement_catalog: { all: ["org_id", "code", "name", "kind"] },
  entitlements: { all: ["org_id", "client_id", "entitlement_code", "granted_at"] },
  events: { all: ["org_id", "name", "version", "payload"] },
  funding_rounds: { all: ["org_id", "client_id", "round_number", "status"], any: ["submitted_amount", "approved_amount", "funded_amount"] },
  lenders: { all: ["org_id", "id", "name"] },
  message_templates: { all: ["org_id", "template_key", "channel", "body"] },
  messages: { all: ["org_id", "direction", "channel", "status"], any: ["rendered_body", "template_key", "provider_ref"] },
  money_agent_log: { all: ["org_id", "client_id", "kind", "created_at"] },
  money_helper_turns: { all: ["org_id", "client_id", "kind", "actor", "input", "status"] },
  partner_brand: { all: ["org_id", "partner_id"], any: ["brand_name", "legal_name", "support_email", "domain"] },
  partners: { all: ["org_id", "id", "name"] },
  payment_links: { all: ["org_id", "client_id", "purpose", "amount_cents", "status", "link_ref", "checkout_url"] },
  pipeline_stages: { all: ["org_id", "pipeline_id", "key", "name"] },
  products: { all: ["org_id", "code", "name", "active"] },
  soft_pull_requests: { all: ["org_id", "client_id", "status"] },
  staff: { all: ["org_id", "id", "name", "role"] },
  subscriptions: { all: ["org_id", "client_id", "tier", "status", "currency"] },
  tasks: { all: ["org_id", "title", "done"] },
});

const CONTROL_TABLE_OVERRIDES = new Map([
  ["Mark funded… button, amount box, Save funded, Cancel", "funding_rounds"],
  ["Lender row: Approved $ amount input", "applications"],
  ["Lender row: Approved button", "applications"],
  ["Lender row: Declined button", "applications"],
  ["Lender row: Doesn't count / Count again button (exclude or reinstate an approval, asks for a reason)", "applications"],
  ["Record consent: call_recording", "client_consents"],
  ["Record consent: marketing_use (permission to use what the client said in ads)", "client_consents"],
  ["Save these answers button (needs at least one answer)", "customer_insights"],
  ["Upload welcome video: Upload button (then saves the tier map)", "content_videos"],
  ["'Approve selected': moves Accrued rows to Approved", "commission_ledger"],
  ["'Mark paid...': asks for the ACH / check / payroll id, marks Approved rows Paid (records only, moves no money)", "commission_ledger"],
]);

function tableNames(row) {
  if (Array.isArray(row?.tables)) return row.tables;
  const one = String(row?.tables || "").trim();
  return /^[a-z][a-z0-9_]*$/.test(one) ? [one] : [];
}

export function displaySavedResultTable(row) {
  const preferred = CONTROL_TABLE_OVERRIDES.get(String(row?.control || ""));
  if (preferred && tableNames(row).includes(preferred)) return preferred;
  return tableNames(row).find((table) => DISPLAY_RESULT_TABLE_RULES[table]) || null;
}

export function needsDeepDisplayResult(row) {
  return ["money", "customerData", "customerMessage"].includes(row?.impact);
}

export function isTrackedDisplayControl(row) {
  const kind = String(row?.kind || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  return TRACKED_CONTROL_KINDS.has(kind);
}
