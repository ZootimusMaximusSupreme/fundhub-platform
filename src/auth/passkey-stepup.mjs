// Bank-action assurance only. Ordinary password/email-link login is unchanged.
// The verifier validates WebAuthn signatures; this module owns durable scope,
// expiry, replay protection, enrollment/recovery and session assurance.
import { randomBytes } from "node:crypto";
import { generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse } from "@simplewebauthn/server";
import { newToken, hashToken } from "./session.mjs";
import { withTransaction } from "../db/with-transaction.mjs";

export const PASSKEY_RP_ID = "fundhub.ai";
export const PASSKEY_ORIGIN = "https://fundhub.ai";
export const PASSKEY_CHALLENGE_MINUTES = 5;
export const PASSKEY_ASSURANCE_MINUTES = 15;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const denied = (error, status = 403) => ({ ok: false, status, error });
const scope = i => [i.sessionId, i.targetKind, i.targetId];
const cryptoVerifier = { generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse };

export function validBankPasskeyIdentity(i) {
  return !!i && [i.orgId, i.sessionId, i.targetId].every(v => typeof v === "string" && UUID.test(v)) &&
    ((UUID.test(i.accountId || "") && !i.staffId && ["client_bank", "affiliate_payout"].includes(i.targetKind)) ||
     (UUID.test(i.staffId || "") && !i.accountId && i.targetKind === "company_bank" && i.targetId === i.orgId));
}

// Re-read the live principal/session/target; caller-supplied ids never establish ownership.
async function currentIdentity(db, i) {
  if (!validBankPasskeyIdentity(i)) return null;
  const r = await db.query(i.accountId
    ? `SELECT a.email,a.name,s.created_at>now()-interval '10 minutes' AS fresh_primary
         FROM accounts a JOIN account_sessions s ON s.account_id=a.id AND s.org_id=a.org_id
        WHERE a.id=$1 AND a.org_id=$2 AND a.status='active' AND s.id=$3
          AND s.revoked_at IS NULL AND s.expires_at>now()
          AND ((a.kind='client' AND $4='client_bank' AND a.client_id=$5)
            OR (a.kind IN ('client','affiliate') AND $4='affiliate_payout' AND a.affiliate_id=$5))`
    : `SELECT a.email,a.name,s.created_at>now()-interval '10 minutes' AS fresh_primary
         FROM staff a JOIN sessions s ON s.staff_id=a.id AND s.org_id=a.org_id
        WHERE a.id=$1 AND a.org_id=$2 AND a.role='owner' AND a.status='active'
          AND COALESCE((to_jsonb(a)->>'active')::boolean,true) AND s.id=$3
          AND s.revoked_at IS NULL AND s.expires_at>now() AND $4='company_bank' AND $5=a.org_id`,
    [i.accountId || i.staffId, i.orgId, ...scope(i)]);
  return r.rows[0] || null;
}

