// Finish-853 batch 11 (tier 4, lane gap-catalog-display): the Company Brain, Creative Factory,
// Contract templates and Consent screens.
//
// Two kinds of attachment live here, and each row says which one it has:
//
//   LIVE CHECK    A read-only SQL text the display lane runs for the company. It returns
//                 sample_count (how many saved results exist) and bad_count (how many are wrong)
//                 and goes red on the first wrong one. A control nobody has used yet has no results,
//                 so it is green with the words "no saved results yet" (emptyAs "quiet").
//   PRACTICE TEST A real page in Chromium, fake /api answers, one click, and a judgement of the exact
//                 request and the words painted. It reads no live data.
//
// A row with a live check also lists its practice test when its click is exercised there: the
// practice test covers the click, the live check covers what the click leaves behind.
//
// Each live check is built from named bad-result conditions (CHECKS below). The SQL text is the
// conditions joined with OR. fin-b11-live-contracts.test.mjs runs that exact text over stand-in rows,
// breaks one condition at a time and sees it go red, and drops each condition from the text and sees
// that some test row notices.
//
// This file is read at build time by scripts/pulse/compile-catalog.mjs. The live bundle reads the
// compiled copy in generated.json, so it imports nothing.
//
// It must not import display-saved-result.mjs (that file imports this one).

export const FIN_B11_LANE = "src/pulse/coverage/gap-catalog-display.mjs";
const DIR = "src/pulse/catalog/proofs";
export const FIN_B11_LIVE_TEST = `${DIR}/fin-b11-live-contracts.test.mjs`;
export const FIN_B11_BRAIN_TEST = `${DIR}/fin-b11-company-brain.test.mjs`;
export const FIN_B11_CREATIVE_TEST = `${DIR}/fin-b11-creative-factory.test.mjs`;
export const FIN_B11_SMALL_TEST = `${DIR}/fin-b11-small-pages.test.mjs`;
export const FIN_B11_BRAIN_LISTS_TEST = `${DIR}/fin-b11-brain-lists.test.mjs`;
// Repair cycle 2: the real handlers over stand-in rows, the exhaustive quiz, and the page tests that
// press what cycle 1 did not.
export const FIN_B11_C2_BRAIN_HANDLERS_TEST = `${DIR}/fin-b11-c2-brain-handlers.test.mjs`;
export const FIN_B11_C2_BRAIN_PAGE_TEST = `${DIR}/fin-b11-c2-brain-page.test.mjs`;
export const FIN_B11_C2_QUIZ_TEST = `${DIR}/fin-b11-c2-quiz.test.mjs`;
export const FIN_B11_C2_CREATIVE_HANDLERS_TEST = `${DIR}/fin-b11-c2-creative-handlers.test.mjs`;
export const FIN_B11_C2_CREATIVE_PAGE_TEST = `${DIR}/fin-b11-c2-creative-page.test.mjs`;

const DAYS = (n) => `now() - interval '${n} days'`;

// ───────────────────────────── the live checks ─────────────────────────────
//
// Every check: one table to read (from), which rows count (where), and the named conditions that make
// a row WRONG (bad). $1 is the company. Written in the common subset of Postgres and SQLite on purpose
// (no regular expressions, no arrays) so the test can run the exact text.

/** @type {Array<{key:string, control:string, requirement:string, from:string, where:string, bad:Array<[string,string]>}>} */
export const FIN_B11_CHECKS = [];

function check(spec) {
  FIN_B11_CHECKS.push(Object.freeze({ ...spec, bad: Object.freeze(spec.bad.map((pair) => Object.freeze([...pair]))) }));
}

/** The SQL text for a check, or for a check with some conditions left out (the test does that). */
export function sqlFor(spec, { without = [] } = {}) {
  const kept = spec.bad.filter(([name]) => !without.includes(name));
  if (!kept.length) throw new Error(`${spec.key}: no conditions left`);
  return `/* display-result:${spec.key} */
SELECT count(*)::int AS sample_count,
       count(*) FILTER (WHERE ${kept.map(([, expr]) => `(${expr.trim()})`).join("\n         OR ")})::int AS bad_count
  FROM ${spec.from.trim()}
 WHERE ${spec.where.trim()}`;
}

// ── Company Brain (company-brain.html) ──────────────────────────────────────

