// GET /api/money/alerts — everything the file-protection screen shows, in one read.
//
// THE JSON SHAPE IS A CONTRACT. It is written out in
// docs/finance/file-protection-alerts.md and the screen is built against it. Change a
// key here and that page breaks.
//
// It reads; it never decides to send and never writes. Every number is the one the
// daily job uses (the same planners, the same overview), so the screen cannot say
// "we will text you Oct 12" while the job decides otherwise.
//
// Money is integer cents. Unknown is null, never 0. Cash is never added across
// personal and business: `reserve` has one verdict per kind and no total.

import { nextStatementClose, daysBetween } from "../../banking/statement-cycles.mjs";
import { isCapitalBlueprintBuyer } from "../../blueprint/coach-exception.mjs";
import { financeOsEntitlement } from "../finance-os-entitlement.mjs";
import { isOptedOut } from "../../lib/opt-out.mjs";
import * as defaultStore from "./store.mjs";
import { loadSnapshot as defaultLoadSnapshot } from "./snapshot.mjs";
import { evaluateReserve, CASH_KINDS } from "./cash-reserve.mjs";
import { payoffAtRate, nextPromoAlert } from "./promo.mjs";
import { listAlertBills as defaultListBills, billView } from "./bills.mjs";
import { listCustomItems as defaultListCustom, customView } from "./custom.mjs";
import { buildAlertBoard, seasoningRows } from "./board.mjs";
import { readRelationships as defaultReadRelationships } from "../bank-strategy.mjs";
import { loadBillCleanup } from "../../banking/bill-cleanup.mjs";
import { seasoningClock } from "../apply-gate.mjs";
import { attachAccountLogos } from "../../banking/institution-logos.mjs";
import {
  PHONE_KINDS, PHONE_LABELS, BILL_PUSH_DAYS_BEFORE, planCardDuePush, planBillPush, planLoanDuePush,
  planInstallmentPush, planLabel, isCreditLine
} from "./phone-alerts.mjs";
import { REMIND_DAYS_BEFORE } from "../../banking/card-due-reminders.mjs";
import {
  phoneState as defaultPhoneState, listPhoneAlerts as defaultListPhoneAlerts
} from "../../push/finance-alerts.mjs";
import {
  KINDS, KIND_LABELS, PROMO_THRESHOLDS, RESERVE_MONTHS, readPayBeforeCloseDays,
  isoDay, addDaysIso, toCentsOrNull
} from "./common.mjs";
import { BUNDLE_LABELS } from "./bundle-common.mjs";

const pctOf = (fraction) => (fraction === null || fraction === undefined || fraction === ""
  ? null
  : Math.round(Number(fraction) * 100000) / 1000);

function cardView(card, cycle, { today, daysBefore, alerts }) {
  const close = cycle
    ? nextStatementClose(cycle, { today })
    : { closesOn: null, daysAway: null, unknownReason: "no_statement_close_day" };
  const mine = alerts.filter((a) => a.bank_account_id && String(a.bank_account_id) === String(card.account_id));
  const timingSent = close.closesOn
    ? mine.find((a) => a.kind === "payment_timing" && isoDay(a.due_on) === close.closesOn)
    : null;

  const endsOn = isoDay(cycle?.promo_ends_on);
  let promo = null;
  if (endsOn) {
    const daysLeft = daysBetween(today, endsOn);
    const balance = toCentsOrNull(card.balance_cents);
    const aprPct = pctOf(cycle.promo_apr);
    promo = {
      ends_on: endsOn,
      days_left: daysLeft,
      ended: daysLeft !== null && daysLeft < 0,
      apr_pct: aprPct,
      source: cycle.promo_source ?? null,
      set_at: cycle.promo_set_at ?? null,
      balance_cents: balance,
      // At the promo rate, the same amount the promo text and the intro countdown say
      // (payoffAtRate in ./promo.mjs). No rate on file: monthly_is_floor, never a payoff.
      payoff: daysLeft !== null && daysLeft >= 0 ? payoffAtRate({ balanceCents: balance, daysLeft, aprPct }) : null,
      next_alert: daysLeft !== null && daysLeft >= 0 ? nextPromoAlert(endsOn, today) : null,
      alerted_thresholds: mine
        .filter((a) => a.kind === "promo_end" && isoDay(a.due_on) === endsOn)
        .map((a) => a.threshold)
        .sort((a, b) => b - a)
    };
  }

  return {
    account_id: card.account_id,
    name: card.name,
    mask: card.mask,
    kind: card.kind,
    balance_cents: card.balance_cents,
    limit_cents: card.limit_cents,
    used_pct: card.used_pct,
    statement_close_day: cycle && cycle.statement_close_day !== null && cycle.statement_close_day !== undefined
      ? Number(cycle.statement_close_day) : null,
    close_day_source: cycle ? (cycle.source ?? null) : null,
    pay_before: {
      next_close_on: close.closesOn,
      days_to_close: close.daysAway,
      unknown_reason: close.closesOn ? null : close.unknownReason,
      // The first day the text can go for the next close; the text then holds
      // for the dispatcher's quiet hours like any other.
      text_on: close.closesOn ? addDaysIso(close.closesOn, -daysBefore) : null,
      texted: !!timingSent,
      texted_at: timingSent ? timingSent.sent_at : null
    },
    promo
  };
}

