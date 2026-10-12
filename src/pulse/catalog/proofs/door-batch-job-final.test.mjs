import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { handle as contractChaser } from "../../../workflows/contract-chaser.mjs";
import { handle as hiringOutreach } from "../../../workflows/hiring-outreach-cadence.mjs";
import { handle as merchantPull } from "../../../workflows/merchant-pull-sweeper.mjs";
import { handle as blueprintSequence } from "../../../workflows/blueprint-next-funding-sequence-sweeper.mjs";
import { handle as paidCheckoutExpiry } from "../../../workflows/paid-checkout-expiry-sweeper.mjs";
import { handle as pulseInstantWatch } from "../../../workflows/pulse-instant-watch.mjs";
import { handle as affiliatePayout } from "../../../workflows/affiliate-payout-run.mjs";
import { handle as meetTranscript } from "../../../workflows/meet-transcript-sweeper.mjs";
import { handle as inquiryCalls } from "../../../workflows/inquiry-call-sweeper.mjs";
import { handle as repairResponse } from "../../../workflows/repair-bureau-response.mjs";
import { sweepHubstaffPoll } from "../../../../netlify/functions/hubstaff-poll-sweeper.mjs";
import adVideoWorker from "../../../../netlify/functions/ad-video-worker-background.mjs";
import { makeHandler as makeMarketingOfferHandler } from "../../../../netlify/functions/marketing-offer-background.mjs";
import { makeRecipe } from "../door-recipes.mjs";
import { evaluateJobReceipt, judgeAdVideoWorker } from "../../coverage/gap-door-batch-jobs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/jobs.json");
const UUID = "00000000-0000-4000-8000-000000000001";

function fakeDb() {
  return {
    calls: [],
    async query(sql, params = []) {
      this.calls.push({ sql: String(sql), params });
      return { rows: [], rowCount: 0 };
    },
  };
}

function fakeStep() {
  return {
    runs: [],
    async run(name, fn) {
      this.runs.push(name);
      return fn();
    },
  };
}

const PROBES = new Map([
  ["workflow:contract-chaser", async ({ db, step }) => {
    const out = await contractChaser({ db, step });
    assert.deepEqual(out, { orgs: 0, reminded: 0, tasked: 0 });
  }],
  ["workflow:hiring-outreach-cadence", async ({ db, step }) => {
    const out = await hiringOutreach({ db, step });
    assert.deepEqual(out, { ok: true, scanned: 0, queued: 0, stopped: 0, results: [] });
  }],
  ["workflow:merchant-pull-sweeper", async ({ db, step }) => {
    const out = await merchantPull({ db, step });
    assert.deepEqual(out, { checked: 0, synced: 0, partway: 0, inserted: 0, failed: [] });
  }],
  ["workflow:blueprint-next-funding-sequence-sweeper", async ({ db, step }) => {
    const out = await blueprintSequence({ db, step });
    assert.equal(out.checked, 0);
    assert.equal(out.created, 0);
    assert.equal(out.suggested.checked, 0);
  }],
  ["workflow:paid-checkout-expiry-sweeper", async ({ db, step }) => {
    const out = await paidCheckoutExpiry({ db, step });
    assert.deepEqual(out, { closed: 0, ids: [], limit: 500, more: false });
  }],
  ["workflow:pulse-instant-watch", async ({ db, step }) => {
    const out = await pulseInstantWatch({
      db,
      step,
      env: {},
      fetchImpl: async () => { throw new Error("fake pulse door is offline"); },
    });
    assert.equal(out.ok, true);
    assert.equal(out.sms.sent, false);
    assert.equal(out.sms.reason, "no_dest");
  }],
  ["workflow:affiliate-payout-run", async ({ db, step }) => {
    const out = await affiliatePayout({ db, step });
    assert.deepEqual(out.orgs, []);
    assert.deepEqual(out.errors, []);
  }],
  ["workflow:meet-transcript-sweeper", async ({ db, step }) => {
    const out = await meetTranscript({ db, step, env: {} });
    assert.equal(out.orgs, 0);
    assert.equal(out.synced, 0);
  }],
  ["workflow:inquiry-call-sweeper", async ({ db, step }) => {
    const out = await inquiryCalls({ db, step });
    assert.deepEqual(out, { fired: [], count: 0 });
  }],
  ["workflow:repair-bureau-response-reader", async ({ db }) => {
    const out = await repairResponse({ db, event: {} });
    assert.deepEqual(out, { ok: true, skipped: true, reason: "not_bureau_response" });
  }],
  ["function:hubstaff-poll-sweeper", async ({ db }) => {
    const out = await sweepHubstaffPoll(db, { env: {} });
    assert.equal(out.ok, true);
    assert.equal(out.skipped, true);
    assert.equal(out.reason, "not_configured");
  }],
  ["function:ad-video-worker-background", async () => {
    const original = process.env.AD_VIDEO_WORKER_SECRET;
    process.env.AD_VIDEO_WORKER_SECRET = "fake-ad-video-worker-secret";
    try {
      const response = await adVideoWorker(new Request("https://fundhub.example.test", {
        method: "POST",
        headers: { "x-fundhub-worker": "wrong-secret" },
      }));
      assert.equal(response.status, 404);
      assert.equal(judgeAdVideoWorker({ stuck_create_n: 1, stuck_export_n: 0 }).status, "FAIL");
      assert.equal(judgeAdVideoWorker({ stuck_create_n: 0, stuck_export_n: 0 }).status, "PASS");
    } finally {
      if (original === undefined) delete process.env.AD_VIDEO_WORKER_SECRET;
      else process.env.AD_VIDEO_WORKER_SECRET = original;
    }
  }],
  ["function:marketing-offer-background", async ({ db }) => {
    let ran = 0;
    const handler = makeMarketingOfferHandler({
      database: db,
      auth: async () => ({ staff: { role: "owner", org_id: UUID } }),
      run: async (_database, input) => {
        ran += 1;
        assert.deepEqual(input, { jobId: UUID, orgId: UUID });
        return { ok: true, status: "done" };
      },
      env: { MARKETING_AI_RUNNER: "cloud" },
    });
    const response = await handler(new Request("https://fundhub.example.test", {
      method: "POST",
      headers: { authorization: "Bearer fake-owner", "content-type": "application/json" },
      body: JSON.stringify({ job_id: UUID }),
    }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, status: "done" });
    assert.equal(ran, 1);
  }],
]);

test("Batch 4 jobs return a safe fake result and keep their real trigger receipt", async () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) =>
    makeRecipe("jobs.json", row).proof?.evidence.includes("door-batch-job-final.test.mjs")
  );
  assert.equal(rows.length, 13);
  assert.deepEqual(new Set(rows.map((row) => row.surface)), new Set(PROBES.keys()));

  for (const row of rows) {
    const loaded = await import(pathToFileURL(path.join(ROOT, row.file)).href);
    const receipt = evaluateJobReceipt(row, loaded);
    assert.equal(receipt.ok, true, `${row.surface}: ${receipt.problems.join(", ")}`);
    const db = fakeDb();
    const step = fakeStep();
    await PROBES.get(row.surface)({ db, step });
    if (row.surface.startsWith("workflow:") && row.surface !== "workflow:repair-bureau-response-reader") {
      assert.ok(step.runs.length > 0, `${row.surface} left no run receipt`);
    }
  }
});
