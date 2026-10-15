// Batch 04, part 2: contracts, vault, letter packs, funding rounds, new clients
// and social posts. Same rules as fin-b04-sql-messages.mjs: read only, $1::uuid
// is the company, the answer is sample_count and bad_count.
//
// The lists below (letter offers, product codes, the four core pack files, the
// contract wordings and the values each one is filled with) are read from the
// app's own config when this file loads, then written into the SQL as literals.
// compile-catalog saves the SQL, so a config change makes the saved catalog stale
// and the guard test says so.
//
// Repair cycle 1 (2026-10-15): an independent checker broke the product on
// purpose and found results that were wrong and still counted clean. What changed
// here, query by query, is said above each one.

import { OFFERS, defaultContractValues } from "../../../config/offers.mjs";

const quote = (list) => list.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(", ");

export const LETTER_OFFER_KEYS = Object.freeze(
  Object.values(OFFERS).filter((o) => o.letters).map((o) => o.key).sort()
);
export const PRODUCT_CODES = Object.freeze(
  [...new Set(Object.values(OFFERS).map((o) => o.productCode))].sort()
);
// src/pulse/coverage/gap-underwrite.mjs PACK_SUBTYPES: the four pages the pack
// email promises (the Capital Readiness Summary is owed only on a funding tier).
export const CORE_PACK_SUBTYPES = Object.freeze([
  "credit_analysis_report", "credit_optimization_roadmap", "funding_snapshot", "bank_lender_match_list"
]);
// src/workflows/ds-02-diy-letters.mjs EMAIL_TEMPLATE_KEY and
// src/workflows/u-02-analyzer-complete-delivery.mjs FUNDING_EMAIL_TEMPLATE_KEY.
export const LETTERS_EMAIL_KEY = "EMAIL-DS02-DIY-LETTERS-READY";
export const DELIVERABLES_EMAIL_KEY = "EMAIL-U02-ANALYZER-FUNDING-DELIVERY";

// ── the wordings the catalogue sells ────────────────────────────────────────

/** The combined agreement is reached by tier, not by one offer
    (src/config/offers.mjs resolveContractTemplateKey). */
export const COMBINED_CONTRACT_KEY = "REPAIR-AND-FUNDING-AGREEMENT";

const OFFERS_WITH_CONTRACT = Object.freeze(
  Object.values(OFFERS).filter((o) => o.contractTemplateKey)
);

/** Every wording a client sale can send: one per offer, plus the combined one. */
export const SALE_CONTRACT_KEYS = Object.freeze(
  [...new Set([...OFFERS_WITH_CONTRACT.map((o) => o.contractTemplateKey), COMBINED_CONTRACT_KEY])].sort()
);

/** The wordings the closer's deck can pick: the soft-pull consent has its own send
    button, so it is not one of them. */
export const DECK_CONTRACT_KEYS = Object.freeze(
  [...new Set([
    ...OFFERS_WITH_CONTRACT.filter((o) => o.key !== "SOFT_PULL").map((o) => o.contractTemplateKey),
    COMBINED_CONTRACT_KEY
  ])].sort()
);

/** For each wording, the values the catalogue fills its blanks with
    (defaultContractValues). send.mjs writes these onto the contract and lets a
    typed value win, so a different value on a sent contract is a typed one. */
export const CONTRACT_DEFAULTS = Object.freeze(
  Object.fromEntries(SALE_CONTRACT_KEYS.map((key) => [key, Object.freeze(defaultContractValues({ templateKey: key }))]))
);

/** Which wordings an offer's sale may send. The funding offer also sends the
    combined agreement when the tier is funding plus repair. */
function allowedWordings(offer) {
  return [offer.contractTemplateKey, ...(offer.key === "FUNDING_DFY" ? [COMBINED_CONTRACT_KEY] : [])];
}

