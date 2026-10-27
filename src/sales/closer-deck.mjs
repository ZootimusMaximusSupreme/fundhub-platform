// Closer deck payload + live actions.
// Reads stored CRS + survey. Never invents FICO or reason copy.
// Headline pre-approval is the STORED engine estimate — the same figure the
// client portal quotes. This screen does no funding arithmetic of its own
// (F15, owner-set 2026-09-03).

import { getOffer, offerAllowsLetters, offersForClient, formatCents, resolveOfferAmountCents } from "../config/offers.mjs";
import { isFundingPath } from "../config/product-path.mjs";
import { createPaymentLink, markSent } from "../payment-links/index.mjs";
import { checkoutConfig } from "../payments/commas-api.mjs";
import { formatPrice } from "../subscriptions/index.mjs";
import { sendTemplated } from "../workflows/messaging.mjs";
import { mergeCustomFields } from "../workflows/custom-fields.mjs";
import { addTags } from "../workflows/tags.mjs";
import { EMAIL_TEMPLATE_KEY } from "../workflows/ds-02-diy-letters.mjs";
/* The already-seeded, already-compliance-passed email that names the five
   UnderwriteIQ documents by name. No new template key is minted here: an
   unseeded key returns { sent:false, reason:"template_pending" } in silence
   (../workflows/messaging.mjs), which is the same lie in a different place. */
import { FUNDING_EMAIL_TEMPLATE_KEY as DELIVERABLES_EMAIL_TEMPLATE_KEY }
  from "../workflows/u-02-analyzer-complete-delivery.mjs";
import { buildLetterPackForClient } from "../underwrite/letter-pack.mjs";
import { persistFundingLetterFiles } from "../underwrite/funding-letter-pdf.mjs";
import { persistDiyPackageFiles } from "../metro2/diy/persist.mjs";
import { storeFromEnv } from "../documents/store.mjs";
import { logCallOutcome, paidTransactionForLink } from "./call-outcomes.mjs";
import { signSoftPullApproveUrl } from "../consent/approve-token.mjs";
import { consentStatus } from "../consent/index.mjs";
import { composeAndSend } from "../messaging/compose.mjs";
import { dispatchMessage } from "../messaging/dispatch.mjs";
import { secretFromEnv } from "../documents/signed-url.mjs";
import { incomeEstimates, isSampleResult } from "../http/client-detail.mjs";
/* The client portal's own pre-qual reader. Deck and portal quote one number
   (F15) because they call the same function, not because someone kept two
   calculations in step. */
import { prequalFromCustomFields } from "../http/portal-prequal.mjs";
import { getLatestPull } from "../finance/soft-pulls.mjs";
import { isSloPostPurchaseEnabled } from "../slo/purchase.mjs";

/* COMPLIANCE REVIEW REQUIRED — credit-pull type/reuse.
   Owner-set 2026-09-19: when SLO_POST_PURCHASE_ENABLED is on, a closer does
   not send another $32 / C-00 pull when crs_results is younger than 30 days.
   Flag off (unset) keeps the existing send. Age ≥ 30 days, or no file, uses
   the existing send path either way. */
export const SOFT_PULL_REUSE_DAYS = 30;
const SOFT_PULL_REUSE_MS = SOFT_PULL_REUSE_DAYS * 24 * 60 * 60 * 1000;

export function freshSoftPullSkip(latest, now = new Date()) {
  if (!latest || latest.created_at == null || latest.created_at === "") return null;
  if (latest.is_demo === true || isSampleResult(latest.result)) return null;
  const pulledAt = new Date(latest.created_at);
  if (Number.isNaN(pulledAt.getTime())) return null;
  const ageMs = now.getTime() - pulledAt.getTime();
  if (ageMs >= SOFT_PULL_REUSE_MS) return null;
  const ageDays = ageMs < 0 ? 0 : Math.floor(ageMs / (24 * 60 * 60 * 1000));
  return {
    skipped: true,
    reason: "fresh_pull_on_file",
    last_pull_at: latest.created_at,
    crs_result_id: latest.id || null,
    pull_age_days: ageDays
  };
}

function jsonSafeLink(link, extra = {}) {
  if (!link) return null;
  const cents = Number(link.amount_cents);
  return {
    id: link.id || null,
    checkout_url: link.checkout_url || null,
    status: link.status || null,
    amount_cents: Number.isFinite(cents) ? cents : null,
    amount_display: extra.amount_display || formatCents(cents) || null,
    purpose: link.purpose || null,
    offer_key: extra.offer_key || null,
    description: extra.description || link.description || null
  };
}

function jsonSafeCompose(composed) {
  if (!composed) return null;
  return {
    outcome: composed.outcome ?? null,
    detail: composed.detail == null ? null : String(composed.detail).slice(0, 160),
    deduped: !!composed.deduped,
    status: composed.message?.status || null
  };
}

