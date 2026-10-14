// Agent Editor — every control that changes what an agent may say or do must
// land, exactly, in the one POST /api/agents {action:"save"} the page sends.
//
// The existing specs prove Save, Promote and Demote fire. This one changes each
// authority switch, limit, escalation field, guardrail and trigger one at a time
// and judges the exact field of the saved payload, so a switch that is painted
// but never sent (or sent into the wrong field) turns red.
//
// NO BACKEND: page.route() answers /api/**, nothing is saved anywhere.
import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

const ROW = {
  code: "AG-01", name: "Lead Follow-up", agent_class: "client_facing",
  channel: "sms", status: "draft", runtime: null, owner_label: "Sarah Whitfield",
  prompt: "x".repeat(80),
  guardrails: {
    block: "y".repeat(40),
    triggers: ["entry.captured"],
    escalation: { path: "Sarah Whitfield · Sales Manager", after: "1 hour", when: "" },
    authority: { disc: 0, msgcap: 3, pay: false, contract: false, book: false, pull: false },
    flags: { noamount: false, noscore: false, attorney: false, quiet: false },
  },
  prompt_missing: false, guardrails_missing: false,
};
const STAFF = [
  { id: "s-sw", name: "Sarah Whitfield", role: "sales_manager", status: "active" },
  { id: "s-jb", name: "Jordan Blake", role: "owner", status: "active" },
];

async function open(page) {
  const writes = [];
  await openScreen(page, "/app/agent-editor.html", OWNER, {
    "/api/read/staff": { ok: true, count: 2, limit: 200, offset: 0, hasMore: false, items: STAFF },
    // The page blanks the saved "escalate to" person if the agents arrive before
    // the staff list has painted its options. Serve the agents only after the
    // people lists are painted, so the starting state is the same on every run.
    "/api/read/agents": async (route) => {
      await page.waitForFunction(() => document.querySelectorAll("#a_esc option").length > 1);
      return json(route, { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [ROW] });
    },
    "/api/agents": async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      return json(route, { ok: true, action: "save", agent: { ...ROW, ...body, status: "draft" } });
    },
  });
  await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
  await expect(page.locator("#a_esc")).toHaveValue("Sarah Whitfield · Sales Manager");
  await openCards(page);
  return { writes };
}

// Saving re-selects the agent and folds the cards again; open them for the next touch.
async function openCards(page) {
  for (const card of await page.locator("details.card").all()) {
    await card.evaluate((el) => { el.open = true; });
  }
}

async function saveAndRead(page, writes) {
  const before = writes.length;
  await page.locator("#saveBtn").click();
  await expect.poll(() => writes.length).toBe(before + 1);
  // The page re-selects the agent when the answer comes back, and that folds every
  // card. Wait for the fold, then open them again, so the next touch can never land
  // on a hidden control (it timed out 30 seconds when the click beat the fold).
  await expect.poll(() => page.locator("details.card[open]").count()).toBe(0);
  await openCards(page);
  const body = writes[writes.length - 1];
  expect(body.action).toBe("save");
  expect(body.code).toBe("AG-01");
  return body;
}

// [name, the change, a way to read the field it must land in, the value it must hold]
const SWITCHES = [
  ["May book on a closer's calendar", "#l_book", (g) => g.authority.book],
  ["May send a contract for signature", "#l_contract", (g) => g.authority.contract],
  ["May take a payment", "#l_pay", (g) => g.authority.pay],
  ["May run a soft pull", "#l_pull", (g) => g.authority.pull],
  ["Never state a funding amount", "#g_noamount", (g) => g.flags.noamount],
  ["Never promise a score outcome", "#g_noscore", (g) => g.flags.noscore],
  ["Stop on the word attorney", "#g_attorney", (g) => g.flags.attorney],
  ["Honor quiet hours", "#g_quiet", (g) => g.flags.quiet],
];

