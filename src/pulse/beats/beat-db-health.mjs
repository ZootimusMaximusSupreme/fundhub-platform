// Beat: db-health. Every hour, ask the database five plain questions. READ ONLY.
//
//   query-ok         A trivial SELECT through ctx.read answers in under 1.5 s.
//   pool-writable    A plain pooled connection (ctx.dbSettings, OUTSIDE the read box) is NOT read-only.
//                    This is the pooler read-only leak: a bare SET on the 6543 pooler once stuck the
//                    live pool read-only and every save failed (memory: pooler-session-set-leaks).
//   grants           The app role (fundhub_app) can INSERT into the ten tables the launch path writes.
//                    pulse_beats is made by migration 475; before that ships it is allowed to be absent
//                    (noted, never red).
//   health-endpoint  GET SITE/api/health?strict=1 says ok true and pending 0. (doors-live asks the
//                    same door; each beat stands alone, so each asks.)
//   pool-pressure    Client connections against max_connections. Info; red only above 90 percent.
//                    Skipped when the role may not read pg_stat_activity.
//
// MEASURED 2026-10-09 (read only, as the app role): current_user fundhub_app, not a superuser;
// all nine tables except pulse_beats present and INSERT true; max_connections 60; 11 sessions
// with a database in use (18 percent), of which only 5 belong to the app role.
//
// TWO THINGS TO KNOW ABOUT THE SPEED CHECK.
//   1. ctx.read goes through the shared read box. Reads from every beat queue behind each other on
//      ONE connection, so a read can be slow only because other beats were ahead of it. So a slow read
//      is red only when the plain pooled queries (which do not queue) were slow or silent too.
//   2. The pooler hands each plain query to some server connection. One sample sees one connection.
//      Three samples are taken at once, and any one that is read-only turns the beat red. A stuck
//      pool can still hide for an hour; that is the limit of a sample.
//
// No imports. The words in a detail are table names, counts and codes. Never an error message,
// a row, a connection string or a user name.

export const id = "db-health";
export const title = "Database health checks";
export const kind = "infra";
export const covers = [];
export const box = false;
export const reads = [{ host: "SITE", methods: ["GET"] }];
export const damp = 1;
export const deadlineMs = 10000;
export const steps = ["query-ok", "pool-writable", "grants", "health-endpoint", "pool-pressure"];

export const SLOW_QUERY_MS = 1500;
export const SAMPLES = 3;
export const APP_ROLE = "fundhub_app";
export const PRESSURE_RED = 0.9;
export const GRANT_TABLES = Object.freeze([
  "clients", "events", "messages", "commas_inbox", "webhook_captures",
  "account_magic_links", "payment_links", "transactions", "job_heartbeats", "pulse_beats"
]);
/** Tables that may be absent until their migration ships. Noted in the detail, never red. */
export const MAY_BE_ABSENT = Object.freeze(["pulse_beats"]);

export const SQL_QUERY_OK = "SELECT 1 AS ok";
export const SQL_ROLE = "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS present";
export const SQL_GRANTS =
  "SELECT t.name AS name, " +
  "to_regclass('public.' || t.name) IS NOT NULL AS present, " +
  "has_table_privilege($1::name, to_regclass('public.' || t.name), 'INSERT') AS can_insert " +
  "FROM unnest($2::text[]) AS t(name)";
// Counts every session that has a database (datid is not null), which includes the other roles
// (supabase_admin, authenticator, postgres, pgbouncer). Do NOT filter on backend_type: as the app role
// (no pg_read_all_stats) backend_type is NULL for every other role, so that filter counted only the app's
// own sessions and showed 5 or 6 when 11 or 12 were in use (measured 2026-10-09).
export const SQL_PRESSURE =
  "SELECT count(*) FILTER (WHERE datid IS NOT NULL) AS used_conn, " +
  "current_setting('max_connections')::int AS limit_conn " +
  "FROM pg_stat_activity";

/** Letters, digits and . _ - only, cut short. */
const plain = (v) => String(v ?? "").replace(/[^a-z0-9._-]/gi, "").slice(0, 16) || "none";
/** What went wrong with a database call, in words that hold no message text. */
const dbWhy = (err) => {
  const code = err && err.code ? plain(err.code) : "";
  if (code === "57014") return "timed out (57014)";
  if (code === "42501") return "permission denied (42501)";
  return code ? `error ${code}` : "error";
};
const isRefusal = (err) => Boolean(err) && err.name === "PulseRefused";

