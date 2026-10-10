// The daily-pulse CLI's --db flag: real reads, one read-only transaction,
// rolled back, nothing sent. Fakes only — no database, no network, no text.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { main, openReadOnlyDb } from "./daily-pulse.mjs";
import {
  META_SYNC_SQL, CF_NIGHT_SQL, CAPI_SQL, DYING_SCAN_SQL, RUNNING_ADS_SQL, MEET_SYNC_SQL
} from "../src/pulse/machine.mjs";
import { BEATS_SQL, MACHINE_ORG_COUNT_SQL } from "../src/pulse/coverage/slice-03-marketing.mjs";
import { RUN_RECORDER_SQL } from "../src/pulse/self-audit.mjs";

/* Statements that may run on BOTH connections, on purpose. Keep this list to
   reads of a table that is NOT row-secured, where the plain app connection sees
   the same rows the staff scope does. Today that is one statement: the lookup
   of the default company. Several lanes run it on whichever handle they hold. */
const MAY_RUN_ON_BOTH = new Set([
  "SELECT id FROM orgs WHERE is_default LIMIT 1"
]);

/* One statement, one spelling: whitespace squashed, so a re-indented copy of
   the same SQL is still the same statement. */
const squash = (sql) => String(sql).replace(/\s+/g, " ").trim();

function tmpRelayDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-cli-relay-"));
  return { root, gates: path.join(root, "gates"), decisions: path.join(root, "decisions"), outbox: path.join(root, "outbox") };
}

const fetchImpl = async (url) => {
  const p = String(url).replace(/^https?:\/\/[^/]+/, "");
  if (p === "/login.html") return { status: 200, text: async () => "Sign in password" };
  if (p === "/app/client-control-panel.html") {
    return { status: 200, text: async () => "Generate Apps Apply door Apply shows the client email, not a Fundhub address" };
  }
  return { status: 200, text: async () => "{}" };
};

test("--db with --live is refused before anything opens", async () => {
  let opened = false;
  await assert.rejects(
    () => main(["--db", "--live"], { openDb: async () => { opened = true; } }),
    /read-only dry run/
  );
  assert.equal(opened, false);
});

