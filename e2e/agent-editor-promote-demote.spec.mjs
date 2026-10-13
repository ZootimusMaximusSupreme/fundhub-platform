// Agent Editor — Promote to live and Return to shadow, pressed on the buttons.
//
// Promote puts an AI agent in front of real clients; Return to shadow takes it
// off them. The existing spec drove the writes from page code; the list said
// no test clicked either button. This clicks them: the confirm names who is
// affected, No sends nothing, Promote saves the words on screen first and only
// then promotes, a failed save stops the promote, and the screen shows the new
// mode after the server says so.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER } from "./harness.mjs";

const ROW = {
  code: "AG-01", name: "Lead Follow-up", agent_class: "client_facing",
  channel: "sms", status: "draft", runtime: null, owner_label: "Sarah Whitfield",
  prompt: "x".repeat(80),
  guardrails: { block: "y".repeat(40), triggers: ["lead.created"], escalation: { path: "Sarah Whitfield · Sales Manager", after: "1 hour" } },
  prompt_missing: false, guardrails_missing: false
};

async function open(page, { status = "draft", saveFails = false, shadowRuns = 25 } = {}) {
  const writes = [];
  const row = { ...ROW, status, runtime: status === "draft" ? null : "internal" };
  await openScreen(page, "/app/agent-editor.html", OWNER, {
    // The escalation picker is filled from the staff list; the saved path must be on it.
    "/api/read/staff": { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [{ id: "s-sw", name: "Sarah Whitfield", role: "sales_manager", status: "active" }] },
    "/api/read/agents": { ok: true, count: 1, limit: 200, offset: 0, hasMore: false, items: [row] },
    // A real shadow log: the gate then needs 25 practice runs before Promote.
    "/api/read/agent-shadow-log": { ok: true, log: [], rows: Array.from({ length: shadowRuns }, (_, i) => ({ id: `r${i}` })) },
    "/api/agents": async (route) => {
      const body = route.request().postDataJSON();
      writes.push(body);
      if (body.action === "save" && saveFails) return json(route, { ok: false, error: "prompt has a banned line" }, 400);
      if (body.action === "promote") return json(route, { ok: true, action: "promote", agent: { ...row, status: "live", runtime: "internal" } });
      if (body.action === "demote") return json(route, { ok: true, action: "demote", agent: { ...row, status: "shadow", runtime: "internal" } });
      return json(route, { ok: true, action: "save", agent: { ...row, prompt: body.prompt || row.prompt } });
    }
  });
  await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
  await expect(page.locator("#a_esc")).toHaveValue("Sarah Whitfield · Sales Manager", { timeout: 10_000 });
  return { writes };
}

async function openPrompt(page) {
  // The prompt lives in a folded PROMPT card.
  await page.locator("summary", { hasText: "PROMPT" }).click();
  await expect(page.locator("#a_prompt")).toBeVisible();
}

test.describe("agent editor: Promote to live", () => {
  test("the confirm names the clients it will reach; Yes saves the words on screen, then promotes", async ({ page }) => {
    const { writes } = await open(page);
    await openPrompt(page);
    await page.locator("#a_prompt").fill("You follow up with new leads by text. ".repeat(3));
    const dialogs = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await expect(page.locator("#promoteBtn")).toBeEnabled();
    await page.locator("#promoteBtn").click();
    await expect.poll(() => writes.map((w) => w.action).join(",")).toBe("save,promote");
    expect(dialogs[0]).toContain("Promote Lead Follow-up to live?");
    expect(dialogs[0]).toContain("acting on real clients over SMS immediately");
    expect(writes[0]).toMatchObject({ action: "save", code: "AG-01", prompt: "You follow up with new leads by text. ".repeat(3) });
    expect(writes[1]).toEqual({ action: "promote", code: "AG-01" });
    await expect(page.locator("#modeTitle")).toHaveText("LIVE");
    await expect(page.locator("#promoteBtn")).toBeHidden();
    await expect(page.locator("#demoteBtn")).toBeVisible();
  });

  test("No on the confirm sends nothing", async ({ page }) => {
    const { writes } = await open(page);
    page.once("dialog", (d) => d.dismiss());
    await page.locator("#promoteBtn").click();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    await expect(page.locator("#modeTitle")).toHaveText("DRAFT");
  });

  test("fewer than 25 practice runs in shadow keeps Promote switched off", async ({ page }) => {
    await open(page, { shadowRuns: 3 });
    // The gate re-reads the shadow log on the next edit.
    await openPrompt(page);
    await page.locator("#a_prompt").fill("You follow up with new leads by text. ".repeat(3));
    await expect(page.locator("#gateBox")).toContainText("At least 25 shadow runs");
    await expect(page.locator("#gateBox")).toContainText("3 runs");
    await expect(page.locator("#promoteBtn")).toBeDisabled();
  });

  test("a prompt under 60 characters keeps Promote switched off", async ({ page }) => {
    await open(page);
    await openPrompt(page);
    await page.locator("#a_prompt").fill("Too short.");
    await page.locator("#a_prompt").dispatchEvent("input");
    await expect(page.locator("#promoteBtn")).toBeDisabled();
  });

  test("if the save before promote fails, the agent is NOT promoted", async ({ page }) => {
    const { writes } = await open(page, { saveFails: true });
    const dialogs = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.locator("#promoteBtn").click();
    await expect.poll(() => dialogs.length).toBe(2);
    expect(dialogs[1]).toContain("Could not save before promote");
    expect(writes.map((w) => w.action)).toEqual(["save"]);
    await expect(page.locator("#modeTitle")).toHaveText("DRAFT");
  });
});

test.describe("agent editor: Return to shadow", () => {
  test("only a live agent offers it; the confirm says it stops acting on clients; Yes demotes", async ({ page }) => {
    const { writes } = await open(page, { status: "live" });
    await expect(page.locator("#promoteBtn")).toBeHidden();
    const dialogs = [];
    page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await page.locator("#demoteBtn").click();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes[0]).toEqual({ action: "demote", code: "AG-01" });
    expect(dialogs[0]).toContain("Return Lead Follow-up to shadow?");
    expect(dialogs[0]).toContain("stops acting on real clients over SMS immediately");
    await expect(page.locator("#modeTitle")).toHaveText("SHADOW");
    await expect(page.locator("#demoteBtn")).toBeHidden();
  });

  test("No on the confirm keeps it live and sends nothing", async ({ page }) => {
    const { writes } = await open(page, { status: "live" });
    page.once("dialog", (d) => d.dismiss());
    await page.locator("#demoteBtn").click();
    await page.waitForTimeout(300);
    expect(writes).toEqual([]);
    await expect(page.locator("#modeTitle")).toHaveText("LIVE");
  });

  test("a draft agent is not offered Return to shadow", async ({ page }) => {
    await open(page, { status: "draft" });
    await expect(page.locator("#demoteBtn")).toBeHidden();
  });
});
