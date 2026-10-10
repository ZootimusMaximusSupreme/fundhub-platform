// Postgres-backed tests for migration 471 (file_protection_alerts, _settings and the
// promo columns on account_statement_cycles) and the daily pass that uses them.
//
// WHAT ONLY A REAL DATABASE CAN SAY:
//   1. The tables refuse what the rules say they refuse — a text with no message, a
//      promo rate with no end date, a second open cash alert — whoever writes.
//   2. The once-only key is a unique index, not a SELECT-then-INSERT two schedulers
//      can race past.
//   3. A promo typed in and a Plaid cycle read leave each other's columns alone.
//   4. The whole daily pass, through the REAL snapshot reader, planners and store,
//      sends each alert once, re-arms the cash cushion, and writes the CSM task.
//
// sendTemplated is stood in for by a stub that records what would be queued: this file
// proves what the pass DECIDES. It never queues a message and never transmits.
//
// EVERYTHING RUNS IN ONE TRANSACTION THAT IS ROLLED BACK. Nothing this file writes
// survives it, whatever database it is pointed at. Expected failures run inside
// SAVEPOINTs so the transaction stays usable.
//
// Skipped without DATABASE_URL, like every other *.pg.test.mjs (CLAUDE.md §12: a skip
// is not a pass — CI runs this against its throwaway database).

import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { pool, close } from "../../db.mjs";
import { saveStatementCycle } from "../../banking/accounts.mjs";
import { runFileAlerts } from "./run.mjs";
import {
  readSettings, setAlertEnabled, setPromo, setStatementCloseDay, listAlerts, FileAlertInputError
} from "./store.mjs";
import { fileAlertsPayload } from "./read.mjs";
import { alertAudience } from "../../workflows/blueprint-finance-os-alerts.mjs";
import { TEMPLATES, TASK_SOURCE } from "./common.mjs";

const HAVE_DB = !!process.env.DATABASE_URL;
const T = (iso) => new Date(iso);

