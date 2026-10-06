// Watch curve — when a running video ad dies before 25%, buzz Chris.
//
// Definitions are Meta's (see marketing/ads/watch-curve.md). The rule lives in
// .cursor/rules/ad-watch-curve.mdc. This module only scores and notifies.
//
// "Dies before 25%" = most plays never reach the quarter mark:
//   video_p25_watched / video_plays < 0.5
// with at least MIN_N_RATE plays (same floor as every other rate here).
//
// Ping path: the same ntfy + SMS fan-out the ad-video pipeline uses
// (src/ad-videos/notify-fanout.mjs). No new vendor.
//
// THE BUZZ NEVER FIRED UNTIL 2026-10-05. This file imported notify-fanout's
// DEFAULT export and called `notify.send`. That default export IS the send
// function, so `notify.send` was undefined, and the first dying ad threw
// "send is not a function". sync.mjs catches that so a good sync is kept, which
// also hid it: ad_watch_curve_alerts held 0 rows while SLO2 kept 10% of plays at
// the quarter mark. The named import below is the send function itself.

import { MIN_N_RATE } from "./discoveries.mjs";
import { send as sendBuzz } from "../ad-videos/notify-fanout.mjs";

export const DIES_BEFORE_25_THRESHOLD = 0.5;

/* TAPPING THROUGH — ONE definition, the playbook's (marketing/ads/curve-
   optimization.md, "A short watch is not always a failure"): taps at least as
   many as the people who reached 25%. Used by the buzz and by the next-take
   table, so the two can never disagree about what a hop is.

   `clicks` is ad_metrics_daily.clicks — Meta's all-clicks count. Link clicks and
   landing page views are not saved yet; when they are, this is the one line to
   point at them. */
export function tapsThrough({ clicks, p25 } = {}) {
  const clickN = clicks == null || clicks === "" ? null : Number(clicks);
  const p25N = Number(p25);
  return Number.isFinite(clickN) && Number.isFinite(p25N) && clickN >= p25N && clickN > 0;
}

/** Pure score. Returns { dying, rate, plays, p25, note }. */
export function diesBefore25Percent({ plays, p25, clicks } = {}) {
  if (plays == null || p25 == null || plays === "" || p25 === "") {
    return { dying: false, rate: null, plays: null, p25: null, note: "Meta did not report plays and p25." };
  }
  const playN = Number(plays);
  const p25N = Number(p25);
  if (!Number.isFinite(playN) || !Number.isFinite(p25N) || playN < 0 || p25N < 0) {
    return { dying: false, rate: null, plays: null, p25: null, note: "Meta did not report plays and p25." };
  }
  if (playN < MIN_N_RATE) {
    return {
      dying: false,
      rate: null,
      plays: playN,
      p25: p25N,
      note: `Need ${MIN_N_RATE} plays. Have ${playN}. Too few to call.`
    };
  }
  const rate = playN === 0 ? null : p25N / playN;
  if (rate == null) {
    return { dying: false, rate: null, plays: playN, p25: p25N, note: "Nothing to divide by." };
  }
  const hopped = tapsThrough({ clicks, p25: p25N });
  const dying = rate < DIES_BEFORE_25_THRESHOLD && !hopped;
  return {
    dying,
    hopped: rate < DIES_BEFORE_25_THRESHOLD && hopped,
    rate: Math.round(rate * 10000) / 10000,
    plays: playN,
    p25: p25N,
    note: hopped && rate < DIES_BEFORE_25_THRESHOLD
      ? "They left the video early and tapped through. That is a hop, not a broken opening."
      : dying
        ? "Most plays never reach 25%, and they are not tapping through. The opening is the problem."
        : "Enough people reach 25% that this is not a dying-before-25 call."
  };
}

/** One or two sentences for the phone. The TEXT carries only the title
    (smsBody() in notify-fanout.mjs), so the title alone must say which ad,
    that people leave before the quarter mark, and that the opening must change. */
export function dyingAlertCopy(adName) {
  const name = String(adName || "A Fundhub ad").trim() || "A Fundhub ad";
  return {
    title: `${name}: people leave before the quarter mark, so change the opening.`,
    body: "Most plays never reach 25%. Change the opening — new first line, same body."
  };
}

const DYING_ADS_SQL = `
  SELECT a.id AS ad_id,
         a.org_id,
         a.partner_id,
         a.name AS ad_name,
         m.date AS metric_date,
         m.video_plays,
         m.video_p25_watched,
         m.clicks
    FROM ads a
    JOIN LATERAL (
      SELECT date, video_plays, video_p25_watched, clicks
        FROM ad_metrics_daily
       WHERE ad_id = a.id
         AND video_plays IS NOT NULL
         AND video_p25_watched IS NOT NULL
       ORDER BY date DESC
       LIMIT 1
    ) m ON true
    LEFT JOIN ad_watch_curve_alerts al ON al.ad_id = a.id
   WHERE a.partner_id = $1
     AND upper(coalesce(a.status, '')) = 'ACTIVE'
     AND (al.dies_before_25_alerted_on IS NULL
          OR al.dies_before_25_alerted_on < CURRENT_DATE)
`;

