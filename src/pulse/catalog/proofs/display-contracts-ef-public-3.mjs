import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TEST_FILE = "src/pulse/catalog/proofs/display-contracts-ef-public-3.test.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");

function mapped(sourceFile, surface, control, recipe) {
  const rows = JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8"));
  const matches = rows.filter((row) => row.surface === surface && row.control === control);
  if (matches.length !== 1) throw new Error(`expected one mapped row: ${sourceFile} / ${surface} / ${control}`);
  return Object.freeze({
    ...matches[0],
    sourceFile,
    surface,
    control,
    recipe,
    key: `${sourceFile}\0${surface}\0${control}`,
    depth: "e2e",
    evidence: TEST_FILE,
    tests: Object.freeze([TEST_FILE]),
  });
}

export const DISPLAY_CONTRACTS_EF_PUBLIC_3_PROOF_CASES = Object.freeze([
  mapped(
    "desks-f.json",
    "teleprompter.html (+ teleprompter.js, teleprompter-edits.js)",
    "Mirror off/on button (flips words left to right for a beam-splitter rig) and Turn 0/90/180/270",
    "teleprompter-mirror-turn",
  ),
]);

export const DISPLAY_CONTRACTS_EF_PUBLIC_3_ROW_KEYS = Object.freeze(
  DISPLAY_CONTRACTS_EF_PUBLIC_3_PROOF_CASES.map((entry) => entry.key),
);

export const DISPLAY_CONTRACTS_EF_PUBLIC_3_METADATA = Object.freeze({
  runner: "rendered Chromium with controlled local HTTP routes",
  sourceFiles: Object.freeze(["desks-e.json", "desks-f.json", "public-pages.json"]),
  testFile: TEST_FILE,
  provedCount: DISPLAY_CONTRACTS_EF_PUBLIC_3_PROOF_CASES.length,
});
