import { createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { isUuid } from "../http/read-api.mjs";
import { demoFlagForEmail } from "../demo/test-identity.mjs";
import { attributeWithUpline } from "./economics.mjs";
import { getContract, createDraft, send } from "../contracts/send.mjs";
import { getTemplateByKey } from "../contracts/templates.mjs";
import { getOffer, resolveOfferAmountCents } from "../config/offers.mjs";
import { HANDOFF_PATH, HANDOFF_ORIGIN, handoffSignature, handoffUrl } from "./blueprint-handoff-link.mjs";
export { HANDOFF_PATH, handoffSignature, handoffUrl } from "./blueprint-handoff-link.mjs";
import { assertBlueprintAgreementPrice } from "../contracts/blueprint-price.mjs";
import { signContractUrl, secretFromEnv } from "../contracts/signed-link.mjs";
import { createWhopBlueprintPaymentLink } from "../payments/whop-blueprint.mjs";
import { normalizePhone } from "../messaging/providers/bland-voice.mjs";

export const SELLER_OFFER = "BLUEPRINT_SELF_FUNDING";
export const SELLER_PRODUCT = "blueprint-self-funding";
export const SELLER_AMOUNT = 3000000;
const ORIGIN = HANDOFF_ORIGIN;
export class SellerError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
const refused = () => new SellerError("seller_disabled", "This account cannot sell Blueprint.", 403);

// Capability is explicit and narrow. A globally unique affiliate id still must
// belong to the active signed-in account's own company (checked again on writes).
export function sellerCapability(principal, affiliate, env = process.env) {
  const entries = String(env.BLUEPRINT_AFFILIATE_SELLER_IDS || "").split(",").map(s => s.trim()).filter(Boolean);
  const enabled = principal?.kind === "affiliate" && isUuid(principal.orgId) && isUuid(principal.accountId)
    && affiliate?.status === "active" && String(principal.affiliateId) === String(affiliate.id)
    && entries.length > 0 && entries.every(isUuid) && entries.includes(String(affiliate.id));
  const offer=getOffer(SELLER_OFFER);
  return { enabled: Boolean(enabled), amountCents: offer.priceCents, minAmountCents: offer.priceMinCents, maxAmountCents: offer.priceMaxCents, amountStepCents: 100, currency: "USD", offerKey: SELLER_OFFER,
    createPath: "/api/affiliates/blueprint-sale" };
}

export function parseSellerBuyer(body = {}) {
  const keys = ["first_name", "last_name", "email", "phone", "request_id", "amount_cents"];
  if (Object.keys(body).some(key => !keys.includes(key))) throw new SellerError("invalid_buyer", "Send only the buyer's name, email and phone.");
  const first = String(body.first_name || "").trim();
  const last = String(body.last_name || "").trim();
  const email = String(body.email || "").trim().toLowerCase();
  const phone = normalizePhone(String(body.phone || "").trim());
  if (!first || !last || first.length > 100 || last.length > 100 || /[\r\n<>]/.test(first + last)
    || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !phone || !isUuid(body.request_id)) {
    throw new SellerError("invalid_buyer", "Enter the buyer's first and last name, email and phone.");
  }
  let amount;
  try { amount=resolveOfferAmountCents(SELLER_OFFER,body.amount_cents); }
  catch(error) { throw new SellerError("invalid_amount",error.message); }
  return { amount_cents: amount, first_name: first, last_name: last, name: first + " " + last, email, phone, request_id: String(body.request_id).toLowerCase() };
}

async function enabledSeller(db, principal, env) {
  const row = (await db.query(`SELECT a.id, a.status, a.tracking_id FROM affiliates a JOIN accounts ac
    ON ac.affiliate_id=a.id AND ac.org_id=a.org_id
    WHERE a.id=$1 AND a.org_id=$2 AND ac.id=$3 AND ac.kind='affiliate' AND ac.status='active'`,
  [principal?.affiliateId || null, principal?.orgId || null, principal?.accountId || null])).rows[0];
  if (!sellerCapability(principal, row, env).enabled) throw refused();
  return row;
}
async function assertOwnership(db, orgId, clientId, affiliate) {
  const own = (await db.query(`SELECT affiliate_id FROM affiliate_referrals WHERE org_id=$1 AND client_id=$2 AND tier='direct' LIMIT 1`, [orgId, clientId])).rows[0];
  const client = (await db.query(`SELECT custom_fields FROM clients WHERE id=$1 AND org_id=$2`, [clientId, orgId])).rows[0];
  const mirror = client?.custom_fields?.affiliate_tier1_owner;
  if ((own && own.affiliate_id !== affiliate.id) || (mirror && mirror.toUpperCase() !== affiliate.tracking_id.toUpperCase())) {
    throw new SellerError("buyer_already_attributed", "This buyer already belongs to another referrer.", 409);
  }
}
async function saveRecord(db, record) {
  await db.query(`UPDATE clients SET custom_fields=COALESCE(custom_fields,'{}'::jsonb)
    || jsonb_build_object('blueprint_seller_sale',$3::jsonb),updated_at=now() WHERE id=$1 AND org_id=$2`,
  [record.client_id, record.org_id, JSON.stringify(record)]);
}
async function readOrder(db, record) {
  return (await db.query(`SELECT l.*, p.code AS product_code FROM payment_links l JOIN products p ON p.id=l.product_id AND p.org_id=l.org_id
    WHERE l.org_id=$1 AND l.client_id=$2 AND p.code=$3 AND l.provider='whop' AND l.amount_cents=$4
      AND l.id=$5 LIMIT 1`, [record.org_id, record.client_id, SELLER_PRODUCT, record.amount_cents, record.payment_link_id || null])).rows[0] || null;
}
async function verifiedPaid(db, record, order) {
  if (order?.status !== "paid" || !order.whop_payment_id) return false;
  return Boolean((await db.query(`SELECT 1 FROM transactions t JOIN entitlements e ON e.source_transaction_id=t.id
    AND e.client_id=t.client_id AND e.org_id=t.org_id
    WHERE t.org_id=$1 AND t.client_id=$2 AND t.provider='whop' AND t.provider_ref=$3 AND t.status='succeeded'
      AND e.entitlement_code='blueprint-client-fulfillment' AND t.amount_paid=$4::numeric/100 LIMIT 1`,
  [record.org_id, record.client_id, order.whop_payment_id, record.amount_cents])).rows[0]);
}
async function saleResponse(db, record, env) {
  const contract = (await db.query(`SELECT status FROM contracts WHERE id=$1 AND org_id=$2 AND client_id=$3`,
  [record.contract_id, record.org_id, record.client_id])).rows[0];
  const order = await readOrder(db, record);
  const paid = await verifiedPaid(db, record, order);
  return { handoff_url: handoffUrl(record, env), stage: paid ? "paid" : contract?.status === "signed" ? "ready_to_pay" : "awaiting_signature",
    amount_cents: record.amount_cents, offer_key: SELLER_OFFER, contract_id: record.contract_id, commission_status: "pending" };
}

// Transaction-scoped locks work through the production transaction pooler.
// Commit the immutable buyer/order reservation before provider traffic. Concurrent
// retries then use that same order and Whop idempotency key, without session locks.
export async function createSellerSale(db, { principal, body, env = process.env, deps = {} } = {}) {
  const affiliate = await enabledSeller(db, principal, env);
  const buyer = parseSellerBuyer(body);
  secretFromEnv(env); // No secret means no permanent bearer link, before any write.
  const incompatible = (await db.query(`SELECT id FROM accounts WHERE org_id=$1 AND lower(email)=$2 AND (kind<>'client' OR status='suspended')
    UNION ALL SELECT id FROM staff WHERE org_id=$1 AND lower(email)=$2 LIMIT 1`, [principal.orgId, buyer.email])).rows[0];
  if (incompatible) throw new SellerError("buyer_login_conflict", "Use the buyer's own client email address.", 409);
  const fingerprint = createHash("sha256").update(JSON.stringify([buyer.first_name,buyer.last_name,buyer.email,buyer.phone,buyer.amount_cents])).digest("hex");
  let transaction = false;
  try {
    await db.query("BEGIN"); transaction = true;
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))`, [principal.orgId,"blueprint-seller-account:"+principal.accountId]);
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))`, [principal.orgId,buyer.email]);
    const previous = (await db.query(`SELECT custom_fields->'blueprint_seller_sale' AS record FROM clients WHERE org_id=$1
      AND custom_fields->'blueprint_seller_sale'->>'account_id'=$2 AND (custom_fields->'blueprint_seller_sale'->>'request_id'=$3 OR custom_fields->'blueprint_seller_sale'->'request_ids' ? $3) LIMIT 1`,
    [principal.orgId,principal.accountId,buyer.request_id])).rows[0]?.record;
    if (previous && previous.buyer_fingerprint !== fingerprint) throw new SellerError("request_conflict", "This request belongs to a different buyer. Start a new buyer request.",409);
    const existing = (await db.query(`SELECT id,custom_fields FROM clients WHERE org_id=$1 AND lower(email)=$2 FOR UPDATE`, [principal.orgId, buyer.email])).rows[0];
    if (existing) await assertOwnership(db, principal.orgId, existing.id, affiliate);
    // Same native contact intake as the Contracts door: no retired CRM sync.
    // The email index and recovery also handle another native intake racing us.
    const clientId = existing?.id || (await db.query(`INSERT INTO clients
      (org_id,first_name,last_name,email,phone,channel_source,is_demo)
      VALUES($1,$2,$3,$4,$5,'affiliate-blueprint-sale',$6)
      ON CONFLICT (org_id,lower(email)) WHERE email IS NOT NULL DO NOTHING RETURNING id`,
    [principal.orgId,buyer.first_name,buyer.last_name,buyer.email,buyer.phone,demoFlagForEmail(buyer.email)])).rows[0]?.id
      || (await db.query('SELECT id FROM clients WHERE org_id=$1 AND lower(email)=$2',[principal.orgId,buyer.email])).rows[0]?.id;
    if (!clientId) throw new SellerError("buyer_not_saved", "The buyer could not be saved.", 503);
    await assertOwnership(db,principal.orgId,clientId,affiliate);
    const attributed = await (deps.attribute || attributeWithUpline)(db, { orgId: principal.orgId, affiliateId: affiliate.id,
      clientId, trackingIdUsed: affiliate.tracking_id, source: "affiliate-blueprint-sale", sourceEvent: "entry.captured" });
    if (!attributed.attributed && attributed.reason !== "already_attributed") throw new SellerError("buyer_already_attributed", "This buyer already belongs to another referrer.", 409);
    await db.query(`UPDATE clients SET custom_fields=COALESCE(custom_fields,'{}'::jsonb)||jsonb_build_object(
      'affiliate_tier1_owner',$3::text,'first_touch_date',COALESCE(custom_fields->>'first_touch_date',now()::text)) WHERE id=$1 AND org_id=$2`,
    [clientId, principal.orgId, affiliate.tracking_id]);
    let record = existing?.custom_fields?.blueprint_seller_sale;
    if (record && (record.affiliate_id !== affiliate.id || record.org_id !== principal.orgId || record.client_id !== clientId || record.account_id !== principal.accountId)) throw refused();
    if (record && (record.buyer_fingerprint !== fingerprint || record.amount_cents !== buyer.amount_cents)) throw new SellerError("request_conflict", "This buyer's saved details differ. Fundhub needs to review the file.",409);
    if (!record) {
      record = { version: 1, org_id: principal.orgId, affiliate_id: affiliate.id, account_id: principal.accountId,
        client_id: clientId, contract_id: null, request_id: buyer.request_id, request_ids: [buyer.request_id], buyer_fingerprint: fingerprint,
        amount_cents: buyer.amount_cents, created_at: new Date().toISOString(), payment_link_id: randomUUID() };
      await saveRecord(db, record);
    }
    const aliases = Array.isArray(record.request_ids) ? record.request_ids : [record.request_id];
    if (!aliases.includes(buyer.request_id)) {
      record.request_ids = [...aliases,buyer.request_id]; await saveRecord(db,record);
    }
    if (!record.contract_id) {
      const agreement = (await db.query(`SELECT id,status,created_by,sent_by FROM contracts WHERE org_id=$1 AND client_id=$2
        AND template_key='BLUEPRINT-SELF-FUNDING-AGREEMENT' AND status NOT IN ('void','declined')
        ORDER BY created_at DESC,id DESC LIMIT 1`, [record.org_id,record.client_id])).rows[0];
      if (!agreement) {
        const template=await (deps.getTemplate || getTemplateByKey)(db,{orgId:record.org_id,templateKey:"BLUEPRINT-SELF-FUNDING-AGREEMENT"});
        if (!template?.active) throw new SellerError("agreement_unavailable","The Blueprint agreement needs attention.",503);
        const draft=await (deps.createDraft || createDraft)(db,{orgId:record.org_id,accountId:principal.accountId,clientId,
          templateId:template.id,amountCents:record.amount_cents,values:{_seller_affiliate_id:affiliate.id,_seller_account_id:principal.accountId,_seller_request_id:buyer.request_id}});
        record.contract_id=draft.id;
      } else {
        if (!['sent','viewed','signed'].includes(agreement.status)) throw new SellerError("agreement_unavailable","This buyer already has an agreement being prepared. Fundhub needs to review it.",409);
        const match=await (deps.assertAgreement || assertBlueprintAgreementPrice)(db,{orgId:record.org_id,clientId,amountCents:record.amount_cents,offerKey:SELLER_OFFER});
        if(match.contractId!==agreement.id)throw new SellerError("agreement_changed","This buyer's agreement needs review.",409);
        record.contract_id=agreement.id;
      }
      await saveRecord(db,record);
    }
    await db.query("COMMIT"); transaction = false;
    let contract = await (deps.getContract || getContract)(db, { orgId: record.org_id, id: record.contract_id });
    if (!contract || contract.client_id !== record.client_id || contract.template_key !== "BLUEPRINT-SELF-FUNDING-AGREEMENT"
      || !["draft","sent","viewed","signed"].includes(contract.status)) throw new SellerError("agreement_unavailable", "This agreement is not available.", 409);
    if (contract.status==="draft" || (contract.created_by_account_id===principal.accountId && ["sent","viewed"].includes(contract.status))) {
      if(contract.created_by_account_id!==principal.accountId) throw new SellerError("agreement_unavailable","This agreement belongs to another sender.",409);
      contract=(await (deps.sendContract || send)(db,{orgId:record.org_id,accountId:principal.accountId,id:record.contract_id,
        amountCents:record.amount_cents,resend:false,secret:secretFromEnv(env),baseUrl:ORIGIN})).contract;
    }
    const match = await (deps.assertAgreement || assertBlueprintAgreementPrice)(db, { orgId: record.org_id, clientId: record.client_id,
      amountCents: record.amount_cents, offerKey: SELLER_OFFER });
    if (match.contractId !== record.contract_id) throw new SellerError("agreement_changed", "This buyer has a newer agreement. Fundhub needs to review it.", 409);
    let order = await readOrder(db, record);
    if (order?.status !== "paid") {
      order = await (deps.createCheckout || createWhopBlueprintPaymentLink)(db, { orgId: record.org_id, clientId: record.client_id,
        productCode: SELLER_PRODUCT, amountCents: record.amount_cents, createdByStaffId: null, createdByRole: null,
        resumeLinkId: order?.id || null, reservationId: record.payment_link_id, requiredPaymentMethod: "claritypay", env, fetchImpl: deps.fetchImpl });
      if (order.id !== record.payment_link_id) throw new SellerError("sale_changed", "This buyer's saved order changed. Fundhub needs to review it.",409);
      // Provider I/O ran outside the short reservation transaction. Another
      // retry may have added request aliases in the meantime; never replace
      // its current record with this call's older snapshot.
      const updated = (await db.query(`UPDATE clients SET custom_fields=jsonb_set(custom_fields,
        '{blueprint_seller_sale,financing_verified}','true'::jsonb,true),updated_at=now()
        WHERE id=$1 AND org_id=$2
          AND custom_fields->'blueprint_seller_sale'->>'client_id'=$1::text
          AND custom_fields->'blueprint_seller_sale'->>'org_id'=$2::text
          AND custom_fields->'blueprint_seller_sale'->>'contract_id'=$3
          AND custom_fields->'blueprint_seller_sale'->>'payment_link_id'=$4
          AND custom_fields->'blueprint_seller_sale'->>'account_id'=$5
          AND custom_fields->'blueprint_seller_sale'->>'affiliate_id'=$6
          AND custom_fields->'blueprint_seller_sale'->>'buyer_fingerprint'=$7
          AND custom_fields->'blueprint_seller_sale'->>'amount_cents'=$8::text
        RETURNING custom_fields->'blueprint_seller_sale' AS record`,
      [record.client_id,record.org_id,record.contract_id,record.payment_link_id,record.account_id,record.affiliate_id,record.buyer_fingerprint,record.amount_cents])).rows[0]?.record;
      if (!updated) throw new SellerError("sale_changed", "This buyer's saved order changed. Fundhub needs to review it.",409);
      record = updated;
    }
    return saleResponse(db, record, env);
  } catch (error) {
    if (transaction) await db.query("ROLLBACK");
    throw error;
  }
}

