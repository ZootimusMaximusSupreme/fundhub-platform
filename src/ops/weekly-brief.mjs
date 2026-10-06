// src/ops/weekly-brief.mjs — one week's real numbers, written up plainly,
// fed into Company Brain so it is askable, and saved to the repo so Chris
// can read it without opening anything.
//
// WHAT THIS IS. Chris asked (2026-09-07) for "briefs every week on what to
// do," from "the AI agent that manages the company." This pulls the three
// data sources built tonight — ad performance, ClickFunnels page
// performance, YouTube VSL watch time — plus features shipped (merged pull
// requests), and writes ONE document: a numbers section that is always
// correct and never invented, followed by a short written synthesis from a
// model, grounded in nothing but those numbers.
//
// THE ONE RULE THAT MATTERS MOST. The numbers section is built from plain
// SQL, deterministic, and would be identical with the model taken out
// entirely. If the model is not configured (or fails, or returns nothing
// useful), the brief still ships — as numbers only, said plainly, exactly
// the way src/company-brain/answer.mjs's extractiveAnswer() already handles
// "no model available." A brief that ships with a made-up number in it is
// worse than one that ships two paragraphs shorter.
//
// A SOURCE THAT IS NOT CONNECTED IS NOT AN ERROR. Chris has not connected
// ClickFunnels or YouTube yet as of this file's first version. The brief
// says so, plainly, in one line each, and reports what IS available. It
// never blocks on a source that has nothing to say yet.

import { adAttributionRollup } from "../ads/store.mjs";
import { foldGroups } from "../../api/read/ad-books.mjs";
import { callModel, liveModelProvider } from "../agents/model.mjs";
import { upsertGeneratedDocument } from "../company-brain/ingest-generated.mjs";

function isoWeekKey(d) {
  // ISO week number, so re-running the same week updates one document
  // instead of creating a new one every time it is generated.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / 86400000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-w${String(week).padStart(2, "0")}`;
}

function fmtDate(d) { return d.toISOString().slice(0, 10); }

function money(cents) {
  if (cents == null) return "unknown";
  return "$" + (Number(cents) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function pullAdPerformance(db, { orgId, from, to }) {
  const rows = await adAttributionRollup(db, { orgId, from: from.toISOString(), to: to.toISOString() });
  if (!rows.length) return { available: true, totalLeads: 0, totalBooks: 0, byLane: [] };
  const folded = foldGroups(rows, "lane");
  const totalLeads = rows.reduce((n, r) => n + Number(r.leads || 0), 0);
  const totalBooks = rows.reduce((n, r) => n + Number(r.books || 0), 0);
  return { available: true, totalLeads, totalBooks, byLane: folded.groups };
}

/* EACH funnel_page_stats / video_watch_stats ROW IS ALREADY A RUNNING TOTAL —
   one pull over the 7, 30 or 90 days before stat_date (the Sync button, the
   nightly job and a hand pull use different windows, and the row does not save
   which). Summing the rows in a week adds overlapping totals: seven nightly
   30-day pulls would report about seven months of views as "this week". And a
   single 90-day row was reported as the week's views (measured 2026-10-05: the
   VSL's 642 views were 90 days; that week was 77). So the brief takes the
   LATEST row per page in the window and says what it is. */
export async function pullFunnelPages(db, { orgId, from, to }) {
  const conn = (await db.query(
    `SELECT connection_state, last_synced_at, last_error FROM analytics_connections
      WHERE org_id = $1 AND platform = 'clickfunnels'`,
    [orgId]
  )).rows[0];
  if (!conn || conn.connection_state !== "active") {
    return { available: false, reason: conn ? `ClickFunnels connection state: ${conn.connection_state}` : "ClickFunnels is not connected yet" };
  }
  const rows = (await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (clickfunnels_page_id)
              funnel_name, page_name, stat_date::text AS stat_date, views, conversions
         FROM funnel_page_stats
        WHERE org_id = $1 AND stat_date >= $2 AND stat_date < $3
        ORDER BY clickfunnels_page_id, stat_date DESC
     ) latest
      ORDER BY views DESC NULLS LAST
      LIMIT 10`,
    [orgId, fmtDate(from), fmtDate(to)]
  )).rows;
  return { available: true, pages: rows, lastSyncedAt: conn.last_synced_at };
}

export async function pullVideoStats(db, { orgId, from, to }) {
  const conn = (await db.query(
    `SELECT connection_state, last_synced_at, last_error FROM analytics_connections
      WHERE org_id = $1 AND platform = 'youtube'`,
    [orgId]
  )).rows[0];
  if (!conn || conn.connection_state !== "active") {
    return { available: false, reason: conn ? `YouTube connection state: ${conn.connection_state}` : "YouTube is not connected yet" };
  }
  const rows = (await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (youtube_video_id)
              video_title, stat_date::text AS stat_date, views,
              estimated_minutes_watched AS minutes_watched
         FROM video_watch_stats
        WHERE org_id = $1 AND stat_date >= $2 AND stat_date < $3
        ORDER BY youtube_video_id, stat_date DESC
     ) latest
      ORDER BY views DESC NULLS LAST
      LIMIT 10`,
    [orgId, fmtDate(from), fmtDate(to)]
  )).rows;
  return { available: true, videos: rows, lastSyncedAt: conn.last_synced_at };
}

