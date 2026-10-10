// The application document vault — what a lender asks to see, and where each
// line came from. Capital Blueprint unit B3 (ops/workflows/blueprint-launch-2026-10-06.md).
//
// Offer line (docs/finance/capital-blueprint-next-2026-09-29.md): "The agent
// collects bank statements, tax returns and ID ahead of time, so the file is
// complete when the closer calls."
//
// THIS FILE IS A LIST, NOT A GUESS. Every standard item below carries `sources`:
// the repo file (and line, where it is a page) that says a lender or a bank asks
// for it. An item with no source is not in this list. A person adds it for one
// client in the vault instead (document_vault_items, kind 'custom'), and the
// screen says staff added it. Nothing is invented to make a checklist look full.
//
// WHERE THE SOURCES LIVE, AND WHY TWO KINDS.
//   tracked   — a file in this repository. A test (document-vault-items.test.mjs)
//               opens each one and fails if it is gone.
//   local     — the Legacy Strong scrape under credentials/notion-scrape/output/.
//               It is gitignored (the repo never holds Alec's pages), so it
//               exists on the owner's Mac and not in a clone. Cited by page folder
//               and line so a person can open it; the test only checks the shape.
//
// WHAT THE SOURCES DO NOT SAY (so this list does not either):
//   * The lender book docs/legacy-strong/lenders-legacy-strong.csv has a
//     `docs_requested` and a `documentation_required` column. Both are EMPTY on
//     all 306 rows (measured 2026-10-06). The one bank that names a paper is
//     Goldman Sachs: "ID upload required". There is no per-bank document list.
//   * No source says lenders want personal bank statements as a requirement
//     (only as proof of address), a business license, or a profit-and-loss
//     statement as a standing ask. The Legacy Strong datapoints name a "full
//     financial package" (profit and loss, balance sheet) only above $150,000 of
//     total business credit, which depends on what is being applied for. These
//     are staff-addable, never standard.
//   * No source gives an age limit for a proof of address ("recent" only), a
//     photo ID, tax returns, articles or the EIN letter, so none of them expires
//     here. Two do have a rule, below.
//
// EXPIRY — the only two rules the sources give:
//   * Bank statements: lenders ask for "the last three months". A statement set
//     stops being the last three months when it is more than three months old.
//     DOCUMENT_VAULT_STATEMENT_MAX_AGE_DAYS (whole days) overrides the three
//     months if the owner wants a different window.
//   * Certificate of good standing: "Must be issued <= 60 days ago" (Legacy
//     Strong, aged-corps page). DOCUMENT_VAULT_GOOD_STANDING_MAX_AGE_DAYS
//     overrides the 60.
//   The clock starts at the date a person typed on accept (the statement's end
//   date, or the date the certificate was issued). With none typed, it starts at
//   the day the file was uploaded.

/** Where a vault line belongs: once per client, or once per business container. */
export const SCOPE = Object.freeze({ CLIENT: "client", BUSINESS: "business" });

const SCRAPE = "credentials/notion-scrape/output";
const AGED_CORPS = `${SCRAPE}/aged-corps-open-biz-checking--20dc3aa7/page.md`;
const DATAPOINTS = `${SCRAPE}/dec-datapoint-drop-blocs-cca-team--2d6c3aa7/page.md`;
const AUTO_LOANS = `${SCRAPE}/business-auto-loans--08d811a6/page.md`;
const AGED_CORP_DETAILS = `${SCRAPE}/details-aged-corp--1b8c3aa7/page.md`;
const BLOC_PAGE = `${SCRAPE}/business-lines-of-credit--72eda75d/page.md`;

const tracked = (ref, note) => Object.freeze({ ref, note, local: false });
const local = (ref, lines, note) => Object.freeze({ ref, lines, note, local: true });

const DOC_CHECK_PROMPT = tracked(
  "db/migrations/114_ghl_agent_seed.sql",
  "The Document Check agent's prompt lists what a client must send: government ID, proof of current address, Articles."
);

