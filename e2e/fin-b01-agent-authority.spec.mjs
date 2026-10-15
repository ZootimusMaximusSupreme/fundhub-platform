// Agent Editor, AUTHORITY LIMITS: the three controls that decide what an agent may
// do with money, judged by the exact write the page sends (finish-the-853, batch 01).
//
//   - "May take a payment"     -> guardrails.authority.pay
//   - "May run a soft pull"    -> guardrails.authority.pull
//   - "Max discount" (percent) -> guardrails.authority.disc
//
// NO BACKEND: page.route() answers /api/**, nothing is saved anywhere.
import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const ROW = {
  code: "AG-01", name: "Lead Follow-up", agent_class: "client_facing",
  channel: "sms", status: "draft", runtime: null, owner_label: "Sarah Whitfield",
  prompt: "x".repeat(80),
  guardrails: {
    block: "y".repeat(40),
    triggers: ["entry.captured"],
    escalation: { path: "Sarah Whitfield · Sales Manager", after: "1 hour", when: "" },
    authority: { disc: 10, msgcap: 3, pay: false, contract: false, book: false, pull: false },
    flags: { noamount: false, noscore: false, attorney: false, quiet: false },
  },
  prompt_missing: false, guardrails_missing: false,
};
const STAFF = [{ id: "s-sw", name: "Sarah Whitfield", role: "sales_manager", status: "active" }];

async function open(page, { authority } = {}) {
  const writes = [];
  // `authority` replaces the saved authority block, so a test can start from a stored state.
  const row = authority
    ? { ...ROW, guardrails: { ...ROW.guardrails, authority: { ...ROW.guardrails.authority, ...authority } } }
    : ROW;
  await openScreen(page, "/app/agent-editor.html", OWNER, {
    "/api/read/staff": { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: STAFF },
    // The page blanks the saved "escalate to" person if the agents arrive before the
    // staff list has painted its options, so serve the agents after the people lists.
    "/api/read/agents": async (route) => {
      await page.waitForFunction(() => document.querySelectorAll("#a_esc option").length > 1);
      return json(route, { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [row] });
    },
    "/api/agents": async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      return json(route, { ok: true, action: "save", agent: { ...row, ...body, status: "draft" } });
    },
  });
  await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
  await expect(page.locator("#a_esc")).toHaveValue("Sarah Whitfield · Sales Manager");
  await openCards(page);
  return { writes };
}

async function openCards(page) {
  for (const card of await page.locator("details.card").all()) {
    await card.evaluate((el) => { el.open = true; });
  }
}

async function saveAndRead(page, writes) {
  const before = writes.length;
  await page.locator("#saveBtn").click();
  await expect.poll(() => writes.length).toBe(before + 1);
  // The page folds every card when the answer comes back. Wait for it, then reopen.
  await expect.poll(() => page.locator("details.card[open]").count()).toBe(0);
  await openCards(page);
  return writes[writes.length - 1];
}

