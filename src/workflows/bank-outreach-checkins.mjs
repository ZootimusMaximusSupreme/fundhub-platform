import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { schedulePartnerCheckins } from "../outreach/store.mjs";

export const CHECKIN_CRON = "TZ=America/Phoenix 0 7 * * *";
export async function handle({ step, database = db, now = new Date() } = {}) {
  const run = () => schedulePartnerCheckins(database, { now });
  return step?.run ? step.run("schedule-partner-checkins", run) : run();
}
export const bankOutreachCheckins = inngest.createFunction(
  { id: "bank-outreach-checkins", name: "Bank relationship check-ins" },
  { cron: CHECKIN_CRON },
  handle
);
