// Batch 04, part 2: contracts, vault, letter packs, funding rounds, new clients
// and social posts. Same rules as fin-b04-sql-messages.mjs: read only, $1::uuid
// is the company, the answer is sample_count and bad_count.
//
// The lists below (letter offers, product codes, the four core pack files) are
// read from the app's own config when this file loads, then written into the SQL
// as literals. compile-catalog saves the SQL, so a config change makes the saved
// catalog stale and the guard test says so.

import { OFFERS } from "../../../config/offers.mjs";

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

// Written by src/contracts/send.mjs (create_draft then send) and
// src/contracts/notify.mjs (one email per signer, provider_ref 'contract:<id>:...').
// A signer may be handed the link in person, so the mail is owed only when the
// client or a signer has an email address.
export const CONTRACT_SENT_SQL = `
SELECT count(DISTINCT c.id)::int AS sample_count,
       count(DISTINCT c.id) FILTER (WHERE cl.id IS NULL
         OR t.template_key IS DISTINCT FROM c.template_key
         OR st.id IS NULL
         OR c.link_expires_at IS NULL OR c.link_expires_at <= c.sent_at
         OR NOT EXISTS (SELECT 1 FROM contract_signers g WHERE g.contract_id = c.id)
         OR (c.sent_at < now() - interval '1 hour'
             AND (NULLIF(BTRIM(COALESCE(cl.email, '')), '') IS NOT NULL
                  OR EXISTS (SELECT 1 FROM contract_signers g2
                              WHERE g2.contract_id = c.id AND NULLIF(BTRIM(COALESCE(g2.email, '')), '') IS NOT NULL))
             AND NOT EXISTS (SELECT 1 FROM messages m
                              WHERE m.org_id = c.org_id AND m.provider_ref LIKE 'contract:' || c.id::text || ':%')))::int AS bad_count
  FROM contracts c
  LEFT JOIN clients cl ON cl.org_id = c.org_id AND cl.id = c.client_id
  LEFT JOIN contract_templates t ON t.org_id = c.org_id AND t.id = c.template_id
  LEFT JOIN staff st ON st.org_id = c.org_id AND st.id = c.sent_by
 WHERE c.org_id = $1::uuid AND c.is_demo = false
   AND c.sent_at > now() - interval '30 days'`;

// Every required blank the wording declares (contract_templates.manual_fields,
// rows of {key, label, required}) must hold a value in the contract's
// merge_values, which createDraft fills from src/config/offers.mjs.
export const CONTRACT_BLANKS_SQL = `
SELECT count(DISTINCT c.id)::int AS sample_count,
       count(DISTINCT c.id) FILTER (WHERE t.id IS NULL
         OR EXISTS (SELECT 1 FROM jsonb_array_elements(t.manual_fields) f
                     WHERE f->>'required' = 'true'
                       AND NULLIF(BTRIM(COALESCE(c.merge_values->>(f->>'key'), '')), '') IS NULL))::int AS bad_count
  FROM contracts c
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
// 'closer-deck-deliverables:<client>:<offer>:<subtype>'), then the funding
// delivery email. One row per client; the four core pack pages must all be there.
export const DECK_DELIVERABLES_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE
${CORE_PACK_SUBTYPES.map((s) => `         NOT EXISTS (SELECT 1 FROM documents k WHERE k.org_id = cl.org_id AND k.client_id = cl.id
                      AND k.kind = 'deliverable' AND k.subtype = '${s}')`).join("\n         OR\n")}
         OR EXISTS (SELECT 1 FROM documents b WHERE b.org_id = cl.org_id AND b.client_id = cl.id
                     AND b.generated_by = 'closer-deck' AND b.source_event_id LIKE 'closer-deck-deliverables:%'
                     AND (b.kind IS DISTINCT FROM 'deliverable'
                          OR COALESCE(b.byte_size, 0) <= 0
                          OR NULLIF(BTRIM(COALESCE(b.storage_key, '')), '') IS NULL
                          OR b.checksum IS NULL
                          OR split_part(b.source_event_id, ':', 3) NOT IN (${quote(LETTER_OFFER_KEYS)})))
         OR (EXISTS (SELECT 1 FROM documents o WHERE o.org_id = cl.org_id AND o.client_id = cl.id
                      AND o.generated_by = 'closer-deck' AND o.source_event_id LIKE 'closer-deck-deliverables:%'
                      AND o.generated_at < now() - interval '1 hour')
             AND NOT EXISTS (SELECT 1 FROM messages em WHERE em.org_id = cl.org_id AND em.client_id = cl.id
                              AND em.template_key = '${DELIVERABLES_EMAIL_KEY}'
                              AND em.provider_ref LIKE 'workflow:${DELIVERABLES_EMAIL_KEY}:closer-deck-letters:' || cl.id::text || ':%')))::int AS bad_count
  FROM clients cl
 WHERE cl.org_id = $1::uuid AND cl.is_demo = false
   AND EXISTS (SELECT 1 FROM documents x WHERE x.org_id = cl.org_id AND x.client_id = cl.id
                AND x.generated_by = 'closer-deck' AND x.source_event_id LIKE 'closer-deck-deliverables:%'
                AND x.is_demo = false AND x.generated_at > now() - interval '30 days')`;