check({
  key: "brain-turns",
  control: "Send question (Send button, Enter key; Shift+Enter makes a line)",
  requirement: "Every chat that holds a question must hold exactly one saved answer for each question, and each answer must have words, name the engine that wrote it (model, extractive or none), carry a thin flag that matches that engine, and list the files it was written from when a model or the copy-out wrote it. The chat itself must have a title with no spaces around it.",
  from: "brain_threads t",
  where: `t.org_id = $1::uuid AND t.updated_at >= ${DAYS(60)} AND t.updated_at < now() - interval '2 minutes'
    AND EXISTS (SELECT 1 FROM brain_messages q WHERE q.thread_id = t.id AND q.role = 'user')`,
  bad: [
    ["a question has no saved answer",
      `(SELECT count(*) FROM brain_messages q WHERE q.thread_id = t.id AND q.role = 'user')
       <> (SELECT count(*) FROM brain_messages a WHERE a.thread_id = t.id AND a.role = 'assistant')`],
    ["an answer is blank or names no engine",
      `EXISTS (SELECT 1 FROM brain_messages a WHERE a.thread_id = t.id AND a.role = 'assistant'
         AND (NULLIF(BTRIM(COALESCE(a.text, '')), '') IS NULL OR a.answer_source IS NULL
              OR a.answer_source NOT IN ('model', 'extractive', 'none')))`],
    ["an answer's thin flag disagrees with its engine",
      `EXISTS (SELECT 1 FROM brain_messages a WHERE a.thread_id = t.id AND a.role = 'assistant'
         AND a.thin IS DISTINCT FROM (a.answer_source <> 'model'))`],
    ["a saved question is blank",
      `EXISTS (SELECT 1 FROM brain_messages q WHERE q.thread_id = t.id AND q.role = 'user'
         AND NULLIF(BTRIM(COALESCE(q.text, '')), '') IS NULL)`],
    // Every answer the model or the copy-out wrote is built from files the person's role may open, and
    // the engine always attaches them (src/company-brain/answer.mjs). An answer saved with no files
    // is the files lost on the way to the saved chat, and the reopened chat would show it uncited.
    ["a written answer lists no files",
      `EXISTS (SELECT 1 FROM brain_messages a WHERE a.thread_id = t.id AND a.role = 'assistant'
         AND a.answer_source IN ('model', 'extractive')
         AND CASE WHEN jsonb_typeof(a.sources) = 'array' THEN jsonb_array_length(a.sources) ELSE 0 END = 0)`],
    // The chat is named after its first question (src/company-brain/threads.mjs titleFromQuestion).
    ["the chat has no title, or one saved with spaces around it",
      `NULLIF(BTRIM(COALESCE(t.title, '')), '') IS NULL OR t.title <> BTRIM(t.title)`]
  ]
});

// The "Past chats list" row has no live check any more. Its SQL (every message of a chat in the chat's
// own company, the list order not behind the newest message, the chat's staff member in the chat's
// company) was removed in repair cycle 2 together with the row: see FIN_B11_NOT_ATTACHABLE. The text is
// in git at 941b987f6 and comes back when the page stops repainting an old chat over a newer one.

check({
  key: "brain-uploads",
  control: "Files you added: list and Refresh button",
  requirement: "Every uploaded file in the list must name who added it, hold real bytes and a name, carry an upload id, stay closed to everyone but the owner (file and every chunk) while it waits or was turned down, have a pending review the owner can act on while it waits, and once approved sit at the tier the review proposed with every chunk at that same tier.",
  from: "brain_files f",
  where: `f.org_id = $1::uuid AND f.source = 'upload'`,
  bad: [
    ["no staff member is named as the uploader",
      `f.uploaded_by IS NULL`],
    ["the file has no bytes or no name",
      `f.size_bytes IS NULL OR f.size_bytes <= 0 OR NULLIF(BTRIM(COALESCE(f.name, '')), '') IS NULL`],
    ["the file id is not an upload id",
      `f.drive_file_id NOT LIKE 'upload:%'`],
    ["a waiting file is not closed to non-owners",
      `f.approval_status = 'pending' AND f.access_tier <> 'owner'`],
    ["a waiting or turned-down file has an open chunk",
      `f.approval_status IN ('pending', 'rejected')
       AND EXISTS (SELECT 1 FROM brain_chunks c WHERE c.file_id = f.id AND c.access_tier <> 'owner')`],
    ["an approved file is not at its approved tier",
      `f.approval_status = 'approved'
       AND (f.classification_status <> 'approved' OR f.access_tier IS DISTINCT FROM f.proposed_tier)`],
    ["an approved file has a chunk at another tier",
      `f.approval_status = 'approved'
       AND EXISTS (SELECT 1 FROM brain_chunks c WHERE c.file_id = f.id AND c.access_tier IS DISTINCT FROM f.access_tier)`],
    ["a waiting file has no pending review, so nobody can approve it",
      `f.approval_status = 'pending' AND f.created_at < now() - interval '10 minutes'
       AND NOT EXISTS (SELECT 1 FROM brain_classification_reviews r
                        WHERE r.file_id = f.id AND r.org_id = f.org_id AND r.status = 'pending')`]
  ]
});

check({
  key: "brain-review-queue",
  control: "Owner: 'Waiting for your approval' panel and its Refresh button",
  requirement: "Every review waiting for the owner must point at a file of the same company that is still closed to everyone but the owner (file and every chunk), and an upload review must be on an upload that is still waiting, a drive review on a file still marked pending.",
  from: "brain_classification_reviews r LEFT JOIN brain_files f ON f.id = r.file_id",
  where: `r.org_id = $1::uuid AND r.status = 'pending'`,
  bad: [
    ["the file is missing or belongs to another company",
      `f.id IS NULL OR f.org_id <> r.org_id`],
    ["the file is already open to a lower tier",
      `f.access_tier <> 'owner'`],
    ["a chunk of the file is already open to a lower tier",
      `EXISTS (SELECT 1 FROM brain_chunks c WHERE c.file_id = r.file_id AND c.access_tier <> 'owner')`],
    ["an upload review is on a file that is not a waiting upload",
      `r.kind = 'upload' AND (f.source <> 'upload' OR f.approval_status <> 'pending')`],
    ["a drive review is on a file that is not marked pending",
      `r.kind = 'classification' AND f.classification_status <> 'pending'`]
  ]
});

const NEWEST_REVIEW = `NOT EXISTS (SELECT 1 FROM brain_classification_reviews n
                   WHERE n.file_id = r.file_id AND n.id <> r.id AND n.created_at > r.created_at)`;
