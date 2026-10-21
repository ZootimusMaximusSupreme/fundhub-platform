/* Lender product-table constants.
   Exact Airtable APPLICATIONS.lender_table single-select values.

   ONE LIST (2026-10-20). This file used to be src/lenders/tables.mjs. It moved here, unchanged, so the
   lender matcher (./lender-match.mjs) and the hourly beat lender-book read the same tables. A beat may
   import only from src/pulse/beats/lib. src/lenders/tables.mjs re-exports everything here. */

export const LENDER_TABLES = Object.freeze([
  "OnlineBizCC",
  "InBranchBizCC",
  "BizLOC_Stated",
  "BizLOC_Documented",
  "PersonalCC",
  "PersonalLoans",
  "PersonalLOC"
]);

export const LENDER_TABLE_SET = new Set(LENDER_TABLES);

/* WHICH PRODUCTS NEED A COMPANY.
   Owner rule, 2026-09-06: no business on file, no business credit cards. A
   client with no company cannot be handed a card that is issued to a company,
   so the four business product tables below are the ones the matcher holds
   back when the client's file has no business on it. The three personal
   tables are always available. Split here rather than in the matcher so one
   list serves every caller. */

export const BUSINESS_LENDER_TABLES = Object.freeze([
  "OnlineBizCC",
  "InBranchBizCC",
  "BizLOC_Stated",
  "BizLOC_Documented"
]);

export const PERSONAL_LENDER_TABLES = Object.freeze([
  "PersonalCC",
  "PersonalLoans",
  "PersonalLOC"
]);

const BUSINESS_LENDER_TABLE_SET = new Set(BUSINESS_LENDER_TABLES);
const PERSONAL_LENDER_TABLE_SET = new Set(PERSONAL_LENDER_TABLES);

export const APPLICATION_STATUSES = Object.freeze([
  "Apply",
  "Applied",
  "Approved",
  "Denied",
  "Missing Docs",
  "Action Required"
]);

export const APPLICATION_STATUS_SET = new Set(APPLICATION_STATUSES);

export const PRIORITY_TIERS = Object.freeze([1, 2, 3]);

export const OBSERVATION_REVIEW_STATUSES = Object.freeze([
  "pending",
  "confirmed",
  "dismissed",
  "corrected"
]);

export const OBSERVATION_SOURCES = Object.freeze([
  "manual",
  "bank_response",
  "crs_pull",
  "staff_report"
]);

/** Columns shared across CSV import/export and the CRM grid. */
export const LENDER_CSV_COLUMNS = Object.freeze([
  "lender_table",
  "name",
  "logo_path",
  "product_name",
  "application_url",
  "lender_row_url",
  "eligible_states",
  "bureaus_pulled",
  "business_bureau_pulled",
  "double_pull",
  "multiple_llc_allowed",
  "stated_requirements",
  "docs_requested",
  "application_method",
  "approval_speed",
  "typical_approval_range",
  "average_starting_loc",
  "max_known_loc",
  "apr_terms",
  "repayment_terms",
  "draw_period_renewal",
  "relationship_required",
  "deposit_balance_impact",
  "known_friendly_states",
  "insider_tips",
  "priority_tier",
  "notes",
  "active",
  "branch_location_info",
  "prequal_soft_pull",
  "intro_offers",
  "requires_account_opening",
  "minimum_deposit",
  "underwriter_interaction",
  "relationship_manager",
  "documentation_required",
  "minimum_time_in_business_years",
  "minimum_revenue_threshold",
  "collateral_required",
  "renewal_terms",
  "loan_type",
  "apr_range_pct",
  "repayment_terms_months",
  "funding_speed",
  "loc_type",
  "external_row_id"
]);

/** Fast-edit fields on the CRM screen (stale often). */
export const INLINE_EDIT_FIELDS = Object.freeze([
  "bureaus_pulled",
  "stated_requirements",
  "docs_requested",
  "active",
  "priority_tier",
  "insider_tips",
  "eligible_states",
  "notes"
]);

export function isLenderTable(v) {
  return LENDER_TABLE_SET.has(String(v || "").trim());
}

/** A product that is issued to a company. Needs a business on file. */
export function isBusinessLenderTable(v) {
  return BUSINESS_LENDER_TABLE_SET.has(String(v || "").trim());
}

/** A product that is issued to a person. Never needs a business. */
export function isPersonalLenderTable(v) {
  return PERSONAL_LENDER_TABLE_SET.has(String(v || "").trim());
}

export function isApplicationStatus(v) {
  return APPLICATION_STATUS_SET.has(String(v || "").trim());
}