// Written by src/funding/card-stacking-rounds.mjs emitCardStackingRoundTransition
// (the pipeline drop and the MOVE menu call it, as do the control panel buttons).
// The event carries stage, source, rail, product and roundNumber and the key
// 'card_stacking:<client>:<round>:<stage>:<event>'. An hour later the round row
// must exist (money-chain ensureFundingRound) and the client must have been
// texted or emailed by the workflow named for that event. Opted-out clients get
// no text, so a missing text is only judged when they are not opted out.
function roundSql({ event, stage, textKey, emailKey, needsRound = true }) {
  const roundRow = needsRound
    ? `
  LEFT JOIN funding_rounds fr ON fr.org_id = e.org_id AND fr.client_id = e.client_id
       AND fr.round_number::text = e.payload->>'roundNumber'`
    : "";
  const missing = [];
  if (needsRound) missing.push("fr.id IS NULL");
  if (textKey) {
    missing.push(`(NOT EXISTS (SELECT 1 FROM messages mt WHERE mt.org_id = e.org_id
                       AND mt.provider_ref = 'workflow:${textKey}:' || e.id::text)
                AND NOT EXISTS (SELECT 1 FROM opt_outs o WHERE o.client_id = e.client_id
                       AND o.channel = 'sms' AND o.opted_in_at IS NULL))`);
  }
  if (emailKey) {
    missing.push(`NOT EXISTS (SELECT 1 FROM messages me WHERE me.org_id = e.org_id
                       AND me.provider_ref = 'workflow:${emailKey}:' || e.id::text)`);
  }
  return `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE cl.id IS NULL
         OR e.payload->>'stage' IS DISTINCT FROM '${stage}'
         OR e.payload->>'rail' IS DISTINCT FROM 'card_stacking'
         OR e.payload->>'product' IS DISTINCT FROM 'card_stacking'
         OR COALESCE(e.payload->>'roundNumber', '') !~ '^[1-9][0-9]*$'
         OR e.idempotency_key IS DISTINCT FROM 'card_stacking:' || e.client_id::text || ':'
              || COALESCE(e.payload->>'roundNumber', '') || ':${stage}:${event}'
         OR (e.created_at < now() - interval '1 hour' AND (${missing.join("\n              OR ")})))::int AS bad_count
  FROM events e
  LEFT JOIN clients cl ON cl.org_id = e.org_id AND cl.id = e.client_id${roundRow}
 WHERE e.org_id = $1::uuid AND e.name = '${event}'
   AND e.payload->>'source' = 'card_stacking' AND e.is_demo = false
   AND e.created_at > now() - interval '30 days'`;
}

export const ROUND_STARTED_SQL = roundSql({
  event: "round.started", stage: "apply_now", textKey: "SMS-ROUND-STARTED-NOTIFY"
});
export const ROUND_SUBMITTED_NOTIFY_SQL = roundSql({
  event: "round.submitted", stage: "round_submitted",
  textKey: "SMS-F03-ROUND-SUBMITTED", emailKey: "EMAIL-F03-ROUND-SUBMITTED"
});
export const ROUND_APPROVED_SQL = roundSql({
  event: "round.approved", stage: "approved",
  textKey: "SMS-F04-ROUND-APPROVALS", emailKey: "EMAIL-F04-ROUND-APPROVALS"
});
export const ROUND_CLOSEOUT_NOTIFY_SQL = roundSql({
  event: "round.closeout", stage: "closed",
  textKey: "SMS-N04-POST-FUNDING", emailKey: "EMAIL-N04-POST-FUNDING"
});

