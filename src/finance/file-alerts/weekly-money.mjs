// Weekly money text — money in, card use, seasoning, steps left. Alerts bundle,
// unit AL (owner go part 4, idea 7, 2026-11-07).
//
// PURE. No database, no clock, no send. The job that queues the text is
// src/workflows/finance-os-weekly-money.mjs; the reads are ./bundle-store.mjs.
//
// WHEN. Monday 9 a.m. Arizona, about the seven days before (Monday to Sunday).
// Customer drips go only 9 a.m. to 5 p.m. Arizona (owner-set 2026-10-31): the job
// queues only inside that window. ONE TEXT PER CLIENT PER WEEK: the key is the
// client and that Monday.
//
// WHAT IT SAYS, IN PLAIN WORDS AND NO AMOUNTS (the text shows on a locked phone):
//   money in   how many times money came in, personal and business told apart.
//              A move between the client's own accounts is not money in.
//   cards      how many cards are over 10% of their limit, per kind
//   seasoning  the newest bank account that is not seasoned yet: "day N of 30"
//   steps      how many plan steps are still open
// Anything unknown is left out — never said as zero. With nothing known at all,
// no text goes.
//
// PERSONAL AND BUSINESS ARE NEVER ADDED. Money in and card use are counted per
// kind. An account or card whose kind is not sorted yet is in neither count.

import { parseIsoDate, daysBetween } from "../../banking/statement-cycles.mjs";
import { tzOffsetMs, SEND_WINDOW_TZ } from "../../messaging/send-window.mjs";
import { addDaysIso, isoDay, toCentsOrNull } from "./common.mjs";
import {
  BUNDLE_TEMPLATES, CARD_TARGET_PCT, SEASONED_DAYS, SEASONED_BETTER_DAYS, WEEK_DAYS,
  OWN_TRANSFER_MATCH_DAYS, OWN_TRANSFER_CATEGORY, lockScreenSafe, count
} from "./bundle-common.mjs";

export const CASH_KINDS = Object.freeze(["personal", "business"]);

/** The Arizona calendar day of an instant, "YYYY-MM-DD". */
export function arizonaDay(now) {
  const at = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(at.getTime())) return null;
  return new Date(at.getTime() + tzOffsetMs(at, SEND_WINDOW_TZ)).toISOString().slice(0, 10);
}

/**
 * weekOf(now) → { monday, from, to }
 *   monday  the Monday of this week in Arizona (the key's date)
 *   from/to the seven days before it, Monday to Sunday, inclusive
 */
export function weekOf(now) {
  const day = arizonaDay(now);
  const d = parseIsoDate(day);
  if (!d) return null;
  const weekday = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay(); // 0 Sunday
  const monday = addDaysIso(day, -((weekday + 6) % 7));
  return { monday, from: addDaysIso(monday, -WEEK_DAYS), to: addDaysIso(monday, -1) };
}

/** The next Monday 9 a.m. send, as an Arizona day: today if it is Monday before 9. */
export function nextWeeklyDay(now) {
  const at = now instanceof Date ? now : new Date(now);
  const day = arizonaDay(at);
  const d = parseIsoDate(day);
  if (!d) return null;
  const weekday = new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
  const hour = new Date(at.getTime() + tzOffsetMs(at, SEND_WINDOW_TZ)).getUTCHours();
  if (weekday === 1 && hour < 9) return day;
  return addDaysIso(day, ((8 - weekday) % 7) || 7);
}

/**
 * moneyInWeek({ rows, accounts, meta, from, to }) → { personal, business }
 *   each { known, count, cents } — known false means no linked account of that
 *   kind, so count and cents are null (unknown, never 0).
 *
 *   rows      bank_transactions { bank_account_id, amount_cents, posted_on, category }
 *             (085's sign: positive is money in), read a few days either side of
 *             the week so a move between two of the client's own accounts is seen
 *   accounts  the overview's accounts { id, type, kind }
 *   meta      the snapshot's account meta { id, plaid_item_id, closed_at }
 */
