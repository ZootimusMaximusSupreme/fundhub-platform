// /api/payment-links — the CRM's "create a payment link" action.
//
//   GET  ?client_id=<uuid>                                    → { ok, items }
//   POST { action: "create", client_id, purpose, description?, price | price_cents,
//          product_id?, sale_id?, sale_motion? }
//   POST { action: "send",   id }
//   POST { action: "expire", id }
//
// COMPLIANCE REVIEW REQUIRED — payment rails.
//
// ROLES. Every action here — GET, "create", "send" and "expire" — is gated by
// one set: ROLE_SETS.FINANCE {owner, admin, sales_manager} plus `closer`.
// It is one set rather than a narrow read and a wide write because a closer
// that could mint a link but not GET the list would 403 the instant a screen
// tried to show it. Texting a client to ask for money, or killing a live ask,
// is the same class of action as starting a plan or filing a card.
//
// Admitting `closer` is not a widening of FINANCE and it is not a new
// decision: a closer already mints payment links today through
// api/closer-deck.mjs (CLOSER_DECK_ROLES = {closer, sales_manager, owner,
// admin}, whose send_soft_pull / send_pay_link actions all call
// the same createPaymentLink via src/sales/closer-deck.mjs). The 403 here only
// meant the one person whose job is taking payment on the call could use the
// deck button and not the CRM's own. ROLE_SETS.FINANCE itself is untouched —
// it also gates invoices, staff records and payouts, and the owner decision
// recorded at src/http/read-api.mjs:122-137 is not being reopened.
//
// THIS DOES CALL COMMAS, through src/payment-links/index.mjs. That module
// prefers the live checkout-session API (src/payments/commas-api.mjs
// createCheckoutSession, keyed by FANBASIS_CHECKOUT_API_KEY) and falls back to
// pure URL construction against COMMAS_CHECKOUT_BASE_URL
// (src/adapters/commas.mjs buildCommasCheckoutUrl). The outbound `fetch` is a
// documented, argued exception to CLAUDE.md §12 that already shipped — see the
// header of src/payments/commas-api.mjs — not a new one opened here.
//
// So "create" answers 503 only when NEITHER is configured. Neither variable is
// individually required, which is the same gate src/sales/closer-deck.mjs
// applies in three places. Nothing is ever invented: no config, no link.
//
// "send" queues an SMS via sendTemplated. If that template is not approved,
// nothing is queued and the link stays `created` — we do not mark it sent.
import { db } from "../src/db.mjs";
import { requireAuth } from "../src/http/middleware/requireAuth.mjs";
import { requireRole, isUuid, CLIENT_DATA_ERRORS } from "../src/http/read-api.mjs";
import {
  createPaymentLink, markSent, markExpired, getPaymentLink, listPaymentLinksForClient
} from "../src/payment-links/index.mjs";
import { priceToCents, assertPriceCents, formatPrice } from "../src/subscriptions/index.mjs";
import { sendTemplated } from "../src/workflows/messaging.mjs";
import { createInvoice } from "../src/invoices/index.mjs";
import { dbDown } from "../src/http/db-down.mjs";
import { ContractError } from "../src/contracts/errors.mjs";

/* WHO GATES THIS ROUTE.
   ROLE_SETS.FINANCE — {owner, admin, sales_manager} — plus the closer, who is
   the person actually asking a client for money on the call. A closer that can
   mint a link but cannot GET the list would 403 the moment a screen tried to
   show it, so one set covers every action here rather than create alone.
   ROLE_SETS.FINANCE itself is deliberately NOT widened: it also gates invoices,
   staff records and payouts, and a payment-link change must not reach those.

   WRITTEN OUT LONGHAND ON PURPOSE. scripts/journeys/extract.mjs:311 reads this
   gate with a regex that resolves a bare identifier or a `new Set([...])` of
   quoted strings; it cannot see a spread, and it cannot see a function call.
   An unreadable gate does not fail loudly — it silently extracts as "any signed
   in employee", which would publish, on the journey pages a non-coder reads,
   the false claim that a setter or an inquiry specialist can ask a client for
   money. Keep this literal and in step with ROLE_SETS.FINANCE. */
