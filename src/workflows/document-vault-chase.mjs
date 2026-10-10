// Document vault chase — the daily clock. Capital Blueprint unit B3.
//
// ONE PASS: for every client with a paid Capital Blueprint, run the vault's chase
// (src/finance/document-vault-chase.mjs) once. It asks for the next missing paper
// when one is due — a text, then an email, then a text — and after three asks hands
// the client to a CSM. It stops when the vault is complete, never chases a paper
// that is waiting on our review (it opens a "files are waiting for review" task for
// a person instead), and never asks twice inside the window.
//
// IT NEVER MOVES MONEY AND IT DOES NOT SEND. Asks are queued through sendTemplated;
// the dispatcher sends them (CLAUDE.md §12), behind quiet hours, the opt-out read
// and the dry-run switch.
//
// WHO IS CHASED: paid Capital Blueprint buyers only — the vault is a Blueprint offer
// line. The list is the one src/workflows/blueprint-finance-os-alerts.mjs already
// reads (same product code, same paid status as the closer-ready sweeper). Anyone
// else can still open the vault and upload.
//
// KILL SWITCH. DOCUMENT_VAULT_CHASE=off makes the pass do nothing. Unset is on.
//
// Runs at 16:45 UTC (9:45am Arizona, inside the text day window), a quarter hour
// after the money helper, so a client who got a money text this morning is not
// also asked for a paper (the chase itself refuses a second message on a channel
// inside 20 hours, whoever sent the first).
//
// ONE STEP PER CLIENT. An Inngest pass runs inside the /api/inngest request, which
// Netlify cuts at 26 seconds (the lesson src/workflows/blueprint-finance-os-alerts.mjs
// records). Each client is its own step.run, so one slow client cannot sink the rest
// and a retry re-runs only that client; the claim-first ask makes a re-run safe.
// NEVER THROWS FOR THE WHOLE PASS — one client's error is recorded in the tally and
// the next client runs.

import { inngest } from "./client.mjs";
import { db } from "../db.mjs";
import { sendTemplated as defaultSend } from "./messaging.mjs";
import { createTask as defaultCreateTask } from "../lib/create-task.mjs";
import { runVaultChase } from "../finance/document-vault-chase.mjs";
import { blueprintBuyerClients } from "./blueprint-finance-os-alerts.mjs";

export const SWEEP_CRON = "45 16 * * *";
export const SOURCE_WORKFLOW = "document-vault-chase";

/** Paid Capital Blueprint buyers, optionally one company's. */
export async function blueprintBuyers(conn, { orgId = null, buyers = blueprintBuyerClients } = {}) {
  const rows = await buyers(conn);
  return orgId ? rows.filter((r) => String(r.org_id) === String(orgId)) : rows;
}

/** sweep — one pass. db, clock, send and createTask are arguments so tests drive it
    without Inngest or a network. `step` is optional; with it each client is its own
    Inngest step. Returns a tally. */
export async function sweep(conn = db, {
  now = new Date(), env = process.env, orgId = null, dryRun = false, step = null,
  send = defaultSend, createTask = defaultCreateTask, buyers = blueprintBuyerClients
} = {}) {
  if (String((env || {}).DOCUMENT_VAULT_CHASE || "").trim().toLowerCase() === "off") {
    return { skipped: true, reason: "switched_off" };
  }
  const inStep = (name, fn) => (step && typeof step.run === "function" ? step.run(name, fn) : fn());
  const tally = { checked: 0, asked: 0, csm: 0, review: 0, notAsked: {}, errored: [] };
  const clients = await inStep("audience", () => blueprintBuyers(conn, { orgId, buyers }));
  tally.checked = clients.length;

  for (const c of clients) {
    try {
      // Only a small, plain summary leaves the step: Inngest stores what a step returns.
      const r = await inStep(`vault-${c.client_id}`, async () => {
        const out = await runVaultChase(conn, {
          orgId: c.org_id, clientId: c.client_id, now, env, dryRun, send, createTask
        });
        return {
          reason: out.reason,
          asked: !!(out.ask && out.ask.asked),
          askReason: out.ask ? out.ask.reason : null,
          csm: !!(out.csm && out.csm.created),
          review: !!(out.review && out.review.created)
        };
      });
      if (r.asked) tally.asked += 1;
      if (r.csm) tally.csm += 1;
      if (r.review) tally.review += 1;
      if (!r.asked) {
        const why = r.askReason || r.reason;
        tally.notAsked[why] = (tally.notAsked[why] || 0) + 1;
      }
    } catch (e) {
      tally.errored.push({ clientId: c.client_id, error: String((e && e.message) || e).slice(0, 300) });
    }
  }
  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron with no event
   trigger, so it sits in the runner's neverFired list by design. */
export async function handle({ db: handleDb, step } = {}) {
  return sweep(handleDb || db, { step });
}

export const documentVaultChase = inngest.createFunction(
  { id: "document-vault-chase", name: "Document vault chase" },
  { cron: SWEEP_CRON },
  ({ step }) => sweep(db, { step })
);

export default sweep;
