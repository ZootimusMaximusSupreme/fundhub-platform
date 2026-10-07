// src/documents/kinds.mjs — the document taxonomy.
//
// `kind` is the hard classification, mirrored by a CHECK constraint in
// db/migrations/030_documents.sql. Four classes, no more without a migration.
//
// `subtype` is the soft one: the database does NOT constrain it, so a new
// deliverable can ship without a schema change. The lists below are the
// conventional vocabulary — validated only when a caller opts in via
// assertKnownSubtype(). Registering an unlisted subtype is allowed on purpose.

export const KINDS = Object.freeze({
  AUTHORIZATION: "authorization",         // soft-pull consent, dispute-letter authorization
  CONTRACT: "contract",                   // funding agreement, repair engagement, partner license
  INVOICE_DOCUMENT: "invoice_document",   // the rendered artifact for an invoices row
  DELIVERABLE: "deliverable",             // the five UnderwriteIQ deliverables
  CLIENT_UPLOAD: "client_upload",         // a file the CLIENT sent us — see 118_client_uploads.sql
  BUREAU_RESPONSE: "bureau_response",     // bureau reply photo/PDF — repair portal door (251)
  INQUIRY_DOC: "inquiry_doc"              // FTC / inquiry supporting docs — inquiry portal door (251)
});

export const ALL_KINDS = Object.freeze(Object.values(KINDS));

// Conventional subtypes per kind. Confirmed with Chris 2026-07-28.
export const SUBTYPES = Object.freeze({
  authorization: Object.freeze([
    "soft_pull_consent",          // the C-00 consent gate — a real record, not a custom field
    "dispute_authorization"       // onboarding sign-off to PREPARE letters/complaints; not a mail/file gate
  ]),
  contract: Object.freeze([
    "funding_agreement",
    "repair_engagement_letter",
    "partner_license"             // the affiliate portal gates payouts on this one
  ]),
  // mirrors invoices.invoice_type (017_invoices.sql): deposit | success_fee | platform_fee
  invoice_document: Object.freeze([
    "deposit_invoice",
    "success_fee_invoice",
    "platform_fee_invoice"
  ]),
  // the five UnderwriteIQ deliverables
  deliverable: Object.freeze([
    "credit_analysis_report",       // Credit Analysis Report
    "metro2_dispute_letter_pack",   // Metro 2 Dispute Letter Pack
    "credit_optimization_roadmap",  // Credit Optimization Roadmap
    "funding_snapshot",             // Funding Snapshot
    "bank_lender_match_list",       // Bank and Lender Match List
    "business_duplication_map",     // Business Duplication Map ($297 roadmap free bonus)
    // Between-rounds / funding mail stack (discriminator = EX|EQ|TU)
    "funding_inquiry_removal",
    "funding_personal_info",
    "cfpb_complaint",
    "state_ag_complaint",
    "furnisher_validation"
  ]),
  // what a client hands us through the upload endpoint (docs/UPLOADS-SPEC.md).
  // One document PER FILE — never one-per-client — so uploads.mjs always
  // passes its own discriminator and these never collapse into each other.
  client_upload: Object.freeze([
    "id_document",
    "ssn_card",
    "proof_of_address",
    "bank_statement",
    "proof_of_income",
    "tax_return",
    "additional_fraud_docs",
    "dispute_mail_receipt",
    // A bank's decline letter, for decline defense (src/blueprint/decline-defense.mjs).
    "decline_letter",
    "other"
  ]),
  bureau_response: Object.freeze([
    "bureau_letter",
    "other"
  ]),
  // The inquiry door's note asks for proof of address ("a bank statement
  // counts") when no ID door is on screen, so both address papers must be
  // nameable here or they land as "other" and the packet never sees them (N20).
  inquiry_doc: Object.freeze([
    "ftc_report",
    "id_document",
    "proof_of_address",
    "bank_statement",
    "other"
  ])
});

