// Command Center, Ideas tab: every paid tap asks first, a Cancel sends nothing, and
// one yes sends exactly one write (finish-the-853, batch 01, the "cost sheet and
// two-tap confirm drawn before every paid tap" row).
//
// The Ideas tab has ten sheet-guarded taps. Each is pressed twice against the same
// stand-in frame: the first answer is Cancel and no write may reach the server; the
// second is yes and exactly one write goes out. The sheets themselves (cost line,
// month line, focus, Escape, phone size) are judged on the real frame in
// e2e/marketing-command-center.spec.mjs.
//
// NO BACKEND: the stand-in host answers /api/** and nothing is spent.
import { test, expect } from "@playwright/test";
import { mountIdeas, flywheel, blueprintFunnel } from "./helpers/cc-tab-ideas-host.mjs";

// These run on a Mac that is often busy with other browser runs: give each test room.
test.describe.configure({ timeout: 60_000 });

test.use({ timezoneId: "America/Phoenix", locale: "en-US", viewport: { width: 1280, height: 900 } });

const writesTo = (posts, p) => posts.filter((x) => x.path === p);
const IDEA_ID = "00000000-0000-4000-8000-000000000402";
const FUNNEL_ID = "00000000-0000-4000-8000-000000000603";

const OK_QUEUED = { status: 202, body: { ok: true, queued: true, started: true, job: { id: "job-1", status: "queued", kind: "x" }, worker: { started: true, reason: null } } };

