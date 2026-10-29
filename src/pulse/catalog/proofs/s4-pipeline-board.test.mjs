// Proves the pipeline board rows on public/app/pipeline.html in a real browser
// with fake /api answers: what each column shows, what a dropped card posts,
// the MOVE menu, the archive box and the drawer. Rows come from s4-rows-screens.json.

import { test } from "node:test";
import assert from "node:assert/strict";

import { OWNER, bodyOf, json, proofRows, startScreens } from "./s4-screen-harness.mjs";

const proof = proofRows(import.meta.url);
const COLUMN_ROW = /^(.+) column '(.+)' \((\w+)\): shows count and funding est\.; accepts a dropped card$/;
const RAILS = {
  Sales: { key: "sales", tab: "R-01", money: true },
  "Funding: Card Stacking": { key: "funding_card_stacking", tab: "R-02", money: true },
  "Optimization (Repair) Rounds": { key: "optimization", tab: "R-04", money: false },
  "Inquiry Removal": { key: "inquiry_removal", tab: "R-05", money: false },
  "AR / Collections": { key: "ar_collections", tab: "R-06", money: false },
  "Affiliates + White Label": { key: "affiliates_white_label", tab: "R-08", money: false },
  Hiring: { key: "hiring", tab: "R-09", money: false },
};
const CARD_AMOUNT = 2500;
const usd = (n) => `$${n.toLocaleString("en-US")}`;
const clientFor = (rail, stage) => `c-${rail}-${stage}`.replace(/_/g, "-");

// The listed columns plus one spare stage, so the last listed column also has a
// neighbour to take a card from.
const SPARE = { stage: "spare_stage", name: "Spare stage" };

function boardFor(rail, columns) {
  const stages = [...columns, SPARE].map((col, i) => ({
    key: col.stage, name: col.name, sort_order: i, count: 7 + i, amount: 50000 + i * 1000,
    cards: [{
      id: `card-${col.stage}`, client_id: clientFor(rail, col.stage), name: `Client ${col.stage}`,
      owner: "Jordan Blake", entered_at: new Date(Date.now() - 3_600_000).toISOString(),
      outcome_tier: null, funded: false, amount: CARD_AMOUNT,
    }],
  }));
  return { ok: true, pipeline: rail, total: stages.length, stages };
}

test("Sales Set stays separate from the customer's call confirmation", { timeout: 30_000 }, async (t) => {
  const { open } = await startScreens(t);
  const board = boardFor("sales", [
    { stage: "booked", name: "Booked" },
    { stage: "confirmed", name: "Set" }
  ]);
  board.stages = board.stages.slice(0, 2);
  board.total = 2;
  for (const stage of board.stages) {
    stage.count = 1;
    stage.amount = CARD_AMOUNT;
  }
  board.stages[0].cards[0].name = "Example buyer A";
  board.stages[1].cards[0].name = "Example buyer B";
  board.stages[0].cards[0].call_confirmed = true;
  board.stages[1].cards[0].call_confirmed = false;
  const { page, errors } = await open("/app/pipeline.html", {
    handlers: backend({ sales: board }, [], [])
  });
  await page.waitForSelector('.col[data-stage-key="confirmed"]');
  assert.equal(await colName(page, "confirmed").locator(".col-name").innerText(), "Set");
  assert.equal(await colName(page, "booked").locator(".c-call-confirmed").innerText(), "✓ Call confirmed");
  assert.equal(await colName(page, "confirmed").locator(".c-call-confirmed").count(), 0);
  assert.deepEqual(errors, []);
  if (process.env.SALES_SET_SCREENSHOT_PATH) {
    await colName(page, "confirmed").scrollIntoViewIfNeeded();
    await page.screenshot({ path: process.env.SALES_SET_SCREENSHOT_PATH });
  }
  await page.close();
});

// A fake backend for the board. `boards` maps pipeline key -> read answer.
function backend(boards, writes, reads) {
  return {
    "/api/dashboard/pipeline?key=": async (route, { url }) => {
      const key = new URL(url).searchParams.get("key");
      reads.push(key);
      return json(route, boards[key] || { ok: true, pipeline: key, total: 0, stages: [] });
    },
    "/api/pipeline-cards": async (route, { method }) => {
      if (method !== "POST") return json(route, { ok: true });
      const body = bodyOf(route);
      writes.push(body);
      return json(route, { ok: true, action: "move", ...body });
    },
  };
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

async function until(done, ms = 20_000) {
  const end = Date.now() + ms;
  while (!done() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));
}

const colName = (page, stage) => page.locator(`.col[data-stage-key="${stage}"]`);

