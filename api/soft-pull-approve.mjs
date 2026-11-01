// /api/soft-pull-approve — client-facing soft-pull approval (signed link).
//
//   GET  ?org=&client=&exp=&sig=  → disclosure + pricing + contact
//   POST { …identity, businesses[] } → consent + identity + businesses + checkout
//
// COMPLIANCE REVIEW REQUIRED — consent capture, fee timing, credit-pull identity (SSN).
// The consent TEXT is never taken from the body — only the version key, then
// the server copies its own words (same rule as api/consent/capture.mjs).
//
// Flow (owner 2026-08-25): form collects optional businesses first (safety
// ceiling 20); total = $32 + $10×n; checkout is minted/adjusted to that total
// before pay. EIN and incorporation date (month/year) are required on each
// added business; extra owner is optional. Age months are stored on the row.
// Live CRS / Experian Business in this repo does not return that date.

import { db, pool } from "../src/db.mjs";
import { isUuid, ROLE_SETS, requireRole } from "../src/http/read-api.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requirePrincipal, resolvePrincipal } from "../src/http/middleware/requirePrincipal.mjs";
import { AUTH_UNAVAILABLE } from "../src/http/middleware/requireAuth.mjs";
import { requireClientInOrg } from "../src/http/client-scope.mjs";
import { requireSessionOrg } from "../src/http/session-org.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { verifySoftPullApproveToken } from "../src/consent/approve-token.mjs";
import {
  CURRENT_SOFT_PULL_VERSION,
  SOFT_PULL_DISCLOSURES
} from "../src/consent/disclosures.mjs";
import {
  captureConsent,
  consentStatus,
  ConsentError
} from "../src/consent/index.mjs";
import { storeIdentity, PiiError } from "../src/pii/index.mjs";
import { getOffer, formatCents } from "../src/config/offers.mjs";
import {
  softPullTotalCents,
  softPullPricingPublic,
  SOFT_PULL_MAX_BUSINESSES
} from "../src/finance/soft-pull-pricing.mjs";
import {
  createPaymentLink,
  markExpired,
  markSent
} from "../src/payment-links/index.mjs";
import {
  ageMonthsFromIncorporated,
  normalizeSoftPullEin,
  parseIncorporatedDate
} from "../src/slo/businesses.mjs";
import { paidDiagnosticEventForClient, resumePaidDiagnosticSoftPull } from "../src/handlers/diagnostic-soft-pull.mjs";
import { isSampleResult } from "../src/http/client-detail.mjs";

const KIND = "soft_pull_consent";
const BIZ_SOURCE = "soft_pull_approve";
const OPEN = ["created", "sent"];

// Client-safe progress for the same authorized form. Payment alone is never a
// completed pull, and a sample report is never a client result.
export async function clientPullProgress(database, { orgId, clientId }) {
  const [requests, results] = await Promise.all([
    database.query(
      `SELECT id, status, requested_at, crs_result_id
         FROM soft_pull_requests
        WHERE org_id = $1 AND client_id = $2
        ORDER BY requested_at DESC LIMIT 1`,
      [orgId, clientId]
    ),
    database.query(
      `SELECT id, created_at, result, is_demo
         FROM crs_results
        WHERE org_id = $1 AND client_id = $2
        ORDER BY created_at DESC LIMIT 1`,
      [orgId, clientId]
    )
  ]);
  const request = requests.rows[0] || null;
  const result = results.rows[0] || null;
  const real = result && result.is_demo !== true && !isSampleResult(result.result);
  const current = real && (!request || request.crs_result_id === result.id ||
    (request.requested_at && result.created_at &&
      new Date(result.created_at) >= new Date(request.requested_at)));
  if (current) return { status: "complete", result_ready: true };
  const status = String(request?.status || "").toLowerCase();
  if (["failed", "cancelled", "canceled"].includes(status)) {
    return { status: "failed", result_ready: false };
  }
  if (["processing", "in_progress", "running", "complete", "completed", "fulfilled", "resolved"].includes(status)) {
    return { status: "processing", result_ready: false };
  }
  if (request) return { status: "queued", result_ready: false };
  return { status: "not_started", result_ready: false };
}

