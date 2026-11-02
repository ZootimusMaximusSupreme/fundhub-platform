// Daily AI COO pass: one dated manager task per closer, metric and month.
import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { runManagerKpiReview } from "../ops/manager-kpi-review.mjs";

export const REVIEW_CRON = "TZ=America/Phoenix 15 7 * * *";

export async function handle({ conn = db, now = new Date() } = {}) {
  const result = await runManagerKpiReview(conn, { now });
  if (!result.ok) throw new Error(`ops-manager-review: ${result.failures.length} staff review(s) failed`);
  return result;
}

export const opsManagerReview = inngest.createFunction(
  { id: "ops-manager-review", name: "AI COO manager KPI reviews" },
  { cron: REVIEW_CRON },
  () => handle()
);
