#!/usr/bin/env node
// FinanceOS sample client v3 — make the test client ONE realistic person whose
// every number agrees (wave 5 final pass; .claude/rules/sample-clients-consistent.md).
//
//   node --env-file=.env scripts/finance-os-sample-v3.mjs            # dry run: reads only, no Plaid call
//   node --env-file=.env scripts/finance-os-sample-v3.mjs --apply    # writes, for the test client only
//
// WHAT --apply DOES, in order, for client f1cb9c27… in org fb789b0b… and nobody else:
//   1. Links Plaid SANDBOX bank v3 (src/banking/plaid-sandbox-user.mjs) — one
//      new item — through completeLink(), then checks every balance and limit
//      Plaid stored against the numbers v3 worked out. A mismatch stops the run
//      before anything else moves.
//   2. Marks bank v2's four accounts closed (closed_at). Nothing is deleted —
//      the same as was done for v1.
//   3. Puts v3's accounts in the existing containers with assignAccount():
//      personal → "Chris (personal)", business → "Fundhub LLC".
//   4. Pulls v3's charges and deposits (syncClientTransactions) and card bills
//      (syncClientLiabilities), and checks both against v3's own numbers.
//   5. Builds ONE sample credit file from the linked Personal Visa
//      (src/finance/sample-credit-file.mjs), runs it through the real engines,
//      and stores it the way a simulated pull is stored (scripts/sim/push-credit.mjs
//      and crs-pull.mjs's stamp): a crs_results row marked simulated, its
//      tradelines and card_liabilities through the real ingests, and the five
//      counts UnderwriteIQ reads off the client.
//      NO EVENTS ARE EMITTED. analysis.completed / decision.rendered would run
//      the letter-delivery POST (C-06), the SLO pack, write the client's tier,
//      sync ClickFunnels and move the sales card — none of that is right for a
//      test client's sample file, and a sample must not reach anyone.
// The hand-entered "Sample Chase Ink ••9999" and "SBA Loan" are left exactly
// as they are.
//
// Re-running is safe: an existing v3 item is found and reused, closing and
// assigning are no-ops the second time, the syncs upsert, and the credit file
// is found by its fixed identity instead of being stored twice.
//
// Last, it prints the consistency table, read-only (BEGIN READ ONLY … ROLLBACK):
// Overview, the trends rebuild, Credit, plan pins and the payment strategy at
// $1,500 a month — the same functions the API answers with.
//
// Refuses unless PLAID_ENV is sandbox. Never a real credit pull, never a paid
// call, never a text.

import { pool, close } from "../src/db.mjs";
import { planMixedSandboxUser } from "../src/banking/plaid-sandbox-user.mjs";
import { sandboxPublicToken } from "../src/banking/providers/plaid-http.mjs";
import { completeLink } from "../src/banking/plaid-link.mjs";
import { syncClientTransactions } from "../src/banking/plaid-transactions.mjs";
import { syncClientLiabilities } from "../src/banking/plaid-liabilities.mjs";
import { assignAccount } from "../src/finance/containers.mjs";
import {
  buildSampleCreditFile, withEngineResult, countFields, sampleProviderResultId, SAMPLE_PROVIDER, SAMPLE_HOME
} from "../src/finance/sample-credit-file.mjs";
import { ingestCrsResult } from "../src/tradelines/store.mjs";
import { ingestCrsLiabilities } from "../src/liabilities/store.mjs";
import { mergeCustomFields } from "../src/workflows/custom-fields.mjs";
import { moneyOverview } from "../src/finance/money-overview.mjs";
import { creditOverview } from "../src/finance/credit-overview.mjs";
import { planBackfill, BACKFILL_DAYS } from "../src/finance/money-trends.mjs";
import { allPins } from "../src/finance/plan-sources/index.mjs";
import { strategyInputs } from "../src/finance/payment-strategy.mjs";
import { buildPlan } from "../public/app/money-strategy-math.js";

