// Proves the Accounts forms, the Move to select and Connect a bank, on the
// standalone page (money-accounts.html) and in the frame (financeos.html#accounts).

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, bankLink, entryUrl, moneyResource, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const ME = "aaaaaaaa-0000-0000-0000-000000000001";
const BIZ = "aaaaaaaa-0000-0000-0000-000000000002";
const TARGETS = {
  page: { entry: "page", file: "money-accounts.html", surface: "money-accounts.html" },
  frame: { entry: "frame", tab: "accounts", surface: "financeos.html#accounts" },
};
const ROW = {
  page: {
    gate: /^Page gate:/, business: /^'Add a business' form/, save: /^Business card 'Edit business info'/,
    personal: /^'You' container/, move: /^Per-account 'Move to...' select/, account: /^'Add account by hand' form/,
    connect: /^'Connect a bank' button/,
  },
  frame: {
    business: /^Add a business form and 'Save business info'/, save: /^Add a business form and 'Save business info'/,
    personal: /^'Add personal container' form/, move: /^'Move to...' select on each account/,
    account: /^Add account form/, connect: /^Connect a bank button/,
  },
};
const FIELDS = {
  legal_name: "Mountain Works LLC", dba: "Mountain Works", ein_last4: "4321", entity_type: "llc", formation_state: "AZ",
  started: "2024-05", industry: "Landscaping", address_line1: "12 Ridge Rd", city: "Flagstaff", state: "AZ",
  postal_code: "86001", phone: "9285550100", website: "mountainworks.example",
};

const account = (id, name, over = {}) => ({
  id, source: "bank_account", name, mask: "1101", type: "depository", subtype: "checking", container_id: null,
  current_cents: 421055, provider: "manual", closed_at: null, ...over,
});
function view({ withPersonal = true, extra = [] } = {}) {
  return {
    ok: true,
    client_id: CLIENT_ID,
    containers: [
      ...(withPersonal ? [{ id: ME, kind: "personal", name: "Chris (personal)", archived_at: null, business: null,
        accounts: [account("a1", "Personal Checking", { container_id: ME })], cards: [], loans: [], bills: [] }] : []),
      { id: BIZ, kind: "business", name: "Fundhub LLC", archived_at: null, business: null, accounts: [], cards: [], loans: [], bills: [] },
      ...extra,
    ],
    unassigned: { accounts: [account("u1", "Mystery Savings", { subtype: "savings", mask: "5505" })], cards: [], loans: [], bills: [] },
    billing: { containers: 2, price_per_container_cents: null, monthly_cents: null },
  };
}

// The section repaints from each answer and says what happened in #head-msg.
const saidIn = (page, text) => page.waitForFunction((words) => document.querySelector("#head-msg")?.textContent === words, text);

async function openAccounts(open, target, { session = STAFF, clientId = CLIENT_ID, read = view, write } = {}) {
  const resource = moneyResource("accounts", { read, write });
  const bank = bankLink();
  const opened = await open(entryUrl(target.entry, { ...target, clientId }), { session, handlers: { ...resource.handlers, ...bank.handlers } });
  await bank.stubBankWindow(opened.page);
  return { ...opened, ...resource.log, link: bank };
}

