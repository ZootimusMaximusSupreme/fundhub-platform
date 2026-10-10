// Capital Blueprint — decline defense, the reading half.
//
// Owner-set offer (docs/finance/capital-blueprint-next-2026-09-29.md): "Decline
// defense: When a bank declines, the system reads the reason and runs the
// reconsideration on the ops side." Owner, 2026-10-06 (recorded in
// docs/finance/decline-defense.md): "If they get declined, they copy the decline
// into the agent; it works out what the reason could be, then finds the
// reconsideration steps an agent can take as a process."
//
// THIS FILE IS PURE. No database, no clock, no network. It takes the text a
// client or a staff member pasted and returns what it can honestly say about it.
// src/blueprint/decline-defense.mjs stores the answer; the FinanceOS money agent
// can call analyzeDecline() as a tool (the TOOL export at the bottom, contract in
// docs/finance/decline-defense.md).
//
// ── THE ONE RULE ─────────────────────────────────────────────────────────────
// Nothing here is invented. Board rule (ops/workflows/blueprint-launch-2026-10-06.md):
// "never invent a bank script, window, or amount — cite the repo source or make
// it staff-set." So:
//   * every reason category below names where it comes from;
//   * every plan line carries `sources` (one or more); a line with no source is
//     a BLANK — `step: null`, `blank: true` — and the ops person writes it;
//   * text the reader cannot match to a category is "needs a person to read",
//     never a guess (needs_person + unknown_parts);
//   * no date is ever picked here. The call date and the re-apply date are
//     staff-set on the decline record.
//
// ── WHERE THE SOURCES LIVE ───────────────────────────────────────────────────
//   repo    files in this repository (paths below).
//   notion  the read-only Notion scrape of the funding playbook
//           (credentials/notion-scrape/output, gitignored). Cited by PAGE TITLE
//           only; every line is paraphrased in our own words. No brand, no price.
//   book    the lender book — the `lenders` table (db/migrations/138_lenders.sql),
//           loaded from docs/legacy-strong/lenders-legacy-strong.csv. Book lines are
//           staff-only (ROLE_SETS.LENDERS, owner call 2026-08-17) and never reach the
//           client view or the task body.
//   letter  the bank's own letter, as pasted.
//   owner   an owner call written down in the repo.
//
// ── THE CLOSED SET OF REASON CATEGORIES, AND WHERE EACH ONE COMES FROM ────────
//   too_many_inquiries     bureau score factor 8 "TOO MANY INQUIRIES LAST 12 MONTHS"
//                          (vendor/underwriteiq-crs/sandbox/exp.json); src/autopsy/
//                          fields.mjs DECLINE_REASONS too_many_inquiries; Notion
//                          "Expectations" (too many recent inquiries read as risk).
//   high_utilization       bureau score factor 10 "PROPORTION OF BALANCE TO LIMITS …
//                          IS TOO HIGH" (exp.json) / "RATIO OF BALANCE TO LIMIT … TOO
//                          HIGH" (efx.json); DECLINE_REASONS high_utilization.
//   accounts_with_balances bureau score factor 5 "TOO MANY ACCOUNTS WITH BALANCES"
//                          (exp.json, efx.json).
//   negative_items         bureau score factor 38 "SERIOUS DELINQUENCY, PUBLIC RECORD,
//                          OR COLLECTION FILED" (exp.json, efx.json); DECLINE_REASONS
//                          derogatory_marks, recent_delinquency, bankruptcy.
//   short_history          bureau score factor 12 "LENGTH OF TIME REVOLVING ACCOUNTS
//                          HAVE BEEN ESTABLISHED" (efx.json); DECLINE_REASONS thin_file.
//   too_many_new_accounts  Notion "Expectations" (several new personal accounts read
//                          as a fraud risk; none in the last six months is best).
//   credit_score           DECLINE_REASONS credit_score.
//   business_too_new       DECLINE_REASONS time_in_business; vendor/underwriteiq-crs/
//                          lender-matrix.js minTIB; lenders.minimum_time_in_business_years.
//   income_or_revenue      DECLINE_REASONS insufficient_revenue;
//                          lenders.minimum_revenue_threshold.
//   industry               DECLINE_REASONS industry_restricted; Notion "Low Risk
//                          Business" (restricted industries are declined automatically).
//   could_not_verify       src/adapters/mailgun.mjs MISSING_DOCS keywords ("verify
//                          your", "identity verification"); Notion "Calling PENDING"
//                          Step 4-B; Notion "Calling DENIED" notes (a simple check).
//   frozen_report          Notion "Application Tips" (a bank that hits a frozen bureau).
//   bank_relationship      lenders.relationship_required / requires_account_opening
//                          (db/migrations/138_lenders.sql); Notion "Importance Of
//                          Banking Relationships".
//   same_bank_exposure     Notion "Applying again at the same bank"; Notion
//                          "Expectations" (card use lowers approvals at the same bank).
// Anything else in a letter → unknown_parts → needs a person.

import { createHash } from "node:crypto";
import { classifyBankEmail } from "../adapters/mailgun.mjs";
import { SUGGESTION_CATALOGUE } from "../underwrite/report.mjs";

export const MAX_LETTER_CHARS = 20000;
export const MIN_LETTER_CHARS = 20;
export const SOURCE_KINDS = Object.freeze(["notion", "repo", "book", "letter", "owner"]);
/* How a kind is named when one line cites sources of different kinds. */
export const KIND_WORDS = Object.freeze({ notion: "Notion page", repo: "Repo", book: "Lender book", letter: "Letter", owner: "Owner call" });

/** One line of text for a step's sources. Same kind: the refs joined (a screen
 *  adds the kind once). Mixed kinds: each ref is named with its own kind, so a
 *  repo file is never labelled a Notion page. */
export function sourceRefText(sources) {
  const list = (Array.isArray(sources) ? sources : []).filter((x) => x && x.ref);
  if (!list.length) return null;
  const mixed = new Set(list.map((x) => x.kind)).size > 1;
  return list.map((x) => (mixed ? `${KIND_WORDS[x.kind] || x.kind}: ${x.ref}` : x.ref)).join(" + ");
}
export const WHO = Object.freeze(["agent", "ops", "client"]);
export const LOOKS_LIKE = Object.freeze(["decline", "approval", "counteroffer", "needs_info", "unclear"]);

/* ── sources ─────────────────────────────────────────────────────────────── */

function src(kind, ref, note = null) {
  return Object.freeze({ kind, ref, note });
}

/** The engine's own sentence for a catalogue id — read from the file, never copied. */
export function catalogueText(id) {
  for (const [text, entry] of Object.entries(SUGGESTION_CATALOGUE)) {
    if (entry && entry.id === id) return text;
  }
  return null;
}
const catalogue = (id) => src("repo", `src/underwrite/report.mjs SUGGESTION_CATALOGUE ${id}`);
const autopsy = (...keys) => src("repo", `src/autopsy/fields.mjs DECLINE_REASONS ${keys.join(", ")}`);

