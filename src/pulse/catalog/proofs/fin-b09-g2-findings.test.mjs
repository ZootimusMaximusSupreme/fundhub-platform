// Batch 09, generation 2: browser regression checks for the repaired Agent Editor discard and the one
// remaining climate finding. Fake /api answers only. No live data.
//
// 1. agent-editor.html, "Agent list row (click to open an agent, confirm discard of unsaved edits)".
// 2. climate/index.html, "Click a state: shows its score and a plain sentence": the shipped dashboard
//    shows a score and a band word but no sentence.
//
// The third row of this batch (the private lead list, "Reset my edits") has no page in the repo to run. It is
// no longer a finding: the display lane reads the live page (src/pulse/coverage/fin-b09-leads-reset.mjs).
// Fake /api answers only. No live data.

import assert from "node:assert/strict";
import test from "node:test";

import { bodyOf, json, sharedScreens } from "./fin-b09-kit.mjs";

const screens = sharedScreens();

const STAFF = [
  { id: "s-sw", name: "Sarah Whitfield", role: "sales_manager", status: "active" },
  { id: "s-jb", name: "Jordan Blake", role: "owner", status: "active" },
];
const GUARD = {
  block: "y".repeat(40),
  triggers: ["entry.captured"],
  escalation: { path: "Sarah Whitfield · Sales Manager", after: "1 hour", when: "" },
  authority: { disc: 0, msgcap: 3, pay: false, contract: false, book: false, pull: false },
  flags: { noamount: false, noscore: false, attorney: false, quiet: false },
};
const agent = (code, name, agentClass, channel, owner) => ({
  code, name, agent_class: agentClass, channel, status: "draft", runtime: null, owner_label: owner,
  prompt: "x".repeat(80), guardrails: GUARD, prompt_missing: false, guardrails_missing: false,
});
const AGENTS = [
  agent("AG-01", "Lead Follow-up", "client_facing", "sms", "Sarah Whitfield"),
  agent("AG-03", "Review Chaser", "ops", "email", "Jordan Blake"),
];

test("Agent Editor: Yes on 'Discard them?' restores the saved words and drops the unsaved mark", async () => {
  const holder = {};
  const { page, errors } = await screens.open("/app/agent-editor.html", {
    handlers: {
      "/api/read/staff": { ok: true, count: STAFF.length, limit: 200, offset: 0, hasMore: false, items: STAFF },
      "/api/read/agent-shadow-log": { ok: true, log: [], rows: [] },
      "/api/read/agents": async (route) => {
        // The agent list answers after the people lists are painted (the owner box is blanked otherwise).
        await holder.page.waitForFunction(() => document.querySelectorAll("#a_owner option").length > 1);
        return json(route, { ok: true, count: AGENTS.length, limit: 200, offset: 0, hasMore: false, items: AGENTS });
      },
    },
    before: async (p) => { holder.page = p; },
  });
  const questions = [];
  page.on("dialog", async (dialog) => {
    questions.push(dialog.message());
    await dialog.accept();
  });
  await page.waitForFunction(() => document.querySelector("#a_name")?.value === "Lead Follow-up");

  await page.locator("details.card > summary").nth(0).click();
  await page.locator("#a_name").fill("Lead Follow-up v2");
  assert.equal(await page.locator("#saveNote").innerText(), "UNSAVED CHANGES");

  // Leave for another agent and answer Yes to "Discard them?".
  await page.locator('.aitem[data-a="AG-03"]').click();
  await page.waitForFunction(() => document.querySelector("#a_name")?.value === "Review Chaser");
  assert.equal(questions.length, 1, "the discard question was asked once");
  assert.match(questions[0], /Discard them\?/);
  assert.equal(await page.locator("#saveNote").innerText(), "", "the unsaved mark is gone");

  // Come back. The edited copy was discarded, so the saved name is restored.
  await page.locator('.aitem[data-a="AG-01"]').click();
  await page.waitForFunction(() => document.querySelector("#a_code")?.value === "AG-01");
  const shown = await page.locator("#a_name").inputValue();
  assert.equal(shown, "Lead Follow-up");
  assert.equal(await page.locator("#saveNote").innerText(), "", "the restored copy is clean");
  assert.deepEqual(errors, []);
  await page.close();
});

