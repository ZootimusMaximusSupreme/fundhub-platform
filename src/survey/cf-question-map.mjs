// ClickFunnels survey question map — single place for payload keys.
// Question titles/options: marketing/landing-pages/clickfunnels/cf-survey-ground-truth.md
// Attribute keys: marketing/landing-pages/clickfunnels/OWNER-CF-SETUP-CHECKLIST.md (owner mapping in CF)
//
// payloadKey = Contact Attribute key Chris is mapping in CF (cf_svy_*).
// Change ONLY payloadKey here if a CF attribute name differs.

/** @typedef {'single'|'multi'|'contact'} QuestionType */
/**
 * @typedef {object} CfSurveyQuestion
 * @property {string} id stable internal id
 * @property {string} title question title verbatim from CF
 * @property {string} payloadKey CF Contact Attribute / answer key (cf_svy_*)
 * @property {QuestionType} type
 * @property {string[]} [options] verbatim option labels
 * @property {boolean} [otherEnabled] CF "Other" enabled
 * @property {'business'|'personal'|null} [branch]
 */

/** Branch sentinel — exact CF option that takes the personal-funding path. */
export const PERSONAL_FUNDING_OPTION = "No, personal funding only";

/** @type {CfSurveyQuestion[]} CF order (contact first). */
export const CF_SURVEY_QUESTIONS = Object.freeze([
  {
    id: "contact",
    title: "Let's Start With Your Info",
    payloadKey: "contact",
    type: "contact",
  },
  {
    id: "funding_target_amount",
    title: "Set Your Target Amount",
    payloadKey: "cf_svy_funding_target_amount",
    type: "single",
    options: [
      "Less than $50k",
      "$50k - $100k",
      "$100k - $200k",
      "$200k - $400k",
      "$400k+",
    ],
  },
  {
    id: "planned_use",
    title: "Planned Use",
    payloadKey: "cf_svy_planned_use",
    type: "single",
    otherEnabled: true,
    options: [
      "Growth (marketing, inventory, hiring)",
      "Equipment or buildout",
      "Debt consolidation",
      "Payroll or rent",
      "Covering a shortfall right now",
      "Not sure yet",
    ],
  },
  {
    id: "money_change_now",
    title: "What Would This Money Change Right Now?",
    payloadKey: "cf_svy_money_change_now",
    type: "multi",
    options: [
      "Peace of mind (stop stressing about cash)",
      "Grow faster (more customers / more reach)",
      "Pay off pressure (wipe out high-interest debt)",
      "Stability (cover bills / buffer slow weeks)",
      "Fresh start (new business / startup launch)",
    ],
  },
  {
    id: "current_score",
    title: "Your Current Score",
    payloadKey: "cf_svy_self_reported_fico",
    type: "single",
    // Owner-set 2026-10-30, live 2026-10-31. Answers saved before then use the
    // old ranges; src/config/survey-qualification.mjs still reads them.
    options: ["500-619", "620-699", "700-759", "760-850", "Not sure"],
  },
  {
    id: "has_business",
    title: "Do You Have a Business?",
    payloadKey: "cf_svy_has_business",
    type: "single",
    options: [
      "Yes, less than 6 months old",
      "Yes, 6-12 months",
      "Yes, 1-2 years",
      "Yes, 2-5 years",
      "Yes, 5+ years",
      PERSONAL_FUNDING_OPTION,
    ],
  },
  {
    id: "annual_business_revenue",
    title: "Annual Business Revenue",
    payloadKey: "cf_svy_business_revenue",
    type: "single",
    branch: "business",
    options: [
      "Under $100k",
      "$100k - $249k",
      "$250k - $499k",
      "$500k - $999k",
      "$1M+",
    ],
  },
  {
    id: "verify_revenue",
    title: "Can You Verify Revenue?",
    payloadKey: "cf_svy_revenue_verifiable",
    type: "single",
    branch: "business",
    options: [
      "Yes, bank statements",
      "Yes, tax returns",
      "Yes, both",
      "Not right now",
    ],
  },
  {
    id: "annual_personal_income",
    title: "Annual Personal Income",
    payloadKey: "cf_svy_annual_income_range",
    type: "single",
    branch: "personal",
    options: [
      "Less than $50k",
      "$50k-$99k",
      "$100k-$199k",
      "$200k-$499k",
      "$500k+",
    ],
  },
  {
    id: "verify_income",
    title: "Can You Verify Income?",
    payloadKey: "cf_svy_income_verifiable",
    type: "single",
    branch: "personal",
    options: [
      "Yes, pay stubs",
      "Yes, W-2 or tax returns",
      "Yes, both",
      "Not right now",
    ],
  },
  {
    id: "available_capital",
    title: "Available Capital",
    payloadKey: "cf_svy_available_capital",
    type: "single",
    options: [
      "Less than $1k",
      "$1k - $5k",
      "$5k - $25k",
      "$25k - $100k",
      "$100k+",
    ],
  },
]);

