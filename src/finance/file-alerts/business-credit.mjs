// Business credit alerts — a business's saved score changed between its last two
// reports. Alerts bundle, unit AL (owner go part 4, idea 5, 2026-11-07).
//
// PURE. No database, no clock: `now` is a parameter.
//
// WHERE THE SCORE COMES FROM. A live credit pull orders one Experian Business
// report per saved company and stores each on crs_results.result.businessReports[]
// (src/finance/crs-pull.mjs). businessScoreFromPulls (src/http/client-detail.mjs)
// reads one company's Intelliscore and FSR off that report — the same two fields
// UnderwriteIQ reads — and skips sandbox pulls. This file calls it on ONE pull at a
// time, so it gets that same number for every report the company has, newest first,
// without a second copy of the reader.
//
// WHAT COUNTS AS A CHANGE. The newest report against the one before it, field by
// field. A field counts only when both reports have it: a score that shows up for
// the first time is not a change, and a missing one is never read as zero.
//
// WHEN IT TEXTS. Only for a newest report pulled within the last few days (the
// new-credit alert's window), only off a real report (a sample report never
// texts), and once per business per report: the key is the business and the pull.
//
// THE WORDS. "A business credit score on your file went up." No business name, no
// number — the text shows on a locked phone. The screen shows both scores.

import { businessScoreFromPulls } from "../../http/client-detail.mjs";
import { DAY_MS, toMs, isoDay } from "./common.mjs";
import { BUNDLE_TEMPLATES, BUSINESS_LOOKBACK_DAYS, lockScreenSafe } from "./bundle-common.mjs";

const FIELDS = Object.freeze(["intelliscore", "fsr"]);

/**
 * businessReadings(pulls, business) → [{ pull_id, on, intelliscore, fsr, sample }]
 * newest first, one per pull that holds a report for this company.
 *   pulls     crs_results rows { id, created_at, result }
 *   business  a businesses row { id, name, entity_data }
 */
export function businessReadings(pulls = [], business = null) {
  if (!business) return [];
  const rows = [...(Array.isArray(pulls) ? pulls : [])]
    .filter((p) => p && p.id)
    .sort((a, b) => (toMs(b.created_at) ?? 0) - (toMs(a.created_at) ?? 0));
  const out = [];
  for (const pull of rows) {
    const read = businessScoreFromPulls([pull], business);
    if (!read.found) continue;
    out.push({
      pull_id: String(pull.id),
      on: isoDay(pull.created_at instanceof Date ? pull.created_at : String(pull.created_at ?? "")),
      pulled_at: pull.created_at ?? null,
      intelliscore: read.intelliscore,
      fsr: read.fsr,
      sample: read.sample === true
    });
  }
  return out;
}

/** compareReadings(latest, previous) → what moved, field by field. */
export function compareReadings(latest, previous) {
  const out = { intelliscore: null, fsr: null, direction: null, comparable: false };
  if (!latest || !previous) return out;
  const moves = [];
  for (const f of FIELDS) {
    const to = latest[f];
    const from = previous[f];
    if (!Number.isFinite(to) || !Number.isFinite(from)) continue;
    out[f] = { from, to, delta: to - from };
    moves.push(Math.sign(to - from));
  }
  if (!moves.length) return out;
  out.comparable = true;
  const up = moves.includes(1);
  const down = moves.includes(-1);
  out.direction = up && down ? "mixed" : up ? "up" : down ? "down" : "same";
  return out;
}

/** The words for a direction. */
export const CHANGE_WORDS = Object.freeze({ up: "went up", down: "went down", mixed: "changed" });

export function businessBody(changeWords) {
  return `Fundhub alert: a business credit score on your file ${changeWords} on its newest report. Open Fundhub to see it.`;
}

/** businessCreditView(business, pulls) → one business's line on the screen. */
export function businessCreditView(business = {}, pulls = []) {
  const readings = businessReadings(pulls, business);
  const [latest = null, previous = null] = readings;
  return {
    business_id: business.id ?? null,
    name: business.name ?? null,
    reports: readings.length,
    latest,
    previous,
    change: latest && previous ? compareReadings(latest, previous) : null
  };
}

/**
 * planBusinessCredit(business, pulls, { now }) → { alert: false, reason } | the alert
 */
export function planBusinessCredit(business, pulls, { now } = {}) {
  const skip = (reason, extra = {}) => ({ alert: false, kind: "business_credit", reason, ...extra });
  const nowMs = toMs(now);
  if (nowMs === null) return skip("bad_now");
  if (!business || !business.id || !String(business.name || "").trim()) return skip("no_business");

  const view = businessCreditView(business, pulls);
  if (!view.latest) return skip("no_report");
  if (!view.previous) return skip("only_one_report");
  if (view.latest.sample) return skip("sample_report");
  const pulledMs = toMs(view.latest.pulled_at);
  if (pulledMs === null || nowMs - pulledMs > BUSINESS_LOOKBACK_DAYS * DAY_MS) return skip("report_too_old_to_alert");
  const change = view.change;
  if (!change.comparable) return skip("no_score_on_both_reports");
  if (change.direction === "same") return skip("no_change");

  const words = CHANGE_WORDS[change.direction];
  const body = businessBody(words);
  if (!lockScreenSafe(body)) return skip("unsafe_words");
  return {
    alert: true,
    kind: "business_credit",
    key: `fpa:biz:${business.id}:${view.latest.pull_id}`,
    templateKey: BUNDLE_TEMPLATES.business_credit,
    bankAccountId: null,
    // For the screen and the logs only. The text never names the business.
    label: String(business.name).trim(),
    threshold: null,
    dueOn: view.latest.on,
    tags: { change: words },
    body,
    detail: {
      business_id: String(business.id),
      latest_pull_id: view.latest.pull_id,
      previous_pull_id: view.previous.pull_id,
      intelliscore: change.intelliscore,
      fsr: change.fsr,
      direction: change.direction
    }
  };
}

export default planBusinessCredit;