function reserveView(verdict, open) {
  return {
    state: verdict.state,
    reason: verdict.reason,
    months: verdict.months,
    cash_cents: verdict.cash_cents,
    cash_is_floor: verdict.cash_is_floor,
    cash_accounts: verdict.cash_accounts,
    minimums_cents: verdict.minimums_cents,
    minimums_is_floor: verdict.minimums_is_floor,
    clarity_cents: verdict.clarity_cents,
    need_cents: verdict.need_cents,
    short_cents: verdict.short_cents,
    open_alert_id: open ? open.id : null
  };
}

/* A read the phone block needs that could not be made answers null, never a
   made-up "no phone" or "no bills": the screen then says it could not check. */
async function orNull(fn) {
  try { return await fn(); } catch { return null; }
}

/* Each account's bank logo for the board (unit H, src/banking/institution-logos.mjs):
   Plaid's own logo first, then the bank book's file. A Map of account id to logo; an
   account with no logo is left out, so it shows its name only. */
async function accountLogos(conn, { orgId, clientId, accounts = [] } = {}) {
  const rows = (Array.isArray(accounts) ? accounts : []).filter((a) => a && a.id)
    .map((a) => ({ id: String(a.id), name: a.name ?? null, source: "bank_account" }));
  const logos = new Map();
  if (!rows.length) return logos;
  const view = await attachAccountLogos(conn, { orgId, clientId, view: { unassigned: { accounts: rows, cards: [], loans: [] } } });
  for (const r of (view && view.unassigned && view.unassigned.accounts) || []) {
    if (r && r.logo) logos.set(String(r.id), r.logo);
  }
  return logos;
}

/** When the next phone alert about one payment goes, or why none is set, from a plan. */
function alertView(plan, today) {
  if (plan.push) return { on: plan.dueOn, alert_on: today, reason: null };
  const alertOn = plan.reason === "not_yet" && plan.dueOn ? addDaysIso(plan.dueOn, -REMIND_DAYS_BEFORE) : null;
  return { on: plan.dueOn ?? null, alert_on: alertOn, reason: plan.reason };
}
function cardDueView(card, cycle, today, subtype) {
  return alertView(planCardDuePush(card, cycle, { today, subtype }), today);
}

