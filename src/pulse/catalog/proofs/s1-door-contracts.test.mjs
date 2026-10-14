// Guard for the slice 1 route proofs. The handler tests prove the results. This
// file proves the BINDING: every attached row is one exact row of the coverage
// map, its handler is routed, each named test file is a plain runnable test
// that really contains the named test titles, and the row has left the red lane.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { ROUTE_GAP_ROWS } from "../../../pulse/coverage/gap-door-batch-routes.mjs";
import { proofForDoor } from "./door-proof.mjs";
import { routeKeyForDoor } from "./door-batch-route-result.mjs";
import {
  S1_DOOR_CONTRACTS,
  S1_DOOR_GUARD_TEST,
  s1DoorContractsProof,
} from "./s1-door-contracts.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const MAP = new URL("ops/workflows/coverage-every-surface-2026-10-10/", ROOT);
const maps = new Map();

function rowsOf(sourceFile) {
  if (!maps.has(sourceFile)) maps.set(sourceFile, JSON.parse(fs.readFileSync(new URL(sourceFile, MAP), "utf8")));
  return maps.get(sourceFile);
}

test("slice 1 binds 39 exact money route rows, each once", () => {
  assert.equal(S1_DOOR_CONTRACTS.length, 39);
  assert.equal(new Set(S1_DOOR_CONTRACTS.map((entry) => entry.key)).size, 39);
});

test("every bound row is one exact money row of the coverage map, and its handler is routed", () => {
  for (const entry of S1_DOOR_CONTRACTS) {
    const matches = rowsOf(entry.sourceFile).filter((row) => row.surface === entry.surface && row.control === entry.control);
    assert.equal(matches.length, 1, entry.key);
    assert.equal(matches[0].impact, "money", entry.key);
    const route = routeKeyForDoor(matches[0]);
    assert.equal(typeof ROUTES[route], "function", `${route} is not in the routing table`);
  }
});

test("every named test is a plain runnable file and contains each named test title", () => {
  for (const entry of S1_DOOR_CONTRACTS) {
    assert.ok(entry.tests.length > 0, entry.key);
    for (const file of entry.tests) {
      assert.match(file, /\.test\.mjs$/, file);
      assert.doesNotMatch(file, /\.pg\.test\.mjs$/, `${file} needs a real database and is skipped without one`);
      assert.notEqual(file, S1_DOOR_GUARD_TEST);
      assert.ok(fs.existsSync(new URL(file, ROOT)), `${file} does not exist`);
    }
    const text = entry.tests.map((file) => fs.readFileSync(new URL(file, ROOT), "utf8")).join("\n");
    assert.ok(entry.titles.length > 0, `${entry.key} names no test title`);
    for (const title of entry.titles) {
      assert.ok(text.includes(title), `no test titled "${title}" in ${entry.tests.join(", ")}`);
    }
  }
});

test("the door recipe uses these proofs at deep depth and the rows have left the red route lane", () => {
  const redIds = new Set(ROUTE_GAP_ROWS.map((row) => `${row.sourceFile}\0${row.surface}\0${row.control}`));
  for (const entry of S1_DOOR_CONTRACTS) {
    const row = { surface: entry.surface, control: entry.control };
    const proof = proofForDoor(entry.sourceFile, row);
    assert.equal(proof.depth, "deep", entry.key);
    assert.equal(proof.verdict, undefined, entry.key);
    assert.equal(proof.asserts, entry.control);
    assert.ok(proof.evidence.includes(S1_DOOR_GUARD_TEST));
    for (const file of entry.tests) assert.ok(proof.evidence.includes(file), `${entry.key} lost ${file}`);
    assert.equal(redIds.has(`${entry.sourceFile}\0${entry.surface}\0${entry.control}`), false, `${entry.key} is still red`);
  }
});

test("a same-route row with a different result stays unproved", () => {
  const entry = S1_DOOR_CONTRACTS[0];
  assert.equal(s1DoorContractsProof(entry.sourceFile, { surface: entry.surface, control: `${entry.control} changed` }), null);
  assert.equal(s1DoorContractsProof("routes-3.json", { surface: entry.surface, control: entry.control }), null);
});

test("closer-deck send_ebook stays not proved: the handler refuses that action", () => {
  const row = ROUTE_GAP_ROWS.find((candidate) => candidate.surface === "route:closer-deck" && /send_ebook/.test(candidate.control));
  assert.ok(row, "the send_ebook row left the red lane without a result that proves it");
  assert.equal(s1DoorContractsProof(row.sourceFile, row), null);
});
