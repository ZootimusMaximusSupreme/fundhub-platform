// The read box. Two walls: the allow-list (assertReadOnlySql) and Postgres READ ONLY.
// This file proves wall 1 hard and the box's behaviour against a fake that acts like Postgres where
// it matters (an aborted transaction stays aborted). Wall 2 on the REAL database is proven by
//   node scripts/pulse/run-beat.mjs --probe
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PulseRefused, assertReadOnlySql, normalizeQuery, openReadBox, readDbSettings, DB_SETTINGS_SQL, DEFAULT_MAX_STATEMENTS,
  TX_ENDER, READ_ONLY_CHECK_SQL
} from "./readbox.mjs";
import { createFakePg } from "../fake-sinks.mjs";

const refusedWith = (sql, part) => {
  assert.throws(() => assertReadOnlySql(sql), (err) => {
    assert.ok(err instanceof PulseRefused, `expected PulseRefused for: ${String(sql).slice(0, 60)}`);
    assert.equal(err.kind, "sql");
    if (part) assert.match(err.reason, part, `reason was "${err.reason}"`);
    return true;
  });
};

/* ---------------- the allow-list: what gets through ---------------- */

test("allow-list: plain reads pass, including words that only LOOK like writes", () => {
  const ok = [
    "SELECT 1",
    "SELECT 1;",
    "select 1 ;   ",
    "  \n\t SELECT 1",
    "WITH x AS (SELECT 1 AS a) SELECT a FROM x",
    "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM t WHERE n < 3) SELECT * FROM t",
    "SHOW transaction_read_only",
    "SELECT updated_at, created_at, granted_by, date_trunc('day', now()) FROM job_heartbeats",
    "SELECT * FROM messages WHERE status = 'queued' AND created_at < now() - interval '15 minutes'",
    "SELECT CASE WHEN a THEN 1 ELSE 2 END FROM t",
    "SELECT * FROM t WHERE id = $1 AND kind = ANY($2)",
    "SELECT has_table_privilege(current_user, 'public.clients', 'INSERT') AS can_insert",
    // words and semicolons inside strings, comments and quoted names are not statements
    "SELECT 'insert into x; delete from y' AS note",
    "SELECT 'it''s; DROP TABLE x' AS note",
    "SELECT 1 -- ; DROP TABLE x",
    "SELECT 1 /* DELETE FROM t; */",
    "SELECT 1 /* nested /* DELETE */ still comment */",
    'SELECT "update", "delete" FROM t',
    "SELECT $$ delete from t; $$ AS body",
    "SELECT $tag$ drop table x; $tag$ AS body",
    "SELECT E'\\'; DELETE FROM t; --' AS one_string",
    "SELECT * FROM t WHERE note LIKE '%pg_sleep%'"
  ];
  for (const sql of ok) assert.equal(assertReadOnlySql(sql), sql, sql);
});

/* ---------------- the allow-list: what is refused ---------------- */

