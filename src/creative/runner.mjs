// Creative job runner — claim + run queued generation_jobs.
// Called by the Netlify creative-job-runner cron and POST /api/creative/run.

import { withPartnerScope, asStaff } from "../partners/rls.mjs";
import { claim, run } from "./generate.mjs";

/**
 * runDue(db, { limitPartners, maxJobsPerPartner }) → { partners, jobs }
 *
 * FIXED 2026-09-07. This discovery query used to run directly on `db`, with
 * no partner scope set. generation_jobs has row-level security, and an
 * unscoped connection is nobody — RLS shows it zero rows, not every row. So
 * this cron woke up every two minutes, found nothing, and reported success,
 * forever, no matter how many jobs were actually queued. No test caught it
 * because no test ran this function against a real row-level-secured
 * connection with no scope set. Wrapped in asStaff() below, the same helper
 * scope.mjs's staff branch backs everywhere else in this codebase that needs
 * a "see every partner" read for a background job.
 *
 * The `db` argument this function receives is no longer used to run the
 * discovery query — asStaff() opens its own scoped connection off the shared
 * pool. `db` is left as a parameter (unused) rather than removed, so this is
 * a one-file fix and every existing call site (the Netlify cron, the manual
 * POST /api/creative/run) keeps working with no change on their end.
 */
export async function runDue(db, { limitPartners = 25, maxJobsPerPartner = 3, assetKinds = null, excludeAssetKinds = null } = {}) {
  /* assetKinds / excludeAssetKinds: which jobs this runner may take (claim() in
     generate.mjs). The Mac runner passes assetKinds ['copy']; Netlify, with
     MARKETING_AI_RUNNER=local, passes excludeAssetKinds ['copy']. */
  const params = [limitPartners];
  let scope = "";
  if (Array.isArray(assetKinds)) {
    params.push(assetKinds.map(String));
    scope += ` AND spec->>'assetKind' = ANY($${params.length}::text[])`;
  }
  if (Array.isArray(excludeAssetKinds) && excludeAssetKinds.length) {
    params.push(excludeAssetKinds.map(String));
    scope += ` AND NOT (coalesce(spec->>'assetKind', '') = ANY($${params.length}::text[]))`;
  }
  const partners = await asStaff((tx) => tx.query(
    `SELECT partner_id, org_id FROM (
       SELECT DISTINCT ON (partner_id) partner_id, org_id, created_at
         FROM generation_jobs
        WHERE status = 'queued'${scope}
        ORDER BY partner_id, created_at
     ) q
     ORDER BY created_at
     LIMIT $1`,
    params
  ));

  const jobs = [];
  for (const row of partners.rows) {
    const batch = await withPartnerScope(
      { kind: "partner", partnerId: row.partner_id },
      async (tx) => {
        const out = [];
        for (let i = 0; i < maxJobsPerPartner; i++) {
          const job = await claim(tx, { partnerId: row.partner_id, assetKinds, excludeAssetKinds });
          if (!job) break;
          out.push(await run(tx, job));
        }
        return out;
      }
    );
    for (const r of batch) jobs.push({ partner_id: row.partner_id, ...r });
  }
  return { partners: partners.rows.length, jobs };
}

export default { runDue };
