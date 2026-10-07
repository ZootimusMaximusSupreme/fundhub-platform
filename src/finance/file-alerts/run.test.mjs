// The daily pass for one client, end to end through the REAL snapshot reader and the
// REAL planners, with an in-memory store and a stub in place of sendTemplated. Nothing
// is queued for real, nothing transmits, no database is touched.
import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { runFileAlerts } from "./run.mjs";
import { loadSnapshot, loadLatestPulls, clarityMonthly, staleCashKinds } from "./snapshot.mjs";
import { TEMPLATES, TASK_SOURCE } from "./common.mjs";
import { ACCOUNT_SQL } from "../money-overview.mjs";
import { createMemoryStore } from "./memory-store.mjs";

const ORG = "org-1";
const CLIENT = "client-1";
const T = (iso) => new Date(iso);

/* ------------------------------------------------------------------ *
 * The world: rows a stub connection answers with, and the stand-ins for
 * everything that would leave the building.
 * ------------------------------------------------------------------ */

const acct = (over) => ({
  id: "x", name: "x", official_name: null, mask: null, provider: "plaid",
  account_type: "credit", account_subtype: "credit card",
  available_balance_cents: null, current_balance_cents: 0, credit_limit_cents: null,
  entity_kind: "personal", entity_kind_source: "staff_reviewed", entity_kind_set_at: null, entity_id: null,
  closed_at: null, institution_name: "First Platypus Bank (Plaid sandbox — test data)", ...over
});

function baseAccounts() {
  return [
    acct({ id: "amex", name: "Business Amex", mask: "4404", entity_kind: "business", current_balance_cents: 540000, credit_limit_cents: 2500000 }),
    acct({ id: "visa", name: "Personal Visa", mask: "3303", entity_kind: "personal", current_balance_cents: 132040, credit_limit_cents: 800000 }),
    acct({ id: "pchk", name: "Personal Checking", mask: "1101", entity_kind: "personal", account_type: "depository", account_subtype: "checking", current_balance_cents: 421055 }),
    acct({ id: "bchk", name: "Business Checking", mask: "2202", entity_kind: "business", account_type: "depository", account_subtype: "checking", current_balance_cents: 1875000 })
  ];
}

const meta = (rows, { itemAt = "2026-09-01T10:00:00.000Z", createdAt = "2026-09-01T10:00:20.000Z" } = {}) =>
  rows.map((a) => ({
    id: a.id, account_type: a.account_type, plaid_item_id: "item-1", mask: a.mask, name: a.name, closed_at: a.closed_at,
    created_at: createdAt, balance_as_of: "2026-10-06T22:57:00.000Z", item_created_at: itemAt
  }));

function world({ accounts = baseAccounts(), cycles, clarity = [], settings = {}, blueprint = false, optedOut = false, templatesReady = true, pulls = null } = {}) {
  const w = {
    accounts, clarity, blueprint, optedOut, templatesReady, pulls,
    cycles: cycles ?? [
      { bank_account_id: "amex", statement_close_day: 15, payment_due_day: 15, minimum_payment_cents: 27000, source: "provider", raw: {} },
      { bank_account_id: "visa", statement_close_day: 25, payment_due_day: 25, minimum_payment_cents: 6602, source: "provider", raw: {} }
    ],
    meta: null,
    sends: [], tasks: [], sentMessages: new Map(), taskKeys: new Map()
  };
  /* The same in-memory store the dry-run script uses: one row per dedupe key, one open
     cash alert per cash kind. Its settings and alerts are the world's. */
  w.mem = createMemoryStore({ settings, csm: "staff-csm-1" });
  w.store = w.mem;
  w.settings = w.mem.state.settings;
  Object.defineProperty(w, "alerts", { get: () => w.mem.alerts });

  w.conn = {
    async query(sql, params) {
      const s = String(sql);
      if (/FROM clients WHERE id = \$1 AND org_id = \$2/.test(s)) {
        assert.deepEqual(params, [CLIENT, ORG]);
        return { rows: [{ id: CLIENT, first_name: "Test", last_name: "Client" }] };
      }
      if (/item_created_at/.test(s)) { assert.deepEqual(params, [CLIENT, ORG]); return { rows: w.meta ?? meta(w.accounts) }; }
      if (s === ACCOUNT_SQL) { assert.deepEqual(params, [CLIENT, ORG]); return { rows: w.accounts }; }
      if (/FROM entities/.test(s)) return { rows: [] };
      if (/FROM account_statement_cycles s/.test(s)) { assert.deepEqual(params, [CLIENT, ORG]); return { rows: w.cycles.map((row) => ({ row })) }; }
      if (/FROM card_liabilities l/.test(s)) return { rows: [] };
      if (/FROM clarity_payments p/.test(s)) { assert.deepEqual(params, [ORG, CLIENT]); return { rows: w.clarity }; }
      throw new Error(`unexpected sql in the world: ${s.slice(0, 120)}`);
    }
  };

  /* sendTemplated's contract, reduced: a missing template is { sent:false }, and the
     provider_ref (template + event id) is what dedupes a replay onto one message. */
  w.send = async (_c, args) => {
    w.sends.push(args);
    if (!w.templatesReady) return { sent: false, reason: "template_pending" };
    const ref = `workflow:${args.templateKey}:${args.eventId}`;
    if (!w.sentMessages.has(ref)) w.sentMessages.set(ref, `msg-${w.sentMessages.size + 1}`);
    return { sent: true, messageId: w.sentMessages.get(ref) };
  };
  w.createTask = async (_c, t) => {
    const dedupe = `${t.sourceWorkflow}|${t.body}`;
    if (w.taskKeys.has(dedupe)) return { created: false, id: w.taskKeys.get(dedupe), reason: "duplicate_event" };
    const id = `task-${w.taskKeys.size + 1}`;
    w.taskKeys.set(dedupe, id);
    w.tasks.push({ ...t, id });
    return { created: true, id };
  };

  w.deps = () => ({
    send: w.send, createTask: w.createTask, store: w.store,
    isOptedOut: async () => w.optedOut,
    isBlueprint: async () => w.blueprint,
    loadLatestPulls: async () => w.pulls
  });
  w.run = (iso, env = {}) => runFileAlerts(w.conn, { orgId: ORG, clientId: CLIENT, now: T(iso), env }, w.deps());
  return w;
}

