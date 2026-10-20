// Retire one invoice's saved Commas checkout. A local expired/void status alone
// does not deactivate a hosted URL; Commas documents DELETE checkout-sessions
// as the action that makes the URL unusable for new purchases.
import { checkoutConfig } from "../payments/commas-api.mjs";
import { transmit, ADAPTERS } from "../lib/outbound-fetch.mjs";

function checkoutSessionRef(link) {
  const id = String(link.commas_session_id || "").trim();
  if (!id) throw new Error(`Invoice checkout ${link.id} has no Commas session ID`);
  let url;
  try { url = new URL(link.checkout_url); } catch {
    throw new Error(`Invoice checkout ${link.id} has no valid Commas URL`);
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || !(
    host === "fanbasis.com" || host.endsWith(".fanbasis.com") ||
    host === "dev-fan-basis.com" || host.endsWith(".dev-fan-basis.com")
  )) {
    throw new Error(`Invoice checkout ${link.id} is not a Commas-hosted URL`);
  }
  const tail = url.pathname.split("/").filter(Boolean).at(-1);
  if (tail !== id) throw new Error(`Invoice checkout ${link.id} Commas ID does not match its URL`);
  return id;
}

function verifyProviderRecord(data, link) {
  const meta = data?.metadata || data?.product?.metadata || {};
  const expected = {
    invoice_id: link.invoice_id,
    client_id: link.client_id,
    org_id: link.org_id
  };
  for (const [key, value] of Object.entries(expected)) {
    if (meta[key] != null && String(meta[key]) !== String(value)) {
      throw new Error(`Commas checkout ${link.id} ${key} does not match the saved invoice`);
    }
  }
  if (data?.amount_cents != null && Number(data.amount_cents) !== Number(link.amount_cents)) {
    throw new Error(`Commas checkout ${link.id} amount does not match the saved invoice link`);
  }
  if (data?.payment_link && new URL(data.payment_link).pathname !== new URL(link.checkout_url).pathname) {
    throw new Error(`Commas checkout ${link.id} URL does not match the saved invoice link`);
  }
}

export async function retireInvoiceCheckoutLink(db, {
  linkId, orgId, invoiceId, env = process.env, fetchImpl = fetch
}) {
  if (!linkId || !orgId || !invoiceId) throw new TypeError("linkId, orgId, and invoiceId are required");
  const link = (await db.query(
    `SELECT pl.id, pl.org_id, pl.client_id, pl.invoice_id, pl.provider, pl.status,
            pl.commas_session_id, pl.checkout_url, pl.amount_cents,
            pl.provider_retire_verified_at
       FROM payment_links pl
       JOIN invoices i ON i.id = pl.invoice_id
         AND i.org_id = pl.org_id AND i.client_id = pl.client_id
      WHERE pl.id = $1 AND pl.org_id = $2 AND pl.invoice_id = $3
        AND (i.source = 'funding_success_fee' OR i.invoice_type = 'success_fee')
      LIMIT 1`,
    [linkId, orgId, invoiceId]
  )).rows[0];
  if (!link) throw new Error(`Invoice checkout ${linkId} is not linked to invoice ${invoiceId}`);
  if (link.status === "void") return { retired: true, alreadyRetired: true, linkId };
  if (!["created", "sent", "expired"].includes(link.status) || link.provider !== "commas") {
    throw new Error(`Invoice checkout ${linkId} is not an open Commas invoice link`);
  }
  const sessionId = checkoutSessionRef(link);

  // Hide it from the portal before any provider call. If Commas fails, the
  // expired row remains a durable, retryable cleanup target.
  if (link.status !== "expired") {
    await db.query(
      `UPDATE payment_links
          SET status = 'expired', expired_at = COALESCE(expired_at, now())
        WHERE id = $1 AND org_id = $2 AND invoice_id = $3
          AND status IN ('created', 'sent')`,
      [linkId, orgId, invoiceId]
    );
  }

  const cfg = checkoutConfig(env);
  if (!cfg.ok) throw new Error(cfg.reason);
  const endpoint = `${cfg.base}/checkout-sessions/${encodeURIComponent(sessionId)}`;
  const headers = { "x-api-key": cfg.apiKey, accept: "application/json" };
  const lookedUp = await transmit(endpoint, { method: "GET", headers }, {
    fence: ADAPTERS, env, fetchImpl, timeoutMs: 2000,
    what: "Commas invoice checkout lookup"
  });
  if (lookedUp.blocked) throw new Error(`Commas checkout lookup held: ${lookedUp.error}`);
  if (lookedUp.status === 404 && !link.provider_retire_verified_at) {
    throw new Error(`Commas checkout lookup returned 404 without prior verification for link ${linkId}`);
  }
  if (lookedUp.status !== 404) {
    if (!lookedUp.ok) throw new Error(`Commas checkout lookup failed (${lookedUp.status}) for link ${linkId}`);
    const lookedUpBody = lookedUp.body;
    if (lookedUpBody?.status === "error" || !lookedUpBody?.data) {
      throw new Error(`Commas checkout lookup was rejected for link ${linkId}`);
    }
    verifyProviderRecord(lookedUpBody.data, link);
    await db.query(
      `UPDATE payment_links
          SET provider_retire_verified_at = now()
        WHERE id = $1 AND org_id = $2 AND invoice_id = $3
          AND status = 'expired'`,
      [linkId, orgId, invoiceId]
    );

    const deleted = await transmit(endpoint, { method: "DELETE", headers }, {
      fence: ADAPTERS, env, fetchImpl, timeoutMs: 2000,
      what: "Commas invoice checkout deletion"
    });
    if (deleted.blocked) throw new Error(`Commas checkout deletion held: ${deleted.error}`);
    if (!deleted.ok && deleted.status !== 404) {
      throw new Error(`Commas checkout deletion failed (${deleted.status}) for link ${linkId}`);
    }
    if (deleted.ok && deleted.status !== 204) {
      const deletedBody = deleted.body;
      if (deletedBody?.status === "error") {
        throw new Error(`Commas checkout deletion was rejected for link ${linkId}`);
      }
    }
  }
  const updated = await db.query(
    `UPDATE payment_links
        SET status = 'void', provider_retire_last_error = NULL
      WHERE id = $1 AND org_id = $2 AND invoice_id = $3 AND status = 'expired'
      RETURNING id`,
    [linkId, orgId, invoiceId]
  );
  if (!updated.rows[0]) throw new Error(`Commas checkout ${linkId} deleted but local link was not voided`);
  return { retired: true, alreadyRetired: false, linkId };
}

export async function retireInvoiceCheckoutLinksForInvoice(db, {
  orgId, invoiceId, env = process.env, fetchImpl = fetch
}) {
  if (!orgId || !invoiceId) throw new TypeError("orgId and invoiceId are required");
  const links = (await db.query(
    `SELECT id FROM payment_links
      WHERE org_id = $1 AND invoice_id = $2
        AND provider = 'commas'
        AND status IN ('created', 'sent', 'expired')
      ORDER BY created_at ASC, id ASC`,
    [orgId, invoiceId]
  )).rows;
  for (const link of links) {
    await retireInvoiceCheckoutLink(db, { linkId: link.id, orgId, invoiceId, env, fetchImpl });
  }
  return { retired: links.length };
}
