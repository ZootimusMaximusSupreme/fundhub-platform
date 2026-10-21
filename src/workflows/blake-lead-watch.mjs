// Blake referral mail → staff text to Chris (name + phone only).
// Chris texts the person. This job never texts the referred person.

import { inngest } from "./client.mjs";
import { watchBlakeLeads } from "../staff/blake-lead-watch.mjs";

export const BLAKE_LEAD_CRON = "*/30 * * * *";

export async function handle({ step, env = process.env } = {}) {
  const run = step?.run ? (name, fn) => step.run(name, fn) : (_n, fn) => fn();
  return run("watch-blake-referrals", () => watchBlakeLeads({ env, dryRun: false }));
}

export const blakeLeadWatch = inngest.createFunction(
  { id: "blake-lead-watch", name: "Blake referral watch" },
  { cron: BLAKE_LEAD_CRON },
  async ({ step }) => handle({ step, env: process.env })
);

export default blakeLeadWatch;
