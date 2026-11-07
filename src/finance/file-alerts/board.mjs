// The organized Alerts board — Personal and each business, and in each one:
// Payments due, Bills, Smart alerts. Finance OS CFO build, unit AL2 (Chris,
// 2026-11-07: "the Alerts section is really disorganized... organize it... organize
// it by business... something really intelligent").
//
// PURE. No database, no clock: `today` is a parameter. GET /api/money/alerts
// (./read.mjs) builds it from the same snapshot, planners and views the rest of the
// answer uses, so the board cannot say one date while a text or a phone alert says
// another.
//
// WHERE A THING GOES (its scope)
//   personal          everything whose kind is personal (a personal entity too), and
//                     Fundhub's payment plans (CLARITY_CASH_KIND in ./common.mjs)
//   biz:<entity id>   everything in that business entity (entities, migration 106)
//   business          business things not in any company yet
//   unknown           things not sorted into personal or business yet
// A bill goes where its own entity says, else where the account it is paid from is.
//
// SMART ALERTS — REAL DATA ONLY. Each one is a fact read from the file; when a fact
// is missing the alert is simply not there, never a guess.
//   pay_by         one per card that owes money: "Pay by <date>". The alerts
//                  bundle's "Pay by" and its over-10% rule live here and nowhere
//                  else on the Alerts screen (unit AL folded in, 2026-11-07). The
//                  date is AL's payBy() (./pay-by.mjs): two days before the
//                  statement close or the due date, whichever comes first, or today
//                  when that has passed (Chris, 2026-11-07: "pay a couple of days
//                  BEFORE the statement close and the due date"; the two is
//                  PAY_BY_DAYS_BEFORE in ./bundle-common.mjs). A card over 10% of
//                  its limit also carries AL's cardRule() (./card-over-10.mjs):
//                  what to pay so under 10% reports. No close day and no due date
//                  ahead means no alert.
//   price_up       a repeat bill's price went up       (src/banking/bill-cleanup.mjs,
//   charged_twice  the same charge twice                handed in as `cleanup`)
//   cash_low       cash under six months of minimums, per scope: evaluateReserve in
//                  ./cash-reserve.mjs on that scope's own cash and debts. Personal is
//                  the exact check the cash text runs.
//   seasoning      a bank account on the plan is still seasoning: N days left
//                  (the seasoning clock, handed in as `seasoning`).
// Cash is never added across scopes. Money is integer cents; unknown is null.

import { daysBetween } from "../../banking/statement-cycles.mjs";
import { bankingSurface } from "../banking-surface.mjs";
import { evaluateReserve } from "./cash-reserve.mjs";
import { staleCashKinds } from "./snapshot.mjs";
import { CLARITY_CASH_KIND, RESERVE_MONTHS, cardWords, toCentsOrNull } from "./common.mjs";
import { planLabel, isCreditLine } from "./phone-alerts.mjs";
import { PAY_BY_DAYS_BEFORE } from "./bundle-common.mjs";
import { payBy } from "./pay-by.mjs";
import { cardRule } from "./card-over-10.mjs";

export const SMART_KINDS = Object.freeze(["charged_twice", "pay_by", "cash_low", "price_up", "seasoning"]);
const SMART_RANK = Object.fromEntries(SMART_KINDS.map((k, i) => [k, i]));

const LOOSE_NAMES = Object.freeze({ personal: "Personal", business: "Business", unknown: "Not sorted yet" });

const text = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The scope key for a kind and a container. */
export function scopeKeyOf(kind, containerId) {
  if (kind === "personal") return "personal";
  if (kind === "business") return containerId ? `biz:${containerId}` : "business";
  return "unknown";
}

/** Soonest first; no date last; then by name. */
function byDate(field) {
  return (a, b) => {
    const x = a[field] || "9999-12-31";
    const y = b[field] || "9999-12-31";
    if (x !== y) return x < y ? -1 : 1;
    return String(a.name || "").localeCompare(String(b.name || ""));
  };
}

/* One scope's cash, read the way the overview reads cash (bankingSurface over its
   open accounts): depository only, a missing balance makes a floor. */
function scopeCash(accounts, kind) {
  const rows = accounts.map((a) => ({
    id: a.id, account_type: a.type, entity_kind: kind,
    current_balance_cents: a.current_cents, available_balance_cents: a.available_cents, closed_at: null
  }));
  const g = bankingSurface(rows).groups.find((x) => x.key === kind);
  return { cents: g.current.value, is_floor: g.current.basis.partial, accounts: g.current.basis.lines };
}

