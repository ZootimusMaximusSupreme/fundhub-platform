// Brand Studio, BS-06 GENERATION: "Turn on for this partner" (owner) and
// "Write page copy" (finish-the-853, batch 01).
//
// Judged on the exact request each button sends, who is allowed to see the
// switch, and the words the page paints from the answer. The model call and the
// token meter are the server's; nothing here reaches a model.
//
// NO BACKEND: page.route() answers /api/**.
import { test, expect } from "@playwright/test";
import { openScreen, json, OWNER, PARTNER_ID } from "./harness.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

const PAGE_ID = "99999999-0000-4000-8000-000000000001";
const PAGE_ID_2 = "99999999-0000-4000-8000-000000000002";
const ADMIN = { ok: true, staff: { id: "staff-3", name: "Ada Admin", email: "ada@fundhub.ai", role: "admin", org_id: "org-1", status: "active" } };

const PAGES = [{
  id: PAGE_ID, title: "Application funnel", funnel_key: "apply", slug: "apply", status: "draft",
  body_json: { sections: [
    { id: "hero", headline: "Hero", type: "hero", locked: false },
    { id: "legal", headline: "Legal disclosure", type: "legal", locked: true },
    { id: "faq", headline: "Questions", type: "faq", locked: false },
  ] },
}, {
  // A second page with its own blocks, so a press can be told apart from "the first page".
  id: PAGE_ID_2, title: "Roadmap funnel", funnel_key: "roadmap", slug: "roadmap", status: "draft",
  body_json: { sections: [
    { id: "steps", headline: "Steps", type: "steps", locked: false },
    { id: "legal-2", headline: "Roadmap disclosure", type: "legal", locked: true },
    { id: "price", headline: "Price", type: "price", locked: false },
  ] },
}];

/* The answer the real handler gives (api/partner-marketing/generate-copy.mjs): { ok, body, results }.
   `results` holds one row per block it wrote and never one for a locked block. */
function realAnswer(page, sectionId) {
  const sections = page.body_json.sections;
  const targets = sectionId ? sections.filter((s) => s.id === sectionId) : sections.filter((s) => !s.locked);
  const written = sections.map((s) => (targets.includes(s) ? { ...s, headline: `New ${s.headline}` } : s));
  return {
    ok: true,
    body: { template: page.funnel_key, sections: written },
    results: targets.map((s) => ({ section_id: s.id, state: "needs_approval", section: { ...s, headline: `New ${s.headline}` } })),
  };
}

function setup({ enabled = false, enableAnswer, copyAnswer, pages = PAGES } = {}) {
  const state = { enabled, enableCalls: [], copyCalls: [], usageCalls: 0, pageReads: 0 };
  const handlers = {
    "/api/partner-marketing/usage": (route) => {
      state.usageCalls += 1;
      return json(route, { ok: true, enabled: state.enabled, remaining: 42000, cap: 50000, used: 8000 });
    },
    "/api/partner-marketing/enable": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      state.enableCalls.push(body);
      if (enableAnswer) return enableAnswer(route, body);
      state.enabled = body.enabled === true;
      return json(route, { ok: true, partner_id: body.partner_id, enabled: state.enabled });
    },
    "/api/partner-marketing/generate-copy": async (route) => {
      const body = JSON.parse(route.request().postData() || "{}");
      state.copyCalls.push(body);
      if (copyAnswer) return copyAnswer(route, body);
      const page = pages.find((p) => p.id === body.page_id) || pages[0];
      return json(route, realAnswer(page, body.section_id));
    },
    "/api/partner-marketing/copy-history": { ok: true, items: [] },
    "/api/partner-pages": (route) => { state.pageReads += 1; return json(route, { ok: true, items: pages }); },
  };
  return { state, handlers };
}

async function open(page, { session = OWNER, partner = PARTNER_ID, ...opts } = {}) {
  const s = setup(opts);
  await openScreen(page, `/app/brand-studio.html${partner ? `?partner_id=${partner}` : ""}`, session, s.handlers);
  return s.state;
}

