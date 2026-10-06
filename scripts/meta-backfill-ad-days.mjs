#!/usr/bin/env node
// One-time backfill: the Meta ad days that never reached ad_metrics_daily.
//
// WHY. Meta holds $1,563.13 of all-time spend for the Fundhub ad account;
// ad_metrics_daily held $1,002.32 (M4's tie-out, 2026-10-05). The gap is
// Aug 4–16: the very first pull (a Sync press on 2026-08-24, when the window was
// 7 days) could only reach back to Aug 17, and every later pull asked for at
// most 28 days. api/campaigns/sync.mjs now reads the whole history on a first
// pull (needsFullHistory); this script repairs the account that was already
// connected before that rule existed. It also fills purchases, cost per
// purchase, link clicks and landing page views (408) on old days the 28-day
// pull no longer reaches.
//
// WHAT IT TOUCHES.
//   Meta:     GET only — the ad account's insights at level=ad, one row per ad
//             per day (the same request the sync makes). Nothing is changed.
//   Database: reads ad_platform_connections, ads and ad_metrics_daily; writes
//             ad_metrics_daily ONLY, with the sync's own upsert
//             (ON CONFLICT (ad_id, date) DO UPDATE). Never deletes. Never
//             creates campaigns, ad sets or ads: a Meta row for an ad we do not
//             have is reported and skipped. Running it twice writes the same
//             values twice — it is idempotent.
//   NULL stays NULL: a field Meta did not send is stored NULL, never 0
//             (insightUpsertParams / metaResultMetrics, CLAUDE.md §12).
//
// DAYS. Meta cuts ad days in the ad account's own zone, America/Phoenix
// (measured by M4, 2026-10-05). With no --since the request is Meta's
// date_preset=maximum, so Meta draws the day lines itself. A default --until is
// today in Arizona (phoenixDay, the same function M4's src/lib/ad-account-day.mjs
// re-exports as adAccountDay), never the UTC date.
//
// RUN (after the ship, so 408's columns exist; DATABASE_URL and
// AD_TOKEN_ENC_KEY must be set, the same values the sync uses):
//
//   node scripts/meta-backfill-ad-days.mjs                        # dry run, whole history
//   node scripts/meta-backfill-ad-days.mjs --since 2026-08-01     # dry run, from a day
//   node scripts/meta-backfill-ad-days.mjs --write                # apply the upserts
//   node scripts/meta-backfill-ad-days.mjs --partner <uuid>       # one partner only
//
// Dry run still calls Meta (read only), so it is the true preview of --write.

import { pathToFileURL } from "node:url";
import { asStaff, asPartner } from "../src/partners/rls.mjs";
import { decryptToken } from "../src/adplatforms/tokens.mjs";
import { normalizeInsight } from "../src/adplatforms/meta.mjs";
import { phoenixDay } from "../src/slo/visitor.mjs";
import {
  insightsRequestUrl,
  fetchAllPages,
  syncBlockReason,
  insightUpsertSql,
  insightUpsertParams,
  hasMetaResultColumns
} from "../api/campaigns/sync.mjs";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** --write, --since, --until, --partner. Throws a plain sentence on a bad value. */
export function parseArgs(argv = []) {
  const out = { write: false, since: null, until: null, partnerId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--write") out.write = true;
    else if (a === "--dry-run") out.write = false;
    else if (a === "--since") out.since = argv[++i] ?? null;
    else if (a === "--until") out.until = argv[++i] ?? null;
    else if (a === "--partner") out.partnerId = argv[++i] ?? null;
    else throw new Error(`unknown option ${a}`);
  }
  if (out.since != null && !DAY.test(out.since)) throw new Error("--since must be YYYY-MM-DD");
  if (out.until != null && !DAY.test(out.until)) throw new Error("--until must be YYYY-MM-DD");
  if (out.until != null && out.since == null) throw new Error("--until needs --since");
  if (out.since && out.until && out.since > out.until) throw new Error("--since is after --until");
  if (out.partnerId != null && !UUID.test(out.partnerId)) throw new Error("--partner must be a uuid");
  return out;
}

/** The Meta request: the whole history, or [since, until] with until defaulting
    to today in the ad account's zone. */
export function backfillRange({ since = null, until = null, now = new Date() } = {}) {
  if (!since) return { datePreset: "maximum" };
  return { since, until: until || phoenixDay(now) };
}