describe("file-protection alerts (migration 471)", { skip: !HAVE_DB ? "no DATABASE_URL" : false }, () => {
  let c;
  let orgId;
  let seq = 0;

  before(async () => {
    c = await pool().connect();
    await c.query("BEGIN");
    orgId = (await c.query(
      `INSERT INTO orgs (slug, name) VALUES ($1, 'FileAlerts PgTest Org') RETURNING id`,
      [`file-alerts-pg-test-${process.pid}-${Date.now()}`]
    )).rows[0].id;
  });

  after(async () => {
    if (c) {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    await close();
  });

  async function expectRefused(sql, params, code) {
    await c.query("SAVEPOINT refused");
    try {
      await c.query(sql, params);
      assert.fail(`expected ${code}`);
    } catch (e) {
      assert.equal(e.code, code, e.message);
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT refused");
    }
  }

  /* ---- fixtures ---- */
  const client = async (name = "Client") => (await c.query(
    `INSERT INTO clients (org_id, first_name, last_name) VALUES ($1, $2, 'FileAlertsPg') RETURNING id`,
    [orgId, `${name}${++seq}`]
  )).rows[0].id;

  const account = async (clientId, { name, mask, type = "credit", kind = "personal", balance = 0, limit = null, itemId = null, createdAt = null, closed = false } = {}) => {
    const res = await c.query(
      `INSERT INTO bank_accounts
         (org_id, client_id, provider, plaid_item_id, plaid_account_id, name, mask, account_type, account_subtype,
          current_balance_cents, credit_limit_cents, entity_kind, entity_kind_source, closed_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, COALESCE($15::timestamptz, now()))
       RETURNING id`,
      [orgId, clientId, itemId ? "plaid" : "manual", itemId, itemId ? `plaid-${++seq}-${mask}` : null, name, mask, type,
        type === "credit" ? "credit card" : type === "depository" ? "checking" : null,
        balance, limit, kind, kind === "unknown" ? null : "staff_reviewed", closed ? "2026-10-01T00:00:00Z" : null, createdAt]
    );
    return res.rows[0].id;
  };

  const cycle = (clientId, bankAccountId, { close = null, due = null, min = null, source = "provider" } = {}) =>
    c.query(
      `INSERT INTO account_statement_cycles (org_id, client_id, bank_account_id, statement_close_day, payment_due_day, minimum_payment_cents, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orgId, clientId, bankAccountId, close, due, min, source]
    );

  const cycleRow = async (bankAccountId) => (await c.query(
    `SELECT statement_close_day, payment_due_day, minimum_payment_cents, source,
            promo_ends_on::text AS promo_ends_on, promo_apr, promo_source, promo_set_at
       FROM account_statement_cycles WHERE bank_account_id = $1`, [bankAccountId])).rows[0];

  /* The stand-in for sendTemplated: records what would be queued, and dedupes on the
     same key the real one does (template + event id). */
  function sender() {
    const queued = new Map();
    const calls = [];
    return {
      queued, calls,
      send: async (_db, args) => {
        calls.push(args);
        const ref = `workflow:${args.templateKey}:${args.eventId}`;
        if (!queued.has(ref)) queued.set(ref, `00000000-0000-4000-8000-${String(queued.size + 1).padStart(12, "0")}`);
        return { sent: true, messageId: queued.get(ref) };
      }
    };
  }
  const run = (clientId, iso, s, deps = {}) =>
    runFileAlerts(c, { orgId, clientId, now: T(iso), env: {} }, { send: s.send, isOptedOut: async () => false, isBlueprint: async () => false, ...deps });

  const alertRows = async (clientId) => (await c.query(
    `SELECT kind, dedupe_key, delivery, message_id, task_id, threshold, due_on::text AS due_on, cash_kind, cleared_at, bank_account_id, body
       FROM file_protection_alerts WHERE client_id = $1 ORDER BY sent_at, created_at, dedupe_key`, [clientId])).rows;

  /* ---------------------------------------------------------------- */

  test("the tables refuse what the rules say they refuse", async () => {
    const clientId = await client();
    const card = await account(clientId, { name: "Refuse Card", mask: "0001", balance: 100 });
    const ins = (cols, vals) => [
      `INSERT INTO file_protection_alerts (org_id, client_id, ${cols}) VALUES ($1, $2, ${vals.map((_, i) => `$${i + 3}`).join(", ")})`,
      [orgId, clientId, ...vals]
    ];
    const MSG = "11111111-1111-4111-8111-111111111111";

    // a text with no message, and a task-only alert that has one
    await expectRefused(...ins("kind, body, delivery, dedupe_key", ["new_credit", "x", "text", "k1"]), "23514");
    await expectRefused(...ins("kind, body, delivery, message_id, dedupe_key", ["new_credit", "x", "task_only", MSG, "k2"]), "23514");
    // promo: only 60 / 30 / 7, and it needs a date
    await expectRefused(...ins("kind, due_on, threshold, body, delivery, message_id, dedupe_key", ["promo_end", "2026-12-06", 45, "x", "text", MSG, "k3"]), "23514");
    await expectRefused(...ins("kind, threshold, body, delivery, message_id, dedupe_key", ["promo_end", 60, "x", "text", MSG, "k4"]), "23514");
    // payment timing needs the close date
    await expectRefused(...ins("kind, body, delivery, message_id, dedupe_key", ["payment_timing", "x", "text", MSG, "k5"]), "23514");
    // a cash alert names whose cash; nothing else may
    await expectRefused(...ins("kind, body, delivery, message_id, dedupe_key", ["cash_reserve", "x", "text", MSG, "k6"]), "23514");
    await expectRefused(...ins("kind, cash_kind, body, delivery, message_id, dedupe_key", ["new_credit", "personal", "x", "text", MSG, "k7"]), "23514");
    await expectRefused(...ins("kind, cash_kind, body, delivery, message_id, dedupe_key", ["cash_reserve", "total", "x", "text", MSG, "k8"]), "23514");
    // only a cash alert can be cleared
    await expectRefused(...ins("kind, body, delivery, message_id, dedupe_key, cleared_at", ["new_credit", "x", "text", MSG, "k9", "2026-10-09T00:00:00Z"]), "23514");

    // the once-only key
    await c.query(...ins("kind, body, delivery, message_id, dedupe_key", ["new_credit", "x", "text", MSG, "same-key"]));
    await expectRefused(...ins("kind, body, delivery, message_id, dedupe_key", ["new_credit", "y", "text", MSG, "same-key"]), "23505");

    // one open cash alert per kind; a second needs the first cleared
    const cash = (key) => ins("kind, cash_kind, threshold, body, delivery, message_id, dedupe_key", ["cash_reserve", "personal", 6, "x", "text", MSG, key]);
    await c.query(...cash("cash-1"));
    await expectRefused(...cash("cash-2"), "23505");
    await c.query(`UPDATE file_protection_alerts SET cleared_at = now() WHERE client_id = $1 AND dedupe_key = 'cash-1'`, [clientId]);
    await c.query(...cash("cash-2"));

    // the cycle's promo columns live or die together
    await cycle(clientId, card);
    await expectRefused(`UPDATE account_statement_cycles SET promo_ends_on = '2026-12-06' WHERE bank_account_id = $1`, [card], "23514");
    await expectRefused(`UPDATE account_statement_cycles SET promo_apr = 0 WHERE bank_account_id = $1`, [card], "23514");
    await expectRefused(`UPDATE account_statement_cycles SET promo_ends_on = '2026-12-06', promo_source = 'robot', promo_set_at = now() WHERE bank_account_id = $1`, [card], "23514");
    await expectRefused(`UPDATE account_statement_cycles SET promo_ends_on = '2026-12-06', promo_source = 'staff', promo_set_at = now(), promo_apr = 1.5 WHERE bank_account_id = $1`, [card], "23514");
    await c.query(`UPDATE account_statement_cycles SET promo_ends_on = '2026-12-06', promo_source = 'staff', promo_set_at = now(), promo_apr = 0 WHERE bank_account_id = $1`, [card]);

    // settings
    await expectRefused(`INSERT INTO file_protection_settings (org_id, client_id, updated_by_kind) VALUES ($1, $2, 'robot')`, [orgId, clientId], "23514");
  });

  test("settings: alerts are on by default; a switch writes one column and survives a read", async () => {
    const clientId = await client();
    assert.deepEqual(await readSettings(c, { orgId, clientId }),
      { payment_timing: true, promo_end: true, cash_reserve: true, new_credit: true, saved: false, updated_by_kind: null, updated_at: null });
    const after = await setAlertEnabled(c, { orgId, clientId, kind: "promo_end", enabled: false, by: "staff" });
    assert.deepEqual([after.promo_end, after.payment_timing, after.cash_reserve, after.new_credit, after.saved, after.updated_by_kind],
      [false, true, true, true, true, "staff"]);
    const again = await setAlertEnabled(c, { orgId, clientId, kind: "cash_reserve", enabled: false, by: "client" });
    assert.deepEqual([again.promo_end, again.cash_reserve, again.updated_by_kind], [false, false, "client"]);
    const on = await setAlertEnabled(c, { orgId, clientId, kind: "promo_end", enabled: true, by: "client" });
    assert.deepEqual([on.promo_end, on.cash_reserve], [true, false]);
    // another client's settings were never touched
    const other = await client();
    assert.equal((await readSettings(c, { orgId, clientId: other })).saved, false);
  });

  test("a promo and a Plaid cycle read leave each other's columns alone", async () => {
    const clientId = await client();
    const card = await account(clientId, { name: "Cycle Card", mask: "0002", balance: 50000, limit: 500000 });

    // No cycle row yet: the close day makes one, as 'manual'.
    assert.deepEqual(await setStatementCloseDay(c, { orgId, clientId, accountId: card, day: 15 }), { statement_close_day: 15 });
    assert.equal((await cycleRow(card)).source, "manual");

    const promo = await setPromo(c, { orgId, clientId, accountId: card, endsOn: "2026-12-06", aprFraction: 0, by: "staff" });
    assert.equal(promo.promo.ends_on, "2026-12-06");
    assert.equal(promo.promo.source, "staff");
    assert.equal((await cycleRow(card)).statement_close_day, 15, "the promo write left the close day alone");

    // The daily Plaid liabilities read: saveStatementCycle replaces the columns IT names.
    await saveStatementCycle(c, {
      statement_close_day: 20, payment_due_day: 5, minimum_payment_cents: 5000,
      last_statement_balance_cents: 50000, source: "provider", raw: { plaid: true }
    }, { orgId, clientId, bankAccountId: card });
    const afterPlaid = await cycleRow(card);
    assert.equal(afterPlaid.promo_ends_on, "2026-12-06", "Plaid's read did not wipe the promo");
    assert.equal(Number(afterPlaid.promo_apr), 0);
    assert.equal(afterPlaid.promo_source, "staff");
    assert.deepEqual([afterPlaid.statement_close_day, afterPlaid.payment_due_day, afterPlaid.source], [20, 5, "provider"]);

    // And the other way: correcting the promo leaves what Plaid wrote.
    await setPromo(c, { orgId, clientId, accountId: card, endsOn: "2026-12-20", aprFraction: 0.0299, by: "client" });
    const corrected = await cycleRow(card);
    assert.deepEqual([corrected.promo_ends_on, Number(corrected.promo_apr), corrected.promo_source], ["2026-12-20", 0.0299, "client"]);
    assert.deepEqual([corrected.payment_due_day, Number(corrected.minimum_payment_cents), corrected.source], [5, 5000, "provider"]);

    // Clearing blanks the four promo columns and nothing else.
    assert.deepEqual(await setPromo(c, { orgId, clientId, accountId: card, endsOn: null, by: "client" }), { cleared: true, promo: null });
    const cleared = await cycleRow(card);
    assert.deepEqual([cleared.promo_ends_on, cleared.promo_apr, cleared.promo_source, cleared.promo_set_at], [null, null, null, null]);
    assert.equal(cleared.payment_due_day, 5);
  });

  test("a promo is only for the client's own open credit card", async () => {
    const mine = await client("Mine");
    const theirs = await client("Theirs");
    const theirCard = await account(theirs, { name: "Their Card", mask: "0003" });
    const checking = await account(mine, { name: "Checking", mask: "0004", type: "depository" });
    const closedCard = await account(mine, { name: "Old Card", mask: "0005", closed: true });
    const refuse = (accountId, status, field = "account_id") => assert.rejects(
      setPromo(c, { orgId, clientId: mine, accountId, endsOn: "2026-12-06", aprFraction: null, by: "client" }),
      (e) => e instanceof FileAlertInputError && e.status === status && e.field === field
    );
    await refuse(theirCard, 404);
    await refuse(checking, 400);
    await refuse(closedCard, 400);
    await refuse("33333333-3333-4333-8333-333333333333", 404);
    await assert.rejects(setStatementCloseDay(c, { orgId, clientId: mine, accountId: theirCard, day: 10 }), (e) => e.status === 404);
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM account_statement_cycles WHERE bank_account_id = ANY($1::uuid[])`, [[theirCard, checking, closedCard]])).rows[0].n, 0);
  });

  /* ---------------------------------------------------------------- */

  test("pay before close: once across the window, then once for the next cycle — the unique key, not a lookup, holds it", async () => {
    const clientId = await client();
    const card = await account(clientId, { name: "Business Amex", mask: "4404", kind: "business", balance: 540000, limit: 2500000 });
    await cycle(clientId, card, { close: 15, due: 15, min: 27000 });
    const s = sender();

    for (const d of ["12", "13", "14", "15"]) await run(clientId, `2026-10-${d}T07:30:00.000Z`, s);
    assert.equal(s.calls.length, 1, "later passes in the window do not send again");
    let rows = await alertRows(clientId);
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].kind, rows[0].dedupe_key, rows[0].threshold, rows[0].due_on, rows[0].delivery, rows[0].bank_account_id],
      ["payment_timing", `fpa:pay:${card}:2026-10-15`, 3, "2026-10-15", "text", card]);
    assert.match(rows[0].body, /^Fundhub reminder: pay your Business Amex ending 4404 down before Oct 15\./);
    assert.ok(rows[0].message_id);

    await run(clientId, "2026-11-12T07:30:00.000Z", s);
    rows = await alertRows(clientId);
    assert.deepEqual(rows.map((r) => r.due_on), ["2026-10-15", "2026-11-15"]);
    assert.equal(s.calls.length, 2);

    // Even if the pass forgets what it sent (a second scheduler that read before the first wrote), the table refuses the repeat.
    const blind = sender();
    const before = (await alertRows(clientId)).length;
    await runFileAlerts(c, { orgId, clientId, now: T("2026-11-13T07:30:00.000Z"), env: {} }, {
      send: blind.send, isOptedOut: async () => false, isBlueprint: async () => false,
      store: { ...(await import("./store.mjs")), recentKeys: async () => new Set() }
    });
    assert.equal((await alertRows(clientId)).length, before, "the unique index kept it to one row");
  });

  test("promo end: 60, 30 and 7 days, each once, from a promo typed in through the real writer", async () => {
    const clientId = await client();
    const card = await account(clientId, { name: "Promo Card", mask: "0007", balance: 540000, limit: 2500000 });
    await setPromo(c, { orgId, clientId, accountId: card, endsOn: "2026-12-06", aprFraction: 0, by: "staff" });
    const s = sender();
    for (let day = 0; day <= 62; day++) {
      await run(clientId, new Date(Date.UTC(2026, 9, 7 + day, 7, 30)).toISOString(), s);
    }
    const rows = (await alertRows(clientId)).filter((r) => r.kind === "promo_end");
    assert.deepEqual(rows.map((r) => r.threshold), [60, 30, 7]);
    assert.ok(rows.every((r) => r.due_on === "2026-12-06"));
    assert.equal(s.queued.size, 3);
    assert.match(rows[0].body, /ends Dec 6 \(in 60 days\)\. You still owe \$5,400\.00\. Pay about \$2,700 a month for the next 2 months/);
  });

  test("cash cushion: a drop alerts once, recovery re-arms through cleared_at, the next drop is a second row", async () => {
    const clientId = await client();
    await account(clientId, { name: "Personal Checking", mask: "1101", type: "depository", kind: "personal", balance: 421055 });
    const visa = await account(clientId, { name: "Personal Visa", mask: "3303", kind: "personal", balance: 132040, limit: 800000 });
    await cycle(clientId, visa, { min: 6602 });
    // A Fundhub payment plan: $650.00 the next payment is due.
    const planId = (await c.query(
      `INSERT INTO clarity_payments (org_id, client_id, kind, original_cents) VALUES ($1, $2, 'clarity', 150000) RETURNING id`, [orgId, clientId]
    )).rows[0].id;
    await c.query(
      `INSERT INTO clarity_payment_installments (org_id, clarity_payment_id, seq, due_on, amount_cents)
       VALUES ($1, $2, 1, '2026-10-03', 65000), ($1, $2, 2, '2026-11-03', 85000)`, [orgId, planId]);
    const s = sender();
    const checking = (await c.query(`SELECT id FROM bank_accounts WHERE client_id = $1 AND account_type = 'depository'`, [clientId])).rows[0].id;
    const setCash = (cents) => c.query(`UPDATE bank_accounts SET current_balance_cents = $2 WHERE id = $1`, [checking, cents]);

    await run(clientId, "2026-10-08T07:30:00.000Z", s);
    let rows = (await alertRows(clientId)).filter((r) => r.kind === "cash_reserve");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cash_kind, "personal");
    assert.equal(rows[0].dedupe_key, `fpa:cash:${clientId}:personal:1`);
    assert.equal(rows[0].cleared_at, null);
    assert.match(rows[0].body, /^Fundhub alert: your personal cash is \$4,210\.55\. 6 months of your personal minimum payments is \$4,296\.12\./);

    await run(clientId, "2026-10-09T07:30:00.000Z", s);
    assert.equal((await alertRows(clientId)).filter((r) => r.kind === "cash_reserve").length, 1, "still below: no second alert");

    await setCash(500000);
    const rearm = await run(clientId, "2026-10-10T07:30:00.000Z", s);
    assert.deepEqual(rearm.rearmed, ["personal"]);
    rows = (await alertRows(clientId)).filter((r) => r.kind === "cash_reserve");
    assert.ok(rows[0].cleared_at, "recovery sets cleared_at");

    await setCash(90000);
    await run(clientId, "2026-10-11T07:30:00.000Z", s);
    rows = (await alertRows(clientId)).filter((r) => r.kind === "cash_reserve");
    assert.deepEqual(rows.map((r) => r.dedupe_key), [`fpa:cash:${clientId}:personal:1`, `fpa:cash:${clientId}:personal:2`]);
    assert.equal(rows[1].cleared_at, null);
  });

  test("new credit: a new account on a linked login — the text, the CSM task for a Blueprint file, once", async () => {
    const clientId = await client();
    const item = (await c.query(
      `INSERT INTO plaid_items (org_id, client_id, plaid_item_id, institution_name, link_state, consent_granted_at, created_at)
       VALUES ($1, $2, $3, 'First Platypus Bank', 'active', now(), '2026-10-01T10:00:00Z') RETURNING id`,
      [orgId, clientId, `item-${Date.now()}-${++seq}`]
    )).rows[0].id;
    // The first read of the login (baseline) and a card that appeared later.
    await account(clientId, { name: "Baseline Visa", mask: "3303", itemId: item, createdAt: "2026-10-01T10:00:30Z" });
    const fresh = await account(clientId, { name: "Chase Freedom", mask: "4321", itemId: item, createdAt: "2026-10-11T09:00:00Z" });
    const csm = (await c.query(
      `INSERT INTO staff (org_id, name, email, role) VALUES ($1, 'Csm Person', $2, 'csm') RETURNING id`,
      [orgId, `csm-${process.pid}-${Date.now()}@example.com`]
    )).rows[0].id;
    await c.query(`UPDATE clients SET assigned_csm_staff_id = $2 WHERE id = $1`, [clientId, csm]);

    const s = sender();
    const r = await run(clientId, "2026-10-12T07:30:00.000Z", s, { isBlueprint: async () => true });
    const nc = r.sent.filter((x) => x.kind === "new_credit");
    assert.equal(nc.length, 1);
    assert.equal(nc[0].key, `fpa:new:acct:${fresh}`);

    const tasks = (await c.query(
      `SELECT title, source_workflow, assignee_role, assignee_staff_id, body, client_id FROM tasks WHERE client_id = $1`, [clientId])).rows;
    assert.equal(tasks.length, 1);
    assert.deepEqual([tasks[0].source_workflow, tasks[0].assignee_role, tasks[0].assignee_staff_id], [TASK_SOURCE, "csm", csm]);
    assert.ok(tasks[0].body.startsWith(`fpa:new:acct:${fresh}\n`));
    const row = (await alertRows(clientId)).find((x) => x.kind === "new_credit");
    assert.ok(row.task_id && row.message_id);
    assert.equal(row.bank_account_id, fresh);

    await run(clientId, "2026-10-13T07:30:00.000Z", s, { isBlueprint: async () => true });
    assert.equal((await c.query(`SELECT count(*)::int AS n FROM tasks WHERE client_id = $1`, [clientId])).rows[0].n, 1);
    assert.equal((await alertRows(clientId)).filter((x) => x.kind === "new_credit").length, 1);
  });

  test("new credit: an opted-out Blueprint buyer is not texted but still gets a task_only alert", async () => {
    const clientId = await client();
    const item = (await c.query(
      `INSERT INTO plaid_items (org_id, client_id, plaid_item_id, institution_name, link_state, consent_granted_at, created_at)
       VALUES ($1, $2, $3, 'First Platypus Bank', 'active', now(), '2026-10-01T10:00:00Z') RETURNING id`,
      [orgId, clientId, `item-${Date.now()}-${++seq}`]
    )).rows[0].id;
    await account(clientId, { name: "New Card", mask: "7777", itemId: item, createdAt: "2026-10-11T09:00:00Z" });
    const s = sender();
    await run(clientId, "2026-10-12T07:30:00.000Z", s, { isOptedOut: async () => true, isBlueprint: async () => true });
    assert.equal(s.calls.length, 0, "an opted-out client is never texted");
    const row = (await alertRows(clientId)).find((x) => x.kind === "new_credit");
    assert.equal(row.delivery, "task_only");
    assert.equal(row.message_id, null);
    assert.ok(row.task_id);
  });

  test("new credit: a new inquiry between two stored credit pulls, once — the real crs_results reader", async () => {
    const clientId = await client();
    const tl = { accountType: "Revolving", creditorName: "Credit One Bank", accountIdentifier: "SIM-CRED1-3018", accountOpenedDate: "2022-09-14" };
    const pull = (createdAt, inquiries) => c.query(
      `INSERT INTO crs_results (org_id, client_id, result, outcome_tier, created_at, updated_at) VALUES ($1, $2, $3::jsonb, 'repair', $4, $4)`,
      [orgId, clientId, JSON.stringify({ tradelines: [tl], inquiries }), createdAt]
    );
    await pull("2026-09-10T08:00:00Z", []);
    await pull("2026-10-11T08:00:00Z", [{ creditorName: "American Express", date: "2026-10-03", source: "EX" }]);
    const s = sender();
    const r = await run(clientId, "2026-10-12T07:30:00.000Z", s);
    const nc = r.sent.filter((x) => x.kind === "new_credit");
    assert.equal(nc.length, 1);
    assert.match(nc[0].body, /your latest credit pull shows 1 new inquiry \(American Express, Oct 3\)/);
    await run(clientId, "2026-10-13T07:30:00.000Z", s);
    assert.equal((await alertRows(clientId)).filter((x) => x.kind === "new_credit").length, 1);
    assert.equal(s.queued.size, 1);

    // A demo pull never counts.
    const demoClient = await client();
    for (const at of ["2026-09-10T08:00:00Z", "2026-10-11T08:00:00Z"]) {
      await c.query(`INSERT INTO crs_results (org_id, client_id, result, outcome_tier, created_at, is_demo) VALUES ($1, $2, $3::jsonb, 'repair', $4, true)`,
        [orgId, demoClient, JSON.stringify({ tradelines: [tl], inquiries: [{ creditorName: "Demo", date: "2026-10-03" }] }), at]);
    }
    const none = await run(demoClient, "2026-10-12T07:30:00.000Z", sender());
    assert.equal(none.sent.length, 0);
  });

  test("a kind switched off, through the real settings table, sends nothing", async () => {
    const clientId = await client();
    const card = await account(clientId, { name: "Off Card", mask: "0009", balance: 100000, limit: 1000000 });
    await cycle(clientId, card, { close: 15 });
    await setAlertEnabled(c, { orgId, clientId, kind: "payment_timing", enabled: false, by: "client" });
    const s = sender();
    await run(clientId, "2026-10-12T07:30:00.000Z", s);
    assert.equal(s.calls.length, 0);
    await setAlertEnabled(c, { orgId, clientId, kind: "payment_timing", enabled: true, by: "client" });
    await run(clientId, "2026-10-12T07:30:00.000Z", s);
    assert.equal(s.calls.length, 1);
  });

  /* ---------------------------------------------------------------- */

  test("the screen's read: settings, cards with their next close and promo, both cash verdicts, and what went out", async () => {
    const clientId = await client("Screen");
    await account(clientId, { name: "Personal Checking", mask: "1101", type: "depository", kind: "personal", balance: 421055 });
    await account(clientId, { name: "Business Checking", mask: "2202", type: "depository", kind: "business", balance: 1875000 });
    const amex = await account(clientId, { name: "Business Amex", mask: "4404", kind: "business", balance: 540000, limit: 2500000 });
    await cycle(clientId, amex, { close: 15, due: 15, min: 27000 });
    await setPromo(c, { orgId, clientId, accountId: amex, endsOn: "2026-12-06", aprFraction: 0, by: "client" });
    const s = sender();
    await run(clientId, "2026-10-12T07:30:00.000Z", s);

    const p = await fileAlertsPayload(c, { orgId, clientId, now: T("2026-10-12T12:00:00.000Z"), env: {} });
    assert.equal(p.ok, true);
    assert.equal(p.client.id, clientId);
    assert.deepEqual(Object.keys(p.settings.kinds), ["payment_timing", "promo_end", "cash_reserve", "new_credit"]);
    assert.equal(p.settings.pay_before_close_days, 3);
    assert.deepEqual(p.settings.promo_thresholds_days, [60, 30, 7]);
    const card = p.cards.find((x) => x.account_id === amex);
    assert.equal(card.statement_close_day, 15);
    assert.deepEqual([card.pay_before.next_close_on, card.pay_before.days_to_close, card.pay_before.text_on, card.pay_before.texted],
      ["2026-10-15", 3, "2026-10-12", true]);
    assert.equal(card.promo.ends_on, "2026-12-06");
    assert.equal(card.promo.days_left, 55);
    assert.equal(card.promo.apr_pct, 0);
    assert.deepEqual(card.promo.next_alert, { threshold: 30, on: "2026-11-06" });
    assert.equal(card.promo.payoff.payments, 2);
    assert.equal(p.reserve.personal.state, "unknown", "no personal minimums on file");
    assert.equal(p.reserve.business.state, "ok");
    assert.equal(p.reserve.business.cash_cents, 1875000);
    assert.equal(p.reserve.months, 6);
    assert.equal(p.alerts.length, 1);
    assert.equal(p.alerts[0].kind, "payment_timing");
    assert.equal(p.alerts[0].due_on, "2026-10-15");
    assert.equal((await listAlerts(c, { orgId, clientId })).length, 1);

    assert.equal(await fileAlertsPayload(c, { orgId, clientId: "44444444-4444-4444-8444-444444444444", now: T("2026-10-12T12:00:00.000Z") }), null);
  });

  test("the audience: a Blueprint buyer and a Finance OS subscriber, each found once", async () => {
    const buyer = await client("Buyer");
    const subscriber = await client("Subscriber");
    const both = await client("Both");
    const nobody = await client("Nobody");
    await c.query(`INSERT INTO products (org_id, code, name) VALUES ($1, 'consulting-package', 'Consulting Services Package')`, [orgId]);
    const pay = (clientId) => c.query(
      `INSERT INTO transactions (org_id, client_id, product_name, amount_paid, status, provider, provider_ref, raw_payload)
       VALUES ($1, $2, 'Consulting Services Package', 5000.00, 'succeeded', 'commas', $3, '{}'::jsonb)`,
      [orgId, clientId, `file-alerts-pg-${clientId}`]);
    const subscribe = (clientId) => c.query(
      `INSERT INTO subscriptions (org_id, client_id, tier, status, effective_from) VALUES ($1, $2, 'finance-os', 'active', '2026-01-01T00:00:00Z')`,
      [orgId, clientId]);
    await pay(buyer);
    await subscribe(subscriber);
    await pay(both);
    await subscribe(both);

    const rows = await alertAudience(c, T("2026-10-12T07:30:00.000Z"));
    const mine = rows.filter((r) => r.org_id === orgId).map((r) => r.client_id).sort();
    assert.deepEqual(mine, [buyer, subscriber, both].sort());
    assert.equal(mine.includes(nobody), false);
  });
});