test.describe("brand studio: Turn on for this partner", () => {
  test("the owner sees Turn on while it is off, and pressing it sends this partner with enabled true", async ({ page }) => {
    const state = await open(page);
    await expect(page.locator("#suiteTxt")).toHaveText("Off");
    await expect(page.locator("#suiteOnBtn")).toBeVisible();
    await expect(page.locator("#suiteOffBtn")).toBeHidden();
    await expect(page.locator("#suiteOnTools")).toBeHidden();
    await page.locator("#suiteOnBtn").click();
    await expect.poll(() => state.enableCalls.length).toBe(1);
    expect(state.enableCalls[0]).toEqual({ partner_id: PARTNER_ID, enabled: true });
    await expect(page.locator("#genMsg")).toHaveText("On for this partner.");
    // The page reads the meter again and paints what the server now holds.
    await expect(page.locator("#suiteTxt")).toHaveText("On");
    await expect(page.locator("#suiteOnTools")).toBeVisible();
    await expect(page.locator("#suiteOnBtn")).toBeHidden();
    await expect(page.locator("#suiteOffBtn")).toBeVisible();
    await expect(page.locator("#kTokens")).toHaveText("42000");
  });

  test("a refusal is said in the server's words and the chip stays Off", async ({ page }) => {
    const state = await open(page, {
      enableAnswer: (route) => json(route, { ok: false, error: "forbidden", message: "only the owner can turn this on" }, 403),
    });
    await page.locator("#suiteOnBtn").click();
    await expect.poll(() => state.enableCalls.length).toBe(1);
    await expect(page.locator("#genMsg")).toHaveText("only the owner can turn this on");
    await expect(page.locator("#suiteTxt")).toHaveText("Off");
    await expect(page.locator("#suiteOnTools")).toBeHidden();
  });

  test("while it is on, the owner sees Turn off, and it sends enabled false", async ({ page }) => {
    const state = await open(page, { enabled: true });
    await expect(page.locator("#suiteTxt")).toHaveText("On");
    await expect(page.locator("#suiteOnBtn")).toBeHidden();
    await page.locator("#suiteOffBtn").click();
    await expect.poll(() => state.enableCalls.length).toBe(1);
    expect(state.enableCalls[0]).toEqual({ partner_id: PARTNER_ID, enabled: false });
    await expect(page.locator("#genMsg")).toHaveText("Off for this partner.");
    await expect(page.locator("#suiteTxt")).toHaveText("Off");
  });

  test("an admin is not shown the owner switch", async ({ page }) => {
    const state = await open(page, { session: ADMIN });
    await expect(page.locator("#suiteTxt")).toHaveText("Off");
    await expect(page.locator("#suiteOwnerRow")).toBeHidden();
    await expect(page.locator("#suiteOffMsg")).toContainText("The owner has not turned this on yet");
    expect(state.enableCalls).toEqual([]);
  });

  test("the CRM's own brand (no partner) has no partner switch at all", async ({ page }) => {
    const state = await open(page, { partner: null });
    await expect(page.locator("#suiteOwnerRow")).toBeHidden();
    expect(state.enableCalls).toEqual([]);
  });
});

