// Staff authenticator MFA. Password proof creates a short-lived challenge;
// only a valid authenticator or one-use recovery code creates a staff session.
import crypto from "node:crypto";
import { createSession, hashToken, newToken, normalizeIp } from "./session.mjs";
import { withTransaction } from "../db/with-transaction.mjs";

const STEP_SECONDS = 30;
const CHALLENGE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export const mfaRequired = (env = process.env) => env.MFA_REQUIRED === "1";

function keyFromEnv(env) {
  const value = env.MFA_SECRET_ENC_KEY;
  const key = typeof value === "string" ? Buffer.from(value, "base64") : Buffer.alloc(0);
  if (key.length !== 32 || key.toString("base64") !== value) return null;
  return key;
}

export const mfaConfigured = (env = process.env) => !!keyFromEnv(env);

function base32Encode(bytes) {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits -= 5)) & 31]; }
  }
  if (bits) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(input) {
  let bits = 0, value = 0;
  const bytes = [];
  for (const letter of String(input).toUpperCase().replace(/=+$/, "")) {
    const n = ALPHABET.indexOf(letter);
    if (n < 0) return null;
    value = (value << 5) | n;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits -= 8)) & 255); }
  }
  return Buffer.from(bytes);
}

function encryptSecret(secret, staffId, env) {
  const key = keyFromEnv(env);
  if (!key) throw new Error("MFA_SECRET_ENC_KEY is not configured");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(String(staffId)));
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${data.toString("base64")}`;
}

function decryptSecret(ciphertext, staffId, env) {
  const key = keyFromEnv(env);
  if (!key) throw new Error("MFA_SECRET_ENC_KEY is not configured");
  const [version, iv, tag, data] = String(ciphertext).split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Invalid MFA secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(String(staffId)));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export function totpAt(secret, counter) {
  const key = base32Decode(secret);
  if (!key || key.length < 10 || !Number.isSafeInteger(counter) || counter < 0) return null;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac("sha1", key).update(msg).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return String(number).padStart(6, "0");
}

function matchingCounter(secret, code, at = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const current = Math.floor(at / 1000 / STEP_SECONDS);
  for (const offset of [-1, 0, 1]) {
    const counter = current + offset;
    if (counter < 0) continue;
    const expected = totpAt(secret, counter);
    if (expected && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code))) return counter;
  }
  return null;
}

const refuse = (status, error) => ({ ok: false, status, error });

export async function createMfaChallenge(db, { staffId, orgId, ip, userAgent }) {
  const sourceIp = normalizeIp(ip);
  const recent = (await db.query(
    `SELECT COALESCE(sum(attempts),0)::int AS failures,
            count(*) FILTER (WHERE used_at IS NULL AND expires_at>now())::int AS active
       FROM staff_mfa_challenges
      WHERE org_id=$1 AND created_at>now()-interval '15 minutes'
        AND (staff_id=$2 OR ($3::inet IS NOT NULL AND ip=$3::inet))`,
    [orgId, staffId, sourceIp]
  )).rows[0];
  if (Number(recent?.failures || 0) >= 10 || Number(recent?.active || 0) >= 3) {
    return { limited: true };
  }
  const token = newToken();
  await db.query(
    `INSERT INTO staff_mfa_challenges
       (token_hash, org_id, staff_id, expires_at, ip, user_agent)
     VALUES ($1,$2,$3,now() + ($4::int * interval '1 minute'),$5,$6)`,
    [hashToken(token), orgId, staffId, CHALLENGE_MINUTES, sourceIp,
      userAgent == null ? null : String(userAgent).slice(0, 512)]
  );
  const row = (await db.query(
    `SELECT confirmed_at FROM staff_mfa_credentials WHERE staff_id=$1 AND org_id=$2`,
    [staffId, orgId]
  )).rows[0];
  return { token, setupRequired: !row?.confirmed_at };
}

async function loadChallenge(db, token) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const challenge = (await db.query(
    `SELECT c.token_hash, c.org_id, c.staff_id, c.attempts, c.expires_at, c.ip, s.email
       FROM staff_mfa_challenges c
       JOIN staff s ON s.id=c.staff_id AND s.org_id=c.org_id
      WHERE c.token_hash=$1 AND c.used_at IS NULL AND c.expires_at>now()
        AND s.status='active' AND COALESCE((to_jsonb(s)->>'active')::boolean,true)
      FOR UPDATE OF c`, [hashToken(token)]
  )).rows[0];
  if (!challenge) return null;
  const credential = (await db.query(
    `SELECT secret_ciphertext,confirmed_at,last_counter
       FROM staff_mfa_credentials WHERE staff_id=$1 AND org_id=$2 FOR UPDATE`,
    [challenge.staff_id, challenge.org_id]
  )).rows[0] || {};
  return { ...challenge, ...credential };
}

export async function beginMfaSetup(db, { mfaToken, env = process.env }) {
  if (!mfaConfigured(env)) return refuse(503, "mfa_unavailable");
  return withTransaction(db, async (tx) => {
    const challenge = await loadChallenge(tx, mfaToken);
    if (!challenge) return refuse(401, "mfa_challenge_expired");
    if (challenge.attempts >= MAX_ATTEMPTS) return refuse(429, "mfa_challenge_locked");
    if (challenge.confirmed_at) return refuse(409, "mfa_already_enrolled");
    let secret;
    if (challenge.secret_ciphertext) {
      secret = decryptSecret(challenge.secret_ciphertext, challenge.staff_id, env);
    } else {
      secret = base32Encode(crypto.randomBytes(20));
      await tx.query(
        `INSERT INTO staff_mfa_credentials (staff_id,org_id,secret_ciphertext)
         VALUES ($1,$2,$3)
         ON CONFLICT (staff_id) DO NOTHING`,
        [challenge.staff_id, challenge.org_id, encryptSecret(secret, challenge.staff_id, env)]
      );
      // A concurrent setup request may have won the insert. Return its secret.
      const saved = (await tx.query(
        `SELECT secret_ciphertext FROM staff_mfa_credentials
          WHERE staff_id=$1 AND org_id=$2 AND confirmed_at IS NULL`,
        [challenge.staff_id, challenge.org_id]
      )).rows[0];
      if (!saved) return refuse(409, "mfa_already_enrolled");
      secret = decryptSecret(saved.secret_ciphertext, challenge.staff_id, env);
    }
    const label = encodeURIComponent(`Fundhub:${challenge.email}`);
    const issuer = encodeURIComponent("Fundhub");
    return { ok: true, status: 200, secret,
      otpauth_uri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` };
  });
}

