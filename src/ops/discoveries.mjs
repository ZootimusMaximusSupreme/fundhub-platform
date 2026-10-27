// Learn from real rows. Do not invent an average.
//
// A rate is LEARNED only when n >= MIN_N_RATE.
// Call minutes are LEARNED only when timed calls >= MIN_N_TIME.
// Below that, the finding is "not enough data" — that is still a discovery.

import { CLOSER_LOGGED_CALL_MINUTES } from "./role-unit-times.mjs";
import { periodWords } from "../dashboard/kpis.mjs";

export const MIN_N_RATE = 10;
export const MIN_N_TIME = 20;

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rate(from, to) {
  const a = num(from);
  const b = num(to);
  if (a == null || b == null || a <= 0) return null;
  return b / a;
}

function leak({ id, label, from, to, fromName, toName }) {
  const n = num(from);
  const next = num(to);
  if (n == null) {
    return {
      id,
      kind: "insufficient",
      source: "INSUFFICIENT",
      n: 0,
      score: 40,
      headline: `Cannot learn ${label} yet.`,
      detail: `${fromName} is missing. Need ${MIN_N_RATE} to learn a rate. Do not invent one.`
    };
  }
  if (n < MIN_N_RATE) {
    return {
      id,
      kind: "insufficient",
      source: "INSUFFICIENT",
      n,
      score: 50 + (MIN_N_RATE - n),
      headline: `Not enough ${fromName} (${n}) to learn ${label}.`,
      detail: `Need ${MIN_N_RATE}. We have ${n}. ${toName}: ${next == null ? "missing" : next}. No invented rate.`
    };
  }
  const r = rate(n, next ?? 0);
  const drop = n - (next ?? 0);
  const pct = Math.round(r * 100);
  return {
    id,
    kind: "belt_leak",
    source: "MEASURED",
    n,
    rate: r,
    drop,
    score: 70 + Math.max(0, drop),
    headline: `${label}: ${pct}% (${next ?? 0} of ${n}).`,
    detail: `Measured this window. ${fromName} ${n} → ${toName} ${next ?? 0}. Drop ${drop}.`
  };
}

export function discoveriesFromFacts({
  kpis = {},
  deposits = null,
  timedCalls = 0,
  allCalls = 0,
  medianCallMinutes = null,
  pods = null
} = {}) {
  const items = [];

  items.push(leak({
    id: "lead_to_book",
    label: "leads that book",
    from: kpis.new_clients,
    to: kpis.booked_count,
    fromName: "new clients",
    toName: "booked"
  }));
  items.push(leak({
    id: "book_to_show",
    label: "books that show",
    from: kpis.booked_count,
    to: kpis.showed_count,
    fromName: "booked",
    toName: "showed"
  }));
  items.push(leak({
    id: "show_to_deposit",
    label: "shows that deposit",
    from: kpis.showed_count,
    to: deposits,
    fromName: "showed",
    toName: "deposits"
  }));
  items.push(leak({
    id: "deposit_to_fund",
    label: "deposits that fund",
    from: deposits,
    to: kpis.funded_count,
    fromName: "deposits",
    toName: `funded files ${periodWords(kpis.period)}`
  }));

  const timed = num(timedCalls) || 0;
  const calls = num(allCalls) || 0;
  if (timed < MIN_N_TIME) {
    items.push({
      id: "call_minutes",
      kind: "cannot_learn_time",
      source: "INSUFFICIENT",
      n: timed,
      score: 90,
      headline: `Cannot learn closer call time yet (${timed} timed / ${calls} logged).`,
      detail: `Need ${MIN_N_TIME} calls with duration. MODEL stays ${CLOSER_LOGGED_CALL_MINUTES} minutes. Duration does not log itself until the closer save sends it.`
    });
  } else {
    const measured = num(medianCallMinutes);
    items.push({
      id: "call_minutes",
      kind: "measured_time",
      source: "MEASURED",
      n: timed,
      score: 80,
      headline: `Closer call median is ${measured} minutes (n=${timed}). MODEL is ${CLOSER_LOGGED_CALL_MINUTES}.`,
      detail: "Measured from logged duration. MODEL is not overwritten. Use this to rethink the packed-calendar math when you lock it."
    });
  }

  if (pods && (pods.complete_with || pods.complete === 0)) {
    items.push({
      id: "pod_tandem",
      kind: "pod",
      source: "MEASURED",
      n: pods.complete,
      score: 85,
      headline: pods.complete === 0
        ? "No complete pod. Closer and funding advisor must sit together."
        : `Pods are uneven: ${pods.closer_count} closer(s), ${pods.fa_count} funding advisor(s).`,
      detail: "They work in tandem. Hire the missing half. Do not hire a setter."
    });
  }

  const sorted = items.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const learned = items.filter((d) => d.source === "MEASURED").length;
  const blocked = items.filter((d) => d.source === "INSUFFICIENT").length;
  return {
    min_n_rate: MIN_N_RATE,
    min_n_time: MIN_N_TIME,
    learned,
    blocked,
    top: sorted.slice(0, 3),
    all: sorted
  };
}

export async function loadLearningFacts(db, { orgId, days } = {}) {
  const lookback = Number(days);
  const d = Number.isFinite(lookback) && lookback > 0 ? lookback : 7;
  try {
    const { rows } = await db.query(
      `SELECT
          count(*)::int AS all_n,
          count(*) FILTER (
            WHERE duration_seconds IS NOT NULL AND duration_seconds > 0
          )::int AS timed,
          count(*) FILTER (WHERE outcome = 'deposit' AND transaction_id IS NOT NULL AND cash_collected_cents > 0)::int AS deposits
         FROM call_outcomes
        WHERE org_id = $1
          AND logged_at >= now() - ($2::int || ' days')::interval
          AND COALESCE(is_demo, false) = false`,
      [orgId, d]
    );
    const row = rows[0] || {};
    let medianSec = null;
    if ((num(row.timed) || 0) >= MIN_N_TIME) {
      const med = await db.query(
        `SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_seconds) AS median_seconds
           FROM call_outcomes
          WHERE org_id = $1
            AND duration_seconds IS NOT NULL
            AND duration_seconds > 0
            AND logged_at >= now() - ($2::int || ' days')::interval
            AND COALESCE(is_demo, false) = false`,
        [orgId, d]
      );
      medianSec = num(med.rows[0]?.median_seconds);
    }
    return {
      allCalls: num(row.all_n) || 0,
      timedCalls: num(row.timed) || 0,
      deposits: num(row.deposits) || 0,
      medianCallMinutes: medianSec == null ? null : Math.round(medianSec / 60)
    };
  } catch {
    return {
      allCalls: 0,
      timedCalls: 0,
      deposits: null,
      medianCallMinutes: null,
      missing: "call_outcomes_not_readable"
    };
  }
}

export async function learnFromData(db, { orgId, kpis, pods } = {}) {
  const facts = await loadLearningFacts(db, { orgId, days: kpis?.days });
  return discoveriesFromFacts({
    kpis,
    deposits: facts.deposits,
    timedCalls: facts.timedCalls,
    allCalls: facts.allCalls,
    medianCallMinutes: facts.medianCallMinutes,
    pods
  });
}

export default learnFromData;
