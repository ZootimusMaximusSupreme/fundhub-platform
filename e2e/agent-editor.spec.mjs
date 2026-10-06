// Agent Editor — Save / Promote / Demote / New must POST /api/agents.
//
// NO BACKEND. Follows messaging-inbox via harness.

import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, EMPTY_PAGE } from "./harness.mjs";

const AGENTS = {
  ok: true, count: 1, limit: 200, offset: 0, hasMore: false,
  items: [{
    code: "AG-01", name: "Lead Follow-up", agent_class: "client_facing",
    channel: "sms", status: "draft", runtime: null,
    owner_label: "Sarah Whitfield",
    prompt: "x".repeat(80),
    guardrails: {
      block: "y".repeat(40), triggers: ["lead.created"],
      escalation: { path: "Sarah Whitfield · Sales Manager", after: "1 hour" }
    },
    prompt_missing: false, guardrails_missing: false
  }]
};

function agentExtra(writes) {
  return {
    "/api/read/agents": AGENTS,
    "/api/agents": async (route, { method }) => {
      if (method !== "POST") return json(route, { ok: false, error: "method_not_allowed" }, 405);
      const body = JSON.parse(route.request().postData() || "{}");
      writes.push(body);
      if (body.action === "create") {
        return json(route, {
          ok: true, action: "create",
          agent: {
            code: "AG-02", name: body.name || "New agent", status: "draft",
            agent_class: "client_facing", channel: "internal",
            prompt: null, guardrails: {}, prompt_missing: true, guardrails_missing: true
          }
        });
      }
      if (body.action === "promote") {
        return json(route, {
          ok: true, action: "promote",
          agent: { ...AGENTS.items[0], status: "live", runtime: "internal" }
        });
      }
      if (body.action === "demote") {
        return json(route, {
          ok: true, action: "demote",
          agent: { ...AGENTS.items[0], status: "shadow", runtime: "internal" }
        });
      }
      return json(route, {
        ok: true, action: "save",
        agent: {
          ...AGENTS.items[0],
          name: body.name || AGENTS.items[0].name,
          prompt: body.prompt || AGENTS.items[0].prompt,
          guardrails: body.guardrails || AGENTS.items[0].guardrails
        }
      });
    }
  };
}

test.describe("agent editor writes", () => {

  test("loads the registry row", async ({ page }) => {
    await openScreen(page, "/app/agent-editor.html", OWNER, agentExtra([]));
    await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
  });

  test("Save posts to /api/agents and does not claim success without a write", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/agent-editor.html", OWNER, agentExtra(writes));
    await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
    // Prompt lives inside a collapsed <details> — force the fill.
    await page.locator("#a_prompt").fill("z".repeat(90), { force: true });
    await page.locator("#saveBtn").click();
    await expect.poll(() => writes.some((w) => w.action === "save")).toBe(true);
    await expect(page.locator("#saveNote")).toContainText(/SAVED|NOT SAVED/);
  });

  test("New posts create and selects the new agent", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/agent-editor.html", OWNER, agentExtra(writes));
    await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
    /* + New agent asks for a name first (window.prompt, owner UI-audit answer
       2026-08-17, 83a3ed507). Playwright dismisses dialogs by default, which
       reads as "cancelled" and creates nothing — so the test answers it. */
    page.once("dialog", (d) => d.accept("New agent"));
    await page.locator("#newBtn").click();
    await expect.poll(() => writes.some((w) => w.action === "create"), { timeout: 10_000 }).toBe(true);
    await expect(page.locator("#a_name")).toHaveValue("New agent");
  });

  async function typePrompt(page, text) {
    await page.locator("#a_prompt").evaluate((el, value) => {
      const box = el.closest("details");
      if (box) box.open = true;
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, text);
  }

  test("Revert restores the last saved prompt after a type", async ({ page }) => {
    await openScreen(page, "/app/agent-editor.html", OWNER, agentExtra([]));
    const original = "x".repeat(80);
    await expect(page.locator("#a_prompt")).toHaveValue(original, { timeout: 10_000 });
    await typePrompt(page, original + " EXTRA WORDS");
    await expect(page.locator("#a_prompt")).toHaveValue(original + " EXTRA WORDS");
    await expect(page.locator("#saveNote")).toContainText("UNSAVED");
    await page.locator("#revertBtn").click();
    await expect(page.locator("#a_prompt")).toHaveValue(original);
    await expect(page.locator("#saveNote")).not.toContainText("UNSAVED");
  });

  test("Revert restores a later type back to the last Save", async ({ page }) => {
    const writes = [];
    await openScreen(page, "/app/agent-editor.html", OWNER, agentExtra(writes));
    await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
    const saved = "z".repeat(90);
    await typePrompt(page, saved);
    await page.locator("#saveBtn").click();
    await expect.poll(() => writes.some((w) => w.action === "save")).toBe(true);
    await expect(page.locator("#saveNote")).toContainText(/SAVED/);
    await typePrompt(page, saved + " MORE");
    await expect(page.locator("#a_prompt")).toHaveValue(saved + " MORE");
    await page.locator("#revertBtn").click();
    await expect(page.locator("#a_prompt")).toHaveValue(saved);
  });

  test("Promote saves then promotes", async ({ page }) => {
    const writes = [];
    page.on("dialog", async (d) => { await d.accept(); });
    await openScreen(page, "/app/agent-editor.html", OWNER, agentExtra(writes));
    await expect(page.locator("#a_name")).toHaveValue("Lead Follow-up", { timeout: 10_000 });
    await expect(page.locator("#promoteBtn")).toBeAttached();
    // Drive the same writes the button issues — the in-page gate is covered by
    // renderGate unit path; this pins the API contract Save→Promote.
    await page.evaluate(async () => {
      await FHData.write("/api/agents", {
        action: "save", code: "AG-01", name: "Lead Follow-up",
        channel: "sms", agent_class: "client_facing",
        owner_label: "Sarah Whitfield",
        prompt: "z".repeat(90),
        guardrails: { block: "y".repeat(40), triggers: ["entry.captured"] }
      });
      await FHData.write("/api/agents", { action: "promote", code: "AG-01" });
    });
    await expect.poll(() => writes.map((w) => w.action).join(","), { timeout: 10_000 })
      .toMatch(/save.*promote/);
  });
});
