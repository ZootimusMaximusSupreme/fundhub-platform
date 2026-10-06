// Money overview — the one read behind the client's Finance OS dashboard
// (GET /api/money/overview, page /app/money.html).
//
// THE JSON SHAPE IS A CONTRACT. It is written out on the build board,
// ops/workflows/finance-os-build-2026-10-06.md, and the page is built against it.
// Change a key here and the page breaks.
//
// WHAT THIS FILE ADDS IS THE JOIN, NOT NEW MATH. Every rule below already has an
// owner, and this file calls that owner:
//
//   cash per kind, never combined     src/finance/banking-surface.mjs
//   "a total with a hole is a floor"  src/finance/os-grid.mjs (sumKnown)
//   next due date from a due day      src/banking/statement-cycles.mjs
//                                     (an exact provider date wins — see cards)
//   which bills are safe to show      src/banking/cashflow-seam.mjs (PROJECTABLE_LABELS)
//   the tip sentence                  src/underwrite/* — the same engine calls
//                                     api/read/underwrite.mjs makes, word for word
//
// RULES (from docs/finance/client-finance-os-build-spec-2026-09-19.md §4, §4b,
// §4c, §5 and the 2026-10-06 owner direction):
//
//   * Money is integer cents.
//   * Unknown is null, never 0. A sum with a missing part says `is_floor: true`.
//   * Cash is NEVER added across personal / business / unknown.
//   * Debt MAY add across kinds into one total (owner asked for a global number).
//   * No full account numbers. A mask is the last four, at most.
//
// CHOICES MADE HERE, SO NOBODY HAS TO GUESS:
//
//   * CARDS are open `bank_accounts` rows with account_type = 'credit'. The
//     credit-file `tradelines` are NOT merged in: the existing math never merges
//     the two (money-map reads cards from tradelines only, the banking surface
//     reads bank_accounts only), and adding one card from each would count the
//     same card twice. Loans are not in the debt numbers yet — the contract has
//     no loan row.
//   * CASHFLOW counts depository accounts only (checking, savings). Paying a card
//     from checking is money out of checking AND money into the card; counting
//     both would double every card payment. Card spending shows up when the card
//     is paid.
//   * The KIND of an account is its container's kind when it sits in one
//     (entities, migration 106), else its stored entity_kind. 'unknown' is never
//     folded into personal.
//   * Closed accounts are left out of every number and list.
//   * An overpaid card (negative balance) owes 0 in the debt sums; its own row
//     still shows the real balance.
//
// moneyOverview(db, …) does the reads. buildMoneyOverview(…) is pure — no I/O,
// no clock — so every rule above is tested without Postgres.

import { bankingSurface, readEntityKind, ENTITY_KINDS } from "./banking-surface.mjs";
import { sumKnown } from "./os-grid.mjs";
import { nextDueDate, daysBetween } from "../banking/statement-cycles.mjs";
import { PROJECTABLE_LABELS } from "../banking/cashflow-seam.mjs";
import { computeUnderwrite, buildSuggestions } from "../underwrite/engine.mjs";
import { toBureaus } from "../underwrite/adapter.mjs";
import { applyStackedBusinessFunding } from "../underwrite/business-funding.mjs";
import { buildReport } from "../underwrite/report.mjs";
import { evaluateUtilization } from "../alerts/evaluate.mjs";
import { linesForEngine } from "../tradelines/index.mjs";

/* How far ahead "upcoming" looks, and how far back the month chart goes. */
export const UPCOMING_DAYS = 30;
export const CASHFLOW_MONTHS = 12;

/* Names for the "no container yet" piles. Not "Other": unknown means a decision
   has not been made, and that is the thing somebody has to act on. */
const LOOSE_NAMES = { personal: "Personal", business: "Business", unknown: "Not sorted yet" };

/* ------------------------------------------------------------------ *
 * Readers. Every one turns "absent" into null, never into 0.
 * ------------------------------------------------------------------ */

/* pg hands back bigint and numeric as STRINGS. Anything not a finite number
   after conversion is unknown. */
