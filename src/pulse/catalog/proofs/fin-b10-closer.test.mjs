// Practice test (real page, fake /api answers) for six Closer controls in batch 10: the closer-call.html
// redirect page, and on closer-dashboard.html the Belief failed buttons, Join call, Present, the
// contract panel's Copy link, and the Deal breakdown fold.
// The expected request bodies and words are worked out in this file from the fake data, not copied from
// the page. window.open and the clipboard are replaced in the page, so nothing leaves this machine.
// Each row is claimed only inside the callback that asserts it.

import assert from "node:assert/strict";
import test from "node:test";

import { bodyOf, json, proofRows, sharedScreens, waitFor } from "./fin-b10-kit.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();

const CLIENT = "aaaaaaaa-1111-4111-8111-111111111111";
const NEXT = "bbbbbbbb-2222-4222-8222-222222222222";
const CLOSER = { ok: true, staff: { id: "staff-2", name: "Casey Reed", email: "casey@fundhub.ai", role: "closer", org_id: "org-1", status: "active" } };
const DUE = "2026-09-01T17:00:00.000Z";
const NEXT_DUE = "2026-09-01T18:00:00.000Z";
const JOIN = "https://meet.example.com/room-123";
const SIGN = "https://fundhub.example/sign/abc123";

const COCKPIT = (extra = {}) => ({
  ok: true,
  staff: { id: "staff-2", name: "Casey Reed", shift: { on_shift: true, elapsed_ms: 3_600_000 } },
  kpis: { cash_today_cents: { cents: 0, display: "$0", deposits: 0 }, cash_month_cents: 0, deposits: 0, calls_held: 0, no_shows: 0, close_rate: null, unlogged: 0, commission_mtd: null, commission_reason: "n/a" },
  client: { id: CLIENT, name: "Dana Whitfield", business_name: "Whitfield Freight", age_months: 26, tags: [], funded: false, pipeline: { stage_key: "closing", stage_name: "Closing" } },
  credit: { available: false, reason: "No crs_results row for this client yet" },
  underwrite: { matched_lenders: 0, lenders: [], applications: [], lenders_reason: "empty", lite_banner_funding: null, totals: { total_personal_funding: 0, total_business_funding: 0, total_combined_funding: 0 } },
  deal: { latest_payment: null, success_fee_percent: 0.1, success_fee_source: "default", success_fee_note: "House default." },
  precall: { conversation_count: 0, summary: "No conversation summary on file yet." },
  current_call: { due_at: DUE, task_id: "task-1", title: "Closing call" },
  next_call: { due_at: NEXT_DUE, task_id: "task-2", client_id: NEXT, name: "Sam Okafor" },
  up_next: [{ task_id: "task-2", client_id: NEXT, due_at: NEXT_DUE, title: "Closing call", name: "Sam Okafor" }],
  offers: [{ key: "FUNDING_DFY", name: "Funding done for you", priceDisplay: "$5,000" }],
  gone_quiet: { unlogged: [], quiet_deposits: [] },
  dispositions: { outcomes: ["deposit", "downsell", "callback", "no_show", "not_a_fit"], beliefs: ["pain", "doubt", "cost", "desire", "money", "support", "trust"] },
  ...extra,
});

// Record window.open and the clipboard in the page, so nothing opens and nothing is copied for real.
function stubs({ copyFails = false } = {}) {
  return `(() => {
    window.__opened = [];
    window.open = (...args) => { window.__opened.push(args); return null; };
    window.__copied = [];
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
      writeText: (text) => ${copyFails ? "Promise.reject(new Error('denied'))" : "{ window.__copied.push(text); return Promise.resolve(); }"},
    } });
  })();`;
}

