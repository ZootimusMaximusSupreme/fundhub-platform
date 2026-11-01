// Hourly read-only check: each aged ClickFunnels booking has a Cortana receipt.
import {
  CORTANA_CHECK_ID, CORTANA_UNDELIVERED_SQL, judgeCortanaBooking
} from "./lib/cortana-booking-truth.mjs";

export const id = "cortana-booking";
export const title = "Confirmed calls reach Cortana";
export const kind = "probe";
export const covers = ["job:cortana-booking-feed"];
export const box = false;
export const reads = [];
export const checkIds = [CORTANA_CHECK_ID];
export const steps = ["delivery-receipt"];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  await ctx.step("delivery-receipt", async () => {
    let result;
    try { result = await ctx.read(CORTANA_UNDELIVERED_SQL, [ctx.now]); }
    catch (err) {
      throw ctx.fail("delivery-receipt", `Could not read Cortana booking receipts: ${String(err?.message || err).slice(0, 100)}`);
    }
    const verdict = judgeCortanaBooking(result.rows[0]);
    if (verdict.status !== "PASS") throw ctx.fail("delivery-receipt", verdict.detail);
  });
  return ctx.done("Every aged confirmed ClickFunnels call has a Cortana delivery receipt.");
}

export const fixGuide = [
  "A confirmed ClickFunnels call has no Cortana delivery receipt after 20 minutes.",
  "Likely causes:",
  "- The five-minute cortana-booking-feed job did not run or could not read the booking.",
  "- DirectROAS refused the webhook, or the send failed before its receipt was saved.",
  "Steps:",
  "- Read the cortana-booking-feed heartbeat and the booking's cortana_booking_sends row.",
  "- Check the DirectROAS Funding Call webhook source for that booking before retrying it.",
  "- Repair the failing send or clock, then verify a saved receipt and the vendor conversion.",
  "Files: src/workflows/cortana-booking-feed.mjs, src/messaging/providers/cortana-booking-webhook.mjs, src/pulse/beats/lib/cortana-booking-truth.mjs"
].join("\n");

export const selfTest = {
  pass: () => ({ read: [{ match: /FROM bookings b/, rows: [{ undelivered: 0 }] }] }),
  fail: () => ({ read: [{ match: /FROM bookings b/, rows: [{ undelivered: 2 }] }] })
};
