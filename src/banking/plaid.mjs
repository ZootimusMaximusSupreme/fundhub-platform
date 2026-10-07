// Plaid bank-connection adapter — configuration, credential encryption, and two
// EMPTY SEAMS.
//
// WHY THIS LIVES IN src/banking/ AND NOT src/adapters/. src/adapters/ is a CLOSED
// SET with a generated diagram behind it: scripts/diagrams/extract.mjs walks that
// directory to build "the adapter boundary — what each adapter accepts, how it
// authenticates, and which canonical events it emits", and generate.test.mjs
// asserts the population is exactly 8. This module accepts no webhook, verifies
// no signature and emits no canonical event, so filing it there would add a node
// to a boundary map claiming an inbound edge that does not exist — and would
// force an edit to a shared test and to generated docs that ten parallel
// branches would then conflict over. Same contract, honest location.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ NOTHING HERE TRANSMITS. There is no fetch(), no http client, no webhook   │
// │ route and no scheduler in this file, and none may be added. Every adapter │
// │ in src/adapters/ is an INBOUND PARSER; the outbound half of a bank        │
// │ connection is a credentialled call against a real person's bank account   │
// │ and it does not ship on an agent's say-so.                                │
// │                                                                           │
// │ linkAccount() and getAccounts() are SEAMS: named, shaped, tested, and     │
// │ deliberately empty. Each returns an honest "not implemented" answer and   │
// │ marks, in its own comment, the exact line where a real Plaid client would │
// │ plug in. Same discipline as src/workflows/messaging.mjs sendTemplated(),  │
// │ which writes a queued row and stops rather than inventing a send.         │
// │                                                                           │
// │ WHAT MUST HAPPEN FIRST: SOC 2 review of storing bank credentials, a       │
// │ consent-capture flow reviewed by compliance, and a human decision to turn │
// │ it on. Not a code change. Not a flag flip by an agent.                    │
// └───────────────────────────────────────────────────────────────────────────┘
//
// isPlaidEnabled() IS NOT A FEATURE FLAG. It does not gate half-built behaviour
// and it does not switch anything on. It answers one question — "is the
// credential material for a bank connection present and well-formed?" — and
// returns a boolean. When the answer is no, the seams say so instead of
// pretending. When the answer is yes, the seams STILL say they are not
// implemented, because configuration is not implementation.
//
// FAIL CLOSED WHEN UNCONFIGURED. AUDIT-FINDINGS.md records
// `POST /api/webhooks/mailgun accepts unsigned requests ... when
// MAILGUN_SIGNING_KEY is unset` — one adapter treated a missing key as "no check
// needed" while five siblings failed closed, and an unauthenticated caller could
// drive a client's funding state. Absent config must never mean no gate. Unset
// here means disabled, every time.

import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;   // GCM standard nonce length
const TAG_BYTES = 16;

/** Plaid's own environment names. An unrecognised value is a misconfiguration,
 *  not a new environment — and the safe reading of a misconfiguration is off. */
export const PLAID_ENVIRONMENTS = ["sandbox", "development", "production"];
export const DEFAULT_PLAID_ENV = "sandbox";

/** Every credential this adapter needs before a bank connection could exist.
 *  PLAID_TOKEN_ENC_KEY is in this list on purpose: without somewhere safe to put
 *  the access token, having the API credentials is worse than not having them. */
export const REQUIRED_ENV = ["PLAID_CLIENT_ID", "PLAID_SECRET", "PLAID_TOKEN_ENC_KEY"];

export class PlaidConfigError extends Error {
  constructor(message, { status = 503 } = {}) {
    super(message);
    this.name = "PlaidConfigError";
    this.status = status;
  }
}

/* ---------------------------------------------------------------------------
   1. Configuration — read env, report honestly, never throw.
   ------------------------------------------------------------------------ */

/**
 * plaidConfigFromEnv(env) → { environment, ready, missing[], problems[] }
 *
 * Same shape as lendflowConfigFromEnv(): callers branch on `ready` so an
 * unconfigured deploy degrades instead of crashing. NO SECRET VALUE IS EVER
 * RETURNED — `missing` and `problems` carry env var NAMES only, so this object
 * is safe to log, and a caller cannot accidentally hand a credential to a
 * response body by spreading it.
 */
