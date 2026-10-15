// Batch 24, repair cycle 1: the few helpers the repair tests share. Tests only.
// Nothing here is product code, reaches a database, or asks a vendor.
//
// WHY THESE EXIST. The stand-in database cannot run SQL. Two things it could not
// do were why a checker found breaks that stayed green:
//
//   * A stand-in INSERT that answers a hand-picked row ignores the statement's own
//     RETURNING list, so a door that starts returning the whole row (or a secret
//     column) looks the same as one that returns three safe columns. returned()
//     cuts the full row down to the columns the statement really names, so
//     `RETURNING *` hands the handler (and so the test) everything.
//   * A statement that sums, counts or windows is answered by a canned row, so
//     `sum` turned into `max`, or a thirty-day window turned into thirty hours,
//     changes nothing a test can see. assertSqlHas() pins the exact fragments of
//     the statement that decide the number, so changing one is a red test with the
//     lost fragment named. A pin judges what the statement says; it does not run
//     it. The .pg.test.mjs files are what run the SQL (not run here, no Postgres).

import assert from "node:assert/strict";

/** White space of any kind is one space, so a pin does not care how a statement is wrapped. */
export const flat = (sql) => String(sql).replace(/\s+/g, " ").trim();

/**
 * Every [fragment, why] must be in the statement exactly as written.
 * The failure names the fragment that was lost and why it matters.
 */
export function assertSqlHas(sql, pins, what) {
  const text = flat(sql);
  for (const [fragment, why] of pins) {
    assert.ok(text.includes(flat(fragment)), `${what}: the statement lost "${flat(fragment)}" (${why})`);
  }
}

/** A statement must NOT carry a fragment (a condition that would make it wrong). */
export function assertSqlLacks(sql, pins, what) {
  const text = flat(sql);
  for (const [fragment, why] of pins) {
    assert.equal(text.includes(flat(fragment)), false, `${what}: the statement gained "${flat(fragment)}" (${why})`);
  }
}

/**
 * The rows an INSERT or UPDATE hands back, as the statement's RETURNING list says.
 * `RETURNING *` answers the whole row; a list answers only those columns.
 * A statement with no RETURNING answers nothing.
 */
export function returned(sql, row) {
  const match = /\bRETURNING\s+([\s\S]+?)\s*;?\s*$/i.exec(String(sql));
  if (!match) return [];
  const list = match[1].trim();
  if (list === "*") return [{ ...row }];
  const out = {};
  for (const part of list.split(",")) {
    const name = part.trim().replace(/^.*\bAS\s+/i, "").replace(/^\w+\./, "");
    if (name) out[name] = row[name];
  }
  return [out];
}

/** Every key a value holds, at any depth, so a secret cannot hide one level down. */
export function deepKeys(value, into = new Set()) {
  if (Array.isArray(value)) value.forEach((v) => deepKeys(v, into));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) { into.add(k); deepKeys(v, into); }
  }
  return into;
}