const FILE_NOT_TOUCHED_SINCE = `(f.id IS NULL OR f.updated_at <= r.updated_at)`;
const DECIDED_BY_AN_OWNER = `NOT EXISTS (SELECT 1 FROM staff s
                   WHERE s.id = r.decided_by AND s.org_id = r.org_id AND s.role = 'owner')`;

check({
  key: "brain-review-approved",
  control: "Owner: Approve a waiting file (button on the file row and in the review list)",
  requirement: "Every approved review that is still the file's newest must be stamped with the time and an owner of this company, and its file must be approved at exactly the tier asked for (file and every chunk), with an affiliate allowlist row for an affiliate approval and none for any other tier.",
  from: "brain_classification_reviews r LEFT JOIN brain_files f ON f.id = r.file_id AND f.org_id = r.org_id",
  where: `r.org_id = $1::uuid AND r.status = 'approved' AND r.updated_at >= ${DAYS(90)}
    AND ${NEWEST_REVIEW} AND ${FILE_NOT_TOUCHED_SINCE}`,
  bad: [
    ["the decision has no time or no person",
      `r.decided_by IS NULL OR r.decided_at IS NULL`],
    ["the decider is not an owner of this company",
      DECIDED_BY_AN_OWNER],
    ["the file is gone",
      `f.id IS NULL`],
    ["the file is not approved at the tier asked for",
      `f.id IS NOT NULL AND (f.approval_status IS DISTINCT FROM 'approved' OR f.classification_status IS DISTINCT FROM 'approved'
       OR f.access_tier IS DISTINCT FROM r.proposed_tier OR f.proposed_tier IS DISTINCT FROM r.proposed_tier)`],
    ["a chunk is not at the approved tier",
      `EXISTS (SELECT 1 FROM brain_chunks c WHERE c.file_id = r.file_id AND c.access_tier IS DISTINCT FROM r.proposed_tier)`],
    ["an affiliate approval has no allowlist row for this review and owner",
      `r.proposed_tier = 'affiliate' AND NOT EXISTS (SELECT 1 FROM brain_affiliate_allowlist w
         WHERE w.file_id = r.file_id AND w.org_id = r.org_id AND w.review_id = r.id
           AND w.approved_by IS NOT DISTINCT FROM r.decided_by)`],
    ["a non-affiliate approval left an allowlist row behind",
      `r.proposed_tier <> 'affiliate' AND EXISTS (SELECT 1 FROM brain_affiliate_allowlist w
         WHERE w.file_id = r.file_id AND w.org_id = r.org_id)`]
  ]
});

// A review the system closed by itself (a newer proposal replaced it, or the file was classified
// automatically) is also status 'rejected' with nobody named, and it leaves the file's classification
// as pending or auto. A person's turn down is the one that leaves the file marked rejected, so a
// rejected review with no person is read when its file says a person turned it down.
check({
  key: "brain-review-rejected",
  control: "Owner: Turn down a waiting file",
  requirement: "Every review turned down by a person that is still the file's newest must be stamped with the time and an owner of this company, and its file must be marked rejected, closed to everyone but the owner (file and every chunk), with no affiliate allowlist row. A file marked rejected whose review names nobody is wrong.",
  from: "brain_classification_reviews r LEFT JOIN brain_files f ON f.id = r.file_id AND f.org_id = r.org_id",
  where: `r.org_id = $1::uuid AND r.status = 'rejected' AND r.updated_at >= ${DAYS(90)}
    AND (r.decided_by IS NOT NULL OR f.classification_status = 'rejected')
    AND ${NEWEST_REVIEW} AND ${FILE_NOT_TOUCHED_SINCE}`,
  bad: [
    ["the decision has no time or no person",
      `r.decided_by IS NULL OR r.decided_at IS NULL`],
    ["the decider is not an owner of this company",
      DECIDED_BY_AN_OWNER],
    ["the file is gone",
      `f.id IS NULL`],
    ["the file is not marked rejected and closed",
      `f.id IS NOT NULL AND (f.approval_status IS DISTINCT FROM 'rejected' OR f.classification_status IS DISTINCT FROM 'rejected'
       OR f.access_tier IS DISTINCT FROM 'owner' OR f.proposed_tier IS DISTINCT FROM 'owner')`],
    ["a chunk is open to a lower tier",
      `EXISTS (SELECT 1 FROM brain_chunks c WHERE c.file_id = r.file_id AND c.access_tier <> 'owner')`],
    ["an affiliate allowlist row was left behind",
      `EXISTS (SELECT 1 FROM brain_affiliate_allowlist w WHERE w.file_id = r.file_id AND w.org_id = r.org_id)`]
  ]
});

// ── Creative Factory (creative-factory.html) ────────────────────────────────

