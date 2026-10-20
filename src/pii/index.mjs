// PII identity — SSN, DOB and addresses, encrypted at rest and access-logged.
//
// `pii_identity` and `pii_access_log` have been in 001_init since the first
// migration, with a comment saying "encrypted at rest, access-logged, surfaced
// only per the Item 2 visibility spec" — and NO CODE TOUCHING EITHER TABLE. The
// schema promised a control that did not exist. This module is that control.
//
// FOUR RULES, ALL ENFORCED HERE RATHER THAN REMEMBERED BY CALLERS:
//
//   1. ENCRYPTED, OR NOT STORED. AES-256-GCM with the client id as additional
//      authenticated data, exactly as src/adplatforms/tokens.mjs does for OAuth
//      tokens. An unset key stops the feature; it never falls back to plaintext.
//      The AAD binding means an SSN copied into another client's row FAILS to
//      decrypt rather than silently becoming that client's SSN — a mis-joined
//      UPDATE cannot quietly attribute one person's identity to another.
//
//   2. MASKED BY DEFAULT. readIdentity() returns `ssn_last4` and never the full
//      number. Seeing all nine digits requires calling revealSsn() — a separate
//      function with a separate name, so no caller reaches it by accident and
//      every reveal is greppable.
//
//   3. NO LOG ROW, NO PLAINTEXT. The access log is written in the same
//      transaction as the reveal, BEFORE the value is returned. If the log write
//      fails, the reveal fails. An access-logged system whose logging is
//      best-effort is an unlogged system with paperwork.
//
//      THIS RULE DID NOT HOLD FOR THE WHOLE TIME IT WAS WRITTEN DOWN. The
//      ordering below was always right — insert the log row, then decrypt — but
//      it ran under AUTOCOMMIT, so "the same transaction" was not a transaction
//      at all. The local withTransaction() probed
//      `typeof db.connect !== "function"` and ran the callback inline when there
//      was none; src/db.mjs exports `db` as `{ query }` with NO connect(), so on
//      the one handle every production caller passes, the probe took the
//      no-transaction branch every time. A failing log INSERT raised AFTER its
//      own statement had already committed, and a reveal could complete with no
//      log row behind it.
//
//      src/finance/soft-pulls.mjs found this same probe, wrote it up, and
//      correctly refused to change a compliance path it did not own. It is fixed
//      now: the local copy is DELETED and src/db/with-transaction.mjs is
//      imported. src/pii/reveal-transaction.test.mjs proves the rule by making
//      the log write fail and asserting no SSN comes back.
//
//   4. A REASON IS REQUIRED. Every reveal records who, what field, and — via the
//      log's own row — when. "Alvin looked at a client's SSN at 14:32 while
//      working inquiry X" is the answer an audit needs; "someone read the table"
//      is not.

import crypto from "node:crypto";
import { withTransaction } from "../db/with-transaction.mjs";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class PiiError extends Error {
  constructor(message, { status = 400 } = {}) {
    super(message);
    this.name = "PiiError";
    this.status = status;
  }
}

/* keyFor — 32 bytes, base64, from env. Separate key from AD_TOKEN_ENC_KEY on
   purpose: an ad token and a social security number should not share a blast
   radius, and rotating one must not force rotating the other. */
function keyFor(keyId = "v1", { env = process.env } = {}) {
  const varName = keyId === "v1" ? "PII_ENC_KEY" : `PII_ENC_KEY_${keyId.toUpperCase()}`;
  const raw = env[varName];
  if (!raw) throw new PiiError(`${varName} is not set — refusing to store identity data unencrypted`, { status: 503 });
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new PiiError(`${varName} must be 32 bytes base64-encoded (got ${key.length})`, { status: 503 });
  return key;
}

/** encryptSsn → Buffer for the bytea column: `v1:<iv>:<tag>:<ct>`, base64 parts. */
export function encryptSsn(plaintext, { clientId, keyId = "v1", env } = {}) {
  if (plaintext == null || plaintext === "") return null;
  if (!clientId) throw new PiiError("encryptSsn: clientId is required — it binds the ciphertext to one person");

  const digits = String(plaintext).replace(/\D/g, "");
  if (digits.length !== 9) throw new PiiError("an SSN must be 9 digits");

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, keyFor(keyId, { env }), iv);
  cipher.setAAD(Buffer.from(String(clientId), "utf8"));
  const ct = Buffer.concat([cipher.update(digits, "utf8"), cipher.final()]);

  return Buffer.from(
    [keyId, iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":"),
    "utf8"
  );
}

