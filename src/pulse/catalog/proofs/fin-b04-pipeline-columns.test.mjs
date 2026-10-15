// Batch 04, practice test for the half of the four Card Stacking column rows that
// leaves no saved result: what each column SHOWS (its count and its funding est.)
// and what a card dropped on it POSTS. The live check reads what the drop saved
// (the round event, the round row, the client's text and email); the number on
// the column is worked out when the board is read (api/dashboard/pipeline.mjs
// count and stageAmount) from the same cards, so there is no saved number to read
// back, and a page that paints it wrong would pass a live check. The real page is
// run in Chromium over fake /api answers.

import { test } from "node:test";
import assert from "node:assert/strict";

import { stageAmount } from "../../../../api/dashboard/pipeline.mjs";
import { bodyOf, json, startScreens } from "./s4-screen-harness.mjs";

const RAIL = "funding_card_stacking";
const COLUMNS = [
  { stage: "apply_now", name: "Apply Now" },
  { stage: "round_submitted", name: "Round Submitted" },
  { stage: "approved", name: "Approved" },
  { stage: "closed", name: "Closed" }
];
const SPARE = { stage: "spare_stage", name: "Spare stage" };

const usd = (n) => `$${n.toLocaleString("en-US")}`;
const card = (stage, n, amount) => ({
  id: `card-${stage}-${n}`, client_id: `c-${stage}-${n}`.replace(/_/g, "-"), name: `Client ${stage} ${n}`,
  owner: "Jordan Blake", entered_at: new Date(Date.now() - 3_600_000).toISOString(),
  outcome_tier: null, funded: false, amount
});

// apply_now: three cards, two with an estimate (sum 12,500). round_submitted: two cards, none
// with an estimate (unknown, not $0). approved: one card, 40,000. closed: empty (a real $0).
function board() {
  const apply = [card("apply_now", 1, 10000), card("apply_now", 2, 2500), card("apply_now", 3, null)];
  const submitted = [card("round_submitted", 1, null), card("round_submitted", 2, null)];
  const approved = [card("approved", 1, 40000)];
  const stages = [
    { key: "apply_now", name: "Apply Now", cards: apply },
    { key: "round_submitted", name: "Round Submitted", cards: submitted },
    { key: "approved", name: "Approved", cards: approved },
    { key: "closed", name: "Closed", cards: [] },
    { key: SPARE.stage, name: SPARE.name, cards: [1, 2, 3, 4].map((n) => card(SPARE.stage, n, 1000)) }
  ].map((s, i) => ({
    ...s, sort_order: i, count: s.cards.length, amount: stageAmount(s.cards),
    amount_known: s.cards.filter((c) => c.amount != null).length
  }));
  return { ok: true, pipeline: RAIL, total: stages.reduce((n, s) => n + s.count, 0), stages };
}

const column = (page, stage) => page.locator(`.col[data-stage-key="${stage}"]`);

async function dragCard(page, fromCard, toColumn) {
  await toColumn.scrollIntoViewIfNeeded();
  const grab = await fromCard.locator(".c-name").boundingBox();
  const drop = await toColumn.locator(".col-body").boundingBox();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x + drop.width / 2, drop.y + 30, { steps: 8 });
  await page.mouse.up();
}

async function until(done, ms = 20_000) {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
}

test("a column's estimate is the sum of the known card amounts, unknown when none, zero when empty", () => {
  assert.equal(stageAmount([{ amount: 10000 }, { amount: 2500 }, { amount: null }]), 12500);
  assert.equal(stageAmount([{ amount: null }, { amount: null }]), null);
  assert.equal(stageAmount([]), 0);
  assert.equal(stageAmount([{ amount: 0 }]), 0);
});

test("the four columns show their count and funding est., and a dropped card posts that exact move", { timeout: 180_000 }, async (t) => {
  const { open } = await startScreens(t);
  const writes = [];
  const reads = [];
  const handlers = {
    "/api/dashboard/pipeline?key=": async (route, { url }) => {
      const key = new URL(url).searchParams.get("key");
      reads.push(key);
      return json(route, key === RAIL ? board() : { ok: true, pipeline: key, total: 0, stages: [] });
    },
    "/api/pipeline-cards": async (route, { method }) => {
      if (method !== "POST") return json(route, { ok: true });
      const body = bodyOf(route);
      writes.push(body);
      return json(route, { ok: true, action: "move", ...body });
    }
  };
  const { page, errors } = await open("/app/pipeline.html", { handlers, viewport: { width: 4200, height: 900 } });
  await until(() => reads.includes("sales"));
  await page.locator('.rail-tab[data-rail="R-02"]').click();
  await page.waitForSelector(`.col[data-pipeline-key="${RAIL}"]`);

  const expected = {
    apply_now: { count: "3", money: `${usd(12500)} funding est.` },
    round_submitted: { count: "2", money: "— funding est." },
    approved: { count: "1", money: `${usd(40000)} funding est.` },
    closed: { count: "0", money: `${usd(0)} funding est.` }
  };
  for (const { stage, name } of COLUMNS) {
    const col = column(page, stage);
    assert.equal(await col.count(), 1, `${name}: one column`);
    assert.equal(await col.locator(".col-name").innerText(), name);
    assert.equal(await col.locator(".col-count").innerText(), expected[stage].count, `${name}: count`);
    assert.equal(await col.locator(".col-money").innerText(), expected[stage].money, `${name}: funding est.`);
  }

  // a card dropped on each column posts exactly that column on this rail, and the column grows
  for (const { stage, name } of COLUMNS) {
    const col = column(page, stage);
    const source = column(page, SPARE.stage);
    const moving = source.locator(".card").first();
    const movingClient = await moving.getAttribute("data-client-id");
    const before = Number(await col.locator(".col-count").innerText());
    writes.length = 0;
    await dragCard(page, moving, col);
    await until(() => writes.length > 0);
    await page.waitForTimeout(150);
    assert.equal(writes.length, 1, `${name}: exactly one move is posted`);
    assert.deepEqual(writes[0], {
      action: "move", client_id: movingClient, pipeline_key: RAIL, stage_key: stage, from_pipeline_key: null
    }, name);
    assert.equal(Number(await col.locator(".col-count").innerText()), before + 1, `${name}: the count goes up`);
    assert.equal(await col.locator(`.card[data-client-id="${movingClient}"]`).count(), 1, `${name}: the card sits in it`);
  }
  assert.deepEqual(errors, [], "the page threw no errors");
  await page.close();
});