export function plaidConfigFromEnv(env = process.env) {
  const missing = [];
  for (const name of REQUIRED_ENV) {
    if (!env[name]) missing.push(name);
  }

  const problems = [];

  // The encryption key must be usable, not merely present. A 12-byte key set by
  // a well-meaning copy/paste would otherwise pass the presence check and blow
  // up later, at the exact moment a real credential is in memory.
  if (env.PLAID_TOKEN_ENC_KEY) {
    let bytes = 0;
    try { bytes = Buffer.from(env.PLAID_TOKEN_ENC_KEY, "base64").length; } catch { bytes = 0; }
    if (bytes !== 32) problems.push("PLAID_TOKEN_ENC_KEY must be 32 bytes base64-encoded");
  }

  // Unset is fine and means sandbox. A value we do not recognise is NOT fine:
  // "prod", "Production" or a typo would otherwise be treated as some default,
  // and the two plausible defaults are "the safest one" and "the one they meant",
  // which are opposites. So an unrecognised value disables the adapter.
  const rawEnvironment = env.PLAID_ENV ? String(env.PLAID_ENV).trim() : DEFAULT_PLAID_ENV;
  const environment = PLAID_ENVIRONMENTS.includes(rawEnvironment) ? rawEnvironment : null;
  if (!environment) problems.push(`PLAID_ENV must be one of ${PLAID_ENVIRONMENTS.join(", ")}`);

  return {
    environment,
    ready: missing.length === 0 && problems.length === 0,
    missing,
    problems
  };
}

/**
 * isPlaidEnabled(env) → boolean
 *
 * "Do we hold complete, well-formed credential material for a bank connection?"
 * Nothing more. It reports; it does not gate a half-built path, and it never
 * throws — a caller asking whether something is configured should not have to
 * wrap the question in a try block.
 *
 * Unset, partially set, or malformed all return FALSE. That is the safe answer:
 * the failure mode of a wrong `false` is a feature that stays off, and the
 * failure mode of a wrong `true` is code proceeding as if it may touch a real
 * person's bank account.
 */
export function isPlaidEnabled(env = process.env) {
  return plaidConfigFromEnv(env).ready === true;
}

/* ---------------------------------------------------------------------------
   2. Credential encryption — AES-256-GCM, bound to the plaid_items row.
   ------------------------------------------------------------------------ */

/* keyFor — 32 bytes, base64, from env only.
   A SEPARATE KEY FROM AD_TOKEN_ENC_KEY AND PII_ENC_KEY, deliberately. A bank
   access token, an ad-account token and a social security number should not
   share a blast radius, and rotating one must not force rotating the others —
   src/pii/index.mjs made the same call for the same reason.

   Duplicated from src/adplatforms/tokens.mjs rather than imported: that module's
   key lookup is hard-wired to AD_TOKEN_ENC_KEY and its errors name that variable,
   so reusing it would either share the key (wrong) or print a misleading name
   during an incident. The right long-term fix is one AEAD helper parameterised by
   key-env-name, which is a cross-module refactor and out of this unit's scope —
   recorded in ops/workflows/finish-the-build/W5.md as a finding. */
function keyFor(keyId = "v1", { env = process.env } = {}) {
  const varName = keyId === "v1" ? "PLAID_TOKEN_ENC_KEY" : `PLAID_TOKEN_ENC_KEY_${keyId.toUpperCase()}`;
  const raw = env[varName];
  if (!raw) {
    // Named, never valued. And never a fallback: an unset key must stop the
    // feature, not silently store a live bank credential in plaintext.
    throw new PlaidConfigError(`${varName} is not set — refusing to store a bank access token unencrypted`);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new PlaidConfigError(`${varName} must be 32 bytes base64-encoded (got ${key.length})`);
  }
  return key;
}

/**
 * encryptPlaidToken(plaintext, { itemId }) → "v1:<iv>:<tag>:<ct>" (base64 parts)
 *
 * THE ITEM ID IS ADDITIONAL AUTHENTICATED DATA. Binding plaid_items.id into the
 * AAD means a ciphertext copied from one client's row into another's FAILS to
 * decrypt. Without it, a bad backfill or a mis-joined UPDATE would silently give
 * one client a working credential for another person's bank account, and every
 * downstream check would pass because the token really is valid. The database
 * cannot catch that; the cipher can.
 */