async function pullFeaturesShipped(db, { from, to }, { exec } = {}) {
  // No PR data lives in Postgres — this repo's own history is the source.
  // A caller may pass exec (a function(cmd) -> stdout) to run `gh pr list`;
  // without one, this section is just skipped, plainly, not guessed at.
  if (typeof exec !== "function") return { available: false, reason: "no PR data source wired in" };
  try {
    const out = await exec(
      `gh pr list --state merged --limit 100 --json number,title,mergedAt --search "merged:${fmtDate(from)}..${fmtDate(to)}"`
    );
    const prs = JSON.parse(out || "[]");
    return { available: true, count: prs.length, titles: prs.slice(0, 8).map((p) => p.title) };
  } catch (e) {
    return { available: false, reason: e.message || "gh pr list failed" };
  }
}

/** Build the deterministic, numbers-only section. Never touches a model. */
export function buildNumbersSection({ ads, funnel, video, features, from, to }) {
  const lines = [];
  lines.push(`# Weekly ops brief — ${fmtDate(from)} to ${fmtDate(to)}`);
  lines.push("");
  lines.push("## Ad performance");
  if (ads.totalLeads === 0 && ads.totalBooks === 0) {
    lines.push("No leads or booked calls attributed to an ad this week.");
  } else {
    lines.push(`${ads.totalLeads} leads, ${ads.totalBooks} booked calls, across ${ads.byLane.length} lane(s).`);
    for (const g of ads.byLane.slice(0, 8)) {
      const rate = g.leads > 0 ? ((100 * g.books) / g.leads).toFixed(1) + "%" : "n/a (no leads)";
      lines.push(`- ${g.key}: ${g.leads} leads, ${g.books} booked (${rate})`);
    }
  }
  lines.push("");
  lines.push("## Funnel pages (ClickFunnels)");
  if (!funnel.available) {
    lines.push(`Not available: ${funnel.reason}.`);
  } else if (!funnel.pages.length) {
    lines.push("Connected, but no page stats were pulled this week.");
  } else {
    lines.push("Each number is ClickFunnels' running total as of the day it was pulled (7 to 90 days back; the window is not saved). It is not this week's count.");
    for (const p of funnel.pages) {
      lines.push(`- ${p.funnel_name || "?"} / ${p.page_name || "?"}: ${p.views == null ? "unknown" : p.views} views, ${p.conversions == null ? "unknown" : p.conversions} conversions (pulled ${p.stat_date || "?"})`);
    }
  }
  lines.push("");
  lines.push("## VSL watch time (YouTube)");
  if (!video.available) {
    lines.push(`Not available: ${video.reason}.`);
  } else if (!video.videos.length) {
    lines.push("Connected, but no watch data was pulled this week.");
  } else {
    lines.push("Each number is YouTube's running total as of the day it was pulled (the days before it; the window is not saved). It is not this week's count.");
    for (const v of video.videos) {
      const mins = v.minutes_watched == null ? "unknown" : Math.round(Number(v.minutes_watched));
      lines.push(`- ${v.video_title || "?"}: ${v.views == null ? "unknown" : v.views} views, ${mins === "unknown" ? "unknown" : mins + " minutes"} watched (pulled ${v.stat_date || "?"})`);
    }
  }
  lines.push("");
  lines.push("## Features shipped");
  if (!features.available) {
    lines.push(`Not available: ${features.reason}.`);
  } else {
    lines.push(`${features.count} pull request(s) merged this week.`);
    for (const t of features.titles) lines.push(`- ${t}`);
  }
  return lines.join("\n");
}

/**
 * generateWeeklyBrief(db, { orgId, from, to, env, fetchImpl, exec })
 * → { ok, brief: string, ingestion: {...}, modelUsed: boolean }
 *
 * from/to default to the last 7 days. Pass them explicitly to re-run an
 * older week (Date.now() is not called with no args from inside this
 * function on purpose — nothing here relies on the ambient clock beyond
 * what the caller hands in, so this is replayable and testable).
 */
export async function generateWeeklyBrief(db, {
  orgId, from, to, env = process.env, fetchImpl, exec, embed
} = {}) {
  if (!orgId) return { ok: false, reason: "org_id_required" };
  if (!from || !to) return { ok: false, reason: "from_and_to_required" };

  const [ads, funnel, video, features] = await Promise.all([
    pullAdPerformance(db, { orgId, from, to }),
    pullFunnelPages(db, { orgId, from, to }),
    pullVideoStats(db, { orgId, from, to }),
    pullFeaturesShipped(db, { from, to }, { exec })
  ]);

  const numbers = buildNumbersSection({ ads, funnel, video, features, from, to });

  let synthesis = null;
  let modelUsed = false;
  if (liveModelProvider(env)) {
    const res = await callModel({
      system:
        "You write a short, plain-English weekly brief for the owner of a small business funding company. " +
        "You are given ONLY real numbers below — never invent a number, a trend, or a claim not supported by them. " +
        "If a section says data is not available, say so plainly rather than guessing. " +
        "Write three things: what is working, what is not, and up to three concrete next actions. " +
        "5th grade reading level. Under 250 words total.",
      user: numbers,
      env,
      fetchImpl,
      maxTokens: 900
    });
    if (res.mode === "live" && !res.error && res.text) {
      synthesis = String(res.text).trim();
      modelUsed = true;
    }
  }

  const doc = synthesis
    ? `${numbers}\n\n## What to do\n\n${synthesis}`
    : `${numbers}\n\n## What to do\n\nNo model was available to write this section, so only the numbers above are shown. Nothing here is invented.`;

  const sourceKey = isoWeekKey(to);
  const ingestion = await upsertGeneratedDocument(db, {
    orgId,
    sourceType: "weekly-ops-brief",
    sourceKey,
    title: `Weekly ops brief — ${sourceKey}`,
    text: doc,
    accessTier: "owner",
    env,
    fetchImpl,
    embed
  });

  return { ok: true, brief: doc, sourceKey, modelUsed, ingestion };
}
