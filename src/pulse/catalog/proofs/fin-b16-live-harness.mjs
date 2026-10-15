// The shared pieces of the batch 16 live-check tests: the stand-in database runner, the "one named condition
// at a time" test, and a few stand-in rows. Tests only; nothing here is imported by the live bundle.

import assert from "node:assert/strict";
import test from "node:test";

import { makeStandIn, NOW } from "./fin-b16-sql-kit.mjs";

export const ORG = "0a000000-0000-4000-8000-000000000001";
export const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const DAY = 86_400_000;
export const at = (days, hours = 0) => new Date(NOW.getTime() + days * DAY + hours * 3_600_000).toISOString();

let counter = 0;
export const id = (prefix = "x") => `${prefix}-${(counter += 1)}`;

// ───────────────────────── a small harness ─────────────────────────

/** Run one check's SQL (optionally without a named condition) over a stand-in built by seed(). */
export function counts(tables, seed, sql) {
  const standIn = makeStandIn(tables);
  try {
    seed(standIn);
    return standIn.run(sql, ORG);
  } finally {
    standIn.close();
  }
}

export const seedRows = (rows) => (standIn) => { for (const [table, row] of rows) standIn.insert(table, row); };

/**
 * For one check: the clean rows are never bad; each named condition has rows that break only it, the
 * full text counts them bad and the text without that condition does not. `bads[name]` is a list of
 * cases; a case is a list of [table, row] added to the clean rows. A case may be { rows, clean } to
 * replace the clean rows (for a case that needs a different settings row).
 */
export function conditionTest({ title, tables, sqlOf, names, clean, bads }) {
  test(`${title}: clean, other-company, demo and out-of-window rows are not counted`, () => {
    const got = counts(tables, seedRows(clean()), sqlOf());
    assert.equal(got.bad_count, 0);
    assert.ok(got.sample_count >= 1, "the clean rows are samples");
  });

  test(`${title}: every named condition is exercised by a row that breaks only it`, () => {
    assert.deepEqual([...Object.keys(bads)].sort(), [...names].sort(), "a case for every condition, and no case for a missing one");
  });

  for (const name of names) {
    test(`${title}: red on "${name}", and only that condition catches it`, () => {
      for (const one of bads[name]) {
        const base = Array.isArray(one) ? clean() : (one.clean ? one.clean() : clean());
        const added = Array.isArray(one) ? one : one.rows;
        const baseCount = counts(tables, seedRows(base), sqlOf());
        const withBad = counts(tables, seedRows([...base, ...added]), sqlOf());
        assert.ok(withBad.bad_count > baseCount.bad_count, `"${name}" must turn the check red`);
        assert.ok(withBad.sample_count > baseCount.sample_count, "the broken row is a sample");
        const withoutIt = counts(tables, seedRows([...base, ...added]), sqlOf({ without: [name] }));
        assert.equal(withoutIt.bad_count, baseCount.bad_count, `without "${name}" the same rows must not be caught`);
      }
    });
  }
}

// Phoenix is UTC-7 all year. phx(0, 22, 0) is today 22:00 in Arizona.
export const phx = (dayOffset, hour, minute = 0) => {
  const d = new Date(Date.UTC(2026, 9, 14 + dayOffset, hour + 7, minute, 0));
  return d.toISOString();
};

export const FORMATS = { standard: "bullets", sorting: "words", long: "words", notes: "bullets", greenscreen: "bullets", vsl: "bullets" };
export function settings(over = {}) {
  return ["marketing_settings", {
    org_id: ORG, enabled: true, batch_weekday: 1, batch_time: "07:00:00", timezone: "America/Phoenix",
    scripts_per_day: 3, days_per_batch: 7, size_rule: "total", format_style: FORMATS, draft_expiry_days: 14,
    quiet_start: "21:00:00", quiet_end: "07:00:00", updated_at: at(-30), ...over,
  }];
}

