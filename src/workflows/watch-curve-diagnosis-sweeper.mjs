// The "what to fix in the next take" clock — fills ad_watch_curve_diagnoses
// every morning from the watch curve the Meta pull already saved.
//
// WHY THIS EXISTS (2026-10-05). 395_ad_watch_curve_diagnosis.sql made the table,
// marketing/ads/curve-optimization.md described what goes in it, and nothing
// ever wrote a row: 0 rows on production, and the board said "it does not fill
// itself every morning yet" (ops/workflows/roadmap-run-2026-09-27.md:144).
//
// WHAT ONE PASS DOES. Find every partner with saved video numbers inside the
// Meta pull's window, then, inside that partner's own scope, label each saved
// ad-day that has no diagnosis yet: opening / middle / ask, the fix type and a
// one- or two-sentence film note. The rules are fillDiagnoses() and
// diagnoseCurve() in src/ops/watch-curve.mjs — the same file, the same
// threshold and the same hop test as the dying-ad buzz.
//
// WHEN. 07:30 UTC, half an hour after the 07:00 UTC Meta pull
// (meta-campaign-sync-sweeper.mjs) has saved yesterday. It reads saved rows
// only, so a pull that failed costs nothing here: tomorrow fills both days.
//
// IT SENDS NOTHING AND SPENDS NOTHING. No Meta call, no text, no campaign,
// budget or ad change. Its only write is ad_watch_curve_diagnoses, and it never
// overwrites a row (ON CONFLICT DO NOTHING), so a row Chris changed stays put.
//
// ONE BROKEN PARTNER NEVER TAKES THE PASS DOWN — same posture as the Meta
// sweeper: each partner in its own try/catch and its own transaction.

import { inngest } from "./client.mjs";
import { asStaff, asPartner } from "../partners/rls.mjs";
import { fillDiagnoses } from "../ops/watch-curve.mjs";
import { INSIGHT_WINDOW_DAYS } from "../../api/campaigns/sync.mjs";

/* 07:30 UTC daily — 30 minutes after the Meta pull at 07:00 UTC. */
export const SWEEP_CRON = "30 7 * * *";
export const SOURCE_WORKFLOW = "watch-curve-diagnosis-sweeper";

/* Read ACROSS partners with asStaff() — the boundary crossing every
   cross-partner sweeper here uses (meta-campaign-sync-sweeper.mjs). The writes
   happen per partner, inside asPartner(). */
export const DUE_PARTNERS_SQL = `
  SELECT DISTINCT partner_id
    FROM ad_metrics_daily
   WHERE video_plays IS NOT NULL
     AND date >= CURRENT_DATE - $1::int
   ORDER BY partner_id`;

export async function duePartners({ scope = asStaff, days = INSIGHT_WINDOW_DAYS } = {}) {
  const rows = await scope((tx) => tx.query(DUE_PARTNERS_SQL, [days]).then((r) => r.rows));
  return rows.map((r) => r.partner_id).filter(Boolean);
}

const fillInPartnerScope = ({ partnerId, days }) =>
  asPartner(partnerId, (tx) => fillDiagnoses(tx, { partnerId, days }));

/* sweep — one pass. Every collaborator is an argument so the tests drive it
   with no database and no Inngest. NEVER THROWS: tomorrow's pass is the
   recovery, and the failure is returned so the run log shows it. */
export async function sweep({
  listPartners = duePartners,
  fill = fillInPartnerScope,
  days = INSIGHT_WINDOW_DAYS
} = {}) {
  const tally = {
    ok: true,
    window_days: days,
    partners: 0,
    filled: 0,
    checked: 0,
    written: 0,
    opening: 0,
    middle: 0,
    ask: 0,
    hop: 0,
    errored: []
  };

  let partnerIds;
  try {
    partnerIds = await listPartners({ days });
  } catch (err) {
    return { ...tally, ok: false, error: String((err && err.message) || err).slice(0, 300) };
  }
  tally.partners = partnerIds.length;

  for (const partnerId of partnerIds) {
    try {
      const out = await fill({ partnerId, days });
      tally.filled += 1;
      for (const k of ["checked", "written", "opening", "middle", "ask", "hop"]) {
        tally[k] += Number(out?.[k] || 0);
      }
    } catch (err) {
      tally.errored.push({ partner_id: partnerId, error: String((err && err.message) || err).slice(0, 300) });
    }
  }
  if (tally.errored.length) tally.ok = false;
  return tally;
}

/* handle — the shape src/journeys/runner/registry.mjs expects. A cron with no
   event trigger, so it sits in the runner's neverFired list by design. */
export async function handle({ step } = {}) {
  const run = () => sweep();
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const watchCurveDiagnosisSweeper = inngest.createFunction(
  { id: "watch-curve-diagnosis-sweeper", name: "Watch curve next-take diagnosis" },
  { cron: SWEEP_CRON },
  () => sweep()
);

export default sweep;