function clientIp(req) {
  const xf = req.headers?.["x-forwarded-for"];
  if (xf) return String(xf).split(",")[0].trim();
  return req.headers?.["x-real-ip"] || null;
}

function tokenFrom(req) {
  const q = req.query || {};
  const body = req.body || {};
  return {
    orgId: q.org || body.org || null,
    clientId: q.client || body.client || null,
    exp: q.exp || body.exp || null,
    sig: q.sig || body.sig || null
  };
}

/* normalizeSoftPullEin, parseIncorporatedDate and ageMonthsFromIncorporated
   moved to src/slo/businesses.mjs so the $297 pull form can share them
   (src/ does not import from api/). Re-exported here unchanged. */
export { normalizeSoftPullEin, parseIncorporatedDate, ageMonthsFromIncorporated };

/** Parse 0–20 businesses: name + street + city + state + ZIP + EIN + incorporated date; extra owner optional. */
export function parseSoftPullBusinesses(raw) {
  if (raw == null || raw === "") return [];
  if (!Array.isArray(raw)) {
    const err = new ConsentError("Businesses must be a list.", {
      status: 400,
      code: "businesses_invalid"
    });
    throw err;
  }
  if (raw.length > SOFT_PULL_MAX_BUSINESSES) {
    throw new ConsentError("That's too many businesses for this form.", {
      status: 400,
      code: "businesses_max"
    });
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] || {};
    const name = String(row.name || "").trim();
    const line1 = String(row.address_line1 || "").trim();
    const city = String(row.city || "").trim();
    const state = String(row.state || "").trim().toUpperCase();
    const postal = String(row.postal_code || "").trim();
    const extraOwner = String(row.extra_owner_name || "").trim();
    const ein = normalizeSoftPullEin(row.ein);
    const incorporated = parseIncorporatedDate(row.incorporated_date);
    if (!name && !line1 && !city && !state && !postal && !row.ein && !extraOwner && !row.incorporated_date) continue;
    if (!name || name.length < 2) {
      throw new ConsentError(`Business ${i + 1}: enter the business name.`, {
        status: 400,
        code: "business_name_required"
      });
    }
    if (!line1 || !city || !/^[A-Z]{2}$/.test(state) || !postal) {
      throw new ConsentError(
        `Business ${i + 1}: enter street, city, state, and ZIP.`,
        { status: 400, code: "business_address_required" }
      );
    }
    if (!ein) {
      throw new ConsentError(
        `Business ${i + 1}: enter the 9-digit EIN.`,
        { status: 400, code: "business_ein_required" }
      );
    }
    if (!incorporated) {
      throw new ConsentError(
        `Business ${i + 1}: enter when this business was incorporated (month and year).`,
        { status: 400, code: "business_incorporated_required" }
      );
    }
    const ageMonths = ageMonthsFromIncorporated(incorporated);
    if (ageMonths == null) {
      throw new ConsentError(
        `Business ${i + 1}: the incorporation date cannot be in the future.`,
        { status: 400, code: "business_incorporated_invalid" }
      );
    }
    out.push({
      name,
      address_line1: line1,
      city,
      state,
      postal_code: postal,
      ein,
      extra_owner_name: extraOwner || null,
      incorporated_date: incorporated,
      age_months: ageMonths
    });
  }
  return out;
}