// Written by api/pipeline-clients.mjs: resolveClient, custom_fields.product, then
// emit entry.captured (key 'pipeline-client:<org>:<email>') which s-00-welcome
// answers with an email and a text and s-01-new-lead-intake places on the board.
// A client archived since then has no cards (crm_archived_at), so that half is
// skipped for them.
export const PIPELINE_NEW_CLIENT_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE NULLIF(BTRIM(COALESCE(e.payload->>'name', '')), '') IS NULL
         OR COALESCE(e.payload->>'email', '') !~ '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
         OR NULLIF(BTRIM(COALESCE(e.payload->>'phone', '')), '') IS NULL
         OR COALESCE(e.payload->>'product', '') NOT IN (${quote(PRODUCT_CODES)})
         OR cl.custom_fields->>'product' IS DISTINCT FROM e.payload->>'product'
         OR e.idempotency_key IS DISTINCT FROM 'pipeline-client:' || e.org_id::text || ':'
              || lower(COALESCE(e.payload->>'email', ''))
         OR (e.created_at < now() - interval '1 hour' AND (
              (cl.custom_fields->>'crm_archived_at' IS NULL
               AND NOT EXISTS (SELECT 1 FROM cards k WHERE k.org_id = e.org_id AND k.client_id = e.client_id))
              OR NOT EXISTS (SELECT 1 FROM messages me WHERE me.org_id = e.org_id
                              AND me.provider_ref = 'workflow:EMAIL-S00-WELCOME:' || e.id::text)
              OR (NOT EXISTS (SELECT 1 FROM messages mt WHERE mt.org_id = e.org_id
                              AND mt.provider_ref = 'workflow:SMS-S00-WELCOME:' || e.id::text)
                  AND NOT EXISTS (SELECT 1 FROM opt_outs o WHERE o.client_id = e.client_id
                              AND o.channel = 'sms' AND o.opted_in_at IS NULL)))))::int AS bad_count
  FROM events e
  LEFT JOIN clients cl ON cl.org_id = e.org_id AND cl.id = e.client_id
 WHERE e.org_id = $1::uuid AND e.name = 'entry.captured'
   AND e.payload->>'source' = 'pipeline' AND e.is_demo = false
   AND e.created_at > now() - interval '30 days'`;

// Written by api/social/posts.mjs decideHeldPost (approve): one statement sets
// approved_at, approved_by and status 'queued' on social_posts, and the queue
// row mirrors as 'scheduled'. Only that route sets approved_at.
export const SOCIAL_APPROVED_SQL = `
SELECT count(DISTINCT p.id)::int AS sample_count,
       count(DISTINCT p.id) FILTER (WHERE st.id IS NULL
         OR p.status NOT IN ('queued', 'posting', 'posted', 'failed')
         OR q.status IS DISTINCT FROM 'scheduled'
         OR q.partner_id IS DISTINCT FROM p.partner_id)::int AS bad_count
  FROM social_posts p
  LEFT JOIN staff st ON st.org_id = p.org_id AND st.id = p.approved_by
  LEFT JOIN marketing_content_queue q ON q.org_id = p.org_id AND q.social_post_id = p.id
 WHERE p.org_id = $1::uuid AND p.approved_at > now() - interval '30 days'`;

// Written by api/social/posts.mjs (no channel_id): the queue row becomes
// 'queued', keeps or sets scheduled_for, and is NOT handed to a social account,
// so social_post_id stays empty. A queued row with a post id would claim no
// account was chosen when one was.
export const SOCIAL_QUEUED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE q.social_post_id IS NOT NULL
         OR NULLIF(BTRIM(COALESCE(q.caption, '')), '') IS NULL
         OR pr.id IS NULL)::int AS bad_count
  FROM marketing_content_queue q
  LEFT JOIN partners pr ON pr.org_id = q.org_id AND pr.id = q.partner_id
 WHERE q.org_id = $1::uuid AND q.status = 'queued'`;

// Written by src/social/scheduler.mjs publishDue: after 3 tries the post is
// 'failed' with last_error and openOnboardingTask opens 'social_post_failed'.
export const SOCIAL_FAILED_SQL = `
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE p.attempt < 3
         OR NULLIF(BTRIM(COALESCE(p.last_error, '')), '') IS NULL
         OR pr.id IS NULL
         OR NOT EXISTS (SELECT 1 FROM partner_onboarding_tasks o WHERE o.org_id = p.org_id
                          AND o.partner_id = p.partner_id AND o.task_key = 'social_post_failed'))::int AS bad_count
  FROM social_posts p
  LEFT JOIN partners pr ON pr.org_id = p.org_id AND pr.id = p.partner_id
 WHERE p.org_id = $1::uuid AND p.status = 'failed'`;
