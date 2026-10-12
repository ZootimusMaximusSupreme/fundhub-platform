#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { changedWiredItems, monitoredRedByFamily, proofPlan, redByFamily, splitTestTargets } from "../../src/pulse/catalog/proof-plan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CATALOG = path.join(ROOT, "src/pulse/catalog/generated.json");
const all = process.argv.includes("--all");
const reportOnly = process.argv.includes("--report");

function readJson(text, fallback = { items: [] }) {
  try { return JSON.parse(text); } catch { return fallback; }
}

function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", env: process.env });
  return result.status === 0;
}

function runBrowser(files) {
  const command = path.join(ROOT, "node_modules", ".bin", "playwright");
  const result = spawnSync(command, ["test", "--reporter=dot", ...files], { cwd: ROOT, stdio: "inherit", env: process.env });
  return result.status === 0;
}

if (!fs.existsSync(CATALOG)) {
  console.error("Catalog missing. Run npm run pulse:catalog first.");
  process.exit(2);
}

const catalog = readJson(fs.readFileSync(CATALOG, "utf8"));
const priorResult = spawnSync("git", ["show", "HEAD:src/pulse/catalog/generated.json"], {
  cwd: ROOT,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
const prior = priorResult.status === 0 ? readJson(priorResult.stdout) : { items: [] };
const selected = all
  ? catalog.items.filter((item) => item.state === "wired")
  : changedWiredItems(catalog, prior);
const plan = proofPlan(selected);
const testTargets = splitTestTargets(plan.tests);

console.log(`catalog proof: ${plan.rows} ${all ? "wired" : "changed"} row(s); ${testTargets.node.length} Node test file(s), ${testTargets.browser.length} browser spec(s), ${plan.lanes.length} lane(s), ${plan.beats.length} beat(s)`);
console.log(`catalog red: ${catalog.counts?.red || 0} — ${redByFamily(catalog).map(([family, count]) => `${family} ${count}`).join(", ")}`);
const monitoredRed = monitoredRedByFamily(catalog);
console.log(`catalog monitored red: ${monitoredRed.reduce((sum, [, count]) => sum + count, 0)} — ${monitoredRed.map(([family, count]) => `${family} ${count}`).join(", ")}`);

if (reportOnly || plan.rows === 0) process.exit(0);

let ok = true;
if (testTargets.node.length) {
  const envFile = fs.existsSync(path.join(ROOT, ".env")) ? ["--env-file=.env"] : [];
  ok = run([...envFile, "--test", "--test-force-exit", "--test-reporter=dot", ...testTargets.node]) && ok;
}
if (ok && testTargets.browser.length) ok = runBrowser(testTargets.browser);
if (ok && plan.lanes.length) {
  const names = plan.lanes.map((file) => path.basename(file, ".mjs"));
  ok = run(["scripts/pulse/prove.mjs", "--repo", `--lanes=${names.join(",")}`]) && ok;
}
for (const file of ok ? plan.beats : []) {
  const name = path.basename(file, ".mjs").replace(/^beat-/, "");
  ok = run(["scripts/pulse/run-beat.mjs", name]) && ok;
}

process.exit(ok ? 0 : 1);