/** The phone alert block: which alerts are on, for which card, loan, bill and plan, and what already went. */
function phoneView({ settings, state, optedOutSms, cards, loans = [], plans = [], cycleOf, subtypeOf, bills, sent, today }) {
  const enabled = settings.phone_alerts !== false;
  const optedOut = !!optedOutSms || !!(state && state.optedOut);
  const on = (kind) => enabled && !optedOut && (kind !== "statement_close" || settings.payment_timing !== false);
  return {
    enabled,
    opted_out: optedOut,
    // null: the phone read failed, so the screen must not say "no phone".
    has_phone: state ? state.hasPhone : null,
    send_window: "9 a.m. to 5 p.m. Arizona time",
    kinds: Object.fromEntries(PHONE_KINDS.map((k) => [k, { on: on(k), label: PHONE_LABELS[k] }])),
    days_before: { card_due: REMIND_DAYS_BEFORE, important_bill: BILL_PUSH_DAYS_BEFORE, loan_due: REMIND_DAYS_BEFORE, plan_due: REMIND_DAYS_BEFORE },
    cards: cards.map((c) => ({
      account_id: c.account_id,
      name: c.name,
      mask: c.mask,
      kind: c.kind ?? null, // personal or business: a business card is alerted like any card
      credit_line: isCreditLine(subtypeOf(c)),
      due: cardDueView(c, cycleOf(c), today, subtypeOf(c)),
      close: { on: c.pay_before.next_close_on, alert_on: c.pay_before.text_on, reason: c.pay_before.unknown_reason }
    })),
    // Every loan and line of credit (D2, owner-set 2026-11-07).
    loans: loans.map((l) => ({
      account_id: l.account_id,
      name: l.name,
      mask: l.mask,
      kind: l.kind ?? null,
      credit_line: isCreditLine(subtypeOf(l)),
      due: alertView(planLoanDuePush(l, cycleOf(l), { today, subtype: subtypeOf(l) }), today)
    })),
    // Each open payment plan owed to Fundhub (Clarity Payments): its next unpaid installment.
    plans: plans.map((row) => ({
      plan_id: row.plan_id ? String(row.plan_id) : null,
      installment_id: row.installment_id ? String(row.installment_id) : null,
      name: planLabel(row),
      plan_kind: row.kind ?? null,
      ...alertView(planInstallmentPush(row, { today }), today)
    })),
    important_count: Array.isArray(bills) ? bills.filter((b) => b.important).length : null,
    sent: Array.isArray(sent) ? sent : null
  };
}

/**
 * fileAlertsPayload(conn, { orgId, clientId, now, env }) → the contract, or null when
 * the client is not in that org (the caller answers 404).
 */