/** decryptSsn — throws on tampering, on the wrong client id, on an unknown key. */
export function decryptSsn(stored, { clientId, env } = {}) {
  if (stored == null || stored === "") return null;
  if (!clientId) throw new PiiError("decryptSsn: clientId is required");

  const parts = Buffer.isBuffer(stored) ? stored.toString("utf8").split(":") : String(stored).split(":");
  if (parts.length !== 4) throw new PiiError("malformed ciphertext");
  const [keyId, iv, tag, ct] = parts;

  const decipher = crypto.createDecipheriv(ALGO, keyFor(keyId, { env }), Buffer.from(iv, "base64"));
  decipher.setAAD(Buffer.from(String(clientId), "utf8"));
  const tagBuf = Buffer.from(tag, "base64");
  if (tagBuf.length !== TAG_BYTES) throw new PiiError("malformed ciphertext");
  decipher.setAuthTag(tagBuf);

  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

/** maskSsn — the form that is safe to render: last four only. */
export function maskSsn(digits) {
  if (!digits) return null;
  const d = String(digits).replace(/\D/g, "");
  return d.length === 9 ? d.slice(-4) : null;
}

/**
 * storeIdentity — upsert one client's identity record.
 * One row per client: a person has one SSN and one date of birth, and a second
 * row would make "which is current" a question nobody wants to answer live.
 */
export async function storeIdentity(db, {
  orgId, clientId, ssn, dob = null, addresses = [], nameParts, env
} = {}) {
  if (!orgId || !clientId) throw new PiiError("orgId and clientId are required");
  const enc = ssn == null || ssn === "" ? null : encryptSsn(ssn, { clientId, env });

  /* Middle name and suffix (migration 387). Only a caller that ASKED for them
     writes them: the $297 pull form passes `nameParts`, and a blank there is a
     real answer ("I have no middle name") that clears an old value. Every other
     caller (the staff approve form, the PII endpoint, the sim scripts) never
     asked, so its write leaves whatever is on file alone. */
  if (nameParts && typeof nameParts === "object") {
    const middle = String(nameParts.middleName ?? "").trim() || null;
    const suffix = String(nameParts.suffix ?? "").trim().toUpperCase() || null;
    const res = await db.query(
      `INSERT INTO pii_identity (org_id, client_id, ssn_enc, dob, addresses, middle_name, name_suffix)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (client_id) DO UPDATE SET
         ssn_enc     = COALESCE(EXCLUDED.ssn_enc, pii_identity.ssn_enc),
         dob         = COALESCE(EXCLUDED.dob, pii_identity.dob),
         addresses   = EXCLUDED.addresses,
         middle_name = EXCLUDED.middle_name,
         name_suffix = EXCLUDED.name_suffix,
         updated_at  = now()
       WHERE pii_identity.org_id = EXCLUDED.org_id
       RETURNING id, org_id, client_id, dob, addresses, middle_name, name_suffix, created_at, updated_at`,
      [orgId, clientId, enc, dob, JSON.stringify(addresses ?? []), middle, suffix]
    );
    if (!res.rows[0]) throw new PiiError("client identity is not in this company", { status: 404 });
    return res.rows[0];
  }

  const res = await db.query(
    `INSERT INTO pii_identity (org_id, client_id, ssn_enc, dob, addresses)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (client_id) DO UPDATE SET
       -- COALESCE: an update that omits the SSN must not erase one we hold.
       -- Deleting an identity is a deliberate act, not a side effect of a
       -- partial form submission.
       ssn_enc    = COALESCE(EXCLUDED.ssn_enc, pii_identity.ssn_enc),
       dob        = COALESCE(EXCLUDED.dob, pii_identity.dob),
       addresses  = EXCLUDED.addresses,
       updated_at = now()
     WHERE pii_identity.org_id = EXCLUDED.org_id
     RETURNING id, org_id, client_id, dob, addresses, created_at, updated_at`,
    [orgId, clientId, enc, dob, JSON.stringify(addresses ?? [])]
  );
  // Note the RETURNING list: ssn_enc is not in it. The ciphertext has no reason
  // to travel back through the application on a write path.
  if (!res.rows[0]) throw new PiiError("client identity is not in this company", { status: 404 });
  return res.rows[0];
}

/**
 * readIdentity — the ordinary read. Masked, and NOT logged.
 *
 * WHY THIS ONE IS NOT LOGGED: it does not disclose the protected value. Logging
 * every masked read would bury the reveals — the entries an audit actually cares
 * about — in thousands of page loads. The log is for disclosures, not traffic.
 */
export async function readIdentity(db, { orgId = null, clientId, env } = {}) {
  const res = orgId
    ? await db.query(
      `SELECT id, org_id, client_id, ssn_enc, dob, addresses, created_at, updated_at
         FROM pii_identity WHERE client_id = $1 AND org_id = $2`,
      [clientId, orgId]
    )
    : await db.query(
      `SELECT id, org_id, client_id, ssn_enc, dob, addresses, created_at, updated_at
         FROM pii_identity WHERE client_id = $1`,
      [clientId]
    );
  const row = res.rows[0];
  if (!row) return null;

  const { ssn_enc, ...safe } = row;
  let ssnLast4 = null;
  if (ssn_enc) {
    try {
      ssnLast4 = maskSsn(decryptSsn(ssn_enc, { clientId, env }));
    } catch {
      // A key that is unset or wrong must not blank the whole record — the DOB
      // and addresses are still usable, and the screen should say the SSN is
      // unavailable rather than that the client has none.
      ssnLast4 = null;
    }
  }
  return { ...safe, ssn_present: !!ssn_enc, ssn_last4: ssnLast4 };
}

/**
 * revealSsn — the full number, access-logged, transactionally.
 *
 * The log row is written FIRST and inside the same transaction. A failure to
 * record the access aborts the disclosure: see rule 3 in the header.
 */
export async function revealSsn(db, { orgId = null, clientId, accessedBy, reason = null, env } = {}) {
  if (!clientId) throw new PiiError("clientId is required");
  if (!accessedBy) throw new PiiError("accessedBy is required — an unattributed reveal is not loggable", { status: 401 });

  return withTransaction(db, async (tx) => {
    const row = (orgId
      ? await tx.query(
        `SELECT org_id, ssn_enc FROM pii_identity WHERE client_id = $1 AND org_id = $2`,
        [clientId, orgId]
      )
      : await tx.query(
        `SELECT org_id, ssn_enc FROM pii_identity WHERE client_id = $1`, [clientId]
      )).rows[0];
    if (!row) throw new PiiError("no identity record for this client", { status: 404 });
    if (!row.ssn_enc) throw new PiiError("no SSN on file for this client", { status: 404 });

    await tx.query(
      `INSERT INTO pii_access_log (org_id, client_id, accessed_by, field)
       VALUES ($1,$2,$3,$4)`,
      [row.org_id, clientId, String(accessedBy), reason ? `ssn (${reason})` : "ssn"]
    );

    return { ssn: decryptSsn(row.ssn_enc, { clientId, env }) };
  });
}

/** accessHistory — who has looked at this client's identity, newest first. */
export async function accessHistory(db, { orgId = null, clientId, limit = 100 }) {
  const capped = Math.max(1, Math.min(Number(limit) || 100, 500));
  const res = orgId
    ? await db.query(
      `SELECT id, accessed_by, field, created_at
         FROM pii_access_log WHERE client_id = $1 AND org_id = $2
        ORDER BY created_at DESC LIMIT $3`,
      [clientId, orgId, capped]
    )
    : await db.query(
      `SELECT id, accessed_by, field, created_at
         FROM pii_access_log WHERE client_id = $1
        ORDER BY created_at DESC LIMIT $2`,
      [clientId, capped]
    );
  return res.rows;
}

/* The local copy of withTransaction that used to live here has been DELETED, not
   fixed in place. It probed `typeof db.connect !== "function"` and ran the
   callback inline when there was none — and src/db.mjs exports `db` as
   `{ query }` with NO connect(), so on the one handle every production caller
   passes, that probe took the no-transaction branch and rule 3 above ran under
   AUTOCOMMIT.

   src/db/with-transaction.mjs is the corrected version and is now imported at the
   top of this file. Deleting the copy rather than patching it is the point: three
   near-identical helpers, one of them silently wrong, is how this survived —
   src/finance/soft-pulls.mjs found the same bug, wrote it up, and correctly
   declined to change a compliance path it did not own. */
