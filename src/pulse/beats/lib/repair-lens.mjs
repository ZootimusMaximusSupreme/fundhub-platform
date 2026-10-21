/* Repair desk lens — pure. Row facts in → chip + due words out.
 *
 * No database. No clock unless the caller passes `asOf`.
 * Spec: ops/workflows/repair-build-spec-2026-08-21.md §8–§9.
 * The API ships facts; this module draws conclusions (same split as
 * src/fulfillment/next-action.mjs).
 *
 * WHY THIS FILE IS IN THE BEAT LIBRARY (2026-10-20): it used to be
 * src/repair/lens.mjs. It moved here whole and unchanged so the progress timeline
 * the hourly pulse reads renders with the same timelineLine() (a beat may import
 * only from src/pulse/beats/lib). src/repair/lens.mjs re-exports everything here.
 */

/** First-match-wins chip dictionary (§8). One action chip per client. */
export const CHIPS = Object.freeze([
  Object.freeze({ key: "needs_agreement", label: "Needs agreement" }),
  Object.freeze({ key: "review_answer", label: "Read their answer" }),
  Object.freeze({ key: "send_letters", label: "Send letters" }),
  Object.freeze({ key: "stuck", label: "Stuck" }),
  Object.freeze({ key: "waiting_on_bureau", label: "Waiting on the bureau" }),
  Object.freeze({ key: "round_done", label: "Round done — next?" }),
  Object.freeze({ key: "trial_done", label: "Trial done — sales" }),
  Object.freeze({ key: "none", label: "—" })
]);

export const CHIP_BY_KEY = Object.freeze(
  Object.fromEntries(CHIPS.map((c) => [c.key, c]))
);

/** Secondary warning dots — can coexist with the action chip. */
export const WARNING_DOTS = Object.freeze({
  no_address: Object.freeze({ key: "no_address", label: "no address on file" }),
  no_furnisher_address: Object.freeze({
    key: "no_furnisher_address",
    label: "no furnisher address"
  })
});

/** Tile filter keys (§8.1). Press a tile → show only matching rows. */
export const TILE_FILTERS = Object.freeze([
  "need",
  "ready",
  "wait",
  "stuck",
  "trial"
]);

