// Guard for the batch 24 route proofs. The handler tests prove the results. This
// file proves the BINDING: every attached row is one exact row of the coverage
// map, its handler is routed, each named test file is a plain runnable test that
// really contains the named test titles, and the row has left the red lane.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { ROUTE_GAP_ROWS } from "../../../pulse/coverage/gap-door-batch-routes.mjs";
import { proofForDoor } from "./door-proof.mjs";
import { routeKeyForDoor } from "./door-batch-route-result.mjs";
import {
  FIN_B24_DOOR_CONTRACTS,
  FIN_B24_GUARD_TEST,
  finB24DoorProof,
} from "./fin-b24-door-contracts.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const MAP = new URL("ops/workflows/coverage-every-surface-2026-10-10/", ROOT);
const maps = new Map();

function rowsOf(sourceFile) {
  if (!maps.has(sourceFile)) maps.set(sourceFile, JSON.parse(fs.readFileSync(new URL(sourceFile, MAP), "utf8")));
  return maps.get(sourceFile);
}

test("batch 24 binds 39 exact staff route rows, each once", () => {
  assert.equal(FIN_B24_DOOR_CONTRACTS.length, 39);
  assert.equal(new Set(FIN_B24_DOOR_CONTRACTS.map((entry) => entry.key)).size, 39);
});

test("every bound row is one exact row of the coverage map, a staff or no-impact route, and its handler is routed", () => {
  for (const entry of FIN_B24_DOOR_CONTRACTS) {
    const matches = rowsOf(entry.sourceFile).filter((row) => row.surface === entry.surface && row.control === entry.control);
    assert.equal(matches.length, 1, entry.key);
    assert.ok(["staffOnly", "none"].includes(matches[0].impact), `${entry.key} is a ${matches[0].impact} row`);
    const route = routeKeyForDoor(matches[0]);
    assert.equal(typeof ROUTES[route], "function", `${route} is not in the routing table`);
  }
});

test("every named test is a plain runnable file and contains each named test title", () => {
  for (const entry of FIN_B24_DOOR_CONTRACTS) {
    assert.ok(entry.tests.length > 0, entry.key);
    for (const file of entry.tests) {
      assert.match(file, /\.test\.mjs$/, file);
      assert.doesNotMatch(file, /\.pg\.test\.mjs$/, `${file} needs a real database and is skipped without one`);
      assert.notEqual(file, FIN_B24_GUARD_TEST);
      assert.ok(fs.existsSync(new URL(file, ROOT)), `${file} does not exist`);
    }
    const text = entry.tests.map((file) => fs.readFileSync(new URL(file, ROOT), "utf8")).join("\n");
    assert.ok(entry.titles.length > 0, `${entry.key} names no test title`);
    for (const title of entry.titles) {
      assert.ok(text.includes(JSON.stringify(title).slice(1, -1)) || text.includes(title), `no test titled "${title}" in ${entry.tests.join(", ")}`);
    }
  }
});

test("the door recipe uses these proofs and the rows have left the red route lane", () => {
  const redIds = new Set(ROUTE_GAP_ROWS.map((row) => `${row.sourceFile}\0${row.surface}\0${row.control}`));
  for (const entry of FIN_B24_DOOR_CONTRACTS) {
    const row = { surface: entry.surface, control: entry.control };
    const proof = proofForDoor(entry.sourceFile, row);
    assert.equal(proof.depth, "e2e", entry.key);
    assert.equal(proof.verdict, undefined, entry.key);
    assert.equal(proof.asserts, entry.control);
    assert.ok(proof.evidence.includes(FIN_B24_GUARD_TEST));
    for (const file of entry.tests) assert.ok(proof.evidence.includes(file), `${entry.key} lost ${file}`);
    assert.equal(redIds.has(`${entry.sourceFile}\0${entry.surface}\0${entry.control}`), false, `${entry.key} is still red`);
  }
});

test("a same-route row with a different result stays unproved", () => {
  const entry = FIN_B24_DOOR_CONTRACTS[0];
  assert.equal(finB24DoorProof(entry.sourceFile, { surface: entry.surface, control: `${entry.control} changed` }), null);
  assert.equal(finB24DoorProof("routes-3.json", { surface: entry.surface, control: entry.control }), null);
});

test("climate/geocode stays not proved: its row names a county and the door never returns one", () => {
  const row = ROUTE_GAP_ROWS.find((candidate) => candidate.surface === "route:climate/geocode");
  assert.ok(row, "the geocode row left the red lane without a result that proves it");
  assert.match(row.control, /state \/ county/);
  assert.equal(finB24DoorProof(row.sourceFile, row), null);
});

test("the hiring/apply rows are three different rows with the right test for each verb", () => {
  const apply = FIN_B24_DOOR_CONTRACTS.filter((entry) => entry.surface.startsWith("route:hiring/apply"));
  assert.equal(apply.length, 3);
  const get = apply.find((entry) => /^GET open roles/.test(entry.control));
  assert.ok(get);
  assert.ok(get.titles.every((title) => title.startsWith("hiring/apply GET ")));
  for (const entry of apply.filter((e) => e !== get)) {
    assert.ok(entry.titles.every((title) => title.startsWith("hiring/apply POST ")), entry.key);
  }
});
