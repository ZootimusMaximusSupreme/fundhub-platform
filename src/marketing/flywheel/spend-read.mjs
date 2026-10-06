// @ts-check
// Flywheel step 6, "Read the spend": is the copy, the offer or the market the
// problem? Plain SQL over the saved Meta numbers, no model, free.
//
// Design docs/specs/command-center-design-2026-10-05.md §2 J6 and §3.2 row 6:
// "a table per ad (spend, taps, cost per lead, purchases; 'unknown' for NULL),
// ads with no match, one conclusion line ... and a button that jumps to that
// row's Run. Matches ads by ads.fundhub_ad_number (migration 407), not by piece
// id." Writes 06-spend.md through the outbox. Unit X3.
//
// EVERY NUMBER IS A SAVED VALUE (design safety rules 7 and 8). The per-number
// rows and the company totals come from src/marketing/metrics.mjs (readAdNumbers,
// readTotals: spend by spend date, leads by lead date, Arizona days, first touch
// wins), so this page and the Numbers tab can never disagree. Meta's own
// purchases are a separate count (migration 408) and are shown beside our
// checkout's, never added to it. NULL prints "unknown"; a measured 0 prints 0.
//
// THE WINDOW is the 30 Arizona days that end yesterday: today's spend comes in
// tomorrow morning (the Meta pull runs at 12:01 am), so today is never half-read.
//
// THE CONCLUSION is code, not a model, and uses only the watch-curve law's own
// words (marketing/ads/watch-curve.md, .claude/rules/ad-watch-curve.md): most
// plays never reach 25% and nobody is tapping through -> the opening (the copy);
// they tap through and nobody becomes a lead -> the offer; they see it and
// nobody taps -> the ask (the copy); the purchase is the score. No benchmark
// number is used: "most" means more than half, and a rate needs 10 plays or it
// is unknown.
//
// WHAT IT CANNOT KNOW YET (a gap, written on the page): ads are not tied to one
// flywheel campaign, so it reads every ad in the account.

import { readAdNumbers, readTotals, hold25, cpl } from "../metrics.mjs";
import { adAccountDay } from "../../lib/ad-account-day.mjs";
import { addDays } from "../../metro2/dates.mjs";

export const SPEND_WINDOW_DAYS = 30;
export const MIN_PLAYS_FOR_A_RATE = 10;

/** The 30 Arizona days that end yesterday. */
export function spendWindow(now = new Date()) {
  const to = addDays(adAccountDay(now), -1);
  return { from: addDays(to, -(SPEND_WINDOW_DAYS - 1)), to };
}

const PURCHASES_SQL = `
  SELECT a.fundhub_ad_number AS ad_number,
         sum(m.purchases)::bigint AS purchases,
         count(m.purchases)::int AS purchase_days
    FROM ad_metrics_daily m
    JOIN ads a ON a.id = m.ad_id AND a.org_id = m.org_id
   WHERE m.org_id = $1
     AND m.date BETWEEN $2::date AND $3::date
     AND a.fundhub_ad_number IS NOT NULL
   GROUP BY a.fundhub_ad_number`;

const n = (v) => (v == null ? null : Number(v));

/**
 * readSpend(tx, { orgId, now }) → { from, to, rows, unmatched, totals }
 * `tx` must be an asStaff() transaction: ads and ad_metrics_daily force
 * partner row-level security, and a bare query reads "no spend", a lie.
 * @param {{query: (sql: string, params?: any[]) => Promise<{rows: any[]}>}} tx
 * @param {{orgId: string, now?: Date}} args
 */
export async function readSpend(tx, { orgId, now = new Date() }) {
  const { from, to } = spendWindow(now);
  const [numbers, totals, purchases] = await Promise.all([
    readAdNumbers(tx, { orgId, from, to, now }),
    readTotals(tx, { orgId, from, to, now }),
    tx.query(PURCHASES_SQL, [orgId, from, to]).then((r) => r.rows)
  ]);
  const meta = new Map(purchases.map((p) => [String(p.ad_number), Number(p.purchase_days) > 0 ? Number(p.purchases) : null]));
  const rows = numbers.map((r) => ({
    ad_number: String(r.ad_number),
    spend_cents: n(r.spend_cents),
    link_clicks: n(r.link_clicks),
    impressions: n(r.impressions),
    plays: n(r.plays),
    p25: n(r.p25),
    leads: Number(r.leads) || 0,
    booked: Number(r.booked) || 0,
    sales_ours: Number(r.sales) || 0,
    sales_meta: meta.has(String(r.ad_number)) ? meta.get(String(r.ad_number)) ?? null : null,
    cpl_cents: cpl({ spend_cents: r.spend_cents, leads: r.leads }),
    maturing: Boolean(r.maturing)
  }));
  const metaTotal = purchases.some((p) => Number(p.purchase_days) > 0)
    ? purchases.reduce((s, p) => s + (Number(p.purchase_days) > 0 ? Number(p.purchases) : 0), 0)
    : null;
  return {
    from,
    to,
    rows,
    unmatched: {
      spend_cents: n(totals.unmapped.spend_cents),
      ads: totals.unmapped.ads,
      ad_days: totals.unmapped.ad_days,
      leads: totals.unmapped.leads
    },
    totals: {
      spend_cents: n(totals.spend_cents),
      impressions: n(totals.impressions),
      link_clicks: n(totals.link_clicks),
      plays: n(totals.plays),
      p25: n(totals.p25),
      leads: Number(totals.leads) || 0,
      booked: Number(totals.booked) || 0,
      sales_ours: Number(totals.sales) || 0,
      sales_meta: metaTotal
    }
  };
}

