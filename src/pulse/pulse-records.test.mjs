// Source-level checks of migration 475 (the hourly pulse's three tables). No database needed.
//
// The behaviour half lives in src/pulse/pulse-records.pg.test.mjs (real Postgres, CI only). This half reads the
// SQL file and fails if a lock, a constraint, a grant or the migration number is undone. It also pins the lists
// in the SQL (cause categories, fixer states, link classes) to the same lists in src/pulse/records.mjs, so the
// two cannot drift apart.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as records from "./records.mjs";
import { CAUSE_CATEGORIES, FIXER_STATUSES, BANK_LINK_CLASSES, CLOSED_BY } from "./records.mjs";
import { EXPECTED_MIGRATIONS } from "../../db/expected-migrations.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.resolve(HERE, "../../db/migrations");
const FILE = "475_pulse_beats_incidents.sql";
const TABLES = ["pulse_beats", "pulse_incidents", "pulse_bank_links"];

const raw = fs.readFileSync(path.join(DIR, FILE), "utf8");
/* Comments talk about the very things asserted below; match against code only. */
const code = raw.split("\n").filter((l) => !/^\s*--/.test(l)).join("\n");

/** The body of one CREATE TABLE statement. */
function tableBody(name) {
  const start = code.indexOf(`CREATE TABLE IF NOT EXISTS public.${name} (`);
  assert.ok(start >= 0, `${name} is not created`);
  const end = code.indexOf("\n);", start);
  assert.ok(end > start, `${name} CREATE TABLE is not closed`);
  return code.slice(start, end);
}

describe("migration 475: the file and its number", () => {
  test("the number 475 is used by exactly one file", () => {
    const same = fs.readdirSync(DIR).filter((f) => f.startsWith("475_"));
    assert.deepEqual(same, [FILE], "two migrations share the number 475, or the file was renamed");
  });

  test("it sorts after the migration before it, and the manifest lists it", () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    const at = files.indexOf(FILE);
    assert.ok(at > 0);
    assert.ok(parseInt(files[at - 1], 10) < 475, `${files[at - 1]} sorts right before 475 but is not numbered lower`);
    assert.ok(EXPECTED_MIGRATIONS.includes(`migrations/${FILE}`), "run `npm run migrations:manifest`");
  });

  test("it creates the three tables with IF NOT EXISTS and never drops, truncates or deletes", () => {
    for (const t of TABLES) assert.match(code, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${t} \\(`));
    assert.doesNotMatch(code, /\bDROP\s+(TABLE|INDEX|POLICY|CONSTRAINT|COLUMN)\b/i);
    assert.doesNotMatch(code, /\bTRUNCATE\s+TABLE\b/i);
    assert.doesNotMatch(code, /\bDELETE\s+FROM\b/i);
    assert.doesNotMatch(code, /CONCURRENTLY/i, "ship applies each file in one transaction; CONCURRENTLY cannot run there");
  });

  test("every table carries org_id, tied to orgs", () => {
    for (const t of TABLES) {
      assert.match(tableBody(t), /org_id\s+uuid\s+NOT NULL REFERENCES orgs\(id\)/, `${t} has no org_id`);
    }
  });
});

describe("migration 475: locks and grants", () => {
  test("row security is ENABLEd and FORCEd on all three tables", () => {
    for (const t of TABLES) {
      assert.match(code, new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`), `${t} not enabled`);
      assert.match(code, new RegExp(`ALTER TABLE public\\.${t}\\s+FORCE\\s+ROW LEVEL SECURITY`), `${t} not forced`);
    }
  });

  test("each table gets a permissive <table>_app_all policy (a locked-shut table is invisible to the app)", () => {
    assert.match(code, /FOREACH t IN ARRAY ARRAY\['pulse_beats', 'pulse_incidents', 'pulse_bank_links'\]/);
    assert.match(code, /t \|\| '_app_all'/);
    assert.match(code, /CREATE POLICY %I ON public\.%I USING \(true\) WITH CHECK \(true\)/);
    assert.match(code, /pg_policies WHERE schemaname = 'public' AND tablename = t AND policyname = t \|\| '_app_all'/);
  });

  test("the public web keys (anon, authenticated) are revoked on every table, guarded by pg_roles", () => {
    const i = code.indexOf("FOREACH r IN ARRAY ARRAY['anon', 'authenticated']");
    assert.ok(i > 0, "no anon / authenticated revoke");
    const block = code.slice(code.lastIndexOf("DO $$", i), code.indexOf("END $$;", i));
    assert.match(block, /FOREACH t IN ARRAY ARRAY\['pulse_beats', 'pulse_incidents', 'pulse_bank_links'\]/);
    assert.match(block, /REVOKE ALL ON public\.%I FROM %I/);
    assert.match(block, /rolname = r/);
  });

  test("grants to fundhub_app are exactly: beats select+insert; incidents and bank links select+insert+update", () => {
    const grants = [...code.matchAll(/GRANT\s+([A-Z, ]+?)\s+ON\s+public\.(\w+)\s+TO\s+fundhub_app/g)]
      .map((m) => [m[2], m[1].replace(/\s+/g, "").split(",").sort().join(",")]);
    assert.deepEqual(grants.sort((a, b) => a[0].localeCompare(b[0])), [
      ["pulse_bank_links", "INSERT,SELECT,UPDATE"],
      ["pulse_beats", "INSERT,SELECT"],
      ["pulse_incidents", "INSERT,SELECT,UPDATE"]
    ]);
  });

  test("no GRANT anywhere includes DELETE, TRUNCATE or ALL for the app (no delete, no retention job)", () => {
    for (const m of code.matchAll(/\bGRANT\b[^;]*;/gi)) {
      assert.doesNotMatch(m[0], /\b(DELETE|TRUNCATE|ALL)\b/i, `a grant gives away delete: ${m[0]}`);
    }
  });

  test("the default write privileges from 104 are taken back, and the whole block is guarded by pg_roles", () => {
    assert.match(code, /IF EXISTS \(SELECT 1 FROM pg_roles WHERE rolname = 'fundhub_app'\)/);
    assert.match(code, /REVOKE UPDATE, DELETE, TRUNCATE ON public\.pulse_beats FROM fundhub_app/);
    assert.match(code, /REVOKE DELETE, TRUNCATE\s+ON public\.pulse_incidents FROM fundhub_app/);
    assert.match(code, /REVOKE DELETE, TRUNCATE\s+ON public\.pulse_bank_links FROM fundhub_app/);
  });

  test("every table and the learning and link columns carry a comment", () => {
    for (const t of TABLES) assert.match(code, new RegExp(`COMMENT ON TABLE public\\.${t} IS`));
    for (const c of ["pulse_beats.duration_ms", "pulse_incidents.last_alert_at", "pulse_incidents.closed_by",
      "pulse_incidents.cause_category", "pulse_incidents.guard_added", "pulse_bank_links.url_hash", "pulse_bank_links.last_good_at"]) {
      assert.match(code, new RegExp(`COMMENT ON COLUMN public\\.${c.replace(".", "\\.")} IS`), `no comment on ${c}`);
    }
  });
});

