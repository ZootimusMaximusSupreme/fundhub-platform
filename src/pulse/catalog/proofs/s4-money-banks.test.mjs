// Proves the staff plan controls and the page gate of the Banks section, on the
// standalone page (money-banks.html) and on its tab in the frame
// (financeos.html#banks). Same script, same forms, same exact requests.

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const BUSINESS = "386c687a-167d-4d44-a000-8d50b5a80191";
const PERSONAL = "36b90655-f93d-4444-90a8-ccf713426e56";
const ENTRIES = {
  page: { entry: "page", file: "money-banks.html", surface: "money-banks.html" },
  frame: { entry: "frame", tab: "banks", surface: "financeos.html#banks" },
};
// Which listed row each action proves, per surface.
const ROW = {
  page: {
    gate: /^Page gate:/, plan: /^Banks near you: per-bank 'Add to plan' form/, addBank: /^'Add a bank to the plan' form/,
    open: /^Relationship row \(planned\)/, skip: /^Relationship row: 'Skip this bank'/,
    deposit: /^Relationship row \(opened\)/, date: /^Next funding sequence 'Save date'/,
  },
  frame: {
    plan: /^Staff only: 'Add to plan' on a bank card/, addBank: /^Staff only: 'Add to plan' on a bank card/,
    open: /^Staff only: 'Mark opened'/, skip: /^Staff only: 'Skip this bank'/,
    deposit: /^Staff only: 'Add deposit'/, date: /^Staff only: 'Save date'/,
  },
};

function banksRead() {
  const answer = sampleAnswer("money-banks.sample.json");
  const rel = (id, bank, over) => ({
    id, bank, bank_key: bank.toLowerCase(), account_kind: "business", lender_id: null, container_id: BUSINESS,
    container_name: "Fundhub LLC", status: "planned", status_text: "Planned", planned_open_on: "2026-11-02",
    planned_deposit_cents: null, deposit_plan_cents: 500000, opened_on: null, months_of_history: null,
    deposits: [], deposits_total_cents: null, seasoning: null, ...over,
  });
  answer.relationships = [
    rel("aaaaaaaa-0000-4000-8000-000000000001", "Chase"),
    rel("aaaaaaaa-0000-4000-8000-000000000002", "Wells", { status: "open", status_text: "Open · day not recorded" }),
    rel("aaaaaaaa-0000-4000-8000-000000000003", "Truist", {
      status: "seasoning", status_text: "Open · 10 of 30 days seasoned", opened_on: "2026-09-26", deposits_total_cents: 100000,
      deposits: [{ id: "d1", amount_cents: 100000, deposited_on: "2026-09-27", note: null }],
    }),
  ];
  answer.next_round = { ...answer.next_round, can_set_date: true, date: null };
  return answer;
}

async function openBanks(open, target, { session = STAFF, clientId = CLIENT_ID, write } = {}) {
  const resource = moneyResource("banks", { read: banksRead, write });
  const { page, errors } = await open(entryUrl(target.entry, { ...target, clientId }), { session, handlers: resource.handlers });
  return { page, errors, ...resource.log, resource };
}