const CLIENT = "f1cb9c27-f858-4db1-b6bb-4eddc898bb8e";
const ORG = "fb789b0b-8d8d-4cdc-8a24-ee6b6659e0b6";
const V1_ITEM = "e92568d7-c310-4f58-bc46-08dec9c4424c";
const V2_ITEM = "f91a13cf-d5ce-4c3b-9d7f-382b121d31db";
const PERSONAL = "36b90655-f93d-4444-90a8-ccf713426e56"; // "Chris (personal)"
const BUSINESS = "386c687a-167d-4d44-a000-8d50b5a80191"; // "Fundhub LLC"
const CONTAINER_OF = {
  "Personal Checking": PERSONAL, "Personal Visa": PERSONAL,
  "Business Checking": BUSINESS, "Business Amex": BUSINESS
};
const INSTITUTION = { institution_id: "ins_109508", name: "First Platypus Bank" };
const STRATEGY_MONTHLY_CENTS = 150_000;

const APPLY = process.argv.slice(2).includes("--apply");
const env = process.env;

const usd = (c) => (c === null || c === undefined ? "—" : `${c < 0 ? "-" : ""}$${(Math.abs(c) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s = "") => console.log(s);

async function readOnly(fn) {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN READ ONLY");
    return await fn(conn);
  } finally {
    try { await conn.query("ROLLBACK"); } catch { /* the original error matters */ }
    conn.release();
  }
}

/* One read-only transaction, but each query behind its own SAVEPOINT, so one
   query that fails (a wave-5 table not on production yet) does not abort the
   reads after it — the same as the API, which runs each query on its own.
   Queries run one at a time, as savepoints must. */
function isolated(conn) {
  let n = 0;
  let chain = Promise.resolve();
  return {
    query(sql, params) {
      const run = async () => {
        const sp = `fos_read_${(n += 1)}`;
        await conn.query(`SAVEPOINT ${sp}`);
        try {
          const r = await conn.query(sql, params);
          await conn.query(`RELEASE SAVEPOINT ${sp}`);
          return r;
        } catch (e) {
          await conn.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          throw e;
        }
      };
      const p = chain.then(run, run);
      chain = p.catch(() => {});
      return p;
    }
  };
}

async function inTransaction(fn) {
  const conn = await pool().connect();
  try {
    await conn.query("BEGIN");
    const out = await fn(conn);
    await conn.query("COMMIT");
    return out;
  } catch (e) {
    try { await conn.query("ROLLBACK"); } catch { /* keep the first error */ }
    throw e;
  } finally {
    conn.release();
  }
}

/* ------------------------------------------------------------------ *
 * Reads
 * ------------------------------------------------------------------ */

async function readState(conn) {
  const client = (await conn.query(
    `SELECT id, first_name, last_name, email, custom_fields FROM clients WHERE id = $1 AND org_id = $2`, [CLIENT, ORG])).rows[0];
  if (!client) throw new Error("the test client is not in that org");
  const containers = (await conn.query(
    `SELECT id, kind, name, archived_at FROM entities WHERE client_id = $1 AND org_id = $2 AND id = ANY($3::uuid[])`,
    [CLIENT, ORG, [PERSONAL, BUSINESS]])).rows;
  const v2 = (await conn.query(
    `SELECT id, name, mask, closed_at FROM bank_accounts WHERE client_id = $1 AND org_id = $2 AND plaid_item_id = $3 ORDER BY name`,
    [CLIENT, ORG, V2_ITEM])).rows;
  const v3Items = (await conn.query(
    `SELECT p.id, p.created_at FROM plaid_items p
      WHERE p.client_id = $1 AND p.org_id = $2 AND p.id <> ALL($3::uuid[]) AND p.link_state = 'active'
        AND EXISTS (SELECT 1 FROM bank_accounts a WHERE a.plaid_item_id = p.id AND a.closed_at IS NULL)
      ORDER BY p.created_at`, [CLIENT, ORG, [V1_ITEM, V2_ITEM]])).rows;
  const sample = (await conn.query(
    `SELECT id, created_at, outcome_tier FROM crs_results WHERE org_id = $1 AND provider = $2 AND provider_result_id = $3`,
    [ORG, SAMPLE_PROVIDER, sampleProviderResultId()])).rows[0] || null;
  return { client, containers, v2, v3Items, sample };
}

async function v3Accounts(conn, itemId) {
  return (await conn.query(
    `SELECT id, name, mask, account_type, current_balance_cents, available_balance_cents, credit_limit_cents,
            entity_id, entity_kind, closed_at, balance_as_of
       FROM bank_accounts WHERE client_id = $1 AND org_id = $2 AND plaid_item_id = $3 ORDER BY name`,
    [CLIENT, ORG, itemId])).rows;
}

/* ------------------------------------------------------------------ *
 * Checks: what Plaid stored vs what v3 worked out
 * ------------------------------------------------------------------ */

function checkBalances(accounts, facts) {
  const bad = [];
  for (const f of facts.accounts) {
    const a = accounts.find((x) => x.name === f.name);
    if (!a) { bad.push(`${f.name}: not stored`); continue; }
    if (Number(a.current_balance_cents) !== f.currentCents) bad.push(`${f.name}: balance ${a.current_balance_cents} ≠ ${f.currentCents}`);
    if (f.type === "credit" && Number(a.credit_limit_cents) !== f.limitCents) bad.push(`${f.name}: limit ${a.credit_limit_cents} ≠ ${f.limitCents}`);
  }
  return bad;
}

async function checkActivity(conn, accounts, facts) {
  const rows = (await conn.query(
    `SELECT bank_account_id::text AS id, count(*)::int AS n, COALESCE(SUM(amount_cents), 0)::bigint AS sum,
            MIN(posted_on)::text AS first, MAX(posted_on)::text AS last
       FROM bank_transactions
      WHERE client_id = $1 AND org_id = $2 AND bank_account_id = ANY($3::uuid[])
        AND is_pending = false AND NOT (raw ? 'fundhub_removed_at')
      GROUP BY 1`, [CLIENT, ORG, accounts.map((a) => a.id)])).rows;
  const out = [];
  for (const f of facts.accounts) {
    const a = accounts.find((x) => x.name === f.name);
    const r = rows.find((x) => x.id === String(a.id)) || { n: 0, sum: 0 };
    /* Repo sign: a card's purchases are money out (negative), so its stored sum
       is minus v3's "owed went up" activity. */
    const want = f.type === "credit" ? -f.activityCents : f.activityCents;
    out.push({ name: f.name, rows: r.n, sum: Number(r.sum), want, ok: Number(r.sum) === want, first: r.first ?? null, last: r.last ?? null });
  }
  return out;
}

async function checkCycles(conn, accounts, facts) {
  const cards = accounts.filter((a) => a.account_type === "credit");
  const rows = (await conn.query(
    `SELECT bank_account_id::text AS id, last_statement_date::text AS stmt_on, last_statement_balance_cents AS stmt,
            minimum_payment_cents AS min, apr, payment_due_day, raw->>'next_payment_due_date' AS due_on,
            raw->>'last_payment_amount_cents' AS last_pay, raw->>'last_payment_date' AS last_pay_on
       FROM account_statement_cycles WHERE client_id = $1 AND org_id = $2 AND bank_account_id = ANY($3::uuid[])`,
    [CLIENT, ORG, cards.map((a) => a.id)])).rows;
  return cards.map((a) => {
    const f = facts.accounts.find((x) => x.name === a.name);
    const r = rows.find((x) => x.id === String(a.id)) || null;
    const ok = !!r && r.stmt_on === f.lastStatement.date && Number(r.stmt) === f.lastStatement.balanceCents &&
      Number(r.min) === f.minimumPaymentCents && Math.round(Number(r.apr) * 10000) === Math.round(f.purchaseApr * 100) &&
      Number(r.last_pay) === f.lastPayment.amountCents && r.last_pay_on === f.lastPayment.date;
    return { name: a.name, ok, row: r, want: f };
  });
}

/* The Personal Visa as the bank holds it — the only source the credit file's
   Visa line is allowed to read. */
async function visaFromBank(conn, accounts) {
  const a = accounts.find((x) => x.name === "Personal Visa");
  const cycle = (await conn.query(
    `SELECT apr, minimum_payment_cents FROM account_statement_cycles WHERE bank_account_id = $1 AND org_id = $2`,
    [a.id, ORG])).rows[0];
  const tx = (await conn.query(
    `SELECT posted_on::text AS day, SUM(amount_cents)::bigint AS net
       FROM bank_transactions
      WHERE bank_account_id = $1 AND org_id = $2 AND is_pending = false AND NOT (raw ? 'fundhub_removed_at')
      GROUP BY 1 ORDER BY 1 DESC`, [a.id, ORG])).rows;
  /* Highest balance owed on any day in the history: walk back from today.
     Repo sign — a purchase is negative — so owed the day before = owed − (−net). */
  let owed = Number(a.current_balance_cents);
  let high = owed;
  for (const r of tx) { owed += Number(r.net); high = Math.max(high, owed); }
  return {
    accountId: a.id,
    mask: a.mask,
    balanceCents: Number(a.current_balance_cents),
    limitCents: Number(a.credit_limit_cents),
    aprPct: Math.round(Number(cycle.apr) * 10000) / 100,
    minimumPaymentCents: Number(cycle.minimum_payment_cents),
    highBalanceCents: high,
    lastActivityOn: tx[0]?.day ?? null
  };
}

/* ------------------------------------------------------------------ *
 * The consistency table — read-only, the API's own functions
 * ------------------------------------------------------------------ */

async function consistency(raw, { now }) {
  const conn = isolated(raw);
  const today = now.toISOString().slice(0, 10);
  const plus = (n) => new Date(Date.parse(`${today}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const ov = await moneyOverview(conn, { orgId: ORG, clientId: CLIENT, env, asOf: now });
  const trend = await planBackfill(conn, { orgId: ORG, clientId: CLIENT, today, days: BACKFILL_DAYS });
  const credit = await creditOverview(conn, { orgId: ORG, clientId: CLIENT, asOf: now });
  const pins = await allPins(conn, { orgId: ORG, clientId: CLIENT, from: today, to: plus(45), env, now, today, log: () => {} });
  const built = await strategyInputs(conn, { orgId: ORG, clientId: CLIENT, env, asOf: now });
  const plan = built ? buildPlan(built.inputs, { method: "avalanche", monthly_cents: STRATEGY_MONTHLY_CENTS }) : null;
  return { ov, trend, credit, pins, built, plan };
}