/** Save month/year on one company already on the client's file. */
export async function stampBusinessIncorporated(database, {
  orgId,
  clientId,
  businessName,
  incorporatedDate,
  now = new Date()
} = {}) {
  const name = String(businessName || "").trim();
  if (!name) {
    throw new ConsentError("Pick a business on this file.", {
      status: 400,
      code: "business_name_required"
    });
  }
  const incorporated = parseIncorporatedDate(incorporatedDate);
  if (!incorporated) {
    throw new ConsentError("Enter when this business was incorporated (month and year).", {
      status: 400,
      code: "business_incorporated_required"
    });
  }
  const ageMonths = ageMonthsFromIncorporated(incorporated, now);
  if (ageMonths == null) {
    throw new ConsentError("The incorporation date cannot be in the future.", {
      status: 400,
      code: "business_incorporated_invalid"
    });
  }
  const result = await database.query(
    `UPDATE businesses
        SET age_months = $4,
            entity_data = jsonb_set(
              COALESCE(entity_data, '{}'::jsonb),
              '{incorporated_date}',
              to_jsonb($5::text),
              true
            )
      WHERE org_id = $1 AND client_id = $2 AND name = $3
      RETURNING id, name, age_months, entity_data->>'incorporated_date' AS incorporated_date`,
    [orgId, clientId, name, ageMonths, incorporated]
  );
  if (!result.rows[0]) {
    throw new ConsentError("That business is not on this file.", {
      status: 404,
      code: "business_not_found"
    });
  }
  return {
    name: result.rows[0].name,
    incorporated_date: result.rows[0].incorporated_date || incorporated,
    age_months: Number(result.rows[0].age_months)
  };
}

async function stampIncorporatedAsStaff(req, res, { database, requireAuth: auth, now }) {
  const staff = await auth(req, res, { db: database });
  if (!staff) return;
  if (!requireRole(res, staff, ROLE_SETS.STAFF)) return;
  const orgId = requireSessionOrg(res, staff);
  if (!orgId) return;

  const clientId = String(req.body?.client_id || "").trim();
  if (!isUuid(clientId)) {
    return res.status(400).json({
      ok: false,
      error: "client_id_required",
      message: "Open a client file first."
    });
  }
  if (!await requireClientInOrg(res, database, staff, clientId)) return;

  try {
    const business = await stampBusinessIncorporated(database, {
      orgId,
      clientId,
      businessName: req.body?.business_name,
      incorporatedDate: req.body?.incorporated_date,
      now
    });
    return res.status(200).json({ ok: true, business });
  } catch (err) {
    if (err instanceof ConsentError) {
      return res.status(err.status || 400).json({
        ok: false,
        error: err.code || "bad_request",
        message: err.message
      });
    }
    return dbDown(res, err);
  }
}