check({
  key: "script-save",
  control: "Save this script button",
  requirement: "Every script saved in the last 60 days must be filed under a partner of this company, an original must be its own root, a rewrite must point at a script of the same company and partner, be the next version on the same root and have replaced a script that is no longer live, and a script saved from this form must have each label it carries in the label dictionary.",
  from: `ad_scripts s
  LEFT JOIN partners p ON p.id = s.partner_id
  LEFT JOIN ad_scripts pr ON pr.id = s.parent_script_id`,
  where: `s.org_id = $1::uuid AND s.created_at >= ${DAYS(60)}`,
  bad: [
    ["the partner is missing or belongs to another company",
      `p.id IS NULL OR p.org_id <> s.org_id`],
    ["an original is not its own root",
      `s.parent_script_id IS NULL AND s.root_script_id IS DISTINCT FROM s.id`],
    ["a rewrite points at a script that is missing or belongs to another company or partner",
      `s.parent_script_id IS NOT NULL AND (pr.id IS NULL OR pr.org_id <> s.org_id OR pr.partner_id <> s.partner_id)`],
    ["a rewrite is not the next version",
      `pr.id IS NOT NULL AND s.version <> pr.version + 1`],
    ["a rewrite sits on another root",
      `pr.id IS NOT NULL AND s.root_script_id IS DISTINCT FROM pr.root_script_id`],
    ["the script a rewrite replaced is still live",
      `pr.id IS NOT NULL AND s.created_at >= '2026-10-05' AND pr.archived_at IS NULL`],
    ["a label typed on the form is not in the dictionary",
      `s.source = 'chris' AND s.ad_id IS NULL AND s.parent_script_id IS NULL AND s.parts IS NULL
       AND s.batch_id IS NULL AND s.idea_id IS NULL
       AND ((s.script_type IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ad_labels l
              WHERE l.org_id = s.org_id AND l.kind = 'script_type' AND l.key = s.script_type))
         OR (s.angle_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ad_labels l
              WHERE l.org_id = s.org_id AND l.kind = 'angle' AND l.key = s.angle_key))
         OR (s.hook_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ad_labels l
              WHERE l.org_id = s.org_id AND l.kind = 'hook' AND l.key = s.hook_key))
         OR (s.offer_key IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ad_labels l
              WHERE l.org_id = s.org_id AND l.kind = 'offer' AND l.key = s.offer_key)))`]
  ]
});

check({
  key: "job-enqueued",
  control: "Enqueue generation button (disabled until the allowance loads and is on)",
  requirement: "Every generation job saved in the last 60 days must belong to a partner of this company, name an asker (the only way a job is saved is a signed-in partner or staff member pressing the button) who really is a staff member of this company or an account of that partner, and any script or brand kit it names must exist for the same company and partner.",
  from: "generation_jobs j LEFT JOIN partners p ON p.id = j.partner_id",
  where: `j.org_id = $1::uuid AND j.created_at >= ${DAYS(60)}`,
  bad: [
    ["the partner is missing or belongs to another company",
      `p.id IS NULL OR p.org_id <> j.org_id`],
    ["the staff asker is not a staff member of this company",
      `j.requested_by_kind = 'staff' AND NOT EXISTS (SELECT 1 FROM staff s
         WHERE s.id = j.requested_by_staff_id AND s.org_id = j.org_id)`],
    ["the partner asker is not an account of this partner",
      `j.requested_by_kind = 'partner' AND NOT EXISTS (SELECT 1 FROM accounts ac
         WHERE ac.id = j.requested_by_account_id AND ac.partner_id = j.partner_id)`],
    ["the script it names is not this partner's",
      `j.spec->>'scriptId' IS NOT NULL AND NOT EXISTS (SELECT 1 FROM ad_scripts sc
         WHERE sc.id::text = j.spec->>'scriptId' AND sc.org_id = j.org_id AND sc.partner_id = j.partner_id)`],
    ["the brand kit it names is not this partner's",
      `j.brand_kit_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM brand_kits k
         WHERE k.id = j.brand_kit_id AND k.org_id = j.org_id AND k.partner_id = j.partner_id)`],
    // api/creative/generate.mjs is the only writer of generation_jobs, and it refuses a caller who is
    // not a partner or staff session, so a job saved since the asker columns (migration 241, 2026-08-19)
    // always names its asker. A job with nobody named is the asker lost on the way to the saved row
    // (fin-b11-live-contracts.test.mjs scans the code and goes red if a second writer ever appears).
    ["a job made from the screen names nobody as its asker",
      `j.requested_by_kind IS NULL AND j.created_at >= '2026-08-20'`]
  ]
});

check({
  key: "job-form",
  control: "Generate form: Kind (static / copy / video), What is being sold, What to make, Name this batch",
  requirement: "Every generation job saved since 2026-09-08 must carry a kind the factory knows (static, video, copy or resize), an offer the compliance screen accepts (funding, credit_cards or credit_repair), a batch name that is not blank or padded with spaces, and, when a script was picked, a script id the right length. A job the form made carries all three of what to make, the shapes and the number of versions together, so one of them missing while another is present is wrong.",
  from: "generation_jobs j",
  where: `j.org_id = $1::uuid AND j.created_at >= '2026-09-08' AND j.created_at >= ${DAYS(60)}`,
  bad: [
    ["the kind is missing or unknown",
      `COALESCE(j.spec->>'assetKind', '') NOT IN ('static', 'video', 'copy', 'resize')`],
    ["the offer is missing or not one the screen accepts",
      `COALESCE(j.spec->>'offerType', '') NOT IN ('funding', 'credit_cards', 'credit_repair')`],
    ["a picked script id is the wrong length",
      `j.spec->>'scriptId' IS NOT NULL AND LENGTH(j.spec->>'scriptId') <> 36`],
    ["the words of what to make, the shapes or the versions are missing from a job the form made",
      `(j.spec->>'prompt' IS NOT NULL OR j.spec->>'formats' IS NOT NULL OR j.spec->>'variants' IS NOT NULL)
       AND (j.spec->>'prompt' IS NULL OR j.spec->>'formats' IS NULL OR j.spec->>'variants' IS NULL)`],
    ["the batch name is blank or was saved with spaces around it",
      `NULLIF(BTRIM(COALESCE(j.idempotency_key, '')), '') IS NULL OR j.idempotency_key <> BTRIM(j.idempotency_key)`]
  ]
});

