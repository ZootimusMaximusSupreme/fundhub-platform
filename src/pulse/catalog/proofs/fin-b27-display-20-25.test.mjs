// Mutation guard for manifest-b27 rows 20-25. Each repaired row owns one exact direct proof.
// Removing that proof must put the same row back into the display lane with no contract.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { compileDisplayRuntimeData } from "../compiler.mjs";
import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";
import { DISPLAY_PROOF_CASES } from "./display-proof-cases.mjs";
import { displaySavedResultContract, isTrackedDisplayControl } from "./display-saved-result.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const MAP_FILES = [
  "desks-a.json", "desks-b.json", "desks-c.json", "desks-d.json",
  "desks-e.json", "desks-f.json", "public-pages.json",
];
const TARGETS = Object.freeze([
  ["desks-c.json", "money-banks.html", "Page gate: client reads own file; staff (owner, admin, sales_manager, closer) need ?client_id=; only staff see plan controls"],
  ["desks-c.json", "inquiry-remover.html", "Page gate: inquiry_specialist, owner, admin, funding_advisor roles; setter/closer-only roles bounced"],
  ["desks-c.json", "inquiry-remover.html", "'Show more' button under the case queue (25 rows a time)"],
  ["desks-c.json", "inquiry-remover.html", "Case row: click or Enter expands the case drawer (items, letter draft, identity packet, send options)"],
  ["desks-c.json", "inquiry-remover.html", "Work queue table: one row per disputed inquiry line (Client, Bureau, Actual, Expected, Call state, Hold, Attempts, Status)"],
  ["desks-c.json", "inquiry-remover.html", "Stat tiles: Still open, Worked, Calls, Confirmed (move by the server's counts after each write)"],
]);

const sources = MAP_FILES.map((sourceFile) => ({
  sourceFile,
  rows: JSON.parse(fs.readFileSync(path.join(MAP_DIR, sourceFile), "utf8")),
}));
const keyOf = (entry) => `${entry.sourceFile}\0${entry.surface}\0${entry.control}`;
const targetKeys = new Set(TARGETS.map(([sourceFile, surface, control]) => keyOf({ sourceFile, surface, control })));

function compile(proofCases, omittedContractControl = null) {
  return compileDisplayRuntimeData(sources, {
    proofCases,
    staffProofCases: [],
    contractFor: (row) => row.control === omittedContractControl ? null : displaySavedResultContract(row),
    isTracked: isTrackedDisplayControl,
  });
}

test("display rows 20-25 are attached and none are NOT_PROVED", () => {
  const runtime = compile(DISPLAY_PROOF_CASES);
  const tracked = runtime.displayTrackingCases.filter((entry) => targetKeys.has(keyOf(entry)));
  assert.deepEqual(tracked.map((entry) => [entry.control, judgeDisplayResult(entry).status]), [
    [TARGETS[4][2], "PASS"],
  ]);
});

test("mutation: removing any row 20-25 proof and result contract makes that exact row NOT_PROVED", () => {
  for (const [sourceFile, surface, control] of TARGETS) {
    const key = keyOf({ sourceFile, surface, control });
    const mutated = DISPLAY_PROOF_CASES.filter((entry) => keyOf(entry) !== key);
    assert.equal(mutated.length, DISPLAY_PROOF_CASES.length - 1, `${control}: exact proof exists`);
    const matches = compile(mutated, control).displayTrackingCases.filter((entry) => keyOf(entry) === key);
    assert.equal(matches.length, 1, `${control}: mutation returns one lane row`);
    assert.equal(matches[0].contract, null, `${control}: mutation returns it without a result contract`);
    assert.equal(judgeDisplayResult(matches[0]).status, "NOT_PROVED", `${control}: mutation is red`);
  }
});