function printConsistency({ ov, trend, credit, pins, built, plan }) {
  say("");
  say("CONSISTENCY — read-only, the API's own functions");
  say(`  Overview cash   personal ${usd(ov.cash.personal?.cents)} · business ${usd(ov.cash.business?.cents)} · not sorted ${usd(ov.cash.unknown?.cents)}`);
  say(`  Overview debt   ${usd(ov.debt.total_cents)} (personal ${usd(ov.debt.by_kind.personal)}, business ${usd(ov.debt.by_kind.business)})`);
  for (const c of ov.debt.cards) {
    say(`    card  ${c.name} ••${c.mask}  owed ${usd(c.balance_cents)} of ${usd(c.limit_cents)} (${c.used_pct ?? "—"}%)  due ${c.due_on ?? "—"}  min ${usd(c.min_due_cents)}`);
  }
  for (const l of ov.debt.loans) say(`    loan  ${l.name}  owed ${usd(l.balance_cents)}  due ${l.due_on ?? "—"}  payment ${usd(l.payment_cents)}`);
  say(`  Overview bills  ${ov.bills.map((b) => `${b.name} ${usd(b.amount_cents)} ${b.cadence}`).join(" · ") || "none"}`);
  say(`  Upcoming 30d    ${ov.upcoming.map((u) => `${u.on} ${u.type} ${u.name} ${usd(u.amount_cents)}`).join(" · ") || "none"}`);
  say(`  Tip             ${ov.tip ?? "—"}`);
  for (const a of trend.accounts) {
    const pts = a.points;
    const low = pts.reduce((m, p) => Math.min(m, p.cents), Infinity);
    say(`  Trend rebuild   ${a.name} (${a.kind}): ${pts.length} days ${pts[0]?.day ?? "—"} ${usd(pts[0]?.cents)} → ${pts.at(-1)?.day ?? "—"} ${usd(pts.at(-1)?.cents)} · lowest ${usd(Number.isFinite(low) ? low : null)} · today ${usd(a.current)}`);
  }
  say(`  Credit          scores EX ${credit.personal.experian.score ?? "—"} · EQ ${credit.personal.equifax.score ?? "—"} · TU ${credit.personal.transunion.score ?? "—"} (sample ${credit.sample})`);
  say(`                  card use ${credit.utilization.percent ?? "—"}% (${credit.utilization.source ?? "—"}) · open ${credit.accounts.open ?? "—"} · inquiries ${credit.inquiries.total ?? "—"} · negatives ${credit.negative_items.count ?? "—"} · lates ${credit.late_payments.count ?? "—"}`);
  say(`                  UnderwriteIQ: ${credit.suggestions.map((s) => s.text).join(" | ") || "—"}`);
  say(`  Plan pins       ${pins.pins.map((p) => `${p.date} ${p.kind} ${p.title}${p.amount_cents !== null ? ` ${usd(p.amount_cents)}` : ""}`).join(" · ") || "none"}`);
  say(`                  sources ${pins.sources.map((s) => `${s.name}:${s.ok ? s.count : s.error}`).join(" ")}`);
  if (built) {
    for (const d of built.inputs.debts) {
      say(`  Strategy debt   ${d.name} (${d.kind}) ${usd(d.balance_cents)} @ ${d.apr_pct ?? "—"}% (${d.apr_source ?? "no APR"}) min ${usd(d.min_cents)} due ${d.due_on ?? "—"}`);
    }
    for (const [k, v] of Object.entries(built.inputs.cash.by_kind || {})) {
      say(`  Strategy cash   ${k}: ${v.ok ? `opening ${usd(v.opening_cents)} · safe this month ${usd(v.safe_cents)}` : `${v.code} — ${v.message}`}`);
    }
  }
  if (plan) {
    if (!plan.ok) {
      say(`  Strategy $${STRATEGY_MONTHLY_CENTS / 100}/mo  ${JSON.stringify(plan.reason)}`);
    } else {
      say(`  Strategy $${STRATEGY_MONTHLY_CENTS / 100}/mo  minimums ${usd(plan.minimums_cents)} · order ${plan.order.map((o) => plan.debts.find((d) => d.id === o.id)?.name ?? o.id).join(" → ")} · debt-free ${plan.debt_free?.on ?? "never"} · interest ${usd(plan.interest_cents)} (known ${usd(plan.interest_known_cents)}) · saved vs minimums ${usd(plan.interest_saved_cents)} (${plan.interest_saved_reason?.code ?? "ok"})`);
      const c = plan.cash;
      if (c) say(`                  cash check ${c.status}: ${c.by_kind.map((r) => `${r.kind} pays ${usd(r.planned_cents)} of safe ${usd(r.safe_cents)} (${r.status})`).join(" · ")} · most that is safe ${c.max_safe?.unlimited ? "everything" : usd(c.max_safe?.monthly_cents)}`);
      for (const d of plan.per_debt) {
        const debt = plan.debts.find((x) => x.id === d.id);
        say(`                  ${debt?.name ?? d.id}: paid off ${d.payoff_on ?? "—"} · interest ${usd(d.interest_cents)} · start ${d.start_util_pct ?? "—"}%`);
      }
    }
  }
}

