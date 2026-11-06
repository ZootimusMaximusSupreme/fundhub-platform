import { createHmac } from "node:crypto";
import { secretFromEnv } from "../contracts/signed-link.mjs";
export const HANDOFF_PATH = "/api/public/blueprint-handoff";
export const HANDOFF_ORIGIN = "https://fundhub.ai";
export function handoffSignature(record, secret) {
  return createHmac("sha256", secret).update(["blueprint-seller-handoff-v2",record.org_id,record.affiliate_id,record.account_id,
    record.client_id,record.contract_id,record.payment_link_id,record.amount_cents].join("|")).digest("hex");
}
export function handoffUrl(record, env = process.env, secret = undefined) {
  return HANDOFF_ORIGIN+HANDOFF_PATH+"?"+new URLSearchParams({id:record.contract_id,sig:handoffSignature(record,secret ?? secretFromEnv(env))});
}
// Signing/reminder mail shares the durable outer link, never the expiring
// signing URL. Derive it from the same pinned buyer record as the broker.
export async function sellerHandoffForContract(db, contract, {secret = undefined, env = process.env} = {}) {
  if (!contract.created_by_account_id) return null;
  const row=(await db.query(`SELECT custom_fields FROM clients WHERE id=$1 AND org_id=$2`,[contract.client_id,contract.org_id])).rows[0];
  const record=row?.custom_fields?.blueprint_seller_sale;
  if (!record || record.contract_id!==contract.id || record.client_id!==contract.client_id || record.org_id!==contract.org_id
    || record.account_id!==contract.created_by_account_id || record.amount_cents!==contract.merge_values?._blueprint_amount_cents) {
    throw new Error("The affiliate agreement has no matching permanent buyer handoff");
  }
  return handoffUrl(record,env,secret);
}
