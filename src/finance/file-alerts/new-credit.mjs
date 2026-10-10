// Alert 4 — new credit showed up.
//
// The offer (owner-set 2026-09-29): "One new card or inquiry can push back a round,
// so the system flags it the day it shows up." (The product word is "the next
// funding sequence" — owner-set 2026-10-06 — and that is what the text says.)
//
// TWO WAYS A NEW CARD OR LOAN SHOWS UP, BOTH READ HERE:
//
//   (a) A NEW PLAID ACCOUNT on a login the client already linked: a credit or loan
//       row in bank_accounts that was created after that login's first read.
//   (b) A NEW ACCOUNT OR INQUIRY BETWEEN TWO STORED CREDIT PULLS: the newest two
//       crs_results rows, diffed.
//
// PURE. No database, no clock: rows and results are parameters.
//
// THE RULE THAT SHAPES (b): A BUREAU RENAMES CREDITORS, AND A WRONG "NEW CARD" IS
// AN ACCUSATION. src/waypoints/verify.mjs measured it on 2026-09-06: one creditor
// string rewritten from "Credit One Bank" to "CREDIT ONE BANK N.A." told a client,
// on their own portal, that they had opened new credit. So this follows the same
// discipline: an account is matched by its PRINT (the day it was opened plus the
// last four digits of its number — a bureau does not rewrite either when it tidies
// a creditor string) and an account with no print is UNKNOWN, never "new". Nothing
// is concluded from a name alone. Unknown is not a denial.
//
// And three more guards, each one a false alert this code refuses to send:
//   * the OLDER pull had no accounts at all → a failed or partial pull, not a
//     client with an empty file. Nothing is compared.
//   * the NEWER pull came from a bureau the older one did not have (a freeze
//     lifted) → that bureau's whole file would read as "new". Nothing is compared.
//   * an inquiry dated before the older pull was taken → it was already there to
//     be seen. It is not new.
//
// NEVER A SECOND ALERT FOR THE SAME CARD. A card the Plaid account alert already
// told the client about shows up again, weeks later, as a new tradeline on the next
// credit pull (or the other way round). The last four digits of what was already
// alerted are passed in, and an account or tradeline with those digits is skipped.

import { accountPrint, openedDay, slugify } from "../../waypoints/definitions.mjs";
import { lastFour } from "../../metro2/normalize.mjs";
import {
  TEMPLATES, NEW_ACCOUNT_BASELINE_MINUTES, NEW_CREDIT_LOOKBACK_DAYS,
  cardWords, shortDate, addDaysIso, toMs, DAY_MS
} from "./common.mjs";

const NAME_LIMIT = 3;

function listWords(parts) {
  const shown = parts.slice(0, NAME_LIMIT);
  const more = parts.length - shown.length;
  return more > 0 ? `${shown.join("; ")}; and ${more} more` : shown.join("; ");
}

function loanWords(row = {}) {
  const name = typeof row.name === "string" ? row.name.trim() : "";
  const mask = row.mask === null || row.mask === undefined ? "" : String(row.mask).trim();
  if (name && mask) return `${name} ending ${mask}`;
  if (name) return name;
  if (mask) return `loan ending ${mask}`;
  return "loan";
}

/** The CSM task a new-credit alert opens for a Blueprint file. */
function taskFor(key, body) {
  return {
    title: "New credit showed up on the file — review it with the client",
    body: `${key}\n${body}`
  };
}

/* ------------------------------------------------------------------ *
 * (a) a new account on a linked login
 * ------------------------------------------------------------------ */

/**
 * planNewAccounts(rows, { now, knownLast4 }) → { alerts, skipped }
 *
 *   rows        bank_accounts rows with created_at, plaid_item_id and the login's
 *               own created_at as item_created_at
 *   knownLast4  Set of last-four strings an earlier new-credit alert already named
 *
 * A row is a new-credit alert when ALL of these hold:
 *   * it is a credit card or a loan, open, on a linked login (a hand-typed
 *     account is something the client knows about — it is not a discovery);
 *   * it was created more than NEW_ACCOUNT_BASELINE_MINUTES after the login was —
 *     the accounts the first read brought in are the baseline, not new credit;
 *   * it was created within the last NEW_CREDIT_LOOKBACK_DAYS (a backlog from
 *     before this shipped stays quiet);
 *   * the client has no EARLIER account of the same type and last four — a login
 *     linked a second time brings the same cards back under new ids.
 */
