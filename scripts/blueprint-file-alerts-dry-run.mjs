#!/usr/bin/env node
// Dry run of the file-protection alerts over ONE client: what WOULD be texted today
// and on every later day. READ ONLY. NOTHING IS QUEUED. NOTHING IS STORED.
//
// Capital Blueprint launch, unit B2 (ops/workflows/blueprint-launch-2026-10-06.md).
// The migration (471) is not on the live database until it ships, so the alerts' own
// tables are not there to write to. This runs the real daily pass — the real readers
// of the client's accounts, statement cycles, credit pulls, opt-out and Blueprint
// status — but with an IN-MEMORY alerts store and a `send` that only prints. The
// real sendTemplated is never called, so no `messages` row is ever written, whatever
// MESSAGING_DRY_RUN says.
//
// EVERY READ is inside BEGIN READ ONLY … ROLLBACK on one connection. No SET, no
// write, no delete. (src/finance/file-alerts/safety.test.mjs keeps the alert code
// itself free of provider imports and network calls.)
//
//   node --env-file=.env scripts/blueprint-file-alerts-dry-run.mjs
//   node --env-file=.env scripts/blueprint-file-alerts-dry-run.mjs --days 70
//   node --env-file=.env scripts/blueprint-file-alerts-dry-run.mjs --no-simulate
//   node --env-file=.env scripts/blueprint-file-alerts-dry-run.mjs --client <uuid> --org <uuid>
//
// PART A is the client's REAL data, day by day. PART B layers clearly-labelled
// SIMULATED changes on top of that real data (a promo end date, a cash drop, a new
// card, a new inquiry) for the alerts the real data cannot trigger today. Part B is
// a demonstration of the same code on invented inputs; it is never stored.

import { pool, close, dbTarget } from "../src/db.mjs";
import { runFileAlerts } from "../src/finance/file-alerts/run.mjs";
import { createMemoryStore } from "../src/finance/file-alerts/memory-store.mjs";
import { loadLatestPulls } from "../src/finance/file-alerts/snapshot.mjs";
import { assignedCsm } from "../src/finance/file-alerts/store.mjs";
import { evaluateReserve, CASH_KINDS } from "../src/finance/file-alerts/cash-reserve.mjs";
import { loadSnapshot } from "../src/finance/file-alerts/snapshot.mjs";
import { ACCOUNT_SQL } from "../src/finance/money-overview.mjs";
import { isCapitalBlueprintBuyer } from "../src/blueprint/coach-exception.mjs";
import { isOptedOut } from "../src/lib/opt-out.mjs";
import { alertAudience } from "../src/workflows/blueprint-finance-os-alerts.mjs";
import { addDaysIso, dollars } from "../src/finance/file-alerts/common.mjs";

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};
const CLIENT = flag("--client", "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e");
const ORG = flag("--org", "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6");
const DAYS = Math.max(1, Math.min(200, Number(flag("--days", "50")) || 50));
const SIMULATE = !args.includes("--no-simulate");
const STOP = " Reply STOP to opt out.";

const money = (c) => (c === null || c === undefined ? "unknown" : dollars(c));
const at = (iso, day) => new Date(Date.parse(`${iso}T07:30:00.000Z`) + day * 86_400_000);
const dayOf = (d) => d.toISOString().slice(0, 10);

/* What one pass would do, printed — and recorded. The pass is handed THESE instead of
   sendTemplated and createTask. */
function printers(out) {
  return {
    send: async (_c, a) => {
      out.sends.push(a);
      out.lines.push(`  WOULD QUEUE sms  ${a.templateKey}  (event ${a.eventId.length > 60 ? `${a.eventId.slice(0, 57)}...` : a.eventId})`);
      return { sent: true, messageId: `dry-${out.sends.length}` };
    },
    createTask: async (_c, t) => {
      out.tasks.push(t);
      out.lines.push(`  WOULD OPEN CSM TASK  "${t.title}"  assignee_role ${t.assigneeRole}${t.assigneeStaffId ? `, staff ${t.assigneeStaffId}` : ", unassigned (client has no CSM yet)"}`);
      return { created: true, id: `dry-task-${out.tasks.length}` };
    }
  };
}

