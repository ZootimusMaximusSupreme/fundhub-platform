"use strict";

/**
 * POST /api/trigger-setter-call
 *
 * Called by a GHL workflow when an appointment is booked AND the UnderwriteIQ
 * analyzer gate has passed. Inspects the lead grade, selects the appropriate
 * setter prompt variant, then dispatches an outbound Bland AI call.
 *
 * Lead grading (driven by cf_analyzer_recommendation):
 *   Grade 1 — "disqualified" → skip; do not call
 *   Grade 2 — "repair"       → repair-focused variant (setter, repair path)
 *   Grade 3 — "funding" AND prequal_amount < $50,000  → standard setter
 *   Grade 4 — "funding" AND prequal_amount >= $50,000 → VIP setter (same prompt,
 *                                                        higher priority metadata)
 *
 * Expected GHL webhook payload:
 * {
 *   "contact_id":              "GHL contact ID",
 *   "first_name":              "John",
 *   "phone":                   "+1xxxxxxxxxx",
 *   "appointment_time":        "ISO 8601 timestamp",
 *   "analyzer_recommendation": "funding" | "repair" | "disqualified",
 *   "prequal_amount":          "125000",    // string from GHL merge tag
 *   "primary_fico":            "720",
 *   "closer_name":             "Chris"      // Opportunity Owner / assigned advisor
 * }
 *
 * Auth: Authorization: Bearer <API_SECRET>
 */

const bland = require("../src/lib/bland-client");
const { buildSetterCallConfig } = require("../src/agents/setter-prompt");
const { requireAuth } = require("../src/lib/auth");
const { listRecords, getRecord } = require("../src/lib/airtable-client");

// Grade thresholds
const VIP_PREQUAL_THRESHOLD = 50000;

// Human-readable grade labels (used in logs + metadata)
const GRADE_LABELS = {
  1: "disqualified",
  2: "repair",
  3: "funding_standard",
  4: "funding_vip"
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!requireAuth(req, res)) return;

  if (!process.env.BLAND_API_KEY) {
    return res.status(500).json({ error: "BLAND_API_KEY not configured" });
  }

  const body = req.body || {};

  // -------------------------------------------------------------------------
  // Extract and validate required fields from GHL webhook payload
  // -------------------------------------------------------------------------
  const {
    contact_id: contactId,
    first_name: firstName,
    phone,
    appointment_time: appointmentTime,
    analyzer_recommendation: analyzerRecommendation,
    prequal_amount: prequalAmountRaw,
    primary_fico: primaryFico,
    closer_name: closerName
  } = body;

  if (!contactId) {
    return res.status(400).json({ error: "contact_id is required" });
  }
  if (!firstName) {
    return res.status(400).json({ error: "first_name is required" });
  }
  if (!phone) {
    return res.status(400).json({ error: "phone is required" });
  }

  const prequalAmount = parseFloat(String(prequalAmountRaw || "0").replace(/[^0-9.]/g, "")) || 0;
  const recommendation = (analyzerRecommendation || "").toLowerCase().trim();

  // -------------------------------------------------------------------------
  // Grade classification
  // -------------------------------------------------------------------------
  const grade = classifyGrade(recommendation, prequalAmount);
  const gradeLabel = GRADE_LABELS[grade];

  console.log(
    `[trigger-setter-call] contact=${contactId} recommendation=${recommendation} ` +
      `prequal=$${prequalAmount} grade=${grade} (${gradeLabel})`
  );

  // Grade 1 — disqualified: cancel the call entirely
  if (grade === 1) {
    console.log(`[trigger-setter-call] Grade 1 (disqualified) — skipping call for contact ${contactId}`);
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: "grade_1_disqualified",
      contact_id: contactId
    });
  }

  // -------------------------------------------------------------------------
  // Build Bland AI call config
  // -------------------------------------------------------------------------
  try {
    // Fetch credit report context from Airtable (non-blocking fallback on failure)
    const creditSummary = await fetchCreditSummary(contactId);
    const suggestionsSummary = await fetchSuggestionsSummary(contactId);

    // request_data is injected into the prompt as {{key}} variables
    const requestData = buildRequestData({
      firstName,
      phone,
      prequalAmount,
      primaryFico: primaryFico || "",
      analyzerRecommendation: recommendation,
      appointmentTime: appointmentTime || "",
      closerName: closerName || "your Senior Advisor",
      grade,
      creditSummary,
      suggestionsSummary
    });

    // metadata is passed through on the webhook callback (not injected into prompt)
    const metadata = {
      ghl_contact_id: contactId,
      first_name: firstName,
      appointment_time: appointmentTime || null,
      analyzer_recommendation: recommendation,
      prequal_amount: String(prequalAmountRaw || ""),
      primary_fico: String(primaryFico || ""),
      closer_name: closerName || "",
      grade,
      grade_label: gradeLabel,
      call_type: "setter",
      initiated_at: new Date().toISOString()
    };

    const callConfig = buildSetterCallConfig(requestData, { metadata });

    // -------------------------------------------------------------------------
    // Setter-specific Bland AI overrides from spec addendum
    // -------------------------------------------------------------------------
    // max_duration: 10 minutes per spec (setter calls should be brief)
    callConfig.maxDuration = 10;

    // AMD: detect answering machine, drop voicemail if detected
    callConfig.amd = true;

    // first_sentence from spec
    callConfig.firstSentence = `Hey, is this ${firstName}?`;

    const call = await bland.createCall(callConfig);

    console.log(
      `[trigger-setter-call] Bland call launched: call_id=${call.call_id} ` +
        `contact=${contactId} grade=${grade}`
    );

    return res.status(200).json({
      ok: true,
      call_id: call.call_id,
      status: call.status || "queued",
      contact_id: contactId,
      grade,
      grade_label: gradeLabel
    });
  } catch (err) {
    console.error(`[trigger-setter-call] Failed to launch call for contact ${contactId}:`, err.message, err.stack);
    return res.status(500).json({
      ok: false,
      error: "Internal server error",
      detail: process.env.NODE_ENV !== "production" ? err.message : undefined
    });
  }
};