describe("migration 475: constraints", () => {
  const REQUIRED = {
    pulse_beats: ["pulse_beats_beat_id_ck", "pulse_beats_step_ck", "pulse_beats_detail_ck", "pulse_beats_duration_ck",
      "pulse_beats_steps_ck", "pulse_beats_red_says_where_ck", "pulse_beats_one_per_run"],
    pulse_incidents: ["pulse_incidents_beat_id_ck", "pulse_incidents_first_step_ck", "pulse_incidents_first_detail_ck",
      "pulse_incidents_alerts_ck", "pulse_incidents_issue_number_ck", "pulse_incidents_issue_url_ck",
      "pulse_incidents_fixer_status_ck", "pulse_incidents_session_url_ck", "pulse_incidents_cause_category_ck",
      "pulse_incidents_cause_note_ck", "pulse_incidents_fix_summary_ck", "pulse_incidents_guard_added_ck",
      "pulse_incidents_closed_by_ck", "pulse_incidents_closed_pair_ck", "pulse_incidents_closed_after_open_ck",
      "pulse_incidents_issue_pair_ck", "pulse_incidents_alert_pair_ck", "pulse_incidents_learned_ck"],
    pulse_bank_links: ["pulse_bank_links_hash_ck", "pulse_bank_links_host_ck", "pulse_bank_links_class_ck",
      "pulse_bank_links_status_ck", "pulse_bank_links_detail_ck", "pulse_bank_links_streak_ck", "pulse_bank_links_final_host_ck"]
  };

  for (const [table, names] of Object.entries(REQUIRED)) {
    test(`${table} carries every named constraint`, () => {
      const body = tableBody(table);
      for (const n of names) assert.match(body, new RegExp(`CONSTRAINT ${n}\\b`), `${n} is missing`);
    });
  }

  test("a red beat must say where and why", () => {
    assert.match(tableBody("pulse_beats"), /pulse_beats_red_says_where_ck CHECK \(ok OR \(step IS NOT NULL AND detail IS NOT NULL\)\)/);
  });

  test("an unmeasured duration is NULL and is never defaulted to 0", () => {
    const dur = /duration_ms\s+integer[^,]*?\n[^\n]*pulse_beats_duration_ck CHECK \(duration_ms IS NULL OR duration_ms >= 0\)/.exec(tableBody("pulse_beats"));
    assert.ok(dur, "duration_ms must allow NULL");
    assert.doesNotMatch(tableBody("pulse_beats"), /duration_ms\s+integer\s+(NOT NULL|DEFAULT)/i);
  });

  test("a retried run cannot double-insert a beat: UNIQUE (run_id, beat_id)", () => {
    assert.match(tableBody("pulse_beats"), /CONSTRAINT pulse_beats_one_per_run UNIQUE \(run_id, beat_id\)/);
  });

  test("at most one OPEN incident per beat: a partial unique index on (org_id, beat_id) WHERE closed_at IS NULL", () => {
    assert.match(code, /CREATE UNIQUE INDEX IF NOT EXISTS pulse_incidents_one_open\s+ON public\.pulse_incidents \(org_id, beat_id\) WHERE closed_at IS NULL/);
  });

  test("closed by Claude or Chris, all four learning fields are required (auto may leave them empty)", () => {
    const learned = /CONSTRAINT pulse_incidents_learned_ck CHECK \(([\s\S]*?)\n  \)/.exec(code);
    assert.ok(learned, "learned_ck missing");
    const sql = learned[1];
    assert.match(sql, /closed_by IS NULL OR closed_by = 'auto'/);
    assert.match(sql, /cause_category IS NOT NULL/);
    for (const f of ["cause_note", "fix_summary", "guard_added"]) {
      assert.match(sql, new RegExp(`btrim\\(coalesce\\(${f}, ''\\)\\)\\s+<> ''`), `${f} may be blank`);
    }
  });

  test("a text and its count agree: alerts_sent = 0 exactly when last_alert_at is NULL", () => {
    assert.match(code, /pulse_incidents_alert_pair_ck\s+CHECK \(\(alerts_sent = 0\) = \(last_alert_at IS NULL\)\)/);
  });

  test("closed_at and closed_by are set together, and a close cannot come before the open", () => {
    assert.match(code, /pulse_incidents_closed_pair_ck\s+CHECK \(\(closed_at IS NULL\) = \(closed_by IS NULL\)\)/);
    assert.match(code, /pulse_incidents_closed_after_open_ck CHECK \(closed_at IS NULL OR closed_at >= opened_at\)/);
  });

  test("the GitHub columns exist and stay NULL-able (they are NULL tonight), number and url together", () => {
    const body = tableBody("pulse_incidents");
    assert.match(body, /github_issue_number\s+integer\n/);
    assert.match(body, /github_issue_url\s+text\n/);
    assert.match(code, /pulse_incidents_issue_pair_ck\s+CHECK \(\(github_issue_number IS NULL\) = \(github_issue_url IS NULL\)\)/);
    assert.match(body, /fixer_status\s+text\s+NOT NULL DEFAULT 'not_set_up'/);
  });

  test("the beat id pattern holds the 44 character label limit on both tables that use it", () => {
    const re = "'^[a-z0-9][a-z0-9-]{0,43}$'";
    assert.equal(code.split(`beat_id ~ ${re}`).length - 1, 2, "pulse_beats and pulse_incidents each check the beat id");
  });

  test("the bank link hash is sha-256 hex and the URL itself has no column", () => {
    const body = tableBody("pulse_bank_links");
    assert.match(body, /url_hash ~ '\^\[0-9a-f\]\{64\}\$'/);
    assert.doesNotMatch(body, /\burl\s+text/i);
    assert.match(body, /PRIMARY KEY \(org_id, url_hash\)/);
  });

  test("the lists in the SQL are the same lists records.mjs checks before it sends", () => {
    const list = (tableName, constraint) => {
      const m = new RegExp(`CONSTRAINT ${constraint} CHECK \\([^()]*?IN\\s*\\(([^()]*)\\)`).exec(tableBody(tableName));
      assert.ok(m, `${constraint} list not found`);
      return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
    };
    assert.deepEqual(list("pulse_incidents", "pulse_incidents_cause_category_ck"), [...CAUSE_CATEGORIES]);
    assert.deepEqual(list("pulse_incidents", "pulse_incidents_fixer_status_ck"), [...FIXER_STATUSES]);
    assert.deepEqual(list("pulse_incidents", "pulse_incidents_closed_by_ck"), [...CLOSED_BY]);
    assert.deepEqual(list("pulse_bank_links", "pulse_bank_links_class_ck"), [...BANK_LINK_CLASSES]);
  });

  test("the indexes the record functions lean on exist", () => {
    assert.match(code, /pulse_beats_beat_ran_idx ON public\.pulse_beats \(org_id, beat_id, ran_at DESC\)/);
    assert.match(code, /pulse_beats_ran_at_idx\s+ON public\.pulse_beats \(ran_at\)/);
    assert.match(code, /pulse_bank_links_due_idx ON public\.pulse_bank_links \(org_id, last_checked_at NULLS FIRST\)/);
  });
});

