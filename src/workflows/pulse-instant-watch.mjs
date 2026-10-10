// Instant pulse — every 5 minutes, critical doors + outbound stuck → Chris SMS.
// Cooldown: one text per failure fingerprint per hour (agent_runs).

import { inngest } from "./client.mjs";
import { db as defaultDb } from "../db.mjs";
import { runInstantWatch } from "../pulse/instant-watch.mjs";

export const PULSE_INSTANT_CRON = "*/5 * * * *";

export async function handle({ db, step, env = process.env, fetchImpl } = {}) {
  const run = step?.run ? (name, fn) => step.run(name, fn) : (_n, fn) => fn();
  return run("pulse-instant-watch", () => runInstantWatch({ db, env, fetchImpl }));
}

export const pulseInstantWatch = inngest.createFunction(
  { id: "pulse-instant-watch", name: "Instant pulse — critical doors (every 5 min)" },
  { cron: PULSE_INSTANT_CRON },
  ({ step }) => handle({ db: defaultDb, step, env: process.env })
);

export default pulseInstantWatch;