export const S = Object.freeze({
  offer: src("repo", "docs/finance/capital-blueprint-next-2026-09-29.md",
    "Decline defense: when a bank declines, the system reads the reason and runs the reconsideration on the ops side."),
  ownerPaste: src("owner", "docs/finance/decline-defense.md (owner call 2026-10-06)",
    "The client copies the decline in; it works out the reason, then finds the reconsideration steps."),
  ownerUnknown: src("owner", "ops/workflows/blueprint-launch-2026-10-06.md (unit B1 brief)",
    "Text it cannot map is 'needs a person to read'."),
  ownerOutcome: src("owner", "ops/workflows/blueprint-launch-2026-10-06.md (unit B1 brief)",
    "Track the outcome: approved on reconsideration, still declined, or a re-apply date."),
  callingDeniedPrep: src("notion", "Calling DENIED — Step 1", "Collect the personal and business facts before the call."),
  callingDeniedNumber: src("notion", "Calling DENIED — Step 2",
    "Find the bank's number on a list of reconsideration lines, or look up the bank's contact details."),
  callingDeniedOpen: src("notion", "Calling DENIED — Step 3", "Open by asking about the recent application and the limit."),
  callingDeniedPush: src("notion", "Calling DENIED — Step 4",
    "Answer the reason, ask for reconsideration and a manual review, point to the strengths of the report."),
  callingDeniedNotes: src("notion", "Calling DENIED — Steps 4 and 5", "Write a summary of each call and the next step."),
  callingDeniedAgain: src("notion", "Calling DENIED — Step 5 and notes", "Call at least 4 times; hang up and call again 4 to 6 times."),
  callingDeniedCheck: src("notion", "Calling DENIED — notes", "Sometimes the bank only wants to confirm information."),
  callingPending: src("notion", "Calling PENDING — Step 4-B", "Ask whether they need anything verified."),
  fundingPlanDenied: src("notion", "Preparing Funding Plan — Track, Update",
    "Status Denied: add a reconsideration date; a second denial is tagged Denied."),
  fundingPlanQuickRef: src("notion", "Preparing Funding Plan — Quick Reference",
    "Too many pulls on one bureau: lead with banks that pull the others. Maxed cards: re-apply after paying down."),
  rmAfterIntro: src("notion", "Relationship Managers — After Introduction",
    "Bank denies or gives a low limit: ask the RM to push for reconsideration."),
  rmIndustry: src("notion", "Relationship Managers — industry / NAICS", "Be specific about a low-risk industry; the banker has to say it."),
  rmList: src("repo", "docs/legacy-strong/bankers-rms.md", "The RM list has a banker at this bank (names are not copied here)."),
  appTipsRecon: src("notion", "Application Tips — Handling Denials", "Pursue reconsideration for every denial."),
  appTipsFrozen: src("notion", "Application Tips — Credit Bureau Strategy",
    "If a bank tries a frozen bureau, ask for another; if it cannot, postpone."),
  expectations: src("notion", "Expectations — Factors Limiting Business Funding",
    "Too many recent inquiries read as risk; several new personal accounts read as fraud risk; card use lowers approvals at the same bank."),
  expectationsNewAccounts: src("notion", "Expectations — New Accounts and Fraud Concerns",
    "Best practice: no new personal accounts in the last six months."),
  expectationsInquiries: src("notion", "Expectations — Inquiry Handling", "You can apply for more funding after removing inquiries."),
  bureauStacking: src("notion", "Hard inquiries - Bureau stacking",
    "Inquiries matter most for 6 months and stop at 12; under 3 in 6 months and under 6 in 12 months on a bureau is open."),
  sameBank: src("notion", "Applying again at the same bank",
    "For another card at the same bank, pay that bank's card under 50% first, before you submit."),
  lowRisk: src("notion", "Low Risk Business", "Restricted industries can be declined automatically."),
  bankingRelationships: src("notion", "Importance Of Banking Relationships",
    "Banks look at how long you have banked with them, which services you use, and your history."),
  factorInquiries: src("repo", "vendor/underwriteiq-crs/sandbox/exp.json bureau score factor 8", "TOO MANY INQUIRIES LAST 12 MONTHS"),
  factorUtilization: src("repo", "vendor/underwriteiq-crs/sandbox/exp.json + efx.json bureau score factor 10",
    "PROPORTION OF BALANCE TO LIMITS … IS TOO HIGH"),
  factorBalances: src("repo", "vendor/underwriteiq-crs/sandbox/exp.json + efx.json bureau score factor 5", "TOO MANY ACCOUNTS WITH BALANCES"),
  factorDerogatory: src("repo", "vendor/underwriteiq-crs/sandbox/exp.json + efx.json bureau score factor 38",
    "SERIOUS DELINQUENCY, PUBLIC RECORD, OR COLLECTION FILED"),
  factorHistory: src("repo", "vendor/underwriteiq-crs/sandbox/efx.json bureau score factor 12",
    "LENGTH OF TIME REVOLVING ACCOUNTS HAVE BEEN ESTABLISHED"),
  mailgunVerify: src("repo", "src/adapters/mailgun.mjs CLASSIFICATION_RULES MISSING_DOCS", "verify your / identity verification"),
  lenderSchema: src("repo", "db/migrations/138_lenders.sql",
    "relationship_required, requires_account_opening, minimum_time_in_business_years, minimum_revenue_threshold"),
  lenderMatrix: src("repo", "vendor/underwriteiq-crs/lender-matrix.js minTIB", "months time in business required"),
  uploadKinds: src("repo", "src/documents/kinds.mjs client_upload",
    "id_document, proof_of_address, bank_statement, tax_return, proof_of_income"),
  docVault: src("repo", "docs/finance/capital-blueprint-next-2026-09-29.md (Application document vault)",
    "Collect bank statements, tax returns and ID ahead of time."),
  noNewCredit: src("repo", "db/migrations/362_waypoint_definitions_seed.sql no_new_credit",
    "Do not open new credit while we work on your file."),
  bankTracker: src("repo", "src/blueprint/bank-relationship.mjs + offer (Bank relationship tracker)",
    "Open accounts at the match-list banks so the relationship is built before applying."),
  paydownPlan: src("repo", "src/blueprint/paydown-simulator.mjs (FinanceOS Strategy)", "Splits cash across the cards."),
  paymentTiming: src("repo", "docs/finance/capital-blueprint-next-2026-09-29.md (Payment timing)",
    "Balances report on the statement date."),
  disputeSteps: src("repo", "docs/finance/capital-blueprint-next-2026-09-29.md (Dispute-round steps)",
    "Dispute steps clear only with proof."),
  letter: src("letter", "the bank's letter (pasted)")
});

/* ── the closed set ──────────────────────────────────────────────────────── */

/* Each category: plain words, sources, the phrases that recognise it, the
   ops talking point (null = a blank for the ops person), what to fix first, and
   any timing a source states. The phrases are the recognisers for the sourced
   wording above; they decide nothing about the client beyond "the letter said
   this". */
function cat(def) {
  return Object.freeze({
    talk: null,
    fix: [],
    when: [],
    ...def
  });
}