check({
  key: "job-run",
  control: "Run queued jobs now button",
  requirement: "Every generation job touched in the last 60 days must tell the truth about how it ended: a succeeded job stored at least one creative, is stamped finished and has no error; a failed job has a reason and a finish time; a job that ran was counted as an attempt; no retry is waiting past three tries; and nothing has sat in running for more than an hour.",
  from: "generation_jobs j",
  where: `j.org_id = $1::uuid AND j.updated_at >= ${DAYS(60)}`,
  bad: [
    ["a succeeded job stored nothing",
      `j.status = 'succeeded' AND NOT EXISTS (SELECT 1 FROM generation_job_assets x WHERE x.job_id = j.id)`],
    ["a succeeded job has no finish time or still has an error",
      `j.status = 'succeeded' AND (j.finished_at IS NULL OR j.error IS NOT NULL)`],
    ["a failed job has no reason or no finish time",
      `j.status = 'failed' AND (NULLIF(BTRIM(COALESCE(j.error, '')), '') IS NULL OR j.finished_at IS NULL)`],
    ["a job that ran was never counted as an attempt",
      `j.status IN ('running', 'succeeded', 'failed') AND j.attempt < 1`],
    ["a retry is waiting past three tries",
      `j.status = 'queued' AND j.attempt >= 3`],
    ["a job has sat in running for more than an hour",
      `j.status = 'running' AND j.started_at < now() - interval '60 minutes'`]
  ]
});

check({
  key: "asset-approved",
  control: "Approve button (asks to confirm; marks the creative approved and CLEARS its blocked reasons)",
  requirement: "Every approved creative must have an empty blocked-reasons list, belong to a partner of this company, and a written ad must have its words. Two or more creatives of one partner approved at the very same instant are wrong, because one click approves exactly one, and so is a creative approved after it was archived.",
  from: "creative_assets a LEFT JOIN partners p ON p.id = a.partner_id",
  where: `a.org_id = $1::uuid AND a.compliance_state = 'approved'`,
  bad: [
    ["blocked reasons were left on an approved creative",
      `CASE WHEN jsonb_typeof(a.blocked_reasons) = 'array' THEN jsonb_array_length(a.blocked_reasons) ELSE 1 END > 0`],
    ["the partner is missing or belongs to another company",
      `p.id IS NULL OR p.org_id <> a.org_id`],
    ["an approved written ad has no words",
      `a.kind = 'copy' AND a.created_at >= '2026-09-08' AND NULLIF(BTRIM(COALESCE(a.copy_text, '')), '') IS NULL`],
    ["the creative was changed before it was made",
      `a.updated_at < a.created_at`],
    // One click approves one creative. A handler that lost "which creative" approves every creative of
    // the partner in one statement, so they all carry one last-changed time. Every other writer of an
    // approved row (the video loader) inserts one row per transaction.
    ["several creatives of one partner were approved at the same instant",
      `EXISTS (SELECT 1 FROM creative_assets o
               WHERE o.org_id = a.org_id AND o.partner_id = a.partner_id AND o.id <> a.id
                 AND o.updated_at = a.updated_at AND o.compliance_state = 'approved')`],
    // Approve refuses an archived creative ("archived assets cannot be approved"), and Archive sets
    // archived_at and updated_at together, so an approved creative changed after it was archived is an
    // approval the handler should have refused.
    ["a creative was approved after it was archived",
      `a.archived_at IS NOT NULL AND a.updated_at > a.archived_at`]
  ]
});

const HUMAN_REJECT = `a.blocked_reasons::text LIKE '%human_reject%'`;

check({
  key: "asset-rejected",
  control: "Reject button (asks to confirm; marks the creative blocked)",
  requirement: "Every creative a person rejected must be blocked, must list at least one reason, every reason must carry a code and a message a person can read, and the creative must belong to a partner of this company. A creative still carrying a person's reject reason without being blocked is wrong, and so are two or more creatives of one partner rejected at the very same instant, because one click rejects exactly one.",
  from: "creative_assets a LEFT JOIN partners p ON p.id = a.partner_id",
  where: `a.org_id = $1::uuid AND (a.compliance_state = 'blocked' OR ${HUMAN_REJECT})`,
  bad: [
    ["a rejection left the creative not blocked",
      `a.compliance_state <> 'blocked'`],
    ["no reason is listed",
      `CASE WHEN jsonb_typeof(a.blocked_reasons) = 'array' THEN jsonb_array_length(a.blocked_reasons) ELSE 0 END = 0`],
    ["a reason has no code or no message",
      `CASE WHEN jsonb_typeof(a.blocked_reasons) = 'array' THEN EXISTS (SELECT 1 FROM jsonb_array_elements(a.blocked_reasons) AS e(value)
         WHERE NULLIF(BTRIM(COALESCE(e.value->>'code', '')), '') IS NULL
            OR NULLIF(BTRIM(COALESCE(e.value->>'message', '')), '') IS NULL) ELSE false END`],
    ["several creatives of one partner were rejected at the same instant",
      `a.compliance_state = 'blocked' AND ${HUMAN_REJECT}
       AND EXISTS (SELECT 1 FROM creative_assets o
                    WHERE o.partner_id = a.partner_id AND o.id <> a.id AND o.updated_at = a.updated_at
                      AND o.compliance_state = 'blocked' AND o.blocked_reasons::text LIKE '%human_reject%')`],
    ["the partner is missing or belongs to another company",
      `p.id IS NULL OR p.org_id <> a.org_id`]
  ]
});

