// Read-only view of recorded client bank rows. These are not a net-worth
// statement, a complete inventory, or proof that a bank verified a balance.
import { readEntityKind, ENTITY_KINDS } from "../finance/banking-surface.mjs";
import { sumKnown, basisOf } from "../finance/os-grid.mjs";

const MAX_ACCOUNTS = 200;
const MAX_HOLDINGS = 500;
const PROVIDERS = new Set(["manual", "mock", "plaid", "import"]);
const TYPES = new Set(["depository", "credit", "loan", "investment", "other"]);
const OWNERSHIP_SOURCES = new Set([
  "client_stated", "staff_reviewed", "document_verified", "connection_metadata"
]);
const uuid = (v) => typeof v === "string" &&
  /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(v) ? v : null;
const enumValue = (v, values, fallback = null) => typeof v === "string" &&
  values.has(v.trim().toLowerCase()) ? v.trim().toLowerCase() : fallback;
const providerOf = (v) => enumValue(v, PROVIDERS, "unknown");

function text(v, limit = 120) {
  if (typeof v !== "string") return null;
  // Display labels may contain an accidentally pasted account number or SSN.
  const safe = v.replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\d[\d -]{3,}\d/g, "[redacted]").trim().slice(0, limit);
  return safe || null;
}

function maskOf(v) {
  if (typeof v !== "string") return null;
  return /^[*xX•\s-]*\d{1,4}$/.test(v.trim()) ? v.replace(/\D/g, "") : null;
}