async function dispatchQueued(db, templated) {
  if (!templated?.messageId) return templated || null;
  try {
    const result = await dispatchMessage(db, templated.messageId);
    return {
      sent: templated.sent,
      messageId: templated.messageId,
      outcome: result?.outcome || null,
      detail: result?.detail == null ? null : String(result.detail).slice(0, 160)
    };
  } catch (err) {
    return {
      sent: templated.sent,
      messageId: templated.messageId,
      outcome: "error",
      detail: String(err && err.message ? err.message : err).slice(0, 160)
    };
  }
}

export class CloserDeckError extends Error {
  constructor(message, { status = 400, code = "bad_request" } = {}) {
    super(message);
    this.name = "CloserDeckError";
    this.status = status;
    this.code = code;
  }
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cf(client, key) {
  const custom = client?.custom_fields && typeof client.custom_fields === "object"
    ? client.custom_fields : {};
  const v = custom[key];
  if (Array.isArray(v)) return v.filter(Boolean).join(", ") || null;
  if (v == null || v === "") return null;
  return String(v);
}

/* F11 — the deck printed 207883 where the client's own words belong, on the
   slide headed "This is what you told us" and again as the biggest number on
   the goal slide. ClickFunnels stores the answer-option ROW ID on cf_svy_<key>
   and the words on cf_svy_<key>_label / _labels. Same rule pipeline.html
   already uses (surveyAnswer, isCfOptionId) — reused here rather than rebuilt,
   so the deck resolves the label wherever the raw id is all that got copied. */
function isCfOptionId(v) {
  if (typeof v === "number") return v >= 10000;
  return typeof v === "string" && /^\d{5,}$/.test(v.trim());
}

function surveyAnswer(client, key) {
  const custom = client?.custom_fields && typeof client.custom_fields === "object"
    ? client.custom_fields : {};
  const label = custom[`${key}_label`];
  if (label != null && label !== "") return String(label);
  const labels = custom[`${key}_labels`];
  if (labels != null && labels !== "") {
    if (Array.isArray(labels)) return labels.filter(Boolean).join(", ") || null;
    if (typeof labels === "string") {
      try {
        const parsed = JSON.parse(labels);
        if (Array.isArray(parsed)) return parsed.filter(Boolean).join(", ") || null;
      } catch {
        /* not JSON — the stored string is the label */
      }
    }
    return String(labels);
  }
  const v = custom[key];
  if (v == null || v === "") return null;
  if (Array.isArray(v)) {
    const words = v.filter((x) => x != null && x !== "" && !isCfOptionId(x));
    return words.length ? words.join(", ") : null;
  }
  /* A bare option id is not an answer. Better a dash than a database row id
     read out to a customer on a live call. */
  if (isCfOptionId(v)) return null;
  return String(v);
}

function deckTier(outcome) {
  const t = String(outcome || "");
  if (t === "FULL_FUNDING" || t === "PREMIUM_STACK") return "FULL_FUNDING";
  if (t === "FUNDING_PLUS_REPAIR") return "FUNDING_PLUS_REPAIR";
  if (t === "REPAIR_ONLY") return "REPAIR_ONLY";
  return null;
}

function ficoFrom(result) {
  const pb = result?.scores?.perBureau
    || result?.consumerSignals?.scores?.perBureau
    || {};
  const scores = result?.scores && typeof result.scores === "object" ? result.scores : {};
  return {
    ex: numOrNull(pb.ex ?? pb.EX ?? pb.experian ?? scores.experian ?? scores.EX ?? scores.ex),
    tu: numOrNull(pb.tu ?? pb.TU ?? pb.transunion ?? scores.transunion ?? scores.TU ?? scores.tu),
    eq: numOrNull(pb.eq ?? pb.EQ ?? pb.equifax ?? scores.equifax ?? scores.EQ ?? scores.eq)
  };
}

function reasonsFrom(result) {
  const raw = result?.reasonCodes
    || result?.reason_codes
    || result?.outcomeResult?.reasonCodes
    || [];
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    if (Array.isArray(item) && item[0]) {
      return [String(item[0]), item[1] != null ? String(item[1]) : String(item[0])];
    }
    if (item && typeof item === "object") {
      const code = item.code || item.id || item.ruleId || item.rule_id;
      const text = item.text || item.reason || item.label;
      if (!code && !text) return null;
      return [String(code || text), text != null ? String(text) : String(code)];
    }
    if (item == null || item === "") return null;
    return [String(item), String(item)];
  }).filter(Boolean);
}