function cents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

const text = (v) => (v === null || v === undefined || v === "" ? null : String(v));

/* 'YYYY-MM-DD' only. Anything else is an unknown date. */
function isoDay(v) {
  const s = text(v);
  if (s === null) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

/* Last four, never more. 081 already stores a mask only, but a bank that hands
   over a longer string must not have it passed through here. */
function lastFour(v) {
  const s = text(v);
  if (s === null) return null;
  return s.length <= 4 ? s : s.slice(-4);
}

/* A $ amount, from a positive-or-negative owed balance: what is owed. */
const owed = (balance) => (balance === null ? null : Math.max(0, balance));

/* 'YYYY-MM' n months before another 'YYYY-MM'. */
function monthMinus(ym, n) {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) - n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function monthRange(fromYm, toYm) {
  const out = [];
  for (let ym = fromYm, guard = 0; ym <= toYm && guard < 600; guard++) {
    out.push(ym);
    const [y, m] = ym.split("-").map(Number);
    ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  }
  return out;
}

const SANDBOX = /plaid sandbox/i;

/* ------------------------------------------------------------------ *
 * The pure builder
 * ------------------------------------------------------------------ */

/**
 * buildMoneyOverview — stored rows → the contract shape.
 *
 * @param {object} input
 * @param {object} input.client          { id, first_name, last_name }
 * @param {string} input.asOf            ISO timestamp. The day is its UTC date.
 * @param {Array}  input.accounts        bank_accounts rows (+ institution_name)
 * @param {Array}  input.entities        entities rows, archived already left out
 * @param {Array}  input.txMonths        [{ bank_account_id, month, in_cents, out_cents }]
 *                                       posted, not pending, already summed per month
 * @param {Array}  input.bills           recurring_bills rows (medium/high only)
 * @param {Array}  input.cycles          account_statement_cycles rows
 * @param {Array}  input.liabilities     card_liabilities rows, newest first. Only rows
 *                                       that carry a bank_account_id can match a card.
 * @param {number|null} input.pricePerContainerCents
 * @param {string|null} input.tip        an engine sentence, verbatim, or null
 */
export function buildMoneyOverview({
  client,
  asOf,
  accounts = [],
  entities = [],
  txMonths = [],
  bills = [],
  cycles = [],
  liabilities = [],
  pricePerContainerCents = null,
  tip = null
} = {}) {
  const asOfIso = new Date(asOf).toISOString();
  const today = asOfIso.slice(0, 10);

  const ents = (Array.isArray(entities) ? entities : []).filter((e) => e && e.id);
  const entById = new Map(ents.map((e) => [String(e.id), e]));

  /* One view per OPEN account, with its kind and container settled once. */
  const open = (Array.isArray(accounts) ? accounts : []).filter((a) => a && a.id && !a.closed_at);
  const views = open.map((a) => {
    const ent = a.entity_id ? entById.get(String(a.entity_id)) ?? null : null;
    const kind = ent ? readEntityKind(ent.kind) : readEntityKind(a.entity_kind);
    return {
      row: a,
      id: String(a.id),
      name: text(a.name) || text(a.official_name),
      mask: lastFour(a.mask),
      type: text(a.account_type),
      subtype: text(a.account_subtype),
      kind,
      container_id: ent ? String(ent.id) : null,
      institution: text(a.institution_name),
      current: cents(a.current_balance_cents),
      available: cents(a.available_balance_cents),
      limit: cents(a.credit_limit_cents),
      provider: text(a.provider)
    };
  });
  const viewById = new Map(views.map((v) => [v.id, v]));

  /* ---- cash: the banking surface's groups, with the kind we settled ---- */
  const surface = bankingSurface(views.map((v) => ({ ...v.row, entity_kind: v.kind })));
  const cash = {};
  for (const g of surface.groups) {
    cash[g.key] = {
      cents: g.current.value,
      is_floor: g.current.basis.partial,
      accounts: g.current.basis.lines
    };
  }

  /* ---- containers ---- */
  const containers = ents.map((e) => ({
    id: String(e.id),
    kind: readEntityKind(e.kind),
    name: text(e.name),
    accounts: views.filter((v) => v.container_id === String(e.id)).length
  }));
  for (const k of ENTITY_KINDS) {
    const loose = views.filter((v) => v.container_id === null && v.kind === k).length;
    if (loose > 0) containers.push({ id: null, kind: k, name: LOOSE_NAMES[k], accounts: loose });
  }

  /* ---- cards and debt ---- */
  const cycleByAccount = new Map();
  for (const c of Array.isArray(cycles) ? cycles : []) {
    if (c && c.bank_account_id) cycleByAccount.set(String(c.bank_account_id), c);
  }
  const liabilityByAccount = new Map();
  for (const l of Array.isArray(liabilities) ? liabilities : []) {
    const k = l && l.bank_account_id ? String(l.bank_account_id) : null;
    // Newest first on the way in, so the first one seen wins.
    if (k && !liabilityByAccount.has(k)) liabilityByAccount.set(k, l);
  }

  const cards = views.filter((v) => v.type === "credit").map((v) => {
    const cycle = cycleByAccount.get(v.id) ?? null;
    const liab = liabilityByAccount.get(v.id) ?? null;
    const balance = v.current;
    const limit = v.limit;
    const bothKnown = balance !== null && limit !== null;
    /* A $0 or unknown limit gives no room and no percent — never "pay to $0". */
    const room = bothKnown ? Math.max(0, limit - balance) : null;
    const usedPct = bothKnown && limit > 0
      ? Math.round((Math.max(0, balance) / limit) * 1000) / 10
      : null;
    /* An exact due date a provider stored beats one worked out from a due day.
       Plaid's liabilities read (Unit C) stores it on the statement-cycle row as
       raw.next_payment_due_date; a card_liabilities row linked by
       bank_account_id would carry payment_due_date. Neither → the due day. */
    const cycleRaw = cycle?.raw && typeof cycle.raw === "object" ? cycle.raw : {};
    const dueOn = isoDay(liab?.payment_due_date)
      ?? isoDay(cycleRaw.next_payment_due_date)
      ?? (cycle ? nextDueDate(cycle, { today }).dueOn : null);
    return {
      account_id: v.id,
      name: v.name,
      mask: v.mask,
      container_id: v.container_id,
      kind: v.kind,
      balance_cents: balance,
      limit_cents: limit,
      room_cents: room,
      used_pct: usedPct,
      due_on: dueOn,
      min_due_cents: cents(liab?.minimum_payment_cents) ?? cents(cycle?.minimum_payment_cents),
      past_due_cents: cents(liab?.past_due_cents)
    };
  });

  const total = sumKnown(cards.map((c) => owed(c.balance_cents)));
  const byKind = {};
  for (const k of ENTITY_KINDS) {
    byKind[k] = sumKnown(cards.filter((c) => c.kind === k).map((c) => owed(c.balance_cents))).total;
  }

  const byContainer = [];
  const pile = (container_id, name, kind, list) => {
    if (!list.length) return;
    const s = sumKnown(list.map((c) => owed(c.balance_cents)));
    byContainer.push({ container_id, name, kind, owed_cents: s.total, is_floor: s.unknown > 0 });
  };
  for (const e of ents) {
    pile(String(e.id), text(e.name), readEntityKind(e.kind), cards.filter((c) => c.container_id === String(e.id)));
  }
  for (const k of ENTITY_KINDS) {
    pile(null, LOOSE_NAMES[k], k, cards.filter((c) => c.container_id === null && c.kind === k));
  }

  /* ---- cashflow by month, depository only, kinds kept apart ---- */
  const asOfMonth = today.slice(0, 7);
  const windowStart = monthMinus(asOfMonth, CASHFLOW_MONTHS - 1);
  const buckets = new Map(); // month -> kind -> { in, out } (null = no rows)
  let earliest = null;
  for (const t of Array.isArray(txMonths) ? txMonths : []) {
    const v = viewById.get(String(t?.bank_account_id));
    const month = text(t?.month);
    if (!v || v.type !== "depository" || !month || month < windowStart || month > asOfMonth) continue;
    const inC = cents(t.in_cents);
    const outC = cents(t.out_cents);
    if (inC === null && outC === null) continue;
    if (earliest === null || month < earliest) earliest = month;
    const m = buckets.get(month) ?? {};
    const b = m[v.kind] ?? { in: null, out: null };
    if (inC !== null) b.in = (b.in ?? 0) + inC;
    if (outC !== null) b.out = (b.out ?? 0) + Math.abs(outC);
    m[v.kind] = b;
    buckets.set(month, m);
  }
  const months = earliest === null ? [] : monthRange(earliest, asOfMonth).map((month) => {
    const m = buckets.get(month) ?? {};
    const row = { month };
    for (const k of ENTITY_KINDS) {
      row[k] = { in_cents: m[k]?.in ?? null, out_cents: m[k]?.out ?? null };
    }
    return row;
  });

  /* ---- bills ---- */
  const billRows = (Array.isArray(bills) ? bills : [])
    .filter((b) => b && PROJECTABLE_LABELS.includes(b.confidence_label))
    .map((b) => {
      const ent = b.entity_id ? entById.get(String(b.entity_id)) ?? null : null;
      const acct = viewById.get(String(b.bank_account_id)) ?? null;
      const amt = cents(b.typical_amount_cents);
      return {
        name: text(b.merchant_display) || text(b.merchant_key),
        // 086 stores a bill as a NEGATIVE number. A person reads the size.
        amount_cents: amt === null ? null : Math.abs(amt),
        cadence: text(b.cadence),
        next_on: isoDay(b.next_expected_on),
        kind: ent ? readEntityKind(ent.kind) : acct ? acct.kind : "unknown",
        container_id: ent ? String(ent.id) : acct ? acct.container_id : null
      };
    })
    .sort((a, b) => (a.next_on ?? "9999") < (b.next_on ?? "9999") ? -1
      : (a.next_on ?? "9999") > (b.next_on ?? "9999") ? 1
        : String(a.name).localeCompare(String(b.name)));

  /* ---- upcoming: the next 30 days, dates that have passed left out ---- */
  const soon = (d) => {
    if (!d) return false;
    const n = daysBetween(today, d);
    return n !== null && n >= 0 && n < UPCOMING_DAYS;
  };
  const upcoming = [
    ...cards.filter((c) => soon(c.due_on))
      .map((c) => ({ type: "card_due", name: c.name, on: c.due_on, amount_cents: c.min_due_cents })),
    ...billRows.filter((b) => soon(b.next_on))
      .map((b) => ({ type: "bill", name: b.name, on: b.next_on, amount_cents: b.amount_cents }))
  ].sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));

  const first = text(client?.first_name);
  const last = text(client?.last_name);

  return {
    ok: true,
    client: { id: text(client?.id), name: [first, last].filter(Boolean).join(" ") || null },
    as_of: asOfIso,
    sandbox: views.some((v) => (v.institution && SANDBOX.test(v.institution)) || v.provider === "mock"),
    containers,
    cash,
    debt: {
      total_cents: total.total,
      is_floor: total.unknown > 0,
      by_kind: byKind,
      by_container: byContainer,
      cards
    },
    accounts: views.map((v) => ({
      id: v.id,
      name: v.name,
      mask: v.mask,
      type: v.type,
      subtype: v.subtype,
      kind: v.kind,
      container_id: v.container_id,
      institution: v.institution,
      current_cents: v.current,
      available_cents: v.available,
      limit_cents: v.limit,
      provider: v.provider
    })),
    cashflow: { has_transactions: months.length > 0, months },
    bills: billRows,
    upcoming,
    billing: { containers: ents.length, price_per_container_cents: pricePerContainerCents },
    tip
  };
}

