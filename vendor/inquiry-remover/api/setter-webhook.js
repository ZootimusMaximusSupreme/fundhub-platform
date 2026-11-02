"use strict";

/**
 * POST /api/setter-webhook
 *
 * Receives the Bland AI callback after a setter call completes.
 * Parses the call outcome, updates the GHL contact with disposition fields,
 * applies CRM tags, and fires GHL workflow triggers where applicable.
 *
 * Outcome → GHL action mapping:
 *
 *   confirmed    → cf_call_confirmed=true, cf_last_progress_action=ai_call_confirmed
 *                  (lead confirmed appointment; hand off to advisor)
 *
 *   reschedule   → cf_decision_status=reschedule
 *                  (lead asked to reschedule; triggers DPC-04 workflow)
 *
 *   no_answer    → tag: setter:no-answer
 *   voicemail    → tag: setter:voicemail
 *                  (both enter outbound cadence for re-engagement)
 *
 *   failed       → tag: setter:failed
 *                  (call failed at carrier level; needs investigation)
 *
 * Bland webhook payload:
 * {
 *   "call_id":     "...",
 *   "status":      "completed" | "no-answer" | "busy" | "failed" | "voicemail",
 *   "completed":   true/false,
 *   "call_length": 123.4,  (seconds)
 *   "transcripts": [{ user: "...", agent: "...", ... }],
 *   "summary":     "...",
 *   "answered_by": "human" | "voicemail",
 *   "transferred_to": "+1..." (if transfer happened),
 *   "metadata": {
 *     "ghl_contact_id":          "...",
 *     "first_name":              "...",
 *     "appointment_time":        "...",
 *     "analyzer_recommendation": "...",
 *     "prequal_amount":          "...",
 *     "primary_fico":            "...",
 *     "closer_name":             "...",
 *     "grade":                   3,
 *     "grade_label":             "funding_standard",
 *     "call_type":               "setter"
 *   }
 * }
 */

const bland = require("../src/lib/bland-client");
const { SETTER_ANALYSIS_QUESTIONS } = require("../src/agents/setter-prompt");

// GHL workflow trigger URL for DPC-04 (reschedule cadence)
// Set GHL_DPC04_WEBHOOK_URL in Vercel env vars once the workflow is published.
const DPC04_WEBHOOK_URL = process.env.GHL_DPC04_WEBHOOK_URL;

const outboundCadence = require("../src/lib/setter-outbound-cadence");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // -------------------------------------------------------------------------
  // Webhook signature verification (same pattern as call-webhook.js)
  // -------------------------------------------------------------------------
  const webhookSecret = process.env.BLAND_WEBHOOK_SECRET;
  if (webhookSecret) {
    const crypto = require("crypto");
    const signature = req.headers["x-webhook-signature"] || "";
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const expected = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    if (signature !== expected) {
      console.error("[setter-webhook] Invalid webhook signature");
      return res.status(401).json({ error: "Invalid signature" });
    }
  } else {
    console.warn("[setter-webhook] BLAND_WEBHOOK_SECRET not set — signature verification disabled");
  }

  const payload = req.body;
  if (!payload || !payload.call_id) {
    return res.status(400).json({ error: "Invalid webhook payload" });
  }

  const {
    call_id,
    status,
    completed,
    call_length,
    transcripts,
    summary,
    metadata,
    answered_by,
    transferred_to
  } = payload;

  // The trigger endpoint stores the GHL contact ID under metadata.ghl_contact_id
  // (matching the spec addendum payload schema)
  const contactId = metadata?.ghl_contact_id;

  console.log(
    `[setter-webhook] call_id=${call_id}, status=${status}, completed=${completed}, ` +
      `length=${call_length}s, contact=${contactId || "none"}`
  );

  // -------------------------------------------------------------------------
  // Determine outcome
  // -------------------------------------------------------------------------
  const outcome = determineOutcome(payload);
  console.log(`[setter-webhook] outcome=${outcome}`);

  // -------------------------------------------------------------------------
  // Update GHL contact
  // -------------------------------------------------------------------------
  if (contactId) {
    try {
      await updateGhlContact(contactId, {
        call_id,
        outcome,
        summary,
        call_length,
        metadata
      });
      console.log(`[setter-webhook] GHL contact ${contactId} updated → outcome=${outcome}`);
    } catch (err) {
      // Non-fatal — log and continue. Bland needs a 200.
      console.error(`[setter-webhook] GHL update failed for ${contactId}:`, err.message);
    }

    // -----------------------------------------------------------------------
    // Trigger DPC-04 workflow for reschedule outcome
    // -----------------------------------------------------------------------
    if (outcome === "reschedule" && DPC04_WEBHOOK_URL) {
      triggerDpc04(contactId, metadata).catch((err) => {
        console.error(`[setter-webhook] DPC-04 trigger failed for ${contactId}:`, err.message);
      });
    } else if (outcome === "reschedule" && !DPC04_WEBHOOK_URL) {
      console.warn(
        "[setter-webhook] outcome=reschedule but GHL_DPC04_WEBHOOK_URL not set — DPC-04 not triggered"
      );
    }

    // -----------------------------------------------------------------------
    // Outbound cadence for no-answer / voicemail outcomes
    // -----------------------------------------------------------------------
    if (outcome === "no_answer" || outcome === "voicemail") {
      outboundCadence.triggerOutboundCadence({
        contactId,
        firstName: metadata?.first_name || "",
        phone: payload.to || payload.phone_number || "",
        prequalAmount: metadata?.prequal_amount || "",
        appointmentTime: metadata?.appointment_time || "",
        primaryFico: metadata?.primary_fico || "",
        closerName: metadata?.closer_name || "",
        analyzerRecommendation: metadata?.analyzer_recommendation || "",
        originalCallId: call_id,
        triggerReason: outcome
      }).catch((err) => {
        console.error(
          `[setter-webhook] Outbound cadence trigger failed for ${contactId}:`,
          err.message
        );
      });
    }

    // -----------------------------------------------------------------------
    // 3-way text handoff for confirmed outcome
    // -----------------------------------------------------------------------
    if (outcome === "confirmed") {
      outboundCadence.triggerThreeWayHandoff({
        contactId,
        firstName: metadata?.first_name || "",
        prequalAmount: metadata?.prequal_amount || "",
        appointmentTime: metadata?.appointment_time || "",
        closerName: metadata?.closer_name || "",
        zoomLink: metadata?.zoom_link || ""
      }).catch((err) => {
        console.error(
          `[setter-webhook] 3-way handoff trigger failed for ${contactId}:`,
          err.message
        );
      });
    }
  } else {
    console.warn("[setter-webhook] No ghl_contact_id in metadata — skipping GHL update");
  }

  // -------------------------------------------------------------------------
  // Post-call analysis (async, best-effort, non-blocking)
  // -------------------------------------------------------------------------
  if (call_id && status === "completed") {
    triggerSetterAnalysis(call_id, contactId).catch((err) => {
      console.error(`[setter-webhook] Analysis failed for ${call_id}:`, err.message);
    });
  }

  return res.status(200).json({
    ok: true,
    outcome,
    call_id,
    contact_id: contactId || null
  });
};