// What the closer chose is on the client file two ways: the pay link minted for
// the offer (payment_links.product_id -> products.code = the offer's productCode)
// and the call disposition (custom_fields.closer_deck_disposition.offer_key).
// Alias c is the contract and alias cl its client.
const DISPOSITION_OFFER = "COALESCE(cl.custom_fields->'closer_deck_disposition'->>'offer_key', '')";
const payLinkFor = (code) => `EXISTS (SELECT 1 FROM payment_links pl
                       LEFT JOIN products pr ON pr.org_id = pl.org_id AND pr.id = pl.product_id
                      WHERE pl.org_id = c.org_id AND pl.client_id = c.client_id AND pr.code = '${code}')`;
const chosenOffer = (offer) => `(${DISPOSITION_OFFER} = '${offer.key}' OR ${payLinkFor(offer.productCode)})`;

/** The wording sent is not one the client's chosen offer sells. Judged an hour
    after the send (the pay link and the call outcome may follow it), only for the
    wordings a client sale sends, and only when the file shows a chosen offer at
    all. A funding sale that sent the credit-repair agreement is red; a client with
    a funding pay link and a repair-trial one may be sent either wording. */
const WORDING_NOT_THE_OFFER = `(c.sent_at < now() - interval '1 hour'
             AND c.template_key IN (${quote(SALE_CONTRACT_KEYS)})
             AND (${OFFERS_WITH_CONTRACT.map(chosenOffer).join("\n                  OR ")})
             AND NOT (${OFFERS_WITH_CONTRACT.map((o) => `(${chosenOffer(o)} AND c.template_key IN (${quote(allowedWordings(o))}))`).join("\n                  OR ")}))`;

/** A sent contract whose blank is not the figure the price list prints. Nobody
    types these (owner decision F27); a typed one is the incident class the
    catalogue exists to stop (a contract quoting a figure the pay link does not). */
