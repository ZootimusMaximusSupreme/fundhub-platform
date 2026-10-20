// Mutation guard for manifest-b27 rows 1-6. Each repaired row owns one exact direct proof.
// Removing that proof must put the same row back into the display lane with no contract.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compileDisplayRuntimeData } from "../compiler.mjs";
import { DISPLAY_PROOF_CASES } from "./display-proof-cases.mjs";
import { displaySavedResultContract, isTrackedDisplayControl } from "./display-saved-result.mjs";
import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const MAP_FILES = [
  "desks-a.json", "desks-b.json", "desks-c.json", "desks-d.json",
  "desks-e.json", "desks-f.json", "public-pages.json",
];
const TARGETS = Object.freeze([
  ["desks-a.json", "agent-editor.html", "Agent list row (click to open an agent, confirm discard of unsaved edits)"],
  ["desks-a.json", "client-control-panel.html", "Businesses cards: Save month/year button (stamp incorporation)"],
  ["desks-a.json", "client-control-panel.html", "Credit partner links: Open the partner's file, Record the partner's own consent"],
  ["desks-b.json", "documents.html", "Status filter select (not delivered, bounced, awaiting signature, signature expired)"],
  ["desks-b.json", "galaxy.html", "Rail pulses (six rails: Sales, Card Stacking, Optimization Rounds, Inquiry Removal, AR + Collections, Affiliates + Hiring) and hand-off threads"],
  ["desks-b.json", "galaxy.html", "Legend strip (size, brightness, pace colors)"],
]);

const sources = MAP_FILES.map((sourceFile) => ({
  sourceFile,
  rows: JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8")),
}));
const keyOf = (entry) => `${entry.sourceFile}\0${entry.surface}\0${entry.control}`;
const targetKeys = new Set(TARGETS.map(([sourceFile, surface, control]) => keyOf({ sourceFile, surface, control })));

function compile(proofCases) {
  return compileDisplayRuntimeData(sources, {
    proofCases,
    staffProofCases: [],
    contractFor: displaySavedResultContract,
    isTracked: isTrackedDisplayControl,
  });
}

test("display repair I attaches all six exact rows outside the not-proved lane", () => {
  const runtime = compile(DISPLAY_PROOF_CASES);
  const tracked = runtime.displayTrackingCases.filter((entry) => targetKeys.has(keyOf(entry)));
  assert.deepEqual(tracked, []);
});

test("mutation: removing any repair proof puts that exact row back as NOT_PROVED", () => {
  for (const [sourceFile, surface, control] of TARGETS) {
    const key = keyOf({ sourceFile, surface, control });
    const mutated = DISPLAY_PROOF_CASES.filter((entry) => keyOf(entry) !== key);
    assert.equal(mutated.length, DISPLAY_PROOF_CASES.length - 1, `${control}: exact proof exists`);
    const matches = compile(mutated).displayTrackingCases.filter((entry) => keyOf(entry) === key);
    assert.equal(matches.length, 1, `${control}: mutation returns one lane row`);
    assert.equal(matches[0].contract, null, `${control}: mutation returns it without a result contract`);
    assert.equal(judgeDisplayResult(matches[0]).status, "NOT_PROVED", `${control}: mutation is red`);
  }
});
