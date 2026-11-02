"use strict";

/**
 * setter-outbound-cadence.js — Outbound No-Answer/Voicemail Cadence
 *
 * Called by setter-webhook when a call outcome is no_answer or voicemail.
 *
 * What this module does synchronously (returns immediately):
 *   1. Double-dial via Bland AI — fires another outbound call right now.
 *   2. Start SMS cadence via GHL — fires one webhook to GHL which internally
 *      manages the timing for all three SMS messages:
 *        Min 7  → SMS #1 (Value-First)
 *        Hour 4 → SMS #2 (Follow-Up)
 *        Day 2  → SMS #3 (Break-Up)
 *
 * Vercel is serverless — we cannot schedule timed tasks ourselves. GHL workflows
 * with wait steps handle the SMS timing internally after we fire the single
 * trigger webhook.
 *
 * Environment variable required for the GHL SMS cadence workflow:
 *   GHL_SETTER_CADENCE_WEBHOOK_URL — trigger URL for the GHL no-answer cadence workflow
 *   (Set in Vercel env vars once the GHL workflow AI-SET-03 is published.)
 *
 * SMS Templates (from SOP + addendum):
 *   SMS #1 (Min 7):
 *     "Hey {{first_name}}, it's Chris from FundHub! I just tried giving you a call
 *      about your Strategy Session. Looking at your file — you've been pre-approved
 *      for ${{prequal_amount}} in funding. Just want to make sure your appointment
 *      on {{appointment_time}} still works? 💰"
 *
 *   SMS #2 (Hour 4):
 *     "Hey {{first_name}}, just checking in — we have your UnderwriteIQ results
 *      ready and your Senior Advisor is prepped for your call. Want to confirm
 *      your spot?"
 *
 *   SMS #3 (Day 2):
 *     "Hey {{first_name}}, I noticed we haven't been able to connect. Your
 *      pre-approval for ${{prequal_amount}} is still active but I can't hold
 *      your advisor's slot much longer. If you're still interested, just reply
 *      YES and I'll get you rebooked. — Chris"
 *
 * NOTE: The GHL workflow (AI-SET-03) must use these SMS templates. The merge tags
 * are passed as payload fields so GHL can render them inline.
 */

const bland = require("./bland-client");
const { buildSetterCallConfig } = require("../agents/setter-prompt");

// Voicemail drop message — from setter-prompt VOICEMAIL SCRIPT section
const VOICEMAIL_MESSAGE =
  "Hey {{first_name}}, it's Chris over at FundHub. I was just reviewing your " +
  "UnderwriteIQ file and saw your pre-approval for ${{prequal_amount}}. I saw " +
  "you booked a Strategy Session and wanted to give you a quick call to make " +
  "sure you're all set. Give me a call back or shoot me a text when you get a " +
  "chance. Talk soon!";

/**
 * Trigger the full no-answer outbound cadence for a lead.
 *
 * @param {Object} opts
 * @param {string} opts.contactId          - GHL contact ID
 * @param {string} opts.firstName          - Lead first name
 * @param {string} opts.phone              - Lead phone (E.164)
 * @param {string} [opts.prequalAmount]    - Pre-approval amount (string, e.g. "125000")
 * @param {string} [opts.appointmentTime]  - Booked appointment time (ISO or display string)
 * @param {string} [opts.primaryFico]      - Lead FICO score
 * @param {string} [opts.closerName]       - Assigned closer/advisor name
 * @param {string} [opts.analyzerRecommendation] - "funding" | "repair" | "disqualified"
 * @param {string} [opts.originalCallId]   - The call_id of the no-answer call (for logging)
 * @param {"no_answer"|"voicemail"} [opts.triggerReason] - Why cadence was triggered
 *
 * @returns {Promise<{
 *   ok: boolean,
 *   doubleDial: { ok: boolean, call_id?: string, error?: string },
 *   smsCadence: { ok: boolean, error?: string }
 * }>}
 */