const keysOf = (r) => r.sent.map((s) => s.key);

/* ------------------------------------------------------------------ *
 * 1. pay before the statement closes
 * ------------------------------------------------------------------ */

describe("payment timing — one text per card per cycle, through the templated path only", () => {
  test("three days before the close the card is texted; the card that closes later is not", async () => {
    const w = world();
    const r = await w.run("2026-10-12T07:30:00.000Z");
    assert.deepEqual(keysOf(r), ["fpa:pay:amex:2026-10-15"]);
    assert.equal(w.sends.length, 1);
    const s = w.sends[0];
    assert.equal(s.templateKey, TEMPLATES.payment_timing);
    assert.equal(s.channel, "sms");
    assert.equal(s.orgId, ORG);
    assert.equal(s.clientId, CLIENT);
    assert.equal(s.eventId, "fpa:pay:amex:2026-10-15");
    assert.equal(s.context.alert.card, "Business Amex ending 4404");
    assert.equal(s.context.alert.when, "before Oct 15");
    assert.equal(r.sent[0].delivery, "text");
    assert.match(r.sent[0].body, /^Fundhub reminder: pay your Business Amex ending 4404 down before Oct 15\./);
  });

  test("the alert row is written with the message id, the threshold and the numbers it was built from", async () => {
    const w = world();
    await w.run("2026-10-12T07:30:00.000Z");
    assert.equal(w.alerts.length, 1);
    const a = w.alerts[0];
    assert.deepEqual(
      [a.kind, a.bankAccountId, a.threshold, a.dueOn, a.delivery, a.messageId],
      ["payment_timing", "amex", 3, "2026-10-15", "text", "msg-1"]
    );
    assert.equal(a.sentAt, "2026-10-12T07:30:00.000Z");
    assert.equal(a.detail.balance_cents, 540000);
    assert.equal(a.detail.pay_to_target_cents, 290000);
  });

  test("daily passes through the whole window send it ONCE", async () => {
    const w = world();
    for (const d of ["12", "13", "14", "15"]) await w.run(`2026-10-${d}T07:30:00.000Z`);
    assert.equal(w.sends.length, 1, "later passes do not even call send");
    assert.equal(w.alerts.length, 1);
    const again = await w.run("2026-10-14T07:30:00.000Z");
    assert.deepEqual(again.skipped.filter((s) => s.kind === "payment_timing" && s.reason === "already_sent").length, 1);
  });

  test("the other card goes on its own cycle, and the next cycle is a new text", async () => {
    const w = world();
    await w.run("2026-10-12T07:30:00.000Z");
    const visa = await w.run("2026-10-22T07:30:00.000Z");
    assert.deepEqual(keysOf(visa), ["fpa:pay:visa:2026-10-25"]);
    const next = await w.run("2026-11-12T07:30:00.000Z");
    assert.deepEqual(keysOf(next), ["fpa:pay:amex:2026-11-15"]);
    assert.equal(w.alerts.length, 3);
  });

  test("the lead time follows the setting", async () => {
    const w = world();
    const r = await w.run("2026-10-10T07:30:00.000Z", { FILE_ALERT_PAY_BEFORE_CLOSE_DAYS: "5" });
    assert.deepEqual(keysOf(r), ["fpa:pay:amex:2026-10-15"]);
    assert.equal(w.alerts[0].threshold, 5);
  });

  test("a card with no close day on file is skipped with the reason, not guessed at", async () => {
    const w = world({ cycles: [] });
    const r = await w.run("2026-10-12T07:30:00.000Z");
    assert.equal(r.sent.length, 0);
    assert.equal(w.sends.length, 0);
    assert.ok(r.skipped.some((s) => s.kind === "payment_timing" && s.reason === "no_statement_close_day"));
  });
});