export async function run(ctx) {
  // The plain pooled samples start now and are read later. Each one is already caught.
  const samplesP = Promise.all(Array.from({ length: SAMPLES }, () => (
    Promise.resolve().then(() => ctx.dbSettings()).then(
      (s) => (s && typeof s === "object" ? s : { ok: false }),
      () => ({ ok: false })
    )
  )));
  const notes = [];
  const evidence = {};

  // ---- 1. query-ok ----
  await ctx.step("query-ok", async () => {
    const t0 = Date.now();
    let rows;
    try {
      rows = (await ctx.read(SQL_QUERY_OK)).rows;
    } catch (err) {
      if (isRefusal(err)) throw err;
      throw ctx.fail("query-ok", `the database did not answer a trivial query: ${dbWhy(err)}`);
    }
    if (Number(rows?.[0]?.ok) !== 1) throw ctx.fail("query-ok", "a trivial SELECT 1 came back with the wrong answer");
    const ms = Date.now() - t0;
    evidence.queryMs = ms;
    if (ms > SLOW_QUERY_MS) {
      const samples = await samplesP;
      const times = samples.filter((s) => s.ok && Number.isFinite(s.ms)).map((s) => s.ms);
      if (!times.length) throw ctx.fail("query-ok", `a trivial query took ${ms} ms (limit ${SLOW_QUERY_MS}), and a plain pooled query did not answer`);
      const best = Math.min(...times);
      if (best > SLOW_QUERY_MS) throw ctx.fail("query-ok", `a trivial query took ${ms} ms (limit ${SLOW_QUERY_MS}), and a plain pooled query took ${best} ms`);
      notes.push(`read took ${ms} ms behind other beats' reads; plain query took ${best} ms`);
    }
  });

  // ---- 2. pool-writable ----
  await ctx.step("pool-writable", async () => {
    const samples = await samplesP;
    const answered = samples.filter((s) => s.ok);
    if (!answered.length) throw ctx.fail("pool-writable", "no plain pooled query answered, so the pool could not be checked");
    const stuck = answered.filter((s) => s.transaction_read_only !== false || s.default_transaction_read_only !== false || s.in_recovery !== false);
    if (stuck.length) {
      const s = stuck[0];
      const what = s.transaction_read_only === true ? "transaction_read_only is on"
        : s.default_transaction_read_only === true ? "default_transaction_read_only is on"
          : s.in_recovery === true ? "the database is in recovery (a replica)"
            : "the read-only setting could not be read";
      throw ctx.fail("pool-writable", `a pooled connection cannot save: ${what} (${stuck.length} of ${answered.length} samples). Saves will fail`);
    }
  });

  // ---- 3. grants ----
  await ctx.step("grants", async () => {
    let role;
    let table;
    try {
      role = (await ctx.read(SQL_ROLE, [APP_ROLE])).rows;
      if (role?.[0]?.present === true) table = (await ctx.read(SQL_GRANTS, [APP_ROLE, [...GRANT_TABLES]])).rows;
    } catch (err) {
      if (isRefusal(err)) throw err;
      throw ctx.fail("grants", `the grants could not be read: ${dbWhy(err)}`);
    }
    if (role?.[0]?.present !== true) throw ctx.fail("grants", `the app role ${APP_ROLE} is not in the database`);
    const byName = new Map((table || []).map((r) => [String(r.name), r]));
    const gone = [];
    const noInsert = [];
    for (const name of GRANT_TABLES) {
      const r = byName.get(name);
      if (!r) { gone.push(name); continue; }
      if (r.present !== true) {
        if (MAY_BE_ABSENT.includes(name)) notes.push(`${name} not made yet (skipped)`);
        else gone.push(name);
        continue;
      }
      if (r.can_insert !== true) noInsert.push(name);
    }
    const bad = [];
    if (noInsert.length) bad.push(`${APP_ROLE} cannot INSERT into: ${noInsert.join(", ")}`);
    if (gone.length) bad.push(`table missing: ${gone.join(", ")}`);
    if (bad.length) throw ctx.fail("grants", bad.join(". "));
  });

  // ---- 4. health-endpoint ----
  await ctx.step("health-endpoint", async () => {
    if (!/^https:\/\/[^/]+$/.test(String(ctx.siteUrl || ""))) throw ctx.fail("health-endpoint", "the site address (URL) is not set for this run");
    const res = await ctx.http.get(`${ctx.siteUrl}/api/health?strict=1`);
    if (!res || !Number.isInteger(res.status) || res.status === 0) {
      throw ctx.fail("health-endpoint", `GET /api/health got no answer (${plain(res?.class)})`);
    }
    if (res.status !== 200) throw ctx.fail("health-endpoint", `GET /api/health answered ${res.status}, wanted 200`);
    let j = null;
    try { j = JSON.parse(String(res.body ?? res.bodySnippet ?? "")); } catch { j = null; }
    if (!j || typeof j !== "object") throw ctx.fail("health-endpoint", "GET /api/health answered 200 but the body is not the health answer");
    if (j.ok !== true || j.pending !== 0) {
      throw ctx.fail("health-endpoint", `GET /api/health says ok ${plain(j.ok)}, state ${plain(j.state)}, pending ${plain(j.pending)}`);
    }
  });

  // ---- 5. pool-pressure (info; skipped when the role may not look) ----
  let pressure = null;
  let skippedWhy = null;
  try {
    pressure = (await ctx.read(SQL_PRESSURE)).rows?.[0] ?? null;
  } catch (err) {
    if (isRefusal(err)) throw err;
    skippedWhy = `could not read connection counts: ${dbWhy(err)}`;
  }
  const used = Number(pressure?.used_conn);
  const limit = Number(pressure?.limit_conn);
  if (!skippedWhy && !(Number.isFinite(used) && Number.isFinite(limit) && limit > 0)) skippedWhy = "the connection counts came back empty";
  if (skippedWhy) {
    ctx.skipStep("pool-pressure", skippedWhy);
    notes.push("pool-pressure skipped");
  } else {
    await ctx.step("pool-pressure", async () => {
      const share = used / limit;
      evidence.connections = used;
      evidence.maxConnections = limit;
      if (share > PRESSURE_RED) {
        throw ctx.fail("pool-pressure", `${used} of ${limit} database connections are in use (${Math.round(share * 100)} percent, limit ${Math.round(PRESSURE_RED * 100)})`);
      }
      notes.push(`connections ${used} of ${limit}`);
    });
  }

  return ctx.done(`database healthy${notes.length ? `; ${notes.join("; ")}` : ""}`, evidence);
}