async function openCall({ cockpit = COCKPIT(), query = `?client_id=${CLIENT}&task_id=task-1`, init = stubs(), extra = {}, ready = "#fh-save-next" } = {}) {
  const posted = [];
  const alerts = [];
  const contracts = [];
  const handlers = {
    "/api/read/closer-now": { ok: true, current: null, next: null },
    "/api/read/closer-call": cockpit,
    "/api/read/tradelines": { ok: true, data: [], client_id: CLIENT },
    "/api/read/lender-matches": { ok: true, matches: [] },
    "/api/read/deal-math": { ok: true, net: 21500, monthly: 400, drawn: 40000, fees: 4000, debts: 6500 },
    "/api/read/agent-context": { ok: true, context: {} },
    "/api/read/contracts": { ok: true, items: [{ id: "tpl-1", template_key: "funding_agreement", name: "Funding agreement", active: true, manual_fields: [] }] },
    "/api/contracts": async (route) => {
      const body = bodyOf(route);
      contracts.push(body);
      if (body.action === "create_draft") return json(route, { ok: true, contract: { id: "contract-1" } });
      return json(route, { ok: true, links: [{ url: SIGN }], message: "Sent. Copy the link and give it to the client." });
    },
    "/api/call-outcomes": async (route) => {
      posted.push(bodyOf(route));
      return json(route, { ok: true, created: true, outcome: { outcome: posted.at(-1).outcome } });
    },
    ...extra,
  };
  const opened = await screens.open(`/app/closer-dashboard.html${query}`, { session: CLOSER, handlers, init });
  opened.page.on("dialog", (dialog) => { alerts.push(dialog.message()); dialog.accept(); });
  await opened.page.waitForSelector(ready, { state: "attached" });
  return { ...opened, posted, alerts, contracts };
}

test("Belief failed buttons: each of the seven and None is a button, the picked one is marked, and Save sends that belief", async () => {
  await proof.check(/^Belief failed buttons/, async () => {
    const BELIEFS = ["pain", "doubt", "cost", "desire", "money", "support", "trust"];
    const first = await openCall();
    const labels = await first.page.$$eval("[data-belief]", (els) => els.map((e) => [e.dataset.belief, e.textContent.trim()]));
    assert.deepEqual(labels, [...BELIEFS.map((b) => [b, b]), ["none", "None"]]);
    assert.deepEqual(await first.page.$$eval("[data-belief].k", (els) => els.length), 0, "none is marked at first");

    // Pressing one marks only that one; pressing another moves the mark.
    await first.page.locator('[data-belief="doubt"]').click();
    assert.deepEqual(await first.page.$$eval("[data-belief].k", (els) => els.map((e) => e.dataset.belief)), ["doubt"]);
    await first.page.locator('[data-belief="trust"]').click();
    assert.deepEqual(await first.page.$$eval("[data-belief].k", (els) => els.map((e) => e.dataset.belief)), ["trust"]);
    assert.deepEqual(first.posted, [], "nothing is sent by pressing a belief");
    await first.page.close();

    // Each belief goes out as itself with an outcome; None goes out as no belief; leaving it alone sends no belief.
    for (const [pick, expected] of [...BELIEFS.map((b) => [b, b]), ["none", null], [null, null]]) {
      const { page, posted, alerts } = await openCall();
      if (pick) await page.locator(`[data-belief="${pick}"]`).click();
      await page.locator('[data-outcome="callback"]').click();
      await page.locator("#fh-save-next").click();
      await waitFor(() => posted.length === 1, `the save for ${pick}`);
      assert.equal(posted[0].belief_failed, expected, `belief ${pick}`);
      assert.equal(posted[0].outcome, "callback");
      assert.equal(posted[0].client_id, CLIENT);
      assert.deepEqual(alerts, []);
      await page.close();
    }
  });
});

test("Join call button: opens the booked call link in a new tab when there is one, and is off with the reason when there is none", async () => {
  await proof.check(/^Join call button/, async () => {
    const withLink = await openCall({ cockpit: COCKPIT({ join_url: JOIN }) });
    const join = withLink.page.locator("#fh-join");
    await waitFor(async () => !(await join.isDisabled()), "Join call turned on");
    assert.equal(await join.getAttribute("title"), null);
    assert.equal(await join.textContent(), "Join call");
    await join.click();
    const opened = await withLink.page.evaluate(() => window.__opened);
    assert.deepEqual(opened, [[JOIN, "_blank", "noopener"]]);
    // The call has started, so the pay link becomes the one filled button.
    assert.match(await withLink.page.locator("#fh-pay-link").getAttribute("class") || "", /\bk\b/);
    assert.deepEqual(withLink.errors, []);
    await withLink.page.close();

    const none = await openCall({ cockpit: COCKPIT({ join_url: null }) });
    await waitFor(async () => (await none.page.locator("#fh-who-meta, #ccp-who-meta").first().textContent()).length > 0, "the call painted");
    const dead = none.page.locator("#fh-join");
    assert.equal(await dead.isDisabled(), true);
    assert.equal(await dead.getAttribute("title"), "No call link on this appointment");
    await none.page.close();
  });
});

