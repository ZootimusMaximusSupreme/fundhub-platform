// The application and approval tracker (Finance OS → Applications).
//
// Finance OS wave 3, unit O (ops/workflows/finance-os-wave3-brief.txt). Owner,
// 2026-11-07: "track every account the client applies for and whether it is
// approved; an approved account is added to the dashboard (it joins accounts,
// trends, card use and alerts)."
//
// TWO SOURCES, ONE LIST. Each row says where it came from.
//   fundhub — applications (schema 001 / 138): what Fundhub sends or tracks in a
//             funding round. READ ONLY here. Its status and amount are what the
//             bank said and they feed the success fee, so only the existing
//             staff and evidence paths write them (src/applications/status.mjs).
//   self    — finance_applications (migration 576): an account the client
//             applied for on their own. The client (or staff for them) adds it
//             and changes its status here. Never a billing source.
//
// AN APPROVAL ADDS THE ACCOUNT. When a card or a line of credit is approved it
// joins the client's Finance OS accounts as a bank_accounts row, so accounts,
// trends, card use and alerts all see it with no change to those reads:
//   1. Plaid already shows that card → link that Plaid account (no new row).
//      Same bank, and the same last 4 when we know it, or the only card at that
//      bank that Plaid first saw on or after the day the client applied.
//   2. More than one Plaid card could be it → add nothing and ask for the last 4.
//      Two rows for one card would count its limit twice.
//   3. Otherwise → a stand-in account written by createManualBankAccount (the
//      tested writer the Accounts page uses), with the approved limit. The
//      balance is unknown (null) until a bank says it.
// The link lives on the account: raw->'fundhub_application' = { kind, id, ... }.
// Migration 576 indexes it so one application never gets two accounts.
//
// WHEN PLAID LATER SEES THE SAME CARD, the stand-in BECOMES the Plaid account in
// place — the same row, its history, its container, its statement cycle —
// before the Plaid upsert runs (claimStandInsForPlaid, called by
// src/banking/accounts-store.mjs saveAccounts). Nothing is ever counted twice and
// nothing is deleted. A stand-in that matches more than one new Plaid card is
// left alone.
//
// THE RULES. Money is integer cents; unknown is null, never 0 (CLAUDE.md §12).
// Personal and business are never added together: the list counts applications,
// it never sums approved limits. A bank logo comes from the shared identity
// check (src/banking/institution-logos.mjs findLogos): Plaid's logo first, then
// the bank book's, by lender id, then by the exact name. A name that points at
// two logos gets none, and no logo is ever drawn (owner rule 2026-11-07).
// org_id and client_id are on every query. Nothing here deletes a row, calls a
// bank, or moves money.

import { toCents } from "../commissions/money.mjs";
import { findLogos } from "../banking/institution-logos.mjs";

/* The account writer is loaded when it is needed, not at the top. The Plaid
   account store (src/banking/accounts-store.mjs) imports this file, and
   src/banking/accounts.mjs imports plaid-link.mjs, which imports the store: a
   top-level import here would close that loop, and accounts.mjs reads a
   plaid-link constant while it loads. */
async function manualAccountWriter() {
  return (await import("../banking/accounts.mjs")).createManualBankAccount;
}

export const SELF_STATUSES = Object.freeze(["applied", "pending", "approved", "denied"]);
export const KINDS = Object.freeze(["card", "line", "loan"]);
export const OWNER_KINDS = Object.freeze(["personal", "business"]);

/* The words on the status chip. A chip is a word and a mark, never colour alone
   (UI-STANDARDS §12.6); the mark lives in the screen. */
export const STATUS_WORDS = Object.freeze({
  planned: "Not sent yet",
  applied: "Applied",
  pending: "Pending",
  approved: "Approved",
  denied: "Denied"
});

export const KIND_WORDS = Object.freeze({ card: "Credit card", line: "Line of credit", loan: "Loan" });

export class TrackInputError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "TrackInputError";
    this.code = code;
    this.status = status;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v) => typeof v === "string" && UUID_RE.test(v.trim());
const blank = (v) => v === null || v === undefined || String(v).trim() === "";

/* ── small pure helpers ───────────────────────────────────────────────────── */

/** A date or timestamp → "YYYY-MM-DD" or null. pg hands `date` back as a Date at
 *  local midnight, so the local getters are the right ones for a Date. */
export function dayOf(v) {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
  }
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(v));
  return m ? m[1] : null;
}

/** Today in Arizona (America/Phoenix), "YYYY-MM-DD". */
export function arizonaToday(now = new Date()) {
  return new Date(now).toLocaleDateString("en-CA", {
    timeZone: "America/Phoenix", year: "numeric", month: "2-digit", day: "2-digit"
  });
}

