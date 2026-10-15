// Batch 18 practice tests: three client money pages in a real Chromium with fake /api answers (no live data).
//
//   money.html            the Back link (client and staff), the six-link Money nav, and Try again on a
//                         failed overview read
//   money-transfers.html  the Back link, the seven-link nav, Try again, and the "What happened" fold that
//                         lists a move's ledger events in words
//   money-vault.html      the Back link, the eight-link nav, Try again, and the staff Cancel button that
//                         closes an open accept, reject or sort form without sending anything

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import assert from "node:assert/strict";

import { backOf, flaky, json, navOf, proofRows, sharedScreens, waitFor } from "./fin-b18-kit.mjs";
import { CLIENT, CLIENT_ID, STAFF, sampleAnswer } from "./s4-money-harness.mjs";
import { sampleVault } from "../../../http/fixtures/money-vault.sample.mjs";

const proof = proofRows(import.meta.url);
const screens = sharedScreens();
const FRAME = "/app/financeos.html";
const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../public/app");
const FRAME_HTML = fs.readFileSync(path.join(APP_DIR, "financeos.html"), "utf8");

/**
 * Where a nav link really lands. The money pages link to the one-page frame by its #tab; the frame's own
 * script (financeos.js, run here as the page runs it) says which tab an address opens, and an address with a
 * tab that no longer exists opens Overview. A link is only right when the tab it names is the tab it opens,
 * and the frame's page still has that tab and its panel.
 */
function landing(href) {
  const context = {};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(APP_DIR, "financeos.js"), "utf8"), context, { filename: "financeos.js" });
  const frame = context.FHFinanceOS;
  const tab = frame.tabForHref(href);
  const exists = frame.TABS.some(([key]) => key === tab)
    && new RegExp(`id="tab-${tab}"`).test(FRAME_HTML) && new RegExp(`id="fos-${tab}"`).test(FRAME_HTML);
  return exists ? tab : null;
}
const assertLandings = (nav, expected, who) => nav.forEach((link, i) => {
  if (expected[i] === null) return; // the page's own link (Funding papers)
  assert.equal(landing(link.href), expected[i], `${who}: "${link.label}" opens the ${expected[i]} tab of the one-page frame`);
});
const textOf = async (locator) => (await locator.innerText()).trim();

// ───────────────────────── money.html ─────────────────────────

const OVERVIEW = sampleAnswer("money-overview.sandbox.json");