/**
 * After a Meta sync: find running ads that die before 25% and buzz Chris once
 * per ad per day. Read-only on campaigns/budgets. Never pauses anything.
 */
export async function notifyDyingBefore25(db, { partnerId, send = sendBuzz, env = process.env } = {}) {
  if (!partnerId) return { checked: 0, alerted: 0, skipped: 0, failed: 0 };
  const rows = await db.query(DYING_ADS_SQL, [partnerId]).then((r) => r.rows);
  let alerted = 0;
  let skipped = 0;
  // A buzz that did not land. No alert row is written, so tomorrow's sync tries
  // again. Counted so a held or failed buzz is not the same as "nothing dying".
  let failed = 0;

  for (const row of rows) {
    const score = diesBefore25Percent({
      plays: row.video_plays,
      p25: row.video_p25_watched,
      clicks: row.clicks
    });
    if (!score.dying) {
      skipped += 1;
      continue;
    }
    const copy = dyingAlertCopy(row.ad_name);
    const res = await send({
      id: row.ad_id,
      notification: {
        title: copy.title,
        body: copy.body,
        priority: 4,
        tags: ["warning", "ad"]
      }
    }, { env });
    if (res?.ok === true || res?.status === "sent") {
      await db.query(
        `INSERT INTO ad_watch_curve_alerts (ad_id, org_id, partner_id, dies_before_25_alerted_on, updated_at)
         VALUES ($1,$2,$3,CURRENT_DATE,now())
         ON CONFLICT (ad_id) DO UPDATE SET
           dies_before_25_alerted_on = CURRENT_DATE,
           updated_at = now()`,
        [row.ad_id, row.org_id, row.partner_id]
      );
      alerted += 1;
    } else {
      failed += 1;
    }
  }

  return { checked: rows.length, alerted, skipped, failed };
}

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT TO FIX IN THE NEXT TAKE — ad_watch_curve_diagnoses (395), filled every
   morning by src/workflows/watch-curve-diagnosis-sweeper.mjs from the numbers
   the Meta pull already saved. Until 2026-10-05 nothing wrote this table: 395
   made it, the playbook described it, and it held 0 rows.

   One row per ad-day. The rules are the law (.claude/rules/ad-watch-curve.md)
   and the playbook's "Simple rules" (marketing/ads/curve-optimization.md), in
   this order:

     too few plays, or Meta did not report      → no row (too few to call)
     most plays never reach 25%:
       and they tap through                      → no row: a HOP, do not recut
       and they do not                           → opening
     most reach 25%:
       and they tap through                      → no row: the ad is doing its job
       under half of those reach 50%             → middle
       they pass halfway and still do not tap    → ask (the offer or the last line)

   fix_type. The table needs one of visual / words / both:
     opening → 'both' when fewer than half of plays are still there at second 2
               (most were gone before the first line could land: new first frame
               AND new first line — the playbook's "both"); otherwise 'words'
               (the law: new first line, same body).
     middle  → 'words' (shorter body, one proof point).
     ask     → 'words' (a clearer offer or last line).
   The half is DIES_BEFORE_25_THRESHOLD — "most", the one threshold this file
   uses. Second 2 is the 2-second continuous count when Meta gave it, else entry
   2 of Meta's curve ("percentage of video plays that reached" second 2).

   A ROW IS NEVER OVERWRITTEN. The playbook says human review can override the
   rule, so the fill is ON CONFLICT DO NOTHING: a row Chris changed stays changed.
   next_take_improved stays NULL — that is a later comparison, not this fill.
   ═══════════════════════════════════════════════════════════════════════════ */

const pct = (x) => `${Math.round(x * 100)}%`;

/* The share of plays still watching at second 2, or null when unknown. */
export function secondTwoHold({ video_plays, video_continuous_2s_watched, video_play_curve } = {}) {
  const plays = Number(video_plays);
  if (video_continuous_2s_watched != null && Number.isFinite(plays) && plays > 0) {
    const two = Number(video_continuous_2s_watched);
    if (Number.isFinite(two) && two >= 0) return two / plays;
  }
  let curve = video_play_curve;
  if (typeof curve === "string") {
    try { curve = JSON.parse(curve); } catch { curve = null; }
  }
  if (Array.isArray(curve) && curve.length > 2) {
    const at2 = Number(curve[2]);
    if (Number.isFinite(at2) && at2 >= 0) return at2 / 100;
  }
  return null;
}

/** Pure. One saved ad-day → { verdict, diagnosis, fix_type, film_note }.
    diagnosis is null when no row should be written (verdict says why). */
export function diagnoseCurve(row = {}) {
  const none = (verdict) => ({ verdict, diagnosis: null, fix_type: null, film_note: null });
  const opening = diesBefore25Percent({
    plays: row.video_plays,
    p25: row.video_p25_watched,
    clicks: row.clicks
  });
  if (opening.rate == null) return none("too_few");
  if (opening.hopped) return none("hop");

  const p25 = opening.p25;
  const clicks = Number(row.clicks ?? 0);

  if (opening.dying) {
    const hold2 = secondTwoHold(row);
    if (hold2 != null && hold2 < DIES_BEFORE_25_THRESHOLD) {
      return {
        verdict: "opening",
        diagnosis: "opening",
        fix_type: "both",
        film_note: `Only ${pct(hold2)} were still watching at second 2, and ${pct(opening.rate)} reached the quarter mark. ` +
          "Film a new cold open: a new first frame and a new first line. Keep the body."
      };
    }
    return {
      verdict: "opening",
      diagnosis: "opening",
      fix_type: "words",
      film_note: `Only ${pct(opening.rate)} of plays reached the quarter mark, and there were fewer clicks (${clicks}) than people who got that far (${p25}). ` +
        "Film a new first line. Keep the body."
    };
  }

  // Most plays reach 25%.
  if (tapsThrough({ clicks: row.clicks, p25 })) return none("tapping");
  if (p25 < MIN_N_RATE) return none("too_few");
  if (row.video_p50_watched == null || row.video_p50_watched === "") return none("too_few");
  const p50 = Number(row.video_p50_watched);
  if (!Number.isFinite(p50) || p50 < 0) return none("too_few");
  const halfway = p50 / p25;

  if (halfway < DIES_BEFORE_25_THRESHOLD) {
    return {
      verdict: "middle",
      diagnosis: "middle",
      fix_type: "words",
      film_note: `${pct(opening.rate)} of plays reached the quarter mark, but only ${pct(halfway)} of them reached halfway. ` +
        "Tighten the middle: a shorter body and one proof point. Keep the opening."
    };
  }
  return {
    verdict: "ask",
    diagnosis: "ask",
    fix_type: "words",
    film_note: `${pct(halfway)} of the people who reached the quarter mark watched past halfway, but there were fewer clicks (${clicks}) than people who got to the quarter mark (${p25}). ` +
      "Change the offer or the last line: one clear ask."
  };
}

/* Saved ad-days with video numbers and no diagnosis yet, inside the window. */
export const UNDIAGNOSED_DAYS_SQL = `
  SELECT m.id, m.org_id, m.partner_id, m.date,
         m.video_plays, m.video_continuous_2s_watched,
         m.video_p25_watched, m.video_p50_watched,
         m.clicks, m.video_play_curve
    FROM ad_metrics_daily m
    LEFT JOIN ad_watch_curve_diagnoses d ON d.ad_metrics_daily_id = m.id
   WHERE m.partner_id = $1
     AND m.date >= CURRENT_DATE - $2::int
     AND m.video_plays IS NOT NULL
     AND m.video_p25_watched IS NOT NULL
     AND d.id IS NULL
   ORDER BY m.date, m.id`;

export const INSERT_DIAGNOSIS_SQL = `
  INSERT INTO ad_watch_curve_diagnoses
    (org_id, partner_id, ad_metrics_daily_id, diagnosis, fix_type, film_note)
  VALUES ($1, $2, $3, $4, $5, $6)
  ON CONFLICT (ad_metrics_daily_id) DO NOTHING`;

/**
 * Fill one partner's next-take table. `db` must already be inside that
 * partner's scope (asPartner) — the sweeper opens it. Writes only
 * ad_watch_curve_diagnoses; never touches an ad, a campaign or a budget.
 */
export async function fillDiagnoses(db, { partnerId, days = 28 } = {}) {
  const tally = { checked: 0, written: 0, opening: 0, middle: 0, ask: 0, hop: 0, tapping: 0, too_few: 0 };
  if (!partnerId) return tally;
  const rows = await db.query(UNDIAGNOSED_DAYS_SQL, [partnerId, days]).then((r) => r.rows);
  tally.checked = rows.length;

  for (const row of rows) {
    const out = diagnoseCurve(row);
    tally[out.verdict] = (tally[out.verdict] || 0) + 1;
    if (!out.diagnosis) continue;
    const res = await db.query(INSERT_DIAGNOSIS_SQL, [
      row.org_id, row.partner_id, row.id, out.diagnosis, out.fix_type, out.film_note
    ]);
    tally.written += Number(res?.rowCount || 0);
  }
  return tally;
}

export default {
  diesBefore25Percent, dyingAlertCopy, notifyDyingBefore25,
  tapsThrough, secondTwoHold, diagnoseCurve, fillDiagnoses
};
