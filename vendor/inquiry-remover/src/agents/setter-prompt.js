"use strict";

/**
 * setter-prompt.js — AI Outbound Setter Prompt (Bland AI) — AI-SET-01
 *
 * The setter calls within a few seconds of calendar booking. It confirms the
 * Strategy Session and light-sets from application / survey answers only.
 *
 * Owner law 2026-08-15: no UnderwriteIQ, no pre-approval $, no pulled credit.
 * Soft-pull happens live on the Advisor call. Survey fields match
 * public/js/homepage-survey.js → cf_svy_*.
 *
 * Dynamic variables (request_data / {{key}} in task):
 *   {{first_name}} {{appointment_time}} {{closer_name}}
 *   {{funding_target_amount}} {{planned_use}} {{money_change_now}}
 *   {{self_reported_fico}} {{has_business}} {{business_revenue}}
 *   {{revenue_verifiable}} {{annual_income_range}} {{income_verifiable}}
 *   {{available_capital}}
 */

const SETTER_TASK = `You are Chris, an AI Setter for FundHub.

TRIGGER: Lead just booked a Strategy Session. Call within a few seconds.
JOB: Confirm the appointment, light set from their application answers, get them to show up at a computer.
YOU DO NOT HAVE: a credit pull, UnderwriteIQ results, pre-approval amounts, bureau data, or letter packs.

DATA YOU HAVE (application / survey only — skip any empty field, never invent):
- Name: {{first_name}}
- Appointment: {{appointment_time}}
- Senior Advisor: {{closer_name}}
- Funding target: {{funding_target_amount}}
- Planned use: {{planned_use}}
- What this money would change: {{money_change_now}}
- Self-reported credit band: {{self_reported_fico}}
- Business?: {{has_business}}
- Business revenue (if business): {{business_revenue}}
- Revenue verifiable (if business): {{revenue_verifiable}}
- Personal income (if personal): {{annual_income_range}}
- Income verifiable (if personal): {{income_verifiable}}
- Available capital: {{available_capital}}

RULES:
- Do not sell the program.
- Do not discuss the $3,000 deposit or pricing details.
- Do not say they are pre-approved or quote an approval amount.
- Do not claim you reviewed their credit file — that happens live on the Advisor call.
- Self-reported credit band is only what they typed; treat it as rough, not a pull.
- Keep under 5 minutes.
- Warm, casual, human. Use filler words occasionally (e.g., "um," "gotcha," "makes sense").

CALL FLOW:

1. OPEN / CONFIRM
- "Hey, is this {{first_name}}?"
- Wait
- "Hey {{first_name}}, it's Chris with FundHub. You just booked your Strategy Session for {{appointment_time}} — calling real quick to make sure that time still works."
- If NO → reschedule → end
- If YES → continue

2. FRAME (credit pulled ON the call)
- "Quick heads up: on the call, {{closer_name}} pulls your credit live and maps your funding options from what's actually on your report. We haven't run a pull yet — that happens with you on the line."

3. LIGHT SET (survey only — pick 2–3; don't interrogate every field)
- Confirm target + use: "From your application you're looking for about {{funding_target_amount}} for {{planned_use}} — still right?"
- Confirm why: "You said this would help with {{money_change_now}} — still the main thing?"
- Optional business/personal one-liner if present: "And you've got {{has_business}}" / revenue or income band if useful for the Advisor brief — one sentence max.
- Do NOT deep-dive credit band unless they bring it up. If they do: "Got it — that's what you put down. The Advisor will verify live on the call."

4. SHOW-UP CLOSE
- "{{closer_name}} will share screen, so be at a computer in a quiet spot."
- "Anything that would stop you from making {{appointment_time}}?"
- "Awesome — see you then."

GUARDRAILS:
Q: Did you already pull my credit?
A: Not yet. That happens live on the Strategy Session with {{closer_name}}.

Q: How much am I approved for / what's my pre-approval?
A: We don't know until the Advisor pulls and reads your file on the call. That's what the session is for.

Q: How much does it cost?
A: {{closer_name}} covers pricing on the call — I'm just confirming you're set to show up.

Q: Is this a scam?
A: Fair question. We've helped a lot of founders get funded. The Advisor walks you through how it works on your call.

Q: Can I just do this myself?
A: You could apply bank by bank. The Advisor's job is knowing which lenders to hit, in what order, so you don't waste hard pulls.

VOICEMAIL SCRIPT (if answering machine detected):
"Hey {{first_name}}, it's Chris with FundHub. You booked a Strategy Session for {{appointment_time}}. Calling to confirm you're set. On the call your Advisor pulls credit live and maps your funding path. Text or call back if you need to move the time."`;

