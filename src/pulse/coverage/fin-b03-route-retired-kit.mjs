// Test kit for the retired closer-deck send_ebook check (finish the 853, batch 03). Not part of the live bundle.
//
// A real SQL engine (node:sqlite, built into Node 22) with the three tables the check reads, and the made-up
// rows both test files use. The lane's own SQL strings run on it unchanged. The engine is not Postgres, so
// fin-b03-route-retired.pg.test.mjs runs the same strings on Postgres where a database is set.

import { DatabaseSync } from "node:sqlite";

export const LANE_ORG = "0a000000-0000-4000-8000-000000000001";
export const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";

export const LONG_AGO = "2026-09-01T18:00:00.000Z";
export const JUST_BEFORE = "2026-10-12T16:35:59.999Z";
export const AT_CUTOFF = "2026-10-12T16:36:00.000Z";
export const AFTER = "2026-10-13T20:10:00.000Z";
export const LINK_REF = "staff:ebook-send:9b7c1d2e-0000-4000-8000-000000000042";

const TABLES = `
CREATE TABLE clients (id INTEGER PRIMARY KEY, org_id TEXT, custom_fields TEXT);
CREATE TABLE payment_links (id INTEGER PRIMARY KEY, org_id TEXT, purpose TEXT, description TEXT, created_at TEXT);
CREATE TABLE messages (id INTEGER PRIMARY KEY, org_id TEXT, provider_ref TEXT, created_at TEXT);`;

/** A database handle ({ query, calls }). Rows go in as given. `drop` removes a table, the way a wrong table name
 *  would fail. The engine is made read only after the rows are in, so a statement that writes fails inside the
 *  engine too. */
export function scratch({ clients = [], links = [], messages = [], drop = [] } = {}) {
  const engine = new DatabaseSync(":memory:");
  // Postgres LIKE is case sensitive and SQLite's is not by default. Match Postgres, so a dropped lower() shows.
  engine.exec("PRAGMA case_sensitive_like = ON");
  engine.exec(TABLES);
  const add = (table, columns, rows) => {
    const stmt = engine.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
    for (const row of rows) stmt.run(...columns.map((column) => row[column] ?? null));
  };
  add("clients", ["org_id", "custom_fields"], clients);
  add("payment_links", ["org_id", "purpose", "description", "created_at"], links);
  add("messages", ["org_id", "provider_ref", "created_at"], messages);
  for (const table of drop) engine.exec(`DROP TABLE ${table}`);
  engine.exec("PRAGMA query_only = ON");
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      const call = { sql, params, returned: null };
      calls.push(call);
      const bind = Object.fromEntries(params.map((value, index) => [`$${index + 1}`, value]));
      const rows = engine.prepare(sql).all(bind).map((row) => ({ ...row }));
      call.returned = rows.length;
      return { rows };
    },
  };
}

/** The same database, with rows handed back the way the pg driver hands them back. A timestamptz column
 *  (payment_links.created_at, messages.created_at) is a JS Date. A jsonb ->> read (the client marker) is text.
 *  The scratch engine alone returns text for both, so without this no test feeds the check a Date.
 *  `fed` counts how many saved times were turned into a Date and how many stayed text. */
export function postgresShaped(db) {
  const fed = { dates: 0, texts: 0 };
  return {
    calls: db.calls,
    fed,
    async query(sql, params = []) {
      const answer = await db.query(sql, params);
      const timestamptz = /\bFROM (payment_links|messages)\b/.test(sql);
      return {
        rows: answer.rows.map((row) => {
          if (timestamptz && typeof row.saved_at === "string") {
            fed.dates += 1;
            return { ...row, saved_at: new Date(row.saved_at) };
          }
          fed.texts += 1;
          return row;
        }),
      };
    },
  };
}

/** A hand-made database that answers each trace with exactly the saved times given (any JS value: a Date,
 *  text, null). `link`, `message` and `marker` are one value or an array. Nothing else is read. */
export function handMade({ link, message, marker } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      const pick = /\bFROM payment_links\b/.test(sql) ? link : /\bFROM messages\b/.test(sql) ? message : marker;
      const list = pick === undefined ? [] : [].concat(pick);
      return { rows: list.map((saved_at) => ({ saved_at })) };
    },
  };
}

/** A client file carrying the send marker (what the old action wrote last). */
export const marker = (sentAt, org = LANE_ORG) => ({ org_id: org, custom_fields: JSON.stringify({ closer_deck_ebook_sent_at: sentAt }) });
/** A client file with some other deck marker, no e-book send. */
export const plainClient = (org = LANE_ORG) => ({ org_id: org, custom_fields: JSON.stringify({ closer_deck_soft_pull_sent_at: AFTER }) });
/** A pay link. Custom purpose and the e-book label unless said otherwise. */
export const link = (at, description = "Fundhub e-book", over = {}) => ({ org_id: LANE_ORG, purpose: "custom", description, created_at: at, ...over });
/** An email row. The e-book send key unless said otherwise. */
export const email = (at, ref = LINK_REF, org = LANE_ORG) => ({ org_id: org, provider_ref: ref, created_at: at });