// Archive writes one thing: archived_at (and the last-changed time with it) on the one creative named.
// It keeps no record of which creative was meant, but the click is the only writer of archived_at, and
// one click archives one creative, so a handler that lost "which creative" leaves several creatives of
// one partner archived at one instant. That, a creative archived before it was made, and a last-changed
// time behind the archive time are the wrong results the row can show. A handler that archives nothing
// or archives the wrong single creative leaves a row no different from a healthy one; the handler test
// (fin-b11-c2-creative-handlers.test.mjs) runs the real file over stand-in rows for those.
check({
  key: "asset-archived",
  control: "Archive button (asks to confirm; hides the creative)",
  requirement: "Every archived creative must belong to a partner of this company, must have been archived after it was made, must carry a last-changed time that is not behind its archive time, and must not share its archive instant with another creative of the same partner, because one click archives exactly one.",
  from: "creative_assets a LEFT JOIN partners p ON p.id = a.partner_id",
  where: `a.org_id = $1::uuid AND a.archived_at IS NOT NULL AND a.archived_at >= ${DAYS(60)}`,
  bad: [
    ["several creatives of one partner were archived at the same instant",
      `EXISTS (SELECT 1 FROM creative_assets o
               WHERE o.org_id = a.org_id AND o.partner_id = a.partner_id AND o.id <> a.id
                 AND o.archived_at = a.archived_at)`],
    ["archived before it was made",
      `a.archived_at < a.created_at`],
    ["the last-changed time is behind the archive time",
      `a.updated_at < a.archived_at`],
    ["the partner is missing or belongs to another company",
      `p.id IS NULL OR p.org_id <> a.org_id`]
  ]
});

check({
  key: "brand-approved",
  control: "Review queue (brand row): reason box and 'Approve this brand' button (owner/admin only)",
  requirement: "Every approved brand must carry its approval time, name an approver who is a staff member of the same company, have been sent for review before it was approved, hold no leftover reason note, and belong to a partner of this company. A brand approved by a person must have been sent for review first, and in the last 90 days its approver must be an owner or admin of this company.",
  from: `partner_brand b
  LEFT JOIN partners p ON p.id = b.partner_id`,
  where: `b.org_id = $1::uuid AND b.approval_status = 'approved'`,
  bad: [
    ["no approval time",
      `b.approved_at IS NULL`],
    ["the approver is not an owner or admin of this company",
      `b.approved_by IS NOT NULL AND b.approved_at >= ${DAYS(90)}
       AND NOT EXISTS (SELECT 1 FROM staff a WHERE a.id = b.approved_by AND a.org_id = b.org_id AND a.role IN ('owner', 'admin'))`],
    ["a brand that went through review has no approver",
      `b.submitted_at IS NOT NULL AND b.approved_by IS NULL`],
    ["approved before it was sent for review",
      `b.submitted_at IS NOT NULL AND b.approved_at < b.submitted_at`],
    ["a person approved a brand that was never sent for review",
      `b.approved_by IS NOT NULL AND b.submitted_at IS NULL`],
    ["a reason note was left on an approved brand",
      `NULLIF(BTRIM(COALESCE(b.review_note, '')), '') IS NOT NULL`],
    ["the partner is missing or belongs to another company",
      `p.id IS NULL OR p.org_id <> b.org_id`]
  ]
});

check({
  key: "brand-sent-back",
  control: "Review queue (brand row): 'Send it back' button with required reason",
  requirement: "Every brand that was sent back or is waiting must have no approval left on it, a sent-back brand (a draft that was sent for review) must hold a real written reason of at most 2000 characters with no spaces around it, and a brand waiting for review must hold no reason from an earlier round.",
  from: "partner_brand b LEFT JOIN partners p ON p.id = b.partner_id",
  where: `b.org_id = $1::uuid AND (b.review_note IS NOT NULL
    OR (b.approval_status <> 'approved' AND b.approved_by IS NOT NULL)
    OR (b.approval_status = 'draft' AND b.submitted_at IS NOT NULL))`,
  bad: [
    ["the reason is blank",
      `b.review_note IS NOT NULL AND NULLIF(BTRIM(b.review_note), '') IS NULL`],
    ["the reason is longer than 2000 characters",
      `b.review_note IS NOT NULL AND LENGTH(b.review_note) > 2000`],
    ["a brand was sent back with no reason saved",
      `b.approval_status = 'draft' AND b.submitted_at IS NOT NULL AND b.review_note IS NULL`],
    ["the reason was saved with spaces around it",
      `b.review_note IS NOT NULL AND b.review_note <> BTRIM(b.review_note)`],
    ["a reason sits on a brand that is approved",
      `b.review_note IS NOT NULL AND b.approval_status = 'approved'`],
    ["a brand waiting for review still holds an old reason",
      `b.approval_status = 'review' AND b.review_note IS NOT NULL`],
    ["a brand that is not approved still names an approver",
      `b.approval_status <> 'approved' AND b.approved_by IS NOT NULL`],
    ["the partner is missing or belongs to another company",
      `p.id IS NULL OR p.org_id <> b.org_id`]
  ]
});

