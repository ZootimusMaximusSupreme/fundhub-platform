// src/payment-links/index.mjs — staff-initiated Commas checkout links.
//
// A payment_links row (119_payment_links.sql) is the ASK: a member of staff
// requested money from a named client for a named reason. It is distinct from
// `invoices` (money owed on the AR ladder) and from `transactions` (money
// actually received, written by src/handlers/client-lifecycle.mjs off
// payment.received). This module only ever moves a link through
// created -> sent -> paid, or -> expired / void. It never writes a
// transaction and never charges anyone — the link is a URL a client visits to
// pay Commas directly.
import crypto from "node:crypto";
import { pool } from "../db.mjs";
import { buildCommasCheckoutUrl } from "../adapters/commas.mjs";
import { createCheckoutSession, checkoutConfig } from "../payments/commas-api.mjs";
import { commasProductTitleFor } from "../config/offers.mjs";
import { assertCommasSafeCopy } from "../payments/commas-safe-copy.mjs";
import { createWhopBlueprintPaymentLink } from "../payments/whop-blueprint.mjs";
import { assertBlueprintAgreementPrice } from "../contracts/blueprint-price.mjs";
import { resolveOfferAmountCents } from "../config/offers.mjs";

const PURPOSES = new Set(["deposit", "diagnostic", "repair", "custom"]);
const SALE_MOTIONS = new Set(["downsell", "upsell"]);
const OPEN_STATUSES = ["created", "sent"];

// Supavisor uses transaction pooling: a session advisory lock can land on a
// different backend at unlock. Lock the actual invoice row in a bounded
// transaction, then recheck, mint, and save on that same checked-out client.
const INVOICE_CHECKOUT_TIMEOUT_MS = 5000;
async function withInvoiceCheckoutLock(db, orgId, clientId, invoiceId, work) {
  const conn = typeof db.connect === "function" ? await db.connect() : await pool().connect();
  let inTransaction = false;
  let discard = false;
  try {
    await conn.query("BEGIN");
    inTransaction = true;
    const invoice = (await conn.query(
      `SELECT id FROM invoices
        WHERE id = $1 AND org_id = $2 AND client_id = $3
        FOR UPDATE`,
      [invoiceId, orgId, clientId]
    )).rows[0];
    if (!invoice) throw new Error(`Invoice ${invoiceId} is not owned by this client and org`);
    const result = await work(conn);
    await conn.query("COMMIT");
    inTransaction = false;
    return result;
  } catch (err) {
    if (inTransaction) {
      try { await conn.query("ROLLBACK"); } catch { discard = true; }
    } else {
      discard = true;
    }
    throw err;
  } finally {
    conn.release(discard);
  }
}

export function generateLinkRef() {
  return `pl_${crypto.randomBytes(12).toString("hex")}`;
}

/* resolveLinkContext — the product, sale and staff a link belongs to.
 *
 * A PARTNER ADD-ON LINK HAS NO CLIENT, so every client-scoped lookup below is
 * guarded on `clientId` rather than run with a NULL that would quietly match
 * nothing. `sales.client_id` and `call_outcomes.client_id` are both NOT NULL,
 * so those three queries can only ever return zero rows for a partner — the
 * guard makes that a decision instead of an accident, and saves three round
 * trips on every partner purchase. Product resolution is org-scoped and runs
 * for both, because a partner add-on IS a products row (271). */