/**
 * concludeSpend(totals) → { text, points_to_stage, rule }
 * Pure. points_to_stage is the row whose Run the page jumps to (null = none).
 * @param {{spend_cents: number|null, impressions: number|null, link_clicks: number|null,
 *          plays: number|null, p25: number|null, leads: number, booked: number, sales_ours: number}} t
 */
export function concludeSpend(t) {
  if (!t || !t.spend_cents) {
    return { rule: "no_spend", points_to_stage: null,
      text: "No ad spend is saved for these 30 days, so there is nothing to read yet." };
  }
  if (t.sales_ours > 0) {
    return { rule: "selling", points_to_stage: null,
      text: `It is selling: ${t.sales_ours} paid in our checkout. The purchase is the score. Keep it running and write more of what sold.` };
  }
  const plays = t.plays ?? 0;
  const hold = plays >= MIN_PLAYS_FOR_A_RATE ? hold25({ p25: t.p25, plays: t.plays }) : null;
  if (hold != null && hold < 0.5 && t.leads === 0) {
    return { rule: "opening", points_to_stage: 4,
      text: "Most plays never reach the quarter mark, and nobody became a lead. The opening is the problem: redo the copy (step 4)." };
  }
  if ((t.link_clicks ?? 0) > 0 && t.leads === 0) {
    return { rule: "offer_no_leads", points_to_stage: 3,
      text: "People tap through to the page, but nobody became a lead. The offer is the problem: redo the offer (step 3)." };
  }
  if (t.leads > 0 && t.booked === 0) {
    return { rule: "offer_no_calls", points_to_stage: 3,
      text: "Leads came in, but nobody booked a call or bought. Look at the offer: redo the offer (step 3)." };
  }
  if ((t.impressions ?? 0) > 0 && t.link_clicks === 0) {
    return { rule: "ask", points_to_stage: 4,
      text: "People see the ads, but nobody taps. The ask is the problem: redo the copy (step 4)." };
  }
  return { rule: "too_early", points_to_stage: null,
    text: "Not enough has happened yet to tell what to fix. Read it again after more spend." };
}

const usd = (cents) => (cents == null ? "unknown" : `$${(Number(cents) / 100).toFixed(2)}`);
const count = (v) => (v == null ? "unknown" : String(v));

/** The hold rate in words: a percent, or "unknown (fewer than 10 plays)". */
export function holdWords(p25, plays) {
  if (plays == null || plays < MIN_PLAYS_FOR_A_RATE) return "unknown (fewer than 10 plays)";
  const h = hold25({ p25, plays });
  return h == null ? "unknown" : `${Math.round(h * 100)}%`;
}

/**
 * spendDocument({ campaignName, read, conclusion }) → the markdown body of 06-spend.md
 * (the stamp is added by stamp.mjs). Every number from `read`; nothing invented.
 */
export function spendDocument({ campaignName, read, conclusion }) {
  const t = read.totals;
  const lines = [
    `# ${campaignName} — what the spend says`,
    `As of ${read.to} (Arizona days ${read.from} to ${read.to}, the saved Meta numbers)`,
    "",
    "## The answer",
    "",
    conclusion.text,
    "",
    "## All ads, together",
    "",
    `- Ad spend: ${usd(t.spend_cents)}`,
    `- Taps to the page: ${count(t.link_clicks)}`,
    `- Still there at 25%: ${holdWords(t.p25, t.plays)}`,
    `- Leads: ${t.leads}`,
    `- Calls booked: ${t.booked}`,
    `- Our checkout: ${t.sales_ours} paid`,
    `- Meta says: ${t.sales_meta == null ? "unknown" : t.sales_meta} purchases`,
    "",
    "## Every ad with a number",
    ""
  ];
  if (!read.rows.length) {
    lines.push("No ad with a number had spend or leads in these days.", "");
  } else {
    lines.push("| Ad | Spend | Taps | Cost per lead | Leads | Our checkout: paid | Meta says: purchases |",
      "|---|---|---|---|---|---|---|");
    for (const r of read.rows) {
      lines.push(`| Ad ${r.ad_number} | ${usd(r.spend_cents)} | ${count(r.link_clicks)} | ${r.cpl_cents == null ? "unknown" : usd(r.cpl_cents)} | ${r.leads}${r.maturing ? " (still maturing)" : ""} | ${r.sales_ours} | ${r.sales_meta == null ? "unknown" : r.sales_meta} |`);
    }
    lines.push("");
  }
  lines.push("## Spend on ads with no number", "");
  lines.push(read.unmatched.spend_cents
    ? `${usd(read.unmatched.spend_cents)} on ${read.unmatched.ads} ad${read.unmatched.ads === 1 ? "" : "s"} with no Fundhub ad number. Link them on the Campaigns page so they count by number.`
    : "None. Every dollar is on an ad with a number.");
  lines.push("",
    "## How this was read",
    "",
    "- Spend counts on the day it was spent. Leads count on the day they came in, and their calls and sales count for 14 days (src/marketing/metrics.mjs).",
    "- Unknown means Meta sent no number for it. It is never 0.",
    "- Our checkout and Meta's purchases are two different counts. They are shown side by side and never added.",
    "- This reads every ad in the account. Ads are not tied to one flywheel yet.",
    "",
    "## Review card",
    "",
    `**What this decided:** ${conclusion.text}`,
    "",
    `**Three things to check:** Does the spend match Ads Manager for these days? · Is ${usd(read.unmatched.spend_cents)} on ads with no number worth linking first? · ${conclusion.points_to_stage ? `Do we redo step ${conclusion.points_to_stage} now?` : "Is there anything to change yet?"}`,
    "",
    "**What I wasn't sure about:** which of these ads belong to this flywheel. They are not tied to it yet.",
    "",
    "**Say one of:** approve · tweak: <what to change> · redo",
    "");
  return lines.join("\n");
}
