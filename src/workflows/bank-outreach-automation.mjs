// Bank outreach automation, every hour (every 15 minutes until 2026-10-20, slowed for
// the Inngest Free plan run limit): find bankers by search, queue the
// three cold emails, read banker replies. Each part is its own step so a slow
// search never eats the time the reply reader needs (Netlify cuts a step at 26s).
//
// IT SENDS NOTHING ITSELF. Emails are queued `messages` rows that
// src/messaging/dispatch.mjs gates and sends. The only outside call it makes is
// the search engine query, through src/messaging/providers/serper-search.mjs.
import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { searchSweep, sequenceSweep } from "../outreach/automation.mjs";
import { processReplies } from "../outreach/replies.mjs";

export const AUTOMATION_CRON = "57 * * * *";

const guard = (fn) => async () => {
  try { return await fn(); } catch (err) { return { ok: false, error: String(err?.message || err).slice(0, 300) }; }
};

export async function handle({ step, database = db, env = process.env, now = new Date() } = {}) {
  const run = (name, fn) => (step?.run ? step.run(name, guard(fn)) : guard(fn)());
  return {
    search: await run("find-bankers", () => searchSweep(database, { env, now })),
    emails: await run("queue-emails", () => sequenceSweep(database, { env, now })),
    replies: await run("read-replies", () => processReplies(database, { env, now }))
  };
}

export const bankOutreachAutomation = inngest.createFunction(
  { id: "bank-outreach-automation", name: "Bank outreach — find bankers, emails, replies" },
  { cron: AUTOMATION_CRON },
  ({ step }) => handle({ step })
);
