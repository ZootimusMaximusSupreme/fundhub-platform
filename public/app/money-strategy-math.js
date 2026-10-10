/* money-strategy-math.js — the payment strategy math. ONE copy, two callers.
 *
 * FinanceOS wave 5, unit W4 (ops/workflows/finance-os-wave5-2026-10-06.md).
 * Owner, 2026-10-06: "real-time feedback on payment strategies; calculations
 * showing how to reduce payments and timelines to achieve goals."
 *
 * WHY THIS FILE LIVES IN public/app AND IS AN ES MODULE.
 * The slider on /app/money-strategy.html recomputes the whole plan on every
 * move. Asking the server on every move would hit the one production database
 * many times a second and still lag. So the browser runs this file directly
 * (money-strategy.js loads it with import()), and the server imports the SAME
 * file (src/finance/payment-strategy.mjs → ../../public/app/money-strategy-math.js).
 * One file means the browser and the server can never disagree. The server
 * never trusts the browser's numbers: "Save this plan" recomputes here, on the
 * server, from fresh database reads.
 *
 * It is `.js`, not `.mjs`, on purpose: public/_headers gives /app/*.js
 * `max-age=0, must-revalidate`, so a deploy can never leave an old copy of the
 * math in a browser while the server runs the new one. package.json is
 * "type": "module", so Node reads it as an ES module too.
 *
 * PURE. No DOM, no fetch, no clock, no randomness. `as_of` is an argument.
 *
 * RULES (docs/finance/client-finance-os-build-spec-2026-09-19.md §4c, §5):
 *   * Money is integer cents. Unknown is null, never 0.
 *   * A card with an unknown or $0 limit has NO utilization target. It is never
 *     "paid down to $0" because of a missing limit (the printed-report bug).
 *   * An unknown APR charges no interest in the math, and every date it can
 *     move is marked "at the earliest". Total interest is null, said in words.
 *   * An unknown balance takes the debt out of the plan, named, never as $0.
 *
 * THE TWO UTILIZATION TARGETS — read out of the engines, not chosen here:
 *   30%  src/underwrite/vendor/underwriter.cjs — UnderwriteIQ counts a file
 *        fundable only when utilization is 30 or less (`util <= 30`) and asks
 *        for `target_util_pct: 30` above it. src/underwrite/report.mjs restates
 *        it as ENGINE_THRESHOLDS.utilization_target_pct.
 *   10%  vendor/underwriteiq-full/api/lite/crs/optimization-findings.js —
 *        "Utilization target is always under 10%": UTIL_CARD_OVER_10 tells each
 *        card to get to 10% of its limit, UTIL_MODERATE / UTIL_OVERALL_HIGH tell
 *        the whole file to get under 10%. Fundhub's printed reports use the same
 *        10% (src/deliverables/derive.mjs targetBal, black-report-client.mjs
 *        util_target_balance).
 *
 * THE THREE METHODS. Each month every debt gets its minimum first, then the
 * rest of the monthly amount goes down a priority list that is set ONCE, at
 * the start:
 *   avalanche    highest APR first. A debt with no APR on file goes after every
 *                debt with one (it is never treated as 0% or as the highest).
 *   snowball     smallest balance first.
 *   utilization  each card down to 10% of its limit, highest utilization first
 *                — the same order and the same 10% target the existing paydown
 *                simulator uses (src/blueprint/paydown-simulator.mjs
 *                allocateCashToCards over src/deliverables/derive.mjs
 *                rankedRevolving). Once every card is at 10%, the rest goes
 *                highest APR first, exactly like avalanche.
 *
 * ASSUMPTIONS, said on the screen too:
 *   * Monthly interest = balance × APR ÷ 12, charged before the payment.
 *   * Each minimum stays at today's amount (never more than what is left).
 *   * No new charges on the cards.
 *   * Month k ends on the same day of the month as `as_of`, k months later
 *     (Oct 6 → Nov 6). A day past the end of a month uses its last day, the
 *     rule src/banking/statement-cycles.mjs already uses.
 */

export const MAX_MONTHS = 600; // 50 years. Past that the plan says "never".
export const METHODS = Object.freeze(["avalanche", "utilization", "snowball"]);
export const KINDS = Object.freeze(["personal", "business", "unknown"]);
export const GOAL_KINDS = Object.freeze(["debt_free", "util30", "util10"]);

export const TARGETS = Object.freeze([
  Object.freeze({
    pct: 30,
    key: "util30",
    label: "30%",
    meaning: "UnderwriteIQ counts a file fundable only when card use is 30% or less.",
    source: "src/underwrite/vendor/underwriter.cjs (fundable needs utilization 30 or less; target_util_pct 30)"
  }),
  Object.freeze({
    pct: 10,
    key: "util10",
    label: "10%",
    meaning: "UnderwriteIQ's target for every card and for the whole file: under 10%.",
    source: "vendor/underwriteiq-full/api/lite/crs/optimization-findings.js (\"Utilization target is always under 10%\"); src/deliverables/derive.mjs targetBal"
  })
]);