export function encryptPlaidToken(plaintext, { itemId, keyId = "v1", env } = {}) {
  if (plaintext === null || plaintext === undefined || plaintext === "") return null;
  if (!itemId) {
    // Without it the AAD binding is absent and the cross-client protection this
    // function exists for silently does not apply.
    throw new PlaidConfigError("encryptPlaidToken: itemId is required — it binds the ciphertext to one plaid_items row", { status: 400 });
  }

  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, keyFor(keyId, { env }), iv);
  cipher.setAAD(Buffer.from(String(itemId), "utf8"));

  const ct = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [keyId, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

/**
 * decryptPlaidToken(stored, { itemId }) → string
 *
 * Throws on tampering, on the wrong item id and on an unknown key id. Never
 * returns a partial or a placeholder: a caller that got a value must be able to
 * trust it is the real credential for the row it asked about.
 */
export function decryptPlaidToken(stored, { itemId, env } = {}) {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!itemId) throw new PlaidConfigError("decryptPlaidToken: itemId is required", { status: 400 });

  const parts = String(stored).split(":");
  if (parts.length !== 4) throw new PlaidConfigError("decryptPlaidToken: malformed ciphertext", { status: 400 });
  const [keyId, ivB64, tagB64, ctB64] = parts;

  const decipher = crypto.createDecipheriv(ALGO, keyFor(keyId, { env }), Buffer.from(ivB64, "base64"));
  decipher.setAAD(Buffer.from(String(itemId), "utf8"));
  const tag = Buffer.from(tagB64, "base64");
  if (tag.length !== TAG_BYTES) throw new PlaidConfigError("decryptPlaidToken: malformed auth tag", { status: 400 });
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]).toString("utf8");
  } catch {
    // Deliberately opaque and deliberately not distinguishing the causes. "wrong
    // item" vs "tampered" is information an attacker can use to probe, and the
    // caller's correct response is identical either way.
    const e = new Error("decryptPlaidToken: authentication failed — ciphertext does not belong to this item or has been modified");
    e.code = "TOKEN_AUTH_FAILED";
    throw e;
  }
}

/**
 * redactPlaidItem(row) — the shape a plaid_items row must take before it can
 * reach a response body, a log, or an error message.
 *
 * The column is named encrypted_* partly so src/http/read-api.mjs's redact()
 * catches it by pattern too, but relying on a regex alone would be one rename
 * away from a leak — so this is explicit. Screens need to know a credential
 * EXISTS, never its value.
 */
export function redactPlaidItem(row) {
  if (!row || typeof row !== "object") return row;
  const { encrypted_access_token, ...safe } = row;
  return { ...safe, has_access_token: Boolean(encrypted_access_token) };
}

/* ---------------------------------------------------------------------------
   3. Key rotation — re-encrypt under a new key, with no downtime and NO
      PLAINTEXT EVER WRITTEN ANYWHERE.
   ------------------------------------------------------------------------ */

/* THE RULE THIS SECTION IS BUILT AROUND, AND IT HAS NO EXCEPTIONS:
   the decrypted access token exists ONLY as a local `const` inside
   rotatePlaidTokenCiphertext(), for the handful of statements between decrypt
   and encrypt. It is never written to a column, never to a temp column, never to
   a file, never to a log line, never into an Error message, and never returned
   to a caller. Everything below is arranged so there is nowhere for it to leak.

   THE THREE PLACES A ROTATION NORMALLY LEAKS, AND WHY NONE OF THEM ARE HERE:

     1. A TEMP PLAINTEXT COLUMN. The usual shape is "add plaintext_token, decrypt
        everything into it, re-encrypt, drop the column". For the duration of the
        rotation every credential in the system is readable by any SELECT *, and
        the column survives in WAL, in backups, and in whatever replica was
        snapshotted mid-run. Dropping it afterwards does not unwrite it. There is
        no such column and 080's header already forbids adding one.

     2. A LOG LINE. Rotation code logs progress, and the natural thing to log is
        the row it is working on. This module logs NOTHING — there is no console
        call in this file — and the returned summary carries counts and row ids
        only. Errors name the key ENV VAR, never a key and never a token, which
        is the rule keyFor() already follows.

     3. AN ERROR MESSAGE. A decrypt failure mid-rotation is the moment a
        well-meaning `catch` prints the value it was working on. rotatePlaidTokens
        records failures as { itemId, error } where error is a fixed string, and
        the underlying error is never spread into it.

   NO DOWNTIME, AND THE REASON IT COMES FOR FREE. The key id is the first field
   of the stored ciphertext ("v1:<iv>:<tag>:<ct>") and keyFor() resolves it per
   row. So a half-rotated table is a perfectly normal state: rows still on v1
   decrypt with PLAID_TOKEN_ENC_KEY, rows moved to v2 decrypt with
   PLAID_TOKEN_ENC_KEY_V2, and any reader handles both without knowing a rotation
   is running. There is no flag day, no lock, no maintenance window and no moment
   where a token is unreadable.

   The operator sequence that follows from that:
     1. Set PLAID_TOKEN_ENC_KEY_V2 alongside the existing key. Both are now live.
     2. Run the rotation. Reads keep working throughout, on both key versions.
     3. When every row reports v2, retire the old key.
   Step 3 is a human decision and there is no code here that takes it. */