check({
  key: "allowance",
  control: "Monthly writing allowance panel (on/off, used, left, limit) and its enable note",
  requirement: "Every partner's writing settings must belong to a partner of this company, the monthly limit must not be saved as 0 (the panel would show the 250,000 default instead of the saved number), and no writing usage for the partner may be booked to another company.",
  from: "partner_module_settings s LEFT JOIN partners p ON p.id = s.partner_id",
  where: `s.org_id = $1::uuid`,
  bad: [
    ["the partner is missing or belongs to another company",
      `p.id IS NULL OR p.org_id <> s.org_id`],
    ["the limit is saved as 0 and shown as the default",
      `s.ai_token_cap_monthly = 0`],
    ["usage is booked to another company",
      `EXISTS (SELECT 1 FROM partner_ai_usage u WHERE u.partner_id = s.partner_id AND u.org_id <> s.org_id)`]
  ]
});

// A check with no conditions or no rows to read could never go red. Fail loudly.
for (const c of FIN_B11_CHECKS) {
  if (!c.bad.length || !c.where) throw new Error(`${c.key} is not a finished check`);
}

// ───────────────────────── the contracts the display lane runs ─────────────────────────

/** Contracts for DISPLAY_RESULT_CONTRACTS. Each is quiet until the first saved result exists. */
export const FIN_B11_RESULT_CONTRACTS = Object.freeze(FIN_B11_CHECKS.map((spec) => Object.freeze({
  control: spec.control,
  mode: "query",
  emptyAs: "quiet",
  requirement: spec.requirement,
  sql: sqlFor(spec)
})));

// ───────────────────────── every row of the batch, and what it has ─────────────────────────

const BRAIN = "company-brain.html";
const CF = "creative-factory.html";

/**
 * One entry per row of batch 11. liveKey names the live check (a FIN_B11_CHECKS key) or null.
 * browserTest names the practice-test file that presses the control, or null when none does.
 * Rows that have neither are in FIN_B11_NOT_ATTACHABLE below with their reasons.
 */
export const FIN_B11_ROWS = Object.freeze([
  // Company Brain: the chat, the side panels, the owner review
  ["Send question (Send button, Enter key; Shift+Enter makes a line)", BRAIN, "brain-turns", FIN_B11_BRAIN_TEST, [FIN_B11_C2_BRAIN_HANDLERS_TEST, FIN_B11_C2_BRAIN_PAGE_TEST]],
  ["Files you added: list and Refresh button", BRAIN, "brain-uploads", FIN_B11_BRAIN_TEST, [FIN_B11_BRAIN_LISTS_TEST, FIN_B11_C2_BRAIN_PAGE_TEST]],
  ["Owner: 'Waiting for your approval' panel and its Refresh button", BRAIN, "brain-review-queue", FIN_B11_BRAIN_TEST, [FIN_B11_BRAIN_LISTS_TEST]],
  ["Owner: Approve a waiting file (button on the file row and in the review list)", BRAIN, "brain-review-approved", FIN_B11_BRAIN_TEST, [FIN_B11_BRAIN_LISTS_TEST, FIN_B11_C2_BRAIN_HANDLERS_TEST, FIN_B11_C2_BRAIN_PAGE_TEST]],
  ["Owner: Turn down a waiting file", BRAIN, "brain-review-rejected", FIN_B11_BRAIN_TEST, [FIN_B11_BRAIN_LISTS_TEST, FIN_B11_C2_BRAIN_HANDLERS_TEST, FIN_B11_C2_BRAIN_PAGE_TEST]],
  ["Class quiz: answer boxes and 'Check answers' (scored in the browser, nothing saved)", BRAIN, null, FIN_B11_BRAIN_TEST, [FIN_B11_C2_QUIZ_TEST]],
  ["Documents button (opens right-hand panel) and its Close button", BRAIN, null, FIN_B11_BRAIN_TEST],
  ["Page itself: staff-only chat screen loads (shell, ramp-quizzes.js, data.js)", BRAIN, null, FIN_B11_BRAIN_TEST],
  ["Past chats rail toggle (hamburger, narrow screens)", BRAIN, null, FIN_B11_BRAIN_TEST],
  ["Role badge (reads fh_role from localStorage; shows 'owner' or 'staff' and decides whether approval controls draw)", BRAIN, null, FIN_B11_BRAIN_TEST],
  // Consent and contract templates: links and one local button
  ["Back link (to Client Control Panel, or to Client Portal for dispute_authorization)", "consent-capture.html", null, FIN_B11_SMALL_TEST],
  ["Cancel button", "contracts.html", null, FIN_B11_SMALL_TEST],
  ["Link: 'Documents' (see contracts already sent)", "contracts.html", null, FIN_B11_SMALL_TEST],
  // Creative Factory
  ["Save this script button", CF, "script-save", FIN_B11_CREATIVE_TEST],
  ["Enqueue generation button (disabled until the allowance loads and is on)", CF, "job-enqueued", FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST, FIN_B11_C2_CREATIVE_HANDLERS_TEST]],
  ["Generate form: Kind (static / copy / video), What is being sold, What to make, Name this batch", CF, "job-form", FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST, FIN_B11_C2_CREATIVE_HANDLERS_TEST]],
  ["Run queued jobs now button", CF, "job-run", FIN_B11_CREATIVE_TEST],
  ["Approve button (asks to confirm; marks the creative approved and CLEARS its blocked reasons)", CF, "asset-approved", FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST, FIN_B11_C2_CREATIVE_HANDLERS_TEST]],
  ["Reject button (asks to confirm; marks the creative blocked)", CF, "asset-rejected", FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST, FIN_B11_C2_CREATIVE_HANDLERS_TEST]],
  ["Archive button (asks to confirm; hides the creative)", CF, "asset-archived", FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST, FIN_B11_C2_CREATIVE_HANDLERS_TEST]],
  ["Review queue (brand row): reason box and 'Approve this brand' button (owner/admin only)", CF, "brand-approved", FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST, FIN_B11_C2_CREATIVE_HANDLERS_TEST]],
  ["Review queue (brand row): 'Send it back' button with required reason", CF, "brand-sent-back", FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST, FIN_B11_C2_CREATIVE_HANDLERS_TEST]],
  ["Monthly writing allowance panel (on/off, used, left, limit) and its enable note", CF, "allowance", FIN_B11_CREATIVE_TEST],
  ["Brand kits: state chips, kit card click opens drawer, prev / next", CF, null, FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST]],
  ["Creative library: asset card click opens the detail drawer; prev / next pager", CF, null, FIN_B11_CREATIVE_TEST],
  ["Creative library: state chips, kind chips, format chips, brand kit select, include archived select, 'show' size select", CF, null, FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST]],
  ["Decide on one creative: creative picker (select)", CF, null, FIN_B11_CREATIVE_TEST],
  ["Detail drawer: close button, scrim click, Esc key", CF, null, FIN_B11_CREATIVE_TEST],
  ["Generation jobs: 'show' size select and prev / next pager", CF, null, FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST]],
  ["Generation jobs: row click expands job detail (what went wrong, kit, times)", CF, null, FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST]],
  ["Generation jobs: state filter chips (all, queued, running, succeeded, failed; several at once)", CF, null, FIN_B11_CREATIVE_TEST],
  ["Link: 'Brand Studio' (inside the allowance note when the suite is off)", CF, null, FIN_B11_CREATIVE_TEST],
  ["Page itself loads (partner or owner/admin; staff roles may use the script card)", CF, null, FIN_B11_CREATIVE_TEST],
  ["Partner picker (select) and ?partner_id= preselect", CF, null, FIN_B11_CREATIVE_TEST],
  ["Reference section (4 closed panels: job states, AI labels, why creative gets stopped, engine settings table)", CF, null, FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST]],
  ["Review queue: 'Open the full creative' button on a row", CF, null, FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST]],
  ["Review queue: state chips (all, blocked, pending, awaiting_approval), 'show' size select, prev / next, row expand", CF, null, FIN_B11_CREATIVE_TEST, [FIN_B11_C2_CREATIVE_PAGE_TEST]],
  ["Script picker list on the Generate form (rebuilt from saved scripts)", CF, null, FIN_B11_CREATIVE_TEST]
].map(([control, surface, liveKey, browserTest, extraTests = []]) => Object.freeze({
  sourceFile: "desks-b.json", surface, control, liveKey, browserTest, extraTests: Object.freeze(extraTests)
})));