/* ------------------------------------------------------------------ *
 * the rules that hold for every alert
 * ------------------------------------------------------------------ */

describe("opt-out, switches and the templated path", () => {
  test("an opted-out client is not texted and nothing is written for the text — and it goes when they opt back in", async () => {
    const w = world({ optedOut: true });
    const r = await w.run("2026-10-12T07:30:00.000Z");
    assert.equal(w.sends.length, 0, "send is never called for an opted-out client");
    assert.equal(w.alerts.length, 0);
    assert.deepEqual(r.held, [{ kind: "payment_timing", key: "fpa:pay:amex:2026-10-15", reason: "opted_out" }]);
    assert.equal(r.optedOut, true);

    w.optedOut = false;
    const back = await w.run("2026-10-13T07:30:00.000Z");
    assert.deepEqual(keysOf(back), ["fpa:pay:amex:2026-10-15"]);
    assert.equal(w.sends.length, 1);
  });

  test("a kind switched off sends nothing and is not even evaluated for sending", async () => {
    const w = world({ settings: { payment_timing: false } });
    const r = await w.run("2026-10-12T07:30:00.000Z");
    assert.equal(w.sends.length, 0);
    assert.equal(r.skipped.some((s) => s.kind === "payment_timing"), false);
    assert.equal(r.settings.payment_timing, false);
  });

  test("a template that is missing or not approved queues nothing and writes no row — the next pass tries again", async () => {
    const w = world({ templatesReady: false });
    const r = await w.run("2026-10-12T07:30:00.000Z");
    assert.equal(w.alerts.length, 0);
    assert.deepEqual(r.notQueued, [{ kind: "payment_timing", key: "fpa:pay:amex:2026-10-15", reason: "template_pending" }]);

    w.templatesReady = true;
    const retry = await w.run("2026-10-13T07:30:00.000Z");
    assert.deepEqual(keysOf(retry), ["fpa:pay:amex:2026-10-15"]);
    assert.equal(w.alerts.length, 1);
  });

  test("two schedulers at once still make one alert and one message", async () => {
    const w = world();
    await Promise.all([w.run("2026-10-12T07:30:00.000Z"), w.run("2026-10-12T07:30:00.000Z")]);
    assert.equal(w.alerts.length, 1, "the once-only key holds");
    assert.equal(w.sentMessages.size, 1, "and the provider_ref dedupes the queued text");
  });

  test("the only way out is the injected send, and it is called with the owner's template keys", async () => {
    const w = world({ clarity: [{ plan_id: "p", left_cents: 65000 }] });
    await w.run("2026-10-12T07:30:00.000Z");
    assert.ok(w.sends.length >= 1);
    for (const s of w.sends) {
      assert.ok(Object.values(TEMPLATES).includes(s.templateKey), s.templateKey);
      assert.equal(s.channel, "sms");
      assert.match(s.eventId, /^fpa:/);
    }
  });

  test("one kind failing does not stop the others, and the failure is reported", async () => {
    const w = world();
    const deps = { ...w.deps(), loadLatestPulls: async () => { throw new Error("crs_results is unreadable"); } };
    const r = await runFileAlerts(w.conn, { orgId: ORG, clientId: CLIENT, now: T("2026-10-12T07:30:00.000Z"), env: {} }, deps);
    assert.deepEqual(keysOf(r), ["fpa:pay:amex:2026-10-15"]);
    assert.deepEqual(r.errors, [{ kind: "new_credit", error: "crs_results is unreadable" }]);
  });

  test("a client who is not in that org is reported, not run", async () => {
    const w = world();
    const deps = { ...w.deps(), loadSnapshot: async () => null };
    const r = await runFileAlerts(w.conn, { orgId: ORG, clientId: CLIENT, now: T("2026-10-12T07:30:00.000Z") }, deps);
    assert.deepEqual([r.ok, r.reason], [false, "client_not_found"]);
  });
});