export const fixGuide = [
  "The database is slow, stuck read-only, or missing a right the app needs. Read the step named in the text.",
  "",
  "Likely causes:",
  "- query-ok: the database or the pooler is slow or down. Check https://fundhub.ai/api/health and the Supabase project status.",
  "- pool-writable: a connection in the pool is stuck read-only. A bare SET on the port 6543 pooler leaked into the live pool before. Never run SET there outside BEGIN.",
  "- grants: the app role fundhub_app lost INSERT on a table, or a table was dropped. A migration or a role change did it.",
  "- pool-pressure: more than 90 percent of max_connections are in use. Something is opening too many connections.",
  "Steps:",
  "- Run node scripts/pulse/run-beat.mjs db-health. It prints the step that stopped.",
  "- For a read-only pool, find what ran SET on the pooler and stop it. If it does not clear, restart the pooler or project in Supabase. Do not run SET to fix it.",
  "- For a lost INSERT right, add a NEW file under db/migrations that gives fundhub_app the right back. Never edit an applied migration.",
  "- For a table that is gone, find the migration that dropped it and put it back with a new migration.",
  "Files: db/migrations/104_app_role.sql, db/migrate.mjs, src/db.mjs, api/health.mjs"
].join("\n");

/* ---------------- self test: no network, no database ---------------- */

const SITE = "https://fundhub.ai";
const HEALTH = `GET ${SITE}/api/health?strict=1`;

/** Canned reads, one rule per query. A query with no rule fails the beat loudly. */
export function goodReads(over = {}) {
  const grantRows = GRANT_TABLES.map((name) => ({ name, present: !MAY_BE_ABSENT.includes(name), can_insert: MAY_BE_ABSENT.includes(name) ? null : true }));
  return [
    { match: /SELECT 1 AS ok/, rows: [{ ok: 1 }] },
    { match: /FROM pg_roles/, rows: [{ present: true }] },
    { match: /has_table_privilege/, rows: over.grantRows ?? grantRows },
    { match: /FROM pg_stat_activity/, rows: [{ used_conn: "6", limit_conn: 60 }] }
  ];
}
export const goodHealth = () => ({ [HEALTH]: { status: 200, body: JSON.stringify({ ok: true, db: "up", state: "up", pending: 0 }) } });

export const selfTest = {
  pass: () => ({ read: goodReads(), http: goodHealth() }),
  // The pool is stuck read-only: every save would fail.
  fail: () => ({ read: goodReads(), http: goodHealth(), dbSettings: { transaction_read_only: true } })
};
