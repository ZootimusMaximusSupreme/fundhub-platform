// Finish-853 batch 14: the live checks for the Journeys editor and the Lenders desk, run over stand-in rows.
//
// The exact SQL text each contract carries is run (fin-b14-sql-kit.mjs, SQLite, real column names from
// db/migrations). For every named bad-result condition:
//   - a row that breaks ONLY that condition is counted bad,
//   - the same text with that one condition left out does not count it (so the condition is what caught it),
//   - clean rows, another company's rows, demo rows and rows outside the window are never counted.
// No database, no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  FIN_B14_CHECKS,
  FIN_B14_RESULT_CONTRACTS,
  FIN_B14_LIVE_CASES,
  FIN_B14_LIVE_ROWS,
  journeysApplySql,
  journeysLoadSql,
  lendersAddSql,
  lendersImportSql,
  mismatchConfirmSql,
  mismatchCorrectSql,
  JOURNEY_HEADER_BAD,
  JOURNEY_STEP_BAD,
  JOURNEY_LOAD_BAD,
  LENDER_ADD_BAD,
  LENDER_IMPORT_BAD,
  TIP_PREFIXES,
  MISMATCH_CONFIRM_BAD,
  MISMATCH_CORRECT_BAD,
} from "./fin-b14-display-contracts.mjs";
import { makeStandIn, portableSql, schemaColumns, tablesIn, NOW } from "./fin-b14-sql-kit.mjs";
import { findBadSteps } from "../../../../api/journeys.mjs";
import { findSingleBraceTagsInNodes } from "../../../../src/journeys/copy-tags.mjs";
import { isTipRow } from "../../../lenders/tips.mjs";

// The tip prefixes the product itself uses (src/lenders/tips.mjs isTipRow), read out of its source so the
// list the SQL carries is held to the product's list, not to a copy of its own.
const PRODUCT_TIP_PREFIXES = (() => {
  const source = fs.readFileSync(new URL("../../../lenders/tips.mjs", import.meta.url), "utf8");
  const match = /\/\^\(([^)]*)\)\/i\.test\(name\)/.exec(source);
  assert.ok(match, "isTipRow still reads its prefixes from one regular expression");
  return match[1].split("|").map((p) => p.replace(/\\/g, ""));
})();

const ORG = "0a000000-0000-4000-8000-000000000001";
const OTHER_ORG = "0b000000-0000-4000-8000-000000000002";
const RECENT = new Date(NOW.getTime() - 5 * 86_400_000).toISOString();
const OLD = new Date(NOW.getTime() - 200 * 86_400_000).toISOString();

let counter = 0;
const id = (prefix = "x") => `${prefix}-${(counter += 1)}`;

// ───────────────────────── the contracts themselves ─────────────────────────

