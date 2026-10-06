// The next-take table's clock — that it is registered on a daily clock after
// the Meta pull, and that one bad partner cannot end the pass.
//
// NO DATABASE AND NO INNGEST. sweep() takes its partner list and its fill as
// arguments. The rules themselves are proved on recorded Meta days in
// src/ops/watch-curve-diagnosis.test.mjs. What this file cannot prove: that
// asPartner() lets the INSERT through the live row security. That is the
// read-only SQL on ops/workflows/perfect-machine-2026-10-05.md after ship.

import { test, describe } from "node:test";
import assert from "node:assert";

import {
  sweep,
  duePartners,
  SWEEP_CRON,
  SOURCE_WORKFLOW,
  DUE_PARTNERS_SQL,
  watchCurveDiagnosisSweeper
} from "./watch-curve-diagnosis-sweeper.mjs";
import { SWEEP_CRON as META_CRON } from "./meta-campaign-sync-sweeper.mjs";
import { INSIGHT_WINDOW_DAYS } from "../../api/campaigns/sync.mjs";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("the table fills itself every morning", () => {
  test("the sweeper is registered, so something other than a person fills the table", async () => {
    const { functions } = await import("./index.mjs");
    assert.ok(functions.map((fn) => fn.id()).includes("watch-curve-diagnosis-sweeper"),
      "not registered — ad_watch_curve_diagnoses goes back to 0 rows");
  });

  test("it is a daily clock job, with no event to wait for", async () => {
    const { functions } = await import("./index.mjs");
    const fn = functions.find((f) => f.id() === "watch-curve-diagnosis-sweeper");
    const triggers = (fn.opts && fn.opts.triggers) || [];
    assert.deepEqual(triggers.map((t) => t.cron).filter(Boolean), [SWEEP_CRON]);
    assert.deepEqual(triggers.map((t) => t.event).filter(Boolean), []);
    assert.equal(SWEEP_CRON, "30 7 * * *");
  });

  test("it runs after the Meta pull has saved yesterday", () => {
    const [metaMin, metaHour] = META_CRON.split(" ").map(Number);
    const [min, hour] = SWEEP_CRON.split(" ").map(Number);
    assert.ok(hour * 60 + min > metaHour * 60 + metaMin,
      "the fill must run after the 07:00 UTC Meta pull, or it labels yesterday a day late");
  });

  test("the id the registry sees is the id this file exports", () => {
    assert.equal(watchCurveDiagnosisSweeper.opts.id, "watch-curve-diagnosis-sweeper");
    assert.equal(SOURCE_WORKFLOW, "watch-curve-diagnosis-sweeper");
  });

  test("it looks back over the same window the Meta pull refreshes", async () => {
    let seen;
    await sweep({ listPartners: async ({ days }) => { seen = days; return []; } });
    assert.equal(seen, INSIGHT_WINDOW_DAYS);
  });
});

describe("who it fills for", () => {
  test("partners are read across the boundary with the staff scope, by saved video numbers in the window", async () => {
    let usedScope = false;
    const ids = await duePartners({
      days: 28,
      scope: async (fn) => {
        usedScope = true;
        return fn({ query: async (sql, params) => {
          assert.equal(sql, DUE_PARTNERS_SQL);
          assert.deepEqual(params, [28]);
          return { rows: [{ partner_id: A }, { partner_id: null }, { partner_id: B }] };
        } });
      }
    });
    assert.equal(usedScope, true);
    assert.deepEqual(ids, [A, B]);
    assert.match(DUE_PARTNERS_SQL, /FROM ad_metrics_daily/);
    assert.match(DUE_PARTNERS_SQL, /video_plays IS NOT NULL/);
  });
});

describe("one partner's failure never stops the others", () => {
  test("a partner that throws is recorded, and the rest still fill", async () => {
    const tried = [];
    const out = await sweep({
      listPartners: async () => [A, B],
      fill: async ({ partnerId }) => {
        tried.push(partnerId);
        if (partnerId === A) throw new Error("row security said no");
        return { checked: 9, written: 9, opening: 9, middle: 0, ask: 0, hop: 0 };
      }
    });
    assert.deepEqual(tried, [A, B]);
    assert.equal(out.filled, 1);
    assert.equal(out.written, 9);
    assert.equal(out.ok, false);
    assert.equal(out.errored[0].partner_id, A);
    assert.match(out.errored[0].error, /row security/);
  });

  test("not even the partner list → ok:false with the reason, never '0 partners, all fine'", async () => {
    const out = await sweep({ listPartners: async () => { throw new Error("db down"); } });
    assert.equal(out.ok, false);
    assert.match(out.error, /db down/);
  });

  test("a clean pass adds up every partner's counts", async () => {
    const out = await sweep({
      listPartners: async () => [A, B],
      fill: async () => ({ checked: 36, written: 27, opening: 27, middle: 0, ask: 0, hop: 8 })
    });
    assert.equal(out.ok, true);
    assert.equal(out.partners, 2);
    assert.equal(out.written, 54);
    assert.equal(out.hop, 16);
  });
});
