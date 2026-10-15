import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { FIN_B01_DISPLAY_RESULT_CONTRACTS } from "./fin-b01-display-contracts.mjs";
import { FIN_B01_STAFF_UI_GROUPS } from "./fin-b01-staff-groups.mjs";
import { DISPLAY_RESULT_CONTRACTS, displaySavedResultContract } from "./display-saved-result.mjs";
import { STAFF_UI_PROOF_CASES } from "./display-batch-staff-ui.mjs";
import { judgeDisplayResult } from "../../coverage/gap-catalog-display.mjs";
import { runContractSql } from "./fin-b01-sql-mini.mjs";
import { missingColumns } from "./fin-b01-schema-scan.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

const byControl = (control) => FIN_B01_DISPLAY_RESULT_CONTRACTS.find((c) => c.control === control);
const PAY = byControl("Authority switch: May take a payment");
const PULL = byControl("Authority switch: May run a soft pull");
const DISC = byControl("Authority: Max discount input (percent)");

// The shape migration 144 seeds and the editor's Save writes.
const authority = (over = {}) => ({ disc: 0, msgcap: 6, pay: false, contract: false, book: true, pull: false, ...over });
const agent = (id, over = {}) => ({ id, org_id: ORG, status: "draft", guardrails: { block: "x", authority: authority() }, ...over });

function run(contract, agents) {
  return runContractSql(contract.sql, { agents }, [ORG]);
}