/* ------------------------------------------------------------------ *
 * 2. promo end
 * ------------------------------------------------------------------ */

describe("promo end — 60, 30 and 7 days, each once", () => {
  const withPromo = (endsOn) => ({
    cycles: [
      { bank_account_id: "amex", statement_close_day: null, payment_due_day: null, minimum_payment_cents: 27000, source: "manual", raw: {},
        promo_ends_on: endsOn, promo_apr: "0.00000", promo_source: "staff", promo_set_at: "2026-10-01T00:00:00.000Z" }
    ]
  });

  test("the three alerts fire on their days, once each, and nowhere else", async () => {
    const w = world(withPromo("2026-12-06"));
    const sentOn = {};
    for (let day = 0; day <= 62; day++) {
      const when = new Date(Date.UTC(2026, 9, 7 + day, 7, 30));
      const r = await w.run(when.toISOString());
      for (const s of r.sent) sentOn[when.toISOString().slice(0, 10)] = s.key;
    }
    assert.deepEqual(sentOn, {
      "2026-10-07": "fpa:promo:amex:2026-12-06:60",
      "2026-11-06": "fpa:promo:amex:2026-12-06:30",
      "2026-11-29": "fpa:promo:amex:2026-12-06:7"
    });
    assert.equal(w.alerts.length, 3);
    assert.equal(w.sentMessages.size, 3);
    assert.deepEqual(w.alerts.map((a) => a.threshold), [60, 30, 7]);
  });

  test("the text carries the balance left and the computed payoff", async () => {
    const w = world(withPromo("2026-12-06"));
    const r = await w.run("2026-10-07T07:30:00.000Z");
    assert.equal(r.sent[0].body,
      "Fundhub reminder: the promo rate on your Business Amex ending 4404 ends Dec 6 (in 60 days). " +
      "You still owe $5,400.00. Pay about $2,700 a month for the next 2 months to clear it in time.");
    assert.equal(w.sends[0].templateKey, TEMPLATES.promo_end);
    assert.equal(w.sends[0].context.alert.date, "Dec 6");
    assert.equal(w.sends[0].context.alert.days, "in 60 days");
  });

  test("a promo typed in late skips the thresholds already past; a corrected date starts over", async () => {
    const w = world(withPromo("2026-12-06"));
    assert.equal((await w.run("2026-10-22T07:30:00.000Z")).sent.length, 0, "45 days left: no 60 alert");
    w.cycles[0].promo_ends_on = "2026-12-20";
    assert.deepEqual(keysOf(await w.run("2026-10-21T07:30:00.000Z")), ["fpa:promo:amex:2026-12-20:60"]);
  });

  test("a card paid to zero has nothing to clear", async () => {
    const w = world(withPromo("2026-12-06"));
    w.accounts[0].current_balance_cents = 0;
    const r = await w.run("2026-10-07T07:30:00.000Z");
    assert.equal(r.sent.length, 0);
    assert.ok(r.skipped.some((s) => s.kind === "promo_end" && s.reason === "nothing_owed"));
  });

  test("switched off: no promo text", async () => {
    const w = world({ ...withPromo("2026-12-06"), settings: { promo_end: false } });
    assert.equal((await w.run("2026-10-07T07:30:00.000Z")).sent.length, 0);
  });
});

/* ------------------------------------------------------------------ *
 * 3. the cash cushion
 * ------------------------------------------------------------------ */