test("Present button: opens the deck for this client in a new tab, and the bare deck when no client is open", async () => {
  await proof.check(/^Present button/, async () => {
    const { page, errors } = await openCall();
    const present = page.locator("#fh-present");
    await waitFor(async () => await present.isVisible(), "Present shown");
    assert.equal(await present.textContent(), "Present");
    await present.click();
    assert.deepEqual(await page.evaluate(() => window.__opened), [[`present.html?contact=${CLIENT}`, "_blank", "noopener,noreferrer"]]);
    assert.deepEqual(errors, []);
    await page.close();

    // No client open: it still shows, and opens the deck on its own (the deck has its own gate for that).
    const bare = await openCall({ query: "", cockpit: { ok: true, current: null, next: null }, ready: "#fh-present" });
    await waitFor(async () => await bare.page.locator("#fh-present").isVisible(), "Present shown with no client");
    await bare.page.locator("#fh-present").click();
    assert.deepEqual(await bare.page.evaluate(() => window.__opened), [["present.html", "_blank", "noopener,noreferrer"]]);
    await bare.page.close();
  });
});

test("Contract panel Copy link: off until a contract is sent, then copies that sign link, says Copied, and reports a failure", async () => {
  await proof.check(/^Contract panel: Copy link button/, async () => {
    const { page, contracts, errors } = await openCall();
    await page.locator("#fh-send-contract").click();
    await page.waitForFunction(() => document.querySelectorAll("#fh-contract-tpl option").length === 1);
    const copy = page.locator("#fh-contract-copy");
    assert.equal(await copy.isDisabled(), true, "Copy link is off before a contract is sent");
    assert.equal(await copy.textContent(), "Copy link");
    assert.deepEqual(await page.evaluate(() => window.__copied), []);

    await page.locator("#fh-contract-go").click();
    await waitFor(() => contracts.length === 2, "draft and send");
    assert.deepEqual(contracts.map((c) => c.action), ["create_draft", "send"]);
    assert.equal(contracts[0].client_id, CLIENT);
    assert.equal(contracts[0].template_id, "tpl-1");
    await waitFor(async () => !(await copy.isDisabled()), "Copy link turned on");
    assert.equal(await page.locator("#fh-contract-link").inputValue(), SIGN);
    // Sending copied it once already.
    assert.deepEqual(await page.evaluate(() => window.__copied), [SIGN]);

    await copy.click();
    await waitFor(async () => (await copy.textContent()) === "Copied", "the Copied word");
    assert.deepEqual(await page.evaluate(() => window.__copied), [SIGN, SIGN], "the press copied the same link again");
    await waitFor(async () => (await copy.textContent()) === "Copy link", "the word going back", 4000);
    assert.deepEqual(errors, []);
    await page.close();

    // A browser that refuses the copy is told so.
    const refused = await openCall({ init: stubs({ copyFails: true }) });
    await refused.page.locator("#fh-send-contract").click();
    await refused.page.waitForFunction(() => document.querySelectorAll("#fh-contract-tpl option").length === 1);
    await refused.page.locator("#fh-contract-go").click();
    await waitFor(async () => !(await refused.page.locator("#fh-contract-copy").isDisabled()), "Copy link turned on");
    await refused.page.locator("#fh-contract-copy").click();
    await waitFor(async () => (await refused.page.locator("#fh-contract-copy").textContent()) === "Copy failed", "the failure word");
    await refused.page.close();
  });
});