async function triggerOutboundCadence({
  contactId,
  firstName,
  phone,
  prequalAmount = "",
  appointmentTime = "",
  primaryFico = "",
  closerName = "",
  analyzerRecommendation = "",
  originalCallId = null,
  triggerReason = "no_answer"
}) {
  console.log(
    `[setter-cadence] Starting outbound cadence for contact=${contactId} ` +
      `reason=${triggerReason} phone=${phone}`
  );

  const [doubleDial, smsCadence] = await Promise.allSettled([
    fireDoubleDial({ contactId, firstName, phone, prequalAmount, appointmentTime, primaryFico, closerName, analyzerRecommendation, originalCallId, triggerReason }),
    fireSmsCadence({ contactId, firstName, prequalAmount, appointmentTime, closerName, triggerReason })
  ]);

  const ddResult = doubleDial.status === "fulfilled"
    ? doubleDial.value
    : { ok: false, error: doubleDial.reason?.message || "unknown error" };

  const smsResult = smsCadence.status === "fulfilled"
    ? smsCadence.value
    : { ok: false, error: smsCadence.reason?.message || "unknown error" };

  const allOk = ddResult.ok && smsResult.ok;

  console.log(
    `[setter-cadence] Cadence complete for contact=${contactId}: ` +
      `doubleDial=${ddResult.ok ? "ok" : "failed"} ` +
      `smsCadence=${smsResult.ok ? "ok" : "failed"}`
  );

  return {
    ok: allOk,
    doubleDial: ddResult,
    smsCadence: smsResult
  };
}

// ---------------------------------------------------------------------------
// Step 1: Double-dial via Bland AI
// ---------------------------------------------------------------------------

/**
 * Fire a second outbound call (the double-dial).
 *
 * The call uses the same setter prompt as the original. If the outcome was
 * voicemail on the first try, AMD will again detect the voicemail and Bland AI
 * will drop the voicemail message automatically (amd: true).
 *
 * Non-fatal: errors are caught, logged, and returned as { ok: false, error }.
 */
