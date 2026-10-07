// The plan-source registry — every dated thing a client should do or pay, from
// every source, as one list of pins (GET /api/money/plan, the FinanceOS Plan tab).
//
// THE PIN SHAPE IS A CONTRACT, written on the wave 5 board
// (ops/workflows/finance-os-wave5-2026-10-06.md, "Shared contract — plan pins"):
//
//   export const name = "bank-strategy";
//   export async function pins(db, { orgId, clientId, from, to, env }) → [{
//     id, date: "YYYY-MM-DD", kind, title, detail, amount_cents (or null),
//     bank (or null), container_id (or null), status, source }]
//
// Two optional additions, both owned here:
//   * `can_mark` on a pin — the statuses ("done", "missed") staff may set on it.
//     Honoured only when the source also exports mark(); otherwise it is [].
//   * `mark(db, { orgId, clientId, pinId, status, at, now, today })` on a source —
//     the source's own writer, with its own proof rules. Returns
//     { ok: true, changed, pin } or { ok: false, reason, message? }.
//
// The call object also carries `today` ('YYYY-MM-DD', UTC) and `now` (a Date),
// so every source works out "late" against the same clock. A source written to
// the contract alone may ignore both.
//
// WHAT THIS FILE PROMISES:
//   * Every registered source runs. One that throws, or answers with something
//     that is not a list, gets { name, ok: false, error } in `sources` and the
//     others still show. A failed source is never an empty one.
//   * Pins are de-duplicated by id (the first source in SOURCES wins), kept to
//     the window, and sorted by date, then kind, then title, then id.
//   * A pin's `source` is the registry name of the source that returned it — a
//     pin cannot claim another source, so a mark always reaches the writer that
//     owns the row.
//   * Money is integer cents; anything else is null, never 0.
//
// ADDING A SOURCE: put src/finance/plan-sources/<name>.mjs next to this file and
// add it to SOURCES below. W2 (bank-strategy, funding-rounds) and W4 (payoff)
// are registered by the orchestrator at merge.

import * as waypoints from "./waypoints.mjs";
import * as dues from "./dues.mjs";
import * as clarity from "./clarity.mjs";
import * as bankStrategy from "./bank-strategy.mjs";
import * as fundingRounds from "./funding-rounds.mjs";
import * as payoff from "./payoff.mjs";
import * as agent from "./agent.mjs";
import { parseIsoDate } from "../../banking/statement-cycles.mjs";
import { safeError } from "../../http/health.mjs";

export const PIN_KINDS = Object.freeze(["open_account", "deposit", "pay_down", "apply", "due", "checkpoint", "other"]);
export const PIN_STATUSES = Object.freeze(["planned", "done", "missed"]);
export const MARK_STATUSES = Object.freeze(["done", "missed"]);

/** Registered sources, in de-dupe priority order. */
export const SOURCES = Object.freeze([waypoints, dues, clarity, bankStrategy, fundingRounds, payoff, agent]);

const text = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());

function isoDate(v) {
  const s = typeof v === "string" ? v.trim() : "";
  return parseIsoDate(s) ? s : null;
}

/* Integer cents or null. A numeric string (pg bigint) is read; a fraction,
   NaN or anything else is unknown, never 0. */
function centsOrNull(v) {
  if (typeof v === "number") return Number.isSafeInteger(v) ? v : null;
  if (typeof v === "string" && /^-?\d+$/.test(v.trim())) {
    const n = Number(v.trim());
    return Number.isSafeInteger(n) ? n : null;
  }
  return null;
}

/**
 * One raw pin → the contract shape, or null when it cannot be shown (no id, no
 * real date, no title, or outside the window). Extra fields a source adds (a
 * citation, say) are kept; the contract fields are always the normalised ones.
 */
export function normalizePin(raw, sourceName, { from, to, markable = false } = {}) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = text(raw.id);
  const date = isoDate(raw.date);
  const title = text(raw.title);
  if (!id || !date || !title) return null;
  if ((from && date < from) || (to && date > to)) return null;
  const marks = markable && Array.isArray(raw.can_mark)
    ? MARK_STATUSES.filter((s) => raw.can_mark.includes(s))
    : [];
  return {
    ...raw,
    id,
    date,
    kind: PIN_KINDS.includes(raw.kind) ? raw.kind : "other",
    title,
    detail: text(raw.detail),
    amount_cents: centsOrNull(raw.amount_cents),
    bank: text(raw.bank),
    container_id: text(raw.container_id),
    status: PIN_STATUSES.includes(raw.status) ? raw.status : "planned",
    source: sourceName,
    can_mark: marks
  };
}

