// Postgres connection (pg pool). One database for the whole platform (Spec §2).
// `pg` stays a static import so the Netlify zip can resolve it. It is also
// listed in netlify.toml [functions] external_node_modules — esbuild leaves
// the driver external, and a missing copy 502s /api/health, login, and Start D1.
import pg from "pg";
import { databaseConnectionOptions } from "./db/ssl.mjs";

let _pool = null;

// dbTarget() — "<host>/<database>" from DATABASE_URL, or a short reason it
// couldn't be read. NEVER the password, NEVER the full connection string —
// this is for server-side logs only (console.error is private to whoever
// operates the deploy), never for an HTTP response body. See
// src/http/health.mjs:safeError for why a host must never reach a caller.
//
// Exists because "the seed script wrote to database A, the live site reads
// from database B" is invisible from inside either process alone — this is
// the one line that lets an operator diff their own terminal's DATABASE_URL
// against what a server log says the deployed function actually resolved.
export function dbTarget(connectionString = process.env.DATABASE_URL) {
  if (!connectionString) return "(DATABASE_URL not set)";
  try {
    const u = new URL(connectionString);
    return `${u.hostname}${u.port ? ":" + u.port : ""}${u.pathname}`;
  } catch {
    return "(DATABASE_URL set but not a parseable URL)";
  }
}

export function pool() {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL not set");
    // Logged once, here, on first use — the earliest point a cold function
    // instance knows what it is actually connected to. Server log only.
    console.log(`db: connecting to ${dbTarget(connectionString)}`);
    /* TIMEOUTS. With none set, pg waits on the OS TCP timeout — a host that
       drops packets rather than refusing them left /api/health hanging for
       ~135 seconds. On a serverless platform the function is killed long before
       that, so the "health never 5xx's" contract broke by timeout rather than by
       any code path: the caller gets a platform 502 and no JSON body at all.

       connectionTimeoutMillis bounds establishing a connection; a blocked host
       now surfaces as a clean, reportable error in a couple of seconds.
       statement_timeout bounds a query that connects but never returns, which
       is the other way to hang past the function's own limit. Both are
       overridable for a slow link or a deliberately long migration run. */
    _pool = new pg.Pool({
      ...databaseConnectionOptions(connectionString),
      max: Number(process.env.PG_POOL_MAX || 10),
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || 15000)
    });
    /* THE 'error' LISTENER. node-postgres emits this on the Pool whenever an
       IDLE client's connection dies out from under it — a pooler (Supavisor,
       PgBouncer) reaping or resetting a backend is exactly this. pg.Pool is a
       plain EventEmitter, and an EventEmitter with no 'error' listener THROWS
       on emit rather than swallowing it, which crashes the whole process.
       That crash is worse than the error itself: every client the pool had
       CHECKED OUT to an in-flight request dies mid-request, never reaching its
       own try/finally's client.release() — the request simply stops existing.
       Those connections are then orphaned at the pooler until it notices the
       socket is gone, which is how a handful of them end up "idle" for
       minutes or stuck mid-reset (DISCARD ALL) rather than cleanly returned.
       Logging and swallowing it here is the documented fix: the pool already
       discards the dead client on its own, so there is nothing left to do but
       not die. */
    _pool.on("error", (err) => {
      console.error("db: idle client error (pool recovering)", err && err.message);
    });
  }
  return _pool;
}

// query(sql, params) — the interface the event bus + handlers depend on.
export const db = {
  query: (sql, params) => pool().query(sql, params)
};

export async function close() {
  if (_pool) { await _pool.end(); _pool = null; }
}
