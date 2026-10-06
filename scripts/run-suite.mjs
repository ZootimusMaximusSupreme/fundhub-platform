#!/usr/bin/env node
// Test suite runner — isolates *.pg.test.mjs from each other.
//
// ═══════════════════════════════════════════════════════════════════════════
// ISOLATION CHOICE (document, do not quietly change)
//
// Picked: SERIALIZED EXECUTION of every *.pg.test.mjs file
//         (--test-concurrency=1), after unit tests run in parallel.
//
// Alternatives considered:
//
//   * Transactions / SAVEPOINT wrapping each file
//     Rejected. Most suites use the shared `db` pool, commit on every query,
//     and open their own connections for DISABLE TRIGGER. A file-level
//     transaction cannot wrap that without rewriting ~90 fixtures.
//
//   * Unique org scoping for every pg suite
//     Partial. Messaging suites that flip message_channel_routing now use
//     dedicated orgs (src/messaging/pg-test-fixture.mjs). Extending that to
//     every suite that touches the default org is correct long-term but is
//     a multi-day rewrite — not the fix for today's ~16 cross-file flakes.
//
//   * Serialize only when DATABASE_URL is set
//     Chosen. Without a database the *.pg.test.mjs files skip in milliseconds
//     and parallel is fine. With a database they mutate shared tables, so
//     files run one at a time.
//
// Unit tests (everything that is not *.pg.test.mjs) still run in parallel.
// ═══════════════════════════════════════════════════════════════════════════

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith(".test.mjs")) out.push(p);
  }
  return out;
}

const all = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "scripts"))];
const pg = all.filter((f) => f.endsWith(".pg.test.mjs")).sort();
const unit = all.filter((f) => !f.endsWith(".pg.test.mjs")).sort();

function run(label, files, concurrency) {
  if (!files.length) return 0;
  /* THE FLAG HAS TO COME BEFORE THE FILE LIST. node treats everything after the
     first positional as more positionals, so `--test a.mjs b.mjs
     --test-concurrency=1` silently ran the pg files IN PARALLEL — which is the
     one thing this file exists to prevent, and its header above explains why at
     length. Measured 2026-08-27 on identical databases built from zero:

       flag after the files  -> 10 failures
       flag before the files ->  0 failures

     Every "pre-existing pg failure" count this repo has ever recorded was taken
     with the flag in the wrong place, which is why CLAUDE.md section 12 says the
     number "has never been stable". It was not the environment moving. */
  const args = ["--test"];
  if (concurrency != null) args.push(`--test-concurrency=${concurrency}`);
  args.push(...files);
  process.stderr.write(`\n[run-suite] ${label}: ${files.length} files` +
    (concurrency != null ? ` (concurrency=${concurrency})` : "") + "\n");
  const r = spawnSync(process.execPath, args, { stdio: "inherit", cwd: ROOT });
  if (r.error) {
    console.error(r.error);
    return 1;
  }
  return r.status ?? 1;
}

/* BOTH HALVES ALWAYS RUN. A red unit test used to exit here before a single
   pg file ran, so in CI one stale unit test hid every database result behind
   it (measured 2026-10-05, GitHub run 37406614118: 23 unit failures, 0 pg
   files run). Run the unit half, run the pg half, then fail if either did. */
const unitCode = run("unit", unit, undefined);

// With a database: one pg file at a time. Without: parallel skip is cheap.
const pgConcurrency = process.env.DATABASE_URL ? 1 : undefined;
const pgCode = run("pg", pg, pgConcurrency);

process.stderr.write(`\n[run-suite] unit exit ${unitCode}, pg exit ${pgCode}\n`);
process.exit(unitCode !== 0 ? unitCode : pgCode);
