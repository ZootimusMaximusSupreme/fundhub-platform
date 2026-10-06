// GET marketing/costs reads real measured runs for every cost line on the Blueprint
// chain (unit GL): the flywheel steps by stage, the funnel writer, and the offer from
// its own token counts. A stand-in database; the real one is in
// src/http/marketing-flywheel.pg.test.mjs ("unit GL: the Blueprint chain ...").

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { COST_KINDS, readCosts, offerRunUsd, lastMeasured } from "./costs.mjs";

const ORG = "44444444-4444-4444-8444-444444444444";

function fakeDb({ ledger = {}, offer = null } = {}) {
  const asked = [];
  return {
    asked,
    async query(sql, params = []) {
      const s = String(sql).replace(/\s+/g, " ");
      if (s.includes("JOIN marketing_model_usage u ON u.job_id = j.id")) {
        asked.push([params[1], params[2]]);
        const key = params[2] == null ? params[1] : `${params[1]}:${params[2]}`;
        return { rows: ledger[key] ? [ledger[key]] : [] };
      }
      if (s.includes("FROM marketing_jobs WHERE org_id = $1 AND kind = 'offer' AND status = 'done'")) return { rows: offer ? [offer] : [] };
      if (s.startsWith(" WITH bounds AS") || s.startsWith("WITH bounds AS")) return { rows: [{ month_priced_usd: 3.5, unpriced_rows: 0 }] };
      throw new Error(`unexpected statement: ${s.slice(0, 90)}`);
    }
  };
}

const row = (id, usd) => ({
  id, created_at: "2026-10-06T10:00:00.000Z", finished_at: "2026-10-06T10:12:00.000Z",
  cost_usd: usd, unpriced: 0, searches: 3, fetches: 1, calls: 9
});

describe("the cost kinds", () => {
  test("ad research, copy and ad strategy are the flywheel steps 2, 4 and 5; the funnel is its writer", () => {
    assert.deepEqual(COST_KINDS.ad_research, { kind: "flywheel_stage", stage: 2 });
    assert.deepEqual(COST_KINDS.copy, { kind: "flywheel_stage", stage: 4 });
    assert.deepEqual(COST_KINDS.ad_strategy, { kind: "flywheel_stage", stage: 5 });
    assert.equal(COST_KINDS.funnel, "funnel");
    assert.equal(COST_KINDS.avatar, "avatar");
  });

  test("each line reads its own last run; a step reads only its own stage", async () => {
    const db = fakeDb({ ledger: { "flywheel_stage:4": row("c4", 1.234567), "flywheel_stage:5": row("s5", 0.5), funnel: row("f1", 0.08), avatar: row("a1", 7.1) } });
    const body = await readCosts(db, { orgId: ORG, settings: { max_month_cost_usd: 300 }, now: new Date("2026-10-06T18:00:00Z") });
    assert.equal(body.kinds.copy.job_id, "c4");
    assert.equal(body.kinds.copy.last_cost_usd, 1.234567);
    assert.equal(body.kinds.copy.last_minutes, 12);
    assert.equal(body.kinds.ad_strategy.job_id, "s5");
    assert.equal(body.kinds.funnel.job_id, "f1");
    assert.equal(body.kinds.ad_research, null, "no market research run yet: unknown, never $0");
    assert.equal(body.kinds.offer, null, "no offer run at all: unknown");
    assert.ok(db.asked.some(([k, st]) => k === "flywheel_stage" && st === "2"));
    assert.ok(db.asked.some(([k, st]) => k === "avatar" && st == null));
  });

  test("the offer: its own token counts at the price table's rate when the ledger has none", async () => {
    const result = { model: "claude-opus-5-5", usage: { calls: [
      { step: "candidates", model: "claude-opus-5-5", input_tokens: 1000, output_tokens: 500 },
      { step: "judges", model: "claude-opus-5-5-20261001", input_tokens: 2000, output_tokens: 0 }
    ] } };
    assert.equal(offerRunUsd(result), 0.022, "1,000 in and 500 out, then 2,000 in at the run's model rate");
    assert.equal(offerRunUsd({ model: "some-new-model", usage: { calls: [{ model: "some-new-model", input_tokens: 1, output_tokens: 1 }] } }), null, "no known price: unknown");
    assert.equal(offerRunUsd({ usage: { calls: [] } }), null);
    const db = fakeDb({ offer: { id: "o1", created_at: "2026-10-06T10:00:00.000Z", finished_at: "2026-10-06T10:05:00.000Z", result } });
    const body = await readCosts(db, { orgId: ORG, settings: {}, now: new Date("2026-10-06T18:00:00Z") });
    assert.deepEqual(body.kinds.offer, {
      job_id: "o1", last_cost_usd: 0.022, last_minutes: 5, measured_at: "2026-10-06T10:05:00.000Z",
      last_searches: 0, last_fetches: 0, last_calls: 2, unpriced_calls: 0, measured_from: "the run's own token counts"
    });
  });

  test("an offer run that is on the ledger reads the ledger", async () => {
    const db = fakeDb({ ledger: { offer: row("o2", 0.67) } });
    assert.equal((await lastMeasured(db, { orgId: ORG, jobKind: "offer" })).job_id, "o2");
    const body = await readCosts(db, { orgId: ORG, settings: {}, now: new Date() });
    assert.equal(body.kinds.offer.job_id, "o2");
  });
});
