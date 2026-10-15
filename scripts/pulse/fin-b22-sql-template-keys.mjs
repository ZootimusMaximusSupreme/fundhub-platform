#!/usr/bin/env node
// Rebuild src/pulse/catalog/proofs/fin-b22-sql-template-keys.json from the SQL seed and migration files.
//   node scripts/pulse/fin-b22-sql-template-keys.mjs --write
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildSqlTemplateSnapshot, SNAPSHOT_FILE } from "../../src/pulse/catalog/proofs/fin-b22-sql-template-snapshot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const snapshot = buildSqlTemplateSnapshot(ROOT);
const text = `${JSON.stringify(snapshot, null, 1)}\n`;
if (process.argv.includes("--write")) {
  fs.writeFileSync(path.join(ROOT, SNAPSHOT_FILE), text);
  console.log(`wrote ${SNAPSHOT_FILE}: ${snapshot.keys.length} keys`);
} else {
  const saved = fs.existsSync(path.join(ROOT, SNAPSHOT_FILE)) ? fs.readFileSync(path.join(ROOT, SNAPSHOT_FILE), "utf8") : "";
  console.log(saved === text ? "fresh" : "STALE: run with --write");
  process.exitCode = saved === text ? 0 : 1;
}
