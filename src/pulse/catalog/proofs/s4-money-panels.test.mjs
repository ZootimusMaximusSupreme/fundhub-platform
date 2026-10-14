// Proves four FinanceOS rows: the Credit read, the Money moves lists, the
// Alerts page gate and the "I'm ready to get funded" button.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const alertsFixture = () => JSON.parse(fs.readFileSync(path.join(ROOT, "src/finance/file-alerts/file-alerts.fixture.json"), "utf8"));
const compact = (value) => String(value).replace(/\s+/g, " ").toLowerCase();

test("Credit: three bureau scores with words and dates, the history line, UnderwriteIQ's sentences and the sample-report warning", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const target = { entry: "frame", tab: "credit" };
  const openCredit = async (read) => {
    const resource = moneyResource("credit", { read });
    const opened = await open(entryUrl("frame", { ...target, clientId: CLIENT_ID }), { session: STAFF, handlers: resource.handlers });
    await opened.page.waitForFunction(() => /experian/i.test(document.querySelector("#fos-credit")?.innerText || ""));
    return opened;
  };
  await proof.check(/^Credit page read/, async () => {
    const answer = sampleAnswer("money-credit.sample.json");
    const { page, errors } = await openCredit(() => answer);
    const text = compact(await page.locator("#fos-credit").innerText());
    assert.match(text, /experian\s+771\s+very good/);
    assert.match(text, /equifax\s+778\s+very good/);
    assert.match(text, /transunion\s+766\s+very good/);
    assert.match(text, /pulled sep 30, 2026/);
    assert.match(text, /sample report/);
    assert.match(text, /very good is 740–799/, "one pull compares against the band, not against an older pull");
    assert.match(text, /one pull so far/, "one pull draws no history chart");
    assert.equal(await page.locator("#fos-credit svg.chart").count(), 0);
    // UnderwriteIQ's sentences are printed exactly as the server sent them
    for (const tip of answer.suggestions) assert.ok(await page.locator("#fos-credit .says li", { hasText: tip.text }).count() === 1, `tip shown: ${tip.text}`);
    assert.equal(await page.locator("#fos-credit .says li").count(), answer.suggestions.length);
    assert.deepEqual(errors, []);
    await page.close();

    // two pulls: each bureau says how far it moved since the pull before, and the chart is drawn
    const twoPulls = {
      ...answer,
      history: [
        { pulled_at: "2026-08-31T12:00:00.000Z", experian: 760, equifax: 770, transunion: 770 },
        { pulled_at: "2026-09-30T04:30:03.759Z", experian: 771, equifax: 778, transunion: 766 },
      ],
    };
    const two = await openCredit(() => twoPulls);
    const after = compact(await two.page.locator("#fos-credit").innerText());
    assert.match(after, /experian\s+771\s+very good\s+\+11 since aug 31, 2026/);
    assert.match(after, /equifax\s+778\s+very good\s+\+8 since aug 31, 2026/);
    assert.match(after, /transunion\s+766\s+very good\s+−4 since aug 31, 2026/);
    assert.equal(await two.page.locator("#fos-credit svg.chart polyline").count(), 3, "one line per bureau");
    assert.doesNotMatch(after, /one pull so far/);
    await two.page.close();
  }, "financeos.html#credit");
});

test("Money moves: what waits for the client's OK and the history, in words, and who said yes", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Waiting-for-your-OK list and History table/, async () => {
    const answer = sampleAnswer("money-transfers.sample.json");
    // a second finished move that the client themselves approved (the first is the practice run)
    const approvedByClient = JSON.parse(JSON.stringify(answer.history[0]));
    approvedByClient.id = "7b0f0c52-31d6-4f0e-9d6e-2a51f1e0a099";
    approvedByClient.transfer = { ...approvedByClient.transfer, id: "9c1d2e3f-0000-4000-8000-00000000a099", approved_by: "client", environment: "production" };
    answer.history.push(approvedByClient);
    const resource = moneyResource("transfers", { read: () => answer });
    const { page, errors } = await open(entryUrl("frame", { tab: "transfers", clientId: "" }), { session: CLIENT, handlers: resource.handlers });
    await page.waitForSelector("article.wt");
    assert.equal(await page.locator("article.wt").count(), answer.waiting.length);
    const first = compact(await page.locator(`article.wt[data-id="${answer.waiting[0].id}"]`).innerText());
    assert.match(first, /\$2,000\.00/);
    assert.match(first, /to business checking ••2202/);
    assert.match(first, /from personal checking ••1101/);
    const row = page.locator(`tr[data-id="${answer.history[0].id}"]`);
    const rowText = compact(await row.innerText());
    assert.match(rowText, /done — in business checking ••2202/);
    assert.match(rowText, /practice run/, "a practice run says so");
    const mine = compact(await page.locator(`tr[data-id="${approvedByClient.id}"]`).innerText());
    assert.match(mine, /\byou\b/, "a move the client approved says you");
    assert.doesNotMatch(mine, /practice run/);
    assert.match(compact(await page.locator("#fos-transfers").innerText()), /\$20\.00/);
    assert.deepEqual(errors, []);
    await page.close();
  }, "financeos.html#transfers");
});

