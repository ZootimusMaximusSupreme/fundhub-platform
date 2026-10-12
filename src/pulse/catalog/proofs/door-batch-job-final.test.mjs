import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { makeRecipe } from "../door-recipes.mjs";
import { sweep as affiliatePayoutSweep } from "../../../workflows/affiliate-payout-run.mjs";
import { sweepAll as blueprintSequenceSweep } from "../../../workflows/blueprint-next-funding-sequence-sweeper.mjs";
import { sweep as merchantSweep } from "../../../workflows/merchant-pull-sweeper.mjs";
import { sweep as paidExpirySweep } from "../../../workflows/paid-checkout-expiry-sweeper.mjs";
import { sweepHubstaffPoll } from "../../../../netlify/functions/hubstaff-poll-sweeper.mjs";
import { makeHandler as makeOfferHandler } from "../../../../netlify/functions/marketing-offer-background.mjs";
import {
  CHECK_IDS,
  FINAL_JOB_GAP_ROWS,
  gapChecks,
} from "../../coverage/gap-door-batch-jobs.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const MAP = path.join(ROOT, "ops/workflows/coverage-every-surface-2026-10-10/jobs.json");

function fakeDb() {
  return {
    calls: [],
    async query(sql, params = []) {
      this.calls.push({ sql: String(sql), params });
      return { rows: [], rowCount: 0 };
    },
  };
}

test("jobs without a non-empty final-result proof stay on exact red monitors", () => {
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) =>
    makeRecipe("jobs.json", row).proof?.evidence.includes("door-batch-job-final.test.mjs") &&
    makeRecipe("jobs.json", row).proof?.verdict === "red"
  );
  assert.equal(rows.length, 7);
  assert.deepEqual(
    new Set(rows.map((row) => row.surface)),
    new Set(FINAL_JOB_GAP_ROWS.map((row) => row.surface))
  );

  for (const row of rows) {
    const recipe = makeRecipe("jobs.json", row);
    assert.equal(recipe.proof.verdict, "red", row.surface);
    assert.equal(recipe.proof.depth, "e2e", row.surface);
    assert.match(recipe.proof.evidence, /gap-door-batch-jobs\.mjs/, row.surface);
    assert.match(
      recipe.proof.asserts,
      /stays red until a non-empty fake-data run judges this named final result$/,
      row.surface
    );
  }
});