/**
 * Rows this batch looked at and could NOT honestly attach (repair cycle 2). They are not in
 * FIN_B11_ROWS, have no live check and no proof case, so the coverage count keeps them open.
 * The practice tests that press them stay in the repo as plain tests; they just do not claim the row.
 */
export const FIN_B11_NOT_ATTACHABLE = Object.freeze([
  {
    sourceFile: "desks-b.json",
    surface: BRAIN,
    control: "New chat button",
    reason: "Product finding 7. Press a past chat, then New chat before the chat has loaded: when the slow read finishes, openThread() repaints the old chat's title and messages over the empty chat. The control's whole job is a clean empty chat, so a test that asserts that is red on today's page and a test that walks around it is green on a broken control. Needs a product change first: a stale-answer guard in openThread() (ignore an answer whose thread id is no longer state.threadId).",
    tests: [FIN_B11_BRAIN_TEST]
  },
  {
    sourceFile: "desks-b.json",
    surface: BRAIN,
    control: "Past chats list: click a chat to reopen it",
    reason: "Product finding 7, from the click side. Press chat A (slow) then chat B: B paints, then A's late answer overwrites it while B is the highlighted chat and state.threadId, so the screen shows A's conversation under B's mark and the next question is sent into B. Asserting the right behaviour is red on today's page, and a green check would sit on a control that can show the wrong conversation. The live check that was here (every message in the chat's own company, list order not behind the newest message) was removed with the row. Needs the same stale-answer guard in openThread() as New chat.",
    tests: [FIN_B11_BRAIN_TEST, FIN_B11_BRAIN_LISTS_TEST, FIN_B11_C2_BRAIN_HANDLERS_TEST]
  }
]);

/**
 * Proof cases for display-proof-cases.mjs. A row with a live check is a "deep" case that names the lane,
 * so the lane judges it from the saved result; its practice test rides along. A practice-only row is
 * an "e2e" case.
 */
export const FIN_B11_DISPLAY_PROOF_CASES = Object.freeze(FIN_B11_ROWS.map((row) => {
  // The live-check file (when the row has one), the page practice test, and any handler test that runs
  // the row's list or decision for real.
  const tests = [...(row.liveKey ? [FIN_B11_LIVE_TEST] : []), row.browserTest, ...row.extraTests];
  return Object.freeze({
    sourceFile: row.sourceFile,
    surface: row.surface,
    control: row.control,
    depth: row.liveKey ? "deep" : "e2e",
    evidence: row.liveKey ? `${tests.join("; ")}; ${FIN_B11_LANE}` : tests.join("; "),
    tests: Object.freeze(tests)
  });
}));

/** The live-check subset, handed to compile-catalog.mjs (it reads only "deep" cases). */
export const FIN_B11_LIVE_PROOF_CASES = Object.freeze(FIN_B11_DISPLAY_PROOF_CASES.filter((c) => c.depth === "deep"));