/** Press `open`, Cancel the sheet, check nothing was sent, press again and say yes. */
async function cancelThenYes(page, posts, { open, dialogName, cancel = "Cancel", yes, route }) {
  await open();
  const sheet = dialogName ? page.getByRole("dialog", { name: dialogName }) : page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  expect(writesTo(posts, route), "nothing is sent before the sheet's answer").toHaveLength(0);
  await sheet.getByRole("button", { name: cancel, exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.waitForTimeout(250);
  expect(writesTo(posts, route), "a Cancel sends nothing").toHaveLength(0);
  await open();
  await (dialogName ? page.getByRole("dialog", { name: dialogName }) : page.getByRole("dialog")).getByRole("button", { name: yes }).click();
  await expect.poll(() => writesTo(posts, route).length, "one yes, one write").toBe(1);
}

for (const mode of ["callback", "promise", "both"]) test.describe(`Ideas tab, a frame whose sheets answer by ${mode}: every paid tap, Cancel then yes`, () => {
  test("Write one script from this idea", async ({ page }) => {
    const { posts } = await mountIdeas(page, { "POST marketing/batches/write-now": { status: 202, body: { ok: true, queued: true, batch_id: "b1", job_id: "j1" } } }, { confirmMode: mode });
    const row = page.locator(`[data-idea="${IDEA_ID}"]`);
    await cancelThenYes(page, posts, {
      open: () => row.getByRole("button", { name: "Write now from this idea" }).click(),
      dialogName: "Write one script from this idea?", yes: "Write it now", route: "marketing/batches/write-now",
    });
  });

  test("Start the research", async ({ page }) => {
    const { posts } = await mountIdeas(page, { "POST marketing/research": { status: 202, body: { ok: true, started: true, already_running: false, job: { id: "r-new", status: "queued" } } } }, { confirmMode: mode });
    await page.locator("#cci-q").fill("Which banks give business credit lines to new companies?");
    await page.locator("#cci-cap").fill("5");
    await cancelThenYes(page, posts, {
      open: () => page.locator("#cci-research-go").click(),
      dialogName: "Start the research?", yes: "Start the research", route: "marketing/research",
    });
  });

  test("Run a short tweak of this research", async ({ page }) => {
    const { posts } = await mountIdeas(page, { "POST marketing/research/tweak": { status: 202, body: { ok: true, started: true, job: { id: "r-tw", status: "queued" } } } }, { confirmMode: mode });
    const done = page.locator('[data-run="r-done"]');
    await done.getByRole("button", { name: "Tweak" }).click();
    await done.locator("#cci-rt-r-done").fill("Look harder at bank overlays.");
    await cancelThenYes(page, posts, {
      open: async () => {
        // the tweak box clears after a yes, so type the note again before each press
        if (!(await done.locator("#cci-rt-r-done").inputValue())) await done.locator("#cci-rt-r-done").fill("Look harder at bank overlays.");
        await done.getByRole("button", { name: "Run the tweak" }).click();
      },
      dialogName: "Run a short tweak of this research?", yes: "Run the tweak", route: "marketing/research/tweak",
    });
  });

  test("Build the avatar (a flywheel step)", async ({ page }) => {
    const { posts } = await mountIdeas(page, { "POST marketing/flywheel/run": { status: 202, body: { ok: true, started: true, already_running: false, job: { id: "job-avatar", status: "queued" } } } }, { confirmMode: mode });
    await page.locator("#cci-sell").fill("Funding for business owners, done for you.");
    await cancelThenYes(page, posts, {
      open: () => page.locator("#cci-run-1").click(),
      yes: "Build the avatar", route: "marketing/flywheel/run",
    });
  });

  test("Write the offer (a flywheel step)", async ({ page }) => {
    const { posts } = await mountIdeas(page, { "POST marketing/flywheel/run": { status: 202, body: { ok: true, stage: 3, job: { id: "offer-1", status: "queued" } } } }, { confirmMode: mode });
    await cancelThenYes(page, posts, {
      open: () => page.locator("#cci-run-3").click(),
      yes: "Write the offer", route: "marketing/flywheel/run",
    });
  });

  test("Tweak a step and re-run it", async ({ page }) => {
    const { posts } = await mountIdeas(page, {
      "GET marketing/flywheel": () => flywheel({}),
      "POST marketing/flywheel/tweak": { status: 202, body: { ok: true, job: { id: "j2" }, outbox_id: "o2" } },
    }, { confirmMode: mode });
    const row = page.locator("#cci-stage-2");
    await row.getByRole("button", { name: "Tweak" }).click();
    await row.locator("#cci-tw-2").fill("Look harder at bank overlays.");
    await cancelThenYes(page, posts, {
      open: async () => {
        if (!(await row.locator("#cci-tw-2").inputValue())) await row.locator("#cci-tw-2").fill("Look harder at bank overlays.");
        await row.getByRole("button", { name: "Save and re-run step 2" }).click();
      },
      dialogName: "Tweak step 2?", yes: "Save and re-run", route: "marketing/flywheel/tweak",
    });
  });

  test("Make a new funnel", async ({ page }) => {
    const { posts } = await mountIdeas(page, {
      "POST marketing/funnels/create": () => ({
        ok: true,
        funnel: blueprintFunnel({ id: "00000000-0000-4000-8000-000000000605", key: "new-one", path: "/new-one", pages: "empty" }),
        job: { id: "job-f5", kind: "funnel", status: "queued", created_at: "2026-10-06T15:00:00Z" },
        worker: { started: true, reason: null },
      }),
    }, { confirmMode: mode });
    await cancelThenYes(page, posts, {
      open: () => page.locator("#cci-funnel-go").click(),
      dialogName: "Make a new funnel?", yes: "Make the funnel", route: "marketing/funnels/create",
    });
  });

  test("Write the pages for a funnel", async ({ page }) => {
    const { posts } = await mountIdeas(page, {
      "GET marketing/funnels": { ok: true, funnels: [blueprintFunnel({ pages: "empty" })], campaigns: [], ad_sets: [] },
      "POST marketing/funnels/build": OK_QUEUED,
    }, { confirmMode: mode });
    const row = page.locator(`[data-funnel="${FUNNEL_ID}"]`);
    await cancelThenYes(page, posts, {
      open: () => row.getByRole("button", { name: /^Write the pages( again)?$/ }).click(),
      yes: "Write the pages", route: "marketing/funnels/build",
    });
  });

  test("Write one piece of quick copy", async ({ page }) => {
    const { posts } = await mountIdeas(page, {
      "POST creative/generate": { ok: true, created: true, provider_ready: true, job: { id: "cj1" } },
      "POST creative/run": { ok: true, jobs: [{ job_id: "cj1", status: "succeeded", assets: [] }] },
    }, { confirmMode: mode });
    await page.locator("#cci-quick-angle").fill("Turned down by the bank");
    await cancelThenYes(page, posts, {
      open: () => page.locator("#cci-quick-go").click(),
      dialogName: "Write one piece of quick copy?", yes: "Write it", route: "creative/generate",
    });
  });

  test("Push live (the two-tap confirm that names the address)", async ({ page }) => {
    const { posts } = await mountIdeas(page, {
      "GET marketing/funnels": { ok: true, funnels: [blueprintFunnel({})], campaigns: [], ad_sets: [] },
      "POST marketing/funnels/push-live": { status: 202, body: { ok: true, queued: true, job: { id: "job-push", kind: "funnel_push", status: "queued" }, url: "https://apply.fundhub.ai/blueprint", worker: { started: true, reason: null } } },
    }, { confirmMode: mode });
    const row = page.locator(`[data-funnel="${FUNNEL_ID}"]`);
    await cancelThenYes(page, posts, {
      open: () => row.getByRole("button", { name: "Push live" }).click(),
      yes: "Push live to apply.fundhub.ai/blueprint", route: "marketing/funnels/push-live",
    });
  });
});