// This permanent outer link is only a broker for ONE pinned agreement/order.
// GET never creates a checkout, sends mail, grants access or consumes a signer.
export async function resolveSellerHandoff(db, { id, sig, env = process.env, now = Date.now } = {}) {
  const fail = () => new SellerError("not_found", "This link is not available.", 404);
  if (!isUuid(id) || !/^[0-9a-f]{64}$/.test(String(sig || ""))) throw fail();
  const row = (await db.query(`SELECT c.id,c.org_id,c.custom_fields,k.status AS contract_status,k.client_id,k.template_key,k.created_by_account_id,k.sent_by_account_id FROM contracts k
    JOIN clients c ON c.id=k.client_id AND c.org_id=k.org_id WHERE k.id=$1`, [id])).rows[0];
  const record = row?.custom_fields?.blueprint_seller_sale;
  if (!record || record.contract_id !== id || record.client_id !== row.id || record.org_id !== row.org_id) throw fail();
  try { resolveOfferAmountCents(SELLER_OFFER,record.amount_cents); } catch { throw fail(); }
  const expected = Buffer.from(handoffSignature(record, secretFromEnv(env)), "hex");
  if (!timingSafeEqual(expected, Buffer.from(sig, "hex"))) throw fail();
  const affiliate = (await db.query(`SELECT a.id,a.status FROM affiliates a JOIN accounts ac ON ac.affiliate_id=a.id AND ac.org_id=a.org_id WHERE a.id=$1 AND a.org_id=$2 AND ac.id=$3 AND ac.kind='affiliate' AND ac.status='active'`, [record.affiliate_id, record.org_id, record.account_id])).rows[0];
  if (!sellerCapability({ kind: "affiliate", orgId: record.org_id, accountId: record.account_id, affiliateId: record.affiliate_id }, affiliate, env).enabled) throw fail();
  if ((row.created_by_account_id && row.created_by_account_id!==record.account_id)
    || (row.sent_by_account_id && row.sent_by_account_id!==record.account_id)) throw fail();
  if (row.template_key !== "BLUEPRINT-SELF-FUNDING-AGREEMENT" || !["sent","viewed","signed"].includes(row.contract_status)) throw fail();
  // The permanent email can be opened as soon as the real agreement is sent.
  // Financing preparation must not prevent the buyer from reading/signing it.
  if (row.contract_status !== "signed") {
    const inner = signContractUrl({ contractId: id, secret: secretFromEnv(env), baseUrl: ORIGIN, now });
    const url = new URL(inner.url); url.searchParams.set("return_to", new URL(handoffUrl(record, env)).pathname + new URL(handoffUrl(record, env)).search);
    return url.toString();
  }
  const order = await readOrder(db, record);
  if (!order || !record.financing_verified) throw new SellerError("checkout_preparing","Your agreement is signed. Financing is still being prepared. Open this same link again shortly.",409);
  if (!["created","sent","paid"].includes(order.status)) throw fail();
  if (await verifiedPaid(db, record, order)) return ORIGIN + "/portal-login.html";
  if (order.status === "paid") throw new SellerError("payment_processing", "Your payment is being applied. Open this same link again shortly.", 409);
  const match = await assertBlueprintAgreementPrice(db, { orgId: record.org_id, clientId: record.client_id, amountCents: record.amount_cents, offerKey: SELLER_OFFER });
  if (match.contractId !== id) throw fail();
  if (!/^https:\/\/whop\.com\/checkout\/ch_[a-zA-Z0-9]+\/$/.test(order.checkout_url || "")) throw fail();
  return order.checkout_url;
}