/**
 * planBackfill — pure. What Meta has, what we have, and what would be written.
 *
 *   metaRows  Meta insights rows (ad_id = Meta's ad id, date_start, spend, …)
 *   ourAds    our ads rows for this connection: { id, external_id, name }
 *   ourDays   our stored days: { ad_id (our uuid), date 'YYYY-MM-DD', spend_cents }
 *
 * Every Meta row for an ad we have is written (new days are added, stored days
 * are refreshed with Meta's current answer — the same thing the daily pull
 * does inside its 28 days). Rows for ads we do not have are only reported.
 */
export function planBackfill({ metaRows = [], ourAds = [], ourDays = [] } = {}) {
  const adByMeta = new Map();
  for (const a of ourAds) if (a && a.external_id != null) adByMeta.set(String(a.external_id), a);

  const stored = new Map();   // our ad id -> Map(day -> spend_cents)
  for (const d of ourDays) {
    if (!d || !d.ad_id || !d.date) continue;
    if (!stored.has(d.ad_id)) stored.set(d.ad_id, new Map());
    stored.get(d.ad_id).set(String(d.date), Number(d.spend_cents) || 0);
  }

  const writes = [];
  const unknown = new Map();  // Meta ad id -> { days, spend_cents }
  const perAd = new Map();    // our ad id -> summary

  for (const raw of metaRows) {
    const metaAdId = raw?.ad_id != null ? String(raw.ad_id) : "";
    const day = raw?.date_start || raw?.date || null;
    if (!metaAdId || !day) continue;
    const spend = normalizeInsight(raw).spend_cents || 0;
    const ad = adByMeta.get(metaAdId);
    if (!ad) {
      const u = unknown.get(metaAdId) || { meta_ad_id: metaAdId, days: 0, spend_cents: 0 };
      u.days += 1;
      u.spend_cents += spend;
      unknown.set(metaAdId, u);
      continue;
    }
    const have = stored.get(ad.id) || new Map();
    const isNew = !have.has(String(day));
    writes.push({ adId: ad.id, metaAdId, name: ad.name, day: String(day), raw, isNew });

    const s = perAd.get(ad.id) || {
      name: ad.name, meta_ad_id: metaAdId,
      meta_days: 0, meta_spend_cents: 0,
      stored_days: have.size,
      stored_spend_cents: [...have.values()].reduce((n, v) => n + v, 0),
      missing_days: [], missing_spend_cents: 0
    };
    s.meta_days += 1;
    s.meta_spend_cents += spend;
    if (isNew) { s.missing_days.push(String(day)); s.missing_spend_cents += spend; }
    perAd.set(ad.id, s);
  }

  const ads = [...perAd.values()].map((s) => ({ ...s, missing_days: s.missing_days.sort() }));
  const unknownAds = [...unknown.values()];
  const sum = (list, k) => list.reduce((n, x) => n + (x[k] || 0), 0);
  return {
    writes,
    perAd: ads,
    unknownAds,
    totals: {
      rows_to_write: writes.length,
      new_days: writes.filter((w) => w.isNew).length,
      refreshed_days: writes.filter((w) => !w.isNew).length,
      meta_spend_cents: sum(ads, "meta_spend_cents") + sum(unknownAds, "spend_cents"),
      stored_spend_cents: [...stored.values()].reduce((n, m) => n + [...m.values()].reduce((a, b) => a + b, 0), 0),
      missing_spend_cents: sum(ads, "missing_spend_cents"),
      unknown_ad_spend_cents: sum(unknownAds, "spend_cents")
    }
  };
}

const CONNECTIONS_SQL = `
  SELECT id, org_id, partner_id, external_ad_account_id, connection_state, encrypted_access_token
    FROM ad_platform_connections
   WHERE platform = 'meta'
   ORDER BY created_at`;

/**
 * runBackfill — one pass over every usable Meta connection (or one partner's).
 * Every collaborator is an argument so the test drives it with a fake Meta and
 * a fake database. Returns { ok, write, connections: [...] }; never throws for
 * one connection's failure — that connection is reported and the rest go on.
 */
