import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { GAP_FILES, SLICE_FILES } from "./modules.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

function onDisk(prefix) {
  return fs.readdirSync(HERE)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".mjs") && !name.endsWith(".test.mjs"))
    .sort();
}

test("every slice file on disk is on the named list, and nothing else is", () => {
  const listed = SLICE_FILES.map(([name]) => name).sort();
  assert.deepEqual(listed, onDisk("slice-"),
    "Add the new slice-*.mjs file to SLICE_FILES in src/pulse/coverage/modules.mjs. " +
    "The live bundle only carries files that list names.");
});

test("every gap file on disk is on the named list, and nothing else is", () => {
  const listed = GAP_FILES.map(([name]) => name).sort();
  assert.deepEqual(listed, onDisk("gap-"),
    "Add the new gap-*.mjs file to GAP_FILES in src/pulse/coverage/modules.mjs. " +
    "The live bundle only carries files that list names.");
});

test("each list entry loads its own file by a literal import", () => {
  const src = fs.readFileSync(path.join(HERE, "modules.mjs"), "utf8");
  for (const [name] of [...SLICE_FILES, ...GAP_FILES]) {
    assert.ok(src.includes(`() => import("./${name}")`), `${name} must be a literal import("./${name}")`);
  }
});

test("every slice loads with a CHECKS list and every gap loads with gapChecks", async () => {
  for (const [name, load] of SLICE_FILES) {
    const mod = await load();
    assert.ok(Array.isArray(mod.CHECKS), `${name} has no CHECKS list`);
  }
  for (const [name, load] of GAP_FILES) {
    const mod = await load();
    assert.equal(typeof mod.gapChecks, "function", `${name} has no gapChecks export`);
  }
});
