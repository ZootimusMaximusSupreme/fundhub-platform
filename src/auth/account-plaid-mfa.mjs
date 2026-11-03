// Authenticator step-up plus explicit consent for account-facing Plaid Link.
// A grant is bound to one account session and one client/affiliate target. It
// opens one Link token within ten minutes and can be exchanged once within
// thirty minutes after Link opens.
import crypto from "node:crypto";
import { base32Encode, encryptSecret, decryptSecret, matchingCounter, mfaConfigured } from "./mfa.mjs";
import { hashToken, newToken } from "./session.mjs";
import { withTransaction } from "../db/with-transaction.mjs";
import { looksLikeEmail, sendStaffCredentialEmail } from "./staff-mail.mjs";

export const CONSENT_VERSION = "plaid-link-2026-11-02";
export const PRIVACY_URL = "https://fundhub.ai/privacy/";
export const CONSENT_TEXT = Object.freeze({
  client_bank: "I agree that Fundhub may collect, process, use, and store my bank account, balance, and transaction data obtained through Plaid for Finance OS. I can disconnect my bank later.",
  affiliate_payout: "I agree that Fundhub may collect, process, use, and store my selected bank account details obtained through Plaid to send my affiliate payouts. I can change my payout bank later."
});
const refused = (status, error) => ({ ok: false, status, error });
const challengeHash = (accountId, code, env) =>
  crypto.createHmac("sha256", env.MFA_SECRET_ENC_KEY).update(`${accountId}:${code}`).digest("hex");

export async function accountMfaSetup(db, {
  accountId, orgId, sessionId, email, env = process.env, at = Date.now(),
  sendEmail = sendStaffCredentialEmail
}) {
  if (!mfaConfigured(env)) return refused(503, "mfa_unavailable");
  if (!accountId || !orgId || !sessionId) return refused(400, "bad_target");
  return withTransaction(db, async (tx) => {
    const existing = (await tx.query(
      `SELECT secret_ciphertext, confirmed_at FROM account_plaid_mfa_credentials
        WHERE account_id=$1 AND org_id=$2 FOR UPDATE`, [accountId, orgId]
    )).rows[0];
    if (existing?.confirmed_at) return { ok: true, enrolled: true };
    const challenge = (await tx.query(
      `SELECT account_session_id,code_hash,expires_at,attempts,verified_at,sent_at
         FROM account_plaid_mfa_email_challenges
        WHERE account_id=$1 AND org_id=$2 FOR UPDATE`, [accountId, orgId]
    )).rows[0];
    const valid = challenge?.account_session_id === sessionId &&
      new Date(challenge.expires_at).getTime() > at;
    if (!valid || !challenge.verified_at) {
      const recentSend = challenge && at - new Date(challenge.sent_at).getTime() < 60_000;
      let sentNow = false;
      if (!recentSend && (!valid || !challenge)) {
        if (!looksLikeEmail(email)) return refused(503, "email_unavailable");
        const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
        const sent = await sendEmail({
          to: email, subject: "Verify your Fundhub bank connection",
          body: `Enter this code in Fundhub to set up bank verification: ${code}\n\nThe code expires in 10 minutes. If you did not request this, ignore this email.`,
          env
        });
        if (!sent?.mailed) return refused(503, "email_send_failed");
        await tx.query(
          `INSERT INTO account_plaid_mfa_email_challenges
             (account_id,org_id,account_session_id,code_hash,expires_at,attempts,verified_at,sent_at)
           VALUES ($1,$2,$3,$4,$5,0,NULL,$6)
           ON CONFLICT (account_id) DO UPDATE SET
             org_id=EXCLUDED.org_id,account_session_id=EXCLUDED.account_session_id,
             code_hash=EXCLUDED.code_hash,expires_at=EXCLUDED.expires_at,
             attempts=0,verified_at=NULL,sent_at=EXCLUDED.sent_at`,
          [accountId, orgId, sessionId, challengeHash(accountId, code, env),
            new Date(at + 600_000), new Date(at)]
        );
        sentNow = true;
      }
      return { ok: true, enrolled: false, email_verification_required: true,
        email_sent: sentNow };
    }
    let secret;
    if (existing) {
      secret = decryptSecret(existing.secret_ciphertext, accountId, env);
    } else {
      secret = base32Encode(crypto.randomBytes(20));
      await tx.query(
        `INSERT INTO account_plaid_mfa_credentials (account_id,org_id,secret_ciphertext)
         VALUES ($1,$2,$3) ON CONFLICT (account_id) DO NOTHING`,
        [accountId, orgId, encryptSecret(secret, accountId, env)]
      );
      const saved = (await tx.query(
        `SELECT secret_ciphertext,confirmed_at FROM account_plaid_mfa_credentials
          WHERE account_id=$1 AND org_id=$2`, [accountId, orgId]
      )).rows[0];
      if (!saved || saved.confirmed_at) return { ok: true, enrolled: true };
      secret = decryptSecret(saved.secret_ciphertext, accountId, env);
    }
    const label = encodeURIComponent(`Fundhub:${email || accountId}`);
    return { ok: true, enrolled: false, secret,
      otpauth_uri: `otpauth://totp/${label}?secret=${secret}&issuer=Fundhub&algorithm=SHA1&digits=6&period=30` };
  });
}

