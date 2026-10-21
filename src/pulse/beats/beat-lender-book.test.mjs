import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as beat from "./beat-lender-book.mjs";
import * as truth from "./lib/crm-lenders-truth.mjs";
import * as copyStore from "./lib/lender-store.mjs";
import * as lane from "../coverage/gap-crm-links.mjs";
import { checkBeatSelfTest, pinBeatSource, runBeat, validateBeat } from "./contract.mjs";
import { makeFakeCtx } from "./ctx.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("lender-book is valid, green on a loaded book, red at crm-data-lenders on an empty one", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-lender-book.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.pass()));
  assert.equal(passed.ok, true);
  assert.equal(passed.detail, "2 bank book checks passed");
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "crm-data-lenders");
  assert.match(failed.detail, /the bank book is empty/);
});

test("lender-book: each check goes red at its own step", async () => {
  const cases = [
    ["crm-data-lenders", { list: [] }, /3 banks are on file and the bank list read came back empty/],
    ["crm-data-lenders", { count: 0 }, /the bank book is empty/],
    // The client the pick found is gone by the time the match read looks for it.
    ["crm-data-lender-matches", { matchClientGone: true }, /no such client/],
    // Every bank was turned off: banks are on file but the match read sees an empty book.
    ["crm-data-lender-matches", { active: [] }, /says the bank book is empty/]
  ];
  for (const [step, over, detail] of cases) {
    const { matchClientGone, ...reads } = over;
    let rules = beat.selfTestReads(reads);
    if (matchClientGone) rules = [{ match: /SELECT id, custom_fields\s+FROM clients/, rows: [] }, ...rules];
    const result = await runBeat(beat, makeFakeCtx(beat, { ...beat.selfTestSpec(), read: rules }));
    assert.equal(result.ok, false, step);
    assert.equal(result.step, step);
    assert.match(result.detail, detail);
  }
});

test("lender-book: a read that throws inside the match read is red at crm-data-lender-matches, never green", async () => {
  const rules = [{ match: /FROM crs_results/, error: 'column "outcome_tier" does not exist' }, ...beat.selfTestReads()];
  const result = await runBeat(beat, makeFakeCtx(beat, { ...beat.selfTestSpec(), read: rules }));
  assert.equal(result.ok, false);
  assert.equal(result.step, "crm-data-lender-matches");
  assert.match(result.detail, /the bank match read threw: column "outcome_tier" does not exist/);
});

test("lender-book: no real client on file is nothing to judge for the match check, never a pass", async () => {
  const result = await runBeat(beat, makeFakeCtx(beat, beat.selfTestSpec({ client: false })));
  assert.equal(result.ok, true);
  assert.equal(result.detail, "1 bank book checks passed; 1 had nothing safe to judge");
  const skipped = result.steps.find((step) => step.name === "crm-data-lender-matches");
  assert.ok(skipped && skipped.skipped, "the match step is skipped, not passed");
});

test("lender-book: picking a client that throws is red, the same as the morning lane", async () => {
  const rules = [{ match: /gap:crm-client\b/, error: 'relation "clients" does not exist' }, ...beat.selfTestReads()];
  const result = await runBeat(beat, makeFakeCtx(beat, { ...beat.selfTestSpec(), read: rules }));
  assert.equal(result.ok, false);
  assert.equal(result.step, "crm-data-lender-matches");
  assert.match(result.detail, /could not pick a client/);
});

test("lender-book: the daily lane and the hourly beat share one SQL and one judge", () => {
  assert.equal(lane.CLIENT_PICK_SQL, truth.CLIENT_PICK_SQL);
  assert.equal(lane.LENDER_COUNT_SQL, truth.LENDER_COUNT_SQL);
  assert.equal(lane.checkLenders, truth.checkLenders);
  assert.equal(lane.checkLenderMatches, truth.checkLenderMatches);
  assert.equal(lane.pickClient, truth.pickClient);
  assert.equal(lane.readLenderCount, truth.readLenderCount);
  for (const checkId of beat.HOURLY_CHECK_IDS) assert.ok(lane.CHECK_IDS.includes(checkId), `${checkId} is a morning lane check`);
  // The beat hands the shared checks the word-for-word copies (held equal by lib/lender-store.test.mjs).
  assert.equal(beat.READERS.listLenders, copyStore.listLenders);
  assert.equal(beat.READERS.matchForClient, copyStore.matchForClient);
});