export function planNewAccounts(rows = [], { now = new Date(), knownLast4 = new Set() } = {}) {
  const alerts = [];
  const skipped = [];
  const nowMs = toMs(now);
  const all = Array.isArray(rows) ? rows.filter((r) => r && r.id) : [];

  for (const a of all) {
    const skip = (reason) => skipped.push({ accountId: a.id, reason });
    const type = String(a.account_type || "").toLowerCase();
    if (type !== "credit" && type !== "loan") continue;
    if (a.closed_at) { skip("closed"); continue; }
    if (!a.plaid_item_id) { skip("not_on_a_linked_login"); continue; }

    const createdMs = toMs(a.created_at);
    const itemMs = toMs(a.item_created_at);
    if (createdMs === null || itemMs === null) { skip("created_date_unknown"); continue; }
    if (createdMs - itemMs <= NEW_ACCOUNT_BASELINE_MINUTES * 60_000) { skip("first_read_of_the_login"); continue; }
    if (nowMs === null || nowMs - createdMs > NEW_CREDIT_LOOKBACK_DAYS * DAY_MS) { skip("too_old_to_alert"); continue; }

    const mask = a.mask === null || a.mask === undefined || String(a.mask).trim() === "" ? null : String(a.mask).trim();
    if (mask) {
      if (knownLast4 instanceof Set && knownLast4.has(mask)) { skip("already_alerted"); continue; }
      const seenBefore = all.some((o) => o.id !== a.id
        && String(o.account_type || "").toLowerCase() === type
        && o.mask && String(o.mask).trim() === mask
        && toMs(o.created_at) !== null && toMs(o.created_at) < createdMs);
      if (seenBefore) { skip("same_account_linked_again"); continue; }
    }

    const isCard = type === "credit";
    const words = isCard ? cardWords(a) : loanWords(a);
    const what = `a new ${isCard ? "card" : "loan"} showed up on your linked accounts: ${words}`;
    const key = `fpa:new:acct:${a.id}`;
    const body = `Fundhub alert: ${what}. New credit can push back your next funding sequence. If this is not yours, reply and tell us.`;
    alerts.push({
      alert: true,
      kind: "new_credit",
      key,
      templateKey: TEMPLATES.new_credit,
      bankAccountId: a.id,
      label: words,
      threshold: null,
      dueOn: null,
      tags: { what },
      body,
      task: taskFor(key, body),
      detail: {
        source: "plaid_account",
        items: [{ source: "plaid_account", type: isCard ? "card" : "loan", name: a.name ?? null, last4: mask, account_id: a.id }]
      }
    });
  }
  return { alerts, skipped };
}

/* ------------------------------------------------------------------ *
 * (b) between two credit pulls
 * ------------------------------------------------------------------ */

/* The same preference order as src/waypoints/definitions.mjs (tradelinesOf) and
   src/underwrite/black-report-client.mjs (inquiriesOf): the normalized list when
   it has rows, else the top-level one. Copied, not shared, so the two readers
   those files keep private stay private; if they change, change these. */
function tradelinesOf(result) {
  const norm = result?.normalized?.tradelines;
  const top = result?.tradelines;
  const list = Array.isArray(norm) && norm.length ? norm : (Array.isArray(top) ? top : []);
  return list.filter((t) => t && typeof t === "object" && !t.isAU && !t.is_au);
}

function inquiriesOf(result) {
  const norm = result?.normalized?.inquiries;
  const top = result?.inquiries;
  const list = Array.isArray(norm) && norm.length ? norm : (Array.isArray(top) ? top : []);
  return list.filter((i) => i && typeof i === "object");
}

function bureausOf(result) {
  const list = result?.bureausPulled;
  return Array.isArray(list) ? list.map((b) => String(b).toUpperCase()) : null;
}

function describeLine(t) {
  const creditor = String(t.creditorName || t.creditor || "").trim();
  const type = String(t.accountType || t.account_type || "").toLowerCase();
  const opened = openedDay(t.openedDate ?? t.accountOpenedDate ?? t.dateOpened);
  const identifier = t.accountIdentifier ?? t.account_ref ?? t.accountNumber ?? t.account_number;
  return {
    creditor,
    creditorKey: slugify(creditor),
    type,
    opened,
    last4: lastFour(identifier),
    print: accountPrint(opened, identifier)
  };
}

const thingFor = (type) => (type === "revolving" ? "card" : type === "installment" ? "loan" : type === "mortgage" ? "mortgage" : "account");

/**
 * diffCreditPulls(prev, latest, { prevOn }) → { comparable, reason, tradelines, inquiries, unknown }
 *
 *   prev, latest  the stored `crs_results.result` payloads, older and newer
 *   prevOn        the day the older pull was taken, "YYYY-MM-DD"
 *
 * `comparable: false` carries a `reason` and empty lists — see the guards in the
 * header. `unknown` counts the new-looking accounts that carry no print and so
 * could not be called new (reported for the dry run, never alerted).
 */
