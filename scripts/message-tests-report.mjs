#!/usr/bin/env node
// How the A/B message tests are doing, printed. READ ONLY.
//
//   node --env-file=.env scripts/message-tests-report.mjs
//   node scripts/message-tests-report.mjs --org <company uuid> --json
//
// The same report the Marketing page reads (GET /api/read/message-tests, built by
// src/messaging/experiment-report.mjs), run from a terminal. For each test: how many people got
// version A and version B, how many of each did the goal, and the plain-English verdict. It never
// switches a version, writes a row or sends a message.
//
// HOW IT STAYS READ ONLY. The one SELECT runs on a single connection inside BEGIN READ ONLY ... COMMIT,
// so the database itself refuses a write. There is no SET anywhere. DATABASE_URL names the database;
// the script does not load a .env file by itself.
//
// Board: ops/workflows/backend-selling-lanes-2026-10-30.md, section 6e.

import { pathToFileURL } from "node:url";
import { pool, close } from "../src/db.mjs";
import { experimentReport } from "../src/messaging/experiment-report.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};
const flag = (name) => process.argv.includes(`--${name}`);

const pct = (reached, people) => (people > 0 ? `${Math.round((100 * reached) / people)}%` : "-");

export function formatReport(tests, { orgId, now }) {
  const lines = [`MESSAGE TESTS — read only. Company ${orgId}. ${now.toISOString()}`];
  for (const t of tests) {
    const a = t.arms.A;
    const b = t.arms.B;
    lines.push(
      "",
      `${t.label}  [${t.name}]`,
      `  goal: ${t.goal} within ${t.window_days} days of the first message`,
      `  started: ${t.started_at ?? "not yet (no version B message has gone out)"}`
        + (t.earlier_people ? `   before it, not compared: ${t.earlier_people}` : ""),
      `  A: ${a.reached} of ${a.people} (${pct(a.reached, a.people)}), ${a.waiting} still inside their days`,
      `  B: ${b.reached} of ${b.people} (${pct(b.reached, b.people)}), ${b.waiting} still inside their days`,
      `  needs: ${t.min_per_arm ?? "?"} people on each side, and a gap that passes the 95% check, before a winner is named`,
      `  verdict: ${t.verdict.text}`
    );
  }
  lines.push("", "Nothing was written. Nothing was sent. No version was switched.");
  return lines.join("\n");
}

async function main() {
  const now = new Date();
  // src/db.mjs prints one "db: connecting to ..." line with console.log the first time it opens the pool.
  // It goes to stderr here, so what is on stdout is only the report (and --json stays valid JSON).
  const stdoutLog = console.log;
  console.log = (...args) => console.error(...args);
  let conn;
  try {
    conn = await pool().connect();
  } finally {
    console.log = stdoutLog;
  }
  try {
    await conn.query("BEGIN READ ONLY");
    const orgId = arg("org")
      || (await conn.query("SELECT id FROM orgs WHERE is_default LIMIT 1")).rows[0]?.id;
    if (!orgId) throw new Error("message-tests-report: no company found. Pass --org <uuid>.");
    const tests = await experimentReport(conn, { orgId, now });
    await conn.query("COMMIT");
    console.log(flag("json") ? JSON.stringify({ ok: true, as_of: now.toISOString(), tests }, null, 2) : formatReport(tests, { orgId, now }));
  } catch (err) {
    try { await conn.query("ROLLBACK"); } catch { /* the connection may already be gone */ }
    throw err;
  } finally {
    conn.release();
  }
}

// Run only when started from the command line, so a test can import formatReport.
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main()
    .catch((e) => { console.error(e); process.exitCode = 1; })
    .finally(() => close());
}