async function subject(db, i, create = false) {
  if (create) await db.query(
    `INSERT INTO auth_passkey_subjects(org_id,account_id,staff_id,user_handle)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [i.orgId, i.accountId || null, i.staffId || null, newToken()]);
  const r = await db.query(
    `SELECT * FROM auth_passkey_subjects WHERE org_id=$1
       AND account_id IS NOT DISTINCT FROM $2::uuid AND staff_id IS NOT DISTINCT FROM $3::uuid
     FOR UPDATE`, [i.orgId, i.accountId || null, i.staffId || null]);
  return r.rows[0] || null;
}

async function credentials(db, subjectId) {
  return (await db.query(`SELECT * FROM auth_passkeys WHERE subject_id=$1 AND revoked_at IS NULL
                         ORDER BY created_at,id`, [subjectId])).rows;
}

async function assurance(db, s, i, maxAgeMinutes = PASSKEY_ASSURANCE_MINUTES) {
  return (await db.query(
    `SELECT a.id,a.verified_at,a.expires_at,a.credential_id FROM auth_passkey_assurances a
       JOIN auth_passkeys k ON k.id=a.credential_id AND k.subject_id=a.subject_id
      WHERE a.subject_id=$1 AND a.session_id=$2 AND a.target_kind=$3 AND a.target_id=$4
        AND a.revoked_at IS NULL AND k.revoked_at IS NULL AND a.expires_at>now()
        AND a.verified_at>now()-($5::int * interval '1 minute')
      ORDER BY a.verified_at DESC LIMIT 1`, [s.id, ...scope(i), maxAgeMinutes])).rows[0] || null;
}

// Exported gate used by consent and owner-bank handlers. It does not trust a
// client boolean, a local Face ID unlock, an enrollment or a recovery code.
export async function bankPasskeyAssurance(db, i) {
  if (!validBankPasskeyIdentity(i)) return null;
  return withTransaction(db, async tx => {
    const s = await subject(tx, i);
    if (!s || !(await currentIdentity(tx, i))) return null;
    return assurance(tx, s, i);
  });
}

async function limited(db, subjectId) {
  const r = (await db.query(
    `SELECT COALESCE(sum(attempts),0)::int AS failures,count(*)::int AS issued
       FROM auth_passkey_challenges WHERE subject_id=$1 AND created_at>now()-interval '15 minutes'`,
    [subjectId])).rows[0];
  return Number(r?.failures || 0) >= 10 || Number(r?.issued || 0) >= 40;
}

async function issue(db, s, i, purpose, challenge, authorization = null) {
  const token = newToken();
  await db.query(
    `INSERT INTO auth_passkey_challenges(token_hash,subject_id,session_id,target_kind,target_id,purpose,challenge,enrollment_authorization)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [hashToken(token), s.id, ...scope(i), purpose, challenge, authorization]);
  return token;
}

async function claim(db, s, i, token, purpose) {
  if (!TOKEN.test(token || "")) return null;
  return (await db.query(
    `UPDATE auth_passkey_challenges SET used_at=now()
      WHERE token_hash=$1 AND subject_id=$2 AND session_id=$3 AND target_kind=$4 AND target_id=$5
        AND purpose=$6 AND used_at IS NULL AND expires_at>now() RETURNING *`,
    [hashToken(token), s.id, ...scope(i), purpose])).rows[0] || null;
}

async function fail(db, s, i, challenge) {
  if (challenge) {
    await db.query(`UPDATE auth_passkey_challenges SET attempts=1 WHERE token_hash=$1`, [challenge.token_hash]);
  } else {
    const token = await issue(db, s, i, "failure", newToken());
    await db.query(`UPDATE auth_passkey_challenges SET attempts=1,used_at=now() WHERE token_hash=$1`, [hashToken(token)]);
  }
  return denied("passkey_verification_failed", 401);
}

export function validPasskeyClientData(response) {
  try {
    if (!response || JSON.stringify(response).length > 131072) return false;
    const data = JSON.parse(Buffer.from(response.response.clientDataJSON, "base64url").toString("utf8"));
    return (data.crossOrigin === undefined || data.crossOrigin === false) && data.topOrigin === undefined;
  } catch { return false; }
}

const recoveryHash = code => typeof code === "string" && /^[a-f0-9 -]{40,55}$/i.test(code)
  ? hashToken(code.replace(/[- ]/g, "").toUpperCase()) : null;

async function recoveryCodes(db, subjectId) {
  const existing = (await db.query(`SELECT count(*)::int AS n FROM auth_passkey_recovery_codes
                                   WHERE subject_id=$1 AND revoked_at IS NULL`, [subjectId])).rows[0];
  if (Number(existing?.n || 0)) return undefined;
  const codes = [];
  for (let n = 0; n < 10; n++) {
    const code = randomBytes(20).toString("hex").toUpperCase().match(/.{5}/g).join("-");
    await db.query(`INSERT INTO auth_passkey_recovery_codes(subject_id,code_hash) VALUES ($1,$2)`,
      [subjectId, recoveryHash(code)]);
    codes.push(code);
  }
  return codes;
}