test("every listed column shows its count and funding est., and a dropped card posts that exact move", { timeout: 180_000 }, async (t) => {
  const { open } = await startScreens(t);
  const byRail = new Map();
  for (const control of proof.controlsOf(COLUMN_ROW)) {
    const [, label, name, stage] = control.match(COLUMN_ROW);
    assert.ok(RAILS[label], `unknown rail label ${label}`);
    if (!byRail.has(label)) byRail.set(label, []);
    byRail.get(label).push({ control, name, stage });
  }
  assert.ok(byRail.size >= 7, "all seven rails are listed");

  for (const [label, columns] of byRail) {
    const rail = RAILS[label];
    const writes = [];
    const reads = [];
    const handlers = backend({ [rail.key]: boardFor(rail.key, columns) }, writes, reads);
    const { page, errors } = await open("/app/pipeline.html", { handlers, viewport: { width: 5600, height: 900 } });
    await until(() => reads.includes("sales"));
    if (rail.tab !== "R-01") {
      await page.locator(`.rail-tab[data-rail="${rail.tab}"]`).click();
      await page.waitForSelector(`.col[data-pipeline-key="${rail.key}"]`);
    }
    assert.ok(reads.includes(rail.key), `${label}: the board read asks for key=${rail.key}`);

    // Last column first: dropping a card on column i takes one card from column i + 1, so every
    // column's count and funding are still the ones the read gave when its own turn comes.
    for (const [i, col] of [...columns.entries()].reverse()) {
      await proof.check(col.control, async () => {
        const column = colName(page, col.stage);
        assert.equal(await column.count(), 1, `${col.control}: one column`);
        assert.equal(await column.locator(".col-name").innerText(), col.name);
        assert.equal(await column.locator(".col-count").innerText(), String(7 + i));
        const money = column.locator(".col-money");
        if (rail.money) assert.equal(await money.innerText(), `${usd(50000 + i * 1000)} funding est.`);
        else assert.equal(await money.count(), 0, `${label}: no funding total is drawn on this rail`);

        const neighbour = [...columns, SPARE][i + 1];
        const source = colName(page, neighbour.stage);
        const before = {
          count: Number(await column.locator(".col-count").innerText()),
          sourceCount: Number(await source.locator(".col-count").innerText()),
          money: rail.money ? Number((await column.locator(".col-money").innerText()).replace(/[^0-9]/g, "")) : null,
        };
        writes.length = 0;
        const moving = source.locator(".card").first();
        const movingClient = await moving.getAttribute("data-client-id");
        await dragCard(page, moving, column);
        await until(() => writes.length > 0);
        await page.waitForTimeout(150);
        assert.equal(writes.length, 1, `${col.control}: exactly one move is posted`);
        assert.deepEqual(writes[0], {
          action: "move", client_id: movingClient,
          pipeline_key: rail.key, stage_key: col.stage, from_pipeline_key: null,
        }, col.control);
        assert.equal(Number(await column.locator(".col-count").innerText()), before.count + 1, `${col.control}: count goes up`);
        assert.equal(Number(await source.locator(".col-count").innerText()), before.sourceCount - 1, `${col.control}: source count goes down`);
        if (rail.money) {
          const after = Number((await column.locator(".col-money").innerText()).replace(/[^0-9]/g, ""));
          assert.equal(after, before.money + CARD_AMOUNT, `${col.control}: funding est. grows by the card amount`);
        }
        assert.equal(await column.locator(`.card[data-client-id="${movingClient}"]`).count(), 1);
      });
    }
    assert.deepEqual(errors, [], `${label}: the page threw no errors`);
    await page.close();
  }
});

function salesBoard() {
  const card = (id, name, extra = {}) => ({
    id: `card-${id}`, client_id: id, name, owner: "Jordan Blake", entered_at: new Date(Date.now() - 3_600_000).toISOString(),
    outcome_tier: null, funded: false, amount: 3000, email: `${id}@example.com`, phone: "+15550100", ...extra,
  });
  return {
    ok: true, pipeline: "sales", total: 2,
    stages: [
      { key: "new_lead", name: "New Lead", sort_order: 0, count: 2, amount: 6000, cards: [card("dana-1", "Dana Whitfield"), card("lee-2", "Lee Carter")] },
      { key: "booked", name: "Booked", sort_order: 1, count: 0, amount: 0, cards: [] },
      { key: "lost", name: "Lost", sort_order: 2, count: 0, amount: 0, cards: [] },
    ],
  };
}