test("staff plan controls post the exact request on the page and in the frame", { timeout: 120_000 }, async (t) => {
  const { open } = await startScreens(t);
  for (const target of Object.values(ENTRIES)) {
    const rows = ROW[target.entry];
    // Every control below is staff only: the same section opened by a client draws none of them.
    const clientView = await openBanks(open, target, { session: CLIENT, clientId: "" });
    await clientView.page.waitForSelector(".fh-banks .card");
    assert.deepEqual(clientView.reads, [""], "a client asks for their own file, with no client_id");
    const clientControls = await clientView.page.locator(".fh-banks .staff, .fh-banks form[data-form]").count();
    await clientView.page.close();
    const staffOnly = () => assert.equal(clientControls, 0, `${target.entry}: a client sees none of the staff plan controls`);

    const ctx = await openBanks(open, target);
    const { page, posts, reads } = ctx;
    await page.waitForSelector(".fh-banks .addbank");
    assert.deepEqual(reads, [`?client_id=${CLIENT_ID}`]);
    // Every good save is followed by a re-read that repaints the section. Wait for it
    // before the next press, or the repaint can wipe what the next press just wrote.
    let expectedReads = reads.length;
    const posted = async (action) => {
      await waitFor(() => posts.some((p) => p.action === action));
      expectedReads += 1;
      await waitFor(() => reads.length === expectedReads);
      return posts.filter((p) => p.action === action).at(-1);
    };

    // per-bank "Add to plan", then the free-typed "Add a bank to the plan" form
    const planBank = async () => {
      staffOnly();
      const bankForm = page.locator('.fh-banks form[data-form="plan"][data-bank="Bank of America"]');
      await bankForm.locator('[name="planned_open_on"]').fill("2026-11-03");
      await bankForm.locator('[name="deposit"]').fill("5,000.00");
      await bankForm.locator('button[type="submit"]').click();
      assert.deepEqual(await posted("plan_bank"), {
        action: "plan_bank", bank: "Bank of America", account_kind: "business", planned_open_on: "2026-11-03",
        planned_deposit_cents: 500000, lender_id: "d9bd0743-5439-4041-bd11-18925ac8ecf3", container_id: BUSINESS, client_id: CLIENT_ID,
      });
    };
    const addBank = async () => {
      staffOnly();
      posts.length = 0;
      const addForm = page.locator('.fh-banks .addbank form[data-form="plan"]');
      await addForm.locator('[name="bank"]').fill("Mountain Credit Union");
      await addForm.locator('[name="account_kind"]').selectOption("personal");
      await addForm.locator('[name="container_id"]').selectOption(PERSONAL);
      await addForm.locator('button[type="submit"]').click();
      assert.deepEqual(await posted("plan_bank"), {
        action: "plan_bank", bank: "Mountain Credit Union", account_kind: "personal", planned_open_on: null,
        planned_deposit_cents: null, container_id: PERSONAL, client_id: CLIENT_ID,
      });
    };
    if (target.entry === "page") {
      await proof.check(rows.plan, planBank, target.surface);
      await proof.check(rows.addBank, addBank, target.surface);
    } else {
      // the frame lists one row for both forms, so it is claimed only when both pass
      await proof.check(rows.plan, async () => { await planBank(); await addBank(); }, target.surface);
    }

    await proof.check(rows.deposit, async () => {
      staffOnly();
      // a deposit typed wrong is refused on the page, nothing is posted
      posts.length = 0;
      const opened = page.locator('tr[data-rel="aaaaaaaa-0000-4000-8000-000000000003"] + tr form[data-form="deposit"]');
      await opened.locator('[name="amount"]').fill("lots");
      await opened.locator('[name="deposited_on"]').fill("2026-10-05");
      await opened.locator('button[type="submit"]').click();
      await page.waitForFunction(() => /Type the amount deposited/.test(document.body.innerText));
      assert.deepEqual(posts, []);
      await opened.locator('[name="amount"]').fill("2,500.50");
      await opened.locator('button[type="submit"]').click();
      assert.deepEqual(await posted("record_deposit"), {
        action: "record_deposit", relationship_id: "aaaaaaaa-0000-4000-8000-000000000003",
        amount_cents: 250050, deposited_on: "2026-10-05", client_id: CLIENT_ID,
      });
    }, target.surface);

    await proof.check(rows.open, async () => {
      staffOnly();
      // mark opened (planned) and save the day opened (done, no day)
      posts.length = 0;
      for (const [id, label] of [["aaaaaaaa-0000-4000-8000-000000000001", "Mark opened"], ["aaaaaaaa-0000-4000-8000-000000000002", "Save the day opened"]]) {
        const form = page.locator(`tr[data-rel="${id}"] + tr form[data-form="open"]`);
        assert.equal(await form.locator('button[type="submit"]').innerText(), label);
        await form.locator('[name="opened_on"]').fill("2026-10-04");
        await form.locator('button[type="submit"]').click();
        await waitFor(() => posts.some((p) => p.relationship_id === id));
        assert.deepEqual(posts.find((p) => p.relationship_id === id), {
          action: "open_account", relationship_id: id, opened_on: "2026-10-04", client_id: CLIENT_ID,
        });
        expectedReads += 1;
        await waitFor(() => reads.length === expectedReads);
      }
    }, target.surface);

    await proof.check(rows.skip, async () => {
      staffOnly();
      // skip: Cancel posts nothing, OK posts the skip
      posts.length = 0;
      const skip = page.locator('tr[data-rel="aaaaaaaa-0000-4000-8000-000000000001"] + tr [data-act="skip"]');
      page.once("dialog", (dialog) => dialog.dismiss());
      await skip.click();
      await page.waitForTimeout(150);
      assert.deepEqual(posts, [], "cancelling the question posts nothing");
      page.once("dialog", (dialog) => { assert.match(dialog.message(), /Chase/); dialog.accept(); });
      await skip.click();
      assert.deepEqual(await posted("set_state"), {
        action: "set_state", relationship_id: "aaaaaaaa-0000-4000-8000-000000000001", state: "skipped", client_id: CLIENT_ID,
      });
    }, target.surface);

    await proof.check(rows.date, async () => {
      staffOnly();
      // next funding sequence date
      posts.length = 0;
      const round = page.locator('.fh-banks form[data-form="round"]');
      await round.locator('[name="ready_date"]').fill("2026-12-01");
      await round.locator('button[type="submit"]').click();
      assert.deepEqual(await posted("set_next_sequence_date"), { action: "set_next_sequence_date", ready_date: "2026-12-01", client_id: CLIENT_ID });
    }, target.surface);
    assert.deepEqual(ctx.errors, []);
    await page.close();
  }
});

test("the page gate: a client reads only their own file and sees no plan controls; staff need a client", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  await proof.check(ROW.page.gate, async () => {
    const own = await openBanks(open, ENTRIES.page, { session: CLIENT, clientId: "" });
    await own.page.waitForSelector(".fh-banks .card");
    assert.deepEqual(own.reads, [""], "a client asks for their own file, with no client_id");
    assert.equal(await own.page.locator(".fh-banks .staff").count(), 0, "a client sees no plan controls");
    await own.page.close();

    const staff = await openBanks(open, ENTRIES.page);
    await staff.page.waitForSelector(".fh-banks .staff");
    assert.deepEqual(staff.reads, [`?client_id=${CLIENT_ID}`]);
    assert.ok(await staff.page.locator(".fh-banks .staff").count() > 0, "staff on a client file see the plan controls");
    await staff.page.close();

    const noClient = moneyResource("banks", { read: () => ({ ok: false, error: "client_id_required" }), readStatus: 400 });
    const lost = await open("/app/money-banks.html", { session: STAFF, handlers: noClient.handlers });
    await lost.page.waitForFunction(() => /needs to know whose bank plan/.test(document.body.innerText));
    await lost.page.close();
  }, ENTRIES.page.surface);
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