export async function resolveLinkContext(db, {
  orgId,
  clientId,
  productId = null,
  productCode = null,
  saleId = null,
  saleMotion = null,
  createdByStaffId = null,
  createdByRole = null
}) {
  let product = null;
  if (productId || productCode) {
    const result = await db.query(
      `SELECT id, code
         FROM products
        WHERE org_id = $1
          AND (($2::uuid IS NOT NULL AND id = $2) OR ($3::text IS NOT NULL AND lower(code) = lower($3)))
        ORDER BY CASE WHEN id = $2 THEN 0 ELSE 1 END
        LIMIT 1`,
      [orgId, productId, productCode]
    );
    product = result.rows[0] || null;
    if (!product) throw new TypeError("createPaymentLink: product identity is not in this org");
    if (productId && productCode && String(product.code).toLowerCase() !== String(productCode).toLowerCase()) {
      throw new TypeError("createPaymentLink: product id and code do not match");
    }
  }
  let sale = null;
  if (saleId && !clientId) {
    throw new TypeError("createPaymentLink: a partner link cannot carry a sale — a sale belongs to a client");
  }
  if (saleId) {
    const result = await db.query(
      `SELECT s.id, s.product_id, s.sale_motion, p.code AS product_code
         FROM sales s
         JOIN products p ON p.id = s.product_id
        WHERE s.id = $1 AND s.org_id = $2 AND s.client_id = $3
        LIMIT 1`,
      [saleId, orgId, clientId]
    );
    sale = result.rows[0] || null;
    if (!sale) throw new TypeError("createPaymentLink: sale is not for this client and org");
    if (product && String(sale.product_id) !== String(product.id)) {
      throw new TypeError("createPaymentLink: sale and product identity do not match");
    }
    if (saleMotion != null && sale.sale_motion !== saleMotion) {
      throw new TypeError("createPaymentLink: sale and sale motion do not match");
    }
  } else if (product && clientId) {
    sale = (await db.query(
      `SELECT id, product_id
         FROM sales
        WHERE org_id = $1 AND client_id = $2 AND product_id = $3
          AND status = 'active'
          AND sale_motion IS NOT DISTINCT FROM $4::text
        ORDER BY sold_at DESC
        LIMIT 1`,
      [orgId, clientId, product.id, saleMotion]
    )).rows[0] || null;
  }
  if (saleMotion && !product && !sale) {
    throw new TypeError("createPaymentLink: downsell/upsell links require product identity");
  }

  let closerStaffId = createdByRole === "closer" ? createdByStaffId : null;
  let salesManagerStaffId = createdByRole === "sales_manager" ? createdByStaffId : null;

  if (sale) {
    const attrs = (await db.query(
      `SELECT staff_id, role
         FROM sale_attributions
        WHERE sale_id = $1 AND role IN ('closer', 'sales_manager')
        ORDER BY attributed_at DESC`,
      [sale.id]
    )).rows;
    closerStaffId ||= attrs.find((row) => row.role === "closer")?.staff_id || null;
    salesManagerStaffId ||= attrs.find((row) => row.role === "sales_manager")?.staff_id || null;
  }

  if (clientId && (product || sale) && (!closerStaffId || !salesManagerStaffId)) {
    const recentActors = (await db.query(
      `SELECT DISTINCT ON (s.role) s.id AS staff_id, s.role
         FROM call_outcomes co
         JOIN staff s ON s.id = co.staff_id AND s.org_id = co.org_id
        WHERE co.org_id = $1
          AND co.client_id = $2
          AND co.logged_at >= now() - interval '24 hours'
          AND s.role IN ('closer', 'sales_manager')
          AND s.status = 'active'
        ORDER BY s.role, co.logged_at DESC`,
      [orgId, clientId]
    )).rows;
    closerStaffId ||= recentActors.find((row) => row.role === "closer")?.staff_id || null;
    salesManagerStaffId ||= recentActors.find((row) => row.role === "sales_manager")?.staff_id || null;
  }

  return {
    productId: product?.id || sale?.product_id || null,
    productCode: product?.code || sale?.product_code || null,
    saleId: sale?.id || null,
    closerStaffId,
    salesManagerStaffId
  };
}

/** createPaymentLink — mints a checkout URL and records the ask.
 *  Prefer FANBASIS_CHECKOUT_API_KEY → live checkout-session API.
 *  Fall back to COMMAS_CHECKOUT_BASE_URL query links only for tests / legacy. */