const CLIENT_DETAIL = {
  ok: true,
  client: { id: "dana-1", email: "dana@example.com", phone: "+15550100", custom_fields: { utm_source: "meta", utm_campaign: "sample-campaign", utm_content: "43" } },
  tri_merge: { experian: 701, equifax: 695, transunion: 688 },
};
const AD_ROUTING = {
  ok: true,
  resolved: { gate: "680", entry: "direct", primary_offer: "funding", secondary_offers: [] },
  registry: { known: true },
  attribution: { ad_id: "43" },
};

async function openSales(open, { session = OWNER, extra = {} } = {}) {
  const writes = [];
  const reads = [];
  const calls = [];
  const handlers = {
    ...backend({ sales: salesBoard() }, writes, reads),
    "/api/dashboard/client-archive": async (route) => {
      const body = bodyOf(route);
      calls.push({ url: "client-archive", body });
      return json(route, { ok: true, archived: body.client_id });
    },
    "/api/dashboard/client?id=": async (route, { url }) => {
      calls.push({ url: "client", id: new URL(url).searchParams.get("id") });
      return json(route, CLIENT_DETAIL);
    },
    "/api/read/ad-attribution": async (route, { url }) => {
      calls.push({ url: "ad-attribution", id: new URL(url).searchParams.get("client_id") });
      return json(route, AD_ROUTING);
    },
  };
  const opened = await open("/app/pipeline.html", { session, handlers });
  await opened.page.waitForSelector('.card[data-client-id="dana-1"]');
  return { ...opened, writes, reads, calls };
}

// Every staff role is on the shared staff surface, which includes the pipeline; a client is not.
const STAFF_ROLES = ["owner", "admin", "sales_manager", "closer", "funding_advisor", "csm", "setter", "inquiry_specialist"];

test("the page opens for every staff role and reads the sales board; a client is sent elsewhere", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Open the page \(all staff roles/, async () => {
    for (const role of STAFF_ROLES) {
      const session = { ok: true, staff: { ...OWNER.staff, role } };
      const { page, reads, errors } = await openSales(open, { session });
      assert.deepEqual(reads, ["sales"], `${role}: one sales board read on load`);
      assert.equal(await page.locator(".col").count(), 3);
      assert.equal(await page.locator(".col-count").first().innerText(), "2");
      assert.match(page.url(), /\/app\/pipeline\.html$/, `${role} stays on the pipeline page`);
      assert.deepEqual(errors, []);
      await page.close();
    }
    const client = { ok: true, staff: { ...OWNER.staff, role: "client" } };
    const { page } = await open("/app/pipeline.html", { session: client, handlers: backend({ sales: salesBoard() }, [], []) });
    await page.waitForURL((url) => !/\/app\/pipeline\.html$/.test(url.pathname));
    assert.equal(await page.locator(".col").count(), 0, "a client sees no board");
    await page.close();
  });
});

test("card actions: body click opens the drawer, MOVE opens the menu and posts each route", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);

  await proof.check(/^Card: click the card body/, async () => {
    const { page, calls } = await openSales(open);
    await page.locator('.card[data-client-id="dana-1"] .c-name').click();
    await page.waitForSelector("#fhDrawer.open");
    assert.equal(await page.locator("#fhDrawerName").innerText(), "Dana Whitfield");
    await page.waitForFunction(() => /701/.test(document.querySelector("#fhDrawerBody").innerText));
    await page.waitForFunction(() => /Direct/.test(document.querySelector("#fhDrawerBody").innerText));
    const text = await page.locator("#fhDrawerBody").innerText();
    assert.match(text, /Experian\s+701/);
    assert.match(text, /dana@example\.com/);
    assert.deepEqual([...new Set(calls.filter((c) => c.url === "client").map((c) => c.id))], ["dana-1"]);
    assert.deepEqual([...new Set(calls.filter((c) => c.url === "ad-attribution").map((c) => c.id))], ["dana-1"]);
    await page.close();
  });

  await proof.check(/^Card: MOVE button/, async () => {
    const { page, writes } = await openSales(open);
    assert.equal(await page.locator("#routeMenu").isHidden(), true);
    await page.locator('.card[data-client-id="dana-1"] .c-btn.route').click();
    assert.equal(await page.locator("#routeMenu").isVisible(), true);
    assert.equal(await page.locator("#rmName").innerText(), "Move Dana Whitfield");
    await page.waitForTimeout(150);
    assert.deepEqual(writes, [], "no request until a destination is chosen");
    await page.close();
  });

  const routes = [
    [/^MOVE menu: Repair Rounds/, "optimization", "round_sent", "sales"],
    [/^MOVE menu: Inquiry Removal/, "inquiry_removal", "requested", "sales"],
    [/^MOVE menu: Mark Lost/, "sales", "lost", null],
    [/^MOVE menu: AR \/ Collections/, "ar_collections", "invoice_sent", "sales"],
  ];
  for (const [matcher, pipelineKey, stageKey, from] of routes) {
    await proof.check(matcher, async () => {
      const { page, writes, reads } = await openSales(open);
      await page.locator('.card[data-client-id="dana-1"] .c-btn.route').click();
      await page.locator(`#routeMenu .rm-item[data-pipeline-key="${pipelineKey}"][data-stage-key="${stageKey}"]`).click();
      await page.waitForFunction(() => document.querySelector("#routeMenu").hidden);
      await page.waitForTimeout(200);
      assert.deepEqual(writes, [{ action: "move", client_id: "dana-1", pipeline_key: pipelineKey, stage_key: stageKey, from_pipeline_key: from }]);
      assert.ok(reads.includes(pipelineKey), "the destination rail is loaded after the save");
      await page.close();
    });
  }
});

