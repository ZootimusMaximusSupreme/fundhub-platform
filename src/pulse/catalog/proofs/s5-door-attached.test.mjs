// Guards the S5 registry (s5-door-contracts.mjs).
//
// Rows proved by one of this slice's own test files are held by the "every
// registry row was exercised" case inside that file. Rows proved by an OLDER
// handler test are held here: the older test must still exist, still import the
// real handler, and still carry the named cases that judge this result. If
// someone renames or deletes one of those cases, this file goes red and the row
// must go back to not proved. It does not re-prove the older test; that test
// runs on its own in the suite.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ROUTES } from "../../../../netlify/functions/api.mjs";
import { S5_ROUTE_ROWS, s5DoorProof } from "./s5-door-contracts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const attached = S5_ROUTE_ROWS.filter((row) => row.handler);

test("every registry row is a staff-only or no-impact route and has a unique name", () => {
  assert.ok(S5_ROUTE_ROWS.length > 0);
  assert.equal(new Set(S5_ROUTE_ROWS.map((row) => row.name)).size, S5_ROUTE_ROWS.length);
  for (const row of S5_ROUTE_ROWS) {
    assert.ok(["staffOnly", "none"].includes(row.impact), `${row.name} is ${row.impact}: money and customer rows need a deep proof`);
    assert.ok(fs.existsSync(path.join(ROOT, row.test)), `${row.name}: ${row.test} is missing`);
    assert.match(row.sourceFile, /^routes-[0-3]\.json$/);
  }
});

test("a registry row answers only for its exact map text", () => {
  for (const row of S5_ROUTE_ROWS) {
    const proof = s5DoorProof(row.sourceFile, { surface: row.surface, control: row.control });
    assert.deepEqual(proof, { depth: "e2e", evidence: row.test, asserts: row.control });
    assert.equal(s5DoorProof(row.sourceFile, { surface: row.surface, control: `${row.control} changed` }), null);
  }
});

test("rows proved by an older handler test still name real cases in a test that imports the real handler", () => {
  assert.ok(attached.length > 0);
  for (const row of attached) {
    assert.ok(fs.existsSync(path.join(ROOT, row.handler)), `${row.name}: ${row.handler} is missing`);
    const source = read(row.test);
    assert.ok(source.includes(row.handler), `${row.name}: ${row.test} no longer imports ${row.handler}`);
    assert.ok(row.titles.length >= 2, `${row.name}: name at least two cases`);
    for (const title of row.titles) {
      assert.ok(source.includes(title), `${row.name}: ${row.test} lost the case "${title}"`);
    }
    const key = row.surface.replace(/^route:/, "").replace(/ \(.*$/, "");
    assert.equal(typeof ROUTES[key], "function", `${row.name}: ${key} is not a routed handler`);
  }
});
