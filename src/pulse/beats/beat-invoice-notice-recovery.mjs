import {
  RECOVERY_STUCK_SQL, recoveryProblems
} from "./lib/invoice-sent-recovery-truth.mjs";

export const id = "invoice-notice-recovery";
export const title = "Fee invoices receive the first notice";
export const kind = "probe";
export const covers = ["job:invoice-sent-recovery"];
export const box = false;
export const reads = [];
export const steps = ["first-notice"];
export const damp = 1;
export const deadlineMs = 9000;

export async function run(ctx) {
  await ctx.step("first-notice", async () => {
    let result;
    try { result = await ctx.read(RECOVERY_STUCK_SQL); }
    catch (err) {
      throw ctx.fail("first-notice", `Could not read fee invoice notices: ${String(err?.message || err).slice(0, 100)}`);
    }
    const verdict = recoveryProblems(result.rows[0]);
    if (!verdict.healthy) throw ctx.fail("first-notice", verdict.detail);
  });
  return ctx.done("No aged fee invoice is missing its checkout or first notice.");
}

export const fixGuide = [
  "A sent fee invoice still lacks a checkout or first notice.",
  "Likely causes:",
  "- The invoice.sent event was not saved or handed to Inngest.",
  "- Commas checkout creation or an AR notice template failed.",
  "Steps:",
  "- Read the fee invoice, its saved event, payment link, and first-notice rows.",
  "- Check the invoice-sent-recovery and AR job receipts before any resend.",
  "- Repair the failing provider or template, then verify the same event ID resumes.",
  "Files: src/workflows/invoice-sent-recovery.mjs, src/workflows/ar-collections.mjs, src/pulse/beats/beat-invoice-notice-recovery.mjs"
].join("\n");

export const selfTest = {
  pass: () => ({ read: [{ match: /FROM invoices i/, rows: [{ stuck: 0 }] }] }),
  fail: () => ({ read: [{ match: /FROM invoices i/, rows: [{ stuck: 1 }] }] })
};