test("six live checks, one registry contract each, every one quiet when nothing is saved yet", () => {
  assert.equal(FIN_B14_CHECKS.length, 6);
  assert.equal(FIN_B14_RESULT_CONTRACTS.length, 6);
  assert.equal(FIN_B14_LIVE_ROWS.length, 6);
  assert.equal(FIN_B14_LIVE_CASES.length, 6);
  assert.equal(new Set(FIN_B14_RESULT_CONTRACTS.map((c) => c.control)).size, 6);
  assert.equal(new Set(FIN_B14_RESULT_CONTRACTS.map((c) => c.sql)).size, 6);
  for (const contract of FIN_B14_RESULT_CONTRACTS) {
    assert.equal(contract.mode, "query");
    assert.equal(contract.emptyAs, "quiet");
    assert.match(contract.sql, /^\/\* display-result:[a-z-]+ \*\//);
    assert.match(contract.sql, /AS sample_count/);
    assert.match(contract.sql, /AS bad_count/);
    assert.match(contract.sql, /\$1::uuid/);
    assert.ok(!/\$2/.test(contract.sql), "takes the company and nothing else");
    assert.ok(!/\b(insert|update|delete|truncate|alter|drop|create|grant)\b/i.test(contract.sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/'[^']*'/g, "''")), "read only");
    assert.ok(contract.requirement.length > 60);
  }
});

test("every table a contract reads is a real table, and every column it names is a real column", () => {
  const schema = schemaColumns();
  for (const contract of FIN_B14_RESULT_CONTRACTS) {
    for (const table of tablesIn(contract.sql)) assert.ok(schema.has(table), `${table} is not in db/schema or db/migrations`);
  }
  // portableSql refuses a regex shape the kit cannot run, so every contract must translate.
  for (const contract of FIN_B14_RESULT_CONTRACTS) portableSql(contract.sql);
});

// ───────────────────────── a small harness ─────────────────────────

/** Run one check's SQL (optionally without a named condition) over a stand-in built by seed(). */
function counts(tables, seed, sql) {
  const standIn = makeStandIn(tables);
  try {
    seed(standIn);
    return standIn.run(sql, ORG);
  } finally {
    standIn.close();
  }
}

/**
 * For one check: the clean rows are never bad; each named condition has a row that breaks only it, the
 * full text counts that row bad and the text without that condition does not.
 */
function conditionTest({ title, tables, sqlOf, names, clean, bads }) {
  test(`${title}: clean, other-company, demo and out-of-window rows are not counted`, () => {
    const seed = (standIn) => { for (const [table, row] of clean()) standIn.insert(table, row); };
    const got = counts(tables, seed, sqlOf());
    assert.equal(got.bad_count, 0);
    assert.ok(got.sample_count >= 1, "the clean rows are samples");
  });

  test(`${title}: every named condition is exercised by a row that breaks only it`, () => {
    assert.deepEqual([...Object.keys(bads)].sort(), [...names].sort(), "a case for every condition, and no case for a missing one");
  });

  for (const name of names) {
    test(`${title}: red on "${name}", and only that condition catches it`, () => {
      const cases = bads[name];
      const seedFor = (rows) => (standIn) => {
        for (const [table, row] of clean()) standIn.insert(table, row);
        for (const [table, row] of rows) standIn.insert(table, row);
      };
      const base = counts(tables, (s) => { for (const [table, row] of clean()) s.insert(table, row); }, sqlOf());
      for (const rows of cases) {
        const withBad = counts(tables, seedFor(rows), sqlOf());
        assert.ok(withBad.bad_count > base.bad_count, `"${name}" must turn the check red`);
        assert.ok(withBad.sample_count > base.sample_count, "the broken row is a sample");
        const withoutIt = counts(tables, seedFor(rows), sqlOf({ without: [name] }));
        assert.equal(withoutIt.bad_count, base.bad_count, `without "${name}" the same rows must not be caught`);
      }
    });
  }
}

// ───────────────────────── journeys.html ─────────────────────────

const GOOD_STEPS = [
  { id: "n1", type: "sms", title: "Text them the link", cfg: { body: "Hi {{first_name}}, here is the link: {{survey_link}} Reply STOP to opt out.", delay: "instant" } },
  { id: "n2", type: "wait", title: "Wait two days", cfg: { amount: "2", unit: "days" } },
  {
    id: "n3", type: "condition", title: "Did they finish", cfg: { field: "survey_complete", op: "is true" },
    branches: [
      { label: "Yes", nodes: [{ id: "n4", type: "stage", title: "Move to Booked", cfg: { stage: "Booked", pipeline: "Sales" } }] },
      { label: "No", nodes: [{ id: "n5", type: "email", title: "Email them", cfg: { subject: "Hello {{first_name}}", body: "Your portal: {{portal_link}}", delay: "instant" } }] },
    ],
  },
  { id: "n6", type: "handoff", title: "Hand off", cfg: { role: "Closer", stage: "" } },
];

function journey(over = {}) {
  return {
    id: id("journey"), org_id: ORG, key: "client", name: "Client", start_when: "A form is filled",
    end_when: "A result is ready", description: "", nodes: GOOD_STEPS, is_demo: false, ...over,
  };
}

/** A journey whose only fault is the one step given, placed inside a question's second path (the deepest place). */
function withBadStepDeep(step) {
  return journey({
    nodes: [
      GOOD_STEPS[0],
      {
        id: "q", type: "condition", title: "Q", cfg: { field: "survey_complete", op: "is true" },
        branches: [{ label: "Yes", nodes: [] }, { label: "No", nodes: [step] }],
      },
    ],
  });
}
const withBadStepTop = (step) => journey({ nodes: [GOOD_STEPS[0], step] });
const J = "journeys";

const cleanJourneys = () => [
  [J, journey({ key: "client" })],
  [J, journey({ key: "setter", name: "Setter" })],
  // never counted: another company's, a demo row, both with broken content
  [J, journey({ org_id: OTHER_ORG, key: "closer", nodes: [], name: "" })],
  [J, journey({ key: "demo-platform-nurture", is_demo: true, nodes: [], name: "" })],
];

const wrapRow = (row) => [[J, row]];

conditionTest({
  title: "journeys Apply to code",
  tables: [J],
  sqlOf: (o) => journeysApplySql(o),
  names: [...JOURNEY_HEADER_BAD, ...JOURNEY_STEP_BAD].map(([name]) => name),
  clean: cleanJourneys,
  bads: {
    "a journey's steps are not a list": [wrapRow(journey({ nodes: { not: "a list" } }))],
    "a journey has no name": [wrapRow(journey({ key: "closer", name: "  " }))],
    "a journey has no start line": [wrapRow(journey({ key: "advisor", start_when: "" }))],
    "a journey has no end line": [wrapRow(journey({ key: "affiliate", end_when: "" }))],
    "a journey has a key the editor does not own": [wrapRow(journey({ key: "funding_advisor" }))],
    // json_each hands a number back as a number, so a step that is a bare number reaches the type test.
    "a step is not a step at all": [wrapRow(withBadStepDeep([1, 2])), wrapRow(withBadStepTop(7))],
    "a step has no type": [
      wrapRow(withBadStepDeep({ id: "z", title: "No type", cfg: {} })),
      wrapRow(withBadStepTop({ id: "z", type: "  ", title: "Blank type", cfg: {} })),
      wrapRow(withBadStepTop({ id: "z", type: 5, title: "A number for a type", cfg: {} })),
    ],
    "a step has a type nothing renders": [wrapRow(withBadStepDeep({ id: "z", type: "teleport", title: "T", cfg: {} }))],
    "a step's settings are stored as something other than a list of settings": [
      wrapRow(withBadStepDeep({ id: "z", type: "sms", title: "S", cfg: "Hello there" })),
      wrapRow(withBadStepTop({ id: "z", type: "record", title: "R", cfg: ["a note"] })),
      wrapRow(withBadStepTop({ id: "z", type: "email", title: "E", cfg: 7 })),
    ],
    "a wait has no minutes, hours or days": [wrapRow(withBadStepDeep({ id: "z", type: "wait", title: "W", cfg: { amount: "2", unit: "weeks" } })), wrapRow(withBadStepTop({ id: "z", type: "wait", title: "W", cfg: { amount: "2" } }))],
    "a wait has no length above zero": [
      wrapRow(withBadStepDeep({ id: "z", type: "wait", title: "W", cfg: { amount: "0", unit: "days" } })),
      wrapRow(withBadStepDeep({ id: "z", type: "wait", title: "W", cfg: { amount: "soon", unit: "days" } })),
      wrapRow(withBadStepTop({ id: "z", type: "wait", title: "W", cfg: { amount: "", unit: "hours" } })),
      wrapRow(withBadStepTop({ id: "z", type: "wait", title: "W", cfg: { amount: "-3", unit: "hours" } })),
      wrapRow(withBadStepTop({ id: "z", type: "wait", title: "W", cfg: { amount: 0, unit: "hours" } })),
      wrapRow(withBadStepTop({ id: "z", type: "wait", title: "W", cfg: { unit: "hours" } })),
      wrapRow(withBadStepTop({ id: "z", type: "wait", title: "W", cfg: { amount: false, unit: "hours" } })),
    ],
    "a question has nothing to check": [
      wrapRow(withBadStepDeep({ id: "z", type: "condition", title: "Q", cfg: { field: " ", op: "is true" }, branches: [{ label: "Y", nodes: [] }, { label: "N", nodes: [] }] })),
      wrapRow(withBadStepTop({ id: "z", type: "condition", title: "Q", cfg: { field: 7, op: "is true" }, branches: [{ label: "Y", nodes: [] }, { label: "N", nodes: [] }] })),
    ],
    "a question has no paths coming off it": [
      wrapRow(withBadStepDeep({ id: "z", type: "condition", title: "Q", cfg: { field: "x", op: "is true" }, branches: [] })),
      wrapRow(withBadStepTop({ id: "z", type: "condition", title: "Q", cfg: { field: "x", op: "is true" } })),
    ],
    "a question's paths are not stored properly": [
      wrapRow(withBadStepDeep({ id: "z", type: "condition", title: "Q", cfg: { field: "x", op: "is true" }, branches: [{ label: "Y", nodes: "none" }, { label: "N", nodes: [] }] })),
      wrapRow(withBadStepTop({ id: "z", type: "condition", title: "Q", cfg: { field: "x", op: "is true" }, branches: [{ label: "Y" }, { label: "N", nodes: [] }] })),
      wrapRow(withBadStepTop({ id: "z", type: "condition", title: "Q", cfg: { field: "x", op: "is true" }, branches: [5, { label: "N", nodes: [] }] })),
    ],
    "a move-the-card step names no pipeline or no stage": [
      wrapRow(withBadStepDeep({ id: "z", type: "stage", title: "S", cfg: { stage: "Booked", pipeline: "" } })),
      wrapRow(withBadStepTop({ id: "z", type: "stage", title: "S", cfg: { pipeline: "Sales" } })),
      wrapRow(withBadStepTop({ id: "z", type: "stage", title: "S", cfg: { stage: 5, pipeline: "Sales" } })),
    ],
    "a text or email body uses single braces": [
      wrapRow(withBadStepDeep({ id: "z", type: "sms", title: "S", cfg: { body: "Hi {first_name}", delay: "instant" } })),
      wrapRow(withBadStepTop({ id: "z", type: "email", title: "E", cfg: { subject: "ok", body: "Hi {{first_name}} and {portal_link}", delay: "instant" } })),
      wrapRow(withBadStepTop({ id: "z", type: "sms", title: "S", cfg: { body: "Hi {{first_name}", delay: "instant" } })),
      wrapRow(withBadStepTop({ id: "z", type: "sms", title: "S", cfg: { body: "Hi {first_name}}", delay: "instant" } })),
    ],
    "a text or email subject uses single braces": [
      wrapRow(withBadStepDeep({ id: "z", type: "email", title: "E", cfg: { subject: "Hello {first_name}", body: "ok", delay: "instant" } })),
      wrapRow(withBadStepTop({ id: "z", type: "sms", title: "S", cfg: { body: "ok", subject: "Hello {first_name}", delay: "instant" } })),
    ],
  },
});

conditionTest({
  title: "journeys Page load",
  tables: [J],
  sqlOf: (o) => journeysLoadSql(o),
  names: JOURNEY_LOAD_BAD.map(([name]) => name),
  clean: cleanJourneys,
  bads: {
    "a saved journey has no steps, so the page draws the example in its place": [wrapRow(journey({ key: "closer", nodes: [] })), wrapRow(journey({ key: "advisor", nodes: { x: 1 } }))],
    "a saved journey has no name, so the page shows the example's name": [wrapRow(journey({ key: "closer", name: "" }))],
    "a saved journey has no start line, so the page shows the example's": [wrapRow(journey({ key: "closer", start_when: " " }))],
    "a saved journey has no end line, so the page shows the example's": [wrapRow(journey({ key: "closer", end_when: "" }))],
    "a saved journey has a key the page never asks for": [wrapRow(journey({ key: "mystery" }))],
  },
});

// ── The SQL against the product, journey for journey ─────────────────────────────────────────────────────
//
// The product refuses a save on findBadSteps and findSingleBraceTagsInNodes. The saved-row check must say the
// same thing about the same tree. Every entry below is a journey a person (or an old row) could hold. `refuse`
// is written by hand from what api/journeys.mjs says; the test asks the product's own functions first (so the
// hand-written word cannot drift from the product) and then asks the SQL.
//
// Not in the corpus, on purpose: a step that is a bare JSON string (SQLite hands a string element back with no
// quotes, so this stand-in cannot tell it from the text of an object), and a wait length written as a list
// (JavaScript reads [5] as 5, which is an accident of Number()).
const sms = (cfg, extra = {}) => ({ id: "c", type: "sms", title: "S", cfg, ...extra });
const wait = (cfg) => ({ id: "c", type: "wait", title: "W", cfg });
const ask = (cfg, branches) => ({ id: "c", type: "condition", title: "Q", cfg, branches });
const goodAsk = (inner = []) => ask({ field: "survey_complete", op: "is true" }, [{ label: "Yes", nodes: inner }, { label: "No", nodes: [] }]);

const CORPUS = [
  // allowed
  { name: "the example tree", refuse: false, nodes: GOOD_STEPS },
  { name: "a dotted merge tag with spaces", refuse: false, nodes: [sms({ body: "Hi {{ client.first_name }} and {{survey_link}}", delay: "instant" })] },
  { name: "braces around quoted words are not a tag", refuse: false, nodes: [sms({ body: 'Data {"a":1} and {"b": "c"}', delay: "instant" })] },
  { name: "a draft text with no words yet", refuse: false, nodes: [sms({ body: "", delay: "instant" })] },
  { name: "a step with no settings at all", refuse: false, nodes: [{ id: "c", type: "record", title: "R" }] },
  { name: "settings stored as null", refuse: false, nodes: [{ id: "c", type: "record", title: "R", cfg: null }] },
  { name: "an email with no subject", refuse: false, nodes: [{ id: "c", type: "email", title: "E", cfg: { body: "Hi", delay: "instant" } }] },
  { name: "a payment with no amount yet", refuse: false, nodes: [{ id: "c", type: "payment", title: "P", cfg: { amount: "", product: "" } }] },
  { name: "a question with one path", refuse: false, nodes: [ask({ field: "x", op: "is true" }, [{ label: "Yes", nodes: [] }])] },
  { name: "a question with two empty paths", refuse: false, nodes: [goodAsk()] },
  { name: "a question inside a question's path", refuse: false, nodes: [goodAsk([goodAsk([sms({ body: "ok {{first_name}}", delay: "instant" })])])] },
  { name: "wait .5 days", refuse: false, nodes: [wait({ amount: ".5", unit: "days" })] },
  { name: "wait 1e2 minutes", refuse: false, nodes: [wait({ amount: "1e2", unit: "minutes" })] },
  { name: "wait ' 5 ' hours (spaces around it)", refuse: false, nodes: [wait({ amount: " 5 ", unit: "hours" })] },
  { name: "wait '5.' days", refuse: false, nodes: [wait({ amount: "5.", unit: "days" })] },
  { name: "wait '+5' days", refuse: false, nodes: [wait({ amount: "+5", unit: "days" })] },
  { name: "wait '0x10' days", refuse: false, nodes: [wait({ amount: "0x10", unit: "days" })] },
  { name: "wait 2 as a JSON number", refuse: false, nodes: [wait({ amount: 2, unit: "days" })] },
  { name: "wait 2.5 as a JSON number", refuse: false, nodes: [wait({ amount: 2.5, unit: "hours" })] },
  { name: "wait true (JavaScript reads it as 1)", refuse: false, nodes: [wait({ amount: true, unit: "days" })] },
  { name: "an unwritten message with an unknown extra setting", refuse: false, nodes: [sms({ body: "Hi", delay: "instant", note: "x" })] },
  // refused
  { name: "{{first_name} (half closed)", refuse: true, nodes: [sms({ body: "Hi {{first_name}", delay: "instant" })] },
  { name: "{first_name}} (half opened)", refuse: true, nodes: [sms({ body: "Hi {first_name}}", delay: "instant" })] },
  { name: "single brace in a text body", refuse: true, nodes: [sms({ body: "Hi {first_name}", delay: "instant" })] },
  { name: "single brace in a text subject", refuse: true, nodes: [sms({ body: "ok", subject: "Hi {first_name}", delay: "instant" })] },
  { name: "single brace in an email subject", refuse: true, nodes: [{ id: "c", type: "email", title: "E", cfg: { subject: "Hi {first_name}", body: "ok" } }] },
  { name: "single brace next to a good tag", refuse: true, nodes: [sms({ body: "Hi {{first_name}} {portal_link}", delay: "instant" })] },
  { name: "single brace inside a deep path", refuse: true, nodes: [goodAsk([goodAsk([sms({ body: "x {a}", delay: "instant" })])])] },
  { name: "settings stored as a string on a text", refuse: true, nodes: [sms("Hello there")] },
  { name: "settings stored as a list on an email", refuse: true, nodes: [{ id: "c", type: "email", title: "E", cfg: ["a"] }] },
  { name: "settings stored as a number on a note", refuse: true, nodes: [{ id: "c", type: "record", title: "R", cfg: 5 }] },
  { name: "settings stored as true on a note", refuse: true, nodes: [{ id: "c", type: "record", title: "R", cfg: true }] },
  { name: "wait with no unit", refuse: true, nodes: [wait({ amount: "2" })] },
  { name: "wait in weeks", refuse: true, nodes: [wait({ amount: "2", unit: "weeks" })] },
  { name: "wait of ''", refuse: true, nodes: [wait({ amount: "", unit: "days" })] },
  { name: "wait of '0'", refuse: true, nodes: [wait({ amount: "0", unit: "days" })] },
  { name: "wait of '0.0'", refuse: true, nodes: [wait({ amount: "0.0", unit: "days" })] },
  { name: "wait of '-1'", refuse: true, nodes: [wait({ amount: "-1", unit: "days" })] },
  { name: "wait of 'soon'", refuse: true, nodes: [wait({ amount: "soon", unit: "days" })] },
  { name: "wait of '1,5'", refuse: true, nodes: [wait({ amount: "1,5", unit: "days" })] },
  { name: "wait of '5abc'", refuse: true, nodes: [wait({ amount: "5abc", unit: "days" })] },
  { name: "wait of 'Infinity'", refuse: true, nodes: [wait({ amount: "Infinity", unit: "days" })] },
  { name: "wait of '1e400' (too large to be a number)", refuse: true, nodes: [wait({ amount: "1e400", unit: "days" })] },
  { name: "wait of '0x0'", refuse: true, nodes: [wait({ amount: "0x0", unit: "days" })] },
  { name: "wait of 0 as a JSON number", refuse: true, nodes: [wait({ amount: 0, unit: "days" })] },
  { name: "wait of -2 as a JSON number", refuse: true, nodes: [wait({ amount: -2, unit: "days" })] },
  { name: "wait of false", refuse: true, nodes: [wait({ amount: false, unit: "days" })] },
  { name: "wait of null", refuse: true, nodes: [wait({ amount: null, unit: "days" })] },
  { name: "wait with no amount", refuse: true, nodes: [wait({ unit: "days" })] },
  { name: "a question with a number to check", refuse: true, nodes: [ask({ field: 7, op: "is true" }, [{ label: "Y", nodes: [] }, { label: "N", nodes: [] }])] },
  { name: "a question with a blank thing to check", refuse: true, nodes: [ask({ field: "  ", op: "is true" }, [{ label: "Y", nodes: [] }, { label: "N", nodes: [] }])] },
  { name: "a question with no settings", refuse: true, nodes: [{ id: "c", type: "condition", title: "Q", branches: [{ label: "Y", nodes: [] }] }] },
  { name: "a question with no paths", refuse: true, nodes: [{ id: "c", type: "condition", title: "Q", cfg: { field: "x", op: "is true" } }] },
  { name: "a question with an empty list of paths", refuse: true, nodes: [ask({ field: "x", op: "is true" }, [])] },
  { name: "a question whose path steps are a string", refuse: true, nodes: [ask({ field: "x", op: "is true" }, [{ label: "Y", nodes: "none" }, { label: "N", nodes: [] }])] },
  { name: "a question whose path has no steps list", refuse: true, nodes: [ask({ field: "x", op: "is true" }, [{ label: "Y" }, { label: "N", nodes: [] }])] },
  { name: "a question whose path is a number", refuse: true, nodes: [ask({ field: "x", op: "is true" }, [5, { label: "N", nodes: [] }])] },
  { name: "a move with a number for the stage", refuse: true, nodes: [{ id: "c", type: "stage", title: "S", cfg: { stage: 5, pipeline: "Sales" } }] },
  { name: "a move with a blank pipeline", refuse: true, nodes: [{ id: "c", type: "stage", title: "S", cfg: { stage: "Booked", pipeline: " " } }] },
  { name: "a move with no settings", refuse: true, nodes: [{ id: "c", type: "stage", title: "S" }] },
  { name: "a step with no type", refuse: true, nodes: [{ id: "c", title: "T", cfg: {} }] },
  { name: "a step with a blank type", refuse: true, nodes: [{ id: "c", type: " ", title: "T", cfg: {} }] },
  { name: "a step with a number for a type", refuse: true, nodes: [{ id: "c", type: 5, title: "T", cfg: {} }] },
  { name: "a step of a kind nothing renders", refuse: true, nodes: [{ id: "c", type: "teleport", title: "T", cfg: {} }] },
  { name: "a step that is a number", refuse: true, nodes: [7] },
  { name: "a step that is a list", refuse: true, nodes: [[1, 2]] },
  { name: "a step that is null", refuse: true, nodes: [null] },
  { name: "a bad wait inside a deep path", refuse: true, nodes: [goodAsk([goodAsk([wait({ amount: "0", unit: "days" })])])] },
  { name: "a step of a kind nothing renders after good ones", refuse: true, nodes: [...GOOD_STEPS, { id: "c", type: "teleport", title: "T", cfg: {} }] },
];

test("journeys Apply to code: for every crafted journey the saved-row check refuses exactly what api/journeys.mjs refuses", () => {
  assert.ok(CORPUS.length >= 60);
  const wrong = [];
  for (const entry of CORPUS) {
    const product = findBadSteps(entry.nodes).length > 0 || findSingleBraceTagsInNodes(entry.nodes).length > 0;
    if (product !== entry.refuse) wrong.push(`${entry.name}: the corpus says refuse=${entry.refuse}, the product says ${product}`);
    const got = counts([J], (s) => s.insert(J, journey({ nodes: entry.nodes })), journeysApplySql());
    if (got.sample_count !== 1) wrong.push(`${entry.name}: the journey was not a sample`);
    if ((got.bad_count === 1) !== product) wrong.push(`${entry.name}: the product ${product ? "refuses" : "allows"} it, the SQL says ${got.bad_count === 1 ? "bad" : "fine"}`);
  }
  assert.deepEqual(wrong, []);
});

test("journeys Apply to code: two bad steps in one journey are one bad journey, and two journeys count twice", () => {
  const got = counts([J], (s) => {
    s.insert(J, journey({ key: "client", nodes: [wait({ amount: "0", unit: "days" }), { id: "c2", type: "teleport", title: "T", cfg: {} }] }));
    s.insert(J, journey({ key: "setter", name: "Setter", nodes: [sms({ body: "{a}", delay: "instant" })] }));
    s.insert(J, journey({ key: "closer", name: "Closer" }));
  }, journeysApplySql());
  assert.deepEqual(got, { sample_count: 3, bad_count: 2 });
});

test("journeys Apply to code: a saved single-brace tag next to a good double-brace tag is still caught, a clean one is not", () => {
  const brace = (body) => withBadStepTop({ id: "z", type: "sms", title: "S", cfg: { body, delay: "instant" } });
  const run = (body) => counts([J], (s) => s.insert(J, brace(body)), journeysApplySql());
  assert.equal(run("Hi {{first_name}} reply STOP").bad_count, 0);
  assert.equal(run("Hi {{ first_name }} and {{survey_link}}").bad_count, 0);
  assert.equal(run("Hi {{first_name}} and {survey_link}").bad_count, 1);
  assert.equal(run("{first_name}").bad_count, 1);
});

// ───────────────────────── lenders.html ─────────────────────────

const L = "lenders";
const O = "lender_bureau_observations";

function lender(over = {}) {
  return {
    id: id("lender"), org_id: ORG, lender_table: "OnlineBizCC", name: `Mesa Community Bank ${counter}`,
    external_row_id: null, last_updated_by: "Jordan Blake", last_updated_date: "2026-10-12",
    created_at: RECENT, updated_at: RECENT, is_demo: false, active: true, ...over,
  };
}

const cleanAdd = () => [
  [L, lender()],
  [L, lender({ lender_table: "PersonalCC" })],
  // never counted: imported rows, other company, demo, too old
  [L, lender({ external_row_id: "rec1", last_updated_by: null, last_updated_date: null })],
  [L, lender({ org_id: OTHER_ORG, name: "", last_updated_by: null })],
  [L, lender({ is_demo: true, name: "", last_updated_by: null })],
  [L, lender({ created_at: OLD, updated_at: OLD, name: "Old Hand Made Bank", last_updated_by: null })],
];

const one = (table, row) => [[table, row]];

conditionTest({
  title: "lenders Add blank row",
  tables: [L],
  sqlOf: (o) => lendersAddSql(o),
  names: LENDER_ADD_BAD.map(([name]) => name),
  clean: cleanAdd,
  bads: {
    "a hand-made lender has no name": [one(L, lender({ name: "   " }))],
    "a hand-made lender has nobody's name on it": [one(L, lender({ last_updated_by: "" })), one(L, lender({ last_updated_by: null }))],
    "a hand-made lender has no stamp date": [one(L, lender({ last_updated_date: null }))],
    "the same lender was made twice by hand in one product table": [[
      [L, lender({ name: "Desert First Bank", lender_table: "BizLOC_Stated" })],
      [L, lender({ name: "  desert first BANK ", lender_table: "BizLOC_Stated" })],
    ]],
  },
});

test("lenders Add blank row: the same name in two different product tables is two lenders, not a double press", () => {
  const got = counts([L], (s) => {
    s.insert(L, lender({ name: "Same Name Bank", lender_table: "OnlineBizCC" }));
    s.insert(L, lender({ name: "Same Name Bank", lender_table: "PersonalCC" }));
  }, lendersAddSql());
  assert.equal(got.bad_count, 0);
  assert.equal(got.sample_count, 2);
});

const cleanImport = () => [
  [L, lender({ external_row_id: "rec-a", name: "Chase Bank", last_updated_by: "csv" })],
  [L, lender({ external_row_id: "rec-b", name: "Wells Fargo", typical_approval_range: 25000, last_updated_by: "Jordan Blake" })],
  [L, lender({ external_row_id: "rec-c", name: "Old Import Bank", updated_at: OLD, created_at: OLD, last_updated_by: null })],
  [L, lender({ org_id: OTHER_ORG, external_row_id: "rec-d", name: "", last_updated_by: null })],
  [L, lender({ external_row_id: "rec-e", is_demo: true, name: "Apply here for it", last_updated_by: null })],
  // a paste with no row id column lands with no row id, like a lender made by hand: it is judged too, and this one is clean
  [L, lender({ external_row_id: null, name: "Pasted Bank With No Row Id", last_updated_by: "Jordan Blake" })],
];

conditionTest({
  title: "lenders Import now",
  tables: [L],
  sqlOf: (o) => lendersImportSql(o),
  names: LENDER_IMPORT_BAD.map(([name]) => name),
  clean: cleanImport,
  bads: {
    "an imported lender has no name": [one(L, lender({ external_row_id: "rec-1", name: "" })), one(L, lender({ external_row_id: null, name: "  " }))],
    "an imported lender has an empty row id, so a re-import cannot find it": [one(L, lender({ external_row_id: "  " })), one(L, lender({ external_row_id: "" }))],
    "an imported lender has nobody's name on it": [
      one(L, lender({ external_row_id: "rec-2", last_updated_by: " " })),
      one(L, lender({ external_row_id: null, last_updated_by: null })),
    ],
    "an imported lender has no stamp date": [one(L, lender({ external_row_id: "rec-3", last_updated_date: null })), one(L, lender({ external_row_id: null, last_updated_date: null }))],
    // every prefix the product's isTipRow knows, with and without a row id, then the length rule
    "a tip from the spreadsheet was saved as a bank": [
      ...PRODUCT_TIP_PREFIXES.map((prefix, i) => one(L, lender({ external_row_id: i % 2 ? null : `rec-tip-${i}`, name: `${prefix}${prefix.endsWith(" ") ? "" : " "}in branch for the offer` }))),
      one(L, lender({ external_row_id: "rec-6", name: "A".repeat(73) })),
      one(L, lender({ external_row_id: null, name: "NOTE: ask for the business desk" })),
    ],
    "an imported lender has a dollar amount below zero": [
      one(L, lender({ external_row_id: "rec-7", typical_approval_range: -5 })),
      one(L, lender({ external_row_id: null, average_starting_loc: -100 })),
      one(L, lender({ external_row_id: "rec-9", max_known_loc: -1 })),
      one(L, lender({ external_row_id: "rec-8", minimum_deposit: -1 })),
    ],
  },
});

test("lenders Import now: the SQL carries exactly the prefixes the product's isTipRow carries", () => {
  assert.equal(PRODUCT_TIP_PREFIXES.length, 15);
  assert.deepEqual([...TIP_PREFIXES], PRODUCT_TIP_PREFIXES);
  const sql = lendersImportSql();
  for (const prefix of PRODUCT_TIP_PREFIXES) assert.ok(sql.includes(`LIKE '${prefix}%'`), `the SQL tests for "${prefix}"`);
});

test("lenders Import now: the tip rule is the product's own isTipRow, name for name", () => {
  const names = [
    ...PRODUCT_TIP_PREFIXES.flatMap((p) => [`${p}here`, `${p.toUpperCase()}here`]),
    // look-alikes that are banks
    "Applewood Community Bank", "Ifrit Bank", "Same-Day Capital", "Canyon Credit Union", "Visitor Savings", "Opening Bank",
    "Whenever Bank", "Useful Bank", "Mustang Bank", "Callbox Capital", "Waiting Room Bank", "Donot Bank", "Notes Bank", "Amex Often",
    "A".repeat(72), "A".repeat(73), "Chase Bank", "Wells Fargo",
  ];
  for (const name of names) {
    const got = counts([L], (s) => s.insert(L, lender({ external_row_id: "rec-t", name, last_updated_by: "Jordan Blake" })), lendersImportSql());
    assert.equal(got.sample_count, 1, name);
    assert.equal(got.bad_count, isTipRow(name) ? 1 : 0, `"${name}": the SQL and isTipRow must agree`);
  }
});

test("lenders Import now: each of the four dollar columns is judged, a zero or a blank is not below zero", () => {
  for (const column of ["typical_approval_range", "average_starting_loc", "max_known_loc", "minimum_deposit"]) {
    const run = (value) => counts([L], (s) => s.insert(L, lender({ external_row_id: "rec-m", [column]: value })), lendersImportSql());
    assert.equal(run(-0.01).bad_count, 1, `${column} below zero`);
    assert.equal(run(0).bad_count, 0, `${column} at zero`);
    assert.equal(run(null).bad_count, 0, `${column} unknown is not a wrong number`);
    assert.equal(run(25000).bad_count, 0, `${column} above zero`);
  }
});

const obs = (over = {}) => ({
  id: id("obs"), org_id: ORG, lender_name: "Mesa Community Bank", lender_table: "OnlineBizCC", lender_row_id: null,
  expected_bureaus_raw: "EX", observed_bureau: "TU", observation_source: "crs_pull", mismatch_flag: true,
  review_status: "confirmed", created_by: "Jordan Blake", ...over,
});

function reviewedTest(title, status, sqlOf, bad) {
  const cleanReview = () => [
    [L, lender({ id: "lender-ok", name: "Mesa Community Bank", external_row_id: "rec-x" })],
    [O, obs({ review_status: status, lender_row_id: "lender-ok" })],
    [O, obs({ review_status: status, lender_row_id: null, lender_name: "A Bank Not On The Book" })],
    // never counted: other statuses, other company
    [O, obs({ review_status: "pending", mismatch_flag: false, observed_bureau: "", created_by: null })],
    [O, obs({ review_status: "dismissed", mismatch_flag: false, observed_bureau: "", created_by: null })],
    [O, obs({ org_id: OTHER_ORG, review_status: status, mismatch_flag: false, created_by: null })],
  ];
  const names = bad.map(([name]) => name);
  const key = (suffix) => names.find((n) => n.includes(suffix));
  conditionTest({
    title,
    tables: [L, O],
    sqlOf,
    names,
    clean: cleanReview,
    bads: {
      [key("never flagged")]: [one(O, obs({ review_status: status, mismatch_flag: false, lender_name: "Flag Bank" }))],
      [key("no bureau was seen")]: [one(O, obs({ review_status: status, observed_bureau: " ", lender_name: "Bureau Bank" }))],
      [key("names no lender")]: [one(O, obs({ review_status: status, lender_name: null, lender_row_id: null }))],
      [key("another company")]: [[
        [L, lender({ id: "lender-other", org_id: OTHER_ORG, name: "Other Co Bank" })],
        [O, obs({ review_status: status, lender_row_id: "lender-other", lender_name: "Other Co Bank" })],
      ]],
      [key("no person on it")]: [one(O, obs({ review_status: status, created_by: "", lender_name: "Nobody Bank" }))],
    },
  });
}

reviewedTest("lenders Mismatch queue Confirm", "confirmed", (o) => mismatchConfirmSql(o), MISMATCH_CONFIRM_BAD);
reviewedTest("lenders Mismatch queue Corrected", "corrected", (o) => mismatchCorrectSql(o), MISMATCH_CORRECT_BAD);

test("Confirm and Corrected each judge only their own status", () => {
  const seed = (s) => {
    s.insert(O, obs({ review_status: "confirmed", mismatch_flag: false, lender_name: "A" }));
    s.insert(O, obs({ review_status: "corrected", lender_name: "B" }));
  };
  assert.deepEqual(counts([L, O], seed, mismatchConfirmSql()), { sample_count: 1, bad_count: 1 });
  assert.deepEqual(counts([L, O], seed, mismatchCorrectSql()), { sample_count: 1, bad_count: 0 });
});
