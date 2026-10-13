// The hiring funnel survey — the questions on fundhub.ai/join/apply/, the check
// on every answer, and the rule for who goes straight to the calendar.
//
// OWNER-SET 2026-10-13 (Chris, in chat). He approved the funnel as:
//
//   VSL page -> application survey -> qualified applicants book on the sales
//   manager's calendar -> everyone else gets a thank-you.
//   COO books on Chris's calendar instead of the sales manager's.
//   LinkedIn URL is required for every role. A 90-second Loom is required.
//
// This file closes gap 1 in src/hiring/apply-public.mjs ("NO APPLICATION
// QUESTIONS EXIST"): the owner wrote them down, so they live here now, and the
// public door accepts answers to exactly these questions and nothing else.
//
// ══════════════════════════════════════════════════════════════════════════════
// "STRAIGHT TO THE CALENDAR" IS NOT A REJECTION.
//
// routeFor() decides one thing: does this applicant see the calendar right away,
// or the thank-you screen. Either way the application is saved, stays OPEN in
// the `applied` stage, and the sales manager (or Chris, for the COO seat) gets
// the same "New application" task from pipeline.mjs's apply(). The flags are
// saved on the application so the person reviewing it sees why the calendar
// was held back. Nothing here writes a hiring_decisions row or closes anything —
// 051_hiring.sql's rule that no candidate is rejected by software still holds.
// ══════════════════════════════════════════════════════════════════════════════
//
// PURE. No database, no clock, no environment. The page carries a copy of
// pageSurvey()'s output as JSON, and survey.test.mjs fails if the two drift.

export const SURVEY_VERSION = "join-2026-10-13";

/* The four seats this funnel hires for, in the order the page shows them.
   Each key is a hiring_roles.key. setter and closer are seeded by 051, csm by
   294, coo by 480. */
export const FUNNEL_ROLES = Object.freeze(["setter", "closer", "csm", "coo"]);

export const ROLE_LABELS = Object.freeze({
  setter: "Setter",
  closer: "Closer",
  csm: "Client Success Manager",
  coo: "Chief Operating Officer"
});

/* One line under each seat on the role picker. What the seat owns. */
export const ROLE_BLURBS = Object.freeze({
  setter: "Work inbound leads from our ads and affiliates fast, and book qualified calls for the closers.",
  closer: "Run the booked calls, find the right path for each person, and close.",
  csm: "Own each client after the sale, keep their steps moving, and get them ready to fund.",
  coo: "Run the operating rhythm: the team, the numbers, and the weekly meetings."
});

/* The Loom prompt. Setter, closer and CSM get the one Chris approved. The COO
   seat is not a sales seat, so it gets its own. */
export const LOOM_PROMPTS = Object.freeze({
  setter: "Using what you heard in the video, pitch a Fundhub funding consult in 60 seconds.",
  closer: "Using what you heard in the video, pitch a Fundhub funding consult in 60 seconds.",
  csm: "Using what you heard in the video, pitch a Fundhub funding consult in 60 seconds.",
  coo: "In 90 seconds, walk us through an operation you built and the numbers it moved."
});

const ALL = FUNNEL_ROLES;

/* Every question after contact details and before the Loom. `roles` is who
   sees it. Every question is required for the roles that see it, and every
   answer must be one of `opts`, word for word. Free text is the Loom's job. */
export const QUESTIONS = Object.freeze([
  { key: "years_in_role", roles: ALL,
    title: "How long have you done this kind of work?",
    opts: ["Less than 1 year", "1 to 2 years", "3 to 5 years", "5+ years"] },
  { key: "hours", roles: ALL,
    title: "What hours can you work?",
    hint: "Arizona time.",
    opts: ["Full-time, Monday to Friday", "Full-time, plus evenings or weekends", "Part-time only"] },
  { key: "start", roles: ALL,
    title: "When can you start?",
    opts: ["Right away", "Within 2 weeks", "Within 30 days", "More than 30 days out"] },

  { key: "closer_top_ticket", roles: ["closer"],
    title: "What's the highest-ticket offer you've closed?",
    opts: ["Under $3,000", "$3,000 to $5,000", "$5,000 to $10,000", "$10,000+"] },
  { key: "closer_close_rate", roles: ["closer"],
    title: "What was your close rate over the last 90 days?",
    opts: ["Under 15%", "15% to 25%", "25% to 35%", "35%+", "I don't track it"] },
  { key: "closer_cash_last_month", roles: ["closer"],
    title: "How much cash did you collect last month?",
    opts: ["Under $10,000", "$10,000 to $25,000", "$25,000 to $50,000", "$50,000 to $100,000", "$100,000+"] },

  { key: "setter_dials", roles: ["setter"],
    title: "How many dials do you make in a day?",
    opts: ["Under 50", "50 to 100", "100 to 200", "200+"] },
  { key: "setter_set_rate", roles: ["setter"],
    title: "What's your set rate?",
    hint: "Of the leads you talk to, how many book a call.",
    opts: ["Under 10%", "10% to 20%", "20% to 30%", "30%+", "I don't track it"] },
  { key: "setter_show_rate", roles: ["setter"],
    title: "What's your show rate?",
    hint: "Of the calls you book, how many show up.",
    opts: ["Under 50%", "50% to 70%", "70% to 85%", "85%+", "I don't track it"] },
  { key: "setter_dm", roles: ["setter"],
    title: "Have you set appointments over DMs?",
    opts: ["Yes", "No"] },

  { key: "csm_onboarding_retention", roles: ["csm"],
    title: "Have you run client onboarding or retention?",
    opts: ["Yes, both", "Onboarding only", "Retention only", "Not yet"] },
  { key: "csm_credit_finance", roles: ["csm"],
    title: "Do you have a credit or finance background?",
    opts: ["Yes, credit", "Yes, finance or lending", "Both", "No"] },

  { key: "coo_team_size", roles: ["coo"],
    title: "What's the biggest team you've managed?",
    opts: ["1 to 5 people", "6 to 15 people", "16 to 50 people", "50+ people"] },
  { key: "coo_company_size", roles: ["coo"],
    title: "What's the biggest company you've run operations for?",
    hint: "Monthly revenue.",
    opts: ["Under $100,000", "$100,000 to $500,000", "$500,000 to $1,000,000", "$1,000,000+"] },
  { key: "coo_kpi_cadence", roles: ["coo"],
    title: "Have you run a weekly KPI meeting with a scorecard?",
    opts: ["Yes, every week", "Sometimes", "Not yet"] }
]);

