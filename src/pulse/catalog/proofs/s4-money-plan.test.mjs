// Proves the Plan section: the month calendar and list show each dated pin, and
// staff Mark done / Mark missed asks first, then posts the exact request.
// Standalone page (money-plan.html) and frame tab (financeos.html#plan).

import { test } from "node:test";
import assert from "node:assert/strict";

import { proofRows, startScreens } from "./s4-screen-harness.mjs";
import { CLIENT, CLIENT_ID, STAFF, entryUrl, moneyResource, sampleAnswer, waitFor } from "./s4-money-harness.mjs";

const proof = proofRows(import.meta.url);
const TARGETS = {
  page: { entry: "page", file: "money-plan.html", surface: "public/app/money-plan.html" },
  frame: { entry: "frame", tab: "plan", surface: "financeos.html#plan" },
};
function planRead() {
  const answer = sampleAnswer("money-plan.sample.json");
  answer.viewer = "staff";
  for (const pin of answer.pins) if (pin.source === "dues") pin.can_mark = ["done", "missed"];
  return answer;
}

// "Pay SBA Loan" (Oct 1) and "Pay Business Amex" (Oct 15), both from the dues source.
const [PIN, OTHER] = [planRead().pins[0].id, planRead().pins[2].id];

async function openPlan(open, target, handlerOverrides = {}) {
  const resource = moneyResource("plan", {
    read: planRead,
    write: (body) => {
      const pin = planRead().pins.find((p) => p.id === body.pin_id);
      return { status: 200, body: { ok: true, pin: { ...pin, status: body.status, can_mark: [] } } };
    },
    ...handlerOverrides,
  });
  const opened = await open(entryUrl(target.entry, { ...target, clientId: CLIENT_ID }), { session: STAFF, handlers: resource.handlers });
  await opened.page.waitForSelector(".fh-plan .cal-grid");
  return { ...opened, ...resource.log };
}

test("the month calendar and the list show every dated pin; staff marks post the exact request", { timeout: 90_000 }, async (t) => {
  const { open } = await startScreens(t);
  for (const target of Object.values(TARGETS)) {
    const { page, posts, reads, errors } = await openPlan(open, target);
    const answer = planRead();
    assert.ok(reads[0].includes(`client_id=${CLIENT_ID}`));

    // calendar and list: every pin once each, in its day, with its title
    if (target.entry === "frame") {
      await proof.check(/^Month calendar and list of dated pins/, async () => {
        for (const pin of answer.pins) {
          const inCalendar = page.locator(`.cal-grid .pin[data-pin="${pin.id}"]`);
          const inList = page.locator(`.plan-list .row[data-pin="${pin.id}"]`);
          assert.equal(await inCalendar.count(), 1, `${pin.title} sits in the calendar`);
          assert.equal(await inList.count(), 1, `${pin.title} sits in the list`);
          assert.match(await inList.innerText(), new RegExp(pin.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
          const cell = page.locator(`.plan-list li.day[data-day-row="${pin.date}"] .row[data-pin="${pin.id}"]`);
          assert.equal(await cell.count(), 1, `${pin.title} is listed under ${pin.date}`);
        }
        assert.match(await page.locator("#pl-month").innerText(), /October 2026/);
      }, target.surface);
    }

    // The page lists "Mark done" alone; the frame lists "Mark done" and "Mark missed" as one row.
    const markDone = async () => {
      // Mark done: the question is asked first; Cancel posts nothing
      await page.locator(`.cal-grid .pin[data-pin="${PIN}"]`).click();
      await page.waitForSelector(".pl-drawer");
      page.once("dialog", (dialog) => dialog.dismiss());
      await page.locator('.pl-drawer [data-act="mark"][data-status="done"]').click();
      await page.waitForTimeout(150);
      assert.deepEqual(posts, [], "Cancel posts nothing");
      page.once("dialog", (dialog) => {
        assert.match(dialog.message(), /Pay SBA Loan.*done.*client sees this/);
        dialog.accept();
      });
      await page.locator('.pl-drawer [data-act="mark"][data-status="done"]').click();
      await waitFor(() => posts.length === 1);
      assert.deepEqual(posts[0], { action: "mark", source: "dues", pin_id: PIN, status: "done", client_id: CLIENT_ID });
      await page.waitForFunction(() => /Marked done\./.test(document.querySelector(".pl-drawer")?.innerText || ""));
    };
    const markMissed = async () => {
      // Mark missed on another pin
      await page.keyboard.press("Escape");
      await page.locator(`.cal-grid .pin[data-pin="${OTHER}"]`).click();
      page.once("dialog", (dialog) => dialog.accept());
      await page.locator('.pl-drawer [data-act="mark"][data-status="missed"]').click();
      await waitFor(() => posts.length === 2);
      assert.deepEqual(posts[1], { action: "mark", source: "dues", pin_id: OTHER, status: "missed", client_id: CLIENT_ID });
      await page.waitForFunction(() => /Marked missed\./.test(document.querySelector(".pl-drawer")?.innerText || ""));
    };
    if (target.entry === "page") {
      await proof.check(/^Staff only: Mark done/, markDone, target.surface);
      await markMissed();
    } else {
      await proof.check(/^Staff only: 'Mark done' and 'Mark missed'/, async () => { await markDone(); await markMissed(); }, target.surface);
    }
    assert.deepEqual(errors, []);
    await page.close();
  }
});

// Who may see which button: the drawer draws each mark button only when that pin's own
// can_mark lists it. The server fills can_mark for staff only, so a client has none.
const WHO = [
  { who: "a client", session: CLIENT, clientId: "", viewer: "client", canMark: [], buttons: [] },
  { who: "staff on a pin that allows only done", session: STAFF, clientId: CLIENT_ID, viewer: "staff", canMark: ["done"], buttons: ["done"] },
];
for (const target of Object.values(TARGETS)) {
  for (const who of WHO) {
    test(`${target.entry}: ${who.who} gets exactly the mark buttons the pin allows`, { timeout: 30_000 }, async (t) => {
      const { open } = await startScreens(t);
      const read = () => {
        const answer = sampleAnswer("money-plan.sample.json");
        answer.viewer = who.viewer;
        for (const pin of answer.pins) if (pin.source === "dues") pin.can_mark = who.canMark;
        return answer;
      };
      const resource = moneyResource("plan", { read });
      const { page, errors } = await open(entryUrl(target.entry, { ...target, clientId: who.clientId }), { session: who.session, handlers: resource.handlers });
      await page.waitForSelector(".fh-plan .cal-grid");
      await page.locator(`.cal-grid .pin[data-pin="${PIN}"]`).click();
      await page.waitForSelector(".pl-drawer");
      const shown = await page.locator('.pl-drawer [data-act="mark"]').evaluateAll((els) => els.map((el) => el.getAttribute("data-status")));
      assert.deepEqual(shown, who.buttons);
      assert.equal(await page.locator(".pl-drawer .pl-act").count(), who.buttons.length ? 1 : 0, "the staff-only box shows only with a button in it");
      assert.deepEqual(errors, []);
      await page.close();
    });
  }
}

test("every listed row was exercised", () => {
  proof.assertAllClaimed();
});
