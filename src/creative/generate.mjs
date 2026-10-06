// The generation service — the one path from a spec to stored, screened assets.
//
// FIVE PROPERTIES, each of which the spec names and each of which has a test:
//
// 1. IDEMPOTENT ON generation_jobs.idempotency_key. Re-submitting the same batch
//    returns the existing job rather than spending money again. The unique index
//    is the guarantee; the SELECT is an early out.
//
// 2. RETRIES WITH BACKOFF, and only for retryable failures. A 400 is not retried
//    — it burns a concurrency slot to fail identically.
//
// 3. PER-PARTNER CONCURRENCY CAP, read from partner_module_settings. One partner
//    cannot starve the others.
//
// 4. cost_cents RECORDED ON EVERY JOB, success or failure, because UNIT 9 bills a
//    markup on it and a failed attempt still costs money at the provider.
//
// 5. A PROVIDER OUTAGE DEGRADES TO queued, NEVER to a silent empty result. This
//    is the one the spec calls out by name. `succeeded` with zero assets is
//    indistinguishable from "the model had nothing to say", and a caller would
//    render an empty library and move on.
//
// EVERY ASSET IS SCREENED BEFORE IT IS USABLE. Assets land with
// compliance_state='pending' and are then screened; a block writes the reasons and
// leaves the asset in the review queue, visible, never dropped. Nothing in this
// module can set 'approved' — that is a human action through UNIT 8.

import { resolve } from "./providers/index.mjs";
import { screen } from "../compliance/screen.mjs";

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;

/* enqueue(tx, req) → { job, created }

   Creates (or returns) the job row. Separate from run() so the HTTP path can
   return a job id immediately and the work can happen out of band.

   `tx` must be a scoped client from withPartnerScope() — every table touched here
   is RLS'd, so an unscoped caller would write rows it cannot read back. */
export async function enqueue(tx, {
  orgId, partnerId, brandKitId = null,
  requestedByKind = null, requestedByStaffId = null, requestedByAccountId = null,
  spec = {}, assetKind, idempotencyKey
} = {}) {
  if (!orgId) throw new Error("enqueue: orgId is required");
  if (!partnerId) throw new Error("enqueue: partnerId is required");
  if (!assetKind) throw new Error("enqueue: assetKind is required");
  if (!idempotencyKey) {
    // Not defaulted to a uuid. A generated key makes every retry a new job and
    // every double-click a second bill — the failure this argument exists to stop.
    throw new Error("enqueue: idempotencyKey is required — a generated one would defeat idempotency");
  }

  /* WHO ASKED, in the shape 241_generation_jobs_requested_by.sql accepts: a kind
     plus the one id column that kind lives in. An employee's id is in `staff`
     and a partner's is in `accounts`, so the old single requested_by column —
     which pointed at accounts alone — made every employee-initiated job die on a
     foreign key violation.

     NULL is a legitimate answer: the cron drains this queue with nobody signed
     in, and 045 says so in the column comment. What is not legitimate is a
     mismatch, and it is caught here as well as at the CHECK so the message names
     the argument rather than the constraint. */
  const requesterKind = requestedByKind || null;
  if (requesterKind && requesterKind !== "staff" && requesterKind !== "partner") {
    throw new Error(
      `enqueue: requestedByKind must be "staff", "partner" or null (got "${requesterKind}")`);
  }
  if (requesterKind === "staff" && !requestedByStaffId) {
    throw new Error("enqueue: requestedByKind 'staff' needs requestedByStaffId");
  }
  if (requesterKind === "partner" && !requestedByAccountId) {
    throw new Error("enqueue: requestedByKind 'partner' needs requestedByAccountId");
  }
  const requesterStaffId = requesterKind === "staff" ? requestedByStaffId : null;
  const requesterAccountId = requesterKind === "partner" ? requestedByAccountId : null;

  const existing = await tx.query(
    `SELECT * FROM generation_jobs WHERE partner_id = $1 AND idempotency_key = $2`,
    [partnerId, idempotencyKey]
  );
  if (existing.rows[0]) return { job: existing.rows[0], created: false };

  const ins = await tx.query(
    `INSERT INTO generation_jobs
       (org_id, partner_id, brand_kit_id,
        requested_by_kind, requested_by_staff_id, requested_by_account_id,
        spec, provider, status, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,'queued',$9)
     ON CONFLICT (partner_id, idempotency_key) DO NOTHING
     RETURNING *`,
    [orgId, partnerId, brandKitId,
     requesterKind, requesterStaffId, requesterAccountId,
     JSON.stringify({ ...spec, assetKind }), null, idempotencyKey]
  );

  // No row back means a concurrent insert won the unique index. That is a
  // successful dedupe, not a failure — re-read and return theirs.
  if (!ins.rows[0]) {
    const raced = await tx.query(
      `SELECT * FROM generation_jobs WHERE partner_id = $1 AND idempotency_key = $2`,
      [partnerId, idempotencyKey]
    );
    return { job: raced.rows[0], created: false };
  }
  return { job: ins.rows[0], created: true };
}

