// Consent comes from the signed contract (owner decision 2026-10-20,
// ops/workflows/set-a-fix-2026-10-20.md items 29/30).
//
// Before: the two consent-screen rows ("Record consent: call_recording" and
// "Record consent: marketing_use") were red until somebody recorded a separate
// consent on consent-capture.html. Chris: no separate consent step is needed.
// The signed contract is the consent, and every client agreement says so
// (db/migrations/492_client_agreement_consent_clauses.sql).
//
// So each row now asks, for the company, three things at once:
//   1. every active client agreement wording carries the clause sentences
//      (a wording that lost them would hand the next client a contract with no
//      consent in it);
//   2. every signed client agreement on a real client carries them in its own
//      frozen copy (contracts.rendered_body, the words the client signed), unless
//      that client also gave a live separate consent of that kind on the
//      consent screen. A signed contract without the clause and without a
//      separate consent is red;
//   3. any consent that WAS recorded separately on the consent screen keeps its
//      frozen words, version, capture method and one exact granter (the old check,
//      unchanged), because the screen still works and still saves rows.
// It reads the company row, so it is judged today even before anyone signs.
//
// The withdraw row keeps its own check (every revoked consent keeps a reason and
// one revoker). With the contract as the consent the withdraw button is rarely
// used, so it is green with "no saved results yet" until the first wrong one.
//
// Read only. Text wordings and text contracts only: an uploaded PDF holds boxes,
// not words, and none exists for a client agreement today.

import { CLIENT_AGREEMENT_KEYS, CONSENT_MARKERS } from "../../../contracts/consent-clauses.mjs";

const KEYS = CLIENT_AGREEMENT_KEYS.map((key) => `'${key}'`).join(", ");

/** The words lack one of the sentences. */
const lacks = (expr, phrases) =>
  `(${phrases.map((p) => `strpos(COALESCE(${expr}, ''), '${p.replace(/'/g, "''")}') = 0`).join(" OR ")})`;

/** A live separately recorded consent of this kind for the contract's client
    (same rule as CONSENT_VALID_SQL in src/consent/index.mjs). */
const liveSeparateConsent = (kind) => `EXISTS (SELECT 1 FROM client_consents k
                                    WHERE k.org_id = c.org_id AND k.client_id = c.client_id AND k.kind = '${kind}'
                                      AND k.revoked_at IS NULL
                                      AND (k.expires_at IS NULL OR k.expires_at > now())
                                      AND k.granted_at <= now())`;

/** A separately recorded consent row of this kind that is badly formed (the old check). */
const badSeparateConsent = (kind) => `EXISTS (SELECT 1 FROM client_consents r
                     WHERE r.org_id = o.id AND r.kind = '${kind}'
                       AND (NULLIF(BTRIM(r.consent_text), '') IS NULL
                            OR NULLIF(BTRIM(COALESCE(r.consent_version, '')), '') IS NULL
                            OR r.capture_method NOT IN ('typed','checkbox','signature')
                            OR ((r.granted_by_kind = 'client') <> (r.granted_by_account_id IS NOT NULL))
                            OR ((r.granted_by_kind = 'staff') <> (r.granted_by_staff_id IS NOT NULL))))`;

export function consentFromContractSql(kind, phrases) {
  return `SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE
         EXISTS (SELECT 1 FROM contract_templates t
                  WHERE t.org_id = o.id AND t.active = true AND t.is_demo = false
                    AND t.source_kind = 'text' AND t.template_key IN (${KEYS})
                    AND ${lacks("t.body", phrases)})
         OR EXISTS (SELECT 1 FROM contracts c
                     LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
                    WHERE c.org_id = o.id AND c.status = 'signed' AND c.is_demo = false
                      AND COALESCE(cl.is_demo, false) = false
                      AND c.source_kind = 'text' AND c.template_key IN (${KEYS})
                      AND ${lacks("c.rendered_body", phrases)}
                      AND NOT ${liveSeparateConsent(kind)})
         OR ${badSeparateConsent(kind)})::int AS bad_count
  FROM orgs o
 WHERE o.id = $1::uuid`;
}

export const CONSENT_RECORDING_PHRASES = Object.freeze([CONSENT_MARKERS.callRecording, CONSENT_MARKERS.ai]);
export const CONSENT_MARKETING_PHRASES = Object.freeze([CONSENT_MARKERS.marketing]);

export const CONSENT_CALL_RECORDING_SQL = consentFromContractSql("call_recording", CONSENT_RECORDING_PHRASES);
export const CONSENT_MARKETING_USE_SQL = consentFromContractSql("marketing_use", CONSENT_MARKETING_PHRASES);

export const CONSENT_REVOKE_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(revoked_reason, '')), '') IS NULL
         OR revoked_by_kind NOT IN ('client','staff')
         OR ((revoked_by_kind = 'client') <> (revoked_by_account_id IS NOT NULL))
         OR ((revoked_by_kind = 'staff') <> (revoked_by_staff_id IS NOT NULL)))::int AS bad_count
  FROM client_consents WHERE org_id = $1::uuid AND revoked_at IS NOT NULL`;

export const CONSENT_FROM_CONTRACT_TEST = "src/pulse/catalog/proofs/consent-from-contract.test.mjs";

const entry = (control, requirement, key, sql, extra = {}) =>
  Object.freeze({ control, mode: "query", requirement, sql: `/* display-result:${key} */\n${sql.trim()}`, ...extra });

export const CONSENT_FROM_CONTRACT_CONTRACTS = Object.freeze([
  entry(
    "Record consent: call_recording",
    "The signed client agreement is the consent (owner decision 2026-10-20). Every active client agreement wording must say that calls may be recorded and that Fundhub uses AI; every signed client agreement on a real client must carry those words in the copy the client signed, unless the client also gave a live separate call-recording consent; and any call-recording consent recorded separately must keep its frozen words, version, capture method and one exact granter.",
    "consent-call-recording",
    CONSENT_CALL_RECORDING_SQL
  ),
  entry(
    "Record consent: marketing_use (permission to use what the client said in ads)",
    "The signed client agreement is the consent (owner decision 2026-10-20). Every active client agreement wording must say that Fundhub may use the client's words, results and testimonial in its marketing; every signed client agreement on a real client must carry those words in the copy the client signed, unless the client also gave a live separate marketing-use consent; and any marketing-use consent recorded separately must keep its frozen words, version, capture method and one exact granter.",
    "consent-marketing-use",
    CONSENT_MARKETING_USE_SQL
  ),
  entry(
    "History table: 'live / not live' state and Withdraw button (asks for a reason in a prompt)",
    "Every revoked consent must preserve its reason and exactly one revoking actor.",
    "consent-revoke",
    CONSENT_REVOKE_SQL,
    { emptyAs: "quiet" }
  )
]);
