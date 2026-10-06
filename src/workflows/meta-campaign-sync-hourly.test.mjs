// The Meta pull's two clocks: the hourly 3-day pass and the nightly 28-day
// pass (marketing machine M0 step 5, docs/specs/marketing-machine-2026-10-04.md:
// "Run hourly for the last 3 days, plus a nightly 28-day pass").
//
// NO DATABASE AND NO META. sweep() takes its partner list and its sync function
// as arguments. That the hourly sync itself asks Meta for 3 days and never the
// whole history is proved in src/http/campaigns-sync-hourly.test.mjs.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  sweep,
  handle,
  handleHourly,
  handles,
  SWEEP_CRON,
  HOURLY_CRON,
  SOURCE_WORKFLOW,
  HOURLY_WORKFLOW,
  metaCampaignSyncSweeper,
  metaCampaignSyncHourly
} from "./meta-campaign-sync-sweeper.mjs";
import { assemble } from "../journeys/runner/registry.mjs";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const clean = () => ({ connections: 1, campaigns: 1, ad_sets: 1, ads: 1, insights: 3, errors: [] });

describe("two clocks, both registered", () => {
  test("the hourly pass is served, on minute 30 of every hour, with no event trigger", async () => {
    const { functions } = await import("./index.mjs");
    const fn = functions.find((f) => f.id() === "meta-campaign-sync-hourly");
    assert.ok(fn, "the hourly Meta pull is not registered, so it never runs");
    const triggers = (fn.opts && fn.opts.triggers) || [];
    assert.deepEqual(triggers.map((t) => t.cron).filter(Boolean), [HOURLY_CRON]);
    assert.deepEqual(triggers.map((t) => t.event).filter(Boolean), []);
    assert.equal(HOURLY_CRON, "30 * * * *");
    assert.equal(HOURLY_WORKFLOW, "meta-campaign-sync-hourly");
    assert.equal(metaCampaignSyncHourly.opts.id, HOURLY_WORKFLOW);
  });

  test("the nightly pass is unchanged: 07:00 UTC daily, same id", async () => {
    const { functions } = await import("./index.mjs");
    const fn = functions.find((f) => f.id() === "meta-campaign-sync-sweeper");
    const crons = ((fn.opts && fn.opts.triggers) || []).map((t) => t.cron).filter(Boolean);
    assert.deepEqual(crons, ["0 7 * * *"]);
    assert.equal(SWEEP_CRON, "0 7 * * *");
    assert.equal(metaCampaignSyncSweeper.opts.id, SOURCE_WORKFLOW);
  });

  test("the two never start in the same minute, so they never write the same rows at once", () => {
    assert.notEqual(HOURLY_CRON.split(" ")[0], SWEEP_CRON.split(" ")[0]);
  });
});

describe("each clock runs its own pass", () => {
  test("the nightly sweep hands every partner the nightly pass, 28 days", async () => {
    const seen = [];
    const out = await sweep({
      listPartners: async () => [A, B],
      sync: async ({ partnerId, pass }) => { seen.push([partnerId, pass]); return clean(); }
    });
    assert.deepEqual(seen, [[A, "nightly"], [B, "nightly"]]);
    assert.equal(out.pass, "nightly");
    assert.equal(out.window_days, 28);
    assert.equal(out.synced, 2);
  });

  test("the hourly sweep hands every partner the hourly pass, 3 days", async () => {
    const seen = [];
    const out = await sweep({
      pass: "hourly",
      listPartners: async () => [A, B],
      sync: async ({ partnerId, pass }) => { seen.push([partnerId, pass]); return clean(); }
    });
    assert.deepEqual(seen, [[A, "hourly"], [B, "hourly"]]);
    assert.equal(out.pass, "hourly");
    assert.equal(out.window_days, 3);
    assert.equal(out.days_of_numbers, 6);
  });

  test("one broken partner still never ends the hourly pass", async () => {
    const out = await sweep({
      pass: "hourly",
      listPartners: async () => [A, B],
      sync: async ({ partnerId }) => {
        if (partnerId === A) throw new Error("Meta says: (#190) invalid token");
        return clean();
      }
    });
    assert.equal(out.ok, true);
    assert.equal(out.synced, 1);
    assert.equal(out.errored.length, 1);
  });

  test("a misspelt pass syncs nobody and says so, without throwing", async () => {
    let listed = false;
    const out = await sweep({ pass: "weekly", listPartners: async () => { listed = true; return [A]; } });
    assert.equal(out.ok, false);
    assert.match(out.error, /unknown Meta sync pass/);
    assert.equal(listed, false, "partners were listed for a pass that does not exist");
  });
});

describe("the journey runner can call both", () => {
  test("handles names a handler for each id this file serves", () => {
    assert.equal(handles[SOURCE_WORKFLOW], handle);
    assert.equal(handles[HOURLY_WORKFLOW], handleHourly);
  });

  test("the registry picks the hourly handler for the hourly id, not the nightly one", () => {
    const mod = { handle, handles };
    const byId = new Map([
      [SOURCE_WORKFLOW, { mod, file: "meta-campaign-sync-sweeper.mjs" }],
      [HOURLY_WORKFLOW, { mod, file: "meta-campaign-sync-sweeper.mjs" }]
    ]);
    const { workflows, unrunnable } = assemble([metaCampaignSyncSweeper, metaCampaignSyncHourly], byId);
    assert.deepEqual(unrunnable, []);
    assert.equal(workflows.find((w) => w.id === HOURLY_WORKFLOW).handle, handleHourly);
    assert.equal(workflows.find((w) => w.id === SOURCE_WORKFLOW).handle, handle);
  });
});

describe("the reason in the file says what the code does", () => {
  test("the old 'daily, not hourly' reason is gone and the new one is there", () => {
    const src = readFileSync(new URL("./meta-campaign-sync-sweeper.mjs", import.meta.url), "utf8");
    assert.equal(src.includes("DAILY, NOT HOURLY."), false, "the header still says the pull is daily only");
    assert.ok(src.includes("HOURLY FOR 3 DAYS, PLUS THE NIGHTLY 28 DAYS"));
  });
});