export async function createPaymentLink(db, {
  orgId, clientId = null, partnerId = null, purpose, description = null, amountCents,
  currency = "USD", createdByStaffId = null, createdByRole = null,
  productId = null, productCode = null, saleId = null, saleMotion = null,
  invoiceId = null, fundingRoundId = null,
  commasProductTitle = null,
  checkoutBaseUrl,
  provider = "commas",
  env = process.env, fetchImpl = fetch
}) {
  if (provider === "whop") {
    return createWhopBlueprintPaymentLink(db, {
      orgId, clientId, partnerId, purpose, description, amountCents, currency,
      createdByStaffId, createdByRole, productId, productCode, saleId, saleMotion,
      invoiceId, fundingRoundId, env, fetchImpl
    });
  }
  if (provider !== "commas") throw new TypeError("createPaymentLink: unsupported payment provider");
  if (!orgId) throw new TypeError("createPaymentLink: orgId is required");
  /* EXACTLY ONE OWNER, the same rule 277's CHECK enforces in the database.
     A link addressed to both a client and a partner has no answer to "whose
     money is this"; a link addressed to neither still shows a payable URL and
     names nobody. Refused here so the caller gets a sentence rather than a
     constraint name. The `clientId is required` message is preserved for the
     case that actually happens — a client caller that forgot it. */
  if (!clientId && !partnerId) throw new TypeError("createPaymentLink: clientId is required");
  if (clientId && partnerId) {
    throw new TypeError("createPaymentLink: a link belongs to a client or a partner, never both");
  }
  /* The live create-invoice door sends purpose "invoice". The table check
     still only allows deposit / diagnostic / repair / custom, so invoice
     is accepted here and stored as custom — a word that already works. */
  if (purpose === "invoice") {
    purpose = "custom";
    if (!String(description || "").trim()) description = "Invoice";
  }
  if (!PURPOSES.has(purpose)) {
    throw new TypeError(`createPaymentLink: purpose must be one of ${[...PURPOSES].join(", ")}, invoice`);
  }
  if (purpose === "custom" && !String(description || "").trim()) {
    throw new TypeError("createPaymentLink: a custom link needs a description");
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new RangeError(`createPaymentLink: amountCents must be a positive integer, got ${amountCents}`);
  }
  if (saleMotion != null && !SALE_MOTIONS.has(saleMotion)) {
    throw new TypeError("createPaymentLink: saleMotion must be downsell or upsell");
  }

  const context = await resolveLinkContext(db, {
    orgId,
    clientId,
    productId,
    productCode,
    saleId,
    saleMotion,
    createdByStaffId,
    createdByRole
  });

  if (context.productCode === "consulting-package") {
    resolveOfferAmountCents("UWIQ_DELIVERABLES", amountCents);
    await assertBlueprintAgreementPrice(db, { orgId, clientId, amountCents });
  }

  const commasTitle = commasProductTitleFor({
    productCode: context.productCode,
    purpose,
    commasProductTitle,
    invoiceId
  });
  try {
    assertCommasSafeCopy(commasTitle, { field: "product.title" });
  } catch (e) {
    const err = new Error(e.message || "Commas product title failed safety check");
    err.code = e.code || "commas_unsafe_copy";
    err.status = 400;
    throw err;
  }
  const mintAndSave = async (saveDb = db, checkoutTimeoutMs = null) => {
    const linkRef = generateLinkRef();
    let checkoutUrl;
    let commasSessionId = null;

    const cfg = checkoutConfig(env);
    if (cfg.ok) {
      const minted = await createCheckoutSession({
        amountCents,
        productTitle: commasTitle,
        metadata: {
          link_ref: linkRef,
          client_id: clientId,
          partner_id: partnerId,
          org_id: orgId,
          product_id: context.productId,
          sale_id: context.saleId,
          sale_motion: saleMotion,
          invoice_id: invoiceId,
          funding_round_id: fundingRoundId
        },
        env,
        fetchImpl,
        timeoutMs: checkoutTimeoutMs
      });
      if (!minted.ok) {
        const err = new Error(minted.reason || "Commas checkout session failed");
        err.code = "commas_checkout_failed";
        err.status = minted.status || 502;
        throw err;
      }
      checkoutUrl = minted.paymentLink;
      commasSessionId = minted.productId != null ? String(minted.productId) : null;
    } else if (checkoutBaseUrl) {
      checkoutUrl = buildCommasCheckoutUrl({
        baseUrl: checkoutBaseUrl,
        linkRef,
        amountCents,
        description: commasTitle
      });
    } else {
      const err = new Error(cfg.reason || "No Commas checkout configured");
      err.code = "commas_not_configured";
      err.status = 503;
      throw err;
    }

    const result = await saveDb.query(
      `INSERT INTO payment_links
       (org_id, client_id, partner_id, purpose, description, amount_cents, currency,
        link_ref, checkout_url, created_by_staff_id, commas_session_id,
        product_id, sale_id, sale_motion, closer_staff_id, sales_manager_staff_id,
        invoice_id)
     VALUES ($1,$2,$17,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     RETURNING *`,
      [
        orgId, clientId, purpose, description, amountCents, currency,
        linkRef, checkoutUrl, createdByStaffId, commasSessionId,
        context.productId, context.saleId, saleMotion,
        context.closerStaffId, context.salesManagerStaffId,
        invoiceId, partnerId
      ]
    );
    return result.rows[0];
  };

  if (!invoiceId) return mintAndSave();
  return withInvoiceCheckoutLock(db, orgId, clientId, invoiceId, async (lockConn) => {
    const existing = (await lockConn.query(
      `SELECT * FROM payment_links
        WHERE org_id = $1 AND invoice_id = $2 AND provider = 'commas'
          AND status IN ('created', 'sent')
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [orgId, invoiceId]
    )).rows[0];
    if (existing) {
      if (String(existing.client_id) !== String(clientId) ||
          Number(existing.amount_cents) !== amountCents ||
          String(existing.currency).toUpperCase() !== String(currency).toUpperCase() ||
          !String(existing.checkout_url || "").trim()) {
        throw new Error(`Invoice ${invoiceId} has an open Commas checkout with mismatched owner, balance, or currency`);
      }
      return existing;
    }
    return mintAndSave(lockConn, INVOICE_CHECKOUT_TIMEOUT_MS);
  });
}

/** markSent — created -> sent. Idempotent: a link already sent (or paid) is
 *  untouched and the call returns null rather than clobbering a later state. */
export async function markSent(db, { id, orgId, at = new Date() }) {
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'sent', sent_at = $3
      WHERE id = $1 AND org_id = $2 AND status = 'created'
     RETURNING *`,
    [id, orgId, at]
  );
  return result.rows[0] ?? null;
}

/** markExpired — created/sent -> expired. A staff action, not automatic: this
 *  repo has no scheduler that walks stale links, so a link only expires when
 *  someone says it has. */
export async function markExpired(db, { id, orgId, at = new Date() }) {
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'expired', expired_at = $3
      WHERE id = $1 AND org_id = $2 AND status = ANY($4)
     RETURNING *`,
    [id, orgId, at, OPEN_STATUSES]
  );
  return result.rows[0] ?? null;
}

/** markPaid — created/sent -> paid, keyed by the link's OWN reference. */
export async function markPaid(db, {
  orgId, linkRef, commasSessionId = null, paidAmountCents = null, paidAt = new Date(),
  clientId = null, invoiceId = null, paymentLinkId = null
}) {
  if (!orgId) throw new TypeError("markPaid: orgId is required");
  if (!linkRef) throw new TypeError("markPaid: linkRef is required");
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'paid', paid_at = $2, commas_session_id = COALESCE($3, commas_session_id), paid_amount_cents = $4
      WHERE link_ref = $1 AND org_id = $6 AND status = ANY($5)
        AND ($7::text IS NULL OR client_id::text = $7)
        AND ($8::text IS NULL OR invoice_id::text = $8)
        AND ($9::text IS NULL OR id::text = $9)
     RETURNING *`,
    [linkRef, paidAt, commasSessionId, paidAmountCents, OPEN_STATUSES, orgId,
      clientId, invoiceId, paymentLinkId]
  );
  return result.rows[0] ?? null;
}

/** markPaidBySession — fallback when webhook metadata lost link_ref but still
 *  carries the Commas product / session id we stored at mint time. */
export async function markPaidBySession(db, {
  orgId, commasSessionId, paidAmountCents = null, paidAt = new Date(),
  clientId = null, invoiceId = null, paymentLinkId = null
}) {
  if (!orgId) throw new TypeError("markPaidBySession: orgId is required");
  if (!commasSessionId) throw new TypeError("markPaidBySession: commasSessionId is required");
  const result = await db.query(
    `UPDATE payment_links
        SET status = 'paid', paid_at = $2, paid_amount_cents = $3
      WHERE commas_session_id = $1 AND org_id = $5 AND status = ANY($4)
        AND ($6::text IS NULL OR client_id::text = $6)
        AND ($7::text IS NULL OR invoice_id::text = $7)
        AND ($8::text IS NULL OR id::text = $8)
     RETURNING *`,
    [String(commasSessionId), paidAt, paidAmountCents, OPEN_STATUSES, orgId,
      clientId, invoiceId, paymentLinkId]
  );
  return result.rows[0] ?? null;
}

export async function getPaymentLink(db, { id, orgId }) {
  const result = await db.query(
    `SELECT * FROM payment_links WHERE id = $1 AND org_id = $2`,
    [id, orgId]
  );
  return result.rows[0] ?? null;
}

export async function getByLinkRef(db, { linkRef }) {
  const result = await db.query(`SELECT * FROM payment_links WHERE link_ref = $1`, [linkRef]);
  return result.rows[0] ?? null;
}

/** listPaymentLinksForPartner — every ask addressed to one partner, newest
 *  first. The partner mirror of listPaymentLinksForClient; separate rather than
 *  a branch inside it, because a caller holding a client id must never be able
 *  to read a partner's asks by passing the wrong argument name. */
export async function listPaymentLinksForPartner(db, { orgId, partnerId }) {
  if (!orgId) throw new TypeError("listPaymentLinksForPartner: orgId is required");
  if (!partnerId) throw new TypeError("listPaymentLinksForPartner: partnerId is required");
  const result = await db.query(
    `SELECT * FROM payment_links WHERE org_id = $1 AND partner_id = $2 ORDER BY created_at DESC`,
    [orgId, partnerId]
  );
  return result.rows;
}

export async function listPaymentLinksForClient(db, { orgId, clientId }) {
  const result = await db.query(
    `SELECT * FROM payment_links WHERE org_id = $1 AND client_id = $2 ORDER BY created_at DESC`,
    [orgId, clientId]
  );
  return result.rows;
}