function negCountFrom(result) {
  const bn = result?.bureauNegatives || result?.consumerSignals?.bureauNegatives;
  if (bn && typeof bn === "object") {
    let n = 0;
    let saw = false;
    for (const v of Object.values(bn)) {
      if (v && typeof v === "object" && v.count != null) {
        saw = true;
        n += Number(v.count) || 0;
      }
    }
    if (saw) return n;
  }
  const d = result?.derogatories ?? result?.consumerSignals?.derogatories;
  if (d && typeof d === "object") {
    const n = Number(d.count ?? d.total ?? d.negatives);
    if (Number.isFinite(n)) return n;
  }
  if (typeof result?.negItems === "number") return result.negItems;
  return null;
}

function engineFromRow(crs, clientTier) {
  if (!crs?.result || typeof crs.result !== "object") {
    return {
      available: false,
      reason: "engine data unavailable",
      tier: deckTier(clientTier),
      label: null,
      fico: { ex: null, tu: null, eq: null },
      total: null,
      afterFix: null,
      negItems: null,
      reasons: [],
      plan: []
    };
  }
  const result = crs.result;
  const outcome = result.outcome
    || result.outcomeResult?.outcome
    || crs.outcome_tier
    || clientTier
    || null;
  const tier = deckTier(outcome);
  const fico = ficoFrom(result);
  const total = numOrNull(
    result.preapprovals?.totalCombined
    ?? result.totalCombined
    ?? result.fundingEstimate
    ?? result.projectedPreapproval?.currentTotal
  );
  const afterFix = numOrNull(
    result.projectedPreapproval?.totalCombined
    ?? result.projectedTotalCombined
    ?? result.lenderReach?.afterOptimization
  );
  const hasAnyNumber = [fico.ex, fico.tu, fico.eq, total, afterFix].some((n) => n != null)
    || (Array.isArray(result.reasonCodes) && result.reasonCodes.length > 0)
    || (Array.isArray(result.reason_codes) && result.reason_codes.length > 0);
  if (!hasAnyNumber) {
    return {
      available: false,
      reason: "engine data unavailable",
      tier,
      label: tier ? String(tier).replace(/_/g, " ") : null,
      fico,
      total: null,
      afterFix: null,
      negItems: null,
      reasons: [],
      plan: []
    };
  }
  const labels = {
    FULL_FUNDING: "FULL FUNDING",
    FUNDING_PLUS_REPAIR: "FUNDING PLUS REPAIR",
    REPAIR_ONLY: "REPAIR ONLY"
  };
  return {
    available: true,
    reason: null,
    tier,
    outcome: outcome || null,
    label: tier ? labels[tier] : null,
    fico,
    total,
    afterFix,
    negItems: negCountFrom(result),
    reasons: reasonsFrom(result),
    plan: Array.isArray(result.plan) ? result.plan.map(String) : []
  };
}

export function selectedOfferKey({ edu, forceRepair, tier, rung }) {
  if (edu) return Number(rung) === 1 ? "UWIQ_DELIVERABLES" : "FUNDING_MASTERY";
  const funding = (tier === "FULL_FUNDING" || tier === "FUNDING_PLUS_REPAIR") && !forceRepair;
  if (!funding) {
    if (Number(rung) === 1) return "REPAIR_TRIAL";
    if (Number(rung) === 2) return "UWIQ_DELIVERABLES";
    return "REPAIR_DFY";
  }
  return "FUNDING_DFY";
}