test("allow-list: every kind of write is refused, and the reason names it", () => {
  const cases = [
    ["INSERT INTO clients (a) VALUES (1)", /not_a_read.*INSERT/],
    ["UPDATE clients SET a = 1", /not_a_read.*UPDATE/],
    ["DELETE FROM clients", /not_a_read.*DELETE/],
    ["TRUNCATE clients", /not_a_read.*TRUNCATE/],
    ["DROP TABLE clients", /not_a_read.*DROP/],
    ["ALTER TABLE clients ADD COLUMN a int", /not_a_read.*ALTER/],
    ["CREATE TEMP TABLE x (a int)", /not_a_read.*CREATE/],
    ["GRANT ALL ON clients TO public", /not_a_read.*GRANT/],
    ["REVOKE ALL ON clients FROM public", /not_a_read.*REVOKE/],
    ["COMMIT", /not_a_read.*COMMIT/],
    ["END", /not_a_read.*END/],
    ["BEGIN", /not_a_read.*BEGIN/],
    ["ROLLBACK", /not_a_read.*ROLLBACK/],
    ["SAVEPOINT x", /not_a_read.*SAVEPOINT/],
    ["RELEASE SAVEPOINT x", /not_a_read.*RELEASE/],
    ["SET LOCAL transaction_read_only = off", /not_a_read.*SET/],
    ["RESET ALL", /not_a_read.*RESET/],
    ["DISCARD ALL", /not_a_read.*DISCARD/],
    ["VACUUM", /not_a_read.*VACUUM/],
    ["EXPLAIN ANALYZE SELECT 1", /not_a_read.*EXPLAIN/],
    ["COPY clients TO STDOUT", /not_a_read.*COPY/],
    ["LISTEN x", /not_a_read.*LISTEN/],
    ["NOTIFY x", /not_a_read.*NOTIFY/],
    ["DO $$ BEGIN PERFORM 1; END $$", /not_a_read.*DO/],
    ["CALL do_something()", /not_a_read.*CALL/],
    ["PREPARE x AS SELECT 1", /not_a_read.*PREPARE/],
    ["(SELECT 1)", /not_a_read/],
    ["/* hiding */ INSERT INTO t VALUES (1)", /not_a_read.*INSERT/],
    ["-- hiding\nDELETE FROM t", /not_a_read.*DELETE/],
    ["insert into t values (1)", /not_a_read.*INSERT/]
  ];
  for (const [sql, re] of cases) refusedWith(sql, re);
});

test("allow-list: a second statement is refused however it is dressed up", () => {
  const cases = [
    "SELECT 1; SELECT 2",
    "SELECT 1;SELECT 2",
    "SELECT 1; DELETE FROM clients",
    "SELECT 1;\nDROP TABLE clients",
    "SELECT 1; -- harmless\nDELETE FROM clients",
    "SELECT 1; /* hide */ DELETE FROM clients",
    "SELECT 1;; ",
    "SELECT 1; COMMIT",
    // a string that PostgreSQL ends early: standard strings have no backslash escape
    "SELECT '\\'; DELETE FROM t; --'",
    // E-string: \\ is one backslash, so the quote after it ends the string
    "SELECT E'\\\\'; DELETE FROM t; --'"
  ];
  for (const sql of cases) refusedWith(sql, /more_than_one_statement|write_word|not_a_read|unterminated/);
  refusedWith("SELECT 1; SELECT 2", /more_than_one_statement/);
});

test("allow-list: data-modifying CTEs, SELECT INTO and row locks are refused", () => {
  refusedWith("WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d", /write_word_delete/);
  refusedWith("WITH i AS (INSERT INTO t VALUES (1) RETURNING *) SELECT * FROM i", /write_word_insert/);
  refusedWith("WITH u AS (UPDATE t SET a = 1 RETURNING *) SELECT * FROM u", /write_word_update/);
  refusedWith("SELECT * INTO newtable FROM t", /select_into/);
  refusedWith("SELECT * FROM t FOR UPDATE", /write_word_update/);
  refusedWith("SELECT * FROM t FOR SHARE", /row_lock/);
  refusedWith("SELECT * FROM t FOR KEY SHARE", /row_lock/);
});

test("allow-list: functions with effects are refused, bare or quoted or schema-qualified", () => {
  const cases = [
    ["SELECT set_config('fundhub.actor','staff',true)", /set_config/],
    ["SELECT pg_advisory_lock(1)", /pg_advisory_lock/],
    ["SELECT pg_try_advisory_lock(1)", /pg_try_advisory_lock/],
    ["SELECT pg_advisory_xact_lock(1)", /pg_advisory_xact_lock/],
    ["SELECT pg_sleep(1)", /pg_sleep/],
    ["SELECT pg_sleep_for('1s')", /pg_sleep_for/],
    ["SELECT pg_catalog.pg_sleep(1)", /pg_sleep/],
    ['SELECT "pg_sleep"(1)', /pg_sleep/],
    ['SELECT pg_catalog."pg_sleep"(1)', /pg_sleep/],
    ['SELECT "SET_CONFIG"(\'a\',\'b\',true)', /set_config/],
    ["SELECT nextval('client_code_seq')", /nextval/],
    ["SELECT setval('client_code_seq', 1)", /setval/],
    ["SELECT dblink('host=x', 'select 1')", /dblink/],
    ["SELECT dblink_exec('host=x', 'delete from t')", /dblink_exec/],
    ["SELECT lo_import('/etc/passwd')", /lo_import/],
    ["SELECT pg_notify('c','x')", /pg_notify/],
    ["SELECT pg_terminate_backend(1)", /pg_terminate_backend/],
    ["SELECT pg_read_file('/etc/passwd')", /pg_read_file/],
    ["SELECT query_to_xml('delete from t', true, false, '')", /query_to_xml/]
  ];
  for (const [sql, re] of cases) refusedWith(sql, re);
  refusedWith('SELECT U&"pg\\0073leep"(1)', /unicode_escaped_identifier/);
});