test("Money: the Back link names the portal for a client and Finance OS for staff naming a client", { timeout: 90_000 }, async () => {
  await proof.check(/^Back to my portal \/ Back to Finance OS \(header link\)/, async () => {
    const asClient = await screens.open("/app/money.html", { session: CLIENT, handlers: { "/api/money/overview": OVERVIEW } });
    await asClient.page.waitForSelector("#money-root .big");
    assert.deepEqual(await backOf(asClient.page), ["Back to my portal", "client-portal.html"]);
    assert.deepEqual(asClient.errors, []);
    await asClient.page.close();
    const asStaff = await screens.open(`/app/money.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { "/api/money/overview": OVERVIEW } });
    await asStaff.page.waitForSelector("#money-root .big");
    assert.deepEqual(await backOf(asStaff.page), ["Back to Finance OS", `finance-os.html?client_id=${CLIENT_ID}`]);
    assert.deepEqual(asStaff.errors, []);
    await asStaff.page.close();
  }, "public/app/money.html");
});

test("Money: the six-link nav keeps its order, marks Money as the current page, and carries the client for staff", { timeout: 90_000 }, async () => {
  await proof.check(/^Money nav: Money \(current\), Accounts, Credit, Connections, Payments, Setup \(6 links\)/, async () => {
    const six = ["Money", "Accounts", "Credit", "Connections", "Payments", "Setup"];
    const hash = ["overview", "accounts", "credit", "connections", "payments", "setup"];
    const asClient = await screens.open("/app/money.html", { session: CLIENT, handlers: { "/api/money/overview": OVERVIEW } });
    await asClient.page.waitForSelector("#money-root .big");
    const clientNav = await navOf(asClient.page);
    assert.deepEqual(clientNav.map((l) => l.label), six);
    assert.deepEqual(clientNav.map((l) => l.href), hash.map((h) => `${FRAME}#${h}`), "each word goes to its own tab, with no client named");
    assert.deepEqual(clientNav.filter((l) => l.current).map((l) => l.label), ["Money"], "Money is the one current page");
    assertLandings(clientNav, hash, "client");
    await asClient.page.close();
    const asStaff = await screens.open(`/app/money.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { "/api/money/overview": OVERVIEW } });
    await asStaff.page.waitForSelector("#money-root .big");
    const staffNav = await navOf(asStaff.page);
    assert.deepEqual(staffNav.map((l) => l.label), six);
    assert.deepEqual(staffNav.map((l) => l.href), hash.map((h) => `${FRAME}?client_id=${CLIENT_ID}#${h}`), "every link carries the client, before the #tab");
    assertLandings(staffNav, hash, "staff");
    await asStaff.page.close();
  }, "public/app/money.html");
});

test("Money: a failed read shows Try again, and pressing it reads again and paints the page", { timeout: 90_000 }, async () => {
  await proof.check(/^Try again \(button on the error panel\)/, async () => {
    const read = flaky(OVERVIEW);
    const { page, errors } = await screens.open(`/app/money.html?client_id=${CLIENT_ID}`, {
      session: STAFF, handlers: { "/api/money/overview": read.handler },
    });
    await page.waitForSelector('[data-act="retry"]');
    assert.equal(await textOf(page.locator('[data-act="retry"]')), "Try again", "the button itself says Try again (the sentence above it also says it)");
    assert.match(await page.locator("#money-root").innerText(), /We could not load your money page/);
    assert.match(await page.locator("#money-root").innerText(), /Something went wrong on our side while loading your accounts/);
    assert.equal(await page.locator("#money-root .big").count(), 0, "no numbers are painted over the error");
    assert.deepEqual(read.state.reads, [`?client_id=${CLIENT_ID}`]);
    read.state.ok = true;
    await page.locator('[data-act="retry"]').click();
    await waitFor(() => read.state.reads.length === 2, "the second overview read");
    await page.waitForSelector("#money-root .big");
    assert.equal(await page.locator('[data-act="retry"]').count(), 0, "the error is gone once the read works");
    assert.deepEqual(read.state.reads, [`?client_id=${CLIENT_ID}`, `?client_id=${CLIENT_ID}`], "it asks for the same client again");
    assert.match(await page.locator("#money-root").innerText(), /Personal Checking/);
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money.html");
});

// ───────────────────────── money-transfers.html ─────────────────────────

const TRANSFERS = sampleAnswer("money-transfers.sample.json");
const TRANSFERS_ROOT = "#transfers-root";

test("Transfers: the Back link names the portal for a client and Finance OS for staff naming a client", { timeout: 90_000 }, async () => {
  await proof.check(/^Back to my portal \/ Back to Finance OS \(header link\)/, async () => {
    const asClient = await screens.open("/app/money-transfers.html", { session: CLIENT, handlers: { "/api/money/transfers": TRANSFERS } });
    await asClient.page.waitForSelector(`${TRANSFERS_ROOT} .fh-transfers h2`);
    assert.deepEqual(await backOf(asClient.page), ["Back to my portal", "client-portal.html"]);
    await asClient.page.close();
    const asStaff = await screens.open(`/app/money-transfers.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { "/api/money/transfers": TRANSFERS } });
    await asStaff.page.waitForSelector(`${TRANSFERS_ROOT} .fh-transfers h2`);
    assert.deepEqual(await backOf(asStaff.page), ["Back to Finance OS", `finance-os.html?client_id=${CLIENT_ID}`]);
    await asStaff.page.close();
  }, "public/app/money-transfers.html");
});

test("Transfers: the seven-link nav keeps its order, marks Transfers as current, and carries the client for staff", { timeout: 90_000 }, async () => {
  await proof.check(/^Money nav: Money, Next steps, Plan, Accounts, Payments, Transfers, Setup \(7 links/, async () => {
    const seven = ["Money", "Next steps", "Plan", "Accounts", "Payments", "Transfers", "Setup"];
    const hash = ["overview", "next", "plan", "accounts", "payments", "transfers", "setup"];
    const asClient = await screens.open("/app/money-transfers.html", { session: CLIENT, handlers: { "/api/money/transfers": TRANSFERS } });
    await asClient.page.waitForSelector(`${TRANSFERS_ROOT} .fh-transfers h2`);
    const clientNav = await navOf(asClient.page);
    assert.deepEqual(clientNav.map((l) => l.label), seven);
    assert.deepEqual(clientNav.map((l) => l.href), hash.map((h) => `${FRAME}#${h}`));
    assert.deepEqual(clientNav.filter((l) => l.current).map((l) => l.label), ["Transfers"]);
    assertLandings(clientNav, hash, "client");
    await asClient.page.close();
    const asStaff = await screens.open(`/app/money-transfers.html?client_id=${CLIENT_ID}`, { session: STAFF, handlers: { "/api/money/transfers": TRANSFERS } });
    await asStaff.page.waitForSelector(`${TRANSFERS_ROOT} .fh-transfers h2`);
    const staffNav = await navOf(asStaff.page);
    assert.deepEqual(staffNav.map((l) => l.label), seven);
    assert.deepEqual(staffNav.map((l) => l.href), hash.map((h) => `${FRAME}?client_id=${CLIENT_ID}#${h}`));
    assertLandings(staffNav, hash, "staff");
    await asStaff.page.close();
  }, "public/app/money-transfers.html");
});

test("Transfers: a failed read shows Try again, and pressing it reads again and paints the moves", { timeout: 90_000 }, async () => {
  await proof.check(/^Try again \(button on the error panel\)/, async () => {
    const read = flaky(TRANSFERS);
    const { page, errors } = await screens.open(`/app/money-transfers.html?client_id=${CLIENT_ID}`, {
      session: STAFF, handlers: { "/api/money/transfers": read.handler },
    });
    await page.waitForSelector('[data-act="retry"]');
    assert.equal(await textOf(page.locator('[data-act="retry"]')), "Try again", "the button itself says Try again (the sentence above it also says it)");
    assert.match(await page.locator(TRANSFERS_ROOT).innerText(), /We could not load your money moves/);
    assert.match(await page.locator(TRANSFERS_ROOT).innerText(), /Something went wrong on our side while loading your money moves/);
    assert.equal(await page.locator("article.wt, table").count(), 0, "no moves are painted over the error");
    read.state.ok = true;
    await page.locator('[data-act="retry"]').click();
    await waitFor(() => read.state.reads.length === 2, "the second transfers read");
    await page.waitForSelector("table");
    assert.equal(await page.locator('[data-act="retry"]').count(), 0);
    assert.deepEqual(read.state.reads, [`?client_id=${CLIENT_ID}`, `?client_id=${CLIENT_ID}`], "it asks for the same client again");
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money-transfers.html");
});

// One move whose story holds every kind of line the page can say, plus one the page has no words for.
const EVENT = (type, leg = null) => ({ type, at: "2026-10-07T04:08:01.000Z", leg, actor: "provider", from_status: null, to_status: "approved" });
const STORY = [
  [EVENT("approved"), "Said yes (practice run, sandbox)"],
  [EVENT("started"), "Started today's move"],
  [EVENT("authorized", "debit"), "Bank check passed"],
  [EVENT("submitted", "debit"), "Asked the bank to take the money out"],
  [EVENT("plaid_posted", "debit"), "Out of Personal Checking ••1101: sent"],
  [EVENT("plaid_settled", "credit"), "Into Business Checking ••2202: done"],
  [EVENT("provider_wait"), "The bank did not answer — trying again"],
  [EVENT("date_passed"), "The date passed — nothing moved"],
  [EVENT("brand_new_kind"), "brand new kind"],
];

function transfersWithStory() {
  const answer = JSON.parse(JSON.stringify(TRANSFERS));
  const first = answer.history[0];
  first.transfer.events = STORY.map(([event]) => event);
  // a second move the client themselves approved, and a third with no ledger lines at all
  const byClient = JSON.parse(JSON.stringify(first));
  byClient.id = "7b0f0c52-31d6-4f0e-9d6e-2a51f1e0a0b1";
  byClient.transfer = { ...byClient.transfer, id: "9c1d2e3f-0000-4000-8000-00000000a0b1", approved_by: "client", environment: "production",
    events: [EVENT("approved"), EVENT("cancelled")] };
  const quiet = JSON.parse(JSON.stringify(first));
  quiet.id = "7b0f0c52-31d6-4f0e-9d6e-2a51f1e0a0b2";
  quiet.transfer = { ...quiet.transfer, id: "9c1d2e3f-0000-4000-8000-00000000a0b2", events: [] };
  answer.history.push(byClient, quiet);
  return { answer, first, byClient, quiet };
}

test("Transfers: the What happened fold opens on click and tells each ledger event in words, on the right side of the move", { timeout: 90_000 }, async () => {
  await proof.check(/^What happened \(details toggle: ledger events in words\)/, async () => {
    const { answer, first, byClient, quiet } = transfersWithStory();
    const { page, errors } = await screens.open("/app/money-transfers.html", { session: CLIENT, handlers: { "/api/money/transfers": answer } });
    await page.waitForSelector("table");
    const fold = (id) => page.locator(`tr[data-id="${id}"] details.tx-events`);
    assert.equal(await fold(first.id).count(), 1, "a move with ledger lines has the fold");
    assert.equal(await fold(quiet.id).count(), 0, "a move with no ledger lines has no empty fold");
    assert.equal(await fold(first.id).evaluate((el) => el.open), false, "the fold starts shut");
    assert.equal(await fold(first.id).locator("li").first().isVisible(), false, "the lines are hidden until the fold is opened");

    await fold(first.id).locator("summary").click();
    assert.equal(await fold(first.id).evaluate((el) => el.open), true, "pressing What happened opens it");
    // each line is a time and then its words; read them apart so both are judged
    const parts = await fold(first.id).locator("li").evaluateAll((items) => items.map((li) => {
      const time = li.querySelector("time");
      const stamp = time ? time.textContent.trim() : "";
      return { stamp, at: time ? time.getAttribute("datetime") : null, words: li.textContent.replace(stamp, "").replace(/\s+/g, " ").trim() };
    }));
    assert.equal(parts.length, STORY.length, "one line for each ledger event, none dropped");
    STORY.forEach(([event, words], i) => {
      assert.equal(parts[i].words, words, `line ${i + 1} (${event.type}) says exactly its words`);
      assert.equal(parts[i].at, event.at, `line ${i + 1} (${event.type}) carries the time of its event`);
      assert.notEqual(parts[i].stamp, "", `line ${i + 1} (${event.type}) shows a time`);
    });

    // a move the client said yes to says "Said yes", not the practice-run words
    await fold(byClient.id).locator("summary").click();
    const mine = (await fold(byClient.id).locator("li").evaluateAll((items) => items.map((li) => {
      const stamp = li.querySelector("time").textContent.trim();
      return li.textContent.replace(stamp, "").replace(/\s+/g, " ").trim();
    })));
    assert.deepEqual(mine, ["Said yes", "Stopped"], "a client's own yes is just 'Said yes', and a cancelled move says Stopped");
    // the first fold stays open: each move has its own
    assert.equal(await fold(first.id).evaluate((el) => el.open), true);
    await fold(first.id).locator("summary").click();
    assert.equal(await fold(first.id).evaluate((el) => el.open), false, "pressing it again shuts it");
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money-transfers.html");
});

// ───────────────────────── money-vault.html ─────────────────────────

const BIZ = "386c687a-167d-4d44-a000-8d50b5a80191";

function vaultView(audience) {
  const v = sampleVault({ variant: "full", audience });
  return v;
}

async function openVault({ session = CLIENT, clientId = "", audience = "client", handler = null } = {}) {
  const posts = [];
  const reads = [];
  const answer = vaultView(audience);
  const read = handler || (async (route, { url, method }) => {
    if (method === "POST") {
      posts.push(JSON.parse(route.request().postData() || "{}"));
      return json(route, { ok: true, result: { item_key: "x" } });
    }
    reads.push(new URL(url).search);
    return json(route, answer);
  });
  const opened = await screens.open(`/app/money-vault.html${clientId ? `?client_id=${clientId}` : ""}`, {
    session, handlers: { "/api/money/vault": read },
  });
  return { ...opened, posts, reads, answer };
}

test("Funding papers: the Back link names the portal for a client and Finance OS for staff naming a client", { timeout: 90_000 }, async () => {
  await proof.check(/^Back to my portal \/ Back to Finance OS \(header link\)/, async () => {
    const asClient = await openVault();
    await asClient.page.waitForSelector(".fh-vault .vt-item");
    assert.deepEqual(await backOf(asClient.page), ["Back to my portal", "client-portal.html"]);
    await asClient.page.close();
    const asStaff = await openVault({ session: STAFF, clientId: CLIENT_ID, audience: "staff" });
    await asStaff.page.waitForSelector(".fh-vault .vt-item");
    assert.deepEqual(await backOf(asStaff.page), ["Back to Finance OS", `finance-os.html?client_id=${CLIENT_ID}`]);
    await asStaff.page.close();
  }, "public/app/money-vault.html");
});

test("Funding papers: the eight-link nav keeps its order, marks Funding papers as current, and carries the client for staff", { timeout: 90_000 }, async () => {
  await proof.check(/^Money nav: Money, Accounts, Credit, Applications, Funding papers \(current\), Connections, Payments, Setup \(8 links\)/, async () => {
    const eight = ["Money", "Accounts", "Credit", "Applications", "Funding papers", "Connections", "Payments", "Setup"];
    const target = (query = "") => [
      `${FRAME}${query}#overview`, `${FRAME}${query}#accounts`, `${FRAME}${query}#credit`, `${FRAME}${query}#declines`,
      `/app/money-vault.html${query}`, `${FRAME}${query}#connections`, `${FRAME}${query}#payments`, `${FRAME}${query}#setup`,
    ];
    const asClient = await openVault();
    await asClient.page.waitForSelector(".fh-vault .vt-item");
    const clientNav = await navOf(asClient.page);
    assert.deepEqual(clientNav.map((l) => l.label), eight);
    assert.deepEqual(clientNav.map((l) => l.href), target());
    assert.deepEqual(clientNav.filter((l) => l.current).map((l) => l.label), ["Funding papers"]);
    assertLandings(clientNav, ["overview", "accounts", "credit", "declines", null, "connections", "payments", "setup"], "client");
    await asClient.page.close();
    const asStaff = await openVault({ session: STAFF, clientId: CLIENT_ID, audience: "staff" });
    await asStaff.page.waitForSelector(".fh-vault .vt-item");
    const staffNav = await navOf(asStaff.page);
    assert.deepEqual(staffNav.map((l) => l.label), eight);
    assert.deepEqual(staffNav.map((l) => l.href), target(`?client_id=${CLIENT_ID}`));
    assertLandings(staffNav, ["overview", "accounts", "credit", "declines", null, "connections", "payments", "setup"], "staff");
    await asStaff.page.close();
  }, "public/app/money-vault.html");
});

test("Funding papers: a failed read shows Try again, and pressing it reads again and paints the papers", { timeout: 90_000 }, async () => {
  await proof.check(/^Try again \(button on the error panel\)/, async () => {
    const read = flaky(vaultView("client"));
    const { page, errors } = await screens.open("/app/money-vault.html", { session: CLIENT, handlers: { "/api/money/vault": read.handler } });
    await page.waitForSelector('[data-act="retry"]');
    assert.equal(await page.locator(".fh-vault .vt-item").count(), 0, "no papers are painted over the error");
    // the error sentence ("Try again in a few minutes") also holds these words, so read the button on its own
    assert.equal(await textOf(page.locator('[data-act="retry"]')), "Try again", "the button itself says Try again");
    read.state.ok = true;
    await page.locator('[data-act="retry"]').click();
    await waitFor(() => read.state.reads.length === 2, "the second vault read");
    await page.waitForSelector(".fh-vault .vt-item");
    assert.equal(await page.locator('[data-act="retry"]').count(), 0, "the error is gone once the read works");
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money-vault.html");
});

test("Funding papers: Cancel closes an open accept, reject or sort form, clears its message, and sends nothing", { timeout: 120_000 }, async () => {
  await proof.check(/^Staff: Cancel \(closes an open accept\/reject\/sort form\)/, async () => {
    const { page, posts, answer, errors } = await openVault({ session: STAFF, clientId: CLIENT_ID, audience: "staff" });
    await page.waitForSelector(".fh-vault .vt-item");
    const waiting = answer.items.flatMap((i) => i.documents || []).filter((d) => d.status === "uploaded");
    const statement = answer.items.find((i) => i.slot.startsWith("bank_statements_business")).documents.find((d) => d.status === "uploaded");
    assert.ok(waiting.length >= 2, "the sample has files waiting for review");
    const row = (doc) => page.locator(`li.vt-doc[data-doc="${doc.id}"]`);
    const visible = (locator) => locator.evaluate((el) => !el.hidden);
    // the button is found by its action and its own words are read before it is pressed, so a blank or
    // renamed Cancel is a person looking at a button with the wrong words, and the test goes red
    const cancelOf = async (form, which) => {
      const button = form.locator('[data-act="cancel"]');
      assert.equal(await button.count(), 1, `${which} has one Cancel button`);
      assert.equal(await textOf(button), "Cancel", `${which}'s button says Cancel`);
      return button;
    };

    // accept form (a bank statement asks for months and a date, so it has a form)
    const accept = row(statement).locator('.vt-form[data-form="accept"]');
    assert.equal(await visible(accept), false, "the accept form starts shut");
    await row(statement).locator('[data-act="accept"]').click();
    assert.equal(await visible(accept), true, "Accept opens its form");
    await (await cancelOf(accept, "the accept form")).click();
    assert.equal(await visible(accept), false, "Cancel shuts the accept form");

    // reject form: send it empty so it shows its message, then Cancel clears that message
    const reject = row(statement).locator('.vt-form[data-form="reject"]');
    await row(statement).locator('[data-act="reject"]').click();
    assert.equal(await visible(reject), true, "Reject opens its form");
    await reject.locator('[data-act="reject-send"]').click();
    await page.waitForFunction((id) => /Write what the client should fix\./.test(document.querySelector(`li.vt-doc[data-doc="${id}"] .vt-form[data-form="reject"] .vt-form-msg`).innerText), statement.id);
    await (await cancelOf(reject, "the reject form")).click();
    assert.equal(await visible(reject), false, "Cancel shuts the reject form");
    assert.equal((await reject.locator(".vt-form-msg").innerText()).trim(), "", "Cancel also clears the message so it is not there on the next open");
    await row(statement).locator('[data-act="reject"]').click();
    assert.equal((await reject.locator(".vt-form-msg").innerText()).trim(), "", "the form opens clean");
    await (await cancelOf(reject, "the reject form")).click();

    // the two sort forms on a file nobody filed yet
    const scan = answer.unfiled[0];
    const sortRow = page.locator(`.vt-sort li.vt-doc[data-doc="${scan.id}"]`);
    const sortAccept = sortRow.locator('.vt-form[data-form="accept"]');
    const sortReject = sortRow.locator('.vt-form[data-form="reject"]');
    await sortRow.locator('[data-act="sort-accept"]').click();
    assert.equal(await visible(sortAccept), true, "File and accept opens the sort form");
    await (await cancelOf(sortAccept, "the sort accept form")).click();
    assert.equal(await visible(sortAccept), false, "Cancel shuts the sort accept form");
    await sortRow.locator('[data-act="sort-reject"]').click();
    assert.equal(await visible(sortReject), true, "Reject opens the sort reject form");
    await (await cancelOf(sortReject, "the sort reject form")).click();
    assert.equal(await visible(sortReject), false, "Cancel shuts the sort reject form");

    assert.deepEqual(posts, [], "no Cancel sent a request");
    assert.deepEqual(errors, []);
    await page.close();
  }, "public/app/money-vault.html");
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
