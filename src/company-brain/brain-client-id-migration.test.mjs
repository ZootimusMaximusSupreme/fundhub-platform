// Migration 499 clears the made-up client ids the Drive sync saved on recordings.
// It is a data repair on live rows, so these tests pin what it may and may not do:
// guarded, one UPDATE, only client_id, only rows whose client does not exist in the same
// company, and nothing that deletes.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FILE = "db/migrations/499_brain_files_clear_made_up_client_ids.sql";
const SQL = fs.readFileSync(path.join(ROOT, FILE), "utf8");
const code = SQL.split("\n").filter((line) => !/^\s*--/.test(line)).join("\n");
const flat = code.replace(/\s+/g, " ").trim();

test("migration 499 is listed in the expected migrations", async () => {
  const { EXPECTED_MIGRATIONS } = await import("../../db/expected-migrations.mjs");
  assert.ok(EXPECTED_MIGRATIONS.includes("migrations/499_brain_files_clear_made_up_client_ids.sql"));
});

test("migration 499 does nothing unless both tables exist", () => {
  assert.match(flat, /IF to_regclass\('public\.brain_files'\) IS NULL OR to_regclass\('public\.clients'\) IS NULL THEN RETURN; END IF;/);
});

test("migration 499 sets client_id to NULL and touches no other column", () => {
  const updates = flat.match(/UPDATE /gi) || [];
  assert.equal(updates.length, 1, "exactly one UPDATE");
  assert.match(flat, /UPDATE public\.brain_files bf SET client_id = NULL WHERE /);
  const setClause = flat.match(/ SET (.*?) WHERE /)[1];
  assert.equal(setClause, "client_id = NULL", "only client_id is set");
});

test("migration 499 only reaches rows whose client is missing from the same company", () => {
  assert.match(flat, /WHERE bf\.client_id IS NOT NULL AND NOT EXISTS \( SELECT 1 FROM public\.clients c WHERE c\.id = bf\.client_id AND c\.org_id = bf\.org_id \)/);
});

test("migration 499 deletes and adds nothing, so a second run changes nothing", () => {
  assert.doesNotMatch(code, /\b(DELETE|DROP|TRUNCATE|INSERT|ALTER|CREATE)\b/i);
});