describe("records.mjs names only columns that migration 475 creates", () => {
  /** The column names of one table, from its CREATE TABLE text. */
  const columns = (table) => new Set([...tableBody(table).matchAll(/^ {2}([a-z_]+)\s+\S/gm)].map((m) => m[1]));

  /** [statement name, table, column names the statement writes or reads] */
  const written = (sql) => {
    const m = /INSERT INTO (\w+)(?: AS \w+)?\s*\(([^)]*)\)/.exec(sql);
    return m ? [m[1], m[2].split(",").map((c) => c.trim())] : null;
  };
  const setTargets = (sql) => {
    const m = /\bSET\s+([\s\S]*?)\s+WHERE\b/.exec(sql);
    return m ? [...m[1].matchAll(/(?:^|,)\s*([a-z_]+)\s*=/g)].map((x) => x[1]) : [];
  };

  test("the column parser finds the columns it should", () => {
    assert.ok(columns("pulse_beats").has("duration_ms"));
    assert.ok(columns("pulse_incidents").has("opened_run_id"));
    assert.ok(columns("pulse_bank_links").has("fail_streak"));
    assert.equal(columns("pulse_beats").has("PRIMARY"), false);
    assert.equal(columns("pulse_incidents").size, 19);
  });

  for (const name of ["SQL_WRITE_BEATS", "SQL_OPEN_INCIDENT", "SQL_UPSERT_BANK_LINKS"]) {
    test(`${name}: every INSERT column exists`, () => {
      const [table, cols] = written(records[name]);
      const have = columns(table);
      for (const c of cols) assert.ok(have.has(c), `${name} writes ${table}.${c}, which 475 does not create`);
      assert.ok(cols.length >= 7);
    });
  }

  for (const [name, table] of [["SQL_CLAIM_ALERT", "pulse_incidents"], ["SQL_SET_ISSUE", "pulse_incidents"],
    ["SQL_SET_FIXER", "pulse_incidents"], ["SQL_CLOSE_INCIDENT", "pulse_incidents"]]) {
    test(`${name}: every column it sets exists on ${table}`, () => {
      const targets = setTargets(records[name]);
      assert.ok(targets.length >= 2, `${name}: SET list not parsed`);
      for (const c of targets) assert.ok(columns(table).has(c), `${name} sets ${table}.${c}, which 475 does not create`);
    });
  }

  test("the upsert's DO UPDATE sets only bank link columns", () => {
    const sql = records.SQL_UPSERT_BANK_LINKS;
    const tail = sql.slice(sql.indexOf("DO UPDATE SET") + "DO UPDATE SET".length);
    const targets = [...tail.matchAll(/^\s{2}([a-z_]+)\s*=/gm)].map((x) => x[1]);
    assert.ok(targets.length >= 9);
    for (const c of targets) assert.ok(columns("pulse_bank_links").has(c), `upsert sets ${c}`);
    assert.equal(targets.includes("first_seen_at"), false);
    assert.equal(targets.includes("org_id"), false);
    assert.equal(targets.includes("url_hash"), false);
  });

  for (const [name, table] of [["SQL_LIST_OPEN", "pulse_incidents"], ["SQL_LOAD_BANK_LINKS", "pulse_bank_links"],
    ["SQL_LAST_24", "pulse_beats"], ["SQL_LAST_RESULTS", "pulse_beats"]]) {
    test(`${name}: every column it reads exists on ${table}`, () => {
      const sql = records[name];
      const select = /SELECT\s+([\s\S]*?)\s+FROM\s+(?:pulse_|unnest)/.exec(sql);
      assert.ok(select, `${name}: SELECT list not parsed`);
      const cols = select[1].split(",").map((c) => c.trim().replace(/^\w+\./, "")).filter(Boolean);
      assert.ok(cols.length >= 5);
      for (const c of cols) assert.ok(columns(table).has(c), `${name} reads ${table}.${c}, which 475 does not create`);
    });
  }
});