test("allow-list: unreadable SQL and the wrong kinds of input are refused", () => {
  refusedWith("SELECT 'abc", /unterminated_string/);
  refusedWith("SELECT 1 /* never closed", /unterminated_comment/);
  refusedWith('SELECT "abc', /unterminated_identifier/);
  refusedWith("SELECT $x$ abc", /unterminated_dollar_quote/);
  refusedWith("", /empty_sql/);
  refusedWith("   ;  ", /empty_sql/);
  refusedWith("SELECT 1\u0000", /nul_byte/);
  refusedWith(`SELECT ${"1,".repeat(30_000)}1`, /sql_too_long/);
  for (const bad of [123, null, undefined, {}, ["SELECT 1"], () => "SELECT 1", { text: 5 }]) refusedWith(bad, /non_string_sql/);
});

test("normalizeQuery: { text, values } becomes string + params; other shapes are refused", () => {
  assert.deepEqual(normalizeQuery("SELECT $1", [1]), { text: "SELECT $1", values: [1] });
  assert.deepEqual(normalizeQuery({ text: "SELECT $1", values: [2] }), { text: "SELECT $1", values: [2] });
  assert.deepEqual(normalizeQuery({ text: "SELECT 1" }, undefined), { text: "SELECT 1", values: undefined });
  assert.throws(() => normalizeQuery({ text: "SELECT 1", name: "prepared" }), /unsupported_query_object_keys_name/);
  assert.throws(() => normalizeQuery({ text: "SELECT 1", rowMode: "array" }), /unsupported_query_object_keys_rowMode/);
  assert.throws(() => normalizeQuery("SELECT $1", "not-an-array"), /params_not_an_array/);
  assert.throws(() => normalizeQuery({ text: "COMMIT" }), /not_a_read/);
});

/* ---------------- the box ---------------- */

const open = (pg, extra = {}) => openReadBox({ connect: async () => pg, ...extra });
const FAST = { statementTimeoutMs: 40, guardSlackMs: 20, closeCapMs: 30 };

test("box: BEGIN READ ONLY is first, setup is one trip, and the wall is checked", async () => {
  const pg = createFakePg();
  const box = await open(pg);
  const t = pg.texts();
  assert.match(t[0], /^BEGIN READ ONLY$/);
  assert.match(t[1], /^SET LOCAL statement_timeout = '4000ms'$/);
  assert.match(t[2], /set_config\('fundhub\.actor','staff',true\), set_config\('fundhub\.partner_id','',true\)/);
  assert.match(t[3], /current_setting\('transaction_read_only'\)/);
  assert.equal(pg.readOnly, true);
  assert.equal(box.report().readOnlyVerified, true);
  assert.equal(box.report().began, true);
  await box.close();
});

test("box: scope none skips the staff settings", async () => {
  const pg = createFakePg();
  const box = await open(pg, { scope: "none" });
  assert.equal(pg.settings.length, 0);
  await box.close();
  await assert.rejects(() => openReadBox({ connect: async () => pg, scope: "partner" }), /scope must be/);
});

test("box: refuses to open if Postgres does not say read-only, and destroys the connection", async () => {
  for (const bad of [{ roSetting: "off" }, { scsSetting: "off" }]) {
    const pg = createFakePg(bad);
    await assert.rejects(() => open(pg), (err) => err instanceof PulseRefused && err.kind === "box");
    assert.deepEqual(pg.released, [true]);
  }
});