/** Run the pass for each day, printing only the days something happens. */
async function days(conn, { label, startIso, count, store, deps = {}, dayHook = () => {} }) {
  console.log(`\n=== ${label}`);
  let quiet = 0;
  for (let i = 0; i < count; i++) {
    dayHook(i);
    const when = at(startIso, i);
    const out = { sends: [], tasks: [], lines: [] };
    const p = printers(out);
    const r = await runFileAlerts(conn, { orgId: ORG, clientId: CLIENT, now: when, env: {} }, {
      send: p.send, createTask: p.createTask, store, ...deps
    });
    const note = [];
    if (r.rearmed.length) note.push(`re-armed the ${r.rearmed.join(" and ")} cash alert`);
    if (r.held.length) note.push(`${r.held.length} held (opted out)`);
    if (r.errors.length) note.push(`ERRORS ${JSON.stringify(r.errors)}`);
    if (r.sent.length === 0 && note.length === 0) { quiet += 1; continue; }
    console.log(`${dayOf(when)}  (day ${i})`);
    for (const s of r.sent) {
      console.log(`  [${s.kind}] ${s.delivery === "text" ? "text queued" : "NO text — task only"}`);
      console.log(`      "${s.body}${s.delivery === "text" ? STOP : ""}"`);
    }
    for (const l of out.lines) console.log(l);
    for (const n of note) console.log(`  ${n}`);
  }
  console.log(`(${quiet} of ${count} days had nothing to send)`);
}

/* One connection, one query at a time. The readers ask several things at once (the
   production pool runs them side by side); a single connection would queue them and
   node-postgres warns that doing so is going away. This line makes it explicit. */
function serial(client) {
  let tail = Promise.resolve();
  return {
    query(sql, params) {
      const run = tail.then(() => client.query(sql, params));
      tail = run.catch(() => {});
      return run;
    }
  };
}

/* A connection that answers like the real one, with the rows of the three reads the
   simulations change rewritten on the way out. The database is never asked anything
   it was not going to be asked. */