export function diffCreditPulls(prev, latest, { prevOn } = {}) {
  const none = (reason) => ({ comparable: false, reason, tradelines: [], inquiries: [], unknown: 0 });
  const before = tradelinesOf(prev);
  if (before.length === 0) return none("previous_pull_has_no_accounts");

  const lb = bureausOf(latest);
  const pb = bureausOf(prev);
  if (lb && pb && lb.some((b) => !pb.includes(b))) return none("bureau_set_changed");

  const prevPrints = new Set();
  const prevCreditorOpened = new Set();
  for (const t of before) {
    const d = describeLine(t);
    if (d.print) prevPrints.add(d.print);
    if (d.creditorKey && d.opened) prevCreditorOpened.add(`${d.creditorKey}|${d.opened}`);
  }

  const tradelines = [];
  const seenPrints = new Set();
  let unknown = 0;
  for (const t of tradelinesOf(latest)) {
    const d = describeLine(t);
    if (!d.print) { unknown += 1; continue; }
    if (prevPrints.has(d.print)) continue;
    if (d.creditorKey && d.opened && prevCreditorOpened.has(`${d.creditorKey}|${d.opened}`)) continue;
    if (seenPrints.has(d.print)) continue; // a tri-merge lists one card once per bureau
    seenPrints.add(d.print);
    tradelines.push({
      source: "credit_pull", type: thingFor(d.type), creditor: d.creditor || null,
      opened: d.opened, last4: d.last4, print: d.print
    });
  }

  // Inquiries: bureau-agnostic (one lender pulling three bureaus is one inquiry),
  // and only ones dated on or after the older pull (less two days of reporting lag).
  const floor = parseFloorDay(prevOn);
  const prevInquiries = new Set();
  for (const i of inquiriesOf(prev)) {
    const c = slugify(i.creditorName || i.creditor || i.subscriber || "");
    const day = openedDay(i.date || i.inquiryDate);
    if (c && day) prevInquiries.add(`${c}|${day}`);
  }
  const inquiries = [];
  const seenInq = new Set();
  for (const i of inquiriesOf(latest)) {
    const creditor = String(i.creditorName || i.creditor || i.subscriber || "").trim();
    const c = slugify(creditor);
    const day = openedDay(i.date || i.inquiryDate);
    if (!c || !day) continue;
    const k = `${c}|${day}`;
    if (prevInquiries.has(k) || seenInq.has(k)) continue;
    if (floor && day < floor) continue;
    seenInq.add(k);
    inquiries.push({ source: "credit_pull", type: "inquiry", creditor, date: day, bureau: String(i.source || i.bureau || "").toUpperCase() || null });
  }

  return { comparable: true, reason: null, tradelines, inquiries, unknown };
}

function parseFloorDay(prevOn) {
  return typeof prevOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(prevOn) ? addDaysIso(prevOn, -2) : null;
}

/**
 * planNewPull(diff, { pullId, knownLast4 }) → the one alert for this pull, or null.
 *
 * ONE ALERT PER PULL, not one per item: a pull that shows an inquiry and the card
 * it was for is one piece of news. Items whose last four an earlier alert already
 * named are dropped first.
 */
export function planNewPull(diff, { pullId, knownLast4 = new Set() } = {}) {
  if (!diff || !diff.comparable || !pullId) return null;
  const known = knownLast4 instanceof Set ? knownLast4 : new Set();
  const tradelines = diff.tradelines.filter((t) => !(t.last4 && known.has(t.last4)));
  const inquiries = diff.inquiries;
  if (tradelines.length === 0 && inquiries.length === 0) return null;

  const parts = [];
  if (tradelines.length) {
    const n = tradelines.length;
    const list = listWords(tradelines.map((t) => `${t.creditor || "a creditor"}${t.opened ? `, opened ${shortDate(t.opened)}` : ""}`));
    parts.push(`${n} new ${n === 1 ? "account" : "accounts"} (${list})`);
  }
  if (inquiries.length) {
    const n = inquiries.length;
    const list = listWords(inquiries.map((i) => `${i.creditor}, ${shortDate(i.date)}`));
    parts.push(`${n} new ${n === 1 ? "inquiry" : "inquiries"} (${list})`);
  }
  const what = `your latest credit pull shows ${parts.join(" and ")}`;
  const key = `fpa:new:pull:${pullId}`;
  const body = `Fundhub alert: ${what}. New credit can push back your next funding sequence. If this is not yours, reply and tell us.`;
  return {
    alert: true,
    kind: "new_credit",
    key,
    templateKey: TEMPLATES.new_credit,
    bankAccountId: null,
    label: "your latest credit pull",
    threshold: null,
    dueOn: null,
    tags: { what },
    body,
    task: taskFor(key, body),
    detail: { source: "credit_pull", pull_id: pullId, items: [...tradelines, ...inquiries] }
  };
}

export default planNewAccounts;
