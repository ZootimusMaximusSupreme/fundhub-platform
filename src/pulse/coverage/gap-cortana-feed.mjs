import { CORTANA_FEED_SQL, cortanaFeedProblems } from "../beats/lib/cortana-feed-truth.mjs";

export async function gapChecks(ctx = {}) {
  const id = "ads:cortana-payment-feed";
  if (!ctx.db?.query) return [{ id, status: "skip", detail: "No database read available for the Cortana payment feed." }];
  try {
    const result = await ctx.db.query(CORTANA_FEED_SQL);
    const verdict = cortanaFeedProblems(result.rows[0]);
    return [{ id, status: verdict.healthy ? "PASS" : "FAIL", detail: verdict.detail,
      suggestedFix: verdict.healthy ? null : "Read cortana_feed_sends last_error; check CORTANA_FEED_ENABLED, the three CORTANA_WEBHOOK_*_URL values, and that the Fundhub server sources are on in Cortana." }];
  } catch (err) {
    return [{ id, status: "skip", detail: `Could not read the Cortana payment feed: ${String(err?.message || err).slice(0, 120)}` }];
  }
}
