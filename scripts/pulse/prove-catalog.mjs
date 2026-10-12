#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { changedWiredItems, proofPlan, redByFamily } from "../../src/pulse/catalog/proof-plan.mjs";

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

console.log(`catalog proof: ${plan.rows} ${all ? "wired" : "changed"} row(s); ${plan.tests.length} test file(s), ${plan.lanes.length} lane(s), ${plan.beats.length} beat(s)`);
console.log(`catalog red: ${catalog.counts?.red || 0} — ${redByFamily(catalog).map(([family, count]) => `${family} ${count}`).join(", ")}`);

if (reportOnly || plan.rows === 0) process.exit(0);

let ok = true;
if (plan.tests.length) {
  const envFile = fs.existsSync(path.join(ROOT, ".env")) ? ["--env-file=.env"] : [];
  ok = run([...envFile, "--test", ...plan.tests]) && ok;
}
if (plan.lanes.length) {
  const names = plan.lanes.map((file) => path.basename(file, ".mjs"));
  ok = run(["scripts/pulse/prove.mjs", "--repo", `--lanes=${names.join(",")}`]) && ok;
}
for (const file of plan.beats) {
  const name = path.basename(file, ".mjs").replace(/^beat-/, "");
  ok = run(["scripts/pulse/run-beat.mjs", name]) && ok;
}

process.exit(ok ? 0 : 1);