const PAYMENT_LINK_ROLES = new Set(["owner", "admin", "sales_manager", "closer"]);

/* CLOSER_ACTIONS — the narrowing behind that union gate.
   The route gate above is the UNION: who can reach this route at all. That is
   the question a journey page answers, and it is the same convention
   extract.mjs already applies to a gate that changes with the method.
   A closer gained exactly ONE action: creating the ask. Reading the list,
   texting the link and killing a live ask stay with FINANCE, which is where
   they were before this change — those refusals are pre-existing decisions and
   are not being reopened here. */
const CLOSER_ACTIONS = new Set(["create"]);

/* closerRefused — true when a closer is reaching for an action that is not
   theirs. Answered before anything is read, so a refused role touches no data. */
function closerRefused(staff, req) {
  if (!staff || staff.role !== "closer") return false;
  if (!req || req.method !== "POST") return true;
  const action = String((req.body || {}).action || "").trim();
  return !CLOSER_ACTIONS.has(action);
}
const SESSION_OWNED = ["org_id", "orgId"];
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(Object(o ?? {}), k);

/* readAmountCents — same two-spellings-not-both rule as
   api/finance/subscriptions.mjs readPriceCents, except an ABSENT or NULL
   amount is refused here rather than passed through: a subscription can be on
   an unknown price, a payment link cannot ask a client for an unknown amount. */
function readAmountCents(body) {
  const hasDollars = hasOwn(body, "price");
  const hasCents = hasOwn(body, "price_cents");
  if (hasDollars && hasCents) {
    throw new TypeError("create: send price (dollars) or price_cents (integer cents), not both — they can disagree");
  }
  const cents = hasCents ? assertPriceCents(body.price_cents, "create: price_cents")
              : hasDollars ? priceToCents(body.price)
              : undefined;
  if (cents === undefined || cents === null) {
    throw new TypeError("create: an amount is required — a payment link cannot ask for an unknown amount");
  }
  return cents;
}

function withDisplay(row) {
  if (!row) return null;
  return {
    ...row,
    amount_display: formatPrice(row.amount_cents),
    paid_amount_display: formatPrice(row.paid_amount_cents)
  };
}

async function ownsClient(orgId, clientId) {
  const r = await db.query(`SELECT 1 FROM clients WHERE id = $1 AND org_id = $2`, [String(clientId).trim(), orgId]);
  return r.rows.length > 0;
}

/* deps is the test seam, modelled on api/closer-deck.mjs. It exists because
   "create" can now reach a LIVE outbound POST that mints a real, payable
   checkout session: a suite that leaned on process.env and the global fetch
   would charge through to the provider the moment somebody exported
   FANBASIS_CHECKOUT_API_KEY into their shell. Production passes neither key
   and gets process.env / global fetch, exactly as before. */
