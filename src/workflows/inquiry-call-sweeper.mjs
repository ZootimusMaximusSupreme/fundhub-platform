// Sweeper — fire AI bureau calls when call_due_at elapses.
//
// SERVED SINCE 2026-08-19, owner decision. It was previously switched off by
// being left out of src/workflows/index.mjs, which nothing counted and no
// screen showed — see src/workflows/index.test.mjs, which now fails if a
// workflow on disk is neither served nor explicitly listed as unserved.
//
// This places real outbound calls every hour (every 15 minutes until 2026-10-20,
// slowed for the Inngest Free plan run limit). The gate that remains is
// call_due_at: fireDueCalls only touches rows whose wait has elapsed.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { fireDueCalls } from "../inquiry-ops/call-scheduler.mjs";

export async function handle({ db: database = db, step } = {}) {
  const run = step?.run
    ? (name, fn) => step.run(name, fn)
    : (_n, fn) => fn();
  return run("fire-due-inquiry-calls", () => fireDueCalls(database, {}));
}

export const inquiryCallSweeper = inngest.createFunction(
  { id: "inquiry-call-sweeper", name: "Inquiry call sweeper (delivery + configured wait)" },
  { cron: "15 * * * *" },
  async ({ step }) => handle({ db, step })
);