test("six final jobs run non-empty fake work and judge the named result", async () => {
  const proved = new Set([
    "workflow:affiliate-payout-run",
    "workflow:blueprint-next-funding-sequence-sweeper",
    "workflow:merchant-pull-sweeper",
    "workflow:paid-checkout-expiry-sweeper",
    "function:hubstaff-poll-sweeper",
    "function:marketing-offer-background",
  ]);
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) => proved.has(row.surface));
  assert.equal(rows.length, proved.size);
  for (const row of rows) {
    const proof = makeRecipe("jobs.json", row).proof;
    assert.equal(proof.verdict, undefined, row.surface);
    assert.equal(proof.asserts, row.control, row.surface);
    assert.match(proof.evidence, /door-batch-job-final\.test\.mjs/, row.surface);
  }

  const payoutWrites = [];
  const payoutDb = {
    async query(sql) {
      const text = String(sql);
      if (/SELECT id FROM orgs/.test(text)) return { rows: [{ id: "org-1" }] };
      if (/FROM affiliate_referrals/.test(text)) {
        return { rows: [{
          id: "referral-1", affiliate_id: "affiliate-1", client_id: "client-1",
          tier: 1, commission_due: "75.00", basis_amount: "750.00",
          rule_snapshot: {}, client_code: "CLIENT-1",
        }] };
      }
      if (/FROM affiliates WHERE/.test(text)) {
        return { rows: [{
          id: "affiliate-1", partner_license_signed_at: new Date().toISOString(),
          tax_form_received_at: new Date().toISOString(), payout_method: "manual",
        }] };
      }
      if (/INSERT INTO affiliate_payouts/.test(text)) {
        payoutWrites.push("payout");
        return { rows: [{ id: "payout-1" }] };
      }
      if (/INSERT INTO affiliate_payout_lines/.test(text)) {
        payoutWrites.push("line");
        return { rows: [{ id: "line-1" }] };
      }
      throw new Error(`unexpected payout proof query: ${text.slice(0, 80)}`);
    },
  };
  const payout = await affiliatePayoutSweep(payoutDb, {
    now: new Date("2026-10-01T03:00:00Z"),
    minimumUsd: 50,
  });
  assert.deepEqual(payoutWrites, ["payout", "line"]);
  assert.equal(payout.errors.length, 0);
  assert.equal(payout.orgs[0].payoutsCreated, 1);
  assert.equal(payout.orgs[0].linesCreated, 1);
  assert.equal(payout.orgs[0].payouts[0].status, "pending");

  const taskWrites = [];
  const blueprintDb = {
    async query(sql) {
      const text = String(sql);
      if (/FROM clients c/.test(text) && /custom_fields/.test(text) && !/JOIN funding_rounds/.test(text)) {
        return { rows: [{
          client_id: "client-1", org_id: "org-1", ready_date: "2026-10-12",
        }] };
      }
      if (/FROM transactions t/.test(text)) return { rows: [{ one: 1 }] };
      if (/SELECT id FROM tasks/.test(text)) return { rows: [] };
      if (/INSERT INTO tasks/.test(text)) {
        taskWrites.push("closer-task");
        return { rows: [{ id: "task-1" }] };
      }
      if (/JOIN funding_rounds/.test(text)) return { rows: [] };
      throw new Error(`unexpected Blueprint proof query: ${text.slice(0, 80)}`);
    },
  };
  const blueprint = await blueprintSequenceSweep(blueprintDb, {
    now: new Date("2026-10-12T18:00:00Z"),
  });
  assert.equal(blueprint.checked, 1);
  assert.equal(blueprint.created, 1);
  assert.equal(blueprint.suggested.checked, 0);
  assert.deepEqual(taskWrites, ["closer-task"]);

  const connection = {
    id: "connection-1", org_id: "org-1", client_id: "client-1", entity_id: "entity-1",
    provider: "commas", mode: "pull", status: "active", encrypted_api_key: "fake",
    sync_cursor: null, synced_through: null, last_synced_at: null,
  };
  const merchantDb = {
    async query(sql, params) {
      assert.match(String(sql), /FROM merchant_connections/);
      assert.equal(params[0], connection.id);
      return { rows: [connection] };
    },
  };
  const merchant = await merchantSweep(merchantDb, {
    list: async () => [{ id: connection.id }],
    sync: async (_db, row) => {
      assert.equal(row.id, connection.id);
      return { ok: true, done: true, inserted: 3 };
    },
    env: {},
  });
  assert.deepEqual(merchant, { checked: 1, synced: 1, partway: 0, inserted: 3, failed: [] });

  const expiredAt = new Date("2026-10-12T00:00:00Z");
  const expiryDb = {
    async query(sql, params) {
      assert.match(String(sql), /UPDATE paid_service_requests/);
      assert.equal(params[0], expiredAt.toISOString());
      assert.equal(params[1], "checkout_expired");
      return { rows: [{ id: "request-1" }] };
    },
  };
  const expiry = await paidExpirySweep(expiryDb, { now: expiredAt });
  assert.equal(expiry.closed, 1);
  assert.deepEqual(expiry.ids, ["request-1"]);

  const staff = {
    id: "11111111-1111-4111-8111-111111111111",
    org_id: "22222222-2222-4222-8222-222222222222",
    hubstaff_user_id: "44",
    monitoring_consent_at: "2026-10-12T00:00:00Z",
  };
  const shift = {
    id: "33333333-3333-4333-8333-333333333333",
    staff_id: staff.id,
    started_at: "2026-10-12T14:00:00Z",
    ended_at: null,
  };
  const merged = [];
  const hubstaffDb = {
    async query(sql, params) {
      const text = String(sql);
      if (/FROM staff/.test(text) && /monitoring_consent_at IS NOT NULL/.test(text)) return { rows: [staff] };
      if (/FROM shifts/.test(text)) return { rows: [shift] };
      if (/SELECT 1 AS one/.test(text)) return { rows: [] };
      if (/INSERT INTO staff_events/.test(text)) {
        merged.push(JSON.parse(params[4]));
        return { rows: [{ id: "event-1", kind: params[3], detail: JSON.parse(params[4]) }] };
      }
      throw new Error(`unexpected Hubstaff proof query: ${text.slice(0, 80)}`);
    },
  };
  const hubstaffFetch = async (url) => ({
    ok: true,
    status: 200,
    async json() {
      if (/\/activities/.test(url)) {
        return { activities: [{
          id: 12, user_id: 44, starts_at: "2026-10-12T15:00:00Z", overall: 70, tracked: 600,
        }] };
      }
      return { screenshots: [] };
    },
  });
  const hubstaff = await sweepHubstaffPoll(hubstaffDb, {
    env: { HUBSTAFF_TOKEN: "fake-token", HUBSTAFF_ORG_ID: "1" },
    fetchImpl: hubstaffFetch,
    now: new Date("2026-10-12T18:00:00Z"),
  });
  assert.equal(hubstaff.ok, true);
  assert.equal(hubstaff.merged, 1);
  assert.equal(merged[0].external_id, "activity:12");

  let offerRun = null;
  const offerHandler = makeOfferHandler({
    database: { name: "fake-db" },
    auth: async () => ({ staff: { role: "owner", org_id: "org-1" } }),
    env: { MARKETING_AI_RUNNER: "cloud" },
    run: async (database, input) => {
      offerRun = { database, input };
      return { ok: true, status: "completed", candidates: 6, judges: 4 };
    },
  });
  const offer = await offerHandler(new Request("https://fundhub.test/.netlify/functions/marketing-offer-background", {
    method: "POST",
    headers: { authorization: "Bearer fake" },
    body: JSON.stringify({ job_id: "44444444-4444-4444-8444-444444444444" }),
  }));
  assert.equal(offer.status, 200);
  assert.deepEqual(await offer.json(), { ok: true, status: "completed", candidates: 6, judges: 4 });
  assert.equal(offerRun.input.orgId, "org-1");
});

test("the job lane accepts the live scope function and a direct database", async () => {
  for (const kind of ["scope", "db"]) {
    const db = fakeDb();
    const ctx = kind === "scope" ? { scope: (fn) => fn(db) } : { db };
    const checks = await gapChecks(ctx);

    assert.equal(checks.length, CHECK_IDS.length, kind);
    assert.equal(db.calls.length, 1, kind);
    assert.equal(checks[0].id, "door-batch:ad-video-worker-result", kind);
    assert.equal(checks[0].status, "PASS", kind);
    assert.deepEqual(checks.slice(1).map((check) => check.status), Array(7).fill("FAIL"), kind);
    assert.deepEqual(
      new Set(checks.slice(1).map((check) => check.id)),
      new Set(FINAL_JOB_GAP_ROWS.map((row) => row.id)),
      kind
    );
  }
});