function generateRecoveryCodes() {
  return Array.from({ length: 8 }, () => {
    const raw = crypto.randomBytes(16).toString("hex").toUpperCase();
    return `FH-${raw.match(/.{1,8}/g).join("-")}`;
  });
}

function recoveryHash(code) {
  const normalized = String(code).toUpperCase().replace(/^FH-/, "").replace(/[^A-F0-9]/g, "");
  if (normalized.length !== 32) return null;
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export async function verifyMfaChallenge(db, {
  mfaToken, code, ip, userAgent, env = process.env, at = Date.now()
}) {
  if (!mfaConfigured(env)) return refuse(503, "mfa_unavailable");
  return withTransaction(db, async (tx) => {
    const challenge = await loadChallenge(tx, mfaToken);
    if (!challenge) return refuse(401, "mfa_challenge_expired");
    if (challenge.attempts >= MAX_ATTEMPTS) return refuse(429, "mfa_challenge_locked");
    if (!challenge.secret_ciphertext) return refuse(409, "mfa_setup_required");
    // Each attempt is counted across all challenges, including ones obtained
    // before failures began. The credential row lock serializes this check for
    // a staff member so parallel challenge tokens cannot each spend a quota.
    const recent = (await tx.query(
      `SELECT COALESCE(sum(attempts),0)::int AS failures
         FROM staff_mfa_challenges
        WHERE org_id=$1 AND created_at>now()-interval '15 minutes'
          AND (staff_id=$2 OR ($3::inet IS NOT NULL AND ip=$3::inet))`,
      [challenge.org_id, challenge.staff_id, normalizeIp(ip) || challenge.ip || null]
    )).rows[0];
    if (Number(recent?.failures || 0) >= 10) return refuse(429, "too_many_mfa_attempts");
    const secret = decryptSecret(challenge.secret_ciphertext, challenge.staff_id, env);
    const counter = matchingCounter(secret, code, at);
    let verified = counter !== null &&
      (challenge.last_counter == null || counter > Number(challenge.last_counter));
    if (!verified && challenge.confirmed_at) {
      const hash = recoveryHash(code);
      if (hash) {
        const used = (await tx.query(
          `UPDATE staff_mfa_recovery_codes SET used_at=now()
            WHERE staff_id=$1 AND code_hash=$2 AND used_at IS NULL
            RETURNING id`, [challenge.staff_id, hash]
        )).rows[0];
        verified = !!used;
      }
    }
    if (!verified) {
      await tx.query(
        `UPDATE staff_mfa_challenges SET attempts=attempts+1 WHERE token_hash=$1`,
        [challenge.token_hash]
      );
      return refuse(challenge.attempts + 1 >= MAX_ATTEMPTS ? 429 : 401,
        challenge.attempts + 1 >= MAX_ATTEMPTS ? "mfa_challenge_locked" : "invalid_mfa_code");
    }
    let recoveryCodes;
    if (!challenge.confirmed_at) {
      recoveryCodes = generateRecoveryCodes();
      for (const recoveryCode of recoveryCodes) {
        await tx.query(
          `INSERT INTO staff_mfa_recovery_codes (org_id,staff_id,code_hash)
           VALUES ($1,$2,$3)`, [challenge.org_id, challenge.staff_id, recoveryHash(recoveryCode)]
        );
      }
    }
    await tx.query(
      `UPDATE staff_mfa_credentials
          SET confirmed_at=COALESCE(confirmed_at,now()), last_counter=$2, updated_at=now()
        WHERE staff_id=$1`, [challenge.staff_id, counter ?? challenge.last_counter]
    );
    await tx.query(`UPDATE staff_mfa_challenges SET used_at=now() WHERE token_hash=$1`,
      [challenge.token_hash]);
    const session = await createSession(tx, { staffId: challenge.staff_id,
      orgId: challenge.org_id, ip, userAgent, env, mfaVerified: true });
    await tx.query(`UPDATE staff SET last_login_at=now() WHERE id=$1`, [challenge.staff_id]);
    const staff = (await tx.query(
      `SELECT id,org_id,role,email,name FROM staff WHERE id=$1 AND org_id=$2`,
      [challenge.staff_id, challenge.org_id]
    )).rows[0];
    return { ok: true, status: 200, token: session.token,
      expiresAt: session.expiresAt, staff,
      ...(recoveryCodes ? { recovery_codes: recoveryCodes } : {}) };
  });
}
