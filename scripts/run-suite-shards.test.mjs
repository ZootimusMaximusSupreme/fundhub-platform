import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { UNIT_SHARD_COUNT, unitShardFor } from "./run-suite-shards.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === "node_modules" || name === ".git") continue;
    const file = path.join(dir, name);
    if (fs.statSync(file).isDirectory()) walk(file, out);
    else if (name.endsWith(".test.mjs")) {
      out.push(path.relative(ROOT, file).split(path.sep).join("/"));
    }
  }
  return out;
}

test("unit CI shards cover every test file exactly once without changing the pg list", () => {
  const all = [...walk(path.join(ROOT, "src")), ...walk(path.join(ROOT, "scripts"))];
  const files = all.filter((file) => !file.endsWith(".pg.test.mjs"));
  const pg = all.filter((file) => file.endsWith(".pg.test.mjs"));
  const shards = Array.from({ length: UNIT_SHARD_COUNT }, () => []);
  for (const file of files) shards[unitShardFor(file)].push(file);

  assert.equal(new Set(files).size, files.length, "discovery must not duplicate a file");
  assert.ok(shards.every((filesInShard) => filesInShard.length > 0), "every CI shard must run tests");
  assert.deepEqual(shards.flat().sort(), files.sort(), "shards must cover every unit file once");
  assert.ok(pg.length > 0, "the separate serial Postgres job must still have tests");
  assert.deepEqual([...shards.flat(), ...pg].sort(), all.sort(), "unit shards plus pg job must cover the whole suite");
});

test("unit shard assignment is stable for a file path", () => {
  assert.equal(unitShardFor("src/example.test.mjs"), unitShardFor("src/example.test.mjs"));
  assert.throws(() => unitShardFor("src/example.test.mjs", 0), /positive/);
});
