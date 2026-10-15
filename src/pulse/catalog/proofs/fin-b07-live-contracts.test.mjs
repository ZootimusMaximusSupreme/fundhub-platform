// Shape guard for the batch 07 live checks. The scenario files (fin-b07-live-cases-*.test.mjs) run
// the SQL over stand-in rows; this file holds what is true of the whole set: every contract is one
// read-only statement on the company, each control is one exact map row, and each contract has a
// scenario file that runs it.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { STAFF_UI_PROOF_CASES } from "./display-batch-staff-ui.mjs";
import {
  FIN_B07_ALREADY_DEEP,
  FIN_B07_DISPLAY_CASES,
  FIN_B07_LIVE_CASES,
  FIN_B07_LIVE_ROWS,
  FIN_B07_NOT_ATTACHABLE,
  FIN_B07_PRACTICE_CASES,
  FIN_B07_RESULT_CONTRACTS,
} from "./fin-b07-display-contracts.mjs";
import { schemaColumns } from "./fin-b07-sql-kit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_TEXT = ["desk", "repair", "misc"]
  .map((name) => fs.readFileSync(path.join(HERE, `fin-b07-live-cases-${name}.test.mjs`), "utf8")).join("\n");
const MAP_DIR = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10");
const keyOf = (c) => /display-result:([^\s*]+)/.exec(c.sql)[1];

test("46 rows: 40 live checks, 4 practice tests, 2 that cannot be attached", () => {
  assert.equal(FIN_B07_RESULT_CONTRACTS.length, 40);
  assert.equal(FIN_B07_LIVE_ROWS.length, 40);
  assert.equal(FIN_B07_PRACTICE_CASES.length, 4);
  assert.equal(FIN_B07_NOT_ATTACHABLE.length, 2);
  const keys = new Set([...FIN_B07_LIVE_ROWS, ...FIN_B07_PRACTICE_CASES.map((c) => [c.sourceFile, c.surface, c.control])].map((r) => r.join("\0")));
  assert.equal(keys.size, 44, "no row may be named twice");
});