/* ------------------------------------------------------------------ *
 * Tip — one UnderwriteIQ sentence, verbatim
 * ------------------------------------------------------------------ */

/**
 * pickTip — one sentence out of the engine's annotated suggestions, or null.
 *
 * Pay-down first (the owner's example: "bring balances down"), then any other
 * sentence. A sentence that rests on a number nobody entered is skipped, and the
 * engine's fallback lines ("You're close to approval…") are skipped too — on a
 * file with nothing in it they would be a confident line on empty data.
 * The text is returned exactly as the engine wrote it.
 */
export function pickTip(suggestions = []) {
  const usable = (Array.isArray(suggestions) ? suggestions : []).filter((s) =>
    s && s.recognised !== false && s.restsOnMissingData !== true &&
    s.topic !== "fallback" && typeof s.text === "string" && s.text);
  const pay = usable.find((s) => s.topic === "utilization");
  return (pay ?? usable[0])?.text ?? null;
}

/* The same reads and the same four engine calls as api/read/underwrite.mjs, in
   the same order, so the sentence here is the one that endpoint returns. Any
   failure is "no tip", never a broken dashboard. */
export async function underwriteTip(db, { orgId, clientId, customFields = {} }) {
  try {
    const [tradelinesRes, liabilitiesRes, crsRes, businessesRes] = await Promise.all([
      db.query(
        `SELECT * FROM tradelines WHERE client_id = $1 AND org_id = $2
          ORDER BY apr ASC NULLS LAST, lender ASC`, [clientId, orgId]),
      db.query(
        `SELECT * FROM card_liabilities WHERE client_id = $1 AND org_id = $2
          ORDER BY as_of DESC`, [clientId, orgId]),
      db.query(
        `SELECT id, result, created_at FROM crs_results WHERE client_id = $1 AND org_id = $2
          ORDER BY created_at DESC`, [clientId, orgId]),
      db.query(
        `SELECT age_months FROM businesses WHERE client_id = $1 AND org_id = $2
          ORDER BY created_at ASC`, [clientId, orgId])
    ]);
    const { tradelines } = linesForEngine(tradelinesRes.rows, crsRes.rows);
    // Nothing on file at all: every sentence would rest on empty data.
    if (tradelines.length === 0 && crsRes.rows.length === 0) return null;

    const adapter = toBureaus({
      tradelines,
      liabilities: liabilitiesRes.rows,
      crsResults: crsRes.rows,
      customFields: customFields || {},
      businesses: businessesRes.rows
    });
    const underwrite = applyStackedBusinessFunding(
      computeUnderwrite(adapter.bureaus, adapter.businessAgeMonths),
      adapter.businessAges
    );
    const suggestions = buildSuggestions(underwrite, {
      hasLLC: adapter.hasLLC,
      llcAgeMonths: adapter.llcAgeMonths ?? 0
    });
    const report = buildReport({
      underwrite, suggestions, adapter, fundhubUtilization: evaluateUtilization(tradelines)
    });
    return pickTip(report.suggestions);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * The read
 * ------------------------------------------------------------------ */

/* FINANCE_OS_PRICE_PER_CONTAINER_CENTS — whole cents, or null ("price not set"). */
export function readPricePerContainer(env = {}) {
  const raw = text(env?.FINANCE_OS_PRICE_PER_CONTAINER_CENTS);
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw.trim());
  return Number.isSafeInteger(n) ? n : null;
}

/* SELECTED COLUMNS. plaid_items.encrypted_access_token is one join away and a
   read has no business being one typo from it. */
const ACCOUNT_SQL = `
  SELECT a.id, a.name, a.official_name, a.mask, a.provider,
         a.account_type, a.account_subtype,
         a.available_balance_cents, a.current_balance_cents, a.credit_limit_cents,
         a.entity_kind, a.entity_kind_source, a.entity_kind_set_at, a.entity_id,
         a.closed_at, p.institution_name
    FROM bank_accounts a
    LEFT JOIN plaid_items p ON p.id = a.plaid_item_id AND p.org_id = a.org_id
   WHERE a.client_id = $1 AND a.org_id = $2
   ORDER BY CASE a.account_type WHEN 'depository' THEN 0 WHEN 'credit' THEN 1 ELSE 2 END,
            a.name NULLS LAST, a.id`;

/* Posted rows only; pending is excluded. Summed per account per month in SQL so
   a busy account does not ship thousands of rows to this function. 085's sign:
   positive = money in, negative = money out. A SUM over no matching rows is
   NULL, which is exactly "we do not know", not $0. */
const TX_MONTHS_SQL = `
  SELECT bank_account_id::text AS bank_account_id,
         to_char(posted_on, 'YYYY-MM') AS month,
         SUM(amount_cents) FILTER (WHERE amount_cents > 0)  AS in_cents,
         SUM(-amount_cents) FILTER (WHERE amount_cents < 0) AS out_cents
    FROM bank_transactions
   WHERE client_id = $1 AND org_id = $2
     AND is_pending = false
     AND NOT (raw ? 'fundhub_removed_at')
     AND posted_on IS NOT NULL
     AND posted_on >= $3::date AND posted_on <= $4::date
   GROUP BY 1, 2`;

/* Dates cast to text: node-postgres turns a `date` into local midnight and a
   due date then moves a day east of UTC (see api/read/money-map.mjs). */
const BILL_SQL = `
  SELECT id, bank_account_id, entity_id, merchant_key, merchant_display, cadence,
         typical_amount_cents, next_expected_on::text AS next_expected_on,
         confidence_label
    FROM recurring_bills
   WHERE client_id = $1 AND org_id = $2
     AND confidence_label = ANY($3::text[])`;

/* to_jsonb(row): dates come back as 'YYYY-MM-DD' strings, and any column a
   parallel build adds (a provider due date, a bank_account_id on a liability)
   arrives without this query having to name it first. */
const CYCLE_SQL = `
  SELECT to_jsonb(s) AS row FROM account_statement_cycles s
   WHERE s.client_id = $1 AND s.org_id = $2`;
const LIABILITY_SQL = `
  SELECT to_jsonb(l) AS row FROM card_liabilities l
   WHERE l.client_id = $1 AND l.org_id = $2
   ORDER BY l.as_of DESC, l.created_at DESC`;

/**
 * moneyOverview(db, { orgId, clientId, env, asOf }) → the contract, or null when
 * the client is not in that org (the caller answers 404).
 *
 * Every query is filtered on org_id AND client_id.
 */
export async function moneyOverview(db, { orgId, clientId, env = process.env, asOf = new Date() } = {}) {
  const asOfIso = new Date(asOf).toISOString();
  const today = asOfIso.slice(0, 10);
  const firstMonth = `${monthMinus(today.slice(0, 7), CASHFLOW_MONTHS - 1)}-01`;

  const clientRes = await db.query(
    `SELECT id, first_name, last_name, custom_fields FROM clients WHERE id = $1 AND org_id = $2`,
    [clientId, orgId]
  );
  const client = clientRes.rows[0];
  if (!client) return null;

  const [accounts, entities, txMonths, bills, cycles, liabilities, tip] = await Promise.all([
    db.query(ACCOUNT_SQL, [clientId, orgId]),
    db.query(
      `SELECT id, kind, name FROM entities
        WHERE client_id = $1 AND org_id = $2 AND archived_at IS NULL
        ORDER BY kind, name, id`, [clientId, orgId]),
    db.query(TX_MONTHS_SQL, [clientId, orgId, firstMonth, today]),
    db.query(BILL_SQL, [clientId, orgId, [...PROJECTABLE_LABELS]]),
    db.query(CYCLE_SQL, [clientId, orgId]),
    db.query(LIABILITY_SQL, [clientId, orgId]),
    underwriteTip(db, { orgId, clientId, customFields: client.custom_fields })
  ]);

  return buildMoneyOverview({
    client,
    asOf: asOfIso,
    accounts: accounts.rows,
    entities: entities.rows,
    txMonths: txMonths.rows,
    bills: bills.rows,
    cycles: cycles.rows.map((r) => r.row ?? r),
    liabilities: liabilities.rows.map((r) => r.row ?? r),
    pricePerContainerCents: readPricePerContainer(env),
    tip
  });
}

export default moneyOverview;