describe("cash cushion — once per drop, re-armed on recovery, personal and business never summed", () => {
  // Personal: Visa min $66.02 + a Fundhub plan payment of $650.00 = $716.02 a month; six months = $4,296.12.
  // Personal cash is $4,210.55 — $85.57 short. Business cash is $18,750 against $1,320 of business minimums.
  const clarity = [{ plan_id: "p1", left_cents: 65000 }];
  const cashDay = (n) => `2026-10-${String(8 + n).padStart(2, "0")}T07:30:00.000Z`;
  const setPersonalCash = (w, cents) => { w.accounts.find((a) => a.id === "pchk").current_balance_cents = cents; };

  test("a drop alerts once; the next days do not repeat it", async () => {
    const w = world({ clarity });
    const first = await w.run(cashDay(0));
    const cash = first.sent.filter((s) => s.kind === "cash_reserve");
    assert.equal(cash.length, 1);
    assert.equal(cash[0].key, `fpa:cash:${CLIENT}:personal:1`);
    assert.equal(cash[0].body,
      "Fundhub alert: your personal cash is $4,210.55. 6 months of your personal minimum payments is $4,296.12. " +
      "A missed payment can hurt your file before your next funding sequence.");
    assert.equal(w.sends.find((s) => s.templateKey === TEMPLATES.cash_reserve).context.alert.cash, "personal");
    for (let n = 1; n <= 5; n++) await w.run(cashDay(n));
    assert.equal(w.alerts.filter((a) => a.kind === "cash_reserve").length, 1);
    assert.equal(w.sends.filter((s) => s.templateKey === TEMPLATES.cash_reserve).length, 1);
  });

  test("when the cash recovers the alert re-arms, and the next drop is a second alert", async () => {
    const w = world({ clarity });
    await w.run(cashDay(0));
    setPersonalCash(w, 500000);
    const recovered = await w.run(cashDay(1));
    assert.deepEqual(recovered.rearmed, ["personal"]);
    assert.ok(w.alerts.find((a) => a.kind === "cash_reserve").clearedAt);
    assert.equal(recovered.sent.filter((s) => s.kind === "cash_reserve").length, 0);

    setPersonalCash(w, 90000);
    const dropped = await w.run(cashDay(2));
    assert.deepEqual(dropped.sent.filter((s) => s.kind === "cash_reserve").map((s) => s.key), [`fpa:cash:${CLIENT}:personal:2`]);
    assert.equal(w.alerts.filter((a) => a.kind === "cash_reserve").length, 2);
  });

  test("personal and business cash are judged apart: rich business cash does not hide a short personal cushion", async () => {
    const w = world({ clarity });
    const r = await w.run(cashDay(0));
    assert.equal(r.reserve.personal.state, "below");
    assert.equal(r.reserve.business.state, "ok");
    // The same thing the other way round: short business cash, plenty of personal cash.
    const w2 = world({ clarity });
    setPersonalCash(w2, 9_000_000);
    w2.accounts.find((a) => a.id === "bchk").current_balance_cents = 100000;
    const r2 = await w2.run(cashDay(0));
    assert.equal(r2.reserve.personal.state, "ok");
    assert.equal(r2.reserve.business.state, "below");
    const biz = r2.sent.find((s) => s.kind === "cash_reserve");
    assert.match(biz.body, /^Fundhub alert: your business cash is \$1,000\.00\./);
    assert.doesNotMatch(biz.body, /personal/);
  });

  test("Fundhub payment plans are in the personal need only", async () => {
    const w = world({ clarity });
    const r = await w.run(cashDay(0));
    assert.ok(r.reserve.personal);
    const w2 = world({ clarity });
    w2.accounts.find((a) => a.id === "bchk").current_balance_cents = 700000; // business need is 6 x $270 = $1,620 -> fine
    assert.equal((await w2.run(cashDay(0))).reserve.business.state, "ok");
  });

  test("not enough to judge (no minimums, no cash account, a stale balance) alerts nothing and clears nothing", async () => {
    const noMins = world({ accounts: baseAccounts().filter((a) => a.account_type === "depository"), cycles: [] });
    const r1 = await noMins.run(cashDay(0));
    assert.equal(r1.reserve.personal.state, "unknown");
    assert.equal(noMins.sends.length, 0);

    const stale = world({ clarity });
    stale.meta = meta(stale.accounts).map((m) => (m.id === "pchk" ? { ...m, balance_as_of: "2026-08-01T00:00:00.000Z" } : m));
    const r2 = await stale.run(cashDay(0));
    assert.deepEqual([r2.reserve.personal.state, r2.reserve.personal.reason], ["unknown", "balance_stale"]);
    assert.equal(stale.alerts.filter((a) => a.kind === "cash_reserve").length, 0);
  });

  test("an unknown reading does not re-arm an open alert", async () => {
    const w = world({ clarity });
    await w.run(cashDay(0));
    w.meta = meta(w.accounts).map((m) => (m.id === "pchk" ? { ...m, balance_as_of: "2026-08-01T00:00:00.000Z" } : m));
    setPersonalCash(w, 9_000_000);
    const r = await w.run(cashDay(1));
    assert.equal(r.reserve.personal.state, "unknown");
    assert.deepEqual(r.rearmed, []);
    assert.equal(w.alerts.find((a) => a.kind === "cash_reserve").clearedAt, null);
  });

  test("switched off: no new alert, but a recovery still re-arms so a stale open alert cannot silence the next drop", async () => {
    const w = world({ clarity });
    await w.run(cashDay(0));
    w.settings.cash_reserve = false;
    setPersonalCash(w, 500000);
    const r = await w.run(cashDay(1));
    assert.deepEqual(r.rearmed, ["personal"]);
    setPersonalCash(w, 90000);
    const off = await w.run(cashDay(2));
    assert.equal(off.sent.filter((s) => s.kind === "cash_reserve").length, 0);
    assert.ok(off.skipped.some((s) => s.kind === "cash_reserve" && s.reason === "switched_off"));
  });

  test("unsorted cash and unsorted debts are in neither check", async () => {
    const accounts = baseAccounts().map((a) => (a.id === "visa" ? { ...a, entity_kind: "unknown" } : a));
    const w = world({ accounts, clarity: [] });
    const r = await w.run(cashDay(0));
    // The Visa's minimum is not counted anywhere, so there is no personal minimum to judge.
    assert.equal(r.reserve.personal.state, "unknown");
    assert.equal(r.reserve.personal.reason, "no_minimums");
  });
});