export async function buildCloserDeck(db, { orgId, clientId }) {
  if (!orgId || !clientId) {
    throw new TypeError("buildCloserDeck: orgId and clientId required");
  }
  const clientRes = await db.query(
    `SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.outcome_tier, c.custom_fields,
            b.name AS business_name
       FROM clients c
       LEFT JOIN businesses b ON b.client_id = c.id AND b.org_id = c.org_id
      WHERE c.id = $1 AND c.org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows[0];
  if (!client) return null;

  /* Tradelines and card liabilities are no longer read here. They existed only
     to feed the render-time UnderwriteIQ recompute that F15 deleted; the deck
     now quotes the stored estimate and does no arithmetic of its own. */
  const [crsRes, bizRes] = await Promise.all([
    db.query(
      `SELECT result, outcome_tier, created_at
         FROM crs_results
        WHERE client_id = $1 AND org_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [clientId, orgId]
    ),
    /* The columns the payload actually maps. Two earlier goes at this were both
       wrong: the first asked for age_months alone, so every company came back
       nameless and undated; the second added a bare `incorporated_date`, which
       is NOT a column on businesses and took the whole Present screen down with
       `column "incorporated_date" does not exist` for every client in the
       company (live outage, fixed 2026-09-06).

       The incorporation month/year lives INSIDE the entity_data JSON blob —
       that is where api/soft-pull-approve.mjs writes it, both on intake
       (replaceSoftPullBusinesses) and on the deck's own "stamp the date"
       action, and it is where src/http/client-detail.mjs reads it from. Read it
       the same way here. The real columns on businesses are: id, org_id,
       client_id, name, age_months, entity_data, created_at, updated_at. */
    db.query(
      `SELECT id, name, age_months,
              entity_data->>'incorporated_date' AS incorporated_date
         FROM businesses
        WHERE client_id = $1 AND org_id = $2
        ORDER BY created_at ASC`,
      [clientId, orgId]
    )
  ]);

  const name = [client.first_name, client.last_name].filter(Boolean).join(" ").trim() || "Client";
  const engine = engineFromRow(crsRes.rows[0], client.outcome_tier);

  /* COMPLIANCE REVIEW REQUIRED — the client-facing pre-approval figure.
     F15, owner-set 2026-09-03: ONE stored number, no second calculation.

     Present used to re-run the UnderwriteIQ stack here at render time and
     overwrite the stored estimate with it. On 2026-09-03 that put $939,500 on
     the customer's own "PRE-APPROVED FOR APPROXIMATELY" slide while the engine
     had stored $199,350 and the client portal was showing $199,350 — the same
     person quoted two pre-approval figures 4.7x apart on two client-facing
     screens in the same minute. Owner: "fix the deck to the portal, not the
     reverse."

     So the recompute is gone, not synchronised. The deck reads what was
     stored, through the SAME reader the portal uses (prequalFromCustomFields),
     and falls back to the pre-approval carried on the stored CRS payload.
     A number that should move because a company was added moves when the
     engine runs again and stores a new estimate — never because a sales screen
     did its own arithmetic. */
  if (engine.available) {
    const stored = prequalFromCustomFields(client.custom_fields || {});
    if (stored != null) engine.total = stored;
  }
  /* Personal-only, or personal + business? Never ambiguous again (F15). The
     deck labels the figure with what it actually covers: business money is in
     the stored estimate only when the client has a real company on file. */
  engine.totalBasis = engine.total == null
    ? null
    : (bizRes.rows.length > 0 ? "personal_plus_business" : "personal_only");
  engine.totalSource = "stored engine estimate";
  /* A sample report's scores say they are a sample on the client's own
     "Your results" slide (live hole 23). */
  engine.sample = isSampleResult(crsRes.rows[0]?.result);

  const softPull = await softPullStatus(db, { orgId, clientId });
  const income = incomeEstimates(crsRes.rows);

  return {
    client_id: client.id,
    setter_handoff: client.custom_fields?.setter_handoff?.complete_at
      ? client.custom_fields.setter_handoff : null,
    slo_ref: cf(client, "slo_ref"),
    slo_source: cf(client, "slo_source"),
    slo_pack_status: cf(client, "slo_pack_status"),
    last_pull_at: softPull.last_pull_at,
    survey: {
      name,
      entity: client.business_name || cf(client, "business_name") || cf(client, "cf_business_name"),
      target: surveyAnswer(client, "cf_svy_funding_target_amount"),
      use: surveyAnswer(client, "cf_svy_planned_use"),
      hasBiz: surveyAnswer(client, "cf_svy_has_business"),
      revenue: surveyAnswer(client, "cf_svy_business_revenue"),
      income: surveyAnswer(client, "cf_svy_annual_income_range"),
      capital: surveyAnswer(client, "cf_svy_available_capital"),
      motivation: surveyAnswer(client, "cf_svy_money_change_now")
    },
    /* Every company on the file, so the deck can ask for a missing
       incorporation month/year instead of guessing the age. */
    businesses: bizRes.rows.map((b) => ({
      id: b.id,
      name: b.name || null,
      age_months: numOrNull(b.age_months),
      incorporated_date: b.incorporated_date || null
    })),
    /* Bureau income guesses for closer leverage — not paystubs, not bank balances. */
    income_estimates: income,
    engine,
    soft_pull: softPull,
    offers: offersForClient()
  };
}

