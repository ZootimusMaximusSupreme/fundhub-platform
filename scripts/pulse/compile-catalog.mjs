#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileCatalog, compileDisplayRuntimeData, compileHourlyUncoveredSurfaces } from "../../src/pulse/catalog/compiler.mjs";
import { TRIPWIRES } from "../../src/pulse/tripwires.mjs";
import { loadBeats } from "../../src/pulse/beats/index.mjs";
import { DISPLAY_PROOF_CASES } from "../../src/pulse/catalog/proofs/display-proof-cases.mjs";
import { STAFF_UI_PROOF_CASES } from "../../src/pulse/catalog/proofs/display-batch-staff-ui.mjs";
import { displaySavedResultContract, isTrackedDisplayControl } from "../../src/pulse/catalog/proofs/display-saved-result.mjs";
import { FIN_B16_LIVE_CASES } from "../../src/pulse/catalog/proofs/fin-b16-display-contracts.mjs";
import * as doors from "../../src/pulse/catalog/door-recipes.mjs";
import * as display from "../../src/pulse/catalog/display-recipes.mjs";
import * as data from "../../src/pulse/catalog/data-recipes.mjs";
import * as flow from "../../src/pulse/catalog/flow-recipes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const OUTPUT = path.join(ROOT, "src/pulse/catalog/generated.json");
const CHECK = process.argv.includes("--check");
const MIN_ROWS = 3974;
const MIN_UNIQUE = 3941;

function codeFiles(dir, prefix = "") {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    return entry.isDirectory() ? codeFiles(path.join(dir, entry.name), relative) : [relative];
  });
}

const indexed = ["src", "api", "netlify", "scripts", "e2e"].flatMap((dir) =>
  codeFiles(path.join(ROOT, dir), dir)
).filter((name) => name.endsWith(".mjs"));
const byBase = new Map();
for (const relative of indexed) {
  const base = path.basename(relative);
  if (!byBase.has(base)) byBase.set(base, []);
  byBase.get(base).push(relative);
}
const resolve = (reference) => {
  if (reference.includes("/")) return fs.existsSync(path.join(ROOT, reference)) ? [reference] : [];
  return byBase.get(reference) || [];
};

const files = fs.readdirSync(MAP_DIR).filter((name) => name.endsWith(".json")).sort();
const sources = files.map((sourceFile) => ({
  sourceFile,
  rows: JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8"))
}));
const catalog = compileCatalog(sources, [doors, display, data, flow], { resolve });
Object.assign(catalog, compileDisplayRuntimeData(sources, {
  proofCases: DISPLAY_PROOF_CASES, staffProofCases: [...STAFF_UI_PROOF_CASES, ...FIN_B16_LIVE_CASES],
  contractFor: displaySavedResultContract, isTracked: isTrackedDisplayControl
}));
catalog.hourlyUncoveredSurfaces = compileHourlyUncoveredSurfaces(TRIPWIRES, await loadBeats());

if (catalog.rows < MIN_ROWS || catalog.unique < MIN_UNIQUE) {
  throw new Error(`Coverage map shrank: ${catalog.rows} rows / ${catalog.unique} unique; expected at least ${MIN_ROWS} / ${MIN_UNIQUE}.`);
}
function renderCatalog(value) {
  const head = {
    version: value.version,
    rows: value.rows,
    repeats: value.repeats,
    unique: value.unique,
    counts: value.counts,
    displayResultCases: value.displayResultCases,
    displayTrackingCases: value.displayTrackingCases,
    hourlyUncoveredSurfaces: value.hourlyUncoveredSurfaces
  };
  const lines = Object.entries(head).map(([key, item]) => `  ${JSON.stringify(key)}: ${JSON.stringify(item)},`);
  return `{\n${lines.join("\n")}\n  "items": [\n${value.items.map((item) => `    ${JSON.stringify(item)}`).join(",\n")}\n  ]\n}\n`;
}

const body = renderCatalog(catalog);
if (CHECK) {
  const saved = fs.existsSync(OUTPUT) ? fs.readFileSync(OUTPUT, "utf8") : "";
  if (saved !== body) {
    console.error("Coverage catalog is stale. Run: node scripts/pulse/compile-catalog.mjs");
    process.exit(1);
  }
} else {
  fs.writeFileSync(OUTPUT, body);
}
console.log(`coverage catalog: ${catalog.rows} mapped, ${catalog.repeats} marked repeats, ${catalog.unique} unique; ${catalog.counts.wired} wired, ${catalog.counts.red} red`);
