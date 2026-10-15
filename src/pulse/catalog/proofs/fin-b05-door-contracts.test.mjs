// Guard for the batch 05 route proofs. The handler test proves the result. This
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
  FIN_B05_DOOR_CONTRACTS,
  FIN_B05_GUARD_TEST,
  finB05DoorProof,
} from "./fin-b05-door-contracts.mjs";
import { inspectNamedTests } from "./fin-b05-test-binding.mjs";

const ROOT = new URL("../../../../", import.meta.url);
const MAP = new URL("ops/workflows/coverage-every-surface-2026-10-10/", ROOT);
const maps = new Map();

function rowsOf(sourceFile) {
  if (!maps.has(sourceFile)) maps.set(sourceFile, JSON.parse(fs.readFileSync(new URL(sourceFile, MAP), "utf8")));
  return maps.get(sourceFile);
}

test("batch 05 binds one exact customer-message route row", () => {
  assert.equal(FIN_B05_DOOR_CONTRACTS.length, 1);
  assert.equal(new Set(FIN_B05_DOOR_CONTRACTS.map((entry) => entry.key)).size, 1);
});

test("every bound row is one exact row of the coverage map, and its handler is routed", () => {
  for (const entry of FIN_B05_DOOR_CONTRACTS) {
    const matches = rowsOf(entry.sourceFile).filter((row) => row.surface === entry.surface && row.control === entry.control);
    assert.equal(matches.length, 1, entry.key);
    assert.equal(matches[0].impact, "customerMessage", entry.key);
    const route = routeKeyForDoor(matches[0]);
    assert.equal(typeof ROUTES[route], "function", `${route} is not in the routing table`);
  }
});

test("every named test is a plain runnable file and every named test title is a LIVE test in it", () => {
  for (const entry of FIN_B05_DOOR_CONTRACTS) {
    assert.ok(entry.tests.length > 0, entry.key);
    for (const file of entry.tests) {
      assert.match(file, /\.test\.mjs$/, file);
      assert.doesNotMatch(file, /\.pg\.test\.mjs$/, `${file} needs a real database and is skipped without one`);
      assert.notEqual(file, FIN_B05_GUARD_TEST);
      assert.ok(fs.existsSync(new URL(file, ROOT)), `${file} does not exist`);
    }
    assert.ok(entry.titles.length > 0, `${entry.key} names no test title`);
    // The source is READ, not searched: a title left in a comment or a string, a
    // test.skip / test.todo / { skip: true }, a test nested under a condition and a
    // test that asserts nothing all fail here. Node exits 0 on every one of them.
    const reports = entry.tests.map((file) => ({
      file,
      report: inspectNamedTests(fs.readFileSync(new URL(file, ROOT), "utf8"), entry.titles),
    }));
    for (const { file, report } of reports) {
      assert.deepEqual(report.markers, [], `${file} switches a test off or ends the run early: ${report.markers.join(", ")}`);
    }
    for (const title of entry.titles) {
      const found = reports.filter(({ report }) => !report.missing.includes(title));
      assert.ok(found.length > 0, `no live test titled "${title}" in ${entry.tests.join(", ")}`);
      for (const { file, report } of found) {
        assert.equal(report.hollow.includes(title), false, `the test "${title}" in ${file} asserts nothing`);
      }
    }
  }
});

test("the named titles are every test the handler file runs, and each is named once", () => {
  for (const entry of FIN_B05_DOOR_CONTRACTS) {
    assert.equal(new Set(entry.titles).size, entry.titles.length, `${entry.key} names a title twice`);
    for (const file of entry.tests) {
      const source = fs.readFileSync(new URL(file, ROOT), "utf8");
      const ran = [...source.matchAll(/^test\((["'`])(.+)\1,/gm)].map((m) => m[2]);
      const unbound = ran.filter((title) => !entry.titles.includes(title));
      assert.deepEqual(unbound, [], `${file} runs tests the proof row does not name`);
    }
  }
});

test("the door recipe uses these proofs at deep depth and the rows have left the red route lane", () => {
  const redIds = new Set(ROUTE_GAP_ROWS.map((row) => `${row.sourceFile}\0${row.surface}\0${row.control}`));
  for (const entry of FIN_B05_DOOR_CONTRACTS) {
    const row = { surface: entry.surface, control: entry.control };
    const proof = proofForDoor(entry.sourceFile, row);
    assert.equal(proof.depth, "deep", entry.key);
    assert.equal(proof.verdict, undefined, entry.key);
    assert.equal(proof.asserts, entry.control);
    assert.ok(proof.evidence.includes(FIN_B05_GUARD_TEST));
    for (const file of entry.tests) assert.ok(proof.evidence.includes(file), `${entry.key} lost ${file}`);
    assert.equal(redIds.has(`${entry.sourceFile}\0${entry.surface}\0${entry.control}`), false, `${entry.key} is still red`);
  }
});

test("a same-route row with a different result stays unproved", () => {
  const entry = FIN_B05_DOOR_CONTRACTS[0];
  assert.equal(finB05DoorProof(entry.sourceFile, { surface: entry.surface, control: `${entry.control} changed` }), null);
  assert.equal(finB05DoorProof("routes-3.json", { surface: entry.surface, control: entry.control }), null);
});

test("closer-deck send_ebook stays not proved: the handler refuses that action", () => {
  const row = ROUTE_GAP_ROWS.find((candidate) => candidate.surface === "route:closer-deck" && /send_ebook/.test(candidate.control));
  assert.ok(row, "the send_ebook row left the red lane without a result that proves it");
  assert.equal(finB05DoorProof(row.sourceFile, row), null);
});