test("Deal breakdown details toggle: shut at first, opens onto the three tables with the deal math, and shuts again", async () => {
  await proof.check(/^Deal breakdown details toggle/, async () => {
    const { page, errors } = await openCall();
    const fold = page.locator("#breakdown");
    const summary = page.locator("#breakdown > summary");
    // The fold sits inside the Payment Calculator fold, so it cannot be seen until that one is open.
    assert.equal(await summary.isVisible(), false, "out of sight while the Payment Calculator is shut");
    await page.locator("#paymentCalculator > summary").click();
    assert.equal(await summary.isVisible(), true);
    assert.match(await summary.textContent(), /Show breakdown/);
    assert.equal(await fold.getAttribute("open"), null);
    assert.equal(await page.locator("#breakdown .bd-body").isHidden(), true);

    await summary.click();
    assert.notEqual(await fold.getAttribute("open"), null);
    assert.equal(await page.locator("#breakdown .bd-body").isVisible(), true);
    const body = await page.locator("#breakdown .bd-body").textContent();
    assert.match(body, /Where the draw comes from/);
    assert.match(body, /What each way of paying it back costs/);
    assert.match(body, /Minimum payment, card by card/);
    // The deal math read fills the "how the net cash is arrived at" table.
    await waitFor(async () => (await page.locator("#oFunded").textContent()) === "$40,000", "the funded amount");
    assert.equal(await page.locator("#oFees").textContent(), "−$4,000");
    assert.equal(await page.locator("#oDebts").textContent(), "−$6,500");

    await summary.click();
    assert.equal(await fold.getAttribute("open"), null);
    assert.equal(await page.locator("#breakdown .bd-body").isHidden(), true);
    assert.deepEqual(errors, []);
    await page.close();

    // With no client open the whole fold is switched off, since there is nothing to break down.
    const none = await openCall({ query: "", cockpit: { ok: true, current: null, next: null }, ready: "#breakdown" });
    await waitFor(async () => (await none.page.evaluate(() => document.getElementById("breakdown").hidden)) === true, "the fold hidden with no client");
    await none.page.close();
  });
});

test("Closer Call redirect page: sends the browser to the Closer Dashboard with the same query and hash, and keeps a link", async () => {
  await proof.check(/^Redirect page: open Closer Dashboard link/, async () => {
    // The redirect keeps ?query and #hash and replaces the history entry, so Back does not loop.
    const { page, errors } = await screens.open(`/app/closer-call.html?client_id=${CLIENT}&task_id=task-1#notes`, {
      session: CLOSER,
      handlers: { "/api/read/closer-now": { ok: true, current: null, next: null } },
    });
    await page.waitForURL(new RegExp(`/app/closer-dashboard\\.html\\?client_id=${CLIENT}&task_id=task-1#notes$`));
    // Replaced, not pushed: the history is as long as for a page opened straight onto the dashboard.
    const plain = await screens.open(`/app/closer-dashboard.html?client_id=${CLIENT}&task_id=task-1`, { session: CLOSER, handlers: {} });
    assert.equal(await page.evaluate(() => history.length), await plain.page.evaluate(() => history.length), "the redirect replaced the history entry");
    await plain.page.close();
    assert.deepEqual(errors, []);
    await page.close();

    // The visible link is for a browser that did not run the script. Read the page as it is served, find the
    // link, and press the address it names: it is the dashboard, and the dashboard opens.
    const probe = await screens.open(`/app/closer-dashboard.html?client_id=${CLIENT}`, { session: CLOSER, handlers: {} });
    const served = await probe.page.evaluate(async () => (await fetch("/app/closer-call.html")).text());
    const anchors = [...served.matchAll(/<a\s+href="([^"]+)">([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(anchors, [["closer-dashboard.html", "Open Closer Dashboard"]]);
    assert.match(served, /location\.replace\("closer-dashboard\.html" \+ location\.search \+ location\.hash\)/);
    const status = await probe.page.evaluate(async () => (await fetch("/app/closer-dashboard.html")).status);
    assert.equal(status, 200);
    await probe.page.close();
  });
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