test("the three contracts own the three controls, are read-only, and only name real columns", () => {
  assert.equal(FIN_B01_DISPLAY_RESULT_CONTRACTS.length, 3);
  for (const contract of FIN_B01_DISPLAY_RESULT_CONTRACTS) {
    assert.equal(contract.mode, "query");
    assert.equal(contract.emptyAs, "quiet");
    assert.ok(contract.requirement.length > 40);
    assert.match(contract.sql, /\/\* display-result:[^*]+ \*\//);
    const out = run(contract, [agent("a1")]);
    assert.deepEqual(missingColumns(out.columns.map((c) => ({ ...c, table: c.table || "agents" }))), [], contract.control);
    assert.deepEqual(out.tables, ["agents"]);
    // the registry the lane reads holds the same object
    assert.ok(DISPLAY_RESULT_CONTRACTS.includes(contract), `${contract.control} is not in the registry`);
    assert.equal(displaySavedResultContract({ control: contract.control }), contract);
  }
  assert.equal(new Set(FIN_B01_DISPLAY_RESULT_CONTRACTS.map((c) => c.sql)).size, 3);
});

test("the staff groups name exact map rows that have a contract, and the spec has a test for each", () => {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/desks-a.json"), "utf8"));
  const specSource = (spec) => fs.readFileSync(path.join(ROOT, spec), "utf8");
  for (const group of FIN_B01_STAFF_UI_GROUPS) {
    for (const spec of group.specs) {
      assert.ok(fs.existsSync(path.join(ROOT, spec)), spec);
      assert.match(specSource(spec), /test\(/);
    }
    for (const control of group.controls) {
      const rows = map.filter((r) => r.surface === group.surface && r.control === control);
      assert.equal(rows.length, 1, control);
      assert.equal(rows[0].impact, "money");
      assert.ok(displaySavedResultContract(rows[0]), `${control} has no contract`);
      const proofCase = STAFF_UI_PROOF_CASES.find((c) => c.control === control);
      assert.ok(proofCase, `${control} is not in the staff proof cases`);
      assert.equal(proofCase.depth, "deep");
      assert.match(proofCase.evidence, /gap-catalog-display\.mjs/);
    }
  }
});

test("good authority blocks are counted and none is bad: seeded, edited, other company, retired and no block", () => {
  const rows = [
    agent("seed", { guardrails: { block: "x", authority: authority({ pay: false, pull: false, disc: 0 }) } }),
    agent("edited", { guardrails: { block: "x", authority: authority({ pay: true, pull: true, disc: 12.5 }) } }),
    agent("full", { guardrails: { authority: authority({ disc: 100 }) } }),
    agent("hundred-point-zero", { guardrails: { authority: { ...authority(), disc: 100.0 } } }),
    agent("no-block", { guardrails: { block: "only text" } }),
    agent("empty", { guardrails: {} }),
    agent("authority-not-object", { guardrails: { authority: "none" } }),
    agent("retired", { status: "retired", guardrails: { authority: authority({ pay: "yes" }) } }),
    agent("other-company", { org_id: OTHER, guardrails: { authority: authority({ pay: "yes", disc: 400 }) } }),
  ];
  for (const contract of FIN_B01_DISPLAY_RESULT_CONTRACTS) {
    const out = run(contract, rows);
    assert.equal(out.sample_count, 4, contract.control);
    assert.equal(out.bad_count, 0, contract.control);
  }
});

test("a payment or soft pull switch that is text, a number or null turns the check red, and an absent key does not", () => {
  for (const [contract, field] of [[PAY, "pay"], [PULL, "pull"]]) {
    for (const value of ["true", "yes", 1, 0, null, [], {}]) {
      const rows = [agent("ok"), agent("bad", { guardrails: { authority: authority({ [field]: value }) } })];
      const out = run(contract, rows);
      assert.equal(out.sample_count, 2, `${field}=${JSON.stringify(value)}`);
      assert.equal(out.bad_count, 1, `${field}=${JSON.stringify(value)}`);
    }
    const missing = authority();
    delete missing[field];
    assert.equal(run(contract, [agent("old", { guardrails: { authority: missing } })]).bad_count, 0);
  }
  // each switch is judged on its own key: a bad pay does not make the pull check red
  const onlyPayBad = [agent("bad", { guardrails: { authority: authority({ pay: "yes" }) } })];
  assert.equal(run(PULL, onlyPayBad).bad_count, 0);
  assert.equal(run(PAY, onlyPayBad).bad_count, 1);
});

test("a maximum discount that is not a number from 0 to 100 turns the check red", () => {
  for (const value of [100.5, 101, 150, 400, -1, -0.5, "15", "abc", true, null, [10]]) {
    const out = run(DISC, [agent("ok"), agent("bad", { guardrails: { authority: authority({ disc: value }) } })]);
    assert.equal(out.sample_count, 2, `disc=${JSON.stringify(value)}`);
    assert.equal(out.bad_count, 1, `disc=${JSON.stringify(value)}`);
  }
  for (const value of [0, 1, 7, 12.5, 99.99, 100]) {
    assert.equal(run(DISC, [agent("fine", { guardrails: { authority: authority({ disc: value }) } })]).bad_count, 0, `disc=${value}`);
  }
});

test("the lane judges them: green with no result yet, green when clean, red on the first wrong one", () => {
  for (const contract of FIN_B01_DISPLAY_RESULT_CONTRACTS) {
    const entry = { id: "x", surface: "agent-editor.html", control: contract.control, contract };
    const none = judgeDisplayResult(entry, run(contract, []));
    assert.equal(none.status, "PASS");
    assert.match(none.detail, /no saved results yet/);
    assert.equal(judgeDisplayResult(entry, run(contract, [agent("a")])).status, "PASS");
  }
  const bad = [agent("a"), agent("b", { guardrails: { authority: authority({ pay: "yes", pull: 1, disc: 150 }) } })];
  for (const contract of FIN_B01_DISPLAY_RESULT_CONTRACTS) {
    const entry = { id: "x", surface: "agent-editor.html", control: contract.control, contract };
    const out = judgeDisplayResult(entry, run(contract, bad));
    assert.equal(out.status, "FAIL", contract.control);
    assert.match(out.detail, /1 of 2/);
  }
});

test("changing the statement changes the answer (a check that cannot go red is refused)", () => {
  const wrong = [agent("bad", { guardrails: { authority: authority({ pay: "yes", disc: 150 }) } })];
  // Drop the boolean test: the text switch is no longer found.
  assert.equal(runContractSql(PAY.sql.replace("<> 'boolean'", "= 'boolean'"), { agents: wrong }, [ORG]).bad_count, 0);
  // Drop the company condition: another company's bad block is counted.
  const other = [agent("other", { org_id: OTHER, guardrails: { authority: authority({ pay: "yes" }) } })];
  assert.equal(run(PAY, other).sample_count, 0);
  assert.equal(runContractSql(PAY.sql.replace("org_id = $1::uuid AND ", ""), { agents: other }, [ORG]).bad_count, 1);
  // Drop the upper bound of the discount: 150 is no longer found.
  const loose = DISC.sql.replace("100([.]0+)?|", "[0-9]{1,3}([.][0-9]+)?|");
  assert.equal(runContractSql(loose, { agents: wrong }, [ORG]).bad_count, 0);
  assert.equal(run(DISC, wrong).bad_count, 1);
  // Drop the retired filter: a retired agent's block is counted.
  const retired = [agent("r", { status: "retired", guardrails: { authority: authority({ pay: "yes" }) } })];
  assert.equal(run(PAY, retired).sample_count, 0);
  assert.equal(runContractSql(PAY.sql.replace(" AND status <> 'retired'", ""), { agents: retired }, [ORG]).bad_count, 1);
});