/* ------------------------------------------------------------------ *
 * 4. new credit
 * ------------------------------------------------------------------ */

describe("new credit — a new account on a linked login", () => {
  const newCard = () => acct({ id: "freedom", name: "Chase Freedom", mask: "4321", entity_kind: "personal", current_balance_cents: 0, credit_limit_cents: 1000000 });
  const withNewCard = (w) => {
    w.accounts.push(newCard());
    w.meta = [
      ...meta(w.accounts.filter((a) => a.id !== "freedom")),
      { id: "freedom", account_type: "credit", plaid_item_id: "item-1", mask: "4321", name: "Chase Freedom", closed_at: null,
        created_at: "2026-10-11T09:00:00.000Z", balance_as_of: "2026-10-11T09:00:00.000Z", item_created_at: "2026-09-01T10:00:00.000Z" }
    ];
  };

  test("a Blueprint buyer gets the text AND a CSM task, once", async () => {
    const w = world({ blueprint: true });
    withNewCard(w);
    const r = await w.run("2026-10-12T07:30:00.000Z");
    const nc = r.sent.filter((s) => s.kind === "new_credit");
    assert.equal(nc.length, 1);
    assert.equal(nc[0].key, "fpa:new:acct:freedom");
    assert.equal(nc[0].delivery, "text");
    assert.match(nc[0].body, /^Fundhub alert: a new card showed up on your linked accounts: Chase Freedom ending 4321\./);
    assert.equal(w.tasks.length, 1);
    assert.equal(w.tasks[0].sourceWorkflow, TASK_SOURCE);
    assert.equal(w.tasks[0].assigneeRole, "csm");
    assert.equal(w.tasks[0].assigneeStaffId, "staff-csm-1");
    assert.equal(w.tasks[0].eventId, "fpa:new:acct:freedom");
    const row = w.alerts.find((a) => a.kind === "new_credit");
    assert.equal(row.taskId, "task-1");
    assert.equal(row.delivery, "text");

    await w.run("2026-10-13T07:30:00.000Z");
    assert.equal(w.tasks.length, 1);
    assert.equal(w.alerts.filter((a) => a.kind === "new_credit").length, 1);
    const newCreditMessages = [...w.sentMessages.keys()].filter((k) => k.includes(TEMPLATES.new_credit));
    assert.equal(newCreditMessages.length, 1, "one text about the card, however many days pass");
  });

  test("a Finance OS client who is not a Blueprint buyer gets the text and no task", async () => {
    const w = world({ blueprint: false });
    withNewCard(w);
    const r = await w.run("2026-10-12T07:30:00.000Z");
    assert.equal(r.sent.filter((s) => s.kind === "new_credit").length, 1);
    assert.equal(w.tasks.length, 0);
  });

  test("an opted-out Blueprint buyer is not texted, but a person still hears about the new card", async () => {
    const w = world({ blueprint: true, optedOut: true });
    withNewCard(w);
    const r = await w.run("2026-10-12T07:30:00.000Z");
    assert.equal(w.sends.length, 0);
    const nc = r.sent.filter((s) => s.kind === "new_credit");
    assert.equal(nc.length, 1);
    assert.equal(nc[0].delivery, "task_only");
    assert.equal(w.tasks.length, 1);
    assert.equal(w.alerts.find((a) => a.kind === "new_credit").messageId, null);
  });

  test("the first read of a login is the baseline: a client linking their cards is not told they opened them", async () => {
    const w = world({ blueprint: true });
    const r = await w.run("2026-10-02T07:30:00.000Z");
    assert.equal(r.sent.filter((s) => s.kind === "new_credit").length, 0);
    assert.equal(w.tasks.length, 0);
  });

  test("switched off: nothing", async () => {
    const w = world({ blueprint: true, settings: { new_credit: false } });
    withNewCard(w);
    const r = await w.run("2026-10-12T07:30:00.000Z");
    assert.equal(r.sent.filter((s) => s.kind === "new_credit").length, 0);
    assert.equal(w.tasks.length, 0);
  });
});