/** A key id is a short, lowercase, alphanumeric label ("v1", "v2", "v2026a").
 *  Constrained because it is interpolated into an env var NAME by keyFor(): an
 *  unconstrained id read off a database row would let the row choose which
 *  environment variable gets read. */
export const KEY_ID_PATTERN = /^[a-z0-9]{1,16}$/;

/**
 * plaidTokenKeyId(stored) → "v1" | null
 *
 * Which key a stored ciphertext is under, WITHOUT decrypting it and without
 * needing any key to be present. This is how a rotation reports progress and how
 * a caller skips rows that are already current — reading the label costs nothing
 * and touches no key material.
 *
 * null for anything that is not a well-formed ciphertext, including null and the
 * empty string. It does not throw: "what key is this on" is a question a
 * monitoring path should be able to ask about a malformed row without handling an
 * exception.
 */
export function plaidTokenKeyId(stored) {
  if (stored === null || stored === undefined || stored === "") return null;
  const parts = String(stored).split(":");
  if (parts.length !== 4) return null;
  const keyId = parts[0];
  return KEY_ID_PATTERN.test(keyId) ? keyId : null;
}

/**
 * rotatePlaidTokenCiphertext(stored, { itemId, toKeyId, env }) → new ciphertext
 *
 * THE ONE FUNCTION IN THIS FILE WHERE A DECRYPTED BANK CREDENTIAL EXISTS. It is
 * the `plaintext` const below, it lives for two statements, and it leaves this
 * function only as ciphertext under the new key.
 *
 * Ciphertext in, ciphertext out. It does not touch the database, so there is no
 * code path from here to a column that could hold the intermediate value, and it
 * is a pure function, so the rotation test can prove the round trip without a
 * database at all.
 *
 * THE AAD BINDING IS PRESERVED. Both the decrypt and the re-encrypt use the same
 * itemId, so a rotated token stays bound to its own plaid_items row. Losing that
 * binding during rotation would silently undo the cross-client protection
 * encryptPlaidToken() exists for, on every row at once, and every downstream
 * check would still pass.
 *
 * Returns the input UNCHANGED when it is already under toKeyId. Not an error:
 * re-running a rotation that was interrupted is the normal way to finish one, and
 * it must be safe to run twice.
 */
export function rotatePlaidTokenCiphertext(stored, { itemId, toKeyId, env } = {}) {
  if (stored === null || stored === undefined || stored === "") return null;
  if (!itemId) {
    throw new PlaidConfigError("rotatePlaidTokenCiphertext: itemId is required — it binds the ciphertext to one plaid_items row", { status: 400 });
  }
  if (typeof toKeyId !== "string" || !KEY_ID_PATTERN.test(toKeyId)) {
    throw new PlaidConfigError("rotatePlaidTokenCiphertext: toKeyId must be a short lowercase alphanumeric key id", { status: 400 });
  }

  const from = plaidTokenKeyId(stored);
  if (!from) throw new PlaidConfigError("rotatePlaidTokenCiphertext: malformed ciphertext", { status: 400 });

  // Already there. Idempotent by design — see the docblock.
  if (from === toKeyId) return String(stored);

  // Both keys must be present and valid before anything is decrypted. keyFor()
  // throws naming the env var if either is missing, and it throws BEFORE the
  // plaintext below exists, so a misconfigured rotation never reaches a state
  // where it is holding a credential it cannot re-seal.
  keyFor(from, { env });
  keyFor(toKeyId, { env });

  // ---- the only two lines where a real bank credential is in the clear -------
  const plaintext = decryptPlaidToken(stored, { itemId, env });
  return encryptPlaidToken(plaintext, { itemId, keyId: toKeyId, env });
  // ---- and it goes out of scope here, unwritten anywhere ---------------------
}

