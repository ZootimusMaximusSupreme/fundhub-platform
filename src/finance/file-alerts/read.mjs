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
import { promoPayoff, nextPromoAlert } from "./promo.mjs";
import {
  KINDS, KIND_LABELS, PROMO_THRESHOLDS, RESERVE_MONTHS, readPayBeforeCloseDays,
  isoDay, addDaysIso, toCentsOrNull
} from "./common.mjs";

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
    promo = {
      ends_on: endsOn,
      days_left: daysLeft,
      ended: daysLeft !== null && daysLeft < 0,
      apr_pct: pctOf(cycle.promo_apr),
      source: cycle.promo_source ?? null,
      set_at: cycle.promo_set_at ?? null,
      balance_cents: balance,
      payoff: daysLeft !== null && daysLeft >= 0 ? promoPayoff({ balanceCents: balance, daysLeft }) : null,
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

  const [settings, alerts, state, optedOut, blueprint, entitlement] = await Promise.all([
    store.readSettings(conn, { orgId, clientId }),
    store.listAlerts(conn, { orgId, clientId, limit: 50 }),
    store.reserveState(conn, { orgId, clientId }),
    (deps.isOptedOut || isOptedOut)(conn, clientId, "sms"),
    (deps.isBlueprint || isCapitalBlueprintBuyer)(conn, { orgId, clientId }),
    (deps.financeOsEntitlement || financeOsEntitlement)(conn, { orgId, clientId, asOf: nowDate })
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
    alerts: alerts.map((a) => ({
      id: a.id,
      kind: a.kind,
      kind_label: KIND_LABELS[a.kind] ?? a.kind,
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