// A figure like "$200" is written as '' || '$' || '200' so no dollar sign sits next
// to a digit inside the query text (that shape reads as a bind parameter).
const textLiteral = (value) => {
  const s = String(value).replace(/'/g, "''");
  return s.includes("$") ? s.split("$").map((part) => `'${part}'`).join(" || '$' || ") : `'${s}'`;
};
const BLANK_NOT_THE_PRICE_LIST = SALE_CONTRACT_KEYS.flatMap((key) =>
  Object.entries(CONTRACT_DEFAULTS[key]).map(([field, value]) =>
    `(c.template_key = '${key}' AND c.merge_values->>'${field}' IS DISTINCT FROM ${textLiteral(value)})`
  )
).join("\n         OR ");

// ── contracts ───────────────────────────────────────────────────────────────

// Written by src/contracts/send.mjs (create_draft then send) and
// src/contracts/notify.mjs (one email per signer, provider_ref
// 'contract:<contract>:<signer>:<purpose>', to_address the signer's address or the
// live representative's). A signer may be handed the link in person, so the mail is
// owed only when the client or a signer has an email address.
//
// Judged now: the document was registered (send writes document_id), the signing
// email went to the signer it is for, no signer's email failed or sat stuck a whole
// day without a later one going out, and the wording is one the chosen offer sells.
const CONTRACT_BAD = `cl.id IS NULL
         OR t.template_key IS DISTINCT FROM c.template_key
         OR st.id IS NULL
         OR c.document_id IS NULL
         OR c.link_expires_at IS NULL OR c.link_expires_at <= c.sent_at
         OR NOT EXISTS (SELECT 1 FROM contract_signers g WHERE g.contract_id = c.id)
         OR (c.sent_at < now() - interval '1 hour'
             AND (NULLIF(BTRIM(COALESCE(cl.email, '')), '') IS NOT NULL
                  OR EXISTS (SELECT 1 FROM contract_signers g2
                              WHERE g2.contract_id = c.id AND NULLIF(BTRIM(COALESCE(g2.email, '')), '') IS NOT NULL))
             AND NOT EXISTS (SELECT 1 FROM messages m
                              WHERE m.org_id = c.org_id AND m.provider_ref LIKE 'contract:' || c.id::text || ':%'))
         OR EXISTS (SELECT 1 FROM messages mm
                     WHERE mm.org_id = c.org_id AND mm.provider_ref LIKE 'contract:' || c.id::text || ':%'
                       AND NOT EXISTS (SELECT 1 FROM contract_signers sg
                                        WHERE sg.contract_id = c.id AND sg.id::text = split_part(mm.provider_ref, ':', 3)
                                          AND lower(sg.email) = lower(mm.to_address))
                       AND NOT EXISTS (SELECT 1 FROM client_authorized_reps rp
                                         LEFT JOIN accounts ra ON ra.id = rp.account_id
                                        WHERE rp.client_id = c.client_id AND rp.removed_at IS NULL
                                          AND lower(ra.email) = lower(mm.to_address)))
         OR EXISTS (SELECT 1 FROM messages mf
                     WHERE mf.org_id = c.org_id AND mf.provider_ref LIKE 'contract:' || c.id::text || ':%'
                       AND (mf.status = 'failed'
                            OR (mf.status IN ('queued', 'sending') AND mf.created_at < now() - interval '1 day'))
                       AND NOT EXISTS (SELECT 1 FROM messages ms
                                        WHERE ms.org_id = c.org_id AND ms.provider_ref LIKE 'contract:' || c.id::text || ':%'
                                          AND split_part(ms.provider_ref, ':', 3) = split_part(mf.provider_ref, ':', 3)
                                          AND ms.status IN ('sent', 'delivered')))
         OR ${WORDING_NOT_THE_OFFER}`;

export const CONTRACT_SENT_SQL = `
SELECT count(DISTINCT c.id)::int AS sample_count,
       count(DISTINCT c.id) FILTER (WHERE ${CONTRACT_BAD})::int AS bad_count
  FROM contracts c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
  LEFT JOIN contract_templates t ON t.org_id = c.org_id AND t.id = c.template_id
  LEFT JOIN staff st ON st.org_id = c.org_id AND st.id = c.sent_by
 WHERE c.org_id = $1::uuid AND c.is_demo = false
   AND c.sent_at > now() - interval '30 days'`;

/** An active, real wording for this key exists. A pasted-in PDF wording has boxes
    and no words, so it needs none; a text wording must hold the agreement itself,
    not the placeholder send refuses. Alias o is the company. */
const hasRealWording = (key) => `EXISTS (SELECT 1 FROM contract_templates w
                       WHERE w.org_id = o.id AND w.template_key = '${key}' AND w.active = true AND w.is_demo = false
                         AND (w.source_kind IS DISTINCT FROM 'text'
                              OR (NULLIF(BTRIM(COALESCE(w.body, '')), '') IS NOT NULL
                                  AND w.body !~* 'NOT THE REAL AGREEMENT TEXT|>>>\\s*PLACEHOLDER')))`;

// The deck's "Send contract" picks the agreement for the offer it is showing and
// sends it. When no real wording exists for an offer the deck says so on screen and
// saves nothing, so a missing wording is read from the wordings themselves, and
// because that has to be seen even with no contract sent lately, this reads the
// company and asks both questions of it: is every wording the deck can pick there,
// and is any contract sent in the last 30 days wrong (the conditions above).
export const CONTRACT_DECK_SEND_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE
${DECK_CONTRACT_KEYS.map((key) => `         NOT ${hasRealWording(key)}`).join("\n         OR\n")}
         OR EXISTS (SELECT 1 FROM contracts c
                     LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
                     LEFT JOIN contract_templates t ON t.org_id = c.org_id AND t.id = c.template_id
                     LEFT JOIN staff st ON st.org_id = c.org_id AND st.id = c.sent_by
                    WHERE c.org_id = o.id AND c.is_demo = false
                      AND c.sent_at > now() - interval '30 days'
                      AND (${CONTRACT_BAD})))::int AS bad_count
  FROM orgs o
 WHERE o.id = $1::uuid`;

// Every required blank the wording declares (contract_templates.manual_fields,
// rows of {key, label, required}) must hold a value in the contract's
// merge_values, and each blank the catalogue fills (defaultContractValues) must
// hold the catalogue's value: nobody types these, so a different figure is the
// contract quoting a price the pay link does not charge. The wording itself must be
// one the chosen offer sells.
export const CONTRACT_BLANKS_SQL = `
SELECT count(DISTINCT c.id)::int AS sample_count,
       count(DISTINCT c.id) FILTER (WHERE t.id IS NULL
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(t.manual_fields) f
                     WHERE f->>'required' = 'true'
                       AND NULLIF(BTRIM(COALESCE(c.merge_values->>(f->>'key'), '')), '') IS NULL)
         OR ${BLANK_NOT_THE_PRICE_LIST}
         OR ${WORDING_NOT_THE_OFFER})::int AS bad_count
  FROM contracts c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
  LEFT JOIN contract_templates t ON t.org_id = c.org_id AND t.id = c.template_id
 WHERE c.org_id = $1::uuid AND c.is_demo = false
   AND c.source_kind = 'text' AND c.sent_at > now() - interval '30 days'`;

// The panel lists active wordings (GET /api/read/contracts?view=templates&active_only=1).
// send.mjs refuses a wording that still carries the placeholder marker.
export const CONTRACT_WORDINGS_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(t.template_key, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(t.name, '')), '') IS NULL
         OR NULLIF(BTRIM(COALESCE(t.signature_statement, '')), '') IS NULL
         OR (t.source_kind = 'text'
             AND (NULLIF(BTRIM(COALESCE(t.body, '')), '') IS NULL
                  OR t.body ~* 'NOT THE REAL AGREEMENT TEXT|>>>\\s*PLACEHOLDER')))::int AS bad_count
  FROM contract_templates t
 WHERE t.org_id = $1::uuid AND t.active = true AND t.is_demo = false`;