test.describe("brand studio: Write page copy", () => {
  test("with the suite on, the tool row is shown and Write page copy sends the chosen page for all unlocked blocks", async ({ page }) => {
    const state = await open(page, { enabled: true });
    await expect(page.locator("#suiteOnTools")).toBeVisible();
    await expect(page.locator("#histPage option")).toHaveText(["Application funnel", "Roadmap funnel"]);
    await page.locator("#genCopyBtn").click();
    await expect.poll(() => state.copyCalls.length).toBe(1);
    // "All unlocked blocks" is an empty section, sent as null, never as the empty string.
    expect(state.copyCalls[0]).toEqual({ page_id: PAGE_ID, section_id: null });
    await expect(page.locator("#genMsg")).toHaveText("Copy written. Locked legal blocks were left alone.");
  });

  test("a locked legal block is never offered as a block to write, and a chosen block is sent by its id", async ({ page }) => {
    const state = await open(page, { enabled: true });
    await expect(page.locator("#histSection option")).toHaveText(["All unlocked blocks", "Hero", "Questions"]);
    await page.locator("#histSection").selectOption("faq");
    await page.locator("#genCopyBtn").click();
    await expect.poll(() => state.copyCalls.length).toBe(1);
    expect(state.copyCalls[0]).toEqual({ page_id: PAGE_ID, section_id: "faq" });
  });

  test("choosing the second page sends the second page's id, not the first page's", async ({ page }) => {
    const state = await open(page, { enabled: true });
    await page.locator("#histPage").selectOption(PAGE_ID_2);
    // The block list is rebuilt for the page that was chosen: its own blocks, its legal block left out.
    await expect(page.locator("#histSection option")).toHaveText(["All unlocked blocks", "Steps", "Price"]);
    await page.locator("#genCopyBtn").click();
    await expect.poll(() => state.copyCalls.length).toBe(1);
    expect(state.copyCalls[0]).toEqual({ page_id: PAGE_ID_2, section_id: null });
    await expect(page.locator("#genMsg")).toHaveText("Copy written. Locked legal blocks were left alone.");
  });

  test("a block chosen on the first page is not carried over to the second page", async ({ page }) => {
    const state = await open(page, { enabled: true });
    await page.locator("#histSection").selectOption("faq");
    await page.locator("#histPage").selectOption(PAGE_ID_2);
    await expect(page.locator("#histSection")).toHaveValue("");
    await page.locator("#genCopyBtn").click();
    await expect.poll(() => state.copyCalls.length).toBe(1);
    expect(state.copyCalls[0]).toEqual({ page_id: PAGE_ID_2, section_id: null });
  });

  test("a block chosen on the second page is sent with the second page's id", async ({ page }) => {
    const state = await open(page, { enabled: true });
    await page.locator("#histPage").selectOption(PAGE_ID_2);
    await page.locator("#histSection").selectOption("price");
    await page.locator("#genCopyBtn").click();
    await expect.poll(() => state.copyCalls.length).toBe(1);
    expect(state.copyCalls[0]).toEqual({ page_id: PAGE_ID_2, section_id: "price" });
  });

  test("a real-shaped answer (body and results) says copy was written; an answer that is not ok never does", async ({ page }) => {
    // The real handler answers { ok, body, results }. The page tells a person Copy written only for ok.
    const state = await open(page, {
      enabled: true,
      copyAnswer: (route, body) => json(route, realAnswer(PAGES.find((p) => p.id === body.page_id), body.section_id)),
    });
    await page.locator("#genCopyBtn").click();
    await expect.poll(() => state.copyCalls.length).toBe(1);
    await expect(page.locator("#genMsg")).toHaveText("Copy written. Locked legal blocks were left alone.");
  });

  test("an answer that says ok false with results in it is not shown as copy written", async ({ page }) => {
    const state = await open(page, {
      enabled: true,
      copyAnswer: (route) => json(route, { ok: false, error: "no_model", message: "The writing robot is not set on this site.", results: [] }, 503),
    });
    await page.locator("#genCopyBtn").click();
    await expect.poll(() => state.copyCalls.length).toBe(1);
    await expect(page.locator("#genMsg")).toHaveText("The writing robot is not set on this site.");
    await expect(page.locator("#genMsg")).not.toContainText("Copy written");
  });

  test("a refusal says nothing was written and the page is unchanged", async ({ page }) => {
    const state = await open(page, {
      enabled: true,
      copyAnswer: (route) => json(route, { ok: false, error: "cap_hit", message: "This month's writing budget is used up." }, 402),
    });
    await page.locator("#genCopyBtn").click();
    await expect.poll(() => state.copyCalls.length).toBe(1);
    await expect(page.locator("#genMsg")).toHaveText("This month's writing budget is used up.");
  });

  test("with no page yet it says to create one first and sends nothing", async ({ page }) => {
    const state = await open(page, { enabled: true, pages: [] });
    await expect(page.locator("#histPage option")).toHaveText(["No pages yet"]);
    await page.locator("#genCopyBtn").click();
    await expect(page.locator("#genMsg")).toHaveText("Create a page first.");
    expect(state.copyCalls).toEqual([]);
  });

  test("with the suite off the Write page copy button is not on the screen", async ({ page }) => {
    await open(page, { enabled: false });
    await expect(page.locator("#genCopyBtn")).toBeHidden();
  });

  test("after copy is written the pages and the meter are read again", async ({ page }) => {
    const state = await open(page, { enabled: true });
    const pagesBefore = state.pageReads;
    const usageBefore = state.usageCalls;
    await page.locator("#genCopyBtn").click();
    await expect.poll(() => state.pageReads).toBeGreaterThan(pagesBefore);
    await expect.poll(() => state.usageCalls).toBeGreaterThan(usageBefore);
  });
});
