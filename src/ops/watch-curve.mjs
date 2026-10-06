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
  const clickN = clicks == null || clicks === "" ? null : Number(clicks);
  const hopped = Number.isFinite(clickN) && clickN >= p25N && clickN > 0;
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

export default { diesBefore25Percent, dyingAlertCopy, notifyDyingBefore25 };