export async function runBackfill({
  write = false,
  since = null,
  until = null,
  partnerId = null,
  now = new Date(),
  fetch = globalThis.fetch,
  staffScope = asStaff,
  partnerScope = asPartner,
  decrypt = (c) => decryptToken(c.encrypted_access_token, { partnerId: c.partner_id })
} = {}) {
  const range = backfillRange({ since, until, now });
  const all = await staffScope((tx) => tx.query(CONNECTIONS_SQL).then((r) => r.rows));
  const result = { ok: true, write, range, connections: [] };

  for (const c of all) {
    if (partnerId && c.partner_id !== partnerId) continue;
    const entry = { connection: c.id, partner: c.partner_id, account: c.external_ad_account_id };
    result.connections.push(entry);

    const blocked = syncBlockReason(c);
    if (blocked) { entry.skipped = blocked; continue; }

    try {
      const token = decrypt(c);
      if (!token) throw new Error("connection has no access token");
      const pull = await fetchAllPages({ url: insightsRequestUrl(c, range), token, ctx: { fetch } });
      if (pull.truncated) entry.truncated = `stopped after ${pull.pages} pages; days past that were not read`;

      const { ourAds, ourDays } = await partnerScope(c.partner_id, async (tx) => ({
        ourAds: (await tx.query(
          `SELECT id, external_id, name FROM ads WHERE connection_id = $1`, [c.id])).rows,
        ourDays: (await tx.query(
          `SELECT m.ad_id, to_char(m.date, 'YYYY-MM-DD') AS date, m.spend_cents
             FROM ad_metrics_daily m JOIN ads a ON a.id = m.ad_id
            WHERE a.connection_id = $1`, [c.id])).rows
      }));

      const plan = planBackfill({ metaRows: pull.rows, ourAds, ourDays });
      entry.totals = plan.totals;
      entry.perAd = plan.perAd;
      entry.unknownAds = plan.unknownAds;

      if (write && plan.writes.length) {
        entry.written = await partnerScope(c.partner_id, async (tx) => {
          const withResults = await hasMetaResultColumns((sql, params) => tx.query(sql, params));
          const sql = insightUpsertSql({ withResults });
          let n = 0;
          for (const w of plan.writes) {
            await tx.query(sql, insightUpsertParams({
              orgId: c.org_id, partnerId: c.partner_id, adId: w.adId,
              day: w.day, raw: w.raw, withResults
            }));
            n += 1;
          }
          return n;
        });
      } else {
        entry.written = 0;
      }
    } catch (err) {
      entry.error = String((err && err.message) || err).slice(0, 300);
      result.ok = false;
    }
  }
  return result;
}

const dollars = (c) => `$${((Number(c) || 0) / 100).toFixed(2)}`;

/** Plain-language lines for a person reading the terminal. */
export function describe(result) {
  const lines = [];
  lines.push(result.write ? "WRITE — upserting into ad_metrics_daily" : "DRY RUN — nothing is written (add --write to apply)");
  lines.push(result.range.datePreset
    ? "Meta range: the whole history (date_preset=maximum)"
    : `Meta range: ${result.range.since} to ${result.range.until} (Arizona days)`);
  for (const e of result.connections) {
    lines.push(`\nAd account ${e.account} (connection ${e.connection})`);
    if (e.skipped) { lines.push(`  skipped: ${e.skipped}`); continue; }
    if (e.error) { lines.push(`  FAILED: ${e.error}`); continue; }
    if (e.truncated) lines.push(`  WARNING: ${e.truncated}`);
    const t = e.totals;
    lines.push(`  Meta spend ${dollars(t.meta_spend_cents)} · we hold ${dollars(t.stored_spend_cents)} · missing days add ${dollars(t.missing_spend_cents)}`);
    lines.push(`  ${t.new_days} new day(s), ${t.refreshed_days} stored day(s) refreshed, ${e.written} written`);
    for (const a of e.perAd) {
      if (!a.missing_days.length) continue;
      lines.push(`  ${a.name}: ${a.missing_days.length} missing day(s) ${a.missing_days[0]}…${a.missing_days.at(-1)}, ${dollars(a.missing_spend_cents)}`);
    }
    for (const u of e.unknownAds) {
      lines.push(`  not in our ads table (skipped): Meta ad ${u.meta_ad_id}, ${u.days} day(s), ${dollars(u.spend_cents)}`);
    }
  }
  return lines.join("\n");
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (e) {
    console.error(String(e.message || e));
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(1); }
  const { close } = await import("../src/db.mjs");
  try {
    const result = await runBackfill(args);
    console.log(describe(result));
    process.exitCode = result.ok ? 0 : 1;
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