// ---------------------------------------------------------------------------
// Outcome classification
// ---------------------------------------------------------------------------

/**
 * Classify the Bland AI call result into one of the five canonical outcomes.
 *
 * Priority order:
 *   1. Hard failures / no contact (carrier-level)
 *   2. Voicemail detected by AMD
 *   3. Analyze summary/transcript for confirmed vs reschedule
 *   4. Short completed calls → no_answer (IVR/hangup)
 *
 * @param {Object} payload - Raw Bland AI webhook payload
 * @returns {"confirmed"|"reschedule"|"no_answer"|"voicemail"|"failed"}
 */
function determineOutcome(payload) {
  const { status, completed, call_length, answered_by, summary } = payload;

  // Carrier-level failure
  if (status === "failed") return "failed";

  // No pick-up
  if (status === "no-answer" || status === "busy") return "no_answer";

  // AMD detected voicemail
  if (answered_by === "voicemail") return "voicemail";

  // For completed calls, inspect summary to distinguish confirmed vs reschedule
  if (completed) {
    const lowerSummary = (summary || "").toLowerCase();

    // Explicit reschedule signals
    if (
      lowerSummary.includes("reschedule") ||
      lowerSummary.includes("different time") ||
      lowerSummary.includes("call back") ||
      lowerSummary.includes("callback") ||
      lowerSummary.includes("not a good time")
    ) {
      return "reschedule";
    }

    // Confirmation signals
    if (
      lowerSummary.includes("confirmed") ||
      lowerSummary.includes("see you") ||
      lowerSummary.includes("i'll be there") ||
      lowerSummary.includes("sounds good") ||
      lowerSummary.includes("all set") ||
      lowerSummary.includes("appointment")
    ) {
      return "confirmed";
    }

    // Short call — likely hung up before meaningful exchange
    if (call_length != null && call_length < 15) return "no_answer";

    // Default for answered calls without clear signal: treat as confirmed
    // (conservative — better to follow up on a confirmed than miss a warm lead)
    return "confirmed";
  }

  // Call never reached completed state
  return "no_answer";
}

// ---------------------------------------------------------------------------
// GHL: Update contact fields, tags, and activity note
// ---------------------------------------------------------------------------

/**
 * Apply outcome-specific updates to the GHL contact.
 *
 * Outcome → actions:
 *   confirmed  → cf_call_confirmed=true, cf_last_progress_action=ai_call_confirmed
 *   reschedule → cf_decision_status=reschedule
 *   no_answer  → tag: setter:no-answer
 *   voicemail  → tag: setter:voicemail
 *   failed     → tag: setter:failed
 *
 * All outcomes: activity note added to CRM timeline.
 */