// All credential mutations serialize on one subject, including recovery and
// verification. This makes replay/rate limits/counters durable across workers.
export async function passkeyAction(db, i, body, { verifier = cryptoVerifier } = {}) {
  if (!validBankPasskeyIdentity(i)) return denied("forbidden");
  const known = new Set(["status", "register_options", "register_verify", "authenticate_options",
    "authenticate_verify", "remove", "recover"]);
  if (!known.has(body?.action)) return denied("action_required", 400);
  return withTransaction(db, async tx => {
    // subject lock always precedes credential/challenge locks and liveness checks.
    if (!(await currentIdentity(tx, i))) return denied("forbidden");
    const s = await subject(tx, i, true);
    const actor = await currentIdentity(tx, i);
    if (!actor) return denied("forbidden");
    const keys = await credentials(tx, s.id);
    if (body.action === "status") {
      const proof = await assurance(tx, s, i);
      return { ok: true, enrolled: keys.length > 0, recovery_required: !!s.enrolled_at && !keys.length,
        assured: !!proof, expires_at: proof?.expires_at || null,
        credentials: keys.map(k => ({ id: k.id, name: k.name, created_at: k.created_at })) };
    }
    if (await limited(tx, s.id)) return denied("too_many_passkey_attempts", 429);
    if (body.action === "register_options") {
      if (keys.length >= 10) return denied("passkey_limit", 409);
      let authorization;
      if (body.recovery_token) {
        const recovered = await claim(tx, s, i, body.recovery_token, "recovery");
        if (!recovered || !actor.fresh_primary) return fail(tx, s, i, recovered);
        authorization = "recovery";
      } else if (s.enrolled_at) {
        if (!(await assurance(tx, s, i, 10))) return denied("passkey_required");
        authorization = "passkey";
      } else {
        if (!actor.fresh_primary) return denied("fresh_login_required");
        authorization = "initial";
      }
      const options = await verifier.generateRegistrationOptions({
        rpName: "Fundhub", rpID: PASSKEY_RP_ID, userName: actor.email,
        userDisplayName: actor.name || actor.email, userID: Buffer.from(s.user_handle, "base64url"),
        attestationType: "none", timeout: 300000, supportedAlgorithmIDs: [-7, -257],
        excludeCredentials: keys.map(k => ({ id: k.credential_id, transports: k.transports })),
        authenticatorSelection: { residentKey: "required", userVerification: "required" }
      });
      const token = await issue(tx, s, i, "registration", options.challenge, authorization);
      return { ok: true, challenge_token: token, options };
    }
    if (body.action === "register_verify") {
      const c = await claim(tx, s, i, body.challenge_token, "registration");
      if (!c) return fail(tx, s, i);
      if ((c.enrollment_authorization === "initial" && (s.enrolled_at || !actor.fresh_primary)) ||
          (c.enrollment_authorization === "passkey" && !(await assurance(tx, s, i, 10)))) return fail(tx, s, i, c);
      if (!validPasskeyClientData(body.response)) return fail(tx, s, i, c);
      let result;
      try {
        result = await verifier.verifyRegistrationResponse({ response: body.response,
          expectedChallenge: c.challenge, expectedOrigin: PASSKEY_ORIGIN, expectedRPID: PASSKEY_RP_ID,
          requireUserPresence: true, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
      } catch { return fail(tx, s, i, c); }
      if (!result.verified || !result.registrationInfo?.userVerified) return fail(tx, s, i, c);
      const info = result.registrationInfo;
      const duplicate = await tx.query(`SELECT id FROM auth_passkeys WHERE credential_id=$1`, [info.credential.id]);
      if (duplicate.rows.length) return fail(tx, s, i, c);
      const label = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
      await tx.query(
        `INSERT INTO auth_passkeys(subject_id,credential_id,public_key,sign_count,transports,device_type,backed_up,name)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,
        [s.id, info.credential.id, Buffer.from(info.credential.publicKey), info.credential.counter,
          JSON.stringify(info.credential.transports || []), info.credentialDeviceType, info.credentialBackedUp, label || "Passkey"]);
      await tx.query(`UPDATE auth_passkey_subjects SET enrolled_at=COALESCE(enrolled_at,now()) WHERE id=$1`, [s.id]);
      return { ok: true, registered: true, assured: false };
    }
    if (body.action === "authenticate_options") {
      if (!keys.length) return denied(s.enrolled_at ? "recovery_required" : "passkey_setup_required", 409);
      const options = await verifier.generateAuthenticationOptions({ rpID: PASSKEY_RP_ID,
        timeout: 300000, userVerification: "required",
        allowCredentials: keys.map(k => ({ id: k.credential_id, transports: k.transports })) });
      return { ok: true, challenge_token: await issue(tx, s, i, "authentication", options.challenge), options };
    }
    if (body.action === "authenticate_verify") {
      const c = await claim(tx, s, i, body.challenge_token, "authentication");
      if (!c) return fail(tx, s, i);
      const k = keys.find(key => key.credential_id === body.response?.id);
      if (!k || !validPasskeyClientData(body.response) ||
          (body.response?.response?.userHandle && body.response.response.userHandle !== s.user_handle)) return fail(tx, s, i, c);
      let result;
      try {
        result = await verifier.verifyAuthenticationResponse({ response: body.response,
          expectedChallenge: c.challenge, expectedOrigin: PASSKEY_ORIGIN, expectedRPID: PASSKEY_RP_ID,
          credential: { id: k.credential_id, publicKey: new Uint8Array(k.public_key),
            counter: Number(k.sign_count), transports: k.transports }, requireUserVerification: true });
      } catch { return fail(tx, s, i, c); }
      if (!result.verified || !result.authenticationInfo?.userVerified ||
          result.authenticationInfo.credentialDeviceType !== k.device_type) return fail(tx, s, i, c);
      await tx.query(`UPDATE auth_passkeys SET sign_count=$2,last_used_at=now(),backed_up=$3 WHERE id=$1`,
        [k.id, result.authenticationInfo.newCounter, result.authenticationInfo.credentialBackedUp]);
      const proof = (await tx.query(
        `INSERT INTO auth_passkey_assurances(subject_id,credential_id,session_id,target_kind,target_id)
         VALUES ($1,$2,$3,$4,$5) RETURNING verified_at,expires_at`, [s.id, k.id, ...scope(i)])).rows[0];
      const codes = await recoveryCodes(tx, s.id);
      return { ok: true, assured: true, ...proof, ...(codes ? { recovery_codes: codes } : {}) };
    }
    if (body.action === "remove") {
      if (!(await assurance(tx, s, i, 10))) return denied("passkey_required");
      const key = keys.find(k => k.id === body.credential_id);
      if (!key) return denied("passkey_not_found", 404);
      if (keys.length < 2) return denied("last_passkey_required", 409);
      await tx.query(`UPDATE auth_passkeys SET revoked_at=now() WHERE id=$1`, [key.id]);
      await tx.query(`UPDATE auth_passkey_assurances SET revoked_at=now() WHERE credential_id=$1 AND revoked_at IS NULL`, [key.id]);
      return { ok: true, removed: true };
    }
    // A recovery code + a fresh primary login only permits one reenrollment.
    // All prior key assurance is revoked; a new UV assertion is still required.
    if (!actor.fresh_primary) return denied("fresh_login_required");
    const hash = recoveryHash(body.recovery_code);
    const code = hash ? (await tx.query(
      `UPDATE auth_passkey_recovery_codes SET used_at=now()
        WHERE subject_id=$1 AND code_hash=$2 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`,
      [s.id, hash])).rows[0] : null;
    if (!code) return fail(tx, s, i);
    await tx.query(`UPDATE auth_passkeys SET revoked_at=now() WHERE subject_id=$1 AND revoked_at IS NULL`, [s.id]);
    await tx.query(`UPDATE auth_passkey_assurances SET revoked_at=now() WHERE subject_id=$1 AND revoked_at IS NULL`, [s.id]);
    await tx.query(`UPDATE auth_passkey_challenges SET used_at=COALESCE(used_at,now()) WHERE subject_id=$1`, [s.id]);
    await tx.query(`UPDATE auth_passkey_recovery_codes SET revoked_at=now() WHERE subject_id=$1 AND revoked_at IS NULL`, [s.id]);
    return { ok: true, recovery_token: await issue(tx, s, i, "recovery", newToken()) };
  });
}