// Written by src/finance/document-vault.mjs decideDocument (status 'rejected').
// The reason is what the client reads; a reject sets covers 1 and no period.
export const VAULT_REJECT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE d.client_id IS DISTINCT FROM r.client_id
         OR d.kind NOT IN ('client_upload', 'inquiry_doc')
         OR s.id IS NULL
         OR r.covers <> 1 OR r.period_end IS NOT NULL
         OR NULLIF(BTRIM(COALESCE(r.reason, '')), '') IS NULL)::int AS bad_count
  FROM document_vault_reviews r
  LEFT JOIN documents d ON d.org_id = r.org_id AND d.id = r.document_id
  LEFT JOIN staff s ON s.org_id = r.org_id AND s.id = r.reviewed_by_staff_id
 WHERE r.org_id = $1::uuid AND r.status = 'rejected'`;

// Written by src/sales/closer-deck.mjs generateDeckLetters through
// persistDiyPackageFiles (generated_by 'closer-deck', source_event_id
// 'closer-deck-letters:<client>:<offer>:<file>') and sendTemplated (provider_ref
// 'workflow:<template>:closer-deck-letters:<client>:<offer>').
export const DECK_LETTERS_SQL = `
SELECT count(DISTINCT d.id)::int AS sample_count,
       count(DISTINCT d.id) FILTER (WHERE cl.id IS NULL
         OR d.kind IS DISTINCT FROM 'deliverable'
         OR d.mime_type IS DISTINCT FROM 'application/pdf'
         OR COALESCE(d.byte_size, 0) <= 0
         OR NULLIF(BTRIM(COALESCE(d.storage_key, '')), '') IS NULL
         OR d.checksum IS NULL
         OR split_part(d.source_event_id, ':', 3) NOT IN (${quote(LETTER_OFFER_KEYS)})
         OR (d.generated_at < now() - interval '1 hour' AND em.id IS NULL))::int AS bad_count
  FROM documents d
  LEFT JOIN clients cl ON cl.org_id = d.org_id AND cl.id = d.client_id
  LEFT JOIN messages em ON em.org_id = d.org_id AND em.client_id = d.client_id
       AND em.template_key = '${LETTERS_EMAIL_KEY}'
       AND em.provider_ref LIKE 'workflow:${LETTERS_EMAIL_KEY}:closer-deck-letters:' || d.client_id::text || ':%'
 WHERE d.org_id = $1::uuid AND d.generated_by = 'closer-deck'
   AND d.source_event_id LIKE 'closer-deck-letters:%'
   AND d.is_demo = false AND d.generated_at > now() - interval '30 days'`;

// The education route: persistFundingLetterFiles (source_event_id
// 'closer-deck-deliverables:<client>:<offer>:<subtype>', generated_by
// 'closer-deck'), then the funding delivery email. One row per client.
//
// The sample is every client the deck produced a pack for on the education route:
// one who got deliverables files, or one the call was logged on the EDUCATION route
// who got the repair letter pack instead (F41: the education button saved the
// letter pack). The four core pack pages must each be there AND have come from this
// button: a page an earlier workflow wrote for the client does not count for it.
// The delivery email must be there an hour later and not failed or stuck.
export const DECK_DELIVERABLES_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE
${CORE_PACK_SUBTYPES.map((s) => `         NOT EXISTS (SELECT 1 FROM documents k WHERE k.org_id = cl.org_id AND k.client_id = cl.id
                      AND k.kind = 'deliverable' AND k.subtype = '${s}'
                      AND k.generated_by = 'closer-deck' AND k.source_event_id LIKE 'closer-deck-deliverables:%')`).join("\n         OR\n")}
         OR EXISTS (SELECT 1 FROM documents b WHERE b.org_id = cl.org_id AND b.client_id = cl.id
                     AND b.generated_by = 'closer-deck' AND b.source_event_id LIKE 'closer-deck-deliverables:%'
                     AND (b.kind IS DISTINCT FROM 'deliverable'
                          OR COALESCE(b.byte_size, 0) <= 0
                          OR NULLIF(BTRIM(COALESCE(b.storage_key, '')), '') IS NULL
                          OR b.checksum IS NULL
                          OR split_part(b.source_event_id, ':', 3) NOT IN (${quote(LETTER_OFFER_KEYS)})))
         OR (EXISTS (SELECT 1 FROM documents o WHERE o.org_id = cl.org_id AND o.client_id = cl.id
                      AND o.generated_by = 'closer-deck' AND o.source_event_id LIKE 'closer-deck-%'
                      AND o.generated_at < now() - interval '1 hour')
             AND NOT EXISTS (SELECT 1 FROM messages em WHERE em.org_id = cl.org_id AND em.client_id = cl.id
                              AND em.template_key = '${DELIVERABLES_EMAIL_KEY}'
                              AND em.provider_ref LIKE 'workflow:${DELIVERABLES_EMAIL_KEY}:closer-deck-letters:' || cl.id::text || ':%'
                              AND COALESCE(em.status, '') <> 'failed'
                              AND NOT (em.status IN ('queued', 'sending') AND em.created_at < now() - interval '1 day'))))::int AS bad_count
  FROM clients cl
 WHERE cl.org_id = $1::uuid AND cl.is_demo = false
   AND (EXISTS (SELECT 1 FROM documents x WHERE x.org_id = cl.org_id AND x.client_id = cl.id
                 AND x.generated_by = 'closer-deck' AND x.source_event_id LIKE 'closer-deck-deliverables:%'
                 AND x.is_demo = false AND x.generated_at > now() - interval '30 days')
        OR (cl.custom_fields->'closer_deck_disposition'->>'route' = 'EDUCATION'
            AND EXISTS (SELECT 1 FROM documents y WHERE y.org_id = cl.org_id AND y.client_id = cl.id
                         AND y.generated_by = 'closer-deck' AND y.source_event_id LIKE 'closer-deck-letters:%'
                         AND y.is_demo = false AND y.generated_at > now() - interval '30 days')))`;

