// 498 — the client checklist says "our team", never "your advisor".
//
// Owner-set 2026-10-20 (final): Capital Blueprint has no named human advisor.
// AI coaches do the touch-base; the Fundhub team works a CSM queue. These tests
// read the real migration files, so a copy edit that brings "advisor" back, or
// an UPDATE that stops matching the exact old text, fails here without a
// database. src/waypoints/step-words-fundhub-team.pg.test.mjs runs the same SQL
// against real table shapes.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { newAccountReason } from "./verify.mjs";

const read = (f) => readFileSync(new URL(`../../db/migrations/${f}`, import.meta.url), "utf8");
const sql362 = read("362_waypoint_definitions_seed.sql");
const sql363 = read("363_waypoint_definitions_copy_and_grants.sql");
const sql400 = read("400_blueprint_dispute_waypoint_definitions.sql");
const sql498 = read("498_waypoint_steps_fundhub_team.sql");

const unquote = (lit) => (lit === "NULL" ? null : lit.slice(1, -1).replace(/''/g, "'"));

/** Every seeded definition's client-facing title and detail, by key. */
function catalogFrom(sql) {
  const body = sql.slice(sql.search(/^VALUES$/m), sql.lastIndexOf("ON CONFLICT"));
  const lit = "('(?:[^']|'')*'|NULL)";
  const re = new RegExp(`\\(\\s*'([a-z0-9_]+)',\\s*'[a-z_]+',\\s*${lit},\\s*${lit}`, "g");
  return [...body.matchAll(re)].map((m) => ({ key: m[1], title: unquote(m[2]), detail: unquote(m[3]) }));
}

/** 498's copy UPDATEs: table, field, key, exact old text, new text. */
const UPDATES = [...sql498.matchAll(
  /UPDATE (waypoint_definitions|client_waypoints)\s+SET (title|detail) = \$new\$(.*?)\$new\$\s+WHERE key = '([a-z_]+)'\s+AND \2 = \$old\$(.*?)\$old\$;/gs
)].map((m) => ({ table: m[1], field: m[2], next: m[3], key: m[4], old: m[5] }));

const statements = sql498.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);

test("498 is copy only: UPDATEs, every one guarded, no delete and no schema change", () => {
  assert.equal(statements.length, 7, "three catalog fields, the same three on client rows, one blocked reason");
  for (const s of statements) {
    assert.match(s, /^UPDATE (waypoint_definitions|client_waypoints)\b/, s);
    assert.match(s, /\bWHERE key = '[a-z_]+'\s+AND /, `every UPDATE is scoped to one key and an exact-old guard: ${s}`);
  }
  assert.doesNotMatch(sql498.replace(/--[^\n]*/g, ""), /\b(DELETE|DROP|ALTER|INSERT|TRUNCATE|CREATE)\b/i);
  assert.equal(UPDATES.length, 6);
});

test("each guard is the exact text 362 seeded (and 363 re-asserted), and each new text drops the advisor", () => {
  const seeded = Object.fromEntries(catalogFrom(sql362).map((r) => [r.key, r]));
  for (const u of UPDATES) {
    assert.equal(u.old, seeded[u.key][u.field], `${u.table}.${u.key}.${u.field} guards on 362's exact words`);
    assert.ok(sql363.includes(`'${u.old.replace(/'/g, "''")}'`), `363 sets the same words for ${u.key}.${u.field}`);
    assert.match(u.old, /advisor/i);
    assert.doesNotMatch(u.next, /advisor/i);
    assert.match(u.next, /\bour team\b/i);
  }
  // The client rows get exactly the catalog's change, field for field.
  const pick = (t) => UPDATES.filter((u) => u.table === t).map(({ field, key, old, next }) => ({ field, key, old, next }));
  assert.deepEqual(pick("client_waypoints"), pick("waypoint_definitions"));
});

test("after 498, no client-facing step title or detail in the catalog says advisor", () => {
  const rows = [...catalogFrom(sql362), ...catalogFrom(sql400)];
  assert.equal(rows.length, 9, "362's six plus 400's three");
  for (const r of rows) {
    for (const field of ["title", "detail"]) {
      const u = UPDATES.find((x) => x.table === "waypoint_definitions" && x.key === r.key && x.field === field && x.old === r[field]);
      const text = u ? u.next : r[field];
      assert.doesNotMatch(String(text ?? ""), /advisor/i, `${r.key}.${field}: ${text}`);
    }
  }
});

test("a hand-edited step is not matched by any 498 guard", () => {
  const edited = "Talk to Chris about a personal loan";
  assert.ok(!UPDATES.some((u) => u.old === edited));
});

test("the blocked reason says our team, and 498 rewrites only the exact old generated shape to the same words", () => {
  const cases = [
    [{ creditor: "Brand New Bank Card" }],
    [{ creditor: "A" }, { creditor: "B" }],
    [{ creditor: "" }],
    [{ creditor: "" }, { creditor: "" }]
  ];
  const m = sql498.match(/regexp_replace\(\s*state_reason,\s*'([^']+)',\s*'([^']+)'\)\s*WHERE key = 'no_new_credit'\s+AND state_reason ~ '([^']+)';/);
  assert.ok(m, "the state_reason UPDATE is present");
  const [, find, replaceWith, guard] = m;
  for (const c of cases) {
    const now = newAccountReason(c);
    assert.doesNotMatch(now, /advisor/i);
    assert.match(now, /Let our team know if (this is|any of these are) not yours\.$/);
    const old = now.replace("Let our team know", "Let your advisor know");
    assert.match(old, new RegExp(guard), `the guard matches the old shape: ${old}`);
    assert.equal(old.replace(new RegExp(find), replaceWith.replace("\\1", "$1")), now, "rewritten to exactly what the code writes today");
    assert.doesNotMatch(now, new RegExp(guard), "a replay finds nothing");
  }
  for (const edited of [
    "Owner note: Let your advisor know if this is not yours.",
    "Your credit file now shows an account that was not on it when you enrolled: X. Let your advisor know if this is not yours. Thanks."
  ]) {
    assert.doesNotMatch(edited, new RegExp(guard), `left alone: ${edited}`);
  }
});