async function softPullStatus(db, { orgId, clientId }) {
  const consent = await consentStatus(db, {
    orgId, clientId, kind: "soft_pull_consent"
  });
  const paid = await db.query(
    `SELECT id, amount_cents, status, paid_at, created_at, checkout_url
       FROM payment_links
      WHERE org_id = $1 AND client_id = $2 AND purpose = 'diagnostic'
      ORDER BY created_at DESC LIMIT 1`,
    [orgId, clientId]
  );
  const req = await db.query(
    `SELECT id, status, requested_at, resolved_at, crs_result_id
       FROM soft_pull_requests
      WHERE org_id = $1 AND client_id = $2
      ORDER BY requested_at DESC LIMIT 1`,
    [orgId, clientId]
  );
  const crs = await db.query(
    `SELECT id, outcome_tier, created_at, result, is_demo
       FROM crs_results
      WHERE org_id = $1 AND client_id = $2
      ORDER BY created_at DESC LIMIT 1`,
    [orgId, clientId]
  );
  const link = paid.rows[0] || null;
  const pull = req.rows[0] || null;
  const result = crs.rows[0] || null;
  const sample = result?.is_demo === true || isSampleResult(result?.result);
  const realResult = sample ? null : result;

  /* F16 — the panel read "pull: not started" and "tier: FULL_FUNDING" at the
     same time, on the same four lines, beside a full set of scores. Two
     different records were being reported as one fact: the request row in
     soft_pull_requests, and the credit result in crs_results. Only the request
     row was consulted, and a pull that reached the engine by any other path
     never has one.

     A stored credit result IS a finished pull. It wins, and pull_status_source
     says which record answered so the two can never silently disagree again. */
  const requestStatus = pull ? pull.status : null;
  const requestSettled = requestStatus != null
    && /^(complete|completed|done|resolved|fulfilled)$/i.test(String(requestStatus));
  const pullStatus = sample && requestSettled ? "sample only"
    : (realResult && !requestSettled ? "complete" : (requestStatus || (sample ? "sample only" : null)));

  return {
    consent_valid: !!consent.valid,
    consent_reason: consent.reason || null,
    diagnostic_paid: !!(link && (link.status === "paid" || link.paid_at)),
    diagnostic_link_status: link ? link.status : null,
    diagnostic_amount_cents: link ? Number(link.amount_cents) : null,
    diagnostic_checkout_url: link ? link.checkout_url : null,
    pull_status: pullStatus,
    pull_status_source: realResult && !requestSettled
      ? "crs_result"
      : (pull && !(sample && requestSettled) ? "soft_pull_request" : (sample ? "sample_result" : null)),
    sample,
    pull_id: pull ? pull.id : null,
    crs_result_id: realResult ? realResult.id : (sample ? null : (pull?.crs_result_id || null)),
    outcome_tier: result ? result.outcome_tier : null,
    last_pull_at: realResult ? realResult.created_at : null
  };
}

function publicBaseUrl(env = process.env) {
  if (env.PUBLIC_BASE_URL) return String(env.PUBLIC_BASE_URL).replace(/\/$/, "");
  if (env.URL) return String(env.URL).replace(/\/$/, "");
  return "https://fundhub.ai";
}

/**
 * sendDeckSoftPull — diagnostic pay link (base $32) + soft-pull approval form.
 * Soft-pull base price is never closer-editable (owner law). Business add-ons
 * ($10×n) are chosen on the approve form; checkout amount is adjusted there.
 */
