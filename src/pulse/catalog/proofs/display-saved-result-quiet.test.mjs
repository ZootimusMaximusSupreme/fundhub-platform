// The first-batch record and staff controls wait for their first real result (owner rule 2026-10-14,
// applied 2026-10-20). Green with "no saved results yet" when nobody has used the control, red on the
// first wrong result, and the compiled catalog the live lane reads carries the same rule.
import test from "node:test";
import assert from "node:assert/strict";

import catalog from "../generated.json" with { type: "json" };
import { DISPLAY_RESULT_CONTRACTS } from "./display-saved-result.mjs";
import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";

const QUIET_CONTROLS = Object.freeze([
  "Mark round submitted button",
  "Close round button",
  "Lender row: Approved $ amount input",
  "Lender row: Approved button",
  "Lender row: Declined button",
  "Lender row: Doesn't count / Count again button (exclude or reinstate an approval, asks for a reason)",
  "Suggestion buttons (3: due this week, which card first, got declined paste the letter)",
  "Wording list: click a row to edit it",
  "PDF editor: Save boxes",
  "Save these answers button (needs at least one answer)",
]);

const contractFor = (control) => DISPLAY_RESULT_CONTRACTS.find((entry) => entry.control === control);

test("each first-batch record and staff control is a live query that waits for its first result", () => {
  for (const control of QUIET_CONTROLS) {
    const contract = contractFor(control);
    assert.ok(contract, `${control} has a contract`);
    assert.equal(contract.mode, "query", control);
    assert.equal(contract.emptyAs, "quiet", control);
    assert.match(contract.sql, /sample_count/, control);
    assert.match(contract.sql, /bad_count/, control);
  }
});

test("no saved result yet is green and says so; the first wrong result is red", () => {
  for (const control of QUIET_CONTROLS) {
    const entry = { id: `t:${control}`, control, contract: contractFor(control) };
    const empty = judgeDisplayResult(entry, { sample_count: 0, bad_count: 0 });
    assert.equal(empty.status, "PASS", control);
    assert.match(empty.detail, /no saved results yet/, control);
    const wrong = judgeDisplayResult(entry, { sample_count: 3, bad_count: 1 });
    assert.equal(wrong.status, "FAIL", control);
    assert.match(wrong.detail, /1 of 3 saved results failed/, control);
    const right = judgeDisplayResult(entry, { sample_count: 3, bad_count: 0 });
    assert.equal(right.status, "PASS", control);
  }
});

test("without the quiet rule an empty control is still red, so the rule is what turns it green", () => {
  const contract = { ...contractFor("Close round button"), emptyAs: undefined };
  const result = judgeDisplayResult({ id: "t:close", control: contract.control, contract }, { sample_count: 0, bad_count: 0 });
  assert.equal(result.status, "FAIL");
  assert.match(result.detail, /no saved receipt or linked result exists/);
});

test("the compiled catalog the live lane reads carries the quiet rule for every one of them", () => {
  for (const control of QUIET_CONTROLS) {
    const rows = catalog.displayResultCases.filter((entry) => entry.control === control);
    assert.ok(rows.length >= 1, `${control} is in generated.json`);
    for (const row of rows) assert.equal(row.contract?.emptyAs, "quiet", row.id);
  }
});

test("Mark round submitted leaves demo-seed events out, like every other check", () => {
  const sql = contractFor("Mark round submitted button").sql;
  assert.match(sql, /COALESCE\(is_demo, false\) = false/);
  const compiled = catalog.displayResultCases.find((entry) => entry.control === "Mark round submitted button");
  assert.match(compiled.contract.sql, /COALESCE\(is_demo, false\) = false/);
});