// ---------------------------------------------------------------------------
// Grade classification
// ---------------------------------------------------------------------------

/**
 * Determine the numeric lead grade from CRM indicators.
 *
 * @param {string} recommendation - Normalized cf_analyzer_recommendation value
 * @param {number} prequalAmount  - Parsed prequal amount in dollars
 * @returns {1|2|3|4}
 */
function classifyGrade(recommendation, prequalAmount) {
  if (recommendation === "disqualified") return 1;
  if (recommendation === "repair") return 2;
  if (recommendation === "funding") {
    return prequalAmount >= VIP_PREQUAL_THRESHOLD ? 4 : 3;
  }
  // Unknown recommendation — default to Grade 2 (repair-path) as conservative fallback
  // rather than skipping a potentially valid lead
  console.warn(`[trigger-setter-call] Unknown recommendation "${recommendation}" — defaulting to grade 2`);
  return 2;
}

// ---------------------------------------------------------------------------
// Request data builder
// ---------------------------------------------------------------------------

/**
 * Build the request_data object passed to buildSetterCallConfig.
 * All fields are injected as {{key}} variables into the Bland AI prompt.
 *
 * Grade-specific variants:
 *   Grade 2 (repair): first_sentence and rep description pivot to repair path
 *   Grade 3/4 (funding): standard / VIP path with prequal emphasis
 */
function buildRequestData({
  firstName,
  phone,
  prequalAmount,
  primaryFico,
  analyzerRecommendation,
  appointmentTime,
  closerName,
  grade,
  creditSummary,
  suggestionsSummary
}) {
  // Format prequal for speech ("$125,000" or "$0" if not applicable)
  const prequalFormatted =
    prequalAmount > 0
      ? "$" + prequalAmount.toLocaleString("en-US", { maximumFractionDigits: 0 })
      : "an amount we need to determine together";

  // Repair leads don't have a prequal — pivot framing
  const isRepair = grade === 2;
  const isVip = grade === 4;

  return {
    // Core fields used by current setter-prompt.js template
    lead_first_name: firstName,
    lead_last_name: "",
    phone_number: phone,
    lead_phone: phone,
    rep_name: closerName,
    company_name: "FundHub",
    contact_id: null, // not passed — use metadata.ghl_contact_id
    calendar_id: process.env.GHL_CALENDAR_ID || "",
    transfer_number: process.env.FUNDHUB_REP_NUMBER || "",

    // SLO funnel fields (referenced in updated setter prompt per spec addendum)
    first_name: firstName,
    prequal_amount: isRepair ? "0" : prequalFormatted,
    primary_fico: primaryFico || "not available",
    analyzer_recommendation: analyzerRecommendation,
    appointment_time: appointmentTime || "your scheduled time",
    closer_name: closerName,
    path: isRepair ? "Repair" : "Funding",
    is_vip: isVip ? "true" : "false",

    // Contextual flags that can be used in prompt branching
    repair_path: isRepair ? "true" : "false",
    funding_path: isRepair ? "false" : "true",

    // Credit report context injected as {{credit_summary}} in the prompt
    credit_summary: creditSummary || "Credit data unavailable — use FICO and prequal only.",
    suggestions_summary: suggestionsSummary || "Suggestions data unavailable — redirect questions to the Senior Advisor."
  };
}

