#!/usr/bin/env node
// One-off: add a sample loan to the FinanceOS test client (wave 3, G2).
//
// WHAT IT WRITES (owner-set 2026-10-06: sample data is fine):
//   * one hand-entered loan "SBA Loan" in the business container "Fundhub LLC":
//     balance (payoff) $48,000, monthly payment $1,050, due the 1st.
// It goes through the same path the Accounts tab's "add by hand" form uses
// (readHandAccount → addHandAccount), so the account, its container and its
// due day are written by the tested writers — nothing is inserted by hand here.
//
// NO TEXT IS SENT OR QUEUED BY THIS SCRIPT. Once it is in, the daily card-due
// reminder job (src/workflows/finance-os-card-due-reminders.mjs) will remind
// this loan 0-3 days before the 1st, if the client has an active finance-os
// subscription — through the normal queue, dispatcher and opt-out checks.
//
// SAFE TO RE-RUN: an open loan with the same name already in that container is
// skipped. Never deletes anything.
//
// Needs the G2 code live (saveStatementCycle accepts loans). Migration 451 is
// only needed for the reminder row, not for this write.
//   node --env-file=.env scripts/seed-sample-loan.mjs            # dry run, read-only, writes nothing
//   node --env-file=.env scripts/seed-sample-loan.mjs --apply    # writes

import { db, pool, close } from "../src/db.mjs";
import { readHandAccount, addHandAccount } from "../src/finance/money-accounts.mjs";

const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const CONTAINER = "386c687a-167d-4d44-a000-8d50b5a80191"; // Fundhub LLC

const APPLY = process.argv.slice(2).includes("--apply");

/* What a person would type into the form. Dollars here; the form reader turns
   them into cents (4800000, 105000). */
const FORM = {
  name: "SBA Loan",
  type: "loan",
  balance: "48,000",
  minimum: "1,050",
  due_day: "1",
  container_id: CONTAINER
};

/* Every dry-run read sits inside BEGIN READ ONLY … ROLLBACK on one connection. */
async function readOnly(fn) {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN READ ONLY");
    return await fn(conn);
  } finally {
    await conn.query("ROLLBACK");
    conn.release();
  }
}

async function main() {
  const input = readHandAccount(FORM);
  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — client ${CLIENT}, org ${ORG}`);
  console.log(`loan: ${input.name}, balance ${input.balance} cents, payment ${input.minimum} cents, due day ${input.dueDay}, container ${input.containerId}`);

  const state = await readOnly(async (conn) => {
    const c = await conn.query(`SELECT id FROM clients WHERE id = $1 AND org_id = $2`, [CLIENT, ORG]);
    const e = await conn.query(
      `SELECT id, name, kind, archived_at FROM entities WHERE id = $1 AND org_id = $2 AND client_id = $3`,
      [CONTAINER, ORG, CLIENT]);
    const have = await conn.query(
      `SELECT id FROM bank_accounts
        WHERE org_id = $1 AND client_id = $2 AND entity_id = $3
          AND account_type = 'loan' AND name = $4 AND closed_at IS NULL`,
      [ORG, CLIENT, CONTAINER, input.name]);
    return { client: c.rows[0], container: e.rows[0], existing: have.rows[0] };
  });

  if (!state.client) throw new Error("test client not found in that org");
  if (!state.container) throw new Error("container Fundhub LLC not found for that client");
  if (state.container.archived_at) throw new Error("container Fundhub LLC is archived");
  console.log(`container: ${state.container.name} (${state.container.kind})`);

  if (state.existing) {
    console.log(`skip — an open "${input.name}" is already in that container (${state.existing.id})`);
    return;
  }
  if (!APPLY) {
    console.log("dry run: nothing written. Add --apply to write.");
    return;
  }

  const r = await addHandAccount(db, {
    orgId: ORG, clientId: CLIENT, input, by: { kind: "staff", id: null }
  });
  if (!r.ok) throw new Error(`not written: ${r.reason}`);
  console.log(`wrote loan ${r.account_id}`);
}

main().then(() => close(), async (e) => { console.error(e?.message || e); await close(); process.exit(1); });