test("the forms post the exact request and the section repaints from the answer", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  for (const target of Object.values(TARGETS)) {
    const rows = ROW[target.entry];
    const state = { personal: false };
    const extra = [{ id: "bbbbbbbb-0000-0000-0000-000000000003", kind: "business", name: "Mountain Works LLC", archived_at: null,
      business: { ...FIELDS }, accounts: [], cards: [], loans: [], bills: [] }];
    const { page, posts, reads, errors, link } = await openAccounts(open, target, {
      read: () => view({ withPersonal: false }),
      // The answer is the whole new view; a personal container exists only once one is created.
      write: (body) => {
        if (body.action === "create_personal") state.personal = true;
        return { status: 200, body: view({ withPersonal: state.personal, extra }) };
      },
    });
    await page.waitForSelector("#add-business");
    assert.deepEqual(reads, [`?client_id=${CLIENT_ID}`]);

    // `rows.business` and `rows.save` are one listed row on the frame, so the frame claims it after both forms pass.
    const addBusiness = async () => {
      // Add a business: name plus the thirteen info fields
      await page.locator('[data-act="open-business"]').click();
      const bizForm = page.locator('#add-business form[data-form="create_business"]');
      await bizForm.locator('[name="name"]').fill("Mountain Works LLC");
      for (const [name, value] of Object.entries(FIELDS)) {
        const field = bizForm.locator(`[name="${name}"]`);
        if (name === "entity_type") await field.selectOption(value);
        else await field.fill(value);
      }
      await bizForm.locator('button[type="submit"]').click();
      await waitFor(() => posts.some((p) => p.action === "create_business"));
      assert.deepEqual(posts.at(-1), { action: "create_business", name: "Mountain Works LLC", info: FIELDS, client_id: CLIENT_ID });
      await saidIn(page, "Business added.");
      assert.equal(await page.locator('section.container[data-kind="business"]').count(), 2, "the new business card appears");
    };
    const saveBusiness = async () => {
      // Save business info on a card: edits one field of a business with info
      posts.length = 0;
      await page.locator('section.container[data-container="bbbbbbbb-0000-0000-0000-000000000003"] details.form > summary').click();
      const edit = page.locator('form[data-form="save_business"][data-container="bbbbbbbb-0000-0000-0000-000000000003"]');
      assert.equal(await edit.locator('[name="city"]').inputValue(), "Flagstaff");
      await edit.locator('[name="city"]').fill("Sedona");
      await edit.locator('button[type="submit"]').click();
      await waitFor(() => posts.some((p) => p.action === "save_business"));
      assert.deepEqual(posts.at(-1), {
        action: "save_business", container_id: "bbbbbbbb-0000-0000-0000-000000000003", info: { ...FIELDS, city: "Sedona" }, client_id: CLIENT_ID,
      });
      await saidIn(page, "Business info saved.");
    };
    if (target.entry === "page") {
      await proof.check(rows.business, addBusiness, target.surface);
      await proof.check(rows.save, saveBusiness, target.surface);
    } else {
      await proof.check(rows.business, async () => { await addBusiness(); await saveBusiness(); }, target.surface);
    }

    await proof.check(rows.personal, async () => {
      // Add a personal container (none exists in this read)
      posts.length = 0;
      const personal = page.locator('form[data-form="create_personal"]');
      await personal.locator('[name="name"]').fill("Chris Stanbridge");
      await personal.locator('button[type="submit"]').click();
      await waitFor(() => posts.some((p) => p.action === "create_personal"));
      assert.deepEqual(posts.at(-1), { action: "create_personal", name: "Chris Stanbridge", client_id: CLIENT_ID });
      await saidIn(page, "Personal container added.");
      assert.equal(await page.locator('section.container[data-kind="personal"]').count(), 1, "the personal container now shows");
    }, target.surface);

    await proof.check(rows.account, async () => {
      // Add account by hand: a credit card carries limit, due day and minimum
      posts.length = 0;
      await page.locator('[data-act="open-add"]').click();
      const form = page.locator('form[data-form="add_account"]');
      await form.locator('[name="name"]').fill("Chase Ink");
      await form.locator('[name="type"]').selectOption("credit_card");
      await form.locator('[name="container_id"]').selectOption(BIZ);
      await form.locator('[name="last4"]').fill("1234");
      await form.locator('[name="balance"]').fill("2,000");
      await form.locator('[name="limit"]').fill("10,000");
      await form.locator('[name="due_day"]').fill("15");
      await form.locator('[name="minimum"]').fill("35");
      await form.locator('button[type="submit"]').click();
      await waitFor(() => posts.some((p) => p.action === "add_account"));
      assert.deepEqual(posts.at(-1), {
        action: "add_account", name: "Chase Ink", type: "credit_card", last4: "1234", balance: "2,000",
        limit: "10,000", due_day: "15", minimum: "35", container_id: BIZ, client_id: CLIENT_ID,
      });
      await saidIn(page, "Account saved.");
    }, target.surface);

    await proof.check(rows.move, async () => {
      // Move to…: assign to a business, then back to Not sorted yet
      posts.length = 0;
      const move = page.locator('select[data-act="move"][data-account="u1"]');
      await move.selectOption(BIZ);
      await waitFor(() => posts.some((p) => p.action === "assign"));
      assert.deepEqual(posts.at(-1), { action: "assign", account_id: "u1", container_id: BIZ, client_id: CLIENT_ID });
      await saidIn(page, "Account moved.");
      await page.locator('select[data-act="move"][data-account="a1"]').selectOption("");
      await waitFor(() => posts.some((p) => p.action === "unassign"));
      assert.deepEqual(posts.at(-1), { action: "unassign", account_id: "a1", client_id: CLIENT_ID });
      await saidIn(page, "Account moved to Not sorted yet.");
    }, target.surface);

    await proof.check(rows.connect, async () => {
      // Connect a bank: link token, the bank's window, then the exchange
      await page.locator('[data-act="connect"]').click();
      await waitFor(() => link.posts.some((p) => p.path === "link-exchange"));
      assert.deepEqual(link.posts, link.expected(CLIENT_ID));
    }, target.surface);
    assert.deepEqual(errors, []);
    await page.close();
  }
});

test("a client reads their own file; staff need a client file", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(ROW.page.gate, async () => {
    const own = await openAccounts(open, TARGETS.page, { session: CLIENT, clientId: "" });
    await own.page.waitForSelector(".card.container");
    assert.deepEqual(own.reads, [""]);
    await own.page.close();

    const lost = moneyResource("accounts", { read: () => ({ ok: false, error: "client_id_required" }), readStatus: 400 });
    const staff = await open("/app/money-accounts.html", { session: STAFF, handlers: lost.handlers });
    await staff.page.waitForFunction(() => /needs to know whose accounts/.test(document.body.innerText));
    await staff.page.close();

    // no session: the read is refused with 401, and the page sends a client to the portal sign-in
    // and staff (a cached staff role, or a client file in the address) to the staff sign-in, back to the same page
    const refused = moneyResource("accounts", { read: () => ({ ok: false, error: "unauthorized" }), readStatus: 401 });
    const signedOut = await open("/app/money-accounts.html", { session: null, handlers: refused.handlers });
    await signedOut.page.waitForURL(/\/portal-login\.html$/);
    await signedOut.page.close();
    const staffOut = await open(`/app/money-accounts.html?client_id=${CLIENT_ID}`, { session: null, handlers: refused.handlers });
    await staffOut.page.waitForURL(/\/login\.html\?next=/);
    assert.equal(new URL(staffOut.page.url()).searchParams.get("next"), `/app/money-accounts.html?client_id=${CLIENT_ID}`);
    await staffOut.page.close();
  }, TARGETS.page.surface);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