test("box: a connect failure rejects and a missing connect is a programming error", async () => {
  await assert.rejects(() => openReadBox({ connect: async () => { throw new Error("no route to host"); } }), /no route to host/);
  await assert.rejects(() => openReadBox({}), /needs connect/);
});

test("box: each read is its own savepoint; rows come back; COMMIT is never sent; close rolls back and destroys", async () => {
  const pg = createFakePg({ answer: (text) => (/FROM a\b/.test(text) ? [{ n: 1 }, { n: 2 }] : [{ n: 9 }]) });
  const box = await open(pg);
  const a = await box.read("SELECT n FROM a");
  const b = await box.read("SELECT n FROM b WHERE id = $1", [7]);
  assert.deepEqual(a, { rows: [{ n: 1 }, { n: 2 }], rowCount: 2 });
  assert.deepEqual(b.rows, [{ n: 9 }]);
  const after = pg.texts().slice(4);
  assert.deepEqual(after, [
    "SAVEPOINT pr_1", "SELECT n FROM a", "RELEASE SAVEPOINT pr_1",
    "SAVEPOINT pr_2", "SELECT n FROM b WHERE id = $1", "RELEASE SAVEPOINT pr_2"
  ]);
  assert.deepEqual(pg.statements.at(-2).params, [7]);
  const rep = await box.close();
  assert.equal(pg.texts().at(-1), "ROLLBACK");
  assert.equal(pg.commits, 0);
  assert.equal(rep.commitsSent, 0);
  assert.equal(rep.rolledBack, true);
  assert.equal(rep.destroyed, true);
  assert.deepEqual(pg.released, [true], "released once, as destroy");
  assert.equal(rep.reads, 2);
});

test("box: the fake is honest. Without a savepoint an error poisons the next statement; with it, it does not", async () => {
  // Control: a bare client, no savepoints. This is what would happen without the box.
  const raw = createFakePg({ fail: (t) => (/boom/.test(t) ? new Error("boom") : undefined) });
  await raw.query("BEGIN READ ONLY");
  await assert.rejects(() => raw.query("SELECT boom"), /boom/);
  await assert.rejects(() => raw.query("SELECT 1"), (e) => e.code === "25P02");

  const pg = createFakePg({ fail: (t) => (/boom/.test(t) ? new Error("boom") : undefined), answer: () => [{ ok: 1 }] });
  const box = await open(pg);
  await assert.rejects(() => box.read("SELECT boom"), /^Error: boom$/, "the ORIGINAL error comes back");
  const next = await box.read("SELECT 1");
  assert.deepEqual(next.rows, [{ ok: 1 }]);
  assert.ok(pg.texts().includes("ROLLBACK TO SAVEPOINT pr_1"));
  assert.equal(box.report().errors, 1);
  await box.close();
});

test("box: reads run one at a time, first in first out, no interleaving", async () => {
  const order = [];
  const pg = createFakePg({
    answer: async (text) => {
      const n = Number(/SELECT (\d)/.exec(text)[1]);
      await new Promise((r) => setTimeout(r, n === 1 ? 30 : 1));
      order.push(n);
      return [{ n }];
    }
  });
  const box = await open(pg);
  const results = await Promise.all([box.read("SELECT 1"), box.read("SELECT 2"), box.read("SELECT 3")]);
  assert.deepEqual(results.map((r) => r.rows[0].n), [1, 2, 3]);
  assert.deepEqual(order, [1, 2, 3], "the slow first read still finished first");
  const t = pg.texts().slice(4);
  assert.deepEqual(t, [
    "SAVEPOINT pr_1", "SELECT 1", "RELEASE SAVEPOINT pr_1",
    "SAVEPOINT pr_2", "SELECT 2", "RELEASE SAVEPOINT pr_2",
    "SAVEPOINT pr_3", "SELECT 3", "RELEASE SAVEPOINT pr_3"
  ]);
  await box.close();
});