function truthy(v) {
  return v === true;
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Round display: "1 / 2" from round key (R1) and rounds_cap.
 * Never invents a dollar amount.
 */
export function roundLabel(row = {}) {
  const cap = num(row.rounds_cap);
  const raw = row.round == null ? "" : String(row.round);
  const m = raw.match(/R(\d+)/i);
  const n = m ? Number(m[1]) : null;
  if (n != null && cap > 0) return `${n} / ${cap}`;
  if (n != null) return String(n);
  if (cap > 0) return `— / ${cap}`;
  return raw || "—";
}

/**
 * dueWords — countdown from response_due_at.
 * Returns { text, tone } where tone is "ok" | "late" | "dim".
 */
export function dueWords(responseDueAt, asOf) {
  if (!responseDueAt) return { text: "—", tone: "dim" };
  const due = new Date(responseDueAt).getTime();
  const now = new Date(asOf || Date.now()).getTime();
  if (!Number.isFinite(due) || !Number.isFinite(now)) {
    return { text: "—", tone: "dim" };
  }
  const dayMs = 86400000;
  const diffDays = Math.round((due - now) / dayMs);
  if (diffDays > 0) {
    const unit = diffDays === 1 ? "day" : "days";
    return { text: `due in ${diffDays} ${unit}`, tone: "ok" };
  }
  if (diffDays === 0) return { text: "due today", tone: "ok" };
  const overdue = Math.abs(diffDays);
  const unit = overdue === 1 ? "day" : "days";
  return { text: `overdue ${overdue} ${unit}`, tone: "late" };
}

/**
 * Warning dots from row facts. Never invents dollars.
 */
export function warningDots(row = {}) {
  const out = [];
  if (row.address_ok === false) out.push(WARNING_DOTS.no_address);
  if (row.no_furnisher_address === true) out.push(WARNING_DOTS.no_furnisher_address);
  return out;
}

/**
 * deriveChip — first match wins. Returns { key, label }.
 *
 * Expected facts on `row` (§9):
 *   authorization_ok, has_unconfirmed_parse, letters_ready, letters_sent,
 *   stage_key, sla_breached, upsell_pending, rounds_cap, round
 */
export function deriveChip(row = {}) {
  if (row.authorization_ok === false) return CHIP_BY_KEY.needs_agreement;
  if (truthy(row.has_unconfirmed_parse)) return CHIP_BY_KEY.review_answer;

  const ready = num(row.letters_ready);
  const sent = num(row.letters_sent);
  if (ready > 0 && sent === 0) return CHIP_BY_KEY.send_letters;
  if (row.can_send === true && sent === 0) return CHIP_BY_KEY.send_letters;

  const stage = String(row.stage_key || "");
  if (stage === "stalled" || truthy(row.sla_breached)) return CHIP_BY_KEY.stuck;

  if (stage === "in_transit" || stage === "awaiting_response") {
    return CHIP_BY_KEY.waiting_on_bureau;
  }

  if (stage === "round_complete") return CHIP_BY_KEY.round_done;

  if (truthy(row.upsell_pending) || String(row.program_status || "") === "upsell_pending") {
    return CHIP_BY_KEY.trial_done;
  }

  return CHIP_BY_KEY.none;
}

/**
 * Which tile filters this row belongs to. A row can sit in more than one
 * (e.g. send_letters → need + ready).
 */
export function tileSets(row = {}, chip = null) {
  const c = chip || deriveChip(row);
  const sets = new Set();
  const stage = String(row.stage_key || "");

  if (
    c.key === "needs_agreement" ||
    c.key === "review_answer" ||
    c.key === "send_letters" ||
    c.key === "round_done" ||
    row.need_me === true
  ) {
    sets.add("need");
  }
  if (
    c.key === "send_letters" ||
    stage === "ready_to_send" ||
    (num(row.letters_ready) > 0 && num(row.letters_sent) === 0)
  ) {
    sets.add("ready");
  }
  if (
    c.key === "waiting_on_bureau" ||
    stage === "awaiting_response" ||
    stage === "in_transit"
  ) {
    sets.add("wait");
  }
  if (c.key === "stuck" || stage === "stalled" || truthy(row.sla_breached)) {
    sets.add("stuck");
  }
  if (c.key === "trial_done" || truthy(row.upsell_pending)) {
    sets.add("trial");
  }
  return [...sets];
}

/**
 * Rollups from a file list — tiles must match table math.
 * Em-dashes are a UI concern; this returns numbers (or null when unknown).
 */
export function rollupCounts(files = []) {
  const list = Array.isArray(files) ? files : [];
  let need = 0;
  let ready = 0;
  let wait = 0;
  let stuck = 0;
  let trial = 0;
  for (const f of list) {
    if (!f) continue;
    const chip = deriveChip(f);
    const sets = tileSets(f, chip);
    if (sets.includes("need")) need += 1;
    if (sets.includes("ready")) ready += 1;
    if (sets.includes("wait")) wait += 1;
    if (sets.includes("stuck")) stuck += 1;
    if (sets.includes("trial")) trial += 1;
  }
  return {
    need_me: need,
    ready,
    waiting: wait,
    stalled: stuck,
    trial_ending: trial
  };
}

/**
 * Plain-words timeline line from a decision log row.
 */
export function timelineLine(row = {}) {
  const action = String(row.action || row.decision || "").trim();
  const ts = row.ts || row.created_at || null;
  let when = "";
  if (ts) {
    const d = new Date(ts);
    if (Number.isFinite(d.getTime())) {
      when = d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        timeZone: "America/Los_Angeles"
      });
    }
  }
  const words = action
    ? action.replace(/[._]/g, " ").replace(/\s+/g, " ").trim()
    : "update";
  return when ? `${when} · ${words}` : words;
}