/* ------------------------------------------------------------------ *
 * Main
 * ------------------------------------------------------------------ */

async function main() {
  if ((env.PLAID_ENV || "sandbox") !== "sandbox") throw new Error("PLAID_ENV is not sandbox — this script only links fake banks");
  const now = new Date();
  const { config, facts } = planMixedSandboxUser({ today: now });
  say(`${APPLY ? "APPLY" : "DRY RUN"} — FinanceOS sample client v3 · client ${CLIENT} · ${now.toISOString()}`);

  const state = await readOnly(readState);
  const name = [state.client.first_name, state.client.last_name].filter(Boolean).join(" ");
  say(`client   ${name}`);
  for (const id of [PERSONAL, BUSINESS]) {
    const c = state.containers.find((x) => x.id === id);
    if (!c || c.archived_at) throw new Error(`container ${id} is missing or archived`);
    say(`container ${c.name} (${c.kind}) ${c.id}`);
  }

  say(`\nbank v3 (window ${facts.windowStart} → ${facts.windowEnd}, ${config.override_accounts.reduce((n, a) => n + a.transactions.length, 0)} transactions):`);
  for (const f of facts.accounts) {
    say(`  ${f.name} ••${f.mask}: opening ${usd(f.openingCents)} + activity ${usd(f.activityCents)} = today ${usd(f.currentCents)} · lowest day ${usd(Math.min(f.minEodCents, f.openingCents))}`);
    if (f.type === "credit") {
      say(`    limit ${usd(f.limitCents)} · APR ${f.purchaseApr}% · statement ${f.lastStatement.date} ${usd(f.lastStatement.balanceCents)} (interest ${usd(f.lastStatement.interestCents)}) · minimum ${usd(f.minimumPaymentCents)} · last payment ${f.lastPayment.date} ${usd(f.lastPayment.amountCents)}`);
    }
  }
  say(`\nbank v2 accounts to close: ${state.v2.map((a) => `${a.name} ••${a.mask}${a.closed_at ? " (already closed)" : ""}`).join(", ")}`);
  if (state.v3Items.length > 1) throw new Error(`more than one candidate v3 item (${state.v3Items.map((i) => i.id).join(", ")}) — refusing to guess`);
  say(`v3 item: ${state.v3Items[0] ? `already linked — ${state.v3Items[0].id}` : "not linked yet"}`);
  say(`sample credit file: ${state.sample ? `already stored — crs_results ${state.sample.id}` : "not stored yet"}`);

  if (!APPLY) {
    /* Preview the credit file from v3's own numbers (the apply run reads them
       back from the bank instead). The engine is pure; nothing is written. */
    const f = facts.accounts.find((a) => a.name === "Personal Visa");
    const preview = buildSampleCreditFile({
      pulledAt: now.toISOString(), person: { first: state.client.first_name, last: state.client.last_name },
      visa: { mask: f.mask, balanceCents: f.currentCents, limitCents: f.limitCents, aprPct: f.purchaseApr,
        minimumPaymentCents: f.minimumPaymentCents, highBalanceCents: f.maxEodCents, lastActivityOn: f.lastPostedOn }
    });
    const scored = withEngineResult(preview.payload, { submittedName: name, email: state.client.email });
    say(`credit file preview: ${preview.payload.tradelines.length} accounts · ${preview.payload.inquiries.length} inquiries · card use ${preview.counts.utilizationPct}% · engine tier ${scored.outcomeTier} · funding estimate ${scored.fundingEstimate ?? "none"}`);
    const report = await readOnly((conn) => consistency(conn, { now }));
    say(`\n(today's numbers as stored${state.v3Items[0] ? ", v3 already in place" : ", before v3"} — the dry run changes nothing)`);
    printConsistency(report);
    say("\ndry run: nothing written, no Plaid call. Add --apply to write.");
    return;
  }

  /* 1. Link v3 (or reuse the one already linked). */
  const db = pool();
  let itemId = state.v3Items[0]?.id ?? null;
  if (!itemId) {
    const pt = await sandboxPublicToken({
      institutionId: INSTITUTION.institution_id, products: ["transactions", "liabilities"],
      options: { override_username: "user_custom", override_password: JSON.stringify(config) }
    }, { environment: "sandbox", clientId: env.PLAID_CLIENT_ID, secret: env.PLAID_SECRET, env });
    if (!pt.ok) throw new Error(`Plaid sandbox refused: ${pt.errorCode} ${pt.error}`);
    const r = await completeLink(db, { orgId: ORG, clientId: CLIENT, publicToken: pt.publicToken, institution: INSTITUTION, asOf: now.toISOString(), env });
    if (!r.ok) throw new Error(`link failed: ${r.reason} ${r.error ?? ""}`);
    itemId = r.itemRowId;
    say(`\n1. linked v3 → plaid_items ${itemId} (${r.written} accounts)`);
  } else {
    say(`\n1. v3 already linked → plaid_items ${itemId}`);
  }
  let accounts = await v3Accounts(db, itemId);
  const mismatch = checkBalances(accounts, facts);
  if (mismatch.length) {
    throw new Error(`v3 balances do not match the generator — stopping before v2 is touched:\n  ${mismatch.join("\n  ")}`);
  }
  for (const a of accounts) say(`   ${a.name} ••${a.mask} ${a.id} balance ${usd(Number(a.current_balance_cents))}${a.credit_limit_cents ? ` of ${usd(Number(a.credit_limit_cents))}` : ""} ✓`);

  /* 2. Close v2. */
  const closed = await db.query(
    `UPDATE bank_accounts SET closed_at = now(), updated_at = now()
      WHERE client_id = $1 AND org_id = $2 AND plaid_item_id = $3 AND closed_at IS NULL
      RETURNING id, name`, [CLIENT, ORG, V2_ITEM]);
  say(`2. closed ${closed.rowCount} bank v2 account(s)${closed.rowCount ? `: ${closed.rows.map((r) => `${r.name} ${r.id}`).join(", ")}` : " (already closed)"}`);

  /* 3. Containers. */
  for (const a of accounts) {
    const r = await assignAccount(db, { orgId: ORG, accountId: a.id, containerId: CONTAINER_OF[a.name], clientId: CLIENT, source: "staff_reviewed" });
    if (!r.ok) throw new Error(`assign ${a.name}: ${r.reason}`);
    say(`3. ${a.name} → ${CONTAINER_OF[a.name] === PERSONAL ? "Chris (personal)" : "Fundhub LLC"} (${r.changed ? "moved" : "already there"}, ${r.kind})`);
  }

  /* 4. Charges, deposits and card bills. Plaid builds a new item's history in
     the background; the first sync can come back with nothing. Upserts, so a
     retry never doubles anything. */
  let synced = null;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const s = await syncClientTransactions(db, { orgId: ORG, clientId: CLIENT, env, asOf: new Date().toISOString() });
    if (!s.ok) throw new Error(`transactions sync failed: ${s.reason} ${JSON.stringify((s.items ?? []).map((i) => [i.errorCode, i.error]))}`);
    const mine = s.items.find((i) => i.itemRowId === itemId);
    say(`4. transactions sync try ${attempt}: v3 added ${mine?.added ?? 0}, written ${mine?.written ?? 0} · bills ${JSON.stringify(s.bills ? { bills: s.bills.bills, candidates: s.bills.candidates } : null)}`);
    if (mine && mine.written > 0) { synced = s; break; }
    await sleep(5000);
  }
  if (!synced) throw new Error("v3 transactions never arrived from Plaid");
  const liab = await syncClientLiabilities(db, { orgId: ORG, clientId: CLIENT, env, asOf: new Date().toISOString() });
  const v3liab = liab.items?.find((i) => i.itemRowId === itemId);
  say(`4. liabilities sync: v3 wrote ${v3liab?.written ?? 0} card bill(s)${v3liab?.ok ? "" : ` — ${v3liab?.errorCode} ${v3liab?.error}`}`);

  accounts = await v3Accounts(db, itemId);
  const activity = await checkActivity(db, accounts, facts);
  for (const r of activity) say(`   ${r.ok ? "✓" : "✗"} ${r.name}: ${r.rows} rows ${r.first} → ${r.last}, sum ${usd(r.sum)} (v3 says ${usd(r.want)})`);
  const cycles = await checkCycles(db, accounts, facts);
  for (const c of cycles) {
    say(`   ${c.ok ? "✓" : "✗"} ${c.name}: statement ${c.row?.stmt_on} ${usd(Number(c.row?.stmt))} · min ${usd(Number(c.row?.min))} · APR ${c.row ? Math.round(Number(c.row.apr) * 10000) / 100 : "—"}% · due ${c.row?.due_on} · last paid ${c.row?.last_pay_on} ${usd(Number(c.row?.last_pay))}`);
  }
  if (activity.some((r) => !r.ok) || cycles.some((c) => !c.ok)) {
    throw new Error("stored v3 activity or card bills disagree with v3 — stopping before the credit file");
  }

  /* 5. The sample credit file, from the bank's own Personal Visa. */
  const already = await readOnly((conn) => readState(conn).then((s) => s.sample));
  if (already) {
    say(`5. sample credit file already stored → crs_results ${already.id} (${already.outcome_tier}); left as is`);
  } else {
    const visa = await visaFromBank(db, accounts);
    const pulledAt = new Date().toISOString();
    const built = buildSampleCreditFile({ pulledAt, person: { first: state.client.first_name, last: state.client.last_name }, visa });
    const submittedAddress = [SAMPLE_HOME.line1, SAMPLE_HOME.city, SAMPLE_HOME.state, SAMPLE_HOME.postal_code].join(", ");
    const scored = withEngineResult(built.payload, { submittedName: name, submittedAddress, email: state.client.email });
    const stored = await inTransaction(async (conn) => {
      const crs = (await conn.query(
        `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, provider, provider_result_id)
         VALUES ($1, $2, $3::jsonb, $4, $5, $6) RETURNING *`,
        [ORG, CLIENT, JSON.stringify(scored.payload), scored.outcomeTier, SAMPLE_PROVIDER, sampleProviderResultId()])).rows[0];
      const lines = await ingestCrsResult(conn, crs);
      const positions = await ingestCrsLiabilities(conn, crs);
      await mergeCustomFields(conn, CLIENT, countFields(built.counts));
      return { crs, lines, positions };
    });
    say(`5. stored sample credit file → crs_results ${stored.crs.id} · provider ${SAMPLE_PROVIDER}`);
    say(`   Personal Visa from the bank: ••${visa.mask} ${usd(visa.balanceCents)} of ${usd(visa.limitCents)} @ ${visa.aprPct}% · min ${usd(visa.minimumPaymentCents)} · high ${usd(visa.highBalanceCents)} · last activity ${visa.lastActivityOn}`);
    say(`   engine: tier ${scored.outcomeTier} · funding estimate ${scored.fundingEstimate ?? "none"} · reasons ${JSON.stringify(scored.payload.reason_codes)}`);
    say(`   tradelines ${stored.lines.rows.map((r) => `${r.lender} ${r.id}`).join(", ")}`);
    say(`   card_liabilities ${stored.positions.rows.map((r) => r.id).join(", ")} (skipped ${stored.positions.skipped})`);
    say(`   counts ${JSON.stringify(countFields(built.counts))}`);
  }

  const report = await readOnly((conn) => consistency(conn, { now: new Date() }));
  printConsistency(report);
}

main().then(() => close(), async (e) => { console.error(e?.message || e); await close(); process.exit(1); });