function cents(v) {
  if (typeof v !== "number" && !(typeof v === "string" && /^[+-]?\d+$/.test(v))) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

function date(v) {
  if (!(v instanceof Date) && !(typeof v === "string" && /^\d{4}-\d{2}-\d{2}(?:$|[T ])/u.test(v))) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function currency(v) {
  return typeof v === "string" && /^[a-z]{3}$/i.test(v.trim()) ? v.trim().toUpperCase() : null;
}

function boundedRows(input, cap) {
  return {
    rows: Array.isArray(input) ? input.slice(0, cap).filter((v) => v && typeof v === "object" && !Array.isArray(v)) : [],
    truncated: Array.isArray(input) && input.length > cap
  };
}

function accountView(a) {
  const closed = a.closed_at !== null && a.closed_at !== undefined && a.closed_at !== "";
  const type = enumValue(a.account_type, TYPES, "unknown");
  const cash = !closed && type === "depository";
  return {
    id: uuid(a.id),
    name: text(a.name) || text(a.official_name),
    mask: maskOf(a.mask),
    account_type: type,
    account_subtype: text(a.account_subtype, 40),
    entity_kind: readEntityKind(a.entity_kind),
    entity_kind_source: enumValue(a.entity_kind_source, OWNERSHIP_SOURCES),
    entity_kind_set_at: date(a.entity_kind_set_at),
    currency_code: currency(a.currency_code),
    current_balance_cents: cents(a.current_balance_cents),
    available_balance_cents: cents(a.available_balance_cents),
    balance_as_of: date(a.balance_as_of),
    closed_at: date(a.closed_at),
    account_status: closed ? "closed" : "open",
    provider: providerOf(a.provider),
    source: "bank_accounts",
    included_in_cash: cash,
    exclusion_reason: cash ? null : closed ? "closed_account" : "not_depository"
  };
}

function holdingView(h, accounts) {
  const parent = accounts.get(h.bank_account_id);
  const source = h.source === "manual" || h.source === "provider" ? h.source : "unknown";
  return {
    id: uuid(h.id),
    bank_account_id: uuid(h.bank_account_id),
    account_name: parent?.name || text(h.account_name),
    symbol: text(h.symbol, 32),
    description: text(h.description, 160),
    entity_kind: parent?.entity_kind || "unknown",
    currency_code: currency(h.currency_code),
    current_value_cents: cents(h.current_value_cents),
    as_of: date(h.as_of),
    account_status: parent?.account_status || "unknown",
    source,
    // Manual positions on a connected account remain manually recorded.
    provider: source === "manual" ? "manual" : source === "provider" ? parent?.provider || "unknown" : "unknown",
    included_in_investments: parent?.account_status !== "closed",
    exclusion_reason: parent?.account_status === "closed" ? "closed_account" : null
  };
}

function amount(rows, field, dateField, truncated) {
  const values = rows.map((r) => r[field]);
  const sum = sumKnown(values);
  // Integer cents are summed exactly, then bounded for the JSON number wire.
  const exact = values.reduce((n, v) => n + (v === null ? 0n : BigInt(v)), 0n);
  const overflow = exact > BigInt(Number.MAX_SAFE_INTEGER) || exact < BigInt(Number.MIN_SAFE_INTEGER);
  const knownRows = rows.filter((r) => r[field] !== null);
  const dates = knownRows.map((r) => r[dateField]).filter(Boolean).sort();
  const unknownDates = knownRows.length - dates.length;
  const unresolvedAccounts = rows.filter((r) => r.account_status === "unknown").length;
  const basis = basisOf(sum, rows.length);
  return {
    value_cents: overflow ? null : sum.known ? Number(exact) : null,
    basis: {
      ...basis,
      partial: basis.partial || truncated || overflow || unresolvedAccounts > 0,
      status: !rows.length ? "no_records" : !sum.known ? "unknown" :
        basis.partial || truncated || overflow || unresolvedAccounts > 0 ? "partial" : "recorded",
      truncated,
      overflow,
      unresolved_accounts: unresolvedAccounts,
      providers: [...new Set(rows.map((r) => r.provider))].sort()
    },
    as_of: dates.length && !unknownDates && dates[0] === dates.at(-1) ? dates[0] : null,
    date_range: { oldest: dates[0] || null, newest: dates.at(-1) || null, unknown: unknownDates }
  };
}

function groups(rows, valueFields, dateField, truncated) {
  return ENTITY_KINDS.map((entity_kind) => {
    const mine = rows.filter((r) => r.entity_kind === entity_kind);
    const currencies = [...new Set(mine.map((r) => r.currency_code))]
      .sort((a, b) => a === null ? 1 : b === null ? -1 : a.localeCompare(b));
    return {
      entity_kind,
      currencies: currencies.map((currency_code) => {
        const sameCurrency = mine.filter((r) => r.currency_code === currency_code);
        return {
          currency_code,
          ...Object.fromEntries(Object.entries(valueFields).map(([key, field]) =>
            [key, amount(sameCurrency, field, dateField, truncated)]))
        };
      })
    };
  });
}

/** Stored /api/banking/accounts rows only; no provider calls or inferred assets. */
export function clientAssetProfile({ accounts = [], holdings = [], asOf = null } = {}) {
  const boundedAccounts = boundedRows(accounts, MAX_ACCOUNTS);
  const boundedHoldings = boundedRows(holdings, MAX_HOLDINGS);
  const accountViews = boundedAccounts.rows.map(accountView);
  const byId = new Map(accountViews.filter((a) => a.id).map((a) => [a.id, a]));
  const holdingViews = boundedHoldings.rows.map((h) => holdingView(h, byId));
  return {
    source: "stored_bank_records",
    scope: "recorded_rows_only",
    as_of: date(asOf),
    accounts: accountViews,
    holdings: holdingViews,
    cash: groups(accountViews.filter((a) => a.included_in_cash), {
      current: "current_balance_cents", available: "available_balance_cents"
    }, "balance_as_of", boundedAccounts.truncated),
    investments: groups(holdingViews.filter((h) => h.included_in_investments), {
      value: "current_value_cents"
    }, "as_of", boundedAccounts.truncated || boundedHoldings.truncated),
    truncated: { accounts: boundedAccounts.truncated, holdings: boundedHoldings.truncated }
  };
}

export default clientAssetProfile;
