#!/usr/bin/env node
// node marketing/broll/scripts/catalog.mjs [--check]
//
// Writes marketing/broll/catalog.json: the animation templates the script
// writer may use (spec §7.3). All the logic lives in src/marketing/catalog.mjs,
// where its tests run (npm test only looks under src/ and scripts/). This file
// only reads the kit, calls it and writes the result.
//
// Run it again whenever a template's props, length or registration changes.
// src/marketing/catalog.test.mjs fails when the committed file is stale.
//
// --check  write nothing; exit 1 when catalog.json is out of date.
//
// It reads the kit's source text and never runs it, so it needs no packages
// beyond Node. If a value cannot be read that way it stops with the file and
// line, and writes nothing.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCatalogReport, serializeCatalog, readKitSources, CatalogReadError
} from "../../../src/marketing/catalog.mjs";

const KIT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(KIT_DIR, "catalog.json");
const check = process.argv.includes("--check");

let report;
try {
  report = buildCatalogReport(readKitSources(KIT_DIR));
} catch (e) {
  if (e instanceof CatalogReadError) {
    console.error(`STOP: the catalog could not be read from the kit's source.\n  ${e.message}\nNothing was written.`);
    process.exit(1);
  }
  throw e;
}

const text = serializeCatalog(report.catalog);
let current = null;
try { current = readFileSync(OUT, "utf8"); } catch { /* first run */ }

if (check) {
  if (current === text) {
    console.log(`catalog.json is up to date (${report.catalog.length} templates).`);
    process.exit(0);
  }
  console.error("catalog.json is out of date. Run: node marketing/broll/scripts/catalog.mjs");
  process.exit(1);
}

if (current !== text) writeFileSync(OUT, text);
console.log(`${current === text ? "Unchanged" : "Wrote"} marketing/broll/catalog.json: ${report.catalog.length} templates.`);
console.log(`Skipped (kit tools, not ad clips): ${report.skipped.join(", ") || "none"}.`);
console.log(`Data-tied (take no props): ${report.catalog.filter((e) => e.data_tied).map((e) => e.id).join(", ") || "none"}.`);
if (report.nullPurpose.length) {
  console.log(`No purpose in the code comments, left null: ${report.nullPurpose.join(", ")}.`);
}