test("box: a refused statement never reaches the connection and is recorded in the report", async () => {
  const pg = createFakePg();
  const box = await open(pg);
  const before = pg.statements.length;
  for (const sql of ["INSERT INTO clients (a) VALUES (1)", "SELECT 1; DELETE FROM clients", "SELECT set_config('a','b',true)", { text: "COMMIT" }, 42]) {
    await assert.rejects(() => box.read(sql), (err) => err instanceof PulseRefused && err.kind === "sql");
  }
  assert.equal(pg.statements.length, before, "nothing was sent");
  const rep = box.report();
  assert.equal(rep.refused.length, 5);
  assert.ok(rep.refused.every((r) => r.kind === "sql" && r.what));
  assert.match(rep.refused[0].what, /not_a_read/);
  await box.close();
});

test("box: if a bypass reached Postgres, the READ ONLY transaction still refuses it (fake mirrors 25006)", async () => {
  const pg = createFakePg();
  const box = await open(pg);
  // Go AROUND wall 1 on purpose: straight to the client.
  await assert.rejects(() => pg.query("INSERT INTO clients (a) VALUES (1)"), (e) => e.code === "25006");
  await pg.query("ROLLBACK TO SAVEPOINT x").catch(() => {});
  await box.close();
});

test("box: a hung statement is cut by the guard, the box turns away later reads, and close still ends cleanly", async () => {
  const pg = createFakePg({ hang: (t) => /slow/.test(t), hangOnRollback: true });
  const box = await open(pg, FAST);
  const t0 = Date.now();
  await assert.rejects(() => box.read("SELECT slow"), /did not return within/);
  assert.ok(Date.now() - t0 < 400);
  assert.equal(box.report().hung, true);
  await assert.rejects(() => box.read("SELECT 1"), (e) => e instanceof PulseRefused && /read_box_is_hung/.test(e.reason));

  const c0 = Date.now();
  const rep = await box.close({ timedOut: true });
  assert.ok(Date.now() - c0 < 300, "close is capped (ROLLBACK hangs here)");
  assert.equal(rep.timedOut, true);
  assert.equal(rep.rolledBack, false, "the ROLLBACK did not come back inside the cap");
  assert.equal(rep.destroyed, true);
  assert.deepEqual(pg.released, [true], "the connection is destroyed, not returned to the pool");
});

test("box: close waits out the statement timeout before it sends ROLLBACK", async () => {
  const pg = createFakePg({ hang: (t) => /slow/.test(t), serverTimeoutMs: 60 });
  const box = await open(pg, { statementTimeoutMs: 200, guardSlackMs: 400, closeCapMs: 100 });
  const read = box.read("SELECT slow").catch((e) => e);
  await new Promise((r) => setTimeout(r, 5));
  const t0 = Date.now();
  const rep = await box.close({ timedOut: true });
  const waited = Date.now() - t0;
  const err = await read;
  assert.equal(err.code, "57014", "the server cancelled the statement");
  assert.ok(waited >= 40, `close waited ${waited} ms for the statement`);
  const t = pg.texts();
  const failed = t.indexOf("SELECT slow");
  assert.ok(t.indexOf("ROLLBACK TO SAVEPOINT pr_1") > failed);
  assert.equal(t.at(-1), "ROLLBACK");
  assert.equal(rep.rolledBack, true);
  assert.deepEqual(pg.released, [true]);
});

test("box: close is idempotent and a read after close is refused as closed", async () => {
  const pg = createFakePg();
  const box = await open(pg);
  const first = await box.close();
  const second = await box.close();
  assert.deepEqual(first, second);
  assert.equal(pg.texts().filter((t) => t === "ROLLBACK").length, 1);
  await assert.rejects(() => box.read("SELECT 1"), (e) => e instanceof PulseRefused && e.kind === "closed");
  assert.ok(box.report().refused.some((r) => r.kind === "closed"));
});

test("box: a runaway beat cannot send unlimited statements", async () => {
  const pg = createFakePg();
  const box = await open(pg, { maxStatements: 12 });
  let refused = null;
  for (let i = 0; i < 20 && !refused; i++) {
    try { await box.read("SELECT 1"); } catch (e) { refused = e; }
  }
  assert.ok(refused instanceof PulseRefused && /too_many_statements/.test(refused.reason));
  assert.ok(DEFAULT_MAX_STATEMENTS >= 100);
  await box.close();
});

/* ---------------- dbSettings ---------------- */