/* WHY THE CALENDAR IS HELD BACK. Owner-set 2026-10-13: "can't cover required
   hours" and "a closer who has never closed an offer over $3,000". The missing
   Loom is not here because the form will not submit without one.

   Required hours read as full-time: "Part-time only" is the one answer that
   cannot cover them. */
export const REVIEW_RULES = Object.freeze([
  { id: "part_time_only",
    label: "Can only work part-time",
    applies: (roleKey, a) => a.hours === "Part-time only" },
  { id: "closer_under_3000",
    label: "Has not closed an offer over $3,000",
    applies: (roleKey, a) => roleKey === "closer" && a.closer_top_ticket === "Under $3,000" }
]);

export function questionsFor(roleKey) {
  return QUESTIONS.filter((q) => q.roles.includes(roleKey));
}

/* parseSurveyAnswers(roleKey, raw) → { ok:true, answers } | { ok:false, error }

   Strict on purpose, because this is a stranger's JSON headed for an automated
   employment decision tool's tables:
     - a key that is not a question for this seat is refused, not dropped
     - a missing answer is refused
     - an answer that is not one of the options, word for word, is refused
   So the stored answer set is always exactly the questions this seat was asked,
   with exactly the words on the buttons. */
export function parseSurveyAnswers(roleKey, raw) {
  if (!FUNNEL_ROLES.includes(roleKey)) return { ok: false, error: "role_required" };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "survey_incomplete" };
  }
  const asked = questionsFor(roleKey);
  const askedKeys = new Set(asked.map((q) => q.key));
  for (const k of Object.keys(raw)) {
    if (!askedKeys.has(k)) return { ok: false, error: "survey_answer_unknown" };
  }
  const answers = {};
  for (const q of asked) {
    const v = raw[q.key];
    if (typeof v !== "string" || !q.opts.includes(v)) {
      return { ok: false, error: "survey_incomplete" };
    }
    answers[q.key] = v;
  }
  return { ok: true, answers };
}

/* routeFor(roleKey, answers) → { next: "book" | "review", flags: [rule ids] } */
export function routeFor(roleKey, answers = {}) {
  const flags = REVIEW_RULES
    .filter((r) => r.applies(roleKey, answers))
    .map((r) => r.id);
  return { next: flags.length ? "review" : "book", flags };
}

/* A Loom share link, and nothing else. Stored as https whatever was pasted, same
   as the LinkedIn link in apply-public.mjs. Returns null when it is not a Loom
   link, "" when blank. */
export const LOOM_URL_MAX = 300;
export function loomUrl(raw) {
  if (raw == null) return "";
  const v = String(raw).replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (!v) return "";
  if (v.length > LOOM_URL_MAX) return null;
  let url;
  try { url = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (host !== "loom.com" && !host.endsWith(".loom.com")) return null;
  if (url.pathname === "/" || url.pathname === "") return null;
  url.protocol = "https:";
  const out = url.toString();
  return out.length > LOOM_URL_MAX ? null : out;
}

/* What the page needs to draw the survey. The page holds a copy of this as JSON
   (script#fh-join-survey in public/join/apply/index.html); survey.test.mjs
   fails if the copy and this function disagree. The review rules stay on the
   server: the page learns the route from the reply, not from a copy of the
   rules. */
export function pageSurvey() {
  return {
    version: SURVEY_VERSION,
    roles: FUNNEL_ROLES.map((key) => ({
      key,
      label: ROLE_LABELS[key],
      blurb: ROLE_BLURBS[key],
      loomPrompt: LOOM_PROMPTS[key]
    })),
    questions: QUESTIONS.map((q) => {
      const out = { key: q.key, roles: [...q.roles], title: q.title };
      if (q.hint) out.hint = q.hint;
      out.opts = [...q.opts];
      return out;
    })
  };
}

export default {
  SURVEY_VERSION, FUNNEL_ROLES, ROLE_LABELS, ROLE_BLURBS, LOOM_PROMPTS, QUESTIONS,
  REVIEW_RULES, questionsFor, parseSurveyAnswers, routeFor, loomUrl, pageSurvey
};
