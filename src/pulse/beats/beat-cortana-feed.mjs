import { CORTANA_FEED_SQL, cortanaFeedProblems } from "./lib/cortana-feed-truth.mjs";

export const id = "cortana-feed";
export const title = "Every paid payment reaches Cortana";
export const kind = "probe";
export const covers = ["job:cortana-payment-feed"];
export const box = false;
export const reads = [];
export const steps = ["payments-in-cortana"];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  await ctx.step("payments-in-cortana", async () => {
    let result;
    try { result = await ctx.read(CORTANA_FEED_SQL); }
    catch (err) {
      throw ctx.fail("payments-in-cortana", `Could not read the Cortana feed: ${String(err?.message || err).slice(0, 100)}`);
    }
    const verdict = cortanaFeedProblems(result.rows[0]);
    if (!verdict.healthy) throw ctx.fail("payments-in-cortana", verdict.detail);
  });
  return ctx.done("Every paid payment since the feed started is in Cortana.");
}

export const fixGuide = [
  "A paid payment did not reach Cortana, so the ad that sold it gets no credit.",
  "Likely causes:",
  "- CORTANA_FEED_ENABLED is not 1, or a CORTANA_WEBHOOK_*_URL is missing on Netlify.",
  "- The Cortana webhook source was deleted or turned off in Conversion Setup.",
  "- The cortana-payment-feed clock stopped running.",
  "Steps:",
  "- Read cortana_feed_sends for the payment: status and last_error say what Cortana answered.",
  "- Check the three Fundhub server sources are on in app.directroas.com > Ad Tracking > Conversion Setup.",
  "- Fix the switch or URL; the next 5-minute run resends failed rows by itself.",
  "Files: src/workflows/cortana-payment-feed.mjs, src/messaging/providers/cortana-webhook.mjs, src/pulse/beats/lib/cortana-feed-truth.mjs"
].join("\n");

export const selfTest = {
  pass: () => ({ read: [{ match: /FROM transactions t/, rows: [{ unsent: 0, failing: 0 }] }] }),
  fail: () => ({ read: [{ match: /FROM transactions t/, rows: [{ unsent: 1, failing: 0 }] }] })
};
