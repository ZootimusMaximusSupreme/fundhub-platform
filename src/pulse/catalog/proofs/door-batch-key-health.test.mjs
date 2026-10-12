import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makeRecipe } from "../door-recipes.mjs";
import { evaluateKeyHealth } from "../../coverage/gap-door-batch-keys.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/keys.json");
const CODE_ROOTS = ["src", "api", "netlify", "scripts", "e2e", "vendor", "db", "public"];
const CODE_EXTENSIONS = /\.(?:mjs|js|cjs|ts|tsx|html|sql)$/;

function codeFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return codeFiles(full);
    return CODE_EXTENSIONS.test(entry.name) ? [full] : [];
  });
}

function exactName(name) {
  return new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
}

function fakeValue(name) {
  if (/(?:^|_)(?:URL|URI|ORIGIN)$/.test(name)) return "https://door-proof.example.test/path";
  if (/(?:^|_)HOST$/.test(name)) return "door-proof.example.test";
  if (/(?:^|_)(?:CENTS|PORT|TIMEOUT_MS|LIMIT|MAX|DAYS|HOURS|MINUTES)$/.test(name)) return "30";
  if (/(?:^|_)EMAIL$/.test(name)) return "door-proof@example.test";
  return `fake-${name.toLowerCase()}-value-8f1c2d3e`;
}

test("one key health pass checks every remaining sensitive key without printing values", () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) => {
    if (row.repeats_row_in) return false;
    return makeRecipe("keys.json", row).proof?.evidence.includes("door-batch-key-health.test.mjs");
  });
  const sources = CODE_ROOTS.flatMap((root) => codeFiles(path.join(ROOT, root))).map((file) => ({
    file: path.relative(ROOT, file),
    text: fs.readFileSync(file, "utf8"),
  }));

  assert.equal(rows.length, 114);
  for (const row of rows) {
    const pattern = exactName(row.env_name);
    const references = sources.filter(({ text }) => pattern.test(text)).map(({ file }) => file);
    const env = { [row.env_name]: fakeValue(row.env_name) };
    const result = evaluateKeyHealth(row, env, references);
    assert.equal(result.ok, true, `${row.surface}: ${result.problems.join(", ")}`);
    assert.equal(Object.hasOwn(result, "value"), false, row.surface);

    const recipe = makeRecipe("keys.json", row);
    assert.equal(recipe.mode, "read-only", row.surface);
    assert.equal(recipe.proof.depth, "deep", row.surface);
    assert.equal(recipe.proof.asserts, row.control, row.surface);
  }
});

test("key health rejects missing, masked, malformed, and unread keys without leaking them", () => {
  const row = {
    env_name: "DOOR_SECRET",
    surface: "env:DOOR_SECRET",
    control: "DOOR_SECRET: protects one door",
    read_by_files: 1,
    impact: "customerData",
  };
  assert.deepEqual(evaluateKeyHealth(row, {}, ["src/reader.mjs"]).problems, ["value is missing"]);
  assert.deepEqual(evaluateKeyHealth(row, { DOOR_SECRET: "****************" }, ["src/reader.mjs"]).problems, ["value is masked"]);
  assert.deepEqual(evaluateKeyHealth(row, { DOOR_SECRET: "short" }, ["src/reader.mjs"]).problems, ["credential is too short"]);
  const missingReader = evaluateKeyHealth(row, { DOOR_SECRET: "fake-long-secret" }, []);
  assert.deepEqual(missingReader.problems, ["repo code has no reader"]);
  assert.equal(JSON.stringify(missingReader).includes("fake-long-secret"), false);
});
