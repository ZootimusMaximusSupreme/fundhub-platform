// The read box's SQL scanner, checked against the REAL Postgres lexer.
//
// *** THIS FILE SKIPS WITHOUT DATABASE_URL. A SKIPPED PG TEST IS NOT GREEN. ***
// It is READ ONLY by construction: one connection, BEGIN READ ONLY, every probe string goes out on the
// EXTENDED protocol (Postgres refuses more than one command per string BEFORE it runs any), each probe sits
// in its own savepoint, and the connection is rolled back and ended at the end. Every string in the corpus
// holds only SELECT and COMMIT, and the only way a COMMIT can run is as its own command, which the extended
// protocol refuses. It is safe to point at any database; it writes nothing.
//
// WHY IT EXISTS. The checker found two strings the scanner called "one SELECT" that Postgres ran as several
// commands (a lone \r in a -- comment, a 90-character dollar-quote tag). A fake pg that splits on ";" cannot
// show a lexer mismatch, so the claim "the scanner and Postgres agree" is only proved here.
//
// THE MEASURE. For a string S:
//   scannerOk(S) = assertReadOnlySql(S) does not throw
//   pgMulti(S)   = Postgres (extended protocol) says "cannot insert multiple commands into a prepared statement"
// The rule that keeps both walls honest:   scannerOk(S) implies NOT pgMulti(S).
// If the scanner ever says "one statement" about a string Postgres reads as several, this file fails.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { assertReadOnlySql, openReadBox } from "./readbox.mjs";

const SKIP = process.env.DATABASE_URL ? false : "no DATABASE_URL (a skipped pg test is not green)";
const require = createRequire(import.meta.url);

const LONG_TAG = "a".repeat(90);

function newClient() {
  const pg = require("pg");
  const url = process.env.DATABASE_URL;
  const local = /localhost|127\.0\.0\.1|\[::1\]/.test(url);
  const c = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  c.on("error", () => {});
  return c;
}

const scannerOk = (s) => { try { assertReadOnlySql(s); return true; } catch { return false; } };

/** Open one read-only connection and return { probe(sql) -> "multi" | "ok" | "other:<code>", end() }. */
async function openProbe() {
  const c = newClient();
  await c.connect();
  await c.query("BEGIN READ ONLY");
  await c.query("SET LOCAL statement_timeout = '5s'");
  let n = 0;
  return {
    async probe(sql) {
      const sp = `d_${++n}`;
      await c.query(`SAVEPOINT ${sp}`);
      let out = "ok";
      try {
        await c.query({ text: sql, values: [], queryMode: "extended" });
      } catch (err) {
        out = /multiple commands/i.test(String(err?.message)) ? "multi" : `other:${err?.code ?? "?"}`;
      }
      await c.query(`ROLLBACK TO SAVEPOINT ${sp}`);
      return out;
    },
    async readOnlyNow() { return (await c.query("SELECT current_setting('transaction_read_only') AS ro")).rows[0].ro; },
    async end() { try { await c.query("ROLLBACK"); } catch { /* gone */ } await c.end().catch(() => {}); }
  };
}

/* Strings Postgres reads as SEVERAL commands, every one dressed to look like a single SELECT to a naive reader. */
const MULTI = [
  "SELECT 1; COMMIT; SELECT 2",
  "SELECT 1 --x\r; COMMIT; SELECT 2",                                  // checker string 1: a lone CR ends the comment
  "SELECT 1 --x\r; SELECT 2",
  "SELECT 1 -- a note\r\n; SELECT 2",
  `SELECT $${LONG_TAG}$ ' $${LONG_TAG}$ ; COMMIT ; SELECT 2 -- '\n`,  // checker string 2: a 90-character tag
  `SELECT $${"b".repeat(500)}$ x $${"b".repeat(500)}$ ; SELECT 2`,
  "SELECT 'a' /* x */ ; SELECT 2",
  "SELECT 1 /* a /* nested */ still */ ; SELECT 2",
  "SELECT E'\\\\' ; SELECT 2",
  "SELECT $$a$$ ; SELECT 2",
  "SELECT 1;SELECT 2",
  "SELECT \"a;b\" FROM (SELECT 1 AS \"a;b\") t ; SELECT 2"
];

/* Strings that are ONE command with ; and words hidden inside strings, comments and names. */
const ONE = [
  "SELECT 1",
  "SELECT 1;",
  "SELECT 'x; COMMIT; SELECT 2' AS s",
  "SELECT 1 -- ; COMMIT\n",
  "SELECT 1 -- ; COMMIT\r\n",
  "SELECT 1 /* ; COMMIT */",
  "SELECT $$ ; COMMIT ; $$ AS s",
  `SELECT $${LONG_TAG}$ ; COMMIT ; $${LONG_TAG}$ AS s`,
  "SELECT E'\\'; COMMIT; --' AS s",
  "SELECT 'it''s; COMMIT' AS s",
  "SELECT 1 AS \"a;b\""
];