export const REASON_CATEGORIES = Object.freeze([
  cat({
    key: "too_many_inquiries",
    label: "Too many recent credit checks",
    client_words: "The bank saw too many recent credit checks (hard inquiries) on your report.",
    sources: [S.factorInquiries, autopsy("too_many_inquiries"), S.expectations],
    patterns: [/\binquir(?:y|ies)\b/i],
    fix: [
      { key: "clean_inquiries", who: "client", text: catalogueText("inquiries_many"), client: catalogueText("inquiries_many"), sources: [catalogue("inquiries_many")] },
      { key: "next_bureau", who: "ops", text: "If most of the checks sit on one bureau, pick the next banks from ones that pull a different bureau.",
        client: "We pick the next banks to fit where your credit checks are.", sources: [S.fundingPlanQuickRef, S.bureauStacking] }
    ],
    when: [
      { text: "Credit checks count most for 6 months and stop counting after 12. A bureau with fewer than 3 checks in 6 months, and fewer than 6 in 12 months, is open to apply on again.", sources: [S.bureauStacking] },
      { text: "You can apply again after the extra credit checks are removed.", sources: [S.expectationsInquiries] }
    ]
  }),
  cat({
    key: "high_utilization",
    label: "Cards used too much",
    client_words: "The bank saw high balances compared to your card limits.",
    sources: [S.factorUtilization, autopsy("high_utilization")],
    patterns: [
      /\b(?:proportion|ratio|amount)\s+of\s+(?:revolving\s+)?balances?\s+to\s+(?:credit\s+)?limits?\b/i,
      /\butili[sz]ation\b/i,
      /\bbalances?\s+(?:is|are)?\s*too\s+high\b/i,
      /\b(?:revolving|card)\s+balances?\s+(?:is\s+|are\s+)?(?:too\s+)?high\b/i,
      /\bbalances?\s+(?:compared|relative)\s+to\s+(?:your\s+)?(?:credit\s+)?limits?\b/i
    ],
    fix: [
      { key: "under_30", who: "client", text: catalogueText("utilization_over_target"), client: catalogueText("utilization_over_target"), sources: [catalogue("utilization_over_target")] },
      { key: "paydown_plan", who: "client", text: "Use the paydown plan in FinanceOS to choose which cards to pay first.",
        client: "Use the paydown plan in FinanceOS to choose which cards to pay first.", sources: [S.paydownPlan] },
      { key: "pay_before_statement", who: "client", text: "Pay before each card's statement date, because that is the day the balance reports.",
        client: "Pay before each card's statement date, because that is the day the balance reports.", sources: [S.paymentTiming] }
    ],
    when: [
      { text: "Apply again after the lower balances report on each card's statement date.", sources: [S.fundingPlanQuickRef, S.paymentTiming] }
    ]
  }),
  cat({
    key: "accounts_with_balances",
    label: "Too many cards with a balance",
    client_words: "The bank saw too many accounts carrying a balance.",
    sources: [S.factorBalances],
    patterns: [/\b(?:too\s+many|number\s+of)\s+(?:revolving\s+)?accounts?\s+with\s+(?:a\s+)?balances?\b/i],
    fix: [
      { key: "paydown_plan", who: "client", text: "Use the paydown plan in FinanceOS to choose which cards to pay first.",
        client: "Use the paydown plan in FinanceOS to choose which cards to pay first.", sources: [S.paydownPlan] },
      { key: "pay_before_statement", who: "client", text: "Pay before each card's statement date, because that is the day the balance reports.",
        client: "Pay before each card's statement date, because that is the day the balance reports.", sources: [S.paymentTiming] }
    ],
    when: [
      { text: "Apply again after the lower balances report on each card's statement date.", sources: [S.fundingPlanQuickRef, S.paymentTiming] }
    ]
  }),
  cat({
    key: "negative_items",
    label: "Late payments or collections",
    client_words: "The bank saw late payments, collections or public records on your report.",
    sources: [S.factorDerogatory, autopsy("derogatory_marks", "recent_delinquency", "bankruptcy")],
    patterns: [
      /\bdelinquen\w*/i,
      /\bpublic\s+records?\b/i,
      /\bcollections?\b(?!\s+of\b)/i,
      /\bcharge[\s-]?offs?\b|\bcharged\s+off\b/i,
      /\bderogatory\b/i,
      /\bbankruptc\w*/i,
      /\blate\s+payments?\b|\bpast\s+due\b|\bpayment\s+history\b/i
    ],
    fix: [
      { key: "disputes", who: "client", text: catalogueText("negatives_some"), client: catalogueText("negatives_some"), sources: [catalogue("negatives_some")] },
      { key: "dispute_steps", who: "client", text: "Keep working the dispute steps on your checklist. Each one clears with proof.",
        client: "Keep working the dispute steps on your checklist. Each one clears with proof.", sources: [S.disputeSteps] }
    ]
  }),
  cat({
    key: "short_history",
    label: "Credit history too short",
    client_words: "The bank wanted a longer credit history.",
    sources: [S.factorHistory, autopsy("thin_file")],
    patterns: [
      /\blength\s+of\s+(?:time|credit\s+history)\b/i,
      /\baccounts?\s+(?:have\s+been\s+|has\s+been\s+)?established\b/i,
      /\b(?:limited|insufficient|not\s+enough|lack\s+of|no)\s+(?:credit\s+)?(?:history|experience)\b/i,
      /\bthin\s+(?:credit\s+)?file\b/i,
      /\btoo\s+few\s+(?:revolving\s+)?accounts\b/i
    ],
    fix: [
      { key: "add_tradelines", who: "client", text: catalogueText("file_thin_partial"), client: catalogueText("file_thin_partial"), sources: [catalogue("file_thin_partial")] }
    ]
  }),
  cat({
    key: "too_many_new_accounts",
    label: "Too many new accounts",
    client_words: "The bank saw too many accounts opened recently.",
    sources: [S.expectations],
    patterns: [
      /\b(?:too\s+many|number\s+of)\s+(?:new|recent|recently\s+opened)\s+(?:credit\s+)?(?:accounts?|cards?)\b/i,
      /\b(?:accounts?|cards?)\s+(?:opened|established)\s+(?:recently|in\s+the\s+(?:last|past))\b/i,
      /\brecently\s+opened\s+(?:accounts?|cards?)\b/i
    ],
    fix: [
      { key: "no_new_credit", who: "client", text: "Do not open new credit while we work on your file.",
        client: "Do not open new credit while we work on your file.", sources: [S.noNewCredit] }
    ],
    when: [
      { text: "Apply again once your newest personal account is 6 months old.", sources: [S.expectationsNewAccounts] }
    ]
  }),
  cat({
    key: "credit_score",
    label: "Credit score too low",
    client_words: "The bank said your credit score was lower than it wanted.",
    sources: [autopsy("credit_score")],
    patterns: [
      /\b(?:credit|fico|bureau)\s+score\b[^.\n]{0,60}\b(?:too\s+low|low|below|does\s+not\s+meet|did\s+not\s+meet|insufficient|not\s+high\s+enough)\b/i,
      /\b(?:low|insufficient)\s+(?:credit\s+|fico\s+)?score\b/i,
      /\bscore\s+(?:is\s+|was\s+)?(?:too\s+low|below)\b/i
    ]
  }),
  cat({
    key: "business_too_new",
    label: "Business too new",
    client_words: "The bank wanted the business to be older.",
    sources: [autopsy("time_in_business"), S.lenderMatrix, S.lenderSchema],
    patterns: [
      /\btime\s+in\s+business\b/i,
      /\b(?:business|company)\s+(?:is\s+)?too\s+new\b/i,
      /\b(?:years|length\s+of\s+time)\s+in\s+business\b/i,
      /\b(?:business|company)\s+(?:age|history)\b/i,
      /\bnewly\s+(?:formed|established)\s+business\b/i
    ],
    fix: [
      { key: "season_business", who: "client", text: "Business approvals and limits get better once the business is 6 months old, and better again at 12 to 24 months.",
        client: "Business approvals and limits get better once the business is 6 months old, and better again at 12 to 24 months.",
        sources: [catalogue("llc_under_6_months"), catalogue("llc_seasoning")] }
    ],
    when: [
      { text: "Apply again after the business is past 6 months old.", sources: [catalogue("llc_under_6_months")] }
    ]
  }),
  cat({
    key: "income_or_revenue",
    label: "Income or revenue too low",
    client_words: "The bank wanted to see more income or revenue.",
    sources: [autopsy("insufficient_revenue"), S.lenderSchema],
    patterns: [
      /\b(?:insufficient|low|limited|not\s+enough|inadequate|unverified)\s+(?:income|revenue|cash\s+flow|sales)\b/i,
      /\b(?:income|revenue|cash\s+flow)\s+(?:is\s+|was\s+)?(?:insufficient|too\s+low|not\s+enough|below)\b/i,
      /\bdebt[\s-]+to[\s-]+income\b/i,
      /\bunable\s+to\s+verify\s+(?:your\s+)?(?:income|revenue)\b/i
    ],
    fix: [
      { key: "income_papers", who: "client", text: "Have bank statements, tax returns and proof of income ready to show the bank.",
        client: "Have bank statements, tax returns and proof of income ready to show the bank.", sources: [S.docVault, S.uploadKinds] }
    ]
  }),
  cat({
    key: "industry",
    label: "Type of business",
    client_words: "The bank has rules about the kind of business you run.",
    sources: [autopsy("industry_restricted"), S.lowRisk],
    patterns: [
      /\b(?:industry|type\s+of\s+business|nature\s+of\s+(?:your\s+)?business|business\s+type|line\s+of\s+business)\b/i,
      /\b(?:naics|sic\s+code)\b/i
    ],
    talk: { text: "Describe what the business does clearly and specifically, so the banker can explain its risk.",
      sources: [S.rmIndustry] },
    fix: [
      { key: "industry_list", who: "ops", text: "Check whether the business's industry is on a high-risk or restricted list. Some industries are declined automatically.",
        client: "We check how banks see your business's industry.", sources: [S.lowRisk] }
    ]
  }),
  cat({
    key: "could_not_verify",
    label: "The bank could not check your info",
    client_words: "The bank could not confirm some of your information.",
    sources: [S.mailgunVerify, S.callingPending, S.callingDeniedCheck],
    patterns: [
      /\b(?:unable|could\s+not|couldn['’]t|cannot|can['’]t)\s+(?:to\s+)?(?:verify|confirm|validate|authenticate)\b/i,
      /\bidentity\s+(?:verification|could\s+not\s+be\s+verified)\b/i,
      /\bverify\s+your\s+(?:identity|information|address|income|business)\b/i,
      /\b(?:incomplete|missing)\s+(?:application|information|documents?)\b/i,
      /\badditional\s+(?:documentation|information|documents?)\s+(?:is\s+|are\s+)?(?:required|needed)\b/i
    ],
    talk: { text: "Ask whether they need anything verified, and offer to send it. Sometimes the bank only wants to confirm information.",
      sources: [S.callingPending, S.callingDeniedCheck] },
    fix: [
      { key: "id_papers", who: "client", text: "Upload your ID and proof of address so they are ready if the bank asks.",
        client: "Upload your ID and proof of address so they are ready if the bank asks.", sources: [S.uploadKinds, S.docVault] }
    ]
  }),
  cat({
    key: "frozen_report",
    label: "Credit report frozen",
    client_words: "The bank could not read your credit report because it is frozen.",
    sources: [S.appTipsFrozen],
    patterns: [
      /\b(?:frozen|freeze|locked)\b[^.\n]{0,60}\b(?:credit|report|file|bureau)\b|\b(?:credit|report|file|bureau)\b[^.\n]{0,60}\b(?:frozen|freeze|locked)\b/i,
      /\b(?:unable|could\s+not|couldn['’]t)\s+(?:to\s+)?(?:access|obtain|retrieve|pull)\s+(?:your\s+)?credit\s+(?:report|file|history)\b/i
    ],
    talk: { text: "Ask the bank to pull a different bureau. If it cannot, put the application off until later.",
      sources: [S.appTipsFrozen] },
    when: [
      { text: "If the bank cannot use another bureau, wait and apply later.", sources: [S.appTipsFrozen] }
    ]
  }),
  cat({
    key: "bank_relationship",
    label: "No account with this bank yet",
    client_words: "The bank wanted you to already bank with them.",
    sources: [S.lenderSchema, S.bankingRelationships],
    patterns: [
      /\b(?:no|insufficient|limited|lack\s+of|without\s+an?)\s+(?:existing\s+|prior\s+)?(?:banking\s+)?relationship\b/i,
      /\b(?:existing|prior|established)\s+(?:banking\s+)?relationship\b/i,
      /\b(?:deposit|checking|business\s+checking)\s+account\s+(?:is\s+)?required\b/i,
      /\brelationship\s+with\s+(?:us|the\s+bank|our\s+bank)\b/i
    ],
    fix: [
      { key: "open_account", who: "client", text: "Open an account at this bank and use it before applying again. The Blueprint bank tracker follows those accounts.",
        client: "Open an account at this bank and use it before applying again. The Blueprint bank tracker follows those accounts.",
        sources: [S.bankTracker, S.bankingRelationships] }
    ]
  }),
  cat({
    key: "same_bank_exposure",
    label: "Already a lot of credit at this bank",
    client_words: "The bank looked at the credit you already have with them.",
    sources: [S.sameBank, S.expectations],
    patterns: [
      /\b(?:existing|current|total|outstanding)\s+(?:credit|exposure|lines?|balances?|debt|accounts?)\s+(?:with\s+us|with\s+(?:the\s+)?bank|at\s+(?:the\s+)?bank|we\s+have\s+extended)\b/i,
      /\btoo\s+much\s+(?:credit|exposure)\s+with\s+us\b/i,
      /\b(?:number\s+of|too\s+many)\s+(?:accounts|cards)\s+with\s+us\b/i,
      /\bcredit\s+(?:we|the\s+bank)\s+(?:has|have)\s+(?:already\s+)?extended\b/i
    ],
    fix: [
      { key: "same_bank_50", who: "client", text: "Pay your card at this same bank under 50% of its limit before applying there again.",
        client: "Pay your card at this same bank under 50% of its limit before applying there again.", sources: [S.sameBank] }
    ],
    when: [
      { text: "Make that payment before the next application at this bank.", sources: [S.sameBank] }
    ]
  })
]);

export const REASON_KEYS = Object.freeze(REASON_CATEGORIES.map((c) => c.key));
const BY_KEY = new Map(REASON_CATEGORIES.map((c) => [c.key, c]));
export function categoryOf(key) { return BY_KEY.get(key) || null; }

/* ── text hygiene ────────────────────────────────────────────────────────── */

/* A decline letter carries the client's own numbers. Masked BEFORE anything is
   read, stored or quoted: an SSN shape, a bare 9-digit run, a card-number run,
   a long bare digit run (account numbers), and a date written after "birth".
   Phone numbers written with dashes, dots or brackets are left alone on
   purpose — the bank's own phone line is the most useful thing in the letter. */
export const MASK_TEXT = "[number removed]";
const MASKS = [
  { re: /\b\d{3}-\d{2}-\d{4}\b/g, keepLead: false },
  { re: /\b(?:\d[ -]?){12,18}\d\b/g, keepLead: false },
  { re: /\b\d{9,}\b/g, keepLead: false },
  { re: /\b((?:date\s+of\s+birth|dob|birth\s*date)\s*[:-]?\s*)\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/gi, keepLead: true }
];

export function maskSensitive(text) {
  let out = String(text ?? "");
  let count = 0;
  for (const { re, keepLead } of MASKS) {
    out = out.replace(re, (...args) => {
      count += 1;
      return keepLead ? `${args[1]}${MASK_TEXT}` : MASK_TEXT;
    });
  }
  return { text: out, masked: count };
}

/** Same letter, same hash — whitespace and case do not make a second decline. */
export function letterHash(text) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!flat) return null;
  return createHash("sha256").update(flat).digest("hex");
}