test("lender-book: the lane and the beat's runner give the same two rows for the same reads", async () => {
  const ORG = "11111111-1111-4111-8111-111111111111";
  const CLIENT = "22222222-2222-4222-8222-222222222222";
  const fakeDb = (answers) => ({
    async query(sql) {
      const key = String(sql);
      if (key in answers) {
        const a = answers[key];
        if (a instanceof Error) throw a;
        return a;
      }
      return { rows: [] };
    }
  });
  const okReaders = {
    listLenders: async () => [{ name: "Bank" }],
    matchForClient: async () => ({ summary: { lender_count: 12, match_count: 3 }, matches: [{}, {}, {}] }),
    listTradelines: async () => [],
    readClientStepRows: async () => ({ client: { id: CLIENT } }),
    orgDemoModeEnabled: async () => false
  };
  const base = { [truth.CLIENT_PICK_SQL]: { rows: [{ id: CLIENT }] }, [truth.LENDER_COUNT_SQL]: { rows: [{ n: 12 }] } };
  const shapes = [
    ["all good", base, okReaders],
    ["no client", { ...base, [truth.CLIENT_PICK_SQL]: { rows: [] } }, okReaders],
    ["pick throws", { ...base, [truth.CLIENT_PICK_SQL]: new Error("clients gone") }, okReaders],
    ["empty book", { ...base, [truth.LENDER_COUNT_SQL]: { rows: [{ n: 0 }] } }, okReaders],
    ["count throws", { ...base, [truth.LENDER_COUNT_SQL]: new Error("lenders gone") }, okReaders],
    ["list empty", base, { ...okReaders, listLenders: async () => [] }],
    ["match null", base, { ...okReaders, matchForClient: async () => null }],
    ["match book empty", base, { ...okReaders, matchForClient: async () => ({ summary: { lender_count: 0 }, matches: [] }) }],
    ["match throws", base, { ...okReaders, matchForClient: async () => { throw new Error("pii_identity unreadable"); } }]
  ];
  for (const [name, answers, readers] of shapes) {
    const morning = await lane.gapChecks({ db: fakeDb(answers), orgId: ORG, sources: [], crmReaders: readers });
    const hourly = await truth.runLenderBookChecks({ db: fakeDb(answers), orgId: ORG, readers });
    const pick = (rows) => truth.LENDER_CHECK_IDS.map((checkId) => rows.find((r) => r.id === checkId));
    assert.deepEqual(hourly, pick(morning), name);
  }
  for (const [name, args] of [["no db", { orgId: ORG, readers: okReaders }], ["junk org", { db: fakeDb(base), orgId: "nope", readers: okReaders }]]) {
    const morning = await lane.gapChecks({ ...(args.db ? { db: args.db } : {}), orgId: args.orgId, sources: [], crmReaders: okReaders });
    const hourly = await truth.runLenderBookChecks(args);
    assert.deepEqual(hourly, truth.LENDER_CHECK_IDS.map((checkId) => morning.find((r) => r.id === checkId)), name);
  }
});

test("lender-book: every surface it covers has every named deep check run here", () => {
  assert.ok(beat.covers.length > 0);
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId), `${surface} needs ${checkId}, which this beat does not run`);
  }
});

test("lender-book: the beat and its new library files pass the static pin", () => {
  assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "beat-lender-book.mjs"), "utf8"), { role: "beat" }), []);
  for (const name of ["crm-lenders-truth.mjs", "lender-store.mjs", "lender-match.mjs", "lender-tables.mjs"]) {
    assert.deepEqual(pinBeatSource(fs.readFileSync(path.join(HERE, "lib", name), "utf8"), { role: "lib" }), [], name);
  }
});
