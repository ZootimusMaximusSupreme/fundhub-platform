// The pay-webhook beat's two queries, run against the REAL Postgres through the REAL read box.
//
// *** THIS FILE SKIPS WITHOUT DATABASE_URL. A SKIPPED PG TEST IS NOT GREEN. ***
// It is READ ONLY by construction: it opens the pulse read box (BEGIN READ ONLY, staff scope, ROLLBACK),
// and the only statements it sends are the beat's own SELECTs. It writes nothing, so it is safe to
// point at any database.
//
// WHY IT EXISTS. A fake database that answers any SQL with canned rows proves nothing about the SQL.
// So the inbox query is run twice:
//   1. as written, against the live commas_inbox (proves the columns, the types and the box accept it)
//   2. with commas_inbox swapped for a VALUES list of made-up rows, one row per rule (proves the rule:
//      which rows count as waiting, which as gave up, which are left out). Nothing is inserted; the
//      rows exist only inside the SELECT.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import { SWEEPER_SQL, INBOX_SQL, SWEEPER_JOB } from "./beat-pay-webhook.mjs";
import { openReadBox } from "./readbox.mjs";

const SKIP = process.env.DATABASE_URL ? false : "no DATABASE_URL (a skipped pg test is not green)";
const require = createRequire(import.meta.url);

async function openBox() {
  const pg = require("pg");
  const url = process.env.DATABASE_URL;
  const local = /localhost|127\.0\.0\.1|\[::1\]/.test(url);
  return openReadBox({
    connect: async () => {
      const c = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
      c.on("error", () => {});
      await c.connect();
      return c;
    }
  });
}

const ago = (interval) => `now() - interval '${interval}'`;
const NONE = "NULL::timestamptz";

/* [name, status, event_type, received_at, attempts, claimed_at, payment_id] */
const ROWS = [
  ["pending, 15 min old, paid", "pending", "payment.succeeded", ago("15 minutes"), 0, NONE, "'p1'"],
  ["pending, 5 min old (too new)", "pending", "payment.failed", ago("5 minutes"), 0, NONE, "'p2'"],
  ["failed with tries left, last tried 12 min ago", "failed", "payment.succeeded", ago("30 minutes"), 3, ago("12 minutes"), "'p3'"],
  ["failed with tries left, last tried 3 min ago (a live sweeper will retry)", "failed", "payment.succeeded", ago("30 minutes"), 3, ago("3 minutes"), "'p4'"],
  ["processing, claim 30 min old", "processing", "payment.succeeded", ago("40 minutes"), 2, ago("30 minutes"), "'p5'"],
  ["processing, claim 5 min old (being worked)", "processing", "payment.succeeded", ago("40 minutes"), 2, ago("5 minutes"), "'p6'"],
  ["gave up 2 h ago", "failed", "payment.succeeded", ago("5 hours"), 10, ago("2 hours"), "'p7'"],
  ["gave up 30 h ago (older than a day)", "failed", "payment.succeeded", ago("40 hours"), 10, ago("30 hours"), "'p8'"],
  ["stuck mid-pass at the limit", "processing", "payment.succeeded", ago("3 hours"), 10, ago("20 minutes"), "'p9'"],
  ["simulated receipt, pending", "pending", "payment.succeeded", ago("1 hour"), 0, NONE, "'sim-pay-123'"],
  ["done", "done", "payment.succeeded", ago("1 hour"), 1, ago("1 hour"), "'p11'"],
  ["simulated receipt, gave up", "failed", "payment.succeeded", ago("5 hours"), 10, ago("2 hours"), "'sim-pay-x'"],
  ["pending, no payment id, 1 h old", "pending", "payment.succeeded", ago("1 hour"), 0, NONE, "NULL::text"]
];

function withRows(rows) {
  const values = rows
    .map(([, status, type, received, attempts, claimed, pid]) =>
      `('${status}'::text, '${type}'::text, (${received})::timestamptz, ${attempts}::int, ${claimed}, ${pid}::text)`)
    .join(",\n");
  const sql = INBOX_SQL.replace("FROM commas_inbox ci", `FROM (VALUES\n${values}) AS ci(status, event_type, received_at, attempts, claimed_at, payment_id)`);
  assert.notEqual(sql, INBOX_SQL, "the table swap found the table");
  return sql;
}

test("pg: the sweeper query runs on the real job_heartbeats and returns a time and an outcome", { skip: SKIP }, async () => {
  const box = await openBox();
  try {
    const { rows } = await box.read(SWEEPER_SQL, [SWEEPER_JOB]);
    assert.equal(rows.length, 1);
    assert.ok("last_at" in rows[0] && "last_outcome" in rows[0]);
    const none = await box.read(SWEEPER_SQL, ["no-such-job-for-this-test"]);
    assert.equal(none.rows[0].last_at, null, "a job with no receipt gives a null time, which the beat reads as red");
  } finally {
    const report = await box.close();
    assert.equal(report.commitsSent, 0);
  }
});

test("pg: the inbox query, as written, runs on the real commas_inbox and returns one row of numbers", { skip: SKIP }, async () => {
  const box = await openBox();
  try {
    const { rows } = await box.read(INBOX_SQL);
    assert.equal(rows.length, 1);
    for (const col of ["waiting_n", "pending_n", "failed_n", "processing_n", "paid_n", "gave_up_n"]) {
      assert.equal(typeof rows[0][col], "number", col);
    }
    assert.ok("oldest_s" in rows[0]);
  } finally {
    const report = await box.close();
    assert.equal(report.commitsSent, 0);
    assert.equal(report.readOnlyAtClose, true);
  }
});

test("pg: the inbox rules, one made-up row per rule", { skip: SKIP }, async () => {
  const box = await openBox();
  try {
    const { rows } = await box.read(withRows(ROWS));
    const r = rows[0];
    // waiting: p1 (pending 15 min), p3 (failed, last try 12 min ago), p5 (processing, claim 30 min old),
    //          and the pending row with no payment id. The sim rows are left out.
    assert.deepEqual(
      { waiting: r.waiting_n, pending: r.pending_n, failed: r.failed_n, processing: r.processing_n, paid: r.paid_n },
      { waiting: 4, pending: 2, failed: 1, processing: 1, paid: 4 }
    );
    // gave up inside 24 h: p7 and p9. Not p8 (30 h), not the sim row.
    assert.equal(r.gave_up_n, 2);
    // the oldest waiting row is the no-payment-id pending row, 1 hour old
    assert.ok(r.oldest_s >= 3600 && r.oldest_s < 3700, `oldest_s ${r.oldest_s}`);
  } finally {
    await box.close();
  }
});

test("pg: with nothing wrong the same query reads all zeros and a null oldest", { skip: SKIP }, async () => {
  const box = await openBox();
  try {
    const clean = ROWS.filter(([name]) => /too new|3 min ago|5 min old \(being|done|30 h|simulated/.test(name));
    const { rows } = await box.read(withRows(clean));
    assert.deepEqual(
      [rows[0].waiting_n, rows[0].gave_up_n, rows[0].oldest_s],
      [0, 0, null]
    );
  } finally {
    await box.close();
  }
});