function simulate(conn, patch) {
  return {
    async query(sql, params) {
      const r = await conn.query(sql, params);
      const s = String(sql);
      if (s === ACCOUNT_SQL && patch.accounts) return { ...r, rows: patch.accounts(r.rows) };
      if (/item_created_at/.test(s) && patch.meta) return { ...r, rows: patch.meta(r.rows) };
      if (/FROM account_statement_cycles s/.test(s) && patch.cycles) return { ...r, rows: patch.cycles(r.rows) };
      return r;
    }
  };
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set (use --env-file=.env)");
  const client = await pool().connect();
  const raw = serial(client);
  // Every query below goes through THIS connection, inside a read-only transaction.
  await raw.query("BEGIN READ ONLY");
  try {
    const now = new Date();
    const todayIso = dayOf(now);
    console.log(`DRY RUN — read only, nothing queued, nothing stored`);
    console.log(`database ${dbTarget()}  ·  client ${CLIENT}  ·  org ${ORG}  ·  today ${todayIso} (UTC)`);

    const snap = await loadSnapshot(raw, { orgId: ORG, clientId: CLIENT, asOf: now });
    if (!snap) throw new Error("that client is not in that org");
    const tables = await raw.query(
      `SELECT to_regclass('file_protection_alerts') IS NOT NULL AS alerts_table,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'account_statement_cycles' AND column_name = 'promo_ends_on') AS promo_columns`);
    const optedOut = await isOptedOut(raw, CLIENT, "sms");
    const blueprint = await isCapitalBlueprintBuyer(raw, { orgId: ORG, clientId: CLIENT });
    const audience = (await alertAudience(raw, now)).some((r) => r.org_id === ORG && r.client_id === CLIENT);
    const csm = await assignedCsm(raw, { orgId: ORG, clientId: CLIENT });

    console.log(`\nWHAT THE PASS SEES`);
    console.log(`  migration 471 on this database: tables ${tables.rows[0].alerts_table ? "present" : "NOT THERE YET"}, promo columns ${tables.rows[0].promo_columns ? "present" : "NOT THERE YET"}`);
    console.log(`  in the daily audience (Blueprint buyer or Finance OS subscriber): ${audience ? "yes" : "NO — the real job would skip this client"}`);
    console.log(`  Blueprint buyer: ${blueprint ? "yes (a new card also opens a CSM task)" : "no"}  ·  assigned CSM: ${csm || "none"}  ·  texting: ${optedOut ? "OPTED OUT" : "allowed"}`);
    for (const card of snap.overview.debt.cards) {
      const cyc = snap.cycleByAccount.get(String(card.account_id));
      console.log(`  card  ${card.name} ····${card.mask}  (${card.kind})  balance ${money(card.balance_cents)} of ${money(card.limit_cents)}  ` +
        `statement closes day ${cyc?.statement_close_day ?? "—"}, due day ${cyc?.payment_due_day ?? "—"}, minimum ${money(card.min_due_cents)}  promo ${cyc?.promo_ends_on ?? "none"}`);
    }
    for (const l of snap.overview.debt.loans) {
      console.log(`  loan  ${l.name}  (${l.kind})  owed ${money(l.balance_cents)}  payment ${money(l.payment_cents)}`);
    }
    console.log(`  Fundhub payment plans, next payment of each added: ${money(snap.clarityMonthlyCents)} (counted against personal cash)`);
    for (const kind of CASH_KINDS) {
      const v = evaluateReserve({ kind, cash: snap.overview.cash[kind], debts: snap.debts, clarityMonthlyCents: snap.clarityMonthlyCents, staleBalance: snap.staleByKind[kind] });
      console.log(`  ${kind.padEnd(8)} cash ${money(v.cash_cents)}  ·  monthly minimums ${money(v.minimums_cents)}${v.minimums_is_floor ? " (at least)" : ""}  ·  6 months = ${money(v.need_cents)}  ->  ${v.state.toUpperCase()}${v.reason && v.state === "unknown" ? ` (${v.reason})` : ""}`);
    }

    const real = { isOptedOut, isBlueprint: isCapitalBlueprintBuyer, loadLatestPulls };
    const withRealStore = (mem) => ({ ...mem, assignedCsm: (c, a) => assignedCsm(c, a) });

    // PART A — the real data, every day
    await days(raw, {
      label: `PART A — REAL DATA, ${todayIso} for ${DAYS} days (texts at 07:30 UTC; the dispatcher then holds each for quiet hours)`,
      startIso: todayIso, count: DAYS, store: withRealStore(createMemoryStore()), deps: real
    });

    if (SIMULATE) {
      console.log(`\n\nPART B — SIMULATED. The client's real data, with ONE invented change each. Not stored. Not real.`);

      // B1 — a promo end date 62 days out on the open Business Amex.
      const amex = snap.overview.debt.cards.find((c) => /amex/i.test(c.name));
      if (amex) {
        const ends = addDaysIso(todayIso, 62);
        await days(simulate(raw, {
          cycles: (rows) => {
            const mine = rows.some((x) => (x.row ?? x).bank_account_id === amex.account_id);
            const promo = { promo_ends_on: ends, promo_apr: "0.00000", promo_source: "staff", promo_set_at: now.toISOString() };
            return mine
              ? rows.map((x) => ((x.row ?? x).bank_account_id === amex.account_id ? { row: { ...(x.row ?? x), ...promo } } : x))
              : [...rows, { row: { bank_account_id: amex.account_id, statement_close_day: null, payment_due_day: null, minimum_payment_cents: null, source: "manual", raw: {}, ...promo } }];
          }
        }), { label: `B1 — SIMULATED: ${amex.name} promo ends ${ends} (typed in by staff) — texts at 60, 30 and 7 days, once each`,
          startIso: todayIso, count: 66, store: withRealStore(createMemoryStore()), deps: real });
      }

      // B2 — personal cash drops, recovers, drops again.
      const pchk = snap.overview.accounts.find((a) => a.type === "depository" && a.kind === "personal");
      if (pchk) {
        let day = 0;
        const balances = [390000, 390000, 520000, 520000, 350000, 350000];
        await days(simulate(raw, {
          accounts: (rows) => rows.map((r) => (r.id === pchk.id ? { ...r, current_balance_cents: balances[Math.min(day, balances.length - 1)] } : r))
        }), {
          label: `B2 — SIMULATED: ${pchk.name} reads $3,900 (days 0-1), $5,200 (days 2-3, recovered), $3,500 (days 4-5, dropped again)`,
          startIso: todayIso, count: balances.length, store: withRealStore(createMemoryStore()), deps: real, dayHook: (i) => { day = i; }
        });
      }

      // B3 — a new card on the linked login, seen yesterday; the client is treated as a Blueprint buyer.
      const item = (await raw.query(`SELECT plaid_item_id FROM bank_accounts WHERE client_id = $1 AND org_id = $2 AND closed_at IS NULL AND plaid_item_id IS NOT NULL LIMIT 1`, [CLIENT, ORG])).rows[0];
      if (item) {
        const created = new Date(now.getTime() - 86_400_000).toISOString();
        const newCard = {
          id: "00000000-0000-4000-8000-00000000f4ee", name: "Chase Freedom", official_name: null, mask: "4321", provider: "plaid",
          account_type: "credit", account_subtype: "credit card", available_balance_cents: null, current_balance_cents: 0, credit_limit_cents: 1000000,
          entity_kind: "personal", entity_kind_source: "staff_reviewed", entity_kind_set_at: null, entity_id: null, closed_at: null, institution_name: null
        };
        const firstItemAt = new Date(now.getTime() - 20 * 86_400_000).toISOString();
        await days(simulate(raw, {
          accounts: (rows) => [...rows, newCard],
          meta: (rows) => [
            ...rows.map((r) => ({ ...r, item_created_at: firstItemAt, created_at: firstItemAt })),
            { id: newCard.id, account_type: "credit", plaid_item_id: item.plaid_item_id, mask: "4321", name: "Chase Freedom", closed_at: null, created_at: created, balance_as_of: created, item_created_at: firstItemAt }
          ]
        }), {
          label: "B3 — SIMULATED: a new card (Chase Freedom ending 4321) appears on the linked login yesterday; treated as a Blueprint buyer",
          startIso: todayIso, count: 3, store: withRealStore(createMemoryStore()), deps: { ...real, isBlueprint: async () => true }
        });
      }

      // B4 — two credit pulls with a new inquiry and a new account on the newer one.
      const tl = { accountType: "Revolving", creditorName: "Credit One Bank", accountIdentifier: "SIM-CRED1-3018", accountOpenedDate: "2022-09-14" };
      const pulls = {
        prev: { id: "sim-pull-1", on: addDaysIso(todayIso, -30), result: { tradelines: [tl], inquiries: [] } },
        latest: {
          id: "sim-pull-2", on: addDaysIso(todayIso, -1),
          result: {
            tradelines: [tl, { accountType: "Revolving", creditorName: "Capital One", accountIdentifier: "CAP-5566", accountOpenedDate: addDaysIso(todayIso, -12) }],
            inquiries: [{ creditorName: "American Express", date: addDaysIso(todayIso, -12), source: "EX" }]
          }
        }
      };
      await days(raw, {
        label: "B4 — SIMULATED: a credit pull from yesterday shows a new account and a new inquiry that the pull before it did not",
        startIso: todayIso, count: 2, store: withRealStore(createMemoryStore()), deps: { ...real, loadLatestPulls: async () => pulls }
      });
    }

    console.log(`\nDone. Nothing was queued, written or stored.`);
  } finally {
    await raw.query("ROLLBACK");
    client.release();
    await close();
  }
}

main().catch((e) => {
  console.error(`dry run failed: ${e && e.message ? e.message : e}`);
  process.exitCode = 1;
});