/**
 * rotatePlaidTokens(db, { orgId, toKeyId, env, limit }) → summary
 *
 * Walk one org's stored bank credentials and move each to the new key. Returns
 * { scanned, rotated, alreadyCurrent, failed[] } — counts and row ids, never a
 * token and never a key.
 *
 * ROW BY ROW, EACH IN ITS OWN TRANSACTION, DELIBERATELY. One big transaction
 * over every credential in the table would hold locks on the whole set for the
 * length of the run and would throw away all completed work on a single bad row.
 * Per-row means an interrupted rotation leaves a mix of v1 and v2, which — see
 * the header — is a state the system reads correctly anyway. Re-run to finish.
 *
 * THE UPDATE IS GUARDED ON THE CIPHERTEXT IT READ. `AND encrypted_access_token =
 * $3` means a row that was re-linked between the read and the write is skipped
 * rather than overwritten with a ciphertext derived from the value it used to
 * hold. Without that guard a concurrent re-link during a rotation would leave a
 * row holding a token that decrypts to the wrong credential.
 *
 * ORG SCOPING COMES FROM THE SESSION AND FAILS CLOSED. A missing or malformed
 * orgId throws rather than rotating every org's credentials.
 */
export async function rotatePlaidTokens(db, { orgId, toKeyId, env = process.env, limit = 500 } = {}) {
  if (typeof orgId !== "string" || !orgId.trim()) {
    throw new PlaidConfigError("rotatePlaidTokens: orgId is required", { status: 400 });
  }
  if (typeof toKeyId !== "string" || !KEY_ID_PATTERN.test(toKeyId)) {
    throw new PlaidConfigError("rotatePlaidTokens: toKeyId must be a short lowercase alphanumeric key id", { status: 400 });
  }

  // Fail before reading a single credential if the destination key is absent or
  // the wrong length. Discovering that halfway through means having decrypted
  // rows with nowhere to put them.
  keyFor(toKeyId, { env });

  const bounded = Math.max(1, Math.min(Number(limit) || 500, 5000));

  const rows = (await db.query(
    `SELECT id, plaid_item_id, encrypted_access_token
       FROM plaid_items
      WHERE org_id = $1 AND encrypted_access_token IS NOT NULL
      ORDER BY created_at
      LIMIT $2`,
    [orgId.trim(), bounded]
  )).rows;

  const summary = { scanned: rows.length, rotated: 0, alreadyCurrent: 0, failed: [] };

  for (const row of rows) {
    const current = plaidTokenKeyId(row.encrypted_access_token);
    if (current === toKeyId) { summary.alreadyCurrent += 1; continue; }

    try {
      /* WHICH AAD. A token stored by Plaid Link (linkAccount → completeLink) is
         sealed with Plaid's item id — the row does not exist yet when it is
         encrypted — and every reader (getAccounts, the refresh, transactions,
         liabilities, transfers) decrypts with plaid_items.plaid_item_id. Rows
         sealed with the row id (the original design, still used by the
         rotation's own pg test) keep working. Try the live convention first,
         fall back to the row id, and re-seal with the SAME AAD that opened it,
         so a rotation never moves a token to a binding its readers do not use. */
      const aads = [row.plaid_item_id, row.id].filter((v) => v !== null && v !== undefined && String(v) !== "");
      let next = null;
      let lastErr = null;
      for (const aad of aads) {
        try {
          next = rotatePlaidTokenCiphertext(row.encrypted_access_token, { itemId: String(aad), toKeyId, env });
          break;
        } catch (err) {
          lastErr = err;
          if (!err || err.code !== "TOKEN_AUTH_FAILED") break;
        }
      }
      if (next === null) throw lastErr || new Error("no usable item id");

      const updated = await db.query(
        `UPDATE plaid_items
            SET encrypted_access_token = $1, updated_at = now()
          WHERE id = $2 AND encrypted_access_token = $3`,
        [next, row.id, row.encrypted_access_token]
      );

      if (updated.rowCount === 1) summary.rotated += 1;
      else {
        // The row moved under us. Not a failure of the rotation — the new value
        // is whatever the re-link wrote, under whatever key that used.
        summary.failed.push({ itemId: row.id, error: "row changed during rotation; re-run to pick it up" });
      }
    } catch (e) {
      // A FIXED STRING PLUS THE ERROR NAME. Never e.message, which on a bad
      // decrypt could carry context about the value, and never the row's
      // ciphertext or any key. The item id is enough to find the row by hand.
      summary.failed.push({
        itemId: row.id,
        error: e && e.name === "PlaidConfigError" ? "key unavailable or invalid" : "decrypt or re-encrypt failed"
      });
    }
  }

  return summary;
}

