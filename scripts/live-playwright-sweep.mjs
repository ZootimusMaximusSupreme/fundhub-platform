#!/usr/bin/env node
// Live Playwright sweep — fundhub.ai + apply.fundhub.ai desk tests.
// Runs on a machine with Chrome (Mac laptop). Records one agent_runs row for the morning pulse.
//
//   node scripts/live-playwright-sweep.mjs
//   node scripts/live-playwright-sweep.mjs --dry-run   # run tests, print score, no DB write

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  LIVE_PLAYWRIGHT_AGENT,
  scoreFromPlaywrightJson
} from "../src/pulse/live-playwright-check.mjs";
import { defaultOrgId } from "../src/pulse/daily-pulse.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const REPORT_PATH = path.join(
  ROOT,
  "docs/workflows/e2e-verify-run4-evidence/live-playwright-100/last-run.json"
);

function loadDotEnv() {
  const p = path.join(ROOT, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (k && process.env[k] == null) process.env[k] = v;
  }
}
loadDotEnv();

function collectFailedTitles(report) {
  const out = [];
  function walk(suite, prefix = "") {
    if (!suite) return;
    for (const spec of suite.specs || []) {
      const title = prefix ? `${prefix} › ${spec.title}` : spec.title;
      for (const test of spec.tests || []) {
        const bad = (test.results || []).some((r) => r.status !== "passed" && r.status !== "skipped");
        if (bad) out.push(`${title} › ${test.title}`);
      }
    }
    for (const child of suite.suites || []) {
      walk(child, prefix ? `${prefix} › ${child.title}` : child.title);
    }
  }
  for (const suite of report?.suites || []) walk(suite);
  return out;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  if (!process.env.STAFF_E2E_PASSWORD && !process.env.STAFF_INITIAL_PASSWORD) {
    console.error("STAFF_E2E_PASSWORD missing in .env — cannot log into live desks.");
    process.exit(1);
  }

  fs.mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  const run = spawnSync("npm", ["run", "test:e2e:live"], {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env
  });

  let report = null;
  if (fs.existsSync(REPORT_PATH)) {
    try {
      report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8"));
    } catch {
      report = null;
    }
  }
  const stats = scoreFromPlaywrightJson(report);
  const failedTitles = collectFailedTitles(report);
  const payload = {
    score: stats.score,
    passed: stats.passed,
    failed: stats.failed,
    total: stats.total,
    failedTitles,
    exitCode: run.status ?? 1,
    at: new Date().toISOString()
  };
  const outcome = run.status === 0 && stats.failed === 0 && stats.score === 100 ? "pass" : "fail";
  const summary = `live-playwright ${JSON.stringify(payload)}`;

  console.log(`\nLive Playwright: ${stats.score}/100 (${stats.passed}/${stats.total} passed, exit ${run.status})`);

  if (dryRun) {
    process.exit(outcome === "pass" ? 0 : 1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL missing — cannot record sweep (use --dry-run to skip DB).");
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
  const client = new pg.Client({
    connectionString,
    ssl: local ? undefined : { rejectUnauthorized: false }
  });
  await client.connect();
  try {
    const orgId = await defaultOrgId(client);
    if (!orgId) throw new Error("no default org");
    await client.query(
      `INSERT INTO agent_runs (org_id, agent_code, trigger_event, channel, mode, outcome, detail)
       VALUES ($1, $2, 'cli.live-playwright-sweep', 'internal', 'live', $3, $4)`,
      [orgId, LIVE_PLAYWRIGHT_AGENT, outcome, summary.slice(0, 2000)]
    );
    console.log("Recorded agent_runs row for morning pulse.");
  } finally {
    await client.end();
  }
  process.exit(outcome === "pass" ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