test.describe("agent editor: each control reaches its own saved field", () => {
  for (const [name, selector, read] of SWITCHES) {
    test(`switch: ${name} saves on, then saves off`, async ({ page }) => {
      const { writes } = await open(page);
      await page.locator(selector).click();
      expect(read((await saveAndRead(page, writes)).guardrails)).toBe(true);
      await page.locator(selector).click();
      expect(read((await saveAndRead(page, writes)).guardrails)).toBe(false);
    });
  }

  test("one switch moves only its own field", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#l_book").click();
    const { guardrails } = await saveAndRead(page, writes);
    expect(guardrails.authority).toEqual({ disc: 0, msgcap: 3, pay: false, contract: false, book: true, pull: false });
    expect(guardrails.flags).toEqual({ noamount: false, noscore: false, attorney: false, quiet: false });
  });

  for (const [typed, saved] of [["7", 7], ["12", 12], ["0", 0]]) {
    test(`max messages per client per day ${typed} is saved as the whole number ${saved}`, async ({ page }) => {
      const { writes } = await open(page);
      await page.locator("#a_msgcap").fill(typed);
      expect((await saveAndRead(page, writes)).guardrails.authority.msgcap).toBe(saved);
    });
  }

  for (const wait of ["15 minutes", "1 hour", "4 hours", "24 hours", "48 hours"]) {
    test(`after no reply "${wait}" is saved as the chosen wait`, async ({ page }) => {
      const { writes } = await open(page);
      // The saved wait is "1 hour": start from a different one so an untouched value cannot pass.
      await page.locator("#a_escafter").selectOption(wait === "15 minutes" ? "4 hours" : "15 minutes");
      await page.locator("#a_escafter").selectOption(wait);
      expect((await saveAndRead(page, writes)).guardrails.escalation.after).toBe(wait);
    });
  }

  test("escalate immediately when is saved word for word", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#a_escwhen").fill("client mentions bankruptcy");
    expect((await saveAndRead(page, writes)).guardrails.escalation.when).toBe("client mentions bankruptcy");
  });

  test("escalate to is saved as the chosen person", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#a_esc").selectOption({ index: 2 });
    const chosen = await page.locator("#a_esc").inputValue();
    expect(chosen).not.toBe("Sarah Whitfield · Sales Manager");
    const body = await saveAndRead(page, writes);
    expect(body.guardrails.escalation.path).toBe(chosen);
    expect(body.owner_label).toBe(await page.locator("#a_owner").inputValue());
  });

  test("the guardrail text box is saved as the block", async ({ page }) => {
    const { writes } = await open(page);
    const words = "Never quote a number. Never promise approval. Hand off on any complaint.";
    await page.locator("#a_guard").fill(words);
    expect((await saveAndRead(page, writes)).guardrails.block).toBe(words);
  });

  for (const [label, saved] of [["SMS", "sms"], ["Email", "email"], ["Voice", "voice"], ["Internal", "internal"]]) {
    test(`the channel select "${label}" is saved as the lower-case channel "${saved}"`, async ({ page }) => {
      const { writes } = await open(page);
      // The agent starts on SMS: start from a different channel so an untouched value cannot pass.
      await page.locator("#a_chan").selectOption(label === "Email" ? "Voice" : "Email");
      await page.locator("#a_chan").selectOption(label);
      expect((await saveAndRead(page, writes)).channel).toBe(saved);
    });
  }

  test("the prompt textarea is saved byte for byte", async ({ page }) => {
    const { writes } = await open(page);
    const prompt = "You follow up with new leads by text.\nNever quote a number.\n" + "z".repeat(40);
    await page.locator("#a_prompt").fill(prompt);
    expect((await saveAndRead(page, writes)).prompt).toBe(prompt);
  });

  test("trigger events: each of the 13 toggles adds exactly its own event, and picking them all again removes them", async ({ page }) => {
    const { writes } = await open(page);
    const events = await page.locator("#evGrid .ev").evaluateAll((els) => els.map((el) => el.dataset.e));
    expect(events.length).toBe(13);
    expect(new Set(events).size).toBe(13);
    expect(events).toEqual(expect.arrayContaining(["entry.captured", "survey.submitted", "payment.received"]));
    // entry.captured starts on: picking the other twelve must leave all thirteen on.
    for (const event of events.filter((e) => e !== "entry.captured")) {
      await page.locator(`#evGrid .ev[data-e="${event}"]`).click();
    }
    expect([...(await saveAndRead(page, writes)).guardrails.triggers].sort()).toEqual([...events].sort());
    // Every one of them now picked again is every one of them off.
    for (const event of events) await page.locator(`#evGrid .ev[data-e="${event}"]`).click();
    expect((await saveAndRead(page, writes)).guardrails.triggers).toEqual([]);
  });

  test("trigger events: picking one leaves the others as they were", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator('#evGrid .ev[data-e="payment.received"]').click();
    expect([...(await saveAndRead(page, writes)).guardrails.triggers].sort()).toEqual(["entry.captured", "payment.received"]);
    await page.locator('#evGrid .ev[data-e="payment.received"]').click();
    expect((await saveAndRead(page, writes)).guardrails.triggers).toEqual(["entry.captured"]);
  });

  test("the Save agent button sends exactly one write with the name, channel, class, owner, prompt and guardrails", async ({ page }) => {
    const { writes } = await open(page);
    await page.locator("#a_name").fill("Lead Follow-up v2");
    const body = await saveAndRead(page, writes);
    expect(writes.length).toBe(1);
    expect(Object.keys(body).sort()).toEqual(
      ["action", "agent_class", "channel", "code", "guardrails", "name", "owner_label", "prompt"]
    );
    expect(body.name).toBe("Lead Follow-up v2");
    expect(body.agent_class).toBe("client_facing");
    expect(body.channel).toBe("sms");
  });
});