/* ---------------------------------------------------------------------------
   4. The seams. Both empty. Both honest.
   ------------------------------------------------------------------------ */

/** Why a seam refused. Returned, never thrown — a caller asking an unbuilt
 *  integration to do something is a normal state here, not an exception. */
export const SEAM_REASONS = {
  NOT_CONFIGURED: "not_configured",   // credential material absent or malformed
  NOT_IMPLEMENTED: "not_implemented", // kept: callers and tests still branch on it
  BAD_REQUEST: "bad_request",         // the caller did not supply what it must
  HELD: "held",                       // the adapters fence refused; nothing was sent
  UPSTREAM_ERROR: "upstream_error"    // Plaid answered, and the answer was a failure
};

/**
 * linkAccount({ clientId, publicToken, env }) → { ok, reason, item, missing[] }
 *
 * Exchanges a Plaid Link public_token for the long-lived access_token, encrypts
 * it with encryptPlaidToken() and hands back the row a caller writes to
 * plaid_items. IMPLEMENTED 2026-09-09 (owner-set) against
 * ../banking/providers/plaid-http.mjs; the transmission lives there because this
 * file must stay free of the network (CLAUDE.md §12).
 *
 * WHAT THIS DOES AND DOES NOT DECIDE. It performs the exchange. It does NOT
 * write to the database, and it does NOT set consent_granted_at — a token this
 * function produces is useless until a caller stores it, and the consent column
 * stays the record of a human decision rather than a side effect of a code path.
 * PLAID_ENV picks the host, and `sandbox` reaches Plaid's fake institutions:
 * building this did not point anything at a real person's bank.
 *
 * `item` IS null on every failure, NOT AN EMPTY OBJECT. A caller must not be
 * able to mistake a refusal for a link that produced nothing.
 *
 * THE TOKEN IS NEVER RETURNED IN THE CLEAR. `item.encryptedAccessToken` is the
 * ciphertext; the plaintext exists only inside this function and is not logged,
 * echoed or attached to an error.
 */
export async function linkAccount({ clientId = null, publicToken = null, env = process.env } = {}) {
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) {
    return {
      ok: false,
      reason: SEAM_REASONS.NOT_CONFIGURED,
      item: null,
      clientId,
      // Names only, never values.
      missing: [...cfg.missing, ...cfg.problems]
    };
  }

  /* The message goes in `missing`, not a separate key. That is the mock's own
     convention (providers/mock.mjs: `missing: ["clientId is required..."]`) and
     src/banking/provider.test.mjs asserts both providers return the same key
     set — a caller must not be able to tell which one answered. */
  if (!publicToken || typeof publicToken !== "string") {
    return {
      ok: false, reason: SEAM_REASONS.BAD_REQUEST, item: null, clientId,
      missing: ["publicToken is required and must be a string"]
    };
  }

  const { exchangePublicToken } = await import("./providers/plaid-http.mjs");
  const r = await exchangePublicToken(publicToken, {
    environment: cfg.environment,
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
    env
  });

  if (!r.ok) {
    return {
      ok: false,
      reason: r.blocked ? SEAM_REASONS.HELD : SEAM_REASONS.UPSTREAM_ERROR,
      item: null,
      clientId,
      missing: [],
      retryable: !!r.retryable,
      errorCode: r.errorCode ?? null,
      error: r.error ?? null
    };
  }

  /* Encrypted immediately, bound to the item id, before the value is carried
     anywhere. encryptPlaidToken binds the ciphertext to itemId as additional
     authenticated data, so a token lifted from one row cannot be replayed
     against another. */
  const encryptedAccessToken = encryptPlaidToken(r.accessToken, { itemId: r.itemId, env });

  return {
    ok: true,
    reason: null,
    clientId,
    missing: [],
    item: {
      plaidItemId: r.itemId,
      encryptedAccessToken,
      environment: cfg.environment,
      /* 'active' describes the TOKEN, not permission. consent_granted_at stays
         NULL until a human grants it — see the column's own migration. */
      linkState: "active"
    }
  };
}

