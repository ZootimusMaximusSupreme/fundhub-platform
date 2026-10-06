// Daily ClickFunnels funnel_page_stats pull — same posture as meta-campaign-sync-sweeper.
//
// THE NIGHT PULL WROTE NOTHING FROM 2026-09-22 TO 2026-10-05. It asked for the
// active ClickFunnels accounts with a plain connection. analytics_connections is
// FORCE ROW LEVEL SECURITY, staff only (302_analytics_connections.sql), so a
// plain connection sees zero rows — not an error, just empty — and every pass
// was "0 orgs, nothing to do". Measured 2026-09-28: plain sees 0, staff sees 1
// (ops/workflows/2026-09-28-landing-page-conversion.md:55-63). Every row since
// then came from a hand pull through the HTTP handler, which already used the
// staff scope.
//
// The list is now read with asStaff() — the same staff scope the per-org pull
// (runClickfunnelsOrgSync) and the Meta sweeper's partner list already use. No
// row security is loosened and no privileged database address is used.

import { inngest } from "./client.mjs";
import { asStaff } from "../partners/rls.mjs";
import { runClickfunnelsOrgSync } from "../analytics/clickfunnels-org-sync.mjs";

export const SOURCE_WORKFLOW = "clickfunnels-analytics-sweeper";
export const SWEEP_CRON = "15 7 * * *";

export const ACTIVE_ORGS_SQL = `
  SELECT DISTINCT org_id FROM analytics_connections
   WHERE platform = 'clickfunnels' AND connection_state = 'active'`;

/* The orgs worth a pull, read as staff. `pool` is only for tests that point the
   scope at the unprivileged app role. */
export async function activeOrgs({ scope = asStaff, pool } = {}) {
  const rows = await scope(
    (tx) => tx.query(ACTIVE_ORGS_SQL).then((r) => r.rows),
    pool ? { pool } : undefined
  );
  return rows.map((r) => r.org_id).filter(Boolean);
}

export async function sweep(deps = {}) {
  const listOrgs = deps.listOrgs || (() => activeOrgs({ pool: deps.pool }));
  const syncOrg = deps.syncOrg || runClickfunnelsOrgSync;
  const orgIds = await listOrgs();

  const tally = { orgs: orgIds.length, synced: 0, skipped: 0, pages: 0, errors: [] };

  for (const orgId of orgIds) {
    try {
      const result = await syncOrg({
        orgId,
        days: 30,
        deps: { db: deps.db, fetch: deps.fetch, ...(deps.pool ? { pool: deps.pool } : {}) }
      });
      if (result.notFound) {
        tally.skipped++;
        continue;
      }
      if (!result.ok) {
        tally.errors.push({ orgId, message: result.message });
        continue;
      }
      tally.synced++;
      tally.pages += result.pagesSynced;
    } catch (err) {
      tally.errors.push({ orgId, message: String(err.message || err).slice(0, 500) });
    }
  }

  return tally;
}

export async function handle({ step } = {}) {
  const run = () => sweep();
  return step && typeof step.run === "function" ? step.run("sweep", run) : run();
}

export const clickfunnelsAnalyticsSweeper = inngest.createFunction(
  { id: "clickfunnels-analytics-sweeper", name: "ClickFunnels analytics sweeper" },
  { cron: SWEEP_CRON },
  () => sweep()
);

export default sweep;
