import test from "node:test";
import assert from "node:assert/strict";
import * as beat from "./beat-lender-book.mjs";
import * as truth from "./lib/lenders-truth.mjs";
import * as libMatch from "./lib/lender-match.mjs";
import * as libTables from "./lib/lender-tables.mjs";
import * as credit from "./lib/lenders-credit.mjs";
import * as demoMode from "./lib/org-demo-mode.mjs";
import * as lane from "../coverage/gap-crm-links.mjs";
import * as store from "../../lenders/store.mjs";
import * as productMatch from "../../lenders/match.mjs";
import * as productTables from "../../lenders/tables.mjs";
import * as resolveLogo from "../../lenders/resolve-logo.mjs";
import * as clientDetail from "../../http/client-detail.mjs";
import * as crsMap from "../../finance/crs-map.mjs";
import * as excludeDemo from "../../demo/exclude-demo.mjs";
import { checkBeatSelfTest, runBeat, validateBeat } from "./contract.mjs";
import { ctxLog, makeFakeCtx } from "./ctx.mjs";
import { assertReadOnlySql } from "./readbox.mjs";
import { SELF_TEST_NOW, SELF_TEST_ORG } from "./lib/money-hourly.mjs";
import { TRIPWIRES } from "../tripwires.mjs";

const at = (read) => ({ now: new Date(SELF_TEST_NOW.getTime()), read, env: {}, http: {} });
const run = (opts) => runBeat(beat, makeFakeCtx(beat, at(beat.selfTestRead(opts))));
/* The bank match reads the active book; the desk list check reads five rows with no active filter. */
const ACTIVE_LIST = /FROM lenders WHERE org_id = \$1::uuid AND active = \$2/;
/* Any lender list read (not the book count). */
const LIST = /FROM lenders WHERE .* ORDER BY priority_tier/;

test("lender-book is valid, green on a healthy book, red at crm-data-lenders when the book is empty", async () => {
  assert.deepEqual(validateBeat(beat, { file: "beat-lender-book.mjs" }), []);
  assert.deepEqual(await checkBeatSelfTest(beat), []);
  const passCtx = makeFakeCtx(beat, beat.selfTest.pass());
  const passed = await runBeat(beat, passCtx);
  assert.equal(passed.ok, true, passed.detail);
  assert.equal(passed.detail, "2 lender book checks passed");
  assert.deepEqual(ctxLog(passCtx).refused, []);
  const failed = await runBeat(beat, makeFakeCtx(beat, beat.selfTest.fail()));
  assert.equal(failed.ok, false);
  assert.equal(failed.step, "crm-data-lenders");
  assert.match(failed.detail, /the bank book is empty/);
});

