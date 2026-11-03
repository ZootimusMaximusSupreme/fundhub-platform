// Monthly, count-only retention review. It does not call apply() or issue a
// DELETE/UPDATE against customer data. Each org gets one durable receipt per
// month so an owner can review the plan before any manual purge.
import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { plan, countOnlyPlan } from "../../scripts/retention-purge.mjs";

export const REVIEW_CRON = "0 4 1 * *";
export const SOURCE_WORKFLOW = "retention-review";

export async function reviewRetention(conn = db, { asOf = new Date(), step = null, makePlan = plan } = {}) {
  if (!(asOf instanceof Date) || !Number.isFinite(asOf.getTime())) throw new Error("valid asOf date required");
  const month = asOf.toISOString().slice(0, 7);
  const run = (name, fn) => step?.run ? step.run(name, fn) : fn();
  const { rows } = await run("list-orgs", () => conn.query(`SELECT id FROM orgs ORDER BY id`));
  let recorded = 0;
  const failed = [];
  for (const row of rows) {
    try {
      const result = await run(`review-${row.id}`, async () => {
        const p = await makePlan(conn, { orgId: row.id });
        const receipt = await conn.query(
          `INSERT INTO retention_run_receipts (org_id, run_key, kind, plan_counts)
           VALUES ($1, $2, 'review', $3::jsonb)
           ON CONFLICT (org_id, kind, run_key) DO NOTHING
           RETURNING id`,
          [row.id, month, JSON.stringify(countOnlyPlan(p.items))]
        );
        return { recorded: receipt.rows.length === 1 };
      });
      if (result.recorded) recorded += 1;
    } catch {
      failed.push(row.id);
    }
  }
  if (failed.length) throw new Error(`retention review failed for ${failed.length} org(s)`);
  return { ok: true, count: rows.length, recorded, month };
}

export async function handle({ db: handleDb, step } = {}) {
  return reviewRetention(handleDb || db, { step });
}

export const retentionReview = inngest.createFunction(
  { id: SOURCE_WORKFLOW, name: "Monthly retention review (count only)" },
  { cron: REVIEW_CRON },
  ({ step }) => reviewRetention(db, { step })
);

export default reviewRetention;