export const METHOD_INFO = Object.freeze({
  avalanche: Object.freeze({
    label: "Highest rate first",
    short: "Avalanche",
    detail: "Extra money goes to the debt with the highest APR. Saves the most interest.",
    source: "Owner direction 2026-10-06: avalanche = highest APR first"
  }),
  utilization: Object.freeze({
    label: "Card use first",
    short: "Utilization",
    detail: "Each card goes down to 10% of its limit, highest card use first. Then highest APR first.",
    source: "src/blueprint/paydown-simulator.mjs allocateCashToCards (highest utilization first, each card to its 10% target)"
  }),
  snowball: Object.freeze({
    label: "Smallest balance first",
    short: "Snowball",
    detail: "Extra money goes to the smallest balance. Closes debts sooner.",
    source: "Owner direction 2026-10-06: snowball = smallest balance first"
  })
});

/* ── small readers ─────────────────────────────────────────────────────── */

function int(v) {
  return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
}

function finite(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function text(v) {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/* ── dates: calendar days, UTC, 'YYYY-MM-DD' ───────────────────────────── */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** 'YYYY-MM-DD' → { y, m, d } for a real calendar date, else null. */
export function parseDay(iso) {
  const hit = DAY_RE.exec(typeof iso === "string" ? iso.trim() : "");
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const pad2 = (n) => String(n).padStart(2, "0");

/** `iso` plus k whole months. A day past the month's end uses its last day. */
export function addMonths(iso, k) {
  const p = parseDay(iso);
  if (!p) return null;
  const total = p.y * 12 + (p.m - 1) + k;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${y}-${pad2(m)}-${pad2(Math.min(p.d, daysInMonth(y, m)))}`;
}

/** How many whole plan months fit between `asOf` and `by` (0 when none). */
export function monthsUntil(asOf, by) {
  const a = parseDay(asOf);
  const b = parseDay(by);
  if (!a || !b) return null;
  let k = Math.max(0, (b.y - a.y) * 12 + (b.m - a.m));
  while (k > 0 && addMonths(asOf, k) > by) k -= 1;
  while (addMonths(asOf, k + 1) <= by) k += 1;
  return k;
}

/* ── the debts ─────────────────────────────────────────────────────────── */

/**
 * normalizeDebts(list) → { debts, excluded }
 *
 * One debt: { id, name, type: "card"|"loan", kind, container_id,
 *   balance_cents, limit_cents, apr_pct, apr_source, min_cents, due_on }.
 * An unknown balance takes the debt out of the plan and says why. An overpaid
 * card (negative balance) owes nothing and stays in, so its limit still counts
 * toward card use.
 */
export function normalizeDebts(list) {
  const debts = [];
  const excluded = [];
  const seen = new Set();
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r !== "object") continue;
    const id = text(r.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const type = r.type === "loan" ? "loan" : "card";
    const name = text(r.name) || (type === "loan" ? "Loan" : "Card");
    const kind = KINDS.includes(r.kind) ? r.kind : "unknown";
    const balance = int(r.balance_cents);
    if (balance === null) {
      excluded.push({ id, name, type, kind, reason: "balance_unknown" });
      continue;
    }
    const limit = type === "card" ? int(r.limit_cents) : null;
    const apr = finite(r.apr_pct);
    const aprOk = apr !== null && apr >= 0 && apr <= 100;
    const min = int(r.min_cents);
    debts.push({
      id,
      name,
      type,
      kind,
      container_id: text(r.container_id),
      balance_cents: Math.max(0, balance),
      limit_cents: limit,
      limit_state: limit === null ? "unknown" : limit > 0 ? "known" : "zero",
      apr_pct: aprOk ? apr : null,
      apr_bps: aprOk ? Math.round(apr * 100) : null,
      apr_source: aprOk ? text(r.apr_source) : null,
      min_cents: min !== null && min >= 0 ? min : null,
      due_on: parseDay(r.due_on) ? r.due_on : null
    });
  }
  return { debts, excluded };
}

/** The balance a card must reach to be at `pct` of its limit. Null without a
 *  positive limit — never "pay this card down to $0". */
export function targetCents(debt, pct) {
  if (!debt || debt.limit_state !== "known") return null;
  return Math.floor((debt.limit_cents * pct) / 100);
}

/** Monthly interest on a balance, in cents. Balance × APR ÷ 12, rounded. */
export function monthlyInterest(balanceCents, aprBps) {
  if (aprBps === null || aprBps === undefined || aprBps <= 0 || balanceCents <= 0) return 0;
  return Math.round((balanceCents * aprBps) / 120000);
}

/** Percent with one decimal, or null when there is no limit to divide by. */
function pct1(num, den) {
  return den > 0 ? Math.round((num * 1000) / den) / 10 : null;
}

/* ── the priority list ─────────────────────────────────────────────────── */

function byName(a, b) {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/* Unknown APR sorts after every known APR — it is not 0% and not the highest. */
function aprKey(d) {
  return d.apr_bps === null ? -1 : d.apr_bps;
}

function avalancheCmp(a, b) {
  if (aprKey(a) !== aprKey(b)) return aprKey(b) - aprKey(a);
  if (a.balance_cents !== b.balance_cents) return a.balance_cents - b.balance_cents;
  return byName(a, b);
}

function snowballCmp(a, b) {
  if (a.balance_cents !== b.balance_cents) return a.balance_cents - b.balance_cents;
  if (aprKey(a) !== aprKey(b)) return aprKey(b) - aprKey(a);
  return byName(a, b);
}

function utilizationCmp(a, b) {
  const ua = a.balance_cents / a.limit_cents;
  const ub = b.balance_cents / b.limit_cents;
  if (ua !== ub) return ua > ub ? -1 : 1;
  return byName(a, b);
}

/**
 * priorityList(debts, method) → [{ id, floor_cents, phase }]
 *
 * Extra money is poured down this list each month: into the first entry until
 * that debt reaches its floor, then the next. Set once, at the start.
 */
export function priorityList(debts, method) {
  const active = debts.filter((d) => d.balance_cents > 0);
  const avalanche = [...active].sort(avalancheCmp).map((d) => ({ id: d.id, floor_cents: 0, phase: "rate" }));
  if (method === "snowball") {
    return [...active].sort(snowballCmp).map((d) => ({ id: d.id, floor_cents: 0, phase: "balance" }));
  }
  if (method !== "utilization") return avalanche;
  const overTarget = active.filter((d) => d.type === "card" && d.limit_state === "known" &&
    d.balance_cents > targetCents(d, 10));
  const phase1 = overTarget.sort(utilizationCmp)
    .map((d) => ({ id: d.id, floor_cents: targetCents(d, 10), phase: "card_use" }));
  return [...phase1, ...avalanche];
}

/* ── one simulation ────────────────────────────────────────────────────── */

/**
 * run(debts, list, budget, { months, detail, asOf }) — the month-by-month walk.
 *
 * Each month: interest on what is owed, then every debt's minimum, then the
 * rest down `list`. Stops when everything is paid or after `months` months.
 * Returns ok:false (below_minimums) when the budget cannot cover the minimums.
 */
function run(debts, list, budget, { months = MAX_MONTHS, detail = false, asOf = null } = {}) {
  const n = debts.length;
  const index = new Map(debts.map((d, i) => [d.id, i]));
  const bal = debts.map((d) => d.balance_cents);
  const payoff = bal.map((b) => (b === 0 ? 0 : null));
  const interestBy = new Array(n).fill(0);
  const cards = [];
  for (let i = 0; i < n; i += 1) if (debts[i].limit_state === "known") cards.push(i);
  const den = cards.reduce((s, i) => s + debts[i].limit_cents, 0);
  const owedOnCards = () => cards.reduce((s, i) => s + bal[i], 0);

  /* Crossings: the first month a target is met. 0 = already met today. */
  const overall = {};
  const cardCross = {};
  const markCrossings = (k) => {
    if (den > 0) {
      const num = owedOnCards();
      for (const t of TARGETS) {
        if (overall[t.pct] === undefined && num * 100 <= t.pct * den) overall[t.pct] = k;
      }
    }
    for (const i of cards) {
      const id = debts[i].id;
      const c = cardCross[id] || (cardCross[id] = {});
      for (const t of TARGETS) {
        if (c[t.pct] === undefined && bal[i] <= targetCents(debts[i], t.pct)) c[t.pct] = k;
      }
    }
  };
  markCrossings(0);

  const rows = [];
  let month1 = null;
  let minimums1 = null;
  let interestTotal = 0;
  let debtFree = bal.every((b) => b === 0) ? 0 : null;

  for (let k = 1; k <= months && debtFree === null; k += 1) {
    const interest = new Array(n).fill(0);
    let interestMonth = 0;
    for (let i = 0; i < n; i += 1) {
      if (bal[i] <= 0) continue;
      const x = monthlyInterest(bal[i], debts[i].apr_bps);
      bal[i] += x;
      interest[i] = x;
      interestBy[i] += x;
      interestMonth += x;
    }
    interestTotal += interestMonth;

    const pay = new Array(n).fill(0);
    let required = 0;
    for (let i = 0; i < n; i += 1) {
      if (bal[i] <= 0) continue;
      const p = Math.min(debts[i].min_cents ?? 0, bal[i]);
      pay[i] = p;
      required += p;
    }
    if (required > budget) {
      return { ok: false, reason: { code: "below_minimums", minimums_cents: required, month: k } };
    }
    if (k === 1) minimums1 = required;
    for (let i = 0; i < n; i += 1) bal[i] -= pay[i];

    let extra = budget - required;
    let focus = null;
    for (const b of list) {
      if (extra <= 0) break;
      const i = index.get(b.id);
      const room = bal[i] - b.floor_cents;
      if (room <= 0) continue;
      const p = Math.min(room, extra);
      bal[i] -= p;
      pay[i] += p;
      extra -= p;
      if (focus === null) focus = b.id;
    }

    for (let i = 0; i < n; i += 1) if (payoff[i] === null && bal[i] === 0) payoff[i] = k;
    markCrossings(k);
    if (k === 1) month1 = debts.map((d, i) => ({ id: d.id, kind: d.kind, paid_cents: pay[i] }));
    if (bal.every((b) => b === 0)) debtFree = k;

    if (detail) {
      const paid = pay.reduce((s, p) => s + p, 0);
      const cardUse = {};
      for (const i of cards) cardUse[debts[i].id] = pct1(bal[i], debts[i].limit_cents);
      rows.push({
        n: k,
        end_on: asOf ? addMonths(asOf, k) : null,
        paid_cents: paid,
        interest_cents: interestMonth,
        owed_cents: bal.reduce((s, b) => s + b, 0),
        util_pct: pct1(owedOnCards(), den),
        card_util: cardUse,
        focus_id: focus,
        unused_cents: budget - paid,
        per: debts.map((d, i) => ({ id: d.id, paid_cents: pay[i], interest_cents: interest[i], end_cents: bal[i] }))
      });
    }
  }

  return {
    ok: true,
    reason: null,
    months_run: rows.length,
    rows,
    payoff: Object.fromEntries(debts.map((d, i) => [d.id, payoff[i]])),
    interest_by: Object.fromEntries(debts.map((d, i) => [d.id, interestBy[i]])),
    interest_cents: interestTotal,
    debt_free_month: debtFree,
    overall_cross: overall,
    card_cross: cardCross,
    month1,
    minimums_month1_cents: minimums1,
    util_den_cents: den,
    util_start_pct: pct1(cards.reduce((s, i) => s + debts[i].balance_cents, 0), den)
  };
}

/** The money that pays every debt off in month 1, interest included. */
export function payoffAllCents(debts) {
  return debts.reduce((s, d) => s + d.balance_cents + monthlyInterest(d.balance_cents, d.apr_bps), 0);
}

/** What the minimums take in month 1 (an unknown minimum counts as nothing). */
export function minimumsCents(debts) {
  return debts.reduce((s, d) => {
    if (d.balance_cents <= 0) return s;
    const owed = d.balance_cents + monthlyInterest(d.balance_cents, d.apr_bps);
    return s + Math.min(d.min_cents ?? 0, owed);
  }, 0);
}

/**
 * simulate(debts, { method, monthlyCents, asOf, months }) — the full schedule.
 * `debts` are normalizeDebts() output.
 */
export function simulate(debts, { method = "avalanche", monthlyCents, asOf, months = MAX_MONTHS } = {}) {
  const list = priorityList(debts, method);
  return run(debts, list, monthlyCents, { months, detail: true, asOf });
}

/** Month-1 payments, per debt and per kind, for one monthly amount. */
export function month1Payments(debts, method, monthlyCents) {
  const r = run(debts, priorityList(debts, method), monthlyCents, { months: 1 });
  if (!r.ok) return null;
  const owing = new Set(debts.filter((d) => d.balance_cents > 0).map((d) => d.id));
  const byKind = {};
  for (const p of r.month1 || []) {
    if (owing.has(p.id)) byKind[p.kind] = (byKind[p.kind] || 0) + p.paid_cents;
  }
  return { by_id: r.month1 || [], by_kind: byKind };
}

/* ── minimum payments only ─────────────────────────────────────────────── */

/**
 * minimumOnly(debts, { asOf }) — every debt pays only its own minimum, and a
 * paid-off debt's minimum is NOT moved to another one.
 */
export function minimumOnly(debts, { months = MAX_MONTHS } = {}) {
  const active = debts.filter((d) => d.balance_cents > 0);
  const noMin = active.filter((d) => d.min_cents === null);
  if (noMin.length) {
    return { ok: false, reason: { code: "minimum_unknown", ids: noMin.map((d) => d.id) } };
  }
  /* A stored $0 minimum is a real number (nothing is due this cycle), but it
     cannot stand in for every month to come. No comparison is better than one
     that says this debt is never paid. */
  const zeroMin = active.filter((d) => d.min_cents === 0);
  if (zeroMin.length) {
    return { ok: false, reason: { code: "minimum_zero", ids: zeroMin.map((d) => d.id) } };
  }
  let interest = 0;
  let last = 0;
  const never = [];
  const payoff = {};
  for (const d of active) {
    let bal = d.balance_cents;
    let k = 0;
    while (bal > 0 && k < months) {
      k += 1;
      const x = monthlyInterest(bal, d.apr_bps);
      bal += x;
      interest += x;
      bal -= Math.min(d.min_cents, bal);
    }
    if (bal > 0) {
      never.push(d.id);
      payoff[d.id] = null;
    } else {
      payoff[d.id] = k;
      last = Math.max(last, k);
    }
  }
  const aprUnknown = active.some((d) => d.apr_bps === null);
  return {
    ok: true,
    reason: null,
    payoff,
    never_ids: never,
    debt_free_month: never.length ? null : last,
    interest_cents: aprUnknown || never.length ? null : interest
  };
}

/* ── "at the earliest" ─────────────────────────────────────────────────── */

/**
 * A date is exact only if no debt with an unknown APR could have moved it.
 * An unknown-APR debt is charged no interest in the math, so it really owes
 * more than the math shows: it soaks up more of the extra money, and it is
 * paid off later. A date is therefore "at the earliest" when an unknown-APR
 * debt is the subject, sits ahead of the subject on the priority list, or was
 * paid off on or before that month. For card use overall, also when an
 * unknown-APR card is part of the card-use sum, or sits ahead of any card.
 * The debt-free date waits on every debt. This errs toward "at the earliest":
 * a date it calls exact is exact.
 */
function earliestTest(debts, sim, list) {
  const unknown = debts.filter((d) => d.balance_cents > 0 && d.apr_bps === null);
  const first = new Map();
  list.forEach((b, i) => { if (!first.has(b.id)) first.set(b.id, i); });
  const pos = (id) => (first.has(id) ? first.get(id) : Infinity);
  const cards = debts.filter((d) => d.limit_state === "known" && d.balance_cents > 0);
  return (month, { selfId = null, overall = false } = {}) => {
    if (!unknown.length) return false;
    if (selfId === null && !overall) return true;
    for (const x of unknown) {
      if (x.id === selfId) return true;
      const paid = sim.payoff[x.id];
      if (paid !== null && paid !== undefined && paid <= month) return true;
      if (selfId !== null && pos(x.id) < pos(selfId)) return true;
      if (overall && (x.limit_state === "known" || cards.some((c) => pos(x.id) < pos(c.id)))) return true;
    }
    return false;
  };
}

/* ── milestones (what becomes pins on the timeline) ────────────────────── */

/**
 * milestones(debts, sim, asOf) → [{ key, kind, debt_id, name, target_pct,
 *   target_cents, month, date, earliest }]
 *
 * Per card with a known limit: the month it gets under 30%, then under 10%.
 * Per debt: the month it is paid off. Overall: the month card use gets under
 * 30%, then 10%. Then debt-free. A step that lands in the same month as a
 * bigger one for the same debt is left out (paid off implies under 10%).
 */
export function milestones(debts, sim, asOf, method = "avalanche") {
  const out = [];
  const earliest = earliestTest(debts, sim, priorityList(debts, method));
  for (const d of debts) {
    if (d.balance_cents <= 0) continue;
    const steps = [];
    if (d.limit_state === "known") {
      for (const t of TARGETS) {
        const tgt = targetCents(d, t.pct);
        const m = sim.card_cross[d.id] ? sim.card_cross[d.id][t.pct] : undefined;
        if (d.balance_cents > tgt && m !== undefined && m > 0) {
          steps.push({ key: `${d.id}:${t.key}`, kind: "pay_down", target_pct: t.pct, target_cents: tgt, month: m });
        }
      }
    }
    const paid = sim.payoff[d.id];
    if (paid !== null && paid !== undefined && paid > 0) {
      steps.push({ key: `${d.id}:payoff`, kind: "pay_down", target_pct: null, target_cents: 0, month: paid });
    }
    steps.forEach((s, i) => {
      if (steps.slice(i + 1).some((later) => later.month === s.month)) return;
      out.push({
        ...s,
        debt_id: d.id,
        name: d.name,
        date: addMonths(asOf, s.month),
        earliest: earliest(s.month, { selfId: d.id })
      });
    });
  }
  const overallSteps = [];
  for (const t of TARGETS) {
    const m = sim.overall_cross[t.pct];
    if (m !== undefined && m > 0) {
      overallSteps.push({ key: `overall:${t.key}`, kind: "checkpoint", target_pct: t.pct, target_cents: null, month: m });
    }
  }
  overallSteps.forEach((s, i) => {
    if (overallSteps.slice(i + 1).some((later) => later.month === s.month)) return;
    out.push({ ...s, debt_id: null, name: null, date: addMonths(asOf, s.month), earliest: earliest(s.month, { overall: true }) });
  });
  if (sim.debt_free_month !== null && sim.debt_free_month > 0) {
    out.push({
      key: "debt_free", kind: "checkpoint", target_pct: null, target_cents: 0, debt_id: null, name: null,
      month: sim.debt_free_month, date: addMonths(asOf, sim.debt_free_month),
      earliest: earliest(sim.debt_free_month)
    });
  }
  /* Same month: the debt steps, then card use overall, then debt-free last. */
  const rank = (m) => (m.key === "debt_free" ? 2 : m.kind === "checkpoint" ? 1 : 0);
  return out.sort((a, b) => a.month - b.month || rank(a) - rank(b) ||
    String(a.key).localeCompare(String(b.key)));
}

/* ── goals: the least money a month that gets there by a date ─────────── */

/**
 * requiredMonthly(debts, { method, goal, asOf }) → { ok, monthly_cents,
 *   months_available, already_met, reason }
 *
 * goal: { kind: "debt_free"|"util30"|"util10", by: "YYYY-MM-DD" }.
 * The answer is rounded UP to whole dollars and checked by running the plan.
 */
export function requiredMonthly(debts, { method = "avalanche", goal, asOf } = {}) {
  const kind = goal && GOAL_KINDS.includes(goal.kind) ? goal.kind : null;
  if (!kind) return { ok: false, reason: { code: "no_goal" } };
  const n = monthsUntil(asOf, goal.by);
  if (n === null) return { ok: false, reason: { code: "goal_date_invalid" } };
  if (n < 1) return { ok: false, reason: { code: "goal_too_soon", months_available: n } };
  const months = Math.min(n, MAX_MONTHS);
  const active = debts.filter((d) => d.balance_cents > 0);
  if (!active.length) return { ok: true, monthly_cents: 0, months_available: months, already_met: true, reason: null };

  const list = priorityList(debts, method);
  let met;
  if (kind === "debt_free") {
    met = (b) => {
      const r = run(debts, list, b, { months });
      return r.ok && r.debt_free_month !== null;
    };
  } else {
    const pct = kind === "util30" ? 30 : 10;
    const cards = debts.filter((d) => d.limit_state === "known");
    if (!cards.length) return { ok: false, reason: { code: "no_limits" } };
    const den = cards.reduce((s, d) => s + d.limit_cents, 0);
    const num = cards.reduce((s, d) => s + d.balance_cents, 0);
    if (num * 100 <= pct * den) {
      return { ok: true, monthly_cents: minimumsCents(debts), months_available: months, already_met: true, reason: null };
    }
    met = (b) => {
      const r = run(debts, list, b, { months });
      return r.ok && r.overall_cross[pct] !== undefined;
    };
  }

  const toDollars = (c) => Math.ceil(c / 100);
  let lo = toDollars(minimumsCents(debts));
  let hi = toDollars(payoffAllCents(debts)) + 1;
  if (met(lo * 100)) {
    return { ok: true, monthly_cents: lo * 100, months_available: months, already_met: false, reason: null };
  }
  if (!met(hi * 100)) return { ok: false, reason: { code: "goal_unreachable" } };
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (met(mid * 100)) hi = mid; else lo = mid;
  }
  return { ok: true, monthly_cents: hi * 100, months_available: months, already_met: false, reason: null };
}

/* ── cash safety: the most that can leave this month ───────────────────── */

/**
 * maxSafeMonthly(debts, { method, safeByKind }) → { monthly_cents, unlimited,
 *   binding_kind, reason }
 *
 * safeByKind: { business: 1845000, personal: 153055 } — the most each kind's
 * cash can send to its own debts in the first month without going below zero,
 * worked out on the server by src/banking/cashflow.mjs. A kind that is not in
 * the map is not checked, so it does not limit the answer.
 *
 * The answer is the biggest monthly amount whose month-1 payments fit every
 * checked kind. Null (with minimums_not_safe) when even the minimums do not.
 */
export function maxSafeMonthly(debts, { method = "avalanche", safeByKind = {} } = {}) {
  const kinds = Object.keys(safeByKind || {}).filter((k) => int(safeByKind[k]) !== null);
  const list = priorityList(debts, method);
  const fits = (b) => {
    const r = run(debts, list, b, { months: 1 });
    if (!r.ok) return { ok: false, kind: null };
    const byKind = {};
    for (const p of r.month1) byKind[p.kind] = (byKind[p.kind] || 0) + p.paid_cents;
    for (const k of kinds) {
      if ((byKind[k] || 0) > safeByKind[k]) return { ok: false, kind: k, over_by: byKind[k] - safeByKind[k] };
    }
    return { ok: true };
  };
  const low = minimumsCents(debts);
  const high = payoffAllCents(debts);
  const atLow = fits(low);
  if (!atLow.ok) {
    return { monthly_cents: null, unlimited: false, binding_kind: atLow.kind,
      reason: { code: "minimums_not_safe", kind: atLow.kind, over_by_cents: atLow.over_by ?? null } };
  }
  if (fits(high).ok) return { monthly_cents: high, unlimited: true, binding_kind: null, reason: null };
  let lo = low;
  let hi = high;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (fits(mid).ok) lo = mid; else hi = mid;
  }
  const binding = fits(hi);
  return { monthly_cents: lo, unlimited: false, binding_kind: binding.kind ?? null, reason: null };
}

/**
 * cashCheck(debts, { method, monthlyCents, cash }) — this month's payments per
 * kind against what that kind's cash can cover. Personal cash never pays a
 * business debt in this check, and the two are never added together.
 *
 * cash.by_kind[k]: { ok: true, safe_cents } or { ok: false, code, message }.
 */
export function cashCheck(debts, { method = "avalanche", monthlyCents, cash } = {}) {
  const pay = month1Payments(debts, method, monthlyCents);
  const byKindCash = (cash && cash.by_kind) || {};
  const kinds = KINDS.filter((k) => debts.some((d) => d.kind === k && d.balance_cents > 0));
  const rows = kinds.map((k) => {
    const planned = pay ? pay.by_kind[k] || 0 : null;
    const c = byKindCash[k];
    if (!c || c.ok !== true || int(c.safe_cents) === null) {
      return {
        kind: k, status: "unknown", planned_cents: planned, safe_cents: null,
        reason: c && c.ok === false
          ? { code: c.code || "refused", message: c.message || null }
          : { code: "not_checked", message: null }
      };
    }
    if (planned !== null && planned > c.safe_cents) {
      return { kind: k, status: "over", planned_cents: planned, safe_cents: c.safe_cents, over_by_cents: planned - c.safe_cents, reason: null };
    }
    return { kind: k, status: "safe", planned_cents: planned, safe_cents: c.safe_cents, reason: null };
  });
  const safeByKind = {};
  for (const r of rows) if (r.status !== "unknown") safeByKind[r.kind] = r.safe_cents;
  const max = maxSafeMonthly(debts, { method, safeByKind });
  const status = rows.some((r) => r.status === "over") ? "over"
    : rows.length && rows.every((r) => r.status === "unknown") ? "unknown"
      : rows.some((r) => r.status === "unknown") ? "partial" : "safe";
  return { status, by_kind: rows, max_safe: max };
}

/* ── the whole plan ────────────────────────────────────────────────────── */

/**
 * buildPlan(inputs, settings) — everything the page and the server need.
 *
 * inputs:   { as_of, debts: [...], excluded?: [...], cash?: { by_kind } }
 * settings: { method, monthly_cents, goal?: { kind, by } }
 */
export function buildPlan(inputs, settings = {}) {
  const asOf = inputs && parseDay(inputs.as_of) ? inputs.as_of : null;
  const method = METHODS.includes(settings.method) ? settings.method : "avalanche";
  const { debts, excluded } = normalizeDebts(inputs && inputs.debts);
  const allExcluded = [...excluded, ...(Array.isArray(inputs && inputs.excluded) ? inputs.excluded : [])];
  const active = debts.filter((d) => d.balance_cents > 0);
  const monthly = int(settings.monthly_cents);
  const base = {
    as_of: asOf,
    method,
    monthly_cents: monthly,
    debts,
    excluded: allExcluded,
    minimums_cents: minimumsCents(debts),
    payoff_all_cents: payoffAllCents(debts),
    warnings: warningsFor(debts)
  };
  if (!asOf) return { ok: false, reason: { code: "as_of_invalid" }, ...base };
  if (!active.length) return { ok: false, reason: { code: "no_debts" }, ...base };
  if (monthly === null || monthly <= 0) return { ok: false, reason: { code: "no_amount" }, ...base };

  const sim = simulate(debts, { method, monthlyCents: monthly, asOf });
  if (!sim.ok) return { ok: false, reason: sim.reason, ...base };

  const order = priorityList(debts, method);
  const earliest = earliestTest(debts, sim, order);
  const aprUnknown = active.filter((d) => d.apr_bps === null);
  const debtFree = sim.debt_free_month === null ? null : {
    month: sim.debt_free_month,
    on: addMonths(asOf, sim.debt_free_month),
    earliest: earliest(sim.debt_free_month)
  };
  const baseline = minimumOnly(debts);
  let interestSaved = null;
  let interestSavedReason = null;
  if (aprUnknown.length) interestSavedReason = { code: "apr_unknown", ids: aprUnknown.map((d) => d.id) };
  else if (!baseline.ok) interestSavedReason = baseline.reason;
  else if (baseline.never_ids.length) interestSavedReason = { code: "never_pays_off_at_minimums", ids: baseline.never_ids };
  else if (debtFree === null) interestSavedReason = { code: "plan_never_pays_off" };
  else interestSaved = baseline.interest_cents - sim.interest_cents;

  const monthsSaved = interestSaved !== null && baseline.debt_free_month !== null && debtFree
    ? baseline.debt_free_month - debtFree.month : null;

  const crossings = TARGETS.map((t) => {
    const m = sim.overall_cross[t.pct];
    return {
      pct: t.pct,
      key: t.key,
      month: m === undefined ? null : m,
      on: m === undefined ? null : m === 0 ? asOf : addMonths(asOf, m),
      already: m === 0,
      earliest: m === undefined || m === 0 ? false : earliest(m, { overall: true })
    };
  });

  const perDebt = debts.map((d) => {
    const m = sim.payoff[d.id];
    const cross = {};
    for (const t of TARGETS) {
      const c = sim.card_cross[d.id] ? sim.card_cross[d.id][t.pct] : undefined;
      cross[t.key] = d.limit_state !== "known" ? null : {
        target_cents: targetCents(d, t.pct),
        month: c === undefined ? null : c,
        on: c === undefined ? null : c === 0 ? asOf : addMonths(asOf, c),
        already: c === 0
      };
    }
    return {
      id: d.id,
      payoff_month: m === undefined ? null : m,
      payoff_on: m === null || m === undefined ? null : m === 0 ? asOf : addMonths(asOf, m),
      earliest: m === null || m === undefined || m === 0 ? false : earliest(m, { selfId: d.id }),
      interest_cents: d.apr_bps === null ? null : sim.interest_by[d.id],
      start_util_pct: d.limit_state === "known" ? pct1(d.balance_cents, d.limit_cents) : null,
      cross
    };
  });

  const goal = settings.goal && GOAL_KINDS.includes(settings.goal.kind)
    ? { kind: settings.goal.kind, by: settings.goal.by, ...requiredMonthly(debts, { method, goal: settings.goal, asOf }) }
    : null;
  const cash = inputs.cash ? cashCheck(debts, { method, monthlyCents: monthly, cash: inputs.cash }) : null;
  if (goal && goal.ok && cash && cash.max_safe && cash.max_safe.monthly_cents !== null && !cash.max_safe.unlimited) {
    goal.fits_cash = goal.monthly_cents <= cash.max_safe.monthly_cents;
  } else if (goal && goal.ok && cash && cash.max_safe && cash.max_safe.unlimited) {
    goal.fits_cash = true;
  } else if (goal) {
    goal.fits_cash = null;
  }

  return {
    ok: true,
    reason: null,
    ...base,
    order,
    months: sim.rows,
    debt_free: debtFree,
    never_paid_off: debtFree === null,
    interest_cents: aprUnknown.length ? null : sim.interest_cents,
    interest_known_cents: sim.interest_cents,
    apr_unknown_ids: aprUnknown.map((d) => d.id),
    baseline: {
      ok: baseline.ok,
      reason: baseline.reason,
      debt_free_month: baseline.ok ? baseline.debt_free_month : null,
      debt_free_on: baseline.ok && baseline.debt_free_month !== null ? addMonths(asOf, baseline.debt_free_month) : null,
      interest_cents: baseline.ok ? baseline.interest_cents : null,
      never_ids: baseline.ok ? baseline.never_ids : []
    },
    interest_saved_cents: interestSaved,
    interest_saved_reason: interestSavedReason,
    months_saved: monthsSaved,
    util_start_pct: sim.util_start_pct,
    crossings,
    per_debt: perDebt,
    goal,
    cash,
    milestones: milestones(debts, sim, asOf, method)
  };
}

/** What is missing, so the page can say it in words. */
export function warningsFor(debts) {
  const active = debts.filter((d) => d.balance_cents > 0);
  const out = [];
  const apr = active.filter((d) => d.apr_bps === null);
  if (apr.length) out.push({ code: "apr_unknown", ids: apr.map((d) => d.id), names: apr.map((d) => d.name) });
  const min = active.filter((d) => d.min_cents === null);
  if (min.length) out.push({ code: "minimum_unknown", ids: min.map((d) => d.id), names: min.map((d) => d.name) });
  const lim = active.filter((d) => d.type === "card" && d.limit_state !== "known");
  if (lim.length) out.push({ code: "limit_unknown", ids: lim.map((d) => d.id), names: lim.map((d) => d.name) });
  return out;
}