function cashLow(verdict, key) {
  if (!verdict || verdict.state !== "below") return null;
  return {
    id: `cash_low:${key}`,
    kind: "cash_low",
    name: null,
    on: null,
    cash_cents: verdict.cash_cents,
    need_cents: verdict.need_cents,
    short_cents: verdict.short_cents,
    months: verdict.months ?? RESERVE_MONTHS,
    minimums_is_floor: !!verdict.minimums_is_floor
  };
}

/**
 * seasoningRows(relationships, clockOf, today) → [{ relationship_id, bank, container_id,
 * account_kind, logo_path, clock }], one per relationship the clock function answers.
 * `relationships` are readRelationships() lines (src/finance/bank-strategy.mjs);
 * `clockOf(rel, { today })` is the seasoning clock (src/finance/apply-gate.mjs
 * seasoningClock). Pure.
 */
export function seasoningRows(relationships = [], clockOf = null, today) {
  if (typeof clockOf !== "function") return [];
  const out = [];
  for (const rel of Array.isArray(relationships) ? relationships : []) {
    const clock = clockOf(rel, { today });
    if (!clock) continue;
    out.push({
      relationship_id: rel.id ? String(rel.id) : null,
      bank: text(clock.bank) || text(rel.bank),
      container_id: rel.container_id ? String(rel.container_id) : null,
      account_kind: rel.account_kind === "business" || rel.account_kind === "personal" ? rel.account_kind : null,
      logo_path: clock.logo_path ?? null,
      clock
    });
  }
  return out;
}

/**
 * buildAlertBoard(input) → { today, pay_by_days_before, default_scope, checks, scopes: [...] }
 *
 * input:
 *   today        "YYYY-MM-DD"
 *   snap         ./snapshot.mjs loadSnapshot() (overview, cycleByAccount, debts, meta,
 *                clarityPlans, asOf)
 *   cards        ./read.mjs cardView() rows (pay_before, statement_close_day)
 *   phone        ./read.mjs phone block (cards[].due, loans[].due, plans[], kinds)
 *   bills        ./read.mjs bills (billView + phone), or null when they could not be read
 *   billRows     the raw recurring_bills rows behind `bills` (entity_id, bank_account_id)
 *   custom       ./custom.mjs customView() rows, or null when they could not be read
 *   reserve      ./read.mjs reserve (the two cash-text verdicts)
 *   cleanup      src/banking/bill-cleanup.mjs answer { ok, flags }, or null when not read
 *   seasoning    seasoningRows() answer, or null when not read
 *   logos        Map account id → logo string (Plaid first, then the bank book), or none
 */
