// Test helper for the money-B lane tests (coverage batch W2, 2026-10-10). Not a lane, not a test.
//
// It runs one SELECT against Postgres with every table the SELECT reads replaced by a small made-up
// one (WITH payment_links AS (VALUES ...)). No real table is read or written, so it is safe on any
// database. It also opens BEGIN READ ONLY and always rolls back, so even a mistake in a test cannot
// write. The tests that use it skip, and say so, when DATABASE_URL is not set.
//
// Same idea as the shadow-table tests in gap-payments.test.mjs, written once.

import { createRequire } from "node:module";

export const HAS_DB = Boolean(process.env.DATABASE_URL);

export function lit(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${text.replace(/'/g, "''")}'`;
}

/** One made-up table. cols is [[name, type], ...]. An empty rows list is a table with no rows. */
export function shadow(name, cols, rows) {
  const names = cols.map(([c]) => c).join(", ");
  if (!rows.length) {
    return `${name} AS (SELECT ${cols.map(([c, ty]) => `NULL::${ty} AS ${c}`).join(", ")} WHERE false)`;
  }
  const values = rows
    .map((r) => `(${cols.map(([c, ty]) => `${lit(r[c])}::${ty}`).join(", ")})`)
    .join(", ");
  return `${name} AS (SELECT * FROM (VALUES ${values}) AS v(${names}))`;
}

/** WITH <shadows> <the SQL under test>. A leading /* gap:x * / comment on the SQL is kept. */
export function withShadows(sql, shadows) {
  return `WITH ${shadows.join(",\n")}\n${sql}`;
}

let clientPromise = null;

async function client() {
  if (!clientPromise) {
    clientPromise = (async () => {
      const require = createRequire(import.meta.url);
      const pg = require("pg");
      const url = process.env.DATABASE_URL;
      const c = new pg.Client({
        connectionString: url,
        ssl: /localhost|127\.0\.0\.1/.test(url) ? undefined : { rejectUnauthorized: false }
      });
      await c.connect();
      return c;
    })();
  }
  return clientPromise;
}

/** Run one statement in a READ ONLY transaction and roll it back. Returns the pg result. */
export async function runShadowSql(sql, params = []) {
  const c = await client();
  await c.query("BEGIN READ ONLY");
  try {
    return await c.query(sql, params);
  } finally {
    await c.query("ROLLBACK");
  }
}

export async function closeShadowDb() {
  if (!clientPromise) return;
  const c = await clientPromise;
  clientPromise = null;
  await c.end();
}

export const ORG = "11111111-1111-4111-8111-111111111111";
export const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

/** The client columns every lane reads. */
export const CLIENT_COLS = [
  ["id", "uuid"], ["org_id", "uuid"], ["client_code", "text"], ["email", "text"],
  ["is_demo", "boolean"], ["custom_fields", "jsonb"]
];

export const client_ = (id, over = {}) => ({
  id, org_id: ORG, client_code: `FH-${String(id).slice(-6)}`, email: "buyer@gmail.com", is_demo: false, custom_fields: {}, ...over
});

/** A fake db whose query() answers by the /* gap:<tag> * / comment in the SQL. */
export function tagDb(answers, seen = []) {
  return {
    async query(sql, params) {
      const tag = /\/\*\s*gap:([a-z0-9-]+)\s*\*\//.exec(String(sql));
      seen.push({ tag: tag ? tag[1] : null, sql: String(sql), params });
      const key = tag ? tag[1] : "";
      if (!(key in answers)) throw new Error(`unexpected sql: ${String(sql).slice(0, 80)}`);
      const a = answers[key];
      if (a instanceof Error) throw a;
      if (typeof a === "function") return a(params, sql);
      return { rows: Array.isArray(a) ? a : [a] };
    }
  };
}