export async function replaceSoftPullBusinesses(database, { orgId, clientId, businesses }) {
  // A partial replacement must never erase the customer's existing companies.
  // The live db export is a pool.query wrapper; BEGIN on that wrapper would run
  // on unrelated connections, so obtain one pinned connection for every write.
  // A supplied Pool can be used as well; injected query-only test doubles keep
  // their existing contract, while production always uses the pinned pool.
  const transactionalPool = database === db ? pool()
    : (database && typeof database.connect === "function"
       && typeof database.release !== "function" ? database : null);
  const connection = transactionalPool ? await transactionalPool.connect() : null;
  const writer = connection || database;
  let transactionStarted = false;
  try {
    if (connection) {
      await writer.query("BEGIN");
      transactionStarted = true;
      // Serialize replacements on this exact buyer to avoid interleaved
      // DELETE+INSERT sequences from simultaneous portal submissions.
      const owned = await writer.query(
        `SELECT id FROM clients WHERE id = $1 AND org_id = $2 FOR UPDATE`,
        [clientId, orgId]
      );
      if (!owned.rows[0]) {
        throw new ConsentError("This contact was not found.", {
          status: 404, code: "not_found"
        });
      }
    }
    await writer.query(
      `DELETE FROM businesses
        WHERE org_id = $1 AND client_id = $2
          AND COALESCE(entity_data->>'source', '') = $3`,
      [orgId, clientId, BIZ_SOURCE]
    );
    for (const b of businesses) {
      await writer.query(
        `INSERT INTO businesses (org_id, client_id, name, age_months, entity_data)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          orgId, clientId, b.name, b.age_months,
          JSON.stringify({
            source: BIZ_SOURCE,
            address_line1: b.address_line1,
            city: b.city,
            state: b.state,
            postal_code: b.postal_code,
            ein: b.ein,
            extra_owner_name: b.extra_owner_name || null,
            incorporated_date: b.incorporated_date || null
          })
        ]
      );
    }
    if (connection) await writer.query("COMMIT");
  } catch (error) {
    if (transactionStarted) {
      try { await writer.query("ROLLBACK"); }
      catch { /* the original failure takes priority */ }
    }
    throw error;
  } finally {
    connection?.release();
  }
}

/**
 * Reuse an open diagnostic link at the exact total, or expire wrong-amount
 * open diagnostic links and mint a new one.
 */
export async function ensureSoftPullCheckout(database, {
  orgId, clientId, amountCents, description, env, checkoutBaseUrl, fetchImpl
}) {
  // A paid diagnostic is never replaced by another checkout from this form.
  const paid = await database.query(
    `SELECT * FROM payment_links
      WHERE org_id = $1 AND client_id = $2 AND purpose = 'diagnostic'
        AND status = 'paid'
      ORDER BY paid_at DESC NULLS LAST, created_at DESC
      LIMIT 1`,
    [orgId, clientId]
  );
  if (paid.rows[0]) return paid.rows[0];

  const existing = await database.query(
    `SELECT * FROM payment_links
      WHERE org_id = $1 AND client_id = $2 AND purpose = 'diagnostic'
        AND status = ANY($3) AND amount_cents = $4
      ORDER BY created_at DESC
      LIMIT 1`,
    [orgId, clientId, OPEN, amountCents]
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.status === "created") {
      const sent = await markSent(database, { id: row.id, orgId });
      return sent || row;
    }
    return row;
  }

  const wrong = await database.query(
    `SELECT id FROM payment_links
      WHERE org_id = $1 AND client_id = $2 AND purpose = 'diagnostic'
        AND status = ANY($3) AND amount_cents <> $4`,
    [orgId, clientId, OPEN, amountCents]
  );
  for (const row of wrong.rows) {
    await markExpired(database, { id: row.id, orgId });
  }

  const offer = getOffer("SOFT_PULL");
  const link = await createPaymentLink(database, {
    orgId,
    clientId,
    purpose: "diagnostic",
    description: description || offer?.name || "UnderwriteIQ soft-pull assessment",
    commasProductTitle: offer?.commasProductTitle || "Consulting Services Assessment",
    amountCents,
    productCode: offer?.productCode || "diagnostic",
    checkoutBaseUrl,
    env,
    fetchImpl
  });
  const sent = await markSent(database, { id: link.id, orgId });
  return sent || link;
}

export default async function handler(req, res, deps = {}) {
  const database = deps.db ?? db;
  const env = deps.env ?? process.env;

  if (req.method === "POST" && String((req.body || {}).action || "") === "stamp_incorporated") {
    return stampIncorporatedAsStaff(req, res, {
      database,
      requireAuth: deps.requireAuth ?? requireAuth,
      now: deps.now ? new Date(deps.now()) : new Date()
    });
  }

  try {
    let portalPrincipal = null;
    let orgId;
    let clientId;
    if (String(req.query?.portal || "") === "1") {
      portalPrincipal = await (deps.requirePrincipal ?? requirePrincipal)(req, res, ["client"], { db: database, env });
      if (!portalPrincipal) return;
      orgId = portalPrincipal.orgId;
      clientId = portalPrincipal.clientId;
      if (!isUuid(orgId) || !isUuid(clientId) || !portalPrincipal.accountId) {
        return res.status(403).json({ ok: false, error: "client_account_required" });
      }
    } else {
      const raw = tokenFrom(req);
      if (!isUuid(raw.orgId) || !isUuid(raw.clientId)) {
        return res.status(400).json({ ok: false, error: "bad_token", message: "This link is missing required fields." });
      }
      const verified = verifySoftPullApproveToken({
        orgId: String(raw.orgId).trim(),
        clientId: String(raw.clientId).trim(),
        exp: raw.exp,
        sig: raw.sig,
        secret: deps.secret,
        now: deps.now
      });
      if (!verified) {
        return res.status(401).json({
          ok: false,
          error: "invalid_or_expired",
          message: "This approval link is invalid or has expired. Ask your advisor to send a new one."
        });
      }
      ({ orgId, clientId } = verified);
    }

    const clientRes = await database.query(
      `SELECT id, first_name, last_name, email
         FROM clients WHERE id = $1 AND org_id = $2`,
      [clientId, orgId]
    );
    const client = clientRes.rows[0];
    if (!client) {
      return res.status(404).json({ ok: false, error: "not_found", message: "This contact was not found." });
    }

    if (!portalPrincipal) {
      const principal = await (deps.resolvePrincipal ?? resolvePrincipal)(req, { db: database, env });
      if (principal === AUTH_UNAVAILABLE) {
        return res.status(503).json({ ok: false, error: "auth_unavailable", db: "down" });
      }
      if (principal?.kind !== "client" || principal.orgId !== orgId || principal.clientId !== clientId || !principal.accountId) {
        return res.status(401).json({
          ok: false,
          error: "account_required",
          message: "Set up or sign in to your Fundhub portal to continue.",
          create_account_url: "/portal-login.html?mode=claim"
        });
      }
      portalPrincipal = principal;
    }

    const disclosure = SOFT_PULL_DISCLOSURES[CURRENT_SOFT_PULL_VERSION];
    const status = await consentStatus(database, { orgId, clientId, kind: KIND });
    const pricing = softPullPricingPublic();

    if (req.method === "GET") {
      const [paidEvent, pull] = await Promise.all([paidDiagnosticEventForClient(database, {
        orgId, clientId, amountCents: softPullTotalCents(0)
      }), clientPullProgress(database, { orgId, clientId })]);
      const paidLink = await database.query(
        `SELECT id FROM payment_links
          WHERE org_id = $1 AND client_id = $2 AND purpose = 'diagnostic'
            AND status = 'paid'
          LIMIT 1`,
        [orgId, clientId]
      );
      return res.status(200).json({
        ok: true,
        kind: KIND,
        version: CURRENT_SOFT_PULL_VERSION,
        disclosure: {
          version: disclosure.version,
          text: disclosure.text,
          bullets: disclosure.bullets || null
        },
        consent: { valid: !!status.valid, reason: status.reason || null },
        paid: !!paidEvent || paidLink.rows.length > 0,
        pull,
        pricing,
        contact: {
          first_name: client.first_name || null,
          last_name: client.last_name || null
        }
      });
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      return res.status(405).json({ ok: false, error: "method_not_allowed" });
    }

    const body = req.body || {};
    const grantedName = String(body.granted_name || "").trim();
    if (!grantedName || grantedName.length < 2) {
      return res.status(400).json({
        ok: false,
        error: "name_required",
        message: "Type your full legal name to approve the soft pull."
      });
    }

    const ssn = String(body.ssn || "").replace(/\D/g, "");
    if (ssn.length !== 9) {
      return res.status(400).json({
        ok: false,
        error: "ssn_required",
        message: "Enter a valid 9-digit Social Security number."
      });
    }

    const dob = String(body.dob || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      return res.status(400).json({
        ok: false,
        error: "dob_required",
        message: "Enter your date of birth as YYYY-MM-DD."
      });
    }

    const line1 = String(body.address_line1 || "").trim();
    const city = String(body.city || "").trim();
    const state = String(body.state || "").trim().toUpperCase();
    const postal = String(body.postal_code || "").trim();
    if (!line1 || !city || !/^[A-Z]{2}$/.test(state) || !postal) {
      return res.status(400).json({
        ok: false,
        error: "address_required",
        message: "Enter your current street address, city, state, and ZIP."
      });
    }

    let businesses;
    try {
      businesses = parseSoftPullBusinesses(body.businesses);
    } catch (e) {
      if (e instanceof ConsentError) {
        return res.status(e.status || 400).json({
          ok: false,
          error: e.code || "bad_request",
          message: e.message
        });
      }
      throw e;
    }

    const amountCents = softPullTotalCents(businesses.length);
    const amountDisplay = formatCents(amountCents) || `$${(amountCents / 100).toFixed(0)}`;
    const offer = getOffer("SOFT_PULL");
    const n = businesses.length;
    const description = n > 0
      ? `${offer?.name || "UnderwriteIQ soft-pull assessment"} (+${n} business${n === 1 ? "" : "es"})`
      : (offer?.name || "UnderwriteIQ soft-pull assessment");

    const accountId = portalPrincipal.accountId;

    await storeIdentity(database, {
      orgId,
      clientId,
      ssn,
      dob,
      addresses: [{
        addressLine1: line1,
        city,
        state,
        postalCode: postal
      }],
      env
    });

    await replaceSoftPullBusinesses(database, { orgId, clientId, businesses });

    const portalLink = { sent: false, reason: "already_signed_in" };

    const consent = await captureConsent(database, {
      orgId,
      clientId,
      kind: KIND,
      consentText: disclosure.text,
      consentVersion: CURRENT_SOFT_PULL_VERSION,
      captureMethod: "typed",
      grantedName,
      grantedBy: { kind: "client", id: accountId },
      capturedIp: clientIp(req),
      capturedUserAgent: req.headers?.["user-agent"] || null
    });

    // Payment and consent can happen in either order. A payment event is only
    // accepted from the verified Commas webhook; replay its original ID so a
    // paid client gets exactly one pull after authorization is saved.
    let paidResult = { paid: false, pull: null };
    let pullError = null;
    try {
      paidResult = await resumePaidDiagnosticSoftPull(database, {
        orgId, clientId, amountCents, env,
        runPaidPull: deps.runPaidPull
      });
      pullError = paidResult.error || null;
    } catch (err) {
      pullError = String(err?.message || err).slice(0, 160);
    }

    // A previous paid diagnostic must not trigger an automatic extra charge,
    // but a changed business count must not be shown as already fully paid.
    let paymentReviewRequired = paidResult.reason === "paid_amount_mismatch";
    let checkout = null;
    let checkoutError = null;
    try {
      if (!paidResult.paid) {
        const link = await ensureSoftPullCheckout(database, {
          orgId,
          clientId,
          amountCents,
          description,
          env,
          checkoutBaseUrl: deps.checkoutBaseUrl,
          fetchImpl: deps.fetchImpl
        });
        if (link.status === "paid") {
          paidResult.paid = true;
          if (Number(link.amount_cents) !== amountCents) paymentReviewRequired = true;
        } else checkout = {
          id: link.id, checkout_url: link.checkout_url,
          amount_cents: Number(link.amount_cents),
          amount_display: formatCents(link.amount_cents) || amountDisplay
        };
      }
    } catch (err) {
      checkoutError = String(err && err.message ? err.message : err).slice(0, 160);
    }

    return res.status(201).json({
      ok: true,
      consent: { id: consent.id, valid: true, version: CURRENT_SOFT_PULL_VERSION },
      businesses: { count: n },
      pricing: { ...pricing, total_cents: amountCents, total_display: amountDisplay },
      paid: paidResult.paid,
      payment_review_required: paymentReviewRequired,
      pull: paidResult.pull,
      pull_reason: paidResult.reason || paidResult.pull?.reason || null,
      pull_error: pullError,
      checkout,
      checkout_error: checkoutError,
      // Whether the sign-in email was queued. Never the link itself: this reply
      // goes to a browser on a public signed link, and a portal token in it
      // would be a second credential sitting in a response body.
      portal_link: portalLink,
      next: paymentReviewRequired
        ? "Your earlier payment does not cover the updated assessment total. No additional charge or new credit pull was started. Contact your advisor to review the difference."
        : paidResult.paid
        ? (paidResult.pull?.pulled
          ? "Payment and consent are complete. Your credit report is being prepared."
          : "Your payment is saved. The credit pull has not completed; your advisor can check its status.")
        : checkout?.checkout_url
          ? `Pay ${amountDisplay} next — use the Pay button below.`
          : `Consent saved. Ask your advisor for the ${amountDisplay} pay link.`
    });
  } catch (err) {
    if (err instanceof ConsentError || err instanceof PiiError) {
      return res.status(err.status || 400).json({
        ok: false,
        error: err.code || "bad_request",
        message: err.message
      });
    }
    return dbDown(res, err);
  }
}