test("every contract is one read-only statement that takes the company and answers sample_count and bad_count", () => {
  const seen = new Set();
  for (const c of FIN_B07_RESULT_CONTRACTS) {
    const key = keyOf(c);
    assert.ok(!seen.has(key), `duplicate key ${key}`);
    seen.add(key);
    assert.equal(c.mode, "query");
    assert.equal(c.emptyAs, "quiet", `${key}: a control nobody used must read quiet, not red`);
    assert.ok(c.requirement.length > 40, key);
    assert.match(c.sql, /^\/\* display-result:fin-b07-[a-z-]+ \*\/\nSELECT /, key);
    assert.match(c.sql, /AS sample_count/, key);
    assert.match(c.sql, /AS bad_count/, key);
    assert.match(c.sql, /\$1::uuid/, key);
    assert.doesNotMatch(c.sql.replace(/\/\*[\s\S]*?\*\//g, ""), /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT)\b/i, key);
    assert.doesNotMatch(c.sql, /\$2/, `${key}: the lane passes only the company`);
    assert.match(c.sql, /FILTER \(WHERE|bad_count/, key);
  }
});

test("every contract judges a field: the wrong-result clause compares or tests a column, it never just counts", () => {
  for (const c of FIN_B07_RESULT_CONTRACTS) {
    const afterSample = c.sql.slice(c.sql.indexOf("AS sample_count"));
    const body = afterSample.slice(afterSample.search(/FILTER \(WHERE|bad_count|\(SELECT/));
    assert.ok(
      /IS (?:NOT )?NULL|IS DISTINCT FROM|EXISTS|NOT IN|NOT LIKE|<>|<=|>=|\s<\s|\s>\s|\s=\s/.test(body),
      `${keyOf(c)} has no condition on a field`,
    );
    assert.match(c.sql, /WHERE[\s\S]*\$1::uuid/, `${keyOf(c)} must filter on the company`);
  }
});

test("every control is exactly one display row of the coverage map", () => {
  const rowsByFile = new Map();
  const rowsOf = (file) => {
    if (!rowsByFile.has(file)) rowsByFile.set(file, JSON.parse(fs.readFileSync(path.join(MAP_DIR, file), "utf8")));
    return rowsByFile.get(file);
  };
  const all = [
    ...FIN_B07_LIVE_ROWS,
    ...FIN_B07_PRACTICE_CASES.map((c) => [c.sourceFile, c.surface, c.control]),
  ];
  for (const [file, surface, control] of all) {
    const found = rowsOf(file).filter((r) => r.surface === surface && r.control === control);
    assert.equal(found.length, 1, `${file} / ${surface} / ${control}`);
  }
  const controls = FIN_B07_RESULT_CONTRACTS.map((c) => c.control);
  assert.equal(new Set(controls).size, controls.length, "a control may own one contract only");
});

test("every contract names tables and columns that db/schema and db/migrations really define", () => {
  const schema = schemaColumns();
  const aliasRe = /\b(?:FROM|JOIN)\s+([a-z_]+)\s+(?:AS\s+)?([a-z]{1,3})\b/gi;
  for (const c of FIN_B07_RESULT_CONTRACTS) {
    const aliases = new Map();
    let m;
    while ((m = aliasRe.exec(c.sql))) {
      if (!schema.has(m[1].toLowerCase())) continue;
      aliases.set(m[2], m[1].toLowerCase());
    }
    assert.ok(aliases.size > 0, keyOf(c));
    const colRe = /\b([a-z]{1,3})\.([a-z_]+)\b/g;
    while ((m = colRe.exec(c.sql.replace(/'[^']*'/g, "''")))) {
      const table = aliases.get(m[1]);
      if (!table) continue; // an alias of a sub-select or a function
      assert.ok(schema.get(table).has(m[2]), `${keyOf(c)}: ${m[1]}.${m[2]} is not a column of ${table}`);
    }
  }
});

test("every contract has a scenario that runs it", () => {
  for (const c of FIN_B07_RESULT_CONTRACTS) {
    assert.ok(SCENARIO_TEXT.includes(`"${keyOf(c)}"`), `no scenario for ${keyOf(c)}`);
  }
  for (const c of FIN_B07_LIVE_CASES) {
    for (const t of c.tests) assert.ok(fs.existsSync(path.join(ROOT, t)), `${t} does not exist`);
    assert.match(c.evidence, /gap-catalog-display\.mjs/);
  }
  for (const c of FIN_B07_PRACTICE_CASES) {
    for (const t of c.tests) assert.ok(fs.existsSync(path.join(ROOT, t)), `${t} does not exist`);
    assert.doesNotMatch(c.evidence, /gap-catalog-display\.mjs/);
  }
  assert.equal(FIN_B07_DISPLAY_CASES.length, 44 - FIN_B07_ALREADY_DEEP.length);
});

test("the rows left out of the live cases are exactly the ones the staff file already holds as deep cases", () => {
  const held = new Set(STAFF_UI_PROOF_CASES.map((c) => [c.sourceFile, c.surface, c.control].join("\0")));
  const mine = new Map(FIN_B07_RESULT_CONTRACTS.map((c, i) => [FIN_B07_LIVE_ROWS[i].join("\0"), c]));
  assert.equal(mine.size, 40);
  const already = [...mine.keys()].filter((k) => held.has(k));
  assert.equal(already.length, FIN_B07_ALREADY_DEEP.length, "the staff file holds a different set of these rows");
  for (const key of already) {
    assert.ok(!FIN_B07_LIVE_CASES.some((c) => [c.sourceFile, c.surface, c.control].join("\0") === key), "a row held by the staff file is repeated here");
  }
});

test("each row that cannot be attached carries an exact reason", () => {
  for (const r of FIN_B07_NOT_ATTACHABLE) {
    assert.ok(r.reason.length > 120, r.rowKey);
    assert.match(r.reason, /public\/app\/money-banks\.js|git/);
  }
});