describe("new credit — between two credit pulls", () => {
  const tl = (over = {}) => ({ accountType: "Revolving", creditorName: "Credit One Bank", accountIdentifier: "SIM-CRED1-3018", accountOpenedDate: "2022-09-14", ...over });
  const pulls = (latestExtra = {}, { latestId = "pull-2", latestOn = "2026-10-11" } = {}) => ({
    prev: { id: "pull-1", on: "2026-09-10", result: { tradelines: [tl()], inquiries: [] } },
    latest: { id: latestId, on: latestOn, result: { tradelines: [tl()], inquiries: [], ...latestExtra } }
  });

  test("a new inquiry on the newest pull: one text, one task, and not again tomorrow", async () => {
    const w = world({
      blueprint: true,
      pulls: pulls({ inquiries: [{ creditorName: "American Express", date: "2026-10-03", source: "EX" }] })
    });
    const r = await w.run("2026-10-12T07:30:00.000Z");
    const nc = r.sent.filter((s) => s.kind === "new_credit");
    assert.equal(nc.length, 1);
    assert.equal(nc[0].key, "fpa:new:pull:pull-2");
    assert.match(nc[0].body, /^Fundhub alert: your latest credit pull shows 1 new inquiry \(American Express, Oct 3\)\./);
    assert.equal(w.tasks.length, 1);
    await w.run("2026-10-13T07:30:00.000Z");
    assert.equal(w.alerts.filter((a) => a.kind === "new_credit").length, 1);
    assert.equal(w.tasks.length, 1);
  });

  test("a new tradeline on the newest pull", async () => {
    const w = world({
      pulls: pulls({ tradelines: [tl(), tl({ creditorName: "Capital One", accountIdentifier: "CAP-5566", accountOpenedDate: "2026-09-20" })] })
    });
    const r = await w.run("2026-10-12T07:30:00.000Z");
    assert.match(r.sent.find((s) => s.kind === "new_credit").body, /1 new account \(Capital One, opened Sep 20\)/);
  });

  test("the same file twice, or a renamed creditor, is no news", async () => {
    const same = world({ pulls: pulls() });
    assert.equal((await same.run("2026-10-12T07:30:00.000Z")).sent.filter((s) => s.kind === "new_credit").length, 0);
    const renamed = world({ pulls: pulls({ tradelines: [tl({ creditorName: "CREDIT ONE BANK N.A." })] }) });
    assert.equal((await renamed.run("2026-10-12T07:30:00.000Z")).sent.filter((s) => s.kind === "new_credit").length, 0);
  });

  test("a card already announced from Plaid is not announced again from the pull", async () => {
    const w = world({
      blueprint: true,
      pulls: pulls({ tradelines: [tl(), tl({ creditorName: "Chase Freedom", accountIdentifier: "CF-4321", accountOpenedDate: "2026-10-09" })] })
    });
    w.accounts.push(acct({ id: "freedom", name: "Chase Freedom", mask: "4321", entity_kind: "personal" }));
    w.meta = [
      ...meta(w.accounts.filter((a) => a.id !== "freedom")),
      { id: "freedom", account_type: "credit", plaid_item_id: "item-1", mask: "4321", name: "Chase Freedom", closed_at: null,
        created_at: "2026-10-11T09:00:00.000Z", balance_as_of: null, item_created_at: "2026-09-01T10:00:00.000Z" }
    ];
    const r = await w.run("2026-10-12T07:30:00.000Z");
    const nc = r.sent.filter((s) => s.kind === "new_credit");
    assert.deepEqual(nc.map((s) => s.key), ["fpa:new:acct:freedom"], "the pull's copy of the same card is dropped");
    assert.equal(w.tasks.length, 1);
  });

  test("a pull whose bureaus changed is not compared, and the skip says why", async () => {
    const w = world({
      pulls: {
        prev: { id: "pull-1", on: "2026-09-10", result: { tradelines: [tl()], inquiries: [], bureausPulled: ["TU"] } },
        latest: { id: "pull-2", on: "2026-10-11", result: { tradelines: [tl(), tl({ creditorName: "EQ Only", accountIdentifier: "EQ-3434", accountOpenedDate: "2019-02-02" })], inquiries: [], bureausPulled: ["TU", "EQ"] } }
      }
    });
    const r = await w.run("2026-10-12T07:30:00.000Z");
    assert.equal(r.sent.filter((s) => s.kind === "new_credit").length, 0);
    assert.ok(r.skipped.some((s) => s.reason === "bureau_set_changed"));
  });
});

