// The daily-pulse CLI's --db flag: real reads, one read-only transaction,
// rolled back, nothing sent. Fakes only — no database, no network, no text.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { main, openReadOnlyDb } from "./daily-pulse.mjs";

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
  const db = { query: async () => ({ rows: [] }) };
  const out = await main(["--db"], {
    openDb: async () => ({
      db,
      staffScope: async (fn) => { log.push("staff"); return fn(db); },
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
  // Four marketing-machine rows, then one coverage read of the marketing
  // heartbeats, then one close. The coverage runner does not send.
  assert.deepEqual(log, ["staff", "staff", "staff", "staff", "staff", "close"]);
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