/** The last question on every path (business and personal). A survey is
    finished only when this one is answered. */
export const SURVEY_FINAL_KEY = "cf_svy_available_capital";

/** True when an answers object (keyed by payloadKey) holds the last answer. */
export function surveyIsComplete(answers) {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return false;
  const v = answers[SURVEY_FINAL_KEY];
  if (Array.isArray(v)) return v.some((x) => x != null && String(x).trim() !== "");
  return v != null && String(v).trim() !== "";
}

/**
 * Homepage order: same questions/options/branch, contact LAST.
 * @returns {CfSurveyQuestion[]}
 */
export function homepageSurveyQuestions() {
  const contact = CF_SURVEY_QUESTIONS.find((q) => q.id === "contact");
  const rest = CF_SURVEY_QUESTIONS.filter((q) => q.id !== "contact");
  return [...rest, contact];
}

/**
 * Visible steps given answers keyed by question `id`.
 * @param {Record<string, unknown>} answersById
 * @param {{ contactLast?: boolean }} [opts]
 */
export function visibleQuestions(answersById = {}, opts = {}) {
  const list = opts.contactLast ? homepageSurveyQuestions() : CF_SURVEY_QUESTIONS;
  const biz = answersById.has_business;
  const onPersonal = biz === PERSONAL_FUNDING_OPTION;
  const onBusiness = typeof biz === "string" && biz.startsWith("Yes");

  return list.filter((q) => {
    if (!q.branch) return true;
    if (q.branch === "business") return onBusiness;
    if (q.branch === "personal") return onPersonal;
    return true;
  });
}

/** Lookup by stable id. */
export function questionById(id) {
  return CF_SURVEY_QUESTIONS.find((q) => q.id === id) || null;
}

/**
 * Build answer object for storage/emit: keys = payloadKey (cf_svy_*).
 * @param {Record<string, unknown>} answersById
 */
export function answersByPayloadKey(answersById = {}) {
  const out = {};
  for (const q of CF_SURVEY_QUESTIONS) {
    if (q.type === "contact") continue;
    if (!Object.prototype.hasOwnProperty.call(answersById, q.id)) continue;
    const v = answersById[q.id];
    if (v == null || v === "") continue;
    out[q.payloadKey] = v;
  }
  return out;
}

const CURRENT_SCORE = CF_SURVEY_QUESTIONS.find((q) => q.id === "current_score");
const FICO_BANDS = new Set(CURRENT_SCORE?.options || []);

function looksLikeFicoBand(s) {
  return FICO_BANDS.has(s) || /^\d{3}-\d{3}$/.test(s) || /^\d{3}\+$/.test(s) || /^not sure$/i.test(s);
}

function isCfOptionId(v) {
  if (typeof v === "number") return v >= 10000;
  return typeof v === "string" && /^\d{5,}$/.test(v.trim());
}

/* The words they picked on the survey. Never a ClickFunnels option id. */
export function surveyFicoBand(cf = {}) {
  const label = cf && cf.cf_svy_self_reported_fico_label;
  if (label != null && String(label).trim()) {
    const s = String(label).trim();
    if (looksLikeFicoBand(s)) return s;
  }
  const raw = cf && cf.cf_svy_self_reported_fico;
  if (raw == null || raw === "") return null;
  if (isCfOptionId(raw)) return null;
  const s = String(raw).trim();
  return looksLikeFicoBand(s) ? s : null;
}
