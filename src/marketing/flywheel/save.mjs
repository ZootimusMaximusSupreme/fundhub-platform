// @ts-check
// Save one finished stage file to the repo through the outbox (design §5 rule
// 12: repo saves land in git through the outbox, allow-listed paths only).
// Unit X3.
//
// The op id is the job id plus the file, so the worker re-entering the save
// step after a crash queues the same save again and the outbox answers
// "duplicate" instead of writing twice (src/repo/outbox.mjs enqueueRepoWrite).

import { enqueueRepoWrite } from "../../repo/outbox.mjs";
import { withTransaction } from "../../db/with-transaction.mjs";
import { adAccountDay } from "../../lib/ad-account-day.mjs";

/** Today in Arizona (where Chris is, no daylight saving), YYYY-MM-DD. */
export function todayArizona(now = new Date()) {
  return adAccountDay(now);
}

/**
 * saveStageFile(ctx, { campaign, file, text, jobId }) → { path, outbox_id, duplicate }
 * @param {{db: any, orgId: string}} ctx
 * @param {{campaign: string, file: string, text: string, jobId: string}} args
 */
export async function saveStageFile(ctx, { campaign, file, text, jobId }) {
  const path = `marketing/flywheel/${campaign}/${file}`;
  const row = await withTransaction(ctx.db, (tx) => enqueueRepoWrite(tx, {
    orgId: ctx.orgId,
    opId: `flywheel:${jobId}:${file}`,
    path,
    mode: "replace",
    content: text
  }));
  return { path, outbox_id: row.id, duplicate: row.duplicate };
}