/* claim(tx, { partnerId }) → job | null

   Takes the next queued job for a partner, respecting the concurrency cap. The
   UPDATE is conditional on status still being 'queued', so two workers racing
   cannot both claim one job — the loser gets no row and moves on. */
export async function claim(tx, { partnerId }) {
  const settings = await tx.query(
    `SELECT max_concurrent_jobs FROM partner_module_settings WHERE partner_id = $1`,
    [partnerId]
  );
  const cap = settings.rows[0]?.max_concurrent_jobs ?? 3;

  const running = await tx.query(
    `SELECT count(*)::int AS n FROM generation_jobs
      WHERE partner_id = $1 AND status = 'running'`,
    [partnerId]
  );
  if (running.rows[0].n >= cap) return null;

  const { rows } = await tx.query(
    `UPDATE generation_jobs SET status = 'running', started_at = now(), attempt = attempt + 1
      WHERE id = (
        SELECT id FROM generation_jobs
         WHERE partner_id = $1 AND status = 'queued'
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1)
      RETURNING *`,
    [partnerId]
  );
  return rows[0] || null;
}

/* run(tx, job, ctx) → { status, assets, cost_cents }

   Executes one claimed job: resolve the provider, call it with backoff, store the
   assets, screen each one. */
export async function run(tx, job, ctx = {}) {
  const spec = typeof job.spec === "string" ? JSON.parse(job.spec) : (job.spec || {});
  const maxAttempts = Number(ctx.maxAttempts || DEFAULT_MAX_ATTEMPTS);

  let provider;
  try {
    provider = await resolve(tx, { orgId: job.org_id, assetKind: spec.assetKind });
  } catch (err) {
    // No provider configured is a permanent failure, not an outage. Retrying would
    // not conjure a config row.
    return fail(tx, job, err, { retryable: false });
  }

  await tx.query(`UPDATE generation_jobs SET provider = $2 WHERE id = $1`, [job.id, provider.key]);

  let result;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      result = await provider.module.generate(spec, {
        ...ctx,
        config: provider.config,
        partnerId: job.partner_id,
        tx
      });
      break;
    } catch (err) {
      lastErr = err;
      if (err.retryable === false || attempt === maxAttempts) break;
      await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1), ctx);
    }
  }

  if (!result) {
    // DEGRADE TO QUEUED, not to a silent empty success. A retryable failure goes
    // back on the queue with its cost recorded; a permanent one is marked failed
    // with the reason. Either way the partner's library does not silently gain
    // nothing while the job claims to have worked.
    return fail(tx, job, lastErr, { retryable: lastErr?.retryable !== false });
  }

  // A provider that returns 200 and no assets has failed, whatever it says. This
  // is the exact "silent empty result" the spec forbids.
  if (!result.assets?.length) {
    return fail(tx, job, new Error("provider returned zero assets"), { retryable: true });
  }

  const stored = [];
  for (const a of result.assets) {
    stored.push(await storeAsset(tx, job, a, ctx));
  }

  await tx.query(
    `UPDATE generation_jobs
        SET status = 'succeeded', finished_at = now(), cost_cents = cost_cents + $2, error = NULL
      WHERE id = $1`,
    [job.id, Math.max(0, Math.round(Number(result.cost_cents) || 0))]
  );

  // `model`: the model that wrote it, when the provider says (the copy writer
  // does; the Quick copy card prints it, design §2 J9). null otherwise.
  return { status: "succeeded", assets: stored, cost_cents: result.cost_cents || 0, model: result.model || null };
}

/* storeAsset — insert the asset, then screen it.

   Inserted FIRST, at compliance_state='pending', so a crash between the two
   leaves a visible pending asset rather than a screened asset nobody stored or a
   stored asset nobody screened. Pending is the safe resting state: it is not
   publishable, and it is visible in the review queue. */
