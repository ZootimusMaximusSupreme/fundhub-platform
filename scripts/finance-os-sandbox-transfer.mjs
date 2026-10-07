#!/usr/bin/env node
// One FinanceOS money move, end to end, in the Plaid SANDBOX — the role-play
// Chris asked for (FinanceOS wave 5, unit W7). Fake banks, fake money.
//
//   node scripts/finance-os-sandbox-transfer.mjs                 dry run: says what it would do
//   node scripts/finance-os-sandbox-transfer.mjs --apply         runs it against the database
//   node scripts/finance-os-sandbox-transfer.mjs --memory --apply
//                                                                runs it on a throwaway sandbox bank
//                                                                and an in-memory store: no database
//
// Options (database mode):
//   --client <uuid>   default: the FinanceOS test client f1cb9c27-…
//   --from <uuid>     the bank_accounts row the money comes from (default: "Personal Checking")
//   --to <uuid>       the bank_accounts row it goes to             (default: "Business Checking")
//   --cents <n>       default 2000 ($20.00)
//
// WHAT IT DOES, IN ORDER — the same path a real move takes:
//   1. PROPOSE   proposeTransfer (src/finance/money-transfer-seam.mjs) writes a
//                464 proposal at needs_approval. Nothing moves.
//   2. APPROVE   the client's yes. Here it is ROLE-PLAYED and says so: the row is
//                approved by 'sandbox_role_play', never 'client'. 466 refuses
//                that approver on any non-sandbox row, so this script can never
//                move real money. In the app, only the client's own login approves.
//   3. SEND      executeTransfer: Plaid authorizes, then creates, the debit leg.
//   4. TRACK     Sandbox never moves on its own, so the script simulates Plaid's
//                steps (/sandbox/transfer/simulate) and reads them back through the
//                real event sync after each one: debit posted → settled →
//                funds_available, then the engine starts the credit leg, then
//                credit posted → settled. Each status is printed.
//
// REFUSES unless PLAID_ENV is sandbox and FINANCE_OS_TRANSFERS_LIVE is not 1.
// If the FINANCE_OS_TRANSFER_* caps are not set, this run uses the move's own
// amount as both caps, in this process only, and says so.
// Prints no token, no secret and no account number.
import { randomUUID } from "node:crypto";
import {
  approveTransferAsSandboxRolePlay, executeTransfer, syncTransferEvents, transferMode, TRANSFER_ENV, etToday, dollars
} from "../src/finance/money-transfers.mjs";
import { memoryStore, pgStore } from "../src/finance/money-transfers-store.mjs";
import { plaidTransferProvider } from "../src/banking/plaid-transfer.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const APPLY = flag("apply");
const MEMORY = flag("memory");
const TEST_CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const cents = Number(opt("cents") || 2000);

const base = process.env;
if (String(base.PLAID_ENV || "sandbox").trim() !== "sandbox") { console.error("PLAID_ENV is not sandbox — this script only moves fake money."); process.exit(1); }
if (String(base[TRANSFER_ENV.LIVE] ?? "").trim() === "1") { console.error("FINANCE_OS_TRANSFERS_LIVE=1 is set — refusing. This script is sandbox only."); process.exit(1); }
if (!Number.isSafeInteger(cents) || cents <= 0) { console.error("--cents must be a whole number above 0"); process.exit(1); }

