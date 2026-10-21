// Scratch-only lock for the end-to-end verification harness.
//
// Defect (2026-08-22): setupContext resolved the default live company and set
// messaging_settings.outbound_enabled = false. Two production runs paused real
// sending. Snapshot-and-restore is not a safeguard — if the process dies,
// sending stays off. Isolation tests are also a lie on an admin/superuser
// login, because that login bypasses row-level security.
//
// This module must run BEFORE setupContext writes anything. It refuses:
//   1. a privileged database login (superuser or BYPASSRLS)
//   2. a database that already has live (non-demo, non-harness) client files

export const PRIVILEGED_ROLE_ERROR =
  "verify:e2e must run as fundhub_app. This login is a superuser or bypasses row locks, so isolation checks would pass even when isolation is broken.";

export const LIVE_CLIENTS_ERROR =
  "verify:e2e will not run here: this database has live client files. The harness pauses company sending and must only run on a scratch database.";

/* Scratch-only lock for PG tests that delete or rewrite shared rows.

   Defect (2026-10-20): src/messaging/seed/seed.pg.test.mjs ran whenever
   DATABASE_URL was set and deleted every Fundhub message template on the live
   database; 137 seeded templates were gone, including the welcome email and text.
   A test that clears or rewrites real company rows runs only when DATABASE_URL is
   a loopback host AND the database name says it is disposable (ci, test or scratch
   as its own word: fundhub_ci, fundhub_test, scratch). Anything else skips. */
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export function isLocalScratchDatabaseUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(String(value));
    if (!["postgres:", "postgresql:"].includes(url.protocol)) return false;
    if (!LOOPBACK.has(url.hostname)) return false;
    const name = decodeURIComponent(url.pathname.replace(/^\//, ""));
    return /(?:^|[_-])(?:ci|test|scratch)(?:$|[_-])/i.test(name);
  } catch {
    return false;
  }
}

export async function assertHarnessSafe(db) {
  if (!db || typeof db.query !== "function") {
    throw new Error("assertHarnessSafe requires a database");
  }

  const priv = await db.query(
    `SELECT current_user AS usename,
            EXISTS (
              SELECT 1 FROM pg_roles
               WHERE rolname = current_user
                 AND (rolsuper OR rolbypassrls)
            ) AS privileged`
  );
  if (priv.rows[0]?.privileged) {
    throw new Error(PRIVILEGED_ROLE_ERROR);
  }

  const live = await db.query(
    `SELECT count(*)::int AS n
       FROM clients
      WHERE coalesce(is_demo, false) = false
        AND email NOT ILIKE '%@verify.local'
        AND email NOT ILIKE 'e2e\\_%'
        AND email NOT ILIKE 'e2e+%'
        AND email NOT ILIKE '%@example.test'`
  );
  const n = live.rows[0]?.n ?? 0;
  if (n > 0) {
    throw new Error(`${LIVE_CLIENTS_ERROR} (${n} live file${n === 1 ? "" : "s"})`);
  }
}
