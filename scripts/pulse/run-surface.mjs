#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const file = path.join(ROOT, "src/pulse/catalog/generated.json");
const query = process.argv.slice(2).join(" ").trim();
if (!query) {
  console.error("usage: npm run pulse:surface -- <catalog id or exact surface>");
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.error("coverage catalog is missing; run node scripts/pulse/compile-catalog.mjs");
  process.exit(2);
}
const catalog = JSON.parse(fs.readFileSync(file, "utf8"));
const items = catalog.items.filter((item) => item.id === query || item.surface === query);
if (!items.length) {
  console.error(`No mapped surface matched "${query}".`);
  process.exit(2);
}

const unique = (values) => [...new Set(values.filter(Boolean))];
const tests = unique(items.flatMap((item) => item.proof.tests));
const lanes = unique(items.flatMap((item) => item.proof.lanes).map((name) => path.basename(name, ".mjs")));
const beats = unique(items.flatMap((item) => item.proof.beats).map((name) => path.basename(name, ".mjs").replace(/^beat-/, "")));
const unresolved = items.filter((item) => item.state === "red" || item.mode === "manual-red");

for (const item of items) console.log(`${item.state.toUpperCase()} ${item.id} ${item.surface} — ${item.reason}`);
function run(args) {
  const result = spawnSync(process.execPath, args, { cwd: ROOT, stdio: "inherit", env: process.env });
  return result.status === 0;
}
let ok = true;
if (tests.length) ok = run(["--test", ...tests]) && ok;
if (lanes.length) ok = run(["scripts/pulse/prove.mjs", "--repo", `--lanes=${lanes.join(",")}`]) && ok;
for (const beat of beats) ok = run(["scripts/pulse/run-beat.mjs", beat]) && ok;
if (!tests.length && !lanes.length && !beats.length && items.some((item) => item.proof.pings.length)) {
  ok = run(["scripts/pulse/prove.mjs", "--repo"]) && ok;
}
if (unresolved.length) {
  console.error(`${unresolved.length} matched row(s) still need executable proof. They remain red.`);
  ok = false;
}
process.exit(ok ? 0 : 1);
