// Practice test (fake data, a stand-in database, the REAL page writer) for the Marketing Command Center row
//   "Ideas funnels: 'Write the pages' / 'Write the pages again' (one model call, copy check)".
//
// The live check on this row reads the saved pages (their tag, tracking and the shape of their words). It
// cannot read the part the button promises most: that words the copy check REFUSED are never saved. The
// job's own `checks: "passed"` is a constant (funnel-build.mjs summary() writes it on every finished job),
// so nothing saved can show a skipped check. That is judged here by running the real job, src/marketing/
// funnel-build.mjs run(), against a fake model:
//
//   - an answer the copy check refuses, twice running, fails the job with the reasons and SAVES NOTHING
//     (no page row is updated), and the model was called exactly twice (MAX_WRITE_ROUNDS);
//   - a refused first answer followed by a clean second answer saves the second answer, never the first;
//   - a clean answer is saved on the first round, with one call logged to the usage ledger and every page
//     carrying its tag, its tracking config, its pixel and both tracking scripts (trackingGaps is empty).
//
// Breaks made on purpose (each alone, then put back): `if (check.ok)` made `if (true)` saves a refused
// answer (the second test goes red); the saved copy taken from the first answer instead of the one that
// passed (the third goes red); the page save skipped (the first goes red).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { run } from "../../../marketing/funnel-build.mjs";
import { trackingGaps } from "../../../marketing/funnel-tracking.mjs";
import { formatCents, OFFERS } from "../../../config/offers.mjs";
import { fakeDb } from "../../../testing/handler-harness.mjs";
import { REPO_ROOT } from "./fin-b15-sql-kit.mjs";

const ORG = "0a000000-0000-4000-8000-000000000001";
const FUNNEL = "0f000000-0000-4000-8000-000000000001";
const JOB = "0e000000-0000-4000-8000-000000000001";
const GOOD = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "src/marketing/fixtures/funnel-copy-good.json"), "utf8"));
const PRICE = OFFERS.UWIQ_DELIVERABLES.priceCents;

const funnelRow = {
  id: FUNNEL, org_id: ORG, key: "blueprint", kind: "book_a_call", path: "/blueprint", tag: "fnl-blueprint",
  offer_key: "capital_blueprint", lane: "uwiq", campaign: null, status: "draft", status_note: null
};
const pageRows = ["landing", "booking", "thank_you"].map((role, i) => ({
  id: `0d000000-0000-4000-8000-00000000000${i + 1}`, org_id: ORG, funnel_id: FUNNEL, role, position: i,
  path: role === "landing" ? "/blueprint" : role === "booking" ? "/blueprint-book" : "/blueprint-thank-you",
  html: null, cf_page_id: null, build_job_id: null
}));

/** The database the writer sees: the funnel, its three pages, the cap, and a ledger that answers a saved row. */
function database() {
  const saves = [];
  const usage = [];
  const db = fakeDb([
    [/FROM marketing_funnels WHERE id/, () => [funnelRow]],
    [/FROM marketing_funnel_pages WHERE funnel_id/, () => pageRows],
    [/SELECT max_month_cost_usd FROM marketing_settings/, () => [{ max_month_cost_usd: 300 }]],
    [/WITH bounds AS/, () => [{
      month_priced_usd: 0, month_null_input: 0, month_null_output: 0, month_null_cache_read: 0, month_null_cache_write: 0,
      batch_priced_usd: 0, batch_null_input: 0, batch_null_output: 0, batch_null_cache_read: 0, batch_null_cache_write: 0,
      unpriced_rows: 0
    }]],
    [/INSERT INTO marketing_model_usage/, (sql, params) => {
      usage.push(params);
      return [{ id: `usage-${usage.length}`, cost_usd: "0.050000", model: params[3] }];
    }],
    [/UPDATE marketing_funnel_pages\s+SET page_copy/, (sql, params) => {
      saves.push({ pageId: params[0], copy: JSON.parse(params[1]), html: params[2], jobId: params[4] });
      return [{ id: params[0] }];
    }]
  ]);
  return { db, saves, usage };
}

const key = ["test", "not", "a", "real", "key"].join("-");
const sources = () => ({ avatar: "", offer: "", copy: "", ownerNotes: "", files: {} });
const usageOf = () => ({ input_tokens: 4000, output_tokens: 3000 });