/* ------------------------------------------------------------------ *
 * the readers
 * ------------------------------------------------------------------ */

describe("snapshot readers", () => {
  test("loadSnapshot reads through the overview's own SQL, filtered by org and client, and builds its numbers", async () => {
    const w = world({ clarity: [{ plan_id: "p1", left_cents: 65000 }, { plan_id: "p2", left_cents: 15000 }] });
    const snap = await loadSnapshot(w.conn, { orgId: ORG, clientId: CLIENT, asOf: T("2026-10-12T07:30:00.000Z") });
    assert.equal(snap.today, "2026-10-12");
    assert.equal(snap.overview.cash.personal.cents, 421055);
    assert.equal(snap.overview.cash.business.cents, 1875000);
    assert.equal(snap.overview.debt.cards.length, 2);
    assert.equal(snap.clarityMonthlyCents, 80000, "one next payment per open plan, added");
    assert.equal(snap.cycleByAccount.get("amex").statement_close_day, 15);
    assert.deepEqual(snap.staleByKind, { personal: false, business: false });
    assert.ok(snap.debts.find((d) => d.id === "amex" && d.min_cents === 27000 && d.kind === "business"));
  });

  test("loadSnapshot is null for a client that is not in the org", async () => {
    const conn = { query: async () => ({ rows: [] }) };
    assert.equal(await loadSnapshot(conn, { orgId: ORG, clientId: CLIENT }), null);
  });

  test("clarityMonthly: nothing open is null, not zero", () => {
    assert.equal(clarityMonthly([]), null);
    assert.equal(clarityMonthly([{ left_cents: 0 }]), null);
    assert.equal(clarityMonthly([{ left_cents: "50000" }, { left_cents: 1000 }]), 51000);
  });

  test("staleCashKinds flags only a depository account with an OLD stated balance", () => {
    const ov = { accounts: [
      { id: "p", type: "depository", kind: "personal" }, { id: "b", type: "depository", kind: "business" },
      { id: "c", type: "credit", kind: "personal" }
    ] };
    const now = Date.parse("2026-10-12T00:00:00Z");
    const m = [
      { id: "p", balance_as_of: "2026-08-01T00:00:00Z" },
      { id: "b", balance_as_of: null },
      { id: "c", balance_as_of: "2020-01-01T00:00:00Z" }
    ];
    assert.deepEqual(staleCashKinds(ov, m, now), { personal: true, business: false });
  });

  test("loadLatestPulls: needs two pulls, a recent newest one, and only then reads the payloads", async () => {
    const calls = [];
    const conn = (heads, full = []) => ({
      async query(sql) {
        calls.push(String(sql));
        return /LIMIT 2/.test(sql) ? { rows: heads } : { rows: full };
      }
    });
    const now = T("2026-10-12T07:30:00.000Z");
    assert.equal(await loadLatestPulls(conn([{ id: "a", created_at: "2026-10-11T00:00:00Z" }]), { orgId: ORG, clientId: CLIENT, now }), null);
    assert.equal(calls.length, 1);

    calls.length = 0;
    const old = [{ id: "b", created_at: "2026-09-20T00:00:00Z" }, { id: "a", created_at: "2026-08-20T00:00:00Z" }];
    assert.equal(await loadLatestPulls(conn(old), { orgId: ORG, clientId: CLIENT, now }), null);
    assert.equal(calls.length, 1, "an old pull never costs a payload read");

    calls.length = 0;
    const fresh = [{ id: "b", created_at: new Date("2026-10-11T08:00:00Z") }, { id: "a", created_at: new Date("2026-09-10T08:00:00Z") }];
    const got = await loadLatestPulls(conn(fresh, [{ id: "b", result: { n: 2 } }, { id: "a", result: { n: 1 } }]), { orgId: ORG, clientId: CLIENT, now });
    assert.deepEqual([got.latest.id, got.latest.on, got.prev.id, got.prev.on], ["b", "2026-10-11", "a", "2026-09-10"]);
    assert.deepEqual([got.latest.result.n, got.prev.result.n], [2, 1]);
    assert.match(calls[0], /is_demo IS NOT TRUE/);
  });
});