test("readDbSettings: reports the three settings, and never throws", async () => {
  const good = await readDbSettings(async (sql) => {
    assert.equal(sql, DB_SETTINGS_SQL);
    return { rows: [{ transaction_read_only: "off", default_transaction_read_only: "off", in_recovery: false }] };
  });
  assert.deepEqual({ ...good, ms: 0 }, { ok: true, ms: 0, transaction_read_only: false, default_transaction_read_only: false, in_recovery: false });

  const stuck = await readDbSettings(async () => ({ rows: [{ transaction_read_only: "on", default_transaction_read_only: "off", in_recovery: false }] }));
  assert.equal(stuck.transaction_read_only, true, "a pooled connection stuck read-only is visible");

  const broken = await readDbSettings(async () => { throw new Error("connection refused"); });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /connection refused/);

  const slow = await readDbSettings(() => new Promise(() => {}), { capMs: 20 });
  assert.equal(slow.ok, false);
  assert.match(slow.error, /timed out/);

  assertReadOnlySql(DB_SETTINGS_SQL);
});

/* ---------------- checker findings, 2026-10-09: the lexer must read SQL the way Postgres does ---------------- */

const LONG_TAG = "a".repeat(90);

test("allow-list: a lone CR ends a -- comment (Postgres does), so what follows it is real SQL", () => {
  // The checker's string. Before the fix the scanner called everything after the \r a comment.
  refusedWith("SELECT 1 --x\r; COMMIT; SELECT 2", /more_than_one_statement/);
  refusedWith("SELECT 1 --x\r; DELETE FROM clients", /more_than_one_statement/);
  refusedWith("SELECT 1 --x\rDELETE FROM clients", /write_word_delete/);
  refusedWith("SELECT 1 -- note\r\n; COMMIT", /more_than_one_statement/);
  // PASS side: CR and CRLF line endings in a harmless query still read fine.
  for (const sql of ["SELECT 1 -- a note\r\n, 2 AS two", "SELECT 1 -- a note\r, 2 AS two", "SELECT 1\r\nFROM t -- x\r\nWHERE a = 1"]) {
    assert.equal(assertReadOnlySql(sql), sql);
  }
});

test("allow-list: a dollar-quote tag of ANY length is read as a string (Postgres has no 78-char cap)", () => {
  // The checker's string. Before the fix the scanner stopped reading the tag at 80 characters.
  refusedWith(`SELECT $${LONG_TAG}$ ' $${LONG_TAG}$ ; COMMIT ; SELECT 2 -- '\n`, /more_than_one_statement/);
  refusedWith(`SELECT $${"b".repeat(500)}$ x $${"b".repeat(500)}$ ; DELETE FROM clients`, /more_than_one_statement/);
  // PASS side: the same long tag around harmless text is one string, one statement.
  for (const sql of [`SELECT $${LONG_TAG}$ it's; delete from t; $${LONG_TAG}$ AS body`, `SELECT $${"c".repeat(300)}$$${"c".repeat(300)}$ AS empty_string`]) {
    assert.equal(assertReadOnlySql(sql), sql);
  }
  // A string that never closes is refused, whatever the tag length.
  refusedWith(`SELECT $${LONG_TAG}$ never closed`, /unterminated_dollar_quote/);
});

test("allow-list: a $ that is not a parameter, a name tail or a dollar quote is refused", () => {
  refusedWith("SELECT 1 $ ; COMMIT", /stray_dollar_sign/);
  refusedWith("SELECT $", /stray_dollar_sign/);
  refusedWith("SELECT $-1", /stray_dollar_sign/);
  // PASS side: parameters and names that hold a $ still pass.
  for (const sql of ["SELECT $1", "SELECT * FROM t WHERE a = $12", "SELECT a$b FROM t", "SELECT 1 AS x$"]) assert.equal(assertReadOnlySql(sql), sql);
  // A dollar quote that starts right where another one ended is a new string (as Postgres lexes it),
  // so what it holds stays hidden and a real ; after it still counts.
  refusedWith("SELECT $$a$$$$b$$ ; COMMIT", /more_than_one_statement/);
});