export async function verifyAccountMfaEmail(db, {
  accountId, orgId, sessionId, code, env = process.env, at = Date.now()
}) {
  if (!mfaConfigured(env)) return refused(503, "mfa_unavailable");
  if (!/^\d{6}$/.test(String(code || ""))) return refused(400, "email_code_required");
  return withTransaction(db, async (tx) => {
    const challenge = (await tx.query(
      `SELECT account_session_id,code_hash,expires_at,attempts,verified_at
         FROM account_plaid_mfa_email_challenges
        WHERE account_id=$1 AND org_id=$2 FOR UPDATE`, [accountId, orgId]
    )).rows[0];
    if (!challenge || challenge.account_session_id !== sessionId ||
        new Date(challenge.expires_at).getTime() <= at || Number(challenge.attempts) >= 5) {
      return refused(401, "email_code_expired");
    }
    const expected = Buffer.from(challenge.code_hash, "hex");
    const actual = Buffer.from(challengeHash(accountId, code, env), "hex");
    if (!crypto.timingSafeEqual(expected, actual)) {
      await tx.query(
        `UPDATE account_plaid_mfa_email_challenges SET attempts=attempts+1
          WHERE account_id=$1 AND org_id=$2`, [accountId, orgId]
      );
      return refused(401, "invalid_email_code");
    }
    await tx.query(
      `UPDATE account_plaid_mfa_email_challenges SET verified_at=now()
        WHERE account_id=$1 AND org_id=$2`, [accountId, orgId]
    );
    return { ok: true, email_verified: true };
  });
}

export async function authorizeAccountPlaidLink(db, {
  accountId, orgId, sessionId, targetKind, targetId, code, consent,
  env = process.env, at = Date.now()
}) {
  if (!mfaConfigured(env)) return refused(503, "mfa_unavailable");
  if (consent !== true) return refused(400, "consent_required");
  if (!/^\d{6}$/.test(String(code || ""))) return refused(400, "mfa_code_required");
  if (!accountId || !orgId || !sessionId || !targetId ||
      !["client_bank", "affiliate_payout"].includes(targetKind)) return refused(400, "bad_target");
  return withTransaction(db, async (tx) => {
    const credential = (await tx.query(
      `SELECT secret_ciphertext,confirmed_at,last_counter,failed_attempts,failed_window_at
         FROM account_plaid_mfa_credentials
        WHERE account_id=$1 AND org_id=$2 FOR UPDATE`, [accountId, orgId]
    )).rows[0];
    if (!credential) return refused(409, "mfa_setup_required");
    if (!credential.confirmed_at) {
      const proof = (await tx.query(
        `SELECT verified_at,expires_at FROM account_plaid_mfa_email_challenges
          WHERE account_id=$1 AND org_id=$2 AND account_session_id=$3 FOR UPDATE`,
        [accountId, orgId, sessionId]
      )).rows[0];
      if (!proof?.verified_at || new Date(proof.expires_at).getTime() <= at) {
        return refused(403, "email_verification_required");
      }
    }
    const inWindow = credential.failed_window_at &&
      at - new Date(credential.failed_window_at).getTime() < 15 * 60 * 1000;
    if (inWindow && Number(credential.failed_attempts) >= 5) return refused(429, "mfa_locked");
    const secret = decryptSecret(credential.secret_ciphertext, accountId, env);
    const counter = matchingCounter(secret, code, at);
    if (counter === null ||
        (credential.last_counter != null && counter <= Number(credential.last_counter))) {
      await tx.query(
        `UPDATE account_plaid_mfa_credentials
            SET failed_attempts=$2, failed_window_at=now(), updated_at=now()
          WHERE account_id=$1`, [accountId, inWindow ? Number(credential.failed_attempts) + 1 : 1]
      );
      return refused(401, "invalid_mfa_code");
    }
    await tx.query(
      `UPDATE account_plaid_mfa_credentials
          SET confirmed_at=COALESCE(confirmed_at,now()), last_counter=$2,
              failed_attempts=0, failed_window_at=NULL, updated_at=now()
        WHERE account_id=$1`, [accountId, counter]
    );
    const token = newToken();
    const scope = targetKind === "client_bank"
      ? ["accounts", "balances", "transactions"] : ["payout_account"];
    const receipt = (await tx.query(
      `INSERT INTO account_plaid_link_grants
         (token_hash,org_id,account_id,account_session_id,target_kind,target_id,
          consent_scope,consent_version,consent_text,privacy_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10)
       RETURNING id,consent_granted_at,expires_at`,
      [hashToken(token), orgId, accountId, sessionId, targetKind, targetId,
        JSON.stringify(scope), CONSENT_VERSION, CONSENT_TEXT[targetKind], PRIVACY_URL]
    )).rows[0];
    if (!credential.confirmed_at) {
      await tx.query(
        `DELETE FROM account_plaid_mfa_email_challenges
          WHERE account_id=$1 AND org_id=$2 AND account_session_id=$3`,
        [accountId, orgId, sessionId]
      );
    }
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
  const r = await db.query(
    opening
      ? `UPDATE account_plaid_link_grants SET link_opened_at=now()
          WHERE token_hash=$1 AND org_id=$2 AND account_id=$3 AND account_session_id=$4
            AND target_kind=$5 AND target_id=$6 AND expires_at>now()
            AND link_opened_at IS NULL AND consumed_at IS NULL
          RETURNING id,consent_granted_at,consent_scope`
      : `UPDATE account_plaid_link_grants SET consumed_at=now()
          WHERE token_hash=$1 AND org_id=$2 AND account_id=$3 AND account_session_id=$4
            AND target_kind=$5 AND target_id=$6
            AND link_opened_at>now()-interval '30 minutes' AND consumed_at IS NULL
          RETURNING id,consent_granted_at,consent_scope`,
    [hashToken(token), orgId, accountId, sessionId, targetKind, targetId]
  );
  return r.rows[0] || null;
}