/** The standard list. Frozen. `priority` is the order a client is asked in. */
export const STANDARD_ITEMS = Object.freeze([
  Object.freeze({
    key: "id_document",
    scope: SCOPE.CLIENT,
    priority: 10,
    title: "Government photo ID",
    ask: "a photo of your driver's license or passport",
    why: "Every lender checks who you are first. The ID should show the address you live at now. If it does not, send your passport instead.",
    subtypes: Object.freeze(["id_document"]),
    need: 1,
    unit: "file",
    expires: null,
    docCheck: true,
    sources: Object.freeze([
      DOC_CHECK_PROMPT,
      tracked("src/inquiry-ops/doc-gate.mjs", "The identity packet requires a government photo ID."),
      tracked(
        "docs/legacy-strong/lenders-legacy-strong.csv",
        "Goldman Sachs row, stated_requirements: \"ID upload required\" — the only bank in the book that names a paper."
      ),
      local(AGED_CORPS, "116-122", "\"Government photo ID (driver's licence / passport)\" is what the signer brings to open a business account.")
    ])
  }),
  Object.freeze({
    key: "proof_of_address",
    scope: SCOPE.CLIENT,
    priority: 20,
    title: "Proof of current address",
    ask: "a recent utility bill or bank statement with your name and address",
    why: "The name and address must match your ID. A utility bill or a bank statement both work.",
    // A bank statement counts here, the same way the identity packet counts it
    // (src/inquiry-ops/doc-gate.mjs checkDocPacket: hasAddress).
    subtypes: Object.freeze(["proof_of_address", "bank_statement"]),
    need: 1,
    unit: "file",
    expires: null,
    docCheck: true,
    sources: Object.freeze([
      DOC_CHECK_PROMPT,
      tracked("src/inquiry-ops/doc-gate.mjs", "Proof of address, and a bank statement counts as one."),
      tracked("db/seed/013_section4_message_templates.sql", "EMAIL-DOC-01-REQUEST asks for \"Proof of address\" by name.")
    ])
  }),
  Object.freeze({
    key: "tax_returns_personal",
    scope: SCOPE.CLIENT,
    priority: 30,
    title: "Personal tax returns, last 2 years",
    ask: "your personal tax returns for the last 2 years",
    why: "Banks ask for them when the credit being approved gets large. Having them ready keeps the file moving.",
    subtypes: Object.freeze(["tax_return"]),
    need: 2,
    unit: "year",
    expires: null,
    docCheck: false,
    sources: Object.freeze([
      local(DATAPOINTS, "46-48", "Under $150,000 of total business credit \"tax returns May Be required\"; over it, \"last 2 years of both business and personal tax returns\" WILL be."),
      local(BLOC_PAGE, "40", "\"they may ask for bank statements and tax returns\"."),
      tracked("src/survey/cf-question-map.mjs", "The application survey asks \"Can You Verify Income?\" — pay stubs, W-2 or tax returns.")
    ])
  }),
  Object.freeze({
    key: "bank_statements_business",
    scope: SCOPE.BUSINESS,
    priority: 40,
    title: "Business bank statements, last 3 months",
    ask: "your last 3 months of business bank statements",
    why: "Lenders read three months of statements to see money coming in and staying in the account.",
    subtypes: Object.freeze(["business_bank_statement"]),
    need: 3,
    unit: "month",
    // The last three months. Aging out is measured from the statement's end date.
    expires: Object.freeze({
      months: 3,
      env: "DOCUMENT_VAULT_STATEMENT_MAX_AGE_DAYS",
      note: "Lenders ask for the last three months; older than three months is no longer the last three."
    }),
    docCheck: false,
    sources: Object.freeze([
      local(DATAPOINTS, "16, 20, 32, 40, 54, 60, 66, 74", "Low-doc lines of credit and business cards: \"3 mo bank statement\"."),
      local(AUTO_LOANS, "23", "\"Lenders typically require the last three months of bank statements\"."),
      local(AGED_CORP_DETAILS, "176, 204, 206", "\"Providing 3 months bank statements\" at US Bank."),
      tracked("src/survey/cf-question-map.mjs", "The application survey asks \"Can You Verify Revenue?\" — bank statements, tax returns.")
    ])
  }),
  Object.freeze({
    key: "tax_returns_business",
    scope: SCOPE.BUSINESS,
    priority: 50,
    title: "Business tax returns, last 2 years",
    ask: "your business tax returns for the last 2 years",
    why: "Banks ask for them when the credit being approved gets large.",
    subtypes: Object.freeze(["business_tax_return"]),
    need: 2,
    unit: "year",
    expires: null,
    docCheck: false,
    sources: Object.freeze([
      local(DATAPOINTS, "46-48", "Over $150,000 of total business credit: \"last 2 years of both business and personal tax returns\"."),
      tracked("src/survey/cf-question-map.mjs", "The application survey asks \"Can You Verify Revenue?\" — bank statements, tax returns.")
    ])
  }),
  Object.freeze({
    key: "articles_of_organization",
    scope: SCOPE.BUSINESS,
    priority: 60,
    title: "Articles of Organization",
    ask: "your Articles of Organization (or Incorporation)",
    why: "It proves the business exists and who owns it. The business name on it must match the name you apply under.",
    subtypes: Object.freeze(["articles_of_organization"]),
    need: 1,
    unit: "file",
    expires: null,
    docCheck: false,
    sources: Object.freeze([
      local(AGED_CORPS, "43-50", "Core document banks require to open a business account. \"No timeline expiration\"."),
      DOC_CHECK_PROMPT,
      tracked("db/seed/013_section4_message_templates.sql", "EMAIL-DOC-01-REQUEST: \"Articles of organization or incorporation, if you have an entity\".")
    ])
  }),
  Object.freeze({
    key: "ein_letter",
    scope: SCOPE.BUSINESS,
    priority: 70,
    title: "EIN confirmation letter",
    ask: "your EIN confirmation letter from the IRS",
    why: "Banks match it to the business name before they open an account.",
    subtypes: Object.freeze(["ein_letter"]),
    need: 1,
    unit: "file",
    expires: null,
    docCheck: false,
    sources: Object.freeze([
      local(AGED_CORPS, "59-62", "\"EIN confirmation (CP-575 or IRS e-letter)\" — \"Must match entity name\"."),
      tracked(
        "src/finance/business-info.mjs",
        "The EIN number itself is never stored (last 4 only). The letter is the paper banks ask to see."
      )
    ])
  }),
  Object.freeze({
    key: "certificate_good_standing",
    scope: SCOPE.BUSINESS,
    priority: 80,
    title: "Certificate of Good Standing",
    ask: "a Certificate of Good Standing from your Secretary of State, issued in the last 60 days",
    why: "It shows the business is active with the state. Banks only take one issued in the last 60 days. You can order it online.",
    subtypes: Object.freeze(["certificate_good_standing"]),
    need: 1,
    unit: "file",
    expires: Object.freeze({
      days: 60,
      env: "DOCUMENT_VAULT_GOOD_STANDING_MAX_AGE_DAYS",
      note: "\"Must be issued <= 60 days ago\"."
    }),
    docCheck: false,
    sources: Object.freeze([
      local(AGED_CORPS, "51-54", "\"Certificate of Good Standing\" — \"Must be issued ≤ 60 days ago\".")
    ])
  })
]);