// ── funding rounds ──────────────────────────────────────────────────────────

// Written by src/funding/card-stacking-rounds.mjs emitCardStackingRoundTransition
// (the pipeline drop and the MOVE menu call it, as do the control panel buttons)
// AFTER src/workflows/cards.mjs moveCardToStage has already moved the card, and that
// function keeps the move when the emit fails ("never undo the move for an emit
// failure"). So the sample is the CARDS sitting in the column, not the events:
// a card dropped on the column whose event was lost leaves nothing else to read.
//
// For every card that entered the stage in the last 30 days: the round event for
// that stage must exist (after an hour), carry the stage, rail, product, a round
// number and its key, and an hour later the round row must exist and the client
// must have a follow-up that was not lost: a text (unless opted out) and an email
// that exist and are not failed and not stuck a whole day in the queue. The
// approvals workflow (f-04) says nothing unless approvedAmount is above zero, so
// that follow-up is judged only for an event that carries an amount.
function roundSql({ event, stage, textKey, emailKey, needsAmount = false }) {
  const healthy = (alias) => `COALESCE(${alias}.status, '') <> 'failed'
                       AND NOT (${alias}.status IN ('queued', 'sending') AND ${alias}.created_at < now() - interval '1 day')`;
  const follow = [];
  if (textKey) {
    follow.push(`(NOT EXISTS (SELECT 1 FROM messages mt WHERE mt.org_id = e.org_id
                       AND mt.provider_ref = 'workflow:${textKey}:' || e.id::text
                       AND ${healthy("mt")})
                AND NOT EXISTS (SELECT 1 FROM opt_outs o WHERE o.client_id = e.client_id
                       AND o.channel = 'sms' AND o.opted_in_at IS NULL))`);
  }
  if (emailKey) {
    follow.push(`NOT EXISTS (SELECT 1 FROM messages me WHERE me.org_id = e.org_id
                       AND me.provider_ref = 'workflow:${emailKey}:' || e.id::text
                       AND ${healthy("me")})`);
  }
  const unsent = `(${follow.join("\n              OR ")})`;
  const followUp = needsAmount
    ? `(CASE WHEN COALESCE(e.payload->>'approvedAmount', '') ~ '^[0-9]+([.][0-9]+)?$'
                  THEN (e.payload->>'approvedAmount')::numeric ELSE 0 END > 0
              AND ${unsent})`
    : unsent;
  return `
SELECT count(DISTINCT cd.id)::int AS sample_count,
       count(DISTINCT cd.id) FILTER (WHERE (e.id IS NULL AND cd.entered_at < now() - interval '1 hour')
         OR (e.id IS NOT NULL AND (e.payload->>'stage' IS DISTINCT FROM '${stage}'
              OR e.payload->>'source' IS DISTINCT FROM 'card_stacking'
              OR e.payload->>'rail' IS DISTINCT FROM 'card_stacking'
              OR e.payload->>'product' IS DISTINCT FROM 'card_stacking'
              OR COALESCE(e.payload->>'roundNumber', '') !~ '^[1-9][0-9]*$'
              OR e.idempotency_key IS DISTINCT FROM 'card_stacking:' || e.client_id::text || ':'
                   || COALESCE(e.payload->>'roundNumber', '') || ':${stage}:${event}'
              OR (e.created_at < now() - interval '1 hour' AND (fr.id IS NULL
                   OR ${followUp})))))::int AS bad_count
  FROM cards cd
  LEFT JOIN pipelines pl ON pl.org_id = cd.org_id AND pl.id = cd.pipeline_id
  LEFT JOIN pipeline_stages ps ON ps.org_id = cd.org_id AND ps.id = cd.stage_id
  LEFT JOIN clients cl ON cl.org_id = cd.org_id AND cl.id = cd.client_id
  LEFT JOIN events e ON e.org_id = cd.org_id AND e.client_id = cd.client_id
       AND e.name = '${event}' AND e.is_demo = false
       AND e.idempotency_key LIKE 'card_stacking:' || cd.client_id::text || ':%:${stage}:${event}'
  LEFT JOIN funding_rounds fr ON fr.org_id = e.org_id AND fr.client_id = e.client_id
       AND fr.round_number::text = e.payload->>'roundNumber'
 WHERE cd.org_id = $1::uuid AND pl.key = 'funding_card_stacking' AND ps.key = '${stage}'
   AND cl.is_demo = false AND cd.entered_at > now() - interval '30 days'`;
}