test("box: every user read goes out on the extended protocol; the box's own fixed statements do not", async () => {
  const pg = createFakePg({ answer: () => [{ n: 1 }] });
  const box = await openReadBox({ connect: async () => pg });
  await box.read("SELECT 1");
  await box.read("SELECT n FROM t WHERE id = $1", [7]);
  await box.close();
  const extended = pg.statements.filter((s) => s.mode === "extended");
  assert.deepEqual(extended.map((s) => s.text), ["SELECT 1", "SELECT n FROM t WHERE id = $1"]);
  assert.deepEqual(extended.map((s) => s.params), [[], [7]]);
  assert.ok(pg.statements.filter((s) => s.mode === "simple").length >= 6, "setup, savepoints, close check and ROLLBACK are simple");
});

test("box (FAIL side): if a multi-command string ever reached the wire, the extended protocol refuses it, runs none of it", async () => {
  // The fake models Postgres' rule. The real rule is proved on the real database in readbox.pg.test.mjs.
  const pg = createFakePg();
  await pg.query("BEGIN READ ONLY");
  await assert.rejects(() => pg.query({ text: "SELECT 1; COMMIT; SELECT 2", values: [], queryMode: "extended" }), (e) => e.code === "42601");
  assert.equal(pg.commits, 0, "the COMMIT inside the string did not run");
  assert.equal(pg.inTxn, true, "the transaction is still open");
  // Control: the simple protocol WOULD have run it. This is the hole the extended protocol closes.
  await pg.query("SELECT 1; COMMIT; SELECT 2");
  assert.equal(pg.commits, 1);
  assert.equal(pg.inTxn, false);
});

test("TX_ENDER: counts a COMMIT / END / ABORT at the start of ANY statement, not just the first word", () => {
  for (const t of ["COMMIT", "commit;", "SELECT 1; COMMIT", "SELECT 1 --x\r; COMMIT; SELECT 2", "SELECT 1;\n  END", "select 1 ;abort", "SELECT 1; PREPARE TRANSACTION 'x'"]) {
    assert.ok(TX_ENDER.test(t), t);
  }
  for (const t of ["SELECT CASE WHEN a THEN 1 END FROM t", "SELECT ended_at, committed_at FROM t", "SELECT 1"]) {
    assert.ok(!TX_ENDER.test(t), t);
  }
});

test("box: close asks 'still read-only?' before ROLLBACK and reports it (PASS side)", async () => {
  const pg = createFakePg({ answer: () => [{ n: 1 }] });
  const box = await openReadBox({ connect: async () => pg });
  await box.read("SELECT 1");
  const rep = await box.close();
  assert.equal(rep.readOnlyAtClose, true);
  assert.equal(rep.leaked, false);
  const texts = pg.texts();
  assert.equal(texts.at(-2), READ_ONLY_CHECK_SQL);
  assert.equal(texts.at(-1), "ROLLBACK");
  assert.equal(rep.rolledBack, true);
});

test("box: close reports a LEAK when the connection is no longer read-only (FAIL side)", async () => {
  // Someone ended the transaction behind the box's back (what a lexer hole plus COMMIT would do).
  const pg = createFakePg({ answer: () => [{ n: 1 }] });
  const box = await openReadBox({ connect: async () => pg });
  await box.read("SELECT 1");
  await pg.query("COMMIT");
  const rep = await box.close();
  assert.equal(rep.readOnlyAtClose, false);
  assert.equal(rep.leaked, true);
  assert.equal(rep.destroyed, true, "even a leaked connection is destroyed, not handed back");
});

test("box: a hung box skips the close check, and still ends cleanly", async () => {
  const pg = createFakePg({ hang: (t) => /slow/.test(t) });
  const box = await openReadBox({ connect: async () => pg, statementTimeoutMs: 20, guardSlackMs: 20, closeCapMs: 50 });
  await assert.rejects(() => box.read("SELECT slow"), /did not return/);
  const rep = await box.close({ timedOut: true });
  assert.equal(rep.readOnlyAtClose, null);
  assert.equal(rep.leaked, false);
  assert.equal(rep.destroyed, true);
  assert.ok(!pg.texts().includes(READ_ONLY_CHECK_SQL));
});
