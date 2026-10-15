// Finish-853 batch 02: the Card Stacking 'Funded' column, screen half, practice test.
//
// Row (desks-e.json, public/app/pipeline.html): "Funding: Card Stacking column 'Funded' (funded):
// shows count and funding est.; accepts a dropped card". The saved half (a card in Funded has a
// funded round and its round.funded receipt) is the live check in fin-b02-live-contracts.test.mjs.
//
// This opens the real page in Chromium with fake /api answers and presses it like a person:
//   - the Funded column shows its count and its funding estimate,
//   - a card dropped on it asks how much actually funded, and posts exactly that move,
//   - Cancel or an empty box sends nothing and leaves the card where it was.

import { test } from "node:test";
import assert from "node:assert/strict";

import { bodyOf, json, startScreens } from "./s4-screen-harness.mjs";

const RAIL = "funding_card_stacking";
const CARD_AMOUNT = 2500;

function board() {
  const card = (stage, client) => ({
    id: `card-${client}`, client_id: client, name: `Client ${client}`, owner: "Jordan Blake",
    entered_at: new Date(Date.now() - 3_600_000).toISOString(),
    outcome_tier: null, funded: false, amount: CARD_AMOUNT,
  });
  return {
    ok: true, pipeline: RAIL, total: 3,
    stages: [
      { key: "submitted", name: "Submitted", sort_order: 0, count: 2, amount: 40000, cards: [card("submitted", "dana-1")] },
      { key: "funded", name: "Funded", sort_order: 1, count: 3, amount: 75000, cards: [card("funded", "lee-2")] },
      { key: "closed", name: "Closed", sort_order: 2, count: 1, amount: 9000, cards: [] },
    ],
  };
}

async function until(done, ms = 20_000) {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
}

async function dragCard(page, fromCard, toColumn) {
  await toColumn.scrollIntoViewIfNeeded();
  const grab = await fromCard.locator(".c-name").boundingBox();
  const drop = await toColumn.locator(".col-body").boundingBox();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(drop.x + drop.width / 2, drop.y + 30, { steps: 8 });
  await page.mouse.up();
}

async function openRail(open) {
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
    },
  };
  const { page, errors } = await open("/app/pipeline.html", { handlers, viewport: { width: 1600, height: 900 } });
  await until(() => reads.includes("sales"));
  await page.locator('.rail-tab[data-rail="R-02"]').click();
  await page.waitForSelector(`.col[data-pipeline-key="${RAIL}"]`);
  return { page, errors, writes };
}

test("Funded column: shows its count and its funding estimate", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, errors } = await openRail(open);
  const funded = page.locator('.col[data-stage-key="funded"]');
  assert.equal(await funded.count(), 1);
  assert.equal(await funded.locator(".col-name").innerText(), "Funded");
  assert.equal(await funded.locator(".col-count").innerText(), "3");
  assert.equal(await funded.locator(".col-money").innerText(), "$75,000 funding est.");
  // A neighbouring column keeps its own numbers.
  const submitted = page.locator('.col[data-stage-key="submitted"]');
  assert.equal(await submitted.locator(".col-count").innerText(), "2");
  assert.equal(await submitted.locator(".col-money").innerText(), "$40,000 funding est.");
  assert.deepEqual(errors, []);
  await page.close();
});

test("Funded column: a dropped card asks how much funded and posts that exact move", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  const { page, errors, writes } = await openRail(open);
  const prompts = [];
  page.on("dialog", async (dialog) => {
    prompts.push({ type: dialog.type(), message: dialog.message() });
    await dialog.accept("45,000.50");
  });
  const funded = page.locator('.col[data-stage-key="funded"]');
  const source = page.locator('.col[data-stage-key="submitted"]');
  await dragCard(page, source.locator(".card").first(), funded);
  await until(() => writes.length > 0);
  await page.waitForTimeout(150);

  assert.equal(prompts.length, 1, "the amount box was asked once");
  assert.equal(prompts[0].type, "prompt");
  assert.match(prompts[0].message, /How much actually FUNDED for Client dana-1\?/);
  assert.equal(writes.length, 1, "exactly one move is posted");
  assert.deepEqual(writes[0], {
    action: "move", client_id: "dana-1", pipeline_key: RAIL, stage_key: "funded",
    from_pipeline_key: null, funded_amount: "45000.50",
  });
  assert.equal(await funded.locator(".col-count").innerText(), "4");
  assert.equal(await source.locator(".col-count").innerText(), "1");
  // The estimate grows by the card's amount. (The page redraws the label as "$77,500 est."; the
  // number is what this row is about, so only the number is held.)
  assert.equal((await funded.locator(".col-money").innerText()).replace(/[^0-9]/g, ""), "77500");
  assert.equal(await funded.locator('.card[data-client-id="dana-1"]').count(), 1);
  assert.deepEqual(errors, []);
  await page.close();
});

test("Funded column: Cancel or an empty box sends nothing and the card goes back", { timeout: 120_000 }, async (t) => {
  for (const answer of [null, ""]) {
    const { open } = await startScreens(t);
    const { page, errors, writes } = await openRail(open);
    page.on("dialog", async (dialog) => {
      if (answer === null) await dialog.dismiss();
      else await dialog.accept(answer);
    });
    const funded = page.locator('.col[data-stage-key="funded"]');
    const source = page.locator('.col[data-stage-key="submitted"]');
    await dragCard(page, source.locator(".card").first(), funded);
    await page.waitForTimeout(400);
    assert.equal(writes.length, 0, `answer ${JSON.stringify(answer)} sends no move`);
    assert.equal(await funded.locator(".col-count").innerText(), "3");
    assert.equal(await funded.locator('.card[data-client-id="dana-1"]').count(), 0);
    assert.equal(await source.locator('.card[data-client-id="dana-1"]').count(), 1, "the card is back where it was");
    assert.deepEqual(errors, []);
    await page.close();
  }
});