test("--db hands the pulse a db and a staff scope, sends nothing, and always closes", async () => {
  const board = fs.mkdtempSync(path.join(os.tmpdir(), "pulse-cli-board-"));
  const sends = [];
  const log = [];
  // Two recorders, so the test can see WHICH connection ran each statement:
  // the plain app connection, or the staff scope.
  const plainSql = [];
  const staffSql = [];
  const db = { query: async (sql) => { plainSql.push(sql); return { rows: [] }; } };
  const staffTx = { query: async (sql) => { staffSql.push(sql); return { rows: [] }; } };
  const out = await main(["--db"], {
    openDb: async () => ({
      db,
      staffScope: async (fn) => { log.push("staff"); return fn(staffTx); },
      close: async () => { log.push("close"); }
    }),
    dirs: tmpRelayDirs(),
    boardDir: board,
    env: { PULSE_SMS_TO: "+15555550100" },
    fetchImpl,
    sendSms: async (m) => { sends.push(m); return { status: "sent" }; },
    sendWhatsApp: async (m) => { sends.push(m); return { status: "sent" }; }
  });
  assert.equal(out.dryRun, true);
  assert.equal(sends.length, 0);
  assert.equal(out.sms.reason, "dry_run");
  // Always closes: exactly once, and last, with only staff scopes before it.
  assert.equal(log.filter((e) => e === "close").length, 1);
  assert.equal(log.at(-1), "close");
  assert.ok(log.slice(0, -1).every((e) => e === "staff"));
  // The number of staff scopes is NOT pinned here. This test used to say
  // ["staff" x 5, "close"] and was bumped by hand each time the pulse grew a
  // lane: 4 machine rows (33d7840c3), then the marketing heartbeat read
  // (8cf8518a1; the count went to 5 in fa3de5618), a 5th machine row
  // (48b47054e), the gap lanes for ads, banks, social, the marketing queue and
  // pixels (f2f0e2171), handoff and leads (803b2fe59) and the self-audit
  // (5bc27733e): 27 today. Every new lane adds a staff-scoped read on purpose
  // (CLAUDE.md "Heartbeat on every build"), so a pinned count goes red on every
  // build and proves nothing.
  //
  // What the count stood in for is this: the marketing-machine tables are FORCE
  // row security and read EMPTY on the plain app connection, so each of those
  // reads must go through the staff scope and none through the plain db. A
  // machine row that quietly fell back to the plain db would read zero rows and
  // look like "the job never ran".
  const machineAndMarketingSql = {
    META_SYNC_SQL, CF_NIGHT_SQL, CAPI_SQL, DYING_SCAN_SQL, RUNNING_ADS_SQL, MEET_SYNC_SQL,
    BEATS_SQL, MACHINE_ORG_COUNT_SQL, RUN_RECORDER_SQL
  };
  for (const [name, sql] of Object.entries(machineAndMarketingSql)) {
    assert.ok(staffSql.includes(sql), `${name} never ran through the staff scope`);
    assert.ok(!plainSql.includes(sql), `${name} ran on the plain app connection, where it reads empty`);
  }
  // The named list above only covers the statements it names. This is the
  // rule that covers the rest: the same SQL text must never run on BOTH the
  // plain connection and the staff scope. The pulse reads each lane's rows
  // once through the staff scope; when a second read of the same text (a
  // "nothing to judge" re-check, a self-audit read) falls back to the plain
  // connection, a row-secured table reads empty there and the re-check agrees
  // "nothing to judge" for the wrong reason, a false green. Only the reads on
  // MAY_RUN_ON_BOTH are exempt. The reads are not listed here by name on
  // purpose: a new lane adds its own and this rule covers it with no edit.
  //
  // Limit, said plainly: the fake db answers every read with no rows, so this
  // sees only the statements that run in that case. A re-check that reuses a
  // lane's own SQL is caught here. A re-check written with brand-new SQL that
  // falls back to the plain connection is caught only if it is named above.
  const plainSet = new Set(plainSql.map(squash));
  const onBoth = [...new Set(staffSql.map(squash))]
    .filter((sql) => plainSet.has(sql) && !MAY_RUN_ON_BOTH.has(sql));
  assert.equal(
    onBoth.length,
    0,
    `${onBoth.length} statement(s) ran on BOTH the plain connection and the staff scope. The plain run reads empty on a row-secured table, so send every run through the staff scope. The statements (first 160 characters):\n${onBoth.map((sql) => `  ${sql.slice(0, 160)}`).join("\n")}`
  );
  assert.ok(out.checks.some((c) => c.id === "meta-sync" && c.status !== "skip"));
  fs.rmSync(board, { recursive: true, force: true });
});

test("openReadOnlyDb: BEGIN READ ONLY, staff only inside the scope, ROLLBACK, never a bare SET", async () => {
  const sql = [];
  class FakeClient {
    constructor(opts) { this.opts = opts; }
    async connect() { sql.push("connect"); }
    async query(text) { sql.push(text); return { rows: [] }; }
    async end() { sql.push("end"); }
  }
  const ro = await openReadOnlyDb({ connectionString: "postgres://u:p@db.example:6543/postgres", Client: FakeClient });
  await ro.db.query("SELECT 1");
  await ro.staffScope((tx) => tx.query("SELECT 2"));
  await ro.close();
  assert.deepEqual(sql, [
    "connect",
    "BEGIN READ ONLY",
    "SELECT 1",
    "SELECT set_config('fundhub.actor', 'staff', true)",
    "SELECT 2",
    "SELECT set_config('fundhub.actor', '', true)",
    "ROLLBACK",
    "end"
  ]);
  assert.ok(sql.every((s) => !/^\s*SET\b/i.test(s)), "a bare SET through the pooler is banned");
});

test("openReadOnlyDb refuses to run without DATABASE_URL", async () => {
  await assert.rejects(() => openReadOnlyDb({ connectionString: "" }), /needs DATABASE_URL/);
});