test("scanner vs real Postgres: the corpus of strings Postgres reads as several commands", { skip: SKIP }, async () => {
  const p = await openProbe();
  try {
    for (const s of MULTI) {
      const pg = await p.probe(s);
      assert.equal(pg, "multi", `Postgres should read this as several commands: ${JSON.stringify(s.slice(0, 70))} (got ${pg})`);
      assert.equal(scannerOk(s), false, `the scanner called a multi-command string "one statement": ${JSON.stringify(s.slice(0, 70))}`);
    }
    assert.equal(await p.readOnlyNow(), "on", "the probe connection is still read-only");
  } finally { await p.end(); }
});

test("scanner vs real Postgres: one-command strings are one command to both", { skip: SKIP }, async () => {
  const p = await openProbe();
  try {
    for (const s of ONE) {
      assert.equal(scannerOk(s), true, `the scanner refused a plain single SELECT: ${JSON.stringify(s.slice(0, 70))}`);
      const pg = await p.probe(s);
      assert.notEqual(pg, "multi", `Postgres read a single SELECT as several commands: ${JSON.stringify(s.slice(0, 70))}`);
    }
  } finally { await p.end(); }
});

/* A small seeded generator (mulberry32) so a failure replays. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES = [
  " ", "\n", "\r", "\r\n", "\t", "--", "-- c", "--c\r", "/*", "*/", "/* c */", "'", "''", "'a'", "\"", "\"a\"",
  "$$", "$a$", "$b$", `$${LONG_TAG}$`, `$${"c".repeat(79)}$`, `$${"c".repeat(80)}$`, "E'", "E'\\'", "\\", "$1", "$",
  ";", "; ", ";\n", "COMMIT", "END", "SELECT 2", "SELECT 'x'", "(", ")", ",", "AS z", "1", "a", "+"
];

test("scanner vs real Postgres: a seeded fuzz of lexer tricks never makes the scanner say 'one' when Postgres says 'several'", { skip: SKIP }, async () => {
  const p = await openProbe();
  const rand = rng(20261009);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const N = Number(process.env.PULSE_FUZZ_N) || 300;
  let accepted = 0, multi = 0, acceptedAndParsed = 0;
  const bad = [];
  try {
    for (let i = 0; i < N; i++) {
      const parts = ["SELECT 1"];
      const len = 1 + Math.floor(rand() * 7);
      for (let k = 0; k < len; k++) parts.push(pick(PIECES));
      if (rand() < 0.6) parts.push(pick(["; COMMIT; SELECT 2", ";COMMIT", "\n; END", "; SELECT 2"]));
      const s = parts.join(rand() < 0.5 ? "" : " ");
      const ok = scannerOk(s);
      const pg = await p.probe(s);
      if (ok) accepted++;
      if (pg === "multi") multi++;
      if (ok && pg === "ok") acceptedAndParsed++;
      if (ok && pg === "multi") bad.push(s);
    }
    assert.deepEqual(bad.map((s) => JSON.stringify(s)), [], "the scanner said one statement; Postgres said several");
    // The fuzz must actually exercise both sides, or it proves nothing.
    assert.ok(multi >= Math.floor(N * 0.03), `only ${multi} of ${N} fuzz strings were multi-command in Postgres; the generator is too weak`);
    assert.ok(accepted >= Math.floor(N * 0.1), `only ${accepted} of ${N} fuzz strings passed the scanner; the generator is too weak`);
    assert.equal(await p.readOnlyNow(), "on", "the probe connection is still read-only");
    console.log(`# fuzz: ${N} strings, scanner accepted ${accepted} (${acceptedAndParsed} also ran clean in Postgres), Postgres saw several commands in ${multi}`);
  } finally { await p.end(); }
});

test("box on a real connection: a lexer-trick string cannot end the READ ONLY transaction", { skip: SKIP }, async () => {
  const c = [];
  const box = await openReadBox({ connect: async () => { const cl = newClient(); await cl.connect(); c.push(cl); return cl; } });
  try {
    for (const s of ["SELECT 1 --x\r; COMMIT; SELECT 2", `SELECT $${LONG_TAG}$ ' $${LONG_TAG}$ ; COMMIT ; SELECT 2 -- '\n`]) {
      await assert.rejects(() => box.read(s), (e) => e.name === "PulseRefused");
    }
    const mode = await box.read("SHOW transaction_read_only");
    assert.equal(mode.rows[0].transaction_read_only, "on");
  } finally {
    const rep = await box.close();
    assert.equal(rep.leaked, false);
    assert.equal(rep.readOnlyAtClose, true);
    assert.equal(rep.commitsSent, 0);
    assert.equal(rep.rolledBack, true);
  }
});
