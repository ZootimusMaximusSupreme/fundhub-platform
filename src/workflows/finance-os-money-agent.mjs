// Finance OS money helper — the daily clock.
//
// ONE PASS: for every client with an active `finance-os` subscription, run the
// money helper (src/finance/money-agent.mjs) once. It looks at Clarity
// Payments (money owed to Fundhub) and card bills already past due, and takes
// at most one ladder step per item: reminder, late check-in, second check-in,
// then a CSM task.
//
// IT NEVER MOVES MONEY AND IT DOES NOT SEND. Texts are queued through
// sendTemplated; the dispatcher sends them (CLAUDE.md §12).
//
// Runs half an hour after finance-os-card-due-reminders (16:00 UTC), so the
// card bills it reads were refreshed from Plaid that morning.
//
// NEVER THROWS FOR THE WHOLE PASS. One client's error is recorded in the tally
// and the next client runs — same as finance-os-card-due-reminders.mjs.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { sendTemplated as defaultSend } from "./messaging.mjs";
import { createTask as defaultCreateTask } from "../lib/create-task.mjs";
import { entitledFinanceOsClients } from "./blueprint-finance-os-alerts.mjs";
import { runForClient, pickBrain } from "../finance/money-agent.mjs";

export const SWEEP_CRON = "30 16 * * *"; // 16:30 UTC = 9:30am Arizona, inside the SMS day window
export const SOURCE_WORKFLOW = "finance-os-money-agent";

/** sweep — one pass. db, clock, brain, send and createTask are arguments so
    tests drive it without Inngest or a network. */
export async function sweep(conn = db, {
  now = new Date(), env = process.env, brain = pickBrain(env), send = defaultSend, createTask = defaultCreateTask
} = {}) {
  const todayIso = now.toISOString().slice(0, 10);
  const tally = { checked: 0, decided: 0, queued: 0, tasks: 0, held: 0, errored: [] };
  const clients = await entitledFinanceOsClients(conn, now);
  tally.checked = clients.length;

  for (const c of clients) {
    try {
      const r = await runForClient(conn, { orgId: c.org_id, clientId: c.client_id, todayIso, brain, send, createTask });
      tally.decided += r.decided;
      tally.queued += r.queued;
      tally.tasks += r.tasks;
      tally.held += r.held;
    } catch (e) {
      tally.errored.push({ clientId: c.client_id, error: String(e?.message || e).slice(0, 300) });
    }
  }
  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron with no
   event trigger, so it sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  const run = () => sweep(handleDb || db);
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const financeOsMoneyAgent = inngest.createFunction(
  { id: "finance-os-money-agent", name: "Finance OS money helper" },
  { cron: SWEEP_CRON },
  () => sweep(db)
);

export default sweep;