test("lender-book: each break goes red at the step a customer would feel", async () => {
  const cases = [
    // Banks on file, but the desk list read comes back empty.
    [{ swap: (sql) => (LIST.test(sql) ? [] : undefined) }, "crm-data-lenders", /3 banks are on file and the bank list read came back empty/],
    // The desk list read throws (a renamed column).
    [{ swap: (sql) => { if (LIST.test(sql)) throw new Error('column "apr_terms" does not exist'); } }, "crm-data-lenders", /the bank list read threw: column "apr_terms" does not exist/],
    // The client the match runs for is gone.
    [{ swap: (sql) => (/SELECT id, custom_fields FROM clients/.test(sql) ? [] : undefined) }, "crm-data-lender-matches", /the bank match read says there is no such client/],
    // Banks on file, but the match reads an empty book.
    [{ swap: (sql) => (ACTIVE_LIST.test(sql) ? [] : undefined) }, "crm-data-lender-matches", /banks are on file but the client match read says the bank book is empty/],
    // The match read throws.
    [{ swap: (sql) => { if (/FROM inquiry_log/.test(sql)) throw new Error("relation \"inquiry_log\" does not exist"); } }, "crm-data-lender-matches", /the bank match read threw/],
    // The client pick fails: red, not skipped.
    [{ swap: (sql) => { if (/gap:crm-client \*\//.test(sql)) throw new Error("canceling statement due to statement timeout"); } }, "crm-data-lender-matches", /could not pick a client/]
  ];
  for (const [opts, step, re] of cases) {
    const result = await run(opts);
    assert.equal(result.ok, false, String(re));
    assert.equal(result.step, step, String(re));
    assert.match(result.detail, re);
  }
});

test("lender-book: no client on file is nothing to judge for the match, never green and never red", async () => {
  const result = await run({ client: false });
  assert.equal(result.ok, true, result.detail);
  assert.deepEqual(result.skipped.map((s) => s.name || s), ["crm-data-lender-matches"]);
  assert.match(result.detail, /1 lender book checks passed; 1 had nothing safe to judge/);
});

test("lender-book: every read is a plain SELECT the read box takes whole, run for the default company", async () => {
  const ctx = makeFakeCtx(beat, beat.selfTest.pass());
  await runBeat(beat, ctx);
  const reads = ctxLog(ctx).reads;
  assert.ok(reads.length >= 10, `only ${reads.length} reads`);
  for (const { sql } of reads) assert.equal(assertReadOnlySql(sql), sql);
  const count = reads.filter((r) => r.sql === truth.LENDER_COUNT_SQL);
  assert.equal(count.length, 2, "the book count is read for the book check and again for the match check, as the lane does");
  for (const r of count) assert.deepEqual(r.params, [SELF_TEST_ORG]);
  assert.deepEqual(reads.find((r) => r.sql === truth.CLIENT_PICK_SQL).params, [SELF_TEST_ORG]);
});

test("lender-book: one copy. The product code and the morning lane run the very same functions", () => {
  // The lender reads and the matcher.
  assert.equal(store.listLenders, truth.listLenders);
  assert.equal(store.matchForClient, truth.matchForClient);
  assert.equal(store.publicLender, truth.publicLender);
  assert.equal(store.matchLenders, libMatch.matchLenders);
  for (const name of Object.keys(libMatch)) assert.equal(productMatch[name], libMatch[name], name);
  for (const name of Object.keys(libTables)) assert.equal(productTables[name], libTables[name], name);
  assert.equal(resolveLogo.logoPathOrPlaceholder, truth.logoPathOrPlaceholder);
  assert.equal(resolveLogo.LENDER_LOGO_PLACEHOLDER, truth.LENDER_LOGO_PLACEHOLDER);
  // The credit-file readers the match screens on.
  assert.equal(clientDetail.triMerge, credit.triMerge);
  assert.equal(clientDetail.utilisation, credit.utilisation);
  assert.equal(clientDetail.isSampleResult, credit.isSampleResult);
  assert.equal(clientDetail.UTILISATION_BANDS, credit.UTILISATION_BANDS);
  assert.equal(crsMap.pickCreditScore, credit.pickCreditScore);
  assert.equal(excludeDemo.orgDemoModeEnabled, demoMode.orgDemoModeEnabled);
  // The morning lane's SQL.
  assert.equal(lane.LENDER_COUNT_SQL, truth.LENDER_COUNT_SQL);
  assert.equal(lane.CLIENT_PICK_SQL, truth.CLIENT_PICK_SQL);
});

test("lender-book: the morning lane and the beat give the same two rows for the same database", async () => {
  const scenarios = [
    {},
    { bankCount: 0, banks: [] },
    { client: false },
    { swap: (sql) => (ACTIVE_LIST.test(sql) ? [] : undefined) }
  ];
  for (const opts of scenarios) {
    const read = beat.selfTestRead(opts);
    const db = { query: (sql, params) => read(sql, params) };
    const hourly = await truth.readLenderBook({ db, orgId: SELF_TEST_ORG });
    const morning = await lane.gapChecks({
      db, orgId: SELF_TEST_ORG, now: SELF_TEST_NOW, sources: [], fetchImpl: async () => ({ status: 200, text: async () => "" }),
      crmReaders: { listLenders: store.listLenders, matchForClient: store.matchForClient, listTradelines: async () => [], readClientStepRows: async () => ({ client: {} }) }
    });
    for (const row of hourly) assert.deepEqual(morning.find((m) => m.id === row.id), row, JSON.stringify(opts));
  }
});

test("lender-book: the surface it covers has every named deep check run here", () => {
  for (const surface of beat.covers) {
    const wire = TRIPWIRES[surface];
    assert.ok(wire, `${surface} is not a tripwire`);
    for (const checkId of wire.checks) assert.ok(beat.HOURLY_CHECK_IDS.includes(checkId), `${surface} needs ${checkId}`);
  }
  assert.deepEqual(beat.covers, ["desk:money-banks.html"]);
  // desk:lenders.html also needs apply-links and bureau-config:complete, which run elsewhere, so it stays off.
  assert.ok(!beat.covers.includes("desk:lenders.html"));
});