test("Agent Editor: after Discard, the next Save sends the saved words, not the discarded edit", async () => {
  const holder = {};
  const writes = [];
  const { page, errors } = await screens.open("/app/agent-editor.html", {
    handlers: {
      "/api/read/staff": { ok: true, count: STAFF.length, limit: 200, offset: 0, hasMore: false, items: STAFF },
      "/api/read/agent-shadow-log": { ok: true, log: [], rows: [] },
      "/api/read/agents": async (route) => {
        await holder.page.waitForFunction(() => document.querySelectorAll("#a_owner option").length > 1);
        return json(route, { ok: true, count: AGENTS.length, limit: 200, offset: 0, hasMore: false, items: AGENTS });
      },
      "/api/agents": async (route) => {
        const body = bodyOf(route);
        writes.push(body);
        const old = AGENTS.find((a) => a.code === body.code);
        return json(route, { ok: true, action: "save", agent: { ...old, name: body.name } });
      },
    },
    before: async (p) => { holder.page = p; },
  });
  page.on("dialog", (dialog) => dialog.accept());
  await page.waitForFunction(() => document.querySelector("#a_name")?.value === "Lead Follow-up");

  await page.locator("details.card > summary").nth(0).click();
  await page.locator("#a_name").fill("Typed then discarded");
  await page.locator('.aitem[data-a="AG-03"]').click();
  await page.waitForFunction(() => document.querySelector("#a_name")?.value === "Review Chaser");
  await page.locator('.aitem[data-a="AG-01"]').click();
  await page.waitForFunction(() => document.querySelector("#a_code")?.value === "AG-01");
  await page.locator("#saveBtn").click();
  const end = Date.now() + 10000;
  while (!writes.length && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 25));

  assert.equal(writes.length, 1, "Save sent one request");
  assert.equal(writes[0].code, "AG-01");
  assert.equal(writes[0].name, "Lead Follow-up");
  assert.notEqual(writes[0].name, "Typed then discarded", "discarded words are never sent later");
  assert.deepEqual(errors, []);
  await page.close();
});

const climate = {
  ok: true,
  mapsKey: false,
  as_of: "2026-10-14T12:00:00.000Z",
  stale: false,
  national: { score: 61.2, color_band: "favorable", stale: false, updated_at: "2026-10-14T12:00:00.000Z", components: { liquidity: 60.1 } },
  states: [
    { state: "AZ", score: 72.4, color_band: "favorable", trend_30d: "up", business_conditions: 66.1, liquidity_score: 70.2, issuance_velocity: 58.8, updated_at: "2026-10-14T12:00:00.000Z" },
    { state: "TX", score: 44.0, color_band: "tight", trend_30d: "down", business_conditions: 41.5, liquidity_score: 47.3, issuance_velocity: 39.9, updated_at: "2026-10-14T12:00:00.000Z" },
  ],
  banks: [{ id: "b1", name: "Desert Credit Union", eligible_states: "AZ", priority_tier: 1, application_url: null, logo_path: null }],
};

test("clicking a state shows score, band, numbers and the plain-language scope sentence", async () => {
  const { page, errors } = await screens.open("/climate/", {
    session: null,
    handlers: { "/api/climate": climate },
  });
  await page.waitForSelector('path[data-code="AZ"]');
  await page.locator('path[data-code="AZ"]').dispatchEvent("click");
  const panel = page.locator(".slide-panel");
  await panel.waitFor();
  const text = await panel.innerText();

  // What the panel does show: the state, its score, its band word and the four numbers.
  assert.match(text, /Today's Score/);
  assert.match(text, /\b72\.4\b/);
  assert.match(text, /favorable/);
  for (const label of ["Trend (30d)", "Business Conditions", "Bank Liquidity", "Issuance Velocity"]) {
    assert.ok(text.includes(label), `the panel shows ${label}`);
  }

  const sentence = "This is the wider lending picture for your state, not a decision about you.";
  assert.equal(await panel.locator("p").count(), 1);
  assert.equal(await panel.locator("p").innerText(), sentence);
  assert.deepEqual(errors, []);
  await page.close();
});