const PHONE = /(?:\+?1[\s.-])?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g;

export function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  return `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

/** Phone numbers the BANK wrote in its letter, each with the sentence it sat in.
 *  A credit bureau's address block (the FCRA notice names the bureau, its P.O.
 *  box and its phone) is skipped: that number reaches the bureau, not the bank. */
export function findPhones(text, { max = 3 } = {}) {
  const out = [];
  const seen = new Set();
  for (const seg of segments(String(text ?? ""))) {
    if (isBoilerplate(seg.text) || bureausNamed(seg.text).length) continue;
    for (const m of seg.text.matchAll(PHONE)) {
      const number = normalizePhone(m[0]);
      if (!number || seen.has(number)) continue;
      seen.add(number);
      out.push({ number, said: clip(seg.text, 160) });
      if (out.length >= max) return out;
    }
  }
  return out;
}

const BUREAU_WORDS = [["experian", /\bexperian\b/i], ["equifax", /\bequifax\b/i], ["transunion", /\btrans\s?union\b/i]];
/** Which credit bureaus the letter names (an adverse-action letter names the one used). */
export function bureausNamed(text) {
  const t = String(text ?? "");
  return BUREAU_WORDS.filter(([, re]) => re.test(t)).map(([k]) => k);
}

function clip(s, n) {
  const flat = String(s || "").replace(/\s+/g, " ").trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1).trimEnd()}…`;
}