test.describe("agent editor: the money limits reach their own saved field", () => {
  test("the saved authority is painted: discount 10, payment off, soft pull off", async ({ page }) => {
    await open(page);
    await expect(page.locator("#a_disc")).toHaveValue("10");
    await expect(page.locator("#l_pay")).not.toHaveClass(/\bon\b/);
    await expect(page.locator("#l_pull")).not.toHaveClass(/\bon\b/);
  });

  for (const [typed, saved] of [["15", 15], ["12.5", 12.5], ["0", 0], ["100", 100]]) {
    test(`max discount ${typed} percent is saved as the number ${saved}`, async ({ page }) => {
      const { writes } = await open(page);
      await page.locator("#a_disc").fill(typed);
      const body = await saveAndRead(page, writes);
      expect(body.guardrails.authority.disc).toBe(saved);
      // The other authority fields are the saved ones, untouched.
      expect(body.guardrails.authority).toEqual({ disc: saved, msgcap: 3, pay: false, contract: false, book: false, pull: false });
    });
  }

  test("a blank max discount is saved as 0, which means none", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#a_disc").fill("");
    expect((await saveAndRead(page, writes)).guardrails.authority.disc).toBe(0);
  });

  test("the payment and soft pull switches and the discount travel in the one write, each in its own field", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#l_pay").click();
    await page.locator("#l_pull").click();
    await page.locator("#a_disc").fill("20");
    const body = await saveAndRead(page, writes);
    expect(body.action).toBe("save");
    expect(body.guardrails.authority).toEqual({ disc: 20, msgcap: 3, pay: true, contract: false, book: false, pull: true });
    // The guardrail flags are not touched by an authority change.
    expect(body.guardrails.flags).toEqual({ noamount: false, noscore: false, attorney: false, quiet: false });
  });

  test("turning the payment switch off again saves false, not a missing field", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#l_pay").click();
    expect((await saveAndRead(page, writes)).guardrails.authority.pay).toBe(true);
    await page.locator("#l_pay").click();
    const off = (await saveAndRead(page, writes)).guardrails.authority;
    expect(off.pay).toBe(false);
    expect(Object.keys(off).sort()).toEqual(["book", "contract", "disc", "msgcap", "pay", "pull"]);
  });

  // The two money switches are separate: turning one on must never turn the other on. A write that lets
  // one leak into the other gives an agent the right to charge a card, or to pull a bureau, that nobody gave it.
  test("payment ON alone leaves soft pull off, on the screen and in the write", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#l_pay").click();
    await expect(page.locator("#l_pay")).toHaveClass(/\bon\b/);
    await expect(page.locator("#l_pull")).not.toHaveClass(/\bon\b/);
    const body = await saveAndRead(page, writes);
    expect(body.guardrails.authority).toEqual({ disc: 10, msgcap: 3, pay: true, contract: false, book: false, pull: false });
  });

  test("soft pull ON alone leaves payment off, on the screen and in the write", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#l_pull").click();
    await expect(page.locator("#l_pull")).toHaveClass(/\bon\b/);
    await expect(page.locator("#l_pay")).not.toHaveClass(/\bon\b/);
    const body = await saveAndRead(page, writes);
    expect(body.guardrails.authority).toEqual({ disc: 10, msgcap: 3, pay: false, contract: false, book: false, pull: true });
  });

  test("a stored soft pull with payment off is painted that way, and saved again unchanged", async ({ page }) => {
    const { writes } = await open(page, { authority: { pull: true, pay: false } });
    await expect(page.locator("#l_pull")).toHaveClass(/\bon\b/);
    await expect(page.locator("#l_pay")).not.toHaveClass(/\bon\b/);
    const body = await saveAndRead(page, writes);
    expect(body.guardrails.authority).toEqual({ disc: 10, msgcap: 3, pay: false, contract: false, book: false, pull: true });
  });

  test("a stored payment with soft pull off is painted that way, and saved again unchanged", async ({ page }) => {
    const { writes } = await open(page, { authority: { pay: true, pull: false } });
    await expect(page.locator("#l_pay")).toHaveClass(/\bon\b/);
    await expect(page.locator("#l_pull")).not.toHaveClass(/\bon\b/);
    const body = await saveAndRead(page, writes);
    expect(body.guardrails.authority).toEqual({ disc: 10, msgcap: 3, pay: true, contract: false, book: false, pull: false });
  });

  test("turning the soft pull off while payment stays on saves pull false and pay true", async ({ page }) => {
    const { writes } = await open(page, { authority: { pay: true, pull: true } });
    await page.locator("#l_pull").click();
    const body = await saveAndRead(page, writes);
    expect(body.guardrails.authority.pull).toBe(false);
    expect(body.guardrails.authority.pay).toBe(true);
  });

  for (const [id, field] of [["l_pay", "pay"], ["l_contract", "contract"], ["l_book", "book"], ["l_pull", "pull"]]) {
    test(`the ${field} switch turned on alone turns on only ${field}`, async ({ page }) => {
      const { writes } = await open(page);
      await page.locator(`#${id}`).click();
      const body = await saveAndRead(page, writes);
      const want = { disc: 10, msgcap: 3, pay: false, contract: false, book: false, pull: false, [field]: true };
      expect(body.guardrails.authority).toEqual(want);
    });
  }
});