export function buildAlertBoard({
  today, snap, cards = [], phone = null, bills = [], billRows = [], custom = [], reserve = {},
  cleanup = null, seasoning = null, logos = new Map()
} = {}) {
  const overview = (snap && snap.overview) || {};
  const accounts = Array.isArray(overview.accounts) ? overview.accounts : [];
  const accountById = new Map(accounts.map((a) => [String(a.id), a]));
  const containers = Array.isArray(overview.containers) ? overview.containers : [];
  const entityKind = new Map(containers.filter((c) => c.id).map((c) => [String(c.id), c.kind]));
  const cycleByAccount = (snap && snap.cycleByAccount) || new Map();
  const logoOf = (id) => (logos instanceof Map ? logos.get(String(id)) ?? null : null);
  const kindsOn = (k) => !!(phone && phone.kinds && phone.kinds[k] && phone.kinds[k].on);

  /* ---- the scopes ---- */
  const scopes = new Map();
  const scope = (key) => {
    if (scopes.has(key)) return scopes.get(key);
    let s;
    if (key.startsWith("biz:")) {
      const id = key.slice(4);
      const c = containers.find((x) => String(x.id) === id) || null;
      s = { key, kind: "business", name: (c && text(c.name)) || LOOSE_NAMES.business, entity_id: id };
    } else {
      s = { key, kind: key === "personal" ? "personal" : key === "business" ? "business" : "unknown", name: LOOSE_NAMES[key] || key, entity_id: null };
    }
    Object.assign(s, { payments: [], bills: [], smart: [] });
    scopes.set(key, s);
    return s;
  };
  scope("personal");
  for (const c of containers) if (c.id && c.kind === "business") scope(`biz:${c.id}`);

  const accountScope = (accountId) => {
    const a = accountById.get(String(accountId));
    return a ? scopeKeyOf(a.kind, a.container_id) : null;
  };
  /* An entity id the client still has, read by its own kind; else null. */
  const entityScope = (entityId) => {
    const k = entityId ? entityKind.get(String(entityId)) : null;
    return k ? scopeKeyOf(k, String(entityId)) : null;
  };
  const customScope = (row) => {
    if (row.scope === "personal") return "personal";
    return entityScope(row.entity_id) || "business";
  };

  /* ---- payments due: cards, credit lines, loans, plans, the client's own alerts ---- */
  const cardViewById = new Map((Array.isArray(cards) ? cards : []).map((c) => [String(c.account_id), c]));
  const phoneCards = new Map(((phone && phone.cards) || []).map((c) => [String(c.account_id), c]));
  const phoneLoans = new Map(((phone && phone.loans) || []).map((l) => [String(l.account_id), l]));
  const subtypeOf = (id) => (accountById.get(String(id)) || {}).subtype ?? null;
  const debt = overview.debt || {};

  for (const c of Array.isArray(debt.cards) ? debt.cards : []) {
    const id = String(c.account_id);
    const view = cardViewById.get(id) || {};
    const ph = phoneCards.get(id) || null;
    const line = isCreditLine(subtypeOf(id));
    scope(scopeKeyOf(c.kind, c.container_id)).payments.push({
      id: `card:${id}`,
      type: line ? "credit_line" : "card",
      name: cardWords(c),
      account_id: id,
      item_id: null,
      institution: (accountById.get(id) || {}).institution ?? null,
      logo: logoOf(id),
      due_on: c.due_on ?? null,
      amount_cents: toCentsOrNull(c.min_due_cents),
      amount_is: "minimum",
      close_on: view.pay_before ? view.pay_before.next_close_on ?? null : null,
      needs_close_day: view.statement_close_day === null || view.statement_close_day === undefined,
      late: false,
      phone: {
        on: kindsOn(line ? "credit_line_due" : "card_due"),
        alert_on: ph && ph.due ? ph.due.alert_on ?? null : null,
        reason: ph && ph.due ? ph.due.reason ?? null : null
      }
    });
  }

  for (const l of Array.isArray(debt.loans) ? debt.loans : []) {
    const id = String(l.account_id);
    const ph = phoneLoans.get(id) || null;
    const line = isCreditLine(subtypeOf(id));
    scope(scopeKeyOf(l.kind, l.container_id)).payments.push({
      id: `loan:${id}`,
      type: line ? "credit_line" : "loan",
      name: cardWords({ name: l.name || (line ? "Line of credit" : "Loan"), mask: l.mask }),
      account_id: id,
      item_id: null,
      institution: (accountById.get(id) || {}).institution ?? null,
      logo: logoOf(id),
      due_on: l.due_on ?? null,
      amount_cents: toCentsOrNull(l.payment_cents),
      amount_is: "payment",
      close_on: null,
      needs_close_day: false,
      late: false,
      phone: {
        on: kindsOn(line ? "credit_line_due" : "loan_due"),
        alert_on: ph && ph.due ? ph.due.alert_on ?? null : null,
        reason: ph && ph.due ? ph.due.reason ?? null : null
      }
    });
  }

  const planViews = new Map(((phone && phone.plans) || []).map((p) => [String(p.installment_id), p]));
  for (const row of Array.isArray(snap && snap.clarityPlans) ? snap.clarityPlans : []) {
    const pv = planViews.get(String(row.installment_id)) || {};
    const due = typeof row.due_on === "string" ? row.due_on.slice(0, 10) : null;
    scope(scopeKeyOf(CLARITY_CASH_KIND, null)).payments.push({
      id: `plan:${row.installment_id}`,
      type: "plan",
      name: planLabel(row),
      account_id: null,
      item_id: null,
      plan_id: row.plan_id ? String(row.plan_id) : null,
      institution: null,
      logo: null,
      due_on: due,
      amount_cents: toCentsOrNull(row.left_cents),
      amount_is: "left",
      close_on: null,
      needs_close_day: false,
      late: !!due && daysBetween(today, due) < 0,
      phone: { on: kindsOn("plan_due"), alert_on: pv.alert_on ?? null, reason: pv.reason ?? null }
    });
  }

  const customRows = Array.isArray(custom) ? custom : [];
  for (const it of customRows) {
    const target = scope(customScope(it));
    const ph = { on: it.phone_alert && kindsOn(it.kind === "bill" ? "custom_bill" : "custom_alert"),
      alert_on: it.phone ? it.phone.alert_on : null, reason: it.phone ? it.phone.reason : null, sent: it.phone ? it.phone.sent : null };
    if (it.kind === "alert") {
      target.payments.push({
        id: `custom:${it.id}`,
        type: "alert",
        name: it.name,
        account_id: null,
        item_id: it.id,
        institution: null,
        logo: null,
        due_on: it.next_on,
        amount_cents: it.amount_cents,
        amount_is: it.amount_cents === null ? null : "amount",
        cadence: it.cadence,
        close_on: null,
        needs_close_day: false,
        late: false,
        phone_alert: it.phone_alert !== false,
        phone: ph
      });
    } else {
      target.bills.push({
        id: `custom:${it.id}`,
        source: "added",
        bill_id: null,
        item_id: it.id,
        name: it.name,
        amount_cents: it.amount_cents,
        cadence: it.cadence,
        next_on: it.next_on,
        next_unknown_reason: it.next_on ? null : "no_next_date",
        phone_alert: it.phone_alert !== false,
        phone: ph
      });
    }
  }

  /* ---- bills the detector found ---- */
  const rawById = new Map((Array.isArray(billRows) ? billRows : []).map((r) => [String(r.id), r]));
  for (const b of Array.isArray(bills) ? bills : []) {
    const raw = rawById.get(String(b.id)) || {};
    const key = entityScope(raw.entity_id) || (b.bank_account_id ? accountScope(b.bank_account_id) : null) || "unknown";
    scope(key).bills.push({
      id: `bill:${b.id}`,
      source: "found",
      bill_id: String(b.id),
      item_id: null,
      name: b.name,
      amount_cents: b.typical_cents ?? null,
      cadence: b.cadence ?? null,
      next_on: b.next_expected_on ?? null,
      next_unknown_reason: b.next_unknown_reason ?? null,
      important: b.important === true,
      phone: {
        on: b.important === true && kindsOn("important_bill"),
        alert_on: b.phone ? b.phone.alert_on ?? null : null,
        reason: b.phone ? b.phone.reason ?? null : null,
        sent: b.phone ? b.phone.sent ?? null : null
      }
    });
  }

  /* ---- smart alerts ---- */
  // pay_by: every card that owes money, dated by AL's payBy() and, when it is over 10%,
  // told what to pay by AL's cardRule(). The same two functions the bundle uses, so the
  // board and a text can never say two different days or amounts.
  for (const c of Array.isArray(debt.cards) ? debt.cards : []) {
    const id = String(c.account_id);
    const balance = toCentsOrNull(c.balance_cents);
    if (balance !== null && balance <= 0) continue; // nothing owed, nothing to pay by
    const cycle = cycleByAccount.get(id) ?? null;
    const when = payBy(c, cycle, { today });
    if (!when.pay_by_on) continue; // no close day and no due date ahead: no guess
    const rule = cardRule(c, cycle, { today });
    const over = rule.state === "over";
    scope(scopeKeyOf(c.kind, c.container_id)).smart.push({
      id: `pay_by:${id}:${when.pay_by_on}`,
      kind: "pay_by",
      name: cardWords(c),
      account_id: id,
      logo: logoOf(id),
      institution: (accountById.get(id) || {}).institution ?? null,
      on: when.pay_by_on,
      for: when.for,
      close_on: when.closes_on,
      due_on: when.due_on,
      tight: when.tight,
      days_left: when.days_left,
      over,
      pay_cents: over ? rule.pay_to_target_cents : null,
      balance_cents: rule.balance_cents,
      limit_cents: rule.limit_cents,
      target_cents: rule.target_cents,
      used_pct: rule.used_pct
    });
  }

  // price_up and charged_twice: the bill cleanup's own flags, placed by the account that pays.
  const flags = cleanup && cleanup.ok !== false && Array.isArray(cleanup.flags) ? cleanup.flags : [];
  const shownName = new Map((Array.isArray(billRows) ? billRows : [])
    .map((r) => [`${r.bank_account_id} ${r.merchant_key}`, text(r.merchant_display)]));
  for (const f of flags) {
    if (f.kind !== "price_jump" && f.kind !== "double_charge") continue;
    const key = accountScope(f.bank_account_id) || scopeKeyOf(f.money_kind, null);
    const name = shownName.get(`${f.bank_account_id} ${f.merchant_key}`) || text(f.name) || "Repeat bill";
    const base = { id: String(f.key || `${f.kind}:${f.bank_account_id}:${f.on}`), name, on: f.on ?? null, bank_account_id: f.bank_account_id ?? null };
    scope(key).smart.push(f.kind === "price_jump"
      ? { ...base, kind: "price_up", from_cents: toCentsOrNull(f.from_cents), to_cents: toCentsOrNull(f.to_cents), change_cents: toCentsOrNull(f.change_cents) }
      : { ...base, kind: "charged_twice", amount_cents: toCentsOrNull(f.amount_cents), times: Array.isArray(f.charges) ? f.charges.length : 2 });
  }

  // cash_low: personal is the cash text's own verdict; each business scope is judged on its own.
  const personalLow = cashLow(reserve && reserve.personal, "personal");
  if (personalLow) scope("personal").smart.push(personalLow);
  const nowMs = Date.parse((snap && snap.asOf) || `${today}T00:00:00.000Z`);
  for (const s of scopes.values()) {
    if (s.kind !== "business") continue;
    const mine = accounts.filter((a) => scopeKeyOf(a.kind, a.container_id) === s.key);
    const verdict = evaluateReserve({
      kind: "business",
      cash: scopeCash(mine, "business"),
      debts: ((snap && snap.debts) || []).filter((d) => scopeKeyOf(d.kind, d.container_id) === s.key),
      clarityMonthlyCents: null,
      staleBalance: !!staleCashKinds({ accounts: mine }, (snap && snap.meta) || [], nowMs).business
    });
    const low = cashLow(verdict, s.key);
    if (low) s.smart.push(low);
  }

  // seasoning: an account on the plan that is still counting to seasoned.
  for (const r of Array.isArray(seasoning) ? seasoning : []) {
    const c = r.clock || {};
    if (c.milestone !== "seasoning" || !Number.isFinite(c.day) || !Number.isFinite(c.target_days)) continue;
    const key = entityScope(r.container_id) || (r.account_kind === "personal" ? "personal" : r.account_kind === "business" ? "business" : "unknown");
    scope(key).smart.push({
      id: `seasoning:${r.relationship_id || c.bank}`,
      kind: "seasoning",
      name: r.bank || "Your bank",
      on: c.seasoned_on ?? null,
      opened_on: c.opened_on ?? null,
      day: c.day,
      days_left: Math.max(0, c.target_days - c.day),
      target_days: c.target_days,
      logo: r.logo_path ?? null
    });
  }

  /* ---- order, and which scopes to show ---- */
  const out = [];
  for (const s of scopes.values()) {
    s.payments.sort(byDate("due_on"));
    s.bills.sort(byDate("next_on"));
    s.smart.sort((a, b) => (SMART_RANK[a.kind] - SMART_RANK[b.kind]) || byDate("on")(a, b));
    s.counts = { payments: s.payments.length, bills: s.bills.length, smart: s.smart.length };
    // Personal and every named business are made up front, so they always show; a loose
    // pile is only ever made by something going into it.
    out.push(s);
  }
  const rank = (s) => (s.key === "personal" ? 0 : s.key.startsWith("biz:") ? 1 : s.key === "business" ? 2 : 3);
  out.sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));
  const first = out.find((s) => s.counts.payments + s.counts.bills + s.counts.smart > 0);

  return {
    today,
    pay_by_days_before: PAY_BY_DAYS_BEFORE,
    default_scope: (first || out[0]).key,
    checks: {
      pay_by: true,
      cash: true,
      bills: Array.isArray(bills),
      custom: Array.isArray(custom),
      bill_cleanup: !!(cleanup && cleanup.ok !== false && Array.isArray(cleanup.flags)),
      seasoning: Array.isArray(seasoning)
    },
    scopes: out
  };
}

export default buildAlertBoard;