/* ── reading the letter ──────────────────────────────────────────────────── */

/* Lines, then sentences. A blank line ends a list. Bullets are stripped. A
   sentence never ends after a one-letter abbreviation ("P.O. Box", "U.S. Bank",
   "N.A.") or a short title ("Inc.", "No."). */
const SENTENCE_END = /(?<=[.;!?])(?<!\b[A-Za-z]\.)(?<!\b(?:Mr|Mrs|Ms|Dr|No|St|Inc|Co|Corp|Ltd|Jr|Sr)\.)\s+(?=[A-Z0-9"'“(])/;

function segments(text) {
  const out = [];
  let block = 0;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.replace(/^[\s•\-*–·>]+|^\s*\d{1,2}[.)]\s+/, "").trim();
    if (!line) { block += 1; continue; }
    for (const piece of line.split(SENTENCE_END)) {
      const t = piece.trim();
      if (t) out.push({ text: t, block, raw: rawLine });
    }
  }
  return out;
}

/* Legal notices, greetings, addresses, links and the score disclosure — never a
   reason, so never an unknown either. */
const BOILERPLATE = [
  /equal\s+credit\s+opportunity|prohibits\s+creditors|federal\s+agency\s+that\s+administers|comptroller\s+of\s+the\s+currency|consumer\s+financial\s+protection|federal\s+trade\s+commission/i,
  /fair\s+credit\s+reporting\s+act|consumer\s+reporting\s+agenc|reporting\s+agency|credit\s+bureau\s+listed|free\s+copy|dispute\s+the\s+(?:matter|accuracy)|played\s+no\s+part|unable\s+to\s+(?:supply|provide)\s+(?:you\s+)?(?:with\s+)?(?:the\s+)?specific\s+reasons/i,
  /^(?:dear|hello|hi)\b|^thank\s+you\b|^sincerely\b|^regards\b|^re\s*:|^subject\s*:|^from\s*:|^to\s*:|^sent\s*:|^date\s*:/i,
  /\bp\.?\s?o\.?\s+box\b|\bsuite\s+\d|\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/,
  /\bwww\.|https?:\/\/|\b[a-z0-9-]+\.(?:com|org|gov|net)\b/i,
  /^(?:application|reference|account|case)\s*(?:number|no\.?|id|#)\b|^your\s+(?:application|reference)\s+(?:number|id)\b/i,
  /\byour\s+credit\s+score\s*(?:is|was|:)|\bscores?\s+range\s+from\b|\bscore\s+(?:we\s+used|was\s+provided)\b|\bdate\s+(?:of\s+)?(?:the\s+)?score\b/i
];

/* The bank stating its decision. "We are unable to approve your application" is
   the decision, not a reason, so it is neither a category nor an unknown. */
const DECISION = /\b(?:unable\s+to\s+(?:approve|open|offer|extend)|not\s+(?:able\s+to\s+)?approve|cannot\s+approve|can['’]t\s+approve|were\s+not\s+approved|was\s+not\s+approved|have\s+declined|has\s+been\s+declined|was\s+declined|declined\s+your|denied|regret\s+to\s+inform|not\s+in\s+a\s+position)\b/i;

/* A line that introduces the reasons. What follows it, up to a blank line, is a
   reason list. */
const HEADER = /\b(?:principal|specific|primary|main|key)?\s*(?:reasons?|factors?)\b/i;

/* Words that make an unmatched line look like a reason rather than prose. */
const REASON_CUE = /\b(?:insufficient|too\s+(?:many|much|high|low|few|new|short|recent)|not\s+enough|unable\s+to|limited|lack\s+of|excessive|delinquen\w*|derogatory|exceeds?|exceeded|below\s+(?:our|the)|does\s+not\s+meet|did\s+not\s+meet|do\s+not\s+meet|inadequate|no\s+(?:record|history)|unsatisfactory|incomplete|outside\s+(?:of\s+)?our)\b/i;

function isBoilerplate(t) { return BOILERPLATE.some((re) => re.test(t)); }

/**
 * Which categories the text names, with the words that named them, and the
 * reason-like lines that matched nothing.
 *
 * @returns {{ reasons: {category, label, client_words, evidence_quote, sources}[], unknown_parts: string[] }}
 */
export function readReasons(text) {
  const segs = segments(text);
  const found = new Map();
  const unknown = [];
  let sectionBlock = null;

  for (const seg of segs) {
    const t = seg.text;
    if (sectionBlock !== null && seg.block !== sectionBlock) sectionBlock = null;

    let matched = false;
    for (const c of REASON_CATEGORIES) {
      if (c.patterns.some((re) => re.test(t))) {
        matched = true;
        if (!found.has(c.key)) found.set(c.key, clip(t, 220));
      }
    }
    if (matched) continue;
    if (isBoilerplate(t)) continue;

    const header = HEADER.test(t) && (/:\s*$/.test(t) || t.length <= 120);
    if (header) { sectionBlock = seg.block; continue; }
    if (DECISION.test(t)) continue;

    const inSection = sectionBlock !== null && seg.block === sectionBlock;
    if (inSection || REASON_CUE.test(t)) {
      const q = clip(t, 220);
      if (!unknown.includes(q) && unknown.length < 10) unknown.push(q);
    }
  }

  const reasons = REASON_CATEGORIES.filter((c) => found.has(c.key)).map((c) => ({
    category: c.key,
    label: c.label,
    client_words: c.client_words,
    evidence_quote: found.get(c.key),
    sources: c.sources
  }));
  return { reasons, unknown_parts: unknown };
}

/* Deadlines the BANK wrote in its own letter about a second look ("call us
   within 30 days"). Quoted, never computed. The free-report notice (60 days) is
   about the credit report, not the decision, so it is not one of these. */
const DEADLINE = /\b(?:within|no\s+later\s+than|in\s+the\s+next)\s+(\d{1,3})\s+(?:calendar\s+|business\s+)?days?\b/i;
const DEADLINE_ABOUT = /\b(?:reconsider\w*|review|appeal|call|contact|questions?|additional\s+information|resubmit|re-?apply)\b/i;

export function letterDeadlines(text) {
  const out = [];
  for (const seg of segments(String(text ?? ""))) {
    if (DEADLINE.test(seg.text) && DEADLINE_ABOUT.test(seg.text) && !/free\s+copy|credit\s+report\s+from/i.test(seg.text)) {
      const q = clip(seg.text, 220);
      if (!out.includes(q)) out.push(q);
    }
  }
  return out.slice(0, 3);
}

/* ── the bank ────────────────────────────────────────────────────────────── */

/** "Chase Bank, N.A." → "chase"; "U.S. Bank" → "us". The key for book matching. */
export function normalizeBankName(name) {
  let s = String(name ?? "").toLowerCase()
    .replace(/\./g, "")
    .replace(/[^a-z0-9& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  s = s.replace(/^the\s+/, "");
  s = s.replace(/\s+(?:n a|na|national association|bank|bank n a|bank na)$/, "");
  s = s.replace(/\s+bank$/, "");
  return s.trim();
}

/** The two compact keys a book row's name can reduce to ("chase", "chasebank"). */
export function bankKeys(name) {
  const base = normalizeBankName(name).replace(/[^a-z0-9]/g, "");
  if (!base) return [];
  return [base, `${base}bank`];
}

/* docs/legacy-strong/bankers-rms.md — the RM database extract lists a banker at
   these banks. The names are people; only the bank is used here. */
export const RM_BANKS = Object.freeze(["chase", "us", "pnc", "truist", "bluevine", "wells fargo"]);

export function rmOnFile(bank) {
  const n = normalizeBankName(bank);
  if (!n) return false;
  return RM_BANKS.some((b) => n === b || n.startsWith(`${b} `) || n.endsWith(` ${b}`) || (b.includes(" ") && n.includes(b)));
}

/* Book tips that matter on a decline: reconsideration, the RM, the branch, an
   account the bank wants first, seasoning, waiting, phone lines. Tips about
   stating income, net worth or spend are left out — they are not a reconsideration
   step and this file will not repeat them. */
const BOOK_KEEP = /\brecon\w*|\breconsider\w*|relationship\s+manager|\bRMs?\b|\bbanker\b|\bbranch\b|\bchecking\b|\bdeposit\b|\bseason\w*|\bwait\b|one\s+at\s+a\s+time|apply\s+one\b|\b5\s+or\s+more\b|\b5\/24\b|\bcall\b|\bphone\b|\b\d{3}-\d{3}-\d{4}\b/i;
const BOOK_DROP = /net\s+worth|\bincome\b|monthly\s+spend|\$\s?\d|\bclaim\b|unverified|\bVPN\b|report(?:ing)?\s+(?:high|multi)/i;
const BOOK_TEXT_FIELDS = ["insider_tips", "notes", "underwriter_interaction", "relationship_manager", "branch_location_info"];
const BIZ_TABLES = new Set(["InBranchBizCC", "OnlineBizCC", "BizLOC_Stated", "BizLOC_Documented"]);
const PERSONAL_TABLES = new Set(["PersonalCC", "PersonalLoans", "PersonalLOC"]);

function yes(v) { return /^\s*(?:yes|y|true|required)\b/i.test(String(v ?? "")); }

/** Narrow book rows to the product kind when the product says business or personal. */
export function pickBookRows(rows, { product } = {}) {
  const list = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const p = String(product ?? "");
  let want = null;
  if (/\b(?:business|biz)\b/i.test(p)) want = BIZ_TABLES;
  else if (/\bpersonal\b/i.test(p)) want = PERSONAL_TABLES;
  if (!want) return list;
  const narrowed = list.filter((r) => want.has(r.lender_table));
  return narrowed.length ? narrowed : list;
}

/**
 * What the lender book says about this bank that matters on a decline.
 * STAFF ONLY — never put any of this in the client view or the task body.
 */
export function bookFacts(rows = [], { bank = null, product = null } = {}) {
  const list = pickBookRows(rows, { product }).slice(0, 12);
  const phones = [];
  const notes = [];
  const seenPhone = new Set();
  const seenNote = new Set();
  let relationshipRequired = null;
  let accountOpening = null;
  let tib = null;
  let revenue = null;
  const bureaus = new Set();

  for (const r of list) {
    if (r.relationship_required != null) relationshipRequired = relationshipRequired || yes(r.relationship_required);
    if (r.requires_account_opening != null) accountOpening = accountOpening || yes(r.requires_account_opening);
    const t = Number(r.minimum_time_in_business_years);
    if (Number.isFinite(t) && t > 0 && (tib === null || t < tib.years)) tib = { years: t, lender_id: r.id };
    const m = Number(r.minimum_revenue_threshold);
    if (Number.isFinite(m) && m > 0 && (revenue === null || m < revenue.dollars)) revenue = { dollars: m, lender_id: r.id };
    if (r.bureaus_pulled) bureaus.add(String(r.bureaus_pulled).trim());

    for (const field of BOOK_TEXT_FIELDS) {
      const raw = r[field];
      if (!raw) continue;
      for (const piece of String(raw).split(/;\s*|\n+/)) {
        const tip = piece.replace(/\s+/g, " ").trim();
        if (!tip || /^source:/i.test(tip) || /^hub refs:/i.test(tip)) continue;
        for (const m2 of tip.matchAll(PHONE)) {
          const number = normalizePhone(m2[0]);
          if (number && !seenPhone.has(number)) {
            seenPhone.add(number);
            phones.push({ number, said: clip(tip, 160), lender_id: r.id, field });
          }
        }
        if (!BOOK_KEEP.test(tip) || BOOK_DROP.test(tip)) continue;
        const key = tip.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
        if (seenNote.has(key) || notes.length >= 6) continue;
        seenNote.add(key);
        notes.push({ text: clip(tip, 200), lender_id: r.id, field });
      }
    }
  }

  return {
    bank: bank || null,
    lender_ids: list.map((r) => r.id).filter(Boolean),
    rows_found: list.length,
    book_phones: phones,
    book_notes: notes,
    relationship_required: relationshipRequired,
    requires_account_opening: accountOpening,
    min_time_in_business: tib,
    min_revenue: revenue,
    bureaus_pulled: [...bureaus]
  };
}

/* ── the plan ────────────────────────────────────────────────────────────── */

function step(key, who, text, client, sources, extra = {}) {
  return { key, who, step: text, client_step: client, sources: sources || [], blank: false, blank_label: null, status: "open", filled: null, ...extra };
}
function blank(key, who, label, client) {
  return { key, who, step: null, client_step: client, sources: [], blank: true, blank_label: label, status: "open", filled: null };
}

const nameOf = (bank) => (String(bank || "").trim() || "the bank");

/** Book lines a category can add (staff only, so they are ops steps). */
function bookFixLines(categoryKey, book, bank) {
  if (!book) return [];
  const out = [];
  const first = (book.lender_ids || [])[0] || "row";
  if (categoryKey === "bank_relationship" && (book.relationship_required || book.requires_account_opening)) {
    const field = book.requires_account_opening ? "requires_account_opening" : "relationship_required";
    out.push(step(`book:${categoryKey}`, "ops",
      `The lender book says ${nameOf(bank)} wants an existing account or relationship first (${field}: yes).`,
      "We check what this bank asks for before you apply again.",
      [src("book", `lenders ${first} ${field}`)]));
  }
  if (categoryKey === "business_too_new" && book.min_time_in_business) {
    out.push(step(`book:${categoryKey}`, "ops",
      `The lender book lists ${book.min_time_in_business.years} year(s) in business as ${nameOf(bank)}'s minimum.`,
      "We check how old this bank wants the business to be.",
      [src("book", `lenders ${book.min_time_in_business.lender_id} minimum_time_in_business_years`)]));
  }
  if (categoryKey === "income_or_revenue" && book.min_revenue) {
    out.push(step(`book:${categoryKey}`, "ops",
      `The lender book lists a minimum revenue of $${Math.round(book.min_revenue.dollars).toLocaleString("en-US")} for ${nameOf(bank)}.`,
      "We check how much revenue this bank wants to see.",
      [src("book", `lenders ${book.min_revenue.lender_id} minimum_revenue_threshold`)]));
  }
  return out;
}

/**
 * The ordered plan for one decline. Every non-blank step names its sources;
 * a blank is a line no source covers, left for the ops person.
 */
export function buildReconSteps({ looksLike, reasons, needsPerson, bank, hasText, phones, rm, book }) {
  const b = nameOf(bank);
  const steps = [];
  steps.push(step("read_letter", "agent", "Read the bank's letter and list the likely reasons.",
    "We read your letter and listed the likely reasons.", [S.ownerPaste, S.offer], { status: hasText ? "done" : "open" }));
  steps.push(step("get_letter", "client", "Send the bank's letter or email so the reasons can be read.",
    "Send us the bank's letter or email.", [S.offer], { status: hasText ? "done" : "open" }));

  const recon = looksLike === "decline" || looksLike === "needs_info";
  if (recon) {
    const numbers = [
      ...(phones.letter || []).map((p) => `Letter: ${p.number}`),
      ...(phones.book || []).map((p) => `Lender book: ${p.number} ("${p.said}")`)
    ];
    steps.push(step("find_recon_line", "agent",
      `Find ${b}'s reconsideration phone number. Use a number from the letter or the lender book if there is one; if not, look it up.`,
      "We find the bank's phone line for a second look.", [S.callingDeniedNumber],
      numbers.length ? { status: "done", filled: numbers.join(" · ") } : {}));
    steps.push(step("gather_facts", "agent",
      "Get the file facts ready for the call: who the client is, the business (name, address, start date, EIN) and when they applied. The identity details are on the client file — never paste them into notes.",
      "We get your file ready for the call.", [S.callingDeniedPrep]));
  }

  if (looksLike === "decline") {
    steps.push(step("call_recon", "ops",
      `Call ${b}'s reconsideration line. Ask about the recent application and what limit was approved. Stay friendly and patient.`,
      `We call ${b} and ask them to look at your application again.`, [S.callingDeniedOpen, S.appTipsRecon]));
    steps.push(step("ask_manual_review", "ops",
      "When they give the reason, say it does not match the file and ask if it can go to reconsideration — a manual review. Point to the strong parts of the report that are true for this file, like a long history, on-time payments, no negative items or low card use.",
      "We ask for a manual review and point to the strong parts of your file.", [S.callingDeniedPush]));
    if (rm) {
      steps.push(step("ask_rm", "ops",
        `A relationship manager is on file at ${b}. Ask them to push this application into reconsideration.`,
        `We ask our banker contact at ${b} to push for a second look.`, [S.rmAfterIntro, S.rmList]));
    }
  } else if (looksLike === "needs_info") {
    steps.push(step("call_pending", "ops",
      "Call the bank. Say you want to make sure everything is done to help the application, and ask whether they need anything verified. Offer to send it.",
      "We call the bank and ask what it needs to finish your application.", [S.callingPending]));
  }

  if (recon) {
    for (const r of reasons) {
      const c = categoryOf(r.category);
      if (!c) continue;
      if (c.talk) {
        steps.push(step(`say:${c.key}`, "ops", c.talk.text, `We answer the bank about: ${c.label.toLowerCase()}.`, c.talk.sources));
      } else {
        steps.push(blank(`say:${c.key}`, "ops",
          `What to say about "${c.label}" — no source in the repo has a line for this. Write it here.`,
          `We answer the bank about: ${c.label.toLowerCase()}.`));
      }
    }
  }

  if (looksLike === "decline") {
    steps.push(step("call_again", "ops",
      "If they will not reconsider, hang up and call again. Try at least 4 times — the playbook says 4 to 6.",
      "If they say no, we call again. We try at least 4 times.", [S.callingDeniedAgain]));
  }
  if (recon) {
    steps.push(step("log_call", "ops", "After each call, write a short summary and the next step on this decline.",
      "We write down what the bank said after each call.", [S.callingDeniedNotes]));
  }
  if (looksLike === "decline") {
    steps.push(step("second_no", "ops",
      "If the bank still says no after reconsideration, set the outcome to still declined. If there is a day to try again, set it as the re-apply date.",
      "If the bank still says no, we set a date to try again.", [S.fundingPlanDenied, S.ownerOutcome]));
  }

  if (recon) {
    for (const r of reasons) {
      const c = categoryOf(r.category);
      if (!c) continue;
      if (c.fix.length) {
        for (const f of c.fix) steps.push(step(`fix:${c.key}:${f.key}`, f.who, f.text, f.client, f.sources));
      } else {
        steps.push(blank(`fix:${c.key}`, "ops",
          `What to fix first for "${c.label}" — no source in the repo names a fix. Write it here.`,
          `We work out what to fix first for: ${c.label.toLowerCase()}.`));
      }
      for (const line of bookFixLines(c.key, book, bank)) steps.push(line);
    }
  }

  if (needsPerson) {
    steps.push(hasText
      ? step("read_unknown", "ops", "Read the parts of the letter we could not match, and pick the reason.",
        "A Fundhub person reads the parts we could not match.", [S.ownerUnknown])
      : step("read_unknown", "ops", "Read the bank's letter when it comes in, and pick the reason.",
        "A Fundhub person reads the bank's letter when it comes in.", [S.ownerUnknown]));
  }
  return steps;
}

const LOOKS_WORDS = Object.freeze({
  decline: "This reads like a decline.",
  approval: "This reads like an approval, not a decline.",
  counteroffer: "This reads like an approval for a lower amount.",
  needs_info: "This reads like the bank needs more from you before it decides.",
  unclear: "We could not tell what the bank decided."
});

function looksLikeOf(text, reasons) {
  const kind = classifyBankEmail("", text);
  if (kind === "DENIED") return "decline";
  if (kind === "APPROVED") return "approval";
  if (kind === "COUNTEROFFER") return "counteroffer";
  const onlyVerify = reasons.length > 0 && reasons.every((r) => r.category === "could_not_verify");
  if ((kind === "MISSING_DOCS" || kind === "ACTION_REQUIRED") && (reasons.length === 0 || onlyVerify)) return "needs_info";
  if (reasons.length > 0) return "decline";
  return "unclear";
}

function needsPersonWhy({ hasText, looksLike, reasons, unknown }) {
  if (!hasText) return "There is no letter text yet. A person will read the letter when it comes in.";
  if (looksLike === "approval") return "This reads like an approval, not a decline. A person will check it.";
  if (looksLike === "counteroffer") return "This reads like an approval for a lower amount. A person will decide what to do next.";
  if (reasons.length === 0) return "We could not find a reason in this text. A person will read it.";
  if (unknown.length) return "Part of the letter did not match a reason we know. A person will read it.";
  return null;
}

/**
 * Read a bank decline. PURE.
 *
 * @param {object} input
 * @param {string} input.text      the letter or email, as pasted
 * @param {string} [input.bank]    the bank's name, if known
 * @param {string} [input.product] the product applied for, if known
 * @param {object[]} [input.lenders] lender book rows for this bank (staff side only)
 * @param {boolean} [input.declined] the person says the bank said no (the "got a no"
 *        box, or staff recording a decline). A letter the reader cannot place is then
 *        read as a decline — the plan still asks for a second look, per "Application
 *        Tips": pursue reconsideration for every denial. A letter that reads like an
 *        approval or a request for papers still says so.
 * @returns the analysis — see docs/finance/decline-defense.md for the contract
 */
export function analyzeDecline({ text, bank = null, product = null, lenders = null, declined = false } = {}) {
  const raw = String(text ?? "").slice(0, MAX_LETTER_CHARS);
  const { text: clean, masked } = maskSensitive(raw);
  const hasText = clean.replace(/\s+/g, "").length >= MIN_LETTER_CHARS;
  const { reasons, unknown_parts } = hasText ? readReasons(clean) : { reasons: [], unknown_parts: [] };
  const read = hasText ? looksLikeOf(clean, reasons) : "unclear";
  const looksLike = declined === true && read === "unclear" ? "decline" : read;
  const needsPersonText = needsPersonWhy({ hasText, looksLike, reasons, unknown: unknown_parts });
  const needsPerson = needsPersonText !== null;
  const letterPhones = hasText ? findPhones(clean) : [];
  const book = bookFacts(Array.isArray(lenders) ? lenders : [], { bank, product });
  const rm = rmOnFile(bank);

  const recon_steps = buildReconSteps({
    looksLike, reasons, needsPerson, bank, hasText,
    phones: { letter: letterPhones, book: book.book_phones }, rm, book
  });

  const fix_first = [];
  for (const s of recon_steps) {
    if (!s.key.startsWith("fix:") && !s.key.startsWith("book:")) continue;
    const category = s.key.split(":")[1];
    fix_first.push(s.blank
      ? { category, who: s.who, blank: true, blank_label: s.blank_label }
      : { category, who: s.who, text: s.step, sources: s.sources });
  }

  const reapply = [];
  for (const r of reasons) {
    const c = categoryOf(r.category);
    for (const w of (c && c.when) || []) reapply.push({ category: c.key, text: w.text, sources: w.sources });
  }
  const isRecon = looksLike === "decline" || looksLike === "needs_info";
  const timing = {
    call: isRecon ? { text: "Call the bank after the decline comes in. Put the planned call date on the decline.", sources: [S.fundingPlanDenied] } : null,
    retries: looksLike === "decline" ? { text: "If they will not reconsider, call again — at least 4 times.", sources: [S.callingDeniedAgain] } : null,
    second_no: looksLike === "decline" ? { text: "If they say no a second time, mark it still declined.", sources: [S.fundingPlanDenied] } : null,
    letter: letterDeadlines(clean).map((t) => ({ text: t, sources: [S.letter] })),
    reapply,
    call_date: null,
    call_date_note: "Staff set the call date and any re-apply date on the decline. Nothing here picks a day."
  };

  return {
    ok: true,
    looks_like: looksLike,
    looks_like_words: LOOKS_WORDS[looksLike],
    bank: String(bank || "").trim() || null,
    product: String(product || "").trim() || null,
    reasons,
    unknown_parts,
    needs_person: needsPerson,
    needs_person_why: needsPersonText,
    recon_steps,
    timing,
    fix_first,
    letter_phones: letterPhones,
    bureaus_named: hasText ? bureausNamed(clean) : [],
    bank_facts: { ...book, rm_on_file: rm },
    text_chars: clean.length,
    masked
  };
}

/* ── words for people ────────────────────────────────────────────────────── */

export const OUTCOMES = Object.freeze(["open", "approved_on_recon", "still_declined", "reapply_later"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** YYYY-MM-DD from a `date` column, a string, or null. node-postgres builds a
 *  `date` as LOCAL midnight, so a Date is read back with the local getters —
 *  toISOString() would move it a day for any clock east of UTC. */
export function dayOf(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
}

/** "2026-12-01" → "Dec 1, 2026"; anything else → null. */
export function dayWords(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayOf(value) || "");
  if (!m) return null;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export function outcomeWords(outcome, reapplyOn = null) {
  if (outcome === "approved_on_recon") return "Approved after a second look";
  if (outcome === "still_declined") return "Still declined";
  if (outcome === "reapply_later") return dayWords(reapplyOn) ? `We will try again on ${dayWords(reapplyOn)}` : "We will try again later";
  return "Fundhub is working on it";
}

export function staffOutcomeWords(outcome) {
  return ({ open: "Open", approved_on_recon: "Approved on reconsideration", still_declined: "Still declined", reapply_later: "Re-apply later" })[outcome] || "Open";
}

/** A note for the next funding sequence. A note only — it never sets that date. */
export function nextSequenceNote(decline) {
  if (!decline) return null;
  const what = [decline.bank, decline.product].filter(Boolean).join(" · ") || "A bank";
  if (decline.outcome === "reapply_later" && dayWords(decline.reapply_on)) {
    return `${what}: re-apply on or after ${dayWords(decline.reapply_on)}.`;
  }
  if (decline.outcome === "still_declined") return `${what}: still declined after reconsideration.`;
  return null;
}

/* ── the tool contract for the money agent ───────────────────────────────── */

/* The FinanceOS money agent (src/finance/money-agent-ai.mjs, another unit) can
   register this as a tool. Pure: no side effects, no database, no network.
   Contract: docs/finance/decline-defense.md. */
export const TOOL = Object.freeze({
  name: "analyze_decline",
  description: "Read a bank decline letter or email the client pasted. Returns the likely reasons (each with the words from the letter and its source), the parts a person must read, the reconsideration steps (who does each: agent, ops or client; every step cites a source or is a blank), timing lines from sources, and what to fix first. Never invents a reason, script, window or amount.",
  input_schema: Object.freeze({
    type: "object",
    properties: {
      text: { type: "string", description: "The decline letter or email, as pasted." },
      bank: { type: "string", description: "The bank's name, if known." },
      product: { type: "string", description: "The product applied for, if known." },
      declined: { type: "boolean", description: "True when the client says the bank said no. A letter the reader cannot place is then treated as a decline." }
    },
    required: ["text"]
  }),
  run(input) {
    const out = analyzeDecline({
      text: input && input.text, bank: input && input.bank, product: input && input.product,
      declined: !!(input && input.declined)
    });
    // The tool answers the client's agent: no lender-book lines, ever.
    const { bank_facts, ...rest } = out;
    return { ...rest, recon_steps: rest.recon_steps.filter((s) => !s.key.startsWith("book:")), bank_facts: { rm_on_file: bank_facts.rm_on_file } };
  }
});
