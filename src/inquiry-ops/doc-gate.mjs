// Identity-packet completeness for inquiry-removal cases.
//
// Required: government photo ID, proof of address, signed authorization.
// SSN card is required only when the dispute includes SSN-related PII.

import { KINDS } from "../documents/kinds.mjs";
import { CONSENT_VALID_SQL } from "../consent/index.mjs";
import { hasFullBlueprintDisputeAuthorization } from "../repair/dispute-auth.mjs";

/* THE SIGNATURE IS FILED IN A DIFFERENT PLACE FROM WHERE THIS USED TO LOOK.
   Measured 2026-09-06, on the funding walkthrough client: the client signed the
   dispute authorization at 03:04 and this desk said the signed authorization was
   missing — and would have said so forever.

   Signing does NOT write a `documents` row. api/consent/capture.mjs writes ONE
   row, into `client_consents` (db/migrations/099), and its document_id column is
   optional and left null on that path. This packet only ever read `documents`,
   so a signature that exists could never satisfy it.

   Both places count now. A signature is a signature whichever table it landed
   in, and which table that is is our filing detail, not something the client can
   be asked to get right.

   TWO KINDS COUNT, and only these two. `dispute_authorization` is the paper that
   authorises preparing and sending a dispute letter — the exact thing this desk
   does. `soft_pull_consent` counts because the documents side of this same check
   has always counted it (PACKET_SUBTYPES.AUTHORIZATION is that string); refusing
   the consent-table copy of a paper we accept as a document would be the same
   split bug in the other direction. Nothing else is added here: a new kind is a
   compliance decision, not a convenience. */
export const AUTHORIZATION_CONSENT_KINDS = Object.freeze([
  "dispute_authorization",
  "soft_pull_consent"
]);

export const PACKET_SUBTYPES = Object.freeze({
  ID: "id_document",
  SSN: "ssn_card",
  PROOF_OF_ADDRESS: "proof_of_address",
  BANK_STATEMENT: "bank_statement",
  AUTHORIZATION: "soft_pull_consent"
});

/** Contact-field hold reasons that block funding work (round_hold_reason). */
export const FUNDING_DOC_HOLD = "Documents Pending Approval";
export const FUNDING_PAUSED_HOLD = "Funding Paused";
export const BLOCKING_FUNDING_HOLDS = Object.freeze([
  FUNDING_DOC_HOLD,
  FUNDING_PAUSED_HOLD
]);

export function isBlockingFundingHold(reason) {
  return BLOCKING_FUNDING_HOLDS.includes(String(reason || ""));
}

/**
 * @param {object[]} documents  rows with { kind, subtype }
 * @param {{ requireSsn?: boolean, signedAuthorization?: boolean }} [opts]
 *   signedAuthorization — true when a live consent row of one of
 *   AUTHORIZATION_CONSENT_KINDS is on file for this client. See the header
 *   above: signing files a consent row, not a document.
 * @returns {{ complete: boolean, missing: string[], present: object }}
 */
export function checkDocPacket(documents, opts = {}) {
  const rows = Array.isArray(documents) ? documents : [];
  const bySubtype = new Set(
    rows
      /* INQUIRY_DOC counts too. The inquiry portal door (251) writes kind
         'inquiry_doc', and its conventional subtypes include 'id_document' —
         the same government photo ID this packet requires. A client who sent
         their ID through the inquiry door has sent their ID; which door it
         arrived by is our filing detail, not something they should have to
         guess right. Before this, hole 17 opened that door and the packet
         still reported the ID missing. */
      .filter((d) => d && (
        d.kind === KINDS.CLIENT_UPLOAD || d.kind === KINDS.AUTHORIZATION
        || d.kind === KINDS.INQUIRY_DOC
        || d.kind === "client_upload" || d.kind === "authorization"
        || d.kind === "inquiry_doc"))
      .map((d) => String(d.subtype || ""))
  );

  const hasId = bySubtype.has(PACKET_SUBTYPES.ID);
  const hasAddress =
    bySubtype.has(PACKET_SUBTYPES.PROOF_OF_ADDRESS) ||
    bySubtype.has(PACKET_SUBTYPES.BANK_STATEMENT);
  const hasAuth =
    opts.signedAuthorization === true ||
    bySubtype.has(PACKET_SUBTYPES.AUTHORIZATION) ||
    rows.some((d) => d && d.kind === KINDS.AUTHORIZATION);
  const hasSsn = bySubtype.has(PACKET_SUBTYPES.SSN);

  const missing = [];
  if (!hasId) missing.push(PACKET_SUBTYPES.ID);
  if (!hasAddress) missing.push(PACKET_SUBTYPES.PROOF_OF_ADDRESS);
  if (!hasAuth) missing.push("authorization");
  if (opts.requireSsn && !hasSsn) missing.push(PACKET_SUBTYPES.SSN);

  /* "MISSING" AND "HERE BUT UNNAMED" ARE NOT THE SAME ANSWER.
     A file that arrives with no label is filed as "other", and this packet
     cannot see it — so a client who has sent their photo ID through a door that
     asked them nothing still reads as "photo ID missing". That sentence is
     false, and a person acting on it chases a client who has already done what
     was asked.
     This does not guess what those files are and it does not count them toward
     any leg — a guess is exactly what put a stranger's licence on a client's
     record. It only reports how many arrived that nobody has described, so a
     screen can say "3 files are here that nobody has named" instead of
     claiming the client sent nothing. */
  const unlabelled = rows.filter((d) => d && (
    d.kind === KINDS.CLIENT_UPLOAD || d.kind === KINDS.INQUIRY_DOC
    || d.kind === "client_upload" || d.kind === "inquiry_doc"
  ) && (!d.subtype || String(d.subtype) === "other")).length;

  return {
    complete: missing.length === 0,
    missing,
    unlabelled,
    present: {
      id_document: hasId,
      proof_of_address: hasAddress,
      authorization: hasAuth,
      ssn_card: hasSsn
    }
  };
}