export function moneyInWeek({ rows = [], accounts = [], meta = [], from, to } = {}) {
  const metaById = new Map((Array.isArray(meta) ? meta : []).map((m) => [String(m.id), m]));
  const kindOf = new Map();
  const out = {};
  for (const k of CASH_KINDS) out[k] = { known: false, count: null, cents: null };
  for (const a of Array.isArray(accounts) ? accounts : []) {
    if (!a || a.type !== "depository" || !CASH_KINDS.includes(a.kind)) continue;
    kindOf.set(String(a.id), a.kind);
    const m = metaById.get(String(a.id));
    // Only a linked feed can say "nothing came in". A hand-entered account cannot.
    if (m && m.plaid_item_id && !m.closed_at) out[a.kind] = { known: true, count: 0, cents: 0 };
  }

  const all = (Array.isArray(rows) ? rows : [])
    .map((r) => ({ account: String(r.bank_account_id), cents: toCentsOrNull(r.amount_cents), on: isoDay(r.posted_on), category: r.category ? String(r.category) : "" }))
    .filter((r) => r.cents !== null && r.on);
  const outflows = all.filter((r) => r.cents < 0);
  const used = new Set();
  for (const r of all) {
    if (r.cents <= 0) continue;
    const kind = kindOf.get(r.account);
    if (!kind || !out[kind].known) continue;
    if (daysBetween(from, r.on) < 0 || daysBetween(r.on, to) < 0) continue;
    if (OWN_TRANSFER_CATEGORY.test(r.category)) continue;
    // The same amount leaving another of their own accounts within a few days.
    const twin = outflows.findIndex((o, i) => !used.has(i) && o.account !== r.account && o.cents === -r.cents
      && Math.abs(daysBetween(o.on, r.on)) <= OWN_TRANSFER_MATCH_DAYS);
    if (twin >= 0) { used.add(twin); continue; }
    out[kind].count += 1;
    out[kind].cents += r.cents;
  }
  return out;
}

/**
 * cardUse(cards) → { personal, business, unsorted }
 *   personal / business  { cards, known, over } — cards with a known use, and how
 *   many are over 10%. unsorted: cards whose kind is not set (in neither count).
 */
export function cardUse(cards = []) {
  const out = { personal: { cards: 0, known: 0, over: 0 }, business: { cards: 0, known: 0, over: 0 }, unsorted: 0 };
  for (const c of Array.isArray(cards) ? cards : []) {
    if (!c) continue;
    if (!CASH_KINDS.includes(c.kind)) { out.unsorted += 1; continue; }
    const k = out[c.kind];
    k.cards += 1;
    const pct = c.used_pct === null || c.used_pct === undefined ? null : Number(c.used_pct);
    if (!Number.isFinite(pct)) continue;
    k.known += 1;
    if (pct > CARD_TARGET_PCT) k.over += 1;
  }
  return out;
}

/**
 * seasoningClock(relationships, { today }) → { accounts, opened, seasoned, newest }
 *   relationships  blueprint_bank_relationship_todos rows with an opened_on
 *   accounts       [{ id, bank, opened_on, days_open, seasoned, seasoned_on, better }]
 *   newest         the newest opened account that is not seasoned yet, or null
 */
export function seasoningClock(relationships = [], { today } = {}) {
  const accounts = [];
  for (const r of Array.isArray(relationships) ? relationships : []) {
    if (!r || r.state === "skipped") continue;
    const opened = isoDay(r.opened_on);
    if (!opened) continue;
    const days = daysBetween(opened, today);
    if (days === null || days < 0) continue;
    accounts.push({
      id: r.id ?? null,
      bank: (r.bank_name && String(r.bank_name).trim()) || r.bank_key || null,
      opened_on: opened,
      days_open: days,
      seasoned: days >= SEASONED_DAYS,
      seasoned_on: addDaysIso(opened, SEASONED_DAYS),
      better: SEASONED_BETTER_DAYS.map((n) => ({ days: n, on: addDaysIso(opened, n), reached: days >= n }))
    });
  }
  accounts.sort((a, b) => a.days_open - b.days_open);
  const waiting = accounts.filter((a) => !a.seasoned);
  return {
    accounts,
    opened: accounts.length,
    seasoned: accounts.length - waiting.length,
    newest: waiting.length ? waiting[0] : null
  };
}

