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
import { encryptProcessorApiKey } from "../../../merchant/secrets.mjs";
import { runOfferJob } from "../../../marketing/offer-run.mjs";
import { askAnthropic } from "../../../marketing/offer-transport.mjs";
import { createOfferJob } from "../../../marketing/offer-store.mjs";
import { makeFakeDb as makeOfferDb } from "../../../marketing/fixtures/offer-fake-db.mjs";
import {
  anthropicMessage,
  CANDIDATES_TEXT,
  SYNTHESIS_TEXT,
  panelsText,
} from "../../../marketing/fixtures/offer-replies.mjs";
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
  assert.equal(rows.length, 1);
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

test("the two customer jobs use their exact non-empty final-result proof", () => {
  const proved = new Set([
    "workflow:meet-transcript-sweeper",
    "workflow:repair-bureau-response-reader",
  ]);
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) => proved.has(row.surface));
  assert.equal(rows.length, proved.size);
  for (const row of rows) {
    const proof = makeRecipe("jobs.json", row).proof;
    assert.equal(proof.verdict, undefined, row.surface);
    assert.equal(
      proof.depth,
      row.surface === "workflow:repair-bureau-response-reader" ? "deep" : "e2e",
      row.surface,
    );
    assert.equal(proof.asserts, row.control, row.surface);
    assert.match(proof.evidence, /door-batch-job-final\.test\.mjs/, row.surface);
    assert.match(proof.evidence, /src\/workflows\/customer-final-results\.test\.mjs/, row.surface);
  }
});

test("the contract chaser and instant watch use exact non-empty final-result proofs", () => {
  const expected = new Map([
    ["workflow:contract-chaser", "src/workflows/contract-chaser-final.test.mjs"],
    ["workflow:pulse-instant-watch", "src/pulse/instant-watch.test.mjs"],
  ]);
  const rows = JSON.parse(fs.readFileSync(MAP, "utf8")).filter((row) => expected.has(row.surface));
  assert.equal(rows.length, expected.size);
  for (const row of rows) {
    const proof = makeRecipe("jobs.json", row).proof;
    assert.equal(proof.verdict, undefined, row.surface);
    assert.equal(proof.depth, row.surface === "workflow:contract-chaser" ? "deep" : "e2e", row.surface);
    assert.equal(proof.asserts, row.control, row.surface);
    assert.match(proof.evidence, /door-batch-job-final\.test\.mjs/, row.surface);
    assert.match(proof.evidence, new RegExp(expected.get(row.surface).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), row.surface);
  }
});

