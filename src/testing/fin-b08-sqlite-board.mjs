// finish-853 batch 08: a stand-in database for the board read that RUNS THE STATEMENT'S OWN SQL.
//
// The other stand-ins in this batch answer a statement by matching its text and filtering rows in
// JavaScript, so a clause that is dropped from the SQL is never noticed. This one hands the real
// statement to a real SQL engine (the SQLite that ships inside Node) over in-memory tables. A join
// that points at the wrong column, a company condition that is gone, a flag that reads the wrong
// client: each changes the rows the engine returns, and the test sees it.
//
// SQLite is not Postgres. Only three things are rewritten before a statement runs, and nothing else
// is touched:
//   1. casts such as ::boolean and ::uuid are dropped (SQLite stores them as plain values);
//   2. $1, $2 ... become ?1, ?2 ... (the same parameter, a different marker);
//   3. "JOIN LATERAL (<newest row subquery>) alias ON true" becomes the same newest-row subquery used
//      where the alias is read, because SQLite has no LATERAL. The subquery text is the product's own.
// Practice test, fake data, no network, no Postgres.
import { DatabaseSync } from "node:sqlite";

const SCHEMA = `
  CREATE TABLE orgs (id TEXT PRIMARY KEY, demo_mode_enabled INTEGER);
  CREATE TABLE pipelines (id TEXT PRIMARY KEY, org_id TEXT, "key" TEXT, name TEXT);
  CREATE TABLE pipeline_stages (id TEXT PRIMARY KEY, pipeline_id TEXT, org_id TEXT, "key" TEXT, name TEXT, sort_order INTEGER);
  CREATE TABLE cards (id TEXT PRIMARY KEY, org_id TEXT, client_id TEXT, partner_id TEXT, pipeline_id TEXT, stage_id TEXT, owner TEXT, entered_at TEXT);
  CREATE TABLE clients (id TEXT PRIMARY KEY, org_id TEXT, first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
                        outcome_tier TEXT, funded INTEGER, funded_amount REAL, is_demo INTEGER, custom_fields TEXT);
  CREATE TABLE partners (id TEXT PRIMARY KEY, org_id TEXT, name TEXT, contact_email TEXT);
  CREATE TABLE conversations (id TEXT PRIMARY KEY, org_id TEXT, client_id TEXT, channel TEXT);
  CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT, direction TEXT, created_at TEXT);
  CREATE TABLE funding_rounds (id TEXT PRIMARY KEY, org_id TEXT, client_id TEXT, round_number INTEGER, created_at TEXT);
  CREATE TABLE applications (id TEXT PRIMARY KEY, org_id TEXT, client_id TEXT, funding_round_id TEXT, status TEXT,
                             approval_excluded_at TEXT, approved_amount REAL);
  CREATE TABLE bookings (id TEXT PRIMARY KEY, org_id TEXT, client_id TEXT, starts_at TEXT, status TEXT, created_at TEXT);
  CREATE TABLE native_client_app_opens (org_id TEXT, client_id TEXT, platform TEXT, first_authenticated_at TEXT);
`;

// Columns Postgres hands back as true/false; SQLite stores 0/1.
const BOOLEAN_COLUMNS = new Set(["funded", "is_demo", "demo_mode_enabled", "sms_needs_reply", "email_needs_reply", "approval_amount_missing"]);

export function postgresToSqlite(sql) {
  let s = String(sql).replace(/\/\*[\s\S]*?\*\//g, " ");
  s = s.replace(/::[a-z_]+(\[\])?/gi, "");
  s = s.replace(/\bNOW\(\)/gi, "CURRENT_TIMESTAMP");
  const lateral = /JOIN LATERAL\s*\(([\s\S]*?\bLIMIT\s+1)\s*\)\s*(\w+)\s+ON true/gi;
  const found = [...s.matchAll(lateral)];
  if (found.length) {
    let out = "";
    let pos = 0;
    found.forEach((m, i) => {
      out += s.slice(pos, m.index);
      const segStart = m.index + m[0].length;
      const segEnd = found[i + 1] ? found[i + 1].index : s.length;
      // Where the alias is read (last.direction), the newest-row subquery stands in its place.
      out += s.slice(segStart, segEnd).replace(new RegExp(`\\b${m[2]}\\.(\\w+)`, "g"), () => `(${m[1]})`);
      pos = segEnd;
    });
    s = out + s.slice(pos);
  }
  return s.replace(/\$(\d+)/g, "?$1");
}

export function sqliteBoard() {
  const engine = new DatabaseSync(":memory:");
  engine.exec(SCHEMA);
  const calls = [];

  function insert(table, row) {
    const cols = Object.keys(row);
    const vals = cols.map((c) => {
      const v = row[c];
      if (v === undefined) return null;
      if (typeof v === "boolean") return v ? 1 : 0;
      if (v !== null && typeof v === "object") return JSON.stringify(v);
      return v;
    });
    engine.prepare(`INSERT INTO ${table} (${cols.map((c) => `"${c}"`).join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`).run(...vals);
  }

  async function query(sql, params = []) {
    const text = typeof sql === "string" ? sql : (sql && sql.text) || "";
    const args = typeof sql === "string" ? params : (sql && sql.values) || params;
    calls.push({ sql: text, params: args });
    const translated = postgresToSqlite(text);
    const bound = (args || []).map((v) => (typeof v === "boolean" ? (v ? 1 : 0) : v === undefined ? null : v));
    const rows = engine.prepare(translated).all(...bound).map((r) => {
      const plain = { ...r };
      for (const k of Object.keys(plain)) {
        if (BOOLEAN_COLUMNS.has(k) && (plain[k] === 0 || plain[k] === 1)) plain[k] = plain[k] === 1;
      }
      return plain;
    });
    return { rows, rowCount: rows.length };
  }

  return {
    calls,
    query,
    insert,
    connect: async () => ({ query, release() {} }),
  };
}