export const ITEM_BY_KEY = Object.freeze(
  Object.fromEntries(STANDARD_ITEMS.map((i) => [i.key, i]))
);

/** Subtypes the vault added. The identity reader (DOC-CHECK) is NOT run on these:
    its prompt only knows ID, proof of address, Articles and a few more, and on
    anything else it would text the client "documents approved, Round 1 shortly"
    or "one thing needs fixing" about a paper it cannot judge. Staff accept these. */
export const VAULT_ONLY_SUBTYPES = Object.freeze([
  "business_bank_statement",
  "business_tax_return",
  "ein_letter",
  "certificate_good_standing",
  "business_license"
]);

/** Documents the vault reads: client uploads and the inquiry door's identity papers. */
export const VAULT_DOCUMENT_KINDS = Object.freeze(["client_upload", "inquiry_doc"]);

/** Subtypes that carry no meaning for the vault and are never listed as unfiled. */
export const IGNORED_SUBTYPES = Object.freeze([
  "dispute_mail_receipt",
  "ssn_card",
  "additional_fraud_docs",
  "ftc_report",
  "bureau_letter"
]);

export const DEFAULT_ASK_EVERY_DAYS = 3;
export const MAX_ASK_EVERY_DAYS = 30;

const wholeDays = (raw, { min = 1, max = 3650 } = {}) => {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const n = Number(String(raw).trim());
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/**
 * vaultSettings(env) — the numbers the owner can move, with where each came from.
 * A value that is not a whole number in range is ignored, never guessed at.
 */
export function vaultSettings(env = process.env) {
  const e = env || {};
  const askEvery = wholeDays(e.DOCUMENT_VAULT_ASK_EVERY_DAYS, { min: 1, max: MAX_ASK_EVERY_DAYS });
  return {
    ask_every_days: askEvery ?? DEFAULT_ASK_EVERY_DAYS,
    ask_every_days_source: askEvery === null ? "default" : "DOCUMENT_VAULT_ASK_EVERY_DAYS",
    statement_window_months: ITEM_BY_KEY.bank_statements_business.expires.months,
    statement_max_age_days: wholeDays(e.DOCUMENT_VAULT_STATEMENT_MAX_AGE_DAYS),
    good_standing_max_age_days:
      wholeDays(e.DOCUMENT_VAULT_GOOD_STANDING_MAX_AGE_DAYS)
      ?? ITEM_BY_KEY.certificate_good_standing.expires.days
  };
}

/**
 * expiryFor(item, env) — the rule that ages a document of this item, or null.
 *   { kind: "months", value: 3 }  or  { kind: "days", value: 60 }
 */
export function expiryFor(item, env = process.env) {
  const rule = item && item.expires;
  if (!rule) return null;
  const override = rule.env ? wholeDays((env || {})[rule.env]) : null;
  if (override !== null) return { kind: "days", value: override, note: rule.note, from_env: rule.env };
  if (rule.months) return { kind: "months", value: rule.months, note: rule.note, from_env: null };
  if (rule.days) return { kind: "days", value: rule.days, note: rule.note, from_env: null };
  return null;
}

export default { STANDARD_ITEMS, ITEM_BY_KEY, VAULT_ONLY_SUBTYPES, vaultSettings, expiryFor, SCOPE };