test("archive: DEL needs the word DELETE, then posts the archive and removes the card", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);

  await proof.check(/^Card: DEL button then modal/, async () => {
    const { page, calls } = await openSales(open);
    const archived = () => calls.filter((c) => c.url === "client-archive");
    await page.locator('.card[data-client-id="dana-1"] .c-btn.del').click();
    assert.equal(await page.locator("#fhDelModal.open").count(), 1);
    assert.equal(await page.locator("#fhDelGo").isDisabled(), true);
    await page.locator("#fhDelInput").fill("delete");
    assert.equal(await page.locator("#fhDelGo").isDisabled(), true, "lower case does not unlock it");
    await page.locator("#fhDelCancel").click();
    assert.equal(await page.locator("#fhDelModal.open").count(), 0);
    assert.deepEqual(archived(), [], "Cancel posts nothing");

    await page.locator('.card[data-client-id="dana-1"] .c-btn.del').click();
    await page.locator("#fhDelInput").fill("DELETE");
    assert.equal(await page.locator("#fhDelGo").isDisabled(), false);
    await page.locator("#fhDelGo").click();
    await page.waitForFunction(() => !document.querySelector('.card[data-client-id="dana-1"]'));
    assert.deepEqual(archived().map((c) => c.body), [{ client_id: "dana-1", confirm: "DELETE" }]);
    assert.equal(await page.locator('.card[data-client-id="lee-2"]').count(), 1, "the other card stays");
    assert.match(await page.locator("body").innerText(), /Archived Dana Whitfield/);
    await page.close();
  });

  await proof.check(/^Drawer: Archive and Close buttons, Escape key/, async () => {
    const { page, calls } = await openSales(open);
    const open_ = () => page.locator("#fhDrawer.open").count();
    await page.locator('.card[data-client-id="dana-1"] .c-name').click();
    assert.equal(await open_(), 1);
    await page.locator("#fhDrawerClose").click();
    assert.equal(await open_(), 0, "Close shuts the drawer");
    await page.locator('.card[data-client-id="dana-1"] .c-name').click();
    assert.equal(await open_(), 1);
    await page.keyboard.press("Escape");
    assert.equal(await open_(), 0, "Escape shuts the drawer");
    await page.locator('.card[data-client-id="lee-2"] .c-name').click();
    await page.locator("#fhDrawerDel").click();
    assert.equal(await page.locator("#fhDelModal.open").count(), 1, "Archive opens the same box");
    await page.locator("#fhDelInput").fill("DELETE");
    await page.locator("#fhDelGo").click();
    await page.waitForFunction(() => !document.querySelector('.card[data-client-id="lee-2"]'));
    assert.deepEqual(calls.filter((c) => c.url === "client-archive").map((c) => c.body), [{ client_id: "lee-2", confirm: "DELETE" }]);
    await page.close();
  });
});

test("a card dragged by pointer to another column on the same rail posts one move", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Card: drag the card \(pointer\)/, async () => {
    const { page, writes } = await openSales(open);
    await dragCard(page, page.locator('.card[data-client-id="dana-1"]'), colName(page, "booked"));
    await page.waitForTimeout(200);
    assert.deepEqual(writes, [{ action: "move", client_id: "dana-1", pipeline_key: "sales", stage_key: "booked", from_pipeline_key: null }]);
    assert.equal(await colName(page, "booked").locator('.card[data-client-id="dana-1"]').count(), 1);
    assert.equal(await colName(page, "new_lead").locator(".col-count").innerText(), "1");
    await page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