async function updateGhlContact(contactId, { call_id, outcome, summary, call_length, metadata }) {
  const ghl = require("../src/lib/ghl-client");

  if (!ghl.isConfigured()) {
    console.warn("[setter-webhook] GHL not configured (missing API key or location ID), skipping");
    return;
  }

  const customFields = buildCustomFields(outcome);
  const tags = buildTags(outcome);

  // Update custom fields (if any for this outcome)
  if (Object.keys(customFields).length > 0) {
    await ghl.updateContactCustomFields(contactId, customFields);
  }

  // Apply tags (if any for this outcome)
  if (tags.length > 0) {
    await ghl.addContactTags(contactId, tags).catch((err) => {
      // Tag failures are non-fatal
      console.error(`[setter-webhook] addContactTags failed for ${contactId}:`, err.message);
    });
  }

  // Activity note — always written so CRM timeline reflects every call
  const noteLines = buildActivityNote({ call_id, outcome, summary, call_length, metadata });
  await ghl.addContactNote(contactId, noteLines);
}

/**
 * Map outcome to GHL custom field updates.
 * @param {string} outcome
 * @returns {Object} Key/value pairs for updateContactCustomFields
 */
function buildCustomFields(outcome) {
  switch (outcome) {
    case "confirmed":
      return {
        cf_call_confirmed: "true",
        cf_last_progress_action: "ai_call_confirmed"
      };
    case "reschedule":
      return {
        cf_decision_status: "reschedule"
      };
    // no_answer, voicemail, failed → tag-only; no custom field writes needed
    default:
      return {};
  }
}

/**
 * Map outcome to GHL tags.
 * @param {string} outcome
 * @returns {string[]}
 */
function buildTags(outcome) {
  const tagMap = {
    no_answer: ["setter:no-answer"],
    voicemail: ["setter:voicemail"],
    failed: ["setter:failed"]
  };
  return tagMap[outcome] || [];
}

/**
 * Build a concise activity note for the CRM timeline.
 */
function buildActivityNote({ call_id, outcome, summary, call_length, metadata }) {
  const durationStr = call_length != null ? `${Math.round(call_length)}s` : "N/A";
  const grade = metadata?.grade_label || metadata?.grade || "unknown";
  const prequal = metadata?.prequal_amount ? `$${metadata.prequal_amount}` : "N/A";
  const closerName = metadata?.closer_name || "N/A";

  const lines = [
    `AI Setter Call (Chris) — ${outcomeLabel(outcome)}`,
    `Outcome: ${outcome}`,
    `Duration: ${durationStr}`,
    `Grade: ${grade}`,
    `Pre-Approval: ${prequal}`,
    `Assigned Advisor: ${closerName}`,
    call_id ? `Call ID: ${call_id}` : null,
    summary ? `\nSummary: ${summary}` : null
  ];

  return lines.filter(Boolean).join("\n");
}

/** Human-readable outcome label for the note header. */
function outcomeLabel(outcome) {
  const labels = {
    confirmed: "Appointment Confirmed",
    reschedule: "Requested Reschedule",
    no_answer: "No Answer",
    voicemail: "Voicemail Left",
    failed: "Call Failed"
  };
  return labels[outcome] || outcome;
}

// ---------------------------------------------------------------------------
// DPC-04: Reschedule workflow trigger
// ---------------------------------------------------------------------------

/**
 * Fire the GHL DPC-04 workflow trigger for leads who asked to reschedule.
 * The workflow handles the re-engagement SMS/email cadence.
 */
async function triggerDpc04(contactId, metadata) {
  const url = DPC04_WEBHOOK_URL;
  console.log(`[setter-webhook] Triggering DPC-04 for contact ${contactId}`);

  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contact_id: contactId,
      first_name: metadata?.first_name || "",
      prequal_amount: metadata?.prequal_amount || "",
      appointment_time: metadata?.appointment_time || "",
      trigger_reason: "setter_reschedule"
    })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`DPC-04 webhook returned ${resp.status}: ${text.substring(0, 200)}`);
  }

  console.log(`[setter-webhook] DPC-04 triggered for ${contactId}`);
}

// ---------------------------------------------------------------------------
// Post-call analysis (async, best-effort)
// ---------------------------------------------------------------------------

/**
 * Request Bland AI post-call analysis and append results to the GHL contact note.
 */
async function triggerSetterAnalysis(callId, contactId) {
  try {
    const analysis = await bland.analyzeCall(callId, SETTER_ANALYSIS_QUESTIONS);
    console.log(
      `[setter-webhook] Analysis for ${callId}:`,
      JSON.stringify(analysis).substring(0, 500)
    );

    if (contactId) {
      const ghl = require("../src/lib/ghl-client");
      if (ghl.isConfigured()) {
        const analysisText = Object.entries(analysis.answers || analysis || {})
          .map(([q, a]) => `Q: ${q}\nA: ${a}`)
          .join("\n\n");

        if (analysisText) {
          await ghl.addContactNote(contactId, "--- AI Setter Analysis ---\n" + analysisText);
        }
      }
    }
  } catch (err) {
    // Non-fatal — analysis is supplementary
    console.error(`[setter-webhook] analyzeCall failed for ${callId}:`, err.message);
  }
}