/** A bigint column (pg returns a string) or a number → integer cents, or null. */
export function centsOf(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isSafeInteger(n) ? n : null;
}

/** A numeric(14,2) dollars column ("10000.00") → integer cents, or null.
 *  toCents(null) answers 0, so null is caught first: unknown stays unknown. */
export function dollarsColumnToCents(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).trim());
  if (!Number.isFinite(n)) return null;
  const c = toCents(n);
  return c > 0 ? c : null;
}

/** Typed dollars ("$10,000", "2500.50") → integer cents > 0, or null when blank. */
export function readDollars(v, field) {
  if (blank(v)) return null;
  const s = String(v).trim().replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) {
    throw new TrackInputError(`invalid_${field}`, `The ${field.replace(/_/g, " ")} must be a dollar amount, like 10000 or 2,500.50.`);
  }
  let c;
  try { c = toCents(s); } catch { throw new TrackInputError(`invalid_${field}`, `The ${field.replace(/_/g, " ")} is too large.`); }
  if (!(c > 0)) {
    throw new TrackInputError(`invalid_${field}`, `The ${field.replace(/_/g, " ")} must be more than $0. Leave it blank if you do not know it.`);
  }
  return c;
}

/** "YYYY-MM-DD" (a real calendar day) or null when blank. */
export function readDay(v, field) {
  if (blank(v)) return null;
  const s = String(v).trim();
  const d = new Date(`${s}T12:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new TrackInputError(`invalid_${field}`, `The ${field.replace(/_/g, " ")} must be a date like 2026-11-07.`);
  }
  return s;
}

/** Last 4 → 2-4 digits, or null. More digits is refused, never trimmed. */
export function readLast4(v) {
  if (blank(v)) return null;
  const digits = String(v).trim().replace(/[\s•*·.\-xX]/g, "");
  if (!/^\d+$/.test(digits)) throw new TrackInputError("invalid_last4", "Last 4 must be digits only.");
  if (digits.length > 4) {
    throw new TrackInputError("invalid_last4", "Only the last 4 digits. That looks like a full account number. We never store one, so nothing was saved.");
  }
  if (digits.length < 2) throw new TrackInputError("invalid_last4", "Last 4 must be at least 2 digits.");
  return digits;
}

function readText(v, field, max, { required = false } = {}) {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s) {
    if (required) throw new TrackInputError(`${field}_required`, field === "bank" ? "Tell us which bank you applied to." : `The ${field} is required.`);
    return null;
  }
  if (s.length > max) throw new TrackInputError(`invalid_${field}`, `The ${field} must be ${max} characters or fewer.`);
  return s;
}

/* ── the two sources, mapped onto one shape ───────────────────────────────── */

/** applications.status (Airtable values, src/lenders/tables.mjs) → tracker status. */
export function fundhubStatus(status) {
  switch (String(status || "")) {
    case "Apply": return "planned";
    case "Applied": return "applied";
    case "Missing Docs":
    case "Action Required": return "pending";
    case "Approved": return "approved";
    case "Denied": return "denied";
    default: return null;
  }
}

/** applications.lender_table → card / line / loan, or null when the table is not set. */
export function kindFromLenderTable(t) {
  const s = String(t || "");
  if (/CC$/.test(s)) return "card";
  if (/LOC/.test(s)) return "line";
  if (s === "PersonalLoans") return "loan";
  return null;
}

/** applications.lender_table → personal / business, or null. */
export function ownerFromLenderTable(t) {
  const s = String(t || "");
  if (!s) return null;
  return /^(OnlineBizCC|InBranchBizCC|BizLOC_)/.test(s) ? "business" : (/^Personal/.test(s) ? "personal" : null);
}

/** One applications row → the shared shape. */
export function fromFundhubRow(r) {
  const status = fundhubStatus(r.status);
  const answered = status === "approved" || status === "denied";
  return {
    source: "fundhub",
    id: String(r.id),
    bank: r.lender_name || r.bank || null,
    product: r.product_name || null,
    kind: kindFromLenderTable(r.lender_table),
    owner_kind: ownerFromLenderTable(r.lender_table),
    applied_on: dayOf(r.submitted_date),
    // When the row has no submitted day, the day it was made is the earliest the
    // client can have applied. Used only to match a Plaid card, never shown.
    match_from: dayOf(r.submitted_date) || dayOf(r.created_at),
    requested_cents: dollarsColumnToCents(r.requested_amount),
    status,
    approved_cents: status === "approved" ? dollarsColumnToCents(r.approved_amount) : null,
    decided_on: answered ? dayOf(r.status_updated_date) : null,
    last4: null,
    counts: !r.approval_excluded_at,
    lender_id: r.lender_id ? String(r.lender_id) : null
  };
}

/** One finance_applications row → the shared shape. */
export function fromSelfRow(r) {
  return {
    source: "self",
    id: String(r.id),
    bank: r.bank,
    product: r.product || null,
    kind: r.kind,
    owner_kind: r.owner_kind || null,
    applied_on: dayOf(r.applied_on),
    match_from: dayOf(r.applied_on),
    requested_cents: centsOf(r.requested_cents),
    status: r.status,
    approved_cents: r.status === "approved" ? centsOf(r.approved_cents) : null,
    decided_on: dayOf(r.decided_on),
    last4: r.last4 || null,
    counts: true,
    lender_id: null
  };
}

/* ── banks: one name, many spellings ──────────────────────────────────────── */

const BANK_NOISE = new Set([
  "the", "of", "and", "bank", "banks", "na", "n", "a", "national", "association", "financial",
  "corp", "corporation", "inc", "co", "company", "group", "card", "cards", "credit", "services", "usa", "us"
]);

/** "JPMorgan Chase Bank, N.A." → ["chase", "jpmorgan"]. Words that every bank
 *  shares ("bank", "N.A.") are dropped so they never make two banks match. */
export function bankTokens(name) {
  let s = String(name || "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ");
  for (const [short, full] of BANK_SHORT_NAMES) s = s.replace(short, full);
  return s.split(" ").filter((w) => w && !BANK_NOISE.has(w)).sort();
}

/* The short names people type for a bank whose Plaid name has none of the same
   words. Without these, "Amex" and Plaid's "American Express" would never match,
   and one card would show twice. Whole words only. */
const BANK_SHORT_NAMES = [
  [/\bamex\b/g, "american express"],
  [/\b(bofa|boa)\b/g, "bank of america"],
  [/\bcap one\b/g, "capital one"]
];

/** True when every word of the shorter name is in the longer one. "Chase" and
 *  "JPMorgan Chase Bank" match; "Chase" and "Bank of America" do not. */
export function sameBank(a, b) {
  const x = bankTokens(a);
  const y = bankTokens(b);
  if (!x.length || !y.length) return false;
  const [short, long] = x.length <= y.length ? [x, new Set(y)] : [y, new Set(x)];
  return short.every((w) => long.has(w));
}

/* ── the account an approval adds ─────────────────────────────────────────── */

/** Does a bank account have the shape of this kind of product? */
export function kindFits(kind, account) {
  const t = String(account.account_type ?? account.accountType ?? "");
  const sub = String(account.account_subtype ?? account.accountSubtype ?? "").toLowerCase();
  if (kind === "card") return t === "credit" && !/line of credit/.test(sub);
  // Plaid files a line of credit under "credit" or under "loan", subtype "line
  // of credit". A credit account with no subtype could be either.
  if (kind === "line") return ((t === "credit" || t === "loan") && /line of credit/.test(sub)) || (t === "credit" && !sub);
  return false;
}

/**
 * standInPlan(app) → the account an approval adds, or null when it adds none.
 * Only an approved card or line of credit that still counts adds an account. A
 * loan does not: the money a loan funds is a different fact from its approval.
 */
export function standInPlan(app) {
  if (!app || app.status !== "approved" || !app.counts) return null;
  if (app.kind !== "card" && app.kind !== "line") return null;
  const name = [app.bank, app.product].filter(Boolean).join(" ").slice(0, 120) || null;
  if (!name) return null;
  return {
    name,
    mask: app.last4 || null,
    account_type: "credit",
    account_subtype: app.kind === "card" ? "credit card" : "line of credit",
    credit_limit_cents: app.approved_cents ?? null
  };
}

/** The link saved on the account, raw->'fundhub_application'. */
export function linkFor(app, now = new Date()) {
  return {
    kind: app.source,
    id: app.id,
    bank: app.bank,
    applied_on: app.applied_on,
    approved_cents: app.approved_cents ?? null,
    linked_at: new Date(now).toISOString()
  };
}

/**
 * matchPlaidForApproval(app, plaidAccounts) → { pick, ambiguous }
 *
 * plaidAccounts: Plaid rows of this client with institution_name, mask,
 * account_type, account_subtype, created_at and `linked` (already tied to an
 * application). Picks the one Plaid account this approval is, or none.
 */
export function matchPlaidForApproval(app, plaidAccounts = []) {
  const candidates = plaidAccounts.filter((a) => !a.linked && a.closed_at == null &&
    sameBank(app.bank, a.institution_name) && kindFits(app.kind, a));
  if (!candidates.length) return { pick: null, ambiguous: false };
  if (app.last4) {
    const same = candidates.filter((a) => a.mask && String(a.mask) === String(app.last4));
    if (same.length === 1) return { pick: same[0], ambiguous: false };
    return { pick: null, ambiguous: same.length > 1 };
  }
  const from = app.match_from || app.applied_on;
  const fresh = from ? candidates.filter((a) => (dayOf(a.created_at) || "") >= from) : candidates;
  if (fresh.length === 1) return { pick: fresh[0], ambiguous: false };
  return { pick: null, ambiguous: fresh.length > 1 };
}

/**
 * matchStandInsForPlaid(standIns, incoming, institutionName) → [{ standIn, account }]
 *
 * standIns: this client's open stand-in accounts (raw.fundhub_application set).
 * incoming: the Plaid accounts in this read that are not stored yet.
 * A stand-in with a last 4 pairs with the one new card that has it. A stand-in
 * with no last 4 pairs only when it is the one stand-in of its kind at this bank
 * and there is exactly one new account of that kind left. Each side pairs once.
 */
export function matchStandInsForPlaid(standIns = [], incoming = [], institutionName = null) {
  if (!institutionName) return [];
  const kindOf = (s) => (/line of credit/.test(String(s.account_subtype || "").toLowerCase()) ? "line" : "card");
  const here = standIns.filter((s) => s.link && sameBank(s.link.bank || s.name, institutionName));
  const used = new Set();
  const pairs = [];
  for (const s of here.filter((x) => x.mask)) {
    const hits = incoming.filter((a) => !used.has(a) && kindFits(kindOf(s), a) && a.mask && String(a.mask).slice(-4) === String(s.mask));
    if (hits.length === 1) { used.add(hits[0]); pairs.push({ standIn: s, account: hits[0] }); }
  }
  for (const kind of ["card", "line"]) {
    const open = here.filter((s) => !s.mask && kindOf(s) === kind);
    if (open.length !== 1) continue;
    const left = incoming.filter((a) => !used.has(a) && kindFits(kind, a));
    if (left.length === 1) { used.add(left[0]); pairs.push({ standIn: open[0], account: left[0] }); }
  }
  return pairs;
}

/* ── input from the screen ────────────────────────────────────────────────── */

/** POST track_add body → a finance_applications row to insert. */
export function readTrackInput(body = {}, { now = new Date() } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const bank = readText(b.bank, "bank", 120, { required: true });
  const product = readText(b.product, "product", 160);
  const kind = String(b.kind ?? "").trim().toLowerCase();
  if (!KINDS.includes(kind)) throw new TrackInputError("invalid_kind", "Pick what you applied for: a credit card, a line of credit or a loan.");
  const owner = blank(b.owner_kind) ? null : String(b.owner_kind).trim().toLowerCase();
  if (owner !== null && !OWNER_KINDS.includes(owner)) throw new TrackInputError("invalid_owner_kind", "Pick who the account is for: you or your business.");
  const appliedOn = readDay(b.applied_on, "applied_on");
  if (!appliedOn) throw new TrackInputError("applied_on_required", "Tell us the day you applied.");
  const today = arizonaToday(now);
  if (appliedOn > today) throw new TrackInputError("invalid_applied_on", "The day you applied cannot be in the future.");
  const status = blank(b.status) ? "applied" : String(b.status).trim().toLowerCase();
  const answer = readAnswer({ ...b, status }, { appliedOn, today });
  return {
    bank, product, kind, owner_kind: owner, applied_on: appliedOn,
    requested_cents: readDollars(b.requested_amount, "requested_amount"),
    ...answer
  };
}

/** The status and what rides on it — shared by add and update. */
function readAnswer(b, { appliedOn, today }) {
  const status = String(b.status ?? "").trim().toLowerCase();
  if (!SELF_STATUSES.includes(status)) throw new TrackInputError("invalid_status", "Pick a status: applied, pending, approved or denied.");
  const approved = readDollars(b.approved_amount, "approved_amount");
  const last4 = readLast4(b.last4);
  const decided = readDay(b.decided_on, "decided_on");
  if (approved !== null && status !== "approved") {
    throw new TrackInputError("amount_only_on_approval", "An approved amount only goes with an approval.");
  }
  if (decided !== null && status !== "approved" && status !== "denied") {
    throw new TrackInputError("decided_only_on_answer", "The day the bank answered only goes with an approval or a denial.");
  }
  if (decided !== null && decided > today) throw new TrackInputError("invalid_decided_on", "The day the bank answered cannot be in the future.");
  if (decided !== null && appliedOn && decided < appliedOn) {
    throw new TrackInputError("invalid_decided_on", "The day the bank answered cannot be before the day you applied.");
  }
  return { status, approved_cents: approved, last4, decided_on: decided };
}

/** POST track_update body → the new status fields, checked against the row's applied day. */
export function readTrackUpdate(body = {}, { appliedOn, now = new Date() } = {}) {
  const b = body && typeof body === "object" ? body : {};
  return readAnswer(b, { appliedOn, today: arizonaToday(now) });
}

/* ── the screen's shape ───────────────────────────────────────────────────── */

const ACCOUNT_WORDS = Object.freeze({
  plaid: "On your accounts. Your bank connection keeps it up to date.",
  added: "On your accounts. The balance shows once your bank connection sees it.",
  closed: "On your accounts, marked closed.",
  missing: "Not on your accounts yet.",
  ambiguous: "Your bank connection shows more than one card at this bank. Add the last 4 digits under Change status so we match the right one.",
  // A Fundhub round row has no last 4 for the client to give.
  ambiguous_fundhub: "Your bank connection shows more than one card at this bank, so we left this one off. Nothing counts twice.",
  loan: "Add the loan on your Accounts page once the money lands."
});

/** One row for the screen. `account` is the linked bank account or undefined;
 *  `logo` is the bank's logo from findLogos, or null for the name alone. */
export function trackerRow(app, { account = null, logo = null } = {}) {
  const plan = standInPlan(app);
  let accountState = null;
  if (account) accountState = account.closed_at ? "closed" : (account.provider === "plaid" ? "plaid" : "added");
  else if (plan) accountState = app.needs_last4 ? "ambiguous" : "missing";
  else if (app.status === "approved" && app.kind === "loan") accountState = "loan";
  return {
    id: app.id,
    source: app.source,
    bank: app.bank,
    product: app.product,
    kind: app.kind,
    kind_words: app.kind ? KIND_WORDS[app.kind] : null,
    owner_kind: app.owner_kind,
    applied_on: app.applied_on,
    requested_cents: app.requested_cents,
    status: app.status,
    status_words: STATUS_WORDS[app.status] || "Status not set",
    approved_cents: app.approved_cents,
    decided_on: app.decided_on,
    last4: app.last4,
    counts: app.counts,
    logo_url: logo || null,
    account: account ? { id: String(account.id), name: account.name || null, mask: account.mask || null, provider: account.provider } : null,
    account_state: accountState,
    account_words: !accountState ? null
      : ACCOUNT_WORDS[accountState === "ambiguous" && app.source === "fundhub" ? "ambiguous_fundhub" : accountState],
    can_add_account: accountState === "missing",
    can_edit: app.source === "self"
  };
}

/** Counts for the caption. Never a dollar total: personal and business never add up. */
export function summarize(rows) {
  const n = { total: rows.length, planned: 0, applied: 0, pending: 0, approved: 0, denied: 0 };
  for (const r of rows) if (n[r.status] !== undefined) n[r.status] += 1;
  return n;
}

/** Newest first: the day applied, then the source's own order. */
function byNewest(a, b) {
  const x = a.applied_on || a.match_from || "";
  const y = b.applied_on || b.match_from || "";
  if (x !== y) return x < y ? 1 : -1;
  return 0;
}

/* ── reads ────────────────────────────────────────────────────────────────── */

const FUNDHUB_SQL = `
  SELECT a.id, a.bank, a.lender_name, a.lender_id, a.product_name, a.lender_table, a.status,
         a.approved_amount, a.requested_amount, a.submitted_date, a.status_updated_date,
         a.approval_excluded_at, a.created_at
    FROM applications a
   WHERE a.org_id = $1::uuid AND a.client_id = $2::uuid
   ORDER BY a.created_at DESC
   LIMIT 200`;

const SELF_SQL = `
  SELECT id, bank, product, kind, owner_kind, applied_on, requested_cents, status, approved_cents,
         decided_on, last4, entered_by, created_at, updated_at
    FROM finance_applications
   WHERE org_id = $1::uuid AND client_id = $2::uuid
   ORDER BY applied_on DESC, created_at DESC
   LIMIT 200`;

const LINKED_SQL = `
  SELECT id, name, mask, provider, closed_at, raw->'fundhub_application' AS link
    FROM bank_accounts
   WHERE org_id = $1::uuid AND client_id = $2::uuid AND raw ? 'fundhub_application'`;

const PLAID_SQL = `
  SELECT a.id, a.name, a.mask, a.account_type, a.account_subtype, a.created_at, a.closed_at,
         (a.raw ? 'fundhub_application') AS linked, i.institution_name
    FROM bank_accounts a
    JOIN plaid_items i ON i.id = a.plaid_item_id AND i.org_id = a.org_id
   WHERE a.org_id = $1::uuid AND a.client_id = $2::uuid AND a.provider = 'plaid'
     AND a.closed_at IS NULL AND a.account_type IN ('credit', 'loan')`;

const linkKey = (kind, id) => `${kind}:${id}`;

/**
 * readApplicationsTracker(db, { orgId, clientId }) → the card's whole read.
 * { rows, counts, can_add }
 */
export async function readApplicationsTracker(db, { orgId, clientId } = {}) {
  if (!orgId || !isUuid(clientId)) throw new TypeError("orgId and a uuid clientId are required");
  const [fundhub, self, linked, plaid] = await Promise.all([
    db.query(FUNDHUB_SQL, [orgId, clientId]),
    db.query(SELF_SQL, [orgId, clientId]),
    db.query(LINKED_SQL, [orgId, clientId]),
    db.query(PLAID_SQL, [orgId, clientId])
  ]);
  const accounts = new Map();
  for (const a of linked.rows) {
    const l = a.link && typeof a.link === "object" ? a.link : null;
    if (l && l.kind && l.id) accounts.set(linkKey(l.kind, l.id), a);
  }
  const apps = [...fundhub.rows.map(fromFundhubRow), ...self.rows.map(fromSelfRow)].filter((a) => a.status);
  apps.sort(byNewest);
  // One lookup for every row; it never throws, and a miss is the name alone.
  const logos = await findLogos(db, { orgId, banks: apps.map((a) => ({ lenderId: a.lender_id, name: a.bank })) });
  const rows = apps.map((app, i) => {
    const account = accounts.get(linkKey(app.source, app.id)) || null;
    if (!account && standInPlan(app)) app.needs_last4 = matchPlaidForApproval(app, plaid.rows).ambiguous;
    return trackerRow(app, { account, logo: logos[i] ? logos[i].logo : null });
  });
  return { rows, counts: summarize(rows), can_add: true };
}

/* ── writes ───────────────────────────────────────────────────────────────── */

/* createManualBankAccount opens its own transaction when it is handed a pool or
   the shared handle. Inside somebody else's transaction that would be a second
   connection (or "Client has already been connected"), so it is handed a plain
   { query } over the caller's handle and runs inline, on the caller's terms. */
const inline = (db) => ({ query: (sql, params) => db.query(sql, params) });

/**
 * ensureApprovedAccount(db, { orgId, clientId, app, now }) →
 *   { status: 'not_needed' | 'exists' | 'linked' | 'ambiguous' | 'added', account_id? }
 */
export async function ensureApprovedAccount(db, { orgId, clientId, app, now = new Date() } = {}) {
  const plan = standInPlan(app);
  if (!plan) return { status: "not_needed" };
  const found = async () => (await db.query(
    `SELECT id FROM bank_accounts
      WHERE org_id = $1::uuid AND client_id = $2::uuid
        AND raw->'fundhub_application'->>'kind' = $3 AND raw->'fundhub_application'->>'id' = $4
      LIMIT 1`,
    [orgId, clientId, app.source, app.id]
  )).rows[0] || null;
  const have = await found();
  if (have) return { status: "exists", account_id: String(have.id) };

  const link = linkFor(app, now);
  const plaid = (await db.query(PLAID_SQL, [orgId, clientId])).rows;
  const m = matchPlaidForApproval(app, plaid);
  if (m.pick) {
    const r = await db.query(
      `UPDATE bank_accounts
          SET raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('fundhub_application', $4::jsonb),
              updated_at = now()
        WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid
          AND NOT (COALESCE(raw, '{}'::jsonb) ? 'fundhub_application')
        RETURNING id`,
      [m.pick.id, orgId, clientId, JSON.stringify(link)]
    );
    if (r.rows[0]) return { status: "linked", account_id: String(r.rows[0].id) };
    const again = await found();
    return again ? { status: "exists", account_id: String(again.id) } : { status: "ambiguous" };
  }
  if (m.ambiguous) return { status: "ambiguous" };

  try {
    const createManualBankAccount = await manualAccountWriter();
    const acct = await createManualBankAccount(inline(db), {
      name: plan.name,
      mask: plan.mask,
      account_type: plan.account_type,
      account_subtype: plan.account_subtype,
      currency_code: "USD",
      credit_limit_cents: plan.credit_limit_cents,
      raw: { entry: "application", page: "applications", fundhub_application: link }
    }, { orgId, clientId });
    return { status: "added", account_id: String(acct.id) };
  } catch (e) {
    // Two saves at once: the unique index (576) let one in. Answer with that one.
    if (e && e.code === "23505") {
      const again = await found();
      if (again) return { status: "exists", account_id: String(again.id) };
    }
    throw e;
  }
}

/** A row of this client's finance_applications, or null. */
async function loadSelf(db, { orgId, clientId, id }) {
  if (!isUuid(id)) return null;
  const r = await db.query(
    `SELECT id, bank, product, kind, owner_kind, applied_on, requested_cents, status, approved_cents,
            decided_on, last4, entered_by, created_at, updated_at
       FROM finance_applications
      WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid`,
    [String(id).trim(), orgId, clientId]
  );
  return r.rows[0] || null;
}

/**
 * addTrackedApplication(db, { orgId, clientId, by, input, now }) →
 *   { ok: true, id, account } — input is readTrackInput's output.
 */
export async function addTrackedApplication(db, { orgId, clientId, by = {}, input, now = new Date() } = {}) {
  if (!orgId || !isUuid(clientId)) throw new TypeError("orgId and a uuid clientId are required");
  const r = await db.query(
    `INSERT INTO finance_applications (
       org_id, client_id, bank, product, kind, owner_kind, applied_on, requested_cents,
       status, approved_cents, decided_on, last4, entered_by, entered_by_id
     ) VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::date, $8, $9, $10, $11::date, $12, $13, $14)
     RETURNING id, bank, product, kind, owner_kind, applied_on, requested_cents, status, approved_cents,
               decided_on, last4, entered_by, created_at, updated_at`,
    [orgId, clientId, input.bank, input.product, input.kind, input.owner_kind, input.applied_on,
      input.requested_cents, input.status, input.approved_cents, input.decided_on, input.last4,
      by.kind === "staff" ? "staff" : "client", isUuid(by.id) ? by.id : null]
  );
  const row = r.rows[0];
  const account = await ensureApprovedAccount(db, { orgId, clientId, app: fromSelfRow(row), now });
  return { ok: true, id: String(row.id), account };
}

/**
 * updateTrackedApplication(db, { orgId, clientId, id, body, now }) →
 *   { ok: true, id, account } | { ok: false, error: 'not_found' }
 * Only the client's own rows (finance_applications). A Fundhub round row is
 * changed by staff through POST /api/applications, never here.
 */
export async function updateTrackedApplication(db, { orgId, clientId, id, body = {}, now = new Date() } = {}) {
  const current = await loadSelf(db, { orgId, clientId, id });
  if (!current) return { ok: false, error: "not_found" };
  const next = readTrackUpdate(body, { appliedOn: dayOf(current.applied_on), now });
  // A last 4 already saved stays unless a new one is typed. Blank never wipes it.
  const last4 = next.last4 ?? current.last4 ?? null;
  const r = await db.query(
    `UPDATE finance_applications
        SET status = $4, approved_cents = $5, decided_on = $6::date, last4 = $7
      WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid
      RETURNING id, bank, product, kind, owner_kind, applied_on, requested_cents, status, approved_cents,
                decided_on, last4, entered_by, created_at, updated_at`,
    [current.id, orgId, clientId, next.status, next.approved_cents, next.decided_on, last4]
  );
  const row = r.rows[0];
  if (!row) return { ok: false, error: "not_found" };
  const account = await ensureApprovedAccount(db, { orgId, clientId, app: fromSelfRow(row), now });
  return { ok: true, id: String(row.id), account };
}

/**
 * addAccountForApplication(db, { orgId, clientId, source, id }) — the "Add to my
 * accounts" button, for an approval made before this shipped or one that was
 * waiting on its last 4. Same rules as the automatic path.
 */
export async function addAccountForApplication(db, { orgId, clientId, source, id, now = new Date() } = {}) {
  if (!isUuid(id)) return { ok: false, error: "not_found" };
  let app = null;
  if (source === "self") {
    const row = await loadSelf(db, { orgId, clientId, id });
    app = row ? fromSelfRow(row) : null;
  } else if (source === "fundhub") {
    const r = await db.query(
      `SELECT a.id, a.bank, a.lender_name, a.lender_id, a.product_name, a.lender_table, a.status,
              a.approved_amount, a.requested_amount, a.submitted_date, a.status_updated_date,
              a.approval_excluded_at, a.created_at
         FROM applications a
        WHERE a.id = $1::uuid AND a.org_id = $2::uuid AND a.client_id = $3::uuid`,
      [String(id).trim(), orgId, clientId]
    );
    app = r.rows[0] ? fromFundhubRow(r.rows[0]) : null;
  }
  if (!app) return { ok: false, error: "not_found" };
  if (!standInPlan(app)) return { ok: false, error: "not_an_approved_card" };
  const account = await ensureApprovedAccount(db, { orgId, clientId, app, now });
  return { ok: true, id: app.id, account };
}

/* ── hooks other writers call. They never throw. ──────────────────────────── */

/* Run `fn` so that a failure cannot spoil the caller's work. Inside a real
   transaction (a checked-out client) it runs under a savepoint and rolls back
   only its own statements. Anywhere else each statement stands alone, so a
   failure is simply caught. The caller's write has already happened. */
async function isolated(db, fn, fallback, label) {
  let savepoint = false;
  if (db && typeof db.release === "function") {
    try { await db.query("SAVEPOINT fos_applications"); savepoint = true; } catch { savepoint = false; }
  }
  try {
    const out = await fn(db);
    if (savepoint) await db.query("RELEASE SAVEPOINT fos_applications");
    return out;
  } catch (e) {
    if (savepoint) { try { await db.query("ROLLBACK TO SAVEPOINT fos_applications"); } catch { /* the first error is the one that matters */ } }
    console.warn(`[applications-tracker] ${label} did not run: ${e && e.message ? e.message : e}`);
    return { ...fallback, error: e && e.message ? String(e.message).slice(0, 200) : "failed" };
  }
}

/**
 * syncApprovedApplication(db, { orgId, application }) — called by
 * src/applications/status.mjs after a Fundhub application's status is saved.
 * When the bank said yes to a card or a line of credit, the account joins the
 * client's Finance OS accounts. Never throws: the bank answer is already saved,
 * and an account that could not be added shows "Add to my accounts" instead.
 */
export async function syncApprovedApplication(db, { orgId, application } = {}) {
  const row = application;
  if (!row || row.status !== "Approved" || !row.client_id || row.approval_excluded_at) return { status: "not_needed" };
  return isolated(db, (q) => ensureApprovedAccount(q, {
    orgId: orgId || row.org_id, clientId: String(row.client_id), app: fromFundhubRow(row)
  }), { status: "failed" }, "sync approved application");
}

/**
 * claimStandInsForPlaid(db, accounts, { orgId, clientId, plaidItemId }) — called
 * by src/banking/accounts-store.mjs saveAccounts BEFORE a Plaid upsert. Each
 * stand-in that this read's new Plaid card matches becomes that Plaid row in
 * place; the upsert that follows then updates it. Never throws.
 */
export async function claimStandInsForPlaid(db, accounts, { orgId, clientId, plaidItemId } = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (!orgId || !clientId || !plaidItemId) return { claimed: 0 };
  if (!list.some((a) => a && a.providerAccountId && (kindFits("card", a) || kindFits("line", a)))) return { claimed: 0 };
  return isolated(db, async (q) => {
    const stand = (await q.query(
      `SELECT id, name, mask, account_type, account_subtype, raw->'fundhub_application' AS link
         FROM bank_accounts
        WHERE org_id = $1::uuid AND client_id = $2::uuid AND provider = 'manual'
          AND plaid_item_id IS NULL AND closed_at IS NULL AND raw ? 'fundhub_application'`,
      [orgId, clientId]
    )).rows;
    if (!stand.length) return { claimed: 0 };
    const item = (await q.query(
      `SELECT institution_name FROM plaid_items WHERE id = $1::uuid AND org_id = $2::uuid AND client_id = $3::uuid`,
      [plaidItemId, orgId, clientId]
    )).rows[0];
    if (!item || !item.institution_name) return { claimed: 0 };
    const ids = list.map((a) => a && a.providerAccountId).filter(Boolean).map(String);
    const stored = new Set((await q.query(
      `SELECT plaid_account_id FROM bank_accounts WHERE plaid_item_id = $1::uuid AND plaid_account_id = ANY($2::text[])`,
      [plaidItemId, ids]
    )).rows.map((r) => String(r.plaid_account_id)));
    const fresh = list.filter((a) => a && a.providerAccountId && !stored.has(String(a.providerAccountId)))
      .map((a) => ({ ...a, mask: a.mask == null ? null : String(a.mask).replace(/\D/g, "").slice(-4) || null }));
    const pairs = matchStandInsForPlaid(stand, fresh, item.institution_name);
    let claimed = 0;
    for (const { standIn, account } of pairs) {
      const r = await q.query(
        `UPDATE bank_accounts
            SET provider = 'plaid', plaid_item_id = $3::uuid, plaid_account_id = $4,
                raw = COALESCE(raw, '{}'::jsonb) || jsonb_build_object('fundhub_application',
                      COALESCE(raw->'fundhub_application', '{}'::jsonb) || jsonb_build_object('plaid_seen_at', now()::text)),
                updated_at = now()
          WHERE id = $1::uuid AND org_id = $2::uuid AND provider = 'manual' AND plaid_item_id IS NULL
            AND NOT EXISTS (SELECT 1 FROM bank_accounts b WHERE b.plaid_item_id = $3::uuid AND b.plaid_account_id = $4)
          RETURNING id`,
        [standIn.id, orgId, plaidItemId, String(account.providerAccountId)]
      );
      claimed += r.rows.length;
    }
    return { claimed };
  }, { claimed: 0 }, "claim stand-ins for Plaid");
}