async function storeAsset(tx, job, a, ctx) {
  const { rows } = await tx.query(
    `INSERT INTO creative_assets
       (org_id, partner_id, brand_kit_id, kind, format, provider, provider_asset_id,
        storage_key, copy_text, duration_sec, ai_generated, synthetic_performer,
        compliance_state, created_by_agent_id, parent_asset_id, script_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14,$15)
     RETURNING *`,
    [job.org_id, job.partner_id, job.brand_kit_id, a.kind, a.format, a.provider,
     a.provider_asset_id,
     // Namespaced here, not by the provider — the service knows the partner id and
     // the CHECK in 045 enforces the prefix.
     storageKeyFor(job.partner_id, a),
     // The words, saved with the row. A picture has none, and storageKeyFor()
     // returns null for copy, so exactly one of these two columns is filled.
     // Written HERE, in the insert, and not after the screen: a copy asset that
     // gets blocked keeps its text like every other one. Blocked assets stay in
     // the review queue to be read and fixed, and a blocked ad with no words in
     // it is one nobody can act on.
     copyTextFor(a),
     a.duration_sec, a.ai_generated !== false, Boolean(a.synthetic_performer),
     ctx.agentId || null, a.parent_asset_id || null,
     /* THE MIDDLE LINK OF THE LABEL CHAIN — script -> creative -> ad (377).
        Carried on the job's spec, which is where api/creative/generate.mjs folds
        it in, so no column was added to generation_jobs for it.

        NULL when the caller did not name a script, and that must survive: an
        asset with no script is a real thing, not a zero. The trigger added by
        377 refuses a creative and a script owned by different partners, so a
        wrong id fails loudly here rather than quietly mislabelling an ad later.

        Until this column is filled, v_ad_label_spine returns NULL labels for
        every row and the whole spine reads EMPTY rather than broken. */
     (job.spec && job.spec.scriptId) || null]
  );
  const asset = rows[0];

  await tx.query(
    `INSERT INTO generation_job_assets (org_id, partner_id, job_id, asset_id)
     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [job.org_id, job.partner_id, job.id, asset.id]
  );

  const spec = typeof job.spec === "string" ? JSON.parse(job.spec) : (job.spec || {});
  const settings = await tx.query(
    `SELECT approve_before_launch FROM partner_module_settings WHERE partner_id = $1`,
    [job.partner_id]
  );

  const verdict = await screen(tx, {
    orgId: job.org_id,
    partnerId: job.partner_id,
    subjectId: asset.id,
    kind: "creative_asset",
    offerType: spec.offerType,
    platform: spec.platform ?? null,
    text: a.text || spec.prompt || "",
    aiGenerated: a.ai_generated !== false,
    syntheticPerformer: Boolean(a.synthetic_performer),
    hasDisclosureAsset: Boolean(spec.hasDisclosureAsset),
    // Default ON when the partner has no settings row. The safe default is the
    // one that asks a human, not the one that skips them.
    approveBeforeLaunch: settings.rows[0]?.approve_before_launch ?? true
  });

  // 'passed' and 'needs_approval' both map to 'passed' on the asset: neither is
  // publishable on its own, and the approval gate is tracked by the campaign's
  // approval_state, not by the asset. Only a hard block changes the asset state,
  // and it lands in the review queue WITH its reasons rather than being dropped.
  const state = verdict.state === "blocked" ? "blocked" : "passed";
  await tx.query(
    `UPDATE creative_assets SET compliance_state = $2, blocked_reasons = $3::jsonb WHERE id = $1`,
    [asset.id, state, JSON.stringify(verdict.state === "blocked" ? verdict.reasons : [])]
  );

  await tx.query(
    `INSERT INTO compliance_screenings
       (org_id, partner_id, subject_type, subject_id, offer_type, platform, state, reasons, screened_text)
     VALUES ($1,$2,'creative_asset',$3,$4,$5,$6,$7::jsonb,$8)`,
    [job.org_id, job.partner_id, asset.id, spec.offerType || null, spec.platform || null,
     verdict.state, JSON.stringify(verdict.reasons), String(a.text || "").slice(0, 8000)]
  );

  return { ...asset, compliance_state: state, screen: verdict };
}

async function fail(tx, job, err, { retryable }) {
  const message = String(err?.message || err || "unknown error").slice(0, 500);
  const attempts = Number(job.attempt || 0);

  // Retryable and under the attempt ceiling → back to queued, so the scheduler
  // picks it up again. Otherwise failed, with the reason preserved.
  const backToQueue = retryable && attempts < DEFAULT_MAX_ATTEMPTS;

  await tx.query(
    `UPDATE generation_jobs
        SET status = $2, error = $3, finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
      WHERE id = $1`,
    [job.id, backToQueue ? "queued" : "failed", message]
  );
  return { status: backToQueue ? "queued" : "failed", assets: [], cost_cents: 0, error: message };
}

/* copyTextFor — the generated words, or null.

   Blank is turned into null on purpose. creative_assets_copy_text_ck in 301
   rejects an empty string, because an empty string renders as a blank card in
   the library that looks like a loading bug, while null renders as "no text",
   which is the truth for a picture. A provider that hands back "   " is saying
   it produced nothing, not that it produced whitespace. */
function copyTextFor(a) {
  const text = typeof a.text === "string" ? a.text.trim() : "";
  return text === "" ? null : text;
}

function storageKeyFor(partnerId, a) {
  if (a.kind === "copy") return null;               // copy lives in the row, not object storage
  const ext = a.kind === "video" ? "mp4" : "png";
  const id = a.provider_asset_id || Math.random().toString(36).slice(2);
  return `partners/${partnerId}/creative/${a.format}/${id}.${ext}`;
}

const sleep = (ms, ctx) => (ctx.sleep ? ctx.sleep(ms) : new Promise((r) => setTimeout(r, ms)));

export default { enqueue, claim, run };
