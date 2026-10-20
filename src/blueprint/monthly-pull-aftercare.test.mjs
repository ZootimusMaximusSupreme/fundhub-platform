import { test } from "node:test";
import assert from "node:assert/strict";
import { runBlueprintMonthlyPullAftercare } from "./monthly-pull-aftercare.mjs";

const db = { query() { throw new Error("Unexpected database access"); } };
const defaults = () => ({
  orgId: "org", clientId: "client", crsResultId: "saved-result",
  isBuyer: async () => true,
  verify: async () => ({ ok: true }), seed: async () => ({ ok: true }),
  buildPack: async () => ({ files: [{ name: "roadmap" }], reason: null }),
  persist: async () => ({ stored: [{ id: "document" }], notStored: [], faults: [], unrecognised: [] }),
  store: {}
});

test("successful monthly delivery reports saved files and all completed phases", async () => {
  const out = await runBlueprintMonthlyPullAftercare(db, defaults());
  assert.equal(out.ok, true);
  assert.deepEqual(out.failures, []);
  assert.equal(out.letterPack.documentsStored, 1);
});

for (const phase of ["verify", "seed", "buildPack", "persist"]) {
  test(`a thrown ${phase} failure remains failed while the other delivery phases continue`, async () => {
    const input = defaults();
    input[phase] = async () => { throw new Error(`${phase} failed`); };
    const out = await runBlueprintMonthlyPullAftercare(db, input);
    assert.equal(out.ok, false);
    assert.equal(out.failures.length, 1);
    assert.match(out.failures[0].error, new RegExp(`${phase} failed`));
    if (phase === "verify") assert.equal(out.letterPack.documentsStored, 1);
  });
}

for (const phase of ["verify", "seed"]) {
  test(`a returned ${phase} failure cannot look like a successful monthly refresh`, async () => {
    const input = defaults();
    input[phase] = async () => ({ ok: false, error: "phase returned a failure" });
    assert.equal((await runBlueprintMonthlyPullAftercare(db, input)).ok, false);
  });
}

test("letter engine faults and missing credit results remain red; a genuinely empty healthy pack is allowed", async () => {
  for (const pack of [{ files: [], reason: "engine_error" }, { files: [], engineSkip: "no_crs_result" },
    { files: [], reason: "missing_funding_analysis" }, { ok: false, files: [] }]) {
    assert.equal((await runBlueprintMonthlyPullAftercare(db, { ...defaults(), buildPack: async () => pack })).ok, false);
  }
  const benign = await runBlueprintMonthlyPullAftercare(db, {
    ...defaults(), buildPack: async () => ({ files: [], reason: "empty_pack" })
  });
  assert.equal(benign.ok, true);
});

test("partially lost or unrecognised documents are failures; intentional exclusions stay allowed", async () => {
  for (const persisted of [{ stored: [], faults: [{ reason: "empty_file" }] },
    { stored: [], unrecognised: [{ name: "unknown" }] }, { stored: [], skipped: "missing_args" },
    { stored: [], notStored: [] }]) {
    const out = await runBlueprintMonthlyPullAftercare(db, { ...defaults(), persist: async () => persisted });
    assert.equal(out.ok, false);
    assert.equal(out.letterPack.ok, false);
  }
  const out = await runBlueprintMonthlyPullAftercare(db, {
    ...defaults(), persist: async () => ({ stored: [], notStored: [{ reason: "internal_document", fault: false }] })
  });
  assert.equal(out.ok, true);
});

test("withheld letters stay red while useful analysis files remain saved", async () => {
  for (const letterSkip of ["missing_consumer_name", "missing_home_address"]) {
    const out = await runBlueprintMonthlyPullAftercare(db, {
      ...defaults(), buildPack: async () => ({ files: [{ name: "roadmap" }], letterSkip })
    });
    assert.equal(out.ok, false);
    assert.equal(out.letterPack.documentsStored, 1);
    assert.equal(out.letterPack.letterSkip, letterSkip);
    assert.match(out.failures[0].error, /monthly_letters_withheld/);
  }
});

test("a nonbuyer is skipped without touching credit, checklist or storage", async () => {
  const out = await runBlueprintMonthlyPullAftercare(db, {
    orgId: "org", clientId: "client", isBuyer: async () => false
  });
  assert.equal(out.ok, true);
  assert.equal(out.reason, "not_blueprint_buyer");
});