/**
 * Build the Bland AI call configuration for a setter call (AI-SET-01).
 *
 * @param {Object} requestData
 * @param {string} requestData.phone_number
 * @param {string} [requestData.ghl_contact_id]
 * @param {string} requestData.first_name
 * @param {string} requestData.appointment_time
 * @param {string} [requestData.closer_name]
 * @param {string} [requestData.funding_target_amount] — cf_svy_funding_target_amount
 * @param {string} [requestData.planned_use] — cf_svy_planned_use
 * @param {string|string[]} [requestData.money_change_now] — cf_svy_money_change_now
 * @param {string} [requestData.self_reported_fico] — cf_svy_self_reported_fico (band only)
 * @param {string} [requestData.has_business] — cf_svy_has_business
 * @param {string} [requestData.business_revenue] — cf_svy_business_revenue
 * @param {string} [requestData.revenue_verifiable] — cf_svy_revenue_verifiable
 * @param {string} [requestData.annual_income_range] — cf_svy_annual_income_range
 * @param {string} [requestData.income_verifiable] — cf_svy_income_verifiable
 * @param {string} [requestData.available_capital] — cf_svy_available_capital
 * @param {Object} [overrides]
 * @returns {Object} Config ready to pass to bland.createCall()
 */
function buildSetterCallConfig(requestData, overrides = {}) {
  const {
    phone_number,
    ghl_contact_id,
    first_name,
    appointment_time,
    closer_name,
    funding_target_amount,
    planned_use,
    money_change_now,
    self_reported_fico,
    has_business,
    business_revenue,
    revenue_verifiable,
    annual_income_range,
    income_verifiable,
    available_capital,
    ...extraData
  } = requestData;

  const moneyChange =
    Array.isArray(money_change_now) ? money_change_now.join("; ") : money_change_now;

  const survey = {
    funding_target_amount: funding_target_amount || "",
    planned_use: planned_use || "",
    money_change_now: moneyChange || "",
    self_reported_fico: self_reported_fico || "",
    has_business: has_business || "",
    business_revenue: business_revenue || "",
    revenue_verifiable: revenue_verifiable || "",
    annual_income_range: annual_income_range || "",
    income_verifiable: income_verifiable || "",
    available_capital: available_capital || ""
  };

  const config = {
    phoneNumber: phone_number,
    task: SETTER_TASK,
    voice: process.env.SETTER_VOICE || "mason",
    firstSentence: `Hey, is this ${first_name || "{{first_name}}"}?`,
    maxDuration: 15,
    amd: true,
    waitForGreeting: true,
    record: true,
    requestData: {
      ghl_contact_id,
      first_name,
      appointment_time,
      closer_name,
      ...survey,
      ...extraData
    },
    metadata: {
      ghl_contact_id,
      first_name,
      appointment_time,
      closer_name,
      call_type: "ai-set-01-setter"
    },
    webhookUrl: require("../lib/bland-client").resolveBlandWebhookUrl(),
    ...overrides
  };

  return config;
}

/**
 * Post-call analysis questions for the setter agent.
 */
const SETTER_ANALYSIS_QUESTIONS = [
  "Did the lead answer the phone, or did the call go to voicemail?",
  "Did the lead confirm their appointment time during the call?",
  "Did the lead ask to reschedule? If so, what time did they request?",
  "Did the lead confirm their funding target and planned use from the application?",
  "What did the lead say about what the money would change for them?",
  "Did the lead confirm they will be at a computer for the appointment?",
  "Did the lead ask about cost or pricing?",
  "Did the lead ask if credit was already pulled or ask for a pre-approval amount?",
  "Did the lead raise any legitimacy or skepticism concerns?",
  "What was the call disposition? (confirmed, reschedule_requested, not_interested, voicemail, no_answer, wrong_number)",
  "Brief summary of the conversation."
];

module.exports = {
  SETTER_TASK,
  buildSetterCallConfig,
  SETTER_ANALYSIS_QUESTIONS
};