/** A model that answers the given copy objects in order, and counts its calls. */
function model(answers) {
  const calls = [];
  const callModel = async (args) => {
    calls.push(args);
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)];
    return { mode: "live", usage: usageOf(), json: structuredClone(answer), servedModel: "claude-opus-5-5" };
  };
  return { callModel, calls };
}

const job = { id: JOB, org_id: ORG, payload: { funnel_id: FUNNEL } };
const ctx = (deps) => ({ db: deps.db, env: { ANTHROPIC_API_KEY: key }, deps: { readSources: sources, now: () => new Date("2026-10-14T19:00:00Z"), ...deps.deps } });

/** Words the copy check refuses: the price is on the page (the call sets the price), and a number the facts do not hold. */
function refused() {
  const c = structuredClone(GOOD);
  c.landing.cta_note = `One plan, ${formatCents(PRICE)}`;
  c.landing.subhead = "Join 437 owners who got their plan.";
  return c;
}

test("a clean answer is saved on the first round: three pages with their tag and tracking, one call logged", async () => {
  const { db, saves, usage } = database();
  const m = model([GOOD]);
  const out = await run(job, ctx({ db, deps: { callModel: m.callModel } }));
  assert.equal(out.checks, "passed");
  assert.equal(out.rounds, 1);
  assert.equal(m.calls.length, 1, "one model call");
  assert.equal(usage.length, 1, "one call in the usage ledger");
  assert.equal(saves.length, 3, "all three pages saved");
  assert.deepEqual(saves.map((s) => s.pageId), pageRows.map((p) => p.id));
  for (const s of saves) {
    assert.equal(s.jobId, JOB);
    assert.deepEqual(trackingGaps(s.html, funnelRow.tag), [], "the page carries its tag, config, pixel and both scripts");
  }
  assert.deepEqual(saves.map((s) => s.copy), [GOOD.landing, GOOD.booking, GOOD.thank_you]);
});

test("an answer the copy check refuses twice running fails the job with the reasons and saves nothing", async () => {
  const { db, saves, usage } = database();
  const m = model([refused(), refused()]);
  await assert.rejects(
    () => run(job, ctx({ db, deps: { callModel: m.callModel } })),
    (error) => {
      assert.equal(error.name, "FunnelJobError");
      assert.match(error.message, /failed the copy check 2 times, so nothing was saved/);
      assert.match(error.message, /puts the price on the page/);
      assert.match(error.message, /437/);
      return true;
    }
  );
  assert.equal(saves.length, 0, "no page was written");
  assert.equal(db.find(/UPDATE marketing_funnel_pages/).length, 0, "no page row was touched");
  assert.equal(m.calls.length, 2, "two rounds and no more");
  assert.equal(usage.length, 2, "both calls are in the usage ledger, so the meter counts them");
  // The second round was told what was wrong with the first.
  assert.match(String(m.calls[1].user), /437/);
});

test("a refused first answer and a clean second answer saves the second one, never the first", async () => {
  const { db, saves, usage } = database();
  const m = model([refused(), GOOD]);
  const out = await run(job, ctx({ db, deps: { callModel: m.callModel } }));
  assert.equal(out.rounds, 2);
  assert.equal(m.calls.length, 2);
  assert.equal(usage.length, 2);
  assert.equal(saves.length, 3);
  assert.deepEqual(saves.map((s) => s.copy), [GOOD.landing, GOOD.booking, GOOD.thank_you]);
  for (const s of saves) assert.ok(!JSON.stringify(s.copy).includes("437"), "nothing of the refused answer was saved");
});

test("a funnel that went live is never rewritten: the job stops before the model is asked", async () => {
  const m = model([GOOD]);
  const live = { ...pageRows[0], cf_page_id: "cf-1" };
  const liveDb = fakeDb([
    [/FROM marketing_funnels WHERE id/, () => [{ ...funnelRow, status: "live" }]],
    [/FROM marketing_funnel_pages WHERE funnel_id/, () => [live, pageRows[1], pageRows[2]]]
  ]);
  await assert.rejects(() => run(job, ctx({ db: liveDb, deps: { callModel: m.callModel } })), /already on ClickFunnels/);
  assert.equal(m.calls.length, 0, "the model was never asked");
  assert.equal(liveDb.find(/UPDATE marketing_funnel_pages/).length, 0, "no page was written");
});