export default async function handler(req, res, deps = {}) {
  const env = deps.env ?? process.env;
  const fetchImpl = deps.fetchImpl;

  const staff = await requireAuth(req, res, { db });
  if (!staff) return;
  if (!requireRole(res, staff, PAYMENT_LINK_ROLES)) return;
  if (closerRefused(staff, req)) {
    return res.status(403).json({
      ok: false,
      error: "forbidden",
      message: "a closer can create a payment link, not read, send or expire one"
    });
  }

  const orgId = staff.org_id ?? null;
  if (!orgId) {
    return res.status(403).json({ ok: false, error: "org_required" });
  }

  try {
    if (req.method === "GET") {
      const q = req.query || {};
      if (!isUuid(q.client_id)) {
        return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
      }
      if (!(await ownsClient(orgId, q.client_id))) {
        return res.status(403).json({ ok: false, error: "forbidden" });
      }
      const items = await listPaymentLinksForClient(db, { orgId, clientId: String(q.client_id).trim() });
      return res.status(200).json({ ok: true, items: items.map(withDisplay) });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      for (const field of SESSION_OWNED) {
        if (hasOwn(body, field)) {
          return res.status(400).json({ ok: false, error: `${field}_not_accepted` });
        }
      }

      if (body.action === "create") {
        const provider = body.provider ?? "commas";
        if (provider !== "commas" && provider !== "whop") {
          return res.status(400).json({ ok: false, error: "unsupported_payment_provider" });
        }
        if (!isUuid(body.client_id)) {
          return res.status(400).json({ ok: false, error: "client_id must be a uuid" });
        }
        if (!(await ownsClient(orgId, body.client_id))) {
          return res.status(403).json({ ok: false, error: "forbidden" });
        }
        if (body.product_id != null && !isUuid(body.product_id)) {
          return res.status(400).json({ ok: false, error: "product_id must be a uuid" });
        }
        if (body.sale_id != null && !isUuid(body.sale_id)) {
          return res.status(400).json({ ok: false, error: "sale_id must be a uuid" });
        }
        /* Present "Invoice this client" posts purpose invoice. That must write
           an invoices row (money owed). It must not mint a payment_links row.
           COMPLIANCE REVIEW REQUIRED — payment rails. Draft only: do not send. */
        if (String(body.purpose || "").trim().toLowerCase() === "invoice") {
          if (provider !== "commas") {
            return res.status(400).json({ ok: false, error: "whop_blueprint_only" });
          }
          const amountCents = readAmountCents(body);
          const clientId = String(body.client_id).trim();
          const idempotencyKey = `present-invoice:${clientId}:${amountCents}`;
          let invoice = await createInvoice(db, {
            orgId,
            clientId,
            source: "other",
            amount: amountCents / 100,
            notes: String(body.description || "Invoice this client").slice(0, 500),
            idempotencyKey
          });
          if (!invoice) {
            const existing = await db.query(
              `SELECT * FROM invoices WHERE org_id = $1 AND idempotency_key = $2`,
              [orgId, idempotencyKey]
            );
            invoice = existing.rows[0] ?? null;
          }
          if (!invoice) {
            return res.status(500).json({ ok: false, error: "invoice_not_created" });
          }
          return res.status(200).json({ ok: true, action: "create", invoice });
        }
        /* Refuse only when there is NO way to mint a link. Gating on
           COMMAS_CHECKOUT_BASE_URL alone refused every request while the key
           that actually works sat set and unread, because
           createPaymentLink prefers the checkout-session API and only falls
           back to a query-string URL. Same gate as src/sales/closer-deck.mjs
           348 / 459 / 537. checkoutBaseUrl is still passed through — it may
           legitimately be unset. */
        const checkoutBaseUrl = env.COMMAS_CHECKOUT_BASE_URL;
        if (provider === "commas" && !checkoutBaseUrl &&
            !String(env.CORTANA_COMMAS_API_KEY || env.FANBASIS_CHECKOUT_API_KEY || "").trim()) {
          return res.status(503).json({
            ok: false,
            error: "commas_not_configured",
            message: "Neither FANBASIS_CHECKOUT_API_KEY nor COMMAS_CHECKOUT_BASE_URL is set — no checkout link can be built"
          });
        }
        const amountCents = readAmountCents(body);
        const link = await createPaymentLink(db, {
          orgId,
          clientId: String(body.client_id).trim(),
          purpose: body.purpose,
          description: body.description ?? null,
          amountCents,
          provider,
          currency: body.currency ?? "USD",
          createdByStaffId: staff.id,
          createdByRole: staff.role,
          productId: body.product_id ?? null,
          saleId: body.sale_id ?? null,
          saleMotion: body.sale_motion ?? null,
          checkoutBaseUrl,
          env,
          fetchImpl
        });
        return res.status(200).json({ ok: true, action: "create", link: withDisplay(link) });
      }

      if (body.action === "send" || body.action === "expire") {
        if (!isUuid(body.id)) {
          return res.status(400).json({ ok: false, error: "id must be a uuid" });
        }
        const link = await getPaymentLink(db, { id: body.id, orgId });
        if (!link) return res.status(404).json({ ok: false, error: "no such payment link" });

        if (body.action === "expire") {
          const updated = await markExpired(db, { id: body.id, orgId });
          if (!updated) {
            return res.status(409).json({ ok: false, error: "this link is already paid or expired — nothing changed" });
          }
          return res.status(200).json({ ok: true, action: "expire", link: withDisplay(updated) });
        }

        // action === "send". Resending after 'sent' is a legitimate "they said
        // they lost it" case and sendTemplated's own idempotency (one message
        // per link id) makes a second request harmless — but a link that is
        // already 'paid', 'expired' or 'void' asking a client for money again
        // is not a resend, it is a wrong message, so those are refused.
        if (link.status !== "created" && link.status !== "sent") {
          return res.status(409).json({
            ok: false,
            error: `this link is ${link.status} — sending it again would ask the client for money that is settled or dead`
          });
        }
        const queued = await sendTemplated(db, {
          orgId,
          clientId: link.client_id,
          channel: "sms",
          templateKey: "payment_link_notice",
          eventId: link.id,
          staffId: staff.id,
          context: {
            payment_link: {
              url: link.checkout_url,
              description: link.description || link.purpose,
              amount: formatPrice(link.amount_cents)
            }
          }
        });
        let updated = link;
        if (queued.sent === true) {
          updated = (await markSent(db, { id: body.id, orgId })) || link;
        }
        return res.status(200).json({
          ok: true,
          action: "send",
          link: withDisplay(updated),
          message_queued: queued.sent === true,
          message_reason: queued.sent ? null : queued.reason
        });
      }

      return res.status(400).json({ ok: false, error: "invalid_action" });
    }

    res.setHeader("allow", "GET, POST");
    return res.status(405).json({ ok: false, error: "method_not_allowed" });
  } catch (e) {
    if (e instanceof ContractError) {
      return res.status(e.status || 409).json({ ok: false, error: e.code, message: e.message });
    }
    if (e instanceof TypeError || e instanceof RangeError) {
      return res.status(400).json({ ok: false, error: String(e.message).slice(0, 200) });
    }
    /* createPaymentLink raises its own shaped errors when the checkout
       provider is unconfigured or refuses (src/payment-links/index.mjs 57-77).
       Neither is a TypeError, neither carries a Postgres code, neither is a
       dead connection — so both used to fall through to `throw e` and the
       router answered 500 internal_error, making a provider outage read to the
       CRM as "our code broke".

       Fixed statuses, not the provider's own: 502 says an upstream we depend
       on failed, which is the truth. Passing their status through would turn a
       Commas 401 (our API key is wrong) into a 401 on this endpoint, which the
       CRM would show the staff member as "you are signed out". Nothing is
       written on either path — both throw before the INSERT. */
    if (e && (e.code === "commas_not_configured" || e.code === "whop_not_configured")) {
      return res.status(503).json({ ok: false, error: e.code, message: String(e.message || e.code).slice(0, 200) });
    }
    if (e && (e.code === "commas_checkout_failed" || e.code === "whop_checkout_failed")) {
      return res.status(502).json({ ok: false, error: e.code, message: String(e.message || e.code).slice(0, 200) });
    }
    if (CLIENT_DATA_ERRORS.has(e && e.code)) {
      return res.status(400).json({ ok: false, error: "invalid_parameter" });
    }
    if (e && (e.code === "23505" || e.code === "23514" || e.code === "23503")) {
      return res.status(400).json({ ok: false, error: "the database refused that value" });
    }
    if (dbDown(res, e)) return;
    throw e;
  }
}