async function fireDoubleDial({
  contactId,
  firstName,
  phone,
  prequalAmount,
  appointmentTime,
  primaryFico,
  closerName,
  analyzerRecommendation,
  originalCallId,
  triggerReason
}) {
  if (!process.env.BLAND_API_KEY) {
    console.warn("[setter-cadence] BLAND_API_KEY not set — skipping double-dial");
    return { ok: false, error: "BLAND_API_KEY not configured" };
  }

  if (!phone) {
    console.warn(`[setter-cadence] No phone for contact=${contactId} — skipping double-dial`);
    return { ok: false, error: "phone is required for double-dial" };
  }

  try {
    const requestData = {
      phone_number: phone,
      ghl_contact_id: contactId,
      first_name: firstName || "",
      appointment_time: appointmentTime || "",
      analyzer_recommendation: analyzerRecommendation || "",
      prequal_amount: prequalAmount || "0",
      primary_fico: primaryFico || "",
      closer_name: closerName || "your Senior Advisor",

      // Fields expected by the original setter-prompt.js template shape
      lead_first_name: firstName || "",
      lead_last_name: "",
      lead_phone: phone,
      rep_name: closerName || "your Senior Advisor",
      company_name: "FundHub",
      contact_id: contactId,
      calendar_id: process.env.GHL_CALENDAR_ID || "",
      transfer_number: process.env.FUNDHUB_REP_NUMBER || ""
    };

    const metadata = {
      ghl_contact_id: contactId,
      first_name: firstName || "",
      appointment_time: appointmentTime || "",
      analyzer_recommendation: analyzerRecommendation || "",
      prequal_amount: String(prequalAmount || ""),
      primary_fico: String(primaryFico || ""),
      closer_name: closerName || "",
      call_type: "setter_double_dial",
      double_dial_reason: triggerReason,
      original_call_id: originalCallId || null,
      initiated_at: new Date().toISOString()
    };

    const callConfig = buildSetterCallConfig(requestData, { metadata });

    // Voicemail drop: if AMD detects voicemail, deliver the voicemail_message
    // Bland AI supports voicemail_message as a top-level call param
    callConfig.voicemail_message = VOICEMAIL_MESSAGE;

    // Shorter max duration for double-dial (leave VM fast if no answer)
    callConfig.maxDuration = 10;

    const call = await bland.createCall(callConfig);

    console.log(
      `[setter-cadence] Double-dial launched: call_id=${call.call_id} contact=${contactId}`
    );

    return { ok: true, call_id: call.call_id };
  } catch (err) {
    console.error(
      `[setter-cadence] Double-dial failed for contact=${contactId}:`,
      err.message
    );
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Step 2: Fire GHL SMS cadence webhook
// ---------------------------------------------------------------------------

/**
 * Trigger the GHL no-answer SMS cadence workflow (AI-SET-03).
 *
 * We pass all merge-tag data in the payload so GHL can render SMS templates
 * without additional API calls. GHL workflow handles internal timing:
 *   - Waits ~7 min then sends SMS #1 (Value-First)
 *   - Waits ~4 hours then sends SMS #2 (Follow-Up)
 *   - Waits ~1 day then sends SMS #3 (Break-Up)
 *
 * GHL_SETTER_CADENCE_WEBHOOK_URL must be set in Vercel env vars.
 *
 * Non-fatal: if the env var is missing or the webhook fails, we log and return
 * { ok: false, error } — the caller's 200 response to Bland is not affected.
 */
async function fireSmsCadence({
  contactId,
  firstName,
  prequalAmount,
  appointmentTime,
  closerName,
  triggerReason
}) {
  const url = process.env.GHL_SETTER_CADENCE_WEBHOOK_URL;

  if (!url) {
    console.warn(
      "[setter-cadence] GHL_SETTER_CADENCE_WEBHOOK_URL not set — SMS cadence not triggered. " +
        "Set this env var to the AI-SET-03 workflow trigger URL once it is published in GHL."
    );
    return { ok: false, error: "GHL_SETTER_CADENCE_WEBHOOK_URL not configured" };
  }

  try {
    const payload = {
      event: "setter_no_answer_cadence",
      contact_id: contactId,
      // Merge-tag data for GHL SMS templates
      first_name: firstName || "",
      prequal_amount: prequalAmount || "",
      appointment_time: appointmentTime || "",
      closer_name: closerName || "",
      trigger_reason: triggerReason,
      triggered_at: new Date().toISOString(),
      // SMS template content — passed for GHL reference / logging.
      // GHL workflow must use {{first_name}}, {{prequal_amount}}, {{appointment_time}}
      // merge tags directly from contact custom fields in the SMS steps.
      sms_templates: {
        sms_1_value_first:
          `Hey ${firstName || "{{first_name}}"}, it's Chris from FundHub! I just tried giving you a call about your Strategy Session. Looking at your file — you've been pre-approved for $${prequalAmount || "{{prequal_amount}}"} in funding. Just want to make sure your appointment on ${appointmentTime || "{{appointment_time}}"} still works? 💰`,
        sms_2_follow_up:
          `Hey ${firstName || "{{first_name}}"}, just checking in — we have your UnderwriteIQ results ready and your Senior Advisor is prepped for your call. To lock it in, accept the calendar invite in your email.`,
        sms_3_break_up:
          `Hey ${firstName || "{{first_name}}"}, I noticed we haven't been able to connect. Your pre-approval for $${prequalAmount || "{{prequal_amount}}"} is still active but I can't hold your advisor's slot much longer. If you're still interested, accept the calendar invite in your email so your call is locked in. — Chris`
      }
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const errMsg = `GHL cadence webhook returned ${resp.status}: ${text.substring(0, 200)}`;
      console.error(`[setter-cadence] ${errMsg}`);
      return { ok: false, error: errMsg };
    }

    console.log(
      `[setter-cadence] GHL SMS cadence triggered for contact=${contactId} (AI-SET-03)`
    );
    return { ok: true };
  } catch (err) {
    console.error(
      `[setter-cadence] GHL SMS cadence request failed for contact=${contactId}:`,
      err.message
    );
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// 3-Way Text Handoff (AI-SET-04, Step 3)
// ---------------------------------------------------------------------------

/**
 * Trigger the GHL 3-way text handoff workflow (AI-SET-04).
 *
 * This fires 15 minutes before the confirmed appointment. Called from
 * setter-webhook when outcome is "confirmed".
 *
 * The GHL workflow should have a wait step to delay until (appointment_time - 15 min),
 * then send the handoff SMS adding the Closer to the thread.
 *
 * SMS template (from SOP addendum):
 *   "Hey {{first_name}}, it's Chris from FundHub. Your Funding Strategy Session
 *    is starting in 15 minutes! I've briefed your Senior Advisor, {{closer_name}},
 *    on your UnderwriteIQ results and they are ready to review your
 *    ${{prequal_amount}} pre-approval. Here is the Zoom link: {{zoom_link}}.
 *    {{closer_name}} will take it from here!"
 *
 * @param {Object} opts
 * @param {string} opts.contactId          - GHL contact ID
 * @param {string} opts.firstName          - Lead first name
 * @param {string} [opts.prequalAmount]    - Pre-approval amount
 * @param {string} [opts.appointmentTime]  - ISO appointment timestamp
 * @param {string} [opts.closerName]       - Assigned advisor name
 * @param {string} [opts.zoomLink]         - Zoom meeting link
 *
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
async function triggerThreeWayHandoff({
  contactId,
  firstName,
  prequalAmount = "",
  appointmentTime = "",
  closerName = "",
  zoomLink = ""
}) {
  const url = process.env.GHL_SETTER_HANDOFF_WEBHOOK_URL;

  if (!url) {
    console.warn(
      "[setter-cadence] GHL_SETTER_HANDOFF_WEBHOOK_URL not set — 3-way handoff not triggered. " +
        "Set this env var to the AI-SET-04 workflow trigger URL once published in GHL."
    );
    return { ok: false, error: "GHL_SETTER_HANDOFF_WEBHOOK_URL not configured" };
  }

  try {
    const handoffSms =
      `Hey ${firstName || "{{first_name}}"}, it's Chris from FundHub. Your Funding Strategy Session ` +
      `is starting in 15 minutes! I've briefed your Senior Advisor, ${closerName || "{{closer_name}}"}, ` +
      `on your UnderwriteIQ results and they are ready to review your ` +
      `$${prequalAmount || "{{prequal_amount}}"} pre-approval. ` +
      `Here is the Zoom link: ${zoomLink || "{{zoom_link}}"}. ` +
      `${closerName || "{{closer_name}}"} will take it from here!`;

    const payload = {
      event: "setter_three_way_handoff",
      contact_id: contactId,
      first_name: firstName || "",
      prequal_amount: prequalAmount || "",
      appointment_time: appointmentTime || "",
      closer_name: closerName || "",
      zoom_link: zoomLink || "",
      handoff_sms: handoffSms,
      triggered_at: new Date().toISOString()
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      const errMsg = `GHL handoff webhook returned ${resp.status}: ${text.substring(0, 200)}`;
      console.error(`[setter-cadence] ${errMsg}`);
      return { ok: false, error: errMsg };
    }

    console.log(
      `[setter-cadence] 3-way handoff triggered for contact=${contactId} (AI-SET-04)`
    );
    return { ok: true };
  } catch (err) {
    console.error(
      `[setter-cadence] 3-way handoff request failed for contact=${contactId}:`,
      err.message
    );
    return { ok: false, error: err.message };
  }
}

module.exports = {
  triggerOutboundCadence,
  triggerThreeWayHandoff,
  // Exported for unit testing
  _fireDoubleDial: fireDoubleDial,
  _fireSmsCadence: fireSmsCadence
};