export async function fileAlertsPayload(conn, { orgId, clientId, now = new Date(), env = process.env } = {}, deps = {}) {
  const store = deps.store || defaultStore;
  const loadSnapshot = deps.loadSnapshot || defaultLoadSnapshot;
  const nowDate = new Date(now);

  const snap = await loadSnapshot(conn, { orgId, clientId, asOf: nowDate });
  if (!snap) return null;
  const { today } = snap;

  const [settings, alerts, state, optedOut, blueprint, entitlement, billRows, phone, phoneSent, customRows] = await Promise.all([
    store.readSettings(conn, { orgId, clientId }),
    store.listAlerts(conn, { orgId, clientId, limit: 50 }),
    store.reserveState(conn, { orgId, clientId }),
    (deps.isOptedOut || isOptedOut)(conn, clientId, "sms"),
    (deps.isBlueprint || isCapitalBlueprintBuyer)(conn, { orgId, clientId }),
    (deps.financeOsEntitlement || financeOsEntitlement)(conn, { orgId, clientId, asOf: nowDate }),
    orNull(() => (deps.listBills || defaultListBills)(conn, { orgId, clientId })),
    orNull(() => (deps.phoneState || defaultPhoneState)(conn, { orgId, clientId })),
    orNull(() => (deps.listPhoneAlerts || defaultListPhoneAlerts)(conn, { orgId, clientId, limit: 20 })),
    orNull(() => (deps.listCustom || defaultListCustom)(conn, { orgId, clientId }))
  ]);

  const daysBefore = readPayBeforeCloseDays(env);
  const cards = (snap.overview?.debt?.cards || []).map((c) =>
    cardView(c, snap.cycleByAccount.get(String(c.account_id)) ?? null, { today, daysBefore, alerts }));

  const reserve = { months: RESERVE_MONTHS };
  for (const kind of CASH_KINDS) {
    const verdict = evaluateReserve({
      kind,
      cash: snap.overview?.cash?.[kind],
      debts: snap.debts,
      clarityMonthlyCents: snap.clarityMonthlyCents,
      staleBalance: !!snap.staleByKind?.[kind]
    });
    reserve[kind] = reserveView(verdict, state.open.get(kind));
  }
  // Cards and loans whose kind is not sorted yet are in neither check.
  const unsorted = snap.debts.filter((d) => (d.kind || "unknown") === "unknown"
    && !(toCentsOrNull(d.balance_cents) !== null && toCentsOrNull(d.balance_cents) <= 0));
  const unsortedMins = unsorted.map((d) => toCentsOrNull(d.min_cents)).filter((v) => v !== null);
  reserve.not_counted = {
    debts: unsorted.length,
    minimums_cents: unsortedMins.length ? unsortedMins.reduce((a, b) => a + b, 0) : null
  };

  /* Repeat bills, each with its Important mark and when its phone alert goes. */
  const bills = Array.isArray(billRows)
    ? billRows.map((row) => {
      const view = billView(row);
      const plan = planBillPush(row, { today });
      const alertOn = plan.push ? today
        : plan.reason === "not_yet" && plan.dueOn ? addDaysIso(plan.dueOn, -BILL_PUSH_DAYS_BEFORE) : null;
      const sentFor = Array.isArray(phoneSent)
        ? phoneSent.find((a) => a.kind === "important_bill" && a.subject_id === view.id && a.about_on === view.next_expected_on)
        : null;
      return { ...view, phone: { alert_on: view.important ? alertOn : null, reason: view.important ? plan.reason : null, sent: sentFor ? sentFor.state : null } };
    })
    : null;
  const cycleOf = (c) => snap.cycleByAccount.get(String(c.account_id)) ?? null;
  const subtypes = new Map((snap.overview?.accounts || []).map((a) => [String(a.id), a.subtype ?? null]));
  const subtypeOf = (a) => subtypes.get(String(a.account_id)) ?? null;
  const phoneBlock = phoneView({
    settings, state: phone, optedOutSms: optedOut, cards, cycleOf, subtypeOf, bills, sent: phoneSent, today,
    loans: snap.overview?.debt?.loans || [],
    plans: snap.clarityPlans || []
  });

  /* The client's own alerts and repeat bills (unit AL2), and the organized board:
     Personal and each business, with Payments due, Bills and Smart alerts. Bill
     cleanup (unit C, src/banking/bill-cleanup.mjs), the seasoning clock (unit L4,
     src/finance/apply-gate.mjs) and bank logos (unit H) are read here; deps can stand
     in for each. One that fails simply adds nothing (`board.checks` says which ran). */
  const custom = Array.isArray(customRows) ? customRows.map((row) => customView(row, { today, sent: phoneSent })) : null;
  const cleanup = await orNull(() => (deps.loadBillCleanup || loadBillCleanup)(conn, { orgId, clientId, asOf: nowDate }));
  const clockOf = deps.seasoningClock || seasoningClock;
  const seasoning = await orNull(async () => seasoningRows(await (deps.readRelationships || defaultReadRelationships)(conn, { orgId, clientId, today }), clockOf, today));
  const logos = await orNull(() => (deps.accountLogos || accountLogos)(conn, { orgId, clientId, accounts: snap.overview?.accounts || [] }));
  const board = buildAlertBoard({
    today, snap, cards, phone: phoneBlock, bills, billRows: Array.isArray(billRows) ? billRows : [], custom, reserve,
    cleanup, seasoning, logos: logos instanceof Map ? logos : new Map()
  });

  const name = [snap.client.first_name, snap.client.last_name].filter(Boolean).join(" ") || null;
  return {
    ok: true,
    as_of: snap.asOf,
    client: { id: snap.client.id, name },
    enrolled: {
      blueprint: !!blueprint,
      finance_os: !!(entitlement && entitlement.entitled),
      any: !!blueprint || !!(entitlement && entitlement.entitled)
    },
    settings: {
      kinds: Object.fromEntries(KINDS.map((k) => [k, { enabled: settings[k] !== false, label: KIND_LABELS[k] }])),
      saved: !!settings.saved,
      pay_before_close_days: daysBefore,
      promo_thresholds_days: [...PROMO_THRESHOLDS],
      reserve_months: RESERVE_MONTHS,
      texts_blocked: !!optedOut
    },
    cards,
    reserve,
    phone: phoneBlock,
    bills,
    custom,
    board,
    alerts: alerts.map((a) => ({
      id: a.id,
      kind: a.kind,
      kind_label: KIND_LABELS[a.kind] ?? BUNDLE_LABELS[a.kind] ?? a.kind,
      account_id: a.bank_account_id ?? null,
      label: a.subject_label ?? null,
      threshold: a.threshold ?? null,
      due_on: isoDay(a.due_on),
      cash_kind: a.cash_kind ?? null,
      body: a.body,
      delivery: a.delivery,
      message_id: a.message_id ?? null,
      task_id: a.task_id ?? null,
      sent_at: a.sent_at,
      cleared_at: a.cleared_at ?? null,
      open: a.kind === "cash_reserve" && !a.cleared_at
    }))
  };
}

export default fileAlertsPayload;
