import { createHash } from "node:crypto";
import { resolveOfferAmountCents, formatCents } from "../config/offers.mjs";
import { badRequest, conflict } from "./errors.mjs";

export function blueprintAmount(amount) {
  try {
    return resolveOfferAmountCents("UWIQ_DELIVERABLES", amount);
  } catch (err) {
    throw badRequest(err.message, "invalid_blueprint_amount");
  }
}

export function blueprintFeeCents(value) {
  const text = String(value).trim();
  if (!/^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{2})?$/.test(text)) {
    throw badRequest("Choose a Capital Blueprint price from $5,000 to $10,000.", "invalid_blueprint_amount");
  }
  return blueprintAmount(Math.round(Number(text.replace(/[$,]/g, "")) * 100));
}

/** Checkout uses the latest agreement, including a newer draft. A stale older
 * signed agreement must not silently authorize a different current sale. */
export async function assertBlueprintAgreementPrice(db, { orgId, clientId, amountCents } = {}) {
  const chosen = blueprintAmount(amountCents);
  if (!orgId || !clientId) {
    throw conflict("Create and send this client's Blueprint agreement before making the pay link.", "blueprint_agreement_required");
  }
  const { rows } = await db.query(
    `SELECT id, status, merge_values, rendered_body, body_sha
       FROM contracts
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND template_key = 'CAPITAL-BLUEPRINT-AGREEMENT'
        AND status NOT IN ('void', 'declined')
      ORDER BY created_at DESC, id DESC
      LIMIT 1`,
    [orgId, clientId]
  );
  const contract = rows[0];
  if (!contract || !["sent", "viewed", "signed"].includes(contract.status)
      || !contract.rendered_body || !contract.body_sha) {
    throw conflict("Create and send this client's Blueprint agreement before making the pay link.", "blueprint_agreement_required");
  }
  const fee = contract.merge_values?.package_fee;
  let feeCents;
  try { feeCents = blueprintFeeCents(fee); } catch {
    throw conflict("Send a Blueprint agreement with this exact price before making the pay link.", "blueprint_agreement_price_mismatch");
  }
  const storedAmount = contract.merge_values?._blueprint_amount_cents;
  if (feeCents !== chosen || fee !== formatCents(chosen)
      || (storedAmount !== undefined && storedAmount !== chosen)) {
    throw conflict("The Blueprint agreement and pay link must have the same price. Send the matching agreement first.", "blueprint_agreement_price_mismatch");
  }
  const body = String(contract.rendered_body);
  const sha = `sha256:${createHash("sha256").update(Buffer.from(body, "utf8")).digest("hex")}`;
  if (contract.body_sha !== sha || !body.includes(formatCents(chosen))
      || (chosen !== blueprintAmount(undefined) && /five thousand|\$5,000\b/i.test(body))) {
    throw conflict("The saved Blueprint agreement does not match its price record. Send a matching agreement first.", "blueprint_agreement_price_mismatch");
  }
  return { contractId: contract.id, amountCents: chosen };
}