test("Alerts gate: a client changes only their own alerts; staff need a client file", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^Page gate: a client changes only their own alerts/, async () => {
    const mine = moneyResource("alerts", { read: alertsFixture });
    const own = await open("/app/money-alerts.html", { session: CLIENT, handlers: mine.handlers });
    await own.page.waitForSelector('[data-act="toggle"]');
    await own.page.locator('[data-act="toggle"][data-kind="promo_end"]').click();
    await waitFor(() => mine.log.posts.length === 1);
    assert.deepEqual(mine.log.reads, [""], "a client reads their own file");
    assert.deepEqual(mine.log.posts[0], { action: "set_alert", kind: "promo_end", enabled: false });
    await own.page.close();

    const theirs = moneyResource("alerts", { read: alertsFixture });
    const staff = await open(`/app/money-alerts.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: theirs.handlers });
    await staff.page.waitForSelector('[data-act="toggle"]');
    await staff.page.locator('[data-act="toggle"][data-kind="cash_reserve"]').click();
    await waitFor(() => theirs.log.posts.length === 1);
    assert.deepEqual(theirs.log.reads, [`?client_id=${CLIENT_ID}`]);
    assert.deepEqual(theirs.log.posts[0], { action: "set_alert", kind: "cash_reserve", enabled: false, client_id: CLIENT_ID });
    await staff.page.close();

    const none = moneyResource("alerts", { read: () => ({ ok: false, error: "client_id_required" }), readStatus: 400 });
    const lost = await open("/app/money-alerts.html", { session: STAFF, handlers: none.handlers });
    await lost.page.waitForFunction(() => /needs to know whose/i.test(document.body.innerText));
    assert.deepEqual(none.log.posts, []);
    await lost.page.close();
  }, "money-alerts.html");
});

test("I'm ready to get funded sends the request once and says it went to the team", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(/^I'm ready to get funded/, async () => {
    const next = sampleAnswer("money-next.sample.json");
    const tasks = moneyResource("tasks", { read: () => next.tasks });
    const ready = moneyResource("ready-to-fund", {
      read: () => next.ready,
      write: () => ({ status: 200, body: { ...next.ready, status: "requested", requested_at: "2026-10-10T17:00:00Z" } }),
    });
    const handlers = { ...tasks.handlers, ...ready.handlers };
    const own = await open("/app/money-next.html", { session: CLIENT, handlers });
    await own.page.waitForSelector('[data-act="ready"]');
    await own.page.locator('[data-act="ready"]').click();
    await waitFor(() => ready.log.posts.length === 1);
    assert.deepEqual(ready.log.posts[0], {});
    await own.page.waitForFunction(() => /Sent to our team/.test(document.body.innerText));
    assert.equal(await own.page.locator('[data-act="ready"]').count(), 0, "the button is gone once it is sent");
    await own.page.close();

    const again = moneyResource("ready-to-fund", {
      read: () => next.ready,
      write: () => ({ status: 200, body: { ...next.ready, status: "requested", requested_at: "2026-10-10T17:00:00Z" } }),
    });
    const staff = await open(`/app/money-next.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { ...tasks.handlers, ...again.handlers } });
    await staff.page.waitForSelector('[data-act="ready"]');
    await staff.page.locator('[data-act="ready"]').click();
    await waitFor(() => again.log.posts.length === 1);
    assert.deepEqual(again.log.posts[0], { client_id: CLIENT_ID });
    await staff.page.close();
  }, "public/app/money-next.html");
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