// ---------------------------------------------------------------------------
// Credit summary fetcher
// ---------------------------------------------------------------------------

const CREDIT_SUMMARY_FALLBACK = "Credit data unavailable — use FICO and prequal only.";

/**
 * Fetch credit report context from Airtable and return a formatted text summary
 * suitable for injection as {{credit_summary}} in the setter prompt.
 *
 * Steps:
 *   1. Find the CLIENTS record matching the GHL contact ID
 *   2. Pull the latest SNAPSHOTS linked to that client
 *   3. Build a concise text block with scores, utilization, negatives, inquiries,
 *      top tradelines, and any derogatory accounts
 *
 * @param {string} contactId - GHL contact ID (ghl_contact_id field in CLIENTS)
 * @returns {Promise<string>} Formatted credit summary or fallback string on error
 */
async function fetchCreditSummary(contactId) {
  try {
    if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
      console.warn("[fetchCreditSummary] Airtable env vars not configured — using fallback");
      return CREDIT_SUMMARY_FALLBACK;
    }

    // Step 1: Find CLIENTS record by ghl_contact_id
    const clientsResult = await listRecords("CLIENTS", {
      filterByFormula: `{ghl_contact_id} = "${contactId}"`,
      maxRecords: 1
    });

    const clientRecord = clientsResult.records && clientsResult.records[0];
    if (!clientRecord) {
      console.warn(`[fetchCreditSummary] No CLIENTS record found for contact ${contactId}`);
      return CREDIT_SUMMARY_FALLBACK;
    }

    const clientFields = clientRecord.fields || {};

    // Step 2: Get the latest SNAPSHOTS linked to this client
    // Linked record fields store arrays of record IDs
    const snapshotLinks =
      clientFields["SNAPSHOTS"] ||
      clientFields["SNAPSHOTS 2"] ||
      [];

    if (!snapshotLinks.length) {
      console.warn(`[fetchCreditSummary] No SNAPSHOTS linked to client ${clientRecord.id}`);
      return CREDIT_SUMMARY_FALLBACK;
    }

    // Fetch the most recent snapshot (first link)
    const snapshotRecord = await getRecord("SNAPSHOTS", snapshotLinks[0]);
    const snap = snapshotRecord.fields || {};

    // Step 3: Build summary string
    const lines = [];

    // Per-bureau FICO scores
    const ex = snap.fico_experian || snap.experian_fico || snap.ex_fico || null;
    const tu = snap.fico_transunion || snap.transunion_fico || snap.tu_fico || null;
    const eq = snap.fico_equifax || snap.equifax_fico || snap.eq_fico || null;
    const scoreParts = [];
    if (ex) scoreParts.push(`EX: ${ex}`);
    if (tu) scoreParts.push(`TU: ${tu}`);
    if (eq) scoreParts.push(`EQ: ${eq}`);
    if (scoreParts.length) {
      lines.push(`FICO Scores — ${scoreParts.join(", ")}`);
    }

    // Utilization
    const util = snap.utilization_pct || snap.overall_utilization || snap.utilization || null;
    if (util !== null && util !== undefined) {
      lines.push(`Overall Utilization: ${util}%`);
    }

    // Negative items
    const negCount = snap.negative_items_count || snap.num_negative_items || snap.negative_count || null;
    if (negCount !== null && negCount !== undefined) {
      lines.push(`Negative Items: ${negCount}`);
    }

    // Inquiries
    const inqCount = snap.inquiry_count || snap.num_inquiries || snap.inquiries || null;
    if (inqCount !== null && inqCount !== undefined) {
      lines.push(`Inquiries: ${inqCount}`);
    }

    // Top tradelines — stored as JSON string or structured field
    const tradelinesRaw =
      snap.tradelines ||
      snap.top_tradelines ||
      snap.tradeline_summary ||
      null;

    if (tradelinesRaw) {
      try {
        const tradelines = typeof tradelinesRaw === "string"
          ? JSON.parse(tradelinesRaw)
          : tradelinesRaw;

        if (Array.isArray(tradelines) && tradelines.length) {
          lines.push("Top Tradelines:");
          tradelines.slice(0, 5).forEach((tl) => {
            const name = tl.creditor || tl.name || tl.account_name || "Unknown";
            const balance = tl.balance !== undefined ? `$${Number(tl.balance).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : null;
            const limit = tl.limit !== undefined ? `$${Number(tl.limit).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : null;
            const status = tl.status || tl.payment_status || null;
            const parts = [name];
            if (balance) parts.push(`bal ${balance}`);
            if (limit) parts.push(`lim ${limit}`);
            if (status) parts.push(status);
            lines.push(`  - ${parts.join(", ")}`);
          });
        }
      } catch (_) {
        // Non-JSON tradeline field — include raw if it's a short string
        if (typeof tradelinesRaw === "string" && tradelinesRaw.length < 500) {
          lines.push(`Tradelines: ${tradelinesRaw}`);
        }
      }
    }

    // Negative/derogatory items
    const negativesRaw =
      snap.negative_accounts ||
      snap.derogatory_items ||
      snap.negative_tradelines ||
      null;

    if (negativesRaw) {
      try {
        const negatives = typeof negativesRaw === "string"
          ? JSON.parse(negativesRaw)
          : negativesRaw;

        if (Array.isArray(negatives) && negatives.length) {
          lines.push("Negative Items:");
          negatives.slice(0, 5).forEach((neg) => {
            const name = neg.creditor || neg.name || neg.account_name || "Unknown";
            const type = neg.type || neg.account_type || null;
            const amount = neg.amount !== undefined ? `$${Number(neg.amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : null;
            const parts = [name];
            if (type) parts.push(type);
            if (amount) parts.push(amount);
            lines.push(`  - ${parts.join(", ")}`);
          });
        }
      } catch (_) {
        // Skip unparseable negatives
      }
    }

    if (!lines.length) {
      console.warn(`[fetchCreditSummary] Snapshot found but no recognizable fields for contact ${contactId}`);
      return CREDIT_SUMMARY_FALLBACK;
    }

    return lines.join("\n");
  } catch (err) {
    console.error(`[fetchCreditSummary] Error fetching credit data for contact ${contactId}:`, err.message);
    return CREDIT_SUMMARY_FALLBACK;
  }
}

// ---------------------------------------------------------------------------
// Suggestions & deliverables fetcher
// ---------------------------------------------------------------------------

const SUGGESTIONS_FALLBACK = "Suggestions data unavailable — redirect questions to the Senior Advisor.";

async function fetchSuggestionsSummary(contactId) {
  const airtableKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_BASE_ID;
  if (!airtableKey || !baseId) return SUGGESTIONS_FALLBACK;

  try {
    // Find client by ghl_contact_id
    const clientsUrl = `https://api.airtable.com/v0/${baseId}/CLIENTS?filterByFormula={ghl_contact_id}="${contactId}"&maxRecords=1`;
    const clientsResp = await fetch(clientsUrl, {
      headers: { Authorization: `Bearer ${airtableKey}` }
    });
    if (!clientsResp.ok) return SUGGESTIONS_FALLBACK;
    const clientsData = await clientsResp.json();
    const client = clientsData.records?.[0];
    if (!client) return SUGGESTIONS_FALLBACK;

    const fields = client.fields || {};
    const lines = [];

    // Top suggestions / optimization findings
    const topFixes = fields.latest_top_fixes || fields.top_fixes || fields.credit_suggestions || "";
    if (topFixes) {
      lines.push("TOP OPTIMIZATION SUGGESTIONS:");
      const fixes = topFixes.split("\n").filter(Boolean).slice(0, 5);
      fixes.forEach(f => lines.push(`  - ${f.trim()}`));
    }

    // Outcome / recommendation
    const outcome = fields.latest_underwriteiq_outcome || fields.analyzer_path || "";
    if (outcome) lines.push(`Outcome: ${outcome}`);

    // Pre-approval
    const prequal = fields.latest_preapproval_amount || fields.Prequal || "";
    if (prequal) lines.push(`Pre-Approval Amount: $${Number(prequal).toLocaleString()}`);

    // Letters / documents status
    const lettersReady = fields.letters_ready || "";
    if (lettersReady) lines.push("Letters/Documents: READY — sent to client");

    // Confidence
    const confidence = fields.latest_confidence || "";
    if (confidence) lines.push(`Analysis Confidence: ${confidence}`);

    // Risk flags
    const riskFlags = fields.latest_risk_flags || "";
    if (riskFlags) lines.push(`Risk Flags: ${riskFlags}`);

    if (lines.length === 0) return SUGGESTIONS_FALLBACK;
    return lines.join("\n");
  } catch (err) {
    console.error(`[fetchSuggestionsSummary] Error for contact ${contactId}:`, err.message);
    return SUGGESTIONS_FALLBACK;
  }
}

module.exports._fetchCreditSummary = fetchCreditSummary;
module.exports._fetchSuggestionsSummary = fetchSuggestionsSummary;