// Human-readable titles for the conventional subtypes. Callers may pass their
// own title; this is the fallback so a document is never registered untitled.
export const SUBTYPE_TITLES = Object.freeze({
  soft_pull_consent: "Soft Pull Authorization",
  dispute_authorization: "Dispute Letter Authorization",
  funding_agreement: "Funding Agreement",
  repair_engagement_letter: "Repair Engagement Letter",
  partner_license: "Partner License",
  deposit_invoice: "Deposit Invoice",
  success_fee_invoice: "Success Fee Invoice",
  platform_fee_invoice: "Platform Fee Invoice",
  credit_analysis_report: "Credit Analysis Report",
  metro2_dispute_letter_pack: "Metro 2 Dispute Letter Pack",
  credit_optimization_roadmap: "Credit Optimization Roadmap",
  funding_snapshot: "Funding Snapshot",
  bank_lender_match_list: "Bank and Lender Match List",
  business_duplication_map: "Business Duplication Map",
  funding_inquiry_removal: "Funding Inquiry Removal Letter",
  funding_personal_info: "Funding Personal Info Letter",
  cfpb_complaint: "CFPB Complaint",
  state_ag_complaint: "State Attorney General Complaint",
  furnisher_validation: "Furnisher Debt Validation Letter",
  id_document: "ID Document",
  ssn_card: "SSN Card",
  proof_of_address: "Proof of Address",
  bank_statement: "Bank Statement",
  proof_of_income: "Proof of Income",
  tax_return: "Tax Return",
  additional_fraud_docs: "Additional documentation — fraud / identity theft cases",
  dispute_mail_receipt: "Dispute Mailing Proof",
  decline_letter: "Bank Decline Letter",
  bureau_letter: "Bureau Response Letter",
  ftc_report: "FTC Identity Theft Report",
  other: "Uploaded Document"
});

export const DELIVERY_CHANNELS = Object.freeze(
  ["email", "sms", "portal", "api", "manual", "print"]);

export const DELIVERY_STATUSES = Object.freeze(
  ["not_delivered", "pending", "sent", "delivered", "failed", "bounced"]);

export const isKind = (k) => ALL_KINDS.includes(k);
export const isKnownSubtype = (kind, subtype) =>
  Boolean(SUBTYPES[kind]?.includes(subtype));

/** Throws on an unknown kind. Kind is CHECK-constrained in the DB — fail early. */
export function assertKind(kind) {
  if (!isKind(kind)) {
    throw new Error(
      `unknown document kind "${kind}" — expected one of ${ALL_KINDS.join(", ")}`);
  }
  return kind;
}

/** Opt-in strictness. Not called by register() — unlisted subtypes are legal. */
export function assertKnownSubtype(kind, subtype) {
  assertKind(kind);
  if (!isKnownSubtype(kind, subtype)) {
    throw new Error(
      `unknown subtype "${subtype}" for kind "${kind}" — conventional values: ` +
      `${(SUBTYPES[kind] || []).join(", ")}`);
  }
  return subtype;
}

export const titleFor = (subtype, fallback = "Document") =>
  SUBTYPE_TITLES[subtype] || fallback;

/**
 * documentKey — the LOGICAL identity of a document.
 *
 * This is what makes versioning work. A regeneration resolves to the same key,
 * so it appends a version to the existing document instead of minting a second
 * one. Unique per (org_id, document_key) in the schema.
 *
 * Default shape: `<kind>|<subtype>|<client_id>` — i.e. one Credit Analysis
 * Report per client, regenerated in place. Callers whose documents are NOT
 * one-per-client (per funding round, per invoice, per dispute cycle) must pass
 * a discriminator so the versions do not collapse into one another:
 *
 *   buildDocumentKey({ kind, subtype, clientId, discriminator: fundingRoundId })
 */
export function buildDocumentKey({ kind, subtype, clientId, discriminator = null }) {
  assertKind(kind);
  if (!clientId) throw new Error("buildDocumentKey requires clientId");
  const parts = [kind, subtype || "default", String(clientId)];
  if (discriminator) parts.push(String(discriminator));
  return parts.join("|");
}