const env = { ...base };
const capNote = [];
if (!env[TRANSFER_ENV.MAX]) { env[TRANSFER_ENV.MAX] = String(cents); capNote.push(`${TRANSFER_ENV.MAX}=${cents}`); }
if (!env[TRANSFER_ENV.DAILY]) { env[TRANSFER_ENV.DAILY] = String(cents); capNote.push(`${TRANSFER_ENV.DAILY}=${cents}`); }
const mode = transferMode(env);
if (!mode.enabled || mode.environment !== "sandbox") { console.error(`Transfers are off for this run: ${mode.reason}`); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (...a) => console.log(...a);
const provider = plaidTransferProvider({ env, environment: "sandbox" });

function line(t) {
  if (!t) return "(no transfer)";
  return `status=${t.status}  debit=${t.debit_status ?? "-"}  credit=${t.credit_status ?? "-"}${t.status_reason ? `  reason=${t.status_reason}` : ""}`;
}

async function ledger(label) {
  const l = await provider.ledger();
  say(`   Plaid Ledger ${label}: ${l.ok ? `available $${l.ledger.available}, pending $${l.ledger.pending}` : `unread (${l.reason})`}`);
}

/* Simulate one Plaid step, then read it back through the real event sync. A
   just-simulated event can take a moment to appear in /transfer/event/sync. */
async function step(store, transferId, plaidTransferId, eventType, wantLeg, wantStatus) {
  const sim = await provider.simulate(plaidTransferId, eventType);
  if (!sim.ok) throw new Error(`simulate ${eventType} refused: ${sim.errorCode || sim.reason} ${sim.error || ""}`);
  let t = null;
  for (let i = 0; i < 8; i++) {
    const s = await syncTransferEvents(store, { env, force: true });
    if (!s.ok) throw new Error(`event sync failed: ${s.reason} ${s.error_code || ""}`);
    t = await store.transfer(transferId);
    if (t[`${wantLeg}_status`] === wantStatus) break;
    await sleep(1500);
  }
  say(`   simulated ${wantLeg} ${eventType.padEnd(15)} → ${line(t)}`);
  return t;
}

async function runMove(store, { orgId, clientId, fromId, toId, toLabel, proposalId }) {
  const today = etToday(new Date());
  say(`\n2. APPROVE (role-play, sandbox only)`);
  const a = await approveTransferAsSandboxRolePlay(store, {
    orgId, clientId, proposalId, amountCents: cents, fromAccountId: fromId, toAccountId: toId, scheduledFor: today,
    actorId: "scripts/finance-os-sandbox-transfer.mjs"
  }, { env });
  if (!a.ok) throw new Error(`approval refused: ${a.reason}`);
  say(`   "${a.words}"`);
  say(`   ${line(a.transfer)}  (approved_by=${a.transfer.approved_by_kind})`);

  await ledger("before");
  say(`\n3. SEND the debit leg`);
  const e = await executeTransfer(store, { transferId: a.transfer.id }, { env, provider });
  if (!e.ok) throw new Error(`send refused: ${e.reason} ${e.error_code || ""} ${e.error || ""}`);
  let t = e.transfer;
  say(`   ${line(t)}`);

  say(`\n4. TRACK (simulated Plaid steps, read back through /transfer/event/sync)`);
  t = await step(store, t.id, t.debit_transfer_id, "posted", "debit", "posted");
  t = await step(store, t.id, t.debit_transfer_id, "settled", "debit", "settled");
  t = await step(store, t.id, t.debit_transfer_id, "funds_available", "debit", "funds_available");
  await provider.ledgerAvailable();
  await ledger("after the debit");
  t = await store.transfer(t.id);
  if (!t.credit_transfer_id) {
    const s = await syncTransferEvents(store, { env, force: true });
    t = await store.transfer(t.id);
    say(`   credit leg start: ${JSON.stringify(s.advanced)}`);
  }
  if (!t.credit_transfer_id) throw new Error(`the credit leg did not start: ${line(t)}`);
  say(`   credit leg to ${toLabel} started → ${line(t)}`);
  t = await step(store, t.id, t.credit_transfer_id, "posted", "credit", "posted");
  t = await step(store, t.id, t.credit_transfer_id, "settled", "credit", "settled");
  await ledger("after the credit");
  return t;
}

async function printLedger(events) {
  say(`\nLedger (money_transfer_events), oldest first:`);
  for (const ev of events) {
    say(`   #${String(ev.id).padStart(3)} ${String(ev.event_type).padEnd(22)} ${String(ev.from_status ?? "").padEnd(10)} → ${String(ev.to_status ?? "").padEnd(10)} debit=${ev.debit_status ?? "-"} credit=${ev.credit_status ?? "-"} by=${ev.actor_kind}${ev.provider_event_id ? ` plaid_event=${ev.provider_event_id}` : ""}`);
  }
}

/* ── memory mode: a throwaway sandbox bank, no database ────────────────── */
async function memoryRun() {
  const { sandboxPublicToken, exchangePublicToken, fetchAccounts } = await import("../src/banking/providers/plaid-http.mjs");
  const { encryptPlaidToken } = await import("../src/banking/plaid.mjs");
  const opts = { environment: "sandbox", clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env };
  say(`MEMORY MODE — a throwaway Plaid sandbox bank (First Platypus Bank, user_good) and an in-memory store. No database is touched.`);
  if (capNote.length) say(`Caps for this run only: ${capNote.join(", ")}`);
  if (!APPLY) { say(`\nDry run. Add --apply to run it.`); return; }

  const pt = await sandboxPublicToken({ institutionId: "ins_109508", products: ["transfer"] }, opts);
  if (!pt.ok) throw new Error(`sandbox link refused: ${pt.errorCode} ${pt.error}`);
  const ex = await exchangePublicToken(pt.publicToken, opts);
  if (!ex.ok) throw new Error(`exchange refused: ${ex.errorCode} ${ex.error}`);
  const acc = await fetchAccounts(ex.accessToken, opts);
  if (!acc.ok) throw new Error(`accounts refused: ${acc.errorCode} ${acc.error}`);
  const checking = acc.accounts.find((a) => a.subtype === "checking");
  const savings = acc.accounts.find((a) => a.subtype === "savings");
  const orgId = randomUUID(), clientId = randomUUID();
  const item = {
    id: randomUUID(), plaid_item_id: ex.itemId, link_state: "active", consent_granted_at: new Date().toISOString(),
    encrypted_access_token: encryptPlaidToken(ex.accessToken, { itemId: ex.itemId, env })
  };
  const view = (a) => ({
    id: randomUUID(), org_id: orgId, client_id: clientId, name: a.name, official_name: a.officialName, mask: a.mask,
    account_type: a.type, account_subtype: a.subtype, entity_kind: "personal", entity_name: null, closed_at: null,
    is_demo: false, plaid_account_id: a.plaidAccountId,
    available_balance_cents: a.availableBalance === null ? null : Math.round(a.availableBalance * 100),
    current_balance_cents: null, institution_name: "First Platypus Bank (Plaid sandbox — test data)", item
  });
  const from = view(checking), to = view(savings);
  const store = memoryStore({ clients: [{ id: clientId, org_id: orgId, first_name: "Test", last_name: "Test" }], accounts: [from, to] });

  say(`\n1. PROPOSE ${dollars(cents)} from ${from.name} ••${from.mask} to ${to.name} ••${to.mask} (a 464-shaped proposal in memory)`);
  const task = store.insertTask({
    org_id: orgId, client_id: clientId, task_key: `move:sandbox-proof-${Date.now()}`, kind: "deposit",
    title: `Sandbox proof: move ${dollars(cents)} to ${to.name}`, source: "staff", amount_cents: cents,
    to_kind: "bank_account", to_account_id: to.id, due_on: etToday(new Date()), requested_by_kind: "staff",
    detail: { proposed_by: "staff", via: "scripts/finance-os-sandbox-transfer.mjs" }
  });
  say(`   proposal ${task.id} → needs_approval`);
  const t = await runMove(store, { orgId, clientId, fromId: from.id, toId: to.id, toLabel: `${to.name} ••${to.mask}`, proposalId: task.id });
  const snap = store.snapshot();
  await printLedger(snap.events.filter((e) => e.transfer_id === t.id));
  const closed = snap.tasks.find((x) => x.id === task.id);
  say(`\nProposal (464 row) after the move: status=${closed.status}${closed.done_at ? `, done_at=${closed.done_at}` : ""}`);
  say(`money_agent_log: ${snap.log.map((l) => `${l.action} (${l.reason})`).join("; ") || "(none)"}`);
  say(`\nRESULT: ${t.status === "settled" ? "SETTLED" : "NOT SETTLED"} — ${line(t)}`);
  if (t.status !== "settled") process.exitCode = 1;
}

/* ── database mode: the test client's own sandbox accounts ─────────────── */
async function databaseRun() {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const pg = (await import("pg")).default;
  const { proposeTransfer } = await import("../src/finance/money-transfer-seam.mjs");
  const db = new pg.Pool({ connectionString: env.DATABASE_URL, max: 2 });
  /* The dry run only reads, and does it inside BEGIN READ ONLY … ROLLBACK on one
     connection, so it cannot write even by mistake. Never a bare SET. */
  const reader = APPLY ? null : await db.connect();
  try {
    if (reader) await reader.query("BEGIN READ ONLY");
    const q = reader || db;
    const clientId = opt("client") || TEST_CLIENT;
    const c = await q.query(`SELECT id, org_id FROM clients WHERE id = $1`, [clientId]);
    if (!c.rows[0]) throw new Error(`no client ${clientId}`);
    const orgId = c.rows[0].org_id;
    const store = pgStore(q);
    const sendable = await store.sendableAccounts(orgId, clientId);
    const pick = (id, name) => (id ? sendable.find((a) => a.id === id) : sendable.find((a) => a.name === name));
    const from = pick(opt("from"), "Personal Checking");
    const to = pick(opt("to"), "Business Checking");
    say(`DATABASE MODE — client ${clientId}, org ${orgId}. Plaid sandbox only.`);
    if (capNote.length) say(`Caps for this run only: ${capNote.join(", ")}`);
    say(`Sendable accounts: ${sendable.map((a) => `${a.name} ••${a.mask} (${a.id})`).join(", ") || "none"}`);
    if (!from || !to || from.id === to.id) throw new Error("need two different sendable sandbox accounts (see --from / --to)");
    say(`Plan: ${dollars(cents)} from ${from.name} ••${from.mask} to ${to.name} ••${to.mask}, dated ${etToday(new Date())}.`);
    if (!APPLY) { say(`\nDry run. Nothing written, nothing sent. Add --apply to run it.`); return; }

    say(`\n1. PROPOSE through proposeTransfer (464, needs_approval)`);
    const p = await proposeTransfer(db, {
      orgId, clientId, taskKey: `move:sandbox-proof-${Date.now()}`, kind: "deposit",
      title: `Sandbox proof: move ${dollars(cents)} to ${to.name}`, why: "Role-play of a FinanceOS money move in the Plaid sandbox.",
      dueOn: etToday(new Date()), source: "staff", amountCents: cents, toKind: "bank_account", toAccountId: to.id,
      requestedByKind: "staff", requestedByStaffId: null,
      detail: { proposed_by: "staff", via: "scripts/finance-os-sandbox-transfer.mjs" }
    });
    if (!p.ok) throw new Error(`proposal refused: ${p.reason}`);
    say(`   proposal ${p.proposalId} → ${p.status}`);
    const t = await runMove(store, { orgId, clientId, fromId: from.id, toId: to.id, toLabel: `${to.name} ••${to.mask}`, proposalId: p.proposalId });
    await printLedger(await store.events([t.id]));
    say(`\nRESULT: ${t.status === "settled" ? "SETTLED" : "NOT SETTLED"} — ${line(t)}`);
    if (t.status !== "settled") process.exitCode = 1;
  } finally {
    if (reader) {
      await reader.query("ROLLBACK").catch(() => {});
      reader.release();
    }
    await db.end();
  }
}

try {
  if (MEMORY) await memoryRun();
  else await databaseRun();
} catch (e) {
  console.error(`STOPPED: ${e.message}`);
  process.exitCode = 1;
}
