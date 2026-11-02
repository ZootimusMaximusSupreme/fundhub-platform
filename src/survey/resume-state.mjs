// What a lead has already answered on /apply, read back from the saved client
// record, and which question comes next. Read only. The door behind the resume
// link (api/public/survey-resume.mjs) is the one caller.
//
// ANSWERS ARE THE WORDS THE PERSON PICKED, NEVER A CLICKFUNNELS OPTION ID.
// ClickFunnels sends every answer twice, an option id on `cf_svy_<key>` and the
// words on `cf_svy_<key>_label` (single) or `_labels` (multi, a JSON list that
// is sometimes encoded again inside a string). The /apply page saves the words on
// the key itself. This reads the words first, the same order surveySummary
// (src/setter/dashboard.mjs) uses, and drops anything that is only an id. A
// question whose only saved value is an id counts as not answered, so the page
// asks it again instead of showing a number or skipping past it.

import { CF_SURVEY_QUESTIONS, PERSONAL_FUNDING_OPTION, visibleQuestions } from "./cf-question-map.mjs";

const QUESTIONS = CF_SURVEY_QUESTIONS.filter((q) => q.type !== "contact");

// The same test as isCfOptionId in cf-question-map.mjs (that one is not exported).
const CF_OPTION_ID = /^\d{5,}$/;
const MAX_WORD = 200;
const MAX_WORDS = 10;

/* One saved value as a flat list of words. Handles a plain string, a list, a
   JSON list inside a string, and a JSON list inside a JSON list (the setter's
   test fixture has one). Three levels deep is as far as ClickFunnels goes. */
function unpack(part, depth = 0) {
  if (part == null) return [];
  if (Array.isArray(part)) return part.flatMap((item) => unpack(item, depth + 1));
  if (typeof part === "number" || typeof part === "boolean") return [String(part)];
  if (typeof part !== "string") return [];
  const text = part.trim();
  if (depth < 3 && text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.flatMap((item) => unpack(item, depth + 1));
    } catch { /* a plain answer that happens to start with a bracket */ }
  }
  return text ? [text.slice(0, MAX_WORD)] : [];
}

function wordsFor(cf, key) {
  for (const source of [cf[`${key}_label`], cf[`${key}_labels`], cf[key]]) {
    const words = unpack(source).filter((w) => !CF_OPTION_ID.test(w));
    if (words.length) return words;
  }
  return [];
}

/* The business question picks which of two question pairs comes next (visibleQuestions
   in cf-question-map.mjs). An answer that picks neither is not an answer: ask again. */
const picksABranch = (word) => word === PERSONAL_FUNDING_OPTION || word.startsWith("Yes");

/**
 * savedSurveyAnswers — { cf_svy_<key>: words } for every question the person has
 * answered. A single question maps to one string, the multi question to a list.
 */
export function savedSurveyAnswers(customFields) {
  const cf = customFields && typeof customFields === "object" && !Array.isArray(customFields) ? customFields : {};
  const out = {};
  for (const q of QUESTIONS) {
    const words = wordsFor(cf, q.payloadKey);
    if (!words.length) continue;
    if (q.id === "has_business" && !picksABranch(words[0])) continue;
    out[q.payloadKey] = q.type === "multi" ? words.slice(0, MAX_WORDS) : words[0];
  }
  return out;
}

/**
 * nextSurveyKey — the payloadKey of the first question on this person's path
 * that has no answer, or null when every question on the path is answered. The
 * contact screen is not a question here: a person with a saved record has done it.
 *
 * Every question before the one returned has an entry in `answers`, so a page
 * that fills in `answers` and jumps to this key never skips an empty one.
 */
export function nextSurveyKey(answers = {}) {
  const answered = (key) => {
    const v = answers[key];
    return Array.isArray(v) ? v.length > 0 : v != null && String(v).trim() !== "";
  };
  for (const q of visibleQuestions({ has_business: answers.cf_svy_has_business ?? null })) {
    if (q.type === "contact") continue;
    if (!answered(q.payloadKey)) return q.payloadKey;
  }
  return null;
}

/* ── Words for where they stopped (owner-set 2026-10-31) ───────────────────────────────────────
   The come-back messages say it the way a person would: "you stopped at the credit score
   question, 5 more taps". These are those words, one per question, picked by the owner. The
   copy that uses them lives in the S-02 templates ({{survey_stopped_at}}, {{survey_taps_left}}). */
const STOPPED_AT = Object.freeze({
  cf_svy_funding_target_amount: "the first question",
  cf_svy_planned_use: "the question about what the money is for",
  cf_svy_money_change_now: "the question about what the money would change",
  cf_svy_self_reported_fico: "the credit score question",
  cf_svy_has_business: "the question about your business",
  cf_svy_business_revenue: "the revenue question",
  cf_svy_revenue_verifiable: "the question about showing your revenue",
  cf_svy_annual_income_range: "the income question",
  cf_svy_income_verifiable: "the question about showing your income",
  cf_svy_available_capital: "the last question"
});

// Both ways of answering the business question lead to the same number of questions.
const BRANCH_SIZE = Math.max(
  QUESTIONS.filter((q) => q.branch === "business").length,
  QUESTIONS.filter((q) => q.branch === "personal").length
);

/**
 * surveyProgressWords — where this person stopped, in words, from their saved record
 * (`clients.custom_fields`).
 *
 *   stoppedAt  the first question on their path with no answer: "the credit score question".
 *              "the last question" when every question is answered.
 *   tapsLeft   how many questions are still empty, as "1 more tap" or "N more taps". It is
 *              never "0 more taps": with nothing left it is null.
 *   left       the same count as a number. 0 means they have answered everything, and a
 *              come-back message has nothing to come back to.
 *
 * The count is the path's own, not a number written down here: 8 questions after the contact
 * screen on both ways of answering. Until the business question is answered the path does not
 * yet show its two follow-ups, but both ways have two, so they are counted from the start.
 */
export function surveyProgressWords(customFields) {
  const answers = savedSurveyAnswers(customFields);
  const next = nextSurveyKey(answers);
  const answered = (key) => Array.isArray(answers[key]) ? answers[key].length > 0 : answers[key] != null;
  const path = visibleQuestions({ has_business: answers.cf_svy_has_business ?? null }).filter((q) => q.type !== "contact");
  const branchKnown = path.some((q) => q.branch);
  const left = path.filter((q) => !answered(q.payloadKey)).length + (branchKnown ? 0 : BRANCH_SIZE);
  return {
    stoppedAt: next ? STOPPED_AT[next] : STOPPED_AT.cf_svy_available_capital,
    tapsLeft: left === 0 ? null : left === 1 ? "1 more tap" : `${left} more taps`,
    left
  };
}