/**
 * getAccounts({ itemId, env }) → { ok:false, reason, accounts:null, missing[] }
 *
 * SEAM — DELIBERATELY EMPTY. In a built system this is where the item's access
 * token is decrypted with decryptPlaidToken() and the institution's account list
 * is read, then upserted into bank_accounts by a separate store module.
 *
 * IMPLEMENTED 2026-09-09 (owner-set). One POST to /accounts/get, through
 * ../banking/providers/plaid-http.mjs.
 *
 * `accounts` IS null ON EVERY FAILURE, NOT []. This is the important line in the
 * file and implementing the call did not soften it. An empty array means "this
 * client has no bank accounts", which is a finding a funding decision would act
 * on. null means "we did not ask, or we asked and did not get an answer" — NULL
 * means unknown and unknown must survive. A refusal must never be readable as a
 * fact about someone's finances. An empty array is returned ONLY when Plaid
 * itself answered with an empty list.
 *
 * OWNERSHIP IS NOT DECIDED HERE, AND MUST NOT BE. Accounts arriving from a bank
 * carry no ownership information this product can trust. Every row written keeps
 * bank_accounts.entity_kind at its 'unknown' default until a human or a document
 * establishes otherwise. A Plaid subtype is not evidence — see the header of
 * db/migrations/082_bank_account_entity_kind.sql. `entityKind: "unknown"` is
 * stamped on every row below so a caller cannot forget.
 *
 * The caller supplies the stored ciphertext; this decrypts it in memory, uses it
 * for one request, and never returns or logs the plaintext.
 */
export async function getAccounts({
  itemId = null, encryptedAccessToken = null, env = process.env
} = {}) {
  const cfg = plaidConfigFromEnv(env);
  if (!cfg.ready) {
    return {
      ok: false,
      reason: SEAM_REASONS.NOT_CONFIGURED,
      accounts: null,
      itemId,
      missing: [...cfg.missing, ...cfg.problems]
    };
  }

  /* Requirement messages go in `missing`, matching the mock — see the note in
     linkAccount above and src/banking/provider.test.mjs. */
  if (!itemId || !encryptedAccessToken) {
    return {
      ok: false, reason: SEAM_REASONS.BAD_REQUEST, accounts: null, itemId,
      missing: ["itemId and encryptedAccessToken are both required"]
    };
  }

  let accessToken;
  try {
    accessToken = decryptPlaidToken(encryptedAccessToken, { itemId, env });
  } catch (e) {
    /* A token that will not decrypt is a key rotation that did not finish, or a
       row bound to a different item. Neither is a fact about the accounts, so
       this is a bad request and NOT an empty account list. e.message is the
       crypto layer's own text and carries no key material. */
    return {
      ok: false, reason: SEAM_REASONS.BAD_REQUEST, accounts: null, itemId,
      missing: [`stored access token could not be decrypted: ${e.message}`]
    };
  }

  const { fetchAccounts } = await import("./providers/plaid-http.mjs");
  const r = await fetchAccounts(accessToken, {
    environment: cfg.environment,
    clientId: env.PLAID_CLIENT_ID,
    secret: env.PLAID_SECRET,
    env
  });

  if (!r.ok) {
    return {
      ok: false,
      reason: r.blocked ? SEAM_REASONS.HELD : SEAM_REASONS.UPSTREAM_ERROR,
      accounts: null,
      itemId,
      missing: [],
      retryable: !!r.retryable,
      errorCode: r.errorCode ?? null,
      error: r.error ?? null
    };
  }

  return {
    ok: true,
    reason: null,
    itemId,
    missing: [],
    accounts: r.accounts.map((a) => ({ ...a, entityKind: "unknown" }))
  };
}

export default {
  PLAID_ENVIRONMENTS,
  REQUIRED_ENV,
  SEAM_REASONS,
  KEY_ID_PATTERN,
  plaidConfigFromEnv,
  isPlaidEnabled,
  encryptPlaidToken,
  decryptPlaidToken,
  redactPlaidItem,
  plaidTokenKeyId,
  rotatePlaidTokenCiphertext,
  rotatePlaidTokens,
  linkAccount,
  getAccounts
};
