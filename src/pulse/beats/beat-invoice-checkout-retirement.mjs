import {
  INVOICE_CHECKOUT_RETIREMENT_SQL,
  retirementProblems
} from "./lib/invoice-checkout-retirement-truth.mjs";

export const id = "invoice-checkout-retirement";
export const title = "Fee checkout links retire when the bill changes";
export const kind = "probe";
export const covers = ["job:invoice-checkout-retirement-sweeper"];
export const box = false;
export const reads = [];
export const steps = ["links-safe"];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  await ctx.step("links-safe", async () => {
    let result;
    try { result = await ctx.read(INVOICE_CHECKOUT_RETIREMENT_SQL); }
    catch (err) {
      throw ctx.fail("links-safe", `Could not read fee checkout links: ${String(err?.message || err).slice(0, 100)}`);
    }
    const verdict = retirementProblems(result.rows[0]);
    if (!verdict.healthy) throw ctx.fail("links-safe", verdict.detail);
  });
  return ctx.done("Fee invoice links match the current balances and no expired Commas checkout is stranded.");
}

export const fixGuide = [
  "A fee checkout may still accept an old invoice amount. Check the link cleanup step.",
  "Likely causes:",
  "- A partial payment or invoice correction left an old hosted Commas URL payable.",
  "- The Commas checkout deletion failed, or the recovery clock did not run.",
  "Steps:",
  "- Read the fee invoice, its payment_links rows, and the last job heartbeat without showing a buyer URL.",
  "- Retry the expired link through the scoped retirement helper and check Commas confirms deactivation.",
  "- If the Commas account or key is wrong, repair that connection before sending a replacement bill.",
  "Files: src/payment-links/retire-invoice-checkout.mjs, src/workflows/invoice-checkout-retirement-sweeper.mjs, src/pulse/beats/beat-invoice-checkout-retirement.mjs"
].join("\n");

export const selfTest = {
  pass: () => ({ read: [{ match: /FROM payment_links pl/, rows: [{ stale_active: 0, stranded_expired: 0 }] }] }),
  fail: () => ({ read: [{ match: /FROM payment_links pl/, rows: [{ stale_active: 1, stranded_expired: 0 }] }] })
};