const KIND_WORD = { personal: "personal", business: "business" };

/**
 * weeklySummary({ moneyIn, cards, seasoning, openSteps }) → { lines, summary, empty }
 * The sentences, in the order they are read. `summary` is what the template's
 * {{alert.summary}} holds: each sentence led by a space.
 */
export function weeklySummary({ moneyIn = {}, cards = {}, seasoning = null, openSteps = null } = {}) {
  const lines = [];
  for (const k of CASH_KINDS) {
    const m = moneyIn[k];
    if (!m || !m.known) continue;
    lines.push(m.count === 0
      ? `No money came in to your ${KIND_WORD[k]} accounts this week.`
      : `Money came in ${count(m.count, "time", "times")} to your ${KIND_WORD[k]} accounts this week.`);
  }
  for (const k of CASH_KINDS) {
    const c = cards[k];
    if (!c || !c.known) continue;
    const word = KIND_WORD[k];
    const is = (n) => (n === 1 ? "is" : "are");
    // Every card's use known: speak of all of them. Some unknown: only count what we read.
    const allKnown = !Number.isInteger(c.cards) || c.cards <= c.known;
    if (allKnown && c.known === 1) {
      lines.push(`Your ${word} card is ${c.over === 0 ? "under" : "over"} ${CARD_TARGET_PCT}%.`);
    } else if (allKnown && c.over === 0) {
      lines.push(`Your ${word} cards are all under ${CARD_TARGET_PCT}%.`);
    } else if (allKnown && c.over === c.known) {
      lines.push(`All ${c.known} of your ${word} cards are over ${CARD_TARGET_PCT}%.`);
    } else if (allKnown) {
      lines.push(`${c.over} of your ${c.known} ${word} cards ${is(c.over)} over ${CARD_TARGET_PCT}%.`);
    } else if (c.over > 0) {
      lines.push(`${count(c.over, `${word} card`, `${word} cards`)} ${is(c.over)} over ${CARD_TARGET_PCT}%.`);
    } else {
      lines.push(`${count(c.known, `${word} card`, `${word} cards`)} ${is(c.known)} under ${CARD_TARGET_PCT}%.`);
    }
  }
  if (seasoning && seasoning.opened > 0) {
    lines.push(seasoning.newest
      ? `Your newest bank account is on day ${seasoning.newest.days_open} of ${SEASONED_DAYS}.`
      : `Your ${seasoning.opened === 1 ? "bank account is" : "bank accounts are all"} seasoned.`);
  }
  if (Number.isInteger(openSteps) && openSteps > 0) {
    lines.push(`You have ${count(openSteps, "step", "steps")} left in your plan.`);
  }
  return { lines, summary: lines.map((l) => ` ${l}`).join(""), empty: lines.length === 0 };
}

export function weeklyBody(summary) {
  return `Fundhub weekly:${summary} Open Fundhub to see the numbers and your next step.`;
}

/**
 * planWeeklyMoney({ clientId, week, summary }) → { alert: false, reason } | the text
 */
export function planWeeklyMoney({ clientId, week, summary } = {}) {
  const skip = (reason) => ({ alert: false, kind: "weekly_money", reason });
  if (!clientId) return skip("no_client");
  if (!week || !parseIsoDate(week.monday)) return skip("bad_week");
  if (!summary || summary.empty) return skip("nothing_to_say");
  const body = weeklyBody(summary.summary);
  if (!lockScreenSafe(body)) return skip("unsafe_words");
  return {
    alert: true,
    kind: "weekly_money",
    key: `fpa:week:${clientId}:${week.monday}`,
    templateKey: BUNDLE_TEMPLATES.weekly_money,
    bankAccountId: null,
    label: "Weekly money text",
    threshold: null,
    dueOn: week.monday,
    tags: { summary: summary.summary },
    body,
    detail: { week_from: week.from, week_to: week.to, lines: summary.lines }
  };
}

export default planWeeklyMoney;