export async function sendDeckSoftPull(db, {
  orgId, clientId, staffId, staffRole = null, checkoutBaseUrl, env = process.env
}) {
  const latest = await getLatestPull(db, { clientId });
  if (isSloPostPurchaseEnabled(env)) {
    const skip = freshSoftPullSkip(latest);
    if (skip) return skip;
  }

  const offer = getOffer("SOFT_PULL");
  if (!offer) {
    throw new CloserDeckError("Soft-pull offer missing from catalog.", { status: 500, code: "offer_missing" });
  }
  if (!checkoutBaseUrl && !String(env.FANBASIS_CHECKOUT_API_KEY || "").trim()) {
    throw new CloserDeckError(
      "FANBASIS_CHECKOUT_API_KEY is not set — no checkout link can be built",
      { status: 503, code: "commas_not_configured" }
    );
  }

  let signingSecret;
  try {
    signingSecret = secretFromEnv(env);
  } catch {
    throw new CloserDeckError(
      "DOCUMENT_URL_SECRET is not set — cannot sign the soft-pull approval link",
      { status: 503, code: "signing_secret_missing" }
    );
  }

  let link;
  try {
    link = await createPaymentLink(db, {
      orgId,
      clientId,
      purpose: "diagnostic",
      description: offer.name,
      commasProductTitle: offer.commasProductTitle,
      amountCents: offer.priceCents,
      createdByStaffId: staffId,
      createdByRole: staffRole,
      productCode: offer.productCode,
      checkoutBaseUrl,
      env
    });
  } catch (e) {
    throw new CloserDeckError(e.message || "Could not mint checkout link", {
      status: e.status || 502,
      code: e.code || "commas_checkout_failed"
    });
  }

  const approve = signSoftPullApproveUrl({
    orgId,
    clientId,
    secret: signingSecret,
    baseUrl: publicBaseUrl(env)
  });

  const first = await db.query(
    `SELECT first_name, email FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const firstNameRaw = first.rows[0]?.first_name || "there";
  const firstName = String(firstNameRaw)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const amount = formatCents(offer.priceCents) || "$32";
  /* EMAIL-OFFER-SOFT-PULL is post-payment ("assessment is running") — wrong
     for this send. Pay + consent clarity lives here until a dedicated
     pre-pay template exists. Order: consent form first, then pay. */
  const emailBody =
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your soft-pull assessment</title>
</head>
<body style="margin:0;padding:0;background-color:#F4F4F5;-webkit-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#F4F4F5;">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#FFFFFF;border:1px solid #E4E4E7;">
        <tr>
          <td style="padding:28px 28px 8px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#18181B;">
            <p style="margin:0 0 16px 0;">Hi ${firstName},</p>
            <p style="margin:0 0 16px 0;">Next step on our call: your UnderwriteIQ soft-pull assessment (base ${amount}).</p>
            <p style="margin:0 0 16px 0;"><strong>1) Approve the soft pull</strong> — this is your written permission for a soft inquiry. It does not hurt your credit score. Enter your details, and optionally add businesses ($10 each, up to 5). Your total updates on that page.</p>
            <p style="margin:0 0 16px 0;"><a href="${approve.url}" style="color:#18181B;font-weight:700;">Open soft-pull authorization form</a><br>
            <span style="font-size:13px;color:#71717A;word-break:break-all;">${approve.url}</span></p>
            <p style="margin:0 0 16px 0;"><strong>2) Pay the total shown on the form</strong> — base ${amount} for the personal soft pull, plus $10 per business you add. If you add no businesses, you can use this pay link:</p>
            <p style="margin:0 0 16px 0;"><a href="${link.checkout_url}" style="color:#18181B;font-weight:700;">Pay soft-pull assessment</a><br>
            <span style="font-size:13px;color:#71717A;word-break:break-all;">${link.checkout_url}</span></p>
            <p style="margin:0 0 16px 0;">If you add businesses, use the <strong>Pay</strong> button after you submit the form — that link matches your total. Both steps take about a minute. Stay on the Meet with your advisor.</p>
            <p style="margin:0 0 16px 0;">— Fundhub<br>
            fundhub.ai</p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

  const composed = await composeAndSend(db, {
    orgId,
    staffId,
    clientId,
    channel: "email",
    subject: `Your soft-pull assessment — authorize, then pay`,
    body: emailBody,
    idempotencyKey: `soft-pull-send:${link.id}`
  });

  const smsBody =
    `Hi ${firstNameRaw}, Fundhub soft-pull: (1) authorize ${approve.url} ` +
    `(2) pay total on that form (base ${amount}) ${link.checkout_url}`;
  let sms = null;
  try {
    sms = await composeAndSend(db, {
      orgId,
      staffId,
      clientId,
      channel: "sms",
      body: smsBody,
      idempotencyKey: `soft-pull-sms:${link.id}`
    });
  } catch {
    sms = { outcome: null, detail: "sms_failed" };
  }

  const sent = (await markSent(db, { id: link.id, orgId })) || link;
  await mergeCustomFields(db, clientId, {
    closer_deck_soft_pull_sent_at: new Date().toISOString(),
    closer_deck_soft_pull_link_id: link.id
  });

  return {
    link: jsonSafeLink(sent, { offer_key: "SOFT_PULL" }),
    approve_url: approve.url,
    approve_expires_at: approve.expiresAtIso,
    email: jsonSafeCompose(composed),
    sms: jsonSafeCompose(sms)
  };
}

function paymentPurpose(offer) {
  return offer.paymentPurpose || "custom";
}

/* F48, 2026-09-03. What arrived on the customer's phone was
 * "Hi Sim, Fundhub Capital Academy: pay $5,000 <link>" — no person, no reason,
 * no reference to the call it came out of. Read cold, beside a dollar amount
 * and a payment link, that is indistinguishable from a scam, which is what the
 * owner said when he received six copies of it.
 *
 * So the text now says who it is from, which conversation it belongs to, and
 * what to do if they are not ready — and it carries the same opt-out line every
 * other text in the system carries, word for word. Same single message, same
 * link, same amount: this changes what it says, not how often it is sent. The
 * button that sends it belongs to another lane and is untouched here.
 */
export function payLinkSmsBody({ firstName, description, amount, checkoutUrl }) {
  return (
    `Hi ${firstName}, it's Fundhub. Here's the ${description} payment link ` +
    `from your call — ${amount}: ${checkoutUrl}\n` +
    `Questions before you pay? Reply here and your advisor will answer. ` +
    `Reply STOP to opt out.`
  );
}

export async function sendDeckPayLink(db, {
  orgId, clientId, staffId, staffRole = null, offerKey,
  saleMotion = null, amountCents = undefined, provider = "commas", checkoutBaseUrl, env = process.env
}) {
  const offer = getOffer(offerKey);
  if (!offer) {
    throw new CloserDeckError("Unknown offer.", { status: 400, code: "unknown_offer" });
  }
  let resolvedAmountCents;
  try {
    resolvedAmountCents = resolveOfferAmountCents(offer.key, amountCents);
  } catch (err) {
    throw new CloserDeckError(err.message, { status: 400, code: "invalid_offer_amount" });
  }
  if (!new Set(["commas", "whop"]).has(provider) || (provider === "whop" && offer.key !== "UWIQ_DELIVERABLES")) {
    throw new CloserDeckError("Choose a supported payment provider for this offer.", { status: 400, code: "invalid_offer_provider" });
  }
  if (provider === "commas" && !checkoutBaseUrl && !checkoutConfig(env).ok) {
    throw new CloserDeckError(
      "Commas checkout is not configured — no checkout link can be built",
      { status: 503, code: "commas_not_configured" }
    );
  }
  const purpose = paymentPurpose(offer);
  const description = offer.name;
  /* Primary DFY / mastery offers are the main close — not downsell/upsell.
     Only alternate ladders need an explicit sale motion. */
  const primaryPayOffers = new Set(["SOFT_PULL", "FUNDING_DFY", "REPAIR_DFY", "REPAIR_TRIAL", "FUNDING_MASTERY"]);
  const isPrimaryPay = primaryPayOffers.has(offer.key);
  if (!isPrimaryPay && saleMotion !== "downsell" && saleMotion !== "upsell") {
    throw new CloserDeckError(
      "Choose downsell or upsell before creating this payment link.",
      { status: 400, code: "sale_motion_required" }
    );
  }
  let link;
  try {
    link = await createPaymentLink(db, {
      orgId,
      clientId,
      purpose,
      description,
      commasProductTitle: offer.commasProductTitle,
      amountCents: resolvedAmountCents,
      provider,
      createdByStaffId: staffId,
      createdByRole: staffRole,
      productCode: offer.productCode,
      saleMotion: isPrimaryPay ? null : saleMotion,
      checkoutBaseUrl,
      env
    });
  } catch (e) {
    throw new CloserDeckError(e.message || "Could not mint checkout link", {
      status: e.status || 502,
      code: e.code || "commas_checkout_failed"
    });
  }
  const first = await db.query(
    `SELECT first_name FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const firstName = first.rows[0]?.first_name || "there";
  const amount = formatCents(Number(link.amount_cents)) || formatPrice(link.amount_cents);
  const emailBody =
    `Hi ${firstName},\n\n` +
    `Here's the ${description} pay link from our call.\n\n` +
    `Pay ${amount} here:\n${link.checkout_url}\n\n` +
    `Stay on the Meet with your advisor if you have questions.\n\n` +
    `— Fundhub`;
  const composed = await composeAndSend(db, {
    orgId,
    staffId,
    clientId,
    channel: "email",
    subject: `${description} — ${amount}`,
    body: emailBody,
    idempotencyKey: `pay-link-send:${link.id}`
  });
  let sms = null;
  try {
    sms = jsonSafeCompose(await composeAndSend(db, {
      orgId,
      staffId,
      clientId,
      channel: "sms",
      body: payLinkSmsBody({
        firstName, description, amount, checkoutUrl: link.checkout_url
      }),
      idempotencyKey: `pay-link-sms:${link.id}`
    }));
  } catch {
    sms = { outcome: null, detail: "sms_failed" };
  }
  const sent = (await markSent(db, { id: link.id, orgId })) || link;
  return {
    link: jsonSafeLink(sent, { offer_key: offer.key }),
    sms,
    email: jsonSafeCompose(composed)
  };
}

export async function generateDeckLetters(db, {
  orgId, clientId, staffId, offerKey, edu = false, forceRepair = false, tier = null, store = null
}) {
  const offer = getOffer(offerKey);
  if (!offer) {
    throw new CloserDeckError("Unknown offer.", { status: 400, code: "unknown_offer" });
  }
  const fundingRoute = isFundingPath(tier) && !forceRepair && !edu && offerKey === "FUNDING_DFY";
  if (fundingRoute || !offerAllowsLetters(offerKey)) {
    throw new CloserDeckError(
      "Letters do not fire on the qualified funding route.",
      { status: 409, code: "letters_blocked_funding_route" }
    );
  }
  /* ═══════════════════════════════════════════════════════════════════════════
     F41 — THE BUTTON SENDS THE PACK IT SAYS IT SENDS

     The screen shows two different buttons through this one action, and until
     2026-09-04 both asked for the REPAIR pack:

       "Send deliverables package now"  — education path (present.js:897, edu)
       "Generate letters and email now" — everything else (present.js:916)

     For an academy or funding client the repair pack is zero files: there is
     nothing to dispute on a clean file, correctly. The button still emailed
     "your correction letters are ready", still told the presenter "Deliverables
     sent to client", and still stamped diy_status = "Delivery Failed — Retry" on
     the client. Three surfaces, three different stories, and nothing delivered.

     Now the education path asks for the FUNDING pack — the five UnderwriteIQ
     documents that ARE the deliverables package — saves them with the same saver
     C-06 uses, and sends the already-seeded funding delivery email that names
     those five documents (EMAIL-U02-ANALYZER-FUNDING-DELIVERY,
     db/seed/009_u02_funding_delivery_template.sql). The repair path is unchanged.

     AND NOTHING IS SENT WHEN NOTHING WAS BUILT. An empty pack now sends no
     email, adds no tag, and returns the reason the pack was empty. Telling a
     client their documents are ready when no document exists is the defect.
     ═══════════════════════════════════════════════════════════════════════════ */
  const wantsDeliverables = !!edu;
  const pack = await buildLetterPackForClient(db, {
    clientId,
    pack: wantsDeliverables ? "funding" : "repair"
  });
  const files = pack.files || [];
  // THE BYTES ARE THE DELIVERABLE. This action used to build the pack, count the
  // files, email the client that their letters were ready, and never save a
  // single PDF. Same registry and same helper the DS-02 workflow uses.
  // A storage failure must not lose the call outcome, so it is recorded, not thrown.
  let persisted = { stored: [], skipped: "not_attempted" };
  if (files.length) {
    try {
      persisted = wantsDeliverables
        ? await persistFundingLetterFiles(db, store || storeFromEnv(), {
          orgId,
          clientId,
          files,
          generatedBy: "closer-deck",
          sourceEventId: `closer-deck-deliverables:${clientId}:${offerKey}`
        })
        : await persistDiyPackageFiles(db, store || storeFromEnv(), {
          orgId,
          clientId,
          files,
          generatedBy: "closer-deck",
          sourceEventId: `closer-deck-letters:${clientId}:${offerKey}`,
          pack: "repair_letter_pack"
        });
    } catch (err) {
      persisted = { stored: [], skipped: String(err && err.message || err).slice(0, 240) };
    }
  }
  const delivered = files.length > 0 && persisted.stored.length > 0;
  let email = null;
  if (delivered) {
    const emailQueued = await sendTemplated(db, {
      orgId,
      clientId,
      channel: "email",
      templateKey: wantsDeliverables ? DELIVERABLES_EMAIL_TEMPLATE_KEY : EMAIL_TEMPLATE_KEY,
      eventId: `closer-deck-letters:${clientId}:${offerKey}`,
      staffId
    });
    email = await dispatchQueued(db, emailQueued);
    await addTags(db, clientId, [wantsDeliverables ? "client:deliverables" : "client:diy-letters"]);
  }
  await mergeCustomFields(db, clientId, {
    diy_status: delivered ? "Delivered" : "Delivery Failed — Retry",
    closer_deck_letters_at: new Date().toISOString(),
    closer_deck_letters_offer: offerKey
  });
  return {
    delivered,
    pack: wantsDeliverables ? "deliverables" : "repair",
    letterCount: files.length,
    documentsStored: persisted.stored.length,
    persistSkipped: persisted.skipped,
    /* Why nothing went out, in the words the pack itself used. Null when it did.
       The screen prints this, so a presenter is never told "sent" over silence. */
    reason: delivered ? null : (pack.reason || pack.engineSkip || persisted.skipped || "empty_pack"),
    engineSkip: pack.engineSkip || null,
    email
  };
}

function outcomeForOffer(offerKey) {
  return offerKey === "FUNDING_DFY" ? "deposit" : "downsell";
}

export async function logDeckDisposition(db, {
  orgId, clientId, staffId, offerKey, route, temperature, beliefsCount, costOfInaction, taskId,
  repairReferral = false, paymentLinkId = null
}) {
  const offer = getOffer(offerKey);
  if (!offer) {
    throw new CloserDeckError("Unknown offer.", { status: 400, code: "unknown_offer" });
  }
  const notes = JSON.stringify({
    closer_deck: {
      route: route || null,
      offer_key: offer.key,
      amount_cents: offer.priceCents,
      temperature: temperature == null ? null : Number(temperature) || 0,
      beliefs_count: beliefsCount == null ? null : Number(beliefsCount) || 0,
      cost_of_inaction: costOfInaction == null || costOfInaction === "" ? null : String(costOfInaction).slice(0, 80)
    }
  });
  const transactionId = await paidTransactionForLink(db, {
    orgId, clientId, staffId, paymentLinkId, productCode: offer.productCode
  });
  const result = await logCallOutcome(db, {
    orgId,
    clientId,
    staffId,
    taskId: taskId || null,
    outcome: outcomeForOffer(offer.key),
    transactionId,
    notes,
    offerKey: offer.key,
    repairReferral: repairReferral === true
  });
  await mergeCustomFields(db, clientId, {
    closer_deck_disposition: {
      route: route || null,
      offer_key: offer.key,
      amount_cents: offer.priceCents,
      temperature: temperature == null ? null : Number(temperature) || 0,
      beliefs_count: beliefsCount == null ? null : Number(beliefsCount) || 0,
      cost_of_inaction: costOfInaction == null || costOfInaction === "" ? null : String(costOfInaction).slice(0, 80),
      at: new Date().toISOString()
    }
  });
  return result;
}
