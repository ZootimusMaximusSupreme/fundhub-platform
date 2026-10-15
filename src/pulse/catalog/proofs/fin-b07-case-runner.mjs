// Runs a table of live-check scenarios against the exact SQL text of a contract (tests only).
//
// A scenario file hands this a map: contract SQL key -> { tables, good, bad[] }.
//   good  rows that are right. Their sample count is counted and none is wrong.
//   bad   one wrong row each: { name, rows, breaks }. The row is added next to the good ones and
//         the check must count exactly one wrong result. `breaks` names the piece of the SQL text
//         that catches it (whitespace is ignored). The same check is then run with that piece
//         switched off, and the wrong row must now read clean. That is the "break the SQL on
//         purpose, see it go red, put it back" step, done inside the test so it never needs a hand
//         edit. A plain string is a wrong-result test and is switched off by putting `1 = 0 AND`
//         in front of it. { piece, with } gives the replacement text when the piece is a filter.
//
// Also checked for every key: no results reads zero of zero, and another company's wrong row is
// never counted for this company.

import assert from "node:assert/strict";
import test from "node:test";

import { FIN_B07_RESULT_CONTRACTS } from "./fin-b07-display-contracts.mjs";
import { makeStandIn } from "./fin-b07-sql-kit.mjs";

export const ORG = "11111111-1111-4111-8111-111111111111";
export const OTHER_ORG = "22222222-2222-4222-8222-222222222222";

/** A stable test uuid from a small number. */
export function id(n) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
}

/** A timestamp this long ago, in the form both Postgres and the stand-in compare as text. */
export function ago(amount, unit = "days") {
  const ms = { minutes: 60e3, hours: 3600e3, days: 86400e3 }[unit] * amount;
  return new Date(Date.now() - ms).toISOString().replace("T", " ").slice(0, 19);
}

function pieceRegex(piece) {
  const escaped = piece.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+");
  return new RegExp(escaped);
}

/** Switch one named piece of the SQL off. Throws when the piece is not in the text. */
export function switchOff(sql, brk) {
  const piece = typeof brk === "string" ? brk : brk.piece;
  const found = pieceRegex(piece).exec(sql);
  assert.ok(found, `the SQL does not contain the clause named in the test: ${piece}`);
  let replacement;
  if (typeof brk === "string") {
    const lead = /^(OR |FILTER \(WHERE )/.exec(found[0])?.[0] || "";
    replacement = `${lead}1 = 0 AND ${found[0].slice(lead.length)}`;
  } else {
    replacement = brk.with;
  }
  return sql.slice(0, found.index) + replacement + sql.slice(found.index + found[0].length);
}

const BY_KEY = new Map(FIN_B07_RESULT_CONTRACTS.map((c) => [/display-result:([^\s*]+)/.exec(c.sql)[1], c]));

export function contractSql(key) {
  const found = BY_KEY.get(key);
  assert.ok(found, `no contract with key ${key}`);
  return found.sql;
}

function load(standIn, rows, swapOrg = false) {
  for (const [table, row] of rows) {
    standIn.insert(table, swapOrg && row.org_id === ORG ? { ...row, org_id: OTHER_ORG } : row);
  }
}

function judge(tables, rows, sql, { swapOrg = false } = {}) {
  const standIn = makeStandIn(tables);
  try {
    load(standIn, rows, swapOrg);
    return standIn.run(sql, ORG);
  } finally {
    standIn.close();
  }
}

export function runCases(cases) {
  for (const [key, spec] of Object.entries(cases)) {
    const sql = contractSql(key);

    test(`${key}: right results are counted and none is wrong`, () => {
      const out = judge(spec.tables, spec.good, sql);
      assert.ok(out.sample_count >= 1, "the good rows must be counted as samples");
      assert.equal(out.bad_count, 0);
    });

    test(`${key}: no saved results reads zero of zero`, () => {
      assert.deepEqual(judge(spec.tables, [], sql), { sample_count: 0, bad_count: 0 });
    });

    for (const bad of spec.bad) {
      test(`${key}: ${bad.name} is counted wrong, and reads clean once that clause is switched off`, () => {
        const goodOnly = judge(spec.tables, spec.good, sql);
        const out = judge(spec.tables, [...spec.good, ...bad.rows], sql);
        const expected = bad.expectBad ?? 1;
        assert.equal(out.bad_count, expected, `expected ${expected} wrong result(s), got ${out.bad_count}`);
        assert.equal(out.sample_count, goodOnly.sample_count + (bad.extraSamples ?? 1));

        const pieces = Array.isArray(bad.breaks) ? bad.breaks : [bad.breaks];
        let broken = sql;
        for (const piece of pieces) broken = switchOff(broken, piece);
        const mutated = judge(spec.tables, [...spec.good, ...bad.rows], broken);
        assert.equal(mutated.bad_count, 0, "with the clause switched off the wrong row must read clean");
      });
    }

    test(`${key}: another company's wrong row is never counted`, () => {
      const allBad = spec.bad.flatMap((b) => b.rows);
      const out = judge(spec.tables, [...spec.good, ...allBad], sql, { swapOrg: true });
      assert.deepEqual(out, { sample_count: 0, bad_count: 0 });
    });
  }
}