const KIND_ORDER = new Map(PIN_KINDS.map((k, i) => [k, i]));

/** Date, then kind (contract order), then title, then id. */
export function comparePins(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  const ka = KIND_ORDER.get(a.kind) ?? 99;
  const kb = KIND_ORDER.get(b.kind) ?? 99;
  if (ka !== kb) return ka - kb;
  const t = String(a.title).localeCompare(String(b.title));
  if (t !== 0) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Lists of normalised pins → one de-duplicated, sorted list. First id wins. */
export function mergePins(lists = []) {
  const seen = new Map();
  for (const list of lists) {
    for (const p of Array.isArray(list) ? list : []) {
      if (p && !seen.has(p.id)) seen.set(p.id, p);
    }
  }
  return [...seen.values()].sort(comparePins);
}

function sourceName(src, i) {
  return typeof src?.name === "string" && src.name ? src.name : `source-${i + 1}`;
}

/**
 * allPins(db, { orgId, clientId, from, to, env }) → { pins, sources }
 *
 *   pins     the merged list (see the promises at the top of this file)
 *   sources  one entry per registered source, in SOURCES order:
 *            { name, ok: true, count } or { name, ok: false, error }
 *
 * `today` and `now` are optional; they default to the moment of the call.
 * `sources` may be passed to run a different list (tests, a one-off read).
 * A failed source's reason goes to `log` (the server log), never to the
 * caller: the answer only says which part did not load.
 */
export async function allPins(db, {
  orgId, clientId, from, to, env = {}, now = new Date(), today = null, sources = SOURCES,
  log = (msg) => console.error(msg)
} = {}) {
  const day = isoDate(today) ?? new Date(now).toISOString().slice(0, 10);
  const list = Array.isArray(sources) ? sources : [];
  const args = { orgId, clientId, from, to, env, now, today: day };

  const settled = await Promise.allSettled(list.map((src) => {
    if (!src || typeof src.pins !== "function") return Promise.reject(new Error("source has no pins()"));
    try {
      return Promise.resolve(src.pins(db, { ...args }));
    } catch (e) {
      return Promise.reject(e);
    }
  }));

  const report = [];
  const lists = [];
  settled.forEach((r, i) => {
    const src = list[i];
    const nm = sourceName(src, i);
    if (r.status === "rejected") {
      log(`plan source ${nm} failed: ${safeError(r.reason)}`);
      report.push({ name: nm, ok: false, error: "load_failed" });
      return;
    }
    if (!Array.isArray(r.value)) {
      report.push({ name: nm, ok: false, error: "not_a_list" });
      return;
    }
    const markable = typeof src.mark === "function";
    const pins = r.value.map((p) => normalizePin(p, nm, { from, to, markable })).filter(Boolean);
    report.push({ name: nm, ok: true, count: pins.length });
    lists.push(pins);
  });

  return { pins: mergePins(lists), sources: report };
}

/**
 * markPin — hand a staff mark to the source that owns the pin.
 * Returns the source's answer, or { ok: false, reason } when no source can
 * take it: 'unknown_source', 'not_markable' (the source has no writer), or
 * 'bad_status'.
 */
export async function markPin(db, {
  orgId, clientId, source, pinId, status, at = null, now = new Date(), today = null, sources = SOURCES
} = {}) {
  if (!MARK_STATUSES.includes(status)) return { ok: false, reason: "bad_status" };
  const list = Array.isArray(sources) ? sources : [];
  const src = list.find((s, i) => sourceName(s, i) === source);
  if (!src) return { ok: false, reason: "unknown_source" };
  if (typeof src.mark !== "function") {
    return { ok: false, reason: "not_markable", message: "Dates from this part of the plan cannot be marked here." };
  }
  const day = isoDate(today) ?? new Date(now).toISOString().slice(0, 10);
  const out = await src.mark(db, { orgId, clientId, pinId, status, at, now, today: day });
  if (out && out.ok && out.pin) {
    const pin = normalizePin(out.pin, sourceName(src, list.indexOf(src)), { markable: true });
    return { ...out, pin };
  }
  return out || { ok: false, reason: "not_found" };
}