/** True when any staged/disputed PII item is SSN-related. */
export function disputeNeedsSsn(items = []) {
  return (Array.isArray(items) ? items : []).some((it) => {
    const cat = String(it?.category || it?.kind || "").toLowerCase();
    const name = String(it?.inquiry_name || it?.value || "").toLowerCase();
    return cat.includes("ssn") || name.includes("ssn") || name.includes("social security");
  });
}

export async function loadClientDocuments(db, { orgId, clientId }) {
  const r = await db.query(
    `SELECT id, kind, subtype, title, generated_at
       FROM documents
      WHERE org_id = $1::uuid
        AND client_id = $2::uuid
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY generated_at DESC`,
    [orgId, clientId]
  );
  return r.rows;
}

/* Which of these clients has a LIVE signed authorization on file.
 *
 * The validity rule is NOT copied here. `CONSENT_VALID_SQL` is the exact
 * predicate src/consent/index.mjs evaluates for consentStatus(), imported so
 * there is one copy of it in the repository — its own header explains why a
 * second, hand-typed copy is the defect class this repo keeps finding.
 *
 * RETURNS NULL WHEN THE READ FAILS, for the same reason loadDocPackets does: a
 * signature nobody could look for must not come back looking absent. "We could
 * not check" and "they never signed" are different sentences to the person
 * deciding whether to chase a client for paper they already sent.
 */
export async function loadSignedAuthorizations(db, { orgId, clientIds = [] } = {}) {
  const ids = [...new Set((clientIds || []).filter(Boolean).map(String))];
  if (!orgId || !ids.length) return new Set();
  try {
    const r = await db.query(
      `SELECT DISTINCT client_id
         FROM client_consents
        WHERE org_id = $1::uuid
          AND client_id = ANY($2::uuid[])
          AND kind = ANY($3::text[])
          AND (${CONSENT_VALID_SQL})`,
      [orgId, ids, [...AUTHORIZATION_CONSENT_KINDS]]
    );
    return new Set((r.rows || []).map((row) => String(row.client_id)));
  } catch {
    return null;
  }
}

/** The same question for one client. Fail-closed: a read that throws is `false`,
 *  because this one feeds the SEND gate and a gate that cannot check must not
 *  open. The queue read above is the opposite — it says "not checked". */
export async function hasSignedAuthorization(db, { orgId, clientId } = {}) {
  if (!orgId || !clientId) return false;
  const found = await loadSignedAuthorizations(db, { orgId, clientIds: [clientId] });
  return found ? found.has(String(clientId)) : false;
}

/**
 * Evaluate the packet for a client given disputable items.
 */
export async function evaluateDocGate(db, { orgId, clientId, items = [] }) {
  const docs = await loadClientDocuments(db, { orgId, clientId });
  const signed = await hasSignedAuthorization(db, { orgId, clientId })
    || await hasFullBlueprintDisputeAuthorization(db, { orgId, clientId });
  return checkDocPacket(docs, {
    requireSsn: disputeNeedsSsn(items),
    signedAuthorization: signed
  });
}

/* loadDocPackets — the same answer, for a whole queue, in one query.
 *
 * The Specialist's case list needs this per row, and calling evaluateDocGate()
 * a hundred times is a hundred round trips. One lift, grouped in memory, the
 * way src/fulfillment/read-signals.mjs:199-207 already does it — same two
 * columns, same live-document filter.
 *
 * requireSsn is deliberately left off, matching src/handlers/inquiry-docs.mjs
 * :82,103: the SSN card is only required when the dispute itself touches SSN
 * data, and which items are staged is not known from the case row alone. The
 * authoritative check still runs inside src/inquiry-ops/send.mjs before
 * anything is posted; this is the queue's advance warning, not the gate.
 *
 * RETURNS NULL WHEN THE READ FAILS. A packet nobody could check must not come
 * back looking checked — the caller shows "not checked", never "complete".
 */
export async function loadDocPackets(db, { orgId, clientIds = [] } = {}) {
  const ids = [...new Set((clientIds || []).filter(Boolean).map(String))];
  const out = new Map();
  if (!orgId || !ids.length) return out;
  let rows;
  try {
    const r = await db.query(
      `SELECT client_id, kind, subtype
         FROM documents
        WHERE org_id = $1::uuid
          AND client_id = ANY($2::uuid[])
          AND (expires_at IS NULL OR expires_at > now())`,
      [orgId, ids]
    );
    rows = r.rows || [];
  } catch {
    return null;
  }
  /* The signatures, in a second one-shot query. Null here means the consent
     table could not be read, and that has to reach the screen as "not checked"
     rather than as "no signature" — same rule as the documents read above. */
  const signed = await loadSignedAuthorizations(db, { orgId, clientIds: ids });
  if (!signed) return null;
  const byClient = new Map();
  for (const row of rows) {
    const key = String(row.client_id);
    if (!byClient.has(key)) byClient.set(key, []);
    byClient.get(key).push(row);
  }
  for (const id of ids) {
    out.set(id, checkDocPacket(byClient.get(id) || [], {
      signedAuthorization: signed.has(id)
    }));
  }
  return out;
}
