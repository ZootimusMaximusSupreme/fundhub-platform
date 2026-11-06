// Explicit consent for account-facing Plaid Link.
// A grant is bound to one account session and one client/affiliate target. It
// opens one Link token within ten minutes and can be exchanged once within
// thirty minutes after Link opens.
import { hashToken, newToken } from "./session.mjs";
import { bankPasskeyAssurance } from "./passkey-stepup.mjs";
import { withTransaction } from "../db/with-transaction.mjs";

export const CONSENT_VERSION = "plaid-link-2026-11-02";
export const PRIVACY_URL = "https://fundhub.ai/privacy/";
export const CONSENT_TEXT = Object.freeze({
  client_bank: "I agree that Fundhub may collect, process, use, and store my bank account, balance, and transaction data obtained through Plaid for Finance OS. I can disconnect my bank later.",
  affiliate_payout: "I agree that Fundhub may collect, process, use, and store my selected bank account details obtained through Plaid to send my affiliate payouts. I can change my payout bank later."
});
const refused = (status, error) => ({ ok: false, status, error });
export async function authorizeAccountPlaidLink(db, {
  accountId, orgId, sessionId, targetKind, targetId, consent
}) {
  if (consent !== true) return refused(400, "consent_required");
  if (!accountId || !orgId || !sessionId || !targetId ||
      !["client_bank", "affiliate_payout"].includes(targetKind)) return refused(400, "bad_target");
  return withTransaction(db, async (tx) => {
    const proof = await bankPasskeyAssurance(tx, { accountId, orgId, sessionId, targetKind, targetId });
    if (!proof) return refused(403, "passkey_required");
    const token = newToken();
    const scope = targetKind === "client_bank"
      ? ["accounts", "balances", "transactions"] : ["payout_account"];
    const receipt = (await tx.query(
      `INSERT INTO account_plaid_link_grants
         (token_hash,org_id,account_id,account_session_id,target_kind,target_id,
          consent_scope,consent_version,consent_text,privacy_url,mfa_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
       RETURNING id,consent_granted_at,expires_at`,
      [hashToken(token), orgId, accountId, sessionId, targetKind, targetId,
        JSON.stringify(scope), CONSENT_VERSION, CONSENT_TEXT[targetKind], PRIVACY_URL, proof.verified_at]
    )).rows[0];
    return { ok: true, grant_token: token, grant_id: receipt.id,
      consent_granted_at: receipt.consent_granted_at, expires_at: receipt.expires_at };
  });
}

export async function advanceAccountPlaidLink(db, {
  token, orgId, accountId, sessionId, targetKind, targetId, stage
}) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  if (!accountId || !sessionId || !targetId) return null;
  const opening = stage === "open";
  if (!opening && stage !== "exchange") return null;
  return withTransaction(db, async tx => {
  if (!(await bankPasskeyAssurance(tx, { accountId, orgId, sessionId, targetKind, targetId }))) return null;
  const r = await tx.query(
    opening
      ? `UPDATE account_plaid_link_grants SET link_opened_at=now()
          WHERE token_hash=$1 AND org_id=$2 AND account_id=$3 AND account_session_id=$4
            AND target_kind=$5 AND target_id=$6 AND expires_at>now()
            AND link_opened_at IS NULL AND consumed_at IS NULL AND mfa_verified_at IS NOT NULL
          RETURNING id,consent_granted_at,consent_scope`
      : `UPDATE account_plaid_link_grants SET consumed_at=now()
          WHERE token_hash=$1 AND org_id=$2 AND account_id=$3 AND account_session_id=$4
            AND target_kind=$5 AND target_id=$6
            AND link_opened_at>now()-interval '30 minutes' AND consumed_at IS NULL AND mfa_verified_at IS NOT NULL
          RETURNING id,consent_granted_at,consent_scope`,
    [hashToken(token), orgId, accountId, sessionId, targetKind, targetId]
  );
  return r.rows[0] || null;
  });
}