test("the ad-video background worker uses its exact non-empty final-result proof", () => {
  const row = JSON.parse(fs.readFileSync(MAP, "utf8"))
    .find((candidate) => candidate.surface === "function:ad-video-worker-background");
  const proof = makeRecipe("jobs.json", row).proof;
  assert.equal(proof.verdict, undefined);
  assert.equal(proof.depth, "e2e");
  assert.equal(proof.asserts, row.control);
  assert.match(proof.evidence, /door-batch-job-final\.test\.mjs/);
  assert.match(proof.evidence, /src\/workflows\/ad-video-worker-final\.test\.mjs/);
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
    if (row.surface === "workflow:blueprint-next-funding-sequence-sweeper") {
      assert.match(proof.evidence, /src\/blueprint\/next-sequence-plan\.test\.mjs/);
    }
  }

  const payoutWrites = [];
  const affiliates = {
    "affiliate-ready": {
      id: "affiliate-ready",
      partner_license_signed_at: "2026-09-01T00:00:00.000Z",
      tax_form_received_at: "2026-09-02T00:00:00.000Z",
      payout_method: "manual",
    },
    "affiliate-held": {
      id: "affiliate-held",
      partner_license_signed_at: null,
      tax_form_received_at: "2026-09-02T00:00:00.000Z",
      payout_method: "manual",
    },
  };
  const payoutDb = {
    async query(sql, params = []) {
      const text = String(sql);
      if (/SELECT id FROM orgs/.test(text)) return { rows: [{ id: "org-1" }] };
      if (/FROM affiliate_referrals/.test(text)) {
        return { rows: [
          {
            id: "referral-ready", affiliate_id: "affiliate-ready", client_id: "client-1",
            tier: 1, commission_due: "75.00", basis_amount: "750.00",
            rule_snapshot: {}, client_code: "CLIENT-1",
          },
          {
            id: "referral-held", affiliate_id: "affiliate-held", client_id: "client-2",
            tier: 1, commission_due: "80.00", basis_amount: "800.00",
            rule_snapshot: {}, client_code: "CLIENT-2",
          },
        ] };
      }
      if (/FROM affiliates WHERE/.test(text)) {
        return { rows: affiliates[params[0]] ? [affiliates[params[0]]] : [] };
      }
      if (/INSERT INTO affiliate_payouts/.test(text)) {
        const row = {
          affiliateId: params[1],
          status: params[4],
          holdReason: params[5],
          id: `payout-${params[1]}`,
        };
        payoutWrites.push(row);
        return { rows: [{ id: row.id }] };
      }
      if (/INSERT INTO affiliate_payout_lines/.test(text)) {
        payoutWrites.push({ payoutId: params[1], referralId: params[2], amount: params[3] });
        return { rows: [{ id: `line-${params[2]}` }] };
      }
      throw new Error(`unexpected payout proof query: ${text.slice(0, 80)}`);
    },
  };
  const payout = await affiliatePayoutSweep(payoutDb, {
    now: new Date("2026-10-01T03:00:00Z"),
    minimumUsd: 50,
  });
  assert.equal(payout.errors.length, 0);
  assert.equal(payout.orgs[0].payoutsCreated, 2);
  assert.equal(payout.orgs[0].linesCreated, 2);
  assert.deepEqual(
    payout.orgs[0].payouts.map(({ affiliateId, status, holdReason }) => ({ affiliateId, status, holdReason })),
    [
      { affiliateId: "affiliate-ready", status: "pending", holdReason: null },
      { affiliateId: "affiliate-held", status: "held", holdReason: "partner_license_unsigned" },
    ]
  );
  assert.deepEqual(payout.orgs[0].held, [{
    affiliateId: "affiliate-held",
    payoutId: "payout-affiliate-held",
    reason: "partner_license_unsigned",
  }]);
  assert.equal(payoutWrites.filter((row) => row.status === "held").length, 1);
  assert.equal(payoutWrites.filter((row) => row.referralId).length, 2);

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

  const merchantEnv = {
    MERCHANT_SECRET_ENC_KEY: Buffer.alloc(32, 7).toString("base64"),
    ADAPTERS_DRY_RUN: "0",
  };
  const processorKey = "fake-commas-read-key";
  const connection = {
    id: "connection-1", org_id: "org-1", client_id: "client-1", entity_id: "entity-1",
    provider: "commas", mode: "pull", status: "active",
    encrypted_api_key: encryptProcessorApiKey(processorKey, {
      connectionId: "connection-1", env: merchantEnv,
    }),
    sync_cursor: null, synced_through: null, last_synced_at: null,
  };
  const merchantEvents = [];
  const merchantProgress = [];
  const merchantDb = {
    async query(sql, params) {
      const text = String(sql);
      if (/FROM merchant_connections/.test(text)) {
        assert.equal(params[0], connection.id);
        return { rows: [connection] };
      }
      if (/INSERT INTO merchant_events/.test(text)) {
        merchantEvents.push({
          providerEventId: params[1], kind: params[2], amountCents: params[3],
          currency: params[4], description: params[6],
        });
        return { rows: [{ id: `event-${merchantEvents.length}` }] };
      }
      if (/SET last_event_at = now\(\)/.test(text)) return { rows: [] };
      if (/SET sync_cursor =/.test(text)) {
        merchantProgress.push({ cursor: params[1], completedAt: params[2] });
        return { rows: [] };
      }
      throw new Error(`unexpected merchant proof query: ${text.slice(0, 80)}`);
    },
  };
  let merchantFetches = 0;
  const merchantFetch = async (url, init) => {
    merchantFetches += 1;
    assert.match(String(url), /^https:\/\/www\.fanbasis\.com\/public-api\/checkout-sessions\/transactions\?/);
    assert.equal(init.headers["x-api-key"], processorKey);
    const body = { data: {
      transactions: [{
        id: 77,
        transaction_date: "2026-10-01T12:00:00Z",
        amount: "100.00",
        fee_amount: "5.00",
        product: { title: "Door Proof" },
        refunds: [{
          refund_id: "rf-1", amount: "20.00", status: "succeeded",
          created_at: "2026-10-02T12:00:00Z",
        }],
      }],
      pagination: { has_more: false },
    } };
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      async text() { return JSON.stringify(body); },
    };
  };
  const merchant = await merchantSweep(merchantDb, {
    list: async () => [{ id: connection.id }],
    env: merchantEnv,
    fetchImpl: merchantFetch,
    now: new Date("2026-10-12T18:00:00.000Z"),
  });
  assert.deepEqual(merchant, { checked: 1, synced: 1, partway: 0, inserted: 3, failed: [] });
  assert.equal(merchantFetches, 1);
  assert.deepEqual(merchantEvents, [
    { providerEventId: "txn:77", kind: "sale", amountCents: 10000, currency: "usd", description: "Door Proof" },
    { providerEventId: "txn:77:fee", kind: "fee", amountCents: -500, currency: "usd", description: "Commas fees" },
    { providerEventId: "refund:rf-1", kind: "refund", amountCents: -2000, currency: "usd", description: "Refund of Door Proof" },
  ]);
  assert.deepEqual(merchantProgress, [{ cursor: null, completedAt: "2026-10-12T18:00:00.000Z" }]);

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
      return { screenshots: [{
        id: 13, user_id: 44, taken_at: "2026-10-12T15:05:00Z",
        thumb_url: "https://hubstaff.example.test/fake-thumb.jpg",
      }] };
    },
  });
  const hubstaff = await sweepHubstaffPoll(hubstaffDb, {
    env: { HUBSTAFF_TOKEN: "fake-token", HUBSTAFF_ORG_ID: "1" },
    fetchImpl: hubstaffFetch,
    now: new Date("2026-10-12T18:00:00Z"),
  });
  assert.equal(hubstaff.ok, true);
  assert.equal(hubstaff.merged, 2);
  assert.equal(merged[0].external_id, "activity:12");
  assert.equal(merged[1].external_id, "screenshot:13");
  assert.equal(merged[1].thumb_url, "https://hubstaff.example.test/fake-thumb.jpg");

  const offerDb = makeOfferDb();
  const offerOrg = "55555555-5555-4555-8555-555555555555";
  const { job: offerJob } = await createOfferJob(offerDb, {
    orgId: offerOrg,
    staffId: null,
    payload: {
      campaign: "partner", today: "2026-10-05",
      avatarSummary: "AVATAR", adResearchSummary: "RESEARCH", ownerNotes: "",
      sources: { avatar: "supplied", adResearch: "supplied", ownerNotes: null }, cut: {},
    },
  });
  let modelCalls = 0;
  const offerAsk = (args) => askAnthropic({
    ...args,
    env: { ANTHROPIC_API_KEY: "test-key-not-real" },
    fetchImpl: async (_url, init) => {
      modelCalls += 1;
      const prompt = JSON.parse(init.body).messages[0].content;
      const text = prompt.startsWith("Design SIX offers")
        ? CANDIDATES_TEXT
        : prompt.startsWith("You are a panel of four judges")
          ? panelsText([...new Set([...prompt.matchAll(/\"blindId\":\"(Offer [A-F])\"/g)].map((match) => match[1]))])
          : SYNTHESIS_TEXT;
      return { ok: true, status: 200, json: async () => anthropicMessage(text, { input: 1000, output: 500 }) };
    },
  });
  const offerHandler = makeOfferHandler({
    database: offerDb,
    auth: async () => ({ staff: { role: "owner", org_id: offerOrg } }),
    env: { MARKETING_AI_RUNNER: "cloud" },
    run: (database, input) => runOfferJob(database, { ...input, ask: offerAsk }),
  });
  const offer = await offerHandler(new Request("https://fundhub.test/.netlify/functions/marketing-offer-background", {
    method: "POST",
    headers: { authorization: "Bearer fake" },
    body: JSON.stringify({ job_id: offerJob.id }),
  }));
  assert.equal(offer.status, 200);
  assert.deepEqual(await offer.json(), { ok: true, status: "done" });
  assert.equal(modelCalls, 3);
  assert.equal(offerDb.jobs[0].status, "done");
  assert.equal(offerDb.jobs[0].attempts, 1);
  assert.equal(offerDb.jobs[0].result.offer.name, "Live or We Keep Building");
  assert.equal(
    offerDb.jobs[0].result.reviewCard.threeThingsToCheck[0],
    "The price is $10,000 once, can be financed — yes or no?"
  );
});

test("the job lane accepts the live scope function and a direct database", async () => {
  for (const kind of ["scope", "db"]) {
    const db = fakeDb();
    const ctx = kind === "scope" ? { scope: (fn) => fn(db) } : { db };
    const checks = await gapChecks(ctx);

    assert.equal(checks.length, CHECK_IDS.length, kind);
    // One ad-video read. With the live staff scope there is also one read-only
    // "is AI bureau calling still parked?" read (owner answer B6); it answers
    // nothing here, so nothing is parked and every gap row stays red.
    const parkReads = db.calls.filter((call) => /parked:bureau-calls/.test(call.sql));
    assert.equal(db.calls.length - parkReads.length, 1, kind);
    assert.equal(parkReads.length, kind === "scope" ? 1 : 0, kind);
    assert.equal(checks[0].id, "door-batch:ad-video-worker-result", kind);
    assert.equal(checks[0].status, "PASS", kind);
    assert.deepEqual(
      checks.slice(1).map((check) => check.status),
      Array(FINAL_JOB_GAP_ROWS.length).fill("FAIL"),
      kind,
    );
    assert.deepEqual(
      new Set(checks.slice(1).map((check) => check.id)),
      new Set(FINAL_JOB_GAP_ROWS.map((row) => row.id)),
      kind
    );
  }
});