export const ROUND_STARTED_SQL = roundSql({
  event: "round.started", stage: "apply_now", textKey: "SMS-ROUND-STARTED-NOTIFY"
});
export const ROUND_SUBMITTED_NOTIFY_SQL = roundSql({
  event: "round.submitted", stage: "round_submitted",
  textKey: "SMS-F03-ROUND-SUBMITTED", emailKey: "EMAIL-F03-ROUND-SUBMITTED"
});
export const ROUND_APPROVED_SQL = roundSql({
  event: "round.approved", stage: "approved", needsAmount: true,
  textKey: "SMS-F04-ROUND-APPROVALS", emailKey: "EMAIL-F04-ROUND-APPROVALS"
});
export const ROUND_CLOSEOUT_NOTIFY_SQL = roundSql({
  event: "round.closeout", stage: "closed",
  textKey: "SMS-N04-POST-FUNDING", emailKey: "EMAIL-N04-POST-FUNDING"
});

// ── new clients ─────────────────────────────────────────────────────────────

// Written by api/pipeline-clients.mjs: resolveClient (finds the client by email or
// creates one from the typed name and phone; a found client keeps what the file
// already holds), custom_fields.product, then emit entry.captured (key
// 'pipeline-client:<org>:<email>') which s-00-welcome answers with an email and a
// text and the lifecycle handler places on the Sales board.
//
// Judged: the client file holds the typed email, a first name, and a phone a
// provider can dial (E.164; the funnel door once saved "(661) 605-4248" as typed
// and the welcome text failed); a client this save created has the typed first
// name; the file holds a listed product; an hour later a card sits on the Sales
// board and the welcome email and text exist and are not failed or stuck. s-00
// welcomes a client once (a lock on the client file), so a person welcomed through
// an earlier door is judged by "was this client ever welcomed". A product typed on
// a second save of the same email is written to the file but its event is deduped
// by the key, so the file is only required to hold a LISTED product, not this
// event's product. A client archived since then has no cards (crm_archived_at).
export const PIPELINE_NEW_CLIENT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(e.payload->>'name', '')), '') IS NULL
         OR COALESCE(e.payload->>'email', '') !~ '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
         OR NULLIF(BTRIM(COALESCE(e.payload->>'phone', '')), '') IS NULL
         OR COALESCE(e.payload->>'product', '') NOT IN (${quote(PRODUCT_CODES)})
         OR COALESCE(cl.custom_fields->>'product', '') NOT IN (${quote(PRODUCT_CODES)})
         OR lower(COALESCE(cl.email, '')) IS DISTINCT FROM lower(COALESCE(e.payload->>'email', ''))
         OR NULLIF(BTRIM(COALESCE(cl.first_name, '')), '') IS NULL
         OR COALESCE(cl.phone, '') !~ '^\\+[1-9][0-9]{7,14}$'
         OR (cl.created_at > e.created_at - interval '5 minutes'
             AND cl.first_name IS DISTINCT FROM split_part(BTRIM(COALESCE(e.payload->>'name', '')), ' ', 1))
         OR e.idempotency_key IS DISTINCT FROM 'pipeline-client:' || e.org_id::text || ':'
              || lower(COALESCE(e.payload->>'email', ''))
         OR (e.created_at < now() - interval '1 hour' AND (
              (cl.custom_fields->>'crm_archived_at' IS NULL
               AND NOT EXISTS (SELECT 1 FROM cards k
                                LEFT JOIN pipelines kp ON kp.org_id = k.org_id AND kp.id = k.pipeline_id
                               WHERE k.org_id = e.org_id AND k.client_id = e.client_id AND kp.key = 'sales'))
              OR NOT EXISTS (SELECT 1 FROM messages me WHERE me.org_id = e.org_id AND me.client_id = e.client_id
                              AND me.template_key = 'EMAIL-S00-WELCOME'
                              AND COALESCE(me.status, '') <> 'failed'
                              AND NOT (me.status IN ('queued', 'sending') AND me.created_at < now() - interval '1 day'))
              OR (NOT EXISTS (SELECT 1 FROM messages mt WHERE mt.org_id = e.org_id AND mt.client_id = e.client_id
                              AND mt.template_key = 'SMS-S00-WELCOME'
                              AND COALESCE(mt.status, '') <> 'failed'
                              AND NOT (mt.status IN ('queued', 'sending') AND mt.created_at < now() - interval '1 day'))
                  AND NOT EXISTS (SELECT 1 FROM opt_outs o WHERE o.client_id = e.client_id
                              AND o.channel = 'sms' AND o.opted_in_at IS NULL)))))::int AS bad_count
  FROM events e
  LEFT JOIN clients cl ON cl.org_id = e.org_id AND cl.id = e.client_id
 WHERE e.org_id = $1::uuid AND e.name = 'entry.captured'
   AND e.payload->>'source' = 'pipeline' AND e.is_demo = false
   AND e.created_at > now() - interval '30 days'`;

// ── social posts ────────────────────────────────────────────────────────────

// Written by api/social/posts.mjs decideHeldPost (approve): one statement sets
// approved_at, approved_by and status 'queued' on social_posts, and the queue
// row mirrors as 'scheduled'. Only that route sets approved_at, and only owner and
// admin may call it (APPROVAL_ROLES). "Goes out at its time": publishDue (every
// five minutes) sends a queued post once scheduled_for passes and its account is
// active, so an approved post with no send time never goes out, and one still
// queued an hour past its time on an active account was not sent.
export const SOCIAL_APPROVED_SQL = `
SELECT count(DISTINCT p.id)::int AS sample_count,
       count(DISTINCT p.id) FILTER (WHERE st.id IS NULL
         OR st.role NOT IN ('owner', 'admin')
         OR p.status NOT IN ('queued', 'posting', 'posted', 'failed')
         OR q.status IS DISTINCT FROM 'scheduled'
         OR q.partner_id IS DISTINCT FROM p.partner_id
         OR (p.status = 'queued' AND p.scheduled_for IS NULL)
         OR (p.status = 'queued' AND ch.connection_state = 'active'
             AND p.scheduled_for < now() - interval '1 hour'))::int AS bad_count
  FROM social_posts p
  LEFT JOIN staff st ON st.org_id = p.org_id AND st.id = p.approved_by
  LEFT JOIN marketing_content_queue q ON q.org_id = p.org_id AND q.social_post_id = p.id
  LEFT JOIN social_channels ch ON ch.id = p.channel_id
 WHERE p.org_id = $1::uuid AND p.approved_at > now() - interval '30 days'`;

// Written by api/social/posts.mjs (no channel_id): the queue row becomes
// 'queued', keeps or sets scheduled_for, and is NOT handed to a social account,
// so social_post_id stays empty. A queued row with a post id would claim no
// account was chosen when one was. The one column this control writes is the send
// time: an hour after it was queued the row must carry one, and one that is more
// than a day past is a post that never went out (nothing hands a row queued without
// an account to the sender; the page says "past its time, it goes out on the next
// send").
export const SOCIAL_QUEUED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE q.social_post_id IS NOT NULL
         OR NULLIF(BTRIM(COALESCE(q.caption, '')), '') IS NULL
         OR pr.id IS NULL
         OR (q.updated_at < now() - interval '1 hour'
             AND (q.scheduled_for IS NULL OR q.scheduled_for < now() - interval '1 day')))::int AS bad_count
  FROM marketing_content_queue q
  LEFT JOIN partners pr ON pr.org_id = q.org_id AND pr.id = q.partner_id
 WHERE q.org_id = $1::uuid AND q.status = 'queued'`;
