// Proves the Payments section: the read paints what is owed, the schedule, what
// is coming up, the helper's log and (staff only) unmatched Commas payments; and
// "Talk to a person" posts one ask. Standalone page and frame tab.

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const usd = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const TARGETS = {
  page: { entry: "page", file: "money-payments.html", surface: "public/app/money-payments.html" },
  frame: { entry: "frame", tab: "payments", surface: "financeos.html#payments" },
};

async function openPayments(open, target, { session, clientId, read }) {
  const resource = moneyResource("payments", { read });
  const opened = await open(entryUrl(target.entry, { ...target, clientId }), { session, handlers: resource.handlers });
  await opened.page.waitForSelector(".fh-payments .plan, .plan, .tile");
  return { ...opened, ...resource.log };
}

test("the read paints owed, schedule, coming up, the helper log and, for staff, unmatched payments", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const answer = sampleAnswer("money-payments.sample.json");
  await proof.check(/^Payments read: what is owed/, async () => {
    const staffRead = { ...answer, unmatched_payments: [{ reason: "more_than_owed", amount_cents: 12500, decided_on: "2026-10-05" }] };
    const { page, errors } = await openPayments(open, TARGETS.frame, { session: STAFF, clientId: CLIENT_ID, read: () => staffRead });
    const text = await page.locator("body").innerText();
    assert.match(text, new RegExp(`You owe Fundhub\\s+${usd(answer.owed.left_cents).replace(/[$.]/g, "\\$&")}`, "i"));
    assert.match(text, new RegExp(`Late now\\s+${usd(answer.owed.late_cents).replace(/[$.]/g, "\\$&")}`, "i"));
    assert.match(text, /Late 4 days/);
    for (const plan of answer.plans) {
      const card = page.locator(`article.plan[data-plan="${plan.id}"]`);
      assert.equal(await card.count(), 1, `${plan.name} has its card`);
      assert.match(await card.innerText(), new RegExp(usd(plan.left_cents).replace(/[$.]/g, "\\$&")));
      assert.equal(await card.locator("tbody tr").count(), plan.installments.length, `${plan.name} lists every payment`);
    }
    assert.equal(await page.locator("section[aria-labelledby='b-up'] li.row").count(), answer.upcoming.length);
    assert.equal(await page.locator("section[aria-labelledby='b-log'] .log li").count(), answer.agent_log.length);
    assert.match(text, /Commas payments not matched to a plan/i);
    assert.match(text, /It is more than is owed\./);
    assert.deepEqual(errors, []);
    await page.close();

    const client = await openPayments(open, TARGETS.frame, { session: CLIENT, clientId: "", read: () => staffRead });
    assert.doesNotMatch(await client.page.locator("body").innerText(), /Commas payments not matched/i, "a client never sees unmatched payments");
    assert.equal(await client.page.locator(".staff").count(), 0);
    await client.page.close();
  }, TARGETS.frame.surface);
});

test("Talk to a person posts one ask and says a person will reach out", { timeout: 60_000 }, async (t) => {
  const { open } = await startScreens(t);
  const rows = { page: /^Talk to a person/, frame: /^'Talk to a person' button/ };
  for (const target of Object.values(TARGETS)) {
    await proof.check(rows[target.entry], async () => {
      const { page, posts } = await openPayments(open, target, { session: CLIENT, clientId: "", read: () => sampleAnswer("money-payments.sample.json") });
      await page.locator('[data-act="person"]').click();
      await waitFor(() => posts.length === 1);
      assert.deepEqual(posts, [{ action: "ask_for_person" }]);
      await page.waitForFunction(() => /A person on our team will reach out soon\./.test(document.body.innerText));
      await page.close();
    }, target.surface);
  }
});

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
